// test/kite-coach.test.js - the Map's kite coach (C) and the guild loop library (B).
//
// The guild lead, 2026-10-15 ("B and C"): kiters run circles; one raider's loop is "flawless", another's is not;
// "common non-drifting circles and speeds are worth us hanging onto."
//
// Four halves, each run as shipped:
//  1. apps/mimic/kiteCoach.js - the pure math: circle fit, lap detection, drift, direction, the clean-lap test. Synthetic
//     circles with a known centre / radius / drift, noise, cw vs ccw, and the paths that must NOT count: a spiral, a
//     figure-eight, back-and-forth, a straight run, a circle too small or too big.
//  2. packages/wolfpack-logsync/index.js "Kite loops" - what may leave the machine: exactly the contract body, no name,
//     nothing in local mode / for an excluded character / under the guild kill switch / for fewer than 3 clean laps; the
//     guild's loops coming in, cached, and a 404 (an older bot) reading as "none".
//  3. apps/mimic/map.html - its script booted against a stub page with the real kiteCoach.js: a clean run posts ONE summary
//     to the agent, the switches turn each half off, the guild's loops are asked for and the chip says "vs guild".
//  4. the wiring that cannot be run here, as comment-stripped text.
// NOT covered: any pixel on the canvas. The rings, the arrow, the pace dot and the chip's look need a live game.
//
// Mutation-checked (by hand, 2026-10-15): take the radius-change test out of cleanLap and "a spiral is never clean" fails;
// take the `_ownTimersAllowed` gate out of _kiteLoopSubmit and the local-mode, excluded-character and kill-switch tests fail;
// take `!_BARE_KINDS.has(kind)` off the character stamp in enqueueUpload and "the queued body is exactly the contract" fails.
// Cause tags (2026-10-23): drop the "next step is off by the opposite" test from lapSignals and the 6 u shove and 40 u jump
// tests fail; zero the turn score in causeOf and "turn input" and the by-hand ranking fail. Synthetic laps only (steer()).
//
// Run: npx vitest run test/kite-coach.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const KC = require(path.join(ROOT, 'apps', 'mimic', 'kiteCoach.js'));
const agent = require(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
const AGENT_SRC = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));

const CONTRACT_KEYS = ['agent_version', 'at', 'cx', 'cy', 'cz', 'dir', 'drift_u', 'lap_s', 'laps', 'r', 'speed_pct', 'wobble_u', 'zone'];

// ───────────────────────────── 1. the math ─────────────────────────────

// A tiny seeded generator, so a "noisy" test is the same noise every run.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// A path in the server frame. th grows CLOCKWISE on the Map (screen x = -x, screen y = -y, y down), so a clockwise
// circle is x = cx - r cos(th), y = cy - r sin(th).
function circle({ cx = 500, cy = -300, r = 118, lap = 12.4, dir = 'cw', drift = [0, 0], noise = 0, wobble = 0, seed = 1, grow = 0 } = {}) {
  const rand = rng(seed), sg = dir === 'cw' ? 1 : -1;
  return (s) => {
    const th = sg * 2 * Math.PI * s / lap, rr = r * Math.pow(1 + grow, s / lap) * (1 + wobble * Math.sin(3 * th));
    return { x: cx - rr * Math.cos(th) + drift[0] * s + (rand() - 0.5) * 2 * noise, y: cy - rr * Math.sin(th) + drift[1] * s + (rand() - 0.5) * 2 * noise, z: 12 };
  };
}
// Feed a path to a coach. Returns every event with its time (seconds from the start).
function run(path, secs, { hz = 10, coach = KC.create(), t0 = 1_000_000, from = 0 } = {}) {
  const ev = [];
  for (let i = 0; i < secs * hz; i++) {
    const s = from + i / hz, p = path(s);
    for (const e of coach.push(t0 + s * 1000, p.x, p.y, p.z)) ev.push(Object.assign({ at: s }, e));
  }
  return { coach, ev, of: (type) => ev.filter(e => e.type === type) };
}

describe('fitCircle', () => {
  it('recovers the centre and radius of a clean circle, and its wobble is ~0', () => {
    const f = circle({ cx: 40, cy: -70, r: 200 });
    const pts = Array.from({ length: 120 }, (_, i) => f(i * 0.5));
    const c = KC.fitCircle(pts);
    expect(c.cx).toBeCloseTo(40, 1); expect(c.cy).toBeCloseTo(-70, 1); expect(c.r).toBeCloseTo(200, 1); expect(c.sd).toBeLessThan(0.1);
  });
  it('holds up under noise, and the wobble reads the size of the noise', () => {
    const f = circle({ cx: 0, cy: 0, r: 150, noise: 3, seed: 7 });
    const c = KC.fitCircle(Array.from({ length: 300 }, (_, i) => f(i * 0.2)));
    expect(Math.hypot(c.cx, c.cy)).toBeLessThan(2); expect(Math.abs(c.r - 150)).toBeLessThan(2); expect(c.sd).toBeGreaterThan(0.5); expect(c.sd).toBeLessThan(3);
  });
  it('is null for a line, a point, and too few points', () => {
    expect(KC.fitCircle(Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: i * 5 })))).toBeNull();
    expect(KC.fitCircle(Array.from({ length: 40 }, () => ({ x: 3, y: 3 })))).toBeNull();
    expect(KC.fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }])).toBeNull();
  });
});

describe('compass: +y is north, +x is west (the Map\'s frame)', () => {
  it('names the eight ways', () => {
    expect([[0, 5], [-5, 5], [-5, 0], [-5, -5], [0, -5], [5, -5], [5, 0], [5, 5]].map(([x, y]) => KC.compass(x, y)))
      .toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    expect(KC.compass(0, 0)).toBe('');
  });
});

