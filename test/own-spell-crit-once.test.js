// The guild lead, 2026-10-08 (with a screenshot of the EQ chat window): "I'm having double-messages for PROC CRITS".
//
// A spell crit of OUR OWN is logged in both voices, back to back, the same second, the same number:
//   [18:28:33] Aldenmar delivers a critical blast! (300)
//   [18:28:33] You deliver a critical blast! (300)
// Both lines parse to a crit for the uploading character, so the meter's crit count and bonus, and the My Crits
// tracker, counted every own spell crit twice. The second line of such a pair is the same crit.
//
// Runs the real EncounterBuilder over the real parser. Names are invented.
//
// Run: npx vitest run test/own-spell-crit-once.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const { EncounterBuilder } = agent;

const crits = (lines, character = 'Aldenmar') => {
  const b = new EncounterBuilder({ character, silent: false });
  const seen = [];
  b._bumpDeeps = (who, cat, amount) => { if (cat === 'crit') seen.push([who, amount]); };
  for (const line of lines) {
    const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (ev) b.add(ev);
  }
  return seen;
};
const L = (t, msg) => `[Thu Oct 08 18:28:${t} 2026] ${msg}`;

describe('own spell crits count once', () => {
  it('the name-voice then the You-voice line is ONE crit', () => {
    expect(crits([L('33', 'Aldenmar delivers a critical blast! (300)'), L('33', 'You deliver a critical blast! (300)')]))
      .toEqual([['Aldenmar', 300]]);
  });

  it('the You-voice then the name-voice line is one crit too', () => {
    expect(crits([L('33', 'You deliver a critical blast! (300)'), L('33', 'Aldenmar delivers a critical blast! (300)')]))
      .toEqual([['Aldenmar', 300]]);
  });

  it('two separate pairs are two crits', () => {
    expect(crits([
      L('33', 'Aldenmar delivers a critical blast! (300)'), L('33', 'You deliver a critical blast! (300)'),
      L('38', 'Aldenmar delivers a critical blast! (310)'), L('38', 'You deliver a critical blast! (310)'),
    ])).toEqual([['Aldenmar', 300], ['Aldenmar', 310]]);
  });

  it('two lines in the SAME voice are two real crits (a double crit still counts twice)', () => {
    expect(crits([L('33', 'You deliver a critical blast! (300)'), L('33', 'You deliver a critical blast! (300)')]))
      .toEqual([['Aldenmar', 300], ['Aldenmar', 300]]);
  });

  it('a different amount, or more than 2 s apart, is not the same crit', () => {
    expect(crits([L('33', 'Aldenmar delivers a critical blast! (300)'), L('33', 'You deliver a critical blast! (250)')]).length).toBe(2);
    expect(crits([L('30', 'Aldenmar delivers a critical blast! (300)'), L('35', 'You deliver a critical blast! (300)')]).length).toBe(2);
  });

  it('another player\'s spell crit is still counted once, and melee crits are untouched', () => {
    expect(crits([L('33', 'Brackwyn delivers a critical blast! (300)')])).toEqual([['Brackwyn', 300]]);
    expect(crits([L('33', 'You Score a critical hit! (120)'), L('33', 'Aldenmar Scores a critical hit! (120)')]).length).toBeGreaterThan(0);
  });
});
