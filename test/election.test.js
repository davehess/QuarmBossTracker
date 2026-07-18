// Reporter-election logic — SOURCE-SLICE fidelity tier.
//
// Under test: `_electReporters` / `_reporterRank` / `_reporterGuildBook` in the
// bot monolith `index.js` (~line 3260). These are internal (unexported) and
// require()-ing index.js boots the Discord client, so we slice the real block
// out of the shipped source and eval it (see test/_source-slice.js). The
// election picks the single chat reporter as the lowest primary-character name,
// discord_id as tiebreak, drops agents silent past a 60s TTL, and never elects
// zero reporters when someone is live (fail-open uploads).
//
// Ported from the session's scratchpad elect_test.js (7 cases).

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(BOT_INDEX),
  'const REPORTER_TTL_MS',
  'return { chat, live };\n}',
);
const {
  _electReporters, _reporterGuildBook, _reporterRank,
  REPORTER_TTL_MS, REPORTER_CHAT_COUNT,
} = evalBlock(block, [
  '_electReporters', '_reporterGuildBook', '_reporterRank',
  'REPORTER_TTL_MS', 'REPORTER_CHAT_COUNT',
]);

const G = 'wolfpack';

// The slice closes over its own module-level `_reporterRegistry` Map. It has no
// clear(), so each test builds a book under a FRESH guild id for isolation.
let guildSeq = 0;
function freshGuild() { return `${G}-${guildSeq++}`; }

describe('reporter election (source-sliced from index.js)', () => {
  it('slice compiled the real constants', () => {
    expect(REPORTER_TTL_MS).toBe(60_000);
    expect(REPORTER_CHAT_COUNT).toBe(1);
    expect(typeof _electReporters).toBe('function');
    expect(typeof _reporterRank).toBe('function');
  });

  it('elects exactly one chat reporter — the lowest primary name, not insertion order', () => {
    const g = freshGuild();
    const now = Date.now();
    _reporterGuildBook(g).set('d3', { last_seen: now, primary: 'Zarl' });
    _reporterGuildBook(g).set('d1', { last_seen: now, primary: 'Abby' });
    _reporterGuildBook(g).set('d2', { last_seen: now, primary: 'Mira' });
    const r = _electReporters(g);
    expect(r.chat.size).toBe(1);
    expect(r.chat.has('d1')).toBe(true); // Abby wins regardless of insert order
  });

  it('breaks a primary-name tie by the lower discord_id', () => {
    const g = freshGuild();
    const now = Date.now();
    _reporterGuildBook(g).set('dB', { last_seen: now, primary: 'Same' });
    _reporterGuildBook(g).set('dA', { last_seen: now, primary: 'Same' });
    const r = _electReporters(g);
    expect(r.chat.has('dA')).toBe(true);
  });

  it('evicts a reporter silent past the 60s TTL and fails over to the next live agent', () => {
    const g = freshGuild();
    const now = Date.now();
    _reporterGuildBook(g).set('d1', { last_seen: now - 70_000, primary: 'Abby' }); // stale > TTL
    _reporterGuildBook(g).set('d2', { last_seen: now, primary: 'Mira' });
    const r = _electReporters(g);
    expect(_reporterGuildBook(g).has('d1')).toBe(false); // stale evicted from the book
    expect(r.chat.size).toBe(1);
    expect(r.chat.has('d2')).toBe(true); // next-lowest LIVE agent elected
  });

  it('empty guild yields zero reporters without throwing', () => {
    const g = freshGuild();
    const r = _electReporters(g);
    expect(r.chat.size).toBe(0);
    expect(r.live.length).toBe(0);
  });

  it('a single live agent is always the reporter (never zero uploaders)', () => {
    const g = freshGuild();
    _reporterGuildBook(g).set('solo', { last_seen: Date.now(), primary: 'Solo' });
    const r = _electReporters(g);
    expect(r.chat.has('solo')).toBe(true);
  });
});
