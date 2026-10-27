// test/_pop-overlay-harness.js — the PoP raids overlay (apps/mimic/popraid.html) booted on a small fake DOM, for the Flags
// mode's tests (test/pop-overlay-flags.test.js, test/pop-overlay-links.test.js). The same idea as bootPop in
// test/pop-overlay-quests.test.js: the page's REAL inline script runs, here against the REAL generated pop-quests.js and
// a stub agent whose /api/pop-status answers with whatever the test hands it.
//
// NOT a spec file (no `.test.`: vitest will not collect it).

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

export const MIMIC = path.join(ROOT, 'apps', 'mimic');
export const popHtml = readSource(path.join(MIMIC, 'popraid.html'));
export const REAL = (() => { const w = {}; vm.runInNewContext(fs.readFileSync(path.join(MIMIC, 'pop-quests.js'), 'utf8'), { window: w }); return w.POP_QUESTS; })();
export const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
export const inlineScript = (html) => { const o = html.indexOf('<script>'); return html.slice(o + 8, html.indexOf('</script>', o)); };
export const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script'));

export function fakeEl(id, { tag = 'div', classes = [], attrs = {}, parent = null, text = '' } = {}) {
  const cls = new Set(classes);
  const on = {};
  const el = {
    id, tag, parent, attrs, style: {}, value: '', textContent: text, _html: '', scrollTop: 0, disabled: false,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c),
      toggle: (c, force) => { const want = force === undefined ? !cls.has(c) : !!force; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    addEventListener(ev, fn) { (on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of on[ev] || []) fn(evt || {}); },
    getAttribute(a) { return a in attrs ? attrs[a] : null; },
    setAttribute(a, v) { attrs[a] = String(v); },
    removeAttribute(a) { delete attrs[a]; },
    hasAttribute(a) { return a in attrs; },
    focus() {}, scrollIntoView() {},
    // Enough of Element.closest for comma lists of `.class`, `#id`, `[attr]` and tag selectors.
    closest(sel) {
      const parts = sel.split(',').map(x => x.trim());
      const hit = (n, p) => (p[0] === '.' ? n.classList.contains(p.slice(1)) : p[0] === '#' ? n.id === p.slice(1)
        : p[0] === '[' ? n.hasAttribute(p.slice(1, -1)) : n.tag === p);
      for (let n = el; n; n = n.parent) if (parts.some(p => hit(n, p))) return n;
      return null;
    },
  };
  return el;
}

// A clickable thing as the page would have drawn it: the element a click's `target` is.
export function target(tag, { classes = [], attrs = {}, parent = null, id = '' } = {}) {
  return fakeEl(id, { tag, classes, attrs, parent });
}

const RAIDS = {
  imageBase: 'https://img.invalid/', quarmGlobalNotes: [],
  sections: [{ id: 'tac', title: 'Tier 3', encounters: [{ id: 'rz', name: 'Rallos Zek', zone: 'Plane of Testing', tracker: [{ id: 'tank', label: 'Corner tank set' }] }] }],
};

