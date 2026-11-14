// Made-up raid for the Raid HQ draft: 54 raiders in 9 groups of 6. 42 names come from LAB_RAID; the other 12 are
// invented in the same convention and are the "not on Mimic" raiders (a name and a class, no live data).
import { LAB_RAID, labInt, type LabClass } from '../people';
import { calmViewFromRows, type CalmRowInput, type CalmView } from '../../raidRosterCalmView';
import type { Role } from '../../buffs';

const EXTRA: [string, LabClass][] = [
  ['Aurelian', 'Warrior'], ['Bronwyn', 'Cleric'], ['Caldris', 'Wizard'], ['Deverel', 'Rogue'], ['Emrys', 'Monk'],
  ['Fiora', 'Druid'], ['Galvern', 'Ranger'], ['Hestia', 'Enchanter'], ['Ivarro', 'Shaman'], ['Jaelyn', 'Magician'],
  ['Kaedric', 'Paladin'], ['Lysandre', 'Bard'],
];
const ROLE: Record<string, Role> = {
  Warrior: 'tank', 'Shadow Knight': 'tank', Paladin: 'tank', Monk: 'melee', Rogue: 'melee', Ranger: 'melee', Beastlord: 'melee',
  Cleric: 'priest', Druid: 'priest', Shaman: 'priest', Bard: 'bard',
  Wizard: 'caster', Magician: 'caster', Necromancer: 'caster', Enchanter: 'caster',
};
const HAS_MANA = new Set(['priest', 'caster']);
const CAT: Record<string, string[]> = { haste: ['Haste'], attack: ['Attack'], ds: ['Damage shield'], manaRegen: ['Clarity'], resists: ['Resists'] };

// who -> what is wrong with them, in the troubled raid
const HURT: Record<string, number> = { Aldenmar: 38, Dravik: 52, Rethlan: 58 };
const CURSED: Record<string, string> = { Holdfast: 'Gravel Rain', Zarrin: 'Word of Shadow' };
const DEAD = 'Garrow';
const LOW_MANA: Record<string, number> = { Brackwyn: 4 };
const MISSING: Record<string, string[]> = {   // role categories to drop; the first listed is the headline gap
  Corvale: ['manaRegen'], Tolvane: ['haste'], Kestrel: ['attack', 'haste'], Lorcan: ['haste'], Fenwick: ['haste'], Jorund: ['ds'],
};

function build(troubled: boolean): CalmView {
  const live = [...LAB_RAID];
  const extra = [...EXTRA];
  const rows: CalmRowInput[] = [];
  for (let i = 0; i < 54; i++) {
    const noMimic = i % 9 === 3 || i % 9 === 7;
    const p = noMimic ? { name: extra[0][0], cls: extra[0][1] } : { name: live[0].name, cls: live[0].cls };
    if (noMimic) extra.shift(); else live.shift();
    const role = ROLE[p.cls];
    const byCategory: Record<string, string[]> = {};
    for (const c of ['haste', 'attack', 'ds', 'manaRegen', 'resists']) byCategory[c] = CAT[c];
    if (troubled) for (const c of MISSING[p.name] ?? []) delete byCategory[c];
    const hp = noMimic ? null
      : troubled && p.name === DEAD ? 0
      : troubled && HURT[p.name] != null ? HURT[p.name]
      : labInt(p.name, 88, 100);
    const mana = noMimic || !HAS_MANA.has(role) ? null : troubled && LOW_MANA[p.name] != null ? LOW_MANA[p.name] : labInt(p.name, 52, 100, 7);
    const curse = troubled ? CURSED[p.name] : undefined;
    rows.push({
      name: p.name, className: p.cls, role, raidGroup: Math.floor(i / 6) + 1,
      rank: i === 0 ? 'Raid Leader' : null, inRaid: true, noAgent: noMimic, hasAgent: !noMimic,
      hpPct: hp, manaPct: mana, byCategory,
      hpSlots: { A: 'Aegolism', B: 'Focus', C: 'Spirit' },
      buffs: curse ? [{ name: curse, ticks: 12 }] : [],
    });
  }
  return calmViewFromRows(rows, { character: 'Aldenmar' });
}

export const troubledRaid: CalmView = build(true);
export const calmRaid: CalmView = build(false);
