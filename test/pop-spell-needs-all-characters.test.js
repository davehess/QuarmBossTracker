// test/pop-spell-needs-all-characters.test.js — pop_spell_needs v4 (all
// characters, not just mains) and the who_directory perf fix it required.
//
// Hitya, 2026-08-26: "let's have a my characters mode on the pop page ...
// due to the nature of pop flagging they may do it for many of their toons
// and we shouldn't only track mains." The RPC's `mains` CTE hard-filtered to
// `main_name IS NULL OR main_name = name`; an alt with a submitted spellbook
// was invisible to it no matter what.
//
// Widening the eligible set from 28 mains to 117 (main+alt) characters
// exposed a REAL perf bug already latent in the function: the level lookup
// was a per-row correlated subquery against `who_directory`, a view with six
// DISTINCT ON / GROUP BY passes over all of who_observations (120k+ rows) and
// no materialization — Postgres can't push the character filter below those
// passes, so every row of `eligible` re-ran the ENTIRE view. Measured against
// prod: 267k buffer hits for ONE run of the view; at 117 characters that's
// ~31M buffer hits and a reproducible 60s+ timeout calling the function
// directly. Fixed by switching to `LEFT JOIN who_directory wd ON
// wd.character_key = lower(c.name)` — the view computes once, characters
// hash-join against it. Verified against prod: 1.2s end-to-end, same output.
//
// This file guards the SHIPPED migration text so neither regression can
// silently return: the main-only filter, or the correlated subquery.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260826010000_pop_spell_needs_all_characters.sql'),
  'utf8',
);

describe('pop_spell_needs no longer hides alts', () => {
  it('does not carry the old mains-only predicate', () => {
    expect(SQL).not.toMatch(/main_name IS NULL OR lower\(c\.main_name\) = lower\(c\.name\)\)\s*\n\s*AND EXISTS/);
  });

  it('exposes is_main on every row so callers choose their own default', () => {
    expect(SQL).toContain('is_main boolean');
    expect(SQL).toContain('(c.main_name IS NULL OR lower(c.main_name) = lower(c.name)) AS is_main');
    expect(SQL).toContain('m.is_main');
  });

  it('renamed the CTE off "mains" now that it is not main-only', () => {
    expect(SQL).toContain('eligible AS (');
    expect(SQL).toContain('JOIN eligible m');
    // The old name must be gone entirely, not just supplemented — a leftover
    // "mains" CTE alongside "eligible" would mean the rename was partial.
    expect(SQL).not.toMatch(/\bmains AS \(/);
  });

  it('still requires deleted/excluded characters be dropped and a spellbook exist', () => {
    expect(SQL).toContain('COALESCE(c.deleted, false) = false');
    expect(SQL).toContain('COALESCE(c.exclude_from_stats, false) = false');
    expect(SQL).toContain('EXISTS (SELECT 1 FROM character_spellbook sb');
  });
});

describe('the who_directory perf fix', () => {
  it('joins who_directory instead of a per-row correlated subquery', () => {
    expect(SQL).toContain('LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)');
  });

  it('the correlated MAX(level) subquery form is gone', () => {
    expect(SQL).not.toMatch(/SELECT max\(w\.level\) FROM who_directory w/);
    expect(SQL).not.toMatch(/FROM who_directory w\s*\n\s*WHERE lower\(w\.character\)/);
  });

  it('reads level straight off the joined row', () => {
    expect(SQL).toContain('wd.level AS lvl');
  });
});

describe('signature and grants', () => {
  it('drops and recreates the function (RETURNS TABLE shape changed)', () => {
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS pop_spell_needs\(text\);/);
    expect(SQL).toMatch(/CREATE FUNCTION pop_spell_needs\(p_guild_id text\)/);
  });

  it('grants execute to service_role, same as every other RPC here', () => {
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION pop_spell_needs(text) TO service_role;');
  });
});
