// test/meter-history.test.js — the DPS/Tank meter's History, end to end (the guild lead, 2026-10-04).
//
// "damage/tanking meter could have more history in it. Make sure the history correctly attributes pet
// data to owners and DS hits from tanks."
//
// Six things were wrong, and one thing was missing:
//   1. a History row was swing+proc+spell — THREAT, not damage (a tank who dealt 100 read 1,961);
//   2. a raider who zoned mid-fight dropped off it (zoning zeroes threat, never damage);
//   3. History never folded a pet into its owner, and once the guild's numbers came back the pet was
//      counted TWICE (the bot already rolls it into the owner): 1009 on a 909 fight;
//   4. an unowned pet read as a raider and was pasted to /rs as one;
//   5. a charm that broke before the kill took the pet's damage with it;
//   6. a silent (backfill) flush recorded the LIVE fight into History and stamped it ended;
//   + "more history": 100 fights, in a file of their own that outlives a restart, off the /api/state poll.
//
// The agent runs for real (a real EncounterBuilder, the real _recordFightHistory, the real endpoints);
// the overlay's fold + History merge, its live-row mapping and its fetch run as slices. Names are invented.
//
// Run: npx vitest run test/meter-history.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT, AGENT_INDEX, BOT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const agentSrc = readSource(AGENT_INDEX);
const upTo = (src, start, next) => { const b = sliceBlock(src, start, next); return b.slice(0, b.length - next.length); };

