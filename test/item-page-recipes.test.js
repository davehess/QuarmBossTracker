// test/item-page-recipes.test.js — /db/item shows the grouped recipe layout to everyone.
//
// The guild lead, 2026-10-19 (DECISIONS §383, item-page-b-c): picked C "Grouped" over B "Inline". Until then the
// page carried a ?v=b / ?v=c switch and rendered the old Quest turn-ins section when there was no ?v=. This pins
// the graduated shape: no switch, no inline layout, the grouped Tradeskills section and the merged Quests section
// always rendered. Source-text assertions run on comment-stripped source (comments name the removed code).
//
// Run: npx vitest run test/item-page-recipes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const PAGE = 'web/app/db/item/[id]/page.tsx';
const TRADE = 'web/app/db/item/[id]/Tradeskills.tsx';

describe('/db/item — grouped recipes are the only layout', () => {
  it('the page has no ?v= switch and no variant state', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/searchParams/);
    expect(src).not.toMatch(/\bvariant\b/);
    expect(src).not.toMatch(/\?v=/);
    expect(src).not.toMatch(/preview:/);
  });

  it('the inline layout is gone from the page and from Tradeskills.tsx', () => {
    expect(read(PAGE)).not.toMatch(/TradeskillsInline|INLINE_CAP/);
    expect(read(TRADE)).not.toMatch(/TradeskillsInline|InlineRow|INLINE_CAP/);
  });

  it('the page always renders the merged Quests and the grouped Tradeskills sections', () => {
    const src = read(PAGE);
    expect(src).toMatch(/^\s*<QuestsMerged hits=\{scriptHits\}/m);
    expect(src).toMatch(/^\s*<TradeskillsGrouped recipes=\{recipes\} \/>/m);
    expect(src).toMatch(/import \{ type ItemRecipe, TradeskillsGrouped \} from '\.\/Tradeskills'/);
  });

  it('the recipes and quest scripts are read for every visit, asking for no combine parts', () => {
    const src = read(PAGE);
    expect(src).toMatch(/sb\.rpc\('item_recipes', \{ p_item_id: itemId, p_with_parts: 0 \}\)/);
    expect(src).toMatch(/sb\.rpc\('quest_scripts_for_item', \{ p_item_id: itemId \}\)\.range\(0, 199\)/);
    expect(src).not.toMatch(/extrasRes\s*=\s*\w+\s*\?/);
  });

  it('the older Quest turn-ins section (parsed turn-ins alone) is gone', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/TurninRow/);
    expect(src).not.toMatch(/Quest turn-ins/);
  });

  it('the grouped layout still opens short roles and closes long ones', () => {
    const src = read(TRADE);
    expect(src).toMatch(/export function TradeskillsGrouped/);
    expect(src).toMatch(/const OPEN_UNDER = 40;/);
    expect(src).toMatch(/open=\{open\}/);
  });
});
