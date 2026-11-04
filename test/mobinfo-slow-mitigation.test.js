// test/mobinfo-slow-mitigation.test.js — the mob-info payload carries a mob's partial slow resistance.
//
// The guild lead, 2026-11-04: "Obsidian Tree Spider Queen is only partially slowable apparently." The server
// (EQMacEmu zone/bonuses.cpp) shrinks a slow by npc_types.slow_mitigation percent and tells the client nothing.
//
// Run: npx vitest run test/mobinfo-slow-mitigation.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const ms = nodeRequire('../utils/mobSpecials.js');
const SRC = readSource(BOT_INDEX);
const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
const helpers = [
  sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
  sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
].join('\n');
const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior' };";

const ask = async (row) => {
  const queries = [];
  const sb = { select: async (table, q) => { queries.push(q); return table === 'eqemu_npc_types' ? [row] : []; } };
  const build = new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'process', 'console', 'namedBosses',
    `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
    ms, { getIndex: async () => null, assistFor: () => null }, async () => null,
    nodeRequire('../utils/npcProcs.js'), process, console, nodeRequire('../utils/namedBosses.js'));
  const mob = await build(sb, { name: row.name, norm: row.name.toLowerCase(), caseKey: row.name, reqZoneId: null, reqGender: null });
  return { mob, queries };
};
const base = { id: 1, name: 'Obsidian_Tree_Spider_Queen', class: 1, level: 60, hp: 100000, gender: 2, special_abilities: '', npcspecialattks: '' };

describe('mob-info slow_mitigation', () => {
  it('returns the catalog percent', async () => {
    const { mob } = await ask({ ...base, slow_mitigation: 80 });
    expect(mob.slow_mitigation).toBe(80);
  });
  it('is 0 for a null, missing or junk value, and clamped to 0..100', async () => {
    expect((await ask({ ...base, slow_mitigation: null })).mob.slow_mitigation).toBe(0);
    expect((await ask({ ...base })).mob.slow_mitigation).toBe(0);
    expect((await ask({ ...base, slow_mitigation: 250 })).mob.slow_mitigation).toBe(100);
  });
  it('asks the catalog for the column', async () => {
    const { queries } = await ask({ ...base, slow_mitigation: 80 });
    expect(queries[0]).toMatch(/,slow_mitigation&limit=200/);
  });
  it('the zone pack shape moved so cached packs rebuild', () => {
    expect(stripJs(SRC)).toMatch(/const _MOB_PACK_VERSION = 11;/);
  });
});
