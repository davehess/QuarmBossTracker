// test/map-respawns-expand.test.js — FB-100: the Map's Respawns count opens into its spots, and clicks act on the map.
//
// FB-100 (open since 2026-10-26): "The respawns (6) needs to be expandable to show the actual spots. Clicking on the top-level
// should highlight the spawns that are down". The guild lead then: "LEFT CLICK PULSE, RIGHT CLICK MAP FOCUS."
//
// Two halves, each run as shipped:
//  1. apps/mimic/map.html's pure helpers (spotRows, pulseAt, pointsBox, focusView, mergeTimers' timers).
//  2. the page's script booted against a stub page that records every canvas call: the top line carries the count and a ▸ button,
//     the button lists every spot a folded row hides, a left click on the top line rings out from every spot that is down, a right
//     click zooms the map to them, a spot row does the same for its own spot, the pulse ends by itself, and the pop-out's clicks
//     reach the Map window over the centring channel.
//
// Mutation-checked (by hand, 2026-10-27): take the contextmenu handler off the top line and "right-click on the top line zooms"
// fails; take the pulse ring out of drawPulse and "a left click on the top line rings out from every spot" fails; let the
// button forget its state and "the spots stay listed through the next poll" fails; sort spotRows by id and "soonest first"
// fails.
//
// Run: npx vitest run test/map-respawns-expand.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
const H = new Function(helpers + '\nreturn { spotRows, mergeTimers, pulseAt, pointsBox, focusView, fitView, PULSE_MS, PULSE_RING_MS, PULSE_MAX_SCALE };')();

