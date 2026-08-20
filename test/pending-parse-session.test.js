// test/pending-parse-session.test.js — the deferred /announce parse session
// (SOURCE-SLICE fidelity tier: the decision functions are sliced out of
// commands/raidnight.js, so edits to the real code are exercised here).
//
// The bug this pins (Hitya 2026-08-20, "why was this posted? it hasn't
// happened yet!"): /announce opened the parse session AT ANNOUNCE TIME
// whenever none was active. Announcing tomorrow's event just after midnight —
// right after the midnight chain cleared Wednesday's session — turned the
// event thread into "tonight's session home", and the All-Night Leaderboard
// filled with overnight FARM kills for an event that hadn't happened.
//
// Run: npx vitest run test/pending-parse-session.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'commands', 'raidnight.js'));
const block = sliceBlock(
  src,
  'const SESSION_OPEN_LEAD_MS',
  "if (hasActiveSession) return 'clear';\n  return 'open';\n}",
);
const { sessionOpenDecision, pendingSessionAction,
        SESSION_OPEN_LEAD_MS, PENDING_SESSION_ARM_MS, PENDING_SESSION_STALE_MS } =
  evalBlock(block, ['sessionOpenDecision', 'pendingSessionAction',
                    'SESSION_OPEN_LEAD_MS', 'PENDING_SESSION_ARM_MS', 'PENDING_SESSION_STALE_MS']);

const HOUR = 60 * 60 * 1000;

describe('sessionOpenDecision — announce-time gate', () => {
  it('THE BUG: an after-midnight announce for tomorrow 10:30 PM defers', () => {
    const now   = Date.parse('2026-08-20T04:15:00Z'); // 00:15 ET Thu
    const start = Date.parse('2026-08-21T02:30:00Z'); // 10:30 PM ET Thu
    expect(sessionOpenDecision(start, now)).toBe('defer');
  });

  it('the classic "announce at 7 for the 8:30 raid" still opens immediately', () => {
    const now = Date.parse('2026-08-20T23:00:00Z');
    expect(sessionOpenDecision(now + 1.5 * HOUR, now)).toBe('now');
    expect(sessionOpenDecision(now, now)).toBe('now');            // starting right now
    expect(sessionOpenDecision(now - HOUR, now)).toBe('now');     // already underway
  });

  it('the boundary is SESSION_OPEN_LEAD_MS', () => {
    const now = 1_000_000_000_000;
    expect(sessionOpenDecision(now + SESSION_OPEN_LEAD_MS, now)).toBe('now');
    expect(sessionOpenDecision(now + SESSION_OPEN_LEAD_MS + 1, now)).toBe('defer');
  });
});

describe('pendingSessionAction — the spawn-checker side', () => {
  const pending = { threadId: 't1', label: 'Sanctus Seru — Thu, Aug 20, 10:30 PM EDT', startMs: 1_000_000_000_000 };

  it('stays parked until PENDING_SESSION_ARM_MS before start', () => {
    expect(pendingSessionAction(pending, pending.startMs - PENDING_SESSION_ARM_MS - 1, false)).toBe('skip');
    expect(pendingSessionAction(pending, pending.startMs - PENDING_SESSION_ARM_MS, false)).toBe('open');
    expect(pendingSessionAction(pending, pending.startMs + HOUR, false)).toBe('open');
  });

  it('an officer-opened live session supersedes it', () => {
    expect(pendingSessionAction(pending, pending.startMs, true)).toBe('clear');
  });

  it('a long-past event is dropped, never opened', () => {
    expect(pendingSessionAction(pending, pending.startMs + PENDING_SESSION_STALE_MS + 1, false)).toBe('clear');
  });

  it('malformed or missing records are cleared', () => {
    expect(pendingSessionAction(null, 0, false)).toBe('clear');
    expect(pendingSessionAction({ label: 'no thread' }, 0, false)).toBe('clear');
    expect(pendingSessionAction({ threadId: 't1', startMs: NaN }, 0, false)).toBe('clear');
  });
});
