// test/local-recorder.test.js — the agent's local store (_localStore) and its own position recorder.
//
// The guild lead's local-first direction (2026-10-21): every PC keeps its own record of where it stood, in the same
// minute-row shape the hub's raid_track_minutes holds, so web/lib/raidReplay.ts replays it unchanged. These tests run
// the REAL agent functions (the agent exports them) against a temp folder:
//   • the store: append, scan, supersede, cursor, reopen with and without its index, a crash-truncated last line,
//     prune by age and by size;
//   • PARITY: _localTrackMinuteRow produces byte-identical rows to utils/raidTrack.js buildMinuteRow on the same frames;
//   • the frame: group/solo play records [self], a raid snapshot adds the raiders in this zone, an excluded character
//     is never written, stale data is not a frame;
//   • the routes: the shape /api/spectator/replay returns, and ReplayBoard's own decoder reads it;
//   • nothing in the block can reach the network or the upload queue.
// Names are invented. Run: npx vitest run test/local-recorder.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';
import { decodeRows, summarizeNights } from '../web/lib/raidReplay.ts';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const rt = require('../utils/raidTrack.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);   // 21:00 ET on Oct 4: a whole UTC minute inside the night of 10/04/2026
let dir;
let store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-local-'));
  store = agent._localStoreOpen(dir);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const segPath = (kind, ms) => path.join(dir, kind, new Date(ms).toISOString().slice(0, 10) + '.ndjson');

describe('_localStore — put / get / scan / cursor', () => {
  it('puts a record and reads it back by id and by range', () => {
    expect(store.put('thing', 'a', { n: 1 }, { ts: T0 })).toBe(true);
    expect(store.put('thing', 'b', { n: 2 }, { ts: T0 + MIN })).toBe(true);
    expect(store.get('thing', 'a')).toEqual({ n: 1 });
    expect(store.get('thing', 'a', { ts: T0 })).toEqual({ n: 1 });
    expect(store.get('thing', 'nope')).toBeNull();
    const all = store.scan('thing');
    expect(all.map(e => e.id)).toEqual(['a', 'b']);
    expect(store.scan('thing', { since: T0 + MIN }).map(e => e.id)).toEqual(['b']);
    expect(store.scan('thing', { until: T0 + MIN }).map(e => e.id)).toEqual(['a']);   // until is exclusive
    expect(store.scan('thing', { limit: 1 }).map(e => e.id)).toEqual(['a']);
  });

  it('keeps one file per kind per UTC day, oldest first across days', () => {
    const d2 = T0 + 24 * 3600_000;
    store.put('thing', 'late', { n: 2 }, { ts: d2 });
    store.put('thing', 'early', { n: 1 }, { ts: T0 });
    expect(fs.existsSync(segPath('thing', T0))).toBe(true);
    expect(fs.existsSync(segPath('thing', d2))).toBe(true);
    expect(store.scan('thing').map(e => e.id)).toEqual(['early', 'late']);
    expect(store.scan('thing', { since: d2 }).map(e => e.id)).toEqual(['late']);
  });

  it('a later put of the same id supersedes the earlier one', () => {
    store.put('thing', 'a', { v: 1 }, { ts: T0 });
    store.put('thing', 'a', { v: 2 }, { ts: T0 });
    expect(store.get('thing', 'a')).toEqual({ v: 2 });
    expect(store.scan('thing')).toHaveLength(1);
    expect(store.scan('thing')[0].rec).toEqual({ v: 2 });
  });

  it('the cursor counts, and afterSeq returns only what was put after it', () => {
    expect(store.cursor('thing')).toMatchObject({ seq: 0, count: 0, bytes: 0, segments: 0 });
    store.put('thing', 'a', { n: 1 }, { ts: T0 });
    const mid = store.cursor('thing').seq;
    store.put('thing', 'b', { n: 2 }, { ts: T0 + MIN });
    store.put('thing', 'c', { n: 3 }, { ts: T0 + 2 * MIN });
    const c = store.cursor('thing');
    expect(c).toMatchObject({ seq: 3, count: 3, segments: 1, lastTs: T0 + 2 * MIN });
    expect(c.bytes).toBe(fs.statSync(segPath('thing', T0)).size);
    expect(store.scan('thing', { afterSeq: mid }).map(e => e.id)).toEqual(['b', 'c']);
  });

  it('refuses a bad kind, a bad id, a missing record and a record over 1 MB, and writes nothing', () => {
    expect(store.put('Bad Kind', 'a', {}, { ts: T0 })).toBe(false);
    expect(store.put('../up', 'a', {}, { ts: T0 })).toBe(false);
    expect(store.put('thing', '', {}, { ts: T0 })).toBe(false);
    expect(store.put('thing', 'a', undefined, { ts: T0 })).toBe(false);
    expect(store.put('thing', 'a', { blob: 'x'.repeat(1024 * 1024) }, { ts: T0 })).toBe(false);
    expect(fs.existsSync(path.join(dir, 'thing'))).toBe(false);
    expect(store.scan('thing')).toEqual([]);
  });
});

describe('_localStore — index and reopen', () => {
  it('a reopened store reads its index, and rebuilds it when the index is gone or stale', () => {
    for (let i = 0; i < 5; i++) store.put('thing', 'r' + i, { i }, { ts: T0 + i * MIN });
    const want = store.cursor('thing');
    store.flush();
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);

    expect(agent._localStoreOpen(dir).cursor('thing')).toEqual(want);                       // from the index

    fs.rmSync(path.join(dir, 'index.json'));
    expect(agent._localStoreOpen(dir).cursor('thing')).toEqual(want);                       // rebuilt from the segment

    store.flush();                                                                           // index says 5 lines...
    fs.appendFileSync(segPath('thing', T0), JSON.stringify({ s: 6, id: 'r5', ts: T0 + 5 * MIN, r: { i: 5 } }) + '\n');   // ...the file has 6
    const re = agent._localStoreOpen(dir);
    expect(re.cursor('thing')).toMatchObject({ seq: 6, count: 6 });
    expect(re.put('thing', 'r6', { i: 6 }, { ts: T0 + 6 * MIN })).toBe(true);
    expect(re.cursor('thing').seq).toBe(7);                                                  // the seq goes on, never repeats
  });

  it('a corrupt index is ignored', () => {
    store.put('thing', 'a', { n: 1 }, { ts: T0 });
    store.flush();
    fs.writeFileSync(path.join(dir, 'index.json'), '{not json');
    const re = agent._localStoreOpen(dir);
    expect(re.get('thing', 'a')).toEqual({ n: 1 });
    expect(re.cursor('thing').count).toBe(1);
  });
});

