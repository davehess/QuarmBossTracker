// test/raid-live.test.js — "is a raid on the ground right now?" (utils/raidTrack.js liveSnapshot and
// GET /api/agent/raid-live), the signal Bristlebane (apps/bristlebane) joins and leaves the raid voice
// channel on.
//
// What can go wrong without anyone noticing: the snapshot counting a raider the recorder would not put in a
// frame (so the voice bot joins a raid the replay never recorded), counting stale samples (a raid that ended
// minutes ago still reads live), or the read quietly becoming a writer. The route also takes Bristlebane's
// own bearer key (BRISTLEBANE_API_KEY): what can go wrong there is the key opening more than this route,
// a wrong or missing key getting in, or a deploy that never set the variable behaving differently. The
// handler's wiring is checked as text with comments stripped; its behaviour is the real handler, sliced
// out of index.js and run against fakes.
//
// Run: npx vitest run test/raid-live.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const rt = require('../utils/raidTrack.js');
const serviceKey = require('../utils/serviceKey.js');

const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);

const NAMES = ['Aldenmar', 'Brackwyn', 'Corvale', 'Gavrel', 'Rethlan', 'Nyssara', 'Zarrin', 'Dunmar'];
const row = (name, x = 100, y = 200, z = 5) => ({ name, class: 'Warrior', group_num: 1, level: 60, hp_pct: null, loc_x: x, loc_y: y, loc_z: z, heading: null });
const note = (names, at, src = 'u1') => rt.noteRows(names.map((n, i) => row(n, 100 + i, 200 + i)), src, at);

beforeEach(() => { rt._reset(); delete process.env.RAID_TRACK_MIN_PLACED; });
afterEach(() => { rt._reset(); });

describe('liveSnapshot', () => {
  it('is { placed: 0, lastRowAt: null } before anything has been noted', () => {
    expect(rt.liveSnapshot(T0)).toEqual({ placed: 0, lastRowAt: null });
  });

  it('counts the raiders placed in the last FRESH_MS and reports the newest sample', () => {
    note(NAMES.slice(0, 5), T0);
    note(NAMES.slice(5), T0 + 2000);
    expect(rt.liveSnapshot(T0 + 3000)).toEqual({ placed: 8, lastRowAt: T0 + 2000 });
  });

  it('a sample exactly FRESH_MS old still counts, one millisecond older does not', () => {
    note(NAMES.slice(0, 3), T0);
    note(NAMES.slice(3, 8), T0 + 1);
    expect(rt.liveSnapshot(T0 + rt.FRESH_MS).placed).toBe(8);
    expect(rt.liveSnapshot(T0 + rt.FRESH_MS + 1).placed).toBe(5);
  });

  it('keeps reporting lastRowAt for a raid that has gone quiet, with nobody placed', () => {
    note(NAMES, T0);
    const quiet = rt.liveSnapshot(T0 + 60_000);
    expect(quiet.placed).toBe(0);
    expect(quiet.lastRowAt).toBe(T0);
  });

  it('does not count a raider in another zone ((0,0,0)) — the same rule the recorder uses', () => {
    rt.noteRows([row('Aldenmar', 0, 0, 0), row('Brackwyn', 0, 0, 0), row('Corvale', 10, 20, 3)], 'u1', T0);
    expect(rt.liveSnapshot(T0 + 1000).placed).toBe(1);
  });

  it('counts a raider once however many uploaders report them', () => {
    note(NAMES.slice(0, 4), T0, 'u1');
    note(NAMES.slice(0, 4), T0 + 500, 'u2');
    note(NAMES.slice(0, 4), T0 + 900, 'u3');
    expect(rt.liveSnapshot(T0 + 1000).placed).toBe(4);
  });

  it('agrees with takeFrame about whether the raid is worth recording', () => {
    for (const n of [5, 6]) {
      rt._reset();
      note(NAMES.slice(0, n), T0);
      const snap = rt.liveSnapshot(T0 + 1000);
      expect(snap.placed).toBe(n);
      expect(snap.placed >= rt.minPlaced()).toBe(rt.takeFrame(T0 + 1000) !== null);
    }
    // …and it follows RAID_TRACK_MIN_PLACED the way the recorder does
    process.env.RAID_TRACK_MIN_PLACED = '3';
    rt._reset();
    note(NAMES.slice(0, 3), T0);
    expect(rt.liveSnapshot(T0 + 1000).placed >= rt.minPlaced()).toBe(true);
  });

  it('is read-only: it forgets nothing and starts no frame', () => {
    note(NAMES, T0);
    const before = rt._state();
    rt.liveSnapshot(T0 + 10 * 60_000);   // long past PRUNE_MS
    rt.liveSnapshot(T0 + 1000);
    expect(rt._state()).toEqual(before);
    expect(rt._state().curFrames).toBe(0);
  });

  it('defaults to the injected clock when no time is given', () => {
    note(NAMES, T0);
    rt._setDeps({ now: () => T0 + 1000 });
    expect(rt.liveSnapshot().placed).toBe(8);
  });
});

