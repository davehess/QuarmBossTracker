// test/loot-wishlist-columns.test.js — the wishlist carries the misses columns.
//
// "the wishlist on the loot section just needs to show the fields from the
// Recent misses, should say character, your last, last win, second place,
// planned" (Hitya, 2026-08-31).
//
// The two lists overlap almost entirely — anything inferred "from bid history"
// is by definition something you bid on and lost — so the figures are JOINED
// from the misses rows by item rather than fetched again. A prereg you have
// never bid on has no figures and must show dashes rather than borrow another
// row's numbers.
//
// ⚠ The hazard this introduces: the SAME item now renders a planned-bid input
// in BOTH tables. The old wiring found inputs by id prefix and derived the item
// from the id string, which would have matched one of the two and silently
// ignored the other. It now selects by class and reads data-item.
//
// Run: npx vitest run test/loot-wishlist-columns.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const src  = fs.readFileSync(DASH, 'utf8');

// The wishlist block, run for real.
const BLOCK = sliceBlock(src, '      var wlF = wl.filter(', '        h += "</table>";\n      }');

function render(wl, misses, { planned = {}, acct = 250 } = {}) {
  const prelude = `
    var h = "";
    var wl = ${JSON.stringify(wl)};
    var misses = ${JSON.stringify(misses)};
    var planned = ${JSON.stringify(planned)};
    var acctDkp = ${acct == null ? 'null' : `{ account_dkp: ${acct} }`};
    var dkp = null;
    var dkpCellShared = acctDkp ? String(acctDkp.account_dkp) : "—";
    var missByItem = {};
    for (var i = 0; i < misses.length; i++) missByItem[misses[i].item_id] = misses[i];
    function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
    function fmt(n){ return String(n); }
    function itemLink(n){ return "<a>" + esc(n) + "</a>"; }
    function eraTag(e){ return e ? "<i>" + esc(e) + "</i>" : ""; }
    function dismissBtn(id){ return "<span class=wpLootX data-item='" + esc(id) + "'>x</span>"; }
    function passEra(){ return true; }
    function notDismissed(){ return true; }
  `;
  const { html } = evalBlock(prelude + BLOCK + '\nfunction html(){ return h; }', ['html']);
  return html();
}

const headers = (h) => [...String(h).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
const cells = (h, row = 0) => {
  const tr = String(h).split('<tr>')[row + 2] || '';
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
};

const MISS = { item_id: 77, item_name: 'Bone Chill Shield', character: 'Utoh',
               my_last_bid: 4, last_winning_bid: 20, last_second_bid: 7, era: 'luclin' };

describe('the wishlist table', () => {
  it('has the same columns as RECENT MISSES', () => {
    const h = render([{ item_id: 77, item_name: 'Bone Chill Shield', source: 'bid_history' }], [MISS]);
    expect(headers(h)).toEqual(['Item', 'Char', 'Your last', 'Last win', '2nd place', 'Planned', 'DKP', '']);
  });

  it('fills the figures from the matching miss row', () => {
    const h = render([{ item_id: 77, item_name: 'Bone Chill Shield', source: 'bid_history' }], [MISS]);
    const c = cells(h);
    expect(c[1]).toBe('Utoh');   // char
    expect(c[2]).toBe('4');      // your last
    expect(c[3]).toBe('20');     // last win
    expect(c[4]).toBe('7');      // 2nd place
  });

  // ⚠ The honesty case: a prereg you never bid on must not borrow figures.
  it('shows dashes for a prereg with no bid history', () => {
    const h = render([{ item_id: 99, item_name: 'Ring of Rage', source: 'prereg' }], [MISS]);
    const c = cells(h);
    expect(c[1]).toBe('—');
    expect(c[2]).toBe('—');
    expect(c[3]).toBe('—');
    expect(c[4]).toBe('—');
  });

  it('keeps the prereg / bid-history provenance mark', () => {
    const pre = render([{ item_id: 99, item_name: 'Ring of Rage', source: 'prereg' }], []);
    expect(pre).toContain('preregistered');
    const inf = render([{ item_id: 77, item_name: 'Bone Chill Shield', source: 'bid_history' }], [MISS]);
    expect(inf).toContain('inferred from your bid history');
  });

  it('carries the planned value and the dismiss control', () => {
    const h = render([{ item_id: 77, item_name: 'Bone Chill Shield', source: 'bid_history' }],
                     [MISS], { planned: { 77: 12 } });
    expect(h).toMatch(/value='12'/);
    expect(h).toContain('wpLootX');
  });

  it('shows the account DKP figure, same as misses', () => {
    const h = render([{ item_id: 77, item_name: 'X', source: 'bid_history' }], [MISS], { acct: 143 });
    expect(cells(h)[6]).toBe('143');
  });
});

describe('the duplicate-input hazard', () => {
  const clean = stripJs(src);

  it('wires planned inputs by class, not by id prefix', () => {
    // An id-prefix scan would match one of the two controls for an item that
    // appears in BOTH tables and silently ignore the other.
    expect(clean).toContain('querySelectorAll("input.wpPlanIn")');
    expect(clean).not.toContain('querySelectorAll("input[id^=wpPlan_]")');
  });

  it('derives the item from data-item rather than slicing the id', () => {
    expect(clean).toContain('inp.getAttribute("data-item")');
    expect(clean).not.toContain('inp.id.substring("wpPlan_".length)');
  });

  it('gives the two tables DISTINCT input ids for the same item', () => {
    const h = render([{ item_id: 77, item_name: 'X', source: 'bid_history' }], [MISS]);
    expect(h).toContain('id=wpPlanW_77');          // wishlist
    expect(clean).toContain('id=wpPlan_"+m.item_id');  // misses
  });

  it('both carry the shared class so neither is left unwired', () => {
    const h = render([{ item_id: 77, item_name: 'X', source: 'bid_history' }], [MISS]);
    expect(h).toContain('class=wpPlanIn');
    expect(clean).toMatch(/id=wpPlan_"\+m\.item_id\+" class=wpPlanIn/);
  });
});
