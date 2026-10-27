// test/map-heading-up.test.js — the Map's Heading up mode and its compass.
//
// The guild lead, 2026-10-27: "allow map to follow player heading as well as cardinal direction, but make sure we're
// showing the cardinality on the map".
//
// Two halves, each run as shipped:
//  1. apps/mimic/map.html's pure helpers (headingRot, projectPx / unprojectPx, screenToServer, cardinalSpots, roseSpot,
//     rotStep, fitView, headingVec / arrowPoints with a turn): a known heading puts a known point at a known screen spot.
//  2. the page's script booted against a stub page that records every canvas call: North up is the map it always was,
//     Heading up turns the walls, the dots, the arrows and the kite circles, keeps text upright, un-turns a drag, a zoom and a
//     cursor read, saves the choice, and the compass stays on screen in both.
//
// Mutation-checked (by hand, 2026-10-27): take the turn out of screenToServer and "the cursor reads the point under it"
// fails; take unturnPx out of the drag and "a drag moves the picture with the hand" fails; take rot out of the arrowPoints
// call for a raider and "a raider's arrow ..." fails; take the turnPt() out of the wall loops and "the walls turn" fails;
// draw the compass only when orient is north and "the compass is drawn in both" fails.
//
// Run: npx vitest run test/map-heading-up.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const KC = require(path.join(ROOT, 'apps', 'mimic', 'kiteCoach.js'));
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
const H = new Function(helpers + '\nreturn { headingVec, headingRot, headingGap, turnVec, projectPx, unprojectPx, screenToServer, unturnPx, cardinalSpots, roseSpot, rotStep, fitView, arrowPoints, wedgeArc, followOffNow, toScreen, orientFrom, compassFrom, mapCfgDefaults, mergeMapCfg, ROT_EPS };')();

