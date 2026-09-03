// test/faction-page-points-and-hits.test.js — the faction page shows points AND
// hits, and never lets one stand in for the other.
//
// Hitya, 2026-09-03: "this is still inaccurate. We should have how many
// positive and negative hits total in parentheses for raised and lowered, and
// the raised/lowered should specifically call out how much the faction has been
// raised or lowered."
//
// The cell had shown +586 (hits) and then, an hour later, +228 (points) for the
// same faction — because it rendered better_total when non-zero and
// better_count otherwise, both as "+N". Bot 3.1.118 started pricing hits and
// the cell changed UNIT with no change in shape.
//
// ⚠ A partial total is a FLOOR and must say so. Points are known only for hits
// the agent could attribute to a kill; the rest each moved the faction by at
// least 1. "+228 (586)" reads as 586 hits totalling 228 points, which is the
// wrong number for repair arithmetic — exactly what this page is for.
//
// The cell logic is inline TSX, so these are stripped-source assertions on the
// three branches. Comments stripped first: this file's own prose would satisfy
// a naive toContain.
//
// Run: npx vitest run test/faction-page-points-and-hits.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const page  = fs.readFileSync(path.join(ROOT, 'web', 'app', 'character', '[name]', 'factions', 'page.tsx'), 'utf8');
const clean = stripJs(page);
const cell  = clean.slice(clean.indexOf('const side = ('), clean.indexOf('const betterHead = side('));

describe('the three states of a Raised / Lowered cell', () => {
  it('fully priced: points, then hits in parentheses', () => {
    expect(cell).toMatch(/val: `\$\{sign\}\$\{pts\} \(\$\{n\.toLocaleString\(\)\}\)`/);
  });

  it('partially priced: marked as a floor, never presented as the sum', () => {
    expect(cell).toMatch(/if \(priced < n\) return \{/);
    expect(cell).toMatch(/val: `≥ \$\{sign\}\$\{pts\} \(\$\{n\.toLocaleString\(\)\}\)`/);
    expect(cell).toMatch(/the true total is higher/);
  });

  it('unpriced: a question mark, never an invented number', () => {
    // Keyed off TOTAL, not priced: rows priced by bot 3.1.118 (before the
    // counter existed) carry points with priced = 0 and must not show "?".
    expect(cell).toMatch(/if \(tot === 0\) return \{/);
    expect(cell).not.toMatch(/if \(priced === 0\) return \{/);
    expect(cell).toMatch(/val: `\? \(\$\{n\.toLocaleString\(\)\}\)`/);
  });

  it('never falls back to showing the hit count AS the points', () => {
    // The exact regression: a hit count formatted with a sign.
    expect(cell).not.toMatch(/val: `\+\$\{f\.better_count\}`/);
    expect(cell).not.toMatch(/val: `−\$\{f\.worse_count\}`/);
  });

  it('reads the priced counters it depends on', () => {
    expect(clean).toMatch(/better_priced, worse_priced, capped_max_at/);   // in the select
    expect(clean).toMatch(/bP = f\.better_priced \?\? 0/);
    expect(clean).toMatch(/wP = f\.worse_priced\s+\?\? 0/);
  });
});

describe('the bot supplies those counters', () => {
  const bot = stripJs(fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
  it('counts a hit as priced only when a magnitude was resolved', () => {
    expect(bot).toMatch(/if \(dir > 0\) \{ a\.better_total \+= mag; a\.better_priced\+\+; \}/);
    expect(bot).toMatch(/else\s+\{ a\.worse_total\s+\+= mag; a\.worse_priced\+\+;\s+\}/);
  });
  it('initialises them on the rollup row', () => {
    expect(bot).toMatch(/better_priced: 0, worse_priced: 0,/);
  });
});
