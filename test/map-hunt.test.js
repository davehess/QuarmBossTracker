// test/map-hunt.test.js — the Map's "Targeted named mobs" filter (the guild lead, 2026-11-13: "a filter mode on the maps to highlight
// specific named mobs that you've targetted OR their spawn points, make both options available").
//
// apps/mimic/map.html keeps a per-character, per-zone list of the named mobs the player has targeted ("wp-map-hunt:<name>" in
// localStorage), and cfg.huntMode ('off' | 'spawns' | 'mobs') highlights them. Three layers here:
//   - the pure helpers, sliced out of the page's "pure helpers" block and run as written;
//   - the whole page booted against a stub DOM with a fake localStorage and a driven applyPayload (the
//     map-per-character-view.test.js pattern), for persistence and the side-panel controls;
//   - comment-stripped call-site assertions for the draw loop (the canvas is a stub, so the dimming itself is read off a
//     recording context, and the call sites are checked as text).
//
// Run: npx vitest run test/map-hunt.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H = new Function(helpers + '\nreturn { npcKey, mergeMapCfg, mapCfgDefaults, huntMode, huntTargetNpc, huntNamedMatch, huntListAdd, huntListRemove, huntListToggle, huntStoreSet, huntStoreClean, huntPointIds, huntKeyPoints, huntLivePos, HUNT_MOB_CAP, HUNT_ZONE_CAP, HUNT_LIVE_MS };')();

const POINTS = [
  { id: 1, x: 10, y: 10, z: 0, npcs: [{ name: 'Gorvane_the_Hollow', named: true }, { name: 'a_cave_bat', named: false }] },
  { id: 2, x: 200, y: 10, z: 0, npcs: [{ name: '#Thrask', raid_target: true }] },
  { id: 3, x: 10, y: 200, z: 0, npcs: [{ name: 'a_cave_bat', named: false }] },
  { id: 4, x: 200, y: 200, z: 0, npcs: [{ name: 'Gorvane_the_Hollow02', named: true }] },   // a second spot of the same named
];

