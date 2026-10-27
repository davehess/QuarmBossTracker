// The wishlist limits the website enforces before it asks the bot, and the bot enforces again.
//
// The twin of utils/wishlistRules.js, which /wishlist add (the Discord command) is built from. The site imports
// nothing from outside web/, so the numbers are repeated here; test/web-wishlist.test.js fails if the two differ.
// There is no per-character cap and no item-eligibility rule beyond "the item exists" (the bot checks that).

export const PRIORITY_MIN = 1;        // 1 = top BIS
export const PRIORITY_MAX = 10;       // 10 = nice-to-have
export const PRIORITY_DEFAULT = 5;
export const BID_MIN = 1;             // DKP; with no bid the bot places 1 DKP when the item drops
export const BID_MAX = 50000;

/** A priority: a whole number PRIORITY_MIN..PRIORITY_MAX; undefined / null is the default. */
export function parsePriority(v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: PRIORITY_DEFAULT };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < PRIORITY_MIN || v > PRIORITY_MAX) {
    return { ok: false, error: `Priority must be a whole number from ${PRIORITY_MIN} to ${PRIORITY_MAX}.` };
  }
  return { ok: true, value: v };
}

/** A pre-bid: a whole number of DKP BID_MIN..BID_MAX; undefined / null means no bid. */
export function parseBid(v: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < BID_MIN || v > BID_MAX) {
    return { ok: false, error: `Pre-bid must be a whole number of DKP from ${BID_MIN} to ${BID_MAX}.` };
  }
  return { ok: true, value: v };
}

/** What a form field holds as the value parseBid takes: '' is no bid, digits are a bid, anything else is NaN (which parseBid refuses). */
export function bidFromField(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}
