// test/mobinfo-procs.test.js — a mob's procs ride the mob-info answer.
//
// The guild lead, 2026-10-07: "Need to see mobs Procs as well, not just spells." Gaukr
// Sandstorm (Bastion of Thunder) procs Stone Gale on a melee hit; PQDI says "Can proc",
// our Target Info showed only its cast list. Procs are three slots on the npc_spells LIST
// row (attack / range / defensive), inherited from parent_list when the list leaves a slot
// unset, so this runs the real utils/npcProcs.js and then the real _buildMobInfo (sliced
// out of index.js) over a fake catalog.
//
// Fixture ids and names are the catalog's own (game data, not members).
//
// Run: npx vitest run test/mobinfo-procs.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';
const nodeRequire = createRequire(import.meta.url);
const { resolveProcSlots, procEffectSummary, buildProcs } = nodeRequire('../utils/npcProcs.js');

// eqemu_spells 1031, verbatim from the mirror (2026-10-07).
const STONE_GALE = {
  id: 1031, name: 'Stone Gale', targettype: 8, buffduration: 0,
  raw: { eff: [0, 21, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254], base: [-1500, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  effect_id_1: 0, effect_base_value_1: -1500, effect_id_2: 21, effect_base_value_2: 2000, effect_id_3: 254, effect_base_value_3: 0,
};
const NONE = { parent_list: 0, attack_proc: -1, proc_chance: 0, range_proc: -1, rproc_chance: 0, defensive_proc: -1, dproc_chance: 0 };

describe('procEffectSummary', () => {
  it('Stone Gale reads as damage, a stun in seconds, and an area spell', () => {
    expect(procEffectSummary(STONE_GALE)).toBe('1500 dmg · stun 2s · AE');
  });
  it('falls back to the three effect columns when the spell has no raw block', () => {
    const { raw, ...flat } = STONE_GALE;
    expect(procEffectSummary(flat)).toBe('1500 dmg · stun 2s · AE');
  });
  it('a stun of 2.5 s keeps its decimal', () => {
    expect(procEffectSummary({ raw: { eff: [21], base: [2500] }, targettype: 5 })).toBe('stun 2.5s');
  });
  it('damage with a duration is a DoT: per tick, and how long (ticks are 6 s)', () => {
    expect(procEffectSummary({ raw: { eff: [0], base: [-300] }, buffduration: 6, targettype: 5 })).toBe('DoT 300/tick · 36s');
  });
  it('heal, snare, slow, mez, fear, root, dispel', () => {
    const one = (eff, base) => procEffectSummary({ raw: { eff: [eff], base: [base] }, targettype: 5 });
    expect(one(0, 500)).toBe('heal 500');
    expect(one(3, -40)).toBe('snare');
    expect(one(11, 70)).toBe('slow 30%');
    expect(one(31, 0)).toBe('mez');
    expect(one(23, 0)).toBe('fear');
    expect(one(99, 0)).toBe('root');
    expect(one(27, 0)).toBe('dispel');
  });
  it('a haste (attack speed above 100) and a speed buff are not mislabelled', () => {
    expect(procEffectSummary({ raw: { eff: [11, 3], base: [130, 20] }, targettype: 5 })).toBe('');
  });
  it('an unlisted effect digests to nothing, and no spell to nothing', () => {
    expect(procEffectSummary({ raw: { eff: [4], base: [10] }, targettype: 5 })).toBe('');
    expect(procEffectSummary(null)).toBe('');
  });
  it('a repeated effect is said once', () => {
    expect(procEffectSummary({ raw: { eff: [0, 0], base: [-100, -100] }, targettype: 5 })).toBe('100 dmg');
  });
});

describe('resolveProcSlots', () => {
  it('reads the three slots with their chances, in attack / range / defensive order', () => {
    const out = resolveProcSlots([{ ...NONE, defensive_proc: 9, dproc_chance: 5, attack_proc: 1031, proc_chance: 10, range_proc: 7, rproc_chance: 20 }]);
    expect(out).toEqual([
      { kind: 'attack', spell_id: 1031, chance: 10 },
      { kind: 'range', spell_id: 7, chance: 20 },
      { kind: 'defensive', spell_id: 9, chance: 5 },
    ]);
  });
  it('-1 and 0 are none', () => {
    expect(resolveProcSlots([{ ...NONE, attack_proc: 0 }])).toEqual([]);
    expect(resolveProcSlots([NONE])).toEqual([]);
    expect(resolveProcSlots([])).toEqual([]);
    expect(resolveProcSlots(null)).toEqual([]);
  });
  it('a slot the child leaves unset comes from the nearest parent, with that parent\'s chance', () => {
    const child = { ...NONE, parent_list: 2 };
    const parent = { ...NONE, parent_list: 3, attack_proc: 50, proc_chance: 25 };
    const grand = { ...NONE, attack_proc: 60, proc_chance: 99, range_proc: 61, rproc_chance: 15 };
    expect(resolveProcSlots([child, parent, grand])).toEqual([
      { kind: 'attack', spell_id: 50, chance: 25 },
      { kind: 'range', spell_id: 61, chance: 15 },
    ]);
  });
  it('a slot the child sets is not overridden by its parent', () => {
    const out = resolveProcSlots([{ ...NONE, attack_proc: 1, proc_chance: 5 }, { ...NONE, attack_proc: 2, proc_chance: 50 }]);
    expect(out).toEqual([{ kind: 'attack', spell_id: 1, chance: 5 }]);
  });
  it('a proc with no chance keeps the proc and says null', () => {
    expect(resolveProcSlots([{ ...NONE, attack_proc: 1, proc_chance: 0 }])).toEqual([{ kind: 'attack', spell_id: 1, chance: null }]);
  });
});

describe('buildProcs', () => {
  it('names the spell and digests it', () => {
    expect(buildProcs([{ ...NONE, attack_proc: 1031, proc_chance: 10 }], [STONE_GALE])).toEqual([
      { kind: 'attack', spell_id: 1031, name: 'Stone Gale', chance: 10, summary: '1500 dmg · stun 2s · AE' },
    ]);
  });
  it('a spell the mirror lacks still shows, by id, with no summary', () => {
    expect(buildProcs([{ ...NONE, attack_proc: 4242, proc_chance: 10 }], [])).toEqual([
      { kind: 'attack', spell_id: 4242, name: 'Spell #4242', chance: 10, summary: '' },
    ]);
  });
});

// ── The wire: the real _buildMobInfo ─────────────────────────────────────────────────────
describe('_buildMobInfo carries procs', () => {
  const SRC = readSource(BOT_INDEX);
  const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
  const helpers = [
    sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
    sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ].join('\n');
  const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
  const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior', 12:'Wizard' };";

  const body = (id, name, npc_spells_id) => ({
    id, name, class: 12, level: 65, maxlevel: 65, hp: 1000, mana: 0, ac: 10, mr: 0, fr: 0, cr: 0, pr: 0, dr: 0,
    mindmg: 1, maxdmg: 2, runspeed: 1.25, npcspecialattks: '', special_abilities: '', raid_target: 0,
    bodytype: 1, npc_spells_id, see_invis: 0, see_invis_undead: 0, see_hide: 0, see_improved_hide: 0, race: 1, gender: 0,
  });
  let lists, spells, entries, bodies, calls, failSpells, warns;
  beforeEach(() => {
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => { warns.push(a.join(' ')); });
    calls = []; failSpells = false;
    bodies = [body(209071, 'Gaukr_Sandstorm', 573), body(209072, 'a_plain_thing', 0), body(209073, 'a_looper', 800)];
    lists = {
      573: { id: 573, ...NONE, parent_list: 1441, attack_proc: 1031, proc_chance: 10 },
      1441: { id: 1441, ...NONE },
      800: { id: 800, ...NONE, parent_list: 801 },
      801: { id: 801, ...NONE, parent_list: 800, attack_proc: 1031, proc_chance: 30 },   // a cycle: the walk must stop
    };
    spells = { 1031: STONE_GALE };
    entries = [];
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const sb = () => ({
    select: async (table, q) => {
      calls.push({ table, q });
      if (table === 'eqemu_npc_types') {
        const want = decodeURIComponent(q.slice('or=(name.ilike.'.length, q.indexOf(',name.ilike')));
        return bodies.filter(b => b.name.toLowerCase() === want.toLowerCase());
      }
      if (table === 'eqemu_npc_spells') { const m = /^id=eq\.(\d+)&/.exec(q); return lists[m[1]] ? [lists[m[1]]] : []; }
      if (table === 'eqemu_npc_spells_entries') return entries;
      if (table === 'eqemu_spells') {
        if (failSpells && !/mana/.test(q)) throw new Error('boom');
        const ids = /id=in\.\(([\d,]+)\)/.exec(q)[1].split(',').map(Number);
        return ids.map(i => spells[i]).filter(Boolean);
      }
      return [];
    },
  });
  const build = () => new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'process', 'console',
    `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
    nodeRequire('../utils/mobSpecials.js'), { getIndex: async () => null, assistFor: () => null }, async () => null,
    nodeRequire('../utils/npcProcs.js'), process, console);
  const ask = (name) => build()(sb(), { name, norm: name.toLowerCase(), caseKey: name, reqZoneId: 209, reqGender: null });

  it('Gaukr Sandstorm carries Stone Gale as an attack proc at 10%', async () => {
    const mob = await ask('Gaukr_Sandstorm');
    expect(warns).toEqual([]);
    expect(mob.procs).toEqual([{ kind: 'attack', spell_id: 1031, name: 'Stone Gale', chance: 10, summary: '1500 dmg · stun 2s · AE' }]);
    expect(mob.spells).toEqual([]);                       // it has no cast list; the proc does not depend on one
  });
  it('the proc columns are asked for on the same walk that finds the parent list', async () => {
    await ask('Gaukr_Sandstorm');
    const q = calls.filter(c => c.table === 'eqemu_npc_spells').map(c => c.q);
    expect(q).toHaveLength(2);                            // 573, then its parent 1441
    for (const s of q) expect(s).toMatch(/select=parent_list,attack_proc,proc_chance,range_proc,rproc_chance,defensive_proc,dproc_chance/);
  });
  it('a mob whose list has no procs, and one with no list at all, answer procs: []', async () => {
    lists[573] = { id: 573, ...NONE, parent_list: 1441 };
    expect((await ask('Gaukr_Sandstorm')).procs).toEqual([]);
    const plain = await ask('a_plain_thing');
    expect(plain.procs).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(plain, 'procs')).toBe(true);
    expect(calls.some(c => c.table === 'eqemu_spells')).toBe(false);   // nothing to look up
  });
  it('inherits the parent\'s proc when the child leaves the slot unset', async () => {
    lists[573] = { id: 573, ...NONE, parent_list: 1441 };
    lists[1441] = { id: 1441, ...NONE, attack_proc: 1031, proc_chance: 40 };
    expect((await ask('Gaukr_Sandstorm')).procs.map(p => [p.spell_id, p.chance])).toEqual([[1031, 40]]);
  });
  it('a parent cycle ends and still resolves', async () => {
    expect((await ask('a_looper')).procs.map(p => p.spell_id)).toEqual([1031]);
  });
  it('a failed spell lookup keeps the proc, named by id, and never loses the mob', async () => {
    failSpells = true;
    const mob = await ask('Gaukr_Sandstorm');
    expect(mob).not.toBeNull();
    expect(mob.procs).toEqual([{ kind: 'attack', spell_id: 1031, name: 'Spell #1031', chance: 10, summary: '' }]);
    expect(warns.some(w => /proc spells fetch failed/.test(w))).toBe(true);
  });
  it('the fields the answer always had are untouched', async () => {
    entries = [{ spellid: 1031, manacost: -1, recast_delay: -1, priority: 1, minlevel: 0, maxlevel: 0, type: 1, min_hp: null, max_hp: null, npc_spells_id: 573 }];
    spells[1031] = { ...STONE_GALE, mana: 100, cast_time: 3000, resist_type: 0, resist_diff: 0, good_effect: 0, cast_on_other: 'x', cast_on_you: 'y' };
    const mob = await ask('Gaukr_Sandstorm');
    expect(mob.spells).toHaveLength(1);
    expect(Object.keys(mob.spells[0]).sort()).toEqual(['cast_ms', 'good', 'hp_window', 'id', 'maxlevel', 'minlevel', 'mana', 'name', 'other', 'priority', 'recast_ms', 'resist_diff', 'resist_type', 'type', 'you'].sort());
    expect(mob.id).toBe(209071);
  });
});
