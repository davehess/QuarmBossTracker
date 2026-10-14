// test/target-info-item-links.test.js — FB-73, Target Info's Loot tab. A member: "Mouse over on the
// dropped items should show the item's card, and clicking on it should copy the item paste. put a
// pqdi link next to it." Runs mobinfo.html's real helpers and renderLoot on a stub DOM, and checks
// the click / hover wiring and the agent's /api/item-card relay.
//
// The paste format is the one Quarm itself writes: 0x12, the item id as 7 DECIMAL digits, the
// name, 0x12, no space. Evidence: the relay once showed "0022194A Lucid Shard" (A Lucid Shard is
// item 22194), and four decoded chat links (Ragebringer 11057, Primal Velium War Lance 27325,
// Fedora Secundae 29452, Crown of Narandi 1746) each came out as the first four digits of their
// real id read as hex.
//
// Run: npx vitest run test/target-info-item-links.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, AGENT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const agent = readSource(AGENT_INDEX);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HELPERS = sliceBlock(html, '  var ITEM_LINK_ID_DIGITS','  var _tipId = null, _tipName = \'\', _tipBtn = null, _tipEl = null;');
const LOOT_FNS = sliceBlock(html, '  function lootTier(p){', '  function fmtPct(p){ if (p == null) return \'?\'; if (p >= 99.95) return \'100%\'; return p.toFixed(p < 10 ? 1 : 0) + \'%\'; }');
const RENDER_LOOT = sliceBlock(html, '  function renderLoot(mob, mi){', '    return \'<div class="loot">\' + rows + \'</div>\';\n  }');
const TIP_FNS = sliceBlock(html, '  function _loadItemCard(id){', '  function _itemTipHide(){\n    _tipId = null; _tipBtn = null;\n    if (_tipEl) _tipEl.style.display = \'none\';\n  }');

// The helpers alone (no DOM, no fetch).
function helpers() {
  // eslint-disable-next-line no-new-func
  return new Function(HELPERS + '\nreturn { itemPaste, itemPqdi };')();
}

// renderLoot with the real lootTier / fmtPct / itemPqdi.
function loot() {
  // eslint-disable-next-line no-new-func
  return new Function('esc', LOOT_FNS + '\n' + HELPERS + '\n' + RENDER_LOOT + '\nreturn { renderLoot };')(esc);
}

// The hover card with a stub DOM and a counting fetch.
function tip(answerFor) {
  const calls = [];
  const el = { style: {}, id: '', innerHTML: '', offsetWidth: 230, offsetHeight: 80 };
  const document = { createElement: () => el, body: { appendChild: () => {} } };
  const window = { innerHeight: 400, innerWidth: 300 };
  const fetchStub = (url) => {
    calls.push(url);
    const id = Number(new URL(url).searchParams.get('id'));
    return Promise.resolve({ json: () => Promise.resolve(answerFor(id, calls.filter((c) => c === url).length)) });
  };
  const src = HELPERS + '\nvar _tipId = null, _tipName = \'\', _tipBtn = null, _tipEl = null;\n' + TIP_FNS
    + '\nreturn { _itemTipShow, _itemTipHide, getTip: function(){ return _tipId; } };';
  // eslint-disable-next-line no-new-func
  const api = new Function('esc', 'PORT', 'document', 'window', 'fetch', src)(esc, 7779, document, window, fetchStub);
  const btn = (id, name) => ({
    getAttribute: (k) => (k === 'data-iid' ? String(id) : k === 'data-iname' ? name : null),
    getBoundingClientRect: () => ({ top: 100, bottom: 112, left: 20 }),
  });
  return { api, el, calls, btn };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the item paste (what clicking a dropped item copies)', () => {
  it('is 0x12, the id as 7 decimal digits, the name, 0x12 — no space before the name', () => {
    const { itemPaste } = helpers();
    expect(itemPaste(21874, 'Blood Runed Battle Wand')).toBe('\x120021874Blood Runed Battle Wand\x12');
    expect(itemPaste(1746, 'Crown of Narandi')).toBe('\x120001746Crown of Narandi\x12');
    expect(itemPaste(11057, 'Ragebringer')).toBe('\x120011057Ragebringer\x12');
  });

  it('matches the string the relay was seen to garble once the delimiters are stripped', () => {
    const { itemPaste } = helpers();
    expect(itemPaste(22194, 'A Lucid Shard').replace(/\x12/g, '')).toBe('0022194A Lucid Shard');
  });

  it('is empty for an id that is not an item, and a name cannot smuggle in a delimiter', () => {
    const { itemPaste } = helpers();
    expect(itemPaste(0, 'X')).toBe('');
    expect(itemPaste(null, 'X')).toBe('');
    expect(itemPaste('abc', 'X')).toBe('');
    expect(itemPaste(5, '')).toBe('');
    expect(itemPaste(21874, 'Blood\x12 Runed')).toBe('\x120021874Blood Runed\x12');
  });
});

