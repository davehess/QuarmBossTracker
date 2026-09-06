// /raidhistory — every raid night, coloured by how full the raid was.
//
// Hitya, 2026-09-03: "give us a /raidhistory page as well that contains each
// night and this view with a scale from red at half raiders to green full
// raiders, orange middle of the way."
//
// Two views of the same nights: the heatmap (one cell per night, colour = how
// full) and, below it, the list — date, raid name, raiders, fill — newest
// first, each linking to that night's review. Member-gated like /raid/review:
// a signed-in session already passed the guild + role checks.
//
// "Full" is the guild's own raid target: the 60-man row set in raid_targets
// (edited on /admin/attendance), summed. It is 60 today; if that table is ever
// empty the page falls back to 60 rather than to nothing. `?full=` overrides
// it for a what-if read, `?weeks=` widens the window. Neither writes anything.
//
// Only OFFICIAL raid nights (Hitya, 2026-09-04: "it should just be our raid
// days"): bonus rows are dropped and a raid's night is the date in its name
// (lib/raidHeatmap: isOfficialRaid, raidNightKey). Nights are drawn as month
// blocks of day chips, each chip carrying the raider count.
//
// Reads: raids in the window, then their ticks WITH attendee arrays, because
// the per-night raider count is a distinct union across every tick of every
// raid that night. That is the one wide read on this page (~150 raids × 4
// ticks × ~50 names for a year) and it is paged, not `.limit()`ed — the
// 1000-row cap would silently drop the newest quarter.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { dayKey, dayLabel, RAID_TZ } from '@/lib/format';
import { zonedDayRangeUtc } from '@/lib/raidReview';
import {
  windowStart, buildNights, nightNames, nightLabel, monthKey,
  fillColor, pct, DEFAULT_FULL_RAID, FILL_RED, FILL_ORANGE, FILL_GREEN,
  type Night, type NightRaid, type NightTick,
} from '@/lib/raidHeatmap';
import RaidHeatmap, { type NightChip } from '@/components/RaidHeatmap';
import RaidNightsStrips, { type StripNight } from '@/components/RaidNightsStrips';
import RaidLayoutPicker from '@/components/RaidLayoutPicker';
import { cookies } from 'next/headers';
import { pickRaidLayout, RAID_LAYOUT_COOKIE } from '@/lib/raidLayout';

// Two layouts, member's choice (Hitya, 2026-09-04, after the beta side-by-side:
// "I like blocks and strips, let's keep both as options, default to strips").
// The choice lives in the wp_raid_layout cookie; ?layout= overrides it for a
// shared link. lib/raidLayout.ts decides; RaidLayoutPicker writes the cookie.

export const dynamic = 'force-dynamic';

const DEFAULT_WEEKS = 52;
const MIN_WEEKS = 4;
const MAX_WEEKS = 156;

async function loadFullRaid(): Promise<number> {
  const { data } = await supabaseAdmin()
    .from('raid_targets')
    .select('target')
    .eq('guild_id', 'wolfpack')
    .eq('raid_size', '60-man');
  const sum = ((data ?? []) as { target: number | null }[]).reduce((s, r) => s + (Number(r.target) || 0), 0);
  return sum > 0 ? sum : DEFAULT_FULL_RAID;
}

async function loadNights(sinceIso: string): Promise<Map<string, Night>> {
  const admin = supabaseAdmin();
  const raids = await selectAll<NightRaid>((from, to) => admin
    .from('opendkp_raids')
    .select('raid_id, ts, name')
    .gte('ts', sinceIso)
    .order('raid_id')
    .range(from, to));
  if (raids.length === 0) return new Map();
  // Empty attendee arrays are sync gaps, not empty raids — dropped below
  // exactly as /admin/attendance drops them, so nobody is "missing" from a
  // tick we failed to capture. The arrays are needed anyway for the distinct
  // count, so the filter is done here rather than as a server-side predicate.
  const ticks = await selectAll<NightTick>((from, to) => admin
    .from('opendkp_ticks')
    .select('raid_id, tick_id, attendees')
    .in('raid_id', raids.map(r => r.raid_id))
    .order('tick_id')
    .range(from, to));
  return buildNights(raids, ticks.filter(t => Array.isArray(t.attendees) && t.attendees.length > 0));
}

function clampInt(raw: string | undefined, lo: number, hi: number, dflt: number): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

