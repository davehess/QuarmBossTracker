// test/chat-clock-skew.test.js — clock skew from a line everybody saw.
//
// A /gu line is broadcast to every client at once, so two clients' stamps for
// the SAME line differ by exactly their clock skew — with no network in the
// path and, crucially, without our server's clock being involved. That last
// part is what makes it independent of `pulse`, which measures client-vs-bot: a
// self-hosted tenant with a wrong clock on the bot would have pulse quietly
// correcting the whole fleet toward that wrong clock, and only this estimator
// would object.
//
// We were already generating the measurement and binning it — 1,019 guild/raid
// lines in 12 hours, 3 of which kept a second uploader's copy.
//
// Sign convention, tested explicitly because a flip corrupts every downstream
// correction: offset_ms POSITIVE = that client is BEHIND, so ts + offset_ms
// moves its stamps forward onto true time.
//
// Run: npx vitest run test/chat-clock-skew.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { addSample, resolveOffsets, median, MAX_PLAUSIBLE_SKEW_MS } =
  require(path.join(ROOT, 'utils', 'chatClockSkew.js'));

// Build a store from a fleet whose true skews we know. Every "line" is seen by
// everyone, stamped at its own clock. EQ logs whole seconds, so stamps are
// quantised to 1000ms exactly as in the field.
function fleetStore(skews, lines = 8) {
  const store = new Map();
  const ids = Object.keys(skews);
  for (let l = 0; l < lines; l++) {
    const trueMs = 1_700_000_000_000 + l * 37_000;
    const stamp = id => Math.round((trueMs - skews[id]) / 1000) * 1000;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addSample(store, ids[i], ids[j], stamp(ids[i]), stamp(ids[j]));
      }
    }
  }
  return store;
}
const byId = rows => Object.fromEntries(rows.map(r => [r.discord_id, r.offset_ms]));

describe('finding the one bad clock', () => {
  it('names the skewed install and leaves the rest at zero', () => {
    // Fargan's machine, the real case: ~56s behind while everyone else is fine.
    const out = byId(resolveOffsets(fleetStore({ fargan: 56_000, a: 0, b: 0, c: 0, d: 0 })));
    expect(out.fargan).toBeGreaterThan(54_000);
    expect(out.fargan).toBeLessThan(58_000);
    for (const id of ['a', 'b', 'c', 'd']) expect(Math.abs(out[id])).toBeLessThanOrEqual(1000);
  });

  it('gets the SIGN right — behind is positive', () => {
    // ts + offset_ms must move a behind clock FORWARD. A flipped sign here
    // would double the error on every corrected row instead of removing it.
    const behind = byId(resolveOffsets(fleetStore({ slow: 30_000, a: 0, b: 0, c: 0 })));
    expect(behind.slow).toBeGreaterThan(0);
    const ahead = byId(resolveOffsets(fleetStore({ fast: -30_000, a: 0, b: 0, c: 0 })));
    expect(ahead.fast).toBeLessThan(0);
  });

  it('handles several bad clocks at once', () => {
    // The three real ones, together: +56s, +22s, +7s against a healthy fleet.
    const out = byId(resolveOffsets(fleetStore({
      fargan: 56_000, bard: 22_000, stupid: 7_000, a: 0, b: 0, c: 0, d: 0, e: 0,
    })));
    expect(out.fargan).toBeGreaterThan(54_000);
    expect(out.bard).toBeGreaterThan(20_000);
    expect(out.bard).toBeLessThan(24_000);
    expect(out.stupid).toBeGreaterThan(5_000);
    expect(out.stupid).toBeLessThan(9_000);
  });

  it('is not dragged by the skewed members it is measuring', () => {
    // The trap the consensus estimator already had to solve: a single-pass mean
    // includes the bad clocks and pulls the baseline toward them. Two installs
    // out of five are badly wrong here; the healthy three must still read ~0.
    const out = byId(resolveOffsets(fleetStore({ bad1: 60_000, bad2: 45_000, a: 0, b: 0, c: 0 })));
    for (const id of ['a', 'b', 'c']) expect(Math.abs(out[id])).toBeLessThanOrEqual(1000);
  });

  it('survives one nonsense line without moving the answer', () => {
    const store = fleetStore({ slow: 20_000, a: 0, b: 0, c: 0 });
    // A re-typed line, or two different lines colliding on the dedup key.
    addSample(store, 'a', 'b', 1_700_000_000_000, 1_700_000_009_000);
    const out = byId(resolveOffsets(store));
    expect(out.slow).toBeGreaterThan(18_000);
    expect(Math.abs(out.a)).toBeLessThanOrEqual(1000);
  });
});

