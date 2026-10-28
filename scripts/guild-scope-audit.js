#!/usr/bin/env node
// scripts/guild-scope-audit.js — find Supabase calls on guild tables that carry no guild filter.
//
// WHY: docs/DESIGN-raidmimic-hosted.md §3 step 4. The bot and the web server use the service role, which
// bypasses RLS, so isolation between guilds rests on every query remembering `guild_id`. This scanner is the
// ratchet's eyes: test/guild-scope.test.js fails on a NEW unscoped call and on a baseline entry that has been
// fixed (so the baseline only shrinks). Today's debt lives in scripts/guild-scope-baseline.json.
//
// WHAT IT SCANS: index.js, utils/**, commands/**, web/**/*.{ts,tsx} (not tests, node_modules, .next).
//   - bot helper forms with a literal table as the first argument:
//       supabase.select('t', q) / selectAllPaged / count / insert / insertIgnoreDuplicates / upsert / update / del
//   - supabase-js chains:  .from('t') ... .select().eq()... (the whole chain, to the end of the statement)
//   - rpc(...) is deliberately NOT scanned (an RPC names its own guild parameter, or hardcodes one — a
//     different audit).
// A call is SCOPED when its OWN expression (balanced parens / the whole chain) mentions the guild: `guild_id`
// in any spelling (`guild_id=eq.`, `.eq('guild_id'`, `guild_id:`, `p_guild_id`), or one of the known helpers
// that supply it (GUILD_TAG, GUILD, _guildId(), guildId(), supabase.guildId(), guildFilter, gid()). If an
// argument is a bare identifier, ONE level of lookup is done: the nearest preceding `const/let/var name = …`
// statement is appended to the expression, so `const q = \`guild_id=eq.…\`; select('t', q)` counts as scoped.
//
// KNOWN BLIND SPOTS (they under-count, never over-count): a table named by a variable or template rather than a
// string literal; a query string assembled in another function or file; a filter applied by a wrapper that
// takes the table as a parameter. Those need a human audit — the ratchet stops NEW literal-table debt.
//
// GUILD TABLES: scripts/guild-tables.json, a snapshot of every public base table that has a `guild_id`
// column. REFRESH it (Supabase MCP / SQL editor, read-only):
//   select json_agg(c.table_name order by c.table_name) from information_schema.columns c
//   join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
//   and t.table_type = 'BASE TABLE' where c.table_schema = 'public' and c.column_name = 'guild_id';
// and paste the array into "tables". Refresh when a migration adds a guild_id column (step 2 of the plan
// tags 49 more tables), then regenerate the baseline.
//
// USAGE:  node scripts/guild-scope-audit.js            per-file list of unscoped calls + totals
//         node scripts/guild-scope-audit.js --json     machine-readable
//         node scripts/guild-scope-audit.js --write-baseline   regenerate scripts/guild-scope-baseline.json

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'guild-scope-baseline.json');
const TABLES_PATH = path.join(__dirname, 'guild-tables.json');

const HELPER_METHODS = /^(select\w*|count|insert\w*|upsert\w*|update\w*|del|delete\w*)$/;
const SCOPE_RE = /guild_id|\bGUILD_TAG\b|\bGUILD\b|\bguildFilter\w*|\b_?[a-zA-Z]*[gG]uildId\s*\(|\bgid\s*\(/;

// ── comment stripping ───────────────────────────────────────────────────────
// String/template/regex aware, so `https://` in a string survives and a trailing `// guild_id` comment does
// not. Comments become spaces (newlines kept) so offsets and line numbers are unchanged.
function stripComments(src) {
  const out = src.split('');
  const n = src.length;
  const tmpl = []; // stack of brace depths for `${ … }` inside template literals
  let i = 0;
  let prevSig = '';       // last significant (non-space) char outside comments/strings
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const readString = (q) => {
    i++;
    while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
    i++;
    prevSig = q;
  };
  // Scan template text until a closing backtick or a `${`; returns true if it entered an expression.
  const readTemplate = () => {
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; prevSig = '`'; return false; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; tmpl.push(0); prevSig = '{'; return true; }
      i++;
    }
    return false;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue; }
    if (c === '/' && d === '*') { const s = i; i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; blank(s, i); continue; }
    if (c === '"' || c === "'") { readString(c); continue; }
    if (c === '`') { i++; readTemplate(); continue; }
    if (tmpl.length) {
      if (c === '{') tmpl[tmpl.length - 1]++;
      else if (c === '}') {
        if (tmpl[tmpl.length - 1] === 0) { tmpl.pop(); i++; readTemplate(); continue; }
        tmpl[tmpl.length - 1]--;
      }
    }
    if (c === '/' && (prevSig === '' || '(,=:[!&|?{};'.includes(prevSig))) {
      // regex literal
      i++;
      let cls = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        i++;
      }
      i++;
      prevSig = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

// ── balanced extraction ─────────────────────────────────────────────────────
// Index just past the group opened at src[open] (one of ( [ {), skipping strings/templates. -1 if unbalanced.
function matchClose(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[src[open]]];
  let i = open + 1;
  const n = src.length;
  while (i < n && stack.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          const e = matchClose(src, i + 1);
          if (e < 0) return -1;
          i = e;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return stack.length ? -1 : i;
}

// A supabase-js chain: from the `.from('t')` call forward through `.name(...)` links (and `!`/`?` tokens)
// until something that is not a chain link. Returns the end index.
function chainEnd(src, from) {
  let i = from;
  for (;;) {
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '?' && src[j + 1] === '.') j++;
    if (src[j] !== '.') return i;
    j++;
    while (j < src.length && /\s/.test(src[j])) j++;
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(j, j + 64));
    if (!m) return i;
    j += m[0].length;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '(') {
      const e = matchClose(src, j);
      if (e < 0) return i;
      i = e;
    } else {
      i = j;       // property access (e.g. `.data`) — keep walking
    }
  }
}

