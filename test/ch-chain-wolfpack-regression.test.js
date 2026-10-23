// test/ch-chain-wolfpack-regression.test.js — Wolf Pack's own shout chain must not move.
//
// The guild lead, 2026-10-23: "DO NOT disrupt the shout ones for wolf pack." The CH chain
// also reads other guilds' call formats and the user's learned templates (DESIGN-ch-chain.md);
// those are ADDITIONAL matchers tried only when the original parser does not match a line.
// This test pins the original behaviour: a full chain (roster, every shout form, go-cues,
// a druid gap-fill, a spot heal, an interrupt, a duplicate claimant, chatter that merely
// mentions CH) is fed line by line through the real tracker, and the whole chain state after
// every line — slots, order, next, beat, DDR grades, go cue, spot heal, conflict flag — plus
// every spoken "0N GO" must equal test/fixtures/ch-chain-wolfpack-golden.json, which was
// captured from the tracker BEFORE the new matchers existed.
//
// Times are stored relative to the scenario start so the golden holds in any timezone.
//
// Run: npx vitest run test/ch-chain-wolfpack-regression.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ch-chain-wolfpack-golden.json');

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const z2 = n => String(n).padStart(2, '0');
const T0 = new Date(2026, 9, 21, 20, 0, 0).getTime();   // local time, like the log
function stamp(sec) {
  const d = new Date(T0 + sec * 1000);
  return `[${DAY[d.getDay()]} ${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} `
    + `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())} ${d.getFullYear()}]`;
}

// [seconds, raw log body]. Names are invented. The forms are the ones the guild's own
// clerics type: dash, arrow, colon, bracketed target, DRUID gap-fill, roster, go-cues.
const SCENARIO = [
  [0,   `Brackwyn tells the raid,  'Brackwyn 001, Corvale 002, Rethlan 003, Nyssara 004, Zarrin 005,'`],
  [3,   `Aldenmar shouts, 'LOOT CHEST by the door, grab the rune'`],
  [5,   `Brackwyn shouts, '001 - CH - Hawkner - Mana: 52%'`],
  [7,   `Brackwyn shouts, '002 GO GO GO'`],
  [9,   `Corvale shouts, '002 ---> CH on Hawkner - mana -> 66%'`],
  [10,  `Corvale shouts, '003 GO GO GO'`],
  [13,  `Rethlan shouts, '003 - CH: Hawkner - Mana: 61%'`],
  [14,  `Wrenly shouts, 'TUNARE'S RENEWAL  Inc to Hawkner - 91% Mana Left'`],
  [17,  `Nyssara tells the raid,  '004 CH < Hawkner > Mana: 53%'`],
  [18,  `Nyssara tells the raid,  '005 GO GO GO'`],
  [21,  `Zarrin says out of character, '005 - CH - Hawkner - Mana: 88%'`],
  [22,  `Quillan shouts, '001 - go go go'`],
  [26,  `Brackwyn shouts, '001 - CH - Hawkner - Mana: 49%'`],
  [30,  `Pyxil shouts, '002 - DRUID CH - Hawkner'`],
  [31,  `Corvale shouts, '002 - CH - Hawkner - Mana: 60%'`],
  [34,  `Rethlan shouts, '003 - CH - Hawkner - Mana: 58%'`],
  [35,  `Rethlan's casting is interrupted!`],
  [38,  `Nyssara shouts, '004 - CH - Hawkner - Mana: 50%'`],
  [39,  `Bluesage shouts, 'Circled Toe Bones tradable'`],
  [42,  `Zarrin shouts, '005 - CH - Hawkner - Mana: 44%'`],
  [43,  `Zarrin shouts, '005 GO GO GO'`],
  [47,  `Mcdorf shouts, '001 - CH - Hawkner - Mana: 70%'`],
  [51,  `Corvale shouts, '002 - CH - Hawkner - Mana: 55%'`],
  [55,  `Rethlan shouts, '003 - CH - Hawkner - Mana: 52%'`],
  [59,  `Nyssara shouts, '004 - CH - Hawkner - Mana: 46%'`],
  [200, `Brackwyn shouts, '001 - CH - Hawkner - Mana: 40%'`],
];

// Numbers that are epoch-ms (>= 1e12) become offsets from T0 so the golden is timezone-free.
function rel(v) {
  if (Array.isArray(v)) return v.map(rel);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rel(x)]));
  return (typeof v === 'number' && v >= 1e12) ? v - T0 : v;
}

function run() {
  const out = [];
  // Corvale is "us": slot 002's go-cue speaks through the trigger pipeline.
  const watched = { character: 'Corvale', lastSeen: Date.now() };
  agent._setWatchedLogsForTest([watched]);
  agent._activeOverlaysForTest().length = 0;
  for (const [sec, body] of SCENARIO) {
    vi.setSystemTime(T0 + sec * 1000 + 500);
    watched.lastSeen = Date.now();
    const line = `${stamp(sec)} ${body}`;
    agent.trackChChainLine(line, 'Corvale');
    agent.trackChChainInterrupt(line, 'Corvale');
    const spoken = agent._activeOverlaysForTest().filter(o => o.trigger === 'CH GO').map(o => o.tts).reverse();
    out.push({ sec, snap: rel(JSON.parse(JSON.stringify(agent.chChainSnapshot()))), spoken });
  }
  return out;
}

describe('Wolf Pack shout chain — identical to the pre-change tracker', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); agent._resetChChainForTest(); });
  afterEach(() => { vi.useRealTimers(); agent._setWatchedLogsForTest([]); agent._activeOverlaysForTest().length = 0; agent._resetChChainForTest(); });

  it('every line leaves the chain exactly as the golden capture says', () => {
    const got = run();
    // CH_GOLDEN_WRITE=1 re-captures the fixture. Only ever do that on code that predates the change under test.
    if (process.env.CH_GOLDEN_WRITE) fs.writeFileSync(GOLDEN, '[\n' + got.map(g => JSON.stringify(g)).join(',\n') + '\n]\n');
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(got).toEqual(golden);
  });

  it('the scenario is not vacuous: five slots, a measured beat, DDR grades, a spoken GO, a spot heal, an interrupt', () => {
    const got = run();
    const last = got[got.length - 2].snap;
    expect(Object.keys(last.slots).length).toBe(5);
    expect(got.some(g => g.snap && g.snap.beat_ms)).toBe(true);
    expect(got.some(g => g.snap && Object.values(g.snap.slots).some(s => s.grade))).toBe(true);
    expect(got.some(g => g.spoken.length > 0)).toBe(true);
    expect(got.some(g => g.snap && g.snap.spot_heal)).toBe(true);
    expect(got.some(g => g.snap && Object.values(g.snap.slots).some(s => s.interruptedAt))).toBe(true);
    expect(got.some(g => g.snap && g.snap.last_go)).toBe(true);
  });
});
