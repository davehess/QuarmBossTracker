// test/live-memory.test.js — the bot answers its own roster and live-state reads from memory, and writes in batches.
//
// The guild lead, 2026-10-16 (option A, after "log ingestion is WAY over"): the bot is the one process every
// agent uploads raid_roster (~81k/day) and character_live_state (~48k/day) to, and it then read the same rows
// straight back from Supabase for the raid split, Extended Target, the buff queue, di-status, the zone map and
// the character-live-state relay. utils/liveMemory.js holds the latest rows and answers those reads once it has
// been receiving the stream for the read's whole window (a fresh process starts from Supabase), and it writes
// the newest row per key as ONE upsert per table every 2 s.
//
// These cases RUN the shipped module, and the shipped handlers and route code sliced out of index.js, against a
// recording client. Each was mutation-checked: put the old behavior back and the named case goes red.
//
// Fixture names are invented (Aldenmar, Brackwyn, Corvale, Rethlan); none is a member.
//
// Run: npx vitest run test/live-memory.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);
const mem = requireBot('./utils/liveMemory');
const snapshots = requireBot('./utils/readSnapshots');

const G = 'wolfpack';
const MIN = 60_000;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const rosterRow = (name, over = {}) => ({
  guild_id: G, name, class: 'Cleric', group_num: 1, level: 60, rank: null, hp_pct: 90,
  loc_x: 1, loc_y: 2, loc_z: 3, heading: 4, loc_at: iso(), hp_current: null, hp_max: null,
  captured_at: iso(), uploaded_by_discord_id: 'u1', ...over,
});
const liveRow = (character, over = {}) => ({
  guild_id: G, character, zone_id: 10, zone_name: 'Test Zone', self_hp_pct: 80, self_hp_cur: null, self_hp_max: null,
  di_ready_at: null, di_mem: true, self_mana_pct: 50, target_name: null, buffs: [{ name: 'Haste', ticks: 10 }], buff_count: 1,
  cooldowns: null, uploaded_by: 'u1', swapped_to: null, swapped_at: null, updated_at: iso(), ...over,
});

