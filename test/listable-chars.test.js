// test/listable-chars.test.js — traders and low-level characters stay out of character lists.
//
// The guild lead, 2026-10-03: "low level characters do not need to show up on the pop flag page. all of
// my traders and mule characters destroy my views anywhere we display all of our logs."
//
// The rule (web/lib/listableChars.ts) is run for real; the pages are checked for the wiring that applies
// it, over comment-stripped source (a comment can quote any of these strings). Fixture names are invented.
//
// Run: npx vitest run test/listable-chars.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, AGENT_INDEX, sliceBlock, evalBlock, stripJs, stripSql } from './_source-slice.js';
import { LIST_MIN_LEVEL, isListable, partitionListable, loadLevels, loadTraderNames } from '../web/lib/listableChars.ts';

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
});

describe('the pages apply it', () => {
  it('ownedCharacters carries rank, and nothing that must keep mules uses the rule', () => {
    const owned = stripJs(read('web/lib/ownedCharacters.ts'));
    expect(owned).toMatch(/\.select\('name, main_name, class, active, rank, discord_id'\)/);
    expect(owned).toMatch(/\.map\(\(\{ name, main_name, class: cls, active, rank \}\) => \(\{ name, main_name, class: cls, active, rank \}\)\)/);
    // Mule inventory is the point of these pages, and the data rules are different flags altogether.
    for (const f of ['web/app/me/inventory/page.tsx', 'web/app/quartermaster/page.tsx', 'web/app/me/MuleUpload.tsx', 'web/app/me/inventory-actions.ts']) {
      expect(stripJs(read(f))).not.toMatch(/listableChars/);
    }
  });

  it('/pop filters the viewer’s own list once, and the spell-needs rows, behind ?all=1', () => {
    const page = stripJs(read('web/app/pop/page.tsx'));
    expect(page).toMatch(/const showAll = allParam === '1';/);
    // The viewer's list and the spell-needs rows are split ONCE, and every use below reads the result.
    expect(page).toMatch(/partitionListable\(myCharsAll, c => \(\{ rank: c\.rank, level: bestLevel\(c\.name, null\) \}\)\)/);
    expect(page).toMatch(/partitionListable\(spellNeedsAll, n => \(\{/);
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
    expect(page).toMatch(/Show all \(\$\{hiddenNames\.size\} hidden\)/);
    expect(page).toMatch(/Traders and characters under \$\{LIST_MIN_LEVEL\} hidden\./);
    // The guild-wide chart, matrix and planner are untouched: still the raid roster at 60+.
    expect(page).toMatch(/popRoster\(rosterRows\.map/);
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

  it('/me moves them into the existing collapsed "more" section instead of removing them', () => {
    const me = stripJs(read('web/app/me/page.tsx'));
    expect(me).toMatch(/const isFront = \(name: string\) => isRecent\(name\) && \(listedNames\.size === 0 \|\| listedNames\.has\(name\)\);/);
    expect(me).toMatch(/const recentSeenRows = seenRows\.filter\(r => isFront\(r\.name\)\);/);
    expect(me).toMatch(/const olderRows = \[\.\.\.seenRows\.filter\(r => !isFront\(r\.name\)\), \.\.\.neverRows\];/);
    expect(me).toMatch(/recent: isFront\(c\.name\)/);
    // Levels are loaded for every linked character, so the excluded ones sort the same way.
    expect(me).toMatch(/loadCharLevels\(allChars\.map\(c => c\.name\)\)/);
    // Nothing is dropped from the card list.
    expect(me).toMatch(/const cardItems: MeCard\[\] = chars\.map\(c => \{/);
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
