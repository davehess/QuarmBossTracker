// test/cap-safe-reads.test.js — catalogs, scans and pagers read COMPLETE data.
//
// The guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100 caps."
// PostgREST answers at most 1,000 rows per response, silently, so a read with no pager (or
// `limit=10000`, which does not lift the cap) returns the first 1,000 rows of whatever order
// it happens to get and looks exactly like a read that found everything. The audit measured
// these in production; each describe below is one of them, run through the REAL code on a
// fake PostgREST that enforces the cap AND shuffles rows that tie on the ORDER BY
// (test/_fake-fetch-postgrest.js), so a pager over a non-unique key loses rows here as it does there:
//
//   1  _refreshFocusHaste          character_gear 3,327 equipped rows → ~30% read, foci unknown
//   2  _refreshCatalogCastSecs     eqemu_spells: 812 of 2,331 cast times (lowest 1,000 ids)
//   3  ui_socials_index            1,165 rows: "already indexed" set short, common macros unordered
//   4  contributions distinct set  /backfillscan + /juicylogs: 88 names out of 21,509 rows;
//                                  the scan's encounters (limit=200), contributions, rollups
//   5  /encounter mine             encounter_players: top raiders hold 2,775–3,807 rows
//   6  _factionValueMap            npc_faction_entries ordered on a NON-unique column
//   7  scripts/sync-quest-scripts  known-sha pager with no order=
//   8  guild_triggers · character_lockouts · raid_roster · the inline catalog pagers whose
//      failed page used to end the loop and CACHE the partial catalog
//
// Fixture names are invented (Aldenmar, Char001, Soc0001 …); none is a member.
//
// Run: npx vitest run test/cap-safe-reads.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';
import { installFakePostgrest, SERVER_MAX_ROWS } from './_fake-fetch-postgrest.js';

const nodeRequire = createRequire(import.meta.url);
const supabase = nodeRequire('../utils/supabase.js');
const SRC = readSource(BOT_INDEX);

// `require` as index.js sees it: './utils/x' is repo-relative, anything else is a package.
const botRequire = (over = {}) => (m) => (m in over ? over[m] : nodeRequire(m.startsWith('./') ? '../' + m.slice(2) : m));
const evalSlice = (block, names, over, prefix = '') =>
  // eslint-disable-next-line no-new-func
  new Function('require', `${prefix}\n${block}\nreturn { ${names.join(', ')} };`)(botRequire(over));

const GUILD = 'wolfpack';
const pad = (n, w = 4) => String(n).padStart(w, '0');
const uuid = (n) => `00000000-0000-4000-8000-${pad(n, 12)}`;
const keys = (rows, ...cols) => rows.map(r => cols.map(c => r[c]).join('|'));
const expectComplete = (rows, expectedKeys, ...cols) => {
  const got = keys(rows, ...cols);
  expect(got).toHaveLength(expectedKeys.length);
  expect(new Set(got).size).toBe(expectedKeys.length);              // none doubled …
  expect([...got].sort()).toEqual([...expectedKeys].sort());        // … none missing
};

let fake, warn;
beforeEach(() => {
  delete process.env.SUPABASE_GUILD_ID;
  delete process.env.RAIDHELPER_CHANNEL_ID;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.OFFICER_ROLE_NAMES = 'Officer';
  supabase._resetBreaker();
  supabase._resetCapStats();
});
afterEach(() => { fake && fake.restore(); fake = null; vi.restoreAllMocks(); vi.useRealTimers(); });

// ── 1. spell-haste foci ─────────────────────────────────────────────────────
describe('1 · _refreshFocusHaste reads every equipped row (character_gear)', () => {
  const BLOCK = sliceBlock(SRC, 'let _focusHasteByChar = null;', '    .finally(() => { _focusHasteInflight = false; });\n}');
  const load = () => evalSlice(BLOCK, ['refresh: _refreshFocusHaste', 'map: () => _focusHasteByChar'], {}, 'let _spellFxByName = null;');

  // 120 characters × 13 worn slots = 1,560 equipped rows; every third item is a focus (worn spell
  // with SPA 127), so a character's foci follow from the slots they wear. Plus noise the query
  // must leave out: bank rows and another guild's gear.
  function fixture() {
    const gear = [], items = [], spells = [], expected = new Map();
    for (let i = 0; i < 400; i++) items.push({ id: 1000 + i, worneffect: i % 3 === 0 ? 5000 + (i % 7) : 0 });
    for (let s = 0; s < 7; s++) spells.push({ id: 5000 + s, raw: { eff: [127], base: [15 + s] } });
    for (let c = 0; c < 120; c++) {
      let foci = 0;
      for (let slot = 0; slot < 13; slot++) {
        const i = (c * 13 + slot) % 400;
        gear.push({ guild_id: GUILD, character: `Char${pad(c, 3)}`, loc: 'equipped', slot, item_id: 1000 + i });
        if (i % 3 === 0) foci++;
      }
      if (foci) expected.set(`char${pad(c, 3)}`, foci);
    }
    for (let n = 0; n < 1000; n++) gear.push({ guild_id: GUILD, character: `Char${pad(n % 120, 3)}`, loc: 'bank', slot: n, item_id: 1000 + (n % 400) });
    for (let n = 0; n < 200; n++) gear.push({ guild_id: 'other', character: `Stranger${n}`, loc: 'equipped', slot: 0, item_id: 1000 });
    return { gear, items, spells, expected };
  }

  it('every character that wears a focus has it, from 1,560 equipped rows (the cap is 1,000)', async () => {
    const f = fixture();
    expect(f.gear.filter(g => g.guild_id === GUILD && g.loc === 'equipped').length).toBeGreaterThan(SERVER_MAX_ROWS);
    fake = installFakePostgrest({ tables: { character_gear: f.gear, eqemu_items: f.items, eqemu_spells: f.spells } });
    const { refresh, map } = load();
    await refresh();
    const got = map();
    expect(got.size).toBe(f.expected.size);
    for (const [k, n] of f.expected) expect(got.get(k), k).toHaveLength(n);
    expect(got.get('char000')[0]).toMatchObject({ pct: expect.any(Number) });
    // the gear read was paged, and walked in the key order the query leaves unique
    const gearCalls = fake.calls.filter(c => c.table === 'character_gear');
    expect(gearCalls).toHaveLength(2);
    expect(gearCalls[0].query).toContain('order=character.asc,slot.asc');
  });

  it('one refresh at a time: every cast asks while the cache is stale, and a refresh is several requests', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { character_gear: f.gear, eqemu_items: f.items, eqemu_spells: f.spells } });
    const { refresh } = load();
    const first = refresh();
    expect(refresh()).toBeUndefined();
    expect(refresh()).toBeUndefined();
    await first;
    expect(fake.calls.filter(c => c.table === 'character_gear')).toHaveLength(2);   // not 6
  });

  it('a failed read keeps the last good map instead of reading as "nobody wears a focus"', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { character_gear: f.gear, eqemu_items: f.items, eqemu_spells: f.spells } });
    const { refresh, map } = load();
    await refresh();
    const good = map();
    expect(good.size).toBeGreaterThan(0);
    delete fake.tables.character_gear;                              // 404 → the paged read fails
    await refresh();
    expect(map()).toBe(good);
  });

  it('a failed chunk lookup throws away the half-built map; and with no prior map the answer is an empty one, not null', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { character_gear: f.gear, eqemu_items: f.items, eqemu_spells: f.spells } });
    const { refresh, map } = load();
    fake.failWhen = ({ table }) => table === 'eqemu_items';
    await refresh();
    expect(map()).toBeInstanceOf(Map);
    expect(map().size).toBe(0);                                     // not a partial map built without the item lookups
    expect(warn.mock.calls.some(c => /focus-haste\] refresh failed/.test(String(c[0])))).toBe(true);
  });
});

