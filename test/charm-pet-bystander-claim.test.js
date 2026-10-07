// test/charm-pet-bystander-claim.test.js — another raider's charm pet counts for its owner (FB-52).
//
// A member's report: a raider's charm pet "is not reporting back in as being his damage in the dps
// tracker overlay. I did a /pet Leader and it still didn't fix it."
//
// The log excerpt that came with it (a bystander's log, the owner is never "You"): a charmed
// "a lesser vind briesl" fighting for ten minutes, 679 hits and 71,813 damage, answering
// "a lesser vind briesl says 'My leader is <Owner>.'" nine times. The agent parsed every one of them
// (petLeaders was set) and the meter STILL read "(charmed)", because _publishLiveThreat ignores
// petLeaders for article-prefixed names — correctly, for a stale one: one revenant claim once labelled
// every revenant all raid (2026-07-31). A bystander has no charm gauge and no pet-command ack, so the
// pet's own public line is the whole proof. It counts while it is FRESH and UNAMBIGUOUS, the bot's rule
// for the same lines.
//
// The real parser and the real builder run on log lines in the shape of the excerpt (names invented);
// the overlay's own fold turns the row into "Owner +pet".
//
// Run: npx vitest run test/charm-pet-bystander-claim.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT, AGENT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const agentSrc = readSource(AGENT_INDEX);
const { _foldPetsIntoOwners } = evalBlock(
  sliceBlock(overlay, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['_foldPetsIntoOwners'],
);

const PET = 'a lesser vind briesl';          // how the pet speaks…
const PET_ROW = 'A lesser vind briesl';        // …and how a sentence-initial damage line spells it
const MOB = 'a vind briesl';

const stamp = (hms, text) => `[Mon Oct 05 ${hms} 2026] ${text}`;
// One raw line through the shipped pipeline: keep-filter, parser, builder. False when the filter drops it.
function feed(b, hms, text) {
  const line = stamp(hms, text);
  if (!agent.shouldKeep(line)) return false;
  const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
  if (!ev) return false;
  b.add(ev);
  return true;
}
const builder = (character = 'Brackwyn') => new agent.EncounterBuilder({ character, onFlush: () => {} });
function rowOf(b, name = PET_ROW) {
  b._publishLiveThreat();
  const et = agent._liveThreatForTest();
  return { row: et && et.perPlayer && et.perPlayer[name], perPlayer: (et && et.perPlayer) || {} };
}
// A fight in minute `hm` (HH:MM), in which the raid hits the mob and the pet fights too.
function fightAt(b, hm, { pethits = 3 } = {}) {
  const t = (s) => `${hm}:${String(s).padStart(2, '0')}`;
  feed(b, t(10), `Aldenmar slashes ${MOB} for 300 points of damage.`);
  for (let i = 0; i < pethits; i++) {
    feed(b, t(11 + i), `${PET_ROW} pierces ${MOB} for ${100 + i} points of damage.`);
    feed(b, t(11 + i), `Aldenmar slashes ${MOB} for 250 points of damage.`);
  }
}

beforeEach(() => { agent._charmTickTracker.clear(); });
afterEach(() => { agent._charmTickTracker.clear(); });

describe('a bystander hears the pet name its owner', () => {
  it('the row is the owner\'s: pet_owner set, not "(charmed)"', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:47');
    const { row } = rowOf(b);
    expect(row).toMatchObject({ pet_owner: 'Corvale', dmg: 100 + 101 + 102 });
    expect(row.pet_charm).toBeUndefined();
  });

  it('typing /pet leader again and again is still one claim, not a crowd', () => {
    const b = builder();
    for (const s of ['02:47:21', '02:47:22', '02:47:22', '02:47:26']) feed(b, s, `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:47');
    expect(rowOf(b).row.pet_owner).toBe('Corvale');
  });

  it('the /pet leader reply\'s ", Master" ending reads the same', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale, Master.'`);
    fightAt(b, '02:47');
    expect(rowOf(b).row.pet_owner).toBe('Corvale');
  });

  it('the meter shows the owner with the pet folded in: "Corvale +pet"', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:47');
    const { perPlayer } = rowOf(b);
    const rows = Object.entries(perPlayer)
      .map(([n, t]) => [n, t.dmg || 0, 0, t.pet_owner || null, 0, 0, t.pet_charm || false])
      .filter(r => r[1] > 0);
    const out = _foldPetsIntoOwners(rows);
    const corvale = out.find(r => r[0] === 'Corvale');
    expect(corvale && [corvale[1], corvale[8]]).toEqual([303, true]);
    expect(out.map(r => r[0])).not.toContain(PET_ROW);
  });
});

