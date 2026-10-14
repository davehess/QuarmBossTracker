// test/mimic-graceful-update-exit.test.js — installing an update closes Mimic the way Quit does.
//
// The guild lead, 2026-10-14: "when installing a new version, please exit gracefully and save
// window position." Every update path used to call quitAndInstall straight away: a window moved in
// the last 400 ms (the bounds save is debounced) came back where it was, and the agent child was
// hard-killed on Windows, so its upload queue's exit flush never ran. Now every path goes through
// _installUpdateNow -> _gracefulShutdown. This runs the REAL blocks from apps/mimic/main.js against
// stubbed windows, autoUpdater, agent process and HTTP.
//
// Run: npx vitest run test/mimic-graceful-update-exit.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
// From the debounce map through the end of _installUpdateNow: _applyBounds, _writeBounds,
// _persistBounds, _flushBounds and the whole graceful-shutdown block.
const BLOCK = sliceBlock(main, 'const _boundsSaveTimers = {};',
  "    _installingUpdate = false;\n    _abortShutdown();\n    return false;\n  }\n}");

function rig({ agentExits = true, quitThrows = false, agent = true } = {}) {
  const events = [];
  const saves = [];
  let disk = { hudBounds: { x: 0, y: 0, width: 200, height: 100 } };
  const state = {
    quitting: false,
    agentPort: 7777,
    _displaySettleUntil: 0,
    setupMode: false,
    _singleSetupWins: new Set(),
    loadConfig: () => JSON.parse(JSON.stringify(disk)),
    saveConfig: (c) => { disk = JSON.parse(JSON.stringify(c)); saves.push(disk); events.push('saveConfig'); },
    _screenSignature: () => 'sig-A',
    _rememberLayout: () => {},
    _overlayEntries: () => [],
    _flushFloor: () => {},
    appendAgentLog: () => {},
    _stopEqPolling: () => events.push('stopEqPolling'),
    _stopFocusWatcher: () => events.push('stopFocusWatcher'),
    _startEqPolling: () => events.push('startEqPolling'),
    _onFocusGateOptionChanged: () => events.push('focusGate'),
    launchAgent: () => events.push('launchAgent'),
    autoUpdater: { quitAndInstall: () => { events.push('quitAndInstall'); if (quitThrows) throw new Error('boom'); } },
  };
  const proc = new EventEmitter();
  proc.kill = vi.fn(() => { events.push('agent.kill'); setImmediate(() => proc.emit('exit', null, 'SIGTERM')); });
  state.agentProc = agent ? proc : null;
  state.http = {
    request: (opts) => {
      const req = new EventEmitter();
      req.end = () => {
        events.push(`POST ${opts.path}`);
        if (agentExits) setImmediate(() => { events.push('agent.exit'); proc.emit('exit', 0, null); });
      };
      req.destroy = () => {};
      return req;
    },
  };
  const globals = new Set(Object.getOwnPropertyNames(globalThis));
  const env = new Proxy(state, {
    has: (t, k) => typeof k === 'string' && (k in t || !globals.has(k)) && k !== 'arguments',
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError(`graceful-exit rig: no stub for ${String(k)}`);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // eslint-disable-next-line no-new-func
  const api = new Function('__env', `with (__env) {\n${BLOCK}\nreturn { _boundsSaveTimers, _persistBounds, _gracefulShutdown, _installUpdateNow, _stopAgentGracefully };\n}`)(env);
  const win = (b) => ({ isDestroyed: () => false, getBounds: () => b });
  return { api, state, events, saves, proc, win, disk: () => disk };
}

afterEach(() => { vi.useRealTimers(); });

describe('installing an update saves window positions first', () => {
  it('a window moved inside the 400 ms debounce is written before quitAndInstall', async () => {
    const r = rig();
    r.api._persistBounds('hudBounds', r.win({ x: 640, y: 480, width: 300, height: 150 }));
    expect(r.saves).toHaveLength(0);                       // the debounce has not fired: nothing on disk yet
    await r.api._installUpdateNow('tray');
    expect(r.disk().hudBounds).toEqual({ x: 640, y: 480, width: 300, height: 150 });
    expect(r.events.indexOf('saveConfig')).toBeGreaterThanOrEqual(0);
    expect(r.events.indexOf('saveConfig')).toBeLessThan(r.events.indexOf('quitAndInstall'));
  });

  it('the pending debounce timer is cancelled, so it cannot write after the install', async () => {
    const r = rig();
    r.api._persistBounds('hudBounds', r.win({ x: 1, y: 2, width: 300, height: 150 }));
    await r.api._installUpdateNow('tray');
    const writes = r.saves.length;
    await new Promise((res) => setTimeout(res, 450));
    expect(r.saves.length).toBe(writes);
    expect(r.api._boundsSaveTimers.hudBounds).toBeNull();
  });

  it('several windows and a config patch go out in ONE config write', async () => {
    const r = rig();
    r.api._persistBounds('hudBounds', r.win({ x: 1, y: 1, width: 100, height: 100 }));
    r.api._persistBounds('chatBounds', r.win({ x: 2, y: 2, width: 200, height: 200 }));
    r.api._persistBounds('chatBounds_g1', r.win({ x: 3, y: 3, width: 300, height: 300 }));
    await r.api._installUpdateNow('EQ closed', { pendingSilentRelaunch: true });
    expect(r.saves).toHaveLength(1);
    expect(r.saves[0].hudBounds.x).toBe(1);
    expect(r.saves[0].chatBounds.x).toBe(2);
    expect(r.saves[0].chatBounds_g1.x).toBe(3);
    expect(r.saves[0].pendingSilentRelaunch).toBe(true);
  });

  it('a window destroyed before the install is skipped, the rest still save', async () => {
    const r = rig();
    r.api._persistBounds('hudBounds', r.win({ x: 9, y: 9, width: 100, height: 100 }));
    const gone = { isDestroyed: () => false, getBounds: () => ({ x: 5, y: 5, width: 1, height: 1 }) };
    r.api._persistBounds('chatBounds', gone);
    gone.isDestroyed = () => true;
    await r.api._installUpdateNow('tray');
    expect(r.saves).toHaveLength(1);
    expect(r.saves[0].hudBounds.x).toBe(9);
    expect(r.saves[0].chatBounds).toBeUndefined();
  });
});

describe('the agent is asked to stop before the install', () => {
  it('POST /api/shutdown, then the agent exits, then quitAndInstall; watchers stop first', async () => {
    const r = rig();
    await r.api._installUpdateNow('dashboard');
    const order = r.events.filter((e) => ['stopEqPolling', 'stopFocusWatcher', 'POST /api/shutdown', 'agent.exit', 'quitAndInstall'].includes(e));
    expect(order).toEqual(['stopEqPolling', 'stopFocusWatcher', 'POST /api/shutdown', 'agent.exit', 'quitAndInstall']);
    expect(r.proc.kill).not.toHaveBeenCalled();          // it left by itself: no hard kill
    expect(r.state.quitting).toBe(true);                 // the agent's exit handler must not relaunch it
  });

  it('an agent that is not running does not delay the install', async () => {
    const r = rig({ agent: false });
    await r.api._installUpdateNow('tray');
    expect(r.events).toContain('quitAndInstall');
    expect(r.events).not.toContain('POST /api/shutdown');
  });

  it('an agent that does not answer is killed at once, and the install still happens', async () => {
    const r = rig({ agentExits: false });
    const orig = r.state.http.request;
    r.state.http.request = (o) => { const q = orig(o); const end = q.end; q.end = () => { end(); setImmediate(() => q.emit('error', new Error('ECONNREFUSED'))); }; return q; };
    await r.api._installUpdateNow('tray');
    expect(r.proc.kill).toHaveBeenCalledTimes(1);
    expect(r.events).toContain('quitAndInstall');
  });
});

describe('a stuck agent never blocks the install', () => {
  it('after the timeout the agent is killed and quitAndInstall still runs', async () => {
    vi.useFakeTimers();
    const r = rig({ agentExits: false });
    const p = r.api._installUpdateNow('tray');
    await vi.advanceTimersByTimeAsync(2900);
    expect(r.events).not.toContain('quitAndInstall');     // still inside the wait
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(r.proc.kill).toHaveBeenCalledTimes(1);
    expect(r.events.filter((e) => e === 'quitAndInstall')).toHaveLength(1);
  });

  it('the wait is capped at about three seconds', () => {
    expect(stripJs(main)).toMatch(/const AGENT_STOP_TIMEOUT_MS = 3000;/);
  });
});

describe('one install per click, however many clicks', () => {
  it('a double click installs once and stops the agent once', async () => {
    const r = rig();
    const [a, b] = await Promise.all([r.api._installUpdateNow('tray'), r.api._installUpdateNow('dashboard')]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(r.events.filter((e) => e === 'quitAndInstall')).toHaveLength(1);
    expect(r.events.filter((e) => e === 'POST /api/shutdown')).toHaveLength(1);
  });

  it('Quit and an install together share one shutdown', async () => {
    const r = rig();
    const q = r.api._gracefulShutdown('quit');
    await r.api._installUpdateNow('tray');
    await q;
    expect(r.events.filter((e) => e === 'POST /api/shutdown')).toHaveLength(1);
  });
});

describe('an install that fails leaves Mimic usable', () => {
  it('quitAndInstall throwing brings the agent and the watchers back, and a retry works', async () => {
    const r = rig({ quitThrows: true });
    expect(await r.api._installUpdateNow('tray')).toBe(false);
    expect(r.state.quitting).toBe(false);
    expect(r.events).toEqual(expect.arrayContaining(['startEqPolling', 'focusGate']));
    r.state.agentProc = null;                            // the stopped agent is gone, so the abort relaunches it
    r.events.length = 0;
    r.state.autoUpdater.quitAndInstall = () => r.events.push('quitAndInstall');
    expect(await r.api._installUpdateNow('tray')).toBe(true);
    expect(r.events).toContain('quitAndInstall');
  });
});

describe('every way out goes through the one function', () => {
  const src = stripJs(main);
  it('quitAndInstall is called in exactly one place: _installUpdateNow', () => {
    expect(src.match(/\.quitAndInstall\(/g)).toHaveLength(1);
    const body = sliceBlock(src, 'async function _installUpdateNow(', '\n}\n');
    expect(body).toMatch(/autoUpdater\.quitAndInstall\(true, true\)/);
    expect(body).toMatch(/await _gracefulShutdown\(/);
  });
  it('the tray item, the dashboard button, the dialog and the EQ-close install all use it', () => {
    expect(src).toMatch(/Restart to install update v[^\n]*_installUpdateNow\('tray'\)/);
    expect(src).toMatch(/ipcMain\.handle\('restart-to-update', \(\) => \{\s*_installUpdateNow\('dashboard'\)/);
    expect(src).toMatch(/_installUpdateNow\('restart-now dialog'\)/);
    expect(src).toMatch(/_installUpdateNow\('EQ closed', \{ pendingSilentRelaunch: true \}\)/);
  });
  it('Quit Mimic and any other app.quit() go through the graceful shutdown', () => {
    expect(sliceBlock(src, 'function _quitMimic() {', '\n}')).toMatch(/_gracefulShutdown\('quit'\)/);
    expect(sliceBlock(src, "app.on('before-quit', (e) => {", 'return;\n  }')).toMatch(/preventDefault[\s\S]*_gracefulShutdown\(/);
  });
  it('the agent hot-swap restart asks the agent to stop instead of killing it', () => {
    const swap = sliceBlock(src, 'restarting child (window stays up)', 'agent update check failed');
    expect(swap).toMatch(/_stopAgentGracefully\(/);
    expect(swap).not.toMatch(/agentProc\.kill\(\)/);
  });
});
