// test/run-speed.test.js - the run-speed % the Map and the kite coach show, against Zeal's own.
//
// The guild lead, 2026-10-23: kiting a loop indoors (a bard), Zeal's map read "116%" while ours read 104% (the Map's
// top-left) and about 102% (the kite coach line): "we are not accurate to game". Earlier, 2026-10-14: Zeal 277%, ours 84 u/s.
//
// What Zeal prints (CoastalRedwood/Zeal, Zeal/zone_map.cpp ZoneMap::render_labels, setting_add_speed_text):
//     speed = mount ? mount->MovementSpeed : self->MovementSpeed;   label += format("{:.0f}%", speed * (100.f / 0.7f));
// Entity.MovementSpeed (offset 0x5C) is the speed the entity is moving at NOW (0 stood still: Zeal itself tests
// `entity2->MovementSpeed > 0` for "is moving", game_functions.cpp CalcCombatRange). Zeal's named pipe does NOT carry it
// (named_pipe.cpp's player message is zone, location, heading, autoattack, spawn_id, target_*, pet_id), so we measure.
//
// So 116% is MovementSpeed 0.812 and 277% is 1.939; the two stated readings agree on one scale, 100% = 30.3 u/s,
// IF the measurement is the path walked. The old Map readout was the straight line between two samples 1.5 s apart,
// which on a turn is shorter than the path: at 116% on a loop of radius ~35 it reads 104% (this file shows the number).
//
// Run: npx vitest run test/run-speed.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const KC = require(path.join(ROOT, 'apps', 'mimic', 'kiteCoach.js'));
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H = new Function(helpers + '\nreturn { speedOf, runPct, SPEED_WINDOW_MS, RUN_BASE_UPS };')();

// Zeal's formula, as written in zone_map.cpp.
const zealPct = (movementSpeed) => movementSpeed * (100 / 0.7);

// The Map's readout fed the way updateLocBar feeds it: a position every 200 ms, the window trimmed to ~1.5 s.
function mapReadout(posAt, secs, stepMs = 200) {
  const hist = [], out = [];
  for (let t = 0; t <= secs * 1000; t += stepMs) {
    const p = posAt(t / 1000);
    hist.push({ t, x: p.x, y: p.y });
    while (hist.length > 2 && t - hist[1].t >= H.SPEED_WINDOW_MS) hist.shift();
    const ups = H.speedOf(hist);
    if (ups != null) out.push(ups);
  }
  return out;
}
// The same window, the old way: the straight line between its ends.
function chordOf(hist) { const a = hist[0], b = hist[hist.length - 1]; return Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t) * 1000; }

describe('the scale: Zeal\'s % and our units a second agree on one base', () => {
  it('the two stated readings fit 100% = 30.3 u/s: 277% at 84 u/s, 116% at 35.2 u/s', () => {
    expect(Math.round(zealPct(1.939))).toBe(277);                    // Zeal's number for MovementSpeed 1.939
    expect(Math.round(zealPct(0.812))).toBe(116);
    expect(Math.round(H.runPct(84))).toBe(277);                      // 2026-10-14, a straight run
    expect(Math.round(H.runPct(116 * 0.303))).toBe(116);             // 116% of 30.3 u/s
    expect(84 / zealPct(1.939) * 100).toBeCloseTo(30.3, 0);
  });
  it('the base cannot drift silently: the Map and the kite coach hold the same number, 30.3', () => {
    expect(H.RUN_BASE_UPS).toBe(30.3);
    expect(KC.K.RUN_BASE_UPS).toBe(30.3);
    expect(stripJs(MAP_HTML)).toMatch(/var RUN_BASE_UPS = 30\.3;/);
    expect(KC.K.RUN_BASE_UPS).toBe(H.RUN_BASE_UPS);
  });
});

