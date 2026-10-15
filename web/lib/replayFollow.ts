// /spectator/replay: highlighting and following raiders, and the URL that carries it. The pure parts, with no
// React and no three.js, so the board, the 3D view and the tests share one copy of the rules.
//
// URL (`?follow=Name&hl=Name,Name&split=off`): the picks are names of guild raiders. The page is members-only,
// so a link only shows them to a signed-in member; nothing here is sent anywhere. `hl` lists the highlighted
// raiders; `follow` is one of them (it is highlighted too), and `split` is omitted for Auto.

import type { ReplayFrame } from './raidReplay';

export const MAX_PICKS = 12;
const MAX_NAME = 32;

export type SplitMode = 'auto' | 'off';
/** `hl` always includes `follow` while it is set, so "who is highlighted" is one list. */
export type Picks = { follow: string | null; hl: string[]; split: SplitMode };
export const NO_PICKS: Picks = { follow: null, hl: [], split: 'auto' };

const key = (s: string) => s.toLowerCase();
const clean = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/[\u0000-\u001f]/g, '').trim();
  return t && t.length <= MAX_NAME ? t : null;
};

/** Names are compared without case: a typed or pasted link need not match the capitals. */
export function pickedSet(p: Picks): Set<string> {
  return new Set(p.hl.map(key));
}
export const isPicked = (set: ReadonlySet<string>, name: string) => set.has(key(name));
export const isFollowed = (p: Picks, name: string) => p.follow !== null && key(p.follow) === key(name);

/** `location.search` -> picks. Anything malformed is ignored; more than MAX_PICKS is cut. */
export function parsePicks(search: string): Picks {
  const q = new URLSearchParams(search);
  const follow = clean(q.get('follow'));
  const hl: string[] = [];
  const seen = new Set<string>();
  for (const raw of [follow, ...(q.get('hl') ?? '').split(',')]) {
    const n = clean(raw);
    if (!n || seen.has(key(n))) continue;
    seen.add(key(n));
    hl.push(n);
    if (hl.length >= MAX_PICKS) break;
  }
  return {
    follow: follow && seen.has(key(follow)) ? follow : null,
    hl,
    split: q.get('split') === 'off' ? 'off' : 'auto',
  };
}

/** Picks -> the query string to put on the page (with its `?`, or '' when there is nothing), keeping unrelated params. */
export function picksSearch(p: Picks, current = ''): string {
  const q = new URLSearchParams(current);
  for (const k of ['follow', 'hl', 'split']) q.delete(k);
  if (p.follow) q.set('follow', p.follow);
  const rest = p.hl.filter(n => !p.follow || key(n) !== key(p.follow));
  if (rest.length) q.set('hl', rest.join(','));
  if (p.split === 'off') q.set('split', 'off');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Tap or click a raider. Adding the FIRST pick also follows it; adding more only highlights. Removing the
 * followed one hands the follow to the last pick left if exactly one is, else drops it.
 */
export function togglePick(p: Picks, name: string): Picks {
  const have = p.hl.some(n => key(n) === key(name));
  if (!have) {
    if (p.hl.length >= MAX_PICKS) return p;
    return { ...p, hl: [...p.hl, name], follow: p.hl.length === 0 ? name : p.follow };
  }
  const hl = p.hl.filter(n => key(n) !== key(name));
  const wasFollow = isFollowed(p, name);
  return { ...p, hl, follow: wasFollow ? (hl.length === 1 ? hl[0] : null) : p.follow };
}

/** The follow button on a picked raider: follow it (highlighting it too), or stop. */
export function toggleFollow(p: Picks, name: string): Picks {
  if (isFollowed(p, name)) return { ...p, follow: null };
  const hl = p.hl.some(n => key(n) === key(name)) ? p.hl : [...p.hl, name].slice(0, MAX_PICKS);
  return { ...p, hl, follow: name };
}

// ── The picker's list ──────────────────────────────────────────────────────

export type RosterEntry = { name: string; cls: string | null };

/** Adds every raider in `frames` to `into` (keyed by lower-case name). Returns true when something new was added. */
export function collectRoster(frames: readonly ReplayFrame[], into: Map<string, RosterEntry>): boolean {
  let added = false;
  for (const f of frames) {
    for (const r of f.raiders) {
      const k = key(r.name);
      const have = into.get(k);
      if (!have) { into.set(k, { name: r.name, cls: r.cls }); added = true; }
      else if (!have.cls && r.cls) have.cls = r.cls;
    }
  }
  return added;
}

export type RosterGroup = { label: string; raiders: RosterEntry[] };

/** Search, then group: by class (classes A-Z, raiders A-Z inside) or one A-Z list. A blank query keeps everyone. */
export function groupRoster(roster: Iterable<RosterEntry>, query: string, by: 'class' | 'alpha'): RosterGroup[] {
  const q = key(query.trim());
  const list = [...roster]
    .filter(r => !q || key(r.name).includes(q) || (r.cls ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (by === 'alpha') return list.length ? [{ label: 'All raiders', raiders: list }] : [];
  const m = new Map<string, RosterEntry[]>();
  for (const r of list) {
    const c = r.cls || 'Unknown class';
    const a = m.get(c);
    if (a) a.push(r); else m.set(c, [r]);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, raiders]) => ({ label, raiders }));
}

// ── The follow camera ──────────────────────────────────────────────────────

export const FOLLOW_TAU_MS = 220;      // how fast the camera closes on a newly followed raider
export const FOLLOW_SETTLED = 0.5;     // an offset shorter than this (world units) is "arrived"

export type Offset = { x: number; y: number };

/**
 * The camera sits at (followed raider + offset). The raider's own movement carries the camera with it, so
 * playback has no lag at any speed; only the OFFSET decays. It starts as (where the camera was - where the
 * raider is) when a follow begins, which is the glide to a newly picked raider, and is zero otherwise. A scrub
 * does not glide: the raider jumps, the camera goes with it. Exponential, so it is frame-rate independent.
 */
export function decayOffset(o: Offset, dtMs: number, tau = FOLLOW_TAU_MS): Offset {
  const k = Math.exp(-Math.max(0, dtMs) / tau);
  const x = o.x * k, y = o.y * k;
  return Math.hypot(x, y) < FOLLOW_SETTLED ? { x: 0, y: 0 } : { x, y };
}

export const offsetSettled = (o: Offset) => o.x === 0 && o.y === 0;