// ── 2. catalog cast times ───────────────────────────────────────────────────
describe('2 · _refreshCatalogCastSecs reads all 3,933 spells (eqemu_spells)', () => {
  const BLOCK = sliceBlock(SRC, 'let _catalogCastSecsByName = null;', '  return p;\n}');
  const load = () => evalSlice(BLOCK, ['refresh: _refreshCatalogCastSecs', 'secs: _catalogCastSecs', 'map: () => _catalogCastSecsByName']);
  const spells = () => Array.from({ length: 3933 }, (_, i) => ({ id: i + 1, name: `Spell ${i + 1}`, cast_time: (i + 1) % 5 === 0 ? 0 : 1500 + ((i + 1) % 9) * 500 }));

  it('every spell with a cast time is in the map, not just the lowest 1,000 ids', async () => {
    const rows = spells();
    const withCast = rows.filter(r => r.cast_time > 0);
    expect(withCast.length).toBeGreaterThan(2300);
    fake = installFakePostgrest({ tables: { eqemu_spells: rows } });
    const { refresh, secs, map } = load();
    await refresh();
    expect(map().size).toBe(withCast.length);
    for (const r of [withCast[0], withCast[1500], withCast.at(-1)]) {
      expect(secs(r.name), r.name).toBe(Math.round(r.cast_time / 100) / 10);
    }
  });

  it('a failed read leaves the old map (or an empty one) — it is not cached as "no spell has a cast time"', async () => {
    const rows = spells();
    fake = installFakePostgrest({ tables: { eqemu_spells: rows } });
    const { refresh, map } = load();
    await refresh();
    const good = map();
    fake.failWhen = ({ table, query }) => table === 'eqemu_spells' && /offset=1000/.test(query);   // page 2 fails
    await refresh();
    expect(map()).toBe(good);
    expect(good.size).toBeGreaterThan(2300);
  });

  it('one refresh at a time', async () => {
    fake = installFakePostgrest({ tables: { eqemu_spells: spells() } });
    const { refresh } = load();
    const a = refresh();
    expect(refresh()).toBeUndefined();
    await a;
    expect(fake.calls.filter(c => c.table === 'eqemu_spells')).toHaveLength(4);
  });
});

