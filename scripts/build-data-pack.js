#!/usr/bin/env node
'use strict';
// scripts/build-data-pack.js — the weekly game-data pack (DECISIONS 2026-10-21, "A — Data pack: a game-data
// file Mimic keeps on the PC, rebuilt weekly"). STEP 1 only: build it, check it, hand it to the workflow that
// publishes it. Nothing reads it yet.
//
// WHY. A standalone raider with no guild server, and a guild that hosts its own, both need the game database
// for Mob Info, item cards, spell timers, spawn maps, loot and quests. Wolf Pack's bot serves that today from
// the Supabase `eqemu_*` mirrors (about 80 MB). This writes the same data, in the SAME shapes Mimic already
// caches, as files:
//
//   manifest.json            { format, built_at, source{dump_sha,…}, files[{path,asset,bytes,sha256,rows,shape}], counts }
//   spell-catalog.json.gz    exactly GET /api/agent/spell-catalog
//   item-clickies.json.gz    exactly GET /api/agent/item-clickies
//   item-catalog.json.gz     exactly GET /api/agent/item-catalog
//   zones/<zone_id>.json.gz  exactly GET /api/agent/mob-pack?zone=<zone_id>, one per zone that has named NPCs
//   quests.json.gz           turn-ins + the quest-script mirror, compact; "format 1, not yet read by Mimic"
//
// "Exactly" is literal: scripts/lib/botBuilders.js runs the bot's own handlers and zone-pack builder out of
// index.js, so there is no second copy to drift. Read-only: the database handle it gets can only read game
// tables (see makeGameSupabase) and every write throws.
//
// GAME DATA ONLY. The zone-pack builder also reads three GUILD tables (`loot_observations` for Wolf Pack's win
// counts, `bosses_local` and `encounters` for the zone line). A pack for other guilds carries none of that:
// those reads are answered here without touching the tables — no win counts (`seen` stays 0), and the zone
// comes from the NPC's own id block (id = zone*1000 + n) through eqemu_zone.
//
// CHECKS (the part worth copying from PQ Companion, which fails its build on a mismatch). Any failure exits 1
// and the workflow publishes nothing:
//   · each catalog's rows == the server's own COUNT for its source (a paged read the 1,000-row cap clipped
//     cannot agree with a count the server made)
//   · zone packs == zones that have named NPCs, and every pack holds the mobs its zone's names call for
//   · every file is listed, exists, matches its sha256 and byte size, gunzips and parses, and its manifest
//     `rows` is what is really inside
//   · no read failed after retries (a failed read inside a builder is silent, so this counts them), and no
//     read touched a table outside the game-data list
//   · total size under the budget (60 MB compressed) — printed either way
//
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/build-data-pack.js [--out data-pack-out]
//          [--budget-mb 60] [--concurrency 4]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FORMAT = 1;
const BUDGET_BYTES = 60 * 1024 * 1024;
// Fraction of a build's mobs allowed to be missing from their zone pack (a name the lookup cannot resolve —
// PostgREST rejects an `or=(…)` filter on a name carrying a comma, for one). Over it, the pack is hollow.
const MAX_MISSING_MOB_FRACTION = 0.01;
const MAX_FAILED_READS = 25;

// ── What may be read ─────────────────────────────────────────────────────────
// Every `eqemu_*` mirror, plus the views and the quest table the catalogs are built from. Anything else is a
// guild table, and a read of one is recorded and fails the build.
const EXTRA_GAME_TABLES = new Set(['item_catalog_droppable', 'item_worn_damage_shield', 'scripted_npc_turnins']);
const isGameTable = (t) => /^eqemu_/.test(t) || EXTRA_GAME_TABLES.has(t);

const WRITE_METHODS = ['insert', 'insertIgnoreDuplicates', 'update', 'upsert', 'del', 'rpc'];

