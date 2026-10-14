// Bot side of the EQ item-link rule: linkifyEqItems in index.js turns
// `\x12<7 decimal digits><name>\x12` into `<name> <https://www.pqdi.cc/item/<id>>`.
// It used to read 5 of the digits as hex, so every link pointed at the wrong
// item; the fixtures carry the wrong ids it produced, and each case asserts the
// output has the real id and not that one. The agent copy is held to the same
// fixtures by eq-item-link-agent.test.js.
import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';
import { LINK_FIXTURES, rawLink, strippedLink, pqdi } from './_eq-item-link-fixtures.js';

const src = readSource(BOT_INDEX);
// linkifyEqItems' last pass requires utils/itemNameDb; stub it empty so only the
// link decode is under test.
const PRELUDE = 'const require = () => ({ size: () => 0 });\n';
const { linkifyEqItems } = evalBlock(
  PRELUDE + sliceBlock(src, '  const EQ_ITEM_LINK_RX     =', '    return out;\n  }'),
  ['linkifyEqItems'],
);

describe('bot linkifyEqItems — 7 decimal digits', () => {
  for (const f of LINK_FIXTURES) {
    it(`raw link: ${f.name} → ${f.id}`, () => {
      const out = linkifyEqItems(`grats on ${rawLink(f)} !`);
      expect(out).toBe(`grats on ${f.name} ${pqdi(f.id)} !`);
      expect(out).not.toContain(`/item/${f.hexId}>`);
    });
    if (f.rawOnly) continue;
    it(`stripped link: ${f.name} → ${f.id}`, () => {
      expect(linkifyEqItems(`grats on ${strippedLink(f)}`)).toBe(`grats on ${f.name} ${pqdi(f.id)}`);
    });
  }

  it('links every item in a line with several', () => {
    const [a, b] = LINK_FIXTURES;
    expect(linkifyEqItems(`${rawLink(a)} and ${rawLink(b)}`))
      .toBe(`${a.name} ${pqdi(a.id)} and ${b.name} ${pqdi(b.id)}`);
  });

  it('leaves plain numbers and too-short blobs alone', () => {
    expect(linkifyEqItems('I have 1234567 plat')).toBe('I have 1234567 plat');
    expect(linkifyEqItems('\x12021874 Blood Runed Battle Wand\x12')).toBe('021874 Blood Runed Battle Wand');
  });
});