describe('GET /api/agent/raid-live wiring (text, comments stripped)', () => {
  const bot = readSource(BOT_INDEX);
  const code = stripJs(bot);

  it('is a GET route that calls its handler inside a try/catch that answers 500', () => {
    const route = sliceBlock(code, "req.method === 'GET' && req.url.startsWith('/api/agent/raid-live')", "res.end(JSON.stringify({ error: 'internal error' }));");
    expect(route).toMatch(/req\.method === 'GET'/);
    expect(route).toMatch(/_handleAgentRaidLive\(req, res\)/);
    expect(route).toMatch(/catch \(err\)/);
    expect(route).toMatch(/writeHead\(500/);
  });

  it('checks the bearer before anything else, and reads memory plus the 60 s cached End-raid flag only', () => {
    const handler = stripJs(sliceBlock(bot, 'async function _handleAgentRaidLive(req, res) {', '\n}\n'));
    expect(handler.indexOf('mimicLink.requireAgentAuth(req, res)')).toBeGreaterThan(-1);
    expect(handler.indexOf('requireAgentAuth')).toBeLessThan(handler.indexOf('liveSnapshot'));
    expect(handler).toMatch(/raidTrack\.liveSnapshot\(now\)/);
    expect(handler).toMatch(/live: placed >= raidTrack\.minPlaced\(\)/);
    expect(handler).toMatch(/_raidEndedInfo\(nightKey\)/);          // the cached bot_kv read, not a second query
    expect(handler).toMatch(/isInRaidWindow\(now\)/);
    expect(handler).not.toMatch(/supabase\.(select|selectAllPaged|upsert|insert|update|del)\(/);
    // every field the caller reads is in the answer
    for (const k of ['live', 'placed', 'lastRowAt', 'nightKey', 'ended', 'inWindow']) {
      expect(handler).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('the service key is read in this one handler and nowhere else in the bot', () => {
    expect(code.match(/BRISTLEBANE_API_KEY/g)).toHaveLength(1);
    expect(code.match(/matchesServiceKey/g)).toHaveLength(1);
    const handler = stripJs(sliceBlock(bot, 'async function _handleAgentRaidLive(req, res) {', '\n}\n'));
    expect(handler.indexOf('matchesServiceKey(req, process.env.BRISTLEBANE_API_KEY)')).toBeGreaterThan(-1);
    // the check only SKIPS requireAgentAuth; it never replaces it
    expect(handler).toMatch(/if \(!require\('\.\/utils\/serviceKey'\)\.matchesServiceKey\(req, process\.env\.BRISTLEBANE_API_KEY\)\) \{\s*const identity = await mimicLink\.requireAgentAuth\(req, res\);\s*if \(!identity\) return;\s*\}/);
  });
});

describe('matchesServiceKey', () => {
  const KEY = 'k'.repeat(40);
  const reqWith = (auth) => ({ headers: auth === undefined ? {} : { authorization: auth } });

  it('accepts the key as a Bearer token, whatever the case of "Bearer" and padding', () => {
    expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY}`), KEY)).toBe(true);
    expect(serviceKey.matchesServiceKey(reqWith(`bearer   ${KEY}  `), KEY)).toBe(true);
    expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY}`), `  ${KEY}\n`)).toBe(true);
  });

  it('rejects a wrong key of the same length, a different length, a prefix and a longer one', () => {
    expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${'x'.repeat(40)}`), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(reqWith('Bearer short'), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY.slice(0, -1)}`), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY}x`), KEY)).toBe(false);
  });

  it('needs the Bearer scheme: the bare key, another scheme and no header all fail', () => {
    expect(serviceKey.matchesServiceKey(reqWith(KEY), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(reqWith(`Basic ${KEY}`), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(reqWith(undefined), KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey({}, KEY)).toBe(false);
    expect(serviceKey.matchesServiceKey(undefined, KEY)).toBe(false);
  });

  it('an unset, blank or non-string key matches nothing — not even an empty bearer', () => {
    for (const key of [undefined, null, '', '   ', 0, {}]) {
      expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY}`), key)).toBe(false);
      expect(serviceKey.matchesServiceKey(reqWith('Bearer '), key)).toBe(false);
      expect(serviceKey.matchesServiceKey(reqWith(undefined), key)).toBe(false);
    }
  });

  it('compares with crypto.timingSafeEqual on equal-length buffers, and never calls it on unequal ones (it would throw)', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    try {
      expect(serviceKey.matchesServiceKey(reqWith(`Bearer ${KEY}`), KEY)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      const [a, b] = spy.mock.calls[0];
      expect(Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length).toBe(true);
      expect(() => serviceKey.matchesServiceKey(reqWith('Bearer nope'), KEY)).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});

// The real handler, cut out of index.js and run against fakes: a wrong key must reach requireAgentAuth, the
// right one must not, and either way a good answer has the whole shape.
describe('GET /api/agent/raid-live: the two ways in', () => {
  const bot = readSource(BOT_INDEX);
  const rootRequire = createRequire(path.join(ROOT, 'index.js'));
  const KEY = 'bristlebane-key-0123456789abcdef';
  const SESSION = 'wpms_a_real_session_token';
  const OLD_KEY = process.env.BRISTLEBANE_API_KEY;

  function makeHandler() {
    const calls = { auth: 0, ended: [] };
    const mimicLink = {
      requireAgentAuth: async (req, res) => {
        calls.auth++;
        if (req.headers.authorization === `Bearer ${SESSION}`) return { discord_id: '1' };
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return null;
      },
    };
    const fakeRequire = (p) => (p === './utils/supabase' ? { isEnabled: () => true } : rootRequire(p));
    const _raidEndedInfo = async (nightKey) => { calls.ended.push(nightKey); return { ended: true }; };
    const block = sliceBlock(bot, 'async function _handleAgentRaidLive(req, res) {', '\n}\n');
    // eslint-disable-next-line no-new-func
    const handler = new Function('mimicLink', 'require', '_raidEndedInfo', 'process', `${block}\nreturn _handleAgentRaidLive;`)(
      mimicLink, fakeRequire, _raidEndedInfo, process);
    return { handler, calls };
  }
  async function call(handler, auth) {
    const out = { status: null, body: null };
    const res = { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = JSON.parse(b); } };
    await handler({ headers: auth === undefined ? {} : { authorization: auth } }, res);
    return out;
  }
  const placeRaid = () => {
    rt._reset();
    rt.noteRows(NAMES.slice(0, 7).map((n, i) => row(n, 100 + i, 200 + i)), 'u1', Date.now());
  };

  beforeEach(() => { placeRaid(); });
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.BRISTLEBANE_API_KEY; else process.env.BRISTLEBANE_API_KEY = OLD_KEY;
  });

  it('the right key is answered without ever asking for a session token', async () => {
    process.env.BRISTLEBANE_API_KEY = KEY;
    const { handler, calls } = makeHandler();
    const r = await call(handler, `Bearer ${KEY}`);
    expect(calls.auth).toBe(0);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ live: true, placed: 7, ended: true, inWindow: expect.any(Boolean) });
    expect(typeof r.body.nightKey).toBe('string');
    expect(calls.ended).toEqual([r.body.nightKey]);
  });

  it('a wrong key (same length or not) or no header goes to requireAgentAuth and is refused', async () => {
    process.env.BRISTLEBANE_API_KEY = KEY;
    const { handler, calls } = makeHandler();
    for (const auth of [`Bearer ${'z'.repeat(KEY.length)}`, 'Bearer nope', undefined, KEY]) {
      const before = calls.auth;
      const r = await call(handler, auth);
      expect(calls.auth).toBe(before + 1);
      expect(r.status).toBe(401);
    }
  });

  it('a real session token still works while the key is set', async () => {
    process.env.BRISTLEBANE_API_KEY = KEY;
    const { handler, calls } = makeHandler();
    const r = await call(handler, `Bearer ${SESSION}`);
    expect(calls.auth).toBe(1);
    expect(r.status).toBe(200);
    expect(r.body.live).toBe(true);
  });

  it('with the key unset the route is exactly what it was: the key is refused, a session token is not', async () => {
    delete process.env.BRISTLEBANE_API_KEY;
    const { handler, calls } = makeHandler();
    expect((await call(handler, `Bearer ${KEY}`)).status).toBe(401);
    expect((await call(handler, `Bearer ${SESSION}`)).status).toBe(200);
    expect(calls.auth).toBe(2);
    process.env.BRISTLEBANE_API_KEY = '';
    expect((await call(handler, 'Bearer ')).status).toBe(401);
    expect(calls.auth).toBe(3);
  });
});
