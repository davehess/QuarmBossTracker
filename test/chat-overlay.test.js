// test/chat-overlay.test.js: Mimic's Chat overlay (the guild lead, 2026-10-14: "move it off the screen and
// be able to show/hide different components from it, or break it into tabs"; picked "B then A").
//
// B is built: ONE window, ONE scrolling feed, colour-coded by channel, with a chip per channel group.
// A comes later without a rewrite: tabs per group and tear-out windows. So the groups are DATA served by the
// agent (CHAT_GROUPS) and the feed is painted through a filter; no tabs or tear-out exist yet.
//
// The load-bearing promise is PRIVACY: the lines are kept on this PC, in memory, for this window, and never
// uploaded. Everything below that says "never" is a negative assertion; each was mutation-checked
// (see the notes at the bottom of the file).
//
// Run: npx vitest run test/chat-overlay.test.js

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const AGENT_SRC = readSource(AGENT_INDEX);
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const CHAT_HTML = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chat.html'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

const BLOCK_START = '// ── Local chat window: the feed behind Mimic\'s Chat overlay';
const BLOCK_END = '// ── end Local chat window ──';
const CHAT_BLOCK = AGENT_SRC.slice(AGENT_SRC.indexOf(BLOCK_START), AGENT_SRC.indexOf(BLOCK_END) + BLOCK_END.length);

const HISTORY_START = '// ── Chat history: the last N hours of chat';
const HISTORY_END = '// ── end Chat history ──';
const HISTORY_BLOCK = AGENT_SRC.slice(AGENT_SRC.indexOf(HISTORY_START), AGENT_SRC.indexOf(HISTORY_END) + HISTORY_END.length);

const TS = '[Wed Oct 14 21:10:01 2026]';
const L = (s) => `${TS} ${s}`;
const ME = 'Aldenmar';

// ── 1. The classifier: one golden line per channel, in both shapes ───────────────────────────
describe('classifyChatLine: quoted shapes', () => {
  const CASES = [
    ['guild, other',       'Corvale tells the guild, \'pull in five\'',         { ch: 'guild',   who: 'Corvale', text: 'pull in five' }],
    ['guild, self',        'You say to your guild, \'on my way\'',               { ch: 'guild',   who: 'You', self: true, text: 'on my way' }],
    ['guild, self (tell)', 'You tell your guild, \'ok\'',                        { ch: 'guild',   who: 'You', self: true }],
    ['raid, other',        'Rethlan tells the raid, \'CH on Brackwyn\'',         { ch: 'raid',    who: 'Rethlan', text: 'CH on Brackwyn' }],
    ['raid, self',         'You tell your raid, \'ready\'',                      { ch: 'raid',    who: 'You', self: true }],
    ['say, other',         'Zarrin says, \'hello there\'',                       { ch: 'say',     who: 'Zarrin', text: 'hello there' }],
    ['say, self',          'You say, \'Hail, Captain\'',                         { ch: 'say',     who: 'You', self: true }],
    ['ooc, other',         'Zarrin says out of character, \'brb\'',              { ch: 'ooc',     who: 'Zarrin', text: 'brb' }],
    ['ooc, self',          'You say out of character, \'afk\'',                  { ch: 'ooc',     who: 'You', self: true }],
    ['shout, other',       'Nyssara shouts, \'train to zone\'',                  { ch: 'shout',   who: 'Nyssara' }],
    ['shout, self',        'You shout, \'port up\'',                             { ch: 'shout',   who: 'You', self: true }],
    ['auction, other',     'Nyssara auctions, \'WTS Rod of Fury 500pp\'',        { ch: 'auction', who: 'Nyssara' }],
    ['auction, self',      'You auction, \'WTB gems\'',                          { ch: 'auction', who: 'You', self: true }],
    ['tell, incoming',     'Corvale tells you, \'got a minute?\'',               { ch: 'tell',    who: 'Corvale', text: 'got a minute?' }],
    ['tell, outgoing',     'You told Corvale, \'sure\'',                         { ch: 'tell',    who: 'You', self: true, to: 'Corvale' }],
    ['group, other',       'Brackwyn tells the group, \'inc\'',                  { ch: 'group',   who: 'Brackwyn' }],
    ['group, self (party)','You tell your party, \'ok\'',                        { ch: 'group',   who: 'You', self: true }],
    ['group, self (group)','You say to your group, \'ok\'',                      { ch: 'group',   who: 'You', self: true }],
    ['officer channel',    'Rethlan tells Wolfpackofficer:5, \'keep this quiet\'', { ch: 'officer', who: 'Rethlan' }],
    ['officer, self',      'You say to your officer, \'noted\'',                 { ch: 'officer', who: 'You', self: true }],
    ['officer channel, self', 'You say to Wolfpackofficer:5, \'noted\'',         { ch: 'officer', who: 'You', self: true }],
    ['custom channel',     'Zarrin tells General:2, \'anyone for a group\'',     { ch: 'custom',  who: 'Zarrin' }],
    ['custom channel, self','You say to Ports:4, \'Ro port?\'',                  { ch: 'custom',  who: 'You', self: true }],
    ['npc say',            'a goblin warrior says, \'You will not leave this place alive\'', { ch: 'npc', who: 'a goblin warrior', npc: true }],
    ['npc shout',          'Lord Vyemm shouts, \'Fools!\'',                      { ch: 'npc',     who: 'Lord Vyemm', npc: true }],
    ['npc scripted tell',  'Grand Librarian Maelin tells you, \'Welcome to Myrist!\'', { ch: 'npc', who: 'Grand Librarian Maelin', npc: true }],
    ['npc, apostrophe in name', 'Sir Lucan D\'Lere says, \'Hail\'',              { ch: 'npc',     who: 'Sir Lucan D\'Lere', npc: true }],
  ];
  for (const [label, text, want] of CASES) {
    it(label, () => {
      const got = agent.classifyChatLine(L(text), ME);
      expect(got, text).toMatchObject(want);
      expect(typeof got.t).toBe('number');
    });
  }

  it('the speaker is the text before the FIRST comma, so a verb quoted inside the message cannot be mistaken for it', () => {
    const got = agent.classifyChatLine(L('Corvale tells the guild, \'Brackwyn says, \'hi\' to me\''), ME);
    expect(got).toMatchObject({ ch: 'guild', who: 'Corvale' });
  });
  it('an item link is shown as just the item\'s name', () => {
    const got = agent.classifyChatLine(L('Corvale tells the raid, \'\x120022194A Lucid Shard\x12 dropped\''), ME);
    expect(got.text).toBe('A Lucid Shard dropped');
  });
  it('one of your own characters speaking in the third person is marked as you', () => {
    expect(agent.classifyChatLine(L('Aldenmar tells the guild, \'hi\''), ME).self).toBe(true);
    expect(agent.classifyChatLine(L('Corvale tells the guild, \'hi\''), ME).self).toBe(false);
  });
});

describe('classifyChatLine: Zeal abbreviated chat ([Tag] [Sender]: text)', () => {
  const CASES = [
    ['guild',            '[G] [Corvale]: pull in five',   { ch: 'guild',  who: 'Corvale', text: 'pull in five' }],
    ['raid',             '[R] [Rethlan]: CH on Brackwyn', { ch: 'raid',   who: 'Rethlan' }],
    ['group',            '[P] [Brackwyn]: inc',           { ch: 'group',  who: 'Brackwyn' }],
    ['tell (from)',      '[Fr] [Corvale]: got a minute?', { ch: 'tell',   who: 'Corvale', text: 'got a minute?' }],
    ['custom channel',   '[1] [Zarrin]: anyone for a group', { ch: 'custom', who: 'Zarrin' }],
    ['custom channel, two digits', '[12] [Zarrin]: lfg',  { ch: 'custom', who: 'Zarrin' }],
    ['say',              '[S] [Zarrin]: hello',           { ch: 'say',    who: 'Zarrin' }],
    ['ooc',              '[O] [Zarrin]: brb',             { ch: 'ooc',    who: 'Zarrin' }],
    ['shout',            '[Sh] [Nyssara]: train',         { ch: 'shout',  who: 'Nyssara' }],
    ['auction',          '[A] [Nyssara]: WTS rod',        { ch: 'auction', who: 'Nyssara' }],
    ['your own name on a line is yours', `[G] [${ME}]: on my way`, { ch: 'guild', who: ME, self: true }],
    ['npc say',          '[S] [a goblin warrior]: grr',   { ch: 'npc',    who: 'a goblin warrior', npc: true }],
    ['npc tell (Maelin)','[Fr] [Grand Librarian Maelin]: Welcome to Myrist!', { ch: 'npc', who: 'Grand Librarian Maelin', npc: true }],
  ];
  for (const [label, text, want] of CASES) {
    it(label, () => {
      expect(agent.classifyChatLine(L(text), ME), text).toMatchObject(want);
    });
  }
  it('a digit tag is "custom", never "officer": which channel slot 3 is cannot be told from the log', () => {
    expect(agent.classifyChatLine(L('[3] [Rethlan]: keep this quiet'), ME).ch).toBe('custom');
  });
  it('an unknown tag shows nothing', () => {
    expect(agent.classifyChatLine(L('[Zz] [Corvale]: ???'), ME)).toBeNull();
  });
});

describe('classifyChatLine: lines that are not conversation', () => {
  const NOT = [
    ['Zeal /tag on guild/raid/group transports', 'Corvale tells the raid, \'ZEALTAG | Bardy | a Darkpaw warrior | 511\''],
    ['Zeal /tag, abbreviated',                    '[R] [Corvale]: ZEALTAG | Bardy | a Darkpaw warrior | 511'],
    ['Zeal /tag, short header',                   'Corvale tells ZTwolfpacktag:1, \'ZT | Bardy | a Darkpaw warrior | 511\''],
    ['a /who line',                               '[60 Druid] Corvale (Human) <Wolf Pack>'],
    ['a combat line',                             'You slash a goblin for 120 points of damage.'],
    ['a pet\'s leader declaration',               'Gobn says, \'My leader is Corvale.\''],
    ['a pet\'s command ack',                      'Gobn tells you, \'Attacking a goblin Master.\''],
    ['a merchant\'s quote',                       'Emilyy tells you, \'That\'ll be 5 platinum for the Rod\''],
    ['system text',                               'Your target is out of range, get closer!'],
  ];
  for (const [label, text] of NOT) it(label, () => expect(agent.classifyChatLine(L(text), ME), text).toBeNull());
  it('a line with no timestamp bracket', () => expect(agent.classifyChatLine('Corvale tells the guild, \'hi\'', ME)).toBeNull());
});

