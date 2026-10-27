// test/pop-rescan-agent.test.js — the agent's half of "Sync from my logs" (the guild lead, 2026-10-26).
//
// The bot hands the member's own Mimic a request on the poll's `rescan` stream; Mimic re-reads that character's
// recent log for PoP flag lines and answers POST /api/agent/rescan-done {id, found, ok}. The code is read from the
// SHIPPED agent source and run with the outside world faked (the log folder, the upload queue, the bot): so a rename,
// a deleted gate or a wrong offset fails loudly, and the log files here are real files on disk.
//
// What is pinned: only lines that hit the existing PoP gates (or the #popflags table) reach a parser; the read starts
// near `now − days`, not at the top of the file; the bytes read are capped; the event loop is not starved; a re-read is
// byte-identical (earned_at is the line's own time, so the pop_flags key makes it idempotent); the live tail's state is
// put back; the count reported is the flag lines read.
//
// Run: npx vitest run test/pop-rescan-agent.test.js

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AGENT_INDEX, readSource, sliceBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(src, 'const TS_RX = ', '  return isNaN(d.getTime()) ? null : d;\n}');
const gateBlock = sliceBlock(src, 'const _POP_GRANT_RX = ', "    ...(kind === 'trial' ? { npc: trialNpc.slice(0, 64) } : {}),\n  };\n}");
const pfBlock = sliceBlock(src, 'const _PF_STAGES = [', '  return out;\n}');
const seekBlock = sliceBlock(src, 'async function _rbSeek(fh, size, sinceMs) {', '  return lo;\n}');
const netBlock = sliceBlock(src, 'async function _rescanDrained(maxMs) {', '  return false;     // the bot hands the request out again after 30 minutes; the re-read is idempotent\n}');
const readBodyBlock = sliceBlock(src, 'async function _readBody(req, max = 64 * 1024) {', "  return Buffer.concat(chunks).toString('utf8');\n}");
// …through the end of the dashboard button's route (the website's pump and the local start share the one guard).
const rescanBlock = sliceBlock(src, 'const RESCAN_CHUNK_BYTES = ', "    return send(500, { error: 'rescan unavailable' });\n  }\n}");

// The shipped code, with parsePopFlagLine wrapped so every line handed to it is recorded.
function load(world = {}) {
  const calls = [];
  const w = {
    fs, _zealState: {}, stats: {}, _liveFightActive: () => false, _uploadQueue: [], _uploadOpts: null, AGENT_VERSION: '9.9.9',
    _rebuildCandidates: () => [], _rebuildExcluded: () => false, shouldUploadForCharacter: () => true,
    uploadPopFlags: () => Promise.resolve(), _getApiBase: () => 'http://bot.test/api/agent', _getAgentToken: () => 'tok',
    fetch: async () => ({ ok: true, status: 200 }), _localOnly: () => false, _controlStandDown: () => ({ down: false }), ...world,
  };
  const names = Object.keys(w);
  const body = tsBlock + '\n' + gateBlock.replace('function parsePopFlagLine(', 'function _realParsePopFlagLine(') + '\n'
    + 'function parsePopFlagLine(l, c) { __calls.push(l); return _realParsePopFlagLine(l, c); }\n'
    + pfBlock + '\n' + netBlock + '\n' + seekBlock + '\n' + readBodyBlock + '\n' + rescanBlock
    + '\nreturn { _rescanWants, _rescanLine, _rescanFile, _rescanIsolate, _rescanRun, _applyRescanResponse, _rescan, _pfState, _popPrevLine, _popLastHail, parsePopFlagLine, RESCAN_MAX_BYTES, RESCAN_MAX_WAIT_MS,'
    + ' _rescanArgs, _rescanLocalStart, _rescanStatus, _localPopRescanRoute, _rescanUploadMode, _rescanCharacters, RESCAN_MAX_DAYS, RESCAN_BODY_MAX };';
  // eslint-disable-next-line no-new-func
  const M = new Function('__calls', ...names, body)(calls, ...names.map(k => w[k]));
  return { M, calls, world: w };
}

