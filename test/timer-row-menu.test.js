// test/timer-row-menu.test.js — the ⋮ on a timer row: move it to another panel, or mute it.
//
// The guild lead, 2026-10-19: "Need to be able to click on a line and move it to a new timer, not just X it out.
// Should be able to permanently mute and review those lines somewhere." Option A: a small ⋮ beside each row's ✕; the
// menu is drawn by the Canvas page (a panel's iframe would clip it) with Move to ▸ <panel> / New panel…, Mute this
// session, Mute always, and for a spell bar "Mute <spell> on this mob only". The agent owns the mutes and drops a
// muted row where the rows are built, so every surface agrees; a Muted timers card on the dashboard's Triggers tab
// lists them with an unmute.
//
// Four halves, all running the SHIPPED code:
//   1. the agent (required): _timerMuteKeys / _setTimerMute / _activeTimersSnapshot / _builtinTimerRows, and the
//      rules file for "always" (fs mocked, as enrage-callouts.test.js does);
//   2. triggers.html's real stack code (sliced) over a small fake DOM: the ⋮, its hover handshake, the standalone menu;
//   3. canvas.html's real menu code (sliced): the targets, Move, New panel, Mute, the box translation;
//   4. dashboard.html's real Muted timers card, and the wiring (comment-stripped text).
//
// Run: npx vitest run test/timer-row-menu.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const triggersHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const canvasHtml   = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const dashHtml     = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const agentSrc     = readSource(AGENT_INDEX);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. the agent
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('agent: muting a timer row', () => {
  let agent;
  beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

  const ME = 'Fenrisk';
  const NOW = Date.now();
  const RAT = 'A scrounging rat';
  const SLOW = "Turgur's Insects";
  let writes;

  function clearRules() { for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k]; }
  const trig = (id, over = {}) => ({
    id, name: id, target: null, effect: id, started_at_ms: NOW - 60_000, ends_at_ms: Date.now() + 3_600_000,
    duration_sec: 3660, show_at_ms: 0, test: false, scope: 'guild', trigger_id: id, rule_key: null, ...over,
  });
  function put(row) { agent._activeTimers.set(row.id, row); return row; }
  function land(key, mobName, spell, id) {
    let mp = agent._buffLandingsByTarget.get(key);
    if (!mp) { mp = new Map(); agent._buffLandingsByTarget.set(key, mp); }
    mp.set(spell.toLowerCase(), { name: spell, dur_ticks: 20, landed_at: Date.now() - 1000, cast_by: ME, target_name: mobName, target_id: id });
  }
  const snap = () => agent._activeTimersSnapshot();
  const effects = () => snap().map(r => r.effect).sort();
  const spellRow = (mob) => snap().find(r => r.id.startsWith('bt|spell|') && r.target.toLowerCase().startsWith(mob.toLowerCase()));

  beforeEach(() => {
    agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
    agent._setSpellCatalogForTest([{ name: SLOW, good: 0 }, { name: 'Malosini', good: 0 }]);
    const tpl = agent.SUGGESTED_TRIGGERS.find(t => t.id === 'timer_my_spells');
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl))]);
    agent._activeTimers.clear();
    agent._buffLandingsByTarget.clear();
    agent._builtinTimerHidden.clear();
    agent._timerMuteSession.clear();
    clearRules();
    writes = [];
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, body) => { writes.push({ p: String(p), body: String(body) }); });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
  });
  afterEach(() => {
    agent._activeTimers.clear();
    agent._buffLandingsByTarget.clear();
    agent._timerMuteSession.clear();
    clearRules();
    vi.restoreAllMocks();
  });

  describe('a trigger countdown', () => {
    it('mute this session: the row leaves the snapshot, the countdown keeps running, unmute brings it back', () => {
      put(trig('slow', { rule_key: 'guild:77', effect: 'Slow', target: 'a gnoll' }));
      put(trig('other', { rule_key: 'guild:88', effect: 'Other' }));
      expect(agent._setTimerMute({ action: 'mute', scope: 'session', id: 'slow' })).toMatchObject({ ok: true });
      expect(effects()).toEqual(['Other']);
      expect(agent._activeTimers.has('slow'), 'only the row is hidden, not the timer').toBe(true);
      expect(agent._timerMutesView().session.map(e => e.key)).toEqual(['timer:trigger:guild:77']);
      expect(agent._setTimerMute({ action: 'unmute', key: 'timer:trigger:guild:77' })).toMatchObject({ ok: true });
      expect(effects()).toEqual(['Other', 'Slow']);
    });

    it('the mute is by TRIGGER, not by row: every mob it counts on goes', () => {
      put(trig('slow|a', { rule_key: 'guild:77', effect: 'Slow', target: 'a gnoll' }));
      put(trig('slow|b', { rule_key: 'guild:77', effect: 'Slow', target: 'a bat' }));
      agent._setTimerMute({ action: 'mute', scope: 'session', id: 'slow|a' });
      expect(snap()).toEqual([]);
    });

    it('a row with no rule key is muted by its effect name', () => {
      put(trig('zone', { effect: 'Tactics: stampede window opens' }));
      expect(agent._timerMuteKeys(snap()[0])).toMatchObject({ kind: 'trigger', key: 'timer:trigger:Tactics: stampede window opens' });
      agent._setTimerMute({ action: 'mute', scope: 'session', id: 'zone' });
      expect(snap()).toEqual([]);
    });

    it('a session mute is NOT written to disk', () => {
      put(trig('slow', { rule_key: 'guild:77' }));
      agent._setTimerMute({ action: 'mute', scope: 'session', id: 'slow' });
      expect(writes).toEqual([]);
    });

    it('mute always: a timer:trigger:<key> = off rule for everyone in trigger_rules.json, and it survives a restart', () => {
      put(trig('slow', { rule_key: 'guild:77', effect: 'Slow' }));
      expect(agent._setTimerMute({ action: 'mute', scope: 'always', id: 'slow' })).toMatchObject({ ok: true });
      expect(path.basename(writes[0].p)).toBe('trigger_rules.json.tmp');
      const saved = writes[writes.length - 1].body;
      expect(JSON.parse(saved)).toEqual({ version: 1, rules: { 'timer:trigger:guild:77': { '*': 'off' } } });
      expect(snap()).toEqual([]);
      clearRules(); agent._timerMuteSession.clear();                       // a fresh process
      expect(snap().map(r => r.effect), 'unmuted in a process that has not read the file').toEqual(['Slow']);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(saved);
      agent.loadTriggerRules();
      expect(snap()).toEqual([]);
      expect(agent._timerMutesView().always.map(e => e.key)).toEqual(['timer:trigger:guild:77']);
    });

    it('unmute always: the rule leaves the file and the row is back', () => {
      put(trig('slow', { rule_key: 'guild:77', effect: 'Slow' }));
      agent._setTimerMute({ action: 'mute', scope: 'always', id: 'slow' });
      expect(agent._setTimerMute({ action: 'unmute', key: 'timer:trigger:guild:77', scope: 'always' })).toMatchObject({ ok: true, always: [] });
      expect(JSON.parse(writes[writes.length - 1].body)).toEqual({ version: 1, rules: {} });
      expect(effects()).toEqual(['Slow']);
    });

    it('unmute with no scope lifts both kinds at once; one that was never muted writes nothing', () => {
      put(trig('slow', { rule_key: 'guild:77' }));
      agent._setTimerMute({ action: 'mute', scope: 'always', id: 'slow' });
      agent._timerMuteSession.add('timer:trigger:guild:77');
      expect(agent._setTimerMute({ action: 'unmute', key: 'timer:trigger:guild:77' })).toEqual({ ok: true, session: [], always: [] });
      expect(effects()).toEqual(['slow']);
      writes.length = 0;
      agent._setTimerMute({ action: 'unmute', key: 'timer:trigger:guild:99' });
      expect(writes).toEqual([]);
    });

    it('a TEST countdown is never hidden by a mute', () => {
      put(trig('t1', { rule_key: 'guild:77', effect: 'Slow', test: true }));
      agent._timerMuteSession.add('timer:trigger:guild:77');
      expect(effects()).toEqual(['Slow']);
    });

    it('a muted countdown no longer reaches the tank bar (every consumer of the snapshot agrees)', () => {
      put(trig('dt', { rule_key: 'guild:5', effect: 'Death Touch' }));
      agent._timerMuteSession.add('timer:trigger:guild:5');
      expect(snap().some(r => /death touch/i.test(r.effect))).toBe(false);
    });
  });

  describe('what cannot be muted', () => {
    it('a loot chip, an auction, a watched spot: refused, nothing written', () => {
      put(trig('loot|abc', { kind: 'loot', effect: 'Bid: Cloak', scope: 'loot' }));
      put(trig('auction|9', { kind: 'loot', effect: 'Auction', scope: 'loot' }));
      expect(agent._setTimerMute({ action: 'mute', scope: 'always', id: 'loot|abc' })).toMatchObject({ ok: false, error: 'this row cannot be muted' });
      expect(agent._setTimerMute({ action: 'mute', scope: 'session', id: 'auction|9' })).toMatchObject({ ok: false });
      expect(agent._timerMuteKeys({ id: 'named|z|1|2', effect: 'x' })).toBeNull();
      expect(agent._timerMuteKeys({ id: 'sample|x', effect: 'x' })).toBeNull();
      expect(writes).toEqual([]);
      expect(agent._timerMutesView()).toEqual({ session: [], always: [] });
    });
    it('a key by hand is held to the same rule: only the four kinds, only timer:', () => {
      expect(agent._setTriggerRule({ key: 'timer:bogus:x', char: '*', mode: 'off' })).toMatchObject({ ok: false });
      expect(agent._setTriggerRule({ key: 'timer:spell:Malosini', char: '*', mode: 'off' })).toMatchObject({ ok: true });
    });
    it('bad scope, a missing or vanished row, a non-timer key: refused', () => {
      put(trig('slow', { rule_key: 'guild:77' }));
      expect(agent._setTimerMute({ action: 'mute', scope: 'forever', id: 'slow' }).ok).toBe(false);
      expect(agent._setTimerMute({ action: 'mute', scope: 'session', id: 'gone' })).toMatchObject({ ok: false, error: 'that row is gone' });
      expect(agent._setTimerMute({ action: 'unmute', key: 'builtin:enrage_soon:x' }).ok).toBe(false);
      expect(effects()).toEqual(['slow']);
    });
  });

  describe('a spell bar (bt|spell|…)', () => {
    beforeEach(() => {
      land('a scrounging rat', RAT, SLOW, 4182);
      land('a bat', 'A bat', SLOW, null);
    });
    it('both bars are there, the rat\'s labelled with its spawn id', () => {
      expect(snap().filter(r => r.id.startsWith('bt|spell|')).map(r => r.target).sort()).toEqual(['A bat', 'A scrounging rat #4182']);
    });
    it('mute the spell: it goes on EVERY mob', () => {
      const id = spellRow('A scrounging').id;
      expect(agent._setTimerMute({ action: 'mute', scope: 'session', id })).toMatchObject({ ok: true });
      expect(snap().filter(r => r.id.startsWith('bt|spell|'))).toEqual([]);
      expect(agent._timerMutesView().session[0]).toMatchObject({ key: 'timer:spell:' + SLOW, kind: 'spell', label: SLOW });
    });
    it('mute it on THIS MOB only: the bare name (no " #id"), the other mob keeps its bar', () => {
      const id = spellRow('A scrounging').id;
      expect(agent._setTimerMute({ action: 'mute', scope: 'always', id, only_mob: true })).toMatchObject({ ok: true });
      expect(JSON.parse(writes[writes.length - 1].body).rules).toEqual({ ['timer:spellmob:a scrounging rat|' + SLOW]: { '*': 'off' } });
      expect(snap().filter(r => r.id.startsWith('bt|spell|')).map(r => r.target)).toEqual(['A bat']);
      expect(agent._timerMutesView().always[0]).toMatchObject({ kind: 'spellmob', label: SLOW, detail: 'spell bar on a scrounging rat' });
    });
    it('a mob-only mute follows the mob across a new spawn id (the bar is rebuilt with another #id)', () => {
      agent._timerMuteSession.add('timer:spellmob:a scrounging rat|' + SLOW);
      agent._buffLandingsByTarget.clear();
      land('a scrounging rat', RAT, SLOW, 9999);
      expect(snap().filter(r => r.id.startsWith('bt|spell|'))).toEqual([]);
    });
    it('"on this mob only" needs a mob: refused on a trigger row', () => {
      put(trig('slow', { rule_key: 'guild:77' }));
      expect(agent._setTimerMute({ action: 'mute', scope: 'always', id: 'slow', only_mob: true })).toMatchObject({ ok: false });
    });
    it('the mark on the effect ("?" unconfirmed, " ⏱" snapped) is not part of the spell\'s name', () => {
      expect(agent._timerMuteKeys({ id: 'bt|spell|a|b|1', effect: SLOW + '? ⏱', target: 'A bat #12' }))
        .toEqual({ kind: 'spell', key: 'timer:spell:' + SLOW, mobKey: 'timer:spellmob:a bat|' + SLOW });
    });
    it('another derived bar (Recharm tick, Server tick) mutes by its effect', () => {
      expect(agent._timerMuteKeys({ id: 'bt|servertick', effect: 'Server tick' })).toEqual({ kind: 'bar', key: 'timer:bar:Server tick', mobKey: null });
    });
    it('the pieces and the Map timers read the same builder, so the row is gone for them too', () => {
      // _builtinTimerRows is the one place these bars are built (pieces, the standalone window and the canvas all read the snapshot).
      agent._timerMuteSession.add('timer:spell:' + SLOW);
      expect(agent._builtinTimerRows(Date.now()).filter(r => r.id.startsWith('bt|spell|'))).toEqual([]);
    });
  });

  describe('the card\'s list', () => {
    it('names a personal trigger by its own name; always and session are separate; sorted', () => {
      agent._setPersonalTriggersForTest([{ id: 'p1', name: 'My slow', pattern: 'x' }]);
      agent._timerMuteSession.add('timer:trigger:personal:p1');
      agent._timerMuteSession.add('timer:bar:Boastful Bellow');
      agent._triggerRules['timer:spell:Malosini'] = { '*': 'off' };
      agent._triggerRules['timer:trigger:guild:1'] = { '*': 'speak' };   // (not an off rule: not a mute)
      const v = agent._timerMutesView();
      expect(v.session.map(e => e.label)).toEqual(['Boastful Bellow', 'My slow']);
      expect(v.always.map(e => e.key)).toEqual(['timer:spell:Malosini']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// a small fake DOM, shared by the two page halves
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function matcher(sel) {
  if (/^[a-z]+$/.test(sel)) return (el) => el.nodeType === 1 && String(el.tagName).toLowerCase() === sel;
  // '.a.b' and '.a:not(.b)' — the only selector shapes the pages use.
  const [pos, ...nots] = sel.split(':not(');
  const want = pos.split('.').filter(Boolean);
  const not = nots.map(n => n.replace(')', '').replace('.', ''));
  return (el) => el.nodeType === 1 && want.every(c => el.classList.contains(c)) && not.every(c => !el.classList.contains(c));
}
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attrs = {}; this.listeners = {}; this._cls = []; this._text = ''; this.id = '';
    this.style = { setProperty() {}, transform: '' };
    this.offsetWidth = 200; this.offsetHeight = 90;
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
      if (m[4] !== undefined) { top._text += decode(m[4]); continue; }
      if (m[1]) { stack.pop(); continue; }
      const el = new El(m[2]);
      const cls = /class="([^"]*)"/.exec(m[3]);
      if (cls) el.className = cls[1];
      for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) el.attrs[a[1]] = a[2];
      el.parentNode = top; top.children.push(el);
      if (!/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
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
  querySelectorAll(sel) {
    const m = matcher(sel), out = [];
    const walk = (e) => e.children.forEach(c => { if (m(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  closest(sel) {
    const alts = sel.split(',').map(s => matcher(s.trim()));
    for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (alts.some(m => m(e))) return e;
    return null;
  }
  getBoundingClientRect() { return { left: 100, top: 400, right: 300, bottom: 424, width: 200, height: 24 }; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
}
function dispatch(type, target, extra = {}) {
  const ev = { type, target, button: 0, relatedTarget: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  for (let e = target; e; e = e.parentNode) (e.listeners[type] || []).slice().forEach(f => f(ev));
  return ev;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. triggers.html — the ⋮ and the standalone menu
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('triggers.html: the ⋮ beside the ✕', () => {
  const STACK = sliceBlock(triggersHtml, "  const timersEl = document.getElementById('timers');", '\n  function paintTimers(){')
    .replace(/\n  function paintTimers\(\)\{$/, '');

  let page;
  function load({ part = null, canvas = false } = {}) {
    const timersEl = new El('div');
    const body = new El('body');
    const p = { hover: [], posts: [], menuCalls: [], timersEl, body };
    const parent = canvas ? { wpCanvasRowMenu: (info, rect, panel) => { p.menuCalls.push({ info, rect, panel }); } } : null;
    const win = {
      mimic: { overlayHoverInteractive: (v) => p.hover.push(v) }, parent, innerWidth: 360, innerHeight: 500,
      addEventListener() {}, removeEventListener() {},
    };
    const doc = { body, documentElement: {}, getElementById: (id) => (id === 'timers' ? timersEl : null), createElement: (t) => new El(t) };
    const fetchStub = (url, opts) => { p.posts.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, status: 200 }); };
    const names = ['document', 'window', 'fetch', 'PORT', 'PART', 'PANEL', 'requestAutoHeight', 'stickyRows', 'dismissSticky', 'getComputedStyle'];
    const vals = [doc, win, fetchStub, 7779, part, part ? 'p1' : null, () => {}, new Map(), () => {}, () => ({ getPropertyValue: () => '' })];
    // eslint-disable-next-line no-new-func
    Object.assign(p, new Function(...names, STACK + '\nreturn { renderTimers, timerNodes };')(...vals), { win });
    return p;
  }
  const T = (id, over = {}) => ({ id, target: null, effect: id, remaining_ms: 600_000, duration_sec: 3600, group: 'trigger', ...over });
  const rowOf = (p, id) => p.timersEl.children.find(r => r.dataset.timerId === id);
  const menuOf = (p, id) => rowOf(p, id).querySelector('.timer-menu');
  const ids = (p) => p.timersEl.children.map(r => r.dataset.timerId);
  const popup = (p) => p.body.children.find(c => c.id === 'row-menu') || null;
  const items = (p) => popup(p).querySelectorAll('button');
  const SPELL = () => T('bt|spell|a rat|insects|1', { target: 'A scrounging rat #4182', effect: "Turgur's Insects? ⏱", group: 'spell' });

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T20:00:00Z')); page = load(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('who gets one', () => {
    it('a trigger row: a ⋮ BEFORE the ✕, in the hover handshake like the ✕ (data-wp-interact)', () => {
      page.renderTimers([T('by')]);
      const row = rowOf(page, 'by');
      const kinds = row.children.map(c => c.className).filter(c => /timer-(menu|x)/.test(c));
      expect(kinds).toEqual(['timer-menu', 'timer-x']);
      expect(menuOf(page, 'by').getAttribute('data-wp-interact')).toBe('');
      expect(menuOf(page, 'by').textContent).toBe('⋮');
    });
    it('not on a loot chip, a test row, or a watched spot (nothing to offer there, standalone)', () => {
      page.renderTimers([T('loot|x', { kind: 'loot', group: 'loot' }), T('sample|a', { test: true }), T('named|z|1|2', { group: 'trigger' }), T('by')]);
      expect(menuOf(page, 'loot|x')).toBeNull();
      expect(menuOf(page, 'sample|a')).toBeNull();
      expect(menuOf(page, 'named|z|1|2')).toBeNull();
      expect(menuOf(page, 'by')).not.toBeNull();
    });
    it('in a Canvas panel a watched spot gets one too (it can MOVE), a loot chip still does not', () => {
      const c = load({ part: 'timers', canvas: true });
      c.renderTimers([T('named|z|1|2'), T('loot|x', { kind: 'loot', group: 'loot' })]);
      expect(menuOf(c, 'named|z|1|2')).not.toBeNull();
      expect(menuOf(c, 'loot|x')).toBeNull();
    });
    it('the ⋮ takes and gives back the mouse like the ✕', () => {
      page.renderTimers([T('a'), T('b')]);
      dispatch('mouseover', menuOf(page, 'a'));
      dispatch('mouseout', menuOf(page, 'a'), { relatedTarget: page.timersEl });
      expect(page.hover).toEqual([true, false]);
    });
  });

  describe('the standalone Timers window draws the Mute choices itself', () => {
    it('a press opens them; the row stays, nothing is cancelled', () => {
      page.renderTimers([T('by', { effect: 'Stampede' })]);
      const ev = dispatch('mousedown', menuOf(page, 'by'));
      expect(ev.defaultPrevented).toBe(true);
      expect(items(page).map(b => b.textContent)).toEqual(['Mute this session', 'Mute always']);
      expect(ids(page)).toEqual(['by']);
      expect(page.posts).toEqual([]);
    });
    it('a spell bar adds "Mute <spell> on this mob only" (the mark and the spawn id stripped)', () => {
      page.renderTimers([SPELL()]);
      dispatch('mousedown', menuOf(page, 'bt|spell|a rat|insects|1'));
      expect(items(page).map(b => b.textContent)).toEqual(['Mute this session', 'Mute always', "Mute Turgur's Insects on this mob only"]);
    });
    it('Mute this session / always: POST to the agent with the row id, and the row is gone at once', () => {
      page.renderTimers([T('by'), T('keep')]);
      dispatch('mousedown', menuOf(page, 'by'));
      dispatch('click', items(page)[0]);
      expect(page.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/timer-mute', body: { action: 'mute', scope: 'session', id: 'by', only_mob: false } }]);
      expect(ids(page)).toEqual(['keep']);
      expect(popup(page)).toBeNull();
      dispatch('mousedown', menuOf(page, 'keep'));
      dispatch('click', items(page)[1]);
      expect(page.posts[1].body).toEqual({ action: 'mute', scope: 'always', id: 'keep', only_mob: false });
    });
    it('on this mob only: always, only_mob', () => {
      page.renderTimers([SPELL()]);
      dispatch('mousedown', menuOf(page, 'bt|spell|a rat|insects|1'));
      dispatch('click', items(page)[2]);
      expect(page.posts[0].body).toEqual({ action: 'mute', scope: 'always', id: 'bt|spell|a rat|insects|1', only_mob: true });
    });
    it('a poll already in flight does not bring a muted row back', () => {
      page.renderTimers([T('by')]);
      dispatch('mousedown', menuOf(page, 'by'));
      dispatch('click', items(page)[0]);
      page.renderTimers([T('by', { remaining_ms: 599_000 })]);
      expect(ids(page)).toEqual([]);
    });
    it('a second press on the ⋮ closes it; left alone it closes by itself after 5 s; it fits inside the window', () => {
      page.renderTimers([T('by')]);
      dispatch('mousedown', menuOf(page, 'by'));
      expect(popup(page)).not.toBeNull();
      dispatch('mousedown', menuOf(page, 'by'));
      expect(popup(page)).toBeNull();
      dispatch('mousedown', menuOf(page, 'by'));
      const el = popup(page);
      expect(parseInt(el.style.left, 10)).toBeGreaterThanOrEqual(4);
      expect(parseInt(el.style.left, 10) + el.offsetWidth).toBeLessThanOrEqual(360 - 4);
      expect(parseInt(el.style.top, 10)).toBeGreaterThanOrEqual(4);
      vi.advanceTimersByTime(5100);
      expect(popup(page)).toBeNull();
    });
    it('the pointer on the menu holds it open; leaving it closes it', () => {
      page.renderTimers([T('by')]);
      dispatch('mousedown', menuOf(page, 'by'));
      const el = popup(page);
      dispatch('mouseenter', el);
      vi.advanceTimersByTime(6000);
      expect(popup(page)).not.toBeNull();
      dispatch('mouseleave', el);
      expect(popup(page)).toBeNull();
    });
    it('the ✕ still dismisses, and ⋮ is not a ✕', () => {
      page.renderTimers([T('a'), T('b')]);
      dispatch('mousedown', rowOf(page, 'a').querySelector('.timer-x'));
      expect(ids(page)).toEqual(['b']);
      expect(page.posts.map(x => x.url)).toEqual(['http://127.0.0.1:7779/api/timers/cancel']);
    });
  });

  describe('in a Canvas panel the Canvas page draws it', () => {
    it('a press hands the row, its box and its panel to parent.wpCanvasRowMenu; nothing is drawn or sent here', () => {
      const c = load({ part: 'timers', canvas: true });
      c.renderTimers([SPELL()]);
      dispatch('mousedown', menuOf(c, 'bt|spell|a rat|insects|1'));
      expect(c.menuCalls).toHaveLength(1);
      expect(c.menuCalls[0].panel).toBe('p1');
      expect(c.menuCalls[0].rect).toEqual({ left: 100, top: 400, right: 300, bottom: 424 });
      expect(c.menuCalls[0].info).toEqual({
        id: 'bt|spell|a rat|insects|1', effect: "Turgur's Insects? ⏱", target: 'A scrounging rat #4182', group: 'spell', kind: null,
        spell: "Turgur's Insects", mob: 'A scrounging rat', mutable: true,
      });
      expect(popup(c)).toBeNull();
      expect(c.posts).toEqual([]);
    });
    it('a trigger row is handed over as a trigger (no spell, no mob)', () => {
      const c = load({ part: 'timers', canvas: true });
      c.renderTimers([T('by', { effect: 'Stampede', group: 'trigger' })]);
      dispatch('mousedown', menuOf(c, 'by'));
      expect(c.menuCalls[0].info).toMatchObject({ id: 'by', spell: null, mob: null, group: 'trigger', mutable: true });
    });
    it('window.wpPartHide drops a row now and holds it through a poll in flight, sending nothing', () => {
      const c = load({ part: 'timers', canvas: true });
      c.renderTimers([T('by'), T('keep')]);
      c.win.wpPartHide('by');
      c.renderTimers([T('by'), T('keep')]);
      expect(ids(c)).toEqual(['keep']);
      expect(c.posts).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. canvas.html — the menu the Canvas page draws
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('canvas.html: Move to ▸ panel / New panel…, Mute', () => {
  const RULES = sliceBlock(canvasHtml, '  var GROUPS = [', '  // ── Panels ──');
  const CLAIM = sliceBlock(canvasHtml, '  // A name lives in one panel', '\n  // ── ⋮ on a timer row');
  const ADDP  = sliceBlock(canvasHtml, '  // A new timers panel in the middle of the screen', '    return p;\n  }\n');
  const MENU  = sliceBlock(canvasHtml, "  var ROWMENU = '__row'", '\n  // ── ＋ Overlay');

  let H;
  function build() {
    const h = { posts: [], notes: [], saves: 0, renders: 0, closes: 0, opened: [], placed: 0, hidden: [] };
    // (a plain object: the code under test writes innerHTML, and the test reads that string back)
    const menuEl = { innerHTML: '', classList: { add() {}, remove() {}, contains: () => true } };
    const frame = { offsetWidth: 600, getBoundingClientRect: () => ({ left: 100, top: 200, width: 300, height: 100 }),
      contentWindow: { wpPartHide: (id) => h.hidden.push(id) } };
    const prelude = `
      var window = {};
      var PORT = 7779, MAX_PANELS = 150, _edit = false, _menuFor = null, _menuAnchor = null;
      var _els = {};
      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
      function save() { h.saves++; }
      function render() { h.renders++; _layout.panels.forEach(function (q) { if (!_els[q.id]) _els[q.id] = { root: {}, frame: frame }; }); }
      function note(m) { h.notes.push(m); }
      function closeMenu() { _menuFor = null; h.closes++; }
      function placeMenu() { h.placed++; }
      function openMenu(id) { _menuFor = id; h.opened.push(id); }
    `;
    // eslint-disable-next-line no-new-func
    const api = new Function('h', 'menuEl', 'frame', 'fetch', [prelude, RULES, CLAIM, ADDP, MENU].join('\n') + `
      return { window: window, _layout: function () { return _layout; }, setLayout: function (l) { _layout = l; },
        menuFor: function () { return _menuFor; }, anchor: function () { return _menuAnchor; }, rowMenuClick: rowMenuClick,
        setEdit: function (v) { _edit = v; }, render: render };
    `)(h, menuEl, frame, (url, opts) => { h.posts.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); });
    Object.assign(h, api, { menuEl, frame });
    h.render(); h.renders = 0;      // the panels exist on the page before anyone presses a ⋮
    return h;
  }
  // The row as triggers.html hands it over.
  const ROW = (effect, extra = {}) => ({ id: 'row|' + effect, effect, target: null, group: 'trigger', kind: null, spell: null, mob: null, mutable: true, ...extra });
  const BOX = { left: 10, top: 20, right: 110, bottom: 44 };
  // A click on a menu control, as the menu's delegated handler sees it.
  function ctl(attrs) {
    const el = { hasAttribute: (k) => k in attrs, getAttribute: (k) => attrs[k] };
    const chip = ('data-mvto' in attrs || 'data-mvnew' in attrs) ? el : null;
    return Object.assign(el, { closest: (sel) => (sel === '.chip' ? chip : null) });
  }
  const labels = () => Array.from(H.menuEl.innerHTML.matchAll(/data-mvto="([^"]+)">([^<]+)/g)).map(m => m[1] + ':' + m[2]);
  const html = () => H.menuEl.innerHTML;
  // The menu element is written as innerHTML by the code under test; the harness's `menuEl` is a plain El whose setter parses it.
  const open = (info, panel = 'timers', rect = BOX) => H.window.wpCanvasRowMenu(info, rect, panel);

  beforeEach(() => { vi.useFakeTimers(); H = build(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('Move to', () => {
    it('lists every OTHER timers panel (never the one the row is in, never callouts), then New panel…', () => {
      open(ROW('Tashania'), 'timers');
      expect(labels()).toEqual(['charm:Charm']);
      expect(html()).toContain('data-mvnew');
      expect(H.menuFor()).toBe('__row');
    });
    it('the catch-all is offered only when it would really get the row back', () => {
      // Charm claims the whole "charm" group: a charm row released by name still lands in Charm, so Timers is not a real target.
      open(ROW('Recharm tick', { group: 'charm' }), 'charm');
      expect(labels()).toEqual([]);
      // A row pulled out by name into its own panel CAN go back to the catch-all.
      const L = H._layout();
      L.panels.push({ id: 'tash', kind: 'timers', all: false, groups: [], names: ['tashania'], name: 'Tash', x: 0, y: 0, w: 1, h: 1, off: false });
      open(ROW('Tashania'), 'tash');
      expect(labels().map(s => s.split(':')[0]).sort()).toEqual(['charm', 'timers']);
    });
    it('a hidden panel is offered, and says so', () => {
      H._layout().panels.push({ id: 'hid', kind: 'timers', all: false, groups: [], names: [], name: 'Quiet', off: true });
      open(ROW('Tashania'));
      expect(html()).toMatch(/Quiet <span class="dim">· hidden<\/span>/);
    });
    it('picking a panel claims the row\'s name for it and releases it everywhere else (claimName), then saves and repaints', () => {
      const L = H._layout();
      L.panels.push({ id: 'old', kind: 'timers', all: false, groups: [], names: ['tashania'], name: 'Old', off: false });
      open(ROW("Tashania? ⏱"), 'old');
      H.rowMenuClick(ctl({ 'data-mvto': 'charm' }));
      expect(L.panels.find(p => p.id === 'charm').names).toEqual(['tashania']);
      expect(L.panels.find(p => p.id === 'old').names).toEqual([]);
      expect(H.saves).toBe(1); expect(H.renders).toBe(1); expect(H.closes).toBe(1);
      expect(H.window.wpCanvasRoute({ id: 'x', effect: 'Tashania', group: 'trigger' })).toBe('charm');
    });
    it('moving to the catch-all just releases the name', () => {
      const L = H._layout();
      L.panels.push({ id: 'tash', kind: 'timers', all: false, groups: [], names: ['tashania'], name: 'Tash', off: false });
      open(ROW('Tashania'), 'tash');
      H.rowMenuClick(ctl({ 'data-mvto': 'timers' }));
      expect(L.panels.find(p => p.id === 'tash').names).toEqual([]);
      expect(H.window.wpCanvasRoute({ id: 'x', effect: 'Tashania', group: 'trigger' })).toBe('timers');
    });
    it('a panel already claiming 20 names says so and nothing moves', () => {
      const L = H._layout();
      const full = L.panels.find(p => p.id === 'charm');
      for (let i = 0; i < 20; i++) full.names.push('n' + i);
      open(ROW('Tashania'));
      H.rowMenuClick(ctl({ 'data-mvto': 'charm' }));
      expect(full.names).not.toContain('tashania');
      expect(H.notes).toHaveLength(1);
      expect(H.saves).toBe(0);
    });
    it('New panel…: a fresh timers panel that claims just this timer, with its own menu open', () => {
      const L = H._layout();
      const before = L.panels.length;
      open(ROW('Tashania'));
      H.rowMenuClick(ctl({ 'data-mvnew': '' }));
      expect(L.panels).toHaveLength(before + 1);
      const p = L.panels[L.panels.length - 1];
      expect(p).toMatchObject({ kind: 'timers', all: false, names: ['tashania'], groups: [] });
      expect(H.opened).toEqual([p.id]);
      expect(H.saves).toBe(1);
    });
    it('a loot chip has no Move and no Mute', () => {
      open(ROW('Bid: Cloak', { kind: 'loot', group: 'loot', mutable: false }));
      expect(html()).not.toContain('data-mvto');
      expect(html()).not.toContain('data-mvnew');
      expect(html()).not.toContain('data-rmute');
    });
  });

  describe('Mute', () => {
    it('this session / always: POST with the row id, the row hidden in its panel at once, the menu closed', () => {
      open(ROW('Stampede'), 'timers');
      expect(html()).toContain('data-rmute="session"');
      H.rowMenuClick(ctl({ 'data-rmute': 'session' }));
      expect(H.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/timer-mute', body: { action: 'mute', scope: 'session', id: 'row|Stampede', only_mob: false } }]);
      expect(H.hidden).toEqual(['row|Stampede']);
      expect(H.closes).toBe(1);
      open(ROW('Stampede'), 'timers');
      H.rowMenuClick(ctl({ 'data-rmute': 'always' }));
      expect(H.posts[1].body).toEqual({ action: 'mute', scope: 'always', id: 'row|Stampede', only_mob: false });
    });
    it('"on this mob only" shows for a spell bar, names the spell, and mutes for good with only_mob', () => {
      open(ROW("Turgur's Insects", { id: 'bt|spell|a|b|1', spell: "Turgur's Insects", mob: 'A rat', group: 'spell' }));
      expect(html()).toContain("Mute Turgur's Insects on this mob only");
      H.rowMenuClick(ctl({ 'data-rmute': 'mob' }));
      expect(H.posts[0].body).toEqual({ action: 'mute', scope: 'always', id: 'bt|spell|a|b|1', only_mob: true });
    });
    it('no "this mob only" on a trigger row; an unmutable row (a watched spot) can still move', () => {
      open(ROW('Stampede'));
      expect(html()).not.toContain('this mob only');
      open(ROW('★ Named PH', { id: 'named|z|1|2', mutable: false }));
      expect(html()).not.toContain('data-rmute');
      expect(html()).toContain('data-mvnew');
    });
    it('the spell name is escaped in the menu', () => {
      open(ROW('x', { spell: '<b>"x"</b>', mob: 'm', id: 'bt|spell|q' }));
      expect(html()).not.toContain('<b>');
      expect(html()).toContain('&lt;b&gt;');
    });
  });

  describe('the menu itself', () => {
    it('is placed beside the ROW, in canvas pixels (the frame\'s box and scale applied)', () => {
      open(ROW('Stampede'), 'timers');                 // frame at (100,200), drawn at half its page width: k = 0.5
      expect(H.anchor().getBoundingClientRect()).toEqual({ left: 105, top: 210, right: 155, bottom: 222 });
      expect(H.placed).toBeGreaterThan(0);
    });
    it('a second press on the same row closes it; another row replaces it', () => {
      open(ROW('A')); expect(H.menuFor()).toBe('__row');
      open(ROW('A')); expect(H.menuFor()).toBe(null);
      open(ROW('A')); open(ROW('B'));
      expect(H.menuFor()).toBe('__row');
      expect(html()).toContain('B');
    });
    it('left alone it closes by itself after 6 s (a locked canvas cannot see a click elsewhere); not while arranging', () => {
      open(ROW('A'));
      vi.advanceTimersByTime(6100);
      expect(H.menuFor()).toBe(null);
      H.setEdit(true);
      open(ROW('A'));
      vi.advanceTimersByTime(60_000);
      expect(H.menuFor()).toBe('__row');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. the dashboard card, and the wiring
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('dashboard.html: the Muted timers card', () => {
  const CARD = sliceBlock(dashHtml, 'function renderMutedTimers(s) {', '\nfunction timerMutePost');
  function card() {
    const el = { html: '' };
    const document = { getElementById: (id) => (id === 'wpMutedTimers' ? el : null) };
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const morphInto = (e, h) => { e.html = h; };
    // eslint-disable-next-line no-new-func
    const run = new Function('document', 'esc', 'morphInto', CARD.replace(/\nfunction timerMutePost$/, '') + '\nreturn renderMutedTimers;')(document, esc, morphInto);
    return { el, run };
  }
  const E = (key, label, detail) => ({ key, kind: 'x', label, detail });

  it('nothing muted: it says how to mute one, and that a mute hides the row only', () => {
    const c = card(); c.run({ timerMutes: { session: [], always: [] } });
    expect(c.el.html).toContain('Muted timers');
    expect(c.el.html).toMatch(/Nothing is muted/);
    expect(c.el.html).toMatch(/hides the row only/);
    expect(c.el.html).not.toContain('<table');
  });
  it('lists every mute — for good first, then this session — each with an unmute that names its key and scope', () => {
    const c = card();
    c.run({ timerMutes: { always: [E('timer:spell:Malosini', 'Malosini', 'spell bar, every mob')], session: [E('timer:trigger:guild:1', 'Stampede', 'trigger countdown')] } });
    const h = c.el.html;
    expect(h.indexOf('Malosini')).toBeLessThan(h.indexOf('Stampede'));
    expect(h).toContain('data-timer-unmute="timer:spell:Malosini" data-scope="always"');
    expect(h).toContain('data-timer-unmute="timer:trigger:guild:1" data-scope="session"');
    expect(h).toContain('>always<'); expect(h).toContain('>this session<');
  });
  it('is byte-stable across polls (same input, same string), and escapes what it was given', () => {
    const c = card(); const st = { timerMutes: { always: [E('timer:spell:<i>', '<i>"x"', 'a & b')], session: [] } };
    c.run(st); const first = c.el.html; c.run(JSON.parse(JSON.stringify(st)));
    expect(c.el.html).toBe(first);
    expect(first).not.toContain('<i>');
    expect(first).toContain('&lt;i&gt;&quot;x&quot;');
  });
  it('a missing timerMutes (an older agent state) renders the empty card, not an error', () => {
    const c = card(); expect(() => c.run({})).not.toThrow();
    expect(c.el.html).toMatch(/Nothing is muted/);
  });
});

describe('wiring (comment-stripped source)', () => {
  const dash = stripJs(dashHtml);
  const agentJs = stripJs(agentSrc);
  const trig = stripJs(triggersHtml);
  const canvas = stripJs(canvasHtml);

  it('the card sits right under Recent fires, in its own wp* placeholder, filled on the same pass', () => {
    expect(dash).toMatch(/id="wpRecentFires" class="card wide"><\/div>';\s*\n\s*h \+= '<div id="wpMutedTimers" class="card wide"><\/div>'/);
    expect(dash).toMatch(/\['recentfires', renderRecentFires\], \['mutedtimers', renderMutedTimers\]/);
  });
  it('its ✕ Unmute is routed by the Triggers section\'s click delegation and posts the unmute', () => {
    expect(dash).toMatch(/closest\('\[data-timer-unmute\]'\)[\s\S]{0,200}timerMutePost\(\{ action: 'unmute', key: tu\.getAttribute\('data-timer-unmute'\), scope: tu\.getAttribute\('data-scope'\) \}\)/);
    expect(dash).toMatch(/fetch\('\/api\/timer-mute', \{ method: 'POST'/);
  });
  it('the agent serves /api/timer-mute, carries the list in /api/state, and rules accept the timer: keys', () => {
    expect(agentJs).toMatch(/'\/api\/timer-mute' && \(req\.method === 'GET' \|\| req\.method === 'POST'\)\) return _handleTimerMute\(req, res\)/);
    expect(agentJs).toMatch(/timerMutes:\s+_timerMutesView\(\)/);
    expect(agentJs).toMatch(/\^\(group\|guild\|personal\|builtin\|timer\):/);
  });
  it('rows are filtered where they are built: the trigger snapshot and the bt| push', () => {
    expect(agentJs).toMatch(/if \(!t\.test && _timerRowMuted\(_row\)\) continue;\s*\n\s*out\.push\(_row\);/);
    expect(agentJs).toMatch(/if \(_builtinTimerHidden\.has\(row\.id\)\) return;\s*\n\s*if \(_timerRowMuted\(row\)\) return;/);
  });
  it('the ⋮ is handled on #timers beside the ✕ and gets the hover handshake; the Canvas dispatches its menu', () => {
    expect(trig).toMatch(/timersEl\.addEventListener\('mousedown', onTimerXPress\)/);
    expect(trig).toMatch(/mn\.setAttribute\('data-wp-interact', ''\)/);
    expect(canvas).toMatch(/if \(_menuFor === ROWMENU\) \{ rowMenuClick\(ev\.target\); return; \}/);
    expect(canvas).toMatch(/window\.wpCanvasRowMenu = function \(info, rect, panelId\)/);
    expect(canvas).toMatch(/menuEl\.addEventListener\('mouseenter', function \(\) \{ clearTimeout\(_rowMenuT\); \}\)/);
  });
});