describe('a clean circle', () => {
  for (const [dir, hz] of [['cw', 10], ['ccw', 10], ['cw', 20], ['ccw', 4]]) {
    it(`${dir} at ${hz} Hz: engages once, then every lap has the right time, radius, centre, speed and direction`, () => {
      const { ev, of } = run(circle({ dir, noise: 1, seed: 3 }), 80, { hz });
      expect(of('engage')).toHaveLength(1);
      expect(of('disengage')).toHaveLength(0);
      const laps = of('lap').map(e => e.lap);
      expect(laps.length).toBeGreaterThanOrEqual(4);
      for (const l of laps) {
        expect(l.dir).toBe(dir);
        expect(l.lapS).toBeGreaterThan(12.3); expect(l.lapS).toBeLessThan(12.5);          // the crossing time is interpolated, not snapped to a sample
        expect(Math.abs(l.r - 118)).toBeLessThan(2);
        expect(Math.hypot(l.cx - 500, l.cy + 300)).toBeLessThan(2);
        expect(l.drift).toBeLessThan(2.5);
        expect(l.sd).toBeLessThan(2);
        expect(Math.abs(l.speedPct - (2 * Math.PI * 118 / 12.4) / 30.3 * 100)).toBeLessThan(4);   // 2 pi r / lap, as % of a 30.3 u/s run
        expect(l.cz).toBeCloseTo(12, 5);
        expect(l.clean).toBe(true);
      }
      expect(ev.find(e => e.type === 'engage').at).toBeLessThan(18);                          // about a lap and a bit
    });
  }

  it('reports ONCE after 3 clean laps, with the means over them, and never again for the same run', () => {
    const { of } = run(circle({ noise: 1, seed: 5 }), 140);
    const reps = of('report');
    expect(reps).toHaveLength(1);
    expect(reps[0].at).toBeGreaterThan(40); expect(reps[0].at).toBeLessThan(60);           // lap 0 (~1.3 laps to see it) + 3 clean laps
    const b = reps[0].body;
    expect(Object.keys(b).sort()).toEqual(['cx', 'cy', 'cz', 'dir', 'drift_u', 'lap_s', 'laps', 'r', 'speed_pct', 'wobble_u']);
    expect(b).toMatchObject({ dir: 'cw', laps: 3, cz: 12 });
    expect(Math.abs(b.cx - 500)).toBeLessThan(2); expect(Math.abs(b.cy + 300)).toBeLessThan(2); expect(Math.abs(b.r - 118)).toBeLessThan(2);
    expect(Math.abs(b.lap_s - 12.4)).toBeLessThan(0.1);
    expect(b.drift_u).toBeLessThan(0.08 * 118); expect(b.wobble_u).toBeLessThan(0.10 * 118);
  });

  it('a second run elsewhere (the first ended, a new circle) is a new report', () => {
    const coach = KC.create();
    const a = run(circle({ cx: 500, cy: -300 }), 70, { coach });
    // run away in a straight line, then circle somewhere else
    const away = run((s) => ({ x: 500 + 118 + s * 30, y: -300, z: 12 }), 12, { coach, from: 70 });
    const b = run(circle({ cx: 3000, cy: 900 }), 70, { coach, from: 82 });
    expect(a.of('report')).toHaveLength(1);
    expect(away.of('disengage').length + b.of('disengage').length).toBeGreaterThanOrEqual(1);
    expect(b.of('report')).toHaveLength(1);
    expect(Math.abs(b.of('report')[0].body.cx - 3000)).toBeLessThan(3);
  });

  it('a step of 250 units or a 4 s silence starts over (zoning, a gate)', () => {
    const coach = KC.create();
    const a = run(circle(), 30, { coach });
    expect(a.of('engage')).toHaveLength(1);
    const ev = coach.push(1_000_000 + 30_100, 9000, 9000, 0);
    expect(ev).toEqual([{ type: 'disengage', reason: 'gap' }]);
    expect(coach.engaged()).toBe(false);
  });
});

describe('the drift', () => {
  it('a centre moving 1.5 u/s is ~18 u a lap, to the west when +x, red, and never clean', () => {
    const { of } = run(circle({ drift: [1.5, 0], noise: 1, seed: 9 }), 90);
    const laps = of('lap').map(e => e.lap);
    expect(laps.length).toBeGreaterThanOrEqual(4);
    for (const l of laps) {
      expect(l.drift).toBeGreaterThan(15); expect(l.drift).toBeLessThan(22);
      expect(KC.compass(l.driftDx, l.driftDy)).toBe('W');
      expect(KC.driftClass(l)).toBe('r');
      expect(l.clean).toBe(false);
    }
    expect(of('report')).toHaveLength(0);
    expect(KC.chipText(laps[1])).toMatch(/^Lap 12\.\d s · r 1\d\d · drift 1\d u W · wobble \d+ · \d+%$/);
  });
  it('colours by share of the radius: green under 5%, amber under 12%, red above', () => {
    const l = (d) => ({ drift: d, r: 100 });
    expect([2, 4.9, 5, 11.9, 12, 40].map(d => KC.driftClass(l(d)))).toEqual(['g', 'g', 'a', 'a', 'r', 'r']);
    expect(KC.driftClass({ drift: null, r: 100 })).toBe('n');
  });
  it('the chip line reads like the one the guild lead asked for', () => {
    expect(KC.chipText({ lapS: 12.4, r: 118, drift: 6, driftDx: 4, driftDy: 4, sd: 4, speedPct: 104 })).toBe('Lap 12.4 s · r 118 · drift 6 u NW · wobble 4 · 104%');
    expect(KC.chipText({ lapS: 12.4, r: 118, drift: null, sd: 4, speedPct: 104 })).toBe('Lap 12.4 s · r 118 · drift - · wobble 4 · 104%');
    expect(KC.chipText({ lapS: 12.4, r: 118, drift: 0.2, driftDx: 0.1, driftDy: 0.1, sd: 1, speedPct: 100 })).toMatch(/drift 0 u ·/);   // no bearing for nothing
  });
});

// A kite the way the game makes it: a heading that turns at w(s) rad/s and a position that moves along it at v(s) u/s
// (the lap time is fixed by w, the radius is v / w). `shoves` move the position at once (a push, lag catching up, a
// server correction); `zf` is the ground height. Same shape as circle(): a function of seconds for run().
function steer({ v = () => 35, w = () => 2 * Math.PI / 6.4, shoves = [], noise = 0.5, seed = 1, zf = () => 12, secs = 140 } = {}) {
  const rand = rng(seed), dt = 0.01, xs = [], ys = [], zs = [];
  let x = 500, y = -300, h = 0;
  const todo = shoves.map(o => Object.assign({ done: false }, o));
  for (let i = 0; i * dt <= secs; i++) {
    const s = i * dt;
    for (const sh of todo) if (!sh.done && s >= sh.at) { sh.done = true; x += sh.dx; y += sh.dy; }
    xs.push(x); ys.push(y); zs.push(zf(s));
    h += w(s) * dt; x += v(s) * Math.cos(h) * dt; y += v(s) * Math.sin(h) * dt;
  }
  return (s) => { const i = Math.round(s / dt); return { x: xs[i] + (rand() - 0.5) * 2 * noise, y: ys[i] + (rand() - 0.5) * 2 * noise, z: zs[i] }; };
}
const W0 = 2 * Math.PI / 6.4;
const lapsOf = (res) => res.of('lap').map(e => e.lap);
// The lap the disturbance hit hardest: the one with the biggest drift (the lap after it drifts a little too).
const worst = (laps) => laps.reduce((a, b) => (b.drift > a.drift ? b : a));

