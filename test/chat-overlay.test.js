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

import { describe, it, expect, beforeEach } from 'vitest';
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
  it('the gated groups are exactly tells, group, officer and custom: the private ones', () => {
    const gated = Object.fromEntries(agent.CHAT_GROUPS.filter(g => g.gate).map(g => [g.id, g.gate]));
    expect(gated).toEqual({ tell: 'tells', group: 'group', officer: 'officer', custom: 'custom' });
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
    expect(agent.chatPolicyNow(T0 + agent.CHAT_POLICY_TTL_MS + 1)).toEqual({ tells: false, group: false, officer: false, custom: false });
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
    expect(uses.filter(l => /^classifyChatLine, noteLocalChatLine, serializeLocalChat,/.test(l))).toHaveLength(1);
    expect(uses.filter(l => /^_chatRingForTest: \(\) => _chatRing, _handleLocalChatForTest: _handleLocalChat,$/.test(l))).toHaveLength(1);
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
    expect(script).toMatch(/el\.closest\('\.title, #chips, #cpick, #spanel, #feed, #newchip, #ctxmenu'\)/);
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
  it('defaults: 12 px, group/officer/custom off, nothing hidden, tells off', async () => {
    const m = load({});
    expect(await m.get('Aldenmar')).toEqual({ fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [] });
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
      var _channels = { guild: { color: '#56d364' } }, _copiedN = 0;
      function esc(s){ return String(s == null ? '' : s); }
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
// Not mutation-checked: the "call runs ahead of shouldKeep" ordering test (it asserts an index comparison that no
// natural edit flips without also tripping the guard test).
