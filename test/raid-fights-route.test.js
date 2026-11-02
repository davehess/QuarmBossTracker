// test/raid-fights-route.test.js — GET /api/agent/raid-fights, the "Raid" list in Mimic's DPS History.
//
// Runs the REAL handler (sliced from index.js) with a recording Supabase stub: the window clamp, the guild
// scope, the shape of one fight, the 20 s cache shared by many callers, and the auth gate.
//
// Run: npx vitest run test/raid-fights-route.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const req = createRequire(BOT_INDEX);
const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'const _raidFightsCache = new Map();', '\n}\n');

const ENC = (id, name, extra = {}) => ({
  id, npc_id: 1000 + id.length, started_at: '2026-11-01T01:00:00Z', ended_at: '2026-11-01T01:03:00Z',
  duration_sec: 180, is_wipe: false, eqemu_npc_types: { name }, ...extra,
});

function build({ encs = [], contribs = [], authed = true, failEncs = false, failContribs = false } = {}) {
  const queries = [];
  const supabase = {
    select: async (table, q) => {
      queries.push({ table, q });
      if (table === 'encounters') return failEncs ? null : encs;
      if (table === 'contributions') return failContribs ? null : contribs;
      return [];
    },
    // The contributions read is paged (more rows than one PostgREST page); the stub answers it in one go.
    selectAllPaged: async (table, q, order) => {
      queries.push({ table, q, order });
      if (table === 'contributions') return failContribs ? null : contribs;
      return [];
    },
  };
  const mimicLink = {
    requireAgentAuth: async (_rq, rs) => {
      if (authed) return { discord_id: '1' };
      rs.writeHead(401, {}); rs.end('{}'); return null;
    },
  };
  const fn = new Function('mimicLink', 'require', 'process',
    block + '\nreturn _handleAgentRaidFights;')(
    mimicLink,
    (p) => (String(p).endsWith('supabase') ? supabase : req(p)),
    { env: { SUPABASE_GUILD_ID: 'wolfpack' } });
  const call = async (url) => {
    const res = { status: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    await fn({ url }, res);
    return res;
  };
  return { call, queries };
}

describe('/api/agent/raid-fights', () => {
  it('returns each ended fight once with how many clients sent it, named like the other routes', async () => {
    const { call, queries } = build({
      encs: [ENC('aaaa', '#A_Brann_Geistlig'), ENC('bbbbbb', 'Lord_Nagafen', { is_wipe: true, duration_sec: null })],
      contribs: [
        { encounter_id: 'aaaa', uploaded_by_discord_id: 'u1', contributor_character: 'X' },
        { encounter_id: 'aaaa', uploaded_by_discord_id: 'u1', contributor_character: 'X' },   // same uploader twice
        { encounter_id: 'aaaa', uploaded_by_discord_id: 'u2', contributor_character: 'Y' },
        { encounter_id: 'aaaa', uploaded_by_discord_id: null, contributor_character: 'Pasted' },
      ],
    });
    const r = await call('/api/agent/raid-fights');
    expect(r.status).toBe(200);
    const { fights } = JSON.parse(r.body);
    expect(fights).toHaveLength(2);
    expect(fights[0]).toEqual({
      id: 'aaaa', name: 'A Brann Geistlig', npc_id: 1004, started_at: '2026-11-01T01:00:00Z',
      ended_at: '2026-11-01T01:03:00Z', duration_s: 180, wipe: false, clients: 3,
    });
    expect(fights[1]).toMatchObject({ name: 'Lord Nagafen', duration_s: 180, wipe: true, clients: 0 });
    // two reads: the fights, then their uploaders keyed to the fights just found, paged on the primary key
    expect(queries.map(q => q.table)).toEqual(['encounters', 'contributions']);
    expect(queries[1].q).toContain('encounter_id=in.(aaaa,bbbbbb)');
    expect(queries[1].order).toBe('id');
  });

  it('scopes to the guild, ended fights, guild kills and wipes, newest first, at most 60', async () => {
    const { call, queries } = build({ encs: [] });
    const r = await call('/api/agent/raid-fights');
    expect(JSON.parse(r.body)).toEqual({ fights: [] });
    const q = decodeURIComponent(queries[0].q);
    expect(q).toContain('guild_id=eq.wolfpack');
    expect(q).toContain('ended_at=not.is.null');
    expect(q).toContain('or=(classification.is.null,classification.eq.wipe)');
    expect(q).toContain('order=started_at.desc');
    expect(q).toContain('limit=60');
    expect(queries).toHaveLength(1);   // nothing found: no side reads
  });

  it('defaults to 8 hours back and never reaches past 12', async () => {
    const hrs = (q) => (Date.now() - Date.parse(/started_at=gte\.([^&]+)/.exec(decodeURIComponent(q))[1])) / 3600_000;
    const a = build(); await a.call('/api/agent/raid-fights');
    expect(hrs(a.queries[0].q)).toBeGreaterThan(7.9);
    expect(hrs(a.queries[0].q)).toBeLessThan(8.1);
    const b = build(); await b.call('/api/agent/raid-fights?since=2020-01-01T00:00:00Z');
    expect(hrs(b.queries[0].q)).toBeGreaterThan(11.9);
    expect(hrs(b.queries[0].q)).toBeLessThan(12.1);
    const c = build(); await c.call('/api/agent/raid-fights?since=' + new Date(Date.now() - 2 * 3600_000).toISOString());
    expect(hrs(c.queries[0].q)).toBeGreaterThan(1.9);
    expect(hrs(c.queries[0].q)).toBeLessThan(2.1);
    const d = build(); await d.call('/api/agent/raid-fights?since=garbage');
    expect(hrs(d.queries[0].q)).toBeGreaterThan(7.9);
  });

  it('many callers inside the window cost one set of reads', async () => {
    const { call, queries } = build({ encs: [ENC('aaaa', 'X')] });
    const since = new Date(Date.now() - 3600_000).toISOString();
    const rs = await Promise.all(Array.from({ length: 50 }, () => call('/api/agent/raid-fights?since=' + since)));
    expect(new Set(rs.map(r => r.body)).size).toBe(1);
    expect(queries).toHaveLength(2);
  });

  it('a failed encounters read is a 502 and is not cached', async () => {
    const t = build({ failEncs: true });
    const r = await t.call('/api/agent/raid-fights?since=2026-01-01T00:00:00Z');
    expect(r.status).toBe(502);
    const again = await t.call('/api/agent/raid-fights?since=2026-01-01T00:00:00Z');
    expect(again.status).toBe(502);
    expect(t.queries.filter(q => q.table === 'encounters')).toHaveLength(2);
  });

  it('a failed side read leaves its numbers null and is not cached', async () => {
    const t = build({ encs: [ENC('aaaa', 'X')], failContribs: true });
    const r = await t.call('/api/agent/raid-fights');
    expect(JSON.parse(r.body).fights[0].clients).toBeNull();
    await t.call('/api/agent/raid-fights');
    expect(t.queries.filter(q => q.table === 'encounters')).toHaveLength(2);
  });

  it('answers nothing before auth succeeds', async () => {
    const t = build({ authed: false });
    const r = await t.call('/api/agent/raid-fights');
    expect(r.status).toBe(401);
    expect(t.queries).toHaveLength(0);
  });

  it('is routed, and no hub or guest allowlist lists it', () => {
    expect(stripJs(src)).toMatch(/req\.url\.startsWith\('\/api\/agent\/raid-fights'\)[\s\S]{0,80}_handleAgentRaidFights/);
    const link = req('./utils/mimicLink');
    expect(link.hubRouteAllowed('GET', '/api/agent/raid-fights?since=x')).toBe(false);
    expect(link.guestRouteAllowed('GET', '/api/agent/raid-fights')).toBe(false);
  });
});
