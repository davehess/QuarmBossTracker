// test/target-info-sections.test.js — Target Info can be cut into pieces on the Mimic 3.0 Canvas.
//
// The guild lead, 2026-10-02: "every one of the overlays should be exactly reproduced within the canvas
// so the people can disassemble them and use any element of them". The Canvas (alpha) loads this page
// once per piece and shows one section of it (apps/mimic/sections.js on alpha). These are the page's
// half: inert data-wp-sect markers on the parts that had no class of their own, a tab a piece can be
// pinned to (?wptab=), and a tab the other copies share. A standalone window behaves as before.
//
// Run: npx vitest run test/target-info-sections.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const page = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const src = stripJs(page);

describe('Target Info marks the parts a Canvas piece can show', () => {
  it.each(['name', 'stats', 'slots', 'casting', 'fqv', 'spells', 'lastfight'])('%s', (id) => {
    expect(src).toContain(`data-wp-sect="${id}"`);
  });
  it('the three buff lists each get their own mark', () => {
    expect(src).toMatch(/var sect = isPacify \? 'pacify' : hdr\.indexOf\('debuffs'\) === 0 \? 'debuffs' : 'buffs';/);
    expect(src).toMatch(/'<div class="tbuffs" data-wp-sect="'\+sect\+'">/);
  });
  it('the rest already have a class of their own', () => {
    for (const cls of ['class="zone"', 'class="hpbar"', 'class="slowbadge', 'class="manabar"', 'class="mana"', 'class="lastcast', 'class="res"', 'class="spec"', 'class="loot"']) {
      expect(src).toContain(cls);
    }
  });
});

describe('a piece can pin a tab; the other copies share one', () => {
  it('?wptab= pins it, and a pinned copy never changes tab', () => {
    expect(src).toMatch(/var _pinTab = _TABS\[_wpQs\.get\('wptab'\)\] \? _wpQs\.get\('wptab'\) : null;/);
    expect(src).toMatch(/if \(_pinTab\) t = _pinTab;/);
  });
  it('only on the Canvas does a tab change reach the other copies', () => {
    expect(src).toMatch(/var _shareTab = !_pinTab && _wpQs\.get\('wpcanvas'\) === '1';/);
    expect(src).toMatch(/if \(_shareTab && !fromShare\) \{ try \{ window\.sessionStorage\.setItem\('wpTargetTab', t\); \}/);
    expect(src).toMatch(/if \(_shareTab\) window\.addEventListener\('storage', function\(ev\)\{/);
  });
});

describe('the last-fight scoreboard reads where /api/state keeps it', () => {
  it('top-level currentEncounterThreat (there is no stats key)', () => {
    expect(src).toMatch(/var enc = s\.currentEncounterThreat \|\| \(s\.stats && s\.stats\.currentEncounterThreat\) \|\| null;/);
    expect(src).not.toMatch(/if \(mi && s\.stats && s\.stats\.currentEncounterThreat\)/);
  });
});
