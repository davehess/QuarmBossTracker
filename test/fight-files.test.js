// test/fight-files.test.js — a fight's snapshots are held in memory and written as ONE gzipped file.
//
// The guild lead, 2026-11-05 ("do A, keep everything"): encounter_threat_snapshots was 53% of the database and the
// Micro instance ran out of disk IO on 2026-11-04. utils/fightFiles.js keeps a fight's rows in memory and writes one
// file when it ends; the tuning number `snapshot_store` (0 rows only, 1 both, 2 files only) picks the path.
//
// These cases RUN the shipped module and the shipped handlers sliced from index.js, against recording stubs.
// Fixture names are invented (Aldenmar, Brackwyn, Corvale, Rethlan); none is a member.
//
// Run: npx vitest run test/fight-files.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const ff = requireBot('./utils/fightFiles');
const ttlCache = requireBot('./utils/ttlCache');
const SRC = readSource(BOT_INDEX);

const G = 'wolfpack';
const T0 = Date.parse('2026-11-05T01:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const snap = (over = {}) => ({
  guild_id: G, encounter_id: null, boss_name: 'Lord Test', target_name: null,
  started_at: iso(T0), snapshot_at: iso(T0 + 1000), uploader: 'Aldenmar', total: 100,
  per_player: { Aldenmar: { dmg: 100, swing: 100, total: 100 }, Brackwyn: { dmg: 50, swing: 50, total: 50 } },
  raid_night_id: null, ...over,
});

// A store whose clock the test owns and whose storage records.
function makeStore({ failPut = 0, config = {} } = {}) {
  let t = T0;
  const calls = { put: [], index: [], ranks: [] };
  let fails = failPut;
  const deps = {
    now: () => t,
    log: () => {},
    config,
    putObject: vi.fn(async (path, buf) => {
      if (fails > 0) { fails--; throw new Error('storage down'); }
      calls.put.push({ path, buf });
    }),
    getObject: vi.fn(async (path) => calls.put.find((p) => p.path === path).buf),
    putIndex: vi.fn(async (rec) => { calls.index.push(rec); }),
    putRanks: vi.fn(async (f, rows, trash) => { calls.ranks.push({ rows, trash }); }),
    listIndex: vi.fn(async () => calls.index),
  };
  const store = ff.createStore(deps);
  return { store, calls, deps, advance: (ms) => { t += ms; }, at: () => t };
}
// gzip runs on the thread pool, so wait on the REAL clock even when a case has faked timers
const realTimeout = globalThis.setTimeout;
const settle = () => new Promise((r) => realTimeout(r, 25));

describe('grouping', () => {
  it('two uploaders 8 s apart are one fight; the same boss 3 minutes later is a new one', () => {
    const { store } = makeStore();
    store.add(snap({ uploader: 'Aldenmar' }));
    store.add(snap({ uploader: 'Brackwyn', started_at: iso(T0 + 8000), snapshot_at: iso(T0 + 9000) }));
    expect(store.stats().fights).toBe(1);
    store.add(snap({ started_at: iso(T0 + 180_000), snapshot_at: iso(T0 + 181_000) }));
    expect(store.stats().fights).toBe(2);
    store.add(snap({ boss_name: 'Another Boss' }));
    expect(store.stats().fights).toBe(3);
    store._stop();
  });
});

