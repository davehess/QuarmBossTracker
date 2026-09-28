// #petstats → the Pet and Charm windows (the guild lead, 2026-09-28: "This will help with haste
// percentage and damage expectations, as well as negative MR of charm pets or positive stats").
// #petstats is a Quarm server command from the PoP patch; it prints a block into the OWNER's log.
//
// Runs the agent's REAL applyPetSheetLine, sliced from the shipped source, over the block from the
// screenshot the guild lead sent (pet "Xibobab"; the owner name is invented).
// Run: npx vitest run test/pet-sheet.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const block = [
  sliceBlock(agent, 'const TS_RX = ', ';'),
  sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}'),
  sliceBlock(agent, 'const PET_HEALTH_TTL_MS = ', ';'),
  sliceBlock(agent, 'const _petSheetByOwner = new Map();',
    '  if (done) _petSheetOpen.delete(owner);\n  _savePetStateSoon();\n}'),
].join('\n');

function load() {
  const saves = { n: 0 };
  // eslint-disable-next-line no-new-func
  const mod = new Function('_savePetStateSoon', block +
    '\nreturn { applyPetSheetLine, _petSheetByOwner, _petSheetFresh, PET_HEALTH_TTL_MS };')(() => { saves.n++; });
  return { ...mod, saves };
}

const OWNER = 'Aldenmar';
const at = (sec) => `[Sun Sep 28 21:10:${String(sec).padStart(2, '0')} 2026] `;
const SLOTS = ['Ear 1', 'Head', 'Face', 'Ear 2', 'Neck', 'Shoulders', 'Arms', 'Back', 'Wrist 1', 'Wrist 2',
  'Range', 'Hands', 'Primary', 'Secondary', 'Finger 1', 'Finger 2', 'Chest', 'Legs', 'Feet', 'Waist', 'Ammo'];
function sheetLines({ pet = 'Xibobab', delay = 2800, magic = 35, sec = 1, items = {} } = {}) {
  return [
    `-- ${pet}'s Stats --`,
    'HP: 4000 / 4000',
    'AC: 180',
    'ATK: 956',
    'Attack Damage: 19 - 78 (avg 48.5)',
    `Attack Delay: ${delay} ms (${(delay / 1000).toFixed(2)}s)`,
    'Melee DPS: 17.3',
    `Resists: Magic ${magic} Fire 35 Cold 35 Poison 15 Disease 15`,
    '-- Equipped Inventory --',
    ...SLOTS.map((s) => `${s}: ${items[s] || '(Empty)'}`),
  ].map((l) => at(sec) + l);
}