// The overlay's real code: the fold, the History merge, the live board's row mapping, the /rs filter.
const { _foldPetsIntoOwners, _histRows, _rsRaiders } = evalBlock(
  sliceBlock(overlay, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['_foldPetsIntoOwners', '_histRows', '_rsRaiders'],
);
const liveRows = new Function('pp', '_foldPetsIntoOwners',
  "var allRows = []; const TAB_MODE = 'dps'; const field = 'dmg';\n"
  + upTo(overlay, 'allRows = Object.entries(pp)', 'allRows = _foldPetsIntoOwners(allRows);')
  + '\nallRows = _foldPetsIntoOwners(allRows);\nreturn allRows;');
const histRsRows = _rsRaiders;                       // the raiders the /rs line lists (History and live alike)

const MOB = 'a Shissar acolyte';
const CP = 'a fungoid sporeling';
const total = (rows) => rows.reduce((s, r) => s + r[1], 0);
const names = (rows) => rows.map(r => r[0]);
const rowOf = (rows, n) => rows.find(r => r[0] === n);

// One log line at a time into a builder, a second apart (a 07:5x minute per feeder keeps fights apart).
let _min = 0;
function feeder(b) {
  const minute = String(10 + (_min++ % 50)).padStart(2, '0');
  let sec = 0;
  return (line) => {
    const full = `[Tue Sep 29 07:${minute}:${String(sec++ % 60).padStart(2, '0')} 2026] ${line}`;
    const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
    if (!ev) throw new Error('unparsed test line: ' + line);
    b.add(ev);
  };
}
const builder = (character, extra = {}) => new agent.EncounterBuilder({ character, onFlush: () => {}, ...extra });
// The snapshot the agent publishes, recorded the way flush() records it.
function record(b, character) {
  b._publishLiveThreat();
  const et = agent._liveThreatForTest();
  agent._recordFightHistory({ ...et, flushedAt: Date.now() }, character);
  return { et, entry: agent._fightHistoryForTest()[0] };
}
// What the bot's /live-damage hands back for ONE uploader (index.js _handleAgentLiveDamage rolls a pet
// into its owner: `who = pet_owner || name`). Asserted against the bot's source below.
const botRollup = (perPlayer) => {
  const per = new Map();
  for (const [name, v] of Object.entries(perPlayer)) {
    const d = Number(v.dmg) || 0; if (d <= 0) continue;
    const who = v.pet_owner ? String(v.pet_owner) : name;
    per.set(who, (per.get(who) || 0) + d);
  }
  return [...per.entries()].map(([character, dmg]) => ({ character, dmg })).sort((a, b) => b.dmg - a.dmg);
};

beforeEach(() => {
  agent._resetFightHistoryForTest();
  agent._charmTickTracker.clear();
  agent._applyPetOwnersResponse({ owners: {} });
  agent._setUploadOptsForTest(null);
});

// ── 1 + 2. History is damage ────────────────────────────────────────────────
describe('History is the damage dealt, not the threat built', () => {
  it('a tank who taunted and was resisted three times reads 100, not 1,961 (and does not top the board)', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Aldenmar slashes ${MOB} for 1000 points of damage.`);
    feed(`You slash ${MOB} for 100 points of damage.`);
    feed(`You have taunted ${MOB}.`);
    for (let i = 0; i < 3; i++) feed('Your target resisted the Holy Might spell.');
    const { et, entry } = record(b, 'Brackwyn');
    const t = et.perPlayer.Brackwyn;
    expect(t.dmg).toBe(100);
    expect(t.swing + t.proc + t.spell, 'the fixture really is threat-heavy').toBeGreaterThan(1000);
    expect(entry.local.map(p => [p.character, p.dmg])).toEqual([['Aldenmar', 1000], ['Brackwyn', 100]]);
  });

  it('a raider who zoned mid-fight keeps their damage (zoning zeroes threat, never damage)', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`You slash ${MOB} for 5000 points of damage.`);
    feed(`Aldenmar slashes ${MOB} for 3000 points of damage.`);
    b._threatLine('[Tue Sep 29 07:50:09 2026] LOADING, PLEASE WAIT...');
    const { et, entry } = record(b, 'Brackwyn');
    expect(et.perPlayer.Brackwyn.swing, 'zoning really did zero the threat').toBe(0);
    expect(entry.local.map(p => [p.character, p.dmg])).toEqual([['Brackwyn', 5000], ['Aldenmar', 3000]]);
  });

  // The Me HUD's "tonight" and Target Info's corpse list read the same figure (they were fed threat too).
  function tauntHeavyFight() {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Aldenmar slashes ${MOB} for 1000 points of damage.`);
    feed(`You slash ${MOB} for 100 points of damage.`);
    feed(`You have taunted ${MOB}.`);
    for (let i = 0; i < 3; i++) feed('Your target resisted the Holy Might spell.');
    return record(b, 'Brackwyn');
  }

  it('the Me HUD\'s "tonight" adds what a History entry dealt (a pet counting for its owner), not its threat', () => {
    // _meNoteFight reads entry.local[].dmg; sliced out of the agent, fed an entry the real agent recorded.
    const { _meNoteFight, _meNight } = evalBlock(
      sliceBlock(agentSrc, 'const _meNight = { key: null', '\n}\n') + sliceBlock(agentSrc, 'function _meNoteFight(entry) {', '\n}\n'),
      ['_meNoteFight', '_meNight']);
    const { entry } = tauntHeavyFight();
    _meNoteFight(entry);
    expect(_meNight.byChar.get('brackwyn')).toMatchObject({ dmg: 100, fights: 1 });         // it was 1,961
    expect(_meNight.byChar.get('aldenmar')).toMatchObject({ dmg: 1000, fights: 1 });
  });

  it('Target Info\'s corpse list ranks the same raw damage', () => {
    tauntHeavyFight();
    const pp = agent._liveThreatForTest().perPlayer;
    const mob = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
    const corpse = new Function('pp', 'var names = Object.keys(pp);\n' + sliceBlock(mob, 'var rows = names', '.slice(0, 5);') + '\nreturn rows;');
    expect(corpse(pp).map(r => [r.n, r.dmg])).toEqual([['Aldenmar', 1000], ['Brackwyn', 100]]);
  });
});

// ── DS from tanks ───────────────────────────────────────────────────────────
describe('a damage shield is credited to the tank who wears it — in the live board and in History', () => {
  it('one wearer, flavor line: 500 of swings + 9 of thorns on the tank, 210 taken kept for later', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);         // first, so the log knows the mob is one
    feed(`${MOB} hits Corvale for 210 points of damage.`);
    feed(`${MOB} was hit by non-melee for 9 points of damage.`);
    feed(`${MOB} was pierced by thorns.`);
    const { et, entry } = record(b, 'Brackwyn');
    expect(et.perPlayer.Corvale.dmg).toBe(509);
    expect(entry.local).toEqual([{ character: 'Corvale', dmg: 509, pet_owner: null, took: 210, tookMax: 210 }]);
    expect(rowOf(_histRows(entry), 'Corvale')[1]).toBe(509);
  });

  it('the uploader wearing it: first-person thorns land on the uploader', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`${MOB} hits YOU for 210 points of damage.`);
    feed(`${MOB} was hit by non-melee for 9 points of damage.`);
    feed(`${MOB} was pierced by thorns.`);
    feed(`You slash ${MOB} for 100 points of damage.`);
    const { entry } = record(b, 'Brackwyn');
    expect(entry.local.map(p => [p.character, p.dmg])).toEqual([['Brackwyn', 109]]);
  });
});

