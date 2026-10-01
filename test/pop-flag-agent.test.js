// PoP flags in the agent (DECISIONS §119, 2026-10-01). parsePopFlagLine sees every line on the live,
// backfill and opt-in paths; it remembers each character's previous line and sends it with a grant
// ONLY when it opens like a flag NPC. Run against the real function with stubbed state.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AGENT_INDEX, ROOT, readSource, sliceBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const _POP_GRANT_RX =', '\n}\n');
// eslint-disable-next-line no-new-func
const make = () => new Function('_zealState', 'stats', 'parseEqTimestamp',
  `${block}\nreturn { parsePopFlagLine, _POP_PREV_RX, _POP_RECITAL_RX };`)(
  { Aldenmar: { zone: '201' } }, { currentEncounterThreatByChar: {} }, () => new Date('2026-10-01T20:00:00Z'));

const L = (msg) => `[Thu Oct 01 16:00:00 2026] ${msg}`;

describe('parsePopFlagLine', () => {
  it("sends the flag NPC's line with the grant", () => {
    const { parsePopFlagLine: p } = make();
    expect(p(L("Mavuin tells you, 'So you have pleaded my case to the Tribunal, I am most thankful.'"), 'Aldenmar')).toBe(null);
    const e = p(L('You have received a character flag!'), 'Aldenmar');
    expect(e).toMatchObject({ kind: 'grant', zone: '201' });
    expect(e.prev.startsWith("Mavuin tells you, 'So you have pleaded my case")).toBe(true);
  });

  it("never sends a player's line, even right before a grant", () => {
    const { parsePopFlagLine: p } = make();
    p(L("Brackwyn tells you, 'grats'"), 'Aldenmar');
    expect(p(L('You have received a character flag!'), 'Aldenmar').prev).toBe(null);
  });

  it("reads Elder Poxbourne's spelling and the checklist flag", () => {
    const { parsePopFlagLine: p } = make();
    expect(p(L('You receive a character flag!'), 'Aldenmar').kind).toBe('grant');
    expect(p(L('You have received a new checklist flag!'), 'Aldenmar').kind).toBe('checklist');
  });

  it("keeps each character's previous line separately", () => {
    const { parsePopFlagLine: p } = make();
    p(L("Mavuin tells you, 'So you have pleaded my case to the Tribunal'"), 'Aldenmar');
    p(L('You hit a gnoll for 20 points of damage.'), 'Brackwyn');
    expect(p(L('You have received a character flag!'), 'Aldenmar').prev).toMatch(/^Mavuin/);
  });

  it("reports the Seer's recital sentences, and nothing else", () => {
    const { parsePopFlagLine: p } = make();
    const r = p(L('Mavuin is grateful to you for taking his case before the Tribunal.'), 'Aldenmar');
    expect(r).toMatchObject({ kind: 'recital', prev: null });
    expect(r.text).toMatch(/^Mavuin is grateful/);
    expect(p(L('You have been healed for 400 points.'), 'Aldenmar')).toBe(null);
  });
});

// The bot's tables (utils/popFlagStages.js) name a flag from these openings; an opening the agent
// does not let through could never be named.
describe("the agent's allow-lists cover every opening the bot knows", () => {
  const file = path.join(ROOT, 'utils', 'popFlagStages.js');
  const has = fs.existsSync(file);
  const S = has ? createRequire(import.meta.url)(file) : null;
  const { _POP_PREV_RX, _POP_RECITAL_RX } = make();
  it.skipIf(!has)('every line before a grant', () => {
    for (const [, , prefix] of S.PREV_STAGES) expect(_POP_PREV_RX.test(prefix), prefix).toBe(true);
  });
  it.skipIf(!has)('every recital sentence', () => {
    for (const [prefix] of S.RECITAL_STAGES) expect(_POP_RECITAL_RX.test(prefix), prefix).toBe(true);
  });
});
