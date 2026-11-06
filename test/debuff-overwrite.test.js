// test/debuff-overwrite.test.js — an overwritten debuff drops off Target info (the guild lead, 2026-11-06):
// Malo (shaman, -45) and Malosinia (enchanter, -70) were both listed on one mob. They cannot coexist: the
// stronger overwrites the weaker and a weaker cast onto a stronger is blocked, and both print the same landing
// line. The rule is the server's (EQMacEmu zone/buffstacking.cpp, Mob::FindAffectSlot, NPC target), carried by
// the bot catalog's per-spell `st` signature. The server also tells the OVERWRITTEN spell's caster "Your Malo
// spell has worn off.", which the agent now honours for any debuff it cast (it was mez only).
//
// The REAL agent is driven (require): landings through recordTargetBuffLanding, rows through targetBuffsFor
// and _applyStackToRows. Spell numbers for Malo / Malosinia are eqemu_spells rows (1578 / 3387); the Tashan
// pair is a FIXTURE (ids and values invented to exercise the same rule, not copied from the table).
//
// Run: npx vitest run test/debuff-overwrite.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const MOB = 'a test sentry';
const T0 = Date.now() - 120_000;
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();

const resist = (v) => [[1, 47, v], [2, 50, v], [3, 48, v], [4, 46, v]];
const spell = (id, name, st, extra = {}) => ({ id, name, good: 0, dur: 1000, durf: 3, ...(st ? { st } : {}), ...extra });
const CATALOG = [
  spell(1578, 'Malo', resist(-45)),
  spell(3387, 'Malosinia', resist(-70)),
  spell(2100, 'Tashani', resist(-40)),
  spell(2101, 'Tashanian', resist(-60)),
  spell(2200, 'Fixture Rot', [[0, 0, 5]], { sws: 1 }),   // a DoT-bearing spell: sws = coexists with itself from another caster
  spell(2300, 'Mesmerize', null, { cc: ['mez'] }),
];
const OLD_CATALOG = CATALOG.map(({ st, sws, ...rest }) => rest);   // a bot that predates `st`

const land = (name, sec, extra = {}) => agent.recordTargetBuffLanding({
  spell_name: name, target: MOB, cast_at: iso(sec), dur_formula: 3, dur_ticks: 1000, ...extra,
});
const shown = () => agent.targetBuffsFor(MOB.toLowerCase()).map(b => b.name + (b.fell_off ? '(fell)' : ''));

beforeEach(() => {
  agent._buffLandingsByTarget.clear();
  agent._setSpellCatalogForTest(CATALOG);
});

describe('overwrite on landing', () => {
  it('Malo then Malosinia: Malo is ended, only Malosinia shows', () => {
    land('Malo', 0); land('Malosinia', 10);
    expect(shown()).toEqual(['Malosinia']);
    const malo = agent._buffLandingsByTarget.get(MOB).get('malo');
    expect(malo.worn_off_at).toBe(T0 + 10_000);
    expect(malo.overwritten_by).toBe('Malosinia');
  });

  it('Malosinia then Malo: the weaker cast was blocked, so Malo is never added', () => {
    land('Malosinia', 0); land('Malo', 10);
    expect(shown()).toEqual(['Malosinia']);
    expect(agent._buffLandingsByTarget.get(MOB).has('malo')).toBe(false);
  });

  it('Tashani then Tashanian drops Tashani; the same pair in the other order keeps only Tashanian', () => {
    land('Tashani', 0); land('Tashanian', 10);
    expect(shown()).toEqual(['Tashanian']);
    agent._buffLandingsByTarget.clear();
    land('Tashanian', 0); land('Tashani', 10);
    expect(shown()).toEqual(['Tashanian']);
  });

  it('is order-independent: a late-arriving older landing gives the same answer', () => {
    land('Malosinia', 10); land('Malo', 0);       // the Malo landing was logged first but reached us second
    expect(shown()).toEqual(['Malosinia']);
    const a = shown();
    agent._buffLandingsByTarget.clear();
    land('Malo', 0); land('Malosinia', 10);
    expect(shown()).toEqual(a);
  });

  it('spells that do not collide both stay', () => {
    land('Malo', 0); land('Fixture Rot', 5);
    expect(shown().sort()).toEqual(['Fixture Rot', 'Malo']);
  });

  it('a bot catalog without `st` behaves exactly as before: both are kept', () => {
    agent._setSpellCatalogForTest(OLD_CATALOG);
    land('Malo', 0); land('Malosinia', 10);
    expect(shown().sort()).toEqual(['Malo', 'Malosinia']);
  });

  it('charm and fear spells never take part, even with a signature', () => {
    agent._setSpellCatalogForTest([
      spell(1, 'Charm One', resist(-10), { cc: ['charm'] }), spell(2, 'Charm Two', resist(-90), { cc: ['charm'] })]);
    land('Charm One', 0); land('Charm Two', 10);
    expect(shown().sort()).toEqual(['Charm One', 'Charm Two']);
  });
});

