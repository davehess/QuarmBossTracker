// test/pop-planner-mains-alts.test.js — the /pop raid-night planner counts mains, with alts in
// parentheses (the guild lead, 2026-09-29: "make this mains and in parenths alts").
//
// The planner lives inline in the page, so this reads its source (comments stripped): every
// character is counted whatever ?scope says, each number is split mains / alts, the ranking is by
// mains first, and every number cell renders as "mains (alts)".
//
// Run: npx vitest run test/pop-planner-mains-alts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const page = fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8');
const planner = stripJs(sliceBlock(page, '// ── Raid-night planner ──', 'const planTop ='));

// The guild lead, 2026-09-29: "I see 1000 unmapped grants so that's probably a database row restriction".
// The API returns at most 1,000 rows a request; ~10k unmapped hail rows sort before any real flag, so the
// old single .limit(20000) read would never have reached a real flag.
describe('reading pop_flags past the 1,000-row cap', () => {
  const body = stripJs(page);
  const reader = stripJs(sliceBlock(page, 'async function mappedFlagRows()', '\n  }\n'));
  it('reads the real flags a page at a time, and only the real ones', () => {
    expect(reader).toMatch(/\.neq\('flag_key', 'unmapped'\)/);
    expect(reader).toMatch(/\.range\(from, from \+ 999\)/);
    expect(reader).toMatch(/if \(rows\.length < 1000\) break;/);
    expect(body).not.toMatch(/\.limit\(20000\)/);
  });
  it('counts the unmapped rows instead of downloading them', () => {
    expect(body).toMatch(/sb\.from\('pop_flags'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('flag_key', 'unmapped'\)/);
    expect(body).toMatch(/const totalUnmapped = unmappedCount \?\? 0;/);
  });
  it('puts only characters with a real flag on the page', () => {
    const build = stripJs(sliceBlock(page, 'const byChar = new Map<string, CharFlags>();', 'const chars = Array.from'));
    expect(build).toMatch(/for \(const r of flagRows\) \{/);
    expect(build).not.toMatch(/r\.flag_key === 'unmapped'/);
  });
});

describe('the raid-night planner', () => {
  it('counts every character, not only the ?scope ones', () => {
    expect(planner).toMatch(/const attendList = chars\.filter\(c => zoneAccess\(z, c\.flags\)\);/);
    expect(planner).toMatch(/const oneAway = chars\.filter\(c => \{/);
    expect(planner).not.toMatch(/scopedChars|eligibleChars/);
  });
  it('splits every number into mains and alts, and ranks by mains first', () => {
    expect(planner).toMatch(/const mains = list\.filter\(c => isMainName\(c\.name\)\)\.length;/);
    expect(planner).toMatch(/attend: split\(attendList\), gains: split\(gains\)/);
    expect(planner).toMatch(/plan\.sort\(\(a, b\) => b\.leverage\.mains - a\.leverage\.mains \|\| b\.gains\.mains - a\.gains\.mains/);
  });
  it('shows each number as "mains (alts)", and lists alt names apart', () => {
    const body = stripJs(page);
    expect(body).toMatch(/const MainsAlts = \(\{ s \}: \{ s: Split \}\) => <>\{s\.mains\}<span className="text-dim"> \(\{s\.alts\}\)<\/span><\/>;/);
    expect(body).toMatch(/<MainsAlts s=\{p\.attend\} \/>/);
    expect(body).toMatch(/<MainsAlts s=\{p\.gains\} \/>/);
    expect(body).toMatch(/\+\{u\.count\.mains\}<span className="text-dim"> \(\{u\.count\.alts\}\)<\/span>/);
    expect(body).toMatch(/\(alts: \$\{u\.alts\.join\(', '\)\}\)/);
  });
});