describe('the likely cause of a drifting lap', () => {
  // Disturbances land in the 5th lap or so (27 s, ~4 laps of settling first), where the coach is well engaged.
  it('a perfect circle (even a noisy one, either way round) drifts nowhere and is tagged with nothing', () => {
    for (const [noise, w] of [[1, W0], [0.5, -W0]]) {
      const laps = lapsOf(run(steer({ noise, w: () => w }), 80));
      expect(laps.length).toBeGreaterThanOrEqual(8);
      for (const l of laps) { expect(l.drift).toBeLessThan(0.05 * l.r); expect(l.cause).toBeNull(); expect(KC.chipText(l)).not.toMatch(/←/); }
    }
  });

  it('constant turn, speed 35 -> 25 u/s for half a lap: "speed changed", with the numbers', () => {
    const l = worst(lapsOf(run(steer({ v: (s) => (s > 27 && s < 30.2 ? 25 : 35) }), 60)));
    expect(l.drift).toBeGreaterThan(0.12 * l.r);
    expect(l.cause.kind).toBe('speed changed');
    expect(l.cause.why).toMatch(/^speed \d+%→\d+% within the lap$/);
    const [a, b] = l.cause.why.match(/\d+/g).map(Number);
    expect(Math.abs(a - 82)).toBeLessThan(12); expect(Math.abs(b - 116)).toBeLessThan(6);   // 25 and 35 u/s are 82% and 116% of a run (the slices blur it)
    expect(KC.chipText(l)).toMatch(/drift \d+ u [NSEW]+ ← speed changed · wobble/);
  });

  it('constant speed, the turn slowed 30% for half a lap: "turn input"', () => {
    const l = worst(lapsOf(run(steer({ w: (s) => (s > 27 && s < 30.2 ? W0 * 0.7 : W0) }), 60)));
    expect(l.drift).toBeGreaterThan(0.12 * l.r);
    expect(l.cause.kind).toBe('turn input');
    expect(l.cause.why).toMatch(/^heading \d+° off a steady turn, [\d.]+ s into the lap; turn \d+→\d+ °\/s$/);
  });

  it('a 6 u shove (along the way, across it, against it) with steady speed and turn: "pushed"', () => {
    for (const [dx, dy, at] of [[6, 0, 28.3], [0, 6, 28.3], [-6, 0, 28.3], [0, -6, 28.3], [6, 0, 31.1], [0, 6, 31.1], [-6, 0, 33.2], [0, -6, 33.2]]) {
      const l = worst(lapsOf(run(steer({ shoves: [{ at, dx, dy }] }), 60)));
      expect(l.cause && l.cause.kind).toBe('pushed');
      expect(l.cause.why).toMatch(/^shoved [4-9] u in one step, [\d.]+ s into the lap( before)?$/);   // a shove reads in its own lap and in the next one
      expect(KC.chipText(l)).toMatch(/drift \d+ u [NSEW]+ ← pushed/);
    }
  });

  it('a 40 u jump in one step: "warp/lag" (and it is not mistaken for a speed change)', () => {
    // (a jump this size in the middle of a lap makes the lap lumpy enough that the coach lets go: not asserted here)
    for (const [dx, dy, at] of [[35, 20, 28.3], [-30, 25, 28.3], [0, 40, 28.3], [0, 40, 33.2]]) {
      const l = worst(lapsOf(run(steer({ shoves: [{ at, dx, dy }] }), 60)));
      expect(l.cause && l.cause.kind).toBe('warp/lag');
      expect(l.cause.why).toMatch(/^jumped \d\d u in one step/);
    }
  });

  it('the lap AFTER a change of speed, all at the new speed, says so against the lap before', () => {
    const laps = lapsOf(run(steer({ v: (s) => (s > 27 ? 25 : 35) }), 70));       // slows down for good
    const after = laps.find(l => l.t0 > 1_000_000 + 28_000 && l.cause);
    expect(after).toBeTruthy();
    expect(after.cause.kind).toBe('speed changed');
    expect(after.cause.why).toMatch(/since the lap before$/);
  });

  it('NEVER A GUESS: a centre sliding steadily, or a change too small to read, drifts but is tagged with nothing', () => {
    const slide = lapsOf(run(circle({ drift: [1.5, 0], noise: 0.5, seed: 9 }), 90));
    expect(slide.length).toBeGreaterThanOrEqual(4);
    for (const l of slide) { expect(l.drift).toBeGreaterThan(0.12 * l.r); expect(l.cause).toBeNull(); }
    const small = worst(lapsOf(run(steer({ v: (s) => (s > 27 && s < 30.2 ? 35 * 0.96 : 35) }), 60)));   // 4% for half a lap
    expect(small.drift).toBeGreaterThan(0.05 * small.r);                         // a visible drift ...
    expect(small.cause).toBeNull();                                              // ... whose cause is under the noise
  });

  it('a lap whose chip is still green is not looked at', () => {
    const l = worst(lapsOf(run(steer({ v: (s) => (s > 27 && s < 30.2 ? 25 : 35) }), 60)));
    expect(KC.causeOf(Object.assign({}, l, { drift: 0.049 * l.r }), null)).toBeNull();
    expect(KC.causeOf(Object.assign({}, l, { drift: 0.05 * l.r }), null)).not.toBeNull();
    expect(KC.causeOf(Object.assign({}, l, { sig: null }), null)).toBeNull();
  });

  it('the coach hands the Map the numbers for the tooltip', () => {
    const coach = KC.create(), path = steer({ shoves: [{ at: 28.3, dx: 6, dy: 0 }] });
    let seen = null;
    for (let i = 0; i < 600; i++) {
      const p = path(i / 10);
      coach.push(1_000_000 + i * 100, p.x, p.y, p.z);
      if (coach.view() && coach.view().why) seen = coach.view();
    }
    expect(seen).not.toBeNull();
    expect(seen.why).toMatch(/^shoved/); expect(seen.chip).toMatch(/← pushed/);
    expect(seen.cur.cause.kind).toBe('pushed');
    expect(coach.view().why === '' || /^(shoved|speed|heading)/.test(coach.view().why)).toBe(true);
  });

  it('slope and the order of rank, on signals made by hand (a hill is up in one slice, down in another, and slows you where it climbs)', () => {
    const part = (v, dz) => ({ v, turn: W0, dz });
    const base = { drift: 12, r: 35, lapS: 6.4, sig: { vSteady: 35, jump: null, turnDev: null, parts: [part(28, 6), part(35, 0), part(41, -6), part(35, 0)] } };
    expect(KC.causeOf(base, null).kind).toBe('slope');
    expect(KC.causeOf(base, null).why).toMatch(/^ground moved 6 u in a slice; speed \d+%→\d+% within the lap$/);
    // the same speeds on level ground, or a ground that moves but not with the speed, are a change of speed
    const flat = Object.assign({}, base, { sig: Object.assign({}, base.sig, { parts: [part(28, 1), part(35, 0), part(41, -1), part(35, 0)] }) });
    expect(KC.causeOf(flat, null).kind).toBe('speed changed');
    const unrelated = Object.assign({}, base, { sig: Object.assign({}, base.sig, { parts: [part(28, 0), part(35, 6), part(41, 0), part(35, -6)] }) });
    expect(KC.causeOf(unrelated, null).kind).toBe('speed changed');
    // two fire: the one furthest over its bar wins
    const both = (jump, dev) => ({ drift: 12, r: 35, lapS: 6.4, sig: { vSteady: 35, jump, turnDev: dev, parts: [part(35, 0), part(35, 0), part(35, 0), part(35, 0)] } });
    expect(KC.causeOf(both({ u: 9, at: 1 }, { dev: 0.15, at: 2 }), null).kind).toBe('pushed');       // 9 / 4 u = 2.25 bars over, against 0.15 / 0.10 rad = 1.5
    expect(KC.causeOf(both({ u: 5, at: 1 }, { dev: 0.30, at: 2 }), null).kind).toBe('turn input');   // 1.25 against 3
    expect(KC.causeOf(both({ u: 3, at: 1 }, { dev: 0.08, at: 2 }), null)).toBeNull();                // nothing clears its bar: nothing is said
    expect(KC.causeOf(both({ u: 25, at: 1 }, null), null).kind).toBe('warp/lag');                   // from 20 u it is a jump, not a shove
  });
});

