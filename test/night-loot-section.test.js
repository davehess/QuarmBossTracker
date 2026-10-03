// test/night-loot-section.test.js — the Loot tab's "Who looted what" section and
// the Rolls card's "looted by".
//
// The guild lead, 2026-10-03: "the loot tab on mimic should have the 'who looted
// what' section on there for items, as well as the rolls for loot." The bot's
// /api/server/night-loot (last 12h of looted_items + merged roll sessions) is the
// feed; this file runs the dashboard's REAL renderers over it:
//   • wpNightLootHtml — the section (absolute HH:MM, byte-stable, quiet when the
//     bot has no such key yet);
//   • wpNightLootSet / wpNightLootHost — state + its own stable host above #wpLootRolls;
//   • wpNightLootedBy + the real renderLootTab — "looted by" only when the looter
//     is not a winner already drawn on the card;
//   • the Loot IIFE's fetchNightLoot — 404 vs blip, 30s throttle, own poll gate.
//
// Names and item/zone strings are invented fixtures / strings the roll tests use.
//
// Run: npx vitest run test/night-loot-section.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// From the state var through the end of renderLootTab: every function under test.
const uiBlock = sliceBlock(dash, 'var _wpNightLoot = null;', '  morphInto(host, h);\n}');

// A just-big-enough document: #loot with appendChild/insertBefore, and ids.
function makeDoc() {
  const kids = [];
  const sec = {
    id: 'loot', parentNode: null,
    appendChild(n) { n.parentNode = sec; kids.push(n); },
    insertBefore(n, ref) { n.parentNode = sec; const i = kids.indexOf(ref); kids.splice(i < 0 ? kids.length : i, 0, n); },
  };
  return {
    kids,
    getElementById: (id) => (id === 'loot' ? sec : (kids.find(k => k.id === id) || null)),
    createElement: () => ({ id: '', parentNode: null, _wpLastHtml: null, innerHTML: '' }),
  };
}

function build() {
  const doc = makeDoc();
  const paints = [];
  globalThis.__nlDoc = doc;
  globalThis.__nlPaints = paints;
  const pre = `
    const document = globalThis.__nlDoc;
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function morphInto(el, html){ if(!el) return false; if (el._wpLastHtml === html) return false; el._wpLastHtml = html; el.innerHTML = html; globalThis.__nlPaints.push(el.id); return true; }
    function wpKeep(k){ return 'data-keep="' + esc(k) + '"'; }
    function _wpDeathrollHtml(){ return '<div>deathroll</div>'; }
  `;
  const api = evalBlock(pre + uiBlock + '\nfunction _peek(){ return _wpNightLoot; }',
    ['wpNightLootHtml', 'wpNightLootSet', 'wpNightLootHost', 'wpNightLootedBy', 'renderLootTab', 'wpRenderNightLoot', '_peek']);
  return { ...api, doc, paints, html: (id) => (doc.getElementById(id) || {}).innerHTML };
}

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);   // independent of the renderer's own padding
const ROW = (looter, item, at, zone = 'The Overthere') => ({ looter, item, zone, at });
const BODY = (loot, extra = {}) => ({ key: 'night-loot', scope: 'last 12h', loot_total: loot.length, loot, sessions: [], ...extra });

afterEach(() => { vi.useRealTimers(); });

