// test/me-hub.test.js — the /me?v=b hub (the guild lead, 2026-10-31: "main page should be everything about the main,
// then account and links to all of their stuff", then "it needs to load immediately then fill in"; DECISIONS §481).
//
// What holds here:
//   · the default /me never renders the hub, and ?v=b does so BEFORE any of the classic page's loaders run;
//   · the three sections come in the order main, account, all your stuff;
//   · the shell awaits nothing and every data block sits behind its own <Suspense> whose skeleton is the block's height;
//   · every link in the directory is a route that exists in web/app;
//   · the hub reads no table or column the classic /me does not already read for the same viewer (the one declared
//     exception is the upload-stamp line, pinned below);
//   · the main is never a character that opted out of stats, and its inventory/spells times are withheld when the
//     member switched inventory sync off.
//
// The source assertions run on comment-stripped text (a comment can answer for code). Behaviour is run for real where
// the code is pure (lib/meHub.ts).
//
// Run: npx vitest run test/me-hub.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  pickMain, mimicStatus, syncStatus, characterLinks, hubEntry, HUB_GROUPS, CHARACTER_PAGES,
  topFights, lootSummary, sessionForNight, replayHref, NIGHT_ROLLOVER_MS,
} from '../web/lib/meHub.ts';
import { parsePicks, pickedSet } from '../web/lib/replayFollow.ts';
import { DEFAULT_DESCRIPTION } from '../web/lib/pageMeta.ts';

const WEB = path.join(ROOT, 'web');
const APP = path.join(WEB, 'app');
const src = (...p) => stripJs(fs.readFileSync(path.join(WEB, ...p), 'utf8'));

const PAGE = src('app', 'me', 'page.tsx');
const HUB = src('app', 'me', 'MeHub.tsx');
const BLOCKS = src('app', 'me', 'MeHubBlocks.tsx');
const LOAD = src('lib', 'meHubLoad.ts');
const TOUR_BTN = src('app', 'me', 'HubTourButton.tsx');

// ── routes that exist ──────────────────────────────────────────────────────────────────────────────────────
function walkRoutes(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(full, out);
    else if (e.name === 'page.tsx' || e.name === 'route.ts') {
      const route = '/' + path.relative(APP, path.dirname(full)).split(path.sep).join('/');
      out.push(route.replace(/^\/\.$/, '/'));
    }
  }
  return out;
}
const ROUTES = walkRoutes(APP);
const ROUTE_RX = ROUTES.map(r => new RegExp('^' + r.replace(/\[[^\]]+\]/g, '[^/]+') + '$'));
const routeExists = (href) => {
  const p = href.split('?')[0].replace(/\/$/, '') || '/';
  return ROUTE_RX.some(rx => rx.test(p));
};

describe('the variant is chosen before anything is loaded', () => {
  const fnStart = PAGE.indexOf('export default async function MePage');
  const hubAt = PAGE.indexOf('<MeHub');

  it('the hub is rendered in exactly one place, behind the ?v=b test', () => {
    expect(PAGE.match(/<MeHub\b/g)).toHaveLength(1);
    expect(PAGE).toMatch(/const variantB = \(await searchParams\)\?\.v === 'b';/);
    expect(PAGE).toMatch(/if \(variantB\) return <MeHub userId=\{user\.id\} \/>;/);
  });

  it('nothing from the classic page is awaited ahead of the hub (only the query, cookies and sign-in)', () => {
    const before = PAGE.slice(fnStart, hubAt);
    const awaited = [...before.matchAll(/await\s+([A-Za-z_.()]+)/g)].map(m => m[1]);
    expect(awaited.length).toBeGreaterThan(0);
    for (const a of awaited) expect(a).toMatch(/^(searchParams|cookies|supabase\.auth\.getUser)\b/);
  });

  it('the classic path is still after it: loaders and the character cards', () => {
    const after = PAGE.slice(hubAt);
    expect(after).toMatch(/await loadOwnedCharacters\(user\.id\)/);
    expect(after).toMatch(/<MeCharacterCards\b/);
  });

  it('the page keeps its own metadata and the hub imports no classic loader', () => {
    expect(PAGE).toMatch(/title: 'My stats'/);
    expect(HUB + BLOCKS + LOAD).not.toMatch(/app\/me\/page|from '\.\/page'/);
  });
});

