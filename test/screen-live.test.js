// test/screen-live.test.js — /screen's 3-second feed comes from the bot, not from Vercel.
//
// ~60 raiders keep /screen open for a raid. Polled through Vercel that is most of a month's function
// allowance (Hobby: 1,000,000 invocations) in a night, so the page reads GET /api/screen/live on the bot
// with a short-lived ticket Vercel signs. What can go wrong without anyone noticing:
//   * the two sides of the ticket disagree by a byte (one signs, the other refuses everyone);
//   * a forged, expired or wrongly-addressed ticket is let in, or an unset secret means "anyone";
//   * the feed answers any origin, or hands out an uploader's Discord id;
//   * sixty viewers cost the database sixty times what one does (the memo that prevents it);
//   * the page never falls back to Vercel, or falls back and then asks Vercel MORE than it used to.
// These tests run the real modules: the ticket on both sides, the bot's handler against a fake PostgREST that
// enforces the 1,000-row cap, and the page's poll loop against a scripted fetch. A few text checks (what the
// board still polls, the env docs) strip comments first.
//
// Run: npx vitest run test/screen-live.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';
import {
  signScreenTicket, verifyScreenTicket, TICKET_TTL_S, TICKET_SKEW_S,
} from '../web/lib/screenTicket.ts';
import {
  parseLive, afterBotFailure, writeIsStale, judgeRead, createScreenLive,
  BOT_FAILS_BEFORE_FALLBACK, BOT_REPROBE_MS, TICKET_MIN_GAP_MS, LIVE_POLL_MS, WRITE_TRUST_MS,
} from '../web/lib/screenLive.ts';
import { buildPositions } from '../web/lib/spectator.ts';
import { buildScreenState, toScreenSlide, FEED_POLL_MS } from '../web/lib/raidScreen.ts';

const require = createRequire(import.meta.url);
const jsTicket = require('../utils/screenTicket.js');
const screenLive = require('../utils/screenLive.js');
const rt = require('../utils/raidTrack.js');

// ── What the route modules import through the web alias ─────────────────────
const st = { user: null };
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }),
}));
vi.mock('@/lib/screenTicket', async () => await import('../web/lib/screenTicket.ts'));
vi.mock('@/lib/raidScreen', async () => await import('../web/lib/raidScreen.ts'));
vi.mock('@/lib/spectator', async () => await import('../web/lib/spectator.ts'));
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    }),
  },
}));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SECRET = 'screen-test-secret-not-a-real-one';
const NOW = Date.parse('2026-10-06T01:30:00Z');
const iso = (ms) => new Date(ms).toISOString();

const ENV_KEYS = ['SCREEN_TOKEN_SECRET', 'SCREEN_ALLOWED_ORIGINS', 'SCREEN_LIVE_URL', 'RAID_TRACK_ENABLED', 'SUPABASE_GUILD_ID'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.useRealTimers();
});

// A ticket signed by hand, for the shapes the signer would never produce.
const b64u = (b) => Buffer.from(b).toString('base64url');
function forge(payload, secret = SECRET, { rawPayload } = {}) {
  const p = b64u(rawPayload ?? JSON.stringify(payload));
  return `v1.${p}.${b64u(crypto.createHmac('sha256', secret).update(`v1.${p}`).digest())}`;
}
const good = (over = {}) => ({ sub: 'user-1', aud: 'screen', iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 7200, ...over });

// ── The ticket: both sides, byte for byte ───────────────────────────────────

