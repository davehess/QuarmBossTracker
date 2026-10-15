// test/replay-sessions-framing.test.js — /spectator/replay: the sessions inside a night, the steady 2D framing and
// the 3D camera rules. All pure code (web/lib/raidReplay.ts, replayFraming.ts, replayCamera.ts); nothing here
// draws, so the on-screen result is still a browser check.
//
// The guild lead, 2026-10-15: "yesterday's raids included ones from the morning sessions which were mostly
// nonguild. we should focus in on the guild raids ... the view will jump a ton when it shouldn't. it needs to keep
// all of the raiders in view, or at least 80% of them. in 3d mode vision should be from inside of the zone's normal
// area not outside the bounds."
//
// Corpora sit on both sides of every threshold (a 20-minute gap and a 21-minute one, a raider inside the window and
// one a minute outside it) so a rule that was never applied cannot pass. Names, where any, are invented.
//
// Run: npx vitest run test/replay-sessions-framing.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MINUTE_MS, SESSION_GAP_MS, splitSessions, summarizeNights, overlapsRaidWindow, raidWindows, defaultSessionIndex,
  sessionRange, sessionLabel, parseSessionParam, sessionSearch,
} from '../web/lib/raidReplay.ts';
import {
  FRAME_KEEP, keepNearest, coverageBox, targetView, outsideFraction, exceedsHysteresis, easeView, easeScale, frameStep,
} from '../web/lib/replayFraming.ts';
import {
  raidFocus, desiredRig, boundsFromServer, clampToBounds, buildTriGrid, segmentHit, constrainCamera, easeRig,
  CAM_HEIGHT_MIN, CAM_HEIGHT_MAX, CAM_MIN_DIST, CAM_PITCH,
} from '../web/lib/replayCamera.ts';
import { serverToThree } from '../web/lib/zoneMesh.ts';
import { ROOT, stripJs } from './_source-slice.js';

const Z = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);   // a UTC instant
const mins = (start, n) => Array.from({ length: n }, (_, i) => ({ t: start + i * MINUTE_MS }));

// ── splitting a night into sessions ──────────────────────────────────────────

describe('splitSessions', () => {
  const t0 = Z(2026, 10, 14, 13);
  it('keeps minutes together across a silence of exactly 20 minutes and splits past it', () => {
    // the first group's last minute starts at t0 + 4 min and ends at t0 + 5 min; the gap is measured from there
    const g = (gapMin) => splitSessions([...mins(t0, 5), ...mins(t0 + (5 + gapMin) * MINUTE_MS, 5)]);
    expect(SESSION_GAP_MS).toBe(20 * MINUTE_MS);
    expect(g(20)).toHaveLength(1);
    expect(g(21)).toHaveLength(2);
    expect(g(21).map(s => s.length)).toEqual([5, 5]);
  });
  it('an empty list is no sessions', () => {
    expect(splitSessions([])).toEqual([]);
  });
});

// ── the guild raid window, 19:30-00:30 Eastern ──────────────────────────────

