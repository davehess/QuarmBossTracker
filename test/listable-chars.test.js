// test/listable-chars.test.js — traders, low-level and unknown-level characters stay out of character lists.
//
// The guild lead, 2026-10-03: "low level characters do not need to show up on the pop flag page. all of
// my traders and mule characters destroy my views anywhere we display all of our logs."
// And the same day: "put any unknown characters into a minimized area and make it so I can hide these
// characters from anything but account inventory".
//
// The rule (web/lib/listableChars.ts) is run for real; the pages are checked for the wiring that applies
// it, over comment-stripped source (a comment can quote any of these strings). Fixture names are invented.
//
// Run: npx vitest run test/listable-chars.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, AGENT_INDEX, sliceBlock, evalBlock, stripJs, stripSql } from './_source-slice.js';
import {
  LIST_MIN_LEVEL, isListable, partitionListable, tierOf, partitionTiers, frontTierOf,
  loadLevels, loadTraderNames, loadHiddenNames,
} from '../web/lib/listableChars.ts';
import { GUILD_TAG } from '../web/lib/guild.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('isListable (run for real)', () => {
  it('hides a Trader at any level, whatever the case', () => {
    expect(isListable({ rank: 'Trader', level: 60 })).toBe(false);
    expect(isListable({ rank: 'trader', level: null })).toBe(false);
    expect(isListable({ rank: ' TRADER ', level: undefined })).toBe(false);
  });
  it('hides a level that is known and under 46, shows 46 and up', () => {
    expect(LIST_MIN_LEVEL).toBe(46);
    expect(isListable({ rank: 'Raid Alt', level: 20 })).toBe(false);
    expect(isListable({ rank: 'Raid Alt', level: 45 })).toBe(false);
    expect(isListable({ rank: 'Raid Alt', level: 46 })).toBe(true);
    expect(isListable({ rank: 'Raid Pack', level: 50 })).toBe(true);
  });
  it('keeps a non-trader whose level nobody has seen (no /who is not proof of a low level)', () => {
    expect(isListable({ rank: null, level: null })).toBe(true);
    expect(isListable({ rank: 'Raid Alt' })).toBe(true);
    expect(isListable({ rank: 'Non-raid Alt', level: undefined })).toBe(true);
    // me_levels and the agent report "unknown" as absent or 0, never as level zero.
    expect(isListable({ rank: 'Raid Alt', level: 0 })).toBe(true);
  });
  it('partitionListable keeps order and says who was tucked away', () => {
    const rows = [
      { name: 'Aldenmar', rank: 'Raid Pack', level: 60 },
      { name: 'Brackwyn', rank: 'Trader', level: null },
      { name: 'Corvale', rank: 'Raid Alt', level: 12 },
      { name: 'Rethlan', rank: null, level: null },
      { name: 'Nyssara', rank: 'Raid Alt', level: 46 },
    ];
    const { listed, hidden } = partitionListable(rows, r => r);
    expect(listed.map(r => r.name)).toEqual(['Aldenmar', 'Rethlan', 'Nyssara']);
    expect(hidden.map(r => r.name)).toEqual(['Brackwyn', 'Corvale']);
  });
});

describe('tierOf / partitionTiers (run for real)', () => {
  it('a known level of 46 or more is listed', () => {
    expect(tierOf({ rank: 'Raid Pack', level: 46 })).toBe('listed');
    expect(tierOf({ rank: null, level: 65 })).toBe('listed');
  });
  it('a character nobody has a level for is unknown, not hidden and not listed', () => {
    expect(tierOf({ rank: 'Raid Alt', level: null })).toBe('unknown');
    expect(tierOf({ rank: 'Raid Alt' })).toBe('unknown');
    expect(tierOf({ rank: null, level: undefined })).toBe('unknown');
    // me_levels and the agent say "unknown" as 0, never as level zero.
    expect(tierOf({ rank: 'Raid Alt', level: 0 })).toBe('unknown');
    expect(tierOf({ rank: 'Raid Alt', level: NaN })).toBe('unknown');
  });
  it('a Trader is hidden at any level, known or not', () => {
    expect(tierOf({ rank: 'Trader', level: 65 })).toBe('hidden');
    expect(tierOf({ rank: ' trader ', level: null })).toBe('hidden');
  });
  it('a known level under 46 is hidden', () => {
    expect(tierOf({ rank: 'Raid Alt', level: 45 })).toBe('hidden');
    expect(tierOf({ rank: 'Raid Alt', level: 1 })).toBe('hidden');
  });
  it('the owner’s switch hides a character even at 65, and one nobody has a level for', () => {
    expect(tierOf({ rank: 'Raid Pack', level: 65, hidden: true })).toBe('hidden');
    expect(tierOf({ rank: 'Raid Alt', level: null, hidden: true })).toBe('hidden');
    // false and null are "not hidden", the column's default.
    expect(tierOf({ rank: 'Raid Pack', level: 65, hidden: false })).toBe('listed');
    expect(tierOf({ rank: 'Raid Pack', level: 65, hidden: null })).toBe('listed');
    expect(tierOf({ rank: 'Raid Alt', level: null, hidden: false })).toBe('unknown');
  });
  it('isListable keeps its meaning: listed and unknown are listable, hidden is not', () => {
    expect(isListable({ rank: 'Raid Pack', level: 60 })).toBe(true);
    expect(isListable({ rank: 'Raid Alt', level: null })).toBe(true);
    expect(isListable({ rank: 'Trader', level: 60 })).toBe(false);
    expect(isListable({ rank: 'Raid Alt', level: 12 })).toBe(false);
    expect(isListable({ rank: 'Raid Pack', level: 65, hidden: true })).toBe(false);
  });
  it('partitionTiers sorts into three, order kept inside each tier', () => {
    const rows = [
      { name: 'Aldenmar', rank: 'Raid Pack', level: 60 },
      { name: 'Brackwyn', rank: 'Trader', level: null },
      { name: 'Corvale', rank: 'Raid Alt', level: 12 },
      { name: 'Rethlan', rank: null, level: null },
      { name: 'Nyssara', rank: 'Raid Alt', level: 46 },
      { name: 'Zarrin', rank: 'Raid Pack', level: 65, hidden: true },
      { name: 'Aldenmar2', rank: 'Raid Alt', level: undefined },
    ];
    const t = partitionTiers(rows, r => r);
    expect(t.listed.map(r => r.name)).toEqual(['Aldenmar', 'Nyssara']);
    expect(t.unknown.map(r => r.name)).toEqual(['Rethlan', 'Aldenmar2']);
    expect(t.hidden.map(r => r.name)).toEqual(['Brackwyn', 'Corvale', 'Zarrin']);
  });
  it('frontTierOf puts up the best tier anyone is in, so a page is never empty', () => {
    expect(frontTierOf(['hidden', 'unknown', 'listed'])).toBe('listed');
    expect(frontTierOf(['hidden', 'unknown', 'unknown'])).toBe('unknown');
    expect(frontTierOf(['hidden', 'hidden'])).toBe('hidden');
    expect(frontTierOf([])).toBe('hidden');
    expect(frontTierOf(new Map([['a', 'unknown']]).values())).toBe('unknown');
  });
});

