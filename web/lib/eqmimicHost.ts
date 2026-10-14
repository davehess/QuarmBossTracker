// eqmimic.quest is a second, neutral front door served by this same deployment (the guild lead,
// 2026-10-08). It started as the anonymous-feedback form and nothing else; on 2026-10-08 it also
// became the landing page for someone new to Mimic (DECISIONS §209). The middleware rewrites each
// path on these hosts to one of the two pages below, and the root layout drops the Wolf Pack chrome
// for them. One list, so the two cannot disagree about what counts as that host.

export const EQMIMIC_HOSTS = ['eqmimic.quest', 'www.eqmimic.quest'];

// The anonymous form. Mimic opens `https://eqmimic.quest/feedback#cat=…&text=…` and refuses any other
// address (apps/mimic/main.js ALLOW), so `/feedback` on that host MUST keep serving this page.
export const EQMIMIC_FEEDBACK_PATH = '/eqmimic/feedback';

// The landing page. Also reachable on wolfpack.quest/eqmimic and b.wolfpack.quest/eqmimic.
export const EQMIMIC_LANDING_PATH = '/eqmimic';

/** `host` is the raw Host header: any case, optional :port. */
export function isEqmimicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return EQMIMIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
}

/**
 * Where a request on an eqmimic host is rewritten to. Every query parameter is dropped, so nothing a caller
 * tacked on rides further (the landing page takes none; a scenario is linked by `#clip-<slug>`, a fragment,
 * which never reaches the server).
 *   /feedback            -> the form (the prefill rides the #fragment too)
 *   / , /index, anything -> the landing
 */
export function eqmimicLandingTarget(pathname: string): { pathname: string; search: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname;
  if (path === '/feedback') return { pathname: EQMIMIC_FEEDBACK_PATH, search: '' };
  return { pathname: EQMIMIC_LANDING_PATH, search: '' };
}
