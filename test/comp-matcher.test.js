// test/comp-matcher.test.js — #93 comp template + planned-vs-actual matcher.
//
// Real-imports the new pure lib (web/lib/comp.ts). Covers the class→archetype
// mapping, template validation, and the gap math from a fixture template + a
// signup list (shortfalls, surpluses, per-class needs, unmapped signups).

import { describe, it, expect } from 'vitest';
import {
  classToArchetype,
  validateTemplate,
  computeCompGaps,
  templateDemand,
  summarizeSignups,
} from '../web/lib/comp.ts';

describe('classToArchetype', () => {
  it('maps the tank / healer / support / melee / ranged roles', () => {
    expect(classToArchetype('Warrior')).toBe('tank');
    expect(classToArchetype('Shadow Knight')).toBe('tank');
    expect(classToArchetype('Cleric')).toBe('healer');
    expect(classToArchetype('Shaman')).toBe('healer');
    expect(classToArchetype('Enchanter')).toBe('support');
    expect(classToArchetype('Bard')).toBe('support');
    expect(classToArchetype('Rogue')).toBe('melee');
    expect(classToArchetype('Beastlord')).toBe('melee');
    expect(classToArchetype('Wizard')).toBe('ranged');
    expect(classToArchetype('Necromancer')).toBe('ranged');
  });

  it('folds level titles and rejects junk', () => {
    expect(classToArchetype('Warlord')).toBe('tank');     // L60 Warrior title
    expect(classToArchetype('Prophet')).toBe('healer');   // L65 Shaman title
    expect(classToArchetype('')).toBeNull();
    expect(classToArchetype(null)).toBeNull();
    expect(classToArchetype('Bartender')).toBeNull();
  });
});

// Fixture: an MT group (1 war tank + 2 clr) plus a caster group (archetype
// slots), with a raid-wide healer minimum floor.
const TEMPLATE = {
  name: 'Test 12',
  groups: [
    { name: 'MT Group', requires: [
      { class: 'Warrior', count: 1 },
      { class: 'Cleric', count: 2 },
      { archetype: 'support', count: 1 },
    ] },
    { name: 'Caster Group', requires: [
      { archetype: 'ranged', count: 3 },
      { archetype: 'healer', count: 1 },
    ] },
  ],
  minimums: [
    { archetype: 'healer', count: 4 },   // floor higher than the 3 groups imply
  ],
};

describe('validateTemplate', () => {
  it('accepts the fixture', () => {
    const r = validateTemplate(TEMPLATE);
    expect(r.ok).toBe(true);
  });

  it('rejects a slot that is neither class nor archetype', () => {
    const r = validateTemplate({ name: 'x', groups: [{ name: 'g', requires: [{ count: 1 }] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/needs a "class" or an "archetype"/);
  });

  it('rejects an unknown archetype and a bad count', () => {
    const r = validateTemplate({ name: 'x', groups: [{ name: 'g', requires: [
      { archetype: 'dps', count: 1 },
      { class: 'Cleric', count: -2 },
    ] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown archetype/);
    expect(r.errors.join(' ')).toMatch(/non-negative integer/);
  });

  it('rejects a missing name / groups', () => {
    const r = validateTemplate({ groups: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/"name" is required/);
    expect(r.errors.join(' ')).toMatch(/"groups" must be an array/);
  });
});

describe('templateDemand', () => {
  it('expands class slots into both class and archetype demand, minimums as floor', () => {
    const d = templateDemand(TEMPLATE);
    // tank: 1 warrior. healer: 2 clr (MT) + 1 (caster grp) = 3, floored up to 4.
    expect(d.requiredArch.tank).toBe(1);
    expect(d.requiredArch.healer).toBe(4);       // floor 4 > group-implied 3
    expect(d.requiredArch.support).toBe(1);
    expect(d.requiredArch.ranged).toBe(3);
    expect(d.requiredClass.Warrior).toBe(1);
    expect(d.requiredClass.Cleric).toBe(2);
    // total headcount = additive group slots only (1+2+1 + 3+1 = 8), minimums float.
    expect(d.totalRequired).toBe(8);
  });
});

describe('summarizeSignups', () => {
  it('counts classes + archetypes and flags unmapped', () => {
    const s = summarizeSignups([
      { className: 'Warrior' }, { className: 'Cleric' }, { className: 'Cleric' },
      { className: 'Wizard' }, { className: null }, { className: 'Bartender' },
    ]);
    expect(s.byClass.Cleric).toBe(2);
    expect(s.byArchetype.healer).toBe(2);
    expect(s.byArchetype.tank).toBe(1);
    expect(s.byArchetype.ranged).toBe(1);
    expect(s.unmapped).toBe(2);   // null + unknown class
  });
});

describe('computeCompGaps', () => {
  it('reports shortfalls, surpluses, and per-class needs', () => {
    const signups = [
      { className: 'Warrior' },       // tank 1/1
      { className: 'Cleric' },        // healer 1
      { className: 'Enchanter' },     // support 1/1
      { className: 'Rogue' }, { className: 'Rogue' }, { className: 'Monk' }, // melee 3 (0 required → over)
      { className: 'Wizard' }, { className: 'Magician' },   // ranged 2/3
      { className: null },            // unmapped
    ];
    const g = computeCompGaps(TEMPLATE, signups);

    const arch = Object.fromEntries(g.archetypes.map(a => [a.archetype, a]));
    expect(arch.tank.delta).toBe(0);           // 1 have / 1 req
    expect(arch.healer.delta).toBe(-3);        // 1 have / 4 req
    expect(arch.ranged.delta).toBe(-1);        // 2 have / 3 req
    expect(arch.support.delta).toBe(0);        // 1 have / 1 req
    expect(arch.melee.delta).toBe(3);          // 3 have / 0 req → surplus

    expect(g.unmapped).toBe(1);
    expect(g.totalHave).toBe(9);

    // Per-class shortfall: template wants 2 Clerics, only 1 signed.
    const cleric = g.classes.find(c => c.class === 'Cleric');
    expect(cleric.delta).toBe(-1);

    // Summary phrasing.
    expect(g.summary).toContain('Need 3 more healer');
    expect(g.summary).toContain('3 over on melee DPS');
    expect(g.summary).toContain('Need 1 more Cleric');
  });

  it('reports a met composition cleanly', () => {
    const template = { name: 'tiny', groups: [{ name: 'g', requires: [{ archetype: 'tank', count: 1 }] }] };
    const g = computeCompGaps(template, [{ className: 'Warrior' }]);
    expect(g.summary).toEqual(['Composition meets the template.']);
  });
});
