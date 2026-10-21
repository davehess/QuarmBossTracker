// test/local-sync.test.js — GET /api/agent/local-sync, the hub half of a player's local copy of the guild's parses.
//
// utils/localSync.js runs for real against an in-memory stand-in for the supabase client that understands the
// handful of filters it sends (keyset `or`, `lt`, `in`, loot time ranges, order, limit). The route handler, the shed
// gate and the budget table are sliced out of the real index.js and run. Source assertions use comment-stripped text.
//
// Names in fixtures are invented (Aldenmar, Brackwyn, Corvale ...).
// Run: npx vitest run test/local-sync.test.js

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const ls = require_('../utils/localSync.js');
const rw = require_('../utils/raidReplayWindow.js');

const NOW = Date.parse('2026-10-21T20:00:00Z');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
// PostgREST prints microseconds and a +00:00 offset; the cursor must carry exactly that.
const pg = (ms, micro = '000') => iso(ms).replace('Z', `${micro}+00:00`).replace(/\.(\d{3})(\d{3})/, '.$1$2');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G = 'wolfpack';

const CHARS = [
  { guild_id: G, name: 'Aldenmar', class: 'Cleric', exclude_from_stats: false, exclude_inventory: true },
  { guild_id: G, name: 'Brackwyn', class: 'Cleric', exclude_from_stats: true, exclude_inventory: false },
  { guild_id: G, name: 'Corvale', class: 'Warrior', exclude_from_stats: false, exclude_inventory: false },
  { guild_id: G, name: 'Dunmere', class: 'Wizard', exclude_from_stats: false, exclude_inventory: false },
];

