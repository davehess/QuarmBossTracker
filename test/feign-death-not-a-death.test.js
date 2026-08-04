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
// only two classes that can feign (Uilnayar 2026-08-03).
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
