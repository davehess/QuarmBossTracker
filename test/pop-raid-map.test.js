// test/pop-raid-map.test.js — the /pop/raid maps (the guild lead, 2026-10-26: "pop/raid needs the brewall maps
// underneath, they look incomplete" and "the path is incorrect, are we able to pull from what we've observed in raids").
//
// The pure parts (web/lib/popRaidMap.ts) run for real. The server read and the SVG are wired through the framework, so
// their wiring is read as comment-stripped source (comments quote the code and would answer for it).
//
// Every map row here is invented. Brewall's art is third-party and never copied into this public repo; the BOUNDS in
// BREWALL_BOUNDS are four numbers per zone, read from the cached zone_map_lines rows on 2026-10-26.
//
// Run: npx vitest run test/pop-raid-map.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { PLAN } from '../web/lib/raidPlan.ts';
import { brewallPath, chooseRoute, isoDay, markerLetter, planFrame, slimSavedRoute, spreadGlyphs } from '../web/lib/popRaidMap.ts';
import { parseBrewallMaps } from '../web/lib/zoneMap/brewall.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// The drawn extent of Brewall's map for each zone of the plan, server frame (measured 2026-10-26).
const BREWALL_BOUNDS = {
  podisease: { minX: -2334, maxX: 2349, minY: -3710, maxY: 2340 },
  poinnovation: { minX: -1036, maxX: 1635, minY: -1288, maxY: 1961 },
  ponightmare: { minX: -5021, maxX: 1947, minY: -4046, maxY: 6522 },
  nightmareb: { minX: -2254, maxX: 1671, minY: -452, maxY: 423 },
  povalor: { minX: -1755, maxX: 2786, minY: -2053, maxY: 5216 },
};
const planPoints = (s) => [...s.markers, ...s.route, ...(s.altRoutes ?? []).flat(), ...(s.patrol ?? [])];

// A path from brewallPath back into absolute screen segments, so the test checks what is DRAWN.
function decode(d) {
  const segs = [];
  let x = 0, y = 0;
  for (const m of d.matchAll(/([Mlml])(-?\d+) (-?\d+)/g)) {
    const [, op, a, b] = m;
    if (op === 'M') { x = Number(a); y = Number(b); } else {
      const nx = x + Number(a), ny = y + Number(b);
      segs.push([x, y, nx, ny]);
      x = nx; y = ny;
    }
  }
  return segs;
}
// A server-frame Brewall line with the colour and z the parser would give it.
const L = (x1, y1, x2, y2) => [x1, y1, 0, x2, y2, 0, 0, 0, 0];
const BIG = { vx: -10000, vy: -10000, vw: 20000, vh: 20000 };

describe('the plan lines up with Brewall', () => {
  it('has every marker, route and patrol point inside its zone\'s Brewall bounds', () => {
    for (const s of PLAN) {
      const b = BREWALL_BOUNDS[s.zone];
      expect(b, s.zone).toBeTruthy();
      for (const p of planPoints(s)) {
        expect(p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY, `${s.id} ${p.label ?? `${p.x},${p.y}`}`).toBe(true);
      }
    }
  });
  it('frames every plan point', () => {
    for (const s of PLAN) {
      const f = planFrame(planPoints(s), BREWALL_BOUNDS[s.zone]);
      for (const p of planPoints(s)) {
        const sx = -p.x, sy = -p.y;   // the page's one conversion: north-up, (-x, -y)
        expect(sx >= f.vx && sx <= f.vx + f.vw && sy >= f.vy && sy <= f.vy + f.vh, `${s.id} ${p.label ?? ''}`).toBe(true);
      }
    }
  });
  it('shows a whole zone when the plan spans most of it, and zooms to the plan when it is one corner of a long zone', () => {
    const lair = PLAN.find(s => s.id === 'lair');
    const zoomed = planFrame(planPoints(lair), BREWALL_BOUNDS.nightmareb);
    expect(Math.max(zoomed.vw, zoomed.vh)).toBeLessThan(1500);       // the arena, not the 3,900-unit zone
    const valor = PLAN.find(s => s.id === 'valor');
    const whole = planFrame(planPoints(valor), BREWALL_BOUNDS.povalor);
    expect(whole.vh).toBeGreaterThanOrEqual(BREWALL_BOUNDS.povalor.maxY - BREWALL_BOUNDS.povalor.minY);
  });
  it('frames a plan with no walls at all', () => {
    const f = planFrame([{ x: 10, y: 20 }], null);
    expect(f.vw).toBeGreaterThan(0);
    expect(planFrame([], null).vw).toBeGreaterThan(0);
  });
});

