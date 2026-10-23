// utils/trapSpawns.js — the traps layer of GET /api/agent/zone-spawns (the guild lead, 2026-10-23: "maps should show
// traps as well").
//
// TWO kinds of trap exist on this server and the Map needs both:
//
//  1. TRAP SPOTS (the Planes of Power kind, and most of what a raider means by "trap"). A trap is an invisible
//     helper NPC placed through the ordinary spawn tables (race 127, body type 65/66/67, an aggro radius, no name worth
//     reading: `TrapMan3`). Walking into its aggro radius fires its combat event and the zone's quest script spawns
//     the real thing in its place. In Plane of Earth (poeartha/encounters/Traps.lua) the script is
//         TRAP_SPAWNS = { [218341] = { <trap mob>, <named>, <its placeholder> }, ... }
//     and TrapCombat spawns the trap mob (the first id); on the 5th pull of that trap type (one counter per type,
//     shared by all its spots) it spawns the named or the placeholder instead, 50/50. Thirteen types, 73 spots.
//     Griegs End and Vex Thal carry the same shape under `TYPES` (a spot spawns one of several variants). Every
//     other trap-named helper (necropolis, thegrey, bothunder, scarlet, dawnshroud, ...) is a spot with no script
//     table: drawn with its own name. The spots are NOT a new table: the spawn mirrors already hold them, and the
//     scripts are in eqemu_quest_scripts. This module reads the script, never a copy of it, so a server change to the
//     trap list reaches the Map with the next weekly script sync.
//
//  2. THE `traps` TABLE (zone/trap.cpp): classic EQEmu traps with a position, a trigger radius, a chance and an
//     effect. Mirrored as eqemu_traps (83 rows, 8 zones, none in the Planes of Power). Same server frame as spawn2.
//
// The shape this adds to the zone-spawns body (all of it optional; a Mimic that does not know it ignores it):
//   point.trap       the helper NPC id of a spot, a key into traps.defs   (only on a point that is a trap spot)
//   traps.defs       { "<helper npc id>": { k, grp, ch, r, title, text } }
//   traps.table      [ { id, x, y, z, r, mz, pct, lv, fx, hid, title, text } ]   (the `traps` table rows)
// Everything here is decoration: a failed read leaves `traps` smaller or null and the map still answers.

const HELPER_BODYTYPES = new Set([65, 66, 67]);
// "Trapamyamu" is a quest NPC, "trapper" a hunter, "Trap_control" a zone controller: none is a trap.
const TRAP_NAME_RE = /trap/i;
const NOT_A_TRAP_RE = /trapamyamu|trapper|control/i;
const CHUNK = 100;
const OUTS_SHOWN = 6;

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const num = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null);
const ARTICLE_RE = /^(a|an|the)\s+/i;
// "A_Needlescale_Hatchling" / "#Qua_Centien_Xakra" → "A Needlescale Hatchling" / "Qua Centien Xakra".
const cleanName = (n) => String(n || '').replace(/_/g, ' ').replace(/#/g, '').trim();

function stripLuaComments(s) {
  return String(s || '').replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '');
}

