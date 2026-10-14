// test/timer-dismiss.test.js — the ✕ on a timer row dismisses it, every kind of row, for good.
//
// The guild lead, 2026-10-06 and again 2026-10-14: "These timers aren't able to be clicked off" — a screenshot of
// the timers overlay with the cursor on a ✕, over a server tick, two spell recasts and two zone-timer countdowns.
// The 2026-10-06 round only added data-wp-interact to the ✕; it still failed. What this pins:
//   1. The press (mousedown) dismisses, through ONE listener on the stable #timers parent that reads the row's
//      data-timer-id at that moment. A listener on each ✕, closing over the first render's id and waiting for a
//      click (down AND up on the same node), could lose the click to a repaint between the two.
//   2. A row dismissed stays gone through a poll that was already in flight, and a retry covers a lost POST.
//   3. The server tick (one fixed id, rebuilt every snapshot) is hidden for as long as the overlay lives, in the
//      overlay, and the agent never keeps that hide.
//   4. The agent accepts a cancel for every row kind and the next snapshot does not bring it back.
//   5. A zone timer the bot hands out again on re-entry stays dismissed (the "stampede window" came back).
// The overlay half runs the REAL renderTimers / dismissTimer / delegated handlers over a small fake DOM; the
// agent half runs the REAL _handleTimerCancel / _activeTimersSnapshot / _runLateJoinFire.
//
// Run: npx vitest run test/timer-dismiss.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const mainSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const agentSrc = readSource(AGENT_INDEX);

