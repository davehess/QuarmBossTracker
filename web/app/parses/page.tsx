// Raid parse history — server component. Reads encounters via service_role
// so the page is consistent regardless of the viewer's RLS scope. Encounter
// data is non-sensitive within the guild but isn't public — we gate on a
// signed-in Supabase session, which by definition means the user passed the
// guild + role checks in /auth/callback at sign-in time.
//
// Structure: raid night → zone group → kills in the order we did them →
// per-night loot block from OpenDKP + attendance summary.
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import KillCard, { type KillCardData } from '@/components/KillCard';
import LootBlock, { type LootRow } from '@/components/LootBlock';
import NightSummary, { type NightStats } from '@/components/NightSummary';
import { dayKey, dayLabel, fmtDmg, cleanBossName } from '@/lib/format';
import { classifyEncounter, clearClassification } from './actions';

export const dynamic = 'force-dynamic';

type NpcRef         = { id: number; name: string; zone_short: string | null };
type PlayerRow      = { character_name: string; total_damage: number; dps: number; rank: number | null };
type EncounterRow = {
  id: string;
  started_at: string;
  ended_at: string | null;     // null ⇒ encounter still ENGAGED (no kill line observed yet)
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  zone_short: string | null;
  classification: string | null;
  eqemu_npc_types: NpcRef | null;
  encounter_players: PlayerRow[];
};
type ZoneRow = { short_name: string; long_name: string; expansion: number | null };
type LootDbRow = {
  raid_date: string;
  raid_id: number;
  raid_name: string;
  item_name: string;
  character_name: string;
  dkp: number;
  game_item_id: number | null;
  notes: string | null;
};
type AttendanceRollup = {
  date: string;
  raid_count: number;
  unique_attendees: number;
  top_attendees: { name: string; ticks: number }[];
};

const ROW_LIMIT = 250;

async function loadAll(): Promise<{
  rows: EncounterRow[];
  zones: Map<string, ZoneRow>;
  loot: Map<string, LootDbRow[]>;
  attendance: Map<string, AttendanceRollup>;
  error: string | null;
}> {
  try {
    const sb = supabaseAdmin();

    const { data: encs, error: encErr } = await sb
      .from('encounters')
      .select(`
        id, started_at, ended_at, duration_sec, total_damage, total_dps, zone_short, classification,
        eqemu_npc_types ( id, name, zone_short ),
        encounter_players ( character_name, total_damage, dps, rank )
      `)
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (encErr) return { rows: [], zones: new Map(), loot: new Map(), attendance: new Map(), error: encErr.message };

    const { data: zoneRows } = await sb
      .from('eqemu_zone')
      .select('short_name, long_name, expansion');
    const zones = new Map<string, ZoneRow>(
      (zoneRows ?? []).map((z: ZoneRow) => [z.short_name, z]),
    );

    // Loot: pull 60 days back so a long backfill scroll still shows context.
    const since = new Date(Date.now() - 60 * 86400 * 1000).toISOString().slice(0, 10);
    const { data: lootRows } = await sb
      .from('opendkp_loot_recent')
      .select('raid_date, raid_id, raid_name, item_name, character_name, dkp, game_item_id, notes')
      .gte('raid_date', since)
      .order('dkp', { ascending: false });
    const loot = new Map<string, LootDbRow[]>();
    for (const r of (lootRows ?? []) as LootDbRow[]) {
      // raid_date is YYYY-MM-DD from the view
      const k = r.raid_date;
      if (!loot.has(k)) loot.set(k, []);
      loot.get(k)!.push(r);
    }

    // Attendance rollup: per-night raid + attendee count + top 5 attendees.
    // We compute this in app code from opendkp_raids + opendkp_ticks rather
    // than trying to build a view that handles all the edge cases (multi-pool
    // nights, bonus ticks, etc).
    const { data: raidRows } = await sb
      .from('opendkp_raids')
      .select('raid_id, ts')
      .gte('ts', since)
      .range(0, 19999);
    // opendkp_ticks has no per-window filter, so it must carry an explicit
    // range — PostgREST's default 1000-row cap was silently dropping ~28% of
    // attendance ticks (table is 1396 rows and growing). Bound to the raids
    // we actually loaded AND add a generous range so future growth is safe.
    const raidIdSet = new Set((raidRows ?? []).map((r: any) => r.raid_id));
    const { data: tickRowsRaw } = await sb
      .from('opendkp_ticks')
      .select('raid_id, attendees')
      .range(0, 99999);
    const tickRows = (tickRowsRaw ?? []).filter((t: any) => raidIdSet.has(t.raid_id));

    const attendance = new Map<string, AttendanceRollup>();
    if (raidRows && tickRows) {
      const raidToDate = new Map<number, string>();
      for (const r of raidRows as { raid_id: number; ts: string }[]) {
        raidToDate.set(r.raid_id, dayKey(r.ts));
      }
      type DayAgg = { raids: Set<number>; attendeeTicks: Map<string, number> };
      const byDay = new Map<string, DayAgg>();
      for (const t of tickRows as { raid_id: number; attendees: string[] }[]) {
        const dateKey = raidToDate.get(t.raid_id);
        if (!dateKey) continue;
        let agg = byDay.get(dateKey);
        if (!agg) { agg = { raids: new Set(), attendeeTicks: new Map() }; byDay.set(dateKey, agg); }
        agg.raids.add(t.raid_id);
        for (const name of (t.attendees || [])) {
          agg.attendeeTicks.set(name, (agg.attendeeTicks.get(name) || 0) + 1);
        }
      }
      for (const [date, agg] of byDay.entries()) {
        const top = [...agg.attendeeTicks.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, ticks]) => ({ name, ticks }));
        attendance.set(date, {
          date,
          raid_count: agg.raids.size,
          unique_attendees: agg.attendeeTicks.size,
          top_attendees: top,
        });
      }
    }

    return { rows: (encs as unknown as EncounterRow[]) ?? [], zones, loot, attendance, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], zones: new Map(), loot: new Map(), attendance: new Map(), error: msg };
  }
}

