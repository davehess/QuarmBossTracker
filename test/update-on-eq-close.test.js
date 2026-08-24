// Mimic installs a pending update when EverQuest is not running.
//
// THE BUG (Hitya, 2026-08-04, on v2.3.0-beta.9): "beta 9 did not update
// after eq closed… i just got the notification that its ready to install, but
// it did not update in place."
//
// The install was wired to the FALLING EDGE only — `_pollEqPresence` called
// `_installPendingUpdateOnEqClose()` inside `if (running !== _eqRunning)`, so
// Mimic had to personally witness a running → closed flip. Every other ordering
// silently never installed:
//
//   • the download lands while EQ is already shut (the overnight case: Mimic
//     idles, polls hourly, downloads at 3am, then waits for the user to both
//     LAUNCH and QUIT the game before it will apply);
//   • Mimic starts with an update already downloaded and EQ closed;
//   • EQ was never opened during that Mimic session at all.
//
// In all of them the tray reads "Restart to install vX" forever. The condition
// that actually matters is a STATE ("EQ is not running"), not an EVENT, so the
// fix evaluates it every poll and `_installArmed` keeps that from arming a
// fresh timer each time.
//
// Source-sliced against the shipped apps/mimic/main.js — Electron main-process
// code can't be imported (it would need a real `app`), so this evals the two
// real functions with fakes in scope. Rename them and this fails loudly rather
// than passing on a stale copy.
//
// Run: npx vitest run test/update-on-eq-close.test.js

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';

const MIMIC_MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');
const src = readSource(MIMIC_MAIN);

// From the grace constant through the end of _pollEqPresence.
const block = sliceBlock(
  src,
  'const EQ_CLOSE_INSTALL_GRACE_MS =',
  'if (running) { try { _nagPendingUpdate(); } catch { /* ditto */ } }\n}',
);

function harness({ eqRunning = false, pending = { version: '9.9.9' } } = {}) {
  const quitAndInstall = vi.fn();
  const notifications = [];
  const log = [];
  const preamble = `
    let updatePending = ${JSON.stringify(pending)};
    let _eqRunning    = ${eqRunning};
    let __eqNext      = ${eqRunning};
    const autoUpdater = { quitAndInstall: __quitAndInstall };
    const appendAgentLog = (s) => __log.push(String(s).trim());
    const _checkEqRunning = async () => __eqNext;
    const applyAllVisibility = () => {};
    // The falling edge also kicks the #156 resolution lock (EQ flushes
    // eqclient.ini's [VideoMode] on the way out). Stubbed here because this
    // file characterizes the UPDATER; the lock's own wiring is pinned in
    // test/resolution-lock.test.js.
    const RESOLUTION_LOCK_SETTLE_MS = 2500;
    const _enforceResolutionLock = () => {};
    const Notification = function (o) { this.show = () => __notes.push(o); };
    Notification.isSupported = () => true;
  `;
  const epilogue = `
    return {
      poll: _pollEqPresence,
      setEqNext: (v) => { __eqNext = v; },
      setEqRunning: (v) => { _eqRunning = v; },
      clearPending: () => { updatePending = null; },
      isArmed: () => _installArmed,
    };
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('__quitAndInstall', '__log', '__notes',
    preamble + block + epilogue)(quitAndInstall, log, notifications);
  return { ...api, quitAndInstall, log, notifications };
}

beforeEach(() => { vi.useFakeTimers(); });

const GRACE = 15_000;

describe('install-on-EQ-closed', () => {
  it('sliced the real functions', () => {
    expect(block).toContain('function _installPendingUpdateOnEqClose');
    expect(block).toContain('async function _pollEqPresence');
  });

  it('THE BUG: EQ already closed with an update pending → installs (no falling edge)', async () => {
    // _eqRunning false AND the poll also reports false, so `running !==
    // _eqRunning` is FALSE and the transition branch never runs. Before the fix
    // this did nothing at all, forever.
    const h = harness({ eqRunning: false });
    await h.poll();
    expect(h.isArmed(), 'the install should be armed on a steady closed state').toBe(true);
    await vi.advanceTimersByTimeAsync(GRACE + 50);
    expect(h.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('still installs on the classic falling edge (running → closed)', async () => {
    const h = harness({ eqRunning: true });
    h.setEqNext(false);
    await h.poll();
    await vi.advanceTimersByTimeAsync(GRACE + 50);
    expect(h.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('NEVER installs while EQ is running — it nags instead', async () => {
    const h = harness({ eqRunning: true });
    h.setEqNext(true);
    await h.poll();
    await vi.advanceTimersByTimeAsync(GRACE * 4);
    expect(h.quitAndInstall, 'pulling Mimic out from under a live raid is the one unacceptable outcome')
      .not.toHaveBeenCalled();
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0].body).toMatch(/next time you close EverQuest/i);
  });

  it('the grace window still defers if EQ comes back mid-countdown', async () => {
    const h = harness({ eqRunning: true });
    h.setEqNext(false);
    await h.poll();                       // falling edge → armed
    await vi.advanceTimersByTimeAsync(5_000);
    h.setEqRunning(true);                 // they relaunched inside the grace
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(h.quitAndInstall, 'a crash-and-relaunch must not yank Mimic away').not.toHaveBeenCalled();
    expect(h.log.join('\n')).toMatch(/EQ came back/);
  });

  it('THE LATCH: many polls while closed arm ONE timer, not one per poll', async () => {
    const h = harness({ eqRunning: false });
    for (let i = 0; i < 20; i++) await h.poll();
    await vi.advanceTimersByTimeAsync(GRACE + 50);
    expect(h.quitAndInstall, '20 polls must not mean 20 install attempts').toHaveBeenCalledTimes(1);
    // The log is the other half of the evidence: one "installing in 15s" line.
    expect(h.log.filter(l => /installing in/.test(l))).toHaveLength(1);
  });

  it('does nothing at all when no update is pending', async () => {
    const h = harness({ eqRunning: false, pending: null });
    await h.poll();
    await vi.advanceTimersByTimeAsync(GRACE * 3);
    expect(h.quitAndInstall).not.toHaveBeenCalled();
    expect(h.isArmed()).toBe(false);
  });

  it('re-arms after a deferral so the NEXT close still installs', async () => {
    const h = harness({ eqRunning: false });
    await h.poll();
    h.setEqRunning(true);                       // came back during grace
    await vi.advanceTimersByTimeAsync(GRACE + 50);
    expect(h.quitAndInstall).not.toHaveBeenCalled();
    expect(h.isArmed(), 'the latch must clear or the update is stuck forever').toBe(false);

    h.setEqRunning(false); h.setEqNext(false);  // closed again
    await h.poll();
    await vi.advanceTimersByTimeAsync(GRACE + 50);
    expect(h.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
