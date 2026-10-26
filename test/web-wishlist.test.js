// test/web-wishlist.test.js — the site half of "add to wishlist" + sealed pre-bid on /me/upgrades, and the
// ears / wrists / rings pairing (the guild lead, 2026-10-26). The bot half is test/web-wishlist-bot.test.js.
//
// The website never holds the bid key: its server actions hand the request to the bot. What can go wrong without
// anyone noticing, and what these tests pin by running the real modules:
//   * the site and the bot disagree by a byte on the ticket, or on what a priority or a bid may be;
//   * a member changes a character that is not theirs, on the site's check (the bot re-checks; both are tested);
//   * a bid is encrypted, stored or logged on the site;
//   * the grouping drops, doubles or reorders a slot.
// The web actions are driven end to end: a stubbed fetch hands the site's request to the REAL bot handler, over a
// fake PostgREST, with the real bidCrypto. Text checks strip comments first (stripJs).
//
// Run: npx vitest run test/web-wishlist.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { makeDb } from './_wishlist_fake.js';
import { signScreenTicket, verifyScreenTicket, WISHLIST_AUD, WISHLIST_TTL_S } from '../web/lib/screenTicket.ts';
import * as webRules from '../web/lib/wishlistRules.ts';
import { groupPairedSlots, SLOT_PAIRS, UPGRADE_SLOTS } from '../web/lib/gearUpgrades.ts';
import { WORN_SLOTS } from '../web/lib/clicky-macros.ts';

const require = createRequire(import.meta.url);
const jsTicket = require('../utils/screenTicket.js');
const botRules = require('../utils/wishlistRules.js');
const bidCrypto = require('../utils/bidCrypto.js');
const webWishlist = require('../utils/webWishlist.js');

// ── What the site's modules import through the alias ────────────────────────
const st = { user: null, owned: {} };
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }),
}));
vi.mock('@/lib/ownedCharacters', () => ({ ownedCharacters: async (id) => st.owned[id] ?? [] }));
vi.mock('@/lib/screenTicket', async () => await import('../web/lib/screenTicket.ts'));
vi.mock('@/lib/wishlistRules', async () => await import('../web/lib/wishlistRules.ts'));
vi.mock('@/lib/wishlistBot', async () => await import('../web/lib/wishlistBot.ts'));
const revalidated = [];
// `next/cache` resolves differently by machine (CI installs only the root dependencies): register both ids.
const nextCache = { revalidatePath: (p) => { revalidated.push(p); } };
vi.doMock('next/cache', () => nextCache);
try {
  vi.doMock(createRequire(new URL('../web/package.json', import.meta.url)).resolve('next/cache'), () => nextCache);
} catch { /* web/ not installed here */ }

const actions = await import('../web/app/me/upgrades/actions.ts');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SECRET = 'wishlist-test-secret-not-a-real-one';
const KEY = '0123456789abcdef'.repeat(4);            // 64 hex chars
const BOT = 'https://bot.example.test';

