// Staged raid-attendance tick capture (Hitya 2026-08-06).
//
// "can we put in the automatic raid tick capture (without submission) at
// 830/930/1030/1130" — following "sometimes we will take the 'last tick' before
// the end of the raid, though, so we're not missing people."
//
// The thing these tests mostly defend is that the capture cannot LOSE a raider,
// because the whole point is not missing people. A union that dropped names, or
// a window that skipped a tick after a restart, would fail silently and look
// exactly like a quiet night.
//
// Run: npx vitest run test/raid-tick-capture.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rt = require('../utils/raidTick.js');

const at = (dayOfWeek, hour, minute) => ({ dayOfWeek, hour, minute, year: 2026, month: 8, day: 6 });

describe('dueSlotAt — when a tick fires', () => {
  it('fires at all four of the asked-for times', () => {
    expect(rt.dueSlotAt(at('thursday', 20, 30))?.slot).toBe(1);
    expect(rt.dueSlotAt(at('thursday', 21, 30))?.slot).toBe(2);
    expect(rt.dueSlotAt(at('thursday', 22, 30))?.slot).toBe(3);
    expect(rt.dueSlotAt(at('thursday', 23, 30))?.slot).toBe(4);
  });

  it('uses the tick names OpenDKP already carries', () => {
    // These strings are not decorative — they are what officers see on the real
    // ticks (Tick 1 (Raid Start) … Tick 4 (Raid End)), so a captured row lines
    // up with the tick it will eventually inform instead of inventing a scheme.
    expect(rt.TICK_SLOTS.map(s => s.description)).toEqual([
      'Tick 1 (Raid Start)', 'Tick 2 (1 Hour)', 'Tick 3 (2 Hour)', 'Tick 4 (Raid End)',
    ]);
  });

  it('fires on every raid night and no other day', () => {
    for (const d of ['sunday', 'wednesday', 'thursday']) {
      expect(rt.dueSlotAt(at(d, 20, 30)), d).not.toBeNull();
    }
    for (const d of ['monday', 'tuesday', 'friday', 'saturday']) {
      expect(rt.dueSlotAt(at(d, 20, 30)), d).toBeNull();
    }
  });

  it('stays open for the whole firing window so a restart cannot skip a tick', () => {
    // The checker only runs every 60s, and a deploy across the top of the hour
    // is exactly when a single-minute match would silently lose the tick.
    for (let m = 30; m < 30 + rt.FIRE_WINDOW_MIN; m++) {
      expect(rt.dueSlotAt(at('thursday', 20, m)), `minute ${m}`).not.toBeNull();
    }
  });

  it('closes the window rather than capturing the wrong people late', () => {
    // Past the window a tick is a claim about the wrong moment. A missing row is
    // visibly missing; a late one looks authoritative.
    expect(rt.dueSlotAt(at('thursday', 20, 30 + rt.FIRE_WINDOW_MIN))).toBeNull();
    expect(rt.dueSlotAt(at('thursday', 20, 59))).toBeNull();
  });

  it('never fires off the hour or outside the raid window', () => {
    expect(rt.dueSlotAt(at('thursday', 20, 0))).toBeNull();
    expect(rt.dueSlotAt(at('thursday', 19, 30))).toBeNull();   // pre-raid check owns 19:30
    expect(rt.dueSlotAt(at('thursday', 0, 30))).toBeNull();
    expect(rt.dueSlotAt(at('thursday', 12, 30))).toBeNull();
  });

  it('survives junk input instead of throwing inside a 60s timer', () => {
    for (const bad of [null, undefined, {}, { dayOfWeek: 'thursday' },
                       { dayOfWeek: 'thursday', hour: 'x', minute: 30 }]) {
      expect(rt.dueSlotAt(bad)).toBeNull();
    }
  });
});

describe('rosterUnion — who was there', () => {
  const row = (name, uploader) => ({ name, uploaded_by_discord_id: uploader });

  it('unions across agents so one partial view cannot drop a raider', () => {
    // This is the feature's reason to exist. Agent B just zoned and only sees
    // half the raid; Hitya must still be on the tick.
    const rows = [
      row('Uilnayar', 'A'), row('Hitya', 'A'), row('Fawx', 'A'),
      row('Uilnayar', 'B'), row('Fawx', 'B'),
    ];
    const { names, uploaders } = rt.rosterUnion(rows);
    expect(names).toEqual(['Fawx', 'Hitya', 'Uilnayar']);
    expect(uploaders).toBe(2);
  });

  it('counts a raider once no matter how many agents saw them', () => {
    const rows = Array.from({ length: 17 }, (_, i) => row('Uilnayar', `agent${i}`));
    const { names, uploaders } = rt.rosterUnion(rows);
    expect(names).toEqual(['Uilnayar']);
    expect(uploaders).toBe(17);
  });

  it('collapses case rather than filing one person twice', () => {
    const { names } = rt.rosterUnion([row('Hitya', 'A'), row('HITYA', 'B'), row('hitya', 'C')]);
    expect(names).toEqual(['Hitya']);           // first spelling seen wins
  });

  it('drops malformed rows instead of putting them on an attendance record', () => {
    const { names } = rt.rosterUnion([
      row('Hitya', 'A'), row('', 'A'), row('   ', 'A'), row(null, 'A'),
      row('a pet warder', 'A'), row('X', 'A'), row('Name-With-Dash', 'A'), null,
    ]);
    expect(names).toEqual(['Hitya']);
  });

  it('returns an empty roster rather than throwing on junk', () => {
    for (const bad of [null, undefined, 'nope', {}]) {
      expect(rt.rosterUnion(bad)).toEqual({ names: [], uploaders: 0 });
    }
  });

  it('is deterministic — same rows, same order out', () => {
    const rows = [row('Zeb', 'A'), row('Anna', 'B'), row('Mid', 'A')];
    expect(rt.rosterUnion(rows).names).toEqual(rt.rosterUnion([...rows].reverse()).names);
  });
});

describe('worthRecording — "(if we don\'t end early)"', () => {
  it('records a real raid', () => {
    expect(rt.worthRecording(rt.MIN_NAMES)).toBe(true);
    expect(rt.worthRecording(51)).toBe(true);       // last Wednesday's actual size
  });

  it('does not record a tick for the stragglers after a raid breaks up', () => {
    expect(rt.worthRecording(0)).toBe(false);
    expect(rt.worthRecording(rt.MIN_NAMES - 1)).toBe(false);
  });

  it('treats a missing count as "no raid", never as "record it"', () => {
    for (const bad of [null, undefined, NaN, 'lots']) expect(rt.worthRecording(bad)).toBe(false);
  });
});