// ── a very small DOM: only what the timer stack touches ─────────────────────────────────────────────────────────
function matcher(sel) {
  // '.a.b' and '.a:not(.b)' — the only selector shapes the stack uses.
  const [pos, ...nots] = sel.split(':not(');
  const want = pos.split('.').filter(Boolean);
  const not = nots.map(n => n.replace(')', '').replace('.', ''));
  return (el) => el.nodeType === 1 && want.every(c => el.classList.contains(c)) && not.every(c => !el.classList.contains(c));
}
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attrs = {}; this.listeners = {}; this._cls = []; this._text = '';
    this.style = { setProperty() {}, transform: '' };
    const self = this;
    this.classList = {
      add: (c) => { if (!self._cls.includes(c)) self._cls.push(c); },
      remove: (c) => { self._cls = self._cls.filter(x => x !== c); },
      contains: (c) => self._cls.includes(c),
      toggle: (c, on) => { (on === undefined ? !self._cls.includes(c) : on) ? self.classList.add(c) : self.classList.remove(c); },
    };
  }
  get className() { return this._cls.join(' '); }
  set className(v) { this._cls = String(v).split(/\s+/).filter(Boolean); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  set innerHTML(html) {
    this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = '';
    const stack = [this];
    for (const m of String(html).matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) { top._text += m[4]; continue; }
      if (m[1]) { stack.pop(); continue; }
      const el = new El(m[2]);
      const cls = /class="([^"]*)"/.exec(m[3]);
      if (cls) el.className = cls[1];
      el.parentNode = top; top.children.push(el);
      if (!/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n.parentNode) n.remove();
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(n); else this.children.splice(at, 0, n);
    n.parentNode = this;
    return n;
  }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; } }
  contains(n) { for (let e = n; e; e = e.parentNode) if (e === this) return true; return false; }
  querySelector(sel) {
    const m = matcher(sel);
    for (const c of this.children) { if (m(c)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  closest(sel) { const m = matcher(sel); for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (m(e)) return e; return null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
}
// An event as the browser delivers it: to the target, then up through its parents. A detached node has no path to
// #timers, so a press on a ✕ the repaint already threw away reaches nothing, as in the real thing.
function dispatch(type, target, extra = {}) {
  const ev = { type, target, button: 0, relatedTarget: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  for (let e = target; e; e = e.parentNode) (e.listeners[type] || []).slice().forEach(f => f(ev));
  return ev;
}

// ── the overlay's real stack code ───────────────────────────────────────────────────────────────────────────────
const STACK = sliceBlock(overlay, "  const timersEl = document.getElementById('timers');", '\n  function paintTimers(){')
  .replace(/\n  function paintTimers\(\)\{$/, '');

let page;
function load({ failPosts = 0 } = {}) {
  const timersEl = new El('div');
  const winListeners = {};
  const p = { hover: [], posts: [], timersEl, failLeft: failPosts, winListeners };
  const win = {
    mimic: { overlayHoverInteractive: (v) => p.hover.push(v) },
    parent: null,
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener: (t, f) => { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); },
  };
  const doc = { getElementById: (id) => (id === 'timers' ? timersEl : null), createElement: (t) => new El(t) };
  const fetchStub = (url, opts) => {
    p.posts.push({ url, body: JSON.parse(opts.body) });
    if (p.failLeft > 0) { p.failLeft--; return Promise.reject(new Error('agent busy')); }
    return Promise.resolve({ ok: true, status: 200 });
  };
  const names = ['document', 'window', 'fetch', 'PORT', 'PART', 'PANEL', 'requestAutoHeight', 'stickyRows', 'dismissSticky'];
  const vals = [doc, win, fetchStub, 7779, null, null, () => {}, new Map(), () => {}];
  // eslint-disable-next-line no-new-func
  Object.assign(p, new Function(...names, STACK + '\nreturn { renderTimers, dismissTimer, clearAllCallouts, timerNodes, onTimerXPress };')(...vals));
  return p;
}
const T = (id, over = {}) => ({ id, target: null, effect: id, remaining_ms: 600_000, duration_sec: 3600, ...over });
const xOf = (p, id) => p.timersEl.children.find(r => r.dataset.timerId === id).querySelector('.timer-x');
const ids = (p) => p.timersEl.children.map(r => r.dataset.timerId);
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T20:00:00Z')); page = load(); });
afterEach(() => { vi.useRealTimers(); });

describe('the ✕ press dismisses the row', () => {
  it('a press on the ✕ removes the row and tells the agent which one', () => {
    page.renderTimers([T('by'), T('opens')]);
    dispatch('mousedown', xOf(page, 'by'));
    expect(ids(page)).toEqual(['opens']);
    expect(page.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/timers/cancel', body: { id: 'by', reason: 'chip_x' } }]);
  });

  it('works without any click: the release never has to land on the same node', () => {
    // The old handler waited for a click, which needs the press AND the release on one node. A repaint between
    // them (the node replaced, or the row sliding up under the cursor) means no click.
    page.renderTimers([T('a'), T('b')]);
    const down = dispatch('mousedown', xOf(page, 'a'));
    expect(down.defaultPrevented).toBe(true);
    expect(ids(page)).toEqual(['b']);
  });

  it('a press on a ✕ whose row was rebuilt still finds the row it belongs to', () => {
    // The row ends and is re-sent (a timer that restarts): the new ✕ is a different node. The press reads the id
    // off the row it is in NOW, so there is no stale closure to dismiss the wrong thing, or nothing.
    page.renderTimers([T('by')]);
    const stale = xOf(page, 'by');
    page.renderTimers([]);                      // one poll without it
    page.renderTimers([T('by')]);               // and it is back, as a new node
    expect(xOf(page, 'by')).not.toBe(stale);
    dispatch('mousedown', stale);               // the old node is detached: reaches nothing, throws nothing
    expect(ids(page)).toEqual(['by']);
    dispatch('mousedown', xOf(page, 'by'));
    expect(ids(page)).toEqual([]);
    expect(page.posts.map(x => x.body.id)).toEqual(['by']);
  });

  it('only the left button, and only a press on a ✕', () => {
    page.renderTimers([T('a')]);
    dispatch('mousedown', xOf(page, 'a'), { button: 2 });
    dispatch('mousedown', page.timersEl.children[0].querySelector('.timer-label'));
    expect(ids(page)).toEqual(['a']);
    expect(page.posts).toEqual([]);
  });

  it('the click that follows does not dismiss the NEXT row (it slid up under the cursor)', () => {
    page.renderTimers([T('a'), T('b')]);
    dispatch('mousedown', xOf(page, 'a'));
    dispatch('click', xOf(page, 'b'));          // the release lands on b's ✕ now
    expect(ids(page)).toEqual(['b']);
  });
});

describe('a dismissed row stays dismissed', () => {
  it('a poll already in flight when the ✕ was pressed does not bring the row back', () => {
    page.renderTimers([T('by')]);
    dispatch('mousedown', xOf(page, 'by'));
    page.renderTimers([T('by', { remaining_ms: 599_000 })]);   // the older snapshot arrives after the press
    expect(ids(page)).toEqual([]);
  });

  it('a POST the agent never answered is sent again (twice at most)', async () => {
    page = load({ failPosts: 2 });
    page.renderTimers([T('by')]);
    dispatch('mousedown', xOf(page, 'by'));
    await settle(); await vi.advanceTimersByTimeAsync(400); await vi.advanceTimersByTimeAsync(800);
    expect(page.posts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(page.posts, 'it gives up after the retries').toHaveLength(3);
  });

  it('the window stays armed through the release, then lets the mouse go back to EverQuest', () => {
    page.renderTimers([T('a')]);
    dispatch('mouseover', xOf(page, 'a'));
    dispatch('mousedown', xOf(page, 'a'));
    expect(page.hover, 'not disarmed while the button is still down').toEqual([true]);
    page.winListeners.mouseup.forEach(f => f({ type: 'mouseup' }));
    expect(page.hover).toEqual([true, false]);
    vi.advanceTimersByTime(2000);
    expect(page.hover, 'released once, not twice').toEqual([true, false]);
  });

  it('moving off a ✕ gives the mouse back; moving onto the next ✕ takes it', () => {
    page.renderTimers([T('a'), T('b')]);
    dispatch('mouseover', xOf(page, 'a'));
    dispatch('mouseout', xOf(page, 'a'), { relatedTarget: page.timersEl });
    dispatch('mouseover', xOf(page, 'b'));
    expect(page.hover).toEqual([true, false, true]);
  });
});

describe('the server tick', () => {
  const TICK = () => T('bt|servertick', { effect: 'Server tick', remaining_ms: 3000, duration_sec: 6, cycle_ms: 6000, bar_color: '#58a6ff', pinned: true });

  it('✕ hides it for as long as the overlay lives, however many snapshots rebuild it', () => {
    page.renderTimers([TICK(), T('by')]);
    dispatch('mousedown', xOf(page, 'bt|servertick'));
    expect(ids(page)).toEqual(['by']);
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(20_000); page.renderTimers([TICK(), T('by')]); }
    expect(ids(page), 'still hidden a minute later').toEqual(['by']);
  });

  it('is not sent to the agent: a hide kept there would outlast the overlay', () => {
    page.renderTimers([TICK()]);
    dispatch('mousedown', xOf(page, 'bt|servertick'));
    expect(page.posts).toEqual([]);
  });

  it('says what the ✕ does, in its tooltip', () => {
    page.renderTimers([TICK(), T('by')]);
    expect(xOf(page, 'bt|servertick').title).toMatch(/until you reopen/i);
    expect(xOf(page, 'by').title).toMatch(/^Dismiss this countdown/);
  });

  it('a reopened overlay (a fresh page) shows it again', () => {
    page.renderTimers([TICK()]);
    dispatch('mousedown', xOf(page, 'bt|servertick'));
    const reopened = load();
    reopened.renderTimers([TICK()]);
    expect(ids(reopened)).toEqual(['bt|servertick']);
  });

  it('the 🗑 clear-all hides it for the page too, and tells the agent to clear the rest', () => {
    page.renderTimers([TICK(), T('by')]);
    page.clearAllCallouts();
    expect(ids(page)).toEqual([]);
    vi.advanceTimersByTime(30_000);
    page.renderTimers([TICK(), T('by')]);
    expect(ids(page), 'the tick is still hidden; the countdown is back only if the agent still sends it').toEqual(['by']);
    expect(page.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/timers/cancel', body: { all: true, reason: 'clear_all' } }]);
  });
});

// ── the agent ───────────────────────────────────────────────────────────────────────────────────────────────────
const CANCEL = sliceBlock(agentSrc, 'function _cancelTimer(id) {', 'return { ok, cancelled: ok ? 1 : 0 };\n}');
const CALLOUT = sliceBlock(agentSrc, 'const CALLOUT_FEEDBACK_RECENT_MAX', '\n  return out;\n}');
const LATE = sliceBlock(agentSrc, 'const LATE_JOIN_SAME_WINDOW_MS', '\n  return true;\n}\n');
function fn(name) {
  const m = new RegExp('^function ' + name + '\\(', 'm').exec(agentSrc);
  if (!m) throw new Error('slice: function not found: ' + name);
  return agentSrc.slice(m.index, agentSrc.indexOf('\n}\n', m.index) + 3);
}
const AGENT_BLOCK = [
  /^const _NON_SEMANTIC_CAPTURES = .*$/m.exec(agentSrc)[0],
  ...['_semanticCaptureKeys', '_timerWarnings', '_parseDurationText', '_timerDurationSec', '_startTimer', '_relayFiredAtLocal'].map(fn),
  CANCEL, CALLOUT, LATE,
].join('\n');

function agent({ tickAt = true } = {}) {
  const e = { journal: [], scheduled: 0 };
  const body = `
    const AGENT_VERSION = '9.9.9';
    const _activeTimers = new Map();
    const _zealState = { Aldenmar: { updatedAt: Date.now() } };
    const _optinState = { timingFeedback: true };
    const stats = { guildTriggers: [{ id: 'by', name: 'Tactics: stampede by', timer_duration_sec: 7200, actions: [], end_text: 'Stampede is overdue' }], clockOffsetMs: null, currentEncounterThreat: null };
    const TJ = { MATCHED: 2, DISPATCHED: 5 };
    const _journalTrigger = (j) => e.journal.push(j);
    const _lootAuctions = new Map();
    const _dkpAuctionsDismissed = new Set();
    let _lastLootSig = null;
    const _personalTriggers = [{ builtin_timer: 'server_tick', enabled: true }];
    const _playingCharactersLc = () => ['aldenmar'];
    const _watchedCharacters = () => ['Aldenmar'];
    const _serverTickAtFor = (ch, now) => (${tickAt} ? now + 3000 : null);
    const _charmTickTracker = new Map(), _buffLandingsByTarget = new Map(), _meSkillCds = new Map(), _spellByNameLower = new Map();
    const CHARM_SPELLS = new Set();
    const _mobTickFor = () => null, _entityTickFadeAt = () => null, _isPacifySpell = () => false;
    function enqueueUpload() {}
    ${AGENT_BLOCK}
    return { _activeTimers, _handleTimerCancel, _activeTimersSnapshot, _builtinTimerHidden, _lootAuctions, _dkpAuctionsDismissed,
             _runLateJoinFire, _startTimer, _calloutFeedbackSnapshot };
  `;
  // eslint-disable-next-line no-new-func
  return Object.assign(e, new Function('e', body)(e));
}
const ROW = (id, over = {}) => ({
  id, name: id, target: null, effect: id, started_at_ms: Date.now() - 60_000, ends_at_ms: Date.now() + 3_600_000,
  duration_sec: 3660, show_at_ms: 0, test: false, scope: 'guild_relay', trigger_id: id, ...over,
});
const snapIds = (a) => a._activeTimersSnapshot().map(r => r.id);

describe('the agent accepts a cancel for every row kind, and the next snapshot does not bring it back', () => {
  it('a zone-timer countdown (the long Tactics rows)', () => {
    const a = agent();
    a._activeTimers.set('opens', ROW('opens', { effect: 'Tactics: stampede window opens', duration_sec: 2400 }));
    a._activeTimers.set('by', ROW('by', { effect: 'Tactics: stampede by', duration_sec: 7200, ends_at_ms: Date.now() + 5_461_000 }));
    expect(a._handleTimerCancel({ id: 'by', reason: 'chip_x' })).toEqual({ ok: true, cancelled: 1 });
    expect(snapIds(a)).not.toContain('by');
    expect(snapIds(a)).toContain('opens');
    expect(snapIds(a)).not.toContain('by');   // and again: nothing re-adds it
  });

  it('a spell recast countdown keyed by its mob', () => {
    const a = agent();
    const id = 'fw|s=A Sky Wyvern';
    a._activeTimers.set(id, ROW(id, { target: 'A Sky Wyvern', effect: 'Frozen Wind recast', trigger_id: 'fw' }));
    expect(a._handleTimerCancel({ id }).ok).toBe(true);
    expect(snapIds(a)).not.toContain(id);
  });

  it('a loot chip also drops its auction, so a repeat post opens a fresh one', () => {
    const a = agent();
    a._activeTimers.set('loot|sig1', ROW('loot|sig1', { kind: 'loot' }));
    a._lootAuctions.set('sig1', { items: [] });
    expect(a._handleTimerCancel({ id: 'loot|sig1' }).ok).toBe(true);
    expect(a._lootAuctions.has('sig1')).toBe(false);
    expect(snapIds(a)).not.toContain('loot|sig1');
  });

  it('an OpenDKP auction chip stays dismissed until it closes', () => {
    const a = agent();
    a._activeTimers.set('auction|77', ROW('auction|77'));
    expect(a._handleTimerCancel({ id: 'auction|77' }).ok).toBe(true);
    expect(a._dkpAuctionsDismissed.has('77')).toBe(true);
  });

  it('the server tick: accepted, and not rebuilt by later snapshots', () => {
    const a = agent();
    expect(snapIds(a)).toEqual(['bt|servertick']);
    expect(a._handleTimerCancel({ id: 'bt|servertick', reason: 'chip_x' })).toEqual({ ok: true, cancelled: 1 });
    for (let i = 0; i < 3; i++) expect(snapIds(a)).toEqual([]);
  });

  it('an id the agent no longer has is an answer, not an error', () => {
    const a = agent();
    expect(a._handleTimerCancel({ id: 'gone' })).toEqual({ ok: false, cancelled: 0 });
    expect(a._handleTimerCancel({})).toEqual({ ok: false, cancelled: 0 });
  });

  it('clear-all drops the countdowns, spares a loot chip, and leaves the perpetual tick to the overlay', () => {
    const a = agent();
    a._activeTimers.set('by', ROW('by'));
    a._activeTimers.set('loot|s', ROW('loot|s', { kind: 'loot' }));
    expect(a._handleTimerCancel({ all: true, reason: 'clear_all' })).toEqual({ ok: true, cancelled: 1 });
    expect(snapIds(a).sort()).toEqual(['bt|servertick', 'loot|s']);
    expect(a._builtinTimerHidden.has('bt|servertick'), 'a hide kept here would outlast the overlay').toBe(false);
  });

  it('records the dismissal as a signal, once per row', () => {
    const a = agent();
    a._activeTimers.set('by', ROW('by'));
    a._handleTimerCancel({ id: 'by', reason: 'chip_x' });
    a._handleTimerCancel({ id: 'by', reason: 'chip_x' });
    expect(a._calloutFeedbackSnapshot().dismissed).toBe(1);
  });
});

describe('a zone timer the bot hands out again stays dismissed', () => {
  const MIN = 60_000;
  const late = (startedAgoMin) => {
    const at = Date.now() - startedAgoMin * MIN;
    return { id: 'w|by', name: 'Tactics: stampede by', key: 'k', captures: {}, actions: [], timer_duration_sec: 7200,
      trigger_id: 'by', cooldown_seconds: 120, fired_at_ms: at, fired_at_true_ms: at, late_join: true, window_id: 'w', end_text: 'bot' };
  };

  it('re-entering the zone does not re-arm the countdown the raider cleared', () => {
    const a = agent();
    expect(a._runLateJoinFire(late(50))).toBe(true);
    expect(a._activeTimers.size).toBe(1);
    expect(a._handleTimerCancel({ id: 'by', reason: 'chip_x' }).ok).toBe(true);
    expect(a._activeTimers.size).toBe(0);
    expect(a._runLateJoinFire(late(50)), 'handed out again after leaving and coming back').toBe(false);
    expect(a._activeTimers.size).toBe(0);
    expect(a.journal.some(j => /you dismissed/.test(j.reason || ''))).toBe(true);
  });

  it('a clear-all remembers them too', () => {
    const a = agent();
    a._runLateJoinFire(late(50));
    a._handleTimerCancel({ all: true, reason: 'clear_all' });
    expect(a._runLateJoinFire(late(50))).toBe(false);
  });

  it('a NEW window of the same trigger arms normally', () => {
    const a = agent();
    a._runLateJoinFire(late(50));
    a._handleTimerCancel({ id: 'by' });
    expect(a._runLateJoinFire(late(5)), 'the next emote, well past the 2-minute same-window tolerance').toBe(true);
    expect(a._activeTimers.size).toBe(1);
  });

  it('dismissing one trigger does not silence another', () => {
    const a = agent();
    a._activeTimers.set('other', ROW('other'));
    a._handleTimerCancel({ id: 'other' });
    expect(a._runLateJoinFire(late(50))).toBe(true);
  });
});

// ── wiring, on comment-stripped source ──────────────────────────────────────────────────────────────────────────
describe('wiring', () => {
  const page = stripJs(overlay);

  it('the stack listens for the press on #timers, and the ✕ has no listener of its own', () => {
    expect(page).toMatch(/timersEl\.addEventListener\('mousedown', onTimerXPress\);/);
    expect(page).toMatch(/timersEl\.addEventListener\('mouseover', onTimerXOver\);/);
    const build = sliceBlock(page, "x.className = 'timer-x';", 'row.appendChild(x);');
    expect(build).not.toMatch(/x\.addEventListener/);
    expect(build).toMatch(/x\.setAttribute\('data-wp-interact', ''\)/);
    expect(build).toMatch(/row\.dataset\.timerId = t\.id/);
  });

  it('the route answers from _handleTimerCancel', () => {
    const route = sliceBlock(stripJs(agentSrc), "if (req.url === '/api/timers/cancel' && req.method === 'POST') {", 'return res.end(JSON.stringify(out));');
    expect(route).toMatch(/_handleTimerCancel\(payload\)/);
  });

  it('main logs the first arm from each page, so a Canvas panel that never arms can be seen', () => {
    const h = sliceBlock(stripJs(mainSrc), "ipcMain.handle('overlay-hover-interactive'", 'win.setIgnoreMouseEvents(false);');
    expect(h).toMatch(/_hoverArmFrames/);
    expect(h).toMatch(/senderFrame/);
  });
});