describe('_localStore — a crash mid-append', () => {
  it('skips the torn last line, keeps what came before, and the next put starts on a fresh line', () => {
    store.put('thing', 'a', { n: 1 }, { ts: T0 });
    store.put('thing', 'b', { n: 2 }, { ts: T0 + MIN });
    store.flush();
    const file = segPath('thing', T0);
    fs.appendFileSync(file, '{"s":3,"id":"c","ts":' + (T0 + 2 * MIN) + ',"r":{"n":');   // power cut: no closing, no newline

    const re = agent._localStoreOpen(dir);
    expect(re.scan('thing').map(e => e.id)).toEqual(['a', 'b']);
    expect(re.put('thing', 'd', { n: 4 }, { ts: T0 + 3 * MIN })).toBe(true);

    const again = agent._localStoreOpen(dir);
    expect(again.scan('thing').map(e => e.id)).toEqual(['a', 'b', 'd']);
    expect(again.get('thing', 'd')).toEqual({ n: 4 });
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);                                   // a, b, the torn fragment on its own line, d
    expect(lines[2].startsWith('{"s":3')).toBe(true);
    expect(JSON.parse(lines[3]).id).toBe('d');
  });

  it('a segment that is nothing but a torn line reads as empty and still takes writes', () => {
    fs.mkdirSync(path.join(dir, 'thing'), { recursive: true });
    fs.writeFileSync(segPath('thing', T0), '{"s":1,"id":"x"');
    const re = agent._localStoreOpen(dir);
    expect(re.scan('thing')).toEqual([]);
    expect(re.put('thing', 'y', { n: 1 }, { ts: T0 })).toBe(true);
    expect(re.scan('thing').map(e => e.id)).toEqual(['y']);
  });
});

