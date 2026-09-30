// An assist on an NPC is not a PvP assist (the guild lead, 2026-09-30: "query and flag any pvp kills that
// are probably an NPC name. trakanon is an NPC"). The server announces a boss kill in the same words as a
// player kill — "Aldenmar of <Wolf Pack> has killed Trakanon in Ruins of Sebilis!" — so the agent credited
// every raider on the boss with a PvP assist. The bot now drops an assist whose victim had no guild, is in
// the NPC catalog, and has never been seen in /who with a class or a guild.
//
// Run: npx vitest run test/pvp-assist-npc-victim.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';
import path from 'node:path';

const bot = readSource(path.join(ROOT, 'index.js'));
const handler = sliceBlock(bot, 'async function _handleAgentPvpAssists(req, res) {', '\n}\n');

// The check itself, run for real against a stub of the two lookups it makes.
function victimCheck(catalog, players) {
  const calls = [];
  const supabase = {
    select: async (table, q) => {
      calls.push(table);
      const name = decodeURIComponent((q.match(/(?:name|character)=ilike\.([^&]+)/) || [])[1] || '').replace(/_/g, ' ').toLowerCase();
      if (table === 'eqemu_npc_types') return catalog.includes(name) ? [{ id: 1 }] : [];
      if (table === 'who_observations') return players.includes(name) ? [{ id: 1 }] : [];
      return [];
    },
  };
  const block = sliceBlock(handler, '  const victimNpcCache = new Map();', '\n    return npc;\n  }');
  const fn = new Function('supabase', block + '\n  return _victimIsNpc;')(supabase);
  return { fn, calls };
}

describe('an assist on an NPC is dropped', () => {
  // Invented names (none of them is anybody). Rethlan stands in for a player who shares an NPC's name.
  const catalog = ['trakanon', 'fright', 'lord of ire', 'rethlan'];
  const players = ['rethlan'];   // /who has seen Rethlan with a class and a guild

  it('a boss with no guild is an NPC', async () => {
    const { fn } = victimCheck(catalog, players);
    expect(await fn('Trakanon', null)).toBe(true);
    expect(await fn('Fright', null)).toBe(true);
    expect(await fn('Lord of Ire', null)).toBe(true);
  });
  it('a player who shares a boss\'s name is still a player', async () => {
    const { fn } = victimCheck(catalog, players);
    expect(await fn('Rethlan', null)).toBe(false);
  });
  it('a victim the broadcast gave a guild is a player, without asking the database', async () => {
    const { fn, calls } = victimCheck(catalog, players);
    expect(await fn('Trakanon', 'Zek')).toBe(false);
    expect(calls).toEqual([]);
  });
  it('a name the catalog does not have is a player; /who is not asked', async () => {
    const { fn, calls } = victimCheck(catalog, players);
    expect(await fn('Nyssara', null)).toBe(false);
    expect(calls).toEqual(['eqemu_npc_types']);
  });
  it('the handler drops the row before it is stored', () => {
    const h = stripJs(handler);
    expect(h).toMatch(/if \(!rosterLower\.has\(assister\.toLowerCase\(\)\)\) \{ dropped\+\+; continue; \}\s*if \(await _victimIsNpc\(victim, a\?\.victim_guild \? String\(a\.victim_guild\) : null\)\) \{ dropped\+\+; continue; \}/);
  });
});
