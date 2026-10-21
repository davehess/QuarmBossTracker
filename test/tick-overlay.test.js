// The Tick overlay (was Zeal health): the co-leader, 2026-09-27 — "The server tick function within
// the HUD thing is awesome, but would be even better if it could be broken out or customized to put
// somewhere else, as a standalone timer". The guild lead: "change the zeal health overlay into the
// tick overlay … the zeal health info could still be accessible there. could also display clock
// skew offset".
//
// Run: npx vitest run test/tick-overlay.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const html = readSource(path.join(ROOT, 'apps', 'mimic', 'zealhealth.html'));

describe('agent: one server tick per character streaming Zeal', () => {
  const src = sliceBlock(agent, 'const _ME_TICK_MS = 6000;', '\n}\n')
    + sliceBlock(agent, 'function _serverTicksNow(now) {', '\n}\n');
  const build = (zealState) => new Function('_zealState', src + '\nreturn _serverTicksNow;')(zealState);
  const NOW = 1_000_000;
  // Gauge 24 = per-mille of the tick still to go; Mimic stores value/10 as hp_pct.
  const g24 = (pct, text) => ({ gauges: [{ slot: 24, hp_pct: pct, text: String(text) }], updatedAt: NOW });

  it('each fresh character gets a tick boundary, sorted by name so rows never swap', () => {
    const f = build({ Rethlan: g24(50, 3), Brackwyn: g24(25, 2) });
    expect(f(NOW)).toEqual([
      { character: 'Brackwyn', at: NOW + 1500 },
      { character: 'Rethlan', at: NOW + 3000 },
    ]);
  });
  it('a character silent for a minute, or without the tick gauge, is left out', () => {
    const f = build({
      Brackwyn: { ...g24(50, 3), updatedAt: NOW - 61_000 },
      Rethlan: { gauges: [{ slot: 2, hp_pct: 80 }], updatedAt: NOW },
      Corvale: g24(10, 1),
    });
    expect(f(NOW)).toEqual([{ character: 'Corvale', at: NOW + 600 }]);
  });
  it('it rides /api/state beside the clock offset', () => {
    const s = stripJs(sliceBlock(agent, 'function _serializeForDashboard() {', '\n}\n'));
    expect(s).toMatch(/serverTicks: _serverTicksNow\(Date\.now\(\)\),/);
    expect(s).toMatch(/clockOffsetMs: Number\.isFinite\(stats\.clockOffsetMs\)/);
  });
});

describe('overlay: rows, countdown, clock chip', () => {
  const src = sliceBlock(html, '  var TICK_MS = 6000;', "    return { text: text, cls: a < 1000 ? 'ok' : (a < 5000 ? 'warn' : 'bad') };\n  }");
  const { tickLeft, tickRows, clockChip } = new Function(src + '\nreturn { tickLeft, tickRows, clockChip };')();

  it('counts down to the next boundary and wraps each 6 s', () => {
    expect(tickLeft(10_000 + 2_500, 10_000)).toBe(2_500);
    expect(tickLeft(10_000 - 1_000, 10_000)).toBe(5_000);   // a past boundary: the next is 5 s off
    expect(tickLeft(10_000, 10_000)).toBe(6_000);           // on the boundary: a full tick to go
    expect(tickLeft(null, 10_000)).toBe(null);
  });

  it('one character reads "Server tick"; several are named', () => {
    expect(tickRows({ serverTicks: [{ character: 'Brackwyn', at: 5 }] }).map(r => r.label)).toEqual(['Server tick']);
    expect(tickRows({ serverTicks: [{ character: 'Brackwyn', at: 5 }, { character: 'Rethlan', at: 6 }] })
      .map(r => [r.kind, r.label])).toEqual([['srv', 'Brackwyn'], ['srv', 'Rethlan']]);
  });

  it('an active charm adds its mob tick; unknown says learning; a broken or other charm does not', () => {
    const rows = tickRows({ serverTicks: [], charmPets: [
      { pet: 'a grimling', is_active: true, mob_tick_at: 9, mob_tick_src: 'dot', mob_tick_half_ms: 500 },
      { pet: 'a goblin', is_active: true, mob_tick_at: null },
      { pet: 'a kobold', is_active: false, mob_tick_at: 9 },
    ] });
    expect(rows.map(r => [r.kind, r.label, r.at, !!r.rough])).toEqual([
      ['mob', 'a grimling', 9, true],
      ['mob', 'a goblin', null, false],
    ]);
    expect(rows[0].note).toBe('mob tick, from DoT ticks');
    expect(rows[1].note).toMatch(/^learning/);
  });

  it('the clock chip: in sync, slow (behind) or fast (ahead), and how worried to be', () => {
    expect(clockChip(null)).toEqual({ text: 'clock —', cls: 'dim' });
    expect(clockChip(50)).toEqual({ text: 'clock in sync', cls: 'ok' });
    expect(clockChip(400)).toEqual({ text: 'clock 0.4s slow', cls: 'ok' });
    expect(clockChip(-2500)).toEqual({ text: 'clock 2.5s fast', cls: 'warn' });
    expect(clockChip(42000)).toEqual({ text: 'clock 42s slow', cls: 'bad' });
  });
});

