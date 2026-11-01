// test/chat-guild-feed.test.js: the Chat overlay's guild feed while the player is out of game (the guild lead,
// 2026-10-15, options A + X). The agent polls the bot's GET /api/agent/guild-chat only while the overlay asks, the
// game is not running and the usual gates allow it; the lines are shown by the overlay and nowhere else.
//
// The load-bearing promises: (1) NO bot call unless every gate is open, (2) the lines are display only and never reach
// an upload, history, trigger, tell or parse path, (3) the game starting clears them so local lines take over.
// Each negative assertion was mutation-checked (see the notes at the bottom).
//
// Run: npx vitest run test/chat-guild-feed.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const AGENT_SRC = readSource(AGENT_INDEX);
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const CHAT_HTML = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chat.html'), 'utf8');
const SCRIPT = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));

const block = (a, b) => AGENT_SRC.slice(AGENT_SRC.indexOf(a), AGENT_SRC.indexOf(b) + b.length);
const CHAT_BLOCK = block('// ── Local chat window: the feed behind Mimic\'s Chat overlay', '// ── end Local chat window ──');
const HISTORY_BLOCK = block('// ── Chat history: the last N hours of chat', '// ── end Chat history ──');
const FEED_BLOCK = block('// ── Guild feed while you are out of game', '// ── end Guild feed ──');

const T0 = 1_800_000_000_000;
const BASE = 'https://bot.example/api/agent';
const ME = 'Aldenmar';
const TS = '[Wed Oct 14 21:10:01 2026]';

// A stand-in fetch: answers from a queue, remembers every call.
function mockFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    return { status: a.status || 200, ok: (a.status || 200) < 400, json: async () => a.body };
  };
  fn.calls = calls;
  return fn;
}
const ok = (body) => ({ status: 200, body: { ok: true, boot: 'b1', seq: 0, lines: [], ...body } });
const L = (seq, ch, who, text, t = T0) => ({ seq, t, ch, who, text });
// A Zeal entry for a character who is logged in: fresh, with a zone and a position (the player payload carries both).
const WORLD = (updatedAt) => ({ updatedAt, zone: 164, loc: { x: 10, y: 20, z: 0 } });