describe('what must NOT count', () => {
  it('a spiral (radius growing 15% a lap) is never clean and never reports', () => {
    const { of } = run(circle({ r: 100, grow: 0.15, lap: 12 }), 100);
    const laps = of('lap').map(e => e.lap);
    expect(laps.length).toBeGreaterThanOrEqual(3);
    expect(laps.every(l => l.clean === false)).toBe(true);
    expect(of('report')).toHaveLength(0);
  });
  it('a slow spiral (4% a lap) is still the loop it is: clean laps, and the radius test is what stops the fast one', () => {
    const { of } = run(circle({ r: 100, grow: 0.04, lap: 12 }), 100);
    expect(of('lap').every(e => e.lap.clean)).toBe(true);
    expect(of('report')).toHaveLength(1);
  });
  it('a figure-eight never engages', () => {
    for (const [ax, ay] of [[100, 60], [160, 160], [90, 30]]) {
      const { ev } = run((s) => { const th = 2 * Math.PI * s / 20; return { x: ax * Math.sin(th), y: ay * Math.sin(2 * th), z: 0 }; }, 160);
      expect(ev.filter(e => e.type === 'engage'), `eight ${ax}x${ay}`).toHaveLength(0);
    }
  });
  it('back and forth along a line never engages', () => {
    const { ev } = run((s) => ({ x: 150 * Math.abs(((s / 8) % 2) - 1), y: 0, z: 0 }), 120);
    expect(ev).toHaveLength(0);
  });
  it('a straight run, standing still, and a slow stroll never engage', () => {
    expect(run((s) => ({ x: s * 30, y: 0, z: 0 }), 90).ev).toHaveLength(0);
    expect(run(() => ({ x: 10, y: 10, z: 0 }), 90).ev).toHaveLength(0);
    expect(run(circle({ r: 60, lap: 200 }), 400).ev.filter(e => e.type === 'engage')).toHaveLength(0);   // 1.9 u/s: not kiting
  });
  it('a circle under 20 units or over 500 never engages', () => {
    expect(run(circle({ r: 12, lap: 4 }), 60).ev).toHaveLength(0);
    expect(run(circle({ r: 650, lap: 60 }), 400).ev.filter(e => e.type === 'engage')).toHaveLength(0);
  });
  it('a sloppy circle (a lumpy radius, ~18% wobble) engages for the coaching but never reports', () => {
    const { of } = run(circle({ wobble: 0.25, noise: 1, seed: 2 }), 100);
    expect(of('engage').length).toBeGreaterThanOrEqual(1);
    expect(of('report')).toHaveLength(0);
  });
  it('a circle that reverses, or that is left for a straight run, lets go within ~1.5 lap times', () => {
    const coach = KC.create();
    const a = run(circle({ lap: 12 }), 40, { coach });
    expect(a.of('engage')).toHaveLength(1);
    const away = run((s) => ({ x: 500 + 118 + (s - 40) * 30, y: -300, z: 0 }), 30, { coach, from: 40 });
    const d = away.of('disengage');
    expect(d).toHaveLength(1);
    expect(d[0].at - 40).toBeLessThan(1.5 * 12 + 14);
  });
});

describe('the guild helpers', () => {
  const L = { id: 1, cx: 500, cy: -300, cz: 12, r: 118, lap_s: 12.4, speed_pct: 104, dir: 'cw', drift_u: 3, wobble_u: 2, laps: 9, seen: 7 };
  it('matches a lap on a loop when the centre is within 0.35 r and the radius within 25%', () => {
    expect(KC.matchGuild({ cx: 509, cy: -300, r: 118 }, [L])).toBe(L);
    expect(KC.matchGuild({ cx: 500 + 0.34 * 118, cy: -300, r: 118 }, [L])).toBe(L);
    expect(KC.matchGuild({ cx: 500 + 0.36 * 118, cy: -300, r: 118 }, [L])).toBeNull();
    expect(KC.matchGuild({ cx: 500, cy: -300, r: 118 * 1.24 }, [L])).toBe(L);
    expect(KC.matchGuild({ cx: 500, cy: -300, r: 118 * 1.3 }, [L])).toBeNull();
    expect(KC.matchGuild(null, [L])).toBeNull(); expect(KC.matchGuild({ cx: 0, cy: 0, r: 1 }, [])).toBeNull();
  });
  it('says how your lap compares: +0.8 s/lap, centre 9 u off', () => {
    expect(KC.guildText({ lapS: 13.2, cx: 509, cy: -300 }, L)).toBe('vs guild: +0.8 s/lap, centre 9 u off');
    expect(KC.guildText({ lapS: 12.0, cx: 500, cy: -300 }, L)).toBe('vs guild: -0.4 s/lap, centre 0 u off');
  });
  it('labels a loop r 118 · 12.4 s · 104% · ×7', () => {
    expect(KC.guildLabel(L)).toBe('r 118 · 12.4 s · 104% · ×7');
  });
  it('the pace dot goes round once a lap, the loop\'s way, from the wall clock', () => {
    const d0 = KC.guildDot(L, 0), dFull = KC.guildDot(L, 12400), dq = KC.guildDot(L, 3100), dqCcw = KC.guildDot({ ...L, dir: 'ccw' }, 3100);
    expect(Math.hypot(d0.x - dFull.x, d0.y - dFull.y)).toBeLessThan(1e-6);
    expect(Math.hypot(d0.x - L.cx, d0.y - L.cy)).toBeCloseTo(118, 6);
    // a quarter lap on from (cx - r, cy): clockwise on the Map is toward the top of the screen = +y (north); ccw the other way
    expect(dq.y).toBeCloseTo(L.cy - 118, 6); expect(dqCcw.y).toBeCloseTo(L.cy + 118, 6);
  });
});

// ───────────────────────────── 2. the agent ─────────────────────────────

const BOT = 'https://bot.test/api/agent/encounter';
const loopSummary = (o = {}) => ({ zone: 'thedeep', cx: 500.04, cy: -300.06, cz: 12, r: 118, lap_s: 12.4, speed_pct: 104.2, drift_u: 3.2, wobble_u: 2.4, laps: 3, dir: 'cw', ...o });

