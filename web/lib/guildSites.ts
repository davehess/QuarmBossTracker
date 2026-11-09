// A guild's own website, and whether raidmimic.com sends its members there (the guild lead, 2026-11-02: "nothing on
// raidmimic.com should reference wolfpack.quest, but we should be able to redirect users to their guild's website at
// their configuration" and "redirect by default, for wolfpack they could redirect to wolfpack.quest").
//
// Two homes for the same two settings:
//   - a hosted guild keeps them on its hub_guilds row (website_url, redirect_members;
//     supabase/migrations/20261102230000_hub_guild_site.sql), and an owner or officer edits them on /guilds/<slug>;
//   - the built-in guild (Wolf Pack, which is not a hub_guilds row) reads them from CONFIGURATION: GUILD_SITE_URL and
//     GUILD_SITE_REDIRECT, with today's production site as the default (PROD_SITE_URL, web/lib/guild.ts).
// So no raidmimic page or sentence spells that address: every one of them asks this module.
//
// Pure apart from the two environment reads: no database, no framework, nothing from the `@/` alias, so a test runs the
// rules directly and the settings form could share them.
import { PROD_SITE_URL } from './guild';
import { isRaidmimicHost } from './raidmimicHost';

export const SITE_URL_MAX = 200;

/** The query parameter that keeps a player on /guilds instead of redirecting them to their guild's site. */
export const STAY_PARAM = 'stay';
/** Every link that means "manage my Raid Mimic account" points here, so the redirect never traps the player. */
export const GUILDS_STAY_PATH = `/guilds?${STAY_PARAM}=1`;

export const SITE_MESSAGES = {
  shape: `A website address starts with https:// and is at most ${SITE_URL_MAX} characters. Leave it empty for none.`,
  loop: 'That address is Raid Mimic itself, which would send your members round in a circle. Use your own site.',
} as const;

export type SiteCheck = { ok: true; url: string | null } | { ok: false; message: string };

/**
 * A website address as stored: https only, no sign-in details in it, no spaces, at most SITE_URL_MAX characters, and not a
 * Raid Mimic host. The query string and the #fragment are dropped and a trailing slash is trimmed, so what is stored is
 * `https://host/path`. Empty input is "no website" (ok, null).
 */
export function checkSiteUrl(raw: unknown): SiteCheck {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: true, url: null };
  if (text.length > SITE_URL_MAX || /\s/.test(text) || !/^https:\/\//i.test(text)) return { ok: false, message: SITE_MESSAGES.shape };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, message: SITE_MESSAGES.shape }; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return { ok: false, message: SITE_MESSAGES.shape };
  if (isRaidmimicHost(u.host)) return { ok: false, message: SITE_MESSAGES.loop };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/** `checkSiteUrl` for a value read from configuration or the database: the address, or null when it is not a usable one. */
export const cleanSiteUrl = (raw: unknown): string | null => {
  const c = checkSiteUrl(raw);
  return c.ok ? c.url : null;
};

export type GuildSite = { url: string | null; redirect: boolean };

// ── The built-in guild ─────────────────────────────────────────────────────────────────────────────────────
// GUILD_SITE_URL is server-only on purpose (only the /guilds page reads it). Unset, empty or unusable falls back to the
// production site, so a deployment that sets nothing behaves as the page did when the address was typed into it.
// The built-in guild's redirect is OFF unless GUILD_SITE_REDIRECT=1 (or true/on/yes) turns it on (the guild lead, 2026-11-09:
// "raidmimic.com/guilds redirects to wolfpack.quest", reported as a bug; §556 reverses §529's default for the built-in guild).
const ON = /^(1|true|on|yes)$/i;

/** The built-in guild's site and redirect setting, from configuration. */
export function builtinGuildSite(): GuildSite {
  return {
    url: cleanSiteUrl(process.env.GUILD_SITE_URL) ?? cleanSiteUrl(PROD_SITE_URL),
    redirect: ON.test((process.env.GUILD_SITE_REDIRECT ?? '').trim()),
  };
}

/** A page of a guild's site: `https://host/path` + `/me`. Null when the guild has no site. */
export function sitePage(site: string | null | undefined, path = ''): string | null {
  if (!site) return null;
  const base = site.replace(/\/+$/, '');
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
}

/** The address as a person reads it: `wolfpack.quest`, not `https://wolfpack.quest/`. */
export const siteLabel = (site: string): string => site.replace(/^https:\/\//i, '').replace(/\/+$/, '');

// ── Redirect by default ────────────────────────────────────────────────────────────────────────────────────
export type GuildRef = GuildSite & { guildId: string };

/** Query parameters that mean "I came here for something on this page": the Find-my-guilds answer and the stay switch. */
const STAY_PARAMS = [STAY_PARAM, 'find', 'found', 'closed'] as const;

/** True when the query asks to stay on /guilds: `?stay=1`, or the Find-my-guilds answer that page has to show. */
export function wantsToStay(query: Record<string, string | string[] | undefined> | null | undefined): boolean {
  if (!query) return false;
  return STAY_PARAMS.some(k => query[k] !== undefined && query[k] !== '' && query[k] !== '0');
}

/**
 * Where /guilds sends the signed-in player instead of showing the page, or null to show it.
 *
 * Only a player whose ONLY guild has a website and the redirect on is sent. Two or more guilds, a guild without a site,
 * the redirect switched off, or a stay request (`wantsToStay`) all show the page, where each card carries its own
 * "Open <guild>'s site" link. Counting every guild the player is in, not just the redirecting ones, is deliberate: a
 * player in Wolf Pack and a hosted guild must not be sent off before they have seen the second one.
 * `site` of a guild is already cleaned (`cleanSiteUrl`); a raidmimic host never gets this far (`checkSiteUrl` refuses it).
 */
export function redirectTarget(guilds: readonly GuildRef[], stay: boolean): string | null {
  if (stay || guilds.length !== 1) return null;
  const only = guilds[0];
  if (!only.redirect || !only.url) return null;
  return only.url;
}