let envBefore;
beforeEach(() => {
  envBefore = { url: process.env.WOLFPACK_BOT_URL, tok: process.env.WOLFPACK_AGENT_TOKEN };
  process.env.WOLFPACK_BOT_URL = BASE + '/encounter';
  process.env.WOLFPACK_AGENT_TOKEN = 'tok-1';
  agent._setUploadOptsForTest({ botUrl: BASE + '/encounter', token: 'tok-1' });
  agent._resetLocalChatForTest();
  agent._guildFeedResetForTest();
  agent._setZealStateForTest(ME, null);
  agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  agent.setChatPolicy({ away: true }, T0);
});
afterEach(() => {
  for (const [k, v] of [['WOLFPACK_BOT_URL', envBefore.url], ['WOLFPACK_AGENT_TOKEN', envBefore.tok]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  agent._setUploadOptsForTest(null);
  agent._setZealStateForTest(ME, null);
  agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  agent._resetLocalChatForTest();
  agent._guildFeedResetForTest();
});

// ── 1. Poll gating ──────────────────────────────────────────────────────────────────────────────
describe('poll gating: no bot call unless every gate is open', () => {
  it('all gates open: one authenticated GET to <base>/guild-chat with the cursor and boot', async () => {
    const f = mockFetch(ok({}));
    expect(await agent._pollGuildFeed(T0, f)).toBe('ok');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(BASE + '/guild-chat?since=0&boot=');
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer tok-1');
    expect(f.calls[0].init.method).toBeUndefined();   // a GET
    expect(f.calls[0].init.body).toBeUndefined();
  });
  const CLOSED = [
    ['the game is running (Zeal pushed state a moment ago)', 'in-game', () => agent._setZealStateForTest(ME, WORLD(T0 - 5_000))],
    ['`away` is off in the overlay', 'quiet', () => agent.setChatPolicy({ away: false, group: true }, T0)],
    ['the overlay went quiet (switches lapsed)', 'quiet', () => agent.setChatPolicy({ away: true }, T0 - agent.CHAT_POLICY_TTL_MS - 1)],
    ['the overlay never asked', 'quiet', () => agent._resetLocalChatForTest()],
    ['no token (not linked)', 'no-token', () => { delete process.env.WOLFPACK_AGENT_TOKEN; agent._setUploadOptsForTest(null); }],
    ['local mode (no token on the run)', 'local', () => agent._setUploadOptsForTest({ botUrl: BASE + '/encounter', token: '' })],
    ['a dry run', 'dry-run', () => agent._setUploadOptsForTest({ botUrl: BASE + '/encounter', token: 'tok-1', dryRun: true })],
    ['the fleet is dormant (flag_agent_kill)', 'dormant', () => agent._applyControlPlane({ agent_kill: 1 }, 'test')],
    ['this agent is below the version floor', 'dormant', () => agent._applyControlPlane({ min_agent_ver_num: 999999 }, 'test')],
  ];
  for (const [label, want, close] of CLOSED) {
    it(`no call when ${label}`, async () => {
      close();
      const f = mockFetch(ok({}));
      expect(await agent._pollGuildFeed(T0, f)).toBe(want);
      expect(f.calls).toHaveLength(0);
    });
  }
  it('closing a gate after a good poll stops the next one', async () => {
    const f = mockFetch(ok({}));
    await agent._pollGuildFeed(T0, f);
    agent.setChatPolicy({ away: false }, T0 + 5_000);
    expect(await agent._pollGuildFeed(T0 + 5_000, f)).toBe('quiet');
    expect(f.calls).toHaveLength(1);
  });
});

describe('"in game" = logged in on a character: the agent\'s own signals, no new process scan', () => {
  const NOW = T0;
  const CAMP = `${TS} It will take you about 30 seconds to prepare your camp.`;
  const ABANDON = `${TS} You abandon your preparations to camp.`;
  const WELCOME = `${TS} Welcome to EverQuest!`;
  it('a Zeal client in the world that pushed state within the last minute means in game; older does not', () => {
    expect(agent._eqInGameFrom({ [ME]: WORLD(NOW - 59_000) }, [], NOW)).toBe(true);
    expect(agent._eqInGameFrom({ [ME]: WORLD(NOW - 61_000) }, [], NOW)).toBe(false);
  });
  it('a watched log with a line in the last 90 s means in game (no Zeal, or a standing still player); older does not', () => {
    expect(agent._eqInGameFrom({}, [{ logPath: 'a', lastSeen: NOW - 89_000 }], NOW)).toBe(true);
    expect(agent._eqInGameFrom({}, [{ logPath: 'a', lastSeen: NOW - 91_000 }], NOW)).toBe(false);
  });
  it('nothing at all means out of game; either signal alone is enough', () => {
    expect(agent._eqInGameFrom({}, [], NOW)).toBe(false);
    expect(agent._eqInGameFrom(null, null, NOW)).toBe(false);
    expect(agent._eqInGameFrom({ x: {} }, [{ logPath: 'a' }], NOW)).toBe(false);   // a state with no stamp, a log never read
    expect(agent._eqInGameFrom({ [ME]: WORLD(NOW - 1_000) }, [{ logPath: 'a', lastSeen: NOW - 999_999 }], NOW)).toBe(true);
  });

  describe('character select: the client is running, nobody is logged in', () => {
    it('a fresh Zeal entry with no zone and no position is not a login, so the feed runs', async () => {
      for (const st of [{ updatedAt: NOW - 1_000 }, { updatedAt: NOW - 1_000, zone: 0 }, { updatedAt: NOW - 1_000, zone: null, loc: null },
        { updatedAt: NOW - 1_000, loc: { x: 0, y: 0, z: 0 } }, { updatedAt: NOW - 1_000, loc: { x: 'a', y: null } }]) {
        expect(agent._eqInGameFrom({ [ME]: st }, [], NOW), JSON.stringify(st)).toBe(false);
      }
      agent._setZealStateForTest(ME, { updatedAt: T0 - 1_000 });
      const f = mockFetch(ok({}));
      expect(await agent._pollGuildFeed(T0, f)).toBe('ok');
      expect(f.calls).toHaveLength(1);
    });
    it('a position alone (no zone id) is enough to look in-world', () => {
      expect(agent._eqInGameFrom({ [ME]: { updatedAt: NOW - 1_000, loc: { x: 5, y: -7, z: 1 } } }, [], NOW)).toBe(true);
    });
    it('and in the world the feed stops', async () => {
      const f = mockFetch(ok({}));
      agent._setZealStateForTest(ME, WORLD(T0 - 1_000));
      expect(await agent._pollGuildFeed(T0, f)).toBe('in-game');
      expect(f.calls).toHaveLength(0);
    });
  });

  describe('a camp ends "in game" at once, without waiting out the 90 s log window', () => {
    const rec = () => ({ character: ME, logPath: 'a', lastSeen: NOW - 2_000 });
    it('the camp announcement marks the log; its own lines do not count as play', () => {
      const w = rec();
      expect(agent._eqInGameFrom({}, [w], NOW)).toBe(true);                    // playing: a line two seconds ago
      agent._guildFeedNoteCampLine(w, CAMP, NOW);
      expect(w.campAt).toBe(NOW);
      expect(agent._eqInGameFrom({}, [w], NOW)).toBe(false);                   // camping: the same recent line no longer counts
      w.lastSeen = NOW + 20_000;                                               // a tail line a moment later
      expect(agent._eqInGameFrom({}, [w], NOW + 20_000)).toBe(false);
    });
    it('the camped character\'s lingering Zeal entry (up to a minute) does not count either, but another character\'s does', () => {
      const w = rec();
      agent._guildFeedNoteCampLine(w, CAMP, NOW);
      const zeal = { [ME]: WORLD(NOW - 3_000) };
      expect(agent._eqInGameFrom(zeal, [w], NOW)).toBe(false);
      expect(agent._eqInGameFrom({ ...zeal, Corvale: WORLD(NOW - 3_000) }, [w], NOW)).toBe(true);
      expect(agent._eqInGameFrom({ [ME.toUpperCase()]: WORLD(NOW - 3_000) }, [w], NOW)).toBe(false);   // names compare without case
    });
    it('another character\'s log still counts while this one is camped', () => {
      const w = rec();
      agent._guildFeedNoteCampLine(w, CAMP, NOW);
      expect(agent._eqInGameFrom({}, [w, { character: 'Corvale', logPath: 'b', lastSeen: NOW - 1_000 }], NOW)).toBe(true);
    });
    it('cancelling the camp, or logging back in, puts the log back in the game', () => {
      for (const line of [ABANDON, WELCOME]) {
        const w = rec();
        agent._guildFeedNoteCampLine(w, CAMP, NOW);
        agent._guildFeedNoteCampLine(w, line, NOW + 5_000);
        expect(w.campAt, line).toBe(0);
        w.lastSeen = NOW + 5_000;
        expect(agent._eqInGameFrom({}, [w], NOW + 5_000), line).toBe(true);
      }
    });
    it('a line well past the camp\'s own tail is a new session (a camp cancelled without a word), not the tail', () => {
      const w = rec();
      agent._guildFeedNoteCampLine(w, CAMP, NOW);
      agent._guildFeedNoteCampLine(w, `${TS} You say, 'hello'`, NOW + 59_000);
      expect(w.campAt).toBe(NOW);
      agent._guildFeedNoteCampLine(w, `${TS} You say, 'hello'`, NOW + 61_000);
      expect(w.campAt).toBe(0);
    });
    it('a log with no record, an empty line or an unrelated line changes nothing', () => {
      const w = rec();
      agent._guildFeedNoteCampLine(null, CAMP, NOW);
      agent._guildFeedNoteCampLine(w, '', NOW);
      agent._guildFeedNoteCampLine(w, `${TS} You have entered the Plane of Fire.`, NOW);
      expect(w.campAt).toBeUndefined();
    });
    it('end to end: the feed polls right after the camp line, and stops when the player is back', async () => {
      const w = { character: ME, logPath: 'a', lastSeen: T0 - 2_000 };
      agent._setWatchedLogsForTest([w]);
      try {
        const f = mockFetch(ok({}));
        expect(await agent._pollGuildFeed(T0, f)).toBe('in-game');             // playing
        agent._guildFeedNoteCampLine(w, CAMP, T0);
        expect(await agent._pollGuildFeed(T0 + 1_000, f)).toBe('ok');          // two seconds after the last line, not 90
        expect(f.calls).toHaveLength(1);
        agent._guildFeedNoteCampLine(w, WELCOME, T0 + 120_000);
        w.lastSeen = T0 + 120_000;
        expect(await agent._pollGuildFeed(T0 + 121_000, f)).toBe('in-game');
        expect(f.calls).toHaveLength(1);
      } finally { agent._setWatchedLogsForTest([]); }
    });
  });

  it('the source names those signals and runs no process scan', () => {
    const code = stripJs(FEED_BLOCK);
    expect(code).toMatch(/_eqInGameFrom\(_zealState, stats\.watchedLogs, now\)/);
    expect(code).not.toMatch(/tasklist|child_process|execSync|spawn\(|pgrep|\bps\b/);
  });
  it('the tail callback feeds every raw log line to the camp note', () => {
    expect(stripJs(AGENT_SRC)).toMatch(/_guildFeedNoteCampLine\(watched, line, Date\.now\(\)\);/);
  });
});

// ── 2. Cursor, boot, back-off ────────────────────────────────────────────────────────────────────
describe('cursor and boot', () => {
  it('the cursor follows the bot\'s seq, and the next ask carries it with the boot', async () => {
    const f = mockFetch(ok({ boot: 'b1', seq: 7, lines: [L(6, 'guild', 'Corvale', 'a'), L(7, 'raid', 'Rethlan', 'b')] }), ok({ boot: 'b1', seq: 7 }));
    await agent._pollGuildFeed(T0, f);
    await agent._pollGuildFeed(T0 + 5_000, f);
    expect(f.calls[1].url).toBe(BASE + '/guild-chat?since=7&boot=b1');
  });
  it('the cursor is the last RETURNED line\'s seq, not the response seq (a capped page must not skip lines); an empty page or a shed keeps it', async () => {
    const f = mockFetch(
      ok({ boot: 'b1', seq: 500, lines: [L(1, 'guild', 'Corvale', 'a'), L(2, 'guild', 'Corvale', 'b'), L(3, 'guild', 'Corvale', 'c')] }),
      ok({ boot: 'b1', seq: 500, lines: [], ingame: null }),
      ok({ boot: 'b1', seq: 500, lines: [] }));
    await agent._pollGuildFeed(T0, f);
    expect(agent._guildFeedStateForTest().cursor).toBe(3);
    await agent._pollGuildFeed(T0 + 5_000, f);
    expect(agent._guildFeedStateForTest().cursor).toBe(3);
    await agent._pollGuildFeed(T0 + 10_000, f);
    expect(f.calls[2].url).toBe(BASE + '/guild-chat?since=3&boot=b1');
    expect(feed({ away: true, now: T0 + 10_000 }).away).toEqual({ on: true, ingame: null, at: T0 + 10_000 });   // a shed shows no count
  });
  it('a changed boot resets the cursor to 0: this answer is dropped and the next ask starts over', async () => {
    const f = mockFetch(
      ok({ boot: 'b1', seq: 5, lines: [L(5, 'guild', 'Corvale', 'old line')] }),
      ok({ boot: 'b2', seq: 1, lines: [L(1, 'guild', 'Corvale', 'new boot line')] }),
      ok({ boot: 'b2', seq: 1, lines: [L(1, 'guild', 'Corvale', 'new boot line')] }));
    await agent._pollGuildFeed(T0, f);
    expect(await agent._pollGuildFeed(T0 + 5_000, f)).toBe('boot-reset');
    expect(agent._guildFeedStateForTest()).toMatchObject({ cursor: 0, boot: 'b2' });
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['old line']);   // the stale-cursor answer added nothing
    await agent._pollGuildFeed(T0 + 10_000, f);
    expect(f.calls[2].url).toBe(BASE + '/guild-chat?since=0&boot=b2');
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['old line', 'new boot line']);
  });
  it('lines asked for again after a bot restart do not show twice', async () => {
    const f = mockFetch(ok({ boot: 'b1', seq: 1, lines: [L(1, 'guild', 'Corvale', 'same')] }), ok({ boot: 'b2', seq: 1 }), ok({ boot: 'b2', seq: 1, lines: [L(1, 'guild', 'Corvale', 'same')] }));
    await agent._pollGuildFeed(T0, f);
    await agent._pollGuildFeed(T0 + 5_000, f);
    await agent._pollGuildFeed(T0 + 10_000, f);
    expect(agent._guildFeedRingForTest()).toHaveLength(1);
  });
  it('a request already in flight is not doubled', async () => {
    let release;
    const slow = () => new Promise(r => { release = () => r({ status: 200, ok: true, json: async () => ({ ok: true, boot: 'b1', seq: 0, lines: [] }) }); });
    const first = agent._pollGuildFeed(T0, slow);
    expect(await agent._pollGuildFeed(T0 + 1, mockFetch(ok({})))).toBe('busy');
    release(); await first;
  });
});

describe('an old bot (404) and other failures back off quietly', () => {
  it('404: feature unavailable, ask again only after 10 minutes, and say nothing', async () => {
    const spies = ['log', 'warn', 'error', 'info'].map(k => vi.spyOn(console, k).mockImplementation(() => {}));
    try {
      const f = mockFetch({ status: 404, body: null });
      expect(await agent._pollGuildFeed(T0, f)).toBe('unavailable');
      for (let s = 5; s < 600; s += 5) {
        agent.setChatPolicy({ away: true }, T0 + s * 1000);   // the overlay keeps asking
        expect(await agent._pollGuildFeed(T0 + s * 1000, f), `+${s}s`).toBe('backoff');
      }
      expect(f.calls).toHaveLength(1);
      agent.setChatPolicy({ away: true }, T0 + 600_000);
      expect(await agent._pollGuildFeed(T0 + 600_000, f)).toBe('unavailable');
      expect(f.calls).toHaveLength(2);
      for (const sp of spies) expect(sp).not.toHaveBeenCalled();
    } finally { for (const sp of spies) sp.mockRestore(); }
  });
  it('a 500, a thrown error and a malformed body are all quiet and retried after a pause, never as a fallback', async () => {
    for (const a of [{ status: 500, body: null }, new Error('boom'), { status: 200, body: { nope: 1 } }]) {
      agent._guildFeedResetForTest();
      const f = mockFetch(a);
      expect(await agent._pollGuildFeed(T0, f)).toBe('error');
      expect(await agent._pollGuildFeed(T0 + 5_000, f)).toBe('backoff');
      expect(f.calls).toHaveLength(1);
    }
  });
});

// ── 3. The lines in /api/chat ──────────────────────────────────────────────────────────────────────
const feed = (opts = {}) => agent.serializeLocalChat({ since: 0, ...opts }, opts.now == null ? T0 : opts.now);

describe('lines land in /api/chat with the existing channel ids and via: guild', () => {
  it('guild and raid lines come out as ch guild / raid, with who, text, t and via', async () => {
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 2, lines: [L(1, 'guild', 'Corvale', 'pull in five', T0 - 3000), L(2, 'raid', 'Rethlan', 'CH on Brackwyn', T0 - 2000)] })));
    const r = feed({ away: true });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ ch: 'guild', who: 'Corvale', text: 'pull in five', t: T0 - 3000, via: 'guild' });
    expect(r.lines[1]).toMatchObject({ ch: 'raid', who: 'Rethlan', text: 'CH on Brackwyn', via: 'guild' });
    for (const l of r.lines) expect(agent.chatChannelAllowed(l.ch, { away: true })).toBe(true);   // ungated: they colour and filter like local guild/raid
    expect(Object.keys(r.channels)).toEqual(expect.arrayContaining(['guild', 'raid']));
  });
  it('they are served only while the overlay asks for them (`away` on)', async () => {
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 1, lines: [L(1, 'guild', 'Corvale', 'hi')] })));
    expect(feed({ away: false }).lines).toHaveLength(0);
    expect(feed({ away: true }).lines).toHaveLength(1);
  });
  it('local lines carry no via, and the two kinds page together in one order by the shared sequence', async () => {
    agent.noteLocalChatLine(`${TS} Zarrin says, 'hello'`, ME, T0);
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 1, lines: [L(1, 'guild', 'Corvale', 'hi')] })));
    const r = feed({ away: true });
    expect(r.lines.map(l => [l.ch, l.via])).toEqual([['say', undefined], ['guild', 'guild']]);
    expect(r.lines[0].n).toBeLessThan(r.lines[1].n);
  });
  it('anything but a plain guild/raid line from a named speaker is dropped (no officer, tell, group or say through this door)', () => {
    const n = agent.guildFeedTake([
      L(1, 'officer', 'Rethlan', 'x'), L(2, 'tell', 'Rethlan', 'x'), L(3, 'say', 'Rethlan', 'x'), L(4, 'group', 'Rethlan', 'x'),
      L(5, 'guild', '', 'no speaker'), L(6, 'guild', 'Corvale', '   '), null, L(7, 'guild', 'Corvale', 'kept'),
    ], T0);
    expect(n).toBe(1);
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['kept']);
  });
  it('a line this PC\'s own log also heard is still taken: only the overlay knows what it shows, so it alone merges the two copies', () => {
    agent.setChatPolicy({ away: true }, T0);
    agent.noteLocalChatLine(`${TS} Corvale tells the guild, 'on my way'`, ME, T0);
    agent.noteLocalChatLine(`${TS} You say to your guild, 'ready'`, ME, T0);
    const local = agent._chatRingForTest().map(x => x.t);
    expect(local.length).toBe(2);
    const n = agent.guildFeedTake([L(1, 'guild', 'Corvale', 'on my way', local[0] + 2000), L(2, 'guild', ME, 'ready', local[1]), L(3, 'guild', 'Corvale', 'new', local[0])], local[0]);
    expect(n).toBe(3);
  });
  it('the ring is its own, capped at 300, and never touches the chat ring', async () => {
    const lines = []; for (let i = 1; i <= 320; i++) lines.push(L(i, 'guild', 'Corvale', 'line ' + i, T0 + i * 1000));
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 320, lines })));
    expect(agent._guildFeedRingForTest()).toHaveLength(agent.CHAT_GUILD_RING_MAX);
    expect(agent.CHAT_GUILD_RING_MAX).toBe(300);
    expect(agent._guildFeedRingForTest()[0].text).toBe('line 21');
    expect(agent._chatRingForTest()).toHaveLength(0);
  });
});

