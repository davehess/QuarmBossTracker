// test/own-timers-pause.test.js — your own timers pause while you are logged out.
//
// The guild lead, 2026-10-13: "My buffs on my pet and myself should pause if I log out. When I log back in I should
// have a lot more time on this ... if I logged back in to reclaim a charmed pet or kill a buffed/debuffed mob those
// timers should continue to tick while the server is online."
//
// EverQuest: effects on your character and your SUMMONED pet do not tick while you are logged out; a charmed pet
// breaks on logout and an NPC's buffs/debuffs keep ticking server-side. The log-derived timers count wall-clock time,
// so the agent remembers when each log last spoke and, on "Welcome to EverQuest!" after a gap, pushes the
// still-running entries forward by that gap. Through the real agent module.
//
// Run: npx vitest run test/own-timers-pause.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');

const OWNER = 'Aldenmar';
const ol = OWNER.toLowerCase();
const PET = 'Gabobab';            // a summoned pet
const pl = PET.toLowerCase();
const CHARM = 'a cragbeast queen'; // a charmed mob
const MIN = 60_000, HOUR = 60 * MIN;

// An EQ log timestamp for `ms`, whole seconds (the log has no finer clock).
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  return `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`;
}
const welcome = (ms) => `${stamp(ms)} Welcome to EverQuest!`;

// A buff that has `leftMs` still to run at `atMs`, out of `durTicks`.
const buff = (name, durTicks, atMs, leftMs, extra = {}) =>
  ({ name, dur_ticks: durTicks, dur_formula: 3, landed_at: atMs - (durTicks * 6000 - leftMs), ...extra });
const online = (extra = {}) => agent._setZealStateForTest(OWNER, { gauges: [{ slot: 16, text: PET }], updatedAt: Date.now(), ...extra });

let logoutAt;
beforeEach(() => {
  agent._petBuffLandings.clear();
  agent._buffLandingsByTarget.clear();
  agent._charmTickTracker.clear();
  agent._lastLineMs.clear();
  agent._lastPetByOwner.clear();
  agent._lastPetIdByOwner.clear();
  agent._lastPetZoneByOwner.clear();
  agent._resetOwnRestoreForTest();
  agent._setZealStateForTest(OWNER, null);
  agent._setUploadOptsForTest(null);
  logoutAt = Date.now() - 2 * HOUR;          // the log went quiet two hours ago
});
afterEach(() => { agent._setZealStateForTest(OWNER, null); });

const petMap = () => agent._petBuffLandings.get(ol);
const landed = (mp, key) => mp.get(key).landed_at;

describe('a summoned pet\'s buffs pause across a logout', () => {
  it('has ~10 minutes left after a 2 hour logout when it had 10 at the logout', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    agent._petBuffLandings.set(ol, new Map([['spirit of wolf', buff('Spirit of Wolf', 300, logoutAt, 10 * MIN)]]));
    online();
    agent._noteOwnRawLine(welcome(Date.now()), OWNER);
    const row = agent.petBuffsForOwner(ol).find(b => b.name === 'Spirit of Wolf');
    expect(row).toBeTruthy();
    expect(row.fell_off).toBe(false);
    expect(Math.abs(row.remaining_secs - 600)).toBeLessThanOrEqual(5);
  });

  it('moves the owner\'s own-name and the summoned pet\'s target entries too, and logs one line', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    agent._buffLandingsByTarget.set(ol, new Map([['clarity', buff('Clarity', 300, logoutAt, 10 * MIN)]]));
    agent._buffLandingsByTarget.set(pl, new Map([['haste', buff('Haste', 300, logoutAt, 10 * MIN)]]));
    const before = [landed(agent._buffLandingsByTarget.get(ol), 'clarity'), landed(agent._buffLandingsByTarget.get(pl), 'haste')];
    online();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent._noteOwnRawLine(welcome(logoutAt + 2 * HOUR), OWNER);
    const said = log.mock.calls.map(c => String(c[0])).filter(s => s.includes('buff timers'));
    log.mockRestore();
    expect(said).toEqual([`[pet] ${ol} was offline 2h — paused their own and their pet's buff timers`]);
    const gap = 2 * HOUR;
    expect(Math.abs(landed(agent._buffLandingsByTarget.get(ol), 'clarity') - (before[0] + gap))).toBeLessThanOrEqual(1000);
    expect(Math.abs(landed(agent._buffLandingsByTarget.get(pl), 'haste') - (before[1] + gap))).toBeLessThanOrEqual(1000);
  });
});