describe.each([
  ['the bot (utils/screenTicket.js)', (t, o) => jsTicket.verify(t, o)],
  ['the site (web/lib/screenTicket.ts)', (t, o) => verifyScreenTicket(t, o)],
])('a ticket is checked by %s', (_who, verify) => {
  it('accepts what the site signs and what the bot signs, and they are the same bytes', () => {
    const a = signScreenTicket('user-1', { secret: SECRET, nowMs: NOW });
    const b = jsTicket.sign('user-1', { secret: SECRET, nowMs: NOW });
    expect(a.token).toBe(b.token);
    expect(a.exp).toBe(b.exp);
    for (const t of [a, b]) {
      expect(verify(t.token, { secret: SECRET, nowMs: NOW })).toEqual({ ok: true, sub: 'user-1', iat: Math.floor(NOW / 1000), exp: t.exp });
    }
  });

  it('lives two hours, and takes a little clock drift either way', () => {
    const t = signScreenTicket('user-1', { secret: SECRET, nowMs: NOW });
    expect(TICKET_TTL_S).toBe(7200);
    expect(jsTicket.TTL_S).toBe(7200);
    expect(t.exp - Math.floor(NOW / 1000)).toBe(7200);
    expect(verify(t.token, { secret: SECRET, nowMs: NOW + 7200_000 + 30_000 }).ok).toBe(true);
    expect(verify(t.token, { secret: SECRET, nowMs: NOW - 30_000 }).ok).toBe(true);
  });

  it('refuses one signed with another secret', () => {
    const t = signScreenTicket('user-1', { secret: 'some-other-secret', nowMs: NOW });
    expect(verify(t.token, { secret: SECRET, nowMs: NOW })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a payload that was edited, and a signature that was', () => {
    const t = signScreenTicket('user-1', { secret: SECRET, nowMs: NOW }).token.split('.');
    const edited = b64u(JSON.stringify(good({ sub: 'someone-else' })));
    expect(verify(`v1.${edited}.${t[2]}`, { secret: SECRET, nowMs: NOW }).ok).toBe(false);
    const flipped = t[2].slice(0, -2) + (t[2].endsWith('AA') ? 'BB' : 'AA');
    expect(verify(`v1.${t[1]}.${flipped}`, { secret: SECRET, nowMs: NOW }).ok).toBe(false);
  });

  it('refuses a correctly signed ticket that is not addressed to the screen', () => {
    for (const aud of ['other', '', undefined, null, 'Screen']) {
      const r = verify(forge(good({ aud })), { secret: SECRET, nowMs: NOW });
      expect(r, String(aud)).toEqual({ ok: false, reason: 'wrong-audience' });
    }
  });

  it('refuses an expired ticket, and one dated in the future', () => {
    const t = signScreenTicket('user-1', { secret: SECRET, nowMs: NOW }).token;
    expect(verify(t, { secret: SECRET, nowMs: NOW + (7200 + TICKET_SKEW_S + 1) * 1000 })).toEqual({ ok: false, reason: 'expired' });
    expect(verify(t, { secret: SECRET, nowMs: NOW - (TICKET_SKEW_S + 5) * 1000 })).toEqual({ ok: false, reason: 'not-yet-valid' });
  });

  it('refuses a ticket claiming a longer life than we mint', () => {
    const r = verify(forge(good({ exp: Math.floor(NOW / 1000) + 3 * 24 * 3600 })), { secret: SECRET, nowMs: NOW });
    expect(r.ok).toBe(false);
  });

  it('refuses anything malformed, signed or not', () => {
    const signed = (over) => forge(good(over));
    const bad = [
      '', 'x', 'v1.a', 'v1.a.b.c', 'v2.a.b', 'v1..b', 'v1.a.', '.a.b', 'Bearer x', 'a'.repeat(3000),
      null, undefined, 42, {}, [],
      forge(null, SECRET, { rawPayload: 'not json' }),
      forge(null, SECRET, { rawPayload: '[]' }),
      forge(null, SECRET, { rawPayload: 'null' }),
      signed({ sub: '' }), signed({ sub: 7 }), signed({ sub: undefined }),
      signed({ iat: 'now' }), signed({ exp: null }), signed({ exp: undefined }),
    ];
    for (const t of bad) expect(verify(t, { secret: SECRET, nowMs: NOW }).ok, String(t).slice(0, 40)).toBe(false);
  });

  it('with no secret set, every ticket is refused, including one signed with the empty key', () => {
    const real = signScreenTicket('user-1', { secret: SECRET, nowMs: NOW }).token;
    const emptyKey = forge(good(), '');
    for (const t of [real, emptyKey]) {
      expect(verify(t, { nowMs: NOW })).toEqual({ ok: false, reason: 'no-secret' });
      expect(verify(t, { secret: '', nowMs: NOW })).toEqual({ ok: false, reason: 'no-secret' });
    }
  });
});

describe('minting', () => {
  it('needs a secret and a user: with either missing there is no ticket', () => {
    expect(signScreenTicket('user-1', { nowMs: NOW })).toBeNull();
    expect(jsTicket.sign('user-1', { nowMs: NOW })).toBeNull();
    expect(signScreenTicket('', { secret: SECRET })).toBeNull();
    expect(jsTicket.sign('', { secret: SECRET })).toBeNull();
  });

  it('reads SCREEN_TOKEN_SECRET from the environment on both sides', () => {
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    const t = signScreenTicket('user-1');
    expect(jsTicket.verify(t.token).ok).toBe(true);
    expect(verifyScreenTicket(jsTicket.sign('user-1').token).ok).toBe(true);
  });
});

// ── GET /api/screen/ticket ──────────────────────────────────────────────────

describe('GET /api/screen/ticket', () => {
  const route = async () => (await import('../web/app/api/screen/ticket/route.ts')).GET;
  beforeEach(() => { st.user = null; });

  it('is for signed-in members: no session is a 401, with nothing minted', async () => {
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    process.env.SCREEN_LIVE_URL = 'https://bot.example.test/api/screen/live';
    const res = await (await route())();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await res.json())).not.toMatch(/v1\./);
  });

  it('with the bot feed not configured it says token: null (and the page keeps polling Vercel)', async () => {
    st.user = { id: 'user-1' };
    const GET = await route();
    // neither set
    let res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: null });
    expect(res.headers.get('cache-control')).toBe('no-store');
    // only the address
    process.env.SCREEN_LIVE_URL = 'https://bot.example.test/api/screen/live';
    expect(await (await GET()).json()).toEqual({ token: null });
    // only the secret
    delete process.env.SCREEN_LIVE_URL;
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    expect(await (await GET()).json()).toEqual({ token: null });
  });

  it('with both set it hands out a ticket the bot accepts, for this user, and the bot address', async () => {
    st.user = { id: 'user-42' };
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    process.env.SCREEN_LIVE_URL = 'https://bot.example.test/api/screen/live';
    const res = await (await route())();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    expect(j.liveUrl).toBe('https://bot.example.test/api/screen/live');
    const ok = jsTicket.verify(j.token);
    expect(ok).toMatchObject({ ok: true, sub: 'user-42', exp: j.exp });
    expect(j.exp * 1000).toBeGreaterThan(Date.now() + 7000 * 1000);
  });

  it('will not send a bearer to an address that is not https (localhost excepted), or one with a login in it', async () => {
    st.user = { id: 'user-1' };
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    const GET = await route();
    for (const url of ['http://bot.example.test/api/screen/live', 'ftp://x/y', 'not a url', 'https://u:p@bot.example.test/api/screen/live']) {
      process.env.SCREEN_LIVE_URL = url;
      expect(await (await GET()).json(), url).toEqual({ token: null });
    }
    process.env.SCREEN_LIVE_URL = 'http://localhost:8080/api/screen/live';
    expect((await (await GET()).json()).token).toMatch(/^v1\./);
  });
});

// ── The bot's side ──────────────────────────────────────────────────────────

const ORIGIN = 'https://wolfpack.quest';
const BETA = 'https://b.wolfpack.quest';
// Two uploaders whose Discord ids must never leave the bot.
const UPLOADER_A = '1168893924329400001';
const UPLOADER_B = '1168893924329400002';

const mkRes = () => {
  const r = { status: null, headers: {}, body: undefined, writeHead(s, h) { r.status = s; r.headers = h || {}; }, end(b) { r.body = b; } };
  return r;
};
const head = (res, name) => {
  const k = Object.keys(res.headers).find(h => h.toLowerCase() === name.toLowerCase());
  return k ? res.headers[k] : undefined;
};
const json = (res) => JSON.parse(res.body);

// A roster row as _handleAgentRaidRoster builds it.
const rrow = (name, x, y, over = {}) => ({
  name, class: 'Warrior', group_num: 1, level: 60, hp_pct: 100, loc_x: x, loc_y: y, loc_z: 5, heading: 128, ...over,
});

function fixtureTables(clock) {
  return {
    character_live_state: [
      { guild_id: 'wolfpack', character: 'Aldenmar', zone_id: 100, updated_at: iso(clock.t - 60_000) },
      { guild_id: 'wolfpack', character: 'brackwyn', zone_id: 100, updated_at: iso(clock.t - 120_000) },
      { guild_id: 'wolfpack', character: 'Rethlan', zone_id: 101, updated_at: iso(clock.t - 30_000) },     // live, but not in the roster
      { guild_id: 'wolfpack', character: 'Corvale', zone_id: 101, updated_at: iso(clock.t - 11 * 60_000) },  // older than ten minutes
      { guild_id: 'another', character: 'Zarrin', zone_id: 100, updated_at: iso(clock.t - 10_000) },         // someone else's guild
    ],
    eqemu_zone: [
      { zone_id: 100, short_name: 'poinnovation', long_name: 'Plane of Innovation' },
      { zone_id: 101, short_name: 'potimea', long_name: 'Plane of Time' },
    ],
    raid_screen_state: [
      { guild_id: 'wolfpack', mode: 'slides', slide_index: 1, updated_by: 'Nyssara', updated_by_id: 'secret-user-id', updated_at: iso(clock.t - 5_000) },
    ],
    raid_screen_slides: [1, 2, 3].map(n => ({
      id: `00000000-0000-4000-8000-00000000000${n}`, guild_id: 'wolfpack', position: n - 1,
      title: `Slide ${n}`, body: `Body ${n}`, image_url: null, updated_at: iso(clock.t - 500_000),
    })),
  };
}

