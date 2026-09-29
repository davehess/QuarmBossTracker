// test/timers-canvas.test.js — the Timers canvas (option A, 2026-09-29).
//
// The guild lead picked one freeform window for the timers: the callouts, the
// countdown stack and any number of timer panels, each placed and sized alone
// (docs/DECISIONS-2026-09-21.md §77, §79). What must hold:
//   • every countdown lands in exactly one panel — a name claim beats a group
//     claim, a group claim beats the catch-all, and there is always a catch-all;
//   • a panel shows and never speaks — the trigger window stays the one voice;
//   • the screen-sized window stays click-through, unlocked included, and is
//     never arranged or rescued as a rect;
//   • it is reachable from the tray AND the dashboard (the parity rule).
// Routing and layout rules run as real code; the wiring is checked on
// comment-stripped source.
//
// Run: npx vitest run test/timers-canvas.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvas   = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const triggers = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const main     = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload  = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const agent    = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const dash     = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// The canvas's routing + layout rules, run for real.
function canvasRules() {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = {};\n' + block + '\nfunction __set(l){ _layout = l; }',
    ['window', 'sanitize', 'defaultLayout', 'normEffect', '__set']);
}
const T = (effect, group, extra) => Object.assign({ id: effect, effect, group }, extra || {});

describe('routing: every countdown lands in exactly one panel', () => {
  const r = canvasRules();
  const route = r.window.wpCanvasRoute;

  it('the starting layout: charm timers to Charm, everything else to Timers', () => {
    r.__set(r.defaultLayout());
    expect(route(T('Recharm tick', 'charm'))).toBe('charm');
    expect(route(T("Solon's Bewitching Bravura", 'charm'))).toBe('charm');
    expect(route(T('Tashania', 'trigger'))).toBe('timers');
    expect(route(T('Wake of Tranquility', 'lull'))).toBe('timers');
    // An agent that stamps no group (older build): a trigger countdown, or loot by its kind.
    expect(route({ id: 'x', effect: 'Malo' })).toBe('timers');
    expect(route({ id: 'y', effect: 'Bid', kind: 'loot' })).toBe('timers');
  });

  it('a timer pulled out BY NAME leaves its group\'s panel', () => {
    const L = r.defaultLayout();
    L.panels.push({ id: 'tash', kind: 'timers', all: false, groups: [], names: ['tashania'], name: 'Tash' });
    L.panels.push({ id: 'sbb', kind: 'timers', all: false, groups: [], names: ["solon's bewitching bravura"], name: 'SBB' });
    r.__set(L);
    expect(route(T('Tashania', 'trigger'))).toBe('tash');
    // The name claim wins even though the Charm panel claims the whole group.
    expect(route(T("Solon's Bewitching Bravura", 'charm'))).toBe('sbb');
    expect(route(T('Recharm tick', 'charm'))).toBe('charm');
  });

  it('matches the agent\'s marks: "?" unconfirmed, "⏱" on the mob\'s tick, a backtick possessive', () => {
    const L = r.defaultLayout();
    L.panels.push({ id: 'tash', kind: 'timers', all: false, groups: [], names: ['tashania'], name: 'Tash' });
    L.panels.push({ id: 'sbb', kind: 'timers', all: false, groups: [], names: ["solon's bewitching bravura"], name: 'SBB' });
    r.__set(L);
    expect(route(T('Tashania? ⏱', 'spell'))).toBe('tash');
    expect(route(T('Solon`s Bewitching Bravura', 'spell'))).toBe('sbb');
  });

  it('with the catch-all hidden a stray countdown still has a home to go to', () => {
    const L = r.defaultLayout();
    L.panels = L.panels.filter(p => !p.all);          // a hand-edited file lost it
    r.__set(r.sanitize(L));
    expect(route(T('Tashania', 'trigger'))).toBe('timers');
  });
});

