// ⤴ beta on the dashboard, next to "↻ Check for update" (the guild lead, 2026-09-27:
// "put the move to beta on the dashboard next to check for updates"). The only
// way into the beta channel had been the tray's "Receive beta updates" — and
// the tray menu was the thing that would not open for the co-leader on stable.
// Tray ↔ dashboard parity (2026-08-19): both must drive the SAME function.
//
// Run: npx vitest run test/dashboard-join-beta.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

describe('header: which button a build shows', () => {
  // The {{WP:…}} expression right after the Check-for-update slot, evaluated
  // the way the agent evaluates it (process.env set by Mimic at spawn).
  const open = '<span id="wpUpdSlot"></span>{{WP:';
  const start = dash.indexOf(open) + open.length;
  const expr = dash.slice(start, dash.indexOf('}}<span id="wpTopRight">', start));
  const render = (env) => new Function('process', 'return (' + expr + ');')({ env });

  it('a stable Mimic build gets ⤴ beta (hidden until the shell answers), no BETA badge', () => {
    const h = render({ WOLFPACK_APP_VERSION: '2.7.1' });
    expect(h).toMatch(/<button id="wpJoinBeta"[^>]*style="display:none;/);
    expect(h).toContain('⤴ beta');
    expect(h).not.toContain('wpRevertStable');
  });
  it('a beta build keeps BETA + ↩ stable and does not offer ⤴ beta', () => {
    const h = render({ WOLFPACK_APP_VERSION: '2.7.2-beta.18' });
    expect(h).toContain('wpRevertStable');
    expect(h).not.toContain('wpJoinBeta');
  });
  it('the standalone parser (no Mimic) shows neither', () => {
    expect(render({})).toBe('');
  });
});

describe('dashboard wiring for ⤴ beta', () => {
  const iife = sliceBlock(dash, "(function () {\n  var jb = document.getElementById('wpJoinBeta');",
    "window.addEventListener('focus', read);\n})();");
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function run(bridge) {
    const jb = { style: { display: 'none' }, dataset: {}, textContent: '⤴ beta', title: '', disabled: false, onclick: null };
    const listeners = {};
    const win = { mimic: bridge, addEventListener: (k, fn) => { listeners[k] = fn; } };
    new Function('document', 'window', iife)({ getElementById: (id) => (id === 'wpJoinBeta' ? jb : null) }, win);
    return { jb, listeners };
  }

  it('stays hidden when the Mimic build has no bridge for it', async () => {
    const { jb } = run({ revertToStable: () => {} });
    await flush();
    expect(jb.style.display).toBe('none');
  });
  it('stays hidden when there is no updater (dev build)', async () => {
    const { jb } = run({ getBetaChannel: async () => ({ optedIn: false, available: false }), setBetaChannel: async () => true });
    await flush();
    expect(jb.style.display).toBe('none');
  });
  it('shows ⤴ beta; a confirmed click joins and turns it green', async () => {
    const calls = [];
    const { jb } = run({
      getBetaChannel: async () => ({ optedIn: false, available: true }),
      setBetaChannel: async (on) => { calls.push(on); return true; },
    });
    await flush();
    expect(jb.style.display).toBe('');
    expect(jb.textContent).toBe('⤴ beta');
    jb.onclick(); await flush();
    expect(calls).toEqual([true]);
    expect(jb.textContent).toBe('✓ beta on next restart');
  });
  it('a cancelled confirm changes nothing', async () => {
    const { jb } = run({
      getBetaChannel: async () => ({ optedIn: false, available: true }),
      setBetaChannel: async () => false,
    });
    await flush();
    jb.onclick(); await flush();
    expect(jb.textContent).toBe('⤴ beta');
    expect(jb.disabled).toBe(false);
  });
  it('already joined: says so, and a click offers to leave', async () => {
    const calls = [];
    const { jb } = run({
      getBetaChannel: async () => ({ optedIn: true, available: true }),
      setBetaChannel: async (on) => { calls.push(on); return true; },
    });
    await flush();
    expect(jb.textContent).toBe('✓ beta on next restart');
    jb.onclick(); await flush();
    expect(calls).toEqual([false]);
    expect(jb.textContent).toBe('⤴ beta');
  });
  it('re-reads on focus, so a tray toggle shows up without a reload', async () => {
    let opted = false;
    const { jb, listeners } = run({
      getBetaChannel: async () => ({ optedIn: opted, available: true }),
      setBetaChannel: async () => true,
    });
    await flush();
    opted = true;
    listeners.focus(); await flush();
    expect(jb.textContent).toBe('✓ beta on next restart');
  });
});

describe('shell: one function behind the tray and the dashboard', () => {
  const fnBlock = sliceBlock(main, 'function setBetaChannel(on, source) {', '  pushStatus();\n}');
  function shell(cfg0) {
    const log = { saved: null, checks: 0, applied: 0, pushed: 0 };
    let cfg = { ...cfg0 };
    const setBetaChannel = new Function('loadConfig', 'saveConfig', 'autoUpdater', '_applyUpdaterChannel',
      'appendAgentLog', 'safeCheckForUpdates', 'pushStatus', fnBlock + '\nreturn setBetaChannel;')(
      () => ({ ...cfg }), (c) => { cfg = c; log.saved = c; }, {}, () => { log.applied++; },
      () => {}, (v) => { if (v) log.checks++; }, () => { log.pushed++; });
    return { setBetaChannel, log, cfg: () => cfg };
  }

  it('joining sets the flag, lifts a stable pin, applies the channel and checks now', () => {
    const s = shell({ forceStable: true, other: 1 });
    s.setBetaChannel(true, 'dashboard');
    expect(s.cfg()).toEqual({ betaChannel: true, other: 1 });
    expect(s.log.applied).toBe(1);
    expect(s.log.checks).toBe(1);
    expect(s.log.pushed).toBe(1);
  });
  it('leaving clears the flag and leaves any stable pin alone', () => {
    const s = shell({ betaChannel: true, forceStable: true });
    s.setBetaChannel(false, 'dashboard');
    expect(s.cfg()).toEqual({ betaChannel: false, forceStable: true });
  });

  it('the tray checkbox calls the same function', () => {
    const tray = stripJs(sliceBlock(main, 'const betaChannelItem = {', '\n  };'));
    expect(tray).toMatch(/click:\s*\(mi\)\s*=>\s*setBetaChannel\(!!mi\.checked,\s*'tray'\)/);
    expect(tray).not.toMatch(/cfg\.betaChannel\s*=/);
  });

  const ipcBlock = sliceBlock(main, "ipcMain.handle('get-beta-channel'", "  setBetaChannel(join, 'dashboard');\n  return true;\n});");
  function ipc(response, cfg) {
    const handlers = {}, calls = [];
    new Function('ipcMain', 'dialog', 'loadConfig', 'autoUpdater', 'setBetaChannel', ipcBlock)(
      { handle: (k, fn) => { handlers[k] = fn; } },
      { showMessageBox: async () => ({ response }) },
      () => cfg, {}, (on, src) => calls.push([on, src]));
    return { handlers, calls };
  }
  it('the dashboard IPC reports state and joins only after the confirm', async () => {
    const ok = ipc(0, { betaChannel: false });
    expect(ok.handlers['get-beta-channel']()).toEqual({ optedIn: false, available: true });
    expect(await ok.handlers['set-beta-channel'](null, true)).toBe(true);
    expect(ok.calls).toEqual([[true, 'dashboard']]);
    const no = ipc(1, {});
    expect(await no.handlers['set-beta-channel'](null, true)).toBe(false);
    expect(no.calls).toEqual([]);
  });

  it('preload exposes both calls on the channels main.js handles', () => {
    expect(preload).toMatch(/getBetaChannel:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-beta-channel'\)/);
    expect(preload).toMatch(/setBetaChannel:\s*\(on\)\s*=>\s*ipcRenderer\.invoke\('set-beta-channel',\s*!!on\)/);
  });
});
