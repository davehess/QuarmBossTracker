// /spectator?v=b and ?v=c: the mobs the raid has been fighting, from what is recorded TODAY. The pure parts: no
// React, no Supabase, so the two variants, the hook and the tests share one copy of the rules.
//
// WHERE THE DATA COMES FROM
// raid_track_minutes rows (lib/raidReplay.ts decodeMinute) carry the mobs raiders had TARGETED: name, spawn id, where
// it stood, and HOW MANY raiders had it targeted at that sample. That is all of it. There is no mob HP, no death, no
// "who" (only a count), and a mob nobody targeted is not there. A boss's death comes from the encounters the bot
// recorded (/api/spectator/timeline), matched to a mob by name. Everything below is built to carry MORE when the
// raid-history streams land (mob sightings, HP on a 5-point change, deaths): `MobLane.hp` and `SpawnTrack.diedAt` are
// the slots, left empty today, and nothing here reads them.
//
// TWO WAYS TO LOOK AT THE SAME RECORD
//   dots     a mob as a point on the map at one instant   (sightingsAt)
//   lanes    a mob as a row on a time axis                (buildMobLanes)
// Twelve mobs can share one name, so a lane is per NAME (a swarm is one row, "12 spawns") and the spawns inside it are
// per spawn id; a spawn id alone is the identity of a single mob (the same rule as raidReplay targetKey).

import { MINUTE_MS, REPLAY_WINDOW_MS, frameIndexAt, majorityZone, type ReplayFrame, type ReplayTarget } from './raidReplay';
import { normMobName, displayMobName } from './replayBosses';
import type { Positions, Raider } from './spectator';

/** A boss death from /api/spectator/timeline (the shape RaidTimeline's Kill has, without its React-side extras). */
export type MobKill = { name: string; atMs: number };

/** A mob seen at one sample. `ageMs` is how long before the playhead it was last seen. */
export type MobDot = {
  key: string;           // lane key + spawn id: one mob
  lane: string;          // normMobName(name): the row it belongs to
  name: string;
  sid: number | null;
  x: number; y: number; z: number;   // server frame, as a Raider
  n: number;             // raiders that had it targeted
  zone: string | null;
  boss: boolean;
  dead: boolean;         // a boss whose kill has already happened at the playhead
  ageMs: number;
};

/** What the map is handed (SpectatorBoard's `mobs` prop). */
export type MobLayer = {
  dots: MobDot[];
  selected: string | null;                 // a lane key
  onPick: (d: MobDot | null) => void;
  focus?: { x: number; y: number; k: number } | null;   // centre the map here when `k` changes
};

export type SpawnTrack = {
  sid: number | null;
  first: number; last: number;           // epoch ms of the first and last sample that had it targeted
  peakN: number;
  x: number; y: number; z: number;       // where it was last seen
  zone: string | null;
  diedAt?: number;                        // reserved: the history streams' death record
};
export type LaneBucket = { t: number; spawns: number; n: number };   // bucket start, distinct spawns seen, most targeters
export type MobLane = {
  key: string;
  name: string;
  boss: boolean;                          // it has a recorded kill
  from: number; to: number;
  peakN: number;
  zone: string | null;
  spawns: SpawnTrack[];                   // first-seen order
  buckets: LaneBucket[];                  // oldest first, only buckets that had a sighting
  killedAt: number | null;
  hp?: { t: number; pct: number }[];      // reserved: the history streams' mob HP
};

export const BUCKET_MS = 30_000;
export const SIGHTING_MS = 30_000;       // a mob is "still there" this long after the last sample that had it
export const SIGHTING_STALE_MS = 5 * MINUTE_MS;   // at the live edge, mobs older than this are not shown at all
export const PULL_MIN_N = 3;             // a lane is a "pull" once this many raiders had it targeted
export const MAX_MARKERS = 14;
// A kill belongs to a lane when it lands inside the lane's span, give or take: the encounter row's ended_at and the
// last targeted sample are not the same clock.
const KILL_SLACK_BEFORE_MS = 90_000;
const KILL_SLACK_AFTER_MS = 5 * MINUTE_MS;

// ── asking the replay route for a live-ish window ───────────────────────────────

/** utils/raidNight.js nightKey: the instant pulled back 6 h, then MM/DD/YYYY in Eastern. */
export function nightKeyOf(ms: number): string {
  return new Date(ms - 6 * 3_600_000).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

/** [from, to) cut into route-sized windows (the route hands back at most REPLAY_WINDOW_MS), on minute edges. */
export function windowsBetween(fromMs: number, toMs: number, size = REPLAY_WINDOW_MS): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let a = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  const end = Math.ceil(toMs / MINUTE_MS) * MINUTE_MS;
  while (a < end) {
    out.push({ from: a, to: Math.min(a + size, end) });
    a += size;
  }
  return out;
}

/**
 * Where to start reading. The newest minute held may have been cut short and a minute row lands a little after the
 * minute ends, so the read re-covers REREAD_MS behind what it already has; the first read goes back `lookbackMs`.
 */
