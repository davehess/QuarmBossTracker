// test/replay-window.test.js — GET /api/agent/replay-window, the recorded raid window for the agent's Rehearse tab.
//
// The module (utils/raidReplayWindow.js) runs for real against an in-memory stand-in for the supabase client; the
// website's own anonLabels / scrubMinuteData are imported and the port is held to them on the same inputs; the
// route handler, the shed gate and the budget table are sliced out of the real index.js and run.
// Source assertions are made on comment-stripped text (stripJs).
//
// Names in fixtures are invented (Aldenmar, Brackwyn, Corvale ...).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import * as web from '../web/lib/raidSession.ts';

const require_ = createRequire(import.meta.url);
const rw = require_('../utils/raidReplayWindow.js');

const T0 = Date.parse('2026-10-18T01:00:00Z');   // a minute boundary
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

// A raid_track_minutes `data` blob (utils/raidTrack.js format).
const blob = (who, extra = {}) => JSON.stringify({
  v: 1, step_s: 3, who, zones: ['potranquility'],
  f: [[0, ...who.flatMap((_, i) => [i, 10 * i, 20 * i, 3, 128, 90, 0])]],
  ...extra,
});
const WHO = [
  ['Aldenmar', 'Cleric', 1, 60],
  ['Brackwyn', 'Cleric', 1, 60],
  ['Corvale', 'Warrior', 2, 60],
  ['Brackwyn`s pet', null, null, 0],
  ['Dunmere', 'Cleric', 3, 60],
];
const CHARS = [
  { name: 'Aldenmar', class: 'Cleric', exclude_from_stats: false, exclude_inventory: true },   // inventory-only opt-out
  { name: 'Brackwyn', class: 'Cleric', exclude_from_stats: true, exclude_inventory: false },
  { name: 'Corvale', class: 'Warrior', exclude_from_stats: false, exclude_inventory: false },
  { name: 'Dunmere', class: 'Cleric', exclude_from_stats: false, exclude_inventory: false },
];

// ── an in-memory supabase: select / selectAllPaged over per-table row lists, honouring eq/gte/lt/is.null/in ──
function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(k)) continue;
    const m = /^(eq|gte|lt|is|in|not)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, arg] = m;
    const cell = row[k];
    if (op === 'eq') { if (String(cell) !== arg) return false; }
    else if (op === 'gte') { if (!(Date.parse(cell) >= Date.parse(arg))) return false; }
    else if (op === 'lt') { if (!(Date.parse(cell) < Date.parse(arg))) return false; }
    else if (op === 'is') { if (arg === 'null' && cell != null) return false; }
    else if (op === 'not') { if (arg === 'is.null' && cell == null) return false; }
    else if (op === 'in') { if (!arg.slice(1, -1).split(',').includes(String(cell))) return false; }
  }
  return true;
}
function fakeSupabase(tables) {
  const log = [];
  const run = (table, qs) => {
    log.push({ table, qs });
    if (tables.__fail?.includes(table)) return null;
    const params = [...new URLSearchParams(qs)];
    let rows = (tables[table] || []).filter(r => matches(r, params));
    const lim = Number(new URLSearchParams(qs).get('limit'));
    if (lim) rows = rows.slice(0, lim);
    return rows.map(r => ({ ...r }));
  };
  return {
    log, isEnabled: () => true, guildId: () => 'wolfpack',
    async select(table, qs) { return run(table, qs); },
    async selectAllPaged(table, base) {
      if (table === 'characters') {
        const rows = run(table, base);
        return rows && rows.filter(r => r.exclude_from_stats || r.exclude_inventory);
      }
      return run(table, base);
    },
  };
}