// ── 3. ui_socials_index ─────────────────────────────────────────────────────
describe('3 · ui_socials_index: the common-macro tally and the "already indexed" set', () => {
  const BLOCK = sliceBlock(SRC, 'const COMMON_MACRO_MIN_CHARS = 3;', '// GET /api/agent/ui-pending-edits?characters=a,b')
    .replace('setTimeout(() => { _backfillSocialsIndex().catch(() => {}); }, 90_000);', '');
  const CLASSES = ['Cleric', 'Druid', 'Wizard', 'Enchanter'];
  const load = (over = {}) => evalSlice(BLOCK, ['recompute: _recomputeCommonMacros', 'backfill: _backfillSocialsIndex'], over);

  // Two families of macro, 160 in all, each carried by exactly 3 characters (so one lost row drops
  // a macro under the 3-character floor):
  //   heavy   60 macros on the SAME three characters, who also hold 1,000 one-off macros between
  //           them — ~390 rows each, so a read ordered on `character` alone ties 390 deep right
  //           where the cap falls and rows go missing exactly there;
  //   spread  100 macros on characters scattered over 1,100 names, whose classes come from a
  //           `characters` table that is itself past the cap (1,200 rows).
  function fixture() {
    const idx = [], chars = [], carriers = [];
    for (let c = 0; c < 1200; c++) chars.push({ guild_id: GUILD, name: `Soc${pad(c)}`, class: CLASSES[c % 4] });
    for (let m = 0; m < 60; m++) {
      const who = [0, 1, 2];
      carriers.push(who);
      for (const c of who) idx.push({ guild_id: GUILD, character: `Soc${pad(c)}`, page: 1 + (m % 10), button: 1 + Math.floor(m / 10), name: `Heavy${m}`, lines: [`/say heavy ${m}`, '/pause 5'] });
    }
    for (let n = 0; n < 1000; n++) idx.push({ guild_id: GUILD, character: `Soc${pad(n % 3)}`, page: 21 + Math.floor(n / 3), button: 1, name: `Mine${n}`, lines: [`/say only ${n}`] });
    for (let s = 0; s < 100; s++) {
      const who = [0, 1, 2].map(k => 100 + ((s * 11 + k * 397) % 1100));
      carriers.push(who);
      for (const c of who) idx.push({ guild_id: GUILD, character: `Soc${pad(c)}`, page: 400 + s, button: 1, name: `Spread${s}`, lines: [`/say spread ${s}`] });
    }
    return { idx, chars, carriers };
  }

  it('tallies all 1,480 indexed macros: every common macro found, with the right classes', async () => {
    const f = fixture();
    expect(f.idx.length).toBeGreaterThan(SERVER_MAX_ROWS);
    fake = installFakePostgrest({ tables: { ui_socials_index: f.idx, characters: f.chars, common_macros: [] } });
    await load().recompute();
    const out = fake.tables.common_macros;
    expect(out).toHaveLength(160);
    const lineOf = (i) => (i < 60 ? `/say heavy ${i}` : `/say spread ${i - 60}`);
    for (let i = 0; i < 160; i++) {
      const row = out.find(r => r.lines[0] === lineOf(i));
      expect(row, `macro ${i}`).toBeTruthy();
      expect(row.char_count).toBe(3);
      const classes = {};
      for (const c of f.carriers[i]) classes[CLASSES[c % 4]] = (classes[CLASSES[c % 4]] || 0) + 1;
      expect(row.classes, `classes of macro ${i}`).toEqual(classes);
    }
  });

  it('a failed index read keeps the existing common_macros instead of wiping or shrinking them', async () => {
    const f = fixture();
    const kept = [{ guild_id: GUILD, sig: 'keep me', name: 'Old', lines: ['/x'], char_count: 9 }];
    fake = installFakePostgrest({ tables: { ui_socials_index: f.idx, characters: f.chars, common_macros: [...kept] } });
    fake.failWhen = ({ table, query }) => table === 'ui_socials_index' && /offset=1000/.test(query);
    await load().recompute();
    expect(fake.tables.common_macros).toEqual(kept);
    expect(fake.calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('after a boot, only the characters really missing from the index are re-indexed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });   // the recompute is debounced 30s
    // 1,500 indexed characters with one macro each (so the 1,000-row cap cuts whole characters
    // out of the "indexed" set), 480 of them with a snapshot, + 20 with a snapshot and no index
    // yet. The read takes the 500 newest snapshots, which is all of them.
    const idx = [];
    for (let c = 0; c < 1500; c++) idx.push({ guild_id: GUILD, character: `Soc${pad(c)}`, page: 1, button: 1, name: 'm', lines: ['/x'] });
    const snaps = [];
    const blobs = new Map();
    const names = [...Array.from({ length: 480 }, (_, c) => `Soc${pad(c * 3)}`), ...Array.from({ length: 20 }, (_, n) => `Fresh${pad(n, 3)}`)];
    names.forEach((nm, i) => {
      snaps.push({ id: 100 + i, character_name: nm, owner_discord_id: 'u' + i, created_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(), payload_enc: nm });
      blobs.set(nm, JSON.stringify({ files: { [`${nm.toLowerCase()}_pq.proj.ini`]: '[Socials]\nPage1Button1Name=Hi\nPage1Button1Line1=/say hi' } }));
    });
    fake = installFakePostgrest({ tables: { ui_socials_index: idx, ui_snapshots: snaps, characters: [], common_macros: [] } });
    const bidCrypto = { isEncryptionEnabled: () => true, decryptBlob: (enc) => blobs.get(enc) };
    await load({ './utils/bidCrypto': bidCrypto }).backfill();
    // each re-index starts with one DELETE of that character's rows
    const redone = fake.calls.filter(c => c.method === 'DELETE' && c.table === 'ui_socials_index')
      .map(c => decodeURIComponent(c.query.match(/character=ilike\.([^&]+)/)[1]));
    expect(redone.sort()).toEqual(Array.from({ length: 20 }, (_, n) => `Fresh${pad(n, 3)}`));
  });

  it('a failed read of the index is not "nothing indexed": nothing is decrypted or re-indexed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const snaps = [{ id: 1, character_name: 'Soc0001', owner_discord_id: 'u', created_at: '2026-10-01T00:00:00Z', payload_enc: 'Soc0001' }];
    fake = installFakePostgrest({ tables: { ui_socials_index: [], ui_snapshots: snaps } });
    fake.failWhen = ({ table }) => table === 'ui_socials_index';
    let decrypted = 0;
    await load({ './utils/bidCrypto': { isEncryptionEnabled: () => true, decryptBlob: () => { decrypted++; return '{}'; } } }).backfill();
    expect(decrypted).toBe(0);
    expect(fake.calls.some(c => c.table === 'ui_snapshots')).toBe(false);
  });
});

// ── 4. the distinct set of uploaders, and the scan's windows ────────────────
describe('4 · /backfillscan and /juicylogs: who has uploaded, and a window of encounters', () => {
  const backfillScan = nodeRequire('../utils/backfillScan.js');
  const NOW = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  // The SQL function, in JS: distinct contributor_character with created_at >= p_since, NULLs out.
  const rpcs = {
    recent_contributor_characters: ({ p_since }, tables) => [...new Set(tables.contributions
      .filter(c => c.contributor_character != null && c.created_at >= p_since)
      .map(c => c.contributor_character))].map(contributor_character => ({ contributor_character })),
  };

  // 8 heavy uploaders on every fight and 80 who appear ONCE each — the skew that made the old
  // "select every row, dedupe in JS" read see only a fraction of the 88 names.
  function scanFixture() {
    const base = NOW - 6 * 3600_000;
    const encounters = [], contributions = [], rollups = [];
    for (let i = 0; i < 1300; i++) {
      const id = uuid(i);
      encounters.push({ id, guild_id: GUILD, npc_id: 1, started_at: iso(base + i * 1000), ended_at: iso(base + i * 1000 + 500), duration_sec: 60, total_damage: 1000, classification: 'boss' });
      for (let k = 0; k < 3; k++) contributions.push({ id: `c-${i}-${k}`, encounter_id: id, source: 'agent', contributor_character: `Heavy${(i + k) % 8}`, created_at: iso(NOW - 3600_000) });
      if (i < 80) contributions.push({ id: `c-${i}-L`, encounter_id: id, source: 'agent', contributor_character: `Light${pad(i, 2)}`, created_at: iso(NOW - 3600_000) });
      for (let k = 0; k < 4; k++) rollups.push({ id: i * 4 + k, encounter_id: id, character_name: `P${k}`, by_skill: {} });
    }
    const characters = Array.from({ length: 1100 }, (_, c) => ({ guild_id: GUILD, name: `Soc${pad(c)}`, class: 'Cleric', exclude_from_stats: false }));
    return { encounters, contributions, rollups, characters, window: { fromMs: base - 1000, toMs: base + 1400 * 1000 } };
  }

  it('collectScanData: every encounter, contribution and rollup in the window, and all 88 uploaders', async () => {
    const f = scanFixture();
    fake = installFakePostgrest({
      tables: { encounters: f.encounters, contributions: f.contributions, encounter_combat_rollup: f.rollups, characters: f.characters, agent_backfill_requests: [] },
      rpcs,
    });
    const data = await backfillScan.collectScanData(f.window);
    expectComplete(data.encounters, f.encounters.map(e => e.id), 'id');
    expectComplete(data.contribs, f.contributions.map(c => c.id), 'id');
    expectComplete(data.rollups, keys(f.rollups, 'encounter_id', 'character_name'), 'encounter_id', 'character_name');
    expect(data.characters).toHaveLength(1100);
    expect(data.activeUploaders.size).toBe(88);
    expect(data.activeUploaders.has('light07')).toBe(true);
    // the in-lists stay short enough for the edge: 1,300 UUIDs in one list would be ~48 KB of URL
    expect(Math.max(...fake.calls.map(c => c.query.length))).toBeLessThan(6000);
    expect(fake.calls.filter(c => c.table === 'contributions' && c.method === 'GET').every(c => /encounter_id=in\.\(/.test(c.query))).toBe(true);
  });

  it('is complete on a one-fight window too (nothing to page, nothing to chunk)', async () => {
    const f = scanFixture();
    fake = installFakePostgrest({ tables: { encounters: f.encounters, contributions: f.contributions, encounter_combat_rollup: f.rollups, characters: f.characters, agent_backfill_requests: [] }, rpcs });
    const t0 = Date.parse(f.encounters[10].started_at);
    const data = await backfillScan.collectScanData({ fromMs: t0 - 10, toMs: t0 + 10 });
    expect(data.encounters).toHaveLength(1);
    expect(data.contribs.length).toBeGreaterThan(0);
    expect(data.rollups).toHaveLength(4);
  });

  it('/juicylogs marks everyone who has uploaded, not just those in the first 1,000 contribution rows', async () => {
    const f = scanFixture();
    const attendance = [
      ...Array.from({ length: 10 }, (_, i) => ({ character_name: `Light${pad(i + 40, 2)}`, raids_attended: 50 - i, last_30d: 9, last_90d: 30 - i, last_attended: '2026-10-01' })),
      ...Array.from({ length: 10 }, (_, i) => ({ character_name: `Nobody${i}`, raids_attended: 40 - i, last_30d: 5, last_90d: 15 - i, last_attended: '2026-10-01' })),
    ];
    fake = installFakePostgrest({ tables: { contributions: f.contributions, opendkp_attendance_recent: attendance }, rpcs });
    const juicy = nodeRequire('../commands/juicylogs.js');
    let reply = null;
    await juicy.execute({
      member: { roles: { cache: [{ name: 'Officer' }] } },
      options: { getInteger: () => 20, getString: () => '90' },
      deferReply: async () => {}, reply: async () => {}, editReply: async (p) => { reply = p; },
    });
    const lines = reply.embeds[0].data.description.split('\n');
    expect(lines).toHaveLength(20);
    expect(lines.filter(l => l.includes('🟢'))).toHaveLength(10);    // the ten Light* names
    expect(lines.filter(l => l.includes('⚪'))).toHaveLength(10);    // the ten Nobody* names
    expect(lines.filter(l => l.includes('🟢')).every(l => l.includes('Light'))).toBe(true);
  });

  it('the RPC contract: recent_contributor_characters(p_since) returns contributor_character, and only the bot may call it', () => {
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261004140300_cap_safe_misc.sql'), 'utf8'));
    expect(sql).toMatch(/create or replace function public\.recent_contributor_characters\(p_since timestamptz\)/);
    expect(sql).toMatch(/returns table\(contributor_character text\)/);
    expect(sql).toMatch(/select distinct c\.contributor_character/);
    expect(sql).toMatch(/c\.contributor_character is not null/);
    expect(sql).toMatch(/c\.created_at >= p_since/);
    expect(sql).toMatch(/grant execute on function public\.recent_contributor_characters\(timestamptz\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.recent_contributor_characters\(timestamptz\) from anon/);
    expect(sql).toMatch(/revoke all on function public\.recent_contributor_characters\(timestamptz\) from authenticated/);
    // both callers ask for it by that name, with that parameter
    const callers = [readSource(path.join(ROOT, 'commands', 'juicylogs.js')), readSource(path.join(ROOT, 'utils', 'backfillScan.js'))];
    for (const src of callers) expect(src).toMatch(/rpc\('recent_contributor_characters', \{ p_since: \w+ \}\)/);
  });
});

// ── 5. /encounter mine ──────────────────────────────────────────────────────
describe('5 · /encounter mine reads tonight, not the first 1,000 fights of all time', () => {
  const rosterPath = nodeRequire.resolve('../utils/roster.js');
  const encounterPath = nodeRequire.resolve('../commands/encounter.js');
  let savedRoster;

  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  function fixture() {
    const t0 = dayStart().getTime();
    const tonight = [], players = [];
    for (let i = 0; i < 1210; i++) {
      tonight.push({ encounter_id: uuid(i), guild_id: GUILD, npc_id: 1, boss_name: `Boss ${i}`, started_at: new Date(t0 + (i + 1) * 1000).toISOString(), duration_sec: 30, contributor_count: 3, completeness_score: 0.9 });
      if (i % 4 === 0) players.push({ encounter_id: uuid(i), character_name: 'Aldenmar', total_damage: 5000, dps: 100, rank: 50 + (i % 9) });
      players.push({ encounter_id: uuid(i), character_name: 'Brackwyn', total_damage: 1, dps: 1, rank: 80 });
    }
    // A top raider's HISTORY: 3,000 older fights at ranks 1–40 — which is what the old read
    // (every row by name, order=rank.asc) returned its first 1,000 of.
    for (let i = 0; i < 3000; i++) players.push({ encounter_id: `old-${pad(i)}`, character_name: 'Aldenmar', total_damage: 9000, dps: 200, rank: 1 + (i % 40) });
    return { tonight, players, mine: tonight.filter((_, i) => i % 4 === 0) };
  }

  beforeEach(() => {
    savedRoster = nodeRequire.cache[rosterPath];
    nodeRequire.cache[rosterPath] = {
      id: rosterPath, filename: rosterPath, loaded: true, children: [], paths: [],
      exports: { getCharacter: (n) => (String(n).toLowerCase() === 'aldenmar' ? { name: 'Aldenmar', race: 'Human', class: 'Cleric' } : null), getAllNames: () => ['aldenmar'] },
    };
    delete nodeRequire.cache[encounterPath];
  });
  afterEach(() => {
    if (savedRoster) nodeRequire.cache[rosterPath] = savedRoster; else delete nodeRequire.cache[rosterPath];
    delete nodeRequire.cache[encounterPath];
  });

  const interaction = (replies) => ({
    options: { getString: (k) => (k === 'character' ? 'Aldenmar' : null), getSubcommand: () => 'mine' },
    member: { displayName: 'x' }, user: { username: 'x' },
    deferReply: async () => {}, reply: async (p) => { replies.push(p); }, editReply: async (p) => { replies.push(p); },
  });

  it('getTonightEncounters returns the whole night (1,210 fights; the cap is 1,000), newest first, none doubled', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { encounter_completeness: f.tonight } });
    const rows = await supabase.getTonightEncounters(new Date());
    expectComplete(rows, f.tonight.map(r => r.encounter_id), 'encounter_id');
    expect(rows[0].encounter_id).toBe(uuid(1209));
    expect(rows.at(-1).encounter_id).toBe(uuid(0));
  });

  it('a fight that lands while the night is being paged does not double a row', async () => {
    // The night is live: a new fight (newest first) shifts a descending walk by one, so the row at
    // the end of page 1 comes back again at the top of page 2. failWhen runs once per request, so
    // it doubles as the hook that adds the fight between the two pages.
    const f = fixture();
    const before = f.tonight.map(r => r.encounter_id);          // the fake mutates f.tonight
    fake = installFakePostgrest({ tables: { encounter_completeness: f.tonight } });
    let landed = false;
    fake.failWhen = ({ table, query }) => {
      if (table === 'encounter_completeness' && /offset=1000/.test(query) && !landed) {
        landed = true;
        fake.tables.encounter_completeness.push({ ...f.tonight[0], encounter_id: uuid(5000), started_at: new Date(Date.parse(f.tonight.at(-1).started_at) + 60_000).toISOString() });
      }
      return false;
    };
    const rows = await supabase.getTonightEncounters(new Date());
    expect(landed).toBe(true);
    expectComplete(rows, before, 'encounter_id');               // every fight seen once; the one that landed mid-walk comes next time
  });

  it('lists the fights I was in tonight, found among 3,300 of my rows', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { encounter_completeness: f.tonight, encounter_players: f.players, loot_drops: [] } });
    const replies = [];
    await nodeRequire('../commands/encounter.js').execute(interaction(replies));
    const embed = replies.at(-1).embeds[0].data;
    expect(embed.fields[0].name).toBe(`✅ Fights I was in (${f.mine.length})`);
    expect(embed.fields[1].name).toContain(`Fights tonight I wasn't in (${1210 - f.mine.length})`);
    // every read of encounter_players was scoped to tonight's ids and short enough to be a URL
    const reads = fake.calls.filter(c => c.table === 'encounter_players');
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.every(c => /encounter_id=in\.\(/.test(c.query) && c.query.length < 6000 && c.rows < SERVER_MAX_ROWS)).toBe(true);
  });

  it('/encounter tonight lists each fight by its encounter_id (the view has no id column)', async () => {
    const t0 = dayStart().getTime();
    const night = ['a1b2c3d4-0000-4000-8000-000000000001', 'e5f6a7b8-0000-4000-8000-000000000002'].map((id, i) => (
      { encounter_id: id, guild_id: GUILD, npc_id: 1, boss_name: `Boss ${i}`, started_at: new Date(t0 + (i + 1) * 1000).toISOString(), duration_sec: 30, contributor_count: 3, completeness_score: 0.9 }));
    fake = installFakePostgrest({ tables: { encounter_completeness: night } });
    const replies = [];
    const ix = { ...interaction(replies), options: { getString: () => null, getSubcommand: () => 'tonight' } };
    await nodeRequire('../commands/encounter.js').execute(ix);
    const embed = replies.at(-1).embeds[0].data;
    expect(embed.title).toBe("📅 Tonight's encounters (2)");
    expect(embed.description).toContain('`a1b2c3d4`');
    expect(embed.description).toContain('`e5f6a7b8`');
  });

  it('says so when a read fails, instead of reporting a night I was absent', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { encounter_completeness: f.tonight, encounter_players: f.players, loot_drops: [] } });
    fake.failWhen = ({ table }) => table === 'encounter_players';
    const replies = [];
    await nodeRequire('../commands/encounter.js').execute(interaction(replies));
    expect(replies.at(-1).content).toMatch(/Could not read your encounters/);
  });
});

