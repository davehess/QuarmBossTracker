// test/charm-pet-health-timers.test.js — the Charm tracker times a buff the pet's own report names (FB-102).
//
// FB-102 (Mimic 3.0.5-beta.8): "Charm Tracker is missing timeframes despite target info having the data". The
// report's own log, replayed through the real agent, ends with a /pet health block naming Pacify, Visions of
// Grandeur and Boon of the Garou on a re-charmed mob. Mob Info (landings keyed by the mob's NAME) counted all three
// down; the Charm tracker (landings keyed by the OWNER) showed each as "(?)", because the re-charm after a break
// could not be proven the same spawn (no spawn id on the pipe), so the owner's landings were cleared and the 60 s
// pre-charm sweep carried nothing older. The pet's report says the buff is on it now, so its timer is borrowed from
// the name-keyed landing — unless the spawn id proves that landing belongs to another mob.
//
// Run: npx vitest run test/charm-pet-health-timers.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');

const OWNER = 'Aldenmar';
const PET = 'a cragbeast queen';
const ol = OWNER.toLowerCase(), pl = PET.toLowerCase();
const E = (id, name, dur, durf, good) => ({ id, name, dur, durf, good, other: null, you: null, fades: null });

const stamp = (sec, text) => `[Tue Oct 27 10:15:${String(sec).padStart(2, '0')} 2026] ${text}`;
// A /pet health block as the game prints it: the HP line, then one bare spell name per buff on the pet.
const report = (...names) => {
  agent.applyPetHealthLine(stamp(0, 'I have 90 percent of my hit points left.'), OWNER);
  for (const n of names) agent.applyPetHealthLine(stamp(0, n), OWNER);
};
const landing = (name, ageSec, extra = {}) => ({
  name, dur_ticks: 100, landed_at: Date.now() - ageSec * 1000, target_name: PET, target_id: null, ...extra,
});
const onTarget = (key, entry) => {
  const mp = agent._buffLandingsByTarget.get(pl) || new Map();
  mp.set(key, entry);
  agent._buffLandingsByTarget.set(pl, mp);
};
const chip = (name) => agent.petBuffsForOwner(ol).find((b) => b.name === name);

beforeEach(() => {
  agent._charmTickTracker.clear();
  agent._petBuffLandings.clear();
  agent._buffLandingsByTarget.clear();
  agent._petHealthByOwner.clear();
  agent._setZealStateForTest(OWNER, null);
  agent._setSpellCatalogForTest([
    E(45, 'Pacify', 60, 8, 1),
    E(1710, 'Visions of Grandeur', 420, 11, 1),
    E(1702, 'Tashanian', 140, 9, 0),
  ]);
});

describe('a re-charm with no spawn id (the FB-102 log)', () => {
  // The real order of events: debuffs and buffs land on the mob, the charm breaks, the same name is charmed again.
  const recharm = () => {
    agent._bumpCharmTick(PET, OWNER, 'land', Date.now() - 600_000, { charm_spell_name: 'Allure', duration_sec: 120 });
    agent._bumpCharmTick(PET, OWNER, 'break', Date.now() - 100_000, {});
    agent._bumpCharmTick(PET, OWNER, 'land', Date.now(), { charm_spell_name: 'Allure', duration_sec: 120 });
  };

  it('times the buffs the pet reports from the landings Mob Info holds', () => {
    onTarget('pacify', landing('Pacify', 600, { dur_ticks: 200 }));
    onTarget('visions of grandeur', landing('Visions of Grandeur', 300, { dur_ticks: 420 }));
    recharm();
    // The owner-keyed store really was emptied by the re-charm — that is the premise of the bug.
    expect(agent._petBuffLandings.get(ol)?.has('pacify') || false).toBe(false);
    report('Pacify', 'Visions of Grandeur');
    const pacify = chip('Pacify'), vog = chip('Visions of Grandeur');
    expect(pacify.remaining_secs).toBeGreaterThan(500);
    expect(pacify.remaining_secs).toBeLessThanOrEqual(600);
    expect(pacify.total_secs).toBe(1200);
    expect(vog.remaining_secs).toBeGreaterThan(2000);
    expect(vog.total_secs).toBe(2520);
  });

  it('names only what the pet reports: a landing on the mob that the report omits is not added', () => {
    onTarget('pacify', landing('Pacify', 120));       // older than the 60 s pre-charm sweep, so neither rides over
    onTarget('tashanian', landing('Tashanian', 120));
    recharm();
    report('Pacify');
    const names = agent.petBuffsForOwner(ol).map((b) => b.name);
    expect(names).toContain('Pacify');
    expect(names).not.toContain('Tashanian');
  });
});

describe('what is never borrowed', () => {
  beforeEach(() => {
    agent._setZealStateForTest(OWNER, { pet_name: PET, pet_id: 1817, gauges: [{ slot: 16, text: PET }], updatedAt: Date.now() });
  });

  it('a landing the spawn id proves is another mob\'s', () => {
    onTarget('pacify', landing('Pacify', 10, { target_id: 1990 }));
    report('Pacify');
    expect(chip('Pacify').remaining_secs).toBe(null);
  });

  it('a landing on this spawn is borrowed', () => {
    onTarget('pacify', landing('Pacify', 10, { target_id: 1817 }));
    report('Pacify');
    expect(chip('Pacify').remaining_secs).toBeGreaterThan(500);
  });

  it('a landing that has worn off or run out stays untimed rather than "fell off"', () => {
    onTarget('pacify', landing('Pacify', 10, { worn_off_at: Date.now() - 1000 }));
    onTarget('visions of grandeur', landing('Visions of Grandeur', 900, { dur_ticks: 20 }));
    report('Pacify', 'Visions of Grandeur');
    for (const n of ['Pacify', 'Visions of Grandeur']) {
      expect(chip(n).remaining_secs).toBe(null);
      expect(chip(n).fell_off).toBeFalsy();
    }
  });

  it('a timer the owner\'s own landings already hold is left alone', () => {
    agent._petBuffLandings.set(ol, new Map([['pacify', { name: 'Pacify', dur_ticks: 5, landed_at: Date.now() }]]));
    onTarget('pacify', landing('Pacify', 10, { dur_ticks: 200 }));
    report('Pacify');
    expect(chip('Pacify').total_secs).toBe(30);
  });
});
