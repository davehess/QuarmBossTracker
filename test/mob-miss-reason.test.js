// FB-95 (a member, 2026-10-23, Mimic 3.0.3 / agent 4.0.10): "target info showing no catalog stats for this target" on
// a Plane of Knowledge NPC whose catalog row exists - and the bot logged no catalog query for it at all. "No catalog
// stats" stood for six different situations and nothing said which. These tests run the real fetchMobInfo block (the
// same slice test/mob-pack-agent.test.js runs) against a stubbed bot and check, path by path: the reason the agent
// records, that a retry forgets the key and asks again, what the overlay prints, and what a feedback report carries.
//
// Run: npx vitest run test/mob-miss-reason.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const _mobInfoByName  = new Map();', '\n// Target Info F/Q/V: the bot');
const ctxBlock = sliceBlock(src, 'function _mobTargetCtx(st) {', '\nfunction buildMobInfo() {')
  .replace(/\nfunction buildMobInfo\(\) \{$/, '');
const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));

let S, dir;
// A bot stub that can also fail the way a network does: an error, a request that never answers.
function fakeHttps() {
  return {
    request(opts, cb) {
      S.requests.push(opts);
      const h = {};
      return {
        on(ev, fn) { h[ev] = fn; return this; },
        destroy() {},
        end() {
          const r = S.respond(opts);
          setTimeout(() => {
            if (r.hang) return;
            if (r.error) { h.error && h.error(Object.assign(new Error('x'), { code: r.error })); return; }
            const res = { statusCode: r.status, headers: {}, _h: {}, on(ev, fn) { this._h[ev] = fn; return this; }, complete: true };
            cb(res);
            if (r.body) res._h.data && res._h.data(r.body);
            res._h.end && res._h.end();
            res._h.close && res._h.close();
          }, 0);
        },
      };
    },
  };
}
function load() {
  globalThis.__mobMiss = S;
  const prefix = `
    const __s = globalThis.__mobMiss;
    const fs = __s.fs, path = __s.path, zlib = __s.zlib;
    const https = __s.https, http = __s.https;
    const __dirname = __s.dir;
    const AGENT_VERSION = '4.0.20';
    const eqServerCaps = (k) => ({ catalog: k !== 'p1999' }), eqServerForCharacter = (c) => __s.servers[String(c).toLowerCase()] || 'quarm';
    const _primaryCharacter = () => null;
    let _uploadOpts = __s.uploadOpts;
    const _zealState = __s.zealState;
    const _currentTargetState = () => __s.target;
    const _controlStandDown = () => ({ down: false });
    const console = { log() {}, warn() {} };
  `;
  return evalBlock(prefix + block + '\n' + ctxBlock, [
    '_mobInfoByName', '_mobInfoCacheKey', 'fetchMobInfo', '_mobInfoLast', '_mobMiss', '_mobHasStats', 'MOB_MISS_TEXT',
    'MOB_INFO_TTL_MS', 'MOB_INFO_MISS_TTL_MS', 'MOB_INFO_STALL_MS', '_mobInfoInflight', '_mobTargetCtx', 'mobInfoRetry',
    'mobInfoFeedbackMeta',
  ]);
}
const flush = () => new Promise(r => setTimeout(r, 10));
function seedPack(zone, mobs) {
  const d = path.join(dir, 'mobinfo-cache');
  fs.mkdirSync(d, { recursive: true });
  const body = JSON.stringify({ ok: true, zone_id: zone, mobs });
  fs.writeFileSync(path.join(d, zone + '.json'), body);
  fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify({ [zone]: { etag: '"e"', fetchedAt: Date.now(), visitedAt: Date.now(), bytes: body.length } }));
}
const CIGOSH = { id: 202102, name: 'Guardian Cigosh', level: 60, hp: 24400, ac: 600 };
const kOf = (m, n, z) => m._mobInfoCacheKey(n, z);
const left = (m, hit) => m.MOB_INFO_TTL_MS - (Date.now() - hit.at);   // how long until a reader asks again

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobmiss-'));
  S = {
    fs, path, zlib, dir, requests: [], zealState: {}, servers: {}, target: null,
    uploadOpts: { botUrl: 'https://bot.example/api/agent/encounter', token: 't' },
    respond: () => ({ status: 200, body: JSON.stringify({ ok: true, mob: CIGOSH }) }),
  };
  S.https = fakeHttps();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('why a target has no stats: the reason recorded for each way a lookup ends', () => {
  it('a catalog row: no miss at all', async () => {
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    expect(m._mobMiss(k, m._mobInfoByName.get(k), 'Guardian Cigosh', 202)).toBeNull();
  });

  it('the bot answers with no row: "not in the catalog"', async () => {
    S.respond = () => ({ status: 200, body: '{"ok":true,"mob":null}' });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    const miss = m._mobMiss(k, m._mobInfoByName.get(k), 'Guardian Cigosh', 202);
    expect(miss).toMatchObject({ reason: 'not_in_catalog', text: 'not in the catalog', status: 200, name_asked: 'Guardian Cigosh', zone_id: 202 });
  });

  it.each([
    ['a 503', { status: 503, body: 'upstream unavailable' }, 503, 'HTTP 503'],
    ['a 401', { status: 401, body: '{"error":"bad token"}' }, 401, 'HTTP 401'],
    ['a 200 that is not JSON', { status: 200, body: '<html>proxy</html>' }, 200, 'not JSON'],
    ['a 200 error body', { status: 200, body: '{"error":"db timeout"}' }, 200, 'db timeout'],
  ])('%s: "lookup failed - retrying", with the status and detail on record', async (_l, reply, status, detail) => {
    S.respond = () => reply;
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    expect(m._mobMiss(k, m._mobInfoByName.get(k), 'Guardian Cigosh', 202))
      .toMatchObject({ reason: 'lookup_failed', text: 'lookup failed — retrying', status, detail });
  });

  it('a network error leaves nothing cached, and the overlay is told the lookup failed (not "looking up" for ever)', async () => {
    S.respond = () => ({ error: 'ECONNRESET' });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    expect(m._mobInfoByName.get(k)).toBeUndefined();
    expect(m._mobMiss(k, undefined, 'Guardian Cigosh', 202)).toMatchObject({ reason: 'lookup_failed', detail: 'ECONNRESET' });
  });

  it('before any answer it reads "looking up"', () => {
    S.respond = () => ({ hang: true });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    const k = kOf(m, 'Guardian Cigosh', 202);
    expect(m._mobMiss(k, undefined, 'Guardian Cigosh', 202)).toMatchObject({ reason: 'looking_up' });
  });

  it('an old miss keeps its reason while the next ask is out (no flicker to "looking up" every minute)', async () => {
    S.respond = () => ({ status: 200, body: '{"mob":null}' });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    m._mobInfoByName.get(k).at -= 61 * 1000;
    S.respond = () => ({ hang: true });
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    expect(S.requests).toHaveLength(2);
    expect(m._mobMiss(k, m._mobInfoByName.get(k), 'Guardian Cigosh', 202).reason).toBe('not_in_catalog');
  });

  it('no guild connection (no token): "stats need a guild connection", and nothing is asked or pinned for six hours', () => {
    S.uploadOpts = { botUrl: 'https://bot.example/api/agent/encounter', token: null };
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    const k = kOf(m, 'Guardian Cigosh', 202);
    const hit = m._mobInfoByName.get(k);
    expect(S.requests).toHaveLength(0);
    expect(hit && hit.mob).toBeNull();   // a cached miss, so `loading` is false (it used to say "looking up" for ever)
    expect(left(m, hit)).toBeLessThanOrEqual(m.MOB_INFO_MISS_TTL_MS);
    expect(m._mobMiss(k, hit, 'Guardian Cigosh', 202)).toMatchObject({ reason: 'no_guild', text: 'stats need a guild connection' });
  });

  it('an off-Quarm server: "off-Quarm server", asked of nobody, held a minute not six hours', () => {
    S.servers = { corvale: 'p1999' };
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Corvale', 202);
    const k = kOf(m, 'Guardian Cigosh', 202);
    const hit = m._mobInfoByName.get(k);
    expect(S.requests).toHaveLength(0);
    expect(left(m, hit)).toBeLessThanOrEqual(m.MOB_INFO_MISS_TTL_MS);
    expect(m._mobMiss(k, hit, 'Guardian Cigosh', 202)).toMatchObject({ reason: 'off_quarm', text: 'off-Quarm server' });
  });

  it('the texts the overlay prints are the ones the guild lead can read at a glance', () => {
    const m = load();
    expect(m.MOB_MISS_TEXT).toEqual({
      looking_up: 'looking up…',
      not_in_catalog: 'not in the catalog',
      lookup_failed: 'lookup failed — retrying',
      off_quarm: 'off-Quarm server',
      no_guild: 'stats need a guild connection',
    });
  });
});