// Top-level arguments of a call's inner text (between the outer parens), split on depth-0 commas.
function splitArgs(inner) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') {
      let e = i + 1;
      if (c === '`') {
        while (e < inner.length && inner[e] !== '`') {
          if (inner[e] === '\\') e++;
          else if (inner[e] === '$' && inner[e + 1] === '{') { const k = matchClose(inner, e + 1); if (k > 0) { e = k - 1; } }
          e++;
        }
      } else {
        while (e < inner.length && inner[e] !== c) { if (inner[e] === '\\') e++; e++; }
      }
      cur += inner.slice(i, e + 1);
      i = e;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

// One level of lookup: the nearest preceding `const|let|var name = <statement>` before `before`.
function resolveIdentifier(src, name, before) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=`, 'g');
  let last = -1;
  let m;
  const head = src.slice(0, before);
  while ((m = re.exec(head))) last = m.index + m[0].length;
  if (last < 0) return '';
  // statement end: first depth-0 `;` or newline-at-depth-0 followed by a non-continuation, capped.
  let depth = 0;
  let i = last;
  const cap = Math.min(src.length, last + 2500);
  for (; i < cap; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      if (c === '`') {
        i++;
        while (i < cap && src[i] !== '`') { if (src[i] === '\\') i++; else if (src[i] === '$' && src[i + 1] === '{') { const k = matchClose(src, i + 1); if (k > 0) i = k - 1; } i++; }
      } else {
        i++;
        while (i < cap && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      }
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth <= 0) break;
  }
  return src.slice(last, i);
}

// One level of lookup for a same-file helper: `function name(…) { … }` bodies of every `name(` called in `expr`
// (e.g. slowMode.js `_kvQuery(supabase)` builds the guild_id filter). Cross-file helpers stay a blind spot.
function resolveLocalCalls(src, expr) {
  let extra = '';
  const seen = new Set();
  const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = callRe.exec(expr))) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const d = new RegExp(`function\\s+${name.replace(/\$/g, '\\$')}\\s*\\(`).exec(src);
    if (!d) continue;
    const paramsEnd = matchClose(src, d.index + d[0].length - 1);
    const bodyOpen = paramsEnd < 0 ? -1 : src.indexOf('{', paramsEnd);
    if (bodyOpen < 0) continue;
    const end = matchClose(src, bodyOpen);
    if (end > 0) extra += '\n' + src.slice(bodyOpen, end);
  }
  return extra;
}

