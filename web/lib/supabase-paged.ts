// Fetch every row of a query, regardless of PostgREST's max-rows cap.
//
// THE BUG THIS EXISTS FOR (found 2026-08-12): PostgREST truncates every response
// at the project's `max-rows` (1000 by default) and says nothing about it — no
// error, no flag, just a short array. `.limit(4000)` does not raise that ceiling;
// it only lowers it. So any query over a table with more than 1000 matching rows
// silently returns the first 1000, and the code downstream computes a confident
// wrong answer:
//
//   /rolls  asked for 4000 looted_items, got 1000 of 5,622 — the OLDEST loot
//           vanished, which is exactly what older nights need to attribute a
//           winner, so their "Looted by" column just showed nothing.
//   /fun    counted 1,000 of 4,004 dragon punches; and tallied the Drunkard
//           leaderboard from 1,000 of 4,099 rows while displaying an exact
//           total beside it — a right number next to a wrong ranking.
//
// Use this whenever a query can match more than ~1000 rows. It pages by range
// until a short page proves the end, so the result never depends on how the
// project's max-rows happens to be configured.
//
// NOT needed for: `count: 'exact', head: true` (the count is exact and no rows
// are fetched), `.single()`, or anything narrowed to one id.

export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  hardCap = 50000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    // A short page is the only reliable end-of-data signal: PostgREST returns
    // exactly pageSize when more rows remain AND when the cap happens to land
    // on the boundary, so counting pages would loop forever on an exact
    // multiple. The hardCap is the backstop.
    if (data.length < pageSize) break;
  }
  return out;
}
