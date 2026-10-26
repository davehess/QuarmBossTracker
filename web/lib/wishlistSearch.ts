// The /me/wishlist search box: how the typed text becomes a query, and how the answers are ordered. Pure.
//
// Scope (the guild lead, 2026-10-26: "search ANY item by name and add it"): every row of eqemu_items with id > 0,
// not only items known to drop. The bot's own rule for /wishlist add is "the item exists", and a drop table cannot
// name quest rewards, crafted pieces or vendor items a member still wants. Twenty rows come back, id, name, icon
// and slots only (action: app/me/wishlist/actions.ts).

export const SEARCH_LIMIT = 20;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 60;

/**
 * The text to search eqemu_items for, or null when it is too short to mean anything. LIKE wildcards (and the `*`
 * PostgREST reads as one) are removed so a typed `%` cannot widen the search, and white space is collapsed.
 */
export function normaliseSearch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[%_*\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX).trim();
  return t.length >= SEARCH_MIN ? t : null;
}

/** Names that START with the text first, then names that merely contain it, each id once, at most SEARCH_LIMIT. */
export function mergeSearch<T extends { id: number }>(prefix: T[], contains: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of [...prefix, ...contains]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= SEARCH_LIMIT) break;
  }
  return out;
}
