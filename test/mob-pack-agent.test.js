// Mob info kept on the user's machine (agent side). The guild lead, 2026-09-30: "keep all of
// the PoP mobs cached on a user's machine, as well as zones that the user frequents".
// Runs the real mob-info + zone-pack section of the agent against a temp folder and a
// stubbed bot: a target in a cached zone is answered from disk with no request, a pack
// is written and revalidated by ETag, visits and the pinned list drive the fetches, and
// eviction keeps pinned zones while dropping stale or excess visited ones.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const _mobInfoByName  = new Map();', '\n// Target Info F/Q/V: the bot');

let S, dir;
function fakeHttps() {
  return {
    request(opts, cb) {
      S.requests.push(opts);
      const handlers = {};
      return {
        on(ev, fn) { handlers[ev] = fn; return this; },
        destroy() {},
        end() {
          const r = S.respond(opts);
          setTimeout(() => {
            const res = {
              statusCode: r.status, headers: r.headers || {},
              _h: {}, on(ev, fn) { this._h[ev] = fn; return this; },
            };
            cb(res);
            if (r.body) res._h.data && res._h.data(r.body);
            res._h.end && res._h.end();
          }, 0);
        },
      };
    },
  };
}
function load() {
  globalThis.__mobPackAgent = S;
  const prefix = `
    const __s = globalThis.__mobPackAgent;
    const fs = __s.fs, path = __s.path, zlib = __s.zlib;
    const https = __s.https, http = __s.https;
    const __dirname = __s.dir;
    const AGENT_VERSION = '3.7.55';
    let _uploadOpts = __s.uploadOpts;
    const _zealState = __s.zealState;
    const _controlStandDown = () => ({ down: !!__s.down });
    const console = { log() {}, warn() {} };
  `;
  return evalBlock(prefix + block, [
    '_mobInfoByName', '_mobInfoCacheKey', 'fetchMobInfo', '_mobPackLookup', '_mobPackFetch',
    '_mobPackTick', '_mobPackEvict', '_mobPackIdx', 'MOB_PACK_DIR', 'MOB_PACK_UNVISITED_MS', 'MOB_PACK_MAX_BYTES',
  ]);
}
const flush = () => new Promise(r => setTimeout(r, 10));
const packBody = (zone, mobs) => JSON.stringify({ ok: true, zone_id: zone, built_at: '2026-09-30T00:00:00Z', mobs });
function seedPack(zone, mobs, extra = {}) {
  const d = path.join(dir, 'mobinfo-cache');
  fs.mkdirSync(d, { recursive: true });
  const body = packBody(zone, mobs);
  fs.writeFileSync(path.join(d, zone + '.json'), body);
  const idxFile = path.join(d, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
  idx[zone] = Object.assign({ etag: '"e' + zone + '"', fetchedAt: Date.now(), visitedAt: Date.now(), bytes: body.length }, extra);
  fs.writeFileSync(idxFile, JSON.stringify(idx));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobpack-'));
  S = {
    fs, path, zlib, dir, requests: [], zealState: {}, down: false,
    uploadOpts: { botUrl: 'https://bot.example/api/agent/encounter', token: 't' },
    respond: () => ({ status: 404 }),
  };
  S.https = fakeHttps();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('a target in a cached zone', () => {
  it('is answered from disk, with no request to the bot', () => {
    seedPack(215, { coirnav_the_Avatar_of_Water: { name: 'Coirnav the Avatar of Water', level: 80 } });
    const m = load();
    m.fetchMobInfo('Coirnav the Avatar of Water', 'Hitya', 215);
    const hit = m._mobInfoByName.get(m._mobInfoCacheKey('Coirnav the Avatar of Water', 215));
    expect(hit && hit.mob.level).toBe(80);
    expect(S.requests).toHaveLength(0);
  });

  it('works with no bot configured at all', () => {
    seedPack(215, { a_water_mephit: { name: 'a water mephit' } });
    S.uploadOpts = null;
    const m = load();
    m.fetchMobInfo('a water mephit', '', 215);
    expect(m._mobInfoByName.get(m._mobInfoCacheKey('a water mephit', 215)).mob.name).toBe('a water mephit');
  });

  it('still takes the live lookup for a name the pack does not hold, or an unknown zone', () => {
    seedPack(215, { a_water_mephit: { name: 'a water mephit' } });
    const m = load();
    expect(m._mobPackLookup('Carsa`s warder', 215)).toBeNull();
    expect(m._mobPackLookup('a water mephit', null)).toBeNull();
    m.fetchMobInfo('Carsa`s warder', 'Hitya', 215);
    expect(S.requests).toHaveLength(1);
    expect(S.requests[0].path).toMatch(/\/api\/agent\/mob-info\?name=/);
  });
});

describe('fetching a pack', () => {
  it('writes it to disk with its ETag, then revalidates with If-None-Match', async () => {
    const body = packBody(209, { agnarr_the_Storm_Lord: { name: 'Agnarr the Storm Lord' } });
    S.respond = () => ({ status: 200, headers: { etag: '"v1"', 'content-encoding': 'gzip' }, body: zlib.gzipSync(body) });
    const m = load();
    m._mobPackFetch(209);
    await flush();
    expect(S.requests[0].path).toBe('/api/agent/mob-pack?zone=209');
    expect(fs.readFileSync(path.join(m.MOB_PACK_DIR, '209.json'), 'utf8')).toBe(body);
    expect(m._mobPackIdx()['209'].etag).toBe('"v1"');
    expect(m._mobPackLookup('Agnarr the Storm Lord', 209).name).toBe('Agnarr the Storm Lord');

    S.respond = () => ({ status: 304 });
    m._mobPackFetch(209);
    await flush();
    expect(S.requests[1].headers['If-None-Match']).toBe('"v1"');
    expect(m._mobPackLookup('Agnarr the Storm Lord', 209).name).toBe('Agnarr the Storm Lord');
  });

  it('backs off two minutes while the bot builds it (202)', async () => {
    S.respond = () => ({ status: 202, body: Buffer.from('{"ok":true,"building":true}') });
    const m = load();
    m._mobPackFetch(210);
    await flush();
    const e = m._mobPackIdx()['210'];
    expect(e.bytes || 0).toBe(0);
    expect(e.retryAt - Date.now()).toBeGreaterThan(90 * 1000);
    expect(e.retryAt - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000);
  });
});

describe('the background tick', () => {
  it('fetches the zone a character stands in, and the pinned list', async () => {
    S.zealState = { Hitya: { zone: 167 } };
    S.respond = (opts) => opts.path.endsWith('pinned=1')
      ? { status: 200, body: Buffer.from('{"ok":true,"zones":[200,201]}') }
      : { status: 202 };
    const m = load();
    m._mobPackTick();
    await flush();
    const paths = S.requests.map(r => r.path);
    expect(paths).toContain('/api/agent/mob-pack?zone=167');
    expect(paths).toContain('/api/agent/mob-pack?pinned=1');
    expect(m._mobPackIdx()['167'].visitedAt).toBeGreaterThan(0);
    // Next tick: the first pinned zone is due and gets fetched.
    m._mobPackTick();
    await flush();
    expect(S.requests.map(r => r.path)).toContain('/api/agent/mob-pack?zone=200');
    expect(m._mobPackIdx()['200'].pinned).toBe(true);
  });

  it('does nothing while the guild control plane has the fleet paused', () => {
    S.zealState = { Hitya: { zone: 167 } };
    S.down = true;
    const m = load();
    m._mobPackTick();
    expect(S.requests).toHaveLength(0);
  });
});

describe('eviction', () => {
  it('keeps pinned zones, drops a zone unvisited for 90 days, then the oldest past the size cap', () => {
    const m0 = load();
    const now = Date.now();
    const old = now - m0.MOB_PACK_UNVISITED_MS - 1000;
    seedPack(200, { a: {} }, { pinned: true, visitedAt: old });
    seedPack(96, { b: {} }, { visitedAt: old });
    seedPack(167, { c: {} }, { visitedAt: now - 1000, bytes: m0.MOB_PACK_MAX_BYTES });
    seedPack(168, { d: {} }, { visitedAt: now, bytes: 10 });
    const m = load();
    m._mobPackEvict(now);
    const idx = m._mobPackIdx();
    expect(Object.keys(idx).sort()).toEqual(['168', '200']);
    expect(fs.existsSync(path.join(m.MOB_PACK_DIR, '96.json'))).toBe(false);
    expect(fs.existsSync(path.join(m.MOB_PACK_DIR, '167.json'))).toBe(false);
    expect(fs.existsSync(path.join(m.MOB_PACK_DIR, '200.json'))).toBe(true);
  });
});
