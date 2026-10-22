// Route planner: the rules behind the 3D views (no React, no three.js, no DOM, so the root vitest suite real-imports this).
//
// The planner's map is a top-down picture, which cannot show a tower: eleven floors lie on top of each other. The 3D views
// (?v=b, ?v=c on /raid/plan/routes) lay the same plan out in height. Everything that decides WHERE a thing goes is here;
// Plan3D.tsx only draws what this returns.
//
// FRAMES. x and y are the server's (the plan's own); h is a HEIGHT in the view, and it is the only thing the two variants
// disagree on:
//   'stack' (v=b)  h is the floor's slab: floor n of the zone sits at n * spacing, whatever its real z. A thing on a floor
//                  snaps to that slab; a path that climbs (a pather on a ramp, a leg between floors) is drawn along the
//                  way, through the floors' own levels, so the climb is visible.
//   'mesh'  (v=c)  h is the real z, because the picture is the real collision mesh.
// The drawing then maps (x, y, h) to three.js as (-x, h, -y), the same frame lib/zoneMesh.ts serverToThree gives.
import type { Floor, Kind, Mob, Pather, Pin, Plan, ZoneData, ZoneLink } from './types';
import { allPins, floorOf, planLegs } from './plan';
import { pinNumbers } from './compare';
import type { Routed } from './navroute';

export type Mode3D = 'stack' | 'mesh';
export type Pt3 = [number, number, number];   // x, y (server), h (the view's height)

/** Colour of each kind of pin, as engine.ts KINDS (css vars there, hex here: three.js has no css). */
export const KIND_HEX: Record<Kind, string> = {
  boss: '#f85149', named: '#ffa657', scripted: '#a371f7', objective: '#56d364', door: '#58a6ff', note: '#8b949e',
};
export const LINK_HEX = '#d2a8ff';
export const PATHER_HEX = '#56d4dd';
export const LEG_HEX = '#d29922';        // a plain leg (--gold)
export const FOLLOW_HEX = '#56d364';     // a leg that follows recorded paths (--green)
const FLOOR_FALLBACK = ['#a8793a', '#6b788c', '#8fb4d9', '#7fb685', '#c28bd8', '#d6a86a', '#6fb7c9', '#b5b56a'];
const FLOOR_KEY_HEX: Record<string, string> = { pit: '#a8793a', mid: '#6b788c', up: '#8fb4d9' };   // planner.css --wall-*

// ── floors ───────────────────────────────────────────────────────────────────

/** The floors from the lowest band to the highest (an open-ended band counts as just past its one edge). */
export function floorOrder(floors: readonly Floor[]): Floor[] {
  const rep = (f: Floor) => (f.zmin !== undefined && f.zmax !== undefined ? (f.zmin + f.zmax) / 2 : f.zmin !== undefined ? f.zmin + 1 : f.zmax !== undefined ? f.zmax - 1 : 0);
  return [...floors].sort((a, b) => rep(a) - rep(b));
}

/** A floor's name short enough for a tag: parentheses dropped, and cut at the colon when it is still long. */
export function shortFloorLabel(label: string): string {
  let s = label.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 28 && s.includes(':')) s = s.slice(0, s.indexOf(':')).trim();
  return s.length > 28 ? s.slice(0, 27).trimEnd() + '…' : s;
}

export type Level = { key: string; label: string; color: string; z: number; zmin?: number; zmax?: number };

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bandMiddle = (f: Floor) => (f.zmin !== undefined && f.zmax !== undefined ? (f.zmin + f.zmax) / 2 : f.zmin !== undefined ? f.zmin + 100 : f.zmax !== undefined ? f.zmax - 100 : 0);

/**
 * One level per floor, low to high: the height the floor is actually at, which is the median z of what the zone data
 * puts on it (mobs, pather points, door and teleport ends), or the middle of its band when nothing is on it. The bands
 * in the data are loose (a "z -1000 to -1400" band for a floor at -1342), the medians are where the floor really is.
 * Strictly rising, so a piecewise map through them is well defined.
 */