// ── 6. faction value map ────────────────────────────────────────────────────
describe('6 · _factionValueMap pages eqemu_npc_faction_entries on its whole primary key', () => {
  const BLOCK = sliceBlock(SRC, 'const _FACTION_VALUE_TTL_MS = 6 * 3600 * 1000;', 'async function _handleAgentFaction(req, res) {')
    .replace(/async function _handleAgentFaction\(req, res\) \{$/, '');
  const load = () => evalSlice(BLOCK, ['build: _factionValueMap']);

  // 170 npc_factions × 10 factions = 1,700 entries; ties on npc_faction_id are 10 deep.
  function fixture() {
    const names = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `Faction ${i + 1}` }));
    const entries = [], npcs = [];
    for (let nf = 1; nf <= 170; nf++) {
      for (let k = 0; k < 10; k++) entries.push({ npc_faction_id: nf, faction_id: 1 + ((nf + k * 3) % 40), value: 5 + k });
      npcs.push({ id: 1000 + nf, name: `a_mob_${nf}`, npc_faction_id: nf });
    }
    return { names, entries, npcs };
  }

  it('every entry of every npc_faction lands on its mob (1,700 rows; ordering on npc_faction_id alone loses some)', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { eqemu_faction_list_full: f.names, eqemu_npc_faction_entries: f.entries, eqemu_npc_types: f.npcs } });
    const byMob = await load().build();
    expect(byMob.size).toBe(170);
    for (let nf = 1; nf <= 170; nf++) expect(byMob.get(`a mob ${nf}`).size, `a mob ${nf}`).toBe(10);
    const entryCalls = fake.calls.filter(c => c.table === 'eqemu_npc_faction_entries');
    expect(entryCalls[0].query).toContain('order=npc_faction_id.asc,faction_id.asc');
  });
});

