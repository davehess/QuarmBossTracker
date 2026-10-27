// test/pop-status-agent.test.js — the agent's half of the Flags mode of the PoP overlay (agent 4.0.28).
//
// The bot answers the poll's `pop` stream with the member's OWN characters' PoP flag status (test/pop-status-bot.test.js on
// `main`). The agent keeps the latest answer and serves it to the overlay on localhost, GET /api/pop-status?character=:
// the overlay polls every 3 s and that costs the bot nothing. The agent asks the bot every five minutes and again ~2 s after
// one of its own pop_flag uploads is acknowledged. An older bot has no such stream: the answer says so, and the overlay says
// "Flags need the newer bot".
//
// The state and the body builder are run as they stand (sliceBlock + evalBlock over the agent's index.js); the wiring (the
// poll's `want`, the query, the upload hook, the route) is read as stripped source and the route is run against a stub.
//
// Run: npx vitest run test/pop-status-agent.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const raw = readSource(AGENT_INDEX);
const code = stripJs(raw);
const BLOCK = sliceBlock(code, 'const _popStatus = {', "(_popStatus.error ? 'error' : 'loading'), status: null };\n}");

// The block against a world the test sets: who is watched, who is played, whether the agent is linked, whether the poll
// is multiplexed. `timers` records setTimeout so the two-second refresh can be seen without waiting.
function world() {
  const timers = [];
  const stats = { watchedLogs: [{ character: 'Brackwyn' }, { character: 'Aldenmar' }], activeCharacter: 'Brackwyn' };
  const _pollLast = { pop: 123 };
  const env = new Function('stats', '_pollLast', 'setTimeout',
    'var _uploadOpts = { botUrl: "https://bot.invalid/api/agent/encounter", token: "t" }, _pollSupported = true;\n' + BLOCK
    + '\nreturn { _applyPopResponse, _popSoon, _popStatusBody, _popStatus, set: (o, p) => { _uploadOpts = o; _pollSupported = p; } };')(
    stats, _pollLast, (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; });
  return { ...env, stats, _pollLast, timers };
}
// What the bot sends for one character (the shape of test/fixtures/pop-status-brackwyn.json).
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pop-status-brackwyn.json'), 'utf8'));
const answer = (over = {}) => ({ version: 'v1', characters: { brackwyn: FX.characters.brackwyn }, unlinked: [], ...over });