describe('the loaders (against a fake client)', () => {
  it('loadLevels asks me_levels once, lowercases the keys and drops names with no level', async () => {
    const calls = [];
    const admin = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: [
      { name: 'aldenmar', level: 60 }, { name: 'Corvale', level: 12 }, { name: 'rethlan', level: 0 },
    ] }; } };
    const m = await loadLevels(admin, ['Aldenmar', 'Corvale', 'Rethlan', 'Aldenmar', '']);
    expect(calls).toEqual([['me_levels', { p_names: ['Aldenmar', 'Corvale', 'Rethlan'] }]]);
    expect(m.get('aldenmar')).toBe(60);
    expect(m.get('corvale')).toBe(12);
    expect(m.has('rethlan')).toBe(false);
  });
  it('loadLevels makes no call for an empty list', async () => {
    let called = false;
    const m = await loadLevels({ rpc: async () => { called = true; return { data: [] }; } }, []);
    expect(called).toBe(false);
    expect(m.size).toBe(0);
  });
  it('loadTraderNames reads the guild Traders by rank, case-blind, as lowercase names', async () => {
    const seen = [];
    const q = { select: (c) => { seen.push(['select', c]); return q; }, eq: (k, v) => { seen.push(['eq', k, v]); return q; },
      ilike: (k, v) => { seen.push(['ilike', k, v]); return q; },
      limit: async () => ({ data: [{ name: 'Zarrin' }, { name: 'Brackwyn' }] }) };
    const names = await loadTraderNames({ from: (t) => { seen.push(['from', t]); return q; } });
    expect(seen).toEqual([['from', 'characters'], ['select', 'name'], ['eq', 'guild_id', GUILD_TAG], ['ilike', 'rank', 'trader']]);
    expect([...names].sort()).toEqual(['brackwyn', 'zarrin']);
  });
  it('loadHiddenNames reads the characters their owner hid, as lowercase names', async () => {
    const seen = [];
    const q = { select: (c) => { seen.push(['select', c]); return q; }, eq: (k, v) => { seen.push(['eq', k, v]); return q; },
      limit: async () => ({ data: [{ name: 'Rethlan' }, { name: 'Nyssara' }] }) };
    const names = await loadHiddenNames({ from: (t) => { seen.push(['from', t]); return q; } });
    expect(seen).toEqual([['from', 'characters'], ['select', 'name'], ['eq', 'guild_id', GUILD_TAG], ['eq', 'hidden_from_lists', true]]);
    expect([...names].sort()).toEqual(['nyssara', 'rethlan']);
  });
});