function world(over = {}) {
  const guild_id = 'wolfpack';
  return {
    characters: CHARS.map(c => ({ guild_id, ...c })),
    raid_track_minutes: [0, 1, 2].map(i => ({
      guild_id, minute_at: iso(T0 + i * MIN), zones: ['potranquility'],
      data: blob(WHO, { mobs: [['a lava elemental', 1234]], mf: [[0, 0, 5, 5, 0, 3, 0]] }),
    })),
    encounters: [
      { id: 11, guild_id, npc_id: 100, started_at: iso(T0 + 30_000), ended_at: iso(T0 + 90_000), duration_sec: 60, zone_short: 'potranquility', classification: null, eqemu_npc_types: { name: 'Lord_Aldwyn' } },
      { id: 12, guild_id, npc_id: 200, started_at: iso(T0 + 30_000), ended_at: iso(T0 + 95_000), duration_sec: 65, zone_short: 'potranquility', classification: null, eqemu_npc_types: { name: 'a_sewer_rat' } },
      { id: 13, guild_id, npc_id: 100, started_at: iso(T0), ended_at: iso(T0 + 100_000), duration_sec: 100, zone_short: 'potranquility', classification: 'trash', eqemu_npc_types: { name: 'Lord_Aldwyn' } },
      { id: 14, guild_id, npc_id: 100, started_at: iso(T0 - 600_000), ended_at: iso(T0 - 500_000), duration_sec: 100, zone_short: 'potranquility', classification: null, eqemu_npc_types: { name: 'Lord_Aldwyn' } },
    ],
    bosses_local: [{ npc_id: 100, auto_registered: false }, { npc_id: 200, auto_registered: true }],
    trigger_timing_feedback: [
      // one callout seen by three people (their fired_at differ by clock skew), plus a vote and a dismissal by one of them
      { id: 1, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 10_000), voter_discord_id: 'u-1', voter_character: 'Aldenmar' },
      { id: 2, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 11_000), voter_discord_id: 'u-2', voter_character: 'Brackwyn' },
      { id: 3, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 12_500), voter_discord_id: 'u-3', voter_character: 'Corvale' },
      { id: 4, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 12_600), voter_discord_id: 'u-1', voter_character: 'Aldenmar' },
      // a second callout of the same trigger, well apart
      { id: 5, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 60_000), voter_discord_id: 'u-1' },
      { id: 6, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 60_500), voter_discord_id: 'u-2' },
      // seen by one person only: dropped
      { id: 7, guild_id, trigger_name: 'My Private Trigger', fired_at: iso(T0 + 20_000), voter_discord_id: 'u-1' },
      // outside the window
      { id: 8, guild_id, trigger_name: 'Gravel Rain', fired_at: iso(T0 + 3 * 3600_000), voter_discord_id: 'u-1' },
    ],
    target_observations: [
      { id: 1, guild_id, character: 'Aldenmar', target_name: 'a lava elemental', target_hp_pct: 80, at: iso(T0 + 5_000) },
      { id: 2, guild_id, character: 'Corvale', target_name: 'a lava elemental', target_hp_pct: 79, at: iso(T0 + 5_500) },
      { id: 3, guild_id, character: 'Corvale', target_name: 'Dunmere', target_hp_pct: 100, at: iso(T0 + 6_000) },   // a player: not a mob of the window
      { id: 4, guild_id, character: 'Corvale', target_name: 'a lava elemental', target_hp_pct: 40, at: iso(T0 + 30_000) },
    ],
    ...over,
  };
}

const QUERY_FROM = iso(T0), QUERY_TO = iso(T0 + 15 * MIN);
async function get(sb, o = {}, now = T0 + 6 * 3600_000) {
  const r = await rw.serve(sb, o.from ?? QUERY_FROM, o.to ?? QUERY_TO, !!o.index, now);
  return r.status === 200 ? { status: 200, json: JSON.parse(r.entry.body), text: r.entry.body, entry: r.entry } : r;
}

beforeEach(() => {
  rw._reset();
  process.env.DEMO_OBFUSCATE_SALT = 'test-salt';
  delete process.env.SUPABASE_GUILD_ID;
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.DEMO_OBFUSCATE_SALT; });

