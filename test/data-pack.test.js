// test/data-pack.test.js — the weekly game-data pack (scripts/build-data-pack.js).
//
// The guild lead, 2026-10-21: "A — Data pack: a game-data file Mimic keeps on the PC, rebuilt weekly."
// Step 1 builds and publishes the pack; Mimic reads it later. What has to hold on day one:
//   1. the pack is the bot's own answer — the catalogs and zone packs come out of the SAME handlers and
//      builder index.js runs (scripts/lib/botBuilders.js), run here against a fixture database whose
//      tables are larger than PostgREST's 1,000-row cap;
//   2. it is GAME DATA ONLY: no guild table is read, nothing is written, and the one place the live builder
//      would put Wolf Pack's numbers (loot[].seen, the zone line) comes out guild-free;
//   3. the checks fail the build — on a row count that disagrees with the server's own COUNT, a wrong sha256,
//      a file that will not parse back, a missing zone pack, thin zone packs, a stray file, an over-budget size;
//   4. the read-only handle blocks what it should and retries what it can.
//
// Run: npx vitest run test/data-pack.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';
import { installFakePostgrest, SERVER_MAX_ROWS } from './_fake-fetch-postgrest.js';

const nodeRequire = createRequire(import.meta.url);
const real = nodeRequire('../utils/supabase.js');
const factionAssist = nodeRequire('../utils/factionAssist.js');
const pack = nodeRequire('../scripts/build-data-pack.js');
const { loadBotBuilders, sliceBetween } = nodeRequire('../scripts/lib/botBuilders.js');

// ── The fixture database ("a tiny Quarm") ────────────────────────────────────
const SPELLS = 1100, CLICKIES = 1200, DROPPABLE = 1050;   // each past the 1,000-row cap
const GUILD_ZONE = 'GUILD_ZONE_SECRET';

const spellRow = (i) => ({
  id: i, name: `Spell ${i}`, cast_on_you: 'x', cast_on_other: 'y', spell_fades: 'z', buffduration: 0, buffdurationformula: 0,
  cast_time: 2000, good_effect: 0, mana: 10, recast_time: 0, resist_type: 0, targettype: 5,
  effect_id_1: 254, effect_base_value_1: 0, effect_id_2: 254, effect_base_value_2: 0, effect_id_3: 254, effect_base_value_3: 0, raw: null,
});
const npc = (id, name, extra = {}) => ({
  id, name, class: 12, level: 60, maxlevel: 60, hp: 5000, mana: 0, ac: 10, mr: 0, fr: 0, cr: 0, pr: 0, dr: 0,
  mindmg: 1, maxdmg: 2, runspeed: 1.25, npcspecialattks: '', special_abilities: '', raid_target: false, bodytype: 1,
  npc_spells_id: 0, npc_faction_id: 0, see_invis: false, see_invis_undead: false, see_hide: false, see_improved_hide: false,
  race: 1, size: 6, gender: 0, ...extra,
});

