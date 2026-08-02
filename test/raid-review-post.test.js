// test/raid-review-post.test.js — [#80] Raid Night Review.
//
// Sibling to test/raid-night-events.test.js, which pins the thread machinery
// itself. This file pins the THREE things adding the review could break, plus
// the composition:
//
//   (a) the midnight chain still runs its existing steps, in order, with the
//       review appended (source-slice against the real index.js — so renaming
//       or reordering a step fails here loudly instead of silently);
//   (b) the review is isolated — scheduleRaidNightReview / catchUpRaidNightReview
//       never throw and never await, and postRaidNightReview never rejects, so a
//       broken review cannot stop archives / parse consolidation / resets;
//   (c) thread resolution REUSES the night's existing thread — the review
//       anchors on the night's FIRST ENCOUNTER, not on "now", and never calls
//       threads.create when the thread already exists.
//
// Real-imports the bot utils. No Discord, no network.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as events from '../utils/raidEvents.js';
import * as raidNight from '../utils/raidNight.js';
import { readSource, sliceBlock, BOT_INDEX, ROOT } from './_source-slice.js';

const raidReview = require('../utils/raidReview.js');
const { dedupParseDeaths } = require('../utils/parseDeaths.js');

const TZ = 'America/New_York';
const et = (s) => Date.parse(s);

// The real Thursday raid this feature was built against: Ssraeshza Temple,
// 2026-07-30 20:40 → 23:37 ET. Fixture is a trimmed copy of the shape
// collectNightData returns.
const RAID_EVENT = {
  id: 'discord:1', title: 'SSRA',
  startMs: et('2026-07-30T20:30:00-04:00'), endMs: et('2026-07-30T23:30:00-04:00'),
};
const FIRST_PULL = et('2026-07-30T20:40:07-04:00');
const NIGHT_NAME = '🗡️ Raid Night — Thursday, July 30, 2026';

function enc(over = {}) {
  return {
    id: 'e1', started_at: new Date(FIRST_PULL).toISOString(),
    ended_at: new Date(FIRST_PULL + 148_000).toISOString(),
    duration_sec: 148, total_damage: 299207, total_dps: 2023,
    zone_short: 'ssratemple', npc_id: 162037, classification: null,
    eqemu_npc_types: { name: '#a_glyph_covered_serpent', zone_short: null },
    encounter_players: [
      { character_name: 'Jankzer', total_damage: 60000, dps: 405, rank: 1 },
      { character_name: 'Hitya',   total_damage: 40000, dps: 270, rank: 2 },
      { character_name: 'Shavimo', total_damage: 30000, dps: 202, rank: 3 },
    ],
    ...over,
  };
}

const CHARACTERS = [
  { name: 'Jankzer', class: 'Necromancer', exclude_from_stats: false },
  { name: 'Hitya',   class: 'Monk',        exclude_from_stats: false },
  { name: 'Shavimo', class: 'Shaman',      exclude_from_stats: false },
  { name: 'Benched', class: 'Wizard',      exclude_from_stats: true  },
];

function nightData(over = {}) {
  return {
    window: raidReview.nightWindowFor(FIRST_PULL),
    encounters: [enc()],
    deathContribs: [],
    characters: CHARACTERS,
    zones: [{ short_name: 'ssratemple', long_name: 'Ssraeshza Temple' }],
    loot: [], ticks: [], funEvents: [], history: [], uploaders: 3,
    ...over,
  };
}

