// test/raid-timeline-load.test.js: web/lib/raidTimelineLoad.ts, the boss deaths the raid timeline strip draws.
//
// The 2026-10-28 report: a shared session of another guild's raid (our raiders along) read "No boss has died yet". Its
// three boss kills were stamped classification 'live' by the bot (most fighters not on our roster) and the loader kept
// only unclassified rows. Pinned here on a hand-built night:
//   - our own timeline (spectator, live) still shows unclassified kills only: a guest raid never reaches OUR strip;
//   - a share (guestRaids) also keeps 'live' and 'foreign' kills, tagged `other`, and still drops a wipe, a PvP row,
//     a test pull, an unconfirmed fight, another guild's database rows, an uncurated mob and anything outside the window;
//   - the zone on the encounter row is never read, so a wrong or empty zone_short cannot drop a kill;
//   - the share route is the only caller that asks for guest raids.
//
// Boss names and ids are the catalog's; there are no people in here.
// Run: npx vitest run test/raid-timeline-load.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from './_fake-supabase-js.js';
import { loadTimelineKills } from '../web/lib/raidTimelineLoad.ts';
import { ROOT, stripJs } from './_source-slice.js';

const G = 'g';
const SERU = 159000, TERRIS = 204483, AERIN = 208074, LORD_OF_IRE = 76325, TRASH = 221005, NOT_CURATED = 221041;
const T = (min) => new Date(Date.UTC(2026, 9, 28, 12, min, 0)).toISOString();
const SINCE = T(0), UNTIL = T(120);

let n = 0;
const enc = (npc, min, extra = {}) => ({
  id: `e${String(++n).padStart(3, '0')}`, guild_id: G, npc_id: npc, ended_at: T(min), classification: null, is_wipe: false,
  zone_short: null, eqemu_npc_types: { name: `Mob_${npc}` }, ...extra,
});

function world(encounters) {
  return fakeSupabase({
    tables: {
      encounters,
      bosses_local: [SERU, TERRIS, AERIN, LORD_OF_IRE].map(npc_id => ({ npc_id, auto_registered: false })).concat([{ npc_id: TRASH, auto_registered: true }]),
    },
  });
}
const ids = (kills) => kills.map(k => k.npc_id);

describe('whose kills the strip draws', () => {
  const night = () => [
    enc(SERU, 10, { classification: 'live' }),
    enc(TERRIS, 40, { classification: 'live', zone_short: 'ponightmare' }),
    enc(AERIN, 70, { classification: 'live', zone_short: 'postorms' }),   // a zone the boss is not in
    enc(LORD_OF_IRE, 80, { classification: 'foreign' }),
    enc(SERU, 90),                                                         // one of ours, no mark
  ];

  it('our own strip keeps unclassified kills only', async () => {
    const kills = await loadTimelineKills(world(night()), SINCE, UNTIL, G);
    expect(ids(kills)).toEqual([SERU]);
    expect(kills[0].other).toBeUndefined();
  });

  it('a share keeps the guest raid\'s live and foreign kills, tagged as another guild\'s, in time order', async () => {
    const kills = await loadTimelineKills(world(night()), SINCE, UNTIL, G, { guestRaids: true });
    expect(ids(kills)).toEqual([SERU, TERRIS, AERIN, LORD_OF_IRE, SERU]);
    expect(kills.map(k => k.other === true)).toEqual([true, true, true, true, false]);
    expect(kills.map(k => k.at)).toEqual([...kills.map(k => k.at)].sort((a, b) => a - b));
  });

  it('a share still never draws a wipe, a PvP row, a test pull, or a wipe that carries another mark', async () => {
    const rows = [
      enc(SERU, 10, { classification: 'wipe', is_wipe: true }),
      enc(TERRIS, 20, { classification: 'pvp' }),
      enc(AERIN, 30, { classification: 'test' }),
      enc(LORD_OF_IRE, 40, { classification: 'foreign', is_wipe: true }),
    ];
    expect(await loadTimelineKills(world(rows), SINCE, UNTIL, G, { guestRaids: true })).toEqual([]);
  });

  it('a share stays inside its window, its guild, the confirmed fights and the curated bosses', async () => {
    const rows = [
      enc(SERU, 10, { classification: 'live', guild_id: 'someone_else' }),
      enc(TERRIS, 20, { classification: 'live', ended_at: null }),
      enc(AERIN, 130, { classification: 'live' }),                          // after the window
      enc(TRASH, 30, { classification: 'live' }),                           // auto-registered: not a boss
      enc(NOT_CURATED, 35, { classification: 'live' }),                     // no bosses_local row at all
      enc(LORD_OF_IRE, 50, { classification: 'live' }),                     // the one that belongs
    ];
    expect(ids(await loadTimelineKills(world(rows), SINCE, UNTIL, G, { guestRaids: true }))).toEqual([LORD_OF_IRE]);
  });

  it('never reads the encounter\'s zone: a wrong or empty zone_short cannot drop a kill', async () => {
    const rows = [enc(TERRIS, 10, { zone_short: 'postorms' }), enc(AERIN, 20, { zone_short: null }), enc(SERU, 30, { zone_short: 'nightmareb' })];
    const fake = world(rows);
    expect(ids(await loadTimelineKills(fake, SINCE, UNTIL, G))).toEqual([TERRIS, AERIN, SERU]);
    expect(fake.requests.flatMap(r => r.filters).some(f => f.startsWith('zone_short'))).toBe(false);
  });
});

describe('who asks for guest raids', () => {
  const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

  it('the share route does, with the row\'s own guild; the members\' routes do not', () => {
    expect(read('web/app/api/share/raid/[token]/timeline/route.ts')).toMatch(/share\.row\.guild_id,\s*\{\s*guestRaids:\s*true\s*\}/);
    expect(read('web/app/api/spectator/timeline/route.ts')).not.toMatch(/guestRaids/);
    expect(read('web/lib/liveRaidLoad.ts')).not.toMatch(/guestRaids/);
  });
});