describe('the PQDI link', () => {
  it('is the www. host (bare pqdi.cc resets the connection) and the item id', () => {
    const { itemPqdi } = helpers();
    expect(itemPqdi(21874)).toBe('https://www.pqdi.cc/item/21874');
    expect(itemPqdi(0)).toBe('');
  });
});

describe('the Loot tab rows', () => {
  const MOB = { loot: [
    { id: 21874, name: 'Blood Runed Battle Wand', pct: 12, lore: false, seen: 0 },
    { name: 'Mystery Drop', pct: 3 },
  ] };

  it('gives an item with an id a copy button (a real button, so the hover handshake arms) and a PQDI link', () => {
    const out = loot().renderLoot(MOB, null);
    expect(out).toContain('<button type="button" class="nm inm" data-iid="21874" data-iname="Blood Runed Battle Wand"');
    expect(out).toContain('<a class="pqdi" data-pqdi="https://www.pqdi.cc/item/21874"');
  });

  it('leaves an item with no id as the plain name it was', () => {
    const out = loot().renderLoot(MOB, null);
    expect(out).toContain('<span class="nm">Mystery Drop</span>');
    expect(out.match(/class="nm inm"/g)).toHaveLength(1);
  });

  it('renders without asking for any card', () => {
    // A fetch the render could reach would be a ReferenceError here: the sandbox has none.
    expect(() => loot().renderLoot(MOB, null)).not.toThrow();
  });
});