const near = (a, b, d = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(d);
// The same angle, whichever full turn it was written with (a heading of exactly 256 is +pi or -pi: the picture is the same).
const sameAngle = (a, b) => { near(Math.cos(a), Math.cos(b)); near(Math.sin(a), Math.sin(b)); };
const V = (o = {}) => ({ cx: 0, cy: 0, scale: 1, rot: 0, ...o });
// A server-frame point -> canvas px through the Map's own two steps (toScreen, then projectPx).
const px = (x, y, v, w = 400, h = 400) => { const s = H.toScreen(x, y); return H.projectPx(s.sx, s.sy, v, w, h); };

// ───────────────────────────── 1. the maths ─────────────────────────────

describe('headingRot: the turn that puts a heading at the top', () => {
  it('north is no turn; west is a quarter turn clockwise; south a half; east a quarter back', () => {
    near(H.headingRot(0), 0);
    sameAngle(H.headingRot(128), Math.PI / 2);          // a quarter turn clockwise (+90 degrees)
    sameAngle(H.headingRot(256), Math.PI);
    sameAngle(H.headingRot(384), -Math.PI / 2);
    expect(H.headingRot(null)).toBeNull();
    expect(H.headingRot(NaN)).toBeNull();
  });
  it('whatever the heading, a point straight ahead of you lands straight above the middle', () => {
    for (const h of [0, 37, 64, 128, 200, 256, 300, 384, 450, 511]) {
      const v = H.headingVec(h);                       // the way they face on the north-up picture (screen frame)
      const p = H.projectPx(v.dx * 100, v.dy * 100, V({ rot: H.headingRot(h) }), 400, 400);
      near(p[0], 200, 1e-6); near(p[1], 200 - 100, 1e-6);
    }
  });
  it('facing WEST: a point 100 west is straight above you, and a point 100 NORTH is on your right', () => {
    const v = V({ rot: H.headingRot(128) });           // server +x is west on this Map (screen x = -x), +y is north (screen y = -y)
    const west = px(100, 0, v), north = px(0, 100, v), east = px(-100, 0, v), south = px(0, -100, v);
    near(west[0], 200); near(west[1], 100);
    near(north[0], 300); near(north[1], 200);
    near(east[0], 200); near(east[1], 300);
    near(south[0], 100); near(south[1], 200);
  });
  it('north up is exactly the old projection', () => {
    expect(H.projectPx(-40, -25, V({ cx: -10, cy: 5, scale: 2 }), 400, 300)).toEqual([(-40 + 10) * 2 + 200, (-25 - 5) * 2 + 150]);
  });
});

describe('unprojectPx / screenToServer: a click under a turned map', () => {
  it('unprojectPx is projectPx run backwards, at any turn', () => {
    for (const rot of [0, 0.4, -1.2, 2.5, -3.0]) {
      const v = V({ cx: 12, cy: -30, scale: 1.7, rot });
      const p = H.projectPx(33, -8, v, 640, 360), back = H.unprojectPx(p[0], p[1], v, 640, 360);
      near(back.sx, 33); near(back.sy, -8);
    }
  });
  it('screenToServer gives back the server point that px() drew there, turned or not', () => {
    for (const rot of [0, H.headingRot(128), H.headingRot(300)]) {
      const v = V({ cx: 40, cy: -10, scale: 0.8, rot });
      const p = px(-123, 456, v, 600, 400), s = H.screenToServer(p[0], p[1], v, 600, 400);
      near(s.x, -123); near(s.y, 456);
    }
  });
  it('north up keeps the old formula to the last bit', () => {
    const v = { cx: 7, cy: -3, scale: 0.37 };
    expect(H.screenToServer(123, 45, v, 600, 400)).toEqual({ x: -((123 - 300) / 0.37 + 7), y: -((45 - 200) / 0.37 + -3) });
  });
  it('unturnPx: a drag across the screen is the same drag on the unturned picture, rotated back', () => {
    expect(H.unturnPx(10, 20, { rot: 0 })).toEqual({ dx: 10, dy: 20 });
    const u = H.unturnPx(50, 0, { rot: Math.PI / 2 });   // the picture is turned a quarter clockwise: right on screen is UP on the picture
    near(u.dx, 0); near(u.dy, -50);
  });
});

describe('the compass: where N / E / S / W sit', () => {
  const ins = { t: 38, r: 16, b: 16, l: 16 };
  const at = (list, k) => list.find(s => s.k === k);
  it('north up: N top middle (under the buttons), E right middle, S bottom middle, W left middle', () => {
    const s = H.cardinalSpots(0, 600, 400, ins);
    expect(s.map(c => c.k)).toEqual(['N', 'E', 'S', 'W']);
    near(at(s, 'N').x, 300); near(at(s, 'N').y, 38);
    near(at(s, 'E').x, 584); near(at(s, 'E').y, 200);
    near(at(s, 'S').x, 300); near(at(s, 'S').y, 384);
    near(at(s, 'W').x, 16); near(at(s, 'W').y, 200);
  });
  it('facing west: W is on top, N on the right, E at the bottom, S on the left', () => {
    const s = H.cardinalSpots(H.headingRot(128), 600, 400, ins);
    near(at(s, 'W').x, 300); near(at(s, 'W').y, 38);
    near(at(s, 'N').x, 584); near(at(s, 'N').y, 200);
    near(at(s, 'E').x, 300); near(at(s, 'E').y, 384);
    near(at(s, 'S').x, 16); near(at(s, 'S').y, 200);
  });
  it('on a diagonal it rides the edge of the box, never outside it', () => {
    for (const h of [20, 50, 100, 170, 222, 333, 470]) {
      for (const c of H.cardinalSpots(H.headingRot(h), 600, 400, ins)) {
        expect(c.x).toBeGreaterThanOrEqual(16 - 1e-6); expect(c.x).toBeLessThanOrEqual(584 + 1e-6);
        expect(c.y).toBeGreaterThanOrEqual(38 - 1e-6); expect(c.y).toBeLessThanOrEqual(384 + 1e-6);
      }
    }
  });
  it('the rose takes the bottom-left corner, and steps aside for the button bar', () => {
    expect(H.roseSpot(600, 400, 54, 10, null)).toEqual({ x: 37, y: 363 });
    expect(H.roseSpot(600, 400, 54, 10, { l: 0, t: 330, w: 300, h: 40 })).toEqual({ x: 563, y: 363 });   // bar along the bottom-left: bottom-right
    expect(H.roseSpot(600, 400, 54, 10, { l: 0, t: 0, w: 600, h: 40 })).toEqual({ x: 37, y: 363 });     // bar on top: unmoved
  });
});

describe('rotStep: the picture chases your heading by the short way round', () => {
  it('snaps with no earlier turn, after a long gap, and keeps the old turn when there is no heading', () => {
    expect(H.rotStep(null, 200, 16)).toBe(200);
    expect(H.rotStep(10, 200, 5000)).toBe(200);
    expect(H.rotStep(10, 200, null)).toBe(200);
    expect(H.rotStep(10, null, 16)).toBe(10);
    expect(H.rotStep(null, null, 16)).toBeNull();
  });
  it('goes the short way across the 0/512 seam, never the long way', () => {
    const a = H.rotStep(500, 20, 30);
    expect(a > 500 || a < 20).toBe(true);                    // moved forward through 0
    expect(H.rotStep(20, 500, 30) < 20 || H.rotStep(20, 500, 30) > 500).toBe(true);
  });
  it('closes the gap step by step and lands on the target', () => {
    let cur = 100;
    const seen = [];
    for (let i = 0; i < 80 && cur !== 200; i++) { const next = H.rotStep(cur, 200, 33); expect(next).toBeGreaterThan(cur); expect(next).toBeLessThanOrEqual(200); seen.push(next); cur = next; }
    expect(cur).toBe(200);
    expect(seen.length).toBeGreaterThan(3);                   // a glide, not a jump
  });
});

describe('a turned picture: arrows, slices, fit', () => {
  it('a raider\'s arrow points the way they face ON SCREEN: turned with the picture', () => {
    const rot = H.headingRot(128);                           // you face west
    const mine = H.arrowPoints(128, 100, 100, 8, 4, rot);      // another raider also facing west: up on screen
    expect(mine[1]).toBeLessThan(100); near(mine[0], 100, 1e-6);
    const north = H.arrowPoints(0, 100, 100, 8, 4, rot);       // facing north: to the right on screen
    expect(north[0]).toBeGreaterThan(100); near(north[1], 100, 1e-6);
    expect(H.arrowPoints(128, 100, 100, 8, 4)[0]).toBeLessThan(100);   // no turn: west is left, as ever
  });
  it('a slice opens the same way', () => {
    const a = H.wedgeArc(128, H.headingRot(128));            // facing the way you face: straight up, canvas angle -90 degrees
    sameAngle((a.a0 + a.a1) / 2, -Math.PI / 2);
    sameAngle((H.wedgeArc(128).a0 + H.wedgeArc(128).a1) / 2, Math.PI);
  });
  it('fit: a wide box turned a quarter is a tall box', () => {
    const b = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const flat = H.fitView(b, 400, 400), turned = H.fitView(b, 400, 400, Math.PI / 2);
    near(flat.scale, 400 / 200 * 0.92); near(turned.scale, 400 / 200 * 0.92);   // square canvas: same either way
    const wide = H.fitView(b, 800, 200), tall = H.fitView(b, 800, 200, Math.PI / 2);
    near(wide.scale, Math.min(800 / 200, 200 / 100) * 0.92); near(tall.scale, Math.min(800 / 100, 200 / 200) * 0.92);
    expect(tall.scale).toBeLessThan(wide.scale);
  });
  it('Follow me\'s offset is measured on the turned picture', () => {
    const me = { x: -50, y: 0 };                             // screen frame (50, 0): 50 right of the middle of an unturned map
    const flat = H.followOffNow(me, { cx: 0, cy: 0, scale: 1 }, 400, 400);
    near(flat.x, 50); near(flat.y, 0);
    const o = H.followOffNow(me, { cx: 0, cy: 0, scale: 1, rot: Math.PI / 2 }, 400, 400);
    near(o.x, 0); near(o.y, 50);                              // turned a quarter clockwise it is 50 below
  });
  it('a saved choice that is not one we know falls back to North up and the rose', () => {
    expect(H.orientFrom({ orient: 'heading' })).toBe('heading');
    expect(H.orientFrom({ orient: 'sideways' })).toBe('north'); expect(H.orientFrom(null)).toBe('north');
    expect(H.compassFrom({ compass: 'both' })).toBe('both'); expect(H.compassFrom({ compass: 'x' })).toBe('rose');
    expect(H.mapCfgDefaults()).toMatchObject({ orient: 'north', compass: 'rose' });
    expect(H.mergeMapCfg({ orient: 'heading', compass: 'edges' })).toMatchObject({ orient: 'heading', compass: 'edges' });
    expect(H.mergeMapCfg({ show: { walls: false } })).toMatchObject({ orient: 'north', compass: 'rose' });
  });
});

// ───────────────────────────── 2. the page ─────────────────────────────

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

async function boot({ store = {}, self = { x: 0, y: 0, z: 0, heading: 0, name: 'Aldenmar' }, points = [], group = [], corpses = [], segs = [[0, 0, 100, 0, 0]], kiteLoops = [], withCoach = false, scale = 1 } = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {}, canvas = { seq: [] }, docL = {};
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
      getContext() {
        return new Proxy({}, {
          get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : (...a) => { canvas.seq.push([k, ...a]); }),
          set: () => true,
        });
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
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, hidden: false,
    body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const payload = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: Date.now(), local_only: false,
    points, map: { bands: [0], segs, bounds: { minX: -300, maxX: 300, minY: -300, maxY: 300 } },
    self, group, raid: [], target: null, seen: [], unassigned: [], timers: [], corpses,
  };
  const calls = [];
  const fetchImpl = (u, o) => {
    calls.push({ url: String(u), opts: o || null });
    if (/\/api\/map-state/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    if (/\/api\/kite-loops/.test(u)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ loops: kiteLoops }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  const win = { addEventListener() {}, devicePixelRatio: 1, mimic: { onMapPos: (cb) => { win.pushPos = cb; } } };
  if (withCoach) win.WPKite = KC;
  const st = { 'wp-map-smooth': 'off', ...store };
  const ls = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); } };
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search: '' }, fetchImpl, ls, undefined, () => 1, () => {});
  await tick();
  const click = (id) => (all[id].listeners.click || []).forEach(f => f.call(all[id]));
  S.view.scale = scale; click('namesBtn'); click('namesBtn');   // (a zoom the page did not do itself, then two toggles that repaint and cancel out)
  const fire = (target, type, ev) => (target === 'doc' ? docL : all[target].listeners)[type].forEach(f => f(ev));
  const clear = () => { canvas.seq.length = 0; };
  const saved = () => JSON.parse(st['wp-map-cfg'] || '{}');
  // The text of the LAST frame (every frame starts with a clearRect).
  const texts = () => { const i = canvas.seq.map(s => s[0]).lastIndexOf('clearRect'); return canvas.seq.slice(i + 1).filter(s => s[0] === 'fillText').map(s => ({ t: s[1], x: s[2], y: s[3] })); };
  const hit = (pid) => all.hits.children.find(b => b.attrs['data-pid'] === String(pid));
  return { S, all, doc, win, canvas, calls, click, fire, clear, saved, texts, hit, store: st };
}
const WEST = (n = 'Aldenmar') => ({ x: 0, y: 0, z: 0, heading: 128, name: n });

