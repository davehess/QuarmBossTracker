// Where the LIVE raid timeline on /spectator starts (beta preview ?v=newraid; the guild lead, 2026-10-23: a guest
// raid's kill sat on the same timeline as Wolf Pack's own, "this needs to be a new raid for midnight and on").
// Until now the live strip showed every curated kill of the last six hours, so a second group that took over the
// zone after the first one finished was drawn as the same raid, with "since last death" counting from its first kill
// off the previous raid's last.
//
// Pure (no React, no Supabase, no clock): lib/liveRaidLoad.ts reads, this file decides, the tests drive it.
//
// THE START, in order of authority:
//   1. A MANUAL CUT. An officer pressed "Start a new raid now"; the time is stored in bot_kv `live_raid_cut:<guild>`.
//      It wins over everything while it is under 12 hours old, and is ignored once it is older (a forgotten cut must
//      not hide a later night) or in the future. A cut older than the six-hour window changes nothing.
//   2. THE ROSTER. detectRaidChange (lib/raidSplit.ts) over the recorded per-minute rosters of the last six hours:
//      the roster after some minute is mostly different people from the roster before it. It is run again over what
//      follows each cut, so with three groups in a night the LATEST hand-over wins.
//   3. THE ZONE, a weaker signal that only counts when the crew test agrees. The raid moved to a different zone
//      (the minute's only zone, held for 10 minutes), no boss died across the change for 20 minutes (the gap from the
//      last kill before it to the first kill after it, or to now), AND fewer than 60% of the 20 minutes' regulars
//      before it were also regulars after it. The same crew walking on to the next zone after a break is one raid:
//      their kills stay. Not enough recorded minutes to say = no cut.
// When none of them speaks the window is the whole six hours, as before. Wrongly hiding a real raid's kills is the
// failure to avoid, so every automatic rule needs two stretches of recorded roster and says nothing without them.
import { MINUTE_MS, SESSION_GAP_MS } from './raidReplay';
import { MIN_REGULARS, REGULAR_SHARE, detectRaidChange, type WhoMinute } from './raidSplit';

export const LOOKBACK_MS = 6 * 60 * MINUTE_MS;
export const CUT_TTL_MS = 12 * 60 * MINUTE_MS;
export const ZONE_QUIET_MS = 20 * MINUTE_MS;       // no boss died across a zone change for this long
export const ZONE_SUSTAIN_MS = 10 * MINUTE_MS;     // a zone counts once the raid has stayed in it this long
export const CREW_MINUTES = 20;                    // each side of a zone change is judged on this many minutes
export const SAME_CREW = 0.6;                      // this share of the smaller side's regulars on both sides = same crew

export type LiveWhy = 'manual' | 'roster' | 'zone';
export type LiveStart = { startMs: number; why: LiveWhy } | null;
export type ZoneMinute = { t: number; zones: readonly string[] };

export const cutKey = (guild: string) => `live_raid_cut:${guild}`;

