// test/dps-pet-fold.test.js — a pet's damage belongs to the raider who brought
// it, even when that raider never swung.
//
// Hitya, live 2026-08-13: "Shavimo`s warder should be added to Shavimo's damage
// and have a little (+pet) next to their name."
// Hitya, live 2026-09-02, with a screenshot showing "Vkjor (Chadivarius)" as
// its own row: "it looks like when Chad charmed him it attributed to him, but
// it should be the other way around as Chad +pet."
//
// ⚠ THE MISSING CASE WAS THE COMMON ONE. The fold required the owner to
// ALREADY have a row, and an enchanter running a charm pet often does little or
// no direct damage — so they are absent from perPlayer entirely and the pet
// kept its own line. That reads as though the PET were the raider, which is
// backwards.
//
// Row tuple: [name, dmg, tookMax, pet_owner, _, _, pet_charm, localDmg, +pet]
//
// Run: npx vitest run test/dps-pet-fold.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'overlay.html'), 'utf8');

// ⚠ End anchor is the declaration that FOLLOWS, never a line of the function's
// own body — a slice closed on the code under test turns every mutation into
// "suite failed to load", which reads like a kill and proves nothing.
const { _foldPetsIntoOwners } = evalBlock(
  sliceBlock(src, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['_foldPetsIntoOwners'],
);

const row = (name, dmg, owner, charm) => [name, dmg, 0, owner || null, 0, 0, !!charm];
const by  = (rows) => Object.fromEntries(rows.map(r => [r[0], r]));

describe('a pet whose owner is already on the meter', () => {
  it('folds into the owner and marks them +pet', () => {
    const out = by(_foldPetsIntoOwners([row('Shavimo', 1000), row("Shavimo`s warder", 400, 'Shavimo')]));
    expect(Object.keys(out)).toEqual(['Shavimo']);
    expect(out.Shavimo[1]).toBe(1400);
    expect(out.Shavimo[8]).toBe(true);        // index 8 → "+pet"
  });
});

describe('a pet whose owner has NO row — the charmer case', () => {
  it('creates the owner and folds into them, instead of listing the pet', () => {
    // The exact screenshot: Vkjor doing 2.60K for Chadivarius, who never swung.
    const out = _foldPetsIntoOwners([row('Hitya', 4440), row('Vkjor', 2600, 'Chadivarius')]);
    const names = out.map(r => r[0]);
    expect(names).toContain('Chadivarius');
    expect(names).not.toContain('Vkjor');     // the pet is no longer its own raider
    expect(by(out).Chadivarius[1]).toBe(2600);
    expect(by(out).Chadivarius[8]).toBe(true);
  });

  it('uses the owner name exactly as the agent reported it', () => {
    // pet_owner carries the log's own casing; re-casing it would split the
    // row from the same player's guild-merged figure downstream.
    const out = _foldPetsIntoOwners([row('Vkjor', 100, 'Chadivarius')]);
    expect(out[0][0]).toBe('Chadivarius');
  });

  it('does not mark the created owner as a pet itself', () => {
    // A synthetic row with pet_owner set would try to fold into ITSELF on a
    // later pass, or be filtered as a pet by the caller's whitelist.
    const out = _foldPetsIntoOwners([row('Vkjor', 100, 'Chadivarius')]);
    expect(out[0][3]).toBe(null);
    expect(out[0][6]).toBe(false);
  });

  it('gathers several pets of one absent owner into a single row', () => {
    const out = _foldPetsIntoOwners([
      row('Vkjor', 1000, 'Chadivarius'),
      row('a lava beetle', 500, 'Chadivarius'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0][0]).toBe('Chadivarius');
    expect(out[0][1]).toBe(1500);
  });
});

describe('what must not change', () => {
  it('leaves an unattributed charm pet on its own row', () => {
    // pet_charm with no proven owner is deliberately NOT folded — nobody gets
    // credited for a charm we cannot attribute. It renders "(charmed)".
    const out = _foldPetsIntoOwners([row('Hitya', 100), row('a lava beetle', 900, null, true)]);
    expect(out.map(r => r[0])).toContain('a lava beetle');
    expect(out).toHaveLength(2);
  });

  it('leaves a meter with no pets exactly as it was', () => {
    const rows = [row('Hitya', 300), row('Fittir', 200), row('Damyu', 100)];
    const out = _foldPetsIntoOwners(rows.map(r => r.slice()));
    expect(out.map(r => r[0])).toEqual(['Hitya', 'Fittir', 'Damyu']);
    expect(out.every(r => !r[8])).toBe(true);
  });

  it('re-sorts by damage after folding, so a charmer lands at their real rank', () => {
    // Chadivarius contributes nothing until his pet folds in; if the sort ran
    // before the fold he would sit at the bottom on 0.
    const out = _foldPetsIntoOwners([
      row('Hitya', 900), row('Fittir', 500), row('Vkjor', 5000, 'Chadivarius'),
    ]);
    expect(out.map(r => r[0])).toEqual(['Chadivarius', 'Hitya', 'Fittir']);
  });

  it('never double-counts: the total is preserved', () => {
    const rows = [row('Hitya', 900), row('Shavimo', 100), row("Shavimo`s warder", 400, 'Shavimo'),
                  row('Vkjor', 2600, 'Chadivarius')];
    const before = rows.reduce((n, r) => n + r[1], 0);
    const after  = _foldPetsIntoOwners(rows).reduce((n, r) => n + r[1], 0);
    expect(after).toBe(before);
  });
});

// ⚠ The tests above prove the function is right, not that anything calls it.
// Stubbing the call site has left a correct function unwired behind a green
// suite four times today. Comments stripped — this file's prose would satisfy
// a naive toContain.
describe('and it is actually wired into the meter', () => {
  const clean = stripJs(src);
  it('runs on the rows the DPS/Tank tabs render', () => {
    expect(clean).toMatch(/allRows = _foldPetsIntoOwners\(allRows\)/);
  });
});
