// test/guild-chat-feed.test.js — the in-memory guild/raid chat ring behind Mimic's out-of-game Chat overlay.
//
// The ring (utils/guildChatFeed.js) is pure and run for real. The route, the shed kind, the budget and the
// ingest hook live in the index.js monolith, so those are source-wiring asserts over comment-stripped source
// plus the real _isShedded gate evaluated from the sliced block.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const feed = require_('../utils/guildChatFeed.js');

const T0 = Date.parse('2026-10-15T20:00:00Z');
const line = (o = {}) => ({ t: T0, ch: 'guild', who: 'Aldenmar', text: 'pulling in two', ...o });

beforeEach(() => feed._resetForTest());

describe('note() allow-list', () => {
  it('stores guild and raid lines with an increasing seq', () => {
    const a = feed.note(line());
    const b = feed.note(line({ ch: 'raid', who: 'Brackwyn', text: 'assist me', t: T0 + 5000 }));
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(feed.since(0).lines.map(l => l.ch)).toEqual(['guild', 'raid']);
  });

  it.each(['officer', 'tell', 'group', 'say', 'ooc', 'auction', 'gu', 'rs', 'Guild', '', undefined, null])(
    'drops channel %j', (ch) => {
      expect(feed.note(line({ ch }))).toBeNull();
      expect(feed.since(0).lines).toEqual([]);
      expect(feed.since(0).seq).toBe(0);
    });

  it('drops a line with no speaker or no text', () => {
    expect(feed.note(line({ who: '' }))).toBeNull();
    expect(feed.note(line({ text: '   ' }))).toBeNull();
    expect(feed.note(null)).toBeNull();
    expect(feed.note('guild')).toBeNull();
  });

  it('serves exactly { seq, t, ch, who, text } and nothing else', () => {
    feed.note(line());
    expect(Object.keys(feed.since(0).lines[0]).sort()).toEqual(['ch', 'seq', 't', 'text', 'who']);
    expect(JSON.parse(JSON.stringify(feed.since(0).lines[0]))).toEqual({ seq: 1, t: T0, ch: 'guild', who: 'Aldenmar', text: 'pulling in two' });
  });
});

describe('ring cap', () => {
  it('keeps the newest 300 lines and drops the oldest', () => {
    for (let i = 0; i < 350; i++) feed.note(line({ text: `line number ${i}`, t: T0 + i * 10_000 }));
    const all = feed.since(0, 200);
    expect(feed.since(0).seq).toBe(350);
    const tail = feed.since(150, 200).lines;           // seq 151..350
    expect(tail).toHaveLength(200);
    expect(tail[0].seq).toBe(151);
    // seq 1..50 fell off the front: the oldest line still held is seq 51.
    expect(feed.since(0, 200).lines[0].seq).toBe(51);
    expect(all.lines).toHaveLength(200);
    expect(feed.RING_MAX).toBe(300);
  });
});

describe('dedupe across uploaders', () => {
  it('the same (ch, who, text) within 2 s is stored once', () => {
    expect(feed.note(line())).not.toBeNull();
    expect(feed.note(line({ t: T0 + 1500 }))).toBeNull();
    expect(feed.note(line({ t: T0 - 2000 }))).toBeNull();
    expect(feed.since(0).lines).toHaveLength(1);
  });

  it('copies that differ only in case, spacing or punctuation are one line', () => {
    feed.note(line({ text: 'ok, camp at 5-7 k' }));
    expect(feed.note(line({ text: 'Ok camp at 5 7 k', t: T0 + 400 }))).toBeNull();
    expect(feed.since(0).lines).toHaveLength(1);
  });

  it('the same line more than 2 s later is a new utterance', () => {
    feed.note(line({ text: '111' }));
    expect(feed.note(line({ text: '111', t: T0 + 2001 }))).not.toBeNull();
    expect(feed.since(0).lines).toHaveLength(2);
  });

  it('a different speaker, text or channel is not a duplicate', () => {
    feed.note(line());
    expect(feed.note(line({ who: 'Corvale' }))).not.toBeNull();
    expect(feed.note(line({ text: 'pulling in three' }))).not.toBeNull();
    expect(feed.note(line({ ch: 'raid' }))).not.toBeNull();
    expect(feed.since(0).lines).toHaveLength(4);
  });
});

