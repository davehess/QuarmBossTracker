// test/charm-session-ran-full.test.js — charm sessions carry the spell and a "ran its full duration" flag.
//
// The guild lead, 2026-10-08: enchanters say charms break early, and the recorded sessions could not
// answer it. They had no spell name, and `end_reason` was only `charm_break` — which "Your charm spell
// has worn off." prints for a natural fade AND a resist break alike (it is the spell-fades line), so the
// log cannot split them. The honest field is derived: `ran_full` = lived >= 90% of the spell's max
// duration (CHARM_SPELLS), null when unknown. Timed from the land line and the break line themselves,
// because session.duration_sec comes off this.lastEvent, which only combat events advance.
//
// Run: npx vitest run test/charm-session-ran-full.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const src = readSource(AGENT_INDEX);

const { _charmRanFull } = evalBlock(
  sliceBlock(src, 'const CHARM_RAN_FULL_FRACTION = 0.9;', '\n  return full;\n}'),
  ['_charmRanFull'],
);

describe('_charmRanFull (the pure classifier)', () => {
  it('true at or past 90% of the spell\'s max, false below', () => {
    expect(_charmRanFull(720, 648, 'charm_break')).toBe(true);
    expect(_charmRanFull(720, 720, 'charm_break')).toBe(true);
    expect(_charmRanFull(720, 647, 'charm_break')).toBe(false);
    expect(_charmRanFull(720, 36, 'charm_break')).toBe(false);
  });
  it('null whenever it cannot know: no spell max, no duration', () => {
    expect(_charmRanFull(undefined, 600, 'charm_break')).toBe(null);
    expect(_charmRanFull(null, 600, 'charm_break')).toBe(null);
    expect(_charmRanFull(0, 600, 'charm_break')).toBe(null);
    expect(_charmRanFull(720, null, 'charm_break')).toBe(null);
    expect(_charmRanFull(720, NaN, 'charm_break')).toBe(null);
  });
  it('a truncated (flushed) session can prove "full" but never "broke early"', () => {
    expect(_charmRanFull(720, 700, 'encounter_flush')).toBe(true);
    expect(_charmRanFull(720, 100, 'encounter_flush')).toBe(null);
  });
});

const stamp = (hms, text) => `[Mon Oct 05 ${hms} 2026] ${text}`;
function feed(b, hms, text) {
  const line = stamp(hms, text);
  const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
  if (ev) b.add(ev);
}
const builder = () => new agent.EncounterBuilder({ character: 'Brackwyn', onFlush: () => {} });
const PET = 'a glyphed familiar';
const LAND = `${PET} regards Brackwyn as an ally.`;
const BREAK = 'Your charm spell has worn off.';

beforeEach(() => { agent._charmTickTracker.clear(); });

describe('through the real EncounterBuilder', () => {
  it('Allure that lasts 11 minutes: spell "allure", ran_full true, end_reason stays charm_break', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    feed(b, '02:58:03', BREAK);
    expect(b.charmSessions).toHaveLength(1);
    expect(b.charmSessions[0]).toMatchObject({ pet: PET, owner: 'Brackwyn', end_reason: 'charm_break', spell: 'allure', ran_full: true });
  });

  it('a 36 s break is ran_full false, so a resist break is told from a full run', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    feed(b, '02:47:39', BREAK);
    expect(b.charmSessions[0]).toMatchObject({ end_reason: 'charm_break', spell: 'allure', ran_full: false });
  });

  it('a charm with no staged cast has spell null and ran_full null (nothing guessed)', () => {
    const b = builder();
    feed(b, '02:47:03', LAND);
    feed(b, '02:58:03', BREAK);
    expect(b.charmSessions[0]).toMatchObject({ end_reason: 'charm_break', spell: null, ran_full: null });
  });

  it('a recast by the same owner makes the span meaningless: ran_full null', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    feed(b, '02:55:00', 'You begin casting Allure.');
    feed(b, '02:55:03', LAND);
    feed(b, '02:58:03', BREAK);
    expect(b.charmSessions[0]).toMatchObject({ spell: 'allure', ran_full: null });
  });

  it('a session another charmer took over (break line never seen) claims nothing', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    feed(b, '02:58:03', `${PET} regards Corvale as an ally.`);
    expect(b.charmSessions[0]).toMatchObject({ owner: 'Brackwyn', end_reason: 'charm_break', spell: 'allure', ran_full: null });
  });

  it('a session still open is not stamped until something closes it', () => {
    const b = builder();
    feed(b, '02:47:00', 'You begin casting Allure.');
    feed(b, '02:47:03', LAND);
    expect(b._activeCharms.get(PET)).toMatchObject({ spell: 'allure', ran_full: null, end_reason: null });
  });
});

describe('the new fields are on the session object (comment-stripped source)', () => {
  const code = stripJs(src);
  it('spell and ran_full are written into the built session, and stamped at the break and the flush', () => {
    expect(code).toMatch(/spell:\s+pcSpell\.charm_spell_name \? String\(pcSpell\.charm_spell_name\)\.toLowerCase\(\) : null,/);
    expect(code).toMatch(/ran_full:\s+null,/);
    expect(code).toMatch(/_stampCharmRanFull\(open, Date\.parse\(event\.ts\)\);/);
    expect(code).toMatch(/_stampCharmRanFull\(open, _epochMs\(open\.ended_at\)\);/);
  });
});
