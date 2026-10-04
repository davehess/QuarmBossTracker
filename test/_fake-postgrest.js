// test/_fake-postgrest.js — an in-memory PostgREST that ENFORCES the response cap.
//
// NOT a spec file (no `.test.` — vitest won't collect it).
//
// PostgREST returns at most 1,000 rows per response (Supabase's max-rows) and says nothing about the
// rest: `limit=3000` is an upper bound applied ON TOP of the cap, never a way past it. A fake that
// returns every matching row is therefore the thing that let the review's and the timer recovery's
// capped reads ship — they were green against it. This one cuts like the real server does, so a read
// that only works on a small table fails here the way it fails in production.
//
// What it does: the filters the bot's reads use (eq / neq / gt / gte / lt / lte / in / is / not.is),
// `order=col.asc|desc`, `limit`, `offset`, and the 1,000-row cut. It ignores `select=` (rows come back
// whole, embedded resources are just fields on the fixture row) and answers an unknown table with [].
//
// `truncated` is the point of it: every UNPAGED read (no `offset`) whose answer is shorter than the
// number of rows that matched. A paged read (utils/supabase.js selectAllPaged always sends `offset`)
// is allowed to be cut at a page boundary — it asks again. `truncated` is how a test says "nothing
// the card reads was silently dropped".
//
// Ties in the order column come back in a DIFFERENT arbitrary order on every request (Postgres makes
// no promise either), so paging on a non-unique column skips and repeats rows here instead of passing
// by luck of insertion order.
//
// rpc(): the three SQL functions this change adds, implemented over the same tables to the SQL's
// contract (supabase/migrations/20261004140000_*.sql, 20261004140100_*.sql — those files are checked
// against real Postgres separately). Their results are cut at 1,000 rows like any other response.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export const CAP = 1000;

const TS = /^\d{4}-\d\d-\d\dT/;
function comparable(v) {
  if (v == null) return v;
  if (typeof v === 'string' && TS.test(v)) return Date.parse(v);
  return v;
}
function matches(row, key, spec) {
  const v = row[key];
  const c = comparable(v);
  const [op, ...rest] = spec.split('.');
  const arg = rest.join('.');
  const argC = () => comparable(/^-?\d+(\.\d+)?$/.test(arg) ? Number(arg) : arg);
  switch (op) {
    case 'eq':  return String(v) === arg;
    case 'neq': return String(v) !== arg;
    case 'gt':  return c != null && c >  argC();
    case 'gte': return c != null && c >= argC();
    case 'lt':  return c != null && c <  argC();
    case 'lte': return c != null && c <= argC();
    case 'in': {
      const list = arg.replace(/^\(|\)$/g, '').split(',').filter(s => s !== '');
      return list.includes(String(v));
    }
    case 'is':  return arg === 'null' ? v == null : String(v) === arg;
    case 'not': {
      // not.is.null  →  spec = 'not.is.null'  →  op 'not', arg 'is.null'
      const [op2, ...r2] = arg.split('.');
      if (op2 === 'is') return r2.join('.') === 'null' ? v != null : String(v) !== r2.join('.');
      return !matches(row, key, arg);
    }
    default: throw new Error(`fake-postgrest: unsupported filter ${key}=${spec}`);
  }
}

