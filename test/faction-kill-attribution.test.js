// test/faction-kill-attribution.test.js — naming the kill that caused a faction
// hit is what turns "got worse" into a number.
//
// Hitya, 2026-09-03: "if we don't see the name of the mob that died and still
// get the faction hit, we can't attribute how much we are getting hit by unless
// it says that we are at the maximum positive or negative values... If we see
// the mob that died and at the same time, we end up seeing the faction, then
// it's not so bad."
//
// Classic prints no magnitude on a faction line, but eqemu_npc_faction_entries
// holds the exact per-mob value. Validated end to end against Hitya's own log:
// one #Lord_Inquisitor_Seru kill is -2000 to each of Seru/Hand/Eye/Heart/
// Shoulders and +200 to four Katta factions; one A_Greater_Spire_Spirit is +5
// to six Seru-bloc factions, -5 The Recuso, -50 Spire Spirits.
//
// ⚠ ORDER-INDEPENDENT ON PURPOSE. Every line of a kill shares one timestamp
// SECOND, but which prints first — the slain line or the faction lines — is a
// client detail the two source screenshots cannot settle (they were separate
// filtered windows). Both directions must work or attribution is silently lost
// on every kill.
//
// Run: npx vitest run test/faction-kill-attribution.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

function load() {
  return evalBlock(
    `
    const factionBuffer = [];
    function parseEqTimestamp(line){ const m=String(line).match(/^\\[(.+?)\\]/); return m ? new Date(m[1] + ' UTC') : null; }
    `
    + sliceBlock(src, 'const _slainAtSecond = new Map();', '\n// Standing-change dedup so /con spam')
    + '\n',
    ['noteSlainForFaction', '_slainForFactionHit', 'parseFactionLine', 'factionBuffer', '_slainAtSecond'],
  );
}

const TS   = '[Wed Sep 03 09:43:51 2026] ';
const ISO  = new Date('Wed Sep 03 09:43:51 2026 UTC').toISOString();
const hit  = (faction, dir) => TS + `Your faction standing with ${faction} got ${dir}.`;
const slain = (mob) => TS + `You have slain ${mob}!`;

describe('the kill and the hit arrive in the same second', () => {
  it('attributes a hit that follows the slain line', () => {
    const h = load();
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit', ISO);
    const e = h.parseFactionLine(hit('Heart of Seru', 'better'), 'Hitya');
    expect(e.mob).toBe('A Greater Spire Spirit');
    expect(e.direction).toBe(1);
  });

  it('attributes hits that were buffered BEFORE the slain line', () => {
    // The other order. Without the forward patch this silently returns nothing
    // useful on every kill where the client prints faction first.
    const h = load();
    for (const f of ['Seru', 'Hand of Seru', 'Eye of Seru']) {
      h.factionBuffer.push(h.parseFactionLine(hit(f, 'better'), 'Hitya'));
    }
    expect(h.factionBuffer.every(e => !e.mob)).toBe(true);
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit', ISO);
    expect(h.factionBuffer.map(e => e.mob))
      .toEqual(['A Greater Spire Spirit', 'A Greater Spire Spirit', 'A Greater Spire Spirit']);
  });

  it('attributes the whole burst of one kill, capped lines included', () => {
    // Hitya's log: 5 "got better", 1 "could not possibly get any better",
    // 2 "could not possibly get any worse" — all one second, all one kill.
    const h = load();
    const lines = [
      hit('Seru', 'better'), hit('Hand of Seru', 'better'), hit('Eye of Seru', 'better'),
      hit('Heart of Seru', 'better'), hit('Shoulders of Seru', 'better'),
      TS + 'Your faction standing with Citizens of Seru could not possibly get any better.',
      TS + 'Your faction standing with Spire Spirits could not possibly get any worse.',
      TS + 'Your faction standing with The Recuso could not possibly get any worse.',
    ];
    for (const l of lines) h.factionBuffer.push(h.parseFactionLine(l, 'Hitya'));
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit', ISO);
    expect(h.factionBuffer).toHaveLength(8);
    expect(h.factionBuffer.every(e => e.mob === 'A Greater Spire Spirit')).toBe(true);
    expect(h.factionBuffer.filter(e => e.capped)).toHaveLength(3);
  });
});

describe('what it refuses to attribute', () => {
  it('leaves mob undefined when no kill was seen', () => {
    // Someone else landed the killing blow, or the corpse was out of range.
    // The hit is still worth recording for its direction and cap flag.
    const h = load();
    const e = h.parseFactionLine(hit('Heart of Seru', 'worse'), 'Hitya');
    expect(e.mob).toBeUndefined();
    expect(e.direction).toBe(-1);
  });

  it('does not reach across seconds', () => {
    // A kill one second earlier is a DIFFERENT kill. Widening this to a window
    // would attach the wrong mob's value, which is worse than none.
    const h = load();
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit',
      new Date('Wed Sep 03 09:43:50 2026 UTC').toISOString());
    expect(h.parseFactionLine(hit('Heart of Seru', 'better'), 'Hitya').mob).toBeUndefined();
  });

  it('does not attribute another character\'s kill', () => {
    const h = load();
    h.noteSlainForFaction('Canopy', 'A Greater Spire Spirit', ISO);
    expect(h.parseFactionLine(hit('Heart of Seru', 'better'), 'Hitya').mob).toBeUndefined();
  });

  it('never overwrites an attribution a later kill would claim', () => {
    // Two kills in the same second are genuinely ambiguous; the forward patch
    // must not relabel a hit that already has a mob.
    const h = load();
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit', ISO);
    h.factionBuffer.push(h.parseFactionLine(hit('Seru', 'better'), 'Hitya'));
    h.noteSlainForFaction('Hitya', 'A Lesser Spire Spirit', ISO);
    expect(h.factionBuffer[0].mob).toBe('A Greater Spire Spirit');
  });

  it('only ever patches HIT events', () => {
    // A con event carries its own mob, so the "already has a mob" clause would
    // shield it anyway — this pins the kind check itself, with an event that
    // has no mob to hide behind.
    const h = load();
    h.factionBuffer.push({ kind: 'con', character: 'Hitya', ts: ISO });
    h.noteSlainForFaction('Hitya', 'A Greater Spire Spirit', ISO);
    expect(h.factionBuffer[0].mob).toBeUndefined();
  });

  it('keeps the map from growing without bound on a full-log crawl', () => {
    const h = load();
    // ⚠ DISTINCT seconds. An earlier draft used `i % 60`, so the map only ever
    // held 60 keys and the assertion passed whether the cap existed or not.
    for (let i = 0; i < 900; i++) {
      h.noteSlainForFaction('Hitya', 'mob' + i, new Date(Date.UTC(2026, 8, 3, 0, 0, 0, 0) + i * 1000).toISOString());
    }
    expect(h._slainAtSecond.size).toBeLessThanOrEqual(400);
    // And it keeps the NEWEST, not the oldest — a crawl attributes what it is
    // reading now, not what it read an hour ago.
    expect(h._slainForFactionHit('Hitya', new Date(Date.UTC(2026, 8, 3, 0, 0, 0, 0) + 899 * 1000).toISOString()))
      .toBe('mob899');
  });
});
