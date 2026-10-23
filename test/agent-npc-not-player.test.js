// test/agent-npc-not-player.test.js — the agent no longer takes a one-word mob for a raider.
//
// The guild lead, 2026-10-23, after the Tower of Solusek Ro raid: "Jiva is a named mob but was counted as a
// player." In the agent, EncounterBuilder "confirmed" any one-word capitalised attacker that hit a mob-shaped
// defender as a player. Quarm's named bosses are one word, so Galremos hitting "a lava giant" (or Jiva hitting a
// charm pet) went into confirmedPlayers; the flush then skipped the fight whose boss was a "confirmed player",
// and the live DPS meter admitted the name as a raider. _isCatalogNpcName asks the zone pack instead.
//
// Mutation-checked (2026-10-23): removing the catalog guard at the confirm site, either flush guard, or the
// threat-admission clause turns the matching source test red; `yes = true` in the helper turns the
// roster-wins and unknown-raider tests red.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const raw = readSource(AGENT_INDEX);
const fnSrc = sliceBlock(raw, 'const _npcMemo = new Map();', '  return yes;\n}');

// The real helper over stub answers: `npcs` is what the zone pack knows, `roster` the raid.
function run({ npcs = [], roster = [], throws = false }, name) {
  const pre = `
    const _knownNpcNotPlayer = (n) => { if (${throws}) throw new Error('x'); return ${JSON.stringify(npcs)}.includes(String(n).toLowerCase()); };
    const _raidRosterHas = (n) => ${JSON.stringify(roster)}.includes(String(n).toLowerCase());
  `;
  return evalBlock(pre + fnSrc, ['_isCatalogNpcName'])._isCatalogNpcName(name);
}

describe('_isCatalogNpcName', () => {
  it('is true for a one-word name the zone pack holds', () => {
    expect(run({ npcs: ['jiva', 'galremos'] }, 'Jiva')).toBe(true);
    expect(run({ npcs: ['jiva', 'galremos'] }, 'Galremos')).toBe(true);
  });
  it('is false for a raider the pack does not know', () => {
    expect(run({ npcs: ['jiva'] }, 'Aldenmar')).toBe(false);
  });
  it('lets the raid roster win over a same-named mob', () => {
    expect(run({ npcs: ['rizlona'], roster: ['rizlona'] }, 'Rizlona')).toBe(false);
  });
  it('is false (fail-open) when the lookup throws', () => {
    expect(run({ npcs: ['jiva'], throws: true }, 'Jiva')).toBe(false);
  });
});

describe('the agent consults it where a name becomes a player', () => {
  const src = stripJs(raw);
  it('does not confirm a catalog mob as a player from its outgoing damage', () => {
    expect(src).toMatch(/if \(defenderIsMobish && !_isCatalogNpcName\(event\.attacker\)\) \{\s*const al = event\.attacker\.toLowerCase\(\);\s*confirmedPlayers\.add\(al\);/);
  });
  it('does not skip a fight because its boss was "confirmed" a player when the catalog says it is a mob', () => {
    expect(src).toMatch(/isConfirmedPlayer\(this\.bossName\) && !_isCatalogNpcName\(this\.bossName\)\) \{\s*this\.reset\(\);/);
    expect(src).toMatch(/const _isPlayer\s+= isConfirmedPlayer\(this\.bossName\) && !_isCatalogNpcName\(this\.bossName\);/);
  });
  it('keeps a catalog mob off the live DPS meter', () => {
    expect(src).toMatch(/attackerIsKnownNpc = attacker && \(this\.targets\.has\(attacker\)\s*\|\| \(attacker !== this\.character && !isConfirmedPlayer\(attacker\) && _isCatalogNpcName\(attacker\)\)\)/);
  });
});