describe('_localStore — prune', () => {
  const DAY = 86400_000;
  it('drops segments older than the kind retention (default 90 days for positions), keeps the rest', () => {
    const now = T0;
    store.put('track_minute', 'old', { n: 1 }, { ts: now - 100 * DAY });
    store.put('track_minute', 'edge', { n: 2 }, { ts: now - 89 * DAY });
    store.put('track_minute', 'new', { n: 3 }, { ts: now });
    store.put('track_presence', 'old', { n: 1 }, { ts: now - 100 * DAY });
    const out = store.prune({ now });
    expect(out.removed.sort()).toEqual(['track_minute/' + new Date(now - 100 * DAY).toISOString().slice(0, 10), 'track_presence/' + new Date(now - 100 * DAY).toISOString().slice(0, 10)].sort());
    expect(out.freedBytes).toBeGreaterThan(0);
    expect(store.scan('track_minute').map(e => e.id)).toEqual(['edge', 'new']);
    expect(store.cursor('track_minute').segments).toBe(2);
  });

  it('retention is configurable per kind, by config.json or configure()', () => {
    expect(store.policyOf('track_minute').retainDays).toBe(90);
    store.configure({ retainDays: { track_minute: 7 } });
    expect(store.policyOf('track_minute').retainDays).toBe(7);
    store.put('track_minute', 'a', { n: 1 }, { ts: T0 - 10 * DAY });
    store.put('track_minute', 'b', { n: 2 }, { ts: T0 });
    store.prune({ now: T0 });
    expect(store.scan('track_minute').map(e => e.id)).toEqual(['b']);

    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ retain_days: { track_minute: 30 }, max_mb: { track_minute: 12 } }));
    const re = agent._localStoreOpen(dir);
    expect(re.policyOf('track_minute')).toMatchObject({ retainDays: 30, maxBytes: 12 * 1024 * 1024 });
  });

  it('a kind with no policy keeps everything by age, and a size cap drops the oldest segments but never the newest', () => {
    const big = { pad: 'x'.repeat(300 * 1024) };
    store.configure({ maxBytes: { blobs: 1024 * 1024 } });
    for (let i = 0; i < 6; i++) store.put('blobs', 'b' + i, big, { ts: T0 + i * DAY });
    const out = store.prune({ now: T0 + 6 * DAY });
    expect(out.removed.length).toBeGreaterThan(0);
    expect(out.removed).not.toContain('blobs/' + new Date(T0 + 5 * DAY).toISOString().slice(0, 10));
    expect(store.cursor('blobs').bytes).toBeLessThanOrEqual(1024 * 1024);
    expect(store.get('blobs', 'b5')).not.toBeNull();
    expect(store.get('blobs', 'b0')).toBeNull();
  });
});

