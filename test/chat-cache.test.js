// test/chat-cache.test.js: the Chat overlay's encrypted on-disk cache (the guild lead, 2026-10-17: "cache the filled in chat
// overlay data encrypted locally and invalidate it on logout if a fresh session isn't established within a reasonable
// timeframe, and wipe before revoking access").
//
// Two halves. The AGENT (packages/wolfpack-logsync/index.js, "Chat cache") owns the file, the cipher, the caps and the
// wipes. MIMIC (apps/mimic/main.js, "Chat cache") owns the key, the session and the logout window; its block is run here
// against fakes, so what is asserted is the shipped code. Text assertions strip comments first (CLAUDE.md: comments satisfy
// text assertions), and each negative assertion was mutation-checked (notes at the bottom).
//
// Run: npx vitest run test/chat-cache.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const AGENT_SRC = readSource(AGENT_INDEX);
const MAIN_SRC = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const AGENT_CODE = stripJs(AGENT_SRC);
const MAIN_CODE = stripJs(MAIN_SRC);

const KEY = 'a1'.repeat(32);
const KEY2 = 'b2'.repeat(32);
const KEYBUF = Buffer.from(KEY, 'hex');
const TS = '[Wed Oct 14 21:10:01 2026]';
const ME = 'Aldenmar';
const T0 = agent.parseEqTimestamp(`${TS} x`).getTime() + 1_000;
const HOUR = 3_600_000;
const BASE = 'https://bot.example/api/agent';

let dir, file;
const feed = (s, now = T0) => agent.noteLocalChatLine(`${TS} ${s}`, ME, now);
const readCache = () => agent.chatCacheOpen(fs.readFileSync(file), KEYBUF);
const textsIn = (p) => Object.values(p.snap.rings).flat().map(l => l.text);
const served = (q = {}, now = T0) => agent.serializeLocalChat(q, now).lines.map(l => l.text);
const enable = (o = {}) => agent.chatCacheConfigure({ key: KEY, id: '111', file, ...o });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-chat-cache-'));
  file = path.join(dir, 'cache.bin');
  agent._resetLocalChatForTest();
  enable();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  agent.chatCacheConfigure({});          // first: clears any pending write timer
  agent._resetLocalChatForTest();
  agent._applyControlPlane({ agent_kill: 0, min_agent_ver_num: 0 }, 'test');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 1. The cipher ───────────────────────────────────────────────────────────────────────────────