describe('agent: what may leave the machine', () => {
  const ZONE_DEEP = 164;                       // MAP_ZONE_SHORT: thedeep
  let queue;
  // `at`: the clock the pipe last spoke on (the agent only trusts a character whose pipe spoke within a minute of `now`).
  const setup = ({ token = 't0k', dryRun = false, zone = ZONE_DEEP, at = Date.now() } = {}) => {
    agent._setUploadOptsForTest({ botUrl: BOT, token, dryRun });
    agent._setZealStateForTest('Aldenmar', zone == null ? null : { zone, updatedAt: at });
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });   // enqueueUpload's 500 ms disk save never fires
    queue = agent._uploadQueueForTest();
    queue.splice(0);
    agent._applyCharacterPrefsResponse({ prefs: {} });
    agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  });
  afterEach(() => {
    queue.splice(0);
    agent._setUploadOptsForTest(null);
    agent._setZealStateForTest('Aldenmar', null);
    agent._applyCharacterPrefsResponse({ prefs: {} });
    agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
    vi.useRealTimers();
  });

  it('the queued body is exactly the contract: no character, no agent_state, nothing else', () => {
    const NOW = Date.UTC(2026, 9, 15, 20, 0, 0);
    setup({ at: NOW });
    const r = agent._kiteLoopSubmit(loopSummary(), NOW);
    expect(r).toEqual({ status: 200, body: { ok: true, sent: true } });
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe('kite_loop');
    const b = queue[0].payload;
    expect(Object.keys(b).sort()).toEqual(CONTRACT_KEYS);
    expect(b).toEqual({ zone: 'thedeep', cx: 500, cy: -300.1, cz: 12, r: 118, lap_s: 12.4, speed_pct: 104.2, drift_u: 3.2, wobble_u: 2.4, laps: 3, dir: 'cw',
      at: '2026-10-15T20:00:00.000Z', agent_version: agent.AGENT_VERSION });
    expect(JSON.stringify(b)).not.toMatch(/aldenmar/i);
  });
  it('goes to <bot>/api/agent/kite-loop', () => {
    expect(sliceBlock(AGENT_SRC, "case 'kite_loop':", '\n')).toMatch(/return base \+ '\/kite-loop';/);
  });
  it('takes the zone from where the character is, and refuses a Map that names another zone', () => {
    setup();
    expect(agent._kiteLoopSubmit(loopSummary({ zone: 'potimea' }), Date.now()).status).toBe(409);
    expect(queue).toHaveLength(0);
    setup({ zone: null });
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now()).status).toBe(409);
    expect(queue).toHaveLength(0);
  });
  it('local mode (no token) queues nothing', () => {
    setup({ token: null });
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now())).toEqual({ status: 200, body: { ok: true, sent: false } });
    expect(queue).toHaveLength(0);
  });
  it('a dry run queues nothing', () => {
    setup({ dryRun: true });
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now()).body.sent).toBe(false);
    expect(queue).toHaveLength(0);
  });
  it('a character set to exclude_from_stats queues nothing; clearing it lets the next one through', () => {
    setup();
    agent._applyCharacterPrefsResponse({ prefs: { Aldenmar: { exclude_from_stats: true } } });
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now()).body.sent).toBe(false);
    expect(queue).toHaveLength(0);
    agent._applyCharacterPrefsResponse({ prefs: { Aldenmar: { exclude_from_stats: false } } });
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now()).body.sent).toBe(true);
    expect(queue).toHaveLength(1);
  });
  it('the guild\'s kill switch (the control plane) queues nothing', () => {
    setup();
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    expect(agent._kiteLoopSubmit(loopSummary(), Date.now()).body.sent).toBe(false);
    expect(queue).toHaveLength(0);
  });
  it('fewer than 3 laps, a loop that is not clean, or numbers that are not numbers: nothing is queued', () => {
    setup();
    const no = (o) => { expect(agent._kiteLoopSubmit(loopSummary(o), Date.now()).status, JSON.stringify(o)).toBe(400); };
    no({ laps: 2 }); no({ laps: 0 });
    no({ drift_u: 118 * 0.08 + 1 }); no({ wobble_u: 118 * 0.10 + 1 });          // not clean
    no({ r: 19 }); no({ r: 501 }); no({ lap_s: 0 }); no({ speed_pct: 0 });
    no({ dir: 'sideways' }); no({ cx: '500' }); no({ cx: null }); no({ r: NaN }); no({ cz: Infinity });
    expect(agent._kiteLoopSubmit(null, Date.now()).status).toBe(400);
    expect(queue).toHaveLength(0);
    expect(agent._kiteLoopSubmit(loopSummary({ drift_u: 118 * 0.08 }), Date.now()).status).toBe(200);   // exactly on the line is clean
  });
  it('extra fields on the Map\'s body (a name, a path) never reach the queue', () => {
    setup();
    agent._kiteLoopSubmit(Object.assign(loopSummary(), { character: 'Aldenmar', name: 'Aldenmar', path: [[1, 2]], agent_state: { x: 1 } }), Date.now());
    expect(queue).toHaveLength(1);
    expect(Object.keys(queue[0].payload).sort()).toEqual(CONTRACT_KEYS);
  });
  it('the Map\'s POST handler answers through the same gate (and refuses a foreign page)', async () => {
    setup();
    const post = async (body, headers = {}) => {
      const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = JSON.parse(b); } };
      const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      await agent._handleKiteLoopPost({ url: '/api/kite-loop', method: 'POST', headers, async *[Symbol.asyncIterator]() { yield buf; } }, res);
      return res;
    };
    expect((await post(loopSummary())).code).toBe(200);
    expect(queue).toHaveLength(1);
    expect((await post(loopSummary(), { origin: 'https://evil.example' })).code).toBe(403);
    expect((await post('{nope')).code).toBe(400);
    expect((await post(' '.repeat(3000))).code).toBe(413);
    expect(queue).toHaveLength(1);
  });
});

describe('agent: the guild\'s loops coming in', () => {
  const GOOD = { id: 5, cx: 500, cy: -300, cz: 12, r: 118, lap_s: 12.4, speed_pct: 104, dir: 'cw', drift_u: 3, wobble_u: 2, laps: 9, seen: 7, last_at: '2026-10-14T20:00:00Z' };
  let realFetch, fetchMock;
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const setup = (token = 't0k') => {
    agent._setUploadOptsForTest({ botUrl: BOT, token, dryRun: false });
    agent._setZealStateForTest('Aldenmar', { zone: 164, updatedAt: Date.now() });
  };
  const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));
  beforeEach(() => {
    realFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => reply(200, { loops: [GOOD] }));
    globalThis.fetch = fetchMock;
    agent._kiteLoopCache.clear();
    agent._applyCharacterPrefsResponse({ prefs: {} });
    agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    agent._setUploadOptsForTest(null);
    agent._setZealStateForTest('Aldenmar', null);
    agent._applyCharacterPrefsResponse({ prefs: {} });
    agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  });

  it('asks the bot for the zone once, caches it for 10 minutes, and asks again after', async () => {
    setup();
    const t = 1_000_000;
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t)).toEqual([]);               // empty while the first fetch is out
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://bot.test/api/agent/kite-loops?zone=thedeep');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer t0k');
    await settle();
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 5 * 60_000)).toEqual([GOOD]);
    expect(fetchMock).toHaveBeenCalledTimes(1);                                      // still fresh
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 10 * 60_000 + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);                                      // stale: asked again (and still serves the old list meanwhile)
    agent._kiteLoopsFor('potimea', 'Aldenmar', t);
    expect(fetchMock).toHaveBeenCalledTimes(3);                                      // a zone of its own
  });
  it('a 404 (an older bot) is "none", not an error, and is not asked again for 10 minutes', async () => {
    setup();
    fetchMock.mockImplementation(async () => reply(404, null));
    const t = 2_000_000;
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t);
    await settle();
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 1000)).toEqual([]);
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 9 * 60_000)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 10 * 60_000 + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('a network error or a 500 keeps what it had and retries in 2 minutes', async () => {
    setup();
    const t = 3_000_000;
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t);
    await settle();
    fetchMock.mockImplementation(async () => { throw new Error('offline'); });
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 10 * 60_000 + 1);
    await settle();
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 10 * 60_000 + 2)).toEqual([GOOD]);
    fetchMock.mockImplementation(async () => reply(500, null));
    agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 13 * 60_000);
    await settle();
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', t + 13 * 60_000 + 1)).toEqual([GOOD]);
  });
  it('local mode, an excluded character and the kill switch ask for nothing and serve nothing', async () => {
    setup(null);
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', 4_000_000)).toEqual([]);
    setup();
    agent._applyCharacterPrefsResponse({ prefs: { Aldenmar: { exclude_from_stats: true } } });
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', 4_000_000)).toEqual([]);
    agent._applyCharacterPrefsResponse({ prefs: {} });
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    expect(agent._kiteLoopsFor('thedeep', 'Aldenmar', 4_000_000)).toEqual([]);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps only well-formed loops, only the fields the Map draws, at most 60', () => {
    const many = Array.from({ length: 80 }, (_, i) => Object.assign({}, GOOD, { id: i }));
    expect(agent._kiteLoopsClean(many)).toHaveLength(60);
    const out = agent._kiteLoopsClean([GOOD, null, 'x', { ...GOOD, r: 5 }, { ...GOOD, r: '118' }, { ...GOOD, dir: 'up' }, { ...GOOD, lap_s: 0 }, { ...GOOD, secret: 'x', name: 'Aldenmar' }, { cx: 1 }]);
    expect(out).toHaveLength(2);
    expect(Object.keys(out[1]).sort()).toEqual(['cx', 'cy', 'cz', 'dir', 'drift_u', 'id', 'lap_s', 'laps', 'last_at', 'r', 'seen', 'speed_pct', 'wobble_u']);
    expect(agent._kiteLoopsClean('nope')).toEqual([]); expect(agent._kiteLoopsClean(undefined)).toEqual([]);
  });
  it('the Map\'s GET handler returns { loops }, 400 without a sane zone, 403 for a foreign page', async () => {
    setup();
    const get = (url, headers = {}) => { const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = JSON.parse(b); } }; agent._handleKiteLoopsGet({ url, method: 'GET', headers }, res); return res; };
    expect(get('/api/kite-loops?zone=thedeep').body).toEqual({ loops: [] });
    await settle();
    expect(get('/api/kite-loops?zone=thedeep').body).toEqual({ loops: [GOOD] });
    expect(get('/api/kite-loops').code).toBe(400);
    expect(get('/api/kite-loops?zone=../etc').code).toBe(400);
    expect(get('/api/kite-loops?zone=thedeep', { origin: 'https://evil.example' }).code).toBe(403);
  });
});

