// test/raid-track.test.js — the raid replay recorder (utils/raidTrack.js).
//
// What can go wrong without anyone noticing: positions that are not positions ((0,0,0) from a raider in
// another zone) ending up in the replay, two uploaders' views of one raider alternating, a minute row
// whose arrays do not line up, a raider who opted out being written, or a raider stamped with the wrong
// zone. These tests drive the real module against an in-memory Supabase; the wiring into index.js (the
// ingest hook, the midnight sweep, the start) and the migration are checked as text with comments
// stripped.
//
// Run: npx vitest run test/raid-track.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, BOT_INDEX, sliceBlock, stripJs, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const rt = require('../utils/raidTrack.js');
const raidNight = require('../utils/raidNight.js');

const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);   // a whole UTC minute
const MIN = 60_000;

// A roster row as _handleAgentRaidRoster builds it.
const row = (name, x, y, over = {}) => ({
  name, class: 'Warrior', group_num: 1, level: 60, hp_pct: null,
  loc_x: x, loc_y: y, loc_z: 5, heading: null, ...over,
});

// Eight placed raiders over three uploaders; the first one has opted out.
const crowd = {
  u1: ['Aldenmar', 'Brackwyn', 'Corvale', 'Gavrel'],
  u2: ['Rethlan', 'Nyssara', 'Zarrin'],
  u3: ['Dunmar', 'Eswyn'],
};
function noteCrowd(at, bump = 0) {
  for (const [src, names] of Object.entries(crowd)) {
    rt.noteRows(names.map((n, i) => row(n, 100 + i + bump, 200 + i + bump)), src, at);
  }
}

function makeFake(state = {}) {
  const s = { excluded: [], live: {}, zones: {}, failUpsert: 0, failExcluded: false, ...state };
  const calls = { select: [], upsert: [], paged: [] };
  const fake = {
    isEnabled: () => s.enabled !== false,
    selectAllPaged: async (table, q, order) => {
      calls.paged.push({ table, q, order });
      return s.failExcluded ? null : s.excluded.map(name => ({ name }));
    },
    select: async (table, qs) => {
      calls.select.push({ table, qs });
      if (table === 'character_live_state') {
        const asked = decodeURIComponent(/character=in\.([^&]+)/.exec(qs)[1]).match(/"([^"]*)"/g).map(q => q.slice(1, -1));
        return asked.filter(n => n in s.live).map(n => ({ character: n, zone_id: s.live[n] }));
      }
      if (table === 'eqemu_zone') {
        const ids = /zone_id=in\.\(([^)]*)\)/.exec(qs)[1].split(',').map(Number);
        return ids.filter(id => id in s.zones).map(id => ({ zone_id: id, short_name: s.zones[id] }));
      }
      return [];
    },
    upsert: async (table, rows, onConflict) => {
      calls.upsert.push({ table, rows, onConflict });
      if (s.failUpsert > 0) { s.failUpsert--; return null; }
      return rows.map(r => ({ guild_id: r.guild_id, minute_at: r.minute_at }));
    },
  };
  return { fake, s, calls };
}

const parse = (r) => JSON.parse(r.data);

beforeEach(() => {
  rt._reset();
  delete process.env.RAID_TRACK_MIN_PLACED;
  delete process.env.RAID_TRACK_STEP_S;
  delete process.env.RAID_TRACK_ENABLED;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  rt._reset();
  vi.restoreAllMocks();
});

describe('noteRows: what counts as a position', () => {
  it('drops (0,0,0) and non-finite rows, keeps real ones', () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    const kept = rt.noteRows([
      row('Aldenmar', 0, 0, { loc_z: 0 }),                 // another zone
      row('Brackwyn', 0, 0, { loc_z: null }),              // another zone, z missing
      row('Corvale', null, 5),
      row('Rethlan', 5, null),
      row('Nyssara', NaN, 5),
      row('Zarrin', '12', '34'),                           // never coerced
      row('Dunmar', Infinity, 5),
      row('Eswyn', 0, 0, { loc_z: 7 }),                    // x=y=0 but z real: a place
      row('Fenwyr', 0, 12, { loc_z: 0 }),                  // one axis zero is fine
      null, undefined, {}, row('', 1, 2),
    ], 'u1', T0);
    expect(kept).toBe(2);
    const frame = rt.takeFrame(T0 + 1000);
    expect(frame.rows.map(r => r.name).sort()).toEqual(['Eswyn', 'Fenwyr']);
  });

  it('never throws on garbage', () => {
    expect(() => rt.noteRows(null, 'u1')).not.toThrow();
    expect(() => rt.noteRows('rows', 'u1')).not.toThrow();
    expect(() => rt.noteRows([{ name: 'Aldenmar', loc_x: 1 }, 42, [], { name: {}, loc_x: 1, loc_y: 2 }], undefined)).not.toThrow();
  });
});