describe('the file is AES-256-GCM, sealed under the key, never plaintext', () => {
  const obj = { v: 1, id: '111', snap: { rings: { chat: [{ seq: 1, text: 'pull in five, secret words' }] } } };
  it('round-trips, and the ciphertext does not contain the text', () => {
    const buf = agent.chatCacheSeal(obj, KEYBUF);
    expect(buf.includes(Buffer.from('secret words'))).toBe(false);
    expect(buf.includes(Buffer.from('"chat"'))).toBe(false);
    expect(agent.chatCacheOpen(buf, KEYBUF)).toEqual(obj);
  });
  it('a fresh random 96-bit IV per write, so the same object never seals to the same bytes', () => {
    const a = agent.chatCacheSeal(obj, KEYBUF), b = agent.chatCacheSeal(obj, KEYBUF);
    const m = 5;   // the magic
    expect(a.subarray(m, m + 12).equals(b.subarray(m, m + 12))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });
  it('a wrong key opens nothing', () => {
    expect(agent.chatCacheOpen(agent.chatCacheSeal(obj, KEYBUF), Buffer.from(KEY2, 'hex'))).toBeNull();
  });
  it('a flipped byte anywhere (magic, IV, tag, ciphertext), a truncation or garbage opens nothing', () => {
    const buf = agent.chatCacheSeal(obj, KEYBUF);
    for (const at of [0, 6, 20, 40, buf.length - 1]) {
      const bad = Buffer.from(buf); bad[at] ^= 0x01;
      expect(agent.chatCacheOpen(bad, KEYBUF), 'byte ' + at).toBeNull();
    }
    expect(agent.chatCacheOpen(buf.subarray(0, buf.length - 3), KEYBUF)).toBeNull();
    expect(agent.chatCacheOpen(Buffer.from('not a cache'), KEYBUF)).toBeNull();
    expect(agent.chatCacheOpen(buf, null)).toBeNull();
  });
  it('the source says what it does: aes-256-gcm, a random 12-byte IV, an auth tag, the magic as AAD', () => {
    expect(AGENT_CODE).toMatch(/createCipheriv\('aes-256-gcm'/);
    expect(AGENT_CODE).toMatch(/createDecipheriv\('aes-256-gcm'/);
    expect(AGENT_CODE).toMatch(/const iv = crypto\.randomBytes\(12\)/);
    expect(AGENT_CODE).toMatch(/getAuthTag\(\)/);
    expect(AGENT_CODE).toMatch(/setAuthTag\(/);
  });
});

// ── 2. A bad file is deleted, not trusted ───────────────────────────────────────────────────────
describe('a wrong key, a tampered file or another identity: load returns false and deletes the file', () => {
  const seal = (obj, key = KEYBUF) => agent.chatCacheSeal(obj, key);
  const good = (id = '111') => ({ v: 1, id, savedAt: T0, guild: { cursor: 0, boot: '' }, snap: { seq: 1, policy: {}, rings: { chat: [{ seq: 1, k: 'k', t: T0, ch: 'guild', who: 'Corvale', text: 'hello', self: false, npc: false, on: ME }] } } });
  it('a good file loads and the line is served', () => {
    fs.writeFileSync(file, seal(good()));
    expect(agent.chatCacheLoad(T0)).toBe(true);
    expect(served()).toEqual(['hello']);
  });
  it('sealed under another key', () => {
    fs.writeFileSync(file, seal(good(), Buffer.from(KEY2, 'hex')));
    expect(agent.chatCacheLoad(T0)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(served()).toEqual([]);
  });
  it('tampered', () => {
    const buf = Buffer.from(seal(good())); buf[buf.length - 5] ^= 0xff;
    fs.writeFileSync(file, buf);
    expect(agent.chatCacheLoad(T0)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('saved for a different Discord identity', () => {
    fs.writeFileSync(file, seal(good('222')));
    expect(agent.chatCacheLoad(T0)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(served()).toEqual([]);
  });
  it('garbage, an unknown version, an oversized file', () => {
    fs.writeFileSync(file, 'plain text'); expect(agent.chatCacheLoad(T0)).toBe(false); expect(fs.existsSync(file)).toBe(false);
    fs.writeFileSync(file, seal({ ...good(), v: 99 })); expect(agent.chatCacheLoad(T0)).toBe(false); expect(fs.existsSync(file)).toBe(false);
    fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 1)); expect(agent.chatCacheLoad(T0)).toBe(false); expect(fs.existsSync(file)).toBe(false);
  });
  it('no file yet is just the first start', () => {
    expect(agent.chatCacheLoad(T0)).toBe(false);
  });
  it('a saved line is trusted no further than its shape: junk lines, unknown channels and stale lines are dropped', () => {
    const p = good();
    p.snap.rings.chat.push({ seq: 2, t: T0, ch: 'nonsense', who: 'x', text: 'bad channel' }, { seq: 3, t: 'x', ch: 'guild', text: 'bad time' },
      { seq: 4, t: T0 - 25 * HOUR, ch: 'guild', who: 'x', text: 'too old' }, null, 7, { seq: -1, t: T0, ch: 'guild', text: 'bad seq' });
    fs.writeFileSync(file, seal(p));
    agent.chatCacheLoad(T0);
    expect(served()).toEqual(['hello']);
  });
});

// ── 3. No key, no file ──────────────────────────────────────────────────────────────────────────
describe('without a key (or an identity) nothing is ever written', () => {
  for (const [label, cfg] of [['no key', { key: undefined }], ['a malformed key', { key: 'zz'.repeat(32) }], ['a short key', { key: 'ab' }],
    ['no identity (signed out)', { id: '' }], ['neither', { key: undefined, id: '' }]]) {
    it(label, () => {
      vi.useFakeTimers(); vi.setSystemTime(T0);
      enable(cfg);
      expect(agent.chatCacheEnabled()).toBe(false);
      feed('Corvale tells the guild, \'one\'');
      expect(agent.chatCacheSave(T0)).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  }
  it('the agent reads the key and identity only from the two env vars Mimic sets', () => {
    expect(AGENT_CODE).toMatch(/key: process\.env\.WOLFPACK_CHAT_CACHE_KEY, id: process\.env\.WOLFPACK_CHAT_CACHE_ID/);
  });
  it('a saved file holds no readable chat', () => {
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'pull the dragon now\'');
    expect(agent.chatCacheSave(T0)).toBe(true);
    const raw = fs.readFileSync(file).toString('latin1');
    expect(raw).not.toContain('pull the dragon');
    expect(raw).not.toContain('Corvale');
    expect(textsIn(readCache())).toEqual(['pull the dragon now']);
  });
});

// ── 4. What it keeps: the overlay's own filters, and the caps ───────────────────────────────────
describe('only what the overlay could show now is cached', () => {
  const ALL = {
    guild: 'Corvale tells the guild, \'g-line\'', officer: 'Rethlan tells Wolfpackofficer:5, \'o-line\'', tell: 'Corvale tells you, \'t-line\'',
    group: 'Brackwyn tells the group, \'p-line\'', custom: 'Zarrin tells General:2, \'c-line\'',
  };
  const feedAll = () => { for (const s of Object.values(ALL)) feed(s); };
  it('officer chat while Officer is off, tells while Tells is off, group and custom likewise: not in the file', () => {
    agent.setChatPolicy({ officer: true, tells: true, group: true, custom: true }, T0);
    feedAll();
    agent.setChatPolicy({}, T0 + 1_000);                       // the overlay switches them all off
    expect(agent.chatCacheSave(T0)).toBe(true);
    expect(textsIn(readCache())).toEqual(['g-line']);
    expect(fs.readFileSync(file).toString('latin1')).not.toContain('o-line');
  });
  it('and each one comes back the moment its switch is on', () => {
    agent.setChatPolicy({ officer: true, tells: true, group: true, custom: true }, T0);
    feedAll();
    expect(agent.chatCacheSave(T0)).toBe(true);
    expect(textsIn(readCache()).sort()).toEqual(['c-line', 'g-line', 'o-line', 'p-line', 't-line']);
    agent.setChatPolicy({ officer: true }, T0);
    agent.chatCacheSave(T0);
    expect(textsIn(readCache()).sort()).toEqual(['g-line', 'o-line']);
  });
  it('after a restart the switches it was saved under still hold until the overlay asks again', () => {
    agent.setChatPolicy({ officer: true }, T0);
    feed(ALL.officer); feed(ALL.guild);
    agent.chatCacheSave(T0);
    agent._resetLocalChatForTest(); enable();                   // a new process: no policy asked yet
    expect(agent.chatCacheLoad(T0)).toBe(true);
    agent.chatCacheSave(T0);                                    // nothing asked, so the saved switches apply: the officer line is not lost
    expect(textsIn(readCache()).sort()).toEqual(['g-line', 'o-line']);
    agent.setChatPolicy({}, T0);                                // the overlay asks with Officer off: it goes
    agent.chatCacheSave(T0);
    expect(textsIn(readCache())).toEqual(['g-line']);
  });
  it('the relayed guild feed is cached only while Away is on', () => {
    agent.setChatPolicy({ away: true }, T0);
    agent.guildFeedTake([{ seq: 1, t: T0, ch: 'guild', who: 'Corvale', text: 'relayed' }], T0);
    agent.chatCacheSave(T0);
    expect(textsIn(readCache())).toEqual(['relayed']);
    agent.setChatPolicy({ away: false }, T0);
    agent.chatCacheSave(T0);
    expect(textsIn(readCache())).toEqual([]);
  });
  it('a line only reaches the file through the switch-aware snapshot (the file writer never reads a ring itself)', () => {
    const save = AGENT_CODE.slice(AGENT_CODE.indexOf('function chatCacheSave'), AGENT_CODE.indexOf('function _chatCacheMarkDirty'));
    expect(save).toMatch(/chatCacheSnapshot\(/);
    expect(save).not.toMatch(/_chatRing|_guildFeedRing|_meleeRing/);
    const snap = AGENT_CODE.slice(AGENT_CODE.indexOf('function chatCacheSnapshot'), AGENT_CODE.indexOf('function _chatCacheStr'));
    expect(snap).toMatch(/chatChannelAllowed\(l\.ch, policy\)/);
    expect(snap).toMatch(/policy\.away/);
  });
});

describe('the caps', () => {
  const guilds = (n, t = T0, pad = '') => Array.from({ length: n }, (_, i) => ({ seq: i + 1, t, ch: 'guild', who: 'Corvale', text: 'line ' + String(i).padStart(4, '0') + pad }));
  it('the newest CHAT_CACHE_PER_RING_MAX lines per ring', () => {
    agent.setChatPolicy({ away: true }, T0);
    for (let i = 0; i < 260; i++) feed(`Corvale tells the guild, 'n${String(i).padStart(3, '0')}'`);
    agent.chatCacheSave(T0);
    const t = readCache().snap.rings.chat.map(l => l.text);
    expect(agent.CHAT_CACHE_PER_RING_MAX).toBe(200);
    expect(t).toHaveLength(200);
    expect(t[0]).toBe('n060');
    expect(t[199]).toBe('n259');
  });
  it('nothing older than CHAT_CACHE_MAX_AGE_MS, on the way out and on the way back in', () => {
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'old\'');
    expect(agent.chatCacheSave(T0 + 25 * HOUR)).toBe(true);
    expect(textsIn(readCache())).toEqual([]);
    agent.chatCacheSave(T0 + 23 * HOUR);
    expect(textsIn(readCache())).toEqual(['old']);
    agent._resetLocalChatForTest(); enable();
    agent.chatCacheLoad(T0 + 25 * HOUR);
    expect(served()).toEqual([]);
  });
  it('the plain JSON is trimmed to CHAT_CACHE_MAX_BYTES, oldest lines first, and the file stays a few hundred KB at most', () => {
    expect(agent.CHAT_CACHE_MAX_BYTES).toBeLessThanOrEqual(512 * 1024);
    const big = 'x'.repeat(600);
    const rings = { chat: guilds(200, T0, big), guild: guilds(200, T0, big).map(l => ({ ...l, seq: l.seq + 1000 })), melee: guilds(200, T0, big).map(l => ({ ...l, seq: l.seq + 2000 })) };
    expect(JSON.stringify({ rings }).length).toBeGreaterThan(agent.CHAT_CACHE_MAX_BYTES);
    const snap = agent._chatCacheTrim({ rings }, agent.CHAT_CACHE_MAX_BYTES);
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(agent.CHAT_CACHE_MAX_BYTES);
    expect(snap.rings.chat.length + snap.rings.guild.length + snap.rings.melee.length).toBeGreaterThan(100);   // it trims, it does not empty
    expect(snap.rings.melee[snap.rings.melee.length - 1].seq).toBe(2200);                                          // the newest survives
    expect(snap.rings.chat.length).toBeLessThan(200);                                                              // the oldest went
  });
  it('an on-disk file respects it', () => {
    agent.setChatPolicy({}, T0);
    for (let i = 0; i < 300; i++) feed(`Corvale tells the guild, '${'y'.repeat(300)}${i}'`);
    agent.chatCacheSave(T0);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(agent.CHAT_CACHE_MAX_BYTES + 2048);
  });
});

// ── 5. Restart: the feed is back at once ───────────────────────────────────────────────────────
describe('a restart shows the cached feed straight away', () => {
  it('chat, the sequence counter and the guild feed cursor come back', async () => {
    agent.setChatPolicy({ away: true }, T0);
    feed('Corvale tells the guild, \'before the restart\'');
    agent.guildFeedTake([{ seq: 7, t: T0, ch: 'raid', who: 'Rethlan', text: 'relayed raid' }], T0);
    agent.chatCacheSave(T0);
    const top = agent.serializeLocalChat({ away: true }, T0).seq;
    agent._resetLocalChatForTest(); agent._guildFeedResetForTest(); enable();   // a new process
    expect(served({ away: true })).toEqual([]);
    expect(agent.chatCacheLoad(T0)).toBe(true);
    expect(served({ away: true })).toEqual(['before the restart', 'relayed raid']);
    expect(agent.serializeLocalChat({ away: true }, T0).seq).toBe(top);
    feed('Corvale tells the guild, \'after\'');
    expect(agent.serializeLocalChat({ away: true }, T0).seq).toBeGreaterThan(top);
  });
  it('the guild poll resumes from the saved cursor instead of asking for the whole backlog again', async () => {
    process.env.WOLFPACK_BOT_URL = BASE + '/encounter'; process.env.WOLFPACK_AGENT_TOKEN = 'tok-1';
    agent._setUploadOptsForTest({ botUrl: BASE + '/encounter', token: 'tok-1' });
    try {
      agent.setChatPolicy({ away: true }, T0);
      const ok = (lines) => ({ status: 200, ok: true, json: async () => ({ ok: true, boot: 'b1', seq: 9, lines }) });
      await agent._pollGuildFeed(T0, async () => ok([{ seq: 9, t: T0, ch: 'guild', who: 'Corvale', text: 'x' }]));
      agent.chatCacheSave(T0);
      agent._resetLocalChatForTest(); agent._guildFeedResetForTest(); enable();
      agent.chatCacheLoad(T0);
      agent.setChatPolicy({ away: true }, T0);
      const urls = [];
      await agent._pollGuildFeed(T0 + 5_000, async (u) => { urls.push(u); return ok([]); });
      expect(urls).toEqual([BASE + '/guild-chat?since=9&boot=b1']);
    } finally {
      delete process.env.WOLFPACK_BOT_URL; delete process.env.WOLFPACK_AGENT_TOKEN; agent._setUploadOptsForTest(null);
    }
  });
});

// ── 6. Writes: coalesced, atomic, flushed at exit ──────────────────────────────────────────────
describe('writes are coalesced and atomic', () => {
  it('fifty lines make one write, CHAT_CACHE_WRITE_MS after the first, through a .tmp and a rename', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    enable();
    const wr = vi.spyOn(fs, 'writeFileSync'), rn = vi.spyOn(fs, 'renameSync');
    for (let i = 0; i < 50; i++) feed(`Corvale tells the guild, 'burst ${i}'`);
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(agent.CHAT_CACHE_WRITE_MS - 1);
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(fs.existsSync(file)).toBe(true);
    expect(rn).toHaveBeenCalledTimes(1);
    expect(wr.mock.calls.filter(c => String(c[0]) === file + '.tmp')).toHaveLength(1);
    expect(rn.mock.calls[0]).toEqual([file + '.tmp', file]);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    expect(readCache().snap.rings.chat).toHaveLength(50);
    feed('Corvale tells the guild, \'later\'');
    vi.advanceTimersByTime(agent.CHAT_CACHE_WRITE_MS + 1);
    expect(rn).toHaveBeenCalledTimes(2);
  });
  it('a write that cannot complete leaves no .tmp and the old file untouched', () => {
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'kept\'');
    agent.chatCacheSave(T0);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EBUSY'); });
    feed('Corvale tells the guild, \'new\'');
    expect(agent.chatCacheSave(T0)).toBe(false);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    vi.restoreAllMocks();
    expect(textsIn(readCache())).toEqual(['kept']);
  });
  it('a clean exit flushes what is pending', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    enable();
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'last words\'');
    expect(fs.existsSync(file)).toBe(false);
    const onExit = process.listeners('exit').find(f => String(f).includes('chatCacheSave'));
    expect(onExit).toBeTypeOf('function');
    onExit();
    expect(textsIn(readCache())).toEqual(['last words']);
  });
  it('a stood-down agent writes nothing, and writes again when it resumes (the key is still good)', () => {
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'one\'');
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    expect(agent.chatCacheSave(T0)).toBe(false);
    agent._applyControlPlane({ agent_kill: 0 }, 'test');
    feed('Corvale tells the guild, \'two\'');
    expect(agent.chatCacheSave(T0)).toBe(true);
    expect(textsIn(readCache())).toEqual(['one', 'two']);   // the stand-down wiped the file, not the live ring, so 'one' survives
  });
});

// ── 7. Wipe before revoke ──────────────────────────────────────────────────────────────────────
describe('a definite 401 wipes the cache, a transient failure does not', () => {
  function gates() {
    process.env.WOLFPACK_BOT_URL = BASE + '/encounter'; process.env.WOLFPACK_AGENT_TOKEN = 'tok-1';
    agent._setUploadOptsForTest({ botUrl: BASE + '/encounter', token: 'tok-1' });
    agent._setZealStateForTest(ME, null);
    agent._guildFeedResetForTest();          // a back-off left by the last case would answer 'backoff' without asking (and prove nothing)
    agent.setChatPolicy({ away: true }, T0);
  }
  afterEach(() => { delete process.env.WOLFPACK_BOT_URL; delete process.env.WOLFPACK_AGENT_TOKEN; agent._setUploadOptsForTest(null); });
  const reply = (status) => { const f = async () => { f.n++; return { status, ok: status < 400, json: async () => ({ ok: true, lines: [] }) }; }; f.n = 0; return f; };
  function filled() {
    gates();
    feed('Corvale tells the guild, \'held\'');
    agent.guildFeedTake([{ seq: 1, t: T0, ch: 'guild', who: 'Corvale', text: 'relayed' }], T0);
    expect(agent.chatCacheSave(T0)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  }
  it('401: the file is deleted, the rings and the overlay copy are emptied, and nothing is written again', async () => {
    filled();
    const boot = agent.serializeLocalChat({ away: true }, T0).boot;
    const f = reply(401);
    expect(await agent._pollGuildFeed(T0 + 5_000, f)).toBe('unauthorized');
    expect(f.n).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    const after = agent.serializeLocalChat({ away: true }, T0);
    expect(after.lines).toEqual([]);
    expect(after.boot).not.toBe(boot);          // the overlay starts over
    expect(after.wiped).toBeGreaterThan(0);     // ... and clears the history it read back
    feed('Corvale tells the guild, \'after\'');
    expect(agent.chatCacheSave(T0)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(agent.chatCacheRevoke('again')).toBe(false);
  });
  it('the line Mimic reads to drop the key is printed, and only for a revoke', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent.chatCacheWipe('kill');
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/\[chat-cache\] revoked/);
    agent.chatCacheRevoke('guild-chat answered 401');
    expect(log).toHaveBeenCalledWith('[chat-cache] revoked (guild-chat answered 401)');
  });
  for (const [label, status] of [['a 500', 500], ['the 503 the bot sends for an auth-store blip', 503], ['a 429', 429], ['a 403', 403], ['a 404 (an old bot)', 404]]) {
    it(`${label} is not a revoke`, async () => {
      filled();
      const f = reply(status);
      await agent._pollGuildFeed(T0 + 5_000, f);
      expect(f.n).toBe(1);                       // the bot really was asked
      expect(fs.existsSync(file)).toBe(true);
      expect(served({ away: true })).toContain('held');
      expect(agent.chatCacheEnabled()).toBe(true);
    });
  }
  it('a dead network is not a revoke', async () => {
    filled();
    expect(await agent._pollGuildFeed(T0 + 5_000, async () => { throw new Error('ECONNRESET'); })).toBe('error');
    expect(fs.existsSync(file)).toBe(true);
    expect(agent.chatCacheEnabled()).toBe(true);
  });
  it('the reporter heartbeat and the upload queue wipe on exactly a 401, before they react to it', () => {
    const hb = AGENT_CODE.slice(AGENT_CODE.indexOf('function _reporterHeartbeatOnce'), AGENT_CODE.indexOf('const NTP_SERVERS'));
    expect(hb).toMatch(/if \(res\.statusCode === 401\) chatCacheRevoke\(/);
    expect(hb.indexOf('chatCacheRevoke(')).toBeLessThan(hb.indexOf('_reporterFailOpen(); return;'));
    const up = AGENT_CODE.slice(AGENT_CODE.indexOf('function _doOneUpload'), AGENT_CODE.indexOf('function _onUploadSuccess'));
    expect(up).toMatch(/if \(sc === 401\) chatCacheRevoke\(/);
    expect(up.indexOf('chatCacheRevoke(')).toBeLessThan(up.indexOf('resolve({ ok: true'));
    expect(up.match(/chatCacheRevoke\(/g)).toHaveLength(1);
    expect(hb.match(/chatCacheRevoke\(/g)).toHaveLength(1);
  });
});

describe('the cache is gone at the moment access changes', () => {
  function filled() {
    agent.setChatPolicy({}, T0);
    feed('Corvale tells the guild, \'held\'');
    agent.chatCacheSave(T0);
    expect(fs.existsSync(file)).toBe(true);
  }
  it('the fleet kill switch: the file is gone when the stand-down is announced, but the live overlay is NOT blanked', () => {
    // The guild lead, 2026-10-17: overlays keep working on local data during a pause, so only the on-disk copy goes.
    filled();
    const seenAtAnnounce = [];
    vi.spyOn(console, 'log').mockImplementation((m) => { if (/flag_agent_kill/.test(String(m))) seenAtAnnounce.push(fs.existsSync(file)); });
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    expect(seenAtAnnounce).toEqual([false]);
    expect(served()).toEqual(['held']);        // the live feed stays; only the file was wiped
  });
  it('a version floor above this agent wipes the file too (feed kept); a floor it meets does not', () => {
    filled();
    agent._applyControlPlane({ min_agent_ver_num: 1 }, 'test');
    expect(fs.existsSync(file)).toBe(true);
    agent._applyControlPlane({ min_agent_ver_num: 99999999 }, 'test');
    expect(fs.existsSync(file)).toBe(false);
    expect(served()).toEqual(['held']);        // overlay untouched by the floor
  });
  it('a kill reading repeated every 20 s wipes the file once, on the way in; the live feed is left alone', () => {
    filled();
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    feed('Corvale tells the guild, \'after\'');
    agent._applyControlPlane({ agent_kill: 1 }, 'test');
    expect(served()).toEqual(['held', 'after']);   // both kept; the file-only wipe never touches the rings
  });
  it('the order in the source: the file wipe comes before the reading is adopted, and it is file-only', () => {
    const fn = AGENT_CODE.slice(AGENT_CODE.indexOf('function _applyControlPlane'), AGENT_CODE.indexOf('function _controlStandDown'));
    expect(fn).toMatch(/chatCacheWipeFileOnly\(/);
    expect(fn).not.toMatch(/[^y]chatCacheWipe\(/);   // NOT the full wipe (which would blank the overlay)
    expect(fn.indexOf('chatCacheWipeFileOnly(')).toBeLessThan(fn.indexOf('_controlPlane = {'));
  });
  it('a session push from a different identity wipes before the token is taken, and turns the cache off', () => {
    filled();
    agent.chatCacheOnSessionPush('wpms_x', { discord_id: '111' });     // the same person
    agent.chatCacheOnSessionPush('', null);                            // a sign-out push is a logout, not a revoke
    agent.chatCacheOnSessionPush('wpms_x', null);                      // no identity to compare
    expect(fs.existsSync(file)).toBe(true);
    agent.chatCacheOnSessionPush('wpms_y', { discord_id: '222' });
    expect(fs.existsSync(file)).toBe(false);
    expect(served()).toEqual([]);
    expect(agent.chatCacheEnabled()).toBe(false);
    feed('Corvale tells the guild, \'for the new person\'');
    expect(agent.chatCacheSave(T0)).toBe(false);
  });
  it('and in the handler that takes the token the call comes first', () => {
    const h = AGENT_CODE.slice(AGENT_CODE.indexOf("req.url === '/api/mimic-session'"), AGENT_CODE.indexOf("req.url === '/api/loadouts/hide'"));
    expect(h).toMatch(/chatCacheOnSessionPush\(token, payload\?\.identity\)/);
    expect(h.indexOf('chatCacheOnSessionPush(')).toBeLessThan(h.indexOf('_mimicSessionToken = token'));
    expect(h.indexOf('chatCacheOnSessionPush(')).toBeLessThan(h.indexOf('_mimicIdentity     ='));
  });
});

// ── 8. Mimic: the key, the identity, the logout window ─────────────────────────────────────────
const MIMIC_BLOCK = sliceBlock(MAIN_SRC, 'const CHAT_CACHE_GRACE_MS', '// ── end Chat cache ──');
const AGENT_DIR_FAKE = path.join(path.sep, 'agent');
const CACHE_PATH = path.join(AGENT_DIR_FAKE, 'logsync.chat-cache.bin');

// The shipped block, run against a fake config store, file set and keychain; `log` records the order things happen in.
function mimic({ cfg = {}, files = [CACHE_PATH], keychain = true } = {}) {
  const st = { cfg: JSON.parse(JSON.stringify(cfg)), files: new Set(files), log: [], atSave: [] };
  const fakeFs = { unlinkSync: (f) => { if (!st.files.delete(f)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } st.log.push('unlink'); } };
  const safeStorage = {
    isEncryptionAvailable: () => keychain,
    encryptString: (s) => Buffer.from('ENC:' + s),
    decryptString: (b) => { const s = b.toString(); if (!s.startsWith('ENC:')) throw new Error('bad'); return s.slice(4); },
  };
  const api = new Function('path', 'fs', 'loadConfig', 'saveConfig', 'AGENT_DIR', 'resolveUploadToken', 'safeStorage', 'appendAgentLog', 'require',
    MIMIC_BLOCK + '\nreturn { _chatCacheDecide, _chatCacheEnv, _chatCacheOnLogout, _chatCacheMaintain, _chatCacheWipeAll, _chatCacheIdentity, CHAT_CACHE_GRACE_MS };')(
    path, fakeFs, () => JSON.parse(JSON.stringify(st.cfg)),
    (c) => { st.log.push('save'); st.atSave.push({ fileThere: st.files.has(CACHE_PATH), keyBox: !!(c.chatCache && c.chatCache.keyBox) }); st.cfg = JSON.parse(JSON.stringify(c)); },
    () => AGENT_DIR_FAKE, (c) => (c.session && c.session.tokenBox ? 'tok' : null), safeStorage, () => {}, require);
  return { st, api };
}
const signedIn = (id) => ({ session: { tokenBox: { enc: 'x' }, identity: { discord_id: id } } });
const GRACE = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe('Mimic: the logout window decides', () => {
  const { api } = mimic();
  it('the window is a named constant, 24 hours (the cache keeps no more than 24 hours of lines anyway)', () => {
    expect(api.CHAT_CACHE_GRACE_MS).toBe(GRACE);
    expect(MAIN_CODE).toMatch(/const CHAT_CACHE_GRACE_MS = 24 \* 60 \* 60 \* 1000;/);
    expect(agent.CHAT_CACHE_MAX_AGE_MS).toBe(GRACE);
  });
  const D = api._chatCacheDecide;
  it('a logout records when it happened and keeps the cache', () => {
    expect(D({ id: '111', outAt: 0 }, '', NOW)).toEqual({ wipe: false, state: { id: '111', outAt: NOW } });
  });
  it('signed out, inside the window: kept, and the first logout time is not pushed back', () => {
    expect(D({ id: '111', outAt: NOW }, '', NOW + GRACE - 1)).toEqual({ wipe: false, state: { id: '111', outAt: NOW } });
  });
  it('signed out past the window: deleted', () => {
    expect(D({ id: '111', outAt: NOW }, '', NOW + GRACE + 1)).toEqual({ wipe: true, state: { id: '', outAt: 0 } });
  });
  it('the SAME identity back inside the window keeps it', () => {
    expect(D({ id: '111', outAt: NOW }, '111', NOW + GRACE - 1)).toEqual({ wipe: false, state: { id: '111', outAt: 0 } });
  });
  it('the same identity back AFTER the window finds it deleted', () => {
    expect(D({ id: '111', outAt: NOW }, '111', NOW + GRACE + 1).wipe).toBe(true);
  });
  it('a DIFFERENT identity wipes at once, inside the window or not, logged out or not', () => {
    expect(D({ id: '111', outAt: NOW }, '222', NOW + 1)).toEqual({ wipe: true, state: { id: '222', outAt: 0 } });
    expect(D({ id: '111', outAt: 0 }, '222', NOW)).toEqual({ wipe: true, state: { id: '222', outAt: 0 } });
  });
  it('a first sign-in has nothing to wipe; no state and no session is nothing', () => {
    expect(D(undefined, '111', NOW)).toEqual({ wipe: false, state: { id: '111', outAt: 0 } });
    expect(D(undefined, '', NOW)).toEqual({ wipe: false, state: { id: '', outAt: 0 } });
  });
});

describe('Mimic: acting on the decision, against a fake config, disk and keychain', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  const keyOf = (env) => env.WOLFPACK_CHAT_CACHE_KEY;
  it('the first launch signed in makes a 32-byte key, stores it only as a keychain box, and hands it over with the identity', () => {
    const { st, api } = mimic({ cfg: signedIn('111'), files: [] });
    const env = api._chatCacheEnv();
    expect(env.WOLFPACK_CHAT_CACHE_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.WOLFPACK_CHAT_CACHE_ID).toBe('111');
    expect(st.cfg.chatCache.keyBox.enc).toBeTruthy();
    expect(JSON.stringify(st.cfg)).not.toContain(keyOf(env));            // never the key in the clear
    expect(Buffer.from(st.cfg.chatCache.keyBox.enc, 'base64')).toBeTruthy();
  });
  it('the same key comes back on the next launch', () => {
    const { api } = mimic({ cfg: signedIn('111'), files: [] });
    expect(keyOf(api._chatCacheEnv())).toBe(keyOf(api._chatCacheEnv()));
  });
  it('no keychain: no key, no env, nothing stored, no plaintext fallback', () => {
    const { st, api } = mimic({ cfg: signedIn('111'), files: [], keychain: false });
    expect(api._chatCacheEnv()).toEqual({});
    expect(JSON.stringify(st.cfg)).not.toMatch(/keyBox|"plain"/);
  });
  it('signed out: the agent is handed no key, so it can neither read nor write', () => {
    const { api } = mimic({ cfg: { chatCache: { id: '111', outAt: NOW - HOUR, keyBox: { enc: Buffer.from('ENC:' + KEY).toString('base64') } } } });
    expect(api._chatCacheEnv()).toEqual({});
  });
  it('the same identity back inside the window: the file stays and the same key opens it', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { ...signedIn('111'), chatCache: { id: '111', outAt: NOW - 23 * HOUR, keyBox: box } } });
    const env = api._chatCacheEnv();
    expect(st.files.has(CACHE_PATH)).toBe(true);
    expect(keyOf(env)).toBe(KEY);
    expect(st.cfg.chatCache.outAt).toBe(0);
  });
  it('a different identity: the file is deleted and a NEW key is made before the agent starts', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { ...signedIn('222'), chatCache: { id: '111', outAt: NOW - HOUR, keyBox: box } } });
    const env = api._chatCacheEnv();
    expect(st.files.has(CACHE_PATH)).toBe(false);
    expect(keyOf(env)).not.toBe(KEY);
    expect(env.WOLFPACK_CHAT_CACHE_ID).toBe('222');
  });
  it('expiry on the timer: no session past the window deletes the file and drops the key', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { chatCache: { id: '111', outAt: NOW - GRACE - 1, keyBox: box } } });
    api._chatCacheMaintain();
    expect(st.files.has(CACHE_PATH)).toBe(false);
    expect(st.cfg.chatCache.keyBox).toBeUndefined();
    expect(st.cfg.chatCache.id).toBe('');
  });
  it('the timer leaves it alone inside the window, and leaves a signed-in session alone', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const a = mimic({ cfg: { chatCache: { id: '111', outAt: NOW - GRACE + HOUR, keyBox: box } } });
    a.api._chatCacheMaintain();
    expect(a.st.files.has(CACHE_PATH)).toBe(true);
    const b = mimic({ cfg: { ...signedIn('111'), chatCache: { id: '111', outAt: 0, keyBox: box } } });
    b.api._chatCacheMaintain();
    expect(b.st.files.has(CACHE_PATH)).toBe(true);
    expect(b.st.log).toEqual([]);                                         // nothing changed, nothing saved
  });
  it('a key the keychain cannot open (another Windows user): the file is dead weight and goes, a new key is made', () => {
    const { st, api } = mimic({ cfg: { ...signedIn('111'), chatCache: { id: '111', outAt: 0, keyBox: { enc: 'AAAA' } } } });
    const env = api._chatCacheEnv();
    expect(st.files.has(CACHE_PATH)).toBe(false);
    expect(keyOf(env)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a chosen local-only install has its own identity, and signing in as someone replaces it', () => {
    expect(mimic({ cfg: { localOnly: true } }).api._chatCacheIdentity({ localOnly: true })).toBe('local');
    expect(mimic().api._chatCacheIdentity({})).toBe('');
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { ...signedIn('111'), chatCache: { id: 'local', outAt: 0, keyBox: box } } });
    api._chatCacheEnv();
    expect(st.files.has(CACHE_PATH)).toBe(false);
  });
  it('logout: the window starts and the file stays', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { chatCache: { id: '111', outAt: 0, keyBox: box } } });
    api._chatCacheOnLogout();
    expect(st.cfg.chatCache.outAt).toBe(NOW);
    expect(st.files.has(CACHE_PATH)).toBe(true);
    expect(st.cfg.chatCache.keyBox).toEqual(box);
  });
  it('revoke / uninstall: the file is deleted BEFORE the key is cleared from the config', () => {
    const box = { enc: Buffer.from('ENC:' + KEY).toString('base64') };
    const { st, api } = mimic({ cfg: { ...signedIn('111'), chatCache: { id: '111', outAt: 0, keyBox: box } } });
    api._chatCacheWipeAll('test');
    expect(st.log).toEqual(['unlink', 'save']);
    expect(st.atSave).toEqual([{ fileThere: false, keyBox: false }]);       // at the moment the key goes, the file is already gone
    expect(st.cfg.chatCache).toEqual({ id: '', outAt: 0 });
  });
});

