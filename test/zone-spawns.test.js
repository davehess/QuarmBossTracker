// GET /api/agent/zone-spawns — the bot's feed for the Mimic 2.9 spawn map (utils/zoneSpawns.js + the
// route in index.js). The guild lead, 2026-10-10 (docs/DESIGN-mimic-2.9-spawn-map.md, DECISIONS §216).
//
// Runs the SHIPPED module against test/_cap_fake_supabase.js (a fake that enforces PostgREST's 1,000-row
// cap) wrapped to honour `select=` the way PostgREST does, so a read that asked for `brewall` (or `*`)
// would hand it back and the "never leaves" assertion would fail. The route itself is sliced out of
// index.js and run against stand-ins for auth and the database.
//
// Mutation-checked (2026-10-12): MAP_SELECT widened to `*` / `bands,segs,bounds,brewall` turns the brewall
// tests red; the named rule's raid_target, board-name, `< 50` and article clauses each turn it red.
//
// Fixture NPC names are the catalog's own or invented; none is a member.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const nodeRequire = createRequire(BOT_INDEX);
const zs = nodeRequire('./utils/zoneSpawns');
const SRC = readSource(BOT_INDEX);

const BREWALL_MARK = 'THIRD-PARTY-ART-DO-NOT-SERVE';
const BOSSES = [{ id: 'magi_rokyl', name: 'Magi Rokyl', nicknames: ['magi'] }];

// PostgREST projects `select=a,b`; the shared fake returns whole rows, so do it here.
function withProjection(fake) {
  const inner = fake.select;
  fake.select = async (table, qs = '') => {
    const rows = await inner(table, qs);
    const m = /(?:^|&)select=([^&]+)/.exec(qs);
    if (!Array.isArray(rows) || !m || m[1] === '*') return rows;
    const cols = decodeURIComponent(m[1]).split(',');
    return rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
  };
  return fake;
}

const npc = (id, name, extra = {}) => ({
  id, name, level: 50, raid_target: false, see_invis: false, see_invis_undead: false, see_hide: false,
  see_improved_hide: false, special_abilities: null, npcspecialattks: null, ...extra,
});
const sp = (id, group, extra = {}) => ({
  id, spawngroup_id: group, zone_short: 'testzone', x: id * 10, y: -id * 10, z: 5.5,
  respawntime: 600, variance: 30, enabled: true, ...extra,
});
const se = (group, npc_id, chance = 100) => ({ spawngroup_id: group, npc_id, chance });

function world() {
  return {
    eqemu_zone: [{ short_name: 'testzone', long_name: 'The Test Zone' }, { short_name: 'emptyzone', long_name: 'Empty' }],
    eqemu_spawn2: [
      sp(1, 10), sp(2, 11), sp(3, 12), sp(4, 13), sp(5, 14), sp(6, 15),
      sp(7, 16, { respawntime: 1_700_000 }),
      sp(8, 10, { enabled: false }),                          // disabled: not a point
      sp(9, 10, { zone_short: 'otherzone' }),                 // another zone
      sp(10, 99),                                             // a group nobody spawns from
      sp(11, 17), sp(12, 18), sp(13, 19), sp(14, 20),
    ],
    eqemu_spawnentry: [
      se(10, 1001),
      se(11, 1002, 70), se(11, 1003, 20), se(11, 1004, 10),
      se(12, 1005),
      se(13, 1006),
      se(14, 1007, 10),                                       // low chance, but alone in its group
      se(15, 1008, 50), se(15, 1009, 50),                     // exactly 50: not low
      se(16, 1010),
      se(17, 1011), se(18, 1012), se(19, 1013), se(20, 1014),
    ],
    eqemu_npc_types: [
      npc(1001, 'a_gnoll_pup', { level: 5 }),
      npc(1002, 'a_decaying_skeleton'), npc(1003, 'Bonecrusher_Rax'), npc(1004, 'an_old_ghoul'),
      npc(1005, 'Lord_Rax', { raid_target: true }),
      npc(1006, '#Magi_Rokyl'),
      npc(1007, 'Fippy_Darkpaw'),
      npc(1008, 'a_pack_wolf'), npc(1009, 'Grimfang'),
      npc(1010, 'Zone_Event_Mob'),
      npc(1011, 'Both_Eyes', { see_invis: true, see_invis_undead: true, see_hide: true }),
      npc(1012, 'Undead_Eyes', { see_invis_undead: true }),
      npc(1013, 'Sharp_Eyes', { see_improved_hide: true }),
      npc(1014, 'Nasty_One', { special_abilities: '1,1^31,1^3,1^50,1^24,1' }),
    ],
    zone_map_lines: [{
      zone_short: 'testzone', bands: [-10, 0, 10], segs: [[0, 0, 5, 5, 1]], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      brewall: { note: BREWALL_MARK }, generated_at: '2026-10-10T00:00:00Z', source: 'EQEmu/maps (GPLv2+)',
    }],
  };
}

