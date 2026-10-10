// Per-page link-preview descriptions (the guild lead, 2026-07-08: shared links must
// unfurl with THAT page's description, not the site-wide one).
//
// Served to link-preview crawlers by /api/embed-meta (middleware rewrites
// bot user-agents there — crawlers can't sign in, so they never see the real
// pages). Add an entry when adding a member-facing route; unknown paths fall
// back to the site default.
//
// ⚠ THIS FILE, NOT A PAGE'S `export const metadata`, IS WHAT DISCORD READS. The middleware rewrites every
// preview crawler to /api/embed-meta, so a page's own metadata only ever reaches a browser tab. A route
// missing from here unfurls as the site-wide card (FB-71, 2026-10-10: "discord embedded links for the
// feedback links are generic. all links from our site should include at least top level information and
// the page name. make it a rule"). test/page-metadata.test.js walks every page.tsx under web/app and fails
// if its route still resolves to the site default.
//
// ⚠ PRIVACY: the crawler is anonymous and these cards are public. Put in a card only what a signed-out
// visitor could already see: the page's name, a catalog name (an item, spell or NPC is Daybreak game
// data, not guild data) or a number in the URL. NEVER a member's words, name, notes or logs, never a
// parse's boss or numbers. The only database reads are in pageMetaData.ts, one small select each.
// This file stays pure (no database, no `@/` imports) so a test can run it.

import { guildByCode } from './zealIcons';
import { statusWords, parseRefParam } from './feedbackReport';

export const SITE_NAME = 'WolfPack.quest';
export const DEFAULT_DESCRIPTION =
  'Guild-wide build planner, parse history, and loadout library for Project Quarm.';

// image: an optional picture for the card (a path under web/public), for pages meant to be posted.
export type PageMeta = { title: string; description: string; image?: string };

