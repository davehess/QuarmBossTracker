// test/relay-scope-gate.test.js — a guild trigger that fires on someone else's
// machine should not speak on yours unless it is relevant to you.
//
// Hitya, 2026-09-02: "Every so often we hear 'Shaman Slow' when we're not around
// combat. It's a guildwide scope. These should only trigger for local fights or
// during raids, not outside."
//
// What actually happened: the cross-Mimic relay had NO scope of any kind. Every
// guild-trigger fire from any raider ran on every other Mimic within 15s — the
// only gates were an 8s dedup and a staleness drop. Someone landing a slow while
// soloing an alt in another zone on a Tuesday spoke on the whole guild's
// machines. The trigger itself was innocent: "{s} yawns." is the correct landing
// emote, shared by all eleven spells in the Drowsy/Slow line.
//
// ⚠ THE RULE THIS FILE PINS: raid-wide during a raid window, same-zone-only
// outside it — AND FAIL OPEN WHENEVER EITHER SIDE IS UNKNOWN. This gate decides
// whether a raid callout is SPOKEN. Silently dropping a real Death Touch warning
// because a zone lookup came back empty is far worse than an occasional stray
// "Shaman Slow", so every unprovable case must pass through. Anyone tightening
// these fail-open branches is trading a nuisance for a wipe.
//
// Run: npx vitest run test/relay-scope-gate.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// The real predicate. End-anchored on the NEXT declaration's comment, never on a
// line of the function body — a mutation must fail an assertion, not break the
// slice and read as a false kill.
const { _relayScopeKeep } = evalBlock(
  sliceBlock(
    src,
    'function _relayScopeKeep({ inRaidWindow, originZone, requesterZones }) {',
    '\n// character name (lower) → owning discord id.',
  ),
  ['_relayScopeKeep'],
);

const zones = (...z) => new Set(z);

describe('outside a raid window', () => {
  const base = { inRaidWindow: false };

  it('drops a fire from another zone — the reported bug', () => {
    expect(_relayScopeKeep({ ...base, originZone: 'East Commonlands', requesterZones: zones('Plane of Hate') }))
      .toBe(false);
  });

  it('keeps a fire from the zone you are standing in', () => {
    expect(_relayScopeKeep({ ...base, originZone: 'Plane of Hate', requesterZones: zones('Plane of Hate') }))
      .toBe(true);
  });

  // One person can have several characters streaming at once; a fire in ANY of
  // their zones is local to them.
  it('keeps it when ANY of your live characters is in that zone', () => {
    expect(_relayScopeKeep({ ...base, originZone: 'Sebilis', requesterZones: zones('Plane of Hate', 'Sebilis') }))
      .toBe(true);
  });
});

describe('during a raid window nothing changes', () => {
  it('keeps a cross-zone fire — split raids are the normal case', () => {
    expect(_relayScopeKeep({ inRaidWindow: true, originZone: 'Vex Thal', requesterZones: zones('Plane of Hate') }))
      .toBe(true);
  });

  it('does not even consult the zones', () => {
    expect(_relayScopeKeep({ inRaidWindow: true, originZone: null, requesterZones: null })).toBe(true);
  });
});

describe('⚠ fail open — the branches that must never be tightened', () => {
  // Live-state is a 45s heartbeat; a fire is at most 60s old. The sender's zone
  // is usually known, but "usually" is not "always".
  it('keeps a fire whose sender we cannot place', () => {
    expect(_relayScopeKeep({ inRaidWindow: false, originZone: null, requesterZones: zones('Plane of Hate') }))
      .toBe(true);
  });

  // Nobody streaming means we do not know where the listener is — most likely
  // they just launched Mimic, which is exactly when muting them is worst.
  it('keeps a fire when we cannot place OURSELVES', () => {
    expect(_relayScopeKeep({ inRaidWindow: false, originZone: 'East Commonlands', requesterZones: zones() }))
      .toBe(true);
    expect(_relayScopeKeep({ inRaidWindow: false, originZone: 'East Commonlands', requesterZones: null }))
      .toBe(true);
  });
});

describe('wiring', () => {
  const bot = stripJs(src);

  it('the ring carries the sender zone, resolved bot-side', () => {
    // ⚠ Resolved from live-state rather than sent by the agent ON PURPOSE: the
    // gate then works for the whole fleet the moment the bot deploys, instead of
    // waiting on ~16 people to update Mimic.
    expect(bot).toContain('origin_zone:         originZone,');
    expect(bot).toContain("if (senderChar) originZone = ((await _liveZoneMap()).get(senderChar) || {}).zone_name || null;");
  });

  it('both poll paths gate through the same resolver', () => {
    expect(bot).toContain('_recentFiresFor(identity, sinceId, lootSinceId, scope)');
    expect(bot).toContain('_recentFiresFor(identity, sinceId, lootSinceId, await _relayScopeFor(identity))');
  });

  it('the filter runs on the ring, beside the own-fire suppression', () => {
    const fn = sliceBlock(bot, 'function _recentFiresFor(', '\n  const loot =');
    expect(fn).toContain('_relayScopeKeep({ inRaidWindow, originZone: e.origin_zone, requesterZones })');
  });

  // ⚠ During a raid the fleet polls hardest, and that is exactly when the gate
  // costs nothing: the zone lookup is skipped outright.
  it('skips the zone lookup entirely during a raid window', () => {
    const fn = sliceBlock(bot, 'async function _relayScopeFor(identity) {', '\nasync function _handleRecentFiresGet');
    const early = fn.indexOf('if (inRaidWindow) return { inRaidWindow: true, requesterZones: null };');
    const lookup = fn.indexOf('_requesterZones(');
    expect(early).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(early);
  });

  // No scope argument = keep everything, so any future caller that forgets it
  // degrades to today's behaviour rather than muting the guild.
  it('defaults to the pre-gate behaviour when no scope is passed', () => {
    expect(bot).toContain('const inRaidWindow  = scope ? !!scope.inRaidWindow : true;');
  });
});
