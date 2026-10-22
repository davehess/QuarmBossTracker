// test/route-planner-draw.test.js: the Draw tool of the route planner (?v=draw), web/lib/routePlanner/drawPath.ts.
//
// The guild lead (2026-10-22): "add in draw with pins or let us redraw a path or segment entirely". Two ways to lay a leg's path
// in one go: POINTS (click the bends in order, with undo and cancel) and PEN (drag along the corridor; the stroke is simplified
// like "Use this route" and REPLACES the leg's bends, or only the stretch the stroke covers). Pure maths here, on a leg from
// (0,0) to (1000,0); the engine wiring is checked at the bottom against the source with comments stripped.
//
// Run: npx vitest run test/route-planner-draw.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  MAX_DRAW_BENDS, applyPen, draftAdd, draftFinish, draftLine, draftUndo, drawnLine, newDraft, project, simplifyPath, thinStroke,
} from '../web/lib/routePlanner/drawPath.ts';

const A = [0, 0], B = [1000, 0];
const OPT = { hitR: 30 };
// a leg zig-zagging across the corridor: four bends
const BENDS = [[200, 100], [400, -100], [600, 100], [800, -100]];
const has = (arr, p) => arr.some(q => Math.abs(q[0] - p[0]) < 0.6 && Math.abs(q[1] - p[1]) < 0.6);
// a dense hand-drawn stroke along y = sin, one sample every 4 units, with a little wobble
const wave = (x0, x1, amp = 120) => { const out = []; for (let x = x0; x <= x1; x += 4) out.push([x, amp * Math.sin(x / 90) + ((x * 7) % 5) - 2]); return out; };

describe('thinStroke', () => {
  it('drops samples closer than the gap and always keeps the last one', () => {
    const raw = [[0, 0], [1, 0], [2, 0], [10, 0], [11, 0]];
    expect(thinStroke(raw, 5)).toEqual([[0, 0], [10, 0], [11, 0]]);
  });
});

describe('applyPen: a stroke from pin to pin redraws the whole leg', () => {
  const stroke = wave(0, 1000);
  const r = applyPen(A, B, BENDS, stroke, OPT);

  it('replaces every old bend, and is simplified to no more than the cap', () => {
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('whole');
    expect(r.replaced).toBe(4);
    expect(stroke.length).toBeGreaterThan(200);
    expect(r.bends.length).toBeGreaterThan(3);
    expect(r.bends.length).toBeLessThanOrEqual(MAX_DRAW_BENDS);
    for (const old of BENDS) expect(has(r.bends, old)).toBe(false);
  });

  it('keeps the shape: every bend lies near the stroke it came from', () => {
    for (const b of r.bends) expect(project(stroke, b).d).toBeLessThan(1);
  });

  it('the pins are the ends and are not bends', () => {
    expect(has(r.bends, A)).toBe(false);
    expect(has(r.bends, B)).toBe(false);
    // a stroke that starts a few units off the pin: that first sample is the snap, not a bend
    const off = applyPen(A, B, BENDS, [[12, 9], ...stroke.slice(1, -1), [990, -7]], OPT);
    expect(has(off.bends, [12, 9])).toBe(false);
    expect(has(off.bends, [990, -7])).toBe(false);
  });

  it('a stroke drawn from the end pin back to the start gives the bends in leg order', () => {
    const back = applyPen(A, B, BENDS, [...stroke].reverse(), OPT);
    expect(back.ok).toBe(true);
    expect(back.bends[0][0]).toBeLessThan(back.bends[back.bends.length - 1][0]);
    expect(back.bends.length).toBe(r.bends.length);
  });

  it('with no old bends the first stroke still works, and a 2-sample stroke straightens the leg', () => {
    expect(applyPen(A, B, [], wave(0, 1000), OPT).bends.length).toBeGreaterThan(3);
    const line = applyPen(A, B, BENDS, [[0, 0], [1000, 0]], OPT);
    expect(line.ok).toBe(true);
    expect(line.bends).toEqual([]);
  });
});