const STATIC_META: Record<string, PageMeta> = {
  '/':             { title: 'WolfPack.quest', description: DEFAULT_DESCRIPTION },
  '/pop':          { title: 'PoP Flags', description: 'The guild’s road to Quarm — every flag gate by tier, how many raiders hold each flag, who can enter each zone today, and what to raid next to move the most people forward.' },
  '/pop/guide':    { title: 'PoP Checklist', description: 'Every Planes of Power step in order — what to say to whom, where they stand, and whether it is solo, group or raid work. Tick it off per character.' },
  '/roster':       { title: 'Raid Roster', description: 'Typical raiders by role and class — 60-day raid attendance from DKP ticks, tanks/healers/DPS grouped, notable alts called out.' },
  '/parses':       { title: 'Boss Kills & Parses', description: 'Per-night kill cards with merged damage parses, loot, and attendance for every raid.' },
  '/boards':       { title: 'Raid Boards', description: 'Instanced boss cooldowns and spawn windows, by expansion — the live raid-target board.' },
  '/buffs':        { title: 'Buff Coverage', description: 'Who has what raid buffs right now — class-by-class coverage vs role targets, gaps flagged.' },
  '/who':          { title: '/who Directory', description: 'Every character sighted in game — class, level, guild, and last seen, searchable.' },
  '/pvp':          { title: 'PvP Kills', description: 'Wolf Pack PvP leaderboard — kills, assists, unique victims, and PvP-server boss timers.' },
  '/pvp/hate':     { title: 'Plane of Hate Tracker', description: 'PvP Plane of Hate tracker — kills, camps, and contested timers.' },
  '/pvp/server':   { title: 'Server PvP Top 10', description: 'Server-wide PvP kill leaders on Project Quarm.' },
  '/leaderboards': { title: 'Leaderboards', description: 'Top damage parses, raid attendance, and DKP spent — who’s been crushing it lately.' },
  '/fun':          { title: 'Fun Counters', description: 'The guild record book — running gags, counters, and trophies from the logs.' },
  '/film':         { title: 'Aten Ha Ra', description: 'The Wolf Pack film of the Aten Ha Ra kill — every raider called by name, in two takes of the song.' },
  '/film/making':  { title: 'How the film was made', description: 'The Aten Ha Ra film from the inside — find your raider, how every name is sung, every picture and animation take, and the outtakes.', image: '/film/making-of.jpg' },
  '/raidhistory':  { title: 'Raid History', description: 'Every raid night on one grid, coloured by how full the raid was — red at half, green at full — with the raid name and a link to each night’s review.' },
  '/rolls':        { title: 'Roll Nights', description: 'Off-night NBG loot rolls by raid night — every session, the winning roll, who actually looted each drop, and Hot Dice callouts.' },
  '/me':           { title: 'My Stats', description: 'Your characters, tells, buffs, and personal history — private to you.' },
  '/me/parses':    { title: '[beta] My parses', description: 'Your own parses on a chart over a day, a week or a month, with your average for each raid night.' },
  '/loadouts':     { title: 'Tank Loadouts', description: 'Bandolier sets across the raid — who runs what weapons and procs.' },
  '/planner':      { title: 'Loadout Planner', description: 'Theory-craft weapon setups from the item database with hate-per-minute estimates.' },
  '/bards':        { title: 'Bard Melodies', description: 'Live bard song rotations across the raid.' },
  '/raid':         { title: 'Live Raid', description: 'The raid right now — who’s in, groups, HP, and buffs, live from Zeal.' },
  '/spectator':    { title: '[beta] Spectator', description: 'The raid on a map, live — everyone’s position in the zone they are in, with the zone’s walls underneath.' },
  '/screen':       { title: '[beta] Raid screen', description: 'One page the whole raid watches — the map, slides, loot or an overview, switched by the raid leader and followed live.' },
  '/mimic':        { title: 'Download Mimic', description: 'Mimic — the Wolf Pack desktop overlay: DPS/Tank Meter, triggers, buff queue, and log sync for Project Quarm.' },
  '/mimic/dirge':  { title: 'Dirge Tactical Nuke', description: 'For bards, on the Mimic beta: check off your pre-buffs, lift the cover, turn the Puretone key, and fire one button per Dirge your mana holds. Watch it run.', image: '/mimic/dirge-card.png' },
  '/feedback':     { title: 'Feedback', description: 'Bugs, ideas, kudos — straight to the officer inbox.' },
  '/roadmap':      { title: 'Roadmap', description: 'What’s shipped and what’s next for the Wolf Pack platform.' },
  '/ai':           { title: 'Built with AI', description: 'The working method behind the platform: the rules, the incident behind each one, and a timeline you can scrub.' },
  '/zeal-icons':   { title: '[beta] Zeal tag icons', description: 'Guild banners and icons for Zeal /tag — the keys to type, and picture files to download.' },
  // Added 2026-10-10 (every page unfurls with its own name): the routes that had no entry.
  '/about':        { title: 'About', description: 'How a Discord bot that answered one question grew into a four-part raid platform for Project Quarm, and what it does now.' },
  '/shortabout':   { title: 'The short version', description: 'The Wolf Pack platform in two minutes: how it grew, where it lives, and the numbers.' },
  '/start':        { title: 'Getting started', description: 'Install Wolf Pack miMIC and start uploading, step by step.' },
  '/privacy':      { title: 'Privacy', description: 'Plain-words privacy statement for Mimic, the Discord bot and wolfpack.quest: what stays on your machine and what the guild sees.' },
  '/platform':     { title: 'The Platform', description: 'From a Discord respawn timer to a four-component raid intelligence platform: the map of everything Wolf Pack built.' },
  '/platform/architecture': { title: 'How it works', description: 'Every overlay, dashboard and integration in the Wolf Pack platform, and the path one line of your combat log takes to reach the guild.' },
  '/db':           { title: 'Item & spell database', description: 'Search every item, spell, NPC and faction on Project Quarm, with drop tables and where things come from.' },
  '/search':       { title: 'Search', description: 'Search characters, items, spells and NPCs across the site.' },
  '/quartermaster': { title: 'Quartermaster', description: 'Guild logistics: what the bank holds, what is spoken for, and what still needs sourcing.' },
  '/opendkp':      { title: 'OpenDKP traffic', description: 'Live count of every API request Wolf Pack sends to OpenDKP.' },
  '/guide':        { title: 'Raid guide', description: 'How Wolf Pack does each fight: positioning, assignments and callouts, written by the people who run them.' },
  '/raid/plan':    { title: 'Fight cards', description: 'The pre-raid readiness page: one card per fight with the composition, kit and tactics it needs, and which callouts are armed.' },
  '/raid/review':  { title: 'Raid night review', description: 'The morning-after list of recent raid nights, each with its full breakdown.' },
  '/test-server':  { title: 'Practice server proposal', description: 'A proposal for a private practice server: why, what it costs, where to host it, and a place to say you are interested.' },
  '/fun/lord-of-ire': { title: 'Lord of Ire', description: 'Every Lord of Ire vanquished, rolled up per main with the alt split underneath.' },
  '/me/inventory': { title: 'My inventory', description: 'Every item across your characters and where it sits, in one searchable list. Private to you.' },
  '/me/tells':     { title: 'My tells', description: 'Your inbound /tell history. Private to you.' },
  '/me/ui':        { title: 'UI Studio', description: 'Your characters’ macros and backed-up UI files, with edits staged for the machine that runs them. Private to you.' },
  '/mimic/mini':   { title: 'Mimic mini mode', description: 'Every overlay in a version that takes less room: see the three renditions, vote for the one you would raid with, and say why.' },
  '/mimic/beta':   { title: 'Download Mimic beta', description: 'The Mimic beta channel: fixes land here first, for testers who want them early.' },
  '/mimic/linux':  { title: 'Download Mimic for Linux', description: 'Mimic for Linux and the Steam Deck (experimental): the Wolf Pack desktop overlay and log sync.' },
  '/auth/signin':  { title: 'Sign in', description: 'Sign in to WolfPack.quest with your Discord account.' },
  '/auth/mimic-link': { title: 'Link Mimic', description: 'Link the Mimic desktop app to your Discord account with the six-character code it shows.' },
  '/auth/claim':   { title: 'Site access invite', description: 'Accept a Wolf Pack site-access invite by choosing a username and password.' },
};

