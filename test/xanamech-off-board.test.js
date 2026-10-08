// test/xanamech-off-board.test.js — Xanamech comes off the timer board.
//
// The Oct 1 server patch notes: "Xanamech has no lockout". The board still
// counted 72 h after every kill. The guild lead, 2026-10-02, asked whether to
// take him off the board: "yes" (DECISIONS §132).
//
// Run: npx vitest run test/xanamech-off-board.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const bosses = require('../data/bosses.json');
const src = readSource(BOT_INDEX);

const SET_LINE = sliceBlock(src, 'const _OFF_BOARD_NO_LOCKOUT', ']);');
const { _OFF_BOARD_NO_LOCKOUT } = evalBlock(SET_LINE, ['_OFF_BOARD_NO_LOCKOUT']);

const onBoard = (name) => {
  const n = name.toLowerCase();
  return bosses.some(b => b.name.toLowerCase() === n || (b.nicknames || []).some(x => x.toLowerCase() === n));
};

describe('Xanamech is off the board', () => {
  it('bosses.json has no Xanamech, by name or nickname', () => {
    expect(onBoard('Xanamech Nezmirthafen')).toBe(false);
    expect(onBoard('xanamech')).toBe(false);
    expect(bosses.some(b => /xanamech/i.test(b.id))).toBe(false);
  });

  it('the rest of the PoP board is still there', () => {
    expect(onBoard('Grummus')).toBe(true);
    expect(onBoard('The Seventh Hammer')).toBe(true);
  });
});

describe('the kill relay says why instead of asking for /addboss', () => {
  it('names Xanamech as off the board for having no lockout', () => {
    expect(_OFF_BOARD_NO_LOCKOUT.has('xanamech nezmirthafen')).toBe(true);
  });

  it('nothing in the off-board set is still on the board', () => {
    for (const name of _OFF_BOARD_NO_LOCKOUT) expect(onBoard(name)).toBe(false);
  });

  it('the unknown-boss branch picks the no-lockout wording for those names', () => {
    const relay = stripJs(sliceBlock(src, 'async function _handleAgentBossKill(req, res) {', '\n// ── /api/agent/hatekill'));
    expect(relay).toMatch(/const offBoard = _OFF_BOARD_NO_LOCKOUT\.has\(nameLower\);/);
    expect(relay).toMatch(/offBoard \? `\*\(no lockout — not on the timer board\)\*`/);
  });
});
