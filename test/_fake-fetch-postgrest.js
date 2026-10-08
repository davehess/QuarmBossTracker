// test/_fake-fetch-postgrest.js — a PostgREST that behaves like Supabase's, cap included.
// (Siblings: test/_fake-postgrest.js answers a `supabase.select` stub, test/_fake-supabase-js.js
// and test/_postgrest-fake.js stand in for the web's supabase-js client. This one stubs global fetch.)
//
// The bot reads Supabase through utils/supabase.js, which speaks to PostgREST with
// global fetch. This stubs fetch and answers from in-memory tables the way the
// real server does — and, above all, ENFORCES THE 1,000-ROW CAP: a response never
// holds more than SERVER_MAX_ROWS rows, `limit=10000` does not lift it, and a
// result that was cut says nothing about it. A fake that returned every row would
// have passed the code this file exists to catch (`limit=10000` "worked" in every
// test that mocked `select` and read nothing in production).
//
// It also refuses to be kind about ORDER. Postgres gives no order to rows that tie
// on the ORDER BY columns (or to any row when there is no order=), and a paged read
// over a non-unique key skips rows and repeats others between pages. So rows that
// tie are shuffled afresh on every request: a read whose order is not unique comes
// back with rows missing and rows doubled, as it does in production, instead of
// passing by luck of insertion order.
//
// Supported: GET with select (plain columns; an embed or JSON path returns the
// whole row), order (multi-column, .asc/.desc), limit, offset, and column filters
// eq / neq / gt / gte / lt / lte / in.(…) / is.null / not.is.null / ilike (* and %).
// POST appends rows, DELETE removes the rows its filters match, POST /rpc/<fn> calls
// rpcs[fn](body) — an RPC's rows are capped like any response. Anything else throws,
// so a query the fake does not understand fails the test instead of being ignored.
//
// NOT a spec file (no `.test.`/`.spec.` — vitest won't collect it).

export const FAKE_SUPABASE_URL = 'https://fake-postgrest.invalid';
export const SERVER_MAX_ROWS = 1000;

const dec = (s) => decodeURIComponent(s);

function parseQuery(search) {
  const out = [];
  for (const part of String(search || '').replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    out.push(i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))]);
  }
  return out;
}

// 'in.(a,"b c",d)' → ['a','b c','d']
function parseInList(v) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '', q = false;
  for (const ch of inner) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || out.length) out.push(cur);
  return out;
}