function client(over = {}) {
  const c = { upsert: vi.fn(async () => true), ...over };
  return c;
}
const tick = (ms = mem.FLUSH_MS) => vi.advanceTimersByTimeAsync(ms);
// Start both streams (one row of another guild, which no reader here asks about) and let 20 minutes pass without
// firing the flush timers, so a case can note rows stamped relative to "now" and read any window up to 20 minutes.
function warmUp() {
  mem.noteRosterRows([rosterRow('Starter', { guild_id: 'starter' })]);
  mem.noteLiveStateRows([liveRow('Starter', { guild_id: 'starter' })]);
  vi.setSystemTime(Date.now() + 20 * MIN);
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-16T01:00:00Z') });
  mem._reset(client());
});
afterEach(() => { mem._reset(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ── (a) the warm-up gate ───────────────────────────────────────────────────────────────────────────
describe('warm-up gate: memory answers only after it has been receiving the stream for the whole window', () => {
  it('a process that has noted nothing answers null (the reader runs its Supabase read)', () => {
    expect(mem.rosterRowsSince(G, 15 * MIN)).toBeNull();
    expect(mem.liveStateRowsSince(G, 10 * MIN)).toBeNull();
  });

  it('the first row starts the clock; roster is null until 15 minutes in, live state until its own window', () => {
    mem.noteRosterRows([rosterRow('Aldenmar')]);
    mem.noteLiveStateRows([liveRow('Aldenmar')]);
    vi.setSystemTime(Date.now() + 15 * MIN - 1);
    expect(mem.rosterRowsSince(G, 15 * MIN)).toBeNull();
    expect(mem.liveStateRowsSince(G, 15 * MIN)).toBeNull();
    expect(mem.liveStateRowsSince(G, 10 * MIN)).not.toBeNull();     // a 10-minute reader is warm sooner
    vi.setSystemTime(Date.now() + 1);
    expect(mem.rosterRowsSince(G, 15 * MIN)).not.toBeNull();
  });

  it('the two streams warm independently', () => {
    mem.noteRosterRows([rosterRow('Aldenmar')]);
    vi.setSystemTime(Date.now() + 16 * MIN);
    expect(mem.rosterRowsSince(G, 15 * MIN)).not.toBeNull();
    expect(mem.liveStateRowsSince(G, 10 * MIN)).toBeNull();
  });

  it('readSnapshots.raidRoster reads Supabase while cold and memory once warm', async () => {
    const cold = { selectAllPaged: vi.fn(async () => [{ name: 'FromSupabase' }]) };
    expect(await snapshots.raidRoster(cold, G)).toEqual([{ name: 'FromSupabase' }]);
    expect(cold.selectAllPaged).toHaveBeenCalledTimes(1);

    mem.noteRosterRows([rosterRow('Aldenmar')]);
    const started = { selectAllPaged: vi.fn(async () => [{ name: 'FromSupabase' }]) };    // receiving, but not for 15 minutes yet
    expect(await snapshots.raidRoster(started, G)).toEqual([{ name: 'FromSupabase' }]);
    vi.setSystemTime(Date.now() + 15 * MIN);
    const warm = { selectAllPaged: vi.fn(async () => [{ name: 'FromSupabase' }]) };
    const rows = await snapshots.raidRoster(warm, G);
    expect(warm.selectAllPaged).not.toHaveBeenCalled();
    expect(rows.map(r => r.name)).toEqual(['Aldenmar']);
  });
});

// ── (b) warm: filtered by window and guild ────────────────────────────────────────────────────────
describe('warm: rows come from memory, narrowed the way the SQL narrowed them', () => {
  it('roster: the time window, the guild, an optional name, and the SQL order', () => {
    warmUp();
    mem.noteRosterRows([
      rosterRow('Corvale', { uploaded_by_discord_id: 'u2', captured_at: iso(-2 * MIN) }),
      rosterRow('Brackwyn', { uploaded_by_discord_id: 'u1', captured_at: iso(-1 * MIN) }),
      rosterRow('Aldenmar', { uploaded_by_discord_id: 'u1', captured_at: iso(-3 * MIN) }),
      rosterRow('Rethlan', { captured_at: iso(-12 * MIN) }),                    // outside a 10-minute window
      rosterRow('Zarrin', { guild_id: 'other-guild' }),                         // another guild
    ]);
    const key = (rows) => rows.map(r => `${r.uploaded_by_discord_id}/${r.name}`);
    expect(key(mem.rosterRowsSince(G, 10 * MIN))).toEqual(['u1/Aldenmar', 'u1/Brackwyn', 'u2/Corvale']);
    expect(key(mem.rosterRowsSince(G, 15 * MIN))).toEqual(['u1/Aldenmar', 'u1/Brackwyn', 'u1/Rethlan', 'u2/Corvale']);
    expect(mem.rosterRowsSince(G, 30_000)).toEqual([]);
    expect(mem.rosterRowsSince(G, 10 * MIN, 'brackwyn').map(r => r.name)).toEqual(['Brackwyn']);
  });

  it('live state: the time window and the guild; a name narrows case-insensitively', () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { updated_at: iso(-2 * MIN) }), liveRow('Rethlan', { updated_at: iso(-11 * MIN) }),
      liveRow('Zarrin', { guild_id: 'other-guild' })]);
    expect(mem.liveStateRowsSince(G, 10 * MIN).map(r => r.character)).toEqual(['Aldenmar']);
    expect(mem.liveStateRowsSince(G, 12 * MIN).map(r => r.character).sort()).toEqual(['Aldenmar', 'Rethlan']);
    expect(mem.liveStateRowsSince(G, MIN)).toEqual([]);
    expect(mem.liveStateRowsSince(G, 10 * MIN, 'ALDENMAR')).toHaveLength(1);
    expect(mem.liveStateRowsSince(G, 10 * MIN, 'nobody')).toEqual([]);
  });

  it('rows handed out are copies: editing one does not edit memory', () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar')]);
    mem.liveStateRowsSince(G, 10 * MIN)[0].self_hp_pct = 1;
    expect(mem.liveStateRowsSince(G, 10 * MIN)[0].self_hp_pct).toBe(80);
  });

  it('entries older than 30 minutes are dropped on write', () => {
    mem.noteLiveStateRows([liveRow('Rethlan')]);
    vi.setSystemTime(Date.now() + 31 * MIN);
    mem.noteLiveStateRows([liveRow('Aldenmar')]);                               // the write that sweeps
    expect(mem._sizes().liveMem).toBe(1);
  });
});

