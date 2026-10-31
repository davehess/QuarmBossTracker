// The admin sidebar's contents (the guild lead, 2026-10-31, DECISIONS §493: "distilled into the most used up top and
// least used down the bottom, with all of the catastrophic or destructive moves down the bottom in red barriers").
//
// ONE list feeds the sidebar (app/admin/AdminShell.tsx) and the landing's cards (app/admin/page.tsx), so the two cannot
// disagree about where a page lives. Order is by when a raid night needs a page, not by usage: no per-page usage data
// exists (the middleware never logs /admin sub-pages). Rarely used pages share a line.
//
// Pure (no server imports): test/admin-shell.test.js checks the groups, their order, that the danger group is last, and
// that every link resolves to a page file.
import { ADMIN_TITLES } from './pageMeta';
import { hrefPath, isCurrent } from './adminShell';

export type CountKey = 'lockouts' | 'agents' | 'feedback';

export type NavLink = {
  href: string;
  /** Shown text. Absent → the page's own title in ADMIN_TITLES (lib/pageMeta.ts), so a rename lands in one place. */
  label?: string;
  /** The page is not on this branch yet (a link that would 404 is shown but not followed). */
  soon?: boolean;
  /** Highlight only on this exact path (a page whose own sub-page sits beside it in the list). */
  exact?: boolean;
};

export type NavLine = {
  links: NavLink[];
  /** A live number from lib/adminShellFacts.ts, shown beside the line's first link. */
  count?: CountKey;
  /** Sub-items shown beneath the line (the anonymous inbox under Feedback). */
  sub?: NavLink[];
};

export type NavGroup = {
  id: 'raid' | 'between' | 'data' | 'danger';
  title: string;
  blurb: string;
  lines: NavLine[];
  /** Member-facing pages the old grid also linked to: not under /admin, listed small at the foot of the group. */
  elsewhere?: NavLink[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'raid',
    title: 'Raid night',
    blurb: 'What a raid needs while it is running.',
    lines: [
      { links: [{ href: '/admin/console' }] },
      { links: [{ href: '/admin/lockouts' }], count: 'lockouts' },
      { links: [{ href: '/admin/voice' }] },
      { links: [{ href: '/admin/triggers' }] },
      { links: [{ href: '/admin/agents' }], count: 'agents' },
      { links: [{ href: '/admin/notices' }] },
      { links: [{ href: '/admin/overlays', label: 'Overlay tuning' }] },
    ],
  },
  {
    id: 'between',
    title: 'Between raids',
    blurb: 'The people, the data and the housekeeping.',
    lines: [
      { links: [{ href: '/admin/members', label: 'Members' }, { href: '/admin/links', label: 'Links' }] },
      {
        links: [{ href: '/admin/feedback', exact: true }], count: 'feedback',
        sub: [{ href: '/admin/feedback/anonymous' }],
      },
      { links: [{ href: '/admin/encounters' }] },
      { links: [{ href: '/admin/signups', label: 'Sign-ups' }, { href: '/admin/comp', label: 'Comp' }, { href: '/admin/readiness', label: 'Readiness' }] },
      {
        links: [
          { href: '/admin/loot', label: 'Loot' }, { href: '/admin/spells', label: 'Spells' },
          { href: '/admin/extra-spells', label: 'Extra spells' }, { href: '/admin/quests', label: 'Quests' },
        ],
      },
      { links: [{ href: '/admin/attendance' }] },
      { links: [{ href: '/admin/soft-reserve' }] },
      { links: [{ href: '/admin/queue' }] },
      { links: [{ href: '/admin/guests' }] },
      { links: [{ href: '/admin/quarmy' }] },
      { links: [{ href: '/admin/pronunciations', label: 'Pronunciations' }, { href: '/admin/voice-reports', label: 'Voice reports' }] },
    ],
  },
  {
    id: 'data',
    title: 'Data & site',
    blurb: 'Records, health and the rules of the site.',
    lines: [
      { links: [{ href: '/admin/audit', label: 'Audit' }, { href: '/admin/chat', label: 'Chat' }, { href: '/admin/analytics', label: 'Analytics' }] },
      { links: [{ href: '/admin/anomalies', label: 'Anomalies' }, { href: '/admin/adoption', label: 'Adoption' }] },
      { links: [{ href: '/admin/rules' }] },
      // The guild theme editor (web 2.1.80). test/admin-shell.test.js fails if a link's page file goes missing.
      { links: [{ href: '/admin/theme', label: 'Theme' }] },
      { links: [{ href: '/admin/access' }] },
      { links: [{ href: '/admin/flag-lab' }] },
    ],
    elsewhere: [
      { href: '/who', label: 'Who' },
      { href: '/quartermaster', label: 'Quartermaster' },
      { href: '/loadouts', label: 'Loadouts' },
      { href: '/planner', label: 'Planner' },
    ],
  },
  {
    id: 'danger',
    title: 'Danger zone',
    blurb: 'Fleet-wide or irreversible. Each one asks you to type a phrase.',
    lines: [
      { links: [{ href: '/admin/overlays#danger', label: 'Fleet pause & shed' }] },
      { links: [{ href: '/admin/access', label: 'Lock a member out' }] },
      { links: [{ href: '/admin/encounters#danger', label: 'Delete / merge data' }] },
    ],
  },
];

export { hrefPath, isCurrent };

/** What a link says: its own label, else its page's title. */
export function linkLabel(l: NavLink): string {
  return l.label ?? ADMIN_TITLES[hrefPath(l.href)] ?? hrefPath(l.href);
}

/** The page title for a link's tooltip (its full name, where the sidebar label is short). */
export function linkTitle(l: NavLink): string {
  return ADMIN_TITLES[hrefPath(l.href)] ?? linkLabel(l);
}

/** Every link in a group, sub-items and the "elsewhere" line included. */
export function groupLinks(g: NavGroup): NavLink[] {
  return [...g.lines.flatMap(l => [...l.links, ...(l.sub ?? [])]), ...(g.elsewhere ?? [])];
}
