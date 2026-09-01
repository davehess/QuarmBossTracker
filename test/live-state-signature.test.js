// test/live-state-signature.test.js — what makes the agent push a live-state
// snapshot NOW instead of waiting for the heartbeat.
//
// Hitya, 2026-09-01: "45 seconds is entirely too long for certain things to be
// synced. many fights only last about that long. so when we're reporting up HP
// totals or who's tanking or if a boss is slowed even 2 seconds can feel like
// an eternity. 2 seconds is often the delay between CH chain castings."
//
// ⚠ THE 45s IS A FLOOR, NOT A CADENCE. flushLiveStateToBot runs every 5s and
// sends whenever the change signature differs from the last one sent;
// LIVE_STATE_HEARTBEAT_MS only guarantees a floor for a character whose
// signature is completely static. So "how fresh is fact X" is entirely decided
// by whether X is a term in that signature — which is what this file pins.
//
// The rule for what belongs in it: DISCRETE EVENTS go in, CONTINUOUS CHURN
// stays out. A target swap, a tank picking up an add, a buff landing, an HP
// bucket crossing are events. Raw HP%, buff ticks and loc change on every
// frame; putting those in would turn a change-gated stream into a 5s firehose
// (loc is deliberately excluded for exactly this reason and stays advisory).
//
// Run: npx vitest run test/live-state-signature.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// The real signature construction, run for real. Anchored on the comment that
// opens the target-HP bucket and closed on the line AFTER the sig literal, so
// mutating any term inside it changes behaviour rather than breaking the slice.
const BLOCK = sliceBlock(
  src,
  '    const targetHpBucket = (rec.target_hp_pct != null)',
  '\n    // Send when the signature changed, OR the heartbeat floor elapsed',
);

function sigOf(rec, { buffs = [], petBuffs = [], now = 1_000_000 } = {}) {
  const { run } = evalBlock(
    `function run(rec, buffs, petBuffs, now) {
       ${BLOCK}
       return sig;
     }`,
    ['run'],
  );
  return run(rec, buffs, petBuffs, now);
}

const BASE = {
  zone_id: 33, target_name: 'a cliff golem', target_id: 4425,
  target_hp_pct: 100, self_hp_pct: 100, self_mana_pct: 100,
  pet_name: null, di_ready_at: null, incoming_mob: null, observed_tanks: null,
};

describe('a same-name target swap is visible immediately', () => {
  // ⚠ The case the spawn id exists for. Two "a cliff golem" leave target_name
  // byte-identical, so before the id became a term this swap did not trip the
  // signature at all and the board showed the WRONG instance until the next
  // heartbeat — on a 45s fight, potentially the whole fight.
  it('changes the signature when only the spawn id changed', () => {
    expect(sigOf({ ...BASE, target_id: 4425 }))
      .not.toBe(sigOf({ ...BASE, target_id: 4471 }));
  });

  it('still changes when the id is the only thing that is null', () => {
    expect(sigOf({ ...BASE, target_id: null }))
      .not.toBe(sigOf({ ...BASE, target_id: 4425 }));
  });

  // ⚠ An id is a slot in the ZONE's entity table, so the same number in two
  // zones is two different mobs — but the SIGNATURE does not need to say so,
  // because zone_id is already a term of its own. This asserts the zone covers
  // it; a "the id term is zone-keyed" test would pass whether the keying
  // existed or not (it did, and it was removed for exactly that reason).
  it('a zone change re-sends even when the id number is unchanged', () => {
    expect(sigOf({ ...BASE, zone_id: 33, target_id: 4425 }))
      .not.toBe(sigOf({ ...BASE, zone_id: 164, target_id: 4425 }));
  });
});