export const REREAD_MS = 3 * MINUTE_MS;
export function readFrom(now: number, lookbackMs: number, fetchedTo: number | null): number {
  const floor = Math.floor((now - lookbackMs) / MINUTE_MS) * MINUTE_MS;
  return fetchedTo == null ? floor : Math.max(floor, Math.floor((fetchedTo - REREAD_MS) / MINUTE_MS) * MINUTE_MS);
}

// ── dots: the mobs at one instant ───────────────────────────────────────────────

const bossSet = (kills: readonly MobKill[]) => new Set(kills.map(k => normMobName(k.name)));

/**
 * The mobs on the map at `t`: the latest sample of each spawn within SIGHTING_MS before it (a mob is targeted in some
 * frames and not others, so one frame alone would blink them). Newest sample wins its position. A boss with a kill at
 * or before `t` is marked dead.
 */
export function sightingsAt(frames: readonly ReplayFrame[], t: number, kills: readonly MobKill[] = [], windowMs = SIGHTING_MS): MobDot[] {
  const idx = frameIndexAt(frames, t);
  if (idx < 0) return [];
  const bosses = bossSet(kills);
  const out = new Map<string, MobDot>();
  for (let j = idx; j >= 0 && frames[j].t >= t - windowMs; j--) {
    for (const tg of frames[j].targets ?? []) {
      const lane = normMobName(tg.name);
      const key = `${lane}#${tg.sid ?? ''}`;
      if (out.has(key)) continue;
      const killed = kills.some(k => normMobName(k.name) === lane && k.atMs <= t && k.atMs >= frames[j].t - KILL_SLACK_BEFORE_MS);
      out.set(key, {
        key, lane, name: displayMobName(tg.name), sid: tg.sid, x: tg.x, y: tg.y, z: tg.z, n: tg.n, zone: tg.zone,
        boss: bosses.has(lane), dead: killed, ageMs: t - frames[j].t,
      });
    }
  }
  return [...out.values()];
}

/** At the live edge the "instant" is the newest recorded sample; null when the record is older than SIGHTING_STALE_MS. */
export function liveEdge(frames: readonly ReplayFrame[], now: number): number | null {
  const last = frames[frames.length - 1];
  return last && now - last.t <= SIGHTING_STALE_MS ? last.t : null;
}

// ── lanes: the mobs on a time axis ──────────────────────────────────────────────

/**
 * Frames -> one lane per mob NAME, with its spawns and a bucketed "how many, how hard" curve. `kills` mark a lane as a
 * boss and give it a death. Order: killed bosses by kill time, then the mobs the most raiders had targeted, then the
 * swarms with the most spawns; so the rows worth reading come first.
 */
export function buildMobLanes(frames: readonly ReplayFrame[], kills: readonly MobKill[] = [], bucketMs = BUCKET_MS): MobLane[] {
  type Acc = { name: string; spawns: Map<string, SpawnTrack>; buckets: Map<number, { sids: Set<string>; n: number }>; zone: string | null };
  const lanes = new Map<string, Acc>();
  for (const fr of frames) {
    for (const tg of fr.targets ?? []) {
      const key = normMobName(tg.name);
      if (!key) continue;
      let a = lanes.get(key);
      if (!a) lanes.set(key, a = { name: displayMobName(tg.name), spawns: new Map(), buckets: new Map(), zone: tg.zone });
      const sk = tg.sid != null ? String(tg.sid) : `name:${key}`;
      const sp = a.spawns.get(sk);
      if (sp) {
        sp.last = fr.t; sp.peakN = Math.max(sp.peakN, tg.n); sp.x = tg.x; sp.y = tg.y; sp.z = tg.z; sp.zone = tg.zone;
      } else {
        a.spawns.set(sk, { sid: tg.sid, first: fr.t, last: fr.t, peakN: tg.n, x: tg.x, y: tg.y, z: tg.z, zone: tg.zone });
      }
      const bt = Math.floor(fr.t / bucketMs) * bucketMs;
      let b = a.buckets.get(bt);
      if (!b) a.buckets.set(bt, b = { sids: new Set(), n: 0 });
      b.sids.add(sk);
      b.n = Math.max(b.n, tg.n);
      a.zone = tg.zone;
    }
  }
  const out: MobLane[] = [];
  for (const [key, a] of lanes) {
    const spawns = [...a.spawns.values()];
    const from = Math.min(...spawns.map(s => s.first));
    const to = Math.max(...spawns.map(s => s.last));
    const kill = kills
      .filter(k => normMobName(k.name) === key && k.atMs >= from - KILL_SLACK_BEFORE_MS && k.atMs <= to + KILL_SLACK_AFTER_MS)
      .sort((x, y) => x.atMs - y.atMs)[0];
    out.push({
      key, name: a.name, boss: !!kill, from, to, zone: a.zone,
      peakN: Math.max(...spawns.map(s => s.peakN)),
      spawns,
      buckets: [...a.buckets].sort((x, y) => x[0] - y[0]).map(([t, b]) => ({ t, spawns: b.sids.size, n: b.n })),
      killedAt: kill ? kill.atMs : null,
    });
  }
  return out.sort((x, y) =>
    Number(y.boss) - Number(x.boss)
    || (x.boss && y.boss ? (x.killedAt as number) - (y.killedAt as number) : 0)
    || y.peakN - x.peakN
    || y.spawns.length - x.spawns.length
    || x.from - y.from);
}

