// /pop matrix, alts grouped under their main (the guild lead, 2026-10-14: "Lets group the flagging for alts by main
// with collapse turned on, we can expand all from a button. Then if we want to sort by latest changes, highlight the
// things that have changed in the last day, and last 3 days."). Beta comparison: ?alts=group, with &sort=latest and
// &open=1. Without ?alts=group the page is what production shows.
//
// Everything here is pure, so test/pop-alt-groups.test.js runs it for real.
//
// WHAT COUNTS AS A CHANGE (the same bar as the Latest flags strip, web/lib/popLatestFlags.ts, plus the checklist):
//   event      the server's own flag line                       counts
//   checklist  a kill without the step before it                counts
//   recital    an NPC reciting the flags back                   counts ONLY for a flag that row newly added
//   hail_witnessed                                              never: evidence of a hail, not a flag
// A recital restates flags the character already held, so its earned_at is when it was SEEN, not when the flag was
// earned. It is a change only when no earlier row (any source) holds the same flag for that character. A character's
// FIRST recital therefore marks every flag it recites as new at that moment: with no earlier row, that is the only
// time we know of.

import { agoText, dropImplied, stepLabel } from './popLatestFlags';

export const DAY_MS = 86_400_000;
export const RECENT_DAYS = 3;

export type ChangeSourceRow = { character: string; flag_key: string; source: string; earned_at: string };
export type ChangeEntry = { key: string; at: number };

// Rows that can never be a flag change, whatever else is true of them.
const NEVER = new Set(['hail', 'unmapped']);

// Newest counted change per (character, flag), newest first, keyed by lowercase character name.
export function changesByCharacter(rows: ChangeSourceRow[]): Map<string, ChangeEntry[]> {
  const ordered = rows
    .map(r => ({ ...r, t: Date.parse(r.earned_at), k: String(r.character ?? '').toLowerCase() }))
    .filter(r => r.k && Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  const seen = new Set<string>();
  const newest = new Map<string, number>();   // `${char}|${flag}` -> newest counted at
  for (const r of ordered) {
    const id = `${r.k}|${r.flag_key}`;
    const firstRowForFlag = !seen.has(id);
    seen.add(id);
    if (r.source === 'hail_witnessed' || NEVER.has(r.flag_key)) continue;
    if (r.source === 'recital' && !firstRowForFlag) continue;
    if (r.source !== 'recital' && r.source !== 'event' && r.source !== 'checklist') continue;
    newest.set(id, Math.max(newest.get(id) ?? 0, r.t));
  }
  const out = new Map<string, ChangeEntry[]>();
  for (const [id, at] of newest) {
    const cut = id.indexOf('|');
    const k = id.slice(0, cut);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ key: id.slice(cut + 1), at });
  }
  for (const list of out.values()) list.sort((a, b) => b.at - a.at);
  return out;
}

export type ChangeLevel = 'day' | 'recent' | null;

// Within 24 h is 'day'; within 3 days is 'recent'. A time a little in the future (clock skew) is 'day'.
export function levelOf(nowMs: number, atMs: number | null | undefined): ChangeLevel {
  if (atMs == null || !Number.isFinite(atMs)) return null;
  const age = nowMs - atMs;
  if (age <= DAY_MS) return 'day';
  if (age <= RECENT_DAYS * DAY_MS) return 'recent';
  return null;
}

// The steps changed within the last 3 days, newest first, a step another one in the list proves left out.
export function recentSteps(entries: ChangeEntry[] | undefined, nowMs: number): { key: string; label: string; at: number; level: ChangeLevel }[] {
  const within = (entries ?? []).filter(e => levelOf(nowMs, e.at) !== null);
  const keep = new Set(dropImplied(within.map(e => e.key)));
  return within.filter(e => keep.has(e.key))
    .map(e => ({ key: e.key, label: stepLabel(e.key), at: e.at, level: levelOf(nowMs, e.at) }));
}

export type Family<T> = {
  head: T;
  alts: T[];
  latestAt: number | null;      // newest change across the head and its alts
  latestBy: string | null;      // who carried it
  headAt: number | null;        // the head's own newest change
};

