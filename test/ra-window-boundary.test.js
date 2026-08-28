// test/ra-window-boundary.test.js — RA% can never exceed 100%.
//
// Reported 2026-08-28: SuperBloodWolf showed 175% at 30/60/90d while lifetime
// read 100%. att_ticks_90d = 7, ticks_90d = 4.
//
// The numerator and denominator were written to different boundary rules:
//
//   numerator    ts >  now() - '90 days'                              no clamp
//   denominator  ts >  GREATEST(now() - '90 days', first_attended)    STRICT >
//   lifetime     ts >= first_attended                                 >=
//
// Raid timestamps are date-only (noon UTC), so every tick in a raid shares one
// ts and, for a new member, `first_attended` IS that timestamp. The strict `>`
// dropped their entire first raid from the denominator while the numerator kept
// it: 7 / (7 - 3) = 175%. Lifetime used `>=`, which is why that one column was
// right — and why the disagreement was invisible until someone joined recently
// enough for the clamp to bind.
//
// This view feeds the #80 review cards and the attendance page, so a wrong RA%
// drives real decisions about people.
//
// Run: npx vitest run test/ra-window-boundary.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');

// The newest migration that (re)defines the view is the one in force.
function currentViewSql() {
  const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
  let sql = null;
  for (const f of files) {
    const body = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    if (/create\s+(or\s+replace\s+)?view\s+(public\.)?member_attendance_metrics/i.test(body)) sql = body;
  }
  // ⚠ Strip `--` comments before asserting. The migration DOCUMENTS the broken
  // form (`ts >  GREATEST(...)`) in its header so the next reader understands
  // what was wrong — and the first version of the assertion below matched that
  // explanation instead of the code, failing against a correct file. Same trap
  // caught twice in one night; strip first, assert second.
  return sql === null ? null
    : sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
}

describe('member_attendance_metrics window boundaries', () => {
  const sql = currentViewSql();

  it('has a migration defining the view', () => {
    expect(sql, 'no migration defines member_attendance_metrics').toBeTruthy();
  });

  it('NEVER clamps the denominator with a strict >', () => {
    // This is the whole bug in one assertion. `ts > GREATEST(window,
    // first_attended)` excludes the member's first raid from the denominator
    // while the numerator counts it, which is how a percentage exceeds 100.
    const strict = [...sql.matchAll(/ts\s*>\s*GREATEST/gi)];
    expect(strict.map(m => m[0]), 'denominator clamps must use >=, not >').toEqual([]);
  });

  it('clamps every window denominator to first_attended with >=', () => {
    // All six: ticks 30/60/90 and raids 30/60/90.
    const clamped = [...sql.matchAll(/ts\s*>=\s*GREATEST\(now\(\) - '(30|60|90) days'::interval, a_1\.first_attended\)/gi)];
    expect(clamped).toHaveLength(6);
  });

  it('keeps lifetime on the same rule it always used', () => {
    const lifetime = [...sql.matchAll(/ts\s*>=\s*a_1\.first_attended\)/gi)];
    expect(lifetime).toHaveLength(2);   // ticks_lifetime + raids_lifetime
  });
});
