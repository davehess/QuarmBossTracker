// test/admin-loot-page.test.js — the officer loot-by-value page and its two RPCs.
//
// The guild lead, 2026-10-08: "make an admin page with loot, sortable by highest value. note at the
// top that who looted it is not always the person that ends up with it."
//
// Text assertions on shipped source, comments stripped first (stripJs / stripSql): the headers of
// these files explain the very things asserted here and would satisfy a match on their own.
//   • the migration: exact-name join to the item table, lowest id per name, service_role-only grants,
//     and the 2000-row cap inside the function;
//   • the page: officer gate first, [beta] tag above the note, the note text, the window clamp, the
//     two RPC names, and value-descending as the default sort.
//
// Run: npx vitest run test/admin-loot-page.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs, stripSql } from './_source-slice.js';

const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261008170000_loot_value_rpcs.sql');
const PAGE = path.join(ROOT, 'web', 'app', 'admin', 'loot', 'page.tsx');
const TABLE = path.join(ROOT, 'web', 'app', 'admin', 'loot', 'LootTable.tsx');
const ADMIN_INDEX = path.join(ROOT, 'web', 'app', 'admin', 'page.tsx');

const sql = stripSql(readSource(MIGRATION));
const page = stripJs(readSource(PAGE));
const table = stripJs(readSource(TABLE));

// Both function bodies, split on the second create so each assertion is about its own function.
const [itemsFn, looterFn] = sql.split(/create or replace function public\.loot_value_by_looter/i);

