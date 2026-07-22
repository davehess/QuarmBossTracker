// #124 — OpenDKP standings → pooled account balance. Source-slice fidelity test.
//
// The panel's DKP figure used to come from the bot's mirror recompute
// (_familyDkpTotals), which structurally can't reach OpenDKP's canonical number.
// The fix reads the standings directly and picks the account balance with the
// pure helper _pickAccountDkp. We slice that helper out of the REAL agent source
// and eval just it, so the test tracks the shipped code (rename/delete it and
// the slice throws loudly). Self-contained on purpose — this ships on the `beta`
// branch, which predates test/_source-slice.js, so we inline the tiny slicer.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'wolfpack-logsync', 'index.js',
);
const START = 'function _pickAccountDkp(models, main, familyNames) {';
const END = '// ── end #124 pure helper ──';

function slice() {
  const src = fs.readFileSync(AGENT_INDEX, 'utf8');
  const s = src.indexOf(START);
  const e = s < 0 ? -1 : src.indexOf(END, s);
  if (s < 0 || e < 0) throw new Error('#124 _pickAccountDkp slice markers not found in agent source');
  const block = src.slice(s, e + END.length);
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn { _pickAccountDkp };')();
}
const { _pickAccountDkp } = slice();

// A stand-in for the real OpenDKP standings Models[] (Hitya's family).
// The main "Hitya" reads 171 — exactly what the standings site shows for the
// account — while the alts carry their own separate rows.
const HITYA_STANDINGS = {
  AsOfDate: '2026-07-22T00:00:00Z',
  Models: [
    { CharacterName: 'Melting', CurrentDKP: 538, CharacterRank: 'Raid Alt' },
    { CharacterName: 'Canopy',  CurrentDKP: 526, CharacterRank: 'Raid Alt' },
    { CharacterName: 'Hitya',   CurrentDKP: 171, CharacterRank: 'Officer' },
    { CharacterName: 'Utoh',    CurrentDKP: -20, CharacterRank: 'Raid Alt' },
  ],
};
const FAM = ['Hitya', 'Canopy', 'Melting', 'Manamana', 'Utoh'];

describe('_pickAccountDkp — account balance from OpenDKP standings (source-sliced from agent)', () => {
  it('sliced the real function', () => {
    expect(typeof _pickAccountDkp).toBe('function');
  });

  it('returns the MAIN row (the standings account number = 171), not a family sum', () => {
    const r = _pickAccountDkp(HITYA_STANDINGS, 'Hitya', FAM);
    expect(r).toEqual({ dkp: 171, character: 'Hitya', matched: 'main' });
  });

  it('matches the main case-insensitively', () => {
    const r = _pickAccountDkp(HITYA_STANDINGS, 'hItYa', FAM);
    expect(r.dkp).toBe(171);
    expect(r.matched).toBe('main');
  });

  it('accepts a bare array as well as a { Models:[] } wrapper', () => {
    const r = _pickAccountDkp(HITYA_STANDINGS.Models, 'Hitya', FAM);
    expect(r.dkp).toBe(171);
  });

  it('tolerates CurrentDkp / Dkp field-name variants and Name/character_name', () => {
    const models = [
      { Name: 'Hitya', CurrentDkp: 171 },
      { character_name: 'Canopy', Dkp: 526 },
    ];
    expect(_pickAccountDkp(models, 'Hitya', ['Hitya', 'Canopy']).dkp).toBe(171);
    expect(_pickAccountDkp(models, 'Canopy', ['Hitya', 'Canopy']).dkp).toBe(526);
  });

  it('falls back to the highest-balance family member when the main is absent', () => {
    // main "Hitya" not in the standings (e.g. inactive → excluded from summary).
    const noMain = { Models: HITYA_STANDINGS.Models.filter(m => m.CharacterName !== 'Hitya') };
    const r = _pickAccountDkp(noMain, 'Hitya', FAM);
    expect(r).toEqual({ dkp: 538, character: 'Melting', matched: 'family' });
  });

  it('returns null when no family member appears in the standings', () => {
    expect(_pickAccountDkp(HITYA_STANDINGS, 'Nobody', ['Nobody', 'Ghost'])).toBe(null);
  });

  it('preserves a negative balance (a real deep-negative main is not clamped)', () => {
    const models = [{ CharacterName: 'Deepred', CurrentDKP: -125 }];
    expect(_pickAccountDkp(models, 'Deepred', ['Deepred']).dkp).toBe(-125);
  });

  it('ignores rows with no name or a non-finite balance', () => {
    const models = [
      { CharacterName: '', CurrentDKP: 999 },
      { CharacterName: 'Hitya', CurrentDKP: 'n/a' },
      { CharacterName: 'Hitya', CurrentDKP: 171 },   // first finite row wins
    ];
    expect(_pickAccountDkp(models, 'Hitya', ['Hitya']).dkp).toBe(171);
  });

  it('empty / non-array input → null (fail-open to the mirror figure)', () => {
    expect(_pickAccountDkp(null, 'Hitya', ['Hitya'])).toBe(null);
    expect(_pickAccountDkp({ Models: [] }, 'Hitya', ['Hitya'])).toBe(null);
  });
});