describe('writing a fight', () => {
  it('after the idle time it writes ONE gzipped file: a header line, then every row', async () => {
    const { store, calls, advance } = makeStore();
    store.add(snap({ uploader: 'Aldenmar' }));
    store.add(snap({ uploader: 'Brackwyn', snapshot_at: iso(T0 + 2000), started_at: iso(T0 + 3000) }));
    store.add(snap({ uploader: 'Aldenmar', snapshot_at: iso(T0 + 3000) }));
    advance(4 * 60_000);
    store.tick();
    await settle();
    expect(calls.put).toHaveLength(0);            // not idle long enough yet
    advance(61_000);
    store.tick();
    await settle();
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0].path).toMatch(/^wolfpack\/2026-11-05\/lord-test\/20261105T010000Z_s010001\.ndjson\.gz$/);
    const lines = zlib.gunzipSync(calls.put[0].buf).toString().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ v: 1, guild_id: G, boss_name: 'Lord Test', rows: 3, uploaders: ['Aldenmar', 'Brackwyn'] });
    expect(lines[0].started_at).toBe(iso(T0));
    expect(lines).toHaveLength(4);
    expect(lines[1].per_player.Aldenmar.dmg).toBe(100);
    expect(calls.index).toHaveLength(1);
    expect(calls.index[0]).toMatchObject({ guild_id: G, boss_name: 'Lord Test', rows: 3, path: calls.put[0].path });
    expect(calls.ranks).toHaveLength(1);
    store._stop();
  });

  it('a failed upload keeps the rows, retries with backoff, and writes when storage returns', async () => {
    const { store, calls, deps, advance } = makeStore({ failPut: 2 });
    store.add(snap());
    advance(6 * 60_000); store.tick(); await settle();
    expect(deps.putObject).toHaveBeenCalledTimes(1);
    expect(store.stats().rows).toBe(1);           // still in memory
    store.tick(); await settle();
    expect(deps.putObject).toHaveBeenCalledTimes(1);   // backoff: not yet
    advance(31_000); store.tick(); await settle();
    expect(deps.putObject).toHaveBeenCalledTimes(2);   // failed again
    advance(61_000); store.tick(); await settle();
    expect(deps.putObject).toHaveBeenCalledTimes(3);
    expect(calls.put).toHaveLength(1);
    expect(calls.index).toHaveLength(1);
    store._stop();
  });

  it('gives up after the attempt limit, logging, and never throws', async () => {
    const lines = [];
    const { store, deps, advance } = makeStore({ failPut: 99, config: { maxAttempts: 3, retryBaseMs: 1000 } });
    deps.log = (m) => lines.push(m);
    const s2 = ff.createStore({ ...deps, log: (m) => lines.push(m) });
    s2.add(snap());
    for (let i = 0; i < 6; i++) { advance(10 * 60_000); s2.tick(); await settle(); }
    expect(deps.putObject).toHaveBeenCalledTimes(3);
    expect(lines.some((l) => /giving up/.test(l))).toBe(true);
    s2._stop(); store._stop();
  });

  it('a written fight stays readable for 30 minutes, then goes', async () => {
    const { store, advance } = makeStore();
    store.add(snap());
    advance(6 * 60_000); store.tick(); await settle();
    const q = { guild: G, boss: 'lord test', sinceMs: 0 };
    expect(store.liveRows(q)).toHaveLength(1);
    advance(29 * 60_000); store.tick();
    expect(store.liveRows(q)).toHaveLength(1);
    advance(2 * 60_000); store.tick();
    expect(store.liveRows(q)).toHaveLength(0);
    expect(store.stats().fights).toBe(0);
    store._stop();
  });

  it('SIGTERM: flushAll writes every pending fight now, idle or not', async () => {
    const { store, calls } = makeStore();
    store.add(snap());
    store.add(snap({ boss_name: 'Second Boss' }));
    await store.flushAll();
    expect(calls.put).toHaveLength(2);
    expect(calls.index).toHaveLength(2);
    store._stop();
  });

  it('a straggler for a written fight writes the same path again', async () => {
    const { store, calls, advance } = makeStore();
    store.add(snap());
    advance(6 * 60_000); store.tick(); await settle();
    store.add(snap({ snapshot_at: iso(T0 + 400_000) }));
    advance(6 * 60_000); store.tick(); await settle();
    expect(calls.put).toHaveLength(2);
    expect(calls.put[1].path).toBe(calls.put[0].path);
    store._stop();
  });
});

