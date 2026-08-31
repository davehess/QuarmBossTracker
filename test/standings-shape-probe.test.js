// test/standings-shape-probe.test.js — the one-shot /dkp shape probe.
//
// Hitya, 2026-08-31: the DKP pill showed 192 where OpenDKP says 143. OpenDKP's
// docs say /clients/{client}/dkp returns "current DKP ... and calculated values
// for different time periods (30, 60, 90 days, and lifetime)" — so the right
// number is already in the response we fetch, and _pickAccountDkpFromModels is
// reading the wrong key. Its ladder guesses five spellings and falls through to
// `Dkp`, which on a row carrying period totals need not be the balance.
//
// The lesson this repeats is written down: /auctions/active was adopted "on the
// strength of OpenDKP's Postman doc ... without ever seeing a response", and
// then returned [] for weeks. So the fix is to LOG the real keys once, not to
// guess a sixth spelling.
//
// Run: npx vitest run test/standings-shape-probe.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'let _loggedStandingsShape = false;', '  } catch { /* a probe must never break the caller */ }\n}');

function build() {
  const lines = [];
  const api = evalBlock(
    `var __lines = [];\nvar console = { log: (s) => __lines.push(String(s)) };\n`
    + block + `\nfunction lines(){ return __lines; }`,
    ['_logStandingsShapeOnce', 'lines'],
  );
  return { probe: api._logStandingsShapeOnce, lines: api.lines };
}

const ROW = { CharacterName: 'Hitya', CurrentDkp: 143, Dkp30: 60, DkpLifetime: 192, AttendedTicks: 400 };

describe('the standings shape probe', () => {
  it('prints the row KEY NAMES, which is the thing we are missing', () => {
    const h = build();
    h.probe([ROW]);
    const out = h.lines().join('\n');
    expect(out).toContain('row keys=[');
    expect(out).toContain('CurrentDkp');
    expect(out).toContain('DkpLifetime');
  });

  it('prints one sample row so the mapping is obvious', () => {
    const h = build();
    h.probe([ROW]);
    expect(h.lines().join('\n')).toContain('143');
  });

  // ⚠ A probe that fires every refresh becomes log spam on a 60s cache.
  it('fires ONCE per process, however often it is called', () => {
    const h = build();
    for (let i = 0; i < 25; i++) h.probe([ROW]);
    expect(h.lines().filter(l => l.includes('row keys=[')).length).toBe(1);
  });

  // ⚠ It is a shape probe, not a roster dump — every member's balance is in
  // that array and none of it belongs in a log line.
  it('samples exactly one row, never the whole guild', () => {
    const h = build();
    h.probe([ROW, { CharacterName: 'SomeoneElse', CurrentDkp: 999 }]);
    const out = h.lines().join('\n');
    expect(out).not.toContain('SomeoneElse');
    expect(out).not.toContain('999');
  });

  it('accepts both the bare array and the { Models: [...] } wrapper', () => {
    const a = build(); a.probe([ROW]);
    const b = build(); b.probe({ Models: [ROW] });
    expect(a.lines().join('')).toContain('CurrentDkp');
    expect(b.lines().join('')).toContain('CurrentDkp');
  });

  it('stays quiet on an empty or unusable payload, and does not latch', () => {
    const h = build();
    h.probe([]); h.probe(null); h.probe(undefined);
    expect(h.lines()).toHaveLength(0);
    h.probe([ROW]);                       // the first REAL payload still prints
    expect(h.lines().join('')).toContain('row keys=[');
  });

  it('never throws — a diagnostic must not break the caller', () => {
    const h = build();
    const nasty = { get Models() { throw new Error('boom'); } };
    expect(() => h.probe(nasty)).not.toThrow();
  });
});

describe('wiring', () => {
  const clean = stripJs(src);
  it('runs on a successful standings fetch', () => {
    const fn = sliceBlock(clean, 'async function _panelStandings(', '\n}\n');
    expect(fn).toContain('_logStandingsShapeOnce(models)');
  });
  it('costs no extra upstream call — it only reads what was fetched', () => {
    const probe = sliceBlock(clean, 'function _logStandingsShapeOnce(models) {', '\n}\n');
    expect(probe).not.toContain('await');
    expect(probe).not.toContain('getStandings');
  });
});
