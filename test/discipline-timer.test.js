// test/discipline-timer.test.js — the SELF-ONLY discipline reuse timer.
//
// "discipline cooldowns should be tracked on the command center for the user
// only" (Hitya, 2026-08-30), reported with the line that produced it:
//
//   [Sat Aug 30 22:46:23 2026] You can use a new discipline in 10 minutes 34 seconds.
//
// EQ's melee disciplines share one reuse timer per character, and that refusal
// line is the only place the client states it exactly. It is self-only by
// construction — your log, your character, nobody else named — which is why
// this is not a raid-wide board.
//
// Run: npx vitest run test/discipline-timer.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const _DISC_REFUSAL_RX =',
  '// ── Raid-wide healer/caster mana roster');

// parseEqTimestamp lives elsewhere in the monolith; the tracker only needs it to
// date the line, so the harness supplies the real EQ format parse.
const HARNESS = `
  function parseEqTimestamp(line){
    var m = /^\\[(.+?)\\]/.exec(line);
    if (!m) return null;
    var t = Date.parse(m[1]);
    return isNaN(t) ? null : t;
  }
`;

function build() {
  return evalBlock(HARNESS + block,
    ['trackDisciplineTimerLine', '_disciplineTimerSnapshot', '_discReadyAt']);
}

const AT = '[Sat Aug 30 22:46:23 2026] ';
let h;
beforeEach(() => { h = build(); });

// Freeze "now" at the log line's own timestamp so the arithmetic is exact.
function atLineTime(fn) {
  const real = Date.now;
  Date.now = () => Date.parse('Sat Aug 30 22:46:23 2026');
  try { return fn(); } finally { Date.now = real; }
}

describe('parsing the refusal line', () => {
  it('reads minutes AND seconds — the reported case', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes 34 seconds.', 'Hawkner');
    const s = atLineTime(() => h._disciplineTimerSnapshot('Hawkner'));
    expect(s.seconds).toBe(10 * 60 + 34);
    expect(s.character).toBe('Hawkner');
  });

  it('reads a seconds-only line', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 41 seconds.', 'Hawkner');
    expect(atLineTime(() => h._disciplineTimerSnapshot('Hawkner')).seconds).toBe(41);
  });

  it('reads a minutes-only line', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 3 minutes.', 'Hawkner');
    expect(atLineTime(() => h._disciplineTimerSnapshot('Hawkner')).seconds).toBe(180);
  });

  it('handles the singular forms', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 1 minute 1 second.', 'Hawkner');
    expect(atLineTime(() => h._disciplineTimerSnapshot('Hawkner')).seconds).toBe(61);
  });

  it('dates the countdown from the LOG LINE, not from when we read it', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes 0 seconds.', 'Hawkner');
    const ready = atLineTime(() => Date.parse(h._disciplineTimerSnapshot('Hawkner').ready_at));
    expect(ready).toBe(Date.parse('Sat Aug 30 22:46:23 2026') + 600_000);
  });

  it('a later line replaces the earlier one', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes.', 'Hawkner');
    h.trackDisciplineTimerLine('[Sat Aug 30 22:50:23 2026] You can use a new discipline in 2 minutes.', 'Hawkner');
    const ready = atLineTime(() => Date.parse(h._disciplineTimerSnapshot('Hawkner').ready_at));
    expect(ready).toBe(Date.parse('Sat Aug 30 22:50:23 2026') + 120_000);
  });
});

describe('scope — the user only', () => {
  it('keeps a separate timer per watched character', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes.', 'Hawkner');
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 2 minutes.', 'Rockin');
    expect(atLineTime(() => h._disciplineTimerSnapshot('Hawkner')).seconds).toBe(600);
    expect(atLineTime(() => h._disciplineTimerSnapshot('Rockin')).seconds).toBe(120);
  });

  it('a character with no observed line has no timer', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes.', 'Hawkner');
    expect(h._disciplineTimerSnapshot('Canopy')).toBe(null);
  });

  it('matches character names case-insensitively', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 90 seconds.', 'Hawkner');
    expect(atLineTime(() => h._disciplineTimerSnapshot('hawkner')).seconds).toBe(90);
  });

  it('needs a character — an unattributed line is dropped', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 10 minutes.', '');
    expect(h._discReadyAt.size).toBe(0);
  });
});

describe('expiry', () => {
  it('reports null once the timer has run out, and forgets the entry', () => {
    h.trackDisciplineTimerLine('[Sat Aug 30 20:00:00 2026] You can use a new discipline in 30 seconds.', 'Hawkner');
    expect(h._disciplineTimerSnapshot('Hawkner')).toBe(null);   // real clock is long past
    expect(h._discReadyAt.size).toBe(0);                        // and the map does not grow
  });
});

describe('lines that must NOT start a timer', () => {
  it('ignores an unrelated line', () => {
    h.trackDisciplineTimerLine(AT + 'You assume a defensive fighting style.', 'Hawkner');
    expect(h._discReadyAt.size).toBe(0);
  });

  it('ignores someone else talking about disciplines in chat', () => {
    h.trackDisciplineTimerLine(AT + 'Bob tells the raid, "save your discipline for the next add"', 'Hawkner');
    expect(h._discReadyAt.size).toBe(0);
  });

  it('ignores a zero-length countdown rather than pinning a 0s chip', () => {
    h.trackDisciplineTimerLine(AT + 'You can use a new discipline in 0 seconds.', 'Hawkner');
    expect(h._discReadyAt.size).toBe(0);
  });
});

describe('wiring', () => {
  const clean = stripJs(src);

  it('runs on the watch loop beside the other self-line trackers', () => {
    expect(clean).toContain('trackDisciplineTimerLine(line, b.character)');
  });

  it('is served on the Command Center payload for the ACTIVE character only', () => {
    expect(clean).toContain('discipline:    _disciplineTimerSnapshot(activeChar)');
  });

  it('is NOT folded into the raid-wide defensives board', () => {
    const snap = sliceBlock(clean, 'function daBroadcastsSnapshot(', '\n}\n');
    expect(snap).not.toContain('_disciplineTimerSnapshot');
    expect(snap).not.toContain('_discReadyAt');
  });
});
