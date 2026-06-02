// Officer tool: encounter data-quality audit + repair.
//
// Three problems this page exists to fix:
//
//   1) Missing damage — when an encounter row has total_damage < ~75% of
//      the NPC's catalog HP, parsers underreported and we should request
//      backfills from anyone who was in the fight.
//
//   2) Duplicate encounters — find_or_create_encounter dedup'd by a ±30min
//      window; when a respawn lands fast (e.g. Shei x2 in one night) it
//      sometimes drops a fresh row right next to an existing one with the
//      same (npc_id, started_at). The Seru x2 rows on 2026-05-29 are the
//      live example.
//
//   3) Over-cap damage — multi-parser max-per-player merges occasionally
//      produce totals > expected HP (Zhesz 29K vs 12.6K HP). These need
//      manual review of the contributions JSONB to figure out which parser
//      double-counted.
//
// Actions available per row:
//
//   - Mark incomplete (sets data_incomplete + reason)
//   - Merge with another encounter (collapse two rows into one)
//   - File a backfill request to a specific character (writes
//     agent_backfill_requests; agent polls and re-uploads the window)

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type EncounterRow = {
  id: string;
  npc_id: number | null;
  npc_name: string | null;
  expected_hp: number | null;
  zone_short: string | null;
  started_at: string | null;
  duration_sec: number | null;
  total_damage: number | null;
  total_dps: number | null;
  data_incomplete: boolean;
  data_incomplete_reason: string | null;
  contribs: number;
  players: number;
};

type DuplicatePair = {
  a: EncounterRow;
  b: EncounterRow;
};

