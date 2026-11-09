// The raidmimic.com top bar (the guild lead, 2026-11-09, Decision Desk pick A, centred): five plain links, and under them,
// when the page is in a section with 2+ pages, that section's pages. A SMALLER subset than wolfpack.quest's nav: only pages
// that exist on a raidmimic host. Pure data, no React, so a test can walk it. Every href is a path on a raidmimic host and
// spells no Wolf Pack address (test/raidmimic-no-wolfpack.test.js).
import { GUILDS_STAY_PATH } from './guildSites';

export interface RaidmimicPage { label: string; href: string }
export interface RaidmimicSection { key: string; label: string; href: string; pages: readonly RaidmimicPage[]; prefixes: readonly string[] }

export const RAIDMIMIC_SECTIONS: readonly RaidmimicSection[] = [
  { key: 'me', label: '/me', href: '/', prefixes: [], pages: [{ label: 'Home', href: '/' }] },
  { key: 'flagging', label: 'Flagging', href: '/characters', prefixes: ['/characters', '/demo/flags', '/demo/capture'], pages: [
    { label: 'Your characters', href: '/characters' },
    { label: 'Flags demo', href: '/demo/flags' },
    { label: 'Record for others', href: '/demo/capture' },
  ] },
  // stay=1: "Your guilds" means "manage my Raid Mimic account", so it must not bounce a player to their guild's own site.
  { key: 'guild', label: 'Guild', href: GUILDS_STAY_PATH, prefixes: ['/guilds', '/register', '/setup'], pages: [
    { label: 'Your guilds', href: GUILDS_STAY_PATH },
    { label: 'Start a guild', href: '/guilds/new' },
    { label: 'For guild leaders', href: '/register' },
    { label: 'Set up', href: '/setup' },
  ] },
  { key: 'raids', label: 'Raids', href: '/demo/raid', prefixes: ['/demo/raid', '/demo/events', '/demo'], pages: [
    { label: 'Tonight’s raid, demo', href: '/demo/raid' },
    { label: 'Events', href: '/demo/events' },
    { label: 'Needs board', href: '/demo/events/needs' },
  ] },
  // No spectator page yet: this is the landing's "Replay & spectator" block (id="replay" in StoryParts).
  { key: 'spectator', label: 'Spectator', href: '/#replay', prefixes: [], pages: [{ label: 'Spectator', href: '/#replay' }] },
];

const norm = (path: string) => (path.split(/[?#]/)[0].replace(/\/+$/, '') || '/').toLowerCase();
const within = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

/** The section a path belongs to: exact match or a `/<path>/` prefix; the longest prefix wins. `/` is /me; `/privacy` and the like belong to none. */
export function sectionOfPath(path: string): RaidmimicSection | null {
  const p = norm(path);
  if (p === '/') return RAIDMIMIC_SECTIONS[0];
  let best: RaidmimicSection | null = null;
  let bestLen = -1;
  for (const s of RAIDMIMIC_SECTIONS) {
    for (const pre of s.prefixes) {
      if (within(p, pre) && pre.length > bestLen) { best = s; bestLen = pre.length; }
    }
  }
  return best;
}

/** Whether a section page is the current one. The longest matching page wins, so /guilds/new does not also light "Your guilds". */
export function pageIsCurrent(section: RaidmimicSection, page: RaidmimicPage, path: string): boolean {
  const p = norm(path);
  const own = norm(page.href);
  if (!within(p, own)) return false;
  return !section.pages.some(o => o !== page && norm(o.href).length > own.length && within(p, norm(o.href)));
}