describe('overlapsRaidWindow', () => {
  it('summer (EDT, UTC-4): 19:30 ET is 23:30Z, the window ends 04:30Z', () => {
    expect(overlapsRaidWindow(Z(2026, 10, 14, 23, 20), Z(2026, 10, 14, 23, 29))).toBe(false);   // 19:20-19:29 ET
    expect(overlapsRaidWindow(Z(2026, 10, 14, 23, 20), Z(2026, 10, 14, 23, 31))).toBe(true);    // reaches 19:31 ET
    expect(overlapsRaidWindow(Z(2026, 10, 15, 4, 20), Z(2026, 10, 15, 4, 29))).toBe(true);      // 00:20-00:29 ET
    expect(overlapsRaidWindow(Z(2026, 10, 15, 4, 30), Z(2026, 10, 15, 5, 0))).toBe(false);      // from 00:30 ET on
  });
  it('winter (EST, UTC-5): 19:30 ET is 00:30Z the next day', () => {
    expect(overlapsRaidWindow(Z(2027, 1, 15, 0, 10), Z(2027, 1, 15, 0, 29))).toBe(false);       // 19:10-19:29 ET
    expect(overlapsRaidWindow(Z(2027, 1, 15, 0, 31), Z(2027, 1, 15, 1, 0))).toBe(true);
    expect(overlapsRaidWindow(Z(2027, 1, 15, 5, 20), Z(2027, 1, 15, 5, 29))).toBe(true);        // 00:20-00:29 ET
    expect(overlapsRaidWindow(Z(2027, 1, 15, 5, 30), Z(2027, 1, 15, 6, 0))).toBe(false);
  });
  it('is right on both sides of the clock change (fall back on 2026-11-01)', () => {
    // Sat Oct 31 evening is still EDT, Sun Nov 1 evening is EST
    expect(raidWindows(Z(2026, 10, 31, 23, 30), Z(2026, 10, 31, 23, 31)).some(w => w.from === Z(2026, 10, 31, 23, 30))).toBe(true);
    expect(raidWindows(Z(2026, 11, 2, 0, 30), Z(2026, 11, 2, 0, 31)).some(w => w.from === Z(2026, 11, 2, 0, 30))).toBe(true);
    expect(overlapsRaidWindow(Z(2026, 11, 1, 23, 40), Z(2026, 11, 1, 23, 50))).toBe(false);     // 18:40 ET: before it opens
    expect(overlapsRaidWindow(Z(2026, 11, 2, 0, 40), Z(2026, 11, 2, 0, 50))).toBe(true);        // 19:40 ET
  });
  it('is the clock, not the weekday: a Tuesday and a Friday evening both count', () => {
    expect(overlapsRaidWindow(Z(2026, 10, 14, 0, 30), Z(2026, 10, 14, 2, 0))).toBe(true);       // Tue 8:30 PM ET
    expect(overlapsRaidWindow(Z(2026, 10, 17, 0, 30), Z(2026, 10, 17, 2, 0))).toBe(true);       // Fri 8:30 PM ET
  });
  it('a morning group does not count', () => {
    expect(overlapsRaidWindow(Z(2026, 10, 14, 13, 8), Z(2026, 10, 14, 15, 20))).toBe(false);    // 9:08-11:20 AM ET
  });
});

// ── a night split into a daytime group and the raid ─────────────────────────

const row = (night_key, t, raiders, zones = ['cazicthule']) => ({ night_key, minute_at: new Date(t).toISOString(), zones, raiders });
const run = (night, start, n, raiders, zones) => Array.from({ length: n }, (_, i) => row(night, start + i * MINUTE_MS, raiders, zones));

