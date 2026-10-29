// test/raid-history-streams.test.js — six raid streams the bot used to forget at a restart are now SAVED.
//
// The guild lead, 2026-10-29, option C: mob sightings, mob HP, who cast what, zone changes, pet / charm owner
// declarations and trigger fires. utils/raidHistory.js decides in memory what is NEW (the dedupe rules below) and
// appends it through one batched, bounded, sheddable writer; the bot's midnight chain prunes at 60 days.
//
// These cases RUN the shipped module against a recording client and a manual clock; index.js is checked for the
// wiring (comments stripped first: a comment can describe a call that was removed). The HP-step and cast-dedupe
// cases were mutation-checked (HP_STEP 5 → 1 and the cast window 2000 → 0 each turn the named case red).
//
// Fixture names are invented (Aldenmar, Brackwyn, Corvale); none is a member.
//
// Run: npx vitest run test/raid-history-streams.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, stripSql, evalBlock, BOT_INDEX, ROOT } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const rh = requireBot('./utils/raidHistory');
const raidTargets = requireBot('./utils/raidTargets');
const SRC = readSource(BOT_INDEX);

const T0 = Date.parse('2026-10-29T01:00:00Z');
const SEC = 1000;

// A recording Supabase stand-in. `insert` answers true (written) or null (failed) like the real client.
function fakeSb(over = {}) {
  const sb = {
    enabled: true, open: false, failInserts: 0,
    inserted: [],          // { table, rows }
    tables: {},            // table → rows (for the prune cases): [{ <timeCol>: iso }]
    dels: [],              // { table, q }
    isEnabled() { return sb.enabled; },
    breakerState() { return { open: sb.open }; },
    async insert(table, rows, opts) {
      if (sb.failInserts > 0) { sb.failInserts--; return null; }
      sb.inserted.push({ table, rows, opts });
      return true;
    },
    async select(table, q) {
      const col = /select=(\w+)/.exec(q)[1];
      const rows = (sb.tables[table] || []).slice().sort((a, b) => Date.parse(a[col]) - Date.parse(b[col]));
      return rows.slice(0, 1);
    },
    async del(table, q) {
      const col0 = /^(\w+)=lt/.exec(q)[1];
      const oldest = Math.min(...(sb.tables[table] || []).map(r => Date.parse(r[col0])));
      sb.dels.push({ table, q, oldest });
      if (sb.noDelete) return null;
      const m = /^(\w+)=lt\.(.+)$/.exec(q);
      const hi = Date.parse(decodeURIComponent(m[2]));
      sb.tables[table] = (sb.tables[table] || []).filter(r => !(Date.parse(r[m[1]]) < hi));
      return null;
    },
    ...over,
  };
  return sb;
}

function mk(over = {}) {
  const clock = { t: T0 };
  const sb = over.sb || fakeSb();
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const h = rh.create({
    supabase: sb, guildId: 'wolfpack', now: () => clock.t, log,
    setTimer: () => ({ unref() {} }), clearTimer: () => {}, ...over.opts,
  });
  const rows = (table) => sb.inserted.filter(i => i.table === table).flatMap(i => i.rows);
  return { h, sb, clock, log, rows };
}

const sample = (over = {}) => ({ character: 'Aldenmar', zone: 'sebilis', id: 4425, name: 'a sebilis guard', x: 100, y: 200, z: 5, ...over });

