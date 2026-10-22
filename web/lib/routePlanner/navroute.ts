// Route planner: walkable routing. Pure graph logic (no wasm, no DOM, no fetch), so the root vitest suite real-imports it
// with a fake walk function. The browser half (navLoad.ts) supplies the real one, a Detour query over the server's navmesh.
//
// THE PROBLEM. A leg is a straight line, or a line the officer bent by hand. Neither knows where the walls are, and in the
// Tower of Solusek Ro neither knows that the way from the zone-in to Xuzl's wing is a teleporter: the navmesh there has
// 1,570 separate walkable pieces and only doors, ramps and teleporters join them. So the route is a SHORTEST-PATH SEARCH
// over a tiny graph whose nodes are the leg's two ends and both ends of every teleport / flag door / step bridge, and whose
// edges are
//   • a WALK between two nodes, only when the navmesh finds a COMPLETE path (Detour reports success on a partial one: the
//     walk function must say `ok: false` for that, the loader does: an end more than 2 units short is a failure);
//   • a JUMP along a teleport or a flag door, costing next to nothing (it is a click, not a walk), one way;
//   • a STEP across a small vertical gap the mesh has between two pieces, walkable both ways. ⚠ The steps are HEURISTICS
//     found offline (zones/*.json, kind 'step'): nobody has stood on them. The leg says so.
//
// Mechanics come from the server's data (the navmesh, the zone's spawn/door/teleport rows), never from a guide.
import type { ZoneLink } from './types';
import type { P3 } from './navmesh';

export type { P3 } from './navmesh';

export type WalkResult = { ok: true; pts: P3[]; len: number } | { ok: false };
export type WalkFn = (a: P3, b: P3) => WalkResult;

/** How far a path's last point may be from where it was asked to end. Detour's computePath reports SUCCESS on a partial
 *  path (one that got as close as it could), so "it said success" proves nothing; the end of the path does. */
export const END_GAP = 2;

/** A path from the navmesh as a walk result: whole only when it ends where it was asked to, with its length. */
export function completeWalk(pts: readonly P3[], want: P3): WalkResult {
  if (!pts.length) return { ok: false };
  const end = pts[pts.length - 1];
  if (Math.hypot(end[0] - want[0], end[1] - want[1], end[2] - want[2]) > END_GAP) return { ok: false };
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return { ok: true, pts: [...pts], len };
}

export type Jump = { from: P3; to: P3; label: string; via: 'teleport' | 'flag' };
export type Seg = { kind: 'walk'; pts: P3[] } | ({ kind: 'jump' } & Jump);
export type Routed = {
  segs: Seg[];
  walkLen: number;          // units walked; a jump counts 0
  jumps: Jump[];
  steps: number;            // step bridges crossed (heuristic, unverified)
  ignoredBends: boolean;    // the officer's bend points could not be walked through, so the route ignores them
};

const JUMP_COST = 1;
/** How far a snapped end can sit from the point it was asked for: the lower bound on a walk is the straight line less this. */
const SNAP_SLACK = 80;
/** A walk is a query against the mesh (1 to 3 ms each); a search that wants more than this is not going to find a route. */
const MAX_QUERIES = 4000;
const ANCHOR_R = 1.5;
const KNOWN_R = 0.06;

export const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
const d2 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const key = (p: readonly number[]) => p[0].toFixed(1) + ',' + p[1].toFixed(1) + ',' + (p[2] ?? 0).toFixed(1);

/** "Jiva's cauldron: teleports back to the teleporter hall" -> "Jiva's cauldron". A flagged door keeps what it opens into. */
export function jumpName(label: string): string {
  const i = label.indexOf(':');
  if (i < 0) return label.trim();
  const head = label.slice(0, i).trim();
  if (!/^flagged door$/i.test(head)) return head;
  const rest = label.slice(i + 1).split(',')[0].trim();
  return rest ? `${head} ${rest}` : head;
}

type Hop =
  | { kind: 'walk'; pts: P3[]; len: number }
  | { kind: 'jump'; from: P3; to: P3; label: string; via: 'teleport' | 'flag' }
  | { kind: 'step'; from: P3; to: P3; len: number };

type Edge = { a: number; b: number; cost: number; both: boolean; hop: (forward: boolean) => Hop };