// ── 3 + 4. Pets in History ──────────────────────────────────────────────────
describe('History folds a pet into its owner, as the live board does', () => {
  // Nyssara 300, her pet Kebantik 100 (the guild pool names the owner), Corvale 500 (+9 of shield).
  function fightWithOwnedPet() {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Nyssara slashes ${MOB} for 300 points of damage.`);
    feed(`Kebantik hits ${MOB} for 100 points of damage.`);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`${MOB} hits Corvale for 210 points of damage.`);
    feed(`${MOB} was hit by non-melee for 9 points of damage.`);
    feed(`${MOB} was pierced by thorns.`);
    return record(b, 'Brackwyn');
  }

  it('unsettled: "Nyssara 400 +pet", the same as the live board, summing to the true 909', () => {
    const { et, entry } = fightWithOwnedPet();
    const live = liveRows(et.perPlayer, _foldPetsIntoOwners);
    const hist = _histRows(entry);
    expect(live.map(r => [r[0], r[1], r[8]])).toEqual([['Corvale', 509, false], ['Nyssara', 400, true]]);
    expect(hist.map(r => [r[0], r[1], r[8]])).toEqual([['Corvale', 509, false], ['Nyssara', 400, true]]);
    expect(names(hist)).not.toContain('Kebantik');
    expect(total(hist)).toBe(909);
  });

  it('settled: the bot already folded the pet, so the rows still sum to 909 (they summed to 1009)', () => {
    const { et, entry } = fightWithOwnedPet();
    const guild = botRollup(et.perPlayer);
    expect(guild.map(p => p.character), 'the bot has no pet row of its own').toEqual(['Corvale', 'Nyssara']);
    const hist = _histRows({ ...entry, players: guild, uploaders: 3, settled: true });
    expect(hist.map(r => [r[0], r[1]])).toEqual([['Corvale', 509], ['Nyssara', 400]]);
    expect(total(hist)).toBe(909);
    expect(rowOf(hist, 'Nyssara')[8], '+pet is still shown beside the owner').toBe(true);
    expect(rowOf(hist, 'Nyssara')[10]).toEqual([{ name: 'Kebantik', v: 100, id: null }]);
  });

  it('settled, when another client missed the owner and the bot left the pet as a raider: still not counted twice', () => {
    const { entry } = fightWithOwnedPet();
    const guild = [{ character: 'Corvale', dmg: 509 }, { character: 'Nyssara', dmg: 400 }, { character: 'Kebantik', dmg: 100 }];
    const hist = _histRows({ ...entry, players: guild, uploaders: 4, settled: true });
    expect(names(hist)).toEqual(['Corvale', 'Nyssara']);
    expect(total(hist)).toBe(909);
  });

  it('a pet whose owner never swung still lands on the owner (the charmer case)', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Kebantik hits ${MOB} for 100 points of damage.`);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    const { entry } = record(b, 'Brackwyn');
    expect(_histRows(entry).map(r => [r[0], r[1], r[8]])).toEqual([['Corvale', 500, false], ['Nyssara', 100, true]]);
    // …and once settled, the owner is the guild's row whether or not the guild listed them
    const settled = _histRows({ ...entry, players: [{ character: 'Corvale', dmg: 500 }, { character: 'Kebantik', dmg: 100 }], settled: true });
    expect(settled.map(r => [r[0], r[1]])).toEqual([['Corvale', 500], ['Nyssara', 100]]);
  });
});