// Officer pages. The name of an admin page is not a secret (the repo is public), so each unfurls as
// "<name> · Admin" rather than one shared "Officer Tools" card. Anything under /admin not listed here
// still gets the shared card, and the test fails for a real page that is missing.
const ADMIN_DESCRIPTION = 'A Wolf Pack officer page. Officer sign-in required.';
const ADMIN_TITLES: Record<string, string> = {
  '/admin':                    'Officer tools',
  '/admin/adoption':           'Adoption',
  '/admin/agents':             'Agent uploaders',
  '/admin/analytics':          'Page analytics',
  '/admin/anomalies':          'Data anomalies',
  '/admin/attendance':         'Attendance',
  '/admin/audit':              'Audit log',
  '/admin/chat':               'Chat browser',
  '/admin/comp':               'Raid composition',
  '/admin/console':            'Officer console',
  '/admin/encounters':         'Encounter repair',
  '/admin/extra-spells':       'Extra PoP spells',
  '/admin/feedback':           'Feedback',
  '/admin/feedback/anonymous': 'Anonymous feedback',
  '/admin/links':              'Character links',
  '/admin/lockouts':           'Raid lockouts',
  '/admin/loot':               'Loot by value',
  '/admin/members':            'Members',
  '/admin/notices':            'Mimic Mail',
  '/admin/overlays':           'Overlay tuning',
  '/admin/quarmy':             'Quarmy links',
  '/admin/quests':             'Quests',
  '/admin/queue':              'Review queue',
  '/admin/readiness':          'Raid kit readiness',
  '/admin/rules':              'Guild rules',
  '/admin/signups':            'Sign-ups',
  '/admin/spells':             'Spell exchange',
  '/admin/triggers':           'Guild triggers',
  '/admin/voice':              'Voice triggers',
  '/admin/who':                'Who',
};
export const ADMIN_FALLBACK_TITLE = 'Officer Tools';

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }   // a bad %-escape must not 500 the card
}

// ── Dynamic routes ──────────────────────────────────────────────────────────

// /feedback/FB-<n>. Category and status ONLY: a report's words, submitter, notes and log are private
// (only the submitter and officers may open it) and the crawler is anonymous. Every value that reaches the
// card goes through a closed vocabulary below, so a raw database string can never leak into it.
const FEEDBACK_BETA = '[beta] ';   // the page still wears NewPageTag (DECISIONS §135)
const FEEDBACK_DESCRIPTION = 'A Wolf Pack feedback report. Sign in to read it and reply.';
export function feedbackMeta(ref: number | null, category?: string | null, status?: string | null): PageMeta {
  if (!ref) return { title: `${FEEDBACK_BETA}Feedback report`, description: FEEDBACK_DESCRIPTION };
  const kind = category === 'bug' ? 'Bug report' : category === 'idea' ? 'Idea' : 'Feedback';
  // No row found / lookup failed: say only the number.
  if (category === undefined && status === undefined) {
    return { title: `${FEEDBACK_BETA}FB-${ref} · Feedback report`, description: FEEDBACK_DESCRIPTION };
  }
  return { title: `${FEEDBACK_BETA}FB-${ref} · ${kind} · ${statusWords(status).label}`, description: FEEDBACK_DESCRIPTION };
}