describe('pure helpers', () => {
  it('a flagged named or raid-target mob matches (spawn-row display name, the npcKey key); trash and unknown names do not', () => {
    expect(H.huntNamedMatch('Gorvane the Hollow', POINTS)).toEqual({ k: 'gorvane the hollow', n: 'Gorvane the Hollow' });
    expect(H.huntNamedMatch('Thrask', POINTS)).toEqual({ k: 'thrask', n: 'Thrask' });
    expect(H.huntNamedMatch('a cave bat', POINTS)).toBeNull();       // in the zone's data, but not flagged
    expect(H.huntNamedMatch('Somebody Else', POINTS)).toBeNull();
    expect(H.huntNamedMatch('', POINTS)).toBeNull();
    expect(H.huntNamedMatch('Thrask', [])).toBeNull();
  });

  it('only an NPC target is recorded: not a player, a corpse, or your own pet', () => {
    const npc = { name: 'Thrask', id: 7, type: 1 };
    expect(H.huntTargetNpc(npc, null)).toBe(true);
    expect(H.huntTargetNpc({ name: 'Thrask', id: 7 }, null)).toBe(true);                 // no type reported: read as an NPC, as elsewhere in the file
    expect(H.huntTargetNpc({ name: 'Thrask', id: 7, type: 0 }, null)).toBe(false);       // player
    expect(H.huntTargetNpc({ name: 'Thrask', id: 7, type: 2 }, null)).toBe(false);       // corpse
    expect(H.huntTargetNpc({ name: 'Thrask', id: 7, type: 3 }, null)).toBe(false);       // corpse
    expect(H.huntTargetNpc({ name: "Thrask's corpse", id: 7, type: 1 }, null)).toBe(false);   // a corpse by name
    expect(H.huntTargetNpc(npc, { id: 7, name: 'x' })).toBe(false);                      // your pet, by id
    expect(H.huntTargetNpc(npc, { name: 'Thrask' })).toBe(false);                        // your pet, by name
    expect(H.huntTargetNpc(null, null)).toBe(false);
  });

  it('the list holds at most `cap` mobs (corpus larger than the cap), newest first', () => {
    let list = [];
    for (let i = 0; i < 80; i++) list = H.huntListAdd(list, { k: 'mob' + i, n: 'Mob ' + i, at: i }, 60);
    expect(list).toHaveLength(60);
    expect(list[0].k).toBe('mob79');
    expect(list[59].k).toBe('mob20');
  });

  it('re-targeting moves a mob to the front with a fresh time, and keeps its own on/off', () => {
    let list = [];
    ['a', 'b', 'c'].forEach((k, i) => { list = H.huntListAdd(list, { k, n: k.toUpperCase(), at: i + 1 }, 60); });
    list = H.huntListToggle(list, 'a');                 // a: off
    list = H.huntListAdd(list, { k: 'a', n: 'A', at: 99 }, 60);
    expect(list.map(e => e.k)).toEqual(['a', 'c', 'b']);
    expect(list[0].at).toBe(99);
    expect(list[0].on).toBe(false);
    expect(H.huntListRemove(list, 'c').map(e => e.k)).toEqual(['a', 'b']);
  });

  it('a zone count over the cap drops the zone whose newest entry is oldest, never the one just written', () => {
    let store = {};
    for (let i = 0; i < 75; i++) store = H.huntStoreSet(store, 'zone' + i, [{ k: 'm', n: 'M', at: 1000 + i, on: true }], 60);
    expect(Object.keys(store)).toHaveLength(60);
    expect(store.zone74).toBeTruthy();
    expect(store.zone14).toBeUndefined();
    expect(store.zone15).toBeTruthy();
    // a write whose own time is the oldest still stays
    store = H.huntStoreSet(store, 'old', [{ k: 'm', n: 'M', at: 1, on: true }], 60);
    expect(store.old).toBeTruthy();
    expect(Object.keys(store)).toHaveLength(60);
    // an empty list removes the zone
    expect(H.huntStoreSet(store, 'old', [], 60).old).toBeUndefined();
  });

  it('a corrupt or foreign-shaped store loads empty (or clean), never throws', () => {
    for (const raw of [null, undefined, 7, 'str', [], [1, 2], true, { z: 'x' }, { z: [null, 4, 'q', {}] }, { z: [{ k: 5 }] }, { __proto__: 1 }]) {
      expect(() => H.huntStoreClean(raw), String(raw)).not.toThrow();
      expect(H.huntStoreClean(raw), String(raw)).toEqual({});
    }
    const mixed = H.huntStoreClean(JSON.parse('{"__proto__":[{"k":"x"}],"zone":[{"k":"a","n":"A","at":5,"on":false},{"k":"a"},{"junk":1},{"k":"b","at":"nope"}]}'));
    expect(Object.keys(mixed)).toEqual(['zone']);
    expect(mixed.zone).toEqual([{ k: 'a', n: 'A', at: 5, on: false }, { k: 'b', n: 'b', at: 0, on: true }]);
    expect(Object.prototype.k).toBeUndefined();
  });

  it('a stored list over the caps is cut when loaded', () => {
    const big = {};
    for (let i = 0; i < 70; i++) big['z' + i] = [{ k: 'm', n: 'M', at: i }];
    expect(Object.keys(H.huntStoreClean(big))).toHaveLength(60);
    const long = { z: Array.from({ length: 90 }, (_, i) => ({ k: 'm' + i, n: 'M', at: 90 - i })) };
    expect(H.huntStoreClean(long).z).toHaveLength(60);
  });
});

describe('mergeMapCfg huntMode', () => {
  it('defaults to off, keeps the three valid values, rejects junk', () => {
    expect(H.mapCfgDefaults().huntMode).toBe('off');
    expect(H.mergeMapCfg(null).huntMode).toBe('off');
    expect(H.mergeMapCfg({}).huntMode).toBe('off');
    expect(H.mergeMapCfg({ huntMode: 'spawns' }).huntMode).toBe('spawns');
    expect(H.mergeMapCfg({ huntMode: 'mobs' }).huntMode).toBe('mobs');
    expect(H.mergeMapCfg({ huntMode: 'off' }).huntMode).toBe('off');
    for (const junk of ['SPAWNS', 'all', '', 1, true, null, {}, []]) expect(H.mergeMapCfg({ huntMode: junk }).huntMode, String(junk)).toBe('off');
  });
});

