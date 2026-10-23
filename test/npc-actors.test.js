// test/npc-actors.test.js — one-word MOBS are not players (utils/npcActors.js).
//
// The guild lead, 2026-10-23, after the Tower of Solusek Ro raid: "Jiva is a named mob but was counted as a
// player ... same for all the named bosses in sol ro." Measured on that night's data: character_lockouts held
// rows for "Jiva" on Jiva, "Xuzl" on Arlyxir, "Galremos" on Jiva (the boss is in every upload's tank list, and a
// one-word name passed the character-name shape check), and encounter_players held Galremos with 9.6k and 18.6k
// damage on two fights. Real module, fake database; the wiring in index.js is asserted on comment-stripped text.
//
// Mutation-checked (2026-10-23): dropping the `n === bossKey` branch turns the boss test red; dropping the
// in-zone test (every candidate treated as a mob) turns the "raider is kept" tests red; dropping the
// `exclude` line in participantsFromUpload turns the lockout test red; removing the `_npcActors.has` delete in
// index.js turns the wiring test red.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const npc = nodeRequire('./utils/npcActors');
const kl = nodeRequire('./utils/killLockouts');

// A catalog with the Tower of Solusek Ro block (zone 212) and a character table.
function fakeDb({ characters = [], failNpc = false } = {}) {
  const calls = [];
  return {
    calls,
    isEnabled: () => true,
    guildId: () => 'wolfpack',
    async select(table, q) {
      calls.push([table, q]);
      if (table === 'eqemu_npc_types') {
        if (failNpc) throw new Error('db down');
        if (/name\.eq/.test(q)) {
          if (/Jiva|Galremos|Xuzl|Arlyxir/.test(q)) return [{ id: 212014 }];
          return [];
        }
        return ['Jiva', 'Xuzl', 'Arlyxir', 'Rizlona', 'Galremos', 'Solusek_Ro', 'a_sun_guardian', 'Ra`Shalis', '#Guardian_of_Dresolik']
          .map(name => ({ name }));
      }
      if (table === 'characters') {
        const asked = decodeURIComponent((q.match(/name=in\.\(([^)]*)\)/) || [])[1] || '').split(',');
        return characters.filter(c => asked.includes(c)).map(name => ({ name }));
      }
      return [];
    },
  };
}

beforeEach(() => npc._reset());

describe('npcNamesAmong', () => {
  it('names the boss itself even when the catalog read fails', async () => {
    const out = await npc.npcNamesAmong(['Jiva', 'Aldenmar'], { supabase: fakeDb({ failNpc: true }), bossName: 'Jiva' });
    expect([...out]).toEqual(['jiva']);
  });

  it('names every one-word catalog mob of the boss zone, not just the boss', async () => {
    const out = await npc.npcNamesAmong(['Jiva', 'Xuzl', 'Arlyxir', 'Galremos', 'Aldenmar', 'Brackwyn'],
      { supabase: fakeDb(), bossName: 'Jiva' });
    expect([...out].sort()).toEqual(['arlyxir', 'galremos', 'jiva', 'xuzl']);
  });

  it('keeps raiders: names that are not in the zone block are never mobs', async () => {
    const out = await npc.npcNamesAmong(['Aldenmar', 'Brackwyn', 'Corvale'], { supabase: fakeDb(), bossName: 'Jiva' });
    expect(out.size).toBe(0);
  });

  it('keeps a raider who shares a name with a mob in the zone when the roster has them', async () => {
    const out = await npc.npcNamesAmong(['Rizlona', 'Galremos'], { supabase: fakeDb({ characters: ['Rizlona'] }), bossName: 'Jiva' });
    expect([...out]).toEqual(['galremos']);
  });

  it('uses the caller zone hint instead of looking the boss up', async () => {
    const db = fakeDb();
    const out = await npc.npcNamesAmong(['Xuzl'], { supabase: db, bossName: 'Some Unlisted Boss', zoneId: 212 });
    expect([...out]).toEqual(['xuzl']);
    expect(db.calls.some(([, q]) => /name\.eq/.test(q))).toBe(false);
  });

  it('ignores multi-word and punctuated names (they are filtered as mobs downstream)', async () => {
    const out = await npc.npcNamesAmong(['Ra`Shalis', 'a sun guardian', 'Guardian of Dresolik'], { supabase: fakeDb(), bossName: 'Jiva' });
    expect(out.size).toBe(0);
  });

  it('reads a zone block once and serves the next fight from memory', async () => {
    const db = fakeDb();
    await npc.npcNamesAmong(['Xuzl'], { supabase: db, bossName: 'Jiva' });
    await npc.npcNamesAmong(['Arlyxir'], { supabase: db, bossName: 'Jiva' });
    expect(db.calls.filter(([t, q]) => t === 'eqemu_npc_types' && /id=gte/.test(q)).length).toBe(1);
  });
});

describe('participantsFromUpload', () => {
  const upload = {
    contributor: 'Aldenmar',
    players: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }, { name: 'Galremos' }],
    healers: [{ name: 'Corvale' }],
    defenders: [{ name: 'Jiva' }, { name: 'Brackwyn' }, { name: 'Xuzl' }],
  };

  it('without an exclude set a mob in the tank list is a participant (the shipped bug)', () => {
    expect(kl.participantsFromUpload(upload)).toContain('Jiva');
  });

  it('drops the boss and the zone mobs, keeps every raider', async () => {
    const exclude = await npc.npcNamesAmong(['Aldenmar', 'Brackwyn', 'Galremos', 'Corvale', 'Jiva', 'Xuzl'],
      { supabase: fakeDb(), bossName: 'Jiva' });
    expect(kl.participantsFromUpload({ ...upload, exclude })).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });
});

describe('the ingest path is wired to it', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('removes catalog mobs from playerTotals before the player list is built', () => {
    const at = src.indexOf('npcActorsLib.npcNamesAmong(');
    expect(at).toBeGreaterThan(0);
    const del = src.indexOf('_npcActors.has(n.toLowerCase())) playerTotals.delete(n)', at);
    const build = src.indexOf('const players = [...playerTotals.entries()]', at);
    expect(del).toBeGreaterThan(at);
    expect(build).toBeGreaterThan(del);
  });
  it('hands the same set to the lockout write and to the kill-context participants', () => {
    expect(src).toMatch(/npcActors:\s+_npcActors/);
    expect(src).toMatch(/exclude: _npcActors/);
    expect(src).toMatch(/exclude: npcActors/);
  });
});
