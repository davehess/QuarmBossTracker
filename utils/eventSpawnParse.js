// Reads a Planes of Power event script (quest Lua) and lists where it puts its mobs.
//
// Why this exists (2026-11-09): the elemental-plane events spawn their mobs from quest scripts
// (eq.spawn2 / eq.unique_spawn), so they have no eqemu_spawn2 row and nothing placed them on the Map, in the
// agent's spawn-point pinning, or in the replay timelines. The scripts are the source of truth ("mechanics come
// from the server's scripts", the guild lead, 2026-10-21); scripts/gen-event-spawns.js feeds them through here and
// writes data/event-spawns.json. Pure functions, no I/O, so the tests run them over small fixture strings.
//
// This is a reader for the shapes these scripts use, not a Lua interpreter. It never invents a point:
//   fixed     a spawn call whose type and x, y, z are literals
//   table     a coordinate table (`local X_LOCS = { {x,y,z[,h]}, ... }`, a type-keyed table, or rows that lead with
//             the type) paired with the type(s) it spawns; a plain table is paired by looking at the spawn call
//             near each use of the table
//   relative  a spawn at `e.self:GetX()+n`, a random offset or other computed spot: no coordinates, only a note
// A table nothing spawns from, or whose type cannot be found, goes to `unresolved` instead of being guessed.
'use strict';

