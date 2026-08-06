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
// The LIVE half (docs/DESIGN-live-raid-review.md) adds three more:
//
//   (d) the live card EDITS one message — a burst of uploads collapses into a
//       single debounced edit, and the 00:45 final still owns the last word;
//   (e) the trash tally dedups the same kill across ~20 uploaders;
//   (f) the ingest path itself is untouched — the hook sits AFTER the 200, is
//       never awaited, is try/caught, and every pre-existing step of
//       _handleAgentUpload is still there in the same order.
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
  'RAID_REVIEW_LIVE', 'RAID_REVIEW_LIVE_DEBOUNCE_SEC', 'RAID_REVIEW_LIVE_MIN_SEC',
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
  raidReview._clearLiveCaches();
  // raidReview require()s utils/raidNight; this file imports it as ESM. Those
  // are DIFFERENT module instances under vitest, so the seeded events would not
  // reach the copy the review uses — inject the instance this test drives.
  raidReview._setDeps({ raidNight });
});
afterEach(() => {
  raidReview._clearTimer();
  raidReview._clearLiveCaches();
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
    // …inside its OWN try/catch. Checking "some try above, some catch below"
    // passes vacuously: with the review's guard deleted, lastIndexOf finds the
    // PRECEDING step's `try {` and that block's own `catch` satisfies the
    // match (verified by mutation 2026-08-02 — the guard could be removed with
    // the suite still green). So assert the nearest `try {` above the call has
    // not already closed: no `catch (` may appear BETWEEN it and the call.
    const tryAt = chain.lastIndexOf('try {', i);
    expect(tryAt, 'no try above the review call at all').toBeGreaterThan(-1);
    expect(
      chain.slice(tryAt, i),
      'the review call is not inside its own try — the nearest try above it closes first',
    ).not.toMatch(/catch\s*\(/);
    expect(chain.slice(i, i + 200), 'no catch follows the review call').toMatch(/catch\s*\(/);
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

  // THE 2026-08-04 SPAM BUG. The case above passes only because its `slots` Map
  // survives between the two calls — i.e. it models a state.json that persists.
  // On Railway it does NOT: there is no volume mounted on the service, so every
  // deploy boots with "[state] state.json not found — creating fresh state".
  // Eleven redeploys in one night → boot → catch-up → no id → eleven copies of
  // the same Sunday review in the raid thread.
  //
  // So the honest fixture wipes the local state between runs and keeps only the
  // durable bot_kv row, which is what a redeploy actually looks like.
  function fakeKv() {
    const rows = new Map();                       // key → value object
    return {
      rows,
      isEnabled: () => true,
      select: async (table, q) => {
        const m = /key=eq\.([^&]+)/.exec(q || '');
        const key = m ? decodeURIComponent(m[1]) : null;
        const v = key ? rows.get(key) : null;
        return v ? [{ value: v }] : [];
      },
      upsert: async (table, list) => { for (const r of list) rows.set(r.key, r.value); return list; },
    };
  }

  it('SURVIVES A REDEPLOY: state.json wiped, kv remembers → edits, does not repost', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, sent, edited } = fakeDiscord();
    const kv = fakeKv();
    let slots = new Map();                        // this container's state.json
    const deps = () => ({
      raidNight,
      collect: async () => nightData(),
      supabase: kv,
      state: {
        getRaidReviewMessageId: (k) => slots.get(k) || null,
        setRaidReviewMessageId: (k, v) => slots.set(k, v),
      },
    });

    raidReview._setDeps(deps());
    const first = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(first.reason).toBe('posted');
    expect(kv.rows.size, 'the id must reach bot_kv, not just state.json').toBe(1);

    // ── redeploy ──────────────────────────────────────────────────────────
    slots = new Map();                            // fresh container, empty state
    raidReview._clearLiveCaches?.();
    raidReview._setDeps(deps());

    const second = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(second.reason, 'a restart must EDIT the existing review').toBe('edited');
    expect(sent, 'exactly one message may ever be sent for a night').toHaveLength(1);
    expect(edited).toHaveLength(1);
  });

  it('eleven redeploys produce ONE review, not eleven', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, sent } = fakeDiscord();
    const kv = fakeKv();
    for (let i = 0; i < 11; i++) {
      const slots = new Map();                    // every boot starts empty
      raidReview._setDeps({
        raidNight, collect: async () => nightData(), supabase: kv,
        state: {
          getRaidReviewMessageId: (k) => slots.get(k) || null,
          setRaidReviewMessageId: (k, v) => slots.set(k, v),
        },
      });
      await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    }
    expect(sent, 'this is the exact count the raid thread saw on 2026-08-04').toHaveLength(1);
  });

  it('a kv outage fails OPEN — posting a duplicate beats silently losing the review', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, sent } = fakeDiscord();
    const slots = new Map();
    raidReview._setDeps({
      raidNight, collect: async () => nightData(),
      supabase: { isEnabled: () => true,
                  select: async () => { throw new Error('kv down'); },
                  upsert: async () => { throw new Error('kv down'); } },
      state: {
        getRaidReviewMessageId: (k) => slots.get(k) || null,
        setRaidReviewMessageId: (k, v) => slots.set(k, v),
      },
    });
    const res = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(res.ok, 'a kv failure must not take the review down with it').toBe(true);
    expect(sent).toHaveLength(1);
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

// ── Content additions: the timeline strip + trash (Hitya 2026-08-02) ─────────

const iso = (ms) => new Date(ms).toISOString();