describe('the Map page: North up is the map it was', () => {
  it('by default nothing is turned, and the buttons say North up', async () => {
    const m = await boot({ points: [{ id: 1, x: 100, y: 0, z: 0, respawn_s: 600, variance_s: 60, npcs: [] }], self: WEST() });
    expect(m.S.cfg.orient).toBe('north'); expect(m.S.view.rot || 0).toBe(0);
    expect(m.all.orientBtn.textContent).toBe('North up'); expect(m.all.orientBtn.classList.contains('on')).toBe(false);
    m.click('cfgBtn');
    const b = m.hit(1), me = px(100, 0, V({ cx: m.S.view.cx, cy: m.S.view.cy, scale: 1 }), m.S.w, m.S.h);
    near(parseFloat(b.style.left), me[0], 1e-6); near(parseFloat(b.style.top), me[1], 1e-6);
  });
  it('the compass is drawn: a rose with N E S W round it, N above its needle', async () => {
    const m = await boot({ self: WEST() });
    const t = m.texts(), n = t.find(x => x.t === 'N'), e = t.find(x => x.t === 'E'), s = t.find(x => x.t === 'S'), w = t.find(x => x.t === 'W');
    for (const k of [n, e, s, w]) expect(k).toBeTruthy();
    expect(n.y).toBeLessThan(e.y); expect(n.y).toBeLessThan(s.y);       // N above
    expect(w.x).toBeLessThan(n.x); expect(n.x).toBeLessThan(e.x);       // W left, E right
    near(n.x, s.x); near(e.y, w.y);
    expect(n.x).toBeLessThan(100); expect(n.y).toBeGreaterThan(250);      // in the bottom-left corner
  });
});

