// /boss/[id] — all-time stats per boss (npc_id).
// Shows: every recorded kill, top damage all-time, fastest kill,
// historical top performers per role inferred from class data.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fmtDmg, fmtDuration, fmtTime, dayKey, dayLabel } from '@/lib/format';
import { userTz } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type BossRef     = { id: number; name: string; zone_short: string | null };
type ZoneRow     = { short_name: string; long_name: string };
type EncounterRow = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  encounter_players: { character_name: string; total_damage: number; dps: number; rank: number | null }[];
};

async function load(npcIdRaw: string) {
  try {
    const npcId = parseInt(npcIdRaw, 10);
    if (!Number.isFinite(npcId)) return { error: 'invalid id' as const };
    const sb = supabaseAdmin();

    const { data: bossRaw } = await sb
      .from('eqemu_npc_types')
      .select('id, name, zone_short')
      .eq('id', npcId)
      .single();
    const boss = bossRaw as BossRef | null;
    if (!boss) return { error: 'not found' as const };

    const { data: encRaw } = await sb
      .from('encounters')
      .select(`
        id, started_at, duration_sec, total_damage, total_dps,
        encounter_players ( character_name, total_damage, dps, rank )
      `)
      .eq('npc_id', npcId)
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(100);
    const encounters = (encRaw as unknown as EncounterRow[]) ?? [];

    const { data: zoneRow } = await sb
      .from('eqemu_zone')
      .select('short_name, long_name')
      .eq('short_name', boss.zone_short || '')
      .single();
    const zone = zoneRow as ZoneRow | null;

    return { boss, encounters, zone, error: null as null };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function BossPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/boss/${encodeURIComponent(id)}`);

  const data = await load(id);
  const tz = await userTz();
  if (data.error === 'not found' || data.error === 'invalid id') notFound();
  if (data.error || !data.boss) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Error: {data.error}
      </div>
    );
  }
  const { boss, encounters, zone } = data;

  // Aggregates
  const killCount = encounters.length;
  const totalDamage = encounters.reduce((s, e) => s + (e.total_damage || 0), 0);
  const fastestKill = encounters
    .filter(e => e.duration_sec != null && e.duration_sec > 0)
    .reduce((b: EncounterRow | null, e) =>
      !b || (e.duration_sec || Infinity) < (b.duration_sec || Infinity) ? e : b, null);
  type Candidate = { character_name: string; total_damage: number; dps: number; rank: number | null; encounter_id: string; started_at: string };
  const biggestParse = encounters
    .flatMap(e => (e.encounter_players ?? []).map(p => ({ ...p, encounter_id: e.id, started_at: e.started_at })))
    .reduce<Candidate | null>((b, p) => !b || p.total_damage > b.total_damage ? p : b, null);

  // All-time top damage on this boss, top 15.
  const allTimeTop = encounters
    .flatMap(e => (e.encounter_players ?? []).map(p => ({ ...p, encounter_id: e.id, started_at: e.started_at })))
    .sort((a, b) => b.total_damage - a.total_damage)
    .slice(0, 15);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/parses" className="text-blue hover:underline">← back to parses</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-2xl text-gold">{boss.name}</h2>
          {zone && <div className="text-sm text-dim">📍 {zone.long_name}</div>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Stat label="Kills recorded" value={String(killCount)} accent="text-blue" />
          <Stat label="Total damage" value={fmtDmg(totalDamage)} />
          <Stat
            label="Fastest kill"
            value={fastestKill ? fmtDuration(fastestKill.duration_sec) : '—'}
            sub={fastestKill ? new Date(fastestKill.started_at).toLocaleDateString() : null}
            accent="text-orange"
          />
          <Stat
            label="Biggest parse"
            value={biggestParse ? biggestParse.character_name : '—'}
            sub={biggestParse ? fmtDmg(biggestParse.total_damage) : null}
            accent="text-gold"
          />
        </div>
      </section>

      {/* All-time top damage on this boss */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
          <span aria-hidden>👑</span>
          <span>All-time top damage on {boss.name}</span>
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 w-8">#</th>
              <th className="py-1 pr-2">Character</th>
              <th className="py-1 pr-2 text-right">Damage</th>
              <th className="py-1 pr-2 text-right">DPS</th>
              <th className="py-1 pr-2">When</th>
            </tr>
          </thead>
          <tbody>
            {allTimeTop.map((p, i) => (
              <tr key={p.encounter_id + p.character_name} className="border-b border-border/30 hover:bg-[#1a212c]">
                <td className="py-1 pr-2 text-dim">{i + 1}</td>
                <td className="py-1 pr-2 text-text">
                  <Link href={`/character/${encodeURIComponent(p.character_name)}`} className="hover:text-blue hover:underline">
                    {p.character_name}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-right text-gold">{fmtDmg(p.total_damage)}</td>
                <td className="py-1 pr-2 text-right text-dim">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                <td className="py-1 pr-2 text-dim">
                  <Link href={`/parses/${p.encounter_id}`} className="hover:text-blue">
                    {dayLabel(dayKey(p.started_at, tz), tz)} · {fmtTime(p.started_at, tz)}
                  </Link>
                </td>
              </tr>
            ))}
            {allTimeTop.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-dim italic">No parses recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Recent kills of this boss */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>📜</span>
          <span>Recent kills</span>
          <span className="text-dim text-xs">· last {encounters.length}</span>
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2">Date</th>
              <th className="py-1 pr-2 text-right">Duration</th>
              <th className="py-1 pr-2 text-right">Total damage</th>
              <th className="py-1 pr-2 text-right">Players</th>
              <th className="py-1 pr-2">Top damage</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => {
              const top = [...(e.encounter_players ?? [])]
                .sort((a, b) => b.total_damage - a.total_damage)[0];
              return (
                <tr key={e.id} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">
                    <Link href={`/parses/${e.id}`} className="hover:text-blue">
                      {dayLabel(dayKey(e.started_at, tz), tz)} · {fmtTime(e.started_at, tz)}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 text-right text-dim">{fmtDuration(e.duration_sec)}</td>
                  <td className="py-1 pr-2 text-right text-text">{fmtDmg(e.total_damage)}</td>
                  <td className="py-1 pr-2 text-right text-dim">{e.encounter_players?.length ?? 0}</td>
                  <td className="py-1 pr-2 text-text">
                    {top ? (
                      <>
                        <Link href={`/character/${encodeURIComponent(top.character_name)}`} className="hover:text-blue">
                          {top.character_name}
                        </Link>
                        <span className="text-dim ml-1">{fmtDmg(top.total_damage)}</span>
                      </>
                    ) : '—'}
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

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string | null; accent?: string }) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium truncate ${accent || 'text-text'}`} title={value}>{value}</div>
      {sub && <div className="text-xs text-dim truncate">{sub}</div>}
    </div>
  );
}