const ENV_KEYS = [
  'TZ_DEFAULT', 'RAID_REVIEW', 'RAID_REVIEW_DELAY_MIN', 'RAID_REVIEW_CATCHUP_HOURS',
  'RAID_REVIEW_MIN_KILLS', 'RAID_NIGHT_ROLLOVER_HOUR', 'RAID_NIGHT_THREAD_PARENT_ID',
  'RAID_NIGHT_THREAD_ID', 'RAID_NIGHT_FALLBACK', 'WEB_BASE_URL', 'DISCORD_GUILD_ID',
];
let saved;
// utils/state.js writes data/state.json from a hard-coded path, and
// raidNight._resolve touches it. Snapshot + restore so the suite is hermetic
// and starts from a KNOWN-empty state (a stale rn_ slot would otherwise
// short-circuit the by-name adoption this file is here to prove).
const STATE_FILE = path.join(ROOT, 'data', 'state.json');
let savedState = null, hadState = false;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.TZ_DEFAULT = TZ;
  hadState = fs.existsSync(STATE_FILE);
  savedState = hadState ? fs.readFileSync(STATE_FILE, 'utf8') : null;
  try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(STATE_FILE, '{}');
  // Freeze the clock mid-raid-night. The fixtures use ABSOLUTE dates and the
  // sticky event map prunes entries >24h past their end against Date.now() —
  // without this the suite would start failing 24h after it was written (the
  // exact trap test/raid-night-events.test.js documents). Only Date is faked;
  // timers stay real so the deferred-post timer can't hang anything.
  vi.useFakeTimers({ now: et('2026-07-30T21:00:00-04:00'), toFake: ['Date'] });
  events._resetCache();
  raidNight._resetCache();
  raidNight._setEventsModule(events);
  raidReview._clearTimer();
  // raidReview require()s utils/raidNight; this file imports it as ESM. Those
  // are DIFFERENT module instances under vitest, so the seeded events would not
  // reach the copy the review uses — inject the instance this test drives.
  raidReview._setDeps({ raidNight });
});
afterEach(() => {
  raidReview._clearTimer();
  raidReview._setDeps({});
  vi.useRealTimers();
  if (hadState) fs.writeFileSync(STATE_FILE, savedState);
  else { try { fs.unlinkSync(STATE_FILE); } catch { /* never existed */ } }
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

// ── (a) the midnight chain ───────────────────────────────────────────────────

describe('(a) the midnight chain keeps its existing steps, in order', () => {
  const src = readSource(BOT_INDEX);
  const chain = sliceBlock(src, 'async function runMidnightTasks()', "console.log('✅ Midnight tasks complete')");

  it('runs every pre-existing step in the same order', () => {
    // The chain as it shipped BEFORE #80. Each marker must still be present and
    // still be in this relative order.
    const STEPS = [
      'const summaryEmbed = buildDailySummaryEmbed(',
      'await historyThread.send({ embeds: [summaryEmbed] })',
      'resetDailyKills()',
      'clearRaidNight()',
      'await archivePassedAnnounceThreads(readyClient)',
      'await postPvpMidnightSummary(readyClient)',
      'await archiveRaidSession(readyClient)',
      'await consolidateNightlyParses(readyClient)',
      'await computeHotDiceNightAward()',
      "supabase.update(\n            'contributions'",
      "'encounter_threat_snapshots'",
      "supabase.del('buff_casts'",
      "supabase.del('raid_roster'",
      "supabase.rpc('prune_who_observations'",
    ];
    let at = -1;
    for (const step of STEPS) {
      const i = chain.indexOf(step);
      expect(i, `midnight step missing or reordered: ${step}`).toBeGreaterThan(at);
      at = i;
    }
  });

  it('appends the review LAST, and as a non-awaited, try/caught schedule', () => {
    const i = chain.indexOf('scheduleRaidNightReview');
    expect(i, 'the review is not wired into the midnight chain').toBeGreaterThan(-1);
    // After every pre-existing step…
    expect(i).toBeGreaterThan(chain.indexOf("supabase.rpc('prune_who_observations'"));
    // …inside a try/catch…
    const block = chain.slice(chain.lastIndexOf('try {', i), i + 200);
    expect(block).toMatch(/catch\s*\(/);
    // …and NOT awaited: the chain must never block on the review.
    expect(chain).not.toMatch(/await\s+[^\n]*scheduleRaidNightReview/);
    expect(chain).not.toMatch(/await\s+[^\n]*postRaidNightReview/);
  });

  it('arms a boot catch-up outside the chain body', () => {
    const boot = sliceBlock(src, 'function scheduleMidnightSummary(readyClient)', '\n// ── Archive passed announce threads at midnight');
    expect(boot).toMatch(/catchUpRaidNightReview\(readyClient\)/);
  });
});

// ── (b) isolation: a broken review cannot break the chain ────────────────────

describe('(b) the review is isolated from everything around it', () => {
  it('scheduleRaidNightReview never throws, whatever it is handed', () => {
    expect(() => raidReview.scheduleRaidNightReview(null)).not.toThrow();
    expect(raidReview.scheduleRaidNightReview(null).scheduled).toBe(false);
    // A client that explodes on any property access.
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    expect(() => raidReview.scheduleRaidNightReview(hostile)).not.toThrow();
    process.env.RAID_REVIEW_DELAY_MIN = 'not-a-number';
    expect(() => raidReview.scheduleRaidNightReview({ user: {} })).not.toThrow();
  });

  it('catchUpRaidNightReview never throws even when state is broken', () => {
    raidReview._setDeps({ raidNight, state: { getRaidReviewMessageId() { throw new Error('no volume'); } } });
    expect(() => raidReview.catchUpRaidNightReview({ user: {} })).not.toThrow();
  });

  it('a chain whose review link fails still completes every later step', async () => {
    // Miniature of runMidnightTasks: recorded steps around the REAL review link,
    // wrapped exactly the way index.js wraps it.
    const ran = [];
    const step = (n) => { ran.push(n); };
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    async function chain() {
      step('archives');
      step('consolidate');
      try { raidReview.scheduleRaidNightReview(hostile); }
      catch (err) { ran.push('review-threw:' + err.message); }
      step('resets');
      return 'complete';
    }
    await expect(chain()).resolves.toBe('complete');
    expect(ran).toEqual(['archives', 'consolidate', 'resets']);
  });

  it('postRaidNightReview resolves { ok:false } instead of rejecting when the fetch blows up', async () => {
    raidReview._setDeps({ raidNight, collect: async () => { throw new Error('supabase down'); } });
    const res = await raidReview.postRaidNightReview({ user: {} }, { atMs: FIRST_PULL });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('error');
  });

  it('an empty night posts nothing at all', async () => {
    raidReview._setDeps({ raidNight, collect: async () => nightData({ encounters: [] }) });
    const res = await raidReview.postRaidNightReview({ user: {} }, { atMs: FIRST_PULL });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-kills');
  });

  it('RAID_REVIEW=0 is a real kill switch for the automatic post', () => {
    process.env.RAID_REVIEW = '0';
    expect(raidReview.scheduleRaidNightReview({ user: {} }).scheduled).toBe(false);
    expect(raidReview.catchUpRaidNightReview({ user: {} }).scheduled).toBe(false);
  });
});

// ── (c) thread reuse ─────────────────────────────────────────────────────────

function fakeDiscord() {
  const sent = [];
  const edited = [];
  const thread = {
    id: 'THREAD_NIGHT', name: NIGHT_NAME,
    send: async (payload) => { sent.push(payload); return { id: 'MSG1', edit: async () => {} }; },
    messages: { fetch: async (id) => (id === 'MSG1' ? { id: 'MSG1', edit: async (p) => { edited.push(p); } } : null) },
  };
  const parent = {
    id: 'PARENT',
    threads: {
      create: vi.fn(async ({ name }) => ({ id: 'THREAD_NEW', name, send: async () => ({ id: 'X' }), messages: { fetch: async () => null } })),
      fetchActive: async () => ({ threads: [thread] }),
    },
  };
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id) => (id === 'PARENT' ? parent : (id === thread.id ? thread : null)) },
  };
  return { client, parent, thread, sent, edited };
}

