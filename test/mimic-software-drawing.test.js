// test/mimic-software-drawing.test.js — "Use the graphics card for overlays" (cfg.disableGpu).
//
// A member's whole screen went black with Windows' "device unplugged / plugged in" sound while Mimic
// ran: a graphics-driver reset. Overlays are transparent always-on-top windows composited on the
// graphics card over EverQuest. The guild lead picked a Mimic setting that draws them in software
// instead, applied on restart, and asked that people are asked about it as they set up.
//
// What is pinned: the switch is thrown BEFORE the app is ready and only when the saved flag says so
// (a missing or torn config keeps the graphics card on); Settings, the tray and the setup question all
// drive the one setter; the preload bridge carries it.
//
// Run: npx vitest run test/mimic-software-drawing.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const MAIN = readSource(path.join(MIMIC, 'main.js'));
const PRELOAD = readSource(path.join(MIMIC, 'preload.js'));
const SETTINGS = readSource(path.join(MIMIC, 'settings.html'));
const WELCOME = readSource(path.join(MIMIC, 'welcome.html'));
const MAIN_CODE = stripJs(MAIN);

describe('the switch is thrown before the app is ready, only when the flag is on', () => {
  const block = sliceBlock(MAIN, 'const _gpuOffAtStart = ', 'if (_gpuOffAtStart) app.disableHardwareAcceleration();');
  // evalBlock only takes source text, so hand the reader in through a global the block can see.
  function load(raw) {
    const g = globalThis;
    g.__rawForTest = raw;
    const r = evalBlock(`
      const CALLS = [];
      const app = { disableHardwareAcceleration() { CALLS.push('off'); } };
      const _readConfigRaw = () => { const v = globalThis.__rawForTest; if (v instanceof Error) throw v; return v; };
      ${block}
    `, ['_gpuOffAtStart', 'CALLS']);
    delete g.__rawForTest;
    return r;
  }
  it('disableGpu: true turns hardware drawing off', () => {
    const r = load({ disableGpu: true });
    expect(r._gpuOffAtStart).toBe(true);
    expect(r.CALLS).toEqual(['off']);
  });
  it('the graphics card stays on for false, missing, unrelated and torn config', () => {
    for (const raw of [{ disableGpu: false }, {}, null, { disableGpu: 'yes' }, new Error('torn')]) {
      const r = load(raw);
      expect(r._gpuOffAtStart).toBe(false);
      expect(r.CALLS).toEqual([]);
    }
  });
  it('the call sits before app.whenReady() in main.js, and is the only one', () => {
    const at = MAIN_CODE.indexOf('app.disableHardwareAcceleration()');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(MAIN_CODE.indexOf('app.whenReady()'));
    expect(MAIN_CODE.match(/disableHardwareAcceleration\(/g)).toHaveLength(1);
    expect(MAIN_CODE).toMatch(/if \(_gpuOffAtStart\) app\.disableHardwareAcceleration\(\)/);
  });
  it('the default config leaves the graphics card on', () => {
    const def = sliceBlock(MAIN, 'function defaultConfig()', '\n}\n');
    expect(stripJs(def)).toMatch(/disableGpu:\s*false/);
  });
});

describe('the setter saves the flag and offers a restart only when it changes what this run started with', () => {
  const block = sliceBlock(MAIN, 'function _setGpuDrawing(useGpu, ask) {', '\n}\n');
  function load(startedOff) {
    const g = globalThis;
    g.__gpuT = { startedOff };
    const r = evalBlock(`
      const T = globalThis.__gpuT;
      const _gpuOffAtStart = T.startedOff;
      const log = { saved: null, dialog: 0, relaunch: 0, quit: 0, status: 0 };
      const loadConfig = () => ({ other: 1 });
      const saveConfig = (c) => { log.saved = c; };
      const dialog = { showMessageBox: () => { log.dialog++; return Promise.resolve({ response: 0 }); } };
      const app = { relaunch: () => { log.relaunch++; } };
      const _quitMimic = () => { log.quit++; };
      const pushStatus = () => { log.status++; };
      ${block}
    `, ['_setGpuDrawing', 'log']);
    delete g.__gpuT;
    return r;
  }
  it('turning the graphics card off saves disableGpu: true and asks for a restart', () => {
    const r = load(false);
    const out = r._setGpuDrawing(false, true);
    expect(r.log.saved).toEqual({ other: 1, disableGpu: true });
    expect(out).toEqual({ ok: true, useGpu: false, restartNeeded: true });
    expect(r.log.dialog).toBe(1);
  });
  it('turning it back on saves disableGpu: false', () => {
    const r = load(true);
    const out = r._setGpuDrawing(true, true);
    expect(r.log.saved.disableGpu).toBe(false);
    expect(out).toEqual({ ok: true, useGpu: true, restartNeeded: true });
  });
  it('picking what this run already has needs no restart and shows no dialog', () => {
    const r = load(false);
    const out = r._setGpuDrawing(true, true);
    expect(out.restartNeeded).toBe(false);
    expect(r.log.dialog).toBe(0);
  });
  it('setup passes ask=false: saved, no dialog, no restart', () => {
    const r = load(false);
    const out = r._setGpuDrawing(false, false);
    expect(out.restartNeeded).toBe(true);
    expect(r.log.saved.disableGpu).toBe(true);
    expect(r.log.dialog).toBe(0);
    expect(r.log.relaunch).toBe(0);
  });
  it('Restart now relaunches through the quit path', async () => {
    const r = load(false);
    r._setGpuDrawing(false, true);
    await Promise.resolve(); await Promise.resolve();
    expect(r.log.relaunch).toBe(1);
    expect(r.log.quit).toBe(1);
  });
  it('is reachable by IPC, status and the tray with the same setter', () => {
    expect(MAIN_CODE).toMatch(/ipcMain\.handle\('set-gpu-drawing', \(_e, useGpu, ask\) => _setGpuDrawing\(!!useGpu, !!ask\)\)/);
    expect(MAIN_CODE).toMatch(/useGpu: !cfg\.disableGpu/);
    expect(MAIN_CODE).toMatch(/Use the graphics card for overlays[^\n]*checked: s\.useGpu !== false[^\n]*_setGpuDrawing\(!!mi\.checked, true\)/);
  });
});

describe('the preload bridge and Settings', () => {
  it('window.mimic.setGpuDrawing invokes set-gpu-drawing', () => {
    expect(stripJs(PRELOAD)).toMatch(/setGpuDrawing:\s*\(useGpu, ask\) => ipcRenderer\.invoke\('set-gpu-drawing', !!useGpu, !!ask\)/);
  });
  it('Settings has the checkbox with the agreed label and hint, on by default', () => {
    expect(SETTINGS).toMatch(/<input id="useGpu" type="checkbox" checked \/>/);
    expect(SETTINGS).toContain('<label for="useGpu">Use the graphics card for overlays</label>');
    expect(SETTINGS).toContain('Turn off if your screen goes black or you hear a device disconnect sound while Mimic runs. Overlays use a little more processor. Restarts Mimic.');
  });
  it('Settings loads it from disableGpu and saves it over its own IPC, not the Save payload', () => {
    expect(SETTINGS).toMatch(/getElementById\('useGpu'\)\.checked\s*=\s*\(c\.disableGpu !== true\)/);
    expect(SETTINGS).toMatch(/getElementById\('useGpu'\)\.addEventListener\('change'[\s\S]{0,120}setGpuDrawing\(e\.target\.checked, true\)/);
    const saveBlock = sliceBlock(SETTINGS, 'const payload = {', '};');
    expect(saveBlock).not.toMatch(/useGpu|disableGpu/);
  });
});

describe('the setup walkthrough asks the question', () => {
  const step = sliceBlock(WELCOME, 'function bScreen(el) {', '\n  var ME = [');
  const code = stripJs(step);
  it('is a step in the registry, ahead of Overlays and optional', () => {
    const reg = sliceBlock(WELCOME, 'var STEPS = [', '\n  ];');
    expect(reg).toMatch(/id: 'screen',[^\n]*body: bScreen/);
    expect(reg.indexOf("id: 'screen'")).toBeLessThan(reg.indexOf("id: 'overlays'"));
    expect(reg.slice(reg.indexOf("id: 'screen'"), reg.indexOf("id: 'overlays'"))).not.toMatch(/kind: 'req'/);
  });
  it('words the question and both answers plainly', () => {
    expect(code).toContain('Has your screen ever gone black, or flickered, while EverQuest and an overlay app were running?');
    expect(code).toContain('No — use the graphics card (recommended)');
    expect(code).toContain('Yes — draw overlays without the graphics card');
  });
  it('each button sets the same flag through the same bridge, without a mid-setup restart', () => {
    expect(code).toMatch(/'gpu-on': function \(\) \{ pick\(true\); \}/);
    expect(code).toMatch(/'gpu-off': function \(\) \{ pick\(false\); \}/);
    expect(code).toMatch(/S\.cfg\.disableGpu = !useGpu/);
    expect(code).toMatch(/M\.setGpuDrawing\(useGpu, false\)/);
    expect(code).toContain('takes effect the next time Mimic starts');
  });
  it('member-facing text avoids jargon', () => {
    const text = step.replace(/\/\/[^\n]*/g, '');
    expect(text).not.toMatch(/hardware acceleration|GPU|TDR/);
  });
  it('the preview bridge has the call so the page still draws outside Mimic', () => {
    expect(stripJs(WELCOME)).toMatch(/setGpuDrawing: ok\(\{ ok: true \}\)/);
  });
});
