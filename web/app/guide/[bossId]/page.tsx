// /guide/[bossId] — one boss, guided by our own history (#81, phase 0).
//
// Design: docs/DESIGN-81-raid-guide.md. The page is a stack of INDEPENDENT
// BLOCKS, each rendering only when it has data. Phase 0 ships the generated
// blocks that need no new schema:
//
//   1  Identity           2  Approach (read-only from bosses_local.strat_notes)
//   3  Our numbers        9  Loot & what it goes for
//  10  Catalog card      11  Fight log
//
// Blocks 4-8 (what it hits for / mechanics / callouts / debuffs / deaths) need
// the accretion table from §7 of the design — they are deliberately absent here
// rather than rendered from streams that expire (buff_casts is a 7-day window).
//
// Load-bearing rules, all implemented in the pure kernel web/lib/raidGuide.ts:
//   §6.1 the #171 catalog pick-and-merge + HP corroboration
//   §6.2 the DAMAGE floor (a duration floor admits re-pull fragments)
//   §6.3 loot prices only on sole-source items
// Auth + read style match /raid/review and /db/npc/[id].

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { fmtDmg, fmtDuration, fmtTime, dayKey, dayLabel, fmtDkp } from '@/lib/format';
import { userTz } from '@/lib/timezone';
import {
  normalizeNpcName, resolveCatalogRow, hpCorroboration,
  bucketEncounters, killStats, attributeLoot,
  type CatalogRow, type GuideEncounter, type DropRow, type AwardRow,
} from '@/lib/raidGuide';

export const dynamic = 'force-dynamic';

const POP_UNLOCK_MS = Date.parse('2026-10-01T00:00:00Z');

type BoardRow  = { boss_id: string; name: string | null; zone: string | null; expansion: string | null; timer_hours: number | null; emoji: string | null; pqdi_url: string | null };
type LocalRow  = { npc_id: number; internal_id: string; zone_short: string | null; strat_notes: string | null; path_notes: string | null; timer_hours_override: number | null };
type SpawnRow  = { zone_short: string | null; x: number | null; y: number | null; z: number | null; respawntime: number | null };
type EncFull   = GuideEncounter & { encounter_players?: { character_name: string; total_damage: number }[] };

const CATALOG_COLS =
  'id, name, level, hp, ac, mindmg, maxdmg, mr, fr, cr, dr, pr, class, race, runspeed, npc_spells_id, loottable_id, npcspecialattks';