export function floorLevels(src: { floors: readonly Floor[]; mobs: readonly Mob[]; pathers: readonly Pather[]; links: readonly ZoneLink[] }): Level[] {
  const zs = new Map<string, number[]>();
  for (const f of src.floors) zs.set(f.key, []);
  const put = (z: unknown) => {
    if (typeof z !== 'number' || !Number.isFinite(z)) return;
    const f = floorOf(src.floors, z);
    if (f) zs.get(f.key)?.push(z);
  };
  for (const m of src.mobs) put(m.z);
  for (const p of src.pathers) for (const q of p.points) put(q[2]);
  for (const l of src.links) { if (l.kind === 'step') continue; put(l.from[2]); if (l.to) put(l.to[2]); }   // a step bridge is not a thing in the zone
  const out: Level[] = [];
  const fi = (f: Floor) => src.floors.indexOf(f);
  for (const f of floorOrder(src.floors)) {
    const have = zs.get(f.key) ?? [];
    let z = have.length ? median(have) : bandMiddle(f);
    if (out.length && z <= out[out.length - 1].z) z = out[out.length - 1].z + 1;
    out.push({
      key: f.key, label: f.label, z, zmin: f.zmin, zmax: f.zmax,
      color: f.color ?? FLOOR_KEY_HEX[f.key] ?? FLOOR_FALLBACK[fi(f) % FLOOR_FALLBACK.length],
    });
  }
  return out;
}

/** The spacing between slabs that reads well for a zone: a ninth of its width, within 120..700 units. */
export function baseSpacing(bounds: { x0: number; x1: number; y0: number; y1: number }): number {
  const w = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
  return Math.min(700, Math.max(120, Math.round(w / 9 / 10) * 10));
}

export type Heights = {
  mode: Mode3D;
  levels: (Level & { h: number })[];
  /** The height of a thing standing at real z: its floor's slab ('stack'), or z itself ('mesh'). */
  snap: (z: number | null | undefined) => number;
  /** The height of a point on a path that may climb: continuous through the slabs ('stack'), or z itself ('mesh'). */
  ramp: (z: number) => number;
};

export function heightsFor(levels: readonly Level[], floors: readonly Floor[], mode: Mode3D, spacing: number): Heights {
  const lv = levels.map((l, i) => ({ ...l, h: mode === 'mesh' ? l.z : i * spacing }));
  if (mode === 'mesh') {
    const id = (z: number | null | undefined) => (typeof z === 'number' && Number.isFinite(z) ? z : lv.length ? lv[lv.length >> 1].z : 0);
    return { mode, levels: lv, snap: id, ramp: z => z };
  }
  const nearest = (z: number) => lv.reduce((best, l) => (Math.abs(l.z - z) < Math.abs(best.z - z) ? l : best), lv[0]);
  const snap = (z: number | null | undefined) => {
    if (!lv.length) return 0;
    if (typeof z !== 'number' || !Number.isFinite(z)) return lv[lv.length >> 1].h;
    const f = floorOf(floors, z);
    return (f ? lv.find(l => l.key === f.key) ?? nearest(z) : nearest(z)).h;
  };
  const ramp = (z: number) => {
    if (!lv.length) return 0;
    if (lv.length === 1) return lv[0].h;
    const room = spacing / 2;   // past the lowest / highest level it runs on at the end segment's slope, for a little way
    if (z <= lv[0].z) return Math.max(lv[0].h - room, lv[0].h + (z - lv[0].z) * (spacing / (lv[1].z - lv[0].z)));
    const last = lv.length - 1;
    if (z >= lv[last].z) return Math.min(lv[last].h + room, lv[last].h + (z - lv[last].z) * (spacing / (lv[last].z - lv[last - 1].z)));
    let i = 0;
    while (i + 1 < last && z > lv[i + 1].z) i++;
    return lv[i].h + ((z - lv[i].z) / (lv[i + 1].z - lv[i].z)) * spacing;
  };
  return { mode, levels: lv, snap, ramp };
}