// ── 2. The groups are data: the seam for tabs ─────────────────────────────────────────────────
describe('CHAT_GROUPS: the channel groups are a list of { id, label, channels[] }', () => {
  it('every group has the shape, ids are unique, and every channel belongs to exactly one group', () => {
    const ids = new Set();
    const owner = {};
    for (const g of agent.CHAT_GROUPS) {
      expect(typeof g.id).toBe('string');
      expect(typeof g.label).toBe('string');
      expect(Array.isArray(g.channels) && g.channels.length > 0).toBe(true);
      expect(ids.has(g.id), `duplicate group ${g.id}`).toBe(false);
      ids.add(g.id);
      for (const c of g.channels) {
        expect(owner[c], `${c} is in two groups`).toBeUndefined();
        owner[c] = g.id;
        expect(agent.CHAT_CHANNELS[c], `${c} has no colour/label`).toBeTruthy();
        expect(agent.CHAT_CHANNELS[c].color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(Object.keys(owner).sort()).toEqual(Object.keys(agent.CHAT_CHANNELS).sort());
  });
  it('the gated groups are exactly tells, group, officer, custom, melee, spells and skills: the private ones, and the floods', () => {
    const gated = Object.fromEntries(agent.CHAT_GROUPS.filter(g => g.gate).map(g => [g.id, g.gate]));
    expect(gated).toEqual({ tell: 'tells', group: 'group', officer: 'officer', custom: 'custom', melee: 'melee', spells: 'spells', skills: 'skills' });
  });
  it('the public channels have no gate', () => {
    for (const id of ['guild', 'raid', 'say', 'ooc', 'auction', 'npc']) {
      expect(agent.CHAT_GROUPS.find(g => g.id === id).gate, id).toBeUndefined();
    }
  });
});

// ── 3. What is kept: defaults, the switches, exclude_from_stats ───────────────────────────────
const ALL_LINES = [
  'Corvale tells the guild, \'g\'', 'Rethlan tells the raid, \'r\'', 'Zarrin says, \'s\'', 'Zarrin says out of character, \'o\'',
  'Nyssara shouts, \'sh\'', 'Nyssara auctions, \'a\'', 'a goblin says, \'npc\'', 'You say, \'mine\'',
  'Corvale tells you, \'tell\'', 'You told Corvale, \'told\'', 'Brackwyn tells the group, \'grp\'',
  'Rethlan tells Wolfpackofficer:5, \'off\'', 'Zarrin tells General:2, \'cust\'', '[Fr] [Corvale]: abbr tell', '[P] [Brackwyn]: abbr grp', '[1] [Zarrin]: abbr cust',
];
const feed = (opts = {}) => agent.serializeLocalChat({ since: 0, ...opts }, opts.now);
const channelsOf = (r) => [...new Set(r.lines.map(l => l.ch))].sort();
const T0 = 1_800_000_000_000;
beforeEach(() => agent._resetLocalChatForTest());

describe('what the feed keeps and shows', () => {
  it('by default: public channels and your own lines; no tells, group, officer or custom', () => {
    for (const l of ALL_LINES) agent.noteLocalChatLine(L(l), ME, T0);
    const r = feed({ now: T0 });
    expect(channelsOf(r)).toEqual(['auction', 'guild', 'ooc', 'npc', 'raid', 'say', 'shout'].sort());
    expect(r.lines.some(l => l.self)).toBe(true);
  });
  it('officer and group appear only behind their own switch', () => {
    feed({ now: T0 });
    for (const l of ALL_LINES) agent.noteLocalChatLine(L(l), ME, T0);
    expect(channelsOf(feed({ officer: true, now: T0 }))).not.toContain('group');
    expect(channelsOf(feed({ officer: false, group: false, now: T0 }))).not.toContain('officer');
    agent.setChatPolicy({ officer: true, group: true }, T0);
    for (const l of ALL_LINES) agent.noteLocalChatLine(L(l.replace(/'(\w+)'/, '\'$1 again\'')), ME, T0);
    const r = feed({ officer: true, group: true, now: T0 });
    expect(channelsOf(r)).toContain('officer');
    expect(channelsOf(r)).toContain('group');
    expect(channelsOf(r)).not.toContain('tell');
    expect(channelsOf(r)).not.toContain('custom');
  });
  it('custom channels have their own switch, default off', () => {
    agent.setChatPolicy({ custom: true }, T0);
    agent.noteLocalChatLine(L('Zarrin tells General:2, \'lfg\''), ME, T0);
    expect(channelsOf(feed({ custom: true, now: T0 }))).toEqual(['custom']);
    expect(feed({ custom: false, now: T0 }).lines).toHaveLength(0);
  });
  it('tells are kept only when the overlay says the Tells setting is Local or Synced', () => {
    agent.noteLocalChatLine(L('Corvale tells you, \'before\''), ME, T0);
    expect(feed({ now: T0 }).lines).toHaveLength(0);                    // Off: never even captured
    agent.setChatPolicy({ tells: true }, T0);
    agent.noteLocalChatLine(L('Corvale tells you, \'after\''), ME, T0);
    agent.noteLocalChatLine(L('[Fr] [Corvale]: abbreviated'), ME, T0);
    const r = feed({ tells: true, now: T0 });
    expect(r.lines.map(l => l.text)).toEqual(['after', 'abbreviated']);
    // …and switching it back off hides what was kept, at once
    expect(feed({ tells: false, now: T0 }).lines).toHaveLength(0);
  });
  it('a switch lapses 15 s after the overlay stops asking, so a closed overlay leaves nothing private accumulating', () => {
    agent.setChatPolicy({ officer: true }, T0);
    expect(agent.noteLocalChatLine(L('Rethlan tells Wolfpackofficer:5, \'a\''), ME, T0 + 10_000)).toBe(true);
    expect(agent.noteLocalChatLine(L('Rethlan tells Wolfpackofficer:5, \'b\''), ME, T0 + agent.CHAT_POLICY_TTL_MS + 1)).toBe(false);
    expect(agent.chatPolicyNow(T0 + agent.CHAT_POLICY_TTL_MS + 1)).toEqual({ tells: false, group: false, officer: false, custom: false, melee: false, spells: false, skills: false });
  });
  it('one person\'s main and alt logs hear the same guild line: one copy', () => {
    expect(agent.noteLocalChatLine(L('Corvale tells the guild, \'hi\''), 'Aldenmar', T0)).toBe(true);
    expect(agent.noteLocalChatLine(L('Corvale tells the guild, \'hi\''), 'Brackwyn', T0)).toBe(false);
    expect(agent.noteLocalChatLine(L('Corvale tells the guild, \'hi again\''), 'Brackwyn', T0)).toBe(true);
  });
});

describe('exclude_from_stats: an excluded character\'s log is never read into the feed', () => {
  // The tail callback cannot be driven from a test, so this reads its shape: the call sits inside the same
  // `if (!_sourceExcluded)` the tell tap uses, and runs before the byte-level filter.
  const watch = stripJs(AGENT_SRC.slice(AGENT_SRC.indexOf('const _sourceExcluded = !shouldUploadForCharacter(b.character);')));
  const callAt = watch.indexOf('noteLocalChatLine(line, b.character)');
  it('there is exactly one call site in the tail', () => {
    expect(callAt).toBeGreaterThan(0);
    expect(stripJs(AGENT_SRC).match(/noteLocalChatLine\(line, b\.character\)/g)).toHaveLength(1);
  });
  it('the call is inside `if (!_sourceExcluded) {…}`, not after it', () => {
    const guardAt = watch.lastIndexOf('if (!_sourceExcluded) {', callAt);
    expect(guardAt).toBeGreaterThan(-1);
    let depth = 0;
    // (the call is wrapped in `try {`, whose own brace is not part of the guard)
    for (const ch of watch.slice(guardAt, callAt).replace(/try \{\s*$/, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    expect(depth, 'the guard block closed before the call').toBeGreaterThan(0);
    expect(callAt - guardAt, 'the nearest guard is a different block').toBeLessThan(2500);
  });
  it('and it runs ahead of the filter that drops these lines for everything else', () => {
    expect(callAt).toBeLessThan(watch.indexOf('shouldKeep(line, dropPatterns'));
  });
});

// ── 4. Never uploaded ─────────────────────────────────────────────────────────────────────────
describe('never uploaded', () => {
  it('feeding every kind of line leaves the guild-chat buffer, the tell buffer and the Recent Tells ring untouched', () => {
    const b = agent._uploadBuffersForTest();
    const before = [b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length];
    agent.setChatPolicy({ tells: true, group: true, officer: true, custom: true }, T0);
    for (const l of ALL_LINES) agent.noteLocalChatLine(L(l), ME, T0);
    expect(feed({ tells: true, group: true, officer: true, custom: true, now: T0 }).lines.length).toBeGreaterThan(10);
    expect([b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length]).toEqual(before);
  });
  it('the chat block names no buffer, queue, uploader, network call or file write', () => {
    const code = stripJs(CHAT_BLOCK);
    expect(code.length).toBeGreaterThan(2000);   // the slice is real, not an empty string that passes everything
    for (const bad of [/\bchatBuffer\b/, /\btellBuffer\b/, /\bchatBatch\b/, /\brecentTells\b/, /\b_pushRecentTell\b/, /\benqueueUpload\b/,
      /\buploadChat\b/, /\buploadTells\b/, /\bfetch\(/, /\bhttps?\.request\b/, /\bfs\./, /\bwriteFile/, /\bappendFile/, /\b_uploadQueue\b/, /\bQUEUE_FILE\b/]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
  });
  it('the ring is referenced nowhere outside that block: not the feedback excerpt, the crash reports, the dashboard state or any uploader', () => {
    // (the history block is the second block: it reads files, so it cannot live in the first, which may not name `fs.`)
    const outside = stripJs(AGENT_SRC.replace(CHAT_BLOCK, '').replace(HISTORY_BLOCK, ''));
    const uses = outside.split('\n').filter(l => /\b(?:_chatRing|serializeLocalChat|_handleLocalChat|CHAT_BOOT|noteLocalChatLine|classifyChatLine|chatChannelAllowed|CHAT_GROUPS)\b/.test(l)).map(l => l.trim());
    // exactly five lines mention the feed outside its blocks: the route, the tail tap, and three export lines
    expect(uses).toHaveLength(5);
    expect(uses.filter(l => /^CHAT_GROUPS, CHAT_CHANNELS, CHAT_RING_MAX,/.test(l))).toHaveLength(1);
    expect(uses.filter(l => /^if \(req\.url && req\.url\.split\('\?'\)\[0\] === '\/api\/chat' && req\.method === 'GET'\) return _handleLocalChat\(req, res\);$/.test(l))).toHaveLength(1);
    expect(uses.filter(l => /^try \{ noteLocalChatLine\(line, b\.character\); \} catch \(e\) \{ void e; \}$/.test(l))).toHaveLength(1);
    expect(uses.filter(l => /^classifyChatLine, classifyMeleeLine, noteLocalChatLine, serializeLocalChat,/.test(l))).toHaveLength(1);
    expect(uses.filter(l => /^_chatRingForTest: \(\) => _chatRing, _meleeRingForTest: \(\) => _meleeRing, CHAT_MELEE_RING_MAX, _handleLocalChatForTest: _handleLocalChat,$/.test(l))).toHaveLength(1);
    // and the tap's own line is not part of any upload call
    expect(outside).not.toMatch(/noteLocalChatLine\([^)]*\)[^;\n]*\b(?:chatBuffer|tellBuffer|enqueueUpload)/);
  });
  it('the privacy filter is untouched: every line this feed shows beyond guild/raid is still dropped for upload, triggers and feedback excerpts', () => {
    const STILL_DROPPED = [
      'Zarrin says, \'s\'', 'Zarrin says out of character, \'o\'', 'Nyssara shouts, \'sh\'', 'Nyssara auctions, \'a\'',
      'Corvale tells you, \'tell\'', 'You told Corvale, \'told\'', 'Brackwyn tells the group, \'grp\'', 'You tell your party, \'ok\'',
      'Rethlan tells Wolfpackofficer:5, \'off\'', 'You say to your officer, \'noted\'', 'Zarrin tells General:2, \'cust\'',
    ];
    for (const t of STILL_DROPPED) {
      expect(agent.classifyChatLine(L(t), ME), `${t} should still be a chat line here`).not.toBeNull();
      expect(agent.shouldKeep(L(t)), `shouldKeep must still drop: ${t}`).toBe(false);
      expect(agent._feedbackLineAllowed(L(t)), `feedback excerpts must still drop: ${t}`).toBe(false);
    }
  });
  it('/api/chat is GET-only on the local server, and answers a foreign origin with 403', () => {
    const route = stripJs(AGENT_SRC).match(/if \(req\.url && req\.url\.split\('\?'\)\[0\] === '\/api\/chat'[^\n]*/)[0];
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain('_handleLocalChat(req, res)');
    const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    agent._handleLocalChatForTest({ url: '/api/chat?since=0', headers: { origin: 'https://evil.example' } }, res);
    expect(res.code).toBe(403);
    expect(res.body).not.toContain('"lines"');
  });
});

// ── 5. GET /api/chat: the cursor ──────────────────────────────────────────────────────────────
describe('/api/chat cursor', () => {
  const say = (n) => agent.noteLocalChatLine(L(`Zarrin says, 'line ${n}'`), ME, T0);
  it('since=0 returns everything held; since=<seq> returns nothing; since=<n> returns only what is newer', () => {
    for (let i = 1; i <= 5; i++) say(i);
    const all = feed({ now: T0 });
    expect(all.lines.map(l => l.text)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
    expect(all.seq).toBe(5);
    expect(feed({ since: 5, now: T0 }).lines).toEqual([]);
    expect(feed({ since: 3, now: T0 }).lines.map(l => l.n)).toEqual([4, 5]);
    say(6);
    expect(feed({ since: 5, now: T0 }).lines.map(l => l.text)).toEqual(['line 6']);
  });
  it('line numbers only ever go up and are what the cursor is made of', () => {
    for (let i = 1; i <= 4; i++) say(i);
    const ns = feed({ now: T0 }).lines.map(l => l.n);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
    expect(new Set(ns).size).toBe(ns.length);
  });
  it('a different boot id means the agent restarted: start over from the top', () => {
    for (let i = 1; i <= 3; i++) say(i);
    const first = feed({ now: T0 });
    expect(first.reset).toBe(false);
    const again = feed({ since: 3, boot: first.boot, now: T0 });
    expect(again.reset).toBe(false);
    const stale = feed({ since: 3, boot: 'deadbeef', now: T0 });
    expect(stale.reset).toBe(true);
    expect(stale.lines).toHaveLength(3);
  });
  it('a cursor ahead of the ring (a restarted agent) is treated as a reset', () => {
    say(1);
    const r = feed({ since: 99, now: T0 });
    expect(r.reset).toBe(true);
    expect(r.lines).toHaveLength(1);
  });
  it('a page is at most CHAT_PAGE_MAX lines, the newest ones, and the ring holds at most CHAT_RING_MAX', () => {
    for (let i = 1; i <= agent.CHAT_RING_MAX + 100; i++) say(i);
    expect(agent._chatRingForTest()).toHaveLength(agent.CHAT_RING_MAX);
    const r = feed({ now: T0 });
    expect(r.lines).toHaveLength(agent.CHAT_PAGE_MAX);
    expect(r.lines[r.lines.length - 1].text).toBe(`line ${agent.CHAT_RING_MAX + 100}`);
    expect(r.seq).toBe(agent.CHAT_RING_MAX + 100);
  });
  it('the response carries the groups and colours the overlay draws with', () => {
    const r = feed({ now: T0 });
    expect(r.ok).toBe(true);
    expect(r.groups).toEqual(agent.CHAT_GROUPS);
    expect(r.channels).toEqual(agent.CHAT_CHANNELS);
    expect(typeof r.boot).toBe('string');
  });
  it('over HTTP: the switches ride the query string, and a 1/0 flag is read as a flag', () => {
    agent.noteLocalChatLine(L('Rethlan tells Wolfpackofficer:5, \'off\''), ME);
    const get = (qs) => { const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
      agent._handleLocalChatForTest({ url: '/api/chat?since=0' + qs, headers: {} }, res); return { code: res.code, json: JSON.parse(res.body) }; };
    const a = get('&officer=0');
    expect(a.code).toBe(200);
    expect(a.json.lines).toHaveLength(0);
    // the capture above ran before any policy was set, so the officer line was never kept (not just hidden)
    agent.setChatPolicy({ officer: true });
    agent.noteLocalChatLine(L('Rethlan tells Wolfpackofficer:5, \'off 2\''), ME);
    expect(get('&officer=1').json.lines.map(l => l.text)).toEqual(['off 2']);
    expect(get('&officer=0').json.lines).toHaveLength(0);
  });
});

// ── 6. Mimic: the overlay parity checklist, every site ────────────────────────────────────────
describe('Mimic: the overlay feature-parity checklist for `chat`', () => {
  const code = stripJs(MAIN);
  const fnBody = (head) => stripJs(sliceBlock(MAIN, head, '\n}\n'));
  it('has a window variable, a creator and an apply*Visibility that honours the usual gates', () => {
    expect(code).toMatch(/^let chatWindow\s+= null;/m);
    const create = fnBody('function createChatOverlay() {');
    expect(create).toContain("loadFile('chat.html')");
    expect(create).toContain("_wpPrefs('Chat')");
    expect(create).toContain("_persistBounds('chatBounds', chatWindow)");
    expect(create).toContain("applyOverlayOpacity(chatWindow, 'chat')");
    expect(create).toContain('minWidth: _OVERLAY_MIN_W');
    const apply = fnBody('function applyChatVisibility() {');
    // (the Chat window and every broken-out window share this one gate)
    expect(apply).toContain('for (const w of chatBreakouts.values()) {');
    for (const bit of ['_live(chatWindow)', 'setupMode', 'overlaysLocked === false', 'cfg.showChat', 'cfg.hideOverlays', '_eqGateOk(cfg)']) expect(apply, bit).toContain(bit);
  });
  it('remembers its position (_boundsKeyForWindow) and is listed by _overlayEntries', () => {
    expect(fnBody('function _boundsKeyForWindow(win) {')).toContain("if (win === chatWindow)    return 'chatBounds';");
    expect(fnBody('function _overlayEntries() {')).toContain("out.push(['chat',    chatWindow])");
  });
  it('is in the lifecycle table, the hide-all list, the per-character profile, the hotkey keys and the opacity list', () => {
    expect(code).toMatch(/\{ key: 'chat',\s+flag: 'showChat',\s+get: \(\) => chatWindow,\s+create: createChatOverlay,\s+drop: \(\) => \{ chatWindow = null; \} \}/);
    expect(stripJs(sliceBlock(MAIN, 'const _HIDEALL_FLAGS = [', '\n];'))).toContain("'showChat'");
    expect(stripJs(sliceBlock(MAIN, 'const _CHAR_PROFILE_FLAGS = [', '\n];'))).toContain("'showChat'");
    expect(stripJs(sliceBlock(MAIN, 'const _CHAR_PROFILE_WINDOWS = [', '\n];'))).toContain("flag: 'showChat'");
    expect(stripJs(sliceBlock(MAIN, 'const _OVERLAY_HOTKEY_KEYS = [', '];'))).toContain("'chat'");
    expect(stripJs(sliceBlock(MAIN, 'const _ALL_OVERLAY_KEYS = [', '];'))).toContain("'chat'");
    expect(stripJs(sliceBlock(MAIN, 'const _OVERLAY_NAMES = {', '\n};'))).toContain("chat: 'Chat'");
  });
  it('is in the rescue list and every visibility pass', () => {
    expect(code).toMatch(/const KNOWN = \[[^\]]*'maptimers', 'chat'\]/);
    expect(fnBody('function applyAllVisibility() {')).toContain('applyChatVisibility();');
    // setup-exit pass and the config-merge pass
    expect((code.match(/applyChatVisibility\(\);/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(code).toContain('applyChatVisibility(); applyMelodyVisibility();');
    expect(code).toMatch(/if \(merged\.showChat\s+&& !chatWindow\)\s+createChatOverlay\(\);/);
  });
  it('has a status flag, a tray checkbox, a toggle-overlay case and a ✕ branch', () => {
    expect(code).toContain('showChat: !!cfg.showChat,');
    expect(code).toMatch(/label: 'Chat \([^']*\) \[beta\]', type: 'checkbox', checked: !!s\.showChat/);
    expect(code).toMatch(/case 'chat':\n\s+cfg\.showChat = !cfg\.showChat; saveConfig\(cfg\);\n\s+if \(cfg\.showChat && !chatWindow\) createChatOverlay\(\); else applyChatVisibility\(\);/);
    expect(code).toMatch(/\} else if \(win === chatWindow\) \{\n\s+cfg\.showChat = false; saveConfig\(cfg\);/);
  });
  it('is off by default (the guild lead\'s rule: overlays are opt-in)', () => {
    expect(stripJs(sliceBlock(MAIN, 'function defaultConfig() {', '\n}\n'))).toMatch(/showChat: false,/);
  });
  it('is in the dashboard: a row, a blurb, both key-to-flag maps, and no Dock button', () => {
    const rows = stripJs(sliceBlock(DASH, 'var WP_OVERLAY_ROWS = [', '\n];'));
    expect(rows).toMatch(/\['chat',\s+'Chat \[beta\]',/);
    expect(stripJs(sliceBlock(DASH, 'var WP_OVERLAY_BLURB = {', '\n};'))).toMatch(/^\s+chat:\s+'/m);
    const refresh = stripJs(DASH);
    expect(refresh).toContain('chat: !!st.showChat');
    expect(refresh).toContain("chat: 'showChat'");
    expect(refresh).toContain("key === 'maptimers' || key === 'chat')");
  });
  it('the dashboard and the agent\'s embedded copy agree (npm run check:dashboard also enforces this)', () => {
    expect(AGENT_SRC).toContain("['chat',    'Chat [beta]',");
  });
});

describe('chat.html: the overlay\'s own parity items', () => {
  const html = CHAT_HTML;
  const script = stripJs(html.slice(html.indexOf('<script>'), html.indexOf('</script>')));
  it('✕ hide, ✥ move with manual-drag IPC and the right-click menu', () => {
    expect(html).toContain('<button id="hide-btn"');
    expect(script).toContain('window.mimic.hideThisOverlay()');
    expect(html).toContain('<button id="move-btn"');
    expect(script).toContain('window.mimic.overlayDragStart()');
    expect(script).toContain('window.mimic.overlayDragEnd()');
    expect(script).toContain('window.mimic.attachOverlayMenu(moveBtn)');
    expect(html).not.toMatch(/-webkit-app-region/);   // never CSS app-region: buggy on transparent windows
  });
  it('the hover handshake covers every clickable thing: buttons (armed by the preload) plus the feed and chip row', () => {
    expect(script).toContain('window.mimic.overlayHoverInteractive(on)');
    expect(script).toMatch(/el\.closest\('\.title, #chips, #cpick, #spanel, #onlypill, #feed, #newchip, #ctxmenu'\)/);
    // every clickable element is a <button>/<input>, which the preload arms on its own: no clickable <div>/<span>
    expect(html).not.toMatch(/<(?:div|span)[^>]*\sonclick=/);
    expect(html).not.toMatch(/<(?:div|span)[^>]*role="?button/);
    for (const id of ['gear', 'fsm', 'fsp', 'newchip']) expect(html, id).toMatch(new RegExp('<button[^>]*id="' + id + '"'));
    expect(script).toContain('<button type="button" class="chip');
  });
  it('uses the shared opacity and setup chrome', () => {
    expect(script).toContain('window.mimic.onBgAlpha');
    expect(script).toContain('window.mimic.setOverlayOpacity(_overlayKey, v)');
    expect(script).toContain('window.mimic.onSetupMode');
    expect(script).toContain('window.mimic.onOverlayLocked');
    expect(html).toContain('id="opacitySlider"');
  });
  it('font size is a setting (9-24) and the feed uses it', () => {
    expect(html).toMatch(/font-size:var\(--fs\)/);
    expect(script).toContain('Math.max(9, Math.min(24,');
  });
  it('class="name" is on a speaker only when the speaker is a character: never "You", never an NPC', () => {
    const lineHtml = script.slice(script.indexOf('function lineHtml(l, tag){'), script.indexOf('function rowHtml(l){'));
    expect(lineHtml).toContain("'<span class=\"who npc\">'");
    expect(lineHtml).toContain("'<span class=\"who you\">You</span>'");
    expect(lineHtml).toContain("'<span class=\"who name\">' + esc(l.who)");
    // the only places `name` is a class at all
    const names = html.match(/class="[^"]*\bname\b[^"]*"/g) || [];
    expect(names).toHaveLength(2);   // the player speaker and the outgoing tell's recipient
    // the NPC and You branches are tested before the player branch
    expect(lineHtml.indexOf('l.npc')).toBeLessThan(lineHtml.indexOf('who name'));
    expect(lineHtml.indexOf('you)')).toBeLessThan(lineHtml.indexOf('who name'));
  });
  it('the feed stays pinned to the bottom unless you scroll up, and a "↓ new" chip counts what you missed', () => {
    expect(script).toContain('function pinned(){');
    expect(script).toMatch(/if \(stick\) toBottom\(\); else \{ _unread \+= shown; paintNew\(\); \}/);
    expect(html).toContain('id="newchip"');
    expect(script).toContain("' new' : '↓ new'");
  });
  it('is not a Mimic-screen-specific window: no EverQuest-geometry or display calls', () => {
    expect(script).not.toMatch(/screen\.|getAllDisplays|eqWindow|getPrimaryDisplay/);
  });
  it('builds no tab strip: a group is a chip, and a broken-out group is a window, not a tab', () => {
    const markup = stripCss(html.slice(html.indexOf('</style>'), html.indexOf('<script>')));
    expect(markup).not.toMatch(/role="tab"|class="tab\b/i);
    expect(script).not.toMatch(/role="tab"|class="tab\b/i);
  });
});

// The feed's filter, run for real: this is the seam tabs will use.
describe('chat.html: the feed is painted through a filter handed a list of groups', () => {
  const script = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));
  const make = (prefs, only = [], out = []) => evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _prefs = ${JSON.stringify({ fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [], ...prefs })};
    var _only = ${JSON.stringify(only)};
    var _out = ${JSON.stringify(out)};
    var _isBrk = _only.length > 0;
    ${sliceBlock(script, 'function groupOf(ch){', 'return out;\n  }')}
  `, ['makeFilter', 'shownGroupIds', 'gateOn', '_prefs']);
  const line = (ch) => ({ ch });
  it('a filter of group ids shows exactly those groups', () => {
    const f = make({}).makeFilter(['guild', 'ooc']);
    expect(f(line('guild'))).toBe(true);
    expect(f(line('ooc'))).toBe(true);
    expect(f(line('shout'))).toBe(true);    // OOC/Shout is one group
    expect(f(line('raid'))).toBe(false);
  });
  it('a gated group stays hidden until its switch is on, even if a filter asks for it', () => {
    const off = make({}).makeFilter(['officer', 'tell', 'group', 'custom']);
    for (const ch of ['officer', 'tell', 'group', 'custom']) expect(off(line(ch)), ch).toBe(false);
    const on = make({ officer: true, tells: true }).makeFilter(['officer', 'tell', 'group', 'custom']);
    expect(on(line('officer'))).toBe(true);
    expect(on(line('tell'))).toBe(true);
    expect(on(line('group'))).toBe(false);
    expect(on(line('custom'))).toBe(false);
  });
  it('the chips\' off-list decides what shows by default, and the gated groups are not in it until opted in', () => {
    expect(make({}).shownGroupIds()).toEqual(['guild', 'raid', 'say', 'ooc', 'auction', 'npc', 'zone']);   // Zones are on by default
    expect(make({ off: ['raid', 'auction'] }).shownGroupIds()).toEqual(['guild', 'say', 'ooc', 'npc', 'zone']);
    expect(make({ officer: true }).shownGroupIds()).toContain('officer');
  });
  it('an unknown channel shows nothing', () => {
    expect(make({}).makeFilter(['guild'])(line('mystery'))).toBe(false);
  });
});

// ── 7. Mimic settings: Tells and the remembered chips ─────────────────────────────────────────
describe('Mimic prefs: chips are remembered per character, tells follow the Tells setting', () => {
  function load(cfg) {
    const handlers = {};
    const saved = [];
    const r = evalBlock(`
      const ipcMain = { handle: (n, f) => { HANDLERS[n] = f; } };
      let CFG = ${JSON.stringify(cfg)};
      function _pushChatWindows(channel) { globalThis.__P.push(channel); }
      function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
      function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); SAVED.push(CFG); }
      ${sliceBlock(MAIN, 'function _chatCharKey(char) {', "  return _chatPrefsPayload(cfg, char);\n});")}
    `.replace('HANDLERS', 'globalThis.__H').replace('SAVED', 'globalThis.__S'), ['_chatCharKey', '_chatPrefsPayload']);
    return { r, get: (...a) => globalThis.__H['chat-prefs-get']({}, ...a), set: (...a) => globalThis.__H['chat-prefs-set']({}, ...a), saved: () => globalThis.__S };
  }
  beforeEach(() => { globalThis.__H = {}; globalThis.__S = []; globalThis.__P = []; });
  it('defaults: 12 px, group and channels on, officer off, nothing hidden, tells off', async () => {
    const m = load({});
    expect(await m.get('Aldenmar')).toEqual({ fontSize: 12, group: true, officer: false, custom: true, tells: false, off: [], melee: false, spells: false, skills: false, meleeShow: { mine: true, on_me: true, others: true, misses: true }, spellShow: { mine: true, on_me: true, others: true }, skillShow: { mine: true, others: true }, offChannels: [], only: '', win: {} });
  });
  it('group and channels stay off once switched off', async () => {
    const m = load({ chatPrefs: { group: false, custom: false } });
    expect(await m.get('Aldenmar')).toMatchObject({ group: false, custom: false });
  });
  it('tells are on for Local and Synced, off for Off', async () => {
    for (const [mode, want] of [['off', false], ['local', true], ['synced', true], [undefined, false]]) {
      expect((await load({ tellsMode: mode }).get('Aldenmar')).tells, String(mode)).toBe(want);
    }
  });
  it('chip choices are kept per character; another character is unaffected', async () => {
    const m = load({});
    await m.set('Aldenmar', { off: ['auction', 'raid'] });
    expect((await m.get('Aldenmar')).off).toEqual(['auction', 'raid']);
    expect((await m.get('aldenmar')).off, 'case-insensitive').toEqual(['auction', 'raid']);
    expect((await m.get('Brackwyn')).off).toEqual([]);
  });
  it('the opt-in switches and the font size are shared, and clamped', async () => {
    const m = load({});
    await m.set('Aldenmar', { officer: true, fontSize: 99 });
    const other = await m.get('Brackwyn');
    expect(other.officer).toBe(true);
    expect(other.fontSize).toBe(12);                 // 99 is out of range: ignored
    await m.set('Aldenmar', { fontSize: 16 });
    expect((await m.get('Brackwyn')).fontSize).toBe(16);
  });
  it('a change is announced to every Chat window, so a breakout never polls with stale switches', async () => {
    const m = load({});
    await m.get('Aldenmar');
    expect(globalThis.__P).toEqual([]);                  // reading announces nothing
    await m.set('Aldenmar', { officer: true });
    expect(globalThis.__P).toEqual(['chat-prefs-changed']);
  });
  it('the renderer cannot store anything but the whitelist', async () => {
    const m = load({});
    await m.set('Aldenmar', { off: ['ok', 'Bad Id', 42, '../x', 'x'.repeat(40)], officer: 'yes', evil: true, tellsMode: 'synced' });
    const stored = m.saved().pop();
    expect(stored.chatPrefs.byChar.aldenmar.off).toEqual(['ok']);
    expect(stored.chatPrefs.officer).toBeUndefined();   // a string is not a boolean
    expect(stored.evil).toBeUndefined();
    expect(stored.tellsMode).toBeUndefined();            // Tells is Settings' to change, never the overlay's
  });
  it('the Settings page no longer says the display ships later, and says where tells go', () => {
    const settings = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'settings.html'), 'utf8');
    expect(settings).not.toMatch(/ships in v0\.2/);
    expect(settings).toMatch(/Local and Synced show your tells in the Chat overlay on this PC/);
  });
  // ── round 3 (the guild lead, 2026-10-14): per-channel switches, "show only", melee opt-in, per-window text ──
  it('per-channel switches are saved by lower-case NAME, de-duplicated, whitelisted, and read back', async () => {
    const m = load({});
    await m.set('Aldenmar', { offChannels: ['General', 'general', 'Ports', '#3', 'bad name', 42, '', 'x'.repeat(40)] });
    expect(m.saved().pop().chatPrefs.offChannels).toEqual(['general', 'ports', '#3']);
    expect((await m.get('Brackwyn')).offChannels).toEqual(['general', 'ports', '#3']);   // shared by every character
    await m.set('Aldenmar', { offChannels: [] });
    expect((await m.get('Aldenmar')).offChannels).toEqual([]);                          // switching the last one back on clears it
  });
  it('prefs saved before this existed load unchanged: nothing is reset and every channel still shows', async () => {
    const old = { fontSize: 15, group: false, officer: true, byChar: { aldenmar: { off: ['raid'] } } };
    const m = load({ chatPrefs: old });
    expect(await m.get('Aldenmar')).toEqual({
      fontSize: 15, group: false, officer: true, custom: true, tells: false, off: ['raid'],
      melee: false, spells: false, skills: false, meleeShow: { mine: true, on_me: true, others: true, misses: true },
      spellShow: { mine: true, on_me: true, others: true }, skillShow: { mine: true, others: true }, offChannels: [], only: '', win: {},
    });
    await m.set('Aldenmar', { offChannels: ['general'] });
    const stored = m.saved().pop().chatPrefs;
    expect(stored).toMatchObject({ fontSize: 15, group: false, officer: true, byChar: { aldenmar: { off: ['raid'] } }, offChannels: ['general'] });   // no key dropped
  });
  it('defaults stay as they were: group and joined channels on, officer opt-in, melee opt-in', async () => {
    const m = load({});
    expect(await m.get('Aldenmar')).toMatchObject({ group: true, custom: true, officer: false, melee: false });
    await m.set('Aldenmar', { melee: true, officer: true });
    expect(await m.get('Aldenmar')).toMatchObject({ melee: true, officer: true });
  });
  it('spells and skills are opt-in like melee: default off, saved only as booleans, and old prefs load unchanged', async () => {
    const m = load({});
    expect(await m.get('Aldenmar')).toMatchObject({ spells: false, skills: false });
    await m.set('Aldenmar', { spells: true, skills: true, melee: true });
    expect(await m.get('Aldenmar')).toMatchObject({ spells: true, skills: true, melee: true });
    expect(await m.get('Brackwyn')).toMatchObject({ spells: true, skills: true });          // shared by every character, like melee
    await m.set('Aldenmar', { spells: false });
    expect(await m.get('Aldenmar')).toMatchObject({ spells: false, skills: true });         // one switch never moves the other
    await m.set('Aldenmar', { spells: 'yes', skills: 1 });                                  // the renderer cannot store a non-boolean
    expect(await m.get('Aldenmar')).toMatchObject({ spells: false, skills: true });
    const old = load({ chatPrefs: { fontSize: 15, melee: true, byChar: { aldenmar: { off: ['raid'] } } } });   // saved before Spells/Skills existed
    expect(await old.get('Aldenmar')).toMatchObject({ fontSize: 15, melee: true, spells: false, skills: false, off: ['raid'] });
    await old.set('Aldenmar', { skills: true });
    expect(old.saved().pop().chatPrefs).toMatchObject({ fontSize: 15, melee: true, skills: true, byChar: { aldenmar: { off: ['raid'] } } });   // no key dropped
  });
  it('what Melee shows round-trips: all on by default, only booleans stored, one switch never moves another, old prefs unchanged', async () => {
    const m = load({});
    const ALL = { mine: true, on_me: true, others: true, misses: true };
    expect((await m.get('Aldenmar')).meleeShow).toEqual(ALL);
    await m.set('Aldenmar', { meleeShow: { others: false } });
    expect((await m.get('Aldenmar')).meleeShow).toEqual({ ...ALL, others: false });
    expect((await m.get('Brackwyn')).meleeShow).toEqual({ ...ALL, others: false });          // shared by every character
    await m.set('Aldenmar', { meleeShow: { misses: false } });
    expect((await m.get('Aldenmar')).meleeShow).toEqual({ mine: true, on_me: true, others: false, misses: false });
    await m.set('Aldenmar', { meleeShow: { others: true } });
    expect((await m.get('Aldenmar')).meleeShow).toEqual({ mine: true, on_me: true, others: true, misses: false });
    await m.set('Aldenmar', { meleeShow: { mine: 'no', on_me: 0, evil: false, others: null } });   // the renderer cannot store a non-boolean or a new key
    expect((await m.get('Aldenmar')).meleeShow).toEqual({ mine: true, on_me: true, others: true, misses: false });
    expect(Object.keys(m.saved().pop().chatPrefs.meleeShow).sort()).toEqual(['misses', 'mine', 'on_me', 'others'].sort());
    await m.set('Aldenmar', { meleeShow: 'all' });                                           // not an object: ignored
    expect((await m.get('Aldenmar')).meleeShow.misses).toBe(false);
    const old = load({ chatPrefs: { fontSize: 15, melee: true, byChar: { aldenmar: { off: ['raid'] } } } });   // saved before the filters existed
    expect((await old.get('Aldenmar')).meleeShow).toEqual(ALL);
    await old.set('Aldenmar', { meleeShow: { others: false } });
    expect(old.saved().pop().chatPrefs).toMatchObject({ fontSize: 15, melee: true, byChar: { aldenmar: { off: ['raid'] } }, meleeShow: { others: false } });
  });
  it('what Spells and Skills show round-trips: all on by default, partial patches merge, only booleans stored, old prefs unchanged', async () => {
    const m = load({});
    const SP = { mine: true, on_me: true, others: true }, SK = { mine: true, others: true };
    expect(await m.get('Aldenmar')).toMatchObject({ spellShow: SP, skillShow: SK });
    await m.set('Aldenmar', { spellShow: { others: false } });
    expect((await m.get('Aldenmar')).spellShow).toEqual({ ...SP, others: false });
    expect((await m.get('Aldenmar')).skillShow).toEqual(SK);                                 // one group's switches never move the other's
    expect((await m.get('Brackwyn')).spellShow).toEqual({ ...SP, others: false });          // shared by every character
    await m.set('Aldenmar', { spellShow: { on_me: false } });
    expect((await m.get('Aldenmar')).spellShow).toEqual({ mine: true, on_me: false, others: false });   // a partial patch merges
    await m.set('Aldenmar', { skillShow: { others: false } });
    expect((await m.get('Aldenmar')).skillShow).toEqual({ mine: true, others: false });
    expect((await m.get('Aldenmar')).spellShow).toEqual({ mine: true, on_me: false, others: false });
    await m.set('Aldenmar', { spellShow: { mine: 'no', on_me: 1, others: null, evil: false, misses: false }, skillShow: { mine: 0, on_me: false } });   // non-booleans and unknown keys are refused
    expect((await m.get('Aldenmar')).spellShow).toEqual({ mine: true, on_me: false, others: false });
    expect((await m.get('Aldenmar')).skillShow).toEqual({ mine: true, others: false });
    const stored = m.saved().pop().chatPrefs;
    expect(Object.keys(stored.spellShow).sort()).toEqual(['mine', 'on_me', 'others']);
    expect(Object.keys(stored.skillShow).sort()).toEqual(['mine', 'others']);
    await m.set('Aldenmar', { spellShow: 'all', skillShow: ['mine'] });                      // not an object: ignored
    expect((await m.get('Aldenmar')).spellShow.on_me).toBe(false);
    expect((await m.get('Aldenmar')).skillShow.others).toBe(false);
    await m.set('Aldenmar', { spellShow: { others: true, on_me: true }, skillShow: { others: true } });
    expect(await m.get('Aldenmar')).toMatchObject({ spellShow: SP, skillShow: SK });
    const old = load({ chatPrefs: { fontSize: 15, spells: true, meleeShow: { others: false }, byChar: { aldenmar: { off: ['raid'] } } } });   // saved before these filters existed
    expect(await old.get('Aldenmar')).toMatchObject({ fontSize: 15, spells: true, spellShow: SP, skillShow: SK, meleeShow: { mine: true, on_me: true, others: false, misses: true }, off: ['raid'] });
    await old.set('Aldenmar', { spellShow: { others: false } });
    expect(old.saved().pop().chatPrefs).toMatchObject({ fontSize: 15, spells: true, meleeShow: { others: false }, byChar: { aldenmar: { off: ['raid'] } }, spellShow: { mine: true, on_me: true, others: false } });   // no key dropped
  });
  it('"show only" is saved as its own key and never touches the saved switches', async () => {
    const m = load({ chatPrefs: { officer: true, byChar: { aldenmar: { off: ['raid'] } }, offChannels: ['ports'] } });
    await m.set('Aldenmar', { only: 'custom:General' });
    let got = await m.get('Aldenmar');
    expect(got.only).toBe('custom:general');
    expect(got).toMatchObject({ officer: true, off: ['raid'], offChannels: ['ports'], custom: true, group: true });
    await m.set('Aldenmar', { only: 'guild' });
    expect((await m.get('Aldenmar')).only).toBe('guild');
    await m.set('Aldenmar', { only: '' });
    got = await m.get('Aldenmar');
    expect(got).toMatchObject({ only: '', officer: true, off: ['raid'], offChannels: ['ports'] });
    await m.set('Aldenmar', { only: '../x y' });
    expect((await m.get('Aldenmar')).only).toBe('');
  });
  it('text settings are saved per window; one window\'s change never touches another\'s', async () => {
    const m = load({ chatPrefs: { fontSize: 14 } });
    await m.set('Aldenmar', { win: { main: { fontSize: 18 } } });
    await m.set('Aldenmar', { win: { melee: { fontSize: 10, lineGap: 'compact', times: false, tags: false } } });
    let got = await m.get('Aldenmar');
    expect(got.win.main).toEqual({ fontSize: 18 });
    expect(got.win.melee).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    await m.set('Aldenmar', { win: { melee: { times: true } } });                    // one field merges in; the rest stay
    got = await m.get('Aldenmar');
    expect(got.win.melee).toEqual({ fontSize: 10, lineGap: 'compact', times: true, tags: false });
    expect(got.win.main).toEqual({ fontSize: 18 });
    expect(got.fontSize).toBe(14);                                                   // the shared size (every window's default) is untouched
    expect((await m.get('Brackwyn')).win.melee.tags).toBe(false);                    // survives a reopen / another character
  });
  it('the renderer cannot store anything but valid window ids and fields', async () => {
    const m = load({});
    await m.set('Aldenmar', { win: { 'Bad Id': { fontSize: 12 }, main: { fontSize: 99, lineGap: 'huge', times: 'no', evil: 1 }, guild: { lineGap: 'compact' } } });
    const stored = m.saved().pop().chatPrefs.win;
    expect(stored).toEqual({ main: {}, guild: { lineGap: 'compact' } });
  });
  it('the preload exposes exactly the two prefs calls', () => {
    expect(stripJs(PRELOAD)).toMatch(/getChatPrefs:\s+\(char\)\s+=> ipcRenderer\.invoke\('chat-prefs-get'/);
    expect(stripJs(PRELOAD)).toMatch(/setChatPrefs:\s+\(char, patch\) => ipcRenderer\.invoke\('chat-prefs-set'/);
  });
});

// ── 8. Round 2 (the guild lead, 2026-10-14): the Seer's recital, click-to-copy, breakouts ─────────────────
// 8a. "tells from seer did not come through": the PoP flag NPC's recital is printed into the tell window with no
// "X tells you," in front of it. Classified through parsePopFlagLine's own matcher, never a second table.
describe('the Seer\'s recital shows as a tell', () => {
  const POP = require_('../utils/popFlagStages.js');
  // the three sentences on the guild lead's screenshot (the last is the Seer's "nothing new" answer)
  const SHOT = [
    'The evidence of Mavuin is the only thing that can save him now.',
    'Grummus has been destroyed, about his corpse you found a small ward to protect from disease.',
    'You manage to recover some images from your childhood, but no recent events spark a memory.',
  ];
  for (const s of SHOT) {
    it(`"${s.slice(0, 40)}…" is a Seer tell`, () => {
      expect(agent.classifyChatLine(L(s), ME)).toMatchObject({ ch: 'tell', who: 'Seer', text: s, npc: true, self: false });
    });
  }
  it('every sentence the PoP-flag recital table knows is a tell here, so the two cannot drift apart', () => {
    expect(POP.RECITAL_STAGES.length).toBeGreaterThan(30);
    for (const [prefix] of POP.RECITAL_STAGES) {
      const got = agent.classifyChatLine(L(prefix + ' (the rest of the sentence).'), ME);
      expect(got, prefix).toMatchObject({ ch: 'tell', who: 'Seer' });
    }
  });
  it('a player saying the same words is still a /say, and your own words are still yours', () => {
    expect(agent.classifyChatLine(L('Corvale says, \'The evidence of Mavuin is the only thing that can save him now.\''), ME)).toMatchObject({ ch: 'say', who: 'Corvale' });
    expect(agent.classifyChatLine(L('You say, \'Grummus has been destroyed\''), ME)).toMatchObject({ ch: 'say', who: 'You', self: true });
  });
  it('ordinary lines that merely start with a capital letter are not recitals', () => {
    for (const t of ['The goblin is slain!', 'You have been slain by a gnoll!', 'Grummus has awakened.', 'You manage to hit a goblin.']) {
      expect(agent.classifyChatLine(L(t), ME), t).toBeNull();
    }
  });
  it('follows the Tells gate: never kept while Tells is off, kept and served as channel tell when it is on', () => {
    for (const s of SHOT) agent.noteLocalChatLine(L(s), ME, T0);
    expect(feed({ now: T0 }).lines).toHaveLength(0);
    agent.setChatPolicy({ tells: true }, T0);
    for (const s of SHOT) agent.noteLocalChatLine(L(s), ME, T0);
    const r = feed({ tells: true, now: T0 });
    expect(r.lines.map(l => l.text)).toEqual(SHOT);
    expect(channelsOf(r)).toEqual(['tell']);
    expect(r.lines.every(l => l.who === 'Seer' && l.npc === true)).toBe(true);
    expect(feed({ tells: false, now: T0 }).lines).toHaveLength(0);
  });
  it('is the Tells group\'s line, so a Tells chip (or breakout) carries it', () => {
    expect(agent.CHAT_GROUPS.find(g => g.channels.includes('tell')).gate).toBe('tells');
  });
  it('is never uploaded as chat: the buffers stay untouched, and the chat block does not run the flag parser', () => {
    const b = agent._uploadBuffersForTest();
    const before = [b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length];
    agent.setChatPolicy({ tells: true }, T0);
    for (const s of SHOT) agent.noteLocalChatLine(L(s), ME, T0);
    expect([b.chatBuffer.length, b.tellBuffer.length, b.recentTells.length]).toEqual(before);
    const code = stripJs(CHAT_BLOCK);
    expect(code).not.toMatch(/parsePopFlagLine|_popPrevLine/);   // the flag parser keeps state and uploads; this feed does neither
    expect(code).toContain('_POP_RECITAL_RX.test(sentence)');
  });
  it('the "nothing new" answer is NOT a flag recital: the flag parser must not upload it', () => {
    // eslint-disable-next-line no-new-func
    const pop = new Function('_zealState', 'stats', 'parseEqTimestamp',
      `${sliceBlock(AGENT_SRC, 'const _POP_GRANT_RX =', '\n}\n')}\nreturn { parsePopFlagLine };`)({}, { currentEncounterThreatByChar: {} }, () => new Date());
    expect(pop.parsePopFlagLine(L(SHOT[2]), 'Aldenmar')).toBeNull();
    expect(pop.parsePopFlagLine(L(SHOT[0]), 'Aldenmar')).toMatchObject({ kind: 'recital' });
  });
  it('a quest NPC\'s "X tells you," with a multi-word name lands in NPC, not Tells (unchanged)', () => {
    expect(agent.classifyChatLine(L('Seer Mal Nae`Shi tells you, \'You must sit to listen.\''), ME)).toMatchObject({ ch: 'npc', who: 'Seer Mal Nae`Shi', npc: true });
    expect(agent.classifyChatLine(L('Grand Librarian Maelin tells you, \'Welcome to Myrist!\''), ME)).toMatchObject({ ch: 'npc' });
  });
});

// 8b. "Add a copy button if you click on the timestamp next to the message".
describe('chat.html: click a line\'s timestamp to copy it', () => {
  const script = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));
  const code = stripJs(script);
  const T = new Date(2026, 9, 14, 13, 3, 28).getTime();   // local time, like the overlay's own clock
  const HHMM = sliceBlock(script, 'function hhmm(t){', '}\n');
  const COPYLINE = sliceBlock(script, 'function copyLineText(l){', '+ l.text;\n  }');
  const fns = () => evalBlock(`${HHMM}\n${COPYLINE}`, ['hhmm', 'copyLineText']);
  it('copies "[hh:mm] Speaker: text"', () => {
    const { copyLineText } = fns();
    expect(copyLineText({ n: 1, t: T, ch: 'guild', who: 'Corvale', text: 'pull in five' })).toBe('[13:03] Corvale: pull in five');
  });
  it('your own line is "You", an outgoing tell names who it went to, an NPC keeps its name', () => {
    const { copyLineText } = fns();
    expect(copyLineText({ t: T, ch: 'say', who: 'Aldenmar', self: true, text: 'hi' })).toBe('[13:03] You: hi');
    expect(copyLineText({ t: T, ch: 'tell', who: 'You', self: true, to: 'Corvale', text: 'sure' })).toBe('[13:03] You → Corvale: sure');
    expect(copyLineText({ t: T, ch: 'tell', who: 'Seer', npc: true, text: 'Jiva\'s strength fills your body.' })).toBe('[13:03] Seer: Jiva\'s strength fills your body.');
  });
  it('the timestamp is a <button class="tm"> (armed for the hover handshake by the preload), not a span', () => {
    expect(code).toContain('<button type="button" class="tm');
    expect(code).not.toMatch(/<span class="tm/);
    const lineHtml = evalBlock(`
      var _channels = { guild: { color: '#56d364', tag: 'GU', label: 'Guild' } }, _copiedN = 0, _chanNames = {}, _prefs = { offChannels: [], only: '' }, _isBrk = false;
      function esc(s){ return String(s == null ? '' : s); }
      ${sliceBlock(script, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
      ${HHMM}
      ${sliceBlock(script, 'function lineHtml(l, tag){',"+ esc(l.text) + '</span></div>';\n  }")}
    `, ['lineHtml', '_channels']);
    const html = lineHtml.lineHtml({ n: 7, t: T, ch: 'guild', who: 'Corvale', text: 'hi' });
    expect(html).toContain('<button type="button" class="tm" title="Click to copy this line">13:03</button>');
    expect(html).toContain('data-n="7"');
  });
  // the click handler, run for real against stand-in elements
  function harness({ clipboard }) {
    const state = { handlers: {}, timers: [], fallbackUsed: false };
    const row = { getAttribute: () => '7' };
    const btn = { textContent: '13:03', _cls: new Set(), isConnected: true, closest: sel => (sel === '.ln' ? row : btn),
      classList: { add: c => btn._cls.add(c), remove: c => btn._cls.delete(c) } };
    const feedEl = { addEventListener: (t, f) => { state.handlers[t] = f; } };
    const doc = { createElement: () => ({ style: {}, select() {}, remove() {} }), body: { appendChild() {} },
      execCommand: () => { state.fallbackUsed = true; return true; } };
    // eslint-disable-next-line no-new-func
    new Function('feedEl', 'navigator', 'document', 'setTimeout', 'clearTimeout', '_lines', `
      var _copiedN = 0;
      ${HHMM}
      ${COPYLINE}
      ${sliceBlock(script, 'function _copyText(text, done){', 'catch (e) { fallback(); }\n  }')}
      ${sliceBlock(script, 'var _copiedTimer = null', '_copiedTimer = setTimeout(_unflashCopied, 1200);\n    });\n  });')}
    `)(feedEl, { clipboard }, doc, (f) => { state.timers.push(f); return state.timers.length; }, () => {}, [{ n: 7, t: T, ch: 'guild', who: 'Corvale', text: 'hello' }]);
    return { state, btn, click: () => state.handlers.click({ target: { closest: sel => (sel === '.tm' ? btn : null) } }) };
  }
  it('click puts the line on the clipboard and the timestamp flashes "copied", then goes back', async () => {
    const written = [];
    const h = harness({ clipboard: { writeText: (t) => { written.push(t); return Promise.resolve(); } } });
    h.click();
    await Promise.resolve(); await Promise.resolve();
    expect(written).toEqual(['[13:03] Corvale: hello']);
    expect(h.btn.textContent).toBe('copied');
    expect(h.btn._cls.has('copied')).toBe(true);
    h.state.timers[0]();                       // the 1.2 s timer fires
    expect(h.btn.textContent).toBe('13:03');
    expect(h.btn._cls.has('copied')).toBe(false);
  });
  it('falls back to a hidden textarea when the clipboard API refuses, and flashes only if that worked', async () => {
    const h = harness({ clipboard: { writeText: () => Promise.reject(new Error('Document is not focused')) } });
    h.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.state.fallbackUsed).toBe(true);
    expect(h.btn.textContent).toBe('copied');
  });
  it('a click anywhere else in the feed does nothing', () => {
    const h = harness({ clipboard: { writeText: () => { throw new Error('should not copy'); } } });
    h.state.handlers.click({ target: { closest: () => null } });
    expect(h.btn.textContent).toBe('13:03');
  });
  it('uses the clipboard path the other overlays use (navigator.clipboard, then a textarea + execCommand)', () => {
    expect(code).toContain('navigator.clipboard.writeText(text)');
    expect(code).toContain("document.execCommand('copy')");
  });
});

// 8c. "Add breakout abilities for different tabs by right clicking the name of the chat type".
describe('chat.html: ?groups=<id> makes a breakout window, painted through the same filter', () => {
  const script = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));
  const code = stripJs(script);
  const parse = (s) => evalBlock(sliceBlock(script, 'function parseGroupsParam(search){', 'return out;\n  }'), ['parseGroupsParam']).parseGroupsParam(s);
  it('parses the query', () => {
    expect(parse('?groups=guild')).toEqual(['guild']);
    expect(parse('?x=1&groups=ooc,raid&y=2')).toEqual(['ooc', 'raid']);
    expect(parse('?groups=Guild%2CRaid')).toEqual(['guild', 'raid']);
    expect(parse('')).toEqual([]);
    expect(parse('?groups=')).toEqual([]);
  });
  it('keeps only lower-case group ids: nothing else gets through', () => {
    expect(parse('?groups=guild,guild,../x,a%20b,')).toEqual(['guild']);
    expect(parse('?groups=' + 'x'.repeat(17))).toEqual([]);
    expect(parse('?groups=%E0%A4%A')).toEqual([]);   // a malformed escape is not an error
    expect(parse('?groups=<script>')).toEqual([]);
  });
  const line = (ch) => ({ ch });
  const make = (prefs, only, out) => evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _prefs = ${JSON.stringify({ fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [], ...prefs })};
    var _only = ${JSON.stringify(only)};
    var _out = ${JSON.stringify(out)};
    var _isBrk = _only.length > 0;
    ${sliceBlock(script, 'function groupOf(ch){', 'return out;\n  }')}
  `, ['makeFilter', 'shownGroupIds']);
  it('a breakout shows its own group and nothing else', () => {
    const m = make({}, ['guild'], []);
    expect(m.shownGroupIds()).toEqual(['guild']);
    const f = m.makeFilter(m.shownGroupIds());
    expect(f(line('guild'))).toBe(true);
    for (const ch of ['raid', 'say', 'ooc', 'npc', 'auction']) expect(f(line(ch)), ch).toBe(false);
  });
  it('a breakout ignores the Chat window\'s chip choices (it has no chips)', () => {
    expect(make({ off: ['guild'] }, ['guild'], []).shownGroupIds()).toEqual(['guild']);
  });
  it('the Chat window leaves a broken-out group out, and the group is back the moment it is put back', () => {
    expect(make({}, [], ['guild', 'raid']).shownGroupIds()).toEqual(['say', 'ooc', 'auction', 'npc', 'zone']);
    expect(make({}, [], []).shownGroupIds()).toEqual(['guild', 'raid', 'say', 'ooc', 'auction', 'npc', 'zone']);
  });
  it('a gated group is still gated in its breakout: Tells shows nothing until Tells is on', () => {
    expect(make({}, ['tell'], ['tell']).shownGroupIds()).toEqual([]);
    expect(make({ tells: true }, ['tell'], []).shownGroupIds()).toEqual(['tell']);
    expect(make({}, ['officer'], []).shownGroupIds()).toEqual([]);
    expect(make({ officer: true }, ['officer'], []).shownGroupIds()).toEqual(['officer']);
  });
  it('OOC and Shout are one group, so one breakout carries both', () => {
    const m = make({}, ['ooc'], []);
    const f = m.makeFilter(m.shownGroupIds());
    expect(f(line('ooc'))).toBe(true);
    expect(f(line('shout'))).toBe(true);
  });
  it('a chip offers "Break out into its own window" / "Put back in the Chat window" on right-click, and an "out" chip says so', () => {
    expect(code).toContain("chipsEl.addEventListener('contextmenu'");
    expect(code).toContain("'Break out into its own window'");
    expect(code).toContain("'Put back in the Chat window'");
    expect(code).toContain('window.mimic.chatBreakout(id, on)');
    expect(code).toContain("(isOut ? ' <em>out</em>' : '')");
  });
  it('a breakout\'s title bar offers Put back too, and its ✕ does the same (main\'s hide-overlay puts it back)', () => {
    expect(code).toMatch(/querySelector\('\.title'\)\.addEventListener\('contextmenu'/);
  });
  it('every Chat window waits for its first prefs before polling, and re-reads them when another window changes them', () => {
    expect(code).toMatch(/async function tick\(\)\{[^}]*if \(!_prefsReady\) return;/);
    expect(code).toContain('window.mimic.onChatPrefsChanged(function(){ loadPrefs(); })');
    expect(code).toContain('window.mimic.onChatBreakouts(takeOut)');
  });
  it('the context menu is hover-armed: it is in the zone list and its items are buttons', () => {
    expect(code).toContain("document.createElement('button')");
    expect(code).toContain('#ctxmenu');
  });
});

describe('Mimic: breakout windows are a VARIABLE set, wired into every site a fixed overlay is', () => {
  const code = stripJs(MAIN);
  const fnBody = (head) => stripJs(sliceBlock(MAIN, head, '\n}\n'));
  it('are a Map keyed by group id, not one `let` each', () => {
    expect(code).toMatch(/^const chatBreakouts = new Map\(\);/m);
  });
  it('remember their own place per group (chatBounds_<id>) and are listed by _overlayEntries as chat:<id>', () => {
    expect(fnBody('function _boundsKeyForWindow(win) {')).toMatch(/for \(const \[gid, w\] of chatBreakouts\.entries\(\)\) \{\s+if \(w === win\) return 'chatBounds_' \+ gid;/);
    expect(fnBody('function _overlayEntries() {')).toContain("out.push(['chat:' + gid, win])");
    const create = fnBody('function createChatBreakout(gid) {');
    expect(create).toContain("const boundsKey = 'chatBounds_' + gid;");
    expect(create).toContain("loadFile('chat.html', { query: { groups: gid } })");
    expect(create).toContain('_persistBounds(boundsKey, win)');
    expect(create).toContain("applyOverlayOpacity(win, 'chat:' + gid)");
    expect(create).toContain('minWidth: _OVERLAY_MIN_W');
    expect(create).toContain("_resolveBounds(boundsKey, boundsKey + 'Sig'");
    expect(create).toContain("_wpPrefs('Chat ' + gid)");   // a named renderer in Task Manager, one per group
  });
  it('are built and freed by the same passes that build and free every overlay, so hide-all, Chat off and the EverQuest gate take them along', () => {
    expect(fnBody('function _materializeEnabledOverlays() {')).toContain('_syncChatBreakouts();');
    expect(fnBody('function _reapDisabledOverlays() {')).toContain('_syncChatBreakouts();');
    expect(fnBody('function createChatOverlay() {')).toContain('_syncChatBreakouts();');
    const sync = fnBody('function _syncChatBreakouts() {');
    expect(sync).toContain("_OVERLAY_WINDOWS.find(e => e.key === 'chat')");
    expect(sync).toContain('_overlayWanted(cfg, chatEntry)');   // Chat's own wanted rule: flag, hide-all, EQ gate, setup/unlock
  });
  it('show and hide with Chat (one gate), and are in the diagnostics list', () => {
    expect(fnBody('function applyChatVisibility() {')).toContain('chatBreakouts.values()');
    expect(code).toContain("put(win, 'Chat breakout · ' + gid)");
  });
  it('their ✕ puts the group back (it never leaves a channel with no window), ahead of the panel fallback', () => {
    const hide = stripJs(sliceBlock(MAIN, "ipcMain.handle('hide-overlay', (e) => {", '\n});'));
    const at = hide.indexOf('} else if (_chatBreakoutGroup(win)) {');
    expect(at).toBeGreaterThan(hide.indexOf('win === chatWindow'));
    expect(at).toBeLessThan(hide.indexOf('panelOverlays.entries()'));
    expect(hide.slice(at, hide.indexOf('panelOverlays.entries()'))).toContain('_chatBreakoutSet(_chatBreakoutGroup(win), false);');
  });
  it('the tray keeps a single "Chat" entry', () => {
    expect((code.match(/label: 'Chat \(/g) || [])).toHaveLength(1);
  });
  it('the preload exposes the four breakout calls', () => {
    const p = stripJs(PRELOAD);
    expect(p).toMatch(/chatBreakout:\s+\(groupId, on\) => ipcRenderer\.invoke\('chat-breakout', String\(groupId \|\| ''\), !!on\)/);
    expect(p).toMatch(/getChatBreakouts:\s+\(\)\s+=> ipcRenderer\.invoke\('chat-breakouts-get'\)/);
    expect(p).toMatch(/onChatBreakouts:\s+\(cb\)\s+=> ipcRenderer\.on\('chat-breakouts'/);
    expect(p).toMatch(/onChatPrefsChanged:\s+\(cb\)\s+=> ipcRenderer\.on\('chat-prefs-changed'/);
  });
  it('a prefs change reaches every Chat window (the agent keeps the LAST switches, so they must agree), and so does the Tells setting', () => {
    expect(stripJs(sliceBlock(MAIN, "ipcMain.handle('chat-prefs-set'", '\n});'))).toContain("_pushChatWindows('chat-prefs-changed');");
    expect(code).toMatch(/hasOwnProperty\.call\(incoming, 'tellsMode'\)\) _pushChatWindows\('chat-prefs-changed'\);/);
  });
  it('the list is in the default config (empty)', () => {
    expect(stripJs(sliceBlock(MAIN, 'function defaultConfig() {', '\n}\n'))).toMatch(/chatBreakouts: \[\],/);
  });

  // The real logic, run: the list, the toggle and the sync, with the Electron pieces stubbed.
  function mk(cfg0, opts = {}) {
    const S = { wanted: opts.wanted !== false, single: opts.single || [], log: { created: [], destroyed: [], pushed: [], flushed: [] } };
    const start = MAIN.indexOf('const CHAT_BREAKOUT_MAX = 12;');
    const mid = MAIN.indexOf('function createChatBreakout(gid) {');
    const syncAt = MAIN.indexOf('function _syncChatBreakouts() {');
    const end = MAIN.indexOf("ipcMain.handle('chat-breakout',");
    const body = MAIN.slice(start, mid) + MAIN.slice(syncAt, end);
    // eslint-disable-next-line no-new-func
    const r = new Function('S', `
      let CFG = ${JSON.stringify(cfg0)};
      const chatBreakouts = new Map();
      let chatWindow = null;
      const _OVERLAY_WINDOWS = [{ key: 'chat', flag: 'showChat' }];
      const _live = (w) => !!w && !w.destroyed;
      const _agentOnly = () => false;
      const _overlayWanted = () => S.wanted;
      const _inSingleSetup = (w) => S.single.indexOf(w.gid) !== -1;
      const _flushBounds = (k) => S.log.flushed.push(k);
      const appendAgentLog = () => {};
      const setImmediate = (f) => f();
      const applyChatVisibility = () => {}; const applyOverlayInteractivity = () => {};
      function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
      function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); }
      function createChatBreakout(gid) { const w = { gid, destroyed: false, destroy() { this.destroyed = true; S.log.destroyed.push(gid); } }; chatBreakouts.set(gid, w); S.log.created.push(gid); }
      ${body}
      function _pushChatWindows(channel, payload) { S.log.pushed.push([channel, payload]); }
      return { _chatBreakoutIds, _chatBreakoutGroup, _chatBreakoutSet, _syncChatBreakouts, chatBreakouts, cfg: () => CFG };
    `)(S);
    return { r, S };
  }
  it('the saved list is sanitised: lower-case ids only, no duplicates, at most twelve', () => {
    const { r } = mk({});
    expect(r._chatBreakoutIds({ chatBreakouts: ['guild', 'guild', 'Raid', '../x', 7, 'a b', 'say'] })).toEqual(['guild', 'say']);
    expect(r._chatBreakoutIds({})).toEqual([]);
    expect(r._chatBreakoutIds({ chatBreakouts: 'guild' })).toEqual([]);
    expect(r._chatBreakoutIds({ chatBreakouts: 'abcdefghijklmnopqrst'.split('') })).toHaveLength(12);
  });
  it('breaking a group out saves it, tells every Chat window, and builds exactly one window for it', () => {
    const { r, S } = mk({ chatBreakouts: [] });
    expect(r._chatBreakoutSet('guild', true)).toEqual(['guild']);
    expect(r.cfg().chatBreakouts).toEqual(['guild']);
    expect(S.log.pushed).toEqual([['chat-breakouts', ['guild']]]);
    expect(S.log.created).toEqual(['guild']);
    r._chatBreakoutSet('guild', true);                               // twice: still one window, one entry
    expect(r.cfg().chatBreakouts).toEqual(['guild']);
    expect(S.log.created).toEqual(['guild']);
    r._chatBreakoutSet('raid', true);
    expect(S.log.created).toEqual(['guild', 'raid']);
  });
  it('putting a group back removes it from the list and closes its window', () => {
    const { r, S } = mk({ chatBreakouts: ['guild', 'raid'] });
    r._syncChatBreakouts();
    expect(S.log.created).toEqual(['guild', 'raid']);
    expect(r._chatBreakoutSet('guild', false)).toEqual(['raid']);
    expect(S.log.destroyed).toEqual(['guild']);
    expect(r.chatBreakouts.has('guild')).toBe(false);
    expect(r.chatBreakouts.has('raid')).toBe(true);
    expect(S.log.flushed).toEqual(['chatBounds_guild']);             // its place is saved before it goes
  });
  it('they come back after a restart: a fresh pass builds one per saved id', () => {
    const { r, S } = mk({ chatBreakouts: ['guild', 'tell'] });
    r._syncChatBreakouts();
    expect(S.log.created).toEqual(['guild', 'tell']);
    r._syncChatBreakouts();                                          // idempotent
    expect(S.log.created).toEqual(['guild', 'tell']);
  });
  it('Chat off / hide-all / the EverQuest gate (Chat not wanted) closes them all, and they return with it, still listed', () => {
    const { r, S } = mk({ chatBreakouts: ['guild', 'raid'] });
    r._syncChatBreakouts();
    S.wanted = false;
    r._syncChatBreakouts();
    expect(S.log.destroyed.sort()).toEqual(['guild', 'raid']);
    expect(r.chatBreakouts.size).toBe(0);
    expect(r.cfg().chatBreakouts).toEqual(['guild', 'raid']);        // closing them is not "put back"
    S.wanted = true;
    r._syncChatBreakouts();
    expect(S.log.created).toEqual(['guild', 'raid', 'guild', 'raid']);
  });
  it('a breakout being set up (Setup THIS) is spared while it is open', () => {
    const { r, S } = mk({ chatBreakouts: ['guild'] }, { single: ['guild'] });
    r._syncChatBreakouts();
    S.wanted = false;
    r._syncChatBreakouts();
    expect(S.log.destroyed).toEqual([]);
  });
  it('the renderer cannot make a window for anything but a group-id-shaped string, nor more than twelve', () => {
    const { r, S } = mk({ chatBreakouts: [] });
    for (const bad of ['../etc', 'Guild', '', 'a b', 'x'.repeat(17), null, undefined, 5]) r._chatBreakoutSet(bad, true);
    expect(S.log.created).toEqual([]);
    expect(r.cfg().chatBreakouts).toEqual([]);
    for (const g of 'abcdefghijklmnop'.split('')) r._chatBreakoutSet(g, true);
    expect(r.cfg().chatBreakouts).toHaveLength(12);
  });
});

// ── 9. Round 3 (the guild lead, 2026-10-14): channel tags, per-channel switches, "show only", Melee, window text ─────
function script_() { return CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>')); }
// The overlay's own filter, tag, switch, "show only" and window-text functions, sliced out of chat.html and run for
// real. opts: { brk: '<group id>' } makes it a breakout window; { lines: [...] } is what the window has seen.
function overlay(prefs, opts = {}) {
  const s = script_();
  const base = { fontSize: 12, group: false, officer: false, custom: false, tells: false, melee: false, spells: false, skills: false, off: [], offChannels: [], only: '', win: {} };
  return evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)};
    var _prefs = ${JSON.stringify({ ...base, ...prefs })};
    var _only = ${JSON.stringify(opts.brk ? [opts.brk] : [])}, _out = [], _isBrk = ${!!opts.brk}, _findQ = '', _chanNames = {}, _copiedN = 0;
    var _lines = ${JSON.stringify(opts.lines || [])}, _histLines = [];
    function brkGroupId(){ return _only[0] || ''; }
    function esc(s){ return String(s == null ? '' : s); }
    ${sliceBlock(s, 'function hhmm(t){', '}\n')}
    ${sliceBlock(s, 'function groupOf(ch){', 'return out;\n  }')}
    ${sliceBlock(s, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
    ${sliceBlock(s, 'function lineHtml(l, tag){', "+ esc(l.text) + '</span></div>';\n  }")}
    ${sliceBlock(s, 'function startsWithCI(s, q){', 'matchesFind(l, _findQ)); }')}
    ${sliceBlock(s, 'function winId(){', 'tags: w.tags !== false };\n  }')}
    ${sliceBlock(s, 'function seenChannels(){', 'return order.map(function(x){ return by[x]; });\n  }')}
    ${sliceBlock(s, 'function chanLabel(c){', "return c.num ? nm + ' (' + c.num + ')' : nm;\n  }")}
    ${sliceBlock(s, 'function onlyLabel(key){', "return c.tag ? '[' + c.tag + ']' : (c.label || key);\n  }")}
    function prefs(){ return _prefs; }
  `, ['makeFilter', 'shownGroupIds', 'learnChannel', 'chanName', 'chanKey', 'tagText', 'lineHtml', 'lineVisible', 'winId', 'winCfg',
    'seenChannels', 'chanLabel', 'onlyLabel', 'prefs']);
}

