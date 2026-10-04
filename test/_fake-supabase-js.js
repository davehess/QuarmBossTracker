// test/_fake-supabase-js.js — an in-memory stand-in for the slice of supabase-js the web read helpers use
// (test/_fake-postgrest.js is the bot's twin: the same cap, at the HTTP query-string level),
// built to be HOSTILE in the two ways the real PostgREST is:
//
//   1. It ENFORCES the silent 1,000-row cap. A response is never longer than `cap`, whatever `.limit()` or
//      `.range()` asked for, and nothing says so: no error, no flag, a short array. (Verified against the
//      live project on 2026-10-04: `.limit(20000)` and `.range(0, 99999)` both return 1,000.)
//   2. Row order is NOT stable between requests unless the query pins it. Postgres promises no order
//      without an ORDER BY, and a tie in the ORDER BY is as unordered as no ORDER BY at all. So every
//      request re-shuffles the matching rows (a different, deterministic shuffle each time) BEFORE the
//      stable sort the query asked for. A paged read over a missing or non-unique `.order()` therefore
//      repeats some rows and skips others — exactly how it fails in production — and a read that pages
//      correctly passes whatever the shuffle does.
//
// A set-returning RPC is modelled as a function from its args to the full ordered result (the SQL
// function's own ORDER BY); the fake still applies `.range()` and the cap to it.
//
// NOT a spec file (no `.test.` in the name — vitest will not collect it).

export const PGRST_MAX_ROWS = 1000;

const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;                       // Postgres: NULLS LAST ascending
  if (b == null) return -1;
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  return a < b ? -1 : a > b ? 1 : 0;
};

export function fakeSupabase({ tables = {}, rpcs = {}, cap = PGRST_MAX_ROWS, errors = {} } = {}) {
  const requests = [];          // one entry per executed request, for assertions
  let tick = 0;

  // A different deterministic shuffle on every request (LCG seeded from a counter).
  const shuffled = (rows) => {
    let s = (++tick * 2654435761) % 4294967296;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const out = rows.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  // Sort comparator for one `.order()` key. Postgres puts NULLs last ascending and first descending
  // unless nullsFirst says otherwise.
  const byKey = (o) => (a, b) => {
    const an = a[o.c] == null, bn = b[o.c] == null;
    if (an || bn) {
      if (an === bn) return 0;
      const nullsFirst = o.nullsFirst !== undefined ? o.nullsFirst : !o.asc;
      return an === nullsFirst ? -1 : 1;
    }
    const c = cmp(a[o.c], b[o.c]);
    return o.asc ? c : -c;
  };

  function builder(kind, name, source, args) {
    const q = { filters: [], orders: [], limit: null, range: null };
    const run = () => {
      const log = {
        kind, name, args,
        filters: q.filters.map(f => f.desc), orders: q.orders.map(o => o.c), limit: q.limit, range: q.range,
      };
      requests.push(log);
      if (errors[name]) return { data: null, error: { message: errors[name] } };
      let rows;
      if (kind === 'rpc') {
        rows = source().slice();                         // the function's own ORDER BY
      } else {
        rows = shuffled(source().filter(r => q.filters.every(f => f.fn(r))));
        for (const o of q.orders.slice().reverse()) rows.sort(byKey(o));   // stable, least significant key first
      }
      const [from, to] = q.range ?? [0, (q.limit ?? cap) - 1];
      const want = to - from + 1;
      const data = rows.slice(from, from + Math.min(want, cap));   // ← the silent cap
      return { data, error: null };
    };
    const b = {
      select() { return b; },
      eq(c, v) { q.filters.push({ desc: `${c}=${v}`, fn: r => r[c] === v }); return b; },
      gt(c, v) { q.filters.push({ desc: `${c}>${v}`, fn: r => r[c] != null && cmp(r[c], v) > 0 }); return b; },
      gte(c, v) { q.filters.push({ desc: `${c}>=${v}`, fn: r => r[c] != null && cmp(r[c], v) >= 0 }); return b; },
      lt(c, v) { q.filters.push({ desc: `${c}<${v}`, fn: r => r[c] != null && cmp(r[c], v) < 0 }); return b; },
      lte(c, v) { q.filters.push({ desc: `${c}<=${v}`, fn: r => r[c] != null && cmp(r[c], v) <= 0 }); return b; },
      in(c, arr) { const set = new Set(arr); q.filters.push({ desc: `${c} in (${arr.length})`, fn: r => set.has(r[c]) }); return b; },
      order(c, opts = {}) { q.orders.push({ c, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst }); return b; },
      limit(n) { q.limit = n; return b; },
      range(from, to) { q.range = [from, to]; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  return {
    requests,
    from(table) {
      if (!tables[table]) throw new Error(`fakeSupabase: no fixture for table ${table}`);
      return builder('table', table, () => tables[table]);
    },
    rpc(name, args = {}) {
      if (!rpcs[name]) throw new Error(`fakeSupabase: no fixture for rpc ${name}`);
      return builder('rpc', name, () => rpcs[name](args), args);
    },
  };
}