// The DKP-aware _v2 pair (20261008180000): created next to v1, never DROPs (a DROP FUNCTION hung on production).
const SQL2 = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261008180000_loot_value_dkp.sql'))).replace(/\s+/g, ' ');
describe('migration 20261008180000_loot_value_dkp.sql', () => {
  it('creates the _v2 pair and drops nothing', () => {
    expect(SQL2).toMatch(/create or replace function public\.loot_value_items_v2\(/i);
    expect(SQL2).toMatch(/create or replace function public\.loot_value_by_looter_v2\(/i);
    expect(SQL2).not.toMatch(/drop function/i);
  });
  it('marks a row DKP from an OpenDKP auction (winner or bid, ±6 h) or award (raid ±12 h), by exact item name', () => {
    expect(SQL2).toMatch(/from opendkp_auctions a where a\.item_name = l\.item_name and coalesce\(a\.created_at, a\.awarded_at, a\.end_at\) between l\.looted_at - interval '6 hours' and l\.looted_at \+ interval '6 hours' and \(a\.winner is not null or exists \(select 1 from opendkp_auction_bids b where b\.auction_id = a\.auction_id\)\)/i);
    expect(SQL2).toMatch(/from opendkp_loot o join opendkp_raids r on r\.raid_id = o\.raid_id where o\.item_name = l\.item_name and r\.ts between l\.looted_at - interval '12 hours' and l\.looted_at \+ interval '12 hours'/i);
  });
  it('leaves DKP rows out of the value and the most valuable item, and counts them separately', () => {
    expect(SQL2).toMatch(/coalesce\(sum\(j\.price\) filter \(where not j\.dkp\), 0\)::bigint/i);
    expect(SQL2).toMatch(/\(count\(\*\) filter \(where j\.dkp\)\)::bigint/i);
    expect(SQL2).toMatch(/filter \(where j\.price is not null and not j\.dkp\)\)\[1\]/i);
  });
  it('keeps service_role-only grants', () => {
    expect(SQL2).toMatch(/grant execute on function public\.loot_value_items_v2\(text, timestamptz, int\) to service_role;/i);
    expect(SQL2).toMatch(/grant execute on function public\.loot_value_by_looter_v2\(text, timestamptz\) to service_role;/i);
    expect(SQL2).toMatch(/revoke all on function public\.loot_value_by_looter_v2\(text, timestamptz\) from public, anon, authenticated;/i);
  });
});

describe('loot value migration', () => {
  it('has both functions, idempotent, never a bare create or a drop', () => {
    expect(sql).toMatch(/create or replace function public\.loot_value_items\(\s*p_guild_id text,\s*p_since\s+timestamptz,\s*p_limit\s+int default 500\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.loot_value_by_looter\(\s*p_guild_id text,\s*p_since\s+timestamptz\s*\)/i);
    expect(sql).not.toMatch(/create\s+function/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(looterFn, 'the second function was found').toBeTruthy();
  });

  it('is SECURITY INVOKER, never definer', () => {
    expect(sql.match(/security invoker/gi)).toHaveLength(2);
    expect(sql).not.toMatch(/security definer/i);
  });

  it('prices by EXACT name equality, never lower() (which cannot use the index and times out)', () => {
    for (const fn of [itemsFn, looterFn]) {
      expect(fn).toMatch(/left join p on p\.name = l\.item_name/i);
      expect(fn).toMatch(/i\.name in \(select distinct l\.item_name from l\)/i);
      expect(fn).not.toMatch(/lower\(\s*(i|p)\.name/i);
      expect(fn).not.toMatch(/ilike/i);
    }
  });

  it('keeps the LOWEST id per item name', () => {
    for (const fn of [itemsFn, looterFn]) {
      expect(fn).toMatch(/select distinct on \(i\.name\)[\s\S]*?order by i\.name, i\.id\b(?!\s+desc)/i);
    }
  });

  it('is granted to service_role only, revoked from everyone else', () => {
    const grants = [...sql.matchAll(/grant\s+execute\s+on\s+function\s+([^\s(]+\([^)]*\))\s+to\s+([^;]+);/gi)]
      .map(m => `${m[1]} -> ${m[2].trim().toLowerCase()}`);
    expect(grants).toEqual([
      'public.loot_value_items(text, timestamptz, int) -> service_role',
      'public.loot_value_by_looter(text, timestamptz) -> service_role',
    ]);
    expect(sql).toMatch(/revoke all on function public\.loot_value_items\(text, timestamptz, int\) from public, anon, authenticated;/i);
    expect(sql).toMatch(/revoke all on function public\.loot_value_by_looter\(text, timestamptz\) from public, anon, authenticated;/i);
  });

  it('caps the item list at 2000 inside the function, and orders highest value first', () => {
    expect(itemsFn).toMatch(/limit least\(greatest\(coalesce\(p_limit, 500\), 1\), 2000\)/i);
    expect(itemsFn).toMatch(/order by p\.price desc nulls last, l\.looted_at desc/i);
  });

  it('the by-looter totals scan the whole window: no limit, grouped per looter, top item is the priciest', () => {
    expect(looterFn).not.toMatch(/\blimit\b/i);
    expect(looterFn).toMatch(/group by j\.looter_lower/i);
    expect(looterFn).toMatch(/array_agg\(j\.item_name order by j\.price desc, j\.looted_at desc\) filter \(where j\.price is not null\)/i);
    expect(looterFn).toMatch(/count\(\*\) filter \(where j\.nodrop\)/i);
  });

  it('both are scoped to the guild and the window', () => {
    for (const fn of [itemsFn, looterFn]) {
      expect(fn).toMatch(/li\.guild_id = p_guild_id/);
      expect(fn).toMatch(/li\.looted_at >= p_since/);
    }
  });
});

describe('/admin/loot page', () => {
  it('calls requireOfficer() as its first statement', () => {
    expect(page).toMatch(/import \{ requireOfficer \} from '@\/lib\/officer';/);
    const body = page.slice(page.indexOf('export default async function'));
    const first = body.split('\n').slice(1).map(l => l.trim()).find(Boolean);
    expect(first).toBe('await requireOfficer();');
  });

  it('carries the [beta] tag, above the first section', () => {
    expect(page).toMatch(/import NewPageTag from '@\/components\/NewPageTag';/);
    const jsx = page.slice(page.indexOf('return ('));
    expect(jsx).toContain('<NewPageTag />');
    expect(jsx.indexOf('<NewPageTag />')).toBeLessThan(jsx.indexOf('<section'));
    expect(page).toMatch(/title: '\[beta\]/);
  });

  it('says at the top that the looter is not always who ends up with the item', () => {
    const flat = page.replace(/&ldquo;|&rdquo;|&rsquo;/g, '').replace(/\s+/g, ' ');
    expect(flat).toContain('Who looted an item is not always who ends up with it.');
    expect(flat).toContain('master looter, corpse runs, trades');
    expect(flat).toContain('You have looted lines each raiders Mimic saw');
    // The note sits before both tables.
    expect(page.indexOf('not always who ends up with it')).toBeLessThan(page.indexOf('By character'));
  });

  it('offers 24h / 7d / 30d / 90d, defaults to 7, and clamps ?days= to that set', () => {
    for (const d of [1, 7, 30, 90]) expect(page).toMatch(new RegExp(`days: ${d}\\b`));
    expect(page).toMatch(/const DEFAULT_DAYS = 7;/);
    expect(page).toMatch(/WINDOWS\.some\(w => w\.days === n\) \? n : DEFAULT_DAYS/);
    expect(page).toMatch(/searchParams: Promise<\{ days\?: string \}>/);
    expect(page).toMatch(/clampDays\(rawDays\)/);
  });

  it('reads both _v2 RPCs (DKP-aware) through the service-role client', () => {
    expect(page).toMatch(/supabaseAdmin\(\)/);
    expect(page).toMatch(/\.rpc\('loot_value_items_v2', \{ p_guild_id: 'wolfpack', p_since: since, p_limit: ITEM_LIMIT \}\)/);
    expect(page).toMatch(/\.rpc\('loot_value_by_looter_v2', \{ p_guild_id: 'wolfpack', p_since: since \}\)/);
    expect(page).not.toMatch(/\.rpc\('loot_value_items'/);
    expect(page).toMatch(/const ITEM_LIMIT = 2000;/);
  });

  it('shows DKP items as listed-but-not-counted (the guild lead: "don\'t count that in the totals")', () => {
    expect(page).toMatch(/>DKP<\/th>/);
    expect(page).toMatch(/l\.dkp_items/);
    expect(page).toMatch(/not counting the .*went through DKP/s);
    expect(table).toMatch(/r\.dkp && <span/);
  });

  it('shows the base-merchant-value footnote and the totals columns', () => {
    expect(page).toContain('base merchant value from the item database, not bazaar prices');
    for (const h of ['Character', 'Items', 'Value (pp)', 'NO DROP', 'Most valuable item']) expect(page).toContain(`>${h}</th>`);
  });

  it('is linked from the admin index', () => {
    const idx = stripJs(readSource(ADMIN_INDEX));
    expect(idx).toMatch(/href="\/admin\/loot"/);
  });
});

describe('LootTable (the sortable item list)', () => {
  it('is a client component sorting by value, highest first, by default', () => {
    expect(table.trimStart().startsWith("'use client';")).toBe(true);
    expect(table).toMatch(/useState<Key>\('value'\)/);
    expect(table).toMatch(/useState<Dir>\('desc'\)/);
  });

  it('can sort by Value, Time, Looter and Item', () => {
    for (const k of ['value', 'time', 'looter', 'item']) expect(table).toMatch(new RegExp(`th\\('${k}'`));
  });

  it('keeps unpriced rows at the bottom whichever way value is sorted', () => {
    // A null on the left returns +1 and a null on the right -1 BEFORE the direction sign is applied.
    expect(table).toMatch(/if \(a\.value_cp == null\) return 1;\s*if \(b\.value_cp == null\) return -1;/);
  });

  it('renders value in platinum, a dash when unpriced, and an ND tag for NO DROP', () => {
    const lib = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'lootValue.ts')));
    expect(lib).toMatch(/cp \/ 1000/);
    expect(lib).toMatch(/maximumFractionDigits: 1/);
    expect(lib).toMatch(/if \(cp == null\) return '—';/);
    expect(table).toMatch(/r\.nodrop &&/);
    expect(table).toContain('>ND</span>');
  });

  it('wraps the table in an overflow container (no page-wide horizontal scroll on a phone)', () => {
    expect(table).toContain('overflow-x-auto');
  });
});