describe('applyPen: a stroke that is not on the leg redraws the leg, snapped to its pins', () => {
  it('starts and ends far from the line: the ends become the pins, the old bends go', () => {
    const away = wave(0, 1000).map(p => [p[0], p[1] + 400]);   // a corridor 400 units north of the old line
    const r = applyPen(A, B, BENDS, away, OPT);
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('whole');
    for (const old of BENDS) expect(has(r.bends, old)).toBe(false);
    expect(r.bends.length).toBeGreaterThan(2);
  });
  it('drawn the wrong way round it is turned round to run start pin to end pin', () => {
    const away = wave(0, 1000).map(p => [p[0], p[1] + 400]).reverse();
    const r = applyPen(A, B, BENDS, away, OPT);
    expect(r.bends[0][0]).toBeLessThan(r.bends[r.bends.length - 1][0]);
  });
});

describe('applyPen: a stroke between two bends redraws only that stretch', () => {
  // from the middle of the first-to-second bend, to the middle of the third-to-fourth: bends 1 and 2 are covered
  const stroke = [[300, 0], [330, 200], [420, 260], [520, 240], [610, 200], [700, 0]];
  const r = applyPen(A, B, BENDS, stroke, OPT);

  it('keeps the bends outside the stretch, in order, on both sides', () => {
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('segment');
    expect(r.replaced).toBe(2);
    expect(r.bends[0]).toEqual([200, 100]);
    expect(r.bends[r.bends.length - 1]).toEqual([800, -100]);
  });

  it('drops the bends inside it and joins the new path to the old line where the stroke left it', () => {
    expect(has(r.bends, [400, -100])).toBe(false);
    expect(has(r.bends, [600, 100])).toBe(false);
    expect(has(r.bends, [300, 0])).toBe(true);   // the joint: the old line at the stroke's start
    expect(has(r.bends, [700, 0])).toBe(true);   // and at its end
    expect(r.bends.some(p => p[1] > 150)).toBe(true);   // the new path's own corners
  });

  it('drawn in the other direction it does the same thing', () => {
    const back = applyPen(A, B, BENDS, [...stroke].reverse(), OPT);
    expect(back.bends).toEqual(r.bends);
  });

  it('a stretch that starts on the start pin has no joint there and keeps the bends after it', () => {
    const r2 = applyPen(A, B, BENDS, [[3, 4], [100, 200], [250, 150], [300, 0]], OPT);
    expect(r2.scope).toBe('segment');
    expect(r2.bends.every(p => Math.hypot(p[0] - A[0], p[1] - A[1]) > 20)).toBe(true);   // the start pin is the end of the line, not a bend beside it
    const r3 = applyPen(A, B, BENDS, [[700, 0], [820, -150], [900, -80], [997, 5]], OPT);   // and the same at the end pin
    expect(r3.scope).toBe('segment');
    expect(r3.bends.every(p => Math.hypot(p[0] - B[0], p[1] - B[1]) > 20)).toBe(true);
    expect(r3.bends[0]).toEqual([200, 100]);
    expect(has(r2.bends, [200, 100])).toBe(false);   // covered by the stroke
    expect(has(r2.bends, [400, -100])).toBe(true);   // beyond it: kept
    expect(r2.bends[r2.bends.length - 1]).toEqual([800, -100]);
  });

  it('the whole leg stays within the cap when the new stretch is long', () => {
    // a wavy stroke from (300,0) to (700,0): both ends on the old line, a dense 100 samples between
    const squiggle = []; for (let x = 300; x <= 700; x += 4) squiggle.push([x, 150 * Math.sin(8 * Math.PI * (x - 300) / 400)]);
    const many = applyPen(A, B, BENDS, squiggle, OPT);
    expect(many.scope).toBe('segment');
    expect(many.bends.length).toBeLessThanOrEqual(MAX_DRAW_BENDS);
    expect(many.bends[0]).toEqual([200, 100]);
    expect(many.bends[many.bends.length - 1]).toEqual([800, -100]);
  });
});

describe('applyPen: what is refused', () => {
  it('a click or a short scribble is not a drawing', () => {
    expect(applyPen(A, B, BENDS, [[10, 10]], OPT)).toEqual({ ok: false, reason: 'short' });
    expect(applyPen(A, B, BENDS, [[10, 10], [14, 12]], OPT)).toEqual({ ok: false, reason: 'short' });
  });
  it('a stroke that starts and ends at one place on the leg has no stretch to redraw', () => {
    const loop = [[500, 0], [500, 60], [560, 60], [560, -60], [500, -60], [500, 0]];
    expect(applyPen(A, B, [], loop, OPT)).toEqual({ ok: false, reason: 'same-spot' });
  });
});