/** The time worth jumping to for a lane: a boss's last minute before its death, else the first moment it was heavily targeted, else its start. */
export function laneFocusTime(lane: MobLane): number {
  if (lane.killedAt != null) return Math.min(lane.killedAt, lane.to);
  const heavy = lane.buckets.find(b => b.n >= PULL_MIN_N);
  return heavy ? heavy.t : lane.from;
}

/** Where a lane's mob stood at `t` (the last sample of any of its spawns at or before it; else the first after). Null if the frames have none. */
export function lanePositionAt(frames: readonly ReplayFrame[], lane: string, t: number, sid?: number | null): ReplayTarget | null {
  const match = (tg: ReplayTarget) => normMobName(tg.name) === lane && (sid === undefined || tg.sid === sid);
  for (let j = frameIndexAt(frames, t); j >= 0; j--) {
    const hit = frames[j].targets?.find(match);
    if (hit) return hit;
  }
  for (let j = Math.max(0, frameIndexAt(frames, t) + 1); j < frames.length; j++) {
    const hit = frames[j].targets?.find(match);
    if (hit) return hit;
  }
  return null;
}

// ── markers: the moments worth a click ──────────────────────────────────────────

export type Marker = { t: number; kind: 'kill' | 'pull' | 'zone'; label: string; lane?: string };

/**
 * Kills (a boss died), pulls (a lane first reached PULL_MIN_N targeters) and zone moves (the raid's busiest zone
 * changed), oldest first. Pulls of a lane that also has a kill are dropped: the kill is the better handle. At most
 * MAX_MARKERS, keeping every kill, then the heaviest pulls, then zone moves.
 */
export function buildMarkers(frames: readonly ReplayFrame[], lanes: readonly MobLane[], kills: readonly MobKill[], from: number, to: number): Marker[] {
  const out: Marker[] = [];
  for (const k of kills) {
    if (k.atMs < from || k.atMs > to) continue;
    out.push({ t: k.atMs, kind: 'kill', label: displayMobName(k.name), lane: normMobName(k.name) });
  }
  const killed = new Set(out.map(m => m.lane));
  const pulls: (Marker & { n: number })[] = [];
  for (const l of lanes) {
    if (killed.has(l.key)) continue;
    const b = l.buckets.find(x => x.n >= PULL_MIN_N);
    if (b) pulls.push({ t: b.t, kind: 'pull', label: `${l.name}${l.spawns.length > 1 ? ` ×${l.spawns.length}` : ''}`, lane: l.key, n: l.peakN });
  }
  pulls.sort((a, b) => b.n - a.n);
  const zones: Marker[] = [];
  let prev: string | null = null;
  for (const fr of frames) {
    const z = majorityZone(fr);
    if (z && prev && z !== prev) zones.push({ t: fr.t, kind: 'zone', label: z });
    if (z) prev = z;
  }
  const room = Math.max(0, MAX_MARKERS - out.length);
  const keep = [...pulls.slice(0, Math.min(pulls.length, Math.max(0, room - Math.min(zones.length, 3)))), ...zones.slice(0, 3)].slice(0, room);
  return [...out, ...keep.map(({ t, kind, label, lane }) => ({ t, kind, label, lane }))].sort((a, b) => a.t - b.t);
}

// ── the recorded frame as the board's own feed ──────────────────────────────────

/**
 * A recorded frame -> the Positions the live board draws, so the SAME board shows a past moment. `zoneNames` maps a
 * short name to its long one where the live feed knows it. age_s is 0: a recorded sample is never "stale".
 */
export function framePositions(frame: ReplayFrame, zoneNames: ReadonlyMap<string, string> = new Map()): Positions {
  const raiders: Raider[] = [];
  let unplaced = 0;
  const counts = new Map<string, number>();
  for (const r of frame.raiders) {
    if (!r.zone) { unplaced++; continue; }
    counts.set(r.zone, (counts.get(r.zone) ?? 0) + 1);
    raiders.push({
      name: r.name, cls: r.cls, group: r.group, level: r.level, hp: r.hp, x: r.x, y: r.y, z: r.z,
      heading: r.h, zone: r.zone, age_s: 0,
    });
  }
  const zones = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([zone, count]) => ({ zone, name: zoneNames.get(zone) ?? zone, count }));
  return { at: new Date(frame.t).toISOString(), raiders, zones, unplaced };
}