describe('the game starting stops the poll and clears the ring', () => {
  it('Zeal state appearing clears the lines, resets the cursor and makes no call', async () => {
    const f = mockFetch(ok({ boot: 'b1', seq: 4, lines: [L(1, 'guild', 'Corvale', 'hi')] }));
    await agent._pollGuildFeed(T0, f);
    expect(feed({ away: true }).lines).toHaveLength(1);
    agent._setZealStateForTest(ME, WORLD(T0 + 6_000));
    expect(await agent._pollGuildFeed(T0 + 6_000, f)).toBe('in-game');
    expect(f.calls).toHaveLength(1);
    expect(agent._guildFeedRingForTest()).toHaveLength(0);
    expect(feed({ away: true, now: T0 + 6_000 }).lines).toHaveLength(0);
    expect(feed({ away: true, now: T0 + 6_000 }).away).toBeNull();
    expect(agent._guildFeedStateForTest()).toMatchObject({ cursor: 0, boot: '' });
  });
  it('local lines then take over without duplicates, and a later away spell asks from 0 again', async () => {
    const f = mockFetch(ok({ boot: 'b1', seq: 4, lines: [L(4, 'guild', 'Corvale', 'pull in five')] }));
    await agent._pollGuildFeed(T0, f);
    agent._setZealStateForTest(ME, WORLD(T0 + 6_000));
    await agent._pollGuildFeed(T0 + 6_000, f);
    agent.noteLocalChatLine(`${TS} Corvale tells the guild, 'pull in five'`, ME, T0 + 7_000);
    const r = feed({ away: true, now: T0 + 7_000 });
    expect(r.lines.filter(l => l.text === 'pull in five')).toHaveLength(1);
    expect(r.lines[0].via).toBeUndefined();
    agent._setZealStateForTest(ME, null);
    agent.setChatPolicy({ away: true }, T0 + 300_000);
    await agent._pollGuildFeed(T0 + 300_000, f);
    expect(f.calls[1].url).toBe(BASE + '/guild-chat?since=0&boot=');
  });
  it('an answer that lands after the game started is discarded', async () => {
    let release;
    const slow = () => new Promise(r => { release = () => r({ status: 200, ok: true, json: async () => ({ ok: true, boot: 'b1', seq: 1, lines: [{ seq: 1, t: T0, ch: 'guild', who: 'Corvale', text: 'late' }] }) }); });
    const p = agent._pollGuildFeed(T0, slow);
    agent._setZealStateForTest(ME, WORLD(T0));
    release();
    expect(await p).toBe('in-game');
    expect(agent._guildFeedRingForTest()).toHaveLength(0);
  });
});

