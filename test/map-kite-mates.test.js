// test/map-kite-mates.test.js — FB-103: a group member's kite circle, drawn as it forms.
//
// FB-103 (2026-10-27, a member on Mimic 3.0.5-beta.9): "Should be able to see <a group member>'s circle getting formed with me in
// his group."
//
// Why it was missing: the Map's circles are (a) YOURS, from your own positions, and (b) the guild library's, which holds only
// FINISHED loops: their raider's own Map has to see 3 clean laps and post one anonymous summary (utils/kiteLoops.js), the bot
// serves it, the agent caches that for 10 minutes and the Map asks the agent once a minute (apps/mimic/kiteCoach.js OTHERS_LIVE_MS).
// A circle still being run is in none of those, and a loop never carries a name. Meanwhile the group member's positions were
// already on the Map every poll: nothing coached them. Now the Map runs a coach on each group member (matesFeed), locally, and
// draws what it finds (dotted, in their class colour, named).
//
// Two halves, each run as shipped:
//  1. apps/mimic/kiteCoach.js: mateLabel / mateFormed (the words).
//  2. the page's script against a stub page recording every canvas call, with the real kiteCoach.js: a circle forms, is labelled
//     "forming n/3" then "circle r R · S s", goes when it stops or they leave, is hidden by the same switches, posts nothing.
//
// Mutation-checked (by hand, 2026-10-27): feed the mates coach only when the member is YOU and "a circle shows while it forms"
// fails; let the mates' events post a report and "posts nothing" fails; drop the freshness test in visibleMates and "goes quiet
// when they stop" fails; skip the filter and "Circles: My speed" fails; draw them solid and "dotted" fails.
//
// Run: npx vitest run test/map-kite-mates.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const KC = require(path.join(ROOT, 'apps', 'mimic', 'kiteCoach.js'));
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

const near = (a, b, d = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(d);

// ───────────────────────────── 1. the words ─────────────────────────────

describe('mateLabel: what a forming circle says', () => {
  const view = (o = {}) => ({ provisional: false, streak: 0, reported: false, cur: { r: 61.6, lapS: 12.4 }, ...o });
  it('forming until three clean laps in a row; then the circle, its size and its lap time', () => {
    expect(KC.mateLabel('Brackwyn', view({ provisional: true }))).toBe('Brackwyn · forming');
    expect(KC.mateLabel('Brackwyn', view({ streak: 0 }))).toBe('Brackwyn · forming 0/3');
    expect(KC.mateLabel('Brackwyn', view({ streak: 2 }))).toBe('Brackwyn · forming 2/3');
    expect(KC.mateLabel('Brackwyn', view({ streak: 3 }))).toBe('Brackwyn · circle r 62 · 12 s');
    expect(KC.mateLabel('Brackwyn', view({ streak: 1, reported: true }))).toBe('Brackwyn · circle r 62 · 12 s');
    expect(KC.mateLabel('Brackwyn', null)).toBe('Brackwyn');
  });
  it('mateFormed is the same bar the guild library uses (K.CLEAN_LAPS)', () => {
    expect(KC.K.CLEAN_LAPS).toBe(3);
    expect(KC.mateFormed({ streak: 2, reported: false })).toBe(false);
    expect(KC.mateFormed({ streak: 3, reported: false })).toBe(true);
    expect(KC.mateFormed(null)).toBe(false);
  });
});

// ───────────────────────────── 2. the page ─────────────────────────────

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

let clock, nowSpy;
beforeEach(() => { clock = 1_760_000_000_000; nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock); });
afterEach(() => { nowSpy.mockRestore(); });