describe('the bot feed: GET /api/screen/live', () => {
  let clock, sb, failing;

  const tableCalls = (t) => sb.calls.filter(c => c.table === t).length;
  function ask({ origin, token, method = 'GET', ctx } = {}) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const res = mkRes();
    return screenLive.handle({ method, url: '/api/screen/live', headers }, res, ctx).then(() => res);
  }
  const ticket = (over = {}) => jsTicket.sign('user-1', { secret: SECRET, nowMs: clock.t, ...over }).token;

  beforeEach(() => {
    clock = { t: NOW };
    failing = new Set();
    const fake = makeCapFake({ tables: fixtureTables(clock) });
    const select = fake.select;
    fake.select = async (table, qs) => {
      if (failing.has(table)) { fake.calls.push({ kind: 'select', table, qs, failed: true }); return null; }
      return select(table, qs);
    };
    sb = fake;
    process.env.SCREEN_TOKEN_SECRET = SECRET;
    rt._reset();
    screenLive._reset();
    screenLive._setDeps({ supabase: sb, now: () => clock.t });
    // Three raiders over two uploaders, placed a moment ago.
    rt.noteRows([rrow('Aldenmar', 100, 200), rrow('Brackwyn', 110, 210)], UPLOADER_A, clock.t - 2000);
    rt.noteRows([rrow('Corvale', 300, 400, { group_num: 2 })], UPLOADER_B, clock.t - 3000);
  });
  afterEach(() => { screenLive._reset(); rt._reset(); });

  describe('who may read it', () => {
    it('401 without a ticket, with garbage, with a ticket from another secret, an expired one and one for another audience', async () => {
      const bads = [
        undefined,
        'garbage',
        jsTicket.sign('user-1', { secret: 'not-our-secret', nowMs: clock.t }).token,
        jsTicket.sign('user-1', { secret: SECRET, nowMs: clock.t - 3 * 3600_000 }).token,
        forge(good({ aud: 'something-else', iat: Math.floor(clock.t / 1000), exp: Math.floor(clock.t / 1000) + 600 })),
      ];
      for (const token of bads) {
        const res = await ask({ origin: ORIGIN, token });
        expect(res.status, String(token).slice(0, 30)).toBe(401);
        expect(head(res, 'access-control-allow-origin')).toBe(ORIGIN);   // so the page can tell "ticket refused" from "network down"
        expect(res.body).not.toMatch(/Aldenmar/);
      }
      expect(sb.calls).toEqual([]);
    });

    it('503 while SCREEN_TOKEN_SECRET is unset, whoever asks (the page then falls back to Vercel)', async () => {
      const t = ticket();
      delete process.env.SCREEN_TOKEN_SECRET;
      const res = await ask({ origin: ORIGIN, token: t });
      expect(res.status).toBe(503);
      expect(sb.calls).toEqual([]);
    });

    it('503 when the database is not configured', async () => {
      sb.isEnabled = () => false;
      expect((await ask({ origin: ORIGIN, token: ticket() })).status).toBe(503);
    });

    it('only GET reads it', async () => {
      expect((await ask({ origin: ORIGIN, token: ticket(), method: 'POST' })).status).toBe(405);
      expect((await ask({ origin: ORIGIN, token: ticket(), method: 'DELETE' })).status).toBe(405);
    });

    it('a good ticket gets the feed, and it is never cached', async () => {
      const res = await ask({ origin: ORIGIN, token: ticket() });
      expect(res.status).toBe(200);
      expect(head(res, 'cache-control')).toBe('no-store');
      expect(head(res, 'content-type')).toBe('application/json');
    });
  });

  describe('CORS: this site only, no cookies', () => {
    it('echoes an allowed origin (the site and its beta by default), with Vary: Origin, and never *', async () => {
      for (const origin of [ORIGIN, BETA]) {
        const res = await ask({ origin, token: ticket() });
        expect(head(res, 'access-control-allow-origin')).toBe(origin);
        expect(head(res, 'vary')).toMatch(/Origin/);
        expect(head(res, 'access-control-allow-credentials')).toBeUndefined();
      }
    });

    it('refuses any other origin outright, even with a good ticket, and reads nothing for it', async () => {
      for (const origin of ['https://evil.example', 'http://wolfpack.quest', 'https://wolfpack.quest.evil.example', 'https://sub.wolfpack.quest', 'null']) {
        const res = await ask({ origin, token: ticket() });
        expect(res.status, origin).toBe(403);
        expect(head(res, 'access-control-allow-origin'), origin).toBeUndefined();
        expect(res.body).not.toMatch(/Aldenmar/);
      }
      expect(sb.calls).toEqual([]);
    });

    it('answers the preflight for an allowed origin: 204, Authorization and GET allowed, cached ten minutes, no body', async () => {
      const res = await ask({ origin: ORIGIN, method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.body).toBeUndefined();
      expect(head(res, 'access-control-allow-origin')).toBe(ORIGIN);
      expect(head(res, 'access-control-allow-headers')).toMatch(/Authorization/i);
      expect(head(res, 'access-control-allow-methods')).toBe('GET');
      expect(head(res, 'access-control-max-age')).toBe('600');
      expect(sb.calls).toEqual([]);
    });

    it('refuses the preflight of an origin that is not allowed', async () => {
      const res = await ask({ origin: 'https://evil.example', method: 'OPTIONS' });
      expect(res.status).toBe(403);
      expect(head(res, 'access-control-allow-origin')).toBeUndefined();
    });

    it('SCREEN_ALLOWED_ORIGINS replaces the list, and a * in it allows nobody', async () => {
      process.env.SCREEN_ALLOWED_ORIGINS = 'https://staging.example , https://other.example/';
      expect((await ask({ origin: 'https://staging.example', token: ticket() })).status).toBe(200);
      expect((await ask({ origin: 'https://other.example', token: ticket() })).status).toBe(200);
      expect((await ask({ origin: ORIGIN, token: ticket() })).status).toBe(403);
      process.env.SCREEN_ALLOWED_ORIGINS = '*';
      expect((await ask({ origin: 'https://evil.example', token: ticket() })).status).toBe(403);
    });
  });

  describe('the payload: the inputs the page shapes with', () => {
    it('is at, positions { rows, live, zones }, state and auctions', async () => {
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(Object.keys(body).sort()).toEqual(['at', 'auctions', 'positions', 'state']);
      expect(body.at).toBe(iso(clock.t));
      expect(Object.keys(body.positions).sort()).toEqual(['live', 'rows', 'zones']);
      expect(body.positions.rows.map(r => r.name).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
      const a = body.positions.rows.find(r => r.name === 'Aldenmar');
      expect(a).toMatchObject({ class: 'Warrior', group_num: 1, level: 60, hp_pct: 100, loc_x: 100, loc_y: 200, loc_z: 5, heading: 128 });
      expect(a.loc_at).toBe(iso(clock.t - 2000));
      // Only the raiders in this roster, lowercase, from the last ten minutes of this guild: not Rethlan (not in the roster),
      // not Corvale (stale), not Zarrin (another guild).
      expect(body.positions.live).toEqual([['aldenmar', 100], ['brackwyn', 100]]);
      expect(body.positions.zones).toEqual([[100, 'poinnovation', 'Plane of Innovation']]);
      expect(body.state).toEqual({
        row: { mode: 'slides', slide_index: 1, updated_by: 'Nyssara', updated_at: iso(clock.t - 5_000) },
        slideCount: 3,
        slide: { id: '00000000-0000-4000-8000-000000000002', position: 1, title: 'Slide 2', body: 'Body 2', image_url: null, updated_at: iso(clock.t - 500_000) },
      });
      expect(body.auctions).toBeNull();
    });

    it('is shaped by the page into exactly what the Vercel routes would have answered', async () => {
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      const parsed = parseLive(body);
      // The Vercel route's inputs: raid_roster rows with the REAL uploader ids, and the zones it reads.
      const rosterRows = [
        { ...rrow('Aldenmar', 100, 200), loc_at: iso(clock.t - 2000), uploaded_by_discord_id: UPLOADER_A },
        { ...rrow('Brackwyn', 110, 210), loc_at: iso(clock.t - 2000), uploaded_by_discord_id: UPLOADER_A },
        { ...rrow('Corvale', 300, 400, { group_num: 2 }), loc_at: iso(clock.t - 3000), uploaded_by_discord_id: UPLOADER_B },
      ];
      const vercel = buildPositions(
        rosterRows,
        new Map([['aldenmar', 100], ['brackwyn', 100]]),
        new Map([[100, { short: 'poinnovation', long: 'Plane of Innovation' }]]),
        clock.t,
      );
      expect(parsed.positions).toEqual(vercel);
      // Corvale has no live zone of her own and her uploader has no other raider that does, so she is placed by
      // the raid's overall vote: the same answer on both routes.
      expect(parsed.positions.raiders.map(r => r.name)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
      expect(parsed.positions.raiders.every(r => r.zone === 'poinnovation')).toBe(true);

      const expectedState = buildScreenState(
        { mode: 'slides', slide_index: 1, updated_by: 'Nyssara', updated_at: iso(clock.t - 5_000) }, 3,
        toScreenSlide({ id: '00000000-0000-4000-8000-000000000002', position: 1, title: 'Slide 2', body: 'Body 2', image_url: null, updated_at: iso(clock.t - 500_000) }),
      );
      expect(parsed.state).toEqual(expectedState);
      expect(parsed.state.slide.title).toBe('Slide 2');
    });

    it('never carries an uploader\'s Discord id: each uploader is an opaque label, the same for the same uploader', async () => {
      const res = await ask({ origin: ORIGIN, token: ticket() });
      expect(res.body).not.toContain(UPLOADER_A);
      expect(res.body).not.toContain(UPLOADER_B);
      expect(res.body).not.toContain('secret-user-id');     // the driver's user id is not selected and not passed on
      expect(res.body).not.toContain('guild_id');
      const rows = json(res).positions.rows;
      for (const r of rows) expect(r.uploaded_by_discord_id).toMatch(/^u\d+$/);
      const byName = Object.fromEntries(rows.map(r => [r.name, r.uploaded_by_discord_id]));
      expect(byName.Aldenmar).toBe(byName.Brackwyn);
      expect(byName.Aldenmar).not.toBe(byName.Corvale);
    });

    it('rows older than thirty seconds are not sent, and a raider in another zone ((0, 0, 0)) was never kept', async () => {
      rt.noteRows([rrow('Gavrel', 0, 0, { loc_z: 0 })], UPLOADER_A, clock.t - 1000);
      rt.noteRows([rrow('Dunmar', 5, 5)], UPLOADER_A, clock.t - 31_000);
      const names = json(await ask({ origin: ORIGIN, token: ticket() })).positions.rows.map(r => r.name);
      expect(names).not.toContain('Gavrel');
      expect(names).not.toContain('Dunmar');
    });

    it('with nobody placed, positions are empty and no zone is read', async () => {
      rt._reset();
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.positions).toEqual({ rows: [], live: [], zones: [] });
      expect(tableCalls('character_live_state')).toBe(0);
      expect(tableCalls('eqemu_zone')).toBe(0);
      expect(body.state.slideCount).toBe(3);
    });

    it('does not depend on RAID_TRACK_ENABLED: the flag stops the recorder\'s timers, not the memory this reads', async () => {
      process.env.RAID_TRACK_ENABLED = '0';
      rt._reset();
      expect(rt.start()).toBe(false);
      expect(rt.noteRows([rrow('Aldenmar', 100, 200)], UPLOADER_A, clock.t - 1000)).toBe(1);
      const res = await ask({ origin: ORIGIN, token: ticket() });
      expect(res.status).toBe(200);
      expect(json(res).positions.rows.map(r => r.name)).toEqual(['Aldenmar']);
    });

    // A fresh fake database (and a fresh memo) with the fixtures changed by `mutate`.
    const withTables = (mutate) => {
      const tables = fixtureTables(clock);
      mutate(tables);
      sb = makeCapFake({ tables });
      screenLive._reset();
      screenLive._setDeps({ supabase: sb, now: () => clock.t });
    };

    it('clamps a slide index past the deck to the last slide, as the Vercel route does', async () => {
      withTables(t => { t.raid_screen_state[0].slide_index = 99; });
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.state.slide.title).toBe('Slide 3');
      expect(parseLive(body).state.slideIndex).toBe(2);
    });

    it('reads the slide that is up only in Slides mode', async () => {
      withTables(t => { t.raid_screen_state[0].mode = 'map'; });
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.state.slide).toBeNull();
      expect(body.state.slideCount).toBe(3);
      expect(sb.calls.filter(c => c.table === 'raid_screen_slides' && /(?:^|&)id=eq\./.test(c.qs))).toHaveLength(0);
    });

    it('a screen nobody has driven yet (no state row) is the Map with the deck\'s size', async () => {
      withTables(t => { t.raid_screen_state.length = 0; });
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.state).toEqual({ row: null, slideCount: 3, slide: null });
      expect(parseLive(body).state).toMatchObject({ mode: 'map', slideIndex: 0, slideCount: 3, updatedBy: null, updatedAt: null });
    });
  });

  describe('sixty viewers cost the database what one does', () => {
    it('50 simultaneous requests make one read of each table, not fifty', async () => {
      const results = await Promise.all(Array.from({ length: 50 }, () => ask({ origin: ORIGIN, token: ticket() })));
      expect(results.every(r => r.status === 200)).toBe(true);
      expect(tableCalls('character_live_state')).toBe(1);
      expect(tableCalls('eqemu_zone')).toBe(1);
      expect(tableCalls('raid_screen_state')).toBe(1);
      expect(tableCalls('raid_screen_slides')).toBe(2);   // the deck's ids, then the one slide that is up
      expect(sb.calls.length).toBe(5);
    });

    it('the same holds for sequential requests inside the windows, and each table refreshes on its own clock', async () => {
      await ask({ origin: ORIGIN, token: ticket() });
      const first = sb.calls.length;
      for (let i = 0; i < 40; i++) { clock.t += 40; await ask({ origin: ORIGIN, token: ticket() }); }   // 1.6 s of polling
      expect(sb.calls.length).toBe(first);

      clock.t = NOW + 2_100;                                    // the state window (2 s) has passed, the live one (10 s) has not
      await ask({ origin: ORIGIN, token: ticket() });
      expect(tableCalls('raid_screen_state')).toBe(2);
      expect(tableCalls('character_live_state')).toBe(1);

      clock.t = NOW + 10_100;                                   // now the live zones refresh too
      await ask({ origin: ORIGIN, token: ticket() });
      expect(tableCalls('character_live_state')).toBe(2);
      expect(tableCalls('eqemu_zone')).toBe(1);                 // zone names are kept for a day
    });

    it('one viewer or sixty for a whole minute of polling: the same ~ten reads of the live zones', async () => {
      for (let s = 0; s < 60; s++) {
        clock.t = NOW + s * 1000;
        rt.noteRows([rrow('Aldenmar', 100, 200), rrow('Brackwyn', 110, 210)], UPLOADER_A, clock.t - 500);   // the raid keeps uploading
        await Promise.all(Array.from({ length: 60 }, () => ask({ origin: ORIGIN, token: ticket() })));
      }
      expect(tableCalls('character_live_state')).toBe(6);       // 0, 10, 20, 30, 40, 50 s
      expect(tableCalls('raid_screen_state')).toBe(30);         // every 2 s
    });

    it('every read is bounded for PostgREST\'s 1,000-row cap', async () => {
      await ask({ origin: ORIGIN, token: ticket() });
      expect(sb.calls.length).toBeGreaterThan(0);
      for (const c of sb.calls) {
        const m = /(?:^|&)limit=(\d+)/.exec(c.qs);
        expect(m, `${c.table}: ${c.qs}`).toBeTruthy();
        expect(Number(m[1]), c.table).toBeLessThanOrEqual(1000);
      }
    });

    it('a failed read is not retried until its window passes, and the last good answer is served meanwhile', async () => {
      await ask({ origin: ORIGIN, token: ticket() });
      failing.add('character_live_state');
      failing.add('raid_screen_state');
      clock.t = NOW + 11_000;
      const during = await Promise.all(Array.from({ length: 20 }, () => ask({ origin: ORIGIN, token: ticket() })));
      const body = json(during[0]);
      expect(body.positions.live).toEqual([['aldenmar', 100], ['brackwyn', 100]]);   // the last good zones
      expect(body.state.slideCount).toBe(3);                                         // the last good screen
      expect(sb.calls.filter(c => c.failed && c.table === 'character_live_state')).toHaveLength(1);
      expect(sb.calls.filter(c => c.failed && c.table === 'raid_screen_state')).toHaveLength(1);
      // It recovers on its own once the database does.
      failing.clear();
      clock.t += 11_000;
      await ask({ origin: ORIGIN, token: ticket() });
      expect(sb.calls.filter(c => c.table === 'character_live_state' && !c.failed)).toHaveLength(2);
    });

    it('raiders whose zones cannot be read at all are "could not load", not an empty map; the screen state still comes', async () => {
      failing.add('character_live_state');
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.positions).toBeNull();
      expect(body.state.slideCount).toBe(3);
      const parsed = parseLive(body);
      expect(parsed.positions).toBeNull();
      expect(parsed.state.mode).toBe('slides');
    });

    it('zone names that cannot be read are the same: not a map that places nobody', async () => {
      failing.add('eqemu_zone');
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.positions).toBeNull();
    });

    it('a screen state that cannot be read is null; the map still comes', async () => {
      failing.add('raid_screen_state');
      const body = json(await ask({ origin: ORIGIN, token: ticket() }));
      expect(body.state).toBeNull();
      expect(body.positions.rows).toHaveLength(3);
      expect(parseLive(body).state).toBeNull();
    });
  });

  describe('auctions: the open ones the bot already holds, item and end time only', () => {
    const snap = (over = {}) => ({
      at: NOW - 5000,
      items: [
        { item: 'Strand of Ether', endsAt: iso(NOW + 90_000), bidder: 'Aldenmar', amount: 500, bids: [1, 2, 3] },
        { item: 'Orb of Mastery', endsAt: iso(NOW + 30_000) },
        { item: 'Long Closed', endsAt: iso(NOW - 5 * 60_000) },
        { item: '   ', endsAt: iso(NOW + 30_000) },
        { item: 'No End Yet', endsAt: null },
      ],
      ...over,
    });

    it('sends item and end time sorted by end, drops the closed and the nameless, and nothing about a bid', async () => {
      const res = await ask({ origin: ORIGIN, token: ticket(), ctx: { auctions: () => snap() } });
      expect(json(res).auctions).toEqual([
        { item: 'Orb of Mastery', endsAt: iso(NOW + 30_000) },
        { item: 'Strand of Ether', endsAt: iso(NOW + 90_000) },
        { item: 'No End Yet', endsAt: null },
      ]);
      expect(res.body).not.toMatch(/bidder|amount|bids|500/);
    });

    it('is null (the page shows the OpenDKP mirror instead) with no getter, a stale list, nothing cached, or a getter that throws', async () => {
      const cases = [
        undefined,
        { auctions: () => snap({ at: NOW - 61_000 }) },
        { auctions: () => null },
        { auctions: () => { throw new Error('boom'); } },
        { auctions: () => ({ at: 'yesterday', items: [] }) },
      ];
      for (const ctx of cases) expect(json(await ask({ origin: ORIGIN, token: ticket(), ctx })).auctions).toBeNull();
    });

    it('an empty fresh list is "nothing is up for bid" (an empty array), which is not null', async () => {
      expect(json(await ask({ origin: ORIGIN, token: ticket(), ctx: { auctions: () => ({ at: NOW - 1000, items: [] }) } })).auctions).toEqual([]);
    });
  });
});

