// test/ch-unnumbered-spot-heal.test.js — no number, no chain slot.
//
// Pyxil (druid) was spot-healing the RAMPAGE target and shouting her heals
// without a slot number:
//
//   [R] [Pyxil]: TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left
//
// Tunare's Renewal is a CH-equivalent, so the agent auto-assigned her a chain
// slot the first time it saw one. She landed on 006 — where Mcdorf actually
// was — which lit the ORDER CONFLICT banner and put a druid who was nowhere
// near the rotation into the middle of it.
//
// Hitya's rule: "she shouldn't be placed back onto the CH chain even though
// she's posting CHs." The number is what makes it a chain.
//
// The trap this guards against is the reasoning that USED to be in the code:
// "a rotation member who doesn't say their number should still keep a stable
// row." It sounds helpful and it silently corrupts the rotation, because a
// spot-healer shouting the same spell is indistinguishable from one.
//
// Run: npx vitest run test/ch-unnumbered-spot-heal.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import * as agent from '../packages/wolfpack-logsync/index.js';

const { trackChChainLine, chChainSnapshot, _resetChChainForTest } = agent;

// ⚠ Timestamps must be NOW-relative, not the literal raid-night times.
// chChainSnapshot() drops a chain that hasn't been touched in
// CH_CHAIN_IDLE_RESET_MS (5 min) and expires spot_heal after
// SPOT_HEAL_DISPLAY_MS (8s), both measured against Date.now() — a hard-coded
// "Aug 13 22:24:01" line parses fine and then reads as hours stale, so every
// assertion sees a null snapshot regardless of what the code does.
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, ' ');
const z2 = n => String(n).padStart(2, '0');
function line(secondsAgo, body) {
  const d = new Date(Date.now() - secondsAgo * 1000);
  const ts = `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${p2(d.getDate())} `
    + `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())} ${d.getFullYear()}`;
  return `[${ts}] ${body}`;
}

// Real numbered calls, so a chain genuinely exists to be corrupted.
function startChain() {
  trackChChainLine(line(6, 'Fargan tells the raid,  \'001 CH Hawkner 80%\''));
  trackChChainLine(line(5, 'Bwavair tells the raid,  \'002 CH Hawkner 86%\''));
  trackChChainLine(line(4, 'Mcdorf tells the raid,  \'006 CH Hawkner 94%\''));
}

describe('an un-numbered CH-equivalent shout', () => {
  beforeEach(() => _resetChChainForTest());

  it('does not take a slot, and does not displace the real 006', () => {
    startChain();
    const before = chChainSnapshot();
    expect(before.slots['6'] || before.slots[6]).toBeTruthy();
    const owner6 = (before.slots['6'] || before.slots[6]).name;
    expect(owner6).toBe('Mcdorf');

    // Pyxil's three real shouts from the raid.
    for (const t of [3, 2, 1]) {
      trackChChainLine(line(t, "Pyxil tells the raid,  'TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left'"));
    }

    const after = chChainSnapshot();
    const names = Object.values(after.slots).map(s => s && s.name);
    expect(names, 'Pyxil must not hold a chain slot').not.toContain('Pyxil');
    expect((after.slots['6'] || after.slots[6]).name, '006 still belongs to Mcdorf').toBe('Mcdorf');
  });

  it('shows up as a spot heal instead, keeping its CH-equivalent label', () => {
    startChain();
    trackChChainLine(line(2, "Pyxil tells the raid,  'TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left'"));
    const snap = chChainSnapshot();
    expect(snap.spot_heal || snap.spotHeal).toBeTruthy();
    const spot = snap.spot_heal || snap.spotHeal;
    expect(spot.name).toBe('Pyxil');
    expect(String(spot.target || '')).toMatch(/Timberowl/i);
  });

  it('does not advance the rotation', () => {
    startChain();
    const nextBefore = chChainSnapshot().next_num;
    trackChChainLine(line(2, "Pyxil tells the raid,  'TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left'"));
    expect(chChainSnapshot().next_num, 'a spot heal is not a beat').toBe(nextBefore);
  });

  it('never conjures a chain when none is running', () => {
    // Mirrors the GO-cue guard: a stray heal shout must not invent a rotation.
    trackChChainLine(line(2, "Pyxil tells the raid,  'TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left'"));
    const snap = chChainSnapshot();
    expect(snap === null || !snap.slots || Object.keys(snap.slots).length === 0).toBe(true);
  });
});

describe('a NUMBERED call still works exactly as before', () => {
  beforeEach(() => _resetChChainForTest());

  it('takes its slot and advances the rotation', () => {
    startChain();
    const snap = chChainSnapshot();
    expect((snap.slots['1'] || snap.slots[1]).name).toBe('Fargan');
    expect((snap.slots['2'] || snap.slots[2]).name).toBe('Bwavair');
    expect(snap.next_num).toBeGreaterThan(0);
  });

  it('lets a druid join properly if they DO call a number', () => {
    startChain();
    trackChChainLine(line(2, "Pyxil tells the raid,  '007 CH Hawkner 94%'"));
    const snap = chChainSnapshot();
    expect((snap.slots['7'] || snap.slots[7]).name).toBe('Pyxil');
  });
});
