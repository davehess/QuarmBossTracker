// utils/webWishlist.js — POST /api/web/wishlist: the website's "add to wishlist" and pre-bid on /me/upgrades.
//
// WHY THE BOT AND NOT THE WEBSITE
// A wishlist bid is sealed: AES-256-GCM under WISHLIST_BID_KEY, a key that lives only in the bot's environment
// (utils/bidCrypto.js), and the encrypted column is service-role-only. The website must never hold that key or
// write a plaintext bid, so it asks the bot, which encrypts on its side. The plaintext bid crosses the wire once
// (Vercel -> bot, TLS) and is never stored anywhere in the clear; a bid read back for its owner is decrypted
// here and goes only to that owner's own signed-in request.
//
// AUTH: Bearer = a wishlist ticket (utils/screenTicket.js, audience 'wishlist', 60 s, HMAC with
// SCREEN_TOKEN_SECRET, the secret /screen already shares between Vercel and the bot). The website signs one per
// action from the member's Supabase session, server to server; it never reaches a browser. `sub` is the
// Supabase user id. OWNERSHIP IS RE-DERIVED HERE from that id (the same household + OpenDKP family rule as
// web/lib/ownedCharacters.ts), so a ticket for one member cannot touch another member's character even if the
// website were asked to.
//
// BODY (JSON, 2 KB max): { op, character, item_id?, priority?, bid? }
//   op 'list'   -> { ok, bids_enabled, items: [{ item_id, priority, bid }] }   the owner's own bids, decrypted
//   op 'add'    -> item_id, priority (default 5), bid (optional)  409 if already listed
//   op 'setbid' -> item_id, bid (null clears it: the bot then places 1 DKP)      404 if not listed
//   op 'remove' -> item_id
// Limits are utils/wishlistRules.js (the Discord command's own). A bid with no WISHLIST_BID_KEY is REFUSED (503),
// where /wishlist add would quietly store nothing: a web user must be told their bid did not save.

'use strict';

const screenTicket = require('./screenTicket');
const { bearerOf } = require('./serviceKey');
const { encryptBid, decryptBid, isEncryptionEnabled } = require('./bidCrypto');
const rules = require('./wishlistRules');

const MAX_BODY = 2048;
const NAME_RE = /^[A-Za-z]{2,}$/;     // a character name; also what makes the ilike below wildcard-free
const OPS = new Set(['list', 'add', 'setbid', 'remove']);

let _deps = {};
const _sb = () => _deps.supabase || require('./supabase');
const _clock = () => (typeof _deps.now === 'function' ? _deps.now() : Date.now());
const _enc = encodeURIComponent;
function _setDeps(d = {}) { _deps = { ..._deps, ...d }; }
function _reset() { _deps = {}; }

/**
 * The canonical name of `character` if the Supabase user `sub` owns it, else null. `undefined` means a read
 * failed (the caller answers 503, not 403). Same rule as web/lib/ownedCharacters.ts: the member's household
 * (their own Discord id, the root they were merged into, and everyone merged into that root) anchors characters;
 * the family (main_name || name) of an anchored character is owned.
 */
async function ownedCharacterName(sb, sub, character) {
  const gid = _enc(sb.guildId());
  const member = await sb.select('wolfpack_members', `user_id=eq.${_enc(sub)}&select=discord_id,merged_into_discord_id&limit=1`);
  if (!Array.isArray(member)) return undefined;
  const pack = member[0];
  if (!pack || !pack.discord_id) return null;

  const root = pack.merged_into_discord_id || pack.discord_id;
  const aliases = await sb.select('wolfpack_members',
    `or=(discord_id.eq.${_enc(root)},merged_into_discord_id.eq.${_enc(root)})&select=discord_id&limit=200`);
  if (!Array.isArray(aliases)) return undefined;
  const household = new Set([pack.discord_id, root, ...aliases.map(a => a.discord_id).filter(Boolean)]);

  const target = await sb.select('characters', `guild_id=eq.${gid}&name=ilike.${_enc(character)}&select=name,main_name&limit=1`);
  if (!Array.isArray(target)) return undefined;
  if (!target[0]) return null;
  const targetRoot = String(target[0].main_name || target[0].name).toLowerCase();

  const ids = [...household].map(_enc).join(',');
  const anchored = await sb.select('characters', `guild_id=eq.${gid}&discord_id=in.(${ids})&select=name,main_name&limit=1000`);
  if (!Array.isArray(anchored)) return undefined;
  const owned = anchored.some(c => String(c.main_name || c.name).toLowerCase() === targetRoot);
  return owned ? target[0].name : null;
}