async function loadEncounters(sinceIso: string): Promise<EncounterRow[]> {
  // PostgREST can't do the LEFT JOIN to eqemu_npc_types cleanly without a
  // foreign-key relationship; one execute_sql round-trip is simpler here.
  // But we don't have a server-side raw SQL helper in web/lib, so two queries.
  const admin = supabaseAdmin();
  const { data: encs } = await admin
    .from('encounters')
    .select('id, npc_id, zone_short, started_at, duration_sec, total_damage, total_dps, data_incomplete, data_incomplete_reason')
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(200);

  // eqemu_npc_types has ~14k rows and Supabase caps unfiltered selects at 1000
  // by default, so a plain .select('id,name,hp') silently dropped every NPC
  // with id > ~1000 (basically all instance bosses) — boss column rendered
  // "npc <id>" and the HP% column said "no HP catalog" for everything. Filter
  // the lookup to ONLY the npc_ids present in this batch.
  const uniqueNpcIds = Array.from(new Set(
    ((encs ?? []) as { npc_id: number | null }[])
      .map(e => e.npc_id)
      .filter((id): id is number => id != null),
  ));
  const { data: npcRows } = uniqueNpcIds.length > 0
    ? await admin.from('eqemu_npc_types').select('id, name, hp').in('id', uniqueNpcIds)
    : { data: [] };
  const npcById = new Map<number, { name: string; hp: number | null }>();
  for (const n of (npcRows ?? []) as { id: number; name: string; hp: number | null }[]) {
    npcById.set(n.id, { name: n.name, hp: n.hp });
  }

  // Pull contrib/player counts in bulk
  const ids = (encs ?? []).map((e: any) => e.id);
  const [contribCounts, playerCounts] = await Promise.all([
    admin.from('contributions').select('encounter_id').in('encounter_id', ids),
    admin.from('encounter_players').select('encounter_id').in('encounter_id', ids),
  ]);
  const contribByEnc = new Map<string, number>();
  for (const r of (contribCounts.data ?? []) as { encounter_id: string }[]) {
    contribByEnc.set(r.encounter_id, (contribByEnc.get(r.encounter_id) ?? 0) + 1);
  }
  const playerByEnc = new Map<string, number>();
  for (const r of (playerCounts.data ?? []) as { encounter_id: string }[]) {
    playerByEnc.set(r.encounter_id, (playerByEnc.get(r.encounter_id) ?? 0) + 1);
  }

  return (encs ?? []).map((e: any) => {
    const npc = e.npc_id != null ? npcById.get(e.npc_id) : null;
    return {
      id: e.id,
      npc_id: e.npc_id,
      npc_name: npc?.name?.replace(/_/g, ' ').replace(/^#/, '') ?? null,
      expected_hp: npc?.hp ?? null,
      zone_short: e.zone_short,
      started_at: e.started_at,
      duration_sec: e.duration_sec,
      total_damage: e.total_damage,
      total_dps: e.total_dps,
      data_incomplete: e.data_incomplete ?? false,
      data_incomplete_reason: e.data_incomplete_reason,
      contribs: contribByEnc.get(e.id) ?? 0,
      players: playerByEnc.get(e.id) ?? 0,
    };
  });
}

// Two encounters are "candidate duplicates" if they share npc_id and their
// started_at is within 60 seconds. Worth showing side-by-side with a merge
// button — covers the Seru-twice case and the "two parses created two rows"
// case both.
function findDuplicates(rows: EncounterRow[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const byNpc = new Map<number, EncounterRow[]>();
  for (const r of rows) {
    if (r.npc_id == null || r.started_at == null) continue;
    const list = byNpc.get(r.npc_id) ?? [];
    list.push(r);
    byNpc.set(r.npc_id, list);
  }
  for (const list of byNpc.values()) {
    list.sort((a, b) => (a.started_at! < b.started_at! ? -1 : 1));
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const dt = Math.abs(new Date(b.started_at!).getTime() - new Date(a.started_at!).getTime());
      if (dt <= 60 * 1000) pairs.push({ a, b });
    }
  }
  return pairs;
}

function hpRatio(r: EncounterRow): number | null {
  if (!r.expected_hp || r.expected_hp <= 0) return null;
  if (r.total_damage == null) return null;
  return r.total_damage / r.expected_hp;
}

function hpBadge(ratio: number | null): { label: string; cls: string } {
  if (ratio == null) return { label: 'no HP catalog', cls: 'text-dim' };
  if (ratio >= 1.5)  return { label: `${Math.round(ratio * 100)}%`, cls: 'text-purple' };
  if (ratio >= 0.95) return { label: `${Math.round(ratio * 100)}%`, cls: 'text-green' };
  if (ratio >= 0.75) return { label: `${Math.round(ratio * 100)}%`, cls: 'text-orange' };
  return { label: `${Math.round(ratio * 100)}%`, cls: 'text-red-400' };
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtDur(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

// ── Server actions ────────────────────────────────────────────────────────

async function markIncomplete(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').slice(0, 200);
  if (!id) return;
  const admin = supabaseAdmin();
  await admin
    .from('encounters')
    .update({
      data_incomplete: true,
      data_incomplete_reason: reason || 'flagged via admin',
      data_incomplete_at: new Date().toISOString(),
      data_incomplete_by: u!.email || u!.id,
    })
    .eq('id', id);
  revalidatePath('/admin/encounters');
}

async function clearIncomplete(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  const admin = supabaseAdmin();
  await admin
    .from('encounters')
    .update({
      data_incomplete: false,
      data_incomplete_reason: null,
      data_incomplete_at: null,
      data_incomplete_by: null,
    })
    .eq('id', id);
  revalidatePath('/admin/encounters');
}

// Merge two encounters: move all contributions + encounter_players from
// `source` into `target`, then delete `source`. We do NOT recompute totals
// here because merge_encounter_players() RPC already exists and gets called
// elsewhere; we invoke it after the move.
async function mergeEncounters(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const target = String(formData.get('target') || '');
  const source = String(formData.get('source') || '');
  if (!target || !source || target === source) return;
  const admin = supabaseAdmin();

  // Move contributions
  await admin.from('contributions').update({ encounter_id: target }).eq('encounter_id', source);

  // Move encounter_players — but watch for PK collision (same character on
  // both encounters). For safety: delete the duplicate from source first,
  // then move. encounter_players PK is presumably (encounter_id, character).
  const { data: tgtPlayers } = await admin
    .from('encounter_players')
    .select('character_name')
    .eq('encounter_id', target);
  const tgtSet = new Set((tgtPlayers ?? []).map((p: any) => p.character_name));
  const { data: srcPlayers } = await admin
    .from('encounter_players')
    .select('character_name, total_damage, dps, duration_sec, rank, has_pets')
    .eq('encounter_id', source);
  for (const p of (srcPlayers ?? []) as any[]) {
    if (tgtSet.has(p.character_name)) {
      // Same character on both — drop source row, target keeps its existing
      // figure (the safer choice; merge_encounter_players will recompute
      // from contributions JSONB anyway).
      await admin.from('encounter_players').delete()
        .eq('encounter_id', source).eq('character_name', p.character_name);
    } else {
      await admin.from('encounter_players')
        .update({ encounter_id: target })
        .eq('encounter_id', source).eq('character_name', p.character_name);
    }
  }

  // Delete the now-empty source row
  await admin.from('encounters').delete().eq('id', source);

  // Recompute target totals from the new contributions set
  try { await admin.rpc('merge_encounter_players', { p_encounter_id: target }); } catch {}

  revalidatePath('/admin/encounters');
}

async function fileBackfillRequest(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const character    = String(formData.get('character') || '').trim();
  const encounterId  = String(formData.get('encounter_id') || '');
  const startIso     = String(formData.get('start_iso') || '');
  const endIso       = String(formData.get('end_iso') || '');
  const reason       = String(formData.get('reason') || '').slice(0, 300);
  if (!character || !startIso || !endIso) return;
  const admin = supabaseAdmin();
  await admin.from('agent_backfill_requests').insert({
    guild_id: 'wolfpack',
    character,
    requested_by_discord_id: u!.id,
    requested_by_name: u!.email || null,
    reason: reason || `data gap on encounter ${encounterId}`,
    scope: { start_iso: startIso, end_iso: endIso, types: ['encounter'] },
  }).then(({ error }) => {
    if (error && !/duplicate key|unique/i.test(error.message)) throw error;
  });
  revalidatePath('/admin/encounters');
}

// ── Page ──────────────────────────────────────────────────────────────────

export default async function AdminEncountersPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; show?: string }>;
}) {
  const { days: daysParam, show } = await searchParams;
  const days = Math.max(1, Math.min(90, parseInt(daysParam || '7', 10) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // "Reviewable" = encounters whose npc_id never resolved to a name in
  // our catalog. These render as "npc 158443" and are the rows officers
  // need to dig into (raid scripted bosses, novel mobs, broken sync).
  const showReviewable = show === 'reviewable';

  const allRows = await loadEncounters(since.toISOString());
  const dupes = findDuplicates(allRows);
  const dupeIds = new Set<string>();
  for (const p of dupes) { dupeIds.add(p.a.id); dupeIds.add(p.b.id); }

  // Always count from the full set so the chips reflect totals; the table
  // below filters when ?show=reviewable.
  const stats = {
    total: allRows.length,
    zero: allRows.filter(r => (r.total_damage ?? 0) === 0).length,
    low:  allRows.filter(r => { const x = hpRatio(r); return x != null && x < 0.75; }).length,
    over: allRows.filter(r => { const x = hpRatio(r); return x != null && x > 1.10; }).length,
    incomplete: allRows.filter(r => r.data_incomplete).length,
    duplicates: dupes.length,
    reviewable: allRows.filter(r => !r.npc_name).length,
  };

  const rows = showReviewable ? allRows.filter(r => !r.npc_name) : allRows;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">⚔️ Encounter audit</h2>
        <p className="text-sm text-dim leading-6">
          Every encounter the bot has stored, with HP-vs-damage health, duplicate
          detection, and merge / mark-incomplete / request-backfill actions.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-3 mt-4 text-xs">
          <Stat label="Encounters"     value={stats.total} />
          <Stat label="Reviewable"     value={stats.reviewable} color="text-purple" />
          <Stat label="Zero damage"    value={stats.zero}  color="text-red-400" />
          <Stat label="Low HP (<75%)"  value={stats.low}   color="text-orange" />
          <Stat label="Over cap (>110%)" value={stats.over} color="text-purple" />
          <Stat label="Duplicates"     value={stats.duplicates} color="text-orange" />
          <Stat label="Marked incomplete" value={stats.incomplete} color="text-dim" />
        </div>
        <form method="GET" className="mt-4 text-xs flex items-center gap-2 flex-wrap">
          <span className="text-dim">Last</span>
          <select name="days" defaultValue={String(days)}
            className="bg-bg border border-border rounded px-2 py-1 text-sm">
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          {showReviewable && <input type="hidden" name="show" value="reviewable" />}
          <button className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">Apply</button>
          {showReviewable ? (
            <Link href={`/admin/encounters?days=${days}`}
              className="px-3 py-1 rounded border border-purple bg-[#8957e533] text-purple text-xs no-underline">
              🔍 Reviewable only ({stats.reviewable}) · click to clear
            </Link>
          ) : (
            <Link href={`/admin/encounters?days=${days}&show=reviewable`}
              className="px-3 py-1 rounded border border-border bg-bg text-dim hover:text-purple text-xs no-underline">
              🔍 Show only reviewable ({stats.reviewable})
            </Link>
          )}
        </form>
      </section>

      {/* Duplicates */}
      {dupes.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
            🚨 Possible duplicates ({dupes.length}) — same NPC, started within 60s
          </h3>
          <div className="p-3 space-y-3">
            {dupes.map((p, i) => {
              const bothEmpty = (p.a.total_damage ?? 0) === 0 && (p.b.total_damage ?? 0) === 0
                              && p.a.contribs === 0 && p.b.contribs === 0;
              return (
              <div key={i} className="bg-bg border border-border rounded p-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {[{ label: 'A', enc: p.a }, { label: 'B', enc: p.b }].map(({ label, enc: e }) => (
                    <div key={e.id} className="space-y-1">
                      <div className="text-text">
                        <span className="text-orange font-bold mr-1">[{label}]</span>
                        {e.npc_name || `npc ${e.npc_id}`}
                        {e.npc_id && <span className="text-dim text-[10px]"> · npc_id {e.npc_id}</span>}
                      </div>
                      <div className="text-dim">{fmtTs(e.started_at)} · {fmtDur(e.duration_sec)} · {e.contribs} contribs · {e.players} players</div>
                      <div className="text-dim">{(e.total_damage ?? 0).toLocaleString()} dmg <span className={hpBadge(hpRatio(e)).cls}>{hpBadge(hpRatio(e)).label}</span></div>
                      <div className="text-dim text-[10px]">id <code>{e.id.slice(0, 8)}</code></div>
                    </div>
                  ))}
                </div>
                {bothEmpty && (
                  <div className="text-dim text-[11px] italic mt-2">
                    Both rows are empty (0 contributions, 0 players, 0 damage) — merging won&apos;t change anything.
                    Use <b>Mark incomplete</b> on each below, or delete one as a ghost row.
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <form action={mergeEncounters}>
                    <input type="hidden" name="target" value={p.a.id} />
                    <input type="hidden" name="source" value={p.b.id} />
                    <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs">
                      Merge B → A
                    </button>
                  </form>
                  <form action={mergeEncounters}>
                    <input type="hidden" name="target" value={p.b.id} />
                    <input type="hidden" name="source" value={p.a.id} />
                    <button type="submit" className="px-2 py-1 rounded border border-border bg-bg text-text text-xs">
                      Merge A → B
                    </button>
                  </form>
                </div>
              </div>
            );
            })}
          </div>
        </section>
      )}

      {/* Main table */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Encounters — last {days} day{days === 1 ? '' : 's'}
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim hidden sm:table-header-group">
            <tr className="border-b border-border">
              <th className="text-left px-2 sm:px-3 py-2 font-normal">When</th>
              <th className="text-left px-2 sm:px-3 py-2 font-normal">Boss / Zone</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal">Dur</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal">Damage</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal">HP%</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">P</th>
              <th className="text-right px-2 sm:px-3 py-2 font-normal hidden md:table-cell">C</th>
              <th className="text-left px-2 sm:px-3 py-2 font-normal">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ratio = hpRatio(r);
              const badge = hpBadge(ratio);
              const flagged = r.data_incomplete || (r.total_damage ?? 0) === 0 || (ratio != null && ratio < 0.75) || (ratio != null && ratio > 1.10);
              return (
                <tr key={r.id} className={`border-b border-border/40 hover:bg-[#1a212c] ${dupeIds.has(r.id) ? 'bg-[#3a1e1e22]' : ''}`}>
                  <td className="px-2 sm:px-3 py-2 text-dim whitespace-nowrap hidden sm:table-cell">{fmtTs(r.started_at)}</td>
                  <td className="px-2 sm:px-3 py-2 text-text">
                    <div>
                      {r.npc_name || <span className="text-purple">npc {r.npc_id}</span>}
                    </div>
                    <div className="text-dim text-[10px]">
                      {r.zone_short || '—'}
                      {r.npc_id && r.npc_name && <> · npc_id {r.npc_id}</>}
                      {' · id '}<code>{r.id.slice(0, 8)}</code>
                      <span className="sm:hidden"> · {fmtTs(r.started_at)} · {fmtDur(r.duration_sec)}</span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-right text-dim hidden sm:table-cell">{fmtDur(r.duration_sec)}</td>
                  <td className="px-2 sm:px-3 py-2 text-right text-text whitespace-nowrap">{(r.total_damage ?? 0).toLocaleString()}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right whitespace-nowrap ${badge.cls}`}>{badge.label}</td>
                  <td className="px-2 sm:px-3 py-2 text-right text-dim hidden md:table-cell">{r.players}</td>
                  <td className="px-2 sm:px-3 py-2 text-right text-dim hidden md:table-cell">{r.contribs}</td>
                  <td className="px-3 py-2">
                    <details className="text-xs">
                      <summary className={`cursor-pointer ${flagged ? 'text-orange' : 'text-dim'}`}>
                        {r.data_incomplete ? `🚧 ${r.data_incomplete_reason || 'incomplete'}` : flagged ? 'Review' : 'OK'}
                      </summary>
                      <div className="mt-2 space-y-2 bg-bg p-2 rounded border border-border">
                        <Link href={`/parses/${r.id}`} className="text-blue hover:underline block">View parse →</Link>
                        {!r.data_incomplete ? (
                          <form action={markIncomplete} className="flex gap-1">
                            <input type="hidden" name="id" value={r.id} />
                            <input name="reason" placeholder="reason" className="bg-bg border border-border rounded px-2 py-0.5 text-xs flex-1" />
                            <button type="submit" className="px-2 py-0.5 rounded border border-orange bg-[#a06628] text-white text-xs">Mark incomplete</button>
                          </form>
                        ) : (
                          <form action={clearIncomplete}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="px-2 py-0.5 rounded border border-border bg-panel text-text text-xs">Clear flag</button>
                          </form>
                        )}
                        <form action={fileBackfillRequest} className="space-y-1">
                          <input type="hidden" name="encounter_id" value={r.id} />
                          <input type="hidden" name="start_iso" value={r.started_at || ''} />
                          <input type="hidden" name="end_iso"   value={new Date(new Date(r.started_at || Date.now()).getTime() + 10 * 60 * 1000).toISOString()} />
                          <input name="character" placeholder="character to ping" className="bg-bg border border-border rounded px-2 py-0.5 text-xs w-full" required />
                          <input name="reason" placeholder="reason (optional)" className="bg-bg border border-border rounded px-2 py-0.5 text-xs w-full" />
                          <button type="submit" className="px-2 py-0.5 rounded border border-blue bg-[#1f6feb] text-white text-xs">
                            Request backfill
                          </button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}