describe('1. mob sightings: a row on a target change or a >10-unit move, not on every sample', () => {
  it('saves the first sighting, then nothing while the same mob stays within 10 units', () => {
    const { h, clock } = mk();
    expect(h.noteSighting(sample(), clock.t)).toBe(true);
    expect(h.noteSighting(sample({ x: 103 }), clock.t + SEC)).toBe(false);
    expect(h.noteSighting(sample({ x: 100, y: 209.9 }), clock.t + 2 * SEC)).toBe(false);
    expect(h.pending().raid_mob_sightings).toBe(1);
  });

  it('saves again when the mob is more than 10 units from the character\'s last SAVED row (not the last sample)', () => {
    const { h, clock } = mk();
    h.noteSighting(sample(), clock.t);
    h.noteSighting(sample({ x: 106 }), clock.t + SEC);            // 6 from the saved row: no
    expect(h.noteSighting(sample({ x: 112 }), clock.t + 2 * SEC)).toBe(true);   // 12 from the saved row: yes
    expect(h.pending().raid_mob_sightings).toBe(2);
    expect(h.noteSighting(sample({ x: 118 }), clock.t + 3 * SEC)).toBe(false);  // 6 from the NEW saved row
  });

  it('saves when the target spawn changes, and treats a different zone with the same id as a different mob', () => {
    const { h, clock } = mk();
    h.noteSighting(sample(), clock.t);
    expect(h.noteSighting(sample({ id: 4426, name: 'a sebilis guard' }), clock.t + SEC)).toBe(true);
    expect(h.noteSighting(sample({ id: 4426, zone: 'veeshan' }), clock.t + 2 * SEC)).toBe(true);
  });

  it('keeps one state per character: a second raider on the same mob gets their own first row', () => {
    const { h, clock } = mk();
    h.noteSighting(sample(), clock.t);
    expect(h.noteSighting(sample({ character: 'Brackwyn' }), clock.t)).toBe(true);
    expect(h.noteSighting(sample({ character: 'brackwyn' }), clock.t + SEC)).toBe(false);   // the key is case-insensitive
  });

  it('ignores a sample with no spawn id, no zone or no position', () => {
    const { h, clock } = mk();
    expect(h.noteSighting(sample({ id: 0 }), clock.t)).toBe(false);
    expect(h.noteSighting(sample({ zone: '' }), clock.t)).toBe(false);
    expect(h.noteSighting(sample({ x: NaN }), clock.t)).toBe(false);
    expect(h.noteSighting(null)).toBe(false);
    expect(h.pending().raid_mob_sightings).toBe(0);
  });

  it('the row carries the sample as raidTargets cleaned it', async () => {
    const { h, sb, clock } = mk();
    h.noteSighting(sample({ x: 100.04, y: 200.06 }), clock.t);
    await h.flush();
    const r = sb.inserted[0].rows[0];
    expect(sb.inserted[0].table).toBe('raid_mob_sightings');
    expect(r).toMatchObject({ guild_id: 'wolfpack', character: 'Aldenmar', zone: 'sebilis', spawn_id: 4425, mob_name: 'a sebilis guard', x: 100, y: 200.1, z: 5 });
    expect(r.seen_at).toBe(new Date(clock.t).toISOString());
  });
});