describe('an unowned pet keeps its label and stays off the /rs line', () => {
  function fightWithUnownedPets() {
    const b = builder('Brackwyn'); const feed = feeder(b);
    // Gobeker: the server's pet-name generator, nobody has named an owner. The sporeling: a charmed mob
    // with a live charm proof elsewhere in the table but none for the owner.
    agent._charmTickTracker.set(CP, { pet: CP, owner: null, is_active: true, last_tick_at: Date.now(), last_event: 'land', started_at: Date.now() });
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`Kebantik hits ${MOB} for 100 points of damage.`);
    return record(b, 'Brackwyn');
  }

  it('a summoned pet nobody has named is "(pet)", unsettled and settled', () => {
    const { et, entry } = fightWithUnownedPets();
    expect(et.perPlayer.Kebantik.pet_summoned).toBe(true);
    const unsettled = _histRows(entry);
    expect(rowOf(unsettled, 'Kebantik')[6]).toBe('pet');
    const settled = _histRows({ ...entry, players: botRollup(et.perPlayer), settled: true });
    expect(rowOf(settled, 'Kebantik')[6], 'the guild row picks the label up from this machine\'s view').toBe('pet');
    expect(total(settled)).toBe(600);
  });

  it('a charmed mob with no proven owner is "(charmed)"', () => {
    const entry = { boss: MOB, local: [{ character: 'Corvale', dmg: 500, pet_owner: null }, { character: CP, dmg: 90, pet_owner: null, pet_charm: true }] };
    expect(rowOf(_histRows(entry), CP)[6]).toBe(true);
    expect(rowOf(_histRows(entry), CP)[3]).toBeNull();
  });

  it('the /rs line lists raiders only — no pet, no charmed mob, no owner-less raider you cannot name', () => {
    const entry = { boss: MOB, durationSec: 60, local: [
      { character: 'Corvale', dmg: 500, pet_owner: null },
      { character: 'Kebantik', dmg: 100, pet_owner: null, pet_summoned: true },
      { character: CP, dmg: 90, pet_owner: null, pet_charm: true },
      { character: 'Gobeker', dmg: 80, pet_owner: 'Nyssara' },
    ] };
    const rows = _histRows(entry);
    expect(names(rows).sort()).toEqual(['Corvale', 'Kebantik', 'Nyssara', CP]);        // all on the board…
    expect(names(histRsRows(rows)).sort()).toEqual(['Corvale', 'Nyssara']);             // …two of them on the /rs line
  });
});