describe('the status the agent keeps and serves', () => {
  it('before the bot has answered: loading; with no link to the guild: offline', () => {
    const w = world();
    expect(w._popStatusBody('').state).toBe('loading');
    w.set(null, true);
    expect(w._popStatusBody('')).toMatchObject({ state: 'offline', status: null });
    w.set({ botUrl: 'https://bot.invalid/x' }, true);   // a URL but no token: still unlinked
    expect(w._popStatusBody('').state).toBe('offline');
  });

  it('after an answer: the character being played, with who else the overlay may pick', () => {
    const w = world();
    w._applyPopResponse(answer(), 1000);
    const b = w._popStatusBody('');
    expect(b).toMatchObject({ state: 'ok', active: 'Brackwyn', character: 'Brackwyn' });
    expect(b.status).toEqual(FX.characters.brackwyn);
    expect(b.characters).toEqual(['Aldenmar', 'Brackwyn']);
    expect(typeof b.age_ms).toBe('number');
  });

  it('?character= asks for one by name (any case); one the bot did not send is loading, or not linked when the bot said so', () => {
    const w = world();
    w._applyPopResponse(answer({ unlinked: ['aldenmar'] }), 1000);
    expect(w._popStatusBody('BRACKWYN').state).toBe('ok');
    expect(w._popStatusBody('Aldenmar')).toMatchObject({ state: 'unlinked', status: null, character: 'Aldenmar' });
    expect(w._popStatusBody('Corvale').state).toBe('loading');
  });

  it('the played character is the one the agent is tailing; with none, the first watched; with nothing watched, none', () => {
    const w = world();
    w._applyPopResponse(answer(), 1000);
    w.stats.activeCharacter = 'Aldenmar';
    expect(w._popStatusBody('').character).toBe('Aldenmar');
    w.stats.activeCharacter = '';
    expect(w._popStatusBody('').character).toBe('Brackwyn');
    w.stats.watchedLogs = [];
    expect(w._popStatusBody('').state).toBe('no_character');
  });

  it('an answer without the stream (an older bot, or the stream is shed) is "old_bot"; so is a poll that fell back', () => {
    const w = world();
    w._applyPopResponse(undefined, 1000);
    expect(w._popStatus.supported).toBe(false);
    expect(w._popStatusBody('')).toMatchObject({ state: 'old_bot', status: null });
    const v = world();
    v._applyPopResponse(answer(), 1000);
    v.set({ botUrl: 'https://bot.invalid/x', token: 't' }, false);
    expect(v._popStatusBody('').state).toBe('old_bot');
  });

  it('`unchanged` keeps what it holds and moves only the clock; an error keeps it too and says the bot could not read', () => {
    const w = world();
    w._applyPopResponse(answer(), 1000);
    w._applyPopResponse({ version: 'v1', unchanged: true }, 2000);
    expect(w._popStatus.at).toBe(2000);
    expect(w._popStatusBody('').state).toBe('ok');
    w._applyPopResponse({ version: null, characters: {}, unlinked: [], error: 'database unavailable' }, 3000);
    expect(w._popStatusBody('').state).toBe('ok');                 // the last good status still stands
    expect(w._popStatus.error).toBe('database unavailable');
    expect(w._popStatus.ver).toBe('v1');
    const fresh = world();
    fresh._applyPopResponse({ version: null, characters: {}, unlinked: [], error: 'database unavailable' }, 3000);
    expect(fresh._popStatusBody('').state).toBe('error');
  });

  it('a new answer replaces the old one whole (a character the bot no longer sends is gone), and a version is remembered for pop_ver', () => {
    const w = world();
    w._applyPopResponse(answer({ version: 'v1' }), 1000);
    w._applyPopResponse(answer({ version: 'v2', characters: {}, unlinked: ['brackwyn'] }), 2000);
    expect(w._popStatus.ver).toBe('v2');
    expect(w._popStatusBody('').state).toBe('unlinked');
  });

  it('keeps no more than it should from a bot: junk characters are dropped, the list is capped', () => {
    const w = world();
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['c' + i, { character: 'C' + i }]));
    w._applyPopResponse({ version: 'v', characters: { ...many, bad: 'x', worse: null }, unlinked: Array.from({ length: 60 }, (_, i) => 'u' + i) }, 1);
    expect(Object.keys(w._popStatus.byChar).length).toBe(24);
    expect(w._popStatus.byChar.bad).toBeUndefined();
    expect(w._popStatus.unlinked.length).toBe(24);
  });
});

describe('a flag upload of its own refreshes the status ~2 s later', () => {
  it('arms one timer, whatever the number of acks, and when it fires the next poll asks for `pop`', () => {
    const w = world();
    w._popSoon(); w._popSoon(); w._popSoon();
    expect(w.timers.length).toBe(1);
    expect(w.timers[0].ms).toBe(2000);
    expect(w._pollLast.pop).toBe(123);
    w.timers[0].fn();
    expect(w._pollLast.pop).toBe(0);
    w._popSoon();                                                  // armed again once it has fired
    expect(w.timers.length).toBe(2);
  });
});