describe('brewallPath: every wall is drawn, none is dropped for being short', () => {
  it('draws each line in the frame, however short, and round-trips to the same segments', () => {
    const lines = [L(0, 0, 100, 0), L(100, 0, 100, 50), L(500, 500, 502, 500), L(-30, 40, -34, 47)];
    const got = decode(brewallPath(lines, BIG));
    // server (x, y) is drawn at (-x, -y)
    const want = lines.map(l => [-l[0] || 0, -l[1] || 0, -l[3] || 0, -l[4] || 0]);
    expect(got).toHaveLength(4);
    expect(got.map(String).sort()).toEqual(want.map(String).sort());
  });
  it('keeps a wall that runs off the frame whole, and drops only what lies outside it', () => {
    const f = { vx: 0, vy: 0, vw: 100, vh: 100 };
    const out = decode(brewallPath([L(-50, -50, -200, -50), L(-50, -50, 5000, -60), L(-1e6, -1e6, -1e6 - 50, -1e6)], f));
    expect(out).toHaveLength(2);                     // the two that touch the frame, the far one gone
    expect(out.some(s => s[2] === -5000)).toBe(true); // the long one is not clipped to the frame
  });
  it('joins a run of segments into one subpath and draws a repeat once, in either direction', () => {
    const run = [L(0, 0, 10, 0), L(10, 0, 10, 10), L(10, 10, 20, 10)];
    const d = brewallPath([...run, L(10, 0, 0, 0)], BIG);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(decode(d)).toHaveLength(3);
  });
  it('skips a zero-length line and an empty layer', () => {
    expect(brewallPath([L(5, 5, 5, 5)], BIG)).toBe('');
    expect(brewallPath([], BIG)).toBe('');
  });
  it('draws every line of every layer file the loader merges', () => {
    const base = 'L 0, 0, 0, 10, 0, 0, 0, 0, 0\nL 10, 0, 0, 10, 10, 0, 0, 0, 0';
    const second = 'L 50, 50, 0, 60, 50, 0, 0, 0, 0\nP 1, 2, 3, 0, 0, 0, 2, A_Room';
    const layer = parseBrewallMaps([base, second]);
    expect(layer.lines).toHaveLength(3);
    expect(decode(brewallPath(layer.lines, BIG))).toHaveLength(3);
  });
});

describe('markers are lettered, not named, on the map', () => {
  it('gives each marker of a section its own letter, in order', () => {
    expect([0, 1, 2, 25].map(markerLetter)).toEqual(['A', 'B', 'C', 'Z']);
    for (const s of PLAN) {
      expect(new Set(s.markers.map((_, i) => markerLetter(i))).size, s.id).toBe(s.markers.length);
    }
  });
  it('keeps every glyph clear of every other in the frame the map is drawn in, and near its own point', () => {
    for (const s of PLAN) {
      const f = planFrame(planPoints(s), BREWALL_BOUNDS[s.zone]);
      const gr = Math.max(f.vw, f.vh) * 0.02;          // ZoneSvg's glyph size
      const g = spreadGlyphs(s.markers, gr);
      for (let i = 0; i < g.length; i++) {
        expect(Math.hypot(g[i].sx - g[i].ox, g[i].sy - g[i].oy), `${s.id}: ${s.markers[i].label} moved`).toBeLessThan(gr * 3);
        for (let j = i + 1; j < g.length; j++) {
          expect(Math.hypot(g[i].sx - g[j].sx, g[i].sy - g[j].sy), `${s.id}: ${s.markers[i].label} / ${s.markers[j].label}`).toBeGreaterThanOrEqual(gr * 2.29);
        }
      }
    }
  });
  it('leaves a glyph on its point when nothing is near it, and splits two on one spot', () => {
    const far = spreadGlyphs([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 10);
    expect(far.every(p => p.sx === p.ox && p.sy === p.oy)).toBe(true);
    const same = spreadGlyphs([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], 10);
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      expect(Math.hypot(same[a].sx - same[b].sx, same[a].sy - same[b].sy)).toBeGreaterThanOrEqual(22.9);
    }
  });
  it('writes no marker name into the SVG, only the letter', () => {
    const svg = read('web/app/pop/raid/ZoneSvg.tsx');
    expect(svg).toMatch(/markerLetter\(i\)/);
    expect(svg).not.toMatch(/>\s*\{m\.label\}/);
  });
  it('lists the letters and names under the map', () => {
    const page = read('web/app/pop/raid/page.tsx');
    expect(page).toMatch(/markerLetter\(j\)\}<\/span> \{m\.label\}/);
  });
});