export type Router = {
  /** The fewest-cost way from a to b, or null when there is none. */
  route(a: P3, b: P3): Hop[] | null;
  /** The ends of every teleport, flag door and step the router knows (for matching baked bend points). */
  anchors: P3[];
  /** Walk queries made so far (the cache is not counted again). */
  queries(): number;
};

export function makeRouter(walk: WalkFn, links: readonly ZoneLink[]): Router {
  const fixed: P3[] = [];
  const edges: Edge[] = [];
  const node = (p: readonly number[]) => { fixed.push([p[0], p[1], p[2] ?? 0]); return fixed.length - 1; };
  for (const l of links) {
    if (!l.to) continue;
    if (l.kind === 'teleport' || l.kind === 'flag') {
      const a = node(l.from), b = node(l.to);
      const from = fixed[a], to = fixed[b], via = l.kind;
      edges.push({ a, b, cost: JUMP_COST, both: false, hop: () => ({ kind: 'jump', from, to, label: l.label, via }) });
    } else if (l.kind === 'step') {
      const a = node(l.from), b = node(l.to);
      const from = fixed[a], to = fixed[b], len = d3(from, to);
      edges.push({ a, b, cost: len, both: true, hop: fw => (fw ? { kind: 'step', from, to, len } : { kind: 'step', from: to, to: from, len }) });
    }
  }

  const memo = new Map<string, WalkResult>();
  let queries = 0;
  const cached = (a: P3, b: P3): WalkResult => {
    const k = key(a) + '>' + key(b);
    let r = memo.get(k);
    if (!r) { queries++; r = walk(a, b); memo.set(k, r); }
    return r;
  };

  function route(A: P3, B: P3): Hop[] | null {
    const N = fixed.length + 2;
    const pt = (i: number): P3 => (i === 0 ? A : i === 1 ? B : fixed[i - 2]);
    const dist = new Array<number>(N).fill(Infinity);
    const prev = new Array<{ u: number; hop: Hop } | null>(N).fill(null);
    const done = new Array<boolean>(N).fill(false);
    const adj: { to: number; cost: number; hop: Hop }[][] = Array.from({ length: N }, () => []);
    for (const e of edges) {
      adj[e.a + 2].push({ to: e.b + 2, cost: e.cost, hop: e.hop(true) });
      if (e.both) adj[e.b + 2].push({ to: e.a + 2, cost: e.cost, hop: e.hop(false) });
    }
    const relax = (u: number, v: number, cost: number, hop: Hop) => {
      if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = { u, hop }; }
    };
    dist[0] = 0;
    const q0 = queries;
    const direct = cached(A, B);                                   // first, so every later walk has a bound to beat
    if (direct.ok) relax(0, 1, direct.len, { kind: 'walk', pts: direct.pts, len: direct.len });
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === 1) break;
      done[u] = true;
      for (const e of adj[u]) relax(u, e.to, e.cost, e.hop);
      if (queries - q0 > MAX_QUERIES) break;
      for (let v = 1; v < N; v++) {
        if (v === u || done[v]) continue;
        if (u === 0 && v === 1) continue;                          // the direct walk, already made
        // a walk is never shorter than the straight line (less what the ends move when they snap), so a walk that cannot
        // beat what is already known is not worth a query
        const lb = Math.max(0, d3(pt(u), pt(v)) - SNAP_SLACK);
        if (dist[u] + lb >= Math.min(dist[v], dist[1])) continue;
        const r = cached(pt(u), pt(v));
        if (r.ok) relax(u, v, r.len, { kind: 'walk', pts: r.pts, len: r.len });
      }
    }
    if (dist[1] === Infinity) return null;
    const chain: Hop[] = [];
    for (let v = 1; v !== 0;) { const p = prev[v]; if (!p) return null; chain.push(p.hop); v = p.u; }
    return chain.reverse();
  }

  return { route, anchors: fixed, queries: () => queries };
}

// ── a whole leg ──────────────────────────────────────────────────────────────

/** The z of each bend point of a leg. A bend is drawn on the 2D map, so it has no height of its own. One that came from
 *  "Use this route" has its height in `known` (matched by x, y); one that sits on the end of a teleport or step takes that
 *  end's exact point; any other takes the height it would have on the way between its neighbours (by the distance along
 *  the bends), which is only a guess and is right for a bend that goes round a wall on one floor. */
