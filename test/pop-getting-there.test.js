// test/pop-getting-there.test.js — the "Getting there" line on the PoP guide's ?v=b layout (web/lib/popGettingThere.ts),
// built from the cited routes in web/lib/popTravel.ts. The page sends the browser only finished sentences; this holds
// that, holds every hop of every route to a phrase, and holds the run rule (one line at the start of a zone's steps).
//
// Run: npx vitest run test/pop-getting-there.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { POP_ZONES } from '../web/lib/popTravel.ts';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';
import {
  gettingThere, guideGettingThere, hasPhrase, routeHopIds, startsOfRuns, stepZone,
} from '../web/lib/popGettingThere.ts';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the line for a zone', () => {
  it('every hop a forward route uses has a phrase', () => {
    const missing = routeHopIds().filter(id => !hasPhrase(id));
    expect(missing).toEqual([]);
  });

  it('every zone but the Plane of Knowledge has a line, and none reads as a raw id', () => {
    for (const z of POP_ZONES) {
      const l = gettingThere(z);
      if (z === 'poknowledge') { expect(l).toBeNull(); continue; }
      expect(l, z).not.toBeNull();
      expect(l.main.startsWith('PoK book → Tranquility'), z).toBe(true);
      expect(l.main, z).not.toMatch(/_|undefined/);
    }
  });

  it('reads the way the guild lead asked: book, Tranquility, the portal, what it needs', () => {
    expect(gettingThere('povalor').main).toBe('PoK book → Tranquility → Valor portal (needs Mavuin 3)');
    expect(gettingThere('potranquility').main).toBe('PoK book → Tranquility');
    expect(gettingThere('podisease').main).toBe('PoK book → Tranquility → Disease zone line');
  });

  it('a zone with a repeat-visit shortcut gets it as a second line that starts after the shared book', () => {
    const l = gettingThere('codecay');
    expect(l.main).toContain('the drop by Grummus into the Crypt (needs the Grummus flag)');
    expect(l.alt).toBe("Repeat visits: Tranquility's Crypt portal (works after your first trip in)");
    for (const z of ['hohonora', 'bothunder', 'pofire', 'potimea', 'potimeb']) expect(gettingThere(z).alt, z).toMatch(/^Repeat visits: Tranquility's /);
    expect(gettingThere('povalor').alt).toBeUndefined();
  });

  it('a gate the data words as a requirement is worded as one', () => {
    expect(gettingThere('potorment').main).toContain('needs Fuirstel 5 and Thelin 4');
    expect(gettingThere('potimeb').main).toContain('level 65, raid of 7 or more');
  });
});

describe('what reaches the browser', () => {
  const gt = guideGettingThere();
  const json = JSON.stringify(gt);

  it('is finished sentences only: no citations, no unverified notes', () => {
    expect(json).not.toMatch(/ea0c766|12068490|eqemu_|\.lua|unverified|"src"/);
    expect(json.length).toBeLessThan(8000); // popTravel.ts alone is ~90 KB
  });

  it('only names steps that exist and zones popTravel covers', () => {
    const keys = new Set(GUIDE_ITEMS.map(i => i.key));
    for (const [k, z] of Object.entries(gt.steps)) {
      expect(keys.has(k), k).toBe(true);
      expect(POP_ZONES.includes(z), z).toBe(true);
    }
    for (const z of Object.keys(gt.lines)) expect(POP_ZONES.includes(z), z).toBe(true);
  });

  it('places the steps whose zone the guide itself names', () => {
    const z = (key) => stepZone(GUIDE_ITEMS.find(i => i.key === key));
    expect(z('flag_grummus')).toBe('podisease');
    expect(z('flag_bert')).toBe('codecay');
    expect(z('flag_tthule')).toBe('nightmareb');
    expect(z('disease_ward')).toBe('potranquility');
    expect(z('valor_zone_hoh')).toBe('povalor');
    expect(z('maelin_cipher')).toBe('poknowledge');
    expect(z('t1_trash')).toBeNull();
  });

  it('the client component imports the pure half only, and the default view is not handed the line', () => {
    const route = stripJs(read('web/app/pop/guide/GuideRoute.tsx'));
    expect(route).toMatch(/from '@\/lib\/popGettingThereRuns'/);
    expect(route).not.toMatch(/popTravel|from '@\/lib\/popGettingThere'/);
    const page = stripJs(read('web/app/pop/guide/page.tsx'));
    expect(page).toMatch(/gettingThere=\{v === 'b' \? guideGettingThere\(\) : undefined\}/);
    expect(stripJs(read('web/lib/popGettingThereRuns.ts'))).not.toMatch(/^import /m);
  });
});

describe('startsOfRuns: one line at the start of a zone\'s steps', () => {
  const gt = {
    steps: { a: 'potranquility', b: 'potranquility', c: 'podisease', d: 'poknowledge', e: 'podisease', n: undefined },
    lines: { potranquility: { main: 'T' }, podisease: { main: 'D' } },
  };
  const rows = (...keys) => keys.map(key => ({ key }));

  it('puts the line on the first step of each zone, and again when the zone changes back', () => {
    expect([...startsOfRuns(rows('a', 'b', 'c', 'd', 'e'), gt).keys()]).toEqual(['a', 'c', 'e']);
  });

  it('a step with no zone neither carries a line nor breaks the run', () => {
    expect([...startsOfRuns(rows('a', 'n', 'b', 'c', 'n'), gt).keys()]).toEqual(['a', 'c']);
  });

  it('a Plane of Knowledge step has no line and ends the run before it', () => {
    // c and e are both Disease; d (Knowledge) sits between them, so e starts a new run.
    expect([...startsOfRuns(rows('c', 'd', 'e'), gt).keys()]).toEqual(['c', 'e']);
    expect(startsOfRuns(rows('d'), gt).size).toBe(0);
  });

  it('only the rows shown count: a hidden first step hands the line to the next one', () => {
    expect([...startsOfRuns(rows('b'), gt).keys()]).toEqual(['b']);
  });
});