describe('layout: always one callouts panel and one catch-all', () => {
  const r = canvasRules();

  it('restores a missing callouts panel and a missing catch-all', () => {
    const s = r.sanitize({ panels: [{ id: 'charm', kind: 'timers', groups: ['charm'], x: 0.1, y: 0.1, w: 300, h: 100 }] });
    expect(s.panels.filter(p => p.kind === 'callouts')).toHaveLength(1);
    expect(s.panels.filter(p => p.all)).toHaveLength(1);
  });

  it('keeps only the first callouts panel and the first catch-all', () => {
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'callouts' }, { id: 'b', kind: 'callouts' },
      { id: 'c', kind: 'timers', all: true }, { id: 'd', kind: 'timers', all: true },
    ] });
    expect(s.panels.map(p => p.id + ':' + p.kind + (p.all ? '*' : ''))).toEqual(['a:callouts', 'c:timers*', 'd:timers']);
  });

  it('drops unknown groups and clamps what the file says', () => {
    const s = r.sanitize({ panels: [{ id: 'x', kind: 'timers', groups: ['charm', 'nonsense'], x: 7, y: -3, w: 5, h: 99999, scale: 9 }] });
    const p = s.panels.find(q => q.id === 'x');
    expect(p.groups).toEqual(['charm']);
    expect([p.x, p.y, p.w, p.h, p.scale]).toEqual([1, 0, 120, 3000, 2.5]);
  });

  it('a garbage file is no layout at all, not a crash', () => {
    expect(r.sanitize(null)).toBeNull();
    expect(r.sanitize({ panels: 'x' })).toBeNull();
  });
});

describe('triggers.html as a canvas part', () => {
  it('shows only the countdowns the canvas routes to its panel', () => {
    const fn = sliceBlock(triggers, '  function _partWants(t){', '\n  }');
    const mk = (PART, route) => new Function('PART', 'PANEL', 'window', fn + '\nreturn _partWants;')(PART, 'charm', { parent: { wpCanvasRoute: route } });
    const toCharm = (t) => (t.group === 'charm' ? 'charm' : 'timers');
    expect(mk('timers', toCharm)({ group: 'charm' })).toBe(true);
    expect(mk('timers', toCharm)({ group: 'trigger' })).toBe(false);
    // Standalone (the trigger window itself) shows everything.
    expect(mk(null, toCharm)({ group: 'trigger' })).toBe(true);
  });

  it('a timers panel keeps its last slot for "+N more"; the trigger window keeps its six', () => {
    const block = sliceBlock(triggers, '  const MAX_TIMER_ROWS = 6;', 'return { visible: loot.concat(shown), hidden: rest.length - shown.length };\n  }');
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'id' + i }));
    const run = (PART) => new Function('PART', '_partRowCap', block + '\nreturn splitVisible;')(PART, () => 4)(rows);
    expect(run('timers')).toEqual({ visible: rows.slice(0, 3), hidden: 7 });
    expect(run(null)).toEqual({ visible: rows.slice(0, 6), hidden: 4 });
  });

  it('never speaks and never plays a sound — the trigger window is the voice', () => {
    const code = stripJs(triggers);
    expect(code).toMatch(/function speak\(text, meta\)\{\s*if \(PART\) return;/);
    expect(code).toMatch(/function playSound\(url\)\{\s*if\(!url \|\| _wpMutedNow\(\)\) return;\s*if \(PART\) return;/);
  });

  it('a timers panel reads no fires and fires no warnings', () => {
    const code = stripJs(triggers);
    expect(code).toMatch(/if \(PART === 'timers'\) return;[^\n]*\n\s*const fires/);
    expect(code).toMatch(/if \(PART !== 'timers' && n\.warnings && n\.warnings\.length\)\{/);
    expect(code).toMatch(/\(async function waitFires\(\)\{\s*if \(PART === 'timers'\) return;/);
  });

  it('the voice window, while the canvas shows the visuals, speaks without flashing or pinning', () => {
    const cut = (start) => { const i = triggers.indexOf(start); const j = triggers.indexOf('\n  }', i); return triggers.slice(i, j + 4); };
    const h = new Function(`
      const calls = []; var PART = null, _visualElsewhere = false;
      function flash(){ calls.push('flash'); } function speak(){ calls.push('speak'); }
      function playSound(){} function showFeedback(){ calls.push('votes'); } function pinSticky(){ calls.push('pin'); }
      function _speakable(s){ return s; }
      ${cut('  let alertsEnabled = true;')}
      ${cut('  function fire(t){')}
      return { calls, applyTtsStatus, fire };
    `)();
    h.applyTtsStatus({ enableTriggerTts: true, canvasOwnsTriggers: true });
    h.fire({ text: 'Death Touch on the tank', sticky: true });
    expect(h.calls).toEqual(['speak']);
    h.calls.length = 0;
    h.applyTtsStatus({ enableTriggerTts: true, canvasOwnsTriggers: false });
    h.fire({ text: 'Death Touch on the tank', sticky: true });
    expect(h.calls).toEqual(['flash', 'speak', 'votes', 'pin']);
  });

  it('a part polls the slim /api/timers and falls back to /api/state on an older agent', () => {
    const code = stripJs(triggers);
    expect(code).toMatch(/\(_partSlim \? '\/api\/timers' : '\/api\/state'\)/);
    expect(code).toMatch(/if \(_partSlim && r\.status === 404\)\{\s*_partSlim = false;/);
  });
});

describe('the agent side', () => {
  const code = stripJs(agent);
  it('serves the three fields a part needs at /api/timers', () => {
    const route = sliceBlock(code, "if (req.url === '/api/timers' && req.method === 'GET') {", '}));');
    expect(route).toContain('activeTimers:       _activeTimersSnapshot()');
    expect(route).toContain('recentTriggerFires: _activeOverlays.map(_fireForWeb)');
    expect(route).toContain('blindEvents:        _blindEvents.slice(-20)');
  });
  it('stamps the group a panel claims on every timer row', () => {
    expect(code).toMatch(/effect: 'Recharm tick'[\s\S]{0,200}group: 'charm' \}\);/);
    expect(code).toMatch(/effect: 'Server tick',[\s\S]{0,200}group: 'tick' \}\);/);
    expect(code).toMatch(/const group = CHARM_SPELLS\.has\(String\(b\.name \|\| ''\)\.toLowerCase\(\)\) \? 'charm'\s*: _isPacifySpell\(b\.name\) \? 'lull' : 'spell';/);
    expect(code).toMatch(/group:\s+t\.kind === 'loot' \? 'loot' : 'trigger',/);
  });
});

