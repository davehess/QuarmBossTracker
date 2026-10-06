// FB-54 — web/lib/npcDecode.ts is a COPY of utils/mobSpecials.js's special-ability
// table (the web cannot import from outside web/: Vercel builds from that folder
// and its ignoreCommand assumes nothing there reads outside it). This test is the
// drift guard: the two tables must agree on every code's label, show flag and
// danger flag, and the web decoder must give the same chips as the bot's.
// REAL-IMPORT: both modules are executed; the only text match is the page's
// markup check, run on comment-stripped source.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';
import * as web from '../web/lib/npcDecode.ts';

const require = createRequire(import.meta.url);
const bot = require('../utils/mobSpecials.js');

describe('web npcDecode table matches the bot table', () => {
  it('has exactly the same codes', () => {
    const botCodes = Object.keys(bot.MOB_SPECIAL_CODES).map(Number).sort((a, b) => a - b);
    const webCodes = Object.keys(web.MOB_SPECIAL_CODES).map(Number).sort((a, b) => a - b);
    expect(webCodes).toEqual(botCodes);
    expect(webCodes.length).toBe(54);
  });

  it('agrees on label, show and danger for every code', () => {
    for (const [code, def] of Object.entries(bot.MOB_SPECIAL_CODES)) {
      expect({ code, ...web.MOB_SPECIAL_CODES[code] }).toEqual({ code, label: def.label, show: def.show, danger: def.danger });
    }
  });

  it('agrees on the legacy npcspecialattks flags', () => {
    expect(web.NPCSPECIALATTKS_FLAGS).toEqual(bot.NPCSPECIALATTKS_FLAGS);
  });

  it('decodes the same chips as the bot for real catalog strings', () => {
    const samples = [
      '44,1^50,1',                 // 209070 Laef Windfall: Use Warrior Skills, Reverse Slow
      '7,1',                       // 114618: Dual Wield (hidden)
      '31,1^42,1^43,1',            // 179037 The Itraer Vius
      '1,1^2,1^3,1^19,1^20,1^21,1',
      '37,1,10^50,0',              // a disabled 50 does not count
      '',
      null,
    ];
    for (const s of samples) {
      expect(web.decodeMobSpecials(s, null)).toEqual(bot.decodeSpecialLabels(s, null));
    }
    expect(web.decodeMobSpecials(null, 'ESQ')).toEqual(bot.decodeSpecialLabels(null, 'ESQ'));
  });
});

describe('web shows Reverse Slow as a warning', () => {
  it('Laef Windfall (209070) yields a danger Reverse Slow chip and no ranged-immunity chip', () => {
    const chips = web.decodeMobSpecialChips('44,1^50,1', null);
    expect(chips).toEqual([{ label: 'Reverse Slow — slowing hastes it', danger: true }]);
    expect(web.decodeMobSpecials('44,1', null)).toEqual([]);
  });

  it('a mob without code 50 gets no Reverse Slow chip', () => {
    expect(web.decodeMobSpecials('1,1^12,1', null).some(l => l.startsWith('Reverse Slow'))).toBe(false);
  });

  it('the NPC page renders danger chips in the warning style, ahead of the rest', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'db', 'npc', '[id]', 'page.tsx')));
    expect(page).toMatch(/decodeMobSpecialChips\(/);
    expect(page).toMatch(/s\.danger\s*\?\s*'[^']*text-red-400/);
    expect(page).toMatch(/Number\(b\.danger\)\s*-\s*Number\(a\.danger\)/);
  });
});
