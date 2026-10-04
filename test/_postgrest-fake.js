// test/_postgrest-fake.js — an in-memory PostgREST client that behaves like the real gateway where
// the real gateway bites.
//
// NOT a spec file (no `.test.` — vitest won't collect it).
//
// Two behaviours matter and a plain mock gets both wrong:
//
//   1. THE SILENT 1,000-ROW CAP. A response is cut at PGRST_MAX_ROWS no matter what `.limit()` or
//      `.range()` asked for, with no error and no flag. A read that matches more rows than it got
//      back is recorded in `calls.dropped` so a test can assert that NOTHING was silently dropped.
//      Unordered reads come back in insertion order, so a test places the rows it cares about LAST
//      and a capped read loses exactly them (which is what the real gateway did on 2026-10-04).
//
//   2. PAGING ON AN ORDER THAT IS NOT UNIQUE. `.range()` over an order that does not pin down every row
//      repeats and skips rows between pages. `keys[table]` lists the table's unique key columns; a
//      ranged read must order by all of them (a column pinned by `.eq()` counts), or the fake throws.
//
// RPCs: `rpc(name, args)` runs `impls[name](args, tables)`. The answer is JSON-cloned (it crossed a
// wire) and is NOT capped: a function that returns one jsonb value is a scalar, not a set. `signatures`
// maps each function to its parameter names; a call whose argument names differ is refused the way
// PostgREST refuses it (PGRST202), which is what keeps the TypeScript callers and the migration
// agreeing about parameter names.

export const PGRST_MAX_ROWS = 1000;

class Query {
  constructor(fake, table) {
    this.fake = fake;
    this.table = table;
    this.cols = '*';
    this.preds = [];
    this.eqCols = new Set();
    this.orders = [];
    this.rangeArg = null;
    this.limitArg = null;
  }
  select(cols = '*') { this.cols = cols; return this; }
  _p(fn) { this.preds.push(fn); return this; }
  eq(c, v) { this.eqCols.add(c); return this._p(r => r[c] === v); }
  neq(c, v) { return this._p(r => r[c] !== v); }
  in(c, vs) { const s = new Set(vs); return this._p(r => s.has(r[c])); }
  gt(c, v) { return this._p(r => r[c] != null && r[c] > v); }
  gte(c, v) { return this._p(r => r[c] != null && r[c] >= v); }
  lt(c, v) { return this._p(r => r[c] != null && r[c] < v); }
  lte(c, v) { return this._p(r => r[c] != null && r[c] <= v); }
  is(c, v) { return this._p(r => (r[c] ?? null) === v); }
  not(c, op, v) {
    if (op === 'is') return this._p(r => (r[c] ?? null) !== v);
    if (op === 'eq') return this._p(r => r[c] !== v);
    throw new Error(`fake: not(${op}) is not supported`);
  }
  order(c, { ascending = true } = {}) { this.orders.push({ c, ascending }); return this; }
  range(a, b) { this.rangeArg = [a, b]; return this; }
  limit(n) { this.limitArg = n; return this; }

  then(res, rej) {
    let out;
    try { out = this._run(); } catch (e) { return Promise.reject(e).then(res, rej); }
    return Promise.resolve(out).then(res, rej);
  }

  _run() {
    const rows = this.fake.tables[this.table];
    if (!rows) return { data: null, error: { message: `relation "${this.table}" does not exist` } };
    let m = rows.filter(r => this.preds.every(p => p(r)));
    if (this.orders.length) {
      // Array.sort is stable, so equal keys keep insertion order.
      m = [...m].sort((x, y) => {
        for (const { c, ascending } of this.orders) {
          const a = x[c], b = y[c];
          if (a === b) continue;
          if (a == null) return ascending ? 1 : -1;
          if (b == null) return ascending ? -1 : 1;
          return (a < b ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.rangeArg) {
      const key = this.fake.keys[this.table];
      if (key) {
        const ordered = new Set(this.orders.map(o => o.c));
        const missing = key.filter(k => !ordered.has(k) && !this.eqCols.has(k));
        if (missing.length) {
          throw new Error(`fake: ranged read of ${this.table} is not ordered by its unique key (missing ${missing.join(', ')}) — pages can repeat or skip rows`);
        }
      }
    }
    const matched = m.length;
    let from = 0, want = Infinity;
    if (this.rangeArg) { from = this.rangeArg[0]; want = this.rangeArg[1] - this.rangeArg[0] + 1; }
    if (this.limitArg != null) want = Math.min(want, this.limitArg);
    const page = m.slice(from, from + Math.min(want, PGRST_MAX_ROWS));
    this.fake.calls.reads.push({ table: this.table, matched, returned: page.length, ranged: !!this.rangeArg });
    // Rows the caller never gets and was never told about: the response ended short of the match
    // without a range to continue from.
    if (!this.rangeArg && page.length < matched) this.fake.calls.dropped.push({ table: this.table, matched, returned: page.length });
    const cols = this.cols === '*' ? null : this.cols.split(',').map(s => s.trim());
    const data = page.map(r => {
      if (!cols) return { ...r };
      const o = {};
      for (const c of cols) o[c] = r[c] ?? null;
      return o;
    });
    return { data, error: null };
  }
}

export function makeFake({ tables = {}, keys = {}, impls = {}, signatures = {} } = {}) {
  const fake = { tables, keys, calls: { reads: [], dropped: [], rpcs: [] } };
  fake.from = (table) => new Query(fake, table);
  fake.rpc = (name, args = {}) => {
    fake.calls.rpcs.push({ name, args });
    const sig = signatures[name];
    const got = Object.keys(args).sort().join(',');
    if (!sig || !impls[name] || got !== [...sig].sort().join(',')) {
      return Promise.resolve({
        data: null,
        error: { message: `Could not find the function public.${name}(${got}) in the schema cache` },
      });
    }
    const data = JSON.parse(JSON.stringify(impls[name](args, tables) ?? null));
    return Promise.resolve({ data, error: null });
  };
  return fake;
}

// The parameter names of every `create or replace function public.<name>(...)` in a migration, comments
// stripped by the caller.
export function parseSignatures(sql) {
  const out = {};
  const re = /create or replace function public\.(\w+)\s*\(([^)]*)\)/gi;
  for (let m; (m = re.exec(sql));) {
    out[m[1]] = m[2].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
  }
  return out;
}