describe('three sections, in order', () => {
  const ids = ['hub-main', 'hub-account', 'hub-stuff'];
  it('the h2s are Your main, Your account, All your stuff, in that order', () => {
    const heads = [...HUB.matchAll(/<h2 id="([^"]+)" className=\{h2\}>([^<]+)<\/h2>/g)].map(m => [m[1], m[2]]);
    expect(heads).toEqual([['hub-main', 'Your main'], ['hub-account', 'Your account'], ['hub-stuff', 'All your stuff']]);
    const at = ids.map(i => HUB.indexOf(`aria-labelledby="${i}"`));
    expect(at.every(n => n > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('the tour pointer is at the top, before the first section', () => {
    expect(HUB.indexOf('<HubTourButton')).toBeGreaterThan(0);
    expect(HUB.indexOf('<HubTourButton')).toBeLessThan(HUB.indexOf('aria-labelledby="hub-main"'));
  });
});

describe('load at once, fill in behind Suspense', () => {
  const blocks = [...BLOCKS.matchAll(/export async function (\w+)\(/g)].map(m => m[1]);
  it('the blocks exist and the shell is neither async nor awaits anything', () => {
    expect(blocks).toEqual(expect.arrayContaining([
      'MainIdentity', 'MainFreshness', 'MainRecord', 'MainBest', 'MainLoot', 'MainRaids', 'MainUploads',
      'AccountMimic', 'AccountDiscord', 'AccountCharacters', 'DirectoryCharacters',
    ]));
    expect(HUB).toMatch(/export default function MeHub\(/);
    expect(HUB).not.toMatch(/\basync\b|\bawait\b/);
  });
  it('every block is rendered inside its own <Suspense> with a skeleton of its slot height', () => {
    for (const b of blocks) {
      const m = HUB.match(new RegExp(`<Suspense fallback=\\{<Skeleton h=\\{SLOT\\.(\\w+)\\} />\\}>\\s*<${b} userId=\\{userId\\} />\\s*</Suspense>`));
      expect(m, `${b} is not wrapped in its own Suspense with a sized skeleton`).not.toBeNull();
      // and the block fills the same slot, so the fill-in does not move what is below
      const body = BLOCKS.slice(BLOCKS.indexOf(`export async function ${b}(`));
      // (a block's last minHeight is the one on the element it finally returns)
      const own = body.slice(0, body.indexOf('\nexport ') > 0 ? body.indexOf('\nexport ') : undefined);
      const heights = [...own.matchAll(/minHeight: ([^\s}]+)/g)].map(x => x[1]);
      expect(heights.at(-1), `${b} does not fill its skeleton's height`).toBe(`SLOT.${m[1]}`);
    }
  });
  it('no two blocks share a boundary (one Suspense per block)', () => {
    expect(HUB.match(/<Suspense\b/g).length).toBe(blocks.length);
  });
  it('a failed read degrades in place instead of throwing for the page', () => {
    expect(BLOCKS).toMatch(/function Failed\(/);
    expect((BLOCKS.match(/\.catch\(/g) || []).length).toBeGreaterThanOrEqual(blocks.length);
  });
});

describe('every link in "All your stuff" is a route that exists', () => {
  const staticHrefs = [
    ...HUB_GROUPS.flatMap(g => g.hrefs),
    ...[...HUB.matchAll(/'(\/[a-z][^']*)'/g)].map(m => m[1]),
    ...characterLinks('Aldenmar').map(l => l.href),
    ...[...BLOCKS.matchAll(/href="(\/[^"]+)"/g)].map(m => m[1]),
    // a template href, each ${...} stood in for by a name or id
    ...[...BLOCKS.matchAll(/href=\{`(\/[^`]+)`\}/g)].map(m => m[1].replace(/\$\{[^}]*(?:\([^)]*\))?[^}]*\}/g, 'X')),
  ];
  it('has links to check', () => {
    expect(HUB_GROUPS.map(g => g.title)).toEqual(['Raiding', 'Tools', 'Mimic and help']);
    expect(CHARACTER_PAGES.length).toBeGreaterThanOrEqual(6);
    expect(staticHrefs.length).toBeGreaterThan(20);
  });
  it('each href resolves to a page.tsx (or the /mimic route.ts) under web/app', () => {
    for (const h of staticHrefs) expect(routeExists(h), `${h} has no page in web/app`).toBe(true);
  });
  it('each page-group entry takes a title and sentence from pageMeta, never the site default', () => {
    for (const h of HUB_GROUPS.flatMap(g => g.hrefs)) {
      const e = hubEntry(h);
      expect(e.title.length, h).toBeGreaterThan(2);
      expect(e.description, h).not.toBe(DEFAULT_DESCRIPTION);
      expect(e.title, h).not.toMatch(/^\[beta\]/i);
    }
    expect(hubEntry('/me/upgrades').beta).toBe(true);
  });
  it('the character links for a name carry that name (and encode it)', () => {
    const ls = characterLinks('Aldenmar');
    expect(ls.map(l => l.key)).toEqual(['public', 'gear', 'inventory', 'spells', 'quests', 'factions', 'upgrades']);
    expect(ls.find(l => l.key === 'gear').href).toBe('/character/Aldenmar/gear');
    expect(ls.find(l => l.key === 'upgrades').href).toBe('/me/upgrades?c=Aldenmar');
  });
});

describe('the hub reads nothing the classic /me does not already read', () => {
  const READS = LOAD + '\n' + BLOCKS + '\n' + HUB;
  const colsByTable = (text) => {
    const out = new Map();
    for (const m of text.matchAll(/\.from\('(\w+)'\)\s*\.select\('([^']+)'\)/g)) {
      const set = out.get(m[1]) ?? new Set();
      m[2].split(',').map(s => s.trim()).filter(Boolean).forEach(c => set.add(c));
      out.set(m[1], set);
    }
    return out;
  };
  // What the classic page reads: its own selects plus the helpers it calls (fetchCharAggs, fetchLiveStateRows).
  const CAP = src('lib', 'capSafeReads.ts');
  const classic = colsByTable(PAGE + '\n' + CAP);
  const hub = colsByTable(READS);

  // THE declared table exceptions: a table the classic /me page does not select from, read by the hub for a block the
  // guild lead asked for (2026-10-31). Each names the page that already reads the same columns, and that read is
  // asserted below, so an exception cannot drift from its source or grow a column unseen.
  const TABLE_EXCEPTIONS = {
    raid_track_minutes: { cols: 'night_key, minute_at, zones, raiders', source: ['app', 'raid', 'session', 'page.tsx'], why: 'the recorded session a raid night links its replay to' },
  };
  const RPC_EXCEPTIONS = {
    my_parse_series_v2: { source: ['app', 'me', 'parses', 'page.tsx'], why: 'the best-fights lists: the series /me/parses and the Mimic tab read' },
  };

  it('has selects to check', () => {
    expect([...hub.keys()].sort()).toEqual([
      'agent_upload_stats', 'characters', 'eqemu_npc_types', 'opendkp_loot_recent', 'opendkp_raids', 'opendkp_ticks',
      'raid_track_minutes', 'wolfpack_members',
    ]);
  });
  it('every table the hub selects from is one the classic page selects from, column by column (bar the declared exceptions)', () => {
    for (const [table, cols] of hub) {
      if (TABLE_EXCEPTIONS[table]) continue;
      expect(classic.has(table), `${table} is not read by /me`).toBe(true);
      for (const c of cols) expect(classic.get(table).has(c), `${table}.${c} is not read by /me`).toBe(true);
    }
  });
  it('each declared table exception is a real addition, read with exactly the columns of the page it names', () => {
    for (const [table, ex] of Object.entries(TABLE_EXCEPTIONS)) {
      expect(classic.has(table), `${table} is read by /me now: drop it from the exceptions`).toBe(false);
      expect([...hub.get(table)].sort(), `${table} columns`).toEqual(ex.cols.split(', ').sort());
      const theirs = colsByTable(src(...ex.source)).get(table);
      expect(theirs, `${ex.source.join('/')} no longer reads ${table}`).toBeDefined();
      expect([...hub.get(table)].every(c => theirs.has(c)), `${table} has a column ${ex.source.join('/')} does not read`).toBe(true);
      expect(ex.why.length).toBeGreaterThan(10);
    }
  });
  it('every RPC the hub calls is one /me calls, or a declared exception another page already calls', () => {
    const rpcs = (t) => new Set([...t.matchAll(/\.rpc\('(\w+)'/g)].map(m => m[1]));
    const classicRpc = rpcs(PAGE + CAP);
    // the hub's own file calls only the exception; the levels helpers below make the rest
    expect([...rpcs(READS)].sort()).toEqual(Object.keys(RPC_EXCEPTIONS));
    for (const [name, ex] of Object.entries(RPC_EXCEPTIONS)) {
      expect(classicRpc.has(name), `/me calls ${name} now: drop it from the exceptions`).toBe(false);
      expect(rpcs(src(...ex.source)).has(name), `${ex.source.join('/')} no longer calls ${name}`).toBe(true);
    }
    expect(LOAD).toMatch(/loadLevels\(supabaseAdmin\(\), owned\.map\(c => c\.name\)\)/);
    expect(classicRpc.has('me_levels')).toBe(true);
    expect(rpcs(src('lib', 'listableChars.ts')).has('me_levels')).toBe(true);
  });
  it('every new read is bounded: paged through selectAll or one capped rpc, and the guild-wide one is scoped by guild', () => {
    const mins = LOAD.slice(LOAD.indexOf(".from('raid_track_minutes')"));
    expect(mins.slice(0, mins.indexOf('.range(')).replace(/\s+/g, ' ')).toMatch(/\.eq\('guild_id', GUILD_TAG\) \.gte\('minute_at', recFrom\)/);
    expect(LOAD).toMatch(/const FIGHTS_CAP = 400;/);
    expect(LOAD).toMatch(/p_cap: FIGHTS_CAP/);
    for (const t of ['opendkp_raids', 'opendkp_ticks', 'opendkp_loot_recent', 'raid_track_minutes']) {
      const at = LOAD.indexOf(`.from('${t}')`);
      expect(LOAD.slice(Math.max(0, at - 120), at), `${t} is not paged through selectAll`).toMatch(/selectAll<[^>]+>\(\(from, to\) => (admin|sb)\s*$/);
      expect(LOAD.slice(at, at + 700), `${t} is not ranged`).toMatch(/\.range\(from, to\)/);
    }
  });
  it('the parse numbers and live state come from the classic helpers, not a copy', () => {
    expect(LOAD).toMatch(/fetchCharAggs\(admin, \[name\]\)/);
    expect(LOAD).toMatch(/fetchLiveStateRows\(supabaseAdmin\(\), \[name\]\)/);
    expect(PAGE).toMatch(/fetchCharAggs\(admin, names\)/);
    expect(PAGE).toMatch(/fetchLiveStateRows\(supabaseAdmin\(\), charNames\)/);
  });
  it('THE declared exception: the "Last upload" line reads the upload-stamp columns, through the shared helper, for the signed-in owner\'s own main', () => {
    const stampCols = colsByTable(src('lib', 'uploadFreshnessServer.ts')).get('characters');
    expect([...stampCols].some(c => !classic.get('characters').has(c))).toBe(true);   // so this IS an addition, not hidden
    expect(BLOCKS).toMatch(/loadUploadStampRow\(c\.name\)/);
    expect(READS).not.toMatch(/quarmy_synced_at|inventory_synced_at|spellbook_synced_at|observed_at/);   // only via the helper
    // The roster read (shared with the other member pages) also carries main_name_override; the hub never touches it.
    expect(READS).not.toMatch(/main_name_override/);
  });
});

describe('privacy gates', () => {
  it('a character that opted out of stats is never the main', () => {
    const mk = (name, o = {}) => ({ name, main_name: null, class: 'Cleric', rank: 'Raid Pack', active: true, level: 60, tier: 'listed', hidden: false, excludeStats: false, excludeInventory: false, ...o });
    const chars = [mk('Aldenmar', { excludeStats: true }), mk('Brackwyn', { level: 55 })];
    expect(pickMain(chars, () => null)).toEqual({ name: 'Brackwyn', explicit: true });
    expect(pickMain([mk('Aldenmar', { excludeStats: true })], () => null)).toBeNull();
  });
  it('the directory and the alts list leave out stat-excluded characters; the switches list keeps them so they can come back', () => {
    expect(BLOCKS).toMatch(/const shown = chars\.filter\(c => !c\.excludeStats\);/);
    expect(BLOCKS).toMatch(/const others = chars\.filter\(c => !c\.excludeStats && c\.name !== main\?\.char\.name\);/);
    expect(BLOCKS).toMatch(/<ul className="mt-2 space-y-2">\{chars\.map\(switchRow\)\}<\/ul>/);
  });
  it('inventory and spells times are withheld when inventory sync is off', () => {
    expect(BLOCKS).toMatch(/c\.excludeInventory \? Promise\.resolve\(undefined\) : uploadStampsFor\('inventory'/);
    expect(BLOCKS).toMatch(/c\.excludeInventory \? Promise\.resolve\(undefined\) : uploadStampsFor\('spells'/);
  });
  it('only the signed-in member\'s own userId reaches a loader', () => {
    expect(PAGE).toMatch(/<MeHub userId=\{user\.id\} \/>/);
    expect(HUB + BLOCKS).not.toMatch(/searchParams|params\./);
  });
});

describe('pickMain', () => {
  const mk = (name, o = {}) => ({ name, main_name: null, class: 'Warrior', rank: 'Raid Pack', active: true, level: 60, tier: 'listed', hidden: false, excludeStats: false, excludeInventory: false, ...o });
  it('takes the first family root in list order, and calls that an explicit main', () => {
    const chars = [mk('Aldenmar', { main_name: 'Brackwyn' }), mk('Brackwyn'), mk('Corvale')];
    expect(pickMain(chars, () => null)).toEqual({ name: 'Brackwyn', explicit: true });
  });
  it('a root named in its own main_name still counts as a root', () => {
    expect(pickMain([mk('Aldenmar', { main_name: 'aldenmar' })], () => null)).toEqual({ name: 'Aldenmar', explicit: true });
  });
  it('puts a tucked-away root (trader, hidden) behind a listed one', () => {
    const chars = [mk('Aldenmar', { tier: 'hidden', rank: 'Trader' }), mk('Brackwyn')];
    expect(pickMain(chars, () => null).name).toBe('Brackwyn');
    expect(pickMain([mk('Aldenmar', { tier: 'hidden', hidden: true })], () => null).name).toBe('Aldenmar');
  });
  it('with no root, stands in the character heard from most recently and says it is not explicit', () => {
    const chars = [mk('Aldenmar', { main_name: 'Ghostmain' }), mk('Brackwyn', { main_name: 'Ghostmain' })];
    const seen = { aldenmar: '2026-10-01T00:00:00Z', brackwyn: '2026-10-30T00:00:00Z' };
    expect(pickMain(chars, n => seen[n.toLowerCase()] ?? null)).toEqual({ name: 'Brackwyn', explicit: false });
  });
  it('shows the "set your main" line only for a stand-in', () => {
    expect(BLOCKS).toMatch(/\{!explicit && \(/);
    expect(BLOCKS).toMatch(/ask an officer to link them there/);
  });
});

describe('the Mimic line', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  const rel = (iso) => `rel(${iso})`;
  const ago = (min) => new Date(now - min * 60000).toISOString();
  it('syncStatus thresholds are 10 minutes and 6 hours', () => {
    expect(syncStatus(ago(9), now)).toBe('live');
    expect(syncStatus(ago(11), now)).toBe('recent');
    expect(syncStatus(ago(6 * 60 + 1), now)).toBe('stale');
    expect(syncStatus(null, now)).toBe('never');
  });
  it('green when live, orange when earlier, red when never, dim with no characters', () => {
    expect(mimicStatus([{ name: 'Aldenmar', lastSeen: ago(2), lastFight: ago(30) }], now, rel))
      .toMatchObject({ color: 'green', headline: 'Mimic is connected on Aldenmar.' });
    expect(mimicStatus([{ name: 'Aldenmar', lastSeen: ago(120), lastFight: null }], now, rel).color).toBe('orange');
    expect(mimicStatus([{ name: 'Aldenmar', lastSeen: ago(60 * 48), lastFight: null }], now, rel).headline).toBe('Mimic is offline.');
    expect(mimicStatus([{ name: 'Aldenmar', lastSeen: null, lastFight: null }], now, rel).color).toBe('red');
    expect(mimicStatus([], now, rel).color).toBe('dim');
  });
});

describe('the tour pointer starts the existing tour', () => {
  it('fires the event the tour listens for, and the tour is untouched', () => {
    const tour = src('components', 'GuidedTour.tsx');
    expect(TOUR_BTN).toMatch(/new Event\('wp-tour-start'\)/);
    expect(tour).toMatch(/addEventListener\('wp-tour-start'/);
    expect(TOUR_BTN.startsWith("'use client';")).toBe(true);
  });
});

// ── Your main: best fights, loot and DKP, raids with the replay, and the upload spot (the guild lead, 2026-10-31) ──
describe('best fights', () => {
  const f = (eid, dmg, dps, t = '2026-10-20T01:00:00Z', o = {}) => ({ eid, name: `Mob ${eid}`, zone: null, t, dmg, dps, char: 'Aldenmar', ...o });
  it('ranks by damage and by DPS separately, a tie going to the newer fight, five at most', () => {
    const fights = [f('a', 500, 10), f('b', 900, 5), f('c', 900, 7, '2026-10-25T01:00:00Z'), f('d', 100, 99), f('e', 300, 8), f('g', 200, 6), f('h', 50, 1)];
    expect(topFights(fights, 'dmg').map(x => x.eid)).toEqual(['c', 'b', 'a', 'e', 'g']);
    expect(topFights(fights, 'dps').map(x => x.eid)).toEqual(['d', 'a', 'e', 'c', 'g']);
    expect(topFights(fights, 'dmg', 2)).toHaveLength(2);
  });
  it('a fight with no damage is not a best fight, and nothing in means nothing out', () => {
    expect(topFights([f('z', 0, 0), f('y', Number.NaN, 5)], 'dmg')).toEqual([]);
    expect(topFights([], 'dps')).toEqual([]);
  });
  it('is read for the main alone, from the series /me/parses reads, and every fight links to its parse page', () => {
    expect(LOAD).toMatch(/p_character: name,/);
    expect(LOAD).toMatch(/f\.char\.toLowerCase\(\) === name\.toLowerCase\(\)/);
    expect(LOAD).toMatch(/p_discord_id: pack\.discordId/);
    expect(LOAD).toMatch(/p_bosses_only: true/);
    expect(BLOCKS).toMatch(/href=\{`\/parses\/\$\{f\.eid\}`\}/);
    expect(BLOCKS).toMatch(/loadMainFights\(userId, main\.char\.name\)/);
  });
  it('the top-fight cell of the record links its parse', () => {
    expect(BLOCKS).toMatch(/`\/parses\/\$\{a\.top_encounter_id\}`/);
  });
});

describe('latest loot and DKP', () => {
  const row = (character_name, item_name, dkp, raid_date) => ({ character_name, item_name, dkp, raid_date, raid_name: 'r' });
  it('sums DKP for the main and for every character, and lists the main\'s newest awards first', () => {
    const rows = [
      row('Aldenmar', 'Sword', 120, '2026-10-01'), row('aldenmar', 'Helm', 80, '2026-10-20'),
      row('Brackwyn', 'Ring', 40, '2026-10-25'), row('Aldenmar', 'Cloak', null, '2026-10-10'),
    ];
    const s = lootSummary(rows, 'ALDENMAR');
    expect(s.mainSpent).toBe(200);
    expect(s.mainItems).toBe(3);
    expect(s.allSpent).toBe(240);
    expect(s.allItems).toBe(4);
    expect(s.latest.map(l => l.item_name)).toEqual(['Helm', 'Cloak', 'Sword']);
  });
  it('shows six awards at most and copes with none', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row('Aldenmar', `Item ${i}`, 1, `2026-10-0${i + 1}`));
    expect(lootSummary(rows, 'Aldenmar').latest).toHaveLength(6);
    expect(lootSummary([], 'Aldenmar')).toMatchObject({ latest: [], mainSpent: 0, allSpent: 0 });
  });
  it('reads only characters that have not opted out of stats, and says the balance is not here', () => {
    expect(LOAD).toMatch(/\(await loadHubChars\(userId\)\)\.filter\(c => !c\.excludeStats\)\.map\(c => c\.name\)/);
    expect(LOAD).toMatch(/\.in\('character_name', names\)/);
    expect(BLOCKS).toMatch(/live balance is OpenDKP&apos;s own number/);
    expect(BLOCKS).not.toMatch(/current_dkp|CurrentDKP/i);
  });
});

describe('raids the main was in, and the replay with the main highlighted', () => {
  const ET_NIGHT = (ms) => dayKeyOf(ms - NIGHT_ROLLOVER_MS);
  const dayKeyOf = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const s = (iso, minutes, raid = true) => ({ from: Date.parse(iso), to: Date.parse(iso) + minutes * 60000, minutes, raid });
  it('a night\'s session is the guild-raid stretch that started that night, the longest if there are several', () => {
    // 20:30 ET on Thu Oct 29 2026 is 00:30 UTC on the 30th
    const evening = s('2026-10-30T00:30:00Z', 200);
    const shortOne = s('2026-10-30T01:00:00Z', 30);
    const daytime = s('2026-10-29T15:00:00Z', 300, false);
    const nextNight = s('2026-11-02T00:30:00Z', 240);
    expect(sessionForNight('2026-10-29', [daytime, shortOne, evening, nextNight], ET_NIGHT)).toBe(evening);
    expect(sessionForNight('2026-11-01', [daytime, shortOne, evening, nextNight], ET_NIGHT)).toBe(nextNight);
  });
  it('a session that begins after midnight still belongs to the night before; a daytime or unrecorded night has none', () => {
    const afterMidnight = s('2026-10-30T04:20:00Z', 90);   // 00:20 ET on the 30th
    expect(sessionForNight('2026-10-29', [afterMidnight], ET_NIGHT)).toBe(afterMidnight);
    expect(sessionForNight('2026-10-30', [afterMidnight], ET_NIGHT)).toBeNull();
    expect(sessionForNight('2026-10-29', [s('2026-10-30T00:30:00Z', 200, false)], ET_NIGHT)).toBeNull();
    expect(sessionForNight('2026-10-29', [], ET_NIGHT)).toBeNull();
  });
  it('the replay link names the window and follows the main; /raid/session reads that as a followed, highlighted raider', () => {
    const from = Date.parse('2026-10-30T00:30:00Z'), to = from + 200 * 60000;
    const href = replayHref(from, to, 'Aldenmar');
    expect(href.startsWith('/raid/session?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('from')).toBe('2026-10-30T00:30:00.000Z');
    expect(q.get('to')).toBe('2026-10-30T03:50:00.000Z');
    const picks = parsePicks('?' + href.split('?')[1]);
    expect(picks.follow).toBe('Aldenmar');
    expect(pickedSet(picks).has('aldenmar')).toBe(true);
  });
  it('the replay board takes its picks from the address whether or not a caller bounds the window (so no new replay code)', () => {
    const board = src('app', 'spectator', 'replay', 'ReplayBoard.tsx');
    const at = board.indexOf('setPicks(parsePicks(window.location.search));');
    expect(at).toBeGreaterThan(0);
    const effect = board.slice(board.lastIndexOf('useEffect(', at), board.indexOf('setUrlReady(true)', at));
    expect(effect).not.toMatch(/bounded|urlsRef/);
    expect(src('app', 'raid', 'session', 'SessionReview.tsx')).toMatch(/ReplayBoard/);
  });
  it('the block links each recorded night with the MAIN\'s name, and a night with no recording says so', () => {
    expect(BLOCKS).toMatch(/const name = main\.char\.name;\s*const raids = await loadMainRaids\(name\)/);
    expect(BLOCKS).toMatch(/replayHref\(r\.from, r\.to, name\)/);
    expect(BLOCKS).toMatch(/no recording/);
    expect(BLOCKS).toMatch(/href=\{`\/raid\/review\/\$\{r\.date\}`\}/);
  });
  it('the nights are the classic rule, for the main alone: official raids, ticks the main is in', () => {
    expect(LOAD).toMatch(/\.overlaps\('attendees', \[name\]\)/);
    expect(LOAD).toMatch(/buildNights\(raids, mine\)/);
    expect(LOAD).toMatch(/filter\(n => n\.tickIds\.length > 0\)/);
    expect(LOAD).toMatch(/const RAIDS_SHOWN = 5;/);
  });
});

describe('the upload spot', () => {
  const UP = src('app', 'me', 'MeHubUploads.tsx');
  it('reuses the classic inventory, keys and spellbook uploads, unchanged', () => {
    for (const c of ['InventoryUpload', 'KeysUpload', 'SpellbookUpload']) {
      expect(UP).toMatch(new RegExp(`import ${c} from './${c}';`));
      expect(UP).toMatch(new RegExp(`<${c} character=\\{picked\\.name\\} />`));
      expect(PAGE).toMatch(new RegExp(`<${c} character=\\{c\\.name\\} />`));
    }
    expect(UP.startsWith("'use client';")).toBe(true);
  });
  it('offers only characters that have not opted out of stats, the main first, and says Mimic does it for you', () => {
    expect(BLOCKS).toMatch(/chars\.filter\(c => !c\.excludeStats\)\.map\(c => \(\{ name: c\.name, excludeInventory: c\.excludeInventory \}\)\)/);
    expect(BLOCKS).toMatch(/initial=\{main\?\.char\.name \?\? pickable\[0\]\.name\}/);
    expect(BLOCKS).toMatch(/Mimic uploads these for you/);
  });
  it('a character whose inventory sync is off gets no upload widgets', () => {
    expect(UP).toMatch(/\{picked\.excludeInventory \? \(/);
    const widgets = UP.indexOf('<InventoryUpload');
    expect(widgets).toBeGreaterThan(UP.indexOf('picked.excludeInventory ?'));
  });
});
