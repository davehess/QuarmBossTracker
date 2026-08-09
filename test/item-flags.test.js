// NO DROP means you cannot pass it to anyone. Getting it backwards is a loot bug.
//
// THE BUG (Hitya 2026-08-04, comparing /db/item/8733 against pqdi.cc):
// `eqemu_items.nodrop` is INVERTED on this mirror. The column really answers
// "can this be traded", so **false = NO DROP** and true = freely tradeable.
//
// Three surfaces read it raw and printed the flag backwards on all ~27k items:
//   • /db/item/[id]        — the flags line
//   • InventoryView.tsx    — the gold "no-drop" tile border
//   • ItemHover.tsx        — the NO DROP badge
// Two others (me/inventory, character/quests) had it right and left a comment
// saying so — which is precisely the split a shared helper exists to end.
//
// Why it matters more than a cosmetic label: every one of these answers "can I
// pass this to someone?", and the answer was inverted. A raider checking
// whether a drop can be handed off got the opposite of the truth.
//
// LORE has its own trap: `lore_flag` is false on all 26,971 rows and has never
// rendered anything. EQEmu marks lore with a leading '*' on the lore STRING
// (11,148 items), which is also what the in-game card shows.
//
// Run: npx vitest run test/item-flags.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

// The helpers are TS; read and strip the types rather than adding a build step
// for four pure functions.
const SRC = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'itemDecode.ts'), 'utf8');
function loadHelpers() {
  const start = SRC.indexOf('export function isNoDrop');
  const end   = SRC.indexOf('// EQEmu stores weight in TENTHS');
  if (start < 0 || end < 0) throw new Error('itemDecode: flag helpers not found — were they renamed?');
  const ts = SRC.slice(start, end)
    .replace(/export function/g, 'function')
    .replace(/\(v: [^)]*\)/g, '(v)')
    .replace(/\(lore: [^)]*\)/g, '(lore)')
    .replace(/\): boolean \{/g, ') {')
    .replace(/\): string \| null \{/g, ') {');
  // eslint-disable-next-line no-new-func
  return new Function(ts + '\nreturn { isNoDrop, isNoRent, isLoreItem, loreText };')();
}
const { isNoDrop, isNoRent, isLoreItem, loreText } = loadHelpers();

describe('isNoDrop — the inversion', () => {
  it('false means NO DROP', () => {
    // Ancient Burrower Flesh Cap #8733: stored false, pqdi.cc says NODROP.
    expect(isNoDrop({ nodrop: false })).toBe(true);
  });

  it('true means TRADEABLE', () => {
    // Water Flask / Cloth Cap / Rusty Long Sword are all stored true, and are
    // obviously tradeable vendor staples. If this ever returns true, every
    // merchant item on the site is about to be labelled NO DROP again.
    expect(isNoDrop({ nodrop: true })).toBe(false);
  });

  it('unknown is NOT no-drop', () => {
    // A missing mirror row must not imply a restriction that isn't there —
    // "we don't know" reads better as no badge than as a false NO DROP.
    expect(isNoDrop({ nodrop: null })).toBe(false);
    expect(isNoDrop({})).toBe(false);
    expect(isNoDrop(null)).toBe(false);
    expect(isNoDrop(undefined)).toBe(false);
  });

  it('accepts the raw boolean as well as a card', () => {
    expect(isNoDrop(false)).toBe(true);
    expect(isNoDrop(true)).toBe(false);
  });

  it('norent inverts the same way', () => {
    expect(isNoRent({ norent: false })).toBe(true);
    expect(isNoRent({ norent: true })).toBe(false);
    expect(isNoRent({})).toBe(false);
  });
});