async function boot({ store = {}, group = [{ name: 'Brackwyn', x: 500, y: -300, z: 12, heading: 0, class: 'bard' }], withCoach = true, kiteLoops = [] } = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {}, canvas = { seq: [] };
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
      getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : (...a) => { canvas.seq.push([k, ...a]); }), set: () => true }); },
    };
    Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
    Object.defineProperty(e, 'textContent', { get() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._tc; }, set(v) { this._tc = v; if (v === '') this.children.length = 0; } });
    Object.defineProperty(e, 'innerHTML', { get() { return this._ih || ''; }, set(v) { this._ih = v; if (v === '') this.children.length = 0; } });
    return e;
  };
  const doc = {
    getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
    createElement: mkEl, createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
    addEventListener() {}, hidden: false, body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const payload = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: clock, local_only: false,
    points: [], map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -300, maxX: 900, minY: -700, maxY: 300 } },
    self: { x: 900, y: 200, z: 12, heading: 0, name: 'Aldenmar' }, group, raid: [], target: null, seen: [], unassigned: [], timers: [],
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
  S.view.scale = 1;
  const click = (id) => (all[id].listeners.click || []).forEach(f => f.call(all[id]));
  const frame = () => { const i = canvas.seq.map(s => s[0]).lastIndexOf('clearRect'); return canvas.seq.slice(i + 1); };
  const texts = () => frame().filter(s => s[0] === 'fillText').map(s => ({ t: s[1], x: s[2], y: s[3] }));
  const repaint = () => { click('namesBtn'); click('namesBtn'); };
  // Group members walk their own paths; you (Aldenmar) stand still far away unless a path is given.
  // (the paths run on the clock since the page booted, so a run driven in several pieces is one walk)
  const t0 = clock;
  const drive = (m, secs, paths, hz = 10) => {
    for (let i = 0; i < secs * hz; i++) {
      clock += 1000 / hz;
      const s = (clock - t0) / 1000, mine = paths.self ? paths.self(s) : { x: 900, y: 200, z: 12 };
      const g = (paths.group || []).map(([name, fn, cls]) => { const p = fn(s); return { name, x: p.x, y: p.y, z: 12, heading: 0, class: cls || 'bard' }; });
      win.pushPos({ character: 'Aldenmar', zone_id: null, at: clock, self: { x: mine.x, y: mine.y, z: mine.z, heading: paths.heading ?? 0 }, group: g, raid: [], target: null });
    }
  };
  const posts = () => calls.filter(c => /\/api\/kite-loop$/.test(c.url));
  return { S, all, win, canvas, calls, click, frame, texts, repaint, drive, posts, store: st };
}
// A clockwise circle on the Map (screen x = -x): the same path the coach's own tests walk.
const circle = ({ cx = 500, cy = -300, r = 60, lap = 12.4 } = {}) => (s) => { const th = 2 * Math.PI * s / lap; return { x: cx - r * Math.cos(th), y: cy - r * Math.sin(th) }; };
const still = (x, y) => () => ({ x, y });
// The arcs of radius r (units) the last frame drew round the server-frame point c ({ cx, cy } or { x, y }).
const ringOf = (m, r, c) => {
  const x = c.cx ?? c.x, y = c.cy ?? c.y, sc = m.S.view.scale;
  return m.frame().filter(s => s[0] === 'arc' && Math.abs(s[3] - r * sc) < 1e-6 && Math.abs(s[1] - ((-x - m.S.view.cx) * sc + m.S.w / 2)) < 1e-4 && Math.abs(s[2] - ((-y - m.S.view.cy) * sc + m.S.h / 2)) < 1e-4);
};
const dotted = (m) => m.frame().some(s => s[0] === 'setLineDash' && s[1].length === 2 && s[1][0] === 2 && s[1][1] === 4);
const label = (m) => m.texts().map(t => t.t).find(t => /^Brackwyn · (forming|circle)/.test(t));   // (not the plain name beside their dot)

