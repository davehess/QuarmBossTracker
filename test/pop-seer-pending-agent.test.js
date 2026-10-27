// test/pop-seer-pending-agent.test.js — the agent's half of the Seer's PENDING memories (the guild lead, 2026-10-26).
//
// When the step a kill waits for is missing, Seer Mal Nae`Shi answers 'unlock memories' with the second entry of that
// flag's row in her `checklistFlags` table (poknowledge/Seer_Mal_Nae-Shi.lua) instead of granting the step. A partway
// character's log carried two of them and no reader knew either. The agent lets each through as a 'recital' event with
// the sentence's first 160 characters; the bot (utils/popFlagStages.js PENDING_RECITAL) names the checklist flag and
// stores it as cl_*, source recital, never as a step. The sentences are test/fixtures/seer-pending-memories.json, the
// same file the web and bot tests read. The real run (a partway character) is test/fixtures/seer-recital-real-b.txt.
//
// Run: npx vitest run test/pop-seer-pending-agent.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AGENT_INDEX, ROOT, readSource, sliceBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const _POP_GRANT_RX =', '\n}\n');
// eslint-disable-next-line no-new-func
const { parsePopFlagLine, _POP_RECITAL_RX, _POP_PREV_RX } = new Function('_zealState', 'stats', 'parseEqTimestamp',
  `${block}\nreturn { parsePopFlagLine, _POP_RECITAL_RX, _POP_PREV_RX };`)({}, { currentEncounterThreatByChar: {} }, () => new Date('2026-10-26T21:10:01Z'));

const fx = (n) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', n), 'utf8');
const SCRIPT = JSON.parse(fx('seer-pending-memories.json'));
const L = (msg) => `[Mon Oct 26 21:10:01 2026] ${msg}`;

describe('the agent lets each pending sentence through, as a recital, and only those', () => {
  for (const m of SCRIPT.filter(s => s.text)) {
    it(`${m.key}: a recital event with the sentence, not a grant and not a prev line`, () => {
      const e = parsePopFlagLine(L(m.text), 'Aldenmar');
      expect(e, m.key).toMatchObject({ kind: 'recital', prev: null });
      expect(e.text).toBe(m.text.slice(0, 160));
      expect(m.text.slice(0, 160).length).toBeGreaterThan(60);        // the bot matches an opening well inside the cap
    });
  }
  it('the real recital of a partway character: all nine sentences, the two new ones among them', () => {
    const lines = fx('seer-recital-real-b.txt').split('\n').filter(Boolean);
    const events = lines.map(l => parsePopFlagLine(L(l), 'Aldenmar'));
    expect(events.every(e => e && e.kind === 'recital')).toBe(true);
    expect(events).toHaveLength(9);
    expect(events[7].text).toMatch(/^You remember seeing a small trinket by Grummus/);
    expect(events[8].text).toMatch(/^Your heart beat speeds as you recall the Warlord's flaming axe/);
  });
  it('the unlock texts stay what they were: the line before a grant, not a recital', () => {
    // These print just before "You have received a character flag!" and the bot names the grant from them (PREV_STAGES).
    for (const t of [
      "An Image of Mithaniel flashes before you, 'You have finally earned a place of Honor.  Wear this Cipher with pride.'",
      "An Image of Mithaniel flashes before you, 'These notes should assist you on your quest for the Fallen.  Justify the Honor that you have been given.'",
      'For a moment you pause, sticking a hand in your pocket.  Inside you find the small ward that was lying near Grummus\' body, perhaps you should bring this to Milyk.',
      'You have learned the meaning of both Justice and Honor.  You may now pass into the Halls of Honor.',
    ]) expect(_POP_RECITAL_RX.test(t), t.slice(0, 40)).toBe(false);
  });
  it('a sentence that merely starts alike, and a player quoting one, is nothing', () => {
    for (const t of ['You remember seeing a gnoll', 'Your heart beats fast', "Zarrin says, 'Your heart beat speeds as you recall the Warlord's flaming axe'",
      "Brackwyn tells the guild, 'Besting the Burning Prince proves your might'", 'An image of Mithaniel flashes before you.']) {
      expect(parsePopFlagLine(L(t), 'Aldenmar'), t).toBe(null);
    }
  });
});

// Once main's bot tables are on this branch, the agent's gate must cover every opening the bot names a pending memory by.
describe("the agent's allow-list covers every pending opening the bot knows", () => {
  const file = path.join(ROOT, 'utils', 'popFlagStages.js');
  const S = fs.existsSync(file) ? createRequire(import.meta.url)(file) : null;
  it.skipIf(!S || !S.PENDING_RECITAL)('every PENDING_RECITAL opening', () => {
    expect(S.PENDING_RECITAL.length).toBe(SCRIPT.filter(s => s.text).length);
    for (const [prefix] of S.PENDING_RECITAL) expect(_POP_RECITAL_RX.test(prefix), prefix).toBe(true);
  });
  it('the Mithaniel pending line is also a line-before-a-grant opening, and the recital reading wins for that line itself', () => {
    // _POP_PREV_RX opens on "An Image of Mithaniel flashes before you" for the unlock texts. The pending line shares that
    // start, and parsePopFlagLine tests the recital gate first, so the line is a recital; it would be sent as `prev` only
    // if a grant came right after it, and a grant is always preceded by its own unlock text.
    const m = SCRIPT.find(s => s.key === 'cl_mmarr');
    expect(_POP_PREV_RX.test(m.text)).toBe(true);
    expect(parsePopFlagLine(L(m.text), 'Brackwyn')).toMatchObject({ kind: 'recital' });
  });
});