describe('huntPointIds', () => {
  const list = (...ks) => ks.map(([k, on]) => ({ k, n: k, at: 1, on }));
  it('is exactly the points whose spawn list holds an ENABLED listed mob', () => {
    expect(H.huntPointIds(POINTS, list(['gorvane the hollow', true]))).toEqual({ 1: true, 4: true });
    expect(H.huntPointIds(POINTS, list(['gorvane the hollow', true], ['thrask', true]))).toEqual({ 1: true, 2: true, 4: true });
    expect(H.huntPointIds(POINTS, list(['gorvane the hollow', false], ['thrask', true]))).toEqual({ 2: true });   // off: not highlighted
    expect(H.huntPointIds(POINTS, list(['gorvane the hollow', false]))).toEqual({});
    expect(H.huntPointIds(POINTS, [])).toEqual({});
    expect(H.huntPointIds(POINTS, list(['a cave bat', true]))).toEqual({ 1: true, 3: true });   // a manual add of an unflagged mob works the same
  });
  it('huntKeyPoints lists each enabled mob\'s own points (empty for one with none here)', () => {
    expect(H.huntKeyPoints(POINTS, list(['gorvane the hollow', true], ['nobody', true], ['thrask', false]))).toEqual({ 'gorvane the hollow': ['1', '4'], nobody: [] });
  });
});

describe('huntLivePos: where a listed mob is really known to be', () => {
  const L = [{ k: 'thrask', n: 'Thrask', at: 1, on: true }];
  it('your own target, when it is on the list and has a position', () => {
    const P = { target: { name: 'Thrask', id: 7, type: 1, x: 5, y: 6, z: 1, hp_pct: 80 } };
    expect(H.huntLivePos(L, P, {}, {}, 1000, 1000)).toEqual({ thrask: { x: 5, y: 6, z: 1, age: 0, target: true } });
    expect(H.huntLivePos(L, { target: { name: 'Thrask', type: 1, hp_pct: 80 } }, {}, {}, 1000, 1000)).toEqual({});             // no position
    expect(H.huntLivePos(L, { target: { name: 'Thrask', type: 1, x: 1, y: 1, hp_pct: 0 } }, {}, {}, 1000, 1000)).toEqual({});   // dead
    expect(H.huntLivePos(L, { target: { name: 'Thrask', type: 0, x: 1, y: 1 } }, {}, {}, 1000, 1000)).toEqual({});             // a player of that name
    expect(H.huntLivePos([{ k: 'thrask', n: 'T', at: 1, on: false }], P, {}, {}, 1000, 1000)).toEqual({});                     // switched off
  });
  it('a seen row\'s position, or its trail, inside the window; nothing older, nothing invented', () => {
    const seen = { 2: { name: 'Thrask', spawn_id: 9, hp_pct: 70, pos: { x: 20, y: 30, at: 100000 } } };
    expect(H.huntLivePos(L, null, seen, {}, 130000, 0).thrask).toMatchObject({ x: 20, y: 30, age: 30000, target: false });
    expect(H.huntLivePos(L, null, seen, {}, 100000 + H.HUNT_LIVE_MS + 1, 0)).toEqual({});               // too old
    expect(H.huntLivePos(L, null, { 2: { name: 'Thrask', spawn_id: 9 } }, {}, 130000, 0)).toEqual({});   // seen, but no position
    expect(H.huntLivePos(L, null, { 2: { name: 'Thrask', hp_pct: 0, pos: { x: 1, y: 1, at: 100000 } } }, {}, 100001, 0)).toEqual({});   // dead
    const trails = { 't:9': { dead: null, pts: [{ x: 1, y: 2, t: 9000 }, { x: 3, y: 4, t: 10000 }] } };
    expect(H.huntLivePos(L, null, seen, trails, 130000, 12000).thrask).toMatchObject({ x: 3, y: 4, age: 2000 });   // the fresher source wins
    const deadTrail = { 't:9': { dead: 1, pts: [{ x: 3, y: 4, t: 10000 }] } };
    expect(H.huntLivePos(L, null, { 2: { name: 'Thrask', spawn_id: 9 } }, deadTrail, 130000, 12000)).toEqual({});
  });
});

// ── the whole page ───────────────────────────────────────────────────────────────────────────────────────────────
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