async function _readBody(req) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) return { tooBig: true };
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : { bad: true };
  } catch { return { bad: true }; }
}

/** Answers every path itself; index.js only routes here and catches a throw. */
async function handle(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' });

  if (!process.env.SCREEN_TOKEN_SECRET) return send(503, { error: 'web wishlist not configured' });
  const check = screenTicket.verify(bearerOf(req), { nowMs: _clock(), aud: screenTicket.WISHLIST_AUD });
  if (!check.ok) return send(401, { error: 'unauthorized' });

  const sb = _sb();
  if (!sb.isEnabled()) return send(503, { error: 'wishlists need the database' });

  const got = await _readBody(req);
  if (got.tooBig) return send(413, { error: 'body too large' });
  if (got.bad) return send(400, { error: 'invalid JSON' });
  const b = got.body;

  const op = String(b.op || '');
  if (!OPS.has(op)) return send(400, { error: 'unknown op' });
  const character = typeof b.character === 'string' ? b.character.trim() : '';
  if (!NAME_RE.test(character)) return send(400, { error: 'character name required' });

  // Everything below is the owner's own character: proven here, not trusted from the website.
  const name = await ownedCharacterName(sb, check.sub, character);
  if (name === undefined) return send(503, { error: 'lookup failed, try again' });
  if (name === null) return send(403, { error: 'not your character' });
  const mine = `character_name=eq.${_enc(name)}`;

  if (op === 'list') {
    const rows = await sb.select('wishlists', `${mine}&select=item_id,priority,bid_amount_enc,bid_amount&limit=1000`);
    if (!Array.isArray(rows)) return send(503, { error: 'lookup failed, try again' });
    // The owner's own sealed bid, decrypted (the same read /wishlist show and /mywishlist give them).
    const items = rows.map(r => ({ item_id: r.item_id, priority: r.priority, bid: decryptBid(r.bid_amount_enc) ?? r.bid_amount ?? null }));
    return send(200, { ok: true, bids_enabled: isEncryptionEnabled(), items });
  }

  const itemId = b.item_id;
  if (!Number.isInteger(itemId) || itemId <= 0) return send(400, { error: 'item_id required' });
  const where = `${mine}&item_id=eq.${itemId}`;

  if (op === 'remove') {
    await sb.del('wishlists', where);          // best-effort and idempotent, like /wishlist remove
    return send(200, { ok: true });
  }

  const bid = rules.parseBid(b.bid);
  if (!bid.ok) return send(400, { error: bid.error });
  if (bid.value !== null && !isEncryptionEnabled()) {
    return send(503, { error: 'bid encryption is not available, so the bid was not saved' });
  }
  const bidEnc = encryptBid(bid.value);        // null when there is no bid

  const existing = await sb.select('wishlists', `${where}&select=item_id&limit=1`);
  if (!Array.isArray(existing)) return send(503, { error: 'lookup failed, try again' });

  if (op === 'setbid') {
    if (!existing[0]) return send(404, { error: 'not on the wishlist' });
    // The plaintext column is deprecated and always null (migration 20260525150000).
    const out = await sb.update('wishlists', where, { bid_amount: null, bid_amount_enc: bidEnc });
    if (!Array.isArray(out)) return send(502, { error: 'could not save' });
    return send(200, { ok: true, bid: bid.value });
  }

  // op === 'add'
  if (existing[0]) return send(409, { error: 'already on the wishlist' });
  const prio = rules.parsePriority(b.priority);
  if (!prio.ok) return send(400, { error: prio.error });
  const known = await sb.select('eqemu_items', `id=eq.${itemId}&select=id&limit=1`);
  if (!Array.isArray(known)) return send(503, { error: 'lookup failed, try again' });
  if (!known[0]) return send(404, { error: 'unknown item' });
  const out = await sb.insert('wishlists', [{
    character_name: name, item_id: itemId, bid_amount: null, bid_amount_enc: bidEnc,
    priority: prio.value, note: null, source: 'manual', source_url: null,
  }]);
  if (!Array.isArray(out)) return send(502, { error: 'could not save' });
  return send(200, { ok: true, priority: prio.value, bid: bid.value });
}

module.exports = { handle, ownedCharacterName, _setDeps, _reset };