function fixtureTables() {
  return {
    eqemu_zone: [
      { zone_id: 215, short_name: 'poair', long_name: 'Plane of Air' },
      { zone_id: 160, short_name: 'mistmoore', long_name: 'Castle Mistmoore' },
      { zone_id: 77, short_name: 'emptyzone', long_name: 'Nothing Here' },
    ],
    eqemu_npc_types: [
      npc(215001, 'a_test_guard'), npc(215002, 'Advocent_Joran'), npc(215003, '_'), npc(215004, 'a_Test_guard'),
      npc(160001, '#Boss_Of_Doom'), npc(160002, 'a_bat'),
      npc(77001, '_'),                        // a zone with only placeholder names: no pack
      npc(1000005, 'out_of_range_zone'),      // zone id 1000: the pack route refuses it
    ],
    eqemu_spells: Array.from({ length: SPELLS }, (_, i) => spellRow(i + 1)),
    eqemu_npc_spells_entries: [{ npc_spells_id: 1, spellid: 5, minlevel: 1 }],
    eqemu_items: Array.from({ length: CLICKIES + 300 }, (_, i) => ({
      id: i + 1, name: `Item ${i + 1}`, casttime: 1000, clicktype: 1, clicklevel: 1, maxcharges: -1,
      clickeffect: i < CLICKIES ? 1000 + i : -1,          // 300 items with no click: not in the catalog
    })),
    item_catalog_droppable: Array.from({ length: DROPPABLE }, (_, i) => ({ item_id: 100 + i, item_name: `Drop ${i}`, era: i % 3 })),
    item_worn_damage_shield: [{ item_id: 8364, item_name: 'Talisman of Nothing', ds: 8 }],
    scripted_npc_turnins: [
      { id: 1, zone_short: 'poair', npc_name: 'Advocent Joran', npc_id: 215002, script_path: 'poair/Advocent_Joran.lua', script_lang: 'lua',
        inputs: [{ item_id: 1, qty: 1 }], outputs: [{ item_id: 2, kind: 'fixed' }], faction_changes: null, cash: null, exp_award: null,
        random_outputs: false, raw_snippet: 'RAW SNIPPET NOT SHIPPED', is_duplicate: false },
      { id: 2, zone_short: 'poair', npc_name: 'Advocent Joran', npc_id: 215002, script_path: 'poair/Advocent_Joran.lua', script_lang: 'lua',
        inputs: [{ item_id: 1, qty: 1 }], outputs: [], faction_changes: null, cash: null, exp_award: null,
        random_outputs: false, raw_snippet: 'dup', is_duplicate: true },
    ],
    eqemu_quest_scripts: [
      { path: 'poair/Advocent_Joran.lua', zone_short: 'poair', npc_name: 'Advocent Joran', is_encounter: false, body: 'function event_say(e) end', bytes: 26, sha: 'x', synced_at: 'now' },
      { path: 'poair/encounters/Boss.lua', zone_short: 'poair', npc_name: 'Boss', is_encounter: true, body: 'return 1', bytes: 8, sha: 'y', synced_at: 'now' },
    ],
    eqemu_npc_drops: [{ npc_id: 215002, item_id: 1, item_name: 'Sword of Tests', effective_chance: 12.5, drop_chance: 50, lore_flag: false }],
    eqemu_item_drop_owner: [{ item_id: 1, npc_count: 1 }],
    eqemu_npc_spells: [], eqemu_faction_list_full: [], eqemu_npc_faction: [], eqemu_npc_faction_entries: [],
    // GUILD tables. The pack must never read them — the fake counts every request.
    loot_observations: Array.from({ length: 5 }, () => ({ guild_id: 'wolfpack', source: 'opendkp', item_id: 1, item_name: 'Sword of Tests' })),
    bosses_local: [{ npc_id: 215002, zone_short: GUILD_ZONE }],
    encounters: [{ npc_id: 215002, zone_short: GUILD_ZONE, ended_at: '2026-10-01T00:00:00Z' }],
    bot_kv: [], wolfpack_members: [{ discord_id: 'secret' }],
  };
}

let fake, tmpDirs;
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'data-pack-')); tmpDirs.push(d); return d; };
const noSleep = async () => {};
const gunzipJson = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));