describe('sticky source', () => {
  beforeEach(() => { process.env.RAID_TRACK_MIN_PLACED = '1'; });
  const xOf = (at) => rt.takeFrame(at).rows.find(r => r.name === 'Aldenmar').x;

  it('a second uploader does not replace a fresh sample from the first', () => {
    rt.noteRows([row('Aldenmar', 10, 10)], 'u1', T0);
    rt.noteRows([row('Aldenmar', 50, 50)], 'u2', T0 + 3000);
    expect(xOf(T0 + 3500)).toBe(10);
  });

  it('the same uploader always replaces', () => {
    rt.noteRows([row('Aldenmar', 10, 10)], 'u1', T0);
    rt.noteRows([row('Aldenmar', 11, 11)], 'u1', T0 + 1000);
    expect(xOf(T0 + 1500)).toBe(11);
  });

  it('another uploader takes over once the first sample is older than STICKY_MS', () => {
    rt.noteRows([row('Aldenmar', 10, 10)], 'u1', T0);
    rt.noteRows([row('Aldenmar', 50, 50)], 'u2', T0 + rt.STICKY_MS);       // exactly at the limit: still sticky
    expect(xOf(T0 + rt.STICKY_MS)).toBe(10);
    rt.noteRows([row('Aldenmar', 50, 50)], 'u2', T0 + rt.STICKY_MS + 1);   // past it
    expect(xOf(T0 + rt.STICKY_MS + 1)).toBe(50);
  });

  it('keeps the first uploader\'s position but takes HP from another uploader that has it', () => {
    rt.noteRows([row('Aldenmar', 10, 10, { hp_pct: null })], 'u1', T0);
    rt.noteRows([row('Aldenmar', 50, 50, { hp_pct: 42 })], 'u2', T0 + 1000);
    const r = rt.takeFrame(T0 + 1500).rows.find(e => e.name === 'Aldenmar');
    expect(r.x).toBe(10);
    expect(r.src).toBe('u1');
    expect(r.hp).toBe(42);
    expect(r.atMs).toBe(T0);   // an HP-only update does not keep a silent uploader's position fresh
  });

  it('names are one raider whatever the case', () => {
    rt.noteRows([row('Aldenmar', 10, 10)], 'u1', T0);
    rt.noteRows([row('ALDENMAR', 50, 50)], 'u2', T0 + 1000);
    expect(rt.takeFrame(T0 + 1500).rows).toHaveLength(1);
  });
});

describe('frames', () => {
  it('a frame with fewer than MIN_PLACED raiders is not recorded', () => {
    rt.noteRows(['A1', 'B2', 'C3', 'D4', 'E5'].map((n, i) => row(n, 1 + i, 1)), 'u1', T0);
    expect(rt.minPlaced()).toBe(6);
    expect(rt.takeFrame(T0 + 1000)).toBeNull();
    expect(rt._state().curFrames).toBe(0);
    rt.noteRows([row('F6', 9, 9)], 'u1', T0 + 1500);
    expect(rt.takeFrame(T0 + 2000).rows).toHaveLength(6);
    expect(rt._state().curFrames).toBe(1);
  });

  it('RAID_TRACK_MIN_PLACED moves the bar', () => {
    process.env.RAID_TRACK_MIN_PLACED = '2';
    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0);
    expect(rt.takeFrame(T0 + 500)).toBeNull();
    rt.noteRows([row('Brackwyn', 2, 2)], 'u1', T0 + 600);
    expect(rt.takeFrame(T0 + 700)).not.toBeNull();
  });

  it('a sample older than FRESH_MS is not in a frame, and is forgotten after PRUNE_MS', () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0);
    expect(rt.takeFrame(T0 + rt.FRESH_MS)).not.toBeNull();
    expect(rt.takeFrame(T0 + rt.FRESH_MS + 1)).toBeNull();
    expect(rt._state().tracked).toBe(1);
    rt.takeFrame(T0 + rt.PRUNE_MS + 1);
    expect(rt._state().tracked).toBe(0);
  });

  it('closeFinished closes a minute only once it is over', () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0);
    rt.takeFrame(T0 + 1000);
    expect(rt.closeFinished(T0 + 30_000)).toBe(false);
    expect(rt._state().pending).toBe(0);
    expect(rt.closeFinished(T0 + MIN + 1)).toBe(true);
    expect(rt._state().pending).toBe(1);
  });
});