describe('wpNightLootHtml — the section', () => {
  const { wpNightLootHtml } = build();

  it('draws time (absolute HH:MM), looter, item and zone, newest first as given', () => {
    const body = BODY([
      ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z'),
      ROW('Aldenmar', 'Velium Battlehammer', '2026-10-03T00:42:10Z', null),
    ]);
    const html = wpNightLootHtml(body);
    expect(html).toContain('Who looted what');
    expect(html).toContain('<td class="dim">' + hhmm('2026-10-03T01:07:30Z') + '</td><td class="name">Corvale</td><td>Cloak of Flames</td><td class="dim">The Overthere</td>');
    expect(html).toContain('<td class="name">Aldenmar</td><td>Velium Battlehammer</td><td class="dim">—</td>');
    expect(html.indexOf('Corvale')).toBeLessThan(html.indexOf('Aldenmar'));
    expect(html).not.toMatch(/\bago\b/);
  });

  it('only the looter cell is a name — item and zone cells never carry class="name"', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]));
    expect(html.match(/class="name"/g)).toHaveLength(1);
  });

  it('escapes what it was given', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak <b>of</b> Flames', '2026-10-03T01:07:30Z', 'Zone "X"')]));
    expect(html).toContain('Cloak &lt;b&gt;of&lt;/b&gt; Flames');
    expect(html).toContain('Zone &quot;X&quot;');
    expect(html).not.toContain('<b>of</b>');
  });

  it('puts a day heading where the date changes, so HH:MM across midnight is not ambiguous', () => {
    const a = new Date(2026, 9, 3, 23, 50).toISOString();
    const b = new Date(2026, 9, 4, 0, 10).toISOString();
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', b), ROW('Aldenmar', 'Cloak of Flames', a)]));
    expect(html.match(/<td colspan="4"/g)).toHaveLength(2);
  });

  it('says how many it is not showing when the bot capped the list', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')], { loot_total: 340 }));
    expect(html).toContain('Showing the newest 1 of 340.');
    expect(wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]))).not.toContain('Showing the newest');
  });

  it('is byte-stable: the same data is the same string whatever the clock says', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const body = BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]);
    vi.setSystemTime(new Date('2026-10-03T02:00:00Z'));
    const first = wpNightLootHtml(body);
    vi.setSystemTime(new Date('2026-10-03T09:30:00Z'));
    expect(wpNightLootHtml(body)).toBe(first);
  });

  it('emits no <details> (so there is nothing for wpKeep to lose) — and any that appear carry it', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]));
    expect(html).not.toMatch(/<details(?![^>]*data-keep)/);
  });

  it('is quiet in every state without a list', () => {
    expect(wpNightLootHtml(null)).toContain('Loading');
    expect(wpNightLootHtml({ missing: true })).toContain('Needs the bot update.');
    expect(wpNightLootHtml({ failed: true })).toContain('Cannot reach the server');
    expect(wpNightLootHtml(BODY([]))).toContain('No loot seen in the last 12 hours.');
    for (const s of [null, { missing: true }, { failed: true }, BODY([])]) expect(wpNightLootHtml(s)).not.toContain('<table');
  });

  it('skips a row whose time cannot be read rather than throwing', () => {
    const html = wpNightLootHtml(BODY([ROW('Corvale', 'Cloak of Flames', 'nope'), ROW('Aldenmar', 'Cloak of Flames', '2026-10-03T01:07:30Z')]));
    expect(html).toContain('Aldenmar');
    expect(html).not.toContain('Corvale');
  });
});

describe('wpNightLootSet — state and host', () => {
  it('a 404 reads as "needs the bot update"; any other first failure as a quiet error', () => {
    const a = build();
    a.wpNightLootSet({ missing: true });
    expect(a.html('wpNightLoot')).toContain('Needs the bot update.');
    const b = build();
    b.wpNightLootSet({ failed: true });
    expect(b.html('wpNightLoot')).toContain('Cannot reach the server');
  });

  it('a blip or a late 404 never wipes a list it already has', () => {
    const t = build();
    t.wpNightLootSet(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]));
    const good = t.html('wpNightLoot');
    t.wpNightLootSet({ failed: true });
    t.wpNightLootSet({ missing: true });
    t.wpNightLootSet(null);
    t.wpNightLootSet({ loot: 'not a list' });
    expect(t.html('wpNightLoot')).toBe(good);
  });

  it('a fresh list replaces the old one', () => {
    const t = build();
    t.wpNightLootSet(BODY([ROW('Corvale', 'Cloak of Flames', '2026-10-03T01:07:30Z')]));
    t.wpNightLootSet(BODY([ROW('Brackwyn', 'Velium Battlehammer', '2026-10-03T01:20:00Z')]));
    expect(t.html('wpNightLoot')).toContain('Brackwyn');
    expect(t.html('wpNightLoot')).not.toContain('Corvale');
  });

  it('mounts its own host once, above the rolls host, whichever got there first', () => {
    const rollsFirst = build();
    const rolls = rollsFirst.doc.createElement(); rolls.id = 'wpLootRolls';
    rollsFirst.doc.getElementById('loot').appendChild(rolls);
    rollsFirst.wpNightLootSet({ missing: true });
    rollsFirst.wpNightLootSet({ failed: true });
    expect(rollsFirst.doc.kids.map(k => k.id)).toEqual(['wpNightLoot', 'wpLootRolls']);

    const nightFirst = build();
    nightFirst.wpNightLootSet({ missing: true });
    const r2 = nightFirst.doc.createElement(); r2.id = 'wpLootRolls';
    nightFirst.doc.getElementById('loot').appendChild(r2);
    expect(nightFirst.doc.kids.map(k => k.id)).toEqual(['wpNightLoot', 'wpLootRolls']);
  });
});