describe('1b. raidTargets hands each cleaned sample to the recorder', () => {
  const raw = (over = {}) => ({ character: 'Aldenmar', zone: 'sebilis', target_id: 4425, target_name: 'a sebilis guard', target_type: 1,
    target_map: { x: 10, y: 20, z: 3 }, ...over });

  it('calls onSample with the cleaned sample and the time; a thrown error never fails the upload', () => {
    const seen = [];
    const rt = raidTargets.create({ now: () => T0, onSample: (s, at) => seen.push([s, at]) });
    expect(rt.noteSample(raw())).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ character: 'Aldenmar', zone: 'sebilis', id: 4425, name: 'a sebilis guard', x: 10, y: 20, z: 3 });
    expect(seen[0][1]).toBe(T0);
    const boom = raidTargets.create({ now: () => T0, onSample: () => { throw new Error('recorder down'); } });
    expect(boom.noteSample(raw())).toBe(true);
  });

  it('does not call it for a target that cannot be placed (a player, no id)', () => {
    const seen = [];
    const rt = raidTargets.create({ now: () => T0, onSample: (s) => seen.push(s) });
    expect(rt.noteSample(raw({ target_type: 0 }))).toBe(false);
    expect(rt.noteSample(raw({ target_id: 0 }))).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('2. mob HP: a row per 5-point step or death, per MOB, however many Mimics poll it', () => {
  const hp = (over = {}) => ({ zone: 'Sebilis', spawn_id: 4425, name: 'a sebilis guard', hp: 100, ...over });

  it('walks a fight: baseline, then only each step of 5 or more, then the death once', () => {
    const { h, clock } = mk();
    const saved = [];
    for (const v of [100, 99.9, 97, 95, 92, 90, 71, 70, 40, 0, 0, 0]) {
      if (h.noteMobHp(hp({ hp: v }), clock.t)) saved.push(v);
      clock.t += 2 * SEC;
    }
    expect(saved).toEqual([100, 95, 90, 71, 40, 0]);
  });

  it('a step of exactly 5 saves and a step of 4.9 does not (the HP_STEP boundary)', () => {
    const { h, clock } = mk();
    h.noteMobHp(hp({ hp: 80 }), clock.t);
    expect(h.noteMobHp(hp({ hp: 75.1 }), clock.t)).toBe(false);
    expect(h.noteMobHp(hp({ hp: 75 }), clock.t)).toBe(true);
  });

  it('twenty Mimics polling the same reading write one row', () => {
    const { h, clock } = mk();
    let n = 0;
    for (let i = 0; i < 20; i++) if (h.noteMobHp(hp({ hp: 63 }), clock.t + i * 100)) n++;
    expect(n).toBe(1);
  });

  it('a rise of 5 or more (a heal, a reset) is a move too', () => {
    const { h, clock } = mk();
    h.noteMobHp(hp({ hp: 40 }), clock.t);
    expect(h.noteMobHp(hp({ hp: 100 }), clock.t + SEC)).toBe(true);
  });

  it('death (0) is saved even from a small step, and a corpse still reading 0 is not another death', () => {
    const { h, clock } = mk();
    h.noteMobHp(hp({ hp: 3 }), clock.t);
    expect(h.noteMobHp(hp({ hp: 0 }), clock.t + SEC)).toBe(true);
    expect(h.noteMobHp(hp({ hp: 0 }), clock.t + 2 * SEC)).toBe(false);
  });

  it('keys by spawn id when there is one, else by a unique name; two spawns of one name are two mobs', () => {
    const { h, clock } = mk();
    expect(h.noteMobHp(hp({ spawn_id: 11, hp: 100 }), clock.t)).toBe(true);
    expect(h.noteMobHp(hp({ spawn_id: 12, hp: 100 }), clock.t)).toBe(true);
    expect(h.noteMobHp(hp({ spawn_id: 11, hp: 98 }), clock.t)).toBe(false);
    expect(h.noteMobHp(hp({ spawn_id: undefined, name: 'Lord Nagafen', hp: 100 }), clock.t)).toBe(true);
    expect(h.noteMobHp(hp({ spawn_id: undefined, name: 'lord nagafen', hp: 99 }), clock.t)).toBe(false);
    expect(h.noteMobHp(hp({ spawn_id: 11, zone: 'Veeshan', hp: 100 }), clock.t)).toBe(true);   // another zone's slot 11
  });

  it('forgets a mob it has not seen for hours (a respawn gets a fresh baseline)', () => {
    const { h, clock } = mk();
    h.noteMobHp(hp({ hp: 50 }), clock.t);
    expect(h.noteMobHp(hp({ hp: 52 }), clock.t + 3 * 60 * 60 * 1000)).toBe(true);
  });

  it('rejects an unreadable HP or a nameless mob', () => {
    const { h, clock } = mk();
    expect(h.noteMobHp(hp({ hp: null }), clock.t)).toBe(false);
    expect(h.noteMobHp(hp({ hp: 'x' }), clock.t)).toBe(false);
    expect(h.noteMobHp(hp({ name: '' }), clock.t)).toBe(false);
  });
});

describe('3. casts: one row per cast start, the same cast from two uploaders once', () => {
  const cast = (over = {}) => ({ caster: 'Corvale', spell: 'Complete Heal', target: 'Aldenmar', target_id: null, started_at_ms: T0, cast_secs: 10, heal_amount: 7000, ...over });

  it('collapses the same caster + spell + target reported twice within 2 s, however the second start is skewed', () => {
    const { h, clock } = mk();
    expect(h.noteCast(cast(), clock.t)).toBe(true);
    expect(h.noteCast(cast({ started_at_ms: T0 + 900 }), clock.t)).toBe(false);
    expect(h.noteCast(cast({ started_at_ms: T0 - 1500 }), clock.t)).toBe(false);
    expect(h.pending().raid_casts).toBe(1);
  });

  it('a real recast (2 s or more later) is a second row; a different spell or target is its own cast', () => {
    const { h, clock } = mk();
    h.noteCast(cast(), clock.t);
    expect(h.noteCast(cast({ started_at_ms: T0 + 2000 }), clock.t + 2000)).toBe(true);
    expect(h.noteCast(cast({ spell: 'Divine Light' }), clock.t)).toBe(true);
    expect(h.noteCast(cast({ target: 'Brackwyn' }), clock.t)).toBe(true);
    expect(h.noteCast(cast({ caster: 'Brackwyn' }), clock.t)).toBe(true);
    expect(h.pending().raid_casts).toBe(5);
  });

  it('writes the cast start, not the arrival time, and the heal amount only when there is one', async () => {
    const { h, sb, clock } = mk();
    h.noteCast(cast({ started_at_ms: T0 - 4000, heal_amount: undefined, target_id: 55 }), clock.t);
    await h.flush();
    expect(sb.inserted[0].rows[0]).toMatchObject({ caster: 'Corvale', spell: 'Complete Heal', target: 'Aldenmar', target_id: 55, cast_secs: 10, heal_amount: null });
    expect(sb.inserted[0].rows[0].cast_at).toBe(new Date(T0 - 4000).toISOString());
  });

  it('a wild agent clock falls back to the arrival time; a cast missing a name is dropped', () => {
    const { h, sb, clock } = mk();
    h.noteCast(cast({ started_at_ms: T0 + 3_600_000 }), clock.t);
    expect(h.noteCast(cast({ spell: '' }), clock.t)).toBe(false);
    expect(h.noteCast(cast({ target: '  ' }), clock.t)).toBe(false);
    return h.flush().then(() => expect(sb.inserted[0].rows[0].cast_at).toBe(new Date(clock.t).toISOString()));
  });
});

describe('4. zone changes: only when the zone changes', () => {
  const live = (over = {}) => ({ guild_id: 'wolfpack', character: 'Aldenmar', zone_id: 10, zone_name: 'Sebilis', updated_at: new Date(T0).toISOString(), ...over });

  it('records the first sight (from NULL), ignores a heartbeat in the same zone, records a move with where from', async () => {
    const { h, sb } = mk();
    expect(h.noteLiveRows([live()])).toBe(1);
    expect(h.noteLiveRows([live({ updated_at: new Date(T0 + 45 * SEC).toISOString() })])).toBe(0);
    expect(h.noteLiveRows([live({ zone_id: 11, zone_name: 'Veeshan' })])).toBe(1);
    await h.flush();
    const rows = sb.inserted[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ zone_id: 10, zone_name: 'Sebilis', from_zone_id: null, from_zone_name: null });
    expect(rows[1]).toMatchObject({ zone_id: 11, zone_name: 'Veeshan', from_zone_id: 10, from_zone_name: 'Sebilis' });
  });

  it('tracks each character separately and ignores a record with no zone at all', () => {
    const { h } = mk();
    expect(h.noteLiveRows([live(), live({ character: 'Brackwyn' }), live({ character: 'Corvale', zone_id: null, zone_name: null })])).toBe(2);
    expect(h.noteLiveRows([live({ character: 'brackwyn' })])).toBe(0);
  });

  it('compares by zone id when it is sent, by name when it is not', () => {
    const { h } = mk();
    h.noteLiveRows([live({ zone_id: null, zone_name: 'Sebilis' })]);
    expect(h.noteLiveRows([live({ zone_id: null, zone_name: 'sebilis' })])).toBe(0);
    expect(h.noteLiveRows([live({ zone_id: null, zone_name: 'Veeshan' })])).toBe(1);
  });

  it('survives garbage', () => {
    const { h } = mk();
    expect(h.noteLiveRows(null)).toBe(0);
    expect(h.noteLiveRows([null, {}, { character: 'Aldenmar' }])).toBe(0);
  });
});

describe('5. pet / charm owner declarations: each new one, once', () => {
  it('writes a declaration once however many raiders upload the same fight', () => {
    const { h, clock } = mk();
    expect(h.notePets({ Gobbo: 'Corvale' }, { gobbo: 777 }, clock.t)).toBe(1);
    expect(h.notePets({ gobbo: 'corvale' }, { gobbo: 777 }, clock.t + 60 * SEC)).toBe(0);
    expect(h.pending().raid_pet_owners).toBe(1);
  });

  it('a new owner for the same pet, or the spawn id arriving later, is a new declaration', async () => {
    const { h, sb, clock } = mk();
    h.notePets({ Gobbo: 'Corvale' }, {}, clock.t);
    expect(h.notePets({ Gobbo: 'Corvale' }, { gobbo: 777 }, clock.t + SEC)).toBe(1);
    expect(h.notePets({ Gobbo: 'Brackwyn' }, {}, clock.t + 2 * SEC)).toBe(1);
    await h.flush();
    expect(sb.inserted[0].rows.map(r => [r.pet, r.owner, r.pet_spawn_id])).toEqual([['Gobbo', 'Corvale', null], ['Gobbo', 'Corvale', 777], ['Gobbo', 'Brackwyn', null]]);
  });

  it('writes it again the next night (names are re-rolled at a re-summon), skips a non-string owner', () => {
    const { h, clock } = mk();
    h.notePets({ Gobbo: 'Corvale' }, {}, clock.t);
    expect(h.notePets({ Gobbo: 'Corvale' }, {}, clock.t + 13 * 60 * 60 * 1000)).toBe(1);
    expect(h.notePets({ Fluffy: ['Corvale'], Rex: '' }, {}, clock.t)).toBe(0);
    expect(h.notePets(null, null)).toBe(0);
  });
});

describe('6. trigger fires', () => {
  const entry = (over = {}) => ({ name: 'Rampage Warning', key: 'Rampage Warning|Aldenmar', captures: { s: 'Aldenmar', deep: { no: 1 } },
    fired_at_true_ms: T0, posted_at_ms: T0 + 500, uploaded_by: '123456789', ...over });

  it('writes the fire the relay accepted, with its true time and flat captures', async () => {
    const { h, sb } = mk();
    expect(h.noteTriggerFire(entry())).toBe(true);
    await h.flush();
    expect(sb.inserted[0].table).toBe('raid_trigger_fires');
    expect(sb.inserted[0].rows[0]).toMatchObject({ trigger_name: 'Rampage Warning', trigger_key: 'Rampage Warning|Aldenmar',
      captures: { s: 'Aldenmar' }, uploaded_by: '123456789', fired_at: new Date(T0).toISOString() });
  });

  it('captures are capped at 8 short values, empty captures are NULL, a nameless fire is dropped', async () => {
    const { h, sb } = mk();
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['k' + i, 'v'.repeat(200)]));
    h.noteTriggerFire(entry({ captures: many }));
    h.noteTriggerFire(entry({ captures: {} }));
    expect(h.noteTriggerFire(entry({ name: '' }))).toBe(false);
    await h.flush();
    const [a, b] = sb.inserted[0].rows;
    expect(Object.keys(a.captures)).toHaveLength(8);
    expect(a.captures.k0).toHaveLength(60);
    expect(b.captures).toBeNull();
  });
});

