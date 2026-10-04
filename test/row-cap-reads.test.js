// test/row-cap-reads.test.js — timer recovery and the raid review read EVERY boss kill, not the first
// 1,000 rows PostgREST would hand back.
//
// The guild lead asked for a review of every table for silent row caps (2026-10-04). PostgREST answers
// at most 1,000 rows per response, says nothing about the rest, and `limit=3000` does not lift it.
// `encounters` grew from ~100 rows a week to ~5,500 once every named mob auto-registered (2026-08-19),
// and two readers had been written for the small table:
//
//   · utils/reconcileKills.js — timer recovery (startup, every 6 h, /recoverkills) read the newest
//     1,000 encounters and picked each boss's newest kill out of them. Those reached back under a day,
//     so after a redeploy (state.json does not persist on Railway) a boss killed two days ago came back
//     as "Available now".
//   · utils/raidReview.js collectNightData — the review and its live card read the night's first 400
//     encounters by start time. A night is 500-1,300 rows; on 2026-09-27 all 20 bosses ranked 673-742,
//     so the card saw only daytime trash. Its dependents (contributions, fun events, per-boss history,
//     the pace baseline) were capped the same way.
//
// These run the REAL functions against a fake PostgREST that cuts responses at 1,000 rows like the
// server does (test/_fake-postgrest.js), so a read that only works on a small table fails here. The
// fake's `truncated` list is the generic assertion: no unpaged read came back short of what matched.
//
// The SQL itself (supabase/migrations/20261004140000_*, 20261004140100_*) is checked two ways: the
// text assertions at the bottom, and — outside this suite, 2026-10-04 — by running both files twice
// (idempotent) against a scratch Postgres 16 with synthetic rows: a started_at tie, the half-open
// window edge, null and empty event types, the upper-middle median of an even sample, unconfirmed and
// zero-duration kills, another guild's rows, and the service_role-only grants. All matched.
//
// Run: npx vitest run test/row-cap-reads.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as events from '../utils/raidEvents.js';
import * as raidNight from '../utils/raidNight.js';
import { makeFakePostgrest, CAP } from './_fake-postgrest.js';
import { ROOT, stripSql } from './_source-slice.js';

const raidReview = require('../utils/raidReview.js');
const reconcile  = require('../utils/reconcileKills.js');
const realSupabase = require('../utils/supabase.js');
const BOSSES = require('../data/bosses.json');

const GUILD = 'wolfpack';
const iso = (ms) => new Date(ms).toISOString();

// The fake must really cut: a fixture smaller than the cap proves nothing (the vacuous-assertion trap).
describe('the fake PostgREST really enforces the cap', () => {
  it('cuts an unpaged read at 1,000 and flags it; a paged read walks past it', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `r${String(i).padStart(4, '0')}`, k: 'x' }));
    const fake = makeFakePostgrest({ t: rows });
    expect(await fake.select('t', 'k=eq.x&limit=5000')).toHaveLength(CAP);
    expect(await fake.select('t', 'k=eq.x&limit=400')).toHaveLength(400);
    expect(fake.truncated).toHaveLength(2);
    expect(await fake.selectAllPaged('t', 'k=eq.x', 'id')).toHaveLength(2500);
    expect(fake.truncated).toHaveLength(2);        // the paged walk is not a truncation
  });

  it('a tie in the order column pages unreliably — only a unique column is safe', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `r${i}`, same: 1 }));
    const fake = makeFakePostgrest({ t: rows });
    const got = await fake.selectAllPaged('t', 'same=eq.1', 'same');
    expect(new Set(got.map(r => r.id)).size).toBeLessThan(2500);   // repeats and skips
  });
});

// ── Timer recovery ──────────────────────────────────────────────────────────

const STATE_FILE = path.join(ROOT, 'data', 'state.json');
const NOW = Date.parse('2026-10-04T17:00:00Z');
const H = 3_600_000;
const CURATED_BASE = 10_000;      // bosses_local.npc_id for the i-th boss in data/bosses.json
const AUTO_BASE = 500_000;
const npcOf = (bossId) => CURATED_BASE + BOSSES.findIndex(b => b.id === bossId);

