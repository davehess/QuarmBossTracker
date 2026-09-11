// test/relay-scope-gate.test.js — a guild trigger that fires on someone else's
// machine should not speak on yours unless it is relevant to you.
//
// Hitya, 2026-09-02: "Every so often we hear 'Shaman Slow' when we're not around
// combat. It's a guildwide scope. These should only trigger for local fights or
// during raids, not outside."
//
// Hitya, 2026-09-11, alone in Vex Thal while Lucker slowed trash in Ssraeshza:
// "I'm not in a zone with another guild member, or in a group, or even a raid.
// These random slips need to stop."
//
// What actually happened the second time: the 3.1.111 gate resolved the sender's
// zone from `payload.character` — a field NO agent has ever sent — so the origin
// was null on every fire and the deliberate fail-open branch passed every one of
// them. The gate never dropped a single callout. Two things change here:
//   1. the sender's zones come from the uploading ACCOUNT (every live character
//      on it), the same lookup the listener already uses;
//   2. outside a raid, unknown means NOT local. The raid cases are the safety net
//      for a real callout: the scheduled window, or the listener's own Mimic
//      uploading a raid roster within 10 minutes (off-schedule raids).
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
    'function _relayScopeKeep({ inRaidWindow, inRaid, originZones, requesterZones }) {',
    '\n// character name (lower) → owning discord id.',
  ),
  ['_relayScopeKeep'],
);

const zones = (...z) => new Set(z);
const OUT = { inRaidWindow: false, inRaid: false };

describe('outside a raid', () => {
  it('drops a fire from another zone — the reported bug, twice', () => {
    expect(_relayScopeKeep({ ...OUT, originZones: ['Ssraeshza Temple'], requesterZones: zones('Vex Thal') })).toBe(false);
    expect(_relayScopeKeep({ ...OUT, originZones: ['East Commonlands'], requesterZones: zones('Plane of Hate') })).toBe(false);
  });

  it('keeps a fire from the zone you are standing in', () => {
    expect(_relayScopeKeep({ ...OUT, originZones: ['Plane of Hate'], requesterZones: zones('Plane of Hate') })).toBe(true);
  });

  // Either side can have several characters streaming at once; a fire is local
  // when ANY of the sender's zones is ANY of yours.
  it('keeps it when any of your live characters shares any of the sender\'s zones', () => {
    expect(_relayScopeKeep({ ...OUT, originZones: ['The Bazaar', 'Sebilis'], requesterZones: zones('Plane of Hate', 'Sebilis') })).toBe(true);
    expect(_relayScopeKeep({ ...OUT, originZones: zones('Sebilis'), requesterZones: zones('Sebilis') })).toBe(true);
    expect(_relayScopeKeep({ ...OUT, originZones: 'Sebilis', requesterZones: zones('Sebilis') })).toBe(true);   // legacy single string
  });

  describe('⚠ unknown means NOT local (flipped 2026-09-11 on Hitya\'s call)', () => {
    it('drops a fire whose sender cannot be placed', () => {
      expect(_relayScopeKeep({ ...OUT, originZones: [], requesterZones: zones('Plane of Hate') })).toBe(false);
      expect(_relayScopeKeep({ ...OUT, originZones: null, requesterZones: zones('Plane of Hate') })).toBe(false);
      expect(_relayScopeKeep({ ...OUT, originZones: [null], requesterZones: zones('Plane of Hate') })).toBe(false);
    });
    it('drops a fire when we cannot place OURSELVES', () => {
      expect(_relayScopeKeep({ ...OUT, originZones: ['East Commonlands'], requesterZones: zones() })).toBe(false);
      expect(_relayScopeKeep({ ...OUT, originZones: ['East Commonlands'], requesterZones: null })).toBe(false);
    });
    it('drops it when nobody can be placed', () => {
      expect(_relayScopeKeep({ ...OUT, originZones: [], requesterZones: null })).toBe(false);
    });
  });
});

