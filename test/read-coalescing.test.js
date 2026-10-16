// test/read-coalescing.test.js — one Supabase read per window, however many agents ask at once.
//
// The guild lead, 2026-10-16: "log ingestion is WAY over." Supabase logs every API request, and in the 24
// hours to 2026-10-16 04:00 UTC (a raid night, ~60 Mimic agents) the gateway took 1.18 M requests, nearly all
// from the bot. Every bot cache was check → await → set, so the requests that arrived while the first read
// was still in flight each sent the same read again. utils/ttlCache.js keeps the pending PROMISE per key; the
// handlers below were moved onto it, the roster and characters reads that several handlers made separately
// share one snapshot (utils/readSnapshots.js), and the Raid-Helper mirror sends one upsert per table.
//
// Each case RUNS the shipped code (utils/ in full, the handlers sliced out of index.js) against a recording
// client whose reads take a few milliseconds — long enough for concurrent callers to overlap, which is the
// whole failure. Every case was mutation-checked: put the old behavior back and the named case goes red.
//
// The bundle handlers (Extended Target, buff queue) are covered in pgrst-cap-bot-reads.test.js, beside the
// cap-enforcing fake they already use.
//
// Run: npx vitest run test/read-coalescing.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);
const ttl = requireBot('./utils/ttlCache');
const snapshots = requireBot('./utils/readSnapshots');

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));   // real timers: only Date is faked below
const mkRes = () => { const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; };