// `status` = what GET /api/pop-status answers (a body, a function returning one, or null = the agent does not answer).
export function bootPop({ quests = REAL, status = null, store = {}, mini = false, rescan = null } = {}) {
  const ids = [...markupOf(popHtml).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const fixed = Object.fromEntries(ids.map(id => [id, fakeEl(id)]));
  // Elements the page writes into #content (the age span, the Capture button and its note) exist only while the markup
  // that holds them does: one stand-in per id, dropped when the card is rewritten.
  const dyn = new Map();
  const byId = new Proxy(fixed, { get(t, id) {
    if (typeof id !== 'string') return t[id];
    if (t[id]) return t[id];
    if (!t.content || !t.content.innerHTML.includes('id="' + id + '"')) return undefined;
    if (!dyn.has(id)) dyn.set(id, fakeEl(id));
    return dyn.get(id);
  } });
  { const d = Object.getOwnPropertyDescriptor(fixed.content, 'innerHTML');
    Object.defineProperty(fixed.content, 'innerHTML', { get: d.get, set(v) { dyn.clear(); d.set.call(this, v); }, configurable: true }); }
  const body = fakeEl('body', { tag: 'body' });
  if (mini) body.classList.add('wp-mini');
  const dom = { on: {}, body, documentElement: { style: { setProperty() {} } },
    addEventListener(ev, fn) { (dom.on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of dom.on[ev] || []) fn(evt); },
    getElementById: (id) => byId[id] || null };
  const rec = { fetches: [], posts: [], copied: [], hover: [], timers: [], fits: [], heights: [], rings: [] };
  Object.defineProperty(byId.wrap, 'scrollHeight', { get: () => 200 + byId.content.innerHTML.length });

  // content.querySelector(All): the two lookups popRing makes, read off the markup the page wrote.
  const ringable = (label) => {
    const c = new Set();
    return { classList: { add: (x) => { c.add(x); rec.rings.push({ label, add: x }); }, remove: (x) => { c.delete(x); }, contains: (x) => c.has(x) }, scrollIntoView() {} };
  };
  byId.content.querySelector = (sel) => {
    const m = sel.match(/^\[data-step="([^"]+)"\]$/);
    if (!m) return null;
    return byId.content.innerHTML.includes('data-step="' + m[1] + '"') ? ringable('step:' + m[1]) : null;
  };
  byId.content.querySelectorAll = (sel) => {
    if (sel !== '.qcopy.say') return [];
    const html = byId.content.innerHTML;
    const out = [];
    for (const m of html.matchAll(/<span class="qcopy say"[^>]*data-copy="([^"]*)"/g)) {
      const copy = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      const before = html.slice(0, m.index);
      const inRow = before.lastIndexOf('<li class="qs') > before.lastIndexOf('</li>');
      out.push({ getAttribute: (a) => (a === 'data-copy' ? copy : null), closest: () => (inRow ? ringable('row:' + copy) : null) });
    }
    return out;
  };

  const wOn = {};
  const window = {
    mimic: { autoFitOverlay: (el) => rec.fits.push(el.scrollHeight), overlayAutoHeight: (h) => rec.heights.push(h),
      overlayHoverInteractive: (v) => rec.hover.push(v), openExternal() {} },
    POP_RAIDS: RAIDS, POP_QUESTS: quests,
    addEventListener(ev, fn) { (wOn[ev] ||= []).push(fn); }, fire(ev) { for (const fn of wOn[ev] || []) fn({ type: ev }); },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const navigator = { clipboard: { writeText: (t) => { rec.copied.push(t); return Promise.resolve(); } } };
  const fetchImpl = async (url, opts) => {
    rec.fetches.push(url);
    if (opts && opts.method === 'POST') rec.posts.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('/api/pop-status')) {
      const b = typeof status === 'function' ? status(url) : status;
      if (b == null) throw new Error('agent offline');
      return { ok: true, status: 200, json: async () => b };
    }
    if (url.includes('/api/local/pop-rescan/status')) return { ok: true, status: 200, json: async () => (rescan && rescan.status ? rescan.status : { running: false, run: null }) };
    if (url.includes('/api/local/pop-rescan')) { const r = rescan && rescan.start ? rescan.start : { status: 202, body: { ok: true, started: true } }; return { ok: r.status < 300, status: r.status, json: async () => r.body }; }
    return { ok: true, status: 200, json: async () => ({ rev: 1, encounters: {} }) };
  };
  const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout', 'navigator',
    inlineScript(popHtml) + '\nreturn { pollFlags, popGoto };');
  const api = run(window, dom, fetchImpl, localStorage, () => 0, (fn, ms) => { rec.timers.push({ fn, ms }); return 0; }, navigator);
  const click = (el) => byId.content.fire('click', { target: el });
  // A blue → button as the page rendered it, found in the card by its data-go.
  const goButton = (go) => {
    const esc = go.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const found = byId.content.innerHTML.includes('data-go="' + esc + '"');
    // A button the card does not have is a test that clicked nothing: say so rather than pass.
    if (!found) throw new Error('the card has no button with data-go="' + go + '"');
    return target('button', { classes: ['fgo'], attrs: { 'data-go': go } });
  };
  return { api, dom, byId, body, window, rec, store, content: () => byId.content.innerHTML, click, goButton, flush,
    setMini: async (on) => { body.classList.toggle('wp-mini', on); window.fire('wp-mini-change'); await flush(); } };
}
