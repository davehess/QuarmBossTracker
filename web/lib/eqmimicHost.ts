// eqmimic.quest is a second, neutral front door served by this same deployment (the guild lead,
// 2026-10-08). It started as the anonymous-feedback form and nothing else; on 2026-10-08 it also
// became the landing page for someone new to Mimic (DECISIONS §209). The middleware rewrites each
// path on these hosts to one of the two pages below, and the root layout drops the Wolf Pack chrome
// for them. One list, so the two cannot disagree about what counts as that host.

export const EQMIMIC_HOSTS = ['eqmimic.quest', 'www.eqmimic.quest'];

// The anonymous form. Mimic opens `https://eqmimic.quest/feedback#cat=…&text=…` and refuses any other
// address (apps/mimic/main.js ALLOW), so `/feedback` on that host MUST keep serving this page.
export const EQMIMIC_FEEDBACK_PATH = '/eqmimic/feedback';

// The landing page. Also reachable on wolfpack.quest/eqmimic and b.wolfpack.quest/eqmimic?v=b for preview.
export const EQMIMIC_LANDING_PATH = '/eqmimic';

/** `host` is the raw Host header: any case, optional :port. */
export function isEqmimicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return EQMIMIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
}

/** The layout a visitor asked for with `?v=`: 'b', 'c', or null for the default (A). Anything else is null. */
export function eqmimicLandingVariant(v: string | null | undefined): 'b' | 'c' | null {
  const x = (v ?? '').toLowerCase();
  return x === 'b' || x === 'c' ? x : null;
}

/**
 * Where a request on an eqmimic host is rewritten to. `search` is the raw query string, with or without
 * the leading '?'.
 *   /feedback            -> the form, query dropped (the prefill rides the #fragment, which never reaches us)
 *   / , /index, anything -> the landing, keeping ONLY `v` when it is b or c (a layout preview); every
 *                           other parameter is dropped so nothing a caller tacked on rides further
 */
export function eqmimicLandingTarget(pathname: string, search: string): { pathname: string; search: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname;
  if (path === '/feedback') return { pathname: EQMIMIC_FEEDBACK_PATH, search: '' };
  const v = eqmimicLandingVariant(new URLSearchParams(search).get('v'));
  return { pathname: EQMIMIC_LANDING_PATH, search: v ? `?v=${v}` : '' };
}