describe('summarizeNights sessions', () => {
  // 10/14/2026 (ET): 9:08 AM-11:20 AM with 6 raiders, then 8:00 PM-11:42 PM with up to 31
  const morning = run('10/14/2026', Z(2026, 10, 14, 13, 8), 133, 6, ['veksar']);
  const evening = run('10/14/2026', Z(2026, 10, 15, 0, 0), 223, 28, ['cazicthule']);
  evening[100] = row('10/14/2026', Z(2026, 10, 15, 0, 100), 31, ['cazicthule']);
  const [night] = summarizeNights([...evening, ...morning]);

  it('is two sessions, oldest first, with the guild raid marked', () => {
    expect(night.sessions).toHaveLength(2);
    expect(night.sessions.map(s => s.raid)).toEqual([false, true]);
    expect(night.sessions[0].from).toBe(Z(2026, 10, 14, 13, 8));
    expect(night.sessions[1].from).toBe(Z(2026, 10, 15, 0, 0));
    expect(night.sessions[1].to).toBe(Z(2026, 10, 15, 0, 0) + 223 * MINUTE_MS);
  });
  it('keeps the whole-night fields, and gives each session its own zones, spans and peak', () => {
    expect(night.minutes).toBe(133 + 223);
    expect(night.sessions[0].zones).toEqual(['veksar']);
    expect(night.sessions[1].zones).toEqual(['cazicthule']);
    expect(night.sessions.map(s => s.peak)).toEqual([6, 31]);
    expect(night.sessions[0].spans).toEqual([{ from: night.sessions[0].from, to: night.sessions[0].to }]);
    expect(night.sessions[0].minutes).toBe(133);
  });
  it('opens on the raid; with no raid session it opens on the biggest', () => {
    expect(defaultSessionIndex(night.sessions)).toBe(1);
    const [quiet] = summarizeNights([
      ...run('10/13/2026', Z(2026, 10, 13, 13), 20, 4),
      ...run('10/13/2026', Z(2026, 10, 13, 16), 45, 9),
    ]);
    expect(quiet.sessions.map(s => s.raid)).toEqual([false, false]);
    expect(quiet.sessions.map(s => s.minutes)).toEqual([20, 45]);
    expect(defaultSessionIndex(quiet.sessions)).toBe(1);
    expect(defaultSessionIndex([])).toBe(-1);
  });
  it('the raid session wins even when a daytime one is longer', () => {
    expect(defaultSessionIndex([{ raid: false, minutes: 300, from: 1 }, { raid: true, minutes: 40, from: 2 }])).toBe(1);
    expect(defaultSessionIndex([{ raid: true, minutes: 40, from: 1 }, { raid: true, minutes: 90, from: 2 }])).toBe(1);
  });
  it('rows with no raiders column give a null peak', () => {
    const [n] = summarizeNights([{ night_key: '10/12/2026', minute_at: new Date(Z(2026, 10, 12, 14)).toISOString(), zones: [] }]);
    expect(n.sessions[0].peak).toBeNull();
  });
});

describe('session labels', () => {
  it('formats the range in Eastern, dropping the first am/pm when both match', () => {
    expect(sessionRange(Z(2026, 10, 15, 0, 0), Z(2026, 10, 15, 3, 42))).toBe('8:00–11:42 PM');
    expect(sessionRange(Z(2026, 10, 14, 15, 20), Z(2026, 10, 14, 17, 5))).toBe('11:20 AM–1:05 PM');
  });
  it('names the raid and the other sessions as the guild lead asked', () => {
    expect(sessionLabel({ from: Z(2026, 10, 15, 0, 0), to: Z(2026, 10, 15, 3, 42), raid: true, peak: 30 })).toBe('Raid · 8:00–11:42 PM · 30 raiders');
    expect(sessionLabel({ from: Z(2026, 10, 14, 13, 8), to: Z(2026, 10, 14, 15, 20), raid: false, peak: 6 })).toBe('Daytime · 9:08–11:20 AM · 6 raiders');
    expect(sessionLabel({ from: Z(2026, 10, 14, 13, 8), to: Z(2026, 10, 14, 15, 20), raid: false, peak: null })).toBe('Daytime · 9:08–11:20 AM');
    expect(sessionLabel({ from: Z(2026, 10, 14, 13, 8), to: Z(2026, 10, 14, 13, 9), raid: false, peak: 1 })).toBe('Daytime · 9:08–9:09 AM · 1 raider');
    expect(sessionLabel({ from: Z(2026, 10, 15, 6, 0), to: Z(2026, 10, 15, 7, 0), raid: false, peak: 3 })).toMatch(/^Late night · /);
  });
});

describe('?session= in the URL', () => {
  const from = Z(2026, 10, 15, 0, 0);
  it('round-trips and keeps the other params', () => {
    const q = sessionSearch(from, '?follow=Aldenmar&hl=Brackwyn');
    expect(parseSessionParam(q)).toBe(from);
    const u = new URLSearchParams(q);
    expect(u.get('follow')).toBe('Aldenmar');
    expect(u.get('hl')).toBe('Brackwyn');
  });
  it('replaces an old value, and null removes it', () => {
    expect(parseSessionParam(sessionSearch(from, '?session=5'))).toBe(from);
    expect(sessionSearch(null, '?session=5')).toBe('');
  });
  it('ignores junk', () => {
    for (const s of ['', '?session=', '?session=abc', '?session=-5', '?session=0', '?session=12345678901234']) {
      expect(parseSessionParam(s)).toBeNull();
    }
  });
});

