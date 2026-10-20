// /about is the Tour (the guild lead, 2026-10-19, DECISIONS §383: picked over the Illustrated layout, with
// "make new ones for Planes of Power, and add in older pictures from previous expansions").
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
const figuresRaw = fs.readFileSync(path.join(WEB, 'components', 'about', 'Figures.tsx'), 'utf8');
const figures = stripJs(figuresRaw);
const tourRaw = fs.readFileSync(path.join(WEB, 'app', 'about', 'Tour.tsx'), 'utf8');
const tour = stripJs(tourRaw);
const page = stripJs(fs.readFileSync(path.join(WEB, 'app', 'about', 'page.tsx'), 'utf8'));
const bosses = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bosses.json'), 'utf8'));
const popFlags = stripJs(fs.readFileSync(path.join(WEB, 'lib', 'popFlags.ts'), 'utf8'));

const INVENTED = new Set(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Mirenne', 'Kelbrin',
  'Elowin', 'Thessaly', 'Wyldane', 'Zarrin']);

// The text between `const NAME = [` and its closing `];`.
const block = (src, name) => {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`no const ${name}`);
  return src.slice(start, src.indexOf('\n];', start));
};

describe('names in the figures', () => {
  it('every character in the data arrays is an invented one', () => {
    const names = [...figures.matchAll(/\b(?:n|who): '([A-Z][a-z]+)'/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(10);   // the old figures plus the five PoP raiders
    for (const n of names) expect(INVENTED, n).toContain(n);
  });
  it('and so is every name in the log lines and the /who-style text', () => {
    const lines = block(figures, 'LINES = [');
    const seats = block(figures, 'SEATS = [');
    // Capitalised words that are player names in those lines: the speaker/actor and anyone named after "on"/":".
    const words = [...(lines + seats).matchAll(/\b([A-Z][a-z]{3,})\b/g)].map(m => m[1])
      .filter(w => !['Shei', 'Vinitras', 'Cleric', 'Shaman', 'Bard', 'Melody', 'Feral', 'Avatar', 'Lcea', 'Your', 'Buff', 'Slot'].includes(w));
    for (const w of words) expect(INVENTED, w).toContain(w);
  });
  it('the PoP matrix carries all five raiders, each a different mix of marks', () => {
    const rows = block(figures, 'POP_ROWS');
    const names = [...rows.matchAll(/\bn: '([A-Za-z]+)'/g)].map(m => m[1]);
    expect(names).toHaveLength(5);
    const marks = [...rows.matchAll(/marks: \[([^\]]+)\]/g)].map(m => m[1]);
    expect(new Set(marks).size).toBe(5);
    for (const k of ['mimic', 'who', 'loot', 'self', 'none']) expect(rows).toContain(`'${k}'`);
  });
});

describe('pictures the page points at', () => {
  it('every image the Tour and its figures reference exists in web/public', () => {
    const tagList = figures.match(/const TAGS = \[[^\]]+\]/)[0];   // a one-line array
    const files = [...tagList.matchAll(/'([^']+)'/g)].map(m => `about/tags/${m[1]}.png`)
      .concat(['about/melody-dirge.png', 'wolf.png', 'wolf-solid.png', 'wolf-eyes.png', 'film/wolfpack-rise.jpg']);
    for (const f of files) expect(fs.existsSync(path.join(WEB, 'public', f)), f).toBe(true);
    expect(tour).toContain('src="/about/melody-dirge.png"');
    expect(figures).toContain('src="/film/wolfpack-rise.jpg"');
    // every literal src="/…" in either file resolves, so a new picture cannot ship without its file
    for (const m of (figures + tour).matchAll(/src="(\/[^"]+)"/g)) {
      expect(fs.existsSync(path.join(WEB, 'public', m[1])), m[1]).toBe(true);
    }
  });
  it('uses no external image host', () => {
    expect(figures + tour).not.toMatch(/src="https?:/);
  });
});