describe('since() / limit / boot', () => {
  beforeEach(() => { for (let i = 1; i <= 5; i++) feed.note(line({ text: `msg ${i}`, t: T0 + i * 5000 })); });

  it('returns lines after the cursor, oldest first, with the latest seq', () => {
    const r = feed.since(2);
    expect(r.seq).toBe(5);
    expect(r.lines.map(l => l.seq)).toEqual([3, 4, 5]);
  });

  it('a cursor at the head returns nothing but still reports the head seq', () => {
    const r = feed.since(5);
    expect(r.lines).toEqual([]);
    expect(r.seq).toBe(5);
  });

  it('limit caps the page (oldest first) and is itself capped at 200', () => {
    expect(feed.since(0, 2).lines.map(l => l.seq)).toEqual([1, 2]);
    feed._resetForTest();
    for (let i = 0; i < 250; i++) feed.note(line({ text: `n${i}`, t: T0 + i * 10_000 }));
    expect(feed.since(0, 9999).lines).toHaveLength(200);
    expect(feed.since(0).lines).toHaveLength(200);
  });

  it('garbage cursors and limits fall back to defaults', () => {
    expect(feed.since('x', 'y').lines).toHaveLength(5);
    expect(feed.since(-4, 0).lines).toHaveLength(5);
    expect(feed.since(undefined).lines).toHaveLength(5);
  });

  it('boot is a stable per-process id, changed only by the test reset', () => {
    const b = feed.since(0).boot;
    expect(b).toMatch(/^[0-9a-f]{12}$/);
    expect(feed.since(3).boot).toBe(b);
    expect(feed.currentBoot()).toBe(b);
    feed._resetForTest();
    expect(feed.currentBoot()).not.toBe(b);
  });
});

describe('preload()', () => {
  it('maps chat_messages rows (channel guild / raid) oldest first and skips anything else', () => {
    const n = feed.preload([
      { ts: '2026-10-15T19:30:10+00:00', channel: 'raid',    speaker: 'Brackwyn', text: 'second' },
      { ts: '2026-10-15T19:30:00+00:00', channel: 'guild',   speaker: 'Aldenmar', text: 'first' },
      { ts: '2026-10-15T19:30:20+00:00', channel: 'officer', speaker: 'Corvale',  text: 'never' },
      { ts: 'not a date',                channel: 'guild',   speaker: 'Rethlan',  text: 'bad ts' },
      null,
    ]);
    expect(n).toBe(2);
    const lines = feed.since(0).lines;
    expect(lines.map(l => [l.seq, l.ch, l.who, l.text])).toEqual([[1, 'guild', 'Aldenmar', 'first'], [2, 'raid', 'Brackwyn', 'second']]);
    expect(lines[0].t).toBe(Date.parse('2026-10-15T19:30:00Z'));
  });

  it('dedupes against lines already live, and tolerates a non-array', () => {
    feed.note(line());
    expect(feed.preload([{ ts: new Date(T0 + 500).toISOString(), channel: 'guild', speaker: 'Aldenmar', text: 'pulling in two' }])).toBe(0);
    expect(feed.preload(undefined)).toBe(0);
    expect(feed.since(0).lines).toHaveLength(1);
  });
});

describe('countInGame() — players in game, from the heartbeat registry', () => {
  const NOW = 1_000_000_000;
  const hb = (o = {}) => ({ last_seen: NOW - 5_000, last_line_ms: 10_000, camping: false, ...o });

  it('counts a fresh heartbeat with a recent log line', () => {
    expect(feed.countInGame([['100', hb()]], NOW)).toBe(1);
  });

  it('counts PLAYERS, not characters: one Discord id is one player however many characters it carries', () => {
    const e = hb({ primary: 'Aldenmar', live_character: 'Brackwyn' });
    expect(feed.countInGame([['100', e], ['200', hb()], ['300', hb()]], NOW)).toBe(3);
    // the same player's id twice (two machines) still counts once
    expect(feed.countInGame([['100', e], ['100', hb({ live_character: 'Corvale' })]], NOW)).toBe(1);
  });

  it('a stale heartbeat expires (older than the registry TTL)', () => {
    expect(feed.countInGame([['100', hb({ last_seen: NOW - 61_000 })]], NOW)).toBe(0);
    expect(feed.countInGame([['100', hb({ last_seen: NOW - 59_000 })]], NOW)).toBe(1);
  });

  it('a quiet log expires: the line age is projected forward from the heartbeat, under 3 minutes', () => {
    expect(feed.countInGame([['100', hb({ last_line_ms: 200_000 })]], NOW)).toBe(0);
    expect(feed.countInGame([['100', hb({ last_line_ms: 170_000, last_seen: NOW - 20_000 })]], NOW)).toBe(0);   // 190 s now
    expect(feed.countInGame([['100', hb({ last_line_ms: 150_000, last_seen: NOW - 20_000 })]], NOW)).toBe(1);   // 170 s now
  });

  it('does not count a camping player, or one whose log age is unknown or invalid', () => {
    expect(feed.countInGame([['1', hb({ camping: true })], ['2', hb({ last_line_ms: null })], ['3', hb({ last_line_ms: undefined })], ['4', hb({ last_line_ms: -1 })]], NOW)).toBe(0);
  });

  it('tolerates junk input', () => {
    expect(feed.countInGame(undefined, NOW)).toBe(0);
    expect(feed.countInGame([null, ['1'], ['2', null], 'x'], NOW)).toBe(0);
    expect(feed.countInGame(new Map([['1', hb()], ['2', hb({ last_seen: 0 })]]).entries(), NOW)).toBe(1);
  });
});

