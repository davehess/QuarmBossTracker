// test/raid-night-events.test.js — raid-night thread v2 (Hitya 2026-07-31).
//
// Covers the three things that changed after night one:
//   1. the posting WINDOW comes from a scheduled event (start −30m … end +15m),
//      not from a weekday table;
//   2. a raid night routes to #raid-chat and a Mon/Tue/Fri/Sat guild event to
//      #event-chat, with different loot content;
//   3. the volume filter that keeps 1-player/1-second trash cards out.
//
// Real-imports the bot utils. No Discord, no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as events from '../utils/raidEvents.js';
import * as raidNight from '../utils/raidNight.js';
import { buildRollSessions, itemsMatch, renderRollLootLines } from '../utils/rollLoot.js';

const TZ = 'America/New_York';
const MIN = 60_000;
const et = (s) => Date.parse(s);

// Thursday 2026-07-30, 20:00 → 00:00 ET — the shape Hitya's calendar produces.
const RAID = { id: 'discord:1', title: 'Vex Thal', startMs: et('2026-07-30T20:00:00-04:00'), endMs: et('2026-07-31T00:00:00-04:00') };
// Friday 2026-07-31, 21:00 → 23:00 ET — an off-night guild event.
const SOCIAL = { id: 'discord:2', title: 'Bingo Night', startMs: et('2026-07-31T21:00:00-04:00'), endMs: et('2026-07-31T23:00:00-04:00') };

const ENV_KEYS = [
  'TZ_DEFAULT', 'RAID_EVENT_PRE_MIN', 'RAID_EVENT_POST_MIN', 'RAID_EVENT_DEFAULT_HOURS',
  'RAID_EVENT_RAID_DAYS', 'RAID_EVENT_RAID_FROM_HOUR', 'RAID_EVENT_RAID_PATTERN',
  'RAID_EVENT_SOCIAL_PATTERN', 'RAID_NIGHT_FALLBACK', 'RAID_NIGHT_THREAD_MIN_SECONDS',
  'RAID_NIGHT_THREAD_MIN_PLAYERS', 'RAID_NIGHT_THREAD_BOSS_ONLY', 'RAID_NIGHT_ROLLOVER_HOUR',
];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.TZ_DEFAULT = TZ;
  events._resetCache();
  raidNight._resetCache();
  raidNight._setEventsModule(events);   // same instance the test seeds
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const norm = (e) => events.normalizeEvent({ ...e, source: 'discord' });

describe('posting window = start −30m … end +15m', () => {
  it('accepts 19:30 through 00:15 for a 20:00–00:00 event', () => {
    const ev = norm(RAID);
    const w  = events.windowFor(ev);
    expect(new Date(w.fromMs).toISOString()).toBe(new Date(RAID.startMs - 30 * MIN).toISOString());
    expect(new Date(w.untilMs).toISOString()).toBe(new Date(RAID.endMs + 15 * MIN).toISOString());

    expect(events.windowContains(ev, et('2026-07-30T19:29:00-04:00'))).toBe(false);
    expect(events.windowContains(ev, et('2026-07-30T19:30:00-04:00'))).toBe(true);
    expect(events.windowContains(ev, et('2026-07-30T22:00:00-04:00'))).toBe(true);
    expect(events.windowContains(ev, et('2026-07-31T00:15:00-04:00'))).toBe(true);
    expect(events.windowContains(ev, et('2026-07-31T00:16:00-04:00'))).toBe(false);
  });

  it('honours RAID_EVENT_PRE_MIN / _POST_MIN', () => {
    process.env.RAID_EVENT_PRE_MIN  = '60';
    process.env.RAID_EVENT_POST_MIN = '0';
    const ev = norm(RAID);
    expect(events.windowContains(ev, et('2026-07-30T19:00:00-04:00'))).toBe(true);
    expect(events.windowContains(ev, et('2026-07-31T00:01:00-04:00'))).toBe(false);
  });

  it('assumes a 4h length when the event has no end time', () => {
    const ev = norm({ id: 'x', title: 'Voice raid', startMs: RAID.startMs, endMs: NaN });
    expect(ev.assumedEnd).toBe(true);
    expect(ev.endMs - ev.startMs).toBe(4 * 60 * MIN);
    process.env.RAID_EVENT_DEFAULT_HOURS = '2';
    expect(norm({ id: 'x', startMs: RAID.startMs }).endMs - RAID.startMs).toBe(2 * 60 * MIN);
  });
});