// ── 7. quest-script sync ────────────────────────────────────────────────────
describe('7 · scripts/sync-quest-scripts reads every known sha', () => {
  it('walks eqemu_quest_scripts in path order: all 5,719 rows, once each', async () => {
    const rows = Array.from({ length: 5719 }, (_, i) => ({ path: `zone${i % 190}/Npc_${pad(i)}.lua`, sha: `sha${i}`, body: 'x' }));
    fake = installFakePostgrest({ tables: { eqemu_quest_scripts: rows } });
    // The script reads SUPABASE_URL when it loads, so it loads after the fake has set it.
    const { fetchKnownShas } = nodeRequire('../scripts/sync-quest-scripts.js');
    const get = async (p) => (await fetch(`${process.env.SUPABASE_URL}/rest/v1${p}`)).json();
    const known = await fetchKnownShas(get);
    expect(known.size).toBe(5719);
    for (const r of [rows[0], rows[2500], rows.at(-1)]) expect(known.get(r.path)).toBe(r.sha);
    expect(fake.calls.every(c => c.query.includes('order=path.asc'))).toBe(true);
  });
});

// ── 8a. guild triggers ──────────────────────────────────────────────────────
describe('8a · _guildTriggersFor serves every enabled trigger', () => {
  const BLOCK = sliceBlock(SRC, 'async function _guildTriggersFor(', 'async function _handleAgentGuildTriggers(')
    .replace(/async function _handleAgentGuildTriggers\($/, '');
  const load = () => {
    // eslint-disable-next-line no-new-func
    return new Function('require', '_pollTuningVersion', `${BLOCK}\nreturn _guildTriggersFor;`)(botRequire(), (parts) => parts.length + ':' + parts[0]);
  };

  it('1,100 enabled triggers (a single import added 381 of today\'s 484) all come back, in category/name order', async () => {
    const rows = [];
    for (let i = 0; i < 1100; i++) rows.push({ id: `t${pad(i)}`, guild_id: GUILD, enabled: true, category: `cat${pad(i % 7, 2)}`, name: `Trigger ${pad(i)}`, applies_to_classes: null, updated_at: '2026-10-01T00:00:00Z' });
    for (let i = 0; i < 60; i++) rows.push({ id: `off${i}`, guild_id: GUILD, enabled: false, category: 'cat00', name: `Off ${i}`, applies_to_classes: null, updated_at: '2026-10-01T00:00:00Z' });
    fake = installFakePostgrest({ tables: { guild_triggers: rows } });
    const { version, triggers } = await load()();
    expectComplete(triggers, rows.filter(r => r.enabled).map(r => r.id), 'id');
    expect(version).not.toBe('0');
    const order = triggers.map(t => `${t.category}|${t.name}`);
    expect(order).toEqual([...order].sort());
  });

  it('a category filter still applies', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `t${pad(i)}`, guild_id: GUILD, enabled: true, category: i % 2 ? 'a' : 'b', name: `T${pad(i)}`, applies_to_classes: null, updated_at: 'x' }));
    fake = installFakePostgrest({ tables: { guild_triggers: rows } });
    const { triggers } = await load()({ category: 'a' });
    expect(triggers).toHaveLength(750);
    expect(triggers.every(t => t.category === 'a')).toBe(true);
  });
});

