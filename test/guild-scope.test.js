// test/guild-scope.test.js — the guild-scope ratchet (docs/DESIGN-raidmimic-hosted.md section 3 step 4).
//
// The bot and the web server use the service role, which bypasses RLS, so a query on a guild table with no
// guild filter reads/writes EVERY guild's rows. scripts/guild-scope-audit.js finds those calls; this test:
//   1. fails on an unscoped call that is not in scripts/guild-scope-baseline.json  (NEW debt — scope it);
//   2. fails on a baseline entry that no longer exists  (the call was fixed or removed — shrink the baseline).
// Today's debt is the baseline; the fix for (1) is to add the guild filter, NOT to regenerate the baseline.
// Entries are keyed by file + table + a hash of the call text, never a line number, so edits elsewhere in a
// file do not disturb them.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../scripts/guild-scope-audit.js');

const REGEN = 'node scripts/guild-scope-audit.js --write-baseline';
const found = audit.auditRepo();
const baseline = JSON.parse(fs.readFileSync(audit.BASELINE_PATH, 'utf8'));
const baselineKeys = new Set(baseline.entries.map((e) => e.key));
const foundKeys = new Set(found.map((f) => f.key));

describe('guild-scope ratchet', () => {
  it('has no NEW unscoped query on a guild table', () => {
    const added = found.filter((f) => !baselineKeys.has(f.key));
    expect(
      added.map((f) => `${f.file}:${f.line}  ${f.table}  (${f.form})`),
      'Unscoped query on a guild table. Add the guild filter (guild_id=eq.${encodeURIComponent(supabase.guildId())} / .eq(\'guild_id\', GUILD_TAG) / guild_id in the row). ' +
        `If you only edited an existing baseline call, scope it instead of regenerating. Report: node scripts/guild-scope-audit.js`,
    ).toEqual([]);
  });

  it('has no stale baseline entry (a fixed call must leave the baseline)', () => {
    const stale = baseline.entries.filter((e) => !foundKeys.has(e.key));
    expect(
      stale.map((e) => `${e.file}  ${e.table}  ${e.fingerprint}`),
      `These baseline calls are gone or now scoped. Shrink the baseline: ${REGEN}`,
    ).toEqual([]);
  });

  it('keeps the baseline header count honest', () => {
    expect(baseline.count).toBe(baseline.entries.length);
  });

  it('reads a non-empty guild-table snapshot', () => {
    expect(audit.loadGuildTables().size).toBeGreaterThan(60);
  });
});
