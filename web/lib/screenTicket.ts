// The "screen ticket": a short-lived HMAC bearer that lets a signed-in member's browser read the bot's
// /api/screen/live directly (the 3-second reads of /screen come from the bot, not from a Vercel function per
// poll). This file mints it (GET /api/screen/ticket); utils/screenTicket.js on the bot verifies it. The two
// must agree byte for byte: test/screen-live.test.js signs on one side and verifies on the other, both ways.
//
//   v1.<b64url(JSON {sub, aud:'screen', iat, exp})>.<b64url(HMAC-SHA256(secret, 'v1.' + payloadB64))>
//
// sub = the Supabase user id, iat / exp = seconds since the epoch. A missing SCREEN_TOKEN_SECRET means "no
// tickets", never "any ticket": sign returns null and verify fails closed. Server only (node:crypto).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TICKET_VERSION = 'v1';
export const TICKET_AUD = 'screen';
export const TICKET_TTL_S = 2 * 60 * 60;       // the page renews it a few minutes before this
export const TICKET_MAX_TTL_S = 24 * 60 * 60;  // a ticket claiming a longer life than this is not one we minted
export const TICKET_SKEW_S = 60;               // clock drift allowed between Vercel and the bot, both directions

type Opts = { secret?: string | null; nowMs?: number; ttlS?: number };

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const secretOf = (opts?: Opts): string | null => {
  const s = opts && opts.secret !== undefined ? opts.secret : process.env.SCREEN_TOKEN_SECRET;
  return typeof s === 'string' && s.length > 0 ? s : null;
};
const mac = (secret: string, payloadB64: string) =>
  createHmac('sha256', secret).update(`${TICKET_VERSION}.${payloadB64}`).digest();

/** Mint a ticket for `sub`: { token, exp (seconds) }, or null with no secret or no sub. */
export function signScreenTicket(sub: string, opts: Opts = {}): { token: string; exp: number } | null {
  const secret = secretOf(opts);
  if (!secret || typeof sub !== 'string' || !sub) return null;
  const nowMs = Number.isFinite(opts.nowMs) ? (opts.nowMs as number) : Date.now();
  const ttlS = Number.isFinite(opts.ttlS) ? (opts.ttlS as number) : TICKET_TTL_S;
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlS;
  const payloadB64 = b64u(JSON.stringify({ sub, aud: TICKET_AUD, iat, exp }));
  return { token: `${TICKET_VERSION}.${payloadB64}.${b64u(mac(secret, payloadB64))}`, exp };
}

export type TicketCheck = { ok: true; sub: string; iat: number; exp: number } | { ok: false; reason: string };

/** Check a ticket (the bot does this in JS; this copy is for the tests and for any Vercel-side reader). */
export function verifyScreenTicket(token: unknown, opts: Opts = {}): TicketCheck {
  const secret = secretOf(opts);
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_VERSION || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };

  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(b64u(mac(secret, parts[1])));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };

  let p: { sub?: unknown; aud?: unknown; iat?: unknown; exp?: unknown } | null;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'malformed' };
  if (p.aud !== TICKET_AUD) return { ok: false, reason: 'wrong-audience' };
  if (typeof p.sub !== 'string' || !p.sub) return { ok: false, reason: 'malformed' };
  if (typeof p.iat !== 'number' || !Number.isFinite(p.iat) || typeof p.exp !== 'number' || !Number.isFinite(p.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  if (p.exp - p.iat > TICKET_MAX_TTL_S) return { ok: false, reason: 'malformed' };

  const nowS = (Number.isFinite(opts.nowMs) ? (opts.nowMs as number) : Date.now()) / 1000;
  if (nowS > p.exp + TICKET_SKEW_S) return { ok: false, reason: 'expired' };
  if (p.iat > nowS + TICKET_SKEW_S) return { ok: false, reason: 'not-yet-valid' };
  return { ok: true, sub: p.sub, iat: p.iat, exp: p.exp };
}
