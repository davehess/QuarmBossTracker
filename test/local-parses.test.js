// test/local-parses.test.js — "My parses" on the local site (web/local, bundled into Mimic), and the difference from the
// guild's record.
//
// The agent half is two read-only routes (GET /api/local/parses, /api/local/parses/<id>) over what this PC recorded
// (logsync.myfights.json + the History ring + `fight` records in the local store), plus a FEATURE-DETECTED read of the
// hub's GET /api/agent/local-sync that keeps the guild's merged encounters in the store (kind `hub_encounter`). The page
// half is a client component, so its contract is pinned as text (comments stripped). Names are invented.
// Run: npx vitest run test/local-parses.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);     // 21:00 ET on Oct 4
const iso = (ms) => new Date(ms).toISOString();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const OPTS = { token: 'member-token', botUrl: 'https://bot.example/api/agent/encounter', dryRun: false };

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-parses-'));
  store = agent._localStoreOpen(dir);
  agent._localTrackSetStoreForTest(store);
  agent._localHubResetForTest();
  agent._resetFightHistoryForTest();
  agent._setMyFightsForTest([]);
});
afterEach(() => {
  agent._localTrackSetStoreForTest(null);
  agent._localHubResetForTest();
  agent._resetFightHistoryForTest();
  agent._setMyFightsForTest([]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- fixtures: one boss fight this PC recorded, and the guild's merged record of the same fight ----

/** The fight log's row for Aldenmar and the ring's whole local view of it (Aldenmar + his pet, Brackwyn, Rethlan the healer). */
function recordFight(startMs = T0, mob = 'Corvale_the_Pale') {
  agent._setMyFightsForTest([
    { t: iso(startMs), end: iso(startMs + 180_000), mob, zone: 'Plane of Fear', char: 'Aldenmar', dmg: 90_000, dur: 180, dps: 500, boss: true },
  ]);
  agent._fightHistoryForTest().push({
    boss: mob, startedMs: startMs, endedMs: startMs + 180_000, durationSec: 180, upload: 'sent', settled: false, players: [],
    local: [
      { character: 'Aldenmar', dmg: 80_000, first_ms: startMs, last_ms: startMs + 160_000, took: 3000 },
      { character: 'Gorbash', dmg: 10_000, pet_owner: 'Aldenmar' },
      { character: 'Brackwyn', dmg: 120_000, took: 90_000, tookMax: 4000 },
      { character: 'Rethlan', dmg: 1000, took: 2000, heal: 40_000 },
    ],
    deaths: [{ name: 'Rethlan', at: 150 }],
  });
}

/** What the hub's /api/agent/local-sync sends for the same kill: more players than this PC saw, one opted out. */
function hubEncounter(over = {}) {
  return {
    id: 'e1000000-0000-4000-8000-000000000001', npc_id: 2231, name: 'Corvale the Pale', zone: 'fear', started_at: iso(T0 + 40_000), ended_at: iso(T0 + 215_000),
    duration_sec: 175, total_damage: 436_000, total_dps: 2491, classification: null, incomplete: false, updated_at: iso(T0 + 300_000),
    players: [
      { name: 'Nyssara', class: 'Wizard', damage: 140_000, dps: 800, duration: 175, pets: false, rank: 1 },
      { name: 'Brackwyn', class: 'Warrior', damage: 120_000, dps: 685, duration: 175, pets: false, rank: 2 },
      { name: 'Aldenmar', class: 'Necromancer', damage: 95_000, dps: 540, duration: 175, pets: true, rank: 3 },
      { name: 'Zarrin', class: 'Rogue', damage: 50_000, dps: 285, duration: 175, pets: false, rank: 4 },
      { name: 'Wizard 2', class: 'Wizard', damage: 30_000, dps: 171, duration: 175, pets: false, rank: 5, anon: true },
      { name: 'Rethlan', class: 'Cleric', damage: 1000, dps: 5, duration: 175, pets: false, rank: 6 },
    ],
    loot: [{ id: 7, looter: 'Brackwyn', item: 'Pale Crown', at: iso(T0 + 240_000) }],
    ...over,
  };
}

const page = (over = {}) => ({ ok: true, cursor: 'c1.AAAA', more: false, encounters: [hubEncounter()], tombstones: [], ...over });
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
/** A fetch that records its calls and answers from `script` (a function of the call number). */
function fetcher(script) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url: String(url), init }); return script(calls.length - 1, String(url)); };
  f.calls = calls;
  return f;
}
const ask = (url, o = {}) => agent._localParsesAnswer(url, { store, opts: OPTS, waitMs: 50, ...o });