function resolveZone(enc: EncounterRow, zones: Map<string, ZoneRow>) {
  const short = enc.zone_short || enc.eqemu_npc_types?.zone_short || null;
  const long  = short ? zones.get(short)?.long_name : null;
  return { short, long: long || short || 'Unknown zone' };
}

function toCardData(enc: EncounterRow): KillCardData {
  const players = [...(enc.encounter_players ?? [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return {
    id: enc.id,
    started_at: enc.started_at,
    duration_sec: enc.duration_sec,
    total_damage: enc.total_damage,
    total_dps: enc.total_dps,
    boss_name: cleanBossName(enc.eqemu_npc_types?.name),
    player_count: players.length,
    classification: enc.classification,
    // ENGAGED: encounters with no ended_at are mid-fight — agent flushed a
    // partial parse but never saw a slain line for the boss. (Uilnayar
    // 2026-06-26: 'we registered vulaks death on engage instead of on
    // death … this should say engaged and be listed at the top'.)
    inProgress: enc.ended_at == null,
    top_players: players.slice(0, 5).map(p => ({
      character_name: p.character_name,
      total_damage: p.total_damage,
      dps: p.dps,
    })),
  };
}

// Inline admin strip rendered under each KillCard for officers — the four
// classification buttons + a clear-back-to-default. Compact so it doesn't
// dominate the card; uses the shared server actions so the listing + detail
// page stay in lockstep. Sits OUTSIDE the card's <Link> so form submits don't
// bubble into a page navigation.
function CardAdminBar({ encId, current }: { encId: string; current: string | null }) {
  const btn = (label: string, value: string, color: string) => (
    <form action={classifyEncounter}>
      <input type="hidden" name="id" value={encId} />
      <input type="hidden" name="classification" value={value} />
      <button
        type="submit"
        title={`Mark as ${label.toLowerCase()} — excluded from kill counts`}
        disabled={current === value}
        className={`px-1.5 py-0.5 rounded text-[10px] border ${color} ${current === value ? 'opacity-100 font-semibold' : 'opacity-70 hover:opacity-100'}`}
      >
        {label}
      </button>
    </form>
  );
  return (
    <div className="border-t border-border/60 px-2 py-1.5 flex items-center gap-1 flex-wrap">
      <span className="text-[9px] text-dim uppercase tracking-wide mr-1">admin</span>
      {btn('Wipe', 'wipe', 'border-orange/50 text-orange')}
      {btn('Live', 'live', 'border-blue/50   text-blue')}
      {btn('PvP',  'pvp',  'border-red/50    text-red')}
      {btn('Test', 'test', 'border-dim/50    text-dim')}
      {current && (
        <form action={clearClassification} className="ml-auto">
          <input type="hidden" name="id" value={encId} />
          <button
            type="submit"
            title="Clear classification — back to default (guild kill)"
            className="px-1.5 py-0.5 rounded text-[10px] border border-border text-text hover:bg-bg"
          >
            Clear
          </button>
        </form>
      )}
    </div>
  );
}

type ZoneBucket = { label: string; encounters: EncounterRow[] };
type DayBucket  = { label: string; zones: Map<string, ZoneBucket> };

function bucket(rows: EncounterRow[], zones: Map<string, ZoneRow>) {
  const days = new Map<string, DayBucket>();
  for (const enc of rows) {
    const dKey = dayKey(enc.started_at);
    if (!days.has(dKey)) days.set(dKey, { label: dayLabel(dKey), zones: new Map() });
    const day = days.get(dKey)!;
    const { short, long } = resolveZone(enc, zones);
    const zKey = short || '__unknown__';
    if (!day.zones.has(zKey)) day.zones.set(zKey, { label: long, encounters: [] });
    day.zones.get(zKey)!.encounters.push(enc);
  }
  // Within each zone, sort by KILL time (started_at + duration) ascending so we
  // render in true kill order. started_at alone is fight-START, which inverts
  // gated/overlapping fights — e.g. Emperor Ssraeshza is engaged before the
  // Blood add that gates its kill, so a start-sort wrongly lists it first even
  // though it died last.
  const killAtMs = (e: EncounterRow) =>
    new Date(e.started_at).getTime() + (e.duration_sec ?? 0) * 1000;
  for (const day of days.values()) {
    for (const z of day.zones.values()) {
      z.encounters.sort((a, b) => killAtMs(a) - killAtMs(b));
    }
  }
  return days;
}

function computeNightStats(day: DayBucket, dayDate: string): NightStats {
  const encs: EncounterRow[] = [];
  for (const z of day.zones.values()) encs.push(...z.encounters);
  const total_damage = encs.reduce((s, e) => s + (e.total_damage || 0), 0);
  const total_duration_sec = encs.reduce((s, e) => s + (e.duration_sec || 0), 0);
  // Top player by max damage in any single encounter (matches the displayed
  // ranking on the cards — gives the same "scoreboard #1" feel rather than
  // summing damage across the night which would dilute spike performances).
  let topPlayer: { name: string; damage: number } | null = null;
  for (const e of encs) {
    for (const p of e.encounter_players || []) {
      if (!topPlayer || p.total_damage > topPlayer.damage) {
        topPlayer = { name: p.character_name, damage: p.total_damage };
      }
    }
  }
  let longest: { boss: string; duration_sec: number } | null = null;
  for (const e of encs) {
    const d = e.duration_sec || 0;
    if (!longest || d > longest.duration_sec) {
      longest = { boss: cleanBossName(e.eqemu_npc_types?.name), duration_sec: d };
    }
  }
  return {
    date: dayDate,
    encounters: encs.length,
    total_damage,
    total_duration_sec,
    top_player: topPlayer,
    longest_fight: longest,
    deaths: 0, // populated client-side requires raw_parse pull; skipping for the index page
  };
}

export default async function ParsesPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/parses');
  const officer = await isOfficer(user.id);

  const { rows, zones, loot, attendance, error } = await loadAll();
  // In-progress encounters (ended_at null, last upload within 90min so we don't
  // surface stranded rows from old crashes forever). These render in their own
  // 'Engaged now' section at the top of the page. (Uilnayar 2026-06-26.)
  const NINETY_MIN_MS = 90 * 60 * 1000;
  const nowMs = Date.now();
  const engagedRows = rows.filter(r => {
    if (r.ended_at != null) return false;
    const startedMs = new Date(r.started_at).getTime();
    return (nowMs - startedMs) < NINETY_MIN_MS;
  });
  // Remove engaged rows from the day-bucketed list so they don't double up.
  const completedRows = rows.filter(r => !engagedRows.some(e => e.id === r.id));
  const days = bucket(completedRows, zones);
  const dayEntries = [...days.entries()];
  const headlineNight = dayEntries.length > 0 ? dayEntries[0] : null;

  return (
    <div className="space-y-6">
      {engagedRows.length > 0 && (
        <section className="bg-panel border border-orange/40 rounded-lg p-5">
          <h2 className="text-lg text-orange mb-3 flex items-center gap-2">
            <span aria-hidden>⚔️</span>
            <span>Engaged now</span>
            <span className="text-dim text-xs font-normal">· {engagedRows.length} in progress (no kill confirmed)</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {engagedRows.map(r => (
              <KillCard
                key={r.id}
                kill={toCardData(r)}
                adminBar={officer ? <CardAdminBar encId={r.id} current={r.classification} /> : undefined}
              />
            ))}
          </div>
          <p className="text-[10px] text-dim mt-2">
            These encounters show parses uploaded by an agent but the boss&apos;s slain line hasn&apos;t been
            observed yet — boss timers are not set. They&apos;ll move to the dated kill list automatically
            once a confirmed kill arrives, or drop out after 90 minutes of no further updates.
          </p>
        </section>
      )}

      {headlineNight && (
        <NightSummary stats={computeNightStats(headlineNight[1], headlineNight[0])} />
      )}

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📊 Boss Kills</h2>
        <p className="text-sm text-dim">
          Last {ROW_LIMIT} merged encounters, grouped by raid night and zone.
          Within each zone, kills are shown in the order they happened. Damage
          is the max-per-player merge across all parser uploads for the same
          kill. Click a card for the full breakdown. Loot blocks and attendance
          rollups come from OpenDKP, mirrored every 6h (or via{' '}
          <code>/syncopendkp</code>).
        </p>
      </section>

      {error && (
        <section className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
          Error: {error}
        </section>
      )}

      {!error && rows.length === 0 && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No encounters with damage recorded yet. Run <code>/parse</code> in Discord
          after a kill, or make sure the wolfpack-logsync agent is running.
        </section>
      )}

      {[...days.entries()].map(([dKey, day]) => {
        const nightLoot = loot.get(dKey) ?? [];
        const nightAttendance = attendance.get(dKey) ?? null;
        return (
          <section key={dKey} className="space-y-4">
            <div className="border-b border-border pb-1 flex items-baseline justify-between flex-wrap gap-2">
              <h3 className="text-lg text-blue">
                {day.label} <span className="text-dim text-xs">— {dKey}</span>
              </h3>
              {nightAttendance && (
                <div className="text-xs text-dim flex gap-3">
                  <span>{nightAttendance.raid_count} OpenDKP raid{nightAttendance.raid_count === 1 ? '' : 's'}</span>
                  <span>{nightAttendance.unique_attendees} attendee{nightAttendance.unique_attendees === 1 ? '' : 's'}</span>
                </div>
              )}
            </div>

            {[...day.zones.entries()].map(([zKey, zone]) => {
              // Kill count + total damage excludes classified rows (wipes,
              // Live, PvP, test) — they're still rendered (with their chip +
              // dimmed) so the night's full history is visible, but they
              // don't pollute the "we killed N bosses" headline. Showing the
              // excluded count parenthetically so the math is transparent.
              const kills    = zone.encounters.filter(e => !e.classification);
              const excluded = zone.encounters.length - kills.length;
              const killDamage = kills.reduce((s, e) => s + e.total_damage, 0);
              return (
                <div key={zKey} className="space-y-2">
                  <h4 className="text-sm text-orange flex items-center gap-2">
                    <span aria-hidden>📍</span>
                    <span>{zone.label}</span>
                    <span className="text-dim text-xs">
                      · {kills.length} kill{kills.length === 1 ? '' : 's'}
                      {kills.length > 1 && <span> · {fmtDmg(killDamage)} total</span>}
                      {excluded > 0 && (
                        <span title="Wipes / Live / PvP / Test pulls — not counted as guild kills">
                          {' '}· +{excluded} other
                        </span>
                      )}
                    </span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {zone.encounters.map((enc) => (
                      <KillCard
                        key={enc.id}
                        kill={toCardData(enc)}
                        adminBar={officer ? <CardAdminBar encId={enc.id} current={enc.classification} /> : null}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {nightLoot.length > 0 && (
              <LootBlock loot={nightLoot as LootRow[]} />
            )}
          </section>
        );
      })}
    </div>
  );
}
