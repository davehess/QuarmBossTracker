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
import { AGENT_INDEX, readSource, sliceBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(src, 'const TS_RX = ', '  return isNaN(d.getTime()) ? null : d;\n}');
const gateBlock = sliceBlock(src, 'const _POP_GRANT_RX = ', "    ...(kind === 'trial' ? { npc: trialNpc.slice(0, 64) } : {}),\n  };\n}");
const pfBlock = sliceBlock(src, 'const _PF_STAGES = [', '  return out;\n}');
const seekBlock = sliceBlock(src, 'async function _rbSeek(fh, size, sinceMs) {', '  return lo;\n}');
const netBlock = sliceBlock(src, 'async function _rescanDrained(maxMs) {', '  return false;     // the bot hands the request out again after 30 minutes; the re-read is idempotent\n}');
const rescanBlock = sliceBlock(src, 'const RESCAN_CHUNK_BYTES = ', '      } finally { _rescan.running = false; }\n    })();\n  }\n}');

// The shipped code, with parsePopFlagLine wrapped so every line handed to it is recorded.
function load(world = {}) {
  const calls = [];
  const w = {
    fs, _zealState: {}, stats: {}, _liveFightActive: () => false, _uploadQueue: [], _uploadOpts: null, AGENT_VERSION: '9.9.9',
    _rebuildCandidates: () => [], _rebuildExcluded: () => false, shouldUploadForCharacter: () => true,
    uploadPopFlags: () => Promise.resolve(), _getApiBase: () => 'http://bot.test/api/agent', _getAgentToken: () => 'tok',
    fetch: async () => ({ ok: true, status: 200 }), ...world,
  };
  const names = Object.keys(w);
  const body = tsBlock + '\n' + gateBlock.replace('function parsePopFlagLine(', 'function _realParsePopFlagLine(') + '\n'
    + 'function parsePopFlagLine(l, c) { __calls.push(l); return _realParsePopFlagLine(l, c); }\n'
    + pfBlock + '\n' + netBlock + '\n' + seekBlock + '\n' + rescanBlock
    + '\nreturn { _rescanWants, _rescanLine, _rescanFile, _rescanIsolate, _rescanRun, _applyRescanResponse, _rescan, _pfState, _popPrevLine, _popLastHail, parsePopFlagLine, RESCAN_MAX_BYTES, RESCAN_MAX_WAIT_MS };';
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