beforeEach(() => { vi.useFakeTimers({ now: Date.parse('2026-10-16T01:00:00Z'), toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

// ── the helper ──────────────────────────────────────────────────────────────────────────────────────
describe('utils/ttlCache: cached()', () => {
  it('callers who arrive while the load is in flight share it', async () => {
    const map = new Map();
    let loads = 0;
    const load = async () => { loads++; await tick(); return { n: loads }; };
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => ttl.cached(map, 'k', 1000, load)));
    expect(loads).toBe(1);
    expect(new Set(all).size).toBe(1);               // the same object, which is why consumers must not edit it
  });

  it('keeps the answer for the TTL and loads again after it', async () => {
    const map = new Map();
    let loads = 0;
    const load = async () => ++loads;
    expect(await ttl.cached(map, 'k', 1000, load)).toBe(1);
    vi.setSystemTime(Date.now() + 999);
    expect(await ttl.cached(map, 'k', 1000, load)).toBe(1);
    vi.setSystemTime(Date.now() + 2);
    expect(await ttl.cached(map, 'k', 1000, load)).toBe(2);
  });

  it('never keeps a rejection: every waiter sees it, the next caller tries again', async () => {
    const map = new Map();
    let loads = 0;
    const load = async () => { loads++; await tick(); if (loads === 1) throw new Error('down'); return 'ok'; };
    const first = await Promise.allSettled([ttl.cached(map, 'k', 1000, load), ttl.cached(map, 'k', 1000, load)]);
    expect(first.map(r => r.status)).toEqual(['rejected', 'rejected']);
    expect(loads).toBe(1);
    expect(await ttl.cached(map, 'k', 1000, load)).toBe('ok');
    expect(loads).toBe(2);
  });

  it('shouldCache:false answers the burst but keeps nothing', async () => {
    const map = new Map();
    let loads = 0;
    const load = async () => { loads++; await tick(); return null; };
    const opts = { shouldCache: (v) => v != null };
    await Promise.all([ttl.cached(map, 'k', 1000, load, opts), ttl.cached(map, 'k', 1000, load, opts)]);
    expect(loads).toBe(1);
    await ttl.cached(map, 'k', 1000, load, opts);
    expect(loads).toBe(2);
  });

  it('keys are independent, and a replaced Map starts empty (how a test resets a cache)', async () => {
    let map = new Map();
    let loads = 0;
    const load = async () => ++loads;
    await ttl.cached(map, 'a', 1000, load);
    await ttl.cached(map, 'b', 1000, load);
    expect(loads).toBe(2);
    map = new Map();
    await ttl.cached(map, 'a', 1000, load);
    expect(loads).toBe(3);
  });

  it('stays under max: idle entries go, a load in flight never does', async () => {
    const map = new Map();
    let release;
    const slow = ttl.cached(map, 'slow', 1000, () => new Promise(r => { release = r; }), { max: 3 });
    for (let i = 0; i < 6; i++) await ttl.cached(map, 'k' + i, 1000, async () => i, { max: 3 });
    expect(map.size).toBeLessThanOrEqual(4);
    expect(map.has('slow')).toBe(true);
    release('done');
    expect(await slow).toBe('done');
  });
});

// ── the shared snapshots ───────────────────────────────────────────────────────────────────────────
describe('utils/readSnapshots', () => {
  function client() {
    const calls = [];
    return {
      calls,
      selectAllPaged: async (table, q) => { calls.push({ table, q }); await tick(); return [{ name: 'Aldenmar', captured_at: 'x' }]; },
      select: async (table, q) => { calls.push({ table, q }); await tick(); return [{ name: 'Aldenmar', class: 'Cleric' }]; },
    };
  }

  it('the raid_roster window is one read however many handlers ask in the same moment', async () => {
    const sb = client();
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => snapshots.raidRoster(sb, 'wolfpack')));
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0].q).toMatch(/captured_at=gte\./);
    expect(a).toBe(b); expect(b).toBe(c);
  });

  it('the roster read carries the union of the columns its readers use', async () => {
    const sb = client();
    await snapshots.raidRoster(sb, 'wolfpack');
    const cols = decodeURIComponent(sb.calls[0].q).match(/select=([^&]*)/)[1].split(',');
    // the raid split (rank, group_num, uploader, captured_at), the buff queue (class, level, hp_pct) and
    // Extended Target (loc_x/y/z, heading, loc_at)
    for (const c of ['name', 'rank', 'group_num', 'uploaded_by_discord_id', 'captured_at', 'class', 'level', 'hp_pct',
      'loc_x', 'loc_y', 'loc_z', 'heading', 'loc_at']) expect(cols).toContain(c);
  });

  it('the roster snapshot is kept 4 s and read again after', async () => {
    const sb = client();
    await snapshots.raidRoster(sb, 'wolfpack');
    vi.setSystemTime(Date.now() + 3_900);
    await snapshots.raidRoster(sb, 'wolfpack');
    expect(sb.calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 200);
    await snapshots.raidRoster(sb, 'wolfpack');
    expect(sb.calls).toHaveLength(2);
  });

  it('a failed read (null) is not kept', async () => {
    const calls = [];
    const sb = { selectAllPaged: async () => { calls.push(1); return null; } };
    expect(await snapshots.raidRoster(sb, 'wolfpack')).toBeNull();
    expect(await snapshots.raidRoster(sb, 'wolfpack')).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('characters are read once for five minutes, for the buff queue and di-status alike', async () => {
    const sb = client();
    await Promise.all([snapshots.characterClasses(sb, 'wolfpack'), snapshots.characterClasses(sb, 'wolfpack')]);
    vi.setSystemTime(Date.now() + 299_000);
    await snapshots.characterClasses(sb, 'wolfpack');
    expect(sb.calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);
    await snapshots.characterClasses(sb, 'wolfpack');
    expect(sb.calls).toHaveLength(2);
  });

  it('two clients (two tests, two fakes) never share a snapshot', async () => {
    const a = client(), b = client();
    await snapshots.raidRoster(a, 'wolfpack');
    await snapshots.raidRoster(b, 'wolfpack');
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });
});

