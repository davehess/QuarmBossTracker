// The rules behind the /me?v=b hub (the guild lead, 2026-10-31: "main page should be everything about the main, then
// account and links to all of their stuff"; DECISIONS §481): which character is the member's main, how long ago a
// character was heard from, and the directory of the member's own pages. Pure (no database, no `@/` imports) so a
// test can run it; the reads are in meHubLoad.ts and the page in app/me/MeHub.tsx.

import { metaForPath } from './pageMeta';
import { tierOf, type ListTier } from './listableChars';

// One of the member's characters as the hub sees it. `main_name` follows the roster: empty (or the character's own
// name) means the character is the root of its family, which is what every page on the site calls "a main".
export type HubChar = {
  name: string;
  main_name: string | null;
  class: string | null;
  rank: string | null;
  active: boolean;
  level: number | null;
  tier: ListTier;
  hidden: boolean;
  excludeStats: boolean;
  excludeInventory: boolean;
};

export const isRoot = (c: { name: string; main_name: string | null }): boolean =>
  !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase();

export type MainPick = { name: string; explicit: boolean };

// The member's main. A character that opted out of stats is never the main (the hub would be reading its stats). Among
// family roots the best-placed one wins (the list order is level high to low, so the highest level), tucked-away
// characters (a trader, under level 46, hidden by their owner) last. With no root at all (the main is opted out, or
// the family is filed under a name the member does not hold), the character heard from most recently stands in and
// `explicit` is false, which is what puts the "set your main" line under it. `lastSeen` is the newest upload time per
// lower-cased name; it is only consulted for that fallback.
export function pickMain(chars: HubChar[], lastSeen: (name: string) => string | null): MainPick | null {
  const pool = chars.filter(c => !c.excludeStats);
  if (pool.length === 0) return null;
  const roots = pool.filter(isRoot);
  const best = (list: HubChar[]) =>
    list.find(c => c.tier !== 'hidden') ?? list.find(c => !c.hidden) ?? list[0];
  if (roots.length > 0) return { name: best(roots).name, explicit: true };
  let pick = best(pool);
  let at = lastSeen(pick.name) ?? '';
  for (const c of pool) {
    const t = lastSeen(c.name) ?? '';
    if (t > at) { pick = c; at = t; }
  }
  return { name: pick.name, explicit: false };
}

// How a character's newest upload reads: "live" within 10 minutes, "recent" within 6 hours, then "stale". The same
// thresholds the classic /me banner uses.
export type SyncStatus = 'live' | 'recent' | 'stale' | 'never';
export function syncStatus(lastSeenIso: string | null, nowMs: number): SyncStatus {
  if (!lastSeenIso) return 'never';
  const age = nowMs - new Date(lastSeenIso).getTime();
  return age <= 10 * 60 * 1000 ? 'live' : age <= 6 * 60 * 60 * 1000 ? 'recent' : 'stale';
}

// The one-line answer to "is Mimic sending my data?", from each character's newest upload (any stream) and newest
// fight upload. The wording and thresholds are the classic /me banner's. `rel` turns a time into "5m ago".
export type MimicBanner = { color: 'green' | 'orange' | 'red' | 'dim'; headline: string; sub: string };
export function mimicStatus(
  rows: { name: string; lastSeen: string | null; lastFight: string | null }[],
  nowMs: number,
  rel: (iso: string | null) => string,
): MimicBanner {
  if (rows.length === 0) return { color: 'dim', headline: 'No characters linked yet.', sub: 'Link one to start syncing.' };
  const status = rows.map(r => ({ ...r, s: syncStatus(r.lastSeen, nowMs) }));
  const live = status.filter(r => r.s === 'live');
  const recent = status.filter(r => r.s === 'recent');
  const seen = status.filter(r => r.lastSeen).sort((a, b) => b.lastSeen!.localeCompare(a.lastSeen!));
  if (live.length > 0) {
    const lastFight = live.map(r => r.lastFight).filter((x): x is string => !!x).sort().pop() ?? null;
    return {
      color: 'green',
      headline: live.length === 1 ? `Mimic is connected on ${live[0].name}.` : `Mimic is connected on ${live.length} characters.`,
      sub: lastFight
        ? `Streaming in the last 10 minutes · last fight uploaded ${rel(lastFight)}.`
        : 'Streaming in the last 10 minutes · no fight uploaded yet this session.',
    };
  }
  if (recent.length > 0) {
    return { color: 'orange', headline: 'Mimic was connected earlier today but isn\'t right now.', sub: `Last seen ${rel(seen[0].lastSeen)}. Launch Mimic to keep streaming.` };
  }
  if (seen.length > 0) {
    return { color: 'orange', headline: 'Mimic is offline.', sub: `Last seen ${rel(seen[0].lastSeen)}. Launch Mimic to resume.` };
  }
  return { color: 'red', headline: 'No uploads recorded for your characters.', sub: 'Make sure Mimic is running; the Getting started page walks through it.' };
}

