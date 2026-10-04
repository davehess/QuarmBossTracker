// test/pop-planner-mains-alts.test.js — who the /pop page counts, and how the planner shows it.
//
// The guild lead, 2026-09-29: "make this mains and in parenths alts", then "it should be mains only when
// i'm on mains, vs all characters. Also traders or anyone not of level range shouldn't be counted in
// there. we should go off of raiders and raid alts, pack members toons at level and above". And earlier
// the same day: "I see 1000 unmapped grants so that's probably a database row restriction".
//
// Run: npx vitest run test/pop-planner-mains-alts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';
import { popRoster, POP_MIN_LEVEL } from '../web/lib/popRoster.ts';

const page = fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8');
const body = stripJs(page);
const planner = stripJs(sliceBlock(page, '// ── Raid-night planner ──', 'const planTop ='));

// Names invented.
const row = (name, rank, level, active = true) => ({ name, rank, level, active });

describe('who the page counts (popRoster, run for real)', () => {
  it('raiders are the mains, raid alts the alts; traders, inactive and non-raid alts are out', () => {
    const r = popRoster([
      row('Aldenmar', 'Raid Pack', 60), row('Brackwyn', 'Officer', 60), row('Corvale', 'Recruit', 60),
      row('Rethlan', 'Pack Leader', 60), row('Nyssara', 'Raid Alt', 60),
      row('Zarrin', 'Trader', 60), row('Tovrin', 'Inactive', 60), row('Vellis', 'Non-raid Alt', 60), row('Orrin', null, 60),
    ]);
    expect(r.map(m => [m.name, m.main])).toEqual([
      ['Aldenmar', true], ['Brackwyn', true], ['Corvale', true], ['Rethlan', true], ['Nyssara', false],
    ]);
  });
  it('only at level 60 and above, and only active characters', () => {
    expect(POP_MIN_LEVEL).toBe(60);
    const r = popRoster([
      row('Aldenmar', 'Raid Alt', 59), row('Brackwyn', 'Raid Alt', 60), row('Corvale', 'Raid Pack', 55),
      row('Rethlan', 'Raid Pack', 60, false),
    ]);
    expect(r.map(m => m.name)).toEqual(['Brackwyn']);
  });
  it('a raider never seen on /who still counts; an alt with no level does not', () => {
    const r = popRoster([row('Aldenmar', 'Raid Pack', null), row('Brackwyn', 'Raid Alt', null)]);
    expect(r.map(m => m.name)).toEqual(['Aldenmar']);
  });
});

describe('the page', () => {
  it('builds its roster from the raid ranks and /who levels, then attaches each one\'s flags', () => {
    expect(body).toMatch(/\.in\('rank', \[\.\.\.RAIDER_RANKS, \.\.\.RAID_ALT_RANKS\]\)/);
    expect(body).toMatch(/sb\.from\('who_directory'\)\.select\('character_key, level'\)/);
    expect(body).toMatch(/const chars: CharFlags\[\] = members\s*\.map\(m => \{\s*const c = byChar\.get\(m\.name\.toLowerCase\(\)\);\s*return \{ name: m\.name, flags: c\?\.flags \?\? new Set<string>\(\)/);
  });
  it('adds the flags /who proves to each character, marked as seen (2026-10-01)', () => {
    expect(body).toMatch(/sb\.rpc\('pop_who_sightings', \{ p_guild_id: 'wolfpack', p_names: \[\.\.\.nameOf\.keys\(\)\], p_zones: WHO_ZONE_NAMES \}\)/);
    expect(body).toMatch(/for \(const \[f, proof\] of flagsFromSightings\(rows\)\) \{\s*if \(c\.flags\.has\(f\)\) continue;\s*c\.flags\.add\(f\);\s*c\.seen\.set\(f, proof\);/);
    // A gate only /who proves is a blue ✓, in the matrix and in My Characters alike: both tables render a
    // cell through GateCell (2026-10-03, which makes it the owner's button), and GateCell's other branch is AccessMark.
    expect(body.match(/<GateCell z=\{z\} c=\{/g)?.length).toBe(2);
    expect(body.match(/<AccessMark z=\{z\} c=\{/g)?.length).toBe(1);
  });
  it('keeps the link\'s query through sign-in (a signed-out ?v=b&demo=1 used to land on bare /pop)', () => {
    expect(body).toMatch(/redirect\(`\/auth\/signin\?next=\$\{encodeURIComponent\('\/pop\?' \+ new URLSearchParams\(await searchParams/);
    expect(body).not.toMatch(/next=\/pop'/);
  });
  it('Mains means the raiders; All characters adds the raid alts', () => {
    expect(body).toMatch(/const scopedChars = scope === 'all' \? chars : chars\.filter\(c => c\.main\);/);
  });
});

describe('the raid-night planner', () => {
  it('counts the scoped roster, like the rest of the page', () => {
    expect(planner).toMatch(/const attendList = scopedChars\.filter\(c => zoneAccess\(z, c\.flags\)\);/);
    expect(planner).toMatch(/const oneAway = scopedChars\.filter\(c => \{/);
  });
  it('splits mains from raid alts, and ranks by mains first', () => {
    expect(planner).toMatch(/const mains = list\.filter\(c => c\.main\)\.length;/);
    expect(planner).toMatch(/plan\.sort\(\(a, b\) => b\.leverage\.mains - a\.leverage\.mains \|\| b\.gains\.mains - a\.gains\.mains/);
  });
  it('shows alts in parentheses only on All characters', () => {
    expect(body).toMatch(/const MainsAlts = \(\{ s \}: \{ s: Split \}\) => <>\{s\.mains\}\{scope === 'all' && <span className="text-dim"> \(\{s\.alts\}\)<\/span>\}<\/>;/);
    expect(body).toMatch(/<MainsAlts s=\{p\.attend\} \/>/);
    expect(body).toMatch(/<MainsAlts s=\{p\.gains\} \/>/);
  });
});

// The API returns at most 1,000 rows a request; ~10k unmapped hail rows sort before any real flag.
describe('reading pop_flags past the 1,000-row cap', () => {
  const reader = stripJs(sliceBlock(page, 'async function mappedFlagRows()', '\n  }\n'));
  it('reads the real flags a page at a time, and only the real ones', () => {
    // Witnessed hails are stored as 'hail' rows since §119; they are evidence, not flags.
    expect(reader).toMatch(/\.not\('flag_key', 'in', '\(unmapped,hail\)'\)/);
    // The walk is selectAll's (web/lib/selectAll.ts): ordered on a unique key, short-page stop, and a
    // failed page throws instead of ending the read with the flags so far.
    expect(reader).toMatch(/selectAll<FlagRow>\(\(from, to\) => sb\.from\('pop_flags'\)/);
    expect(reader).toMatch(/\.order\('earned_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)\s*\.range\(from, to\)/);
    expect(reader).not.toMatch(/for \(let from = 0/);
    expect(body).not.toMatch(/\.limit\(20000\)/);
  });
  it('counts the unmapped rows instead of downloading them', () => {
    expect(body).toMatch(/sb\.from\('pop_flags'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('flag_key', 'unmapped'\)/);
    expect(body).toMatch(/const totalUnmapped = unmappedCount \?\? 0;/);
  });
});
