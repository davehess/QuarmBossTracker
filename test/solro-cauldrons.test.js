// test/solro-cauldrons.test.js — the Command Center's Tower of Solusek Ro cauldron rows.
//
// The guild lead, 2026-11-02: "add in for the command center timers the clicks for the braziers for tower of solro
// after the mini bosses are completed." Each wing boss's death leaves a flaming cauldron that depops 30 minutes
// after it spawned; every raider clicks it once for a part of the room flag (SecretsOTheP/quests @572bc06,
// solrotower/*.lua). Runs the agent's REAL tracker (sliced from the source, with the real zone table) and the
// overlay's REAL solroHtml.
//
// Run: npx vitest run test/solro-cauldrons.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const zoneBlock = sliceBlock(agentSrc, 'const MAP_ZONE_SHORT = ', 'return Number.isFinite(n) && n > 0 ? (MAP_ZONE_SHORT[n] || null) : null;\n}');
const deathBlock = sliceBlock(agentSrc, 'const _DEATH_SLAIN_BY_RX', '  return null;\n}\n');
const zoneRxBlock = sliceBlock(agentSrc, 'const CHAT_ZONE_RX = ', '\n');
const solroBlock = sliceBlock(agentSrc, 'const SOLRO_CAULDRON_MS', '// ── end Solusek Ro cauldrons');

let zeal, T;
function fresh() {
  zeal = {};
  const make = new Function('_zealState', zoneBlock + '\n' + zoneRxBlock + '\n' + deathBlock + '\n' + solroBlock
    + '\nreturn { note: _solroNoteLine, snap: _solroSnapshot, state: _solroState };');
  return make(zeal);
}
beforeEach(() => { T = fresh(); });

const WHO = 'Aldenmar';
const MIN = 60e3;
const T0 = Date.UTC(2026, 10, 2, 20, 0, 0);
const say = (text, now = T0) => T.note(`[Mon Nov 02 20:00:00 2026] ${text}`, WHO, now);
const slainBy = (mob, now = T0) => say(`${mob} has been slain by Brackwyn!`, now);
const snap = (now = T0) => T.snap(WHO, now);
const enterTower = () => say('You have entered Tower of Solusek Ro.');
const CLICK = 'As you place your hand on the burning cauldron, you feel ';
const CLICKS = {
  Xuzl: CLICK + 'arcane wisdom pulsing in your mind.',
  Arlyxir: CLICK + 'a wealth of knowledge enter your mind.',
  Dresolik: CLICK + 'a bolt of energy surge through your arm.',
  Rizlona: CLICK + 'relaxed as a short tune slips into your thoughts.',
  Jiva: CLICK + 'your body fill with strength.',
};

describe('the five wings start a cauldron', () => {
  it('is null when nothing has happened', () => {
    expect(snap()).toBeNull();
  });

  it.each([
    ['Xuzl', 'Xuzl', 1],
    ['Arlyxir', 'Arlyxir', 2],
    ['The Protector of Dresolik', 'Dresolik', 3],
    ['Jiva', 'Jiva', 5],
  ])('%s dying starts the %s cauldron (part %i), 30 minutes long', (mob, wing, part) => {
    enterTower();
    slainBy(mob);
    expect(snap()).toEqual([{ wing, part, expires_at: T0 + 30 * MIN, clicked: false }]);
  });

  it('reads "You have slain" and "died." death lines too', () => {
    enterTower();
    say('You have slain Xuzl!');
    say('Jiva died.');
    expect(snap().map(c => c.wing).sort()).toEqual(['Jiva', 'Xuzl']);
  });

  it('lists several at once, soonest depop first', () => {
    enterTower();
    slainBy('Jiva', T0);
    slainBy('Xuzl', T0 - 10 * MIN);
    expect(snap(T0).map(c => c.wing)).toEqual(['Xuzl', 'Jiva']);
  });

  it('ignores other deaths in the tower', () => {
    enterTower();
    slainBy('a fire giant');
    slainBy('Xuzl the Younger');
    expect(snap()).toBeNull();
  });

  it('a boss killed again restarts its cauldron, unclicked', () => {
    enterTower();
    slainBy('Xuzl', T0);
    say(CLICKS.Xuzl, T0 + MIN);
    slainBy('Xuzl', T0 + 40 * MIN);
    expect(snap(T0 + 41 * MIN)).toEqual([{ wing: 'Xuzl', part: 1, expires_at: T0 + 70 * MIN, clicked: false }]);
  });
});

