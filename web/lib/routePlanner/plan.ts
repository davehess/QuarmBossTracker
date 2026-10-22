// Route planner: the plan model. Pure functions only (the browser engine and the server actions both use them).
//
// sanitize() is the one gate every plan passes through: what a browser sends to the server, what the server reads back
// from bot_kv, what a poll adopts. It caps every list, drops what is not a number, and never keeps a name: the plan
// carries pin labels the officers typed and nothing about who typed them.
import {
  BRANCH_COLORS, KIND_KEYS, MAX_BRANCHES, MIN_BRANCHES, emptyPlan,
  type Branch, type BuildOrder, type Floor, type Kind, type Line, type Pin, type Plan, type Split, type ZoneLink,
} from './types';

export const MAX_PINS = 300;           // main route and every branch together
export const MAX_LINES = 600;
export const MAX_BENDS = 80;
export const MAX_HIDDEN = 500;
export const MAX_SPLITS = 8;
export const MAX_HEADCOUNT = 200;
export const MAX_ROLES = 200;
const COORD = 20000;                       // no zone is wider than this; a typo is not a place

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD;
const MOB_ID = /^[\w-]{1,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const headcountOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_HEADCOUNT ? v : undefined);
const rolesOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_ROLES) : undefined);

export function uid(): string {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

function cleanPin(q: Record<string, unknown>, seen: Set<string>): Pin | null {
  if (!q || typeof q !== 'object' || !isNum(q.x) || !isNum(q.y)) return null;
  let id = String(q.id || uid()).slice(0, 40);
  if (seen.has(id)) id = uid();
  seen.add(id);
  const pin: Pin = {
    id,
    label: String(q.label || 'Pin').slice(0, 120),
    kind: KIND_KEYS.includes(q.kind as Kind) ? (q.kind as Kind) : 'note',
    optional: !!q.optional,
    x: q.x, y: q.y,
  };
  if (isNum(q.z)) pin.z = q.z;
  if (typeof q.mob === 'string' && MOB_ID.test(q.mob)) pin.mob = q.mob;
  if (typeof q.npc === 'number' && Number.isInteger(q.npc) && q.npc >= 0 && q.npc < 1e9) pin.npc = q.npc;
  if (q.note) pin.note = String(q.note).slice(0, 400);
  if (q.onPlan) pin.onPlan = true;
  return pin;
}

export function sanitize(raw: unknown): Plan {
  const out = emptyPlan();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as Record<string, unknown>;

  const seen = new Set<string>();
  let budget = MAX_PINS;
  for (const q of (Array.isArray(p.pins) ? p.pins : []).slice(0, MAX_PINS) as Record<string, unknown>[]) {
    const pin = cleanPin(q, seen);
    if (pin) { out.pins.push(pin); budget--; }
  }

  // splits: each needs both anchors among the main pins; 2..4 branches; branch pins share the pin budget
  const mainIds = new Set(out.pins.map(x => x.id));
  const splitIds = new Set<string>();
  for (const s of (Array.isArray(p.splits) ? p.splits : []).slice(0, MAX_SPLITS) as Record<string, unknown>[]) {
    if (!s || typeof s !== 'object' || typeof s.from !== 'string' || typeof s.to !== 'string') continue;
    if (!mainIds.has(s.from) || !mainIds.has(s.to) || s.from === s.to) continue;
    let sid = String(s.id || uid()).slice(0, 40);
    if (splitIds.has(sid)) sid = uid();
    splitIds.add(sid);
    const branches: Branch[] = [];
    const bIds = new Set<string>();
    for (const b of (Array.isArray(s.branches) ? s.branches : []).slice(0, MAX_BRANCHES) as Record<string, unknown>[]) {
      if (!b || typeof b !== 'object') continue;
      let bid = String(b.id || uid()).slice(0, 40);
      if (bIds.has(bid)) bid = uid();
      bIds.add(bid);
      const idx = branches.length;
      const pins: Pin[] = [];
      for (const q of (Array.isArray(b.pins) ? b.pins : []).slice(0, Math.max(0, budget)) as Record<string, unknown>[]) {
        const pin = cleanPin(q, seen);
        if (pin) { pins.push(pin); budget--; }
      }
      const branch: Branch = {
        id: bid,
        label: String(b.label || `Team ${String.fromCharCode(65 + idx)}`).slice(0, 40),
        color: typeof b.color === 'string' && HEX.test(b.color) ? b.color : BRANCH_COLORS[idx],
        pins,
      };
      const hc = headcountOf(b.headcount), roles = rolesOf(b.roles);
      if (hc !== undefined) branch.headcount = hc;
      if (roles) branch.roles = roles;
      branches.push(branch);
    }
    if (branches.length >= MIN_BRANCHES) out.splits.push({ id: sid, from: s.from, to: s.to, branches });
  }

  out.hiddenTracks = (Array.isArray(p.hiddenTracks) ? p.hiddenTracks : [])
    .filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 60)).slice(0, MAX_HIDDEN);

  for (const l of (Array.isArray(p.lines) ? p.lines : []).slice(0, MAX_LINES) as Record<string, unknown>[]) {
    if (!l || typeof l.k !== 'string' || l.k.length > 90) continue;
    const pts = (Array.isArray(l.pts) ? l.pts : [])
      .filter((a): a is [number, number] => Array.isArray(a) && isNum(a[0]) && isNum(a[1]))
      .slice(0, MAX_BENDS).map(a => [r1(a[0]), r1(a[1])] as [number, number]);
    const line: Line = { k: l.k, pts, off: !!l.off };
    if (typeof l.follow === 'number' && l.follow > 0 && l.follow < 1000) line.follow = Math.floor(l.follow);
    if (l.opt) line.opt = true;
    if (typeof l.via === 'string' && l.via) line.via = l.via.slice(0, 80);
    out.lines.push(line);
  }

  const hc = headcountOf(p.headcount), roles = rolesOf(p.roles);
  if (hc !== undefined) out.headcount = hc;
  if (roles) out.roles = roles;

  out.updatedAt = typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) && p.updatedAt > 0 ? Math.floor(p.updatedAt) : 0;
  const b = p.built as { order?: unknown; at?: unknown } | null | undefined;
  if (b && (b.order === 'greedy' || b.order === 'checklist')) {
    out.built = { order: b.order as BuildOrder, at: typeof b.at === 'number' && Number.isFinite(b.at) ? Math.floor(b.at) : 0 };
  }
  return out;
}