// ── steady 2D framing ───────────────────────────────────────────────────────

// A cluster of ten raiders around (0,0), screen frame, ~100 units across.
const cluster = () => Array.from({ length: 10 }, (_, i) => ({ x: (i % 5) * 25 - 50, y: Math.floor(i / 5) * 40 - 20 }));
const W = 800, H = 500;

describe('the 80% box', () => {
  it('keeps the nearest 80% (rounded up), the farthest go first', () => {
    const pts = [...cluster(), { x: 5000, y: 5000 }];
    const kept = keepNearest(pts);
    expect(kept).toHaveLength(9);
    expect(kept.some(p => p.x === 5000)).toBe(false);
    expect(FRAME_KEEP).toBe(0.8);
    expect(keepNearest(Array.from({ length: 15 }, (_, i) => ({ x: i, y: 0 })))).toHaveLength(12);   // not 13: 0.8 * 15 in floats
    expect(keepNearest([{ x: 3, y: 4 }])).toHaveLength(1);
    expect(keepNearest([])).toEqual([]);
  });
  it('one far straggler and ten clustered raiders: the box hugs the ten', () => {
    const box = coverageBox([...cluster(), { x: 5000, y: 5000 }]);
    expect(box.maxX).toBeLessThan(150);
    expect(box.maxY).toBeLessThan(150);
    expect(box.minX).toBeGreaterThan(-150);
    // and it is padded: wider than the raiders it holds
    expect(box.maxX - box.minX).toBeGreaterThan(100);
    // the old rule, everyone in the box, would have spanned 5000
    const view = targetView([...cluster(), { x: 5000, y: 5000 }], W, H);
    expect(view.scale).toBeGreaterThan(1);
  });
  it('a lone raider is framed (never nothing)', () => {
    expect(targetView([{ x: 10, y: 10 }], W, H)).not.toBeNull();
    expect(targetView([], W, H)).toBeNull();
  });
});

describe('hysteresis: the view holds still', () => {
  it('tiny movement causes no zoom change and no pan, for hundreds of frames', () => {
    const base = cluster();
    let s = { view: targetView(base, W, H), goal: null };
    const first = s.view;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let f = 0; f < 400; f++) {
      const pts = base.map(p => ({ x: p.x + rnd() * 3, y: p.y + rnd() * 3 }));
      const r = frameStep(s, pts, W, H, 16, false);
      expect(r.animating).toBe(false);
      expect(r.goal).toBeNull();
      expect(r.view).toBe(first);
      s = r;
    }
  });
  it('a straggler running off does not move the view (one of eleven is under the 20% allowance)', () => {
    const base = cluster();
    let s = { view: targetView(base, W, H), goal: null };
    const first = s.view;
    for (let f = 0; f < 120; f++) {
      s = frameStep(s, [...base, { x: 400 + f * 30, y: 300 }], W, H, 16, false);
      expect(s.view).toBe(first);
    }
  });
  it('but a fifth of the raid leaving the picture does', () => {
    const base = cluster();
    const view = targetView(base, W, H);
    const pts = base.map((p, i) => (i < 3 ? { x: p.x + 2000, y: p.y } : p));    // 3 of 10 gone
    expect(outsideFraction(view, pts, W, H)).toBeGreaterThan(0.2);
    expect(frameStep({ view, goal: null }, pts, W, H, 16, false).goal).not.toBeNull();
    const two = base.map((p, i) => (i < 2 ? { x: p.x + 2000, y: p.y } : p));    // 2 of 10: at the allowance, not past it
    expect(frameStep({ view, goal: null }, two, W, H, 16, false).goal).toBeNull();
  });
  it('the raid spreading out or closing up by more than 25% retargets; by less does not', () => {
    const base = cluster().map(p => ({ x: p.x * 8, y: p.y * 8 }));   // ~800 units across: well over the 300-unit zoom floor
    const view = targetView(base, W, H);
    const scaled = (k) => base.map(p => ({ x: p.x * k, y: p.y * k }));
    expect(exceedsHysteresis(1.2, 0)).toBe(false);
    expect(exceedsHysteresis(1 / 1.2, 0)).toBe(false);
    expect(exceedsHysteresis(1.3, 0)).toBe(true);
    expect(exceedsHysteresis(1 / 1.3, 0)).toBe(true);
    expect(frameStep({ view, goal: null }, scaled(1.1), W, H, 16, false).goal).toBeNull();
    expect(frameStep({ view, goal: null }, scaled(0.6), W, H, 16, false).goal).not.toBeNull();   // clustered tighter: zoom in
    expect(frameStep({ view, goal: null }, scaled(3), W, H, 16, false).goal).not.toBeNull();     // spread out: zoom out
  });
});