describe('index.js wiring', () => {
  const SRC = readSource(BOT_INDEX);
  const code = stripJs(SRC);

  it('GET /api/agent/guild-chat exists and its handler is bearer-gated (requireAgentAuth first)', () => {
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/guild-chat'/);
    const handler = sliceBlock(code, 'async function _handleAgentGuildChatGet(req, res) {', '\n}\n');
    expect(handler.indexOf('requireAgentAuth(req, res)')).toBeGreaterThan(0);
    expect(handler.indexOf('requireAgentAuth(req, res)')).toBeLessThan(handler.indexOf('feed.since('));
    expect(handler).toMatch(/'Cache-Control': 'no-store'/);
    expect(handler).toMatch(/q\.get\('boot'\) === feed\.currentBoot\(\)/);
  });

  it('the response carries ingame from the reporter registry, cached 15 s, null before the bot can know', () => {
    const handler = sliceBlock(code, 'async function _handleAgentGuildChatGet(req, res) {', '\n}\n');
    expect(handler).toMatch(/ingame: _guildChatInGame\(\)/);
    const fn = sliceBlock(code, 'function _guildChatInGame() {', '\n}\n');
    expect(fn).toMatch(/_reporterRegistry\.get\(/);
    expect(fn).toMatch(/countInGame\(/);
    expect(fn).toMatch(/< 15_000/);
    expect(fn).toMatch(/process\.uptime\(\) < 90/);
  });

  it('the route sheds first, then budgets, then runs the handler', () => {
    const route = sliceBlock(code, "=== '/api/agent/guild-chat'", '_handleAgentGuildChatGet(req, res)');
    const shed = route.indexOf("_isShedded('guild_chat'");
    const bud = route.indexOf("_overBudget('guild_chat', req, res)");
    expect(shed).toBeGreaterThan(0);
    expect(bud).toBeGreaterThan(shed);
  });

  it('guild_chat is sheddable, never in _SHED_NEVER, and the shed ack carries { ok, boot, seq, lines: [] }', async () => {
    const gate = sliceBlock(SRC, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');
    // eslint-disable-next-line no-new-func
    const { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune } = new Function(`
      let __t = {};
      function setTune(t) { __t = t; }
      async function _overlayTuningMap() { return __t; }
      ${gate}
      return { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune };`)();
    expect(_SHED_KINDS.has('guild_chat')).toBe(true);
    expect(_SHED_NEVER.has('guild_chat')).toBe(false);
    const res = { writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    setTune({});
    expect(await _isShedded('guild_chat', res, { ok: true, boot: 'b', seq: 7, lines: [] })).toBe(false);
    setTune({ flag_shed_guild_chat: 1 });
    expect(await _isShedded('guild_chat', res, { ok: true, boot: 'b', seq: 7, lines: [] })).toBe(true);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, boot: 'b', seq: 7, lines: [] });
    // An existing POST kind still gets the original ack when no body is passed.
    const res2 = { writeHead() {}, end(b) { this.body = b; } };
    setTune({ flag_shed_kite_loop: 1 });
    await _isShedded('kite_loop', res2);
    expect(JSON.parse(res2.body)).toEqual({ ok: true, shed: 'kite_loop' });
  });

  it('guild_chat is a 120/min ephemeral GET budget kind', () => {
    const budgets = sliceBlock(code, 'const _BUDGET_DEFAULTS = {', '\n};');
    // eslint-disable-next-line no-new-func
    const defaults = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();
    expect(defaults.guild_chat).toEqual({ perMin: 120, durable: false, get: true });
  });

  it('the chat ingest feeds the ring after its dedup, inside a try/catch, and the preload runs at startup', () => {
    const handler = sliceBlock(code, 'async function _handleAgentChat(req, res) {', "const { getWhoEntry } = require('./utils/state');");
    const dedup = handler.indexOf('if (isVariant) continue;');
    const hook = handler.indexOf("require('./utils/guildChatFeed').note(");
    expect(dedup).toBeGreaterThan(0);
    expect(hook).toBeGreaterThan(dedup);
    expect(handler.slice(hook - 40, hook)).toMatch(/try \{\s*$/);
    expect(code).toMatch(/_preloadGuildChatFeed\(\)\.catch\(/);
    const pre = sliceBlock(code, 'async function _preloadGuildChatFeed() {', '\n}\n');
    expect(pre).toMatch(/channel=in\.\(guild,raid\)/);
    expect(pre).toMatch(/select=ts,channel,speaker,text/);
    expect(pre).toMatch(/limit=300/);
  });
});
