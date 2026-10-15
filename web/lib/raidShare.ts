// Public share links for one recorded raid session: the token, the window and the status rules.
// Server-side only (node:crypto). The page and the routes that use it are /share/raid/[token],
// /api/share/raid/[token]/* and /api/raid/shares; the table is raid_shares
// (supabase/migrations/20261015130000_raid_shares.sql).
//
// THE MODEL, in four rules the tests hold:
//   1. A link is a secret. 32 random bytes, base64url, shown once. The database keeps only SHA-256(token), so
//      reading the table cannot rebuild a link.
//   2. The window belongs to the SHARE ROW. Nothing a visitor sends can name, move or widen it: the public
//      routes take the token (and, for the replay, a window INDEX), never a time.
//   3. Every query that reads guild data for a share carries `gte(col, from).lt(col, to)` with the row's window
//      (windowIso gives the two bounds; test/raid-share.test.js fails a read that lacks them). `boundWindow` is the
//      one way to narrow it further and it can only ever shrink it.
//   4. A link that is unknown, expired or revoked is the same 404. The visitor learns nothing about which.

import { createHash, randomBytes } from 'node:crypto';
import { REPLAY_WINDOW_MS, MINUTE_MS } from './raidReplay';

// ── The token ────────────────────────────────────────────────────────────────

export const TOKEN_BYTES = 32;
// 32 bytes in base64url, no padding: 43 characters of [A-Za-z0-9_-].
const TOKEN_RX = /^[A-Za-z0-9_-]{43}$/;

/** A fresh secret. Shown to the officer once; only `hashToken(token)` is ever stored. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** What the table stores: lowercase hex SHA-256. 256 random bits need no slow hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cheap shape test before touching the database, so junk URLs never become queries. */
export function tokenLooksValid(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RX.test(token);
}

// ── Expiry and revocation ────────────────────────────────────────────────────

export const EXPIRY_CHOICES_DAYS = [7, 30, 90] as const;
export const DEFAULT_EXPIRY_DAYS = 30;

/** A requested lifetime, snapped to a choice we offer (anything else is the default). */
export function expiryDays(v: unknown): number {
  const n = Number(v);
  return (EXPIRY_CHOICES_DAYS as readonly number[]).includes(n) ? n : DEFAULT_EXPIRY_DAYS;
}

export type ShareRow = {
  id: string;
  guild_id: string;
  from_at: string;
  to_at: string;
  title: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
};

export type ShareStatus = 'ok' | 'expired' | 'revoked';

export function shareStatus(row: Pick<ShareRow, 'expires_at' | 'revoked_at'>, now = Date.now()): ShareStatus {
  if (row.revoked_at) return 'revoked';
  const exp = Date.parse(row.expires_at);
  // A row whose expiry cannot be read is treated as over, never as forever.
  if (!Number.isFinite(exp) || exp <= now) return 'expired';
  return 'ok';
}

/** The row's window as a ShareWindow, or null when the stored times are unusable. */
export function windowOfShare(row: Pick<ShareRow, 'from_at' | 'to_at'>): ShareWindow | null {
  return makeWindow(Date.parse(row.from_at), Date.parse(row.to_at));
}

// ── The window ───────────────────────────────────────────────────────────────

/** Longest window a share may cover (the table's check constraint says the same). */
export const MAX_WINDOW_MS = 24 * 60 * MINUTE_MS;

/** [fromMs, toMs): from inclusive, to exclusive, both on a minute boundary. */
export type ShareWindow = { readonly fromMs: number; readonly toMs: number };

/**
 * A window from two instants: from rounded DOWN and to rounded UP to the minute (the recording is one row per
 * minute, so a half-minute edge would otherwise cut a row in two). Null when it is empty, reversed, longer than
 * a day or not a number.
 */
export function makeWindow(fromMs: number, toMs: number): ShareWindow | null {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const f = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  const t = Math.ceil(toMs / MINUTE_MS) * MINUTE_MS;
  if (t <= f || t - f > MAX_WINDOW_MS) return null;
  return { fromMs: f, toMs: t };
}

/**
 * The part of `win` that `[reqFrom, reqTo)` covers, or null when they do not overlap. It can only shrink a
 * window: a request that reaches past either edge is cut back to it, never honoured.
 */
export function boundWindow(win: ShareWindow, reqFromMs: number, reqToMs: number): ShareWindow | null {
  if (!Number.isFinite(reqFromMs) || !Number.isFinite(reqToMs)) return null;
  const f = Math.max(win.fromMs, reqFromMs);
  const t = Math.min(win.toMs, reqToMs);
  return t > f ? { fromMs: f, toMs: t } : null;
}

export const inWindow = (win: ShareWindow, ms: number): boolean => Number.isFinite(ms) && ms >= win.fromMs && ms < win.toMs;

export const windowIso = (win: ShareWindow) => ({ from: new Date(win.fromMs).toISOString(), to: new Date(win.toMs).toISOString() });

/**
 * The replay's w-th 15-minute slice of the window, as the public route serves it: w counts from the window's
 * start, the slice is cut at the window's end. Null for a w that is not a whole number inside the window.
 */
export function replaySlice(win: ShareWindow, w: unknown): ShareWindow | null {
  const n = typeof w === 'string' && /^\d{1,4}$/.test(w) ? Number(w) : typeof w === 'number' ? w : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  const from = win.fromMs + n * REPLAY_WINDOW_MS;
  if (from >= win.toMs) return null;
  return { fromMs: from, toMs: Math.min(from + REPLAY_WINDOW_MS, win.toMs) };
}

// ── The link ─────────────────────────────────────────────────────────────────

/** The address an officer sends: the production host, whichever host made it. */
export const SHARE_ORIGIN = 'https://wolfpack.quest';
export const sharePath = (token: string) => `/share/raid/${token}`;