// ───────────────────────────── 3. map.html ─────────────────────────────

describe('map.html: the coach on the Map page', () => {
  let clock, nowSpy;
  beforeEach(() => { clock = 1_760_000_000_000; nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock); });
  afterEach(() => nowSpy.mockRestore());
  const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

  async function boot({ store = {}, kiteLoops, withCoach = true } = {}) {
    const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
    const all = {}, canvas = { arcs: [], dashes: [] }, docListeners = {};
    const mkEl = (tag) => {
      const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '',
        clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
        getContext() {
          return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : (...a) => { if (k === 'arc') canvas.arcs.push(a); if (k === 'setLineDash') canvas.dashes.push(a[0]); }), set: () => true });
        },
      };
      Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
      Object.defineProperty(e, 'textContent', { get() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._tc; }, set(v) { this._tc = v; if (v === '') this.children.length = 0; } });
      Object.defineProperty(e, 'innerHTML', { get() { return this._ih || ''; }, set(v) { this._ih = v; if (v === '') this.children.length = 0; } });
      return e;
    };
    const doc = {
      getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
      createElement: mkEl, createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
      addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); }, hidden: false,
      body: mkEl('body'), documentElement: { style: { setProperty() {} } },
    };
    const payload = {
      zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: clock, local_only: false,
      points: [], map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 200 } },
      self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [], timers: [],
    };
    const calls = [];
    const fetchImpl = (u, o) => {
      calls.push({ url: String(u), opts: o || null });
      if (/\/api\/map-state/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
      if (/\/api\/kite-loops/.test(u)) {
        if (kiteLoops === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('no body')) });
        if (kiteLoops === 'down') return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ loops: kiteLoops || [] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    };
    const win = { addEventListener() {}, devicePixelRatio: 1, mimic: { onMapPos: (cb) => { win.pushPos = cb; } } };
    if (withCoach) win.WPKite = KC;
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    // eslint-disable-next-line no-new-func
    const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
      script + '\nreturn S;')(win, doc, { search: '' }, fetchImpl, ls, undefined, () => 1, () => {});
    await tick();
    const drive = (path, secs, hz = 10) => {
      for (let i = 0; i < secs * hz; i++) {
        clock += 1000 / hz;
        const p = path((clock - t0) / 1000);
        win.pushPos({ character: 'Aldenmar', zone_id: null, at: clock, self: { x: p.x, y: p.y, z: p.z, heading: 0 }, group: [], raid: [], target: null });
      }
    };
    const t0 = clock;
    const posts = () => calls.filter(c => /\/api\/kite-loop$/.test(c.url));
    const chip = () => all.kiteChip.children.map(c => c.textContent).join('');
    const hoverAt = (x, y) => {   // the cursor over a server-frame point: client px = the Map's own forward transform
      const v = S.view, px = (-x - v.cx) * v.scale + S.w / 2, py = (-y - v.cy) * v.scale + S.h / 2;
      (docListeners.mousemove || []).forEach(f => f({ clientX: px, clientY: py }));
    };
    return { S, all, win, calls, canvas, drive, posts, chip, hoverAt, t0 };
  }

  const GUILD = { id: 5, cx: 500, cy: -300, cz: 12, r: 118, lap_s: 12.4, speed_pct: 104, dir: 'cw', drift_u: 3, wobble_u: 2, laps: 9, seen: 7, last_at: '2026-10-14T20:00:00Z' };
  const KITE = (o) => circle(Object.assign({ cx: 500, cy: -300, noise: 0.8, seed: 4 }, o));
  // circle() takes seconds from its own start, so shift by the harness clock

  it('a clean run posts ONE summary to the local agent (the agent decides whether it leaves), with the contract fields and no name', async () => {
    const m = await boot();
    m.drive(KITE(), 75);
    expect(m.S.kiteView).not.toBeNull();
    const posts = m.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('http://127.0.0.1:7779/api/kite-loop');
    expect(posts[0].opts.method).toBe('POST');
    const body = JSON.parse(posts[0].opts.body);
    expect(Object.keys(body).sort()).toEqual(['cx', 'cy', 'cz', 'dir', 'drift_u', 'lap_s', 'laps', 'r', 'speed_pct', 'wobble_u', 'zone']);
    expect(body).toMatchObject({ zone: 'thedeep', dir: 'cw', laps: 3 });
    expect(Math.abs(body.r - 118)).toBeLessThan(2.5);
    expect(posts[0].opts.body).not.toMatch(/Aldenmar/i);
    m.drive(KITE(), 60);                                           // keep circling: still the one
    expect(m.posts()).toHaveLength(1);
  });
  it('a drifting circle shows the chip (red) and posts nothing', async () => {
    const m = await boot({ kiteLoops: [GUILD] });
    m.drive(KITE({ drift: [1.5, 0] }), 90);
    expect(m.posts()).toHaveLength(0);
    expect(m.S.kiteView.cls).toBe('r');
    m.hoverAt(500, -300 - 118);                                    // any repaint; the hover on the guild ring forces one
    expect(m.chip()).toMatch(/^Lap 12\.\d s · r 11\d · drift 1\d u W · wobble \d · \d+%/);
    expect(m.all.kiteChip.hidden).toBe(false);
    expect(m.all.kiteChip.children.find(c => c.className === 'r').textContent).toMatch(/^drift 1\d u W$/);
  });
  it('a lap with a likely cause says it on the chip, in the drift colour, with the numbers on hover', async () => {
    const m = await boot({ kiteLoops: [GUILD] });
    const path = steer({ shoves: [{ at: 28.3, dx: 6, dy: 0 }] });
    for (let i = 0; i < 40 && !(m.S.kiteView && m.S.kiteView.cur.cause); i++) m.drive(path, 2);
    expect(m.S.kiteView.cur.cause.kind).toBe('pushed');
    m.hoverAt(500, -300 - 118);                                     // any repaint; the hover on the guild ring forces one
    expect(m.chip()).toMatch(/drift \d+ u [NSEW]+ ← pushed · wobble/);
    const span = m.all.kiteChip.children.find(c => c.className && c.className !== 'gd');
    expect(span.textContent).toMatch(/^drift \d+ u [NSEW]+ ← pushed$/);
    expect(span.title).toBe(m.S.kiteView.why); expect(span.title).toMatch(/^shoved \d u in one step/);
    expect(span.style.pointerEvents).toBe('auto');                  // the chip is click-through; only this span takes the pointer
  });
  it('a lap with no cause is the chip it always was: no arrow word, no tooltip', async () => {
    const m = await boot({ kiteLoops: [GUILD] });
    m.drive(KITE({ drift: [1.5, 0] }), 90);
    m.hoverAt(500, -300 - 118);
    expect(m.chip()).toMatch(/drift 1\d u W/);                      // the chip is up (this is not an empty read) ...
    expect(m.chip()).not.toMatch(/←/);
    expect(m.all.kiteChip.children.every(c => !c.title)).toBe(true);
  });
  it('"vs guild" shows when the loop is on a guild loop, and the loop is drawn dashed at its radius', async () => {
    const m = await boot({ kiteLoops: [GUILD] });
    expect(m.S.guild.loops).toEqual([GUILD]);
    m.drive(KITE({ lap: 13.2 }), 60);
    m.hoverAt(500, -300 - 118);
    expect(m.chip()).toMatch(/ · vs guild: \+0\.\d s\/lap, centre \d u off$/);
    expect(m.canvas.dashes).toContainEqual([6, 5]);                // the guild ring is dashed
    expect(m.canvas.arcs.some(a => Math.abs(a[2] - 118 * m.S.view.scale) < 1e-6)).toBe(true);
    expect(m.S.hoverLoop).toBe('5');                               // hovering its ring labels it
  });
  it('asks the agent for the zone\'s guild loops on arrival; a 404, an outage and junk all read as "none"', async () => {
    const ok = await boot({ kiteLoops: [GUILD, { cx: 1 }, null] });
    expect(ok.calls.filter(c => /kite-loops/.test(c.url)).map(c => c.url)).toEqual(['http://127.0.0.1:7779/api/kite-loops?zone=thedeep']);
    expect(ok.S.guild.loops).toEqual([GUILD]);
    for (const k of [404, 'down']) {
      const m = await boot({ kiteLoops: k });
      expect(m.S.guild.loops).toEqual([]);
      m.drive(KITE(), 25);                                         // and the page carries on coaching
      expect(m.S.kiteView).not.toBeNull();
    }
  });
  it('Kite coach off: no listening, no chip, no post. Guild kite loops off: no request, no rings', async () => {
    const off = await boot({ kiteLoops: [GUILD] });
    off.S.cfg.show.kite = false;
    off.drive(KITE(), 80);
    expect(off.posts()).toHaveLength(0);
    expect(off.S.kiteView).toBeNull();
    expect(off.S.kite.engaged()).toBe(false);
    const loopsOff = await boot({ store: { 'wp-map-cfg': JSON.stringify({ show: { kiteLoops: false } }) }, kiteLoops: [GUILD] });
    expect(loopsOff.calls.some(c => /kite-loops/.test(c.url))).toBe(false);
    expect(loopsOff.S.guild.loops).toEqual([]);
  });
  it('both switches are in the Map settings, on by default, and saved', async () => {
    const m = await boot();
    expect(m.S.cfg.show.kite).toBe(true); expect(m.S.cfg.show.kiteLoops).toBe(true);
    const old = await boot({ store: { 'wp-map-cfg': JSON.stringify({ show: { walls: false } }) } });    // a save from before the switches existed
    expect(old.S.cfg.show.kite).toBe(true); expect(old.S.cfg.show.kiteLoops).toBe(true);
    const saved = await boot({ store: { 'wp-map-cfg': JSON.stringify({ show: { kite: false, kiteLoops: false } }) } });
    expect(saved.S.cfg.show.kite).toBe(false); expect(saved.S.cfg.show.kiteLoops).toBe(false);
  });
  it('without kiteCoach.js the Map still runs (nothing coaches, nothing is asked)', async () => {
    const m = await boot({ withCoach: false });
    expect(m.S.kite).toBeNull();
    m.drive(KITE(), 10);
    expect(m.calls.some(c => /kite/.test(c.url))).toBe(false);
  });
  it('the Timers pop-out never coaches or uploads (it hears the same positions)', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/S\.kite = KC && !PART_TIMERS \? KC\.create\(\) : null;/);
  });
});