describe('GET /api/local/parses — this PC\'s own fights', () => {
  it('lists the fight with the own row and the ring\'s player count, newest first, in the documented shape', async () => {
    recordFight(T0);
    recordFight(T0);            // idempotent: the same fight twice is one fight
    agent._setMyFightsForTest([
      ...agent._myFightsForTest(),
      { t: iso(T0 + 3600_000), end: iso(T0 + 3660_000), mob: 'a fire giant', zone: 'Plane of Fear', char: 'Aldenmar', dmg: 900, dur: 60, dps: 15, boss: false },
    ]);
    const out = await ask('/api/local/parses', { opts: null });
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(['fights', 'generated_at', 'hub', 'ok', 'total', 'truncated']);
    expect(out.body.total).toBe(2);
    expect(out.body.fights.map(f => f.name)).toEqual(['a fire giant', 'Corvale the Pale']);   // newest first, underscores read as spaces
    const f = out.body.fights[1];
    expect(Object.keys(f).sort()).toEqual(['boss', 'detail', 'dmg', 'dps', 'dur', 'end', 'guild', 'id', 'mine', 'name', 'players_n', 'seen_total', 't', 'zone']);
    expect(f).toMatchObject({ boss: true, zone: 'Plane of Fear', dur: 180, dmg: 90_000, dps: 500, detail: true, players_n: 3, seen_total: 211_000, guild: null });
    expect(f.mine).toEqual([{ char: 'Aldenmar', dmg: 90_000, dps: 500 }]);
    expect(f.id).toMatch(/^[0-9a-z]+-[0-9a-f]{6}$/);
    expect(out.body.fights[0]).toMatchObject({ boss: false, detail: false, players_n: null, seen_total: null });   // older/lighter: own row only
  });

  it('?scope=bosses leaves the trash out, ?since cuts by start, ?limit caps and says so', async () => {
    recordFight(T0);
    agent._setMyFightsForTest([
      ...agent._myFightsForTest(),
      { t: iso(T0 + 3600_000), end: iso(T0 + 3660_000), mob: 'a fire giant', zone: null, char: 'Aldenmar', dmg: 900, dur: 60, dps: 15, boss: false },
    ]);
    expect((await ask('/api/local/parses?scope=bosses')).body.fights.map(f => f.name)).toEqual(['Corvale the Pale']);
    expect((await ask(`/api/local/parses?since=${encodeURIComponent(iso(T0 + 60_000))}`)).body.fights.map(f => f.name)).toEqual(['a fire giant']);
    const capped = (await ask('/api/local/parses?limit=1')).body;
    expect(capped).toMatchObject({ total: 2, truncated: true });
    expect(capped.fights).toHaveLength(1);
  });

  it('one fight: every player this PC saw with pets folded into the owner, the healers, the deaths', async () => {
    recordFight(T0);
    const list = await ask('/api/local/parses');
    const out = await ask(`/api/local/parses/${list.body.fights[0].id}`);
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(['diff', 'fight', 'guild', 'hub', 'ok']);
    const f = out.body.fight;
    expect(f.players.map(p => [p.name, p.dmg])).toEqual([['Brackwyn', 120_000], ['Aldenmar', 90_000], ['Rethlan', 1000]]);   // Gorbash is Aldenmar's
    const ald = f.players.find(p => p.name === 'Aldenmar');
    expect(ald).toMatchObject({ dmg: 90_000, pet_dmg: 10_000, sec: 160, dps: 562.5 });                                       // his own span, not the fight's
    expect(f.players.find(p => p.name === 'Brackwyn')).toMatchObject({ took: 90_000, tookMax: 4000, sec: 180, dps: 666.7 });
    expect(f.healers).toEqual([{ name: 'Rethlan', heal: 40_000, hps: 222.2 }]);
    expect(f.deaths).toEqual([{ name: 'Rethlan', at_sec: 150 }]);
    expect(f.deaths_kept).toBe(true);
    expect(out.body.guild).toBeNull();
    expect(out.body.diff).toBeNull();
  });

  it('an unknown or malformed id is a 404; a non-route path is a 404', async () => {
    recordFight(T0);
    expect((await ask('/api/local/parses/zzzz-abcdef')).status).toBe(404);
    expect((await ask('/api/local/parses/NOPE')).status).toBe(404);
    expect((await ask('/api/local/other')).status).toBe(404);
  });

  it('a fight the backfill wrote into the store (kind `fight`) joins the list, and merges with the same fight on disk', async () => {
    recordFight(T0);
    store.put('fight', 'a', { mob: 'Corvale the Pale', startedMs: T0 + 2000, endedMs: T0 + 180_000, durationSec: 178, zone: 'Plane of Fear' }, { ts: T0 });
    store.put('fight', 'b', { mob: 'Zarrin', startedMs: T0 - 86400_000, endedMs: T0 - 86400_000 + 60_000, durationSec: 60, boss: true, char: 'Aldenmar', dmg: 5000 }, { ts: T0 - 86400_000 });
    const out = await ask('/api/local/parses');
    expect(out.body.fights.map(f => f.name)).toEqual(['Corvale the Pale', 'Zarrin']);
    expect(out.body.fights[1]).toMatchObject({ boss: true, dmg: 5000, detail: false });
  });

  it('the router answers GET only, as uncached JSON, and leaves other paths alone', async () => {
    recordFight(T0);
    const res = () => { const r = { status: 0, headers: null, body: '', done: null }; r.done = new Promise(ok => { r.end = (b) => { r.body = b; ok(); }; }); r.writeHead = (s, h) => { r.status = s; r.headers = h; }; return r; };
    const call = async (url, method = 'GET') => { const r = res(); const handled = agent._localParsesRoute({ method, url }, r); if (handled) await r.done; return { handled, status: r.status, headers: r.headers, json: r.body ? JSON.parse(r.body) : null }; };
    const ok = await call('/api/local/parses?scope=bosses');
    expect(ok).toMatchObject({ handled: true, status: 200 });
    expect(ok.headers['Cache-Control']).toBe('no-store');
    expect(ok.json.fights).toHaveLength(1);
    expect((await call('/api/local/parses', 'POST')).handled).toBe(false);
    expect((await call('/api/local/track/nights')).handled).toBe(false);
    expect((await call('/api/local/parsesx')).handled).toBe(false);
  });
});