// The guild lead picked Bars (a number plus a bar that drains, one shared grid) over Dials, 2026-10-19 (DECISIONS §383):
// the dials layout, its ◯ / ▭ switch and the saved choice are gone.
describe('overlay: Bars is the only layout', () => {
  const src = sliceBlock(html, '  var _rows = [], _rowsSig = null, _haveZeal = false;', '  setInterval(renderTicks, 100);');
  const NOW = 1_000_000;
  // The slice, run for real with a stub element that parses the data-i rows out of what the overlay drew.
  function draw(rows, { haveZeal = true, saved } = {}) {
    const ticksEl = { innerHTML: '' };
    ticksEl.querySelectorAll = () => [...ticksEl.innerHTML.matchAll(/data-i="(\d+)"/g)].map((m) => {
      const tv = { textContent: '' }, bar = { style: {} };
      return { tv, bar, getAttribute: () => m[1], querySelector: (q) => (q === '.tv' ? tv : q === '.bar i' ? bar : null) };
    });
    const nodes = [];
    const origQ = ticksEl.querySelectorAll;
    ticksEl.querySelectorAll = (q) => { const l = origQ(q); nodes.splice(0, nodes.length, ...l); return l; };
    const env = {
      document: { getElementById: () => ticksEl },
      localStorage: { getItem: () => saved ?? null, setItem() {} },   // an old saved layout is on the machine
      esc: (s) => String(s), TICK_MS: 6000, Date: { now: () => NOW },
      tickLeft: (at, now) => (at == null ? null : ((at - now) % 6000 + 6000) % 6000 || 6000),
      _requestAutoHeight() {},
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(env), src + '\nreturn { setRows: function (r, z) { _rows = r; _haveZeal = z; }, renderTicks: renderTicks };');
    const o = fn(...Object.values(env));
    o.setRows(rows, haveZeal); o.renderTicks();
    return { html: ticksEl.innerHTML, nodes };
  }
  const ROWS = [
    { key: 'srv:Brackwyn', kind: 'srv', label: 'Server tick', at: NOW + 1500 },
    { key: 'mob:grimling', kind: 'mob', label: 'a grimling', at: NOW + 4500, rough: true },
  ];

  it('draws one grid of rows: a number and a draining bar, server tick blue and the mob tick purple', () => {
    const { html: out, nodes } = draw(ROWS);
    expect(out).toContain('<div class="bars">');
    expect(out).toMatch(/class="tk srv"[\s\S]*class="tk mob"/);
    expect(nodes.map((n) => n.tv.textContent)).toEqual(['1.5', '~4.5']);          // the mob tick is rough: marked with ~
    expect(nodes.map((n) => n.bar.style.width)).toEqual(['25.0%', '75.0%']);      // time left as a share of the 6 s tick
    expect(html).toMatch(/--srv:#58a6ff; --mob:#a371f7/);
  });
  it('draws no dials, whatever layout an earlier version saved on this machine', () => {
    for (const saved of [null, 'bars', 'dials']) {
      const { html: out } = draw(ROWS, { saved });
      expect(out).not.toMatch(/dials|<svg|class="dl|ring/);
      expect(out).toContain('class="bars"');
    }
  });
  it('no switch, no style, no saved choice is left in the overlay', () => {
    const js = stripJs(html);
    expect(js).not.toMatch(/layoutBtn|wp:tick:layout|_paintLayoutBtn/);
    expect(html).not.toMatch(/id="layoutBtn"|\.dials|\.dl\b|ring-bg/);
    expect(html).not.toMatch(/Show as dials|Show as bars/);
  });
  it('says what it is waiting for when there are no rows', () => {
    expect(draw([], { haveZeal: false }).html).toContain('needs Zeal');
    expect(draw([], { haveZeal: true }).html).toContain('waiting for the server tick from Zeal');
  });
});

describe('overlay: still an overlay, and the Zeal check is still there', () => {
  const js = stripJs(html);
  it('the status line hands the mouse over on hover', () => {
    expect(js).toMatch(/_hoverInteract\(statusEl\);/);
    expect(js).toMatch(/function _hoverInteract\(el\)\{[\s\S]*overlayHoverInteractive\(true\)[\s\S]*overlayHoverInteractive\(false\)/);
  });
  it('✕ hide, ✥ move with the shared right-click menu, and auto height are kept', () => {
    expect(js).toMatch(/window\.mimic\.hideThisOverlay\(\)/);
    expect(js).toMatch(/window\.mimic\.attachOverlayMenu\(moveBtn\)/);
    expect(js).toMatch(/window\.mimic\.overlayAutoHeight\(/);
  });
  it('the Zeal type check, the admin-mismatch hint and the clock detail live in the detail panel', () => {
    expect(html).toMatch(/<div id="detail" class="card">[\s\S]*id="types"[\s\S]*id="hint"[\s\S]*id="clock"/);
    expect(js).toMatch(/Run as administrator/);
    expect(js).toMatch(/w32tm \/resync/);
  });
});