describe('wpNightLootedBy — which local set, and who is NOT a winner', () => {
  const { wpNightLootedBy } = build();
  const T0 = Date.parse('2026-10-03T01:00:00Z');
  const rset = (over = {}) => ({ from: 0, to: 100, started_at_ms: T0, winners: [{ name: 'Corvale', value: 88 }], ...over });
  const sess = (over = {}) => ({ item: 'Cloak of Flames', from: 0, to: 100, started_at: new Date(T0 + 2000).toISOString(), looters: ['Aldenmar'], ...over });

  it('names a looter who is not the winner', () => {
    expect(wpNightLootedBy(rset(), [sess()])).toEqual(['Aldenmar']);
  });

  it('says nothing when the looter IS the winner drawn on the card (case-insensitive)', () => {
    expect(wpNightLootedBy(rset(), [sess({ looters: ['corvale'] })])).toEqual([]);
    expect(wpNightLootedBy(rset(), [sess({ looters: ['Corvale', 'Aldenmar'] })])).toEqual(['Aldenmar']);
  });

  it('matches on range AND start time (the bot merges one range within 10 minutes)', () => {
    expect(wpNightLootedBy(rset(), [sess({ to: 200 })])).toEqual([]);
    expect(wpNightLootedBy(rset(), [sess({ from: 1 })])).toEqual([]);
    expect(wpNightLootedBy(rset(), [sess({ started_at: new Date(T0 + 11 * 60_000).toISOString() })])).toEqual([]);
    expect(wpNightLootedBy(rset(), [sess({ started_at: new Date(T0 + 9 * 60_000).toISOString() })])).toEqual(['Aldenmar']);
  });

  it('takes the nearest start when the same range was rolled twice in the night', () => {
    const far = sess({ started_at: new Date(T0 - 8 * 60_000).toISOString(), looters: ['Brackwyn'] });
    const near = sess({ started_at: new Date(T0 + 30_000).toISOString(), looters: ['Rethlan'] });
    expect(wpNightLootedBy(rset(), [far, near])).toEqual(['Rethlan']);
  });

  it('is empty, never a throw, without sessions', () => {
    expect(wpNightLootedBy(rset(), undefined)).toEqual([]);
    expect(wpNightLootedBy(rset(), [])).toEqual([]);
    expect(wpNightLootedBy(null, [sess()])).toEqual([]);
  });

  it('an open set with no winner yet still shows who looted', () => {
    expect(wpNightLootedBy(rset({ winners: [] }), [sess()])).toEqual(['Aldenmar']);
  });
});

