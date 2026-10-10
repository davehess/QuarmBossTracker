// Agent side of the EQ item-link rule: transformEqItemLinks in the agent turns
// `\x12<7 decimal digits><name>\x12` into `<name> <https://www.pqdi.cc/item/<id>>`
// before chat is uploaded, and the link is stored as written — so a wrong id here
// is a wrong id in chat_messages for good. It used to read 5 of the digits as hex;
// the fixtures carry the wrong ids that produced. The bot copy is held to the same
// fixtures by eq-item-link.test.js.
import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';
import { LINK_FIXTURES, rawLink, strippedLink, pqdi } from './_eq-item-link-fixtures.js';

const src = readSource(AGENT_INDEX);
const { transformEqItemLinks } = evalBlock(
  sliceBlock(src, 'const EQ_ITEM_LINK_RX =', '  return out;\n}'),
  ['transformEqItemLinks'],
);

describe('agent transformEqItemLinks — 7 decimal digits', () => {
  for (const f of LINK_FIXTURES) {
    it(`raw link: ${f.name} → ${f.id}`, () => {
      const out = transformEqItemLinks(`grats on ${rawLink(f)} !`);
      expect(out).toBe(`grats on ${f.name} ${pqdi(f.id)} !`);
      expect(out).not.toContain(`/item/${f.hexId}>`);
    });
    if (f.rawOnly) continue;
    it(`stripped link: ${f.name} → ${f.id}`, () => {
      expect(transformEqItemLinks(`grats on ${strippedLink(f)}`)).toBe(`grats on ${f.name} ${pqdi(f.id)}`);
    });
  }

  it('links every item in a line with several', () => {
    const [a, b] = LINK_FIXTURES;
    expect(transformEqItemLinks(`${rawLink(a)} and ${rawLink(b)}`))
      .toBe(`${a.name} ${pqdi(a.id)} and ${b.name} ${pqdi(b.id)}`);
  });

  it('leaves plain numbers and too-short blobs alone', () => {
    expect(transformEqItemLinks('I have 1234567 plat')).toBe('I have 1234567 plat');
    expect(transformEqItemLinks('\x12021874 Blood Runed Battle Wand\x12')).toBe('021874 Blood Runed Battle Wand');
  });
});
