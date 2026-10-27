// The reads behind the live raid timeline's "which raid is this?" (beta preview ?v=newraid; the decision itself is
// web/lib/liveRaidWindow.ts). Server-side, service-role client, called by /api/spectator/timeline after its sign-in check.
//
// COST, on purpose. Deciding needs two kinds of recorded minute data:
//   * a LIGHT read of the last six hours (minute_at, zones: a few KB in all), every time, for the zone rule and for
//     the previous raid's window;
//   * the roster (`data`, ~25 KB a minute at a full raid) only when no manual cut is in force, and only for minutes
//     this process has not read before (lib/raidWho.ts keeps them). The first read in a cold instance pays for the
//     six hours once.
// Every read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js). The finished answer is kept 10 s.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { MIN_SIDE_MINUTES, type WhoMinute } from '@/lib/raidSplit';
import { loadTimelineKills, type TimelineKill } from '@/lib/raidTimelineLoad';
import { readWhoMinutes } from '@/lib/raidWho';
import {
  LOOKBACK_MS, chooseLiveStart, cutKey, earlierWindow, manualStart, parseCut, type LiveWhy, type ZoneMinute,
} from '@/lib/liveRaidWindow';

export type LiveTimeline = {
  now: number;
  kills: TimelineKill[];
  /** Where this raid starts (epoch ms), or null when the whole six hours is shown. */
  from: number | null;
  why: LiveWhy | null;
  /** The recorded stretch before `from`, for the session review link. */
  earlier: { from: number; to: number } | null;
  /** The manual cut in force (epoch ms), for the Undo button. */
  cut: number | null;
};

const CACHE_MS = 10_000;

type LightRow = { minute_at: string; zones: string[] | null };

let memo: { at: number; body: LiveTimeline } | null = null;

/** Forget the kept answer (a cut was just set or cleared). */
export function dropLiveMemo() { memo = null; }

async function readCut(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb.from('bot_kv').select('value')
    .eq('guild_id', GUILD_TAG).eq('key', cutKey(GUILD_TAG)).limit(1).maybeSingle();
  if (error) return null;   // a failed read must not hide kills: no cut
  return parseCut((data as { value: unknown } | null)?.value);
}

export async function loadLiveTimeline(sb: SupabaseClient, nowMs: number): Promise<LiveTimeline> {
  if (memo && nowMs - memo.at < CACHE_MS) return { ...memo.body, now: Date.now() };
  const floorMs = nowMs - LOOKBACK_MS;
  const floorIso = new Date(floorMs).toISOString();

  const [kills, cutMs, light] = await Promise.all([
    loadTimelineKills(sb, floorIso, new Date(nowMs + 60_000).toISOString()),
    readCut(sb),
    selectAll<LightRow>((from, to) => sb.from('raid_track_minutes')
      .select('minute_at, zones')
      .eq('guild_id', GUILD_TAG)
      .gte('minute_at', floorIso)
      .order('minute_at')
      .range(from, to)),
  ]);

  const minuteTimes = light.map(r => Date.parse(r.minute_at)).filter(Number.isFinite);
  const manual = manualStart(cutMs, nowMs, floorMs) != null;
  let who: WhoMinute[] = [];
  if (!manual && minuteTimes.length >= 2 * MIN_SIDE_MINUTES) {
    try { who = await readWhoMinutes(sb, minuteTimes, nowMs); } catch { who = []; }   // no roster = no automatic cut
  }
  const zones: ZoneMinute[] = light.map(r => ({ t: Date.parse(r.minute_at), zones: r.zones ?? [] })).filter(z => Number.isFinite(z.t));
  const start = chooseLiveStart({ nowMs, cutMs, who, zones, killTimes: kills.map(k => k.at) });

  const body: LiveTimeline = {
    now: Date.now(),
    kills: start ? kills.filter(k => k.at >= start.startMs) : kills,
    from: start ? start.startMs : null,
    why: start ? start.why : null,
    earlier: null,
    cut: manual ? cutMs : null,
  };
  if (start) {
    const w = earlierWindow(minuteTimes, start.startMs);
    if (w) body.earlier = { from: w.fromMs, to: w.toMs };
  }
  memo = { at: nowMs, body };
  return body;
}