async function load(bossId: string) {
  const sb = supabaseAdmin();

  const [boardRes, localRes] = await Promise.all([
    sb.from('bot_boards').select('boss_id, name, zone, expansion, timer_hours, emoji, pqdi_url').eq('boss_id', bossId).maybeSingle(),
    sb.from('bosses_local').select('npc_id, internal_id, zone_short, strat_notes, path_notes, timer_hours_override').eq('internal_id', bossId).maybeSingle(),
  ]);
  const board = (boardRes.data as BoardRow | null) ?? null;
  const local = (localRes.data as LocalRow | null) ?? null;
  if (!board && !local) return null;

  const displayName = board?.name || local?.internal_id || bossId;
  const expansion   = board?.expansion || null;
  const locked      = expansion === 'PoP' && Date.now() < POP_UNLOCK_MS;
  const npcId       = local?.npc_id ?? null;

  const base = {
    bossId, board, local, displayName, expansion, locked, npcId,
    catalog: null as ReturnType<typeof resolveCatalogRow>,
    keyedRow: null as CatalogRow | null,
    encounters: [] as EncFull[],
    drops: [] as DropRow[],
    dropperCounts: new Map<number, number>(),
    awards: [] as AwardRow[],
    spawns: [] as SpawnRow[],
  };
  // PoP stays locked: identity + authored only, no generated blocks.
  if (locked || npcId == null) return base;

  // The catalog row encounters are keyed to, plus every same-name sibling —
  // the #171 pick-and-merge inputs. Fetch the keyed row first so we know the
  // name to match siblings on.
  const { data: keyedRaw } = await sb.from('eqemu_npc_types').select(CATALOG_COLS).eq('id', npcId).maybeSingle();
  const keyed = (keyedRaw as CatalogRow | null) ?? null;

  let candidates: CatalogRow[] = keyed ? [keyed] : [];
  if (keyed?.name) {
    // eqemu names differ only by '#' / '_' / a trailing '_', so an ILIKE on the
    // de-marked stem finds the siblings without a full-table scan.
    const stem = String(keyed.name).replace(/^#/, '').replace(/_+$/, '');
    const { data: sibs } = await sb.from('eqemu_npc_types').select(CATALOG_COLS).ilike('name', `%${stem}%`).limit(25);
    const want = normalizeNpcName(keyed.name);
    candidates = [
      keyed,
      ...((sibs as CatalogRow[] | null) ?? []).filter(r => r.id !== keyed.id && normalizeNpcName(r.name) === want),
    ];
  }
  const catalog = resolveCatalogRow(candidates, npcId);
  base.catalog = catalog;
  base.keyedRow = keyed;

  const lootNpcId = catalog?.mergedFrom.find(id => id !== npcId) ?? npcId;

  const [encRes, dropRes, spawnRes] = await Promise.all([
    sb.from('encounters')
      .select('id, started_at, ended_at, duration_sec, total_damage, total_dps, classification, encounter_players ( character_name, total_damage )')
      .eq('npc_id', npcId)
      .order('started_at', { ascending: false })
      .limit(300),
    sb.from('eqemu_npc_drops').select('item_id, item_name').eq('npc_id', lootNpcId).limit(200),
    sb.from('eqemu_spawnentry').select('eqemu_spawn2!inner ( zone_short, x, y, z, respawntime )').eq('npc_id', npcId).limit(5),
  ]);

  base.encounters = ((encRes.data as unknown as EncFull[]) ?? []).map(e => ({
    ...e,
    player_count: e.encounter_players?.length ?? 0,
  }));

  const drops = ((dropRes.data as DropRow[] | null) ?? []);
  base.drops = drops;

  if (drops.length) {
    const ids = [...new Set(drops.map(d => d.item_id))];
    const [countRes, awardRes] = await Promise.all([
      sb.from('eqemu_npc_drops').select('item_id, npc_id').in('item_id', ids).limit(5000),
      sb.from('opendkp_loot').select('item_name, character_name, dkp').in('item_name', [...new Set(drops.map(d => d.item_name))]).limit(3000),
    ]);
    const counts = new Map<number, Set<number>>();
    for (const r of ((countRes.data as { item_id: number; npc_id: number }[] | null) ?? [])) {
      const s = counts.get(r.item_id) || new Set<number>();
      s.add(r.npc_id);
      counts.set(r.item_id, s);
    }
    base.dropperCounts = new Map([...counts].map(([k, v]) => [k, v.size]));
    base.awards = ((awardRes.data as AwardRow[] | null) ?? []);
  }

  base.spawns = (((spawnRes.data as unknown as { eqemu_spawn2: SpawnRow }[] | null) ?? [])
    .map(r => r.eqemu_spawn2).filter(Boolean));

  return base;
}

export default async function BossGuide({ params }: { params: Promise<{ bossId: string }> }) {
  const { bossId } = await params;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/guide/${encodeURIComponent(bossId)}`);

  const d = await load(bossId);
  if (!d) notFound();
  const tz = await userTz();

  const cat        = d.catalog?.row ?? null;
  const buckets    = bucketEncounters(d.encounters, cat?.hp ?? null);
  const stats      = killStats(buckets);
  const corrob     = stats.medianDamage != null ? hpCorroboration(stats.medianDamage, cat?.hp ?? null) : null;
  const { sole, shared } = attributeLoot(d.drops, d.dropperCounts, d.awards);
  const timerHours = d.local?.timer_hours_override ?? d.board?.timer_hours ?? null;
  const spawn      = d.spawns[0] ?? null;
  const approach   = (d.local?.strat_notes || '').trim();
  const access     = (d.local?.path_notes  || '').trim();
  const recent     = [...buckets.complete, ...buckets.fragments, ...buckets.engaged]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 25);

  return (
    <div className="space-y-6">
      {/* ── Block 1 · Identity ───────────────────────────────────────────── */}
      <div>
        <div className="text-sm mb-1">
          <Link href="/guide" className="text-blue hover:underline">← raid guide</Link>
        </div>
        <h1 className="text-2xl text-gold">{d.board?.emoji ? `${d.board.emoji} ` : ''}{d.displayName}</h1>
        <p className="text-sm text-dim mt-1">
          {d.board?.zone && <>📍 {d.board.zone} · </>}
          {d.expansion}
          {timerHours != null && <> · respawn {timerHours} h</>}
          {spawn?.respawntime != null && timerHours != null
            && Math.round(spawn.respawntime / 3600) !== timerHours
            && <span className="text-dim"> (catalog says {Math.round(spawn.respawntime / 3600)} h)</span>}
        </p>
        <div className="flex gap-3 flex-wrap text-xs mt-2">
          <Link href="/boards" className="text-blue hover:underline">board</Link>
          {d.npcId != null && <Link href={`/db/npc/${d.catalog?.primaryId ?? d.npcId}`} className="text-blue hover:underline">bestiary</Link>}
          {d.npcId != null && <Link href={`/boss/${d.npcId}`} className="text-blue hover:underline">all parses</Link>}
          {d.board?.pqdi_url && <a href={d.board.pqdi_url} target="_blank" rel="noreferrer" className="text-dim hover:text-blue">pqdi ↗</a>}
        </div>
      </div>

      {d.locked && (
        <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
          🔒 Planes of Power is locked until 2026-10-01. This page will fill in once we can fight it.
        </section>
      )}

      {/* #171 provenance — a shell catalog row silently renders a fictional boss. */}
      {d.catalog?.usedFallbackRow && (
        <section className="bg-panel border border-orange/50 rounded-lg p-3 text-xs text-dim">
          ⚠ Catalog facts below resolve to row <span className="font-mono text-orange">{d.catalog.primaryId}</span>, not
          the row our parses are keyed to (<span className="font-mono">{d.npcId}</span>) — that row carries no loot table
          or spell list. Merged from {d.catalog.mergedFrom.join(' + ')}.
        </section>
      )}

      {/* ── Block 2 · Approach (AUTHORED — nothing automated writes here) ─── */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-gold mb-2 flex items-center gap-2"><span aria-hidden>✍</span><span>Approach</span></h2>
        {approach
          ? <p className="text-sm text-text whitespace-pre-wrap">{approach}</p>
          : <p className="text-sm text-dim italic">No approach written yet — everything below is generated from our own fights.</p>}
        {access && (
          <>
            <h3 className="text-xs text-orange mt-3 mb-1">Getting there</h3>
            <p className="text-sm text-text whitespace-pre-wrap">{access}</p>
          </>
        )}
      </section>

      {/* ── Block 3 · Our numbers ───────────────────────────────────────── */}
      {stats.engagements > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-blue mb-3 flex items-center gap-2">
            <span aria-hidden>📊</span><span>Our numbers</span>
            <span className="text-dim text-xs">· {stats.completeKills} complete kill{stats.completeKills === 1 ? '' : 's'} of {stats.engagements} recorded engagements</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Median kill time" value={stats.medianDurationSec != null ? fmtDuration(stats.medianDurationSec) : '—'} accent="text-gold" />
            <Stat label="Range"            value={stats.minDurationSec != null ? `${fmtDuration(stats.minDurationSec)} → ${fmtDuration(stats.maxDurationSec)}` : '—'} />
            <Stat label="Median raid damage" value={stats.medianDamage != null ? fmtDmg(stats.medianDamage) : '—'} />
            <Stat label="Best raid damage"   value={stats.maxDamage    != null ? fmtDmg(stats.maxDamage)    : '—'} accent="text-orange" />
            <Stat label="Median raid DPS"    value={stats.medianDps    != null ? `${fmtDmg(stats.medianDps)}/s` : '—'} />
            <Stat label="Median parsed headcount" value={stats.medianPlayers != null ? String(stats.medianPlayers) : '—'} />
            <Stat label="First recorded" value={stats.firstAt ? dayLabel(dayKey(stats.firstAt, tz), tz) : '—'} />
            <Stat label="Last recorded"  value={stats.lastAt  ? dayLabel(dayKey(stats.lastAt,  tz), tz) : '—'} />
          </div>
          <p className="text-[10px] text-dim mt-3">
            A fight counts as a complete kill when a slain line was observed <em>and</em> the raid dealt at least half
            the boss&apos;s HP pool ({fmtDmg(Math.round(buckets.damageFloor))}
            {buckets.floorSource === 'median-damage' ? ', derived from our own median — no catalog HP resolved' : ''}).
            Not counted: {buckets.fragments.length} re-pull fragment{buckets.fragments.length === 1 ? '' : 's'},{' '}
            {buckets.noParse.length} timer-only row{buckets.noParse.length === 1 ? '' : 's'} with no parse,{' '}
            {buckets.engaged.length} engaged-but-unconfirmed. Parsed headcount counts characters that appeared in an
            upload, so raiders not running Mimic are missing.
          </p>
        </section>
      )}

      {/* ── Block 9 · Loot & what it goes for ────────────────────────────── */}
      {sole.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-gold mb-3 flex items-center gap-2">
            <span aria-hidden>💰</span><span>Loot &amp; what it goes for</span>
            <span className="text-dim text-xs">· {sole.length} drop{sole.length === 1 ? '' : 's'} only from this boss</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[28rem]">
              <thead className="text-dim text-left">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2">Item</th>
                  <th className="py-1 pr-2 text-right">Awarded</th>
                  <th className="py-1 pr-2 text-right">Avg DKP</th>
                  <th className="py-1 pr-2 text-right">Max DKP</th>
                </tr>
              </thead>
              <tbody>
                {sole.map((r) => (
                  <tr key={r.itemId} className="border-b border-border/30 hover:bg-[#1a212c]">
                    <td className="py-1 pr-2 text-text">
                      <Link href={`/db/item/${r.itemId}`} className="hover:text-blue hover:underline">{r.itemName}</Link>
                    </td>
                    <td className="py-1 pr-2 text-right text-dim tabular-nums">{r.awards || '—'}</td>
                    <td className="py-1 pr-2 text-right text-gold tabular-nums">{r.avgDkp != null ? fmtDkp(r.avgDkp) : '—'}</td>
                    <td className="py-1 pr-2 text-right text-dim tabular-nums">{r.maxDkp ? fmtDkp(r.maxDkp) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shared.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-dim cursor-pointer hover:text-blue">
                also on its table — {shared.length} item{shared.length === 1 ? '' : 's'} shared with other mobs (no prices)
              </summary>
              <p className="text-xs text-dim mt-2 leading-relaxed">{shared.map(r => r.itemName).join(' · ')}</p>
            </details>
          )}
          <p className="text-[10px] text-dim mt-2">
            DKP comes from OpenDKP awards matched by item name. OpenDKP records item → raid, not item → boss, so only
            items this boss is the sole catalog source for carry a price.
          </p>
        </section>
      )}

      {/* ── Block 10 · Catalog card ──────────────────────────────────────── */}
      {cat && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-3 flex items-center gap-2"><span aria-hidden>🗿</span><span>Catalog</span></h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Level" value={cat.level != null ? String(cat.level) : '—'} />
            <Stat label="HP"    value={cat.hp ? fmtDmg(cat.hp) : '—'} accent="text-gold" />
            <Stat label="AC"    value={cat.ac != null ? String(cat.ac) : '—'} />
            <Stat label="Melee" value={cat.maxdmg ? `${cat.mindmg ?? 0} – ${cat.maxdmg}` : '—'} />
            <Stat label="MR" value={cat.mr != null ? String(cat.mr) : '—'} accent={(cat.mr ?? 0) >= 500 ? 'text-red' : undefined} />
            <Stat label="FR" value={cat.fr != null ? String(cat.fr) : '—'} />
            <Stat label="CR" value={cat.cr != null ? String(cat.cr) : '—'} />
            <Stat label="DR / PR" value={`${cat.dr ?? '—'} / ${cat.pr ?? '—'}`} accent={(cat.pr ?? 0) >= 500 ? 'text-red' : undefined} />
          </div>
          {(cat.mr ?? 0) >= 500 && (
            <p className="text-xs text-red mt-3">
              ⚠ MR {cat.mr} — magic-based debuffs (slows, tashes, charms) are effectively resisted. Do not plan around a slow.
            </p>
          )}
          {corrob && (
            <p className="text-[10px] text-dim mt-2">
              {corrob.agrees
                ? <>Our fights corroborate this row: median raid damage {fmtDmg(corrob.medianDamage)} is {(corrob.ratio * 100).toFixed(1)}% of the listed HP pool.</>
                : <>⚠ Our median raid damage ({fmtDmg(corrob.medianDamage)}) is {(corrob.ratio * 100).toFixed(0)}% of this row&apos;s HP pool — the catalog number looks {corrob.verdict === 'over' ? 'understated' : 'overstated'}.</>}
            </p>
          )}
          {spawn && (
            <p className="text-[10px] text-dim mt-1">
              Spawns in <span className="font-mono">{spawn.zone_short}</span>
              {spawn.x != null && <> at ({Math.round(spawn.x)}, {Math.round(spawn.y ?? 0)}, {Math.round(spawn.z ?? 0)})</>}
              {spawn.respawntime != null && <> · catalog respawn {Math.round(spawn.respawntime / 3600)} h</>}.
            </p>
          )}
        </section>
      )}

      {/* ── Block 11 · Fight log ─────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-3 flex items-center gap-2">
            <span aria-hidden>📜</span><span>Fight log</span>
            <span className="text-dim text-xs">· last {recent.length}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[30rem]">
              <thead className="text-dim text-left">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2 text-right">Duration</th>
                  <th className="py-1 pr-2 text-right">Damage</th>
                  <th className="py-1 pr-2 text-right">Parsed</th>
                  <th className="py-1 pr-2">Top damage</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => {
                  const complete = buckets.complete.some(c => c.id === e.id);
                  const top = [...((e as EncFull).encounter_players ?? [])].sort((a, b) => b.total_damage - a.total_damage)[0];
                  return (
                    <tr key={e.id} className={`border-b border-border/30 hover:bg-[#1a212c] ${complete ? '' : 'opacity-60'}`}>
                      <td className="py-1 pr-2 text-dim">
                        <Link href={`/parses/${e.id}`} className="hover:text-blue">
                          {dayLabel(dayKey(e.started_at, tz), tz)} · {fmtTime(e.started_at, tz)}
                        </Link>
                        {!complete && <span className="ml-1 text-[9px] uppercase tracking-wide text-orange">partial</span>}
                      </td>
                      <td className="py-1 pr-2 text-right text-dim">{fmtDuration(e.duration_sec)}</td>
                      <td className="py-1 pr-2 text-right text-text">{fmtDmg(e.total_damage)}</td>
                      <td className="py-1 pr-2 text-right text-dim">{e.player_count ?? 0}</td>
                      <td className="py-1 pr-2 text-text">
                        {top ? (
                          <Link href={`/character/${encodeURIComponent(top.character_name)}`} className="hover:text-blue">{top.character_name}</Link>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!d.locked && stats.engagements === 0 && (
        <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
          No fights recorded here yet. The page fills itself in the first time we kill it with an agent running.
        </section>
      )}

      <p className="text-[10px] text-dim">
        Mechanics, callouts, debuffs and deaths are not on this page yet — they need the nightly archive described in
        <span className="font-mono"> docs/DESIGN-81-raid-guide.md</span> §4, because the streams they come from expire
        after seven days.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium truncate ${accent || 'text-text'}`} title={value}>{value}</div>
    </div>
  );
}
