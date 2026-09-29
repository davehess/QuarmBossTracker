// test/bard-charm-zeal-class.test.js — a bard's charmed NAMED mob shows on the Charm tracker.
//
// The guild lead, 2026-09-29, with a screenshot: a bard holding Dragen Faux under Solon's
// Bewitching Bravura, and the Charm tracker saying "no active charm" — "why is bard charm tracking
// not working?", then "a character's class is output by zeal pipes, on top of us knowing their
// class. we shouldn't need to rely on anything else."
//
// A pet with no "a"/"an"/"the" in front could be a summoned pet, so it only counts as a charm when
// the owner is a bard (who cannot summon) or a charm was just cast. The bard test read /who and the
// raid roster only, so out of a raid it never passed. It now reads Zeal's class label (3) first.
// Runs the real agent. Names other than the reported mob are invented.
//
// Run: npx vitest run test/bard-charm-zeal-class.test.js

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
afterEach(() => { vi.useRealTimers(); });

// Two reconcile passes 1.5s apart: the gauge must hold the pet through the land debounce.
function holdPet(owner, klass, pet) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 8, 29, 1, 0, 0));
  agent._setZealStateForTest(owner, { gauges: [{ slot: 16, text: pet }], charInfo: klass ? [{ id: 3, value: klass }] : [] });
  agent._reconcileGaugeCharms();
  vi.setSystemTime(Date.UTC(2026, 8, 29, 1, 0, 2));
  agent._reconcileGaugeCharms();
  const c = agent._charmTickTracker.get(pet.toLowerCase());
  agent._setZealStateForTest(owner, null);
  agent._charmTickTracker.delete(pet.toLowerCase());
  return c;
}

describe('the owner\'s class from Zeal', () => {
  it('a bard (Zeal says so, no /who, no raid) holding a named mob is charming it', () => {
    const c = holdPet('Nyssara', 'Bard', 'Dragen Faux');
    expect(c && c.is_active).toBe(true);
    expect(c.owner).toBe('Nyssara');
  });

  it('a magician\'s proper-named pet is a summon, not a charm', () => {
    expect(holdPet('Zarrin', 'Magician', 'Kabober')).toBeUndefined();
  });

  it('with no class anywhere, a named pet still is not guessed to be a charm', () => {
    expect(holdPet('Corvale', null, 'Dragen Faux')).toBeUndefined();
  });

  it('_classOf prefers Zeal\'s label over a stale /who', () => {
    agent._setZealStateForTest('Brackwyn', { gauges: [], charInfo: [{ id: 3, value: 'Bard' }] });
    expect(agent._classOf('brackwyn')).toBe('Bard');
    agent._setZealStateForTest('Brackwyn', null);
  });
});
