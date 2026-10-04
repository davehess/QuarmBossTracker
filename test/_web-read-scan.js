// test/_web-read-scan.js — find the Supabase read chains in web/** (NOT a spec file).
//
// Used by test/db-read-discipline-web.test.js. A "chain" is one `.from('table')` or
// `.rpc('fn', …)` and every `.method(…)` called on it, read off the source text:
//
//   sb.from('character_inventory').select('a, b').eq('guild_id', 'wolfpack').order('id').range(from, to)
//        ^ kind 'from', name 'character_inventory'; calls select, eq, order, range
//
// It is a scanner, not a parser: it understands strings, template literals (with nested
// `${}`), comments and bracket nesting, which is all a method chain needs. It does not follow
// a query built in a variable and extended on a later line (`let q = sb.from(..); q = q.eq(..)`);
// that site is judged on the part it can see, which is the conservative direction for a ratchet
// (an unseen `.range` leaves the site counted).
//
// Pass it source that has already been through stripJs (whole-line comments out), as the other
// source-text tests do. Trailing `// …` comments inside a chain are skipped here.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const SKIP_DIRS = new Set(['node_modules', '.next', '.claude']);

/** Every .ts/.tsx under web/ (app, lib, components, middleware), relative to the repo root. */
export function webSources() {
  const out = [];
  const walk = (rel) => {
    const full = path.join(ROOT, rel);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(full))) return;
      for (const e of fs.readdirSync(full).sort()) walk(path.join(rel, e));
    } else if (/\.(ts|tsx)$/.test(rel) && !/\.d\.ts$/.test(rel)) out.push(rel);
  };
  for (const r of ['web/app', 'web/lib', 'web/components', 'web/middleware.ts']) {
    if (fs.existsSync(path.join(ROOT, r))) walk(r);
  }
  return out;
}

// Index just past the string/template/comment that starts at `i`, or `i` if none starts there.
function skipLiteral(s, i) {
  const c = s[i];
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === c || s[j] === '\n') return j + 1;
    }
    return s.length;
  }
  if (c === '`') {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '`') return j + 1;
      if (s[j] === '$' && s[j + 1] === '{') j = skipBalanced(s, j + 1, '{', '}') - 1;
    }
    return s.length;
  }
  if (c === '/' && s[i + 1] === '/') {
    const nl = s.indexOf('\n', i);
    return nl < 0 ? s.length : nl;
  }
  if (c === '/' && s[i + 1] === '*') {
    const end = s.indexOf('*/', i + 2);
    return end < 0 ? s.length : end + 2;
  }
  return i;
}

// Index just past the bracket that closes the one at `open`.
function skipBalanced(s, open, o = '(', c = ')') {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const skipped = skipLiteral(s, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    const ch = s[i];
    if (ch === o) depth++;
    else if (ch === c) { depth--; if (depth === 0) return i + 1; }
  }
  return s.length;
}

function skipSpace(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const skipped = skipLiteral(s, i);
    if (skipped !== i && (s[i] === '/')) { i = skipped; continue; }
    return i;
  }
}

/**
 * Every `.from('x')` / `.rpc('x'` chain in `src`, in source order.
 * Returns [{ kind, name, calls: [{ name, args }], at }] where `args` is the raw text between the
 * call's parentheses and `at` the offset of the `.from(` / `.rpc(`.
 */