describe('overlapping events resolve to the nearest start', () => {
  const A = norm({ id: 'a', title: 'Seru / Misc', startMs: et('2026-07-30T20:00:00-04:00'), endMs: et('2026-07-31T00:00:00-04:00') });
  const B = norm({ id: 'b', title: 'Vex Thal',    startMs: et('2026-07-30T22:00:00-04:00'), endMs: et('2026-07-31T01:00:00-04:00') });

  it('picks A early and B once B is nearer', () => {
    expect(events.pickEventAt([A, B], et('2026-07-30T20:30:00-04:00')).id).toBe('a');
    expect(events.pickEventAt([A, B], et('2026-07-30T21:30:00-04:00')).id).toBe('b');  // 21:30 is 30m from B's start, 90m from A's
    expect(events.pickEventAt([A, B], et('2026-07-31T00:30:00-04:00')).id).toBe('b');  // A's window closed at 00:15
  });

  it('returns null outside every window', () => {
    expect(events.pickEventAt([A, B], et('2026-07-30T12:00:00-04:00'))).toBe(null);
    expect(events.pickEventAt([], Date.now())).toBe(null);
  });
});

describe('raid vs event classification (day-of-night, configurable)', () => {
  it('Sun/Wed/Thu evening events are raids whatever they are called', () => {
    expect(events.classifyEvent(norm(RAID), TZ)).toBe('raid');
    expect(events.classifyEvent(norm({ id: 'c', title: 'Seru / Misc', startMs: et('2026-08-02T20:00:00-04:00') }), TZ)).toBe('raid'); // Sunday
    expect(events.classifyEvent(norm({ id: 'd', title: 'Bingo',       startMs: et('2026-07-29T20:00:00-04:00') }), TZ)).toBe('raid'); // Wednesday
  });

  it('Mon/Tue/Fri/Sat events are guild events', () => {
    expect(events.classifyEvent(norm(SOCIAL), TZ)).toBe('event');                                                                     // Friday
    expect(events.classifyEvent(norm({ id: 'e', title: 'Raid — alt night', startMs: et('2026-08-01T20:00:00-04:00') }), TZ)).toBe('event'); // Saturday
  });

  it('a raid-day DAYTIME event is still an event', () => {
    expect(events.classifyEvent(norm({ id: 'f', title: 'Tradeskill day', startMs: et('2026-07-30T13:00:00-04:00') }), TZ)).toBe('event');
  });

  it('post-midnight spillover keeps the night it started on', () => {
    // A Thursday raid whose event was (oddly) scheduled at 00:30 Friday still
    // belongs to Thursday night via the rollover.
    expect(events.classifyEvent(norm({ id: 'g', title: 'late pull', startMs: et('2026-07-31T00:30:00-04:00') }), TZ)).toBe('raid');
  });

  it('the day set and the hour floor are configurable', () => {
    process.env.RAID_EVENT_RAID_DAYS = 'friday';
    expect(events.classifyEvent(norm(SOCIAL), TZ)).toBe('raid');
    expect(events.classifyEvent(norm(RAID), TZ)).toBe('event');
    delete process.env.RAID_EVENT_RAID_DAYS;
    process.env.RAID_EVENT_RAID_FROM_HOUR = '21';
    expect(events.classifyEvent(norm(RAID), TZ)).toBe('event');   // 20:00 < 21:00 floor
  });

  it('title patterns override the day when set', () => {
    process.env.RAID_EVENT_SOCIAL_PATTERN = 'bingo|fun';
    expect(events.classifyEvent(norm({ id: 'h', title: 'Bingo', startMs: RAID.startMs }), TZ)).toBe('event');
    process.env.RAID_EVENT_RAID_PATTERN = 'vex thal';
    expect(events.classifyEvent(norm({ id: 'i', title: 'Vex Thal', startMs: SOCIAL.startMs }), TZ)).toBe('raid');
  });
});

