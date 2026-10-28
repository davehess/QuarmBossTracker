// test/pop-raids-avatar.test.js: the Rathe Council slide in the PoP Raid Slideshow (apps/mimic/pop-raids.js) carries the
// Avatar of Earth's idle clock as the server's script has it after the 2026-10-28 patch. poearthb/encounters/
// RatheCouncil.lua (SecretsOTheP/quests 572bc06): AVATAR_IDLE = 2100 s (35 min, was 3000), the clock pauses in combat
// and is never refilled after a wipe, warnings at 900/1500/1800 s elapsed (20/10/5 minutes left), the Council round
// has no time limit, and a failed attempt can be retried after FAILURE = 900 s (15 minutes).
//
// Run: npx vitest run test/pop-raids-avatar.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource } from './_source-slice.js';

const POP = (() => { const w = {}; new Function('window', readSource(path.join(ROOT, 'apps', 'mimic', 'pop-raids.js')))(w); return w.POP_RAIDS; })();
const enc = POP.sections.flatMap(s => s.encounters).find(e => e.id === 'rathe');
const text = () => enc.callouts.join('\n');

describe('Rathe Council + Avatar of Earth slide matches the script', () => {
  it('exists', () => { expect(enc).toBeTruthy(); });

  it('gives the Avatar 35 idle minutes, not 50', () => {
    expect(text()).toMatch(/Avatar of Earth: 35 minutes of idle time/);
    expect(text()).not.toMatch(/full 50|: 50 minutes/);
  });

  it('says the clock pauses in combat and never refills after a wipe', () => {
    expect(text()).toMatch(/paused while it is fighting/);
    expect(text()).toMatch(/does not refill after a wipe/);
  });

  it('keeps the 20, 10 and 5 minute warnings, the retry, and the Council having no time limit', () => {
    expect(text()).toMatch(/20, 10 and 5 minutes left/);
    expect(text()).toMatch(/retried after 15 minutes/);
    expect(text()).toMatch(/Council round has no time limit/);
  });
});
