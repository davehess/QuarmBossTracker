// test/wishlist-everywhere.test.js — "Add to wishlist" wherever an item shows (the guild lead, 2026-10-26: "How do you add
// items for your wishlist?" -> pick "A then B"; this is A): the item page, the raid plan's loot lines and the gear
// upgrades share ONE control (web/components/WishlistControls.tsx), fed by web/lib/wishlistLoad.ts.
//
// What can go wrong without anyone noticing, and what these tests pin by running the real modules:
//   * the picker offers a character that is not the member's, or one the action would refuse;
//   * the control starts on the wrong character (the raid plan must start on the one the sign-up brings; every
//     other page on the main);
//   * the loader reads another member's list, selects a bid column, or shows "no pre-bid" when the bot never answered;
//   * a second write path appears next to the three server actions.
// The behaviour is driven end to end where it can be: the loader runs over a fake PostgREST and the REAL bot
// handler (utils/webWishlist.js) with the real bidCrypto. Text checks strip comments first (stripJs).
//
// Run: npx vitest run test/wishlist-everywhere.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { makeDb } from './_wishlist_fake.js';
import * as pick from '../web/lib/wishlistPick.ts';
import { bringingFrom } from '../web/lib/raidMe.ts';

const require = createRequire(import.meta.url);
const bidCrypto = require('../utils/bidCrypto.js');
const webWishlist = require('../utils/webWishlist.js');

// ── What wishlistLoad.ts imports through the alias ──────────────────────────
const st = vi.hoisted(() => ({ owned: {}, selects: [], rows: [] }));
vi.mock('@/lib/ownedCharacters', () => ({ ownedCharacters: async (id) => st.owned[id] ?? [] }));
vi.mock('@/lib/screenTicket', async () => await import('../web/lib/screenTicket.ts'));
vi.mock('@/lib/wishlistBot', async () => await import('../web/lib/wishlistBot.ts'));
vi.mock('@/lib/wishlistPick', async () => await import('../web/lib/wishlistPick.ts'));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table) => {
      const q = { table, cols: '', in: {}, limit: null };
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        in: (col, vals) => { q.in[col] = vals; return chain; },
        order: () => chain,
        limit: (n) => { q.limit = n; return chain; },
        then: (ok) => {
          st.selects.push({ ...q });
          const data = st.rows.filter(r => Object.entries(q.in).every(([c, v]) => v.includes(r[c])));
          return Promise.resolve({ data: data.slice(0, q.limit ?? 1000), error: null }).then(ok);
        },
      };
      return chain;
    },
  }),
}));
const load = await import('../web/lib/wishlistLoad.ts');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SECRET = 'wishlist-everywhere-secret-not-real';
const KEY = '0123456789abcdef'.repeat(4);
const BOT = 'https://bot.example.test';
const ENV_KEYS = ['SCREEN_TOKEN_SECRET', 'SCREEN_LIVE_URL', 'WISHLIST_BID_KEY'];
let savedEnv; let fake;