describe('raidTrack.liveRows: the roster samples as the page\'s input', () => {
  beforeEach(() => rt._reset());
  afterEach(() => rt._reset());

  it('numbers the uploaders in this call and carries no id', () => {
    rt.noteRows([rrow('Aldenmar', 1, 2), rrow('Brackwyn', 3, 4)], UPLOADER_A, NOW - 1000);
    rt.noteRows([rrow('Corvale', 5, 6)], UPLOADER_B, NOW - 1000);
    const rows = rt.liveRows(NOW, 30_000);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(/11688939243294/);
    expect(new Set(rows.map(r => r.uploaded_by_discord_id))).toEqual(new Set(['u1', 'u2']));
  });
});

// ── The page's side: what to do when the bot does not answer ────────────────

describe('afterBotFailure: the fallback decision', () => {
  it('a 401 renews the ticket once; a refusal of the fresh one falls back', () => {
    expect(afterBotFailure({ status: 401, failures: 1, justRenewed: false })).toBe('renew');
    expect(afterBotFailure({ status: 401, failures: 1, justRenewed: true })).toBe('fallback');
  });

  it('anything else is retried until it has failed BOT_FAILS_BEFORE_FALLBACK times in a row', () => {
    for (const status of [0, 403, 500, 502, 503]) {
      for (let failures = 1; failures < BOT_FAILS_BEFORE_FALLBACK; failures++) {
        expect(afterBotFailure({ status, failures, justRenewed: false }), `${status} x${failures}`).toBe('retry');
      }
      expect(afterBotFailure({ status, failures: BOT_FAILS_BEFORE_FALLBACK, justRenewed: false }), String(status)).toBe('fallback');
    }
    expect(BOT_FAILS_BEFORE_FALLBACK).toBe(3);
  });
});

