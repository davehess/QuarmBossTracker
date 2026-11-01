// utils/splitSpawns.js — which mobs split, for the `splits` field of GET /api/agent/zone-spawns (the guild lead,
// 2026-11-01, on the Map's spawn list in the Planes of Power: "some of these mobs split, we should denote it").
//
// A mob "splits" when its own death script spawns other NPCs where it died: a Phoenix Breezewing that breaks into
// three Gustlets, a shambling cube that leaves two smaller cubes. Nothing in the catalog (eqemu_npc_types, the spawn
// tables) says so; the SERVER's quest scripts do, and they are already mirrored in eqemu_quest_scripts
// (scripts/sync-quest-scripts.js, github.com/SecretsOTheP/quests). This module reads the script, never a copy of it,
// so a server change reaches the Map with the next weekly script sync — the same shape as utils/trapSpawns.js.
//
// WHAT COUNTS (the parse rules; test/split-spawns.test.js pins each):
//   · A `eq.spawn2(...)` or `eq.unique_spawn(...)` inside `function event_death_complete(e)` or `function event_death(e)`
//     whose x AND y arguments are the dead NPC's own spot: `e.self:GetX()` / `e.self:GetY()`, with or without an
//     offset (`GetX()+5`), or a variable assigned from them (`local x, y, z, h = e.self:GetX(), e.self:GetY(), ...`).
//   · FIXED coordinates are NOT a split. `eq.spawn2(212418, 0, 0, -1087, 2022, -902, 128)` is a named or a wave
//     appearing somewhere else (Solusek Ro tower, Plane of Disease Aramin): progression, not a mob breaking apart.
//   · The NPC id is a number, or a name bound to a number at the top of the script (`local INLOKHER_TYPE = 215395`).
//     Anything else (a variable that is not a plain number, `eq.ChooseRandom(...)`) is skipped: it cannot be named.
//   · How many: a plain call is 1. Inside `for i = a, b do` it is b-a+1; `a` and `b` may be numbers or a variable last
//     assigned a number or `math.random(n)` / `math.random(m,n)`. In an `if`/`elseif`/`else` chain the branches are
//     alternatives (min..max across them) and, unless the chain provably covers every value of the tested variable
//     or has an `else`, "no spawn" is one of the alternatives, so min is 0. Sibling `if (rand == 1) ... if (rand == 2)`
//     blocks that cannot both be true are read as one chain. A count that cannot be read (a `while`, a `repeat`, a loop
//     bound that is not a number) is { min: 1, max: null }: "at least one, unknown", never a guess.
//   · NOT followed: helper functions the handler calls (`DepopBoars()`, `RespawnAdds()`), and spawns made from other
//     events (a Vallon Zek that splits at 50% HP is in data/split-overrides.json instead).
//   · `unique_spawn` only spawns when none of that id is up; its entries carry `unique: true` (a placeholder that
//     brings up its named, not a mob that breaks apart).
//
// THE SHAPE. build() → Map keyed the way the script is keyed:
//     'id:<npc id>'      a script named <npc id>.lua
//     'name:<name>'      a script named for the NPC (A_Phoenix_Breezewing.lua), lower-cased, with only a-z 0-9 _ #
//   → { into: [{ name, min, max, unique? }], at?, note? }       (max null = "unknown")
// splitsFor(map, npcRow) answers the entry for an eqemu_npc_types row (its id first, then its name), or null.
//
// Reads (bounded, and decoration like trapSpawns: a failed read answers an empty map, never throws):
//   · eqemu_quest_scripts   this zone's scripts that mention event_death, minus encounters/ — path, body
//   · eqemu_npc_types       the spawned ids' names, chunked
const fs = require('fs');
const path = require('path');

const CHUNK = 100;
const SCRIPT_LIMIT = 500;   // a zone has a few hundred scripts at most; the cap is PostgREST's 1,000 anyway
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const cleanName = (n) => String(n || '').replace(/_/g, ' ').replace(/#/g, '').trim();

// ── The parse ────────────────────────────────────────────────────────────────

// Comments and string literals out, so an "end" in a Say() or a spawn in a comment never counts. Strings keep their
// quotes (""), which is all the rest needs.
function stripLua(s) {
  let src = String(s || '').replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, ' ').replace(/--[^\n]*/g, ' ');
  src = src.replace(/"(?:\\.|[^"\\\n])*"/g, '""').replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  return src;
}

