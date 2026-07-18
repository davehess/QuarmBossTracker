// /who overlay enrichment assembly (#111) — SOURCE-SLICE fidelity tier.
//
// The main-in-parens + Mimic-presence assembly `_assembleWhoEnrichment` lives
// inside the bot monolith (index.js) and isn't exported (require()-ing index.js
// boots the Discord client). We read the real source and eval JUST that pure
// block — coupled to the shipped code: edit the assembly and this test exercises
// the new behavior; rename/delete it and the slice throws loudly. Same technique
// as test/budgets.test.js / test/election.test.js.
//
// The assembly is intentionally pure (Set/Map/String only), so it evals with no
// stubs. It carries the LOAD-BEARING privacy rule: a hidden name NEVER emits a
// main, even when a main is known and requested.

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src   = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  '// ── #111 /who overlay enrichment assembly',
  '// ── end #111 enrichment assembly',
);
const { _assembleWhoEnrichment } = evalBlock(block, ['_assembleWhoEnrichment']);

const lower = (arr) => new Set(arr.map(s => s.toLowerCase()));
const mapOf = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));

describe('_assembleWhoEnrichment (real index.js)', () => {
  it('emits (Main) + mimic for a guild member playing an alt', () => {
    const r = _assembleWhoEnrichment({
      names:    ['Sneakyalt'],
      mainMap:  mapOf({ Sneakyalt: 'Bigmain' }),
      mimicSet: lower(['Sneakyalt']),
      hideSet:  new Set(),
      base:     {},
    });
    expect(r.sneakyalt.main).toBe('Bigmain');
    expect(r.sneakyalt.mimic).toBe(true);
  });

  it('HIDE LIST: a hidden name NEVER emits a main, even when requested + known', () => {
    // Seed shape: Serreth → Peopleslayer, but Serreth is on the hide list.
    const r = _assembleWhoEnrichment({
      names:    ['Serreth'],
      mainMap:  mapOf({ Serreth: 'Peopleslayer' }),
      mimicSet: new Set(),
      hideSet:  lower(['Tildias', 'Serreth']),
      base:     {},
    });
    // No mimic, no shown main → the name passes through with NO result entry.
    expect(r.serreth).toBeUndefined();
  });

  it('HIDE LIST is enforced in BOTH directions — hiding the MAIN name hides every alt', () => {
    const r = _assembleWhoEnrichment({
      names:    ['Altone', 'Alttwo'],
      mainMap:  mapOf({ Altone: 'Peopleslayer', Alttwo: 'Someoneelse' }),
      mimicSet: new Set(),
      hideSet:  lower(['peopleslayer']),   // hide by the MAIN's name
      base:     {},
    });
    expect(r.altone).toBeUndefined();      // main is Peopleslayer → suppressed
    expect(r.alttwo.main).toBe('Someoneelse');   // unrelated main → still shown
  });

  it('a hidden member STILL gets the 🐺 (only the main is suppressed, not presence)', () => {
    const r = _assembleWhoEnrichment({
      names:    ['Serreth'],
      mainMap:  mapOf({ Serreth: 'Peopleslayer' }),
      mimicSet: lower(['Serreth']),
      hideSet:  lower(['Serreth']),
      base:     {},
    });
    expect(r.serreth.mimic).toBe(true);
    expect(r.serreth.main).toBeUndefined();
  });

  it('never annotates a main with itself (main_name === own name)', () => {
    const r = _assembleWhoEnrichment({
      names:    ['Bigmain'],
      mainMap:  mapOf({ Bigmain: 'Bigmain' }),
      mimicSet: new Set(),
      hideSet:  new Set(),
      base:     {},
    });
    expect(r.bigmain).toBeUndefined();
  });

  it('ANON LEVEL survives: enrichment merges onto de-anon results without clobbering level', () => {
    // base simulates the de-anon passes having filled an anon member's level.
    const base = { anonmember: { class: 'Enchanter', level: 60, guild: null, is_zek: false, source: 'who_directory' } };
    const r = _assembleWhoEnrichment({
      names:    ['Anonmember'],
      mainMap:  mapOf({ Anonmember: 'Theirmain' }),
      mimicSet: lower(['Anonmember']),
      hideSet:  new Set(),
      base,
    });
    expect(r.anonmember.level).toBe(60);           // de-anon level preserved
    expect(r.anonmember.class).toBe('Enchanter');  // de-anon class preserved
    expect(r.anonmember.main).toBe('Theirmain');   // + main added
    expect(r.anonmember.mimic).toBe(true);         // + mimic added
  });

  it('unknown / non-guild names pass through empty (no result entry created)', () => {
    const r = _assembleWhoEnrichment({
      names:    ['Randompug'],
      mainMap:  new Map(),
      mimicSet: new Set(),
      hideSet:  new Set(),
      base:     {},
    });
    expect(r.randompug).toBeUndefined();
    expect(Object.keys(r)).toHaveLength(0);
  });
});
