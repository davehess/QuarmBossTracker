// test/loot-won-card.test.js — the "Loot won" archive card.
//
// "Move Past Items to a different 'loot won' area on the loot page of mimic"
// (Hitya, 2026-08-30). Past Items used to be the last section of the Loot
// bidding card, which mixed two different questions: the bidding card is your
// LIVE HAND (what is up, what you lost, what you plan to spend) and this is
// your ARCHIVE. Splitting them splits the privacy gate too.
//
// BEHAVIOURAL, not text-matching: renderWon() is sliced out of the authored
// dashboard.html and RUN against a fake document, so a comment describing the
// card can never satisfy these assertions (CLAUDE.md, "comments satisfy text
// assertions"). The two structural facts a run cannot show — that the card
// mounts in the Loot section, and that the bidding card no longer renders the
// table — are checked on COMMENT-STRIPPED source.
//
// Run: npx vitest run test/loot-won-card.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const src  = fs.readFileSync(DASH, 'utf8');

// The real function body, start to its own closing brace.
const RENDER_WON = sliceBlock(src, '  function renderWon(){', '\n  }\n');
// ...and the REAL default for the privacy gate. Hardcoding `false` here would
// make the "hidden by default" test pass even after someone flipped the shipped
// default to true — a green test guarding nothing.
const SHOW_WON_DECL = sliceBlock(src, '  var showWon', '\n');

// ── Harness ────────────────────────────────────────────────────────────────
// renderWon() closes over the bidding panel's module state. We supply exactly
// the bindings it reads, then eval the REAL body on top, so the test tracks the
// shipped code rather than a copy of it.
function mount(wins, { authed = true } = {}) {
  const prelude = `
    var __els = new Map();
    var __painted = { html: null, n: 0 };
    var cfg = { authed: ${authed} };
    var bidHist = ${wins === null ? 'null' : JSON.stringify({ wins })};
    ${SHOW_WON_DECL}
    var winQ = "";
    var wonCard = null;
    var __filtered = 0;
    var document = {
      getElementById: function(id){
        if (!__els.has(id)) __els.set(id, { id: id, value: "", textContent: "", onclick: null, oninput: null });
        return __els.get(id);
      }
    };
    function ensureWon(){
      if (wonCard) return;
      wonCard = { style: {}, querySelector: function(){ return { body: true }; } };
    }
    function morphInto(el, html){ __painted.html = html; __painted.n++; }
    function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
    function fmt(n){ return String(n); }
    function itemLink(name){ return "<a>" + esc(name) + "</a>"; }
    function eraTag(e){ return e ? "<i>" + esc(e) + "</i>" : ""; }
    function applyWinFilter(){ __filtered++; }
  `;
  const epilogue = `
    function html(){ return __painted.html; }
    function paints(){ return __painted.n; }
    function hidden(){ return wonCard ? wonCard.style.display === "none" : null; }
    function mounted(){ return !!wonCard; }
    function filtered(){ return __filtered; }
    function clickReveal(){ var e = __els.get("wpWonReveal"); if (!e || !e.onclick) throw new Error("no reveal button"); e.onclick(); }
    function clickHide(){ var e = __els.get("wpWonHide"); if (!e || !e.onclick) throw new Error("no hide button"); e.onclick(); }
  `;
  return evalBlock(prelude + RENDER_WON + epilogue,
    ['renderWon', 'html', 'paints', 'hidden', 'mounted', 'filtered', 'clickReveal', 'clickHide']);
}

const W = (n, extra = {}) => ({
  item_name: 'Item ' + n, character: 'Char' + (n % 3), dkp: n, era: 'kunark', raid_id: n, ...extra,
});

// Rows of the rendered table, in order.
function rows(html) {
  return [...String(html || '').matchAll(/<tr data-w='([^']*)'([^>]*)>/g)]
    .map(m => ({ key: m[1], extra: /data-extra=1/.test(m[2]) }));
}