describe('the Discord fight timeline (the FightTimeline analogue)', () => {
  it('places deaths where they fell inside the fight', () => {
    // 12 cells over a 120s fight = 10s per cell. Deaths at 5s and 115s.
    expect(raidReview.deathStrip([5_000, 115_000], 0, 120_000)).toBe('▂▁▁▁▁▁▁▁▁▁▁▂');
    // A wipe is one tall bar, not twelve short ones.
    expect(raidReview.deathStrip([61_000, 62_000, 63_000, 64_000, 65_000], 0, 120_000)).toBe('▁▁▁▁▁▁█▁▁▁▁▁');
    // Degenerate inputs never throw or produce a ragged strip.
    expect(raidReview.deathStrip([], 0, 0)).toHaveLength(raidReview.TIMELINE_CELLS);
    expect(raidReview.deathStrip([-5_000, 999_999], 0, 1000)).toBe('▂▁▁▁▁▁▁▁▁▁▁▂');
  });

  it('builds one row per fight that had a death, linked to the web timeline', () => {
    const t = FIRST_PULL + 10_000;
    const sum = raidReview.summarizeNight(nightData({
      deathContribs: [{ encounter_id: 'e1', deaths: [
        { name: 'Hitya', ts: iso(t), class: 'Monk' },
        { name: 'Shavimo', ts: iso(t + 2000), class: 'Shaman' },
        { name: 'Jankzer', ts: iso(t + 3000), class: 'Necromancer' },
      ] }],
    }));
    expect(sum.timelines).toHaveLength(1);
    expect(sum.timelines[0]).toMatchObject({ id: 'e1', boss: 'a glyph covered serpent', deaths: 3 });
    expect(sum.timelines[0].worstCluster).toBe(3);        // died together → the wipe signal
    expect(sum.timelines[0].strip).toHaveLength(raidReview.TIMELINE_CELLS);

    process.env.WEB_BASE_URL = 'https://wolfpack.quest';
    const j = raidReview.renderReviewEmbeds(sum)[0].toJSON();
    const field = j.fields.find(f => f.name.startsWith('🕒'));
    expect(field.value).toMatch(/\(https:\/\/wolfpack\.quest\/parses\/e1\)/);
    expect(field.value).toMatch(/3 together/);
  });

  it('uses the SAME deaths the rest of the review counts — a fight with none is absent', () => {
    const quiet = enc({ id: 'e2', npc_id: 162039, eqemu_npc_types: { name: '#Vyzh`dra_the_Exiled', zone_short: null } });
    const sum = raidReview.summarizeNight(nightData({
      encounters: [enc(), quiet],
      // Two parsers see ONE Hitya death — the shared dedup keeps one, so the
      // timeline must show one, not two.
      deathContribs: [
        { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(FIRST_PULL + 5000), class: 'Monk' }] },
        { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(FIRST_PULL + 7000), class: 'Monk' }] },
      ],
    }));
    expect(sum.timelines.map(t => t.id)).toEqual(['e1']);
    expect(sum.timelines[0].deaths).toBe(1);
    expect(sum.deaths).toHaveLength(1);
  });

  // Uilnayar 2026-08-06: "we only saw 4 of the fight timelines posted" — on a
  // night with 12 kills. The suppression was correct (the other 8 were clean),
  // but the embed printed "Fight timelines (4)" a few lines under "12 down"
  // with nothing connecting them, so a suppressed clean kill was
  // indistinguishable from a fight we failed to record.
  it('says how many kills the timelines cover, and why the rest are missing', () => {
    const quiet = enc({ id: 'e2', npc_id: 162039, eqemu_npc_types: { name: '#Vyzh`dra_the_Exiled', zone_short: null } });
    const sum = raidReview.summarizeNight(nightData({
      encounters: [enc(), quiet],
      deathContribs: [
        { encounter_id: 'e1', deaths: [{ name: 'Hitya', ts: iso(FIRST_PULL + 5000), class: 'Monk' }] },
      ],
    }));
    const field = raidReview.renderReviewEmbeds(sum)[0].toJSON()
      .fields.find(f => f.name.startsWith('\u{1F552}'));
    expect(field.name, 'the ratio must be legible without counting rows').toContain('1 of 2');
    expect(field.value, 'a clean kill is good news — say so, do not just omit it')
      .toMatch(/1 clean kill not shown — nobody died/);
  });

  it('adds no clean-kill note when every kill had a death', () => {
    // The note must not appear as "0 clean kills not shown".
    const sum = raidReview.summarizeNight(nightData({
      deathContribs: [{ encounter_id: 'e1', deaths: [
        { name: 'Hitya', ts: iso(FIRST_PULL + 5000), class: 'Monk' },
      ] }],
    }));
    const field = raidReview.renderReviewEmbeds(sum)[0].toJSON()
      .fields.find(f => f.name.startsWith('\u{1F552}'));
    expect(field.name).toContain('1 of 1');
    expect(field.value).not.toMatch(/clean kill/);
  });

  it('drops out entirely when nothing died', () => {
    const sum = raidReview.summarizeNight(nightData());
    expect(sum.timelines).toEqual([]);
    expect(raidReview.renderReviewEmbeds(sum)[0].toJSON().fields.some(f => f.name.startsWith('🕒'))).toBe(false);
  });
});

// ── (e) trash tally ──────────────────────────────────────────────────────────

