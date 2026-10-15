// test/kite-loops.test.js — the guild's kite-loop library (the guild lead, 2026-10-15: "B and C").
//
// Mimic uploads ONLY a fitted circle; the bot validates, merges per spot, caps per zone and serves the best few.
// Most of this runs the real utils/kiteLoops.js against an in-memory stand-in for the supabase client, and the
// route handlers are sliced out of the real index.js and run (no text assertion stands in for behaviour).
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const kite = require_('../utils/kiteLoops.js');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const good = {
  zone: 'potranquility', cx: 100, cy: -250, cz: 3, r: 80, lap_s: 20, speed_pct: 100,
  drift_u: 3, wobble_u: 2, laps: 5, dir: 'cw', at: '2026-10-15T19:59:00Z', agent_version: '3.7.150',
};

// An in-memory kite_loops table behind the four calls the module makes. Records every write it is handed.
function fakeSupabase(seed = []) {
  let nextId = 1000;
  const rows = seed.map(r => ({ ...r }));
  const log = { selects: 0, inserts: [], updates: [], dels: [] };
  return {
    rows, log,
    isEnabled: () => true,
    guildId: () => 'wolfpack',
    async select(table, qs) {
      log.selects++;
      const p = new URLSearchParams(qs);
      const g = p.get('guild_id').replace(/^eq\./, ''), z = p.get('zone').replace(/^eq\./, '');
      const lim = Number(p.get('limit')) || Infinity;
      return rows.filter(r => r.guild_id === g && r.zone === z).slice(0, lim).map(r => ({ ...r }));
    },
    async insert(table, batch) {
      const out = batch.map(b => { log.inserts.push(b); const row = { id: nextId++, ...b }; rows.push(row); return { ...row }; });
      return out;
    },
    async update(table, qs, patch) {
      log.updates.push(patch);
      const id = Number(qs.replace('id=eq.', ''));
      const row = rows.find(r => r.id === id);
      if (row) Object.assign(row, patch);
      return row ? [{ ...row }] : [];
    },
    async del(table, qs) {
      log.dels.push(qs);
      const ids = qs.replace('id=in.(', '').replace(')', '').split(',').map(Number);
      for (const id of ids) { const i = rows.findIndex(r => r.id === id); if (i >= 0) rows.splice(i, 1); }
      return [];
    },
  };
}
const loopOf = (over = {}) => kite.validateLoop({ ...good, ...over }, NOW).loop;
const row = (id, over = {}) => ({
  id, guild_id: 'wolfpack', zone: 'potranquility', cx: 100, cy: -250, cz: 3, r: 80, lap_s: 20, speed_pct: 100,
  dir: 'cw', drift_u: 3, wobble_u: 2, laps: 5, seen: 1, quality: 0.5, first_at: '2026-10-14T00:00:00Z',
  last_at: '2026-10-14T00:00:00Z', agent_version: '3.7.150', ...over,
});

beforeEach(() => kite._resetForTests());

describe('validateLoop', () => {
  it('accepts the contract body and returns only whitelisted, rounded fields', () => {
    const v = kite.validateLoop({ ...good, discord_id: '123', character: 'Aldenmar', path: [[1, 2]], cx: 100.12345 }, NOW);
    expect(v.error).toBeUndefined();
    expect(Object.keys(v.loop).sort()).toEqual([
      'agent_version', 'cx', 'cy', 'cz', 'dir', 'drift_u', 'lap_s', 'laps', 'quality', 'r', 'speed_pct', 'wobble_u', 'zone',
    ]);
    expect(v.loop.cx).toBe(100.12);
  });

  const reject = (label, over) => it(`rejects ${label}`, () => {
    const v = kite.validateLoop({ ...good, ...over }, NOW);
    expect(v.error).toBeTruthy();
    expect(v.loop).toBeUndefined();
  });
  reject('a zone with capitals', { zone: 'PoTranquility' });
  reject('a zone with a slash', { zone: '../x' });
  reject('a missing zone', { zone: undefined });
  reject('a string centre', { cx: '100' });
  reject('a NaN centre', { cy: NaN });
  reject('an infinite centre', { cz: Infinity });
  reject('a centre off the map', { cx: 1e9 });
  reject('r below 20', { r: 19.9 });
  reject('r above 500', { r: 500.1 });
  reject('lap_s below 3', { lap_s: 2.9 });
  reject('lap_s above 300', { lap_s: 301 });
  reject('a non-finite speed', { speed_pct: NaN });
  reject('a speed of zero', { speed_pct: 0 });
  reject('fewer than 3 laps', { laps: 2 });
  reject('a fractional lap count', { laps: 3.5 });
  reject('drift over 15% of r', { drift_u: 80 * 0.15 + 0.01 });
  reject('wobble over 15% of r', { wobble_u: 80 * 0.15 + 0.01 });
  reject('negative drift', { drift_u: -1 });
  reject('a bad direction', { dir: 'left' });
  reject('a missing time', { at: undefined });
  reject('a time in the far future', { at: '2026-10-16T20:00:00Z' });
  reject('a time months ago', { at: '2026-06-01T00:00:00Z' });
  it('rejects a non-object body', () => {
    expect(kite.validateLoop(null, NOW).error).toBeTruthy();
    expect(kite.validateLoop([good], NOW).error).toBeTruthy();
    expect(kite.validateLoop('x', NOW).error).toBeTruthy();
  });
  it('drift and wobble exactly at 15% of r are accepted (the boundary is inclusive)', () => {
    expect(kite.validateLoop({ ...good, drift_u: 12, wobble_u: 12 }, NOW).error).toBeUndefined();
  });
  it('an odd agent_version is stored as null, not rejected', () => {
    expect(kite.validateLoop({ ...good, agent_version: '<script>' }, NOW).loop.agent_version).toBeNull();
  });
});