describe('(c) the review lands in the night thread that already exists', () => {
  it('planFor with the FIRST-ENCOUNTER ts resolves the night thread; "now" at 00:45 would not', async () => {
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const client = { user: { id: 'bot' } };

    const fromPull = await raidNight.planFor(client, FIRST_PULL);
    expect(fromPull.name).toBe(NIGHT_NAME);
    expect(fromPull.why).toMatch(/raid event "SSRA"/);   // the EVENT window, not the weekday fallback

    // 00:45 the next morning — the event window (end +15m) has closed. Even when
    // the weekday fallback still produces a raid plan, it is a DIFFERENT code
    // path; anchoring on "now" is what could mint a second thread. Pinning the
    // property that matters: the review's anchor reproduces the event plan.
    const fromNow = await raidNight.planFor(client, et('2026-07-31T00:45:00-04:00'));
    expect(fromNow?.why || '').not.toMatch(/raid event/);
  });

  it('adopts the existing thread by name — threads.create is never called', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, parent, sent } = fakeDiscord();
    const slots = new Map();
    raidReview._setDeps({
      raidNight,
      collect: async () => nightData(),
      state: {
        getRaidReviewMessageId: (k) => slots.get(k) || null,
        setRaidReviewMessageId: (k, v) => slots.set(k, v),
      },
    });

    const res = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(res.ok).toBe(true);
    expect(res.reason).toBe('posted');
    expect(res.threadId).toBe('THREAD_NIGHT');
    expect(parent.threads.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].embeds[0].toJSON().title).toBe('📓 Raid Night Review — Thursday, July 30, 2026');
  });

  it('a second run EDITS the same message instead of posting a twin', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, parent, sent, edited } = fakeDiscord();
    const slots = new Map();
    raidReview._setDeps({
      raidNight,
      collect: async () => nightData(),
      state: {
        getRaidReviewMessageId: (k) => slots.get(k) || null,
        setRaidReviewMessageId: (k, v) => slots.set(k, v),
      },
    });

    await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    const again = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(again.reason).toBe('edited');
    expect(sent).toHaveLength(1);
    expect(edited).toHaveLength(1);
    expect(parent.threads.create).not.toHaveBeenCalled();
  });

  it('an off-night EVENT thread gets no review', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    const social = { id: 'discord:2', title: 'Bingo Night', source: 'discord',
      startMs: et('2026-07-31T21:00:00-04:00'), endMs: et('2026-07-31T23:00:00-04:00') };
    const socialPull = et('2026-07-31T21:30:00-04:00');
    events._seed([social], socialPull);
    const { client } = fakeDiscord();
    raidReview._setDeps({
      raidNight,
      collect: async () => nightData({
        window: raidReview.nightWindowFor(socialPull),
        encounters: [enc({ started_at: new Date(socialPull).toISOString(), ended_at: new Date(socialPull + 148_000).toISOString() })],
      }),
    });
    const res = await raidReview.postRaidNightReview(client, { atMs: socialPull });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('event-night');
  });
});