describe('easing', () => {
  it('a retarget glides to the target, never overshoots, and stops there', () => {
    const base = cluster();
    const wide = base.map(p => ({ x: p.x * 10, y: p.y * 10 }));
    let s = { view: targetView(base, W, H), goal: null };
    const goal = targetView(wide, W, H);
    let prev = s.view.scale;
    let frames = 0, anim = true;
    while (anim && frames < 2000) {
      s = frameStep(s, wide, W, H, 16, false);
      anim = s.animating;
      expect(s.view.scale).toBeLessThanOrEqual(prev + 1e-12);        // zooming out only, monotone
      expect(s.view.scale).toBeGreaterThanOrEqual(goal.scale - 1e-9); // never past the target
      prev = s.view.scale;
      frames++;
    }
    expect(frames).toBeGreaterThan(10);                // a glide, not a snap
    expect(frames).toBeLessThan(600);                  // and not forever
    expect(s.view).toEqual(goal);
    expect(s.goal).toBeNull();
    // settled: the same raid no longer moves it
    expect(frameStep(s, wide, W, H, 16, false).animating).toBe(false);
  });
  it('does not depend on the frame rate', () => {
    const a = { cx: 0, cy: 0, scale: 1 }, b = { cx: 400, cy: -200, scale: 0.25 };
    let fine = a;
    for (let i = 0; i < 30; i++) fine = easeView(fine, b, 10).view;
    const coarse = easeView(a, b, 300).view;
    expect(fine.cx).toBeCloseTo(coarse.cx, 6);
    expect(fine.scale).toBeCloseTo(coarse.scale, 9);
  });
  it('a snap (scrub, zone change, session change) frames at once', () => {
    const base = cluster();
    const far = base.map(p => ({ x: p.x + 90, y: p.y }));
    const view = targetView(base, W, H);
    const r = frameStep({ view, goal: null }, far, W, H, 16, true);
    expect(r.view).toEqual(targetView(far, W, H));
    expect(r.animating).toBe(false);
    // no view yet: the first frame is a snap too
    expect(frameStep({ view: null, goal: null }, base, W, H, 16, false).view).toEqual(view);
  });
  it('holds with no raiders or no pane', () => {
    const view = targetView(cluster(), W, H);
    expect(frameStep({ view, goal: null }, [], W, H, 16, false).view).toBe(view);
    expect(frameStep({ view, goal: null }, cluster(), 0, 0, 16, false).view).toBe(view);
  });
  it('easeScale closes on a zoom and stops', () => {
    let s = 0.1, n = 0, done = false;
    while (!done && n < 1000) { ({ scale: s, done } = easeScale(s, 0.4, 16)); n++; }
    expect(s).toBe(0.4);
    expect(n).toBeGreaterThan(5);
  });
});

