// test/web-wishlist-bot.test.js — the bot half of "add to wishlist" + sealed pre-bid on /me/upgrades
// (the guild lead, 2026-10-26). Self-contained: it needs nothing from web/, so the bot commit can reach `main`
// on its own. The site half is test/web-wishlist.test.js.
//
// The website must never hold the bid key or write a plaintext bid, so it asks the bot (POST /api/web/wishlist,
// utils/webWishlist.js), which encrypts with WISHLIST_BID_KEY. What can go wrong without anyone noticing:
//   * a bid reaches the database in the clear, or an unset key quietly stores NOTHING while telling the member it saved;
//   * a member changes (or reads the bid of) a character that is not theirs;
//   * a screen ticket (which reaches browsers) opens a write, or a stale / forged / wrongly-addressed ticket does;
//   * the bot and Discord disagree on what a priority or a bid may be.
// These tests run the real handler over a fake PostgREST (test/_wishlist_fake.js) with the real bidCrypto.
//
// Run: npx vitest run test/web-wishlist-bot.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { makeDb, callBotWith } from './_wishlist_fake.js';

const require = createRequire(import.meta.url);
const jsTicket = require('../utils/screenTicket.js');
const botRules = require('../utils/wishlistRules.js');
const bidCrypto = require('../utils/bidCrypto.js');
const webWishlist = require('../utils/webWishlist.js');

const SECRET = 'wishlist-test-secret-not-a-real-one';
const KEY = '0123456789abcdef'.repeat(4);            // 64 hex chars
const callBot = (body, o) => callBotWith(webWishlist, body, o);
const ticketFor = (sub, over = {}) => jsTicket.sign(sub, { aud: jsTicket.WISHLIST_AUD, ttlS: jsTicket.WISHLIST_TTL_S, ...over }).token;

let fake;
const ENV_KEYS = ['SCREEN_TOKEN_SECRET', 'WISHLIST_BID_KEY'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.SCREEN_TOKEN_SECRET = SECRET;
  process.env.WISHLIST_BID_KEY = KEY;
  fake = makeDb();
  webWishlist._setDeps({ supabase: fake.sb });
});
afterEach(() => {
  webWishlist._reset();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const rowOf = (name, item) => fake.db.wishlists.find(r => r.character_name === name && r.item_id === item);

describe('POST /api/web/wishlist: who may call it', () => {
  it('refuses no ticket, a forged one, an expired one, and a screen ticket', async () => {
    const body = { op: 'list', character: 'Aldenmar' };
    expect((await callBot(body)).status).toBe(401);
    expect((await callBot(body, { token: 'v1.abc.def' })).status).toBe(401);
    expect((await callBot(body, { token: ticketFor('u-alice', { secret: 'another-secret' }) })).status).toBe(401);
    expect((await callBot(body, { token: ticketFor('u-alice', { nowMs: Date.now() - 10 * 60_000 }) })).status).toBe(401);
    // A screen ticket is handed to browsers for two hours; it must not open a write.
    const screen = jsTicket.sign('u-alice');
    expect((await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, bid: 500 }, { token: screen.token })).status).toBe(401);
    expect(fake.sb.writes).toEqual([]);
  });

  it('is off (503) while SCREEN_TOKEN_SECRET is unset, never "open"', async () => {
    const token = ticketFor('u-alice');
    delete process.env.SCREEN_TOKEN_SECRET;
    expect((await callBot({ op: 'list', character: 'Aldenmar' }, { token })).status).toBe(503);
  });

  it('a wishlist ticket does not open the screen feed either, and lives a minute', () => {
    const t = ticketFor('u-alice');
    expect(jsTicket.verify(t)).toEqual({ ok: false, reason: 'wrong-audience' });
    const v = jsTicket.verify(t, { aud: 'wishlist' });
    expect(v.ok).toBe(true);
    expect(v.exp - v.iat).toBe(60);
  });

  it('only POST, a small JSON object, a known op, a plain character name', async () => {
    const token = ticketFor('u-alice');
    expect((await callBot({}, { token, method: 'GET' })).status).toBe(405);
    expect((await callBot(null, { token, raw: 'not json' })).status).toBe(400);
    expect((await callBot(null, { token, raw: '[1]' })).status).toBe(400);
    expect((await callBot(null, { token, raw: JSON.stringify({ op: 'list', character: 'Aldenmar', pad: 'x'.repeat(3000) }) })).status).toBe(413);
    expect((await callBot({ op: 'drop', character: 'Aldenmar' }, { token })).status).toBe(400);
    expect((await callBot({ op: 'list', character: "Al%'; drop" }, { token })).status).toBe(400);
    expect((await callBot({ op: 'list', character: 'A*' }, { token })).status).toBe(400);
  });

  it('is routed in index.js', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
    expect(src).toMatch(/req\.url === '\/api\/web\/wishlist'[\s\S]{0,200}webWishlist/);
  });
});