const near = (a, b, d = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(d);

// ───────────────────────────── 1. the helpers ─────────────────────────────

describe('spotRows: the spots behind one folded row', () => {
  const byId = { 1: { id: 1, x: 10, y: 0 }, 2: { id: 2, x: 20, y: 0 }, 3: { id: 3, x: 30, y: 0 } };
  const T = (id, e) => ({ point_id: id, name: 'a bat', earliest: e, latest: e + 1000, source: 'seen' });
  it('soonest first, ties by point id; a spot the zone data does not know is left out', () => {
    const r = H.spotRows([T(3, 500), T(1, 900), T(2, 500), T(99, 100)], byId);
    expect(r.map(s => s.pid)).toEqual(['2', '3', '1']);
    expect(r[0].p).toBe(byId[2]);
  });
  it('nothing in, nothing out', () => {
    expect(H.spotRows(null, byId)).toEqual([]); expect(H.spotRows([T(1, 1)], null)).toEqual([]);
  });
  it('mergeTimers hands every folded timer on', () => {
    const g = H.mergeTimers([T(1, 5), T(2, 6)], 0);
    expect(g).toHaveLength(1); expect(g[0].n).toBe(2); expect(g[0].timers.map(t => t.point_id)).toEqual([1, 2]);
  });
});

describe('pulseAt: a pulse lasts PULSE_MS, ringing out once a PULSE_RING_MS', () => {
  const p = { ids: { 1: true }, t0: 10_000 };
  it('is null before it starts, at its end and after, and when there is none', () => {
    expect(H.pulseAt(null, 10_000)).toBeNull();
    expect(H.pulseAt(p, 9_999)).toBeNull();
    expect(H.pulseAt(p, 10_000 + H.PULSE_MS)).toBeNull();
    expect(H.pulseAt(p, 10_000 + H.PULSE_MS + 5000)).toBeNull();
  });
  it('the ring starts small, grows to the end of each second, and the whole pulse dies away', () => {
    const a = H.pulseAt(p, 10_000), b = H.pulseAt(p, 10_500), c = H.pulseAt(p, 11_250);
    near(a.phase, 0); near(b.phase, 0.5); near(c.phase, 0.25);               // the ring starts over every PULSE_RING_MS
    near(a.fade, 1); near(b.fade, 1 - 500 / H.PULSE_MS); expect(c.fade).toBeLessThan(b.fade);
  });
});

describe('focusView / pointsBox: zoom to the spots that are down', () => {
  it('the box round some points; nothing for none or for junk', () => {
    expect(H.pointsBox([{ x: 5, y: -3 }, { x: -2, y: 9 }, { x: 4, y: 0 }])).toEqual({ minX: -2, maxX: 5, minY: -3, maxY: 9 });
    expect(H.pointsBox([])).toBeNull(); expect(H.pointsBox(null)).toBeNull(); expect(H.pointsBox([{ x: NaN, y: 1 }])).toBeNull();
  });
  it('shows the whole box, but two spots a few units apart do not fill the screen', () => {
    const wide = H.focusView({ minX: 0, maxX: 800, minY: 0, maxY: 400 }, 600, 400, 0);
    near(wide.scale, H.fitView({ minX: 0, maxX: 800, minY: 0, maxY: 400 }, 600, 400).scale);
    const tight = H.focusView({ minX: 0, maxX: 6, minY: 0, maxY: 4 }, 600, 400, 0);
    expect(tight.scale).toBe(H.PULSE_MAX_SCALE);
  });
  it('heading up fits the turned box', () => {
    const b = { minX: 0, maxX: 800, minY: 0, maxY: 100 };
    expect(H.focusView(b, 600, 600, Math.PI / 2).scale).toBeLessThan(H.focusView(b, 600, 600, 0).scale + 1e-9);
    near(H.focusView(b, 600, 600, Math.PI / 2).scale, H.fitView(b, 600, 600, Math.PI / 2).scale);
  });
});

// ───────────────────────────── 2. the page ─────────────────────────────

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

// Six spots on timers: four "a blood raven" (folded into one row) and two "a bat" (another). Server frame x, y.
const POINTS = [
  { id: 1, x: 100, y: 40, z: 0 }, { id: 2, x: -60, y: 80, z: 0 }, { id: 3, x: 30, y: -120, z: 0 }, { id: 4, x: -150, y: -30, z: 0 },
  { id: 5, x: 210, y: 150, z: 0 }, { id: 6, x: 20, y: 20, z: 0 },
].map(p => ({ respawn_s: 600, variance_s: 60, npcs: [], ...p }));
const timersAt = (now) => [
  { point_id: 3, name: 'a blood raven', earliest: now + 300_000, latest: now + 400_000, source: 'seen' },
  { point_id: 1, name: 'a blood raven', earliest: now + 100_000, latest: now + 200_000, source: 'seen' },
  { point_id: 4, name: 'a blood raven', earliest: now + 200_000, latest: now + 300_000, source: 'seen', by: 'Corvale' },
  { point_id: 2, name: 'a blood raven', earliest: now + 400_000, latest: now + 500_000, source: 'marked' },
  { point_id: 5, name: 'a bat', earliest: now + 120_000, latest: now + 220_000, source: 'seen' },
  { point_id: 6, name: 'a bat', earliest: now + 140_000, latest: now + 240_000, source: 'seen' },
];

async function boot({ store = {}, timers, search = '', mimic, self = { x: 0, y: 0, z: 0, heading: 0, name: 'Aldenmar' } } = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {}, canvas = { seq: [] };
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      insertBefore(ch, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(ch); else this.children.splice(i, 0, ch); return ch; },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
      getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : (...a) => { canvas.seq.push([k, ...a]); }), set: () => true }); },
    };
    Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
    Object.defineProperty(e, 'textContent', { get() { return this.children.length ? this._tc + this.children.map(c => c.textContent).join('') : this._tc; }, set(v) { this._tc = v; if (v === '') this.children.length = 0; } });
    Object.defineProperty(e, 'innerHTML', { get() { return this._ih || ''; }, set(v) { this._ih = v; if (v === '') this.children.length = 0; } });
    return e;
  };
  const docL = {};
  const doc = {
    getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
    createElement: mkEl, createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, hidden: false,
    body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const now = Date.now();
  const payload = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now, local_only: false,
    points: POINTS, map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -300, maxX: 300, minY: -300, maxY: 300 } },
    self, group: [], raid: [], target: null, seen: [], unassigned: [], timers: timers || timersAt(now), watched: {},
  };
  const win = { addEventListener() {}, devicePixelRatio: 1, mimic };
  const st = { 'wp-map-smooth': 'off', ...store };
  const ls = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); } };
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search }, () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }), ls, undefined, () => 1, () => {});
  await tick();
  const rows = () => all.lists.children.filter(c => /\btrow\b/.test(c.className) && !/\bwatch\b|engaged|seen|corpse/.test(c.className));
  const head = () => all.lists.children.find(c => /\bsec resp\b/.test(c.className));
  const fire = (el, type) => { const ev = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; (el.listeners[type] || []).forEach(f => f(ev)); return ev; };
  const lastFrame = () => { const i = canvas.seq.map(s => s[0]).lastIndexOf('clearRect'); return canvas.seq.slice(i + 1); };
  const repaint = () => { all.namesBtn.listeners.click.forEach(f => f()); all.namesBtn.listeners.click.forEach(f => f()); };   // two toggles that cancel out
  const px = (p) => [(-p.x - S.view.cx) * S.view.scale + S.w / 2, (-p.y - S.view.cy) * S.view.scale + S.h / 2];
  const ringsAround = (p) => { const q = px(p); return lastFrame().filter(s => s[0] === 'arc' && Math.abs(s[1] - q[0]) < 1e-4 && Math.abs(s[2] - q[1]) < 1e-4 && s[3] > 10); };
  return { S, all, doc, win, canvas, rows, head, fire, lastFrame, repaint, ringsAround, px, store: st, toastText: () => all.toast.textContent };
}

