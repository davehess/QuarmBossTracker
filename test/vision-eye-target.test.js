// test/vision-eye-target.test.js — an Eye of Zomm as the TARGET must never
// become a fight (Hitya, live 2026-08-16: "Eye of PLAYER showing up in DPS
// meter and history").
//
// The _isVisionEyePet choke points already keep eyes off the PET/attacker
// side, and flush() refuses an eye BOSS at upload — but killing your own eye
// flowed through the damage path: the eye entered this.targets, named the
// live meter's boss, and the "fight" landed in the History ring before
// flush's refusal could matter. The fix drops damage/death events whose
// DEFENDER is a vision eye at the top of the handler.
//
// Run: npx vitest run test/vision-eye-target.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const { EncounterBuilder } = agent;

const TS = '[Sun Aug 16 21:40:00 2026]';
// Same three calls the golden replay harness makes — the real intake path.
const feed = (b, line) => {
  const full = `${TS} ${line}`;
  const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
  if (ev) b.add(ev);
  return ev;
};
const mkBuilder = () => new EncounterBuilder({ character: 'Timberowl', silent: true });

describe('vision eye as a target', () => {
  it('killing your own eye creates NO target, NO boss, NO events', () => {
    const b = mkBuilder();
    const ev = feed(b, 'Timberowl slashes Eye of Timberowl for 43 points of damage.');
    expect(ev).toBeTruthy();                       // the line PARSES — the drop is downstream
    feed(b, 'Eye of Timberowl has been slain by Timberowl!');
    expect(b.targets.size).toBe(0);
    expect(b.bossName ?? null).toBe(null);
    // Nothing accumulated → nothing for the meter, history ring, or flush.
    expect((b.events || []).filter(e => e.defender === 'Eye of Timberowl')).toHaveLength(0);
  });

  it('a real fight running alongside an eye kill is untouched', () => {
    const b = mkBuilder();
    feed(b, 'Timberowl slashes a restless burrower for 100 points of damage.');
    feed(b, 'Timberowl slashes Eye of Timberowl for 43 points of damage.');
    feed(b, 'Timberowl slashes a restless burrower for 50 points of damage.');
    expect(b.targets.get('a restless burrower')).toBe(150);
    expect(b.targets.has('Eye of Timberowl')).toBe(false);
  });

  it('an eye ATTACKING (impossible in game, hostile in a log) still cannot join targets via the defender path', () => {
    const b = mkBuilder();
    // A raider hitting someone ELSE's eye — same drop, not just self-owned eyes.
    feed(b, 'Uilz slashes Eye of Syko for 12 points of damage.');
    expect(b.targets.size).toBe(0);
  });
});