/** Two plans are the same plan when nothing an officer drew differs (the clock and the build stamp do not count). */
export function planSame(a: Plan | null | undefined, b: Plan | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return JSON.stringify([a.pins, a.lines, a.hiddenTracks, a.splits, a.headcount ?? null, a.roles ?? null]) === JSON.stringify([b.pins, b.lines, b.hiddenTracks, b.splits, b.headcount ?? null, b.roles ?? null]);
}

// ── pins, wherever they live ─────────────────────────────────────────────────

/** Every pin: the main route, then each split's branches in order. */
export const allPins = (plan: Plan): Pin[] => [...plan.pins, ...plan.splits.flatMap(s => s.branches.flatMap(b => b.pins))];

/** A plan with no pins anywhere is not worth a version. */
export const planEmpty = (p: Plan) => allPins(p).length === 0;

export type PinHome = { pin: Pin; list: Pin[]; index: number; split?: Split; branch?: Branch; branchIndex?: number };

export function findPin(plan: Plan, id: string): PinHome | null {
  let i = plan.pins.findIndex(p => p.id === id);
  if (i >= 0) return { pin: plan.pins[i], list: plan.pins, index: i };
  for (const split of plan.splits) {
    for (let bi = 0; bi < split.branches.length; bi++) {
      const branch = split.branches[bi];
      i = branch.pins.findIndex(p => p.id === id);
      if (i >= 0) return { pin: branch.pins[i], list: branch.pins, index: i, split, branch, branchIndex: bi };
    }
  }
  return null;
}

/** Remove a pin. Deleting a split's start or regroup pin removes that split (its branch pins go with it). */
export function removePin(plan: Plan, id: string): { removed: boolean; droppedSplit: boolean } {
  const home = findPin(plan, id);
  if (!home) return { removed: false, droppedSplit: false };
  home.list.splice(home.index, 1);
  const before = plan.splits.length;
  plan.splits = plan.splits.filter(s => s.from !== id && s.to !== id);
  return { removed: true, droppedSplit: plan.splits.length !== before };
}

/** A label for a branch pin: its team letter and its place in the branch (A1, A2, B1 ...). */
export const branchPinLabel = (branchIndex: number, index: number) => `${String.fromCharCode(65 + branchIndex)}${index + 1}`;