describe('Loot won — the archive is its own card', () => {
  it('is hidden behind its own reveal, and paints no rows until asked', () => {
    const h = mount([W(1), W(2)]);
    h.renderWon();
    expect(h.html()).toContain('wpWonReveal');
    expect(rows(h.html())).toHaveLength(0);
    // The count is advertised without revealing what the items are.
    expect(h.html()).toContain('2 items');
    expect(h.html()).not.toContain('Item 1');
  });

  it('reveals the table on click, and hides it again', () => {
    const h = mount([W(1), W(2)]);
    h.renderWon();
    h.clickReveal();
    expect(rows(h.html())).toHaveLength(2);
    expect(h.html()).toContain('Item 1');
    h.clickHide();
    expect(rows(h.html())).toHaveLength(0);
    expect(h.html()).toContain('wpWonReveal');
  });

  it('singularises the one-item case', () => {
    const h = mount([W(1)]);
    h.renderWon();
    expect(h.html()).toContain('1 item ');
    expect(h.html()).not.toContain('1 items');
  });

  it('renders EVERY era — the archive is a lookup surface, not a filtered view', () => {
    const h = mount([
      W(1, { era: 'classic' }), W(2, { era: 'kunark' }),
      W(3, { era: 'velious' }), W(4, { era: 'pop' }),
    ]);
    h.renderWon();
    h.clickReveal();
    expect(rows(h.html())).toHaveLength(4);
  });

  it('puts era in the search key alongside item and character', () => {
    const h = mount([{ item_name: 'Cloak of Flames', character: 'Rockin', dkp: 40, era: 'kunark' }]);
    h.renderWon();
    h.clickReveal();
    expect(rows(h.html())[0].key).toBe('cloak of flames rockin kunark');
  });

  it('shows the first 12 and marks the rest search-to-see', () => {
    const h = mount(Array.from({ length: 30 }, (_, i) => W(i + 1)));
    h.renderWon();
    h.clickReveal();
    const r = rows(h.html());
    expect(r).toHaveLength(30);
    expect(r.filter(x => !x.extra)).toHaveLength(12);
    expect(r.slice(0, 12).every(x => !x.extra)).toBe(true);
    expect(r.slice(12).every(x => x.extra)).toBe(true);
  });

  // ⚠ The corpus must EXCEED the cap or the assertion is vacuous — it would
  // pass whether the cap exists or not (CLAUDE.md, "sibling trap").
  it('caps the rendered table at 400 rows', () => {
    const h = mount(Array.from({ length: 640 }, (_, i) => W(i + 1)));
    h.renderWon();
    h.clickReveal();
    expect(rows(h.html())).toHaveLength(400);
  });

  it('runs the search filter after painting, so a query survives a repaint', () => {
    const h = mount([W(1)]);
    h.renderWon();
    const before = h.filtered();
    h.clickReveal();
    expect(h.filtered()).toBeGreaterThan(before);
  });

  it('hides the whole card when the family has won nothing', () => {
    const h = mount([]);
    h.renderWon();
    expect(h.hidden()).toBe(true);
    expect(h.html()).toBe(null);   // never painted
  });

  it('stays empty when signed out — wins are read only for an authed session', () => {
    const h = mount([W(1), W(2)], { authed: false });
    h.renderWon();
    expect(h.hidden()).toBe(true);
  });

  it('survives a null bid history', () => {
    const h = mount(null);
    expect(() => h.renderWon()).not.toThrow();
    expect(h.hidden()).toBe(true);
  });
});

describe('Loot won — where it lives (comment-stripped source)', () => {
  const clean = stripJs(src);

  it('the wins table is emitted in exactly ONE place', () => {
    expect(clean.match(/id=wpLootWins/g) || []).toHaveLength(1);
  });

  it('...and that place is renderWon, not the bidding card', () => {
    expect(sliceBlock(clean, '  function renderWon(){', '\n  }\n')).toContain('id=wpLootWins');
    // The bidding card's own render() — start to the renderWon() handoff that
    // now closes it — must not emit the archive table any more.
    const bidding = sliceBlock(clean, '  function render(){', 'renderWon();');
    expect(bidding).not.toContain('wpLootWins');
    expect(bidding).not.toContain('wpLootWinQ');
  });

  it('mounts its own card into the Loot section', () => {
    const ensure = sliceBlock(clean, '  function ensureWon(){', '\n  }\n');
    expect(ensure).toContain('wpLootWonCard');
    expect(ensure).toContain('getElementById("loot")');
  });

  it('the bidding card no longer advertises wins behind its own reveal', () => {
    expect(clean).toContain('your wishlist and misses');
    expect(clean).not.toContain('your wishlist, misses and wins');
  });
});
