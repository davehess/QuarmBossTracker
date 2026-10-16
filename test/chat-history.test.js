// test/chat-history.test.js: Mimic's Chat overlay, round 3 (the guild lead, 2026-10-14):
//   • "bring in the chat from the previous characters you were on, and put a line in saying swapped
//     character, and the timeframe between"
//   • "if you log out and log back in, show the previous logs (past 24h … 1)"
//   • "search to only show chats from that specific character"
//   • "lines like 'You have entered Plane of Knowledge' are worth showing too"
//
// The promise under all of it is the same as round 1: local only. History is local file I/O read BACKWARDS
// from the end of each log, through the same classifier and gates as the live feed; nothing is written,
// queued or uploaded. Fixtures are tiny files in the OS temp dir, removed afterwards.
//
// Run: npx vitest run test/chat-history.test.js

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const AGENT_SRC = readSource(AGENT_INDEX);
const CHAT_HTML = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chat.html'), 'utf8');
const SCRIPT = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));

const between = (a, b) => AGENT_SRC.slice(AGENT_SRC.indexOf(a), AGENT_SRC.indexOf(b) + b.length);
const HISTORY_BLOCK = between('// ── Chat history: the last N hours of chat', '// ── end Chat history ──');
const LIVE_BLOCK = between('// ── Local chat window: the feed behind Mimic\'s Chat overlay', '// ── end Local chat window ──');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `[${DAYS[d.getDay()]} ${MONS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
const NOW = new Date(2026, 9, 14, 22, 0, 0).getTime();
const MIN = 60_000;
const at = (minAgo, text) => `${stamp(NOW - minAgo * MIN)} ${text}`;

let DIR;
beforeAll(() => { DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-history-')); });
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
beforeEach(() => { agent._resetLocalChatForTest(); agent._resetChatHistoryForTest(); });

// A log file with the given lines; mtime set so the "written inside the window" check is about the fixture's clock.
function mk(name, lines, { mtimeMinAgo = 0, eol = '\n', trailing = true } = {}) {
  const f = path.join(DIR, `eqlog_${name}_pq.proj.txt`);
  fs.writeFileSync(f, lines.join(eol) + (trailing ? eol : ''));
  const when = new Date(NOW - mtimeMinAgo * MIN);
  fs.utimesSync(f, when, when);
  return f;
}
const collect = async (file, cutoff, opts) => {
  const got = [];
  const r = await agent.chatReadLogBackwards(file, cutoff, (l) => { got.push(l); }, opts);
  return { got, ...r };
};
const HIST = (files, q = {}) => agent.buildChatHistory({ hours: 6, ...q }, NOW, { files });
const texts = (r) => r.lines.map(l => (l.sep ? '[' + l.text + ']' : l.text));

// ── 1. The backwards reader ───────────────────────────────────────────────────────────────────
describe('chatReadLogBackwards: read from the end, stop at the window', () => {
  it('delivers every whole line newest first, across chunk boundaries that fall mid-line', async () => {
    const lines = [];
    for (let i = 0; i < 60; i++) lines.push(at(300 - i, `Corvale tells the guild, 'line number ${i} ${'x'.repeat(i % 17)}'`));
    const f = mk('Aldenmar', lines);
    for (const chunk of [7, 64, 100, 333, 4096]) {
      const r = await collect(f, 0, { chunk });
      expect(r.got, `chunk ${chunk}`).toEqual(lines.slice().reverse());
    }
  });
  it('a chunk cut in the middle of a multi-byte character still decodes whole', async () => {
    const lines = [at(5, "Corvale tells the guild, 'café ééé naïve'"), at(4, "Corvale tells the guild, 'ok'")];
    const f = mk('Aldenmar', lines);
    for (let chunk = 5; chunk < 40; chunk += 3) {
      const r = await collect(f, 0, { chunk });
      expect(r.got, `chunk ${chunk}`).toEqual(lines.slice().reverse());
    }
  });
  it('handles CRLF endings and a file with no trailing newline', async () => {
    const lines = [at(3, "Corvale tells the guild, 'a'"), at(2, "Corvale tells the guild, 'b'"), at(1, "Corvale tells the guild, 'c'")];
    const f = mk('Aldenmar', lines, { eol: '\r\n', trailing: false });
    const r = await collect(f, 0, { chunk: 16 });
    expect(r.got).toEqual(lines.slice().reverse());
    expect(r.end).toBe('start');
  });
  it('stops at the window: a big file is not read whole, and every line inside the window arrives', async () => {
    const lines = [];
    for (let i = 0; i < 400; i++) lines.push(at(1000 - i, `Corvale tells the guild, 'filler ${i} ${'z'.repeat(40)}'`));   // 1000 .. 601 min ago
    for (let i = 0; i < 20; i++) lines.push(at(100 - i, `Corvale tells the guild, 'recent ${i}'`));                      // 100 .. 81 min ago
    const f = mk('Aldenmar', lines);
    const size = fs.statSync(f).size;
    const r = await collect(f, NOW - 120 * MIN, { chunk: 512 });
    expect(r.end).toBe('window');
    expect(r.bytes).toBeLessThan(size / 2);
    expect(r.bytes).toBeGreaterThanOrEqual(512);
    const recent = r.got.filter(l => l.includes("'recent "));
    expect(recent).toHaveLength(20);
    expect(r.got.slice(0, 20)).toEqual(lines.slice(-20).reverse());
  });
  it('a file with no recent lines is left after its first chunk', async () => {
    const lines = [];
    for (let i = 0; i < 300; i++) lines.push(at(2000 - i, `Corvale tells the guild, 'old ${i} ${'q'.repeat(30)}'`));
    const f = mk('Aldenmar', lines);
    const r = await collect(f, NOW - 60 * MIN, { chunk: 1024 });
    expect(r.end).toBe('window');
    expect(r.bytes).toBeLessThanOrEqual(1024);
  });
  it('a missing file resolves { end: "missing" } and never throws', async () => {
    const r = await agent.chatReadLogBackwards(path.join(DIR, 'nope.txt'), 0, () => { throw new Error('should not be called'); });
    expect(r).toEqual({ end: 'missing', bytes: 0 });
  });
  it('an empty file ends at the start; a byte cap stops a runaway read', async () => {
    const f = path.join(DIR, 'eqlog_Empty_pq.proj.txt');
    fs.writeFileSync(f, '');
    expect((await collect(f, 0)).end).toBe('start');
    const big = mk('Aldenmar', Array.from({ length: 200 }, (_, i) => at(900 - i, `Corvale tells the guild, 'n ${i} ${'y'.repeat(50)}'`)));
    const r = await collect(big, 0, { chunk: 256, maxBytes: 1024 });
    expect(r.end).toBe('cap');
    expect(r.bytes).toBeLessThan(1024 + 256 + 1);
  });
  it('the callback can stop the read early', async () => {
    const f = mk('Aldenmar', Array.from({ length: 50 }, (_, i) => at(100 - i, `Corvale tells the guild, 'n ${i}'`)));
    const got = [];
    const r = await agent.chatReadLogBackwards(f, 0, (l) => { got.push(l); return got.length >= 3; }, { chunk: 64 });
    expect(got).toHaveLength(3);
    expect(r.end).toBe('stopped');
  });
});

// ── 2. History: same classifier, same gates, merged across characters ─────────────────────────────
describe('buildChatHistory', () => {
  it('only the window asked for: older lines are left out', async () => {
    const f = mk('Aldenmar', [at(500, "Corvale tells the guild, 'too old'"), at(100, "Corvale tells the guild, 'inside'")]);
    const r = await HIST([{ character: 'Aldenmar', file: f }], { hours: 3 });
    expect(texts(r)).toEqual(['inside']);
    expect(r.hours).toBe(3);
  });
  it('merges two characters by timestamp, with a swap line and its gap between their stretches', async () => {
    const a = mk('Aldenmar', [at(120, "Corvale tells the guild, 'a1'"), at(100, "Corvale tells the guild, 'a2'")]);
    const b = mk('Brackwyn', [at(86, "Rethlan tells the raid, 'b1'"), at(80, "Rethlan tells the raid, 'b2'")]);
    const r = await HIST([{ character: 'Aldenmar', file: a }, { character: 'Brackwyn', file: b }]);
    expect(texts(r)).toEqual(['a1', 'a2', "[Swapped to Brackwyn — 14m after Aldenmar's last line]", 'b1', 'b2']);
    expect(r.lines.map(l => l.on || null)).toEqual(['Aldenmar', 'Aldenmar', null, 'Brackwyn', 'Brackwyn']);
    expect(r.lines[2]).toMatchObject({ sep: 1, from: 'Aldenmar', to: 'Brackwyn' });
    expect(r.lines[2].ch).toBeUndefined();            // a swap line is not a chat line
  });
  it('swaps back and forth when the stretches interleave', async () => {
    const a = mk('Aldenmar', [at(200, "Corvale tells the guild, 'a1'"), at(60, "Corvale tells the guild, 'a2'")]);
    const b = mk('Brackwyn', [at(150, "Rethlan tells the raid, 'b1'")]);
    const r = await HIST([{ character: 'Aldenmar', file: a }, { character: 'Brackwyn', file: b }]);
    expect(texts(r)).toEqual(['a1', "[Swapped to Brackwyn — 50m after Aldenmar's last line]", 'b1', "[Swapped to Aldenmar — 1h 30m after Brackwyn's last line]", 'a2']);
  });
  it('one guild line heard on both characters appears once', async () => {
    const same = at(50, "Corvale tells the guild, 'hello both'");
    const a = mk('Aldenmar', [same]);
    const b = mk('Brackwyn', [same]);
    const r = await HIST([{ character: 'Aldenmar', file: a }, { character: 'Brackwyn', file: b }]);
    expect(texts(r)).toEqual(['hello both']);
  });
  it('the gates are the live feed\'s: tells, group, officer and custom stay behind their switches', async () => {
    const f = mk('Aldenmar', [
      at(60, "Corvale tells you, 'a private tell'"), at(59, "Brackwyn tells the group, 'grp'"), at(58, "Rethlan tells Wolfpackofficer:5, 'off'"),
      at(57, "Zarrin tells General:2, 'cust'"), at(56, "Corvale tells the guild, 'public'"), at(55, "You say, 'mine'"),
    ]);
    const files = [{ character: 'Aldenmar', file: f }];
    expect(texts(await HIST(files))).toEqual(['public', 'mine']);
    expect(texts(await HIST(files, { tells: true }))).toEqual(['a private tell', 'public', 'mine']);
    expect(texts(await HIST(files, { group: true }))).toEqual(['grp', 'public', 'mine']);
    expect(texts(await HIST(files, { officer: true }))).toEqual(['off', 'public', 'mine']);
    expect(texts(await HIST(files, { custom: true }))).toEqual(['cust', 'public', 'mine']);
  });
  it('the Seer\'s lines are tells in history too: behind the Tells switch', async () => {
    const f = mk('Aldenmar', [at(30, 'The words of Maelin echo in your mind.'), at(29, "Corvale tells the guild, 'g'")]);
    const files = [{ character: 'Aldenmar', file: f }];
    expect(texts(await HIST(files))).toEqual(['g']);
    const withTells = await HIST(files, { tells: true });
    expect(withTells.lines[0]).toMatchObject({ ch: 'tell', who: 'Seer', npc: true });
  });
  it('your own lines carry "You" and the character they were typed on; a tell keeps its recipient', async () => {
    const f = mk('Aldenmar', [at(20, "You told Corvale, 'sure'"), at(19, "You say to your guild, 'on my way'")]);
    const r = await HIST([{ character: 'Aldenmar', file: f }], { tells: true });
    expect(r.lines[0]).toMatchObject({ who: 'You', self: true, to: 'Corvale', on: 'Aldenmar' });
    expect(r.lines[1]).toMatchObject({ ch: 'guild', who: 'You', self: true, on: 'Aldenmar' });
  });
  it('zone changes are in history; LOADING, PLEASE WAIT is not', async () => {
    const f = mk('Aldenmar', [at(40, 'LOADING, PLEASE WAIT...'), at(39, 'You have entered Plane of Knowledge.'), at(38, "Corvale tells the guild, 'hi'")]);
    const r = await HIST([{ character: 'Aldenmar', file: f }]);
    expect(r.lines.map(l => [l.ch, l.text])).toEqual([['zone', 'Plane of Knowledge'], ['guild', 'hi']]);
    expect(r.lines[0].on).toBe('Aldenmar');
  });
  it('a zone line next to a swap line reads as a different thing: the swap has no channel, the zone has no speaker', async () => {
    const a = mk('Aldenmar', [at(90, "Corvale tells the guild, 'a1'")]);
    const b = mk('Brackwyn', [at(60, 'You have entered Plane of Knowledge.')]);
    const r = await HIST([{ character: 'Aldenmar', file: a }, { character: 'Brackwyn', file: b }]);
    const [, sep, zone] = r.lines;
    expect(sep.sep).toBe(1);
    expect(sep.text).toMatch(/^Swapped to Brackwyn/);
    expect(sep.text).not.toContain('Plane of Knowledge');
    expect(zone).toMatchObject({ ch: 'zone', who: '', text: 'Plane of Knowledge' });
  });
  it('a character excluded from stats is skipped, like the live tap', async () => {
    const a = mk('Aldenmar', [at(30, "Corvale tells the guild, 'a'")]);
    const b = mk('Brackwyn', [at(20, "Rethlan tells the raid, 'b'")]);
    const watched = [{ character: 'Aldenmar', logPath: a }, { character: 'Brackwyn', logPath: b }];
    const files = agent.chatHistoryFiles(watched, (c) => c === 'Brackwyn');
    expect(files.map(f => f.character)).toEqual(['Aldenmar']);
    const r = await HIST(files);
    expect(texts(r)).toEqual(['a']);
    expect(r.chars).toEqual(['Aldenmar']);
  });
  it('the default file list asks shouldUploadForCharacter, the same predicate the live tap uses', () => {
    const code = stripJs(HISTORY_BLOCK);
    expect(code).toMatch(/chatHistoryFiles\(stats\.watchedLogs, c => !shouldUploadForCharacter\(c\)\)/);
  });
  it('the same log listed twice is read once', () => {
    const files = agent.chatHistoryFiles([{ character: 'A', logPath: '/x/a.txt' }, { character: 'A', logPath: '/X/A.txt' }, { character: 'B', logPath: '' }], null);
    expect(files).toHaveLength(1);
  });
  it('a log not written inside the window is not even opened; a missing one is skipped', async () => {
    const stale = mk('Aldenmar', [at(900, "Corvale tells the guild, 'old'")], { mtimeMinAgo: 900 });
    const r = await HIST([{ character: 'Aldenmar', file: stale }, { character: 'Gone', file: path.join(DIR, 'missing.txt') }], { hours: 6 });
    expect(r.lines).toEqual([]);
    expect(r.bytes).toBe(0);
    expect(r.chars).toEqual([]);
  });
  it('is capped at a few thousand lines, keeping the newest', async () => {
    const n = agent.CHAT_HISTORY_MAX + 40;
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(at(300 - i * 0.05, `Corvale tells the guild, 'm${i}'`));
    const f = mk('Aldenmar', lines);
    const r = await HIST([{ character: 'Aldenmar', file: f }], { hours: 6 });
    expect(r.lines).toHaveLength(agent.CHAT_HISTORY_MAX);
    expect(r.truncated).toBe(true);
    expect(r.lines[r.lines.length - 1].text).toBe(`m${n - 1}`);
  });
  it('the cap also holds across characters: two logs of 2000 lines serve the newest 3000 of the merge', async () => {
    const per = 2000;
    const a = [], b = [];
    for (let i = 0; i < per; i++) {
      a.push(at(300 - i * 0.1, `Corvale tells the guild, 'a${i}'`));
      b.push(at(300 - i * 0.1 - 0.05, `Rethlan tells the raid, 'b${i}'`));
    }
    const fa = mk('Aldenmar', a), fb = mk('Brackwyn', b);
    const r = await HIST([{ character: 'Aldenmar', file: fa }, { character: 'Brackwyn', file: fb }]);
    const chat = r.lines.filter(l => !l.sep);
    expect(chat).toHaveLength(agent.CHAT_HISTORY_MAX);
    expect(r.truncated).toBe(true);
    expect(chat.map(l => l.t)).toEqual(chat.map(l => l.t).slice().sort((x, y) => x - y));
    expect(chat[chat.length - 1].text).toBe(`b${per - 1}`);
  });
  it('hours are clamped to 1..24', async () => {
    const f = mk('Aldenmar', [at(70, "Corvale tells the guild, 'x'")]);
    const files = [{ character: 'Aldenmar', file: f }];
    expect((await HIST(files, { hours: 0 })).hours).toBe(1);
    expect((await HIST(files, { hours: 999 })).hours).toBe(24);
    expect((await HIST(files, { hours: 'abc' })).hours).toBe(1);
  });
  it('asking for history does not touch the live ring or switch on live capture of anything', async () => {
    const f = mk('Aldenmar', [at(10, "Rethlan tells Wolfpackofficer:5, 'off'")]);
    await HIST([{ character: 'Aldenmar', file: f }], { officer: true });
    expect(agent._chatRingForTest()).toHaveLength(0);
    expect(agent.chatPolicyNow()).toEqual({ tells: false, group: false, officer: false, custom: false, melee: false, spells: false, skills: false, loot: false, random: false, other: false, away: false });
  });
});

// ── 3. The route ──────────────────────────────────────────────────────────────────────────────
describe('GET /api/chat/history', () => {
  const run = async (req) => {
    const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    await agent._handleLocalChatHistoryForTest(req, res);
    return res;
  };
  it('answers a foreign origin with 403 and no lines', async () => {
    const res = await run({ url: '/api/chat/history?hours=6', headers: { origin: 'https://evil.example' } });
    expect(res.code).toBe(403);
    expect(res.body).not.toContain('"lines"');
  });
  it('answers 127.0.0.1, localhost and file origins, and no origin at all', async () => {
    for (const origin of ['http://127.0.0.1:7777', 'http://localhost:7777', 'file://', undefined]) {
      const res = await run({ url: '/api/chat/history?hours=6', headers: origin ? { origin } : {} });
      expect(res.code, String(origin)).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, lines: [] });   // nothing watched in a test
    }
  });
  it('is GET-only on the local server, next to /api/chat, and checks the origin first', () => {
    const route = stripJs(AGENT_SRC).match(/if \(req\.url && req\.url\.split\('\?'\)\[0\] === '\/api\/chat\/history'[^\n]*/)[0];
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain('_handleLocalChatHistory(req, res)');
    const handler = stripJs(AGENT_SRC.slice(AGENT_SRC.indexOf('async function _handleLocalChatHistory(req, res) {')));
    expect(handler.indexOf('_localOriginOk(req)')).toBeGreaterThan(0);
    expect(handler.indexOf('_localOriginOk(req)')).toBeLessThan(handler.indexOf('getChatHistory('));
  });
  it('reads the same switch names as /api/chat, as "1", and never as a truthy string', async () => {
    const code = stripJs(HISTORY_BLOCK);
    expect(code).toContain("for (const k of CHAT_POLICY_KEYS) q[k] = q[k] === '1';");
  });
  it('caches briefly: two asks inside the window with the same switches read once', async () => {
    const f = mk('Aldenmar', [at(10, "Corvale tells the guild, 'one'")]);
    const files = [{ character: 'Aldenmar', file: f }];
    const first = await agent.getChatHistory({ hours: 6 }, NOW, { files });
    expect(first.lines).toHaveLength(1);
    // (a call with explicit files is never cached: tests stay independent. The cache itself:)
    const code = stripJs(HISTORY_BLOCK);
    expect(code).toContain('CHAT_HISTORY_CACHE_MS');
    expect(code).toMatch(/_chatHistCache\.key === key && t - _chatHistCache\.at < CHAT_HISTORY_CACHE_MS/);
  });
});

// ── 4. Local only: nothing written, queued or uploaded ────────────────────────────────────────────
describe('history is local file I/O and nothing else', () => {
  const code = stripJs(HISTORY_BLOCK);
  it('the block is real, and names no buffer, queue, uploader, network call or file write', () => {
    expect(code.length).toBeGreaterThan(2500);
    for (const bad of [/\bchatBuffer\b/, /\btellBuffer\b/, /\bchatBatch\b/, /\brecentTells\b/, /\b_pushRecentTell\b/, /\benqueueUpload\b/,
      /\buploadChat\b/, /\buploadTells\b/, /\bfetch\(/, /\bhttps?\.request\b/, /\bwriteFile/, /\bappendFile/, /\bcreateWriteStream\b/,
      /\bcopyFile\b/, /\brename\b/, /\bunlink\b/, /\b_uploadQueue\b/, /\bQUEUE_FILE\b/, /\bsetChatPolicy\b/, /\b_chatRing\b/]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
  });
  it('the only file it opens is opened read-only', () => {
    const opens = code.match(/fs\.promises\.open\([^)]*\)/g) || [];
    expect(opens).toEqual(["fs.promises.open(file, 'r')"]);
    expect(code).not.toMatch(/\bfs\.(?:write|append|mkdir|rm|truncate|open)(?:Sync)?\(/);
  });
  it('the live block still names no file access (so the ring stays memory only)', () => {
    expect(stripJs(LIVE_BLOCK)).not.toMatch(/\bfs\./);
  });
  it('a zone line fed to the live ring leaves every upload buffer untouched', () => {
    const b = agent._uploadBuffersForTest();
    const before = [b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length];
    const line = at(1, 'You have entered Plane of Knowledge.');
    expect(agent.noteLocalChatLine(line, 'Aldenmar', NOW)).toBe(true);
    expect([b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length]).toEqual(before);
    expect(agent.classifyChatLine(line, 'Aldenmar')).not.toBeNull();
  });
});

// ── 5. Zone lines ─────────────────────────────────────────────────────────────────────────────
describe('zone changes in the feed', () => {
  const L = (s) => at(5, s);
  it('"You have entered X." classifies as a zone line with no speaker', () => {
    expect(agent.classifyChatLine(L('You have entered Plane of Knowledge.'), 'Aldenmar')).toMatchObject({ ch: 'zone', who: '', text: 'Plane of Knowledge', self: false, npc: false });
    expect(agent.classifyChatLine(L('You have entered Ak\'Anon.'), 'Aldenmar')).toMatchObject({ ch: 'zone', text: 'Ak\'Anon' });
    expect(agent.classifyChatLine(L('You have entered The Hole.'), 'Aldenmar')).toMatchObject({ ch: 'zone', text: 'The Hole' });
  });
  it('LOADING, PLEASE WAIT... and the "entered an area" lines are not zone lines', () => {
    expect(agent.classifyChatLine(L('LOADING, PLEASE WAIT...'), 'Aldenmar')).toBeNull();
    expect(agent.classifyChatLine(L('You have entered an Arena (PvP) area.'), 'Aldenmar')).toBeNull();
    expect(agent.classifyChatLine(L('You have entered an area where levitation will not work.'), 'Aldenmar')).toBeNull();
    expect(agent.classifyChatLine(L('You have entered a PvP zone.'), 'Aldenmar')).toBeNull();
  });
  it('LOADING is not captured into the ring either', () => {
    expect(agent.noteLocalChatLine(L('LOADING, PLEASE WAIT...'), 'Aldenmar', NOW)).toBe(false);
    expect(agent._chatRingForTest()).toHaveLength(0);
  });
  it('Zones is a group of its own (id "zone"), ungated, with a colour, so it has a chip and is on by default', () => {
    const g = agent.CHAT_GROUPS.find(x => x.id === 'zone');
    expect(g).toMatchObject({ id: 'zone', label: 'Zones', channels: ['zone'] });
    expect(g.gate).toBeUndefined();
    expect(agent.CHAT_CHANNELS.zone.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('the live feed keeps it with the character whose log it came from', () => {
    agent.noteLocalChatLine(L('You have entered Plane of Knowledge.'), 'Aldenmar', NOW);
    const r = agent.serializeLocalChat({ since: 0 }, NOW);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ ch: 'zone', who: '', text: 'Plane of Knowledge', on: 'Aldenmar' });
  });
  it('two characters zoning together each keep their own zone line (it is per character, unlike a guild line)', () => {
    expect(agent.noteLocalChatLine(L('You have entered Plane of Knowledge.'), 'Aldenmar', NOW)).toBe(true);
    expect(agent.noteLocalChatLine(L('You have entered Plane of Knowledge.'), 'Brackwyn', NOW)).toBe(true);
    expect(agent.noteLocalChatLine(L('You have entered Plane of Knowledge.'), 'Brackwyn', NOW)).toBe(false);
  });
  it('the classifier is the one place the line is parsed: no second pattern for it in the agent', () => {
    expect((stripJs(AGENT_SRC).match(/You have entered/g) || [])).toHaveLength(1);
  });
});

// ── 6. The live ring: previous characters stay, and a swap line says so ───────────────────────────
describe('the live feed across a character switch', () => {
  const say = (minAgo, text, who) => agent.noteLocalChatLine(at(minAgo, text), who, NOW);
  it('keeps the earlier character\'s lines, each tagged with the character that heard it', () => {
    say(30, "Corvale tells the guild, 'before'", 'Aldenmar');
    say(10, "Rethlan tells the raid, 'after'", 'Brackwyn');
    const lines = agent.serializeLocalChat({ since: 0 }, NOW).lines.filter(l => !l.sep);
    expect(lines.map(l => [l.text, l.on])).toEqual([['before', 'Aldenmar'], ['after', 'Brackwyn']]);
  });
  it('puts "Swapped to X — gap after Y\'s last line" between them, with the gap measured line to line', () => {
    say(30, "Corvale tells the guild, 'before'", 'Aldenmar');
    say(16, "Rethlan tells the raid, 'after'", 'Brackwyn');
    const lines = agent.serializeLocalChat({ since: 0 }, NOW).lines;
    expect(lines.map(l => l.text)).toEqual(['before', "Swapped to Brackwyn — 14m after Aldenmar's last line", 'after']);
    expect(lines[1]).toMatchObject({ sep: 1, from: 'Aldenmar', to: 'Brackwyn' });
    expect(lines[1].ch).toBeUndefined();
    expect(typeof lines[1].n).toBe('number');
  });
  it('no swap line for the same character, or for two logs written within the swap threshold (dual boxing)', () => {
    say(30, "Corvale tells the guild, 'one'", 'Aldenmar');
    say(29, "Corvale tells the guild, 'two'", 'Aldenmar');
    agent.noteLocalChatLine(`${stamp(NOW - 29 * MIN + 10_000)} Rethlan tells the raid, 'three'`, 'Brackwyn', NOW);   // 10 s later: two clients, not a swap
    expect(agent.serializeLocalChat({ since: 0 }, NOW).lines.filter(l => l.sep)).toHaveLength(0);
  });
  it('the threshold is 30 s: a gap just over it is a swap, just under is not', () => {
    const t = (sec, who, n) => agent.noteLocalChatLine(`${stamp(NOW + sec * 1000)} Corvale tells the guild, '${n}'`, who, NOW);
    t(0, 'Aldenmar', 'a');
    t(29, 'Brackwyn', 'b');
    expect(agent.serializeLocalChat({ since: 0 }, NOW).lines.filter(l => l.sep)).toHaveLength(0);
    t(29 + 31, 'Aldenmar', 'c');
    expect(agent.serializeLocalChat({ since: 0 }, NOW).lines.filter(l => l.sep)).toHaveLength(1);
  });
  it('a swap line is display only: not a chat line, not in any group, and not classifiable', () => {
    say(30, "Corvale tells the guild, 'before'", 'Aldenmar');
    say(10, "Rethlan tells the raid, 'after'", 'Brackwyn');
    const sep = agent.serializeLocalChat({ since: 0 }, NOW).lines.find(l => l.sep);
    expect(agent.classifyChatLine(at(1, sep.text), 'Aldenmar')).toBeNull();
    expect(agent.classifyChatLine(sep.text, 'Aldenmar')).toBeNull();
    expect(agent.CHAT_GROUPS.some(g => g.channels.includes(sep.ch))).toBe(false);
  });
  it('the cursor still works with swap lines in the ring', () => {
    say(30, "Corvale tells the guild, 'before'", 'Aldenmar');
    const first = agent.serializeLocalChat({ since: 0 }, NOW);
    say(10, "Rethlan tells the raid, 'after'", 'Brackwyn');
    const next = agent.serializeLocalChat({ since: first.seq }, NOW);
    expect(next.lines.map(l => l.text)).toEqual(["Swapped to Brackwyn — 20m after Aldenmar's last line", 'after']);
  });
  it('gap text: seconds, minutes, hours and minutes, days', () => {
    const sw = (gapMs) => agent.chatSwapBetween({ on: 'Aldenmar', t: 0 }, { on: 'Brackwyn', t: gapMs }).text;
    expect(sw(45_000)).toBe("Swapped to Brackwyn — 45s after Aldenmar's last line");
    expect(sw(14 * MIN)).toContain('— 14m after');
    expect(sw(125 * MIN)).toContain('— 2h 5m after');
    expect(sw(180 * MIN)).toContain('— 3h after');
    expect(sw(72 * 60 * MIN)).toContain('— 3d after');
  });
  it('swap lines are never uploaded: the buffers are untouched', () => {
    const b = agent._uploadBuffersForTest();
    const before = [b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length];
    say(30, "Corvale tells the guild, 'before'", 'Aldenmar');
    say(10, "Rethlan tells the raid, 'after'", 'Brackwyn');
    expect([b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length]).toEqual(before);
  });
});

// ── 7. chat.html: the search box, the history picker, the rows ────────────────────────────────────
describe('chat.html: search, history and rows', () => {
  const LINEHTML = sliceBlock(SCRIPT, 'function lineHtml(l, tag){', "+ (l.ch === 'zone' ? '|' + String(l.on || '').toLowerCase() : '');\n  }");
  const REPAINT = sliceBlock(SCRIPT, 'function histDividerHtml(shown){', 'paintEmpty();\n  }');
  const HHMM = sliceBlock(SCRIPT, 'function hhmm(t){', '}\n');
  const COPYLINE = sliceBlock(SCRIPT, 'function copyLineText(l){', '+ l.text;\n  }');
  const make = (st = {}) => evalBlock(`
    var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)};
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _prefs = { fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [], offChannels: [], only: '' }, _chanNames = {};
    var _only = ${JSON.stringify(st.only || [])}, _out = [], _isBrk = _only.length > 0, _brkOff = [];
    var _copiedN = 0, _find = '', _findQ = '', _histHours = ${st.hours || 0}, _histInfo = ${JSON.stringify(st.info || null)}, _histLines = [], _lines = [], _lastOn = null;
    var feedEl = { innerHTML: '' };
    function pinned(){ return false; } function toBottom(){} function paintEmpty(){}
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    ${HHMM}
    ${sliceBlock(SCRIPT, 'function groupOf(ch){', 'return out;\n  }')}
    ${sliceBlock(SCRIPT, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
    ${LINEHTML}
    ${REPAINT}
    ${COPYLINE}
    function setState(o){
      if (o.find !== undefined) { _find = o.find; _findQ = o.find.trim().toLowerCase(); }
      if (o.lines) _lines = o.lines; if (o.hist) _histLines = o.hist;
    }
  `, ['repaint', 'setState', 'feedEl', 'matchesFind', 'lineVisible', 'makeFilter', 'shownGroupIds', 'chatKey', 'copyLineText', 'lineHtml', 'rowHtml']);
  const T = new Date(2026, 9, 14, 14, 4, 34).getTime();
  const ln = (n, ch, who, text, on, extra = {}) => ({ n, t: T + n * 1000, ch, who, text, on, ...extra });
  const rows = (m) => (m.feedEl.innerHTML.match(/<div class="(?:ln|sep|hdiv)[^>]*>/g) || []).length;
  const ids = (m) => [...m.feedEl.innerHTML.matchAll(/data-n="(-?\d+)"/g)].map(x => Number(x[1]));

  describe('the filter matches the speaker OR the character it was heard on', () => {
    const m = make();
    const heard = ln(1, 'guild', 'Corvale', 'hi', 'Brackwyn');
    const said = ln(2, 'guild', 'Aldenmar', 'hi', 'Brackwyn');
    const mine = ln(3, 'say', 'You', 'hi', 'Aldenmar', { self: true });
    const zone = ln(4, 'zone', '', 'Plane of Knowledge', 'Brackwyn');
    it('the speaker', () => { expect(m.matchesFind(heard, 'corv')).toBe(true); expect(m.matchesFind(heard, 'rethlan')).toBe(false); });
    it('the character of yours it was heard on', () => { expect(m.matchesFind(heard, 'brack')).toBe(true); expect(m.matchesFind(said, 'brack')).toBe(true); });
    it('case does not matter and a name matches on its prefix only', () => {
      expect(m.matchesFind(heard, 'CoRvAle'.toLowerCase())).toBe(true);
      expect(m.matchesFind(heard, 'vale')).toBe(false);
      expect(m.matchesFind(heard, 'corvalex')).toBe(false);
    });
    it('your own line ("You") belongs to the character it was typed on, never to the word "You"', () => {
      expect(m.matchesFind(mine, 'alden')).toBe(true);
      expect(m.matchesFind(mine, 'you')).toBe(false);
    });
    it('a zone line belongs to the character whose log it came from', () => {
      expect(m.matchesFind(zone, 'brackwyn')).toBe(true);
      expect(m.matchesFind(zone, 'alden')).toBe(false);
    });
    // the guild lead, 2026-10-15: "when i search for someone in tells i should see conversation with them"
    it('a tell you sent matches the name it went to, so one search shows both sides of the conversation', () => {
      const sent = ln(5, 'tell', 'You', 'yeah', 'Aldenmar', { self: true, to: 'Corvale' });
      const got = ln(6, 'tell', 'Corvale', 'ah nice', 'Aldenmar');
      expect(m.matchesFind(sent, 'corv')).toBe(true);
      expect(m.matchesFind(got, 'corv')).toBe(true);
      expect(m.matchesFind(sent, 'rethlan')).toBe(false);
      // the recipient match is for tells only
      expect(m.matchesFind(ln(7, 'say', 'You', 'hi', 'Aldenmar', { self: true, to: 'Corvale' }), 'corv')).toBe(false);
    });
    it('an empty search matches everything; a swap line only shows with no search', () => {
      expect(m.matchesFind(heard, '')).toBe(true);
      const sep = { n: 9, sep: 1, from: 'A', to: 'B', text: 'Swapped to B' };
      expect(m.matchesFind(sep, 'b')).toBe(false);
      m.setState({ find: '' });
      expect(m.lineVisible(() => false, sep)).toBe(true);
      m.setState({ find: 'b' });
      expect(m.lineVisible(() => true, sep)).toBe(false);
    });
  });

  it('typing a name narrows the live feed, and clearing the box restores it', () => {
    const m = make();
    m.setState({ lines: [ln(1, 'guild', 'Corvale', 'a', 'Aldenmar'), ln(2, 'guild', 'Rethlan', 'b', 'Aldenmar'), ln(3, 'raid', 'Corvale', 'c', 'Brackwyn')] });
    m.repaint();
    expect(ids(m)).toEqual([1, 2, 3]);
    m.setState({ find: 'corv' }); m.repaint();
    expect(ids(m)).toEqual([1, 3]);
    m.setState({ find: 'Brackwyn' }); m.repaint();
    expect(ids(m)).toEqual([3]);
    m.setState({ find: '' }); m.repaint();
    expect(ids(m)).toEqual([1, 2, 3]);
    m.setState({ find: '   ' }); m.repaint();
    expect(ids(m)).toEqual([1, 2, 3]);
  });
  it('a breakout honours its group AND the search', () => {
    const m = make({ only: ['guild'] });
    m.setState({ lines: [ln(1, 'guild', 'Corvale', 'a', 'Aldenmar'), ln(2, 'raid', 'Corvale', 'b', 'Aldenmar'), ln(3, 'guild', 'Rethlan', 'c', 'Aldenmar')] });
    m.repaint();
    expect(ids(m)).toEqual([1, 3]);
    m.setState({ find: 'corv' }); m.repaint();
    expect(ids(m)).toEqual([1]);
  });
  it('history and live are painted together: history first, a divider, then live; the search applies to both', () => {
    const m = make({ hours: 6, info: { truncated: false } });
    m.setState({
      hist: [ln(-1, 'guild', 'Corvale', 'old1', 'Aldenmar'), ln(-2, 'guild', 'Rethlan', 'old2', 'Brackwyn')],
      lines: [ln(5, 'guild', 'Corvale', 'new1', 'Aldenmar'), ln(6, 'guild', 'Rethlan', 'new2', 'Aldenmar')],
    });
    m.repaint();
    expect(ids(m)).toEqual([-1, -2, 5, 6]);
    expect(m.feedEl.innerHTML.indexOf('hdiv')).toBeGreaterThan(m.feedEl.innerHTML.indexOf('data-n="-2"'));
    expect(m.feedEl.innerHTML.indexOf('hdiv')).toBeLessThan(m.feedEl.innerHTML.indexOf('data-n="5"'));
    expect(m.feedEl.innerHTML).toContain('history from the last 6 h');
    m.setState({ find: 'corv' }); m.repaint();
    expect(ids(m)).toEqual([-1, 5]);
    m.setState({ find: 'brack' }); m.repaint();
    expect(ids(m)).toEqual([-2]);
  });
  it('history is hidden by a breakout\'s group filter too', () => {
    const m = make({ hours: 6, only: ['raid'], info: {} });
    m.setState({ hist: [ln(-1, 'guild', 'Corvale', 'g', 'Aldenmar'), ln(-2, 'raid', 'Corvale', 'r', 'Aldenmar')], lines: [] });
    m.repaint();
    expect(ids(m)).toEqual([-2]);
  });
  it('a history line the live feed already holds is shown once (the same key the agent dedups with)', () => {
    const m = make({ hours: 6, info: {} });
    const live = ln(5, 'guild', 'Corvale', 'same', 'Aldenmar');
    const hist = { ...live, n: -1 };
    m.setState({ hist: [hist, ln(-2, 'guild', 'Corvale', 'only in history', 'Aldenmar', { t: T - 99_000 })], lines: [live] });
    m.repaint();
    expect(ids(m)).toEqual([-2, 5]);
  });
  it('the client key equals the agent key for the same line, zone lines included', () => {
    const m = make();
    for (const raw of [at(3, "Corvale tells the guild, 'hi'"), at(3, 'You told Corvale, \'sure\''), at(3, 'You have entered Plane of Knowledge.')]) {
      const evt = agent.classifyChatLine(raw, 'Aldenmar');
      const l = { ...evt, on: 'Aldenmar' };
      expect(m.chatKey(l), raw).toBe(agent.chatLineKey(evt, 'Aldenmar'));
    }
  });
  it('an empty history says so; a failed one says it is not available; a loading one says loading', () => {
    const m = make({ hours: 3, info: { truncated: false } });
    m.repaint();
    expect(m.feedEl.innerHTML).toContain('no chat in the last 3 h');
    expect(make({ hours: 3, info: { failed: true } }).feedEl.innerHTML).toBe('');
    const f = make({ hours: 3, info: { failed: true } }); f.repaint();
    expect(f.feedEl.innerHTML).toContain('history is not available');
    const l = make({ hours: 3, info: { loading: true } }); l.repaint();
    expect(l.feedEl.innerHTML).toContain('loading the last 3 h');
  });
  it('a swap row is a rule with the text, no timestamp button, nothing to copy', () => {
    const m = make();
    const html = m.lineHtml({ n: 9, t: T, sep: 1, from: 'Aldenmar', to: 'Brackwyn', text: "Swapped to Brackwyn — 14m after Aldenmar's last line" });
    expect(html).toContain('class="sep"');
    expect(html).not.toContain('class="tm');
    expect(html).not.toContain('<button');
    expect(html).toContain('Swapped to Brackwyn');
  });
  // the guild lead, 2026-10-15: "know which character i sent it from"
  it('a tell names your character both ways, on the row and in the copied line; no character falls back to "You"', () => {
    const m = make();
    const sent = ln(1, 'tell', 'You', 'yeah', 'Aldenmar', { self: true, to: 'Corvale', t: new Date(2026, 9, 14, 22, 37, 0).getTime() });
    const got = ln(2, 'tell', 'Corvale', 'ah nice', 'Aldenmar', { t: new Date(2026, 9, 14, 22, 38, 0).getTime() });
    const old = ln(3, 'tell', 'You', 'hi', '', { self: true, to: 'Corvale', t: new Date(2026, 9, 14, 22, 39, 0).getTime() });
    expect(m.lineHtml(sent)).toMatch(/<span class="who you"[^>]*>Aldenmar<\/span><span class="arrow">→<\/span><span class="who name">Corvale<\/span>/);
    expect(m.lineHtml(got)).toMatch(/<span class="who name">Corvale<\/span><span class="arrow">→<\/span><span class="who you"[^>]*>Aldenmar<\/span>/);
    expect(m.lineHtml(old)).toContain('<span class="who you">You</span>');
    expect(m.copyLineText(sent)).toBe('[22:37] Aldenmar → Corvale: yeah');
    expect(m.copyLineText(got)).toBe('[22:38] Corvale → Aldenmar: ah nice');
    // the name is on the line, so the "heard on" tag never doubles it
    expect(m.lineHtml(got, true)).not.toContain('class="otag"');
    expect(m.lineHtml(ln(4, 'guild', 'Corvale', 'hi', 'Aldenmar'), true)).toContain('class="otag"');
  });
  it('a zone row is a dim line "→ Zone" with no speaker, and a timestamp click copies the plain log line', () => {
    const m = make();
    const z = ln(3, 'zone', '', 'Plane of Knowledge', 'Aldenmar', { t: new Date(2026, 9, 14, 14, 4, 34).getTime() });
    const html = m.lineHtml(z);
    expect(html).toContain('class="ln zone"');
    expect(html).toContain('→ Plane of Knowledge');
    expect(html).not.toContain('class="who');
    expect(m.copyLineText(z)).toBe('[14:04] You have entered Plane of Knowledge.');
  });
  it('the "heard on" tag appears only where the character changes with no swap line, never on every line', () => {
    const m = make();
    m.setState({ lines: [
      ln(1, 'guild', 'Corvale', 'a', 'Aldenmar'), ln(2, 'guild', 'Corvale', 'b', 'Aldenmar'),
      ln(3, 'guild', 'Rethlan', 'c', 'Brackwyn'), ln(4, 'guild', 'Rethlan', 'd', 'Brackwyn'),
      { n: 5, t: T, sep: 1, from: 'Brackwyn', to: 'Aldenmar', text: 'Swapped to Aldenmar' }, ln(6, 'guild', 'Corvale', 'e', 'Aldenmar'),
    ] });
    m.repaint();
    const tagged = [...m.feedEl.innerHTML.matchAll(/data-n="(\d+)"[^>]*><button[^>]*>[^<]*<\/button>(?:<span class="ctag"[^>]*>[^<]*<\/span>)?<span class="otag"/g)].map(x => Number(x[1]));
    expect(tagged).toEqual([3]);     // line 1 starts the feed, 3 changes character, 6 follows a swap line
  });
  it('searching one speaker tags the alt that heard each line', () => {
    const m = make();
    m.setState({ find: 'corvale', lines: [ln(1, 'guild', 'Corvale', 'a', 'Aldenmar'), ln(2, 'guild', 'Rethlan', 'x', 'Aldenmar'), ln(3, 'guild', 'Corvale', 'c', 'Brackwyn')] });
    m.repaint();
    expect(ids(m)).toEqual([1, 3]);
    expect(m.feedEl.innerHTML).toContain('class="otag" title="heard on Brackwyn"');
    expect(rows(m)).toBe(2);
  });

  describe('wiring', () => {
    const code = stripJs(SCRIPT);
    it('a search <input> in the title bar, and a ▾ picker of your own characters', () => {
      expect(CHAT_HTML).toMatch(/<div class="title">[^\n]*<input id="find" type="text"[^>]*maxlength="24"/);
      expect(CHAT_HTML).toContain('id="fpick"');
      expect(CHAT_HTML).toContain('<div id="cpick"></div>');
    });
    it('the box lets go of the keyboard: Enter and Esc blur it, Esc clears it, and it lets go after a quiet spell', () => {
      expect(code).toMatch(/e\.key === 'Enter'\) \{ releaseFind\(\)/);
      expect(code).toMatch(/e\.key === 'Escape'\) \{ setFind\(''\); releaseFind\(\)/);
      expect(code).toMatch(/_findIdle = setTimeout\(releaseFind, 8000\)/);
      expect(code).toContain('findEl.blur()');
      expect(code).not.toMatch(/findEl\.focus\(\)/);
      expect(CHAT_HTML).not.toMatch(/\bautofocus\b/);
    });
    it('the search is this window\'s own and is never saved', () => {
      const search = code.slice(code.indexOf('function setFind(v){'), code.indexOf('var HIST_CHOICES'));
      expect(search).not.toMatch(/localStorage|sessionStorage|setChatPrefs|savePrefs/);
    });
    it('the picker lists characters seen in the feed or in history', () => {
      expect(code).toContain('add(_histLines); add(_lines);');
    });
    it('the hover handshake covers the picker row, and the title bar already carries the box', () => {
      expect(code).toContain("'.title, #chips, #cpick, #spanel, #onlypill, #feed, #newchip, #ctxmenu'");
    });
    it('the History picker offers off, 1, 2, 3, 6, 12 and 24 hours and starts OFF', () => {
      expect(code).toContain('var HIST_CHOICES = [0, 1, 2, 3, 6, 12, 24];');
      expect(code).toMatch(/var _histHours = 0;/);
      expect(CHAT_HTML).toContain('id="histbtn"');
      expect(code).toContain("'Last ' + h + (h === 1 ? ' hour' : ' hours') : 'History off'");
    });
    it('nothing is read from disk until a window is picked: no history request with hours at 0', () => {
      expect(code).toMatch(/if \(!_histHours\) \{ _histLines = \[\]; _histInfo = null; _histSig = ''; repaint\(\); return; \}/);
      expect(code).toContain("'/api/chat/history?' + _histSig");
    });
    it('the history request carries the same switches as the live poll, and a change in them re-reads it', () => {
      expect(code).toContain("'hours=' + _histHours + '&tells=' + (_prefs.tells ? 1 : 0) + '&group=' + (_prefs.group ? 1 : 0) +");
      expect(code).toMatch(/if \(_histHours && _connectedOnce && histQuery\(\) !== _histSig\) loadHistory\(\);/);
    });
    it('the pick is remembered per window in storage that may be missing, and a remembered pick loads on the first good poll', () => {
      expect(code).toMatch(/try \{ var _hv = Number\(localStorage\.getItem\(histKey\(\)\)\)/);
      expect(code).toMatch(/try \{ localStorage\.setItem\(histKey\(\), String\(_histHours\)\); \} catch \(e\) \{\}/);
      expect(code).toMatch(/if \(!_connectedOnce\) \{ _connectedOnce = true; if \(_histHours\) loadHistory\(\); \}/);
      expect(code).toContain("'wpChatHistH:' + winId()");   // per window id (b1...), so it survives groups moving in and out
    });
    it('a newer pick wins over a slower earlier one', () => {
      expect(code).toContain('var mine = ++_histSeq;');
      expect(code).toContain('if (mine !== _histSeq) return;');
    });
    it('the settings text says history is read on this PC and never sent', () => {
      expect(CHAT_HTML).toContain('read here and never sent');
    });
    it('a Zones chip needs no code of its own: the chips come from the agent\'s group list', () => {
      const chips = stripJs(sliceBlock(SCRIPT, 'function paintChips(){', '\n  }'));
      expect(chips).not.toMatch(/zone/);
      expect(chips).toContain('for (var i = 0; i < _groups.length; i++)');
    });
  });
});

// Mutation checks run when this file was written (2026-10-14). Each edit below was made, the named tests went
// red, and it was reverted:
//   • chatReadLogBackwards: dropped the carry (`carry = data.subarray(0, nl)` → empty)  → the chunk-boundary tests
//   • dropped the "oldest < cutoffMs → break"                                          → "stops at the window" and "no recent lines"
//   • fs.promises.open(file, 'r') → 'r+'                                               → "opened read-only"
//   • dropped the `!chatChannelAllowed` gate from buildChatHistory                      → the gates + Seer tests
//   • dropped the isExcluded check in chatHistoryFiles                                  → "excluded from stats"
//   • dropped the chatSwapBetween call in buildChatHistory                              → the merge tests
//   • CHAT_SWAP_MIN_MS 30_000 → 1_000                                                   → the threshold test; "dual boxing" stayed green until
//     its second line was moved 10 s off the first (it used the same second, which no threshold can tell apart)
//   • removed _localOriginOk from _handleLocalChatHistory (and moved below the parse)    → the 403 test / the order test
//   • matchesFind: dropped the `l.on` clause; dropped the speaker clause; dropped `!l.self`; `=== 0` → `>= 0`  → each caught
//   • removed the zone early return in copyLineText                                     → the zone-row test
//   • removed the live-key dedup from repaint; dropped the zone suffix from the key      → each caught
//   • removed the swap push in noteLocalChatLine; removed `_lastOn = l.to` on a swap row → each caught
//   • dropped the (?!an?\s) lookahead from the zone pattern; gated the Zones group      → each caught
//   • HIST_CHOICES 24 → 48; _histHours default 0 → 1; Enter no longer releases the box   → each caught
//   • removed the seen.has dedup across characters; removed the final newest-3000 trim   → each caught (the trim only after the
//     two-character cap test was added: a single file is already capped per file)
// Equivalent, not caught: `l.ch !== 'zone'` in matchesFind (a zone line's speaker is "" and never starts a name).
// Not mutation-checked: the 8 s idle release (asserted by text only), and the byte cap's exact figure.
