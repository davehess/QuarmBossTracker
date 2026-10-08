// test/panel-auctions-ends-at.test.js — the live auctions panel reads OpenDKP's end time.
//
// The panel read `EndTime || EndsAt`; OpenDKP's field is `EndTimestamp` (the settled history reads
// it in utils/openDkpSync.js), so every auction's ends_at was null and nothing could count one down.
// Per-auction timers (the guild lead, 2026-10-02) need it, and a late bid moves it later.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _odkpTime } = evalBlock(sliceBlock(src, 'function _odkpTime(', '\n}\n'), ['_odkpTime']);

describe('_odkpTime', () => {
  it('a zoneless OpenDKP time is UTC', () => {
    expect(_odkpTime('2026-09-28T03:06:35')).toBe('2026-09-28T03:06:35.000Z');
    expect(_odkpTime('2026-09-28T03:06:35.123')).toBe('2026-09-28T03:06:35.123Z');
  });
  it('a time with a zone keeps it', () => {
    expect(_odkpTime('2026-09-28T03:06:35Z')).toBe('2026-09-28T03:06:35.000Z');
    expect(_odkpTime('2026-09-27T23:06:35-04:00')).toBe('2026-09-28T03:06:35.000Z');
  });
  it('nothing usable is null', () => {
    expect(_odkpTime(null)).toBeNull();
    expect(_odkpTime('')).toBeNull();
    expect(_odkpTime('soon')).toBeNull();
  });
});

describe('the panel maps EndTimestamp', () => {
  it('ends_at and started_at', () => {
    const code = stripJs(src);
    expect(code).toMatch(/ends_at: +_odkpTime\(a\.EndTimestamp \|\| a\.EndTime \|\| a\.EndsAt\),/);
    expect(code).toMatch(/started_at: _odkpTime\(a\.CreatedTimestamp \|\| a\.StartTimestamp\),/);
  });
});
