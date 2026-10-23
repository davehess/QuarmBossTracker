// The recorded per-minute roster (raid_track_minutes.data -> who, as opaque keys), read incrementally and kept in this
// process. Shared by the live timeline's start (lib/liveRaidLoad.ts) and the session list's raid-change split
// (lib/raidCuts.ts), so one cold instance reads a minute once.
//
// COST: `data` is ~25 KB a minute at a full raid. A minute older than two is immutable, so its roster is kept (a few
// hundred bytes of keys); only minutes not seen before are read, 30 rows a page, ordered on the unique minute. The
// newest two minutes can still grow and are used but not kept. A minute with no usable roster is kept as empty so it
// is never asked for twice. The cache holds at most MAX_KEPT minutes, oldest dropped first.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { MINUTE_MS } from './raidReplay';
import { whoSeries, type WhoMinute } from './raidSplit';

const SETTLED_MS = 2 * MINUTE_MS;
const PAGE = 30;
const MAX_KEPT = 4000;

type DataRow = { minute_at: string; data: string };

const kept = new Map<number, WhoMinute>();

/** The roster of each recorded minute in `times` (epoch ms of minute starts), oldest first. */
export async function readWhoMinutes(sb: SupabaseClient, times: readonly number[], nowMs: number): Promise<WhoMinute[]> {
  const missing = times.filter(t => Number.isFinite(t) && !kept.has(t));
  let tail: WhoMinute[] = [];
  if (missing.length) {
    const lo = new Date(Math.min(...missing)).toISOString();
    const hi = new Date(Math.max(...missing) + MINUTE_MS).toISOString();
    const rows = await selectAll<DataRow>((from, to) => sb.from('raid_track_minutes')
      .select('minute_at, data')
      .eq('guild_id', GUILD_TAG)
      .gte('minute_at', lo).lt('minute_at', hi)
      .order('minute_at')
      .range(from, to), { page: PAGE });
    const got = new Map(whoSeries(rows).map(w => [w.t, w]));
    // A settled minute is kept even when it has no usable roster (as an empty one), so it is never asked for again.
    for (const t of missing) if (t + SETTLED_MS < nowMs) kept.set(t, got.get(t) ?? { t, who: [] });
    tail = [...got.values()].filter(w => w.t + SETTLED_MS >= nowMs);
    if (kept.size > MAX_KEPT) {
      for (const t of [...kept.keys()].sort((a, b) => a - b).slice(0, kept.size - MAX_KEPT)) kept.delete(t);
    }
  }
  const out: WhoMinute[] = [];
  const tailBy = new Map(tail.map(w => [w.t, w]));
  for (const t of times) {
    const w = kept.get(t) ?? tailBy.get(t);
    if (w) out.push(w);
  }
  return out.sort((a, b) => a.t - b.t);
}
