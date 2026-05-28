// /character/[name] — per-character summary. Reads from encounter_players for
// parses, opendkp_loot for what they've won, opendkp_attendance_recent for
// raids attended, who_observations for class/level.
//
// URL casing is preserved as displayed. Lookups are case-insensitive against
// the canonical character name.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { fmtDmg, fmtDuration, fmtTime, fmtDkp, dayKey, dayLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

type WhoObs   = { character: string; class: string | null; race: string | null; level: number | null; guild_name: string | null; observed_at: string };
type ParseRow = {
  encounter_id: string;
  character_name: string;
  total_damage: number;
  dps: number;
  duration_sec: number | null;
  rank: number | null;
  has_pets: boolean | null;
  encounters: { id: string; started_at: string; duration_sec: number | null; zone_short: string | null; eqemu_npc_types: { name: string } | null } | null;
};
type LootRow      = { item_name: string; dkp: number; raid_name: string; raid_date: string; game_item_id: number | null };
type AttendanceRow = { character_name: string; raids_attended: number; last_30d: number; last_90d: number; first_attended: string; last_attended: string };

async function load(name: string) {
  try {
    const sb = supabaseAdmin();
    const decoded = decodeURIComponent(name);

    // 1. /who observations — class/race/level/guild. Take latest non-null fields.
    const { data: whoRows } = await sb
      .from('who_observations')
      .select('character, class, race, level, guild_name, observed_at')
      .ilike('character', decoded)
      .order('observed_at', { ascending: false })
      .limit(20);
    const who: WhoObs | null = (() => {
      const merged: Partial<WhoObs> & { character?: string; observed_at?: string } = {};
      for (const r of (whoRows ?? []) as WhoObs[]) {
        if (!merged.character) merged.character = r.character;
        if (!merged.observed_at) merged.observed_at = r.observed_at;
        if (!merged.class && r.class) merged.class = r.class;
        if (!merged.race  && r.race)  merged.race  = r.race;
        if (merged.level == null && r.level != null) merged.level = r.level;
        if (!merged.guild_name && r.guild_name) merged.guild_name = r.guild_name;
      }
      return merged.character ? (merged as WhoObs) : null;
    })();

    const displayName = who?.character || decoded;

    // 2. Parses — every encounter_players row, joined to its encounter for boss/zone/time.
    const { data: parseRowsRaw } = await sb
      .from('encounter_players')
      .select(`
        encounter_id, character_name, total_damage, dps, duration_sec, rank, has_pets,
        encounters!inner ( id, started_at, duration_sec, zone_short, eqemu_npc_types ( name ) )
      `)
      .eq('character_name', displayName)
      .order('total_damage', { ascending: false })
      .limit(200);
    const parses = (parseRowsRaw as unknown as ParseRow[]) ?? [];

    // 3. Loot — opendkp_loot rows where character_name matches.
    const { data: lootRaw } = await sb
      .from('opendkp_loot_recent')
      .select('item_name, dkp, raid_name, raid_date, game_item_id')
      .ilike('character_name', displayName)
      .order('raid_date', { ascending: false })
      .limit(200);
    const loot = (lootRaw as LootRow[]) ?? [];

    // 4. Attendance.
    const { data: attRaw } = await sb
      .from('opendkp_attendance_recent')
      .select('character_name, raids_attended, last_30d, last_90d, first_attended, last_attended')
      .ilike('character_name', displayName)
      .single();
    const attendance = attRaw as AttendanceRow | null;

    return { displayName, who, parses, loot, attendance, error: null as string | null };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function CharacterPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const data = await load(name);
  if (data.error || !data.displayName) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        {data.error || `Character "${name}" not found.`}
      </div>
    );
  }

  const { displayName, who, parses, loot, attendance } = data;

  // Aggregates
  const totalParses = parses.length;
  const totalDamage = parses.reduce((s, p) => s + (p.total_damage || 0), 0);
  const bestParse = parses.length > 0
    ? parses.reduce((b, p) => (p.total_damage > b.total_damage ? p : b))
    : null;
  const totalLootSpent = loot.reduce((s, l) => s + (l.dkp || 0), 0);

  // Group parses by night → boss for the activity list (top 30 most recent)
  const recentParses = [...parses].sort(
    (a, b) => new Date(b.encounters?.started_at || 0).getTime() - new Date(a.encounters?.started_at || 0).getTime(),
  ).slice(0, 30);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/parses" className="text-blue hover:underline">← back to parses</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-2xl text-gold">{displayName}</h2>
          {who && (
            <div className="text-sm text-dim">
              {who.level && <span>{who.level} </span>}
              {who.race && <span>{who.race} </span>}
              {who.class && <span className="text-text">{who.class}</span>}
              {who.guild_name && (
                <span className="ml-2">{'<'}<span className="text-orange">{who.guild_name}</span>{'>'}</span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Parses" value={String(totalParses)} accent="text-blue" />
          <Stat label="Total damage" value={fmtDmg(totalDamage)} accent="text-text" />
          <Stat
            label="Best parse"
            value={bestParse ? fmtDmg(bestParse.total_damage) : '—'}
            sub={bestParse?.encounters?.eqemu_npc_types?.name || null}
            accent="text-gold"
          />
          <Stat
            label="Raids attended"
            value={attendance ? String(attendance.raids_attended) : '—'}
            sub={attendance ? `${attendance.last_30d} in last 30d` : null}
            accent="text-orange"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Stat label="Loot won" value={String(loot.length)} />
          <Stat label="DKP spent" value={fmtDkp(totalLootSpent)} />
          <Stat label="First raid" value={attendance?.first_attended ? new Date(attendance.first_attended).toLocaleDateString() : '—'} />
          <Stat label="Last raid"  value={attendance?.last_attended  ? new Date(attendance.last_attended).toLocaleDateString()  : '—'} />
        </div>
      </section>

      {/* Recent parses */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>⚔️</span>
          <span>Recent parses</span>
          <span className="text-dim text-xs">· top 30 by date</span>
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2">When</th>
              <th className="py-1 pr-2">Boss</th>
              <th className="py-1 pr-2 text-right">Damage</th>
              <th className="py-1 pr-2 text-right">DPS</th>
              <th className="py-1 pr-2 text-right">Rank</th>
              <th className="py-1 pr-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {recentParses.map((p) => {
              const boss = p.encounters?.eqemu_npc_types?.name ?? '?';
              const ts   = p.encounters?.started_at;
              return (
                <tr key={p.encounter_id} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">
                    {ts ? (
                      <Link href={`/parses/${p.encounter_id}`} className="hover:text-blue">
                        {dayLabel(dayKey(ts))} · {fmtTime(ts)}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="py-1 pr-2 text-text">{boss}</td>
                  <td className="py-1 pr-2 text-right text-text">{fmtDmg(p.total_damage)}</td>
                  <td className="py-1 pr-2 text-right text-dim">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim">{p.rank ?? '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim">{fmtDuration(p.duration_sec)}</td>
                </tr>
              );
            })}
            {recentParses.length === 0 && (
              <tr><td colSpan={6} className="py-2 text-dim italic">No parses recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Loot */}
      {loot.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-gold mb-3 flex items-center gap-2">
            <span aria-hidden>💰</span>
            <span>Loot won</span>
            <span className="text-dim text-xs">· {loot.length} items, {totalLootSpent} DKP total</span>
          </h3>
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {loot.map((l, i) => {
              const href = l.game_item_id ? `https://www.pqdi.cc/item/${l.game_item_id}` : null;
              return (
                <li key={`${l.item_name}-${i}`} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                  <span className="truncate">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{l.item_name}</a>
                    ) : (
                      <span className="text-text">{l.item_name}</span>
                    )}
                    <span className="text-dim ml-2">{new Date(l.raid_date).toLocaleDateString()}</span>
                  </span>
                  <span className="text-gold whitespace-nowrap">{fmtDkp(l.dkp)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