describe('Mimic wiring (the overlay checklist)', () => {
  const m = stripJs(main);
  it('stays click-through while unlocked, and back to click-through on hover-out', () => {
    const inter = sliceBlock(m, 'function applyOverlayInteractivity() {', '\n}');
    expect(inter).toMatch(/if \(key === 'canvas'\) \{\s*win\.setIgnoreMouseEvents\(true, \{ forward: true \}\);\s*\} else if \(locked\)/);
    expect(m).toMatch(/if \(win === canvasWindow\) \{ win\.setIgnoreMouseEvents\(true, \{ forward: true \}\); return true; \}/);
  });
  it('is never parked or packed as a rect', () => {
    expect(sliceBlock(m, 'function _rescueOverlays() {', '\n}')).toMatch(/if \(key === 'canvas'\) continue;/);
    expect(sliceBlock(m, 'function _autoArrangeOverlays(pinnedKey) {', '.sort(')).toMatch(/if \(k === 'canvas'\) return false;/);
  });
  it('hides the trigger overlay\'s visuals while it is on (the window stays, as the voice)', () => {
    const fn = sliceBlock(m, 'function applyTriggerVisibility() {', '\n}');
    expect(fn).toMatch(/if \(cfg\.showCanvas\) \{ triggerWindow\.hide\(\); return; \}/);
    expect(m).toContain('canvasOwnsTriggers: !!cfg.showCanvas,');
  });
  it('has its ✕ branch, hide-all flag, entries, toggle case and hotkey key', () => {
    expect(m).toContain('} else if (win === canvasWindow) {');
    expect(sliceBlock(m, 'const _HIDEALL_FLAGS = [', '\n];')).toContain("'showCanvas'");
    expect(m).toContain("if (canvasWindow && !canvasWindow.isDestroyed()) out.push(['canvas', canvasWindow]);");
    expect(sliceBlock(m, 'function _toggleOverlay(name) {', '\n}\n')).toContain("case 'canvas':");
    expect(m).toMatch(/const _OVERLAY_HOTKEY_KEYS = \[[^\]]*'canvas'\]/);
    expect(m).toContain("function applyCanvasVisibility() {");
    expect(sliceBlock(m, 'function applyAllVisibility() {', '\n}')).toContain('applyCanvasVisibility();');
  });
  it('the panels get window.mimic (subframe preload), and only the canvas saves its layout', () => {
    expect(sliceBlock(m, 'function createCanvasWindow() {', '\n}')).toContain('nodeIntegrationInSubFrames: true');
    const save = sliceBlock(m, "ipcMain.handle('canvas-save', (e, layout) => {", '\n});');
    expect(save).toMatch(/BrowserWindow\.fromWebContents\(e\.sender\) !== canvasWindow\) return false;/);
    expect(save).toMatch(/layout\.panels\.length > 160\) return false;/);
    expect(save).toMatch(/json\.length > 256_000\) return false;/);
  });
  // The guild lead, 2026-09-29: "they do not have a move button on them which
  // should be there at all times". The ✥ is the one part of a locked panel
  // that takes the mouse; the rest stays click-through.
  it('every panel has a ✥ that moves it any time, and nothing else of a locked panel takes the mouse', () => {
    const c = stripJs(canvas);
    expect(c).toMatch(/mv\.className = 'mvbtn';\s*mv\.textContent = '✥';\s*mv\.setAttribute\('data-wp-interact', ''\);/);
    expect(c).toMatch(/if \(ev\.target === mv\) \{ startDrag\(ev, p\.id, 'move', true\); return; \}/);
    expect(c).toMatch(/if \(\(!_edit && !anyTime\) \|\| ev\.button !== 0\) return;/);
    expect(c).toMatch(/if \(_edit\) e\.root\.setAttribute\('data-wp-interact', ''\); else e\.root\.removeAttribute\('data-wp-interact'\);/);
    expect(c).toMatch(/\.mvbtn\{position:absolute;/);
    expect(c).toContain('.tab,.grip{display:none}');
    expect(c).toContain('body.edit .mvbtn{display:none}');
    expect(c).toMatch(/if \(_edit \|\| ev\.target === mv\) openMenu\(p\.id, ev\.target === mv \? mv : root\);/);
    expect(c).toMatch(/menuEl\.addEventListener\('mouseleave', function \(\) \{ if \(!_edit\) closeMenu\(\); \}\);/);
  });
  it('the canvas page counts as an overlay for the hover handshake', () => {
    expect(stripJs(preload)).toContain("_wpIsOverlayDoc = !!document.getElementById('move-btn') || document.body.hasAttribute('data-wp-overlay');");
    expect(canvas).toContain('<body data-wp-overlay>');
  });
});