let fake;
let tables;
beforeEach(() => {
  zs._resetCache();
  tables = world();
  fake = withProjection(makeCapFake({ tables }));
});

const get = async (zone = 'testzone', now) => zs.getZoneSpawns(fake, zone, BOSSES, now);
const body = async (zone) => JSON.parse((await get(zone)).body);
const pointFor = (b, id) => b.points.find(p => p.id === id);
const npcNamed = (b, name) => b.points.flatMap(p => p.npcs).find(n => n.name === name);

describe('the response shape', () => {
  it('is the contract: zone, long_name, generated_at, points, map', async () => {
    const b = await body();
    expect(Object.keys(b)).toEqual(['zone', 'long_name', 'generated_at', 'points', 'map']);
    expect(b.zone).toBe('testzone');
    expect(b.long_name).toBe('The Test Zone');
    expect(Date.parse(b.generated_at)).toBeGreaterThan(0);
    expect(Object.keys(b.points[0])).toEqual(['id', 'x', 'y', 'z', 'respawn_s', 'variance_s', 'npcs']);
    expect(Object.keys(b.points[0].npcs[0])).toEqual(['name', 'level', 'chance', 'named', 'raid_target', 'badges']);
  });

  it('keeps the server frame (spawn2 x/y as stored) and only enabled points of THIS zone', async () => {
    const b = await body();
    expect(pointFor(b, 1)).toMatchObject({ x: 10, y: -10, z: 5.5, respawn_s: 600, variance_s: 30 });
    const ids = b.points.map(p => p.id);
    expect(ids).not.toContain(8);   // disabled
    expect(ids).not.toContain(9);   // other zone
    expect(ids).not.toContain(10);  // nobody spawns there
    expect(ids).toEqual([...ids].sort((a, c) => a - c));
  });

  it('cleans names: underscores to spaces, no leading #', async () => {
    const b = await body();
    expect(npcNamed(b, 'a gnoll pup')).toBeTruthy();
    expect(npcNamed(b, 'Magi Rokyl')).toBeTruthy();
    expect(b.points.flatMap(p => p.npcs).map(n => n.name).join('|')).not.toMatch(/[_#]/);
  });

  it('lists a group by chance, highest first', async () => {
    const b = await body();
    expect(pointFor(b, 2).npcs.map(n => n.chance)).toEqual([70, 20, 10]);
  });
});

describe('named', () => {
  it('raid_target is named', async () => {
    const n = npcNamed(await body(), 'Lord Rax');
    expect(n).toMatchObject({ named: true, raid_target: true });
  });

  it('a board boss (data/bosses.json) is named by name, # and underscores aside', async () => {
    expect(npcNamed(await body(), 'Magi Rokyl').named).toBe(true);
  });

  it('the odd one out of a multi-NPC group is named: low chance, not an article', async () => {
    const b = await body();
    expect(npcNamed(b, 'Bonecrusher Rax').named).toBe(true);
    expect(npcNamed(b, 'an old ghoul').named).toBe(false);          // low chance, but "an ..."
    expect(npcNamed(b, 'a decaying skeleton').named).toBe(false);   // the common one
  });

  it('a low chance alone in its group, or exactly 50, is not named', async () => {
    const b = await body();
    expect(npcNamed(b, 'Fippy Darkpaw').named).toBe(false);
    expect(npcNamed(b, 'Grimfang').named).toBe(false);
  });

  it('a plain mob is not named, and raid_target is false', async () => {
    expect(npcNamed(await body(), 'a gnoll pup')).toMatchObject({ named: false, raid_target: false });
  });

  it('the rule, directly: each clause alone', () => {
    const base = { npc: { raid_target: false }, name: 'Rax', chance: 10, groupSize: 2, bossNames: new Set() };
    expect(zs.isNamed(base)).toBe(true);
    expect(zs.isNamed({ ...base, npc: { raid_target: true }, groupSize: 1, chance: 100 })).toBe(true);
    expect(zs.isNamed({ ...base, groupSize: 1, bossNames: new Set(['rax']) })).toBe(true);
    expect(zs.isNamed({ ...base, groupSize: 1 })).toBe(false);
    expect(zs.isNamed({ ...base, chance: 50 })).toBe(false);
    expect(zs.isNamed({ ...base, chance: 49 })).toBe(true);
    for (const art of ['a rat', 'An owl', 'the Hand']) expect(zs.isNamed({ ...base, name: art })).toBe(false);
  });
});

describe('badges', () => {
  it('eye for see_invis (and not eye_undead beside it), hood for see_hide', async () => {
    expect(npcNamed(await body(), 'Both Eyes').badges).toEqual(['eye', 'hood']);
  });

  it('eye_undead only when see_invis_undead is the only sight', async () => {
    expect(npcNamed(await body(), 'Undead Eyes').badges).toEqual(['eye_undead']);
  });

  it('hood for see_improved_hide too', async () => {
    expect(npcNamed(await body(), 'Sharp Eyes').badges).toEqual(['hood']);
  });

  it('decodes specials through mobSpecials, lowercase-slugged; hidden codes stay hidden', async () => {
    // 1 Summon · 31 Immune Pacify · 3 Rampage · 50 Reverse Slow · 24 (Will Not Aggro: not shown)
    expect(npcNamed(await body(), 'Nasty One').badges).toEqual(['summon', 'immune_pacify', 'rampage', 'reverse_slow']);
  });

  it('a mob with nothing special has none', async () => {
    expect(npcNamed(await body(), 'a gnoll pup').badges).toEqual([]);
  });

  it('slug keeps the name of a label that carries an explanation', () => {
    expect(zs.slug('Reverse Slow — slowing hastes it')).toBe('reverse_slow');
    expect(zs.slug('Immune Melee Except Bane')).toBe('immune_melee_except_bane');
  });
});

describe('the instance sentinel respawn', () => {
  it('keeps the point and nulls respawn_s', async () => {
    const p = pointFor(await body(), 7);
    expect(p).toBeTruthy();
    expect(p.respawn_s).toBeNull();
    expect(p.variance_s).toBe(30);
    expect(zs.INSTANCE_SENTINEL_S).toBe(1_700_000);
  });
});

describe('the map layer', () => {
  it('asks for bands, segs and bounds and nothing else — never brewall, never *', async () => {
    await get();
    const q = fake.calls.filter(c => c.table === 'zone_map_lines').map(c => c.qs);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatch(/(^|&)select=bands,segs,bounds(&|$)/);
    expect(q[0]).not.toMatch(/brewall|select=\*/i);
    expect(zs.MAP_SELECT).toBe('bands,segs,bounds');
  });

  it('brewall is not in the answer even though the row holds it', async () => {
    const r = await get();
    expect(tables.zone_map_lines[0].brewall.note).toBe(BREWALL_MARK);   // the fixture does carry it
    expect(r.body).not.toContain(BREWALL_MARK);
    expect(r.body).not.toMatch(/brewall/i);
    expect(JSON.parse(r.body).map).toEqual({ bands: [-10, 0, 10], segs: [[0, 0, 5, 5, 1]], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } });
  });

  it('no cached row means map: null, and nothing is computed', async () => {
    tables.zone_map_lines = [];
    expect((await body()).map).toBeNull();
  });

  it('no module in utils/ other than this one names the column (source check, comments stripped)', () => {
    const fs = nodeRequire('fs');
    const code = stripJs(fs.readFileSync(nodeRequire.resolve('./utils/zoneSpawns.js'), 'utf8'));
    expect(code).not.toMatch(/brewall/i);
  });
});

describe('every read is bounded', () => {
  // 1,200 points, one group and one NPC each: past PostgREST's cap on spawn2, and past one chunk on the other two.
  const N = 1200;
  beforeEach(() => {
    tables.eqemu_spawn2 = Array.from({ length: N }, (_, i) => sp(i + 1, 100000 + i));
    tables.eqemu_spawnentry = Array.from({ length: N }, (_, i) => se(100000 + i, 200000 + i));
    tables.eqemu_npc_types = Array.from({ length: N }, (_, i) => npc(200000 + i, `Mob_${i}`));
  });

  it('returns every point of a zone bigger than the cap', async () => {
    const b = await body();
    expect(b.points).toHaveLength(N);
    expect(new Set(b.points.map(p => p.id)).size).toBe(N);
    expect(b.points.every(p => p.npcs.length === 1)).toBe(true);
  });

  it('pages spawn2 in order with an offset, and chunks the id lists', async () => {
    await get();
    const reads = (t) => fake.calls.filter(c => c.kind === 'select' && c.table === t).map(c => c.qs);
    const s2 = reads('eqemu_spawn2');
    expect(s2.length).toBe(Math.ceil(N / 1000));
    for (const q of s2) expect(q).toMatch(/&order=id\.asc&limit=1000&offset=\d+$/);
    for (const t of ['eqemu_spawnentry', 'eqemu_npc_types']) {
      const qs = reads(t);
      expect(qs.length).toBe(Math.ceil(N / 100));
      for (const q of qs) {
        expect(q).toMatch(/limit=\d+/);
        expect(Number(/limit=(\d+)/.exec(q)[1])).toBeLessThanOrEqual(1000);
        const list = /in\.\(([^)]*)\)/.exec(q)[1].split(',');
        expect(list.length).toBeLessThanOrEqual(100);
      }
    }
    for (const q of reads('eqemu_spawnentry')) expect(q).toMatch(/&order=spawngroup_id\.asc,npc_id\.asc&limit=1000&offset=0$/);
    for (const t of ['eqemu_zone', 'zone_map_lines']) {
      for (const q of reads(t)) expect(q).toMatch(/&limit=1$/);
    }
  });
});