// ── 4. "Nobody is in game": the count rides /api/chat as away.ingame ─────────────────────────────────
describe('away.ingame passes through /api/chat', () => {
  it('a number is passed as it came (0 = nobody, N = members in game with Mimic running)', async () => {
    await agent._pollGuildFeed(T0, mockFetch(ok({ ingame: 3 })));
    expect(feed({ away: true }).away).toEqual({ on: true, ingame: 3, at: T0 });
    await agent._pollGuildFeed(T0 + 5_000, mockFetch(ok({ ingame: 0 })));
    expect(feed({ away: true, now: T0 + 5_000 }).away).toEqual({ on: true, ingame: 0, at: T0 + 5_000 });
  });
  it('null, absent and nonsense are "unknown" (null), never a count', async () => {
    for (const v of [null, undefined, 'lots', -2, NaN]) {
      await agent._pollGuildFeed(T0, mockFetch(ok({ ingame: v })));
      expect(feed({ away: true }).away, String(v)).toEqual({ on: true, ingame: null, at: T0 });
    }
  });
  it('away is null while the feed is not live: overlay not asking, answer older than 30 s, or the game started', async () => {
    await agent._pollGuildFeed(T0, mockFetch(ok({ ingame: 2 })));
    expect(feed({ away: false }).away).toBeNull();
    expect(feed({ away: true, now: T0 + 31_000 }).away).toBeNull();
    expect(feed({ away: true, now: T0 + 29_000 }).away).toMatchObject({ on: true });
    agent._setZealStateForTest(ME, WORLD(T0 + 1_000));
    await agent._pollGuildFeed(T0 + 1_000, mockFetch(ok({})));
    expect(feed({ away: true, now: T0 + 1_000 }).away).toBeNull();
  });
  it('an old agent-side answer with no `away` never reaches the overlay as one: a fresh agent with nothing asked has away null', () => {
    expect(feed({ away: true }).away).toBeNull();
  });
});

