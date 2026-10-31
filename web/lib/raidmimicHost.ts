// raidmimic.com is a third front door served by this same deployment (the guild lead, 2026-10-18, option C,
// "two doors"): eqmimic.quest stays the free EverQuest PLAYER tool, and raidmimic.com is the game-agnostic
// "raid orchestration and analytics as a service" page for GUILD LEADERS. It copies the eqmimic pattern
// (web/lib/eqmimicHost.ts) on purpose: the middleware rewrites every path on these hosts to one page, drops
// the query, and the root layout drops the Wolf Pack chrome for them. One list, so the middleware, the layout
// and the page cannot disagree about what counts as that host.

export const RAIDMIMIC_HOSTS = [
  'raidmimic.com', 'www.raidmimic.com',
  'raidmimic.net', 'www.raidmimic.net',
  'raidmimic.quest', 'www.raidmimic.quest',
];

// The landing page. Also reachable on wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic (the same page, not
// indexed there; the query is dropped on the raidmimic hosts, exactly like eqmimic's).
export const RAIDMIMIC_LANDING_PATH = '/raidmimic';

/** `host` is the raw Host header: any case, optional :port. */
export function isRaidmimicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return RAIDMIMIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
}

/** `origin` is what web/lib/request-origin.ts returns: scheme://host[:port]. The sign-in callback decides its path from it. */
export function isRaidmimicOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try { return isRaidmimicHost(new URL(origin).host); } catch { return false; }
}

// ─── Signing in (the guild lead, 2026-10-31, DECISIONS §492: raidmimic.com is a sign-in first, then "your guilds") ───
// These paths are the ONLY ones on a raidmimic host that are not rewritten to the landing page: the sign-in pages and
// callback, the auth API, and the signed-in /guilds page. The middleware lets them through to the normal request
// flow (session refresh, lockout check), because a page that reads the session needs both.
export const RAIDMIMIC_GUILDS_PATH = '/guilds';

// /api/hubs is the guild directory Mimic's picker reads from https://raidmimic.com/api/hubs (public, exactly this path).
export const RAIDMIMIC_HUBS_PATH = '/api/hubs';

export function isRaidmimicOpenPath(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/') || pathname === RAIDMIMIC_HUBS_PATH
    || pathname === RAIDMIMIC_GUILDS_PATH || pathname.startsWith(`${RAIDMIMIC_GUILDS_PATH}/`);
}

// The set-up guide for someone who is not in a guild (the guild lead, 2026-10-21): raidmimic.com/setup.
export const RAIDMIMIC_SETUP_PATH = '/raidmimic/setup';

// ─── Search engines (the guild lead, 2026-10-23: "search engines on, together with the new story") ───────────────
// raidmimic.com is the one address that is INDEXED: it, and its two sister hosts, serve the page with
// `index, follow` and name https://raidmimic.com as the canonical address, so the sisters fold into it. The same page
// on wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic stays `noindex, nofollow` (a duplicate of the host's page
// must never compete with it). The Vercel preview of the beta branch is noindex too, whatever host it is reached by.
export const RAIDMIMIC_ORIGIN = 'https://raidmimic.com';
export const RAIDMIMIC_ROBOTS_PATH = '/raidmimic/robots.txt';     // served at /robots.txt on a raidmimic host
export const RAIDMIMIC_SITEMAP_PATH = '/raidmimic/sitemap.xml';   // served at /sitemap.xml on a raidmimic host

export interface RaidmimicSeo {
  robots: { index: boolean; follow: boolean };
  alternates?: { canonical: string };
}

/** The `robots` and canonical metadata for one of the two pages. `path` is the page's address on raidmimic.com. */
export function raidmimicSeo(host: string | null | undefined, path: '/' | '/setup'): RaidmimicSeo {
  if (!isRaidmimicHost(host) || process.env.NEXT_PUBLIC_IS_BETA === '1') return { robots: { index: false, follow: false } };
  return { robots: { index: true, follow: true }, alternates: { canonical: `${RAIDMIMIC_ORIGIN}${path}` } };
}

/**
 * Files that belong to the page and are served as themselves on a raidmimic host: the captures, clips, mascot and the
 * "How it works" scene under /raidmimic/<folder>/<file>.<ext>. The matcher only skips a few image types, so without
 * this a video or the scene's html file would be rewritten to the landing page.
 */
export function isRaidmimicAsset(pathname: string): boolean {
  return /^\/raidmimic\/[a-z0-9_-]+\/[a-z0-9_.-]+\.[a-z0-9]+$/i.test(pathname);
}

/**
 * Where a request on a raidmimic host is rewritten to, with every query parameter dropped so nothing a caller
 * tacked on rides further:
 *   /setup               -> the set-up guide (a trailing slash and any capitals are fine)
 *   /robots.txt          -> robots for these hosts (allow all, and the sitemap)
 *   /sitemap.xml         -> the two pages
 *   / , anything else    -> the landing page
 * Unlike eqmimic there is no form of its own: the "Register interest" link points at the anonymous form on
 * eqmimic.quest. `pathname` is optional so the old no-argument call still means "the landing page".
 */
export function raidmimicLandingTarget(pathname = '/'): { pathname: string; search: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname;
  if (path === '/setup') return { pathname: RAIDMIMIC_SETUP_PATH, search: '' };
  if (path === '/robots.txt') return { pathname: RAIDMIMIC_ROBOTS_PATH, search: '' };
  if (path === '/sitemap.xml') return { pathname: RAIDMIMIC_SITEMAP_PATH, search: '' };
  return { pathname: RAIDMIMIC_LANDING_PATH, search: '' };
}