export default async function RaidHistoryPage({ searchParams }: { searchParams: Promise<{ weeks?: string; full?: string; layout?: string }> }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raidhistory');

  const sp = await searchParams;
  const weeksN = clampInt(sp.weeks, MIN_WEEKS, MAX_WEEKS, DEFAULT_WEEKS);
  const fullOverride = clampInt(sp.full, 1, 200, 0);
  const layout = pickRaidLayout(sp.layout, (await cookies()).get(RAID_LAYOUT_COOKIE)?.value);

  const todayKey = dayKey(new Date().toISOString(), RAID_TZ);
  const startKey = windowStart(todayKey, weeksN * 7);
  const { startIso } = zonedDayRangeUtc(startKey, RAID_TZ);

  const [nights, fullFromTargets] = await Promise.all([loadNights(startIso), loadFullRaid()]);
  const full = fullOverride > 0 ? fullOverride : fullFromTargets;

  // Only nights that have a captured tick count as held — a raid row with no
  // valid ticks is a sync gap, and colouring it red would be a lie.
  const held = [...nights.values()]
    .filter(n => n.tickIds.length > 0 && n.date >= startKey)
    .sort((a, b) => b.date.localeCompare(a.date));

  const chips: NightChip[] = held.map(n => {
    const raiders = n.attendees.length;
    return {
      date: n.date,
      color: fillColor(raiders / full),
      sub: String(raiders),
      lines: [nightLabel(n.date), ...nightNames(n), `${raiders} / ${full} raiders · ${pct(raiders, full)}%`],
      href: `/raid/review/${n.date}`,
    };
  });
  const strips: StripNight[] = held.map(n => ({
    date: n.date,
    color: fillColor(n.attendees.length / full),
    name: nightNames(n).join(' · ') || '(unnamed)',
    figure: String(n.attendees.length),
    href: `/raid/review/${n.date}`,
  }));
  // Per-month header: nights and the average raider count that month.
  const monthSummaries: Record<string, string> = {};
  {
    const byMonth = new Map<string, number[]>();
    for (const n of held) {
      const k = monthKey(n.date);
      byMonth.set(k, [...(byMonth.get(k) ?? []), n.attendees.length]);
    }
    for (const [k, xs] of byMonth) {
      const avg = Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
      monthSummaries[k] = `${xs.length} night${xs.length === 1 ? '' : 's'} · avg ${avg}`;
    }
  }

  const raiderCounts = held.map(n => n.attendees.length);
  const avg = raiderCounts.length ? Math.round(raiderCounts.reduce((s, x) => s + x, 0) / raiderCounts.length) : 0;
  const best = held.reduce<Night | null>((b, n) => (!b || n.attendees.length > b.attendees.length ? n : b), null);
  const fullNights = raiderCounts.filter(x => x >= full).length;
  const shortNights = raiderCounts.filter(x => x * 2 <= full).length;

  const halfN = Math.ceil(full / 2);
  const midN = Math.ceil(full * 0.75);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl text-gold">📈 Raid history</h1>
          <p className="text-sm text-dim mt-1">
            Every raid night in the last {Math.round(weeksN / 4.33)} months, coloured by how full the raid was, with the raider
            count on each night. Click a night for its review.
          </p>
        </div>
        <div className="text-xs text-dim flex items-center gap-3 flex-wrap">
          <span>Window:</span>
          {[26, 52, 104].map(w => (
            <Link key={w} href={`/raidhistory?weeks=${w}${fullOverride ? `&full=${fullOverride}` : ''}`}
                  className={w === weeksN ? 'text-text underline' : 'text-blue hover:underline'}>
              {w === 26 ? '6mo' : w === 52 ? '1yr' : '2yr'}
            </Link>
          ))}
          <span className="ml-2">Layout:</span>
          <RaidLayoutPicker current={layout} />
        </div>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <Stat label="Raid nights" value={String(held.length)} />
          <Stat label="Average raiders" value={String(avg)} sub={`of ${full}`} />
          <Stat label="Full nights" value={String(fullNights)} color="text-green" sub={`${full}+ raiders`} />
          <Stat label="Short nights" value={String(shortNights)} color="text-red" sub={`≤${halfN} raiders`} />
        </div>

        {held.length === 0 ? (
          <div className="bg-bg border border-dim/40 rounded p-4 text-sm text-dim">No raid ticks in this window yet.</div>
        ) : layout === 'strips' ? (
          <RaidNightsStrips nights={strips} label={`Raid nights by fullness, ${weeksN} weeks`} />
        ) : (
          <RaidHeatmap nights={chips} monthSummaries={monthSummaries}
                       label={`Raid nights by fullness, ${weeksN} weeks`} />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-dim">
          <span>Full raid = <span className="text-text">{full}</span>{fullOverride ? ' (override)' : ''}</span>
          <Swatch color={FILL_RED} label={`≤${halfN} · half`} />
          <Swatch color={FILL_ORANGE} label={`${midN} · midway`} />
          <Swatch color={FILL_GREEN} label={`${full}+ · full`} />
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[2px] bg-border/40" />no raid</span>
        </div>
        <p className="text-[11px] text-dim mt-2">
          Raiders = distinct characters in any attendance tick that night, so one person on two characters is one raider.
          The full-raid size is the 60-man target on <Link href="/admin/attendance" className="text-blue hover:underline">Attendance</Link>.
          {best && <> Best night: <Link href={`/raid/review/${best.date}`} className="text-blue hover:underline">{nightLabel(best.date)}</Link> with {best.attendees.length}.</>}
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-dim border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-normal">Night</th>
                <th className="text-left px-4 py-2 font-normal">Raid</th>
                <th className="text-right px-4 py-2 font-normal">Raiders</th>
                <th className="text-right px-4 py-2 font-normal">Fill</th>
                <th className="text-right px-4 py-2 font-normal">Ticks</th>
              </tr>
            </thead>
            <tbody>
              {held.map(n => {
                const raiders = n.attendees.length;
                const names = nightNames(n);
                return (
                  <tr key={n.date} className="border-b border-border/40 hover:bg-[#1c2128]">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/raid/review/${n.date}`} className="text-blue hover:underline">{dayLabel(n.date)}</Link>
                    </td>
                    <td className="px-4 py-2 text-text">
                      {names.length ? names.join(' · ') : <span className="text-dim">(unnamed)</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text">{raiders}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      <span className="inline-block h-2.5 w-2.5 rounded-[2px] mr-2 align-middle" style={{ backgroundColor: fillColor(raiders / full) }} />
                      <span className="text-text">{pct(raiders, full)}%</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-dim">{n.tickIds.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, color = 'text-text' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className="text-dim">{label}</div>
      <div className={`text-lg ${color} mt-0.5`}>{value}{sub && <span className="text-dim text-xs ml-1">{sub}</span>}</div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
