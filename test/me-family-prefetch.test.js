// test/me-family-prefetch.test.js — /me asks once per account, not a dozen
// times per character.
//
// Hitya, 2026-09-13: "when the page loads fresh i get a huge lag spike." The
// account holds 46 characters and the page ran ~12 queries for each — ~550
// PostgREST round trips, two of them a 385 ms chat count apiece — then ran it
// all again twice on every Strips/Blocks click. Now chat counts, levels, loot,
// wishlist and PvP tallies come back for the whole family in one query each
// (three small RPCs + batched selects), and the per-character fan-out runs
// only for names that have any parse, upload or rollup row (9 of the 46).
//
// Stripped-source assertions: the comments above name exactly the shapes a
// comment could otherwise satisfy.
//
// Run: npx vitest run test/me-family-prefetch.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';

const me  = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'me', 'page.tsx'), 'utf8'));
const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260914043000_me_family_rpcs.sql'), 'utf8'));

describe('the page fetches per family', () => {
  it('no longer counts chat, or looks up loot, wishlist or PvP, per character', () => {
    expect(me).not.toMatch(/\.from\('chat_messages'\)/);
    expect(me).not.toMatch(/\.from\('opendkp_loot_recent'\)[\s\S]{0,200}\.eq\('character_name', name\)/);
    expect(me).not.toMatch(/\.from\('wishlists'\)[\s\S]{0,120}\.eq\('character_name', name\)/);
    expect(me).not.toMatch(/\.ilike\('killer', name\)/);
    expect(me).not.toMatch(/\.from\('who_observations'\)/);
    expect(me).not.toMatch(/\.from\('character_spellbook'\)/);
  });

  it('uses the three family RPCs and batched selects instead', () => {
    expect(me).toMatch(/admin\.rpc\('me_active_names', \{ p_names: names \}\)/);
    expect(me).toMatch(/admin\.rpc\('me_chat_counts', \{ p_names: names, p_since: since30 \}\)/);
    expect(me).toMatch(/admin\.rpc\('me_levels', \{ p_names: charNames \}\)/);
    expect(me).toMatch(/\.from\('opendkp_loot_recent'\)[\s\S]{0,200}\.in\('character_name', names\)/);
    expect(me).toMatch(/\.from\('wishlists'\)\.select\('character_name'\)\.in\('character_name', names\)/);
    expect(me).toMatch(/\.ilikeAnyOf\('killer', names\)/);
    expect(me).toMatch(/\.ilikeAnyOf\('victim', names\)/);
    expect(me).toMatch(/\.ilikeAnyOf\('assister', names\)/);
  });

  it('skips the per-character fan-out for a name with nothing to fetch', () => {
    const skip = me.indexOf("if (!fam.active.has(nameLower)) {");
    const fanout = me.indexOf(".from('encounter_players')\n      .select('encounter_id, total_damage, dps')");
    expect(skip).toBeGreaterThan(-1);
    expect(fanout).toBeGreaterThan(skip);           // the queries sit BELOW the early return
  });

  it('runs the prefetch alongside the other family-wide loads, once', () => {
    expect(me).toMatch(/const \[scrap, \{ floors, coverage \}, attendance, fam\] = await Promise\.all\(\[/);
    expect((me.match(/loadFamilyPrefetch\(names\)/g) || []).length).toBe(1);
  });
});

describe('the RPCs', () => {
  it('count chat per speaker for the whole family in one pass', () => {
    expect(sql).toMatch(/create or replace function public\.me_chat_counts\(p_names text\[\], p_since timestamptz\)/);
    expect(sql).toMatch(/where speaker = any\(p_names\)\s+group by speaker/);
  });
  it('take the best level over both signals in SQL', () => {
    expect(sql).toMatch(/create or replace function public\.me_levels\(p_names text\[\]\)/);
    expect(sql).toMatch(/greatest\(coalesce\(w\.lvl, 0\), coalesce\(s\.lvl, 0\)\) > 0/);
  });
  it('mark a name active on any parse, upload or rollup row', () => {
    expect(sql).toMatch(/create or replace function public\.me_active_names\(p_names text\[\]\)/);
    expect(sql).toMatch(/exists \(select 1 from encounter_players ep where ep\.character_name = x\)/);
    expect(sql).toMatch(/exists \(select 1 from contributions c where c\.contributor_character = x\)/);
    expect(sql).toMatch(/exists \(select 1 from encounter_combat_rollup r where r\.character_name = x\)/);
  });
  it('are service-role only, like the Scrap RPC', () => {
    for (const fn of ['me_chat_counts(text[], timestamptz)', 'me_levels(text[])', 'me_active_names(text[])']) {
      const esc = fn.replace(/[()[\]]/g, m => '\\' + m);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${esc} from public;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${esc} to service_role;`));
    }
  });
});
