// test/scrap-leaderboard-raid-fights.test.js — the Scrap counts raid fights only.
//
// The guild lead, 2026-09-13: "a member's 26.8M damage on a non-raid swarm shouldn't
// be in here for the leaderboards." 25.96M of it was one-to-two-player
// Shik`nar farming. The RPC behind /me's Top Dog card now admits a fight only
// when at least seven damage-dealers were credited on it, and drops
// officer-classified encounters the way /leaderboards already does.
//
// Text assertions on the migration with comments STRIPPED — the header above
// quotes exactly the phrases a comment could otherwise satisfy.
//
// Run: npx vitest run test/scrap-leaderboard-raid-fights.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const sql = stripSql(fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260914030500_scrap_leaderboard_raid_fights.sql'), 'utf8'));

describe('scrap_damage_leaderboard counts raid fights only', () => {
  it('keeps the signature /me calls', () => {
    expect(sql).toMatch(/create or replace function public\.scrap_damage_leaderboard\(p_since timestamptz\)/);
    expect(sql).toMatch(/returns table\(character_name text, total_damage bigint, best_dps int, encounters bigint\)/);
  });

  it('admits a fight only when seven or more damage-dealers were credited on it', () => {
    expect(sql).toMatch(/with raid_sized as \(\s*select ep\.encounter_id[\s\S]*group by ep\.encounter_id\s*having count\(\*\) >= 7\s*\)/);
    expect(sql).toMatch(/join raid_sized r on r\.encounter_id = ep\.encounter_id/);
  });

  it('drops officer-classified encounters, as /leaderboards does', () => {
    expect(sql).toMatch(/and e\.classification is null/);
  });

  it('still honours exclude_from_stats and the 30-day window', () => {
    expect(sql).toMatch(/c\.exclude_from_stats/);
    expect(sql).toMatch(/where e\.started_at >= p_since\s+and e\.classification is null/);
  });
});
