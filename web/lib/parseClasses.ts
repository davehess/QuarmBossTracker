// Which class a parse row's player is, from the strongest source that knows (the parse page's "Damage by class" panel
// and the "Damage over the fight" chart both read this, so they can never disagree).
//
// Why this exists (the guild lead, 2026-10-26, a foreign-guild wipe): the page showed "UNKNOWN" AND "Unknown" as two
// buckets, and neither was unknown. The OpenDKP mirror (`characters`) stores the literal strings 'UNKNOWN' and
// 'Unknown' as a class for a toon nobody registered. Both are truthy, so they (1) counted as a resolved class and
// stopped the /who lookup from ever running for that player, and (2) formed a bucket of their own beside the 'Unknown'
// the page wrote for a null. A sentinel is "no answer", never a class.

import { normalizeClass } from './class-titles';

/** The one label for a player no source resolves. */
export const CLASS_NOT_KNOWN = 'Class not known';

/** A real class, or null. Rejects the sentinels sources write when they do not know ('UNKNOWN', 'Unknown', 'unk', '?',
 *  '—', blank) in any case, and folds /who level titles ("Grave Lord") to the base class so one class is one bucket. */
export function realClass(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^(unknown|unk|none|null|n\/a|\?+|[-—–]+)$/i.test(s)) return null;
  return normalizeClass(s);
}

/** One source of classes: given the names still unresolved, return what it knows (keys are lower-case names; values
 *  may be sentinels or null — they are cleaned here). A loader that throws counts as knowing nothing. */
export type ClassLoader = (missing: string[]) => Promise<Map<string, string | null | undefined>>;

/**
 * Resolve classes through `loaders` in order. Each loader is asked ONLY about the names every earlier one failed on, so a
 * source that is rarely needed (the live raid roster) costs one tiny read, and an empty `missing` costs none.
 * Returns lower-case name → base class for every name some source resolved; absent = no source knows.
 */
export async function resolveClasses(
  names: string[],
  loaders: ClassLoader[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const load of loaders) {
    const missing = names.filter(n => !out.has(n.toLowerCase()));
    if (missing.length === 0) break;
    let found: Map<string, string | null | undefined>;
    try { found = await load(missing); } catch { continue; }
    for (const n of missing) {
      const c = realClass(found.get(n.toLowerCase()));
      if (c) out.set(n.toLowerCase(), c);
    }
  }
  return out;
}

/** The bucket label a row goes under in a by-class roll-up: its class, or the single unknown label. */
export function classBucket(klass: string | null | undefined): string {
  return realClass(klass) ?? CLASS_NOT_KNOWN;
}
