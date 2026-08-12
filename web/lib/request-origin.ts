import type { NextRequest } from 'next/server';

/**
 * The origin the USER is actually on, for building auth redirects.
 *
 * `new URL(req.url).origin` is the obvious answer and is what the auth routes
 * used, but Next resolves `req.url` against the server's OWN listening address.
 * On Vercel that is invisible, because its proxy rewrites the request before
 * Next sees it. Anywhere else — a container, a LAN mirror — it evaluates to
 * `http://localhost:3000`, so sign-in and sign-out both completed successfully
 * and then dumped the user on localhost (found on the Unraid mirror at
 * 192.168.1.163:3000, 2026-08-11).
 *
 * Preference order:
 *   1. `x-forwarded-host` — set by any proxy in front, including Vercel's
 *   2. `Host` — correct when the app is hit directly, e.g. a published port
 *   3. `req.url` — last resort, and the thing that was wrong to begin with
 *
 * The scheme comes from `x-forwarded-proto` when a proxy set it. With no proxy
 * there is no such header, so infer: bare IPs and localhost are plain http
 * (a LAN mirror has no certificate), anything with a hostname is https.
 */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!host) return new URL(req.url).origin;

  const forwardedProto = req.headers.get('x-forwarded-proto');
  const proto =
    forwardedProto?.split(',')[0].trim() ||
    (/^(localhost|\[|\d{1,3}(\.\d{1,3}){3})(:|$)/.test(host) ? 'http' : 'https');

  return `${proto}://${host}`;
}
