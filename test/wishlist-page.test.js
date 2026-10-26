// test/wishlist-page.test.js — /me/wishlist, part B of "add to wishlist wherever you are" (the guild lead, 2026-10-26:
// "A then B"): every character of the member with its list, and a search that finds ANY item by name.
//
// What can go wrong without anyone noticing, and what these tests pin by running the real modules:
//   * a typed `%` or `_` widens the search, or one search pulls more than twenty rows or more columns than it shows;
//   * the search is answered for someone who is signed out, or marks hits with another member's characters;
//   * a second write path appears next to the three actions the control already uses;
//   * the page lists a character from the URL instead of the member's own, or reaches a bid column.
// The search action runs against a fake catalog that applies ilike, order and limit the way PostgREST does.
//
// Run: npx vitest run test/wishlist-page.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as search from '../web/lib/wishlistSearch.ts';

const st = vi.hoisted(() => ({ user: null, owned: {}, items: [], wishlists: [], queries: [], itemError: false }));
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }),
}));
vi.mock('@/lib/ownedCharacters', () => ({ ownedCharacters: async (id) => st.owned[id] ?? [] }));
vi.mock('@/lib/screenTicket', async () => await import('../web/lib/screenTicket.ts'));
vi.mock('@/lib/wishlistBot', async () => await import('../web/lib/wishlistBot.ts'));
vi.mock('@/lib/wishlistPick', async () => await import('../web/lib/wishlistPick.ts'));
vi.mock('@/lib/wishlistSearch', async () => await import('../web/lib/wishlistSearch.ts'));
vi.mock('@/lib/wishlistLoad', async () => await import('../web/lib/wishlistLoad.ts'));

/** A LIKE pattern as a RegExp: % is any run, matched case-insensitively. */
const likeRx = (pat) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table) => {
      const q = { table, cols: '', gt: [], ilike: [], in: {}, order: [], limit: null };
      const chain = {
        select: (c) => { q.cols = c; return chain; },
        gt: (c, v) => { q.gt.push([c, v]); return chain; },
        ilike: (c, pat) => { q.ilike.push([c, pat]); return chain; },
        in: (c, v) => { q.in[c] = v; return chain; },
        order: (c) => { q.order.push(c); return chain; },
        limit: (n) => { q.limit = n; return chain; },
        then: (ok) => {
          st.queries.push({ ...q });
          if (table === 'eqemu_items') {
            if (st.itemError) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok);
            let rows = st.items.filter(r => q.gt.every(([c, v]) => r[c] > v) && q.ilike.every(([c, p]) => likeRx(p).test(r[c])));
            for (const c of [...q.order].reverse()) rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0));
            const pick = q.cols.split(',').map(s => s.trim());
            return Promise.resolve({ data: rows.slice(0, q.limit ?? 1000).map(r => Object.fromEntries(pick.map(k => [k, r[k]]))), error: null }).then(ok);
          }
          const rows = st.wishlists.filter(r => Object.entries(q.in).every(([c, v]) => v.includes(r[c])));
          return Promise.resolve({ data: rows.slice(0, q.limit ?? 1000), error: null }).then(ok);
        },
      };
      return chain;
    },
  }),
}));
const { searchItems } = await import('../web/app/me/wishlist/actions.ts');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const src = (rel) => stripJs(read(rel));
const ENV_KEYS = ['SCREEN_TOKEN_SECRET', 'SCREEN_LIVE_URL'];
let savedEnv;
const owned = (name, o = {}) => ({ name, main_name: null, class: null, active: true, rank: null, hidden_from_lists: false, ...o });
const item = (id, name, o = {}) => ({ id, name, icon: 700 + (id % 50), slots: 4, damage: 9, lore: 'x', ...o });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];       // the bot is not asked: the site reads priority only
  st.user = { id: 'u-alice' };
  st.owned = { 'u-alice': [owned('Aldenmar'), owned('Brackwyn', { main_name: 'Aldenmar' })], 'u-bob': [owned('Corvale')] };
  st.items = []; st.wishlists = []; st.queries = []; st.itemError = false;
});
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