// ── the 3D camera ───────────────────────────────────────────────────────────

describe('3D rig', () => {
  const raiders = (cx, cy, z, spread, n = 10) => Array.from({ length: n }, (_, i) => ({
    x: cx + ((i % 5) - 2) * spread / 4, y: cy + (Math.floor(i / 5) - 0.5) * spread / 4, z,
  }));

  it('the focus is the 80% centre: a far straggler does not drag it', () => {
    const f = raidFocus([...raiders(100, -200, 10, 80), { x: 5000, y: 5000, z: 300 }]);
    expect(f.n).toBe(9);
    expect(Math.abs(f.x - 100)).toBeLessThan(80);
    expect(Math.abs(f.y + 200)).toBeLessThan(80);
    expect(f.z).toBeLessThan(40);
    expect(raidFocus([])).toBeNull();
  });
  it('sits a modest 120-250 above a compact raid at about a 40 degree pitch, south of it looking north', () => {
    for (const spread of [40, 150, 300]) {
      const f = raidFocus(raiders(0, 0, 10, spread));
      const rig = desiredRig(f, 1.6, 50);
      const rise = rig.pos[1] - rig.target[1];
      const back = rig.pos[2] - rig.target[2];
      expect(rise).toBeGreaterThanOrEqual(CAM_HEIGHT_MIN - 1e-6);
      expect(rise).toBeLessThanOrEqual(CAM_HEIGHT_MAX + 1e-6);
      expect(back).toBeGreaterThan(0);                              // three +Z is south
      expect(rig.pos[0]).toBe(rig.target[0]);
      expect(Math.atan2(rise, back)).toBeCloseTo(CAM_PITCH, 6);
    }
  });
  it('backs off along that line when the raid is too big to fit, and not otherwise', () => {
    const small = desiredRig(raidFocus(raiders(0, 0, 10, 100)), 1.6, 50);
    const big = desiredRig(raidFocus(raiders(0, 0, 10, 1500)), 1.6, 50);
    expect(big.dist).toBeGreaterThan(small.dist * 3);
    // the pitch holds while it backs off, so the height grows past 250 only because the raid needs the room
    expect(big.pos[1] - big.target[1]).toBeGreaterThan(CAM_HEIGHT_MAX);
    expect(Math.atan2(big.pos[1] - big.target[1], big.pos[2] - big.target[2])).toBeCloseTo(CAM_PITCH, 6);
    // a narrow pane needs more distance than a wide one
    expect(desiredRig(raidFocus(raiders(0, 0, 10, 600)), 0.5, 50).dist).toBeGreaterThan(desiredRig(raidFocus(raiders(0, 0, 10, 600)), 1.6, 50).dist);
  });
  it('the orbit target is the raid centre in the three frame', () => {
    const f = raidFocus(raiders(100, -200, 10, 80));
    const rig = desiredRig(f, 1.6, 50);
    const want = serverToThree(f.x, f.y, f.z + 6);
    expect(rig.target).toEqual(want);
  });
});