// ── 1. The port is the website's scrub ─────────────────────────────────────────
describe('scrub parity with web/lib/raidSession.ts', () => {
  const rowSets = [
    CHARS,
    [],
    [{ name: 'Zarrin', class: null, exclude_from_stats: true }, { name: 'Nyssara', class: '  ', exclude_inventory: true }, { name: 'Rethlan', class: 'Druid', exclude_inventory: true }],
    [...CHARS, { name: 'aldenmar', class: 'Cleric', exclude_from_stats: true }],   // a duplicate by case
  ];
  for (const salt of ['', 'test-salt', 'another']) {
    it(`labels, names and blobs agree (salt "${salt}")`, () => {
      for (const rows of rowSets) {
        const a = rw.anonLabels(rows, salt), b = web.anonLabels(rows, salt);
        expect([...a]).toEqual([...b]);
        expect(rw.anonSig(a)).toBe(web.anonSig(b));
        for (const n of ['Aldenmar', 'Brackwyn`s pet', 'brackwyn`S Warder', 'Corvale', '', 'Nobody']) {
          expect(rw.anonName(a, n)).toBe(web.anonName(b, n));
        }
        for (const data of [blob(WHO), blob(WHO, { mobs: [['a rat', null]] }), 'not json', '[]', '{"who":1,"f":[]}', JSON.stringify({ who: [[5]], f: [] })]) {
          expect(rw.scrubMinuteData(data, a)).toBe(web.scrubMinuteData(data, b));
        }
      }
    });
  }
  it('opaqueKey and nameKey are the same functions', () => {
    for (const s of ['aldenmar', 'x', 'Brackwyn`s pet']) {
      expect(rw.opaqueKey('s', s)).toBe(web.opaqueKey('s', s));
      expect(rw.nameKey(s)).toBe(web.nameKey(s));
    }
  });
  it('a labelled raider is "<Class> <n>", numbered within the class, never by name', () => {
    const m = rw.anonLabels(CHARS, 'test-salt');
    expect(m.get('aldenmar').label).toMatch(/^Cleric [12]$/);
    expect(m.get('brackwyn').label).toMatch(/^Cleric [12]$/);
    expect(m.get('aldenmar').label).not.toBe(m.get('brackwyn').label);
    expect(m.has('corvale')).toBe(false);
  });
});

// ── 2. The window ──────────────────────────────────────────────────────────────
describe('makeWindow', () => {
  it('snaps from DOWN and to UP to the minute', () => {
    expect(rw.makeWindow(T0 + 20_000, T0 + 2 * MIN + 1)).toEqual({ fromMs: T0, toMs: T0 + 3 * MIN });
  });
  it('caps a slice at 15 minutes from `from`', () => {
    expect(rw.makeWindow(T0, T0 + 60 * MIN)).toEqual({ fromMs: T0, toMs: T0 + 15 * MIN });
  });
  it('rejects empty, reversed and unparseable windows', () => {
    expect(rw.makeWindow(T0, T0)).toBe(null);
    expect(rw.makeWindow(T0 + MIN, T0)).toBe(null);
    expect(rw.makeWindow(NaN, T0)).toBe(null);
    expect(rw.makeWindow(T0, NaN)).toBe(null);
  });
  it('an index may span up to 24 hours and no more', () => {
    expect(rw.makeWindow(T0, T0 + 24 * 60 * MIN, true)).toEqual({ fromMs: T0, toMs: T0 + 24 * 60 * MIN });
    expect(rw.makeWindow(T0, T0 + 24 * 60 * MIN + 1, true)).toBe(null);
  });
  it('serve: a 3-hour request returns 15 minutes of rows; a bad window is a 400 and reads nothing', async () => {
    const sb = fakeSupabase(world());
    const ok = await get(sb, { to: iso(T0 + 3 * 3600_000) });
    expect(ok.json.to - ok.json.from).toBe(15 * MIN);
    const q = sb.log.find(l => l.table === 'raid_track_minutes').qs;
    expect(q).toContain(encodeURIComponent(iso(T0 + 15 * MIN)));
    const sb2 = fakeSupabase(world());
    expect((await get(sb2, { from: 'nope' })).status).toBe(400);
    expect((await get(sb2, { to: QUERY_FROM })).status).toBe(400);
    expect(sb2.log).toEqual([]);
  });
  it('serve: sub-minute edges are snapped before the read', async () => {
    const sb = fakeSupabase(world());
    const r = await get(sb, { from: iso(T0 + 20_000), to: iso(T0 + 2 * MIN + 5_000) });
    expect(r.json.from).toBe(T0);
    expect(r.json.to).toBe(T0 + 3 * MIN);
    expect(r.json.rows.map(x => Date.parse(x.minute_at))).toEqual([T0, T0 + MIN, T0 + 2 * MIN]);
  });
});

