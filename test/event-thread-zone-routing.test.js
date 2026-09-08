// test/event-thread-zone-routing.test.js — two events at once, each thread gets
// ITS OWN kills (Hitya, 2026-09-07: "there are two events going on tonight and
// mobs are being posted to each one, instead of specific ones posted per zone").
//
// The fixtures are that night, verbatim: Fargan's "Seru mini for Dongru" and
// "Ring War Ashieron", whose windows overlapped from 20:15. Routing was purely
// nearest-scheduled-start, so past the midpoint between the two starts every
// Seru kill landed in the Ring War thread. Now the kill's ZONE narrows the
// candidates first; the clock only decides what the zone cannot.
//
// Real-imports the bot utils. No Discord, no network — the zone vocabulary is
// built from fixture rows through the same builder production uses.
//
// Run: npx vitest run test/event-thread-zone-routing.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as events from '../utils/raidEvents.js';
import * as raidNight from '../utils/raidNight.js';
import { readSource, BOT_INDEX, ROOT, stripJs } from './_source-slice.js';

const et = (s) => Date.parse(s);

// eqemu_zone rows as [zone_id, short_name, long_name] — the real ids.
const EQEMU = [
  [71,   'airplane',      'Plane of Sky'],
  [1071, 'air_instanced', 'Plane of Sky (Instanced)'],
  [76,   'hateplane',     'Plane of Hate'],
  [118,  'greatdivide',   'The Great Divide'],
  [158,  'vexthal',       'Vex Thal'],
  [159,  'sseru',         'Sanctus Seru'],
  [184,  'load',          'Loading Zone'],
];
const ZONES = [
  { id: 'sanctus_seru', name: 'Sanctus Seru', shortName: 'seru' },
  { id: 'great_divide', name: 'Great Divide', shortName: 'greatdivide', aliases: ['ring war'] },
  { id: 'vex_thal',     name: 'Vex Thal',     shortName: 'vexthal' },
];
const BOSSES = [
  { id: 'lord_inquisitor_seru', name: 'Lord Inquisitor Seru', zone: 'Sanctus Seru', nicknames: ['lis', 'seru'] },
];
const idx = events.buildZoneAliasIndex(EQEMU, ZONES, BOSSES);

// Monday 2026-09-07 — a guild-event night, both entries as posted in #event-chat.
const SERU = {
  id: 'discord:seru', title: 'Seru mini for Dongru',
  description: 'Killing minis bring out your mains. /ran for other loot pick character to roll on. NBG',
  startMs: et('2026-09-07T20:00:00-04:00'), endMs: et('2026-09-07T23:00:00-04:00'),
};
const RING = {
  id: 'discord:ring', title: 'Ring War Ashieron',
  description: 'Directly after Seru Mini heading to Great Divide for Ring war. Same pick character to roll on be on main unless asked for alt. /ran NBG',
  startMs: et('2026-09-07T20:45:00-04:00'), endMs: et('2026-09-07T23:30:00-04:00'),
};
// 21:30 is 45 min from the Ring War start and 90 from the Seru start — the
// clock alone says Ring War for everything.
const T = et('2026-09-07T21:30:00-04:00');

const norm = (e) => events.normalizeEvent({ ...e, source: 'discord' });

let savedTz;
beforeEach(() => {
  savedTz = process.env.TZ_DEFAULT;
  process.env.TZ_DEFAULT = 'America/New_York';
  vi.useFakeTimers({ now: T, toFake: ['Date'] });
  events._resetCache();
  raidNight._resetCache();
  raidNight._setEventsModule(events);
});
afterEach(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ_DEFAULT; else process.env.TZ_DEFAULT = savedTz;
});

describe('the zone vocabulary', () => {
  it('knows the guild\'s own words for a zone, not just the catalog\'s', () => {
    expect(events.zoneIdsInText('Seru', idx)).toEqual([159]);            // zones.json shortName + boss nickname
    expect(events.zoneIdsInText('ring war', idx)).toEqual([118]);        // zones.json alias
    expect(events.zoneIdsInText('Great Divide', idx)).toEqual([118]);    // long name without "The"
    expect(events.zoneIdsInText('The Great Divide', idx)).toEqual([118]);
    expect(events.zoneIdsInText('LIS tonight', idx)).toEqual([159]);     // boss nickname → its zone
  });

  it('folds an instanced twin into its base name, and matches whole phrases only', () => {
    expect(events.zoneIdsInText('Plane of Sky', idx)).toEqual([71, 1071]);
    expect(events.zoneIdsInText('plane', idx)).toEqual([]);              // a token is not a zone
    expect(events.zoneIdsInText('Serulean', idx)).toEqual([]);           // no substring hits
    expect(events.zoneIdsInText('load the raid', idx)).toEqual([]);      // "load" is a zone row, not a place
  });

  it('reads the TITLE first and only falls to the description when the title names nothing', () => {
    // The Ring War description names BOTH zones — a union would have sent
    // every Seru kill back to the Ring War thread. The title settles it.
    expect(events.zoneIdsInText(RING.description, idx)).toEqual([118, 159]);
    expect(events.zoneIdsForEvent(norm(RING), idx)).toEqual([118]);
    expect(events.zoneIdsForEvent(norm(SERU), idx)).toEqual([159]);
    expect(events.zoneIdsForEvent(norm({ ...RING, title: 'Monday thing' }), idx)).toEqual([118, 159]);
    expect(events.zoneIdsForEvent(norm({ id: 'x', title: 'Bingo', description: 'prizes', location: 'Vex Thal', startMs: T, endMs: T + 1 }), idx)).toEqual([158]);
  });

  it('the shipped zones.json carries "ring war" for Great Divide', () => {
    const zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'zones.json'), 'utf8'));
    const gd = zones.find(z => z.id === 'great_divide');
    expect(gd.aliases).toContain('ring war');
  });
});