// A read-only handle over utils/supabase.js for the builders. It is what `require('./utils/supabase')`
// returns inside them (scripts/lib/botBuilders.js).
//   · game tables: passed through, retried on a failed read (3 tries, backing off), failures counted
//   · loot_observations / encounters: answered empty; bosses_local: answered from the NPC id's zone block
//   · bot_kv: the zone-pack builder reads and writes its cache there; reads miss, the write is dropped
//   · any other table: recorded in stats.blocked (the builders' own try/catch would swallow a throw)
//   · every other write throws
function makeGameSupabase(real, opts = {}) {
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retries = opts.retries != null ? opts.retries : 3;
  const zoneShortByNumber = opts.zoneShortByNumber || new Map();
  const stats = { reads: 0, failed: 0, failedSamples: [], blocked: new Set(), guildAnswered: 0 };

  async function withRetry(table, label, fn, isOk) {
    for (let attempt = 0; ; attempt++) {
      const out = await fn();
      if (isOk(out)) return out;
      if (attempt >= retries) {
        stats.failed++;
        if (stats.failedSamples.length < 10) stats.failedSamples.push(`${table} ${String(label).slice(0, 140)}`);
        return null;
      }
      await sleep(400 * 2 ** attempt);
    }
  }

  async function select(table, qs) {
    stats.reads++;
    if (table === 'bot_kv') return [];
    if (table === 'loot_observations' || table === 'encounters') { stats.guildAnswered++; return []; }
    if (table === 'bosses_local') {
      stats.guildAnswered++;
      const m = /(?:^|&)npc_id=eq\.(\d+)/.exec(String(qs));
      const short = m && zoneShortByNumber.get(Math.floor(Number(m[1]) / 1000));
      return short ? [{ zone_short: short }] : [];
    }
    if (!isGameTable(table)) { stats.blocked.add(table); return null; }
    return withRetry(table, qs, () => real.select(table, qs), Array.isArray);
  }

  const api = {
    isEnabled: () => real.isEnabled(),
    select,
    selectAllPaged: async (table, baseQuery, orderCol) => {
      if (!isGameTable(table)) { stats.blocked.add(table); return null; }
      // The shared pager does the paging; each page goes through select() above for the retries.
      return real.selectAllPaged(table, baseQuery, orderCol, (t, q) => select(t, q));
    },
    count: async (table, filter) => {
      if (!isGameTable(table)) { stats.blocked.add(table); return null; }
      return withRetry(table, `count ${filter || ''}`, () => real.count(table, filter), Number.isFinite);
    },
    stats,
  };
  for (const m of WRITE_METHODS) {
    api[m] = async (table) => {
      if (m === 'upsert' && table === 'bot_kv') return null;   // the zone-pack cache write: dropped
      throw new Error(`data-pack is read-only: ${m}(${table})`);
    };
  }
  return api;
}

// ── Files ────────────────────────────────────────────────────────────────────
const gz = (text) => zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// GitHub release assets have flat names: zones/215.json.gz is published as zone-215.json.gz.
const assetName = (p) => p.replace(/^zones\/(\d+)\.json\.gz$/, 'zone-$1.json.gz');

