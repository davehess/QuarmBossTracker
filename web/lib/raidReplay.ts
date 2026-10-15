// /spectator/replay: the pure parts. No React, no Supabase, so the replay route, the board and the tests share
// one copy of the rules.
//
// WHERE THE DATA COMES FROM
// utils/raidTrack.js writes one raid_track_minutes row per UTC minute. Its `data` column is compact JSON text:
//   { v:1, step_s, who:[[name,cls,group,level],...], zones:['short',...],
//     f:[[dt, i,x,y,z,h,hp,zi, i,x,y,z,h,hp,zi, ...], ...] }
//   dt  whole seconds into the minute (0-59)
//   i   index into `who`, which is PER MINUTE (the same raider can be a different i in the next minute)
//   x,y loc_x and loc_y exactly as the roster received them, so they are the SERVER frame swapped:
//       decodeMinute applies serverXY so a decoded raider is in the same frame as lib/spectator.ts Raider
//   h   heading 0-512, or -1 when the agent did not send one
//   hp  whole percent, or -1 when unknown
//   zi  index into `zones`, or -1 when no zone could be worked out for that sample
// A frame can list fewer raiders than the raid holds: only those placed in an uploader's own zone.

import { serverXY } from './spectator';

export const REPLAY_WINDOW_MS = 15 * 60 * 1000;   // the most one request hands back
export const MINUTE_MS = 60 * 1000;
// Frames are step_s apart (3 s by default); a frame older than this is "no data" rather than "still standing".
export const FRAME_GAP_MS = 15 * 1000;
// Minutes missing for less than this are one stretch of the night; a longer silence is a break in the raid.
export const SPAN_GAP_MS = 2 * MINUTE_MS;
// A zone seen again within this is the same visit.
export const RUN_GAP_MS = 3 * MINUTE_MS;

export type MinuteRow = { minute_at: string; zones?: string[] | null; data: string };

export type ReplayRaider = {
  i: number;
  name: string;
  cls: string | null;
  group: number | null;
  level: number | null;
  x: number;              // server frame (already swapped, as Raider.x)
  y: number;
  z: number;
  h: number | null;       // heading 0-512
  hp: number | null;      // whole percent
  zone: string | null;    // eqemu_zone.short_name, null when the sample had none
};

export type ReplayFrame = { t: number; raiders: ReplayRaider[] };   // t: epoch ms

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * One minute row -> its frames, oldest first. Anything malformed (bad JSON, another version, a short frame)
 * is skipped, never thrown: one bad minute must not blank a night.
 */
export function decodeMinute(row: MinuteRow): ReplayFrame[] {
  const start = Date.parse(row.minute_at);
  if (!Number.isFinite(start)) return [];
  let d: { v?: unknown; who?: unknown; zones?: unknown; f?: unknown };
  try { d = JSON.parse(row.data); } catch { return []; }
  if (!d || d.v !== 1 || !Array.isArray(d.who) || !Array.isArray(d.f)) return [];
  const zones: unknown[] = Array.isArray(d.zones) ? d.zones : [];
  const who = d.who as unknown[];
  const frames: ReplayFrame[] = [];
  for (const fr of d.f) {
    if (!Array.isArray(fr) || !isNum(fr[0])) continue;
    const raiders: ReplayRaider[] = [];
    for (let k = 1; k + 6 < fr.length; k += 7) {
      const [i, rx, ry, z, h, hp, zi] = fr.slice(k, k + 7) as unknown[];
      if (!isNum(i) || !isNum(rx) || !isNum(ry)) continue;
      const w = who[i];
      if (!Array.isArray(w) || typeof w[0] !== 'string') continue;
      const { x, y } = serverXY(rx, ry);
      const zone = isNum(zi) && zi >= 0 && typeof zones[zi] === 'string' ? (zones[zi] as string) : null;
      raiders.push({
        i,
        name: w[0],
        cls: typeof w[1] === 'string' ? w[1] : null,
        group: isNum(w[2]) ? w[2] : null,
        level: isNum(w[3]) ? w[3] : null,
        x, y,
        z: isNum(z) ? z : 0,
        h: isNum(h) && h >= 0 ? h : null,
        hp: isNum(hp) && hp >= 0 ? hp : null,
        zone,
      });
    }
    if (raiders.length) frames.push({ t: start + fr[0] * 1000, raiders });
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

/** Several minute rows -> one time-ordered list of frames. */
export function decodeRows(rows: MinuteRow[]): ReplayFrame[] {
  return rows.flatMap(decodeMinute).sort((a, b) => a.t - b.t);
}

/** Head count per zone in one frame (raiders with no zone are not counted). */
export function zoneCounts(frame: ReplayFrame): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of frame.raiders) if (r.zone) m.set(r.zone, (m.get(r.zone) ?? 0) + 1);
  return m;
}