/** The stored bot_kv value ({ v: 1, at: ISO }) -> the cut instant, or null for anything else. */
export function parseCut(value: unknown): number | null {
  const at = value && typeof value === 'object' ? (value as { at?: unknown }).at : null;
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The manual cut as a window start: only while it is under 12 h old, not in the future, and inside the lookback. */
export function manualStart(cutMs: number | null, nowMs: number, floorMs: number): number | null {
  if (cutMs == null || cutMs > nowMs + MINUTE_MS || nowMs - cutMs >= CUT_TTL_MS) return null;
  return cutMs > floorMs ? cutMs : null;
}

/**
 * EVERY hand-over in the roster series, oldest first: the best cut, then the same question asked of each side. Also the
 * cuts the session lists split on (lib/raidCuts.ts), so the live timeline and the lists agree on where a raid changes.
 */
export function rosterCuts(who: readonly WhoMinute[], depth = 0): number[] {
  const ch = depth < 8 ? detectRaidChange(who) : null;
  if (!ch) return [];
  return [
    ...rosterCuts(who.filter(m => m.t < ch.atMs), depth + 1),
    ch.atMs,
    ...rosterCuts(who.filter(m => m.t >= ch.atMs), depth + 1),
  ];
}

/** The latest hand-over in the roster series (see the header). */
export function rosterStart(who: readonly WhoMinute[]): number | null {
  const c = rosterCuts(who);
  return c.length ? c[c.length - 1] : null;
}

type Run = { zone: string; from: number; to: number };

/** Sustained single-zone stretches, oldest first; a zone left for a short bounce and returned to is one stretch. */
function zoneRuns(zones: readonly ZoneMinute[]): Run[] {
  const raw: Run[] = [];
  for (const m of [...zones].sort((a, b) => a.t - b.t)) {
    if (m.zones.length !== 1) continue;
    const last = raw[raw.length - 1];
    if (last && last.zone === m.zones[0]) last.to = m.t + MINUTE_MS;
    else raw.push({ zone: m.zones[0], from: m.t, to: m.t + MINUTE_MS });
  }
  const out: Run[] = [];
  for (const r of raw.filter(x => x.to - x.from >= ZONE_SUSTAIN_MS)) {
    const last = out[out.length - 1];
    if (last && last.zone === r.zone) last.to = r.to;
    else out.push({ ...r });
  }
  return out;
}

/** Share of the smaller side's regulars (the 20 minutes before / after `atMs`) that are regulars of both; null when unknowable. */
export function crewShared(who: readonly WhoMinute[], atMs: number): number | null {
  const side = (lo: number, hi: number) => {
    const rows = who.filter(m => m.t >= lo && m.t < hi && m.who.length);
    if (rows.length < CREW_MINUTES / 2) return null;
    const seen = new Map<string, number>();
    for (const r of rows) for (const k of new Set(r.who)) seen.set(k, (seen.get(k) ?? 0) + 1);
    const need = Math.max(1, Math.ceil(REGULAR_SHARE * rows.length));
    const regs = new Set<string>();
    for (const [k, n] of seen) if (n >= need) regs.add(k);
    return regs;
  };
  const a = side(atMs - CREW_MINUTES * MINUTE_MS, atMs), b = side(atMs, atMs + CREW_MINUTES * MINUTE_MS);
  if (!a || !b || a.size < MIN_REGULARS || b.size < MIN_REGULARS) return null;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return both / Math.min(a.size, b.size);
}

/** The latest zone change that passes the three tests in the header, or null. */
export function zoneStart(zones: readonly ZoneMinute[], who: readonly WhoMinute[], killTimes: readonly number[], nowMs: number): number | null {
  const runs = zoneRuns(zones);
  for (let i = runs.length - 1; i >= 1; i--) {
    const at = runs[i].from;
    const before = killTimes.filter(k => k < at);
    if (!before.length) continue;   // nothing earlier to hide
    const lastBefore = Math.max(...before);
    const after = killTimes.filter(k => k >= at);
    const firstAfter = after.length ? Math.min(...after) : nowMs;
    if (firstAfter - lastBefore < ZONE_QUIET_MS) continue;
    const shared = crewShared(who, at);
    if (shared !== null && shared < SAME_CREW) return at;
  }
  return null;
}

/** The recorded stretch just before `startMs` (minutes no more than SESSION_GAP_MS apart), as a review window; null when none. */
export function earlierWindow(minuteTimes: readonly number[], startMs: number): { fromMs: number; toMs: number } | null {
  const ts = minuteTimes.filter(t => t < startMs).sort((a, b) => a - b);
  if (!ts.length) return null;
  let i = ts.length - 1;
  while (i > 0 && ts[i] - ts[i - 1] <= SESSION_GAP_MS) i--;
  const fromMs = ts[i];
  return startMs - fromMs >= 2 * MINUTE_MS ? { fromMs, toMs: startMs } : null;
}

export type ChooseInput = {
  nowMs: number;
  cutMs: number | null;
  who: readonly WhoMinute[];
  zones: readonly ZoneMinute[];
  killTimes: readonly number[];
};

/** Where the live timeline starts: a valid manual cut, else the later of the roster and zone starts, else null (all six hours). */
export function chooseLiveStart(i: ChooseInput): LiveStart {
  const floorMs = i.nowMs - LOOKBACK_MS;
  const m = manualStart(i.cutMs, i.nowMs, floorMs);
  if (m != null) return { startMs: m, why: 'manual' };
  const r = rosterStart(i.who);
  const z = zoneStart(i.zones, i.who, i.killTimes, i.nowMs);
  const pick = (ms: number | null) => (ms != null && ms > floorMs ? ms : null);
  const rs = pick(r), zs = pick(z);
  if (rs == null && zs == null) return null;
  return zs != null && (rs == null || zs > rs) ? { startMs: zs, why: 'zone' } : { startMs: rs as number, why: 'roster' };
}
