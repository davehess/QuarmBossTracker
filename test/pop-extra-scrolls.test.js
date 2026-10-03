// test/pop-extra-scrolls.test.js — the officer list of extra PoP reward scrolls.
//
// The guild lead, 2026-10-03: "extra PoP spells. when someone does a turnin for their new spells
// and gets one they already have, put that into an officer only list so we can help direct who
// needs it." Phase 1 reads data we hold: a reward scroll in a character's inventory whose spell
// that same character's spellbook already lists.
//
// Two things this file guards, both text assertions on shipped source (comments stripped first,
// because both files' headers explain the very things asserted here and would satisfy a match):
//   • the migration: idempotent, callable by the service role only, and the "already has it"
//     condition really is a JOIN to the spellbook (not the opposite, a NOT EXISTS, which would list
//     the scrolls a holder still needs to scribe);
//   • the page: officer gate first, [beta] tag, reads the RPC and the columns the RPC returns.
//
// Run: npx vitest run test/pop-extra-scrolls.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs, stripSql } from './_source-slice.js';

const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261003150000_pop_extra_scrolls.sql');
const PAGE = path.join(ROOT, 'web', 'app', 'admin', 'extra-spells', 'page.tsx');
const ADMIN_INDEX = path.join(ROOT, 'web', 'app', 'admin', 'page.tsx');
const POP_NEEDS = path.join(ROOT, 'supabase', 'migrations', '20260826010000_pop_spell_needs_all_characters.sql');

const sql = stripSql(readSource(MIGRATION));
const page = stripJs(readSource(PAGE));