// Catalog entities. The name is Daybreak game data (an item, a spell, an NPC), not guild data, so it may
// ride on the card even though the page behind it needs a sign-in. The description is the page's KIND, never
// its numbers: no stats, no drop tables, no parse figures.
export type EntityKind = 'item' | 'spell' | 'npc' | 'faction' | 'recipe' | 'boss' | 'guide' | 'bardset';
const ENTITY: Record<EntityKind, { label: string; sentence: string; beta?: boolean }> = {
  item:    { label: 'Item',       sentence: 'An item on Project Quarm: stats, who drops it and where it is sold.' },
  spell:   { label: 'Spell',      sentence: 'A spell on Project Quarm: effects, mana, duration and resist type.' },
  npc:     { label: 'NPC',        sentence: 'An NPC on Project Quarm: stats, spawn locations and what it drops.' },
  faction: { label: 'Faction',    sentence: 'A faction on Project Quarm: what raises it, what lowers it and the turn-ins that move it.' },
  recipe:  { label: 'Recipe',     sentence: 'A tradeskill recipe on Project Quarm: skill, trivial and every component.', beta: true },
  boss:    { label: 'Boss',       sentence: 'A Wolf Pack raid target: kill history, spawn timers and drops.' },
  guide:   { label: 'Raid guide', sentence: 'How Wolf Pack does this fight: positioning, assignments and callouts.' },
  bardset: { label: 'Bard set',   sentence: 'A bard setup built by the guild: song rotations, spell sets, clickies and potions.' },
};
// EQEmu names carry a leading "#" and underscores for spaces; one line, no control characters, bounded.
export function cleanEntityName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^#/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
export function entityMeta(kind: EntityKind, rawName?: unknown): PageMeta {
  const e = ENTITY[kind];
  const name = cleanEntityName(rawName);
  const beta = e.beta ? '[beta] ' : '';
  return name
    ? { title: `${beta}${name} · ${e.label}`, description: `${name} — ${e.sentence}` }
    : { title: `${beta}${e.label}`, description: e.sentence };
}

// A character page names the character from the URL alone (no database read), so a hidden or
// stats-excluded character leaks nothing the link itself did not already say, and a made-up name is not
// confirmed to exist. Letters only, like the page's own guard.
export function characterName(raw: string | null | undefined): string | null {
  const clean = safeDecode(String(raw ?? '')).trim();
  if (!/^[A-Za-z]{2,24}$/.test(clean)) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}
const CHARACTER_SECTIONS: Record<string, { label: string; blurb: string }> = {
  gear:      { label: 'Gear',       blurb: 'what they wear and their raid-kit readiness' },
  inventory: { label: 'Inventory',  blurb: 'what they carry and bank' },
  spells:    { label: 'Spells',     blurb: 'the spells they have and the ones still missing' },
  factions:  { label: 'Factions',   blurb: 'where their faction standing sits' },
  quests:    { label: 'Quests',     blurb: 'how far along their quests are' },
};
export function characterMeta(rawName: string, section?: string | null): PageMeta {
  const name = characterName(rawName);
  const sec = section ? CHARACTER_SECTIONS[section] : undefined;
  if (!name) {
    return sec
      ? { title: `Character ${sec.label.toLowerCase()}`, description: `A character’s ${sec.label.toLowerCase()} page on WolfPack.quest.` }
      : { title: 'Character', description: 'A character page on WolfPack.quest: parses, loot, attendance and raid history.' };
  }
  return sec
    ? { title: `${name} · ${sec.label}`, description: `${name}’s ${sec.label.toLowerCase()} on WolfPack.quest: ${sec.blurb}.` }
    : { title: `${name} · Character`, description: `${name} on WolfPack.quest: parses, loot, attendance and raid history.` };
}

export function pvpMeta(rawName: string): PageMeta {
  const name = characterName(rawName);
  return name
    ? { title: `${name} · PvP record`, description: `${name}’s PvP kills, victims and kill history on the Zeks.` }
    : { title: 'PvP record', description: 'One killer’s PvP kills, victims and kill history on the Zeks.' };
}

// /raid/review/<yyyy-mm-dd>: the date is in the URL, nothing else is read.
export function raidReviewMeta(rawDate: string): PageMeta {
  const description = 'A morning-after review of one Wolf Pack raid night: kills, deaths, loot and fight timelines.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safeDecode(rawDate));
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) {
      const when = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return { title: `Raid night review · ${when}`, description };
    }
  }
  return { title: 'Raid night review', description };
}