function reconcileTables() {
  const bosses_local = BOSSES.map((b, i) => ({ npc_id: CURATED_BASE + i, internal_id: b.id, auto_registered: false }));
  for (let n = 0; n < 1800; n++) bosses_local.push({ npc_id: AUTO_BASE + n, internal_id: `a_mob_${n}`, auto_registered: true });
  const encounters = [];
  let id = 0;
  const add = (npc_id, ageH) => encounters.push({
    id: `enc-${id++}`, guild_id: GUILD, npc_id, zone_short: 'z',
    started_at: iso(NOW - ageH * H), ended_at: iso(NOW - ageH * H + 60_000),
  });
  // 6,000 trash encounters, one a minute for the last 100 hours: they ARE the newest 1,000 (and then some).
  for (let i = 0; i < 6000; i++) encounters.push({
    id: `trash-${i}`, guild_id: GUILD, npc_id: AUTO_BASE + (i % 1800), zone_short: 'z',
    started_at: iso(NOW - i * 60_000), ended_at: iso(NOW - i * 60_000 + 20_000),
  });
  add(npcOf('lord_nagafen'), 120);        // 5 days ago, 162 h timer → up for 42 h more
  add(npcOf('lord_nagafen'), 144);        // an older kill of the same boss: must lose to the newer
  add(npcOf('lady_vox'), 101);            // behind every trash row; 162 h timer → 61 h more
  add(npcOf('magi_rokyl'), 70);           // 18 h timer → long since respawned
  add(npcOf('trakanon'), 30);             // 66 h timer, an older kill…
  add(npcOf('trakanon'), 10);             // …and its newer one: 56 h more
  return { bosses_local, encounters };
}

describe('timer recovery (utils/reconcileKills.js)', () => {
  let hadState, savedState, keep;
  beforeEach(() => {
    hadState = fs.existsSync(STATE_FILE);
    savedState = hadState ? fs.readFileSync(STATE_FILE, 'utf8') : null;
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, '{}');            // recovery reads data/state.json — start from a known-empty board
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    keep = { isEnabled: realSupabase.isEnabled, select: realSupabase.select, rpc: realSupabase.rpc };
  });
  afterEach(() => {
    Object.assign(realSupabase, keep);
    vi.useRealTimers();
    delete process.env.SUPABASE_GUILD_ID;
    if (hadState) fs.writeFileSync(STATE_FILE, savedState);
    else { try { fs.unlinkSync(STATE_FILE); } catch { /* never existed */ } }
  });
  const useFake = (fake) => Object.assign(realSupabase, { isEnabled: () => true, select: fake.select, rpc: fake.rpc });

  it('recovers a boss killed 5 days ago from behind 6,000 newer trash rows', async () => {
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.recoverList.map(x => x.bossId)).toEqual(['lord_nagafen', 'trakanon', 'lady_vox']);   // by respawn time
    const by = Object.fromEntries(r.recoverList.map(x => [x.bossId, x]));
    expect(by.lord_nagafen.killedAt).toBe(NOW - 120 * H);               // the newer of its two kills
    expect(by.lord_nagafen.nextSpawn).toBe(NOW - 120 * H + 162 * H);
    expect(by.trakanon.killedAt).toBe(NOW - 10 * H);
    expect(by.lady_vox.nextSpawn).toBe(NOW - 101 * H + 162 * H);
    expect(r.skipped.alreadyRespawned).toBe(1);                         // magi_rokyl
    expect(fake.truncated).toEqual([]);                                 // nothing it read was cut short
  });

  it('asks only for the tracked bosses, for this guild, over the default window', async () => {
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    const rpc = fake.calls.filter(c => c.kind === 'rpc');
    expect(rpc).toHaveLength(1);
    expect(rpc[0].fn).toBe('latest_kill_per_npc');
    expect(Object.keys(rpc[0].params).sort()).toEqual(['p_guild_id', 'p_npc_ids', 'p_since']);
    expect(rpc[0].params.p_guild_id).toBe(GUILD);
    expect(rpc[0].params.p_since).toBe(iso(NOW - 186 * H));
    expect(rpc[0].params.p_npc_ids.slice().sort((a, b) => a - b))
      .toEqual(BOSSES.map((_, i) => CURATED_BASE + i));                // every tracked boss, no auto-registered mob
    // And no unfiltered encounter scan sneaks back in alongside it.
    expect(fake.calls.filter(c => c.kind === 'select' && c.table === 'encounters')).toEqual([]);
  });

  it('the guild comes from SUPABASE_GUILD_ID, like the rest of the bot', async () => {
    process.env.SUPABASE_GUILD_ID = 'other';
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    expect(fake.calls.find(c => c.kind === 'rpc').params.p_guild_id).toBe('other');
    expect(r.recoverList).toEqual([]);                                  // no 'other' rows
  });

  it('honours an explicit /recoverkills window', async () => {
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true, sinceMs: 48 * H });
    expect(r.recoverList.map(x => x.bossId)).toEqual(['trakanon']);     // the 5-day-old kills are outside 48 h
    expect(fake.calls.find(c => c.kind === 'rpc').params.p_since).toBe(iso(NOW - 48 * H));
  });

  it('fails open when the read fails: nothing recovered, nothing thrown', async () => {
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    realSupabase.rpc = async () => null;                                // PostgREST error / breaker open → null
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    expect(r).toMatchObject({ ok: true, recoverList: [], scanned: 0 });
  });

  it('fails open when the tracked-boss lookup fails, without reading encounters at all', async () => {
    const fake = makeFakePostgrest(reconcileTables());
    useFake(fake);
    realSupabase.select = async () => null;
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    expect(r).toMatchObject({ ok: true, recoverList: [], scanned: 0 });
    expect(fake.calls.filter(c => c.kind === 'rpc')).toEqual([]);
  });
});