describe('the wiring in the agent (index.js)', () => {
  it('asks the bot for `pop` every five minutes, only with a character, and sends the version it holds', () => {
    expect(code).toMatch(/const POLL_POP_MS\s*=\s*5 \* 60_000;/);
    expect(code).toMatch(/if \(chars\.length\) \{[\s\S]{0,900}now - _pollLast\.pop\s*>= POLL_POP_MS\)\s*want\.push\('pop'\);/);
    expect(code).toMatch(/if \(want\.includes\('pop'\)\) \{[^}]*qs\.set\('characters', chars\.join\(','\)\);\s*qs\.set\('pop_ver', _popStatus\.ver \|\| ''\);/);
  });
  it('hands the answer to _applyPopResponse even when the stream is absent (that is how an older bot is noticed)', () => {
    expect(code).toMatch(/if \(want\.includes\('pop'\)\)\s*\{ _applyPopResponse\(s\.pop, now\);\s*_pollLast\.pop = now; \}/);
  });
  it('is not asked while dormant (the control channel only), and is part of the poll cursor table', () => {
    const dormant = sliceBlock(code, 'if (dormant) {', "want.push('tuning');\n  } else {");
    expect(dormant).not.toMatch(/'pop'/);
    expect(code).toMatch(/const _pollLast = \{[^}]*\bpop: 0 \};/);
  });
  it('arms the refresh when one of its own pop_flag uploads is acknowledged', () => {
    const fn = sliceBlock(code, 'function _onUploadSuccess(entry, responseText) {', "if (entry.kind !== 'encounter') return;");
    expect(fn).toMatch(/if \(entry\.kind === 'pop_flag'\) \{ _popSoon\(\); return; \}/);
  });
  it('the agent version moved with it', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'package.json'), 'utf8')).version;
    // "At least": a later agent patch must not break this (it pinned '4.0.28' exactly, and FB-102's 4.0.29 tripped it).
    const n = v.split('.').map(Number);
    expect(n[0] * 1e6 + n[1] * 1e3 + n[2]).toBeGreaterThanOrEqual(4 * 1e6 + 0 * 1e3 + 28);
  });
});

describe('GET /api/pop-status', () => {
  const route = sliceBlock(code, "if (req.method === 'GET' && req.url.startsWith('/api/pop-status')) {", "return res.end(JSON.stringify(_popStatusBody(want.slice(0, 40))));\n      }");
  const call = (url, body = (n) => ({ asked: n })) => {
    const seen = {};
    // The route is a statement block that returns: wrap it in a function so `return` is legal.
    // eslint-disable-next-line no-new-func
    const run = new Function('req', 'res', '_popStatusBody', 'URL', 'return (function(){' + route + '\n return "fell through"; })();');
    const res = { writeHead: (s, h) => { seen.status = s; seen.headers = h; }, end: (b) => { seen.body = JSON.parse(b); return 'sent'; } };
    const out = run({ method: 'GET', url }, res, body, URL);
    return { out, ...seen };
  };
  it('serves the body for the character asked, as JSON, never cached', () => {
    const r = call('/api/pop-status?character=Brackwyn');
    expect(r.out).toBe('sent');
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.body).toEqual({ asked: 'Brackwyn' });
  });
  it('with no character asks for the one being played, and caps a long name', () => {
    expect(call('/api/pop-status').body).toEqual({ asked: '' });
    expect(call('/api/pop-status?character=' + 'x'.repeat(200)).body.asked.length).toBe(40);
  });
  it('is read-only: GET only, and the route writes nothing and calls no one', () => {
    expect(route).not.toMatch(/fetch\(|http\.request|https\.request|writeFile|enqueueUpload/);
    expect(call('/api/pop-objectives').out).toBe('fell through');
    const post = (() => { const run = new Function('req', 'res', '_popStatusBody', 'URL', 'return (function(){' + route + '\n return "fell through"; })();'); return run({ method: 'POST', url: '/api/pop-status' }, {}, () => ({}), URL); })();
    expect(post).toBe('fell through');
  });
  it('sits behind the local guard like every route (the router calls it first), with no CORS header of its own', () => {
    expect(code).toMatch(/_localGuardBlock\(req, res\)/);
    expect(route).not.toMatch(/Access-Control/);
  });
});