// ── legs ─────────────────────────────────────────────────────────────────────

/** The main-route pins the route runs through: all of them, or without the optional ones. */
export const routePins = (plan: Plan, skipOptional: boolean): Pin[] => (skipOptional ? plan.pins.filter(p => !p.optional) : plan.pins);

export type LegBranch = { split: Split; branch: Branch; branchIndex: number };
export type Leg = {
  a: Pin; b: Pin; k: string; ln: Line | undefined; pts: [number, number][]; off: boolean;
  optLeg: boolean;                 // the leg itself is marked optional (dashed, out of the totals)
  jump?: { label: string; from: [number, number]; to: [number, number] };   // goes through a teleport: drawn, not counted
  dashed: boolean;                 // optional leg, or either end is an optional pin
  idx: number;                     // 0-based position in the leg list
  branch?: LegBranch;              // set for a leg inside a split's branch
};

/** The splits that can be drawn: start and regroup are neighbours in the route. */
export function activeSplits(plan: Plan, skipOptional: boolean): Map<string, Split> {
  const rp = routePins(plan, skipOptional);
  const out = new Map<string, Split>();
  for (const s of plan.splits) {
    const i = rp.findIndex(p => p.id === s.from);
    if (i >= 0 && rp[i + 1] && rp[i + 1].id === s.to) out.set(s.from, s);
  }
  return out;
}

/** A branch's pins as the route sees them (optional pins dropped when they are skipped). */
const branchPins = (b: Branch, skip: boolean) => (skip ? b.pins.filter(p => !p.optional) : b.pins);

/**
 * One leg between each pair of neighbouring route pins, with the bends and flags the plan holds for it. A split replaces the
 * leg from its start to its regroup pin by one run of legs per branch (start -> branch pins -> regroup); a branch with no
 * pins draws nothing. In "skip optional" mode a leg marked optional is left out too.
 */
export function planLegs(plan: Plan, skipOptional: boolean, links: readonly ZoneLink[] = []): Leg[] {
  const rp = routePins(plan, skipOptional);
  const splits = activeSplits(plan, skipOptional);
  const out: Leg[] = [];
  const push = (a: Pin, b: Pin, branch?: LegBranch) => {
    const k = a.id + '>' + b.id;
    const ln = plan.lines.find(x => x.k === k);
    const optLeg = !!(ln && ln.opt);
    if (skipOptional && optLeg) return;
    const tp = ln && ln.via ? links.find(t => t.kind === 'teleport' && t.to && t.label === ln.via) : undefined;
    const leg: Leg = { a, b, k, ln, pts: ln ? ln.pts : [], off: ln ? ln.off : false, optLeg, dashed: a.optional || b.optional || optLeg, idx: out.length, branch };
    if (tp && tp.to) leg.jump = { label: tp.label, from: [tp.from[0], tp.from[1]], to: [tp.to[0], tp.to[1]] };
    out.push(leg);
  };
  for (let i = 0; i + 1 < rp.length; i++) {
    const a = rp[i], b = rp[i + 1];
    const split = splits.get(a.id);
    if (!split) { push(a, b); continue; }
    split.branches.forEach((branch, branchIndex) => {
      const seq = [a, ...branchPins(branch, skipOptional), b];
      if (seq.length === 2) return;
      for (let j = 0; j + 1 < seq.length; j++) push(seq[j], seq[j + 1], { split, branch, branchIndex });
    });
  }
  return out;
}

/** The leg as a polyline: start, the bends, (the teleport in and out), end. */
export const legPoly = (L: Pick<Leg, 'a' | 'b' | 'pts'> & { jump?: Leg['jump'] }): [number, number][] =>
  [[L.a.x, L.a.y], ...L.pts, ...(L.jump ? [L.jump.from, L.jump.to] : []), [L.b.x, L.b.y]];

export function polyLen(poly: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 1; i < poly.length; i++) s += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  return s;
}

/** How far the leg walks: its polyline, without the teleport jump. */
export const legLength = (L: Pick<Leg, 'a' | 'b' | 'pts'> & { jump?: Leg['jump'] }): number =>
  polyLen(legPoly(L)) - (L.jump ? Math.hypot(L.jump.to[0] - L.jump.from[0], L.jump.to[1] - L.jump.from[1]) : 0);