// ── Parity with the hub recorder ──────────────────────────────────────────────────────────────────────────
describe('_localTrackMinuteRow — byte-identical to utils/raidTrack.js buildMinuteRow', () => {
  const row = (name, x, y, over = {}) => ({ name, class: 'Warrior', group_num: 1, level: 60, hp_pct: null, loc_x: x, loc_y: y, loc_z: 5, heading: null, ...over });
  beforeEach(() => { rt._reset(); delete process.env.RAID_TRACK_STEP_S; });
  afterEach(() => { rt._reset(); });

  // The frames the hub cut, taken from its state: takeFrame() returns each one.
  function collect(opts) {
    rt._reset();
    delete process.env.RAID_TRACK_STEP_S;
    process.env.RAID_TRACK_MIN_PLACED = '1';
    rt.setTargetSource(opts.withMobs === false ? null : () => [
      { name: 'a fire giant', id: 4412, zone: 'gfaydark', x: 150.4, y: -220.6, z: 3.2, n: 3 },
      { name: 'a fire giant warrior', id: null, zone: 'gfaydark', x: 12, y: 13, z: 0, n: 1 },
    ]);
    const names = { u1: ['Aldenmar', 'Brackwyn', 'Corvale'], u2: ['Rethlan', 'Nyssara'], u3: ['Zarrin'] };
    const frames = [];
    for (let s = 0; s < 20; s++) {
      const at = opts.start + s * 3000;
      for (const [src, ns] of Object.entries(names)) {
        rt.noteRows(ns.map((n, i) => row(n, 100.4 + i * 7 + s * 1.5, -200.5 - i - s * 2.25, {
          class: i % 2 ? 'Cleric' : 'Warrior', hp_pct: s % 4 === 0 ? null : 40 + s, heading: s % 5 === 0 ? null : 12.6 * s, level: i === 2 ? null : 60, group_num: i === 1 ? null : i + 1,
        })), src, at);
      }
      rt.noteRows([row('Gavrel', 0, 0, { loc_z: 0 })], 'u1', at);
      const fr = rt.takeFrame(at);
      if (fr) frames.push(fr);
    }
    return frames;
  }

  for (const [label, start] of [['inside the night', T0], ['after midnight ET, still the night before', Date.UTC(2026, 9, 5, 5, 0, 0)], ['past the 06:00 ET rollover', Date.UTC(2026, 9, 5, 11, 0, 0)]]) {
    it(`same frames, same row (${label})`, () => {
      const frames = collect({ start });
      expect(frames.length).toBe(20);
      const opts = { guildId: 'local', excluded: new Set(['brackwyn']), srcZone: new Map([['u1', 'gfaydark'], ['u2', 'gfaydark'], ['u3', null]]) };
      const hub = rt.buildMinuteRow(start, frames, opts);
      const mine = agent._localTrackMinuteRow(start, frames, { ...opts, stepS: 3 });
      expect(mine).toEqual(hub);
      expect(mine.data).toBe(hub.data);
      expect(JSON.parse(mine.data).mf.length).toBeGreaterThan(0);   // the target half is in the comparison
      expect(JSON.parse(mine.data).who.map(w => w[0])).not.toContain('Brackwyn');
    });
  }

  it('same without targets, and a minute with nothing placed is null in both', () => {
    const frames = collect({ start: T0, withMobs: false });
    const opts = { guildId: 'local', srcZone: new Map() };
    expect(agent._localTrackMinuteRow(T0, frames, { ...opts, stepS: 3 })).toEqual(rt.buildMinuteRow(T0, frames, opts));
    expect(JSON.parse(agent._localTrackMinuteRow(T0, frames, { ...opts, stepS: 3 }).data)).not.toHaveProperty('mf');
    expect(agent._localTrackMinuteRow(T0, [], {})).toBeNull();
    expect(rt.buildMinuteRow(T0, [], {})).toBeNull();
  });

  it('the hub row decodes with the web decoder, and so does ours', () => {
    const frames = collect({ start: T0 });
    const mine = agent._localTrackMinuteRow(T0, frames, { stepS: 3, srcZone: new Map([['u1', 'gfaydark']]) });
    const dec = decodeRows([{ minute_at: mine.minute_at, zones: mine.zones, data: mine.data }]);
    expect(dec.length).toBe(20);
    expect(dec[0].raiders.map(r => r.name)).toContain('Aldenmar');
    expect(dec[0].targets?.[0].name).toBe('a fire giant');
  });
});