// ── 5. A charm that breaks before the kill ──────────────────────────────────
describe('a charm that breaks before the kill still counts for its owner', () => {
  const charmUp = () => agent._charmTickTracker.set(CP, { pet: CP, owner: 'Nyssara', is_active: true, last_tick_at: Date.now(), last_event: 'land', started_at: Date.now() });
  const charmBreaks = () => agent._charmTickTracker.set(CP, { ...agent._charmTickTracker.get(CP), is_active: false, last_event: 'break', broke_at: Date.now() });

  function fightCharmBreak() {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Aldenmar slashes ${CP} for 200 points of damage.`);        // before the charm it is a mob we hit
    charmUp();
    feed(`${CP} hits ${MOB} for 150 points of damage.`);
    feed(`Aldenmar slashes ${MOB} for 400 points of damage.`);
    charmBreaks();
    feed(`Aldenmar slashes ${MOB} for 100 points of damage.`);
    return { b, ...record(b, 'Brackwyn') };
  }

  it('live: the pet\'s 150 is still on the board, under Nyssara (+pet)', () => {
    const { et } = fightCharmBreak();
    expect(et.perPlayer[CP]).toMatchObject({ dmg: 150, pet_owner: 'Nyssara' });
    expect(liveRows(et.perPlayer, _foldPetsIntoOwners).map(r => [r[0], r[1], r[8]])).toEqual([['Aldenmar', 700, false], ['Nyssara', 150, true]]);
  });

  it('History: the same, folded', () => {
    const { entry } = fightCharmBreak();
    expect(_histRows(entry).map(r => [r[0], r[1], r[8]])).toEqual([['Aldenmar', 700, false], ['Nyssara', 150, true]]);
  });

  it('a charm that broke in ANOTHER fight claims nothing here', () => {
    // _charmTickTracker is module-wide and a broken entry lingers; the pet must appear in THIS fight.
    agent._charmTickTracker.set(CP, { pet: CP, owner: 'Nyssara', is_active: false, last_event: 'break', broke_at: Date.now() });
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Aldenmar slashes ${MOB} for 400 points of damage.`);
    b._publishLiveThreat();
    expect(Object.keys(agent._liveThreatForTest().perPlayer)).toEqual(['Aldenmar']);
  });

  it('is asked once, not on every event (the fight walks every event to answer)', () => {
    charmUp();
    const b = builder('Brackwyn');
    const spy = vi.spyOn(b, '_provenPets');
    const feed = feeder(b);
    for (let i = 0; i < 40; i++) feed(`Aldenmar slashes ${MOB} for ${100 + i} points of damage.`);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ── 6. A silent flush ───────────────────────────────────────────────────────
describe('a silent (backfill) flush leaves the live fight alone', () => {
  const fill = (b, who, mob, n) => { const feed = feeder(b); for (let i = 0; i < n; i++) feed(`${who} slashes ${mob} for ${50 + i} points of damage.`); };

  it('records nothing into History and does not end the fight on screen', () => {
    const live = builder('Brackwyn'); fill(live, 'Aldenmar', 'a Kromrif guard', 4);
    live._publishLiveThreat();
    expect(agent._liveThreatForTest().flushedAt).toBeNull();
    const replay = builder('Brackwyn', { silent: true }); fill(replay, 'Corvale', 'a gnoll pup', 12);
    replay.flush();
    expect(agent._liveThreatForTest().flushedAt, 'the live fight is still live').toBeNull();
    expect(agent._liveThreatForTest().targetName).toBe('a Kromrif guard');
    expect(agent._fightHistoryForTest()).toEqual([]);
  });

  it('a live flush records THIS builder\'s own view, not whichever builder published last', () => {
    const a = builder('Brackwyn'); fill(a, 'Aldenmar', 'a Kromrif warrior', 12);
    const other = builder('Corvale'); fill(other, 'Rethlan', 'a Kromrif warrior', 3);      // published AFTER a
    expect(agent._liveThreatForTest().uploader).toBe('Corvale');
    a.flush();
    const h = agent._fightHistoryForTest();
    expect(h).toHaveLength(1);
    expect(h[0].local.map(p => p.character)).toEqual(['Aldenmar']);
  });
});

// ── More history: 100 fights, on disk, off the poll ─────────────────────────
describe('History lives in its own file and survives a restart', () => {
  let dir, file;
  const NOW = 1_790_000_000_000;
  const entry = (boss, endedMs, extra) => ({ boss, startedMs: endedMs - 60_000, endedMs, durationSec: 60,
    local: [{ character: 'Corvale', dmg: 500, pet_owner: null }], players: [], uploaders: 0, settled: false, upload: 'sent', ...extra });
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fights-')); file = path.join(dir, 'logsync.fights.json'); });
  afterEach(() => { vi.useRealTimers(); agent._fightHistoryPersistForTest(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('a fight survives a restart hours later (the session file would have expired after 10 minutes)', () => {
    agent._recordFightHistory({ bossName: 'Aten Ha Ra', targetName: 'Aten Ha Ra', startedAt: new Date(Date.now() - 60_000).toISOString(), flushedAt: Date.now(),
      perPlayer: { Corvale: { dmg: 500, took: 90 }, Kebantik: { dmg: 100, pet_owner: 'Nyssara' } } }, 'x');
    agent._fightHistoryForTest()[0].settled = true;
    agent._saveFightHistory(file);
    expect(fs.existsSync(file + '.tmp'), 'written atomically: no .tmp left behind').toBe(false);
    agent._resetFightHistoryForTest();                                         // "restart"
    agent._loadFightHistory(file, Date.now() + 3 * 3600_000);                  // three hours later
    const h = agent._fightHistoryForTest();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ boss: 'Aten Ha Ra', settled: true });
    expect(h[0].local.map(p => p.character)).toEqual(['Corvale', 'Kebantik']);
    expect(h[0].local[0].took).toBe(90);
    expect(fs.existsSync(file), 'loading must NOT consume the file (the session snapshot is deleted on read)').toBe(true);
  });

  it('drops entries older than 7 days, keeps the rest', () => {
    fs.writeFileSync(file, JSON.stringify({ savedAt: NOW, fights: [
      entry('Six days', NOW - 6 * 86400_000), entry('Eight days', NOW - 8 * 86400_000), entry('Just now', NOW - 1000),
    ] }));
    agent._loadFightHistory(file, NOW);
    expect(agent._fightHistoryForTest().map(h => h.boss)).toEqual(['Six days', 'Just now']);
    expect(agent.FIGHT_HISTORY_KEEP_MS).toBe(7 * 86400_000);
  });

  it('keeps at most 100 — the newest — however many the file holds', () => {
    const many = Array.from({ length: 150 }, (_, i) => entry('Mob ' + (150 - i), NOW - i * 60_000));   // newest first
    fs.writeFileSync(file, JSON.stringify({ savedAt: NOW, fights: many }));
    agent._loadFightHistory(file, NOW);
    const h = agent._fightHistoryForTest();
    expect(agent.FIGHT_HISTORY_MAX).toBe(100);
    expect(h).toHaveLength(100);
    expect(h[0].boss).toBe('Mob 150');
    expect(h[99].boss).toBe('Mob 51');
  });

  it('a missing or corrupt file starts the ring empty and never throws', () => {
    agent._loadFightHistory(path.join(dir, 'nope.json'));
    fs.writeFileSync(file, '{ not json');
    agent._loadFightHistory(file);
    expect(agent._fightHistoryForTest()).toEqual([]);
  });

  it('with persistence armed, recording a fight writes the file after the debounce (not before)', () => {
    vi.useFakeTimers();
    agent._fightHistoryPersistForTest(file);
    agent._recordFightHistory({ bossName: 'Aten Ha Ra', targetName: 'Aten Ha Ra', startedAt: new Date(Date.now() - 60_000).toISOString(), flushedAt: Date.now(),
      perPlayer: { Corvale: { dmg: 500 } } }, 'x');
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(5_100);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).fights.map(h => h.boss)).toEqual(['Aten Ha Ra']);
  });

  it('a bare require never touches the disk: nothing is written unless main() armed it', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(fs, 'writeFileSync');
    agent._recordFightHistory({ bossName: 'Aten Ha Ra', targetName: 'Aten Ha Ra', startedAt: new Date(Date.now() - 60_000).toISOString(), flushedAt: Date.now(),
      perPlayer: { Corvale: { dmg: 500 } } }, 'x');
    vi.advanceTimersByTime(10_000);
    expect(spy.mock.calls.filter(c => String(c[0]).includes('logsync.fights'))).toEqual([]);
    spy.mockRestore();
  });

  it('the session file keeps its 10-minute life and no longer carries the ring', () => {
    const code = stripJs(agentSrc);
    expect(code).toMatch(/const SESSION_TTL_MS = 10 \* 60 \* 1000;/);
    const save = stripJs(sliceBlock(agentSrc, 'function saveSessionState() {', '\n}\n'));
    expect(save).not.toMatch(/fightHistory/);
    expect(save).toMatch(/if \(_fightsPersist\) _saveFightHistory\(\);/);          // a graceful exit writes the ring too
    expect(code).toMatch(/_startFightHistoryPersistence\(\);\s*const _sessionRestored = loadSessionState\(\);|_startFightHistoryPersistence\(\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const _sessionRestored = loadSessionState\(\);/);
  });
});

describe('the guild\'s numbers for a fight, asked for again after a restart only while the bot can answer', () => {
  const BOT = 'https://bot.example/api/agent/encounter';
  const T0 = 1_790_000_000_000;
  let calls;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ players: [{ character: 'Aldenmar', dmg: 123 }], uploaders: 4, total: 123 }) }; }));
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: false });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });
  const ring = (...e) => { agent._fightHistoryForTest().push(...e); };
  const entry = (boss, agoMs, extra) => ({ boss, startedMs: T0 - agoMs - 60_000, endedMs: T0 - agoMs, durationSec: 60,
    local: [{ character: 'Corvale', dmg: 500, pet_owner: null }], players: [], uploaders: 0, settled: false, upload: 'sent', ...extra });

  it('a fight recorded now is asked about at +40 s and again at +100 s, and the guild rows land on the entry', async () => {
    agent._recordFightHistory({ bossName: 'Aten Ha Ra', targetName: 'Aten Ha Ra', startedAt: new Date(T0 - 60_000).toISOString(), flushedAt: T0,
      perPlayer: { Corvale: { dmg: 500 } } }, 'x');
    await vi.advanceTimersByTimeAsync(39_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/agent/live-damage?boss=Aten%20Ha%20Ra&fight_start=');
    expect(agent._fightHistoryForTest()[0]).toMatchObject({ settled: true, uploaders: 4, players: [{ character: 'Aldenmar', dmg: 123 }] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });

  it('a restored fight still inside the window is asked about for what is left of the two passes', async () => {
    ring(entry('Young', 50_000), entry('Middle', 150_000));
    agent._resettleRestoredFights(T0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);                     // Middle: both passes past → one ask, at +5 s
    expect(calls.map(c => decodeURIComponent(c.match(/boss=([^&]+)/)[1]))).toEqual(['Middle']);
    await vi.advanceTimersByTimeAsync(45_000);                    // Young: 100 s − 50 s
    expect(calls.map(c => decodeURIComponent(c.match(/boss=([^&]+)/)[1]))).toEqual(['Middle', 'Young']);
    expect(agent._fightHistoryForTest().every(h => h.settled && h.players.length === 1)).toBe(true);
  });

  it('a restored fight past the window — or already settled — is never asked about; the old one is settled as it stands', async () => {
    ring(entry('Old', 10 * 60_000), entry('Done', 30_000, { settled: true, players: [{ character: 'Brackwyn', dmg: 9 }], uploaders: 2 }));
    agent._resettleRestoredFights(T0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toHaveLength(0);
    const [old, done] = agent._fightHistoryForTest();
    expect(old).toMatchObject({ settled: true, players: [], uploaders: 0 });             // this machine's view, no longer "settling…"
    expect(done.players).toEqual([{ character: 'Brackwyn', dmg: 9 }]);                  // untouched
  });

  it('with no token there is nobody to ask: even a young unsettled fight is settled as it stands', async () => {
    agent._setUploadOptsForTest(null);
    ring(entry('Young', 50_000));
    agent._resettleRestoredFights(T0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toHaveLength(0);
    expect(agent._fightHistoryForTest()[0].settled).toBe(true);
  });

  it('a late EMPTY answer never erases numbers the entry already has', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ players: [], uploaders: 0, total: 0 }) })));
    ring(entry('Young', 50_000, { settled: true, players: [{ character: 'Brackwyn', dmg: 9 }], uploaders: 2 }));
    agent._recordFightHistory({ bossName: 'Fresh', targetName: 'Fresh', startedAt: new Date(T0 - 60_000).toISOString(), flushedAt: T0, perPlayer: { Corvale: { dmg: 5 } } }, 'x');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(agent._fightHistoryForTest().find(h => h.boss === 'Young').players).toEqual([{ character: 'Brackwyn', dmg: 9 }]);
    expect(agent._fightHistoryForTest().find(h => h.boss === 'Fresh').settled).toBe(false);
  });
});