export function readChains(src) {
  const chains = [];
  const head = /\.(from|rpc)\(\s*(['"`])([A-Za-z0-9_]+)\2/g;
  let m;
  while ((m = head.exec(src))) {
    const open = src.indexOf('(', m.index);
    let i = skipBalanced(src, open);
    const calls = [];
    for (;;) {
      const j = skipSpace(src, i);
      if (src[j] !== '.') break;
      const id = /^\.\s*([A-Za-z_$][\w$]*)/.exec(src.slice(j, j + 80));
      if (!id) break;
      let k = j + id[0].length;
      k = skipSpace(src, k);
      if (src[k] === '(') {
        const end = skipBalanced(src, k);
        calls.push({ name: id[1], args: src.slice(k + 1, end - 1) });
        i = end;
      } else {
        calls.push({ name: id[1], args: '' });
        i = k;
      }
    }
    chains.push({ kind: m[1], name: m[3], calls, at: m.index, end: i });
  }
  return chains;
}

export const hasCall = (chain, name) => chain.calls.some(c => c.name === name);

/** The 1-based line of an offset, for failure messages (approximate once a block comment was stripped). */
export function lineOf(src, at) {
  let n = 1;
  for (let i = 0; i < at && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

// The first argument of a call as a bare string: `.order('id', { ascending: false })` -> id.
const firstArg = (c) => c.args.split(',')[0].replace(/['"`\s]/g, '');
const numberArg = (c) => Number(c.args.trim().replace(/_/g, ''));

// ── The four things the web read guard looks for ─────────────────────────────

/** (a) `.range(0, N)` with N >= 1000 used as one call: still capped at the API's 1,000 rows. */
export function overCapRanges(src) {
  const hits = [];
  for (const m of src.matchAll(/\.range\(\s*0\s*,\s*(\d[\d_]*)\s*\)/g)) {
    if (Number(m[1].replace(/_/g, '')) >= 1000) hits.push({ line: lineOf(src, m.index), text: `.range(0, ${m[1]})` });
  }
  return hits;
}

/**
 * A read that cannot be silently cut by the API's cap: it pages (`.range`), wants one row, only counts
 * (`head: true`), asks for a handful (`.limit(100)` or less is a top-N peek, not a drain), or is a write.
 */
export function isBounded(chain) {
  return hasCall(chain, 'range') || hasCall(chain, 'single') || hasCall(chain, 'maybeSingle')
    || chain.calls.some(c => c.name === 'select' && /head\s*:\s*true/.test(c.args))
    || chain.calls.some(c => c.name === 'limit' && numberArg(c) <= 100)
    || ['insert', 'update', 'upsert', 'delete'].some(n => hasCall(chain, n));
}

/** (b) `.rpc('fn')` of a set-returning function (names in `setReturning`) read without paging. */
export function unpagedSetReturningRpcs(src, setReturning) {
  return readChains(src)
    .filter(c => c.kind === 'rpc' && setReturning.has(c.name.toLowerCase()) && !isBounded(c))
    .map(c => ({ line: lineOf(src, c.at), text: `rpc ${c.name}` }));
}

/** (c) `.from('<big table or view>')` read without paging, a single row, a count or a small limit. */
export function unboundedBigReads(src, bigNames) {
  return readChains(src)
    .filter(c => c.kind === 'from' && bigNames.has(c.name) && !isBounded(c))
    .map(c => ({ line: lineOf(src, c.at), text: `from ${c.name}` }));
}

/** A paged chain: `.range(from, to)` with variables, which is how selectAll's builders end. */
export const isPaged = (chain) => chain.calls.some(c => c.name === 'range' && !/^\s*\d/.test(c.args));

/**
 * (d) A paged `.from('table')` read whose `.order()` columns do not include a unique key of the table,
 * counting columns pinned with `.eq()` as fixed. `uniqueKeys` maps table -> [[col, ...], ...]; guild_id
 * is dropped from a key first (this app has one guild, and its reads fix it or ignore it). A table
 * with no entry comes back as `unknown`, so a new paged read has to say what its key is.
 */
export function pagedOrderProblems(src, uniqueKeys) {
  const nonUnique = [];
  const unknown = [];
  for (const c of readChains(src)) {
    if (c.kind !== 'from' || !isPaged(c)) continue;
    const keys = uniqueKeys[c.name];
    const at = { line: lineOf(src, c.at), text: `from ${c.name}` };
    if (!keys) { unknown.push(at); continue; }
    const have = new Set([
      ...c.calls.filter(x => x.name === 'order').map(firstArg),
      ...c.calls.filter(x => x.name === 'eq').map(firstArg),
    ]);
    const ok = keys.some(k => k.filter(col => col !== 'guild_id').every(col => have.has(col)));
    if (!ok) {
      const order = c.calls.filter(x => x.name === 'order').map(firstArg);
      nonUnique.push({ ...at, text: `${at.text} order(${order.join(', ') || 'none'})` });
    }
  }
  return { nonUnique, unknown };
}

/** The `.rpc('fn')` names read through a page (`.range(from, to)`), for the ORDER BY check on their SQL. */
export function pagedRpcNames(src) {
  return readChains(src).filter(c => c.kind === 'rpc' && isPaged(c)).map(c => c.name.toLowerCase());
}

/**
 * Functions the migrations define that return a SET (`returns table(...)` / `returns setof`), the
 * latest definition of each name winning, a later DROP forgetting it. Returns Map name -> body-less
 * info `{ setReturning, file }` so a caller can also find the file that last defined it.
 */
export function migrationFunctions(stripSql) {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const fns = new Map();
  for (const file of fs.readdirSync(dir).sort()) {
    const sql = stripSql(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')' && --depth === 0) break;
      }
      const setReturning = /^\s*returns\s+(table|setof)\b/i.test(sql.slice(i + 1, i + 200));
      fns.set(m[1].toLowerCase(), { setReturning, file, at: m.index });
    }
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      // A DROP before a CREATE in the same file (a signature change) leaves the CREATE standing.
      const made = fns.get(m[1].toLowerCase());
      if (!(made && made.file === file && made.at > m.index)) fns.delete(m[1].toLowerCase());
    }
  }
  return fns;
}