const owned = (name, o = {}) => ({ name, main_name: null, class: null, active: true, rank: null, hidden_from_lists: false, ...o });
// Aldenmar's family: Aldenmar is the main; Brackwyn an alt; Nyssara an alt their owner tucked away.
const FAMILY = [
  owned('Brackwyn', { main_name: 'Aldenmar', class: 'Bard' }),
  owned('Nyssara', { main_name: 'Aldenmar', hidden_from_lists: true }),
  owned('Aldenmar', { class: 'Cleric' }),
  owned('Z', { main_name: 'Aldenmar' }),                 // not a usable name: the action would refuse it
];

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.SCREEN_TOKEN_SECRET = SECRET;
  process.env.SCREEN_LIVE_URL = `${BOT}/api/screen/live`;
  process.env.WISHLIST_BID_KEY = KEY;
  fake = makeDb();
  webWishlist._setDeps({ supabase: fake.sb });
  st.owned = {}; st.selects = []; st.rows = [];
});
afterEach(() => {
  webWishlist._reset();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

/** The site's fetch, answered by the real bot handler over the fake database. */
function wireFetchToBot() {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    const req = Readable.from([Buffer.from(init.body)]);
    req.method = init.method; req.headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const out = { status: 0, text: '' };
    await webWishlist.handle(req, { writeHead(s) { out.status = s; }, end(b) { out.text = b || ''; } });
    return new Response(out.text, { status: out.status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

describe('which characters the control offers', () => {
  it('offers the member\'s usable characters, main first, and leaves a tucked-away one out', () => {
    expect(pick.wishlistCharacters(FAMILY)).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('keeps a tucked-away character when it is the one the sign-up brings, and never offers a name the action refuses', () => {
    expect(pick.wishlistCharacters(FAMILY, 'nyssara')).toEqual(['Aldenmar', 'Brackwyn', 'Nyssara']);
    for (const bad of ["Corvale'--", 'A', 'Zar rin', 'Zarrin2', '']) {
      expect(pick.wishlistCharacters([owned(bad)]), JSON.stringify(bad)).toEqual([]);
    }
  });

  it('puts a main ahead of an active alt, an active alt ahead of an inactive one, then by name', () => {
    const list = [owned('Corvale', { main_name: 'Aldenmar', active: false }), owned('Brackwyn', { main_name: 'Aldenmar' }), owned('Aldenmar', { active: false })];
    expect(pick.wishlistCharacters(list)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });
});

describe('which character the control starts on', () => {
  const names = ['Aldenmar', 'Brackwyn'];
  it('is the preferred one when it is the member\'s, spelled the way the list spells it', () => {
    expect(pick.pickDefaultCharacter(names, 'brackwyn')).toBe('Brackwyn');
  });
  it('is the main (the first name) with no preference, a stranger\'s name, or nothing offered', () => {
    expect(pick.pickDefaultCharacter(names)).toBe('Aldenmar');
    expect(pick.pickDefaultCharacter(names, null)).toBe('Aldenmar');
    expect(pick.pickDefaultCharacter(names, 'Corvale')).toBe('Aldenmar');
    expect(pick.pickDefaultCharacter([], 'Corvale')).toBeNull();
  });
  it('on the raid plan is the character the sign-up brings: a Bard sign-up starts the control on the Bard alt, not the main', () => {
    const preferred = bringingFrom(FAMILY, { status: 'Primary', class_name: 'Bard' })?.name;
    expect(preferred).toBe('Brackwyn');
    const names2 = pick.wishlistCharacters(FAMILY, preferred);
    expect(pick.pickDefaultCharacter(names2, preferred)).toBe('Brackwyn');
    // No sign-up, or one that is not a yes: nobody is brought, so the main it is.
    expect(bringingFrom(FAMILY, null)).toBeNull();
    expect(bringingFrom(FAMILY, { status: 'Absence', class_name: 'Bard' })).toBeNull();
    expect(pick.pickDefaultCharacter(names2, bringingFrom(FAMILY, null)?.name)).toBe('Aldenmar');
  });
  it('labels a picker option that already has the item', () => {
    expect(pick.pickerLabel('Aldenmar', { Aldenmar: { priority: 3, bid: null, bidKnown: true } })).toBe('Aldenmar · on list');
    expect(pick.pickerLabel('Brackwyn', { Aldenmar: { priority: 3, bid: null, bidKnown: true } })).toBe('Brackwyn');
  });
});

describe('what the loader reads for a page', () => {
  const seed = () => {
    st.owned['u-alice'] = FAMILY;
    fake.db.wishlists.push(
      { character_name: 'Aldenmar', item_id: 1001, priority: 2, bid_amount_enc: bidCrypto.encryptBid(450), bid_amount: null },
      { character_name: 'Brackwyn', item_id: 1001, priority: 7, bid_amount_enc: null, bid_amount: null },
      { character_name: 'Aldenmar', item_id: 1002, priority: 4, bid_amount_enc: null, bid_amount: null },
    );
    st.rows = fake.db.wishlists.map(r => ({ item_id: r.item_id, character_name: r.character_name, priority: r.priority }));
  };

  it('returns the member\'s characters, where the item is already listed, and the owner\'s own pre-bid from the bot', async () => {
    seed(); wireFetchToBot();
    const v = await load.loadWishView('u-alice', [1001], {});
    expect(v.enabled).toBe(true);
    expect(v.characters).toEqual(['Aldenmar', 'Brackwyn']);
    expect(v.defaultCharacter).toBe('Aldenmar');
    expect(v.states.get(1001)).toEqual({
      Aldenmar: { priority: 2, bid: 450, bidKnown: true },
      Brackwyn: { priority: 7, bid: null, bidKnown: true },
    });
    expect(v.states.has(1002)).toBe(false);
  });

  it('asks only about the member\'s own characters: another member\'s list is never read', async () => {
    seed(); wireFetchToBot();
    fake.db.wishlists.push({ character_name: 'Corvale', item_id: 1001, priority: 1, bid_amount_enc: bidCrypto.encryptBid(9999), bid_amount: null });
    st.rows.push({ item_id: 1001, character_name: 'Corvale', priority: 1 });
    const v = await load.loadWishView('u-alice', [1001], {});
    expect(JSON.stringify([...v.states])).not.toMatch(/Corvale|9999/);
    expect(st.selects[0].in.character_name).toEqual(['Aldenmar', 'Brackwyn']);
    // Bob owns Corvale only; he gets his own and none of Alice's.
    st.owned['u-bob'] = [owned('Corvale')];
    const b = await load.loadWishView('u-bob', [1001], {});
    expect(b.characters).toEqual(['Corvale']);
    expect(JSON.stringify([...b.states])).not.toMatch(/Aldenmar|Brackwyn|450/);
  });

  it('selects no bid column, and one bot call per character with something listed', async () => {
    seed(); const calls = wireFetchToBot();
    await load.loadWishView('u-alice', [1001, 1002], {});
    for (const s of st.selects) expect(s.cols).not.toMatch(/bid/);
    expect(calls.filter(c => c.op === 'list').map(c => c.character).sort()).toEqual(['Aldenmar', 'Brackwyn']);
    st.selects = []; wireFetchToBot();
    const only = await load.loadWishView('u-alice', [1002], {});
    expect(only.states.get(1002).Aldenmar.bid).toBeNull();
  });

  it('does not say "no pre-bid" when the bot never answered: bidKnown is false', async () => {
    seed();
    vi.stubGlobal('fetch', async () => { throw new Error('connect ECONNREFUSED'); });
    const v = await load.loadWishView('u-alice', [1001], {});
    expect(v.states.get(1001).Aldenmar).toEqual({ priority: 2, bid: null, bidKnown: false });
  });

  it('is switched off, with no bot call, when the site is not wired to the bot; the list still shows', async () => {
    seed(); delete process.env.SCREEN_LIVE_URL;
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    const v = await load.loadWishView('u-alice', [1001], {});
    expect(v.enabled).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(v.states.get(1001).Aldenmar.priority).toBe(2);
  });

  it('is null for a member with no usable character, so the page shows nothing', async () => {
    st.owned['u-nobody'] = [];
    expect(await load.loadWishView('u-nobody', [1001], {})).toBeNull();
    expect(await load.loadWishView('u-stranger', [1001], {})).toBeNull();
  });

  it('starts on the preferred character, and keeps it even when its owner tucked it away', async () => {
    seed(); wireFetchToBot();
    const v = await load.loadWishView('u-alice', [1001], { preferred: 'Nyssara' });
    expect(v.characters).toContain('Nyssara');
    expect(v.defaultCharacter).toBe('Nyssara');
  });

  it('chunks the item ids so characters x ids stays inside one 1,000-row response', async () => {
    st.owned['u-alice'] = FAMILY; wireFetchToBot();
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    await load.loadWishView('u-alice', ids, {});
    expect(st.selects.length).toBeGreaterThan(1);
    for (const s of st.selects) expect(s.in.item_id.length * s.in.character_name.length).toBeLessThanOrEqual(1000);
    expect(st.selects.flatMap(s => s.in.item_id).length).toBe(1200);
  });
});

describe('one control, one write path', () => {
  const src = (rel) => stripJs(read(rel));

  it('the control calls the three server actions and nothing else: no fetch, no bot client, no key, no bid column', () => {
    const s = src('web/components/WishlistControls.tsx');
    expect(s).toMatch(/from '@\/app\/me\/upgrades\/actions'/);
    expect(s).toMatch(/addToWishlist\(/);
    expect(s).toMatch(/setPreBid\(/);
    expect(s).toMatch(/removeFromWishlist\(/);
    expect(s).not.toMatch(/\bfetch\(|callBotWishlist|wishlistBot|WISHLIST_BID_KEY|bid_amount|supabase/);
  });

  it('the loader and the pages never select a bid column or write a wishlist', () => {
    for (const rel of ['web/lib/wishlistLoad.ts', 'web/app/db/item/[id]/page.tsx', 'web/app/pop/raid/page.tsx']) {
      expect(src(rel), rel).not.toMatch(/bid_amount|\.insert\(|\.upsert\(|\.delete\(|\.update\(/);
    }
  });

  it('shows up on the item page, the raid plan\'s loot lines and the gear upgrades, from the same component', () => {
    for (const rel of ['web/app/db/item/[id]/page.tsx', 'web/app/pop/raid/page.tsx', 'web/app/me/upgrades/page.tsx']) {
      expect(src(rel), rel).toMatch(/import WishlistControls from '@\/components\/WishlistControls'/);
      expect(src(rel), rel).toMatch(/<WishlistControls/);
    }
    expect(src('web/app/pop/raid/page.tsx')).toMatch(/compact/);
    expect(fs.existsSync(path.join(ROOT, 'web/app/me/upgrades/WishlistControls.tsx'))).toBe(false);
  });

  it('the item page and the raid plan only draw it for a member the page already signed in', () => {
    for (const rel of ['web/app/db/item/[id]/page.tsx', 'web/app/pop/raid/page.tsx']) {
      expect(src(rel), rel).toMatch(/if \(!user\) redirect\(/);
      expect(src(rel), rel).toMatch(/\{wish && \(/);
    }
  });

  it('the raid plan starts on the sign-up character through bringingFrom', () => {
    expect(src('web/app/pop/raid/page.tsx')).toMatch(/bringingFrom\(owned, signup\)\?\.name/);
  });
});

describe('the ownership guard is the one the upgrades page already had', () => {
  it('a character the picker could never offer is refused by the same action, before the bot is asked', async () => {
    // The action file is driven by test/web-wishlist.test.js in full; here the picker's output is checked
    // against the rule the action applies (letters only, 2+) so the two cannot drift apart.
    const act = stripJs(read('web/app/me/upgrades/actions.ts'));
    const m = /\/\^\[A-Za-z\]\{2,\}\$\/\.test\(character\)/.exec(act);
    expect(m).not.toBeNull();
    expect(pick.WISHLIST_NAME_RE.source).toBe('^[A-Za-z]{2,}$');
    expect(act).toMatch(/ownedCharacters\(user\.id\)/);
  });
});
