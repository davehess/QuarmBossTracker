// eqmimic.quest is a second, neutral front door served by this same deployment (the guild lead,
// 2026-10-08): it shows the anonymous-feedback form and NOTHING else of the site. The middleware
// rewrites every path on these hosts to the form, and the root layout drops the Wolf Pack chrome
// for them. One list, so the two cannot disagree about what counts as that host.

export const EQMIMIC_HOSTS = ['eqmimic.quest', 'www.eqmimic.quest'];

// The single page that host serves. Also reachable on wolfpack.quest for testing.
export const EQMIMIC_FEEDBACK_PATH = '/eqmimic/feedback';

/** `host` is the raw Host header: any case, optional :port. */
export function isEqmimicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return EQMIMIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
}