beforeEach(() => {
  tmpDirs = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  real._resetBreaker(); real._resetCapStats(); factionAssist._resetCache();
});
afterEach(() => {
  fake && fake.restore(); fake = null;
  vi.restoreAllMocks();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

async function build(tables = fixtureTables(), over = {}) {
  if (fake) fake.restore();
  fake = installFakePostgrest({ tables });
  const outDir = over.outDir || tmp();
  const result = await pack.buildDataPack({
    real, outDir, concurrency: 2, log: () => {}, sleep: noSleep,
    syncState: { last_dump_sha: 'abc123', last_dump: 'quarm_test.tar.gz', last_run: '2026-10-18T06:00:00Z' }, ...over,
  });
  return { outDir, ...result };
}

// ── 1. the build, end to end ─────────────────────────────────────────────────
describe('the pack is built from the bot\'s own handlers, against tables past the row cap', () => {
  it('passes its own checks and lists every file with size, sha256 and rows', async () => {
    const r = await build();
    expect(r.failures).toEqual([]);
    const m = JSON.parse(fs.readFileSync(path.join(r.outDir, 'manifest.json'), 'utf8'));
    expect(m.format).toBe(1);
    expect(m.source).toEqual({ dump_sha: 'abc123', dump: 'quarm_test.tar.gz', synced_at: '2026-10-18T06:00:00Z', server: 'quarm' });
    expect(typeof m.built_at).toBe('string');
    expect(m.files.map(f => f.path)).toEqual([
      'item-catalog.json.gz', 'item-clickies.json.gz', 'quests.json.gz', 'spell-catalog.json.gz', 'zones/160.json.gz', 'zones/215.json.gz',
    ]);
    for (const f of m.files) {
      const buf = fs.readFileSync(path.join(r.outDir, f.path));
      expect(f.bytes).toBe(buf.length);
      expect(f.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
      expect(f.rows).toBeGreaterThan(0);
    }
    expect(m.files.find(f => f.path === 'zones/215.json.gz').asset).toBe('zone-215.json.gz');
    expect(m.files.find(f => f.path === 'spell-catalog.json.gz').asset).toBe('spell-catalog.json.gz');
    // counts come from the server's COUNT, one per source
    expect(m.counts).toMatchObject({
      eqemu_spells: SPELLS, eqemu_items_with_click: CLICKIES, item_catalog_droppable: DROPPABLE,
      scripted_npc_turnins: 1, eqemu_quest_scripts: 2, zone_packs: 2, failed_reads: 0,
    });
    expect(r.notes.join('\n')).toMatch(/total \d+\.\d+ MB compressed in 6 files \(budget 60 MB\)/);
  });

  it('serves every row of a table larger than the 1,000-row cap, in the shapes Mimic caches', async () => {
    expect(SPELLS).toBeGreaterThan(SERVER_MAX_ROWS);
    const r = await build();
    const spells = gunzipJson(path.join(r.outDir, 'spell-catalog.json.gz'));
    expect(spells.version).toBe(9);
    expect(spells.count).toBe(SPELLS);
    expect(new Set(spells.entries.map(e => e.id)).size).toBe(SPELLS);
    const clickies = gunzipJson(path.join(r.outDir, 'item-clickies.json.gz'));
    expect(clickies.count).toBe(CLICKIES);
    expect(clickies.entries.every(e => e.clickeffect > 0)).toBe(true);
    expect(clickies.worn_ds).toEqual([{ id: 8364, name: 'Talisman of Nothing', ds: 8 }]);
    const items = gunzipJson(path.join(r.outDir, 'item-catalog.json.gz'));
    expect(items.count).toBe(DROPPABLE);
    expect(items.entries[0]).toEqual([100, 'Drop 0', 0]);       // array rows, as the endpoint sends them
  });

  it('writes a zone pack per zone with named NPCs, in the mob-pack body shape', async () => {
    const r = await build();
    // 77 has only a placeholder name, and id 1000005 is zone 1000, past the route's 1..999
    expect(fs.existsSync(path.join(r.outDir, 'zones', '77.json.gz'))).toBe(false);
    expect(fs.existsSync(path.join(r.outDir, 'zones', '1000.json.gz'))).toBe(false);
    const z = gunzipJson(path.join(r.outDir, 'zones', '215.json.gz'));
    expect(Object.keys(z).sort()).toEqual(['built_at', 'mobs', 'ok', 'zone_id']);
    expect(z.ok).toBe(true);
    expect(z.zone_id).toBe(215);
    // a_test_guard and a_Test_guard are two mobs (case after the first letter is real); the "_" row is skipped
    // Keys are the case keys the bot's pack uses: the first letter folded, the rest exact.
    expect(Object.keys(z.mobs).sort()).toEqual(['a_Test_guard', 'a_test_guard', 'advocent_Joran']);
    expect(z.mobs.advocent_Joran).toMatchObject({ id: 215002, name: 'Advocent Joran', class: 'Wizard', level: 60 });
    expect(gunzipJson(path.join(r.outDir, 'zones', '160.json.gz')).mobs.boss_Of_Doom.id).toBe(160001);
  });

  it('ships quests as compact tables, marked not yet read by Mimic, without the raw snippets or duplicates', async () => {
    const r = await build();
    const q = gunzipJson(path.join(r.outDir, 'quests.json.gz'));
    expect(q.format).toBe(1);
    expect(q.status).toBe('format 1, not yet read by Mimic');
    expect(q.turnins.rows).toHaveLength(1);                      // the is_duplicate row is not shipped
    expect(q.turnins.columns).not.toContain('raw_snippet');
    expect(JSON.stringify(q)).not.toMatch(/RAW SNIPPET/);
    expect(q.turnins.rows[0][q.turnins.columns.indexOf('npc_id')]).toBe(215002);
    expect(q.scripts.columns).toEqual(['path', 'zone_short', 'npc_name', 'is_encounter', 'body']);
    expect(q.scripts.rows.map(x => x[0])).toEqual(['poair/Advocent_Joran.lua', 'poair/encounters/Boss.lua']);
  });
});

// ── 2. game data only ────────────────────────────────────────────────────────
describe('no guild data goes in, and nothing is written', () => {
  it('never reads a guild table and never writes', async () => {
    await build();
    const touched = new Set(fake.calls.map(c => c.table));
    for (const t of ['loot_observations', 'bosses_local', 'encounters', 'bot_kv', 'wolfpack_members']) {
      expect(touched.has(t), `the build requested ${t}`).toBe(false);
    }
    expect(fake.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect([...touched].every(pack.isGameTable)).toBe(true);
  });

  it('leaves Wolf Pack\'s win counts at 0 and takes the zone from the NPC\'s own id block, not the kill history', async () => {
    const r = await build();
    const joran = gunzipJson(path.join(r.outDir, 'zones', '215.json.gz')).mobs.advocent_Joran;
    expect(joran.loot).toHaveLength(1);
    expect(joran.loot[0]).toMatchObject({ id: 1, name: 'Sword of Tests', pct: 12.5, seen: 0 });
    expect(joran.zone_short).toBe('poair');
    expect(joran.zone).toBe('Plane of Air');
    expect(JSON.stringify(fs.readdirSync(r.outDir).map(f => f))).not.toMatch(GUILD_ZONE);
    for (const f of ['spell-catalog', 'item-clickies', 'item-catalog', 'quests']) {
      expect(zlib.gunzipSync(fs.readFileSync(path.join(r.outDir, `${f}.json.gz`))).toString()).not.toMatch(GUILD_ZONE);
    }
  });

  it('the manifest says so, and carries the script licence', async () => {
    const r = await build();
    expect(r.manifest.notices.join(' ')).toMatch(/Game data only/);
    expect(r.manifest.notices.join(' ')).toMatch(/GPL-3\.0/);
    expect(r.manifest.counts.guild_reads_answered_without_reading).toBeGreaterThan(0);
  });
});

// ── 3. the checks fail the build ─────────────────────────────────────────────
describe('checkPack', () => {
  let good, expected;
  beforeEach(async () => {
    good = (await build()).outDir;
    expected = {
      rows: { 'spell-catalog.json.gz': SPELLS, 'item-clickies.json.gz': CLICKIES, 'item-catalog.json.gz': DROPPABLE, 'quests.json.gz': 3 },
      zones: new Map([[215, 3], [160, 2]]),
    };
  });
  const copy = () => { const d = tmp(); fs.cpSync(good, d, { recursive: true }); return d; };
  const manifestOf = (d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  const saveManifest = (d, m) => fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
  // rewrite a file AND keep the manifest honest about it, so only the check under test can object
  const rewrite = (d, rel, fn) => {
    const full = path.join(d, rel);
    const obj = fn(gunzipJson(full));
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
    fs.writeFileSync(full, buf);
    const m = manifestOf(d);
    const f = m.files.find(x => x.path === rel);
    f.bytes = buf.length; f.sha256 = crypto.createHash('sha256').update(buf).digest('hex'); f.rows = pack.rowsOf(rel, obj);
    saveManifest(d, m);
  };

  it('a clean pack passes', () => {
    expect(pack.checkPack(good, expected).failures).toEqual([]);
  });

  it('fails when a catalog\'s rows differ from the server\'s own count', () => {
    const f = pack.checkPack(good, { ...expected, rows: { ...expected.rows, 'spell-catalog.json.gz': SPELLS + 1 } }).failures;
    expect(f).toEqual([`spell-catalog.json.gz: ${SPELLS} rows vs ${SPELLS + 1} counted by Supabase`]);
  });

  it('fails when the paged read came back short of the count (a clipped read cannot agree with itself)', () => {
    const d = copy();
    rewrite(d, 'item-catalog.json.gz', (o) => ({ ...o, entries: o.entries.slice(0, 1000), count: 1000 }));
    const f = pack.checkPack(d, expected).failures;
    expect(f).toEqual([`item-catalog.json.gz: 1000 rows vs ${DROPPABLE} counted by Supabase`]);
  });

  it('fails on a wrong sha256', () => {
    const d = copy();
    const m = manifestOf(d);
    m.files[0].sha256 = '0'.repeat(64);
    saveManifest(d, m);
    expect(pack.checkPack(d, expected).failures).toEqual([`${m.files[0].path}: sha256 does not match the manifest`]);
  });

  it('fails on a wrong size, and on a file that does not gunzip and parse back', () => {
    const d = copy();
    fs.writeFileSync(path.join(d, 'quests.json.gz'), Buffer.from('not gzip'));
    const f = pack.checkPack(d, expected).failures.join('\n');
    expect(f).toMatch(/quests\.json\.gz: \d+ bytes on disk, manifest says \d+/);
    expect(f).toMatch(/quests\.json\.gz: sha256 does not match/);
    expect(f).toMatch(/quests\.json\.gz: does not gunzip and parse back/);
    const d2 = copy();
    const buf = zlib.gzipSync(Buffer.from('{"entries": [oops'));
    fs.writeFileSync(path.join(d2, 'item-clickies.json.gz'), buf);
    const m = manifestOf(d2);
    const e = m.files.find(x => x.path === 'item-clickies.json.gz');
    e.bytes = buf.length; e.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    saveManifest(d2, m);
    expect(pack.checkPack(d2, expected).failures.join('\n')).toMatch(/item-clickies\.json\.gz: does not gunzip and parse back/);
  });

  it('fails when the manifest\'s rows are not what is inside', () => {
    const d = copy();
    const m = manifestOf(d);
    m.files.find(x => x.path === 'zones/215.json.gz').rows = 99;
    saveManifest(d, m);
    expect(pack.checkPack(d, expected).failures).toEqual(['zones/215.json.gz: holds 3 rows, manifest says 99']);
  });

  it('fails over budget, and says the size either way', () => {
    const over = pack.checkPack(good, expected, { budgetBytes: 1000 });
    expect(over.failures.join('\n')).toMatch(/pack is \d+\.\d+ MB compressed, over the 0 MB budget/);
    const ok = pack.checkPack(good, expected);
    expect(ok.notes.join('\n')).toMatch(/total \d+\.\d+ MB compressed/);
    expect(ok.totalBytes).toBeGreaterThan(0);
  });

  it('fails on a missing zone pack, and on a pack for a zone with no NPCs', () => {
    const d = copy();
    fs.rmSync(path.join(d, 'zones', '160.json.gz'));
    const m = manifestOf(d);
    m.files = m.files.filter(x => x.path !== 'zones/160.json.gz');
    saveManifest(d, m);
    expect(pack.checkPack(d, expected).failures).toEqual(['zone packs missing for 1 zone(s): 160']);
    const extra = pack.checkPack(good, { ...expected, zones: new Map([[215, 3]]) }).failures;
    expect(extra).toEqual(['zone packs for zones with no NPCs: 160']);
  });

  it('fails when a zone pack is thin (mobs the zone has are not in it)', () => {
    const d = copy();
    rewrite(d, 'zones/215.json.gz', (o) => ({ ...o, mobs: { advocent_Joran: o.mobs.advocent_Joran } }));
    const f = pack.checkPack(d, expected).failures.join('\n');
    expect(f).toMatch(/2 of 5 mobs missing from their zone pack \(over 1%\): 215: 1\/3/);
  });

  it('tolerates a mob or two in a big enough build, and says so', () => {
    const d = copy();
    rewrite(d, 'zones/215.json.gz', (o) => ({ ...o, mobs: { advocent_Joran: o.mobs.advocent_Joran, a_test_guard: o.mobs.a_test_guard } }));
    const r = pack.checkPack(d, expected, { maxMissingMobFraction: 0.5 });
    expect(r.failures).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/mobs missing \(within 50%\): 215: 2\/3/);
  });

  it('fails on a file on disk the manifest does not list', () => {
    const d = copy();
    fs.writeFileSync(path.join(d, 'zones', '999.json.gz'), zlib.gzipSync('{}'));
    expect(pack.checkPack(d, expected).failures).toEqual(['zones/999.json.gz: on disk but not in the manifest']);
  });

  it('fails on a manifest that is missing or the wrong format', () => {
    const d = copy();
    const m = manifestOf(d);
    m.format = 2;
    saveManifest(d, m);
    expect(pack.checkPack(d, expected).failures).toEqual(['manifest format 2, expected 1']);
    fs.rmSync(path.join(d, 'manifest.json'));
    expect(pack.checkPack(d, expected).failures[0]).toMatch(/manifest\.json unreadable/);
  });
});

describe('buildDataPack turns a failed read into a failed build', () => {
  it('fails when the server cannot count a table, rather than passing on nothing to compare', async () => {
    const tables = fixtureTables();
    fake = installFakePostgrest({ tables, failWhen: ({ query }) => /limit=1$/.test(query) && !/offset/.test(query) && !/select=/.test(query) });
    const r = await pack.buildDataPack({ real, outDir: tmp(), concurrency: 2, log: () => {}, sleep: noSleep, syncState: {} });
    expect(r.failures.filter(f => /^Supabase count for/.test(f)).length).toBeGreaterThan(0);
  });

  it('fails when a table the builders need cannot be read at all', async () => {
    const tables = fixtureTables();
    delete tables.eqemu_npc_drops;                                // every mob\'s loot read now fails (404)
    const r = await build(tables, { maxFailedReads: 2 });          // five mobs, one failed read each
    expect(r.manifest.counts.failed_reads).toBe(5);
    expect(r.failures.join('\n')).toMatch(/5 reads failed after retries \(limit 2\): eqemu_npc_drops npc_id=eq\./);
    // under the limit the build still passes, with a note saying what was lost
    const lenient = await build(tables, { maxFailedReads: 10 });
    expect(lenient.failures).toEqual([]);
    expect(lenient.notes.join('\n')).toMatch(/5 read\(s\) failed after retries \(within 10\)/);
  });
});

// ── 4. the read-only handle ──────────────────────────────────────────────────
describe('makeGameSupabase', () => {
  const stub = (over = {}) => ({
    isEnabled: () => true, select: vi.fn(async () => []), selectAllPaged: vi.fn(async () => []), count: vi.fn(async () => 5), ...over,
  });

  it('passes game tables through and refuses every other table, recording the attempt', async () => {
    const r = stub();
    const sb = pack.makeGameSupabase(r, { sleep: noSleep });
    await sb.select('eqemu_spells', 'select=id');
    await sb.select('item_catalog_droppable', 'select=item_id');
    expect(r.select).toHaveBeenCalledTimes(2);
    expect(await sb.select('wolfpack_members', 'select=*')).toBeNull();
    expect(await sb.selectAllPaged('characters', 'select=*', 'id')).toBeNull();
    expect(await sb.count('raid_nights')).toBeNull();
    expect([...sb.stats.blocked].sort()).toEqual(['characters', 'raid_nights', 'wolfpack_members']);
    expect(r.select).toHaveBeenCalledTimes(2);                  // the blocked ones never reached the database
  });

  it('answers the guild tables the live builder reads without reading them', async () => {
    const r = stub();
    const sb = pack.makeGameSupabase(r, { sleep: noSleep, zoneShortByNumber: new Map([[215, 'poair']]) });
    expect(await sb.select('loot_observations', 'guild_id=eq.wolfpack&select=item_id')).toEqual([]);
    expect(await sb.select('encounters', 'npc_id=eq.215002&select=zone_short')).toEqual([]);
    expect(await sb.select('bosses_local', 'npc_id=eq.215002&select=zone_short&limit=1')).toEqual([{ zone_short: 'poair' }]);
    expect(await sb.select('bosses_local', 'npc_id=eq.999001&select=zone_short&limit=1')).toEqual([]);
    expect(r.select).not.toHaveBeenCalled();
  });

  it('throws on every write, except dropping the zone-pack cache write', async () => {
    const sb = pack.makeGameSupabase(stub(), { sleep: noSleep });
    for (const m of ['insert', 'insertIgnoreDuplicates', 'update', 'upsert', 'del', 'rpc']) {
      await expect(sb[m]('eqemu_spells', [])).rejects.toThrow(/read-only/);
    }
    await expect(sb.upsert('bot_kv', [{ key: 'mob_pack:1' }], 'guild_id,key')).resolves.toBeNull();
    expect(await sb.select('bot_kv', 'key=eq.mob_pack:1')).toEqual([]);
  });

  it('retries a failed read with backoff and succeeds when the server comes back', async () => {
    const waits = [];
    let n = 0;
    const r = stub({ select: vi.fn(async () => (++n < 3 ? null : [{ id: 1 }])) });
    const sb = pack.makeGameSupabase(r, { sleep: async (ms) => { waits.push(ms); } });
    expect(await sb.select('eqemu_spells', 'select=id')).toEqual([{ id: 1 }]);
    expect(waits).toEqual([400, 800]);
    expect(sb.stats.failed).toBe(0);
  });

  it('counts a read that still fails after its retries, and keeps a sample of it', async () => {
    const r = stub({ select: vi.fn(async () => null) });
    const sb = pack.makeGameSupabase(r, { sleep: noSleep });
    expect(await sb.select('eqemu_npc_drops', 'npc_id=eq.7')).toBeNull();
    expect(r.select).toHaveBeenCalledTimes(4);                  // the first try and three more
    expect(sb.stats.failed).toBe(1);
    expect(sb.stats.failedSamples).toEqual(['eqemu_npc_drops npc_id=eq.7']);
  });

  it('pages through the shared pager, each page through the retrying read', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    let calls = 0;
    const r = stub({
      select: vi.fn(async () => (++calls === 1 ? null : page.slice(0, 5))),   // first page fails once, then answers short
      selectAllPaged: real.selectAllPaged,
    });
    const sb = pack.makeGameSupabase(r, { sleep: noSleep });
    expect(await sb.selectAllPaged('eqemu_zone', 'select=id', 'id')).toHaveLength(5);
    expect(sb.stats.failed).toBe(0);
  });
});

// ── 4b. utils/supabase.js count() ────────────────────────────────────────────
describe('supabase.count', () => {
  it('asks the server for the exact total, past the 1,000-row cap, under a filter', async () => {
    fake = installFakePostgrest({ tables: { t: Array.from({ length: 2500 }, (_, i) => ({ id: i, big: i >= 1200 })) } });
    expect(await real.count('t')).toBe(2500);
    expect(await real.count('t', 'big=eq.true')).toBe(1300);
    expect(await real.count('t', 'big=eq.true&select=id&order=id.desc&limit=5&offset=9')).toBe(1300);   // paging params are dropped
    expect(await real.count('t', 'id=gt.99999')).toBe(0);                                                // "*/0" is zero, not a failure
    const q = fake.calls.map(c => c.query);
    expect(q[0]).toBe('limit=1');
    expect(q[2]).toBe('big=eq.true&limit=1');
  });

  it('is null when the request fails, and null for a table that does not exist', async () => {
    fake = installFakePostgrest({ tables: { t: [{ id: 1 }] } });
    expect(await real.count('nope')).toBeNull();
    fake.failWhen = () => true;
    expect(await real.count('t')).toBeNull();
  });
});

// ── 5. it is the endpoint's code ─────────────────────────────────────────────
describe('botBuilders runs what index.js runs', () => {
  const SRC = readSource(BOT_INDEX);

  it('the spell catalog is byte-identical to the handler evaluated on its own (fetched_at aside)', async () => {
    fake = installFakePostgrest({ tables: fixtureTables() });
    const mine = JSON.parse(await loadBotBuilders(real).spellCatalog());
    const block = sliceBlock(SRC, 'let _spellCatalogCache = null;', '// GET /api/agent/item-clickies');
    // eslint-disable-next-line no-new-func
    const handler = new Function('require', 'isPopEraLocked', 'mimicLink', `${block}\nreturn _handleAgentSpellCatalog;`)(
      (m) => nodeRequire(m.startsWith('./') ? '../' + m.slice(2) : m), () => false, {});
    const out = {};
    await handler({ headers: {} }, { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b; } }, true);
    expect(out.status).toBe(200);
    expect({ ...mine, fetched_at: 0 }).toEqual({ ...JSON.parse(out.body), fetched_at: 0 });
    expect(mine.count).toBe(SPELLS);
  });

  it('the public catalog route still dispatches the same three handlers the pack runs', () => {
    expect(SRC).toMatch(/which === 'spell-catalog' \? _handleAgentSpellCatalog/);
    expect(SRC).toMatch(/which === 'item-clickies' \? _handleAgentItemClickies/);
    expect(SRC).toMatch(/which === 'item-catalog' \? _handleAgentItemCatalog : null/);
    expect(SRC).toMatch(/req\.url\.startsWith\('\/api\/agent\/mob-pack'\)/);
  });

  it('a moved or renamed marker fails the load loudly, naming it', () => {
    const broken = SRC.replace('async function _buildMobInfo(supabase, {', 'async function _lookupMob(supabase, {');
    expect(() => loadBotBuilders(real, { source: broken })).toThrow(/marker not found in index\.js: "async function _buildMobInfo\(supabase, \{"/);
    expect(() => sliceBetween('abc', 'a', 'zz')).toThrow(/end marker not found/);
  });

  it('a build with a failing handler stops with the status the bot would have sent', async () => {
    const tables = fixtureTables();
    delete tables.eqemu_spells;                                   // the table 404s: the handler answers 500
    fake = installFakePostgrest({ tables });
    await expect(loadBotBuilders(real).spellCatalog()).rejects.toThrow(/_handleAgentSpellCatalog answered 500/);
  });
});
