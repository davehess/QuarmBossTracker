// test/mimic-agent-only-mode.test.js — "Agent only" run mode (cfg.runMode).
//
// The guild lead, 2026-10-08: "update the installer to have agent only mode and a way to update it to
// have full mimic, and vice versa", then picked option A — a MODE inside one install, no reinstall.
// Agent only keeps the log uploads, the tray, the dashboard and the SPOKEN trigger callouts (the hidden
// trigger window is the voice); it drops every visible overlay window. The mode is read off disk before
// any window exists and is fixed for the run; changing it saves the choice and offers a restart, like
// the graphics-card switch (test/mimic-software-drawing.test.js).
//
// What is pinned: the startup read; that EVERY overlay creator is gated (a new one that forgets fails
// here) while the trigger window is not; the central helpers (_overlayWanted, _overlayEntries,
// applyTriggerVisibility, hide-all); the setter; and that the tray, IPC, preload, Settings, dashboard
// and setup walk all drive that one setter.
//
// Run: npx vitest run test/mimic-agent-only-mode.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const MAIN = readSource(path.join(MIMIC, 'main.js'));
const PRELOAD = readSource(path.join(MIMIC, 'preload.js'));
const SETTINGS = readSource(path.join(MIMIC, 'settings.html'));
const WELCOME = readSource(path.join(MIMIC, 'welcome.html'));
const DASH = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const MAIN_CODE = stripJs(MAIN);

