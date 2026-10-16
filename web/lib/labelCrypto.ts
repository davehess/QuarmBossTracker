// Encrypts the per-account label on /me/accounts at rest (the guild lead, 2026-10-16). Server code only: it reads
// a secret from the environment, so never import it from a client component.
//
// AES-256-GCM, a fresh random 12-byte IV per value. Stored form: `v1:<base64 iv>:<base64 ciphertext+tag>`.
// The key is GAME_ACCOUNT_LABEL_KEY, 32 random bytes in base64 (`openssl rand -base64 32`). It is read at call
// time, not at import, so a missing key never breaks module load; labelKeyReady() says whether it is usable.
//
// `aad` binds a ciphertext to its row (callers pass `${owner_discord_id}:${slot}`), so a value copied onto
// another row fails to decrypt instead of showing up under someone else's account.
//
// decryptLabel never throws: any failure (no key, wrong key, wrong aad, tampering, bad format) is null.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer | null {
  const raw = process.env.GAME_ACCOUNT_LABEL_KEY;
  if (!raw) return null;
  try {
    const k = Buffer.from(raw.trim(), 'base64');
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

/** True when GAME_ACCOUNT_LABEL_KEY is set to a valid 32-byte base64 key. */
export function labelKeyReady(): boolean {
  return key() !== null;
}

/** Encrypt `plain`, bound to `aad`. Throws if the key is not ready: callers check labelKeyReady() first. */
export function encryptLabel(plain: string, aad: string): string {
  const k = key();
  if (!k) throw new Error('GAME_ACCOUNT_LABEL_KEY is not set');
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  return `${VERSION}:${iv.toString('base64')}:${body.toString('base64')}`;
}

/** Decrypt a value from encryptLabel with the same `aad`; null on any failure. */
export function decryptLabel(enc: string, aad: string): string | null {
  try {
    const k = key();
    if (!k) return null;
    const [v, ivB64, bodyB64, extra] = String(enc).split(':');
    if (v !== VERSION || !ivB64 || !bodyB64 || extra !== undefined) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const body = Buffer.from(bodyB64, 'base64');
    if (iv.length !== IV_BYTES || body.length < TAG_BYTES) return null;
    const d = createDecipheriv('aes-256-gcm', k, iv);
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([d.update(body.subarray(0, body.length - TAG_BYTES)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
