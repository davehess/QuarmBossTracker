// test/charm-keeps-buffs.test.js — a charm land keeps what is on the mob when we can prove it is the same mob.
//
// The guild lead, 2026-10-13: "Charm landing should not clear buffs and debuffs if we have the timers … If it is done via
// an NPC we treat it as that level mob's cast timer." Three rules, through the real agent:
//   · re-charming the SAME spawn after a break keeps the pet's buffs (they are still on it in game);
//   · a pre-charm debuff proven (by spawn id) to be on this mob rides over at any age; one proven to be on another
//     spawn never does; an unproven one keeps the old 60 s window;
//   · a landing an NPC provably cast is timed at that NPC's level, not the era cap.
//
// Run: npx vitest run test/charm-keeps-buffs.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');

const OWNER = 'Aldenmar';
const PET = 'a cragbeast queen';
const ol = OWNER.toLowerCase(), pl = PET.toLowerCase();

const target = (id) => agent._setZealStateForTest(OWNER, { target_name: PET, target_id: id, updatedAt: Date.now() });
const land = () => agent._bumpCharmTick(PET, OWNER, 'land', Date.now(), { charm_spell_name: 'Allure', duration_sec: 120 });
const brk = () => agent._bumpCharmTick(PET, OWNER, 'break', Date.now(), {});
const petHas = (spell) => !!(agent._petBuffLandings.get(ol) && agent._petBuffLandings.get(ol).has(spell));

beforeEach(() => {
  agent._charmTickTracker.clear();
  agent._petBuffLandings.clear();
  agent._buffLandingsByTarget.clear();
  agent._npcCastStarts.length = 0;
  agent._setZealStateForTest(OWNER, null);
});

describe('re-charming after a break', () => {
  const haste = () => agent._petBuffLandings.set(ol, new Map([['augmentation', { name: 'Augmentation', dur_ticks: 270, landed_at: Date.now() }]]));
  it('keeps the pet buffs when it is the same spawn again', () => {
    target(1817); land(); haste(); brk();
    target(1817); land();
    expect(petHas('augmentation')).toBe(true);
  });
  it('drops them for another spawn of the same name', () => {
    target(1817); land(); haste(); brk();
    target(1990); land();
    expect(petHas('augmentation')).toBe(false);
  });
  it('drops them when no spawn id is known (a same-named mob cannot be ruled out)', () => {
    target(null); land(); haste(); brk();
    land();
    expect(petHas('augmentation')).toBe(false);
  });
});

describe('pre-charm debuffs on the mob', () => {
  const debuff = (key, ageSec, targetId) => {
    const mp = agent._buffLandingsByTarget.get(pl) || new Map();
    mp.set(key, { name: key, dur_ticks: 100, landed_at: Date.now() - ageSec * 1000, target_id: targetId, target_name: PET });
    agent._buffLandingsByTarget.set(pl, mp);
  };
  it('one proven on this spawn rides over at any age while its timer runs', () => {
    debuff('tashanian', 300, 1817);
    target(1817); land();
    expect(petHas('tashanian')).toBe(true);
  });
  it('one proven on another spawn never rides over, even fresh', () => {
    debuff('tashanian', 5, 1990);
    target(1817); land();
    expect(petHas('tashanian')).toBe(false);
  });
  it('an unproven one keeps the 60 s window', () => {
    debuff('fresh', 10, null);
    debuff('stale', 300, null);
    target(1817); land();
    expect(petHas('fresh')).toBe(true);
    expect(petHas('stale')).toBe(false);
  });
});

describe('an NPC-cast landing is timed at that NPC\'s level', () => {
  beforeEach(() => {
    agent._mobInfoByNameForTest().set('test|a sarnak conscript', {
      mob: { name: 'a sarnak conscript', level: 42, spells: [{ id: 1, name: 'Shield of Thorns' }] },
    });
  });
  it('a mob that began casting and has the spell in its list names the level', () => {
    const now = Date.now();
    agent._npcCastStarts.push({ caster: 'a sarnak conscript', atMs: now - 3000 });
    expect(agent._npcCasterLevelFor('Shield of Thorns', now)).toBe(42);
  });
  it('no level when the casting mob does not have the spell, or cast too long ago', () => {
    const now = Date.now();
    agent._npcCastStarts.push({ caster: 'a sarnak conscript', atMs: now - 3000 });
    expect(agent._npcCasterLevelFor('Spirit of Wolf', now)).toBe(null);
    agent._npcCastStarts.length = 0;
    agent._npcCastStarts.push({ caster: 'a sarnak conscript', atMs: now - 60_000 });
    expect(agent._npcCasterLevelFor('Shield of Thorns', now)).toBe(null);
  });
});
