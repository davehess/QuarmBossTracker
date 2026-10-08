// test/missing-spells-name-key.test.js — FB-67 and the inverted NO DROP tag.
//
// FB-67 (a member, 2026-10-08): the shopping list showed songs the character already owns. Measured on production:
// the spellbook says "Angstlich's Assonance" (apostrophe), the scroll item says "Song: Angstlich`s Assonance"
// (backtick), one scroll is "Song: Angstlichs Appalling Screech" (no quote), and "Song: Kazumi`s Preservation" teaches
// "Kazumi's Note of Preservation" (a different name). character_missing_spells compared lower(name) equality.
// 20261008200000 compares a letters-and-digits key and routes mismatched scroll names through an alias table.
//
// The guild lead, 2026-10-08: "All of these ND items are not actually no drop, i think the display is backwards."
// eqemu_items.nodrop is inverted on this mirror (false = NO DROP); 20261008210000 and utils/lootValue.js flip it.
//
// Text assertions on shipped SQL with comments stripped (stripSql), plus the key function and the alias rows run in
// JS the way Postgres runs them.
//
// Run: npx vitest run test/missing-spells-name-key.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripSql } from './_source-slice.js';

const MIG = path.join(ROOT, 'supabase', 'migrations');
const keyMig = readSource(path.join(MIG, '20261008200000_missing_spells_name_key.sql'));
const sql = stripSql(keyMig).replace(/\s+/g, ' ');
const polarity = stripSql(readSource(path.join(MIG, '20261008210000_loot_value_nodrop_polarity.sql'))).replace(/\s+/g, ' ');

// spell_name_key as Postgres runs it: lower(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')).
const key = (t) => String(t ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

describe('spell_name_key', () => {
  it('is the immutable letters-and-digits key', () => {
    expect(sql).toMatch(/create or replace function public\.spell_name_key\(t text\) returns text language sql immutable parallel safe set search_path to '' as \$\$ select lower\(regexp_replace\(coalesce\(t, ''\), '\[\^A-Za-z0-9\]', '', 'g'\)\) \$\$;/i);
  });

  it('makes apostrophe, backtick, curly quote and a missing quote compare equal (FB-67)', () => {
    expect(key("Angstlich's Assonance")).toBe(key('Angstlich`s Assonance'));
    expect(key('Angstlich`s Appalling Screech')).toBe(key('Angstlichs Appalling Screech'));
    expect(key('Kazumi’s Note of Preservation')).toBe(key("Kazumi's Note of Preservation"));
    expect(key('Cantata of Soothing')).toBe('cantataofsoothing');
    expect(key('Cantata of Soothing')).not.toBe(key('Cantata of Soothing II'));
  });
});

describe('spell_scroll_aliases', () => {
  const rows = [...keyMig.matchAll(/\(\$q\$(.+?)\$q\$,\s*\$q\$(.+?)\$q\$,\s*'([^']*)'\)/g)].map(m => ({ scroll: m[1], spell: m[2] }));

  it('is a service-role-only table keyed on the scroll key', () => {
    // (stripSql removes whole comment lines only; the column comments are trailing, so match the pieces.)
    expect(sql).toMatch(/create table if not exists public\.spell_scroll_aliases \( scroll_key text primary key,/i);
    expect(sql).toMatch(/spell_key text not null,/i);
    expect(sql).toMatch(/alter table public\.spell_scroll_aliases enable row level security;/i);
    expect(sql).toMatch(/on conflict \(scroll_key\) do nothing;/i);
  });

  it('maps the reported Kazumi scroll to its spell, and no scroll twice', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const kaz = rows.find(r => key(r.scroll) === key('Kazumi`s Preservation'));
    expect(key(kaz.spell)).toBe(key("Kazumi's Note of Preservation"));
    expect(new Set(rows.map(r => key(r.scroll))).size).toBe(rows.length);
  });

  it('every alias really is a different name (an alias for a name that already matches is dead weight)', () => {
    for (const r of rows) expect(key(r.scroll), r.scroll).not.toBe(key(r.spell));
  });
});

describe('character_missing_spells compares on the key', () => {
  it('owned = the spellbook key, matched to the scroll through its alias when it has one', () => {
    expect(sql).toMatch(/scribed as \( select public\.spell_name_key\(spell_name\) as nm from character_spellbook/i);
    expect(sql).toMatch(/coalesce\(a\.spell_key, public\.spell_name_key\(p0\.spell_name\)\) as match_key/i);
    expect(sql).toMatch(/left join spell_scroll_aliases a on a\.scroll_key = public\.spell_name_key\(p0\.spell_name\)/i);
    expect(sql).toMatch(/left join scribed sc on sc\.nm = p\.match_key/i);
    expect(sql).toMatch(/left join levels l on l\.nm = p\.match_key and l\.class_key = me\.class_key/i);
    // The old raw equality is gone.
    expect(sql).not.toMatch(/sc\.nm = lower\(p\.spell_name\)/i);
  });

  it('keeps the signature, the displayed names and the grant', () => {
    expect(sql).toMatch(/create or replace function public\.character_missing_spells\( p_guild_id text, p_character text, p_class_bit integer\) returns table\(spell_name text, scroll_item_id integer, spell_id integer, scribe_level integer, held_by text\[\], buyable boolean, pop boolean\)/i);
    expect(sql).toMatch(/grant execute on function public\.character_missing_spells\(text, text, integer\) to service_role;/i);
    expect(sql).not.toMatch(/drop function/i);
  });

  it('only searches eqemu_spells by key for scrolls with no exact-name spell (the table has an index on lower(name) only)', () => {
    expect(sql).toMatch(/where p0\.spell_id is null and public\.spell_name_key\(s\.name\)/i);
  });
});

describe('NO DROP polarity', () => {
  it('loot_value_rows returns plain polarity: true = NO DROP, NULL when the item is unknown', () => {
    expect(polarity).toMatch(/\(p\.nodrop = false\)/);
    expect(polarity).not.toMatch(/p\.price::bigint, p\.nodrop,/);
    expect(polarity).not.toMatch(/drop function/i);
  });

  it('the bot Loot tab flips the column too (utils/lootValue.js)', () => {
    const js = readSource(path.join(ROOT, 'utils', 'lootValue.js')).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(js).toMatch(/nodrop: r\.nodrop == null \? null : !r\.nodrop/);
    expect(js).not.toMatch(/nodrop: r\.nodrop == null \? null : !!r\.nodrop/);
  });
});