// ── 5. Display only: never an upload, history, trigger, tell or parse path ───────────────────────────
describe('display only', () => {
  it('receiving lines leaves every upload buffer, the Recent Tells ring and the queue untouched', async () => {
    const b = agent._uploadBuffersForTest();
    const before = [b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length, agent._uploadQueueLenForTest()];
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 2, ingame: 1, lines: [L(1, 'guild', 'Corvale', 'a'), L(2, 'raid', 'Rethlan', 'b')] })));
    expect(feed({ away: true }).lines).toHaveLength(2);
    expect([b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length, agent._uploadQueueLenForTest()]).toEqual(before);
  });
  it('the history read never sees them', async () => {
    await agent._pollGuildFeed(T0, mockFetch(ok({ seq: 1, lines: [L(1, 'guild', 'Corvale', 'a')] })));
    const h = await agent.buildChatHistory({ hours: 1, away: true }, T0, { files: [] });
    expect(h.lines).toHaveLength(0);
    // (a line OLD on arrival is the exception: it goes to the late ring and history serves it, see test/chat-guild-backlog.test.js)
    expect(stripJs(HISTORY_BLOCK)).not.toMatch(/guildFeed|_guildFeedRing/);
  });
  it('the ring is named only inside the chat block, the guild feed block and the export lines', () => {
    const outside = stripJs(AGENT_SRC.replace(CHAT_BLOCK, '').replace(FEED_BLOCK, '').replace(HISTORY_BLOCK, ''));
    const uses = outside.split('\n').filter(l => /\b(?:_guildFeedRing|guildFeedTake|guildFeedClear|_pollGuildFeed|_guildFeed)\b/.test(l)).map(l => l.trim());
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^_pollGuildFeed, _eqInGameFrom, guildFeedTake, guildFeedClear,/);
  });
  it('neither block names a buffer, queue, uploader, tell/parse/trigger entry point or file write for these lines', () => {
    const code = stripJs(FEED_BLOCK);
    expect(code.length).toBeGreaterThan(1500);
    for (const bad of [/\bchatBuffer\b/, /\btellBuffer\b/, /\bchatBatch\b/, /\brecentTells\b/, /\benqueueUpload\b/, /\bupload[A-Z]\w*\(/, /\b_uploadQueue\b/,
      /\bQUEUE_FILE\b/, /\bfs\./, /\bwriteFile/, /\bappendFile/, /\bparseEvent\b/, /\bshouldKeep\b/, /\b_fireTrigger/, /\b_pushRecentTell\b/, /\bnoteLocalChatLine\b/, /\bmethod:/, /\bbody:/]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
    const ring = stripJs(CHAT_BLOCK);
    const take = ring.slice(ring.indexOf('function guildFeedTake'), ring.indexOf('function noteLocalChatLine'));
    expect(take.length).toBeGreaterThan(500);
    for (const bad of [/\benqueueUpload\b/, /\bchatBuffer\b/, /\btellBuffer\b/, /\bfetch\(/, /\bfs\./]) expect(take, String(bad)).not.toMatch(bad);
  });
  it('the only network call in the feed block is the one GET, on the bot base with the agent token', () => {
    const code = stripJs(FEED_BLOCK);
    expect(code.match(/\bfetch\b/g)).toHaveLength(1);
    expect(code).toContain("'/guild-chat?since='");
    expect(code).toMatch(/_getApiBase\(\)/);
    expect(code).toMatch(/_getAgentToken\(\)/);
    for (const gate of [/_localOnly\(\)/, /_controlStandDown\(\)\.down/, /chatPolicyNow\(t\)\.away/, /_eqInGame\(t\)/]) expect(code).toMatch(gate);
  });
  it('`away` is a policy key but gates no channel group', () => {
    expect(stripJs(CHAT_BLOCK)).toMatch(/const CHAT_POLICY_KEYS = \[[^\]]*'away'\]/);
    expect(agent.CHAT_GROUPS.some(g => g.gate === 'away')).toBe(false);
    expect(agent.chatPolicyNow(T0 + 999_999).away).toBe(false);
    expect(agent.chatPolicyNow(T0).away).toBe(true);
  });
});