describe('simplifyPath', () => {
  it('returns the corners without the ends, within the cap', () => {
    const out = simplifyPath([[0, 0], [100, 0], [100, 100], [200, 100]]);
    expect(out).toEqual([[100, 0], [100, 100]]);
    expect(simplifyPath(wave(0, 2000), 12).length).toBeLessThanOrEqual(12);
  });
});

describe('points: draw with pins', () => {
  it('builds up click by click, from the start pin to the end pin', () => {
    let d = newDraft();
    d = draftAdd(d, [100, 50]); d = draftAdd(d, [300.04, -80]); d = draftAdd(d, [700, 20]);
    expect(draftFinish(d)).toEqual([[100, 50], [300, -80], [700, 20]]);
    expect(draftLine(A, B, d)).toEqual([[0, 0], [100, 50], [300, -80], [700, 20], [1000, 0]]);
  });
  it('the live line runs to the pointer instead of the end pin', () => {
    const d = draftAdd(newDraft(), [100, 50]);
    expect(draftLine(A, B, d, [150, 90])).toEqual([[0, 0], [100, 50], [150, 90]]);
  });
  it('Backspace takes the last point back, and nothing more when there is none', () => {
    let d = draftAdd(draftAdd(newDraft(), [100, 50]), [300, -80]);
    d = draftUndo(d);
    expect(d.pts).toEqual([[100, 50]]);
    d = draftUndo(draftUndo(d));
    expect(d.pts).toEqual([]);
  });
  it('cancel is leaving the draft alone: the old bends are never touched', () => {
    const ln = { pts: BENDS.map(p => [...p]), follow: 3 };
    draftAdd(draftAdd(newDraft(), [100, 50]), [300, -80]);   // clicked, then Escape: no finish
    expect(ln.pts).toEqual(BENDS);
    expect(ln.follow).toBe(3);
  });
  it('a double click adds its point once; the draft stops growing at the cap', () => {
    let d = draftAdd(newDraft(), [100, 50]);
    d = draftAdd(d, [100.1, 50.1]);
    expect(d.pts.length).toBe(1);
    for (let i = 0; i < 100; i++) d = draftAdd(d, [200 + i * 10, i % 2 ? 40 : -40]);
    expect(d.pts.length).toBe(MAX_DRAW_BENDS);
  });
  it('finishing with no point drawn changes nothing', () => {
    expect(draftFinish(newDraft())).toBeNull();
  });
});

describe('drawnLine: what a finished draw does to the leg', () => {
  it('replaces the bends and lets go of a recorded-route snap', () => {
    const ln = { k: 'a>b', off: false, pts: BENDS.map(p => [...p]), follow: 4 };
    drawnLine(ln, [[10, 20]]);
    expect(ln.pts).toEqual([[10, 20]]);
    expect(ln.follow).toBeUndefined();
  });
});

describe('the engine wiring', () => {
  const read = p => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const engine = read('web/app/raid/plan/routes/engine.ts');
  const page = read('web/app/raid/plan/routes/page.tsx');
  const skel = read('web/app/raid/plan/routes/skeleton.ts');

  it('the page turns it on only for ?v=draw, and the toolbar button only exists then', () => {
    expect(page).toMatch(/one\(searchParams\.v\) === 'draw'/);
    expect(skel).toMatch(/drawTool\s*\?[^`]*data-mode="draw"/);
    expect(engine).toMatch(/host\.draw/);
  });

  it('a finished draw is ONE save: the pen and the points both go through commitBends, which calls changed once', () => {
    const fn = engine.slice(engine.indexOf('function commitBends'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect((body.match(/changed\(/g) || []).length).toBe(1);
    expect(body).toMatch(/drawnLine\(/);
    expect(engine).toMatch(/commitBends\(lg, r\.bends/);       // the pen
    expect(engine).toMatch(/commitBends\(lg, bends/);          // the points
  });

  it('a leg that jumps by teleporter is refused, not drawn over', () => {
    expect(engine).toMatch(/lg\.jump\)[^;]*toast\('This leg jumps by teleporter/);
  });
});