describe('what must NOT move', () => {
  it('a charmed pet\'s buffs keep ticking: nothing under the pet or the owner\'s pet store is shifted', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, CHARM);
    const charmEntry = buff('Allure', 100, logoutAt, 5 * MIN, { is_charm_spell: true, owner: OWNER });
    const hasteEntry = buff('Haste', 300, logoutAt, 10 * MIN);
    agent._buffLandingsByTarget.set(CHARM, new Map([['allure', charmEntry], ['haste', { ...hasteEntry }]]));
    agent._petBuffLandings.set(ol, new Map([['haste', { ...hasteEntry }]]));
    const wasHaste = hasteEntry.landed_at;
    online({ gauges: [{ slot: 16, text: CHARM }] });
    agent._noteOwnRawLine(welcome(logoutAt + 2 * HOUR), OWNER);
    expect(landed(agent._buffLandingsByTarget.get(CHARM), 'allure')).toBe(charmEntry.landed_at);
    expect(landed(agent._buffLandingsByTarget.get(CHARM), 'haste')).toBe(wasHaste);
    expect(landed(petMap(), 'haste')).toBe(wasHaste);
  });

  it('an NPC\'s debuff keeps ticking while the owner moves', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    const mez = buff('Mesmerize', 100, logoutAt, 5 * MIN);
    agent._buffLandingsByTarget.set('a gnoll pup', new Map([['mesmerize', { ...mez }]]));
    agent._buffLandingsByTarget.set(ol, new Map([['clarity', buff('Clarity', 300, logoutAt, 10 * MIN)]]));
    online();
    agent._noteOwnRawLine(welcome(logoutAt + 2 * HOUR), OWNER);
    expect(landed(agent._buffLandingsByTarget.get('a gnoll pup'), 'mesmerize')).toBe(mez.landed_at);
  });

  it('an entry already expired at the logout is not revived (and a running neighbour still moves)', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    const dead = buff('Haste', 30, logoutAt, -10 * MIN);            // ended 10 minutes before the logout
    const alive = buff('Spirit of Wolf', 300, logoutAt, 10 * MIN);
    agent._petBuffLandings.set(ol, new Map([['haste', { ...dead }], ['spirit of wolf', { ...alive }]]));
    online();
    agent._noteOwnRawLine(welcome(logoutAt + 2 * HOUR), OWNER);
    expect(landed(petMap(), 'haste')).toBe(dead.landed_at);
    expect(landed(petMap(), 'spirit of wolf')).toBeGreaterThan(alive.landed_at + HOUR);
  });

  it('an entry marked worn off is not revived either', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    const gone = buff('Haste', 300, logoutAt, 10 * MIN, { worn_off_at: logoutAt - MIN });
    agent._petBuffLandings.set(ol, new Map([['haste', { ...gone }]]));
    online();
    agent._noteOwnRawLine(welcome(logoutAt + 2 * HOUR), OWNER);
    expect(landed(petMap(), 'haste')).toBe(gone.landed_at);
  });

  it('a gap under 60 seconds does nothing', () => {
    const last = Date.now() - 30_000;
    agent._lastLineMs.set(ol, last);
    agent._lastPetByOwner.set(ol, pl);
    const e = buff('Haste', 300, last, 10 * MIN);
    agent._petBuffLandings.set(ol, new Map([['haste', { ...e }]]));
    online();
    agent._noteOwnRawLine(welcome(Date.now()), OWNER);
    expect(landed(petMap(), 'haste')).toBe(e.landed_at);
  });

  it('an ordinary line (not the Welcome line) after a long quiet spell does nothing', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    const e = buff('Haste', 300, logoutAt, 10 * MIN);
    agent._petBuffLandings.set(ol, new Map([['haste', { ...e }]]));
    online();
    agent._noteOwnRawLine(`${stamp(Date.now())} You say, 'hello'`, OWNER);
    expect(landed(petMap(), 'haste')).toBe(e.landed_at);
  });
});