// ── (c) a later partial row merges like an upsert ─────────────────────────────────────────────────
describe('a later row for a key merges the way an upsert does', () => {
  it('memory keeps the columns a partial row did not send, and the newest value wins', () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { self_hp_pct: 80, zone_name: 'Test Zone' })]);
    mem.noteLiveStateRows([{ guild_id: G, character: 'Aldenmar', self_hp_pct: 35, updated_at: iso(5_000) }]);
    const [r] = mem.liveStateRowsSince(G, 10 * MIN);
    expect(r.self_hp_pct).toBe(35);
    expect(r.zone_name).toBe('Test Zone');
    expect(r.buffs).toEqual([{ name: 'Haste', ticks: 10 }]);
  });

  it('roster rows are keyed (guild, uploader, name): two uploaders keep two rows, one uploader keeps one', () => {
    warmUp();
    mem.noteRosterRows([rosterRow('Aldenmar', { uploaded_by_discord_id: 'u1' }), rosterRow('Aldenmar', { uploaded_by_discord_id: 'u2', hp_pct: 10 })]);
    mem.noteRosterRows([rosterRow('Aldenmar', { uploaded_by_discord_id: 'u1', hp_pct: 55 })]);
    const rows = mem.rosterRowsSince(G, 10 * MIN);
    expect(rows.map(r => [r.uploaded_by_discord_id, r.hp_pct])).toEqual([['u1', 55], ['u2', 10]]);
  });

  it('the batch sends a partial row on its own, so Supabase merges it and does not null the columns it lacked', async () => {
    const c = client(); mem._reset(c);
    mem.noteLiveStateRows([liveRow('Aldenmar')]);
    await tick();
    c.upsert.mockClear();
    mem.noteLiveStateRows([{ guild_id: G, character: 'Aldenmar', self_hp_pct: 35, updated_at: iso() }, liveRow('Brackwyn')]);
    await tick();
    expect(c.upsert).toHaveBeenCalledTimes(2);                                  // one per column set
    const partial = c.upsert.mock.calls.map(a => a[1]).find(rows => rows[0].character === 'Aldenmar');
    expect(Object.keys(partial[0]).sort()).toEqual(['character', 'guild_id', 'self_hp_pct', 'updated_at']);
  });

  it('a swap stamp reaches memory and the row still waiting to be written', async () => {
    const c = client(); mem._reset(c);
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar')]);
    mem.noteLiveStateSwap(G, 'Aldenmar', { swapped_to: 'Corvale', swapped_at: iso(), updated_at: iso() });
    expect(mem.liveStateRowsSince(G, 10 * MIN, 'Aldenmar')[0].swapped_to).toBe('Corvale');
    await mem.flushLiveState();
    const sent = c.upsert.mock.calls[0][1].find(r => r.character === 'Aldenmar');
    expect(sent.swapped_to).toBe('Corvale');                                    // the batch would otherwise write null back
  });
});