describe('channel tags: every line type, and a joined channel by its slot number', () => {
  beforeEach(() => agent._resetLocalChatForTest());
  const tagFor = (text) => {
    const evt = agent.classifyChatLine(L(text), ME);
    const ov = overlay({});
    return ov.tagText(evt);
  };
  const CASES = [
    ['guild', 'Corvale tells the guild, \'a\'', 'GU'], ['raid say', 'Corvale tells the raid, \'a\'', 'RS'],
    ['group', 'Corvale tells the group, \'a\'', 'P'], ['group, self', 'You tell your party, \'a\'', 'P'],
    ['officer', 'Rethlan tells Wolfpackofficer:5, \'a\'', 'OF'], ['say', 'Zarrin says, \'a\'', 'S'],
    ['shout', 'Zarrin shouts, \'a\'', 'SH'], ['ooc', 'Zarrin says out of character, \'a\'', 'OOC'],
    ['auction', 'Zarrin auctions, \'WTS a\'', 'AUC'], ['tell in', 'Corvale tells you, \'a\'', 'T'],
    ['tell out', 'You told Corvale, \'a\'', 'T'],
    ['joined channel', 'Zarrin tells General:2, \'a\'', '2'], ['joined channel, self', 'You say to Ports:4, \'a\'', '4'],
    ['joined channel, two digits', 'Zarrin tells Trade:12, \'a\'', '12'],
    ['Zeal /abc slot', '[2] [Zarrin]: a', '2'],
    ['zone change (no tag)', 'You have entered Plane of Knowledge.', ''],
    ['npc speech (no tag)', 'a goblin warrior says, \'You will not leave\'', ''],
  ];
  for (const [label, text, want] of CASES) it(label, () => expect(tagFor(text), text).toBe(want));
  it('the number comes from the LINE, so the same channel joined in another order is tagged with its new number', () => {
    expect(tagFor('Zarrin tells General:2, \'a\'')).toBe('2');
    expect(tagFor('Zarrin tells General:7, \'a\'')).toBe('7');
  });
  it('the agent serves the channel name and number on the row it hands the overlay', () => {
    agent.setChatPolicy({ custom: true }, 1);
    agent.noteLocalChatLine(L('Zarrin tells General:2, \'anyone for a group\''), ME, 1);
    agent.noteLocalChatLine(L('Zarrin tells Corvale:9, \'x\''), ME, 1);
    const rows = agent.serializeLocalChat({ custom: true }, 1).lines;
    expect(rows[0]).toMatchObject({ ch: 'custom', cn: 'General', cnum: 2 });
    expect(agent.CHAT_CHANNELS.guild.tag).toBe('GU');
  });
  it('the tag is drawn in front of the line with the channel name on hover; a joined channel shows [n] and its name', () => {
    const ov = overlay({});
    const html = ov.lineHtml({ n: 1, t: 0, ch: 'custom', who: 'Zarrin', text: 'hi', cn: 'General', cnum: 2 });
    expect(html).toContain('<span class="ctag" title="General">[2]</span>');
    expect(html.indexOf('ctag')).toBeLessThan(html.indexOf('class="who name"'));
    expect(ov.lineHtml({ n: 2, t: 0, ch: 'guild', who: 'Corvale', text: 'hi' })).toContain('<span class="ctag" title="Guild">[GU]</span>');
    expect(ov.lineHtml({ n: 3, t: 0, ch: 'zone', who: '', text: 'Plane of Knowledge' })).not.toContain('ctag');
  });
  it('/abc lines carry only the slot number: the name is learned from a line that has both', () => {
    const ov = overlay({});
    const abbrev = agent.classifyChatLine(L('[2] [Zarrin]: a'), ME);
    Object.assign(abbrev, { on: ME });
    expect(ov.chanKey(abbrev)).toBe('#2');
    ov.learnChannel({ ch: 'custom', cn: 'General', cnum: 2, on: ME });
    expect(ov.chanKey(abbrev)).toBe('general');
  });
});

