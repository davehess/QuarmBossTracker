// test/dashboard-loot-value.test.js — the Loot tab's "Who looted what" card, with values and a time window.
//
// The guild lead, 2026-10-08: "quantify the loot tab with how much each item is worth and say how much each
// toon has looted equivalently in platinum from what you've seen, and time bound it."
//
// Runs the dashboard's REAL renderers (sliced out of dashboard.html) over a fake bot body:
//   • wpNightLootHtml — the Value column, the ND tag, the "Totals by character" table, the window title;
//   • wpFmtPP — copper to platinum;
//   • wpNightLootWindow + the Loot IIFE's fetchNightLoot — the chips, the remembered pick, ?hours=.
// A body from a bot that predates values (no `totals`) must render exactly as it did.
//
// Names and items are invented fixtures.
//
// Run: npx vitest run test/dashboard-loot-value.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const uiBlock = sliceBlock(dash, 'var _wpNightLoot = null;', '  morphInto(host, h);\n}');
const fetchBlock = sliceBlock(dash, 'var lastNightLootAt = 0;', "catch (e) { wpNightLootSet({ failed:true }); }\n  }");

function build({ saved = null, storageThrows = false } = {}) {
  const store = {};
  if (saved != null) store['wp:nightLootHours'] = String(saved);
  globalThis.__lvStore = store;
  globalThis.__lvThrows = storageThrows;
  globalThis.__lvDoc = { getElementById: () => null };
  globalThis.__lvRefetch = [];
  const pre = `
    const document = globalThis.__lvDoc;
    const localStorage = { getItem: (k) => { if (globalThis.__lvThrows) throw new Error('blocked'); return k in globalThis.__lvStore ? globalThis.__lvStore[k] : null; },
                           setItem: (k, v) => { if (globalThis.__lvThrows) throw new Error('blocked'); globalThis.__lvStore[k] = v; } };
    const wpNightLootRefetch = (force) => globalThis.__lvRefetch.push(force);
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function morphInto(el, html){ if(!el) return false; el.innerHTML = html; return true; }
    function wpKeep(k){ return 'data-keep="' + esc(k) + '"'; }
    function _wpDeathrollHtml(){ return ''; }
  `;
  const api = evalBlock(pre + uiBlock + '\nfunction _hours(v){ if (v !== undefined) _wpNightHours = v; return _wpNightHours; }',
    ['wpNightLootHtml', 'wpFmtPP', 'wpNightLootWindow', 'wpNightLootSet', '_hours']);
  return { ...api, store, refetches: globalThis.__lvRefetch };
}

const AT = '2026-10-08T01:07:30Z';
const ROW = (looter, item, value_cp, nodrop, zone = 'The Overthere') => ({ looter, item, zone, at: AT, value_cp, nodrop });
const OLD = (loot) => ({ key: 'night-loot', scope: 'last 12h', loot_total: loot.length, loot: loot.map(({ looter, item, zone, at }) => ({ looter, item, zone, at })), sessions: [] });
const BODY = (loot, extra = {}) => ({
  key: 'night-loot', scope: 'last 12h', loot_total: loot.length, loot, sessions: [], window_hours: 12,
  totals: [], total_value_cp: 0, priced_items: loot.length, unpriced_items: 0, ...extra,
});
const CLOAK = ROW('Corvale', 'Cloak of Flames', 54000, true);

describe('wpFmtPP — copper to platinum', () => {
  const { wpFmtPP } = build();
  it('platinum with up to one decimal, grouped', () => {
    expect(wpFmtPP(54000)).toBe('54');
    expect(wpFmtPP(1500)).toBe('1.5');
    expect(wpFmtPP(250)).toBe('0.3');
    expect(wpFmtPP(1234567)).toBe('1,234.6');
    expect(wpFmtPP(0)).toBe('0');
  });
  it('a few copper is "<0.1", and no price is a dash', () => {
    expect(wpFmtPP(25)).toBe('&lt;0.1');
    expect(wpFmtPP(null)).toBe('—');
    expect(wpFmtPP(undefined)).toBe('—');
  });
});