// ── (d) batching and retry ─────────────────────────────────────────────────────────────────────────
describe('writes: one upsert per table per tick, the newest row per key', () => {
  it('50 uploads for 5 keys in one tick are one upsert of 5 rows per table, with the same on-conflict keys', async () => {
    const c = client(); mem._reset(c);
    for (let i = 0; i < 50; i++) {
      mem.noteRosterRows([rosterRow('Raider' + (i % 5), { hp_pct: i })]);
      mem.noteLiveStateRows([liveRow('Raider' + (i % 5), { self_hp_pct: i })]);
    }
    expect(c.upsert).not.toHaveBeenCalled();                                    // nothing goes out before the tick
    await tick();
    expect(c.upsert).toHaveBeenCalledTimes(2);
    const byTable = Object.fromEntries(c.upsert.mock.calls.map(([table, rows, onConflict, opts]) => [table, { rows, onConflict, opts }]));
    expect(byTable.raid_roster.rows).toHaveLength(5);
    expect(byTable.raid_roster.onConflict).toBe('guild_id,uploaded_by_discord_id,name');
    expect(byTable.character_live_state.rows).toHaveLength(5);
    expect(byTable.character_live_state.onConflict).toBe('guild_id,character');
    expect(byTable.character_live_state.opts).toEqual({ minimal: true, confirm: true });
    // the newest value per key: uploads 45..49 were the last for Raider0..Raider4
    expect(byTable.raid_roster.rows.map(r => r.hp_pct).sort()).toEqual([45, 46, 47, 48, 49]);
    await tick(10_000);
    expect(c.upsert).toHaveBeenCalledTimes(2);                                  // nothing pending, nothing sent
  });

  it('a failed flush keeps the rows, and a newer row for the same key wins on the retry', async () => {
    const c = client({
      upsert: vi.fn()
        // a newer row arrives while the first request is still in the air, and that request then fails
        .mockImplementationOnce(async () => { mem.noteLiveStateRows([liveRow('Aldenmar', { self_hp_pct: 99 })]); return null; })
        .mockResolvedValue(true),
    });
    mem._reset(c);
    mem.noteLiveStateRows([liveRow('Aldenmar', { self_hp_pct: 10 }), liveRow('Brackwyn', { self_hp_pct: 20 })]);
    await tick();
    expect(c.upsert).toHaveBeenCalledTimes(1);
    expect(mem._sizes().livePending).toBe(2);                                   // kept
    await tick();
    expect(c.upsert).toHaveBeenCalledTimes(2);
    const retried = Object.fromEntries(c.upsert.mock.calls[1][1].map(r => [r.character, r.self_hp_pct]));
    expect(retried).toEqual({ Aldenmar: 99, Brackwyn: 20 });
    expect(mem._sizes().livePending).toBe(0);
  });

  it('a flush that throws is retried the same way', async () => {
    const c = client({ upsert: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(true) });
    mem._reset(c);
    mem.noteRosterRows([rosterRow('Aldenmar')]);
    await tick();
    expect(mem._sizes().rosterPending).toBe(1);
    await tick();
    expect(c.upsert).toHaveBeenCalledTimes(2);
    expect(mem._sizes().rosterPending).toBe(0);
  });

  it('the buffer is capped, drops the oldest, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mem._reset(client({ upsert: vi.fn(async () => null) }));
    mem.noteRosterRows(Array.from({ length: mem.MAX_PENDING + 1 }, (_, i) => rosterRow('Raider' + i)));
    mem.noteRosterRows([rosterRow('Another')]);
    expect(mem._sizes().rosterPending).toBe(mem.MAX_PENDING);
    expect(warn.mock.calls.filter(a => /liveMemory/.test(String(a[0])))).toHaveLength(1);
  });

  it('a swap waits for the batch: flushLiveState sends what is pending before the caller sends its UPDATE', async () => {
    const order = [];
    const c = client({ upsert: vi.fn(async () => { order.push('upsert'); return true; }) });
    mem._reset(c);
    mem.noteLiveStateRows([liveRow('Aldenmar')]);
    await mem.flushLiveState();
    order.push('update');
    expect(order).toEqual(['upsert', 'update']);
  });
});