/** The z above which a floor's clip hides everything (its band's top), or null when the band is open at the top. */
export function clipHeight(floors: readonly Floor[], key: string | null | undefined): number | null {
  const f = key ? floors.find(x => x.key === key) : undefined;
  return f && typeof f.zmax === 'number' && Number.isFinite(f.zmax) ? f.zmax : null;
}

// ── pins ─────────────────────────────────────────────────────────────────────

export type ZSource = 'pin' | 'mob' | 'near' | 'floor';

/**
 * How high a pin is. A pin dropped by hand on the 2D map has no z: it takes the mob it was made from, else the nearest
 * mob that has one (a pin on the map is usually dropped beside something), else the middle floor. `src` says which, so
 * a guessed height can be said to be a guess.
 */
export function pinHeight(pin: Pick<Pin, 'x' | 'y' | 'z' | 'mob'>, mobs: readonly Mob[], levels: readonly Level[]): { z: number; src: ZSource } {
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (fin(pin.z)) return { z: pin.z, src: 'pin' };
  const own = pin.mob ? mobs.find(m => m.id === pin.mob) : undefined;
  if (own && fin(own.z)) return { z: own.z, src: 'mob' };
  let best: Mob | null = null, bd = Infinity;
  for (const m of mobs) {
    if (!fin(m.z)) continue;
    const d = Math.hypot(m.x - pin.x, m.y - pin.y);
    if (d < bd) { bd = d; best = m; }
  }
  if (best) return { z: best.z as number, src: 'near' };
  return { z: levels.length ? levels[levels.length >> 1].z : 0, src: 'floor' };
}

// ── lines ────────────────────────────────────────────────────────────────────

/** A flat polyline given a height that runs from h0 at its start to h1 at its end, in proportion to the way walked. */
export function liftPolyline(poly: readonly (readonly [number, number])[], h0: number, h1: number): Pt3[] {
  if (!poly.length) return [];
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const total = cum[cum.length - 1];
  return poly.map((p, i) => [p[0], p[1], total > 0 ? h0 + (h1 - h0) * (cum[i] / total) : i === poly.length - 1 ? h1 : h0] as Pt3);
}

/** A teleport as an arc: the straight line from a to b, lifted by a bow that rises and falls (a sixth of its length). */
export function arcPoints(a: Pt3, b: Pt3, n = 24): Pt3[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const bow = Math.max(40, len * 0.16);
  const out: Pt3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + Math.sin(Math.PI * t) * bow]);
  }
  return out;
}

// ── dragging a pin ───────────────────────────────────────────────────────────

/** A press that moves this far (|dx| + |dy|, screen px) is a drag; less is still a click, as the 3D view has always taken it. */
export const DRAG_SLOP = 4;
export const movedPast = (dx: number, dy: number, slop = DRAG_SLOP) => Math.abs(dx) + Math.abs(dy) > slop;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** A point in three.js's frame (-x, h, -y) back in the server's (x, y, z): the inverse of serverToThree in lib/zoneMesh.ts. */
export function threeToServer(tx: number, ty: number, tz: number): Pt3 {
  return [0 - tx, 0 - tz, ty];   // 0 - n, so a point on an axis is +0 and never -0
}

export type Landing = { x: number; y: number; z: number; h: number };

/**
 * Where a dragged pin lands, from the point under the pointer (`at`, three.js frame) and the pin as it stands (`cur`: the
 * z it has and the height it is drawn at).
 *   'mesh'   the picture is the real zone, so the height of the point IS the z the pin takes.
 *   'stack'  a slab is not a z: every z on a floor draws at the same level, so there is no way back from a slab to a z.
 *            The pin slides on its slab and keeps the z it has, so it cannot change floors here (the stack is for
 *            looking at the climb, not for deciding it). A pin whose height was only guessed keeps the guess, which is
 *            what stops the guess changing floors under the pointer as the nearest mob changes.
 * x and y are kept inside the zone's bounds (a pointer past the edge of the slab, or of the mesh, plants the pin on the edge,
 * not in the next county) and rounded to a tenth, as the 2D map does.
 */