type GroupOpts = {
  // Lowercase character -> lowercase name of its main (characters.main_name), or null when it has none.
  rootOf: (lower: string) => string | null;
  // Newest counted change of a character, ms, or null.
  latestOf: (lower: string) => number | null;
  sort: 'default' | 'latest';
};

// Put each character under its main when that main is in the list too. A character whose main is not in the list
// (no main on record, or a main that is filtered out) stands alone as a head, so nothing is dropped. Input order is
// kept for ties and for the default sort; 'latest' orders heads by their whole family's newest change and alts by
// their own, a character with no change last.
export function groupFamilies<T extends { name: string }>(chars: T[], opts: GroupOpts): Family<T>[] {
  const { rootOf, latestOf, sort } = opts;
  const byLower = new Map(chars.map(c => [c.name.toLowerCase(), c]));
  // Follow main_name up to a character in the list. null = it did not settle (a loop, or a chain longer than a
  // family ever is); such a character stands alone. What walk() returns is a character with no main in the list,
  // so it is its own head and every character lands in exactly one family.
  const walk = (lower: string): string | null => {
    let cur = lower;
    for (let i = 0; i < 6; i++) {
      const up = rootOf(cur);
      if (!up || up === cur || !byLower.has(up)) return cur;
      cur = up;
    }
    return null;
  };
  const headLower = (lower: string): string => walk(lower) ?? lower;
  const fam = new Map<string, Family<T>>();
  for (const c of chars) {
    const lower = c.name.toLowerCase();
    const h = headLower(lower);
    if (!fam.has(h)) fam.set(h, { head: byLower.get(h)!, alts: [], latestAt: null, latestBy: null, headAt: null });
    if (h !== lower) fam.get(h)!.alts.push(c);
  }
  const idx = new Map(chars.map((c, i) => [c.name.toLowerCase(), i]));
  const newestFirst = (a: T, b: T) => {
    const x = latestOf(a.name.toLowerCase()), y = latestOf(b.name.toLowerCase());
    return (y ?? -Infinity) - (x ?? -Infinity) || (idx.get(a.name.toLowerCase())! - idx.get(b.name.toLowerCase())!);
  };
  const out = [...fam.values()];
  for (const f of out) {
    if (sort === 'latest') f.alts.sort(newestFirst);
    f.headAt = latestOf(f.head.name.toLowerCase());
    for (const m of [f.head, ...f.alts]) {
      const at = latestOf(m.name.toLowerCase());
      if (at != null && (f.latestAt == null || at > f.latestAt)) { f.latestAt = at; f.latestBy = m.name; }
    }
  }
  // A family sits where its head sits in the input (an alt with more flags than its main does not pull it up).
  const headIdx = (f: Family<T>) => idx.get(f.head.name.toLowerCase())!;
  out.sort((a, b) => (sort === 'latest' ? (b.latestAt ?? -Infinity) - (a.latestAt ?? -Infinity) : 0) || headIdx(a) - headIdx(b));
  return out;
}

// "3 alts · newest flag 2d ago on Brackwyn" (the "on" only when an alt carried it). No change at all says so.
export function familySummary<T extends { name: string }>(f: Family<T>, nowMs: number): string {
  const n = f.alts.length;
  const alts = `${n} alt${n === 1 ? '' : 's'}`;
  if (f.latestAt == null) return `${alts} · no flag changes recorded`;
  const by = f.latestBy && f.latestBy.toLowerCase() !== f.head.name.toLowerCase() ? ` on ${f.latestBy}` : '';
  return `${alts} · newest flag ${agoText(nowMs, f.latestAt)}${by}`;
}

export const familyLevel = <T extends { name: string }>(f: Family<T>, nowMs: number): ChangeLevel => levelOf(nowMs, f.latestAt);

export type AltsView = { group: boolean; sort: 'flags' | 'latest'; open: boolean };

// ?alts=group turns the grouping on; ?sort=latest and ?open=1 only mean anything with it. Raw input is whitelisted
// here so a hand-edited URL cannot carry anything else into a link.
export function parseAltsView(p: { alts?: string; sort?: string; open?: string }): AltsView {
  const group = p.alts === 'group';
  return { group, sort: group && p.sort === 'latest' ? 'latest' : 'flags', open: group && p.open === '1' };
}
