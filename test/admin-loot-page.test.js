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

// Round three (20261008190000): grouped looter + item rows, paged in the database, on a faster shared base.
const SQL3 = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261008190000_loot_value_grouped.sql'))).replace(/\s+/g, ' ');
describe('migration 20261008190000_loot_value_grouped.sql', () => {
  it('creates the base, the grouped list and v3 totals, and drops nothing', () => {
    expect(SQL3).toMatch(/create or replace function public\.loot_value_rows\( p_guild_id text, p_since timestamptz \)/i);
    expect(SQL3).toMatch(/create or replace function public\.loot_value_grouped\( p_guild_id text, p_since timestamptz, p_sort text default 'total', p_limit int default 50, p_offset int default 0 \)/i);
    expect(SQL3).toMatch(/create or replace function public\.loot_value_by_looter_v3\( p_guild_id text, p_since timestamptz \)/i);
    expect(SQL3).not.toMatch(/drop function/i);
    expect(SQL3).not.toMatch(/security definer/i);
  });
  it('collects the DKP events once, by exact item name, with the same ±6 h auction / ±12 h award rule', () => {
    expect(SQL3).toMatch(/from opendkp_auctions a where a\.item_name in \(select n\.item_name from names n\) and coalesce\(a\.created_at, a\.awarded_at, a\.end_at\) >= p_since - interval '6 hours' and \(a\.winner is not null or exists \(select 1 from opendkp_auction_bids b where b\.auction_id = a\.auction_id\)\)/i);
    expect(SQL3).toMatch(/interval '6 hours' as slack/i);
    expect(SQL3).toMatch(/select o\.item_name, r\.ts, interval '12 hours' from opendkp_raids r join opendkp_loot o on o\.raid_id = r\.raid_id where r\.ts >= p_since - interval '12 hours'/i);
    expect(SQL3).toMatch(/exists \( select 1 from d where d\.item_name = l\.item_name and d\.t between l\.looted_at - d\.slack and l\.looted_at \+ d\.slack \) as dkp/i);
    // Exact name, lowest id — same price join as before.
    expect(SQL3).toMatch(/select distinct on \(i\.name\) i\.name, i\.price, i\.nodrop from eqemu_items i where i\.name in \(select n\.item_name from names n\) order by i\.name, i\.id/i);
  });
  it('groups per looter + item, totals only the non-DKP lines, and counts every group for paging', () => {
    expect(SQL3).toMatch(/group by r\.looter_lower, r\.item_name/i);
    expect(SQL3).toMatch(/coalesce\(sum\(r\.price\) filter \(where not r\.dkp\), 0\)::bigint as total_cp/i);
    expect(SQL3).toMatch(/count\(\*\) over \(\)::bigint/i);
    expect(SQL3).toMatch(/limit least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\) offset greatest\(coalesce\(p_offset, 0\), 0\)/i);
    for (const s of ['unit', 'count', 'recent', 'looter', 'item']) expect(SQL3).toMatch(new RegExp(`when p_sort = '${s}'`));
  });
  it('keeps service_role-only grants on all three', () => {
    for (const sig of ['loot_value_rows\\(text, timestamptz\\)', 'loot_value_grouped\\(text, timestamptz, text, int, int\\)', 'loot_value_by_looter_v3\\(text, timestamptz\\)']) {
      expect(SQL3).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`, 'i'));
      expect(SQL3).toMatch(new RegExp(`grant execute on function public\\.${sig} to service_role;`, 'i'));
    }
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
    expect(page).toMatch(/clampDays\(rawDays\)/);
  });

  it('reads one PAGE of grouped rows and the per-character totals, through the service-role client', () => {
    // The guild lead, 2026-10-08: the 1,000-row list "lags out my machine just to open it. Please paginate".
    const flat = page.replace(/\s+/g, ' ');
    expect(page).toMatch(/supabaseAdmin\(\)/);
    expect(page).toMatch(/const PAGE_SIZE = 50;/);
    expect(flat).toMatch(/\.rpc\('loot_value_grouped', \{ p_guild_id: 'wolfpack', p_since: since, p_sort: sort, p_limit: PAGE_SIZE, p_offset: \(pageNo - 1\) \* PAGE_SIZE, \}\)\.range\(0, PAGE_SIZE - 1\)/);
    expect(page).toMatch(/\.rpc\('loot_value_by_looter_v3', \{ p_guild_id: 'wolfpack', p_since: since \}\)\.range\(0, LOOTER_LIMIT - 1\)/);
    expect(page).toMatch(/const LOOTER_LIMIT = 1000;/);
    // The old single-loot list (up to 1,000 rows into the browser) is gone.
    expect(page).not.toMatch(/loot_value_items/);
    expect(page).not.toMatch(/loot_value_by_looter_v2/);
  });

  it('pages with ?page= and sorts with ?sort=, both clamped, and keeps both across the window chips', () => {
    expect(page).toMatch(/searchParams: Promise<\{ days\?: string; sort\?: string; page\?: string \}>/);
    expect(page).toMatch(/\(SORTS as readonly string\[\]\)\.includes\(raw \?\? ''\) \? \(raw as Sort\) : 'total'/);
    expect(page).toMatch(/Number\.isFinite\(n\) && n >= 1 \? Math\.min\(n, 10000\) : 1/);
    expect(page).toMatch(/Math\.ceil\(totalGroups \/ PAGE_SIZE\)/);
    expect(page).toMatch(/href\(\{ page: pageNo - 1 \}\)/);
    expect(page).toMatch(/href\(\{ page: pageNo \+ 1 \}\)/);
    expect(page).toMatch(/href=\{`\/admin\/loot\?days=\$\{w\.days\}\$\{sort !== 'total' \? `&sort=\$\{sort\}` : ''\}`\}/);
  });

  it('shows DKP items as listed-but-not-counted (the guild lead: "don\'t count that in the totals")', () => {
    expect(page).toMatch(/>DKP<\/th>/);
    expect(page).toMatch(/l\.dkp_items/);
    expect(page).toMatch(/not counting the .*went through DKP/s);
    expect(table).toMatch(/Number\(r\.dkp_count\) > 0 && \(/);
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

describe('LootTable (the looter + item list)', () => {
  it('is a server component: no client JavaScript, nothing sorted in the browser', () => {
    expect(table).not.toMatch(/'use client'/);
    expect(table).not.toMatch(/useState|useMemo|\.sort\(/);
  });

  it('every sort is a link to the server-sorted page, starting again at page 1', () => {
    expect(table).toMatch(/export const SORTS = \['total', 'unit', 'count', 'recent', 'looter', 'item'\] as const;/);
    for (const k of ['looter', 'item', 'count', 'unit', 'total', 'recent']) expect(table).toMatch(new RegExp(`th\\('${k}'`));
    expect(table).toMatch(/<Link href=\{href\(\{ sort: k, page: 1 \}\)\}/);
  });

  it('shows one row per looter + item with the count, the value of one, and the row total', () => {
    for (const h of ["'Count'", "'Each (pp)'", "'Total (pp)'"]) expect(table).toContain(h);
    expect(table).toMatch(/Number\(r\.looted\)\.toLocaleString\(\)/);
    expect(table).toMatch(/fmtPp\(r\.unit_cp\)/);
    expect(table).toMatch(/r\.unit_cp == null \? '—' : fmtPp\(Number\(r\.total_cp\)\)/);
    expect(table).toMatch(/key=\{`\$\{r\.looter_character\}\|\$\{r\.item_name\}`\}/);
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