describe('a zone-pack entry must be a row to count as a hit', () => {
  it.each([['an empty object', {}], ['a name and nothing else', { name: 'Guardian Cigosh' }], ['null', null]])(
    '%s falls through to the live lookup', async (_l, entry) => {
      seedPack(202, { guardian_Cigosh: entry });
      const m = load();
      m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
      await flush();
      expect(S.requests).toHaveLength(1);
      expect(S.requests[0].path).toMatch(/\/mob-info\?name=Guardian%20Cigosh/);
      expect(m._mobInfoByName.get(kOf(m, 'Guardian Cigosh', 202)).mob.id).toBe(202102);
    });

  it('a real entry is still answered from disk with no request', () => {
    seedPack(202, { guardian_Cigosh: CIGOSH });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    expect(S.requests).toHaveLength(0);
    expect(m._mobInfoByName.get(kOf(m, 'Guardian Cigosh', 202)).mob.level).toBe(60);
  });

  it('an answer carrying an empty mob is a miss, not blank stats', async () => {
    S.respond = () => ({ status: 200, body: '{"ok":true,"mob":{}}' });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    expect(m._mobInfoByName.get(kOf(m, 'Guardian Cigosh', 202)).mob).toBeNull();
    expect(m._mobHasStats({})).toBe(false);
    expect(m._mobHasStats({ level: 60 })).toBe(true);
  });
});

