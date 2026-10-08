// Chunked `.in()` reads that stay complete.
//
// An `.in(column, keys)` read has TWO ceilings, and a chunk loop only answers one of them:
//   · the URL. Every uuid is ~37 characters of query string, so a long list is refused or
//     truncated at the gateway. Chunking the KEYS is the answer to that.
//   · PostgREST's silent 1,000-row response cap (lib/selectAll.ts). A chunk of 60 encounter
//     ids against encounter_players is 1,200-3,000 rows, so each chunk is itself over the cap
//     and a plain `await q.in(...)` per chunk still comes back with 1,000 of them. Paging each
//     chunk with selectAll is the answer to that.
// /admin/anomalies had the first half only: its comment said "chunked" and every chunk was
// being cut at 1,000 rows, with no error.
//
// Every `build` must apply a stable UNIQUE `.order()` for its chunk, same rule as selectAll.
import { selectAll, type SelectAllOpts } from './selectAll';

/** Keys per request. 60 uuids is ~2.3 KB of URL, comfortably under any gateway limit. */
export const IN_CHUNK = 60;

export function chunk<T>(items: readonly T[], size: number = IN_CHUNK): T[][] {
  const n = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

type Page<T> = { data: T[] | null; error: unknown };

/**
 * Read every row matching any of `keys`, `size` keys per request, each request drained across
 * as many pages as it takes. Rows come back chunk by chunk, in the order `build` sorts them
 * within a chunk.
 */
export async function selectInChunks<K, T>(
  keys: readonly K[],
  build: (keys: K[], from: number, to: number) => PromiseLike<Page<T>>,
  opts: SelectAllOpts & { size?: number } = {},
): Promise<T[]> {
  const { size, ...paging } = opts;
  let out: T[] = [];
  for (const part of chunk(keys, size)) {
    // concat, not push(...rows): a chunk can legitimately hold tens of thousands of rows and a
    // spread that large overflows the call stack.
    out = out.concat(await selectAll<T>((from, to) => build(part, from, to), paging));
  }
  return out;
}