describe('zone', () => {
  it('a wing boss dying outside the tower starts nothing', () => {
    slainBy('Xuzl');                                  // zone unknown
    expect(snap()).toBeNull();
    say('You have entered Plane of Knowledge.');
    slainBy('Xuzl');
    expect(snap()).toBeNull();
  });

  it('uses Zeal\'s zone when it has one', () => {
    zeal[WHO] = { zone: 212 };                        // solrotower
    slainBy('Xuzl');
    expect(snap()).toHaveLength(1);
    T.state.clear();
    zeal[WHO] = { zone: 202 };                        // Plane of Knowledge
    slainBy('Xuzl');
    expect(snap()).toBeNull();
  });

  it('leaving the zone clears every cauldron; re-entering the tower does not', () => {
    enterTower();
    slainBy('Xuzl');
    slainBy('Jiva');
    enterTower();
    expect(snap()).toHaveLength(2);
    say('You have entered Plane of Knowledge.');
    expect(snap()).toBeNull();
    enterTower();
    expect(snap()).toBeNull();
  });
});

describe('Rizlona needs two deaths', () => {
  it('the first death only records it', () => {
    enterTower();
    slainBy('Rizlona', T0);
    expect(snap(T0)).toBeNull();
  });

  it('the second death within 2 h 30 starts the cauldron', () => {
    enterTower();
    slainBy('Rizlona', T0);
    slainBy('Rizlona', T0 + 20 * MIN);
    expect(snap(T0 + 20 * MIN)).toEqual([{ wing: 'Rizlona', part: 4, expires_at: T0 + 50 * MIN, clicked: false }]);
  });

  it('a death more than 2 h 30 after the earlier one is a first death again', () => {
    enterTower();
    slainBy('Rizlona', T0);
    slainBy('Rizlona', T0 + 151 * MIN);
    expect(snap(T0 + 151 * MIN)).toBeNull();
    slainBy('Rizlona', T0 + 160 * MIN);               // ...and that one is the pair of the second
    expect(snap(T0 + 160 * MIN)).toHaveLength(1);
  });

  it('after the cauldron starts, the next Rizlona death begins a new pair', () => {
    enterTower();
    slainBy('Rizlona', T0);
    slainBy('Rizlona', T0 + MIN);
    slainBy('Rizlona', T0 + 5 * MIN);
    expect(snap(T0 + 5 * MIN)[0].expires_at).toBe(T0 + 31 * MIN);
  });

  it('leaving the zone forgets the first death', () => {
    enterTower();
    slainBy('Rizlona', T0);
    say('You have entered Plane of Knowledge.');
    enterTower();
    slainBy('Rizlona', T0 + MIN);
    expect(snap(T0 + MIN)).toBeNull();
  });
});

