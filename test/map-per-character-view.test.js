// test/map-per-character-view.test.js — the Map remembers zoom and its settings per character; Pan / zoom mode starts off.
//
// FB-129 (a raider on Mimic 3.0.9): "Persistent Pan/zoom click when clicked on Map. Resets with every log in/out. Map settings
// can be saved and loaded when a character logs in." The Map kept ONE global set of keys in localStorage, and Pan / zoom mode was
// not kept at all, so a camp or a character change started from scratch. map.html now keeps "wp-map-char:<name>" and loads it when
// that character becomes the one the poll reports.
//
// Runs the real map.html script against a stub page (same harness shape as kite-coach.test.js).
// Run: npx vitest run test/map-per-character-view.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

async function boot(store = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, _tc: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; }, closest() { return null; },
      getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true }); },
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
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: Date.now(), local_only: false,
    points: [], map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 200 } },
    self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [], timers: [],
  };
  const fetchImpl = (u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/map-state/.test(u) ? payload : { ok: true }) });
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const win = { addEventListener() {}, devicePixelRatio: 1, mimic: { onMapPos: () => {} } };
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn { S, applyPayload };')(win, doc, { search: '' }, fetchImpl, ls, undefined, () => 1, () => {});
  await tick();
  const who = (name) => S.applyPayload(Object.assign({}, payload, { self: Object.assign({}, payload.self, { name }) }));
  const click = (id) => (all[id].listeners.click || []).forEach(f => f({}));
  const wheel = (dy) => (all.stage.listeners.wheel || []).forEach(f => f({ preventDefault() {}, deltaY: dy, clientX: 300, clientY: 200 }));
  return { S: S.S, store, who, click, wheel, all };
}

describe('Map view settings are per character (FB-129)', () => {
  it('the zoom a character set comes back when that character is the one shown; Pan / zoom mode starts off', async () => {
    const m = await boot();
    m.who('Aldenmar');
    m.click('panBtn');                       // Pan on
    m.wheel(-400);                           // zoom in
    const zoomed = m.S.view.scale;
    expect(m.S.panMode).toBe(true);
    m.who('Aldenmar');                       // next poll: the change is written under this character
    const saved = JSON.parse(m.store['wp-map-char:aldenmar']);
    expect(saved).toMatchObject({ scale: zoomed });
    expect(saved).not.toHaveProperty('pan');  // Pan is never saved (Decision Desk "map-pan-persist" A)

    // a fresh page (a relog restarts the Map's page state): its first poll names Aldenmar, and their zoom comes back
    const m2 = await boot(m.store);
    expect(m2.S.panMode).toBe(false);
    expect(m2.S.view.scale).toBeCloseTo(zoomed, 6);
  });

  it('a second character keeps their own zoom, and a switch of character turns Pan off', async () => {
    const m = await boot();
    m.who('Aldenmar'); m.wheel(-400); const a = m.S.view.scale; m.who('Aldenmar');
    m.who('Brackwyn'); m.wheel(800); const b = m.S.view.scale; m.click('panBtn'); m.who('Brackwyn');
    expect(a).not.toBeCloseTo(b, 6);
    expect(m.S.panMode).toBe(true);
    m.who('Aldenmar');
    expect(m.S.panMode).toBe(false);          // Pan left on by the other character does not follow
    expect(m.S.view.scale).toBeCloseTo(a, 6);
    m.who('Brackwyn');
    expect(m.S.view.scale).toBeCloseTo(b, 6);
  });

  it('an old save that carries pan:true does not turn Pan on', async () => {
    const m = await boot({ 'wp-map-char:aldenmar': '{"scale":1.5,"pan":true}' });
    m.who('Aldenmar');
    expect(m.S.panMode).toBe(false);
    expect(m.S.view.scale).toBeCloseTo(1.5, 6);
  });

  it('a junk save is ignored, not trusted', async () => {
    const m = await boot({ 'wp-map-char:aldenmar': '{"scale":"x","pan":"yes","fit":"moon","levels":99,"cfg":7}' });
    m.who('Aldenmar');
    expect(m.S.panMode).toBe(false);
    expect(m.S.fit).toBe('zone');
  });
});
