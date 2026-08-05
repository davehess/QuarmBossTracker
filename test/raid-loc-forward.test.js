// #194 — the coverage multiplier: one Mimic covers the whole raid.
//
// The bot's same-name instance clustering needs (a) each tank's position and
// (b) which tank each mob's melee is connecting on. Both exist on ONE
// Mimic-running raider's machine and were never forwarded:
//   • Zeal's type-5 raid pipe sends loc {x,y,z} + heading for EVERY raid
//     member (not verbose-gated) — the compact upload mapping dropped both
//     (docs/DESIGN-mob-serialization.md, gap 3);
//   • the observer's log shows every nearby mob→player connect —
//     recentTankHits records ALL victims, but only the self-hit left the
//     machine (incoming_mob).
//
// "with just one person in the raid having zeal and mimic running, we should
// be able to figure out where mobs are being tanked" (Uilnayar 2026-08-04).
// These two forwards are exactly that sentence.
//
// Run: npx vitest run test/raid-loc-forward.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// ── Type-5 loc in the compact roster mapping ────────────────────────────────
describe('raid roster forwards loc + heading', () => {
  // Slice the map callback's return-building tail and run it over a raw
  // type-5 member, with the hp locals it closes over stubbed.
  // The slice carries the _lx/_ly/_lz consts AND the `return { ... };` that
  // follows them — run it whole as a function body.
  const block = sliceBlock(src, 'const _lx = m.loc && Number(m.loc.x)', '};');
  const compactOf = (m) => {
    // eslint-disable-next-line no-new-func
    return new Function('m', 'hpPct', 'hpCur', 'hpMax', block)(m, null, null, null);
  };

  it('keeps the coordinates Zeal sent', () => {
    const c = compactOf({ name: 'Grabthar', loc: { x: 1.5, y: -22, z: 4 }, heading: 128 });
    expect(c.loc_x).toBe(1.5);
    expect(c.loc_y).toBe(-22);
    expect(c.loc_z).toBe(4);
    expect(c.heading).toBe(128);
  });

  it('an incomplete loc is dropped whole — no partial coordinates', () => {
    // A 2-axis coordinate would cluster at a fictional position. All-or-nothing.
    const c = compactOf({ name: 'Grabthar', loc: { x: 1.5, y: -22 }, heading: 0 });
    expect(c.loc_x).toBeNull();
    expect(c.loc_y).toBeNull();
    expect(c.loc_z).toBeNull();
  });

  it('no loc at all stays null-safe', () => {
    const c = compactOf({ name: 'Grabthar' });
    expect(c.loc_x).toBeNull();
    expect(c.heading).toBeNull();
  });

  it('non-numeric garbage does not become a coordinate', () => {
    const c = compactOf({ name: 'Grabthar', loc: { x: 'NaN?', y: 1, z: 2 }, heading: 'north' });
    expect(c.loc_x).toBeNull();
    expect(c.heading).toBeNull();
  });
});

// ── observed_tanks on the live-state flush ──────────────────────────────────
describe('observed_tanks — every connect this log saw, compact', () => {
  const block = sliceBlock(src, 'observed_tanks: (() => {', '})(),');
  const build = (recentTankHits, nowMs) => {
    const body = block.slice('observed_tanks: '.length).replace(/,$/, '');
    // eslint-disable-next-line no-new-func
    return new Function('stats', 'now', 'return ' + body)({ recentTankHits }, nowMs);
  };
  const NOW = 1_000_000_000;
  const hit = (mob, tankName, ageMs) => ({ mob: mob.toLowerCase(), mobDisplay: mob, tank: tankName, tsMs: NOW - ageMs });

  it('forwards recent connects for OTHER tanks, not just self', () => {
    const out = build([hit('a thall va xakra', 'Grabthar', 5000), hit('a thall va xakra', 'Borim', 3000)], NOW);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.tank).sort()).toEqual(['Borim', 'Grabthar']);
    expect(out[0].mob).toBe('a thall va xakra');
    expect(Date.parse(out[0].since)).toBeGreaterThan(0);
  });

  it('dedupes per (mob, tank) keeping the NEWEST connect', () => {
    const out = build([hit('a wolf', 'Grabthar', 20_000), hit('a wolf', 'Grabthar', 2_000)], NOW);
    expect(out).toHaveLength(1);
    expect(Date.parse(out[0].since)).toBe(NOW - 2_000);
  });

  it('drops stale connects — a tank who stopped being hit is not still engaged', () => {
    expect(build([hit('a wolf', 'Grabthar', 40_000)], NOW)).toBeNull();
  });

  it('drops NPC-shaped victims the recorder heuristic can misread', () => {
    // "Xin`Xakra" / "Shavimo`s warder" — backtick names are NPCs/pets, and a
    // pet tanking across the room must not open a phantom instance.
    const out = build([hit('a wolf', 'Xin`Xakra', 1000), hit('a wolf', 'Grabthar', 1000)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].tank).toBe('Grabthar');
  });

  it('caps the set small and returns null when empty', () => {
    const many = [];
    for (let i = 0; i < 30; i++) many.push(hit('mob' + i, 'Tank' + String.fromCharCode(65 + i), 1000));
    expect(build(many, NOW).length).toBeLessThanOrEqual(12);
    expect(build([], NOW)).toBeNull();
    expect(build(undefined, NOW)).toBeNull();
  });

  it('scans newest-first so the cap keeps the FRESHEST connects', () => {
    // recentTankHits is append-ordered; a burst bigger than the cap must not
    // evict the current tanks in favour of 25s-old history.
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(hit('old' + i, 'Old' + String.fromCharCode(65 + i), 25_000));
    rows.push(hit('a thall va xakra', 'Grabthar', 500));
    const out = build(rows, NOW);
    expect(out.some(o => o.tank === 'Grabthar'), 'the newest connect must survive the cap').toBe(true);
  });
});
