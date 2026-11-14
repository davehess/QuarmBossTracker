import { LAB_RAID } from '../people';
import type { NavGroup } from '../../siteHeaderView';

// The nav groups and links as Nav.tsx defines them today (same ids, labels and order), as plain data.
export const LAB_GROUPS: NavGroup[] = [
  { id: 'raid', label: 'Raid', items: [
    { href: '/raid', label: 'Raid HQ' }, { href: '/boards', label: 'Spawn boards' }, { href: '/buffs', label: 'Buffs' },
    { href: '/spectator', label: 'Spectator' }, { href: '/screen', label: 'Raid screen' }, { href: '/rolls', label: 'Rolls' },
  ] },
  { id: 'stats', label: 'Stats', items: [
    { href: '/parses', label: 'Parses' }, { href: '/leaderboards', label: 'Ranks' }, { href: '/pvp', label: 'PvP' },
    { href: '/roster', label: 'Roster' }, { href: '/raidhistory', label: 'Raid history' }, { href: '/fun', label: 'Fun' },
    { href: '/film', label: 'Film' },
  ] },
  { id: 'prep', label: 'Prep', items: [
    { href: '/start', label: 'Getting started' }, { href: '/guide', label: 'Raid guide' }, { href: '/db', label: 'Database' },
    { href: '/quartermaster', label: 'Quartermaster' }, { href: '/who', label: '/who' }, { href: '/pop', label: 'PoP flags' },
    { href: '/roadmap', label: 'Roadmap' },
  ] },
];

export const LAB_MEMBER = LAB_RAID[2].name;

// Three "now" values for version B (a Wednesday raid week in November, Eastern time is UTC-5).
export const LAB_NOWS = {
  before: { iso: '2026-11-11T23:20:00Z', label: 'Raid day, 6:20 PM ET' },
  live: { iso: '2026-11-12T02:10:00Z', label: 'Mid-raid, 9:10 PM ET' },
  off: { iso: '2026-11-14T17:00:00Z', label: 'Off day, Saturday noon ET' },
} as const;
export type LabNowKey = keyof typeof LAB_NOWS;

export const LAB_RECENT = ['/parses', '/boards', '/raid'];