// ── 8b. lockouts and the raid roster ────────────────────────────────────────
describe('8b · character_lockouts and raid_roster are paged on their whole key', () => {
  // The paged result as the command received it, per table. The command's own select drops the
  // key columns it does not need (raid_roster: uploaded_by_discord_id), and rows that differ only
  // there cannot be told apart — so the spy reads every column; order, limit and offset are
  // exactly what the command asked for.
  function spyPaged() {
    const got = {};
    const real = supabase.selectAllPaged;
    vi.spyOn(supabase, 'selectAllPaged').mockImplementation(async (table, q, order, sel) => {
      const rows = await real(table, q.replace(/(^|&)select=[^&]*/, '$1select=*'), order, sel);
      got[table] = rows;
      return rows;
    });
    return got;
  }

  // 250 characters × 6 bosses = 1,500 lockouts (ties on character are 6 deep); 41 uploaders × 30
  // names = 1,230 roster rows (ties on name are 41 deep — not 40, which would put the cap exactly
  // between two names and hide the loss).
  function fixture() {
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    const lockouts = [], roster = [], characters = [];
    for (let c = 0; c < 250; c++) {
      characters.push({ guild_id: GUILD, name: `Lock${pad(c)}`, main_name: c % 3 ? `Lock${pad(c - (c % 3))}` : null });
      for (let b = 0; b < 6; b++) lockouts.push({ guild_id: GUILD, character: `Lock${pad(c)}`, boss_key: `boss_${b}`, expires_at: future, ours: true });
    }
    const captured = new Date().toISOString();
    for (let u = 0; u < 41; u++) for (let n = 0; n < 30; n++) roster.push({ guild_id: GUILD, uploaded_by_discord_id: `u${pad(u, 2)}`, name: `Raider${pad(n, 2)}`, class: 'Cleric', captured_at: captured });
    return { lockouts, roster, characters };
  }

  it('/preraid gather: every lockout and every roster row arrives once', async () => {
    const f = fixture();
    fake = installFakePostgrest({ tables: { character_lockouts: f.lockouts, raid_roster: f.roster, characters: f.characters } });
    const got = spyPaged();
    await nodeRequire('../commands/preraid.js').gather({});
    expectComplete(got.character_lockouts, keys(f.lockouts, 'character', 'boss_key'), 'character', 'boss_key');
    expectComplete(got.raid_roster, keys(f.roster, 'uploaded_by_discord_id', 'name'), 'uploaded_by_discord_id', 'name');
  });

  it('/lockoutcheck: every lockout arrives once', async () => {
    const f = fixture();
    const raidhelperPath = nodeRequire.resolve('../utils/raidhelper.js');
    const real = nodeRequire('../utils/raidhelper.js');
    const saved = nodeRequire.cache[raidhelperPath];
    const bosses = nodeRequire('../data/bosses.json');
    nodeRequire.cache[raidhelperPath] = { ...saved, exports: { ...real, loadTonightsTargets: async () => ({ bossIds: [bosses[0].id], eventTitle: 'Night', eventUrl: null }) } };
    try {
      fake = installFakePostgrest({ tables: { character_lockouts: f.lockouts, characters: f.characters } });
      const got = spyPaged();
      await nodeRequire('../commands/lockoutcheck.js').buildBriefingEmbed({});
      expectComplete(got.character_lockouts, keys(f.lockouts, 'character', 'boss_key'), 'character', 'boss_key');
    } finally {
      nodeRequire.cache[raidhelperPath] = saved;
    }
  });
});

