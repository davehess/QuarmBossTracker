// test/who-lookup-class-titles.test.js — /who class-title normalization.
//
// Hitya 2026-08-19: the /who overlay showed "Warlock" (the level-60
// Necromancer TITLE) as an anon player's class. The de-anon record comes from
// the bot's who-lookup handler, whose Supabase passes (who_directory /
// characters) served the stored string raw — history harvested before
// agent-side normalization still holds titles. The fix folds titles → base
// class at the who-lookup serve boundary. Three guards here:
//   1. utils/classTitles maps every title tier to its base class.
//   2. The who-lookup handler actually applies normalizeClass to results.
//   3. The bot map stays byte-identical in MEANING to the agent's
//      CLASS_TITLES mirror (both files say "keep them in sync"; nothing
//      enforced it until now).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { normalizeClass, TITLE_TO_CLASS } = require('../utils/classTitles.js');

describe('utils/classTitles', () => {
  it('folds every Necromancer title tier to Necromancer', () => {
    for (const t of ['Heretic', 'Defiler', 'Warlock', 'Arch Lich']) {
      expect(normalizeClass(t)).toBe('Necromancer');
    }
  });
  it('base names and unknowns pass through; idempotent', () => {
    expect(normalizeClass('Necromancer')).toBe('Necromancer');
    expect(normalizeClass('ANONYMOUS')).toBe('ANONYMOUS');
    expect(normalizeClass(normalizeClass('Savage Lord'))).toBe('Beastlord');
    expect(normalizeClass(null)).toBe(null);
  });
});

describe('who-lookup serve boundary', () => {
  it('the handler folds results through normalizeClass before responding', () => {
    const src = readSource(BOT_INDEX);
    const fold = sliceBlock(src,
      '// Fold EQ level titles back to base classes at the serve boundary',
      "console.warn('[who-lookup] class normalization skipped:", );
    expect(fold).toContain("require('./utils/classTitles')");
    expect(fold).toContain('r.class = normalizeClass(r.class)');
  });
});

describe('bot ↔ agent title-map sync', () => {
  it('the agent CLASS_TITLES mirror resolves every entry like the bot map', () => {
    const src = readSource(AGENT_INDEX);
    const block = sliceBlock(src, 'const CLASS_TITLES = (() => {',
      'return CLASS_TITLES.get(key) || String(raw).trim();\n}');
    const A = evalBlock(block, ['CLASS_TITLES', 'normalizeClass']);
    // Same key set, same base class per key, in both directions.
    expect([...A.CLASS_TITLES.keys()].sort()).toEqual([...TITLE_TO_CLASS.keys()].sort());
    for (const [k, base] of TITLE_TO_CLASS) {
      expect(A.CLASS_TITLES.get(k)).toBe(base);
    }
    expect(A.normalizeClass('Warlock')).toBe('Necromancer');
  });
});