describe('(e) trash totals — the one thing Supabase has no row for', () => {
  const KEY = () => raidNight.nightKey(FIRST_PULL);

  it('collapses the same kill reported by twenty uploaders into one', () => {
    // Every agent in the raid uploads the same "a glyph covered serpent" with
    // its own slightly different start time and its own partial damage total.
    for (let i = 0; i < 20; i++) {
      raidReview.noteTrashKill({ atMs: FIRST_PULL + i * 700, name: 'a glyph covered serpent', damage: 1000 + i * 10, durationSec: 12 });
    }
    const sum = raidReview.trashSummary(KEY());
    expect(sum.kills).toBe(1);
    expect(sum.damage).toBe(1190);          // max-keep, like merge_encounter_players
    expect(sum.mobs).toEqual([{ name: 'a glyph covered serpent', kills: 1, damage: 1190 }]);
  });

  it('still separates two genuine kills of the same mob', () => {
    raidReview.noteTrashKill({ atMs: FIRST_PULL, name: 'an ancient guardian', damage: 5000, durationSec: 20 });
    raidReview.noteTrashKill({ atMs: FIRST_PULL + 5 * 60_000, name: 'an ancient guardian', damage: 4000, durationSec: 18 });
    expect(raidReview.trashSummary(KEY()).kills).toBe(2);
  });

  it('does not double-count a kill that straddles a dedup bucket boundary', () => {
    // 30s buckets — these two land in adjacent buckets, but are one kill.
    const onBoundary = Math.ceil(FIRST_PULL / 30_000) * 30_000;
    raidReview.noteTrashKill({ atMs: onBoundary - 1, name: 'a temple guard', damage: 100 });
    raidReview.noteTrashKill({ atMs: onBoundary + 1, name: 'a temple guard', damage: 100 });
    expect(raidReview.trashSummary(KEY()).kills).toBe(1);
  });

  it('counts only unconfirmed-free NON-boss kills, and never during backfill', () => {
    const base = { atMs: FIRST_PULL, damage: 100, durationSec: 10, players: 4 };
    raidReview.noteEncounterUpload({ ...base, bossName: 'Emperor Ssraeshza', isBoss: true,  confirmed: true });
    raidReview.noteEncounterUpload({ ...base, bossName: 'a temple guard',    isBoss: false, confirmed: false });  // pull, not a kill
    raidReview.noteEncounterUpload({ ...base, bossName: 'a temple guard',    isBoss: false, confirmed: true, players: 0 });
    expect(raidReview.trashSummary(KEY())).toBe(null);
    raidReview.noteEncounterUpload({ ...base, bossName: 'a temple guard', isBoss: false, confirmed: true });
    expect(raidReview.trashSummary(KEY()).kills).toBe(1);
  });

  it('renders totals plus the top mobs, labelled as observed', () => {
    const sum = raidReview.summarizeNight(nightData({
      trash: { kills: 143, damage: 2_450_000, seconds: 1830, observed: true,
        mobs: [{ name: 'a glyph covered serpent', kills: 51, damage: 900_000 },
               { name: 'a temple guard', kills: 40, damage: 700_000 }] },
    }));
    expect(sum.trash.kills).toBe(143);
    const field = raidReview.renderReviewEmbeds(sum)[0].toJSON().fields.find(f => f.name.startsWith('🐜'));
    expect(field.value).toMatch(/\*\*143\*\* mobs cleared/);
    expect(field.value).toMatch(/2\.45M/);
    expect(field.value).toMatch(/a glyph covered serpent/);
    expect(field.value).toMatch(/agents saw die/);
  });

  it('drops out when nothing was tallied — never a "0 trash" line', () => {
    const sum = raidReview.summarizeNight(nightData({ trash: { kills: 0, damage: 0, seconds: 0, mobs: [] } }));
    expect(sum.trash).toBe(null);
    expect(raidReview.renderReviewEmbeds(sum)[0].toJSON().fields.some(f => f.name.startsWith('🐜'))).toBe(false);
  });

  it('a hostile call cannot throw into the upload handler', () => {
    expect(() => raidReview.noteTrashKill()).not.toThrow();
    expect(() => raidReview.noteTrashKill({ atMs: NaN, name: null })).not.toThrow();
    expect(() => raidReview.noteEncounterUpload()).not.toThrow();
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    expect(() => raidReview.noteEncounterUpload({ atMs: FIRST_PULL, bossName: 'x', confirmed: true, players: 1, client: hostile })).not.toThrow();
  });
});

// ── (d) the live card ────────────────────────────────────────────────────────

function liveData(over = {}) {
  return nightData({
    encounters: [
      enc(),
      // A pull that has NOT been confirmed down — the fight in progress.
      enc({ id: 'e2', npc_id: 162039, ended_at: null,
        started_at: new Date(et('2026-07-30T20:56:00-04:00')).toISOString(),
        eqemu_npc_types: { name: '#Vyzh`dra_the_Exiled', zone_short: null } }),
    ],
    ...over,
  });
}