// ── The night window ─────────────────────────────────────────────────────────

describe('the night window spans midnight, like the thread key', () => {
  it('a 23:50 kill and a 00:20 kill share one window and one key', () => {
    const a = raidReview.nightWindowFor(et('2026-07-30T23:50:00-04:00'));
    const b = raidReview.nightWindowFor(et('2026-07-31T00:20:00-04:00'));
    expect(b.nightKey).toBe(a.nightKey);
    expect(b.fromMs).toBe(a.fromMs);
    expect(a.dateKey).toBe('2026-07-30');
    expect(a.label).toBe('Thursday, July 30, 2026');
    // rollover 06:00 ET → 06:00 ET
    expect(new Date(a.fromMs).toISOString()).toBe('2026-07-30T10:00:00.000Z');
    expect(a.toMs - a.fromMs).toBe(24 * 3_600_000);
  });

  it('mostRecentReviewableNight waits for the post time, then steps back a day', () => {
    // 00:20 Friday — still inside Thursday's window and BEFORE the 00:45 post
    // time, so the reviewable night is Wednesday, not Thursday-in-progress.
    const early = raidReview.mostRecentReviewableNight(et('2026-07-31T00:20:00-04:00'));
    expect(early.dateKey).toBe('2026-07-29');
    // 00:50 Friday — past the post time, Thursday is now reviewable.
    const late = raidReview.mostRecentReviewableNight(et('2026-07-31T00:50:00-04:00'));
    expect(late.dateKey).toBe('2026-07-30');
    // The horizon guard: a night that ended longer ago than the horizon is not
    // re-posted on boot. (09:00 Friday is 9h past Thursday's midnight.)
    const at9am = et('2026-07-31T09:00:00-04:00');
    expect(raidReview.mostRecentReviewableNight(at9am, { horizonHours: 1 })).toBe(null);
    expect(raidReview.mostRecentReviewableNight(at9am, { horizonHours: 36 }).dateKey).toBe('2026-07-30');
    // 0 disables it entirely (the /raidreview default-date path).
    expect(raidReview.mostRecentReviewableNight(at9am, { horizonHours: 0 }).dateKey).toBe('2026-07-30');
  });
});

// ── Composition ──────────────────────────────────────────────────────────────