describe('the real renderLootTab', () => {
  const T0 = Date.parse('2026-10-03T01:00:00Z');
  const state = () => ({ rollSets: [
    { from: 0, to: 100, item: 'Cloak of Flames', qty: 1, players: 2, open: false, started_at_ms: T0, last_at_ms: T0 + 30_000,
      winners: [{ name: 'Corvale', value: 88 }], rolls: [{ name: 'Corvale', value: 88, at_ms: T0 }, { name: 'Rethlan', value: 41, at_ms: T0 + 5000 }] },
  ] });
  const session = (looters) => ({ item: 'Cloak of Flames', from: 0, to: 100, started_at: new Date(T0 + 1000).toISOString(), looters });

  it('shows "looted by" in the roll summary only when the looter differs from the winner', () => {
    const t = build();
    t.renderLootTab(state());
    expect(t.html('wpLootRolls')).not.toContain('looted by');

    t.wpNightLootSet(BODY([], { sessions: [session(['Aldenmar'])] }));
    t.renderLootTab(state());
    expect(t.html('wpLootRolls')).toMatch(/<summary>.*· 📦 looted by Aldenmar<\/span>.*<\/summary>/);

    const same = build();
    same.wpNightLootSet(BODY([], { sessions: [session(['Corvale'])] }));
    same.renderLootTab(state());
    expect(same.html('wpLootRolls')).not.toContain('looted by');
  });

  it('mounts the section above the rolls card and repaints nothing when nothing changed', () => {
    const t = build();
    t.renderLootTab(state());
    expect(t.doc.kids.map(k => k.id)).toEqual(['wpNightLoot', 'wpLootRolls']);
    const before = t.paints.length;
    t.renderLootTab(state());
    t.renderLootTab(state());
    expect(t.paints.length).toBe(before);   // byte-stable across polls
  });

  it('still keeps every <details> on wpKeep with the looted-by decoration in place', () => {
    const t = build();
    t.wpNightLootSet(BODY([], { sessions: [session(['Aldenmar'])] }));
    t.renderLootTab(state());
    expect(t.html('wpLootRolls')).toContain('<details data-keep="roll|' + T0 + '|100">');
    expect(t.html('wpLootRolls')).not.toMatch(/<details(?![^>]*data-keep)/);
  });
});

describe('the Loot IIFE fetch', () => {
  const fetchBlock = sliceBlock(dash, 'var lastNightLootAt = 0;', "catch (e) { wpNightLootSet({ failed:true }); }\n  }");
  function harness(respond) {
    const got = [];
    const calls = [];
    globalThis.__nlFetch = (url) => { calls.push(url); return respond(url); };
    globalThis.__nlSet = (j) => got.push(j);
    const { fetchNightLoot } = evalBlock(
      'const fetch = globalThis.__nlFetch; const wpNightLootSet = globalThis.__nlSet;\n' + fetchBlock,
      ['fetchNightLoot'],
    );
    const settle = () => new Promise(r => setImmediate(r));
    return { got, calls, fetchNightLoot, settle };
  }
  const resp = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: async () => body });

  it('asks the agent proxy for night-loot and hands the body over', async () => {
    const h = harness(() => resp(200, { loot: [], sessions: [] }));
    h.fetchNightLoot(); await h.settle();
    expect(h.calls).toEqual(['/api/server/night-loot']);
    expect(h.got).toEqual([{ loot: [], sessions: [] }]);
  });

  it('a 404 is "missing", a 5xx or a network failure is "failed" — never a throw', async () => {
    const a = harness(() => resp(404, {}));
    a.fetchNightLoot(); await a.settle();
    expect(a.got).toEqual([{ missing: true }]);
    const b = harness(() => resp(503, {}));
    b.fetchNightLoot(); await b.settle();
    expect(b.got).toEqual([{ failed: true }]);
    const c = harness(() => Promise.reject(new Error('offline')));
    c.fetchNightLoot(); await c.settle();
    expect(c.got).toEqual([{ failed: true }]);
    const d = harness(() => { throw new Error('sync boom'); });
    expect(() => d.fetchNightLoot()).not.toThrow();
    expect(d.got).toEqual([{ failed: true }]);
  });

  it('asks at most every 30 seconds (the bot caches 60)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
    const h = harness(() => resp(200, { loot: [] }));
    h.fetchNightLoot(); h.fetchNightLoot();
    vi.setSystemTime(new Date('2026-10-03T01:00:29Z')); h.fetchNightLoot();
    expect(h.calls).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-03T01:00:31Z')); h.fetchNightLoot();
    expect(h.calls).toHaveLength(2);
  });

  it('rides the bidding loop gate: only after wpLootPollWanted(), and outside the bidding chain', () => {
    const head = stripJs(sliceBlock(dash, 'function fetchServer(){', 'var who=pickChar();'));
    expect(head.indexOf('wpLootPollWanted()')).toBeGreaterThan(-1);
    expect(head.indexOf('fetchNightLoot();')).toBeGreaterThan(head.indexOf('wpLootPollWanted()'));
    const chain = stripJs(sliceBlock(dash, 'return Promise.all(jobs)', '.then(render);'));
    expect(chain).not.toContain('NightLoot');
  });
});
