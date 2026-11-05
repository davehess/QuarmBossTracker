// test/track-backfill.test.js — the bot asks every Mimic for the raid-track minutes it recorded locally and merges them
// into raid_track_minutes (utils/trackBackfill.js, POST /api/agent/track-backfill, agent _trackBackfillRun).
//
// What can go wrong without anyone noticing: a second raider's contribution overwriting the first instead of adding
// to it, an excluded character's frames surviving with the wrong raider after the re-index, a minute outside the
// requested window being written, a minute recorded under another guild's raid code leaving the PC, one request id
// answered on every poll. The pure functions and the handler run for real (in-memory Supabase); the agent runs for
// real against a temp store; the wiring is pinned as text with comments stripped. Names are invented.
//
// Run: npx vitest run test/track-backfill.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX, AGENT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const tb = require('../utils/trackBackfill.js');
const agent = require('../packages/wolfpack-logsync/index.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);              // 03:00 UTC, a whole minute
const iso = (ms) => new Date(ms).toISOString();

// One frame entry: [i, x, y, z, h, hp, zi]
const ent = (i, x) => [i, x, 200, 5, -1, -1, 0];
const mk = (who, frames, extra = {}) => ({ v: 1, step_s: 3, who, zones: ['sebilis'], f: frames, ...extra });

describe('cleanMinute', () => {
  it('accepts a hub-shaped minute, keeps raids and the raid index', () => {
    const d = mk([['Aldenmar', 'WAR', 1, 60, 0], ['Brackwyn', 'CLR', 2, 60, -1]], [[0, ...ent(0, 10), ...ent(1, 20)]], { raids: ['0123abcd'] });
    const c = tb.cleanMinute(d);
    expect(c.raids).toEqual(['0123abcd']);
    expect(c.who.map(w => w[4])).toEqual([0, -1]);
    expect(c.f[0].length).toBe(15);
  });
  it('rejects an index past the raider list, a bad name and a bad frame second', () => {
    expect(tb.cleanMinute(mk([['Aldenmar', 'WAR', 1, 60]], [[0, ...ent(3, 10)]]))).toBeNull();
    expect(tb.cleanMinute(mk([['<script>', 'WAR', 1, 60]], [[0, ...ent(0, 10)]]))).toBeNull();
    expect(tb.cleanMinute(mk([['Aldenmar', 'WAR', 1, 60]], [[75, ...ent(0, 10)]]))).toBeNull();
  });
});

describe('mergeMinute', () => {
  const a = () => tb.cleanMinute(mk([['Aldenmar', 'WAR', 1, 60], ['Brackwyn', 'CLR', 1, 60]], [[0, ...ent(0, 10), ...ent(1, 20)]]));
  const b = () => tb.cleanMinute({ v: 1, step_s: 3, zones: ['cazicthule'],
    who: [['Brackwyn', 'CLR', 1, 60], ['Corvale', 'ENC', 2, 60]], f: [[0, ...ent(0, 999), ...ent(1, 30)], [3, ...ent(0, 21), ...ent(1, 31)]] });
  it('keeps both PCs\' raiders, the live row winning for the same raider at the same second', () => {
    const m = tb.mergeMinute(a(), b());
    expect(m.who.map(w => w[0])).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    const f0 = m.f.find(f => f[0] === 0);
    const x = (fr, name) => { for (let j = 1; j < fr.length; j += 7) if (m.who[fr[j]][0] === name) return fr[j + 1]; return null; };
    expect(x(f0, 'Brackwyn')).toBe(20);        // live value, not 999 from the other PC
    expect(x(f0, 'Corvale')).toBe(30);
    expect(m.f.map(f => f[0])).toEqual([0, 3]); // the other PC's later second is added
    expect(x(m.f.find(f => f[0] === 3), 'Brackwyn')).toBe(21);
  });
  it('maps the other PC\'s zone onto the merged zone list', () => {
    const m = tb.mergeMinute(a(), b());
    expect(m.zones).toEqual(['sebilis', 'cazicthule']);
    const f0 = m.f.find(f => f[0] === 0);
    const zoneOf = (name) => { for (let j = 1; j < f0.length; j += 7) if (m.who[f0[j]][0] === name) return m.zones[f0[j + 6]]; return null; };
    expect(zoneOf('Corvale')).toBe('cazicthule');
    expect(zoneOf('Aldenmar')).toBe('sebilis');
  });
  it('is idempotent: merging the same contribution again changes nothing', () => {
    const once = tb.mergeMinute(a(), b());
    expect(tb.mergeMinute(once, b())).toEqual(once);
  });
});

describe('dropExcluded', () => {
  it('removes the raider and re-indexes every frame onto the survivors', () => {
    const d = tb.cleanMinute(mk([['Aldenmar', 'WAR', 1, 60], ['Brackwyn', 'CLR', 1, 60], ['Corvale', 'ENC', 1, 60]],
      [[0, ...ent(0, 10), ...ent(1, 20), ...ent(2, 30)], [3, ...ent(1, 21)]]));
    const r = tb.dropExcluded(d, new Set(['brackwyn']));
    expect(r.who.map(w => w[0])).toEqual(['Aldenmar', 'Corvale']);
    expect(r.f).toEqual([[0, 0, 10, 200, 5, -1, -1, 0, 1, 30, 200, 5, -1, -1, 0]]);   // the frame only Brackwyn was in is gone
    expect(JSON.stringify(r)).not.toMatch(/Brackwyn/);
  });
  it('returns null when nobody is left', () => {
    const d = tb.cleanMinute(mk([['Aldenmar', 'WAR', 1, 60]], [[0, ...ent(0, 10)]]));
    expect(tb.dropExcluded(d, new Set(['aldenmar']))).toBeNull();
  });
});

// An in-memory raid_track_minutes.
function fakeSb(seed = []) {
  const rows = new Map(seed.map(r => [Date.parse(r.minute_at), r]));
  const sb = {
    rows, fail: { select: false, upsert: false }, upserts: 0,
    async select(table, qs) {
      if (sb.fail.select) return null;
      expect(table).toBe('raid_track_minutes');
      const list = decodeURIComponent(/minute_at=in\.\(([^)]*)\)/.exec(qs)[1]).split(',').map(Date.parse);
      return list.filter(ms => rows.has(ms)).map(ms => ({ minute_at: rows.get(ms).minute_at.replace('Z', '+00:00'), data: rows.get(ms).data }));
    },
    async upsert(table, list, onConflict) {
      if (sb.fail.upsert) return null;
      expect(onConflict).toMatch(/^guild_id,minute_at/);
      sb.upserts++;
      for (const r of list) rows.set(Date.parse(r.minute_at), r);
      return list.map(r => ({ guild_id: r.guild_id, minute_at: r.minute_at }));
    },
  };
  return sb;
}
const TUNE = { track_backfill_id: 7, track_backfill_from_s: T0 / 1000, track_backfill_to_s: (T0 + 10 * MIN) / 1000 };
const wireRow = (ms, d) => ({ minute_at: iso(ms), night_key: 'x', data: JSON.stringify(d) });
const deps = (sb, over = {}) => ({ supabase: sb, tune: TUNE, excluded: new Set(), guildId: 'wolfpack', ...over });
const dataOf = (sb, ms) => JSON.parse(sb.rows.get(ms).data);