describe('the guild record — feature-detected, never required', () => {
  it('local-only (no token, or a dry run): nothing is asked, the answer says the guild record is not available', async () => {
    recordFight(T0);
    for (const opts of [null, { token: '', botUrl: OPTS.botUrl }, { ...OPTS, dryRun: true }]) {
      const f = fetcher(() => reply(200, page()));
      const out = await ask('/api/local/parses', { opts, fetch: f });
      expect(f.calls).toHaveLength(0);
      expect(out.body.hub).toMatchObject({ available: false, status: 'local_only', encounters: 0 });
      expect(out.body.hub.message).toMatch(/no guild record/i);
      expect(out.body.fights[0].guild).toBeNull();
      agent._localHubResetForTest();
    }
  });

  it('a 404 (the route is not deployed yet) is "not available", the fights still list, and it is not asked again for half an hour', async () => {
    recordFight(T0);
    const f = fetcher(() => reply(404, { error: 'not found' }));
    const out = await ask('/api/local/parses', { fetch: f, now: T0 });
    expect(out.status).toBe(200);
    expect(out.body.hub).toMatchObject({ available: false, status: 'not_deployed', synced_at: null });
    expect(out.body.fights).toHaveLength(1);
    expect(out.body.fights[0].guild).toBeNull();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toMatch(/^https:\/\/bot\.example\/api\/agent\/local-sync\?since=.+&limit=200$/);
    await ask('/api/local/parses', { fetch: f, now: T0 + 10 * MIN });
    expect(f.calls).toHaveLength(1);
    await ask('/api/local/parses', { fetch: f, now: T0 + 31 * MIN });
    expect(f.calls).toHaveLength(2);
  });

  it('503, 401, 403, a thrown fetch and a body that is not the hub\'s all read as "not available" with their own reason', async () => {
    recordFight(T0);
    const cases = [[() => reply(503, { error: 'try again shortly' }), 'unavailable'], [() => reply(401, {}), 'signed_out'], [() => reply(403, {}), 'not_member'],
      [() => { throw new Error('offline'); }, 'unavailable'], [() => reply(200, { html: '<p>' }), 'unavailable']];
    for (const [script, status] of cases) {
      agent._localHubResetForTest();
      const out = await ask('/api/local/parses', { fetch: fetcher(script), now: T0 });
      expect(out.body.hub, status).toMatchObject({ available: false, status });
      expect(out.body.hub.message.length).toBeGreaterThan(10);
      expect(out.body.fights[0].guild).toBeNull();
    }
  });

  it('a member: the guild\'s encounters are kept in the store, the bearer is sent, and a matching fight carries a guild summary', async () => {
    recordFight(T0);
    const f = fetcher(() => reply(200, page()));
    const out = await ask('/api/local/parses', { fetch: f, now: T0 });
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer member-token');
    expect(out.body.hub).toMatchObject({ available: true, status: 'ok', encounters: 1, message: '' });   // no "did not answer" text on a good sync
    expect(out.body.hub.synced_at).toBe(iso(T0));
    expect(store.scan(agent.LOCAL_HUB_KIND).map(e => e.id)).toEqual([hubEncounter().id]);
    expect(out.body.fights[0].guild).toEqual({ damage: 436_000, seen_pct: 48.4, others: 3, classification: null, mine_delta_pct: -5.3 });
  });

  it('keeps the cursor between syncs, pages while `more`, and a re-sent encounter replaces the old one', async () => {
    recordFight(T0);
    const e2 = hubEncounter({ id: 'e2000000-0000-4000-8000-000000000002', name: 'Zarrin', started_at: iso(T0 + 3600_000) });
    const f = fetcher((n) => n === 0 ? reply(200, page({ cursor: 'c1.ONE', more: true })) : n === 1 ? reply(200, page({ cursor: 'c1.TWO', more: false, encounters: [e2] })) : reply(200, page({ cursor: 'c1.TWO', encounters: [] })));
    await ask('/api/local/parses', { fetch: f, now: T0 });
    expect(f.calls).toHaveLength(2);                                   // two pages in one sync
    expect(decodeURIComponent(f.calls[1].url.split('since=')[1].split('&')[0])).toBe('c1.ONE');
    expect(agent._localHubEncounters(store)).toHaveLength(2);
    await ask('/api/local/parses', { fetch: f, now: T0 + 6 * MIN });   // past the 5-minute throttle
    expect(decodeURIComponent(f.calls[2].url.split('since=')[1].split('&')[0])).toBe('c1.TWO');
    // the hub re-sends a changed encounter: one record, the newest
    agent._localHubApply(store, page({ encounters: [hubEncounter({ total_damage: 500_000 })] }));
    const list = agent._localHubEncounters(store);
    expect(list).toHaveLength(2);
    expect(list.find(e => e.name === 'Corvale the Pale').total_damage).toBe(500_000);
  });

  it('a tombstone removes the kept encounter, and the fight stops showing a guild record', async () => {
    recordFight(T0);
    const f = fetcher((n) => n === 0 ? reply(200, page()) : reply(200, page({ cursor: 'c1.TWO', encounters: [], tombstones: [{ id: hubEncounter().id, deleted_at: iso(T0 + 600_000), merged_into: null }] })));
    const first = await ask('/api/local/parses', { fetch: f, now: T0 });
    expect(first.body.fights[0].guild).not.toBeNull();
    const second = await ask('/api/local/parses', { fetch: f, now: T0 + 6 * MIN });
    expect(agent._localHubEncounters(store)).toEqual([]);
    expect(second.body.hub).toMatchObject({ available: true, encounters: 0 });
    expect(second.body.fights[0].guild).toBeNull();
    // a tombstone for something never kept is harmless
    expect(agent._localHubApply(store, { tombstones: [{ id: 'never-kept', deleted_at: iso(T0) }] })).toEqual({ put: 0, removed: 0 });
  });

  it('a tombstone survives a restart: the store, not memory, holds the removal', () => {
    agent._localHubApply(store, page());
    agent._localHubApply(store, { tombstones: [{ id: hubEncounter().id, deleted_at: iso(T0), merged_into: 'e9' }] });
    store.flush();
    const reopened = agent._localStoreOpen(dir);
    expect(reopened.scan(agent.LOCAL_HUB_KIND).filter(e => !e.rec.deleted)).toEqual([]);
    expect(reopened.get(agent.LOCAL_HUB_KIND, hubEncounter().id)).toMatchObject({ deleted: true, merged_into: 'e9' });
  });

  it('keeps only the allow-listed fields: no Discord id, uploader, notes or link ever lands on disk', () => {
    const dirty = hubEncounter({ discord_id: '1234', uploaded_by: 'u', classification_notes: 'secret', message_link: 'https://discord.com/x', raid_night_id: 'n' });
    dirty.players[0].discord_id = '1234';
    dirty.players[0].contribution_id = 'c';
    dirty.loot[0].tell = 'psst';
    const rec = agent._localHubClean(dirty);
    const text = JSON.stringify(rec);
    for (const bad of ['discord', '1234', 'uploaded_by', 'secret', 'message_link', 'raid_night', 'contribution', 'psst', 'tell']) expect(text).not.toContain(bad);
    expect(rec.players[0]).toEqual({ name: 'Nyssara', class: 'Wizard', damage: 140_000, dps: 800, duration: 175, pets: false, rank: 1 });
    expect(rec.players.find(p => p.anon)).toMatchObject({ name: 'Wizard 2', anon: true });   // the hub's scrub of an opted-out character is carried, not undone
    expect(agent._localHubClean({ id: 'x', started_at: 'junk' })).toBeNull();
    expect(agent._localHubClean({ started_at: iso(T0) })).toBeNull();
  });
});

