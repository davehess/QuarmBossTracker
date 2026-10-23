// The abuse guards on the public share page and its routes (the guild lead, 2026-10-17). A share token is 32
// random bytes, so the risk is not guessing: it is a VALID link that leaks and is then scraped or looped.
// Two layers, both per process (see lib/rateLimit.ts for the limitation and the upgrade path):
//   1. per IP, checked BEFORE the token is looked up, so a hammered link costs a map lookup and nothing else;
//   2. per share, over a rolling hour, checked right AFTER the lookup (it needs the share id), so a link that is
//      scripted from many addresses stops costing money.
//
// WHAT ONE LEGITIMATE VIEW COSTS (read from app/spectator/replay/ReplayBoard.tsx and Replay3D.tsx):
//   * 1 page load;
//   * the replay: one /replay slice per 15 minutes of the window, fetched as the playhead reaches it or the
//     viewer scrubs (a 3.5 h session is 15, the longest window a share may cover, 24 h, is 96);
//   * 1 /bosses, 1 /map per zone shown, up to 2 /mesh per zone per pane (walls, then floors), two panes,
//     about ten zones in a long night: ~50 at the high end;
//   * a failed slice is retried every 5 s, so a bad minute adds at most 12 a minute.
// So a full scrub of the longest window is ~150 calls and a normal session ~40: 300 a minute per IP is double
// the worst honest burst, and 20,000 an hour per share is ~130 full scrubs of the longest window.
import { hashToken } from './raidShare';
import { createCeiling, createLimiter, type LimitResult } from './rateLimit';

export const PAGE_PER_MIN = 30;        // page loads, per IP per share
export const API_PER_MIN = 300;        // API calls, per IP across the share routes
export const PAGE_PER_HOUR = 3000;     // page views, per share: a share that follows the raid refreshes each viewer once a minute (~50 followers)
export const API_PER_HOUR = 20_000;    // API calls, per share

const pageLimiter = createLimiter(PAGE_PER_MIN, 60_000);
const apiLimiter = createLimiter(API_PER_MIN, 60_000);
const pageCeiling = createCeiling(PAGE_PER_HOUR);
const apiCeiling = createCeiling(API_PER_HOUR);

/** x-real-ip, else the first hop of x-forwarded-for (Vercel overwrites it, so the first hop is the client), else 'unknown'. */
export function clientIp(h: Pick<Headers, 'get'>): string {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const first = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}

const BUSY = 'This link is busy, try again in a minute.';
const busy = (retryAfter: number) => new Response(JSON.stringify({ error: BUSY }), {
  status: 429,
  headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
});

/** API routes, first thing: a 429 Response when this IP is over its minute, else null. */
export function guardApi(req: Request): Response | null {
  const r = apiLimiter.hit(clientIp(req.headers));
  return r.ok ? null : busy(r.retryAfter);
}

/** API routes, right after the lookup: a 429 Response when this share is over its hour, else null. */
export function ceilingApi(shareId: string): Response | null {
  const r = apiCeiling.hit(shareId);
  return r.ok ? null : busy(r.retryAfter);
}

/** The page, first thing: whether this IP may load this share's page again this minute. */
export function guardPage(headers: Pick<Headers, 'get'>, token: string): LimitResult {
  return pageLimiter.hit(`${clientIp(headers)}|${hashToken(token)}`);
}

/** The page, right after the lookup: whether this share is under its hourly page-view ceiling. */
export function ceilingPage(shareId: string): LimitResult {
  return pageCeiling.hit(shareId);
}

export const BUSY_MESSAGE = BUSY;