async function boot(store = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  const arcs = [];   // [alpha, radius] for every arc the canvas was asked for
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '', value: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      insertBefore(ch) { this.children.unshift(ch); return ch; },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
      getContext() {
        const props = {};
        return new Proxy({}, {
          get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : k in props ? props[k] : (k === 'arc' ? (x, y, r) => arcs.push([props.globalAlpha, r]) : () => {})),
          set: (_t, k, v) => { props[k] = v; return true; },
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
    addEventListener() {}, hidden: false, body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const base = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: Date.now(), local_only: false,
    points: POINTS, map: { bands: [0], segs: [[0, 0, 300, 0, 0]], bounds: { minX: 0, maxX: 300, minY: 0, maxY: 300 } },
    self: { x: 100, y: 100, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [], timers: [],
  };
  const fetchImpl = (u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/map-state/.test(u) ? base : { ok: true }) });
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const win = { addEventListener() {}, devicePixelRatio: 1, mimic: { onMapPos: () => {} } };
  // eslint-disable-next-line no-new-func
  const page = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn { S, applyPayload, renderSide, renderMap };')(win, doc, { search: '' }, fetchImpl, ls, undefined, () => 1, () => {});
  await tick();
  const poll = (over = {}) => page.applyPayload(Object.assign({}, base, { now: Date.now() }, over));
  const as = (name, over = {}) => poll(Object.assign({ self: Object.assign({}, base.self, { name }) }, over));
  const tgt = (name, extra = {}) => ({ name, id: 55, type: 1, x: 120, y: 120, z: 0, hp_pct: 100, ...extra });
  // the side panel's rows and buttons, found by their words
  const rows = () => (all.lists.children || []).filter(c => /trow hunt/.test(c.className));
  const header = () => (all.lists.children || []).find(c => /sec hunt/.test(c.className));
  const buttons = (node) => { const out = []; const walk = (n) => { (n.children || []).forEach(c => { if (c.tag === 'button') out.push(c); walk(c); }); }; walk(node); return out; };
  const press = (btn) => (btn.listeners.click || []).forEach(f => f({ stopPropagation() {}, preventDefault() {} }));
  const stored = (name = 'aldenmar') => JSON.parse(store['wp-map-hunt:' + name] || 'null');
  return { S: page.S, store, poll, as, tgt, rows, header, buttons, press, stored, all, arcs, page };
}

describe('the list is recorded and kept', () => {
  it('targeting a flagged named mob records it (display name from the spawn row); trash, a player, a corpse and a pet do not', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('a cave bat') });
    m.as('Aldenmar', { target: m.tgt('Gorvane the Hollow', { type: 0 }) });
    m.as('Aldenmar', { target: m.tgt("Gorvane the Hollow's corpse", { type: 2 }) });
    m.as('Aldenmar', { target: m.tgt('Gorvane the Hollow'), pet: { id: 55, name: 'Gorvane the Hollow' } });
    expect(m.stored()).toBeNull();
    expect('wp-map-hunt:aldenmar' in m.store).toBe(false);
    m.as('Aldenmar', { target: m.tgt('Gorvane_the_Hollow02') });
    expect(m.stored()).toEqual({ thedeep: [{ k: 'gorvane the hollow', n: 'Gorvane the Hollow', at: expect.any(Number), on: true }] });
  });

  it('nothing is recorded before the character is known', async () => {
    const m = await boot();
    m.poll({ self: null, target: m.tgt('Thrask') });
    expect(Object.keys(m.store).filter(k => k.startsWith('wp-map-hunt'))).toEqual([]);
    m.poll({ self: { x: 1, y: 1, z: 0, heading: 0 }, target: m.tgt('Thrask') });   // a self with no name
    expect(Object.keys(m.store).filter(k => k.startsWith('wp-map-hunt'))).toEqual([]);
  });

  it('survives a reload: a fresh page on the same storage has the list; holding a target does not rewrite it', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    const first = m.store['wp-map-hunt:aldenmar'];
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    expect(m.store['wp-map-hunt:aldenmar']).toBe(first);            // the same target held: not a new sighting, not a write
    const m2 = await boot(m.store);
    m2.as('Aldenmar');                                              // no target at all this time
    expect(m2.S.hunt.store.thedeep.map(e => e.n)).toEqual(['Thrask']);
    expect(m2.stored().thedeep).toHaveLength(1);
  });

  it('re-targeting after tabbing off moves the mob to the front', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask', { id: 1 }) });
    m.as('Aldenmar', { target: m.tgt('Gorvane the Hollow', { id: 2 }) });
    expect(m.stored().thedeep.map(e => e.n)).toEqual(['Gorvane the Hollow', 'Thrask']);
    m.as('Aldenmar', { target: m.tgt('Thrask', { id: 1 }) });
    expect(m.stored().thedeep.map(e => e.n)).toEqual(['Thrask', 'Gorvane the Hollow']);
  });

  it('a second character has their own list, and a different zone has its own', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.as('Brackwyn');
    expect(m.S.hunt.store).toEqual({});
    m.as('Brackwyn', { target: m.tgt('Gorvane the Hollow') });
    expect(m.stored('brackwyn').thedeep.map(e => e.n)).toEqual(['Gorvane the Hollow']);
    expect(m.stored('aldenmar').thedeep.map(e => e.n)).toEqual(['Thrask']);
    // another zone: same character, separate list (the mob must be flagged in THAT zone's points)
    m.as('Aldenmar', { zone: 'cazic', points: [{ id: 9, x: 1, y: 1, z: 0, npcs: [{ name: 'Thrask', named: true }] }], target: m.tgt('Thrask') });
    expect(Object.keys(m.stored('aldenmar')).sort()).toEqual(['cazic', 'thedeep']);
    // back in the first zone the other zone's list is not shown
    m.as('Aldenmar', { target: null });
    expect(m.page.S.hunt.store.thedeep).toHaveLength(1);
  });

  it('a corrupt stored value loads as empty and the Map still runs', async () => {
    const m = await boot({ 'wp-map-hunt:aldenmar': '{"thedeep": 12, ' });
    expect(() => m.as('Aldenmar', { target: m.tgt('Thrask') })).not.toThrow();
    expect(m.stored().thedeep.map(e => e.n)).toEqual(['Thrask']);
    const m2 = await boot({ 'wp-map-hunt:aldenmar': '[1,2,3]' });
    m2.as('Aldenmar');
    expect(m2.S.hunt.store).toEqual({});
  });

  it('is not inside the settings object or the per-character view snapshot', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    expect(JSON.stringify(m.S.cfg)).not.toMatch(/thrask/i);
    expect(m.store['wp-map-char:aldenmar'] || '').not.toMatch(/thrask/i);
  });
});

