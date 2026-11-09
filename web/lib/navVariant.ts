// Two previews of a five-item top nav (the guild lead, 2026-11-09: "/me, Flagging, Guild, Raids,
// Spectator"). Beta only: ?nav=a|b sets the wp-nav cookie, ?nav=0 clears it, and with no cookie
// the header renders today's GROUPS untouched. Pure and React-free so a test can import it.
export type NavItem = { href: string; label: string };
export type NavGroup = { id: string; label: string; items: NavItem[] };
export type NavVariant = 'a' | 'b';

export const NAV_COOKIE = 'wp-nav';
export const NAV_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

// The ONE regrouping, shared by both variants. The first item is the group's landing link.
export const SIMPLE_GROUPS: NavGroup[] = [
  { id: 'me', label: '/me', items: [{ href: '/me', label: '/me' }] },
  {
    id: 'flagging', label: 'Flagging',
    items: [
      { href: '/pop',           label: 'PoP flags' },
      { href: '/guide',         label: 'Raid guide' },
      { href: '/start',         label: 'Getting started' },
      { href: '/db',            label: 'Database' },
      { href: '/quartermaster', label: 'Quartermaster' },
    ],
  },
  {
    id: 'guild', label: 'Guild',
    items: [
      { href: '/roster',       label: 'Roster' },
      { href: '/leaderboards', label: 'Ranks' },
      { href: '/raidhistory',  label: 'Raid history' },
      { href: '/who',          label: '/who' },
      { href: '/pvp',          label: 'PvP' },
      { href: '/fun',          label: 'Fun' },
      { href: '/film',         label: 'Film' },
      { href: '/roadmap',      label: 'Roadmap' },
    ],
  },
  {
    id: 'raids', label: 'Raids',
    items: [
      { href: '/raid',    label: 'Raid HQ' },
      { href: '/boards',  label: 'Spawn boards' },
      { href: '/buffs',   label: 'Buffs' },
      { href: '/screen',  label: 'Raid screen' },
      { href: '/rolls',   label: 'Rolls' },
      { href: '/parses',  label: 'Parses' },
    ],
  },
  { id: 'spectator', label: 'Spectator', items: [{ href: '/spectator', label: 'Spectator' }] },
];

export function parseVariant(v: string | null | undefined): NavVariant | null {
  return v === 'a' || v === 'b' ? v : null;
}

// Which variant to render. `beta` false (production) always yields null, whatever the URL or cookie say.
export function resolveVariant(beta: boolean, search: string, cookie: string): NavVariant | null {
  if (!beta) return null;
  const q = new URLSearchParams(search).get('nav');
  if (q !== null) return parseVariant(q);                  // ?nav=0 (or junk) clears
  const m = /(?:^|;\s*)wp-nav=([^;]*)/.exec(cookie);
  return parseVariant(m ? m[1] : null);
}

export function groupsFor<T>(variant: NavVariant | null, today: T[], simple: T[]): T[] {
  return variant ? simple : today;
}

export function cookieFor(variant: NavVariant | null): string {
  return variant
    ? `${NAV_COOKIE}=${variant}; path=/; max-age=${NAV_COOKIE_MAX_AGE}; samesite=lax`
    : `${NAV_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

// The group a path belongs to, for the flat variant's second row.
export function groupOfPath(groups: NavGroup[], path: string | null): NavGroup | undefined {
  if (!path) return undefined;
  return groups.find(g => g.items.some(i => path === i.href || path.startsWith(i.href + '/')));
}