describe('handle', () => {
  const one = () => mk([['Aldenmar', 'WAR', 1, 60]], [[0, ...ent(0, 10)]]);
  it('inserts a missing minute with the derived columns filled by the server', async () => {
    const sb = fakeSb();
    const r = await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, accepted: 1, merged: 0, inserted: 1, rejected: 0 });
    const row = sb.rows.get(T0);
    expect(row).toMatchObject({ guild_id: 'wolfpack', minute_at: iso(T0), raiders: 1, frames: 1, zones: ['sebilis'] });
    expect(row.night_key).toBe(require('../utils/raidNight').nightKey(T0));
  });
  it('merges two PCs\' contributions into one row', async () => {
    const sb = fakeSb();
    await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb));
    const other = mk([['Corvale', 'ENC', 2, 60]], [[0, ...ent(0, 30)]]);
    const r = await tb.handle({ request_id: 7, rows: [wireRow(T0, other)] }, deps(sb));
    expect(r.body).toMatchObject({ merged: 1, inserted: 0 });
    expect(dataOf(sb, T0).who.map(w => w[0])).toEqual(['Aldenmar', 'Corvale']);
    expect(sb.rows.get(T0).raiders).toBe(2);
  });
  it('a repeated batch writes nothing the second time', async () => {
    const sb = fakeSb();
    await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb));
    const n = sb.upserts;
    await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb));
    expect(sb.upserts).toBe(n);
  });
  it('rejects a minute outside the window, a minute off the boundary and a wrong request id', async () => {
    const sb = fakeSb();
    const r = await tb.handle({ request_id: 7, rows: [wireRow(T0 - MIN, one()), wireRow(T0 + 10 * MIN, one()), wireRow(T0 + 5000, one()), wireRow(T0 + MIN, one())] }, deps(sb));
    expect(r.body).toMatchObject({ accepted: 1, rejected: 3 });
    expect([...sb.rows.keys()]).toEqual([T0 + MIN]);
    expect((await tb.handle({ request_id: 8, rows: [wireRow(T0, one())] }, deps(sb))).status).toBe(409);
    expect((await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb, { tune: {} }))).status).toBe(409);
  });
  it('never stores an excluded raider and rejects a minute that held only them', async () => {
    const sb = fakeSb();
    const two = mk([['Aldenmar', 'WAR', 1, 60], ['Brackwyn', 'CLR', 1, 60]], [[0, ...ent(0, 10), ...ent(1, 20)]]);
    const only = mk([['Brackwyn', 'CLR', 1, 60]], [[0, ...ent(0, 20)]]);
    const r = await tb.handle({ request_id: 7, rows: [wireRow(T0, two), wireRow(T0 + MIN, only)] }, deps(sb, { excluded: new Set(['brackwyn']) }));
    expect(r.body).toMatchObject({ inserted: 1, rejected: 1 });
    expect(sb.rows.get(T0).data).not.toMatch(/Brackwyn/);
    expect(sb.rows.has(T0 + MIN)).toBe(false);
  });
  it('answers 503 (so the durable queue retries) when a read, a write or the exclusion list fails', async () => {
    const sb = fakeSb();
    sb.fail.select = true;
    expect((await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb))).status).toBe(503);
    sb.fail.select = false; sb.fail.upsert = true;
    expect((await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb))).status).toBe(503);
    expect((await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb, { excluded: null }))).status).toBe(503);
  });
  it('does not overwrite a stored row it cannot read', async () => {
    const sb = fakeSb([{ guild_id: 'wolfpack', minute_at: iso(T0), data: 'not json', raiders: 1, frames: 1, zones: [] }]);
    const r = await tb.handle({ request_id: 7, rows: [wireRow(T0, one())] }, deps(sb));
    expect(r.body.rejected).toBe(1);
    expect(sb.rows.get(T0).data).toBe('not json');
  });
});

