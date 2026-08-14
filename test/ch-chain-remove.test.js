// test/ch-chain-remove.test.js — the ✕ that takes a healer off the chain.
//
// Hitya, 2026-08-14: "For the Pyxil scenario we should be able to remove from
// the chain via a [x]Remove button."
//
// The half that is easy to get wrong is what happens NEXT: whoever put them on
// the chain is still shouting their number, so a removal that only deletes the
// row gets undone within one beat and the button reads as broken. Removal
// therefore blocks that (name, number) for the life of the chain.
//
// The opposite failure is worse, and these tests pin the limits: a chain
// missing a real cleric kills the tank, so the block must stay as narrow as
// possible — one name on one number, cleared by a roster call, dead when the
// chain resets.
//
// Run: npx vitest run test/ch-chain-remove.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { trackChChainLine, chChainSnapshot, removeChChainSlot, _resetChChainForTest }
  from '../packages/wolfpack-logsync/index.js';

// Now-relative, for the same reason as ch-unnumbered-spot-heal.test.js: the
// snapshot drops a chain idle for 5 minutes, measured against Date.now().
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const z2 = n => String(n).padStart(2, '0');
function line(secondsAgo, body) {
  const d = new Date(Date.now() - secondsAgo * 1000);
  const ts = `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} `
    + `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())} ${d.getFullYear()}`;
  return `[${ts}] ${body}`;
}
const call = (secondsAgo, who, num) =>
  trackChChainLine(line(secondsAgo, `${who} tells the raid,  '${String(num).padStart(3, '0')} CH Hawkner 90%'`));

const slot = (snap, n) => snap && snap.slots && (snap.slots[String(n)] || snap.slots[n]);

describe('removing a healer from the chain', () => {
  beforeEach(() => _resetChChainForTest());

  it('takes the row away', () => {
    call(8, 'Fargan', 1); call(7, 'Bwavair', 2); call(6, 'Pyxil', 6);
    expect(slot(chChainSnapshot(), 6).name).toBe('Pyxil');

    const out = removeChChainSlot(6);
    expect(out.removed).toBe(true);
    expect(out.name).toBe('Pyxil');
    expect(slot(chChainSnapshot(), 6)).toBeFalsy();
  });

  it('KEEPS them off when they shout the number again', () => {
    // The whole point. Without the block this is where Pyxil comes straight
    // back and the button looks like it did nothing.
    call(8, 'Fargan', 1); call(6, 'Pyxil', 6);
    removeChChainSlot(6);
    call(3, 'Pyxil', 6);
    call(1, 'Pyxil', 6);
    expect(slot(chChainSnapshot(), 6), 'Pyxil must stay off 006').toBeFalsy();
  });

  it('still lets a DIFFERENT healer take that number', () => {
    // A re-assignment is a real thing the raid does mid-fight; blocking the
    // number instead of the person would quietly break the rotation.
    call(8, 'Fargan', 1); call(6, 'Pyxil', 6);
    removeChChainSlot(6);
    call(2, 'Mcdorf', 6);
    expect(slot(chChainSnapshot(), 6).name).toBe('Mcdorf');
  });

  it('does not touch any other slot', () => {
    call(8, 'Fargan', 1); call(7, 'Bwavair', 2); call(6, 'Pyxil', 6);
    removeChChainSlot(6);
    const snap = chChainSnapshot();
    expect(slot(snap, 1).name).toBe('Fargan');
    expect(slot(snap, 2).name).toBe('Bwavair');
  });

  it('hands the beat on rather than pointing at a row that is gone', () => {
    call(8, 'Fargan', 1); call(6, 'Bwavair', 2);
    // 002's successor is 003; nothing is there, so next wraps to the lowest
    // surviving slot. What must NOT happen is next_num staying on a deleted row.
    removeChChainSlot(chChainSnapshot().next_num);
    const nn = chChainSnapshot().next_num;
    if (nn != null) expect(slot(chChainSnapshot(), nn), 'next_num points at a live slot').toBeTruthy();
  });

  it('is a no-op on a slot nobody holds', () => {
    call(8, 'Fargan', 1);
    const out = removeChChainSlot(9);
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(false);
  });

  it('is a no-op with no chain running', () => {
    const out = removeChChainSlot(3);
    expect(out.removed).toBe(false);
  });
});