const KW_RE = /\b(elseif|else|if|then|for|while|do|repeat|until|function|end)\b|\beq\s*\.\s*(spawn2|unique_spawn)\s*\(/g;

function tokenize(src) {
  const toks = [];
  let m;
  KW_RE.lastIndex = 0;
  while ((m = KW_RE.exec(src))) {
    if (m[1]) toks.push({ k: m[1], i: m.index, end: m.index + m[0].length });
    else toks.push({ k: 'spawn', unique: m[2] === 'unique_spawn', i: m.index, end: m.index + m[0].length });   // end = just past '('
  }
  return toks;
}

// The text of a call's arguments, from just past its '(' to the matching ')'. → { text, close } or null.
function callArgs(src, from) {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return { text: src.slice(from, i), close: i };
  }
  return null;
}

function splitArgs(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of text) {
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

// Turns the token stream into a tree: spawn / for / while / repeat / if / fn items, in source order.
function parseTree(src, toks) {
  let p = 0;
  function parse(stop) {
    const items = [];
    while (p < toks.length) {
      const t = toks[p];
      if (stop && stop.has(t.k)) return items;
      if (t.k === 'spawn') {
        const a = callArgs(src, t.end);
        p++;
        if (a) {
          while (p < toks.length && toks[p].i < a.close) p++;   // tokens inside the argument list are not statements
          items.push({ type: 'spawn', unique: t.unique, args: splitArgs(a.text), pos: t.i });
        }
      } else if (t.k === 'if') {
        const branches = [];
        let hasElse = false;
        let cur = t;
        for (;;) {
          p++;
          let q = p;
          while (q < toks.length && toks[q].k !== 'then') q++;
          const cond = src.slice(cur.end, q < toks.length ? toks[q].i : src.length);
          p = Math.min(q + 1, toks.length);
          const body = parse(new Set(['elseif', 'else', 'end']));
          branches.push({ cond, items: body, pos: cur.i });
          const nx = toks[p];
          if (nx && nx.k === 'elseif') { cur = nx; continue; }
          if (nx && nx.k === 'else') { p++; branches.push({ cond: null, items: parse(new Set(['end'])), pos: nx.i }); hasElse = true; }
          p++;   // the closing 'end'
          break;
        }
        items.push({ type: 'if', branches, hasElse, pos: t.i });
      } else if (t.k === 'for' || t.k === 'while') {
        p++;
        let q = p;
        while (q < toks.length && toks[q].k !== 'do') q++;
        const header = src.slice(t.end, q < toks.length ? toks[q].i : src.length);
        p = Math.min(q + 1, toks.length);
        const body = parse(new Set(['end']));
        p++;
        items.push({ type: t.k === 'for' ? 'for' : 'loop', header, items: body, pos: t.i });
      } else if (t.k === 'repeat') {
        p++;
        const body = parse(new Set(['until']));
        p++;
        items.push({ type: 'loop', header: '', items: body, pos: t.i });
      } else if (t.k === 'do') {
        p++;
        items.push(...parse(new Set(['end'])));
        p++;
      } else if (t.k === 'function') {
        const name = (/^\s*([A-Za-z_][\w.:]*)/.exec(src.slice(t.end)) || [])[1] || '';
        p++;
        const body = parse(new Set(['end']));
        p++;
        items.push({ type: 'fn', name, items: body, pos: t.i });
      } else {
        p++;   // a stray then / do / until / end / else: nothing to build from it
      }
    }
    return items;
  }
  return parse(null);
}

function findHandlers(items, out = []) {
  for (const it of items) {
    if (it.type === 'fn' && /^event_death(_complete)?$/i.test(it.name)) out.push(it);
    if (it.items) findHandlers(it.items, out);
    if (it.branches) for (const b of it.branches) findHandlers(b.items, out);
  }
  return out;
}

// ── Values: what a variable held when a spawn call ran ───────────────────────

// Assignments in source order: [{ name, rhs, pos }]. `local a, b = x, y` pairs them off; a `for i = 1, 3 do` header
// is not an assignment of i.
function assignments(src) {
  const out = [];
  const rx = /(?:^|[\s;(])(?<!\bfor\s+)(?:local\s+)?([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=(?!=)\s*([^\n;]*)/g;
  let m;
  while ((m = rx.exec(src))) {
    const names = m[1].split(',').map(s => s.trim());
    // A statement can share its line (`rand = math.random(2) if (rand == 1) then`): each value stops at the next keyword.
    const rhs = splitArgs(m[2]).map(v => v.replace(/\s+(?:if|for|while|local|eq\.|end|return|then|else|elseif)\b[\s\S]*$/, '').trim());
    names.forEach((name, i) => out.push({ name, rhs: rhs[i] != null ? rhs[i] : '', pos: m.index }));
  }
  return out;
}

function makeEnv(src, assigns) {
  const consts = new Map();   // a name bound to a plain number anywhere in the script: NPC id constants
  for (const m of src.matchAll(/\blocal\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*(?:;|\n|$)/g)) if (!consts.has(m[1])) consts.set(m[1], Number(m[2]));
  // The last assignment of `name` before `pos`, as the raw right-hand side (or null).
  const rhsAt = (name, pos) => {
    let hit = null;
    for (const a of assigns) if (a.name === name && a.pos < pos) hit = a;
    return hit ? hit.rhs : null;
  };
  // A numeric range for an expression: { lo, hi } or null.
  const rangeOf = (expr, pos, depth = 0) => {
    const e = String(expr || '').trim();
    if (/^\d+$/.test(e)) return { lo: Number(e), hi: Number(e) };
    let m = /^math\.random\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(e);
    if (m) return m[2] != null ? { lo: Number(m[1]), hi: Number(m[2]) } : { lo: 1, hi: Number(m[1]) };
    if (/^[A-Za-z_]\w*$/.test(e) && depth < 3) {
      const r = rhsAt(e, pos);
      if (r != null) return rangeOf(r, pos, depth + 1);
      if (consts.has(e)) return { lo: consts.get(e), hi: consts.get(e) };
    }
    return null;
  };
  // Is this expression the dead NPC's own X (or Y)? GetX()/GetY() on e.self, with an offset or not, or a variable bound to it.
  const own = (expr, axis, pos, depth = 0) => {
    const e = String(expr || '').trim();
    if (new RegExp(`\\be\\.self(?::CastTo\\w+\\(\\))?:Get${axis}\\s*\\(\\s*\\)`).test(e)) return true;
    const id = /^([A-Za-z_]\w*)\b/.exec(e);
    if (id && depth < 3) {
      const r = rhsAt(id[1], pos);
      if (r != null) return own(r, axis, pos, depth + 1);
    }
    return false;
  };
  const npcId = (expr, pos) => {
    const e = String(expr || '').trim();
    if (/^\d+$/.test(e)) return Number(e);
    if (/^[A-Za-z_]\w*$/.test(e)) {
      const r = rhsAt(e, pos);
      if (r != null) return /^\d+$/.test(r.trim()) ? Number(r) : null;
      if (consts.has(e)) return consts.get(e);
    }
    return null;
  };
  return { rangeOf, own, npcId };
}

// ── Counting ─────────────────────────────────────────────────────────────────
// A count is { min, max } with max null = unknown. Sequence adds; alternatives take the widest span.
const ZERO = { min: 0, max: 0 };
const add = (a, b) => ({ min: a.min + b.min, max: a.max == null || b.max == null ? null : a.max + b.max });
const alt = (list) => ({ min: Math.min(...list.map(c => c.min)), max: list.some(c => c.max == null) ? null : Math.max(...list.map(c => c.max)) });
const times = (n, inner) => ({
  min: n.min * inner.min,
  max: inner.max === 0 ? 0 : (n.max == null || inner.max == null ? null : n.max * inner.max),
});

const SIMPLE_COND_RE = /^\s*\(?\s*([A-Za-z_]\w*)\s*(==|~=|<=|>=|<|>)\s*(\d+)\s*\)?\s*$/;
function simpleCond(cond) {
  const m = SIMPLE_COND_RE.exec(String(cond || ''));
  return m ? { v: m[1], op: m[2], n: Number(m[3]) } : null;
}
const holds = (c, x) => (c.op === '==' ? x === c.n : c.op === '~=' ? x !== c.n : c.op === '<' ? x < c.n : c.op === '>' ? x > c.n : c.op === '<=' ? x <= c.n : x >= c.n);

function makeCounter(env) {
  function forCount(header, pos) {
    const m = /^\s*[A-Za-z_]\w*\s*=\s*([^,]+),\s*([^,]+?)\s*(?:,\s*([^,]+))?\s*$/.exec(header);
    if (!m || (m[3] != null && m[3].trim() !== '1')) return { min: 1, max: null };
    const a = env.rangeOf(m[1], pos), b = env.rangeOf(m[2], pos);
    if (!a || !b) return { min: 1, max: null };
    return { min: Math.max(0, b.lo - a.hi + 1), max: Math.max(0, b.hi - a.lo + 1) };
  }

  // One if-chain's alternatives, plus whether "none of them" is also possible.
  function chain(branches, hasElse, pos, id) {
    const alts = branches.map(b => seq(b.items, id));
    let exhaustive = hasElse;
    if (!exhaustive) {
      const conds = branches.map(b => simpleCond(b.cond));
      if (conds.every(Boolean) && conds.every(c => c.v === conds[0].v)) {
        const r = env.rangeOf(conds[0].v, pos);
        if (r && r.hi - r.lo <= 200) {
          exhaustive = true;
          for (let x = r.lo; x <= r.hi; x++) if (!conds.some(c => holds(c, x))) { exhaustive = false; break; }
        }
      }
    }
    return exhaustive ? alt(alts) : alt([...alts, ZERO]);
  }

  // Sibling `if (rand == 1) ... end  if (rand == 2) ... end` that can never both be true read as one chain.
  function exclusiveRun(items, i) {
    const first = items[i];
    if (first.type !== 'if' || first.hasElse || first.branches.length !== 1) return 0;
    const c0 = simpleCond(first.branches[0].cond);
    if (!c0) return 0;
    const run = [first];
    for (let j = i + 1; j < items.length; j++) {
      const it = items[j];
      const c = it.type === 'if' && !it.hasElse && it.branches.length === 1 ? simpleCond(it.branches[0].cond) : null;
      if (!c || c.v !== c0.v) break;
      run.push(it);
    }
    if (run.length < 2) return 0;
    const r = env.rangeOf(c0.v, first.pos);
    if (!r || r.hi - r.lo > 200) return 0;
    for (let x = r.lo; x <= r.hi; x++) {
      if (run.filter(it => holds(simpleCond(it.branches[0].cond), x)).length > 1) return 0;
    }
    return run.length;
  }

  function seq(items, id) {
    let total = ZERO;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type === 'spawn') {
        if (spawnOf(it) && spawnOf(it).id === id) total = add(total, { min: 1, max: 1 });
      } else if (it.type === 'for') {
        total = add(total, times(forCount(it.header, it.pos), seq(it.items, id)));
      } else if (it.type === 'loop') {
        const inner = seq(it.items, id);
        total = add(total, inner.max === 0 ? ZERO : { min: inner.min, max: null });
      } else if (it.type === 'if') {
        const n = exclusiveRun(items, i);
        if (n) {
          const run = items.slice(i, i + n);
          const r = env.rangeOf(simpleCond(run[0].branches[0].cond).v, run[0].pos);
          const covered = [];
          for (let x = r.lo; x <= r.hi; x++) covered.push(run.some(s => holds(simpleCond(s.branches[0].cond), x)));
          const alts = run.map(s => seq(s.branches[0].items, id));
          total = add(total, alt(covered.every(Boolean) ? alts : [...alts, ZERO]));
          i += n - 1;
        } else {
          total = add(total, chain(it.branches, it.hasElse, it.pos, id));
        }
      }
      // 'fn' (a nested function) is not part of this handler's flow
    }
    return total;
  }

  // The spawn call's id if it lands on the dead NPC's own spot, else null.
  function spawnOf(it) {
    if (it._s !== undefined) return it._s;
    let r = null;
    const a = it.args;
    if (a.length >= 5 && env.own(a[3], 'X', it.pos) && env.own(a[4], 'Y', it.pos)) {
      const id = env.npcId(a[0], it.pos);
      if (id != null) r = { id, unique: it.unique };
    }
    it._s = r;
    return r;
  }

  function walkSpawns(items, out) {
    for (const it of items) {
      if (it.type === 'spawn') { const s = spawnOf(it); if (s) out.push(s); }
      if (it.items) walkSpawns(it.items, out);
      if (it.branches) for (const b of it.branches) walkSpawns(b.items, out);
    }
    return out;
  }
  return { seq, walkSpawns };
}

// One script's body → [{ id, min, max, unique }] in the order the ids first appear. [] when it splits nothing.
function parseDeathSplits(body) {
  try {
    const src = stripLua(body);
    if (!/event_death/i.test(src)) return [];
    const tree = parseTree(src, tokenize(src));
    const handlers = findHandlers(tree);
    if (!handlers.length) return [];
    const env = makeEnv(src, assignments(src));
    const counter = makeCounter(env);
    const items = handlers.flatMap(h => h.items);
    const spawns = counter.walkSpawns(items, []);
    const out = [];
    for (const id of [...new Set(spawns.map(s => s.id))]) {
      const c = counter.seq(items, id);
      if (c.max === 0) continue;
      out.push({ id, min: c.min, max: c.max, unique: spawns.filter(s => s.id === id).every(s => s.unique) });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Keys ─────────────────────────────────────────────────────────────────────

// 'poair/A_Phoenix_Breezewing.lua' → 'name:a_phoenix_breezewing'; 'potactics/214026.lua' → 'id:214026'. The name keeps its
// '#' (the server finds '#Rizlona.lua' and 'Rizlona.lua' as two different scripts) and drops punctuation that a file name
// and an NPC name spell differently (a backtick in the catalog, a '-' in the file).
const nameKey = (s) => 'name:' + String(s || '').toLowerCase().replace(/[^a-z0-9_#]/g, '');
function keyOfPath(p) {
  const base = String(p || '').split('/').pop().replace(/\.lua$/i, '');
  return /^\d+$/.test(base) ? 'id:' + base : nameKey(base);
}

// ── Overrides ────────────────────────────────────────────────────────────────
// data/split-overrides.json: { "<zone>": [{ npc_id, at, note, into: [{ id, min, max }] }] }. For a split the death handler
// does not hold (Vallon Zek breaks into five at 50% HP). Read once; a missing or broken file is no overrides.
let _overrides = null;
function overrides() {
  if (_overrides) return _overrides;
  try { _overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'split-overrides.json'), 'utf8')) || {}; }
  catch { _overrides = {}; }
  return _overrides;
}

// ── The read ─────────────────────────────────────────────────────────────────

// → Map(key → { into: [{ name, min, max, unique? }], at?, note? }). Never throws; a failed read is an empty map.
async function build(supabase, zone) {
  const out = new Map();
  try {
    const found = new Map();   // key → { into: [{ id, min, max, unique }], at?, note? }
    const rows = await supabase.select('eqemu_quest_scripts',
      `zone_short=eq.${encodeURIComponent(zone)}&body=ilike.${encodeURIComponent('*event_death*')}`
      + `&path=not.ilike.${encodeURIComponent('*/encounters/*')}&select=path,body&order=path.asc&limit=${SCRIPT_LIMIT}`);
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const into = parseDeathSplits(r && r.body);
        if (into.length) found.set(keyOfPath(r.path), { into });
      }
    }
    for (const o of overrides()[zone] || []) {
      if (o && o.npc_id && Array.isArray(o.into) && o.into.length) {
        found.set('id:' + o.npc_id, { into: o.into.map(e => ({ id: e.id, min: e.min, max: e.max, unique: false })), at: o.at, note: o.note });
      }
    }
    if (!found.size) return out;
    const ids = [...new Set([...found.values()].flatMap(f => f.into.map(e => e.id)))];
    const names = new Map();
    for (const part of chunks(ids, CHUNK)) {
      const nr = await supabase.select('eqemu_npc_types', `id=in.(${part.join(',')})&select=id,name&limit=${CHUNK}`);
      if (Array.isArray(nr)) for (const r of nr) names.set(Number(r.id), r.name);
    }
    for (const [key, f] of found) {
      const into = f.into.filter(e => names.has(e.id)).map(e => ({
        name: cleanName(names.get(e.id)), min: e.min, max: e.max, ...(e.unique ? { unique: true } : {}),
      }));
      if (into.length) out.set(key, { into, ...(f.at ? { at: f.at } : {}), ...(f.note ? { note: f.note } : {}) });
    }
  } catch (e) {
    console.warn('[zone-spawns] splits layer skipped:', e && e.message);
    return new Map();
  }
  return out;
}

// The entry for an eqemu_npc_types row, by its id then by its name, or null.
function splitsFor(map, npc) {
  if (!map || !map.size || !npc) return null;
  return map.get('id:' + npc.id) || map.get(nameKey(npc.name)) || null;
}

module.exports = { build, splitsFor, parseDeathSplits, keyOfPath, nameKey };