const catalogQueries = () => st.queries.filter(q => q.table === 'eqemu_items');

describe('the typed text becomes a safe search', () => {
  it('strips LIKE wildcards, collapses white space and caps the length', () => {
    expect(search.normaliseSearch('  Cloak   of %Flames_ ')).toBe('Cloak of Flames');
    expect(search.normaliseSearch('a*b\\c')).toBe('abc');
    expect(search.normaliseSearch('x'.repeat(200))).toBe('x'.repeat(search.SEARCH_MAX));
  });
  it('is null when there is not enough to search for, or it is not text', () => {
    for (const v of ['', ' ', 'a', '%%', '_ _', null, undefined, 42, {}, ['ab']]) expect(search.normaliseSearch(v), String(v)).toBeNull();
    expect(search.normaliseSearch('ab')).toBe('ab');
  });
});

describe('the hits are ordered and capped', () => {
  it('lists names that start with the text before names that merely contain it, each item once, twenty at most', () => {
    const starts = Array.from({ length: 15 }, (_, i) => ({ id: i + 1 }));
    const has = Array.from({ length: 30 }, (_, i) => ({ id: i + 10 }));       // ids 10..14 repeat the first list
    const out = search.mergeSearch(starts, has);
    expect(out.length).toBe(20);
    expect(out.slice(0, 15).map(r => r.id)).toEqual(starts.map(r => r.id));
    expect(new Set(out.map(r => r.id)).size).toBe(20);
    expect(search.SEARCH_LIMIT).toBe(20);
  });
});

describe('searchItems', () => {
  it('asks for twenty rows of id, name, icon and slots, ids above zero, and nothing else', async () => {
    st.items = [item(1001, 'Cloak of Flames'), item(1002, 'Flame Cloak'), item(0, 'Cloak Zero'), item(-5, 'Cloak Negative')];
    const r = await searchItems('cloak');
    expect(r.ok).toBe(true);
    expect(r.items.map(i => i.name)).toEqual(['Cloak of Flames', 'Flame Cloak']);       // id 0 and below never come back
    for (const q of catalogQueries()) {
      expect(q.cols).toBe('id, name, icon, slots');
      expect(q.limit).toBe(20);
      expect(q.gt).toEqual([['id', 0]]);
    }
    expect(Object.keys(r.items[0]).sort()).toEqual(['icon', 'id', 'name', 'slots']);
  });

  it('puts prefix matches first, and skips the second query when the first already filled the page', async () => {
    st.items = [item(1, 'Zed Cloak'), item(2, 'Cloak of Aldenmar'), item(3, 'Cloak of Brackwyn')];
    const r = await searchItems('Cloak');
    expect(r.items.map(i => i.id)).toEqual([2, 3, 1]);
    expect(catalogQueries().map(q => q.ilike[0][1])).toEqual(['Cloak%', '%Cloak%']);
    st.queries = [];
    st.items = Array.from({ length: 25 }, (_, i) => item(100 + i, `Cloak ${String(i).padStart(2, '0')}`));
    const full = await searchItems('Cloak');
    expect(full.items.length).toBe(20);
    expect(catalogQueries().length).toBe(1);
  });

  it('never lets a typed wildcard widen the pattern', async () => {
    st.items = [item(1, 'Cloak of Flames'), item(2, 'Boots')];
    const r = await searchItems('%');
    expect(r).toEqual({ ok: false, error: 'Type at least 2 letters of the item name.' });
    expect(st.queries).toEqual([]);
    await searchItems('c%l_oak');
    for (const q of catalogQueries()) expect(q.ilike[0][1]).not.toMatch(/[_]|%.*%.*%/);
    expect(catalogQueries()[0].ilike[0][1]).toBe('cloak%');
  });

  it('answers nobody who is signed out, and reads nothing for them', async () => {
    st.user = null;
    st.items = [item(1, 'Cloak of Flames')];
    expect(await searchItems('cloak')).toEqual({ ok: false, error: 'Sign in again to search.' });
    expect(st.queries).toEqual([]);
  });

  it('says so when the catalog does not answer, instead of showing an empty list', async () => {
    st.itemError = true;
    const r = await searchItems('cloak');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/did not answer/);
  });

  it('marks a hit with the member\'s own characters that list it, and with nobody else\'s', async () => {
    st.items = [item(1001, 'Cloak of Flames'), item(1002, 'Cloak of Frost')];
    st.wishlists = [
      { item_id: 1001, character_name: 'Aldenmar', priority: 2 },
      { item_id: 1001, character_name: 'Corvale', priority: 1 },          // Bob's: Alice must not see it
      { item_id: 1002, character_name: 'Corvale', priority: 3 },
    ];
    const r = await searchItems('cloak');
    expect(r.states[1001]).toEqual({ Aldenmar: { priority: 2, bid: null, bidKnown: false } });
    expect(r.states[1002]).toEqual({});
    expect(JSON.stringify(r)).not.toMatch(/Corvale/);
    for (const q of st.queries.filter(x => x.table === 'wishlists')) {
      expect(q.cols).not.toMatch(/bid/);
      expect(q.in.character_name).toEqual(['Aldenmar', 'Brackwyn']);
    }
    st.user = { id: 'u-bob' };
    const b = await searchItems('cloak');
    expect(b.states[1002]).toEqual({ Corvale: { priority: 3, bid: null, bidKnown: false } });
    expect(JSON.stringify(b)).not.toMatch(/Aldenmar|Brackwyn/);
  });

  it('still finds items for a member with no linked character, and marks nothing', async () => {
    st.items = [item(1001, 'Cloak of Flames')];
    st.owned['u-alice'] = [];                                              // no characters: nothing to mark
    const r = await searchItems('cloak');
    expect(r.ok).toBe(true);
    expect(r.items.length).toBe(1);
    expect(r.states[1001]).toEqual({});
  });
});

