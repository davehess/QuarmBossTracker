// test/dps-active-time.test.js — each meter row's Sec and DPS are that combatant's own active time.
//
// The guild lead, 2026-10-14: "dps METER counts the same amount of time for everyone versus just when
// the person engaged. That makes the DPS calculation incorrect." A 35 s fight showed SEC 35 on every
// row, a pet's and a player who did 122 damage included, and DPS = damage / 35 for all of them.
// Now a row's seconds run from its first damage to its last (EQLogParser's way, 1 s at least) and the
// total row keeps the fight's seconds.
//
// The real agent builds the rows from log lines; the overlay's own row-time functions run as slices.
// Names are invented.
//
// Run: npx vitest run test/dps-active-time.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));

const { pnum, pnumK, _rowSecs, _rowTiming, _foldPetsIntoOwners, _histRows, _rsLine, _liveRsRows } = evalBlock(
  sliceBlock(overlay, '  function pnum(n){', 'return String(n); }') + '\n'
  + sliceBlock(overlay, '  function pnumK(n){', "return (n/1e3).toFixed(2)+'K'; }") + '\n'
  + sliceBlock(overlay, '  function _rowSecs(row, fightSecs) {', '  // One mini row: rank, name') + '\n'
  + sliceBlock(overlay, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['pnum', 'pnumK', '_rowSecs', '_rowTiming', '_foldPetsIntoOwners', '_histRows', '_rsLine', '_liveRsRows'],
);

const MOB = 'a Diaku Oracle';
const FIGHT_SECS = 35;
const builder = (character) => new agent.EncounterBuilder({ character, onFlush: () => {} });
// One log line `sec` seconds into the fight (all inside one minute, so the clock is plain).
function hit(b, sec, who, amount) {
  const full = `[Tue Sep 29 07:10:${String(sec).padStart(2, '0')} 2026] ${who} slashes ${MOB} for ${amount} points of damage.`;
  const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
  if (!ev) throw new Error('unparsed test line: ' + full);
  b.add(ev);
}
// Corvale swings every 5 s from 0 to 35 (800 damage, the whole fight); Nyssara only at 30 and 35
// (122 damage); Kebantik, a summoned pet nobody owns, at 10 and 20 (200 damage).
function fight() {
  const b = builder('Brackwyn');
  for (let s = 0; s <= 35; s += 5) hit(b, s, 'Corvale', 100);
  hit(b, 30, 'Nyssara', 61); hit(b, 35, 'Nyssara', 61);
  hit(b, 10, 'Kebantik', 100); hit(b, 20, 'Kebantik', 100);
  b._publishLiveThreat();
  const et = agent._liveThreatForTest();
  agent._recordFightHistory({ ...et, flushedAt: Date.now() }, 'Brackwyn');
  return { et, entry: agent._fightHistoryForTest()[0] };
}
const timing = (rows, name, secs = FIGHT_SECS) => {
  const row = rows.find(r => r[0] === name);
  if (!row) throw new Error('no row for ' + name);
  return _rowTiming(row, secs, false);
};

beforeEach(() => {
  agent._resetFightHistoryForTest();
  agent._charmTickTracker.clear();
  agent._applyPetOwnersResponse({ owners: {} });
  agent._setUploadOptsForTest(null);
});

describe('each row is timed by its own first and last damage', () => {
  it('live: the full-fight player 35 s, the late joiner 5 s, the pet 10 s', () => {
    const { et } = fight();
    const rows = _liveRsRows(et.perPlayer, et.spans);
    expect(timing(rows, 'Corvale')).toEqual({ secs: 35, dps: 23 });      // 800 / 35
    expect(timing(rows, 'Nyssara')).toEqual({ secs: 5, dps: 24 });       // 122 / 5, not 122 / 35 = 3
    expect(timing(rows, 'Kebantik')).toEqual({ secs: 10, dps: 20 });     // 200 / 10
  });

  it('History: the same seconds from the saved entry', () => {
    const { entry } = fight();
    const rows = _histRows(entry);
    expect(timing(rows, 'Corvale').secs).toBe(35);
    expect(timing(rows, 'Nyssara')).toEqual({ secs: 5, dps: 24 });
    expect(timing(rows, 'Kebantik').secs).toBe(10);
  });

  it('a single hit is one second, never zero', () => {
    const b = builder('Brackwyn');
    hit(b, 0, 'Corvale', 100); hit(b, 35, 'Corvale', 100); hit(b, 12, 'Zarrin', 90);
    b._publishLiveThreat();
    const et = agent._liveThreatForTest();
    expect(timing(_liveRsRows(et.perPlayer, et.spans), 'Zarrin')).toEqual({ secs: 1, dps: 90 });
  });

  it('an owner and the pet it brought are timed from the first swing of either to the last of either', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const { et } = fight();
    // Nyssara 30-35, her pet 10-20: first swing 10, last 35 = 25 s, over her 122 + the pet's 200.
    const rows = _liveRsRows(et.perPlayer, et.spans);                    // already folded
    expect(timing(rows, 'Nyssara')).toEqual({ secs: 25, dps: 13 });     // 322 / 25
  });

  it('the Tank tab keeps the fight\'s seconds', () => {
    const { et } = fight();
    const row = _liveRsRows(et.perPlayer, et.spans).find(r => r[0] === 'Nyssara');
    expect(_rowTiming(row, FIGHT_SECS, true).secs).toBe(FIGHT_SECS);
  });
});