let fake;
const ENV_KEYS = ['SCREEN_TOKEN_SECRET', 'SCREEN_LIVE_URL', 'WISHLIST_BID_KEY'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.SCREEN_TOKEN_SECRET = SECRET;
  process.env.SCREEN_LIVE_URL = `${BOT}/api/screen/live`;
  process.env.WISHLIST_BID_KEY = KEY;
  fake = makeDb();
  webWishlist._setDeps({ supabase: fake.sb });
  st.user = null; st.owned = {}; revalidated.length = 0;
});
afterEach(() => {
  webWishlist._reset();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const rowOf = (name, item) => fake.db.wishlists.find(r => r.character_name === name && r.item_id === item);

describe('the limits are one set of numbers', () => {
  it('the site\'s copy agrees with the bot\'s on every limit and on a spread of inputs', () => {
    for (const k of ['PRIORITY_MIN', 'PRIORITY_MAX', 'PRIORITY_DEFAULT', 'BID_MIN', 'BID_MAX']) expect(webRules[k], k).toBe(botRules[k]);
    const samples = [undefined, null, 0, 1, 2, 5, 10, 11, 49999, 50000, 50001, -1, 1.5, '5', NaN, Infinity, true, {}];
    for (const v of samples) {
      expect(webRules.parseBid(v).ok, `bid ${String(v)}`).toBe(botRules.parseBid(v).ok);
      expect(webRules.parsePriority(v).ok, `priority ${String(v)}`).toBe(botRules.parsePriority(v).ok);
      if (botRules.parseBid(v).ok) expect(webRules.parseBid(v).value).toBe(botRules.parseBid(v).value);
    }
  });

  it('a form field becomes a bid the way a person means it', () => {
    expect(webRules.bidFromField('')).toBeNull();
    expect(webRules.bidFromField('  ')).toBeNull();
    expect(webRules.bidFromField(' 450 ')).toBe(450);
    for (const bad of ['4.5', '-3', '1e3', 'abc', '12 34']) expect(webRules.parseBid(webRules.bidFromField(bad)).ok, bad).toBe(false);
  });
});

describe('the ticket the site signs for the bot', () => {
  it('is the same bytes on both sides, lives a minute, and is addressed to the wishlist', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const a = signScreenTicket('user-1', { secret: SECRET, nowMs: now, aud: WISHLIST_AUD, ttlS: WISHLIST_TTL_S });
    const b = jsTicket.sign('user-1', { secret: SECRET, nowMs: now, aud: jsTicket.WISHLIST_AUD, ttlS: jsTicket.WISHLIST_TTL_S });
    expect(a.token).toBe(b.token);
    expect(WISHLIST_TTL_S).toBe(60);
    expect(a.exp - Math.floor(now / 1000)).toBe(60);
    expect(verifyScreenTicket(a.token, { secret: SECRET, nowMs: now, aud: WISHLIST_AUD }).ok).toBe(true);
    expect(verifyScreenTicket(a.token, { secret: SECRET, nowMs: now })).toEqual({ ok: false, reason: 'wrong-audience' });
    expect(verifyScreenTicket(a.token, { secret: SECRET, nowMs: now + 5 * 60_000, aud: WISHLIST_AUD })).toEqual({ ok: false, reason: 'expired' });
  });
});

// ── The site's server actions, end to end through the real bot handler ──────

function wireFetchToBot() {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url, init });
    const req = Readable.from([Buffer.from(init.body)]);
    req.method = init.method; req.headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const out = { status: 0, text: '' };
    const res = { writeHead(s) { out.status = s; }, end(b) { out.text = b || ''; } };
    await webWishlist.handle(req, res);
    return new Response(out.text, { status: out.status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}
const signIn = (id, names) => { st.user = { id }; st.owned[id] = names.map(name => ({ name })); };

describe('the site\'s wishlist actions', () => {
  it('add -> setPreBid -> remove works end to end, and the bid is only ever sealed in the database', async () => {
    const calls = wireFetchToBot();
    signIn('u-alice', ['Aldenmar', 'Brackwyn']);
    expect(await actions.addToWishlist('aldenmar', 1001, 3, 600)).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${BOT}/api/web/wishlist`);
    expect(bidCrypto.decryptBid(rowOf('Aldenmar', 1001).bid_amount_enc)).toBe(600);
    expect(rowOf('Aldenmar', 1001).bid_amount).toBeNull();
    expect(await actions.setPreBid('Aldenmar', 1001, 750)).toEqual({ ok: true });
    expect(bidCrypto.decryptBid(rowOf('Aldenmar', 1001).bid_amount_enc)).toBe(750);
    expect(await actions.setPreBid('Aldenmar', 1001, null)).toEqual({ ok: true });
    expect(rowOf('Aldenmar', 1001).bid_amount_enc).toBeNull();
    expect(await actions.removeFromWishlist('Aldenmar', 1001)).toEqual({ ok: true });
    expect(rowOf('Aldenmar', 1001)).toBeUndefined();
    expect(revalidated).toEqual(Array(4).fill('/me/upgrades'));
  });

  it('what the site sends is a 60-second wishlist ticket for the signed-in user, never a screen ticket', async () => {
    const calls = wireFetchToBot();
    signIn('u-alice', ['Aldenmar']);
    await actions.addToWishlist('Aldenmar', 1001, null, null);
    const token = calls[0].init.headers.Authorization.replace('Bearer ', '');
    const v = jsTicket.verify(token, { aud: 'wishlist' });
    expect(v.ok).toBe(true);
    expect(v.sub).toBe('u-alice');
    expect(v.exp - v.iat).toBe(60);
    expect(jsTicket.verify(token).ok).toBe(false);
    expect(rowOf('Aldenmar', 1001).priority).toBe(5);
  });

  it('refuses before calling the bot: signed out, not your character, bad name, bad numbers', async () => {
    const calls = wireFetchToBot();
    expect((await actions.addToWishlist('Aldenmar', 1001, 5, 10)).ok).toBe(false);          // signed out
    signIn('u-bob', ['Corvale']);
    expect((await actions.addToWishlist('Aldenmar', 1001, 5, 10)).ok).toBe(false);          // not Bob's
    expect((await actions.setPreBid('Aldenmar', 1001, 10)).ok).toBe(false);
    expect((await actions.removeFromWishlist('Aldenmar', 1001)).ok).toBe(false);
    expect((await actions.addToWishlist("Corvale'--", 1001, 5, 10)).ok).toBe(false);
    expect((await actions.addToWishlist('Corvale', -1, 5, 10)).ok).toBe(false);
    expect((await actions.addToWishlist('Corvale', 1001, 11, 10)).ok).toBe(false);
    expect((await actions.addToWishlist('Corvale', 1001, 5, 0)).ok).toBe(false);
    expect((await actions.setPreBid('Corvale', 1001, 50001)).ok).toBe(false);
    expect(calls).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it('if the site wrongly thought a character was yours, the bot still says no', async () => {
    const calls = wireFetchToBot();
    signIn('u-bob', ['Corvale', 'Aldenmar']);                 // the site's own list is wrong
    const r = await actions.addToWishlist('Aldenmar', 1001, 5, 10);
    expect(calls.length).toBe(1);
    expect(r).toEqual({ ok: false, error: 'not your character' });
    expect(fake.db.wishlists).toEqual([]);
  });

  it('shows the bot\'s reason for a refusal, and nothing revalidates', async () => {
    wireFetchToBot();
    signIn('u-alice', ['Aldenmar']);
    await actions.addToWishlist('Aldenmar', 1001, 5, null);
    expect(await actions.addToWishlist('Aldenmar', 1001, 5, null)).toEqual({ ok: false, error: 'already on the wishlist' });
    delete process.env.WISHLIST_BID_KEY;
    const r = await actions.setPreBid('Aldenmar', 1001, 40);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/encryption is not available/);
    expect(revalidated.length).toBe(1);
  });

  it('says so, without throwing, when the bot cannot be reached or the site is not wired to it', async () => {
    signIn('u-alice', ['Aldenmar']);
    vi.stubGlobal('fetch', async () => { throw new Error('connect ECONNREFUSED'); });
    const down = await actions.addToWishlist('Aldenmar', 1001, 5, 10);
    expect(down.ok).toBe(false);
    expect(down.error).toMatch(/reach the bot/);
    delete process.env.SCREEN_LIVE_URL;
    const off = await actions.addToWishlist('Aldenmar', 1001, 5, 10);
    expect(off).toEqual({ ok: false, error: 'The wishlist is not switched on for the website yet.' });
  });

  it('only talks to an https bot (or localhost): the ticket is a bearer', async () => {
    const { botOrigin, wishlistWritesEnabled } = await import('../web/lib/wishlistBot.ts');
    process.env.SCREEN_LIVE_URL = 'http://bot.example.test/api/screen/live';
    expect(botOrigin()).toBeNull();
    process.env.SCREEN_LIVE_URL = 'https://user:pw@bot.example.test/x';
    expect(botOrigin()).toBeNull();
    process.env.SCREEN_LIVE_URL = 'http://localhost:3000/api/screen/live';
    expect(botOrigin()).toBe('http://localhost:3000');
    process.env.SCREEN_LIVE_URL = `${BOT}/api/screen/live`;
    expect(wishlistWritesEnabled()).toBe(true);
    delete process.env.SCREEN_TOKEN_SECRET;
    expect(wishlistWritesEnabled()).toBe(false);
  });
});

describe('the site never touches a bid itself', () => {
  const strip = (rel) => stripJs(read(rel));
  it('the action and the bot client hold no key, no cipher, no bid column and no database client', () => {
    for (const rel of ['web/app/me/upgrades/actions.ts', 'web/lib/wishlistBot.ts', 'web/components/WishlistControls.tsx']) {
      const src = strip(rel);
      expect(src, rel).not.toMatch(/WISHLIST_BID_KEY|createCipheriv|createDecipheriv|bid_amount|supabaseAdmin|from\('wishlists'\)/);
    }
  });
  it('the page still never selects a bid column, and gets pre-bids only through the bot', () => {
    expect(strip('web/lib/gearUpgradesLoad.ts')).not.toMatch(/bid_amount/);
    const page = strip('web/app/me/upgrades/page.tsx');
    expect(page).not.toMatch(/bid_amount/);
    expect(page).toMatch(/callBotWishlist/);
  });
});

// ── Ears, wrists and rings together ─────────────────────────────────────────

describe('interchangeable slots are shown as pairs', () => {
  const rows = UPGRADE_SLOTS.map(s => ({ slot: s.name }));
  const groups = groupPairedSlots(rows, r => r.slot);
  const shape = groups.map(g => g.title ? `${g.title}[${g.items.map(i => i.slot).join('+')}]` : g.items[0].slot);

  it('puts Ear1+Ear2, Wrist1+Wrist2 and Fingers1+Fingers2 under one heading each, where the first of the pair sat', () => {
    expect(shape.slice(0, 5)).toEqual(['Ears[Ear1+Ear2]', 'Head', 'Face', 'Neck', 'Shoulders']);
    expect(shape).toContain('Wrists[Wrist1+Wrist2]');
    expect(shape).toContain('Fingers[Fingers1+Fingers2]');
    expect(shape.indexOf('Back')).toBe(shape.indexOf('Wrists[Wrist1+Wrist2]') - 1);
    expect(shape.indexOf('Secondary')).toBe(shape.indexOf('Fingers[Fingers1+Fingers2]') - 1);
  });

  it('loses and repeats nothing, and leaves every other slot in its order', () => {
    const flat = groups.flatMap(g => g.items.map(i => i.slot));
    expect(flat.slice().sort()).toEqual(UPGRADE_SLOTS.map(s => s.name).sort());
    const paired = new Set(SLOT_PAIRS.flatMap(p => p.slots));
    expect(flat.filter(s => !paired.has(s))).toEqual(UPGRADE_SLOTS.map(s => s.name).filter(s => !paired.has(s)));
    expect(groups.filter(g => g.title).every(g => g.items.length === 2)).toBe(true);
  });

  it('keeps the pair in Ear1, Ear2 order even if the rows arrive the other way round, and does not mutate its input', () => {
    const swapped = [{ slot: 'Ear2' }, { slot: 'Head' }, { slot: 'Ear1' }];
    const copy = JSON.stringify(swapped);
    const g = groupPairedSlots(swapped, r => r.slot);
    expect(g.map(x => x.title ? x.items.map(i => i.slot).join('+') : x.items[0].slot)).toEqual(['Ear1+Ear2', 'Head']);
    expect(JSON.stringify(swapped)).toBe(copy);
  });

  it('a pair with only one slot present is left as a plain row', () => {
    const g = groupPairedSlots([{ slot: 'Ear1' }, { slot: 'Head' }], r => r.slot);
    expect(g.map(x => x.title)).toEqual([null, null]);
  });

  it('WORN_SLOTS itself is untouched (clicky macros read its bit order)', () => {
    expect(WORN_SLOTS.slice(0, 4).map(s => s.name)).toEqual(['Ear1', 'Head', 'Face', 'Ear2']);
  });

  it('the page lays a pair out as one card per slot, stacked on a phone and side by side from md up', () => {
    const page = stripJs(read('web/app/me/upgrades/page.tsx'));
    expect(page).toMatch(/groupPairedSlots\(perSlot, p => p\.r\.slot\)/);
    expect(page).toMatch(/grid gap-3 md:grid-cols-2/);
  });
});