describe('the page and the search box add no second write path', () => {
  it('the search action only reads: no insert, update, upsert, delete and no bot client', () => {
    expect(src('web/app/me/wishlist/actions.ts')).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|callBotWishlist|bid_amount|WISHLIST_BID_KEY/);
  });

  it('the search box writes only through the shared control, and the control only through the three actions', () => {
    const box = src('web/app/me/wishlist/WishlistSearch.tsx');
    expect(box).toMatch(/<WishlistControls/);
    expect(box).toMatch(/searchItems\(/);
    expect(box).not.toMatch(/\bfetch\(|addToWishlist|setPreBid|removeFromWishlist|callBotWishlist|supabase/);
  });

  it('the page lists the signed-in member\'s own characters, selects no bid column and bounds its catalog read', () => {
    const page = src('web/app/me/wishlist/page.tsx');
    expect(page).toMatch(/if \(!user\) redirect\('\/auth\/signin\?next=\/me\/wishlist'\)/);
    expect(page).toMatch(/ownedCharacters\(user\.id\)/);
    expect(page).not.toMatch(/searchParams|bid_amount|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(page).toMatch(/\.in\('id', ids\.slice\(i, i \+ 100\)\)\.limit\(100\)/);
    expect(page).toMatch(/<NewPageTag/);
  });

  it('every action that changes a list also refreshes this page', () => {
    expect(src('web/app/me/upgrades/actions.ts')).toMatch(/revalidatePath\('\/me\/wishlist'\)/);
  });

  it('is linked from My Stats and from the gear upgrades page', () => {
    for (const rel of ['web/app/me/page.tsx', 'web/app/me/upgrades/page.tsx']) expect(src(rel), rel).toMatch(/href="\/me\/wishlist"/);
  });
});
