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

// P1c roster election (per-group, 1 reporter/group) + camp-out early handoff.
// The WIDEST slice — it must close over _electRosterReporters AND the shared
// _dropCampers helper AND _electReporters/_electBuffReporters so the camping
// demotion can be exercised against all three elections through one closure
// (its own registry/coverage Maps, independent of the slices above).
const rosterBlock = sliceBlock(
  readSource(BOT_INDEX),
  'const REPORTER_TTL_MS',
  'return { elected, byGroup };\n}',
);
const {
  _electRosterReporters, REPORTER_ROSTER_PER_GROUP,
  _reporterGuildBook: _rosterBook,
  _electReporters: _electReportersC,
  _electBuffReporters: _electBuffReportersC,
  _recordBuffCoverage: _recordBuffCoverageC,
} = evalBlock(rosterBlock, [
  '_electRosterReporters', 'REPORTER_ROSTER_PER_GROUP',
  '_reporterGuildBook', '_electReporters',
  '_electBuffReporters', '_recordBuffCoverage',
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

describe('roster-reporter election — per-group, 1 reporter/group (P1c)', () => {
  it('slice compiled the real per-group count', () => {
    expect(REPORTER_ROSTER_PER_GROUP).toBe(1);
    expect(typeof _electRosterReporters).toBe('function');
  });

  it('elects exactly ONE reporter per raid group, partitioned by group_num', () => {
    const g = freshGuild();
    const now = Date.now();
    // Group 1: three agents. Group 2: two agents. Each group elects its own 1.
    for (const id of ['a1', 'a2', 'a3'])
      _rosterBook(g).set(id, { last_seen: now, primary: id, group_num: 1 });
    for (const id of ['b1', 'b2'])
      _rosterBook(g).set(id, { last_seen: now, primary: id, group_num: 2 });
    const r = _electRosterReporters(g);
    expect(r.byGroup['g1'].length).toBe(1);
    expect(r.byGroup['g2'].length).toBe(1);
    expect(r.elected.size).toBe(2);              // one per occupied group
    expect(r.byGroup['g1']).toEqual(['a1']);     // lowest _reporterRank wins its group
    expect(r.byGroup['g2']).toEqual(['b1']);
    // Group 2's reporter is NEVER gated by group 1's election.
    expect(r.elected.has('b1')).toBe(true);
  });

  it('an agent with unknown/missing group is its own singleton and is always elected', () => {
    const g = freshGuild();
    const now = Date.now();
    _rosterBook(g).set('nogrp', { last_seen: now, primary: 'NoGrp', group_num: null });
    // A busy group alongside it must not swallow the group-less agent.
    for (const id of ['a1', 'a2', 'a3'])
      _rosterBook(g).set(id, { last_seen: now, primary: id, group_num: 1 });
    const r = _electRosterReporters(g);
    expect(r.elected.has('nogrp')).toBe(true);   // singleton → self-elects (fail-open)
    expect(r.byGroup['g1'].length).toBe(1);      // the real group still dedups to 1
  });

  it('fails over within a group when the elected reporter goes silent past the TTL', () => {
    const g = freshGuild();
    const now = Date.now();
    _rosterBook(g).set('a1', { last_seen: now - 70_000, primary: 'Aaa', group_num: 1 }); // stale
    _rosterBook(g).set('a2', { last_seen: now,          primary: 'Bbb', group_num: 1 });
    const r = _electRosterReporters(g);
    expect(_rosterBook(g).has('a1')).toBe(false); // evicted from the book
    expect(r.byGroup['g1']).toEqual(['a2']);      // next live groupmate takes over
  });
});

describe('camp-out early handoff — camping agents demoted before the TTL (#72 P3)', () => {
  it('CHAT: a camping top-rank agent steps aside for an awake agent', () => {
    const g = freshGuild();
    const now = Date.now();
    _rosterBook(g).set('d1', { last_seen: now, primary: 'Abby', camping: true });  // would win, but camping
    _rosterBook(g).set('d2', { last_seen: now, primary: 'Mira', camping: false });
    const r = _electReportersC(g);
    expect(r.chat.has('d1')).toBe(false);   // camper demoted early
    expect(r.chat.has('d2')).toBe(true);    // awake agent takes chat
  });

  it('CHAT: a SOLE camper stays elected (fail-open — reports until the TTL evicts it)', () => {
    const g = freshGuild();
    _rosterBook(g).set('solo', { last_seen: Date.now(), primary: 'Solo', camping: true });
    const r = _electReportersC(g);
    expect(r.chat.has('solo')).toBe(true);  // never zero uploaders
  });

  it('BUFFS: a camping agent is dropped from its zone while an awake peer remains', () => {
    const g = freshGuild();
    const now = Date.now();
    _rosterBook(g).set('a', { last_seen: now, primary: 'A', zone: 'guk', camping: true });
    _rosterBook(g).set('b', { last_seen: now, primary: 'B', zone: 'guk', camping: false });
    // 'a' has HIGHER coverage but is camping → 'b' wins the seat anyway.
    _recordBuffCoverageC(g, 'a', [{ spell_name: 's1', target: 'm' }, { spell_name: 's2', target: 'm' }]);
    _recordBuffCoverageC(g, 'b', [{ spell_name: 's1', target: 'm' }]);
    const r = _electBuffReportersC(g);
    expect(r.elected.has('a')).toBe(false);
    expect(r.elected.has('b')).toBe(true);
  });

  it('BUFFS: an all-camping zone keeps everyone (fail-open — no landing goes dark)', () => {
    const g = freshGuild();
    const now = Date.now();
    for (const id of ['a', 'b'])
      _rosterBook(g).set(id, { last_seen: now, primary: id, zone: 'guk', camping: true });
    const r = _electBuffReportersC(g);
    expect(r.elected.has('a')).toBe(true);
    expect(r.elected.has('b')).toBe(true);
  });

  it('ROSTER: a camping group-reporter hands off to an awake groupmate', () => {
    const g = freshGuild();
    const now = Date.now();
    _rosterBook(g).set('a1', { last_seen: now, primary: 'Aaa', group_num: 1, camping: true });  // would win
    _rosterBook(g).set('a2', { last_seen: now, primary: 'Bbb', group_num: 1, camping: false });
    const r = _electRosterReporters(g);
    expect(r.byGroup['g1']).toEqual(['a2']);   // awake groupmate reports instead
  });

  it('ROSTER: a solo camper in its group keeps reporting (fail-open)', () => {
    const g = freshGuild();
    _rosterBook(g).set('a1', { last_seen: Date.now(), primary: 'Aaa', group_num: 1, camping: true });
    const r = _electRosterReporters(g);
    expect(r.byGroup['g1']).toEqual(['a1']);
    expect(r.elected.has('a1')).toBe(true);
  });
});