describe('quality', () => {
  it('is 0..1: perfect circle at 12+ laps is 1, the loosest accepted loop at 3 laps is small', () => {
    expect(loopOf({ drift_u: 0, wobble_u: 0, laps: 12 }).quality).toBe(1);
    expect(loopOf({ drift_u: 12, wobble_u: 12, laps: 3 }).quality).toBe(0.05);
  });
  it('less drift beats more drift, less wobble beats more wobble, more laps beat fewer', () => {
    const q = (o) => loopOf(o).quality;
    expect(q({ drift_u: 1 })).toBeGreaterThan(q({ drift_u: 6 }));
    expect(q({ wobble_u: 1 })).toBeGreaterThan(q({ wobble_u: 6 }));
    expect(q({ laps: 9 })).toBeGreaterThan(q({ laps: 3 }));
  });
  it('is relative to size: the same absolute error is cleaner on a big loop', () => {
    expect(loopOf({ r: 200, drift_u: 5, wobble_u: 5 }).quality).toBeGreaterThan(loopOf({ r: 40, drift_u: 5, wobble_u: 5 }).quality);
  });
  it('drift costs more than wobble', () => {
    expect(loopOf({ drift_u: 0, wobble_u: 6 }).quality).toBeGreaterThan(loopOf({ drift_u: 6, wobble_u: 0 }).quality);
  });
});

