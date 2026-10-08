// test/tradeskills.test.js — the labels and the combine split behind the /db
// recipe surfaces (a member, 2026-09-24: "our pages don't have tradeskill
// recipes or quests listed").
//
// Both label tables are positional enums read off the Quarm server source, so
// the tests pin anchors that an off-by-one would move: the ids PQDI's own
// recipe pages name (Loom 16, Forge 17, Brew Barrel 19, the two human forges
// 39/40) and the edges of the skill run (Fishing 55, Pottery 69).
//
// Fixtures are the live rows for recipe 7789 (Royal Temper) and the tool shape
// of recipe 4102, as item_recipes() returned them on 2026-09-24.
//
// Run: npx vitest run test/tradeskills.test.js

import { describe, it, expect } from 'vitest';
import {
  TRADESKILL, WORLD_CONTAINER, tradeskillName, skillLine, isQuestCombine,
  splitParts, containerLabel, isWorldContainer, partLabel,
} from '../web/lib/tradeskills.ts';

const ROYAL_TEMPER = [
  { id: 19,    n: null,                  c: 0, s: 0, k: 1 },
  { id: 22525, n: 'Royal Temper',        c: 0, s: 1, k: 0 },
  { id: 22527, n: 'Essence of Sunlight', c: 2, s: 0, k: 0 },
  { id: 22526, n: 'Griffenne Blood',     c: 1, s: 0, k: 0 },
  { id: 28022, n: 'Rain Water',          c: 1, s: 0, k: 0 },
];
// A file and a chisel go in and come back; the orb is the product.
const TOOL_SHAPE = [
  { id: 47,    n: null,                 c: 0, s: 0, k: 1 },
  { id: 5546,  n: 'Luclin File',        c: 1, s: 1, k: 0 },
  { id: 23540, n: 'Smithing Chisel',    c: 1, s: 1, k: 0 },
  { id: 23539, n: 'Bile Temper',        c: 1, s: 0, k: 0 },
  { id: 23541, n: 'Darkly Pulsing Orb', c: 0, s: 1, k: 0 },
];

describe('skill labels', () => {
  it('anchors the skill enum at both ends and in the middle', () => {
    expect(TRADESKILL[55]).toBe('Fishing');
    expect(TRADESKILL[63]).toBe('Blacksmithing');
    expect(TRADESKILL[65]).toBe('Brewing');       // PQDI files Black Acrylia Temper under Brewing
    expect(TRADESKILL[69]).toBe('Pottery');
    expect(TRADESKILL[62]).toBeUndefined();       // Sense Traps — not a tradeskill
  });

  it('0 and 75 are quest combines, with no trivial shown', () => {
    for (const s of [0, 75, null]) {
      expect(isQuestCombine(s)).toBe(true);
      expect(tradeskillName(s)).toBe('Quest combine');
    }
    expect(skillLine(75, 200)).toBe('Quest combine');
    expect(skillLine(65, 135)).toBe('Brewing 135');
    expect(skillLine(61, 0)).toBe('Tailoring');
  });
});

describe('containers', () => {
  it('labels the world containers PQDI names the same way', () => {
    expect(WORLD_CONTAINER[16]).toBe('Loom');
    expect(WORLD_CONTAINER[17]).toBe('Forge');
    expect(WORLD_CONTAINER[19]).toBe('Brew Barrel');
    expect(WORLD_CONTAINER[39]).toMatch(/^Freeport Forge/);
    expect(WORLD_CONTAINER[40]).toMatch(/^Royal Qeynos Forge/);
  });

  it('a portable kit is an item and keeps its own name', () => {
    const kit = { id: 17165, n: 'Collapsible Sewing Kit', k: 1 };
    expect(isWorldContainer(kit)).toBe(false);
    expect(containerLabel(kit)).toBe('Collapsible Sewing Kit');
    expect(isWorldContainer({ id: 19, k: 1 })).toBe(true);
    expect(containerLabel({ id: 19, n: null, k: 1 })).toBe('Brew Barrel');
    expect(containerLabel({ id: 7, n: null, k: 1 })).toBe('Container #7');
  });
});

describe('splitParts — reads a combine the way the window does', () => {
  it('Royal Temper: three components into a Brew Barrel, one result', () => {
    const s = splitParts(ROYAL_TEMPER);
    expect(s.containers.map(p => p.id)).toEqual([19]);
    expect(s.components.map(p => partLabel(p, p.c))).toEqual(['Essence of Sunlight ×2', 'Griffenne Blood', 'Rain Water']);
    expect(s.results.map(p => p.n)).toEqual(['Royal Temper']);
    expect(s.tools).toEqual([]);
  });

  it('a part consumed AND returned is a tool, never a result', () => {
    const s = splitParts(TOOL_SHAPE);
    expect(s.tools.map(p => p.n)).toEqual(['Luclin File', 'Smithing Chisel']);
    expect(s.results.map(p => p.n)).toEqual(['Darkly Pulsing Orb']);
    expect(s.components.map(p => p.n)).toEqual(['Bile Temper']);
  });

  it('null parts (a recipe past the inline cap) split to nothing', () => {
    const s = splitParts(null);
    expect([s.containers, s.tools, s.components, s.results].every(a => a.length === 0)).toBe(true);
  });
});
