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
//     All 36 of a member's ticks were in that tail, so main detection could
//     not see he had ever raided and kept naming the previous main.
//
// ORDERING IS NOT OPTIONAL. Range pagination over an unordered query can repeat
// or skip rows between pages — Postgres makes no stability guarantee without an
// ORDER BY. Every caller MUST apply a `.order()` on a unique (or
// tie-broken-unique) column inside `build`. A non-unique key is the same bug as
// no key: each page is its own `ORDER BY … LIMIT … OFFSET …` and rows that tie
// can fall either side of the boundary, so some are never returned and others
// come twice. Measured 2026-10-04 on character_inventory, ordered (character_name,
// item_name, item_id): 49,418 rows, 49,406 distinct came back — 12 never did.
// Ending the order on the primary key fixes it (49,418 of 49,418). The same holds
// for a set-returning RPC read through `.rpc().range()`: its ORDER BY must end on
// a unique key too.
//
// A FAILED PAGE THROWS (2026-10-04). It used to `break` and return the rows it
// had, which is a silent partial set: with the API's 8 s statement_timeout a
// slow page is a real path, and the caller drew a short list as if it were the
// whole one. A caller that can live without the data catches the throw.

/** PostgREST's silent per-response ceiling. Pages are sized to match it. */
export const PGRST_MAX_ROWS = 1000;

type PageResult<T> = { data: T[] | null; error: unknown };

export type SelectAllOpts = {
  /** Rows per request. Never set above the server cap — a larger page just
   *  gets truncated to it, and the short-page stop would then end the loop
   *  early and silently re-introduce the bug. */
  page?: number;
  /** Runaway stop. Exceeding it returns what we have, logs a warning, and calls
   *  `onTruncate`. */
  hardCap?: number;
  /** Called when hardCap is hit, so a caller can surface "showing N of M"
   *  instead of pretending the set is complete. */
  onTruncate?: (loaded: number) => void;
};

/**
 * Drain a PostgREST query across as many pages as it takes.
 *
 * @param build receives an inclusive `[from, to]` row range and must return the
 *              built query — WITH a stable, UNIQUE `.order()` applied.
 * @throws if any page comes back with an error or no data (see the header).
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
    // A failed page is an error, not "the end": returning what we have would hand
    // the caller a short list that reads as the whole one.
    if (error || !data) {
      const why = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? 'no data');
      throw new Error(`selectAll: rows ${from}-${from + page - 1} failed after ${out.length} loaded: ${why}`, { cause: error });
    }
    out.push(...data);
    // Short page ⇒ drained. This also covers the empty page (0 < page), so
    // there is deliberately no separate length===0 branch to drift out of sync.
    if (data.length < page) break;
    if (out.length >= hardCap) {
      console.warn(`selectAll: stopped at the ${hardCap}-row hardCap with ${out.length} rows loaded; the set may be longer`);
      opts.onTruncate?.(out.length);
      break;
    }
  }
  return out;
}