describe('zones, errors and the cache', () => {
  it('rejects a malformed zone with 400 without touching the database', async () => {
    for (const z of ['', '../etc', 'a b', 'x'.repeat(40), 'UPPER;drop', null]) {
      expect((await get(z)).status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it('400 for a zone the catalog does not know; 404 for a zone with no points', async () => {
    expect((await get('nosuchzone')).status).toBe(400);
    expect((await get('emptyzone')).status).toBe(404);
  });

  it('a failed read is a 503 and is not cached (a null is not an empty table)', async () => {
    let failing = true;
    const real = fake.select;
    fake.select = async (t, q) => (failing && t === 'eqemu_npc_types' ? null : real(t, q));
    expect((await get()).status).toBe(503);
    failing = false;
    expect((await get()).status).toBe(200);
  });

  it('serves a repeat from memory for 6 h, then rebuilds', async () => {
    let t = 1_000_000;
    const now = () => t;
    await get('testzone', now);
    const n = fake.calls.length;
    await get('testzone', now);
    expect(fake.calls.length).toBe(n);
    t += 6 * 3600_000 - 1;
    await get('testzone', now);
    expect(fake.calls.length).toBe(n);
    t += 2;
    await get('testzone', now);
    expect(fake.calls.length).toBeGreaterThan(n);
  });

  it('answers a fleet zoning in together with one build', async () => {
    await Promise.all([get(), get(), get()]);
    expect(fake.calls.filter(c => c.table === 'eqemu_zone')).toHaveLength(1);
  });

  it('the ETag is weak, follows the content, and survives a rebuild of unchanged data', async () => {
    let t = 1_000_000;
    const a = await get('testzone', () => t);
    expect(a.etag).toMatch(/^W\/"[0-9a-f]{20}"$/);
    t += 7 * 3600_000;
    await new Promise(r => setTimeout(r, 5));       // a different generated_at
    const b = await get('testzone', () => t);
    expect(b.body).not.toBe(a.body);                // rebuilt (generated_at moved)…
    expect(b.etag).toBe(a.etag);                    // …same content, same validator
    tables.eqemu_spawn2[0].x = 12345;
    t += 7 * 3600_000;
    expect((await get('testzone', () => t)).etag).not.toBe(a.etag);
  });

  it('etagMatches reads a list, weak or strong, and *', () => {
    expect(zs.etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
    expect(zs.etagMatches('"abc"', 'W/"abc"')).toBe(true);
    expect(zs.etagMatches('"x", W/"abc"', 'W/"abc"')).toBe(true);
    expect(zs.etagMatches('*', 'W/"abc"')).toBe(true);
    expect(zs.etagMatches('W/"other"', 'W/"abc"')).toBe(false);
    expect(zs.etagMatches('', 'W/"abc"')).toBe(false);
    expect(zs.etagMatches(undefined, 'W/"abc"')).toBe(false);
  });
});

describe('the route (real _handleAgentZoneSpawns from index.js)', () => {
  const block = sliceBlock(SRC, 'async function _handleAgentZoneSpawns(req, res) {', '\n}\n');
  let authed, enabled;
  function load() {
    globalThis.__zsTest = { zs, fake: Object.assign(fake, { isEnabled: () => enabled }), authed: () => authed, bosses: BOSSES };
    // eslint-disable-next-line no-new-func
    return new Function(`
      const __t = globalThis.__zsTest;
      const mimicLink = { requireAgentAuth: async (req, res) => { if (!__t.authed()) { res.writeHead(401); res.end('{}'); return null; } return { user_id: 'u' }; } };
      const getBosses = () => __t.bosses;
      const require = (m) => m === './utils/zoneSpawns' ? __t.zs : m === './utils/supabase' ? __t.fake : null;
      ${block}
      return _handleAgentZoneSpawns;
    `)();
  }
  const mkRes = () => ({
    code: null, headers: null, body: null,
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b; },
  });
  const call = async (url, headers = {}) => { const res = mkRes(); await load()({ url, headers }, res); return res; };
  beforeEach(() => { authed = true; enabled = true; });

  it('200 with the JSON, an ETag, and a cache lifetime', async () => {
    const res = await call('/api/agent/zone-spawns?zone=testzone');
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['ETag']).toMatch(/^W\//);
    expect(res.headers['Cache-Control']).toBe('max-age=21600');
    expect(JSON.parse(res.body).points.length).toBeGreaterThan(5);
  });

  it('304 and no body on a matching If-None-Match', async () => {
    const first = await call('/api/agent/zone-spawns?zone=testzone');
    const res = await call('/api/agent/zone-spawns?zone=testzone', { 'if-none-match': first.headers['ETag'] });
    expect(res.code).toBe(304);
    expect(res.body).toBeUndefined();
    expect(res.headers['ETag']).toBe(first.headers['ETag']);
    const miss = await call('/api/agent/zone-spawns?zone=testzone', { 'if-none-match': 'W/"stale"' });
    expect(miss.code).toBe(200);
  });

  it('gzips when asked, and the gzip is the same document', async () => {
    const res = await call('/api/agent/zone-spawns?zone=testzone', { 'accept-encoding': 'gzip, deflate' });
    expect(res.headers['Content-Encoding']).toBe('gzip');
    const plain = await call('/api/agent/zone-spawns?zone=testzone');
    expect(nodeRequire('zlib').gunzipSync(res.body).toString()).toBe(plain.body);
  });

  it('400 on a bad or unknown zone, 404 on an empty one, 503 when the database is off', async () => {
    expect((await call('/api/agent/zone-spawns')).code).toBe(400);
    expect((await call('/api/agent/zone-spawns?zone=nosuchzone')).code).toBe(400);
    expect((await call('/api/agent/zone-spawns?zone=emptyzone')).code).toBe(404);
    enabled = false;
    expect((await call('/api/agent/zone-spawns?zone=testzone')).code).toBe(503);
  });

  it('stops at the bearer check', async () => {
    authed = false;
    const res = await call('/api/agent/zone-spawns?zone=testzone');
    expect(res.code).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('the budget', () => {
  const code = stripJs(SRC);

  it('zone_spawns is a 30/min GET kind, not durable', () => {
    const budgets = sliceBlock(code, 'const _BUDGET_DEFAULTS = {', '\n};');
    // eslint-disable-next-line no-new-func
    const defaults = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();
    expect(defaults.zone_spawns).toEqual({ perMin: 30, durable: false, get: true });
  });

  it('the route runs _overBudget first, and a read is not sheddable (mirrors mob-info / who-lookup)', () => {
    const route = sliceBlock(code, "req.url.startsWith('/api/agent/zone-spawns')", '_handleAgentZoneSpawns(req, res)');
    expect(route).toMatch(/_overBudget\('zone_spawns', req, res\)/);
    const shed = sliceBlock(code, 'const _SHED_KINDS = new Set([', ']);');
    expect(shed).not.toMatch(/zone_spawns/);
  });
});