// ── an in-memory supabase ──────────────────────────────────────────────────────
function parseOr(v) {
  // (col.gt.T,and(col.eq.T,id.gt.I))
  const m = /^\((\w+)\.gt\.([^,]+),and\(\1\.eq\.([^,]+),id\.gt\.([^)]+)\)\)$/.exec(v);
  if (m) return { kind: 'keyset', col: m[1], ts: m[2], id: m[4] };
  const ranges = [...v.matchAll(/and\(looted_at\.gte\.([^,]+),looted_at\.lte\.([^)]+)\)/g)].map(r => [Date.parse(r[1]), Date.parse(r[2])]);
  return ranges.length ? { kind: 'ranges', ranges } : { kind: 'none' };   // the opt-out `or` is applied by selectAllPaged below
}
const tcmp = (a, b) => Date.parse(a) - Date.parse(b);
function fakeSupabase(tables) {
  const log = [];
  const run = (table, qs) => {
    log.push({ table, qs });
    if (tables.__fail?.includes(table)) return null;
    const p = new URLSearchParams(qs);
    let rows = (tables[table] || []).filter(r => r.guild_id === undefined || !p.get('guild_id') || `eq.${r.guild_id}` === p.get('guild_id'));
    const lt = p.get('updated_at') || p.get('deleted_at');
    if (lt && lt.startsWith('lt.')) { const col = p.has('updated_at') ? 'updated_at' : 'deleted_at'; rows = rows.filter(r => tcmp(r[col], lt.slice(3)) < 0); }
    if (p.get('or')) {
      const o = parseOr(p.get('or'));
      if (o.kind === 'keyset') rows = rows.filter(r => tcmp(r[o.col], o.ts) > 0 || (tcmp(r[o.col], o.ts) === 0 && r.id > o.id));
      else if (o.kind === 'ranges') rows = rows.filter(r => o.ranges.some(([a, b]) => Date.parse(r.looted_at) >= a && Date.parse(r.looted_at) <= b));
    }
    const inM = /^in\.\((.*)\)$/.exec(p.get('encounter_id') || '');
    if (inM) rows = rows.filter(r => inM[1].split(',').includes(r.encounter_id));
    const order = p.get('order');
    if (order === 'updated_at.asc,id.asc') rows.sort((a, b) => tcmp(a.updated_at, b.updated_at) || (a.id < b.id ? -1 : 1));
    if (order === 'deleted_at.asc,id.asc') rows.sort((a, b) => tcmp(a.deleted_at, b.deleted_at) || (a.id < b.id ? -1 : 1));
    const lim = Number(p.get('limit'));
    const off = Number(p.get('offset') || 0);
    if (lim) rows = rows.slice(off, off + lim);
    return rows.map(r => ({ ...r }));
  };
  return {
    log, isEnabled: () => true, guildId: () => G,
    async select(table, qs) { return run(table, qs); },
    async selectAllPaged(table, base, orderCol) {
      if (table === 'characters') {
        const rows = run(table, base);
        return base.includes('exclude_from_stats') ? rows && rows.filter(r => r.exclude_from_stats || r.exclude_inventory) : rows;
      }
      const out = [];
      for (let off = 0; ; off += 1000) {
        const page = run(table, `${base}&order=${orderCol}&limit=1000&offset=${off}`);
        if (!Array.isArray(page)) return null;
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
  };
}

const T0 = Date.parse('2026-10-20T01:00:00Z');
function enc(n, over = {}) {
  return {
    id: uid(n), guild_id: G, npc_id: 100 + n,
    started_at: iso(T0 + n * 10 * MIN), ended_at: iso(T0 + n * 10 * MIN + 2 * MIN), duration_sec: 120,
    zone_short: 'potranquility', total_damage: 5000 + n, total_dps: 40, classification: null,
    data_incomplete: false, updated_at: pg(T0 + n * 10 * MIN + 2 * MIN, '000'),
    // columns that must never leave
    uploaded_by_discord_id: 'u-secret', discord_msg_link: 'https://discord.com/x', classification_reason: 'officer note',
    classification_by: 'officer', data_incomplete_by: 'officer', raid_night_id: uid(900),
    eqemu_npc_types: { name: `Lord_Aldwyn_${n}` },
    ...over,
  };
}
const player = (encId, name, damage, rank, over = {}) => ({
  encounter_id: encId, character_name: name, total_damage: damage, dps: Math.round(damage / 100), duration_sec: 120,
  has_pets: false, rank, source_contribution_id: uid(777), ...over,
});

function world(over = {}) {
  const e1 = enc(1), e2 = enc(2), e3 = enc(3);
  return {
    characters: CHARS,
    encounters: [e1, e2, e3],
    encounter_players: [
      player(e1.id, 'Corvale', 3000, 1), player(e1.id, 'Aldenmar', 2000, 2), player(e1.id, 'Brackwyn`s pet', 500, 4), player(e1.id, 'Brackwyn', 1500, 3),
      player(e2.id, 'Dunmere', 900, 1), player(e2.id, 'Leaver', 100, 2),
      player(e3.id, 'Corvale', 10, 1),
    ],
    looted_items: [
      { id: 1, guild_id: G, looter_character: 'Corvale', item_name: 'Cloak of Tests', looted_at: iso(T0 + 10 * MIN + 5 * MIN), uploaded_by_discord_id: 'u-secret', source: 'local_agent_v1', from_own_pet: false },
      { id: 2, guild_id: G, looter_character: 'Aldenmar', item_name: 'Ring of Tests', looted_at: iso(T0 + 10 * MIN + 6 * MIN), uploaded_by_discord_id: 'u-secret', source: 'local_agent_v1', from_own_pet: true },
      { id: 3, guild_id: G, looter_character: 'Dunmere', item_name: 'Out of window', looted_at: iso(T0 + 5 * 3600_000), uploaded_by_discord_id: 'u-secret', source: 'local_agent_v1', from_own_pet: false },
    ],
    encounter_tombstones: [],
    ...over,
  };
}

const get = async (sb, q = {}, now = NOW) => {
  const r = await ls.serve(sb, q, now);
  return r.status === 200 ? { status: 200, body: r.body, text: JSON.stringify(r.body) } : r;
};

beforeEach(() => { rw._reset(); ls._reset(); });

// ── 1. keyset paging ──────────────────────────────────────────────────────────
describe('keyset paging', () => {
  it('returns changed encounters oldest change first, then nothing new once the cursor is held', async () => {
    const sb = fakeSupabase(world());
    const a = await get(sb, { limit: '200' });
    expect(a.status).toBe(200);
    expect(a.body.encounters.map(e => e.id)).toEqual([uid(1), uid(2), uid(3)]);
    expect(a.body.more).toBe(false);
    const b = await get(sb, { since: a.body.cursor });
    expect(b.body.encounters).toEqual([]);
    expect(b.body.cursor).toBe(a.body.cursor);
  });

  it('pages by limit without skipping or repeating, including rows that share one updated_at', async () => {
    const same = pg(T0 + 60 * MIN, '123');
    const rows = [5, 3, 4, 2, 1].map(n => enc(n, { updated_at: n >= 3 ? same : pg(T0 + n * MIN) }));
    const sb = fakeSupabase(world({ encounters: rows, encounter_players: [], looted_items: [] }));
    const seen = [];
    let since = '';
    for (let i = 0; i < 10; i++) {
      const r = await get(sb, { since, limit: '2' });
      seen.push(...r.body.encounters.map(e => e.id));
      since = r.body.cursor;
      if (!r.body.more) break;
    }
    expect(seen).toEqual([uid(1), uid(2), uid(3), uid(4), uid(5)]);
  });

  it('a changed encounter comes back whole, in its new position', async () => {
    const w = world();
    const sb = fakeSupabase(w);
    const first = await get(sb);
    w.encounters[0].updated_at = pg(NOW - 60_000);   // fight 1 was merged again a minute ago
    w.encounter_players.push(player(uid(1), 'Dunmere', 50, 5));
    const next = await get(sb, { since: first.body.cursor });
    expect(next.body.encounters.map(e => e.id)).toEqual([uid(1)]);
    expect(next.body.encounters[0].players.map(p => p.name)).toContain('Dunmere');
  });

  it('the cursor carries the database timestamp verbatim (microseconds, +00:00), not a rounded Date', async () => {
    const sb = fakeSupabase(world({ encounters: [enc(1, { updated_at: pg(T0, '456') })], encounter_players: [], looted_items: [] }));
    const r = await get(sb);
    const raw = JSON.parse(Buffer.from(r.body.cursor.slice(3), 'base64url').toString('utf8'));
    expect(raw.u).toBe(pg(T0, '456'));
    expect(raw.u).toMatch(/\.\d{6}\+00:00$/);
    expect(raw.i).toBe(uid(1));
  });

  it('serves nothing newer than the 5-second commit lag', async () => {
    const fresh = enc(1, { updated_at: pg(NOW - 2_000) });
    const old = enc(2, { updated_at: pg(NOW - 60_000) });
    const sb = fakeSupabase(world({ encounters: [fresh, old], encounter_players: [], looted_items: [] }));
    const r = await get(sb);
    expect(r.body.encounters.map(e => e.id)).toEqual([uid(2)]);
  });

  it('limit defaults to 200, is clamped to 200, and bad values fall back', async () => {
    const sb = fakeSupabase(world());
    for (const l of [undefined, '', 'x', '0', '-5', '9999']) {
      sb.log.length = 0;
      await get(sb, { limit: l });
      expect(sb.log.find(x => x.table === 'encounters').qs).toMatch(/&limit=200$/);
    }
    sb.log.length = 0;
    await get(sb, { limit: '7' });
    expect(sb.log.find(x => x.table === 'encounters').qs).toMatch(/&limit=7$/);
  });

  it('`since` may be a plain ISO instant; garbage and forged cursors are a 400 that reads nothing', async () => {
    const sb = fakeSupabase(world());
    const mid = await get(sb, { since: iso(T0 + 15 * MIN) });
    expect(mid.body.encounters.map(e => e.id)).toEqual([uid(2), uid(3)]);
    sb.log.length = 0;
    const forged = 'c1.' + Buffer.from(JSON.stringify({ u: '2026-01-01T00:00:00Z)),id.gt.x', i: uid(1), d: '2026-01-01T00:00:00Z', j: uid(1) })).toString('base64url');
    for (const s of ['not a date', 'c1.@@@', forged, 'c1.' + Buffer.from('{"u":1}').toString('base64url')]) {
      const r = await ls.serve(sb, { since: s }, NOW);
      expect(r).toEqual({ status: 400, error: 'bad request' });
    }
    expect(sb.log).toEqual([]);
  });
});

// ── 2. tombstones ─────────────────────────────────────────────────────────────
describe('tombstones', () => {
  it('lists deleted and merged-away ids with their own keyset, independent of the encounter cursor', async () => {
    const w = world({
      encounter_tombstones: [
        { id: uid(50), guild_id: G, deleted_at: pg(T0 + 30 * MIN), merged_into: uid(1) },
        { id: uid(51), guild_id: G, deleted_at: pg(T0 + 31 * MIN), merged_into: null },
        { id: uid(52), guild_id: G, deleted_at: pg(NOW - 1_000), merged_into: null },   // inside the lag
      ],
    });
    const sb = fakeSupabase(w);
    const a = await get(sb, { limit: '1' });
    expect(a.body.tombstones).toEqual([{ id: uid(50), deleted_at: pg(T0 + 30 * MIN), merged_into: uid(1) }]);
    expect(a.body.more).toBe(true);
    const b = await get(sb, { since: a.body.cursor, limit: '1' });
    expect(b.body.tombstones.map(t => t.id)).toEqual([uid(51)]);
    expect(b.body.tombstones[0].merged_into).toBeNull();
    expect(b.body.encounters.map(e => e.id)).toEqual([uid(2)]);   // encounters advanced by their own cursor
    const c = await get(sb, { since: b.body.cursor, limit: '5' });
    expect(c.body.tombstones).toEqual([]);   // the in-lag one is not served yet
  });
});

// ── 3. the payload and the privacy scrub ──────────────────────────────────────
describe('payload and privacy', () => {
  it('carries the fight header, players ranked, and loot windowed to the fight', async () => {
    const sb = fakeSupabase(world());
    const r = await get(sb);
    const e1 = r.body.encounters[0];
    expect(Object.keys(e1).sort()).toEqual(['classification', 'duration_sec', 'ended_at', 'id', 'incomplete', 'loot', 'name', 'npc_id', 'players', 'started_at', 'total_damage', 'total_dps', 'updated_at', 'zone'].sort());
    expect(e1.name).toBe('Lord Aldwyn 1');
    expect(e1.players.map(p => p.rank)).toEqual([1, 2, 3, 4]);
    // fight 1 ends at T0+12m, its window runs to T0+32m: the drops at +15m and +16m belong to FIGHT 1 (started +10m)
    // and are before fight 2's start? no: fight 2 starts +20m, so they are fight 1's only.
    expect(e1.loot.map(l => l.id)).toEqual([1, 2]);
    expect(r.body.encounters[1].loot).toEqual([]);   // its window starts after them
    expect(JSON.stringify(r.body.encounters).includes('Out of window')).toBe(false);
  });

  it('a drop inside two fights\' windows is carried by both, with the same id for the receiver to dedup on', async () => {
    const w = world();
    w.looted_items = [{ id: 9, guild_id: G, looter_character: 'Corvale', item_name: 'Shared', looted_at: iso(T0 + 31 * MIN), uploaded_by_discord_id: 'u', source: 's', from_own_pet: false }];
    // fight 2: +20..+22m, tail to +42m. fight 3: +30..+32m. The drop at +31m is in both.
    const r = await get(fakeSupabase(w));
    expect(r.body.encounters[1].loot.map(l => l.id)).toEqual([9]);
    expect(r.body.encounters[2].loot.map(l => l.id)).toEqual([9]);
  });

  it('opted-out raiders (either flag) are "<Class> <n>" in players and loot, a pet keeps its suffix, everyone else is by name', async () => {
    const r = await get(fakeSupabase(world()));
    const e1 = r.body.encounters[0];
    const byRank = Object.fromEntries(e1.players.map(p => [p.rank, p]));
    expect(byRank[1]).toMatchObject({ name: 'Corvale', class: 'Warrior' });
    expect(byRank[1].anon).toBeUndefined();
    expect(byRank[2].name).toMatch(/^Cleric \d$/);
    expect(byRank[2]).toMatchObject({ class: 'Cleric', anon: true });
    expect(byRank[3].name).toMatch(/^Cleric \d$/);
    expect(byRank[3].name).not.toBe(byRank[2].name);
    expect(byRank[4].name).toBe(`${byRank[3].name}\`s pet`);
    expect(e1.loot.find(l => l.id === 2)).toMatchObject({ looter: byRank[2].name, anon: true, pet: true });
    expect(e1.loot.find(l => l.id === 1)).toMatchObject({ looter: 'Corvale' });
    // a leaver (no characters row) is by name with no class
    expect(r.body.encounters[1].players.find(p => p.name === 'Leaver')).toMatchObject({ class: null });
  });

  it('no opted-out real name appears anywhere in the response, and the labels match the website\'s', async () => {
    const r = await get(fakeSupabase(world()));
    expect(r.text).not.toMatch(/Aldenmar|Brackwyn/);
    const web = rw.anonLabels(CHARS, process.env.DEMO_OBFUSCATE_SALT || 'raid-anon');
    const label = web.get('aldenmar').label;
    expect(r.text).toContain(label);
  });

  it('never sends an id, a note, a link or any column outside the allow-list', async () => {
    const r = await get(fakeSupabase(world()));
    for (const bad of ['u-secret', 'discord.com', 'officer', 'raid_night', 'source_contribution', uid(777), uid(900), 'uploaded_by', 'discord_id', 'classification_reason', 'local_agent_v1']) {
      expect(r.text.includes(bad), bad).toBe(false);
    }
    const q = fakeSupabase(world());
    await get(q);
    const sel = (t) => new URLSearchParams(q.log.find(x => x.table === t).qs).get('select');
    expect(sel('encounters')).not.toMatch(/uploaded_by|discord|classification_(reason|by)|raid_night|data_incomplete_(by|reason|at)/);
    expect(sel('encounter_players')).not.toMatch(/source_contribution/);
    expect(sel('looted_items')).not.toMatch(/uploaded_by|source/);
  });

  it('fails closed: an unreadable opt-out list is a 503 and no fight is read', async () => {
    const sb = fakeSupabase(world({ __fail: ['characters'] }));
    const r = await ls.serve(sb, {}, NOW);
    expect(r.status).toBe(503);
    expect(sb.log.some(x => x.table === 'encounters')).toBe(false);
  });

  it('a failed class lookup is only a missing class, never a leak', async () => {
    const calls = { n: 0 };
    const sb = fakeSupabase(world());
    const orig = sb.selectAllPaged;
    sb.selectAllPaged = async (t, b, o) => (t === 'characters' && !b.includes('exclude_from_stats') ? (calls.n++, null) : orig(t, b, o));
    const r = await get(sb);
    expect(calls.n).toBe(1);
    expect(r.status).toBe(200);
    expect(r.body.encounters[0].players.find(p => p.rank === 1)).toMatchObject({ name: 'Corvale', class: null });
    expect(r.text).not.toMatch(/Aldenmar|Brackwyn/);
  });

  it('a database read that fails is a 503, not a half page', async () => {
    for (const t of ['encounters', 'encounter_tombstones', 'encounter_players', 'looted_items']) {
      const sb = fakeSupabase(world({ __fail: [t] }));
      expect((await ls.serve(sb, {}, NOW)).status, t).toBe(503);
    }
  });

  it('payload size: 200 typical fights (6 players, 1-2 drops) is about a quarter of a megabyte raw and under 60 KB gzipped', async () => {
    const encs = [], pls = [], loot = [];
    for (let n = 1; n <= 200; n++) {
      const e = enc(n);
      encs.push(e);
      ['Corvale', 'Dunmere', 'Aldenmar', 'Brackwyn', 'Eldrin', 'Fenwick'].forEach((nm, i) => pls.push(player(e.id, nm, 9000 - i * 700, i + 1)));
      loot.push({ id: n, guild_id: G, looter_character: 'Corvale', item_name: 'Cloak of Tests', looted_at: iso(T0 + n * 10 * MIN + 5 * MIN), source: 's', from_own_pet: false });
    }
    const r = await get(fakeSupabase(world({ encounters: encs, encounter_players: pls, looted_items: loot })));
    expect(r.body.encounters).toHaveLength(200);
    const raw = Buffer.byteLength(r.text), gz = zlib.gzipSync(r.text).length;
    expect(raw).toBeLessThan(400_000);
    expect(gz).toBeLessThan(60_000);
  });
});

// ── 4. the route in index.js ──────────────────────────────────────────────────
describe('the HTTP route (real index.js)', () => {
  const src = readSource(BOT_INDEX);
  const code = stripJs(src);
  const block = sliceBlock(src, 'async function _handleAgentLocalSyncGet(', '// GET /api/agent/guild-chat');
  function build({ identity, sb }) {
    const calls = { auth: 0 };
    const mimicLink = { requireAgentAuth: async (req, res) => { calls.auth++; if (!identity) { res.code = 401; res.json = { error: 'unauthorized' }; } return identity; } };
    const _ptsJson = (res, code_, obj) => { res.code = code_; res.json = obj; };
    const req_ = (p) => (p === './utils/supabase' ? sb : p === './utils/localSync' ? ls : p === 'zlib' ? zlib : null);
    const handler = new Function('mimicLink', '_ptsJson', 'require', 'URL', 'Buffer', 'Date',
      block + '\nreturn _handleAgentLocalSyncGet;')(mimicLink, _ptsJson, req_, URL, Buffer, Date);
    return { handler, calls };
  }
  const resOf = () => ({ headers: null, writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b; } });
  const reqOf = (qs, headers = {}) => ({ url: '/api/agent/local-sync?' + qs, headers });

  it('refuses a caller without a member token: nothing is read', async () => {
    const sb = fakeSupabase(world());
    const { handler, calls } = build({ identity: null, sb });
    const res = resOf();
    await handler(reqOf(''), res);
    expect(calls.auth).toBe(1);
    expect(res.code).toBe(401);
    expect(sb.log).toEqual([]);
  });

  it('serves JSON to a member, gzip when asked, and passes since/limit through', async () => {
    const sb = fakeSupabase(world());
    const { handler } = build({ identity: { discord_id: 'u-9' }, sb });
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const plain = resOf();
    await handler(reqOf('limit=2'), plain);
    expect(plain.code).toBe(200);
    expect(plain.headers['Content-Type']).toBe('application/json');
    expect(plain.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(plain.body.toString('utf8')).encounters).toHaveLength(2);
    const gz = resOf();
    await handler(reqOf('limit=2', { 'accept-encoding': 'gzip, deflate' }), gz);
    expect(gz.headers['Content-Encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString('utf8')).toBe(plain.body.toString('utf8'));
    now.mockRestore();
  });

  it('a bad cursor is a 400 and a database that is down is a 503', async () => {
    const { handler } = build({ identity: { discord_id: 'u-9' }, sb: fakeSupabase(world()) });
    const bad = resOf();
    await handler(reqOf('since=nonsense'), bad);
    expect(bad.code).toBe(400);
    expect(bad.json).toEqual({ error: 'bad request' });
    const down = build({ identity: { discord_id: 'u-9' }, sb: { isEnabled: () => false } });
    const res = resOf();
    await down.handler(reqOf(''), res);
    expect(res.code).toBe(503);
  });

  it('the route sheds first, then budgets, then runs the handler', () => {
    const route = sliceBlock(code, "=== '/api/agent/local-sync'", '_handleAgentLocalSyncGet(req, res)');
    const shed = route.indexOf("_isShedded('local_sync', res, { ok: true, shed: true, cursor: null, more: false, encounters: [], tombstones: [] })");
    const bud = route.indexOf("_overBudget('local_sync', req, res)");
    expect(shed).toBeGreaterThan(0);
    expect(bud).toBeGreaterThan(shed);
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/local-sync'/);
  });

  it('local_sync is sheddable (never durable), acks with a null cursor, and is a 30/min GET budget kind', async () => {
    const gate = sliceBlock(src, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');
    const budgets = sliceBlock(src, 'const _BUDGET_DEFAULTS = {', '\n};');
    const { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune } = new Function(`
      let __t = {};
      function setTune(t) { __t = t; }
      async function _overlayTuningMap() { return __t; }
      ${gate}
      return { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune };`)();
    expect(_SHED_KINDS.has('local_sync')).toBe(true);
    expect(_SHED_NEVER.has('local_sync')).toBe(false);
    const ack = { ok: true, shed: true, cursor: null, more: false, encounters: [], tombstones: [] };
    const res = { writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    setTune({});
    expect(await _isShedded('local_sync', res, ack)).toBe(false);
    setTune({ flag_shed_local_sync: 1 });
    expect(await _isShedded('local_sync', res, ack)).toBe(true);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body)).toEqual(ack);
    const defaults = new Function(`${budgets}\nreturn _BUDGET_DEFAULTS;`)();
    expect(defaults.local_sync).toEqual({ perMin: 30, durable: false, get: true });
  });
});