// ── The frame ─────────────────────────────────────────────────────────────────────────────────────────────
describe('_localTrackFrame — what a frame holds', () => {
  const NOW = T0 + 5000;
  const st = (over = {}) => ({ zone: 54, loc: { x: 100.2, y: -50.7, z: 3 }, heading: 128, self_hp_pct: 93, updatedAt: NOW - 500, target_name: null, ...over });
  const member = (name, x, y, over = {}) => ({ name, class: 'Cleric', group: '2', level: '60', rank: null, hp_pct: 88, loc_x: x, loc_y: y, loc_z: 4, heading: 64, ...over });
  const ctx = (over = {}) => ({ raid: null, active: 'Aldenmar', state: st(), selfInfo: { cls: 'Warrior', level: 60 }, excluded: new Set(), targetPos: null, ...over });

  it('alone or in a group (no raid snapshot): who is just [self], in the zone Zeal reports', () => {
    const fr = agent._localTrackFrame(NOW, ctx());
    expect(fr.rows).toHaveLength(1);
    expect(fr.rows[0]).toMatchObject({ name: 'Aldenmar', cls: 'Warrior', level: 60, hp: 93, x: 100.2, y: -50.7, z: 3, h: 128, src: 'gfaydark' });
    const row = agent._localTrackMinuteRow(T0, [fr], { srcZone: new Map([[fr.rows[0].src, fr.rows[0].src]]), stepS: 3 });
    const d = JSON.parse(row.data);
    expect(d.who).toEqual([['Aldenmar', 'Warrior', null, 60]]);
    expect(d.zones).toEqual(['gfaydark']);
    expect(d.f).toEqual([[5, 0, 100, -51, 3, 128, 93, 0]]);
  });

  it('a raid snapshot adds the raiders placed in this zone and drops (0,0,0) ones', () => {
    const raid = { at: NOW - 1000, members: [member('Aldenmar', 99, -49), member('Brackwyn', 120, -10), member('Corvale', 0, 0, { loc_z: 0 }), member('Rethlan', null, null)] };
    const fr = agent._localTrackFrame(NOW, ctx({ raid }));
    expect(fr.rows.map(r => r.name).sort()).toEqual(['Aldenmar', 'Brackwyn']);
    const me = fr.rows.find(r => r.name === 'Aldenmar');
    expect(me).toMatchObject({ x: 100.2, y: -50.7, group: 2, cls: 'Cleric' });   // position from the fresher live state, the rest from the raid row
    expect(fr.rows.find(r => r.name === 'Brackwyn')).toMatchObject({ x: 120, y: -10, group: 2, level: 60, hp: 88, h: 64 });
  });

  it('a stale raid snapshot or live state is not a frame', () => {
    const raid = { at: NOW - 30_000, members: [member('Brackwyn', 120, -10)] };
    expect(agent._localTrackFrame(NOW, ctx({ raid }))?.rows.map(r => r.name)).toEqual(['Aldenmar']);
    expect(agent._localTrackFrame(NOW, ctx({ state: st({ updatedAt: NOW - 60_000 }) }))).toBeNull();
    expect(agent._localTrackFrame(NOW, ctx({ state: st({ loc: { x: 0, y: 0, z: 0 } }) }))).toBeNull();
    expect(agent._localTrackFrame(NOW, ctx({ state: null, active: null }))).toBeNull();
  });

  it('an excluded character is never written, and when the active character is excluded nothing is recorded', () => {
    const raid = { at: NOW - 1000, members: [member('Brackwyn', 120, -10), member('Corvale', 130, -20)] };
    const fr = agent._localTrackFrame(NOW, ctx({ raid, excluded: new Set(['brackwyn']) }));
    expect(fr.rows.map(r => r.name).sort()).toEqual(['Aldenmar', 'Corvale']);
    expect(agent._localTrackFrame(NOW, ctx({ raid, excluded: new Set(['aldenmar']) }))).toBeNull();
  });

  it('my NPC target rides along as a mob in the server frame, count 1, written swapped back', () => {
    const fr = agent._localTrackFrame(NOW, ctx({ state: st({ target_name: 'a fire giant' }), targetPos: { id: 4412, x: 10.5, y: 20.5, z: 1, zone: 'gfaydark' } }));
    expect(fr.mobs).toEqual([{ name: 'a fire giant', id: 4412, zone: 'gfaydark', x: 10.5, y: 20.5, z: 1, n: 1 }]);
    const d = JSON.parse(agent._localTrackMinuteRow(T0, [fr], { srcZone: new Map([['gfaydark', 'gfaydark']]) }).data);
    expect(d.mobs).toEqual([['a fire giant', 4412]]);
    expect(d.mf).toEqual([[5, 0, 21, 11, 1, 1, 0]]);   // x = server y, y = server x, as the hub writes it
    expect(agent._localTrackFrame(NOW, ctx()).mobs).toEqual([]);
  });

  it('numbers that arrive as strings from the pipe are numbers in the row (the decoder wants them)', () => {
    const raid = { at: NOW - 1000, members: [member('Brackwyn', 120, -10, { group: '3', level: '58' })] };
    const fr = agent._localTrackFrame(NOW, ctx({ raid }));
    const b = fr.rows.find(r => r.name === 'Brackwyn');
    expect(b.group).toBe(3);
    expect(b.level).toBe(58);
  });
});