describe('Raid-Helper enrichment merges into Discord, never over it', () => {
  it('keeps the Discord copy but borrows a real end time', () => {
    const d  = norm({ id: 'discord:1', title: 'Vex Thal', startMs: RAID.startMs });          // no end → assumed
    const rh = events.normalizeEvent({ id: 'rh:9', source: 'raid-helper', title: 'Vex Thal', startMs: RAID.startMs + 5 * MIN, endMs: RAID.endMs });
    const merged = events.mergeEventSources([d], [rh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('discord:1');
    expect(merged[0].endMs).toBe(RAID.endMs);
    expect(merged[0].assumedEnd).toBe(false);
  });

  it('adds an RH-only event Discord never got', () => {
    const rh = events.normalizeEvent({ id: 'rh:9', source: 'raid-helper', title: 'Sky', startMs: SOCIAL.startMs, endMs: SOCIAL.endMs });
    expect(events.mergeEventSources([], [rh]).map(e => e.id)).toEqual(['rh:9']);
    expect(events.mergeEventSources([norm(RAID)], []).map(e => e.id)).toEqual(['discord:1']);
  });
});

describe('planFor — which thread a timestamp wants', () => {
  const client = { user: { id: 'bot' } };
  const seed = (list) => events._seed(list.map(e => ({ ...e, source: 'discord' })), Date.now());

  it('a raid event threads as the night thread', async () => {
    seed([RAID]);
    const plan = await raidNight.planFor(client, et('2026-07-30T21:00:00-04:00'));
    expect(plan.kind).toBe('raid');
    expect(plan.name).toBe('🗡️ Raid Night — Thursday, July 30, 2026');
    expect(plan.key).toBe(raidNight.nightKey(RAID.startMs));
    expect(plan.why).toMatch(/raid event "Vex Thal"/);   // the EVENT drove it, not the weekday fallback
    expect(plan.event.id).toBe('discord:1');
  });

  it('the pre-window opens 30 min before the event start', async () => {
    seed([RAID]);
    expect(await raidNight.planFor(client, et('2026-07-30T19:29:00-04:00'))).toBe(null);
    const plan = await raidNight.planFor(client, et('2026-07-30T19:31:00-04:00'));
    expect(plan.kind).toBe('raid');
    expect(plan.why).toMatch(/raid event/);
  });

  it('a post-midnight kill shares the raid thread', async () => {
    seed([RAID]);
    const a = await raidNight.planFor(client, et('2026-07-30T23:50:00-04:00'));
    const b = await raidNight.planFor(client, et('2026-07-31T00:10:00-04:00'));
    expect(b.key).toBe(a.key);
    expect(b.name).toBe(a.name);
  });

  it('an off-night event threads separately, keyed on the event', async () => {
    seed([SOCIAL]);
    const plan = await raidNight.planFor(client, et('2026-07-31T21:30:00-04:00'));
    expect(plan.kind).toBe('event');
    expect(plan.name).toBe('🎲 Bingo Night — Friday, July 31, 2026');
    expect(plan.key).toBe('evt_discord_2');
  });

  it('outside every window the default fallback only fires in the raid window', async () => {
    seed([]);
    // Friday 07:32 ET — the exact case that minted "⚔️ Kill Log — Friday" in
    // #raid-mobs on night one.
    expect(await raidNight.planFor(client, et('2026-07-31T07:32:00-04:00'))).toBe(null);
    // Thursday 21:00 with no event scheduled — the safety net still works.
    const plan = await raidNight.planFor(client, et('2026-07-30T21:00:00-04:00'));
    expect(plan.kind).toBe('raid');
    expect(plan.why).toMatch(/fallback:schedule/);
  });

  it('RAID_NIGHT_FALLBACK=off and =always', async () => {
    seed([]);
    process.env.RAID_NIGHT_FALLBACK = 'off';
    expect(await raidNight.planFor(client, et('2026-07-30T21:00:00-04:00'))).toBe(null);
    process.env.RAID_NIGHT_FALLBACK = 'always';
    const plan = await raidNight.planFor(client, et('2026-07-31T07:32:00-04:00'));
    expect(plan.kind).toBe('raid');
    expect(plan.name).toMatch(/^⚔️ Kill Log — Friday/);
  });
});

describe('volume filter', () => {
  const golem = { durationSec: 1, playerCount: 1, isBoss: false };
  const pull  = { durationSec: 45, playerCount: 12, isBoss: false };
  const boss  = { durationSec: 3, playerCount: 1, isBoss: true };

  it('drops the 1-player/1-second trash card and keeps real pulls + bosses', () => {
    expect(raidNight.parseCardPassesFilter(golem)).toBe(false);
    expect(raidNight.parseCardPassesFilter(pull)).toBe(true);
    expect(raidNight.parseCardPassesFilter(boss)).toBe(true);
  });

  it('zeroing both floors restores v1 "post everything"', () => {
    process.env.RAID_NIGHT_THREAD_MIN_SECONDS = '0';
    process.env.RAID_NIGHT_THREAD_MIN_PLAYERS = '0';
    expect(raidNight.parseCardPassesFilter(golem)).toBe(true);
  });

  it('BOSS_ONLY=1 is the strict setting', () => {
    process.env.RAID_NIGHT_THREAD_BOSS_ONLY = '1';
    expect(raidNight.parseCardPassesFilter(pull)).toBe(false);
    expect(raidNight.parseCardPassesFilter(boss)).toBe(true);
  });
});

describe('off-night roll loot', () => {
  const t0 = Date.parse('2026-07-31T22:00:00-04:00');
  const iso = (ms) => new Date(ms).toISOString();
  const rows = [
    { roll_from: 0, roll_to: 1000, item: 'Fungus Covered Scale Tunic', qty: 1, started_at: iso(t0), last_at: iso(t0 + 40_000),
      rolls: [{ name: 'Hitya', value: 900, at: iso(t0 + 1000) }, { name: 'Uilnayar', value: 512, at: iso(t0 + 2000) }] },
    // the same set as a second parser saw it
    { roll_from: 0, roll_to: 1000, item: 'Fungus Covered Scale Tunic', qty: 1, started_at: iso(t0 + 2000), last_at: iso(t0 + 41_000),
      rolls: [{ name: 'Hitya', value: 900, at: iso(t0 + 1500) }, { name: 'Shavimo', value: 999, at: iso(t0 + 3000) }] },
    { roll_from: 0, roll_to: 100, item: 'Velium Battlehammer', qty: 2, started_at: iso(t0 + 600_000), last_at: iso(t0 + 640_000),
      rolls: [{ name: 'Grobnar', value: 88, at: iso(t0 + 601_000) }, { name: 'Utoh', value: 71, at: iso(t0 + 602_000) }, { name: 'Syrl', value: 12, at: iso(t0 + 603_000) }] },
  ];
  const looted = [{ looter_character: 'Shavimo', item_name: 'Fungus Covered Scale Tunic', looted_at: iso(t0 + 120_000) }];

  it('merges multi-uploader sets and names the winner', () => {
    const s = buildRollSessions(rows, looted);
    const tunic = s.find(x => /Fungus/.test(x.item));
    expect(tunic.rollers).toBe(3);
    expect(tunic.winners.map(w => w.name)).toEqual(['Shavimo']);
    expect(tunic.from).toBe(0);
    expect(tunic.to).toBe(1000);
  });

  it('a qty-2 drop names two winners', () => {
    const s = buildRollSessions(rows, []);
    const hammer = s.find(x => /Velium/.test(x.item));
    expect(hammer.qty).toBe(2);
    expect(hammer.winners.map(w => w.name)).toEqual(['Grobnar', 'Utoh']);
  });

  it('a looter who is NOT the winner is called out', () => {
    const other = [{ looter_character: 'Uilnayar', item_name: 'Fungus Tunic', looted_at: iso(t0 + 120_000) }];
    const s = buildRollSessions(rows, other);
    const lines = renderRollLootLines(s);
    expect(lines.join('\n')).toMatch(/looted by Uilnayar/);
    // …and the winner looting their own item produces no extra line
    expect(renderRollLootLines(buildRollSessions(rows, looted)).join('\n')).not.toMatch(/looted by/);
  });

  it('renders item + assigned range + winner', () => {
    const line = renderRollLootLines(buildRollSessions(rows, looted))[0];
    expect(line).toMatch(/roll `0–100`|roll `0–1000`/);
    expect(line).toMatch(/🏆/);
  });

  it('item matching is tolerant but not sloppy', () => {
    expect(itemsMatch('Fungus Covered Scale Tunic', 'Fungus Tunic')).toBe(true);
    expect(itemsMatch('velium battlehammer', 'Primal Velium Battlehammer')).toBe(true);
    expect(itemsMatch('Ring of the Ancients', 'Sword of the Ancients')).toBe(false);
  });
});