describe('who is tanking what', () => {
  const withTanks = (pairs) => ({
    ...BASE,
    observed_tanks: pairs.map(([mob, tank]) => ({ mob, tank, since: '2026-09-01T00:00:00Z' })),
  });

  it('a tank picking up an add changes the signature', () => {
    expect(sigOf(withTanks([['a cliff golem', 'Abrahms']])))
      .not.toBe(sigOf(withTanks([['a cliff golem', 'Abrahms'], ['a stone golem', 'Rockfist']])));
  });

  it('a tank losing a mob changes the signature', () => {
    expect(sigOf(withTanks([['a cliff golem', 'Abrahms'], ['a stone golem', 'Rockfist']])))
      .not.toBe(sigOf(withTanks([['a cliff golem', 'Abrahms']])));
  });

  it('the mob changing hands changes the signature', () => {
    expect(sigOf(withTanks([['a cliff golem', 'Abrahms']])))
      .not.toBe(sigOf(withTanks([['a cliff golem', 'Rockfist']])));
  });

  // ⚠ The churn guards. Without these the term re-sends every 5s forever and
  // the change gate stops being a gate — this is exactly why loc is excluded.
  it('a moving `since` timestamp does NOT re-send', () => {
    const a = { ...BASE, observed_tanks: [{ mob: 'a cliff golem', tank: 'Abrahms', since: '2026-09-01T00:00:00Z' }] };
    const b = { ...BASE, observed_tanks: [{ mob: 'a cliff golem', tank: 'Abrahms', since: '2026-09-01T00:00:29Z' }] };
    expect(sigOf(a)).toBe(sigOf(b));
  });

  it('the same pairs in a different order do NOT re-send', () => {
    expect(sigOf(withTanks([['a cliff golem', 'Abrahms'], ['a stone golem', 'Rockfist']])))
      .toBe(sigOf(withTanks([['a stone golem', 'Rockfist'], ['a cliff golem', 'Abrahms']])));
  });

  it('the same tank cased differently does NOT re-send', () => {
    expect(sigOf(withTanks([['a cliff golem', 'Abrahms']])))
      .toBe(sigOf(withTanks([['a cliff golem', 'ABRAHMS']])));
  });

  it('no tanks and an empty tank list are the same', () => {
    expect(sigOf({ ...BASE, observed_tanks: null })).toBe(sigOf({ ...BASE, observed_tanks: [] }));
  });
});

describe('the buckets that keep HP from becoming a firehose', () => {
  // Target HP rides 10-point buckets, self HP 5-point. Bucketing is what stops
  // every 1% combat tick from tripping the gate; the cost is that movement
  // INSIDE a bucket is invisible until the next crossing or the heartbeat.
  it('a 1% target tick inside one bucket does not re-send', () => {
    expect(sigOf({ ...BASE, target_hp_pct: 97 })).toBe(sigOf({ ...BASE, target_hp_pct: 93 }));
  });

  it('crossing a target bucket line does re-send', () => {
    expect(sigOf({ ...BASE, target_hp_pct: 91 })).not.toBe(sigOf({ ...BASE, target_hp_pct: 89 }));
  });

  it('self HP is bucketed FINER than target HP — a tank bar wants it', () => {
    // 88 → 82 crosses a 5-point line but not a 10-point one, so this pair
    // distinguishes the two granularities rather than just asserting a number.
    expect(sigOf({ ...BASE, self_hp_pct: 88 })).not.toBe(sigOf({ ...BASE, self_hp_pct: 82 }));
    expect(sigOf({ ...BASE, target_hp_pct: 88 })).toBe(sigOf({ ...BASE, target_hp_pct: 82 }));
  });
});

describe('what is deliberately NOT a term', () => {
  const agent = stripJs(src);

  // loc churns on every step. It is advisory by design; adding it would turn
  // the change-gated 5s flush into an unconditional 5s upload per box.
  //
  // ⚠ Asserted by RUNNING the signature over a moved character, not by looking
  // for the comment that says so — `agent` here is comment-stripped, and an
  // earlier draft of this very test "passed" against the prose instead of the
  // code. A behavioural check cannot be satisfied by a comment.
  it('walking around does not re-send', () => {
    const here  = { ...BASE, loc_x: 100, loc_y: 200, loc_z: 12 };
    const there = { ...BASE, loc_x: 480, loc_y: -90, loc_z: 31 };
    expect(sigOf(here)).toBe(sigOf(there));
  });

  it('exact self HP cur/max is not a term either — the 5% bucket carries it', () => {
    expect(sigOf({ ...BASE, self_hp_cur: 8123, self_hp_max: 9000 }))
      .toBe(sigOf({ ...BASE, self_hp_cur: 8460, self_hp_max: 9000 }));
  });

  it('and the literal names none of them', () => {
    const sigLit = sliceBlock(agent, '    const sig = JSON.stringify([', '\n    ]);');
    expect(sigLit).not.toMatch(/loc_[xyz]|self_hp_cur|self_hp_max/);
  });
});