describe('the pet\'s new spawn id right after a login', () => {
  it('does not wipe its buffs (same zone, new id)', () => {
    online({ pet_id: 100, zone: 'gfaydark' });
    agent._lastLineMs.set(ol, Date.now());
    agent.petBuffsForOwner(ol);                                    // remembers id 100 in gfaydark
    agent._petBuffLandings.set(ol, new Map([['spirit of wolf', buff('Spirit of Wolf', 300, Date.now(), 10 * MIN)]]));
    // logout: two hours pass, the pipe is gone
    agent._setZealStateForTest(OWNER, null);
    agent._lastLineMs.set(ol, logoutAt);
    agent._petBuffLandings.get(ol).get('spirit of wolf').landed_at = logoutAt - (300 * 6000 - 10 * MIN);
    // login: same pet, same zone, a new spawn id
    online({ pet_id: 200, zone: 'gfaydark' });
    agent._noteOwnRawLine(welcome(Date.now()), OWNER);
    const row = agent.petBuffsForOwner(ol).find(b => b.name === 'Spirit of Wolf');
    expect(row).toBeTruthy();
    expect(Math.abs(row.remaining_secs - 600)).toBeLessThanOrEqual(5);
  });

  it('still catches a genuinely different pet by name', () => {
    online({ pet_id: 100, zone: 'gfaydark' });
    agent.petBuffsForOwner(ol);
    agent._petBuffLandings.set(ol, new Map([['spirit of wolf', buff('Spirit of Wolf', 300, Date.now(), 10 * MIN)]]));
    agent._lastLineMs.set(ol, logoutAt);
    agent._setZealStateForTest(OWNER, null);
    online({ pet_id: 200, zone: 'gfaydark', gauges: [{ slot: 16, text: 'Kabn' }] });
    agent._noteOwnRawLine(welcome(Date.now()), OWNER);
    expect(agent.petBuffsForOwner(ol).find(b => b.name === 'Spirit of Wolf')).toBeUndefined();
  });
});

describe('while the owner is offline', () => {
  it('petBuffsForOwner does not delete the frozen entry, and reads it against the last log line', () => {
    agent._lastLineMs.set(ol, logoutAt);                           // no Zeal entry: logged out
    agent._lastPetByOwner.set(ol, pl);
    agent._petBuffLandings.set(ol, new Map([['spirit of wolf', buff('Spirit of Wolf', 300, logoutAt, 10 * MIN)]]));
    expect(agent._ownFrozenAt(ol)).toBe(logoutAt);
    const row = agent.petBuffsForOwner(ol).find(b => b.name === 'Spirit of Wolf');
    expect(row).toBeTruthy();
    expect(Math.abs(row.remaining_secs - 600)).toBeLessThanOrEqual(2);
    expect(petMap().has('spirit of wolf')).toBe(true);
  });

  it('is not frozen while Zeal is live or the log spoke a moment ago', () => {
    agent._lastLineMs.set(ol, logoutAt);
    online();
    expect(agent._ownFrozenAt(ol)).toBeNull();
    agent._setZealStateForTest(OWNER, null);
    agent._lastLineMs.set(ol, Date.now() - 10_000);
    expect(agent._ownFrozenAt(ol)).toBeNull();
    agent._lastLineMs.delete(ol);
    expect(agent._ownFrozenAt(ol)).toBeNull();                     // a log we have never seen freezes nothing
  });

  it('a charmed pet is NOT frozen: its expired buff is pruned as usual', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, CHARM);
    agent._buffLandingsByTarget.set(CHARM, new Map([['allure', buff('Allure', 100, logoutAt, 5 * MIN, { is_charm_spell: true })]]));
    agent._petBuffLandings.set(ol, new Map([['haste', buff('Haste', 300, logoutAt, 10 * MIN)]]));
    expect(agent.petBuffsForOwner(ol).find(b => b.name === 'Haste')).toBeUndefined();
    expect(petMap().has('haste')).toBe(false);
  });

  it('targetBuffsFor keeps the owner\'s own and the summoned pet\'s entries but prunes an NPC\'s', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    agent._buffLandingsByTarget.set(ol, new Map([['clarity', buff('Clarity', 300, logoutAt, 10 * MIN)]]));
    agent._buffLandingsByTarget.set(pl, new Map([['haste', buff('Haste', 300, logoutAt, 10 * MIN)]]));
    agent._buffLandingsByTarget.set('a gnoll pup', new Map([['slow', buff('Slow', 300, logoutAt, 10 * MIN)]]));
    expect(agent.targetBuffsFor(ol).map(b => b.name)).toEqual(['Clarity']);
    expect(agent.targetBuffsFor(pl).map(b => b.name)).toEqual(['Haste']);
    expect(agent.targetBuffsFor('a gnoll pup')).toEqual([]);       // expired long ago on the server's clock
    expect(agent._buffLandingsByTarget.has('a gnoll pup')).toBe(false);
    expect(agent._buffLandingsByTarget.get(ol).size).toBe(1);
  });
});

