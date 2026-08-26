// The autobid gate — the single most dangerous predicate in the bidding
// feature, because getting it wrong spends someone else's DKP while they are
// not looking. Almost every test here is a NEGATIVE case.
//
// Hitya set it in two passes, and the second corrected my first build:
//   "you have to be in the raid for it to fire"
//   "one of your characters needs to be in the raid currently OR have been on a
//    tick so far that night"
//
// Both halves were wrong in v1: it checked only the BIDDING character (so the
// normal case — main in the raid, bidding for an alt — was refused), and only
// the live roster (so someone who raided the first two hours and logged was
// refused the loot they had just earned the DKP for).
//
// Run: npx vitest run test/autobid-raid-gate.test.js
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _AUTOBID_ROSTER_FRESH_MS',
  "return { ok: false, reason: 'gate lookup failed: ' + (err && err.message) };\n  }\n}",
);

// now = Wed 2026-08-26 21:00 ET (a raid night, mid-raid).
const NOW = new Date('2026-08-27T01:00:00Z');
const FAMILY = [
  { name: 'Hitya',    main_name: null },
  { name: 'Uilnayar', main_name: 'Hitya' },
  { name: 'Canopy',   main_name: 'Hitya' },
  { name: 'Stranger', main_name: null },
];

function build({ roster = [], raids = [], ticks = [], chars = FAMILY, enabled = true, throws = null } = {}) {
  const calls = [];
  const harness = `
    const require = (m) => ({
      isEnabled: () => ${enabled},
      async select(table, q) {
        calls.push({ table, q });
        if (${JSON.stringify(throws)} && table === ${JSON.stringify(throws)}) throw new Error('boom');
        if (table === 'characters')     return ${JSON.stringify(chars)};
        if (table === 'raid_roster')    return ${JSON.stringify(roster)};
        if (table === 'opendkp_raids')  return ${JSON.stringify(raids)};
        if (table === 'opendkp_ticks')  return ${JSON.stringify(ticks)};
        return [];
      },
    });
    const process = { env: {} };
  ` + block + `
    return { _familyInRaidTonight, _raidNightStartIso, _bidFamilyNamesFor, calls };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('calls', harness)(calls);
}

const RAID = [{ raid_id: 412 }];

describe('family scope — "one of YOUR characters"', () => {
  it('fires when a DIFFERENT family member is in the raid', async () => {
    // The normal case: main is standing in the raid, you are bidding for an alt.
    // v1 refused this outright.
    const h = build({ roster: [{ name: 'Hitya' }] });
    const r = await h._familyInRaidTonight('Canopy', { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('roster');
    expect(r.character).toBe('Hitya');
  });

  it('does NOT fire for someone outside the family', async () => {
    const h = build({ roster: [{ name: 'Stranger' }] });
    expect((await h._familyInRaidTonight('Canopy', { now: NOW })).ok).toBe(false);
  });

  it('matches family names case-insensitively', async () => {
    const h = build({ roster: [{ name: 'uILNAYAR' }] });
    expect((await h._familyInRaidTonight('Hitya', { now: NOW })).ok).toBe(true);
  });

  it('still checks the character itself when it is unknown to us', async () => {
    // A character missing from `characters` must check ITSELF, not nothing.
    const h = build({ roster: [{ name: 'Ghost' }], chars: [] });
    expect((await h._familyInRaidTonight('Ghost', { now: NOW })).ok).toBe(true);
  });
});

describe('"or have been on a tick so far that night"', () => {
  it('fires on a tick even when nobody is in the roster now', async () => {
    // Raided the first two hours, took ticks, then logged. Still owed the loot.
    const h = build({ roster: [], raids: RAID, ticks: [{ tick_id: 9, attendees: ['Uilnayar', 'Someone'] }] });
    const r = await h._familyInRaidTonight('Canopy', { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('tick');
  });

  it('does NOT fire on a tick that contains only strangers', async () => {
    const h = build({ roster: [], raids: RAID, ticks: [{ tick_id: 9, attendees: ['Stranger'] }] });
    expect((await h._familyInRaidTonight('Canopy', { now: NOW })).ok).toBe(false);
  });

  it('scopes ticks to TONIGHT via the raid ts, not the mirror fetched_at', () => {
    // opendkp_ticks has no tick timestamp; fetched_at is OUR sync time and is
    // never an ordering key (the bot 3.1.33 lesson).
    const h = build({ roster: [], raids: RAID, ticks: [] });
    return h._familyInRaidTonight('Canopy', { now: NOW }).then(() => {
      const raidQ = h.calls.find(c => c.table === 'opendkp_raids');
      expect(raidQ.q).toContain('ts=gte.');
      const tickQ = h.calls.find(c => c.table === 'opendkp_ticks');
      expect(tickQ.q).not.toContain('fetched_at');
    });
  });

  it('refuses when there was no raid tonight at all', async () => {
    const h = build({ roster: [], raids: [], ticks: [{ tick_id: 9, attendees: ['Hitya'] }] });
    const r = await h._familyInRaidTonight('Hitya', { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no raid tonight/);
  });
});

describe('the raid-night boundary', () => {
  const inEt = (h, iso) => new Date(h._raidNightStartIso(new Date(iso)))
    .toLocaleString('en-US', { timeZone: 'America/New_York' });

  it('does not cut a past-midnight raid in half', async () => {
    // A calendar-day boundary would refuse everyone still standing there at
    // 00:30, which is exactly when the last loot goes up.
    const h = build({});
    expect(inEt(h, '2026-08-27T04:30:00Z')).toContain('8/26/2026');   // Thu 00:30 ET
    expect(inEt(h, '2026-08-27T01:00:00Z')).toContain('8/26/2026');   // Wed 21:00 ET
  });

  it('rolls forward once the next day is properly under way', async () => {
    const h = build({});
    expect(inEt(h, '2026-08-27T18:00:00Z')).toContain('8/26/2026');   // Thu 14:00 ET -> still Wed 6pm
    expect(inEt(h, '2026-08-28T01:00:00Z')).toContain('8/27/2026');   // Thu 21:00 ET -> Thu 6pm
  });
});

describe('fails closed', () => {
  it('refuses when the roster is empty and there are no ticks', async () => {
    // The INVERSION: the agent's trigger gate falls OPEN here. Autobid must not.
    const h = build({ roster: [], raids: RAID, ticks: [] });
    expect((await h._familyInRaidTonight('Hitya', { now: NOW })).ok).toBe(false);
  });

  it('refuses when a lookup throws — a failure is not permission', async () => {
    for (const table of ['raid_roster', 'opendkp_raids', 'opendkp_ticks']) {
      const h = build({ roster: [], raids: RAID, ticks: [], throws: table });
      expect((await h._familyInRaidTonight('Hitya', { now: NOW })).ok, table).toBe(false);
    }
  });

  it('refuses when Supabase is disabled', async () => {
    const h = build({ enabled: false });
    expect((await h._familyInRaidTonight('Hitya', { now: NOW })).ok).toBe(false);
  });

  it('refuses an empty or missing character name', async () => {
    const h = build({ roster: [{ name: 'Hitya' }] });
    for (const bad of ['', '   ', null, undefined]) {
      expect((await h._familyInRaidTonight(bad, { now: NOW })).ok, String(bad)).toBe(false);
    }
  });

  it('a family lookup failure narrows to the character, never widens', async () => {
    // If we cannot resolve the family we must check fewer names, not more.
    const h = build({ roster: [{ name: 'Uilnayar' }], throws: 'characters' });
    expect((await h._familyInRaidTonight('Canopy', { now: NOW })).ok).toBe(false);
  });
});