describe('Mimic: sign-out starts the window before the session is cleared', () => {
  it('_chatCacheOnLogout runs while the session (the token) is still in the config', async () => {
    const seen = [];
    const store = { cfg: { session: { tokenBox: { enc: 'x' }, identity: { discord_id: '111' } }, token: 'legacy' } };
    const body = sliceBlock(MAIN_SRC, 'async function signOutMimic() {', '// ── Chat cache:');
    const { signOutMimic } = new Function('_chatCacheOnLogout', 'loadConfig', 'saveConfig', 'resolveUploadToken', 'pushMimicSession', 'pushStatus', 'appendAgentLog',
      'agentProc', '_httpsJsonPost', '_botBaseUrl', body + '\nreturn { signOutMimic };')(
      () => seen.push({ sessionStillThere: !!store.cfg.session }),
      () => JSON.parse(JSON.stringify(store.cfg)), (c) => { store.cfg = JSON.parse(JSON.stringify(c)); },
      () => 'tok', () => {}, () => {}, () => {}, null, async () => ({ status: 200 }), () => 'https://bot.example');
    await signOutMimic();
    expect(seen).toEqual([{ sessionStillThere: true }]);
    expect(store.cfg.session).toBeUndefined();
  });
  it('and the call is the first thing it does', () => {
    const at = MAIN_CODE.indexOf('async function signOutMimic');
    const fn = MAIN_CODE.slice(at, at + 900);
    expect(fn.indexOf('_chatCacheOnLogout()')).toBeGreaterThan(0);
    expect(fn.indexOf('_chatCacheOnLogout()')).toBeLessThan(fn.indexOf('loadConfig()'));
    expect(fn.indexOf('_chatCacheOnLogout()')).toBeLessThan(fn.indexOf('delete cfg.session'));
  });
});