// ── supabase.upsert's confirm flag (how a failed batch is told from a written one) ─────────────────
describe('supabase.upsert { minimal, confirm }', () => {
  const sb = requireBot('./utils/supabase');
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  beforeEach(() => { process.env.SUPABASE_URL = 'http://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; sb._resetBreaker(); });
  afterEach(() => {
    if (env.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
    vi.unstubAllGlobals();
  });
  const stubFetch = (ok) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 201 : 400, text: async () => '' })));

  it('answers true for a written batch (an empty body) and null for a failed one', async () => {
    stubFetch(true);
    expect(await sb.upsert('t', [{ a: 1 }], 'a', { minimal: true, confirm: true })).toBe(true);
    expect(fetch.mock.calls[0][1].headers.Prefer).toBe('return=minimal,resolution=merge-duplicates');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(false);
    expect(await sb.upsert('t', [{ a: 1 }], 'a', { minimal: true, confirm: true })).toBeNull();
  });

  it('every other caller still gets what it got before: null for a minimal write without confirm', async () => {
    stubFetch(true);
    expect(await sb.upsert('t', [{ a: 1 }], 'a', { minimal: true })).toBeNull();
  });
});

// ── the handlers and routes, sliced out of index.js and run ───────────────────────────────────────
function sliceFunction(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('slice: function not found: ' + name);
  const end = SRC.indexOf('\n}\n', m.index);
  return SRC.slice(m.index, end + 3);
}
function loadBot(names, injected, extra = '') {
  const inj = Object.keys(injected);
  const body = extra + '\n' + names.map(sliceFunction).join('\n') + `\nreturn { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(...inj, body)(...inj.map(n => injected[n]));
}
const mkRes = () => { const r = { status: null, body: null, headersSent: false, writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; };
const mkReq = (payload, url = '/') => ({
  url, headers: {},
  on(ev, fn) { if (ev === 'data') fn(JSON.stringify(payload)); else if (ev === 'end') fn(); },
  destroy() {},
});
const realRequireWith = (sb) => (p) => (p === './utils/supabase' ? sb : requireBot(p));

// A route block, run as the dispatcher runs it, against the real _isShedded and the shed flags we hand it.
function routeRunner(startMarker, handlerName, handlerSpy, tune, overBudget = false) {
  const block = sliceBlock(SRC, startMarker, '\n  }\n');
  const { _isShedded } = loadBot(['_isShedded'], { _overlayTuningMap: async () => tune },
    `const _SHED_KINDS = new Set(['live_state', 'raid_roster']); const _SHED_NEVER = new Set(['encounter']);`);
  // eslint-disable-next-line no-new-func
  const run = new Function('req', 'res', '_isShedded', '_overBudget', handlerName, 'console',
    `return (async () => { ${block} })();`);
  return (req, res) => run(req, res, _isShedded, async () => overBudget, handlerSpy, console);
}

function rosterHandler(sb) {
  return loadBot(['_handleAgentRaidRoster'], {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u1' }) },
    process, console,
  })._handleAgentRaidRoster;
}
function liveStateHandler(sb) {
  return loadBot(['_handleAgentLiveState'], {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u1' }) },
    _raidTargets: () => ({ forget() {}, noteSample() {} }),
    _sanitizeLiveCooldowns: () => null,
    _pickZealTags: (t) => t,
    _noteTargetSwitches: async () => 0,
    _noteZealTags: async () => 0,
    process, console,
  })._handleAgentLiveState;
}
const enabled = (extra = {}) => ({ isEnabled: () => true, update: vi.fn(async () => []), upsert: vi.fn(async () => true), ...extra });

describe('the ingest handlers: noted in memory, written in a batch, acked without waiting', () => {
  it('raid-roster: 200 with the same body at once, nothing sent yet, one upsert on the tick', async () => {
    const sb = enabled(); mem._reset(sb);
    const res = mkRes();
    await rosterHandler(sb)(mkReq({ members: [{ name: 'Aldenmar', class: 'Cleric', group: 1, level: 60, hp_pct: 90 }, { name: 'Brackwyn', class: 'Warrior', group: 1 }] }), res);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, stored: 2 });
    expect(sb.upsert).not.toHaveBeenCalled();
    expect(mem._sizes().rosterMem).toBe(2);
    await tick();
    expect(sb.upsert).toHaveBeenCalledTimes(1);
    expect(sb.upsert.mock.calls[0][0]).toBe('raid_roster');
    expect(sb.upsert.mock.calls[0][1].map(r => r.name)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(sb.upsert.mock.calls[0][1][0].uploaded_by_discord_id).toBe('u1');
  });

  it('live-state: 200 with the same body at once, the swap UPDATE after the batch it patches', async () => {
    const order = [];
    const sb = enabled({
      upsert: vi.fn(async () => { order.push('upsert'); return true; }),
      update: vi.fn(async () => { order.push('update'); return []; }),
    });
    mem._reset(sb);
    const res = mkRes();
    await liveStateHandler(sb)(mkReq({ uploaded_by: 'u1', states: [
      { character: 'Aldenmar', zone_name: 'Test Zone', self_hp_pct: 70, buffs: [{ name: 'Haste', ticks: 4 }] },
      { character: 'Brackwyn', swapped_to: 'Corvale' },
    ] }), res);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, stored: 2 });
    expect(order).toEqual(['upsert', 'update']);
    expect(sb.upsert.mock.calls[0][0]).toBe('character_live_state');
    expect(sb.upsert.mock.calls[0][2]).toBe('guild_id,character');
  });

  it('live-state without a swap does not wait for Supabase at all', async () => {
    const sb = enabled(); mem._reset(sb);
    const res = mkRes();
    await liveStateHandler(sb)(mkReq({ uploaded_by: 'u1', states: [{ character: 'Aldenmar', zone_name: 'Test Zone' }] }), res);
    expect(res.status).toBe(200);
    expect(sb.upsert).not.toHaveBeenCalled();
    expect(mem._sizes().liveMem).toBe(1);
    await tick();
    expect(sb.upsert).toHaveBeenCalledTimes(1);
  });

  it('Supabase disabled: the handler answers as before and notes nothing', async () => {
    const sb = { isEnabled: () => false, upsert: vi.fn() }; mem._reset(sb);
    const res = mkRes();
    await rosterHandler(sb)(mkReq({ members: [{ name: 'Aldenmar' }] }), res);
    expect(JSON.parse(res.body)).toEqual({ ok: true, stored: 0, note: 'supabase disabled' });
    expect(mem._sizes().rosterMem).toBe(0);
  });
});

// ── (e) shed and budget: a refused upload is neither stored nor written ───────────────────────────
describe('shed flags and admission budgets act before the handler, exactly as before', () => {
  const cases = [
    ['raid_roster', "if (req.method === 'POST' && req.url === '/api/agent/raid-roster') {", '_handleAgentRaidRoster', 'rosterMem'],
    ['live_state', "if (req.method === 'POST' && req.url === '/api/agent/live-state') {", '_handleAgentLiveState', 'liveMem'],
  ];
  for (const [kind, marker, handlerName, sizeKey] of cases) {
    it(`${kind}: shed → 200 ack, handler not run, nothing in memory, nothing written`, async () => {
      const sb = enabled(); mem._reset(sb);
      const spy = vi.fn(async () => { mem.noteRosterRows([rosterRow('Aldenmar')]); mem.noteLiveStateRows([liveRow('Aldenmar')]); });
      const res = mkRes();
      await routeRunner(marker, handlerName, spy, { [`flag_shed_${kind}`]: 1 })({ method: 'POST', url: marker.match(/'(\/api[^']+)'/)[1], headers: {} }, res);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true, shed: kind });
      expect(spy).not.toHaveBeenCalled();
      expect(mem._sizes()[sizeKey]).toBe(0);
      await tick(10_000);
      expect(sb.upsert).not.toHaveBeenCalled();
    });

    it(`${kind}: over budget → handler not run, nothing in memory, nothing written`, async () => {
      const sb = enabled(); mem._reset(sb);
      const spy = vi.fn(async () => { mem.noteRosterRows([rosterRow('Aldenmar')]); mem.noteLiveStateRows([liveRow('Aldenmar')]); });
      const res = mkRes();
      await routeRunner(marker, handlerName, spy, {}, true)({ method: 'POST', url: marker.match(/'(\/api[^']+)'/)[1], headers: {} }, res);
      expect(spy).not.toHaveBeenCalled();
      expect(mem._sizes()[sizeKey]).toBe(0);
      await tick(10_000);
      expect(sb.upsert).not.toHaveBeenCalled();
    });

    it(`${kind}: not shed, within budget → the handler runs (the control)`, async () => {
      const sb = enabled(); mem._reset(sb);
      const spy = vi.fn(async () => { mem.noteRosterRows([rosterRow('Aldenmar')]); mem.noteLiveStateRows([liveRow('Aldenmar')]); });
      await routeRunner(marker, handlerName, spy, {})({ method: 'POST', url: marker.match(/'(\/api[^']+)'/)[1], headers: {} }, mkRes());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(mem._sizes()[sizeKey]).toBe(1);
    });
  }

  it('only the two handlers feed memory, and each only after its shed and budget gates in the route', () => {
    const code = stripJs(SRC);
    expect(code.match(/liveMemory'\)\.noteRosterRows\(/g)).toHaveLength(1);
    expect(code.match(/liveMem\.noteLiveStateRows\(/g)).toHaveLength(1);
    for (const [route, call] of [['/api/agent/raid-roster', '_handleAgentRaidRoster(req, res)'], ['/api/agent/live-state', '_handleAgentLiveState(req, res)']]) {
      const at = code.indexOf(`req.url === '${route}'`);
      const block = code.slice(at, code.indexOf(call, at));
      expect(block).toMatch(/_isShedded\(/);
      expect(block).toMatch(/_overBudget\(/);
    }
  });
});

// ── the readers ────────────────────────────────────────────────────────────────────────────────────
describe('readers: memory when warm, the original read when cold', () => {
  const relay = (sb, entries = new Map()) => loadBot(['_handleAgentCharacterLiveState'], {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u1' }) },
    _liveStateRelayCache: entries,
    LIVE_STATE_RELAY_CACHE_MS: 2_000,
    process, console, URL, JSON, Date,
  })._handleAgentCharacterLiveState;
  const ask = async (sb, name) => { const res = mkRes(); await relay(sb)({ url: '/api/agent/character-live-state?name=' + name, headers: {} }, res); return JSON.parse(res.body).state; };

  it('character-live-state relay: cold reads Supabase (live state, then the roster fallback)', async () => {
    const select = vi.fn(async (table) => (table === 'character_live_state'
      ? [{ character: 'Aldenmar', zone_name: 'Test Zone', self_hp_pct: 60, buffs: [], cooldowns: [], updated_at: iso(-5_000) }] : []));
    const state = await ask(enabled({ select }), 'Aldenmar');
    expect(select.mock.calls.map(c => c[0])).toContain('character_live_state');
    expect(state.self_hp_pct).toBe(60);
  });

  it('character-live-state relay: warm answers from memory with no Supabase read, same freshness gates', async () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { self_hp_pct: 61, self_hp_cur: 5000, self_hp_max: 9000, cooldowns: [{ key: 'x' }] })]);
    mem.noteRosterRows([rosterRow('Brackwyn', { hp_pct: 44, hp_current: 2200, hp_max: 5000 })]);
    const select = vi.fn(async () => { throw new Error('should not read'); });
    const sb = enabled({ select });
    const own = await ask(sb, 'aldenmar');
    expect(own).toMatchObject({ character: 'Aldenmar', self_hp_pct: 61, self_hp_cur: 5000, self_hp_max: 9000, cooldowns: [{ key: 'x' }] });
    const borrowed = await ask(sb, 'Brackwyn');                                 // not on Mimic: HP borrowed from the roster
    expect(borrowed).toMatchObject({ self_hp_pct: 44, self_hp_cur: 2200, self_hp_max: 5000, hp_source: 'raid_roster' });
    expect(await ask(sb, 'Nobody')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('character-live-state relay: receiving for less than the window still reads Supabase', async () => {
    mem.noteLiveStateRows([liveRow('Aldenmar', { self_hp_pct: 11 })]);
    mem.noteRosterRows([rosterRow('Aldenmar')]);
    vi.setSystemTime(Date.now() + 5 * MIN);
    const select = vi.fn(async (table) => (table === 'character_live_state'
      ? [{ character: 'Aldenmar', zone_name: 'Test Zone', self_hp_pct: 60, self_hp_cur: 1, buffs: [], cooldowns: [], updated_at: iso(-5_000) }] : []));
    const state = await ask(enabled({ select }), 'Aldenmar');
    expect(state.self_hp_pct).toBe(60);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('character-live-state relay: a row past 10 minutes is no state, as in SQL + gate', async () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { updated_at: iso(-11 * MIN) })]);
    const sb = enabled({ select: vi.fn(async () => { throw new Error('should not read'); }) });
    expect(await ask(sb, 'Aldenmar')).toBeNull();
  });

  const diPayload = (sb) => loadBot(['_buildDiStatusPayload'], { require: realRequireWith(sb), process, console, Date, JSON })._buildDiStatusPayload;
  it('di-status: warm → the live rows come from memory (the class list is still its own snapshot)', async () => {
    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { di_ready_at: null, self_mana_pct: 40 }), liveRow('Brackwyn'),
      liveRow('Corvale', { updated_at: iso(-11 * MIN) })]);                     // a cleric past the 10-minute window
    const select = vi.fn(async (table) => {
      if (table === 'characters') return [{ name: 'Aldenmar', class: 'Cleric' }, { name: 'Brackwyn', class: 'Warrior' }, { name: 'Corvale', class: 'Cleric' }];
      throw new Error('live state must not be read');
    });
    const sb = enabled({ select });
    const out = JSON.parse(await diPayload(sb)(sb));
    expect(out.clerics).toEqual([{ name: 'Aldenmar', ready_at: null, mem: true }]);
    expect(out.healer_mana.map(h => h.name)).toEqual(['Aldenmar']);
  });

  it('di-status: cold → the original read of character_live_state', async () => {
    const select = vi.fn(async (table) => (table === 'characters' ? [{ name: 'Aldenmar', class: 'Cleric' }] : []));
    const sb = enabled({ select });
    await diPayload(sb)(sb);
    expect(select.mock.calls.map(c => c[0])).toContain('character_live_state');
  });

  const zoneMap = (sb) => loadBot(['_liveZoneMap'], { require: realRequireWith(sb), process, console, Date, Map, String, Number },
    'let _liveZoneCache = { at: 0, map: new Map() }; const _liveZoneEntries = new Map(); const LIVE_ZONE_TTL_MS = 10_000;')._liveZoneMap;
  it('zone map: warm → built from memory; cold → the original read', async () => {
    const cold = enabled({ select: vi.fn(async () => [{ character: 'Aldenmar', zone_name: 'Cold Zone', zone_id: 3 }]) });
    expect((await zoneMap(cold)()).get('aldenmar')).toEqual({ zone_name: 'Cold Zone', zone_id: 3 });
    expect(cold.select).toHaveBeenCalledTimes(1);

    warmUp();
    mem.noteLiveStateRows([liveRow('Aldenmar', { zone_name: 'Warm Zone', zone_id: 7 })]);
    const warm = enabled({ select: vi.fn(async () => { throw new Error('should not read'); }) });
    expect((await zoneMap(warm)()).get('aldenmar')).toEqual({ zone_name: 'Warm Zone', zone_id: 7 });
  });

  it('Extended Target and the buff queue ask memory first, with their own windows, and keep the Supabase read behind it', () => {
    const code = stripJs(SRC);
    const ext = code.slice(code.indexOf('async function _handleAgentExtendedTarget('), code.indexOf('async function', code.indexOf('async function _handleAgentExtendedTarget(') + 10));
    expect(ext).toMatch(/liveMemory'\)\.liveStateRowsSince\(guildId, extOnlineMs\)\s*\|\|\s*supabase\.select\('character_live_state'/);
    const rbq = code.slice(code.indexOf('async function _handleAgentRaidBuffQueue('));
    expect(rbq).toMatch(/liveMemory'\)\.liveStateRowsSince\(guildId, ROSTER_FRESH_MS\)\s*\|\|\s*supabase\.select\('character_live_state'/);
  });
});