describe('a finished minute becomes one row', () => {
  it('flushes exactly one row, well-formed, when the next minute starts', async () => {
    const { fake, calls } = makeFake({ live: { Aldenmar: 100, Brackwyn: 100, Corvale: 100 }, zones: { 100: 'poinnovation' } });
    rt._setDeps({ supabase: fake });
    rt.noteRows(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'].map((n, i) =>
      row(n, 100.4 + i, -200.6 - i, { loc_z: 9.5, heading: 255.5 + i, hp_pct: i === 0 ? 87.4 : null })), 'u1', T0 + 1000);
    expect(rt.takeFrame(T0 + 2000)).not.toBeNull();
    rt.noteRows(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'].map((n, i) =>
      row(n, 110.4 + i, -210.6 - i, { level: 61 })), 'u1', T0 + 4000);
    expect(rt.takeFrame(T0 + 5000)).not.toBeNull();

    await rt.flush();
    expect(calls.upsert).toHaveLength(0);               // the minute is not over yet

    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0 + MIN + 1000);
    rt.takeFrame(T0 + MIN + 2000);                      // too few raiders to open a frame
    rt.noteRows(['Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'].map((n, i) => row(n, 7 + i, 7)), 'u1', T0 + MIN + 2500);
    rt.takeFrame(T0 + MIN + 3000);                      // first frame of the next minute closes the first
    await rt.flush();
    await rt.flush();

    expect(calls.upsert).toHaveLength(1);
    const { table, rows, onConflict } = calls.upsert[0];
    expect(table).toBe('raid_track_minutes');
    expect(onConflict.startsWith('guild_id,minute_at')).toBe(true);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.guild_id).toBe('wolfpack');
    expect(r.minute_at).toBe(new Date(T0).toISOString());
    expect(r.night_key).toBe(raidNight.nightKey(T0));
    expect(r.raiders).toBe(6);
    expect(r.frames).toBe(2);
    expect(r.zones).toEqual(['poinnovation']);

    const d = parse(r);
    expect(d.v).toBe(1);
    expect(d.step_s).toBe(3);
    expect(d.zones).toEqual(['poinnovation']);
    expect(d.who).toHaveLength(6);
    expect(d.who[0]).toEqual(['Aldenmar', 'Warrior', 1, 61]);   // last seen level wins
    expect(d.f).toHaveLength(2);
    for (const fr of d.f) {
      expect(fr.length).toBe(1 + 7 * 6);                         // dt + 7 ints per raider
      expect(fr.every(Number.isInteger)).toBe(true);
      expect(fr[0]).toBeGreaterThanOrEqual(0);
      expect(fr[0]).toBeLessThanOrEqual(59);
    }
    expect(d.f.map(fr => fr[0])).toEqual([2, 5]);               // whole seconds since minute_at
    // First raider of the first frame: [i, x, y, z, h, hp, zi], x/y raw (no swap), rounded.
    expect(d.f[0].slice(1, 8)).toEqual([0, 100, -201, 10, 256, 87, 0]);
    // Unknown heading and unknown hp are -1.
    expect(d.f[1].slice(1, 8)).toEqual([0, 110, -211, 5, -1, -1, 0]);
    const ids = d.f.flatMap(fr => fr.slice(1).filter((_, k) => k % 7 === 0));
    expect(Math.max(...ids)).toBe(5);
  });

  it('keeps at most three unflushed minutes and writes the rest oldest first', async () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    const { fake, calls } = makeFake();
    rt._setDeps({ supabase: fake });
    for (let m = 0; m < 5; m++) {
      rt.noteRows([row('Aldenmar', m, m)], 'u1', T0 + m * MIN);
      rt.takeFrame(T0 + m * MIN + 500);
    }
    expect(rt._state().pending).toBe(rt.MAX_PENDING_MINUTES);
    await rt.flush();
    expect(calls.upsert.map(c => c.rows[0].minute_at)).toEqual(
      [1, 2, 3].map(m => new Date(T0 + m * MIN).toISOString()));
  });

  it('a raider with no live zone anywhere is recorded with zone -1 and no zones', async () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    const { fake, calls } = makeFake();
    rt._setDeps({ supabase: fake });
    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0);
    rt.takeFrame(T0 + 500);
    rt.closeFinished(T0 + MIN);
    await rt.flush();
    const r = calls.upsert[0].rows[0];
    expect(r.zones).toEqual([]);
    expect(parse(r).zones).toEqual([]);
    expect(parse(r).f[0][7]).toBe(-1);
  });
});

