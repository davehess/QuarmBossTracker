// test/roll-overrides.test.js — officer corrections to captured roll sets.
//
// Two real cases from the Aug 11 night (Hitya, 2026-08-12): a 0-22 set that was
// a misfire and needs removing, and "Do a 777 if you want a Shield of the
// Immaculate" — a phrasing the agent's loot-link convention does not match, so
// it landed as an unlabeled roll and needs a name typed in.
//
// The load-bearing part is the MATCH. Corrections live in their own table
// because roll_sets rows are per-uploader and agents upsert them, so an edit
// written onto a row would be undone by the next observer's upload. Overrides
// therefore have to re-find their session by value, using the same rule
// mergeRollSets clusters by — and the merged start is the MIN across uploaders,
// so a late upload with an earlier stamp can move it after the officer acted.
//
// Run: npx vitest run test/roll-overrides.test.js

import { describe, it, expect } from 'vitest';
import { applyRollOverrides, SET_GAP_MS } from '../web/lib/rolls.ts';

const T = Date.parse('2026-08-11T21:37:00Z');
const iso = (ms) => new Date(ms).toISOString();

const session = (over = {}) => ({
  from: 0, to: 777, item: null, qty: null, zone: null,
  startMs: T, lastMs: T + 60_000, rollers: 9,
  winners: [{ name: 'Fargan', value: 732 }], rolls: [], ...over,
});

describe('applyRollOverrides', () => {
  it('names the Shield of the Immaculate roll the agent could not label', () => {
    const [s] = applyRollOverrides([session()], [
      { roll_from: 0, roll_to: 777, started_at: iso(T),
        item: 'Shield of the Immaculate', edited_by_name: 'Hitya' },
    ]);
    expect(s.item).toBe('Shield of the Immaculate');
    expect(s.hidden).toBe(false);
    expect(s.editedBy).toBe('Hitya');
  });

  it('hides the 0-22 misfire', () => {
    const [s] = applyRollOverrides([session({ from: 0, to: 22, winners: [{ name: 'Smokestomp', value: 17 }] })],
      [{ roll_from: 0, roll_to: 22, started_at: iso(T), hidden: true }]);
    expect(s.hidden).toBe(true);
  });

  it('matches within the set-gap window — a later upload can move the start', () => {
    // Officer edited when the session started at T; another uploader then
    // arrives with an earlier stamp and the merged start shifts back.
    const [s] = applyRollOverrides([session({ startMs: T - 4 * 60_000 })], [
      { roll_from: 0, roll_to: 777, started_at: iso(T), item: 'Shield of the Immaculate' },
    ]);
    expect(s.item).toBe('Shield of the Immaculate');
  });

  it('does NOT bleed onto a different set with the same range later that night', () => {
    const [s] = applyRollOverrides([session({ startMs: T + SET_GAP_MS + 60_000 })], [
      { roll_from: 0, roll_to: 777, started_at: iso(T), item: 'Shield of the Immaculate' },
    ]);
    expect(s.item).toBeNull();       // a second 777 roll is its own event
    expect(s.hidden).toBe(false);
  });

  it('does not match a different range at the same moment', () => {
    const [s] = applyRollOverrides([session({ from: 0, to: 666 })], [
      { roll_from: 0, roll_to: 777, started_at: iso(T), hidden: true },
    ]);
    expect(s.hidden).toBe(false);
  });

  it('an override with no item leaves the agent capture alone', () => {
    const [s] = applyRollOverrides([session({ item: "Narandi's Lance" })], [
      { roll_from: 0, roll_to: 777, started_at: iso(T), hidden: true },
    ]);
    expect(s.item).toBe("Narandi's Lance");
    expect(s.hidden).toBe(true);
  });

  it('an empty string clears a wrong label back to unlabeled', () => {
    const [s] = applyRollOverrides([session({ item: 'Wrong Item' })], [
      { roll_from: 0, roll_to: 777, started_at: iso(T), item: '   ' },
    ]);
    expect(s.item).toBeNull();
  });

  it('sessions with no override pass through untouched', () => {
    const out = applyRollOverrides([session({ item: 'Crown of Narandi' })], []);
    expect(out[0].item).toBe('Crown of Narandi');
    expect(out[0].hidden).toBe(false);
    expect(out[0].winners).toEqual([{ name: 'Fargan', value: 732 }]);
  });

  it('tolerates junk instead of an array', () => {
    expect(applyRollOverrides([session()], null)).toHaveLength(1);
    expect(applyRollOverrides(null, [])).toEqual([]);
  });
});