const isNum = (x) => x !== '' && x != null && !Number.isNaN(Number(x));
function cmp(a, b) {
  if (isNum(a) && isNum(b)) return Number(a) - Number(b);
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matcher(col, expr) {
  const get = (row) => row[col];
  let m;
  if (expr === 'is.null')      return (r) => get(r) == null;
  if (expr === 'not.is.null')  return (r) => get(r) != null;
  if ((m = /^(eq|neq|gt|gte|lt|lte)\.(.*)$/s.exec(expr))) {
    const [, op, val] = m;
    return (r) => {
      const v = get(r);
      if (v == null) return false;
      if (op === 'eq')  return String(v) === val;
      if (op === 'neq') return String(v) !== val;
      const c = cmp(v, val);
      return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
    };
  }
  if ((m = /^in\.(\(.*\))$/s.exec(expr))) {
    const set = new Set(parseInList(m[1]));
    return (r) => get(r) != null && set.has(String(get(r)));
  }
  if ((m = /^ilike\.(.*)$/s.exec(expr))) {
    const rx = new RegExp('^' + m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', 'i');
    return (r) => get(r) != null && rx.test(String(get(r)));
  }
  throw new Error(`fake-postgrest: unsupported filter ${col}=${expr}`);
}

// Per-request tiebreak: stable for one request, different on the next.
function tiebreak(i, req) {
  let h = Math.imul(i ^ Math.imul(req + 1, 0x9E3779B1), 0x85EBCA6B);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return h >>> 0;
}

function orderRows(rows, orderParam, req) {
  const cols = (orderParam ? orderParam.split(',') : []).map((t) => {
    const [col, dir] = t.split('.');
    return { col, desc: dir === 'desc' };
  });
  const tagged = rows.map((row, i) => ({ row, t: tiebreak(i, req) }));
  tagged.sort((A, B) => {
    for (const { col, desc } of cols) {
      const a = A.row[col], b = B.row[col];
      if (a == null && b == null) continue;
      if (a == null) return desc ? -1 : 1;        // Postgres: NULLS LAST asc, FIRST desc
      if (b == null) return desc ? 1 : -1;
      const c = cmp(a, b);
      if (c) return desc ? -c : c;
    }
    return A.t - B.t;
  });
  return tagged.map((x) => x.row);
}

/**
 * @param {object} o
 * @param {Record<string, object[]>} o.tables  table → rows (mutated by POST/DELETE)
 * @param {Record<string, Function>} [o.rpcs]  fn → (body) => rows
 * @param {Function} [o.failWhen]  ({ method, table, query }) => true answers that request 500
 *   (a page that fails mid-walk). `failWhen` can be reassigned on the returned object.
 * @returns {{ calls: object[], tables: object, failWhen: Function|null, restore: Function }}
 *   calls: one entry per request — { method, table, query, rows } (rows = how many
 *   came back), so a test can assert what was read and what was NOT.
 */
export function installFakePostgrest({ tables = {}, rpcs = {}, failWhen = null } = {}) {
  process.env.SUPABASE_URL = FAKE_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  const realFetch = global.fetch;
  const calls = [];
  let req = 0;
  const handle = { calls, failWhen, restore() { global.fetch = realFetch; }, get tables() { return tables; } };

  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (body === undefined ? null : typeof body === 'string' ? JSON.parse(body) : JSON.parse(JSON.stringify(body))),
  });

  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const rel = u.pathname.replace(/^\/rest\/v1\//, '');
    const query = u.search.replace(/^\?/, '');
    const n = req++;

    if (handle.failWhen && handle.failWhen({ method, table: rel, query, n })) {
      calls.push({ method, table: rel, query, rows: 0, failed: true });
      return reply(500, { message: 'injected failure' });
    }

    if (rel.startsWith('rpc/')) {
      const fn = rel.slice(4);
      if (!rpcs[fn]) { calls.push({ method, table: rel, query, rows: 0 }); return reply(404, { message: `no rpc ${fn}` }); }
      let out = await rpcs[fn](init.body ? JSON.parse(init.body) : {}, tables);
      if (Array.isArray(out)) out = out.slice(0, SERVER_MAX_ROWS);
      calls.push({ method, table: rel, query: init.body || '', rows: Array.isArray(out) ? out.length : 1 });
      return reply(200, out);
    }

    const table = rel;
    if (!tables[table]) { calls.push({ method, table, query, rows: 0 }); return reply(404, { message: `no table ${table}` }); }
    const q = parseQuery(query);
    const filters = q.filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pass = filters.map(([k, v]) => matcher(k, v));
    const all = tables[table].filter((r) => pass.every((f) => f(r)));

    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ ...r }));
      tables[table].push(...rows);
      calls.push({ method, table, query, rows: rows.length });
      return reply(/return=minimal/.test(init.headers?.Prefer || '') ? 204 : 201, /return=minimal/.test(init.headers?.Prefer || '') ? undefined : rows);
    }
    if (method === 'DELETE') {
      const gone = new Set(all);
      tables[table] = tables[table].filter((r) => !gone.has(r));
      calls.push({ method, table, query, rows: gone.size });
      return reply(204);
    }
    if (method !== 'GET') throw new Error(`fake-postgrest: unsupported method ${method}`);

    const get = (k) => (q.find(([key]) => key === k) || [])[1];
    const ordered = orderRows(all, get('order'), n);
    const off = get('offset') != null ? Number(get('offset')) : 0;
    const lim = Math.min(get('limit') != null ? Number(get('limit')) : Infinity, SERVER_MAX_ROWS);
    let page = ordered.slice(off, off + lim);
    const sel = get('select');
    if (sel && sel !== '*' && !/[()>:]/.test(sel)) {
      const cols = sel.split(',');
      page = page.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    calls.push({ method, table, query, rows: page.length });
    return reply(200, page);
  };

  return handle;
}