export function dragLanding(
  mode: Mode3D, at: Pt3, cur: { z: number; h: number }, bounds?: { x0: number; x1: number; y0: number; y1: number },
): Landing {
  const [px, py, z] = threeToServer(at[0], at[1], at[2]);
  const x = tenth(bounds ? Math.min(bounds.x1, Math.max(bounds.x0, px)) : px), y = tenth(bounds ? Math.min(bounds.y1, Math.max(bounds.y0, py)) : py);
  return mode === 'mesh' ? { x, y, z: tenth(z), h: tenth(z) } : { x, y, z: cur.z, h: cur.h };
}

/** The plan with one pin somewhere else (a copy: the engine's own plan is only changed when the drag is let go). */
export function withPinMoved(plan: Plan, id: string, to: { x: number; y: number; z: number }): Plan {
  const at = (p: Pin): Pin => (p.id === id ? { ...p, x: to.x, y: to.y, z: to.z } : p);
  return { ...plan, pins: plan.pins.map(at), splits: plan.splits.map(s => ({ ...s, branches: s.branches.map(b => ({ ...b, pins: b.pins.map(at) })) })) };
}

/** Does the walk route of this leg end at the pin? Its key is "<from id>><to id>" (plan.ts planLegs). */
export const legTouches = (legKey: string, pinId: string) => legKey.startsWith(pinId + '>') || legKey.endsWith('>' + pinId);

// ── the whole view ───────────────────────────────────────────────────────────

export type Slab3D = { key: string; label: string; short: string; color: string; z: number; h: number };
export type Pin3D = { id: string; num: string; label: string; kind: Kind; optional: boolean; branch: string | null; x: number; y: number; h: number; z: number; src: ZSource; floor: string | null; faint?: boolean };
export type Leg3D = { key: string; color: string; dashed: boolean; walks: Pt3[][]; arc: Pt3[] | null; arcs: Pt3[][] };   // arcs: every jump of a walked route, arc is the first
export type Link3D = { i: number; kind: ZoneLink['kind']; label: string; from: Pt3; to: Pt3 | null; arc: Pt3[] | null };
export type Pather3D = { id: string; label: string; wander: boolean; pts: Pt3[] };
export type View3D = {
  mode: Mode3D; spacing: number;
  slabs: Slab3D[];
  pins: Pin3D[]; legs: Leg3D[]; links: Link3D[]; pathers: Pather3D[];
  bounds: { x0: number; x1: number; y0: number; y1: number; h0: number; h1: number };
};

export type View3DInput = {
  zone: Pick<ZoneData, 'floors' | 'mobs' | 'pathers' | 'links' | 'bounds'>;
  extraMobs?: readonly Mob[];
  plan: Plan;
  skipOptional: boolean;
  mode: Mode3D;
  /** Slab spacing for 'stack'; ignored for 'mesh'. */
  spacing?: number;
  /** "One leg" mode: the key of the one leg to draw. Every other leg is left out and every pin but its two ends is `faint`. */
  focusLeg?: string | null;
  /** Walk routes by leg key (navroute.ts): a leg that has one is drawn along it at its true heights, with an arc per jump. */
  routes?: ReadonlyMap<string, Routed>;
};

