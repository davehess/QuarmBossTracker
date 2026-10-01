// test/threat-concussion-zoning.test.js — the threat meter for the people who don't want to get hit
// (the guild lead, 2026-10-01: "A for now, B later. It's for the non-tanks primarily that don't want
// to get hit"). Your own meter only (B, other raiders' meters, comes later):
//   · Concussion -400 and Ancient: Greater Concussion -600, Jolt and Cinder Jolt -500, the spells' own
//     hate effect; Voice of Quellious (a mana buff) no longer counts as -2500.
//   · a resisted one still takes its hate off and adds nothing more; a fizzle or an interrupt inside
//     the cast time hands it back.
//   · "LOADING, PLEASE WAIT..." (zoning, and the evac spells, which reload the zone) clears your
//     hate and your pet's, and leaves the damage meter alone.
// Runs the real agent. Names are invented.
//
// Run: npx vitest run test/threat-concussion-zoning.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const line = (sec, text) => `[Wed Sep 30 22:08:${String(sec).padStart(2, '0')} 2026] ${text}`;
function feed(b, sec, text) {
  const l = line(sec, text);
  b._threatLine(l);
  const ev = agent.parseEvent(l, agent.parseEqTimestamp(l));
  if (ev) b.add(ev);
}
const me = (b) => b.threatBy.get('Aldenmar');

describe('wizard de-aggro spells', () => {
  it('Concussion takes 400 off, Ancient: Greater Concussion 600, Jolt and Cinder Jolt 500', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    feed(b, 0, 'You slash a Shissar acolyte for 100 points of damage.');
    const start = me(b).spell;
    feed(b, 1, 'You begin casting Concussion.');
    expect(me(b).spell - start).toBe(-400);
    feed(b, 10, 'You begin casting Ancient: Greater Concussion.');
    expect(me(b).spell - start).toBe(-1000);
    feed(b, 20, 'You begin casting Jolt.');
    feed(b, 30, 'You begin casting Cinder Jolt.');
    expect(me(b).spell - start).toBe(-2000);
    expect(me(b).procDetail.Concussion).toBe(1);
  });

  it('Voice of Quellious is a mana buff and changes nothing', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    feed(b, 0, 'You slash a Shissar acolyte for 100 points of damage.');
    const before = { ...me(b) };
    feed(b, 1, 'You begin casting Voice of Quellious.');
    expect(me(b).spell).toBe(before.spell);
  });

  it('a resisted Concussion keeps its -400 and adds no resist hate; another resisted spell still does', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    feed(b, 0, 'You slash a Shissar acolyte for 100 points of damage.');
    const start = me(b).spell;
    feed(b, 1, 'You begin casting Concussion.');
    feed(b, 3, 'Your target resisted the Concussion spell.');
    expect(me(b).spell - start).toBe(-400);
    feed(b, 10, 'Your target resisted the Rune of Rikkukin spell.');
    expect(me(b).spell - start).toBe(-400 + 120);
  });

  it('a fizzle or an interrupt inside the cast time hands the hate back', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    feed(b, 0, 'You slash a Shissar acolyte for 100 points of damage.');
    const start = me(b).spell;
    feed(b, 1, 'You begin casting Concussion.');
    feed(b, 2, 'Your spell is interrupted.');
    expect(me(b).spell).toBe(start);
    expect(me(b).procDetail.Concussion).toBe(0);
    feed(b, 5, 'You begin casting Concussion.');
    feed(b, 5, 'Your spell fizzles!');
    expect(me(b).spell).toBe(start);
  });

  it('an interrupt long after the cast is some later spell\'s, and changes nothing', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    feed(b, 0, 'You slash a Shissar acolyte for 100 points of damage.');
    const start = me(b).spell;
    feed(b, 1, 'You begin casting Concussion.');
    feed(b, 30, 'Your spell is interrupted.');
    expect(me(b).spell - start).toBe(-400);
  });
});

describe('zoning out', () => {
  function fight() {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar' });
    b.petLeaders.kebantik = '__SELF__';
    feed(b, 0, 'You slash a Shissar acolyte for 300 points of damage.');
    feed(b, 1, 'Kebantik hits a Shissar acolyte for 45 points of damage.');
    feed(b, 2, 'Brackwyn hits a Shissar acolyte for 500 points of damage.');
    return b;
  }

  it('LOADING, PLEASE WAIT clears your hate and your pet\'s, and nobody else\'s', () => {
    const b = fight();
    const tot = (t) => t.swing + t.proc + t.spell + t.heal;
    expect(tot(me(b))).toBeGreaterThan(0);
    const other = tot(b.threatBy.get('Brackwyn'));
    feed(b, 5, 'LOADING, PLEASE WAIT...');
    expect(tot(me(b))).toBe(0);
    expect(tot(b.threatBy.get('Kebantik'))).toBe(0);
    expect(tot(b.threatBy.get('Brackwyn'))).toBe(other);
    expect(me(b).procDetail['Zoned (hate cleared)']).toBe(1);
  });

  it('damage dealt stays on the damage meter', () => {
    const b = fight();
    const dmg = me(b).dmg;
    feed(b, 5, 'LOADING, PLEASE WAIT...');
    expect(me(b).dmg).toBe(dmg);
  });

  it('a cast just before zoning cannot be handed back afterwards', () => {
    const b = fight();
    feed(b, 3, 'You begin casting Concussion.');
    feed(b, 4, 'LOADING, PLEASE WAIT...');
    feed(b, 5, 'Your spell is interrupted.');
    expect(me(b).spell).toBe(0);
  });
});

describe('the live tail', () => {
  it('hands every line to _threatLine before the keep-list drops it', () => {
    const src = readSource(AGENT_INDEX);
    const loop = stripJs(sliceBlock(src, 'const selfCast = noteSelfCast(line, b.character);', 'noteCasterStart(line);'));
    expect(loop).toContain('b.builder._threatLine(line);');
  });
});