// ── fixtures: real log files ─────────────────────────────────────────────────
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rescan-'));
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getFullYear()}]`;
const DAY = 86400_000;
const NOW = Date.now();
const at = (daysAgo, sec = 0) => new Date(Math.floor((NOW - daysAgo * DAY) / 1000) * 1000 + sec * 1000);

const GNOLL = 'You hit a gnoll pup for 12 points of damage.';
const NPC = "Mavuin tells you, 'So you have pleaded my case to the Tribunal, I am most thankful.'";
const GRANT = 'You have received a character flag!';

/** Write a log: `n` filler lines spread from 25 days ago to now, plus the given [daysAgo, text] lines, time-ordered. */
function makeLog(name, extra, n = 14000) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push([at(25 - (25 * i) / n, 0).getTime() + i, GNOLL]);
  for (const [daysAgo, text, sec] of extra) rows.push([at(daysAgo, sec || 0).getTime(), text]);
  rows.sort((a, b) => a[0] - b[0]);
  const file = path.join(DIR, name);
  fs.writeFileSync(file, rows.map(([t, text]) => `${stamp(new Date(Math.floor(t / 1000) * 1000))} ${text}`).join('\n') + '\n');
  return file;
}
const sink = () => ({ events: [], found: 0, prev: null, prevPassed: false, flush() {} });
const chars = (c) => [c];

describe('the gate: only lines the PoP parsers already take', () => {
  const { M } = load();
  it('a recital sentence, a flag grant, an NPC line before one, a trial credit and a #popflags line are wanted', () => {
    expect(M._rescanWants('The evidence of Mavuin is the only thing that can save him now.')).toBe('recital');
    expect(M._rescanWants(GRANT)).toBe('grant');
    expect(M._rescanWants('You receive a character flag!')).toBe('grant');
    expect(M._rescanWants('You have received a new checklist flag!')).toBe('grant');
    expect(M._rescanWants(NPC)).toBe('prev');
    expect(M._rescanWants('An ethereal mist descends from the air and surrounds your very being. Your body begins to emanate with the power of Trydan Faye.')).toBe('trial');
    expect(M._rescanWants('You have already received credit for completing this trial.')).toBe('trial');
    expect(M._rescanWants("Mavuin's case: Mavuin's case is complete")).toBe('popflags');
    expect(M._rescanWants('=== Tier 3 Progression ===')).toBe('popflags');
  });
  it('combat, chat, tells, guild and a quoted copy of a flag line are not', () => {
    for (const l of [GNOLL, "Brackwyn tells you, 'The evidence of Mavuin is the only thing that can save him now.'", "Zarrin says, 'You have received a character flag!'",
      "You tell your guild, 'Mavuin's case: Mavuin's case is complete'", 'You gain experience!!', 'Your faction standing with Wolf Pack got better.',
      "Mavuin's case: Mavuin's case is complete!", 'You have received a character flag', 'Xuzl: Incomplete']) {
      expect(M._rescanWants(l), l).toBeNull();
    }
  });
});

describe('reading a real log', () => {
  const SINCE = at(6).getTime();
  const flagLines = [
    [20, 'Mavuin is grateful to you for taking his case before the Tribunal.  The information provided to you, that Mithaniel Marr and Karana carry information you should seek, could be quite useful.'],   // BEFORE the window
    [5, 'The evidence of Mavuin is the only thing that can save him now.'],                                  // recital, in the window
    [4, NPC, 0], [4, GRANT, 1],                                                                              // an NPC line, then the grant right after it
    [3, "Adroha Jezith tells you, 'It is our belief that Terris-Thule is the cause of this.'", 0], [3, GNOLL, 1], [3, GRANT, 2], // …then something else in between
    [2, "Brackwyn tells the guild, 'The evidence of Mavuin is the only thing that can save him now.'"],     // chat: ignored
    [1, "Mavuin's case: Mavuin's case is complete", 0], [1, 'Plane of Time access: Locked', 1], [1, 'Grummus flag: Complete', 2],
  ];
  const file = makeLog('eqlog_Aldenmar_pq.proj.txt', flagLines);
  const size = fs.statSync(file).size;

  it('is a log big enough to need the seek (over 512 KB)', () => { expect(size).toBeGreaterThan(900 * 1024); });

  it('hands the parsers only gated lines (and, before a grant, the one line the log really had before it)', async () => {
    const { M, calls } = load();
    const s = sink();
    const ctx = { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false };
    expect(await M._rescanFile({ path: file, character: 'Aldenmar' }, ctx, s)).toBe(true);
    const grantPrev = new Set();
    for (const c of calls) {
      const msg = c.replace(/^\[[^\]]*\]\s*/, '');
      if (M._rescanWants(msg)) continue;
      grantPrev.add(msg);                                   // not gated: it can only be the line before a grant
    }
    expect([...grantPrev]).toEqual([GNOLL]);                // exactly the one filler line that sat between an NPC and a grant
    expect(calls.length).toBeLessThan(12);
    expect(calls.filter(c => /gnoll/.test(c)).length).toBe(1);
  });
  it('starts near now − days, not at the top: far fewer bytes than the file, and the old line is never read', async () => {
    const { M } = load();
    const s = sink();
    const ctx = { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false };
    await M._rescanFile({ path: file, character: 'Aldenmar' }, ctx, s);
    const read = M.RESCAN_MAX_BYTES - ctx.bytes;
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(size * 0.5);                  // 6 of 25 days, plus the 256 KB the seek backs off
    expect(s.events.some(e => /grateful/.test(e.text || ''))).toBe(false);
    expect(s.events.some(e => (e.stages || []).includes('mavuin_3'))).toBe(true);   // the #popflags line in the window
  });
  it('reads the whole file from the top when it is small, and still drops lines before the window', async () => {
    const small = makeLog('eqlog_Brackwyn_pq.proj.txt', flagLines, 300);
    expect(fs.statSync(small).size).toBeLessThan(512 * 1024);
    const { M } = load();
    const s = sink();
    const ctx = { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false };
    await M._rescanFile({ path: small, character: 'Brackwyn' }, ctx, s);
    expect(M.RESCAN_MAX_BYTES - ctx.bytes).toBe(fs.statSync(small).size);
    expect(s.events.some(e => /grateful/.test(e.text || ''))).toBe(false);
    expect(s.found).toBe(5);
  });
  it('the events: the recital with its own text and time, the grant named by the line before it, the #popflags steps', async () => {
    const { M } = load();
    const s = sink();
    await M._rescanFile({ path: file, character: 'Aldenmar' }, { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false }, s);
    const recital = s.events.find(e => e.kind === 'recital' && e.text);
    expect(recital.text).toBe('The evidence of Mavuin is the only thing that can save him now.');
    expect(recital.ts).toBe(at(5).toISOString());
    const grants = s.events.filter(e => e.kind === 'grant');
    expect(grants).toHaveLength(2);
    expect(grants[0].prev).toMatch(/^Mavuin tells you, 'So you have pleaded my case/);   // the NPC line directly before
    expect(grants[1].prev).toBeNull();                                                    // something else came between
    const pf = s.events.filter(e => e.source === 'popflags').flatMap(e => e.stages).sort();
    expect(pf).toEqual(['fuirstel_2', 'mavuin_3']);                                       // Grummus read once "time not held" was seen
    expect(s.events.every(e => !/Brackwyn/.test(JSON.stringify(e)))).toBe(true);
  });
  it('counts the flag lines read: recital, two grants, the Mavuin line and the Grummus line', async () => {
    const { M } = load();
    const s = sink();
    await M._rescanFile({ path: file, character: 'Aldenmar' }, { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false }, s);
    expect(s.found).toBe(5);
  });
  it('a re-read is byte-identical, so the pop_flags key (earned_at is the line\'s own time) makes it idempotent', async () => {
    const run = async () => {
      const { M } = load();
      const s = sink();
      await M._rescanIsolate(['Aldenmar'], () => M._rescanFile({ path: file, character: 'Aldenmar' }, { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false }, s));
      return JSON.stringify(s.events);
    };
    const a = await run();
    expect(a.length).toBeGreaterThan(100);
    expect(await run()).toBe(a);
  });
  it('caps the bytes it reads', async () => {
    const { M } = load();
    const ctx = { sinceMs: at(30).getTime(), bytes: 100 * 1024, waited: 0, stop: false };
    await M._rescanFile({ path: file, character: 'Aldenmar' }, ctx, sink());
    expect(ctx.bytes).toBe(0);
    expect(100 * 1024 - ctx.bytes).toBeLessThanOrEqual(100 * 1024);
  });
  it('does not starve the event loop: timers keep firing while a whole log is read', async () => {
    const { M } = load();
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 5);
    await M._rescanFile({ path: file, character: 'Aldenmar' }, { sinceMs: at(30).getTime(), bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false }, sink());
    clearInterval(iv);
    expect(ticks).toBeGreaterThanOrEqual(1);
  });
  it('pauses while a fight is live (bounded), then reads', async () => {
    let calls = 0;
    const { M } = load({ _liveFightActive: () => ++calls <= 1 });
    const ctx = { sinceMs: SINCE, bytes: M.RESCAN_MAX_BYTES, waited: 0, stop: false };
    const t0 = Date.now();
    await M._rescanFile({ path: file, character: 'Aldenmar' }, ctx, sink());
    expect(ctx.waited).toBe(1500);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(ctx.bytes).toBeLessThan(M.RESCAN_MAX_BYTES);
  });
  it('a file it cannot open is false, not a throw', async () => {
    const { M } = load();
    expect(await M._rescanFile({ path: path.join(DIR, 'nope.txt'), character: 'X' }, { sinceMs: 0, bytes: 1e6, waited: 0, stop: false }, sink())).toBe(false);
  });
  it('puts the live tail\'s per-character state back, and starts the re-read from nothing', async () => {
    const { M } = load();
    M._popPrevLine.set('aldenmar', 'LIVE PREV');
    M._pfState.set('aldenmar', { time: 'yes', timeAt: 1, pending: [], hoh: new Set(), sent: new Map() });
    const live = M._pfState.get('aldenmar');
    let sawFresh = null;
    await M._rescanIsolate(['Aldenmar'], async () => { sawFresh = [M._popPrevLine.get('aldenmar'), M._pfState.get('aldenmar')]; M._popPrevLine.set('aldenmar', 'RESCAN PREV'); });
    expect(sawFresh).toEqual([undefined, undefined]);
    expect(M._popPrevLine.get('aldenmar')).toBe('LIVE PREV');
    expect(M._pfState.get('aldenmar')).toBe(live);
    await expect(M._rescanIsolate(['Aldenmar'], async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(M._popPrevLine.get('aldenmar')).toBe('LIVE PREV');
  });
});

describe('a request, end to end', () => {
  const logA = makeLog('eqlog_Corvale_pq.proj.txt', [[3, 'The evidence of Mavuin is the only thing that can save him now.'], [100, 'Mavuin is grateful to you for taking his case before the Tribunal.']], 400);
  const logB = makeLog('eqlog_Nyssara_pq.proj.txt', [[2, "Fuirstel progression: Elder Fuirstel aided; defeat Bertoxxulous"]], 400);
  const logX = makeLog('eqlog_Rethlan_pq.proj.txt', [[2, 'The evidence of Mavuin is the only thing that can save him now.']], 400);
  const cands = [
    { path: logA, character: 'Corvale' }, { path: logB, character: 'Nyssara' },
    { path: logX, character: 'Rethlan' }, { path: path.join(DIR, 'ignored.txt'), character: 'Zarrin', ignored: true },
  ];
  async function drive(req, over = {}) {
    const uploads = []; const posts = [];
    const { M } = load({
      _rebuildCandidates: () => cands,
      _rebuildExcluded: (c) => c === 'Rethlan',
      uploadPopFlags: (events) => { uploads.push(...events); return Promise.resolve(); },
      fetch: async (url, init) => { posts.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
      ...over,
    });
    M._applyRescanResponse({ requests: [req] });
    for (let i = 0; i < 400 && M._rescan.running; i++) await new Promise(r => setTimeout(r, 20));
    expect(M._rescan.running).toBe(false);
    return { uploads, posts, M };
  }
  it('names a character: only that log, uploads through uploadPopFlags, then reports {id, found, ok}', async () => {
    const { uploads, posts } = await drive({ id: 5, character: 'corvale', days: 14 });
    expect(uploads.map(e => e.character)).toEqual(['Corvale']);
    expect(uploads[0].kind).toBe('recital');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('http://bot.test/api/agent/rescan-done');
    expect(posts[0].init.method).toBe('POST');
    expect(posts[0].init.headers.Authorization).toBe('Bearer tok');
    expect(posts[0].body).toEqual({ id: 5, found: 1, ok: true });
  });
  it('null means every log on this PC, minus an ignored one and one kept out of stats', async () => {
    const { uploads, posts } = await drive({ id: 6, character: null, days: 14 });
    expect(new Set(uploads.map(e => e.character))).toEqual(new Set(['Corvale', 'Nyssara']));
    expect(posts[0].body).toEqual({ id: 6, found: 2, ok: true });
  });
  it('days reaches back only that far: a 100-day-old line is not read even at the 60-day cap', async () => {
    const { uploads, posts } = await drive({ id: 7, character: 'Corvale', days: 400 });
    expect(uploads.some(e => /grateful/.test(e.text || ''))).toBe(false);
    expect(posts[0].body.found).toBe(1);
  });
  it('a character with no log here, or one kept out of stats, is reported as not read (ok:false), not as done', async () => {
    for (const character of ['Zarrin', 'Rethlan', 'Brackwyn']) {
      const { uploads, posts } = await drive({ id: 8, character, days: 14 });
      expect(uploads, character).toEqual([]);
      expect(posts[0].body, character).toEqual({ id: 8, found: 0, ok: false });
    }
  });
  it('a request id is run once, however often the bot repeats it', async () => {
    const posts = [];
    const { M } = load({ _rebuildCandidates: () => cands, fetch: async (u, i) => { posts.push(JSON.parse(i.body)); return { ok: true, status: 200 }; } });
    M._applyRescanResponse({ requests: [{ id: 9, character: 'Corvale', days: 14 }, { id: 9, character: 'Corvale', days: 14 }] });
    for (let i = 0; i < 400 && M._rescan.running; i++) await new Promise(r => setTimeout(r, 20));
    M._applyRescanResponse({ requests: [{ id: 9, character: 'Corvale', days: 14 }] });
    await new Promise(r => setTimeout(r, 100));
    expect(posts.map(p => p.id)).toEqual([9]);
  });
  it('junk in the stream is ignored: no id, a negative id, a non-list', () => {
    const { M } = load();
    for (const r of [null, {}, { requests: 'x' }, { requests: [{}, { id: -1 }, { id: 'a' }, null] }]) M._applyRescanResponse(r);
    expect(M._rescan.queue).toEqual([]);
    expect(M._rescan.running).toBe(false);
  });
  it('a refusal from the bot (a 4xx) is not retried', async () => {
    const posts = [];
    const { M } = load({ _rebuildCandidates: () => cands, fetch: async (u, i) => { posts.push(i); return { ok: false, status: 404 }; } });
    M._applyRescanResponse({ requests: [{ id: 10, character: 'Corvale', days: 14 }] });
    for (let i = 0; i < 400 && M._rescan.running; i++) await new Promise(r => setTimeout(r, 20));
    expect(posts).toHaveLength(1);
    expect(M._rescan.lastDone.reported).toBe(false);
  });
  it('waits for the upload queue to drain before it says done, so "done" on the website means the flags are stored', async () => {
    const q = [{ kind: 'pop_flag' }];
    const posts = [];
    const { M } = load({ _uploadQueue: q, _rebuildCandidates: () => cands, fetch: async (u, i) => { posts.push(Date.now()); return { ok: true, status: 200 }; } });
    const t0 = Date.now();
    setTimeout(() => { q.length = 0; }, 300);
    M._applyRescanResponse({ requests: [{ id: 11, character: 'Corvale', days: 14 }] });
    for (let i = 0; i < 400 && M._rescan.running; i++) await new Promise(r => setTimeout(r, 20));
    expect(posts).toHaveLength(1);
    expect(posts[0] - t0).toBeGreaterThanOrEqual(250);
  });
});

describe('the poll wiring (stripped source)', () => {
  const s = stripJs(src);
  it('asks for the rescan stream every three minutes, only with a watched character, and not while one is running', () => {
    expect(s).toMatch(/const POLL_RESCAN_MS\s+= 3 \* 60_000;/);
    expect(s).toMatch(/if \(now - _pollLast\.rescan\s+>= POLL_RESCAN_MS && !_rescan\.running\) want\.push\('rescan'\);/);
    const block = s.slice(s.indexOf('if (chars.length) {', s.indexOf('const want = [];')), s.indexOf('if (want.length === 0) return;'));
    expect(block).toMatch(/want\.push\('rescan'\)/);
  });
  it('a bot that does not know the stream leaves it out; an agent that is handed nothing does nothing', () => {
    expect(s).toMatch(/if \(want\.includes\('rescan'\)\)\s+\{ if \(s\.rescan\)\s+_applyRescanResponse\(s\.rescan\);\s+_pollLast\.rescan = now; \}/);
  });
  it('sends the character list with it', () => {
    expect(s).toMatch(/want\.includes\('ui_edits'\) \|\| want\.includes\('rescan'\)\)/);
  });
  it('the report is a bearer POST of exactly {id, found, ok} to /rescan-done, retried only when the bot did not answer', () => {
    const rep = sliceBlock(s, 'async function _rescanReport(id, found, ok) {', '\n}\n');
    expect(rep).toMatch(/'\/rescan-done'/);
    expect(rep).toMatch(/JSON\.stringify\(\{ id, found, ok \}\)/);
    expect(rep).toMatch(/'Authorization': 'Bearer ' \+ token/);
    expect(rep).toMatch(/res\.status >= 400 && res\.status < 500\) return false;/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
// "Capture latest PoP flags, Seer and Maelin messages": the dashboard button (the guild lead, 2026-10-26).
// The same reader as the website's request, started from this PC: POST /api/local/pop-rescan, GET .../status.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════
function fakeReq(method, url, body) {
  const chunks = body == null ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return Object.assign(Readable.from(chunks), { method, url });
}
function fakeRes() {
  const r = { status: 0, headers: null, body: null, writeHead(s, h) { r.status = s; r.headers = h; }, end(b) { r.body = b ? JSON.parse(b) : null; } };
  return r;
}
async function call(M, method, url, body) {
  const res = fakeRes();
  const answered = await M._localPopRescanRoute(fakeReq(method, url, body), res);
  return { answered, status: res.status, body: res.body, headers: res.headers };
}
async function settle(M) { for (let i = 0; i < 400 && M._rescan.running; i++) await new Promise(r => setTimeout(r, 20)); }

describe('local pop-rescan: the arguments', () => {
  const { M } = load();
  it('nothing sent means every character, 14 days', () => {
    expect(M._rescanArgs({})).toEqual({ character: null, days: 14 });
    expect(M._rescanArgs({ character: null, days: null })).toEqual({ character: null, days: 14 });
    expect(M._rescanArgs({ character: '', days: '' })).toEqual({ character: null, days: 14 });
  });
  it('days are held to 1..60 and truncated', () => {
    expect(M.RESCAN_MAX_DAYS).toBe(60);
    for (const [given, want] of [[1, 1], [0, 1], [-5, 1], [7.9, 7], [60, 60], [61, 60], [100000, 60], ['30', 30]]) {
      expect(M._rescanArgs({ days: given }).days, String(given)).toBe(want);
    }
  });
  it('days that are not a number are refused, not defaulted', () => {
    for (const d of ['abc', true, {}, [1, 2], Infinity, NaN]) expect(M._rescanArgs({ days: d }).error, String(d)).toBe('days must be a number');
  });
  it('a character is a trimmed string of at most 64 characters', () => {
    expect(M._rescanArgs({ character: '  Aldenmar ' }).character).toBe('Aldenmar');
    expect(M._rescanArgs({ character: '   ' }).character).toBeNull();
    expect(M._rescanArgs({ character: 'x'.repeat(64) }).character).toHaveLength(64);
    expect(M._rescanArgs({ character: 'x'.repeat(65) }).error).toBe('character name is too long');
    for (const c of [5, {}, ['Aldenmar'], true]) expect(M._rescanArgs({ character: c }).error, String(c)).toBe('character must be a name');
  });
  it('a body that is not an object is refused', () => {
    for (const b of [null, undefined, 'x', 7, [1]]) expect(M._rescanArgs(b).error, String(b)).toBe('send a JSON object');
  });
});

describe('local pop-rescan: the route', () => {
  const cands = () => [{ path: '/x/eqlog_Aldenmar_pq.proj.txt', character: 'Aldenmar' }];
  it('answers only its two paths, with the right method on each', async () => {
    const { M } = load({ _rebuildCandidates: cands });
    expect((await call(M, 'GET', '/api/local/backfill/status')).answered).toBe(false);
    expect((await call(M, 'GET', '/api/local/pop-rescan/other')).answered).toBe(false);
    expect((await call(M, 'GET', '/api/local/pop-rescan')).status).toBe(405);
    expect((await call(M, 'GET', '/api/local/pop-rescan')).headers.Allow).toBe('POST');
    expect((await call(M, 'POST', '/api/local/pop-rescan/status', {})).status).toBe(405);
    expect((await call(M, 'PUT', '/api/local/pop-rescan', {})).status).toBe(405);
    const st = await call(M, 'GET', '/api/local/pop-rescan/status');
    expect(st.status).toBe(200);
    expect(st.headers['Cache-Control']).toBe('no-store');
    expect(st.body).toMatchObject({ ok: true, running: false, by: null, maxDays: 60, defaultDays: 14, run: null });
    expect(st.body.characters).toEqual([{ name: 'Aldenmar', excluded: false }]);
  });
  it('refuses junk: bad json, a days that is not a number, a body over the cap', async () => {
    const { M } = load({ _rebuildCandidates: cands });
    expect((await call(M, 'POST', '/api/local/pop-rescan', '{nope')).status).toBe(400);
    const bad = await call(M, 'POST', '/api/local/pop-rescan', { days: 'abc' });
    expect([bad.status, bad.body.error]).toEqual([400, 'days must be a number']);
    expect(M.RESCAN_BODY_MAX).toBe(2048);
    expect((await call(M, 'POST', '/api/local/pop-rescan', { character: 'x', pad: 'y'.repeat(M.RESCAN_BODY_MAX) })).status).toBe(413);
    expect(M._rescan.running).toBe(false);
  });
  it('an empty body is the defaults', async () => {
    const log = makeLog('eqlog_Aldenmar_pq.proj.txt', [[1, 'The evidence of Mavuin is the only thing that can save him now.']], 200);
    const { M } = load({ _rebuildCandidates: () => [{ path: log, character: 'Aldenmar' }] });
    const r = await call(M, 'POST', '/api/local/pop-rescan', '');
    expect([r.status, r.body.started, r.body.days, r.body.files]).toEqual([202, true, 14, 1]);
    await settle(M);
  });
  it('the guard is the router\'s: _localGuardBlock runs before the route, which is wired once', () => {
    const s = stripJs(src);
    const guard = s.indexOf('if (_localGuardBlock(req, res)) return;');
    const route = s.indexOf('if (await _localPopRescanRoute(req, res)) return;');
    expect(guard).toBeGreaterThan(0);
    expect(route).toBeGreaterThan(guard);
    expect(s.split('await _localPopRescanRoute(req, res)').length - 1).toBe(1);
  });
});

describe('local pop-rescan: one reader, one in-flight guard', () => {
  it('there is no second log reader: _rescanFile has one call site, inside _rescanRun, which both callers use', () => {
    const s = stripJs(src);
    expect(s.split('_rescanFile(').length - 1).toBe(2);                      // the definition and the one call
    expect(sliceBlock(s, 'async function _rescanRun(req, prog) {', '\n}\n')).toMatch(/await _rescanFile\(f, ctx, sink\)/);
    expect(sliceBlock(s, 'function _rescanPump() {', '\n}\n')).toMatch(/await _rescanRun\(req, prog\)/);
    expect(sliceBlock(s, 'function _rescanLocalStart(body) {', '\n}\n')).toMatch(/await _rescanRun\(\{ character: a\.character, days: a\.days \}, prog\)/);
  });
  const log = () => makeLog('eqlog_Aldenmar_pq.proj.txt', [[1, 'The evidence of Mavuin is the only thing that can save him now.']], 200);
  // A world whose log open waits for `gate`, so a run can be held in flight.
  const held = () => {
    let release; const gate = new Promise(r => { release = r; });
    return { release, fs: { promises: { open: async (p, m) => { await gate; return fs.promises.open(p, m); } } } };
  };

  it('a second click while the button\'s own run is going is a 409, and nothing starts', async () => {
    const h = held();
    const { M } = load({ fs: h.fs, _rebuildCandidates: () => [{ path: log(), character: 'Aldenmar' }] });
    const a = M._rescanLocalStart({});
    expect(a.status).toBe(202);
    expect(M._rescan).toMatchObject({ running: true, by: 'local' });          // claimed before anything awaits
    const b = M._rescanLocalStart({});
    expect([b.status, b.body.error]).toEqual([409, 'a rescan is already running']);
    expect(M._rescanStatus()).toMatchObject({ running: true, by: 'local', run: { by: 'local', state: 'running' } });
    h.release();
    await settle(M);
    expect(M._rescan.running).toBe(false);
    expect(M._rescanStatus()).toMatchObject({ running: false, by: null, run: { state: 'done', logs: 1 } });
  });
  it('while the website\'s request is running, the button is refused (409, says so); the request is untouched', async () => {
    const h = held(); const posts = [];
    const { M } = load({ fs: h.fs, _rebuildCandidates: () => [{ path: log(), character: 'Aldenmar' }], fetch: async (u, i) => { posts.push(JSON.parse(i.body)); return { ok: true, status: 200 }; } });
    M._applyRescanResponse({ requests: [{ id: 21, character: 'Aldenmar', days: 14 }] });
    expect(M._rescan).toMatchObject({ running: true, by: 'website' });
    const r = M._rescanLocalStart({});
    expect([r.status, r.body.error]).toEqual([409, 'a rescan the website asked for is running']);
    expect(M._rescanStatus()).toMatchObject({ running: true, by: 'website' });
    h.release();
    await settle(M);
    expect(posts.map(p => p.id)).toEqual([21]);
  });
  it('a website request that arrives during the button\'s run waits, then runs when it ends (no poll needed)', async () => {
    const h = held(); const posts = [];
    const { M } = load({ fs: h.fs, _rebuildCandidates: () => [{ path: log(), character: 'Aldenmar' }], fetch: async (u, i) => { posts.push(JSON.parse(i.body)); return { ok: true, status: 200 }; } });
    expect(M._rescanLocalStart({}).status).toBe(202);
    M._applyRescanResponse({ requests: [{ id: 22, character: 'Aldenmar', days: 14 }] });
    expect(M._rescan.queue).toHaveLength(1);
    expect(posts).toEqual([]);
    h.release();
    await settle(M);
    await new Promise(r => setTimeout(r, 50));
    await settle(M);
    expect(posts.map(p => p.id)).toEqual([22]);
    expect(M._rescan).toMatchObject({ running: false, by: null });
  });
  it('a run that throws still lets go of the guard', async () => {
    const { M } = load({ _rebuildCandidates: () => [{ path: log(), character: 'Aldenmar' }], uploadPopFlags: () => { throw new Error('boom'); } });
    M._rescanLocalStart({});
    await settle(M);
    expect(M._rescan.running).toBe(false);
    expect(['done', 'error']).toContain(M._rescanStatus().run.state);
  });
});

describe('local pop-rescan: what the run does and says', () => {
  const lines = [[2, 'The evidence of Mavuin is the only thing that can save him now.'], [1, "Mavuin's case: Mavuin's case is complete"]];
  const logA = () => makeLog('eqlog_Aldenmar_pq.proj.txt', lines, 200);
  const logB = () => makeLog('eqlog_Brackwyn_pq.proj.txt', lines, 200);
  const logX = () => makeLog('eqlog_Rethlan_pq.proj.txt', lines, 200);
  const cands = () => [{ path: logA(), character: 'Aldenmar' }, { path: logB(), character: 'Brackwyn' }, { path: logX(), character: 'Rethlan' }, { path: '/gone.txt', character: 'Zarrin', ignored: true }];
  async function run(body, over = {}) {
    const uploads = [];
    const { M } = load({ _rebuildCandidates: cands, _rebuildExcluded: (c) => c === 'Rethlan', uploadPopFlags: (e) => { uploads.push(...e); return Promise.resolve(); }, ...over });
    const start = M._rescanLocalStart(body);
    await settle(M);
    return { M, start, uploads, status: M._rescanStatus() };
  }
  it('reads each log, uploads the flag steps, and says how many it read, found and sent', async () => {
    const { start, uploads, status } = await run({});
    expect(start.status).toBe(202);
    expect(new Set(uploads.map(e => e.character))).toEqual(new Set(['Aldenmar', 'Brackwyn']));
    expect(status.run).toMatchObject({ state: 'done', by: 'local', logs: 2, found: 4, sent: 4, upload: true, why: null, days: 14, files: 2, filesDone: 2 });
  });
  it('a character kept out of stats is skipped and named; asking for it alone is refused with the reason', async () => {
    const all = await run({});
    expect(all.status.run.excluded).toEqual(['Rethlan']);
    const one = await run({ character: 'rethlan' });
    expect(one.start.status).toBe(400);
    expect(one.start.body.error).toBe('kept out of stats: Rethlan (skipped)');
    expect(one.uploads).toEqual([]);
    const none = await run({ character: 'Corvale' });
    expect([none.start.status, none.start.body.error]).toEqual([400, 'no EverQuest log found for that']);
    const ignored = await run({ character: 'Zarrin' });
    expect(ignored.start.status).toBe(400);
  });
  it('local mode: still parsed and counted, nothing handed to the upload path, and it says so', async () => {
    const { uploads, status } = await run({}, { _localOnly: () => true });
    expect(uploads).toEqual([]);
    expect(status.run).toMatchObject({ state: 'done', logs: 2, found: 4, sent: 0, upload: false, why: 'local mode' });
    expect(status.upload).toEqual({ upload: false, why: 'local mode' });
  });
  it('a paused agent: same, with the other reason', async () => {
    const { uploads, status } = await run({ character: 'Aldenmar' }, { _controlStandDown: () => ({ down: true, reason: 'kill' }) });
    expect(uploads).toEqual([]);
    expect(status.run).toMatchObject({ logs: 1, found: 2, sent: 0, upload: false, why: 'paused' });
  });
  it('does not wait on the upload queue when nothing was sent', async () => {
    const q = [{ kind: 'pop_flag' }];       // never drains: a wait here would hang for 90 s
    const t0 = Date.now();
    await run({}, { _localOnly: () => true, _uploadQueue: q });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('the days reach back only that far', async () => {
    const old = makeLog('eqlog_Corvale_pq.proj.txt', [[40, 'The evidence of Mavuin is the only thing that can save him now.'], [3, 'The evidence of Mavuin is the only thing that can save him now.']], 200);
    const c = () => [{ path: old, character: 'Corvale' }];
    expect((await run({ character: 'Corvale', days: 7 }, { _rebuildCandidates: c })).status.run.found).toBe(1);
    expect((await run({ character: 'Corvale', days: 60 }, { _rebuildCandidates: c })).status.run.found).toBe(2);
  });
  it('the character list: every log not ignored, once per name, kept-out ones marked', () => {
    const { M } = load({ _rebuildCandidates: () => [...cands(), { path: '/b2.txt', character: 'aldenmar' }], _rebuildExcluded: (c) => c === 'Rethlan' });
    expect(M._rescanCharacters()).toEqual([{ name: 'Aldenmar', excluded: false }, { name: 'Brackwyn', excluded: false }, { name: 'Rethlan', excluded: true }]);
  });
  it('the status carries no path and no line text', async () => {
    const { status } = await run({});
    expect(JSON.stringify(status)).not.toMatch(/eqlog_|wp-rescan|evidence of Mavuin/);
  });
});

// ── Maelin (the guild lead, 2026-10-26): "capture latest popflags, seer, and maelin messages" ──────────────────
// Source: SecretsOTheP/quests @ ea0c7661df2a0d50ebfd119a3473d3215d954b26, poknowledge/Grand_Librarian_Maelin.lua.
// Maelin's script prints no flag line of its own. Each time it sets a flag it sends the SAME generic line the other
// flag NPCs send, e.other:Message(15, "You have received a character flag!") (.lua:18, 40, 61, 76), straight after her
// Message(0, "Maelin tells you, '...'") / "Maelin takes a deep breath and continues, '...'" line. Both halves are already
// gated: _POP_GRANT_RX takes the grant and _POP_PREV_RX (the "Maelin" prefix) attaches her line to it, which is what the
// bot's table keys on (utils/popFlagStages.js: cipher_1, zebuxoruk_1, zebuxoruk_2, zeks_6). So nothing new is gated.
// The lines below are her script's text, abridged at the end of a sentence where the script goes on.
describe('Maelin: her flag grants are already caught; nothing else of hers leaves the machine', () => {
  const GRANT_FLAG = 'You have received a character flag!';
  const CIPHER   = "Maelin tells you, 'Astounding, this truly is the Cipher of Druzzil!  I shall take notes from your knowledge and try to learn from it.  If you happen upon any artifacts that have writings in the language of the gods bring them back to me and I will do my best to read them to you in common tongue.'";   // .lua:16
  const LORE     = "Maelin tells you, 'This is quite interesting friends.  It is a detailed document on what has become of Zebuxoruk.  It seems that he had been tampering with translating works of the gods for mortals.  This knowledge was leading them to enlightenment and finally to ascention into dietyhood.  This angered the gods, for they felt that any diety should be chosen by them.  Ascension of any mortal was not something they were prepared to deal with.'";   // .lua:38
  const POWER    = "Maelin takes a deep breath and continues, 'I can see now that he was not joking at all.  Let us suppose that you travelers could venture into the Elemental Planes and retrieve this essence; and form it into one powerful conglomeration.'";   // .lua:59 (abridged)
  const ZEKS     = "Maelin tells you, 'This cannot be.  You must hurry!  Rallos Zek seems to be planing a massive raid on Norrath.  He is tired of mortals overstepping their boundaries!  You are the only hope!  Go challenge Rallos, hurry!'";   // .lua:74
  const NOT_FLAG = [
    "Maelin tells you, 'Welcome to Myrist!  This is truly something for me to be proud of.'",                                                           // .lua:22
    "Maelin tells you, 'Welcome back my friends.  I assure you that I have been studying the Cipher of Druzzil very diligently.'",                    // .lua:13
    "Maelin tells you, 'Come now, I don't see any new lore about you.  There is no reason to be dishonest with me.'",                                  // .lua:48
    "Maelin tells you, 'As I have told you, you must retrieve the elemental essence from each elemental plane so that we can activate the machine.'", // .lua:10
    "Maelin tells you, 'As I have already told you, Rallos must be stopped!  The war he plans to rage on Norrath could have devastating effects.'",   // .lua:71
    "Maelin tells you, 'What is this that you have found?  It appears to be written in the divine language.  Let me see.'",                           // .lua:45
  ];
  const { M } = load();
  const feed = (...ls) => { const s = sink(); for (const l of ls) M._rescanLine(`${stamp(at(1, s.events.length))} ${l}`, 'Aldenmar', 0, s); return s; };

  it('the four grants (cipher, Zebuxoruk lore, power source, Zek notes) are each a grant carrying her line before it', () => {
    for (const npcLine of [CIPHER, LORE, POWER, ZEKS]) {
      expect(M._rescanWants(npcLine), npcLine.slice(0, 40)).toBe('prev');
      const s = feed(npcLine, GRANT_FLAG);
      const g = s.events.filter(e => e.kind === 'grant');
      expect(g, npcLine.slice(0, 40)).toHaveLength(1);
      expect(g[0].prev).toBe(npcLine.slice(0, 160));
      expect(g[0].prev.startsWith('Maelin ')).toBe(true);
    }
  });
  it('her lines that do not set a flag are gated as "line before" only and send nothing alone', () => {
    for (const l of NOT_FLAG) {
      expect(M._rescanWants(l), l.slice(0, 40)).toBe('prev');
      const s = feed(l);
      expect(s.events, l.slice(0, 40)).toEqual([]);
      expect(s.found).toBe(0);
    }
  });
  it('a non-grant line of hers followed by something else is never attached to a later grant', () => {
    const s = feed(NOT_FLAG[0], 'You gain experience!!', GRANT_FLAG);
    expect(s.events.filter(e => e.kind === 'grant').every(e => e.prev === null)).toBe(true);
  });
  it('a player typing her words, or quoting a grant, is not a gate', () => {
    for (const l of [
      `Zarrin says, '${CIPHER}'`, `Brackwyn tells the guild, '${LORE}'`, `You tell your guild, '${ZEKS}'`,
      `Corvale tells you, '${POWER}'`, "Zarrin says, 'You have received a character flag!'", `Grand Librarian ${CIPHER}`, ` ${CIPHER}`,
    ]) expect(M._rescanWants(l), l.slice(0, 50)).toBeNull();
  });
  it('the Seer\'s echo of her words stays a recital, as before', () => {
    expect(M._rescanWants("The words of Maelin echo in your mind, 'The Zeks and Solusek are working together.'")).toBe('recital');
  });
});