describe('memory is bounded', () => {
  it('drops the oldest whole fight past maxFights, with a log line', () => {
    const lines = [];
    const store = ff.createStore({ now: () => T0, log: (m) => lines.push(m), config: { maxFights: 2 },
      putObject: async () => {}, putIndex: async () => {}, putRanks: async () => {} });
    store.add(snap({ boss_name: 'A' }));
    store.add(snap({ boss_name: 'B' }));
    store.add(snap({ boss_name: 'C' }));
    expect(store.stats().fights).toBe(2);
    expect(store.liveRows({ guild: G, boss: 'a', sinceMs: 0 })).toHaveLength(0);
    expect(store.liveRows({ guild: G, boss: 'c', sinceMs: 0 })).toHaveLength(1);
    expect(lines.some((l) => /memory bound/.test(l))).toBe(true);
    store._stop();
  });

  it('a fight at maxRowsPerFight is written at once and the next row opens a new fight', async () => {
    const { store, calls } = makeStore({ config: { maxRowsPerFight: 3 } });
    for (let i = 0; i < 3; i++) store.add(snap({ snapshot_at: iso(T0 + 1000 * (i + 1)) }));
    await settle();
    expect(calls.put).toHaveLength(1);
    store.add(snap({ snapshot_at: iso(T0 + 10_000) }));
    expect(store.stats().fights).toBe(2);
    store._stop();
  });
});

// ── rank contribution: the SQL, written out naively, against the JS ───────────────────────────────────
// rollup_threat_ranks (20260808050000) as a relational pipeline: explode per_player, row_number() per snapshot
// partition ordered by swing+proc+spell+heal, group by boss/started_at/character.
function sqlRollup(rows) {
  const exploded = [];
  for (const s of rows) {
    if (!s.started_at || Array.isArray(s.per_player)) continue;
    if (s.boss_name == null && s.raid_night_id == null) continue;
    const entries = Object.entries(s.per_player);
    const sc = (v) => (v.swing || 0) + (v.proc || 0) + (v.spell || 0) + (v.heal || 0);
    const ordered = entries.map(([k, v]) => ({ k, score: sc(v) }))
      .sort((a, b) => b.score - a.score || (a.k.length - b.k.length) || (a.k < b.k ? -1 : 1));
    ordered.forEach((e, i) => exploded.push({ s, name: e.k, rank: i + 1, field: entries.length }));
  }
  const groups = {};
  for (const e of exploded) {
    const gk = `${e.s.boss_name}|${e.s.started_at}|${e.name}`;
    (groups[gk] ||= []).push(e);
  }
  return Object.values(groups).map((g) => {
    const rk = g.map((e) => e.rank), fd = g.map((e) => e.field);
    const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100;
    return { boss_name_key: g[0].s.boss_name, started_at_key: new Date(g[0].s.started_at).toISOString(), character_name: g[0].name,
      snapshots: g.length, times_top1: rk.filter((r) => r === 1).length, times_top3: rk.filter((r) => r <= 3).length,
      best_rank: Math.min(...rk), worst_rank: Math.max(...rk), avg_rank: avg(rk), avg_field: avg(fd) };
  });
}
const pick = (r) => ({ boss_name_key: r.boss_name_key, started_at_key: r.started_at_key, character_name: r.character_name,
  snapshots: r.snapshots, times_top1: r.times_top1, times_top3: r.times_top3, best_rank: r.best_rank, worst_rank: r.worst_rank,
  avg_rank: r.avg_rank, avg_field: r.avg_field });
const order = (a, b) => (a.started_at_key + a.character_name < b.started_at_key + b.character_name ? -1 : 1);