describe('isLoreItem — the asterisk, not the dead column', () => {
  it('reads the leading asterisk EQEmu actually uses', () => {
    expect(isLoreItem('*Ancient Burrower Flesh Cap')).toBe(true);
    expect(isLoreItem('A plain description')).toBe(false);
    expect(isLoreItem(null)).toBe(false);
    expect(isLoreItem('')).toBe(false);
  });

  it('strips the marker for display — it is not part of the text', () => {
    expect(loreText('*Ancient Burrower Flesh Cap')).toBe('Ancient Burrower Flesh Cap');
    expect(loreText('  *Spaced  ')).toBe('*Spaced');   // only a LEADING marker counts
    expect(loreText('*')).toBeNull();
    expect(loreText(null)).toBeNull();
  });
});

// ── The call sites ──────────────────────────────────────────────────────────
describe('every surface goes through the helper', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const SURFACES = [
    'web/app/db/item/[id]/page.tsx',
    'web/app/character/[name]/inventory/InventoryView.tsx',
    'web/app/character/[name]/inventory/ItemHover.tsx',
  ];

  it('no surface reads .nodrop raw as a truthy flag', () => {
    // `card.nodrop ? 'NO DROP'` is the exact shape of the bug.
    for (const f of SURFACES) {
      const src = read(f);
      expect(src, `${f} still branches on a raw .nodrop`)
        .not.toMatch(/\??\.nodrop\s*\?/);
      expect(src, `${f} should call isNoDrop`).toMatch(/isNoDrop\(/);
    }
  });

  it('the dead lore_flag column is gone from the item page', () => {
    const src = read('web/app/db/item/[id]/page.tsx');
    expect(src, 'lore_flag is false on all 26,971 rows').not.toMatch(/lore_flag/);
    expect(src).toMatch(/isLoreItem\(/);
  });

  it('the item page renders worn AND proc effects, not just clicks', () => {
    const src = read('web/app/db/item/[id]/page.tsx');
    expect(src).toMatch(/Worn effect/);
    expect(src).toMatch(/Combat effect/);
    // Assert the GUARDS, not just that the field is mentioned — the field also
    // appears inside each block, so a disabled condition still matched.
    expect(src, 'worn-effect block is not actually gated on the value')
      .toMatch(/\{!!itemRow\?\.worneffect && itemRow\.worneffect > 0 && \(/);
    expect(src, 'proc-effect block is not actually gated on the value')
      .toMatch(/\{!!itemRow\?\.proc_effect && itemRow\.proc_effect > 0 && \(/);
  });

  it('all three effect names resolve in ONE query, not three round trips', () => {
    const src = read('web/app/db/item/[id]/page.tsx');
    expect(src).toMatch(/const effectIds = \[card\?\.clickeffect, itemRow\?\.worneffect, itemRow\?\.proc_effect\]/);
    expect(src).toMatch(/\.in\('id', \[\.\.\.new Set\(effectIds\)\]\)/);
  });

  it('the attribute block is rendered', () => {
    const src = read('web/app/db/item/[id]/page.tsx');
    for (const tag of ['STR', 'STA', 'AGI', 'DEX', 'WIS', 'INT', 'CHA']) {
      expect(src, `${tag} missing from ATTR_ORDER`).toMatch(new RegExp(`'${tag}'`));
    }
  });
});

// The attribute formatter, which has to hide zeros and sign negatives.
describe('attribute rendering', () => {
  const ATTR_ORDER = [['str','STR'],['sta','STA'],['agi','AGI'],['dex','DEX'],['wis','WIS'],['intel','INT'],['cha','CHA']];
  const attrs = (row) => ATTR_ORDER
    .map(([k, label]) => { const v = row[k]; return v ? `${label} ${v > 0 ? '+' : ''}${v}` : null; })
    .filter(Boolean);

  it('renders only the non-zero attributes, in game order', () => {
    // #8733 as stored: STA 20, WIS 15, everything else 0.
    expect(attrs({ str: 0, sta: 20, agi: 0, dex: 0, wis: 15, intel: 0, cha: 0 }))
      .toEqual(['STA +20', 'WIS +15']);
  });

  it('signs negatives and drops zeros entirely', () => {
    expect(attrs({ str: -5, sta: 0, cha: 3 })).toEqual(['STR -5', 'CHA +3']);
    expect(attrs({ str: 0, sta: 0 })).toEqual([]);
  });
});
