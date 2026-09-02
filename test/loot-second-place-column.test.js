// test/loot-second-place-column.test.js — "Second place should show up as well
// in the bidding area." (Hitya, 2026-08-30)
//
// Second place was already derived server-side (_lootItemSummary → runner_up)
// and already had a real column in RECENT MISSES — but in the bidding area it
// was a 10px dim sub-line tucked INSIDE the "Last win" cell, which is why it
// read as missing. It now gets the same column, with the same header, as the
// misses table, so the two tables read alike.
//
// BEHAVIOURAL: the auctions-table block is sliced out of the authored
// dashboard.html and RUN against stub bindings, so the comment above the change
// cannot satisfy these assertions (CLAUDE.md, "comments satisfy text
// assertions").
//
// Run: npx vitest run test/loot-second-place-column.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const src  = fs.readFileSync(DASH, 'utf8');

// The auctions table, from the merge that feeds it through the close of the
// if/else it lives in — the closing brace is part of the slice so the block
// evals as balanced source.
const TABLE = sliceBlock(src, '    var rows = mergedRows();', '      h += "</table>";\n    }');

const EM_DASH = '—';

function paint(rows, itemHist = {}, { authed = true, char = 'Rockin' } = {}) {
  const prelude = `
    var h = "";
    var ticks = {};
    var cfg = { authed: ${authed} };
    var char = ${JSON.stringify(char)};
    var itemHist = ${JSON.stringify(itemHist)};
    var __rows = ${JSON.stringify(rows)};
    function mergedRows(){ return __rows; }
    function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
    function fmt(n){ return String(n); }
    function endLabel(ms){ return "soon"; }
    function prefillFor(){ return null; }
  `;
  const { html } = evalBlock(prelude + TABLE + '\nfunction html(){ return h; }', ['html']);
  return html();
}

// The <td>s of the first painted row, in column order.
function cells(html) {
  const tr = String(html).split('<tr>')[2] || '';   // [0] pre-table, [1] header
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
}
const headers = (html) => [...String(html).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);

const ROW = { key: 'a1', name: 'Thorny Chain Sleeves', item_id: 77, auction_id: 1,
              wishlisted: false, top_bid: null, ends: null, biddable: true,
              pending: false, quantity: 1, copyIx: 0, copyN: 0 };

describe('bidding area — second place has its own column', () => {
  it('the header sits between Last win and Bid, matching the misses table', () => {
    const h = paint([ROW], { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: 5 } });
    expect(headers(h)).toEqual(['Item', 'Ends', 'Last win', '2nd place', 'Bid']);
  });

  it('renders the runner-up in its own cell, not inside Last win', () => {
    const h = paint([ROW], { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: 5 } });
    const c = cells(h);
    expect(c[2]).toBe('10 · Adiwen');      // Last win — the runner-up is gone from here
    expect(c[3]).toBe('5');                // 2nd place — its own column
  });

  it('is right-aligned like every other DKP figure', () => {
    const h = paint([ROW], { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: 5 } });
    expect(h).toContain('<th class=num>2nd place</th>');
    expect(h).toMatch(/<td class=num[^>]*>5<\/td>/);
  });

  it('shows a dash when nobody else bid, so the column never collapses', () => {
    const h = paint([ROW], { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: null } });
    const c = cells(h);
    expect(c[3]).toBe(EM_DASH);
    expect(c).toHaveLength(5);
  });

  it('shows a dash for an item with no auction history at all', () => {
    const h = paint([ROW], {});
    expect(cells(h)[2]).toBe(EM_DASH);   // Last win
    expect(cells(h)[3]).toBe(EM_DASH);   // 2nd place
  });

  it('keeps every row five columns wide, biddable or not', () => {
    const h = paint(
      [ROW, { ...ROW, key: 'l1', item_id: null, auction_id: null, biddable: false, pending: true, name: 'Bone Chill Shield' }],
      { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: 5 } },
    );
    const bodyRows = String(h).split('<tr>').slice(2);
    expect(bodyRows).toHaveLength(2);
    for (const tr of bodyRows) {
      expect([...tr.matchAll(/<td[^>]*>/g)]).toHaveLength(5);
    }
  });

  it('a tie for the winning value still shows a second place', () => {
    const h = paint([ROW], { 77: { winning_bid: 15, winner: 'Adiwen', runner_up: 15 } });
    expect(cells(h)[3]).toBe('15');
  });

  it('a zero-DKP second place is a figure, not a dash', () => {
    const h = paint([ROW], { 77: { winning_bid: 10, winner: 'Adiwen', runner_up: 0 } });
    expect(cells(h)[3]).toBe('0');
  });
});

describe('bidding area — the old sub-line is gone (comment-stripped source)', () => {
  const clean = stripJs(src);

  it('no "runner-up" sub-line is emitted anywhere', () => {
    expect(clean).not.toContain('>runner-up ');
  });

  it('the empty-table message still stands in for zero auctions', () => {
    expect(paint([])).toContain('no loot up for bid right now');
  });
});