describe('POST /api/web/wishlist: ownership is re-checked on the bot', () => {
  it('a member can use their own character, an alt in the family, and one on a merged Discord account', async () => {
    for (const [sub, ch] of [['u-alice', 'Aldenmar'], ['u-alice', 'Brackwyn'], ['u-alice', 'Zarrin'], ['u-alt', 'Aldenmar'], ['u-bob', 'Corvale']]) {
      const r = await callBot({ op: 'list', character: ch }, { token: ticketFor(sub) });
      expect(r.status, `${sub} -> ${ch}`).toBe(200);
    }
  });

  it('refuses another member\'s character, an unknown name, and a user with no membership: nothing read, nothing written', async () => {
    fake.db.wishlists.push({ character_name: 'Corvale', item_id: 1001, priority: 3, bid_amount: null, bid_amount_enc: bidCrypto.encryptBid(777) });
    for (const [sub, ch] of [['u-alice', 'Corvale'], ['u-bob', 'Aldenmar'], ['u-bob', 'Brackwyn'], ['u-alice', 'Nobodyhere'], ['u-ghost', 'Aldenmar']]) {
      for (const op of ['list', 'add', 'setbid', 'remove']) {
        const r = await callBot({ op, character: ch, item_id: 1001, bid: 5 }, { token: ticketFor(sub) });
        expect(r.status, `${sub} ${op} ${ch}`).toBe(403);
        expect(JSON.stringify(r.body)).not.toMatch(/777/);
      }
    }
    expect(fake.sb.writes).toEqual([]);
    expect(rowOf('Corvale', 1001).priority).toBe(3);
  });

  it('a lookup failure is a 503 (try again), not a 403 that reads as "not yours"', async () => {
    webWishlist._setDeps({ supabase: { ...fake.sb, select: async () => null } });
    expect((await callBot({ op: 'list', character: 'Aldenmar' }, { token: ticketFor('u-alice') })).status).toBe(503);
  });
});

describe('POST /api/web/wishlist: the bid stays sealed', () => {
  it('add stores only the AES-GCM ciphertext: it decrypts to the bid, and no column holds the number', async () => {
    const r = await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, priority: 2, bid: 48731 }, { token: ticketFor('u-alice') });
    expect(r.status).toBe(200);
    const row = rowOf('Aldenmar', 1001);
    expect(row.priority).toBe(2);
    expect(row.bid_amount).toBeNull();
    expect(Object.values(row).some(v => v === 48731 || v === '48731')).toBe(false);
    expect(row.bid_amount_enc).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(bidCrypto.decryptBid(row.bid_amount_enc)).toBe(48731);
    // a wrong key cannot read it back
    process.env.WISHLIST_BID_KEY = 'f'.repeat(64);
    expect(bidCrypto.decryptBid(row.bid_amount_enc)).toBeNull();
  });

  it('two identical bids are different ciphertexts (a fresh IV each write)', async () => {
    await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, bid: 100 }, { token: ticketFor('u-alice') });
    await callBot({ op: 'add', character: 'Aldenmar', item_id: 1002, bid: 100 }, { token: ticketFor('u-alice') });
    expect(rowOf('Aldenmar', 1001).bid_amount_enc).not.toBe(rowOf('Aldenmar', 1002).bid_amount_enc);
  });

  it('with no WISHLIST_BID_KEY a bid is REFUSED (503), not dropped; a bid-less add still works', async () => {
    delete process.env.WISHLIST_BID_KEY;
    const refused = await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, bid: 300 }, { token: ticketFor('u-alice') });
    expect(refused.status).toBe(503);
    expect(refused.body.error).toMatch(/encryption is not available/);
    expect(fake.sb.writes).toEqual([]);
    const ok = await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001 }, { token: ticketFor('u-alice') });
    expect(ok.status).toBe(200);
    expect(rowOf('Aldenmar', 1001).bid_amount_enc).toBeNull();
  });

  it('list gives the owner their OWN decrypted bids, and says whether bids can be saved', async () => {
    await callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, priority: 1, bid: 450 }, { token: ticketFor('u-alice') });
    await callBot({ op: 'add', character: 'Aldenmar', item_id: 1002 }, { token: ticketFor('u-alice') });
    await callBot({ op: 'add', character: 'Corvale', item_id: 1001, bid: 9999 }, { token: ticketFor('u-bob') });
    const r = await callBot({ op: 'list', character: 'Aldenmar' }, { token: ticketFor('u-alice') });
    expect(r.body.bids_enabled).toBe(true);
    expect(r.body.items.sort((a, b) => a.item_id - b.item_id)).toEqual([
      { item_id: 1001, priority: 1, bid: 450 },
      { item_id: 1002, priority: 5, bid: null },
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/9999/);
  });
});

