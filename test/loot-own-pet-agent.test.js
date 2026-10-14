// test/loot-own-pet-agent.test.js — the AGENT half of "gear a charmer loots back off their own pet's corpse is not loot".
//
// The guild lead, 2026-10-09: "anything a charmer gives to their pet (and we have the spawn ID) and they loot is not
// counted as loot. It was already theirs." The looted line names no corpse and no log line exists for handing an item to a
// pet, so the agent flags a loot from_own_pet ONLY when Zeal's target at that moment is provably the corpse of the pet it
// watched alive: same spawn id, same zone, a fresh record, a "'s corpse" name, a live line. Every missing condition must
// leave the line an ordinary loot (a missed flag is harmless; a wrong one hides real loot).
//
// The bot half (storage, sticky flag, totals, list) is test/loot-own-pet-bot.test.js on the main branch.
// Real source, sliced and run: _lootFromOwnPet, _noteOwnPetForLoot, trackLootedLine and uploadLooted. Names are invented.
//
// Run: npx vitest run test/loot-own-pet-agent.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);

function build() {
  const pets = sliceBlock(agentSrc, 'function _petNameForOwner(ownerLower) {', 'return Number.isInteger(id) && id > 0 ? id : null;\n}');
  const looted = sliceBlock(agentSrc, 'const _LOOTED_RX', '// ── Loot-link roll-call parsing');
  return evalBlock(`
    const _zealState = {};
    const _normMobName = (s) => String(s || '').toLowerCase().trim();
    const parseEqTimestamp = (line) => { const m = line.match(/^\\[T(\\d+)\\]/); return m ? new Date(Number(m[1])) : null; };
    const uploads = [];
    const enqueueUpload = (kind, body) => uploads.push({ kind, body });
    const _uploadOpts = { dryRun: false };
    const _isUploaderInstance = true;
    const AGENT_VERSION = 'test';
    ${pets}
    ${looted}
    `, ['_zealState', 'uploads', '_ownPetRecs', '_lootFromOwnPet', '_noteOwnPetForLoot', 'trackLootedLine', 'uploadLooted']);
}

const MIN = 60_000, HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const rec = (over = {}) => ({ id: 77, name: 'a decaying skeleton', zone: 'overthere', at: NOW - 5 * MIN, ...over });
const st = (over = {}) => ({ target_id: 77, target_name: "a decaying skeleton's corpse", zone: 'overthere', ...over });

