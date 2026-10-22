// /raid/routes: the pure parts. No React, no Supabase, so the API route, the page and the tests share one copy
// of the rules.
//
// WHAT IT DOES
//   Every recorded night in a zone becomes a CENTROID PATH (the median position of the raiders placed in that zone,
//   frame by frame). The night's clock starts at FIRST ENGAGE, the first encounter of any mob (trash included)
//   in the zone, not at zone-in: pre-clearing changes how long the walk to the first named takes, and the guild
//   lead wants nights compared from the first pull (2026-10-21: "Time is based on first engage, precleaning makes
//   a difference.").
//   Legs are cut at the named kills (curated bosses): first engage -> named 1 -> named 2 ... Each leg of each
//   night is resampled by DISTANCE to LEG_POINTS points and the nights are averaged point by point, which lines
//   the nights up by how far along the route they are, not by when they got there.
//   The CLEARING of a leg is the trash killed in it: how many, how long (first trash pull to last trash death)
//   and which spawn points, each trash kill placed at the spawn point of its npc nearest the raid centre.
//
// FRAME: everything is the SERVER frame (the same axes as eqemu_spawn2 and a decoded replay raider). The page
// negates both axes to draw north up, as the rest of the site does (toScreen in lib/spectator.ts).

import type { ReplayFrame } from './raidReplay';

export const MIN_RAIDERS = 8;               // a frame with fewer placed raiders is not "the raid"
export const LEG_POINTS = 50;               // each leg is resampled to this many points before nights are averaged
export const NIGHT_PATH_POINTS = 300;       // the most points one night's path sends to the browser
export const PRECLEAR_MS = 4 * 60 * 1000;   // first named dead within this of first engage: the zone was cleared earlier
export const MAX_TRACK_GAP_MS = 2 * 60 * 1000;   // a leg with a hole in its track longer than this has no path
export const BOUNDS_SLACK = 0.08;           // of the zone's span: raiders further outside the walls than this are stale coordinates
export const MIN_NIGHT_MINUTES = 5;         // a zone-night shorter than this is not listed
export const SESSION_GAP_MS = 45 * 60 * 1000;   // zone minutes this far apart are different visits

export type Pt = { x: number; y: number };
export type CPoint = Pt & { t: number; n: number };
export type Box = { minX: number; maxX: number; minY: number; maxY: number };

/** One encounter in the zone (classification null already). `ended` null = never confirmed dead. */
export type Enc = { id: number; npc_id: number; name: string; started: number; ended: number | null };

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── centroid path ─────────────────────────────────────────────────────────────

/**
 * Decoded frames -> the raid centre over time in `zone`. A raider counts when the recorder placed them in the zone
 * (and, when the walls' box is known, when they stand within BOUNDS_SLACK of it: the first frames after a zone-in
 * can carry the previous zone's coordinates). Frames with fewer than MIN_RAIDERS are dropped. Median, so a
 * straggler or a stale coordinate cannot drag the centre.
 */