describe('a request that never reports back', () => {
  it('is asked for again once it is past the stall mark, with the reason on record', () => {
    S.respond = () => ({ hang: true });
    const m = load();
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    expect(S.requests).toHaveLength(1);                       // still in flight: not asked twice
    const k = kOf(m, 'Guardian Cigosh', 202);
    m._mobInfoLast.get(k).asking_at -= m.MOB_INFO_STALL_MS + 1000;
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    expect(S.requests).toHaveLength(2);
    expect(m._mobInfoLast.get(k).detail).toBe('stalled');
  });
});

describe('the retry', () => {
  function target(m, over = {}) {
    const st = { target_name: 'Guardian Cigosh', zone: 202, updatedAt: Date.now(), ...over };
    S.zealState.Aldenmar = st;
    S.target = st;
    return st;
  }

  it('forgets that key (and its by-id bodies) and asks the bot again now', async () => {
    S.respond = () => ({ status: 200, body: '{"mob":null}' });
    const m = load();
    target(m);
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const k = kOf(m, 'Guardian Cigosh', 202);
    m._mobInfoByName.set(k + '|n202102', { at: Date.now(), mob: CIGOSH });
    expect(S.requests).toHaveLength(1);

    S.respond = () => ({ status: 200, body: JSON.stringify({ mob: CIGOSH }) });
    expect(m.mobInfoRetry()).toEqual({ ok: true });
    expect(S.requests).toHaveLength(2);                       // inside the minute: only a retry asks
    expect(S.requests[1].path).toMatch(/character=Aldenmar/);
    expect(m._mobInfoByName.has(k + '|n202102')).toBe(false);
    await flush();
    expect(m._mobInfoByName.get(k).mob.id).toBe(202102);
    expect(m._mobMiss(k, m._mobInfoByName.get(k), 'Guardian Cigosh', 202)).toBeNull();
  });

  it('also frees a lookup the agent believed was still out', () => {
    S.respond = () => ({ hang: true });
    const m = load();
    target(m);
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    expect(S.requests).toHaveLength(1);
    m.mobInfoRetry();
    expect(S.requests).toHaveLength(2);
  });

  it('says so when there is no target', () => {
    const m = load();
    expect(m.mobInfoRetry()).toEqual({ ok: false, reason: 'no target' });
  });

  it('is a POST route on the local server, guarded like the rest', () => {
    const code = stripJs(src);
    expect(code).toMatch(/req\.method === 'POST' && req\.url\.split\('\?'\)\[0\] === '\/api\/mob-info\/retry'/);
    expect(code).toContain('mobInfoRetry()');
  });
});