describe('the earlier-expansion board (stop 09)', () => {
  it('names a raid target, zone and respawn that the boss catalog really has, for four distinct eras', () => {
    const cards = block(figures, 'ERA_CARDS');
    const rows = [...cards.matchAll(/name: '([^']+)'|name: "([^"]+)"/g)];
    const eras = [...cards.matchAll(/era: '([^']+)'/g)].map(m => m[1]);
    expect(eras).toEqual(['Classic', 'Kunark', 'Velious', 'Luclin']);
    expect(rows).toHaveLength(8);
    const entries = [...cards.matchAll(/\{ name: (?:'([^']+)'|"([^"]+)"), zone: (?:'([^']+)'|"([^"]+)"), hours: (\d+) \}/g)];
    expect(entries).toHaveLength(8);
    for (const m of entries) {
      const name = m[1] ?? m[2];
      const zone = m[3] ?? m[4];
      const row = bosses.find(b => b.name === name);
      expect(row, name).toBeTruthy();
      expect(row.zone, name).toBe(zone);
      expect(row.timerHours, name).toBe(Number(m[5]));
    }
    // and each card's bosses belong to the era the card is labelled with
    for (const card of cards.split('{ era: ').slice(1)) {
      const era = card.match(/^'([^']+)'/)[1];
      for (const m of card.matchAll(/\{ name: (?:'([^']+)'|"([^"]+)"), zone/g)) {
        expect(bosses.find(b => b.name === (m[1] ?? m[2])).expansion, era).toBe(era);
      }
    }
  });
});

describe('the Planes of Power stop (stop 10)', () => {
  it('every gate column is a real flag in the PoP catalog', () => {
    const gates = block(figures, 'POP_GATES = [');
    const keys = [...gates.matchAll(/flag: '([^']+)'/g)].map(m => m[1]);
    expect(keys).toHaveLength(5);
    for (const k of keys) expect(popFlags, k).toContain(`key: '${k}'`);
  });
  it('every board row is a PoP boss with the zone the catalog gives it', () => {
    const rows = block(figures, 'POP_BOSSES');
    const entries = [...rows.matchAll(/name: '([^']+)', zone: '([^']+)'/g)];
    expect(entries).toHaveLength(3);
    for (const m of entries) {
      const row = bosses.find(b => b.name === m[1]);
      expect(row, m[1]).toBeTruthy();
      expect(row.expansion, m[1]).toBe('PoP');
      expect(row.zone, m[1]).toBe(m[2]);
    }
  });
  it('the legend shows each way a flag is known, with the same marks the /pop page uses', () => {
    const legend = block(figures, 'POP_LEGEND');
    for (const k of ['mimic', 'who', 'loot', 'self']) expect(legend).toContain(`kind: '${k}'`);
    expect(figures).toContain("from '@/app/pop/GateMark'");
  });
});

describe('the Tour is the default, and the guild previews stay on beta', () => {
  const guildRaw = fs.readFileSync(path.join(WEB, 'app', 'about', 'GuildAbout.tsx'), 'utf8');
  it('with no ?v= the page renders the Tour; ?v=b and ?v=c render the two guild layouts', () => {
    expect(page).toContain("if (v === 'b') return <AboutByTheRecord s={s} />;");
    expect(page).toContain("if (v === 'c') return <AboutAsAHome s={s} />;");
    // the Tour is the fall-through, after both switches, and nothing else is
    const b = page.indexOf("v === 'b'");
    const c = page.indexOf("v === 'c'");
    const t = page.indexOf('return <AboutTour s={s} />;');
    expect(b).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(b);
    expect(t).toBeGreaterThan(c);
    expect([...page.matchAll(/\bv === '/g)]).toHaveLength(2);
    expect(page).toContain("from './GuildAbout'");
  });
  it('the guild layouts are real exports of GuildAbout.tsx', () => {
    expect(stripJs(guildRaw)).toContain('export function AboutByTheRecord(');
    expect(stripJs(guildRaw)).toContain('export function AboutAsAHome(');
    expect(guildRaw).toContain("from './Tour'");    // the stats type; GuildAbout does not import the old Story.tsx
  });
  it('the platform Illustrated layout is gone', () => {
    expect(fs.existsSync(path.join(WEB, 'app', 'about', 'Story.tsx'))).toBe(false);
    expect(page).not.toMatch(/AboutIllustrated|\bv === 'p/);
    expect(tour).not.toMatch(/AboutIllustrated/);
  });
  it('has ten stops, the last two being the earlier expansions and Planes of Power, and says so', () => {
    const ns = [...tour.matchAll(/^\s+n: '(\d\d)'/gm)].map(m => m[1]);
    expect(ns).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(tour).toContain('figure: <EraBoardFigure />');
    expect(tour).toContain('figure: <PopFigure />');
    expect(tour).toContain('Ten stops');
  });
});