describe('rankRows = rollup_threat_ranks', () => {
  function fixture() {
    const rows = [];
    const names = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara'];
    // three uploaders (two with starts 5 s apart) x 12 seconds, scores that cross over so ranks move
    for (const [up, off] of [['Aldenmar', 0], ['Brackwyn', 5000], ['Corvale', 0]]) {
      for (let s = 1; s <= 12; s++) {
        const pp = {};
        names.forEach((n, i) => {
          const base = (i + 1) * 100;
          pp[n] = { swing: base + (n === 'Nyssara' ? s * 60 : s), proc: i === 2 ? 40 : 0, spell: 0, heal: 0 };
        });
        // exact ties, inserted out of jsonb order (shorter key first, then bytes): jsonb order decides the rank
        pp.TiedLonger = { swing: 300 }; pp.Tied2 = { swing: 300 }; pp.Tied1 = { swing: 300 };
        rows.push(snap({ uploader: up, started_at: iso(T0 + off), snapshot_at: iso(T0 + off + s * 1000), per_player: pp }));
      }
    }
    return rows;
  }

  it('gives the same rows as the SQL, for a few uploaders x seconds', () => {
    const rows = fixture();
    const js = ff.rankRows(rows).map(pick).sort(order);
    const sql = sqlRollup(rows).sort(order);
    expect(js.length).toBeGreaterThan(10);
    expect(js).toEqual(sql);
  });

  it('keeps each uploader start as its own fight key, and counts distinct starts', () => {
    const out = ff.rankRows(fixture());
    expect(new Set(out.map((r) => r.started_at_key)).size).toBe(2);
    expect(out.every((r) => r.fights_counted === 1)).toBe(true);
  });

  it('skips rows with no start, an array per_player, or neither boss nor raid night', () => {
    expect(ff.rankRows([snap({ started_at: null }), snap({ per_player: [1] }), snap({ boss_name: null, raid_night_id: null })])).toEqual([]);
  });

  it('trash collapses onto the raid night (06:00 ET rollover) and needs an average field of 8', () => {
    const big = {}; for (let i = 0; i < 8; i++) big['Raider' + i] = { swing: 10 + i };
    const mk = (ms, pp) => snap({ boss_name: null, raid_night_id: 'night-1', started_at: iso(ms), snapshot_at: iso(ms + 1000), per_player: pp });
    // 2026-11-05T03:00Z is 22:00 ET on the 4th (EST after the Nov 1 change); 11:00Z is 06:00 ET on the 5th = next night
    const a = ff.rankRows([mk(Date.parse('2026-11-05T03:00:00Z'), big), mk(Date.parse('2026-11-05T04:30:00Z'), big)]);
    expect(a).toHaveLength(8);
    expect(a[0].boss_name_key).toBe('(raid trash)');
    expect(a[0].started_at_key).toBe('2026-11-04T05:00:00.000Z');    // 00:00 EST on the 4th
    expect(a[0].snapshots).toBe(2);
    expect(a[0].fights_counted).toBe(2);
    const small = ff.rankRows([mk(Date.parse('2026-11-05T03:00:00Z'), { A: { swing: 1 }, B: { swing: 2 } })]);
    expect(small).toEqual([]);
    expect(ff.nightStartMs(Date.parse('2026-11-05T11:30:00Z'))).toBe(Date.parse('2026-11-05T05:00:00Z'));
    expect(ff.nightStartMs(Date.parse('2026-07-05T03:00:00Z'))).toBe(Date.parse('2026-07-04T04:00:00Z'));   // EDT
  });

  it('mergeRank folds a second file into the night\'s row', () => {
    const a = { snapshots: 2, times_top1: 1, times_top3: 2, best_rank: 1, worst_rank: 4, avg_rank: 2, avg_field: 10, fights_counted: 1 };
    const b = { snapshots: 2, times_top1: 0, times_top3: 1, best_rank: 2, worst_rank: 6, avg_rank: 4, avg_field: 12, fights_counted: 1, encounter_id: null, raid_night_id: 'n' };
    expect(ff.mergeRank(a, b)).toMatchObject({ snapshots: 4, times_top1: 1, times_top3: 3, best_rank: 1, worst_rank: 6, avg_rank: 3, avg_field: 11, fights_counted: 2, raid_night_id: 'n' });
    expect(ff.mergeRank(null, b)).toBe(b);
  });
});

// ── the handlers, sliced from index.js ──────────────────────────────────────────────────────────────
const ingestSrc = sliceBlock(SRC, 'async function _handleAgentThreatSnapshot', '\n}');
const liveSrc = sliceBlock(SRC, 'async function _handleAgentLiveDamage', '\n}');

function body(obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  return { [Symbol.asyncIterator]: async function* () { yield buf; } };
}