describe('writeIsStale: the leader\'s own click outranks an older read', () => {
  it('is stale only when the read is older than the click that was just written', () => {
    const wrote = iso(NOW);
    expect(writeIsStale(iso(NOW - 3000), wrote)).toBe(true);
    expect(writeIsStale(null, wrote)).toBe(true);
    expect(writeIsStale(undefined, wrote)).toBe(true);
    expect(writeIsStale(wrote, wrote)).toBe(false);
    expect(writeIsStale(iso(NOW + 3000), wrote)).toBe(false);          // another officer drove after
    expect(writeIsStale('2026-10-06T01:30:00.000+00:00', wrote)).toBe(false);   // PostgREST's spelling of the same instant
    expect(writeIsStale(iso(NOW - 3000), null)).toBe(false);           // nothing was written: nothing to protect
    expect(writeIsStale(iso(NOW - 3000), 'not a date')).toBe(false);
  });
});

describe('judgeRead: the leader\'s page does not flash back to the old screen for one poll', () => {
  const mark = { updatedAt: iso(NOW), until: NOW + WRITE_TRUST_MS };

  it('with no click to protect, every read shows', () => {
    expect(judgeRead(iso(NOW - 9000), null, NOW)).toEqual({ show: true, mark: null });
    expect(judgeRead(null, null, NOW)).toEqual({ show: true, mark: null });
  });

  it('a read from before the click is held back (and the mark kept) until the live state has caught up', () => {
    expect(judgeRead(iso(NOW - 3000), mark, NOW + 1000)).toEqual({ show: false, mark });
    expect(judgeRead(null, mark, NOW + 1000)).toEqual({ show: false, mark });
    expect(judgeRead(iso(NOW), mark, NOW + 1000)).toEqual({ show: true, mark: null });        // caught up: the read is the click
    expect(judgeRead(iso(NOW + 5000), mark, NOW + 6000)).toEqual({ show: true, mark: null }); // someone else drove since
  });

  it('after WRITE_TRUST_MS the click is no longer protected, so a screen another leader changed is never stuck', () => {
    expect(judgeRead(iso(NOW - 3000), mark, NOW + WRITE_TRUST_MS - 1).show).toBe(false);
    expect(judgeRead(iso(NOW - 3000), mark, NOW + WRITE_TRUST_MS)).toEqual({ show: true, mark: null });
  });

  it('the board feeds the POST\'s own answer into it', () => {
    const src = stripJs(read('web/app/screen/ScreenBoard.tsx'));
    expect(src).toMatch(/judgeRead\(d\.updatedAt, wrote\.current, Date\.now\(\)\)/);
    expect(src).toMatch(/wrote\.current = typeof j\.updatedAt === 'string' \? \{ updatedAt: j\.updatedAt, until: Date\.now\(\) \+ WRITE_TRUST_MS \} : null/);
    expect(src).toMatch(/if \(flying\.current\) return;/);
  });
});