describe('the ring is off the /api/state poll and on its own endpoint', () => {
  let server, port;
  const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(d) }));
  }).on('error', rej));
  beforeAll(async () => {
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    port = server.address().port;
  });
  afterAll(() => new Promise(r => server.close(r)));

  const record1 = (boss) => agent._recordFightHistory({ bossName: boss, targetName: boss, startedAt: new Date(Date.now() - 60_000).toISOString(),
    flushedAt: Date.now(), perPlayer: { Corvale: { dmg: 500 } } }, 'x');

  it('/api/state no longer carries the ring: a digest of the newest ten, no player rows', async () => {
    for (let i = 1; i <= 12; i++) record1('Mob ' + i);
    agent._fightHistoryForTest()[0].players = [{ character: 'Corvale', dmg: 500 }];       // a settled one: its rows stay out of the poll
    agent._fightHistoryForTest()[0].total = 500;
    const { status, body } = await get('/api/state');
    expect(status).toBe(200);
    expect(body._serializeError, 'the state really serialised — not the last-good stub').toBeUndefined();
    expect(body.version).toBeTruthy();
    expect(body.fightHistory).toHaveLength(10);
    expect(body.fightHistory[0]).toMatchObject({ boss: 'Mob 12', total: 500, settled: false });
    const digestKeys = new Set(['boss', 'endedMs', 'durationSec', 'total', 'settled']);
    for (const f of body.fightHistory) expect(Object.keys(f).every(k => digestKeys.has(k)), Object.keys(f).join()).toBe(true);
    expect((await get('/api/fight-history')).body.fights).toHaveLength(12);              // the ring is whole at its own endpoint
  });

  it('/api/fight-history serves the fights newest first, with the cap', async () => {
    record1('First'); record1('Second');
    const { status, body } = await get('/api/fight-history');
    expect(status).toBe(200);
    expect(body.max).toBe(100);
    expect(body.fights.map(f => f.boss).slice(0, 2)).toEqual(['Second', 'First']);
    expect(typeof body.rev).toBe('string');
  });

  it('asking again with the revision it was given answers in a few bytes; a new fight changes the revision', async () => {
    record1('Aten Ha Ra');
    const first = (await get('/api/fight-history')).body;
    const same = (await get('/api/fight-history?rev=' + encodeURIComponent(first.rev))).body;
    expect(same).toEqual({ rev: first.rev, unchanged: true });
    record1('Another Mob');
    const next = (await get('/api/fight-history?rev=' + encodeURIComponent(first.rev))).body;
    expect(next.rev).not.toBe(first.rev);
    expect(next.fights.map(f => f.boss)).toContain('Another Mob');
  });

  it('a revision from before a restart can never match (it is seeded per process)', () => {
    expect(agent._fightHistoryPayload('some-old-process.7')).toHaveProperty('fights');
  });
});