describe('the pages apply it', () => {
  it('ownedCharacters carries rank and hidden_from_lists, and filters on neither', () => {
    const owned = stripJs(read('web/lib/ownedCharacters.ts'));
    // The roster is the shared, paged read (web/lib/roster.ts), which selects these columns for every page.
    expect(owned).toMatch(/await loadRoster\(\)/);
    expect(stripJs(read('web/lib/roster.ts'))).toMatch(/\.select\('name, class, rank, main_name, [^']*\bdiscord_id\b[^']*\bhidden_from_lists\b[^']*'\)/);
    expect(owned).toMatch(/\.map\(\(\{ name, main_name, class: cls, active, rank, hidden_from_lists \}\) => \(\{ name, main_name, class: cls, active, rank, hidden_from_lists \}\)\)/);
    // The account walk returns every character; only the lists above it tuck any away.
    expect(owned).not.toMatch(/\.(eq|neq|is|not)\('hidden_from_lists'/);
    expect(owned).not.toMatch(/\.hidden_from_lists/);
    expect(owned).not.toMatch(/listableChars/);
  });

  // "hide these characters from anything but account inventory" (the guild lead, 2026-10-03): account
  // inventory is the point of a mule, so none of its pages may apply a list rule or read the flag.
  it('account inventory, the quartermaster and the mule upload still show hidden characters', () => {
    const inv = fs.readdirSync(path.join(ROOT, 'web/app/me/inventory'), { recursive: true })
      .filter(f => /\.(ts|tsx)$/.test(String(f))).map(f => path.join('web/app/me/inventory', String(f)));
    expect(inv.length).toBeGreaterThan(0);
    for (const f of [...inv, 'web/app/quartermaster/page.tsx', 'web/app/me/MuleUpload.tsx', 'web/app/me/inventory-actions.ts']) {
      const src = stripJs(read(f));
      expect(src, f).not.toMatch(/listableChars/);
      expect(src, f).not.toMatch(/hidden_from_lists/);
    }
    // The inventory page still reads its characters from the unfiltered account walk.
    expect(stripJs(read('web/app/me/inventory/page.tsx'))).toMatch(/const chars = await ownedCharacters\(user\.id\);/);
  });

  it('/pop filters the viewer’s own list once, and the spell-needs rows, behind ?all=1', () => {
    const page = stripJs(read('web/app/pop/page.tsx'));
    expect(page).toMatch(/const showAll = allParam === '1';/);
    // The viewer's list and the spell-needs rows are split ONCE, and every use below reads the result.
    expect(page).toMatch(/partitionTiers\(myCharsAll, c => \(\{ rank: c\.rank, level: bestLevel\(c\.name, null\), hidden: c\.hidden_from_lists \}\)\)/);
    expect(page).toMatch(/partitionTiers\(spellNeedsAll, n => \(\{/);
    expect(page).toMatch(/const myChars = showAll \? myCharsAll : minePart\.listed;/);
    expect(page).toMatch(/const spellNeeds = showAll \? spellNeedsAll : needPart\.listed;/);
    expect(page).toMatch(/const scopedSpellNeeds = scope === 'all' \? spellNeeds : spellNeeds\.filter\(n => n\.isMain\);/);
    expect(page).toMatch(/const myNeeds = spellNeeds\.filter\(/);
    // A trader has no /who level, so its rank comes from the Trader names.
    expect(page).toMatch(/rank: traderNames\.has\(n\.name\.toLowerCase\(\)\) \? 'Trader' : null/);
    // The toggle follows the page's own link pattern and survives the other links.
    expect(page).toMatch(/all: showAll \? '1' : null,/);
    expect(page).toMatch(/if \(next\.all\) params\.set\('all', next\.all\);/);
    expect(page).toMatch(/hrefFor\(\{ all: showAll \? null : '1' \}\)/);
    expect(page).toMatch(/Show all \(\$\{hiddenNames\.size\} hidden/);
    expect(page).toMatch(/Traders, hidden characters and characters under \$\{LIST_MIN_LEVEL\} hidden\./);
    // The guild-wide chart, matrix and planner are untouched: still the raid roster at 60+.
    expect(page).toMatch(/popRoster\(rosterRows\.map/);
  });

  it('/pop folds the characters with no known level into a collapsed area under each list', () => {
    const page = stripJs(read('web/app/pop/page.tsx'));
    // The needs rows belong to other members, so the owner's flag is looked up by name, like the rank.
    expect(page).toMatch(/loadHiddenNames\(sbAdmin\)/);
    expect(page).toMatch(/hidden: flaggedHidden\.has\(n\.name\.toLowerCase\(\)\),/);
    // ?all=1 puts everything inline, so the fold is empty then.
    expect(page).toMatch(/const myUnknown = showAll \? \[\] : minePart\.unknown;/);
    expect(page).toMatch(/const unknownNeeds = showAll \? \[\] : needPart\.unknown;/);
    expect(page).toMatch(/const scopedUnknownNeeds = scope === 'all' \? unknownNeeds : unknownNeeds\.filter\(n => n\.isMain\);/);
    // The same fold in both places, wrapping the same table the listed rows use.
    expect(page).toMatch(/myUnknown\.length > 0 && noLevelFold\(myUnknown\.length, <MineTable rows=\{myUnknownSorted\} \/>\)/);
    expect(page).toMatch(/noLevelFold\(scopedUnknownNeeds\.length, <NeedsTable rows=\{scopedUnknownNeeds\} \/>\)/);
    expect(page).toMatch(/<MineTable rows=\{myCharsSorted\} \/>/);
    expect(page).toMatch(/<NeedsTable rows=\{scopedSpellNeeds\} \/>/);
    // The fold says what to do, and is closed by default.
    const fold = sliceBlock(page, 'const noLevelFold =', '</details>');
    expect(fold).toMatch(/<details className="[^"]*">/);
    expect(fold).not.toMatch(/<details[^>]*\sopen[\s=>]/);
    expect(fold).toMatch(/with no known level — upload a spellbook or get \{n === 1 \? 'it' : 'them'\} seen in \/who to place/);
    // Unknown characters are not hidden: the banner counts them apart.
    expect(page).toMatch(/\$\{unknownNames\.size\} no level/);
    // The /who sightings still cover them, so their gate marks are not lost by folding.
    expect(page).toMatch(/\.\.\.myUnknown\.map\(c => c\.name\)/);
  });

  it('the spellbook picker gets every owned character, grouped, and its row can shrink', () => {
    const page = stripJs(read('web/app/pop/page.tsx'));
    // From the tier split of ALL owned characters, never from the ?all-filtered myChars.
    expect(page).toMatch(/listed=\{minePart\.listed\.map\(c => c\.name\)\}/);
    expect(page).toMatch(/unknown=\{minePart\.unknown\.map\(c => c\.name\)\}/);
    expect(page).toMatch(/hidden=\{minePart\.hidden\.map\(c => c\.name\)\}/);
    expect(page).not.toMatch(/<SpellbookSubmit[^>]*characters=/);
    // The phone-width bug: a wrapper that cannot shrink pushed the page sideways.
    expect(page).toMatch(/<div className="min-w-0 max-w-full">\s*<SpellbookSubmit/);
    expect(page).not.toMatch(/shrink-0[^<]*>\s*<SpellbookSubmit/);

    const submit = stripJs(read('web/app/pop/SpellbookSubmit.tsx'));
    expect(submit).toMatch(/\{ listed, unknown, hidden \}: \{ listed: string\[\]; unknown: string\[\]; hidden: string\[\] \}/);
    // Default selection: the first listed character, then whatever there is.
    expect(submit).toMatch(/useState<string>\(listed\[0\] \?\? unknown\[0\] \?\? hidden\[0\] \?\? ''\)/);
    // Main options are the listed ones; the others sit below in optgroups, in this order.
    const select = sliceBlock(submit, '<select', '</select>');
    const at = (s) => select.indexOf(s);
    expect(at('{opts(listed)}')).toBeGreaterThan(-1);
    expect(at('<optgroup label="No known level">')).toBeGreaterThan(at('{opts(listed)}'));
    expect(at('<optgroup label="Hidden (traders, under 46, hidden by you)">')).toBeGreaterThan(at('<optgroup label="No known level">'));
    expect(select).toMatch(/\{opts\(unknown\)\}/);
    expect(select).toMatch(/\{opts\(hidden\)\}/);
    // Nothing in the row may force the page wider than a phone.
    expect(submit).toMatch(/className="flex flex-wrap items-center gap-2 text-xs min-w-0 max-w-full"/);
    expect(select).toMatch(/className="[^"]*\bmin-w-0 max-w-full"/);
    expect(stripJs(read('web/app/me/SpellbookUpload.tsx'))).toMatch(/<div className="text-xs min-w-0 max-w-full">/);
  });

  it('/pop only looks up the levels it cannot already read', () => {
    const page = stripJs(read('web/app/pop/page.tsx'));
    expect(page).toMatch(/spellNeedsAll\.filter\(n => n\.level == null \|\| n\.level < LIST_MIN_LEVEL\)/);
    expect(page).toMatch(/await loadLevels\(sbAdmin, lookup\)/);
  });

  it('/pop/guide hides them from the picker but keeps a character chosen in the URL', () => {
    const page = stripJs(read('web/app/pop/guide/page.tsx'));
    expect(page).toMatch(/const mineAll = await ownedCharacters\(user\.id\);/);
    expect(page).toMatch(/\.filter\(ch => !lowKeys\.has\(ch\.name\.toLowerCase\(\)\) \|\| ch\.name\.toLowerCase\(\) === picked\)/);
    expect(page).toMatch(/const picked = c\?\.toLowerCase\(\);/);
    expect(page).toMatch(/showAll \|\| lowKeys\.size === mineAll\.length/);
    // The tick action still authorizes against the full owned list, so a hidden character's ticks still save.
    expect(stripJs(read('web/app/pop/guide/actions.ts'))).not.toMatch(/listableChars/);
  });

  it('/pop/guide splits by tier, honours the owner’s switch, and groups unknown characters at the bottom of both pickers', () => {
    const page = stripJs(read('web/app/pop/guide/page.tsx'));
    expect(page).toMatch(/partitionTiers\(mineAll, ch => \(\{ rank: ch\.rank, level: levels\.get\(ch\.name\.toLowerCase\(\)\), hidden: ch\.hidden_from_lists \}\)\)/);
    expect(page).toMatch(/const lowKeys = new Set\(tiers\.hidden\.map\(ch => ch\.name\.toLowerCase\(\)\)\);/);
    expect(page).toMatch(/const noLevel = tiers\.unknown\.map\(ch => ch\.name\);/);
    // Unknown characters stay in the picker, so they are handed to both layouts, not filtered out.
    expect(page).toMatch(/<GuideRoute [^>]*noLevel=\{noLevel\} \/>/);
    expect(page).toMatch(/<GuideChecklist [^>]*noLevel=\{noLevel\} \/>/);

    const checklist = stripJs(read('web/app/pop/guide/GuideChecklist.tsx'));
    const opts = sliceBlock(checklist, 'export function CharOptions', '\n}\n');
    expect(opts.indexOf('.filter(c => !unknown.has(c.name))')).toBeGreaterThan(-1);
    expect(opts.indexOf('<optgroup label="No known level">')).toBeGreaterThan(opts.indexOf('.filter(c => !unknown.has(c.name))'));
    expect(checklist).toMatch(/<CharOptions chars=\{chars\} noLevel=\{noLevel\} \/>/);
    expect(stripJs(read('web/app/pop/guide/GuideRoute.tsx'))).toMatch(/<CharOptions chars=\{chars\} noLevel=\{noLevel\} \/>/);
  });

  it('/me moves them into collapsed sections by tier instead of removing them', () => {
    const me = stripJs(read('web/app/me/page.tsx'));
    expect(me).toMatch(/tierOf\(\{\s*rank: c\.rank, level: levelByName\.get\(c\.name\.toLowerCase\(\)\), hidden: c\.hidden_from_lists,\s*\}\)/);
    expect(me).toMatch(/const frontTier = frontTierOf\(tierByName\.values\(\)\);/);
    // Owner-hidden first, then the front tier by recency, then unknown, then the generic "more".
    expect(me).toMatch(/c\.hidden_from_lists \? 'owner'\s*: t === frontTier \? \(isRecent\(c\.name\) \? 'front' : 'more'\)\s*: t === 'unknown' \? 'unknown' : 'more';/);
    expect(me).toMatch(/const isFront = \(name: string\) => placeByName\.get\(name\) === 'front';/);
    expect(me).toMatch(/const recentSeenRows = seenRows\.filter\(r => isFront\(r\.name\)\);/);
    expect(me).toMatch(/const olderRows = \[\.\.\.seenRows\.filter\(r => !isFront\(r\.name\)\), \.\.\.neverRows\];/);
    expect(me).toMatch(/place: placeByName\.get\(c\.name\) \?\? 'front'/);
    // Levels are loaded for every linked character, so the excluded ones sort the same way.
    expect(me).toMatch(/loadCharLevels\(allChars\.map\(c => c\.name\)\)/);
    // Nothing is dropped from the card list.
    expect(me).toMatch(/const cardItems: MeCard\[\] = chars\.map\(c => \{/);
    // The owner's flag is read with the rest of the row.
    expect(me).toMatch(/show_quests_publicly, hidden_from_lists'\)/);
  });

  it('/me cards: unknown and hidden-by-you each get their own collapsed section, closed by default', () => {
    const cards = stripJs(read('web/app/me/MeCharacterCards.tsx'));
    expect(cards).toMatch(/place: 'front' \| 'more' \| 'unknown' \| 'owner';/);
    expect(cards).toMatch(/visible\.filter\(n => byName\.get\(n\)!\.place === 'front'\)\.map\(renderCard\)/);
    expect(cards).toMatch(/\(\['more', 'unknown', 'owner'\] as const\)\.map\(place => \{/);
    expect(cards).toMatch(/with no known level — upload a spellbook or get \{names\.length === 1 \? 'it' : 'them'\} seen in \/who to place/);
    expect(cards).toMatch(/Hidden by you \(\{names\.length\}\)/);
    // A fold only renders when it has someone in it, and none starts open.
    expect(cards).toMatch(/if \(names\.length === 0\) return null;/);
    expect(cards).not.toMatch(/<details[^>]*\sopen[\s=>]/);
    expect(cards).toMatch(/<details key=\{place\} className="[^"]*min-w-0 max-w-full">/);
  });

  it('/me hide switch: a toggle on every character row, one ownership-gated action, and it reads Unhide when on', () => {
    // Both places ExclusionToggles renders (the card header and the excluded-from-stats footer).
    const me = stripJs(read('web/app/me/page.tsx'));
    expect(me.match(/hiddenFromLists=\{!!c\.hidden_from_lists\}/g)?.length).toBe(2);
    expect(me.match(/<ExclusionToggles/g)?.length).toBe(2);

    const toggles = stripJs(read('web/app/me/ExclusionToggles.tsx'));
    expect(toggles).toMatch(/flip\('hidden_from_lists', next, setHiddenLists, hiddenLists\)/);
    expect(toggles).toMatch(/offLabel="Hide from lists"/);
    expect(toggles).toMatch(/onLabel="Hidden from lists · Unhide"/);
    expect(toggles).toMatch(/tooltip="Hide everywhere except account inventory:/);

    // The action is the exclusion toggles' own: whitelisted, ownership-checked BEFORE the write.
    const actions = stripJs(read('web/app/me/actions.ts'));
    const one = sliceBlock(actions, 'export async function setCharacterExclusion(', '\n}\n');
    expect(actions).toMatch(/type FlagKey = [^;]*'hidden_from_lists';/);
    expect(one).toMatch(/const allowed: FlagKey\[\] = \[[^\]]*'hidden_from_lists'\];/);
    expect(one.indexOf("error: 'not your character'")).toBeGreaterThan(-1);
    expect(one.indexOf("error: 'not your character'")).toBeLessThan(one.indexOf('.update({ [flag]: value })'));
    expect(one).toMatch(/if \(flag === 'hidden_from_lists'\) \{ revalidatePath\('\/pop'\); revalidatePath\('\/pop\/guide'\); \}/);
    expect(one).toMatch(/revalidatePath\('\/me'\);/);
  });
});

describe('the migration that makes the level lookup fast enough for /pop', () => {
  const sql = stripSql(read('supabase/migrations/20261003120000_me_levels_use_index.sql'));
  it('matches names on the indexed lower() expression, not ilike any()', () => {
    expect(sql).toMatch(/lower\(character\) = any\(a\.names\)/);
    expect(sql).toMatch(/lower\(character_name\) = any\(a\.names\)/);
    expect(sql).not.toMatch(/ilike\s+any/i);
  });
  it('keeps the signature, the columns and the service-role-only grant', () => {
    expect(sql).toMatch(/create or replace function public\.me_levels\(p_names text\[\]\)\s+returns table\(name text, level int\)/);
    expect(sql).toMatch(/revoke all on function public\.me_levels\(text\[\]\) from public;/);
    expect(sql).toMatch(/grant execute on function public\.me_levels\(text\[\]\) to service_role;/);
  });
});

describe('agent dashboard', () => {
  const dashRaw = read('packages/wolfpack-logsync/dashboard.html');
  const dash = stripJs(dashRaw);

  it('the watched-log payload carries the level _levelOf knows (null when unknown) and the owner\'s hidden flag', () => {
    const agent = stripJs(sliceBlock(fs.readFileSync(AGENT_INDEX, 'utf8'), 'function _serializeForDashboard() {', '\n}\n'));
    expect(agent).toMatch(/watchedLogs:\s+\(stats\.watchedLogs \|\| \[\]\)\.map\(w => \(\{ \.\.\.w, level: _levelOf\(w\.character\), hidden: _hiddenFromLists\(w\.character\) \}\)\),/);
  });

  // The helpers are sliced out of the real dashboard and run: no localStorage here, which is the
  // browser-refuses-storage case, so the try/catch is exercised too. __setShow flips the toggle.
  const helperSrc = sliceBlock(dashRaw, 'var WP_LOW_LEVEL = 46;', ` + (_wpShowLow ? 'hide ' : 'show ') + n + ' low-level or hidden</a>';\n}`)
    + '\nfunction __setShow(v) { _wpShowLow = v; }';
  const helpers = evalBlock(helperSrc,
    ['WP_LOW_LEVEL', 'wpIsLowLevel', 'wpIsTucked', 'wpHasLevel', 'wpPartitionChars', 'wpLowToggleHtml', '__setShow']);
  it('hides only characters KNOWN to be under 46', () => {
    expect(helpers.WP_LOW_LEVEL).toBe(46);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar', level: 20 })).toBe(true);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar', level: 45 })).toBe(true);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar', level: 46 })).toBe(false);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar', level: 60 })).toBe(false);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar', level: null })).toBe(false);
    expect(helpers.wpIsLowLevel({ character: 'Aldenmar' })).toBe(false);
    expect(helpers.wpIsLowLevel(null)).toBe(false);
  });
  it('the toggle says how many, and works without storage', () => {
    expect(helpers.wpLowToggleHtml(3)).toMatch(/class="wp-low-toggle"[^>]*>show 3 low-level or hidden<\/a>/);
    helpers.__setShow(true);
    expect(helpers.wpLowToggleHtml(3)).toMatch(/>hide 3 low-level or hidden<\/a>/);
    helpers.__setShow(false);
    expect(dash).toMatch(/try \{ _wpShowLow = localStorage\.getItem\('wp:showLowLevel'\) === '1'; \} catch \(e\)/);
    expect(dash).toMatch(/try \{ localStorage\.setItem\('wp:showLowLevel', _wpShowLow \? '1' : '0'\); \} catch \(err\)/);
  });

  describe('wpPartitionChars: who shows, who waits behind the toggle, who closes up as "no level"', () => {
    const A = { character: 'Aldenmar', level: 60 };
    const B = { character: 'Brackwyn', level: 20 };                     // known low
    const C = { character: 'Corvale', level: 60, hidden: true };        // owner hid it
    const R = { character: 'Rethlan', level: null };                    // no level known
    const N = { character: 'Nyssara', level: 52 };
    const Z = { character: 'Zarrin', level: null, hidden: true };       // hidden beats unknown
    const names = (l) => l.map(w => w.character);
    it('a known 46+ character shows; low-level and hidden are tucked; the rest are "no known level"', () => {
      const p = helpers.wpPartitionChars([A, B, C, R, N, Z]);
      expect(names(p.shown)).toEqual(['Aldenmar', 'Nyssara']);
      expect(names(p.tucked)).toEqual(['Brackwyn', 'Corvale', 'Zarrin']);
      expect(names(p.unknown)).toEqual(['Rethlan']);
    });
    it('the toggle adds the tucked ones back in their own order, and never the no-level group', () => {
      helpers.__setShow(true);
      const p = helpers.wpPartitionChars([A, B, C, R, N, Z]);
      helpers.__setShow(false);
      expect(names(p.shown)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Zarrin']);
      expect(names(p.unknown)).toEqual(['Rethlan']);
    });
    it('a level of 0 or a missing level is "unknown", not low', () => {
      expect(helpers.wpHasLevel({ level: 0 })).toBe(false);
      expect(helpers.wpHasLevel({})).toBe(false);
      expect(helpers.wpHasLevel({ level: 46 })).toBe(true);
      expect(names(helpers.wpPartitionChars([A, { character: 'Rethlan', level: 0 }]).unknown)).toEqual(['Rethlan']);
    });
    it('never leaves a list empty: when nothing would show inline, everything does and nothing is tucked', () => {
      for (const list of [[B, C], [R, Z], [B, C, R, Z], [R], [C], [B]]) {
        const p = helpers.wpPartitionChars(list);
        expect(names(p.shown)).toEqual(names(list));
        expect(p.tucked).toEqual([]);
        expect(p.unknown).toEqual([]);
      }
      expect(helpers.wpPartitionChars([])).toEqual({ shown: [], unknown: [], tucked: [] });
    });
    it('one known 46+ character is enough to start tucking the others away', () => {
      const p = helpers.wpPartitionChars([R, A]);
      expect(names(p.shown)).toEqual(['Aldenmar']);
      expect(names(p.unknown)).toEqual(['Rethlan']);
    });
  });

  // The Me card is run for real: the helpers above, wpKeep and esc sliced out of the dashboard, and the
  // few DOM calls it makes stubbed. `html` is what morphInto was handed.
  describe('the Me card\'s Watched characters', () => {
    const prefix = `
      var _wpOpenDetails = {};
      const __el = { style: {}, html: '' };
      const document = { getElementById: () => __el, addEventListener() {} };
      const _isPanelHidden = () => false;
      const morphInto = (el, html) => { el.html = html; };
      const fmtAgo = () => 'ago';
      const fmtK = (n) => String(n);
      ${sliceBlock(dashRaw, 'function esc(s) {', ')[c]); }')}
      ${sliceBlock(dashRaw, 'function wpKeep(key, defaultOpen) {', '\n}\n')}
      ${helperSrc}
    `;
    const meSrc = sliceBlock(dashRaw, 'function renderMeCard(s) {', '\n}\n');
    const run = evalBlock(prefix + meSrc + '\nfunction __html() { return __el.html; }',
      ['renderMeCard', '__setShow', '__html']);
    // A fixed lastSeen ordering (newest first) makes the card's own sort deterministic.
    const log = (character, level, extra = {}) => ({ character, level, lastSeen: Date.now() - (extra.age || 0), ...extra });
    const column = (html) => html.slice(html.indexOf('Watched characters'), html.indexOf('Recent tells'));
    const rowNames = (html) => [...html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map(m => m[1]);
    function card(watched, show = false) {
      run.__setShow(show);
      run.renderMeCard({ watchedLogs: watched, zealClients: [], recentTells: [], recentParses: [] });
      run.__setShow(false);
      const col = column(run.__html());
      const details = (col.match(/<details[\s\S]*?<\/details>/) || [''])[0];
      return { col, details, inline: col.replace(details, ''), toggle: (col.match(/<a href="#" class="wp-low-toggle"[^>]*>([^<]*)<\/a>/) || [])[1] };
    }
    const mixed = () => [
      log('Aldenmar', 60, { age: 1000 }), log('Brackwyn', 20, { age: 2000 }),
      log('Corvale', 60, { age: 3000, hidden: true }), log('Rethlan', null, { age: 4000 }),
      log('Nyssara', 52, { age: 5000 }), log('Zarrin', null, { age: 6000, hidden: true }),
    ];

    it('lists the known 46+ characters, tucks low-level and hidden behind the toggle, closes up the no-level ones', () => {
      const c = card(mixed());
      expect(rowNames(c.inline)).toEqual(['Aldenmar', 'Nyssara']);
      expect(c.toggle).toBe('show 3 low-level or hidden');
      expect(c.details).toMatch(/^<details data-keep="me-nolevel"[^>]*>/);
      expect(c.details).not.toMatch(/ open[ >]/);                       // collapsed until the user opens it
      expect(c.details).toMatch(/<summary[^>]*>1 with no known level<\/summary>/);
      expect(rowNames(c.details)).toEqual(['Rethlan']);                  // a hidden no-level one is tucked, not here
      expect(c.col).toMatch(/Watched characters \(2\)/);
    });

    it('the toggle brings the low-level and hidden ones inline; the no-level group stays closed up', () => {
      const c = card(mixed(), true);
      expect(rowNames(c.inline)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Zarrin']);
      expect(c.toggle).toBe('hide 3 low-level or hidden');
      expect(rowNames(c.details)).toEqual(['Rethlan']);
    });

    it('with no known level on anyone it lists them all, with no group and no toggle', () => {
      const c = card([log('Rethlan', null, { age: 1000 }), log('Zarrin', undefined, { age: 2000 })]);
      expect(rowNames(c.inline)).toEqual(['Rethlan', 'Zarrin']);
      expect(c.details).toBe('');
      expect(c.toggle).toBeUndefined();
    });

    it('with every character hidden or low-level it lists them all rather than an empty column', () => {
      const c = card([log('Brackwyn', 20, { age: 1000 }), log('Corvale', 60, { age: 2000, hidden: true }), log('Rethlan', null, { age: 3000 })]);
      expect(rowNames(c.inline)).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
      expect(c.details).toBe('');
      expect(c.toggle).toBeUndefined();
    });

    it('with nobody tucked and nobody unknown there is no group and no toggle', () => {
      const c = card([log('Aldenmar', 60, { age: 1000 }), log('Nyssara', 52, { age: 2000 })]);
      expect(rowNames(c.inline)).toEqual(['Aldenmar', 'Nyssara']);
      expect(c.details).toBe('');
      expect(c.toggle).toBeUndefined();
    });
  });

  // The Replay picker: its form block (the picker plus its toggle) is sliced out of the real section
  // renderer and run. A <select> cannot hold a <details>, so the no-level group is an <optgroup>.
  describe('the Replay log picker', () => {
    const pickerSrc = sliceBlock(dashRaw, 'var _rls = (s.watchedLogs || [])', "wpLowToggleHtml(_rlsLow) + '</span>';") + '\n  }';
    const prefix = `
      ${sliceBlock(dashRaw, 'function esc(s) {', ')[c]); }')}
      ${helperSrc}
    `;
    const picker = evalBlock(prefix + `
      function __picker(s) { var h = ''; ${pickerSrc} return h; }`, ['__picker', '__setShow']);
    const log = (character, level, extra = {}) => ({ character, level, logPath: '/eq/eqlog_' + character + '_pq.proj.txt', ...extra });
    function pick(watched, show = false) {
      picker.__setShow(show);
      const html = picker.__picker({ watchedLogs: watched });
      picker.__setShow(false);
      const opts = (s) => [...s.matchAll(/<option value="[^"]*">([^<]*)<\/option>/g)].map(m => m[1]);
      const group = (html.match(/<optgroup label="([^"]*)">([\s\S]*?)<\/optgroup>/) || []);
      return { html, plain: opts(html.replace(/<optgroup[\s\S]*?<\/optgroup>/, '')), group: group[1], grouped: group[2] ? opts(group[2]) : [],
        toggle: (html.match(/class="wp-low-toggle"[^>]*>([^<]*)<\/a>/) || [])[1] };
    }
    const mixed = () => [log('Aldenmar', 60), log('Brackwyn', 20), log('Corvale', 60, { hidden: true }), log('Rethlan', null), log('Nyssara', 52)];

    it('offers known 46+ characters, tucks low-level and hidden behind the toggle, and groups the no-level ones last', () => {
      const p = pick(mixed());
      expect(p.plain).toEqual(['Aldenmar', 'Nyssara']);
      expect(p.group).toBe('1 with no known level');
      expect(p.grouped).toEqual(['Rethlan']);
      expect(p.toggle).toBe('show 2 low-level or hidden');
      expect(p.html.indexOf('<optgroup')).toBeGreaterThan(p.html.lastIndexOf('>Nyssara<'));   // group comes after the list
    });

    it('the toggle adds the tucked characters to the list; the no-level group stays a group', () => {
      const p = pick(mixed(), true);
      expect(p.plain).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara']);
      expect(p.grouped).toEqual(['Rethlan']);
      expect(p.toggle).toBe('hide 2 low-level or hidden');
    });

    it('never an empty picker: nothing to list means everyone is listed, ungrouped', () => {
      const p = pick([log('Brackwyn', 20), log('Corvale', 60, { hidden: true }), log('Rethlan', null)]);
      expect(p.plain).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
      expect(p.group).toBeUndefined();
      expect(p.toggle).toBeUndefined();
    });

    it('still skips a watched entry with no log file, and says so when there are none', () => {
      expect(pick([log('Aldenmar', 60), { character: 'Rethlan', level: 60 }]).plain).toEqual(['Aldenmar']);
      expect(picker.__picker({ watchedLogs: [] })).toMatch(/No watched log files yet/);
    });
  });

  it('the Watched characters list and the Replay picker both use the partition, and only they do', () => {
    const me = stripJs(sliceBlock(dashRaw, 'function renderMeCard(s) {', '\n}\n'));
    expect(me).toMatch(/const part = wpPartitionChars\(chars\);/);
    expect(me).toMatch(/for \(const c of listedChars\.slice\(0, 8\)\) h \+= charRow\(c\);/);
    // The group is a <details>, and every <details> in the dashboard is built with wpKeep (check:dashboard
    // enforces it for the whole file; this pins the key and that it starts closed).
    expect(me).toMatch(/'<details ' \+ wpKeep\('me-nolevel'\) \+ '/);
    expect(me).toMatch(/wpLowToggleHtml\(part\.tucked\.length\)/);
    expect(dash).toMatch(/var _rlsPart = wpPartitionChars\(_rls\);/);
    // Defined once, called twice. No inventory, upload or Logsync-pane code asks.
    expect(dash.match(/wpPartitionChars\(/g)).toHaveLength(3);
    expect(dash.match(/wpIsTucked\(/g)).toHaveLength(2);   // its definition, and the partition's one call
    // The Watched Logs diagnostic card and the opt-in log panel still list every file.
    const logsCard = stripJs(sliceBlock(dashRaw, 'function renderWatchedLogsCard(s) {', '\n}\n'));
    expect(logsCard).not.toMatch(/wpIsLowLevel|wpIsTucked|wpPartitionChars|\.hidden/);
  });
});

// The agent half: the pref is carried through the prefs poll, read for the dashboard payload, and asked
// by nothing that uploads or collects (the guild lead, 2026-10-03: "hide these characters from anything
// but account inventory" — a display rule).
describe('agent: hidden_from_lists is carried for display and gates nothing', () => {
  const agentRaw = fs.readFileSync(AGENT_INDEX, 'utf8');
  const applyFn = sliceBlock(agentRaw, 'function _applyCharacterPrefsResponse(resp) {', '\n}\n');
  const hiddenFn = sliceBlock(agentRaw, 'function _hiddenFromLists(character) {', '\n}\n');
  const uploadFn = sliceBlock(agentRaw, 'function shouldUploadForCharacter(character) {', '\n}\n');
  const quarmyFn = sliceBlock(agentRaw, 'function _quarmyPrefsBlock(lowerName) {', '\n}\n');
  const env = evalBlock(
    `const stats = {}; function scheduleRender() {}\n${applyFn}\n${hiddenFn}\n${uploadFn}\n${quarmyFn}`,
    ['stats', '_applyCharacterPrefsResponse', '_hiddenFromLists', 'shouldUploadForCharacter', '_quarmyPrefsBlock'],
  );

  it('is false until prefs have loaded, for an unknown name, and for no name', () => {
    expect(env._hiddenFromLists('Aldenmar')).toBe(false);
    env._applyCharacterPrefsResponse({ prefs: { Aldenmar: { hidden_from_lists: true } } });
    expect(env._hiddenFromLists('Brackwyn')).toBe(false);
    expect(env._hiddenFromLists('')).toBe(false);
    expect(env._hiddenFromLists(null)).toBe(false);
  });

  it('survives the prefs normalization, case-blind, and is a real boolean', () => {
    env._applyCharacterPrefsResponse({ prefs: {
      Aldenmar: { hidden_from_lists: true },
      Brackwyn: { hidden_from_lists: false, exclude_from_stats: true },
      Corvale: { tell_relay: true },
      Rethlan: null,
    } });
    expect(env.stats.characterPrefs.aldenmar.hidden_from_lists).toBe(true);
    expect(env.stats.characterPrefs.brackwyn.hidden_from_lists).toBe(false);
    expect(env.stats.characterPrefs.corvale.hidden_from_lists).toBe(false);
    expect(env.stats.characterPrefs.rethlan.hidden_from_lists).toBe(false);
    expect(env._hiddenFromLists('ALDENMAR')).toBe(true);
    expect(env._hiddenFromLists('Corvale')).toBe(false);
    // the prefs it always carried are untouched
    expect(env.stats.characterPrefs.brackwyn.exclude_from_stats).toBe(true);
    expect(env.stats.characterPrefs.corvale.tell_relay).toBe(true);
  });

  it('a hidden character still uploads and still sends inventory; only the exclude flags stop those', () => {
    env._applyCharacterPrefsResponse({ prefs: {
      Aldenmar: { hidden_from_lists: true },
      Brackwyn: { exclude_from_stats: true },
      Corvale: { exclude_inventory: true },
    } });
    expect(env.shouldUploadForCharacter('Aldenmar')).toBe(true);
    expect(env._quarmyPrefsBlock('aldenmar')).toBe(false);
    // the controls: the flags that DO stop collection still do
    expect(env.shouldUploadForCharacter('Brackwyn')).toBe(false);
    expect(env._quarmyPrefsBlock('brackwyn')).toBe(true);
    expect(env._quarmyPrefsBlock('corvale')).toBe(true);
  });

  it('nothing else in the agent reads it: only the prefs normalization, _hiddenFromLists and the character-mode editor', () => {
    const agent = stripJs(agentRaw);
    // The Main / alt · Inventory only · Hide completely editor (2026-10-06) names a mode from the three flags
    // and writes them back; it is not an upload gate, and the first assertion below keeps it from becoming one.
    const modes = stripJs(sliceBlock(agentRaw, '// ── Character modes: ONE three-way choice', '// ── end character modes'));
    expect(modes).not.toMatch(/shouldUploadForCharacter|_quarmyPrefsBlock|enqueueUpload/);
    const own = stripJs(applyFn) + stripJs(hiddenFn) + modes;
    expect(agent.match(/hidden_from_lists/g).length).toBe(own.match(/hidden_from_lists/g).length);
    // _hiddenFromLists is defined once and called once: the dashboard payload.
    expect(agent.match(/_hiddenFromLists\(/g)).toHaveLength(2);
  });
});