// The trap table a zone's `encounters/traps.lua` declares: `local TRAP_SPAWNS = { [id] = { a, b, c }, ... }` (Plane of
// Earth) or `local TYPES = { [id] = { ...ids }, ... }` (Griegs End, Vex Thal). → { name, entries: Map(id → [ids]) },
// or null when the file has no such table. Only the FIRST such table counts (Griegs End also declares SPAWN_CHANCE, a
// table of odds, which is not ours to read). A flat list (`TYPES = { 216255, 216252 }`, Plane of Water) has no
// `[id] = { }` entries and answers null.
function parseTrapTable(body) {
  const src = stripLuaComments(body);
  const m = /\blocal\s+(TRAP_SPAWNS|TYPES)\s*=\s*\{/.exec(src);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  const inner = src.slice(start, depth === 0 ? i - 1 : i);
  const entries = new Map();
  const rx = /\[(\d+)\]\s*=\s*\{([^{}]*)\}/g;
  let e;
  while ((e = rx.exec(inner))) {
    const ids = (e[2].match(/\d+/g) || []).map(Number);
    if (ids.length) entries.set(Number(e[1]), ids);
  }
  return entries.size ? { name: m[1], entries } : null;
}

// Is this NPC row a trap spot? A helper (body type 65/66/67) that is a key of the zone's script table, or is named for
// a trap. Body type is the first gate: Erollisi_mantrap is a plant you fight, not a trap.
function isTrapHelper(npc, table) {
  if (!npc || !HELPER_BODYTYPES.has(num(npc.bodytype))) return false;
  if (table && table.entries.has(Number(npc.id))) return true;
  const name = String(npc.name || '');
  return TRAP_NAME_RE.test(name) && !NOT_A_TRAP_RE.test(name);
}

const lvl = (n) => (n && num(n.level) > 0 ? ` (${num(n.level)})` : '');
const label = (n, id) => (n && n.name ? cleanName(n.name) : `#${id}`);

// A trap type's definition for the Map: what it is called, what it does in words, and how to draw it. `names` is
// Map(npc id → { name, level }) for every id the script table lists.
function defFor(id, helper, table, names, grp) {
  const ids = table && table.entries.get(id);
  const r = num(helper.aggroradius) > 0 ? num(helper.aggroradius) : null;
  const base = { k: 'marker', grp: 0, ch: '!', r, title: cleanName(helper.name) || 'trap', text: 'A trap spot: the server places an invisible trap NPC here.' };
  if (!ids) return base;
  if (table.name === 'TRAP_SPAWNS' && ids.length === 3) {
    const [mobId, namedId, phId] = ids;
    const mob = names.get(mobId), named = names.get(namedId), ph = names.get(phId);
    if (mobId === namedId && namedId === phId) {   // the Plane of Earth skeleton trap: one thing, always
      return { k: 'ladder', grp: 0, ch: '!', r, title: `Trap spot: ${label(mob, mobId)}`,
        text: `Walking in can spawn ${label(mob, mobId)}${lvl(mob)}. It does not trigger every time.` };
    }
    const nm = label(named, namedId).replace(ARTICLE_RE, '');
    return {
      k: 'ladder', grp, ch: (nm[0] || '!').toUpperCase(), r,
      title: `Trap spot: ${label(mob, mobId)} → ${label(named, namedId)}`,
      text: `Walking in spawns ${label(mob, mobId)}${lvl(mob)}. On the 5th pull of this trap type (one count, shared by all its spots) it spawns instead, `
        + `50/50: the named ${label(named, namedId)}${lvl(named)}, or its placeholder ${label(ph, phId)}${lvl(ph)}.`,
    };
  }
  // A TYPES table: the spot spawns one of its variants.
  const outs = [...new Set(ids.map(i => label(names.get(i), i)))];
  const shown = outs.slice(0, OUTS_SHOWN).join(', ') + (outs.length > OUTS_SHOWN ? `, +${outs.length - OUTS_SHOWN} more` : '');
  return { k: 'spawner', grp: 0, ch: '!', r, title: 'Ambush spot',
    text: `Walking in spawns one of ${outs.length}: ${shown}.` };
}

// ── The `traps` table ────────────────────────────────────────────────────────
const FX_WORD = { 0: 'spell', 1: 'alarm', 2: 'spawn', 3: 'spawn', 4: 'damage' };

// One row of eqemu_traps → what it does, in plain words. effect values follow zone/trap.h:
//   0 debuff (effectvalue = a spell id, 0 = flavour text only) · 1 alarm (effectvalue = the shout's reach,
//   effectvalue2 = how far it pulls mobs) · 2 and 3 spawn (effectvalue = npc id, effectvalue2 = how many) ·
//   4 damage (a random hit from effectvalue to effectvalue2).
// `names` = { spell: Map(id → name), npc: Map(id → name) }.
function trapRowWords(row, names) {
  const v1 = num(row.effectvalue) || 0, v2 = num(row.effectvalue2) || 0;
  const spell = names && names.spell && names.spell.get(v1);
  const npc = names && names.npc && names.npc.get(v1);
  switch (num(row.effect)) {
    case 0: return v1 > 0
      ? { fx: 'spell', title: `Trap: ${spell ? cleanName(spell) : `spell ${v1}`}`, does: `casts ${spell ? cleanName(spell) : `spell ${v1}`} on whoever sets it off` }
      : { fx: 'spell', title: 'Trap', does: 'only prints its message (no spell)' };
    case 1: return { fx: 'alarm', title: 'Alarm trap', does: `sounds an alarm${v2 > 0 ? ` that pulls mobs within ${v2}` : ''}` };
    case 2: case 3: {
      const who = npc ? cleanName(npc) : `npc ${v1}`;
      return { fx: 'spawn', title: `Spawn trap: ${who}`, does: `spawns ${v2 > 1 ? `${v2} × ` : ''}${who}` };
    }
    case 4: return { fx: 'damage', title: 'Damage trap', does: `hits for ${v1}${v2 > v1 ? `–${v2}` : ''}` };
    default: return { fx: FX_WORD[num(row.effect)] || 'trap', title: 'Trap', does: `does effect ${num(row.effect)}` };
  }
}

function tableRow(row, names) {
  const w = trapRowWords(row, names);
  const hid = !!num(row.undetectable);
  const pct = num(row.chance) || 0;
  const respawn = num(row.respawn_time) || 0;
  const bits = [
    `${w.does.charAt(0).toUpperCase()}${w.does.slice(1)}.`,
    `Sets off ${pct > 0 && pct < 100 ? `${pct}% of the time` : 'every time'} within ${num(row.radius) || 0}${num(row.maxzdiff) ? ` (±${num(row.maxzdiff)} high)` : ''}.`,
    num(row.level) > 1 ? `Level ${num(row.level)}.` : '',
    respawn > 0 ? `Re-arms ${respawn >= 120 ? `after ${Math.round(respawn / 60)} min` : `after ${respawn}s`}.` : '',
    hid ? 'Undetectable: Sense Traps will not find it.' : '',
  ].filter(Boolean);
  const msg = String(row.message || '').trim();
  return {
    id: row.id, x: num(row.x), y: num(row.y), z: num(row.z),
    r: num(row.radius) || 0, mz: num(row.maxzdiff) || 0, pct, lv: num(row.level) || 1,
    fx: w.fx, hid, title: w.title,
    text: bits.join(' ') + (msg ? ` “${msg}”` : ''),
  };
}

// Everything the Map needs to draw one zone's traps.
//   points   the zone's built points (as zoneSpawns builds them: { id, npcs: [{ name, ... }] })
//   spawn2 / entriesByGroup / npcs   what zoneSpawns already read (npcs = Map(id → NPC_SELECT row))
// → { traps, trapOf } where `traps` = { defs, table } | null and `trapOf` = Map(spawn2 id → helper npc id).
// Never throws: a read that fails leaves that part out.
async function build(supabase, zone, spawn2, entriesByGroup, npcs) {
  const trapOf = new Map();
  let defs = null, table = null;
  try {
    const helpers = [...npcs.values()].filter(n => HELPER_BODYTYPES.has(num(n.bodytype)));
    let script = null;
    if (helpers.length) {
      const rows = await supabase.select('eqemu_quest_scripts',
        `path=ilike.${encodeURIComponent(`${zone}/encounters/traps.lua`)}&select=body&limit=1`);
      if (Array.isArray(rows) && rows[0]) script = parseTrapTable(rows[0].body);
    }
    const trapNpc = new Map();   // helper npc id → row
    for (const n of helpers) if (isTrapHelper(n, script)) trapNpc.set(n.id, n);
    if (trapNpc.size) {
      for (const sp of spawn2) {
        for (const e of entriesByGroup.get(sp.spawngroup_id) || []) {
          if (trapNpc.has(e.npc_id)) { trapOf.set(sp.id, e.npc_id); break; }
        }
      }
      // The ids the script spawns, named from the catalog.
      const names = new Map();
      const want = new Set();
      for (const id of trapNpc.keys()) for (const i of (script && script.entries.get(id)) || []) want.add(i);
      for (const ids of chunks([...want], CHUNK)) {
        const rows = await supabase.select('eqemu_npc_types', `id=in.(${ids.join(',')})&select=id,name,level&limit=${CHUNK}`);
        if (Array.isArray(rows)) for (const r of rows) names.set(r.id, r);
      }
      // grp: the Nth ladder type, by helper id, so a type keeps its colour from one zone-in to the next.
      const ladderIds = [...trapNpc.keys()].filter(id => script && script.name === 'TRAP_SPAWNS' && (script.entries.get(id) || []).length === 3)
        .sort((a, b) => a - b);
      defs = {};
      const used = new Set(trapOf.values());
      for (const id of [...used].sort((a, b) => a - b)) {
        const g = ladderIds.indexOf(id) + 1;
        defs[id] = defFor(id, trapNpc.get(id), script, names, g);
      }
    }
    // The classic table. A failed read (the table not applied yet, say) just leaves it out.
    const crows = await supabase.select('eqemu_traps', `zone=eq.${encodeURIComponent(zone)}&select=*&order=id.asc&limit=500`);
    if (Array.isArray(crows) && crows.length) {
      const spellIds = [...new Set(crows.filter(r => num(r.effect) === 0 && num(r.effectvalue) > 0).map(r => num(r.effectvalue)))];
      const npcIds = [...new Set(crows.filter(r => num(r.effect) === 2 || num(r.effect) === 3).map(r => num(r.effectvalue)).filter(v => v > 0))];
      const nm = { spell: new Map(), npc: new Map() };
      for (const ids of chunks(spellIds, CHUNK)) {
        const rows = await supabase.select('eqemu_spells', `id=in.(${ids.join(',')})&select=id,name&limit=${CHUNK}`);
        if (Array.isArray(rows)) for (const r of rows) nm.spell.set(r.id, r.name);
      }
      for (const ids of chunks(npcIds, CHUNK)) {
        const rows = await supabase.select('eqemu_npc_types', `id=in.(${ids.join(',')})&select=id,name&limit=${CHUNK}`);
        if (Array.isArray(rows)) for (const r of rows) nm.npc.set(r.id, r.name);
      }
      table = crows.map(r => tableRow(r, nm));
    }
  } catch (e) {
    console.warn('[zone-spawns] traps layer skipped:', e && e.message);
  }
  const traps = (defs && Object.keys(defs).length) || (table && table.length) ? { defs: defs || {}, table: table || [] } : null;
  return { traps, trapOf };
}

module.exports = { build, parseTrapTable, isTrapHelper, defFor, trapRowWords, tableRow, cleanName };