describe('Respawns: the count opens into its spots', () => {
  it('the top line carries the count and a ▸ button; the rows are the folded groups', async () => {
    const m = await boot();
    const h = m.head();
    expect(h._tc).toBe('Respawns (6)');
    expect(h.attrs['data-wp-interact']).toBe('');                       // a clickable div needs the hover handshake
    expect(h.title).toMatch(/pulse every spot/i); expect(h.title).toMatch(/Right-click/);
    const more = h.children[0];
    expect(more.className).toBe('more'); expect(more.textContent).toBe('▸ spots'); expect(more.attrs['data-wp-interact']).toBe('');
    expect(m.rows().map(r => r.children[0].textContent)).toEqual(['a blood raven ×4', 'a bat ×2']);   // soonest first: a raven is up in 100 s, a bat in 120
  });
  it('the ▸ button lists every spot under its row, soonest first, and says where each is', async () => {
    const m = await boot();
    m.fire(m.head().children[0], 'click');
    expect(m.S.respOpen).toBe(true); expect(m.store['wp-map-resp-open']).toBe('1');
    expect(m.head().children[0].textContent).toBe('▾ spots');
    const kids = m.rows().map(r => [r.className.includes('sub'), r.children[0].textContent, r.children[2].textContent]);
    expect(kids).toEqual([
      [false, 'a blood raven ×4', 'next of 4 · seen'],
      [true, 'spot #1', '(40, 100)'],                              // /loc order: y, x
      [true, 'spot #4', '(-30, -150) · by Corvale'],
      [true, 'spot #3', '(-120, 30)'],
      [true, 'spot #2', '(80, -60) · marked'],
      [false, 'a bat ×2', 'next of 2 · seen'],
      [true, 'spot #5', '(150, 210)'],
      [true, 'spot #6', '(20, 20)'],
    ]);
    const subs = m.rows().filter(r => r.className.includes('sub'));
    expect(subs.every(r => r.attrs['data-wp-interact'] === '' && /pulse this spot/.test(r.title))).toBe(true);
    expect(subs[0].children[1].textContent).toBe('up in 1m40s–3m20s');   // each spot has ITS time, not the folded row's
  });
  it('the spots stay listed through the next poll, and a saved choice opens the list on the next run', async () => {
    const m = await boot();
    m.fire(m.head().children[0], 'click');
    m.S.sideAt = 0; m.fire(m.all.followBtn, 'click'); m.fire(m.all.followBtn, 'click');   // any repaint of the list path
    expect(m.rows().filter(r => r.className.includes('sub'))).toHaveLength(6);
    const again = await boot({ store: m.store });
    expect(again.S.respOpen).toBe(true); expect(again.rows().filter(r => r.className.includes('sub'))).toHaveLength(6);
    m.fire(m.head().children[0], 'click');                                  // ▾ folds them back
    expect(m.S.respOpen).toBe(false); expect(m.rows()).toHaveLength(2); expect(m.store['wp-map-resp-open']).toBe('0');
  });
  it('with nothing folded there is nothing to open: no button, and the list is the spots already', async () => {
    const now = Date.now();
    const m = await boot({ timers: [{ point_id: 1, name: 'a bat', earliest: now + 1000, latest: now + 2000, source: 'seen' }, { point_id: 2, name: 'a wolf', earliest: now + 1000, latest: now + 2000, source: 'seen' }] });
    expect(m.head()._tc).toBe('Respawns (2)'); expect(m.head().children).toHaveLength(0);
    expect(m.rows()).toHaveLength(2);
  });
  it('the folded rows keep what they did: a click centres on the soonest spot', async () => {
    const m = await boot();
    const row = m.rows().find(r => r.children[0].textContent === 'a blood raven ×4');
    m.fire(row, 'click');
    near(m.S.view.cx, -100); near(m.S.view.cy, -40);                       // spot #1 at (100, 40): screen = (-x, -y)
  });
});

