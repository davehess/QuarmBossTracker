// /pop "PoP spells still need" — the class filter and the column sort, as pure functions.
//
// The guild lead, 2026-10-09: "add sorting and filtering to the pop spells section by class". Both live in the
// URL (?pclass=enc,wiz &psort=total &pdir=asc) and are applied on the server, so a filtered or sorted view is a
// plain link that works without JS. Nothing here reads raw input back out: a param is only ever matched against
// a whitelist (the sort keys, the classes actually present in the rows) and the page prints the whitelist's
// own labels.

import { POP_TURN_INS, POP_TURN_IN_ORDER, type TurnInKey } from './popSpells';
import { canonicalClass, classAbbr } from './spectator';

export type SortKey = 'name' | 'class' | 'level' | TurnInKey | 'other' | 'total';
export type SortDir = 'asc' | 'desc';

export const SORT_KEYS: SortKey[] = ['name', 'class', 'level', ...POP_TURN_IN_ORDER, 'other', 'total'];

/** The order the table has always had: highest level first, ties by name. */
export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'level', dir: 'desc' };

/** The first click on a header: names and classes read A-Z, counts and levels biggest first. */
export const firstDir = (key: SortKey): SortDir => (key === 'name' || key === 'class' ? 'asc' : 'desc');

/** Column title, shared by the header and the "sorted by" line. */
export function sortLabel(key: SortKey): string {
  if (key === 'name') return 'Character';
  if (key === 'class') return 'Class';
  if (key === 'level') return 'Level';
  if (key === 'other') return 'Other';
  if (key === 'total') return 'Total';
  return POP_TURN_INS[key].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word');
}

/** The minimum a row needs for the helpers below; the page's NeedByChar fits it. */
export type NeedRowLike = {
  name: string; cls: string | null; level: number | null;
  tiers: Record<TurnInKey, readonly unknown[]>; other: readonly unknown[]; total: number;
};

export const UNKNOWN_CLASS = 'unk';

/** A class as it is written in the URL: the repo's three-letter abbreviation, lowercased ("Shadow Knight" -> "shd"). */
export function classKey(cls: string | null | undefined): string {
  const c = canonicalClass(cls);
  return c ? classAbbr(c).toLowerCase() : UNKNOWN_CLASS;
}

/** What a class key reads as on screen. Only ever called with a key that came from classKey. */
export function classLabel(key: string, rows: readonly NeedRowLike[] = []): string {
  if (key === UNKNOWN_CLASS) return 'Unknown class';
  const hit = rows.find(r => classKey(r.cls) === key);
  return (hit && canonicalClass(hit.cls)) || key.toUpperCase();
}

export type ClassCount = { key: string; label: string; count: number };

/** One entry per class present, with how many rows it has: A-Z, "Unknown class" last. */
export function classCounts(rows: readonly NeedRowLike[]): ClassCount[] {
  const by = new Map<string, ClassCount>();
  for (const r of rows) {
    const key = classKey(r.cls);
    const e = by.get(key);
    if (e) e.count++; else by.set(key, { key, label: classLabel(key, [r]), count: 1 });
  }
  return [...by.values()].sort((a, b) =>
    (a.key === UNKNOWN_CLASS ? 1 : 0) - (b.key === UNKNOWN_CLASS ? 1 : 0) || a.label.localeCompare(b.label));
}

export type PopSpellView = {
  /** Selected class keys, in the order the chips appear; always a subset of the classes present. */
  classes: string[];
  sort: SortKey;
  dir: SortDir;
  /** A class is picked. */
  filtered: boolean;
  /** The sort is not "highest level first". */
  sorted: boolean;
};

type Param = string | string[] | undefined;
const first = (p: Param): string => (Array.isArray(p) ? p[0] : p) ?? '';

/** Read ?pclass / ?psort / ?pdir. Anything not on a whitelist falls back to the default; nothing is reflected. */
export function parsePopSpellView(
  sp: { pclass?: Param; psort?: Param; pdir?: Param },
  classesPresent: readonly string[],
): PopSpellView {
  const asked = new Set(first(sp.pclass).slice(0, 200).toLowerCase().split(',').map(s => s.trim()));
  const classes = classesPresent.filter(k => asked.has(k));
  const rawSort = first(sp.psort).toLowerCase();
  const sort = (SORT_KEYS as string[]).includes(rawSort) ? (rawSort as SortKey) : DEFAULT_SORT.key;
  const rawDir = first(sp.pdir).toLowerCase();
  const dir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : (sort === DEFAULT_SORT.key ? DEFAULT_SORT.dir : firstDir(sort));
  return { classes, sort, dir, filtered: classes.length > 0, sorted: sort !== DEFAULT_SORT.key || dir !== DEFAULT_SORT.dir };
}

/** The view as URL params; only what differs from the default, so an unfiltered page keeps its plain link. */
export function viewParams(v: PopSpellView): { pclass: string | null; psort: string | null; pdir: string | null } {
  return {
    pclass: v.classes.length ? v.classes.join(',') : null,
    psort: v.sorted ? v.sort : null,
    pdir: v.sorted ? v.dir : null,
  };
}

/** The rows of the selected classes, or all of them when none is selected. */
export function filterNeeds<T extends NeedRowLike>(rows: readonly T[], classes: readonly string[]): T[] {
  if (!classes.length) return [...rows];
  return rows.filter(r => classes.includes(classKey(r.cls)));
}

const value = (r: NeedRowLike, key: SortKey): number | string | null => {
  if (key === 'name') return r.name.toLowerCase();
  if (key === 'class') return r.cls ? (canonicalClass(r.cls) ?? r.cls).toLowerCase() : null;
  if (key === 'level') return r.level;
  if (key === 'other') return r.other.length;
  if (key === 'total') return r.total;
  return r.tiers[key].length;
};

/** Sort by one column. Ties always fall to level (highest first) then name, so the order never jitters; an unknown class or level goes last either way. */
export function sortNeeds<T extends NeedRowLike>(rows: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, key), y = value(b, key);
    if (x !== y) {
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      if (c) return c * sign;
    }
    return (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name);
  });
}

/** The aria-sort value for a column header. */
export function ariaSortFor(v: Pick<PopSpellView, 'sort' | 'dir'>, key: SortKey): 'ascending' | 'descending' | 'none' {
  return v.sort !== key ? 'none' : v.dir === 'asc' ? 'ascending' : 'descending';
}

/** Where a header click goes: the opposite direction on the sorted column, its first direction on any other. */
export function nextSort(v: Pick<PopSpellView, 'sort' | 'dir'>, key: SortKey): { key: SortKey; dir: SortDir } {
  return { key, dir: v.sort === key ? (v.dir === 'asc' ? 'desc' : 'asc') : firstDir(key) };
}

/** The classes after a chip click: toggled in or out, kept in the order the chips appear. */
export function toggleClass(v: Pick<PopSpellView, 'classes'>, key: string, present: readonly string[]): string[] {
  const next = new Set(v.classes);
  if (next.has(key)) next.delete(key); else next.add(key);
  return present.filter(k => next.has(k));
}

/** "No Enchanter is missing a PoP spell" / "No Enchanter or Wizard is missing a PoP spell". */
export function emptyFilteredText(labels: readonly string[]): string {
  return `No ${labels.join(' or ')} is missing a PoP spell`;
}