// How many records a parsed file holds — what the manifest's `rows` must say.
function rowsOf(file, parsed) {
  if (/^zones\//.test(file)) return Object.keys(parsed.mobs || {}).length;
  if (file === 'quests.json.gz') return ((parsed.turnins || {}).rows || []).length + ((parsed.scripts || {}).rows || []).length;
  return Array.isArray(parsed.entries) ? parsed.entries.length : -1;
}

const SHAPES = {
  'spell-catalog.json.gz': 'GET /api/agent/spell-catalog',
  'item-clickies.json.gz': 'GET /api/agent/item-clickies',
  'item-catalog.json.gz': 'GET /api/agent/item-catalog',
  'quests.json.gz': 'quests format 1 (not yet read by Mimic)',
};
const shapeOf = (p) => SHAPES[p] || (/^zones\//.test(p) ? 'GET /api/agent/mob-pack?zone=<id>' : 'unknown');

function writeGz(outDir, rel, text) {
  const full = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const buf = gz(text);
  fs.writeFileSync(full, buf);
  return { path: rel, asset: assetName(rel), bytes: buf.length, sha256: sha256(buf), rows: rowsOf(rel, JSON.parse(text)), shape: shapeOf(rel) };
}

// ── Quests ───────────────────────────────────────────────────────────────────
const TURNIN_COLS = ['id', 'zone_short', 'npc_name', 'npc_id', 'script_path', 'script_lang', 'inputs', 'outputs',
  'faction_changes', 'cash', 'exp_award', 'random_outputs'];
const SCRIPT_COLS = ['path', 'zone_short', 'npc_name', 'is_encounter', 'body'];
const TURNIN_FILTER = 'is_duplicate=eq.false';   // what the web item page reads

// scripted_npc_turnins (what an NPC takes and gives) + eqemu_quest_scripts (the mirrored Lua), as
// { columns, rows[] } tables: at ~10k records the repeated key names would be most of the file.
async function buildQuests(sb, builtAt) {
  const turn = await sb.selectAllPaged('scripted_npc_turnins', `select=${TURNIN_COLS.join(',')}&${TURNIN_FILTER}`, 'id');
  if (!Array.isArray(turn)) throw new Error('scripted_npc_turnins read failed');
  const scripts = await sb.selectAllPaged('eqemu_quest_scripts', `select=${SCRIPT_COLS.join(',')}`, 'path');
  if (!Array.isArray(scripts)) throw new Error('eqemu_quest_scripts read failed');
  const table = (cols, rows) => ({ columns: cols, rows: rows.map((r) => cols.map((c) => (r[c] === undefined ? null : r[c]))) });
  return JSON.stringify({
    format: 1,
    status: 'format 1, not yet read by Mimic',
    built_at: builtAt,
    // scripts[].body is upstream Lua (github.com/SecretsOTheP/quests, GPL-3.0); turnins are parsed from
    // github.com/ProjectEQ/projecteqquests.
    turnins: table(TURNIN_COLS, turn),
    scripts: table(SCRIPT_COLS, scripts),
  });
}

// ── Zones ────────────────────────────────────────────────────────────────────
// zone id → Set of the case keys the pack for that zone must hold. Same selection the bot's zone-pack build
// makes (ids zone*1000 .. zone*1000+999, names with a letter in them, one entry per _mobCaseKey).
function zonesFromNpcRows(rows, mobCaseKey) {
  const zones = new Map();
  for (const r of rows) {
    const zid = Math.floor(Number(r.id) / 1000);
    if (!(zid >= 1 && zid <= 999)) continue;           // the pack route refuses any other zone id
    const n = String((r && r.name) || '');
    if (!/[a-z]/i.test(n)) continue;                   // the "_" placeholder names
    if (!zones.has(zid)) zones.set(zid, new Set());
    zones.get(zid).add(mobCaseKey(n));
  }
  return zones;
}

async function runPool(items, size, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
}

// ── Checks ───────────────────────────────────────────────────────────────────
// Runs against the files on disk, the way a consumer will meet them. `expected`:
//   rows:  { 'spell-catalog.json.gz': <server COUNT>, … }   — only files with an independent count
//   zones: Map(zoneId → number of mobs its pack must hold)
// Returns { failures[], notes[], totalBytes }.
function checkPack(outDir, expected, opts = {}) {
  const budget = opts.budgetBytes != null ? opts.budgetBytes : BUDGET_BYTES;
  const maxMissing = opts.maxMissingMobFraction != null ? opts.maxMissingMobFraction : MAX_MISSING_MOB_FRACTION;
  const failures = [], notes = [];
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')); }
  catch (e) { return { failures: [`manifest.json unreadable: ${e.message}`], notes, totalBytes: 0 }; }
  if (manifest.format !== FORMAT) failures.push(`manifest format ${manifest.format}, expected ${FORMAT}`);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) failures.push('manifest lists no files');

  let totalBytes = 0;
  const seen = new Set();
  const zonePacks = new Map();
  for (const f of files) {
    seen.add(f.path);
    const full = path.join(outDir, f.path);
    let buf;
    try { buf = fs.readFileSync(full); } catch { failures.push(`${f.path}: listed in the manifest but missing on disk`); continue; }
    totalBytes += buf.length;
    if (buf.length !== f.bytes) failures.push(`${f.path}: ${buf.length} bytes on disk, manifest says ${f.bytes}`);
    if (sha256(buf) !== f.sha256) failures.push(`${f.path}: sha256 does not match the manifest`);
    let parsed;
    try { parsed = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); }
    catch (e) { failures.push(`${f.path}: does not gunzip and parse back (${e.message})`); continue; }
    const rows = rowsOf(f.path, parsed);
    if (rows !== f.rows) failures.push(`${f.path}: holds ${rows} rows, manifest says ${f.rows}`);
    if (expected.rows && expected.rows[f.path] != null && expected.rows[f.path] !== rows) {
      failures.push(`${f.path}: ${rows} rows vs ${expected.rows[f.path]} counted by Supabase`);
    }
    const zm = /^zones\/(\d+)\.json\.gz$/.exec(f.path);
    if (zm) {
      zonePacks.set(Number(zm[1]), parsed);
      if (parsed.zone_id !== Number(zm[1])) failures.push(`${f.path}: zone_id ${parsed.zone_id} inside`);
    }
  }
  for (const [p, n] of Object.entries(expected.rows || {})) {
    if (!seen.has(p)) failures.push(`${p}: expected (${n} rows) but not in the manifest`);
  }

  // Files on disk the manifest does not list would be published unchecked.
  const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
  for (const p of walk(outDir)) if (p !== 'manifest.json' && !seen.has(p)) failures.push(`${p}: on disk but not in the manifest`);

  // Zone packs against the zones that have NPCs.
  if (expected.zones) {
    const want = [...expected.zones.keys()];
    const missing = want.filter((z) => !zonePacks.has(z));
    const extra = [...zonePacks.keys()].filter((z) => !expected.zones.has(z));
    if (missing.length) failures.push(`zone packs missing for ${missing.length} zone(s): ${missing.slice(0, 20).join(', ')}`);
    if (extra.length) failures.push(`zone packs for zones with no NPCs: ${extra.slice(0, 20).join(', ')}`);
    let wantMobs = 0, gotMobs = 0;
    const thin = [];
    for (const [z, n] of expected.zones) {
      const pack = zonePacks.get(z);
      if (!pack) continue;                              // a missing pack is reported above, once
      const got = Object.keys(pack.mobs || {}).length;
      wantMobs += n;
      gotMobs += Math.min(got, n);
      if (got < n) thin.push(`${z}: ${got}/${n}`);
    }
    const missingMobs = wantMobs - gotMobs;
    notes.push(`zone packs ${zonePacks.size}/${want.length}, mobs ${gotMobs}/${wantMobs} (in the packs that exist)`);
    if (missingMobs > Math.max(0, Math.floor(wantMobs * maxMissing))) {
      failures.push(`${missingMobs} of ${wantMobs} mobs missing from their zone pack (over ${maxMissing * 100}%): ${thin.slice(0, 15).join(', ')}`);
    } else if (thin.length) {
      notes.push(`mobs missing (within ${maxMissing * 100}%): ${thin.slice(0, 15).join(', ')}`);
    }
  }

  notes.push(`total ${(totalBytes / 1048576).toFixed(2)} MB compressed in ${files.length} files (budget ${(budget / 1048576).toFixed(0)} MB)`);
  if (totalBytes > budget) failures.push(`pack is ${(totalBytes / 1048576).toFixed(2)} MB compressed, over the ${(budget / 1048576).toFixed(0)} MB budget`);
  return { failures, notes, totalBytes };
}

