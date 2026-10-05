// utils/serviceKey.js — a shared-secret bearer check for a service that is not a person.
//
// Every /api/agent/* route wants a per-user `wpms_` session token (utils/mimicLink.js requireAgentAuth). A
// service running on its own box — Bristlebane, the raid-voice bot — has no person to borrow one from, so a
// route that such a service reads can ALSO accept one dedicated key from the environment. It opens only the
// route that asks for it; every other route still wants a session token.

'use strict';

const crypto = require('node:crypto');

/** The token in `Authorization: Bearer <token>`, or '' when the header is missing or not a Bearer one. */
function bearerOf(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req?.headers?.authorization || '').trim());
  return m ? m[1].trim() : '';
}

/**
 * Does this request carry `key` as its bearer? An unset or blank key matches nothing, so a deploy that never
 * set the variable behaves exactly as before. The comparison is constant-time over equal-length buffers
 * (timingSafeEqual throws on unequal lengths, so a length mismatch is answered first — the length of the key
 * is the one thing that leaks, which is acceptable for a random key).
 */
function matchesServiceKey(req, key) {
  const want = typeof key === 'string' ? key.trim() : '';
  if (!want) return false;
  const given = Buffer.from(bearerOf(req));
  const expected = Buffer.from(want);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

module.exports = { bearerOf, matchesServiceKey };
