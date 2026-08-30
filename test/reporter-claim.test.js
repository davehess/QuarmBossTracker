// One account, several machines, one fleet slot (Hitya, 2026-08-30): the
// freshest LOG holds the slot, not the latest heartbeat. Behaviour-tested by
// executing the shipped helper — the flip-flop was invisible to text.
import { describe, it, expect } from 'vitest';
import { BOT_INDEX, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _reporterClaimAllowed } = evalBlock(
  sliceBlock(src, 'const REPORTER_CLAIM_SLACK_MS', '\n}'),
  ['_reporterClaimAllowed'],
);
const NOW = 1_000_000_000;
const claim = (incoming, incumbent, ttlMs = 90_000) =>
  _reporterClaimAllowed({ incoming, incumbent, now: NOW, ttlMs });

describe('the fleet slot', () => {
  it('refuses the idle machine while a live one holds the slot — the reported bug', () => {
    // Canopy's PC: 320h since a log line. Rockin's: 4s, seen 10s ago.
    const idle = { last_line_ms: 320 * 3600 * 1000 };
    const live = { last_line_ms: 4000, last_seen: NOW - 10_000 };
    expect(claim(idle, live)).toBe(false);
  });

  it('lets the live machine take the slot from an idle incumbent', () => {
    const live = { last_line_ms: 4000 };
    const idle = { last_line_ms: 320 * 3600 * 1000, last_seen: NOW - 10_000 };
    expect(claim(live, idle)).toBe(true);
  });

  it('lets a lone idle machine keep updating its own entry (the slack)', () => {
    // Same machine, next heartbeat: its stored age plus elapsed time equals the
    // incoming age. Without slack this ties, the entry starves, and TTL kills a
    // perfectly healthy agent.
    const prevAge = 3 * 3600 * 1000;
    const incumbent = { last_line_ms: prevAge, last_seen: NOW - 20_000 };
    const incoming = { last_line_ms: prevAge + 20_000 };
    expect(claim(incoming, incumbent)).toBe(true);
  });

  it('always allows a claim over a dead or camping incumbent', () => {
    const stale = { last_line_ms: 0, last_seen: NOW - 120_000 };          // past TTL
    expect(claim({ last_line_ms: 999_999_999 }, stale)).toBe(true);
    const camper = { last_line_ms: 0, last_seen: NOW - 1000, camping: true };
    expect(claim({ last_line_ms: 999_999_999 }, camper)).toBe(true);
    expect(claim({ last_line_ms: 1 }, null)).toBe(true);
  });

  it('old agents without last_line_ms: keep a signalled incumbent, else last-writer', () => {
    const signalled = { last_line_ms: 5000, last_seen: NOW - 10_000 };
    expect(claim({ last_line_ms: null }, signalled)).toBe(false);   // it knows, we don't
    const unsignalled = { last_line_ms: null, last_seen: NOW - 10_000 };
    expect(claim({ last_line_ms: null }, unsignalled)).toBe(true);  // status quo, no deadlock
    expect(claim({ last_line_ms: 7 }, unsignalled)).toBe(true);     // signal beats none
  });

  it('guards the ingest set() itself', () => {
    // The helper must actually gate the book write, or it is decoration.
    const i = src.indexOf('const _claimBook = _reporterGuildBook(guildId);');
    expect(i).toBeGreaterThan(-1);
    const window = src.slice(i, i + 500);
    expect(window).toMatch(/if \(_reporterClaimAllowed\(\{/);
    expect(window).toMatch(/_claimBook\.set\(id, \{/);
  });
});
