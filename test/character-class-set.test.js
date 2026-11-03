// test/character-class-set.test.js — an UNKNOWN class from OpenDKP must not erase a known one, and an officer can set it.
//
// The guild lead, 2026-11-03: a character's spells page said "no recognized caster class on record"; OpenDKP's literal
// 'UNKNOWN' overwrote anything stored on every sync. Covers the sync merge, the officer pick's validation, and the
// server action's guards (comment-stripped source assertions).
//
// Run: npx vitest run test/character-class-set.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { validateClassRace, topSighting, EQ_CLASSES } from '../web/lib/characterClass.ts';

const require = createRequire(import.meta.url);
const { mergeKnownClassRace } = require('../utils/openDkpSync.js');

describe('mergeKnownClassRace', () => {
  it('keeps a stored class/race when OpenDKP says UNKNOWN or nothing', () => {
    const rows = [{ name: 'Aldenmar', class: 'UNKNOWN', race: null }];
    const kept = mergeKnownClassRace(rows, [{ name: 'Aldenmar', class: 'Enchanter', race: 'Gnome' }]);
    expect(rows[0]).toMatchObject({ class: 'Enchanter', race: 'Gnome' });
    expect(kept).toBe(2);
  });
  it('lets a real OpenDKP value win', () => {
    const rows = [{ name: 'Brackwyn', class: 'Cleric', race: 'Human' }];
    expect(mergeKnownClassRace(rows, [{ name: 'Brackwyn', class: 'Wizard', race: 'Gnome' }])).toBe(0);
    expect(rows[0]).toMatchObject({ class: 'Cleric', race: 'Human' });
  });
  it('leaves an unknown as unknown when the stored value is unknown too', () => {
    const rows = [{ name: 'Corvale', class: 'UNKNOWN', race: 'unknown' }];
    mergeKnownClassRace(rows, [{ name: 'Corvale', class: 'Unknown', race: null }]);
    expect(rows[0]).toMatchObject({ class: 'UNKNOWN', race: 'unknown' });
  });
  it('matches names case-insensitively and ignores unmatched rows', () => {
    const rows = [{ name: 'RETHLAN', class: '', race: 'Human' }, { name: 'Nyssara', class: null, race: null }];
    mergeKnownClassRace(rows, [{ name: 'rethlan', class: 'Druid', race: 'Wood Elf' }]);
    expect(rows[0]).toMatchObject({ class: 'Druid', race: 'Human' });
    expect(rows[1]).toMatchObject({ class: null, race: null });
  });
});

describe('validateClassRace', () => {
  it('accepts a listed class, canonicalising case, with race left unchanged', () => {
    expect(validateClassRace('shadow knight', '')).toEqual({ ok: true, cls: 'Shadow Knight', race: null });
  });
  it('accepts a listed race', () => {
    expect(validateClassRace('Bard', 'half-elf')).toEqual({ ok: true, cls: 'Bard', race: 'Half-Elf' });
  });
  it('rejects unknown, empty and invented values', () => {
    expect(validateClassRace('UNKNOWN', '').ok).toBe(false);
    expect(validateClassRace('', '').ok).toBe(false);
    expect(validateClassRace('Jedi', '').ok).toBe(false);
    expect(validateClassRace('Bard', 'Wookiee').ok).toBe(false);
  });
  it('lists every base class once', () => {
    expect(new Set(EQ_CLASSES).size).toBe(EQ_CLASSES.length);
  });
});

describe('topSighting', () => {
  it('returns the most common real class and ignores unknowns', () => {
    expect(topSighting(['Cleric', 'Unknown', null, 'Wizard', 'Cleric', 'UNKNOWN']))
      .toEqual({ cls: 'Cleric', count: 2 });
    expect(topSighting(['Unknown', null])).toBeNull();
  });
});

describe('setCharacterClass action source', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/character/[name]/spells/actions.ts'), 'utf8'));
  const start = src.indexOf('export async function setCharacterClass');
  const body = src.slice(start, src.indexOf('export async function setSpellLevel'));
  it('re-checks the officer role server-side before writing', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/isOfficer\(user\.id\)/);
    expect(body.indexOf('isOfficer(')).toBeLessThan(body.indexOf(".update("));
  });
  it('validates the pick and writes an audit_log row', () => {
    expect(body).toMatch(/validateClassRace\(/);
    expect(body).toMatch(/from\('audit_log'\)\.insert/);
    expect(body).toMatch(/character_class_set/);
  });
});