// Every top-level function in main.js, as { name, body } (a top-level function ends at "\n}\n").
function functions(src) {
  const out = [];
  const re = /^function (\w+)\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('\n}\n', m.index);
    out.push({ name: m[1], body: src.slice(m.index, end + 3) });
  }
  return out;
}
const FUNCS = functions(MAIN_CODE);
const fn = (name) => FUNCS.find((f) => f.name === name);
const GUARD = /^function \w+\([^)]*\) \{\n\s*if \(_agentOnly\(\)\) return(?: false)?;/;

describe('the mode is read off disk before any window exists', () => {
  const block = sliceBlock(MAIN, 'const _runModeAtStart = ', "function _agentOnly() { return _runModeAtStart === 'agent'; }");
  function load(raw) {
    globalThis.__rawForTest = raw;
    const r = evalBlock(`
      const _readConfigRaw = () => { const v = globalThis.__rawForTest; if (v instanceof Error) throw v; return v; };
      ${block}
    `, ['_runModeAtStart', '_agentOnly']);
    delete globalThis.__rawForTest;
    return r;
  }
  it("runMode: 'agent' starts agent only", () => {
    const r = load({ runMode: 'agent' });
    expect(r._runModeAtStart).toBe('agent');
    expect(r._agentOnly()).toBe(true);
  });
  it('full Mimic for full, missing, unrelated, wrongly cased and torn config', () => {
    for (const raw of [{ runMode: 'full' }, {}, null, { runMode: 'AGENT' }, { runMode: true }, new Error('torn')]) {
      const r = load(raw);
      expect(r._runModeAtStart).toBe('full');
      expect(r._agentOnly()).toBe(false);
    }
  });
  it('is read at module load, before app.whenReady(), and the default config is full', () => {
    expect(MAIN_CODE.indexOf('const _runModeAtStart')).toBeGreaterThan(-1);
    expect(MAIN_CODE.indexOf('const _runModeAtStart')).toBeLessThan(MAIN_CODE.indexOf('app.whenReady()'));
    expect(stripJs(sliceBlock(MAIN, 'function defaultConfig()', '\n}\n'))).toMatch(/runMode:\s*'full'/);
  });
});

describe('no overlay window can be created in agent only — the trigger window can', () => {
  const creators = FUNCS.filter((f) => /new BrowserWindow\(/.test(f.body));
  it('finds the windows it expects (so a rename cannot empty the loop below)', () => {
    expect(creators.map((f) => f.name)).toEqual(expect.arrayContaining([
      'createMainWindow', 'createPanelOverlay', 'createOverlayWindow', 'createTriggerOverlay', 'createCanvasWindow',
      'createCharmOverlay', 'createPetsOverlay', 'createBuffQueueOverlay', 'createPopRaidOverlay', 'createMeOverlay',
      'createMobInfoOverlay', 'createWhoOverlay', 'createMelodyOverlay', 'createZealHealthOverlay', 'createTankOverlay',
      'createThreatMeterOverlay', 'createExtTargetOverlay', 'createCommandOverlay', 'createChChainOverlay',
      'createDockWindow', 'openSettings', 'openResources', 'openUiStudio']));
  });
  // Windows that are not overlays: the dashboard, Settings, Resource use, UI Studio. Anything else that
  // opens a BrowserWindow is an overlay (or a new kind of window) and must decide.
  const NOT_OVERLAYS = ['createMainWindow', 'openSettings', 'openResources', 'openUiStudio', 'createTriggerOverlay'];
  it('every other window creator opens with the agent-only guard', () => {
    for (const f of creators) {
      if (NOT_OVERLAYS.includes(f.name)) continue;
      expect(f.body, `${f.name} must start with: if (_agentOnly()) return;`).toMatch(GUARD);
    }
  });
  it('the trigger window (the voice) is NOT guarded, and neither is the dashboard', () => {
    expect(fn('createTriggerOverlay').body).not.toMatch(/_agentOnly/);
    expect(fn('createMainWindow').body).not.toMatch(/_agentOnly/);
  });

  // Behaviour: run the real creators against a counting BrowserWindow.
  function run(name, agent) {
    globalThis.__agent = agent;
    const r = evalBlock(`
      let CREATED = 0;
      class BrowserWindow { constructor() { CREATED++; return new Proxy({}, { get: (t, k) => k === 'webContents' ? { send() {} } : () => {} }); } }
      let triggerWindow = null, charmWindow = null;
      const _agentOnly = () => globalThis.__agent;
      const _resolveBounds = () => ({ x: 0, y: 0, width: 300, height: 100 });
      const _wpPrefs = () => ({});
      const _persistBounds = () => {};
      const _OVERLAY_MIN_W = 200;
      let agentPort = 1;
      const panelOverlays = new Map();
      ${fn(name).body}
      ${name}();
    `, ['CREATED']);
    delete globalThis.__agent;
    return r.CREATED;
  }
  it('createCharmOverlay builds a window in full Mimic and none in agent only', () => {
    expect(run('createCharmOverlay', false)).toBe(1);
    expect(run('createCharmOverlay', true)).toBe(0);
  });
  it('createTriggerOverlay builds its window in BOTH modes', () => {
    expect(run('createTriggerOverlay', false)).toBe(1);
    expect(run('createTriggerOverlay', true)).toBe(1);
  });
  it('a panel pop-out returns false and builds nothing in agent only', () => {
    globalThis.__agent = true;
    const r = evalBlock(`
      let CREATED = 0;
      class BrowserWindow { constructor() { CREATED++; } }
      const _agentOnly = () => globalThis.__agent;
      ${fn('createPanelOverlay').body}
      const out = createPanelOverlay('deeps');
    `, ['CREATED', 'out']);
    delete globalThis.__agent;
    expect(r.out).toBe(false);
    expect(r.CREATED).toBe(0);
  });
});

describe('the central helpers', () => {
  const FLAGS = { dock: 'showDock', hud: 'showHud', trigger: 'enableTriggerTts', charm: 'showCharm', me: 'showMe', canvas: 'showCanvas' };
  function wanted(agent, cfg, extra = {}) {
    globalThis.__agent = agent; globalThis.__extra = extra;
    const r = evalBlock(`
      const _agentOnly = () => globalThis.__agent;
      const setupMode = !!globalThis.__extra.setup, _canvasArrange = false;
      const _eqGateOk = () => true;
      const _overlayForcedOn = () => !!globalThis.__extra.forced;
      ${sliceBlock(MAIN, 'function _overlayWanted(cfg, e) {', '\n}\n')}
    `, ['_overlayWanted']);
    const out = {};
    for (const [key, flag] of Object.entries(FLAGS)) out[key] = r._overlayWanted(cfg, { key, flag });
    delete globalThis.__agent; delete globalThis.__extra;
    return out;
  }
  const ALL_ON = { showDock: true, showHud: true, enableTriggerTts: true, showCharm: true, showMe: true, showCanvas: true };
  it('agent only: every overlay is unwanted (so freed and never built), whatever its flag or setup/unlock says', () => {
    expect(wanted(true, ALL_ON, { setup: true, forced: true })).toEqual({ dock: false, hud: false, trigger: true, charm: false, me: false, canvas: false });
  });
  it('agent only: the trigger window is wanted exactly while spoken callouts are on', () => {
    expect(wanted(true, { enableTriggerTts: false }, { forced: true }).trigger).toBe(false);
    expect(wanted(true, { enableTriggerTts: true }).trigger).toBe(true);
  });
  it('full Mimic is unchanged: a switched-on overlay is wanted', () => {
    const w = wanted(false, ALL_ON);
    expect(w.hud).toBe(true);
    expect(w.charm).toBe(true);
    expect(w.canvas).toBe(true);
    expect(wanted(false, {}).hud).toBe(false);
  });

  it('_overlayEntries is empty in agent only even with windows alive, and lists them in full Mimic', () => {
    const names = ['dockWindow', 'overlayWindow', 'triggerWindow', 'charmWindow', 'petsWindow', 'mobInfoWindow', 'buffQueueWindow',
      'whoWindow', 'melodyWindow', 'zealWindow', 'threatWindow', 'chChainWindow', 'tankWindow', 'extTargetWindow', 'commandWindow',
      'popRaidWindow', 'meWindow', 'canvasWindow'];
    const entries = (agent) => {
      globalThis.__agent = agent;
      const r = evalBlock(`
        const _agentOnly = () => globalThis.__agent;
        ${names.map((n) => `const ${n} = { isDestroyed: () => false };`).join('\n')}
        const panelOverlays = new Map();
        ${sliceBlock(MAIN, 'function _overlayEntries() {', '\n}\n')}
      `, ['_overlayEntries']);
      const out = r._overlayEntries();
      delete globalThis.__agent;
      return out;
    };
    expect(entries(true)).toEqual([]);
    expect(entries(false).map(([k]) => k)).toContain('trigger');
    expect(entries(false)).toHaveLength(names.length);
  });

  it('the trigger window stays hidden in agent only even when unlocked / in setup; full Mimic still shows it', () => {
    const run = (agent) => {
      globalThis.__agent = agent;
      const r = evalBlock(`
        const CALLS = [];
        const triggerWindow = { hide: () => CALLS.push('hide'), showInactive: () => CALLS.push('show') };
        const _live = () => true;
        const _agentOnly = () => globalThis.__agent;
        const setupMode = true;
        const _blindForceOpen = () => false, _eqGateOk = () => true;
        const loadConfig = () => ({ enableTriggerTts: true, showTriggerOverlay: true, overlaysLocked: false });
        ${sliceBlock(MAIN, 'function applyTriggerVisibility() {', '\n}\n')}
        applyTriggerVisibility();
      `, ['CALLS']);
      delete globalThis.__agent;
      return r.CALLS;
    };
    expect(run(true)).toEqual(['hide']);
    expect(run(false)).toEqual(['show']);
  });

  it('hide-all does nothing in agent only: it must not rewrite the saved overlay flags', () => {
    globalThis.__agent = true;
    const r = evalBlock(`
      let loaded = 0;
      const _agentOnly = () => globalThis.__agent;
      const loadConfig = () => { loaded++; return {}; };
      ${sliceBlock(MAIN, 'function toggleHideAllOverlays() {', '\n}\n')}
      const out = toggleHideAllOverlays();
    `, ['loaded', 'out']);
    delete globalThis.__agent;
    expect(r.loaded).toBe(0);
    expect(r.out).toBeUndefined();
  });

  it('display changes do not ask about overlays in agent only', () => {
    expect(fn('_onDisplaysChanged').body).toMatch(/^function _onDisplaysChanged\(\) \{\n\s*if \(_agentOnly\(\)\) return;/);
  });
});

describe('the setter saves the mode and offers a restart only when it changes what this run started with', () => {
  const block = sliceBlock(MAIN, 'function _setRunMode(mode, ask) {', '\n}\n');
  function load(startedAs) {
    globalThis.__runT = { startedAs };
    const r = evalBlock(`
      const T = globalThis.__runT;
      const _runModeAtStart = T.startedAs;
      const log = { saved: null, dialog: 0, relaunch: 0, quit: 0, status: 0, tray: 0 };
      const loadConfig = () => ({ other: 1 });
      const saveConfig = (c) => { log.saved = c; };
      const dialog = { showMessageBox: () => { log.dialog++; return Promise.resolve({ response: 0 }); } };
      const app = { relaunch: () => { log.relaunch++; } };
      const _quitMimic = () => { log.quit++; };
      const pushStatus = () => { log.status++; };
      const buildTrayMenu = () => { log.tray++; };
      ${block}
    `, ['_setRunMode', 'log']);
    delete globalThis.__runT;
    return r;
  }
  it('choosing agent only from full saves runMode: agent and asks for a restart', () => {
    const r = load('full');
    expect(r._setRunMode('agent', true)).toEqual({ ok: true, runMode: 'agent', restartNeeded: true });
    expect(r.log.saved).toEqual({ other: 1, runMode: 'agent' });
    expect(r.log.dialog).toBe(1);
    expect(r.log.tray).toBe(1);
  });
  it('and back: full from agent saves runMode: full and asks', () => {
    const r = load('agent');
    expect(r._setRunMode('full', true).restartNeeded).toBe(true);
    expect(r.log.saved.runMode).toBe('full');
    expect(r.log.dialog).toBe(1);
  });
  it('anything but "agent" is full, so a bad value can never strand someone without overlays', () => {
    const r = load('full');
    expect(r._setRunMode('AGENT', true).runMode).toBe('full');
    expect(r._setRunMode(undefined, true).runMode).toBe('full');
  });
  it('picking what this run already is needs no restart and shows no dialog', () => {
    const r = load('agent');
    expect(r._setRunMode('agent', true).restartNeeded).toBe(false);
    expect(r.log.dialog).toBe(0);
  });
  it('setup passes ask=false: saved, no dialog, no restart', () => {
    const r = load('full');
    expect(r._setRunMode('agent', false).restartNeeded).toBe(true);
    expect(r.log.saved.runMode).toBe('agent');
    expect(r.log.dialog).toBe(0);
    expect(r.log.relaunch).toBe(0);
  });
  it('Restart now relaunches through the quit path', async () => {
    const r = load('full');
    r._setRunMode('agent', true);
    await Promise.resolve(); await Promise.resolve();
    expect(r.log.relaunch).toBe(1);
    expect(r.log.quit).toBe(1);
  });
});

describe('IPC, status and the tray', () => {
  it('set-run-mode drives the one setter', () => {
    expect(MAIN_CODE).toMatch(/ipcMain\.handle\('set-run-mode', \(_e, mode, ask\) => _setRunMode\(mode, !!ask\)\)/);
  });
  it('status carries the saved mode and the mode this run started in', () => {
    expect(MAIN_CODE).toMatch(/runMode: cfg\.runMode === 'agent' \? 'agent' : 'full',/);
    expect(MAIN_CODE).toMatch(/runModeNow: _runModeAtStart,/);
  });
  it('the tray item flips its label with the saved mode and calls the setter', () => {
    expect(MAIN_CODE).toMatch(/label: s\.runMode === 'agent' \? '[^']*Switch to full Mimic \(overlays\)…' : '[^']*Switch to agent only \(no overlays\)…',/);
    expect(MAIN_CODE).toMatch(/click: \(\) => \{ _setRunMode\(loadConfig\(\)\.runMode === 'agent' \? 'full' : 'agent', true\); \}/);
  });
  it('overlay-only tray items are hidden in agent only; the spoken-callouts item shows only there', () => {
    expect(MAIN_CODE).toMatch(/const agentOnly = _agentOnly\(\);/);
    for (const label of ['🧲 Rescue overlays to this screen', '🙈 No overlays', 'Hide overlays when EverQuest isn\\\'t running', 'Use the graphics card for overlays']) {
      const line = MAIN_CODE.split('\n').find((l) => l.includes(label));
      expect(line, label).toBeTruthy();
      expect(line, label).toMatch(/visible: !agentOnly/);
    }
    expect(MAIN_CODE).toContain("...(agentOnly ? [] : [{ label: 'Overlays', submenu: overlaysSubmenu }]),");
    const tts = MAIN_CODE.split('\n').find((l) => l.includes("label: 'Spoken trigger callouts (TTS)'"));
    expect(tts).toMatch(/visible: agentOnly/);
    expect(MAIN_CODE).toMatch(/click: \(\) => \{ _toggleOverlay\('trigger'\); buildTrayMenu\(\); \}/);
  });
  it('the tooltip says so', () => {
    expect(MAIN_CODE).toMatch(/s\.runModeNow === 'agent' \? ' · Agent only' : ''/);
  });
});

describe('the preload bridge, Settings and the dashboard', () => {
  it('window.mimic.setRunMode invokes set-run-mode and cannot send anything but agent / full', () => {
    expect(stripJs(PRELOAD)).toMatch(/setRunMode:\s*\(mode, ask\) => ipcRenderer\.invoke\('set-run-mode', mode === 'agent' \? 'agent' : 'full', !!ask\)/);
  });
  it('Settings has the radio pair, loads it from runMode, and saves over its own IPC (not the Save payload)', () => {
    const s = stripJs(SETTINGS);
    expect(s).toMatch(/<input type="radio" name="runMode" value="full" id="runMode_full">/);
    expect(s).toMatch(/<input type="radio" name="runMode" value="agent" id="runMode_agent">/);
    expect(s).toMatch(/getElementById\(c\.runMode === 'agent' \? 'runMode_agent' : 'runMode_full'\)\.checked = true/);
    expect(s).toMatch(/input\[name="runMode"\][\s\S]{0,200}setRunMode\(e\.target\.value, true\)/);
    expect(stripJs(sliceBlock(SETTINGS, 'const payload = {', '};'))).not.toMatch(/runMode/);
  });
  const dash = stripJs(DASH);
  it('the Overlays tab has a byte-stable placeholder and paints the mode from status', () => {
    expect(dash).toContain("h += '<div id=\"wpRunMode\"></div>';");
    const paint = sliceBlock(DASH, "var rmEl = document.getElementById('wpRunMode');", "// 💾 Your layouts, and the switch");
    expect(paint).toMatch(/st\.runMode === 'agent'/);
    expect(paint).toMatch(/st\.runModeNow === 'agent'/);
    expect(paint).toContain('Agent only &mdash; overlays are off');
    expect(paint).toContain('Switch to full Mimic…');
    expect(paint).toContain('Switch to agent only…');
    expect(paint).toMatch(/morphInto\(rmEl,/);
  });
  it('its button drives the same IPC the tray and Settings do', () => {
    expect(dash).toMatch(/a === 'runmode' && window\.mimic\.setRunMode/);
    expect(dash).toMatch(/window\.mimic\.setRunMode\(act\.getAttribute\('data-to'\) === 'agent' \? 'agent' : 'full', true\)/);
  });
  it('the Setup card no longer claims overlays can show in agent only', () => {
    expect(dash).toMatch(/_wpMimicCfg\.agentOnly = st\.runModeNow === 'agent'/);
    expect(dash).toContain('Agent only is on, so there are no overlays');
  });
});

describe('the setup walkthrough asks the question', () => {
  const script = WELCOME.slice(WELCOME.indexOf('<script>'), WELCOME.lastIndexOf('</script>'));
  const step = sliceBlock(script, 'function agentNote() {', "'mode-agent': function () { pick('agent'); } });\n  }\n");
  it('is a step in the registry, early: ahead of Screen flicker and Overlays, optional', () => {
    const reg = sliceBlock(WELCOME, 'var STEPS = [', '\n  ];');
    expect(reg).toMatch(/id: 'mode',[^\n]*body: bMode/);
    expect(reg.indexOf("id: 'mode'")).toBeLessThan(reg.indexOf("id: 'screen'"));
    expect(reg.indexOf("id: 'mode'")).toBeLessThan(reg.indexOf("id: 'overlays'"));
    expect(reg.slice(reg.indexOf("id: 'mode'"), reg.indexOf("id: 'screen'"))).not.toMatch(/kind: 'req'/);
  });
  it('words the question and both answers plainly', () => {
    expect(step).toContain('How do you want to run Mimic?');
    expect(step).toContain('Full Mimic — overlays, timers and callouts over the game (recommended)');
    expect(step).toContain('Agent only — upload my logs and keep the dashboard; no overlays');
    expect(step).toContain('takes effect the next time Mimic starts');
  });
  function mount(runMode) {
    const out = { acts: null, html: '', calls: [], changed: [] };
    const S = { cfg: runMode ? { runMode } : {}, visited: new Set() };
    const el = { set innerHTML(v) { out.html = v; }, get innerHTML() { return out.html; } };
    const env = {
      S, esc: (x) => String(x), turnsOn: () => '',
      wire: (_el, acts) => { out.acts = acts; },
      changed: (id) => { out.changed.push(id); },
      M: { setRunMode: (mode, ask) => { out.calls.push([mode, ask]); return Promise.resolve({ ok: true }); } },
    };
    // eslint-disable-next-line no-new-func
    const bMode = new Function(...Object.keys(env), step + '\nreturn bMode;')(...Object.values(env));
    bMode(el);
    return { out, S, agentNote: new Function(...Object.keys(env), step + '\nreturn agentNote;')(...Object.values(env)) };
  }
  it('each button saves the mode through the one bridge, without a mid-setup restart', () => {
    const a = mount();
    a.out.acts['mode-agent']();
    expect(a.out.calls).toEqual([['agent', false]]);
    expect(a.S.cfg.runMode).toBe('agent');
    expect(a.out.changed).toEqual(['mode']);
    const f = mount('agent');
    f.out.acts['mode-full']();
    expect(f.out.calls).toEqual([['full', false]]);
    expect(f.S.cfg.runMode).toBe('full');
  });
  it('visiting the step marks it done', () => {
    expect(mount().S.visited.has('mode')).toBe(true);
  });
  it('the Overlays and Screen steps carry a one-line note in agent only, and none in full Mimic', () => {
    expect(mount('agent').agentNote()).toContain('You chose agent only — overlays are off. Switch any time from the tray.');
    expect(mount('full').agentNote()).toBe('');
    expect(mount().agentNote()).toBe('');
    const code = stripJs(script);
    expect(code).toMatch(/function bOverlays\(el\) \{\n\s*S\.visited\.add\('overlays'\);\n\s*el\.innerHTML = agentNote\(\) \+/);
    expect(code).toMatch(/function bScreen\(el\) \{[\s\S]{0,120}el\.innerHTML = agentNote\(\) \+/);
  });
  it('the preview bridge has the call so the page still draws outside Mimic', () => {
    expect(stripJs(WELCOME)).toMatch(/setRunMode: ok\(\{ ok: true \}\)/);
  });
});