describe('the overlay reads it only while History or Trend is open, and every consumer still has what it reads', () => {
  const src = stripJs(overlay);
  const ringBlock = upTo(overlay, '  var _histRing = { rev: null, fights: [] };', '\n  async function tick(){');
  function histFetcher(fetchImpl, PORT = 7777) {
    return new Function('PORT', 'fetch', ringBlock + '\nreturn { _histFights, ring: function(){ return _histRing; } };')(PORT, fetchImpl);
  }
  const json = (o, ok = true) => ({ ok, json: async () => o });

  it('the tick fetches the ring in one place, for the History tab and the Trend tab, and nowhere else', () => {
    // Trend (2026-10-06) draws from the same ring, so it shares this one read rather than asking again.
    expect(src).toMatch(/if \(TAB_MODE === 'history' \|\| _trendShown\) \{\s*HISTLIST = await _histFights\(s\);/);
    expect(src).toMatch(/var _trendShown = TAB_MODE === 'trend' && !document\.body\.classList\.contains\('wp-mini'\);/);
    expect(src.match(/_histFights\(/g)).toHaveLength(2);                       // the definition and that one call
    expect(src.match(/\/api\/fight-history/g)).toHaveLength(1);
    expect(src).toMatch(/var HISTLIST = \[\];/);                               // not read off the state any more
    expect(src).not.toMatch(/var HISTLIST = Array\.isArray\(s\.fightHistory\)/);
  });

  it('asks with the revision it last saw and keeps its ring when told nothing changed', async () => {
    const urls = [];
    const answers = [json({ rev: 'a.1', max: 100, fights: [{ boss: 'One' }] }), json({ rev: 'a.1', unchanged: true }), json({ rev: 'a.2', fights: [{ boss: 'Two' }, { boss: 'One' }] })];
    const h = histFetcher(async (u) => { urls.push(u); return answers.shift(); });
    expect((await h._histFights({})).map(f => f.boss)).toEqual(['One']);
    expect((await h._histFights({})).map(f => f.boss)).toEqual(['One']);
    expect((await h._histFights({})).map(f => f.boss)).toEqual(['Two', 'One']);
    expect(urls).toEqual([
      'http://127.0.0.1:7777/api/fight-history',
      'http://127.0.0.1:7777/api/fight-history?rev=a.1',
      'http://127.0.0.1:7777/api/fight-history?rev=a.1',
    ]);
  });

  it('an agent from before the route (404) still shows the ring it sends in the state', async () => {
    const four04 = histFetcher(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect((await four04._histFights({ fightHistory: [{ boss: 'Legacy' }] })).map(f => f.boss)).toEqual(['Legacy']);
  });

  it('any other failed read keeps the last ring it saw — it does not swap in the state\'s digest', async () => {
    let n = 0;
    const flaky = histFetcher(async () => {
      if (n++ === 0) return json({ rev: 'a.1', fights: [{ boss: 'One', local: [] }] });
      if (n === 2) return { ok: false, status: 500, json: async () => ({}) };
      throw new Error('agent restarting');
    });
    await flaky._histFights({});
    const digest = { fightHistory: [{ boss: 'Digest' }] };
    expect((await flaky._histFights(digest)).map(f => f.boss)).toEqual(['One']);          // 500
    expect((await flaky._histFights(digest)).map(f => f.boss)).toEqual(['One']);          // network error
  });

  it('only the History tab reads the ring: no other overlay, dashboard page or script reads fightHistory off the state', () => {
    const dirs = [path.join(ROOT, 'apps', 'mimic'), path.join(ROOT, 'packages', 'wolfpack-logsync')];
    const hits = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(d).filter(n => /\.(html|js)$/.test(n) && n !== 'index.js')) {
        if (/fightHistory/.test(stripJs(readSource(path.join(d, f))))) hits.push(f);
      }
    }
    expect(hits).toEqual(['overlay.html']);                                      // and only as the old-agent fallback above
    // (booleans, not not.toMatch: a failure there would print the whole 45k-line agent)
    // nothing in the agent's embedded pages reads it off a state object — only stats.* and the legacy session file
    expect(/(?<!stats|raw)\.fightHistory/.test(stripJs(agentSrc))).toBe(false);
    // …and the state's own field is the digest, built field by field — never the ring itself
    const state = stripJs(sliceBlock(agentSrc, 'function _serializeForDashboard() {', '\n}\n'));
    expect(state).toMatch(/fightHistory: \(stats\.fightHistory \|\| \[\]\)\.slice\(0, 10\)\.map\(h => \(\{\s*boss: h\.boss, endedMs: h\.endedMs, durationSec: h\.durationSec, total: h\.total, settled: !!h\.settled,\s*\}\)\),/);
  });
});

// The rows the History merge is fed are what the bot hands back, so the bot's rule is pinned here too.
describe('the guild side this models', () => {
  it('the bot rolls a pet into its owner per uploader: who = pet_owner || name', () => {
    const bot = stripJs(readSource(BOT_INDEX));
    expect(bot).toMatch(/const who = \(v && v\.pet_owner\) \? String\(v\.pet_owner\) : name;\s*perUploader\.set\(who, \(perUploader\.get\(who\) \|\| 0\) \+ dmg\);/);
  });
});