describe('the difference — one fight against the guild\'s merged record', () => {
  it('a fight and an encounter of the same mob starting within ten minutes match; the nearest wins; another mob or an hour apart does not', () => {
    recordFight(T0);
    const fight = agent._localFights(store)[0];
    const enc = (id, name, offsetMin) => ({ ...hubEncounter({ id, name, started_at: iso(T0 + offsetMin * MIN) }) });
    const list = [enc('far', 'Corvale the Pale', 9), enc('near', 'Corvale the Pale', -2), enc('other', 'Zarrin', 0), enc('late', 'Corvale the Pale', 61)];
    expect(agent._localHubMatch(fight, list).id).toBe('near');
    expect(agent._localHubMatch(fight, [enc('other', 'Zarrin', 0), enc('late', 'Corvale the Pale', 61), enc('edge', 'Corvale the Pale', 11)])).toBeNull();
    expect(agent._localHubMatch(fight, [enc('edge', 'Corvale the Pale', 10)]).id).toBe('edge');                       // ten minutes exactly still counts
    expect(agent._localHubMatch(fight, [enc('hash', '#Corvale_the_Pale', 1)]).id).toBe('hash');                       // the same mob however the catalog spells it
  });

  it('the maths: raid damage seen against the guild\'s, who only others saw, and the own row (fixture)', () => {
    recordFight(T0);
    const d = agent._localParseDiff(agent._localFights(store)[0], agent._localHubClean(hubEncounter()));
    expect(d.matched).toBe(true);
    expect(d.start_offset_sec).toBe(40);
    expect(d.raid).toEqual({ guild_damage: 436_000, seen_damage: 211_000, missing_damage: 225_000, seen_pct: 48.4 });
    expect(d.players_only_others).toEqual({ count: 3, damage: 220_000, hidden: 1, names: ['Nyssara', 'Zarrin'] });   // the opted-out one is counted, never named
    expect(d.players_only_here).toEqual({ count: 0, names: [] });
    expect(d.mine).toEqual([{ char: 'Aldenmar', here: 90_000, guild: 95_000, delta: -5000, delta_pct: -5.3, guild_place: 3, guild_n: 6 }]);
    expect(d.shared.map(s => [s.name, s.here, s.guild, s.delta])).toEqual([['Aldenmar', 90_000, 95_000, -5000], ['Brackwyn', 120_000, 120_000, 0], ['Rethlan', 1000, 1000, 0]]);
    expect(d.duration).toEqual({ here: 180, guild: 175, delta: 5 });
    expect(d.hub).toMatchObject({ id: hubEncounter().id, total_damage: 436_000, players: 6 });
  });

  it('a player only this PC saw is reported, an agreeing row is a zero, and a missing guild total falls back to the players\' sum', () => {
    recordFight(T0);
    const enc = agent._localHubClean(hubEncounter({ total_damage: null, players: hubEncounter().players.filter(p => !['Rethlan', 'Brackwyn'].includes(p.name)) }));
    const d = agent._localParseDiff(agent._localFights(store)[0], enc);
    expect(d.players_only_here).toEqual({ count: 2, names: ['Brackwyn', 'Rethlan'] });
    expect(d.raid.guild_damage).toBe(315_000);                                    // 140k + 95k + 50k + 30k
    expect(d.raid.seen_pct).toBe(67);                                             // 211k seen, the two only-here players included
  });

  it('a fight older than the ring (own row only) compares the own row and leaves the raid figures unknown', () => {
    agent._setMyFightsForTest([{ t: iso(T0), end: iso(T0 + 180_000), mob: 'Corvale the Pale', zone: null, char: 'Aldenmar', dmg: 90_000, dur: 180, dps: 500, boss: true }]);
    const fight = agent._localFights(store)[0];
    expect(fight.players).toBeNull();
    const d = agent._localParseDiff(fight, agent._localHubClean(hubEncounter()));
    expect(d.raid).toEqual({ guild_damage: 436_000, seen_damage: null, missing_damage: null, seen_pct: null });
    expect(d.players_only_others.count).toBe(0);
    expect(d.mine[0]).toMatchObject({ here: 90_000, guild: 95_000, delta: -5000 });
  });

  it('an own character the guild record does not list says so rather than inventing a delta', () => {
    recordFight(T0);
    const enc = agent._localHubClean(hubEncounter({ players: hubEncounter().players.filter(p => p.name !== 'Aldenmar') }));
    expect(agent._localParseDiff(agent._localFights(store)[0], enc).mine[0]).toEqual({ char: 'Aldenmar', here: 90_000, guild: null, delta: null, delta_pct: null, guild_place: null, guild_n: 5 });
  });

  it('end to end: the detail answer carries the guild encounter, its loot, and the diff', async () => {
    recordFight(T0);
    const list = await ask('/api/local/parses', { fetch: fetcher(() => reply(200, page())), now: T0 });
    const out = await ask(`/api/local/parses/${list.body.fights[0].id}`);
    expect(out.status).toBe(200);
    expect(out.body.hub.available).toBe(true);
    expect(out.body.guild).toMatchObject({ id: hubEncounter().id, total_damage: 436_000, loot: [{ item: 'Pale Crown', looter: 'Brackwyn' }] });
    expect(out.body.diff.raid.seen_pct).toBe(48.4);
  });
});