// ── 3. The payload ─────────────────────────────────────────────────────────────
describe('the slice payload', () => {
  it('raw compact rows, opted-out raiders as class labels, everyone else by name', async () => {
    const r = await get(fakeSupabase(world()));
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.rows).toHaveLength(3);
    expect(Object.keys(r.json.rows[0]).sort()).toEqual(['data', 'minute_at', 'zones']);
    const who = JSON.parse(r.json.rows[0].data).who.map(w => w[0]);
    expect(who).toContain('Corvale');
    expect(who).toContain('Dunmere');
    // the two opted-out names (one by exclude_from_stats, one by exclude_inventory only), and the pet of one of them
    for (const hidden of ['Aldenmar', 'Brackwyn']) expect(r.text).not.toContain(hidden);
    expect(who.filter(n => /^Cleric \d$/.test(n))).toHaveLength(2);
    expect(who.some(n => /^Cleric \d`s pet$/.test(n))).toBe(true);
    // rows are otherwise intact (positions, mobs)
    const d = JSON.parse(r.json.rows[0].data);
    expect(d.f).toHaveLength(1);
    expect(d.mobs).toEqual([['a lava elemental', 1234]]);
  });
  it('matches the website byte for byte on the same inputs', async () => {
    const w = world();
    const r = await get(fakeSupabase(w));
    const labels = web.anonLabels(CHARS, 'test-salt');
    r.json.rows.forEach((row, i) => expect(row.data).toBe(web.scrubMinuteData(w.raid_track_minutes[i].data, labels)));
  });
  it('there is NO winner exemption: a bid winner who opted out is still a label, and no loot or bid table is read', async () => {
    const w = world({ loot_observations: [{ guild_id: 'wolfpack', item_name: 'x', winner_character: 'Brackwyn', posted_at: iso(T0 + 10_000) }] });
    const sb = fakeSupabase(w);
    const r = await get(sb);
    expect(r.text).not.toContain('Brackwyn');
    expect(sb.log.map(l => l.table).filter(t => /loot|bid|opendkp|roll/.test(t))).toEqual([]);
  });
  it('kills: only encounters that ENDED in the window, unclassified, of a curated boss', async () => {
    const r = await get(fakeSupabase(world()));
    expect(r.json.kills).toEqual([{
      id: 11, npcId: 100, name: 'Lord Aldwyn', zone: 'potranquility', startMs: T0 + 30_000, endMs: T0 + 90_000, durationSec: 60,
    }]);
  });
  it('callouts: grouped within 3 s per trigger, counts only, no voter, no character', async () => {
    const r = await get(fakeSupabase(world()));
    expect(r.json.callouts).toEqual([
      { atMs: T0 + 11_000, trigger: 'Gravel Rain', seenBy: 3 },
      { atMs: T0 + 60_000, trigger: 'Gravel Rain', seenBy: 2 },
    ]);
    for (const c of r.json.callouts) expect(Object.keys(c).sort()).toEqual(['atMs', 'seenBy', 'trigger']);
    expect(r.text).not.toMatch(/u-[123]/);
    expect(r.text).not.toContain('voter');
    expect(r.text).not.toContain('My Private Trigger');   // seen by one person
    // the feedback read never asks for a character or a note
    rw._reset();
    const sb = fakeSupabase(world());
    await get(sb);
    const q = sb.log.find(l => l.table === 'trigger_timing_feedback').qs;
    expect(q).not.toMatch(/voter_character|note/);
  });
  it('targets: mob health only, for mobs in the window\'s own lists, with no character', async () => {
    const r = await get(fakeSupabase(world()));
    expect(r.json.targets).toEqual([
      { atMs: T0 + 5_500, name: 'a lava elemental', hp: 79 },
      { atMs: T0 + 30_000, name: 'a lava elemental', hp: 40 },
    ]);
    expect(r.text).not.toContain('Dunmere\"');   // the player target is not in `targets`
    expect(JSON.stringify(r.json.targets)).not.toMatch(/Corvale|Aldenmar|character/);
  });
  it('targets are omitted (not empty) when no observation exists or the rows name no mob', async () => {
    const none = await get(fakeSupabase(world({ target_observations: [] })));
    expect('targets' in none.json).toBe(false);
    const w = world();
    w.raid_track_minutes = w.raid_track_minutes.map(m => ({ ...m, data: blob(WHO) }));
    const noMobs = await get(fakeSupabase(w));
    expect('targets' in noMobs.json).toBe(false);
  });
  it('a failed callout read still serves the slice (callouts empty); a failed minute read is a 503', async () => {
    const w = world(); w.__fail = ['trigger_timing_feedback'];
    const r = await get(fakeSupabase(w));
    expect(r.status).toBe(200);
    expect(r.json.callouts).toEqual([]);
    rw._reset();
    const w2 = world(); w2.__fail = ['raid_track_minutes'];
    expect((await get(fakeSupabase(w2))).status).toBe(503);
  });
  it('index=1: minute presence and the curated kills only', async () => {
    const r = await get(fakeSupabase(world()), { index: true, to: iso(T0 + 3 * 3600_000) });
    expect(Object.keys(r.json).sort()).toEqual(['from', 'kills', 'minutes', 'ok', 'to']);
    expect(r.json.minutes).toEqual([T0, T0 + MIN, T0 + 2 * MIN]);
    expect(r.json.kills.map(k => k.id)).toEqual([11]);
    expect(r.text).not.toMatch(/Aldenmar|Brackwyn|Corvale|Dunmere|"data"/);
  });
  it('the 15-minute slice size, for the record: a 56-raider minute is ~30 KB, so a full slice is ~450 KB raw', () => {
    expect(rw.REPLAY_WINDOW_MS).toBe(15 * MIN);
  });
});

// ── 4. Fail closed ─────────────────────────────────────────────────────────────
describe('privacy fail-closed', () => {
  it('an unreadable opt-out list is a 503 and no minute row is read', async () => {
    const w = world(); w.__fail = ['characters'];
    const sb = fakeSupabase(w);
    const r = await get(sb);
    expect(r.status).toBe(503);
    expect(sb.log.map(l => l.table)).toEqual(['characters']);
  });
  it('DEMO_OBFUSCATE_SALT unset: everyone opted out is still labelled, and one warning is logged once', async () => {
    delete process.env.DEMO_OBFUSCATE_SALT;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await get(fakeSupabase(world()));
    expect(r.status).toBe(200);
    for (const hidden of ['Aldenmar', 'Brackwyn']) expect(r.text).not.toContain(hidden);
    await get(fakeSupabase(world()), { from: iso(T0 + MIN) }, T0 + 6 * 3600_000 + 120_000);   // labels re-read: still one warning
    const calls = warn.mock.calls.filter(c => /DEMO_OBFUSCATE_SALT/.test(String(c[0])));
    expect(calls.length).toBe(1);
  });
  it('an unparseable blob is never passed through', async () => {
    const w = world(); w.raid_track_minutes[0].data = 'Aldenmar is not json';
    const r = await get(fakeSupabase(w));
    expect(r.json.rows[0].data).toBe('{}');
    expect(r.text).not.toContain('Aldenmar');
  });
  it('with nobody opted out the blobs go through untouched', async () => {
    const w = world(); w.characters = [{ guild_id: 'wolfpack', name: 'Corvale', class: 'Warrior' }];
    const r = await get(fakeSupabase(w));
    expect(r.json.rows[0].data).toBe(w.raid_track_minutes[0].data);
  });
});

// ── 5. Cache ───────────────────────────────────────────────────────────────────
describe('cache', () => {
  const reads = (sb) => sb.log.filter(l => l.table === 'raid_track_minutes').length;
  it('a finished slice is held 10 minutes', async () => {
    const sb = fakeSupabase(world());
    const now = T0 + 6 * 3600_000;
    await get(sb, {}, now);
    await get(sb, {}, now + 9 * MIN);
    expect(reads(sb)).toBe(1);
    await get(sb, {}, now + 10 * MIN + 1);
    expect(reads(sb)).toBe(2);
  });
  it('a slice touching the last 2 minutes is held 15 seconds', async () => {
    const sb = fakeSupabase(world());
    const now = T0 + 10 * MIN;   // the slice [T0, T0+15m) still runs
    await get(sb, {}, now);
    await get(sb, {}, now + 14_000);
    expect(reads(sb)).toBe(1);
    await get(sb, {}, now + 15_001);
    expect(reads(sb)).toBe(2);
  });
  it('a slice that ended exactly 3 minutes ago is finished', async () => {
    const sb = fakeSupabase(world());
    const now = T0 + 15 * MIN + 3 * MIN;
    await get(sb, {}, now);
    await get(sb, {}, now + 60_000);
    expect(reads(sb)).toBe(1);
  });
  it('is an LRU of 16', async () => {
    const sb = fakeSupabase(world());
    const now = T0 + 6 * 3600_000;
    for (let i = 0; i < 17; i++) await get(sb, { from: iso(T0 + i * MIN), to: iso(T0 + (i + 1) * MIN) }, now);
    expect(reads(sb)).toBe(17);
    await get(sb, { from: iso(T0 + 16 * MIN), to: iso(T0 + 17 * MIN) }, now);   // newest: held
    expect(reads(sb)).toBe(17);
    await get(sb, { from: iso(T0), to: iso(T0 + MIN) }, now);                    // oldest: evicted
    expect(reads(sb)).toBe(18);
  });
  it('an opt-out reaches a cached slice within the minute the labels are held, not the ten', async () => {
    const w = world();
    const sb = fakeSupabase(w);
    const now = T0 + 6 * 3600_000;
    const a = await get(sb, {}, now);
    expect(a.text).toContain('Dunmere');
    w.characters.find(c => c.name === 'Dunmere').exclude_from_stats = true;
    const b = await get(sb, {}, now + 30_000);       // labels still held
    expect(b.text).toContain('Dunmere');
    const c = await get(sb, {}, now + 61_000);       // labels re-read: the cached slice is rebuilt
    expect(c.text).not.toContain('Dunmere');
  });
  it('concurrent identical requests build once', async () => {
    const sb = fakeSupabase(world());
    await Promise.all([get(sb), get(sb), get(sb)]);
    expect(reads(sb)).toBe(1);
  });
  it('gzipOf round-trips the body', async () => {
    const r = await get(fakeSupabase(world()));
    expect(zlib.gunzipSync(rw.gzipOf(r.entry)).toString('utf8')).toBe(r.text);
  });
});

// ── 6. The route in index.js ───────────────────────────────────────────────────
describe('the HTTP route (real index.js)', () => {
  const src = readSource(BOT_INDEX);
  const code = stripJs(src);
  const block = sliceBlock(src, 'async function _handleAgentReplayWindowGet(', '// GET /api/agent/guild-chat');
  function build({ identity, sb }) {
    const calls = { auth: 0 };
    const mimicLink = { requireAgentAuth: async (req, res) => { calls.auth++; if (!identity) { res.code = 401; res.json = { error: 'unauthorized' }; } return identity; } };
    const _ptsJson = (res, code_, obj) => { res.code = code_; res.json = obj; };
    const req_ = (p) => (p === './utils/supabase' ? sb : p === './utils/raidReplayWindow' ? rw : null);
    const handler = new Function('mimicLink', '_ptsJson', 'require', 'URL',
      block + '\nreturn _handleAgentReplayWindowGet;')(mimicLink, _ptsJson, req_, URL);
    return { handler, calls };
  }
  const resOf = () => ({ headers: null, writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b; } });
  const reqOf = (qs, headers = {}) => ({ url: '/api/agent/replay-window?' + qs, headers });

  it('refuses a caller without a member token: nothing is read', async () => {
    const sb = fakeSupabase(world());
    const { handler, calls } = build({ identity: null, sb });
    const res = resOf();
    await handler(reqOf(`from=${iso(T0)}&to=${iso(T0 + MIN)}`), res);
    expect(calls.auth).toBe(1);
    expect(res.code).toBe(401);
    expect(sb.log).toEqual([]);
  });
  it('serves JSON to a member, gzip when asked', async () => {
    const sb = fakeSupabase(world());
    const { handler } = build({ identity: { discord_id: 'u-9' }, sb });
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0 + 6 * 3600_000);
    const plain = resOf();
    await handler(reqOf(`from=${iso(T0)}&to=${iso(T0 + 15 * MIN)}`), plain);
    expect(plain.code).toBe(200);
    expect(plain.headers['Content-Type']).toBe('application/json');
    expect(plain.headers['Content-Encoding']).toBeUndefined();
    expect(JSON.parse(plain.body).rows).toHaveLength(3);
    const gz = resOf();
    await handler(reqOf(`from=${iso(T0)}&to=${iso(T0 + 15 * MIN)}`, { 'accept-encoding': 'gzip, deflate' }), gz);
    expect(gz.headers['Content-Encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString('utf8')).toBe(plain.body);
    now.mockRestore();
  });
  it('index=1 is routed to the night strip; a bad window is a 400', async () => {
    const sb = fakeSupabase(world());
    const { handler } = build({ identity: { discord_id: 'u-9' }, sb });
    const idx = resOf();
    await handler(reqOf(`from=${iso(T0)}&to=${iso(T0 + 3 * 3600_000)}&index=1`), idx);
    expect(JSON.parse(idx.body).minutes).toHaveLength(3);
    const bad = resOf();
    await handler(reqOf('from=x&to=y'), bad);
    expect(bad.code).toBe(400);
    expect(bad.json).toEqual({ error: 'bad request' });
  });
  it('a database that is down is a 503', async () => {
    const { handler } = build({ identity: { discord_id: 'u-9' }, sb: { isEnabled: () => false } });
    const res = resOf();
    await handler(reqOf(`from=${iso(T0)}&to=${iso(T0 + MIN)}`), res);
    expect(res.code).toBe(503);
  });
  it('the route sheds first, then budgets, then runs the handler; the shed ack is the empty payload', () => {
    const route = sliceBlock(code, "=== '/api/agent/replay-window'", '_handleAgentReplayWindowGet(req, res)');
    const shed = route.indexOf("_isShedded('replay_window', res, { ok: true, shed: true, rows: [], kills: [], callouts: [] })");
    const bud = route.indexOf("_overBudget('replay_window', req, res)");
    expect(shed).toBeGreaterThan(0);
    expect(bud).toBeGreaterThan(shed);
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/replay-window'/);
  });
  it('replay_window is sheddable (never durable), acks the empty payload, and is a 30/min GET budget kind', async () => {
    const gate = sliceBlock(src, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');
    const budgets = sliceBlock(src, 'const _BUDGET_DEFAULTS = {', '\n};');
    const { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune } = new Function(`
      let __t = {};
      function setTune(t) { __t = t; }
      async function _overlayTuningMap() { return __t; }
      ${gate}
      return { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune };`)();
    expect(_SHED_KINDS.has('replay_window')).toBe(true);
    expect(_SHED_NEVER.has('replay_window')).toBe(false);
    const ack = { ok: true, shed: true, rows: [], kills: [], callouts: [] };
    const res = { writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    setTune({});
    expect(await _isShedded('replay_window', res, ack)).toBe(false);
    setTune({ flag_shed_replay_window: 1 });
    expect(await _isShedded('replay_window', res, ack)).toBe(true);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body)).toEqual(ack);
    const defaults = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();
    expect(defaults.replay_window).toEqual({ perMin: 30, durable: false, get: true });
  });
});
