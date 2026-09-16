// test/ds-attribution.test.js — an anonymous "<mob> was hit by non-melee for N"
// is NOT a damage shield just because the mob swung at someone a second ago.
//
// The guild lead, 2026-09-13, reading the Tank overlay on Kaas Thox Xi Ans Dyek: "This
// is misleading, i don't think he's getting thorns damage returned … These
// look like 150 dd procs." The rollup agreed: sixteen hits of exactly 150,
// spread over five raiders as `ds:non-melee` — one flavor line in the whole
// fight. Every proc and direct-damage spell from anyone in range logs the
// same anonymous line a shield return does, and a boss connects on the tank
// every second, so the old swing-correlation credited nearly all of them.
//
// The rule now: the swing names the only possible wearer; the hit is a
// shield only when the log names one ("<mob> was pierced by thorns.") or the
// tank is known to wear a DS buff and the amount fits it. The candidate is
// HELD out of the fight for the pair window and re-added decided, so the
// live meter, the upload rollup and the overlay tally never see a credit
// that is later taken back.
//
// Run: npx vitest run test/ds-attribution.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const { EncounterBuilder } = agent;

const MOB  = 'Kaas Thox Xi Ans Dyek';
const T0   = '[Sun Sep 13 20:40:00 2026]';
const T1   = '[Sun Sep 13 20:40:01 2026]';
const T2   = '[Sun Sep 13 20:40:02 2026]';
const T3   = '[Sun Sep 13 20:40:03 2026]';

// Same three calls the golden replay makes — the real intake path.
const feed = (b, ts, line) => {
  const full = `${ts} ${line}`;
  const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
  if (ev) b.add(ev);
  return ev;
};
const mk = () => new EncounterBuilder({ character: 'Hitya', silent: true });
const anon = (b) => b.events.filter(e => e.type === 'damage' && e.ability !== 'slash' && e.ability !== 'hit');
const dsFor = (b, who) => b.dsByTank.get(who.toLowerCase()) || null;

describe('an anonymous non-melee hit after the mob connects on the tank', () => {
  it('is HELD for the pair window, not credited on arrival', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 150 points of damage.`);
    expect(b.events).toHaveLength(1);          // only the connect is in the fight
    expect(b._dsPending).toBeTruthy();
    expect(dsFor(b, 'Peopleslayer')).toBeNull();
  });

  it('with no flavor line and no known shield on the tank it stays an anonymous hit (the 150 proc)', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 150 points of damage.`);
    feed(b, T3, `Hitya slashes ${MOB} for 40 points of damage.`);   // past the window → settles
    const hits = anon(b);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ amount: 150, attacker: null, ability: 'non-melee' });
    expect(hits[0].ds).toBeUndefined();
    expect(dsFor(b, 'Peopleslayer')).toBeNull();
    expect(b.dsReflects.size).toBe(0);
    // Re-added exactly once, in its place: the mob took all three hits.
    expect(b.targets.get(MOB)).toBe(150 + 40);
    expect(b.events.map(e => e.amount)).toEqual([210, 150, 40]);
  });

  it('is a shield when the log names one on that mob in the same second', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 9 points of damage.`);
    feed(b, T0, `${MOB} was pierced by thorns.`);
    const hits = anon(b);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ amount: 9, attacker: 'Peopleslayer', ability: 'thorns', ds: true });
    expect(dsFor(b, 'Peopleslayer')).toMatchObject({ total: 9, hits: 1, abilities: { thorns: { count: 1, total: 9 } } });
    expect(b._dsPending).toBeNull();
  });

  it('a flavor line for a DIFFERENT mob is not evidence', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 9 points of damage.`);
    feed(b, T0, `a mindless servant was pierced by thorns.`);
    expect(anon(b)[0]).toMatchObject({ amount: 9, attacker: null });
    expect(dsFor(b, 'Peopleslayer')).toBeNull();
  });

  it('a flavor line that arrives after the window is not evidence either', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 9 points of damage.`);
    feed(b, T2, `${MOB} was pierced by thorns.`);
    expect(anon(b)[0]).toMatchObject({ amount: 9, attacker: null });
    expect(dsFor(b, 'Peopleslayer')).toBeNull();
  });

  it('a connect two seconds earlier does not even make it a candidate', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T2, `${MOB} was hit by non-melee for 9 points of damage.`);
    expect(b._dsPending).toBeNull();
    expect(b.events).toHaveLength(2);
    expect(anon(b)[0]).toMatchObject({ amount: 9, attacker: null });
  });
});

describe('a tank known to wear a DS buff', () => {
  const withShield = (perHit) => {
    const b = mk();
    b._knownDsPerHit = (name) => (name === 'Peopleslayer' ? perHit : 0);
    return b;
  };

  it('vouches for a small anonymous hit with no flavor line', () => {
    const b = withShield(9);
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 9 points of damage.`);
    feed(b, T3, `Hitya slashes ${MOB} for 40 points of damage.`);
    expect(anon(b)[0]).toMatchObject({ amount: 9, attacker: 'Peopleslayer', ability: 'non-melee', ds: true });
    expect(dsFor(b, 'Peopleslayer')).toMatchObject({ total: 9, hits: 1 });
  });

  it('allows an unlisted worn/AA shield on top, within the slack', () => {
    const b = withShield(9);
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 24 points of damage.`);   // 9 known + 15 worn
    feed(b, T3, `Hitya slashes ${MOB} for 40 points of damage.`);
    expect(anon(b)[0]).toMatchObject({ amount: 24, attacker: 'Peopleslayer', ds: true });
  });

  it('does NOT vouch for a 150 — a proc is not a shield, even with a same-second flavor line', () => {
    const b = withShield(9);
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 150 points of damage.`);
    feed(b, T0, `${MOB} was pierced by thorns.`);
    expect(anon(b)[0]).toMatchObject({ amount: 150, attacker: null, ability: 'non-melee' });
    expect(dsFor(b, 'Peopleslayer')).toBeNull();
  });

  it('a second candidate on the same mob settles the first on its own evidence — the flavor line goes to the last', () => {
    const b = withShield(9);
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T0, `${MOB} was hit by non-melee for 150 points of damage.`);   // someone's proc
    feed(b, T0, `${MOB} was hit by non-melee for 9 points of damage.`);     // the shield
    feed(b, T0, `${MOB} was pierced by thorns.`);
    const hits = anon(b);
    expect(hits.map(h => [h.amount, h.attacker, h.ability])).toEqual([
      [150, null, 'non-melee'],
      [9, 'Peopleslayer', 'thorns'],
    ]);
    expect(dsFor(b, 'Peopleslayer')).toMatchObject({ total: 9, hits: 1 });
  });
});

describe('the pair windows are the one-second log resolution', () => {
  it('the connect → return window and the return → flavor window are both one second', () => {
    const b = mk();
    feed(b, T0, `${MOB} hits Peopleslayer for 210 points of damage.`);
    feed(b, T1, `${MOB} was hit by non-melee for 9 points of damage.`);   // next second: still a candidate
    expect(b._dsPending).toBeTruthy();
    feed(b, T2, `${MOB} was pierced by thorns.`);                         // next second again: still the pair
    expect(anon(b)[0]).toMatchObject({ amount: 9, attacker: 'Peopleslayer', ability: 'thorns', ds: true });
  });
});
