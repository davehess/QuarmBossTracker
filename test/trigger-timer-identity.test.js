// test/trigger-timer-identity.test.js — a timer's identity and label must come
// from SEMANTIC captures only.
//
// The bug (Hitya, live, 2026-08-10 Ssra — docs/FINDINGS-2026-08-10-trigger-overlay.md
// P1): _buildCaptureBag puts numeric keys ('0' = the whole match), L/l (the raw
// log line, EQ timestamp included) and c/char/self into the capture bag so that
// action text can interpolate {L}/{c}. _startTimer then folded the WHOLE bag into
// the timer id and picked the row label from the sorted keys. Four consequences,
// all observed on one Ssra pull:
//
//   1. every fire made a NEW row — L differs per line, so no two ids matched;
//   2. timer_key_capture was dead code — captureSuffix was appended on top of it,
//      and the seven slow triggers already carried timer_key_capture='s';
//   3. the row label was the whole log line — '0' sorts first (digits before
//      letters) and for an ^…$ pattern '0' IS the line;
//   4. _cancelTimersOnMobDeath could never clear a row, because it matches the
//      timer's `target` against the dead mob's name and `target` was a log line.
//
// Run: npx vitest run test/trigger-timer-identity.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// Both blocks are sliced from the SHIPPED source, so a rename or a regression in
// either one fails loudly here rather than silently testing a stale copy.
const helpers = sliceBlock(src, 'const _NON_SEMANTIC_CAPTURES', '\n  return out;\n}');
const startTimer = sliceBlock(src, 'function _startTimer(t, tsMs, isTest, captures)', '\n}');

function build() {
  const harness = `
    const _activeTimers = new Map();
    const stats = {};
    function _activeTimersSnapshot() { return []; }
    function _timerDurationSec(t) { return Number(t.timer_duration_sec) || 0; }
    function _timerWarnings() { return []; }
  ` + helpers + '\n' + startTimer + `
    return { _startTimer, _activeTimers, _semanticCaptures, _semanticCaptureKeys };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

// A realistic _buildCaptureBag payload: the semantic captures PLUS the three
// classes of non-semantic key the real bag always carries.
function bag(line, semantic) {
  const b = { '0': line, L: line, l: line, c: 'Hitya', char: 'Hitya', self: 'Hitya' };
  let i = 1;
  for (const k of Object.keys(semantic)) { b[String(i++)] = semantic[k]; }
  return Object.assign(b, semantic);
}

const LINE_1 = '[Sun Aug 09 21:04:24 2026] A Shissar Templar yawns.';
const LINE_2 = '[Sun Aug 09 21:04:26 2026] A Shissar Templar yawns.';   // 2s later
const SLOW = { id: 'facb6fea', name: 'Shaman Slow landed', timer_duration_sec: 180 };

describe('timer identity ignores non-semantic capture-bag keys', () => {
  it('re-slowing the SAME mob resets one row instead of adding a second', () => {
    const h = build();
    h._startTimer(SLOW, Date.parse(LINE_1.slice(1, 25)), false, bag(LINE_1, { s: 'A Shissar Templar' }));
    h._startTimer(SLOW, Date.parse(LINE_2.slice(1, 25)), false, bag(LINE_2, { s: 'A Shissar Templar' }));
    // Before the fix: two rows, because L (and '0') carried the timestamp.
    expect(h._activeTimers.size).toBe(1);
  });

  it('the row label is the mob name, not the whole log line', () => {
    const h = build();
    h._startTimer(SLOW, Date.now(), false, bag(LINE_1, { s: 'A Shissar Templar' }));
    const row = [...h._activeTimers.values()][0];
    // `target` is what _cancelTimersOnMobDeath matches against, so this is also
    // the assertion that killing the mob can now clear its chip.
    expect(row.target).toBe('A Shissar Templar');
    expect(row.target).not.toContain('Aug 09');
    expect(row.name).toBe('A Shissar Templar - Shaman Slow landed');
  });

  it('different mobs still get independent rows', () => {
    const h = build();
    h._startTimer(SLOW, Date.now(), false, bag(LINE_1, { s: 'A Shissar Templar' }));
    h._startTimer(SLOW, Date.now(), false, bag(LINE_2, { s: 'a temple skirmisher' }));
    expect(h._activeTimers.size).toBe(2);
  });

  it('timer_key_capture is honoured — the keyed capture IS the identity', () => {
    const h = build();
    const keyed = { ...SLOW, timer_key_capture: 's' };
    // Same mob, different line AND a differing incidental capture: with the key
    // set, only `s` decides identity.
    h._startTimer(keyed, Date.now(), false, bag(LINE_1, { s: 'A Shissar Templar', caster: 'Hitya' }));
    h._startTimer(keyed, Date.now(), false, bag(LINE_2, { s: 'A Shissar Templar', caster: 'Sweenie' }));
    expect(h._activeTimers.size).toBe(1);
    expect([...h._activeTimers.keys()][0]).toBe('facb6fea::a shissar templar');
  });

  it('timer_key_capture still separates DIFFERENT key values', () => {
    const h = build();
    const keyed = { ...SLOW, timer_key_capture: 's' };
    h._startTimer(keyed, Date.now(), false, bag(LINE_1, { s: 'A Shissar Templar' }));
    h._startTimer(keyed, Date.now(), false, bag(LINE_2, { s: 'a temple skirmisher' }));
    expect(h._activeTimers.size).toBe(2);
  });

  it('a key_capture that matched nothing falls back to per-capture keying', () => {
    const h = build();
    // Guard against collapsing every fire onto one row when the key is declared
    // but absent from the match — that would be a worse bug than the original.
    const keyed = { ...SLOW, timer_key_capture: 'missing' };
    h._startTimer(keyed, Date.now(), false, bag(LINE_1, { s: 'A Shissar Templar' }));
    h._startTimer(keyed, Date.now(), false, bag(LINE_2, { s: 'a temple skirmisher' }));
    expect(h._activeTimers.size).toBe(2);
  });
});

describe('_semanticCaptures', () => {
  it('drops numeric, L/l and c/char/self keys and keeps the rest', () => {
    const h = build();
    expect(h._semanticCaptures(bag(LINE_1, { s: 'A Shissar Templar', victim: 'Hitya' })))
      .toEqual({ s: 'A Shissar Templar', victim: 'Hitya' });
  });

  it('two observers of one event build the SAME key from their own log lines', () => {
    const h = build();
    // This is the "REST IN PEACE spoken twice" bug: the relay dedup key was
    // built from the whole bag, so each observer's second-resolution timestamp
    // produced a different key and nobody recognised the duplicate.
    const mine   = JSON.stringify(h._semanticCaptures(bag(LINE_1, { victim: 'Hitya' })));
    const theirs = JSON.stringify(h._semanticCaptures(bag(LINE_2, { victim: 'Hitya' })));
    expect(mine).toBe(theirs);
  });

  it('but a genuinely different event still keys differently', () => {
    const h = build();
    const a = JSON.stringify(h._semanticCaptures(bag(LINE_1, { victim: 'Hitya' })));
    const b = JSON.stringify(h._semanticCaptures(bag(LINE_1, { victim: 'Sweenie' })));
    expect(a).not.toBe(b);
  });

  it('null/undefined captures are safe', () => {
    const h = build();
    expect(h._semanticCaptures(null)).toEqual({});
    expect(h._semanticCaptureKeys(undefined)).toEqual([]);
  });
});
