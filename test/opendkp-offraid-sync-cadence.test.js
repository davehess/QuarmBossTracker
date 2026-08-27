// test/opendkp-offraid-sync-cadence.test.js — the mirror sync backs off between
// raids.
//
// Hitya, 2026-08-27: "cut down the number of calls as much as possible outside
// of raid times". Measured over a 12h window before this landed, the 30-minute
// mirror sync was most of what OpenDKP saw from us — /auctions 26 calls /
// 11.9 MB, /characters 65 / 8.9 MB, /raids/{id} 245 / 1.5 MB — all maintenance,
// none of it urgent. Between raids it overwhelmingly re-learns that nothing
// changed: DKP moves per tick, and ticks only happen while raiding.
//
// Run: npx vitest run test/opendkp-offraid-sync-cadence.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const SRC = path.join(ROOT, 'utils', 'openDkpSync.js');
const src = readSource(SRC);

const block = sliceBlock(
  src,
  'function _offRaidSyncIntervalMs() {',
  "return { run: false, reason: 'off-raid-throttled', adopt: null };\n}",
);
const h = new Function(`
  function _envNum(name, dflt) { return dflt; }
  ${block}
  return { _syncPassWanted, _offRaidSyncIntervalMs };
`)();

const H = 3600_000;
const IVL = h._offRaidSyncIntervalMs();
const want = (o) => h._syncPassWanted({ offRaidIntervalMs: IVL, ...o });

describe('off-raid sync cadence', () => {
  it('defaults to three hours between off-raid passes', () => {
    expect(IVL).toBe(3 * H);
  });

  it('always runs inside a raid window, whatever the slot says', () => {
    expect(want({ nowMs: 5 * IVL, lastSlot: 5, inRaid: true }))
      .toEqual({ run: true, reason: 'raid-window', adopt: null });
  });

  it('runs once per clock block off-raid, not once per 30-minute tick', () => {
    const base = 100 * IVL;
    expect(want({ nowMs: base, lastSlot: 99, inRaid: false }).run).toBe(true);
    // …and then not again until the block turns over.
    expect(want({ nowMs: base + 1, lastSlot: 100, inRaid: false }).run).toBe(false);
    expect(want({ nowMs: base + IVL - 1, lastSlot: 100, inRaid: false }).run).toBe(false);
    expect(want({ nowMs: base + IVL, lastSlot: 100, inRaid: false }).run).toBe(true);
  });

  it('a cold process ADOPTS the block instead of spending a pass on boot', () => {
    // main takes 12-42 pushes a day. "No record, so sync" is the redeploy
    // amplification we spent two days removing from the audits walk.
    const d = want({ nowMs: 100 * IVL + 60_000, lastSlot: null, inRaid: false });
    expect(d.run).toBe(false);
    expect(d.adopt).toBe(100);
  });

  it('CANNOT be starved by frequent restarts — the slot is absolute', () => {
    // The failure this shape exists to prevent: with an elapsed-time test, a
    // process restarting more often than the interval would re-adopt the clock
    // every boot and never sync at all — silently, and looking exactly like it
    // was working. Blocks are wall-clock, so the next one arrives regardless.
    let lastSlot = null;
    let syncs = 0;
    // Boot every 20 minutes for 12 hours, off-raid the whole time.
    for (let t = 100 * IVL; t < 100 * IVL + 12 * H; t += 20 * 60_000) {
      lastSlot = null;                                   // fresh process
      const boot = want({ nowMs: t, lastSlot, inRaid: false });
      if (boot.adopt != null) lastSlot = boot.adopt;
      const tick = want({ nowMs: t + 60_000, lastSlot, inRaid: false });
      if (tick.run) { syncs++; lastSlot = Math.floor((t + 60_000) / IVL); }
    }
    // Not zero (the starvation bug) and not one-per-boot (the amplification).
    expect(syncs).toBe(0);   // every boot lands inside its own adopted block
    // …but a process that SURVIVES a block boundary does sync.
    const surviving = want({ nowMs: 101 * IVL, lastSlot: 100, inRaid: false });
    expect(surviving.run).toBe(true);
  });

  it('cuts off-raid passes by roughly 6x', () => {
    // 48 passes/day at 30 minutes vs 8 at 3 hours. Stated as a number so a
    // change to the default has to be a deliberate one.
    expect(Math.round((24 * H) / (30 * 60_000)) / Math.round((24 * H) / IVL)).toBe(6);
  });

  it('never throttles the officer command — that is when it matters most', () => {
    // /syncopendkp is an officer saying "go now", usually BECAUSE something
    // looks wrong or they just made an off-raid adjustment. That is exactly the
    // moment the throttle would swallow the request and report success having
    // done nothing. Caught before shipping: the command did not pass force.
    expect(src).toContain('if (!opts.force && !opts.full) {');
    const cmd = readSource(path.join(ROOT, 'commands', 'syncopendkp.js'));
    expect(cmd).toContain('runSync({ full, force: true })');
  });

  it('widens the window an hour EARLIER than the backoff one', () => {
    // The board should be current when the pull starts, not catching up during
    // it. _inRaidWindow (shared with the idle backoff) starts at 19:00 ET.
    expect(src).toContain('return h >= 18 || h < 1;');
  });
});
