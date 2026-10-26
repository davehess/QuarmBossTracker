// utils/wishlistRules.js — the numbers and checks a wishlist entry must satisfy, in ONE place.
//
// /wishlist add (commands/wishlist.js) builds its Discord option limits from these, and the web's
// "add to wishlist" on /me/upgrades reaches the bot through utils/webWishlist.js, which validates with the
// same functions — so the two doors cannot drift. The website cannot import this file (the site imports nothing
// from outside web/), so web/lib/wishlistRules.ts repeats the numbers; test/web-wishlist.test.js fails if the
// two disagree.
//
// There is no per-character cap on a wishlist and no item-eligibility rule beyond "the item exists in
// eqemu_items" (checked at the call site, which has the database).

'use strict';

const PRIORITY_MIN = 1;        // 1 = top BIS
const PRIORITY_MAX = 10;       // 10 = nice-to-have
const PRIORITY_DEFAULT = 5;
const BID_MIN = 1;             // DKP; an unset bid means the bot places 1 DKP when the item drops
const BID_MAX = 50000;
const NOTE_MAX = 200;

/** A priority: a whole number from PRIORITY_MIN to PRIORITY_MAX; undefined / null means the default. */
function parsePriority(v) {
  if (v === undefined || v === null) return { ok: true, value: PRIORITY_DEFAULT };
  if (!Number.isInteger(v) || v < PRIORITY_MIN || v > PRIORITY_MAX) {
    return { ok: false, error: `priority must be a whole number from ${PRIORITY_MIN} to ${PRIORITY_MAX}` };
  }
  return { ok: true, value: v };
}

/** A pre-bid: a whole number of DKP from BID_MIN to BID_MAX; undefined / null means "no bid" (value: null). */
function parseBid(v) {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (!Number.isInteger(v) || v < BID_MIN || v > BID_MAX) {
    return { ok: false, error: `bid must be a whole number of DKP from ${BID_MIN} to ${BID_MAX}` };
  }
  return { ok: true, value: v };
}

module.exports = { PRIORITY_MIN, PRIORITY_MAX, PRIORITY_DEFAULT, BID_MIN, BID_MAX, NOTE_MAX, parsePriority, parseBid };
