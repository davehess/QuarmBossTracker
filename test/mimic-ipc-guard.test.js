// test/mimic-ipc-guard.test.js — every ipcMain handler passes one sender check (readiness audit #22).
// Behaviour tests run the real isAllowedSender / installIpcGuard; the text tests strip comments first.
//
// Run: npx vitest run test/mimic-ipc-guard.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const { isAllowedSender, installIpcGuard, STRICT_CHANNELS } = require(path.join(MIMIC, 'ipcGuard.js'));
const APP = path.resolve('/opt/mimic/resources/app');
const PORT = 7777;
const ok = (url, channel) => isAllowedSender(url, { appDir: APP, agentPort: PORT, channel: channel || 'x' });

describe('isAllowedSender', () => {
  it('accepts the app\'s own file:// pages and nothing else on disk', () => {
    expect(ok('file:///opt/mimic/resources/app/overlay.html')).toBe(true);
    expect(ok('file:///opt/mimic/resources/app/canvas.html?part=timers#x')).toBe(true);
    expect(ok('file:///opt/mimic/resources/other/evil.html')).toBe(false);
    expect(ok('file:///opt/mimic/resources/app-evil/x.html')).toBe(false);
    expect(ok('file:///etc/passwd')).toBe(false);
  });
  it('rejects path traversal, plain and encoded', () => {
    expect(ok('file:///opt/mimic/resources/app/../other/x.html')).toBe(false);
    expect(ok('file:///opt/mimic/resources/app/%2e%2e/other/x.html')).toBe(false);
    expect(ok('file:///opt/mimic/resources/app/..%2f..%2fetc/x.html')).toBe(false);
  });
  it('rejects a file:// host (UNC share)', () => {
    expect(ok('file://evil/share/opt/mimic/resources/app/x.html')).toBe(false);
  });
  it('accepts the local agent on the right port only', () => {
    expect(ok('http://127.0.0.1:7777/')).toBe(true);
    expect(ok('http://localhost:7777/overlay/x')).toBe(true);
    expect(ok('http://127.0.0.1:7778/')).toBe(false);
    expect(ok('https://127.0.0.1:7777/')).toBe(false);
    expect(ok('http://127.0.0.1.evil.com:7777/')).toBe(false);
  });
  it('rejects the web, about:blank, data:, blob: and junk', () => {
    for (const u of ['https://wolfpack.quest/', 'about:blank', 'data:text/html,hi', 'blob:http://127.0.0.1:7777/x', '', undefined, 'not a url']) {
      expect(ok(u), String(u)).toBe(false);
    }
  });
  it('strict channels are file:// only', () => {
    expect(STRICT_CHANNELS.has('canvas-save')).toBe(true);
    expect(ok('file:///opt/mimic/resources/app/canvas.html', 'canvas-save')).toBe(true);
    expect(ok('http://127.0.0.1:7777/', 'canvas-save')).toBe(false);
    expect(ok('http://127.0.0.1:7777/', 'save-config')).toBe(true);
  });
});

describe('installIpcGuard', () => {
  function rig(mode = 'enforce') {
    const reg = {}; const logs = [];
    const ipcMain = { on(c, f) { reg[c] = f; }, once(c, f) { reg[c] = f; }, handle(c, f) { reg[c] = f; } };
    installIpcGuard(ipcMain, { appDir: APP, getAgentPort: () => PORT, log: (m) => logs.push(m), mode });
    return { ipcMain, reg, logs };
  }
  it('report mode (the first beta): a bad sender still runs, and the log says what would be blocked', () => {
    const { ipcMain, reg, logs } = rig('report');
    let ran = 0;
    ipcMain.on('b', () => { ran++; });
    ipcMain.handle('c', () => { ran++; return 1; });
    reg.b(bad); expect(reg.c(bad)).toBe(1);
    expect(ran).toBe(2);
    expect(logs).toEqual(['[ipc] would block b from https://wolfpack.quest', '[ipc] would block c from https://wolfpack.quest']);
  });
  it('any mode but "report" enforces, so a typo cannot switch the guard off', () => {
    const { ipcMain, reg, logs } = rig('reprot');
    ipcMain.handle('c', () => 1);
    expect(() => reg.c(bad)).toThrow();
    expect(logs).toEqual(['[ipc] blocked c from https://wolfpack.quest']);
  });
  const good = { senderFrame: { url: 'file:///opt/mimic/resources/app/overlay.html' } };
  const bad = { senderFrame: { url: 'https://wolfpack.quest/x' } };
  it('runs the handler for an allowed sender and passes arguments', () => {
    const { ipcMain, reg } = rig();
    ipcMain.handle('a', (_e, x) => x * 2);
    expect(reg.a(good, 21)).toBe(42);
  });
  it('drops an on() from a bad sender and rejects a handle(); a gone frame is refused', () => {
    const { ipcMain, reg } = rig();
    let ran = 0;
    ipcMain.on('b', () => { ran++; });
    ipcMain.handle('c', () => { ran++; return 1; });
    reg.b(bad); expect(() => reg.c(bad)).toThrow(); expect(() => reg.c({ senderFrame: null })).toThrow();
    expect(ran).toBe(0);
  });
  it('logs once per channel + origin', () => {
    const { ipcMain, reg, logs } = rig();
    ipcMain.on('b', () => {});
    reg.b(bad); reg.b(bad); reg.b(bad);
    expect(logs).toHaveLength(1);
  });
});

describe('main.js registers every handler through the guard', () => {
  const code = stripJs(readSource(path.join(MIMIC, 'main.js')));
  const install = code.indexOf("require('./ipcGuard').installIpcGuard(ipcMain");
  it('installs the guard before the first registration', () => {
    expect(install).toBeGreaterThan(-1);
    const first = code.search(/ipcMain\.(on|once|handle)\(/);
    expect(first).toBeGreaterThan(install);
  });
  it('has no other route to the registry (webContents.ipc, a second ipcMain, removeHandler re-adds)', () => {
    expect(code).not.toMatch(/\.ipc\.(on|handle|once)\(/);
    expect(code).not.toMatch(/require\('electron'\)\.ipcMain/);
    expect(code).not.toMatch(/ipcMain\s*=[^=]/);
    expect(code).not.toMatch(/const\s*\{[^}]*\bipcMain\b[^}]*\}\s*=\s*require\('electron'\)[\s\S]*const\s*\{[^}]*\bipcMain\b[^}]*\}\s*=\s*require\('electron'\)/);
  });
  it('every strict channel is a real handler (a rename must not silently drop it to the general tier)', () => {
    for (const c of STRICT_CHANNELS) expect(code, c).toMatch(new RegExp("ipcMain\\.(on|handle)\\('" + c.replace(/[-:]/g, '\\$&') + "'"));
  });
});