describe('_lootFromOwnPet — the exact conjunction', () => {
  let h;
  beforeEach(() => { h = build(); });

  it('flags when every condition holds', () => {
    expect(h._lootFromOwnPet(st(), rec(), 'overthere', NOW)).toBe(true);
    expect(h._lootFromOwnPet(st(), rec(), 'overthere', NOW, NOW - 2000)).toBe(true);
  });

  it('accepts the corpse spellings the HUD already accepts: any case, a backtick, a numeric suffix', () => {
    for (const n of ["Aldenmar`s corpse", "ALDENMAR'S CORPSE", "a decaying skeleton's corpse12", "a decaying skeleton’s corpse"]) {
      expect(h._lootFromOwnPet(st({ target_name: n }), rec(), 'overthere', NOW)).toBe(true);
    }
  });

  it('does NOT flag without a positive integer target id', () => {
    for (const id of [0, -3, null, undefined, '77', 77.5, NaN]) {
      expect(h._lootFromOwnPet(st({ target_id: id }), rec(), 'overthere', NOW)).toBe(false);
    }
  });

  it('does NOT flag with a zero or invalid remembered pet id, even when the target id is equally zero', () => {
    expect(h._lootFromOwnPet(st({ target_id: 0 }), rec({ id: 0 }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st({ target_id: -1 }), rec({ id: -1 }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec({ id: null }), 'overthere', NOW)).toBe(false);
  });

  it('does NOT flag when the target id is not the pet id', () => {
    expect(h._lootFromOwnPet(st({ target_id: 78 }), rec(), 'overthere', NOW)).toBe(false);
  });

  it('does NOT flag on a zone mismatch or when either zone is unknown', () => {
    expect(h._lootFromOwnPet(st(), rec({ zone: 'tactics' }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec(), 'tactics', NOW)).toBe(false);
    for (const z of [null, undefined, '', 0, '0']) {
      expect(h._lootFromOwnPet(st(), rec(), z, NOW)).toBe(false);
      expect(h._lootFromOwnPet(st(), rec({ zone: z }), 'overthere', NOW)).toBe(false);
      expect(h._lootFromOwnPet(st(), rec({ zone: z }), z, NOW)).toBe(false);   // unknown on both sides is not "the same zone"
    }
  });

  it('does NOT flag a stale record (2 hours is the edge) or one from the future', () => {
    expect(h._lootFromOwnPet(st(), rec({ at: NOW - 2 * HOUR + 1000 }), 'overthere', NOW)).toBe(true);
    expect(h._lootFromOwnPet(st(), rec({ at: NOW - 2 * HOUR }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec({ at: NOW - 3 * HOUR }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec({ at: NOW + MIN }), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec({ at: undefined }), 'overthere', NOW)).toBe(false);
  });

  it('does NOT flag when the target is not a corpse, or its name is unknown', () => {
    for (const n of ['a decaying skeleton', 'Aldenmar', "a corpse of a skeleton", "Aldenmar's corpse of doom", '', null, undefined]) {
      expect(h._lootFromOwnPet(st({ target_name: n }), rec(), 'overthere', NOW)).toBe(false);
    }
    const noName = { target_id: 77, zone: 'overthere' };
    expect(h._lootFromOwnPet(noName, rec(), 'overthere', NOW)).toBe(false);
  });

  it('does NOT flag with no pet record or no state', () => {
    expect(h._lootFromOwnPet(st(), undefined, 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(st(), null, 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(null, rec(), 'overthere', NOW)).toBe(false);
    expect(h._lootFromOwnPet(undefined, rec(), 'overthere', NOW)).toBe(false);
  });

  it('does NOT flag a line that is not live (a lagging or replayed tail is judged against a target that has moved on)', () => {
    expect(h._lootFromOwnPet(st(), rec(), 'overthere', NOW, NOW - 31_000)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec(), 'overthere', NOW, NOW - 3 * HOUR)).toBe(false);
    expect(h._lootFromOwnPet(st(), rec(), 'overthere', NOW, NaN)).toBe(false);
  });
});

describe('_noteOwnPetForLoot — remembering the pet while it lives', () => {
  let h;
  beforeEach(() => { h = build(); });
  const petState = (over = {}) => ({ gauges: [{ slot: 16, text: 'a decaying skeleton' }], pet_id: 77, zone: 'overthere', ...over });
  const feed = (state, now) => { h._zealState.Aldenmar = state; h._noteOwnPetForLoot('Aldenmar', state, now); };

  it('records id, name, zone and time from a provable own pet', () => {
    feed(petState(), NOW);
    expect(h._ownPetRecs.get('aldenmar')).toEqual({ id: 77, name: 'a decaying skeleton', zone: 'overthere', at: NOW });
  });

  it('records nothing for pet id 0 / missing (no pet is not spawn zero) or a pet gauge with no id', () => {
    feed(petState({ pet_id: 0 }), NOW);
    feed(petState({ pet_id: undefined }), NOW);
    feed({ pet_id: 77, zone: 'overthere' }, NOW);   // no pet gauge: not provable
    expect(h._ownPetRecs.size).toBe(0);
  });

  it('keeps the record after the pet is gone, in the same zone — that is the point', () => {
    feed(petState(), NOW);
    feed({ zone: 'overthere', target_id: 77, target_name: "a decaying skeleton's corpse" }, NOW + MIN);
    expect(h._ownPetRecs.get('aldenmar').id).toBe(77);
  });

  it('clears the record on a zone change, but not when a zone is merely unknown', () => {
    feed(petState(), NOW);
    feed({ zone: null }, NOW + MIN);
    feed({}, NOW + 2 * MIN);
    expect(h._ownPetRecs.has('aldenmar')).toBe(true);
    feed({ zone: 'tactics' }, NOW + 3 * MIN);
    expect(h._ownPetRecs.has('aldenmar')).toBe(false);
  });

  it('expires the record after two hours', () => {
    feed(petState(), NOW);
    feed({ zone: 'overthere' }, NOW + 2 * HOUR - 1000);
    expect(h._ownPetRecs.has('aldenmar')).toBe(true);
    feed({ zone: 'overthere' }, NOW + 2 * HOUR);
    expect(h._ownPetRecs.has('aldenmar')).toBe(false);
  });

  it('a new pet replaces the old id', () => {
    feed(petState(), NOW);
    feed(petState({ pet_id: 91, gauges: [{ slot: 16, text: 'a gnoll' }] }), NOW + MIN);
    expect(h._ownPetRecs.get('aldenmar')).toMatchObject({ id: 91, name: 'a gnoll' });
  });

  it('keeps each character separate', () => {
    feed(petState(), NOW);
    h._zealState.Brackwyn = petState({ pet_id: 12 });
    h._noteOwnPetForLoot('Brackwyn', h._zealState.Brackwyn, NOW);
    expect(h._ownPetRecs.get('aldenmar').id).toBe(77);
    expect(h._ownPetRecs.get('brackwyn').id).toBe(12);
  });
});

describe('trackLootedLine / uploadLooted — the payload', () => {
  let h;
  beforeEach(() => { h = build(); });
  const line = (item) => `[T${Date.now()}] --You have looted a ${item}.--`;
  function loot(item, state, petRec) {
    h._zealState.Aldenmar = state;
    if (petRec) h._ownPetRecs.set('aldenmar', petRec);
    h.trackLootedLine(line(item), 'Aldenmar');
    h.uploadLooted();
    return h.uploads.at(-1).body.events.at(-1);
  }
  const now = () => Date.now();

  it('sends from_own_pet: true when the target is the remembered pet corpse', () => {
    const ev = loot('Cloak of Flames', st(), rec({ at: now() - MIN }));
    expect(ev.from_own_pet).toBe(true);
    expect(ev).toMatchObject({ item: 'Cloak of Flames', looter: 'Aldenmar', zone: 'overthere' });
  });

  it('omits the key entirely otherwise — the payload keeps its old shape', () => {
    const ev = loot('Cloak of Flames', st({ target_name: 'a decaying skeleton' }), rec({ at: now() - MIN }));
    expect(Object.keys(ev).sort()).toEqual(['at', 'item', 'looter', 'zone']);
  });

  it('omits it with no pet record at all (no Zeal ids, or the pet was never seen)', () => {
    const ev = loot('Cloak of Flames', st());
    expect(Object.keys(ev).sort()).toEqual(['at', 'item', 'looter', 'zone']);
  });

  it('omits it when the loot target is someone else\'s corpse (id differs)', () => {
    const ev = loot('Cloak of Flames', st({ target_id: 500 }), rec({ at: now() - MIN }));
    expect(ev).not.toHaveProperty('from_own_pet');
  });

  it('omits it for a replayed line (old timestamp), even with a matching target', () => {
    h._zealState.Aldenmar = st();
    h._ownPetRecs.set('aldenmar', rec({ at: now() - MIN }));
    h.trackLootedLine(`[T${now() - 10 * MIN}] --You have looted a Cloak of Flames.--`, 'Aldenmar');
    h.uploadLooted();
    expect(h.uploads.at(-1).body.events.at(-1)).not.toHaveProperty('from_own_pet');
  });
});

describe('source text (comments stripped)', () => {
  const code = stripJs(agentSrc);
  it('the zeal-state handler feeds the pet record, and a camp clears it', () => {
    expect(code).toMatch(/_noteOwnPetForLoot\(character, st, Date\.now\(\)\)/);
    expect(code).toMatch(/_ownPetRecs\.delete\(_cl\)/);
  });
  it('the upload adds the key only when flagged', () => {
    expect(code).toMatch(/\.\.\.\(e\.fromOwnPet \? \{ from_own_pet: true \} : \{\}\)/);
  });
});