describe('the writer: batched, bounded, never on the request path', () => {
  it('push() does no I/O: nothing is sent until a flush', () => {
    const { h, sb, clock } = mk();
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'Aldenmar', started_at_ms: T0 }, clock.t);
    expect(sb.inserted).toEqual([]);
  });

  it('flushes each table as ONE minimal insert, 500 rows to a chunk', async () => {
    const { h, sb, clock } = mk();
    for (let i = 0; i < 1100; i++) h.noteCast({ caster: 'Corvale', spell: 'Heal ' + i, target: 'Aldenmar', started_at_ms: T0 }, clock.t);
    h.noteLiveRows([{ guild_id: 'wolfpack', character: 'Aldenmar', zone_id: 1, zone_name: 'A' }]);
    await h.flush();
    const casts = sb.inserted.filter(i => i.table === 'raid_casts');
    expect(casts.map(c => c.rows.length)).toEqual([500, 500, 100]);
    expect(casts.every(c => c.opts && c.opts.minimal === true)).toBe(true);
    expect(sb.inserted.filter(i => i.table === 'raid_zone_changes')).toHaveLength(1);
    expect(h.pending().raid_casts).toBe(0);
  });

  it('a full batch is sent without waiting for the timer', async () => {
    const { h, sb, clock } = mk({ opts: { batchRows: 3 } });
    for (let i = 0; i < 3; i++) h.noteCast({ caster: 'Corvale', spell: 'S' + i, target: 'T', started_at_ms: T0 }, clock.t);
    await new Promise(r => setImmediate(r));
    expect(sb.inserted).toHaveLength(1);
  });

  it('the buffer is bounded: the oldest rows go, and it says so ONCE, on stdout', () => {
    const { h, log, clock } = mk({ opts: { maxBuffer: 50, batchRows: 1000 } });
    for (let i = 0; i < 200; i++) h.noteCast({ caster: 'Corvale', spell: 'S' + i, target: 'T', started_at_ms: T0 }, clock.t);
    expect(h.pending().raid_casts).toBeLessThanOrEqual(50);
    expect(h.stats.dropped).toBeGreaterThan(0);
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.log.mock.calls[0][0]).toMatch(/raid_casts.*dropping the oldest/);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('a failed write keeps the rows and retries after a pause; a success clears them', async () => {
    const { h, sb, clock } = mk();
    sb.failInserts = 1;
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t);
    await h.flush();
    expect(h.pending().raid_casts).toBe(1);
    await h.flush();                                   // inside the pause: not retried yet
    expect(sb.inserted).toEqual([]);
    clock.t += 6 * SEC;
    await h.flush();
    expect(sb.inserted).toHaveLength(1);
    expect(h.pending().raid_casts).toBe(0);
  });

  it('a batch that keeps failing is dropped after 3 tries (logged once on stdout), so it cannot wedge the table', async () => {
    const { h, sb, log, clock } = mk();
    sb.failInserts = 99;
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t);
    for (let i = 0; i < 3; i++) { await h.flush(); clock.t += 11 * 60 * 1000; }
    expect(h.pending().raid_casts).toBe(0);
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.log.mock.calls[0][0]).toMatch(/dropped 1 rows/);
    expect(log.warn).not.toHaveBeenCalled();
    // …and a later row still gets its turn.
    sb.failInserts = 0;
    h.noteCast({ caster: 'Corvale', spell: 'Heal 2', target: 'T', started_at_ms: T0 }, clock.t);
    await h.flush();
    expect(sb.inserted).toHaveLength(1);
  });

  it('honours the Supabase breaker: nothing is sent while it is open, and the rows wait', async () => {
    const { h, sb, clock } = mk();
    sb.open = true;
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t);
    await h.flush();
    expect(sb.inserted).toEqual([]);
    expect(h.pending().raid_casts).toBe(1);
    sb.open = false;
    await h.flush();
    expect(sb.inserted).toHaveLength(1);
  });

  it('records nothing when Supabase is not configured', async () => {
    const { h, sb, clock } = mk();
    sb.enabled = false;
    expect(h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t)).toBe(false);
    expect(h.pending().raid_casts).toBe(0);
  });

  it('a throwing client never reaches the caller', async () => {
    const { h, clock } = mk({ sb: fakeSb({ async insert() { throw new Error('boom'); } }) });
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t);
    await expect(h.flush()).resolves.toBeUndefined();
  });
});

