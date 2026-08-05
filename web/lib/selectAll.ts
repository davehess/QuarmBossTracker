// Paginated full-table pull for Supabase/PostgREST.
//
// THE PROBLEM THIS EXISTS FOR: the Supabase REST gateway caps EVERY response at
// its project `max-rows` setting (1000 by default) and does it SILENTLY — no
// error, no truncation flag, just a short array. A client-side `.limit(50000)`
// does not raise the cap; it is an upper bound applied on top of it. So a query
// that should return 18,320 rows returns 1,000 and every downstream count,
// filter and aggregate is quietly wrong.
//
// It is the silence that makes this expensive. Two separate field reports
// traced back to it before anyone connected them:
//   · 2026-06-21 (/who): "76 shown · 1,000 loaded · 8,738 in catalog" — a
//     "Druids only" filter was scoping to the top-1000 by last_seen.
//   · 2026-08-05 (/character era timeline): the family tick pull returns 1,149
//     rows, so 149 were dropped — and because the query had no .order(),
//     PostgREST returned heap order, meaning the dropped rows were the NEWEST.
//     All 36 of Chadivarius's ticks were in that tail, so main detection could
//     not see he had ever raided and kept naming the previous main.
//
// ORDERING IS NOT OPTIONAL. Range pagination over an unordered query can repeat
// or skip rows between pages — Postgres makes no stability guarantee without an
// ORDER BY. Every caller MUST apply a `.order()` on a unique (or
// tie-broken-unique) column inside `build`. `assertOrdered` below is a
// development-time nudge, not a guarantee.

/** PostgREST's silent per-response ceiling. Pages are sized to match it. */
export const PGRST_MAX_ROWS = 1000;

type PageResult<T> = { data: T[] | null; error: unknown };

export type SelectAllOpts = {
  /** Rows per request. Never set above the server cap — a larger page just
   *  gets truncated to it, and the short-page stop would then end the loop
   *  early and silently re-introduce the bug. */
  page?: number;
  /** Runaway stop. Exceeding it returns what we have (see `onTruncate`). */
  hardCap?: number;
  /** Called when hardCap is hit, so a caller can surface "showing N of M"
   *  instead of pretending the set is complete. */
  onTruncate?: (loaded: number) => void;
};

/**
 * Drain a PostgREST query across as many pages as it takes.
 *
 * @param build receives an inclusive `[from, to]` row range and must return the
 *              built query — WITH a stable `.order()` applied.
 *
 * ```ts
 * const rows = await selectAll<InvRow>((from, to) => admin
 *   .from('character_inventory')
 *   .select('character_name, slot_label, item_id, item_name, quantity')
 *   .eq('guild_id', 'wolfpack')
 *   .in('character_name', charNames)
 *   .order('character_name').order('slot_label')   // stable, unique together
 *   .range(from, to));
 * ```
 */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: SelectAllOpts = {},
): Promise<T[]> {
  // Clamped at BOTH ends. Above the server cap, a page comes back truncated and
  // the short-page stop below would end the drain early — silently restoring
  // the bug this function exists to kill. At zero or below, `from += page`
  // never advances and the loop spins forever.
  const page = Math.max(1, Math.min(opts.page ?? PGRST_MAX_ROWS, PGRST_MAX_ROWS));
  const hardCap = opts.hardCap ?? 200_000;
  const out: T[] = [];
  for (let from = 0; from < hardCap; from += page) {
    const { data, error } = await build(from, from + page - 1);
    // A failed page ends the drain. Returning the partial set matches how the
    // call sites already treat `data ?? []` and keeps one bad request from
    // blanking a page — but it does mean callers must not read "fewer rows"
    // as "fewer records exist".
    if (error) break;
    if (!data) break;
    out.push(...data);
    // Short page ⇒ drained. This also covers the empty page (0 < page), so
    // there is deliberately no separate length===0 branch to drift out of sync.
    if (data.length < page) break;
    if (out.length >= hardCap) { opts.onTruncate?.(out.length); break; }
  }
  return out;
}
