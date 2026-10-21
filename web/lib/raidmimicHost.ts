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

// The landing page. Also reachable on wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic (preview, and the
// only place `?v=b` can be seen: it is dropped on the raidmimic hosts, exactly like eqmimic's).
export const RAIDMIMIC_LANDING_PATH = '/raidmimic';

/** `host` is the raw Host header: any case, optional :port. */
export function isRaidmimicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return RAIDMIMIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
}

// The set-up guide for someone who is not in a guild (the guild lead, 2026-10-21): raidmimic.com/setup.
export const RAIDMIMIC_SETUP_PATH = '/raidmimic/setup';

/**
 * Where a request on a raidmimic host is rewritten to, with every query parameter dropped so nothing a caller
 * tacked on rides further:
 *   /setup               -> the set-up guide (a trailing slash and any capitals are fine)
 *   / , anything else    -> the landing page
 * Unlike eqmimic there is no form of its own: the "Register interest" link points at the anonymous form on
 * eqmimic.quest. `pathname` is optional so the old no-argument call still means "the landing page".
 */
export function raidmimicLandingTarget(pathname = '/'): { pathname: string; search: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname;
  if (path === '/setup') return { pathname: RAIDMIMIC_SETUP_PATH, search: '' };
  return { pathname: RAIDMIMIC_LANDING_PATH, search: '' };
}