describe('Heading up', () => {
  const pts = [
    { id: 1, x: 100, y: 0, z: 0, respawn_s: 600, variance_s: 60, npcs: [] },    // 100 WEST of you
    { id: 2, x: 0, y: 100, z: 0, respawn_s: 600, variance_s: 60, npcs: [] },    // 100 NORTH of you
  ];
  it('the button turns it on, centres you, turns Follow me on, and saves the choice', async () => {
    const m = await boot({ self: WEST(), points: pts });
    m.S.follow = false; m.S.followOff = { x: 80, y: 20 };
    m.click('orientBtn');
    expect(m.S.cfg.orient).toBe('heading');
    expect(m.all.orientBtn.textContent).toBe('Heading up'); expect(m.all.orientBtn.classList.contains('on')).toBe(true);
    expect(m.S.follow).toBe(true); expect(m.S.followOff).toEqual({ x: 0, y: 0 });
    expect(m.saved()).toMatchObject({ orient: 'heading', compass: 'rose' });
    near(m.S.view.rot, H.headingRot(128));
  });
  it('facing west: the point 100 west is straight above you, the point 100 north is on your right (dots and click buttons)', async () => {
    const m = await boot({ self: WEST(), points: pts });
    m.click('orientBtn');
    const cx = m.S.w / 2, cy = m.S.h / 2;
    const west = m.hit(1), north = m.hit(2);
    near(parseFloat(west.style.left), cx, 1e-4); near(parseFloat(west.style.top), cy - 100, 1e-4);
    near(parseFloat(north.style.left), cx + 100, 1e-4); near(parseFloat(north.style.top), cy, 1e-4);
    // and the dot itself is drawn where its button is
    const arcs = m.canvas.seq.filter(s => s[0] === 'arc');
    expect(arcs.some(a => Math.abs(a[1] - cx) < 1e-4 && Math.abs(a[2] - (cy - 100)) < 1e-4)).toBe(true);
  });
  it('turns with you: face south and the same point moves to where south-up puts it', async () => {
    const m = await boot({ self: { ...WEST(), heading: 256 }, points: pts });
    m.click('orientBtn');
    const north = m.hit(2);                                   // facing south, north is BEHIND you: straight down
    near(parseFloat(north.style.left), m.S.w / 2, 1e-3); near(parseFloat(north.style.top), m.S.h / 2 + 100, 1e-3);
  });
  it('the cursor reads the point under it: a turned map still names the spot', async () => {
    const m = await boot({ self: WEST(), points: pts });
    m.click('orientBtn');
    m.fire('doc', 'mousemove', { clientX: m.S.w / 2, clientY: m.S.h / 2 - 100, buttons: 0 });   // above the middle: the point 100 west
    const cur = m.all.locBar.children.find(c => c.className === 'cur');
    expect(cur.textContent).toBe('(0, 100)');                // /loc order is Y, X: x = +100 (west), y = 0 ... printed as y, x
  });
  it('a drag moves the picture with the hand, not along the old north-up axes', async () => {
    const m = await boot({ self: WEST(), points: pts });
    m.click('orientBtn');
    const before = px(100, 0, m.S.view, m.S.w, m.S.h);
    m.fire('stage', 'mousedown', { button: 0, clientX: 300, clientY: 200, target: { closest: () => null } });
    m.fire('doc', 'mousemove', { clientX: 350, clientY: 230, buttons: 1 });
    const after = px(100, 0, m.S.view, m.S.w, m.S.h);
    near(after[0] - before[0], 50, 1e-6); near(after[1] - before[1], 30, 1e-6);
    expect(m.S.follow).toBe(false);                          // dragging is still "I'll look around myself"
  });
  it('zooming keeps the spot under the cursor where it was', async () => {
    const m = await boot({ self: WEST(), points: pts });
    m.click('orientBtn'); m.S.follow = false;
    const mx = 420, my = 120, before = H.screenToServer(mx, my, m.S.view, m.S.w, m.S.h);
    m.fire('stage', 'wheel', { preventDefault() {}, deltaY: -400, clientX: mx, clientY: my });
    expect(m.S.view.scale).toBeGreaterThan(1);
    const after = H.screenToServer(mx, my, m.S.view, m.S.w, m.S.h);
    near(after.x, before.x, 1e-6); near(after.y, before.y, 1e-6);
  });
  it('the walls turn with the picture', async () => {
    const m = await boot({ self: WEST(), segs: [[0, 0, 100, 0, 0]] });
    m.click('orientBtn');
    const seq = m.canvas.seq;
    const a = px(0, 0, m.S.view, m.S.w, m.S.h), b = px(100, 0, m.S.view, m.S.w, m.S.h);   // the wall runs from (0, 0) to (100, 0)
    near(a[0], b[0], 1e-6); near(a[1] - b[1], 100, 1e-6);   // facing west: the wall runs straight UP the screen from you, not along it
    const walls = seq.filter(s => s[0] === 'moveTo').map(s => [s[1], s[2]]);
    expect(walls.some(p => Math.abs(p[0] - a[0]) < 1e-4 && Math.abs(p[1] - a[1]) < 1e-4)).toBe(true);
    const lines = seq.filter(s => s[0] === 'lineTo').map(s => [s[1], s[2]]);
    expect(lines.some(p => Math.abs(p[0] - b[0]) < 1e-4 && Math.abs(p[1] - b[1]) < 1e-4)).toBe(true);
  });
  it('a raider\'s arrow points the way they face on the turned screen', async () => {
    const g = [{ name: 'Brackwyn', x: 0, y: 40, z: 0, heading: 0, class: 'cleric' }];   // 40 north of you, facing north
    const m = await boot({ self: WEST(), group: g });
    m.click('orientBtn');
    // you face west (up); they face north, which is to the RIGHT of up. Their arrow tip is right of the arrow's centre.
    const q = px(0, 40, m.S.view, m.S.w, m.S.h);
    const path = m.canvas.seq.filter(s => s[0] === 'moveTo');
    const tip = path.map(s => [s[1], s[2]]).find(p => Math.abs(p[1] - q[1]) < 0.01 && p[0] > q[0] && p[0] < q[0] + 12);
    expect(tip, 'arrow tip right of the raider').toBeTruthy();
  });
  it('your own arrow always points to the top; north up it points the way you face', async () => {
    const m = await boot({ self: WEST() });
    const tipOf = () => m.canvas.seq.slice(m.canvas.seq.map(s => s[0]).lastIndexOf('clearRect')).filter(s => s[0] === 'moveTo' && Math.abs(s[1] - 300) < 40 && Math.abs(s[2] - 200) < 40);
    expect(tipOf().pop()[1]).toBeLessThan(300 - 3);               // west is the left of the screen, north up
    m.click('orientBtn');
    const tip = tipOf().pop();
    near(tip[1], 300, 1e-6); expect(tip[2]).toBeLessThan(200 - 3);   // heading up: straight up from you
  });
  it('Follow me\'s spot on the screen is on the turned picture: parked low, you stay low as you turn', async () => {
    const m = await boot({ self: WEST() });
    m.click('orientBtn');
    m.S.followOff = { x: 0, y: 100 };                          // 100 px below the middle, as a driving map parks you
    m.click('namesBtn'); m.click('namesBtn');
    const me = H.projectPx(H.toScreen(0, 0).sx, H.toScreen(0, 0).sy, m.S.view, m.S.w, m.S.h);
    near(me[0], 300, 1e-6); near(me[1], 300, 1e-6);
  });
  it('text is never turned: no rotate call, and the compass letters stay where the maths puts them', async () => {
    const m = await boot({ self: WEST() });
    m.click('orientBtn');
    expect(m.canvas.seq.some(s => s[0] === 'rotate' || s[0] === 'transform')).toBe(false);
    expect(m.canvas.seq.filter(s => s[0] === 'setTransform').every(s => s[1] === 1 && s[2] === 0 && s[3] === 0 && s[4] === 1)).toBe(true);
  });
  it('the compass is drawn in both: facing west, N is on the right of the rose, W above it', async () => {
    const m = await boot({ self: WEST() });
    m.click('orientBtn');
    const t = m.texts(), n = t.find(x => x.t === 'N'), w = t.find(x => x.t === 'W'), e = t.find(x => x.t === 'E'), s = t.find(x => x.t === 'S');
    near(w.x, 37); expect(w.y).toBeLessThan(363);                          // W straight above the rose's middle (37, 363)
    near(n.y, 363); expect(n.x).toBeGreaterThan(37);                      // N on its right
    near(s.y, 363); expect(s.x).toBeLessThan(37);                         // S on its left
    near(e.x, 37); expect(e.y).toBeGreaterThan(363);                      // E below
  });
  it('edge letters ride round: facing west the W is top-middle (under the buttons) and N is at the right edge', async () => {
    const m = await boot({ self: WEST(), store: { 'wp-map-cfg': JSON.stringify({ compass: 'edges', orient: 'heading' }) } });
    const t = m.texts(), n = t.find(x => x.t === 'N'), w = t.find(x => x.t === 'W');
    near(w.x, 300); near(w.y, 38);                                         // 6 + the bar's 20 + 12
    near(n.x, 584); near(n.y, 200);
    expect(m.texts().filter(x => /^[NESW]$/.test(x.t))).toHaveLength(4);   // edges only: no rose
  });
});