// ── The raid review ─────────────────────────────────────────────────────────

const TZ = 'America/New_York';
const AT = Date.parse('2026-09-27T21:00:00-04:00');     // the Sunday that ranked its bosses 673-742
const BOSS_N = 20;
const nameFor = (i) => String.fromCharCode(65 + (Math.floor(i / 676) % 26), 97 + (Math.floor(i / 26) % 26), 97 + (i % 26));
const RAIDERS = [1100, 1101, 1102].map(nameFor);        // late in the roster: a capped read of it drops them

function reviewTables(win) {
  const bosses_local = [];
  for (let k = 0; k < BOSS_N; k++) bosses_local.push({ npc_id: CURATED_BASE + k, internal_id: `boss_${k}`, auto_registered: false });
  for (let n = 0; n < 300; n++) bosses_local.push({ npc_id: AUTO_BASE + n, internal_id: `a_mob_${n}`, auto_registered: true });

  const encounters = [];
  const row = (id, npc_id, startMs, dur, players = []) => ({
    id, guild_id: GUILD, npc_id, started_at: iso(startMs), ended_at: iso(startMs + dur * 1000),
    duration_sec: dur, total_damage: 300_000, total_dps: 500, zone_short: 'ssratemple', classification: null,
    eqemu_npc_types: { name: npc_id >= AUTO_BASE ? `a_trash_${npc_id - AUTO_BASE}` : `#boss_${npc_id - CURATED_BASE}`, zone_short: null },
    encounter_players: players,
  });
  // 2,500 trash encounters across the first 15 hours of the night: more than the old 400 AND the 1,000 cap.
  for (let i = 0; i < 2500; i++) encounters.push(row(`trash-${i}`, AUTO_BASE + (i % 300), win.fromMs + H + i * 20_000, 15));
  // 20 boss kills in the last stretch of the night, ten minutes apart. Boss 0 and boss 19 run long.
  for (let k = 0; k < BOSS_N; k++) {
    const players = RAIDERS.map((n, j) => ({ character_name: n, total_damage: 100_000 - j, dps: 500 - j, rank: j + 1 }));
    encounters.push(row(`boss-${k}`, CURATED_BASE + k, win.fromMs + 15 * H + k * 600_000, k === 0 || k === BOSS_N - 1 ? 400 : 200, players));
  }
  // Our own history: 60 prior kills of each boss, 200 s each, every 0.7 day (all inside 45 days, 1,200 rows).
  for (let k = 0; k < BOSS_N; k++) for (let j = 0; j < 60; j++) {
    encounters.push(row(`prior-${k}-${j}`, CURATED_BASE + k, win.fromMs - (j + 1) * 0.7 * 24 * H, 200));
  }
  // …and 4,000 confirmed trash kills in those same 45 days, which must not reach the pace baseline.
  for (let i = 0; i < 4000; i++) encounters.push(row(`prior-trash-${i}`, AUTO_BASE + (i % 300), win.fromMs - H * 12 - i * 600_000, 15));

  const characters = Array.from({ length: 1200 }, (_, i) => ({ guild_id: GUILD, name: nameFor(i), class: 'Monk', exclude_from_stats: false }));

  // 60 uploaders per boss fight = 1,200 contribution rows. Boss 19's are the LAST 60; its one death rides on them.
  const contributions = [];
  for (let k = 0; k < BOSS_N; k++) for (let j = 0; j < 60; j++) {
    const startMs = win.fromMs + 15 * H + k * 600_000;
    contributions.push({
      id: `c-${String(k).padStart(2, '0')}-${String(j).padStart(2, '0')}`, encounter_id: `boss-${k}`,
      contributor_character: nameFor(2000 + j),
      deaths: k === BOSS_N - 1 && j === 0 ? [{ name: RAIDERS[0], ts: iso(startMs + 60_000), class: 'Monk' }] : [],
    });
  }

  const fun_events = [];
  const fun = (type, n, off) => { for (let i = 0; i < n; i++) fun_events.push({ guild_id: GUILD, event_type: type, caster: `c${i}`, event_ts: iso(win.fromMs + 2 * H + off + i * 5000) }); };
  fun('drunkard', 2000, 0); fun('dragon_punch', 1500, 3 * H); fun('summon_food', 10, 6 * H);
  for (let i = 0; i < 500; i++) fun_events.push({ guild_id: GUILD, event_type: 'drunkard', caster: `y${i}`, event_ts: iso(win.fromMs - 2 * H - i * 1000) });  // the day before

  return { bosses_local, encounters, characters, contributions, fun_events };
}

