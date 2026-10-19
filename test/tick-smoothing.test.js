// FB-85 (a raider, Mimic 3.0.0-beta.8): "The Server Tick on the TTS overlay is very jumpy instead of not a smooth
// countdown." The agent's tick boundary is an estimate with 0-300 ms of flush-delay noise per poll, and both tick
// displays re-anchored on every poll. smoothAnchor keeps the anchor and moves it only as far as the real drift. It is
// the same function in two windows with no shared script (triggers.html: cyclic timer rows; zealhealth.html: the Tick
// overlay), so both copies are sliced and run here, and must agree.
//
// Mutation-checked (each makes a test below fail): drop the 250 ms dead zone; change the 0.25 gain to 1 (or 0); drop the
// 1.5 s snap; drop the modulo (compare raw error); drop the wrap to (-cycle/2, cycle/2]; drop the wiring in either file.
//
// Run: npx vitest run test/tick-smoothing.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const read = (f) => readSource(path.join(ROOT, 'apps', 'mimic', f));
const TRIG = read('triggers.html'), ZEAL = read('zealhealth.html');
const slice = (html) => new Function(sliceBlock(html, 'function smoothAnchor(prev, next, cycle){', '\n  }\n') + '\nreturn smoothAnchor;')();

const C = 6000;
for (const [file, html] of [['triggers.html', TRIG], ['zealhealth.html', ZEAL]]) {
  const smooth = slice(html);
  describe('smoothAnchor in ' + file, () => {
    it('a new row (no anchor yet) takes the estimate as it comes', () => {
      expect(smooth(null, 123456, C)).toBe(123456);
      expect(smooth(undefined, 123456, C)).toBe(123456);
    });
    it('noise under 250 ms does not move the anchor, either way', () => {
      expect(smooth(100000, 100000 + 249, C)).toBe(100000);
      expect(smooth(100000, 100000 - 249, C)).toBe(100000);
      expect(smooth(100000, 100000, C)).toBe(100000);
    });
    it('a moderate error is closed a quarter at a time and converges over a few polls', () => {
      expect(smooth(100000, 100000 + 800, C)).toBe(100200);
      expect(smooth(100000, 100000 - 800, C)).toBe(99800);
      let a = 100000;
      const truth = 100000 + 1000;
      const seen = [];
      for (let i = 0; i < 12; i++) { a = smooth(a, truth, C); seen.push(a); }
      expect(seen[0]).toBe(100250);                     // one step is a quarter of the error, not all of it
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);   // never overshoots or reverses
      expect(truth - a).toBeLessThan(250);              // and it stops once inside the dead zone
    });
    it('a large error (over 1.5 s) snaps; 1.5 s itself is still smoothed', () => {
      expect(smooth(100000, 100000 + 1501, C)).toBe(101501);
      expect(smooth(100000, 100000 - 2500, C)).toBe(97500);
      expect(smooth(100000, 100000 + 1500, C)).toBe(100375);
    });
    it('the error is taken modulo the cycle: a boundary one or more cycles off is the same boundary', () => {
      expect(smooth(100000, 100000 + C + 100, C)).toBe(100000);          // 100 ms of noise, one tick later
      expect(smooth(100000, 100000 - 3 * C + 100, C)).toBe(100000);
      expect(smooth(100000, 100000 + 2 * C + 800, C)).toBe(100200);      // 800 ms of real drift, two ticks later
    });
    it('wraps at the cycle boundary: -100 ms and +5900 ms are the same error', () => {
      expect(smooth(100000, 100000 + 5900, C)).toBe(100000);             // really 100 ms early: noise
      expect(smooth(100000, 100000 + 5200, C)).toBe(100000 - 200);       // really 800 ms early: closed from below
      expect(smooth(100000, 100000 + 3500, C)).toBe(100000 + 3500);      // 2.5 s off: snap
    });
    it('a countdown fed noisy polls (+-300 ms) moves at most ~100 ms per poll, where the raw estimate swings the full range', () => {
      let a = null, prev = null, rawPrev = null, worst = 0, rawWorst = 0;
      const noise = [0, 230, -180, 290, -250, 120, -90, 300, 10, -300, 200, -40];
      for (let i = 0; i < noise.length; i++) {
        const raw = 1_000_000 + 4000 + noise[i];   // the same real boundary, estimated with flush-delay noise
        a = smooth(a, raw, C);
        if (prev != null) { worst = Math.max(worst, Math.abs(a - prev)); rawWorst = Math.max(rawWorst, Math.abs(raw - rawPrev)); }
        prev = a; rawPrev = raw;
      }
      expect(rawWorst).toBeGreaterThan(400);
      expect(worst).toBeLessThanOrEqual(100);   // a quarter of the widest error it can see (the anchor itself has wandered ~70 ms)
    });
  });
}

describe('both copies are the same function', () => {
  it('give the same answer over a sweep of errors', () => {
    const a = slice(TRIG), b = slice(ZEAL);
    for (let e = -7000; e <= 7000; e += 137) expect(a(50000, 50000 + e, C)).toBe(b(50000, 50000 + e, C));
  });
});

describe('wiring', () => {
  it('triggers.html smooths only rows that carry a cycle; every other row re-anchors as before', () => {
    const js = stripJs(TRIG);
    expect(js).toMatch(/n\.ends_at_local = t\.cycle_ms > 0 \? smoothAnchor\(n\.ends_at_local, Date\.now\(\) \+ t\.remaining_ms, t\.cycle_ms\)\s+: Date\.now\(\) \+ t\.remaining_ms;/);
  });
  it('the Tick overlay runs every polled row through it, keyed by row, and forgets rows that are gone', () => {
    const js = stripJs(ZEAL);
    expect(js).toMatch(/_rows = smoothRows\(tickRows\(s\)\);/);
    const smoothRows = sliceBlock(js, 'function smoothRows(rows){', '\n  }\n');
    expect(smoothRows).toMatch(/r\.at = kept\[r\.key\] = smoothAnchor\(_anchors\[r\.key\], r\.at, TICK_MS\);/);
    expect(smoothRows).toMatch(/_anchors = kept;/);
  });
  it('smoothRows: keeps each row\'s anchor across polls, ignores a null boundary, drops a vanished row', () => {
    const src = sliceBlock(ZEAL, '  var TICK_MS = 6000;', '\n  var _anchors = {};')
      + sliceBlock(ZEAL, '  function smoothRows(rows){', '\n  }\n');
    const smoothRows = new Function(src + '\nreturn smoothRows;')();
    const first = smoothRows([{ key: 's|a', at: 100000 }, { key: 'm|b', at: null }]);
    expect(first.map(r => r.at)).toEqual([100000, null]);
    expect(smoothRows([{ key: 's|a', at: 100000 + C + 200 }])[0].at).toBe(100000);   // 200 ms of noise a tick later
    smoothRows([]);                                                                  // the row went away
    expect(smoothRows([{ key: 's|a', at: 777777 }])[0].at).toBe(777777);             // back as a new row: no stale anchor
  });
});