describe('the choice is kept, and reachable from ⚙ too', () => {
  it('a saved Heading up opens the Map heading up; a junk save opens it north up', async () => {
    const a = await boot({ self: WEST(), store: { 'wp-map-cfg': JSON.stringify({ orient: 'heading' }) } });
    expect(a.S.cfg.orient).toBe('heading'); near(a.S.view.rot, H.headingRot(128)); expect(a.all.orientBtn.textContent).toBe('Heading up');
    const b = await boot({ self: WEST(), store: { 'wp-map-cfg': JSON.stringify({ orient: 'up', compass: 7 }) } });
    expect(b.S.cfg).toMatchObject({ orient: 'north', compass: 'rose' }); expect(b.S.view.rot || 0).toBe(0);
  });
  it('⚙ → Map up and ⚙ → Compass drive the same switches', async () => {
    const m = await boot({ self: WEST() });
    m.click('cfgBtn');
    m.all.cfgOrient.value = 'heading'; m.fire('cfgOrient', 'change', { target: m.all.cfgOrient });
    expect(m.S.cfg.orient).toBe('heading'); expect(m.all.orientBtn.textContent).toBe('Heading up'); expect(m.saved().orient).toBe('heading');
    m.all.cfgCompass.value = 'both'; m.fire('cfgCompass', 'change', { target: m.all.cfgCompass });
    expect(m.saved().compass).toBe('both');
    m.clear(); m.click('orientBtn');                                       // back to north: one click, and the select follows
    expect(m.S.cfg.orient).toBe('north'); expect(m.all.cfgOrient.value).toBe('north'); expect(m.S.view.rot).toBe(0);
    expect(m.texts().filter(x => /^[NESW]$/.test(x.t))).toHaveLength(8);   // both: the rose's four and the edges' four
  });
  it('the setting lives with the other Map settings: no tray or dashboard copy exists to keep in step', () => {
    // Map mode is the only Map setting main.js owns (the window shape); every other switch is page-local. The parity rule
    // asks for a dashboard twin only where the dashboard already carries Map settings.
    const MAIN = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    const DASH = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
    expect(MAIN).not.toMatch(/facing|kiteOthers|showAggro/);
    expect(DASH).not.toMatch(/cfgFacing|mapFacing/);
  });
});