describe('parseLive', () => {
  const ok = () => ({ at: iso(NOW), positions: { rows: [], live: [], zones: [] }, state: null, auctions: null });

  it('takes what the bot sends', () => {
    expect(parseLive(ok())).toEqual({ positions: { at: iso(NOW), raiders: [], zones: [], unplaced: 0 }, state: null, auctions: null });
  });

  it('is null for anything that is not that shape, so it counts as a failed read', () => {
    for (const bad of [null, undefined, 'x', [], {}, { ...ok(), at: 'never' }, { ...ok(), at: undefined },
      { ...ok(), positions: undefined }, { ...ok(), positions: {} }, { ...ok(), positions: { rows: [], live: [] } },
      { ...ok(), positions: 'x' }]) {
      expect(parseLive(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });

  it('keeps going when only the positions are missing (null): the state is still good', () => {
    const p = parseLive({ ...ok(), positions: null, state: { row: null, slideCount: 0, slide: null } });
    expect(p.positions).toBeNull();
    expect(p.state).toMatchObject({ mode: 'map', slideCount: 0 });
  });

  it('builds positions with the BOT\'s clock, so a viewer whose own clock is off still sees fresh raiders', () => {
    const row = { ...rrow('Aldenmar', 1, 2), loc_at: iso(NOW - 5000), uploaded_by_discord_id: 'u1' };
    const body = { ...ok(), positions: { rows: [row], live: [['aldenmar', 100]], zones: [[100, 'poinnovation', null]] } };
    const p = parseLive(body);
    expect(p.positions.raiders).toHaveLength(1);
    expect(p.positions.raiders[0].age_s).toBe(5);
    expect(p.positions.at).toBe(iso(NOW));
  });

  it('reads auctions as item and end time only', () => {
    const p = parseLive({ ...ok(), auctions: [{ item: 'A', endsAt: iso(NOW), bidder: 'x' }, { item: '' }, 7, { item: 'B' }] });
    expect(p.auctions).toEqual([{ item: 'A', endsAt: iso(NOW) }, { item: 'B', endsAt: null }]);
  });
});

// The poll loop, against a scripted network.
describe('createScreenLive: the poll loop and its fallback', () => {
  const LIVE = 'https://bot.example.test/api/screen/live';
  let net, sinks, loop, hidden, offset;

  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const liveBody = () => ({
    at: new Date(Date.now()).toISOString(),
    positions: { rows: [], live: [], zones: [] },
    state: { row: { mode: 'loot', slide_index: 0, updated_by: 'Nyssara', updated_at: iso(NOW) }, slideCount: 0, slide: null },
    auctions: [],
  });
  const vercelPositions = () => ({ at: iso(NOW), raiders: [], zones: [], unplaced: 0 });
  const vercelState = () => ({ mode: 'map', slideIndex: 0, slide: null, slideCount: 0, updatedBy: null, updatedAt: null });
  let tickets;

  // `script` maps a URL to a function of its call number; the default is a healthy world.
  function world(script = {}) {
    net = { calls: [], by: {} };
    tickets = 0;
    const routes = {
      '/api/screen/ticket': () => { tickets++; return reply(200, { token: `T${tickets}`, exp: Math.floor(Date.now() / 1000) + 7200, liveUrl: LIVE }); },
      [LIVE]: () => reply(200, liveBody()),
      '/api/spectator/positions': () => reply(200, vercelPositions()),
      '/api/screen/state': () => reply(200, vercelState()),
      ...script,
    };
    return async (url, init = {}) => {
      net.calls.push({ url, init, at: Date.now() });
      net.by[url] = (net.by[url] || 0) + 1;
      const r = routes[url];
      if (!r) throw new Error('unscripted ' + url);
      const out = r(net.by[url], init);
      if (out instanceof Error) throw out;
      return out;
    };
  }
  const botCalls = () => net.calls.filter(c => c.url === LIVE);
  const vercelPolls = () => net.calls.filter(c => c.url === '/api/spectator/positions' || c.url === '/api/screen/state');

  function start(script, over = {}) {
    sinks = { positions: [], states: [], auctions: [], statuses: [] };
    loop = createScreenLive({
      wantState: true,
      isHidden: () => hidden,
      fetchFn: world(script),
      now: () => Date.now() + offset,
      sinks: {
        onPositions: f => sinks.positions.push(f),
        onState: s => sinks.states.push(s),
        onAuctions: a => sinks.auctions.push(a),
        onStatus: s => sinks.statuses.push(s),
      },
      ...over,
    });
    loop.start();
  }
  const run = (ms) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hidden = false;
    offset = 0;
  });
  afterEach(() => { loop?.stop(); loop = undefined; });

  it('with the bot feed set up it reads the bot with the ticket as a bearer and never polls Vercel', async () => {
    start();
    await run(0);
    await run(LIVE_POLL_MS * 4);
    expect(net.by['/api/screen/ticket']).toBe(1);
    expect(botCalls().length).toBeGreaterThanOrEqual(4);
    expect(botCalls()[0].init.headers).toEqual({ Authorization: 'Bearer T1' });
    expect(botCalls()[0].init.credentials).toBe('omit');
    expect(vercelPolls()).toEqual([]);
    expect(sinks.states.at(-1)).toMatchObject({ mode: 'loot', updatedBy: 'Nyssara' });
    expect(sinks.positions.length).toBeGreaterThan(0);
    expect(sinks.auctions.at(-1)).toEqual([]);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'bot', netErr: false, stateErr: false });
  });

  it('polls every three seconds, one request at a time', async () => {
    start();
    await run(0);
    const n0 = botCalls().length;
    await run(LIVE_POLL_MS - 1);
    expect(botCalls().length).toBe(n0);
    await run(2);
    expect(botCalls().length).toBe(n0 + 1);
  });

  it('with token: null it polls the Vercel routes as it always did, asks for a ticket once, and never touches the bot', async () => {
    start({ '/api/screen/ticket': () => reply(200, { token: null }) });
    await run(0);
    await run(LIVE_POLL_MS * 5);
    expect(net.by['/api/screen/ticket']).toBe(1);
    expect(botCalls()).toEqual([]);
    expect(net.by['/api/spectator/positions']).toBeGreaterThanOrEqual(5);
    expect(net.by['/api/screen/state']).toBeGreaterThanOrEqual(5);
    expect(sinks.states.at(-1)).toMatchObject({ mode: 'map' });
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'vercel', netErr: false, stateErr: false });
  });

  it('a screen that only wants positions (the /spectator page) never reads the screen state', async () => {
    start({ '/api/screen/ticket': () => reply(200, { token: null }) }, { wantState: false });
    await run(LIVE_POLL_MS * 2);
    expect(net.by['/api/spectator/positions']).toBeGreaterThanOrEqual(2);
    expect(net.by['/api/screen/state']).toBeUndefined();
  });

  it('an expired ticket (the bot says 401) is renewed once and the read retried at once, with no Vercel poll', async () => {
    start({ [LIVE]: (n, init) => (init.headers.Authorization === 'Bearer T1' ? reply(401, { error: 'unauthorized' }) : reply(200, liveBody())) });
    await run(0);
    expect(net.by['/api/screen/ticket']).toBe(2);
    expect(botCalls().map(c => c.init.headers.Authorization)).toEqual(['Bearer T1', 'Bearer T2']);
    expect(vercelPolls()).toEqual([]);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'bot', netErr: false });
  });

  it('a bot that refuses even a fresh ticket sends the page to Vercel, and then costs one ticket and one probe a minute, not one a poll', async () => {
    start({ [LIVE]: () => reply(401, { error: 'unauthorized' }) });
    await run(0);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'vercel' });
    expect(vercelPolls().length).toBeGreaterThan(0);
    await run(5 * 60_000);
    // Five minutes: at most one renewal + one probe per minute (and the first pair).
    expect(net.by['/api/screen/ticket']).toBeLessThanOrEqual(2 + 6);
    expect(botCalls().length).toBeLessThanOrEqual(2 + 6);
    // And the Vercel poll rate is the old one: two routes per three seconds, nothing extra.
    expect(net.by['/api/spectator/positions']).toBeLessThanOrEqual(5 * 60 / 3 + 3);
  });

  it('after three failed reads in a row it falls back to Vercel, tries the bot again after a minute, and returns to it when it is back', async () => {
    let down = true;
    start({ [LIVE]: () => (down ? new Error('network') : reply(200, liveBody())) });
    await run(0);
    await run(LIVE_POLL_MS * 2);
    expect(botCalls().length).toBe(3);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'vercel' });
    expect(net.by['/api/spectator/positions']).toBeGreaterThanOrEqual(1);

    const before = botCalls().length;
    await run(BOT_REPROBE_MS - 4000);
    expect(botCalls().length).toBe(before);                      // still inside the minute: no probe
    down = false;
    await run(8000);
    expect(botCalls().length).toBeGreaterThan(before);           // probed, answered
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'bot', netErr: false });
    const polls = vercelPolls().length;
    await run(LIVE_POLL_MS * 3);
    expect(vercelPolls().length).toBe(polls);                    // and back to the bot for good
  });

  it('one or two bad reads are retried on the bot, not turned into Vercel traffic', async () => {
    start({ [LIVE]: (n) => (n <= 2 ? reply(503, { error: 'unavailable' }) : reply(200, liveBody())) });
    await run(0);
    await run(LIVE_POLL_MS * 3);
    expect(vercelPolls()).toEqual([]);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'bot', netErr: false });
  });

  it('a bot answer that is not the feed counts as a failed read', async () => {
    start({ [LIVE]: () => reply(200, { hello: 'world' }) });
    await run(0);
    await run(LIVE_POLL_MS * 4);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'vercel' });
    expect(sinks.positions.every(f => Array.isArray(f.data.raiders))).toBe(true);
  });

  it('positions the bot could not give are netErr for the map while the screen state still follows', async () => {
    start({ [LIVE]: () => reply(200, { ...liveBody(), positions: null }) });
    await run(0);
    expect(sinks.statuses.at(-1)).toMatchObject({ transport: 'bot', netErr: true, stateErr: false });
    expect(sinks.positions).toEqual([]);
    expect(sinks.states.at(-1)).toMatchObject({ mode: 'loot' });
  });

  it('a hidden tab makes no requests at all, and reading resumes the moment it is shown', async () => {
    hidden = true;
    start();
    await run(LIVE_POLL_MS * 3);
    expect(net.calls).toEqual([]);
    hidden = false;
    loop.visibilityChanged();
    await run(0);
    expect(botCalls().length).toBe(1);
  });

  it('going hidden mid-poll stops the loop; showing again restarts it', async () => {
    start();
    await run(0);
    const n = net.calls.length;
    hidden = true;
    loop.visibilityChanged();
    await run(LIVE_POLL_MS * 5);
    expect(net.calls.length).toBe(n);
    hidden = false;
    loop.visibilityChanged();
    await run(0);
    expect(net.calls.length).toBeGreaterThan(n);
  });

  it('a session that ended (Vercel says 401 for the ticket) stops the loop and says so', async () => {
    start({ '/api/screen/ticket': () => reply(401, { error: 'unauthorized' }) });
    await run(0);
    await run(LIVE_POLL_MS * 5);
    expect(sinks.statuses.at(-1).signedOut).toBe(true);
    expect(net.calls.length).toBe(1);
  });

  it('a viewer whose clock is hours ahead asks for a ticket once a minute at most, not once a poll', async () => {
    offset = 3 * 3600_000;             // every ticket looks expired to this page
    start();
    await run(0);
    await run(5 * 60_000);
    expect(net.by['/api/screen/ticket']).toBeLessThanOrEqual(1 + 5 * 60_000 / TICKET_MIN_GAP_MS + 1);
    expect(net.by['/api/screen/ticket']).toBeGreaterThan(0);
  });

  it('renews the ticket before it ends, and the new one is the bearer from then on', async () => {
    start();
    await run(0);
    await run((7200 - 5 * 60) * 1000 + 10_000);                   // past the renewal point
    expect(net.by['/api/screen/ticket']).toBe(2);
    expect(botCalls().at(-1).init.headers.Authorization).toBe('Bearer T2');
    expect(vercelPolls()).toEqual([]);
  });

  it('kick() reads at once (after the leader\'s click) instead of waiting out the interval', async () => {
    start();
    await run(0);
    const n = botCalls().length;
    await run(1000);
    loop.kick();
    await run(0);
    expect(botCalls().length).toBe(n + 1);
  });
});