/** Lines whose pins are gone, or that say nothing, are dropped. */
export function pruneLines(plan: Plan): void {
  const ids = new Set(allPins(plan).map(p => p.id));
  plan.lines = plan.lines.filter(l => {
    const [a, b] = l.k.split('>');
    return ids.has(a) && ids.has(b) && (l.pts.length || l.off || l.opt || l.via);
  });
}

// ── totals ───────────────────────────────────────────────────────────────────

export type LegTime = { median: number | null };
export type BranchTotal = { label: string; color: string; pathU: number; timeS: number | null; legs: number };
export type SplitTotal = { split: Split; branches: BranchTotal[]; slowest: number | null; pathU: number };
export type Totals = {
  pathU: number;                   // main legs + the longest branch of each split; hidden and optional legs not counted
  timeS: number;                   // recorded medians: main legs + the slowest branch of each split; optional legs not counted
  timedLegs: number;
  countedLegs: number;
  splits: SplitTotal[];
};

/**
 * The totals under the leg table. A leg marked optional, or hidden, is not in the drawn path; a split counts for its
 * slowest branch (by recorded time) and its longest (by path), because the raid regroups when the last branch is done.
 */
export function planTotals(legs: readonly Leg[], medianOf: (l: Leg) => number | null): Totals {
  const t: Totals = { pathU: 0, timeS: 0, timedLegs: 0, countedLegs: 0, splits: [] };
  const by = new Map<string, SplitTotal>();
  for (const l of legs) {
    const counted = !l.optLeg;
    const path = counted && !l.off ? legLength(l) : 0;
    const med = counted ? medianOf(l) : null;
    if (counted) t.countedLegs++;
    if (!l.branch) {
      t.pathU += path;
      if (med != null) { t.timeS += med; t.timedLegs++; }
      continue;
    }
    let st = by.get(l.branch.split.id);
    if (!st) { st = { split: l.branch.split, branches: l.branch.split.branches.map(b => ({ label: b.label, color: b.color, pathU: 0, timeS: 0, legs: 0 })), slowest: null, pathU: 0 }; by.set(l.branch.split.id, st); t.splits.push(st); }
    const bt = st.branches[l.branch.branchIndex];
    bt.pathU += path; bt.legs++;
    if (med != null && bt.timeS != null) { bt.timeS += med; t.timedLegs++; }
    else if (counted && med == null) bt.timeS = null;       // a branch with a leg nobody walked has no honest time
  }
  for (const st of t.splits) {
    st.pathU = Math.max(0, ...st.branches.map(b => b.pathU));
    const timed = st.branches.filter(b => b.timeS != null && b.legs > 0).map(b => b.timeS as number);
    st.slowest = timed.length ? Math.max(...timed) : null;
    t.pathU += st.pathU;
    if (st.slowest != null) t.timeS += st.slowest;
  }
  return t;
}

// ── headcount (off-night planning: how few raiders can do it) ────────────────

export type Headcount = {
  main: number | null;                           // raiders on the main route
  peak: number | null;                           // the most raiders needed at once: the main group, or a split's branches added up
  splits: { split: Split; sum: number | null; known: boolean }[];
};

/**
 * Planned raiders. While the raid is together it needs `plan.headcount`; while it is split it needs every branch's
 * headcount added up. The plan needs the larger of the two. A number nobody filled in is unknown, not zero: `peak` is
 * null when nothing is filled in at all.
 */
export function plannedHeadcount(plan: Plan): Headcount {
  const main = plan.headcount ?? null;
  const splits = plan.splits.map(split => {
    const known = split.branches.every(b => b.headcount !== undefined);
    const sum = split.branches.some(b => b.headcount !== undefined) ? split.branches.reduce((a, b) => a + (b.headcount ?? 0), 0) : null;
    return { split, sum, known };
  });
  const all = [main, ...splits.map(s => s.sum)].filter((n): n is number => n !== null);
  return { main, peak: all.length ? Math.max(...all) : null, splits };
}

// ── floors ───────────────────────────────────────────────────────────────────

/** The floor a height is on: the first band that holds it. Null when z is unknown or no band holds it. */
export function floorOf(floors: readonly Floor[], z: number | undefined | null): Floor | null {
  if (typeof z !== 'number' || !Number.isFinite(z)) return null;
  return floors.find(f => (f.zmin === undefined || z >= f.zmin) && (f.zmax === undefined || z <= f.zmax)) ?? null;
}
