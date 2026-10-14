// Zone packs for the local mob-info cache (bot side). The guild lead, 2026-09-30: "keep all
// of the PoP mobs cached on a user's machine, as well as zones that the user frequents".
// Runs the real pack section of index.js against a stubbed database and a stubbed
// _buildMobInfo: which names a zone pack holds and under which keys, the hollow-pack guard,
// and the endpoint's 202 / 200 / 304 / gzip / pinned answers.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import zlib from 'zlib';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const src = readSource(BOT_INDEX);
const section = sliceBlock(src, 'const _MOB_PACK_TTL_MS', '\n// GET /api/agent/who-lookup');
const helpers = sliceBlock(src, 'function _normMobName(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobCaseKey(n) {', '\n}') + '\n';

let S;
function load() {
  globalThis.__mobPackTest = S;
  const prefix = `
    const __s = globalThis.__mobPackTest;
    const require = (m) => m === './utils/supabase' ? __s.SB : __s.nodeRequire(m);
    const mimicLink = { requireAgentAuth: async () => ({ user_id: 'u' }) };
    const _buildMobInfo = (...a) => __s.build(...a);
    const factionAssist = { getIndex: async () => __s.index };
    const console = { log() {}, warn() {} };
  `;
  return evalBlock(prefix + helpers + section,
    ['_mobPacks', '_mobPackBuild', '_handleAgentMobPack', '_MOB_PACK_PINNED', '_MOB_PACK_VERSION', '_mobCaseKey']);
}

function fakeRes() {
  return {
    code: null, headers: null, body: null,
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; },
    end(body) { this.body = body; },
  };
}

beforeEach(() => {
  S = {
    nodeRequire,
    npcRows: [
      { name: 'a_grimling_priest' }, { name: 'a_grimling_priest' },   // two bodies, one name
      { name: 'A_grimling_priest' },                                   // same key: first letter folds
      { name: '_' },                                                   // placeholder, skipped
      { name: '#Coirnav_the_Avatar_of_Water' },                        // the # comes off
      { name: 'a_Shissar_acolyte' }, { name: 'A_Shissar_Acolyte' },    // two mobs, two keys
    ],
    kv: [], upserts: [], fail: new Set(), built: [],
    index: {},   // the faction catalog index: truthy = readable, null = a failed read
    SB: {
      isEnabled: () => true,
      select: async (table) => (table === 'eqemu_npc_types' ? S.npcRows : table === 'bot_kv' ? S.kv : []),
      upsert: async (table, rows) => { S.upserts.push({ table, rows }); },
    },
    build: async (_sb, args) => {
      S.built.push(args);
      return S.fail.has(args.caseKey) ? null : { name: args.name.replace(/_/g, ' ') };
    },
  };
});

describe('a zone pack', () => {
  it('holds each case-kept name once, built for that zone', async () => {
    const m = load();
    await m._mobPackBuild(167);
    const pack = m._mobPacks.get(167);
    const mobs = JSON.parse(pack.body).mobs;
    expect(Object.keys(mobs).sort()).toEqual(
      ['a_Shissar_Acolyte', 'a_Shissar_acolyte', 'a_grimling_priest', 'coirnav_the_Avatar_of_Water']);
    expect(S.built.every(a => a.reqZoneId === 167)).toBe(true);
    // The keys are what the agent computes from a Zeal target name.
    expect(m._mobCaseKey('a grimling priest')).toBe('a_grimling_priest');
    expect(m._mobCaseKey('Coirnav the Avatar of Water')).toBe('coirnav_the_Avatar_of_Water');
  });

  it('is saved to bot_kv as the exact string served', async () => {
    const m = load();
    await m._mobPackBuild(167);
    const saved = S.upserts.find(u => u.table === 'bot_kv').rows[0];
    expect(saved.key).toBe('mob_pack:167');
    expect(saved.value.body).toBe(m._mobPacks.get(167).body);
  });

  it('is not saved when most lookups failed (a database hiccup, not an empty zone)', async () => {
    S.npcRows = Array.from({ length: 12 }, (_, i) => ({ name: 'mob_' + i }));
    S.fail = new Set(S.npcRows.slice(0, 8).map(r => r.name));
    const m = load();
    await m._mobPackBuild(209);
    expect(m._mobPacks.has(209)).toBe(false);
    expect(S.upserts).toHaveLength(0);
  });
});

