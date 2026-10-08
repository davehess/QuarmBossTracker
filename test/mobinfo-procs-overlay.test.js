// test/mobinfo-procs-overlay.test.js — Target Info's Spells tab shows the mob's procs.
// (The bot side is test/mobinfo-procs.test.js.)
//
// The guild lead, 2026-10-07: "Need to see mobs Procs as well, not just spells." Gaukr
// Sandstorm procs Stone Gale; the tab listed only its casts. Runs the overlay's real procs
// block as a function over a fake `mob`.
//
// Run: npx vitest run test/mobinfo-procs-overlay.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const start = html.indexOf("      var procsBlock = '';");
const end   = html.indexOf("      var spellsBlock = '';", start);
if (start < 0 || end < 0) throw new Error('procs block not found');
const block = html.slice(start, end);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const render = (mob) => new Function('mob', 'esc', block + '\nreturn procsBlock;')(mob, esc);
const text = (h) => h.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('the Procs section', () => {
  it('Stone Gale shows its name, chance and effect under a Procs (1) heading', () => {
    const out = render({ procs: [{ kind: 'attack', spell_id: 1031, name: 'Stone Gale', chance: 10, summary: '1500 dmg · stun 2s · AE' }] });
    expect(text(out)).toBe('|Procs (1)|Chance|Effect|Stone Gale|10%|1500 dmg · stun 2s · AE|');
  });
  it('a ranged and a defensive proc say so in the name; a missing chance and effect read as a dash', () => {
    const out = render({ procs: [
      { kind: 'range', spell_id: 5, name: 'Arrow Burn', chance: 12.4, summary: '' },
      { kind: 'defensive', spell_id: 6, name: 'Thorns', chance: null, summary: 'snare' },
    ] });
    expect(out).toContain('Arrow Burn (ranged)');
    expect(out).toContain('Thorns (when hit)');
    expect(out).toContain('>12%<');
    expect(text(out)).toContain('|Arrow Burn (ranged)|12%|—|Thorns (when hit)|—|snare|');
  });
  it('a spell the catalog could not name still shows, by id', () => {
    expect(render({ procs: [{ kind: 'attack', spell_id: 4242, chance: 10, summary: '' }] })).toContain('Spell #4242');
  });
  it('names are escaped', () => {
    expect(render({ procs: [{ kind: 'attack', name: '<b>x</b>', chance: 1, summary: 'a&b' }] })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('draws nothing for no procs, an empty list, an answer cached before procs existed, or no mob', () => {
    expect(render({ procs: [] })).toBe('');
    expect(render({ spells: [] })).toBe('');
    expect(render({ procs: null })).toBe('');
    expect(render(null)).toBe('');
  });
});

describe('where it sits', () => {
  it('between the ability chips and the spell lists, so it lands above Offensive', () => {
    expect(html).toMatch(/data-wp-sect="spells">' \+ specBlock \+ procsBlock \+ spellsBlock \+ '<\/div>'/);
  });
});