describe('the saved route', () => {
  const walkedValue = {
    v: 1, zone: 'x', name: 'Some Zone', saved_at: '2026-10-22T05:06:56.218Z', nights: ['10/21/2026'], keys: ['1'],
    points: [[0, 0], [10, 0], [20, 5], [30, 5], [100, 100], [110, 100]],
    legs: [{ from: 'a', to: 'b', start_index: 0, end_index: 3 }, { from: 'b', to: 'c', start_index: 4, end_index: 5 }],
    stops: [{ n: 2, name: 'Second', x: 30, y: 5 }, { n: 1, name: 'First', x: 0, y: 0 }, { n: 3, name: '  ', x: 1, y: 1 }],
  };
  it('reads the legs and the stops in order, and drops a nameless stop', () => {
    const r = slimSavedRoute(walkedValue);
    expect(r.walked).toBe(true);
    expect(r.legs.map(l => l.length)).toEqual([4, 2]);
    expect(r.stops.map(s => s.label)).toEqual(['First', 'Second']);
  });
  it('calls a route with no recorded nights planned, not walked', () => {
    expect(slimSavedRoute({ ...walkedValue, nights: [], keys: [] }).walked).toBe(false);
  });
  it('is one leg end to end when the value has no usable legs', () => {
    const r = slimSavedRoute({ ...walkedValue, legs: [{ start_index: 5, end_index: 2 }] });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toHaveLength(6);
  });
  it('keeps a long leg to the cap and keeps both its ends', () => {
    const points = Array.from({ length: 6000 }, (_, i) => [i, i * 2]);
    const r = slimSavedRoute({ ...walkedValue, points, legs: [], stops: [] });
    const n = r.legs.reduce((s, l) => s + l.length, 0);
    expect(n).toBeLessThanOrEqual(1501);
    expect(n).toBeGreaterThan(700);
    expect(r.legs[0][0]).toEqual({ x: 0, y: 0 });
    expect(r.legs[0].at(-1)).toEqual({ x: 5999, y: 11998 });
  });
  it('refuses a value that is not a route, and survives garbage points', () => {
    for (const bad of [null, 'x', 7, [], {}, { points: 'no' }, { points: [[1, 2]] }, { points: [[NaN, 1], [1, 'a'], null] }]) {
      expect(slimSavedRoute(bad), JSON.stringify(bad)).toBeNull();
    }
    const r = slimSavedRoute({ ...walkedValue, points: [[0, 0], null, [1e9, 0], [5, 5]], legs: [] });
    expect(r.legs[0]).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });
  it('strips control characters from a stop name', () => {
    const r = slimSavedRoute({ ...walkedValue, stops: [{ n: 1, name: 'Bo\u0000ss\n', x: 1, y: 1 }] });
    expect(r.stops[0].label).toBe('Bo ss');
  });
});

