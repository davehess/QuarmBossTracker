// /about with pictures: two layouts on beta (the guild lead, 2026-09-26: "could use some updating,
// possibly some generated images and assets so it's not just blocks of text").
//
// /about is PUBLIC and gets shared outside the guild, so every name in its figures must come from the
// invented set (see web/components/about/OverlayDemo.tsx's header) — none of them is anybody.
//
// Run: npx vitest run test/about-figures.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const WEB = path.join(ROOT, 'web');
const figures = fs.readFileSync(path.join(WEB, 'components', 'about', 'Figures.tsx'), 'utf8');
const story = fs.readFileSync(path.join(WEB, 'app', 'about', 'Story.tsx'), 'utf8');
const page = stripJs(fs.readFileSync(path.join(WEB, 'app', 'about', 'page.tsx'), 'utf8'));

const INVENTED = new Set(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Mirenne', 'Kelbrin',
  'Elowin', 'Thessaly', 'Wyldane', 'Zarrin']);

describe('names in the figures', () => {
  it('every character in the data arrays is an invented one', () => {
    const names = [...figures.matchAll(/\b(?:n|who): '([A-Z][a-z]+)'/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(INVENTED, n).toContain(n);
  });
  it('and so is every name in the log lines and the /who-style text', () => {
    const lines = figures.slice(figures.indexOf('const LINES = ['), figures.indexOf('];', figures.indexOf('const LINES = [')));
    const seats = figures.slice(figures.indexOf('const SEATS = ['), figures.indexOf('];', figures.indexOf('const SEATS = [')));
    // Capitalised words that are player names in those lines: the speaker/actor and anyone named after "on"/":".
    const words = [...(lines + seats).matchAll(/\b([A-Z][a-z]{3,})\b/g)].map(m => m[1])
      .filter(w => !['Shei', 'Vinitras', 'Cleric', 'Shaman', 'Bard', 'Melody', 'Feral', 'Avatar', 'Lcea', 'Your', 'Buff', 'Slot'].includes(w));
    for (const w of words) expect(INVENTED, w).toContain(w);
  });
});

describe('pictures the page points at', () => {
  it('every /about/… and wolf image referenced exists in web/public', () => {
    const tags = [...figures.matchAll(/'([a-z]+(?:-[a-zA-Z0-9]+)?)'/g)];
    const tagList = figures.slice(figures.indexOf('const TAGS = ['), figures.indexOf('];', figures.indexOf('const TAGS = [')));
    const files = [...tagList.matchAll(/'([^']+)'/g)].map(m => `about/tags/${m[1]}.png`)
      .concat(['about/melody-dirge.png', 'wolf.png', 'wolf-solid.png', 'wolf-eyes.png']);
    expect(tags.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.existsSync(path.join(WEB, 'public', f)), f).toBe(true);
    expect(story).toContain('src="/about/melody-dirge.png"');
  });
});

describe('the layouts', () => {
  it('with no ?v= the page is the old one; ?v=b and ?v=c are the two new layouts', () => {
    expect(page).toContain("if (v === 'b') return <AboutIllustrated s={s} />;");
    expect(page).toContain("if (v === 'c') return <AboutTour s={s} />;");
    expect(page).toContain('Four pieces, built in about six weeks');       // the baseline, untouched
    expect(stripJs(story)).toContain('Four pieces, five months in, still shipping.');
  });
});
