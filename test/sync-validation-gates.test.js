// test/sync-validation-gates.test.js — the catalog sync must fail loudly.
//
// A sync that imports NOTHING looks exactly like a sync with nothing to do:
// both print little and exit 0. We have shipped that bug twice —
//   • six tables no migration created, so the repo could not rebuild its schema;
//   • npc_spells/npc_spells_entries parsed and transformed correctly but left
//     out of the upsert ORDER list, so they never reached Supabase at all.
// Neither was caught by CI, a healthcheck, or a human, because silence is what
// success looks like too.
//
// pq-companion's data-release job runs row-count and FK checks that fail the
// build (docs/pq-companion/06-data-provenance-and-gaps.md §6). These tests pin
// our version of that: the floors exist, they cover the tables whose silent
// emptiness would actually hurt, a MISSING table counts as failure rather than
// an exemption, and a failure exits non-zero.
//
// Run: npx vitest run test/sync-validation-gates.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-from-eqmac.js'), 'utf8');

// Pull the MIN_ROWS literal out of the real source so the test tracks shipped
// values rather than a copy that can drift.
function minRows() {
  const start = src.indexOf('const MIN_ROWS = {');
  expect(start, 'MIN_ROWS not found — did the validation gate get removed?').toBeGreaterThan(-1);
  const end = src.indexOf('};', start);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end + 2)}\nreturn MIN_ROWS;`)();
}

describe('row-count floors', () => {
  const MIN = minRows();

  it('covers the tables whose silent emptiness has actually bitten us', () => {
    // npc_spells + npc_spells_entries are the verbatim regression: correct
    // whitelist, correct transform, absent from ORDER, zero rows, no error.
    for (const t of ['eqemu_npc_spells', 'eqemu_npc_spells_entries']) {
      expect(MIN[t], `${t} must have a floor`).toBeGreaterThan(0);
    }
  });

  it('covers the spine every feature reads', () => {
    for (const t of ['eqemu_zone', 'eqemu_items', 'eqemu_npc_types', 'eqemu_spells',
                     'eqemu_spawn2', 'eqemu_spawnentry', 'eqemu_loottable_entries']) {
      expect(MIN[t], `${t} must have a floor`).toBeGreaterThan(0);
    }
  });

  it('sets floors BELOW the counts we have actually observed', () => {
    // Floors guard against collapse, not growth. Set one above the live value
    // and every future sync fails on healthy data — worse than no gate, because
    // a red build that is always red gets ignored.
    const observed = {
      eqemu_zone: 192, eqemu_items: 26971, eqemu_npc_types: 18033,
      eqemu_spells: 3933, eqemu_spawn2: 43654, eqemu_spawnentry: 26258,
      eqemu_spawngroup: 14357, eqemu_loottable: 7276, eqemu_lootdrop: 11124,
      eqemu_loottable_entries: 20803, eqemu_lootdrop_entries: 44587,
      eqemu_npc_spells: 1349, eqemu_npc_spells_entries: 4231,
      eqemu_merchantlist: 25875, eqemu_tradeskill_recipe: 7448,
      eqemu_tradeskill_recipe_entries: 54229, eqemu_npc_emotes: 4144,
      eqemu_zone_points: 1360, eqemu_doors: 8205,
    };
    for (const [t, floor] of Object.entries(MIN)) {
      expect(observed[t], `no observed count recorded for ${t}`).toBeDefined();
      expect(floor, `${t} floor ${floor} exceeds observed ${observed[t]}`)
        .toBeLessThanOrEqual(observed[t]);
    }
  });

  it('leaves real headroom — a floor at 99% of live is a tripwire, not a gate', () => {
    const observed = { eqemu_zone: 192, eqemu_items: 26971, eqemu_npc_types: 18033 };
    for (const [t, live] of Object.entries(observed)) {
      expect(MIN[t] / live, `${t} floor is too close to the live count`).toBeLessThan(0.95);
    }
  });
});

describe('gate behaviour', () => {
  it('treats a table that was never synced as a FAILURE, not a skip', () => {
    // The whole point. `counts[table]` is absent when a table never reached the
    // upsert loop, and an early `continue` there would reproduce the original
    // bug exactly.
    expect(src).toMatch(/if \(!\(got > 0\)\) \{ problems\.push\(`\$\{table\}: NOT SYNCED/);
  });

  it('exits non-zero so CI actually goes red', () => {
    const gate = src.slice(src.indexOf('if (problems.length) {'));
    expect(gate).toMatch(/process\.exit\(1\)/);
    expect(gate).toMatch(/VALIDATION FAILED/);
  });

  it('verifies what SUPABASE holds, not just the local buffers', () => {
    // Buffers agreeing with themselves proves nothing about what was stored;
    // the spot-checks must hit the REST API.
    expect(src).toMatch(/const countWhere = async/);
    expect(src).toMatch(/Prefer: 'count=exact'/);
  });

  it('runs the gates BEFORE recording sync_state as a good run', () => {
    // Otherwise a failed import still writes "last good sync" and the next run
    // skips it as unchanged.
    // ⚠ Anchored to the actual write, not the "Record sync_meta" comment above
    // it (2026-08-30 sweep): the write could move above validation while the
    // comment stayed put, and this ordering check would not notice.
    const write = src.indexOf("await sb('/sync_meta'");
    expect(write).toBeGreaterThan(-1);
    expect(src.indexOf('VALIDATION FAILED')).toBeLessThan(write);
  });
});
