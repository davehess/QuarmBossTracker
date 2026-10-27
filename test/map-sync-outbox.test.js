// The Spawn map's guild-sync OUTBOX (the guild lead, 2026-10-26: "if the bot restarted and during that timeframe i killed
// something it would need to collect any of those spawn id + name matches and sync them back in. Source is important.").
//
// Before: a map-sync POST that got no answer (or any answer) was dropped, so a kill made while the bot was redeploying never
// reached the guild. Now the agent HOLDS what the bot has not taken, keeps each event's own character / spawn id / name / copy
// token / original `at`, retries with a backoff, and keeps the outbox in map_sync_outbox.json so a Mimic restart in the
// middle of an outage loses nothing. The bot half (a repeat is ignored) is test/map-sync-dedup.test.js.
//
// Behaviour, not text: the "Spawn map core" block of packages/wolfpack-logsync/index.js is source-sliced and RUN, over a temp
// dir and a fake http that can refuse, time out, answer any status, or hold an answer until the test lets it go.
//
// Mutation-checked (2026-10-26): the requeue removed (batch dropped again), 5xx / 404 / 429 moved to 'drop', a 4xx moved to
// 'retry', the backoff gate removed, the 404 wipe restored, the cap / age prune removed, the epoch guard removed, the
// persistence write removed, the load-time validation removed - each turns at least one test red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const EXPORTS = ['_mapSync', '_mapSyncFlush', '_mapSyncStop', '_mapSyncResume', '_mapSyncVerdict', '_mapLocalEvent', '_mapZoneDoc',
  '_mapPaths', '_mapOutboxSaveNow', '_mapSaveNow', 'MAP_SYNC_QUEUE_MAX', 'MAP_SYNC_KEEP_MS'];
const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
const H = 'pq.projectquarm.pq3.projectquarm.com:7312';

let dir;
const cores = [];

