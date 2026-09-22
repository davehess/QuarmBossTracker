// test/roster-local-only.test.js — a locally-registered trader must survive
// `/rosterimport`.
//
// The guild lead, 2026-09-22: "traders and non-raid Alts don't need to be in
// opendkp, only in our db." Acting on that alone would have lost data, and
// quietly: `processOpenDkpExport` rebuilds the roster ENTIRELY from the
// OpenDKP export, and `/rosterimport` writes that result over the threads. A
// character never created upstream is simply absent from the export, so the
// next import would delete it with no error anywhere.
//
// ⚠ The first version gated this on a `_local` flag, justified as protecting
// against upstream deletions. The guild lead pushed back that nobody has ever
// been deleted from OpenDKP, and checking agrees: leaving the raid sets
// `Active = 0`, which moves a character to the INACTIVE roster — they stay in
// the export. So the flag was machinery for a case that does not occur, and it
// is gone. The pass now keeps every absent name.
//
// These drive the real `processOpenDkpExport` against a real export shape.
// Seeding goes through `addCharacterEntry`, which is what `/register` does.
//
// Run: npx vitest run test/roster-local-only.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const { processOpenDkpExport, addCharacterEntry } = require_(path.join(ROOT, 'utils', 'roster.js'));

// Minimal OpenDKP export: one raid main with one raid alt.
const EXPORT = [
  { CharacterId: 100, Name: 'Aldenmar', Race: 'Human',    Class: 'Warrior', Rank: 'Raid Pack', Active: 1, ParentId: 0 },
  { CharacterId: 101, Name: 'Brackwyn', Race: 'Wood Elf', Class: 'Druid',   Rank: 'Raid Alt',  Active: 1, ParentId: 100 },
];

const names = (bucket) => {
  const out = [];
  for (const e of bucket) { out.push(e.n); for (const a of (e.a || [])) out.push(a.n); }
  return out;
};

describe('local-only characters survive a roster import', () => {
  it('re-adds a locally registered trader the export has never heard of', () => {
    addCharacterEntry({ name: 'Corvale', race: 'Gnome', charClass: 'Magician' });
    expect(names(processOpenDkpExport(EXPORT).active)).toContain('Corvale');
  });

  // ⚠ The cost of the simpler rule, pinned so it is a choice and not a
  // surprise: `/rosterimport` can no longer REMOVE anyone. It adds and
  // updates. A truncated or wrong export leaves the roster intact rather than
  // emptying it — the safer failure — but a genuine upstream deletion has to
  // be removed by hand.
  it('keeps an upstream character the export no longer mentions', () => {
    addCharacterEntry({ name: 'Rethlan', race: 'Ogre', charClass: 'Shaman' });
    expect(names(processOpenDkpExport(EXPORT).active)).toContain('Rethlan');
  });

  it('does not empty the roster when handed a truncated export', () => {
    addCharacterEntry({ name: 'Mirenne', race: 'Halfling', charClass: 'Rogue' });
    expect(names(processOpenDkpExport([]).active)).toContain('Mirenne');
  });

  it('re-nests a local alt under its main when the main is still in the export', () => {
    // `/register` refuses an alt whose main is not already in the roster, so
    // the main has to be present for this to be the real scenario. Without it
    // the alt lands standalone — correct behaviour, wrong test.
    addCharacterEntry({ name: 'Aldenmar', race: 'Human', charClass: 'Warrior' });
    addCharacterEntry({ name: 'Nyssara', race: 'Erudite', charClass: 'Enchanter', mainName: 'Aldenmar' });
    const main = processOpenDkpExport(EXPORT).active.find(e => e.n === 'Aldenmar');
    expect((main.a || []).map(a => a.n)).toContain('Nyssara');
  });

  it('does not duplicate one that later DOES appear upstream', () => {
    addCharacterEntry({ name: 'Aldenmar', race: 'Human', charClass: 'Warrior' });
    const got = names(processOpenDkpExport(EXPORT).active).filter(n => n === 'Aldenmar');
    expect(got.length).toBe(1);
  });

});