// The guild lead, 2026-09-29, on a panel's settings view: "This view could go off the screen. give me a
// button to show test data there of each type that's selected there".
describe('🧪 test rows, and a settings view that stays on screen', () => {
  const partSamples = (names) => {
    const block = sliceBlock(triggers, '  var _SAMPLE_TIMERS = [', "  window.wpPartFlash = function(text){ if (PART) flash(text); };");
    return new Function('PANEL', 'window', block + '\nreturn _sampleTimers;')('p1', { parent: { wpCanvasPanelNames: (id) => (id === 'p1' ? names : []) } })();
  };
  const canvasGroups = () => new Function(sliceBlock(canvas, '  var GROUPS = [', '\n  ];') + '\nreturn GROUPS;')().map(g => g[0]);

  it('a sample of every kind a panel can show — every canvas group — marked TEST', () => {
    const rows = partSamples([]);
    const groups = new Set(rows.map(r => r.group));
    for (const g of canvasGroups()) expect(groups.has(g), 'no sample for ' + g).toBe(true);
    expect(rows.every(r => r.test === true)).toBe(true);
    expect(rows.find(r => r.group === 'loot').kind).toBe('loot');
  });

  it('and one for each timer the panel claims by name, not doubling one it already has', () => {
    const rows = partSamples(['tashania', 'malo']);
    expect(rows.filter(r => String(r.effect).toLowerCase() === 'tashania')).toHaveLength(1);
    expect(rows.find(r => r.id === 'sample|name|malo')).toMatchObject({ effect: 'malo', group: 'trigger', test: true });
  });

  it('the button turns one panel\'s samples on, locked or not, for 30 seconds; a callouts panel shows one callout', () => {
    const c = stripJs(canvas);
    expect(c).toContain("if (w && typeof w.wpPartSample === 'function') w.wpPartSample(_edit || _isTesting(p.id));");
    expect(c).toContain('var TEST_MS = 30000;');
    expect(c).toMatch(/setTesting\(p\.id, !_isTesting\(p\.id\)\);/);
    expect(c).toMatch(/cw\.wpPartFlash\('TEST — Death Touch on the main tank'\)/);
    expect(c).toContain("window.wpCanvasPanelNames = function (id) { var p = panelById(id); return p ? p.names.slice() : []; };");
  });

  const placeMenu = ({ W = 1920, H = 1080, anchor, menuH, menuW = 280 }) => {
    const style = {};
    const menuEl = { classList: { contains: () => true }, style, getBoundingClientRect: () => ({ width: menuW, height: Math.min(menuH, parseInt(style.maxHeight || '99999', 10)) }) };
    const fn = new Function('_menuAnchor', 'menuEl', 'window', sliceBlock(canvas, '  function placeMenu() {', '\n  }') + '\nreturn placeMenu;');
    fn({ getBoundingClientRect: () => anchor }, menuEl, { innerWidth: W, innerHeight: H })();
    return { top: parseInt(style.top, 10), left: parseInt(style.left, 10), height: menuEl.getBoundingClientRect().height, maxHeight: parseInt(style.maxHeight, 10) };
  };
  const whole = (m, H = 1080) => m.top >= 8 && m.top + m.height <= H - 8;

  it('opens under the ✥ when it fits, above it when it does not, and is always whole on the screen', () => {
    const under = placeMenu({ anchor: { left: 0, top: 0, right: 16, bottom: 16 }, menuH: 400 });
    expect(under.top).toBe(22);
    const above = placeMenu({ anchor: { left: 900, top: 900, right: 916, bottom: 916 }, menuH: 400 });
    expect(above.top).toBe(900 - 400 - 6);
    const tall = placeMenu({ anchor: { left: 1900, top: 500, right: 1916, bottom: 516 }, menuH: 900 });
    expect(whole(tall), JSON.stringify(tall)).toBe(true);
    expect(tall.left).toBe(1920 - 280 - 8);
    const taller = placeMenu({ anchor: { left: 100, top: 500, right: 116, bottom: 516 }, menuH: 5000 });
    expect(taller.maxHeight).toBe(1080 - 16);
    expect(whole(taller)).toBe(true);
  });

  it('is placed again once the live list fills in, and opened from ✥ it anchors to the ✥', () => {
    const c = stripJs(canvas);
    expect(c).toMatch(/box\.innerHTML = h \|\| '<span class="dim">no countdowns right now<\/span>';\s*placeMenu\(\);/);
    expect(c).toContain("openMenu(p.id, ev.target === mv ? mv : root);");
  });
});

