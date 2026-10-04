// test/_fake-supabase-me.js — a fake Supabase client whose "server" ENFORCES
// PostgREST's silent 1,000-row response cap.
//
// NOT a spec file (underscore prefix, no `.test.`): vitest does not collect it.
//
// Why it exists: every bug the 2026-10-04 audit found had the same shape — a
// read that asked for 5,000 / 10,000 rows and quietly got 1,000. A fake that
// returns whatever was asked for lets that bug pass any test, so this one does
// what the real server does: after filter → order → range/limit, it hands back
// AT MOST `cap` rows, with no error and no flag. It also stays honest about the
// two things that are NOT capped: a jsonb VALUE from an rpc, and a `head`/count.
//
// Supported (only what the loaders under test use): select(cols) projection,
// eq, ilike (with % wildcards), in, gt, or('col.ilike.x,col.eq.y'), order
// (chainable, Postgres null placement), range, limit; rpc() returning either a
// set of rows (`setof`, capped, orderable, pageable) or one value (`json`).
//
//   const db = fakeDb({
//     tables: { faction_cons: rows },
//     rpcs:   { discover_quests_for_item: { setof: args => rows },
//               me_char_stats:            { json:  args => [...] } },
//   });
//   db.calls   // every request made: { kind, name, filters, order, range, args }

export const PGRST_CAP = 1000;

const like = (pattern) => new RegExp(
  '^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');

// Postgres: ASC → NULLS LAST, DESC → NULLS FIRST.
function compare(a, b, ascending) {
  const an = a == null, bn = b == null;
  if (an || bn) return an && bn ? 0 : (an ? (ascending ? 1 : -1) : (ascending ? -1 : 1));
  if (a < b) return ascending ? -1 : 1;
  if (a > b) return ascending ? 1 : -1;
  return 0;
}

class Query {
  constructor(source, cap, log, name) {
    this.rows = source;
    this.cap = cap;
    this.rec = { kind: 'from', name, filters: [], order: [], range: null, limit: null, select: null };
    this.callNo = log.length;
    log.push(this.rec);
    this.preds = [];
    this.orders = [];
    this.lim = null;
    this.rng = null;
    this.cols = null;
  }
  select(cols) { this.cols = cols && cols !== '*' ? String(cols).split(',').map(s => s.trim()) : null; this.rec.select = cols; return this; }
  eq(col, v) { this.rec.filters.push(['eq', col, v]); this.preds.push(r => r[col] === v); return this; }
  gt(col, v) { this.rec.filters.push(['gt', col, v]); this.preds.push(r => r[col] > v); return this; }
  in(col, arr) { this.rec.filters.push(['in', col, arr]); const s = new Set(arr); this.preds.push(r => s.has(r[col])); return this; }
  ilike(col, pat) { this.rec.filters.push(['ilike', col, pat]); const re = like(pat); this.preds.push(r => re.test(String(r[col] ?? ''))); return this; }
  or(expr) {
    this.rec.filters.push(['or', expr]);
    const parts = String(expr).split(',').map(p => {
      const [col, op, ...rest] = p.split('.');
      const val = rest.join('.');
      return op === 'ilike' ? (r => like(val).test(String(r[col] ?? ''))) : (r => String(r[col]) === val);
    });
    this.preds.push(r => parts.some(f => f(r)));
    return this;
  }
  order(col, opts = {}) { const asc = opts.ascending !== false; this.rec.order.push([col, asc]); this.orders.push([col, asc]); return this; }
  limit(n) { this.lim = n; this.rec.limit = n; return this; }
  range(from, to) { this.rng = [from, to]; this.rec.range = [from, to]; return this; }
  then(resolve, reject) {
    let rows = this.rows.filter(r => this.preds.every(p => p(r)));
    if (this.orders.length) {
      // Rows the ORDER BY cannot tell apart come back in a DIFFERENT order on
      // every request (Postgres promises nothing about ties, and a page walk
      // that relies on them skips and repeats rows). Only a total order — a
      // unique column last — makes the pages line up, which is exactly what
      // selectAll's contract demands.
      const idx = new Map(this.rows.map((r, i) => [r, i]));
      const salt = this.callNo;
      // A different multiplier per request re-deals the ties (a shared additive
      // offset would keep their relative order and hide a missing tiebreak).
      const tie = (r) => ((idx.get(r) + 1) * (654321 + salt * 7919)) % 1000003;
      rows = [...rows].sort((a, b) => {
        for (const [col, asc] of this.orders) { const c = compare(a[col], b[col], asc); if (c) return c; }
        return tie(a) - tie(b);
      });
    }
    let start = 0, end = rows.length;
    if (this.rng) { start = this.rng[0]; end = Math.min(end, this.rng[1] + 1); }
    if (this.lim != null) end = Math.min(end, start + this.lim);
    let out = rows.slice(start, end).slice(0, this.cap);                 // ← the silent cap
    if (this.cols) out = out.map(r => Object.fromEntries(this.cols.map(c => [c, r[c]])));
    return Promise.resolve({ data: out, error: null }).then(resolve, reject);
  }
}

export function fakeDb({ tables = {}, rpcs = {}, cap = PGRST_CAP } = {}) {
  const calls = [];
  return {
    calls,
    from: (name) => new Query(tables[name] ?? [], cap, calls, name),
    rpc: (fn, args = {}) => {
      const h = rpcs[fn];
      const rec = { kind: 'rpc', name: fn, args };
      if (!h) { calls.push(rec); return Promise.resolve({ data: null, error: { message: `function ${fn} does not exist` } }); }
      if (h.error) { calls.push(rec); return Promise.resolve({ data: null, error: { message: h.error } }); }
      if (h.json) { calls.push(rec); return Promise.resolve({ data: h.json(args), error: null }); }   // one value: not row-capped
      const q = new Query(h.setof(args), cap, calls, fn);                                          // a set: capped like a table
      q.rec.kind = 'rpc'; q.rec.args = args;
      return q;
    },
  };
}