function loadCore(opts, net) {
  const prelude = `
    const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
    let _uploadOpts = __opts;
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: false }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    let _lastRaidPipe = null;
    function _zoneName() { return null; }
    function _eqSetupDirs() { return []; }
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts',
    prelude + '\n' + CORE + `\nreturn { ${EXPORTS.join(', ')} };`);
  const c = f(fs, path, net.http, net.https, zlib, dir, dir, opts);
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
  c._mapPaths.brewall = null;
  cores.push(c);
  return c;
}

// A fake bot. `script(call) -> { status } | { error } | { timeout } | { hang }`. A hung request is answered by release(status).
function fakeNet(script) {
  const calls = [], hung = [];
  const mod = {
    request(o, cb) {
      const handlers = {};
      const req = {
        on(ev, fn) { handlers[ev] = fn; return req; }, destroy() {},
        end(body) {
          o.__body = body ? Buffer.from(body).toString('utf8') : null;
          if (o.method === 'POST') calls.push(o);
          const answer = (r) => {
            if (r.error) return handlers.error && handlers.error(new Error('connect ECONNREFUSED'));
            if (r.timeout) return handlers.timeout && handlers.timeout();
            const res = new EventEmitter(); res.statusCode = r.status; res.headers = {};
            cb(res); res.emit('data', Buffer.from('{}')); res.emit('end');
          };
          setImmediate(() => {
            const r = script ? script(o) : { status: 200 };
            if (r.hang) hung.push((status) => answer({ status })); else answer(r);
          });
        },
      };
      return req;
    },
  };
  return { http: mod, https: mod, calls, hung };
}
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

function live(script, opts = LIVE) {
  const net = fakeNet(script);
  const c = loadCore(opts, net);
  return { c, net, zd: c._mapZoneDoc('thedeep') };
}
const N = Date.now();
// One event as the agent queues it: the character is the one that produced it.
const mk = (c, zd, character, over = {}) => c._mapLocalEvent('thedeep', zd, character,
  { point_id: 1, kind: 'died', spawn_id: 9001, name: 'a decaying skeleton', at: N, ...over }, N);
const bodyOf = (call) => JSON.parse(call.__body);
const outboxFile = () => path.join(dir, 'map_sync_outbox.json');

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapoutbox-')); });
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSyncStop(); } catch { /* nothing held */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('what an answer means for the batch it answers', () => {
  it.each([
    [null, 200, 'ok'], [null, 204, 'ok'],
    [new Error('refused'), undefined, 'retry'],
    [null, 500, 'retry'], [null, 502, 'retry'], [null, 503, 'retry'], [null, 429, 'retry'], [null, 404, 'retry'],
    [null, 400, 'drop'], [null, 401, 'drop'], [null, 403, 'drop'], [null, 413, 'drop'], [null, 422, 'drop'],
  ])('err=%s status=%s -> %s', (err, status, verdict) => {
    const { c } = live();
    expect(c._mapSyncVerdict(err, status)).toBe(verdict);
  });
});

describe('a bot that does not answer: the events are held, with their source, and arrive later', () => {
  it.each([
    ['connection refused', { error: true }],
    ['timeout', { timeout: true }],
    ['500', { status: 500 }],
    ['503 (the bot says try again shortly)', { status: 503 }],
    ['429', { status: 429 }],
  ])('%s: the batch goes back, and is resent as it was once the wait is over', async (_n, down) => {
    let up = false;
    const { c, net, zd } = live(() => (up ? { status: 200 } : down));
    mk(c, zd, 'Aldenmar', { point_id: 3, kind: 'died', spawn_id: 4242, name: 'a decaying skeleton', at: N - 5000 });
    c._mapSync.q[0].ev.inst = H;   // (as _mapLocalEvent stamps it inside a zone copy)
    mk(c, zd, 'Aldenmar', { point_id: 4, kind: 'seen', spawn_id: 4243, name: 'a decaying skeleton', at: N - 4000 });
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    expect(c._mapSync.q).toHaveLength(2);                                  // still held
    expect(c._mapSync.flying.size).toBe(0);
    expect(c._mapSyncFlush(N + 3000 + 14999)).toBe(false);                 // 15 s of quiet first
    expect(net.calls).toHaveLength(1);
    up = true;
    expect(c._mapSyncFlush(N + 3000 + 15000)).toBe(true);
    await tick();
    expect(net.calls).toHaveLength(2);
    const sent = bodyOf(net.calls[1]);
    expect(sent).toEqual(bodyOf(net.calls[0]));                            // the same batch, byte for byte
    expect(sent.character).toBe('Aldenmar');
    expect(sent.events).toEqual([
      { point_id: 3, kind: 'died', spawn_id: 4242, name: 'a decaying skeleton', at: N - 5000, inst: H },
      { point_id: 4, kind: 'seen', spawn_id: 4243, name: 'a decaying skeleton', at: N - 4000 },
    ]);
    expect(c._mapSync.q).toEqual([]);                                      // taken: nothing left to hold
  });

  it('each held event keeps the character that produced it: two characters\' events are not merged into one source', async () => {
    let up = false;
    const { c, net, zd } = live(() => (up ? { status: 200 } : { error: true }));
    mk(c, zd, 'Aldenmar', { at: N - 3000 });
    mk(c, zd, 'Brackwyn', { point_id: 2, at: N - 2000, spawn_id: 7 });
    mk(c, zd, 'Aldenmar', { point_id: 5, at: N - 1000, spawn_id: 8 });
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    up = true;
    expect(c._mapSyncFlush(N + 20000)).toBe(true);
    expect(c._mapSyncFlush(N + 20001)).toBe(true);
    await tick();
    const bodies = net.calls.slice(1).map(bodyOf);
    expect(bodies.map(b => [b.character, b.events.map(e => [e.point_id, e.spawn_id, e.at])])).toEqual([
      ['Aldenmar', [[1, 9001, N - 3000], [5, 8, N - 1000]]],
      ['Brackwyn', [[2, 7, N - 2000]]],
    ]);
  });

  it('the wait doubles - 15 s, 30 s, 60 s, 120 s, 240 s, then 5 minutes - and a good answer resets it', async () => {
    let up = false;
    const { c, zd } = live(() => (up ? { status: 200 } : { status: 503 }));
    mk(c, zd, 'Aldenmar');
    let now = N + 3000;
    const waits = [];
    for (let i = 0; i < 7; i++) {
      expect(c._mapSyncFlush(now)).toBe(true);
      await tick();
      waits.push(c._mapSync.retryAt - now);
      now = c._mapSync.retryAt;
    }
    expect(waits).toEqual([15000, 30000, 60000, 120000, 240000, 300000, 300000]);
    up = true;
    expect(c._mapSyncFlush(now)).toBe(true);
    await tick();
    expect(c._mapSync.fails).toBe(0);
    expect(c._mapSync.retryAt).toBe(0);
  });

  it('several POSTs in the air that all fail count as ONE failure (wait 15 s, not 7.5 min) and put the whole outbox back in order', async () => {
    const { c, net, zd } = live(() => ({ hang: true }));
    for (let i = 0; i < 120; i++) mk(c, zd, 'Aldenmar', { spawn_id: 100 + i, at: N + i });
    c._mapSyncFlush(N + 3000); c._mapSyncFlush(N + 3001); c._mapSyncFlush(N + 3002);
    await tick();
    expect(net.hung).toHaveLength(3);
    for (const release of net.hung.splice(0)) release(503);
    expect(c._mapSync.fails).toBe(1);
    expect(c._mapSync.retryAt).toBe(N + 3000 + 15000);
    expect(c._mapSync.q.map(x => x.ev.at)).toEqual(Array.from({ length: 120 }, (_, i) => N + i));
  });
});

describe('a 404 (the bot does not have the route yet)', () => {
  it('waits the same ten minutes as before, and does NOT empty the outbox', async () => {
    let up = false;
    const { c, net, zd } = live(() => (up ? { status: 200 } : { status: 404 }));
    mk(c, zd, 'Aldenmar', { at: N });
    expect(c._mapSyncFlush(N)).toBe(true);
    await tick();
    mk(c, zd, 'Aldenmar', { at: N + 1, spawn_id: 2 });
    expect(c._mapSyncFlush(N + 1000)).toBe(false);
    expect(c._mapSyncFlush(N + 599999)).toBe(false);
    expect(net.calls).toHaveLength(1);
    expect(c._mapSync.q.map(x => x.ev.at)).toEqual([N, N + 1]);
    up = true;
    expect(c._mapSyncFlush(N + 600000)).toBe(true);
    await tick();
    expect(bodyOf(net.calls[1]).events.map(e => e.at)).toEqual([N, N + 1]);
    expect(c._mapSync.q).toEqual([]);
  });
});

describe('an answer that says the events are bad', () => {
  it.each([400, 401, 403, 413, 422])('%s: dropped, not held and not retried', async (status) => {
    const { c, net, zd } = live(() => ({ status }));
    mk(c, zd, 'Aldenmar');
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    expect(c._mapSync.q).toEqual([]);
    expect(c._mapSync.retryAt).toBe(0);
    expect(c._mapSyncFlush(N + 3000 + 3600000)).toBe(false);
    expect(net.calls).toHaveLength(1);
  });
});

describe('what is worth holding', () => {
  it('at most 500 events: the oldest go first', async () => {
    const { c, zd } = live(() => ({ error: true }));
    expect(c.MAP_SYNC_QUEUE_MAX).toBe(500);
    for (let i = 0; i < 520; i++) mk(c, zd, 'Aldenmar', { spawn_id: 1 + i, at: N + i });
    expect(c._mapSync.q).toHaveLength(500);
    expect(c._mapSync.q[0].ev.spawn_id).toBe(21);
    // and the cap holds across a failed batch coming back
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    for (let i = 0; i < 40; i++) mk(c, zd, 'Aldenmar', { spawn_id: 1000 + i, at: N + 1000 + i });
    await tick();
    expect(c._mapSync.q).toHaveLength(500);
    expect(c._mapSync.q[c._mapSync.q.length - 1].ev.spawn_id).toBe(1039);   // the newest is never the one dropped
  });

  it('an event the bot would refuse for age (24 h) is dropped instead of held', async () => {
    const { c, net, zd } = live(() => ({ error: true }));
    mk(c, zd, 'Aldenmar', { at: N - c.MAP_SYNC_KEEP_MS - 1000, spawn_id: 1 });
    mk(c, zd, 'Aldenmar', { at: N - 3600000, spawn_id: 2 });
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    expect(bodyOf(net.calls[0]).events.map(e => e.spawn_id)).toEqual([2]);   // the stale one never went out
    expect(c._mapSync.q.map(x => x.ev.spawn_id)).toEqual([2]);
    // held long enough to go stale while the bot was away: gone at the next try
    expect(c._mapSyncFlush(N + 3000 + 15000 + c.MAP_SYNC_KEEP_MS)).toBe(false);
    expect(c._mapSync.q).toEqual([]);
  });
});

describe('the outbox survives a Mimic restart', () => {
  it('a held batch is on disk; a new run resumes it and sends it with its original source and times', async () => {
    const down = live(() => ({ error: true }));
    mk(down.c, down.zd, 'Aldenmar', { point_id: 3, spawn_id: 4242, at: N - 90000 });
    down.c._mapSync.q[0].ev.inst = H;
    mk(down.c, down.zd, 'Brackwyn', { point_id: 4, kind: 'empty', spawn_id: null, name: null, at: N - 60000 });
    expect(down.c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    down.c._mapOutboxSaveNow();                                            // (the 2 s debounce, or the exit hook)
    const onDisk = JSON.parse(fs.readFileSync(outboxFile(), 'utf8'));
    expect(onDisk.q.map(x => [x.character, x.ev.at])).toEqual([['Aldenmar', N - 90000], ['Brackwyn', N - 60000]]);
    // the "new run": a fresh core over the same folder, the bot back
    const up = live(() => ({ status: 200 }));
    expect(up.c._mapSyncResume(N + 120000)).toBe(2);
    expect(up.c._mapSync.flushTimer).toBeTruthy();                         // and a try is already scheduled
    expect(up.c._mapSyncFlush(N + 123000)).toBe(true);
    expect(up.c._mapSyncFlush(N + 123001)).toBe(true);
    await tick();
    expect(up.net.calls.map(bodyOf)).toEqual([
      { zone: 'thedeep', character: 'Aldenmar', events: [{ point_id: 3, kind: 'died', spawn_id: 4242, name: 'a decaying skeleton', at: N - 90000, inst: H }] },
      { zone: 'thedeep', character: 'Brackwyn', events: [{ point_id: 4, kind: 'empty', spawn_id: null, name: null, at: N - 60000 }] },
    ]);
    up.c._mapOutboxSaveNow();
    expect(fs.existsSync(outboxFile())).toBe(false);                        // delivered: the file is gone
  });

  it('a batch still in the air when the process dies is in the file too', async () => {
    const { c, zd } = live(() => ({ hang: true }));
    mk(c, zd, 'Aldenmar', { at: N - 1000 });
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    expect(c._mapSync.q).toEqual([]);                                       // it left the queue...
    c._mapOutboxSaveNow();
    expect(JSON.parse(fs.readFileSync(outboxFile(), 'utf8')).q).toHaveLength(1);   // ...but not the disk
  });

  it('an unreadable file, or rows that are not events, are ignored; nothing is invented', () => {
    fs.writeFileSync(outboxFile(), '{ not json');
    expect(live().c._mapSyncResume(N)).toBe(0);
    fs.writeFileSync(outboxFile(), JSON.stringify({ version: 1, q: [
      null, 'x', { zone: 5, character: 'Aldenmar', ev: { point_id: 1, kind: 'died', at: N } },
      { zone: 'thedeep', character: 'Aldenmar', ev: { point_id: 'a', kind: 'died', at: N } },
      { zone: 'thedeep', character: 'Aldenmar', ev: { point_id: 1, kind: 'died', at: 'now' } },
      { zone: 'thedeep', character: 'Aldenmar', ev: { point_id: 1, kind: 'died', at: N - 1000, spawn_id: 0, name: 'a bat', extra: 'x' } },
    ] }));
    const { c } = live();
    expect(c._mapSyncResume(N)).toBe(1);
    expect(c._mapSync.q[0]).toEqual({ zone: 'thedeep', character: 'Aldenmar', ev: { point_id: 1, kind: 'died', spawn_id: null, name: 'a bat', at: N - 1000 } });
  });

  it('local mode (no token) holds nothing: the outbox is emptied, not sent', async () => {
    const { c, net } = live(null, { botUrl: LIVE.botUrl, token: '' });
    c._mapSync.q.push({ zone: 'thedeep', character: 'Aldenmar', ev: { point_id: 1, kind: 'died', spawn_id: 1, name: null, at: N } });
    expect(c._mapSyncFlush(N + 3000)).toBe(false);
    expect(c._mapSync.q).toEqual([]);
    await tick();
    expect(net.calls).toHaveLength(0);
  });
});

describe('stopping', () => {
  it('_mapSyncStop empties the outbox and the file, and a POST still in the air cannot put its batch back', async () => {
    const { c, net, zd } = live(() => ({ hang: true }));
    mk(c, zd, 'Aldenmar');
    expect(c._mapSyncFlush(N + 3000)).toBe(true);
    await tick();
    c._mapOutboxSaveNow();
    expect(fs.existsSync(outboxFile())).toBe(true);
    c._mapSyncStop();
    expect(fs.existsSync(outboxFile())).toBe(false);
    for (const release of net.hung.splice(0)) release(503);
    expect(c._mapSync.q).toEqual([]);
    expect(c._mapSync.flushTimer).toBeNull();
  });
});
