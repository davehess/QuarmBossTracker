// test/melody-aoe-chip-visible.test.js — the Melody overlay's AE mob-count chip must never be cut off.
//
// The guild lead, 2026-10-09 (screenshot): "not seeing the number of mobs that these aoe spells are hitting with
// chords of cessation, bereavement, chords of dissonance, disruptive discord". The agent counted them; the chip was
// drawn INSIDE the song-name span, which ellipsises, so on a long name ("Chords of Cessation…") the chip sat past the
// edge behind the "…" while short "Bereavement" still showed it. Measured in Chromium at a 260 px row: before, the
// chip ended at 320 px; after, at 249 px.
//
// Run: npx vitest run test/melody-aoe-chip-visible.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'melody.html'));
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1].replace(/\/\*[\s\S]*?\*\//g, '');
// Every declaration block for exactly this selector, joined (a selector can have more than one rule).
const rule = (sel) => {
  const re = new RegExp('(?:^|[\\s}])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
  return [...css.matchAll(re)].map(m => m[1]).join(';');
};

describe('Melody AE chip stays visible on long song names', () => {
  it('the song name ellipsises in its own span and the chip sits beside it, not inside it', () => {
    expect(html).toContain(`'<span class="name"><span class="nm">' + esc(shortSongName(name)) + '</span>' + aoeHtml + '</span>'`);
  });
  it('the name cell is a flex row that does not clip; only .nm ellipsises; the chip never shrinks', () => {
    const name = rule('.row .name');
    expect(name).toMatch(/display:flex/);
    expect(name).toMatch(/min-width:0/);
    expect(name).not.toMatch(/text-overflow/);
    expect(name).not.toMatch(/overflow:hidden/);
    expect(rule('.row .name .nm')).toMatch(/overflow:hidden;text-overflow:ellipsis/);
    expect(rule('.row .name .aoe')).toMatch(/flex-shrink:0/);
  });
});
