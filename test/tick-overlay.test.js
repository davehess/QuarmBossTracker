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

describe('overlay: still an overlay, and the Zeal check is still there', () => {
  const js = stripJs(html);
  it('the layout switch and the status line both hand the mouse over on hover', () => {
    expect(js).toMatch(/_hoverInteract\(layoutBtn\);/);
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