export function makeFakePostgrest(tables = {}) {
  let req = 0;
  const calls = [];       // every select/rpc, in order: { kind, table|fn, query|params, matched, returned }
  const truncated = [];   // unpaged selects that came back short of what matched

  function parse(qs) {
    const filters = [];
    let order = null, limit = Infinity, offset = 0, paged = false;
    for (const part of String(qs || '').split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const key = decodeURIComponent(part.slice(0, i));
      const val = decodeURIComponent(part.slice(i + 1));
      if (key === 'select') continue;
      if (key === 'order') { order = val; continue; }
      if (key === 'limit') { limit = Number(val); continue; }
      if (key === 'offset') { offset = Number(val); paged = true; continue; }
      filters.push([key, val]);
    }
    return { filters, order, limit, offset, paged };
  }

  // Integer mixer: a different, effectively independent order for every request number.
  const mix = (x) => { x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };

  function sorted(rows, order) {
    const n = ++req;
    // Arbitrary-but-different tie order per request (Postgres promises none).
    const tie = new Map(rows.map((r, idx) => [r, mix(idx * 31 + n * 7919 + 1)]));
    if (!order) return rows;
    const [col, dir] = order.split('.');
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = comparable(a[col]), y = comparable(b[col]);
      if (x < y) return -sign;
      if (x > y) return sign;
      return tie.get(a) - tie.get(b);
    });
  }

  const fake = {
    calls, truncated, tables,
    isEnabled: () => true,

    async select(table, qs) {
      const { filters, order, limit, offset, paged } = parse(qs);
      const all = (tables[table] || []).filter(r => filters.every(([k, v]) => matches(r, k, v)));
      const out = sorted(all, order).slice(offset, offset + Math.min(limit, CAP));
      calls.push({ kind: 'select', table, query: qs, matched: all.length, returned: out.length });
      if (!paged && out.length < all.length) truncated.push({ table, query: qs, matched: all.length, returned: out.length });
      return out;
    },

    // The real paginator, pointed at this fake — so the test runs utils/supabase.js's paging rules.
    async selectAllPaged(table, baseQuery, orderCol) {
      return require('../utils/supabase.js').selectAllPaged(table, baseQuery, orderCol, (t, q) => fake.select(t, q));
    },

    async rpc(fn, params = {}) {
      const rows = RPC[fn] ? RPC[fn](tables, params) : null;
      calls.push({ kind: 'rpc', fn, params, returned: rows ? rows.length : null });
      return rows ? rows.slice(0, CAP) : null;      // an unknown function is a 404 → the helper returns null
    },
  };
  return fake;
}

// ── The SQL functions, to their SQL contract ────────────────────────────────

const RPC = {
  // select distinct on (npc_id) … order by npc_id, started_at desc, id
  latest_kill_per_npc(t, p) {
    const since = Date.parse(p.p_since);
    const best = new Map();
    for (const e of (t.encounters || [])) {
      if (e.guild_id !== p.p_guild_id || Date.parse(e.started_at) < since) continue;
      if (!p.p_npc_ids.includes(e.npc_id)) continue;
      const cur = best.get(e.npc_id);
      if (!cur || Date.parse(e.started_at) > Date.parse(cur.started_at)) best.set(e.npc_id, e);
    }
    return [...best.values()].sort((a, b) => a.npc_id - b.npc_id)
      .map(e => ({ npc_id: e.npc_id, started_at: e.started_at, zone_short: e.zone_short ?? null, id: e.id }));
  },

  // group by event_type, most common first
  raid_review_fun_counts(t, p) {
    const from = Date.parse(p.p_from), to = Date.parse(p.p_to);
    const by = new Map();
    for (const f of (t.fun_events || [])) {
      const ts = Date.parse(f.event_ts);
      if (f.guild_id !== p.p_guild_id || ts < from || ts >= to || !f.event_type) continue;
      by.set(f.event_type, (by.get(f.event_type) || 0) + 1);
    }
    return [...by.entries()].map(([event_type, n]) => ({ event_type, n }))
      .sort((a, b) => b.n - a.n || (a.event_type < b.event_type ? -1 : 1));
  },

  // per npc: n and sorted[floor(n/2)] over confirmed kills with a duration in [since, until)
  raid_review_history_medians(t, p) {
    const since = Date.parse(p.p_since), until = Date.parse(p.p_until);
    const by = new Map();
    for (const e of (t.encounters || [])) {
      const ts = Date.parse(e.started_at);
      if (e.guild_id !== p.p_guild_id || !p.p_npc_ids.includes(e.npc_id) || !e.npc_id) continue;
      if (e.ended_at == null || !(e.duration_sec > 0) || ts < since || ts >= until) continue;
      const arr = by.get(e.npc_id) || [];
      arr.push(e.duration_sec);
      by.set(e.npc_id, arr);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([npc_id, arr]) => {
      const s = [...arr].sort((x, y) => x - y);
      return { npc_id, n: s.length, median_sec: s[Math.floor(s.length / 2)] };
    });
  },
};