// ───────────────────────────── 3b. the Tail slider ─────────────────────────────
// The guild lead, 2026-10-15 (a kited mob's crumb trail piled into a scribble): "we need a slider for tail history".

describe('Tail: how much of the target\'s trail is drawn, by time', () => {
  const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
  // eslint-disable-next-line no-new-func
  const H = new Function(helpers + '\nreturn { tailFrom, tailFade, tailLabel, TAIL_STEPS, TAIL_DEFAULT, TAIL_FADES, mergeMapCfg, mapCfgDefaults, trailStep, TRAIL_MAX };')();
  const crumbs = (agesSec, now) => agesSec.map((a, i) => ({ x: i * 10, y: 0, t: now - a * 1000 }));   // oldest first

  it('the first crumb inside the window; crumbs exactly on the edge are in', () => {
    const now = 1_000_000;
    const pts = crumbs([300, 200, 100, 61, 60, 30, 5, 0], now);
    expect(H.tailFrom(pts, now, 60)).toBe(4);              // 60 s old is still in, 61 s is out
    expect(H.tailFrom(pts, now, 10)).toBe(6);
    expect(H.tailFrom(pts, now, 300)).toBe(0);             // everything
    expect(H.tailFrom(pts, now, 1)).toBe(7);               // only the newest
    expect(H.tailFrom(crumbs([500, 400], now), now, 60)).toBe(2);   // all too old: none
    expect(H.tailFrom([], now, 60)).toBe(0);
  });
  it('is by TIME, not by count: the same window keeps few crumbs of a slow mob and many of a fast one', () => {
    const now = 5_000_000;
    const slow = crumbs([120, 90, 60, 30, 0], now), fast = crumbs(Array.from({ length: 61 }, (_, i) => 60 - i), now);
    expect(slow.length - H.tailFrom(slow, now, 60)).toBe(3);
    expect(fast.length - H.tailFrom(fast, now, 60)).toBe(61);
  });
  it('real crumbs carry the time they were laid (trailStep stamps t), so the filter has something to read', () => {
    let tr = null;
    for (let i = 0; i < 5; i++) tr = H.trailStep(tr, 't:1', i * 10, 0, 1000 + i * 1000, false);
    expect(tr.pts.map(c => c.t)).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(H.tailFrom(tr.pts, 5000, 2)).toBe(2);
  });
  it('older crumbs fade: four strengths by age quarter, newest strongest', () => {
    expect([0, 14, 16, 29, 31, 44, 46, 59, 60, 90].map(a => H.tailFade(a * 1000, 60))).toEqual([1, 1, 0.75, 0.75, 0.5, 0.5, 0.3, 0.3, 0.3, 0.3]);
    expect(H.TAIL_FADES[0]).toBe(1);
  });
  it('the slider: Off .. 10 s .. 5 min, default 60 s; a save is kept only if it is one of the steps', () => {
    expect(H.TAIL_STEPS[0]).toBe(0); expect(H.TAIL_STEPS[H.TAIL_STEPS.length - 1]).toBe(300);
    expect(H.TAIL_STEPS).toContain(10);
    expect(H.TAIL_DEFAULT).toBe(60);
    expect(H.mapCfgDefaults().tail).toBe(60);
    expect(H.mergeMapCfg(null).tail).toBe(60);
    expect(H.mergeMapCfg({ tail: 0 }).tail).toBe(0);
    expect(H.mergeMapCfg({ tail: 300 }).tail).toBe(300);
    for (const bad of [7, -1, '60', null, NaN, 999999]) expect(H.mergeMapCfg({ tail: bad }).tail, String(bad)).toBe(60);
    expect(H.tailLabel(0)).toBe('Off'); expect(H.tailLabel(10)).toBe('10 s'); expect(H.tailLabel(60)).toBe('1 min'); expect(H.tailLabel(300)).toBe('5 min');
    expect(H.TRAIL_MAX).toBe(600);                         // the memory cap stays the upper bound
  });
  it('drawTrail draws only the crumbs inside the window (and all of them with no window)', () => {
    const calls = [];
    const ctx = new Proxy({}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); }, set: () => true });
    const body = sliceBlock(MAP_HTML, 'function drawTrail(tr, head, grid, legColour, alpha, tailSec) {', '\n  function halo(');
    // eslint-disable-next-line no-new-func
    const drawTrail = new Function('ctx', 'wpt', 'fillArrow', 'legArrow', 'LEG_ARROW_AT', 'TRAIL_COL', 'tailFrom', 'tailFade', 'TAIL_FADES', 'Date',
      body.replace(/\n  function halo\($/, '') + '\nreturn drawTrail;')(ctx, (x, y) => [x, y], () => {}, () => {}, 0.5, H.TRAIL_COL || { path: '#ff0', away: '#f00', back: '#f80' },
      H.tailFrom, H.tailFade, H.TAIL_FADES, { now: () => 100_000 });
    const now = 100_000, tr = { pts: crumbs([200, 120, 61, 59, 30, 10, 0], now).map(c => Object.assign(c, { st: 'path' })), legs: [] };
    const colourSegs = () => calls.filter(c => c[0] === 'lineTo').length;
    drawTrail(tr, [60, 0], null, '#0f0', 1, 60);
    const windowed = colourSegs();
    calls.length = 0;
    drawTrail(tr, [60, 0], null, '#0f0', 1, null);
    const all = colourSegs();
    // casing pass + colour pass both lay one line per segment: 4 crumbs in the window make 4 segments (the one joining the 61 s crumb is cut), 6 in all
    expect(windowed).toBeLessThan(all);
    expect(all - windowed).toBe(2 * 2);                    // two segments fewer, each laid in the casing and in the colour pass (+ the heading arrow is the same in both)
  });
  it('the slider writes the setting, saves it, and the target trail call honours Off', async () => {
    const m = await (async () => { const b = await bootForTail(); return b; })();
    m.slider('0'); expect(JSON.parse(m.store['wp-map-cfg']).tail).toBe(0);
    m.slider('7'); expect(JSON.parse(m.store['wp-map-cfg']).tail).toBe(300);
    m.slider('4'); expect(JSON.parse(m.store['wp-map-cfg']).tail).toBe(60);
    expect(m.all.cfgTailVal.textContent).toBe('1 min');
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(SH\.trail && C\.tail > 0\) drawTrail\(tTrail, tq, tGrid, CO\.routeTarget, [^;]*, C\.tail\);/);
    expect(js).toMatch(/ghost = v\.ghost && tail > 0 && gAge <= tail \* 1000 \? v\.ghost : null;/);   // the coach's ghost follows it too
  });
  async function bootForTail() {
    const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
    const all = {}, store = {};
    const mkEl = (tag) => {
      const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
        setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
        getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true }); } };
      Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
      return e;
    };
    const doc = { getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); }, createElement: mkEl, createTextNode: (t) => ({ textContent: t }), addEventListener() {}, hidden: false, body: mkEl('body'), documentElement: { style: { setProperty() {} } } };
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval', script + '\nreturn S;')(
      { addEventListener() {}, devicePixelRatio: 1 }, doc, { search: '' }, () => new Promise(() => {}), ls, undefined, () => 1, () => {});
    return { all, store, slider: (v) => (all.cfgTail.listeners.input || []).forEach(f => f({ target: { value: v } })) };
  }
});