describe('the hover card', () => {
  const CARD = { id: 21874, name: 'Blood Runed Battle Wand', flags: 'MAGIC ITEM · NO DROP', lines: ['Slot: PRIMARY', 'Damage: 9   Delay: 24'] };

  it('fetches on hover, paints the card, and does not fetch that item again', async () => {
    const t = tip(() => ({ card: CARD }));
    t.api._itemTipShow(t.btn(21874, 'Blood Runed Battle Wand'));
    expect(t.el.innerHTML).toContain('loading item card');
    await settle(); await settle();
    expect(t.calls).toEqual(['http://127.0.0.1:7779/api/item-card?id=21874']);
    expect(t.el.innerHTML).toContain('MAGIC ITEM · NO DROP');
    expect(t.el.innerHTML).toContain('Slot: PRIMARY');
    t.api._itemTipHide();
    t.api._itemTipShow(t.btn(21874, 'Blood Runed Battle Wand'));
    expect(t.el.innerHTML).toContain('Slot: PRIMARY');
    expect(t.calls).toHaveLength(1);
  });

  it('keeps a card it has for good, but asks again about a miss after a minute', async () => {
    vi.useFakeTimers();
    try {
      const t = tip((id) => (id === 1 ? { card: CARD } : { card: null }));
      t.api._itemTipShow(t.btn(1, 'Has A Card')); t.api._itemTipShow(t.btn(2, 'No Card'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      t.api._itemTipShow(t.btn(1, 'Has A Card')); t.api._itemTipShow(t.btn(2, 'No Card'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.calls.filter((u) => u.endsWith('id=1'))).toHaveLength(1);
      expect(t.calls.filter((u) => u.endsWith('id=2'))).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps asking while the agent is still loading it, then shows what came', async () => {
    vi.useFakeTimers();
    try {
      const t = tip((id, n) => (n < 2 ? { card: null, loading: true } : { card: CARD }));
      t.api._itemTipShow(t.btn(21874, 'Blood Runed Battle Wand'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.calls).toHaveLength(1);
      expect(t.el.innerHTML).toContain('loading item card');
      await vi.advanceTimersByTimeAsync(700);
      expect(t.calls).toHaveLength(2);
      expect(t.el.innerHTML).toContain('Slot: PRIMARY');
    } finally { vi.useRealTimers(); }
  });

  it('says so when there is no card, and stays inside the window', async () => {
    const t = tip(() => ({ card: null }));
    t.api._itemTipShow(t.btn(21874, 'Blood Runed Battle Wand'));
    await settle(); await settle();
    expect(t.el.innerHTML).toContain('no card for this item');
    expect(t.el.style.top).toBe('114px');          // below the name
    expect(t.el.style.left).toBe('20px');
  });

  it('opens above the name when the window ends first', async () => {
    const t = tip(() => ({ card: CARD }));
    const b = t.btn(5, 'X');
    b.getBoundingClientRect = () => ({ top: 350, bottom: 362, left: 290 });
    t.api._itemTipShow(b);
    expect(t.el.style.top).toBe('268px');
    expect(t.el.style.left).toBe('66px');           // 300 - 230 - 4
  });

  it('hides on mouse-out', () => {
    const t = tip(() => ({ card: CARD }));
    t.api._itemTipShow(t.btn(21874, 'Blood Runed Battle Wand'));
    expect(t.el.style.display).toBe('block');
    t.api._itemTipHide();
    expect(t.el.style.display).toBe('none');
    expect(t.api.getTip()).toBe(null);
  });
});

describe('the wiring', () => {
  const src = stripJs(html);
  const listener = sliceBlock(src, "bodyEl.addEventListener('click', function(ev){", "bodyEl.addEventListener('mouseout'");

  it('a click on the name copies the paste through the same copy path the /say chips use', () => {
    expect(listener).toMatch(/t\.closest\('\.inm'\)/);
    expect(listener).toMatch(/itemPaste\(ib\.getAttribute\('data-iid'\), ib\.getAttribute\('data-iname'\)\)/);
    expect(listener).toMatch(/_copyText\(paste\)/);
    expect(listener).toMatch(/_copyHoldUntil = Date\.now\(\) \+ 1200/);
  });

  it('PQDI opens through the open-external path, never a raw window.open', () => {
    expect(listener).toMatch(/window\.mimic\.openExternal\(url\)/);
    expect(src).not.toMatch(/window\.open\(/);
  });

  it('hover handshake covers the name and the PQDI link, and the card follows the name', () => {
    const hover = sliceBlock(src, "bodyEl.addEventListener('mouseover'", '\n  [tabStatsBtn');
    expect((hover.match(/closest\('\.pqdi, \.inm, /g) || []).length).toBe(2);
    expect(hover).toMatch(/_itemTipShow\(a\)/);
    expect(hover).toMatch(/_itemTipHide\(\)/);
  });

  it('a repaint takes the card down with the button it hung off', () => {
    expect(src).toMatch(/_itemTipHide\(\);[^\n]*\n\s*bodyEl\.innerHTML = html;/);
  });
});

describe('the agent relay', () => {
  const code = stripJs(agent);
  const route = sliceBlock(code, "req.url.startsWith('/api/item-card')", "'application/json' });\n        return res.end(JSON.stringify(hit ? { card: hit.card } : { card: null, loading: true }));");
  const fetcher = sliceBlock(code, 'function fetchItemCard(itemId) {', '  } catch { _itemCardInflight.delete(itemId); }\n}');

  it('serves a card by item id, 400 without one, and says loading rather than pinning a miss', () => {
    expect(route).toMatch(/Number\.isInteger\(itemId\) && itemId > 0|!Number\.isInteger\(itemId\) \|\| itemId <= 0/);
    expect(route).toMatch(/writeHead\(400/);
    expect(route).toMatch(/fetchItemCard\(itemId\)/);
  });

  it('asks the bot for it with the agent token, and an older bot (a 404) is remembered as no card', () => {
    expect(fetcher).toMatch(/replace\(\/\\\/encounter\(\\\?\.\*\)\?\$\/, '\/item-card'\)/);
    expect(fetcher).toMatch(/'Authorization': 'Bearer ' \+ opts\.token/);
    expect(fetcher).toMatch(/res\.statusCode !== 200\) return settle\(null\)/);
    expect(fetcher).toMatch(/10 \* 60 \* 1000/);
  });
});