describe('#petstats sheet parser', () => {
  it('reads every number off the block from the screenshot', () => {
    const { applyPetSheetLine, _petSheetByOwner } = load();
    for (const l of sheetLines()) applyPetSheetLine(l, OWNER);
    const s = _petSheetByOwner.get('aldenmar');
    expect(s).toMatchObject({
      pet: 'Xibobab', hp: 4000, hp_max: 4000, ac: 180, atk: 956,
      dmg_min: 19, dmg_max: 78, dmg_avg: 48.5, delay_ms: 2800, base_delay_ms: 2800, haste_pct: 0,
      dps: 17.3, resists: { magic: 35, fire: 35, cold: 35, poison: 15, disease: 15 }, complete: true,
    });
    expect(Object.keys(s.equipment)).toEqual(SLOTS);
    expect(Object.values(s.equipment).every((v) => v === null)).toBe(true);
  });

  it('keeps what a pet is wielding, raw', () => {
    // The screenshot's pet wore nothing; an equipped slot's exact wording is not captured yet, so the
    // parser stores whatever follows the slot name untouched.
    const { applyPetSheetLine, _petSheetByOwner } = load();
    for (const l of sheetLines({ items: { Primary: 'Summoned: Blade of Walnan', Secondary: 'Rusty Short Sword' } })) {
      applyPetSheetLine(l, OWNER);
    }
    const eq = _petSheetByOwner.get('aldenmar').equipment;
    expect(eq.Primary).toBe('Summoned: Blade of Walnan');
    expect(eq.Secondary).toBe('Rusty Short Sword');
    expect(eq.Head).toBeNull();
  });

  it('shows haste against the slowest delay seen for the same pet, and a debuffed MR', () => {
    const { applyPetSheetLine, _petSheetByOwner } = load();
    for (const l of sheetLines({ delay: 2800, sec: 1 })) applyPetSheetLine(l, OWNER);
    for (const l of sheetLines({ delay: 2000, magic: -12, sec: 30 })) applyPetSheetLine(l, OWNER);
    const s = _petSheetByOwner.get('aldenmar');
    expect(s.base_delay_ms).toBe(2800);
    expect(s.haste_pct).toBe(40);                 // 2800 / 2000 − 1
    expect(s.resists.magic).toBe(-12);            // negative MR comes through signed
    // A different pet starts its own baseline.
    for (const l of sheetLines({ pet: 'Gobanab', delay: 2000, sec: 50 })) applyPetSheetLine(l, OWNER);
    expect(_petSheetByOwner.get('aldenmar')).toMatchObject({ pet: 'Gobanab', base_delay_ms: 2000, haste_pct: 0 });
  });

  it('ignores the player\'s own stat block, lines from other characters, and a block gone quiet', () => {
    const { applyPetSheetLine, _petSheetByOwner } = load();
    applyPetSheetLine(at(1) + `-- ${OWNER}'s Stats --`, OWNER);
    applyPetSheetLine(at(1) + 'HP: 900 / 900', OWNER);
    expect(_petSheetByOwner.size).toBe(0);
    applyPetSheetLine(at(1) + "-- Xibobab's Stats --", OWNER);
    applyPetSheetLine(at(1) + 'AC: 180', 'Brackwyn');          // another boxed character's log
    expect(_petSheetByOwner.size).toBe(0);
    applyPetSheetLine(at(9) + 'AC: 180', OWNER);                // 8s later: the block has closed
    expect(_petSheetByOwner.size).toBe(0);
  });

  it('skips chat inside the block and still finishes it', () => {
    const { applyPetSheetLine, _petSheetByOwner } = load();
    const lines = sheetLines();
    lines.splice(4, 0, at(1) + 'Brackwyn tells the guild, \'inc\'');
    for (const l of lines) applyPetSheetLine(l, OWNER);
    expect(_petSheetByOwner.get('aldenmar')).toMatchObject({ atk: 956, complete: true });
  });

  it('a charmed mob\'s sheet expires, a summoned pet\'s does not', () => {
    const { _petSheetFresh, PET_HEALTH_TTL_MS } = load();
    const now = Date.parse('2026-09-28T22:00:00Z');
    const old = now - PET_HEALTH_TTL_MS - 1;
    expect(_petSheetFresh({ pet: 'Xibobab', read_at: old }, now)).toBe(true);
    expect(_petSheetFresh({ pet: 'a lava crawler', read_at: old }, now)).toBe(false);
    expect(_petSheetFresh({ pet: 'an orc warrior', read_at: now - 1000 }, now)).toBe(true);
  });
});

describe('#petstats wiring', () => {
  it('is fed from the tail loop, persisted, served on the Pet row, and cleared by dismiss', () => {
    const code = stripJs(agent);   // comments must not satisfy these
    expect(code).toContain('try { applyPetSheetLine(line, b.character); } catch {}');
    expect(code).toContain('petSheetByOwner: [..._petSheetByOwner.entries()],');
    expect(code).toMatch(/for \(const \[k, v\] of raw\.petSheetByOwner\) if \(_petSheetFresh\(v, now\)\) _petSheetByOwner\.set\(k, v\);/);
    expect(code).toMatch(/\n\s+sheet,\n\s+target,\n/);
    expect(code).toContain('if (_petSheetByOwner.delete(owner))  removed = true;');
  });
});
