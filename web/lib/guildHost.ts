// A guild's own address: <slug>.raidmimic.com (the guild lead, 2026-11-12, Decision Desk "hc-tenancy": each hosted guild
// at <guild>.raidmimic.com, sharing our database; DECISIONS §569). One list of rules, so the middleware, the layout and
// the sign-in pages cannot disagree about which guild a host means.
//
// Two cases, decided by the slug alone:
//   · the HOME guild's slug (this deployment's GUILD_TAG, 'wolfpack' here): the whole site, exactly as on its own
//     domain. wolfpack.raidmimic.com is wolfpack.quest at another address: same member gate, same pages.
//   · any other slug: this deployment does not carry that guild's raid data (one deployment per guild for now), so the
//     address serves that guild's own pages on the hub: /guilds/<slug> and what hangs under it, the open sign-in and
//     My characters. Everything else is sent to the guild's page.
//
// Pure and client-safe: no next/headers, no database. Whether the slug is a real guild is the guild page's answer (a
// missing guild is its 404), never this file's.
import { GUILD_TAG } from './guild';

export const GUILD_HOST_SUFFIX = '.raidmimic.com';

// The same shape as a registry slug (web/lib/hubRegistry.ts GUILD_SLUG_RX; spelled again here because that file imports
// the raidmimic host list, which imports this one. test/guild-host.test.js fails if the two ever differ).
export const GUILD_HOST_SLUG_RX = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;

// Subdomains that are, or may become, something other than a guild. `www` and `b` are live hosts today.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'www', 'b', 'api', 'app', 'admin', 'auth', 'login', 'mail', 'status', 'docs', 'help', 'support', 'cdn', 'static', 'new',
];

/** `host` is the raw Host header: any case, optional :port. The guild slug of `<slug>.raidmimic.com`, else null. */
export function guildHostSlug(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (!h.endsWith(GUILD_HOST_SUFFIX)) return null;
  const sub = h.slice(0, -GUILD_HOST_SUFFIX.length);
  if (sub.includes('.') || !GUILD_HOST_SLUG_RX.test(sub) || RESERVED_SUBDOMAINS.includes(sub)) return null;
  return sub;
}

/** This deployment's own guild at its raidmimic address: served as the whole site. */
export function isHomeGuildHost(host: string | null | undefined): boolean {
  return guildHostSlug(host) === GUILD_TAG;
}

/** Another guild's address: the hub's pages for that guild only. Null for every other host, the home guild's included. */
export function otherGuildHostSlug(host: string | null | undefined): string | null {
  const slug = guildHostSlug(host);
  return slug && slug !== GUILD_TAG ? slug : null;
}

/** The guild's page on the hub. */
export function guildHomePath(slug: string): string {
  return `/guilds/${slug}`;
}

/** The address a guild is reached at. */
export function guildHostUrl(slug: string): string {
  return `https://${slug}${GUILD_HOST_SUFFIX}`;
}

// What another guild's address serves as itself: signing in, the guild pages, My characters and the framework's files.
// The page's own images sit under /raidmimic/<folder>/ (the Raid Mimic header's mascot): raidmimicHost.ts isRaidmimicAsset.
export function isGuildHostOpenPath(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/') || pathname.startsWith('/_next/')
    || pathname === '/characters' || pathname === '/guilds' || pathname.startsWith('/guilds/');
}

// The platform's own pages (the story, the demo, the set-up guide, the interest form, the legal pages). The Raid Mimic
// header and footer link to them by these short paths; on a guild's address they belong to the platform's.
export const PLATFORM_ORIGIN = 'https://raidmimic.com';
const PLATFORM_PATH_RX = /^\/(?:setup|register|privacy|terms|refunds|demo(?:\/[a-z0-9-]+){0,3})\/?$/;

/**
 * Where a request on another guild's address goes: null to serve it as it is, else where to redirect (query dropped).
 * A platform page goes to raidmimic.com; the root and everything else go to the guild's own page.
 */
export function otherGuildHostRedirect(slug: string, pathname: string): string | null {
  if (isGuildHostOpenPath(pathname)) return null;
  const path = pathname.toLowerCase();
  if (PLATFORM_PATH_RX.test(path)) return `${PLATFORM_ORIGIN}${path.replace(/\/+$/, '')}`;
  return guildHomePath(slug);
}
