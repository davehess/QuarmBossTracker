// Trigger privacy filter — REAL-IMPORT (patterns) + SOURCE-SLICE hybrid.
//
// The invariant under test: when a log line is offered to the trigger evaluator,
// privacy drops (officer chat, incoming/outgoing tells, group chat, custom
// numbered channels, public say/shout/auction) must stay HIDDEN, while a
// pet-leader / charm-ack line that a PRIORITY_KEEP pattern rescues stays VISIBLE
// — and non-combat lines a trigger legitimately watches (ENRAGED, snared,
// fizzles, emotes) remain visible even though they aren't combat events.
//
// FIDELITY: the load-bearing parts — the real DEFAULT_DROP_PATTERNS and
// PRIORITY_KEEP_PATTERNS arrays — are sliced verbatim from the shipped agent
// source (packages/wolfpack-logsync/index.js), so edits to the privacy patterns
// are exercised here. Only the tiny decision wrapper below is test-local: it
// encodes the intended "triggers see-before-combat-filter" ordering
// (priority-keep → drop → default-visible). NOTE (drift): the shipped tail loop
// currently evaluates triggers AFTER shouldKeep() (default-DROP), so this suite
// characterizes the privacy arrays' hide/show decisions, which are the security-
// relevant part, rather than the current gate ordering.
//
// Ported from the session's scratchpad trigvis_test.js (12 cases).

import { describe, it, expect } from 'vitest';
import { readSource, sliceArrayLiteral, AGENT_INDEX } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const DROPS    = sliceArrayLiteral(agentSrc, 'const DEFAULT_DROP_PATTERNS');
const PRIORITY = sliceArrayLiteral(agentSrc, 'const PRIORITY_KEEP_PATTERNS');

// Intended trigger-visibility decision (test-local wrapper around real arrays):
// priority keeps override drops; a drop hides the line; anything else is visible
// to triggers (default-keep — unlike shouldKeep's default-drop combat filter).
function triggerVisibleLine(line, drops = DROPS, priorityKeeps = PRIORITY) {
  for (const rx of priorityKeeps) if (rx.test(line)) return true;
  for (const rx of drops) if (rx.test(line)) return false;
  return true;
}

const T = '[Fri May 26 02:34:04 2026] ';

describe('trigger privacy filter (real agent DROP/PRIORITY patterns)', () => {
  it('sliced the real pattern arrays', () => {
    expect(DROPS.length).toBeGreaterThan(0);
    expect(PRIORITY.length).toBeGreaterThan(0);
    expect(DROPS.every((r) => r instanceof RegExp)).toBe(true);
    expect(PRIORITY.every((r) => r instanceof RegExp)).toBe(true);
  });

  // Non-combat lines a trigger watches must be VISIBLE (the keep-MISS class).
  it.each([
    ['Rhag`Zhezum has become ENRAGED.', 'ENRAGED'],
    ['You are snared.',                 'snared'],
    ['Your Rain of Fire spell fizzles.', 'fizzle'],
    ['You feel yourself starting to appear.', 'random emote'],
  ])('keeps non-combat line visible to triggers: %s', (line) => {
    expect(triggerVisibleLine(T + line)).toBe(true);
  });

  // Privacy lines must NEVER be visible.
  it.each([
    ["Bob tells you, 'secret'",             'incoming tell'],
    ["You told Bob, 'secret'",              'outgoing tell'],
    ["You tells Wolfpackofficer: 'plan'",   'officer channel'],
    ["tells General:2, 'hi'",               'custom numbered channel'],
    ["Al tells the group, 'inc'",           'group chat'],
    ["You say to your group, 'inc'",        'group say'],
    ["Vox shouts, 'You dare?'",             'public shout'],
  ])('hides private line from triggers: %s', (line) => {
    expect(triggerVisibleLine(T + line)).toBe(false);
  });

  // Pet-leader / charm-ack line rescued by a PRIORITY_KEEP pattern stays visible.
  it('keeps a pet-leader "Master." ack visible via priority-keep', () => {
    expect(triggerVisibleLine(T + "a pet tells you, 'My leader is Utoh Master.'")).toBe(true);
  });
});
