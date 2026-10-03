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
    expect(seen).toEqual([['from', 'characters'], ['select', 'name'], ['eq', 'guild_id', 'wolfpack'], ['ilike', 'rank', 'trader']]);
    expect([...names].sort()).toEqual(['brackwyn', 'zarrin']);
  });
  it('loadHiddenNames reads the characters their owner hid, as lowercase names', async () => {
    const seen = [];
    const q = { select: (c) => { seen.push(['select', c]); return q; }, eq: (k, v) => { seen.push(['eq', k, v]); return q; },
      limit: async () => ({ data: [{ name: 'Rethlan' }, { name: 'Nyssara' }] }) };
    const names = await loadHiddenNames({ from: (t) => { seen.push(['from', t]); return q; } });
    expect(seen).toEqual([['from', 'characters'], ['select', 'name'], ['eq', 'guild_id', 'wolfpack'], ['eq', 'hidden_from_lists', true]]);
    expect([...names].sort()).toEqual(['nyssara', 'rethlan']);
  });
});

describe('the pages apply it', () => {
  it('ownedCharacters carries rank and hidden_from_lists, and filters on neither', () => {
    const owned = stripJs(read('web/lib/ownedCharacters.ts'));
    expect(owned).toMatch(/\.select\('name, main_name, class, active, rank, hidden_from_lists, discord_id'\)/);
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

  it('the watched-log payload carries the level _levelOf knows, null when unknown', () => {
    const agent = stripJs(sliceBlock(fs.readFileSync(AGENT_INDEX, 'utf8'), 'function _serializeForDashboard() {', '\n}\n'));
    expect(agent).toMatch(/watchedLogs:\s+\(stats\.watchedLogs \|\| \[\]\)\.map\(w => \(\{ \.\.\.w, level: _levelOf\(w\.character\) \}\)\),/);
  });

  // The helpers are sliced out of the real dashboard and run: no localStorage here, which is the
  // browser-refuses-storage case, so the try/catch is exercised too.
  const helpers = evalBlock(
    sliceBlock(dashRaw, 'var WP_LOW_LEVEL = 46;', ` + (_wpShowLow ? 'hide ' : 'show ') + n + ' low-level</a>';\n}`),
    ['WP_LOW_LEVEL', 'wpIsLowLevel', 'wpLowToggleHtml'],
  );
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
    expect(helpers.wpLowToggleHtml(3)).toMatch(/class="wp-low-toggle"[^>]*>show 3 low-level<\/a>/);
    expect(dash).toMatch(/try \{ _wpShowLow = localStorage\.getItem\('wp:showLowLevel'\) === '1'; \} catch \(e\)/);
    expect(dash).toMatch(/try \{ localStorage\.setItem\('wp:showLowLevel', _wpShowLow \? '1' : '0'\); \} catch \(err\)/);
  });

  it('the Watched characters list and the Replay picker both filter, and never end up empty', () => {
    const me = stripJs(sliceBlock(dashRaw, 'function renderMeCard(s) {', '\n}\n'));
    expect(me).toMatch(/const listedChars = \(_wpShowLow \|\| lowChars\.length === chars\.length\) \? chars : chars\.filter\(c => !wpIsLowLevel\(c\)\);/);
    expect(me).toMatch(/for \(const c of listedChars\.slice\(0, 8\)\)/);
    expect(me).toMatch(/wpLowToggleHtml\(lowChars\.length\)/);
    expect(dash).toMatch(/var _rlsHasLow = _rlsLow > 0 && _rlsLow < _rls\.length;/);
    expect(dash).toMatch(/if \(_rlsHasLow && !_wpShowLow\) _rls = _rls\.filter\(function\(w\)\{ return !wpIsLowLevel\(w\); \}\);/);
    // The Watched Logs diagnostic card and the opt-in log panel still list every file.
    const logsCard = stripJs(sliceBlock(dashRaw, 'function renderWatchedLogsCard(s) {', '\n}\n'));
    expect(logsCard).not.toMatch(/wpIsLowLevel/);
  });
});
