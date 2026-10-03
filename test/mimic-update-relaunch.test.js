// test/mimic-update-relaunch.test.js — the first run after an update never opens over EverQuest.
//
// FB-50 (a member, 2026-10-02, stable 2.7.6): "crash game when starting it up while already have game
// running". The guild lead: "i believe they went to update and it crashed". Their game log stops nine
// seconds after the old Mimic's last upload: they clicked "Restart to install", went back to the raid,
// and the new build opened its main window over the game. Only the unattended install-on-EQ-close path
// started to tray (pendingSilentRelaunch). Now the NEW build decides, on its first run, from tasklist.
// DECISIONS §133. Runs the real blocks from apps/mimic/main.js against fakes.
//
// Run: npx vitest run test/mimic-update-relaunch.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const DETECT = sliceBlock(main, '  let _firstRunAfterUpdate = false;', '  } catch (e) { void e; }');
const SHOW   = sliceBlock(main, '  if (_firstRunAfterUpdate && !_autoStarted) {', '    }, () => {});\n  }');

function detect(raw, version) {
  const saved = [];
  const fn = new Function('_readConfigRaw', 'loadConfig', 'saveConfig', 'app',
    DETECT + '\nreturn _firstRunAfterUpdate;');
  const out = fn(() => raw, () => Object.assign({}, raw || {}), (c) => saved.push(c), { getVersion: () => version });
  return { updated: out, saved };
}

async function boot({ firstRun = true, autoStarted = false, eqUp }) {
  const calls = { shown: 0, notes: [], log: [] };
  const mainWindow = { isDestroyed: () => false, show: () => { calls.shown++; } };
  const Notification = class { constructor(o) { this.o = o; } show() { calls.notes.push(this.o); } };
  Notification.isSupported = () => true;
  new Function('_firstRunAfterUpdate', '_autoStarted', '_checkEqRunning', 'mainWindow', 'Notification',
    'appendAgentLog', 'app', SHOW)(firstRun, autoStarted, async () => eqUp, mainWindow, Notification,
    (s) => calls.log.push(s), { getVersion: () => '2.7.7' });
  await new Promise((r) => setTimeout(r, 0));
  return calls;
}

describe('is this the first run of a new version?', () => {
  it('a different recorded version is an update, and the new one is recorded', () => {
    const r = detect({ lastRunVersion: '2.7.6', eqPaths: ['C:/EQ'] }, '2.7.7');
    expect(r.updated).toBe(true);
    expect(r.saved[0].lastRunVersion).toBe('2.7.7');
  });
  it('an existing install with no mark yet (its old build never wrote one) is an update too', () => {
    expect(detect({ eqPaths: ['C:/EQ'] }, '2.7.7').updated).toBe(true);
  });
  it('the same version again is not, and writes nothing', () => {
    const r = detect({ lastRunVersion: '2.7.7' }, '2.7.7');
    expect(r.updated).toBe(false);
    expect(r.saved).toHaveLength(0);
  });
  it('a brand-new install (no config yet) is not', () => {
    expect(detect(null, '2.7.7').updated).toBe(false);
  });
});

describe('the window after an update', () => {
  it('EverQuest running: stays in the tray, says so quietly, never shows', async () => {
    const c = await boot({ eqUp: true });
    expect(c.shown).toBe(0);
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0].silent).toBe(true);
  });
  it('EverQuest closed: the window opens as the user expects', async () => {
    const c = await boot({ eqUp: false });
    expect(c.shown).toBe(1);
    expect(c.notes).toHaveLength(0);
  });
  it('an autostart or unattended install keeps its own tray start', async () => {
    const c = await boot({ eqUp: false, autoStarted: true });
    expect(c.shown).toBe(0);
  });
  it('the window is created hidden on that first run', () => {
    expect(stripJs(main)).toContain('show: !_autoStarted && !_firstRunAfterUpdate,');
  });
});