describe('the side panel section', () => {
  it('lists the zone\'s mobs; the toggle, remove and clear write through; clear needs a second click', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask', { id: 1 }) });
    m.as('Aldenmar', { target: m.tgt('Gorvane the Hollow', { id: 2 }) });
    m.as('Aldenmar', { target: null });
    m.page.renderSide();
    expect(m.header().children[0].textContent).toBe('Targeted named (2)');
    expect(m.rows().map(r => r.children[0].textContent)).toEqual(['Gorvane the Hollow', 'Thrask']);

    // toggle
    let btns = m.buttons(m.rows()[0]);
    expect(btns.map(b => b.textContent)).toEqual(['on', '✕']);
    m.press(btns[0]);
    expect(m.stored().thedeep[0]).toMatchObject({ n: 'Gorvane the Hollow', on: false });
    expect(m.rows()[0].className).toMatch(/off/);
    m.press(m.buttons(m.rows()[0])[0]);
    expect(m.stored().thedeep[0].on).toBe(true);

    // remove
    m.press(m.buttons(m.rows()[1])[1]);
    expect(m.stored().thedeep.map(e => e.n)).toEqual(['Gorvane the Hollow']);

    // clear: the first click only asks
    let clr = m.buttons(m.header()).find(b => /clear|sure/.test(b.textContent));
    m.press(clr);
    expect(m.stored().thedeep).toHaveLength(1);
    clr = m.buttons(m.header()).find(b => /clear|sure/.test(b.textContent));
    expect(clr.textContent).toBe('sure?');
    m.press(clr);
    expect(m.stored()).toEqual({});                         // the zone is gone, not left as an empty list
    expect(m.rows()).toHaveLength(0);
  });

  it('"clear" only empties the current zone', async () => {
    const m = await boot();
    m.as('Aldenmar', { zone: 'cazic', points: [{ id: 9, x: 1, y: 1, z: 0, npcs: [{ name: 'Thrask', named: true }] }], target: m.tgt('Thrask') });
    m.as('Aldenmar', { zone: 'thedeep', points: POINTS, target: m.tgt('Thrask', { id: 3 }) });
    m.page.renderSide();
    const clr = () => m.buttons(m.header()).find(b => /clear|sure/.test(b.textContent));
    m.press(clr()); m.press(clr());
    expect(Object.keys(m.stored())).toEqual(['cazic']);
  });

  it('"+ target" adds any NPC target (flagged or not), refuses a player or no target, and keeps the list capped', async () => {
    const m = await boot();
    m.as('Aldenmar');
    m.page.renderSide();
    const add = () => m.buttons(m.header()).find(b => /target/.test(b.textContent));
    m.S.cfg.huntMode = 'spawns';                            // the section shows for an empty list when the filter is on
    m.page.renderSide();
    expect(add().className).toMatch(/dis/);                 // no target: disabled-looking
    expect(add().title).toMatch(/Target an NPC/);
    m.press(add());
    expect(m.stored()).toBeNull();
    m.as('Aldenmar', { target: m.tgt('a cave bat', { id: 4 }) });   // not flagged: only the manual control takes it
    expect(m.stored()).toBeNull();
    m.page.renderSide();
    expect(add().className).not.toMatch(/dis/);
    m.press(add());
    expect(m.stored().thedeep.map(e => [e.k, e.n])).toEqual([['a cave bat', 'a cave bat']]);
    m.as('Aldenmar', { target: m.tgt('Aldenmar', { id: 5, type: 0 }) });
    m.press(add());
    expect(m.stored().thedeep).toHaveLength(1);
    // the cap holds through the manual path too
    for (let i = 0; i < 70; i++) { m.as('Aldenmar', { target: m.tgt('mob ' + 'x'.repeat(i + 1), { id: 100 + i }) }); m.press(add()); }
    expect(m.stored().thedeep).toHaveLength(60);
  });

  it('the section is hidden with an empty list and the filter off; the note names the character', async () => {
    const m = await boot();
    m.as('Aldenmar');
    m.page.renderSide();
    expect(m.header()).toBeUndefined();
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.page.renderSide();
    expect(m.header()).toBeTruthy();
    expect(m.all.lists.children.some(c => c.textContent === 'Saved on this computer for Aldenmar.')).toBe(true);
  });

  it('every control is a real button carrying the hover handshake attribute', async () => {
    const m = await boot();
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.page.renderSide();
    const all = [...m.buttons(m.header()), ...m.buttons(m.rows()[0])];
    expect(all.length).toBeGreaterThanOrEqual(4);
    all.forEach(b => { expect(b.tag).toBe('button'); expect(b.attrs).toHaveProperty('data-wp-interact'); expect(b.type).toBe('button'); });
    expect(m.rows()[0].attrs).toHaveProperty('data-wp-interact');   // the clickable row itself
  });
});