describe('the clock is kept from every raw line', () => {
  it('records the newest line per character and never moves it backwards', () => {
    const t = Date.now() - 5 * MIN;
    agent._noteOwnRawLine(`${stamp(t)} You say, 'a'`, OWNER);
    const first = agent._lastLineMs.get(ol);
    expect(Math.abs(first - t)).toBeLessThanOrEqual(1000);
    agent._noteOwnRawLine(`${stamp(t - MIN)} You say, 'older'`, OWNER);
    expect(agent._lastLineMs.get(ol)).toBe(first);
    agent._noteOwnRawLine(`${stamp(t + MIN)} You say, 'newer'`, OWNER);
    expect(agent._lastLineMs.get(ol)).toBeGreaterThan(first);
  });
});

describe('the pause clocks survive a restart', () => {
  let file;
  beforeEach(() => { file = path.join(os.tmpdir(), `own-timers-${process.pid}-${Date.now()}.json`); });
  afterEach(() => { try { fs.unlinkSync(file); } catch { /* none */ } });

  it('keeps a logged-out owner\'s frozen timers, drops an NPC\'s long-expired one, loads the clocks first', () => {
    const own = buff('Spirit of Wolf', 300, logoutAt, 10 * MIN);
    const npc = buff('Slow', 300, logoutAt, 10 * MIN);
    fs.writeFileSync(file, JSON.stringify({
      lastLineMs: [[ol, logoutAt]],
      ownPets: [[ol, pl]],
      petBuffLandings: [[ol, [['spirit of wolf', own]]]],
      buffLandingsByTarget: [[ol, [['clarity', buff('Clarity', 300, logoutAt, 10 * MIN)]]], [pl, [['haste', buff('Haste', 300, logoutAt, 10 * MIN)]]], ['a gnoll pup', [['slow', npc]]]],
    }));
    agent._loadPetStateFromDisk(file);
    expect(agent._lastLineMs.get(ol)).toBe(logoutAt);
    expect(agent._lastPetByOwner.get(ol)).toBe(pl);
    expect(petMap().has('spirit of wolf')).toBe(true);
    expect(agent._buffLandingsByTarget.has(ol)).toBe(true);
    expect(agent._buffLandingsByTarget.has(pl)).toBe(true);
    expect(agent._buffLandingsByTarget.has('a gnoll pup')).toBe(false);
  });

  it('does not freeze a charm pet\'s entries on load', () => {
    fs.writeFileSync(file, JSON.stringify({
      lastLineMs: [[ol, logoutAt]],
      ownPets: [[ol, CHARM]],
      buffLandingsByTarget: [[CHARM, [['allure', buff('Allure', 100, logoutAt, 5 * MIN, { is_charm_spell: true })]]]],
    }));
    agent._loadPetStateFromDisk(file);
    expect(agent._buffLandingsByTarget.has(CHARM)).toBe(false);
  });
});