describe('shed flags: flag_shed_hist_<stream> stops the saving', () => {
  const tune = (map) => ({ tuning: async () => map });

  it('a shed stream records nothing and the others carry on', async () => {
    const { h, sb, clock } = mk({ opts: tune({ flag_shed_hist_casts: 1 }) });
    await h.refreshShed(true);
    expect(h.isShed('casts')).toBe(true);
    expect(h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t)).toBe(false);
    expect(h.noteLiveRows([{ guild_id: 'wolfpack', character: 'Aldenmar', zone_id: 1, zone_name: 'A' }])).toBe(1);
    await h.flush();
    expect(sb.inserted.map(i => i.table)).toEqual(['raid_zone_changes']);
  });

  it('every stream has its own flag, and 0 / unset is not shed', async () => {
    for (const [key, s] of Object.entries(rh.STREAMS)) {
      const on = mk({ opts: tune({ ['flag_shed_' + s.shed]: 1 }) });
      await on.h.refreshShed(true);
      expect(on.h.isShed(key)).toBe(true);
      const off = mk({ opts: tune({ ['flag_shed_' + s.shed]: 0 }) });
      await off.h.refreshShed(true);
      expect(off.h.isShed(key)).toBe(false);
    }
  });

  it('shedding after rows were buffered clears them at the next flush instead of writing them', async () => {
    const map = {};
    const { h, sb, clock } = mk({ opts: tune(map) });
    h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t);
    map.flag_shed_hist_casts = 1;
    await h.flush();
    expect(sb.inserted).toEqual([]);
    expect(h.pending().raid_casts).toBe(0);
  });

  it('lifting the flag resumes saving (a shed observation was not remembered as saved)', async () => {
    const map = { flag_shed_hist_mob_hp: 1 };
    const { h, clock } = mk({ opts: tune(map) });
    await h.refreshShed(true);
    expect(h.noteMobHp({ zone: 'Z', spawn_id: 1, name: 'a mob', hp: 100 }, clock.t)).toBe(false);
    map.flag_shed_hist_mob_hp = 0;
    await h.refreshShed(true);
    expect(h.noteMobHp({ zone: 'Z', spawn_id: 1, name: 'a mob', hp: 100 }, clock.t)).toBe(true);
  });

  it('fails open: an unreadable tuning map never sheds', async () => {
    const { h, clock } = mk({ opts: { tuning: async () => { throw new Error('no tuning'); } } });
    await h.refreshShed(true);
    expect(h.noteCast({ caster: 'Corvale', spell: 'Heal', target: 'T', started_at_ms: T0 }, clock.t)).toBe(true);
  });

  it('index.js lists exactly these kinds as sheddable, so the flag-override whitelist carries them', () => {
    const block = sliceBlock(SRC, 'const _SHED_KINDS = new Set([', ']);');
    const { _SHED_KINDS } = evalBlock(block, ['_SHED_KINDS']);
    for (const k of rh.SHED_KINDS) expect(_SHED_KINDS.has(k), k).toBe(true);
    expect(rh.SHED_KINDS).toEqual(Object.values(rh.STREAMS).map(s => s.shed));
    expect(rh.SHED_KINDS).toHaveLength(6);
  });
});