// Which routes need ONE small database read to name themselves (pageMetaData.ts does the read). Everything
// else above is answered from the URL. null = nothing to look up.
export type Lookup =
  | { kind: 'feedback'; ref: number }
  | { kind: 'item' | 'spell' | 'npc' | 'faction' | 'recipe' | 'boss'; id: number }
  | { kind: 'guide' | 'bardset'; id: string };
const DB_ROUTES: Array<[RegExp, 'item' | 'spell' | 'npc' | 'faction' | 'recipe']> = [
  [/^\/db\/item\/(\d+)$/, 'item'],
  [/^\/db\/spell\/(\d+)$/, 'spell'],
  [/^\/db\/npc\/(\d+)$/, 'npc'],
  [/^\/db\/faction\/(\d+)$/, 'faction'],
  [/^\/db\/recipe\/(\d+)$/, 'recipe'],
];
function cleanPath(rawPath: string): string {
  return (rawPath || '/').replace(/\/+$/, '') || '/';
}
export function lookupFor(rawPath: string): Lookup | null {
  const path = cleanPath(rawPath);
  let m = path.match(/^\/feedback\/([^/]+)$/);
  if (m) { const ref = parseRefParam(m[1]); return ref ? { kind: 'feedback', ref } : null; }
  for (const [rx, kind] of DB_ROUTES) {
    m = path.match(rx);
    if (m) return { kind, id: Number(m[1]) };
  }
  m = path.match(/^\/boss\/(\d+)$/);
  if (m) return { kind: 'boss', id: Number(m[1]) };
  m = path.match(/^\/guide\/([^/]+)$/);
  if (m) return { kind: 'guide', id: safeDecode(m[1]).slice(0, 80) };
  m = path.match(/^\/bards\/sets\/([^/]+)$/);
  if (m) return { kind: 'bardset', id: safeDecode(m[1]).slice(0, 80) };
  return null;
}

// What a link to this path unfurls as, from the path alone. For the routes `lookupFor` names this is the
// generic kind card ("Item", "Bug report"); pageMetaData.ts upgrades it with the name when the read works.
export function metaForPath(rawPath: string): PageMeta {
  const path = cleanPath(rawPath);
  const hit = STATIC_META[path];
  if (hit) return hit;
  if (/^\/admin(\/|$)/.test(path)) {
    const t = ADMIN_TITLES[path];
    return t
      ? { title: `${t} · Admin`, description: ADMIN_DESCRIPTION }
      : { title: ADMIN_FALLBACK_TITLE, description: 'Wolf Pack officer tools — sign-in required.' };
  }
  let m = path.match(/^\/feedback\/([^/]+)$/);
  if (m) return feedbackMeta(parseRefParam(m[1]));
  for (const [rx, kind] of DB_ROUTES) if (rx.test(path)) return entityMeta(kind);
  if (/^\/boss\/[^/]+$/.test(path)) return entityMeta('boss');
  if (/^\/guide\/[^/]+$/.test(path)) return entityMeta('guide');
  if (/^\/bards\/sets\/[^/]+$/.test(path)) return entityMeta('bardset');
  m = path.match(/^\/raid\/review\/([^/]+)$/);
  if (m) return raidReviewMeta(m[1]);
  m = path.match(/^\/character\/([^/]+)(?:\/([^/]+))?/);
  if (m) return characterMeta(m[1], m[2]);
  m = path.match(/^\/pvp\/([^/]+)$/);
  if (m) return pvpMeta(m[1]);
  m = path.match(/^\/zeal-icons\/([^/]+)$/);
  const guild = m ? guildByCode(safeDecode(m[1])) : undefined;
  if (guild) {
    return { title: `[beta] ${guild.name} — Zeal tag icon`, description: `${guild.name}'s banner and icon for Zeal /tag: ^B${guild.code}^ and ^I${guild.code}^.` };
  }
  if (/^\/parses\/[^/]+$/.test(path)) {
    // Deliberately NOT the boss, date or DPS: a parse is guild data that /parses/<id> hides from a signed-out
    // visitor, and this card is read by an anonymous crawler.
    return { title: 'Parse Breakdown', description: 'Per-player damage, abilities, and boss-kill comparison for one encounter.' };
  }
  return { title: SITE_NAME, description: DEFAULT_DESCRIPTION };
}
