// /raids?count=N — a documented parameter we were not using.
//
// Hitya, 2026-08-26: "is there an alternative in the APIs to what we're doing
// with that call?" For audits: no — the only documented parameter is `page`,
// so the last-page approach stands. For RAIDS: yes. OpenDKP's own Postman
// collection documents `/clients/{client}/raids?count=10`, and we were pulling
// all 412 raids every 30 minutes at ~90 KB a call to re-learn rows that had
// not moved.
//
// The safety argument for only fetching the newest N: a raid summary is
// append-only in practice. Where that is wrong — someone EDITS an older raid —
// two nets catch it: the periodic uncounted fetch here, and the #110 audit
// reconcile. So this trades a bounded staleness window for a ~93% cut, rather
// than trading away correctness.
import { describe, it, expect } from 'vitest';
import { readSource, ROOT } from './_source-slice.js';
import path from 'node:path';

const client = readSource(path.join(ROOT, 'utils', 'opendkp.js'));
const sync   = readSource(path.join(ROOT, 'utils', 'openDkpSync.js'));
const getRaids = client.slice(client.indexOf('async function getRaids'),
                              client.indexOf('async function getRaid('));

describe('the client', () => {
  it('sends ?count=N when asked', () => {
    expect(getRaids).toMatch(/\?count=\$\{n\}/);
  });

  it('omits the param entirely for a full fetch', () => {
    // An empty or zero count must not become `?count=0`, which would ask for
    // nothing rather than everything.
    expect(getRaids).toMatch(/Number\.isInteger\(n\) && n > 0 \? .*: ''/);
  });
});

// The mode decision is pure, so it is exercised as BEHAVIOUR. The first draft
// of these tests grepped the source for `_raidsFullEveryHours` and stayed green
// under a mutation that forced useCount=true and deleted the heal — caught by
// mutation-checking the tests themselves.
const modeBlock = sync.slice(sync.indexOf('function _raidsFetchMode'),
                             sync.indexOf('async function syncRaidsList'));
const _raidsFetchMode = new Function('return ' + modeBlock.trim())();
const HOUR = 3600 * 1000;

describe('the fetch-mode decision', () => {
  it('does NOT use the count — the ordering was never proved', () => {
    // 3.1.83 added ?count=25 assuming it returns the NEWEST 25 raids. Disabled
    // 2026-08-27 mid-raid: the mirror's newest raid sat at #101101 all through
    // the 8-27 raid while #101157 existed upstream, and only the uncounted
    // daily full fetch ever advanced it. Same class of mistake as assuming
    // /auctions pages newest-first, which a production probe disproved.
    //
    // This asserts the CURRENT, deliberate state. When someone proves the
    // ordering against production, flip it back and this test with it.
    const m = _raidsFetchMode(Date.now(), Date.now(), 25, 24);
    expect(m.useCount).toBe(false);
  });

  it('takes the FULL list once the interval has elapsed', () => {
    // The heal. Without it an upstream EDIT to an older raid hides forever.
    const r = _raidsFetchMode(100 * HOUR, 100 * HOUR - 25 * HOUR, 25, 24);
    expect(r.useCount).toBe(false);
    expect(r.fullDue).toBe(true);
  });

  it('takes the full list on a cold process (never fetched)', () => {
    expect(_raidsFetchMode(100 * HOUR, 0, 25, 24).useCount).toBe(false);
  });

  it('falls back to the full list for a nonsense count', () => {
    for (const bad of [0, -5, 1.5, null, undefined, 'ten', NaN]) {
      expect(_raidsFetchMode(100 * HOUR, 100 * HOUR, bad, 24).useCount, String(bad)).toBe(false);
    }
  });
});

describe('the sync', () => {

  it('reports which scope it used, so the logs are not ambiguous', () => {
    // Without this, "412 fetched" and "25 fetched" look like a bug rather than
    // a mode.
    expect(sync).toMatch(/scope:\s*useCount \? `newest \$\{count\}` : 'full'/);
  });

  it('is tunable and can be turned off entirely', () => {
    expect(sync).toMatch(/OPENDKP_RAIDS_COUNT/);
    expect(sync).toMatch(/OPENDKP_RAIDS_FULL_HOURS/);
  });

  it('marks the full-fetch timestamp only on a full fetch', () => {
    // Stamping it on a counted pass would push the heal out forever.
    expect(sync).toMatch(/if \(!useCount\) _lastRaidsFullAt = Date\.now\(\);/);
  });
});

describe('audits has no such alternative — checked, not assumed', () => {
  it('keeps the last-page fast path, which is the only lever available', () => {
    // OpenDKP's doc for /audits lists exactly one parameter: page. No `since`,
    // no `count`, no sort. So "ask for less" is impossible and "ask for the
    // right page" is the whole game.
    expect(sync).toMatch(/fast_path: 'last-page'/);
  });
});

// ── Shape + fail-open (2026-08-28, mid-raid) ────────────────────────────────
// A single uncounted /raids call returned 11,469 bytes with ZERO errors and
// Array.isArray false. syncRaidsList rejected it, runSync RETURNED at
// phase 'list', and the entire mirror pass — audits, adjustments, auctions,
// loot folding, tick detail — silently stopped running. One endpoint's shape
// took everything down and the only symptom was a word in a log line.
import { readSource as _read, ROOT as _ROOT } from './_source-slice.js';
import _path from 'node:path';
const syncSrc = _read(_path.join(_ROOT, 'utils', 'openDkpSync.js'));

describe('raids list shape and blast radius', () => {
  it('accepts the wrapped shapes every sibling endpoint uses', () => {
    // /auctions and /audits both wrap their rows; assuming /raids never would
    // was the mistake.
    for (const key of ['Results', 'Raids', 'Items', 'data']) {
      expect(syncSrc, `should unwrap ${key}`).toContain(`Array.isArray(raids?.${key})`);
    }
  });

  it('logs the shape once instead of guessing at it', () => {
    expect(syncSrc).toContain('raids unexpected shape — top-level keys:');
  });

  it('a raids failure NO LONGER aborts the whole sync', () => {
    // The regression: `if (listResult.error) return { phase: 'list', ... }`.
    expect(syncSrc).toContain('raids list failed, continuing with the rest:');
    expect(syncSrc).not.toMatch(/if \(listResult\.error\) \{\s*\n\s*return \{/);
    // …and the failure is still REPORTED, not swallowed.
    expect(syncSrc).toContain('raids_error:       listResult.error || null,');
  });
});