describe('a contested slot removes the right person', () => {
  beforeEach(() => _resetChChainForTest());

  // NOTE the ownership rule this rests on: the LAST caller owns the row, and
  // the earlier caller lives on in `claimants`. So in Hitya's actual scenario —
  // Mcdorf is 006, Pyxil mis-calls it — Pyxil is the row's *owner* by the time
  // anyone reaches for the ✕. That is exactly the case where deleting the slot
  // outright would take the real cleric off the rotation, which is the
  // dangerous direction.
  it('hands the slot back to the real cleric instead of deleting it', () => {
    call(8, 'Mcdorf', 6);
    call(6, 'Pyxil', 6);
    const before = slot(chChainSnapshot(), 6);
    expect(before.name, 'the last caller owns the row').toBe('Pyxil');
    expect((before.claimants || []).map(c => c.name)).toContain('Mcdorf');

    const out = removeChChainSlot(6, 'Pyxil');
    expect(out.removed).toBe(true);
    expect(out.slot_kept, 'the slot survives the removal').toBe(true);
    const after = slot(chChainSnapshot(), 6);
    expect(after, '006 must not vanish').toBeTruthy();
    expect(after.name, 'Mcdorf gets his number back').toBe('Mcdorf');
    expect((after.claimants || []).map(c => c.name)).not.toContain('Pyxil');
  });

  it('clears the conflict, and Pyxil calling again does not re-light it', () => {
    call(8, 'Mcdorf', 6);
    call(6, 'Pyxil', 6);
    removeChChainSlot(6, 'Pyxil');
    call(2, 'Pyxil', 6);
    const after = slot(chChainSnapshot(), 6);
    expect(after.name).toBe('Mcdorf');
    expect((after.claimants || []).map(c => c.name)).not.toContain('Pyxil');
  });

  it('removing a non-owner claimant leaves the owner alone', () => {
    call(8, 'Mcdorf', 6);
    call(6, 'Pyxil', 6);
    const out = removeChChainSlot(6, 'Mcdorf');
    expect(out.slot_kept).toBe(true);
    const after = slot(chChainSnapshot(), 6);
    expect(after.name, 'Pyxil still owns the row she called last').toBe('Pyxil');
    expect((after.claimants || []).map(c => c.name)).not.toContain('Mcdorf');
  });

  it('a name that is not on the slot at all is a no-op', () => {
    call(8, 'Mcdorf', 6);
    const out = removeChChainSlot(6, 'Fargan');
    expect(out.removed).toBe(false);
    expect(slot(chChainSnapshot(), 6).name).toBe('Mcdorf');
  });
});

describe('the block is narrow on purpose', () => {
  beforeEach(() => _resetChChainForTest());

  it('a roster call re-declares the rotation and overrides the removal', () => {
    // The raid stating its own order outranks anything we inferred or any ✕
    // an officer pressed a minute ago.
    call(8, 'Fargan', 1); call(6, 'Pyxil', 6);
    removeChChainSlot(6);
    trackChChainLine(line(3, "Fargan tells the raid,  'Fargan 001, Bwavair 002, Pyxil 003,'"));
    call(1, 'Pyxil', 3);
    expect(slot(chChainSnapshot(), 3).name, 'a re-declared roster puts her back').toBe('Pyxil');
  });

  it('two removals on one number do not erase each other', () => {
    // A single-name block field would silently un-block the first person here.
    call(9, 'Mcdorf', 6);
    removeChChainSlot(6);
    call(7, 'Pyxil', 6);
    removeChChainSlot(6);
    call(3, 'Mcdorf', 6);
    call(1, 'Pyxil', 6);
    expect(slot(chChainSnapshot(), 6), 'both stay blocked').toBeFalsy();
  });
});