describe('agent: _trackBackfillRun', () => {
  const MEMBER = { token: 'member-token', botUrl: 'https://bot.example/api/agent/encounter', dryRun: false };
  let dir, store;
  const put = (ms, extra = {}) => store.put('track_minute', iso(ms), {
    minute_at: iso(ms), night_key: 'k', raiders: 1, frames: 1, zones: ['sebilis'], data: JSON.stringify(mk([['Aldenmar', 'WAR', 1, 60]], [[0, ...ent(0, 10)]])), ...extra,
  }, { ts: ms });
  const queue = () => agent._uploadQueueForTest().filter(e => e.kind === 'track_backfill');
  const NOW = T0 + 60 * MIN;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-trackbf-'));
    store = agent._localStoreOpen(dir);
    agent._localTrackSetStoreForTest(store);
    agent._setUploadOptsForTest(MEMBER);
    agent._uploadQueueForTest().length = 0;
    agent._trackBackfillSeen.clear();
  });
  afterEach(() => {
    agent._localTrackSetStoreForTest(null);
    agent._setUploadOptsForTest(null);
    agent._uploadQueueForTest().length = 0;
    agent._trackBackfillSeen.clear();
  });

  it('sends the window\'s minutes in batches of 15 and skips a raid-code minute', () => {
    for (let i = 0; i < 20; i++) put(T0 + i * MIN);
    put(T0 + 20 * MIN, { raid_code: 'BC-7KQ2' });
    put(T0 - MIN);                                       // before the window
    const res = agent._trackBackfillRun({ ...TUNE, track_backfill_to_s: (T0 + 30 * MIN) / 1000 }, { store, now: NOW });
    expect(res).toEqual({ rows: 20, batches: 2 });
    const q = queue();
    expect(q.map(e => e.payload.rows.length)).toEqual([15, 5]);
    expect(q.every(e => e.payload.request_id === 7)).toBe(true);
    const sent = q.flatMap(e => e.payload.rows);
    expect(sent.some(r => r.minute_at === iso(T0 + 20 * MIN))).toBe(false);
    expect(sent.some(r => r.minute_at === iso(T0 - MIN))).toBe(false);
    expect(Object.keys(sent[0]).sort()).toEqual(['data', 'minute_at', 'night_key']);
  });

  it('answers a request id once: not on the next poll, and not after a restart', () => {
    put(T0);
    const tune = { ...TUNE };
    agent._trackBackfillRun(tune, { store, now: NOW });
    expect(agent._trackBackfillRun(tune, { store, now: NOW })).toEqual({ skipped: 'seen' });
    agent._trackBackfillSeen.clear();                    // a restart forgets memory; the store remembers
    expect(agent._trackBackfillRun(tune, { store, now: NOW })).toEqual({ skipped: 'done' });
    expect(queue().length).toBe(1);
    const again = agent._trackBackfillRun({ ...tune, track_backfill_id: 8 }, { store, now: NOW });
    expect(again.rows).toBe(1);                          // a new id is answered
  });

  it('is driven by the tuning response and ignores missing or invalid keys', () => {
    put(T0);
    agent._applyTuningResponse({ tuning: { flag_agent_kill: 0 } });
    agent._applyTuningResponse({ tuning: { track_backfill_id: -3, track_backfill_from_s: 1, track_backfill_to_s: 2 } });
    agent._applyTuningResponse({ tuning: { track_backfill_id: 9, track_backfill_from_s: 'x', track_backfill_to_s: 5 } });
    expect(queue().length).toBe(0);
    agent._applyTuningResponse({ tuning: { track_backfill_id: 11, track_backfill_from_s: (Date.now() - 3600_000) / 1000, track_backfill_to_s: Date.now() / 1000 } });
    agent._applyTuningResponse({ tuning: { track_backfill_id: 11, track_backfill_from_s: (Date.now() - 3600_000) / 1000, track_backfill_to_s: Date.now() / 1000 } });
    expect(agent._trackBackfillSeen.has(11)).toBe(true);
    agent._applyTuningResponse({ tuning: {} });
  });

  it('refuses a window over 6 hours and one that ended over 30 days ago', () => {
    put(T0);
    expect(agent._trackBackfillRun({ ...TUNE, track_backfill_to_s: (T0 + 7 * 3600_000) / 1000 }, { store, now: NOW })).toEqual({ skipped: 'window' });
    expect(agent._trackBackfillRun({ ...TUNE, track_backfill_id: 2 }, { store, now: NOW + 31 * 86400_000 })).toEqual({ skipped: 'old' });
    expect(queue().length).toBe(0);
  });

  it('marks nothing finished when the upload could not be queued', () => {
    put(T0);
    agent._setUploadOptsForTest({ ...MEMBER, token: null });   // local-only: enqueueUpload drops everything
    expect(agent._trackBackfillRun(TUNE, { store, now: NOW })).toMatchObject({ skipped: 'not-queued' });
    expect(store.get('track_backfill', '7')).toBeNull();
    agent._setUploadOptsForTest(MEMBER);
    agent._trackBackfillSeen.clear();
    expect(agent._trackBackfillRun(TUNE, { store, now: NOW }).rows).toBe(1);   // a later poll answers it
    expect(store.get('track_backfill', '7')).toBeTruthy();
  });
});

describe('wiring', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  const ag = stripJs(readSource(AGENT_INDEX));
  it('the bot routes POST /api/agent/track-backfill through the agent auth, with a 1 MB body cap', () => {
    expect(bot).toMatch(/req\.url === '\/api\/agent\/track-backfill'/);
    const h = bot.slice(bot.indexOf('async function _handleAgentTrackBackfill'));
    expect(h.slice(0, 1500)).toMatch(/requireAgentAuth/);
    expect(h.slice(0, 1500)).toMatch(/1024 \* 1024/);
  });
  it('the agent maps the kind to the route, honours the kill switch and skips raid-code minutes', () => {
    expect(ag).toMatch(/case 'track_backfill':\s+return base \+ '\/track-backfill'/);
    const run = ag.slice(ag.indexOf('function _trackBackfillRun'), ag.indexOf('function _trackBackfillMaybe'));
    expect(run).toMatch(/_controlStandDown\(\)\.down/);
    expect(run).toMatch(/r\.raid_code/);
    expect(run).toMatch(/TRACK_BACKFILL_BATCH/);
  });
});
