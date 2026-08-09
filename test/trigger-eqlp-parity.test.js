// test/trigger-eqlp-parity.test.js — the EQLogParser-parity trigger fields.
//
// Hitya 2026-08-07: "I'm doing almost all of the authoring, until this system
// is as granular as EQLogParser triggers." That removed the officer
// authoring-floor blocker, so these ship against the newest shape — but every
// one MUST degrade to the legacy portable shape, because an older bundled
// Mimic reads the scalars and ignores what it can't parse.
//
// Run: npx vitest run test/trigger-eqlp-parity.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block =
  sliceBlock(src, 'function _timerWarnings(t) {', '\n}') +
  sliceBlock(src, 'function _parseDurationText(raw) {', '\n}') +
  sliceBlock(src, 'function _timerDurationSec(t, captures) {', '\n}');

// eslint-disable-next-line no-new-func
const H = new Function(block + '\nreturn { _timerWarnings, _parseDurationText, _timerDurationSec };')();

describe('_timerWarnings — several thresholds, not one', () => {
  it('a tank buster can warn at 10s AND 4s', () => {
    const out = H._timerWarnings({ timer_warnings: [
      { seconds: 4,  text: 'BUSTER NOW' },
      { seconds: 10, text: 'buster in ten' },
    ] });
    expect(out.map(w => w.at_ms)).toEqual([10000, 4000]);   // descending
    expect(out[0].tts).toBe(true);
  });

  it('falls back to the legacy scalar pair when no list is authored', () => {
    const out = H._timerWarnings({ warning_seconds: 12, warning_text: 'RAGE SOON' });
    expect(out).toEqual([{ at_ms: 12000, text: 'RAGE SOON', tts: true }]);
  });

  it('the list wins over the legacy pair when both exist', () => {
    const out = H._timerWarnings({
      timer_warnings: [{ seconds: 5, text: 'five' }],
      warning_seconds: 30, warning_text: 'thirty',
    });
    expect(out).toEqual([{ at_ms: 5000, text: 'five', tts: true }]);
  });

  it('tts:false is honoured — banner without speech', () => {
    expect(H._timerWarnings({ timer_warnings: [{ seconds: 5, text: 'x', tts: false }] })[0].tts).toBe(false);
  });

  it('drops malformed entries instead of throwing', () => {
    const out = H._timerWarnings({ timer_warnings: [
      { seconds: 0, text: 'zero' }, { seconds: 5 }, null, { seconds: 9, text: 'ok' },
    ] });
    expect(out).toEqual([{ at_ms: 9000, text: 'ok', tts: true }]);
  });

  it('no warnings authored at all is an empty list, not a crash', () => {
    expect(H._timerWarnings({})).toEqual([]);
  });
});

describe('_parseDurationText — a mechanic that announces its own timing', () => {
  it('plain seconds, clock notation, and unit notation', () => {
    expect(H._parseDurationText('400')).toBe(400);
    expect(H._parseDurationText('6:40')).toBe(400);
    expect(H._parseDurationText('1:02:03')).toBe(3723);
    expect(H._parseDurationText('6m40s')).toBe(400);
    expect(H._parseDurationText('90s')).toBe(90);
    expect(H._parseDurationText('2h')).toBe(7200);
  });

  it('junk yields 0 rather than a bogus timer', () => {
    expect(H._parseDurationText('soon')).toBe(0);
    expect(H._parseDurationText('')).toBe(0);
    expect(H._parseDurationText(null)).toBe(0);
  });
});

describe('_timerDurationSec — captured duration beats the fixed one', () => {
  it('reads the named capture group', () => {
    expect(H._timerDurationSec(
      { timer_duration_capture: 'secs', timer_duration_sec: 30 }, { secs: '45' })).toBe(45);
  });

  it('falls back to the fixed duration when the capture is missing or junk', () => {
    expect(H._timerDurationSec({ timer_duration_capture: 'secs', timer_duration_sec: 30 }, {})).toBe(30);
    expect(H._timerDurationSec({ timer_duration_capture: 'secs', timer_duration_sec: 30 }, { secs: 'soon' })).toBe(30);
  });

  it('a plain fixed-duration trigger is unchanged', () => {
    expect(H._timerDurationSec({ timer_duration_sec: 60 }, null)).toBe(60);
    expect(H._timerDurationSec({}, null)).toBe(0);
  });

  it('caps an absurd captured duration rather than trusting log text', () => {
    expect(H._timerDurationSec({ timer_duration_capture: 's' }, { s: '99999' })).toBe(3 * 3600);
  });
});
