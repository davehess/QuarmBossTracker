// The hub directory (the web half of the Mimic guild picker; DECISIONS §475, §490): GET /api/hubs, the list Mimic's
// picker reads from raidmimic.com/api/hubs, and the rule that lets that one path through a raidmimic host's landing
// rewrite. Ships to main with web/app/api/hubs/route.ts, web/lib/hubDirectory.ts and web/lib/raidmimicHost.ts, and
// imports nothing from apps/mimic (that half is test/mimic-guild-picker.test.js, which ships to beta).
//
// Run: npx vitest run test/hub-directory.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. The directory route ──────────────────────────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ rows: [], error: null, calls: [], throwOnOpen: false }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => {
    if (db.throwOnOpen) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
    const q = { table: null, cols: null, filters: [] };
    const chain = {
      select(cols) { q.cols = cols; return chain; },
      is(col, val) { q.filters.push(['is', col, val]); return chain; },
      order() { return chain; },
      limit(n) { q.limit = n; return chain; },
      then(res) {
        db.calls.push(q);
        // the fake honours the one filter the route asks for, so a route that dropped it would show suspended rows
        const rows = q.filters.some(f => f[0] === 'is' && f[1] === 'suspended_at' && f[2] === null)
          ? db.rows.filter(r => !r.suspended_at) : db.rows;
        return Promise.resolve({ data: db.error ? null : rows, error: db.error }).then(res);
      },
    };
    return { from(t) { q.table = t; return chain; } };
  },
}));
vi.mock('@/lib/hubDirectory', async () => await import('../web/lib/hubDirectory.ts'));
vi.mock('@/lib/guild', async () => await import('../web/lib/guild.ts'));
const { GET } = await import('../web/app/api/hubs/route.ts');
const { buildHubDirectory } = await import('../web/lib/hubDirectory.ts');

const G = (id, extra = {}) => ({ guild_id: id, display_name: id.toUpperCase(), plan: 'commons', self_host_url: null, suspended_at: null, ...extra });
const WOLF = { slug: 'wolfpack', display_name: 'Wolf Pack', url: 'https://wolfpackparse.up.railway.app', site: 'https://wolfpack.quest' };

describe('GET /api/hubs', () => {
  it('answers Wolf Pack first, with its bot and its site, so today\'s installs see no change', async () => {
    db.rows = []; db.error = null; db.throwOnOpen = false;
    const res = await GET();
    const body = await res.json();
    expect(body[0]).toEqual(WOLF);
    expect(body).toHaveLength(1);
  });

  it('lists a commons or managed guild at the hosted bot (HUB_BOT_URL) and a self-hosted guild at its own address', async () => {
    db.rows = [G('alpha'), G('beta', { plan: 'managed' }), G('gamma', { plan: 'self_hosted', self_host_url: 'https://gamma.example/some/path' })];
    vi.stubEnv('HUB_BOT_URL', 'https://hosted.example');
    const body = await (await GET()).json();
    vi.unstubAllEnvs();
    expect(body.map(h => h.slug)).toEqual(['wolfpack', 'alpha', 'beta', 'gamma']);
    expect(body[1]).toEqual({ slug: 'alpha', display_name: 'ALPHA', plan: 'commons', url: 'https://hosted.example' });
    expect(body[2].url).toBe('https://hosted.example');
    expect(body[3].url).toBe('https://gamma.example');          // an origin, never the path the guild typed
    expect(body[3].plan).toBe('self_hosted');
  });

  it('defaults the hosted bot to the Wolf Pack bot when HUB_BOT_URL is not set', async () => {
    db.rows = [G('alpha')];
    delete process.env.HUB_BOT_URL;
    const body = await (await GET()).json();
    expect(body[1].url).toBe(WOLF.url);
  });

  it('leaves a suspended guild out, and asks the database to', async () => {
    db.calls = [];
    db.rows = [G('alpha'), G('ghost', { suspended_at: '2026-10-01T00:00:00Z' })];
    const body = await (await GET()).json();
    expect(body.map(h => h.slug)).toEqual(['wolfpack', 'alpha']);
    expect(db.calls[0].filters).toContainEqual(['is', 'suspended_at', null]);
    expect(db.calls[0].table).toBe('hub_guilds');
  });

  it('leaves out a guild with nowhere to talk to: self-hosted with no address, a bad scheme, or credentials in it', () => {
    const out = buildHubDirectory([
      G('nourl', { plan: 'self_hosted' }),
      G('plain', { plan: 'self_hosted', self_host_url: 'http://plain.example' }),
      G('creds', { plan: 'self_hosted', self_host_url: 'https://user:pw@creds.example' }),
      G('junk', { plan: 'self_hosted', self_host_url: 'not a url' }),
      G('ok', { plan: 'self_hosted', self_host_url: 'https://ok.example' }),
      G('ghost', { suspended_at: '2026-10-01T00:00:00Z' }),
    ], null);
    expect(out.map(h => h.slug)).toEqual(['wolfpack', 'ok']);
  });

  it('never lets a row take the wolfpack slug, and carries no columns beyond the list', () => {
    const out = buildHubDirectory([G('wolfpack', { display_name: 'Impostor' }), G('alpha', { self_host_url: 'https://x.example', created_by: 'secret' })], null);
    expect(out.filter(h => h.slug === 'wolfpack')).toEqual([WOLF]);
    expect(Object.keys(out[1]).sort()).toEqual(['display_name', 'plan', 'slug', 'url']);
  });

  it('still answers the fixed Wolf Pack entry when the database errors or cannot be opened', async () => {
    db.rows = [G('alpha')]; db.error = { message: 'down' };
    expect(await (await GET()).json()).toEqual([WOLF]);
    db.error = null; db.throwOnOpen = true;
    expect(await (await GET()).json()).toEqual([WOLF]);
    db.throwOnOpen = false;
  });

  it('is cached five minutes and selects only the columns the list needs', async () => {
    db.rows = []; db.calls = [];
    const res = await GET();
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=300/);
    expect(db.calls[0].cols).toBe('guild_id, display_name, plan, self_host_url, suspended_at');
    expect(db.calls[0].limit).toBeGreaterThan(0);
    const src = stripJs(read('web/app/api/hubs/route.ts'));
    expect(src).toMatch(/export const revalidate = 300/);
  });

  it('is reachable on raidmimic.com: the middleware lets exactly /api/hubs through the landing rewrite', async () => {
    const { isRaidmimicOpenPath } = await import('../web/lib/raidmimicHost.ts');
    expect(isRaidmimicOpenPath('/api/hubs')).toBe(true);
    for (const p of ['/api/hubsx', '/api/hubs/extra', '/api/agent/chat', '/api']) expect(isRaidmimicOpenPath(p), p).toBe(false);
  });
});