describe('per-channel switches and "show only", run against the real overlay code', () => {
  const line = (cn, cnum, extra) => Object.assign({ n: 1, t: 0, ch: 'custom', who: 'Zarrin', text: 'hi', cn, cnum, on: ME }, extra);
  const guild = { n: 2, t: 0, ch: 'guild', who: 'Corvale', text: 'hi', on: ME };
  const raid = { n: 3, t: 0, ch: 'raid', who: 'Corvale', text: 'hi', on: ME };
  const shown = (ov, lines) => lines.filter(l => ov.lineVisible(ov.makeFilter(ov.shownGroupIds()), l));
  it('with no per-channel setting every channel shows', () => {
    const ov = overlay({ custom: true });
    expect(shown(ov, [line('General', 2), line('Ports', 4), guild])).toHaveLength(3);
  });
  it('switching one channel off hides only that channel\'s lines', () => {
    const ov = overlay({ custom: true, offChannels: ['general'] });
    const out = shown(ov, [line('General', 2), line('Ports', 4), guild, raid]);
    expect(out.map(l => l.cn || l.ch)).toEqual(['Ports', 'guild', 'raid']);
  });
  it('the switch follows the NAME: the same channel under another slot number is still off', () => {
    const ov = overlay({ custom: true, offChannels: ['general'] });
    expect(shown(ov, [line('General', 5)])).toHaveLength(0);
    expect(shown(ov, [line('GENERAL', 2)])).toHaveLength(0);
  });
  it('a /abc line is hidden once its slot is known to be that channel', () => {
    const ov = overlay({ custom: true, offChannels: ['general'] });
    ov.learnChannel(line('General', 2));
    expect(shown(ov, [{ n: 5, t: 0, ch: 'custom', who: 'Zarrin', text: 'hi', cnum: 2, on: ME }])).toHaveLength(0);
  });
  it('the ⚙ lists every channel seen with its number, plus a saved-off one that has not spoken yet', () => {
    const ov = overlay({ custom: true, offChannels: ['trade'] }, { lines: [line('General', 2), line('Ports', 4)] });
    expect(ov.seenChannels().map(c => ov.chanLabel(c))).toEqual(['General (2)', 'Ports (4)', 'trade']);
  });
  it('"show only" filters the view to that one channel and clears again', () => {
    const lines = [line('General', 2), line('Ports', 4), guild, raid];
    expect(shown(overlay({ custom: true, only: 'guild' }), lines)).toEqual([guild]);
    expect(shown(overlay({ custom: true, only: 'custom:general' }), lines).map(l => l.cn)).toEqual(['General']);
    expect(shown(overlay({ custom: true, only: '' }), lines)).toHaveLength(4);
  });
  it('"show only" is a view toggle: it neither reads nor writes the switches, and a switched-off channel stays off under it', () => {
    const ov = overlay({ custom: true, offChannels: ['general'], off: ['raid'], only: 'custom:general' });
    expect(shown(ov, [line('General', 2), guild])).toHaveLength(0);
    expect(ov.prefs().offChannels).toEqual(['general']);
    expect(ov.prefs().off).toEqual(['raid']);
  });
  it('a broken-out window ignores "show only"', () => {
    expect(shown(overlay({ only: 'raid' }, { brk: 'guild' }), [guild])).toEqual([guild]);
  });
  it('the pill text names the channel: [GU], or [2] General', () => {
    const ov = overlay({ custom: true }, { lines: [line('General', 2)] });
    expect(ov.onlyLabel('guild')).toBe('[GU]');
    expect(ov.onlyLabel('custom:general')).toBe('[2] General');
  });
  it('the menu is the chips\' menu (openMenu), the pill has a real ✕ button, and nothing writes the switches', () => {
    const code = script_().split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(code).toMatch(/feedEl\.addEventListener\('contextmenu'/);
    expect(code).toContain("label: 'Show all'");
    expect(code).toMatch(/openMenu\(e\.clientX, e\.clientY, items\)/);
    expect((code.match(/function openMenu\(/g) || [])).toHaveLength(1);
    expect(CHAT_HTML).toMatch(/<button type="button" id="onlyx"/);
    const setOnly = sliceBlock(code, 'function setOnly(key){', '\n  }');
    expect(setOnly).toContain("savePrefs({ only: _prefs.only })");
    expect(setOnly).not.toMatch(/offChannels|off:/);
  });
});

describe('Melee: one combined group, off by default, in a ring of its own', () => {
  beforeEach(() => agent._resetLocalChatForTest());
  const MELEE = [
    ['your hit', 'You slash a goblin for 120 points of damage.', true],
    ['your special', 'You flying kick a goblin for 200 points of damage.', true],
    ['your miss', 'You try to slash a goblin, but a goblin dodges!', true],
    ['a hit on you', 'a goblin hits YOU for 45 points of damage.', false],
    ['a miss on you', 'a goblin tries to hit YOU, but YOU parry!', false],
    ['someone else\'s hit', 'Brackwyn hits a goblin for 90 points of damage.', false],
    ['a pet\'s hit', 'Gobby bites a goblin for 12 points of damage.', false],
  ];
  for (const [label, text, mine] of MELEE) {
    it(label + ' classifies as [M]', () => {
      const evt = agent.classifyMeleeLine(L(text));
      expect(evt).toMatchObject({ ch: 'melee', self: mine, text });
      expect(agent.CHAT_CHANNELS[evt.ch].tag).toBe('M');
    });
  }
  it('spells, procs, DoTs, damage shields and chat are not melee', () => {
    for (const t of [
      'You hit a goblin for 5 points of non-melee damage.', 'Your Fireblast hits a goblin for 300 points of non-melee damage.',
      'a goblin has taken 12 damage from your Flame Lick.', 'a goblin was hit by non-melee for 14 points of damage.',
      'a goblin was pierced by thorns.', 'Zarrin tells General:2, \'anyone\'', 'You say, \'hello\'',
    ]) expect(agent.classifyMeleeLine(L(t)), t).toBeNull();
  });
  it('there is one melee grammar: parseEvent\'s, with MELEE_ABILITIES as the list of melee verbs', () => {
    const code = stripJs(AGENT_SRC);
    const fn = sliceBlock(code, 'function classifyMeleeLine(line, character) {', '\n}\n');
    expect(fn).toContain('parseEvent(line, ts)');
    expect(fn).toContain('MELEE_ABILITIES.has(');
    expect(fn).not.toMatch(/new RegExp|\.match\(|\/\^?\\\[/);
  });
  it('nothing is captured until the overlay asks for it, and the default view never carries it', () => {
    expect(agent.noteLocalChatLine(L('You slash a goblin for 120 points of damage.'), ME, 1)).toBe(false);
    agent.setChatPolicy({}, 1);
    expect(agent.noteLocalChatLine(L('You slash a goblin for 120 points of damage.'), ME, 1)).toBe(false);
    expect(agent._meleeRingForTest()).toHaveLength(0);
    agent.setChatPolicy({ melee: true }, 2);
    expect(agent.noteLocalChatLine(L('You slash a goblin for 120 points of damage.'), ME, 2)).toBe(true);
    expect(agent.serializeLocalChat({ melee: true }, 2).lines).toHaveLength(1);
    expect(agent.serializeLocalChat({ melee: false }, 3).lines).toHaveLength(0);     // asked off: held, not served
    expect(agent.CHAT_GROUPS.find(g => g.id === 'melee')).toMatchObject({ channels: ['melee'], gate: 'melee' });
  });
  it('in the overlay Melee stays out of the main view until its switch is on, then is a chip like any group', () => {
    const m = { n: 1, t: 0, ch: 'melee', who: '', text: 'You slash a goblin for 120 points of damage.' };
    const off = overlay({});
    expect(off.shownGroupIds()).not.toContain('melee');
    expect(off.makeFilter(off.shownGroupIds())(m)).toBe(false);
    const on = overlay({ melee: true });
    expect(on.shownGroupIds()).toContain('melee');
    expect(on.makeFilter(on.shownGroupIds())(m)).toBe(true);
    const brk = overlay({ melee: true }, { brk: 'melee' });                      // and it breaks out like any other group
    expect(brk.makeFilter(brk.shownGroupIds())(m)).toBe(true);
    expect(overlay({}, { brk: 'melee' }).makeFilter(overlay({}, { brk: 'melee' }).shownGroupIds())(m)).toBe(false);   // still gated until switched on
    expect(on.lineHtml(m)).toContain('[M]');
  });
  it('a melee flood cannot push chat out: separate rings, one cursor', () => {
    agent.setChatPolicy({ melee: true }, 1);
    for (let i = 0; i < 5; i++) agent.noteLocalChatLine(L(`Corvale tells the guild, 'line ${i}'`), ME, 1);
    for (let i = 0; i < 2000; i++) agent.noteLocalChatLine(`[Wed Oct 14 21:11:${String(i % 60).padStart(2, '0')} 2026] You slash a goblin for ${100 + i} points of damage.`, ME, 1);
    expect(agent._meleeRingForTest().length).toBeLessThanOrEqual(agent.CHAT_MELEE_RING_MAX);
    expect(agent._chatRingForTest().filter(r => r.ch === 'guild')).toHaveLength(5);
    // the cursor pages both rings in order
    const first = agent.serializeLocalChat({ melee: true }, 1);
    const seqs = first.lines.map(l => l.n);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const next = agent.serializeLocalChat({ melee: true, since: first.seq }, 1);
    expect(next.lines).toHaveLength(0);
  });
  it('two of your characters hear one swing once; the same swing twice in one log is real and kept', () => {
    agent.setChatPolicy({ melee: true }, 1);
    const sw = L('You slash a goblin for 120 points of damage.');
    expect(agent.noteLocalChatLine(sw, 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(sw, 'Brackwyn', 1)).toBe(false);
    expect(agent.noteLocalChatLine(sw, 'Aldenmar', 1)).toBe(true);
  });
  it('local only, excluded characters skipped: melee enters through the same guarded call as chat, and is never read elsewhere', () => {
    const code = stripJs(AGENT_SRC);
    expect(code.match(/classifyMeleeLine\(/g)).toHaveLength(2);                  // its definition, and noteLocalChatLine
    const note = sliceBlock(code, 'function noteLocalChatLine(line, character, now) {', '\n}\n');
    expect(note).toContain('classifyMeleeLine(line, character)');
    expect(note).not.toMatch(/chatBuffer|tellBuffer|enqueueUpload|fetch\(|writeFile/);
    const tap = code.indexOf('noteLocalChatLine(line, b.character)');
    expect(code.lastIndexOf('if (!_sourceExcluded) {', tap)).toBeGreaterThan(code.lastIndexOf('\n      const _sourceExcluded', tap) - 1);
  });
});

// ── 9b. Round 5 (the guild lead, 2026-10-14): Melee filtered the way EQ's own combat filters are, and coloured by category ──
describe('Melee categories, filters and colours (mine / on me / others\', misses)', () => {
  beforeEach(() => agent._resetLocalChatForTest());
  afterEach(() => agent._setZealStateForTest('Aldenmar', null));
  const CASES = [
    ['your hit',                'You slash a goblin for 120 points of damage.',                       'mine',   false],
    ['your special',            'You flying kick a goblin for 200 points of damage.',                 'mine',   false],
    ['your miss',               'You try to slash a goblin, but a goblin dodges!',                    'mine',   true],
    ['a hit on you',            'a goblin hits YOU for 45 points of damage.',                         'on_me',  false],
    ['a miss at you',           'a goblin tries to hit YOU, but YOU parry!',                          'on_me',  true],
    ['a mob missing you',       'A frenzied initiate tries to slash YOU, but misses!',                'on_me',  true],
    ['another player\'s hit',   'Brackwyn slashes a goblin for 90 points of damage.',                 'others', false],
    ['a mob hitting another',   'a goblin hits Brackwyn for 30 points of damage.',                    'others', false],
    ['a mob missing another',   'A frenzied initiate tries to slash Zarrin, but misses!',             'others', true],
    ['another player\'s miss',  'Brackwyn tries to slash a goblin, but a goblin ripostes!',           'others', true],
  ];
  for (const [label, text, cat, miss] of CASES) {
    it(`${label} is "${cat}"${miss ? ' and a miss' : ' and a hit'}`, () => {
      expect(agent.classifyMeleeLine(L(text), ME), text).toMatchObject({ ch: 'melee', cat, miss });
    });
  }
  it('your own pet\'s swings are "mine", but only for the character it belongs to; anyone else\'s pet is "others"', () => {
    agent._setZealStateForTest('Aldenmar', { gauges: [{ slot: 16, text: 'Gobby' }] });
    const pet = L('Gobby bites a goblin for 12 points of damage.');
    expect(agent.classifyMeleeLine(pet, 'Aldenmar')).toMatchObject({ cat: 'mine', miss: false });
    expect(agent.classifyMeleeLine(L('Gobby tries to bite a goblin, but misses!'), 'Aldenmar')).toMatchObject({ cat: 'mine', miss: true });
    expect(agent.classifyMeleeLine(pet, 'Brackwyn')).toMatchObject({ cat: 'others' });         // heard on someone else's log
    expect(agent.classifyMeleeLine(pet)).toMatchObject({ cat: 'others' });                      // no character: nothing is claimed
    expect(agent.classifyMeleeLine(L('Fluffy bites a goblin for 12 points of damage.'), 'Aldenmar')).toMatchObject({ cat: 'others' });
    expect(agent.classifyMeleeLine(L('a goblin hits Gobby for 9 points of damage.'), 'Aldenmar')).toMatchObject({ cat: 'others' });   // a hit ON your pet is not a hit on you
  });
  it('the category rides the ring and the page; a hit carries no miss flag', () => {
    agent.setChatPolicy({ melee: true }, 1);
    for (const [, text] of CASES) agent.noteLocalChatLine(L(text), ME, 1);
    const lines = agent.serializeLocalChat({ melee: true }, 1).lines;
    expect(lines.map(l => l.cat)).toEqual(CASES.map(c => c[2]));
    expect(lines.map(l => !!l.miss)).toEqual(CASES.map(c => c[3]));
    expect(lines[0]).not.toHaveProperty('miss');
  });
  it('the agent still hands over every melee line: the filter is the overlay\'s, so a switch is instant and loses nothing', () => {
    agent.setChatPolicy({ melee: true }, 1);
    for (const [, text] of CASES) agent.noteLocalChatLine(L(text), ME, 1);
    expect(agent._meleeRingForTest()).toHaveLength(CASES.length);
  });

  // The overlay's own filter, run for real over the lines the agent classified.
  const rows = () => CASES.map(([, text], i) => ({ n: i + 1, t: 0, ch: 'melee', who: '', text, ...agent.classifyMeleeLine(L(text), ME), }));
  const shown = (prefs) => { const ov = overlay({ melee: true, ...prefs }); const f = ov.makeFilter(ov.shownGroupIds()); return rows().filter(l => ov.lineVisible(f, l)).map(l => l.cat + (l.miss ? '-miss' : '')); };
  it('nothing changes by default: all four switches are on, and a line with no category always shows', () => {
    expect(shown({})).toHaveLength(CASES.length);
    expect(shown({ meleeShow: { mine: true, on_me: true, others: true, misses: true } })).toHaveLength(CASES.length);
    const ov = overlay({ melee: true, meleeShow: { mine: false, on_me: false, others: false, misses: false } });
    expect(ov.lineVisible(ov.makeFilter(ov.shownGroupIds()), { n: 1, t: 0, ch: 'melee', who: '', text: 'x' })).toBe(true);
  });
  it('switching off Others\' melee hides everyone else\'s lines and keeps mine and the ones at me', () => {
    const got = shown({ meleeShow: { mine: true, on_me: true, others: false, misses: true } });
    expect(got).not.toContain('others');
    expect(got).not.toContain('others-miss');
    expect(got).toEqual(expect.arrayContaining(['mine', 'mine-miss', 'on_me', 'on_me-miss']));
    expect(got).toHaveLength(CASES.filter(c => c[2] !== 'others').length);
  });
  it('each of My melee and Hits on me hides only its own category', () => {
    expect(shown({ meleeShow: { mine: false } }).some(x => x.startsWith('mine'))).toBe(false);
    expect(shown({ meleeShow: { mine: false } })).toHaveLength(CASES.filter(c => c[2] !== 'mine').length);
    expect(shown({ meleeShow: { on_me: false } }).some(x => x.startsWith('on_me'))).toBe(false);
    expect(shown({ meleeShow: { on_me: false } })).toHaveLength(CASES.filter(c => c[2] !== 'on_me').length);
  });
  it('Misses hides misses in every category and leaves every hit', () => {
    const got = shown({ meleeShow: { misses: false } });
    expect(got.some(x => x.endsWith('-miss'))).toBe(false);
    expect(got).toHaveLength(CASES.filter(c => !c[3]).length);
  });
  it('the switches only touch Melee: chat, spells and skills never pass through them', () => {
    const ov = overlay({ melee: true, spells: true, skills: true, guild: true, meleeShow: { mine: false, on_me: false, others: false, misses: false } });
    const f = ov.makeFilter(ov.shownGroupIds());
    for (const ch of ['guild', 'spell', 'skill']) expect(ov.lineVisible(f, { n: 1, t: 0, ch, who: '', text: 'x', cat: 'others', miss: true }), ch).toBe(true);
  });
  it('a Melee breakout obeys the same switches', () => {
    const ov = overlay({ melee: true, meleeShow: { others: false } }, { brk: 'melee' });
    const f = ov.makeFilter(ov.shownGroupIds());
    const [mine, , , , , , others] = rows();
    expect(ov.lineVisible(f, mine)).toBe(true);
    expect(ov.lineVisible(f, others)).toBe(false);
  });

  it('a colour per category, misses dimmer, as CSS variables with the channel colour as the fallback', () => {
    const css = stripCss(CHAT_HTML.slice(CHAT_HTML.indexOf('<style>'), CHAT_HTML.indexOf('</style>')));
    const v = (name) => (css.match(new RegExp('--' + name + ':(#[0-9a-f]{6})', 'i')) || [])[1];
    const names = ['c-melee-mine', 'c-melee-mine-miss', 'c-melee-on_me', 'c-melee-on_me-miss', 'c-melee-others', 'c-melee-others-miss',
      'c-spell-mine', 'c-spell-on_me', 'c-spell-others', 'c-skill-mine', 'c-skill-others'];
    for (const n of names) expect(v(n), n).toBeTruthy();
    expect(new Set(names.map(v)).size).toBe(names.length);                       // eleven different colours
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    for (const c of ['mine', 'on_me', 'others']) expect(lum(v(`c-melee-${c}-miss`)), `${c} miss is dimmer`).toBeLessThan(lum(v(`c-melee-${c}`)));
    const red = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const [r, g, b] = red(v('c-melee-on_me'));
    expect(r).toBeGreaterThan(g * 1.8); expect(r).toBeGreaterThan(b * 1.8);       // on me is red
    const [mr, mg, mb] = red(v('c-melee-mine'));
    expect(Math.min(mr, mg, mb)).toBeGreaterThan(220);                             // mine is near-white
    const [gr, gg, gb] = red(v('c-melee-others'));
    expect(Math.max(gr, gg, gb) - Math.min(gr, gg, gb)).toBeLessThan(40);          // others' is grey
    const ov = overlay({ melee: true, spells: true, skills: true });
    const html = (l) => ov.lineHtml({ n: 1, t: 0, who: '', text: 'x', ...l });
    expect(html({ ch: 'melee', cat: 'mine' })).toContain('--lc:var(--c-melee-mine,');
    expect(html({ ch: 'melee', cat: 'mine', miss: true })).toContain('--lc:var(--c-melee-mine-miss,');
    expect(html({ ch: 'melee', cat: 'on_me' })).toContain('--lc:var(--c-melee-on_me,');
    expect(html({ ch: 'melee', cat: 'others', miss: true })).toContain('--lc:var(--c-melee-others-miss,');
    expect(html({ ch: 'melee' })).toContain('--lc:' + agent.CHAT_CHANNELS.melee.color);          // no category: the channel colour, as before
    expect(html({ ch: 'spell', cat: 'mine' })).toContain('--lc:var(--c-spell-mine,');
    expect(html({ ch: 'spell', cat: 'on_me' })).toContain('--lc:var(--c-spell-on_me,');
    expect(html({ ch: 'skill', cat: 'others' })).toContain('--lc:var(--c-skill-others,');
    expect(html({ ch: 'spell' })).toContain('--lc:' + agent.CHAT_CHANNELS.spell.color);          // no category (an older agent): the group colour
    expect(html({ ch: 'skill' })).toContain('--lc:' + agent.CHAT_CHANNELS.skill.color);
    expect(html({ ch: 'guild' })).toContain('--lc:' + agent.CHAT_CHANNELS.guild.color);          // other channels untouched
  });
  it('the ⚙ offers the four switches while Melee is on, and sends only the one that changed', () => {
    const code = stripJs(CHAT_HTML);
    for (const k of ['mine', 'on_me', 'others', 'misses']) expect(code).toContain(`['${k}', `);
    expect(code).toContain("'My melee'");
    expect(code).toContain("'Hits on me'");
    expect(code).toContain("'Others\\' melee'");
    expect(code).toMatch(/savePrefs\(\{ meleeShow: patch \}\)/);
    expect(code).toMatch(/if \(_prefs\.melee && \(!_isBrk \|\| brkGroupId\(\) === 'melee'\)\)/);
  });
});

// ── 10. Round 5 (the guild lead, 2026-10-14): "chat can also have separable spell and skill information" ─────────────
describe('Spells [SP] and Skills [SK]: two more combined groups, built the way Melee was', () => {
  // A tiny catalog in the real shape ({ id, name, you, other, fades, dur, durf, good }): the landing and fade texts
  // are the spell's own, which is the only thing the classifier reads from it. The invented names are not anyone.
  const CATALOG = [
    { id: 1, name: 'Spirit of Wolf', you: 'You feel the spirit of wolf enter you.', other: 'is surrounded by a brief lupine aura.', fades: 'The spirit of wolf fades.', dur: 100, durf: 3, good: 1 },
    { id: 2, name: 'Tashania', you: 'You feel your magic resistance drop.', other: 'glances nervously about.', fades: 'You feel less nervous.', dur: 50, durf: 3, good: 0 },
    { id: 3, name: 'Hundred Fists Discipline', you: 'Your fists begin to blur.', other: '\'s fists begin to blur.', fades: 'Your fists slow down.', dur: 10, durf: 1, good: 1 },
  ];
  beforeAll(() => { agent._setSpellCatalogForTest(CATALOG); agent._rebuildLandingIndexesForTest(); });
  afterAll(() => { agent._setSpellCatalogForTest([]); agent._rebuildLandingIndexesForTest(); });
  beforeEach(() => agent._resetLocalChatForTest());

  // [label, log text, kind]
  const SPELLS = [
    ['your cast',                  'You begin casting Spirit of Wolf.', 'cast'],
    ['your song',                  'You begin singing Selo`s Accelerando.', 'cast'],
    ['another player\'s cast',     'Brackwyn begins to cast a spell.', 'cast'],
    ['a mob\'s cast',              'a goblin shaman begins to cast a spell.', 'cast'],
    ['a landing on you',           'You feel the spirit of wolf enter you.', 'landing'],
    ['a buff landing on another',  'Brackwyn is surrounded by a brief lupine aura.', 'landing'],
    ['a debuff landing on a mob',  'a goblin glances nervously about.', 'landing'],
    ['your spell damage',          'Your Frost Shard hits a goblin for 300 points of non-melee damage.', 'damage'],
    ['a proc worded as a swing',   'You hit a goblin for 5 points of non-melee damage.', 'damage'],
    ['hit by non-melee',           'a goblin was hit by non-melee for 14 points of damage.', 'damage'],
    ['a DoT tick',                 'a goblin has taken 12 damage from your Flame Lick.', 'damage'],
    ['a spell crit',               'Brackwyn delivers a critical blast!(300)', 'damage'],
    ['a heal on you',              'You have been healed for 50 points of damage.', 'heal'],
    ['your outgoing resist',       'Your target resisted the Tashania spell.', 'resist'],
    ['a resist of a mob\'s spell', 'You resist the Tashania spell!', 'resist'],
    ['a fizzle',                   'Your spell fizzles!', 'interrupt'],
    ['an interrupt',               'Your spell is interrupted.', 'interrupt'],
    ['another caster interrupted', 'Brackwyn\'s casting is interrupted!', 'interrupt'],
    ['a spell worn off',           'Your Spirit of Wolf spell has worn off.', 'fades'],
    ['a fade from the catalog',    'The spirit of wolf fades.', 'fades'],
  ];
  const SKILLS = [
    ['a skill-up',                 'You have become better at Swimming! (45)', 'skillup'],
    ['a language skill-up',        'You have become better at Common Tongue! (100)', 'skillup'],
    ['a taunt',                    'You taunt a goblin to ignore others and attack you!', 'ability'],
    ['a taunt attempt',            'You attempt to taunt a goblin.', 'ability'],
    ['mend',                       'You mend your wounds and heal some damage.', 'ability'],
    ['a failed mend',              'You have failed to mend your wounds.', 'ability'],
    ['a failed feign death',       'You have fallen to the ground.', 'ability'],
    ['another player\'s feign',    'Brackwyn has fallen to the ground.', 'ability'],
    ['forage',                     'You have scrounged up some food.', 'ability'],
    ['a failed forage',            'You fail to locate any food nearby.', 'ability'],
    ['a trap disarm',              'You have disarmed the trap.', 'ability'],
    ['an evade',                   'You have momentarily ducked away from the main combat.', 'ability'],
    ['a warrior stun',             'You stun a goblin.', 'ability'],
    ['a discipline starting',      'Your fists begin to blur.', 'discipline'],
    ['a discipline of another',    'Brackwyn assumes a defensive fighting style.', 'discipline'],
    ['a discipline fading',        'Your fists slow down.', 'discipline'],
    ['a discipline refused',       'You can use a new discipline in 3 minutes 10 seconds.', 'discipline'],
    ['a tradeskill success',       'You have fashioned the items together to create something new!', 'tradeskill'],
    ['a tradeskill failure',       'You lacked the skills to fashion the items together.', 'tradeskill'],
  ];
  // Everything Melee already takes, plus the spell and skill lines' near neighbours that are NOT theirs.
  const MELEE_LINES = [
    'You slash a goblin for 120 points of damage.', 'You kick a goblin for 20 points of damage.', 'You bash a goblin for 40 points of damage.',
    'You try to bash a goblin, but miss!', 'You try to kick a goblin, but a goblin dodges!', 'You harm touch a goblin for 500 points of damage.',
    'a goblin hits YOU for 45 points of damage.', 'a goblin tries to hit YOU, but YOU parry!', 'Brackwyn hits a goblin for 90 points of damage.',
  ];

  for (const [label, text, kind] of SPELLS) {
    it(`Spells: ${label} lands in the Spells group, tagged [SP]`, () => {
      const evt = agent.classifySpellLine(L(text), ME);
      expect(evt, text).toMatchObject({ ch: 'spell', who: '', text, kind, npc: false });
      expect(agent.CHAT_CHANNELS[evt.ch].tag).toBe('SP');
      expect(agent.CHAT_GROUPS.find(g => g.channels.includes(evt.ch))).toMatchObject({ id: 'spells', gate: 'spells' });
    });
  }
  for (const [label, text, kind] of SKILLS) {
    it(`Skills: ${label} lands in the Skills group, tagged [SK]`, () => {
      const evt = agent.classifySkillLine(L(text));
      expect(evt, text).toMatchObject({ ch: 'skill', who: '', text, kind, npc: false });
      expect(agent.CHAT_CHANNELS[evt.ch].tag).toBe('SK');
      expect(agent.CHAT_GROUPS.find(g => g.channels.includes(evt.ch))).toMatchObject({ id: 'skills', gate: 'skills' });
    });
  }
  it('first-person lines are marked yours; the rest are not', () => {
    expect(agent.classifySpellLine(L('You begin casting Spirit of Wolf.'), ME).self).toBe(true);
    expect(agent.classifySpellLine(L('Brackwyn begins to cast a spell.'), ME).self).toBe(false);
    expect(agent.classifySkillLine(L('Brackwyn has fallen to the ground.')).self).toBe(false);
  });

  it('melee lines are Melee\'s alone: neither Spells nor Skills takes a swing, a kick, a bash or a harm touch', () => {
    for (const t of MELEE_LINES) {
      expect(agent.classifyMeleeLine(L(t)), t).not.toBeNull();
      expect(agent.classifySkillLine(L(t)), `${t} must not be a skill`).toBeNull();
      expect(agent.classifySpellLine(L(t), ME), `${t} must not be a spell`).toBeNull();
    }
  });
  it('a skill is never a spell and a spell is never a skill, and disciplines belong to Skills whichever switch is on', () => {
    for (const [, t] of SKILLS) expect(agent.classifySpellLine(L(t), ME), `${t} must not be a spell`).toBeNull();
    for (const [, t] of SPELLS) expect(agent.classifySkillLine(L(t)), `${t} must not be a skill`).toBeNull();
  });
  it('a proc worded as a swing is Spells\'; a swing is Melee\'s: ownership does not depend on which switches are on', () => {
    const proc = L('You hit a goblin for 5 points of non-melee damage.');
    expect(agent.classifyMeleeLine(proc)).toBeNull();
    expect(agent.classifySpellLine(proc, ME)).not.toBeNull();
    agent.setChatPolicy({ melee: true, spells: true, skills: true }, 1);
    agent.noteLocalChatLine(proc, ME, 1);
    agent.noteLocalChatLine(L('You slash a goblin for 120 points of damage.'), ME, 1);
    expect(agent._meleeRingForTest().map(r => r.text)).toEqual(['You slash a goblin for 120 points of damage.']);
    expect(agent._spellRingForTest().map(r => r.text)).toEqual(['You hit a goblin for 5 points of non-melee damage.']);
    expect(agent._skillRingForTest()).toHaveLength(0);
  });
  it('chat is chat: a quoted spell or skill line is never pulled out of a message', () => {
    agent.setChatPolicy({ melee: true, spells: true, skills: true }, 1);
    for (const t of [
      'Corvale tells the guild, \'You begin casting Spirit of Wolf.\'', 'Corvale tells the raid, \'You have become better at Swimming! (45)\'',
      'Zarrin says, \'Brackwyn begins to cast a spell.\'', 'You say, \'You have fallen to the ground.\'',
    ]) expect(agent.noteLocalChatLine(L(t), ME, 1), t).toBe(true);
    expect(agent._spellRingForTest()).toHaveLength(0);
    expect(agent._skillRingForTest()).toHaveLength(0);
    expect(agent._chatRingForTest()).toHaveLength(4);
  });
  it('lines that are neither are dropped, not guessed at', () => {
    for (const t of ['Zarrin yawns.', 'You have entered the Plane of Fire.', 'Welcome to EverQuest!', 'You are hungry.', 'Corvale has become better at Swimming! (45)']) {
      expect(agent.classifySpellLine(L(t), ME), t).toBeNull();
      expect(agent.classifySkillLine(L(t)), t).toBeNull();
    }
    expect(agent.classifySpellLine('not a log line', ME)).toBeNull();
    expect(agent.classifySkillLine('')).toBeNull();
  });

  it('nothing is captured until the overlay asks, each switch is its own, and the default view never carries either', () => {
    const cast = L('You begin casting Spirit of Wolf.'), skillup = L('You have become better at Swimming! (45)');
    expect(agent.noteLocalChatLine(cast, ME, 1)).toBe(false);                         // no policy yet
    agent.setChatPolicy({}, 1);
    expect(agent.noteLocalChatLine(cast, ME, 1)).toBe(false);
    expect(agent.noteLocalChatLine(skillup, ME, 1)).toBe(false);
    expect(agent._spellRingForTest()).toHaveLength(0);
    expect(agent._skillRingForTest()).toHaveLength(0);
    agent.setChatPolicy({ spells: true }, 2);                                          // Spells alone
    expect(agent.noteLocalChatLine(cast, ME, 2)).toBe(true);
    expect(agent.noteLocalChatLine(skillup, ME, 2)).toBe(false);
    agent.setChatPolicy({ skills: true }, 3);                                          // Skills alone
    expect(agent.noteLocalChatLine(skillup, ME, 3)).toBe(true);
    expect(agent.noteLocalChatLine(L('You begin casting Spirit of Wolf. '), ME, 3)).toBe(false);
    expect(agent.serializeLocalChat({ spells: true, skills: true }, 4).lines.map(l => l.ch)).toEqual(['spell', 'skill']);
    expect(agent.serializeLocalChat({ spells: true }, 5).lines.map(l => l.ch)).toEqual(['spell']);
    expect(agent.serializeLocalChat({ skills: true }, 5).lines.map(l => l.ch)).toEqual(['skill']);
    expect(agent.serializeLocalChat({}, 6).lines).toHaveLength(0);                     // asked off: held, not served
  });
  it('/api/chat reads spells=1 and skills=1 as the switches', () => {
    agent.setChatPolicy({ spells: true, skills: true }, Date.now());
    agent.noteLocalChatLine(L('You begin casting Spirit of Wolf.'), ME);
    agent.noteLocalChatLine(L('You have become better at Swimming! (45)'), ME);
    const get = (qs) => { const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
      agent._handleLocalChatForTest({ url: '/api/chat?since=0' + qs, headers: {} }, res); return JSON.parse(res.body); };
    expect(get('&spells=1&skills=1').lines.map(l => l.ch)).toEqual(['spell', 'skill']);
    expect(get('&spells=1').lines.map(l => l.ch)).toEqual(['spell']);
    expect(get('').lines).toEqual([]);
    expect(get('&spells=1').groups.map(g => g.id)).toEqual(expect.arrayContaining(['spells', 'skills']));
  });
  it('in the overlay both stay out of the main view until their switch is on, then are chips like any group, and break out', () => {
    const sp = { n: 1, t: 0, ch: 'spell', who: '', text: 'You begin casting Spirit of Wolf.' };
    const sk = { n: 2, t: 0, ch: 'skill', who: '', text: 'You have become better at Swimming! (45)' };
    const off = overlay({});
    expect(off.shownGroupIds()).not.toContain('spells');
    expect(off.shownGroupIds()).not.toContain('skills');
    expect(off.makeFilter(off.shownGroupIds())(sp)).toBe(false);
    expect(off.makeFilter(off.shownGroupIds())(sk)).toBe(false);
    const on = overlay({ spells: true });                                              // one switch does not bring the other
    expect(on.shownGroupIds()).toContain('spells');
    expect(on.shownGroupIds()).not.toContain('skills');
    expect(on.makeFilter(on.shownGroupIds())(sp)).toBe(true);
    expect(on.makeFilter(on.shownGroupIds())(sk)).toBe(false);
    const both = overlay({ spells: true, skills: true });
    expect(both.makeFilter(both.shownGroupIds())(sk)).toBe(true);
    for (const [id, line] of [['spells', sp], ['skills', sk]]) {
      const brk = overlay({ spells: true, skills: true }, { brk: id });
      expect(brk.makeFilter(brk.shownGroupIds())(line), id).toBe(true);
      const still = overlay({}, { brk: id });
      expect(still.makeFilter(still.shownGroupIds())(line), `${id} breakout is still gated`).toBe(false);
    }
    expect(both.lineHtml(sp)).toContain('[SP]');
    expect(both.lineHtml(sk)).toContain('[SK]');
    expect(both.lineHtml(sp)).not.toContain('class="who');                             // no speaker, like melee and zone lines
  });
  it('both are breakable into windows of their own with their own text settings, like Melee', () => {
    const win = { spells: { fontSize: 10, lineGap: 'compact', times: false, tags: false }, skills: { fontSize: 16 } };
    expect(overlay({ win }, { brk: 'spells' }).winCfg()).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    expect(overlay({ win }, { brk: 'skills' }).winCfg()).toEqual({ fontSize: 16, lineGap: 'normal', times: true, tags: true });
    expect(overlay({ win }, { brk: 'spells' }).winId()).toBe('spells');
    // the group ids are letters only, which is what main.js accepts for a breakout and for a window id
    for (const id of ['spells', 'skills']) expect(id).toMatch(/^[a-z]{1,16}$/);
  });
  it('the overlay\'s ⚙ lists both switches and sends them with every poll', () => {
    const code = stripJs(CHAT_HTML);
    expect(code).toContain("['spells',  'Spells',");
    expect(code).toContain("['skills',  'Skills',");
    expect(code).toMatch(/'&spells=' \+ \(_prefs\.spells \? 1 : 0\) \+ '&skills=' \+ \(_prefs\.skills \? 1 : 0\)/);
    expect(code).toMatch(/spells: !!p\.spells, skills: !!p\.skills/);
  });

  it('a spell or skill flood cannot push anything out: a ring each, capped at 300, one cursor over all four', () => {
    agent.setChatPolicy({ melee: true, spells: true, skills: true }, 1);
    for (let i = 0; i < 5; i++) agent.noteLocalChatLine(L(`Corvale tells the guild, 'line ${i}'`), ME, 1);
    for (let i = 0; i < 10; i++) agent.noteLocalChatLine(`[Wed Oct 14 21:11:0${i} 2026] You slash a goblin for ${100 + i} points of damage.`, ME, 1);
    for (let i = 0; i < 2000; i++) {
      const s = String(i % 60).padStart(2, '0');
      agent.noteLocalChatLine(`[Wed Oct 14 21:12:${s} 2026] You begin casting Spell Number ${i}.`, ME, 1);
      agent.noteLocalChatLine(`[Wed Oct 14 21:13:${s} 2026] You have become better at Skill ${i}! (${i % 200})`, ME, 1);
    }
    expect(agent.CHAT_SPELL_RING_MAX).toBe(300);
    expect(agent.CHAT_SKILL_RING_MAX).toBe(300);
    expect(agent._spellRingForTest()).toHaveLength(300);
    expect(agent._skillRingForTest()).toHaveLength(300);
    expect(agent._spellRingForTest().pop().text).toBe('You begin casting Spell Number 1999.');   // the newest are kept
    expect(agent._chatRingForTest().filter(r => r.ch === 'guild')).toHaveLength(5);              // chat untouched
    expect(agent._meleeRingForTest()).toHaveLength(10);                                          // melee untouched
    const first = agent.serializeLocalChat({ melee: true, spells: true, skills: true }, 1);
    const seqs = first.lines.map(l => l.n);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(first.lines.length).toBeLessThanOrEqual(agent.CHAT_PAGE_MAX);
    expect(agent.serializeLocalChat({ melee: true, spells: true, skills: true, since: first.seq }, 1).lines).toHaveLength(0);
    // a switch that is off leaves that ring unread
    expect(agent.serializeLocalChat({ spells: true }, 1).lines.every(l => l.ch === 'spell')).toBe(true);
  });
  it('a bystander\'s line heard by two of your characters is one copy; your own first-person lines are each kept', () => {
    agent.setChatPolicy({ spells: true, skills: true }, 1);
    const other = L('Brackwyn begins to cast a spell.');
    expect(agent.noteLocalChatLine(other, 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(other, 'Corvale', 1)).toBe(false);
    const mine = L('You begin casting Spirit of Wolf.');
    expect(agent.noteLocalChatLine(mine, 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(mine, 'Corvale', 1)).toBe(true);                    // two characters, two casts
    const up = L('You have become better at Swimming! (45)');
    expect(agent.noteLocalChatLine(up, 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(up, 'Corvale', 1)).toBe(true);
    expect(agent._spellRingForTest()).toHaveLength(3);
    expect(agent._skillRingForTest()).toHaveLength(2);
  });

  it('there is no second grammar: the classifiers call the agent\'s own parsers and the catalog\'s own texts', () => {
    const code = stripJs(AGENT_SRC);
    const spellKind = sliceBlock(code, 'function _chatSpellKind(line, body, ts, character) {', '\n}\n');
    for (const used of ['parseEvent(line, ts)', 'resolveSelfCastLanding(line, character)', 'parseBuffLanding(line, character)',
      'parseDebuffLanding(line, character)', 'parseMechanicLanding(line)', '_CAST_FAIL_RX.test(line)', '_CH_INTERRUPT_OTHER_RX.test(line)',
      '_chatSpellTexts()', '_chatDamageIsMelee(ev)', 'CHAT_MELEE_PREFILTER_RX.test(line)']) expect(spellKind, used).toContain(used);
    expect(spellKind).not.toMatch(/new RegExp|\.match\(|\.exec\(/);                  // no pattern of its own: it only asks the parsers
    const skillKind = sliceBlock(code, 'function _chatSkillKind(line, body, ts) {', '\n}\n');
    for (const used of ['parseEvent(line, ts)', '_chatDiscKind(body)', '_ME_SKILL_LINES']) expect(skillKind, used).toContain(used);
    const disc = sliceBlock(code, 'function _chatDiscKind(body) {', '\n}\n');
    for (const used of ['_ME_DISCS', '_ME_DISC_OTHER', '_DEF_DOWN_SELF_RX', '_DEF_DOWN_OTHER_RX', '_DISC_REFUSAL_RX']) expect(disc, used).toContain(used);
    // the only patterns written here are the skill lines no parser reads, in one list
    expect(code).toContain('const CHAT_SKILL_TEXT_RXS = [');
  });
  it('local only, excluded characters skipped: both enter through the same guarded call as chat, and are read nowhere else', () => {
    const code = stripJs(AGENT_SRC);
    expect(code.match(/classifySpellLine\(/g)).toHaveLength(2);                          // its definition, and noteLocalChatLine
    expect(code.match(/classifySkillLine\(/g)).toHaveLength(2);
    const note = sliceBlock(code, 'function noteLocalChatLine(line, character, now) {', '\n}\n');
    expect(note).toContain('classifySpellLine(line, character)');
    expect(note).toContain('classifySkillLine(line)');
    expect(note).not.toMatch(/chatBuffer|tellBuffer|enqueueUpload|fetch\(|writeFile/);
    const block = stripJs(AGENT_SRC.slice(AGENT_SRC.indexOf('// ── Spells and Skills rows'), AGENT_SRC.indexOf('// The overlay\'s switches, handed over')));
    expect(block.length).toBeGreaterThan(2000);                                          // the anchors found the block
    expect(block).not.toMatch(/chatBuffer|tellBuffer|enqueueUpload|fetch\(|writeFile|fs\./);
    const tap = code.indexOf('noteLocalChatLine(line, b.character)');
    expect(code.lastIndexOf('if (!_sourceExcluded) {', tap)).toBeGreaterThan(code.lastIndexOf('\n      const _sourceExcluded', tap) - 1);
  });
  it('history stays chat only: neither group is read back from the log files', () => {
    const hist = stripJs(HISTORY_BLOCK);
    expect(hist).not.toMatch(/classifyMeleeLine|classifySpellLine|classifySkillLine/);
  });

  // ── Categories: the Spells / Skills filters (the guild lead, 2026-10-14: "Filters for spells for others should be there as well") ──
  afterEach(() => agent._setZealStateForTest('Aldenmar', null));
  // [label, log text, cat]
  const SPELL_CATS = [
    ['you casting',                     'You begin casting Spirit of Wolf.',                                          'mine'],
    ['you singing',                     'You begin singing Selo`s Accelerando.',                                      'mine'],
    ['your spell damage',               'Your Frost Shard hits a goblin for 300 points of non-melee damage.',          'mine'],
    ['a proc worded as a swing',        'You hit a goblin for 5 points of non-melee damage.',                          'mine'],
    ['your DoT tick',                   'a goblin has taken 12 damage from your Flame Lick.',                          'mine'],
    ['your spell crit',                 'You deliver a critical blast!(300)',                                          'mine'],
    ['your outgoing heal',              'You have healed Brackwyn for 40 points.',                                     'mine'],
    ['your target resisting',           'Your target resisted the Tashania spell.',                                    'mine'],
    ['you resisting',                   'You resist the Tashania spell!',                                              'mine'],
    ['a fizzle',                        'Your spell fizzles!',                                                         'mine'],
    ['your interrupt',                  'Your spell is interrupted.',                                                  'mine'],
    ['your buff wearing off',           'Your Spirit of Wolf spell has worn off.',                                     'mine'],
    ['a catalog fade',                  'The spirit of wolf fades.',                                                   'mine'],
    ['a landing on you',                'You feel the spirit of wolf enter you.',                                      'on_me'],
    ['a debuff landing on you',         'You feel your magic resistance drop.',                                        'on_me'],
    ['a heal on you',                   'You have been healed for 50 points of damage.',                               'on_me'],
    ['a mob\'s spell damage to you',    'a goblin shaman hits YOU for 30 points of non-melee damage.',                 'on_me'],
    ['a player\'s spell damage to you', 'Brackwyn\'s Frost Shard hits YOU for 30 points of non-melee damage.',         'on_me'],
    ['an unsourced hit on you',         'You were hit by Frost Shard for 40 points of non-melee damage.',              'on_me'],
    ['another player casting',          'Brackwyn begins to cast a spell.',                                            'others'],
    ['a mob casting',                   'a goblin shaman begins to cast a spell.',                                     'others'],
    ['a buff landing on another',       'Brackwyn is surrounded by a brief lupine aura.',                              'others'],
    ['a debuff landing on a mob',       'a goblin glances nervously about.',                                           'others'],
    ['another player\'s spell damage',  'Brackwyn\'s Frost Shard hits a goblin for 300 points of non-melee damage.',   'others'],
    ['damage to another',               'a goblin was hit by non-melee for 14 points of damage.',                      'others'],
    ['a sourceless tick',               'a goblin has taken 12 damage.',                                               'others'],
    ['another player\'s spell crit',    'Brackwyn delivers a critical blast!(300)',                                    'others'],
    ['a heal on another',               'Brackwyn has been healed by Zarrin for 80 points of damage.',                 'others'],
    ['an exceptional heal',             'Zarrin performs an exceptional heal! (500)',                                  'others'],
    ['another caster interrupted',      'Brackwyn\'s casting is interrupted!',                                         'others'],
  ];
  const SKILL_CATS = [
    ['a skill-up',                      'You have become better at Swimming! (45)',                                    'mine'],
    ['a taunt',                         'You taunt a goblin to ignore others and attack you!',                         'mine'],
    ['a taunt attempt',                 'You attempt to taunt a goblin.',                                              'mine'],
    ['mend',                            'You mend your wounds and heal some damage.',                                  'mine'],
    ['your failed feign death',         'You have fallen to the ground.',                                              'mine'],
    ['forage',                          'You have scrounged up some food.',                                            'mine'],
    ['a stun',                          'You stun a goblin.',                                                          'mine'],
    ['an evade',                        'You have momentarily ducked away from the main combat.',                      'mine'],
    ['a tradeskill combine',            'You have fashioned the items together to create something new!',              'mine'],
    ['your discipline starting',        'Your fists begin to blur.',                                                   'mine'],
    ['your discipline fading',          'Your fists slow down.',                                                       'mine'],
    ['your defensive style ending',     'You return to your normal fighting style.',                                   'mine'],
    ['a discipline refusal',            'You can use a new discipline in 3 minutes 10 seconds.',                       'mine'],
    ['another player\'s discipline',    'Brackwyn assumes a defensive fighting style.',                                'others'],
    ['another player\'s style ending',  'Brackwyn returns to his normal fighting style.',                              'others'],
    ['another player feigning',         'Brackwyn has fallen to the ground.',                                          'others'],
  ];
  for (const [label, text, cat] of SPELL_CATS) {
    it(`Spells category: ${label} is "${cat}"`, () => {
      expect(agent.classifySpellLine(L(text), ME), text).toMatchObject({ ch: 'spell', cat });
    });
  }
  for (const [label, text, cat] of SKILL_CATS) {
    it(`Skills category: ${label} is "${cat}"`, () => {
      expect(agent.classifySkillLine(L(text)), text).toMatchObject({ ch: 'skill', cat });
    });
  }
  it('every category is one of the three words and each of the three occurs in the Spells table; Skills uses mine and others', () => {
    expect(new Set(SPELL_CATS.map(c => c[2]))).toEqual(new Set(['mine', 'on_me', 'others']));
    expect(new Set(SKILL_CATS.map(c => c[2]))).toEqual(new Set(['mine', 'others']));
  });
  it('a spell you cast landing on someone else is "mine"; the same landing on another player\'s cast is "others"', () => {
    const land = L('Brackwyn is surrounded by a brief lupine aura.');
    expect(agent.classifySpellLine(land, 'Corvale')).toMatchObject({ kind: 'landing', cat: 'others' });   // nothing cast yet
    agent.noteSelfCast(L('You begin casting Spirit of Wolf.'), 'Corvale');
    expect(agent.classifySpellLine(land, 'Corvale')).toMatchObject({ kind: 'landing', cat: 'mine' });      // the very cast that was begun
    expect(agent.classifySpellLine(land, ME)).toMatchObject({ kind: 'landing', cat: 'others' });           // heard on a different character's log
    expect(agent.classifySpellLine(land)).toMatchObject({ cat: 'others' });                                // no character: nothing is claimed
  });
  it('your pet\'s casts and interrupts are "mine", only for the character it belongs to; anyone else\'s pet is "others"', () => {
    agent._setZealStateForTest('Aldenmar', { gauges: [{ slot: 16, text: 'Gobby' }] });
    const cast = L('Gobby begins to cast a spell.'), intr = L('Gobby\'s casting is interrupted!');
    expect(agent.classifySpellLine(cast, 'Aldenmar')).toMatchObject({ cat: 'mine' });
    expect(agent.classifySpellLine(intr, 'Aldenmar')).toMatchObject({ cat: 'mine' });
    expect(agent.classifySpellLine(cast, 'Brackwyn')).toMatchObject({ cat: 'others' });
    expect(agent.classifySpellLine(cast)).toMatchObject({ cat: 'others' });
    expect(agent.classifySpellLine(L('Fluffy begins to cast a spell.'), 'Aldenmar')).toMatchObject({ cat: 'others' });
  });
  it('the category rides the ring and the page; kind stays private to the classifier', () => {
    agent.setChatPolicy({ spells: true, skills: true }, 1);
    for (const [, t] of SPELL_CATS) agent.noteLocalChatLine(L(t), ME, 1);
    for (const [, t] of SKILL_CATS) agent.noteLocalChatLine(L(t), ME, 1);
    const lines = agent.serializeLocalChat({ spells: true, skills: true }, 1).lines;
    const spells = lines.filter(l => l.ch === 'spell'), skills = lines.filter(l => l.ch === 'skill');
    expect(spells.map(l => l.cat)).toEqual(SPELL_CATS.map(c => c[2]));
    expect(skills.map(l => l.cat)).toEqual(SKILL_CATS.map(c => c[2]));
    expect(lines.every(l => !('kind' in l))).toBe(true);
  });

  // The overlay's own filter, run for real over the lines the agent classified.
  const spellRows = () => SPELL_CATS.map(([, text], i) => ({ n: i + 1, t: 0, who: '', text, ...agent.classifySpellLine(L(text), ME) }));
  const skillRows = () => SKILL_CATS.map(([, text], i) => ({ n: 100 + i, t: 0, who: '', text, ...agent.classifySkillLine(L(text)) }));
  const seen = (prefs, rows, opts) => { const ov = overlay({ spells: true, skills: true, ...prefs }, opts); const f = ov.makeFilter(ov.shownGroupIds()); return rows.filter(l => ov.lineVisible(f, l)); };
  it('nothing changes by default: every switch is on, and a line with no category (an older agent) always shows', () => {
    expect(seen({}, spellRows())).toHaveLength(SPELL_CATS.length);
    expect(seen({}, skillRows())).toHaveLength(SKILL_CATS.length);
    expect(seen({ spellShow: { mine: true, on_me: true, others: true }, skillShow: { mine: true, others: true } }, [...spellRows(), ...skillRows()])).toHaveLength(SPELL_CATS.length + SKILL_CATS.length);
    const off = { spellShow: { mine: false, on_me: false, others: false }, skillShow: { mine: false, others: false } };
    expect(seen(off, [{ n: 1, t: 0, ch: 'spell', who: '', text: 'x' }, { n: 2, t: 0, ch: 'skill', who: '', text: 'y' }])).toHaveLength(2);
  });
  it('each Spells switch hides only its own category', () => {
    for (const cat of ['mine', 'on_me', 'others']) {
      const got = seen({ spellShow: { [cat]: false } }, spellRows());
      expect(got.some(l => l.cat === cat), `${cat} hidden`).toBe(false);
      expect(got, `${cat} leaves the rest`).toHaveLength(SPELL_CATS.filter(c => c[2] !== cat).length);
    }
  });
  it('each Skills switch hides only its own category', () => {
    for (const cat of ['mine', 'others']) {
      const got = seen({ skillShow: { [cat]: false } }, skillRows());
      expect(got.some(l => l.cat === cat), `${cat} hidden`).toBe(false);
      expect(got, `${cat} leaves the rest`).toHaveLength(SKILL_CATS.filter(c => c[2] !== cat).length);
    }
  });
  it('the Spells switches never touch Skills, Melee or chat, and the Skills switches never touch Spells', () => {
    const off = { spellShow: { mine: false, on_me: false, others: false }, skillShow: { mine: false, others: false } };
    expect(seen({ skillShow: off.skillShow }, spellRows())).toHaveLength(SPELL_CATS.length);
    expect(seen({ spellShow: off.spellShow }, skillRows())).toHaveLength(SKILL_CATS.length);
    const ov = overlay({ melee: true, spells: true, skills: true, guild: true, ...off });
    const f = ov.makeFilter(ov.shownGroupIds());
    for (const ch of ['guild', 'melee']) expect(ov.lineVisible(f, { n: 1, t: 0, ch, who: '', text: 'x', cat: 'others' }), ch).toBe(true);
    expect(ov.lineVisible(f, { n: 1, t: 0, ch: 'spell', who: '', text: 'x', cat: 'others' })).toBe(false);
    expect(ov.lineVisible(f, { n: 1, t: 0, ch: 'skill', who: '', text: 'x', cat: 'others' })).toBe(false);
  });
  it('a Spells breakout and a Skills breakout obey the same switches', () => {
    expect(seen({ spellShow: { others: false } }, spellRows(), { brk: 'spells' }).some(l => l.cat === 'others')).toBe(false);
    expect(seen({ spellShow: { others: false } }, spellRows(), { brk: 'spells' })).toHaveLength(SPELL_CATS.filter(c => c[2] !== 'others').length);
    expect(seen({ skillShow: { mine: false } }, skillRows(), { brk: 'skills' }).some(l => l.cat === 'mine')).toBe(false);
  });

  it('the shades: mine / on me / others\' are three different purples, mine / others\' two different ambers, others\' dimmest, on me pinker', () => {
    const css = stripCss(CHAT_HTML.slice(CHAT_HTML.indexOf('<style>'), CHAT_HTML.indexOf('</style>')));
    const rgb = (name) => { const n = parseInt((css.match(new RegExp('--' + name + ':#([0-9a-f]{6})', 'i')) || [])[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sm = rgb('c-spell-mine'), so = rgb('c-spell-on_me'), sx = rgb('c-spell-others'), km = rgb('c-skill-mine'), kx = rgb('c-skill-others');
    expect(new Set([sm, so, sx, km, kx].map(c => c.join()))).toHaveProperty('size', 5);
    for (const c of [sm, so, sx]) expect(c[2], 'purple: blue beats green').toBeGreaterThan(c[1]);
    expect(so[0] / so[2]).toBeGreaterThan(sm[0] / sm[2]);                        // on me is redder / pinker than mine
    expect(so[1]).toBeLessThan(sm[1]);                                            // and less green
    expect(lum(sx)).toBeLessThan(lum(sm)); expect(lum(sx)).toBeLessThan(lum(so)); // others' is the dimmest
    for (const c of [km, kx]) expect(c[0], 'amber: red leads').toBeGreaterThan(c[2] * 1.8);
    expect(lum(kx)).toBeLessThan(lum(km));
    expect(agent.CHAT_CHANNELS.spell.color).toBe('#b392f0'); expect(agent.CHAT_CHANNELS.skill.color).toBe('#e3b341');   // the fallback is the bright shade, as before
  });
  it('the ⚙ offers My spells / On me / Others\' spells and My skills / Others\' skills, only while the group is on or in its own breakout', () => {
    const code = stripJs(CHAT_HTML);
    for (const t of ["'My spells'", "'On me'", "'Others\\' spells'", "'My skills'", "'Others\\' skills'", "pref: 'spellShow'", "pref: 'skillShow'"]) expect(code, t).toContain(t);
    for (const k of ['mine', 'on_me', 'others']) expect(code).toContain(`['${k}', `);
    expect(code).toMatch(/if \(_prefs\[row\.grp\] && \(!_isBrk \|\| brkGroupId\(\) === row\.grp\)\)/);
    expect(code).toMatch(/grp: 'spells', pref: 'spellShow'/);
    expect(code).toMatch(/grp: 'skills', pref: 'skillShow'/);
    expect(code).toMatch(/savePrefs\(wrap\)/);
    expect(code).toContain('id="spellopts"'); expect(code).toContain('id="skillopts"');
    expect(code).toMatch(/paintMeleeOpts\(\); paintShowOpts\(\)/);
  });
});

describe('each window\'s own text settings', () => {
  it('default to the shared size with normal spacing, timestamps and tags shown', () => {
    const ov = overlay({ fontSize: 14 });
    expect(ov.winCfg()).toEqual({ fontSize: 14, lineGap: 'normal', times: true, tags: true });
  });
  it('are read from the window\'s own entry: main and a breakout differ', () => {
    const win = { main: { fontSize: 18 }, melee: { fontSize: 10, lineGap: 'compact', times: false, tags: false } };
    expect(overlay({ win }).winCfg()).toEqual({ fontSize: 18, lineGap: 'normal', times: true, tags: true });
    expect(overlay({ win }, { brk: 'melee' }).winCfg()).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    expect(overlay({ win, fontSize: 13 }, { brk: 'guild' }).winCfg().fontSize).toBe(13);   // a window with no entry keeps the default
  });
  it('the window id is "main" or the breakout group; the ⚙ reaches a breakout\'s settings and hides the rest', () => {
    expect(overlay({}).winId()).toBe('main');
    expect(overlay({}, { brk: 'melee' }).winId()).toBe('melee');
    expect(CHAT_HTML).toMatch(/body\.brk #chips,body\.brk #onlypill,body\.brk #spanel \.nobrk\{display:none\}/);
    expect(CHAT_HTML).not.toMatch(/body\.brk[^{]*#gear/);
    expect(stripJs(CHAT_HTML)).toContain("label: 'Text settings…'");
  });
});

// ── 10. Round 4 (the guild lead, 2026-10-14): "this is getting crowded": the main channels up front, the rest under More ──
// The chip row and the ⚙ drawer, run against the real overlay code. There is no DOM here, so the page's element
// is a stub that records the HTML it was handed and the listeners it was given.
describe('the chip row: main channels up front, the rest under More', () => {
  const s = script_();
  const MAIN_ORDER = ['Guild', 'Raid', 'Party', 'Say', 'Tells', 'OOC/Shout'];
  const REST_ALL = ['Auction', 'NPC', 'Zones', 'Officer', 'Custom', 'Melee', 'Spells', 'Skills'];
  // opts: { brk, out, store (what localStorage already holds), groups }
  function row(prefs = {}, opts = {}) {
    const base = { fontSize: 12, group: false, officer: false, custom: false, tells: false, melee: false, spells: false, skills: false, off: [], offChannels: [], only: '', win: {} };
    const api = evalBlock(`
      var _groups = ${JSON.stringify(opts.groups || agent.CHAT_GROUPS)};
      var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)};
      var _prefs = ${JSON.stringify({ ...base, ...prefs })};
      var _only = ${JSON.stringify(opts.brk ? [opts.brk] : [])}, _out = ${JSON.stringify(opts.out || [])}, _isBrk = ${!!opts.brk};
      var __store = ${JSON.stringify(opts.store || {})};
      var localStorage = { getItem: function(k){ return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; }, setItem: function(k, v){ __store[k] = String(v); } };
      var handlers = {}, calls = { saved: [], broke: [], menu: null };
      var chipsEl = { innerHTML: '', addEventListener: function(t, f){ handlers[t] = f; } };
      function esc(s){ return String(s == null ? '' : s); }
      function brkGroupId(){ return _only[0] || ''; }
      function repaint(){} function openMenu(x, y, items){ calls.menu = items; }
      function savePrefs(p){ calls.saved.push(p); } function setBreakout(id, on){ calls.broke.push([id, on]); }
      ${sliceBlock(s, 'function groupOf(ch){', 'return out;\n  }')}
      ${sliceBlock(s, 'function winId(){', 'tags: w.tags !== false };\n  }')}
      ${sliceBlock(s, 'var MAIN_CHIPS = [', 'chipsEl.__wpHtml = h; }\n  }')}
      ${sliceBlock(s, "chipsEl.addEventListener('click', function(e){", 'paintChips(); repaint();\n  });')}
      ${sliceBlock(s, "chipsEl.addEventListener('contextmenu', function(e){", "run: function(){ setBreakout(id, true); } }]);\n  });")}
      paintChips();
      function isOpen(){ return _moreOpen; }
    `, ['paintChips', 'setMore', 'isOpen', 'shownGroupIds', 'makeFilter', 'chipsEl', 'handlers', 'calls', '__store', '_groups']);
    // the buttons the row holds
    api.buttons = () => [...api.chipsEl.innerHTML.matchAll(/<button type="button" class="chip([^"]*)"([^>]*)>(.*?)<\/button>/g)]
      .map(m => ({ cls: m[1].trim().split(/\s+/), attrs: m[2], label: m[3].replace(/<[^>]*>/g, '').trim(), g: (/data-g="([^"]*)"/.exec(m[2]) || [])[1] }));
    api.labels = () => api.buttons().map(b => b.label);
    // a click or a right-click on the chip whose group id is `id` (or the More chip), through the page's real handler
    api.fire = (type, id) => {
      const b = api.buttons().find(x => (id === 'more' ? /data-more/.test(x.attrs) : x.g === id));
      if (!b) throw new Error('no chip ' + id);
      const el = { getAttribute: (k) => (k === 'data-g' ? b.g : null), hasAttribute: (k) => k === 'data-more' && /data-more/.test(b.attrs) };
      api.handlers[type]({ target: { closest: () => el }, preventDefault() {}, clientX: 5, clientY: 6 });
    };
    return api;
  }
  const ALL_ON = { group: true, officer: true, custom: true, tells: true, melee: true, spells: true, skills: true };

  it('the main set is a short list constant, not markup: Guild, Raid, Party, Say, Tells, OOC/Shout, in that order', () => {
    expect(stripJs(s)).toContain("var MAIN_CHIPS = ['guild', 'raid', 'group', 'say', 'tell', 'ooc'];");
    const r = row(ALL_ON);
    expect(r.labels().slice(0, 6)).toEqual(MAIN_ORDER);
  });
  it('the main set renders in that order whatever order the agent lists the groups in', () => {
    const shuffled = agent.CHAT_GROUPS.slice().reverse();
    const r = row(ALL_ON, { groups: shuffled });
    expect(r.labels().slice(0, 6)).toEqual(MAIN_ORDER);
  });
  it('Party is the Group chip: the label changes, the id (and so every saved choice) does not', () => {
    const r = row(ALL_ON);
    const party = r.buttons().find(b => b.label === 'Party');
    expect(party.g).toBe('group');
    expect(r.labels()).not.toContain('Group');
  });
  it('a main chip whose switch is off is left out, the rest of the set keeps its order', () => {
    expect(row({}).labels().slice(0, 4)).toEqual(['Guild', 'Raid', 'Say', 'OOC/Shout']);   // no Party, no Tells until switched on
    expect(row({ tells: true }).labels().slice(0, 5)).toEqual(['Guild', 'Raid', 'Say', 'Tells', 'OOC/Shout']);
  });
  it('the rest are hidden until More opens, then follow the More chip', () => {
    const r = row(ALL_ON);
    expect(r.labels()).toEqual([...MAIN_ORDER, 'More (8) ▾']);
    for (const l of REST_ALL) expect(r.labels(), l).not.toContain(l);
    r.setMore(true);
    expect(r.labels()).toEqual([...MAIN_ORDER, 'More ▴', ...REST_ALL]);
    r.setMore(false);
    expect(r.labels()).toEqual([...MAIN_ORDER, 'More (8) ▾']);
  });
  it('More is a real button (the hover handshake), and says whether it is open', () => {
    const r = row(ALL_ON), more = () => r.buttons().find(b => /data-more/.test(b.attrs));
    expect(r.chipsEl.innerHTML).toMatch(/<button type="button" class="chip more[^"]*" data-more="1" aria-expanded="false"/);
    r.setMore(true);
    expect(more().attrs).toContain('aria-expanded="true"');
  });
  it('the More count is the chips inside that are ON, and shows only while it is closed', () => {
    // Auction, NPC and Zones always exist; Officer, Custom, Melee and Spells here: 7 on
    const r = row({ officer: true, custom: true, melee: true, spells: true });
    expect(r.labels().pop()).toBe('More (7) ▾');
    // three switched off with their chips: the count drops
    const r2 = row({ officer: true, custom: true, melee: true, spells: true, off: ['npc', 'zone', 'auction'] });
    expect(r2.labels().pop()).toBe('More (4) ▾');
    // a chip broken out into its own window is not on in this feed
    const r3 = row({ off: ['npc', 'zone'] }, { out: ['auction'] });
    expect(r3.labels().pop()).toBe('More ▾');
    // every chip inside off: no count, and the More chip is not lit
    const m4 = row({ off: ['npc', 'zone', 'auction'] }).buttons().pop();
    expect(m4.cls).toContain('more'); expect(m4.cls).not.toContain('on');
    // lit when something inside is on; open, it shows no count (the chips themselves say)
    const r5 = row({});
    expect(r5.buttons().pop().cls).toContain('on');
    r5.setMore(true);
    expect(r5.labels()).toContain('More ▴');
  });
  it('a click on More opens and folds it; a click on a chip inside it still switches that channel', () => {
    const r = row({});
    r.fire('click', 'more');
    expect(r.isOpen()).toBe(true);
    expect(r.labels()).toContain('Auction');
    r.fire('click', 'auction');
    expect(r.calls.saved).toEqual([{ off: ['auction'] }]);
    expect(r.buttons().find(b => b.g === 'auction').cls).not.toContain('on');
    r.fire('click', 'more');
    expect(r.isOpen()).toBe(false);
  });
  it('right-click on a chip inside More still offers to break it out, and the menu item does it', () => {
    const r = row({ melee: true });
    r.setMore(true);
    r.fire('contextmenu', 'melee');
    expect(r.calls.menu.map(i => i.label)).toEqual(['Break out into its own window']);
    r.calls.menu[0].run();
    expect(r.calls.broke).toEqual([['melee', true]]);
    // a chip that is already out offers to put it back, and is still found inside More
    const out = row({ melee: true }, { out: ['melee'] });
    out.setMore(true);
    expect(out.buttons().find(b => b.g === 'melee').cls).toContain('out');
    out.fire('contextmenu', 'melee');
    expect(out.calls.menu.map(i => i.label)).toEqual(['Put back in the Chat window']);
  });
  it('right-click on the More chip itself offers nothing (it is not a channel)', () => {
    const r = row({});
    r.fire('contextmenu', 'more');
    expect(r.calls.menu).toBeNull();
  });
  it('"show only" does not depend on More: a line from a channel inside it shows with the row closed', () => {
    const auc = { n: 1, t: 0, ch: 'auction', who: 'Nyssara', text: 'WTS' };
    const ov = overlay({ only: 'auction' });
    expect(ov.lineVisible(ov.makeFilter(ov.shownGroupIds()), auc)).toBe(true);
    const r = row({});          // More closed: the chip is out of sight, its lines are not
    expect(r.labels()).not.toContain('Auction');
    expect(r.makeFilter(r.shownGroupIds())(auc)).toBe(true);
  });
  it('the open state is remembered per window: written under the window id, read back on the next start', () => {
    const a = row({});
    a.setMore(true);
    expect(a.__store).toEqual({ 'wpChatMore:main': '1' });
    expect(row({}, { store: a.__store }).isOpen()).toBe(true);                                // a reopened Chat window
    expect(row({ melee: true }, { brk: 'melee', store: a.__store }).isOpen()).toBe(false);    // another window is unaffected
    a.setMore(false);
    expect(row({}, { store: a.__store }).isOpen()).toBe(false);
  });
  it('a window with blocked storage starts closed and still works', () => {
    const r = evalBlock(`
      var _groups = ${JSON.stringify(agent.CHAT_GROUPS)}, _channels = {}, _prefs = { off: [] }, _only = [], _out = [], _isBrk = false;
      var localStorage = { getItem: function(){ throw new Error('blocked'); }, setItem: function(){ throw new Error('blocked'); } };
      var chipsEl = { innerHTML: '' }; function esc(s){ return String(s); } function brkGroupId(){ return ''; }
      ${sliceBlock(s, 'function groupOf(ch){', 'return out;\n  }')}
      ${sliceBlock(s, 'function winId(){', 'tags: w.tags !== false };\n  }')}
      ${sliceBlock(s, 'var MAIN_CHIPS = [', 'chipsEl.__wpHtml = h; }\n  }')}
      function open(){ return _moreOpen; }
    `, ['open', 'setMore']);
    expect(r.open()).toBe(false);
    expect(() => r.setMore(true)).not.toThrow();
    expect(r.open()).toBe(true);
  });
  it('a breakout window gets no More (its chip row is hidden), and a row with nothing to fold gets none either', () => {
    const brk = row({ melee: true }, { brk: 'melee' });
    expect(brk.chipsEl.innerHTML).not.toContain('data-more');
    const small = row({}, { groups: agent.CHAT_GROUPS.filter(g => ['guild', 'raid', 'say'].includes(g.id)) });
    expect(small.labels()).toEqual(['Guild', 'Raid', 'Say']);
  });
  it('a group added later (not in the main set) lands under More with no change to the page', () => {
    const groups = [...agent.CHAT_GROUPS, { id: 'bard', label: 'Songs', channels: ['song'] }];
    const r = row({}, { groups });
    expect(r.labels()).not.toContain('Songs');
    r.setMore(true);
    expect(r.labels().pop()).toBe('Songs');
  });
  it('the chip row stays byte-stable across repaints, so a quiet poll never rewrites it', () => {
    expect(stripJs(s)).toContain('if (chipsEl.__wpHtml !== h) { chipsEl.innerHTML = h; chipsEl.__wpHtml = h; }');
  });
});

describe('the ⚙ drawer: text and the three opt-in channels up front, the rest under "More settings"', () => {
  const s = script_();
  const html = CHAT_HTML;
  const fold = html.slice(html.indexOf('<details id="moreset">'), html.indexOf('</details>') + '</details>'.length);
  const drawer = html.slice(html.indexOf('<div id="spanel">'), html.indexOf('<div id="chips">'));
  const outside = drawer.replace(fold, '');
  it('the fold is a <details> holding the Melee/Spells/Skills switches and "shows" rows, Channels and both notes', () => {
    expect(fold).toMatch(/^<details id="moreset"><summary[^>]*>More settings<\/summary>/);
    for (const id of ['moreoptins', 'meleeopts', 'spellopts', 'skillopts', 'chans', 'tellhint']) expect(fold, id).toContain(`id="${id}"`);
    expect(fold).toContain('These lines stay on this PC');
  });
  it('text size, spacing, timestamps, tags and Group/Officer/Custom stay outside the fold', () => {
    for (const id of ['fsm', 'fsz', 'fsp', 'lsp', 'textopts', 'optins']) expect(outside, id).toContain(`id="${id}"`);
    for (const id of ['moreoptins', 'meleeopts', 'spellopts', 'skillopts', 'chans', 'tellhint']) expect(outside, id).not.toContain(`id="${id}"`);
    expect(outside).not.toContain('These lines stay on this PC');
  });
  it('no control was removed: every id the drawer had is still there once', () => {
    for (const id of ['fsm', 'fsz', 'fsp', 'lsp', 'textopts', 'wintxt', 'optins', 'moreoptins', 'meleeopts', 'spellopts', 'skillopts', 'chans', 'tellhint'])
      expect(drawer.split(`id="${id}"`).length - 1, id).toBe(1);
  });
  // paintSettings with a stub document: which row each switch is written into
  function paint(prefs) {
    return evalBlock(`
      var _prefs = ${JSON.stringify({ group: false, officer: false, custom: false, melee: false, spells: false, skills: false, tells: false, ...prefs })};
      var els = {};
      var document = { getElementById: function(id){ return els[id] || (els[id] = { innerHTML: '', textContent: '' }); } };
      function esc(x){ return String(x); }
      function applyWin(){} function paintChans(){} function paintOnly(){} function paintMeleeOpts(){} function paintShowOpts(){} function paintMoreSet(){}
      ${sliceBlock(s, 'var OPTINS = [', '\n  ];')}
      ${sliceBlock(s, 'function paintSettings(){', "'Tells are off. Choose Local or Synced under Settings → Tells to show them here.';\n  }")}
      paintSettings();
    `, ['els']).els;
  }
  it('Group, Officer and Custom are written to the visible row; Melee, Spells and Skills to the fold', () => {
    const els = paint({ melee: true });
    const ids = (h) => [...h.matchAll(/data-optin="(\w+)"/g)].map(m => m[1]);
    expect(ids(els.optins.innerHTML)).toEqual(['group', 'officer', 'custom']);
    expect(ids(els.moreoptins.innerHTML)).toEqual(['melee', 'spells', 'skills']);
    expect(els.moreoptins.innerHTML).toMatch(/data-optin="melee" checked/);
    expect(els.moreoptins.innerHTML).not.toMatch(/data-optin="spells" checked/);
  });
  it('the moved switches still work: both rows share one change handler that saves the pref and repaints the chips', () => {
    const api = evalBlock(`
      var _prefs = { melee: false }, calls = [];
      function savePrefs(p){ calls.push(['save', p]); } function purgeGated(){ calls.push(['purge']); }
      function paintChips(){ calls.push(['chips']); } function repaint(){ calls.push(['repaint']); }
      ${sliceBlock(s, 'function onOptinChange(e){', 'purgeGated(); paintChips(); repaint();\n  }')}
    `, ['onOptinChange', '_prefs', 'calls']);
    api.onOptinChange({ target: { getAttribute: () => 'melee', checked: true } });
    expect(api._prefs.melee).toBe(true);
    expect(api.calls).toEqual([['save', { melee: true }], ['purge'], ['chips'], ['repaint']]);
    const code = stripJs(s);
    expect(code).toContain("document.getElementById('optins').addEventListener('change', onOptinChange);");
    expect(code).toContain("document.getElementById('moreoptins').addEventListener('change', onOptinChange);");
  });
  it('the Melee / Spells / Skills "shows" rows are still painted, into rows that live inside the fold', () => {
    expect(stripJs(s)).toMatch(/paintMeleeOpts\(\); paintShowOpts\(\); paintMoreSet\(\)/);
    for (const id of ['meleeopts', 'spellopts', 'skillopts']) expect(fold).toContain(`id="${id}"`);
  });
  // the fold's open state, and its hiding in a breakout that would show nothing in it
  function foldApi(opts = {}) {
    const rows = { meleeopts: opts.melee ? '<span>Melee shows</span>' : '', spellopts: '', skillopts: '' };
    return evalBlock(`
      var __store = ${JSON.stringify(opts.store || {})}, el = { open: false, style: {}, listeners: {} };
      var rows = ${JSON.stringify(rows)};
      var localStorage = { getItem: function(k){ return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; }, setItem: function(k, v){ __store[k] = String(v); } };
      var document = { getElementById: function(id){ return id === 'moreset' ? el : { innerHTML: rows[id] || '' }; } };
      el.addEventListener = function(t, f){ el.listeners[t] = f; };
      var _isBrk = ${!!opts.brk}, _only = ${JSON.stringify(opts.brk ? [opts.brk] : [])};
      function brkGroupId(){ return _only[0] || ''; }
      ${sliceBlock(s, 'function winId(){', 'tags: w.tags !== false };\n  }')}
      ${sliceBlock(s, "var moreSetEl = document.getElementById('moreset');", "moreSetEl.style.display = (_isBrk && !any) ? 'none' : '';\n  }")}
    `, ['el', '__store', 'paintMoreSet']);
  }
  it('the fold remembers open or shut per window, and starts shut with nothing remembered', () => {
    expect(foldApi().el.open).toBe(false);
    expect(foldApi({ store: { 'wpChatMoreSet:main': '1' } }).el.open).toBe(true);
    const f = foldApi();
    f.el.open = true; f.el.listeners.toggle();
    expect(f.__store).toEqual({ 'wpChatMoreSet:main': '1' });
    f.el.open = false; f.el.listeners.toggle();
    expect(f.__store['wpChatMoreSet:main']).toBe('0');
    expect(foldApi({ brk: 'melee', store: { 'wpChatMoreSet:main': '1' } }).el.open).toBe(false);   // another window is unaffected
  });
  it('a breakout\'s drawer shows the fold only when it holds something (a Melee, Spells or Skills window)', () => {
    const guild = foldApi({ brk: 'guild' }); guild.paintMoreSet();
    expect(guild.el.style.display).toBe('none');
    const melee = foldApi({ brk: 'melee', melee: true }); melee.paintMoreSet();
    expect(melee.el.style.display).toBe('');
    const main = foldApi(); main.paintMoreSet();
    expect(main.el.style.display).toBe('');
  });
  it('the summary is armed for the hover handshake, so the fold opens on a locked overlay', () => {
    expect(fold).toMatch(/<summary data-wp-interact>/);
  });
});

// Mutation checks run when this file was written (2026-10-14), each reverted after it went red:
//   • moved the noteLocalChatLine call out of `if (!_sourceExcluded) {…}`     → red, but ONLY after the first draft of the nesting
//     check was fixed: it counted the `try {` that wraps the call as an open guard and stayed green
//   • pushed a chat line into chatBuffer inside noteLocalChatLine             → the buffer-untouched and the block-scan tests went red
//   • dropped `gate: 'officer'` from the officer group                        → the gated-groups and default-hidden tests went red
//   • let tells through whatever policy.tells says                            → "tells are kept only when…" went red
//   • `<` instead of `<=` in the cursor loop of serializeLocalChat            → the cursor test went red
//   • removed the ZEALTAG / ZT early return from classifyChatLine             → the three /tag cases went red
//   • removed 'showChat' from _HIDEALL_FLAGS, 'chat' from the rescue KNOWN list, and
//     chat: 'showChat' from the dashboard's flag map (one at a time)           → each was caught (the first by the lifecycle suite too)
//   • class="name" on the "You" span                                          → the class="name" test went red
//   • (round 4) counted every chip under More instead of only the ones that are on  → the More-count test went red
//   • (round 4) dropped the localStorage write in setMore                      → the per-window open-state test went red
// Not mutation-checked: the "call runs ahead of shouldKeep" ordering test (it asserts an index comparison that no
// natural edit flips without also tripping the guard test).