describe('which route is drawn, and what it says it is', () => {
  const planned = [{ label: 'Zone-in', x: 1, y: 1 }, { label: 'Boss', x: 5, y: 5 }];
  const saved = (o) => slimSavedRoute({
    points: [[0, 0], [9, 9]], legs: [], stops: [{ n: 1, name: 'Stop', x: 0, y: 0 }],
    saved_at: '2026-10-22T05:06:56.218Z', nights: ['10/21/2026'], ...o,
  });
  it('falls back to the hand-entered route, labelled as not yet walked', () => {
    const r = chooseRoute(null, planned);
    expect(r.kind).toBe('planned');
    expect(r.note).toBe('planned (not yet walked)');
    expect(r.stops).toBe(planned);
    expect(r.legs).toEqual([planned]);
  });
  it('draws the saved route in its place, dated by the night it was walked', () => {
    const r = chooseRoute(saved(), planned);
    expect(r.kind).toBe('walked');
    expect(r.note).toBe('walked by the raid on 2026-10-21');
    expect(r.stops.map(s => s.label)).toEqual(['Stop']);
  });
  it('says how many nights were averaged', () => {
    const r = chooseRoute(saved({ nights: ['10/21/2026', '10/14/2026', '10/07/2026'] }), planned);
    expect(r.note).toBe('walked by the raid, 3 nights averaged (latest 2026-10-21)');
  });
  it('does not call a route sent from the planner walked', () => {
    const r = chooseRoute(saved({ nights: [] }), planned);
    expect(r.kind).toBe('saved-plan');
    expect(r.note).toBe('planned in the route planner, saved 2026-10-22 (not yet walked)');
  });
  it('reads the recorder\'s night key and an ISO date as the same day', () => {
    expect(isoDay('10/21/2026')).toBe('2026-10-21');
    expect(isoDay('2026-10-21T05:00:00Z')).toBe('2026-10-21');
    expect(isoDay('soon')).toBeNull();
    expect(isoDay(null)).toBeNull();
  });
});

describe('the server reads', () => {
  const walls = read('web/app/pop/raid/walls.ts');
  const saved = read('web/app/pop/raid/savedRoute.ts');
  const page = read('web/app/pop/raid/page.tsx');
  it('reads the Brewall column, and fetches both layers the way the spectator route does on a miss', () => {
    expect(walls).toMatch(/select\('segs, bounds, brewall'\)/);
    expect(walls).toMatch(/fetchBrewallLayer\(zone\)/);
    expect(walls).toMatch(/fetchEqemuLayer\(zone\)/);
  });
  it('never writes a partial row to zone_map_lines', () => {
    expect(walls).not.toMatch(/\.(upsert|insert|update|delete)\(/);
  });
  it('holds a miss in this process: a long memo when both sources answered, a short one when not', () => {
    expect(walls).toMatch(/const memo = new Map/);
    expect(walls).toMatch(/ok = eq\.status === 'fulfilled' && bw\.status === 'fulfilled' && bw\.value\.complete/);
  });
  it('reads the saved route from bot_kv by the key the bot serves, read-only, memoised', () => {
    expect(saved).toMatch(/from\('bot_kv'\)\.select\('value'\)/);
    expect(saved).toMatch(/`raid_route:\$\{zone\}`/);
    expect(saved).not.toMatch(/\.(upsert|insert|update|delete)\(/);
    expect(saved).toMatch(/const memo = new Map/);
  });
  it('is a server read: the page has no client code or polling', () => {
    for (const src of [page, read('web/app/pop/raid/ZoneSvg.tsx'), saved]) {
      expect(src).not.toMatch(/['"]use client['"]/);
      expect(src).not.toMatch(/setInterval|useEffect|fetch\(/);
    }
    expect(page).toMatch(/loadSavedRoute\(s\.zone\)/);
    expect(page).toMatch(/chooseRoute\(saved\[i\], s\.route\)/);
  });
  it('draws the EQEmu slice only where Brewall has no map', () => {
    const svg = read('web/app/pop/raid/ZoneSvg.tsx');
    expect(svg).toMatch(/brewall \? brewallPath\(brewall\.lines, f\) : walls \? eqemuPath\(walls\) : ''/);
  });
});