// ── The build ────────────────────────────────────────────────────────────────
function readSyncState() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sync_state.json'), 'utf8')); } catch { return {}; }
}

async function buildDataPack({ real, outDir, concurrency = 4, budgetBytes = BUDGET_BYTES, maxFailedReads = MAX_FAILED_READS,
  log = console.log, loadBuilders, sleep, syncState }) {
  const builtAt = new Date().toISOString();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // The zone table first: the zone-pack builder's guild-table reads are answered from it.
  const zoneShortByNumber = new Map();
  const pre = makeGameSupabase(real, { sleep });
  const zoneRows = await pre.selectAllPaged('eqemu_zone', 'select=zone_id,short_name', 'zone_id');
  if (!Array.isArray(zoneRows)) throw new Error('eqemu_zone read failed');
  for (const z of zoneRows) if (z.short_name) zoneShortByNumber.set(Number(z.zone_id), z.short_name);

  const sb = makeGameSupabase(real, { sleep, zoneShortByNumber });
  const builders = (loadBuilders || require('./lib/botBuilders').loadBotBuilders)(sb);
  const files = [];

  // 1. the three catalogs, as the bot serves them
  for (const [rel, make] of [['spell-catalog.json.gz', builders.spellCatalog], ['item-clickies.json.gz', builders.itemClickies], ['item-catalog.json.gz', builders.itemCatalog]]) {
    files.push(writeGz(outDir, rel, await make()));
    log(`[data-pack] ${rel}: ${files[files.length - 1].rows} rows, ${(files[files.length - 1].bytes / 1024).toFixed(0)} KB`);
  }

  // 2. a pack per zone that has named NPCs
  const npcRows = await sb.selectAllPaged('eqemu_npc_types', 'select=id,name', 'id');
  if (!Array.isArray(npcRows)) throw new Error('eqemu_npc_types read failed');
  const zones = zonesFromNpcRows(npcRows, builders.mobCaseKey);
  const zoneIds = [...zones.keys()].sort((a, b) => a - b);
  log(`[data-pack] ${zoneIds.length} zones with named NPCs (${npcRows.length} NPC rows)`);
  await runPool(zoneIds, concurrency, async (zid) => {
    let body = await builders.zonePack(zid);
    if (body == null) body = await builders.zonePack(zid);   // one more go before giving the zone up
    if (body == null) { log(`[data-pack] zone ${zid}: no pack built`); return; }
    files.push(writeGz(outDir, `zones/${zid}.json.gz`, body));
  });

  // 3. quests
  files.push(writeGz(outDir, 'quests.json.gz', await buildQuests(sb, builtAt)));
  log(`[data-pack] quests.json.gz: ${files[files.length - 1].rows} records, ${(files[files.length - 1].bytes / 1024).toFixed(0)} KB`);

  // 4. the server's own counts, to check against
  const counts = {};
  const ask = async (key, table, filter) => { counts[key] = await sb.count(table, filter); return counts[key]; };
  await ask('eqemu_spells', 'eqemu_spells');
  await ask('eqemu_items_with_click', 'eqemu_items', 'clickeffect=gt.0');
  await ask('item_catalog_droppable', 'item_catalog_droppable');
  await ask('item_worn_damage_shield', 'item_worn_damage_shield');
  await ask('scripted_npc_turnins', 'scripted_npc_turnins', TURNIN_FILTER);
  await ask('eqemu_quest_scripts', 'eqemu_quest_scripts');
  await ask('eqemu_npc_types', 'eqemu_npc_types');
  await ask('eqemu_zone', 'eqemu_zone');

  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const state = syncState || readSyncState();
  const manifest = {
    format: FORMAT,
    built_at: builtAt,
    source: { dump_sha: state.last_dump_sha || null, dump: state.last_dump || null, synced_at: state.last_run || null, server: 'quarm' },
    mob_pack_version: builders.mobPackVersion,
    files,
    counts: {
      ...counts,
      zone_packs: files.filter((f) => /^zones\//.test(f.path)).length,
      mobs: files.filter((f) => /^zones\//.test(f.path)).reduce((s, f) => s + f.rows, 0),
      reads: sb.stats.reads,
      failed_reads: sb.stats.failed,
      guild_reads_answered_without_reading: sb.stats.guildAnswered,
    },
    notices: [
      'Game data only: no guild or member tables were read. Wolf Pack drop counts are not included (loot[].seen is 0).',
      'quests.json.gz scripts[].body is upstream Lua from github.com/SecretsOTheP/quests (GPL-3.0).',
    ],
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const expectedRows = {
    'spell-catalog.json.gz': counts.eqemu_spells,
    'item-clickies.json.gz': counts.eqemu_items_with_click,
    'item-catalog.json.gz': counts.item_catalog_droppable,
    'quests.json.gz': counts.scripted_npc_turnins == null || counts.eqemu_quest_scripts == null ? null : counts.scripted_npc_turnins + counts.eqemu_quest_scripts,
  };
  for (const k of Object.keys(expectedRows)) if (expectedRows[k] == null) delete expectedRows[k];
  const expectedZones = new Map([...zones].map(([z, set]) => [z, set.size]));
  const result = checkPack(outDir, { rows: expectedRows, zones: expectedZones }, { budgetBytes });

  // The checks above see only what a builder returned. These see what it could not read.
  for (const [k, v] of Object.entries(counts)) if (v == null) result.failures.push(`Supabase count for ${k} failed`);
  if (counts.eqemu_npc_types != null && counts.eqemu_npc_types !== npcRows.length) {
    result.failures.push(`read ${npcRows.length} eqemu_npc_types rows, Supabase counts ${counts.eqemu_npc_types}`);
  }
  if (sb.stats.blocked.size) result.failures.push(`read a non-game table: ${[...sb.stats.blocked].join(', ')}`);
  if (sb.stats.failed > maxFailedReads) {
    result.failures.push(`${sb.stats.failed} reads failed after retries (limit ${maxFailedReads}): ${sb.stats.failedSamples.join(' | ')}`);
  } else if (sb.stats.failed) {
    result.notes.push(`${sb.stats.failed} read(s) failed after retries (within ${maxFailedReads}): ${sb.stats.failedSamples.join(' | ')}`);
  }
  return { manifest, ...result };
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  // A catalog page can be 2 MB and the quest scripts 12 MB over ~13 pages; the bot's 10 s default is for
  // live lookups. The breaker is for protecting a live process, not a batch job that retries itself.
  if (!process.env.SUPABASE_REQUEST_TIMEOUT_MS) process.env.SUPABASE_REQUEST_TIMEOUT_MS = '60000';
  if (!process.env.SUPABASE_BREAKER_THRESHOLD) process.env.SUPABASE_BREAKER_THRESHOLD = '1000000';
  const real = require('../utils/supabase');
  if (!real.isEnabled()) {
    console.error('::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }
  const outDir = path.resolve(arg('out', 'data-pack-out'));
  const budgetBytes = Math.round(Number(arg('budget-mb', '60')) * 1024 * 1024);
  const started = Date.now();
  const r = await buildDataPack({ real, outDir, concurrency: Number(arg('concurrency', '4')), budgetBytes });
  for (const n of r.notes) console.log(`[data-pack] ${n}`);
  console.log(`[data-pack] built in ${Math.round((Date.now() - started) / 1000)}s → ${outDir}`);
  if (r.failures.length) {
    for (const f of r.failures) console.error(`::error::data-pack check failed: ${f}`);
    console.error(`[data-pack] ${r.failures.length} check(s) failed — nothing to publish`);
    process.exit(1);
  }
  console.log('[data-pack] all checks passed');
}

module.exports = {
  FORMAT, BUDGET_BYTES, MAX_MISSING_MOB_FRACTION, MAX_FAILED_READS,
  isGameTable, makeGameSupabase, assetName, rowsOf, checkPack, buildQuests, zonesFromNpcRows, buildDataPack, writeGz, sha256,
};

if (require.main === module) {
  main().catch((e) => { console.error(`::error::data-pack build crashed: ${e && e.stack || e}`); process.exit(1); });
}