describe('the raid review reads every boss kill (utils/raidReview.js collectNightData)', () => {
  let saved, win, fake;
  beforeEach(() => {
    saved = process.env.TZ_DEFAULT;
    process.env.TZ_DEFAULT = TZ;
    events._resetCache();
    raidNight._resetCache();
    raidNight._setEventsModule(events);
    raidReview._clearTimer();
    raidReview._clearLiveCaches();
    win = raidReview.nightWindowFor(AT);
    fake = makeFakePostgrest(reviewTables(win));
    raidReview._setDeps({ raidNight, supabase: fake });
  });
  afterEach(() => {
    raidReview._clearTimer();
    raidReview._clearLiveCaches();
    raidReview._setDeps({});
    if (saved === undefined) delete process.env.TZ_DEFAULT; else process.env.TZ_DEFAULT = saved;
  });

  it('the fixture is bigger than the old reads: the night, its contributions, its roster', () => {
    const t = fake.tables;
    const inNight = t.encounters.filter(e => Date.parse(e.started_at) >= win.fromMs && Date.parse(e.started_at) < win.toMs);
    expect(inNight.length).toBeGreaterThan(2500);
    expect(t.contributions.length).toBeGreaterThan(CAP);
    expect(t.characters.length).toBeGreaterThan(CAP);
    expect(t.fun_events.length).toBeGreaterThan(CAP);
  });

  it('all 20 bosses reach the card, in pull order, with their players and uploaders', async () => {
    const data = await raidReview.collectNightData(win);
    expect(data.encounters).toHaveLength(BOSS_N);
    expect(data.encounters.every(e => e.npc_id >= CURATED_BASE && e.npc_id < CURATED_BASE + BOSS_N)).toBe(true);
    const starts = data.encounters.map(e => Date.parse(e.started_at));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(data.encounters.every(e => e.encounter_players.length === 3)).toBe(true);

    const sum = raidReview.summarizeNight(data);
    expect(sum.kills).toHaveLength(BOSS_N);
    expect(sum.kills.map(k => k.boss)).toEqual(Array.from({ length: BOSS_N }, (_, k) => `boss ${k}`));
    expect(sum.raiders).toBe(3);                 // the roster read reached the late names
    expect(sum.uploaders).toBe(60);
  });

  it('no read the review makes is silently cut short', async () => {
    await raidReview.collectNightData(win);
    expect(fake.truncated).toEqual([]);
    await raidReview.collectNightData(win, { live: true });
    expect(fake.truncated).toEqual([]);
  });

  it('every encounters read is limited to the tracked bosses on the way in', async () => {
    await raidReview.collectNightData(win, { live: true });
    const reads = fake.calls.filter(c => c.kind === 'select' && c.table === 'encounters');
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) {
      expect(c.query).toMatch(/npc_id=in\.\(/);
      expect(c.query).not.toContain(`${AUTO_BASE}`);
    }
  });

  it('contributions past the 1,000th row still count — the death on the last boss is on the card', async () => {
    const data = await raidReview.collectNightData(win);
    expect(data.deathContribs).toHaveLength(1200);
    // 1,200 DISTINCT rows: a page walk on a non-unique column repeats some and skips others, and the
    // count alone would not show it.
    expect(new Set(data.deathContribs.map(c => `${c.encounter_id}|${c.contributor_character}`)).size).toBe(1200);
    const sum = raidReview.summarizeNight(data);
    expect(sum.deathsAvailable).toBe(true);
    expect(sum.deaths).toHaveLength(1);
    expect(sum.deaths[0].boss).toBe(`boss ${BOSS_N - 1}`);
  });

  it('the roster read is paged: 1,200 characters, none dropped', async () => {
    const data = await raidReview.collectNightData(win);
    expect(data.characters).toHaveLength(1200);
    expect(new Set(data.characters.map(c => c.name)).size).toBe(1200);
  });

  it('the campfire line counts every event of the night, not the first 1,000', async () => {
    const data = await raidReview.collectNightData(win);
    expect(data.funCounts).toEqual([
      { event_type: 'drunkard', n: 2000 }, { event_type: 'dragon_punch', n: 1500 }, { event_type: 'summon_food', n: 10 },
    ]);
    expect(raidReview.summarizeNight(data).fun).toEqual([{ type: 'drunkard', n: 2000 }, { type: 'dragon_punch', n: 1500 }]);
    expect(fake.calls.some(c => c.kind === 'select' && c.table === 'fun_events')).toBe(false);   // counted in SQL
  });

  it('"slower than our own median" has a baseline for every boss, including the last ones', async () => {
    const data = await raidReview.collectNightData(win);
    expect(data.historyStats).toHaveLength(BOSS_N);
    expect(data.historyStats[BOSS_N - 1]).toEqual({ npc_id: CURATED_BASE + BOSS_N - 1, n: 60, median_sec: 200 });
    const slow = raidReview.summarizeNight(data).slowFights.map(s => s.boss).sort();
    expect(slow).toEqual(['boss 0', 'boss 19']);                  // 400 s against a 200 s median
  });

  it('the pace baseline is the tracked bosses only (live), and is empty for the final review', async () => {
    expect((await raidReview.collectNightData(win)).paceHistory).toEqual([]);
    raidReview._clearLiveCaches();
    const live = await raidReview.collectNightData(win, { live: true });
    expect(live.paceHistory).toHaveLength(BOSS_N * 60);           // 1,200 rows: it had to page, and the 4,000 trash kills are not in it
    expect(new Set(live.paceHistory.map(r => r.id)).size).toBe(BOSS_N * 60);
    expect(live.paceHistory.every(r => r.id.startsWith('prior-') && !r.id.startsWith('prior-trash'))).toBe(true);
    expect(fake.calls.filter(c => c.kind === 'select' && c.table === 'encounters' && c.query.includes('ended_at=not.is.null')).length)
      .toBeGreaterThan(1);                                         // the baseline walked more than one page
  });

  it('the live card reads the tracked-boss list once, and a failed read is not remembered', async () => {
    await raidReview.collectNightData(win, { live: true });
    await raidReview.collectNightData(win, { live: true });
    expect(fake.calls.filter(c => c.table === 'bosses_local')).toHaveLength(1);

    raidReview._clearLiveCaches();
    const realSelect = fake.select;
    let failBosses = true;
    fake.select = async (table, qs) => (table === 'bosses_local' && failBosses ? null : realSelect(table, qs));
    const blip = await raidReview.collectNightData(win, { live: true });
    expect(blip.encounters).toEqual([]);                           // same as the old failed-read path: no kills, no card yet
    failBosses = false;
    const next = await raidReview.collectNightData(win, { live: true });
    expect(next.encounters).toHaveLength(BOSS_N);                  // the next refresh recovers, not six hours later
  });

  it('end to end: /raidreview dry run through the real collector lists all 20', async () => {
    const r = await raidReview.postRaidNightReview(null, { atMs: AT, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.summary.kills).toHaveLength(BOSS_N);
    const fields = r.embeds[0].data.fields;
    expect(fields.some(f => f.name === `🏆 Kills (${BOSS_N})`)).toBe(true);
  });
});

// ── The migrations ──────────────────────────────────────────────────────────

const MIG = (f) => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const paramNames = (sql, fn) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${fn}\\(([^)]*)\\)`, 'i'));
  return m ? m[1].split(',').map(p => p.trim().split(/\s+/)[0]).sort() : null;
};
const lockedDown = (sql, sig) => {
  for (const who of ['public', 'anon', 'authenticated']) {
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig.replace(/[()[\]]/g, '\\$&')} from ${who};`, 'i'));
  }
  expect(sql).toMatch(new RegExp(`grant execute on function ${sig.replace(/[()[\]]/g, '\\$&')} to service_role;`, 'i'));
};