export function bendHeights(a: P3, b: P3, bends: readonly (readonly [number, number])[], anchors: readonly P3[] = [], known: readonly P3[] = []): P3[] {
  const n = bends.length;
  const pts: (P3 | null)[] = [a, ...bends.map(p => {
    const own = known.find(q => d2(q, p) < KNOWN_R);
    const hit = own ?? anchors.find(q => d2(q, p) <= ANCHOR_R);
    return hit ? ([hit[0], hit[1], hit[2]] as P3) : null;
  }), b];
  const xy = [a, ...bends, b] as readonly (readonly number[])[];
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + d2(xy[i], xy[i - 1]));
  const out: P3[] = [];
  let k0 = 0;
  for (let i = 1; i <= n; i++) {
    if (pts[i]) { out.push(pts[i] as P3); k0 = i; continue; }
    let k1 = i + 1;
    while (k1 < n + 1 && !pts[k1]) k1++;
    const z0 = (pts[k0] as P3)[2], z1 = (pts[k1] as P3)[2], span = cum[k1] - cum[k0];
    const t = span > 0 ? (cum[i] - cum[k0]) / span : 0;
    out.push([bends[i - 1][0], bends[i - 1][1], z0 + (z1 - z0) * t]);
  }
  return out;
}

export type LegSpec = {
  a: P3;
  b: P3;
  bends?: readonly (readonly [number, number])[];
  /** Heights of bends that came from "Use this route" (Line.h). */
  known?: readonly P3[];
  /** The teleport the officer set the leg to go via: the route goes through it. */
  jump?: { from: P3; to: P3; label: string };
};

const sameAs = (a: readonly number[], b: readonly number[]) => d3(a, b) < 0.5;

/** Hops to segments: neighbouring walks join into one line, a step is a short walk (and is counted). */
function toSegs(hops: Hop[]): { segs: Seg[]; steps: number; walkLen: number } {
  const segs: Seg[] = [];
  let steps = 0, walkLen = 0;
  const walkTo = (pts: P3[]) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === 'walk') {
      const rest = sameAs(last.pts[last.pts.length - 1], pts[0]) ? pts.slice(1) : pts;
      last.pts.push(...rest);
    } else segs.push({ kind: 'walk', pts: [...pts] });
  };
  for (const h of hops) {
    if (h.kind === 'walk') { walkLen += h.len; walkTo(h.pts); }
    else if (h.kind === 'step') { steps++; walkLen += h.len; walkTo([h.from, h.to]); }
    else segs.push({ kind: 'jump', from: h.from, to: h.to, label: h.label, via: h.via });
  }
  return { segs, steps, walkLen };
}

function chain(router: Router, way: readonly P3[]): Hop[] | null {
  const out: Hop[] = [];
  for (let i = 0; i + 1 < way.length; i++) {
    const h = router.route(way[i], way[i + 1]);
    if (!h) return null;
    out.push(...h);
  }
  return out;
}

/**
 * Route one leg: from `a` through the officer's bend points in order to `b`, going through the teleport the leg is set to
 * if it is. When the bends cannot be walked (one of them is off the mesh), the leg is routed without them and says so.
 * Null when there is no walkable route at all.
 */
export function routeLeg(router: Router, spec: LegSpec): Routed | null {
  const bends = spec.bends ?? [];
  const attempt = (use: readonly (readonly [number, number])[]): Routed | null => {
    const hs = bendHeights(spec.a, spec.jump ? spec.jump.from : spec.b, use, router.anchors, spec.known);
    let hops: Hop[] | null;
    if (spec.jump) {
      const first = chain(router, [spec.a, ...hs, spec.jump.from]);
      const second = chain(router, [spec.jump.to, spec.b]);
      hops = first && second ? [...first, { kind: 'jump', from: spec.jump.from, to: spec.jump.to, label: spec.jump.label, via: 'teleport' } as Hop, ...second] : null;
    } else hops = chain(router, [spec.a, ...hs, spec.b]);
    if (!hops) return null;
    const { segs, steps, walkLen } = toSegs(hops);
    // start and end on the pins themselves, not on the nearest polygon to them
    const first = segs[0], last = segs[segs.length - 1];
    if (first && first.kind === 'walk' && d3(first.pts[0], spec.a) > 0.5) first.pts.unshift(spec.a);
    if (last && last.kind === 'walk' && d3(last.pts[last.pts.length - 1], spec.b) > 0.5) last.pts.push(spec.b);
    return { segs, walkLen, jumps: segs.filter((s): s is Seg & { kind: 'jump' } => s.kind === 'jump').map(s => ({ from: s.from, to: s.to, label: s.label, via: s.via })), steps, ignoredBends: false };
  };
  const r = attempt(bends);
  if (r) return r;
  if (!bends.length) return null;
  const free = attempt([]);
  return free ? { ...free, ignoredBends: true } : null;
}

