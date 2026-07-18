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

// P1b buff election (coverage-ranked, 3 per zone). A WIDER slice of the same
// source-block so the eval closes over _electBuffReporters + its coverage
// counter alongside _reporterGuildBook. Separate closure from the chat slice
// above → its own registry/coverage Maps (independent, which is what we want).
const buffBlock = sliceBlock(
  readSource(BOT_INDEX),
  'const REPORTER_TTL_MS',
  'return { elected, byZone };\n}',
);
const {
  _electBuffReporters, _recordBuffCoverage, _buffCoverageCount,
  _reporterGuildBook: _buffBook, REPORTER_BUFF_PER_ZONE,
} = evalBlock(buffBlock, [
  '_electBuffReporters', '_recordBuffCoverage', '_buffCoverageCount',
  '_reporterGuildBook', 'REPORTER_BUFF_PER_ZONE',
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

describe('buff-reporter election — coverage-ranked, 3 per zone (P1b)', () => {
  // Give one uploader `n` distinct (spell,target) landings so its coverage = n.
  function feed(g, id, n) {
    const casts = [];
    for (let i = 0; i < n; i++) casts.push({ spell_name: `sp${i}`, target: 'mob' });
    _recordBuffCoverage(g, id, casts);
  }

  it('slice compiled the real per-zone count', () => {
    expect(REPORTER_BUFF_PER_ZONE).toBe(3);
    expect(typeof _electBuffReporters).toBe('function');
  });

  it('cold start (no coverage yet) elects EVERY candidate in the zone (fail-open)', () => {
    const g = freshGuild();
    const now = Date.now();
    for (const id of ['a', 'b', 'c', 'd', 'e'])
      _buffBook(g).set(id, { last_seen: now, primary: id.toUpperCase(), zone: 'guk' });
    const r = _electBuffReporters(g);
    expect(r.elected.size).toBe(5);   // no data → nobody stands down
  });

  it('with coverage, elects the top 3 by count and stands the lowest down', () => {
    const g = freshGuild();
    const now = Date.now();
    for (const id of ['a', 'b', 'c', 'd'])
      _buffBook(g).set(id, { last_seen: now, primary: id.toUpperCase(), zone: 'guk' });
    feed(g, 'a', 40); feed(g, 'b', 30); feed(g, 'c', 20); feed(g, 'd', 10);
    const r = _electBuffReporters(g);
    expect(r.elected.size).toBe(3);
    expect(r.elected.has('a')).toBe(true);
    expect(r.elected.has('b')).toBe(true);
    expect(r.elected.has('c')).toBe(true);
    expect(r.elected.has('d')).toBe(false);   // lowest coverage → stands down
    expect(_buffCoverageCount(g, 'a', now)).toBe(40);
  });

  it('partitions by zone — each occupied zone elects its own reporters independently', () => {
    const g = freshGuild();
    const now = Date.now();
    // Zone A: 4 agents; Zone B: 2 agents. B's agents must NOT be gated by A's.
    for (const id of ['a1', 'a2', 'a3', 'a4'])
      _buffBook(g).set(id, { last_seen: now, primary: id, zone: 'zoneA' });
    for (const id of ['b1', 'b2'])
      _buffBook(g).set(id, { last_seen: now, primary: id, zone: 'zoneB' });
    feed(g, 'a1', 40); feed(g, 'a2', 30); feed(g, 'a3', 20); feed(g, 'a4', 10);
    feed(g, 'b1', 5);  feed(g, 'b2', 3);
    const r = _electBuffReporters(g);
    // Zone A: top 3 (a1,a2,a3), a4 down. Zone B: both (only 2 < 3), both up.
    expect(r.byZone['zonea']).toEqual(['a1', 'a2', 'a3']);
    expect(r.elected.has('a4')).toBe(false);
    expect(r.elected.has('b1')).toBe(true);
    expect(r.elected.has('b2')).toBe(true);
  });

  it('an agent with unknown/missing zone is its own group and is always elected', () => {
    const g = freshGuild();
    const now = Date.now();
    _buffBook(g).set('nozone', { last_seen: now, primary: 'NoZone', zone: null });
    // Even with a busy zone alongside it, the zoneless agent self-elects.
    for (const id of ['a', 'b', 'c', 'd'])
      _buffBook(g).set(id, { last_seen: now, primary: id, zone: 'guk' });
    feed(g, 'a', 40); feed(g, 'b', 30); feed(g, 'c', 20); feed(g, 'd', 10);
    const r = _electBuffReporters(g);
    expect(r.elected.has('nozone')).toBe(true);
  });

  it('breaks equal-coverage ties by the stable _reporterRank (primary name)', () => {
    const g = freshGuild();
    const now = Date.now();
    // 4 agents, all equal coverage → alphabetical primary decides the top 3.
    _buffBook(g).set('d4', { last_seen: now, primary: 'Zeb', zone: 'guk' });
    _buffBook(g).set('d1', { last_seen: now, primary: 'Abe', zone: 'guk' });
    _buffBook(g).set('d2', { last_seen: now, primary: 'Bo',  zone: 'guk' });
    _buffBook(g).set('d3', { last_seen: now, primary: 'Cy',  zone: 'guk' });
    for (const id of ['d1', 'd2', 'd3', 'd4']) feed(g, id, 10);
    const r = _electBuffReporters(g);
    expect(r.elected.has('d1')).toBe(true);   // Abe
    expect(r.elected.has('d2')).toBe(true);   // Bo
    expect(r.elected.has('d3')).toBe(true);   // Cy
    expect(r.elected.has('d4')).toBe(false);  // Zeb loses the tie → stands down
  });

  it('fails over when an elected reporter goes silent past the TTL', () => {
    const g = freshGuild();
    const now = Date.now();
    for (const id of ['a', 'b', 'c', 'd'])
      _buffBook(g).set(id, { last_seen: now, primary: id, zone: 'guk' });
    feed(g, 'a', 40); feed(g, 'b', 30); feed(g, 'c', 20); feed(g, 'd', 10);
    // 'a' (top reporter) goes silent past the 60s TTL.
    _buffBook(g).set('a', { last_seen: now - 70_000, primary: 'a', zone: 'guk' });
    const r = _electBuffReporters(g);
    expect(_buffBook(g).has('a')).toBe(false);   // evicted from the book
    expect(r.elected.has('a')).toBe(false);
    expect(r.elected.has('d')).toBe(true);       // 'd' promoted into the top 3
    expect(r.elected.size).toBe(3);
  });
});