describe('wpNightLootHtml — values', () => {
  const { wpNightLootHtml } = build();

  it('adds a Value (pp) column: platinum per row, a dash when the item has no price', () => {
    const html = wpNightLootHtml(BODY([CLOAK, ROW('Aldenmar', 'Mystery Drop', null, null)]));
    expect(html).toContain('<th>Value (pp)</th>');
    expect(html).toContain('<td class="num">54</td>');
    expect(html).toContain('<td>Mystery Drop</td><td class="dim">The Overthere</td><td class="num">—</td>');
  });

  it('marks NO DROP rows with a small dim ND tag, and only those', () => {
    const html = wpNightLootHtml(BODY([CLOAK, ROW('Aldenmar', 'Spider Silk', 250, false)]));
    expect(html.match(/>ND</g)).toHaveLength(1);
    expect(html).toContain('Cloak of Flames <span class="dim" style="font-size:10px" title="NO DROP');
    expect(html).toContain('<td>Spider Silk</td>');
  });

  it('colspan follows the column count so the day heading spans the row', () => {
    expect(wpNightLootHtml(BODY([CLOAK]))).toContain('<td colspan="5"');
  });

  it('only character cells carry class="name" (list looters + totals characters)', () => {
    const html = wpNightLootHtml(BODY([CLOAK], { totals: [{ looter: 'Corvale', items: 1, value_cp: 54000, nodrop_items: 1 }] }));
    expect(html.match(/class="name"/g)).toHaveLength(2);
    expect(html).not.toMatch(/class="name"[^>]*>(Cloak|54|The Over)/);
  });

  it('escapes what it was given', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak <i>x</i>', 100, true)], { totals: [{ looter: 'Cor<b>vale', items: 1, value_cp: 100, nodrop_items: 0 }] }));
    expect(html).not.toContain('<i>x</i>');
    expect(html).not.toContain('Cor<b>');
  });
});

describe('wpNightLootHtml — totals by character', () => {
  const { wpNightLootHtml } = build();
  const totals = [
    { looter: 'Brackwyn', items: 3, value_cp: 1500, nodrop_items: 0 },
    { looter: 'Aldenmar', items: 5, value_cp: 123000, nodrop_items: 4 },
    { looter: 'Corvale', items: 1, value_cp: 54000, nodrop_items: 1 },
  ];
  const body = BODY([CLOAK], { totals, total_value_cp: 178500, priced_items: 9, unpriced_items: 0 });

  it('has Character | Items | Vendor value (pp) | NO DROP, sorted by value however the body arrives', () => {
    const html = wpNightLootHtml(body);
    expect(html).toContain('<th>Character</th><th>Items</th><th>Vendor value (pp)</th><th>NO DROP</th>');
    const t = html.slice(html.indexOf('Totals by character'));
    expect(t.indexOf('Aldenmar')).toBeLessThan(t.indexOf('Corvale'));
    expect(t.indexOf('Corvale')).toBeLessThan(t.indexOf('Brackwyn'));
    expect(html).toContain('<td class="name">Aldenmar</td><td class="num">5</td><td class="num">123</td><td class="num dim">4</td>');
    expect(html).toContain('178.5 pp across 9 items');
  });

  it('sits above the list and carries the footnote', () => {
    const html = wpNightLootHtml(body);
    expect(html.indexOf('Totals by character')).toBeLessThan(html.indexOf('<th>Time</th>'));
    expect(html).toContain('Value = the item&rsquo;s base merchant value from the item database (what EverQuest prices it at), not bazaar prices. NO DROP items can only be sold to a merchant.');
  });

  it('says how many items are not in the item database, only when there are some', () => {
    expect(wpNightLootHtml(body)).not.toContain('not in the item database');
    expect(wpNightLootHtml({ ...body, unpriced_items: 2 })).toContain('2 items not in the item database count as 0.');
    expect(wpNightLootHtml({ ...body, unpriced_items: 1 })).toContain('1 item not in the item database count as 0.');
  });

  it('is time bound: the table names its window', () => {
    expect(wpNightLootHtml({ ...body, window_hours: 720 })).toContain('<b>Totals by character</b> <span class="dim">· last 30 days');
  });

  it('is byte-stable: the same body is the same string', () => {
    expect(wpNightLootHtml(body)).toBe(wpNightLootHtml(JSON.parse(JSON.stringify(body))));
  });
});

describe('wpNightLootHtml — the window', () => {
  const { wpNightLootHtml, _hours } = build();

  it('titles the card with the window the data covers, and says so when empty', () => {
    expect(wpNightLootHtml(BODY([CLOAK]))).toContain('· last 12 hours</span>');
    expect(wpNightLootHtml(BODY([CLOAK], { window_hours: 168 }))).toContain('· last 7 days</span>');
    expect(wpNightLootHtml(BODY([], { window_hours: 24 }))).toContain('No loot seen in the last 24 hours.');
  });

  it('chips 12h · 24h · 7d · 30d, the chosen one marked, each carrying its hours', () => {
    _hours(24);
    const html = wpNightLootHtml(BODY([CLOAK]));
    expect(html).toContain('<button type="button" class="wp-btn pri" data-v="24" onclick="wpNightLootWindow(this)">24h</button>');
    for (const [v, l] of [[12, '12h'], [168, '7d'], [720, '30d']]) {
      expect(html).toContain('<button type="button" class="wp-btn" data-v="' + v + '" onclick="wpNightLootWindow(this)">' + l + '</button>');
    }
    expect(html.match(/class="wp-btn pri"/g)).toHaveLength(1);
    _hours(12);
  });

  it('the chips stay when the list is loading, empty or unreachable, so the viewer can change window', () => {
    for (const s of [null, { failed: true }, BODY([])]) expect(wpNightLootHtml(s)).toContain('data-v="720"');
    expect(wpNightLootHtml({ missing: true })).not.toContain('data-v="720"');
  });

  it('says it is still showing the old window when the server answered for another', () => {
    _hours(720);
    expect(wpNightLootHtml(BODY([CLOAK]))).toContain('Still showing the last 12 hours — the server has not answered for 30 days yet.');
    expect(wpNightLootHtml(BODY([CLOAK], { window_hours: 720 }))).not.toContain('Still showing');
    _hours(12);
  });
});