// ── 9. Mimic: key handling and what reaches the agent (comments stripped) ─────────────────────
describe('Mimic: the key and its hand-over', () => {
  const block = stripJs(MIMIC_BLOCK);
  it('the key is random, 32 bytes, and kept only under the OS keychain: the plaintext fallback of the session token is not used', () => {
    expect(block).toMatch(/randomBytes\(32\)\.toString\('hex'\)/);
    expect(block).toMatch(/safeStorage\.isEncryptionAvailable\(\)/);
    expect(block).toMatch(/safeStorage\.encryptString\(hex\)/);
    expect(block).not.toMatch(/_encryptSecret|_decryptSecret|\bplain\b/);
  });
  it('the env vars are set in one place, and only with a key in hand', () => {
    expect(block.match(/out\.WOLFPACK_CHAT_CACHE_KEY = /g)).toHaveLength(1);
    expect(block).toMatch(/if \(key\) \{ out\.WOLFPACK_CHAT_CACHE_KEY = key; out\.WOLFPACK_CHAT_CACHE_ID = id; \}/);
    expect(block).toMatch(/if \(id\) \{/);
  });
  it('launchAgent drops anything inherited, then adds only what _chatCacheEnv decided, and starts the expiry timer', () => {
    const launch = MAIN_CODE.slice(MAIN_CODE.indexOf('async function launchAgent'), MAIN_CODE.indexOf('agentProc = spawn('));
    expect(launch).toContain('delete env.WOLFPACK_CHAT_CACHE_KEY; delete env.WOLFPACK_CHAT_CACHE_ID;');
    expect(launch).toContain('Object.assign(env, _chatCacheEnv());');
    expect(launch.indexOf('const env = {')).toBeLessThan(launch.indexOf('delete env.WOLFPACK_CHAT_CACHE_KEY'));
    expect(launch.indexOf('delete env.WOLFPACK_CHAT_CACHE_KEY')).toBeLessThan(launch.indexOf('Object.assign(env, _chatCacheEnv())'));
    expect(launch).toMatch(/setInterval\(\(\) => \{ try \{ _chatCacheMaintain\(\); \} catch \(e\) \{ void e; \} \}, CHAT_CACHE_CHECK_MS\)/);
    expect(MAIN_CODE).toMatch(/const CHAT_CACHE_CHECK_MS = 15 \* 60 \* 1000;/);
  });
  it('the key box never goes to a renderer', () => {
    const fn = MAIN_CODE.slice(MAIN_CODE.indexOf('function configForRenderer'), MAIN_CODE.indexOf('function bundledAgentDir'));
    expect(fn).toContain('delete safe.chatCache;');
  });
  it('the agent and Mimic name the same file', () => {
    expect(MAIN_CODE).toContain("'logsync.chat-cache.bin'");
    expect(path.basename(agent.CHAT_CACHE_FILE)).toBe('logsync.chat-cache.bin');
    expect(path.dirname(agent.CHAT_CACHE_FILE)).toBe(path.dirname(AGENT_INDEX));
  });
  it('the line the agent prints on a revoke is the line Mimic matches, and chat text cannot forge it mid-line', () => {
    const rx = /(?:^\[agent\] |\n)\[chat-cache\] revoked \(/;
    expect(MAIN_CODE).toContain(String(rx).slice(1, -1));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent.chatCacheRevoke('guild-chat answered 401');
    const printed = log.mock.calls.filter(c => /revoked/.test(c[0]))[0][0];
    expect(rx.test('[agent] ' + printed + '\n')).toBe(true);
    expect(rx.test('[agent] [chat-cache] wiped (kill)\n')).toBe(false);
    expect(rx.test('[agent] Corvale says, "[chat-cache] revoked (x)"\n')).toBe(false);
  });
  it('the agent\'s revoke hand-off clears the key and the file in Mimic', () => {
    const out = MAIN_CODE.slice(MAIN_CODE.indexOf("agentProc.stdout.on('data'"), MAIN_CODE.indexOf("agentProc.stderr.on('data'"));
    expect(out).toMatch(/_chatCacheWipeAll\('the bot refused this session'\)/);
  });
  it('uninstalling wipes the cache and its key before the uninstaller starts', () => {
    const fn = MAIN_CODE.slice(MAIN_CODE.indexOf('async function runUninstaller'), MAIN_CODE.indexOf('function makeTrayIcon'));
    expect(fn).toMatch(/_chatCacheWipeAll\('uninstall'\)/);
    expect(fn.indexOf("_chatCacheWipeAll('uninstall')")).toBeLessThan(fn.indexOf('spawn(exe'));
  });
});

// ── 10. The privacy guards that were already there still hold ─────────────────────────────────
describe('the cache does not widen what leaves the machine', () => {
  it('the cache block names no upload, queue, tell or network call', () => {
    const code = stripJs(sliceBlock(AGENT_SRC, '// ── Chat cache: the Chat overlay', '// ── end Chat cache ──'));
    expect(code.length).toBeGreaterThan(2000);
    for (const bad of [/\bchatBuffer\b/, /\btellBuffer\b/, /\benqueueUpload\b/, /\bupload[A-Z]\w*\(/, /\b_uploadQueue\b/, /\bfetch\(/, /\bhttps?\.request\b/, /\brecentTells\b/]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
    expect(code.match(/fs\.writeFileSync\(/g)).toHaveLength(1);
    expect(code).toContain("const tmp = _chatCache.file + '.tmp';");
  });
  it('the ring blocks still name no file (the cache seam only copies out and takes back; the history block only reads)', () => {
    for (const [a, b] of [["// ── Local chat window: the feed behind Mimic's Chat overlay", '// ── end Local chat window ──'],
      ['// ── Guild feed while you are out of game', '// ── end Guild feed ──']]) {
      expect(stripJs(sliceBlock(AGENT_SRC, a, b))).not.toMatch(/\bfs\.|\bwriteFile|\bappendFile/);
    }
  });
});

// Mutation notes (2026-10-17). Each of these was broken in the source, this file run (it failed where named), and the break
// restored (the sources were diffed against a pre-mutation copy afterwards):
//   • a constant IV, or a plaintext fallback when there is no key: sections 1 and 3 fail.
//   • load keeping a file sealed for another identity, or not unlinking one it could not open: section 2 fails.
//   • snapshot skipping chatChannelAllowed, or the Away check: the section 4 gate tests fail.
//   • the per-ring cap, the age cut (out, and in on load) or the byte trim removed: the section 4 cap tests fail.
//   • the dirty hook removed from noteLocalChatLine, or a write per line instead of the throttle: section 6 fails.
//   • a revoke on any 4xx instead of exactly 401 (guild poll, upload queue): the "not a revoke" cases and the source checks in section 7 fail.
//   • the reporter-heartbeat hook removed: the section 7 source check fails.
//   • the wipe moved after `_controlPlane = {`, or the session-push call after `_mimicSessionToken = token`: the order assertions fail.
//   • Mimic: a different identity kept, no expiry, _chatCacheWipeAll saving before it unlinks, sign-out recording after the session is
//     cleared, the inherited-env delete removed, a plaintext key fallback, the key box sent to a renderer, the sentinel match loosened,
//     the expiry timer not started, the uninstall wipe moved after the uninstaller: sections 8 and 9 fail.
// Not mutation-testable from here: the 20 s heartbeat and the upload callback sit inside network code with no seam, so those two hooks
// are pinned by source shape and order only.
