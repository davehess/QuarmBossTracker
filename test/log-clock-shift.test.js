// A log whose clock is a whole hour off this PC's (the guild lead, 2026-11-02: "I think the timezone change is messing
// people up - the hails weren't coming through initially"). On the first raid after the clocks went back, a third of
// the night's hails reached the bot on time but carried a log time exactly one hour early or late, and the hail board
// dropped them. The agent now puts a log's LIVE lines back on the hour once they keep reading a whole hour off.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const TS = sliceBlock(AGENT, "const TS_RX = /^\\[(\\w+ \\w+ \\d+ \\d+:\\d+:\\d+ \\d+)\\]/;", '\n}\n');
const BLOCK = sliceBlock(AGENT, 'const LOG_CLOCK_BAND_MS = ', "return '[' + _eqStamp(new Date(t - h * 3600000)) + ']' + line.slice(m[0].length);\n}");
// eslint-disable-next-line no-new-func
const A = new Function(TS + '\n' + BLOCK + '\nreturn { _fixLogClock, _eqStamp, parseEqTimestamp, LOG_CLOCK_CONFIRM };')();

const NOW = new Date(2026, 10, 1, 20, 37, 0).getTime();   // 8:37 PM local, the raid
const line = (ms, text = 'You say, \'Hail, A Planar Projection\'') => '[' + A._eqStamp(new Date(ms)) + '] ' + text;
const fresh = () => ({ shiftH: 0, candH: 0, offRun: 0, okRun: 0 });
const H = 3600000;

describe('EverQuest timestamps', () => {
  it('_eqStamp writes the client\'s own format, and parses back to the same moment', () => {
    expect(A._eqStamp(new Date(2026, 10, 1, 8, 6, 9))).toBe('Sun Nov 01 08:06:09 2026');
    expect(A.parseEqTimestamp(line(NOW)).getTime()).toBe(NOW);
  });
});

describe('a log an hour off this PC\'s clock', () => {
  for (const [label, off] of [['an hour ahead (a client still on summer time)', H], ['an hour behind', -H]]) {
    it(`${label}: corrected after ${5} live lines, and every line after`, () => {
      const st = fresh(), said = [];
      const out = [];
      for (let i = 0; i < 8; i++) out.push(A._fixLogClock(line(NOW + off + i * 1000), st, NOW + i * 1000, h => said.push(h)));
      // the first four stay as written (not yet believed); from the fifth on, the time is back on this PC's clock
      for (let i = 0; i < 4; i++) expect(A.parseEqTimestamp(out[i]).getTime()).toBe(NOW + off + i * 1000);
      for (let i = 4; i < 8; i++) expect(A.parseEqTimestamp(out[i]).getTime()).toBe(NOW + i * 1000);
      expect(out[7].endsWith("You say, 'Hail, A Planar Projection'")).toBe(true);
      expect(said).toEqual([off / H]);
    });
  }

  it('a log in step is never touched', () => {
    const st = fresh();
    for (let i = 0; i < 20; i++) { const l = line(NOW + i * 1000 - 2000); expect(A._fixLogClock(l, st, NOW + i * 1000)).toBe(l); }
    expect(st.shiftH).toBe(0);
  });

  it('lines read late, or an hour-and-a-half off, are not a clock step and change nothing', () => {
    const st = fresh();
    for (const off of [10 * 60e3, -40 * 60e3, 1.5 * H, 3 * H]) {
      for (let i = 0; i < 6; i++) { const l = line(NOW + off); expect(A._fixLogClock(l, st, NOW)).toBe(l); }
    }
    expect(st.shiftH).toBe(0);
  });

  it('stops correcting once the log is back in step', () => {
    const st = fresh(), said = [];
    for (let i = 0; i < 6; i++) A._fixLogClock(line(NOW + H), st, NOW, h => said.push(h));
    for (let i = 0; i < 6; i++) { const l = line(NOW); expect(A._fixLogClock(l, st, NOW, h => said.push(h))).toBe(l); }
    expect(st.shiftH).toBe(0);
    expect(said).toEqual([1, 0]);
  });

  it('a line with no timestamp passes through', () => {
    expect(A._fixLogClock('no stamp here', fresh(), NOW)).toBe('no stamp here');
  });
});

describe('wiring', () => {
  it('the live tail fixes each line before anything else reads it', () => {
    const tail = sliceBlock(AGENT, 'const _logClock = { shiftH: 0', '_noteOwnRawLine(line, b.character)');
    expect(tail.indexOf('line = _fixLogClock(line, _logClock, Date.now()')).toBeGreaterThan(-1);
    expect(tail.indexOf('line = _fixLogClock(')).toBeLessThan(tail.indexOf('_noteOwnRawLine('));
  });
});