describe('what a feedback report carries about Target Info', () => {
  function setup(m, st) { S.zealState.Aldenmar = st; S.target = st; }

  it('the mob as asked, the zone, the cache state, the last answer, the pack and the connection', async () => {
    S.respond = () => ({ status: 503, body: 'x' });
    const m = load();
    const st = { target_name: 'Guardian Cigosh', zone: 202, updatedAt: Date.now() };
    setup(m, st);
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    const meta = m.mobInfoFeedbackMeta();
    expect(meta).toMatchObject({
      name_asked: 'Guardian Cigosh', name_withheld: null, zone_id: 202, shown: 'lookup_failed',
      cache: { state: 'miss' }, last: { reason: 'lookup_failed', status: 503, detail: 'HTTP 503' },
      in_flight: false, zone_pack: 'no entry', catalog_allowed: true, guild_connection: true,
    });
    expect(meta.cache.reask_in_s).toBeLessThanOrEqual(60);
  });

  it('a hollow pack entry shows as one', () => {
    seedPack(202, { guardian_Cigosh: {} });
    const m = load();
    setup(m, { target_name: 'Guardian Cigosh', zone: 202, updatedAt: Date.now() });
    expect(m.mobInfoFeedbackMeta().zone_pack).toBe('hollow entry');
  });

  it('reads "stats" when there is a row', async () => {
    const m = load();
    setup(m, { target_name: 'Guardian Cigosh', zone: 202, updatedAt: Date.now() });
    m.fetchMobInfo('Guardian Cigosh', 'Aldenmar', 202);
    await flush();
    expect(m.mobInfoFeedbackMeta()).toMatchObject({ shown: 'stats', cache: { state: 'row', mob_id: 202102 } });
  });

  it('withholds a corpse\'s owner and a single-word target with no catalog row (it may be another player)', () => {
    const m = load();
    setup(m, { target_name: "Brackwyn`s corpse", zone: 202, updatedAt: Date.now() });
    expect(m.mobInfoFeedbackMeta()).toMatchObject({ name_asked: null, name_withheld: 'corpse' });
    setup(m, { target_name: 'Brackwyn', zone: 202, updatedAt: Date.now() });
    expect(m.mobInfoFeedbackMeta()).toMatchObject({ name_asked: null, name_withheld: 'single word, may be a player' });
    expect(JSON.stringify(m.mobInfoFeedbackMeta())).not.toContain('Brackwyn');
  });

  it('is null with no target, so a report with none carries nothing extra', () => {
    const m = load();
    expect(m.mobInfoFeedbackMeta()).toBeNull();
  });

  it('records no character name of its own: the asker is a boolean about the server, not a name', () => {
    const m = load();
    setup(m, { target_name: 'Guardian Cigosh', zone: 202, updatedAt: Date.now() });
    expect(JSON.stringify(m.mobInfoFeedbackMeta())).not.toContain('Aldenmar');
  });

  const handler = sliceBlock(src, "if (req.url === '/api/feedback-send' && req.method === 'POST') {",
    '\n      // Mimic pushes Zeal update status here');
  async function send(body, { slice, meta }) {
    const sent = [];
    const res = { writeHead() {}, end(b) { this.body = b; return b; } };
    const run = new Function('req', 'res', '_readBody', '_uploadOpts', 'buildFeedbackLogSlice', 'AGENT_VERSION',
      '_primaryCharacter', 'fetch', 'process', 'mobInfoFeedbackMeta',
      'return (async () => { ' + handler.replace(/\n      \/\/ Mimic pushes Zeal update status here$/, '') + ' })();');
    await run({ url: '/api/feedback-send', method: 'POST' }, res, async () => JSON.stringify(body),
      { botUrl: 'http://bot.test/api/agent/encounter', token: 't' }, () => slice, '4.0.20',
      () => 'Aldenmar', async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; },
      { env: {}, platform: 'win32' }, () => meta);
    return sent[0];
  }
  const META = { name_asked: 'Guardian Cigosh', zone_id: 202, shown: 'not_in_catalog' };
  const SLICE = { ok: true, text: 'line', minutes: 30, lines: 1, removed: 0, bytes: 4, truncated: false, from: 'a', to: 'b', character: 'Aldenmar' };

  it('rides in log_meta WITHOUT the log, so a report that skips the log still says what Target Info did', async () => {
    const p = await send({ category: 'bug', message: 'target info shows no stats' }, { slice: { ok: false }, meta: META });
    expect(p.log_meta).toEqual({ target_info: META });
    expect('log_excerpt' in p).toBe(false);
  });
  it('rides in log_meta beside the log\'s own fields when the log is attached', async () => {
    const p = await send({ category: 'bug', message: 'target info shows no stats', attach_log: true }, { slice: SLICE, meta: META });
    expect(p.log_meta).toMatchObject({ lines: 1, minutes: 30, target_info: META });
    expect(p.log_excerpt).toBe('line');
  });
  it('adds nothing when Target Info has no target', async () => {
    const p = await send({ category: 'idea', message: 'a dark mode please' }, { slice: { ok: false }, meta: null });
    expect('log_meta' in p).toBe(false);
  });
});