describe('the draw loop', () => {
  const CODE = stripJs(MAP_HTML);
  const inner = sliceBlock(CODE, 'function renderMapInner(animating) {', 'drawPulse(vis, rt, ringOf, I);');

  it('dims every spawn dot that is not hunted, by the hunted-id set', () => {
    expect(inner).toMatch(/hids = hmode !== 'off' && S\.hunt\.n \? S\.hunt\.ids : null/);
    expect(inner).toMatch(/if \(hids && !hids\[String\(p\.id\)\]\) ctx\.globalAlpha \*= HUNT_DIM;/);
  });
  it('lets a hunted spot past the Spawn height range, as a pulsed one is', () => {
    expect(inner).toMatch(/if \(hids && hids\[String\(p0\.id\)\]\) \{ vis\.push\(\{ p: p0, x: xy0\[0\], y: xy0\[1\] \}\); continue; \}/);
  });
  it('draws the hunt pass once per frame from the precomputed set, before the pulse', () => {
    expect(inner).toMatch(/if \(hmode !== 'off' && S\.hunt\.en\) drawHunt\(vis, hmode, hids \|\| \{\}/);
    // the set itself is computed in huntRecompute (per poll / on a change), not in the frame
    expect(inner).not.toMatch(/huntPointIds|huntKeyPoints/);
    expect(CODE).toMatch(/function huntRecompute\(\) \{[\s\S]{0,400}huntPointIds\(S\.points, list\)/);
  });
  it('adds no colour literal of its own: the ring takes the target purple, the fallback a scheme slot', () => {
    const fn = sliceBlock(CODE, 'function drawHunt(', 'ctx.globalAlpha = 1;\n  }\n');
    expect(fn).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(fn).toMatch(/AGGRO_TARGET_COL \|\| C\.col\.target/);
  });

  it('really dims: with the filter on, a non-hunted dot is drawn at 35% and the hunted one at full strength; off, nothing dims', async () => {
    const m = await boot();
    m.S.w = 600; m.S.h = 400;
    m.as('Aldenmar', { target: m.tgt('Thrask') });
    m.as('Aldenmar');
    const alphas = () => { m.arcs.length = 0; m.page.renderMap(); return new Set(m.arcs.map(a => a[0])); };
    expect(alphas().has(0.35)).toBe(false);                // off by default
    m.S.cfg.huntMode = 'spawns'; m.as('Aldenmar');
    const on = alphas();
    expect(on.has(0.35)).toBe(true);
    expect(on.has(1)).toBe(true);
    m.S.cfg.huntMode = 'off'; m.as('Aldenmar');
    expect(alphas().has(0.35)).toBe(false);
  });
});
