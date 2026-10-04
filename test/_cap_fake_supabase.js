// test/_cap_fake_supabase.js — a fake PostgREST that behaves like production where it matters here:
// it answers AT MOST 1,000 rows per response, whatever `limit=` says, with no error and no flag.
//
// NOT a spec file (no `.test.`). Shared by the tests that run the bot's REAL read paths (the source
// of the handler / function is sliced out of index.js and run against this) so a read that "worked"
// only because the fixture was small now fails: the 2026-10-04 audit found a dozen reads whose
// `limit=5000` was really PostgREST's 1,000 and whose tests all used 10-row fixtures.
//
// What it models, and no more:
//   · the cap: `limit=N` returns min(N, 1000) rows; no limit returns the first 1000;
//   · filters  col=op.value  with eq neq gt gte lt lte in is ilike ov cs, `not.` in front, dotted
//     paths into an embedded object (encounters.started_at), and  or=(a.eq.x,b.ilike.y);
//   · order=col.desc,col2.asc  (PostgreSQL's nulls: first on desc, last on asc), offset, limit;
//   · GET /rpc/<fn>?arg=…&<filters>  — a function's own arguments are taken out of the query string
//     (declared in `rpcs[fn].args`), what is left filters / orders / pages the function's rows, the
//     way PostgREST does for a set-returning function; and POST rpc(fn, params), whose reply is the
//     function's rows under the same cap;
//   · selectAllPaged is the REAL one from utils/supabase.js, fed this fake's select.
//
// What it does not model: `select=` projection (rows come back whole), embeds. Table fixtures carry
// any embedded object inline (`{ …, encounters: { guild_id, started_at } }`).
//
// The `rpcs[fn].run(args)` functions in a test are JS stand-ins for the SQL in
// supabase/migrations/20261004140200_cap_safe_reads.sql — the SQL itself was checked against
// production with read-only queries (see the commit message), so what these tests pin is the BOT's
// side: that it asks for complete data and uses the answer.

import { createRequire } from 'node:module';
import { ROOT } from './_source-slice.js';
import path from 'node:path';

const requireCjs = createRequire(path.join(ROOT, 'index.js'));
const realSupabase = requireCjs('./utils/supabase');

export const PGRST_MAX_ROWS = 1000;

const RESERVED = new Set(['select', 'order', 'limit', 'offset']);