// ───────────────────────────── 3. everything on the map turns together ─────────────────────────────
// One projection (wpt) draws every dot, label, ring, trail, corpse and route, so one test per KIND of thing is enough: the
// kite circles (yours, the forecast ring, a raider's), a corpse's marker, and the text guard below for the rest.

describe('the kite circles, the forecast and the corpses turn with the picture', () => {
  let clock;
  beforeEach(() => { clock = 1_760_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => clock); });
  afterEach(() => { vi.restoreAllMocks(); });
  const GUILD = { id: 5, cx: 560, cy: -250, cz: 12, r: 60, lap_s: 12.4, speed_pct: 104, dir: 'cw', drift_u: 3, wobble_u: 2, laps: 9, seen: 7 };
  // A clockwise circle on the Map (screen x = -x): the same path the kite coach's own tests walk.
  const circle = ({ cx, cy, r, lap, drift }) => (s) => {
    const th = 2 * Math.PI * s / lap;
    return { x: cx - r * Math.cos(th) + drift[0] * s, y: cy - r * Math.sin(th) + drift[1] * s, z: 12 };
  };
  const drive = (m, path, secs, heading) => {
    const t0 = clock;
    for (let i = 0; i < secs * 10; i++) {
      clock += 100;
      const p = path((clock - t0) / 1000);
      m.win.pushPos({ character: 'Aldenmar', zone_id: null, at: clock, self: { x: p.x, y: p.y, z: p.z, heading }, group: [], raid: [], target: null });
    }
  };
  const lastFrame = (m) => { const i = m.canvas.seq.map(s => s[0]).lastIndexOf('clearRect'); return m.canvas.seq.slice(i + 1); };
  const ringAt = (m, r, p) => lastFrame(m).filter(s => s[0] === 'arc').some(a => Math.abs(a[3] - r * m.S.view.scale) < 1e-6 && Math.abs(a[1] - p[0]) < 1e-4 && Math.abs(a[2] - p[1]) < 1e-4);

  it('your circle, a raider\'s circle and the drift ring are drawn where the turned map puts them', async () => {
    const loops = [{ ...GUILD, last_at: new Date(clock - 60_000).toISOString() }];
    const m = await boot({ self: { x: 500, y: -300, z: 12, heading: 128, name: 'Aldenmar' }, withCoach: true, kiteLoops: loops, scale: 2 });
    m.click('orientBtn');
    drive(m, circle({ cx: 500, cy: -300, r: 25, lap: 6.4, drift: [0.4, 0] }), 90, 128);
    expect(m.S.kiteView, 'the coach found the circle').not.toBeNull();
    expect(m.S.kiteView.showArrow).toBe(true);
    near(m.S.view.rot, H.headingRot(128));
    const v = m.S.view, c = m.S.kiteView.cur;
    expect(ringAt(m, c.r, px(c.cx, c.cy, v, m.S.w, m.S.h))).toBe(true);                   // yours
    expect(ringAt(m, GUILD.r, px(GUILD.cx, GUILD.cy, v, m.S.w, m.S.h))).toBe(true);       // a raider's
    expect(m.S.kite && m.S.guild.loops.length).toBe(1);
    m.click('kiteDriftBtn'); drive(m, circle({ cx: 500, cy: -300, r: 25, lap: 6.4, drift: [0.4, 0] }), 0.1, 128);
    const f = KC.driftForecast(m.S.kiteView, m.S.view.scale, KC.K.DRIFT_STEP_PX);
    expect(ringAt(m, c.r, px(f.land.cx, f.land.cy, m.S.view, m.S.w, m.S.h))).toBe(true);    // where it lands
    // and it really is a different place from the north-up picture's
    const flat = H.projectPx(H.toScreen(f.land.cx, f.land.cy).sx, H.toScreen(f.land.cx, f.land.cy).sy, { ...m.S.view, rot: 0 }, m.S.w, m.S.h);
    const turned = px(f.land.cx, f.land.cy, m.S.view, m.S.w, m.S.h);
    expect(Math.hypot(flat[0] - turned[0], flat[1] - turned[1])).toBeGreaterThan(5);
  });
  it('a corpse is marked where the turned map puts it, and its label stays upright', async () => {
    const corpse = { name: 'Corvale', x: 0, y: 60, z: 0 };                    // 60 north of you
    const m = await boot({ self: WEST(), corpses: [corpse], store: { 'wp-map-cfg': JSON.stringify({ orient: 'heading' }) } });
    const skull = m.texts().find(t => t.t === '☠');
    expect(skull, 'the skull is drawn').toBeTruthy();
    const want = px(0, 60, m.S.view, m.S.w, m.S.h);
    near(skull.x, want[0], 1e-4); near(skull.y, want[1], 1e-4);
    near(want[0], m.S.w / 2 + 60, 1e-4);                                           // facing west, north is the right
  });
  it('nothing in the drawing projects a point by hand except the walls, and they turn too', () => {
    const js = stripJs(MAP_HTML);
    const draw = sliceBlock(js, 'function renderMapInner(animating) {', 'var flashTimer = null;');
    const manual = draw.match(/\* v\.scale \+ ox/g) || [];
    expect(manual).toHaveLength(4);                                                 // the two wall loops, two ends each (x; y is "+ oy")
    expect(draw.match(/if \(rot\) \{ turnPt\(/g)).toHaveLength(2);                  // ... and each loop turns its two ends
    expect(draw).not.toMatch(/\bctx\.(rotate|transform)\(/);                        // text is never turned
  });
});

describe('the picture glides to a new heading instead of snapping, and the frame loop runs until it arrives', () => {
  let clock, queued;
  beforeEach(() => {
    clock = 1_760_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => clock);
    queued = null; globalThis.requestAnimationFrame = (f) => { queued = f; return 1; };
  });
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.requestAnimationFrame; });
  it('turns the short way in steps, then stops asking for frames', async () => {
    const m = await boot({ self: { x: 0, y: 0, z: 0, heading: 500, name: 'Aldenmar' }, store: { 'wp-map-cfg': JSON.stringify({ orient: 'heading' }) } });
    expect(m.S.rotHead).toBe(500);
    queued = null;
    m.win.pushPos({ character: 'Aldenmar', zone_id: null, at: clock, self: { x: 0, y: 0, z: 0, heading: 40 }, group: [], raid: [], target: null });   // 52 units on, across the seam
    expect(queued, 'a frame is asked for').toBeTypeOf('function');
    const seen = [];
    for (let i = 0; i < 200 && queued; i++) { const f = queued; queued = null; clock += 33; f(); seen.push(m.S.rotHead); }
    expect(queued).toBeNull();                                // arrived: no more frames
    expect(m.S.rotHead).toBe(40);
    expect(seen.length).toBeGreaterThan(3); expect(seen.length).toBeLessThan(60);
    const unwrapped = seen.map(h => (h < 100 ? h + 512 : h));
    for (let i = 1; i < unwrapped.length; i++) expect(unwrapped[i]).toBeGreaterThanOrEqual(unwrapped[i - 1]);   // forward through 0, never back round
    expect(Math.min(...seen.slice(0, -1).filter(h => h > 300))).toBeGreaterThan(499);
  });
  it('North up never asks for a turning frame', async () => {
    const m = await boot({ self: { x: 0, y: 0, z: 0, heading: 500, name: 'Aldenmar' } });
    queued = null;
    m.win.pushPos({ character: 'Aldenmar', zone_id: null, at: clock, self: { x: 0, y: 0, z: 0, heading: 40 }, group: [], raid: [], target: null });
    expect(queued).toBeNull(); expect(m.S.view.rot || 0).toBe(0);
  });
});