// The text inside the balanced parentheses that open at `from` (index of the "(").
function parenBody(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(from + 1, i);
  }
  throw new Error('unbalanced parentheses');
}
// Every `not exists ( ... )` body in a SQL string.
function notExistsBodies(src) {
  return [...src.matchAll(/not\s+exists\s*\(/gi)].map(m => parenBody(src, m.index + m[0].length - 1));
}

describe('pop_extra_scrolls migration', () => {
  it('is idempotent: create or replace, never a bare create or a drop', () => {
    expect(sql).toMatch(/create or replace function public\.pop_extra_scrolls\(p_guild_id text\)/i);
    expect(sql).not.toMatch(/create\s+function/i);
    expect(sql).not.toMatch(/drop\s+function/i);
  });

  it('is granted to service_role only, and revoked from everyone else', () => {
    const grants = [...sql.matchAll(/grant\s+[^;]*?\s+to\s+([^;]+);/gi)].map(m => m[1].trim().toLowerCase());
    expect(grants, 'at least one grant (not a vacuous pass)').toEqual(['service_role']);
    expect(sql).toMatch(/revoke all on function public\.pop_extra_scrolls\(text\) from public, anon, authenticated;/i);
  });

  it('"already has it" is a join to the holder\'s spellbook, not an absence check', () => {
    // The scroll's spell must be found in character_spellbook, matched to the same character...
    expect(sql).toMatch(/from character_spellbook b[\s\S]*?lower\(b\.character_name\) = lower\(ci\.character_name\)/i);
    // ...and a row must exist for it.
    expect(sql).toMatch(/sb\.observed_at is not null/i);
    // The opposite reading ("holder does NOT have it") would list the scrolls a holder still needs.
    // So no NOT EXISTS in this function may look inside the spellbook.
    const bodies = notExistsBodies(sql);
    expect(bodies.length, 'the opt-out NOT EXISTS is there to be found (not a vacuous pass)').toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/character_spellbook/i);
  });

  it('the NOT EXISTS check really would catch an absence check on the spellbook', () => {
    const bad = sql.replace(/and sb\.observed_at is not null/i,
      'and not exists (select 1 from character_spellbook z where lower(z.character_name) = lower(ci.character_name))');
    expect(bad).not.toBe(sql);
    expect(notExistsBodies(bad).some(b => /character_spellbook/i.test(b))).toBe(true);
  });

  it('only PoP reward scrolls count: inventory is joined to the trainer pools by item id', () => {
    expect(sql).toMatch(/from pop_parchment_pools/i);
    expect(sql).toMatch(/join reward r on r\.scroll_item_id = ci\.item_id/i);
  });

  it('skips characters that opted out of stats or inventory', () => {
    expect(sql).toMatch(/coalesce\(c\.exclude_from_stats, false\) = false/i);
    expect(sql).toMatch(/coalesce\(c\.exclude_inventory, false\) = false/i);
    expect(sql).toMatch(/coalesce\(nc\.exclude_inventory, false\)/i);
  });

  it('takes the needers from pop_spell_needs and keeps its first-dibs order', () => {
    expect(sql).toMatch(/from pop_spell_needs\(p_guild_id\) n/i);
    // pop_spell_needs orders level-descending with unknown levels last; this must lead the same way.
    const popOrder = stripSql(readSource(POP_NEEDS)).match(/ORDER BY (m\.lvl DESC NULLS LAST)/i);
    expect(popOrder, 'pop_spell_needs still orders by level').not.toBeNull();
    expect(sql).toMatch(/order by n\.char_level desc nulls last/i);
  });

  it('returns the columns the page reads', () => {
    const table = sql.match(/returns table\(([\s\S]*?)\)\s*language/i);
    expect(table, 'a RETURNS TABLE list').not.toBeNull();
    for (const col of ['holder_name', 'holder_class', 'scroll_item_id', 'scroll_name', 'spell_name',
      'slot_label', 'quantity', 'inventory_observed_at', 'spellbook_observed_at', 'needers']) {
      expect(table[1], col).toMatch(new RegExp(`\\b${col}\\b`));
      expect(page, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe('/admin/extra-spells page', () => {
  it('checks the officer role first, before anything is read', () => {
    expect(page).toMatch(/import \{[^}]*\brequireOfficer\b[^}]*\} from '@\/lib\/officer';/);
    const body = page.slice(page.indexOf('export default async function'));
    const first = body.replace(/^[^{]*\{\s*\n/, '').split('\n').map(l => l.trim()).find(l => l.length > 0);
    expect(first).toBe('await requireOfficer();');
    expect(body.indexOf('requireOfficer()')).toBeLessThan(body.indexOf('supabaseAdmin()'));
  });

  it('is marked [beta]: the tag at the top of the page and the title', () => {
    expect(page).toMatch(/import NewPageTag from '@\/components\/NewPageTag';/);
    const jsx = page.slice(page.indexOf('return ('));
    expect(jsx).toContain('<NewPageTag />');
    expect(jsx.indexOf('<NewPageTag />')).toBeLessThan(jsx.indexOf('<section'));
    expect(page).toMatch(/export const metadata = \{ title: '\[beta\] Extra PoP spells' \};/);
  });

  it('reads the RPC for the wolfpack guild through the service client', () => {
    expect(page).toMatch(/supabaseAdmin\(\)/);
    expect(page).toMatch(/\.rpc\('pop_extra_scrolls', \{ p_guild_id: 'wolfpack' \}\)/);
  });

  it('links character names to /character/<name>, holders and needers', () => {
    expect(page).toMatch(/href=\{`\/character\/\$\{encodeURIComponent\(name\)\}`\}/);
    expect(page).toMatch(/<CharLink name=\{r\.holder_name\} \/>/);
    expect(page).toMatch(/<CharLink name=\{n\.name\} \/>/);
  });

  it('explains the empty state and the stale-scroll caveat', () => {
    expect(page).toContain('/outputfile inventory');
    expect(page).toContain('/outputfile spellbook');
    expect(page).toMatch(/scribed it after their last inventory export/);
  });

  it('is linked from the admin index', () => {
    expect(stripJs(readSource(ADMIN_INDEX))).toContain('href="/admin/extra-spells"');
  });
});
