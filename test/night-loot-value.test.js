// test/night-loot-value.test.js — what the Loot tab's "who looted what" list is worth, per item and per toon.
//
// The guild lead, 2026-10-08: "quantify the loot tab with how much each item is worth and say how much each
// toon has looted equivalently in platinum from what you've seen, and time bound it."
//
// Runs the SHIPPED code: utils/lootValue.js directly, index.js _nightLootPanelBody and the night-loot handler
// branch sliced out and run against test/_cap_fake_supabase.js (which enforces PostgREST's silent 1,000-row
// cap, so "totals cover the whole window" is proven on fixtures past the cap, not on ten rows).
//
// Prices are eqemu_items.price in COPPER; nodrop = true is NO DROP. Names are invented fixtures.
//
// Run: npx vitest run test/night-loot-value.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const require_ = createRequire(BOT_INDEX);
const { clampLootHours, lootWindowLabel, quoteInValue, lookupItemValues, buildLootValue, _resetPriceCache } = require_('./utils/lootValue');

const NOW = Date.parse('2026-10-08T03:00:00Z');
const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const GUILD = 'wolfpack';

const src = readSource(BOT_INDEX);
const bodyBlock = sliceBlock(src, 'async function _nightLootPanelBody', '// ── end night-loot panel fetch ──');
globalThis.__nightLootRequire = require_;
const { _nightLootPanelBody } = evalBlock('const require = globalThis.__nightLootRequire;\n' + bodyBlock, ['_nightLootPanelBody']);

let nextId = 1;
const lootRow = (looter, item, ago, zone = 'The Overthere') =>
  ({ id: nextId++, guild_id: GUILD, looter_character: looter, item_name: item, zone, looted_at: iso(ago) });
const itemRow = (id, name, price, nodrop = true) => ({ id, name, price, nodrop });

beforeEach(() => { _resetPriceCache(); nextId = 1; });

describe('the window', () => {
  it('accepts 12 / 24 / 168 / 720 and nothing else', () => {
    for (const h of [12, 24, 168, 720, '24', '720']) expect(clampLootHours(h)).toBe(Number(h));
    for (const bad of [undefined, null, '', 'abc', 0, 6, 13, 100, 9999, -12, '24h', NaN]) expect(clampLootHours(bad)).toBe(12);
  });

  it('labels each window for the panel scope', () => {
    expect([12, 24, 168, 720].map(lootWindowLabel)).toEqual(['last 12h', 'last 24h', 'last 7d', 'last 30d']);
  });
});

describe('quoting item names into an in.() list', () => {
  it('double-quotes a name, escaping a backslash and a double quote', () => {
    expect(quoteInValue("Aldenmar's Cloak")).toBe('"Aldenmar\'s Cloak"');
    expect(quoteInValue('Ring of the "Ancients"')).toBe('"Ring of the \\"Ancients\\""');
    expect(quoteInValue('Odd\\Name')).toBe('"Odd\\\\Name"');
  });
});

