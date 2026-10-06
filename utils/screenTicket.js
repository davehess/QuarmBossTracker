// utils/screenTicket.js — the "screen ticket": a short-lived HMAC bearer that lets a signed-in member's browser
// read /api/screen/live straight from the bot.
//
// WHY IT EXISTS
// wolfpack.quest/screen is read by ~60 raiders for a whole raid, and its 3-second reads used to go through
// Vercel (a function call per poll on a plan with a monthly invocation cap). The bot holds every raider's
// latest position in memory (flat compute, metered egress), so the browser asks the bot instead. The bot has no Supabase
// session to check, so Vercel (which does) vouches for the member by signing a ticket with a secret both
// sides hold (SCREEN_TOKEN_SECRET); the bot only has to verify the signature.
//
// The twin is web/lib/screenTicket.ts. The two must produce and accept exactly the same bytes —
// test/screen-live.test.js signs on one side and verifies on the other, both ways.
//
//   v1.<b64url(JSON {sub, aud:'screen', iat, exp})>.<b64url(HMAC-SHA256(secret, 'v1.' + payloadB64))>
//
// sub = the Supabase user id, iat / exp = seconds since the epoch. A ticket is good for TTL_S and is never
// revoked inside that window (it opens one read-only, member-level feed).
//
// A missing secret is "no tickets", never "any ticket": verify() fails closed.

'use strict';

const crypto = require('node:crypto');

const VERSION = 'v1';
const AUD = 'screen';
const TTL_S = 2 * 60 * 60;          // a ticket lives two hours; the page renews it before then
const MAX_TTL_S = 24 * 60 * 60;     // a ticket claiming a longer life than this is not one we minted
const SKEW_S = 60;                  // clock drift allowed between Vercel and the bot, both directions

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const secretOf = (opts) => {
  const s = opts && opts.secret !== undefined ? opts.secret : process.env.SCREEN_TOKEN_SECRET;
  return typeof s === 'string' && s.length > 0 ? s : null;
};
const mac = (secret, payloadB64) => crypto.createHmac('sha256', secret).update(`${VERSION}.${payloadB64}`).digest();

/**
 * Mint a ticket for `sub`. Returns { token, exp } (exp in seconds), or null when there is no secret or no sub.
 * opts: { secret, nowMs, ttlS } — all optional (tests).
 */
function sign(sub, opts = {}) {
  const secret = secretOf(opts);
  if (!secret || typeof sub !== 'string' || !sub) return null;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const ttlS = Number.isFinite(opts.ttlS) ? opts.ttlS : TTL_S;
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlS;
  const payloadB64 = b64u(JSON.stringify({ sub, aud: AUD, iat, exp }));
  return { token: `${VERSION}.${payloadB64}.${b64u(mac(secret, payloadB64))}`, exp };
}

/**
 * Check a ticket. Returns { ok: true, sub, iat, exp } or { ok: false, reason }. The signature is compared in
 * constant time; the payload is not even parsed until it has passed.
 * opts: { secret, nowMs } — optional (tests); the secret defaults to SCREEN_TOKEN_SECRET.
 */
function verify(token, opts = {}) {
  const secret = secretOf(opts);
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };

  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(b64u(mac(secret, parts[1])));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };

  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'malformed' };
  if (p.aud !== AUD) return { ok: false, reason: 'wrong-audience' };
  if (typeof p.sub !== 'string' || !p.sub) return { ok: false, reason: 'malformed' };
  if (!Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return { ok: false, reason: 'malformed' };
  if (p.exp - p.iat > MAX_TTL_S) return { ok: false, reason: 'malformed' };

  const nowS = (Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now()) / 1000;
  if (nowS > p.exp + SKEW_S) return { ok: false, reason: 'expired' };
  if (p.iat > nowS + SKEW_S) return { ok: false, reason: 'not-yet-valid' };
  return { ok: true, sub: p.sub, iat: p.iat, exp: p.exp };
}

module.exports = { sign, verify, VERSION, AUD, TTL_S, MAX_TTL_S, SKEW_S };