// ── Text checks: what a behaviour test cannot run ───────────────────────────

describe('the pages and the wiring', () => {
  it('the screen reads state and positions through the hook, and no longer polls them on Vercel by itself', () => {
    const src = stripJs(read('web/app/screen/ScreenBoard.tsx'));
    expect(src).toMatch(/useScreenLive\(\{\s*wantState: true/);
    expect(src).not.toMatch(/usePoll<ScreenState>/);
    expect(src).not.toMatch(/usePoll<Positions>/);
    expect(src).not.toMatch(/\/api\/spectator\/positions/);
    // The one mention of the state route is the leader's write.
    expect(src.match(/\/api\/screen\/state/g)).toHaveLength(1);
    expect(src).toMatch(/fetch\('\/api\/screen\/state', \{\s*method: 'POST'/);
    // The slow feed stays on Vercel, once a minute, and once more when the screen switches to Loot or Overview.
    expect(src).toMatch(/usePoll<ScreenFeed>\('\/api\/screen\/feed', FEED_POLL_MS/);
    expect(src).toMatch(/shown === 'loot' \|\| shown === 'overview'\) kickFeed\(\)/);
    expect(FEED_POLL_MS).toBe(60_000);
  });

  it('the standalone spectator board reads through the hook only when it was not handed positions', () => {
    const src = stripJs(read('web/app/spectator/SpectatorBoard.tsx'));
    expect(src).toMatch(/useScreenLive\(\{ enabled: shared === undefined \}\)/);
    expect(src).toMatch(/const \{ feed, netErr, signedOut \} = shared \?\? own;/);
    expect(src).not.toMatch(/fetch\('\/api\/spectator\/positions'/);
    expect(LIVE_POLL_MS).toBe(3000);
  });

  it('the bot routes the feed, GET and the preflight, to the handler, past the agent routes\' auth', () => {
    const src = stripJs(read('index.js'));
    expect(src).toMatch(/\(req\.method === 'GET' \|\| req\.method === 'OPTIONS'\) && req\.url\.split\('\?'\)\[0\] === '\/api\/screen\/live'/);
    expect(src).toMatch(/require\('\.\/utils\/screenLive'\)\.handle\(req, res, \{ auctions: _peekPanelAuctions \}\)/);
  });

  it('the new settings are documented where they are set', () => {
    const bot = read('.env.example');
    expect(bot).toMatch(/^SCREEN_TOKEN_SECRET=/m);
    expect(bot).toMatch(/^SCREEN_ALLOWED_ORIGINS=/m);
    const web = read('web/.env.example');
    expect(web).toMatch(/^SCREEN_TOKEN_SECRET=/m);
    expect(web).toMatch(/^SCREEN_LIVE_URL=/m);
    expect(read('web/README.md')).toMatch(/SCREEN_LIVE_URL/);
  });

  it('the secret is not in the repo', () => {
    for (const f of ['.env.example', 'web/.env.example']) {
      const m = /^SCREEN_TOKEN_SECRET=(.*)$/m.exec(read(f));
      expect((m?.[1] ?? '').trim(), f).toBe('');
    }
  });
});