function runIngest(mode, payload, store) {
  const upserts = [];
  const supabase = { isEnabled: () => true, upsert: async (t, rows) => { upserts.push({ t, rows }); return rows; } };
  const req = body(payload);
  const rq = (p) => (String(p).endsWith('supabase') ? supabase
    : String(p).endsWith('fightFiles') ? { getStore: () => store }
      : String(p).endsWith('raidNight') ? { isRaidNightAt: () => true } : {});
  // eslint-disable-next-line no-new-func
  const fn = new Function('mimicLink', 'require', 'process', '_raidNightIdForMs', '_threatSnapIsDuplicate', '_trackUpload', '_snapshotStoreMode',
    ingestSrc + '\nreturn _handleAgentThreatSnapshot;')(
    { requireAgentAuth: async () => ({ discord_id: '1' }) }, rq, { env: {} }, async () => null, () => false, () => {}, async () => mode);
  const res = { writeHead() {}, end(b) { this.body = b; } };
  return fn(req, res).then(() => ({ upserts, res }));
}
const payload = (over = {}) => ({ boss_name: 'Lord Test', uploader: 'Aldenmar', started_at: iso(T0), snapshot_at: iso(T0 + 1000), total: 5,
  per_player: { Aldenmar: { dmg: 5 } }, ...over });

describe('snapshot_store: the ingest switch', () => {
  it('0 = today: the row is upserted and nothing is buffered', async () => {
    const { store } = makeStore();
    const { upserts } = await runIngest(0, payload(), store);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].t).toBe('encounter_threat_snapshots');
    expect(store.stats().rows).toBe(0);
    store._stop();
  });
  it('1 = both: the row is upserted AND buffered', async () => {
    const { store } = makeStore();
    const { upserts } = await runIngest(1, payload(), store);
    expect(upserts).toHaveLength(1);
    expect(store.stats().rows).toBe(1);
    store._stop();
  });
  it('2 = files only: buffered, no row write', async () => {
    const { store } = makeStore();
    const { upserts, res } = await runIngest(2, payload(), store);
    expect(upserts).toHaveLength(0);
    expect(store.stats().rows).toBe(1);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, written: 1 });
    store._stop();
  });
  it('mode 0 leaves the write exactly as it was (source check, comments stripped)', () => {
    const code = stripJs(ingestSrc);
    expect(code).toMatch(/if \(_snapMode < 2\) \{\s*await supabase\.upsert\('encounter_threat_snapshots', \[row\], 'guild_id,uploader,boss_name,snapshot_at'\)/);
    expect(code).toMatch(/if \(_snapMode >= 1\) require\('\.\/utils\/fightFiles'\)\.getStore\(\)\.add\(row\)/);
  });
});

function runLive(mode, url, store, dbRows = []) {
  const reads = [];
  const supabase = {
    isEnabled: () => true,
    rpc: async (n, p) => { reads.push(['rpc', n, p]); return dbRows; },
    select: async (t, q) => { reads.push(['select', t, q]); return dbRows; },
  };
  const rq = (p) => (String(p).endsWith('supabase') ? supabase : String(p).endsWith('ttlCache') ? ttlCache
    : String(p).endsWith('fightFiles') ? { getStore: () => store } : {});
  // eslint-disable-next-line no-new-func
  const fn = new Function('mimicLink', 'require', 'process', '_corroboratedDamage', '_snapshotStoreMode',
    liveSrc + '\nreturn _handleAgentLiveDamage;')(
    { requireAgentAuth: async () => ({ discord_id: '1' }) }, rq, { env: {} }, (v) => Math.max(0, ...(v || [])), async () => mode);
  const res = { writeHead() {}, end(b) { this.body = b; } };
  globalThis._liveDmgCache = new Map();
  return fn({ url }, res).then(() => ({ reads, out: JSON.parse(res.body) }));
}