describe('what goes to the database', () => {
  it('sends only buffs not worn off and still running at the frozen clock, capped at 40', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, pl);
    const mp = new Map([
      ['live', buff('Live', 300, logoutAt, 10 * MIN)],
      ['expired', buff('Expired', 30, logoutAt, -MIN)],
      ['worn', buff('Worn', 300, logoutAt, 10 * MIN, { worn_off_at: logoutAt - 1000 })],
    ]);
    for (let i = 0; i < 50; i++) mp.set('b' + i, buff('B' + i, 300, logoutAt, 10 * MIN));
    agent._petBuffLandings.set(ol, mp);
    const body = agent._ownTimersPayload(ol);
    expect(body.pet_name).toBe(pl);
    expect(body.last_line_ms).toBe(logoutAt);
    expect(body.pet_buffs.length).toBe(40);
    const names = body.pet_buffs.map(b => b.name);
    expect(names).toContain('Live');
    expect(names).not.toContain('Expired');
    expect(names).not.toContain('Worn');
    expect(Object.keys(body.pet_buffs[0]).sort()).toEqual(['dur_formula', 'dur_ticks', 'landed_at', 'name']);
  });

  it('sends no buffs and no pet name for a charmed pet', () => {
    agent._lastLineMs.set(ol, logoutAt);
    agent._lastPetByOwner.set(ol, CHARM);
    agent._buffLandingsByTarget.set(CHARM, new Map([['allure', buff('Allure', 100, logoutAt, 5 * MIN, { is_charm_spell: true })]]));
    agent._petBuffLandings.set(ol, new Map([['haste', buff('Haste', 300, logoutAt, 10 * MIN)]]));
    const body = agent._ownTimersPayload(ol);
    expect(body.pet_name).toBeNull();
    expect(body.pet_buffs).toEqual([]);
  });
});

describe('restoring from the database on first sight', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; agent._setUploadOptsForTest(null); });
  const stub = (timers) => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ ok: true, timers }) }; };
    return calls;
  };
  const withBot = () => agent._setUploadOptsForTest({ botUrl: 'http://bot.test/api/agent/encounter', token: 'tok', dryRun: false });
  const stored = (now) => ({
    character: 'Brackwyn', pet_name: 'gabobab', last_line_ms: now - 3 * HOUR, saved_at: new Date(now - 3 * HOUR).toISOString(),
    pet_buffs: [buff('Spirit of Wolf', 300, now - 3 * HOUR, 10 * MIN)],
  });

  it('merges the stored pet buffs, then resumes by the stored clock when the first line was the Welcome', async () => {
    const now = Date.now();
    const calls = stub(stored(now));
    withBot();
    await agent._ownRestoreOnFirstSight('Brackwyn', false, now);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('http://bot.test/api/agent/own-timers?character=Brackwyn');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
    const mp = agent._petBuffLandings.get('brackwyn');
    expect(mp.has('spirit of wolf')).toBe(true);
    // 3 hours away, 10 minutes left at the logout: ~10 minutes left now
    const left = (mp.get('spirit of wolf').landed_at + 300 * 6000 - now) / 1000;
    expect(Math.abs(left - 600)).toBeLessThanOrEqual(5);
    expect(agent._lastPetByOwner.get('brackwyn')).toBe('gabobab');
  });

  it('does not overwrite a local entry, and asks nothing when the PC already has history', async () => {
    const now = Date.now();
    const calls = stub(stored(now));
    withBot();
    const local = buff('Spirit of Wolf', 300, now, 20 * MIN);
    agent._petBuffLandings.set('brackwyn', new Map([['spirit of wolf', local]]));
    await agent._ownRestoreOnFirstSight('Brackwyn', false, null);
    expect(calls.length).toBe(0);
    agent._resetOwnRestoreForTest();
    agent._petBuffLandings.clear();
    agent._petBuffLandings.set('brackwyn', new Map());
    agent._lastLineMs.set('brackwyn', now - HOUR);
    await agent._ownRestoreOnFirstSight('Brackwyn', true, null);
    expect(calls.length).toBe(0);
  });

  it('never attaches a stored pet\'s buffs to a different live pet', async () => {
    const now = Date.now();
    stub(stored(now));
    withBot();
    agent._setZealStateForTest('Brackwyn', { gauges: [{ slot: 16, text: 'Kabn' }], updatedAt: now });
    await agent._ownRestoreOnFirstSight('Brackwyn', false, null);
    agent._setZealStateForTest('Brackwyn', null);
    expect(agent._petBuffLandings.get('brackwyn')).toBeUndefined();
  });

  it('sends nothing in local mode (no token)', async () => {
    const calls = stub(stored(Date.now()));
    agent._setUploadOptsForTest({ botUrl: 'http://bot.test/api/agent/encounter', token: '', dryRun: false });
    await agent._ownRestoreOnFirstSight('Brackwyn', false, null);
    expect(calls.length).toBe(0);
  });

  it('fails open when the bot errors', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    withBot();
    await expect(agent._ownRestoreOnFirstSight('Brackwyn', false, Date.now())).resolves.toBeUndefined();
    expect(agent._petBuffLandings.get('brackwyn')).toBeUndefined();
  });
});