/** The zone with the most raiders in the frame; a tie goes to the name that sorts first. Null with none. */
export function majorityZone(frame: ReplayFrame): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [z, c] of zoneCounts(frame)) if (c > n || (c === n && best !== null && z < best)) { best = z; n = c; }
  return best;
}

/**
 * Auto-follow with a little stickiness: keep the zone being shown until another one holds more than half
 * again as many raiders, so two zones within a head of each other do not flip the map every frame.
 */
export function pickReplayZone(counts: Map<string, number>, current: string | null): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [z, c] of counts) if (c > n || (c === n && best !== null && z < best)) { best = z; n = c; }
  if (best === null) return null;
  const have = current ? counts.get(current) ?? 0 : 0;
  return current && have > 0 && n <= have * 1.5 ? current : best;
}

/** Index of the last frame at or before `t`, or -1 when `t` is before the first. `frames` must be sorted. */
export function frameIndexAt(frames: readonly ReplayFrame[], t: number): number {
  let lo = 0, hi = frames.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The frame in force at `t`: the last one at or before it, if it is no older than maxGapMs. Else null. */
export function frameAt(frames: readonly ReplayFrame[], t: number, maxGapMs = FRAME_GAP_MS): ReplayFrame | null {
  const i = frameIndexAt(frames, t);
  return i >= 0 && t - frames[i].t <= maxGapMs ? frames[i] : null;
}

// ── The night list ──────────────────────────────────────────────────────────

export type Span = { from: number; to: number };               // epoch ms, to exclusive
export type ZoneRun = { zone: string; from: number; to: number };
export type NightSummary = {
  night_key: string;
  first: string;                 // ISO, start of the first minute recorded
  last: string;                  // ISO, start of the last minute recorded
  minutes: number;
  zones: string[];               // in order of first visit
  runs: ZoneRun[];               // visit order
  spans: Span[];                 // stretches with data, so the scrubber can show (and skip) the breaks
};

export type NightMinute = { night_key: string | null; minute_at: string; zones?: string[] | null };

function mergeTimes(times: number[], gap: number): Span[] {
  const out: Span[] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - (last.to - MINUTE_MS) <= gap) last.to = t + MINUTE_MS;
    else out.push({ from: t, to: t + MINUTE_MS });
  }
  return out;
}

/** Minute rows (night_key, minute_at, zones) -> one summary per night, newest first. */
export function summarizeNights(rows: NightMinute[]): NightSummary[] {
  const by = new Map<string, { times: number[]; byZone: Map<string, number[]> }>();
  for (const r of rows) {
    const t = Date.parse(r.minute_at);
    if (!r.night_key || !Number.isFinite(t)) continue;
    let n = by.get(r.night_key);
    if (!n) by.set(r.night_key, n = { times: [], byZone: new Map() });
    n.times.push(t);
    for (const z of r.zones ?? []) {
      if (typeof z !== 'string' || !z) continue;
      const a = n.byZone.get(z);
      if (a) a.push(t); else n.byZone.set(z, [t]);
    }
  }
  const out: NightSummary[] = [];
  for (const [key, n] of by) {
    n.times.sort((a, b) => a - b);
    const runs: ZoneRun[] = [];
    for (const [zone, ts] of n.byZone) {
      ts.sort((a, b) => a - b);
      for (const s of mergeTimes(ts, RUN_GAP_MS)) runs.push({ zone, from: s.from, to: s.to });
    }
    runs.sort((a, b) => a.from - b.from || a.zone.localeCompare(b.zone));
    const zones: string[] = [];
    for (const r of runs) if (!zones.includes(r.zone)) zones.push(r.zone);
    out.push({
      night_key: key,
      first: new Date(n.times[0]).toISOString(),
      last: new Date(n.times[n.times.length - 1]).toISOString(),
      minutes: n.times.length,
      zones, runs,
      spans: mergeTimes(n.times, SPAN_GAP_MS),
    });
  }
  return out.sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
}

/** Is `t` inside a span with data? When not, the start of the next span (or null past the last one). */
export function nextSpanStart(spans: readonly Span[], t: number): { inside: boolean; next: number | null } {
  for (const s of spans) {
    if (t >= s.from && t < s.to) return { inside: true, next: null };
    if (t < s.from) return { inside: false, next: s.from };
  }
  return { inside: false, next: null };
}

/** Which 15-minute window of a night holds `t` (0 = the first), counted from the night's first minute. */
export function windowIndex(nightStartMs: number, t: number): number {
  return Math.max(0, Math.floor((t - nightStartMs) / REPLAY_WINDOW_MS));
}
