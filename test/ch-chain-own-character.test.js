// CH chain — "is this slot MINE?" + callout target parsing.
// SOURCE-SLICE fidelity tier: both units are sliced out of the shipped agent
// source, so edits to the real code are exercised here.
//
// Field bug (2026-08-03, Dant + Aimey): the agent tails EVERY
// eqlog_*_pq.proj.txt in the EQ folder and seeds stats.watchedLogs from all of
// them at startup. Aimey had played on Dant's machine once, so her log sat in
// his folder forever — which made _isOwnCharacterName('Aimey') true on HIS box
// with no Aimey client running. Result: the CH-chain "0N GO" TTS spoke HER slot
// at him (_maybeAnnounceChGo), and the overlay highlighted her slot as his
// (you_nums). The fix gates on the log actually being written.
//
// Second defect found the same night: Mcdorf's macro brackets the heal target
// ("004 CH < Dongru > Mana: 53%"). The separator class had no '<', so the
// target never captured — on EVERY client, clean name or not. The chain only
// showed a target because other healers use the " - Dongru - " dash form.
//
// Run: npx vitest run test/ch-chain-own-character.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_INDEX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'wolfpack-logsync', 'index.js',
);
function sliceBlock(src, start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`source-slice: start not found: ${JSON.stringify(start)}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`source-slice: end not found: ${JSON.stringify(end)}`);
  return src.slice(s, e + end.length);
}

const src = fs.readFileSync(AGENT_INDEX, 'utf8');

// _isOwnCharacterName closes over the module-level `stats`; inject a test one.
// Start marker deliberately stops before the VALUE — retuning the window must
// fail an assertion below, not blow up the slice and skip the whole file.
const ownBlock = sliceBlock(
  src,
  'const OWN_CHARACTER_ACTIVE_MS = ',
  '<= OWN_CHARACTER_ACTIVE_MS);\n}',
);
// eslint-disable-next-line no-new-func
const makeIsOwn = new Function('stats', ownBlock + '\nreturn _isOwnCharacterName;');

// The live callout regex, lifted verbatim — no re-typed copy to drift.
const rxLine = sliceBlock(src, 'const _CH_CALL_RX = ', ';\n');
// eslint-disable-next-line no-new-func
const _CH_CALL_RX = new Function(rxLine + '\nreturn _CH_CALL_RX;')();

const NOW = 1_000_000_000;
const MIN = 60_000;

describe('_isOwnCharacterName — a stale log is not "you" (source-sliced)', () => {
  it('sliced the real function', () => {
    expect(typeof makeIsOwn({ watchedLogs: [] })).toBe('function');
  });

  it('THE BUG: a leftover log from someone who played here once is NOT you', () => {
    // Dant's folder: his own log is live, Aimey's is a day-old leftover.
    const isOwn = makeIsOwn({
      watchedLogs: [
        { character: 'Dant',  lastSeen: Date.now() - 2_000 },
        { character: 'Aimey', lastSeen: Date.now() - 24 * 60 * MIN },
      ],
    });
    expect(isOwn('Dant')).toBe(true);
    expect(isOwn('Aimey')).toBe(false);   // pre-fix this was true → her 002 GO spoke at him
  });

  it('a genuine two-box still counts BOTH characters — both logs are being written', () => {
    const isOwn = makeIsOwn({
      watchedLogs: [
        { character: 'Dant',  lastSeen: Date.now() - 1_000 },
        { character: 'Aimey', lastSeen: Date.now() - 5_000 },
      ],
    });
    expect(isOwn('Dant')).toBe(true);
    expect(isOwn('Aimey')).toBe(true);
  });

  it('boundary: inside the window counts, past it does not', () => {
    const inside  = makeIsOwn({ watchedLogs: [{ character: 'Aimey', lastSeen: Date.now() - (3 * MIN - 5_000) }] });
    const outside = makeIsOwn({ watchedLogs: [{ character: 'Aimey', lastSeen: Date.now() - (3 * MIN + 5_000) }] });
    expect(inside('Aimey')).toBe(true);
    expect(outside('Aimey')).toBe(false);
  });

  it('a log that never produced a line (no lastSeen) is not you', () => {
    const isOwn = makeIsOwn({ watchedLogs: [{ character: 'Aimey', lastSeen: null }] });
    expect(isOwn('Aimey')).toBe(false);
  });

  it('still matches case-insensitively, and never matches a non-watched name', () => {
    const isOwn = makeIsOwn({ watchedLogs: [{ character: 'Dant', lastSeen: Date.now() }] });
    expect(isOwn('dANT')).toBe(true);
    expect(isOwn('Dongru')).toBe(false);
    expect(isOwn('')).toBe(false);
    expect(isOwn(null)).toBe(false);
  });
});

describe('_CH_CALL_RX — real callout styles from the 2026-08-03 chain', () => {
  const target = (s) => { const m = _CH_CALL_RX.exec(s); return m && m[2] ? m[2] : null; };
  const slot   = (s) => { const m = _CH_CALL_RX.exec(s); return m ? parseInt(m[1], 10) : null; };

  it('THE BUG: bracketed target now captures (Mcdorf style)', () => {
    expect(target('004 CH < Dongru > Mana: 53%')).toBe('Dongru');
    expect(slot('004 CH < Dongru > Mana: 53%')).toBe(4);
  });

  it('every other style captured before and still does', () => {
    expect(target('001 - CH - Dongru - Mana: 38%')).toBe('Dongru');          // Fargan
    expect(target('002 -CH - Dongru - Mana 26%')).toBe('Dongru');            // Aimey
    expect(target('003 - CH- Dongru - Bananarama Mana: 39%')).toBe('Dongru');// Uilnayar
    expect(target('002 Druid CH Dongru Mana: 44%')).toBe('Dongru');
    expect(target('001 -> CH on Dongru Mana: 70%')).toBe('Dongru');
  });

  it('slot number still parses when the name token is unreadable', () => {
    // Some clients render the name garbled; the chain must still advance.
    expect(slot('004 CH < nrmcdw > Mana: 53%')).toBe(4);
    expect(slot('001 - CH - bhuics - Mana: 66%')).toBe(1);
  });

  it('an unreadable token is NOT adopted as the heal target', () => {
    // Better to show no target than to pin garbage on the overlay.
    expect(target('004 CH < nrmcdw > Mana: 53%')).toBe(null);
    expect(target('001 - CH - bhuics - Mana: 66%')).toBe(null);
  });
});