export function buildView3D(inp: View3DInput): View3D {
  const { zone, plan, mode } = inp;
  const mobs = [...zone.mobs, ...(inp.extraMobs ?? [])];
  const spacing = inp.spacing ?? baseSpacing(zone.bounds);
  const levels = floorLevels({ floors: zone.floors, mobs, pathers: zone.pathers, links: zone.links });
  const hs = heightsFor(levels, zone.floors, mode, spacing);

  const allLegs = planLegs(plan, inp.skipOptional, zone.links);
  const focus = inp.focusLeg ? allLegs.find(l => l.k === inp.focusLeg) : undefined;
  const nums = pinNumbers(plan);
  const branchOf = new Map<string, string>();
  for (const s of plan.splits) for (const b of s.branches) for (const p of b.pins) branchOf.set(p.id, b.color);
  const pins: Pin3D[] = allPins(plan).map(p => {
    const { z, src } = pinHeight(p, mobs, levels);
    return {
      id: p.id, num: nums.get(p.id) ?? '?', label: p.label, kind: p.kind, optional: p.optional, branch: branchOf.get(p.id) ?? null,
      x: p.x, y: p.y, h: hs.snap(z), z, src, floor: floorOf(zone.floors, z)?.key ?? null,
      ...(focus && p.id !== focus.a.id && p.id !== focus.b.id ? { faint: true } : {}),
    };
  });
  const hOf = new Map(pins.map(p => [p.id, p.h]));

  const legs: Leg3D[] = [];
  for (const lg of allLegs) {
    if (lg.off && lg !== focus) continue;
    if (focus && lg !== focus) continue;
    const ha = hOf.get(lg.a.id) ?? 0, hb = hOf.get(lg.b.id) ?? 0;
    const color = lg.branch ? lg.branch.branch.color : lg.ln && lg.ln.follow ? FOLLOW_HEX : LEG_HEX;
    const out: Leg3D = { key: lg.k, color, dashed: lg.dashed, walks: [], arc: null, arcs: [] };
    const rt = inp.routes?.get(lg.k);
    if (rt) {
      for (const s of rt.segs) {
        if (s.kind === 'walk') out.walks.push(s.pts.map(p => [p[0], p[1], hs.ramp(p[2])] as Pt3));
        else out.arcs.push(arcPoints([s.from[0], s.from[1], hs.ramp(s.from[2])], [s.to[0], s.to[1], hs.ramp(s.to[2])]));
      }
      out.arc = out.arcs[0] ?? null;
    } else if (lg.jump) {
      const tp = zone.links.find(t => t.kind === 'teleport' && t.label === lg.jump?.label);
      const hf = tp ? hs.snap(tp.from[2]) : ha, ht = tp && tp.to ? hs.snap(tp.to[2]) : hb;
      out.walks.push(liftPolyline([[lg.a.x, lg.a.y], ...lg.pts, lg.jump.from], ha, hf), liftPolyline([lg.jump.to, [lg.b.x, lg.b.y]], ht, hb));
      out.arc = arcPoints([lg.jump.from[0], lg.jump.from[1], hf], [lg.jump.to[0], lg.jump.to[1], ht]);
      out.arcs = [out.arc];
    } else out.walks.push(liftPolyline([[lg.a.x, lg.a.y], ...lg.pts, [lg.b.x, lg.b.y]], ha, hb));
    legs.push(out);
  }

  const links: Link3D[] = zone.links.flatMap((lk, i) => {
    if (lk.kind === 'step') return [];
    const from: Pt3 = [lk.from[0], lk.from[1], hs.snap(lk.from[2])];
    const to: Pt3 | null = lk.to ? [lk.to[0], lk.to[1], hs.snap(lk.to[2])] : null;
    return [{ i, kind: lk.kind, label: lk.label, from, to, arc: lk.kind === 'teleport' && to ? arcPoints(from, to) : null }];
  });

  const pathers: Pather3D[] = zone.pathers.filter(pa => pa.points.length > 1).map(pa => {
    const pts = pa.points.map(q => [q[0], q[1], hs.ramp(q[2])] as Pt3);
    if (pa.loop) pts.push(pts[0]);
    return { id: pa.id, label: pa.npc_names.join(', ') || 'pather', wander: !!pa.wander, pts };
  });

  const hAll = hs.levels.map(l => l.h);
  const h0 = hAll.length ? Math.min(...hAll) : 0, h1 = hAll.length ? Math.max(...hAll) : 0;
  return {
    mode, spacing,
    slabs: hs.levels.map(l => ({ key: l.key, label: l.label, short: shortFloorLabel(l.label), color: l.color, z: l.z, h: l.h })),
    pins, legs, links, pathers,
    bounds: { ...zone.bounds, h0, h1 },
  };
}