describe('3D camera stays inside', () => {
  // A zone 2000 x 2000 x 400 (server frame), centred on the origin.
  const bounds = boundsFromServer([-1000, -1000, 0], [1000, 1000, 400]);

  it('maps server bounds to the three frame', () => {
    expect(bounds.min).toEqual([-1000, 0, -1000]);
    expect(bounds.max).toEqual([1000, 400, 1000]);
    const b = boundsFromServer([10, 20, 30], [110, 220, 330]);
    expect(b.min).toEqual([-110, 30, -220]);
    expect(b.max).toEqual([-10, 330, -20]);
  });
  it('clamps x and z inside the extent (with a margin) and y between the floor and the highest point', () => {
    const p = clampToBounds([5000, 9000, -7000], bounds, 20);
    expect(p[0]).toBeLessThan(1000);
    expect(p[0]).toBeGreaterThan(900);
    expect(p[1]).toBe(400);
    expect(p[2]).toBeGreaterThan(-1000);
    expect(p[2]).toBeLessThan(-900);
    expect(clampToBounds([0, -50, 0], bounds, 20)[1]).toBe(20);
    expect(clampToBounds([10, 100, -30], bounds, 20)).toEqual([10, 100, -30]);
  });

  // A wall across Z = 150 (x -200..200, y -50..300), as two triangles, in the three frame.
  const wall = (z) => new Float32Array([
    -200, -50, z, 200, -50, z, 200, 300, z,
    -200, -50, z, 200, 300, z, -200, 300, z,
  ]);
  const target = [0, 10, 0];

  it('pulls the camera in to just short of a wall between it and the target', () => {
    const g = buildTriGrid(wall(150));
    const pos = [0, 150, 200];
    const r = constrainCamera(target, pos, { bounds, grids: [g] });
    expect(r.pulled).toBe(true);
    expect(r.pos[2]).toBeLessThan(150);
    const d = Math.hypot(r.pos[0] - target[0], r.pos[1] - target[1], r.pos[2] - target[2]);
    const len = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
    const hitDist = len * 0.75;                         // the wall is 150 of 200 along the line
    expect(d).toBeCloseTo(hitDist - 8, 5);
    // it keeps looking at the same target along the same line
    expect(r.pos[2] / (r.pos[1] - 10)).toBeCloseTo(200 / 140, 6);
  });
  it('leaves a clear line alone, and a wall behind the target, and a wall off to the side', () => {
    const pos = [0, 150, 200];
    expect(constrainCamera(target, pos, { bounds, grids: [buildTriGrid(wall(250))] })).toEqual({ pos, pulled: false });   // beyond the camera
    expect(constrainCamera(target, pos, { bounds, grids: [buildTriGrid(wall(-100))] })).toEqual({ pos, pulled: false });  // behind the target
    expect(constrainCamera(target, [600, 150, 200], { bounds, grids: [buildTriGrid(wall(150))] }).pulled).toBe(false);     // line passes x = 450
    expect(constrainCamera(target, pos, { bounds, grids: [null, null] }).pulled).toBe(false);
  });
  it('never closer than CAM_MIN_DIST, and takes the nearest of several walls', () => {
    const near = constrainCamera(target, [0, 150, 200], { bounds, grids: [buildTriGrid(wall(20))] });
    const d = Math.hypot(near.pos[0] - target[0], near.pos[1] - target[1], near.pos[2] - target[2]);
    expect(d).toBeCloseTo(CAM_MIN_DIST, 5);
    const two = constrainCamera(target, [0, 150, 200], { bounds, grids: [buildTriGrid(wall(150)), buildTriGrid(wall(80))] });
    expect(two.pos[2]).toBeLessThan(80);
  });
  it('clamps first, then tests the wall from the clamped spot', () => {
    // a camera well past the zone's edge comes back inside it
    const r = constrainCamera(target, [0, 150, 3000], { bounds, grids: [] });
    expect(r.pos[2]).toBeLessThan(1000);
    expect(r.pulled).toBe(false);
    expect(constrainCamera(target, [0, 150, 3000], { bounds: null, grids: [] }).pos).toEqual([0, 150, 3000]);
  });

  it('the grid agrees with a brute-force test on a scatter of triangles', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const tris = [];
    for (let i = 0; i < 600; i++) {
      const cx = rnd() * 2000 - 1000, cz = rnd() * 2000 - 1000, cy = rnd() * 300;
      for (let k = 0; k < 3; k++) tris.push(cx + (rnd() - 0.5) * 120, cy + (rnd() - 0.5) * 120, cz + (rnd() - 0.5) * 120);
    }
    const pos = new Float32Array(tris);
    const g = buildTriGrid(pos);
    // independent test: where the segment meets the triangle's plane, and is that point inside (barycentric)
    const brute = (a, b) => {
      let best = null;
      for (let t = 0; t < pos.length / 9; t++) {
        const v = (k) => [pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 1], pos[t * 9 + k * 3 + 2]];
        const [p0, p1, p2] = [v(0), v(1), v(2)];
        const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
        const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
        const cross = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const n = cross(sub(p1, p0), sub(p2, p0));
        const d = sub(b, a);
        const den = dot(n, d);
        if (Math.abs(den) < 1e-9) continue;
        const s = dot(n, sub(p0, a)) / den;
        if (s < 0 || s > 1) continue;
        const q = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
        const e0 = sub(p1, p0), e1 = sub(p2, p0), e2 = sub(q, p0);
        const d00 = dot(e0, e0), d01 = dot(e0, e1), d11 = dot(e1, e1), d20 = dot(e2, e0), d21 = dot(e2, e1);
        const den2 = d00 * d11 - d01 * d01;
        if (Math.abs(den2) < 1e-12) continue;
        const v1 = (d11 * d20 - d01 * d21) / den2, w1 = (d00 * d21 - d01 * d20) / den2;
        if (v1 < -1e-9 || w1 < -1e-9 || v1 + w1 > 1 + 1e-9) continue;
        if (best === null || s < best) best = s;
      }
      return best;
    };
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const a = [rnd() * 2000 - 1000, rnd() * 300, rnd() * 2000 - 1000];
      const b = [a[0] + (rnd() - 0.5) * 500, a[1] + (rnd() - 0.5) * 300, a[2] + (rnd() - 0.5) * 500];
      const want = brute(a, b), got = segmentHit(g, a, b);
      if (want === null) expect(got).toBeNull();
      else { hits++; expect(got).toBeCloseTo(want, 4); }
    }
    expect(hits).toBeGreaterThan(20);                  // the corpus does hit things, or this proves nothing
  });
  it('an empty mesh has no grid, and a segment off the grid is clear', () => {
    expect(buildTriGrid(new Float32Array(0))).toBeNull();
    expect(segmentHit(buildTriGrid(wall(150)), [5000, 0, 5000], [5100, 0, 5100])).toBeNull();
  });

  it('easeRig glides both the target and the camera and stops', () => {
    const goal = { target: [100, 20, -50], pos: [100, 220, 150] };
    let cur = { target: [0, 10, 0], pos: [0, 150, 200] };
    let n = 0, done = false;
    while (!done && n < 1000) { const e = easeRig(cur, goal, 16); cur = e; done = e.done; n++; }
    expect(cur.target).toEqual(goal.target);
    expect(cur.pos).toEqual(goal.pos);
    expect(n).toBeGreaterThan(10);
  });
});