describe('migration 20261004140000_latest_kill_per_npc.sql', () => {
  const raw = MIG('20261004140000_latest_kill_per_npc.sql');
  const sql = squash(stripSql(raw));

  it('creates latest_kill_per_npc idempotently, one newest row per npc', () => {
    expect(sql).toMatch(/create or replace function public\.latest_kill_per_npc\(p_guild_id text, p_since timestamptz, p_npc_ids int\[\]\)/i);
    expect(sql).toMatch(/returns table\(npc_id int, started_at timestamptz, zone_short text, id uuid\)/i);
    expect(sql).toMatch(/select distinct on \(e\.npc_id\) e\.npc_id, e\.started_at, e\.zone_short, e\.id/i);
    expect(sql).toMatch(/order by e\.npc_id, e\.started_at desc, e\.id/i);
  });

  it('filters by guild, window and the asked-for npcs; keeps the old no-ended_at meaning', () => {
    expect(sql).toMatch(/e\.guild_id = p_guild_id/i);
    expect(sql).toMatch(/e\.started_at >= p_since/i);
    expect(sql).toMatch(/e\.npc_id = any\(p_npc_ids\)/i);
    expect(sql).not.toMatch(/ended_at/i);
  });

  it('is a plain invoker function, locked to service_role', () => {
    expect(sql).toMatch(/language sql stable security invoker set search_path = public/i);
    expect(sql).not.toMatch(/security definer/i);
    lockedDown(sql, 'public.latest_kill_per_npc(text, timestamptz, int[])');
  });

  it('declares exactly the parameters the bot sends', async () => {
    const fake = makeFakePostgrest({ bosses_local: [{ npc_id: 1, internal_id: BOSSES[0].id, auto_registered: false }], encounters: [] });
    const keep = { isEnabled: realSupabase.isEnabled, select: realSupabase.select, rpc: realSupabase.rpc };
    Object.assign(realSupabase, { isEnabled: () => true, select: fake.select, rpc: fake.rpc });
    try { await reconcile.reconcileKillsFromSupabase({ dryRun: true }); } finally { Object.assign(realSupabase, keep); }
    const call = fake.calls.find(c => c.kind === 'rpc');
    expect(Object.keys(call.params).sort()).toEqual(paramNames(sql, 'latest_kill_per_npc'));
  });
});