// ── The directory ("All your stuff") ───────────────────────────────────────────────────────────────────────
// A character's own pages, one column each in the table. The blurbs are written here because the site's page cards
// name the character in every sentence; the member pages below take theirs from pageMeta.ts instead.
export const CHARACTER_PAGES: { key: string; label: string; blurb: string; path: (enc: string) => string }[] = [
  { key: 'public',    label: 'Page',      blurb: 'The public page: parses, loot, attendance and raid history.', path: e => `/character/${e}` },
  { key: 'gear',      label: 'Gear',      blurb: 'What they wear and their raid-kit readiness.',               path: e => `/character/${e}/gear` },
  { key: 'inventory', label: 'Inventory', blurb: 'What they carry and bank.',                                  path: e => `/character/${e}/inventory` },
  { key: 'spells',    label: 'Spells',    blurb: 'The spells they have and the ones still missing.',           path: e => `/character/${e}/spells` },
  { key: 'quests',    label: 'Quests',    blurb: 'How far along their quests are.',                            path: e => `/character/${e}/quests` },
  { key: 'factions',  label: 'Factions',  blurb: 'Where their faction standing sits.',                         path: e => `/character/${e}/factions` },
  { key: 'upgrades',  label: 'Upgrades',  blurb: 'The best upgrade for each worn slot.',                       path: e => `/me/upgrades?c=${e}` },
];

export function characterLinks(name: string): { key: string; label: string; href: string }[] {
  const enc = encodeURIComponent(name);
  return CHARACTER_PAGES.map(p => ({ key: p.key, label: p.label, href: p.path(enc) }));
}

// The member's own pages that are not about one character. Titles and sentences come from pageMeta.ts (the card
// text for the same route), so the directory and the unfurl cannot drift apart.
export const HUB_GROUPS: { title: string; hrefs: string[] }[] = [
  { title: 'Raiding', hrefs: ['/me/parses', '/me/wishlist', '/raid/sr', '/pop/raid/me', '/pop/guide'] },
  { title: 'Tools', hrefs: ['/me/upgrades', '/me/inventory', '/me/ui', '/me/voice', '/me/tells', '/me/accounts'] },
  { title: 'Mimic and help', hrefs: ['/mimic', '/auth/mimic-link', '/start', '/feedback', '/privacy'] },
];

export type HubEntry = { href: string; title: string; description: string; beta: boolean };
export function hubEntry(href: string): HubEntry {
  const m = metaForPath(href.split('?')[0]);
  return {
    href,
    title: m.title.replace(/^\[beta\]\s*/i, ''),
    description: m.description,
    beta: /^\[beta\]/i.test(m.title),
  };
}

// ── "Your main": best fights, loot and raids ───────────────────────────────────────────────────────────────
// The pure rules behind the hub's best-fights, loot and raids blocks (the guild lead, 2026-10-31: "highest damage,
// best fights, latest loot and dkp total, raids I was in and a link to that raid replay with me highlighted").

/** The few fields of a fight the best-fights lists rank and print (a ParseFight from lib/parseTrend.ts has them). */
export type FightLite = { eid: string; name: string; zone: string | null; t: string; dmg: number; dps: number; char: string };

/** The `n` best fights by total damage or by DPS, a tie going to the newer fight. A fight with nothing in it is not a best. */
export function topFights<T extends FightLite>(fights: readonly T[], by: 'dmg' | 'dps', n = 5): T[] {
  return fights
    .filter(f => Number.isFinite(f[by]) && f[by] > 0)
    .slice()
    .sort((a, b) => b[by] - a[by] || Date.parse(b.t) - Date.parse(a.t) || a.eid.localeCompare(b.eid))
    .slice(0, n);
}

/** One OpenDKP award, as the loot block reads it. */
export type LootLite = { character_name: string; item_name: string | null; dkp: number | null; raid_date: string | null; raid_name: string | null };

export type LootSummary = {
  /** The main's newest awards. */
  latest: LootLite[];
  /** DKP spent by the main alone, and by every character the member holds (the guild pools DKP onto the main). */
  mainSpent: number; mainItems: number;
  allSpent: number; allItems: number;
};

/** Awards -> what the loot block shows. Names are matched without case, as the roster is. */
export function lootSummary(rows: readonly LootLite[], mainName: string, n = 6): LootSummary {
  const key = mainName.toLowerCase();
  const mine = rows.filter(r => r.character_name.toLowerCase() === key);
  const spent = (list: readonly LootLite[]) => list.reduce((s, r) => s + (Number(r.dkp) || 0), 0);
  const newest = (a: LootLite, b: LootLite) => String(b.raid_date ?? '').localeCompare(String(a.raid_date ?? ''));
  return {
    latest: mine.slice().sort(newest).slice(0, n),
    mainSpent: spent(mine), mainItems: mine.length,
    allSpent: spent(rows), allItems: rows.length,
  };
}

/** A raid night starts in the evening and runs past midnight; shifting an instant back this far lands it on the night's date. */
export const NIGHT_ROLLOVER_MS = 6 * 60 * 60 * 1000;

/** The recorded sessions the replay knows (lib/raidReplay.ts ReplaySession has these fields). */
export type SessionLite = { from: number; to: number; minutes: number; raid: boolean };

/** The raid session that belongs to an OpenDKP night: a guild-raid session whose start falls on that night, the longest if several. */
export function sessionForNight<T extends SessionLite>(date: string, sessions: readonly T[], nightOf: (ms: number) => string): T | null {
  const hits = sessions.filter(s => s.raid && nightOf(s.from) === date);
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.minutes > a.minutes ? b : a));
}

/**
 * The replay of one recorded window with one raider followed (and so highlighted): /raid/session reads `follow` from
 * its own address (lib/replayFollow.ts parsePicks), and says "not recorded at this moment" when that raider is not in
 * the picture, so the link needs no roster check.
 */
export function replayHref(fromMs: number, toMs: number, follow: string): string {
  const q = new URLSearchParams({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), follow });
  return `/raid/session?${q.toString()}`;
}