describe('the Map readout (apps/mimic/map.html speedOf) is the path walked, not the chord', () => {
  it('a straight run at 84 u/s reads 277%', () => {
    const r = mapReadout((s) => ({ x: 84 * s, y: 0 }), 6);
    for (const ups of r) expect(Math.round(H.runPct(ups))).toBe(277);
  });
  it('kiting a tight loop at Zeal\'s 116% reads 116%; the old chord read ~104% (the report)', () => {
    const R = 35, v = 0.303 * 116;                                    // radius, u/s
    const posAt = (s) => ({ x: R * Math.cos(v * s / R), y: R * Math.sin(v * s / R) });
    const reads = mapReadout(posAt, 12);
    expect(reads.length).toBeGreaterThan(30);
    for (const ups of reads) expect(Math.abs(H.runPct(ups) - 116)).toBeLessThan(1.5);
    // non-vacuous: the straight line between the window's ends is the reported ~104%
    const hist = []; let worst = 0;   // the largest chord reading once the window has filled
    for (let t = 0; t <= 12000; t += 200) {
      const p = posAt(t / 1000); hist.push({ t, x: p.x, y: p.y });
      while (hist.length > 2 && t - hist[1].t >= H.SPEED_WINDOW_MS) hist.shift();
      if (t >= 2000) worst = Math.max(worst, H.runPct(chordOf(hist)));
    }
    expect(worst).toBeLessThan(108);
    expect(worst).toBeGreaterThan(100);
  });
  it('standing still reads 0% (Zeal\'s MovementSpeed is 0 stopped), and under a second is not shown', () => {
    for (const ups of mapReadout(() => ({ x: 5, y: 5 }), 4)) expect(H.runPct(ups)).toBe(0);
    expect(H.speedOf([{ t: 0, x: 0, y: 0 }, { t: 900, x: 30, y: 40 }])).toBeNull();
  });
  it('a stop mid-window counts only the ground covered, and the path through a corner is summed', () => {
    // 3-4-5 out, 3-4-5 back along a different line: chord 0 would read 0.
    expect(H.speedOf([{ t: 0, x: 0, y: 0 }, { t: 500, x: 30, y: 40 }, { t: 1000, x: 60, y: 0 }])).toBeCloseTo(100);
  });
});

// A rounded square (superellipse |x/a|^n + |y/a|^n = a^n) walked at constant speed v, as the kite coach's samples.
function squarish(n, a, v) {
  const N = 20000, pts = []; let L = 0, prev = null;
  for (let i = 0; i <= N; i++) {
    const th = 2 * Math.PI * i / N, c = Math.cos(th), s = Math.sin(th);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y = a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (prev) L += Math.hypot(x - prev.x, y - prev.y);
    pts.push({ x, y, L }); prev = { x, y };
  }
  return (s) => {
    const d = ((v * s % L) + L) % L; let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].L <= d) lo = m; else hi = m; }
    return pts[lo];
  };
}
function lapsOf(posAt, secs, hz = 10) {
  const coach = KC.create(), laps = [];
  for (let i = 0; i < secs * hz; i++) {
    const s = i / hz, p = posAt(s);
    for (const e of coach.push(1_000_000 + s * 1000, 500 + p.x, -300 + p.y, 12)) if (e.type === 'lap') laps.push(e.lap);
  }
  return laps;
}

describe('the kite coach lap speed (apps/mimic/kiteCoach.js) is the path walked a second', () => {
  it('pathUps: a polyline of samples >= PATH_STEP_MS apart, jitter between them ignored', () => {
    const line = Array.from({ length: 41 }, (_, i) => ({ t: i * 100, x: 3.5 * i + (i % 2 ? 0.8 : -0.8), y: 0 }));   // 35 u/s, +-0.8 jitter
    expect(KC.pathUps(line)).toBeGreaterThan(34); expect(KC.pathUps(line)).toBeLessThan(36.5);
    expect(KC.pathUps([{ t: 0, x: 0, y: 0 }])).toBe(0);
    expect(KC.pathUps([])).toBe(0);
  });
  it('a clean circle: the lap speed is its real speed (2 pi r / lap) as a % of 30.3', () => {
    const v = 2 * Math.PI * 118 / 12.4;
    const laps = lapsOf((s) => ({ x: -118 * Math.cos(2 * Math.PI * s / 12.4), y: -118 * Math.sin(2 * Math.PI * s / 12.4) }), 70);
    expect(laps.length).toBeGreaterThanOrEqual(4);
    for (const l of laps) expect(Math.abs(l.speedPct - v / 30.3 * 100)).toBeLessThan(2);
  });
  it('a rounded-square loop at 116%: closer to Zeal than the old 2 pi r / lap, and within 3%', () => {
    const v = 0.303 * 116, laps = lapsOf(squarish(8, 40, v), 70);
    expect(laps.length).toBeGreaterThanOrEqual(3);
    for (const l of laps) {
      const old = 2 * Math.PI * l.r / l.lapS / 30.3 * 100;
      expect(Math.abs(l.speedPct - 116)).toBeLessThan(3);
      expect(Math.abs(l.speedPct - 116)).toBeLessThan(Math.abs(old - 116));
    }
  });
});

describe('wiring that cannot be run here', () => {
  it('the Map tooltip says the number is measured; the Map and the coach have no 2 pi r / chord shortcut left', () => {
    expect(MAP_HTML).toContain('units a second measured from your movement');
    const kc = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'kiteCoach.js')));
    expect(kc).not.toMatch(/TAU \* r \/ lapS/);
    expect(kc).toMatch(/speedPct\(pathUps\(pts\)\)/);
    expect(kc).toMatch(/speedPct\(pathUps\(w\)\)/);
  });
});
