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

/**
 * The row's window as a ShareWindow, or null when the stored times are unusable. An OPEN share ("follow until the
 * raid ends", isOpenShare) reads as [from, min(now, from + 24 h)): the end moves with the clock until an officer
 * closes it. `now` defaults to the real clock.
 */
export function windowOfShare(row: Pick<ShareRow, 'from_at' | 'to_at'>, now = Date.now()): ShareWindow | null {
  const from = Date.parse(row.from_at);
  if (isOpenShare(row)) {
    // At least a minute long, so a share made the instant its window starts is not empty.
    return makeWindow(from, Math.max(Math.min(now, from + MAX_WINDOW_MS), from + MINUTE_MS));
  }
  return makeWindow(from, Date.parse(row.to_at));
}

// ── Open shares (no migration) ───────────────────────────────────────────────

/**
 * An open share is stored as `to_at = from_at + 24 h - 1 s`. Every window an officer makes is whole-minute
 * (makeWindow rounds), so a row that is 1 s short of a day cannot be anything else. The table's check
 * (to_at - from_at <= 24 h) accepts it, so no column is needed.
 */
export const OPEN_SPAN_MS = 24 * 60 * MINUTE_MS - 1000;   // MAX_WINDOW_MS - 1 s; spelled out because that const is declared further down

/** The stored window of a new open share: from rounded down to the minute, the end at the marker. */
export function openWindow(fromMs: number): ShareWindow {
  const f = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  return { fromMs: f, toMs: f + OPEN_SPAN_MS };
}

export function isOpenShare(row: Pick<ShareRow, 'from_at' | 'to_at'>): boolean {
  const f = Date.parse(row.from_at);
  const t = Date.parse(row.to_at);
  return Number.isFinite(f) && Number.isFinite(t) && t - f === OPEN_SPAN_MS;
}

/** The latest end an officer may set: a little ahead of the clock (a raid being planned), not a year out. */
export const MAX_END_AHEAD_MS = 12 * 60 * MINUTE_MS;

export type ShareChange = { to_at: string } | { error: string };

/**
 * What an officer's PATCH does to a share's end. `body.to` sets a fixed end (after `from`, window <= 24 h, not past
 * now + 12 h); `body.open === true` makes it follow the raid; `body.open === false` alone closes it at the
 * moment (or at `from + 24 h`, whichever is first). Returns the new `to_at` or the reason it is refused.
 */
export function planShareChange(
  row: Pick<ShareRow, 'from_at' | 'to_at'>,
  body: { to?: unknown; open?: unknown },
  now = Date.now(),
): ShareChange {
  const from = Date.parse(row.from_at);
  if (!Number.isFinite(from)) return { error: 'bad window' };
  if (body.open === true) {
    if (body.to !== undefined) return { error: 'send either to or open' };
    return { to_at: new Date(openWindow(from).toMs).toISOString() };
  }
  let toMs: number;
  if (body.to !== undefined && body.to !== null) {
    if (typeof body.to !== 'string') return { error: 'bad end time' };
    toMs = Date.parse(body.to);
    if (!Number.isFinite(toMs)) return { error: 'bad end time' };
    if (toMs > now + MAX_END_AHEAD_MS) return { error: 'end is too far ahead' };
  } else if (body.open === false) {
    toMs = Math.min(now, from + MAX_WINDOW_MS);   // Close: fix the end at this moment
  } else {
    return { error: 'nothing to change' };
  }
  if (toMs <= from) return { error: 'end must be after the start' };
  const win = makeWindow(from, toMs);
  if (!win) return { error: 'a share covers at most 24 hours' };
  return { to_at: new Date(win.toMs).toISOString() };
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

/** The cache tag on everything the public routes keep across visitors for one share; revoking revalidates it. */
export const shareTag = (shareId: string) => `raid-share:${shareId}`;

/** How long a share's heavy reads are kept across visitors, in seconds. It is also how long an opt-out can take to show. */
export const SHARE_CACHE_S = 60;   // a minute, so an opt-out leaves a public share within about that (the guild lead's privacy rule)

// ── The link ─────────────────────────────────────────────────────────────────

/** The address an officer sends: the production host, whichever host made it. */
export const SHARE_ORIGIN = 'https://wolfpack.quest';
export const sharePath = (token: string) => `/share/raid/${token}`;