// ── 6. The overlay (chat.html) and Mimic's prefs ──────────────────────────────────────────────────────
describe('chat.html: the switch, the poll, the mark and the hint', () => {
  const code = stripJs(SCRIPT);
  it('a ⚙ drawer switch on the visible row (not the fold), worded for the guild lead, sent as away=1/0 on every poll', () => {
    const optins = sliceBlock(code, 'var OPTINS = [', '\n  ];');
    expect(optins).toMatch(/\['away',\s+'Guild and raid chat from the guild while I\\'m out of game'/);
    expect(optins).not.toMatch(/\['away',[^\n]*, 1\]/);   // no fourth field: it is not under "More settings"
    expect(code).toMatch(/'&away=' \+ \(_prefs\.away \? 1 : 0\)/);
  });
  it('defaults ON before the first prefs, and an unset pref reads as on (only an explicit false turns it off)', () => {
    expect(code).toMatch(/other: false, away: true, meleeShow/);
    expect(code).toMatch(/away: p\.away !== false,/);
  });
  it('turning it off drops the relayed lines already shown; turning it on needs no purge of local ones', () => {
    const purge = evalBlock(`
      var _prefs = { away: false }; function groupOf(ch){ return { id: ch }; } function gateOn(){ return true; }
      var _lines = [{ n: 1, ch: 'guild', via: 'guild' }, { n: 2, ch: 'guild' }, { sep: 1 }];
      ${sliceBlock(code, 'function purgeGated(){', '\n  }')}
      purgeGated();
    `, ['_lines'])._lines;
    expect(purge.map(l => l.n)).toEqual([2, undefined]);
  });
  function lineHtml(l) {
    return evalBlock(`
      var _channels = { guild: { color: '#56d364', tag: 'GU', label: 'Guild' } }, _copiedN = 0, _chanNames = {}, _prefs = { offChannels: [], only: '' }, _isBrk = false;
      function esc(s){ return String(s == null ? '' : s); }
      ${sliceBlock(SCRIPT, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
      ${sliceBlock(SCRIPT, 'function hhmm(t){', '}\n')}
      ${sliceBlock(SCRIPT, 'function lineHtml(l, tag){', "+ viaMark + '</div>';\n  }")}
    `, ['lineHtml']).lineHtml(l);
  }
  it('a via: guild line carries a small "via guild" mark; a local line does not', () => {
    const base = { n: 3, t: T0, ch: 'guild', who: 'Corvale', text: 'pull in five' };
    expect(lineHtml({ ...base, via: 'guild' })).toMatch(/<span class="via" title="[^"]*">via guild<\/span><\/div>$/);
    expect(lineHtml(base)).not.toContain('via');
    expect(lineHtml({ ...base, via: 'guild' })).toContain('pull in five');
  });
  it('the mark is dim and small in CSS', () => {
    expect(stripCssComments(CHAT_HTML)).toMatch(/\.ln \.via\{[^}]*font-size:0\.75em[^}]*color:var\(--wp-dim\)/);
  });
  // paintAway against stand-in elements: the three display states
  function away(a, prefsAway = true) {
    const els = { awayhint: { hidden: true, textContent: '' }, awaynote: { hidden: true } };
    return evalBlock(`
      var els = ${JSON.stringify(els)};
      var document = { getElementById: function(id){ return els[id]; } };
      ${sliceBlock(SCRIPT, 'function paintAway(a){', '\n  }')}
      paintAway(${JSON.stringify(prefsAway ? a : null)});
    `, ['els']).els;
  }
  it('state 1, a count: "away · guild feed · N in game with Mimic", and no empty-state note', () => {
    const e = away({ on: true, ingame: 4, at: T0 });
    expect(e.awayhint.hidden).toBe(false);
    expect(e.awayhint.textContent).toBe('away · guild feed · 4 in game with Mimic');
    expect(e.awaynote.hidden).toBe(true);
  });
  it('state 2, zero: the hint says 0 with Mimic, and the dim note explains the empty feed', () => {
    const e = away({ on: true, ingame: 0, at: T0 });
    expect(e.awayhint.hidden).toBe(false);
    expect(e.awayhint.textContent).toBe('away · guild feed · 0 in game with Mimic');
    expect(e.awaynote.hidden).toBe(false);
    expect(CHAT_HTML).toContain('Nobody is in game with Mimic running right now — no guild or raid chat to relay.');
  });
  it('state 3, unknown (null / absent): "away · guild feed" with no count and no note', () => {
    for (const a of [{ on: true, ingame: null, at: T0 }, { on: true, at: T0 }]) {
      const e = away(a);
      expect(e.awayhint.hidden).toBe(false);
      expect(e.awayhint.textContent).toBe('away · guild feed');
      expect(e.awaynote.hidden).toBe(true);
    }
  });
  it('not live (null, or on false): both hidden', () => {
    for (const a of [null, { on: false, ingame: 0 }]) {
      const e = away(a);
      expect(e.awayhint.hidden).toBe(true);
      expect(e.awaynote.hidden).toBe(true);
    }
  });
  it('the tick paints it from the agent\'s answer only while the switch is on, and clears it when the agent cannot be reached', () => {
    expect(code).toMatch(/paintAway\(_prefs\.away \? s\.away : null\);/);
    const catchBlock = code.slice(code.lastIndexOf('} catch (e) {'));
    expect(catchBlock).toContain('paintAway(null);');
  });
  it('the title bar has the hint (hidden until live) and the feed area has the note', () => {
    expect(CHAT_HTML).toMatch(/<span id="awayhint" class="awayhint" hidden[^>]*>away · guild feed<\/span>/);
    expect(CHAT_HTML).toMatch(/<div id="awaynote" class="awaynote" hidden>/);
  });
});

function stripCssComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

describe('Mimic keeps the switch', () => {
  const code = stripJs(MAIN);
  it('away is remembered as a boolean through the whitelist and read back, ON unless explicitly off', () => {
    expect(code).toMatch(/'other', 'away'\]\) if \(typeof inc\[k\] === 'boolean'\)/);
    expect(code).toContain('away: p.away !== false,');
  });
});

// ── FB-91: the local copy wins over the relayed one, whatever the capitalisation ─────────────────────
describe('FB-91: a line in your own log is shown once, as local', () => {
  const LT = new Date('Wed Oct 14 21:10:01 2026').getTime();   // the local line's own timestamp, which is what a relayed copy sits near
  const said = (text, ts = T0) => agent.noteLocalChatLine(`${TS} Corvale tells the guild, '${text}'`, ME, ts);
  // The agent no longer merges the two copies (2026-10-20): it served the local one only when the overlay might not be
  // showing it, and the relayed line vanished. It hands the overlay both, and the overlay merges them (next describe).
  it('relayed copy after the local one, differing only in capitalisation: both are served, local first with no via', () => {
    said('what is nimic?');
    const local = agent._chatRingForTest()[0].t;
    expect(agent.guildFeedTake([L(1, 'guild', 'Corvale', 'What is Nimic?', local + 1000)], local)).toBe(1);
    expect(feed({ away: true }).lines.map(l => l.via)).toEqual([undefined, 'guild']);
  });
  it('relayed copy first, then the local line: neither is removed by the agent', () => {
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'What is nimic?', LT + 1000)], LT);
    said('what is nimic?');
    expect(agent._guildFeedRingForTest()).toHaveLength(1);
    expect(feed({ away: true }).lines.map(l => l.via)).toEqual(['guild', undefined]);
  });
  it('your own line is kept in the relay whether or not your own log also has it ("You" locally, your name in the relay)', () => {
    agent.guildFeedTake([L(1, 'guild', ME, 'Ready', LT)], LT);
    agent.noteLocalChatLine(`${TS} You say to your guild, 'ready'`, ME, T0);
    expect(agent._guildFeedRingForTest()).toHaveLength(1);
    expect(feed({ away: true }).lines.map(l => [l.who, l.via])).toEqual([[ME, 'guild'], ['You', undefined]]);
  });
  it('two genuinely different messages both stay', () => {
    said('what is nimic?');
    const local = agent._chatRingForTest()[0].t;
    expect(agent.guildFeedTake([L(1, 'guild', 'Corvale', 'what is mimic?', local), L(2, 'guild', 'Rethlan', 'what is nimic?', local)], local)).toBe(2);
    agent.noteLocalChatLine(`${TS} Brackwyn tells the guild, 'something else'`, ME, T0);
    expect(agent._guildFeedRingForTest()).toHaveLength(2);
  });
});