describe('GET /api/agent/mob-pack', () => {
  it('lists the Planes of Power as the pinned zones', async () => {
    const m = load();
    const res = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?pinned=1', headers: {} }, res);
    expect(JSON.parse(res.body).zones).toEqual(m._MOB_PACK_PINNED);
    expect(m._MOB_PACK_PINNED[0]).toBe(200);
    expect(m._MOB_PACK_PINNED[m._MOB_PACK_PINNED.length - 1]).toBe(223);
  });

  it('refuses a missing or silly zone', async () => {
    const m = load();
    for (const q of ['', '?zone=abc', '?zone=0', '?zone=5000']) {
      const res = fakeRes();
      await m._handleAgentMobPack({ url: '/api/agent/mob-pack' + q, headers: {} }, res);
      expect(res.code).toBe(400);
    }
  });

  it('answers 202 for a pack not built yet, and builds it', async () => {
    const m = load();
    const res = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=215', headers: {} }, res);
    expect(res.code).toBe(202);
    for (let i = 0; i < 20 && !m._mobPacks.has(215); i++) await new Promise(r => setTimeout(r, 5));
    expect(m._mobPacks.has(215)).toBe(true);
  });

  it('serves a built pack with its ETag, 304 on a match, gzip when asked', async () => {
    const m = load();
    await m._mobPackBuild(216);
    const etag = m._mobPacks.get(216).etag;

    const plain = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=216', headers: {} }, plain);
    expect(plain.code).toBe(200);
    expect(plain.headers.ETag).toBe(etag);
    expect(JSON.parse(plain.body).zone_id).toBe(216);

    const same = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=216', headers: { 'if-none-match': etag } }, same);
    expect(same.code).toBe(304);
    expect(same.body).toBeUndefined();

    const gz = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=216', headers: { 'accept-encoding': 'gzip, deflate' } }, gz);
    expect(gz.headers['Content-Encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString()).toBe(plain.body);
  });

  it('reads a pack back from bot_kv after a deploy, with the same ETag', async () => {
    const first = load();
    await first._mobPackBuild(217);
    const saved = S.upserts[0].rows[0];
    S.kv = [{ value: saved.value }];
    const fresh = load();                       // a new process: empty memory
    const res = fakeRes();
    await fresh._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=217', headers: {} }, res);
    expect(res.code).toBe(200);
    expect(res.headers.ETag).toBe(first._mobPacks.get(217).etag);
  });
});

// A pack is kept a week, in memory and in bot_kv, so a change to the SHAPE of a mob (the faction
// fields, 2026-10-06) would otherwise reach Mimic a week late. The pack carries the version it
// was built to; any other version is stale and is rebuilt on the next ask for that zone.
describe('a pack built to an older shape', () => {
  const waitFor = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise(r => setTimeout(r, 5)); return fn(); };
  const ask = async (m, zone, headers = {}) => {
    const res = fakeRes();
    await m._handleAgentMobPack({ url: '/api/agent/mob-pack?zone=' + zone, headers }, res);
    return res;
  };
  const stored = (zone, extra = {}) => ({
    built_at: new Date().toISOString(), ...extra,
    body: JSON.stringify({ ok: true, zone_id: zone, built_at: 'old', mobs: { an_old_mob: { name: 'an old mob' } } }),
  });

  it('a bot_kv row from before versions existed is served, then rebuilt to the current shape', async () => {
    S.kv = [{ value: stored(218) }];                       // no version field: the pre-faction build
    const m = load();
    const first = await ask(m, 218);
    expect(first.code).toBe(200);                          // a Mimic is not left with a 202
    expect(Object.keys(JSON.parse(first.body).mobs)).toEqual(['an_old_mob']);
    expect(await waitFor(() => m._mobPacks.get(218).version === m._MOB_PACK_VERSION)).toBe(true);
    expect(S.built.length).toBeGreaterThan(0);
    expect(S.built.every(a => a.reqZoneId === 218)).toBe(true);
    const saved = S.upserts.find(u => u.table === 'bot_kv').rows[0];
    expect(saved.key).toBe('mob_pack:218');
    expect(saved.value.version).toBe(m._MOB_PACK_VERSION);
    const second = await ask(m, 218);                      // the next ask gets the rebuilt body, a new ETag
    expect(second.headers.ETag).not.toBe(first.headers.ETag);
    expect(Object.keys(JSON.parse(second.body).mobs)).not.toContain('an_old_mob');
  });

  it('an in-memory pack of an older version is rebuilt too', async () => {
    const m = load();
    await m._mobPackBuild(219);
    const pack = m._mobPacks.get(219);
    pack.version = m._MOB_PACK_VERSION - 1;
    S.built.length = 0;
    await ask(m, 219);
    expect(await waitFor(() => m._mobPacks.get(219).version === m._MOB_PACK_VERSION)).toBe(true);
    expect(S.built.length).toBeGreaterThan(0);
  });

  it('a pack at the current version, inside its week, is left alone', async () => {
    S.kv = [{ value: stored(220, { version: 5 }) }];
    const m = load();
    expect(m._MOB_PACK_VERSION).toBe(5);   // 5: quest_id on the mob (2026-10-10, FB-72); 4: procs (2026-10-07)
    const res = await ask(m, 220);
    expect(res.code).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(S.built).toHaveLength(0);
    expect(S.upserts).toHaveLength(0);
  });

  it('a pack at the current version but past its week is still rebuilt', async () => {
    S.kv = [{ value: stored(221, { version: 4, built_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() }) }];
    const m = load();
    await ask(m, 221);
    expect(await waitFor(() => S.upserts.length > 0)).toBe(true);
  });

  it('is lazy: loading the handler builds nothing, and one ask queues only that zone', async () => {
    S.kv = [{ value: stored(222) }];
    const m = load();
    await new Promise(r => setTimeout(r, 20));
    expect(S.built).toHaveLength(0);
    await ask(m, 222);
    await waitFor(() => S.upserts.length > 0);
    expect(new Set(S.built.map(a => a.reqZoneId))).toEqual(new Set([222]));
  });

  it('keeps the old pack when the faction catalog cannot be read, and builds nothing', async () => {
    S.kv = [{ value: stored(223) }];
    S.index = null;
    const m = load();
    const res = await ask(m, 223);
    expect(res.code).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(S.built).toHaveLength(0);
    expect(S.upserts).toHaveLength(0);
    expect(m._mobPacks.get(223).version).toBe(1);          // still the pre-faction pack, served
  });
});