describe('refusing to guess', () => {
  it('says nothing about a pair seen only once or twice', () => {
    const store = new Map();
    addSample(store, 'a', 'b', 1000, 5000);
    addSample(store, 'a', 'b', 2000, 6000);
    expect(resolveOffsets(store)).toEqual([]);
  });

  it('says nothing when an install has only ONE partner', () => {
    // Two installs disagreeing tells you they disagree, not which is wrong.
    const store = new Map();
    for (let i = 0; i < 10; i++) addSample(store, 'a', 'b', 1000 * i, 1000 * i + 9000);
    expect(resolveOffsets(store)).toEqual([]);
  });

  it('drops a backfill instead of reading it as a clock', () => {
    // `--since` replays week-old lines with their ORIGINAL timestamps, so the
    // uploader looks hours behind for the length of the run. That is the long
    // right tail that makes any mean useless (see DESIGN-clock-correction §1).
    const store = new Map();
    expect(addSample(store, 'a', 'b', 0, MAX_PLAUSIBLE_SKEW_MS + 1)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('ignores an install talking to itself', () => {
    const store = new Map();
    expect(addSample(store, 'a', 'a', 1000, 9000)).toBe(false);
  });

  it('ignores unusable stamps', () => {
    const store = new Map();
    for (const [x, y] of [[NaN, 1000], [1000, NaN], [null, 1000], [undefined, undefined]]) {
      expect(addSample(store, 'a', 'b', x, y)).toBe(false);
    }
    expect(store.size).toBe(0);
  });

  it('returns nothing at all for an empty store', () => {
    expect(resolveOffsets(new Map())).toEqual([]);
    expect(resolveOffsets(null)).toEqual([]);
  });
});

describe('the bookkeeping', () => {
  it('puts (a,b) and (b,a) in the same bucket with a consistent sign', () => {
    const store = new Map();
    addSample(store, 'a', 'b', 0, 5000);     // b reads 5s later than a
    addSample(store, 'b', 'a', 5000, 0);     // same fact, stated backwards
    expect(store.size).toBe(1);
    const [deltas] = [...store.values()];
    expect(deltas).toEqual([5000, 5000]);
  });

  it('keeps only the most recent samples, so a drifting clock reads as it is NOW', () => {
    // These clocks drift 1.5-3s/day and a one-time sync does not hold, so an
    // average over the whole night describes a machine that no longer exists.
    const store = new Map();
    for (let i = 0; i < 200; i++) addSample(store, 'a', 'b', 0, i * 1000, 64);
    const [deltas] = [...store.values()];
    expect(deltas).toHaveLength(64);
    expect(deltas[deltas.length - 1]).toBe(199_000);
  });

  it('reports partners and samples so the row can be judged', () => {
    const rows = resolveOffsets(fleetStore({ slow: 20_000, a: 0, b: 0, c: 0 }, 6));
    const slow = rows.find(r => r.discord_id === 'slow');
    expect(slow.partners).toBe(3);
    expect(slow.samples).toBeGreaterThanOrEqual(18);
    expect(slow.spread_ms).toBeGreaterThanOrEqual(0);
  });

  it('sorts worst-first so a report leads with the machine that needs fixing', () => {
    const rows = resolveOffsets(fleetStore({ worst: 60_000, mid: 20_000, a: 0, b: 0, c: 0 }));
    expect(rows[0].discord_id).toBe('worst');
  });

  it('median is the plain one, including even-length', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);   // (2+3)/2 = 2.5, Math.round takes it up
    expect(median([])).toBe(0);
  });
});

describe('one-second resolution is a real limit', () => {
  it('cannot see a sub-second difference, and does not pretend to', () => {
    // EQ stamps whole seconds. A 200ms skew quantises away entirely. This is
    // fine — we only act past 5s — but nothing sub-second may be built on it.
    const out = byId(resolveOffsets(fleetStore({ tiny: 200, a: 0, b: 0, c: 0 })));
    expect(Math.abs(out.tiny)).toBeLessThanOrEqual(1000);
  });
});

describe('the capture point in the bot', () => {
  const src = require('node:fs').readFileSync(path.join(ROOT, 'index.js'), 'utf8');

  it('samples at the dedup gate — the line that used to just `continue`', () => {
    expect(src).toMatch(/_chatSkew\.addSample\(_chatSkewPairs, _dupOf\.by, identity\.discord_id/);
  });

  it('still drops the duplicate — this must not become a second chat post', () => {
    const gate = src.slice(src.indexOf('const _dupOf = _chatDedup.get(key);'));
    expect(gate.slice(0, 900)).toMatch(/continue;/);
  });

  it('keeps the uploader and their claimed stamp on the dedup entry', () => {
    expect(src).toMatch(/_chatDedup\.set\(key, \{ at: Date\.now\(\), ts: msgTsSafe, by: identity\.discord_id \}\)/);
  });

  it('GCs on OUR receive time, not the uploader\'s stamp', () => {
    // A 56s-behind machine's claimed ts must not decide when the entry expires,
    // or the worst clocks would age out of the window first.
    expect(src).toMatch(/\(v\?\.at \?\? 0\) < now - CHAT_DEDUP_WINDOW_MS/);
  });

  it('a measurement can never cost us a chat line', () => {
    const gate = src.slice(src.indexOf('const _dupOf = _chatDedup.get(key);'), src.indexOf('_chatDedup.set(key,'));
    expect(gate).toMatch(/try \{/);
    expect(gate).toMatch(/catch/);
  });

  it('publishes as its own method, not on top of pulse', () => {
    expect(src).toMatch(/method:\s+'chat'/);
  });

  it('is NOT yet wired into corrections', () => {
    // DESIGN-clock-correction.md §2.3: consumers migrate one at a time. A new
    // estimator earns that by agreeing with the other two first.
    const clockOffset = require('node:fs').readFileSync(path.join(ROOT, 'utils', 'clockOffset.js'), 'utf8');
    expect(clockOffset).not.toMatch(/'chat'/);
  });
});