export function centroidSeries(frames: readonly ReplayFrame[], zone: string, bounds?: Box | null): CPoint[] {
  const out: CPoint[] = [];
  let lo: Box | null = null;
  if (bounds) {
    const sx = (bounds.maxX - bounds.minX) * BOUNDS_SLACK, sy = (bounds.maxY - bounds.minY) * BOUNDS_SLACK;
    lo = { minX: bounds.minX - sx, maxX: bounds.maxX + sx, minY: bounds.minY - sy, maxY: bounds.maxY + sy };
  }
  for (const f of frames) {
    const xs: number[] = [], ys: number[] = [];
    for (const r of f.raiders) {
      if (r.zone !== zone || !fin(r.x) || !fin(r.y)) continue;
      if (r.x === 0 && r.y === 0) continue;
      if (lo && (r.x < lo.minX || r.x > lo.maxX || r.y < lo.minY || r.y > lo.maxY)) continue;
      xs.push(r.x); ys.push(r.y);
    }
    if (xs.length < MIN_RAIDERS) continue;
    out.push({ t: f.t, x: median(xs) as number, y: median(ys) as number, n: xs.length });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The centre at time `t`, interpolated between the two samples around it. Null when `t` is outside the track or in a hole. */
export function centreAt(series: readonly CPoint[], t: number, maxGap = MAX_TRACK_GAP_MS): Pt | null {
  if (!series.length || t < series[0].t - 1000 || t > series[series.length - 1].t + 1000) return null;
  let lo = 0, hi = series.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (series[mid].t <= t) lo = mid; else hi = mid - 1; }
  const a = series[lo], b = series[Math.min(lo + 1, series.length - 1)];
  if (b.t === a.t) return { x: a.x, y: a.y };
  if (b.t - a.t > maxGap) return t - a.t <= maxGap / 2 ? { x: a.x, y: a.y } : t >= b.t ? { x: b.x, y: b.y } : null;
  const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * The track between two instants: the interpolated start, every sample strictly inside, the interpolated end.
 * Null when the track has a hole longer than maxGap in it, or does not cover both ends, or is a single point.
 */
export function legTrack(series: readonly CPoint[], a: number, b: number, maxGap = MAX_TRACK_GAP_MS): Pt[] | null {
  if (!(b > a)) return null;
  const pa = centreAt(series, a, maxGap), pb = centreAt(series, b, maxGap);
  if (!pa || !pb) return null;
  const inside = series.filter(p => p.t > a && p.t < b);
  const times = [a, ...inside.map(p => p.t), b];
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > maxGap) return null;
  const pts: Pt[] = [pa, ...inside.map(p => ({ x: p.x, y: p.y })), pb];
  return pts.length >= 2 ? pts : null;
}

/** A polyline -> `n` points evenly spaced along its length. A path with no length comes back as `n` copies of its point. */
export function resampleByDistance(pts: readonly Pt[], n: number): Pt[] {
  if (!pts.length) return [];
  if (pts.length === 1 || n < 2) return Array.from({ length: Math.max(1, n) }, () => ({ x: pts[0].x, y: pts[0].y }));
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = d[d.length - 1];
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < pts.length - 1 && d[j] < target) j++;
    const a = pts[j - 1], b = pts[j], seg = d[j] - d[j - 1];
    const f = seg > 0 ? Math.min(1, Math.max(0, (target - d[j - 1]) / seg)) : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

export const pathLength = (pts: readonly Pt[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
};

// ── a night ───────────────────────────────────────────────────────────────────

export type Kill = { npc_id: number; name: string; start: number; end: number };
export type NightFlag = 'precleared' | 'no-named' | 'short-track';

export type NightTrack = {
  key: string;
  from: number; to: number;          // the visit's span, epoch ms
  zoneIn: number | null;             // first usable frame
  firstEngage: number | null;        // first encounter of ANY mob in the zone, epoch ms
  series: CPoint[];
  named: Kill[];                     // first confirmed kill of each curated boss, by time
  trash: Kill[];                     // every other confirmed kill, by time
  preTrash: number;                  // trash killed before the first named kill started
  preMinutes: number | null;         // zone-in to the first named kill's start, minutes
  engageToNamedS: number | null;     // first engage to the first named kill's death, seconds
  flags: NightFlag[];
};

/**
 * A zone whose ENCOUNTER ROWS name one fight by another's id. `encounters` is written by name, so a brother killed at the
 * event is stored under his HOME id; the raid's position at the kill tells the two apart. A kill of `from` whose raid
 * centre is inside `box` is the event one: it becomes `to` / `name`, is always named, and keeps its LAST row (the event
 * brothers reset and re-engage, so an early short row is not the death). Data, not code: a zone with no entry is untouched.
 *
 * Plane of Tactics (zone 214): home Tallon 214026 and Vallon 214316 stand in the wings (|y| about 2000); the Rallos event
 * spawns Tallon 214313 and Vallon 214320 (potactics/encounters/Rallos.lua:287-289 @ SecretsOTheP/quests ea0c766) and the
 * raid fights them in the War Room, x 180..1290, |y| < 700 (the planner's `focus` box in routePlanner/zones/potactics.ts).
 */
export type EventRekey = { from: number; to: number; name: string };
export type ZoneEvents = { box: Box; rekey: readonly EventRekey[] };
export const ZONE_EVENTS: Readonly<Record<string, ZoneEvents>> = {
  potactics: {
    box: { minX: 180, maxX: 1290, minY: -700, maxY: 700 },
    rekey: [
      { from: 214026, to: 214313, name: 'Tallon Zek (event)' },
      { from: 214316, to: 214320, name: 'Vallon Zek (event)' },
    ],
  },
};

const inBox = (p: Pt, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Encounters + the centroid series -> everything the page needs to judge one night. `events`: see ZoneEvents. */
export function analyzeNight(
  key: string, span: { from: number; to: number }, series: CPoint[], encs: readonly Enc[], namedIds: ReadonlySet<number>,
  events?: ZoneEvents,
): NightTrack {
  const inSpan = encs.filter(e => e.started >= span.from && e.started < span.to).sort((a, b) => a.started - b.started || a.id - b.id);
  const firstEngage = inSpan.length ? inSpan[0].started : null;
  const named: Kill[] = [];
  const trash: Kill[] = [];
  const seen = new Set<number>();
  const eventIds = new Set<number>();
  for (const e of inSpan) {
    if (e.ended == null || e.ended < e.started) continue;
    let k: Kill = { npc_id: e.npc_id, name: e.name, start: e.started, end: e.ended };
    const rk = events?.rekey.find(r => r.from === e.npc_id);
    if (events && rk) {
      const c = centreAt(series, e.ended) ?? centreAt(series, e.started);   // no track here: stays the home one
      if (c && inBox(c, events.box)) { k = { npc_id: rk.to, name: rk.name, start: e.started, end: e.ended }; eventIds.add(rk.to); }
    }
    if (eventIds.has(k.npc_id) || namedIds.has(k.npc_id)) {
      if (seen.has(k.npc_id)) {
        // one card, two rows (same death): the earlier start is the fight. An event brother's later row replaces the earlier one.
        const idx = named.findIndex(x => x.npc_id === k.npc_id);
        if (!eventIds.has(k.npc_id) || named[idx].end === k.end) continue;
        named.splice(idx, 1);
      }
      seen.add(k.npc_id);       // a retry or a duplicate card: for everything else the first kill is the one that counts
      named.push(k);
    } else trash.push(k);
  }
  const zoneIn = series.length ? series[0].t : null;
  const first = named[0] ?? null;
  const flags: NightFlag[] = [];
  if (!first) flags.push('no-named');
  else if (firstEngage != null && first.end - firstEngage <= PRECLEAR_MS) flags.push('precleared');
  if (series.length < 20) flags.push('short-track');
  return {
    key, from: span.from, to: span.to, zoneIn, firstEngage, series, named, trash,
    preTrash: first ? trash.filter(k => k.end <= first.start).length : trash.length,
    preMinutes: first && zoneIn != null ? Math.max(0, (first.start - zoneIn) / 60000) : null,
    engageToNamedS: first && firstEngage != null ? Math.max(0, (first.end - firstEngage) / 1000) : null,
    flags,
  };
}

// ── stops and legs ────────────────────────────────────────────────────────────

export type Stop = { npc_id: number; name: string; nights: number; medianClockS: number | null };

/**
 * The named kills this zone's route is made of: those killed on at least half of the nights that KILLED ANY NAMED, in
 * the order of their median time after first engage. (A boss killed on one night in five is a visit, not a stop.)
 *
 * Only nights with a named kill vote. A night with none (a farm run, a scouting visit, a pre-clear) is shown unticked
 * on the page and has nothing to say about the route, so it must not raise the bar: counting it made one real night
 * plus two empty visits need two votes, and Torment (one raid, two visits with no named) drew nothing (2026-10-22).
 * With one voting night every boss it killed is a stop. With two or more a stop needs at least two of them, so two
 * nights that share nothing share no route (the caller falls back to one night, see routeBasis).
 */
export function canonicalStops(nights: readonly NightTrack[]): Stop[] {
  const by = new Map<number, { name: string; offs: number[] }>();
  const voters = nights.filter(n => n.firstEngage != null && n.named.length > 0);
  for (const n of voters) {
    if (n.firstEngage == null) continue;
    for (const k of n.named) {
      let e = by.get(k.npc_id);
      if (!e) by.set(k.npc_id, e = { name: k.name, offs: [] });
      e.offs.push((k.start - n.firstEngage) / 1000);
    }
  }
  const need = voters.length <= 1 ? 1 : Math.max(2, Math.ceil(voters.length / 2));
  const stops: Stop[] = [];
  for (const [npc_id, e] of by) if (e.offs.length >= need) stops.push({ npc_id, name: e.name, nights: e.offs.length, medianClockS: median(e.offs) });
  return stops.sort((a, b) => (a.medianClockS ?? 0) - (b.medianClockS ?? 0) || a.npc_id - b.npc_id);
}

export type LegNight = {
  key: string;
  secs: number;                 // leg 0: first engage -> stop 0 start. Leg i: stop i-1 start -> stop i start.
  track: Pt[] | null;           // LEG_POINTS resampled points, null when the track has a hole
  trashKills: Kill[];           // trash that died inside the leg
  clearSecs: number;            // first trash pull to last trash death inside the leg (0 with none)
  startAt: number; endAt: number;
};

/**
 * One night against the canonical stops. Leg i exists on a night when it killed stop i, and (for i > 0) stop i-1
 * before it, with no other stop's kill between the two; leg 0 needs stop 0 to be the night's first stop kill.
 */
export function nightLegs(n: NightTrack, stops: readonly Stop[]): (LegNight | null)[] {
  const at = stops.map(s => n.named.find(k => k.npc_id === s.npc_id)?.start ?? null);
  return stops.map((_, i) => {
    const end = at[i];
    if (end == null || n.firstEngage == null) return null;
    let start: number;
    if (i === 0) {
      start = n.firstEngage;
      if (at.some((t, j) => j !== 0 && t != null && t < end)) return null;
    } else {
      const prev = at[i - 1];
      if (prev == null || prev >= end) return null;
      if (at.some((t, j) => j !== i && j !== i - 1 && t != null && t > prev && t < end)) return null;
      start = prev;
    }
    if (end <= start) return null;
    const trashKills = n.trash.filter(k => k.end > start && k.end <= end && k.start >= start - 1000);
    const clearSecs = trashKills.length
      ? (Math.max(...trashKills.map(k => k.end)) - Math.min(...trashKills.map(k => k.start))) / 1000
      : 0;
    const raw = legTrack(n.series, start, end);
    return {
      key: n.key, secs: (end - start) / 1000, startAt: start, endAt: end,
      track: raw ? resampleByDistance(raw, LEG_POINTS) : null,
      trashKills, clearSecs,
    };
  });
}

export type SpawnPick = { id: string; x: number; y: number };

/** An npc's spawn points -> the one nearest the raid centre (null with none). Ties go to the first. */
export function nearestSpawn(points: readonly SpawnPick[] | undefined, centre: Pt | null): SpawnPick | null {
  if (!points?.length) return null;
  if (!centre || points.length === 1) return points[0];
  let best = points[0], bd = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - centre.x, p.y - centre.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ── the averaged route ────────────────────────────────────────────────────────

export type LegResult = {
  index: number;
  from: string;                  // 'Start' or the previous stop's name
  to: string;
  nights: number;                // nights that have this leg
  medianS: number | null;
  bestS: number | null;
  pts: [number, number][];       // the averaged track (rounded), empty when no night has a clean track
  band: number[];                // across-night spread at each point (RMS distance from the average), 0 with one night
  trackNights: number;
  clear: {
    medianKills: number | null;  // trash kills per night in this leg
    medianClearS: number | null; // the clearing span per night
    medianOtherS: number | null; // the rest of the leg: the previous named fight, walking, the pull to this named
    top: { name: string; perNight: number }[];
  };
};
export type ClearDot = { x: number; y: number; leg: number; name: string; nights: number; of: number; kills: number };
export type StopResult = { n: number; npc_id: number; name: string; x: number | null; y: number | null; at: 'spawn' | 'raid' | null; nights: number; medianClockS: number | null };

/** Set when the ticked nights share no named kill: the route is the most recent ticked night's own, `of` nights had a named kill. */
export type RouteFallback = { nightKey: string; of: number };

export type RouteResult = {
  stops: StopResult[]; legs: LegResult[]; clears: ClearDot[]; start: [number, number] | null;
  fallback: RouteFallback | null;
};

const r1 = (n: number) => Math.round(n);

/**
 * Which nights the route is built from, and its stops. Normally every ticked night. When they share no named kill
 * (two or more nights that killed different bosses) the most recent ticked night that killed any named is the route on
 * its own and `fallback` says so, so a zone with one or two recorded raids still draws something to evaluate.
 * No ticked night with a named kill: no stops, no fallback.
 */
export function routeBasis(nights: readonly NightTrack[]): { used: readonly NightTrack[]; stops: Stop[]; fallback: RouteFallback | null } {
  const stops = canonicalStops(nights);
  if (stops.length) return { used: nights, stops, fallback: null };
  const named = nights.filter(n => n.firstEngage != null && n.named.length > 0);
  if (!named.length) return { used: nights, stops, fallback: null };
  const latest = named.reduce((a, b) => (b.from > a.from ? b : a));
  return { used: [latest], stops: canonicalStops([latest]), fallback: { nightKey: latest.key, of: named.length } };
}

/**
 * The included nights -> the averaged route. `spawns` is each npc's spawn points in this zone (any npc: bosses
 * and trash), used for the stop markers of bosses that have one and for the clearing dots.
 */
export function averageRoute(allNights: readonly NightTrack[], spawns: ReadonlyMap<number, readonly SpawnPick[]>): RouteResult {
  const { used: nights, stops, fallback } = routeBasis(allNights);
  const perNight = nights.map(n => ({ n, legs: nightLegs(n, stops) }));
  const legs: LegResult[] = [];
  const clears = new Map<string, { x: number; y: number; leg: number; name: string; nights: Set<string>; kills: number }>();
  const ofByLeg: number[] = [];

  stops.forEach((s, i) => {
    const have = perNight.flatMap(p => (p.legs[i] ? [{ n: p.n, leg: p.legs[i] as LegNight }] : []));
    const tracks = have.flatMap(h => (h.leg.track ? [h.leg.track] : []));
    const pts: [number, number][] = [];
    const band: number[] = [];
    for (let k = 0; k < LEG_POINTS && tracks.length; k++) {
      const mx = tracks.reduce((a, t) => a + t[k].x, 0) / tracks.length;
      const my = tracks.reduce((a, t) => a + t[k].y, 0) / tracks.length;
      pts.push([r1(mx), r1(my)]);
      band.push(tracks.length > 1
        ? r1(Math.sqrt(tracks.reduce((a, t) => a + (t[k].x - mx) ** 2 + (t[k].y - my) ** 2, 0) / tracks.length))
        : 0);
    }
    const secs = have.map(h => h.leg.secs);

    // clearing: per night counts, and the dots
    const names = new Map<string, number>();
    for (const h of have) for (const k of h.leg.trashKills) names.set(k.name, (names.get(k.name) ?? 0) + 1);
    const kills = have.map(h => h.leg.trashKills.length);
    const clearS = have.map(h => h.leg.clearSecs);
    const otherS = have.map(h => Math.max(0, h.leg.secs - h.leg.clearSecs));
    ofByLeg[i] = have.length;
    for (const h of have) {
      for (const k of h.leg.trashKills) {
        const pick = nearestSpawn(spawns.get(k.npc_id), centreAt(h.n.series, k.start));
        if (!pick) continue;
        const key = `${i}|${pick.id}`;
        let c = clears.get(key);
        if (!c) clears.set(key, c = { x: pick.x, y: pick.y, leg: i, name: k.name, nights: new Set(), kills: 0 });
        c.nights.add(h.n.key); c.kills++;
      }
    }
    legs.push({
      index: i,
      from: i === 0 ? 'First engage' : stops[i - 1].name,
      to: s.name,
      nights: have.length,
      medianS: median(secs), bestS: secs.length ? Math.min(...secs) : null,
      pts, band, trackNights: tracks.length,
      clear: {
        medianKills: median(kills), medianClearS: median(clearS), medianOtherS: median(otherS),
        top: [...names].map(([name, c]) => ({ name, perNight: c / Math.max(1, have.length) }))
          .sort((a, b) => b.perNight - a.perNight || a.name.localeCompare(b.name)).slice(0, 8),
      },
    });
  });

  const stopsOut: StopResult[] = stops.map((s, i) => {
    const sp = spawns.get(s.npc_id);
    const lastPt = legs[i].pts.length ? legs[i].pts[legs[i].pts.length - 1] : null;
    const centre = lastPt ? { x: lastPt[0], y: lastPt[1] } : null;
    const spawn = nearestSpawn(sp, centre);
    return {
      n: i + 1, npc_id: s.npc_id, name: s.name, nights: s.nights, medianClockS: s.medianClockS,
      ...(spawn
        ? { x: r1(spawn.x), y: r1(spawn.y), at: 'spawn' as const }
        : lastPt ? { x: lastPt[0], y: lastPt[1], at: 'raid' as const } : { x: null, y: null, at: null }),
    };
  });

  return {
    stops: stopsOut,
    legs,
    clears: [...clears.values()]
      .map(c => ({ x: r1(c.x), y: r1(c.y), leg: c.leg, name: c.name, nights: c.nights.size, of: ofByLeg[c.leg], kills: c.kills }))
      .sort((a, b) => b.nights - a.nights || b.kills - a.kills)
      .slice(0, 700),
    start: legs[0]?.pts[0] ?? null,
    fallback,
  };
}

/** One night's path from first engage to its last stop kill (or the end of the track), for drawing. */
export function nightPath(n: NightTrack, stops: readonly Stop[]): [number, number][] {
  if (n.firstEngage == null) return [];
  const last = stops.map(s => n.named.find(k => k.npc_id === s.npc_id)?.start ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const end = last || (n.series.length ? n.series[n.series.length - 1].t : n.firstEngage);
  const raw = legTrack(n.series, n.firstEngage, end, Number.POSITIVE_INFINITY);
  if (!raw) return [];
  return resampleByDistance(raw, Math.min(NIGHT_PATH_POINTS, Math.max(2, raw.length))).map(p => [r1(p.x), r1(p.y)]);
}

/** Seconds -> "9m 40s" / "1h 04m". */
export function fmtSecs(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '-';
  const t = Math.round(s);
  if (t >= 3600) return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
}