// ── core: scan one source text ──────────────────────────────────────────────
// Returns [{ line, table, form, scoped, text }]. `guildTables` is a Set.
function scanSource(rawSrc, guildTables) {
  const src = stripComments(rawSrc);
  const calls = [];
  // Line index for fast lineOf.
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const line = (idx) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };

  // Form 1: helper — <recv>.<method>( '<table>' …
  const helperRe = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(\s*(['"`])([a-z_0-9]+)\3/g;
  let m;
  while ((m = helperRe.exec(src))) {
    const [, recv, method, , table] = m;
    if (!HELPER_METHODS.test(method) || !guildTables.has(table)) continue;
    const open = src.indexOf('(', m.index + recv.length);
    const close = matchClose(src, open);
    if (close < 0) continue;
    const expr = src.slice(m.index, close);
    const inner = src.slice(open + 1, close - 1);
    let extra = '';
    for (const a of splitArgs(inner).slice(1)) {
      const t = a.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) extra += '\n' + resolveIdentifier(src, t, m.index);
    }
    calls.push({ idx: m.index, line: line(m.index), table, form: method, expr, scoped: SCOPE_RE.test(expr + extra + resolveLocalCalls(src, expr)) });
  }

  // Form 2: supabase-js — .from('<table>') + the chain.
  const fromRe = /\.\s*from\s*\(\s*(['"`])([a-z_0-9]+)\1\s*\)/g;
  while ((m = fromRe.exec(src))) {
    const table = m[2];
    if (!guildTables.has(table)) continue;
    const end = chainEnd(src, m.index + m[0].length);
    // Include the receiver word before `.from` so the fingerprint reads like the call.
    let start = m.index;
    while (start > 0 && /[\w$.]/.test(src[start - 1])) start--;
    const expr = src.slice(start, end);
    let extra = '';
    // identifiers passed into the chain: .eq('guild_id', x) is already in expr; only resolve query-ish idents
    // used as the sole argument of .insert/.upsert/.update (rows built elsewhere).
    const argRe = /\.(?:insert|upsert|update)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
    let am;
    while ((am = argRe.exec(expr))) extra += '\n' + resolveIdentifier(src, am[1], m.index);
    calls.push({ idx: start, line: line(m.index), table, form: 'from', expr, scoped: SCOPE_RE.test(expr + extra + resolveLocalCalls(src, expr)) });
  }
  calls.sort((a, b) => a.idx - b.idx);
  return calls;
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const fingerprint = (expr) => crypto.createHash('sha1').update(normalize(expr)).digest('hex').slice(0, 10);

// ── file walk ───────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'test', 'tests', '__tests__', '.claude']);
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), exts, out); continue; }
    if (!exts.some((x) => e.name.endsWith(x))) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
    out.push(path.join(dir, e.name));
  }
  return out;
}

function listFiles(root = ROOT) {
  const files = [];
  if (fs.existsSync(path.join(root, 'index.js'))) files.push(path.join(root, 'index.js'));
  walk(path.join(root, 'utils'), ['.js'], files);
  walk(path.join(root, 'commands'), ['.js'], files);
  walk(path.join(root, 'web'), ['.ts', '.tsx'], files);
  return files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
}

const areaOf = (file) => (file === 'index.js' ? 'bot' : file.split('/')[0] === 'web' ? 'web' : file.split('/')[0]);

function loadGuildTables() {
  return new Set(JSON.parse(fs.readFileSync(TABLES_PATH, 'utf8')).tables);
}

// Every unscoped call in the repo: [{ file, line, table, form, fingerprint, key }]. Keys are unique per
// (file, table, fingerprint) with a #n suffix for byte-identical repeats, and carry no line number.
function auditRepo({ root = ROOT, guildTables = loadGuildTables() } = {}) {
  const out = [];
  for (const file of listFiles(root)) {
    const calls = scanSource(fs.readFileSync(path.join(root, file), 'utf8'), guildTables);
    const seen = new Map();
    for (const c of calls) {
      if (c.scoped) continue;
      const fp = fingerprint(c.expr);
      const base = `${file}|${c.table}|${fp}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      out.push({ file, line: c.line, table: c.table, form: c.form, fingerprint: fp, key: n > 1 ? `${base}#${n}` : base });
    }
  }
  return out;
}

function summarize(found) {
  const byArea = {};
  const byTable = {};
  for (const f of found) {
    byArea[areaOf(f.file)] = (byArea[areaOf(f.file)] || 0) + 1;
    byTable[f.table] = (byTable[f.table] || 0) + 1;
  }
  const topTables = Object.entries(byTable).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total: found.length, byArea, topTables };
}

function baselineFrom(found) {
  return {
    _note: 'Generated by `node scripts/guild-scope-audit.js --write-baseline`. The unscoped guild-table calls that existed when the ratchet landed. Entries may only be REMOVED (by scoping the call). Do not regenerate to hide a new unscoped query. See docs/DESIGN-raidmimic-hosted.md section 3 step 4.',
    count: found.length,
    entries: found.map((f) => ({ file: f.file, table: f.table, fingerprint: f.fingerprint, key: f.key })),
  };
}

module.exports = {
  stripComments, matchClose, scanSource, fingerprint, auditRepo, summarize, baselineFrom,
  listFiles, areaOf, loadGuildTables, BASELINE_PATH, TABLES_PATH,
};

if (require.main === module) {
  const found = auditRepo();
  if (process.argv.includes('--write-baseline')) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselineFrom(found), null, 1) + '\n');
    console.log(`wrote ${path.relative(ROOT, BASELINE_PATH)}: ${found.length} unscoped calls`);
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ summary: summarize(found), found }, null, 1));
  } else {
    let cur = '';
    for (const f of found) {
      if (f.file !== cur) { cur = f.file; console.log(`\n${cur}`); }
      console.log(`  ${f.file}:${f.line}  ${f.table}  (${f.form})`);
    }
    const s = summarize(found);
    console.log(`\n${s.total} unscoped calls on guild tables`);
    console.log('by area:', JSON.stringify(s.byArea));
    console.log('top tables:', s.topTables.slice(0, 10).map(([t, c]) => `${t}=${c}`).join(', '));
  }
}
