// "Following Discord now" on /pvp (the guild lead, 2026-09-27: "start looking for the messages when
// people #togglepvp in game and follow the way of discord vs order"). The toggle lines have been
// parsed since 2025-02 (fun_events pvp_flag_on / pvp_flag_off); the view is the latest per character.
//
// Run: npx vitest run test/pvp-flag-state.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260927040100_pvp_flag_state.sql'), 'utf8');
const page = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'pvp', 'page.tsx'), 'utf8'));

describe('the view', () => {
  it('is the latest toggle per character, Discord = on, with the caller\'s own rights', () => {
    expect(migration).toMatch(/create or replace view public\.pvp_flag_state\s+with \(security_invoker = true\)/);
    expect(migration).toMatch(/distinct on \(e\.guild_id, lower\(e\.caster\)\)/);
    expect(migration).toMatch(/\(e\.event_type = 'pvp_flag_on'\) as discord/);
    expect(migration).toMatch(/order by e\.guild_id, lower\(e\.caster\), e\.event_ts desc/);
  });
});

describe('the page', () => {
  it('reads only the flagged, newest first, and draws the panel only when someone is', () => {
    expect(page).toMatch(/\.from\('pvp_flag_state'\)[\s\S]*\.eq\('discord', true\)[\s\S]*\.order\('since', \{ ascending: false \}\)[\s\S]*\.limit\(200\)/);
    expect(page).toMatch(/\{flagged\.length > 0 && \(/);
    expect(page).toMatch(/Following Discord now/);
    expect(page).toMatch(/Order is the peaceful side/);
  });
  it('a failed read is an empty list, not a crash', () => {
    expect(page).toMatch(/if \(error\) \{ console\.warn\('\[pvp\] pvp_flag_state failed:', error\.message\); return \[\]; \}/);
  });
});
