'use strict';
// scripts/lib/botBuilders.js — runs the bot's OWN catalog and zone-pack builders, from the shipped index.js.
//
// scripts/build-data-pack.js (the weekly game-data pack, DECISIONS 2026-10-21 "Data pack") must publish
// byte-for-byte what the bot serves Mimic today, so it cannot carry a second copy of those builders. index.js
// cannot be require()d (it logs a Discord client in), so this reads the file and evaluates exactly the blocks
// the bot's own tests evaluate (test/cap-safe-reads, test/mob-pack, test/named-bosses): the real request
// handlers for the three catalogs, and the real zone-pack section with _buildMobInfo behind it. There is ONE
// builder per answer, and it is the one in production. Nothing was moved out of index.js to make that so
// (an 18k-line monolith: moving ~700 lines would have re-pointed fifteen source-slice tests for no gain).
//
// ⚠ Every marker below is text in index.js. A refactor that renames or moves one makes sliceBetween throw
// naming the marker; test/data-pack.test.js runs this loader against a fixture database on every push, so
// the break shows up on the commit that causes it, not on the Sunday the pack is due.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.js');

// [start, end] inclusive of `end`, like test/_source-slice.js sliceBlock; throws if either is missing.
function sliceBetween(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`botBuilders: marker not found in index.js: ${JSON.stringify(start)}`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`botBuilders: end marker not found in index.js: ${JSON.stringify(end)}`);
  return src.slice(a, b + end.length);
}
// [start, end) — stops BEFORE `end`.
function sliceUntil(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`botBuilders: marker not found in index.js: ${JSON.stringify(start)}`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`botBuilders: end marker not found in index.js: ${JSON.stringify(end)}`);
  return src.slice(a, b);
}

// The blocks, in dependency order. Each is the exact text the bot runs.
function blocks(src) {
  return {
    // The pure helpers the lookup uses: class and sex names, the name keys, the case filter.
    mobHelpers: sliceBetween(src, 'const _MOB_CLASS_NAMES = {', 'return exact.length ? exact : rows;\n}'),
    // The 6 h faction map and _factionRowsFor, which _buildMobInfo calls.
    faction: sliceUntil(src, 'const _FACTION_VALUE_TTL_MS', 'async function _handleAgentFaction('),
    buildMobInfo: sliceBetween(src, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}'),
    mobPack: sliceUntil(src, 'const _MOB_PACK_TTL_MS', '// GET /api/agent/zone-spawns'),
    spellCatalog: sliceUntil(src, 'let _spellCatalogCache = null;', '// GET /api/agent/item-clickies'),
    itemClickies: sliceUntil(src, 'let _itemClickyCache    = null;', '// GET /api/agent/item-catalog'),
    itemCatalog: sliceUntil(src, 'const _ITEM_CATALOG_TTL_MS', '// GET /api/agent/mob-info?name=<npc>'),
  };
}

// `supabase` is the object every './utils/supabase' require inside those blocks resolves to — the read-only
// game-data one the build script hands in. isPopEraLocked comes from utils/config.js as in index.js.
function loadBotBuilders(supabase, opts = {}) {
  const src = opts.source != null ? opts.source : fs.readFileSync(INDEX, 'utf8');
  const b = blocks(src);
  const botRequire = (m) => {
    if (m === './utils/supabase') return supabase;
    return require(m.startsWith('./') ? path.join(ROOT, m.slice(2)) : m);
  };
  const config = require(path.join(ROOT, 'utils', 'config.js'));
  const names = [
    '_handleAgentSpellCatalog', '_handleAgentItemClickies', '_handleAgentItemCatalog',
    '_mobPackBuild', '_mobPacks', '_mobCaseKey', '_normMobName', '_MOB_PACK_VERSION',
  ];
  const body = [
    "const mobSpecials = require('./utils/mobSpecials');",
    "const npcProcs = require('./utils/npcProcs');",
    "const factionAssist = require('./utils/factionAssist');",
    "const namedBosses = require('./utils/namedBosses');",
    'const isPopEraLocked = __isPopEraLocked;',
    '// the handlers take sign-in from mimicLink; the public path (isPublic = true) never asks',
    'const mimicLink = { requireAgentAuth: async () => null };',
    b.mobHelpers, b.faction, b.buildMobInfo, b.mobPack,
    b.spellCatalog, b.itemClickies, b.itemCatalog,
    `return { ${names.join(', ')} };`,
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('require', 'console', 'process', '__isPopEraLocked', body)(
    botRequire, opts.console || console, process, opts.isPopEraLocked || config.isPopEraLocked);

  // The three catalog endpoints, run as the public route runs them (isPublic = true: no sign-in).
  // Resolves to the exact body string the bot would send, or throws with the status it would send.
  const serve = (handler) => async () => {
    const out = { status: null, body: null };
    const res = { writeHead: (s) => { out.status = s; }, end: (x) => { out.body = x; } };
    await handler({ headers: {} }, res, true);
    if (out.status !== 200 || typeof out.body !== 'string') {
      throw new Error(`${handler.name} answered ${out.status}: ${String(out.body).slice(0, 200)}`);
    }
    return out.body;
  };
  return {
    spellCatalog: serve(api._handleAgentSpellCatalog),
    itemClickies: serve(api._handleAgentItemClickies),
    itemCatalog: serve(api._handleAgentItemCatalog),
    // The body _handleAgentMobPack serves for a zone, or null where the bot would keep no pack
    // (a hollow build). The pack is taken straight out of the bot's in-memory store.
    zonePack: async (zoneId) => {
      api._mobPacks.delete(zoneId);
      await api._mobPackBuild(zoneId);
      const pack = api._mobPacks.get(zoneId);
      api._mobPacks.delete(zoneId);
      return pack ? pack.body : null;
    },
    mobCaseKey: api._mobCaseKey,
    mobPackVersion: api._MOB_PACK_VERSION,
  };
}

module.exports = { loadBotBuilders, blocks, sliceBetween, sliceUntil };