describe('the overlay line', () => {
  const missSrc = sliceBlock(html, '  function missNote(mm){', '\n  }\n');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // eslint-disable-next-line no-new-func
  const missNote = new Function('esc', `${missSrc}\nreturn missNote;`)(esc);

  it('prints the reason, with a ↻ button only where asking again can help', () => {
    const line = (reason, text) => missNote({ reason, text });
    expect(line('not_in_catalog', 'not in the catalog')).toContain('no catalog stats · not in the catalog');
    expect(line('not_in_catalog', 'not in the catalog')).toContain('class="mretry"');
    expect(line('lookup_failed', 'lookup failed — retrying')).toContain('class="mretry"');
    expect(line('off_quarm', 'off-Quarm server')).toContain('off-Quarm server');
    expect(line('off_quarm', 'off-Quarm server')).not.toContain('mretry');
    expect(line('no_guild', 'stats need a guild connection')).not.toContain('mretry');
  });
  it('reads "looking up stats" while the first answer is out', () => {
    expect(missNote({ reason: 'looking_up', text: 'looking up…' })).toContain('looking up stats…');
  });
  it('escapes the reason', () => {
    expect(missNote({ reason: 'x', text: '<b>' })).toContain('&lt;b&gt;');
  });

  // The note under a target with no row, run for real over a few agent snapshots.
  const noteSrc = sliceBlock(html, '      var loadingNote = (!mob && mi.loading)', '      // A PLAYER target').replace(/\n      \/\/ A PLAYER target$/, '');
  const noteFor = (mi) => new Function('mob', 'mi', 'corpseOf', 'esc', 'missNote', `${noteSrc}\nreturn loadingNote;`)(null, mi, null, esc, missNote);
  it('shows the reason for a held miss, "looking up" for the first ask, and the reason again when the first ask failed', () => {
    expect(noteFor({ loading: false, mob_miss: { reason: 'not_in_catalog', text: 'not in the catalog' } })).toContain('not in the catalog');
    expect(noteFor({ loading: true, mob_miss: { reason: 'looking_up', text: 'looking up…' } })).toContain('looking up stats');
    expect(noteFor({ loading: true, mob_miss: { reason: 'lookup_failed', text: 'lookup failed — retrying' } })).toContain('lookup failed');
    expect(noteFor({ loading: false })).toContain('no catalog stats for this target');   // an older agent
  });

  const code = stripJs(html);
  it('is wired: the render falls back to the old line only when an older agent sends no reason', () => {
    expect(code).toMatch(/\(mi\.mob_miss \? missNote\(mi\.mob_miss\)\s*: '<div class="sub">no catalog stats for this target<\/div>'\)/);
  });
  it('the ↻ is on the hover-interact handshake (locked overlays are click-through) and posts the retry', () => {
    expect(code).toMatch(/addEventListener\('mouseover'[^\n]*\n[^\n]*closest\('\.mretry'\)[^\n]*overlayHoverInteractive\(true\)/);
    expect(code).toMatch(/addEventListener\('mouseout'[^\n]*\n[^\n]*closest\('\.mretry'\)[^\n]*overlayHoverInteractive\(false\)/);
    expect(code).toContain("var mr = t.closest('.mretry');");
    expect(code).toContain("/api/mob-info/retry', { method: 'POST'");
  });
});