describe('tray ↔ dashboard parity', () => {
  it('the tray has the switch and Arrange; the dashboard has the row and Arrange, on the same internals', () => {
    const m = stripJs(main);
    expect(m).toMatch(/label: 'Timers canvas \(callouts, timers and any overlay, placed anywhere\)'[\s\S]{0,200}_toggleOverlay\('canvas'\);/);
    expect(m).toMatch(/'  ↳ Arrange the canvas…'[\s\S]{0,160}_setCanvasArrange\(!_canvasArrange\);/);
    expect(dash).toMatch(/\['canvas',\s+'Timers canvas',\s+'<button type="button" class="wp-ov-act" data-act="canvasArrange"/);
    expect(stripJs(dash)).toMatch(/if \(a === 'canvasArrange' && window\.mimic\.canvasEdit\) \{\s*window\.mimic\.canvasEdit\(true\)/);
  });
});

// The guild lead, 2026-09-29: "background on the timer canvas just makes the whole screen dark".
describe('Background on the Timers canvas', () => {
  const pre = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
  const cv = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
  it('plates each panel, never the screen-sized body', () => {
    expect(pre).toMatch(/body\.wp-backdrop:not\(:has\(#wrap\)\):not\(:has\(#screenBtn\)\)\{background:/);
    expect(pre).toMatch(/body\.wp-backdrop:has\(#screenBtn\) #panels > \.panel:not\(\.off\)\{background:/);
    // The marker is the canvas's alone.
    expect(cv).toMatch(/id="screenBtn"/);
    const fs = require('node:fs');
    const others = fs.readdirSync(path.join(ROOT, 'apps', 'mimic')).filter(f => f.endsWith('.html') && f !== 'canvas.html')
      .filter(f => /id="screenBtn"/.test(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', f), 'utf8')));
    expect(others).toEqual([]);
  });
});