/** The names of the jumps a route takes, in order, for the note under a leg. */
export const viaNames = (r: Routed): string[] => r.jumps.map(j => jumpName(j.label));

/** Same leg, same inputs: the cache key for a computed route. */
export const legSig = (s: LegSpec): string =>
  [key(s.a), key(s.b), (s.bends ?? []).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(';'), (s.known ?? []).map(p => p[2].toFixed(1)).join(';'),
    s.jump ? key(s.jump.from) + '>' + key(s.jump.to) : ''].join('|');

// ── bake a route into bend points ────────────────────────────────────────────

/** The route as one 2D line, with the ends of every jump marked: those must survive simplifying. */
function flatten(r: Routed): { pts: P3[]; pinned: boolean[] } {
  const pts: P3[] = [], pinned: boolean[] = [];
  const push = (p: P3, pin: boolean) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.05 && Math.abs(last[2] - p[2]) < 4) { if (pin) pinned[pinned.length - 1] = true; return; }
    pts.push([p[0], p[1], p[2]]); pinned.push(pin);
  };
  for (const s of r.segs) {
    if (s.kind === 'walk') for (const p of s.pts) push(p, false);
    else { push(s.from, true); push(s.to, true); }
  }
  return { pts, pinned };
}

/** Douglas-Peucker over [lo, hi], keeping every pinned point as well. Marks the kept indexes. */
function dp(pts: readonly P3[], pinned: readonly boolean[], eps: number, keep: boolean[]) {
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop() as [number, number];
    let at = -1, far = eps;
    const [x1, y1] = pts[lo], [x2, y2] = pts[hi], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    for (let i = lo + 1; i < hi; i++) {
      if (pinned[i]) { at = i; far = Infinity; break; }
      const t = l2 ? Math.max(0, Math.min(1, ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / l2)) : 0;
      const dd = Math.hypot(pts[i][0] - (x1 + t * dx), pts[i][1] - (y1 + t * dy));
      if (dd > far) { far = dd; at = i; }
    }
    if (at >= 0) { keep[at] = true; stack.push([lo, at], [at, hi]); }
  }
}

/**
 * The route as bend points for a leg (`Line.pts`, the server frame the engine draws in): the line walked, with the corners
 * that matter and no more than `max` of them. The ends of a jump are always kept, so a plan that routes through the bends
 * again lands on the same teleport. The pins themselves are not bends and are left out. Each bend comes with its height
 * (x, y, z): the leg keeps x, y as its bends and z in `Line.h`, so walking through them again lands on the same floor.
 */
export function bakeBends(r: Routed, max = 40): P3[] {
  const { pts, pinned } = flatten(r);
  if (pts.length <= 2) return [];
  const last = pts.length - 1;
  const run = (eps: number) => { const keep = new Array<boolean>(pts.length).fill(false); keep[0] = keep[last] = true; dp(pts, pinned, eps, keep); return keep; };
  const count = (k: boolean[]) => k.reduce((n, v, i) => n + (v && i !== 0 && i !== last ? 1 : 0), 0);
  let lo = 0, hi = 4000, best = run(hi);
  if (count(run(0.5)) <= max) best = run(0.5);
  else for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, k = run(mid);
    if (count(k) <= max) { best = k; hi = mid; } else lo = mid;
  }
  const out: P3[] = [];
  best.forEach((v, i) => { if (v && i !== 0 && i !== last) out.push([Math.round(pts[i][0] * 10) / 10, Math.round(pts[i][1] * 10) / 10, Math.round(pts[i][2] * 10) / 10]); });
  return out;
}