const TYPE_MIN = 200000;   // eqemu_npc_types ids of the PoP planes are zoneid*1000+n: 215xxx..222xxx
const TYPE_MAX = 299999;   // (spawn2 ids are 36xxxx, which is how a SPAWNID constant stays out)
const SPAWN_CALL_RE = /(?:eq\.(?:unique_spawn|spawn2)\s*[(,]|\b\w+:spawn\s*\(|ProjectionEligibility\.Spawn\s*\()/g;
const SPAWNISH_RE = /[Ss]pawn\w*\s*[(,]/;
const WINDOW_AFTER = 8;

// Replace comments with spaces (newlines kept, so line numbers survive). Strings are skipped, not stripped.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && src[i + 1] === '-') {
      const lb = /^--\[(=*)\[/.exec(src.slice(i, i + 12));
      if (lb) {
        const close = ']' + lb[1] + ']';
        const end = src.indexOf(close, i + lb[0].length);
        const stop = end < 0 ? n : end + close.length;
        out += blank(src.slice(i, stop));
        i = stop;
      } else {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        out += blank(src.slice(i, j));
        i = j;
      }
    } else { out += c; i++; }
  }
  return out;
}

const TOKEN_RE = /(\s+)|(\d+\.?\d*(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(==|~=|<=|>=|\.\.|[{}[\]()=,;:.+\-*/%<>#^])/y;

function tokenize(stripped) {
  const toks = [];
  let line = 1;
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < stripped.length) {
    const at = TOKEN_RE.lastIndex;
    const m = TOKEN_RE.exec(stripped);
    if (!m) { TOKEN_RE.lastIndex = at + 1; continue; }   // a character the grammar above does not know: skip it
    if (m[1] !== undefined) line += (m[1].match(/\n/g) || []).length;
    else if (m[2] !== undefined) toks.push({ t: 'num', v: Number(m[2]), line });
    else if (m[3] !== undefined) toks.push({ t: 'id', v: m[3], line });
    else if (m[4] !== undefined) toks.push({ t: 'str', v: m[4], line });
    else toks.push({ t: 'p', v: m[5], line });
  }
  return toks;
}

const cleanHint = (s) => {
  const first = String(s || '').trim().split(/\s+/)[0] || '';
  const name = first.replace(/^#+/, '').replace(/_/g, ' ').trim();
  return /^[A-Za-z]/.test(name) ? name : null;
};

// `local NAME_TYPE = 216048; -- Coirnav_the_Avatar_of_Water` and `local A, B = 222003,222039`.
// Run over the RAW source: the trailing comment is the name hint.
function parseConstants(raw) {
  const consts = new Map();   // name → { id, hint, line }
  const ok = (name, id) => id >= TYPE_MIN && id <= TYPE_MAX && !/SPAWN_?ID/i.test(name);
  raw.split('\n').forEach((ln, idx) => {
    let m = /^\s*local\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*;?\s*(?:--\s*(.*))?$/.exec(ln);
    if (m) {
      if (ok(m[1], Number(m[2]))) consts.set(m[1], { id: Number(m[2]), hint: cleanHint(m[3]), line: idx + 1 });
      return;
    }
    m = /^\s*local\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(\d+(?:\s*,\s*\d+)+)/.exec(ln);
    if (m) {
      const names = m[1].split(',').map(s => s.trim());
      const vals = m[2].split(',').map(s => Number(s.trim()));
      if (names.length === vals.length) names.forEach((nm, i) => { if (ok(nm, vals[i])) consts.set(nm, { id: vals[i], hint: null, line: idx + 1 }); });
    }
  });
  return consts;
}

// ── table constructors ────────────────────────────────────────────────────────────────────────────────────────
// Values: { k:'num', v } | { k:'id', v } | { k:'str' } | { k:'expr' } | { k:'tbl', items }; items: { key, val, line }.
function classifyValue(toks) {
  const t = toks.slice();
  let sign = 1;
  if (t.length === 2 && t[0].t === 'p' && t[0].v === '-' && t[1].t === 'num') { sign = -1; t.shift(); }
  if (t.length === 1 && t[0].t === 'num') return { k: 'num', v: sign * t[0].v };
  if (t.length === 1 && t[0].t === 'id') return { k: 'id', v: t[0].v };
  if (t.length === 1 && t[0].t === 'str') return { k: 'str' };
  return { k: 'expr' };
}

function parseTable(toks, i) {   // toks[i] is '{'; returns [table, indexAfterClosingBrace]
  const items = [];
  const open = toks[i];
  let j = i + 1;
  while (j < toks.length && !(toks[j].t === 'p' && toks[j].v === '}')) {
    if (toks[j].t === 'p' && (toks[j].v === ',' || toks[j].v === ';')) { j++; continue; }
    let key = null;
    if (toks[j].t === 'p' && toks[j].v === '[') {
      let k = j + 1; const kt = [];
      while (k < toks.length && !(toks[k].t === 'p' && toks[k].v === ']')) kt.push(toks[k++]);
      key = classifyValue(kt);
      j = k + 1;
      if (toks[j] && toks[j].v === '=') j++;
    } else if (toks[j].t === 'id' && toks[j + 1] && toks[j + 1].t === 'p' && toks[j + 1].v === '=') {
      key = { k: 'name', v: toks[j].v };
      j += 2;
    }
    const line = toks[j] ? toks[j].line : open.line;
    if (toks[j] && toks[j].t === 'p' && toks[j].v === '{') {
      const [tbl, next] = parseTable(toks, j);
      items.push({ key, val: tbl, line });
      j = next;
    } else {
      const vt = []; let depth = 0;
      while (j < toks.length) {
        const tk = toks[j];
        if (tk.t === 'p') {
          if (tk.v === '(' || tk.v === '[' || tk.v === '{') depth++;
          else if (tk.v === ')' || tk.v === ']') depth--;
          else if (tk.v === '}') { if (depth === 0) break; depth--; }
          else if ((tk.v === ',' || tk.v === ';') && depth === 0) break;
        }
        vt.push(tk); j++;
      }
      items.push({ key, val: classifyValue(vt), line });
    }
  }
  return [{ k: 'tbl', items, line: open.line }, j + 1];
}

// Every `NAME = {` in the file (top level or inside a function), tables nested in another table not repeated.
function findTables(toks) {
  const out = [];
  let i = 0;
  while (i < toks.length - 2) {
    const a = toks[i], b = toks[i + 1], c = toks[i + 2];
    const prev = toks[i - 1];
    if (a.t === 'id' && b.t === 'p' && b.v === '=' && c.t === 'p' && c.v === '{' && !(prev && prev.t === 'p' && (prev.v === '.' || prev.v === ':'))) {
      const [tbl, next] = parseTable(toks, i + 2);
      out.push({ name: a.v, line: a.line, table: tbl });
      i = next;
    } else i++;
  }
  return out;
}

// ── reading the tables ────────────────────────────────────────────────────────────────────────────────────────
const positional = (tbl) => tbl.items.filter(it => it.key === null);
const allPositional = (tbl) => tbl.items.length > 0 && tbl.items.every(it => it.key === null);

// {x,y,z} / {x,y,z,h} / {x,y,z,h,pause} / seven numbers (x,y,z then a MoveTo target and a heading): the spawn point
// is always the first three numbers.
function locOfRow(tbl) {
  if (tbl.k !== 'tbl' || !allPositional(tbl)) return null;
  if (!tbl.items.every(it => it.val.k === 'num')) return null;
  const nums = tbl.items.map(it => it.val.v);
  if (nums.length < 3) return null;
  if (nums.slice(0, 3).some(v => Math.abs(v) >= 100000)) return null;   // a list of spawn2 ids is not a coordinate
  return { x: nums[0], y: nums[1], z: nums[2], h: nums.length === 4 || nums.length === 5 ? nums[3] : null, line: tbl.line };
}

// rows that open with the type(s) they spawn, then x, y, z[, h]: { CHAMPION1_TYPE, -491, -1274, 320, 64 }
function typedRow(tbl, typeOf) {
  if (tbl.k !== 'tbl' || !allPositional(tbl)) return null;
  const types = [];
  let i = 0;
  for (; i < tbl.items.length; i++) {
    const v = tbl.items[i].val;
    const id = v.k === 'id' || v.k === 'num' ? typeOf(v) : null;
    if (id == null) break;
    types.push(id);
  }
  const rest = tbl.items.slice(i);
  if (!types.length || rest.length < 3 || !rest.every(it => it.val.k === 'num')) return null;
  const nums = rest.map(it => it.val.v);
  return { types, x: nums[0], y: nums[1], z: nums[2], h: nums.length === 4 || nums.length === 5 ? nums[3] : null, line: tbl.line };
}

function typeListOf(tbl, typeOf) {   // { A_TYPE, B_TYPE }  → [ids], or null when anything else is in it
  if (tbl.k !== 'tbl' || !allPositional(tbl)) return null;
  const ids = tbl.items.map(it => (it.val.k === 'id' ? typeOf(it.val) : null));
  return ids.length && ids.every(i => i != null) ? ids : null;
}

function splitArgs(text, start) {
  const args = []; let depth = 0; let cur = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) { args.push(cur.trim()); return args; } depth--; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; } else cur += c;
  }
  return null;   // unbalanced: not a call we can read
}

const numLiteral = (s) => (/^-?\d+(?:\.\d+)?$/.test(String(s).trim()) ? Number(s) : null);

// A script's spawn calls, from the comment-stripped text.
function findSpawnCalls(stripped) {
  const calls = [];
  SPAWN_CALL_RE.lastIndex = 0;
  let m;
  while ((m = SPAWN_CALL_RE.exec(stripped))) {
    const args = splitArgs(stripped, m.index + m[0].length);
    if (!args) continue;
    calls.push({ args, index: m.index, line: stripped.slice(0, m.index).split('\n').length });
  }
  return calls;
}

function nameFor(id, consts) {
  for (const c of consts.values()) if (c.id === id && c.hint) return c.hint;
  return null;
}

// parseScript(raw, { zone, script }) → { entries, unresolved, type_ids }
function parseScript(raw, { zone = '', script = '' } = {}) {
  const stripped = stripComments(raw);
  const lines = stripped.split('\n');
  const consts = parseConstants(raw);
  const typeIds = new Set([...consts.values()].map(c => c.id));
  const typeOf = (v) => {
    if (v.k === 'id') return consts.has(v.v) ? consts.get(v.v).id : null;
    if (v.k === 'num') return typeIds.has(v.v) || (v.v >= TYPE_MIN && v.v <= TYPE_MAX) ? v.v : null;
    return null;
  };
  const toks = tokenize(stripped);
  const tables = findTables(toks);
  const calls = findSpawnCalls(stripped);
  const event = String(script).split('/').pop().replace(/\.lua$/, '');

  // Frame. A table copied from a map tool can list Y before X (Fennin: "Y, X, Z, 360 degree headings"); the script
  // says so where it spawns: eq.spawn2(typ, 0, 0, loc[2], loc[1], loc[3], ...). Positions go out as the game's x, y.
  const swapped = calls.some(c => c.args.length >= 5 && /\[\s*2\s*\]\s*$/.test(c.args[3]) && /\[\s*1\s*\]\s*$/.test(c.args[4]));

  const entries = [];
  const unresolved = [];
  const push = (e) => entries.push({ event, script, line: e.line, npc_id: e.npc_id, name: nameFor(e.npc_id, consts), kind: e.kind,
    ...(e.x != null ? (swapped && e.kind === 'table' ? { x: e.y, y: e.x, src_yx: true } : { x: e.x, y: e.y }) : {}),
    ...(e.z != null ? { z: e.z } : {}), ...(e.h != null ? { h: e.h } : {}),
    ...(e.role ? { role: e.role } : {}), ...(e.anchor ? { anchor: e.anchor } : {}), ...(e.note ? { note: e.note } : {}) });

  // type lists, for pairing a plain coordinate table with what spawns on it
  const typeLists = new Map();
  for (const t of tables) { const ids = typeListOf(t.table, typeOf); if (ids) typeLists.set(t.name, { ids, names: t.table.items.map(it => it.val.v) }); }

  const walkTypeMap = (tbl, role) => {
    for (const it of tbl.items) {
      if (!it.key || it.val.k !== 'tbl') continue;
      if (it.key.k === 'id' || it.key.k === 'num') {
        const id = typeOf(it.key);
        if (id != null) {   // keyed by type → a list of rows, or one row
          const one = locOfRow(it.val);
          const rows = one ? [one] : it.val.items.map(r => locOfRow(r.val));
          if (rows.length && rows.every(Boolean)) for (const r of rows) push({ ...r, npc_id: id, kind: 'table', role });
          continue;
        }
        if (it.key.k === 'num') walkTypeMap(it.val, `${role}[${it.key.v}]`);   // keyed by phase, then by type
      }
    }
  };

  const used = new Set();
  const plain = [];   // pure coordinate tables, paired below from how the script uses them
  for (const { name, table } of tables) {
    const role = name.toLowerCase();
    // 1. rows that carry their own type
    const rowsTyped = table.items.map(it => (it.val.k === 'tbl' ? typedRow(it.val, typeOf) : null));
    if (rowsTyped.length && rowsTyped.every(Boolean)) {
      for (const r of rowsTyped) for (const id of r.types) push({ ...r, npc_id: id, kind: 'table', role });
      used.add(name); continue;
    }
    // 2. a type-keyed table (optionally under phase numbers)
    const keyedByType = table.items.length && table.items.every(it => it.key && (it.key.k === 'id' || it.key.k === 'num') && it.val.k === 'tbl');
    if (keyedByType) {
      const before = entries.length;
      walkTypeMap(table, role);
      if (entries.length > before) { used.add(name); continue; }
    }
    // 3. a plain list of coordinates
    if (allPositional(table) && table.items.every(it => it.val.k === 'tbl')) {
      let rows = table.items.map(it => locOfRow(it.val));
      // a list of coordinate lists (StoneRing's FORT_LOCS: one list per trigger): every spot, whichever list
      if (!rows.every(Boolean)) {
        const groups = table.items.map(it => (allPositional(it.val) ? it.val.items.map(r => locOfRow(r.val)) : null));
        rows = groups.every(g => g && g.length && g.every(Boolean)) ? groups.flat() : rows;
      }
      if (rows.every(Boolean)) plain.push({ name, role, rows, line: table.line });
    }
  }

  // Which types spawn at a plain table? Look at the lines around each use of its name, up to the first spawn call.
  for (const p of plain) {
    const re = new RegExp(`\\b${p.name}\\b`);
    const perRow = p.rows.map(() => new Set());
    let any = false;
    lines.forEach((ln, idx) => {
      if (!re.test(ln) || (idx + 1 >= p.line && idx + 1 <= p.rows[p.rows.length - 1].line + 1)) return;
      let to = Math.min(lines.length - 1, idx + WINDOW_AFTER);
      for (let k = idx; k <= to; k++) if (SPAWNISH_RE.test(lines[k]) && !/^\s*(local\s+)?function\b/.test(lines[k])) { to = k; break; }
      const win = lines.slice(idx, to + 1).join('\n');
      if (!SPAWNISH_RE.test(lines[to]) || /^\s*(local\s+)?function\b/.test(lines[to])) return;
      // the spawn must take its spot from the table: its name, a `loc` variable or an indexed coordinate. Otherwise
      // the use is a distance check and the spawn after it is a literal one, read below.
      if (!(re.test(lines[to]) || /\blocs?\d*\b|\[\s*[1-3]\s*\]/.test(lines[to]))) return;
      const ids = []; const names = [];
      for (const w of win.match(/[A-Za-z_]\w*/g) || []) {
        if (typeLists.has(w)) { ids.push(...typeLists.get(w).ids); names.push(w); }
        else if (consts.has(w)) { ids.push(consts.get(w).id); names.push(w); }
      }
      if (!ids.length) return;
      // same index into the type list and the table → the Nth type spawns at the Nth point
      const ix = new RegExp(`\\b${p.name}\\s*\\[\\s*(\\w+)\\s*\\]`).exec(win);
      let paired = false;
      if (ix) {
        for (const [lname, list] of typeLists) {
          if (list.ids.length !== p.rows.length) continue;
          const byIndex = new RegExp(`\\b${lname}\\s*\\[\\s*${ix[1]}\\s*\\]`).test(win)
            || new RegExp(`for\\s+${ix[1]}\\s*,\\s*\\w+\\s+in\\s+ipairs\\(\\s*${lname}\\s*\\)`).test(win);
          if (byIndex) { list.ids.forEach((id, i) => perRow[i].add(id)); paired = true; any = true; break; }
        }
      }
      if (!paired) { for (const id of new Set(ids)) for (const s of perRow) s.add(id); any = true; }
    });
    if (!any) { unresolved.push({ zone, script, table: p.name, line: p.line, rows: p.rows.length }); continue; }
    p.rows.forEach((r, i) => { for (const id of perRow[i]) push({ ...r, npc_id: id, kind: 'table', role: p.role }); });
  }

  // Literal spawn calls, and the ones that follow another mob or roll their spot.
  const placed = new Set(entries.map(e => e.npc_id));
  for (const c of calls) {
    const a = c.args;
    if (a.length < 6) continue;
    const typeTok = tokenize(a[0]);
    const id = typeTok.length === 1 ? typeOf(classifyValue(typeTok)) : null;
    if (id == null) continue;
    const [x, y, z] = [numLiteral(a[3]), numLiteral(a[4]), numLiteral(a[5])];
    if (x != null && y != null && z != null) {
      push({ npc_id: id, kind: 'fixed', x, y, z, h: numLiteral(a[6]), line: c.line });
      continue;
    }
    if (placed.has(id)) continue;   // its spots come from a table above; the call only reads them
    if (/\w\s*\[[^\]]*\]/.test(a.slice(3, 6).join(' '))) continue;   // loc[1], LOCS[t][1]: a table's coordinates
    const own = a.slice(3, 6).join(', ').replace(/\s+/g, ' ');
    const follow = /(\w+(?:\.\w+)?):Get[XYZ]\(/.exec(own);
    push({ npc_id: id, kind: 'relative', line: c.line, anchor: follow ? (follow[1] === 'e.self' ? 'self' : follow[1]) : 'script',
      note: own.length > 120 ? `${own.slice(0, 117)}...` : own });
  }

  entries.sort((p, q) => p.script.localeCompare(q.script) || p.line - q.line || p.npc_id - q.npc_id
    || (p.x ?? 0) - (q.x ?? 0) || (p.y ?? 0) - (q.y ?? 0) || (p.z ?? 0) - (q.z ?? 0) || String(p.kind).localeCompare(q.kind)
    || String(p.role || '').localeCompare(String(q.role || '')));
  // the same (npc, spot, kind) seen from two uses of one table is one entry
  const seen = new Set();
  const unique = entries.filter(e => { const k = `${e.npc_id}|${e.x}|${e.y}|${e.z}|${e.kind}|${e.role || ''}|${e.line}|${e.note || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { entries: unique, unresolved, type_ids: [...typeIds].sort((p, q) => p - q) };
}

module.exports = { parseScript, stripComments, parseConstants, tokenize, findTables, TYPE_MIN, TYPE_MAX };