describe('FB-100: left click pulses, right click focuses', () => {
  it('a left click on the top line rings out from every spot that is down, and says so', async () => {
    const m = await boot();
    m.S.view.scale = 0.5; m.repaint();
    m.fire(m.head(), 'click');
    expect(Object.keys(m.S.pulse.ids).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(m.toastText()).toBe('Pulsing 6 spots that are down');
    for (const p of POINTS) expect(m.ringsAround(p).length, `spot ${p.id}`).toBeGreaterThanOrEqual(2);   // the steady ring and the one ringing out
    const other = { x: 400, y: 400 };
    expect(m.ringsAround(other)).toHaveLength(0);                          // (the check can fail: nobody else rings)
  });
  it('the pulse is over by itself after three seconds', async () => {
    const m = await boot();
    m.S.view.scale = 0.5; m.fire(m.head(), 'click');
    expect(m.S.pulse).not.toBeNull();
    m.S.pulse.t0 = Date.now() - 3500;                                       // three and a half seconds on
    m.repaint();
    expect(m.S.pulse).toBeNull();
    for (const p of POINTS) expect(m.ringsAround(p).filter(a => a[3] > 12)).toHaveLength(0);   // no ring bigger than a dot is left
  });
  it('a right click on the top line zooms the map to every spot that is down, and Follow lets go', async () => {
    const m = await boot();
    m.S.view.scale = 3; m.S.follow = true;
    const ev = m.fire(m.head(), 'contextmenu');
    expect(ev.prevented && ev.stopped).toBe(true);                         // not the browser's menu, and not the stage's right click
    expect(m.S.follow).toBe(false);
    expect(m.S.view.scale).toBeLessThan(3);
    for (const p of POINTS) { const q = m.px(p); expect(q[0]).toBeGreaterThan(0); expect(q[0]).toBeLessThan(m.S.w); expect(q[1]).toBeGreaterThan(0); expect(q[1]).toBeLessThan(m.S.h); }
    expect(m.S.pulse).toBeNull();                                           // focus is not a pulse
  });
  it('a left click on a spot pulses that spot alone; a right click centres the map on it, keeping the zoom', async () => {
    const m = await boot();
    m.fire(m.head().children[0], 'click');
    const spot = m.rows().filter(r => r.className.includes('sub')).find(r => r.children[0].textContent === 'spot #3');
    m.fire(spot, 'click');
    expect(Object.keys(m.S.pulse.ids)).toEqual(['3']);
    expect(m.toastText()).toBe('Pulsing 1 spot');
    m.S.view.scale = 1.7;
    const ev = m.fire(spot, 'contextmenu');
    expect(ev.prevented && ev.stopped).toBe(true);
    near(m.S.view.cx, -30); near(m.S.view.cy, 120); expect(m.S.view.scale).toBe(1.7);   // spot #3 at (30, -120)
  });
  it('spots off the visible map are counted in the toast, so the pulse is not silently missing', async () => {
    const m = await boot();
    m.S.view.scale = 3;                                                     // zoomed in: most spots are off screen
    m.repaint(); m.fire(m.head(), 'click');
    expect(m.toastText()).toMatch(/^Pulsing 6 spots that are down · \d off the map: right-click to zoom to them$/);
  });
  it('a spot the zone data does not know is not pulsed, and nothing at all is a quiet no-op', async () => {
    const now = Date.now();
    const m = await boot({ timers: [{ point_id: 777, name: 'a bat', earliest: now + 1000, latest: now + 2000, source: 'seen' }] });
    m.fire(m.head(), 'click'); m.fire(m.head(), 'contextmenu');
    expect(m.S.pulse).toBeNull(); expect(m.toastText()).toBe('');
  });
  it('the frame loop runs while a pulse is on and stops after (nothing idles)', async () => {
    let raf = null; globalThis.requestAnimationFrame = (f) => { raf = f; return 1; };
    try {
      const m = await boot(); raf = null;
      m.S.view.scale = 0.5; m.fire(m.head(), 'click');
      expect(raf, 'a frame is asked for').toBeTypeOf('function');
      m.S.pulse.t0 = Date.now() - 4000;                                       // over: the next frame is the last
      const f = raf; raf = null; f();
      expect(raf).toBeNull(); expect(m.S.pulse).toBeNull();
    } finally { delete globalThis.requestAnimationFrame; }
  });
  it('the pop-out sends its clicks to the Map window over the centring channel; the Map window obeys them', async () => {
    const sent = [];
    const pop = await boot({ search: '?part=timers', mimic: { mapCentreOn: (v) => sent.push(v), onMapCentre() {} } });
    pop.fire(pop.head(), 'click'); pop.fire(pop.head(), 'contextmenu');
    expect(sent).toEqual([{ act: 'pulse', ids: ['3', '1', '4', '2', '5', '6'] }, { act: 'focus', ids: ['3', '1', '4', '2', '5', '6'] }]);
    let cb = null;
    const map = await boot({ mimic: { onMapCentre: (f) => { cb = f; } } });
    cb({ act: 'pulse', ids: ['5'] });
    expect(Object.keys(map.S.pulse.ids)).toEqual(['5']);
    cb('4');                                                                 // a bare id is still "centre on it"
    near(map.S.view.cx, 150); near(map.S.view.cy, 30);
    cb({ act: 'focus', ids: ['1', '2'] }); expect(map.S.view.scale).toBeLessThanOrEqual(H.PULSE_MAX_SCALE);
    const popOnly = await boot({ search: '?part=timers', mimic: { mapCentreOn() {}, onMapCentre() {} } });
    expect(popOnly.S.pulse).toBeNull();
    const now = Date.now(), odd = [];                                       // a timer on a spot the zone data lacks is not sent
    const pop2 = await boot({ search: '?part=timers', mimic: { mapCentreOn: (v) => odd.push(v), onMapCentre() {} },
      timers: [{ point_id: 777, name: 'a bat', earliest: now + 1, latest: now + 2, source: 'seen' }, { point_id: 2, name: 'a bat', earliest: now + 1, latest: now + 2, source: 'seen' }] });
    pop2.fire(pop2.head(), 'click');
    expect(odd).toEqual([{ act: 'pulse', ids: ['2'] }]);
  });
  it('the whole thing is page-local: no new channel in main.js or the preload', () => {
    const MAIN = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(MAIN).toMatch(/ipcMain\.on\('map-centre', \(_e, pointId\) =>/);   // the existing channel, untouched: it forwards whatever it is given
    expect(MAIN).not.toMatch(/map-pulse|map-focus/);
  });
});
