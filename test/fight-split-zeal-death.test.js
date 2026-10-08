// test/fight-split-zeal-death.test.js — two back-to-back kills of one name are two fights.
//
// The guild lead, 2026-10-02, on a 479 s "A brann geistlig" on the DPS/Tank Meter: "This fight was
// backtoback with the same name." A fight closes on a slain line, but that line is range-limited
// and nearby casts keep the 120 s idle from firing, so two pulls of one name became one fight. Now
// the client's own target window closes it too: the target turning into "<name>'s corpse", or its
// bar dropping to 0 under the same name. Drives the REAL EncounterBuilder.
//
// Run: npx vitest run test/fight-split-zeal-death.test.js

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
afterEach(() => vi.useRealTimers());

const at = (sec) => `[Thu Oct 02 03:${String(10 + Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} 2026] `;
function tracker(character, mob, other) {
  const flushes = [];
  const b = new agent.EncounterBuilder({ character, onFlush: p => flushes.push(p) });
  for (let s = 0; s < 12; s++) {
    const line = at(s) + `${character} hits ${mob} for ${400 + s} points of damage.`;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  }
  if (other) {
    const line = at(13) + `${character} hits ${other} for 50 points of damage.`;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  }
  return { b, flushes };
}

describe('the target window closes the fight when its mob dies', () => {
  it('the target turning into its corpse ends the fight, as a confirmed kill', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = tracker('Zarrinoth', 'a brann geistlig');
    agent._noteMobDeathFromState('Zarrinoth', { target_name: 'a brann geistlig', target_hp_pct: 3 }, { target_name: "a brann geistlig's corpse" });
    expect(t.flushes).toHaveLength(0);              // settles first, so the killing blow lands in this fight
    vi.advanceTimersByTime(1500);
    expect(t.flushes).toHaveLength(1);
    expect(t.b.events).toHaveLength(0);
    expect(t.b.bossKillConfirmed).toBe(false);      // reset() for the next pull
  });

  it('the bar dropping to 0 under the same name does too', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = tracker('Brackwynne', 'a brann geistlig');
    agent._noteMobDeathFromState('Brackwynne', { target_name: 'a brann geistlig', target_hp_pct: 2 }, { target_name: 'a brann geistlig', target_hp_pct: 0 });
    vi.advanceTimersByTime(1500);
    expect(t.flushes).toHaveLength(1);
  });

  it('an add dying is not the fight ending; nor is another character\'s target', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = tracker('Corvalen', 'a brann geistlig', 'a brann worker');
    agent._noteMobDeathFromState('Corvalen', { target_name: 'a brann worker', target_hp_pct: 5 }, { target_name: "a brann worker's corpse" });
    agent._noteMobDeathFromState('Somebodyelse', { target_name: 'a brann geistlig', target_hp_pct: 5 }, { target_name: "a brann geistlig's corpse" });
    vi.advanceTimersByTime(1500);
    expect(t.flushes).toHaveLength(0);
    // A target swap to a different mob is not a death either.
    agent._noteMobDeathFromState('Corvalen', { target_name: 'a brann geistlig', target_hp_pct: 40 }, { target_name: 'a brann worker', target_hp_pct: 100 });
    vi.advanceTimersByTime(1500);
    expect(t.flushes).toHaveLength(0);
  });
});