describe('wpNightLootHtml — a bot that predates values', () => {
  const { wpNightLootHtml } = build();
  it('renders as before: four columns, no totals, no ND, no Value', () => {
    const html = wpNightLootHtml(OLD([{ looter: 'Corvale', item: 'Cloak of Flames', zone: 'The Overthere', at: AT }]));
    expect(html).toContain('<tr><th>Time</th><th>Looter</th><th>Item</th><th>Zone</th></tr>');
    expect(html).toContain('<td>Cloak of Flames</td><td class="dim">The Overthere</td></tr>');
    expect(html).toContain('<td colspan="4"');
    expect(html).not.toMatch(/Value|Totals by character|>ND</);
    expect(html).toContain('· last 12 hours');
  });
});

describe('the window chips — pick, remember, ask', () => {
  const chip = (v) => ({ getAttribute: (k) => (k === 'data-v' ? String(v) : null) });

  it('a click selects the window, remembers it and asks the bot now', () => {
    const t = build();
    t.wpNightLootWindow(chip(168));
    expect(t._hours()).toBe(168);
    expect(t.store['wp:nightLootHours']).toBe('168');
    expect(t.refetches).toEqual([true]);
  });

  it('ignores a value that is not a window, and a click on the one already chosen', () => {
    const t = build();
    t.wpNightLootWindow(chip(999)); t.wpNightLootWindow(chip('abc')); t.wpNightLootWindow(chip(12));
    expect(t._hours()).toBe(12);
    expect(t.refetches).toEqual([]);
    expect(t.store['wp:nightLootHours']).toBeUndefined();
  });

  it('opens on the remembered pick; a bad or unreadable store opens on 12h and the click still works', () => {
    expect(build({ saved: 720 })._hours()).toBe(720);
    expect(build({ saved: 5 })._hours()).toBe(12);
    expect(build({ saved: 'junk' })._hours()).toBe(12);
    const blocked = build({ storageThrows: true });
    expect(blocked._hours()).toBe(12);
    expect(() => blocked.wpNightLootWindow(chip(24))).not.toThrow();
    expect(blocked._hours()).toBe(24);
  });
});

describe('fetchNightLoot — ?hours=', () => {
  function harness(initialHours, respond) {
    const calls = [], got = [];
    globalThis.__lvFetch = (url) => { calls.push(url); return respond(url); };
    globalThis.__lvSet = (j) => got.push(j);
    const api = evalBlock(
      'const fetch = globalThis.__lvFetch; const wpNightLootSet = globalThis.__lvSet; let _wpNightHours = ' + initialHours + ';\n' + fetchBlock
      + '\nfunction _go(v){ _wpNightHours = v; }',
      ['fetchNightLoot', '_go'],
    );
    return { calls, got, ...api, settle: () => new Promise(r => setImmediate(r)) };
  }
  const ok = (body) => Promise.resolve({ status: 200, ok: true, json: async () => body });

  it('12h sends no query (the request an old bot expects); the others send hours', async () => {
    for (const [hrs, url] of [[12, '/api/server/night-loot'], [24, '/api/server/night-loot?hours=24'], [168, '/api/server/night-loot?hours=168'], [720, '/api/server/night-loot?hours=720']]) {
      const h = harness(hrs, () => ok({ loot: [] }));
      h.fetchNightLoot(); await h.settle();
      expect(h.calls).toEqual([url]);
    }
  });

  it('a click (force) skips the 30s throttle; a poll does not', async () => {
    const h = harness(24, () => ok({ loot: [] }));
    h.fetchNightLoot(); h.fetchNightLoot();
    expect(h.calls).toHaveLength(1);
    h.fetchNightLoot(true);
    expect(h.calls).toHaveLength(2);
  });

  it('drops a reply for a window the viewer has already left', async () => {
    let release;
    const h = harness(720, () => new Promise(r => { release = () => r({ status: 200, ok: true, json: async () => ({ loot: [], window_hours: 720 }) }); }));
    h.fetchNightLoot();
    h._go(12);                      // the viewer clicked 12h while the 30d read was in flight
    release(); await h.settle();
    expect(h.got).toEqual([]);
  });

  it('the agent passthrough forwards the query string untouched', () => {
    const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
    const proxy = stripJs(sliceBlock(agent, "req.url.startsWith('/api/server/')) {\n        const opts = _uploadOpts;", 'upstream.end();'));
    expect(proxy).toMatch(/const tail = req\.url\.substring\('\/api\/server\/'\.length\)/);
    expect(proxy).toMatch(/path: u\.pathname \+ \(u\.search \|\| ''\)/);
  });
});