describe('POST /api/web/wishlist: the same rules as /wishlist add', () => {
  const add = (extra) => callBot({ op: 'add', character: 'Aldenmar', item_id: 1001, ...extra }, { token: ticketFor('u-alice') });

  it('bids are whole DKP from 1 to 50000', async () => {
    for (const bid of [0, -5, 50001, 1.5, '50', true, {}]) {
      expect((await add({ bid })).status, `bid ${JSON.stringify(bid)}`).toBe(400);
    }
    expect(fake.sb.writes).toEqual([]);
    expect((await add({ bid: 1 })).status).toBe(200);
    fake.db.wishlists.length = 0;
    expect((await add({ bid: 50000 })).status).toBe(200);
  });

  it('priority is 1 to 10, default 5', async () => {
    for (const priority of [0, 11, 2.5, '3']) expect((await add({ priority })).status, `priority ${priority}`).toBe(400);
    expect((await add({})).status).toBe(200);
    expect(rowOf('Aldenmar', 1001).priority).toBe(5);
  });

  it('an item that does not exist is 404, a listed one is 409 and keeps its bid and priority', async () => {
    expect((await callBot({ op: 'add', character: 'Aldenmar', item_id: 424242 }, { token: ticketFor('u-alice') })).status).toBe(404);
    expect((await callBot({ op: 'add', character: 'Aldenmar', item_id: 'x' }, { token: ticketFor('u-alice') })).status).toBe(400);
    await add({ priority: 1, bid: 250 });
    const again = await add({ priority: 9 });
    expect(again.status).toBe(409);
    expect(rowOf('Aldenmar', 1001).priority).toBe(1);
    expect(bidCrypto.decryptBid(rowOf('Aldenmar', 1001).bid_amount_enc)).toBe(250);
  });

  it('setbid changes and clears the bid on a listed item, and 404s on one that is not listed', async () => {
    const t = ticketFor('u-alice');
    expect((await callBot({ op: 'setbid', character: 'Aldenmar', item_id: 1001, bid: 10 }, { token: t })).status).toBe(404);
    await add({ priority: 4, bid: 250 });
    expect((await callBot({ op: 'setbid', character: 'Aldenmar', item_id: 1001, bid: 900 }, { token: t })).status).toBe(200);
    expect(bidCrypto.decryptBid(rowOf('Aldenmar', 1001).bid_amount_enc)).toBe(900);
    expect(rowOf('Aldenmar', 1001).priority).toBe(4);
    expect((await callBot({ op: 'setbid', character: 'Aldenmar', item_id: 1001, bid: 0 }, { token: t })).status).toBe(400);
    expect((await callBot({ op: 'setbid', character: 'Aldenmar', item_id: 1001, bid: null }, { token: t })).status).toBe(200);
    expect(rowOf('Aldenmar', 1001).bid_amount_enc).toBeNull();
  });

  it('remove takes it off, and only that item on that character', async () => {
    await add({});
    await callBot({ op: 'add', character: 'Aldenmar', item_id: 1002 }, { token: ticketFor('u-alice') });
    await callBot({ op: 'add', character: 'Corvale', item_id: 1001 }, { token: ticketFor('u-bob') });
    expect((await callBot({ op: 'remove', character: 'Aldenmar', item_id: 1001 }, { token: ticketFor('u-alice') })).status).toBe(200);
    expect(rowOf('Aldenmar', 1001)).toBeUndefined();
    expect(rowOf('Aldenmar', 1002)).toBeDefined();
    expect(rowOf('Corvale', 1001)).toBeDefined();
  });

  it('the Discord command is built from the same numbers (utils/wishlistRules.js)', () => {
    const opts = require('../commands/wishlist.js').data.toJSON().options.find(o => o.name === 'add').options;
    const by = Object.fromEntries(opts.map(o => [o.name, o]));
    expect([by.bid_amount.min_value, by.bid_amount.max_value]).toEqual([botRules.BID_MIN, botRules.BID_MAX]);
    expect([by.priority.min_value, by.priority.max_value]).toEqual([botRules.PRIORITY_MIN, botRules.PRIORITY_MAX]);
    expect(by.note.max_length).toBe(botRules.NOTE_MAX);
    expect(botRules.PRIORITY_DEFAULT).toBe(5);
    expect([botRules.BID_MIN, botRules.BID_MAX, botRules.PRIORITY_MIN, botRules.PRIORITY_MAX]).toEqual([1, 50000, 1, 10]);
  });
});