describe('(d) the live card is the SAME message, refreshed', () => {
  const NOW = et('2026-07-30T21:00:00-04:00');

  it('shows what the final cannot: the fight in progress, and our own pace', () => {
    // Six prior raid nights, five kills each, all inside the first 20 minutes.
    const paceHistory = [];
    for (let n = 0; n < 6; n++) {
      const nightStart = et('2026-07-30T20:40:00-04:00') - (n + 1) * 7 * 86_400_000;
      for (let k = 0; k < 5; k++) paceHistory.push({ started_at: iso(nightStart + k * 4 * 60_000) });
    }
    const sum = raidReview.summarizeNight(liveData({ paceHistory }), { requireKills: false, nowMs: NOW });
    expect(sum.live.inProgress).toEqual([{ boss: 'Vyzh`dra the Exiled', sinceMs: et('2026-07-30T20:56:00-04:00') }]);
    expect(sum.live.pace).toMatchObject({ kills: 1, usual: 5, nights: 6 });

    const j = raidReview.renderReviewEmbeds(sum)[0].toJSON();
    expect(j.title).toBe('🔴 Raid Night — Thursday, July 30, 2026');
    expect(j.description).toMatch(/🔴 \*\*LIVE\*\*/);
    expect(j.description).toMatch(/⚔️ Fighting \*\*Vyzh`dra the Exiled\*\*/);
    expect(j.description).toMatch(/<t:\d+:R>/);              // self-ticking, no edit needed
    expect(j.description).toMatch(/4 behind our usual 5 \(last 6 raids\)/);
    expect(j.footer.text).toMatch(/final writeup after midnight/);
  });

  it('makes no pace claim without a real baseline', () => {
    const thin = [{ started_at: iso(FIRST_PULL - 7 * 86_400_000) }];
    const sum = raidReview.summarizeNight(liveData({ paceHistory: thin }), { requireKills: false, nowMs: NOW });
    expect(sum.live.pace).toBe(null);
    expect(raidReview.renderReviewEmbeds(sum)[0].toJSON().description).not.toMatch(/📈/);
  });

  it('the FINAL review for the same night carries none of it', () => {
    const sum = raidReview.summarizeNight(liveData());
    expect(sum.live).toBe(null);
    const j = raidReview.renderReviewEmbeds(sum)[0].toJSON();
    expect(j.title).toBe('📓 Raid Night Review — Thursday, July 30, 2026');
    expect(j.color).toBe(0xe67e22);
    expect(j.description).not.toMatch(/LIVE|Fighting|<t:/);
    expect(j.footer.text).toMatch(/\/raidreview to refresh/);
  });

  it('renders a card for a raid that has pulled but not yet killed anything', () => {
    const onlyEngaged = nightData({ encounters: [enc({ ended_at: null })] });
    expect(raidReview.summarizeNight(onlyEngaged)).toBe(null);                       // the final: nothing to review
    const live = raidReview.summarizeNight(onlyEngaged, { requireKills: false, nowMs: NOW });
    expect(live.kills).toHaveLength(0);
    expect(live.live.inProgress).toHaveLength(1);
    expect(raidReview.renderReviewEmbeds(live)[0].toJSON().fields.some(f => f.name.startsWith('🏆'))).toBe(false);
  });

  it('a live refresh EDITS the card it already posted — one message, ever', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, parent, sent, edited } = fakeDiscord();
    const slots = new Map();
    raidReview._setDeps({
      raidNight, collect: async () => liveData(),
      state: { getRaidReviewMessageId: (k) => slots.get(k) || null, setRaidReviewMessageId: (k, v) => slots.set(k, v) },
    });

    const first = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL, live: true, nowMs: NOW });
    expect(first.reason).toBe('posted');
    for (let i = 0; i < 5; i++) {
      const again = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL, live: true, nowMs: NOW });
      expect(again.reason).toBe('edited');
    }
    expect(sent).toHaveLength(1);
    expect(edited).toHaveLength(5);
    expect(parent.threads.create).not.toHaveBeenCalled();
  });

  it('the 00:45 final edits the live card, and no later live refresh can undo it', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const { client, sent, edited } = fakeDiscord();
    const slots = new Map();
    raidReview._setDeps({
      raidNight, collect: async () => liveData(),
      state: { getRaidReviewMessageId: (k) => slots.get(k) || null, setRaidReviewMessageId: (k, v) => slots.set(k, v) },
    });

    await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL, live: true, nowMs: NOW });
    const final = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(final.reason).toBe('edited');
    expect(JSON.stringify(edited[0].embeds[0].toJSON())).not.toMatch(/LIVE/);

    const late = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL, live: true, nowMs: NOW });
    expect(late.ok).toBe(false);
    expect(late.reason).toBe('final-posted');
    expect(sent).toHaveLength(1);
    expect(edited).toHaveLength(1);
  });

  it('RAID_REVIEW_LIVE=0 stops the live card without touching the morning review', async () => {
    process.env.RAID_REVIEW_LIVE = '0';
    raidReview._setDeps({ raidNight, collect: async () => liveData() });
    const res = await raidReview.postRaidNightReview({ user: {} }, { atMs: FIRST_PULL, live: true, dryRun: true });
    expect(res.reason).toBe('live-disabled');
    expect(raidReview.touchLiveRaidReview({ user: {} }, { atMs: FIRST_PULL }).armed).toBe(false);
    // …and the final still builds.
    expect((await raidReview.postRaidNightReview({ user: {} }, { atMs: FIRST_PULL, dryRun: true })).ok).toBe(true);
  });

  it('a burst of uploads collapses into ONE refresh', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    process.env.RAID_REVIEW_LIVE_DEBOUNCE_SEC = '5';
    process.env.RAID_REVIEW_LIVE_MIN_SEC = '30';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    // Fake the TIMERS too for this one so the debounce can be driven forward.
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      const { client, sent } = fakeDiscord();
      const slots = new Map();
      let collects = 0;
      raidReview._setDeps({
        raidNight, collect: async () => { collects++; return liveData(); },
        state: { getRaidReviewMessageId: (k) => slots.get(k) || null, setRaidReviewMessageId: (k, v) => slots.set(k, v) },
      });

      // Twenty agents upload the same kill inside four seconds.
      for (let i = 0; i < 20; i++) {
        expect(raidReview.touchLiveRaidReview(client, { atMs: FIRST_PULL }).armed).toBe(true);
        await vi.advanceTimersByTimeAsync(200);
      }
      expect(collects).toBe(0);                       // still inside the debounce
      await vi.advanceTimersByTimeAsync(6_000);
      expect(collects).toBe(1);
      expect(sent).toHaveLength(1);

      // A later upload waits out the min-interval floor rather than editing again.
      raidReview.touchLiveRaidReview(client, { atMs: FIRST_PULL });
      await vi.advanceTimersByTimeAsync(6_000);
      expect(collects).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(collects).toBe(2);
    } finally {
      raidReview._clearTimer();
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    }
  });

  it('touchLiveRaidReview never throws, and never fires off a raid night', () => {
    expect(() => raidReview.touchLiveRaidReview(null)).not.toThrow();
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    expect(() => raidReview.touchLiveRaidReview(hostile, { atMs: NaN })).not.toThrow();
    // Tuesday lunchtime is not a raid — no card, no work.
    expect(raidReview.touchLiveRaidReview({ user: {} }, { atMs: et('2026-07-28T13:00:00-04:00') }))
      .toMatchObject({ armed: false, reason: 'not-raid-night' });
    expect(raidReview.touchLiveRaidReview({ user: {} }, { atMs: FIRST_PULL }).armed).toBe(true);
  });
});

// ── (f) the ingest path is exactly what it was ───────────────────────────────

describe('(f) _handleAgentUpload is unchanged by the live hook', () => {
  const src = readSource(BOT_INDEX);
  const handler = sliceBlock(src, 'async function _handleAgentUpload(req, res) {', '\nconst httpServer = http.createServer(');

  it('keeps every pre-existing step, in order, with the ack in the same place', () => {
    const STEPS = [
      'const identity = await mimicLink.requireAgentAuth(req, res);',
      'mergeWhoData(uploadedWhoData)',
      'accumulateSessionDamage(players, duration)',
      'const _postParseCardsDeferred = async () => {',
      '_parseLogMsgP = logParseToDiscord(client, matchedBoss.id, parseEntry);',
      'const recParseResult = await supabase.recordParse({',
      'latest_agent_version:  _currentAgentVersion(),',           // ← the 200 ack
      '_postParseCardsDeferred().catch(',
      '.then(msg => applyEncounterParseLink(msg, _encIdForLink))',
    ];
    let at = -1;
    for (const step of STEPS) {
      const i = handler.indexOf(step);
      expect(i, `upload step missing or reordered: ${step}`).toBeGreaterThan(at);
      at = i;
    }
  });

  it('the durability boundary still sits BEFORE the ack and Discord AFTER it', () => {
    const ack      = handler.indexOf('latest_agent_version:  _currentAgentVersion(),');
    expect(handler.indexOf('const recParseResult = await supabase.recordParse({')).toBeLessThan(ack);
    expect(handler.indexOf('_postParseCardsDeferred().catch(')).toBeGreaterThan(ack);
  });

  it('the live hook is post-ack, backfill-gated, try/caught and NEVER awaited', () => {
    const i = handler.indexOf('noteEncounterUpload({');
    expect(i, 'the live review hook is not wired into the upload handler').toBeGreaterThan(-1);
    expect(i).toBeGreaterThan(handler.indexOf('latest_agent_version:  _currentAgentVersion(),'));
    // Its own try — the nearest `try {` above it must not already have closed
    // (the same non-vacuous check the midnight-chain assertion uses).
    const tryAt = handler.lastIndexOf('try {', i);
    expect(tryAt).toBeGreaterThan(-1);
    expect(handler.slice(tryAt, i), 'the live hook is not inside its own try').not.toMatch(/catch\s*\(/);
    expect(handler.slice(i, i + 400)).toMatch(/catch\s*\(/);
    // Backfill must not touch tonight's card.
    expect(handler.slice(Math.max(0, i - 900), i)).toMatch(/if \(!isBackfill\) \{/);
    // Never awaited, and never returned — it cannot alter handler flow.
    expect(handler).not.toMatch(/await\s+[^\n]*noteEncounterUpload/);
    expect(handler).not.toMatch(/return\s+[^\n]*noteEncounterUpload/);
  });
});

// ── Intentional deaths (R2, Uilnayar 2026-08-06) ─────────────────────────────
//
// "Fawx and Dant both 'made corpses' on purpose with Kaas Thox Xi Ans Dyek, so
// while they did have 2 deaths, they were intentional. Perhaps officers can
// have a way to set this, we do it every time for these rogues on that fight."
//
// A STANDING rule keyed (character, boss) — not a per-death toggle, because it
// is the same two rogues on the same boss every week. The load-bearing
// property, and the one most of these tests defend, is that the death is
// MARKED, NOT REMOVED: it stays in the headline count and the deaths list, and
// only stops counting as something to fix.

describe('intentional deaths', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const KAAS = 162100;
  const kaas = (over = {}) => enc({
    id: 'e2', npc_id: KAAS,
    eqemu_npc_types: { name: '#Kaas_Thox_Xi_Ans_Dyek', zone_short: null },
    encounter_players: [
      { character_name: 'Fawx', total_damage: 50000, dps: 340, rank: 1 },
      { character_name: 'Dant', total_damage: 40000, dps: 270, rank: 2 },
      { character_name: 'Hitya', total_damage: 30000, dps: 200, rank: 3 },
    ],
    ...over,
  });
  const ROGUES = [
    { name: 'Fawx', class: 'Rogue', exclude_from_stats: false },
    { name: 'Dant', class: 'Rogue', exclude_from_stats: false },
  ];
  const corpses = [{ encounter_id: 'e2', deaths: [
    { name: 'Fawx', ts: iso(FIRST_PULL + 60_000), class: 'Rogue' },
    { name: 'Dant', ts: iso(FIRST_PULL + 65_000), class: 'Rogue' },
  ] }];
  const RULES = [
    { character_name: 'Fawx', npc_id: KAAS, active: true, note: 'corpse drag' },
    { character_name: 'Dant', npc_id: KAAS, active: true, note: 'corpse drag' },
  ];
  const night = (over = {}) => nightData({
    encounters: [kaas()],
    deathContribs: corpses,
    characters: [...CHARACTERS, ...ROGUES],
    ...over,
  });

  it('without a rule, the fight is blamed — this is the reported behaviour', () => {
    // Fixture-validity check. If this stops failing to exclude, the tests below
    // prove nothing.
    const sum = raidReview.summarizeNight(night());
    expect(sum.worstFights).toEqual([{ boss: 'Kaas Thox Xi Ans Dyek', deaths: 2 }]);
    expect(sum.intentionalDeaths).toBe(0);
  });

  it('a standing rule drops the fight out of "what to work on"', () => {
    const sum = raidReview.summarizeNight(night({ intentionalRules: RULES }));
    expect(sum.worstFights).toEqual([]);
    expect(sum.intentionalDeaths).toBe(2);
  });

  it('the deaths are MARKED, not removed — they still happened', () => {
    const sum = raidReview.summarizeNight(night({ intentionalRules: RULES }));
    expect(sum.deaths).toHaveLength(2);                       // headline count unchanged
    expect(sum.deaths.map(d => d.name).sort()).toEqual(['Dant', 'Fawx']);
    expect(sum.deaths.every(d => d.intentional)).toBe(true);
  });

  it('the embed says how many were on purpose without hiding any', () => {
    const sum = raidReview.summarizeNight(night({ intentionalRules: RULES }));
    const text = JSON.stringify(raidReview.renderReviewEmbeds(sum)[0].toJSON());
    expect(text).toMatch(/\*\*2\*\* deaths \(2 on purpose\)/);
    expect(text).not.toMatch(/Kaas Thox Xi Ans Dyek\*\* — /);   // not in "work on"
  });

  it('a real death on the same fight still counts, and the fight comes back', () => {
    // The rule excuses Fawx and Dant, NOT the fight. Hitya wiping there is
    // still a thing to work on.
    const withReal = [{ encounter_id: 'e2', deaths: [
      ...corpses[0].deaths,
      { name: 'Hitya', ts: iso(FIRST_PULL + 70_000), class: 'Monk' },
    ] }];
    const sum = raidReview.summarizeNight(night({ deathContribs: withReal, intentionalRules: RULES }));
    expect(sum.worstFights).toEqual([{ boss: 'Kaas Thox Xi Ans Dyek', deaths: 1 }]);
    expect(sum.deaths).toHaveLength(3);
    expect(sum.intentionalDeaths).toBe(2);
  });

  it('the rule is per BOSS — Fawx dying anywhere else still counts', () => {
    const elsewhere = [{ encounter_id: 'e1', deaths: [
      { name: 'Fawx', ts: iso(FIRST_PULL + 20_000), class: 'Rogue' },
    ] }];
    const sum = raidReview.summarizeNight(night({
      encounters: [enc(), kaas()],
      deathContribs: elsewhere,
      intentionalRules: RULES,
    }));
    expect(sum.worstFights).toEqual([{ boss: 'a glyph covered serpent', deaths: 1 }]);
    expect(sum.intentionalDeaths).toBe(0);
  });

  it('matches on npc_id, not the rendered boss name', () => {
    // cleanBossName() strips '#'/'_' for display and two differently-templated
    // NPCs can render the same clean name, so a name-keyed rule would leak
    // across bosses. A rule for the right NAME but the wrong ID must not fire.
    const wrongId = [{ character_name: 'Fawx', npc_id: 999999, active: true },
                     { character_name: 'Dant', npc_id: 999999, active: true }];
    const sum = raidReview.summarizeNight(night({ intentionalRules: wrongId }));
    expect(sum.worstFights).toEqual([{ boss: 'Kaas Thox Xi Ans Dyek', deaths: 2 }]);
  });

  it('matches case-insensitively — log lines and officer typing disagree', () => {
    const cased = RULES.map(r => ({ ...r, character_name: r.character_name.toUpperCase() }));
    const sum = raidReview.summarizeNight(night({ intentionalRules: cased }));
    expect(sum.intentionalDeaths).toBe(2);
  });

  it('an inactive rule does nothing', () => {
    const off = RULES.map(r => ({ ...r, active: false }));
    const sum = raidReview.summarizeNight(night({ intentionalRules: off }));
    expect(sum.worstFights).toEqual([{ boss: 'Kaas Thox Xi Ans Dyek', deaths: 2 }]);
    expect(sum.intentionalDeaths).toBe(0);
  });

  it('malformed or missing rules leave the review exactly as it was', () => {
    for (const rules of [undefined, null, [], 'nope', [null], [{}],
                         [{ character_name: 'Fawx' }],
                         [{ character_name: 'Fawx', npc_id: 'not-a-number', active: true }]]) {
      const sum = raidReview.summarizeNight(night({ intentionalRules: rules }));
      expect(sum.worstFights).toEqual([{ boss: 'Kaas Thox Xi Ans Dyek', deaths: 2 }]);
      expect(sum.intentionalDeaths).toBe(0);
    }
  });
});

// ── Reserved top-of-thread slots (R3, Uilnayar 2026-08-06) ───────────────────
//
// "the /raidreview posted to the third line of the page — when the raid night
// thread opens up it should reserve the first two lines of it for the raid
// review(s) to land if they're long."
//
// Discord orders a thread by post time and cannot move a message, so being
// first is a one-shot opportunity that exists only at thread creation. The
// thread posts placeholders immediately and the review EDITS one — which is
// why it ends up on top without ever being re-posted.

describe('reserved review slots', () => {
  // A thread that records everything, so "did it post or did it edit" and
  // "which message" are both observable.
  // Models message STATE, not just calls: releaseUnclaimedSlots decides what to
  // delete by reading each message's current embed title, so a fake that forgot
  // what an edit did would let a "deletes only placeholders" test pass vacuously.
  function fakeThread(id = 'THREAD_NEW') {
    const posted = [], edits = [], deleted = [];
    const live = new Map();          // id → current payload
    let n = 0;
    const view = (mid) => ({
      id: mid,
      get embeds() {
        const p = live.get(mid);
        return (p?.embeds || []).map(e => (typeof e.toJSON === 'function' ? e.toJSON() : e));
      },
      edit: async (p) => { edits.push({ id: mid, payload: p }); live.set(mid, p); },
      delete: async () => { deleted.push(mid); live.delete(mid); },
    });
    const thread = {
      id, name: NIGHT_NAME, posted, edits, deleted, live,
      send: async (payload) => {
        const mid = `M${++n}`;
        posted.push({ id: mid, payload });
        live.set(mid, payload);
        return { id: mid };
      },
      messages: {
        fetch: async (mid) => {
          if (!live.has(mid)) { const e = new Error('Unknown Message'); e.code = 10008; throw e; }
          return view(mid);
        },
      },
    };
    return thread;
  }

  function fakeKv() {
    const rows = new Map();
    return {
      rows,
      isEnabled: () => true,
      select: async (_t, q) => {
        const m = /key=eq\.([^&]+)/.exec(q || '');
        const key = m ? decodeURIComponent(m[1]) : null;
        const v = key ? rows.get(key) : null;
        return v ? [{ value: v }] : [];
      },
      upsert: async (_t, list) => { for (const r of list) rows.set(r.key, r.value); return list; },
    };
  }

  const KEY = raidReview.nightWindowFor(FIRST_PULL).nightKey;

  it('reserves exactly RESERVED_SLOTS placeholders', async () => {
    const kv = fakeKv(); const thread = fakeThread();
    raidReview._setDeps({ raidNight, supabase: kv });
    const ids = await raidReview.reserveReviewSlots(thread, KEY);
    expect(ids).toHaveLength(raidReview.RESERVED_SLOTS);
    expect(raidReview.RESERVED_SLOTS).toBe(6);                 // review 1-2, ticks 3-6
    expect(raidReview.RESERVED_REVIEW_SLOTS).toBe(2);
    expect(raidReview.RESERVED_TICK_SLOTS).toBe(4);
    expect(thread.posted).toHaveLength(6);
    for (const p of thread.posted) {
      expect(p.payload.embeds[0].data.title).toBe(raidReview.RESERVED_TITLE);
    }
  });

  it('maps the four ticks onto thread slots 3-6, in order', () => {
    // "put them as reserved posts 3-6" — 8:30 → 3, 9:30 → 4, 10:30 → 5, 11:30 → 6.
    expect([1, 2, 3, 4].map(raidReview.tickSlotIndex)).toEqual([3, 4, 5, 6]);
  });

  it('is idempotent — a second call cannot double-post', async () => {
    const kv = fakeKv(); const thread = fakeThread();
    raidReview._setDeps({ raidNight, supabase: kv });
    const a = await raidReview.reserveReviewSlots(thread, KEY);
    const b = await raidReview.reserveReviewSlots(thread, KEY);
    expect(b).toEqual(a);
    expect(thread.posted).toHaveLength(6);
  });

  it('TOPS UP a thread that only holds the old two slots', async () => {
    // Tonight's thread may already exist from before the tick slots shipped. It
    // should gain slots 3-6 rather than go without ticks for the night.
    const kv = fakeKv(); const thread = fakeThread();
    raidReview._setDeps({ raidNight, supabase: kv });
    const two = await raidReview.reserveReviewSlots(thread, KEY, 2);
    expect(two).toHaveLength(2);
    const all = await raidReview.reserveReviewSlots(thread, KEY);
    expect(all).toHaveLength(6);
    expect(all.slice(0, 2)).toEqual(two);        // the review's slots keep their ids
    expect(thread.posted).toHaveLength(6);
  });

  it('THE POINT: the review EDITS the first reserved slot instead of posting below', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const kv = fakeKv();
    const thread = fakeThread('THREAD_NIGHT');
    const parent = { id: 'PARENT', threads: {
      create: vi.fn(), fetchActive: async () => ({ threads: [thread] }) } };
    const client = { user: { id: 'bot' },
      channels: { fetch: async (id) => (id === 'PARENT' ? parent : (id === thread.id ? thread : null)) } };
    const slots = new Map();
    raidReview._setDeps({ raidNight, supabase: kv, collect: async () => nightData(),
      state: { getRaidReviewMessageId: k => slots.get(k) || null,
               setRaidReviewMessageId: (k, v) => slots.set(k, v) } });

    await raidReview.reserveReviewSlots(thread, KEY);
    const firstSlot = thread.posted[0].id;
    expect(thread.posted).toHaveLength(6);

    const res = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(res.reason, 'the review must EDIT a held slot, never send a new message').toBe('edited');
    expect(res.messageId).toBe(firstSlot);                     // ← the FIRST one, not the second
    // Nothing new was sent: the only sends are the placeholders themselves.
    expect(thread.posted).toHaveLength(6);
    expect(thread.edits[0].id).toBe(firstSlot);
  });

  it('the final review deletes the slot it did not grow into', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const kv = fakeKv();
    const thread = fakeThread('THREAD_NIGHT');
    const parent = { id: 'PARENT', threads: {
      create: vi.fn(), fetchActive: async () => ({ threads: [thread] }) } };
    const client = { user: { id: 'bot' },
      channels: { fetch: async (id) => (id === 'PARENT' ? parent : (id === thread.id ? thread : null)) } };
    const slots = new Map();
    raidReview._setDeps({ raidNight, supabase: kv, collect: async () => nightData(),
      state: { getRaidReviewMessageId: k => slots.get(k) || null,
               setRaidReviewMessageId: (k, v) => slots.set(k, v) } });

    await raidReview.reserveReviewSlots(thread, KEY);
    const ids = thread.posted.map(p => p.id);
    const used = ids[0];

    // Slot 4 (the 9:30 tick) is filled in before the review runs — it must
    // SURVIVE. This is the regression that matters: a release that deleted
    // everything-but-the-review would wipe the night's attendance cards.
    const tickIdx = raidReview.tickSlotIndex(2);
    expect(await raidReview.claimSlot(thread, KEY, tickIdx,
      { embeds: [{ title: '🫂 Tick 2 (1 Hour) — 44 in raid' }] })).toBe(true);

    await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });

    expect(thread.deleted).not.toContain(used);                  // became the review
    expect(thread.deleted).not.toContain(ids[tickIdx - 1]);      // became a tick card
    // Everything still bearing the placeholder title is litter and goes.
    expect([...thread.deleted].sort()).toEqual(
      ids.filter((_, i) => i !== 0 && i !== tickIdx - 1).sort());
  });

  it('claimSlot writes into the right slot and refuses one that does not exist', async () => {
    const kv = fakeKv(); const thread = fakeThread();
    raidReview._setDeps({ raidNight, supabase: kv });
    await raidReview.reserveReviewSlots(thread, KEY);
    const ids = thread.posted.map(p => p.id);
    const card = { embeds: [{ title: '🫂 Tick 3 (2 Hour) — 40 in raid' }] };
    expect(await raidReview.claimSlot(thread, KEY, 5, card)).toBe(true);
    expect(thread.edits.at(-1).id).toBe(ids[4]);                 // 1-based slot 5
    // Past the end → false, so the caller posts normally instead of losing the card.
    expect(await raidReview.claimSlot(thread, KEY, 99, card)).toBe(false);
    expect(await raidReview.claimSlot(thread, 'no-such-night', 3, card)).toBe(false);
  });

  it('releaseUnclaimedSlots survives a placeholder someone already deleted', async () => {
    const kv = fakeKv(); const thread = fakeThread();
    raidReview._setDeps({ raidNight, supabase: kv });
    await raidReview.reserveReviewSlots(thread, KEY);
    const ids = thread.posted.map(p => p.id);
    thread.live.delete(ids[1]);                                // deleted by hand
    const freed = await raidReview.releaseUnclaimedSlots(thread, KEY, ids[0]);
    // The 4 remaining placeholders go; the hand-deleted one is skipped without
    // throwing, and slot 1 is the review.
    expect(freed).toBe(ids.length - 2);
    expect(thread.deleted).not.toContain(ids[0]);
    expect(thread.deleted).not.toContain(ids[1]);
  });

  it('a thread that refuses to be posted in still reserves nothing and does not throw', async () => {
    const kv = fakeKv();
    const broken = { id: 'T', send: async () => { throw new Error('Missing Permissions'); } };
    raidReview._setDeps({ raidNight, supabase: kv });
    await expect(raidReview.reserveReviewSlots(broken, KEY)).resolves.toEqual([]);
  });

  it('with no slots reserved the review posts normally — nothing regressed', async () => {
    process.env.RAID_NIGHT_THREAD_PARENT_ID = 'PARENT';
    events._seed([{ ...RAID_EVENT, source: 'discord' }], FIRST_PULL);
    const kv = fakeKv();
    const thread = fakeThread('THREAD_NIGHT');
    const parent = { id: 'PARENT', threads: {
      create: vi.fn(), fetchActive: async () => ({ threads: [thread] }) } };
    const client = { user: { id: 'bot' },
      channels: { fetch: async (id) => (id === 'PARENT' ? parent : (id === thread.id ? thread : null)) } };
    const slots = new Map();
    raidReview._setDeps({ raidNight, supabase: kv, collect: async () => nightData(),
      state: { getRaidReviewMessageId: k => slots.get(k) || null,
               setRaidReviewMessageId: (k, v) => slots.set(k, v) } });

    const res = await raidReview.postRaidNightReview(client, { atMs: FIRST_PULL });
    expect(res.reason).toBe('posted');
    expect(thread.posted).toHaveLength(1);
  });
});