describe('composition', () => {
  it('counts kills, damage and raiders, and names the standouts', () => {
    const sum = raidReview.summarizeNight(nightData());
    expect(sum.kills).toHaveLength(1);
    expect(sum.kills[0].boss).toBe('a glyph covered serpent');   // # and _ cleaned
    expect(sum.totalDamage).toBe(299207);
    expect(sum.raiders).toBe(3);
    expect(sum.topDamage.name).toBe('Jankzer');
    expect(sum.bestFight.name).toBe('Jankzer');
  });

  it('counts only ROSTER names — a pet never takes the top-damage crown', () => {
    const withPet = enc({
      encounter_players: [
        { character_name: 'Xebab',   total_damage: 900000, dps: 6000, rank: 1 },  // pet, not on the roster
        { character_name: 'Jankzer', total_damage: 60000,  dps: 405,  rank: 2 },
      ],
    });
    const sum = raidReview.summarizeNight(nightData({ encounters: [withPet] }));
    expect(sum.raiders).toBe(1);
    expect(sum.topDamage.name).toBe('Jankzer');
  });

  it('honours exclude_from_stats', () => {
    const withExcluded = enc({
      encounter_players: [
        { character_name: 'Benched', total_damage: 900000, dps: 6000, rank: 1 },
        { character_name: 'Jankzer', total_damage: 60000,  dps: 405,  rank: 2 },
      ],
    });
    const sum = raidReview.summarizeNight(nightData({ encounters: [withExcluded] }));
    expect(sum.topDamage.name).toBe('Jankzer');
    expect(sum.raiders).toBe(1);
  });

  it('drops a foreign raid the same way /parses auto-hides it', () => {
    const pug = enc({
      id: 'e2',
      encounter_players: Array.from({ length: 12 }, (_, i) => ({
        character_name: `Stranger${'abcdefghijkl'[i]}`, total_damage: 1000, dps: 10, rank: i + 1,
      })),
    });
    const sum = raidReview.summarizeNight(nightData({ encounters: [enc(), pug] }));
    expect(sum.kills.map(k => k.id)).toEqual(['e1']);
  });

  it('uses the SAME death dedup as the parse card (#134), then collapses across encounters', () => {
    const t = FIRST_PULL + 10_000;
    const iso = (ms) => new Date(ms).toISOString();
    // Three parsers see one Hitya death (clock skew), and one parser reports
    // "Shavimo" twice — the NPC-namesake phantom rule drops Shavimo entirely.
    const contribs = [
      { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(t),        class: 'Monk' },
                                     { name: 'Shavimo', ts: iso(t + 1000), class: null },
                                     { name: 'Shavimo', ts: iso(t + 90_000), class: null }] },
      { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(t + 2000), class: 'Monk' }] },
      { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(t + 3000), class: 'Monk' }] },
    ];
    // The shared helper agrees, so the review never invents a fourth count.
    const shared = dedupParseDeaths(contribs.map(c => c.deaths));
    expect(shared.map(r => r.name)).toEqual(['Hitya']);
    expect(shared[0].count).toBe(1);

    const sum = raidReview.summarizeNight(nightData({ deathContribs: contribs }));
    expect(sum.deaths.map(d => d.name)).toEqual(['Hitya']);
    expect(sum.worstFights).toEqual([{ boss: 'a glyph covered serpent', deaths: 1 }]);
  });

  it('the same death seen in two overlapping encounters counts once', () => {
    const t = FIRST_PULL + 10_000;
    const iso = (ms) => new Date(ms).toISOString();
    const second = enc({ id: 'e2', npc_id: 162039, eqemu_npc_types: { name: '#Vyzh`dra_the_Exiled', zone_short: null } });
    const sum = raidReview.summarizeNight(nightData({
      encounters: [enc(), second],
      deathContribs: [
        { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(t),          class: 'Monk' }] },
        { encounter_id: 'e2', deaths: [{ name: 'Hitya', ts: iso(t + 20_000), class: 'Monk' }] },
      ],
    }));
    expect(sum.deaths).toHaveLength(1);
  });

  it('a class-less death is a pet and stays off the raider list', () => {
    const iso = (ms) => new Date(ms).toISOString();
    const sum = raidReview.summarizeNight(nightData({
      deathContribs: [{ encounter_id: 'e1', deaths: [{ name: 'Zonekab', ts: iso(FIRST_PULL + 5000), class: null }] }],
    }));
    expect(sum.deaths).toHaveLength(0);
  });

  it('flags a kill whose parse barely reached us instead of dropping the boss', () => {
    const thin = enc({ id: 'e2', duration_sec: 2, total_damage: 93,
      encounter_players: [{ character_name: 'Shavimo', total_damage: 93, dps: 47, rank: 1 }] });
    const sum = raidReview.summarizeNight(nightData({ encounters: [enc(), thin] }));
    expect(sum.kills).toHaveLength(2);
    expect(sum.kills.find(k => k.id === 'e2').thin).toBe(true);
    expect(sum.kills.find(k => k.id === 'e1').thin).toBe(false);
    const text = JSON.stringify(raidReview.renderReviewEmbeds(sum)[0].toJSON());
    expect(text).toMatch(/only a partial parse reached us/);
  });

  it('compares a fight against OUR OWN median, in both directions', () => {
    const history = Array.from({ length: 8 }, () => ({ npc_id: 162037, duration_sec: 200 }));
    const slow = raidReview.summarizeNight(nightData({ encounters: [enc({ duration_sec: 400 })], history }));
    expect(slow.slowFights[0]).toMatchObject({ boss: 'a glyph covered serpent', median_sec: 200, pct: 100 });
    const fast = raidReview.summarizeNight(nightData({ encounters: [enc({ duration_sec: 100 })], history }));
    expect(fast.fastFights[0]).toMatchObject({ median_sec: 200, pct: 50 });
    // Too few samples → no claim either way.
    const thinHist = raidReview.summarizeNight(nightData({
      encounters: [enc({ duration_sec: 400 })],
      history: [{ npc_id: 162037, duration_sec: 200 }, { npc_id: 162037, duration_sec: 200 }],
    }));
    expect(thinHist.slowFights).toHaveLength(0);
  });

  it('engaged-but-not-confirmed fights are wipes, not kills', () => {
    const wipe = enc({ id: 'e2', ended_at: null });
    const sum = raidReview.summarizeNight(nightData({ encounters: [enc(), wipe] }));
    expect(sum.kills).toHaveLength(1);
    expect(sum.engaged).toHaveLength(1);
    const text = JSON.stringify(raidReview.renderReviewEmbeds(sum)[0].toJSON());
    expect(text).toMatch(/Engaged but never confirmed down/);
  });

  it('reads attendance off the DKP ticks and names who left early', () => {
    const sum = raidReview.summarizeNight(nightData({
      ticks: [
        { tick_id: 1, description: 'Tick 1 (Raid Start)', value: 5, attendees: ['Hitya', 'Jankzer', 'Statlander'] },
        { tick_id: 2, description: 'Tick 2 (1 Hour)',     value: 5, attendees: ['Hitya', 'Jankzer', 'Shavimo'] },
      ],
    }));
    expect(sum.attendance.total).toBe(4);
    expect(sum.attendance.dkpAwarded).toBe(10);
    expect(sum.attendance.leftEarly).toEqual(['Statlander']);
  });

  it('every embed field stays inside Discord limits', () => {
    const many = Array.from({ length: 60 }, (_, i) => enc({
      id: 'e' + i, npc_id: 100000 + i,
      started_at: new Date(FIRST_PULL + i * 300_000).toISOString(),
      ended_at: new Date(FIRST_PULL + i * 300_000 + 148_000).toISOString(),
      eqemu_npc_types: { name: `#A_very_long_boss_name_number_${i}`, zone_short: null },
    }));
    const loot = Array.from({ length: 40 }, (_, i) => ({ item_name: `Some Quite Long Item Name ${i}`, character_name: 'Hoden', dkp: 40 - i }));
    const sum = raidReview.summarizeNight(nightData({ encounters: many, loot }));
    const j = raidReview.renderReviewEmbeds(sum)[0].toJSON();
    expect(j.description.length).toBeLessThanOrEqual(4096);
    for (const f of j.fields) expect(f.value.length, f.name).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(j).length).toBeLessThanOrEqual(6000);
    expect(j.fields.find(f => f.name.startsWith('🏆')).value).toMatch(/…and \d+ more kills/);
  });

  it('links to the web review for the same night', () => {
    process.env.WEB_BASE_URL = 'https://wolfpack.quest';
    const sum = raidReview.summarizeNight(nightData());
    expect(raidReview.renderReviewEmbeds(sum)[0].toJSON().url).toBe('https://wolfpack.quest/raid/review/2026-07-30');
  });
});
