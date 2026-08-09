// "<Name> dies." is FEIGN DEATH, not a death.
//
// parseEvent used to match /\]\s+(.+?)\s+die[ds]\./ on the belief that "dies."
// was an older real-death variant. It is not. It is the cast_on_other text of
// every Feign Death spell on Quarm:
//
//   366  Feign Death      SK 30 / NEC 16   "dies." / fades "You no longer appear dead."
//   1118 Paralyzing Venom                  "dies." / fades "You no longer appear dead."
//   1460 Death Peace      SK 60 / NEC 60   "dies." / fades "You no longer appear dead."
//   2807 FD Test                           "dies." / fades "You no longer appear dead."
//
// So every feign a knight or necro threw was banked as a death by EVERY observer
// in range. The fingerprint was unmistakable once looked for: 175 death records
// across 3 Shadow Knights (58 each) and 58 across 4 Necromancers, against 5.5
// for a Cleric and 1 for a Bard — 44% of every death ever stored came from the
// only two classes that can feign (Hitya 2026-08-03).
//
// The golden log contained no "dies."/"died." line at all, which is exactly why
// this survived a parser regression suite. These cases exist so it cannot again.
//
// Run: npx vitest run test/feign-death-not-a-death.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

const P = '[Sun Aug 02 20:55:33 2026] ';
const ev = (line) => agent.parseEvent(P + line, new Date());

describe('feign death must never be counted as a death', () => {
  it('"<Name> dies." is NOT a death — this is the whole bug', () => {
    for (const name of ['Syko', 'Dongru', 'Bardtholemu']) {
      const e = ev(`${name} dies.`);
      expect(e && e.type, `"${name} dies." must not parse as a death`).not.toBe('death');
    }
  });

  it('multi-word and lowercase subjects are equally not deaths', () => {
    // The old regex used (.+?), so it swallowed anything at all before "dies."
    expect(ev('a shissar disciple dies.')?.type).not.toBe('death');
    expect(ev('Lord Inquisitor Seru dies.')?.type).not.toBe('death');
  });

  it('the explicit feign-death line still parses as feign_death', () => {
    expect(ev('Syko has fallen to the ground.').type).toBe('feign_death');
    expect(ev('You have fallen to the ground.').type).toBe('feign_death');
  });

  it('REAL deaths still parse — the fix must not overshoot', () => {
    const slain = ev('Syko has been slain by Lord Inquisitor Seru!');
    expect(slain.type).toBe('death');
    expect(slain.defender).toBe('Syko');
    expect(slain.attacker).toBe('Lord Inquisitor Seru');

    // "died." (no named killer — drowning, falling, a DoT tick) stays a death.
    const died = ev('Syko died.');
    expect(died.type).toBe('death');
    expect(died.defender).toBe('Syko');

    expect(ev('You died.').type).toBe('death');
  });

  it('the two forms are not confusable: "died." counts, "dies." does not', () => {
    // Pinning the exact distinction the old /die[ds]\./ character class erased.
    expect(ev('Syko died.').type).toBe('death');
    expect(ev('Syko dies.')?.type).not.toBe('death');
  });
});

// The SECOND site. parseEvent was fixed in 3.5.11; _deadMobNameFromLine was
// missed and still carried /die[ds]\./ until 3.5.14. It has THREE consumers and
// two of them act on the returned NAME, not on a mob:
//
//   _cancelTimersOnMobDeath  — kills any countdown whose target is that name.
//                              A "<player>, get out" callout was cancelled the
//                              moment that player feigned.
//   _mobTracksOnDeathLine    — → _clearNameObservations, wiping that name's
//                              buff-landing + slow buckets. A feigning knight
//                              silently reset their own buff tracking mid-fight.
//   _checkBossSpawnChain     — precursors are mobs; unaffected in practice.
//
// The failure needs a feign-capable class whose NAME is also a timer target,
// which is why it hid behind the louder parseEvent bug rather than showing up
// on its own.
describe('_deadMobNameFromLine — the timer/observation-clearing gate', () => {
  it('accepts a real slain line', () => {
    expect(agent._deadMobNameFromLine(P + 'Lord Inquisitor Seru has been slain by Hitya!'))
      .toBe('Lord Inquisitor Seru');
  });

  it('accepts "You have slain <Mob>!"', () => {
    expect(agent._deadMobNameFromLine(P + 'You have slain a shissar disciple!'))
      .toBe('a shissar disciple');
  });

  it('accepts a real "died." line', () => {
    expect(agent._deadMobNameFromLine(P + 'a shissar disciple died.')).toBe('a shissar disciple');
  });

  it('THE FIX: "dies." is a feign and must not name a dead entity', () => {
    // Before 3.5.14 this returned 'Syko', cancelling Syko's timers and clearing
    // Syko's tracked buffs every time they threw Death Peace.
    expect(agent._deadMobNameFromLine(P + 'Syko dies.')).toBeNull();
    expect(agent._deadMobNameFromLine(P + 'Dongru dies.')).toBeNull();
  });

  it('a feign by a MOB-named charm pet is equally not a death', () => {
    expect(agent._deadMobNameFromLine(P + 'a shissar disciple dies.')).toBeNull();
  });

  it('non-death lines stay null', () => {
    expect(agent._deadMobNameFromLine(P + 'Syko has fallen to the ground.')).toBeNull();
    expect(agent._deadMobNameFromLine(P + 'Hitya hits a shissar disciple for 412 points of damage.')).toBeNull();
    expect(agent._deadMobNameFromLine('')).toBeNull();
    expect(agent._deadMobNameFromLine(null)).toBeNull();
  });

  it('END TO END: a feign does not cancel that player\'s countdown', () => {
    // The consumer that motivated the fix. Arm a timer targeting a player, then
    // feed the feign line through the real cancel path.
    // _startTimer keys the row by id + sorted captures, so the live id is
    // "test-feign-timer|target=Syko" — match on target, which is what
    // _cancelTimersOnMobDeath itself compares.
    const mine = () => agent._activeTimersSnapshot()
      .filter(t => String(t.target || '').toLowerCase() === 'syko');
    agent._startTimer({
      id: 'test-feign-timer', name: 'GET OUT', timer_duration_sec: 30,
      actions: [{ color: 'red' }],
    }, Date.now(), false, { target: 'Syko' });
    expect(mine().length, 'timer must arm, or the rest of this case proves nothing').toBe(1);

    expect(
      agent._cancelTimersOnMobDeath(P + 'Syko dies.'),
      'a feign must cancel nothing',
    ).toBe(0);
    expect(mine().length, 'a feign must leave the countdown running').toBe(1);

    // …and a REAL death still cancels it, so the guard isn't just inert.
    expect(agent._cancelTimersOnMobDeath(P + 'Syko died.')).toBe(1);
    expect(mine().length, 'a real death must still cancel').toBe(0);
  });
});