describe('the recorder — frames in, one row per UTC minute out', () => {
  beforeEach(() => { agent._localTrackSetStoreForTest(store); });
  afterEach(() => { agent._localTrackClose(); agent._localTrackSetStoreForTest(null); });
  const frameAt = (t, x) => ({ t, rows: [{ name: 'Aldenmar', cls: 'Warrior', group: null, level: 60, hp: 90, x, y: -50, z: 3, h: 128, src: 'gfaydark' }], mobs: [] });

  it('a frame in a new minute closes the minute before, which lands as a track_minute and a track_presence', () => {
    for (let s = 0; s < 20; s++) agent._localTrackPush(frameAt(T0 + s * 3000, 100 + s));
    expect(store.scan('track_minute')).toEqual([]);                  // still being filled
    agent._localTrackPush(frameAt(T0 + MIN, 200));                    // the next minute
    const rows = store.scan('track_minute');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(new Date(T0).toISOString());
    expect(rows[0].rec).toMatchObject({ guild_id: 'local', minute_at: new Date(T0).toISOString(), night_key: '10/04/2026', raiders: 1, frames: 20, zones: ['gfaydark'] });
    expect(JSON.parse(rows[0].rec.data).f).toHaveLength(20);
    expect(store.scan('track_presence')[0].rec).toEqual({ night_key: '10/04/2026', minute_at: new Date(T0).toISOString(), zones: ['gfaydark'], raiders: 1 });
    agent._localTrackClose();
    expect(store.scan('track_minute')).toHaveLength(2);
  });

  it('records into the day segment of its minute', () => {
    agent._localTrackPush(frameAt(T0, 100));
    agent._localTrackClose();
    expect(fs.existsSync(segPath('track_minute', T0))).toBe(true);
    expect(fs.existsSync(segPath('track_presence', T0))).toBe(true);
  });
});