// The overlay's harness: the real addLines/repaint-side merge code, with a visibility switch so a local copy can be
// "in the list but not on screen" (a character search, a channel switched off).
const mergeHarness = () => evalBlock(`
  var _lines = [], _histLines = [], _histHours = 0, repainted = 0, hidden = {};
  function learnChannel(){ return false; } function paintChans(){} function shownGroupIds(){ return []; }
  function makeFilter(){ return function(){ return true; }; } function pinned(){ return true; } function toBottom(){} function paintEmpty(){} function paintNew(){}
  function lineVisible(f, l){ return !hidden[l.n]; } function rowHtml(l){ return ''; }
  var feedEl = { insertAdjacentHTML: function(){}, children: [], removeChild: function(){} };
  var FEED_MAX = 500, _unread = 0;
  function repaint(){ repainted++; }
  ${sliceBlock(SCRIPT, 'function normText(s){', 'if (sameSaid(v, pool[i])) return true; return false; }')}
  ${sliceBlock(SCRIPT, 'function shownCopies(pool){', 'return out;\n  }')}
  ${sliceBlock(SCRIPT, 'function addLines(fresh){', 'if (stick) toBottom(); else { _unread += shown; paintNew(); }\n    }\n    paintEmpty();\n  }')}
  function reset(){ _lines.length = 0; _histLines.length = 0; repainted = 0; hidden = {}; _histHours = 0; }
  function lines(){ return _lines; }
  function setLines(a){ _lines = a; } function setHist(a){ _histLines = a; _histHours = a.length ? 6 : 0; }
  function hide(n){ hidden[n] = true; }
`, ['addLines', 'reset', 'lines', 'setLines', 'setHist', 'sameSaid', 'hide']);

describe('FB-91: chat.html merges a relayed and a local copy into the local one', () => {
  const merge = mergeHarness();
  const relay = { n: 1, t: T0, ch: 'guild', who: 'Corvale', text: 'What is Nimic?', via: 'guild' };
  const local = { n: 2, t: T0 + 1000, ch: 'guild', who: 'Corvale', text: 'what is nimic?' };
  it('local first, relayed second (case differs): shown once, no via', () => {
    merge.reset(); merge.addLines([local]); merge.addLines([relay]);
    expect(merge.lines().map(l => l.via)).toEqual([undefined]);
  });
  it('relayed first, local second: the relayed one is dropped and the local one stays unlabelled', () => {
    merge.reset(); merge.addLines([relay]); merge.addLines([local]);
    expect(merge.lines()).toEqual([local]);
  });
  it('both in one answer: only the local one', () => {
    merge.reset(); merge.addLines([relay, local]);
    expect(merge.lines()).toEqual([local]);
  });
  it('a history line from the log also beats a relayed copy', () => {
    merge.reset(); merge.setHist([{ ...local, n: -1 }]); merge.addLines([relay]);
    expect(merge.lines()).toHaveLength(0);
  });
  it('different text, speaker or channel keeps both', () => {
    merge.reset(); merge.addLines([local]);
    merge.addLines([{ ...relay, n: 3, text: 'what is mimic?' }, { ...relay, n: 4, who: 'Rethlan' }, { ...relay, n: 5, ch: 'raid' }]);
    expect(merge.lines()).toHaveLength(4);
  });
  it('your own local line (who "You", heard on your character) matches your name in the relay', () => {
    merge.reset(); merge.addLines([{ n: 1, t: T0, ch: 'guild', who: 'You', self: true, on: 'Aldenmar', text: 'ready' }]);
    merge.addLines([{ n: 2, t: T0, ch: 'guild', who: 'Aldenmar', text: 'Ready', via: 'guild' }]);
    expect(merge.lines()).toHaveLength(1);
  });
});

// ── Your own words always reach the feed (the guild lead, 2026-10-20: "missing my own messages to guild on /camp") ─────
describe('own lines: a stood-down agent (a /camp demotes it at once) still sends what the player said', () => {
  let queue;
  const selfLine = { channel: 'guild', speaker: ME, text: 'anyone else for Hate Factioning?', ts: '2026-10-20T15:12:10.000Z', speaker_source: 'log_name' };
  const zealLine = { ...selfLine, text: 'need a rez', speaker_source: 'zeal' };
  const heard = { channel: 'guild', speaker: 'Corvale', text: 'need to go 2/3 hours guys see you soon !!', ts: '2026-10-20T15:12:12.000Z', speaker_source: 'line' };
  const sent = () => queue.flatMap(q => q.kind === 'chat' ? q.payload.messages : []);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });   // enqueueUpload's disk save never fires
    queue = agent._uploadQueueForTest();
    queue.splice(0);
  });
  afterEach(() => {
    queue.splice(0);
    agent._setReporterRolesForTest({});
    vi.useRealTimers();
  });
  it('the reporter sends everything it heard (unchanged)', async () => {
    agent._setReporterRolesForTest({ chat: true });
    await agent.uploadChat([selfLine, heard], { dryRun: false });
    expect(sent().map(m => m.speaker)).toEqual([ME, 'Corvale']);
  });
  it('a stood-down agent still sends the player\'s own lines, whichever way the speaker was resolved, and nothing it merely heard', async () => {
    agent._setReporterRolesForTest({ chat: false });
    await agent.uploadChat([selfLine, heard, zealLine], { dryRun: false });
    expect(sent().map(m => m.text)).toEqual([selfLine.text, zealLine.text]);
  });
  it('a stood-down agent that only heard others sends nothing at all', async () => {
    agent._setReporterRolesForTest({ chat: false });
    await agent.uploadChat([heard], { dryRun: false });
    expect(queue).toHaveLength(0);
  });
  it('what the player\'s own client can send is only guild and raid: officer, group and tells never take this road', () => {
    expect(agent.guildFeedTake([L(1, 'officer', ME, 'x'), L(2, 'tell', ME, 'x'), L(3, 'group', ME, 'x')], T0)).toBe(0);
  });
});