describe('retention: 60 days, by the indexed time column, in bounded slices', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const seed = (sb, fn) => { for (const s of Object.values(rh.STREAMS)) sb.tables[s.table] = fn(s); };

  it('deletes by each table\'s own time column with an lt. bound, never past the cutoff, and keeps recent rows', async () => {
    const sb = fakeSb();
    seed(sb, (s) => [70, 65, 61, 59, 10, 1].map(d => ({ [s.timeCol]: new Date(T0 - d * DAY).toISOString() })));
    const { h } = mk({ sb });
    const r = await h.pruneAll({ keepDays: 60 });
    for (const s of Object.values(rh.STREAMS)) {
      const mine = sb.dels.filter(d => d.table === s.table);
      expect(mine.length).toBeGreaterThan(0);
      for (const d of mine) {
        expect(d.q.startsWith(`${s.timeCol}=lt.`)).toBe(true);
        expect(Date.parse(decodeURIComponent(d.q.split('lt.')[1]))).toBeLessThanOrEqual(T0 - 60 * DAY);
      }
      expect(sb.tables[s.table]).toHaveLength(3);          // 59, 10 and 1 days old stay
      expect(r.stopped[s.table]).toBe('done');
    }
  });

  it('works in slices: one DELETE never spans more than the slice, and a sweep that cannot finish stops at the cap', async () => {
    const sb = fakeSb();
    seed(sb, (s) => Array.from({ length: 40 }, (_, i) => ({ [s.timeCol]: new Date(T0 - (100 - i) * DAY).toISOString() })));   // 100 → 61 days old
    const { h } = mk({ sb });
    const r = await h.pruneAll({ keepDays: 60, sliceMs: 6 * 60 * 60 * 1000, maxSlices: 3 });
    for (const s of Object.values(rh.STREAMS)) {
      const mine = sb.dels.filter(d => d.table === s.table);
      expect(mine).toHaveLength(3);
      for (const d of mine) {
        const hi = Date.parse(decodeURIComponent(d.q.split('lt.')[1]));
        expect(hi - d.oldest).toBeLessThanOrEqual(6 * 60 * 60 * 1000);   // one slice from the oldest row, never the whole backlog
        expect(hi).toBeGreaterThan(d.oldest);
      }
      expect(r.stopped[s.table]).toBe('slices');
      expect(sb.tables[s.table].length).toBeGreaterThan(30);   // most of the backlog waits for tomorrow
    }
  });

  it('a delete that removes nothing ends that table\'s sweep instead of looping', async () => {
    const sb = fakeSb({ noDelete: true });
    seed(sb, (s) => [{ [s.timeCol]: new Date(T0 - 90 * DAY).toISOString() }]);
    const { h } = mk({ sb });
    const r = await h.pruneAll({ keepDays: 60 });
    for (const s of Object.values(rh.STREAMS)) {
      expect(sb.dels.filter(d => d.table === s.table)).toHaveLength(1);
      expect(r.stopped[s.table]).toBe('stalled');
    }
  });

  it('an empty table, retention 0 and a disabled Supabase delete nothing', async () => {
    const sb = fakeSb();
    const { h } = mk({ sb });
    await h.pruneAll({ keepDays: 60 });
    await h.pruneAll({ keepDays: 0 });
    sb.enabled = false;
    await h.pruneAll({ keepDays: 60 });
    expect(sb.dels).toEqual([]);
  });

  it('the midnight chain calls it with RAID_HISTORY_RETENTION_DAYS (default the module\'s 60), inside its own try', () => {
    const code = stripJs(SRC);
    expect(rh.RETENTION_DAYS).toBe(60);
    expect(code).toMatch(/RAID_HISTORY_RETENTION_DAYS[\s\S]{0,200}_raidHistoryMod\.RETENTION_DAYS[\s\S]{0,400}_raidHistory\(\)\.pruneAll\(\{ keepDays: keep \}\)/);
  });
});