describe('FB-103: a group member\'s circle shows while it forms', () => {
  it('yours is not involved: a member circles, and the Map draws THEIR circle, named, dotted', async () => {
    const m = await boot();
    m.S.follow = false; m.S.view.cx = -500; m.S.view.cy = 300;                // look at where they are circling
    m.drive(m, 0, {}); m.drive(m, 16, { group: [['Brackwyn', circle(), 'bard']] });          // a lap and a bit
    expect(m.S.kiteView, 'you are standing still: no circle of yours').toBeNull();
    expect(Object.keys(m.S.mates)).toEqual(['Brackwyn']);
    const v = m.S.mates.Brackwyn.view;
    expect(v, 'their coach engaged').not.toBeNull();
    near(v.cur.cx, 500, 3); near(v.cur.cy, -300, 3); near(v.cur.r, 60, 3);
    m.repaint();
    expect(ringOf(m, v.cur.r, v.cur).length).toBe(1);
    expect(dotted(m)).toBe(true);
    expect(label(m)).toMatch(/^Brackwyn · forming/);
  });
  it('says forming n/3 as the laps come in, then the finished circle with its size and lap time', async () => {
    const m = await boot();
    m.S.follow = false; m.S.view.cx = -500; m.S.view.cy = 300;
    const path = circle();
    const seen = [];
    for (let i = 0; i < 40; i++) { m.drive(m, 2, { group: [['Brackwyn', path, 'bard']] }); m.repaint(); const l = label(m); if (l && seen[seen.length - 1] !== l) seen.push(l); }   // 80 s: six laps, a look every 2 s
    expect(seen[0]).toMatch(/^Brackwyn · forming/);
    expect(seen.some(l => /forming [12]\/3/.test(l))).toBe(true);
    expect(seen[seen.length - 1]).toBe('Brackwyn · circle r 60 · 12 s');
    expect(seen.filter(l => /circle/.test(l))).toHaveLength(1);               // once formed it stays formed
  });
  it('posts nothing: a report is their own Map\'s to make, and nobody\'s circle leaves this machine from here', async () => {
    const m = await boot();
    m.drive(m, 80, { group: [['Brackwyn', circle(), 'bard']] });
    expect(KC.mateFormed(m.S.mates.Brackwyn.view)).toBe(true);                // it reached "three clean laps" ...
    expect(m.posts()).toHaveLength(0);                                        // ... and nothing went to the agent
    expect(m.calls.filter(c => c.opts && c.opts.method === 'POST')).toHaveLength(0);
  });
  it('goes quiet when they stop circling, and when they leave the group', async () => {
    const m = await boot();
    m.S.follow = false; m.S.view.cx = -500; m.S.view.cy = 300;
    m.drive(m, 20, { group: [['Brackwyn', circle(), 'bard']] }); m.repaint();
    const r = m.S.mates.Brackwyn.view.cur;
    expect(ringOf(m, r.r, r).length).toBe(1);
    clock += 7000; m.repaint();                                               // 7 s with no word from them (the limit is 6)
    expect(ringOf(m, r.r, r).length).toBe(0); expect(label(m)).toBeUndefined();
    const again = await boot();
    again.S.follow = false; again.S.view.cx = -500; again.S.view.cy = 300;
    again.drive(again, 20, { group: [['Brackwyn', circle(), 'bard']] });
    again.drive(again, 20, { group: [['Brackwyn', still(500 + 60, -300), 'bard']] });   // they stand still: the coach lets go
    again.repaint();
    expect(again.S.mates.Brackwyn.view).toBeNull(); expect(label(again)).toBeUndefined();
  });
  it('a member who is no longer in the group has no coach left behind (payload lists nobody)', async () => {
    const m = await boot({ group: [] });
    m.drive(m, 5, { group: [['Brackwyn', circle(), 'bard']] });
    expect(m.S.mates).toEqual({});                                            // the poll says nobody is in the group: they are not coached
  });
  it('a member who leaves the group takes their coach with them', async () => {
    const m = await boot();
    m.drive(m, 5, { group: [['Brackwyn', circle(), 'bard']] });
    expect(Object.keys(m.S.mates)).toEqual(['Brackwyn']);
    m.S.p.group = [];                                                         // the next poll says the group is empty
    m.drive(m, 1, { group: [['Brackwyn', circle(), 'bard']] });
    expect(m.S.mates).toEqual({});
  });
  it('a new zone starts every coach over', async () => {
    const m = await boot();
    m.drive(m, 20, { group: [['Brackwyn', circle(), 'bard']] });
    expect(m.S.mates.Brackwyn.view).not.toBeNull();
    const reset = /S\.kite\.reset\(\); S\.kiteView = null; S\.mates = \{\};/;
    expect(MAP_HTML).toMatch(reset);
  });
  it('with the Kite coach off, or Guild kite loops off, nobody is coached', async () => {
    const off = await boot({ store: { 'wp-map-cfg': JSON.stringify({ show: { kite: false } }) } });
    off.drive(off, 20, { group: [['Brackwyn', circle(), 'bard']] });
    expect(off.S.mates).toEqual({});
    const others = await boot({ store: { 'wp-map-cfg': JSON.stringify({ show: { kiteLoops: false } }) } });
    others.drive(others, 20, { group: [['Brackwyn', circle(), 'bard']] });
    expect(others.S.mates).toEqual({});
    const none = await boot({ withCoach: false });
    none.drive(none, 20, { group: [['Brackwyn', circle(), 'bard']] });
    expect(none.S.mates).toEqual({});
  });
  it('Others: Off hides it (and a flip back shows it again, still forming)', async () => {
    const m = await boot();
    m.S.follow = false; m.S.view.cx = -500; m.S.view.cy = 300;
    m.drive(m, 20, { group: [['Brackwyn', circle(), 'bard']] }); m.repaint();
    expect(label(m)).toMatch(/^Brackwyn · /);
    m.click('kiteOthersBtn');                                                 // Live -> All
    m.click('kiteOthersBtn');                                                 // All -> Off
    expect(m.S.cfg.show.kiteLoops).toBe(false);
    m.drive(m, 1, { group: [['Brackwyn', circle(), 'bard']] }); m.repaint();
    expect(label(m)).toBeUndefined(); expect(m.S.mates).toEqual({});
  });
  it('Circles: My speed and Near me apply to it, as to the guild\'s', async () => {
    const mine = circle({ cx: 900, cy: 200, r: 50, lap: 6.4 });               // you circle at 6.4 s a lap
    const theirs = circle({ cx: 500, cy: -300, r: 60, lap: 12.4 });           // they are slower, and 900 u away
    const m = await boot();
    m.S.follow = false; m.S.view.cx = -500; m.S.view.cy = 300; m.S.view.scale = 0.5;
    m.drive(m, 30, { self: mine, group: [['Brackwyn', theirs, 'bard']] }); m.repaint();
    expect(label(m)).toMatch(/^Brackwyn · /);                                    // All: drawn
    m.click('kiteFilterBtn'); m.repaint();                                    // My speed: 12.4 s is not within 25% of 6.4 s
    expect(m.S.cfg.kiteFilter).toBe('speed'); expect(label(m)).toBeUndefined();
    m.click('kiteFilterBtn'); m.repaint();                                    // Near me: 900 u is not within 300
    expect(m.S.cfg.kiteFilter).toBe('near'); expect(label(m)).toBeUndefined();
    const same = circle({ cx: 500, cy: -300, r: 60, lap: 6.5 });
    const n = await boot();
    n.S.follow = false; n.S.view.cx = -500; n.S.view.cy = 300; n.S.view.scale = 0.5;
    n.drive(n, 30, { self: mine, group: [['Brackwyn', same, 'bard']] }); n.click('kiteFilterBtn'); n.repaint();
    expect(n.S.cfg.kiteFilter).toBe('speed'); expect(label(n)).toMatch(/^Brackwyn · /);     // 6.5 s is within 25% of 6.4 s
  });
  it('the circle is where the turned map puts it in Heading up', async () => {
    const m = await boot({ store: { 'wp-map-cfg': JSON.stringify({ orient: 'heading' }) } });
    m.S.follow = false; m.S.view.cx = -430; m.S.view.cy = 270;               // (their circle is NOT the middle of the screen: a turn about the middle moves it)
    m.drive(m, 20, { heading: 128, group: [['Brackwyn', circle(), 'bard']] });   // you face west: the picture is turned a quarter
    m.repaint();
    const v = m.S.mates.Brackwyn.view.cur, rot = m.S.view.rot;
    near(Math.cos(rot), 0, 1e-6); near(Math.abs(Math.sin(rot)), 1, 1e-6);
    const sx = -v.cx, sy = -v.cy, dx = (sx - m.S.view.cx) * m.S.view.scale, dy = (sy - m.S.view.cy) * m.S.view.scale;
    const want = [dx * Math.cos(rot) - dy * Math.sin(rot) + m.S.w / 2, dx * Math.sin(rot) + dy * Math.cos(rot) + m.S.h / 2];
    const got = m.frame().filter(s => s[0] === 'arc' && Math.abs(s[3] - v.r * m.S.view.scale) < 1e-6);
    expect(got.some(a => Math.abs(a[1] - want[0]) < 1e-3 && Math.abs(a[2] - want[1]) < 1e-3)).toBe(true);
  });
});