describe('lookupItemValues', () => {
  it('takes the LOWEST id when a name exists under several ids, whatever order they come back in', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [itemRow(16050, 'Rune of Proximity', 25), itemRow(11742, 'Rune of Proximity', 900, false), itemRow(20000, 'Rune of Proximity', 5)] } });
    const { values } = await lookupItemValues(sb, ['Rune of Proximity'], { nowMs: NOW });
    expect(values.get('Rune of Proximity')).toEqual({ value_cp: 900, nodrop: false });
  });

  it('a name with an apostrophe or a comma is found by exact match', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [itemRow(1, "Aldenmar's Cloak", 1000), itemRow(2, 'Rune of the Dead, Greater', 2000), itemRow(3, 'Aldenmar', 9)] } });
    const { values, failed } = await lookupItemValues(sb, ["Aldenmar's Cloak", 'Rune of the Dead, Greater'], { nowMs: NOW });
    expect(failed).toBe(false);
    expect(values.get("Aldenmar's Cloak").value_cp).toBe(1000);
    expect(values.get('Rune of the Dead, Greater').value_cp).toBe(2000);
    const q = sb.calls.find(c => c.table === 'eqemu_items').qs;
    expect(q).toContain('name=in.(');
    expect(decodeURIComponent(q)).toContain('"Rune of the Dead, Greater"');
  });

  it('an unknown name is null; a known item priced 0 is a price, not a gap', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [itemRow(1, 'Quest Token', 0)] } });
    const { values } = await lookupItemValues(sb, ['Quest Token', 'Nothing Like This'], { nowMs: NOW });
    expect(values.get('Quest Token')).toEqual({ value_cp: 0, nodrop: true });
    expect(values.get('Nothing Like This')).toBeNull();
  });

  it('chunks a long name list and remembers prices for 6 hours', async () => {
    const names = Array.from({ length: 120 }, (_, i) => 'Item ' + i);
    const sb = makeCapFake({ tables: { eqemu_items: names.map((n, i) => itemRow(i + 1, n, 100)) } });
    await lookupItemValues(sb, names, { nowMs: NOW });
    expect(sb.calls.filter(c => c.table === 'eqemu_items').length).toBe(3);   // 50 + 50 + 20
    const before = sb.calls.length;
    await lookupItemValues(sb, names, { nowMs: NOW + 5 * HOUR });
    expect(sb.calls.length).toBe(before);                                       // served from memory
    await lookupItemValues(sb, names, { nowMs: NOW + 7 * HOUR });
    expect(sb.calls.length).toBeGreaterThan(before);                            // expired
  });

  it('a failed chunk is reported, leaves those names out of the map, and is not remembered', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [itemRow(1, 'Cloak of Flames', 54000)] }, missing: ['eqemu_items'] });
    const { values, failed } = await lookupItemValues(sb, ['Cloak of Flames'], { nowMs: NOW });
    expect(failed).toBe(true);
    expect(values.has('Cloak of Flames')).toBe(false);
    const ok = makeCapFake({ tables: { eqemu_items: [itemRow(1, 'Cloak of Flames', 54000)] } });
    expect((await lookupItemValues(ok, ['Cloak of Flames'], { nowMs: NOW })).values.get('Cloak of Flames').value_cp).toBe(54000);
  });
});

describe('buildLootValue', () => {
  const values = new Map([
    ['Cloak of Flames', { value_cp: 54000, nodrop: true }],
    ['Spider Silk', { value_cp: 250, nodrop: false }],
    ['Mystery Drop', null],
  ]);
  const rows = [
    lootRow('Aldenmar', 'Spider Silk', MIN),
    lootRow('Brackwyn', 'Cloak of Flames', 2 * MIN),
    lootRow('Aldenmar', 'Mystery Drop', 3 * MIN),
    lootRow('aldenmar', 'Cloak of Flames', 4 * MIN),     // same toon, different case
    lootRow('Corvale', 'Cloak of Flames', 3 * HOUR),
  ];

  it('sums per looter (case-insensitive), sorts by value, counts NO DROP and unpriced', () => {
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR });
    expect(out.totals).toEqual([
      { looter: 'Aldenmar', items: 3, value_cp: 54250, nodrop_items: 1 },
      { looter: 'Brackwyn', items: 1, value_cp: 54000, nodrop_items: 1 },
      { looter: 'Corvale', items: 1, value_cp: 54000, nodrop_items: 1 },
    ]);
    expect(out.total_value_cp).toBe(54250 + 54000 + 54000);
    expect(out.priced_items).toBe(4);
    expect(out.unpriced_items).toBe(1);
  });

  it('counts only rows inside the window', () => {
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 1 * HOUR });
    expect(out.totals.map(t => t.looter).sort()).toEqual(['Aldenmar', 'Brackwyn']);
    expect(out.priced_items + out.unpriced_items).toBe(4);
  });
});