const isoLike = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v);
function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;      // PostgreSQL: NULL sorts after everything ascending
  if (b == null) return -1;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  if (isoLike(a) && isoLike(b)) return Date.parse(a) - Date.parse(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function getPath(row, col) {
  let cur = row;
  for (const part of col.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function splitTopLevel(s) {          // split on commas that are not inside (...) or {...} or "..."
  const out = []; let depth = 0, q = false, cur = '';
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && (ch === '(' || ch === '{')) depth++;
    if (!q && (ch === ')' || ch === '}')) depth--;
    if (ch === ',' && depth === 0 && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseList(v) {              // (a,b,"c d") or {a,b}
  const inner = v.replace(/^[({]/, '').replace(/[)}]$/, '');
  return splitTopLevel(inner).map(x => x.trim().replace(/^"(.*)"$/, '$1'));
}

function matchOp(rowVal, op, val) {
  switch (op) {
    case 'eq':   return rowVal != null && cmp(rowVal, val) === 0;
    case 'neq':  return rowVal == null || cmp(rowVal, val) !== 0;
    case 'gt':   return rowVal != null && cmp(rowVal, val) > 0;
    case 'gte':  return rowVal != null && cmp(rowVal, val) >= 0;
    case 'lt':   return rowVal != null && cmp(rowVal, val) < 0;
    case 'lte':  return rowVal != null && cmp(rowVal, val) <= 0;
    case 'in':   return rowVal != null && parseList(val).some(x => cmp(rowVal, x) === 0);
    case 'is':   return val === 'null' ? rowVal == null : rowVal != null;
    case 'ilike': {
      if (rowVal == null) return false;
      const rx = new RegExp('^' + String(val).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', 'i');
      return rx.test(String(rowVal));
    }
    case 'ov':   return Array.isArray(rowVal) && parseList(val).some(x => rowVal.includes(x));
    case 'cs': {                     // jsonb @> for the object shape the bot sends
      try { const want = JSON.parse(val); return rowVal && typeof rowVal === 'object'
        && Object.keys(want).every(k => k in rowVal); } catch { return false; }
    }
    default: throw new Error('cap fake: unsupported operator ' + op);
  }
}

function matchCond(row, col, expr) {
  let negate = false, e = expr;
  if (e.startsWith('not.')) { negate = true; e = e.slice(4); }
  const dot = e.indexOf('.');
  const op = e.slice(0, dot), val = e.slice(dot + 1);
  const ok = matchOp(getPath(row, col), op, val);
  return negate ? !ok : ok;
}

function matchOr(row, v) {           // (col.op.val,col.op.val)
  return parseList(v).some(part => {
    const m = part.match(/^([\w.]+)\.((?:not\.)?\w+\..*)$/s);
    if (!m) throw new Error('cap fake: cannot parse or() part ' + part);
    return matchCond(row, m[1], m[2]);
  });
}

function orderRows(rows, spec) {
  const keys = spec.split(',').map(s => {
    const [col, dir] = s.split('.');
    return { col, desc: dir === 'desc' };
  });
  return rows.slice().sort((a, b) => {
    for (const { col, desc } of keys) {
      const av = getPath(a, col), bv = getPath(b, col);
      let c;
      if (av == null && bv == null) c = 0;
      else if (av == null) c = desc ? -1 : 1;       // NULLS FIRST on desc, LAST on asc
      else if (bv == null) c = desc ? 1 : -1;
      else c = desc ? cmp(bv, av) : cmp(av, bv);
      if (c) return c;
    }
    return 0;
  });
}

function parseQuery(qs) {
  const params = [];
  for (const part of String(qs || '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1));
    params.push([k, v]);
  }
  return params;
}

function applyQuery(rows, params, { cap }) {
  let out = rows;
  let order = null, limit = null, offset = 0;
  for (const [k, v] of params) {
    if (k === 'select') continue;
    if (k === 'order') { order = v; continue; }
    if (k === 'limit') { limit = parseInt(v, 10); continue; }
    if (k === 'offset') { offset = parseInt(v, 10) || 0; continue; }
    if (k === 'or') { out = out.filter(r => matchOr(r, v)); continue; }
    out = out.filter(r => matchCond(r, k, v));
  }
  if (order) out = orderRows(out, order);
  out = out.slice(offset);
  const n = Math.min(Number.isFinite(limit) && limit >= 0 ? limit : cap, cap);
  return out.slice(0, n);
}

/**
 * @param {object} cfg
 * @param {Record<string, object[]|(()=>object[])>} cfg.tables  table name → rows (or a function returning them)
 * @param {Record<string, {args:string[], run:(args:object)=>object[]}>} cfg.rpcs
 * @param {string[]} [cfg.missing]  tables / views the bot reads that answer null (not there, or timed out)
 * @param {number} [cfg.cap=1000]
 */
export function makeCapFake({ tables = {}, rpcs = {}, missing = [], cap = PGRST_MAX_ROWS } = {}) {
  const calls = [];

  async function select(table, queryString = '') {
    calls.push({ kind: 'select', table, qs: queryString });
    if (missing.includes(table)) return null;       // a table/view that is not there (or timed out): the bot's helper answers null
    const params = parseQuery(queryString);
    if (table.startsWith('rpc/')) {
      const def = rpcs[table.slice(4)];
      if (!def) return null;                        // PostgREST 404 → the bot's helper answers null
      const args = {};
      const rest = [];
      for (const [k, v] of params) (def.args.includes(k) ? (args[k] = v) : rest.push([k, v]));
      return applyQuery(def.run(args), rest, { cap });
    }
    const src = tables[table];
    const rows = typeof src === 'function' ? src() : (src || []);
    return applyQuery(rows, params, { cap });
  }

  async function rpc(fn, params = {}) {
    calls.push({ kind: 'rpc', fn, params });
    const def = rpcs[fn];
    if (!def) return null;
    return applyQuery(def.run(params), [], { cap });
  }

  const fake = {
    calls,
    isEnabled: () => true,
    select,
    rpc,
    selectAllPaged: (table, baseQuery, orderCol) => realSupabase.selectAllPaged(table, baseQuery, orderCol, select),
    // writes the code under test might make are not under test; accept them (inserts are recorded in `calls`)
    insert: async () => [], upsert: async () => [], update: async () => [], del: async () => [],
    insertIgnoreDuplicates: async (table, rows) => { calls.push({ kind: 'insert', table, rows }); return rows; },
  };
  return fake;
}