describe('same spell twice (the DoT exception)', () => {
  const items = (a, b) => [
    { name: 'Fixture Rot', at: T0 + 1000, caster: a }, { name: 'Fixture Rot', at: T0 + 2000, caster: b }];

  it('a DoT from two different casters coexists', () => {
    const it = items('Aldenmar', 'Brackwyn');
    const r = agent._stackReplay(it);
    expect(r.ended.size).toBe(0);
    expect(r.blocked.size).toBe(0);
  });

  it('the same caster recasting replaces the older one', () => {
    const it = items('Aldenmar', 'Aldenmar');
    expect(agent._stackReplay(it).ended.has(it[0])).toBe(true);
  });

  it('merged rows: both DoT rows survive; a non-DoT same-name pair is the one the dedup already collapses', () => {
    const rows = [
      { name: 'Fixture Rot', observed_at_ms: T0 + 1000, caster: 'Aldenmar' },
      { name: 'Fixture Rot', observed_at_ms: T0 + 2000, caster: 'Brackwyn' }];
    expect(agent._applyStackToRows(rows)).toHaveLength(2);
  });
});

describe('merged Target info rows (local + relay)', () => {
  const row = (name, sec, extra = {}) => ({ name, observed_at_ms: T0 + sec * 1000, good: 0, remaining_secs: 300, ...extra });

  it('drops the overwritten row, whatever order the rows come in', () => {
    const rows = [row('Malo', 0), row('Malosinia', 10), row('Fixture Rot', 20)];
    const a = agent._applyStackToRows(rows).map(r => r.name).sort();
    const b = agent._applyStackToRows(rows.slice().reverse()).map(r => r.name).sort();
    expect(a).toEqual(['Fixture Rot', 'Malosinia']);
    expect(b).toEqual(a);
    expect(agent._applyStackToRows([row('Malosinia', 0), row('Malo', 10)]).map(r => r.name)).toEqual(['Malosinia']);
  });

  it('leaves rows alone without a catalog signature, for fell-off rows, and for beneficial ones', () => {
    agent._setSpellCatalogForTest(OLD_CATALOG);
    expect(agent._applyStackToRows([row('Malo', 0), row('Malosinia', 10)])).toHaveLength(2);
    agent._setSpellCatalogForTest(CATALOG);
    expect(agent._applyStackToRows([row('Malo', 0, { fell_off: true }), row('Malosinia', 10)])).toHaveLength(2);
  });

  it('rows proven to be different spawns of the same name do not overwrite each other', () => {
    const rows = [row('Malo', 0, { target_id: 11 }), row('Malosinia', 10, { target_id: 12 })];
    expect(agent._applyStackToRows(rows)).toHaveLength(2);
  });
});

describe('"Your <spell> spell has worn off."', () => {
  const ME = 'Aldenmar';
  const wornOff = (spellName) => `[Fri Nov 06 21:10:00 2026] Your ${spellName} spell has worn off.`;

  it('ends the caster\'s own Malo (it was overwritten by Malosinia from someone else)', () => {
    land('Malo', 0, { _selfCast: true, observer: ME });
    expect(shown()).toEqual(['Malo']);
    agent.noteMyMezWornOff(wornOff('Malo'), ME);
    expect(shown()).toEqual(['Malo(fell)']);
  });

  it('ignores a spell somebody else cast, and a spell that is not a debuff', () => {
    land('Malo', 0, { _selfCast: true, observer: 'Brackwyn' });
    agent.noteMyMezWornOff(wornOff('Malo'), ME);
    expect(shown()).toEqual(['Malo']);
    agent._setSpellCatalogForTest([spell(7, 'Fixture Buff', null, { good: 1 })]);
    land('Fixture Buff', 0, { _selfCast: true, observer: ME });
    agent.noteMyMezWornOff(wornOff('Fixture Buff'), ME);
    expect(shown().filter(n => n.startsWith('Fixture'))).toEqual(['Fixture Buff']);
  });

  it('a mez worn off still works exactly as before', () => {
    land('Mesmerize', 0, { _selfCast: true, observer: ME });
    expect(shown().sort()).toEqual(['Mesmerize']);
    agent.noteMyMezWornOff(wornOff('Mesmerize'), ME);
    expect(shown()).toEqual(['Mesmerize(fell)']);
  });
});