describe('ingest: merge vs insert', () => {
  it('a loop in an empty zone is inserted with seen 1', async () => {
    const sb = fakeSupabase();
    const r = await kite.ingest(sb, 'wolfpack', loopOf(), NOW);
    expect(r).toMatchObject({ status: 200, merged: false });
    expect(sb.rows).toHaveLength(1);
    expect(sb.rows[0]).toMatchObject({ guild_id: 'wolfpack', zone: 'potranquility', seen: 1, dir: 'cw' });
    expect(sb.rows[0].first_at).toBe(new Date(NOW).toISOString());
  });

  it('the same spot (centre inside 0.35 r, radius inside 25%, same direction) merges: seen+1, last_at = now', async () => {
    const sb = fakeSupabase([row(7, { quality: 0.9, seen: 4 })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf({ cx: 100 + 0.3 * 80, r: 90 }), NOW);
    expect(r).toEqual({ status: 200, id: 7, merged: true });
    expect(sb.rows).toHaveLength(1);
    expect(sb.rows[0].seen).toBe(5);
    expect(sb.rows[0].last_at).toBe(new Date(NOW).toISOString());
    expect(sb.log.inserts).toHaveLength(0);
  });

  it('a merge keeps the BETTER geometry whole: a worse upload changes only seen and last_at', async () => {
    const sb = fakeSupabase([row(7, { quality: 0.95, lap_s: 20, speed_pct: 100, cx: 100 })]);
    await kite.ingest(sb, 'wolfpack', loopOf({ cx: 110, lap_s: 31, speed_pct: 140, drift_u: 10, wobble_u: 9, laps: 3 }), NOW);
    expect(Object.keys(sb.log.updates[0]).sort()).toEqual(['last_at', 'seen']);
    expect(sb.rows[0]).toMatchObject({ cx: 100, lap_s: 20, speed_pct: 100, quality: 0.95 });
  });

  it('a merge with a cleaner upload replaces the geometry as a unit (lap time and speed come along)', async () => {
    const sb = fakeSupabase([row(7, { quality: 0.2, lap_s: 20, speed_pct: 100 })]);
    await kite.ingest(sb, 'wolfpack', loopOf({ cx: 110, lap_s: 14.5, speed_pct: 140, drift_u: 0.5, wobble_u: 0.5, laps: 10 }), NOW);
    expect(sb.rows[0]).toMatchObject({ cx: 110, lap_s: 14.5, speed_pct: 140, laps: 10, seen: 2 });
    expect(sb.rows[0].quality).toBeGreaterThan(0.9);
  });

  it('a radius more than 25% different is a different loop: inserted, not merged', async () => {
    const sb = fakeSupabase([row(7, { r: 80 })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf({ r: 110 }), NOW);   // 30 / 110 = 27%
    expect(r.merged).toBe(false);
    expect(sb.rows).toHaveLength(2);
  });

  it('a loop on another floor (z more than 40 apart) is a different loop', async () => {
    const sb = fakeSupabase([row(7, { cz: 3 })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf({ cz: 90 }), NOW);
    expect(r.merged).toBe(false);
    expect(sb.rows).toHaveLength(2);
  });

  it('the opposite turning direction is a different loop', async () => {
    const sb = fakeSupabase([row(7, { dir: 'cw' })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf({ dir: 'ccw' }), NOW);
    expect(r.merged).toBe(false);
    expect(sb.rows).toHaveLength(2);
  });

  it('a centre more than 0.35 r away is a different spot', async () => {
    const sb = fakeSupabase([row(7)]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf({ cx: 100 + 0.4 * 80 }), NOW);
    expect(r.merged).toBe(false);
  });

  it('a loop in another zone or guild never merges', async () => {
    const sb = fakeSupabase([row(7, { zone: 'nektulos' }), row(8, { guild_id: 'other' })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf(), NOW);
    expect(r.merged).toBe(false);
  });

  it('with two candidates the nearer centre wins', async () => {
    const sb = fakeSupabase([row(7, { cx: 100 + 20 }), row(8, { cx: 100 + 5 })]);
    const r = await kite.ingest(sb, 'wolfpack', loopOf(), NOW);
    expect(r.id).toBe(8);
  });

  it('two uploads for one spot arriving together make ONE row, seen 2', async () => {
    const sb = fakeSupabase();
    const [a, b] = await Promise.all([kite.ingest(sb, 'wolfpack', loopOf(), NOW), kite.ingest(sb, 'wolfpack', loopOf(), NOW)]);
    expect(sb.rows).toHaveLength(1);
    expect(sb.rows[0].seen).toBe(2);
    expect([a.merged, b.merged].sort()).toEqual([false, true]);
  });

  it('a failed read or write is a 503, never a silent success', async () => {
    const sb = fakeSupabase();
    sb.select = async () => null;
    expect((await kite.ingest(sb, 'wolfpack', loopOf(), NOW)).status).toBe(503);
    const sb2 = fakeSupabase();
    sb2.insert = async () => null;
    expect((await kite.ingest(sb2, 'wolfpack', loopOf(), NOW)).status).toBe(503);
  });
});

describe('ingest: the per-zone cap', () => {
  it('with MORE rows than the cap, the write trims back to the cap, worst-and-oldest first, and keeps the new row', async () => {
    const seed = [];
    for (let i = 1; i <= kite.ZONE_CAP + 5; i++) {
      // Spread centres so none of them is "the same spot" as the new loop; quality rises with i.
      seed.push(row(i, { cx: 5000 + i * 1000, quality: i / 100, last_at: '2026-10-14T00:00:00Z' }));
    }
    seed[0].quality = 0.99;                               // id 1: top quality but the first rows would be worst otherwise
    const sb = fakeSupabase(seed);
    const r = await kite.ingest(sb, 'wolfpack', loopOf(), NOW);
    expect(r.merged).toBe(false);
    expect(sb.rows).toHaveLength(kite.ZONE_CAP);          // 65 + 1 new - 6 evicted
    expect(sb.rows.some(x => x.id === r.id)).toBe(true);  // the row just written survives
    expect(sb.rows.some(x => x.id === 1)).toBe(true);     // high quality survives although it is oldest in id order
    const gone = seed.filter(s => !sb.rows.some(x => x.id === s.id)).map(s => s.id).sort((a, b) => a - b);
    expect(gone).toEqual([2, 3, 4, 5, 6, 7]);             // the six lowest keep-scores
  });

  it('age fades a loop: of two equal-quality rows the staler one goes first', () => {
    const rows = [
      { id: 1, quality: 0.5, last_at: '2026-10-14T00:00:00Z' },
      { id: 2, quality: 0.5, last_at: '2026-06-01T00:00:00Z' },
      { id: 3, quality: 0.5, last_at: '2026-10-10T00:00:00Z' },
    ];
    expect(kite.pickEvictions(rows, 99, 2, NOW)).toEqual([2]);
  });

  it('does nothing at or under the cap, and never picks the protected row', () => {
    const rows = [{ id: 1, quality: 0.1, last_at: '2026-01-01T00:00:00Z' }, { id: 2, quality: 0.9, last_at: '2026-10-15T00:00:00Z' }];
    expect(kite.pickEvictions(rows, 1, 2, NOW)).toEqual([]);
    expect(kite.pickEvictions(rows, 1, 1, NOW)).toEqual([2]);
  });
});

describe('no uploader reaches the database', () => {
  it('the insert payload and the merge patch hold only circle fields, whatever the body carried', async () => {
    const dirty = { ...good, discord_id: '1234567890', character: 'Aldenmar', uploaded_by: 'x', path: [[1, 2], [3, 4]], session: 'wpms_abc' };
    const sb = fakeSupabase();
    await kite.ingest(sb, 'wolfpack', kite.validateLoop(dirty, NOW).loop, NOW);
    await kite.ingest(sb, 'wolfpack', kite.validateLoop({ ...dirty, drift_u: 0.1, laps: 9 }, NOW).loop, NOW);   // merge path
    const allowed = new Set(['guild_id', 'zone', 'cx', 'cy', 'cz', 'r', 'lap_s', 'speed_pct', 'dir', 'drift_u', 'wobble_u',
      'laps', 'seen', 'quality', 'first_at', 'last_at', 'agent_version']);
    expect(sb.log.inserts).toHaveLength(1);
    for (const k of Object.keys(sb.log.inserts[0])) expect(allowed.has(k)).toBe(true);
    for (const k of Object.keys(sb.log.updates[0])) expect(allowed.has(k)).toBe(true);
    expect(JSON.stringify([sb.log.inserts, sb.log.updates])).not.toMatch(/1234567890|Aldenmar|wpms_|uploaded_by|discord/);
  });

  it('the migration has no uploader, character, discord or session column', () => {
    const mig = stripSql(readSource(new URL('../supabase/migrations/20261015120000_kite_loops.sql', import.meta.url).pathname));
    expect(mig).toMatch(/create table if not exists public\.kite_loops/);
    expect(mig).not.toMatch(/uploader|uploaded_by|character|discord|session|user_id/i);
    expect(mig).toMatch(/enable row level security/);
    expect(mig).toMatch(/for select to authenticated/);
    expect(mig).toMatch(/check \(dir in \('cw', 'ccw'\)\)/);
  });
});

describe('query', () => {
  it('serves at most 12, best first by quality * ln(1 + seen)', async () => {
    const seed = [];
    for (let i = 1; i <= 20; i++) seed.push(row(i, { cx: i * 1000, quality: 0.5, seen: 1 }));
    seed.push(row(21, { cx: 99000, quality: 0.6, seen: 1 }));     // cleaner, seen once  -> 0.6 ln2  = 0.416
    seed.push(row(22, { cx: 98000, quality: 0.5, seen: 9 }));     // a bit less clean, found by many -> 0.5 ln10 = 1.151
    const sb = fakeSupabase(seed);
    const r = await kite.query(sb, 'wolfpack', 'potranquility', NOW);
    expect(r.status).toBe(200);
    expect(r.loops).toHaveLength(12);
    expect(r.loops[0].id).toBe(22);
    expect(r.loops[1].id).toBe(21);
  });

  it('serves exactly the contract fields (no quality, no guild, nothing about an uploader)', async () => {
    const sb = fakeSupabase([row(3)]);
    const r = await kite.query(sb, 'wolfpack', 'potranquility', NOW);
    expect(Object.keys(r.loops[0]).sort()).toEqual(
      ['cx', 'cy', 'cz', 'dir', 'drift_u', 'id', 'lap_s', 'laps', 'last_at', 'r', 'seen', 'speed_pct', 'wobble_u']);
  });

  it('an empty zone is an empty list; a bad zone is a 400', async () => {
    const sb = fakeSupabase();
    expect(await kite.query(sb, 'wolfpack', 'nektulos', NOW)).toEqual({ status: 200, loops: [] });
    expect((await kite.query(sb, 'wolfpack', 'Bad Zone', NOW)).status).toBe(400);
    expect((await kite.query(sb, 'wolfpack', null, NOW)).status).toBe(400);
  });

  it('caches 60 s per zone, expires after, and an upload to the zone clears it', async () => {
    const sb = fakeSupabase([row(3)]);
    await kite.query(sb, 'wolfpack', 'potranquility', NOW);
    await kite.query(sb, 'wolfpack', 'potranquility', NOW + 59_000);
    expect(sb.log.selects).toBe(1);
    await kite.query(sb, 'wolfpack', 'potranquility', NOW + 61_000);
    expect(sb.log.selects).toBe(2);
    await kite.query(sb, 'wolfpack', 'potranquility', NOW + 62_000);
    const before = sb.log.selects;
    await kite.ingest(sb, 'wolfpack', loopOf({ cx: 9000 }), NOW + 63_000);   // 1 select inside ingest
    await kite.query(sb, 'wolfpack', 'potranquility', NOW + 64_000);
    expect(sb.log.selects).toBe(before + 2);
  });

  it('a failed read is a 503 and is not cached', async () => {
    const sb = fakeSupabase();
    const good_ = sb.select;
    sb.select = async () => null;
    expect((await kite.query(sb, 'wolfpack', 'potranquility', NOW)).status).toBe(503);
    sb.select = good_;
    expect((await kite.query(sb, 'wolfpack', 'potranquility', NOW + 1000)).status).toBe(200);
  });
});

describe('per-uploader rate limit', () => {
  it('allows 30 an hour, refuses the 31st, keeps uploaders apart, and frees up as the hour rolls', () => {
    for (let i = 0; i < kite.RATE_PER_HOUR; i++) expect(kite.allowUpload('u1', NOW + i * 1000)).toBe(true);
    expect(kite.allowUpload('u1', NOW + 40_000)).toBe(false);
    expect(kite.allowUpload('u2', NOW + 40_000)).toBe(true);
    expect(kite.allowUpload('u1', NOW + 3_600_000 + 5_000)).toBe(true);      // the first few have aged out
  });
  it('refused calls do not extend the lockout', () => {
    for (let i = 0; i < 30; i++) kite.allowUpload('u3', NOW);
    for (let i = 0; i < 100; i++) kite.allowUpload('u3', NOW + 1000);
    expect(kite.allowUpload('u3', NOW + 3_600_001)).toBe(true);
  });
});

// ── The real route handlers, sliced from index.js and run with stand-ins for auth, body-reading and the db.
describe('the HTTP handlers in index.js', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'async function _handleAgentKiteLoopPost(', '// POST/GET /api/agent/map-sync');
  function build(sb, identity = { discord_id: 'caller-default' }) {
    const mimicLink = { requireAgentAuth: async () => identity };
    const _ptsReadBody = (req) => Promise.resolve({ text: req.__body });
    const _ptsJson = (res, code, obj) => { res.code = code; res.json = obj; };
    const req_ = (p) => (p === './utils/kiteLoops' ? kite : p === './utils/supabase' ? sb : null);
    return new Function('mimicLink', '_ptsReadBody', '_ptsJson', 'require', 'URL',
      block + '\nreturn { post: _handleAgentKiteLoopPost, get: _handleAgentKiteLoopsGet };')(mimicLink, _ptsReadBody, _ptsJson, req_, URL);
  }
  const post = (h, body) => { const res = {}; return h.post({ __body: typeof body === 'string' ? body : JSON.stringify(body) }, res).then(() => res); };

  it('POST: a good loop is 200 {ok, id, merged}; the same loop again is merged', async () => {
    const sb = fakeSupabase();
    const h = build(sb);
    const body = { ...good, at: new Date().toISOString() };
    const a = await post(h, body);
    expect(a.code).toBe(200);
    expect(a.json).toMatchObject({ ok: true, merged: false });
    expect(typeof a.json.id).toBe('number');
    const b = await post(h, body);
    expect(b.json).toMatchObject({ ok: true, merged: true, id: a.json.id });
  });

  it('POST: the caller\'s discord id is used for the limit only and never reaches a write', async () => {
    const sb = fakeSupabase();
    const h = build(sb, { discord_id: 'caller-sentinel' });
    await post(h, { ...good, at: new Date().toISOString(), discord_id: 'body-sentinel', character: 'Brackwyn' });
    expect(sb.log.inserts).toHaveLength(1);
    expect(JSON.stringify(sb.log.inserts)).not.toMatch(/caller-sentinel|body-sentinel|Brackwyn/);
  });

  it('POST: bad json and invalid loops are 400, and write nothing', async () => {
    const sb = fakeSupabase();
    const h = build(sb);
    expect((await post(h, '{nope')).code).toBe(400);
    expect((await post(h, { ...good, at: new Date().toISOString(), laps: 2 })).code).toBe(400);
    expect((await post(h, { ...good, at: new Date().toISOString(), zone: 'Bad Zone' })).code).toBe(400);
    expect(sb.rows).toHaveLength(0);
  });

  it('POST: past 30 an hour the uploader is acked and dropped (200, rate_limited), not stored', async () => {
    const sb = fakeSupabase();
    const h = build(sb);
    for (let i = 0; i < 30; i++) await post(h, { ...good, at: new Date().toISOString(), cx: i * 1000 });
    const rowsBefore = sb.rows.length;
    const over = await post(h, { ...good, at: new Date().toISOString(), cx: 77000 });
    expect(over.code).toBe(200);
    expect(over.json).toMatchObject({ ok: true, rate_limited: true });
    expect(sb.rows).toHaveLength(rowsBefore);
  });

  it('GET: returns { loops } for a zone and 400 for a bad one', async () => {
    const sb = fakeSupabase([row(3)]);
    const h = build(sb);
    const ok = {}; await h.get({ url: '/api/agent/kite-loops?zone=potranquility' }, ok);
    expect(ok.code).toBe(200);
    expect(ok.json.loops.map(l => l.id)).toEqual([3]);
    const bad = {}; await h.get({ url: '/api/agent/kite-loops?zone=NOPE!' }, bad);
    expect(bad.code).toBe(400);
    const none = {}; await h.get({ url: '/api/agent/kite-loops' }, none);
    expect(none.code).toBe(400);
  });

  it('a database that is off is a 503, not a crash', async () => {
    const sb = fakeSupabase();
    sb.isEnabled = () => false;
    const h = build(sb);
    const res = {}; await h.get({ url: '/api/agent/kite-loops?zone=potranquility' }, res);
    expect(res.code).toBe(503);
    expect((await post(h, { ...good, at: new Date().toISOString() })).code).toBe(503);
  });
});

describe('shed + budget registration (real index.js)', () => {
  const src = readSource(BOT_INDEX);
  const gate = sliceBlock(src, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');
  const budgets = sliceBlock(src, 'const _BUDGET_DEFAULTS = {', '\n};');
  const { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune } = new Function(`
    let __t = {};
    function setTune(t) { __t = t; }
    async function _overlayTuningMap() { return __t; }
    ${gate}
    return { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune };`)();
  const BUDGETS = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();

  it('kite_loop is sheddable (flag_shed_kite_loop=1 acks and drops) and is not a durable kind', async () => {
    expect(_SHED_KINDS.has('kite_loop')).toBe(true);
    expect(_SHED_NEVER.has('kite_loop')).toBe(false);
    setTune({ flag_shed_kite_loop: 1 });
    const res = { writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    expect(await _isShedded('kite_loop', res)).toBe(true);
    expect(res.code).toBe(200);
    setTune({});
    expect(await _isShedded('kite_loop', { writeHead() {}, end() {} })).toBe(false);
  });

  it('both kinds are budgeted as ephemeral; the GET answers an over-budget client with a 429', () => {
    expect(BUDGETS.kite_loop).toMatchObject({ durable: false });
    expect(BUDGETS.kite_loop.get).toBeUndefined();
    expect(BUDGETS.kite_loops).toMatchObject({ durable: false, get: true });
  });

  it('the routes are wired: POST sheds then budgets, GET budgets', () => {
    const code = stripJs(src);
    expect(code).toMatch(/req\.method === 'POST' && req\.url === '\/api\/agent\/kite-loop'\) \{\n\s+if \(await _isShedded\('kite_loop', res\)\) return;\n\s+if \(await _overBudget\('kite_loop', req, res\)\) return;/);
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/kite-loops'\) \{\n\s+if \(await _overBudget\('kite_loops', req, res\)\) return;/);
  });
});