// ── _nightLootPanelBody: the window and the totals over a month of rows ─────────────────────────────────
describe('_nightLootPanelBody — window', () => {
  it('reads looted_items back as far as the window asks, and roll_sets stays 12h', async () => {
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: [], eqemu_items: [] } });
    await _nightLootPanelBody(sb, GUILD, NOW, 720);
    const lt = sb.calls.find(c => c.table === 'looted_items').qs;
    const roll = sb.calls.find(c => c.table === 'roll_sets').qs;
    expect(lt).toContain('looted_at=gte.' + encodeURIComponent(new Date(NOW - 720 * HOUR - 5 * MIN).toISOString()));
    expect(roll).toContain('started_at=gte.' + encodeURIComponent(new Date(NOW - 12 * HOUR).toISOString()));
  });

  it('an unrecognised window is the 12h it always was', async () => {
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: [], eqemu_items: [] } });
    const out = await _nightLootPanelBody(sb, GUILD, NOW, 99);
    expect(out.window_hours).toBe(12);
    expect(sb.calls.find(c => c.table === 'looted_items').qs)
      .toContain('looted_at=gte.' + encodeURIComponent(new Date(NOW - 12 * HOUR - 5 * MIN).toISOString()));
  });

  it('with no window argument (an old agent) it is the 12h panel, rows tagged with their value', async () => {
    const sb = makeCapFake({ tables: {
      roll_sets: [],
      looted_items: [lootRow('Aldenmar', 'Cloak of Flames', 10 * MIN), lootRow('Brackwyn', 'Cloak of Flames', 30 * HOUR)],
      eqemu_items: [itemRow(11621, 'Cloak of Flames', 54000)],
    } });
    const out = await _nightLootPanelBody(sb, GUILD, NOW);
    expect(out.window_hours).toBe(12);
    expect(out.loot_total).toBe(1);
    expect(out.loot).toEqual([{ looter: 'Aldenmar', item: 'Cloak of Flames', zone: 'The Overthere', at: iso(10 * MIN), value_cp: 54000, nodrop: true }]);
    expect(out.sessions).toEqual([]);
    expect(out.total_value_cp).toBe(54000);
  });
});

describe('_nightLootPanelBody — 30 days of loot', () => {
  // 2,500 rows (past the 1,000 cap and the 200 shown): 5 toons x 500 items, one priced item type each.
  const toons = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara'];
  const itemFor = (i) => 'Prize ' + i;      // Prize 0 .. Prize 4, worth (i+1) pp
  function month() {
    const looted = [];
    for (let n = 0; n < 2500; n++) looted.push(lootRow(toons[n % 5], itemFor(n % 5), (n + 1) * 15 * MIN));
    looted.push(lootRow('Zarrin', 'Nobody Sells This', 10 * MIN));
    return looted;
  }
  const items = toons.map((_, i) => itemRow(100 + i, itemFor(i), (i + 1) * 1000, i % 2 === 0));

  it('totals cover EVERY row in the window, not the 200 displayed', async () => {
    // 2,500 rows x 15 min = 26 days: all inside 30d.
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: month(), eqemu_items: items } });
    const out = await _nightLootPanelBody(sb, GUILD, NOW, 720);
    expect(out.loot).toHaveLength(200);
    expect(out.loot_total).toBe(2501);
    expect(out.totals.reduce((a, t) => a + t.items, 0)).toBe(2501);
    // 500 items each at (i+1) pp: Nyssara (i=4) 500 x 5pp = 2,500pp, Aldenmar 500 x 1pp = 500pp
    const by = Object.fromEntries(out.totals.map(t => [t.looter, t]));
    expect(by.Nyssara).toEqual({ looter: 'Nyssara', items: 500, value_cp: 2_500_000, nodrop_items: 500 });
    expect(by.Brackwyn.nodrop_items).toBe(0);
    expect(by.Aldenmar).toEqual({ looter: 'Aldenmar', items: 500, value_cp: 500_000, nodrop_items: 500 });
    expect(out.totals.map(t => t.looter).slice(0, 5)).toEqual(['Nyssara', 'Rethlan', 'Corvale', 'Brackwyn', 'Aldenmar']);
    expect(out.total_value_cp).toBe(500_000 * (1 + 2 + 3 + 4 + 5));
    // the list rows are the newest, each carrying its own value
    expect(out.loot[0].looter).toBe('Zarrin');
    expect(out.loot[0].value_cp).toBeNull();
    expect(out.loot[1].value_cp).toBe(((out.loot[1].item.slice(-1) | 0) + 1) * 1000);
    // the read really did walk past the first page
    expect(sb.calls.some(c => c.table === 'looted_items' && /offset=2000\b/.test(c.qs))).toBe(true);
  });

  it('a shorter window totals only what is inside it', async () => {
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: month(), eqemu_items: items } });
    const week = await _nightLootPanelBody(sb, GUILD, NOW, 168);      // 7 days = 672 rows of 15 min
    expect(week.totals.reduce((a, t) => a + t.items, 0)).toBe(week.loot_total);
    expect(week.loot_total).toBeLessThan(2501);
    expect(week.loot_total).toBeGreaterThan(600);
    expect(week.window_hours).toBe(168);
  });

  it('an item with no price is null on its row and counted unpriced, never zero', async () => {
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: month(), eqemu_items: items } });
    const out = await _nightLootPanelBody(sb, GUILD, NOW, 720);
    expect(out.unpriced_items).toBe(1);
    expect(out.priced_items).toBe(2500);
    expect(out.totals.find(t => t.looter === 'Zarrin')).toEqual({ looter: 'Zarrin', items: 1, value_cp: 0, nodrop_items: 0 });
  });

  it('a failed price lookup leaves the list up, every row unpriced, and says so', async () => {
    const sb = makeCapFake({ tables: { roll_sets: [], looted_items: month() }, missing: ['eqemu_items'] });
    const out = await _nightLootPanelBody(sb, GUILD, NOW, 168);
    expect(out.prices_partial).toBe(true);
    expect(out.loot.length).toBeGreaterThan(0);
    expect(out.loot.every(r => r.value_cp === null)).toBe(true);
    expect(out.priced_items).toBe(0);
  });
});