describe('clicks', () => {
  it.each(Object.keys(CLICKS))('the %s click line marks only that wing clicked', (wing) => {
    enterTower();
    for (const mob of ['Xuzl', 'Arlyxir', 'The Protector of Dresolik', 'Jiva']) slainBy(mob);
    slainBy('Rizlona'); slainBy('Rizlona');
    say(CLICKS[wing], T0 + MIN);
    const got = Object.fromEntries(snap(T0 + MIN).map(c => [c.wing, c.clicked]));
    expect(got).toEqual({ Xuzl: wing === 'Xuzl', Arlyxir: wing === 'Arlyxir', Dresolik: wing === 'Dresolik', Rizlona: wing === 'Rizlona', Jiva: wing === 'Jiva' });
  });

  it('a click with no cauldron up changes nothing, and the disoriented line is ignored', () => {
    enterTower();
    say(CLICKS.Xuzl);
    say('You become disoriented as you pass through the portal of flames.');
    expect(snap()).toBeNull();
    slainBy('Xuzl', T0 + MIN);
    expect(snap(T0 + MIN)[0].clicked).toBe(false);
  });

  it('a click after the cauldron has depopped does not count', () => {
    enterTower();
    slainBy('Xuzl', T0);
    say(CLICKS.Xuzl, T0 + 31 * MIN);
    expect(snap(T0 + 31 * MIN)[0].clicked).toBe(false);
  });

  it('a player typing the click text in chat does not mark it', () => {
    enterTower();
    slainBy('Xuzl');
    say(`Corvale tells the guild, '${CLICKS.Xuzl}'`);
    expect(snap()[0].clicked).toBe(false);
  });
});

describe('expiry', () => {
  it('keeps a depopped row for two minutes, then drops it', () => {
    enterTower();
    slainBy('Xuzl', T0);
    expect(snap(T0 + 30 * MIN + 60e3)).toHaveLength(1);
    expect(snap(T0 + 32 * MIN + 1000)).toBeNull();
  });

  it('keeps one tracker per character', () => {
    enterTower();
    slainBy('Xuzl');
    expect(T.snap('Corvale', T0)).toBeNull();
  });
});

describe('Command Center row', () => {
  const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
  const escBlock = sliceBlock(cmd, '  function esc(s){', '\n');
  const solroHtml = evalBlock(escBlock + '\n' + sliceBlock(cmd, '  function solroHtml(', '\n  }'), ['solroHtml']).solroHtml;
  const plain = (h) => h.replace(/<[^>]+>/g, '');
  const NOW = 1_000_000_000;

  it('shows the wing, the countdown and "click it" with the part number', () => {
    const h = solroHtml([{ wing: 'Xuzl', part: 1, expires_at: NOW + (23 * 60 + 41) * 1000, clicked: false }], NOW);
    expect(plain(h)).toBe('🔥 Xuzl brazier23:41click it (part 1)');
  });
  it('says clicked, in green, once this character has clicked', () => {
    const h = solroHtml([{ wing: 'Jiva', part: 5, expires_at: NOW + 120 * 1000, clicked: true }], NOW);
    expect(plain(h)).toBe('✓ Jiva brazier2:00clicked (part 5)');
    expect(h).toContain('solro done');
  });
  it('goes red under five minutes while unclicked, and dim when gone', () => {
    expect(solroHtml([{ wing: 'Arlyxir', part: 2, expires_at: NOW + 299 * 1000, clicked: false }], NOW)).toContain('solro crit');
    expect(solroHtml([{ wing: 'Arlyxir', part: 2, expires_at: NOW + 301 * 1000, clicked: false }], NOW)).not.toContain('crit');
    const gone = solroHtml([{ wing: 'Arlyxir', part: 2, expires_at: NOW - 1000, clicked: false }], NOW);
    expect(gone).toContain('solro gone');
    expect(plain(gone)).toContain('gone');
  });
  it('is wired into render and the agent sends it and feeds it every live line', () => {
    expect(stripJs(cmd)).toMatch(/if \(s\.solro_cauldrons && s\.solro_cauldrons\.length\) html \+= solroHtml\(s\.solro_cauldrons, Date\.now\(\)\);/);
    expect(stripJs(agentSrc)).toMatch(/solro_cauldrons:\s+_solroSnapshot\(activeChar, Date\.now\(\)\)/);
    expect(stripJs(agentSrc)).toMatch(/_solroNoteLine\(line, b\.character, Date\.now\(\)\)/);
  });
});
