// utils/bidCrypto.js — AES-256-GCM encryption for wishlist bid amounts.
//
// WHY ENCRYPT: Sealed bids are competitive strategy. Members must never see
// each other's bid amounts — not via Discord commands, not via the Supabase
// dashboard SQL editor, not via any API query. By encrypting with a key that
// lives ONLY in the bot's process env (WISHLIST_BID_KEY), the raw DB row is
// opaque to anyone without that key — including guild officers and Supabase
// admins querying via the Studio UI.
//
// Config:
//   WISHLIST_BID_KEY — exactly 64 hex chars (32 bytes = AES-256 key).
//
//   Generate with:
//     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
//   Add to Railway env vars and local .env. Losing this key means existing
//   encrypted bids cannot be decrypted — store it somewhere safe (1Password etc).
//
// Fallback: if WISHLIST_BID_KEY is not set, bid_amount_enc is stored as null
// and the plaintext bid_amount column (deprecated) is used as a graceful
// fallback with a console.warn. Production MUST set the key.
//
// Storage format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
//   IV  — 12 bytes → 24 hex chars  (unique per encryption)
//   Tag — 16 bytes → 32 hex chars  (GCM auth tag; detects tampering)
//   CT  — variable (decimal string of the integer)
//
// Security properties:
//   - AES-256-GCM (authenticated encryption — tamper-evident)
//   - Fresh random IV each write → identical bids produce different ciphertexts
//   - Auth tag verification — corrupted rows return null, never a wrong value
//   - Bot can rotate the key by decrypting all rows and re-encrypting

'use strict';

const crypto = require('crypto');

const ALGO     = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV (NIST recommended for GCM)

function _getKey() {
  const hex = process.env.WISHLIST_BID_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    console.warn('[bidCrypto] WISHLIST_BID_KEY must be exactly 64 hex chars (32 bytes). Ignoring.');
    return null;
  }
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    console.warn('[bidCrypto] WISHLIST_BID_KEY is not valid hex. Ignoring.');
    return null;
  }
}

/**
 * Encrypt an integer bid amount → opaque string for DB storage.
 *
 * Returns the ciphertext string if the key is configured, or null if not
 * (caller should fall back to storing bid_amount in plaintext — dev only).
 *
 * @param {number|null} amount
 * @returns {string|null}
 */
function encryptBid(amount) {
  if (amount === null || amount === undefined) return null;
  const key = _getKey();
  if (!key) {
    console.warn('[bidCrypto] WISHLIST_BID_KEY not set — bid will be stored in plaintext fallback. Set WISHLIST_BID_KEY for production!');
    return null;
  }
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const pt     = String(Math.round(amount)); // decimal string; always integers
  const ct     = Buffer.concat([cipher.update(pt, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

/**
 * Decrypt an opaque bid string → integer.
 *
 * Returns null if:
 *   - enc is falsy
 *   - WISHLIST_BID_KEY is not set
 *   - auth tag verification fails (corrupted or wrong key)
 *   - format is invalid
 *
 * Never throws — callers can treat null as "unknown / not committed".
 *
 * @param {string|null} enc
 * @returns {number|null}
 */
function decryptBid(enc) {
  if (!enc) return null;
  const key = _getKey();
  if (!key) return null;

  try {
    const parts = enc.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, ctHex] = parts;
    const iv       = Buffer.from(ivHex,  'hex');
    const tag      = Buffer.from(tagHex, 'hex');
    const ct       = Buffer.from(ctHex,  'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const n  = parseInt(pt, 10);
    return isNaN(n) ? null : n;
  } catch {
    // Covers: wrong key (auth tag mismatch), corrupted data, hex decode errors
    return null;
  }
}

/**
 * True if WISHLIST_BID_KEY is configured and usable.
 * Use this to warn officers if encryption is disabled on the bot.
 */
function isEncryptionEnabled() {
  return !!_getKey();
}

module.exports = { encryptBid, decryptBid, isEncryptionEnabled };
