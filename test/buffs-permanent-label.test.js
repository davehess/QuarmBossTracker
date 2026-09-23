// test/buffs-permanent-label.test.js — the Buffs tab only says "permanent"
// when the spell catalog says so.
//
// The guild lead, 2026-09-23, on a Buffs-tab screenshot: "eye of zomm is not
// permanent". Eye of Zomm is formula 7, 5 ticks: 30 seconds. Zeal reported no
// tick count for it, and the card turned "no count" into "permanent". A
// missing reading is not a fact about the buff.
//
// Run: npx vitest run test/buffs-permanent-label.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const dash  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const fnSrc = sliceBlock(agent, 'function _catalogPermanent(', '\n}\n');
function withCatalog(entries) {
  const map = 'const _spellByNameLower = new Map(' + JSON.stringify(entries) + ');\n';
  return evalBlock(map + fnSrc, ['_catalogPermanent'])._catalogPermanent;
}

describe('_catalogPermanent', () => {
  const isPermanent = withCatalog([
    ['eye of zomm',           { durf: 7,  dur: 5 }],
    ['illusion: werewolf',    { durf: 50, dur: 0 }],
    ["brell's stalwart shield", { durf: 51, dur: 0 }],
  ]);

  it('a timed spell is not permanent, even though Zeal sent no ticks for it', () => {
    expect(isPermanent('Eye of Zomm')).toBe(false);
  });

  it('formula 50 and 51 are permanent', () => {
    expect(isPermanent('Illusion: Werewolf')).toBe(true);
    // EQ logs a backtick possessive; the catalog stores an apostrophe.
    expect(isPermanent('Brell`s Stalwart Shield')).toBe(true);
  });

  it('a name the catalog does not know is NOT permanent — we do not know', () => {
    expect(isPermanent('Some Clicky Nobody Catalogued')).toBe(false);
  });
});

describe('the wiring', () => {
  it('the agent sends the catalog verdict with each active buff', () => {
    const fn = stripJs(sliceBlock(agent, 'function _activeBuffsForDashboard() {', '\n  return out;\n}'));
    expect(fn).toContain('permanent: _catalogPermanent(b.name)');
  });

  it('the card says "permanent" only on that flag, and "no timer" otherwise', () => {
    const fn = stripJs(sliceBlock(dash, 'function renderBuffsTab(s) {', '// ── Per-character duration factor'));
    expect(fn).toContain("b.permanent ? 'permanent' : 'no timer'");
    // The old rule: a missing countdown alone meant "permanent".
    expect(fn).not.toContain("b.remaining_secs == null ? 'permanent'");
  });
});
