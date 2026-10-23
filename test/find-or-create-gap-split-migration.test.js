// test/find-or-create-gap-split-migration.test.js — a new upload that starts 15+ min after the matched fight
// ended is its own fight (two wipes ~30 min apart were one parse, 2026-10-23).
//
// A text test over the migration (comments stripped: its header explains the rule and a comment must not satisfy
// an assertion). The behaviour was run against a scratch Postgres 16 with the 20260713 body as the baseline:
// before the migration wipe 2 at +25 min knitted onto wipe 1 and an earlier attempt arriving second knitted onto the
// later row; after it both are their own rows. Still ONE row: a same-fight contributor 5 s later, the real Lord of
// Ire shape of 2026-07-13 (162 s row, re-engage 13.5 min after its start), a 2-min reset gap, and a late contributor
// inside 15 min of a kill's ended_at. Applied twice without error; search_path stays pinned.
// Run: npx vitest run test/find-or-create-gap-split-migration.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const dir = path.join(ROOT, 'supabase', 'migrations');
const FILE = '20261023130000_find_or_create_gap_split.sql';
const norm = stripSql(fs.readFileSync(path.join(dir, FILE), 'utf8')).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const prev = stripSql(fs.readFileSync(path.join(dir, '20260713120000_split_requires_confirmed_kill.sql'), 'utf8')).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

describe('find_or_create_encounter gap split', () => {
  it('replaces the function in place, keeping the signature, SECURITY DEFINER and the search_path pin', () => {
    expect(norm).toMatch(/^create or replace function public\.find_or_create_encounter\(p_guild_id text, p_npc_id integer, p_started_at timestamp with time zone, p_duration integer, p_window_min integer default 30, p_zone_short text default null::text\)/i);
    expect(norm).toMatch(/security definer set search_path to 'public'/i);
    expect(norm).not.toMatch(/\bdrop function\b/i);   // a drop would lose the service_role-only grants
  });

  it('keeps the confirmed-kill splitter exactly as it was', () => {
    const splitter = "if v_hp is not null and v_hp > 0 and v_dmg >= 0.9 * v_hp and v_ended is not null and p_started_at > v_start + make_interval(secs => greatest(v_dur, 60) + 120) then v_id := null; end if;";
    expect(prev).toContain(splitter);
    expect(norm).toContain(splitter);
  });

  it('declines the match 15 min past the matched END, where END is the later of start + duration and ended_at', () => {
    expect(norm).toMatch(/v_gap interval := interval '15 minutes'/);
    expect(norm).toMatch(/v_match_end := greatest\(v_start \+ make_interval\(secs => greatest\(v_dur, 60\)\), coalesce\(v_ended, v_start\)\)/);
    expect(norm).toMatch(/if p_started_at > v_match_end \+ v_gap or p_started_at \+ make_interval\(secs => greatest\(coalesce\(p_duration, 0\), 60\)\) \+ v_gap < v_start then v_id := null/);
  });

  it('the gap rule runs after the match and before the insert, and the insert path is unchanged', () => {
    const match = norm.indexOf('limit 1;');
    const gap = norm.indexOf('v_match_end :=');
    const insert = norm.indexOf('insert into encounters');
    expect(match).toBeGreaterThan(-1);
    expect(gap).toBeGreaterThan(match);
    expect(insert).toBeGreaterThan(gap);
    expect(norm).toContain("insert into encounters (guild_id, npc_id, started_at, duration_sec, zone_short) values (p_guild_id, p_npc_id, p_started_at, p_duration, v_zone) returning id into v_id;");
  });

  it('is longer than the agent\'s 5-minute boss-idle line, with margin for the Lord of Ire re-engage (~10.5 min)', () => {
    const minutes = Number(/interval '(\d+) minutes'/.exec(norm)[1]);
    expect(minutes).toBeGreaterThanOrEqual(15);
  });
});
