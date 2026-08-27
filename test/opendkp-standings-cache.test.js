// test/opendkp-standings-cache.test.js — the agent's OpenDKP standings cache.
//
// Moncs, OpenDKP's operator, 2026-08-27: "Do you purposefully call /dkp once a
// minute? Looking back over the past 60 minutes, it looks like theres about 54
// calls from <ip> calling it".
//
// We did, and not on purpose. The dashboard polls every 7s, the browser
// throttles to 30s, and this cache was 60s — so one running agent pulled the
// FULL standings array (472 characters) once a minute to render a single
// number. 54 calls/hour per open Mimic, scaling with the fleet.
//
// ⚠ The reason it went unnoticed for so long: this path calls api.opendkp.com
// DIRECTLY, never through the bot, so it was absent from opendkp_call_stats and
// invisible on wolfpack.quest/opendkp. A counter that only sees one of two
// callers reads as "we're clean".
//
// Run: npx vitest run test/opendkp-standings-cache.test.js

import { describe, it, expect, afterEach } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const SRC = path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js');
const src = readSource(SRC);

// Slice the shipped helpers, so the TTL under test is the one that ships.
const block = sliceBlock(
  src,
  'const _STANDINGS_TTL_DEFAULT_MS =',
  'return (nowMs - at) < ttlMs;\n}',
);
const h = new Function(`${block}\nreturn { _standingsTtlMs, _standingsCacheFresh, _STANDINGS_TTL_DEFAULT_MS };`)();

const prev = process.env.WP_OPENDKP_STANDINGS_TTL_MS;
afterEach(() => {
  if (prev === undefined) delete process.env.WP_OPENDKP_STANDINGS_TTL_MS;
  else process.env.WP_OPENDKP_STANDINGS_TTL_MS = prev;
});

describe('OpenDKP standings cache TTL', () => {
  it('defaults to ten minutes, not one', () => {
    delete process.env.WP_OPENDKP_STANDINGS_TTL_MS;
    expect(h._standingsTtlMs()).toBe(10 * 60 * 1000);
  });

  it('turns 54 upstream calls an hour into 6', () => {
    // The measurement Moncs sent, expressed as the thing that caused it: the
    // dashboard asks every 7s, and the cache decides how many of those escape.
    delete process.env.WP_OPENDKP_STANDINGS_TTL_MS;
    const perHour = ttl => Math.floor(3600_000 / ttl);
    expect(perHour(60_000)).toBe(60);                    // what he measured (~54)
    expect(perHour(h._standingsTtlMs())).toBe(6);
  });

  it('can be lengthened, but NEVER shortened below a minute', () => {
    // The knob exists to be kinder to a third party's API, not to hand someone
    // a way to hammer it harder than the bug already did.
    process.env.WP_OPENDKP_STANDINGS_TTL_MS = String(30 * 60 * 1000);
    expect(h._standingsTtlMs()).toBe(30 * 60 * 1000);
    for (const bad of ['1000', '0', '-5', 'soon', '']) {
      process.env.WP_OPENDKP_STANDINGS_TTL_MS = bad;
      expect(h._standingsTtlMs()).toBe(h._STANDINGS_TTL_DEFAULT_MS);
    }
  });

  it('serves from cache inside the window and refetches after it', () => {
    const ttl = 600_000;
    const at = 1_000_000;
    expect(h._standingsCacheFresh({ at }, at, ttl)).toBe(true);
    expect(h._standingsCacheFresh({ at }, at + ttl - 1, ttl)).toBe(true);
    expect(h._standingsCacheFresh({ at }, at + ttl, ttl)).toBe(false);
    expect(h._standingsCacheFresh({ at }, at + ttl + 1, ttl)).toBe(false);
  });

  it('treats a missing or malformed cache as stale, never as fresh', () => {
    // Reading a junk cache as fresh would silently freeze the DKP figure at
    // whatever it was — wrong numbers in a bidding panel, with no error.
    for (const bad of [null, undefined, {}, { at: 'soon' }, { at: NaN }]) {
      expect(h._standingsCacheFresh(bad, 1_000_000, 600_000)).toBe(false);
    }
    // ⚠ The cases above do NOT exercise the guard — they all coerce to NaN, and
    // every NaN comparison is false regardless. Caught by mutation: deleting the
    // isFinite check left them all green. These are the ones that discriminate,
    // because `Number(null)` / `Number('')` / `Number(false)` are 0, not NaN —
    // a zero timestamp reads as "cached at the epoch", which is fresh whenever
    // the clock is small.
    for (const coercible of [{ at: null }, { at: '' }, { at: false }, { at: [] }]) {
      expect(h._standingsCacheFresh(coercible, 1000, 600_000)).toBe(false);
    }
  });
});

describe('the dashboard poll', () => {
  it('skips the DKP refresh while the window is hidden', () => {
    // This is the one dashboard poll that costs a THIRD PARTY money, so it is
    // the one that must stop when nobody is looking.
    expect(src).toContain('document.hidden && acctDkp !== null) return Promise.resolve();');
  });

  it('still calls OpenDKP directly — so our own counter cannot see it', () => {
    // Locked down deliberately. If this ever moves behind the bot, delete this
    // test AND the "invisible to opendkp_call_stats" warnings that depend on it.
    expect(src).toContain("'/clients/' + name + '/dkp'");
    expect(src).toContain('OPENDKP_API_HOST');
  });
});
