// test/leaderboard-guards.test.js — what the single-encounter board will and
// will not rank (Hitya, 2026-09-04: "Leaderboards should only count bosses,
// not trash. Many of parses are severely inflated from the time offset issues
// we had where people were being double or triple counted").
//
// Three guards, each pinned to the thing it exists for:
//   · curated bosses only — trash and farm mobs never rank;
//   · fights over 45 minutes out — a parser that never split a fight reported
//     67-, 105- and 127-minute "encounters" and they sat at #3, #5 and #6;
//   · encounters before the max→median merge cutover hidden unless asked —
//     the doubling was the old max-per-player merge, and every pre-cutover
//     multi-uploader encounter has pruned raw parses, so it cannot be re-merged.
// The cutover constant is checked against the migration that made the switch,
// so the two cannot drift apart silently.
//
// Run: npx vitest run test/leaderboard-guards.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';

const page = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'leaderboards', 'page.tsx'), 'utf8'));

describe('the single-encounter board', () => {
  it('ranks curated bosses only, filtered in the query', () => {
    expect(page).toMatch(/const curated = await curatedNpcIds\(sb\);/);
    expect(page).toMatch(/\.in\('encounters\.npc_id', curated\)/);
  });

  it('drops fights that never split, keeps rows with no duration at all', () => {
    expect(page).toMatch(/const MAX_SINGLE_FIGHT_SEC = 45 \* 60;/);
    expect(page).toMatch(/\.or\(`duration_sec\.is\.null,duration_sec\.lte\.\$\{MAX_SINGLE_FIGHT_SEC\}`\)/);
  });

  it('hides pre-median-merge encounters unless ?legacy=1, and says so either way', () => {
    expect(page).toMatch(/const floor = legacy \? since : \(since && since > MEDIAN_MERGE_CUTOVER \? since : MEDIAN_MERGE_CUTOVER\);/);
    expect(page).toMatch(/const legacy = legacyParam === '1';/);
    expect(page).toMatch(/legacy=1/);
    expect(page).toMatch(/Show them anyway/);
    expect(page).toMatch(/Hide them/);
  });

  it('the cutover is the day the merge became the median', () => {
    const m = page.match(/const MEDIAN_MERGE_CUTOVER = '(\d{4})-(\d{2})-(\d{2})T00:00:00Z';/);
    expect(m).toBeTruthy();
    const stamp = `${m[1]}${m[2]}${m[3]}`;
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'));
    const merge = migrations.find(f => f.startsWith(stamp) && /merge_encounter_players/.test(f));
    expect(merge).toBeTruthy();
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', merge), 'utf8'));
    // The body computes a median, not a max.
    expect(sql).toMatch(/percentile_cont\(0\.5\)|median/i);
  });

  it('does not export page-invalid symbols (Next rejects unknown page exports)', () => {
    expect(page).not.toMatch(/export const (MEDIAN_MERGE_CUTOVER|MAX_SINGLE_FIGHT_SEC)/);
  });
});