// ───────────────────────────── 4. the wiring ─────────────────────────────

describe('wiring', () => {
  const js = stripJs(MAP_HTML);
  it('map.html loads kiteCoach.js before its own script, and the page is packaged with it', () => {
    expect(MAP_HTML.indexOf('<script src="kiteCoach.js"></script>')).toBeGreaterThan(0);
    expect(MAP_HTML.indexOf('<script src="kiteCoach.js"></script>')).toBeLessThan(MAP_HTML.indexOf('<script>'));
    const pkg = JSON.parse(readSource(path.join(ROOT, 'apps', 'mimic', 'package.json')));
    expect(pkg.build.files).toContain('**/*');
    expect(pkg.build.files.some(f => /kiteCoach|^!\*\*\/\*\.js$/.test(f))).toBe(false);   // nothing excludes it
  });
  it('the Map feeds the coach YOUR spot (not the group\'s) with the time the sample was taken', () => {
    expect(js).toMatch(/put\('self', p\.self\);\s*kiteFeed\(dm \? \(S\.direct\.p\.at \|\| now\)/);
  });
  it('the Map reaches the guild only through the local agent: no bot URL, no IPC, no token in map.html', () => {
    const kite = stripJs(sliceBlock(MAP_HTML, '// ── Kite coach', '// ── end Kite coach ──'));
    expect(kite).toMatch(/http:\/\/127\.0\.0\.1:' \+ PORT \+ '\/api\/kite-loop'/);
    expect(kite).toMatch(/http:\/\/127\.0\.0\.1:' \+ PORT \+ '\/api\/kite-loops\?zone='/);
    expect(kite).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(kite).not.toMatch(/Authorization|token/i);
  });
  it('the agent routes both calls, and they are in the dispatcher next to the other Map calls', () => {
    const a = stripJs(AGENT_SRC);
    expect(a).toMatch(/req\.url === '\/api\/kite-loop' && req\.method === 'POST'\) return _handleKiteLoopPost\(req, res\);/);
    expect(a).toMatch(/split\('\?'\)\[0\] === '\/api\/kite-loops' && req\.method === 'GET'\) return _handleKiteLoopsGet\(req, res\);/);
  });
  it('kite_loop is a "bare" kind: enqueueUpload stamps neither the character nor agent_state on it', () => {
    const a = stripJs(AGENT_SRC);
    expect(a).toMatch(/const _BARE_KINDS\s+= new Set\(\['kite_loop'\]\);/);
    expect(a).toMatch(/!payload\.character && !_BARE_KINDS\.has\(kind\)\) \{/);
    expect(a).toMatch(/!payload\.agent_state && !_BARE_KINDS\.has\(kind\)\) \{/);
  });
  it('the agent has no other writer of kite_loop than the gated submit', () => {
    const a = stripJs(AGENT_SRC);
    expect(a.match(/enqueueUpload\('kite_loop'/g)).toHaveLength(1);
    const submit = sliceBlock(a, 'function _kiteLoopSubmit(b, now) {', '\n}\n');
    expect(submit.indexOf('_ownTimersAllowed(ch)')).toBeGreaterThan(0);
    expect(submit.indexOf('_ownTimersAllowed(ch)')).toBeLessThan(submit.indexOf("enqueueUpload('kite_loop'"));
  });
  it('Mimic needs no new IPC for this (main.js does not mention it)', () => {
    expect(MAIN).not.toMatch(/kite-?loop|kiteCoach|WPKite|kite_loop/i);
    expect(stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')))).not.toMatch(/kite-?loop|kiteCoach|WPKite|kite_loop/i);
  });
});