describe('the total row and older data keep the fight\'s seconds', () => {
  it('the copied /rs line: header 35 s for the raid, each raider\'s own "in Ns"', () => {
    const { et } = fight();
    const rows = _liveRsRows(et.perPlayer, et.spans);
    const total = rows.reduce((s, r) => s + r[1], 0);
    const line = _rsLine(MOB, FIGHT_SECS, total, rows);
    expect(line).toContain('in 35s, 1.12K Damage @32,');                 // 1122 / 35: the raid's, over the fight
    expect(line).toContain('1. Corvale = 800@23 in 35s');
    expect(line).toContain('2. Nyssara = 122@24 in 5s');
  });

  it('a fight saved before spans existed reads the fight\'s seconds on every row', () => {
    const { entry } = fight();
    const legacy = { ...entry, local: entry.local.map(({ first_ms, last_ms, ...rest }) => rest) };
    const rows = _histRows(legacy);
    for (const name of ['Corvale', 'Nyssara', 'Kebantik']) expect(timing(rows, name).secs).toBe(FIGHT_SECS);
    expect(timing(rows, 'Nyssara').dps).toBe(3);                         // 122 / 35, as it always read
  });

  it('a live snapshot with no spans (an older agent) reads the fight\'s seconds too', () => {
    const { et } = fight();
    expect(timing(_liveRsRows(et.perPlayer, undefined), 'Nyssara').secs).toBe(FIGHT_SECS);
  });

  it('a span can never read longer than the fight', () => {
    expect(_rowSecs([ 'X', 10, 0, null, 0, 0, false, undefined, false, null, undefined, 1000, 1000 + 90_000 ], 35)).toBe(35);
  });
});

describe('the guild\'s numbers over this machine\'s spans', () => {
  it('settled: a player this machine saw most of keeps their own seconds', () => {
    const { entry } = fight();
    const guild = [{ character: 'Corvale', dmg: 800 }, { character: 'Nyssara', dmg: 122 }];
    const rows = _histRows({ ...entry, players: guild, settled: true });
    expect(timing(rows, 'Nyssara').secs).toBe(5);
  });

  it('settled: a player this machine saw only part of falls back to the fight (a shorter span would inflate DPS)', () => {
    const { entry } = fight();
    const guild = [{ character: 'Corvale', dmg: 800 }, { character: 'Nyssara', dmg: 1220 }];   // we saw 122 of it
    const rows = _histRows({ ...entry, players: guild, settled: true });
    expect(timing(rows, 'Nyssara')).toEqual({ secs: 35, dps: 35 });
  });
});

describe('and the board is wired through it', () => {
  const clean = stripJs(overlay);
  it('the DPS rows and the mini rows time themselves with _rowTiming', () => {
    expect(clean).toMatch(/var rt = _rowTiming\(row, secs, TAB_MODE === 'tank'\);/);
    expect(clean).toMatch(/var rt = _rowTiming\(row, secs, tank\);/);
  });
  it('the live board and the live copy hand the snapshot\'s spans to the rows', () => {
    expect(clean).toMatch(/_liveRsRows\(et\.perPlayer, et\.spans\)/);
    expect(clean).toMatch(/\(\(et && et\.spans\) \|\| \{\}\)\[name\]/);
  });
  it('the total row still prints the fight\'s seconds', () => {
    expect(clean).toMatch(/var totalDps = secs > 0 \? Math\.round\(totalDmg \/ secs\) : 0;/);
  });
});

describe('the agent keeps the span off the threat upload', () => {
  it('spans ride beside perPlayer, so the stored threat snapshots do not grow', () => {
    const { et } = fight();
    expect(et.spans.Nyssara).toHaveLength(2);
    expect(JSON.stringify(et.perPlayer)).not.toMatch(/firstMs|lastMs|first_ms|last_ms/);
  });
});