describe('/live-damage reads the fight buffer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0 + 30_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('mode 2 answers from memory and never touches the database', async () => {
    const { store } = makeStore();
    store.add(snap({ uploader: 'Aldenmar', per_player: { Corvale: { dmg: 900 } } }));
    store.add(snap({ uploader: 'Brackwyn', per_player: { Corvale: { dmg: 800 }, Rethlan: { dmg: 40 } } }));
    const { reads, out } = await runLive(2, '/api/agent/live-damage?boss=Lord%20Test', store);
    expect(reads).toHaveLength(0);
    expect(out.players[0]).toEqual({ character: 'Corvale', dmg: 900 });
    expect(out.uploaders).toBe(2);
    store._stop();
  });

  it('one fight by its start: the same 20 s window as the database read', async () => {
    const { store } = makeStore();
    store.add(snap({ per_player: { Corvale: { dmg: 10 } } }));
    store.add(snap({ boss_name: 'Lord Test', started_at: iso(T0 + 90_000), snapshot_at: iso(T0 + 91_000), uploader: 'Brackwyn', per_player: { Corvale: { dmg: 77 } } }));
    const { out } = await runLive(2, '/api/agent/live-damage?boss=lord%20test&fight_start=' + encodeURIComponent(iso(T0 + 5000)), store);
    expect(out.players).toEqual([{ character: 'Corvale', dmg: 10 }]);
    store._stop();
  });

  it('the live ask reads the last three minutes only', async () => {
    const { store } = makeStore();
    vi.setSystemTime(T0 + 10 * 60_000);
    store.add(snap({ uploader: 'Aldenmar', started_at: iso(T0), snapshot_at: iso(T0 + 1000), per_player: { Corvale: { dmg: 1 } } }));
    store.add(snap({ uploader: 'Brackwyn', started_at: iso(T0), snapshot_at: iso(T0 + 9.5 * 60_000), per_player: { Corvale: { dmg: 2 } } }));
    const { out } = await runLive(2, '/api/agent/live-damage?boss=Lord%20Test', store);
    expect(out.uploaders).toBe(1);
    expect(out.players).toEqual([{ character: 'Corvale', dmg: 2 }]);
    store._stop();
  });

  it('mode 1 falls back to the database when memory has nothing', async () => {
    const { store } = makeStore();
    const dbRows = [{ uploader: 'Aldenmar', snapshot_at: iso(T0), per_player: { Rethlan: { dmg: 5 } } }];
    const { reads, out } = await runLive(1, '/api/agent/live-damage?boss=Lord%20Test', store, dbRows);
    expect(reads.length).toBeGreaterThan(0);
    expect(out.players).toEqual([{ character: 'Rethlan', dmg: 5 }]);
    store._stop();
  });

  it('mode 1 prefers memory when it has the fight', async () => {
    const { store } = makeStore();
    store.add(snap({ per_player: { Corvale: { dmg: 12 } } }));
    const { reads, out } = await runLive(1, '/api/agent/live-damage?boss=Lord%20Test', store, []);
    expect(reads).toHaveLength(0);
    expect(out.players[0].dmg).toBe(12);
    store._stop();
  });

  it('mode 2, a fight past the memory window: read back from its file', async () => {
    const { store, advance } = makeStore();
    store.add(snap({ per_player: { Corvale: { dmg: 321 } } }));
    advance(6 * 60_000); store.tick(); await settle();
    advance(40 * 60_000); store.tick();              // out of memory now
    expect(store.stats().fights).toBe(0);
    const { reads, out } = await runLive(2, '/api/agent/live-damage?boss=Lord%20Test&fight_start=' + encodeURIComponent(iso(T0)), store);
    expect(reads).toHaveLength(0);
    expect(out.players).toEqual([{ character: 'Corvale', dmg: 321 }]);
    store._stop();
  });

  it('mode 0 is the database path, no buffer asked (source check)', () => {
    const code = stripJs(liveSrc);
    expect(code).toMatch(/if \(snapMode >= 1\) \{/);
    expect(code).toMatch(/supabase\.rpc\('live_damage_snapshots'/);
  });
});

describe('the nightly rollup and shutdown are wired', () => {
  it('mode 2 skips rollup_threat_ranks', () => {
    const code = stripJs(SRC);
    expect(code).toMatch(/if \(await _snapshotStoreMode\(\) >= 2\) \{[^}]*rollup skipped[^}]*\} else \{\s*const n = await supabase\.rpc\('rollup_threat_ranks'/s);
  });
  it('SIGTERM flushes the fight buffer', () => {
    const shut = sliceBlock(SRC, 'function _gracefulShutdown', '\n}');
    expect(stripJs(shut)).toMatch(/fightFiles'\)\.getStore\(\)\.flushAll\(\)/);
  });
});