describe('zones and exclusions', () => {
  async function flushedCrowd(extra = {}) {
    const m = makeFake({
      excluded: ['gavrel'],                                       // stored lowercase or not, matched either way
      live: { Aldenmar: 100, Brackwyn: 100, Corvale: 100, Gavrel: 100, Dunmar: 101, Eswyn: 101 },
      zones: { 100: 'poinnovation', 101: 'potimea' },
      ...extra,
    });
    rt._setDeps({ supabase: m.fake });
    noteCrowd(T0 + 1000);
    rt.takeFrame(T0 + 2000);
    noteCrowd(T0 + 4000, 1);
    rt.takeFrame(T0 + 5000);
    rt.closeFinished(T0 + MIN);
    await rt.flush();
    return m;
  }
  const zoneOfWho = (d) => {
    const out = {};
    for (const fr of d.f) {
      for (let k = 1; k < fr.length; k += 7) out[d.who[fr[k]][0]] = fr[k + 6] === -1 ? null : d.zones[fr[k + 6]];
    }
    return out;
  };

  it('every sample takes its uploader\'s zone: own majority, else the raid\'s majority', async () => {
    const { calls } = await flushedCrowd();
    expect(calls.upsert).toHaveLength(1);
    const z = zoneOfWho(parse(calls.upsert[0].rows[0]));
    expect(z).toMatchObject({
      Aldenmar: 'poinnovation', Brackwyn: 'poinnovation', Corvale: 'poinnovation',   // u1: its own raiders are live there
      Dunmar: 'potimea', Eswyn: 'potimea',                                            // u3: live in the other zone
      Rethlan: 'poinnovation', Nyssara: 'poinnovation', Zarrin: 'poinnovation',       // u2: nobody live, so the raid's majority (3 vs 2)
    });
    expect(calls.upsert[0].rows[0].zones.sort()).toEqual(['poinnovation', 'potimea']);
  });

  it('a raider with exclude_from_stats never appears, and is not even looked up', async () => {
    const { calls } = await flushedCrowd();
    const r = calls.upsert[0].rows[0];
    const d = parse(r);
    expect(d.who.map(w => w[0])).not.toContain('Gavrel');
    expect(r.data).not.toContain('Gavrel');
    expect(r.raiders).toBe(8);                                   // 9 seen, 1 excluded
    expect(calls.select.every(c => !c.qs.includes('Gavrel'))).toBe(true);
    expect(calls.paged[0].q).toContain('exclude_from_stats=eq.true');
  });

  it('buildMinuteRow drops an excluded raider by itself and returns null when nothing is left', () => {
    const frame = { t: T0 + 2000, rows: [
      { name: 'Aldenmar', cls: 'Cleric', group: 1, level: 60, hp: 50, x: 1, y: 2, z: 3, h: 4, atMs: T0, src: 'u1' },
      { name: 'Brackwyn', cls: 'Rogue', group: 2, level: 60, hp: 50, x: 5, y: 6, z: 7, h: 8, atMs: T0, src: 'u1' },
    ] };
    const some = rt.buildMinuteRow(T0, [frame], { excluded: new Set(['aldenmar']) });
    expect(parse(some).who).toEqual([['Brackwyn', 'Rogue', 2, 60]]);
    expect(rt.buildMinuteRow(T0, [frame], { excluded: new Set(['aldenmar', 'brackwyn']) })).toBeNull();
    // dt never leaves 0..59
    const late = rt.buildMinuteRow(T0, [{ ...frame, t: T0 + 75_000 }], {});
    expect(parse(late).f[0][0]).toBe(59);
  });

  it('the live-zone and zone-name reads are bounded, fresh, and cached for a day', async () => {
    const { calls } = await flushedCrowd();
    const live = calls.select.filter(c => c.table === 'character_live_state');
    expect(live).toHaveLength(1);
    expect(live[0].qs).toContain('guild_id=eq.wolfpack');
    expect(live[0].qs).toContain('updated_at=gte.');
    expect(live[0].qs).toMatch(/limit=200/);
    const zoneReads = () => calls.select.filter(c => c.table === 'eqemu_zone').length;
    expect(zoneReads()).toBe(1);
    // A second minute with the same zones asks eqemu_zone for nothing.
    noteCrowd(T0 + MIN + 1000);
    rt.takeFrame(T0 + MIN + 2000);
    rt.closeFinished(T0 + 2 * MIN);
    await rt.flush();
    expect(calls.upsert).toHaveLength(2);
    expect(zoneReads()).toBe(1);
  });

  it('more than 200 raiders are looked up in chunks', async () => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    const { fake, calls } = makeFake();
    rt._setDeps({ supabase: fake });
    const names = Array.from({ length: 450 }, (_, i) => `Raider${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
    rt.noteRows(names.map((n, i) => row(n, i + 1, 1)), 'u1', T0);
    rt.takeFrame(T0 + 500);
    rt.closeFinished(T0 + MIN);
    await rt.flush();
    expect(calls.select.filter(c => c.table === 'character_live_state')).toHaveLength(3);
  });
});

describe('failures never crash and never record an opted-out raider', () => {
  const setup = (state) => {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    const m = makeFake(state);
    let clock = T0 + 2 * MIN;
    rt._setDeps({ supabase: m.fake, now: () => clock });
    rt.noteRows([row('Aldenmar', 1, 1)], 'u1', T0);
    rt.takeFrame(T0 + 500);
    rt.closeFinished(T0 + MIN);
    return { ...m, advance: (ms) => { clock += ms; } };
  };

  it('a failed write is retried after the backoff, then lands once', async () => {
    const { calls, advance } = setup({ failUpsert: 1 });
    await rt.flush();
    expect(calls.upsert).toHaveLength(1);
    expect(rt._state().pending).toBe(1);
    await rt.flush();                                            // still backing off
    expect(calls.upsert).toHaveLength(1);
    advance(rt.RETRY_BACKOFF_MS + 1);
    await rt.flush();
    expect(calls.upsert).toHaveLength(2);
    expect(rt._state().pending).toBe(0);
  });

  it('a minute that keeps failing is dropped after MAX_ATTEMPTS so it cannot block the queue', async () => {
    const { calls, advance } = setup({ failUpsert: 99 });
    for (let i = 0; i < rt.MAX_ATTEMPTS; i++) { await rt.flush(); advance(rt.RETRY_BACKOFF_MS + 1); }
    expect(calls.upsert).toHaveLength(rt.MAX_ATTEMPTS);
    expect(rt._state().pending).toBe(0);
  });

  it('writes nothing until the exclusion list has been read at least once', async () => {
    const { calls, s, advance } = setup({ failExcluded: true });
    await rt.flush();
    expect(calls.upsert).toHaveLength(0);
    expect(rt._state().pending).toBe(1);
    s.failExcluded = false;
    advance(rt.RETRY_BACKOFF_MS + 1);
    await rt.flush();
    expect(calls.upsert).toHaveLength(1);
  });

  it('an exclusion list that stops loading keeps the last good set', async () => {
    const { calls, s, advance } = setup({ excluded: ['aldenmar'] });
    await rt.flush();
    expect(calls.upsert).toHaveLength(0);                        // the only raider opted out: nothing to write
    expect(rt._state().pending).toBe(0);
    s.failExcluded = true;
    advance(rt.EXCLUDE_TTL_MS + 1);
    rt.noteRows([row('Aldenmar', 2, 2)], 'u1', T0 + 3 * MIN);
    rt.takeFrame(T0 + 3 * MIN + 500);
    rt.closeFinished(T0 + 4 * MIN);
    await rt.flush();
    expect(calls.upsert).toHaveLength(0);                        // still excluded from the last good set
  });

  it('supabase disabled: pending minutes are dropped quietly', async () => {
    const { calls, s } = setup({});
    s.enabled = false;
    await rt.flush();
    expect(calls.upsert).toHaveLength(0);
    expect(rt._state().pending).toBe(0);
  });
});

describe('start / stop', () => {
  it('does nothing when disabled by env or when supabase is off, and is idempotent', () => {
    rt._setDeps({ supabase: makeFake().fake });
    process.env.RAID_TRACK_ENABLED = '0';
    expect(rt.start()).toBe(false);
    delete process.env.RAID_TRACK_ENABLED;
    rt._setDeps({ supabase: makeFake({ enabled: false }).fake });
    expect(rt.start()).toBe(false);
    rt._setDeps({ supabase: makeFake().fake });
    expect(rt.start()).toBe(true);
    expect(rt.start()).toBe(false);
    rt.stop();
    expect(rt.start()).toBe(true);
    rt.stop();
  });

  it('the timer cuts a frame every STEP_S seconds', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0 + 10_000);
      process.env.RAID_TRACK_MIN_PLACED = '1';
      process.env.RAID_TRACK_STEP_S = '2';
      rt._setDeps({ supabase: makeFake().fake });
      rt.noteRows([row('Aldenmar', 1, 1)], 'u1');
      expect(rt.start()).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(rt._state().curFrames).toBe(1);
      rt.noteRows([row('Aldenmar', 2, 2)], 'u1');
      vi.advanceTimersByTime(2000);
      expect(rt._state().curFrames).toBe(2);
    } finally {
      rt.stop();
      vi.useRealTimers();
    }
  });
});

describe('wiring in index.js and the migration (text, comments stripped)', () => {
  const bot = readSource(BOT_INDEX);

  it('the roster ingest hands its rows over after the empty check and before the upsert, guarded', () => {
    const handler = stripJs(sliceBlock(bot, 'async function _handleAgentRaidRoster(req, res) {', '\n}\n'));
    const hook = handler.indexOf("require('./utils/raidTrack').noteRows(rows, identity.discord_id)");
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(handler.indexOf('rows.length === 0'));
    expect(hook).toBeLessThan(handler.indexOf("require('./utils/liveMemory').noteRosterRows(rows)"));
    // inside its own try/catch: the nearest `try {` above is not already closed
    const tryAt = handler.lastIndexOf('try {', hook);
    expect(handler.slice(tryAt, hook)).not.toMatch(/catch/);
    expect(handler.slice(hook, hook + 160)).toMatch(/\}\s*catch\s*\{\s*\}/);
  });

  it('the recorder is started once, and the midnight chain sweeps raid_track_minutes by minute_at', () => {
    expect(stripJs(bot).match(/require\('\.\/utils\/raidTrack'\)\.start\(\);/g)).toHaveLength(1);
    const sweep = stripJs(sliceBlock(bot, 'Retention sweep: raid_track_minutes', "raid_track_minutes retention skipped:', err?.message);"));
    expect(sweep).toMatch(/RAID_TRACK_RETENTION_DAYS/);
    expect(sweep).toMatch(/supabase\.del\('raid_track_minutes', `minute_at=lt\.\$\{encodeURIComponent\(cutoff\)\}`\)/);
    expect(sweep).toMatch(/keep > 0/);
    expect(sweep).toMatch(/: 0;/);   // every raid is kept unless a retention is set (the guild lead, 2026-10-05)
    // …and even then only what Tower already holds: no watermark, no delete.
    expect(sweep).toMatch(/key=eq\.archive_watermark_raid_track_minutes/);
    expect(sweep).toMatch(/if \(!Number\.isFinite\(archivedThrough\)\) \{\s*console\.warn/);
    expect(sweep).toMatch(/Math\.min\(Date\.now\(\) - keep \* 24 \* 60 \* 60 \* 1000, archivedThrough\)/);
  });

  it('the Tower archive creates raid_track_minutes and keeps it as an ARCHIVE table (never deletes)', () => {
    const merge = stripSql(fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'archive-merge.sql'), 'utf8'));
    expect(merge).toMatch(/create table if not exists public\.raid_track_minutes \(/);
    expect(merge).toMatch(/primary key \(guild_id, minute_at\)/);
    const list = merge.match(/archive_tables text\[\] := array\[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toMatch(/'raid_track_minutes'/);
  });

  it('the migration is idempotent, indexes the sweep predicate and grants nothing', () => {
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261005020000_raid_track_minutes.sql'), 'utf8'));
    expect(sql).toMatch(/create table if not exists public\.raid_track_minutes/i);
    expect(sql).toMatch(/primary key \(guild_id, minute_at\)/i);
    expect(sql).toMatch(/create index if not exists raid_track_minutes_minute_at_idx on public\.raid_track_minutes \(minute_at\)/i);
    expect(sql).toMatch(/alter table public\.raid_track_minutes enable row level security/i);
    expect(sql).not.toMatch(/create policy|grant /i);
    expect(sql).toMatch(/data\s+text\s+not null/i);
  });
});

// ── Targets in the replay (the guild lead, 2026-10-15: "see bosses that we're targeting") ──────────────────
describe('targets ride the minute row (mobs + mf)', () => {
  const rtMod = require('../utils/raidTargets.js');
  const SIX = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'];
  // What the agent sends for a mob standing where a raider with roster (loc_x, loc_y) stands: the Map's server
  // frame, which is the pipe's x/y swapped (packages/wolfpack-logsync/index.js _mapServerXY).
  const serverOf = (locX, locY, z = 5) => ({ x: locY, y: locX, z });
  const rec = (character, id, name, map, over = {}) => ({
    character, zone: 'poinnovation', target_id: id, target_name: name, target_type: 1, target_map: map, ...over,
  });
  function setup() {
    const clk = { t: T0 + 1000 };
    const targets = rtMod.create({ now: () => clk.t, log: { warn() {} } });
    rt.setTargetSource((isRaider) => targets.snapshot(isRaider));
    rt.noteRows(SIX.map((n, i) => row(n, 100 + i, -200 - i)), 'u1', T0 + 1000);
    return { clk, targets };
  }
  const build = (frames, opts = {}) => rt.buildMinuteRow(T0, frames, { guildId: 'wolfpack', ...opts });

  it('writes mobs and mf with the right indexes, counts and zone', () => {
    const { targets } = setup();
    targets.noteSample(rec('Aldenmar', 901, 'a lava golem', serverOf(300, 400)));
    targets.noteSample(rec('Brackwyn', 901, 'a lava golem', serverOf(300, 400)));
    targets.noteSample(rec('Corvale', 902, 'Lord Nagafen', serverOf(-50, 60, 8)));
    const fr = rt.takeFrame(T0 + 2000);
    const d = parse(build([fr], { srcZone: new Map([['u1', 'poinnovation']]) }));
    expect(d.v).toBe(1);
    expect(d.mobs).toEqual([['a lava golem', 901], ['Lord Nagafen', 902]]);
    expect(d.zones).toEqual(['poinnovation']);
    // [dt, mi, x, y, z, n, zi]; most-targeted first
    expect(d.mf).toEqual([[2, 0, 300, 400, 5, 2, 0], [2, 1, -50, 60, 8, 1, 0]]);
  });

  it('a target zone the raiders do not have yet is added to the same zones list', () => {
    const { targets } = setup();
    targets.noteSample(rec('Aldenmar', 5, 'a sand giant', serverOf(1, 2), { zone: 'tenebrous' }));
    const d = parse(build([rt.takeFrame(T0 + 2000)], { srcZone: new Map([['u1', 'poinnovation']]) }));
    expect(d.zones).toEqual(['poinnovation', 'tenebrous']);
    expect(d.mf[0][6]).toBe(1);
  });

  it('one mob across frames is one entry in mobs; a null spawn id stays null', () => {
    const { targets } = setup();
    targets.noteSample(rec('Aldenmar', 901, 'a lava golem', serverOf(300, 400)));
    const a = rt.takeFrame(T0 + 2000);
    rt.noteRows(SIX.map((n, i) => row(n, 100 + i, -200 - i)), 'u1', T0 + 4000);
    const b = rt.takeFrame(T0 + 5000);
    const d = parse(build([a, b]));
    expect(d.mobs).toEqual([['a lava golem', 901]]);
    expect(d.mf.map(e => e[0])).toEqual([2, 5]);
    expect(d.mf.every(e => e[1] === 0)).toBe(true);
    const nullId = parse(build([{ t: T0 + 2000, rows: a.rows, mobs: [{ name: 'a thing', id: null, zone: 'x', x: 1, y: 2, z: 3, n: 1 }] }]));
    expect(nullId.mobs).toEqual([['a thing', null]]);
  });

  it('no targets: neither key is written, and with no source wired nothing changes', () => {
    setup();
    const d = parse(build([rt.takeFrame(T0 + 2000)]));
    expect('mobs' in d).toBe(false);
    expect('mf' in d).toBe(false);
    rt._reset();
    rt.noteRows(SIX.map((n, i) => row(n, 100 + i, -200 - i)), 'u1', T0 + 1000);
    const d2 = parse(build([rt.takeFrame(T0 + 2000)]));
    expect(Object.keys(d2)).toEqual(['v', 'step_s', 'who', 'zones', 'f']);
  });

  it('keeps the most-targeted TARGETS_PER_FRAME when there are more', () => {
    const clk = { t: T0 + 1000 };
    const targets = rtMod.create({ now: () => clk.t, log: { warn() {} } });
    rt.setTargetSource((isRaider) => targets.snapshot(isRaider));
    const names = Array.from({ length: 40 }, (_, i) => 'Raider' + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + (i >= 26 ? 'x' : ''));
    rt.noteRows(names.map((n, i) => row(n, 100 + i, 200)), 'u1', T0 + 1000);
    // 28 NPCs: the first is targeted by three raiders, the rest by one each.
    for (let i = 0; i < 3; i++) targets.noteSample(rec(names[i], 1000, 'mob 0', serverOf(10, 10)));
    for (let k = 1; k < 28; k++) targets.noteSample(rec(names[k + 2], 1000 + k, 'mob ' + k, serverOf(10 + k, 10)));
    expect(targets.snapshot(() => true).length).toBe(28);
    const fr = rt.takeFrame(T0 + 2000);
    expect(fr.mobs).toHaveLength(rt.TARGETS_PER_FRAME);
    const d = parse(build([fr]));
    expect(d.mf).toHaveLength(rt.TARGETS_PER_FRAME);
    expect(d.mobs).toHaveLength(rt.TARGETS_PER_FRAME);
    expect(d.mobs[0]).toEqual(['mob 0', 1000]);
    expect(d.mf[0][5]).toBe(3);
  });

  it('a stale sample is not recorded, and a target of someone outside the frame does not count', () => {
    const { clk, targets } = setup();
    targets.noteSample(rec('Aldenmar', 901, 'a lava golem', serverOf(300, 400)));
    targets.noteSample(rec('Outsider', 901, 'a lava golem', serverOf(300, 400)));   // a Mimic user in no raid frame
    targets.noteSample(rec('Brackwyn', 902, 'an old target', serverOf(1, 1)));
    clk.t += rtMod.SAMPLE_FRESH_MS - 1000;
    targets.noteSample(rec('Aldenmar', 901, 'a lava golem', serverOf(300, 400)));
    clk.t += 2000;                                                                  // Brackwyn's is now past the TTL
    rt.noteRows(SIX.map((n, i) => row(n, 100 + i, -200 - i)), 'u1', T0 + 1000 + rtMod.SAMPLE_FRESH_MS);
    const fr = rt.takeFrame(T0 + 1000 + rtMod.SAMPLE_FRESH_MS + 500);
    expect(fr.mobs.map(m => [m.name, m.n])).toEqual([['a lava golem', 1]]);
  });

  it('FRAME: a mob standing on a raider encodes to that raider\'s own x,y', () => {
    const { targets } = setup();
    // Aldenmar stands at roster (loc_x, loc_y) = (100, -200). A mob on his spot reaches the bot in the server
    // frame (agent: server x = pipe y), and must be written in the raiders' frame so the web's one serverXY swap
    // lands both on the same point.
    targets.noteSample(rec('Brackwyn', 77, 'a mob on Aldenmar', serverOf(100, -200)));
    const d = parse(build([rt.takeFrame(T0 + 2000)]));
    const raider = d.f[0].slice(1, 8);                       // [i, x, y, z, h, hp, zi] for the first raider
    const mob = d.mf[0];                                     // [dt, mi, x, y, z, n, zi]
    expect(raider.slice(1, 3)).toEqual([100, -200]);
    expect([mob[2], mob[3]]).toEqual([raider[1], raider[2]]);
    // …and the web's decoder (serverXY(loc_x, loc_y) = { x: loc_y, y: loc_x }) puts them in one place.
    const web = (x, y) => ({ x: y, y: x });
    expect(web(mob[2], mob[3])).toEqual(web(raider[1], raider[2]));
    expect(web(mob[2], mob[3])).toEqual({ x: -200, y: 100 });   // the sample as the agent sent it
  });

  it('never records which raider targeted what', () => {
    const { targets } = setup();
    targets.noteSample(rec('Aldenmar', 901, 'a lava golem', serverOf(300, 400)));
    targets.noteSample(rec('Nyssara', 901, 'a lava golem', serverOf(300, 400)));
    const fr = rt.takeFrame(T0 + 2000);
    const r = build([fr], { excluded: new Set(['aldenmar']) });   // one of the two opted out of stats
    const d = parse(r);
    const targetPart = JSON.stringify({ mobs: d.mobs, mf: d.mf });
    for (const n of SIX) expect(targetPart.toLowerCase()).not.toContain(n.toLowerCase());
    expect(d.mf[0][5]).toBe(2);                                    // an NPC is not a person: the count includes them
    expect(JSON.stringify(d.who)).not.toContain('Aldenmar');       // the excluded raider is still never written
    expect(Object.keys(fr.mobs[0]).sort()).toEqual(['id', 'n', 'name', 'x', 'y', 'z', 'zone']);
  });

  it('a throwing target source cannot stop a frame', () => {
    setup();
    rt.setTargetSource(() => { throw new Error('boom'); });
    const fr = rt.takeFrame(T0 + 2000);
    expect(fr).not.toBeNull();
    expect(fr.mobs).toEqual([]);
  });

  it('the bot wires raidTargets.snapshot into the recorder', () => {
    const bot = stripJs(readSource(BOT_INDEX));
    expect(bot).toMatch(/require\('\.\/utils\/raidTrack'\)\.setTargetSource\(\(isRaider\) => _raidTargets\(\)\.snapshot\(isRaider\)\);/);
  });
});
