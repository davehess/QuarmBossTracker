// test/dashboard-voice-fights-buffs-tabs.test.js — the 2026-10-17 dashboard reshuffle.
//
// The guild lead: "All of the voice things are getting to be that they need their own tab …
// Replay should be on the fights tab. Buff blocks can be on the buffs tab. make it Buffs (and
// blocking). Minimize the kill switches so people don't accidentally hit them."
//
// What this pins, by running the real render functions out of dashboard.html (the authoring
// source; WEB_HTML is its byte-checked fold) rather than matching comment text:
//   - a 🗣 Voice tab after ⚡ Triggers that owns every voice card mount, and Triggers owns none;
//   - the ⏪ Replay card renders into the Fights tab, with the ids its handlers and the
//     #replay deep-link look up;
//   - no Buff blocks tab button: the picker sits inside #buffs, the tab is "Buffs (and blocking)";
//   - the 🛑 kill-switch card is one closed <details> (wpKeep) and a flip asks first.
//
// Run: npx vitest run test/dashboard-voice-fights-buffs-tabs.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');

// Run one render function and hand back what it wrote into which section.
function runRender(startMarker, endMarker, fnName, stubs, state) {
  const writes = {};
  const setSectionHTML = (id, h) => { writes[id] = h; return true; };
  const body = sliceBlock(html, startMarker, endMarker).replace(/\n[^\n]*$/, '');
  const names = ['esc', 'setSectionHTML', 'wpPartitionChars', 'wpLowToggleHtml', 'window', ...Object.keys(stubs || {})];
  const vals = [
    (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    setSectionHTML,
    (list) => ({ shown: list, unknown: [], tucked: [] }),
    () => '',
    {},
    ...Object.values(stubs || {}),
  ];
  const fn = new Function(...names, `${body}\nreturn ${fnName};`)(...vals);
  fn(state);
  return writes;
}

const VOICE_MOUNTS = ['id="wpVoice"', 'id="wpTrigRules"', 'id="wpSounds"', 'id="calloutAllow"', 'id="lootAucTts"', 'id="lootAucDur"'];

describe('the 🗣 Voice tab', () => {
  const nav = html.slice(html.indexOf('<div class="nav">'), html.indexOf('<div id="wpPanelMenu"'));

  it('has a rail button right after ⚡ Triggers and a section to show', () => {
    expect(nav).toContain('<button data-tab="voice">🗣 Voice</button>');
    expect(nav.indexOf('data-tab="voice"')).toBeGreaterThan(nav.indexOf('data-tab="triggers"'));
    expect(html).toContain('<div id="voice" class="section"></div>');
  });

  it('is painted by renderVoice, which the render loop runs', () => {
    expect(stripJs(html)).toMatch(/\['voice', renderVoice\]/);
  });

  it('renders every voice card mount into #voice', () => {
    const w = runRender('function renderVoice(s) {', '\nfunction renderTriggers(s) {', 'renderVoice', {}, {});
    expect(Object.keys(w)).toEqual(['voice']);
    for (const m of VOICE_MOUNTS) expect(w.voice, `Voice should carry ${m}`).toContain(m);
  });

  it('keeps the saved toggle values: loot speech and the allow-list default to on', () => {
    const w = runRender('function renderVoice(s) {', '\nfunction renderTriggers(s) {', 'renderVoice', {}, { lootAuctionTts: false, calloutAllowlist: false, lootAuctionDefaultSec: 90 });
    expect(w.voice).not.toMatch(/id="lootAucTts" checked/);
    expect(w.voice).not.toMatch(/id="calloutAllow" checked/);
    expect(w.voice).toContain('value="90"');
    const on = runRender('function renderVoice(s) {', '\nfunction renderTriggers(s) {', 'renderVoice', {}, {});
    expect(on.voice).toMatch(/id="lootAucTts" checked/);
    expect(on.voice).toMatch(/id="calloutAllow" checked/);
  });

  it('is no longer on the Triggers tab', () => {
    const w = runRender('function renderTriggers(s) {', '\n// 🛡️ Guild triggers (FB-30)', 'renderTriggers', {}, {});
    expect(w.triggers).toContain('id="trigPersonalList"');   // the real Triggers content is still there
    expect(w.triggers).toContain('Timing votes');
    for (const m of [...VOICE_MOUNTS, '<h2>⏪ Replay']) expect(w.triggers, `Triggers should not carry ${m}`).not.toContain(m);
  });

  it('binds the loot / allow-list change handler to #voice, not only #triggers', () => {
    expect(stripJs(html)).toMatch(/\[section, document\.getElementById\('voice'\)\]\.forEach\(function\(host\)\{\s*if \(host && !host\._wpTrigChangeBound\) \{ host\.addEventListener\('change', onSectionChange\)/);
  });
});

describe('the ⏪ Replay card on the ⚔️ Fights tab', () => {
  const logs = { watchedLogs: [{ character: 'Aldenmar', logPath: 'C:/eq/eqlog_Aldenmar_pq.proj.txt' }] };

  it('lives inside #fights, after the tanks and deeps targets', () => {
    const fights = sliceBlock(html, '<div id="fights" class="section">', '</div>\n<div id="myparses"');
    expect(fights).toContain('<div id="fightsReplay"></div>');
    expect(fights.indexOf('id="fightsReplay"')).toBeGreaterThan(fights.indexOf('id="deeps"'));
    expect(stripJs(html)).toMatch(/\['fightsReplay', renderReplayCard\]/);
  });

  it('renders the form into #fightsReplay with the ids its handlers look up', () => {
    const w = runRender('function renderReplayCard(s) {', '\n// 🗣 Voice tab', 'renderReplayCard', {}, logs);
    expect(Object.keys(w)).toEqual(['fightsReplay']);
    for (const m of ['<h2>⏪ Replay', 'id="replayLog"', 'id="replayFrom"', 'id="replayTo"', 'id="replayStartBtn"', 'id="replayMsg"', 'id="wpReplayStatus"']) {
      expect(w.fightsReplay, `Replay should carry ${m}`).toContain(m);
    }
  });

  it('routes Start / Stop clicks from #fights, and #replay opens the Fights tab', () => {
    const src = stripJs(html);
    expect(src).toMatch(/\[section, document\.getElementById\('fights'\)\]\.forEach\(function\(host\)\{\s*if \(host && !host\._wpTrigClickBound\) \{ host\.addEventListener\('click', onSectionClick\)/);
    const deepLink = sliceBlock(src, "if (hash.indexOf('#replay') !== 0) return;", '_wpApplyReplayPrefill(0);');
    expect(deepLink).toContain('data-tab="fights"');
    expect(deepLink).not.toContain('data-tab="triggers"');
  });
});

describe('✨ Buffs (and blocking)', () => {
  const nav = html.slice(html.indexOf('<div class="nav">'), html.indexOf('<div id="wpPanelMenu"'));

  it('has no Buff blocks tab button or section', () => {
    expect(nav).not.toContain('data-tab="buffblocks"');
    expect(html).not.toContain('<div id="buffblocks" class="section"');
  });

  it('renames the Buffs tab and keeps the picker inside it', () => {
    expect(nav).toContain('<button data-tab="buffs">✨ Buffs (and blocking)</button>');
    const buffs = sliceBlock(html, '<div id="buffs" class="section">', '</div>\n<!-- Fights');
    expect(buffs).toContain('<div id="buffsMain"></div>');
    expect(buffs).toContain('<div id="buffblocks"></div>');
  });

  it('sends an old #buffblocks link to the Buffs tab', () => {
    const go = sliceBlock(stripJs(html), "!== '#buffblocks') return;", "history.replaceState");
    expect(go).toContain('data-tab="buffs"');
  });
});

describe('🛑 Kill switches', () => {
  const stubs = () => {
    const calls = { fetch: [], confirms: [] };
    const sec = { style: { display: '' }, innerHTML: '' };
    let handler = null;
    const doc = {
      getElementById: (id) => (id === 'wpKillSwitches' ? sec : null),
      addEventListener: (type, fn) => { if (type === 'click') handler = fn; },
    };
    return { calls, sec, doc, get handler() { return handler; } };
  };
  const load = (answer = true) => {
    const st = stubs();
    const body = sliceBlock(html, 'var WP_KILL_FLAGS = [', '\n}, true);');
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const morphInto = (el, h) => { el.innerHTML = h; return true; };
    const wpKeep = (key) => 'data-keep="' + key + '"';
    const fetchStub = (url, opt) => { st.calls.fetch.push(JSON.parse(opt.body)); return new Promise(() => {}); };
    const confirmStub = (msg) => { st.calls.confirms.push(msg); return answer; };
    // The block is the flag table, the card renderer and the delegated click handler (registered on the
    // stub document), so what runs here is the shipped code.
    const mk = new Function('document', 'esc', 'morphInto', 'wpKeep', 'fetch', 'confirm', `${body}\nreturn { renderKillSwitches };`);
    return { st, api: mk(st.doc, esc, morphInto, wpKeep, fetchStub, confirmStub) };
  };
  const officer = { mimicIdentity: { is_officer: true }, overlayTuning: {} };

  it('is one closed <details> with a wpKeep key, summary first', () => {
    const { st, api } = load();
    api.renderKillSwitches(officer);
    const h = st.sec.innerHTML;
    expect(h.startsWith('<details data-keep="admin-killswitches"><summary')).toBe(true);
    expect(h.startsWith('<details data-keep="admin-killswitches" open')).toBe(false);
    expect(h).toContain('Kill switches (emergency only)');
    expect(h.endsWith('</details>')).toBe(true);
    // every toggle sits inside the one details, none outside it
    const closeAt = h.indexOf('</details>');
    expect(closeAt).toBe(h.length - '</details>'.length);
    expect(h.indexOf('wpKillToggle')).toBeGreaterThan(h.indexOf('</summary>'));
  });

  it('stays hidden for a non-officer', () => {
    const { st, api } = load();
    api.renderKillSwitches({ mimicIdentity: { is_officer: false } });
    expect(st.sec.style.display).toBe('none');
    expect(st.sec.innerHTML).toBe('');
  });

  it('asks before a flip and writes nothing on No', () => {
    const { st, api } = load(false);
    void api;
    const click = st.handler;
    expect(typeof click).toBe('function');
    const btn = { getAttribute: (n) => ({ 'data-key': 'flag_shed_pvp', 'data-next': '1' })[n] };
    click({ target: { closest: (sel) => (sel === '.wpKillToggle' ? btn : null) } });
    expect(st.calls.confirms).toHaveLength(1);
    expect(st.calls.confirms[0]).toContain('Turn ON');
    expect(st.calls.fetch).toEqual([]);
  });

  it('writes the flip when confirmed', () => {
    const { st } = load(true);
    const btn = { getAttribute: (n) => ({ 'data-key': 'flag_shed_pvp', 'data-next': '1' })[n] };
    st.handler({ target: { closest: (sel) => (sel === '.wpKillToggle' ? btn : null) } });
    expect(st.calls.fetch).toEqual([{ key: 'flag_shed_pvp', value: 1 }]);
  });
});