// ── wiring: the views call the pure rules (comments stripped before matching) ──

describe('wiring', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const board = read('web/app/spectator/replay/ReplayBoard.tsx');
  const view3d = read('web/app/spectator/replay/Replay3D.tsx');

  it('the 2D board frames with frameStep and no longer refits on every near-miss', () => {
    expect(board).toMatch(/frameStep\(/);
    expect(board).not.toMatch(/needsRefit/);
    expect(board).not.toMatch(/coreRaiders/);
  });
  it('the board snaps only on a scrub, and hands the snap to the 3D view', () => {
    expect(board).toMatch(/FRAME_SNAP_MS/);
    expect(board).toMatch(/spawns, snap,/);
  });
  it('the board puts the session in the URL', () => {
    expect(board).toMatch(/sessionSearch\(/);
    expect(board).toMatch(/parseSessionParam\(/);
  });
  it('the 3D view keeps the camera inside through constrainCamera and builds a wall grid', () => {
    expect(view3d).toMatch(/constrainCamera\(/);
    expect(view3d).toMatch(/buildTriGrid\(/);
    expect(view3d).not.toMatch(/coreRaiders/);
    expect(view3d).not.toMatch(/Raycaster/);   // the wall test is the grid, not three.js's raycast over every triangle
  });
});
