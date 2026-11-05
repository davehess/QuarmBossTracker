// test/solro-warders.test.js — the Mimic Map's Tower of Solusek Ro death-touch warders.
//
// The guild lead, 2026-11-04: "add the warders to the Mimic map". Each wing boss's death spawns three warders that death
// touch (Touch of Vinitras), aggro at 60 and leave after an hour (SecretsOTheP/quests @60e979f solrotower/*.lua;
// eqemu_npc_types 212415-212419). Runs the agent's REAL tracker (the same slice solro-cauldrons.test.js runs) and checks
// the Map draws what the agent sends.
//
// Mutation-checked (by hand, 2026-11-04): drop the `_solroWarderNote(cl, w.wing, now);` call and "a wing boss death puts
// its three warders on the map" fails; drop the 60-minute expiry and "they leave the map after an hour" fails; drop
// `if (SH.warders)`'s aggroRing call and "the Map rings each warder" fails.
//
// Run: npx vitest run test/solro-warders.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const zoneBlock = sliceBlock(agentSrc, 'const MAP_ZONE_SHORT = ', 'return Number.isFinite(n) && n > 0 ? (MAP_ZONE_SHORT[n] || null) : null;\n}');
const deathBlock = sliceBlock(agentSrc, 'const _DEATH_SLAIN_BY_RX', '  return null;\n}\n');
const zoneRxBlock = sliceBlock(agentSrc, 'const CHAT_ZONE_RX = ', '\n');
const solroBlock = sliceBlock(agentSrc, 'const SOLRO_CAULDRON_MS', '// ── end Solusek Ro cauldrons');

let T;
beforeEach(() => {
  const make = new Function('_zealState', zoneBlock + '\n' + zoneRxBlock + '\n' + deathBlock + '\n' + solroBlock
    + '\nreturn { note: _solroNoteLine, warders: _solroWarders };');
  T = make({});
});

const WHO = 'Aldenmar';
const MIN = 60e3;
const T0 = Date.UTC(2026, 10, 4, 1, 0, 0);
const say = (text, now = T0) => T.note(`[Wed Nov 04 20:00:00 2026] ${text}`, WHO, now);
const enterTower = () => say('You have entered Tower of Solusek Ro.');
const slainBy = (mob, now = T0) => say(`${mob} has been slain by Brackwyn!`, now);
const warders = (now = T0, zone = 'solrotower') => T.warders(WHO, zone, now);

describe('the agent sends the warders', () => {
  it('a wing boss death puts its three warders on the map, where the script spawns them', () => {
    enterTower();
    slainBy('Jiva');
    expect(warders()).toEqual([
      { wing: 'Jiva', x: -2211, y: -790, z: -1094, aggro: 60, assist: 0, until: T0 + 60 * MIN },
      { wing: 'Jiva', x: -2255, y: -790, z: -1094, aggro: 60, assist: 0, until: T0 + 60 * MIN },
      { wing: 'Jiva', x: -2301, y: -790, z: -1094, aggro: 60, assist: 0, until: T0 + 60 * MIN },
    ]);
  });

  it('Xuzl\'s help each other out to 100; the Protector stands for Dresolik', () => {
    enterTower();
    slainBy('Xuzl');
    slainBy('The Protector of Dresolik');
    const w = warders();
    expect(w.filter(x => x.wing === 'Xuzl').map(x => x.assist)).toEqual([100, 100, 100]);
    expect(w.filter(x => x.wing === 'Dresolik')).toHaveLength(3);
  });

  it('only the second Rizlona leaves them, like her cauldron', () => {
    enterTower();
    slainBy('Rizlona');
    expect(warders()).toEqual([]);
    slainBy('Rizlona', T0 + 5 * MIN);
    expect(warders(T0 + 5 * MIN).map(x => x.wing)).toEqual(['Rizlona', 'Rizlona', 'Rizlona']);
  });

  it('they leave the map after an hour, and outlive the cauldron', () => {
    enterTower();
    slainBy('Arlyxir');
    expect(warders(T0 + 45 * MIN)).toHaveLength(3);   // the cauldron is long gone by now
    expect(warders(T0 + 60 * MIN + 1)).toEqual([]);
  });

  it('nothing outside the tower, and nothing from a death seen outside it', () => {
    slainBy('Xuzl');   // never entered the tower
    expect(warders()).toEqual([]);
    enterTower();
    slainBy('Xuzl');
    expect(warders(T0, 'pofire')).toEqual([]);
  });
});

describe('the Map draws them', () => {
  const map = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'map.html')));
  const agent = stripJs(agentSrc);
  it('the agent puts them on /api/map-state', () => {
    expect(agent).toMatch(/out\.warders = _solroWarders\(character, zone, now\)/);
  });
  it('the Map rings each warder with its aggro radius, whatever the ◯ switch says', () => {
    expect(map).toMatch(/if \(SH\.warders\) \(P\.warders \|\| \[\]\)\.forEach\(function \(wd\) \{[\s\S]{0,600}aggroRing\(wq\[0\], wq\[1\], ar, as, 'kos'/);
    expect(map).toContain("['warders', 'Sol Ro death-touch warders");
  });
});
