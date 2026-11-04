// test/announce-pop-zones-preclear.test.js — /announce offers every zone that has a boss, and takes a preclear.
//
// The guild lead, 2026-11-04: "our discord /announce command is missing pop zones. we should be able to name a zone
// and boss as 'Preclear'". The zone picker read only data/zones.json, which misses five Planes of Power raid zones
// that have bosses; a preclear names the zone and the boss and never expands the zone into all of its bosses.
//
// Run: npx vitest run test/announce-pop-zones-preclear.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const announce = require('../commands/announce.js');
const zones = require('../data/zones.json');
const bosses = require('../data/bosses.json');

describe('the zone picker', () => {
  const names = announce.announceZoneNames(zones, bosses);
  it('offers every zone a boss lives in, PoP raid zones included', () => {
    for (const z of new Set(bosses.map(b => b.zone))) expect(names).toContain(z);
    for (const z of ['Crypt of Decay', 'Plane of Valor', 'Halls of Honor', 'Temple of Marr', 'Tower of Solusek Ro']) {
      expect(names).toContain(z);
    }
  });
  it('keeps every zones.json zone, once each, sorted', () => {
    for (const z of zones) expect(names).toContain(z.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
  });
});

describe('a preclear', () => {
  const xuzl = { name: 'Xuzl', zone: 'Tower of Solusek Ro' };
  it('names the zone and the boss', () => {
    expect(announce.preclearName('Tower of Solusek Ro', xuzl)).toBe('Tower of Solusek Ro — Xuzl');
    expect(announce.preclearName(null, xuzl)).toBe('Tower of Solusek Ro — Xuzl');
    expect(announce.preclearName('Tower of Solusek Ro', null)).toBe('Tower of Solusek Ro');
  });
  it('is an option, never expands the zone into its bosses, and titles itself Preclear', () => {
    const code = stripJs(readSource(path.join(ROOT, 'commands/announce.js')));
    expect(code).toMatch(/addBooleanOption\(opt => opt\.setName\('preclear'\)/);
    expect(code).toMatch(/\(zone && !isTrashRun && !preclear\) \? bosses\.filter/);
    expect(code).toMatch(/const kindLabel = preclear \? 'Preclear' : 'Pack Takedown'/);
    expect(code).toMatch(/setTitle\(`📣 \$\{kindLabel\}: \$\{announceName\}`\)/);
    expect(code).not.toMatch(/Pack Takedown: \$\{announceName\}/);
  });
});