describe('what the History ring now keeps for the detail', () => {
  it('healing done rides each local row and the fight\'s deaths (seconds in) ride the entry', () => {
    const start = Date.now() - 600_000;
    agent._recordFightHistory({
      bossName: 'Corvale the Pale', startedAt: iso(start), flushedAt: start + 120_000,
      perPlayer: { Aldenmar: { dmg: 5000, took: 100, healRaw: 0 }, Rethlan: { dmg: 10, took: 20, healRaw: 7000 } },
      deaths: [{ name: 'Rethlan', ts: iso(start + 90_000) }, { name: 'Stale', ts: iso(start - 3600_000) }],
    }, 'Aldenmar');
    const entry = agent._fightHistoryForTest()[0];
    expect(entry.local.find(r => r.character === 'Rethlan').heal).toBe(7000);
    expect(entry.local.find(r => r.character === 'Aldenmar').heal).toBeUndefined();
    expect(entry.deaths).toEqual([{ name: 'Rethlan', at: 90 }]);          // a death from before the pull is not this fight's
  });
});

describe('the page, the rail, the tray and the release checks', () => {
  const src = stripJs(read('web/local/app/parses/LocalParses.tsx'));

  it('reads only the agent\'s routes on its own origin, and says plainly when the guild record is not on this PC', () => {
    expect(src).toMatch(/const API = '\/api\/local\/parses'/);
    expect(src).toMatch(/fetch\(`\$\{API\}\?scope=\$\{scope\}&limit=400`/);
    expect(src).toMatch(/fetch\(`\$\{API\}\/\$\{encodeURIComponent\(id\)\}`/);
    expect(src).not.toMatch(/\/api\/spectator|\/api\/me|supabase|https?:\/\//i);
    expect(src).toMatch(/Guild record not available on this PC\./);
    expect(src).toMatch(/data-hub="off"/);
    expect(src).toMatch(/data-hub="on"/);
  });
  it('the fight is `?id=` on one static page (an export has no dynamic routes), linked from the list', () => {
    expect(src).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\('id'\)/);
    expect(src).toMatch(/href=\{`\/local\/parses\/\?id=\$\{encodeURIComponent\(f\.id\)\}`\}/);
  });
  it('the difference section renders only with a matched guild record, and reuses the website\'s own formatters and chip', () => {
    expect(src).toMatch(/\{hasGuild && diff && guild && \(\s*<section className=\{`\$\{card\} p-6`\} data-diff="on">/);
    expect(src).toMatch(/import \{ ClassificationChip \} from '@\/components\/KillCard'/);
    expect(src).toMatch(/import \{ fmtDmg, fmtDuration, fmtTime \} from '@\/lib\/format'/);
    for (const label of ['Raid damage, guild record', 'Raid damage, this PC saw', 'Players only others saw', 'Your row against the guild']) expect(src).toContain(label);
  });
  it('the page has a title and a description', () => {
    const p = read('web/local/app/parses/page.tsx');
    expect(p).toMatch(/title: 'My parses · On this PC'/);
    expect(p).toMatch(/description: '.{20,}'/);
  });
  it('the local nav links My parses (it is no longer "coming")', () => {
    const nav = stripJs(read('web/local/app/LocalNav.tsx'));
    expect(nav).toMatch(/\{ href: '\/parses\/',\s+label: 'My parses', icon: '📈' \}/);
    expect(nav).not.toMatch(/coming: true/);
  });
  it('the dashboard rail opens it as "My fights (this PC)" (not the 📈 My parses tab), the tray has the same item, the generated literal carries it', () => {
    const dash = read('packages/wolfpack-logsync/dashboard.html');
    expect(dash).toMatch(/id="wpLocalFights"[^>]*onclick="wpOpenLocalSite\('parses'\)"[^>]*>📊 My fights \(this PC\)</);
    expect(dash).not.toMatch(/Coming soon: your own parses/);
    expect(stripJs(read('apps/mimic/main.js'))).toMatch(/label: '📊 My fights \(on this PC\)', click: \(\) => \{ if \(!openLocalSite\('parses'\)\)/);
    expect(readSource(AGENT_INDEX)).toContain("wpOpenLocalSite('parses')");
  });
  it('both release workflows fail when out/parses/index.html is missing', () => {
    for (const wf of ['.github/workflows/release-mimic.yml', '.github/workflows/build-mimic-linux.yml']) {
      expect(read(wf), wf).toMatch(/test -f out\/parses\/index\.html/);
    }
  });
  it('the block makes one outbound call (the hub read) and never touches the upload queue, tells or chat', () => {
    const code = stripJs(readSource(AGENT_INDEX));
    const from = code.indexOf('const LOCAL_FIGHT_MERGE_MS');
    const to = code.lastIndexOf('\nmodule.exports = {');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const block = code.slice(from, to);
    expect(block.match(/\bdoFetch\s*\(/g)).toHaveLength(1);
    expect(block).toMatch(/\/local-sync\?since=/);
    for (const bad of [/enqueueUpload/, /https?\.request/, /\bfetch\s*\(/, /recentTells/, /tellBuffer/, /chatBuffer/, /discord_id/i, /\.send\(/]) expect(block).not.toMatch(bad);
  });
});
