// test/chat-guild-backlog.test.js: relayed guild chat that is already old on arrival shows as HISTORY, never as live (the guild
// lead, 2026-10-23). 4.0.18 stopped old relayed lines popping into the live feed by dropping them, which also meant opening Chat
// out of game no longer showed the bot's last hour ("chat is one thing that you may want to keep open"). Now guildFeedTake keeps
// them in a separate late ring and /api/chat/history merges them, in time order, with the local logs' lines.
//
// Promises under test: (1) a late line is in history and NOT in the live ring or /api/chat lines; a live one is the reverse;
// (2) the history window, the channel gates, a breakout's `groups` and the Away switch all apply to relayed history;
// (3) a relayed line equal to a local-log line appears once, as the local one; (4) the cap is per source (local 3000, relayed
// 300), so relayed lines never evict local ones; (5) the overlay is told (`backlog` on /api/chat) and re-reads its history.
// Mutation-checked: see the notes at the bottom.
//
// Run: npx vitest run test/chat-guild-backlog.test.js

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const CHAT_HTML = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chat.html'), 'utf8');
const SCRIPT = stripJs(CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>')));
const AGENT_SRC = readSource(AGENT_INDEX);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `[${DAYS[d.getDay()]} ${MONS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
const NOW = new Date(2026, 9, 23, 22, 0, 0).getTime();
const MIN = 60_000;
const at = (minAgo, text) => `${stamp(NOW - minAgo * MIN)} ${text}`;
const L = (seq, ch, who, text, t) => ({ seq, t, ch, who, text });

let DIR;
beforeAll(() => { DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-backlog-')); });
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
beforeEach(() => { agent._resetLocalChatForTest(); agent._resetChatHistoryForTest(); });

function mk(name, lines) {
  const f = path.join(DIR, `eqlog_${name}_pq.proj.txt`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  fs.utimesSync(f, new Date(NOW), new Date(NOW));
  return f;
}
const HIST = (q = {}, files = []) => agent.buildChatHistory({ hours: 6, away: true, ...q }, NOW, { files });
const texts = (r) => r.lines.map(l => (l.sep ? '[' + l.text + ']' : l.text));
const liveTexts = () => agent.serializeLocalChat({ since: 0, away: true }, NOW).lines.map(l => l.text);
const backlog = () => agent.serializeLocalChat({ since: 0, away: true }, NOW).backlog;

describe('late relayed lines go to history, live ones to the live feed', () => {
  const lines = () => [
    L(1, 'guild', 'Corvale', 'pull at ten', NOW - 100 * MIN),
    L(2, 'raid', 'Rethlan', 'buffs up', NOW - 60 * MIN),
    L(3, 'guild', 'Brackwyn', 'afk three', NOW - 3 * MIN),
    L(4, 'guild', 'Corvale', 'one minute old', NOW - 1 * MIN),
    L(5, 'raid', 'Rethlan', 'five seconds old', NOW - 5_000),
  ];
  it('the two recent lines are live; the three older ones are history in time order and in no live buffer', async () => {
    agent.setChatPolicy({ away: true }, NOW);
    agent.guildFeedTake(lines(), NOW);
    expect(agent._guildFeedRingForTest().map(r => r.text)).toEqual(['one minute old', 'five seconds old']);
    expect(liveTexts()).toEqual(['one minute old', 'five seconds old']);
    const r = await HIST();
    expect(texts(r)).toEqual(['pull at ten', 'buffs up', 'afk three']);
    expect(r.lines.every(l => l.via === 'guild' && l.on === '')).toBe(true);
    expect(r.lines.map(l => l.ch)).toEqual(['guild', 'raid', 'guild']);
    expect(r.relayed).toBe(3);
  });
  it('a line is never held live and as history at once, and a replay of the bot ring adds nothing', () => {
    agent.guildFeedTake(lines(), NOW);
    agent.guildFeedTake(lines(), NOW);
    expect(agent._guildFeedRingForTest()).toHaveLength(2);
    expect(agent._guildLateRingForTest()).toHaveLength(3);
    // the 5 s line, replayed after it has aged past the cut-off, is still held live and is not added to history
    agent.guildFeedTake([L(5, 'raid', 'Rethlan', 'five seconds old', NOW - 5_000)], NOW + 10 * MIN);
    expect(agent._guildLateRingForTest().map(r => r.text)).toEqual(['pull at ten', 'buffs up', 'afk three']);
  });
  it('the history window applies (the smallest window is an hour): 1 h leaves out the 130, 100 and 61 minute lines', async () => {
    agent.guildFeedTake([
      L(1, 'guild', 'Corvale', 'one thirty', NOW - 130 * MIN), L(2, 'guild', 'Corvale', 'hundred', NOW - 100 * MIN),
      L(3, 'guild', 'Corvale', 'sixty one', NOW - 61 * MIN), L(4, 'guild', 'Corvale', 'thirty', NOW - 30 * MIN), L(5, 'guild', 'Corvale', 'five', NOW - 5 * MIN),
    ], NOW);
    expect(texts(await HIST({ hours: 1 }))).toEqual(['thirty', 'five']);
    expect(texts(await HIST({ hours: 2 }))).toEqual(['hundred', 'sixty one', 'thirty', 'five']);
    expect(texts(await HIST({ hours: 3 }))).toEqual(['one thirty', 'hundred', 'sixty one', 'thirty', 'five']);
  });
  it('a line past the longest window (24 h) is not kept at all', () => {
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'yesterday', NOW - 25 * 60 * MIN), L(2, 'guild', 'Corvale', 'earlier', NOW - 3 * 60 * MIN)], NOW);
    expect(agent._guildLateRingForTest().map(r => r.text)).toEqual(['earlier']);
  });
});

describe('the switches that gate the live feed gate relayed history too', () => {
  beforeEach(() => {
    agent.guildFeedTake([
      L(1, 'guild', 'Corvale', 'guild talk', NOW - 50 * MIN), L(2, 'raid', 'Rethlan', 'raid talk', NOW - 40 * MIN),
      L(3, 'guild', 'Brackwyn', 'more guild', NOW - 30 * MIN),
    ], NOW);
  });
  it('Away off: none of them', async () => {
    expect(texts(await HIST({ away: false }))).toEqual([]);
  });
  it('a breakout asking for one group gets that group\'s relayed lines only', async () => {
    expect(texts(await HIST({ groups: 'raid' }))).toEqual(['raid talk']);
    expect(texts(await HIST({ groups: 'guild' }))).toEqual(['guild talk', 'more guild']);
    expect(texts(await HIST({ groups: 'guild,raid' }))).toEqual(['guild talk', 'raid talk', 'more guild']);
    expect(texts(await HIST({ groups: 'say' }))).toEqual([]);
    expect(texts(await HIST({ groups: 'nonsense' }))).toEqual(['guild talk', 'raid talk', 'more guild']);   // an unknown id means "all", as for local lines
  });
  it('the history cache is keyed on Away, and a new backlog line shows without waiting for it to lapse', async () => {
    expect(texts(await agent.getChatHistory({ hours: 6, away: true }, NOW, {}))).toHaveLength(3);
    expect(texts(await agent.getChatHistory({ hours: 6, away: false }, NOW, {}))).toHaveLength(0);
    agent.guildFeedTake([L(4, 'guild', 'Corvale', 'newly late', NOW - 20 * MIN)], NOW);
    expect(texts(await agent.getChatHistory({ hours: 6, away: true }, NOW, {}))).toHaveLength(4);
  });
});

describe('merged with the local logs', () => {
  it('a relayed line equal to a local-log line appears once, as the local one', async () => {
    const f = mk('Aldenmar', [at(10, "Corvale tells the guild, 'same words'"), at(9, "Brackwyn tells the guild, 'only here'")]);
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'same words', NOW - 10 * MIN), L(2, 'guild', 'Rethlan', 'only relayed', NOW - 20 * MIN)], NOW);
    const r = await HIST({}, [{ character: 'Aldenmar', file: f }]);
    expect(texts(r)).toEqual(['only relayed', 'same words', 'only here']);
    const same = r.lines.filter(l => l.text === 'same words');
    expect(same).toHaveLength(1);
    expect(same[0].via).toBeUndefined();
    expect(same[0].on).toBe('Aldenmar');
  });
  it('interleaves in time order and does not break the swapped-character line between two local neighbours', async () => {
    const a = mk('Aldenmar', [at(50, "Corvale tells the guild, 'a1'"), at(40, "Corvale tells the guild, 'a2'")]);
    const b = mk('Brackwyn', [at(20, "Corvale tells the guild, 'b1'"), at(10, "Corvale tells the guild, 'b2'")]);
    agent.guildFeedTake([L(1, 'guild', 'Rethlan', 'between', NOW - 30 * MIN), L(2, 'guild', 'Rethlan', 'newest', NOW - 5 * MIN), L(3, 'guild', 'Rethlan', 'oldest', NOW - 55 * MIN)], NOW);
    const r = await HIST({}, [{ character: 'Aldenmar', file: a }, { character: 'Brackwyn', file: b }]);
    expect(texts(r).filter(x => x[0] !== '[')).toEqual(['oldest', 'a1', 'a2', 'between', 'b1', 'b2', 'newest']);
    const sep = r.lines.findIndex(l => l.sep);
    expect(sep).toBeGreaterThan(-1);
    expect(r.lines[sep].text).toMatch(/^Swapped to Brackwyn/);
    expect(r.lines[sep + 1].text).toBe('b1');          // the swap line still sits right before the character's first line
    expect(r.lines[sep - 1].text).toBe('between');
  });
  it('cap rule: local lines keep their 3000 and relayed lines their own 300, so relayed never crowd out local', async () => {
    const many = [];
    for (let i = 0; i < agent.CHAT_HISTORY_MAX + 5; i++) many.push(at(120 - i / 60, `Corvale tells the guild, 'local ${i}'`));
    const f = mk('Aldenmar', many);
    const relayed = [];
    for (let i = 0; i < agent.CHAT_GUILD_RING_MAX + 20; i++) relayed.push(L(i + 1, 'raid', 'Rethlan', 'relayed ' + i, NOW - (200 - i / 3) * MIN));
    agent.guildFeedTake(relayed, NOW);
    expect(agent._guildLateRingForTest()).toHaveLength(agent.CHAT_GUILD_RING_MAX);
    const r = await HIST({ hours: 24 }, [{ character: 'Aldenmar', file: f }]);
    expect(r.lines.filter(l => !l.via && !l.sep)).toHaveLength(agent.CHAT_HISTORY_MAX);
    expect(r.lines.filter(l => l.via)).toHaveLength(agent.CHAT_GUILD_RING_MAX);
    expect(r.truncated).toBe(true);
    expect(r.lines.some(l => l.text === 'relayed 319')).toBe(true);    // the newest relayed line is kept
    expect(r.lines.some(l => l.text === 'relayed 0')).toBe(false);     // the oldest went
  });
});

describe('the overlay is told, and survives a restart', () => {
  it('/api/chat carries a `backlog` counter that moves when late lines arrive or are cleared, not for live lines', async () => {
    const g0 = backlog();
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'live one', NOW - 1_000)], NOW);
    expect(backlog()).toBe(g0);
    agent.guildFeedTake([L(2, 'guild', 'Corvale', 'late one', NOW - 30 * MIN)], NOW);
    const g1 = backlog();
    expect(g1).not.toBe(g0);
    agent.guildFeedTake([L(2, 'guild', 'Corvale', 'late one', NOW - 30 * MIN)], NOW);   // a replay changes nothing held
    expect(backlog()).toBe(g1);
    agent.guildFeedClear();   // the game started
    expect(backlog()).not.toBe(g1);
    expect(texts(await HIST())).toEqual([]);
  });
  it('the game starting clears the backlog with the live ring (local lines take over)', async () => {
    agent.setChatPolicy({ away: true }, NOW);
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'late one', NOW - 30 * MIN)], NOW);
    agent._setZealStateForTest('Aldenmar', { updatedAt: NOW - 1_000, zone: 164, loc: { x: 1, y: 2, z: 0 } });
    try { expect(await agent._pollGuildFeed(NOW, async () => { throw new Error('no call expected'); })).toBe('in-game'); }
    finally { agent._setZealStateForTest('Aldenmar', null); }
    expect(agent._guildLateRingForTest()).toHaveLength(0);
  });
  it('the Chat cache keeps the backlog across a restart, and only while Away is on', async () => {
    agent.setChatPolicy({ away: true }, NOW);
    agent.guildFeedTake([L(1, 'guild', 'Corvale', 'late one', NOW - 30 * MIN), L(2, 'raid', 'Rethlan', 'live one', NOW - 1_000)], NOW);
    const o = { maxAgeMs: 24 * 60 * MIN, perRingMax: 200 };
    const snap = JSON.parse(JSON.stringify(agent.chatCacheSnapshot(NOW, o)));
    expect(snap.rings.guildlate.map(l => l.text)).toEqual(['late one']);
    agent.setChatPolicy({ away: false }, NOW + 1_000);
    expect(agent.chatCacheSnapshot(NOW + 1_000, o).rings.guildlate).toEqual([]);   // Away off: the relayed lines never reach the file
    agent._resetLocalChatForTest();
    expect(agent.chatCacheRestore(snap, NOW, o)).toBe(2);
    expect(texts(await HIST())).toEqual(['late one']);
  });
});

describe('the overlay re-reads its history when the backlog moves', () => {
  it('the history request carries the Away switch and the poll watches `backlog`', () => {
    const q = SCRIPT.slice(SCRIPT.indexOf('function histQuery'), SCRIPT.indexOf('async function loadHistory'));
    expect(q).toMatch(/'&away=' \+ \(_prefs\.away \? 1 : 0\)/);
    expect(SCRIPT).toMatch(/Number\(s\.backlog\)/);
    expect(SCRIPT).toMatch(/bk !== _backlogGen[^\n]*loadHistory\(true\)/);
  });
  it('a quiet re-read keeps the history on screen until the new answer is in', () => {
    expect(SCRIPT).toMatch(/var keep = quiet === true && _histInfo && !_histInfo\.loading && !_histInfo\.failed;/);
    expect(SCRIPT).toMatch(/if \(!keep\) \{ _histInfo = \{ loading: true \}; repaint\(\); \}/);
  });
  it('relayed history shows only with Away on, and a local copy on screen wins over it', () => {
    expect(SCRIPT).toMatch(/if \(hl\.via && \(!_prefs\.away \|\| heardLocally\(hl, localH\)\)\) continue;/);
  });
  it('the agent builds relayed history from the late ring only', () => {
    expect(stripJs(AGENT_SRC)).toMatch(/if \(policy\.away && _guildLateRing\.length\)/);
  });
});

// Mutation checks run when this file was written (each reverted):
//   1. removing `seen.has(e.k) ||` from the relayed filter in buildChatHistory: "equal to a local-log line appears once" fails.
//   2. `if (isLate) { _guildLateRing.push(e); late++; } else {...}` -> always the live ring: the first describe fails.