describe('the migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261029121500_raid_history_streams.sql'), 'utf8'));

  it.each(Object.values(rh.STREAMS).map(s => [s.table, s.timeCol]))('%s: guild_id, a time column that LEADS an index, RLS on, no policy', (table, timeCol) => {
    const m = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    expect(m, table).toBeTruthy();
    expect(m[1]).toMatch(/guild_id\s+text\s+not null default 'wolfpack'/);
    expect(m[1]).toMatch(new RegExp(`\\b${timeCol}\\s+timestamptz not null`));
    expect(m[1]).toMatch(/id\s+bigint generated by default as identity primary key/);   // the archive merge needs a primary key
    expect(sql).toMatch(new RegExp(`create index if not exists \\w+ on public\\.${table} \\(${timeCol}\\);`));
    expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security;`));
  });

  it('adds no policy and no grant (service role only), and nothing is created non-idempotently', () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql.match(/create (table|index)/gi).length).toBe(sql.match(/create (table|index) if not exists/gi).length);
  });

  it('has a version no other migration shares, and the six tables are in the guild-table registry', () => {
    const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations'));
    const versions = files.map(f => f.split('_')[0]);
    expect(versions.filter(v => v === '20261029121500')).toHaveLength(1);
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/guild-tables.json'), 'utf8')).tables;
    for (const s of Object.values(rh.STREAMS)) expect(reg).toContain(s.table);
  });
});

describe('wiring in index.js', () => {
  const code = stripJs(SRC);

  it('raidTargets feeds sightings, and the live-state, casting, trigger-relay and pet handlers feed the rest', () => {
    expect(code).toMatch(/_raidTargetsMod\.create\(\{[^}]*onSample: \(s, at\) => _raidHistory\(\)\.noteSighting\(s, at\)/);
    expect(code).toMatch(/_raidHistory\(\)\.noteLiveRows\(rows\)/);
    expect(code).toMatch(/_raidHistory\(\)\.noteCast\(\{ caster, spell, target/);
    expect(code).toMatch(/_triggerRelay\.entries\.push\(entry\);\s*_raidHistory\(\)\.noteTriggerFire\(entry\)/);
    expect(code).toMatch(/addPetSpawnIds\(petIds\);\s*_raidHistory\(\)\.notePets\(uploadedPetLeaders, petIds\)/);
  });

  it('mob HP is noted for fresh rows with an identity and for a death, from the Extended Target poll', () => {
    expect(code).toMatch(/if \(t\.hp_pct == null \|\| \(t\.ambiguous && t\.spawn_id == null\)\) continue;\s*_raidHistory\(\)\.noteMobHp\(/);
    expect(code).toMatch(/mobHp <= 0\) \{[\s\S]{0,400}_raidHistory\(\)\.noteMobHp\(\{[^}]*hp: 0 \}\)/);
  });

  it('the buffered rows are flushed on SIGTERM', () => {
    expect(code).toMatch(/_gracefulShutdown[\s\S]*_raidHistory\(\)\.flush\(\)/);
  });

  it('the bot version and its changelog moved together', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    expect(fs.readFileSync(path.join(ROOT, 'utils/onboarding.js'), 'utf8')).toContain(`'${v}': [`);
  });
});

describe('utils/supabase insert(): minimal mode', () => {
  const sbReal = requireBot('./utils/supabase');
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  afterEach(() => {
    process.env.SUPABASE_URL = saved.url; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key; globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    sbReal._resetBreaker();
  });
  beforeEach(() => { process.env.SUPABASE_URL = 'http://sb.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

  it('asks for return=minimal and resolves true on success, null on failure; the default is unchanged', async () => {
    const seen = [];
    globalThis.fetch = async (url, init) => { seen.push(init.headers.Prefer); return { ok: true, status: 201, text: async () => '' }; };
    expect(await sbReal.insert('raid_casts', [{ a: 1 }], { minimal: true })).toBe(true);
    expect(seen[0]).toBe('return=minimal');
    await sbReal.insert('raid_casts', [{ a: 1 }]);
    expect(seen[1]).toBe('return=representation');
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '{"code":"42P01"}' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sbReal.insert('raid_casts', [{ a: 1 }], { minimal: true })).toBeNull();
    warn.mockRestore();
  });
});