// ── the handler branch: ?hours= and the cache ───────────────────────────────────────────────────────────
const cacheBlock = sliceBlock(src, 'const _lootPanelCache = new Map();', '_lootPanelCache.delete(first); } }');
const branchBlock = sliceBlock(src, "if (key === 'night-loot') {", 'return res.end(out);\n    }');
function runBranch({ query = '', body }) {
  const { handle } = evalBlock(
    cacheBlock + '\nasync function handle(key, res, guildId, supabase, _nightLootPanelBody, url, require) {\n' + branchBlock + '\n}\n',
    ['handle'],
  );
  const calls = [];
  const fetchBody = async (_sb, _g, _now, hours) => { calls.push(hours); return body ? body(hours) : { loot_total: 0, loot: [], sessions: [], window_hours: hours, prices_partial: false }; };
  return {
    calls,
    get: async (q = query) => {
      const res = { status: null, body: null, writeHead(s) { res.status = s; }, end(b) { res.body = b; } };
      await handle('night-loot', res, GUILD, {}, fetchBody, new URL('http://localhost/api/agent/server-panel/night-loot' + q), require_);
      return JSON.parse(res.body);
    },
  };
}

describe('night-loot handler — ?hours=', () => {
  it('passes the clamped window through and labels the scope', async () => {
    const h = runBranch({});
    expect((await h.get('?hours=24')).scope).toBe('last 24h');
    expect((await h.get('?hours=168')).scope).toBe('last 7d');
    expect((await h.get('?hours=720')).scope).toBe('last 30d');
    expect(h.calls).toEqual([24, 168, 720]);
  });

  it('no hours, or a bad one, is the 12h an old agent always got', async () => {
    const h = runBranch({});
    expect((await h.get('')).scope).toBe('last 12h');
    expect((await h.get('?hours=banana')).scope).toBe('last 12h');
    expect((await h.get('?hours=100000')).scope).toBe('last 12h');
    expect(h.calls).toEqual([12]);      // the second and third are the same cache entry
  });

  it('each window has its own cache entry', async () => {
    const h = runBranch({});
    await h.get('?hours=24'); await h.get('?hours=24'); await h.get('?hours=720'); await h.get('');
    expect(h.calls).toEqual([24, 720, 12]);
  });

  it('does not cache a response whose prices failed — the next poll tries again', async () => {
    const h = runBranch({ body: (hours) => ({ loot_total: 0, loot: [], sessions: [], window_hours: hours, prices_partial: true }) });
    await h.get('?hours=24'); await h.get('?hours=24');
    expect(h.calls).toEqual([24, 24]);
  });

  it('longer windows are cached for longer than the 12h one', () => {
    expect(stripJs(branchBlock)).toMatch(/_lootCacheSet\(ck, out, hours > 12 \? 300_000 : 60_000\)/);
  });
});