// ── _liveZoneMap ───────────────────────────────────────────────────────────────────────────────────
describe('_liveZoneMap', () => {
  const block = sliceBlock(SRC, 'let _liveZoneCache = {', '\n// Which ZONE a kill happened in');
  function load(rowsFor) {
    const calls = [];
    const sb = {
      isEnabled: () => true,
      select: async (t, q) => { calls.push({ t, q }); await tick(); return rowsFor(); },
    };
    const req = (p) => (p === './utils/supabase' ? sb : requireBot(p));
    // eslint-disable-next-line no-new-func
    const { _liveZoneMap } = new Function('require', 'process', block.replace(/\n\/\/ Which ZONE a kill happened in$/, '') + '\nreturn { _liveZoneMap };')(req, process);
    return { _liveZoneMap, calls };
  }
  const rows = () => [{ character: 'Aldenmar', zone_name: 'Sanctus Seru', zone_id: 159 }, { character: 'Brackwyn', zone_name: null, zone_id: null }];

  it('twenty callers in the same moment are one read', async () => {
    const { _liveZoneMap, calls } = load(rows);
    const maps = await Promise.all(Array.from({ length: 20 }, () => _liveZoneMap()));
    expect(calls).toHaveLength(1);
    expect(maps[0].get('aldenmar')).toEqual({ zone_name: 'Sanctus Seru', zone_id: 159 });
    expect(maps[19]).toBe(maps[0]);
  });

  it('is kept 10 s (it was 2 s), then read again', async () => {
    const { _liveZoneMap, calls } = load(rows);
    await _liveZoneMap();
    vi.setSystemTime(Date.now() + 9_000);
    await _liveZoneMap();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1_500);
    await _liveZoneMap();
    expect(calls).toHaveLength(2);
  });

  it('a read that throws gives the fail-open empty map and is not kept', async () => {
    let boom = true;
    const { _liveZoneMap, calls } = load(() => { if (boom) throw new Error('down'); return rows(); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const empty = await _liveZoneMap();
    expect(empty.size).toBe(0);
    boom = false;
    expect((await _liveZoneMap()).size).toBe(2);
    expect(calls).toHaveLength(2);
    warn.mockRestore();
  });
});

// ── target-buffs ───────────────────────────────────────────────────────────────────────────────────
describe('GET /api/agent/target-buffs', () => {
  const block = sliceBlock(SRC, 'const TARGET_BUFFS_CACHE_MS', '\n// ── Remote overlay tuning')
    .replace(/\n\/\/ ── Remote overlay tuning$/, '');
  function load() {
    const calls = [];
    const sb = {
      isEnabled: () => true,
      select: async (t, q) => {
        calls.push({ t, q }); await tick();
        return [{ spell_name: 'Malo', dur_ticks: 1000, cast_at: new Date(Date.now() - 60_000).toISOString(), observer: 'Aldenmar', is_charm_spell: false, target_id: null }];
      },
    };
    const req = (p) => (p === './utils/supabase' ? sb : requireBot(p));
    // eslint-disable-next-line no-new-func
    const { _handleAgentTargetBuffs } = new Function('require', 'process', 'mimicLink', '_liveZoneMap', '_nameZoneCount',
      '_zoneScopeKeepForName', '_idScopeKeep', '_isJunkSpellName', block + '\nreturn { _handleAgentTargetBuffs };')(
      req, process, { requireAgentAuth: async () => ({ discord_id: '1' }) }, async () => new Map(), async () => 1,
      () => true, () => true, () => false);
    const ask = async (name = 'A Test Mob') => {
      const res = mkRes();
      await _handleAgentTargetBuffs({ url: '/api/agent/target-buffs?name=' + encodeURIComponent(name), headers: {} }, res);
      return res;
    };
    return { ask, calls };
  }

  it('sixty agents on one mob in the same moment are one buff_casts read, and all get the answer', async () => {
    const { ask, calls } = load();
    const all = await Promise.all(Array.from({ length: 60 }, () => ask()));
    expect(calls).toHaveLength(1);
    expect(all.every(r => r.status === 200)).toBe(true);
    expect(JSON.parse(all[59].body).buffs.map(b => b.name)).toEqual(['Malo']);
  });

  it('is kept 5 s per mob (it was 2 s); another mob is its own read', async () => {
    const { ask, calls } = load();
    await ask();
    vi.setSystemTime(Date.now() + 4_500);
    await ask();
    expect(calls).toHaveLength(1);
    await ask('Another Mob');
    expect(calls).toHaveLength(2);
    vi.setSystemTime(Date.now() + 1_000);
    await ask();
    expect(calls).toHaveLength(3);
  });
});

// ── di-status ──────────────────────────────────────────────────────────────────────────────────────
describe('GET /api/agent/di-status', () => {
  const block = sliceBlock(SRC, 'const DI_STATUS_CACHE_MS', '\n// Server-side hurt-duration tracker')
    .replace(/\n\/\/ Server-side hurt-duration tracker$/, '');
  function load() {
    const calls = [];
    const sb = {
      isEnabled: () => true,
      select: async (t, q) => {
        calls.push({ t, q }); await tick();
        if (t === 'character_live_state') {
          return [{ character: 'Aldenmar', di_ready_at: null, di_mem: true, self_mana_pct: 80, updated_at: 'x' },
                  { character: 'Brackwyn', di_ready_at: null, di_mem: null, self_mana_pct: 40, updated_at: 'x' },
                  { character: 'Corvale', di_ready_at: null, di_mem: null, self_mana_pct: 10, updated_at: 'x' }];
        }
        return [{ name: 'Aldenmar', class: 'Cleric' }, { name: 'Brackwyn', class: 'Shaman' }, { name: 'Corvale', class: 'Warrior' }];
      },
    };
    const req = (p) => (p === './utils/supabase' ? sb : requireBot(p));
    // eslint-disable-next-line no-new-func
    const { _handleAgentDiStatus } = new Function('require', 'process', 'mimicLink', block + '\nreturn { _handleAgentDiStatus };')(
      req, process, { requireAgentAuth: async () => ({ discord_id: '1' }) });
    const ask = async () => { const res = mkRes(); await _handleAgentDiStatus({ url: '/api/agent/di-status', headers: {} }, res); return res; };
    return { ask, calls };
  }

  it('a raid of agents in the same moment is one live-state read and one characters read', async () => {
    const { ask, calls } = load();
    const all = await Promise.all(Array.from({ length: 30 }, () => ask()));
    expect(calls.filter(c => c.t === 'character_live_state')).toHaveLength(1);
    expect(calls.filter(c => c.t === 'characters')).toHaveLength(1);
    const out = JSON.parse(all[29].body);
    expect(out.clerics.map(c => c.name)).toEqual(['Aldenmar']);
    expect(out.healer_mana.map(h => [h.name, h.class])).toEqual([['Brackwyn', 'Shaman'], ['Aldenmar', 'Cleric']]);   // a warrior is no healer
  });

  it('keeps 3 s, and the characters list outlives it (5 minutes)', async () => {
    const { ask, calls } = load();
    await ask();
    vi.setSystemTime(Date.now() + 2_900);
    await ask();
    expect(calls.filter(c => c.t === 'character_live_state')).toHaveLength(1);
    vi.setSystemTime(Date.now() + 200);
    await ask();
    expect(calls.filter(c => c.t === 'character_live_state')).toHaveLength(2);
    expect(calls.filter(c => c.t === 'characters')).toHaveLength(1);
  });
});

// ── guild triggers ─────────────────────────────────────────────────────────────────────────────────
describe('_guildTriggersFor', () => {
  const block = sliceBlock(SRC, 'const GUILD_TRIGGERS_CACHE_MS', '\nasync function _handleAgentGuildTriggers(')
    .replace(/\nasync function _handleAgentGuildTriggers\($/, '');
  function load(rows = () => [
    { id: 't1', category: 'a', name: 'All', applies_to_classes: null, updated_at: '1' },
    { id: 't2', category: 'a', name: 'Clerics', applies_to_classes: ['Cleric'], updated_at: '1' },
    { id: 't3', category: 'b', name: 'Wizards', applies_to_classes: ['Wizard'], updated_at: '1' },
  ]) {
    const calls = [];
    const sb = { isEnabled: () => true, selectAllPaged: async (t, q) => { calls.push({ t, q }); await tick(); return rows(); } };
    const req = (p) => (p === './utils/supabase' ? sb : requireBot(p));
    // eslint-disable-next-line no-new-func
    const { _guildTriggersFor } = new Function('require', 'process', '_pollTuningVersion', block + '\nreturn { _guildTriggersFor };')(
      req, process, (parts) => parts.join('|'));
    return { _guildTriggersFor, calls };
  }

  it('sixty agents with different class sets in the same moment are ONE table read, each filtered for its own classes', async () => {
    const { _guildTriggersFor, calls } = load();
    const classSets = [[], ['Cleric'], ['Wizard'], ['Cleric', 'Wizard'], ['Warrior']];
    const out = await Promise.all(Array.from({ length: 60 }, (_, i) => _guildTriggersFor({ classes: classSets[i % 5] })));
    expect(calls).toHaveLength(1);
    expect(out[1].triggers.map(t => t.id)).toEqual(['t1', 't2']);     // Cleric: the all-class trigger and its own
    expect(out[2].triggers.map(t => t.id)).toEqual(['t1', 't3']);
    expect(out[4].triggers.map(t => t.id)).toEqual(['t1']);
    expect(out[0].triggers.map(t => t.id)).toEqual(['t1', 't2', 't3']);   // no class set: all of them
  });

  it('is kept 60 s per category; another category is its own read', async () => {
    const { _guildTriggersFor, calls } = load();
    await _guildTriggersFor({ classes: [] });
    vi.setSystemTime(Date.now() + 59_000);
    await _guildTriggersFor({ classes: ['Cleric'] });
    expect(calls).toHaveLength(1);
    await _guildTriggersFor({ classes: [], category: 'a' });
    expect(calls).toHaveLength(2);
    expect(calls[1].q).toContain('category=eq.a');
    vi.setSystemTime(Date.now() + 2_000);
    await _guildTriggersFor({ classes: [] });
    expect(calls).toHaveLength(3);
  });

  it('a failed read (null) is not kept: the next ask reads again', async () => {
    let fail = true;
    const { _guildTriggersFor, calls } = load(() => (fail ? null : [{ id: 't1', category: 'a', name: 'All', applies_to_classes: null, updated_at: '1' }]));
    expect((await _guildTriggersFor({ classes: [] })).triggers).toEqual([]);
    fail = false;
    expect((await _guildTriggersFor({ classes: [] })).triggers).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

// ── live damage ────────────────────────────────────────────────────────────────────────────────────
describe('GET /api/agent/live-damage', () => {
  const handler = sliceBlock(SRC, 'async function _handleAgentLiveDamage', '\n}');
  function load() {
    const calls = [];
    const sb = {
      isEnabled: () => true,
      rpc: async (name, p) => { calls.push(p); await tick(); return []; },
      select: async () => [],
    };
    const req = (p) => (String(p).endsWith('supabase') ? sb : requireBot(p));
    globalThis._liveDmgCache = new Map();
    // eslint-disable-next-line no-new-func
    const fn = new Function('mimicLink', 'require', 'process', '_corroboratedDamage', handler + '\nreturn _handleAgentLiveDamage;')(
      { requireAgentAuth: async () => ({ discord_id: '1' }) }, req, { env: {} }, (v) => Math.max(0, ...(v || [])));
    const ask = async (qs) => { const res = mkRes(); await fn({ url: '/api/agent/live-damage?' + qs }, res); return res; };
    return { ask, calls };
  }
  const T0 = '2026-10-16T00:30:00.000Z';

  it('the live ask: a raid in the same moment is one read, kept 5 s (it was 2 s)', async () => {
    const { ask, calls } = load();
    await Promise.all(Array.from({ length: 40 }, () => ask('boss=Lord%20Test')));
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 4_500);
    await ask('boss=Lord%20Test');
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1_000);
    await ask('boss=Lord%20Test');
    expect(calls).toHaveLength(2);
  });

  it('a finished fight: clients name its start a few seconds apart and still share one read, kept 30 s', async () => {
    const { ask, calls } = load();
    const at = (s) => 'boss=Lord%20Test&fight_start=' + encodeURIComponent(new Date(Date.parse(T0) + s * 1000).toISOString());
    await Promise.all([ask(at(0.2)), ask(at(1.9)), ask(at(3.1)), ask(at(4.4))]);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 29_000);
    await ask(at(2));
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);                       // past 30 s: the 100 s settle pass reads fresh
    await ask(at(2));
    expect(calls).toHaveLength(2);
  });

  it('the live ask and a finished-fight ask of the same boss do not share an answer', async () => {
    const { ask, calls } = load();
    await ask('boss=Lord%20Test');
    await ask('boss=Lord%20Test&fight_start=' + encodeURIComponent(T0));
    expect(calls).toHaveLength(2);
    expect(calls[1].p_start_lo).not.toBeNull();
  });

  it('two fights of one boss minutes apart are not shared', async () => {
    const { ask, calls } = load();
    await ask('boss=X&fight_start=2026-10-16T00:30:00Z');
    await ask('boss=X&fight_start=2026-10-16T00:32:00Z');
    expect(calls).toHaveLength(2);
  });
});

// ── Raid-Helper sync ───────────────────────────────────────────────────────────────────────────────
describe('raidhelperApi.syncRecent', () => {
  const file = new URL('../utils/raidhelperApi.js', import.meta.url);
  const savedEnv = { k: process.env.RH_API_KEY, s: process.env.RH_SERVER_ID };

  function load(supabase) {
    const mod = { exports: {} };
    const src = readSource(file.pathname);
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', src)((p) => (p === './supabase' ? supabase : requireBot(p)), mod, mod.exports);
    return mod.exports;
  }
  function fakeSupabase() {
    const calls = [];
    return {
      calls,
      isEnabled: () => true,
      upsert: async (table, rows, onConflict) => { calls.push({ table, rows, onConflict }); return rows; },
    };
  }
  // The v4 listing answers one page with N events, S signups each; the retired v2 detail route 404s.
  function stubFetch(events) {
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url);
      if (/\/api\/v4\/servers\//.test(u)) {
        const page = /page=(\d+)/.exec(u)[1];
        return { ok: true, status: 200, text: async () => JSON.stringify(page === '1' ? { postedEvents: events, pages: 1 } : { postedEvents: [] }) };
      }
      return { ok: false, status: 404, text: async () => '{"error":"Endpoint not found"}' };
    });
  }
  const mkEvents = (n, s) => Array.from({ length: n }, (_, i) => ({
    id: 'ev' + i, title: 'Raid ' + i, startTime: 1_760_000_000 + i * 3600,
    signUps: Array.from({ length: s }, (_, j) => ({ userId: 'u' + j, name: 'Raider' + j, className: 'Warrior', entryTime: 1_760_000_000 })),
  }));

  beforeEach(() => { process.env.RH_API_KEY = 'k'; process.env.RH_SERVER_ID = 's'; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => {
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    if (savedEnv.k === undefined) delete process.env.RH_API_KEY; else process.env.RH_API_KEY = savedEnv.k;
    if (savedEnv.s === undefined) delete process.env.RH_SERVER_ID; else process.env.RH_SERVER_ID = savedEnv.s;
  });

  it('290 events with signups: one upsert for rh_events and one for rh_signups, not ~580', async () => {
    stubFetch(mkEvents(290, 1));
    const sb = fakeSupabase();
    const out = await load(sb).syncRecent();
    expect(sb.calls.map(c => c.table)).toEqual(['rh_events', 'rh_signups']);
    expect(sb.calls[0].rows).toHaveLength(290);
    expect(sb.calls[1].rows).toHaveLength(290);
    expect(out).toEqual({ events: 290, signups: 290 });
  });

  it('keeps the same on-conflict columns and the same stored rows', async () => {
    stubFetch(mkEvents(3, 2));
    const sb = fakeSupabase();
    await load(sb).syncRecent();
    expect(sb.calls[0].onConflict).toBe('id');
    expect(sb.calls[1].onConflict).toBe('event_id,signup_id');
    expect(sb.calls[0].rows.map(r => r.id)).toEqual(['ev0', 'ev1', 'ev2']);
    expect(sb.calls[0].rows[0]).toMatchObject({ id: 'ev0', title: 'Raid 0', guild_id: expect.any(String), start_time: expect.any(String), raw: expect.any(Object), synced_at: expect.any(String) });
    expect(sb.calls[1].rows.map(r => [r.event_id, r.signup_id, r.signup_index])).toEqual([
      ['ev0', 'u0', 0], ['ev0', 'u1', 1], ['ev1', 'u0', 0], ['ev1', 'u1', 1], ['ev2', 'u0', 0], ['ev2', 'u1', 1]]);
  });

  it('a key twice in one batch is sent once (Postgres refuses the whole batch otherwise)', async () => {
    const ev = mkEvents(1, 0)[0];
    ev.signUps = [{ id: 'dup', name: 'A', className: 'Cleric' }, { id: 'dup', name: 'B', className: 'Cleric' }];
    stubFetch([ev, { ...ev, title: 'Raid 0 again' }]);
    const sb = fakeSupabase();
    await load(sb).syncRecent();
    expect(sb.calls[0].rows).toHaveLength(1);
    expect(sb.calls[0].rows[0].title).toBe('Raid 0 again');
    expect(sb.calls[1].rows).toHaveLength(1);
    expect(sb.calls[1].rows[0].user_name).toBe('B');
  });

  it('an event with no signups sends no rh_signups request at all', async () => {
    stubFetch(mkEvents(4, 0));
    const sb = fakeSupabase();
    await load(sb).syncRecent();
    expect(sb.calls.map(c => c.table)).toEqual(['rh_events']);
  });

  it('a very large sync is split into 500-row requests rather than one huge body', async () => {
    stubFetch(mkEvents(2, 600));
    const sb = fakeSupabase();
    const out = await load(sb).syncRecent();
    expect(sb.calls.filter(c => c.table === 'rh_signups').map(c => c.rows.length)).toEqual([500, 500, 200]);
    expect(out.signups).toBe(1200);
  });

  it('a failed events request counts none of them, as before', async () => {
    stubFetch(mkEvents(5, 1));
    const sb = fakeSupabase();
    sb.upsert = async (table, rows) => (table === 'rh_events' ? null : rows);
    const out = await load(sb).syncRecent();
    expect(out.events).toBe(0);
  });
});
