// test/spell-class-levels.test.js — the per-class spell level parse.
//
// Lacunanight, 2026-08-25: "Spell: Petrifying Earth is a Cleric 64 spell but
// get it under Ethereal parchment (61-62) spells." He was right, and the
// level was ours: `spell_level_seed` holds ONE integer per spell — the
// MINIMUM across every class that can scribe it — with the per-class truth
// kept only in a free-text `note` ("Cleric 64, Shaman 64, Necromancer 62").
// A cleric was shown the necromancer's 62.
//
// Migration 20260825050000 promotes that note to the `spell_class_levels`
// view via a regex. This test guards the REGEX ITSELF, extracted from the
// shipped migration, against real note strings from the table — because the
// failure mode is silent: a regex that stops matching doesn't error, it just
// drops per-class levels and quietly restores the old wrongness.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260825050000_spell_class_levels.sql'), 'utf8');

// Pull the pattern out of the migration so the test can never drift from it.
function migrationRegex() {
  const m = SQL.match(/regexp_matches\(\s*\n?\s*sd\.note,\s*'([^']+)'/);
  if (!m) throw new Error('parse regex not found in migration — did the view change?');
  // Postgres doubles no quotes here; the class/level pattern is plain PCRE.
  return new RegExp(m[1], 'g');
}

function parseNote(note) {
  const out = {};
  for (const m of note.matchAll(migrationRegex())) {
    out[m[1].trim().toLowerCase().replace(/\s+/g, '')] = Number(m[2]);
  }
  return out;
}

// Verbatim notes from spell_level_seed (2026-08-25).
const NOTES = {
  petrifyingEarth: 'Cleric 64, Shaman 64, Necromancer 62',
  pacification:    'Cleric 65, Enchanter 62',
  greaterImmob:    'Cleric 62, Paladin 61, Shaman 62, Necromancer 63',
  shadowSight:     'Shadow Knight 49, Necromancer 24',
  infusion:        'Shaman 49, Beastlord 61',
  single:          'Cleric 61',
};

describe('the per-class note parse', () => {
  it('reads the case that was reported', () => {
    // The bug: seed level 62 (necro) was shown to clerics, whose level is 64.
    expect(parseNote(NOTES.petrifyingEarth)).toEqual({
      cleric: 64, shaman: 64, necromancer: 62,
    });
  });

  it('handles two-word class names', () => {
    // 'Shadow Knight' must not parse as class 'Knight' or split the level off.
    expect(parseNote(NOTES.shadowSight)).toEqual({ shadowknight: 49, necromancer: 24 });
  });

  it('handles a single-class note', () => {
    expect(parseNote(NOTES.single)).toEqual({ cleric: 61 });
  });

  it('parses every class in a four-class note', () => {
    expect(Object.keys(parseNote(NOTES.greaterImmob))).toHaveLength(4);
  });

  it('the seed level is the MINIMUM — which is why it cannot be trusted per class', () => {
    // This is the invariant that made the old display wrong. If a future
    // scrape changes it, the view's fallback assumptions need revisiting.
    for (const note of Object.values(NOTES)) {
      const lv = Object.values(parseNote(note));
      expect(Math.min(...lv)).toBe(Math.min(...lv));   // parse produced numbers
      expect(lv.every(Number.isFinite)).toBe(true);
    }
    expect(Math.min(...Object.values(parseNote(NOTES.petrifyingEarth)))).toBe(62);
    expect(Math.min(...Object.values(parseNote(NOTES.infusion)))).toBe(49);
  });

  it('worst observed understatement is real: 25 levels', () => {
    const p = parseNote(NOTES.shadowSight);
    expect(p.shadowknight - p.necromancer).toBe(25);
  });
});

describe('the migration keeps its safety rails', () => {
  it('ships a parse-health view so a broken regex is visible, not silent', () => {
    expect(SQL).toContain('spell_class_levels_parse_ok');
    expect(SQL).toContain('unknown_class_tokens');
  });

  it('pop_spell_needs prefers the class level and falls back to the seed', () => {
    expect(SQL).toContain('COALESCE(scl.level, s.seed_level)');
  });

  it('joins classes space-insensitively (Shadow Knight / Shadowknight)', () => {
    expect(SQL).toContain("replace(lower(trim(c.class)), ' ', '')");
  });
});
