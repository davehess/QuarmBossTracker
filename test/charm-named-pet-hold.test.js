// test/charm-named-pet-hold.test.js — a charmed NAMED mob stays charmed while Zeal shows it as the pet.
//
// FB-121 (2026-11-06): an enchanter charmed Giwin Mirakon with Allure; the tracker called a charm break
// and then showed "no active charm" while the pet window still held him. A pet with no "a/an/the" only
// counts as a charm while a charm cast is pending, and landing consumes that cast, so the next
// reconcile pass dropped the pet from the live set and the 6s gauge rule called a break.
// Runs the real agent. The owner's name is invented; the pet is the mob from the report.
//
// Run: npx vitest run test/charm-named-pet-hold.test.js

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const OWNER = 'Rethlan';
const PET = 'Giwin Mirakon';
const T0 = new Date(2026, 10, 6, 13, 46, 49).getTime();   // the cast line's local time

function at(sec, gaugePet) {
  vi.setSystemTime(T0 + sec * 1000);
  agent._setZealStateForTest(OWNER, { gauges: gaugePet ? [{ slot: 16, text: gaugePet }] : [{ slot: 6, text: 'a Diaku Scout' }], charInfo: [{ id: 3, value: 'Enchanter' }] });
  agent._reconcileGaugeCharms();
  return agent._charmTickTracker.get(PET.toLowerCase());
}

afterEach(() => {
  agent._setZealStateForTest(OWNER, null);
  agent._charmTickTracker.delete(PET.toLowerCase());
  vi.useRealTimers();
});

describe('a charmed named mob', () => {
  function charm() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    agent.noteSelfCast('[Fri Nov 06 13:46:49 2026] You begin casting Allure.', OWNER);
    at(3, PET);
    return at(5, PET);
  }

  it('opens on the gauge after the cast', () => {
    const c = charm();
    expect(c && c.is_active).toBe(true);
    expect(c.owner).toBe(OWNER);
  });

  it('stays charmed while Zeal keeps showing it as the pet', () => {
    charm();
    for (const sec of [8, 12, 20, 40, 90]) {
      const c = at(sec, PET);
      expect(c && c.is_active, `still charmed at +${sec}s`).toBe(true);
    }
  });

  it('still breaks when the pet leaves the gauge', () => {
    charm();
    at(10, PET);
    at(12, null);
    const c = at(17, null);
    expect(c && c.is_active).toBe(false);
  });
});