// ── Size per hour ─────────────────────────────────────────────────────────────────────────────────────────
describe('size on disk', () => {
  beforeEach(() => { agent._localTrackSetStoreForTest(store); });
  afterEach(() => { agent._localTrackClose(); agent._localTrackSetStoreForTest(null); });

  // A raid hour: `n` raiders placed in this zone, each walking a little, frames every 3 s.
  function recordHour(n, startMs) {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pos = Array.from({ length: n }, () => ({ x: -2000 + rnd() * 4000, y: -2000 + rnd() * 4000, z: rnd() * 60 }));
    for (let t = 0; t < 3600; t += 3) {
      const rows = pos.map((p, i) => {
        p.x += (rnd() - 0.5) * 12; p.y += (rnd() - 0.5) * 12;
        return { name: 'Raider' + String(i).padStart(2, '0'), cls: i % 3 ? 'Cleric' : 'Warrior', group: 1 + (i % 12), level: 60, hp: 50 + Math.floor(rnd() * 50), x: p.x, y: p.y, z: p.z, h: Math.floor(rnd() * 512), src: 'gfaydark' };
      });
      agent._localTrackPush({ t: startMs + t * 1000, rows, mobs: [] });
    }
    agent._localTrackClose();
  }
  const bytesOf = (kind) => store.cursor(kind).bytes;

  it('measures a solo hour, a group-sized hour and a full-raid hour', () => {
    recordHour(1, T0);
    const solo = bytesOf('track_minute') + bytesOf('track_presence');
    fs.rmSync(dir, { recursive: true, force: true });
    store = agent._localStoreOpen(dir); agent._localTrackSetStoreForTest(store);
    recordHour(45, T0);
    const raid = bytesOf('track_minute') + bytesOf('track_presence');
    // eslint-disable-next-line no-console
    console.log(`[local-recorder] bytes per hour: solo ${solo}, 45 raiders in zone ${raid} (${(raid / 1048576).toFixed(2)} MB)`);
    expect(solo).toBeLessThan(150 * 1024);          // a solo hour is well under 150 KB
    expect(raid).toBeLessThan(12 * 1024 * 1024);    // the worst case, every raider placed all hour, stays single-digit MB
    expect(store.scan('track_presence')).toHaveLength(60);
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────────────
describe('local track routes', () => {
  const res = () => { const r = { status: 0, headers: null, body: '' }; return Object.assign(r, { writeHead: (s, h) => { r.status = s; r.headers = h; }, end: (b) => { r.body = b; } }); };
  const call = (url, method = 'GET') => { const r = res(); const handled = agent._localTrackRoute({ method, url }, r); return { handled, status: r.status, headers: r.headers, json: r.body ? JSON.parse(r.body) : null }; };
  const NIGHT2 = Date.UTC(2026, 9, 8, 1, 0, 0);   // the night of 10/07/2026

  beforeEach(() => {
    agent._localTrackSetStoreForTest(store);
    const put = (ms, name, x, zone) => {
      const row = agent._localTrackMinuteRow(ms, [{ t: ms + 3000, rows: [{ name, cls: 'Warrior', group: null, level: 60, hp: 90, x, y: -50, z: 3, h: 128, src: zone }], mobs: [] }], { srcZone: new Map([[zone, zone]]), stepS: 3 });
      store.put('track_minute', row.minute_at, row, { ts: ms });
      store.put('track_presence', row.minute_at, { night_key: row.night_key, minute_at: row.minute_at, zones: row.zones, raiders: row.raiders }, { ts: ms });
    };
    for (let i = 0; i < 40; i++) put(T0 + i * MIN, 'Aldenmar', 100 + i, 'gfaydark');
    for (let i = 0; i < 10; i++) put(NIGHT2 + i * MIN, 'Aldenmar', 300 + i, i < 5 ? 'gfaydark' : 'kithicor');
  });
  afterEach(() => { agent._localTrackSetStoreForTest(null); });

  it('ignores every other path and method', () => {
    expect(call('/api/state').handled).toBe(false);
    expect(call('/api/local/inventory').handled).toBe(false);
    expect(call('/api/local/tracker').handled).toBe(false);
    expect(call('/api/local/track', 'POST').handled).toBe(false);
  });

  it('nights: newest first, with the presence rows summarizeNights takes', () => {
    const out = call('/api/local/track/nights');
    expect(out.status).toBe(200);
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.json.nights.map(n => n.night_key)).toEqual(['10/07/2026', '10/04/2026']);
    expect(out.json.nights[0]).toMatchObject({ minutes: 10, zones: ['gfaydark', 'kithicor'], first: new Date(NIGHT2).toISOString(), last: new Date(NIGHT2 + 9 * MIN).toISOString() });
    expect(out.json.nights[1]).toMatchObject({ minutes: 40 });
    expect(out.json.rows).toHaveLength(50);
    expect(Object.keys(out.json.rows[0]).sort()).toEqual(['minute_at', 'night_key', 'raiders', 'zones']);
    // the web's own summary reads the rows and agrees on the nights and minutes
    const web = summarizeNights(out.json.rows);
    expect(web.map(n => [n.night_key, n.minutes])).toEqual(expect.arrayContaining([['10/04/2026', 40], ['10/07/2026', 10]]));
  });

  it('nights: days narrows the look-back', () => {
    const narrow = call('/api/local/track/nights?days=1');   // relative to the real clock: the fixtures are in the past
    expect(narrow.json.nights).toEqual([]);
  });

  it('window: the shape /api/spectator/replay returns, rows of { minute_at, zones, data }', () => {
    const from = new Date(T0 + 3 * MIN).toISOString(), to = new Date(T0 + 8 * MIN).toISOString();
    const out = call(`/api/local/track?night=${encodeURIComponent('10/04/2026')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(out.status).toBe(200);
    expect(Object.keys(out.json).sort()).toEqual(['from', 'night', 'rows', 'to']);
    expect(out.json).toMatchObject({ night: '10/04/2026', from, to });
    expect(out.json.rows).toHaveLength(5);
    expect(Object.keys(out.json.rows[0]).sort()).toEqual(['data', 'minute_at', 'zones']);
    expect(out.json.rows[0].minute_at).toBe(from);
    expect(typeof out.json.rows[0].data).toBe('string');
    const frames = decodeRows(out.json.rows);                                         // ReplayBoard's own decoder
    expect(frames).toHaveLength(5);
    expect(frames[0].raiders[0]).toMatchObject({ name: 'Aldenmar', zone: 'gfaydark', h: 128, hp: 90 });
  });

  it('window: from is inclusive, to exclusive, night optional, and the night filter applies when given', () => {
    const f = (ms) => encodeURIComponent(new Date(ms).toISOString());
    expect(call(`/api/local/track?from=${f(T0)}&to=${f(T0 + MIN)}`).json.rows).toHaveLength(1);
    expect(call(`/api/local/track?from=${f(T0)}&to=${f(T0 + MIN)}`).json.night).toBe('10/04/2026');
    expect(call(`/api/local/track?night=${encodeURIComponent('10/07/2026')}&from=${f(T0)}&to=${f(T0 + 5 * MIN)}`).json.rows).toEqual([]);
  });

  it('window: capped at 15 minutes however much is asked for', () => {
    const f = (ms) => encodeURIComponent(new Date(ms).toISOString());
    const out = call(`/api/local/track?from=${f(T0)}&to=${f(T0 + 40 * MIN)}`);
    expect(out.json.rows).toHaveLength(15);
    expect(out.json.to).toBe(new Date(T0 + 15 * MIN).toISOString());
  });

  it('window: a bad or empty range is a 400', () => {
    const f = (ms) => encodeURIComponent(new Date(ms).toISOString());
    expect(call('/api/local/track').status).toBe(400);
    expect(call('/api/local/track?from=nope&to=nope').status).toBe(400);
    expect(call(`/api/local/track?from=${f(T0 + MIN)}&to=${f(T0)}`).status).toBe(400);
    expect(call(`/api/local/track?night=junk&from=${f(T0)}&to=${f(T0 + MIN)}`).status).toBe(400);
  });
});

// ── Wiring and privacy, as text with comments stripped ─────────────────────────────────────────────────────
describe('wiring', () => {
  const src = readSource(AGENT_INDEX);
  const block = stripJs(sliceBlock(src, '// ── Local store + own position recorder (local-first, 2026-10-21)', 'function _localTrackSetStoreForTest(st) { _localTrack.store = st; }'));
  const code = stripJs(src);

  it('nothing in the store or recorder can reach the network or the upload queue', () => {
    for (const bad of [/enqueueUpload/, /https?\.request/, /\bfetch\s*\(/, /_postLiveState/, /\bhttps?\b\s*[.(]/, /XMLHttpRequest/, /net\.connect/, /\.send\(/]) {
      expect(block).not.toMatch(bad);
    }
  });
  it('the store is plain files: no module beyond fs and path', () => {
    expect(block).not.toMatch(/require\(/);
    expect(block).not.toMatch(/sqlite/i);
  });
  it('the dashboard router answers /api/local/track after the local guard, and the recorder starts in watch mode', () => {
    expect(code.indexOf('_localGuardBlock(req, res)')).toBeGreaterThan(-1);
    expect(code.indexOf('_localTrackRoute(req, res)')).toBeGreaterThan(code.indexOf('if (_localGuardBlock(req, res)) return;'));
    expect(code).toMatch(/try \{ _localRecorderStart\(\); \} catch/);
  });
  it('skips an excluded character and a read-only instance', () => {
    expect(block).toMatch(/exclude_from_stats/);
    expect(block).toMatch(/if \(!_isUploaderInstance\) return null;/);
  });
});