// ── 8c. the inline catalog pagers ───────────────────────────────────────────
describe('8c · catalogs read whole, and a failed page is never cached as the catalog', () => {
  const res = () => {
    const r = { status: null, headers: null, body: null };
    r.writeHead = (s, h) => { r.status = s; r.headers = h; };
    r.end = (b) => { r.body = b; };
    return r;
  };
  const get = (handler, headers = {}) => { const r = res(); return handler({ headers }, r, true).then(() => r); };

  // ── item clickies ──
  describe('item-clickies', () => {
    const BLOCK = sliceBlock(SRC, 'let _itemClickyCache    = null;', '// GET /api/agent/item-catalog');
    const load = () => evalSlice(BLOCK, ['handler: _handleAgentItemClickies', 'cache: () => _itemClickyCache'], { }, '');

    // eqemu_items: clickeffect is NOT NULL everywhere (-1 = none). 1,300 real clickies among 6,000 items.
    const items = () => Array.from({ length: 6000 }, (_, i) => ({
      id: i + 1, name: `Item ${i + 1}`, casttime: 1000, clicktype: 1, clicklevel: 1, maxcharges: -1,
      clickeffect: i % 5 === 0 ? 1000 + i : (i % 7 === 0 ? 0 : -1),
    }));

    it('serves every item that really has a click (1,300 > the 1,000 cap), and only those', async () => {
      const rows = items();
      const real = rows.filter(r => r.clickeffect > 0);
      expect(real.length).toBeGreaterThan(SERVER_MAX_ROWS);
      fake = installFakePostgrest({ tables: { eqemu_items: rows } });
      const r = await get(load().handler);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.count).toBe(real.length);
      expectComplete(body.entries, real.map(x => String(x.id)), 'id');
      expect(body.entries.every(e => e.clickeffect > 0)).toBe(true);
    });

    it('a failed page is not cached: with no good catalog the agent gets a 503 (and keeps its disk cache)', async () => {
      fake = installFakePostgrest({ tables: { eqemu_items: items() } });
      fake.failWhen = ({ table, query }) => table === 'eqemu_items' && /offset=1000/.test(query);
      const h = load();
      const r = await get(h.handler);
      expect(r.status).toBe(503);
      expect(h.cache()).toBe(null);
      fake.failWhen = null;                                         // the next ask repairs it
      expect((await get(h.handler)).status).toBe(200);
      expect(h.cache()).not.toBe(null);
    });

    it('a failed refresh keeps serving the last good catalog and retries in minutes, not hours', async () => {
      const rows = items();
      fake = installFakePostgrest({ tables: { eqemu_items: rows } });
      const h = load();
      const first = await get(h.handler);
      const good = h.cache();
      good.fetchedAt = Date.now() - 7 * 3600_000;                   // past the 6 h TTL
      fake.failWhen = ({ table }) => table === 'eqemu_items';
      const again = await get(h.handler);
      expect(again.status).toBe(200);
      expect(again.body).toBe(first.body);
      expect(h.cache()).toBe(good);
      const retryInMs = good.fetchedAt + 6 * 3600_000 - Date.now();
      expect(retryInMs).toBeGreaterThan(4 * 60_000);
      expect(retryInMs).toBeLessThanOrEqual(5 * 60_000);
    });

    it('If-None-Match still answers 304', async () => {
      fake = installFakePostgrest({ tables: { eqemu_items: items() } });
      const h = load();
      const first = await get(h.handler);
      const again = await get(h.handler, { 'if-none-match': first.headers.ETag });
      expect(again.status).toBe(304);
    });
  });

  // ── item catalog (wishlist picker) ──
  describe('item-catalog', () => {
    const BLOCK = sliceBlock(SRC, 'const _ITEM_CATALOG_TTL_MS', '// GET /api/agent/mob-info?name=<npc>');
    const load = () => evalSlice(BLOCK, ['handler: _handleAgentItemCatalog', 'cache: () => _itemCatalogCache']);
    const rows = () => Array.from({ length: 2345 }, (_, i) => ({ item_id: 100 + i, item_name: `Drop ${i}`, era: i % 3 }));

    it('serves every droppable item (2,345; the cap is 1,000)', async () => {
      fake = installFakePostgrest({ tables: { item_catalog_droppable: rows() } });
      const r = await get(load().handler);
      const body = JSON.parse(r.body);
      expect(body.count).toBe(2345);
      expect(new Set(body.entries.map(e => e[0])).size).toBe(2345);
    });

    it('a failed page is not cached as the catalog', async () => {
      fake = installFakePostgrest({ tables: { item_catalog_droppable: rows() } });
      fake.failWhen = ({ query }) => /offset=2000/.test(query);     // the third page
      const h = load();
      expect((await get(h.handler)).status).toBe(503);
      expect(h.cache()).toBe(null);                                 // a partial 2,000-item catalog is not remembered for 12 h
      fake.failWhen = null;
      expect(JSON.parse((await get(h.handler)).body).count).toBe(2345);
    });
  });

  // ── _spellFxMap ──
  describe('_spellFxMap', () => {
    const BLOCK = sliceBlock(SRC, 'let _spellFxByName = null;', '  return _spellFxByName || new Map();\n}');
    const load = () => evalSlice(BLOCK, ['fx: _spellFxMap', 'cached: () => _spellFxByName']);
    const spells = () => Array.from({ length: 2400 }, (_, i) => ({ id: i + 1, name: `Spell ${i + 1}`, buffduration: 10, good_effect: 1, raw: { eff: [11], base: [i + 1] } }));   // SPA 11 = haste

    it('decodes all 2,400 spells, not the first 1,000', async () => {
      fake = installFakePostgrest({ tables: { eqemu_spells: spells() } });
      const m = await load().fx();
      expect(m.size).toBe(2400);
      expect(m.get('spell 2400').haste).toBe(2400);
    });

    it('a failed page keeps the previous map; a first failure caches nothing', async () => {
      fake = installFakePostgrest({ tables: { eqemu_spells: spells() } });
      fake.failWhen = ({ query }) => /offset=1000/.test(query);
      const h = load();
      expect((await h.fx()).size).toBe(0);
      expect(h.cached()).toBe(null);                                // not the 1,000 spells of the first page
      fake.failWhen = null;
      expect((await h.fx()).size).toBe(2400);
    });
  });

  // ── spell catalog ──
  describe('spell-catalog', () => {
    const BLOCK = sliceBlock(SRC, 'let _spellCatalogCache = null;', '// GET /api/agent/item-clickies');
    const load = () => evalSlice(BLOCK, ['handler: _handleAgentSpellCatalog', 'cache: () => _spellCatalogCache'], {}, 'const isPopEraLocked = () => false; const mimicLink = {};');
    const spells = () => Array.from({ length: 2345 }, (_, i) => ({
      id: i + 1, name: `Spell ${i + 1}`, cast_on_you: 'x', cast_on_other: 'y', spell_fades: 'z', buffduration: 0, buffdurationformula: 0,
      cast_time: 2000, good_effect: 0, mana: 10, recast_time: 0, resist_type: 0, effect_id_1: 254, effect_base_value_1: 0,
      effect_id_2: 254, effect_base_value_2: 0, effect_id_3: 254, effect_base_value_3: 0, raw: null,
    }));
    // 2,600 NPC spell-list rows over 900 distinct spells: ties on spellid are ~3 deep.
    const npcEntries = () => Array.from({ length: 2600 }, (_, i) => ({ npc_spells_id: 1 + Math.floor(i / 900), spellid: 1 + (i % 900), minlevel: i % 5 }));

    it('serves all 2,345 spells, each flagged npc exactly when an NPC list holds it', async () => {
      fake = installFakePostgrest({ tables: { eqemu_spells: spells(), eqemu_npc_spells_entries: npcEntries() } });
      const r = await get(load().handler);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.count).toBe(2345);
      expect(new Set(body.entries.map(e => e.id)).size).toBe(2345);
      expect(body.entries.filter(e => e.npc === 1).map(e => e.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1));
    });

    it('a failed spell page is a 500 and nothing is cached (it used to cache the partial catalog for an hour)', async () => {
      fake = installFakePostgrest({ tables: { eqemu_spells: spells(), eqemu_npc_spells_entries: npcEntries() } });
      fake.failWhen = ({ table, query }) => table === 'eqemu_spells' && /offset=1000/.test(query);
      const h = load();
      const r = await get(h.handler);
      expect(r.status).toBe(500);
      expect(h.cache()).toBe(null);
      fake.failWhen = null;
      expect(JSON.parse((await get(h.handler)).body).count).toBe(2345);
    });

    it('a failed NPC-castable read serves the catalog WITHOUT the flag, never half of it', async () => {
      fake = installFakePostgrest({ tables: { eqemu_spells: spells(), eqemu_npc_spells_entries: npcEntries() } });
      fake.failWhen = ({ table, query }) => table === 'eqemu_npc_spells_entries' && /offset=1000/.test(query);
      const r = await get(load().handler);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.count).toBe(2345);
      expect(body.entries.filter(e => e.npc === 1)).toHaveLength(0);
    });
  });
});
