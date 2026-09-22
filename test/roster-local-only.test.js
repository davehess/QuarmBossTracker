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
// These drive the real `processOpenDkpExport` against a real export shape.
// Seeding goes through `addCharacterEntry` rather than a test-only setter —
// the module's own lookup is what the local-only pass reads, so using the
// public path is both honest and what `/register` actually does.
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
    addCharacterEntry({ name: 'Corvale', race: 'Gnome', charClass: 'Magician', localOnly: true });
    expect(names(processOpenDkpExport(EXPORT).active)).toContain('Corvale');
  });

  // The whole point of the flag. A character that vanished because it was
  // deleted UPSTREAM must still disappear — only "we chose not to create this"
  // is protected. Without this, the pass would resurrect real deletions.
  it('does NOT resurrect a character that was deleted upstream', () => {
    addCharacterEntry({ name: 'Rethlan', race: 'Ogre', charClass: 'Shaman' });   // no localOnly
    expect(names(processOpenDkpExport(EXPORT).active)).not.toContain('Rethlan');
  });

  it('re-nests a local alt under its main when the main is still in the export', () => {
    // `/register` refuses an alt whose main is not already in the roster, so
    // the main has to be present for this to be the real scenario. Without it
    // the alt lands standalone — correct behaviour, wrong test.
    addCharacterEntry({ name: 'Aldenmar', race: 'Human', charClass: 'Warrior' });
    addCharacterEntry({ name: 'Nyssara', race: 'Erudite', charClass: 'Enchanter', mainName: 'Aldenmar', localOnly: true });
    const main = processOpenDkpExport(EXPORT).active.find(e => e.n === 'Aldenmar');
    expect((main.a || []).map(a => a.n)).toContain('Nyssara');
  });

  it('does not duplicate one that later DOES appear upstream', () => {
    addCharacterEntry({ name: 'Aldenmar', race: 'Human', charClass: 'Warrior', localOnly: true });
    const got = names(processOpenDkpExport(EXPORT).active).filter(n => n === 'Aldenmar');
    expect(got.length).toBe(1);
  });

  // ⚠ The flag has to ride through Discord. `/rosterimport` saves the rebuilt
  // roster to the threads and then reloads from them, so `_local` is only
  // durable if it is part of the serialised entry — not a runtime-only field.
  it('keeps the _local flag on the rebuilt entry so the NEXT import sees it', () => {
    addCharacterEntry({ name: 'Zarrin', race: 'Troll', charClass: 'Shadow Knight', localOnly: true });
    const entry = processOpenDkpExport(EXPORT).active.find(e => e.n === 'Zarrin');
    expect(entry).toBeTruthy();
    expect(entry._local).toBe(true);
    expect(JSON.parse(JSON.stringify(entry))._local).toBe(true);   // survives the thread round-trip
  });
});