describe('own lines: in away mode, and once when a local and a relayed copy both exist', () => {
  const SAID = 'anyone else for Hate Factioning?';
  it('away, with no local copy at all: the relayed copy of your own line is shown (not dropped as "yours")', () => {
    expect(agent.guildFeedTake([L(1, 'guild', ME, SAID, T0), L(2, 'guild', 'Corvale', 'see you soon', T0 + 2000)], T0)).toBe(2);
    const r = feed({ away: true });
    expect(r.lines.map(l => [l.who, l.via])).toEqual([[ME, 'guild'], ['Corvale', 'guild']]);
  });
  it('away, with a local copy too: the agent serves BOTH (it cannot know the overlay shows the local one); the overlay merges them', () => {
    agent.noteLocalChatLine(`${TS} You say to your guild, '${SAID}'`, ME, T0);
    const at = agent._chatRingForTest()[0].t;
    expect(agent.guildFeedTake([L(1, 'guild', ME, SAID, at + 1000)], at)).toBe(1);
    const r = feed({ away: true });
    expect(r.lines.map(l => [l.who, l.via])).toEqual([['You', undefined], [ME, 'guild']]);
  });
  it('another member\'s lines are unchanged: shown via guild, and a different message is never merged away', () => {
    agent.noteLocalChatLine(`${TS} Corvale tells the guild, 'pull in five'`, ME, T0);
    const at = agent._chatRingForTest()[0].t;
    expect(agent.guildFeedTake([L(1, 'guild', 'Corvale', 'pull in six', at), L(2, 'guild', 'Rethlan', 'pull in five', at)], at)).toBe(2);
  });
});

describe('own lines: chat.html merges a rewritten relayed copy of a line into the local one', () => {
  const merge = mergeHarness();
  const mine = { n: 1, t: T0, ch: 'guild', who: 'You', self: true, on: ME, text: 'ok!/camp now - brb' };
  const relayed = { n: 2, t: T0 + 2000, ch: 'guild', who: ME, text: 'Ok camp now brb', via: 'guild' };
  it('local first or relayed first: your line shows once, as yours', () => {
    merge.reset(); merge.addLines([mine]); merge.addLines([relayed]);
    expect(merge.lines()).toEqual([mine]);
    merge.reset(); merge.addLines([relayed]); merge.addLines([mine]);
    expect(merge.lines()).toEqual([mine]);
  });
  it('a local copy that is held but NOT on screen does not take the relayed line down with it (away: the line shows once, via guild)', () => {
    merge.reset(); merge.hide(1);                       // e.g. a character search or a switched-off channel hides the local row
    merge.addLines([mine]); merge.addLines([relayed]);
    expect(merge.lines()).toEqual([mine, relayed]);     // both held; the repaint shows the relayed one only (see the next test)
    merge.reset(); merge.hide(1);
    merge.addLines([relayed, mine]);                    // both in one answer
    expect(merge.lines()).toEqual([relayed, mine]);
  });
  it('a hidden history copy does not drop it either; a shown one still does', () => {
    merge.reset(); merge.setHist([{ ...mine, n: -1 }]); merge.hide(-1); merge.addLines([relayed]);
    expect(merge.lines()).toEqual([relayed]);
    merge.reset(); merge.setHist([{ ...mine, n: -1 }]); merge.addLines([relayed]);
    expect(merge.lines()).toEqual([]);
  });
  it('a relayed line with no local copy stays (your own line is never filtered out for being yours)', () => {
    merge.reset(); merge.addLines([relayed]);
    expect(merge.lines()).toEqual([relayed]);
  });
  it('different words are different lines', () => {
    merge.reset(); merge.addLines([mine]); merge.addLines([{ ...relayed, text: 'Ok camp now brb soon' }]);
    expect(merge.lines()).toHaveLength(2);
  });
});

// ── A relayed line that is already old never shows as live (the guild lead, 2026-10-23) ──────────────
// The bot's ring holds hours of /gu and /rs, and a fresh cursor (a camp-out, a bot restart, an agent restart) asks for all of
// it. The overlay paints in arrival order, so 10:00 lines between 11:39 ones read as new.
describe('late relayed lines stay out of the live feed', () => {
  const MIN = 60_000;
  it('a fresh agent given a ring of old lines shows none of them; a line seconds old still shows', async () => {
    const f = mockFetch(ok({ boot: 'b1', seq: 3, lines: [
      L(1, 'guild', 'Corvale', 'pull at ten', T0 - 100 * MIN),
      L(2, 'guild', 'Rethlan', 'buffs up', T0 - 99 * MIN),
      L(3, 'raid', 'Brackwyn', 'just now', T0 - 5_000),
    ] }));
    expect(await agent._pollGuildFeed(T0, f)).toBe('ok');
    expect(feed({ away: true }).lines.map(l => l.text)).toEqual(['just now']);
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['just now']);
    expect(agent._guildFeedStateForTest().cursor).toBe(3);   // moved past the dropped ones: they are not asked for again
  });
  it('the cut-off is two minutes behind arrival', () => {
    expect(agent.guildFeedTake([L(1, 'guild', 'Corvale', 'inside', T0 - 119_000), L(2, 'guild', 'Corvale', 'outside', T0 - 121_000)], T0)).toBe(1);
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['inside']);
  });
  it('a camp-out after hours of play: the ring the bot holds from then is dropped, new talk after it is kept', async () => {
    const T1 = T0 + 100 * MIN;
    const f = mockFetch(
      ok({ boot: 'b1', seq: 2, lines: [L(1, 'guild', 'Corvale', 'old a', T0), L(2, 'guild', 'Corvale', 'old b', T0 + MIN)] }),
      ok({ boot: 'b1', seq: 3, lines: [L(3, 'guild', 'Corvale', 'fresh', T1 + 4_000)] }));
    agent.setChatPolicy({ away: true }, T1);
    await agent._pollGuildFeed(T1, f);
    expect(feed({ away: true, now: T1 }).lines).toHaveLength(0);
    await agent._pollGuildFeed(T1 + 5_000, f);
    expect(feed({ away: true, now: T1 + 5_000 }).lines.map(l => l.text)).toEqual(['fresh']);
  });
});

// Mutation checks run when this file was written (each reverted):
//   1. `if (policy.away) feeds.push(_guildFeedRing)` -> `feeds.push(_guildFeedRing)`: "served only while the overlay asks" fails.
//   2. `if (_controlStandDown().down) return 'dormant'` removed: the dormant and version-floor gates fail, and so does
//      the source scan that requires the gate to be named in the feed block.
