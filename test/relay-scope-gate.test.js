// test/relay-scope-gate.test.js — a guild trigger that fires on someone else's
// machine should not speak on yours unless it is relevant to you.
//
// The guild lead, 2026-09-02: "Every so often we hear 'Shaman Slow' when we're not around
// combat. It's a guildwide scope. These should only trigger for local fights or
// during raids, not outside."
//
// The guild lead, 2026-09-11, alone in Vex Thal while a member slowed trash in Ssraeshza:
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
    'function _relayScopeKeep({ inRaidWindow, inRaid, originZones, requesterZones, unplacedWindow = false }) {',
    '\n// character name (lower) → owning discord id.',
  ),
  ['_relayScopeKeep'],
);

const { _inRaidWindowEt } = evalBlock(
  sliceBlock(src, 'function _inRaidWindowEt(now = new Date()) {', '\n// OpenDKP roster, cached 1h'),
  ['_inRaidWindowEt'],
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

// The guild lead, 2026-10-14 00:24 ET (a Tuesday night): a member alone in Overthere heard another group's
// enrage callout from the Bastion of Thunder. The member could not be placed, and the clock said "raid
// evening" because 00:24 on a Wednesday counted as Wednesday.
describe('an unplaced listener on a raid evening', () => {
  const UNPLACED = { inRaidWindow: false, inRaid: false, unplacedWindow: true };
  it('⚠ the report: a sender we CAN place is not heard by a listener we cannot', () => {
    expect(_relayScopeKeep({ ...UNPLACED, originZones: ['Bastion of Thunder'], requesterZones: zones() })).toBe(false);
  });
  it('a sender nobody can place still is (both unknown: fail open, as before)', () => {
    expect(_relayScopeKeep({ ...UNPLACED, originZones: [], requesterZones: zones() })).toBe(true);
    expect(_relayScopeKeep({ ...UNPLACED, originZones: null, requesterZones: null })).toBe(true);
  });
  it('off the raid evening an unplaced sender is dropped again', () => {
    expect(_relayScopeKeep({ ...OUT, originZones: [], requesterZones: zones() })).toBe(false);
  });
  it('the scope resolver sets the flag, never the raid-wide inRaidWindow, for an unplaced listener', () => {
    const fn = stripJs(sliceBlock(src, 'async function _relayScopeFor(identity) {', '\nasync function _handleRecentFiresGet'));
    expect(fn).toContain('return { inRaidWindow: false, unplacedWindow: zones.size === 0 && _inRaidWindowEt(new Date())');
  });
});

describe('the raid evening: the hour after midnight belongs to the night before', () => {
  // ET wall times as UTC instants (EDT = UTC-4 in October 2026).
  const et = (iso) => new Date(iso + '-04:00');
  it('⚠ Wednesday 00:24 is Tuesday night — not a raid', () => {
    expect(_inRaidWindowEt(et('2026-10-14T00:24:00'))).toBe(false);
  });
  it('Thursday 00:30 is Wednesday night — a raid; Friday 00:30 is Thursday night — a raid; Monday 00:30 is Sunday night', () => {
    expect(_inRaidWindowEt(et('2026-10-15T00:30:00'))).toBe(true);
    expect(_inRaidWindowEt(et('2026-10-16T00:30:00'))).toBe(true);
    expect(_inRaidWindowEt(et('2026-10-19T00:30:00'))).toBe(true);
  });
  it('the evenings themselves are unchanged', () => {
    expect(_inRaidWindowEt(et('2026-10-14T19:00:00'))).toBe(true);    // Wed
    expect(_inRaidWindowEt(et('2026-10-14T18:59:00'))).toBe(false);
    expect(_inRaidWindowEt(et('2026-10-13T21:00:00'))).toBe(false);   // Tue
    expect(_inRaidWindowEt(et('2026-10-18T23:30:00'))).toBe(true);    // Sun
    expect(_inRaidWindowEt(et('2026-10-15T01:00:00'))).toBe(false);   // Thu 01:00, window over
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
    expect(fn).toContain('_relayScopeKeep({ inRaidWindow, inRaid, originZones: e.origin_zones, requesterZones, unplacedWindow })');
  });

  // The kill switch's (flag_disable_groupscope) and failed-read path: the pre-2026-10-07 rule, after the
  // raid / group resolver, which test/group-scope.test.js owns.
  it('the old rule resolves window → raid roster → zones, in that order, and each early return skips the rest', () => {
    const fn = sliceBlock(bot, 'async function _relayScopeFor(identity) {', '\nasync function _handleRecentFiresGet');
    const early  = fn.indexOf('if (inRaidWindow) return { inRaidWindow: true, inRaid: true, requesterZones: null };');
    const roster = fn.indexOf('_raidUploaderIds()');
    const rEarly = fn.indexOf('if (inRaid) return { inRaidWindow: false, inRaid: true, requesterZones: null };');
    const lookup = fn.lastIndexOf('_requesterZones(');
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