describe('two events at once — the zone picks the thread', () => {
  const [seru, ring] = events.annotateZones([norm(SERU), norm(RING)], idx);

  it('a Seru kill goes to the Seru thread even when the Ring War start is nearer', () => {
    expect(events.pickEventAt([seru, ring], T, 159).id).toBe('discord:seru');
    expect(events.pickEventAt([ring, seru], T, 159).id).toBe('discord:seru');   // order-independent
  });

  it('a Great Divide kill goes to the Ring War thread', () => {
    expect(events.pickEventAt([seru, ring], T, 118).id).toBe('discord:ring');
  });

  it('an unknown zone keeps today\'s nearest-start rule', () => {
    expect(events.pickEventAt([seru, ring], T).id).toBe('discord:ring');
    expect(events.pickEventAt([seru, ring], T, null).id).toBe('discord:ring');
    expect(events.pickEventAt([seru, ring], T, 0).id).toBe('discord:ring');
  });

  it('a kill in a zone NEITHER names falls to the clock when both name one, and to the un-zoned event when one does not', () => {
    expect(events.pickEventAt([seru, ring], T, 76).id).toBe('discord:ring');     // both named → nearest
    // ⚠ misc starts EARLIER than Seru so the clock alone would pick Seru — a
    // fixture sharing Seru's start let the id tie-break hand this test its
    // answer for free (caught by mutation, 2026-09-07).
    const misc = norm({ id: 'discord:misc', title: 'Monday hangout', startMs: et('2026-09-07T19:30:00-04:00'), endMs: SERU.endMs });
    expect(events.pickEventAt([seru, misc], T).id).toBe('discord:seru');         // the clock says Seru…
    expect(events.pickEventAt([seru, misc], T, 76).id).toBe('discord:misc');     // …but a kill Seru cannot be gets the un-zoned one
    expect(events.pickEventAt([seru, misc], T, 159).id).toBe('discord:seru');    // and a named match still wins
  });

  it('the zone can only narrow — one live event is always returned', () => {
    expect(events.pickEventAt([seru], T, 118).id).toBe('discord:seru');
    expect(events.pickEventAt([seru, ring], et('2026-09-07T12:00:00-04:00'), 159)).toBe(null);
  });
});

describe('planFor carries the zone through to the pick', () => {
  const client = { user: { id: 'bot' } };
  const seed = () => events._seed([
    { ...SERU, source: 'discord', zoneIds: [159] },
    { ...RING, source: 'discord', zoneIds: [118] },
  ], Date.now());

  it('threads a Seru kill under the Seru event and a Divide kill under the Ring War', async () => {
    seed();
    const a = await raidNight.planFor(client, T, 159);
    const b = await raidNight.planFor(client, T, 118);
    expect(a.kind).toBe('event');
    expect(a.key).toBe('evt_discord_seru');
    expect(a.name).toBe('🎲 Seru mini for Dongru — Monday, September 7, 2026');
    expect(b.key).toBe('evt_discord_ring');
    expect(a.why).toMatch(/kill in zone 159/);
    expect(a.why).toMatch(/event zones 159/);
  });

  it('without a zone it is the clock, exactly as before', async () => {
    seed();
    expect((await raidNight.planFor(client, T)).key).toBe('evt_discord_ring');
  });

  it('getRaidNightTarget hands the zone to planFor', async () => {
    seed();
    const spy = vi.spyOn(events, 'activeEventAt');
    await raidNight.getRaidNightTarget(null, T, 159);          // null client → early return, no Discord
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const plan = await raidNight.planFor(client, T, 159);
    expect(plan.event.id).toBe('discord:seru');
  });
});

describe('the wiring in index.js and the Discord fetch', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  const ev  = stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'raidEvents.js'), 'utf8'));

  it('the parse-card post passes the kill\'s zone into the thread lookup', () => {
    expect(bot).toMatch(/const _zoneId = await _killZoneId\(encounter\.boss_name, character\)\.catch\(\(\) => null\);/);
    expect(bot).toMatch(/getRaidNightTarget\(client, startedMs, _zoneId\)/);
  });

  it('_killZoneId tries the curated boss\'s zone, then the uploader\'s live zone', () => {
    const fn = bot.slice(bot.indexOf('async function _killZoneId('), bot.indexOf('\n}\n', bot.indexOf('async function _killZoneId(')));
    expect(fn).toMatch(/findBossFromName\(bossName, getBosses\(\)\)/);
    expect(fn).toMatch(/zoneIdsForText\(b\.zone\)/);
    expect(fn).toMatch(/_liveZoneMap\(\)\)\.get\(/);
    expect(fn).toMatch(/return null;\s*$/);
  });

  it('the Discord fetch reads the description and the location the zone is parsed from', () => {
    expect(ev).toMatch(/description: e\?\.description,/);
    expect(ev).toMatch(/location:\s+e\?\.entityMetadata\?\.location,/);
  });

  it('the refresh annotates zones before the sticky map remembers them', () => {
    const refresh = ev.slice(ev.indexOf('async function _refresh('), ev.indexOf('async function knownEvents('));
    const ann = refresh.indexOf('annotateZones(merged, index)');
    const rem = refresh.indexOf('_rememberAll(merged, nowMs)');
    expect(ann).toBeGreaterThan(-1);
    expect(rem).toBeGreaterThan(ann);
  });
});
