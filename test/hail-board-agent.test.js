// test/hail-board-agent.test.js — the agent half of the Command Center's hail board.
//
// The guild lead, 2026-10-05 (option A, one board the whole raid shares): when a PoP boss dies its flag
// NPC stands for 20 minutes and every raider has to hail it. The bot keeps the board; the agent
//   • sends the hails it sees (yours, and the ones around you) as pop_flag rows,
//   • polls GET /api/agent/hail-board (30 s idle, 5 s while a window is open, 10 min after a 404),
//   • hands the board to the Command Center as state.hail, narrowed to this raid,
//   • relays a tap on a name to POST /api/agent/hail-mark.
//
// SOURCE-SLICE tier: it runs the agent's real functions against a fake network and a fake clock.
// Names are invented.
//
// Run: npx vitest run test/hail-board-agent.test.js

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { readSource, AGENT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const block = sliceBlock(agent, '// ── Hail board (the guild lead, 2026-10-05', '\n// Words that mark a bid call.');
const readBodySrc = sliceBlock(agent, 'async function _readBody(req, max = 64 * 1024) {', '\n}\n');
const parseSrc = sliceBlock(agent, 'const _HAIL_WITNESS_RX', "ts:        ts ? ts.toISOString() : new Date().toISOString(),\n  };\n}");
const crossLogSrc = sliceBlock(agent, 'const CROSSLOG_TTL_MS = 90_000;', '\n}\n');

const BOT = 'https://bot.example/api/agent/encounter';
const soon = (ms) => new Date(Date.now() + ms).toISOString();

// A fake http/https module: records every request and answers from `script(options, body)`.
function fakeNet(script) {
  const calls = [];
  const mod = {
    request(options, cb) {
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = (body) => {
        calls.push({ options, body });
        const r = script(options, body);
        queueMicrotask(() => {
          if (r === 'error') return req.emit('error', new Error('ECONNRESET'));
          const res = new EventEmitter();
          res.statusCode = r.status;
          cb(res);
          res.emit('data', r.body == null ? '' : r.body);
          res.emit('end');
        });
      };
      return req;
    },
  };
  return { mod, calls };
}
const flush = () => new Promise((r) => setImmediate(r));

function load({ opts = { botUrl: BOT, token: 'tok' }, down = false, reply } = {}) {
  const net = fakeNet(reply || (() => ({ status: 200, body: '{"windows":[]}' })));
  const timers = [];
  const fakeSetTimeout = (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; };
  const stats = { activeCharacter: 'Aldenmar', watchedLogs: [] };
  const state = { down };
  // eslint-disable-next-line no-new-func
  const api = new Function('https', 'http', '_uploadOpts', '_controlStandDown', '_nowOnServerClock', 'AGENT_VERSION', 'setTimeout', '_readBody', 'stats',
    readBodySrc + '\n' + block + '\nreturn { _pollHailBoard, _applyHailBoard, _hailBoardSnapshot, _hailNpcWanted, _hailMarkRelay, _handleHailMark,'
    + ' _localOriginOk, _hailNormWindow, board: () => _hailBoard };')(
    net.mod, net.mod, opts, () => ({ down: state.down }), () => Date.now(), '3.7.89', fakeSetTimeout, undefined, stats);
  return { api, net, timers, stats, state, opts };
}

const win = (over = {}) => ({
  id: 'w1', boss_id: 'aerindar', boss_name: 'Aerin`Dar', npc_name: 'A Planar Projection', zone: 'povalor',
  opened_at: soon(-120_000), expires_at: soon(18 * 60_000),
  still: [{ name: 'Brackwyn', prior_missing: false }, { name: 'Corvale', prior_missing: true }, { name: 'Rethlan', prior_missing: false }],
  hailed: [{ name: 'Kestrin', how: 'flag' }, { name: 'Valmora', how: 'seen' }, { name: 'Ysolde', how: 'marked', by: 'Halvard' }],
  already_flagged: ['Thessaly', 'Ordeth'], seen_by: 9, ...over,
});

describe('which live hails leave the machine', () => {
  const { api } = load();
  it('the flag NPCs the board is built around', () => {
    for (const npc of ['A Planar Projection', 'a planar projection', 'The Planar Projection', 'Tylis Newleaf', 'Giwin Mirakon',
      'Nitram Anizok', 'Tarkil Adan', 'Tarkil Adan!', 'Mavuin', 'Elder Poxbourne', 'Seer Mal Nae']) {
      expect(api._hailNpcWanted(npc), npc).toBe(true);
    }
  });
  it('not a banker, a player greeted in passing, or nothing', () => {
    for (const npc of ['Banker Zorn', 'friend', 'Brackwyn', 'Planar', '', null]) expect(api._hailNpcWanted(npc), String(npc)).toBe(false);
  });
  it('an NPC a window on the board stands for is wanted once the board says so', () => {
    const h = load();
    expect(h.api._hailNpcWanted('An Unlisted Flag NPC')).toBe(false);
    h.api._applyHailBoard({ windows: [win({ npc_name: 'An Unlisted Flag NPC' })] }, Date.now());
    expect(h.api._hailNpcWanted('An Unlisted Flag NPC')).toBe(true);
    expect(h.api._hailNpcWanted('unlisted flag npc')).toBe(true);
  });
});

// The live tail's own lines, run through the real parser, the real gate and the real cross-log dedup.
describe('the live tail uploads hails', () => {
  const wire = sliceBlock(agent, "if (!_sourceExcluded) {\n          const hailEvt = parseWitnessedHail(line, b.character);\n          if (hailEvt && _hailNpcWanted(hailEvt.npc)",
    'popFlagBuffer.push(hailEvt);\n          }\n        }');
  function tail() {
    const h = load();
    const buf = [];
    // The real gate, parser and cross-log dedup, around the real wiring lines.
    // eslint-disable-next-line no-new-func
    const mk = new Function('_hailNpcWanted', 'popBuf', '_zealState', 'parseEqTimestamp',
      'const _crossLogSeen = new Map();\n' + crossLogSrc + '\n' + parseSrc
      + '\nconst popFlagBuffer = popBuf;\nreturn function (line, b, _sourceExcluded) {\n' + wire + '\n};');
    // The log's own timestamp: what makes the same line from two logs the same hail.
    const stamp = (line) => { const m = /^\[([^\]]+)\]/.exec(line); return m ? new Date(m[1]) : null; };
    return { feed: mk(h.api._hailNpcWanted, buf, {}, stamp), buf };
  }
  const B = { character: 'Aldenmar' };

  it('a raider hailing the Planar Projection in your zone goes up, once however many logs saw it', () => {
    const { feed, buf } = tail();
    const line = "[Sun Oct 04 20:10:01 2026] Brackwyn says, 'Hail, A Planar Projection'";
    feed(line, B, false);
    feed(line, { character: 'Aldenmar-alt' }, false);   // the same install's second log, same line
    expect(buf).toHaveLength(1);
    expect(buf[0]).toMatchObject({ character: 'Brackwyn', npc: 'A Planar Projection', source: 'hail_witnessed', witness: 'Aldenmar', self: false });
  });

  it('your own hail goes up under your own name', () => {
    const { feed, buf } = tail();
    feed("[Sun Oct 04 20:10:09 2026] You say, 'Hail, Tylis Newleaf'", B, false);
    expect(buf).toHaveLength(1);
    expect(buf[0]).toMatchObject({ character: 'Aldenmar', npc: 'Tylis Newleaf', self: true, source: 'hail_witnessed' });
  });

  it('a hail of anybody who is not a flag NPC never leaves the machine', () => {
    const { feed, buf } = tail();
    feed("[Sun Oct 04 20:10:01 2026] Brackwyn says, 'Hail, Banker Zorn'", B, false);
    feed("[Sun Oct 04 20:10:02 2026] You say, 'Hail, friend'", B, false);
    expect(buf).toHaveLength(0);
  });

  it('a character that opted out uploads nothing', () => {
    const { feed, buf } = tail();
    feed("[Sun Oct 04 20:10:01 2026] Brackwyn says, 'Hail, A Planar Projection'", B, true);
    feed("[Sun Oct 04 20:10:02 2026] You say, 'Hail, A Planar Projection'", B, true);
    expect(buf).toHaveLength(0);
  });

  it('is not a general say-chat capture', () => {
    const { feed, buf } = tail();
    feed("[Sun Oct 04 20:10:01 2026] Brackwyn says, 'pull it now'", B, false);
    feed("[Sun Oct 04 20:10:02 2026] Brackwyn tells the raid, 'Hail, A Planar Projection'", B, false);
    expect(buf).toHaveLength(0);
  });

  it('rides the same upload path the backfill uses, and local mode sends nothing', () => {
    const live = stripJs(agent);
    expect(live).toMatch(/if \(popFlagBuffer\.length > 0\)\s*\n\s*uploadPopFlags\(popFlagBuffer\.splice\(0\), _uploadOpts\)/);
    expect(live).toMatch(/function uploadPopFlags\(events[^)]*\) \{[\s\S]*?enqueueUpload\('pop_flag', \{ agent_version: AGENT_VERSION, events \}\);/);
    expect(live).toMatch(/function enqueueUpload\(kind, payload\) \{\s*\n\s*if \(_localOnly\(\)\) return null;/);
  });
});

describe('the board poll', () => {
  const OPEN = JSON.stringify({ windows: [win()] });
  const lastDelay = (h) => h.timers[h.timers.length - 1].ms;

  it('starts 15 s after boot', () => {
    expect(load().timers.map((t) => t.ms)).toEqual([15_000]);
  });

  it('asks the bot\'s board with the bearer token, and waits 30 s while nothing is open', async () => {
    const h = load();
    h.api._pollHailBoard();
    await flush();
    expect(h.net.calls).toHaveLength(1);
    expect(h.net.calls[0].options).toMatchObject({ method: 'GET', hostname: 'bot.example', path: '/api/agent/hail-board' });
    expect(h.net.calls[0].options.headers.Authorization).toBe('Bearer tok');
    expect(lastDelay(h)).toBe(30_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toEqual([]);
  });

  it('polls every 5 s while a window is open, and goes back to 30 s once it has closed', async () => {
    let body = OPEN;
    const h = load({ reply: () => ({ status: 200, body }) });
    h.api._pollHailBoard();
    await flush();
    expect(lastDelay(h)).toBe(5_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toHaveLength(1);
    // the bot now answers with the window gone (past its 20 minutes)
    body = '{"windows":[]}';
    h.api._pollHailBoard();
    await flush();
    expect(lastDelay(h)).toBe(30_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toEqual([]);
  });

  it('a window that has expired on the bot\'s clock no longer counts as open', async () => {
    const h = load({ reply: () => ({ status: 200, body: JSON.stringify({ windows: [win({ expires_at: soon(-1000) })] }) }) });
    h.api._pollHailBoard();
    await flush();
    expect(lastDelay(h)).toBe(30_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toEqual([]);
  });

  it('a 404 (a bot with no board yet) is not an error: no windows, and ten minutes of quiet', async () => {
    const h = load({ reply: () => ({ status: 404, body: 'Not Found' }) });
    h.api._applyHailBoard({ windows: [win()] }, Date.now());
    h.api._pollHailBoard();
    await flush();
    expect(lastDelay(h)).toBe(600_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toEqual([]);
  });

  it('the board comes back by itself once the bot grows one', async () => {
    let status = 404;
    const h = load({ reply: () => ({ status, body: OPEN }) });
    h.api._pollHailBoard(); await flush();
    expect(lastDelay(h)).toBe(600_000);
    status = 200;
    h.api._pollHailBoard(); await flush();
    expect(lastDelay(h)).toBe(5_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toHaveLength(1);
  });

  it('a failed poll keeps the last board and keeps the cadence it was on', async () => {
    const h = load({ reply: () => 'error' });
    h.api._applyHailBoard({ windows: [win()] }, Date.now());
    h.api._pollHailBoard(); await flush();
    expect(lastDelay(h)).toBe(5_000);
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toHaveLength(1);
    const idle = load({ reply: () => 'error' });
    idle.api._pollHailBoard(); await flush();
    expect(lastDelay(idle)).toBe(30_000);
  });

  it('local mode (no token) and a missing uploader call nothing', async () => {
    const local = load({ opts: { botUrl: BOT, token: '' } });
    local.api._pollHailBoard(); await flush();
    expect(local.net.calls).toHaveLength(0);
    expect(lastDelay(local)).toBe(30_000);
    const none = load({ opts: null });
    none.api._pollHailBoard(); await flush();
    expect(none.net.calls).toHaveLength(0);
  });

  it('a fleet the guild has paused calls nothing either', async () => {
    const h = load({ down: true });
    h.api._pollHailBoard(); await flush();
    expect(h.net.calls).toHaveLength(0);
    expect(lastDelay(h)).toBe(30_000);
    h.state.down = false;
    h.api._pollHailBoard(); await flush();
    expect(h.net.calls).toHaveLength(1);
  });
});

describe('what the Command Center is given', () => {
  it('only windows still open, with the time left and an end on this machine\'s clock', () => {
    const h = load();
    const now = Date.now();
    h.api._applyHailBoard({ windows: [win(), win({ id: 'old', expires_at: soon(-5000) })] }, now);
    const snap = h.api._hailBoardSnapshot(now, null);
    expect(snap.map((w) => w.id)).toEqual(['w1']);
    expect(snap[0].ms_left).toBeGreaterThan(17 * 60_000);
    expect(snap[0].ms_left).toBeLessThanOrEqual(18 * 60_000);
    expect(Math.abs(snap[0].ends_at_ms - (now + snap[0].ms_left))).toBeLessThanOrEqual(1000);
    expect(snap[0]).toMatchObject({ npc_name: 'A Planar Projection', boss_name: 'Aerin`Dar', seen_by: 9 });
    expect(snap[0].still.map((s) => [s.name, s.prior_missing])).toEqual([['Brackwyn', false], ['Corvale', true], ['Rethlan', false]]);
    expect(snap[0].hailed.map((s) => [s.name, s.how])).toEqual([['Kestrin', 'flag'], ['Valmora', 'seen'], ['Ysolde', 'marked']]);
    expect(snap[0].already_flagged).toEqual(['Thessaly', 'Ordeth']);
  });

  it('reads the time left off the clock it is given (the bot\'s), not the machine\'s', () => {
    const h = load();
    const exp = Date.now() + 10 * 60_000;
    h.api._applyHailBoard({ windows: [win({ expires_at: new Date(exp).toISOString() })] }, Date.now());
    // the caller passes "now" on the bot's clock: a bot 40 s ahead of this machine sees 40 s less left
    const botNow = Date.now() + 40_000;
    expect(h.api._hailBoardSnapshot(botNow, null)[0].ms_left).toBe(exp - botNow);
  });

  it('with two raids running, keeps to this raid and drops the other raid\'s window', () => {
    const h = load();
    const now = Date.now();
    h.api._applyHailBoard({ windows: [
      win(),
      win({ id: 'w2', npc_name: 'Tylis Newleaf', still: [{ name: 'Zarrin' }], hailed: [{ name: 'Nyssara', how: 'flag' }], already_flagged: ['Zarrin2'] }),
    ] }, now);
    const mine = new Set(['brackwyn', 'ysolde', 'thessaly', 'rethlan']);
    const snap = h.api._hailBoardSnapshot(now, mine);
    expect(snap.map((w) => w.id)).toEqual(['w1']);
    expect(snap[0].still.map((s) => s.name)).toEqual(['Brackwyn', 'Rethlan']);
    expect(snap[0].hailed.map((s) => s.name)).toEqual(['Ysolde']);
    expect(snap[0].already_flagged).toEqual(['Thessaly']);
  });

  it('shrugs off a bad answer: windows with no id or end are dropped, an unknown "how" reads as seen', () => {
    const h = load();
    h.api._applyHailBoard({ windows: [null, { npc_name: 'x' }, win({ id: null }), win({ expires_at: 'soon' }),
      win({ hailed: [{ name: 'Kestrin', how: 'telepathy' }, { how: 'flag' }, 'Valmora'] })] }, Date.now());
    const snap = h.api._hailBoardSnapshot(Date.now(), null);
    expect(snap).toHaveLength(1);
    expect(snap[0].hailed.map((s) => [s.name, s.how])).toEqual([['Kestrin', 'seen'], ['Valmora', 'seen']]);
    h.api._applyHailBoard('nonsense', Date.now());
    expect(h.api._hailBoardSnapshot(Date.now(), null)).toEqual([]);
  });

  it('is on the Command Center payload as hail, narrowed the way the priest mana list is', () => {
    const fn = stripJs(sliceBlock(agent, 'function _serializeCommandCenterState() {', '\n// Zeal writes zeal.ini into the EQ folder'));
    expect(fn).toMatch(/hail:\s+\(\(\) => \{[\s\S]*const ownRaid = !!_raidSplitNow\(nowMs\) && _raidRosterMembers\.size > 0 &&[\s\S]*!!_lastRaidPipe && \(nowMs - \(_lastRaidPipe\.at \|\| 0\)\) < 60_000;[\s\S]*return _hailBoardSnapshot\(_nowOnServerClock\(\), ownRaid \? _raidRosterMembers : null\);/);
  });
});

describe('a tap on a name', () => {
  function post(h, body, headers = {}) {
    const req = Object.assign(Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]), { headers });
    const out = { code: null, body: null };
    const res = { writeHead(c) { out.code = c; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
    return h.api._handleHailMark(req, res).then(() => out);
  }
  const marked = () => win({ still: [{ name: 'Brackwyn' }, { name: 'Corvale', prior_missing: true }],
    hailed: [{ name: 'Rethlan', how: 'marked', by: 'Aldenmar' }, { name: 'Kestrin', how: 'flag' }] });

  it('is forwarded to the bot with who tapped, and the bot\'s answer comes back and replaces the window', async () => {
    const h = load({ reply: () => ({ status: 200, body: JSON.stringify(marked()) }) });
    h.api._applyHailBoard({ windows: [win()] }, Date.now());
    const out = await post(h, { window_id: 'w1', name: 'Rethlan', hailed: true });
    expect(h.net.calls).toHaveLength(1);
    expect(h.net.calls[0].options).toMatchObject({ method: 'POST', hostname: 'bot.example', path: '/api/agent/hail-mark' });
    expect(h.net.calls[0].options.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(h.net.calls[0].body)).toEqual({ window_id: 'w1', name: 'Rethlan', hailed: true, by: 'Aldenmar' });
    expect(out.code).toBe(200);
    expect(out.body.id).toBe('w1');
    const snap = h.api._hailBoardSnapshot(Date.now(), null);
    expect(snap[0].still.map((s) => s.name)).toEqual(['Brackwyn', 'Corvale']);
    expect(snap[0].hailed[0]).toMatchObject({ name: 'Rethlan', how: 'marked', by: 'Aldenmar' });
  });

  it('takes an answer shaped { window }, and an un-mark, the same way', async () => {
    const h = load({ reply: () => ({ status: 200, body: JSON.stringify({ ok: true, window: marked() }) }) });
    await post(h, { window_id: 'w1', name: 'Rethlan', hailed: false });
    expect(JSON.parse(h.net.calls[0].body).hailed).toBe(false);
    expect(h.api._hailBoardSnapshot(Date.now(), null)[0].hailed.map((s) => s.name)).toEqual(['Rethlan', 'Kestrin']);
  });

  it('a window the bot has closed answers as the bot did, and the cache is left alone', async () => {
    const h = load({ reply: () => ({ status: 404, body: '{"error":"window closed"}' }) });
    h.api._applyHailBoard({ windows: [win()] }, Date.now());
    const out = await post(h, { window_id: 'w1', name: 'Rethlan', hailed: true });
    expect(out.code).toBe(404);
    expect(out.body.error).toBe('window closed');
    expect(h.api._hailBoardSnapshot(Date.now(), null)[0].still).toHaveLength(3);
  });

  it('a bot that cannot be reached is a 502, not a hang', async () => {
    const h = load({ reply: () => 'error' });
    const out = await post(h, { window_id: 'w1', name: 'Rethlan', hailed: true });
    expect(out.code).toBe(502);
  });

  it('refuses a body that is not window_id + name + hailed, without bothering the bot', async () => {
    const h = load();
    for (const bad of [{}, { window_id: 'w1', name: 'Rethlan' }, { window_id: 'w1', name: 'Rethlan', hailed: 'yes' },
      { name: 'Rethlan', hailed: true }, { window_id: 'w1', hailed: true }, 'not json']) {
      expect((await post(h, bad)).code).toBe(400);
    }
    expect(h.net.calls).toHaveLength(0);
  });

  it('refuses a web page: a foreign Origin is a 403, Mimic\'s own origins are not', async () => {
    const h = load({ reply: () => ({ status: 200, body: JSON.stringify(marked()) }) });
    const body = { window_id: 'w1', name: 'Rethlan', hailed: true };
    expect((await post(h, body, { origin: 'https://evil.example' })).code).toBe(403);
    expect((await post(h, body, { origin: 'http://localhost.evil.example' })).code).toBe(403);
    expect(h.net.calls).toHaveLength(0);
    for (const origin of [undefined, 'null', 'http://127.0.0.1:7779', 'http://localhost:7777', 'file://']) {
      expect((await post(h, body, origin ? { origin } : {})).code, String(origin)).toBe(200);
    }
  });

  it('local mode and a paused fleet answer 503 and call nothing', async () => {
    const body = { window_id: 'w1', name: 'Rethlan', hailed: true };
    const local = load({ opts: { botUrl: BOT, token: '' } });
    expect((await post(local, body)).code).toBe(503);
    const paused = load({ down: true });
    expect((await post(paused, body)).code).toBe(503);
    expect(local.net.calls.length + paused.net.calls.length).toBe(0);
  });

  it('has a route on the agent\'s own server, for POST only', () => {
    expect(stripJs(agent)).toContain("if (req.url === '/api/hail-mark' && req.method === 'POST') return _handleHailMark(req, res);");
  });
});
