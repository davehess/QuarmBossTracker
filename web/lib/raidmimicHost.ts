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

/**
 * Where a request on a raidmimic host is rewritten to: the landing page, whatever the path, and with every
 * query parameter dropped so nothing a caller tacked on rides further. Unlike eqmimic there is no second page
 * (no form of its own): the "Register interest" link points at the anonymous form on eqmimic.quest.
 */
export function raidmimicLandingTarget(): { pathname: string; search: string } {
  return { pathname: RAIDMIMIC_LANDING_PATH, search: '' };
}