describe('in a raid nothing changes — raid-wide, zones not consulted', () => {
  it('the scheduled window keeps a cross-zone fire — split raids are the normal case', () => {
    expect(_relayScopeKeep({ inRaidWindow: true, inRaid: false, originZones: ['Vex Thal'], requesterZones: zones('Plane of Hate') })).toBe(true);
    expect(_relayScopeKeep({ inRaidWindow: true, inRaid: false, originZones: null, requesterZones: null })).toBe(true);
  });
  it('an off-schedule raid (fresh raid roster from this listener) keeps it too', () => {
    expect(_relayScopeKeep({ inRaidWindow: false, inRaid: true, originZones: ['Vex Thal'], requesterZones: zones('Plane of Hate') })).toBe(true);
    expect(_relayScopeKeep({ inRaidWindow: false, inRaid: true, originZones: [], requesterZones: null })).toBe(true);
  });
});

describe('wiring', () => {
  const bot = stripJs(src);

  it('the ring carries the sender ZONES, resolved from the uploading account — never from a payload field', () => {
    const ingest = sliceBlock(bot, 'async function _handleTriggerRelayPost(req, res) {', '\n  if (_triggerRelay.entries.length > TRIGGER_RELAY_MAX_ENTRIES)');
    expect(ingest).toContain('originZones = [...await _requesterZones(identity.discord_id)];');
    expect(ingest).toContain('origin_zones:        originZones,');
    expect(ingest).not.toMatch(/payload\?\.character/);   // the field no agent sends — the 3.1.111 hole
  });

  it('both poll paths gate through the same resolver', () => {
    expect(bot).toContain('_recentFiresFor(identity, sinceId, lootSinceId, scope)');
    expect(bot).toContain('_recentFiresFor(identity, sinceId, lootSinceId, await _relayScopeFor(identity))');
  });

  it('the filter runs on the ring, beside the own-fire suppression', () => {
    const fn = sliceBlock(bot, 'function _recentFiresFor(', '\n  const loot =');
    expect(fn).toContain('_relayScopeKeep({ inRaidWindow, inRaid, originZones: e.origin_zones, requesterZones })');
  });

  it('resolves window → raid roster → zones, in that order, and each early return skips the rest', () => {
    const fn = sliceBlock(bot, 'async function _relayScopeFor(identity) {', '\nasync function _handleRecentFiresGet');
    const early  = fn.indexOf('if (inRaidWindow) return { inRaidWindow: true, inRaid: true, requesterZones: null };');
    const roster = fn.indexOf('_raidUploaderIds()');
    const rEarly = fn.indexOf('if (inRaid) return { inRaidWindow: false, inRaid: true, requesterZones: null };');
    const lookup = fn.indexOf('_requesterZones(');
    expect(early).toBeGreaterThan(-1);
    expect(roster).toBeGreaterThan(early);
    expect(rEarly).toBeGreaterThan(roster);
    expect(lookup).toBeGreaterThan(rEarly);
    // A failed zone lookup now yields an EMPTY set (not local), not null (which used to pass).
    expect(fn).toContain('catch { requesterZones = new Set(); }');
  });

  it('the raid-roster signal is a bounded, cached read — newest rows, 10-minute freshness, 30s cache', () => {
    // Comment anchor → slice the UNSTRIPPED source, then strip the slice (CLAUDE.md rule).
    const fn = stripJs(sliceBlock(src, 'async function _raidUploaderIds() {', '\n// Assemble the recent-fires payload'));
    expect(fn).toContain("(Date.now() - _raidUploadersCache.at) < 30_000");
    expect(fn).toContain('10 * 60 * 1000');
    expect(fn).toContain('&select=uploaded_by_discord_id&order=captured_at.desc&limit=500');
  });

  // No scope argument = keep everything, so any future caller that forgets it
  // degrades to the pre-gate behaviour rather than muting the guild.
  it('defaults to the pre-gate behaviour when no scope is passed', () => {
    expect(bot).toContain('const inRaidWindow  = scope ? !!scope.inRaidWindow : true;');
    expect(bot).toContain('const inRaid        = scope ? !!scope.inRaid : true;');
  });
});