describe('what is NOT a claim', () => {
  it('the pet\'s public command chatter names no owner', () => {
    const b = builder();
    // "Sorry, Master..calming down." / "Following you, Master." are said aloud to the whole zone.
    expect(feed(b, '02:42:31', `${PET} says 'Sorry, Master..calming down.'`)).toBe(false);
    expect(feed(b, '02:45:09', `${PET} says 'Following you, Master.'`)).toBe(false);
    expect(b.petClaims).toEqual({});
    expect(b.petLeaders).toEqual({});
  });

  it('a mob that is itself charmed does not "own" a pet — only a raider can', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is a Shadel Bandit.'`);
    fightAt(b, '02:47');
    const { row } = rowOf(b);
    expect(row.pet_owner).toBeNull();
    expect(b.petClaims).toEqual({});
  });

  it('a summoned pet keeps its runtime-long owner and never touches the claim list', () => {
    const b = builder();
    feed(b, '02:47:21', `Gobeker says 'My leader is Corvale.'`);
    feed(b, '02:47:30', `Aldenmar slashes ${MOB} for 300 points of damage.`);
    feed(b, '02:47:31', `Gobeker hits ${MOB} for 120 points of damage.`);
    expect(rowOf(b, 'Gobeker').row.pet_owner).toBe('Corvale');
    expect(b.petClaims).toEqual({});
  });
});

describe('a claim is only as good as it is fresh', () => {
  it('heard a quarter-hour or less before the pull: still the owner\'s', () => {
    const b = builder();
    feed(b, '02:16:00', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:30');                                       // 14 minutes later
    expect(rowOf(b).row.pet_owner).toBe('Corvale');
  });

  it('heard half an hour before the pull: last hour\'s charm — "(charmed)", credited to nobody', () => {
    const b = builder();
    feed(b, '02:00:00', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:30');
    const { row } = rowOf(b);
    expect(row.pet_owner).toBeNull();
    expect(row.pet_charm).toBe(true);
  });

  it('declared again during the fight, an old claim is current again', () => {
    const b = builder();
    feed(b, '02:00:00', `${PET} says 'My leader is Corvale.'`);
    feed(b, '02:30:05', `Aldenmar slashes ${MOB} for 300 points of damage.`);
    feed(b, '02:31:00', `${PET} says 'My leader is Corvale.'`);
    feed(b, '02:31:01', `${PET_ROW} pierces ${MOB} for 100 points of damage.`);
    expect(rowOf(b).row.pet_owner).toBe('Corvale');
  });

  it('the charm ending ends the claim', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:47');
    expect(rowOf(b).row.pet_owner).toBe('Corvale');
    feed(b, '02:47:45', `${PET} is no longer charmed.`);
    feed(b, '02:47:46', `${PET_ROW} pierces ${MOB} for 100 points of damage.`);
    const { row } = rowOf(b);
    expect(row.pet_owner).toBeNull();
    expect(row.pet_charm).toBe(true);
  });
});

describe('two raiders, one mob name', () => {
  it('cannot be told apart from a single row, so nobody is credited (the three-revenants night)', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    feed(b, '02:48:02', `${PET} says 'My leader is Nyssara.'`);
    fightAt(b, '02:48');
    const { row } = rowOf(b);
    expect(row.pet_owner).toBeNull();
    expect(row.pet_charm).toBe(true);
  });

  it('the same raider claiming twice is not two raiders', () => {
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    feed(b, '02:48:02', `${PET} says 'My leader is Corvale.'`);
    expect(b.petClaims[PET]).toHaveLength(1);
  });

  it('once the older claim ages out, the newer owner stands alone', () => {
    const b = builder();
    feed(b, '02:00:00', `${PET} says 'My leader is Corvale.'`);
    feed(b, '02:29:00', `${PET} says 'My leader is Nyssara.'`);
    fightAt(b, '02:30');
    expect(rowOf(b).row.pet_owner).toBe('Nyssara');
  });
});

describe('this agent\'s own proofs still come first', () => {
  it('a live charm of ours is never overruled by someone else\'s line', () => {
    agent._charmTickTracker.set(PET, { pet: PET_ROW, owner: 'Brackwyn', is_active: true, last_tick_at: Date.now(), last_event: 'land', started_at: Date.now() });
    const b = builder();
    feed(b, '02:47:21', `${PET} says 'My leader is Corvale.'`);
    fightAt(b, '02:47');
    expect(rowOf(b).row.pet_owner).toBe('Brackwyn');
  });
});

// The hook must exist in the code that publishes the meter; a correct resolver nobody calls is a green
// suite guarding nothing. Comments stripped — this file's prose would satisfy a naive toContain.
describe('and it is wired into the meter', () => {
  const clean = stripJs(agentSrc);
  it('_publishLiveThreat asks the claim list for a charm mob last', () => {
    expect(clean).toMatch(/if \(!petOwner && \/\^an\?\\s\/i\.test\(nl\)\) petOwner = this\._freshClaimOwner\(nl\);/);
  });
  it('the pet\'s own public line is what records a claim', () => {
    expect(clean).toMatch(/if \(!event\.source && event\.owner !== '__SELF__'\) this\._noteCharmClaim\(/);
  });
});