describe('migration 20261004140100_raid_review_aggregates.sql', () => {
  const raw = MIG('20261004140100_raid_review_aggregates.sql');
  const sql = squash(stripSql(raw));

  it('creates raid_review_fun_counts: a count per event type over a half-open window', () => {
    expect(sql).toMatch(/create or replace function public\.raid_review_fun_counts\(p_guild_id text, p_from timestamptz, p_to timestamptz\)/i);
    expect(sql).toMatch(/returns table\(event_type text, n bigint\)/i);
    expect(sql).toMatch(/f\.event_ts >= p_from and f\.event_ts < p_to/i);
    expect(sql).toMatch(/f\.event_type is not null and f\.event_type <> ''/i);
    expect(sql).toMatch(/group by f\.event_type order by count\(\*\) desc, f\.event_type/i);
  });

  it('creates raid_review_history_medians: sorted[floor(n/2)] over confirmed kills with a duration', () => {
    expect(sql).toMatch(/create or replace function public\.raid_review_history_medians\(p_guild_id text, p_npc_ids int\[\], p_since timestamptz, p_until timestamptz\)/i);
    expect(sql).toMatch(/returns table\(npc_id int, n bigint, median_sec int\)/i);
    expect(sql).toMatch(/row_number\(\) over \(partition by e\.npc_id order by e\.duration_sec\) - 1 as rn/i);
    expect(sql).toMatch(/count\(\*\) over \(partition by e\.npc_id\) as n/i);
    expect(sql).toMatch(/where h\.rn = h\.n \/ 2/i);
    expect(sql).toMatch(/e\.ended_at is not null and e\.duration_sec > 0/i);
    expect(sql).toMatch(/e\.started_at >= p_since and e\.started_at < p_until/i);
    expect(sql).toMatch(/e\.npc_id = any\(p_npc_ids\)/i);
  });

  it('both are plain invoker functions, locked to service_role', () => {
    expect((sql.match(/language sql stable security invoker set search_path = public/gi) || []).length).toBe(2);
    expect(sql).not.toMatch(/security definer/i);
    lockedDown(sql, 'public.raid_review_fun_counts(text, timestamptz, timestamptz)');
    lockedDown(sql, 'public.raid_review_history_medians(text, int[], timestamptz, timestamptz)');
  });

  it('declare exactly the parameters the bot sends', async () => {
    const fake = makeFakePostgrest(reviewTables(raidReview.nightWindowFor(AT)));
    process.env.TZ_DEFAULT = TZ;
    raidReview._setDeps({ raidNight, supabase: fake });
    try { await raidReview.collectNightData(raidReview.nightWindowFor(AT)); }
    finally { raidReview._setDeps({}); raidReview._clearLiveCaches(); delete process.env.TZ_DEFAULT; }
    for (const fn of ['raid_review_fun_counts', 'raid_review_history_medians']) {
      const call = fake.calls.find(c => c.kind === 'rpc' && c.fn === fn);
      expect(call, `${fn} was never called`).toBeTruthy();
      expect(Object.keys(call.params).sort()).toEqual(paramNames(sql, fn));
    }
  });
});
