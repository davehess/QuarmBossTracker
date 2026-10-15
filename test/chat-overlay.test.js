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
  it('the gated groups are exactly tells, group, officer, custom, melee, spells, skills, loot, random and other: the private ones, and the floods', () => {
    const gated = Object.fromEntries(agent.CHAT_GROUPS.filter(g => g.gate).map(g => [g.id, g.gate]));
    expect(gated).toEqual({ tell: 'tells', group: 'group', officer: 'officer', custom: 'custom', melee: 'melee', spells: 'spells', skills: 'skills', loot: 'loot', random: 'random', other: 'other' });
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
    expect(agent.chatPolicyNow(T0 + agent.CHAT_POLICY_TTL_MS + 1)).toEqual({ tells: false, group: false, officer: false, custom: false, melee: false, spells: false, skills: false, loot: false, random: false, other: false, away: false });
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
    expect(await m.get('Aldenmar')).toEqual({ fontSize: 12, group: true, officer: false, custom: true, tells: false, off: [], melee: false, spells: false, skills: false, loot: false, random: false, other: false, away: true, meleeShow: { mine: true, on_me: true, others: true, misses: true }, spellShow: { mine: true, on_me: true, others: true }, skillShow: { mine: true, others: true }, offChannels: [], only: '', win: {} });
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
      melee: false, spells: false, skills: false, loot: false, random: false, other: false, away: true, meleeShow: { mine: true, on_me: true, others: true, misses: true },
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
    await m.set('Aldenmar', { win: { b1: { fontSize: 10, lineGap: 'compact', times: false, tags: false } } });
    let got = await m.get('Aldenmar');
    expect(got.win.main).toEqual({ fontSize: 18 });
    expect(got.win.b1).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    await m.set('Aldenmar', { win: { b1: { times: true } } });                       // one field merges in; the rest stay
    got = await m.get('Aldenmar');
    expect(got.win.b1).toEqual({ fontSize: 10, lineGap: 'compact', times: true, tags: false });
    expect(got.win.main).toEqual({ fontSize: 18 });
    expect(got.fontSize).toBe(14);                                                   // the shared size (every window's default) is untouched
    expect((await m.get('Brackwyn')).win.b1.tags).toBe(false);                       // survives a reopen / another character
  });
  it('the renderer cannot store anything but valid window ids and fields', async () => {
    const m = load({});
    await m.set('Aldenmar', { win: { 'Bad Id': { fontSize: 12 }, main: { fontSize: 99, lineGap: 'huge', times: 'no', evil: 1 }, b2: { lineGap: 'compact' }, guild: { lineGap: 'compact' }, b1234: { fontSize: 11 } } });
    const stored = m.saved().pop().chatPrefs.win;
    // a window is main or b<n>: a bare group id (what an older Mimic saved) is no longer a window id
    expect(stored).toEqual({ main: {}, b2: { lineGap: 'compact' } });
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
      ${sliceBlock(script, 'function lineHtml(l, tag){',"+ viaMark + '</div>';\n  }")}
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
  const make = (prefs, only, out, brkOff) => evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _prefs = ${JSON.stringify({ fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [], ...prefs })};
    var _only = ${JSON.stringify(only)};
    var _out = ${JSON.stringify(out)};
    var _isBrk = _only.length > 0;
    var _brkOff = ${JSON.stringify(brkOff || [])};
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
  it('a chip offers a way to move its group on right-click, and an "out" chip says so', () => {
    expect(code).toContain("chipsEl.addEventListener('contextmenu'");
    expect(code).toContain("'Break out into its own window'");
    expect(code).toContain("'Move to main window'");
    expect(code).toContain("'Move to window ▸'");
    expect(code).toContain("'New window'");
    expect(code).toContain('window.mimic.chatMoveGroup(id, target)');
    expect(code).toContain("(isOut ? ' <em>out</em>' : '')");
  });
  it('a breakout\'s title bar offers Put back too, and its ✕ does the same (main\'s hide-overlay puts every group back)', () => {
    expect(code).toMatch(/querySelector\('\.title'\)\.addEventListener\('contextmenu'/);
    expect(code).toContain("'Put back in the Chat window'");
    expect(code).toContain('window.mimic.chatBreakoutClose(_wid)');
  });
  it('a breakout window keeps its chip row (it was hidden before); only "show only" and the Chat window\'s switches stay behind', () => {
    const css = stripCss(CHAT_HTML.slice(CHAT_HTML.indexOf('<style>'), CHAT_HTML.indexOf('</style>')));
    expect(css).toMatch(/body\.brk #onlypill,body\.brk #spanel \.nobrk\{display:none\}/);
    expect(css).not.toMatch(/body\.brk[^{]*#chips/);
  });
  it('the window id comes from ?win=b<n> and nothing else', () => {
    const w = (s) => evalBlock(sliceBlock(script, 'function parseWinParam(search){', "return m ? m[1] : '';\n  }"), ['parseWinParam']).parseWinParam(s);
    expect(w('?win=b1&groups=guild,raid')).toBe('b1');
    expect(w('?groups=guild&win=b12')).toBe('b12');
    for (const bad of ['', '?win=', '?win=main', '?win=b', '?win=B1', '?win=b1234', '?win=../x', '?xwin=b1']) expect(w(bad), bad).toBe('');
  });
  it('a breakout holding several groups shows all of them and nothing else; a group it holds but has hidden is left out', () => {
    const m = make({ melee: true, spells: true }, ['melee', 'spells'], []);
    expect(m.shownGroupIds()).toEqual(['melee', 'spells']);
    const f = m.makeFilter(m.shownGroupIds());
    expect(f(line('melee'))).toBe(true);
    expect(f(line('spell'))).toBe(true);
    for (const ch of ['guild', 'skill', 'say']) expect(f(line(ch)), ch).toBe(false);
    expect(make({ melee: true, spells: true }, ['melee', 'spells'], [], ['spells']).shownGroupIds()).toEqual(['melee']);
  });
  it('a gated group in a multi-group window is still gated: Guild + Officer shows Guild only until Officer is switched on', () => {
    expect(make({}, ['guild', 'officer'], []).shownGroupIds()).toEqual(['guild']);
    expect(make({ officer: true }, ['guild', 'officer'], []).shownGroupIds()).toEqual(['guild', 'officer']);
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
  it('are a Map keyed by breakout window id (b1, b2...), not one `let` each and not one per group', () => {
    expect(code).toMatch(/^const chatBreakouts = new Map\(\);/m);
  });
  it('remember their own place per WINDOW (chatBounds_<window id>) and are listed by _overlayEntries as chat:<window id>', () => {
    expect(fnBody('function _boundsKeyForWindow(win) {')).toMatch(/for \(const \[wid, w\] of chatBreakouts\.entries\(\)\) \{\s+if \(w === win\) return 'chatBounds_' \+ wid;/);
    expect(fnBody('function _overlayEntries() {')).toContain("out.push(['chat:' + wid, win])");
    const create = fnBody('function createChatBreakout(wid, groups) {');
    expect(create).toContain("const boundsKey = 'chatBounds_' + wid;");
    expect(create).toContain("loadFile('chat.html', { query: { win: wid, groups: (groups || []).join(',') } })");
    expect(create).toContain('_persistBounds(boundsKey, win)');
    expect(create).toContain("applyOverlayOpacity(win, 'chat:' + wid)");
    expect(create).toContain('minWidth: _OVERLAY_MIN_W');
    expect(create).toContain("_resolveBounds(boundsKey, boundsKey + 'Sig'");
    expect(create).toContain("_wpPrefs('Chat ' + wid)");   // a named renderer in Task Manager, one per window
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
    expect(code).toContain("put(win, 'Chat breakout · ' + wid)");
  });
  it('their ✕ puts EVERY group in the window back (it never leaves a channel with no window), ahead of the panel fallback', () => {
    const hide = stripJs(sliceBlock(MAIN, "ipcMain.handle('hide-overlay', (e) => {", '\n});'));
    const at = hide.indexOf('} else if (_chatBreakoutWinId(win)) {');
    expect(at).toBeGreaterThan(hide.indexOf('win === chatWindow'));
    expect(at).toBeLessThan(hide.indexOf('panelOverlays.entries()'));
    expect(hide.slice(at, hide.indexOf('panelOverlays.entries()'))).toContain('_chatBreakoutClose(_chatBreakoutWinId(win));');
  });
  it('the tray keeps a single "Chat" entry', () => {
    expect((code.match(/label: 'Chat \(/g) || [])).toHaveLength(1);
  });
  it('the preload exposes the breakout calls: move a group, close a window, read the list, hear it change', () => {
    const p = stripJs(PRELOAD);
    expect(p).toMatch(/chatMoveGroup:\s+\(groupId, target\) => ipcRenderer\.invoke\('chat-move-group', String\(groupId \|\| ''\), String\(target \|\| ''\)\)/);
    expect(p).toMatch(/chatBreakoutClose:\s+\(winId\)\s+=> ipcRenderer\.invoke\('chat-breakout-close', String\(winId \|\| ''\)\)/);
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
    // S.bounds: window id -> the rect that window sits at (the stub windows read and write it); S.displays: work areas.
    const S = { wanted: opts.wanted !== false, single: opts.single || [], bounds: opts.bounds || {}, displays: opts.displays || [], log: { created: [], destroyed: [], pushed: [], flushed: [], persisted: [] } };
    const start = MAIN.indexOf('const CHAT_BREAKOUT_MAX = 12;');
    const mid = MAIN.indexOf('function createChatBreakout(wid, groups) {');
    const syncAt = MAIN.indexOf('function _syncChatBreakouts() {');
    const end = MAIN.indexOf("ipcMain.handle('chat-move-group',");
    let body = MAIN.slice(start, mid) + MAIN.slice(syncAt, end);
    if (opts.live === false) body = body.replace('const CHAT_LINK_LIVE = true;', 'const CHAT_LINK_LIVE = false;');
    // eslint-disable-next-line no-new-func
    const r = new Function('S', `
      let CFG = ${JSON.stringify(cfg0)};
      const chatBreakouts = new Map();
      const stubWin = (wid) => ({ wid, destroyed: false, destroy() { this.destroyed = true; S.log.destroyed.push(wid); },
        getBounds() { return Object.assign({}, S.bounds[wid]); }, setBounds(b) { S.bounds[wid] = Object.assign({}, b); } });
      let chatWindow = ${opts.main ? "stubWin('main')" : 'null'};
      const ipcMain = { handle() {} }; const BrowserWindow = {};
      const screen = { getAllDisplays: () => S.displays.map(workArea => ({ workArea })) };
      const _boundsKeyForWindow = (w) => (w === chatWindow ? 'chatBounds' : 'chatBounds_' + w.wid);
      const _persistBounds = (k) => S.log.persisted.push(k);
      const _OVERLAY_WINDOWS = [{ key: 'chat', flag: 'showChat' }];
      const _live = (w) => !!w && !w.destroyed;
      const _agentOnly = () => false;
      const _overlayWanted = () => S.wanted;
      const _inSingleSetup = (w) => S.single.indexOf(w.wid) !== -1;
      const _flushBounds = (k) => S.log.flushed.push(k);
      const appendAgentLog = () => {};
      const setImmediate = (f) => f();
      const applyChatVisibility = () => {}; const applyOverlayInteractivity = () => {};
      function loadConfig() { const c = JSON.parse(JSON.stringify(CFG)); _chatMigrateBreakouts(c); return c; }
      function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); }
      function createChatBreakout(wid, groups) { const w = Object.assign(stubWin(wid), { groups }); chatBreakouts.set(wid, w); S.log.created.push(wid + ':' + groups.join('+')); }
      ${body}
      function _pushChatWindows(channel, payload) { S.log.pushed.push([channel, payload]); }
      return { _chatMigrateBreakouts, _chatBreakoutList, _chatBreakoutWinId, _chatMoveGroup, _chatBreakoutClose, _syncChatBreakouts, loadConfig, chatBreakouts, cfg: () => CFG,
        _chatLinkGroups, _chatLinksPrune, _chatRectsTouch, _chatSnap, _chatVisibleFrac, _chatClampGroupDelta, _chatLinkToggle, _chatDragBegin, _chatDragStep, _chatDragEnd,
        _chatWindowId, mainWin: () => chatWindow, CHAT_SNAP_PX, CHAT_LINK_LIVE };
    `)(S);
    return { r, S };
  }
  const groupsOf = (list) => list.map(w => w.id + ':' + w.groups.join('+'));
  it('the saved list is sanitised: b<n> window ids, lower-case group ids, a group in one window only, no empty window, at most twelve windows', () => {
    const { r } = mk({});
    const dirty = { chatBreakouts: [
      { id: 'b1', groups: ['guild', 'guild', 'Raid', '../x', 7, 'a b', 'say'] },
      { id: 'b1', groups: ['ooc'] },                       // a repeated window id
      { id: 'b2', groups: ['say', 'ooc'] },                // say is already in b1
      { id: 'main', groups: ['tell'] }, { id: 'B3', groups: ['tell'] }, { id: 'b2345', groups: ['tell'] },   // not window ids
      { id: 'b4', groups: [] }, { id: 'b5' }, null, 'guild', 7] };
    expect(groupsOf(r._chatBreakoutList(dirty))).toEqual(['b1:guild+say', 'b2:ooc']);
    expect(r._chatBreakoutList({})).toEqual([]);
    expect(r._chatBreakoutList({ chatBreakouts: 'guild' })).toEqual([]);
    const many = 'abcdefghijklmnopqrst'.split('').map((c, i) => ({ id: 'b' + (i + 1), groups: ['g' + c] }));
    expect(r._chatBreakoutList({ chatBreakouts: many })).toHaveLength(12);
  });

  // ── the old shape, a plain list of group ids, becomes windows with nothing lost ──
  describe('migration from the old shape (a list of group ids)', () => {
    const OLD = () => ({
      chatBreakouts: ['melee', 'guild', 'melee', 'Bad id'],
      chatBounds_melee: { x: 10, y: 20, width: 300, height: 150 }, chatBounds_meleeSig: 'sig-1', chatBounds_meleeFloor: { h: 90, sig: 'sig-1' },
      chatBounds_guild: { x: 400, y: 500, width: 340, height: 200 }, chatBounds_guildSig: 'sig-1',
      overlayLayoutBySig: { 'sig-1': { rects: { chatBounds_melee: { x: 10, y: 20, width: 300, height: 150 }, chatBounds_guild: { x: 400, y: 500, width: 340, height: 200 }, mapBounds: { x: 1, y: 2, width: 3, height: 4 } }, at: 5 } },
      overlayOpacity: { 'chat:melee': 0.7, 'chat:guild': 0.9, chat: 0.5 },
      chatPrefs: { fontSize: 14, win: { main: { fontSize: 18 }, melee: { fontSize: 10, lineGap: 'compact', times: false }, guild: { tags: false } } },
    });
    it('each group id becomes a window of its own, in order, with b<n> ids', () => {
      const { r } = mk({});
      const c = OLD(); r._chatMigrateBreakouts(c);
      expect(c.chatBreakouts).toEqual([{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['guild'] }]);
    });
    it('keeps each window\'s place (bounds, screen signature, height floor, per-screen memory) under the new window id', () => {
      const { r } = mk({});
      const c = OLD(); r._chatMigrateBreakouts(c);
      expect(c.chatBounds_b1).toEqual({ x: 10, y: 20, width: 300, height: 150 });
      expect(c.chatBounds_b1Sig).toBe('sig-1');
      expect(c.chatBounds_b1Floor).toEqual({ h: 90, sig: 'sig-1' });
      expect(c.chatBounds_b2).toEqual({ x: 400, y: 500, width: 340, height: 200 });
      expect(c.overlayLayoutBySig['sig-1'].rects.chatBounds_b1).toEqual({ x: 10, y: 20, width: 300, height: 150 });
      expect(c.overlayLayoutBySig['sig-1'].rects.chatBounds_b2).toBeTruthy();
      expect(c.overlayLayoutBySig['sig-1'].rects.mapBounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });   // other overlays untouched
      for (const k of ['chatBounds_melee', 'chatBounds_meleeSig', 'chatBounds_meleeFloor', 'chatBounds_guild', 'chatBounds_guildSig']) expect(c, k).not.toHaveProperty(k);
      expect(c.overlayLayoutBySig['sig-1'].rects).not.toHaveProperty('chatBounds_melee');
    });
    it('keeps each window\'s text settings and its opacity under the new window id, and leaves main alone', () => {
      const { r } = mk({});
      const c = OLD(); r._chatMigrateBreakouts(c);
      expect(c.chatPrefs.win).toEqual({ main: { fontSize: 18 }, b1: { fontSize: 10, lineGap: 'compact', times: false }, b2: { tags: false } });
      expect(c.overlayOpacity).toEqual({ 'chat:b1': 0.7, 'chat:b2': 0.9, chat: 0.5 });
      expect(c.chatPrefs.fontSize).toBe(14);
    });
    it('is a no-op on the new shape and runs once: converting twice changes nothing', () => {
      const { r } = mk({});
      const c = OLD(); r._chatMigrateBreakouts(c);
      const once = JSON.stringify(c);
      r._chatMigrateBreakouts(c);
      expect(JSON.stringify(c)).toBe(once);
      const fresh = { chatBreakouts: [{ id: 'b3', groups: ['say'] }] };
      r._chatMigrateBreakouts(fresh);
      expect(fresh.chatBreakouts).toEqual([{ id: 'b3', groups: ['say'] }]);
      for (const nothing of [{}, { chatBreakouts: [] }, { chatBreakouts: 'guild' }, null]) expect(() => r._chatMigrateBreakouts(nothing)).not.toThrow();
    });
    it('happens on load (loadConfig), and what loads builds one window per old group with its old place', () => {
      expect(stripJs(sliceBlock(MAIN, 'function loadConfig() {', '\n}\n'))).toContain('_chatMigrateBreakouts(raw);');
      const { r, S } = mk(OLD());
      r._syncChatBreakouts();
      expect(S.log.created).toEqual(['b1:melee', 'b2:guild']);
      expect(r.loadConfig().chatBounds_b1).toEqual({ x: 10, y: 20, width: 300, height: 150 });
    });
    it('does not depend on a const defined further down the file (loadConfig can run before it is initialised)', () => {
      const fn = stripJs(sliceBlock(MAIN, 'function _chatMigrateBreakouts(raw) {', '\n}\n'));
      expect(fn).not.toMatch(/_CHAT_GROUP_RX|_CHAT_BRK_ID_RX|CHAT_BREAKOUT_MAX/);
    });
  });

  // ── combining: one window, several groups ──
  it('breaking a group out saves a window for it, tells every Chat window, and builds exactly one window', () => {
    const { r, S } = mk({ chatBreakouts: [] });
    expect(groupsOf(r._chatMoveGroup('guild', 'new'))).toEqual(['b1:guild']);
    expect(r.cfg().chatBreakouts).toEqual([{ id: 'b1', groups: ['guild'] }]);
    expect(S.log.pushed).toEqual([['chat-breakouts', [{ id: 'b1', groups: ['guild'] }]]]);
    expect(S.log.created).toEqual(['b1:guild']);
    r._chatMoveGroup('guild', 'new');                                // again: it is alone in its window, nothing changes
    expect(S.log.created).toEqual(['b1:guild']);
    expect(S.log.pushed).toHaveLength(1);
    r._chatMoveGroup('raid', 'new');
    expect(S.log.created).toEqual(['b1:guild', 'b2:raid']);
  });
  it('a group moved into an existing breakout joins it: that window holds both, and nothing else is built', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['guild'] }] });
    r._syncChatBreakouts();
    expect(groupsOf(r._chatMoveGroup('spells', 'b1'))).toEqual(['b1:melee+spells', 'b2:guild']);
    expect(r.cfg().chatBreakouts[0]).toEqual({ id: 'b1', groups: ['melee', 'spells'] });
    expect(S.log.created).toEqual(['b1:melee', 'b2:guild']);          // b1 kept its window (and so its place and text settings)
    expect(S.log.destroyed).toEqual([]);
    expect(S.log.pushed.pop()).toEqual(['chat-breakouts', r.cfg().chatBreakouts]);   // every window hears the new list
  });
  it('the window id and place stay put as groups come and go', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }] });
    r._syncChatBreakouts();
    const win = r.chatBreakouts.get('b1');
    r._chatMoveGroup('spells', 'b1'); r._chatMoveGroup('skills', 'b1'); r._chatMoveGroup('melee', 'main');
    expect(groupsOf(r._chatBreakoutList(r.cfg()))).toEqual(['b1:spells+skills']);
    expect(r.chatBreakouts.get('b1')).toBe(win);                      // the very same window
    expect(S.log.created).toEqual(['b1:melee']);
    expect(S.log.flushed).toEqual([]);
  });
  it('a group moved from one breakout to another leaves the first, and the first closes when that was its last group', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['spells', 'skills'] }] });
    r._syncChatBreakouts();
    expect(groupsOf(r._chatMoveGroup('skills', 'b1'))).toEqual(['b1:melee+skills', 'b2:spells']);
    expect(S.log.destroyed).toEqual([]);
    expect(groupsOf(r._chatMoveGroup('spells', 'b1'))).toEqual(['b1:melee+skills+spells']);
    expect(S.log.destroyed).toEqual(['b2']);                          // b2 had nothing left
    expect(S.log.flushed).toEqual(['chatBounds_b2']);                 // its place is saved before it goes
    expect(r.chatBreakouts.has('b2')).toBe(false);
  });
  it('moving a group back to the main window takes it out of its breakout; the window stays while it still holds a group', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee', 'spells'] }] });
    r._syncChatBreakouts();
    expect(groupsOf(r._chatMoveGroup('spells', 'main'))).toEqual(['b1:melee']);
    expect(S.log.destroyed).toEqual([]);
    expect(r._chatMoveGroup('spells', 'main')).toEqual([{ id: 'b1', groups: ['melee'] }]);   // already in main: nothing to do
  });
  it('removing the last group closes the window, and the list no longer has it', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee', 'spells'] }, { id: 'b2', groups: ['guild'] }] });
    r._syncChatBreakouts();
    r._chatMoveGroup('melee', 'main');
    expect(S.log.destroyed).toEqual([]);
    expect(r._chatMoveGroup('spells', 'main')).toEqual([{ id: 'b2', groups: ['guild'] }]);
    expect(S.log.destroyed).toEqual(['b1']);
    expect(r.chatBreakouts.has('b1')).toBe(false);
    expect(r.chatBreakouts.has('b2')).toBe(true);
    expect(r.cfg().chatBreakouts).toEqual([{ id: 'b2', groups: ['guild'] }]);
  });
  it('the ✕ returns ALL of a window\'s groups to the main window and closes it, leaving the others alone', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee', 'spells', 'skills'] }, { id: 'b2', groups: ['guild', 'officer'] }] });
    r._syncChatBreakouts();
    expect(r._chatBreakoutWinId(r.chatBreakouts.get('b1'))).toBe('b1');
    expect(r._chatBreakoutClose('b1')).toEqual([{ id: 'b2', groups: ['guild', 'officer'] }]);
    expect(S.log.destroyed).toEqual(['b1']);
    expect(S.log.pushed.pop()).toEqual(['chat-breakouts', [{ id: 'b2', groups: ['guild', 'officer'] }]]);   // so main's chips drop "out" for all three
    expect(r._chatBreakoutClose('b9')).toEqual([{ id: 'b2', groups: ['guild', 'officer'] }]);   // no such window: nothing happens
  });
  it('a window name that does not exist changes nothing (a group is never left without a window)', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }] });
    r._syncChatBreakouts();
    for (const bad of ['b7', 'main2', '', 'B1', '../x']) expect(groupsOf(r._chatMoveGroup('guild', bad)), bad).toEqual(['b1:melee']);
    expect(groupsOf(r._chatMoveGroup('melee', 'b7'))).toEqual(['b1:melee']);   // melee stays where it was
    expect(S.log.destroyed).toEqual([]);
  });
  it('a group alone in its window does not get a new window made for it', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }] });
    r._syncChatBreakouts();
    r._chatMoveGroup('melee', 'new');
    expect(S.log.created).toEqual(['b1:melee']);
    expect(S.log.destroyed).toEqual([]);
    // but a group sharing a window can be split out into a new one, which takes the next free id
    r._chatMoveGroup('spells', 'b1');
    r._chatMoveGroup('spells', 'new');
    expect(groupsOf(r._chatBreakoutList(r.cfg()))).toEqual(['b1:melee', 'b2:spells']);
  });
  it('a freed window id is the next one handed out, so ids stay within b1..b12', () => {
    const { r } = mk({ chatBreakouts: [{ id: 'b1', groups: ['guild'] }, { id: 'b2', groups: ['raid'] }, { id: 'b3', groups: ['say'] }] });
    r._chatBreakoutClose('b2');
    expect(groupsOf(r._chatMoveGroup('melee', 'new'))).toEqual(['b1:guild', 'b3:say', 'b2:melee']);
  });
  it('they come back after a restart: a fresh pass builds one window per saved entry, holding its groups', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['guild', 'officer'] }, { id: 'b2', groups: ['tell'] }] });
    r._syncChatBreakouts();
    expect(S.log.created).toEqual(['b1:guild+officer', 'b2:tell']);
    r._syncChatBreakouts();                                          // idempotent
    expect(S.log.created).toEqual(['b1:guild+officer', 'b2:tell']);
  });
  it('prefs round-trip: the list survives save and load as saved, and a second cleaning changes nothing', () => {
    const { r } = mk({ chatBreakouts: [] });
    r._chatMoveGroup('melee', 'new'); r._chatMoveGroup('spells', 'b1'); r._chatMoveGroup('guild', 'new');
    const saved = JSON.parse(JSON.stringify(r.cfg()));               // what went to disk
    expect(saved.chatBreakouts).toEqual([{ id: 'b1', groups: ['melee', 'spells'] }, { id: 'b2', groups: ['guild'] }]);
    const back = r.loadConfig();
    expect(back.chatBreakouts).toEqual(saved.chatBreakouts);
    expect(r._chatBreakoutList(back)).toEqual(back.chatBreakouts);
  });
  it('Chat off / hide-all / the EverQuest gate (Chat not wanted) closes them all, and they return with it, still listed', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['guild', 'raid'] }, { id: 'b2', groups: ['say'] }] });
    r._syncChatBreakouts();
    S.wanted = false;
    r._syncChatBreakouts();
    expect(S.log.destroyed.sort()).toEqual(['b1', 'b2']);
    expect(r.chatBreakouts.size).toBe(0);
    expect(r.cfg().chatBreakouts).toHaveLength(2);                   // closing them is not "put back"
    S.wanted = true;
    r._syncChatBreakouts();
    expect(S.log.created).toEqual(['b1:guild+raid', 'b2:say', 'b1:guild+raid', 'b2:say']);
  });
  it('a breakout being set up (Setup THIS) is spared while it is open', () => {
    const { r, S } = mk({ chatBreakouts: [{ id: 'b1', groups: ['guild'] }] }, { single: ['b1'] });
    r._syncChatBreakouts();
    S.wanted = false;
    r._syncChatBreakouts();
    expect(S.log.destroyed).toEqual([]);
  });
  it('the renderer cannot make a window for anything but a group-id-shaped string, nor more than twelve windows', () => {
    const { r, S } = mk({ chatBreakouts: [] });
    for (const bad of ['../etc', 'Guild', '', 'a b', 'x'.repeat(17), null, undefined, 5]) r._chatMoveGroup(bad, 'new');
    expect(S.log.created).toEqual([]);
    expect(r.cfg().chatBreakouts).toEqual([]);
    for (const g of 'abcdefghijklmnop'.split('')) r._chatMoveGroup(g, 'new');
    expect(r.cfg().chatBreakouts).toHaveLength(12);
    expect(r.cfg().chatBreakouts.map(w => w.id)).toEqual(Array.from({ length: 12 }, (_, i) => 'b' + (i + 1)));
  });

  // ── 🔗 snap and link (the guild lead, 2026-10-14: "lock multiple breakout chats to each other") ──
  describe('snapping', () => {
    const { r } = mk({});
    const A = { x: 100, y: 100, width: 300, height: 200 };            // right edge 400, bottom 300
    const B = (x, y) => ({ x, y, width: 200, height: 100 });
    it('an edge within 8px lands flush: side by side, either side', () => {
      expect(r.CHAT_SNAP_PX).toBe(8);
      expect(r._chatSnap(B(406, 120), [A], 8)).toMatchObject({ x: 400, y: 120, snapped: true });     // B's left edge to A's right edge
      expect(r._chatSnap(B(-105, 120), [A], 8)).toMatchObject({ x: -100, y: 120, snapped: true });    // B's right edge (95) to A's left edge (100)
    });
    it('stacked: top to bottom, bottom to top; and a same-side edge lines up', () => {
      expect(r._chatSnap(B(104, 305), [A], 8)).toMatchObject({ x: 100, y: 300 });                    // under A, and left edges line up
      expect(r._chatSnap(B(104, -3), [A], 8)).toMatchObject({ x: 100, y: 0 });                       // above A: its bottom (97) to A's top (100)
      expect(r._chatSnap(B(112, 305), [A], 8)).toMatchObject({ x: 112, y: 300 });                    // 12px off line: it stacks but does not align
    });
    it('9px is too far, and so is a window that is not next to it on the other axis', () => {
      expect(r._chatSnap(B(409, 120), [A], 8)).toMatchObject({ x: 409, snapped: false });
      expect(r._chatSnap(B(405, 500), [A], 8)).toMatchObject({ x: 405, y: 500, snapped: false });    // 200px below: not a neighbour
    });
    it('takes the nearest edge when several are in reach, and snaps to the nearest of several windows', () => {
      const C = { x: 405, y: 100, width: 100, height: 200 };
      expect(r._chatSnap(B(403, 120), [A, C], 8).x).toBe(405);                                       // 2 from lining up with C, 3 from A's right edge: the nearer wins
      expect(r._chatSnap(B(401, 120), [A, C], 8).x).toBe(400);                                       // 1 from A's right edge, 4 from C
    });
    it('touching: an edge on an edge with some overlap, not a corner and not a gap', () => {
      expect(r._chatRectsTouch(A, { x: 400, y: 150, width: 100, height: 100 }, 10)).toBe(true);
      expect(r._chatRectsTouch(A, { x: 405, y: 150, width: 100, height: 100 }, 10)).toBe(true);        // within tolerance
      expect(r._chatRectsTouch(A, { x: 100, y: 300, width: 100, height: 100 }, 10)).toBe(true);        // stacked
      expect(r._chatRectsTouch(A, { x: 400, y: 300, width: 100, height: 100 }, 10)).toBe(false);       // diagonal corner only
      expect(r._chatRectsTouch(A, { x: 430, y: 150, width: 100, height: 100 }, 10)).toBe(false);       // 30px gap
    });
  });

  describe('linking', () => {
    const W = (x, y) => ({ x, y, width: 300, height: 200 });
    // main sits at 0,0; b1 flush to its right; b2 flush to b1's right; b3 far away
    const SETUP = () => ({ main: W(0, 0), b1: W(300, 0), b2: W(600, 0), b3: W(1500, 700) });
    const make = (links, extra = {}) => {
      const m = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['spells'] }, { id: 'b3', groups: ['guild'] }], chatLinks: links }, { main: true, bounds: SETUP(), displays: [{ x: 0, y: 0, width: 1920, height: 1080 }], ...extra });
      m.r._syncChatBreakouts();
      return m;
    };
    it('🔗 links every window touching this one, directly or through another, and not the far one', () => {
      const { r, S } = make([]);
      const res = r._chatLinkToggle('b1');
      expect(res.ok).toBe(true);
      expect(res.groups.map(g => g.slice().sort())).toEqual([['b1', 'b2', 'main']]);
      expect(r.cfg().chatLinks).toEqual(res.groups);                      // saved
      expect(S.log.pushed.pop()).toEqual(['chat-links', res.groups]);     // every window hears it
    });
    it('nothing touching: nothing to link, nothing saved', () => {
      const { r, S } = make([]);
      const before = S.log.pushed.length;
      expect(r._chatLinkToggle('b3')).toMatchObject({ ok: false, groups: [] });
      expect(r.cfg().chatLinks).toEqual([]);
      expect(S.log.pushed).toHaveLength(before);
    });
    it('🔗 again unlinks just that window; a group left with one window is dissolved', () => {
      const { r } = make([['main', 'b1', 'b2']]);
      expect(r._chatLinkToggle('b2').groups).toEqual([['main', 'b1']]);
      expect(r._chatLinkToggle('b1').groups).toEqual([]);
      expect(r.cfg().chatLinks).toEqual([]);
    });
    it('linking a window next to an existing group merges into it', () => {
      const { r } = make([['main', 'b1']]);
      const res = r._chatLinkToggle('b2');
      expect(res.groups).toHaveLength(1);
      expect(res.groups[0].slice().sort()).toEqual(['b1', 'b2', 'main']);
    });
    it('cfg.chatLinks round-trips and is sanitised: window ids only, a window in one group, groups of two or more', () => {
      const { r } = make([]);
      expect(r._chatLinkGroups({ chatLinks: [['main', 'b1', 'b1', 'guild', 7], ['b1', 'b2'], ['b2', 'b3'], ['b4'], 'main', null, ['B5', 'b6']] }))
        .toEqual([['main', 'b1'], ['b2', 'b3']]);
      expect(r._chatLinkGroups({})).toEqual([]);
      expect(r._chatLinkGroups({ chatLinks: 'main' })).toEqual([]);
      r._chatLinkToggle('b1');
      const saved = JSON.parse(JSON.stringify(r.cfg()));
      expect(r._chatLinkGroups(saved)).toEqual(saved.chatLinks);
      expect(r.loadConfig().chatLinks).toEqual(saved.chatLinks);
    });
    it('closing a window takes it out of its group; a group left with one window goes with it', () => {
      const { r, S } = make([['main', 'b1', 'b2']]);
      r._chatBreakoutClose('b2');
      expect(r.cfg().chatLinks).toEqual([['main', 'b1']]);
      expect(S.log.pushed.filter(p => p[0] === 'chat-links').pop()).toEqual(['chat-links', [['main', 'b1']]]);
      r._chatBreakoutClose('b1');
      expect(r.cfg().chatLinks).toEqual([]);
    });
    it('returning a window\'s last group to the main window closes it, and its links go with it', () => {
      const { r } = make([['b1', 'b2'], ['main', 'b3']]);
      r._chatMoveGroup('melee', 'main');                                  // b1 held only melee
      expect(r.cfg().chatLinks).toEqual([['main', 'b3']]);
      r._chatMoveGroup('guild', 'b2');                                    // b3 empties
      expect(r.cfg().chatLinks).toEqual([]);
    });
    it('the main window keeps its links when a breakout comes and goes; a window only leaves a group by closing or unlinking', () => {
      const { r } = make([['main', 'b1']]);
      r._chatMoveGroup('spells', 'b1');                                    // b2 closes; unrelated to the group
      expect(r.cfg().chatLinks).toEqual([['main', 'b1']]);
    });
  });

  describe('dragging a linked window', () => {
    const W = (x, y) => ({ x, y, width: 300, height: 200 });
    const AREA = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const make = (links, bounds, extra = {}) => {
      const m = mk({ chatBreakouts: [{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['spells'] }, { id: 'b3', groups: ['guild'] }], chatLinks: links },
        { main: true, bounds: { main: W(100, 100), b1: W(400, 100), b2: W(700, 100), b3: W(1500, 700), ...bounds }, displays: AREA, ...extra });
      m.r._syncChatBreakouts();
      return m;
    };
    const drag = (m, wid, dx, dy) => {
      const win = wid === 'main' ? m.r.mainWin() : m.r.chatBreakouts.get(wid);
      const s = m.r._chatDragBegin(win);
      const at = m.r._chatDragStep(s, s.start.x + dx, s.start.y + dy);
      m.S.bounds[wid] = { ...s.start, x: at.x, y: at.y };                  // what the drag loop does with the answer
      return { s, at };
    };
    it('moving one window of a group moves its partners by the same amount', () => {
      const m = make([['main', 'b1', 'b2']]);
      const { at } = drag(m, 'b1', 120, 45);
      expect(at).toEqual({ x: 520, y: 145 });
      expect(m.S.bounds.main).toEqual(W(220, 145));
      expect(m.S.bounds.b2).toEqual(W(820, 145));
      expect(m.S.bounds.b3).toEqual(W(1500, 700));                         // not in the group: not moved
      expect(m.S.bounds.main.x - 100).toBe(at.x - 400);                    // the very same delta
    });
    it('a window with no links moves alone', () => {
      const m = make([]);
      const { at, s } = drag(m, 'b1', 60, 0);
      expect(s.partners).toEqual([]);
      expect(at).toEqual({ x: 460, y: 100 });
      expect(m.S.bounds.main).toEqual(W(100, 100));
    });
    it('after the link is released, the window leaves the others behind', () => {
      const m = make([['main', 'b1']]);
      m.r._chatLinkToggle('b1');                                           // unlink (main and b1 touch, but it is a toggle off)
      expect(m.r.cfg().chatLinks).toEqual([]);
      drag(m, 'b1', 80, 80);
      expect(m.S.bounds.main).toEqual(W(100, 100));
    });
    it('snaps to a window outside the group as it goes, and the partners follow the snapped place', () => {
      const m = make([['main', 'b1']], { b3: W(800, 100) });               // b3 sits right of b1's reach: its left edge is at 800
      const { at } = drag(m, 'b1', 97, 3);                                // b1 would land at 497..797: 3px short of b3's left edge
      expect(at).toEqual({ x: 500, y: 100 });                              // flush to b3 (right edge 800), y lined up with b3's top
      expect(m.S.bounds.main).toEqual(W(200, 100));                        // main moved the same 100
    });
    it('a group is clamped on screen as a whole: a partner at the edge stops the lot, but sliding along the edge still works', () => {
      const m = make([['main', 'b1']], { main: W(20, 100), b1: W(320, 100) });
      const { at } = drag(m, 'b1', -500, 40);
      expect(m.S.bounds.main.x).toBeGreaterThanOrEqual(-60);               // main keeps 80% of itself on screen
      expect(m.S.bounds.main.x).toBeLessThanOrEqual(-58);
      expect(at.x - 320).toBe(m.S.bounds.main.x - 20);                     // still the same delta
      expect(at.y).toBe(140);                                              // the vertical part of the move was not lost
      expect(m.S.bounds.main.y).toBe(140);
    });
    it('the clamp also holds the bottom and right edges, across the whole group', () => {
      const m = make([['main', 'b1']], { main: W(1300, 880), b1: W(1600, 880) });
      drag(m, 'main', 400, 400);
      expect(m.S.bounds.b1.x + 300).toBeLessThanOrEqual(1920 + 60);        // b1 may overhang by up to 20% of its width
      expect(m.S.bounds.b1.y + 200).toBeLessThanOrEqual(1080 + 40);
      expect(m.S.bounds.b1.x - m.S.bounds.main.x).toBe(300);               // and the pair did not come apart
    });
    it('a group that starts partly off screen is not frozen: it can move, just not further out', () => {
      const m = make([['main', 'b1']], { main: W(-150, 100), b1: W(150, 100) });
      drag(m, 'b1', 30, 0);
      expect(m.S.bounds.main.x).toBe(-120);                                // moved in
      drag(m, 'b1', -100, 0);
      expect(m.S.bounds.main.x).toBeGreaterThanOrEqual(-120);              // would be further out: held
    });
    it('the clamp maths on its own: no displays known = the move stands; fully visible stays at or above 80%', () => {
      const { r } = mk({});
      expect(r._chatClampGroupDelta([W(0, 0)], -500, 0, [])).toEqual({ dx: -500, dy: 0 });
      expect(r._chatVisibleFrac(W(-150, 0), AREA)).toBe(0.5);
      expect(r._chatVisibleFrac(W(0, 0), AREA)).toBe(1);
      expect(r._chatVisibleFrac(W(5000, 0), AREA)).toBe(0);
      const c = r._chatClampGroupDelta([W(0, 0)], -500, 0, AREA);
      expect(c.dx).toBeGreaterThanOrEqual(-60); expect(c.dx).toBeLessThanOrEqual(-58);
    });
    it('partners that follow live are placed on every step; the cheaper mode places them once, when the drag ends, and saves them either way', () => {
      const live = make([['main', 'b1']]);
      const a = drag(live, 'b1', 50, 0);
      expect(live.S.bounds.main.x).toBe(150);
      live.r._chatDragEnd(a.s);
      expect(live.S.log.persisted).toEqual(['chatBounds']);                // main's place goes through the ordinary bounds path
      const lazy = make([['main', 'b1']], {}, { live: false });
      const b = drag(lazy, 'b1', 50, 0);
      expect(lazy.S.bounds.main.x).toBe(100);                              // not yet
      lazy.r._chatDragEnd(b.s);
      expect(lazy.S.bounds.main.x).toBe(150);
      expect(lazy.S.log.persisted).toEqual(['chatBounds']);
    });
    it('a drag that never moved partners saves nothing for them (a corner-grip resize shares the session)', () => {
      const m = make([['main', 'b1']]);
      const s = m.r._chatDragBegin(m.r.chatBreakouts.get('b1'));
      m.r._chatDragEnd(s);
      expect(m.S.log.persisted).toEqual([]);
    });
    it('only Chat windows are involved: any other window gets no drag state', () => {
      const m = make([['main', 'b1']]);
      expect(m.r._chatDragBegin({ getBounds: () => W(0, 0) })).toBeNull();
    });
  });
});

describe('🔗 wiring', () => {
  const code = stripJs(MAIN);
  const script = stripJs(script_());
  it('the existing manual drag does the moving (no app-region), through three hooks that only Chat windows answer', () => {
    const start = stripJs(sliceBlock(MAIN, 'function _startWindowDrag(win, persistKey) {', '\n}\n'));
    expect(start).toContain('chat: (() => { try { return _chatDragBegin(win); } catch { return null; } })(),');
    expect(start).toContain('_chatDragStep(_dragSession.chat, nx, ny)');
    expect(stripJs(sliceBlock(MAIN, 'function _stopWindowDrag() {', '\n}\n'))).toContain('_chatDragEnd(_dragSession.chat)');
    expect(stripJs(sliceBlock(MAIN, 'const CHAT_SNAP_PX = 8;', "ipcMain.handle('chat-links-get'"))).not.toMatch(/app-region|-webkit-app-region/);
  });
  it('is in the default config as an empty list', () => {
    expect(stripJs(sliceBlock(MAIN, 'function defaultConfig() {', '\n}\n'))).toMatch(/chatLinks: \[\],/);
  });
  it('the preload exposes toggle, read and listen', () => {
    const p = stripJs(PRELOAD);
    expect(p).toMatch(/chatLinkToggle:\s+\(\)\s+=> ipcRenderer\.invoke\('chat-link-toggle'\)/);
    expect(p).toMatch(/getChatLinks:\s+\(\)\s+=> ipcRenderer\.invoke\('chat-links-get'\)/);
    expect(p).toMatch(/onChatLinks:\s+\(cb\)\s+=> ipcRenderer\.on\('chat-links'/);
    expect(code).toContain("ipcMain.handle('chat-link-toggle'");
  });
  it('the 🔗 is a real button in the title bar (the hover handshake arms buttons on its own), and the breakout menu offers it too', () => {
    expect(CHAT_HTML).toMatch(/<div class="title">.*<button id="linkbtn" class="fbtn"[^>]*>🔗<\/button>/);
    expect(script).toContain("linkBtn.addEventListener('click', toggleLink);");
    expect(script).toContain("'Unlink from the other chat windows'");
    expect(script).toContain('window.mimic.onChatLinks(takeLinks)');
  });
  it('the button shows whether this window is linked, and says so when nothing was touching', () => {
    const s = script_();
    const page = (links, id) => evalBlock(`
      var _links = ${JSON.stringify(links)}; var _isBrk = ${id !== 'main'}, _wid = ${JSON.stringify(id === 'main' ? '' : id)}, _only = [];
      function brkGroupId(){ return ''; }
      var linkBtn = { cls: {}, attrs: {}, title: '', textContent: '🔗', classList: { toggle: function(k, v){ linkBtn.cls[k] = !!v; } }, setAttribute: function(k, v){ linkBtn.attrs[k] = v; } };
      var window = { mimic: { chatLinkToggle: function(){ return Promise.resolve({ ok: false, groups: [] }); } } };
      ${sliceBlock(s, 'function winId(){', "brkGroupId()) : 'main'; }")}
      ${sliceBlock(s, 'function linkGroup(){', 'linkBtn.addEventListener')}
    `, ['linkGroup', 'paintLink', 'takeLinks', 'toggleLink', 'linkBtn']);
    const main = page([['main', 'b1', 'b2']], 'main');
    main.paintLink();
    expect(main.linkBtn.cls.on).toBe(true);
    expect(main.linkBtn.attrs['aria-pressed']).toBe('true');
    expect(main.linkBtn.title).toContain('Linked with 2 other chat windows');
    const lone = page([['b1', 'b2']], 'main');
    lone.paintLink();
    expect(lone.linkBtn.cls.on).toBe(false);
    expect(lone.linkBtn.title).toContain('Link this window');
    lone.takeLinks([['main', 'b1'], 'junk', [3, 'b2']]);                   // main joins; junk is dropped
    expect(lone.linkBtn.cls.on).toBe(true);
    expect(lone.linkGroup()).toEqual(['main', 'b1']);
  });
});

// ── 9. Round 3 (the guild lead, 2026-10-14): channel tags, per-channel switches, "show only", Melee, window text ─────
function script_() { return CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>')); }
// The overlay's own filter, tag, switch, "show only" and window-text functions, sliced out of chat.html and run for
// real. opts: { brk: '<group id>' | ['<group id>', ...] } makes it a breakout window holding those groups (its window
// id is opts.wid, default 'b1'); { lines: [...] } is what the window has seen.
function overlay(prefs, opts = {}) {
  const s = script_();
  const base = { fontSize: 12, group: false, officer: false, custom: false, tells: false, melee: false, spells: false, skills: false, off: [], offChannels: [], only: '', win: {} };
  return evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)};
    var _prefs = ${JSON.stringify({ ...base, ...prefs })};
    var _only = ${JSON.stringify(opts.brk ? [].concat(opts.brk) : [])}, _out = [], _isBrk = ${!!opts.brk}, _findQ = '', _chanNames = {}, _copiedN = 0;
    var _wid = ${JSON.stringify(opts.brk ? (opts.wid || 'b1') : '')}, _brkOff = ${JSON.stringify(opts.brkOff || [])}, _wins = [];
    var _lines = ${JSON.stringify(opts.lines || [])}, _histLines = [];
    function brkGroupId(){ return _only[0] || ''; }
    function esc(s){ return String(s == null ? '' : s); }
    ${sliceBlock(s, 'function hhmm(t){', '}\n')}
    ${sliceBlock(s, 'function groupOf(ch){', 'return out;\n  }')}
    ${sliceBlock(s, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
    ${sliceBlock(s, 'function lineHtml(l, tag){', "+ viaMark + '</div>';\n  }")}
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
    // its definition, noteLocalChatLine, and classifyOtherLine (which asks it so a swing is never "Other"; that one is
    // only reachable from noteLocalChatLine: the Loot/Random/Other describe below pins it)
    expect(code.match(/classifyMeleeLine\(/g)).toHaveLength(3);
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
    expect(code).toMatch(/if \(_prefs\.melee && holdsGroup\('melee'\)\)/);
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
    const win = { b1: { fontSize: 10, lineGap: 'compact', times: false, tags: false }, b2: { fontSize: 16 } };
    expect(overlay({ win }, { brk: 'spells', wid: 'b1' }).winCfg()).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    expect(overlay({ win }, { brk: 'skills', wid: 'b2' }).winCfg()).toEqual({ fontSize: 16, lineGap: 'normal', times: true, tags: true });
    expect(overlay({ win }, { brk: 'spells', wid: 'b1' }).winId()).toBe('b1');
    // the settings hang off the WINDOW, so a window holding both has one set, and it does not change when a group joins
    expect(overlay({ win }, { brk: ['spells', 'skills'], wid: 'b1' }).winCfg().fontSize).toBe(10);
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
    expect(code).toMatch(/if \(_prefs\[row\.grp\] && holdsGroup\(row\.grp\)\)/);
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
    const win = { main: { fontSize: 18 }, b1: { fontSize: 10, lineGap: 'compact', times: false, tags: false } };
    expect(overlay({ win }).winCfg()).toEqual({ fontSize: 18, lineGap: 'normal', times: true, tags: true });
    expect(overlay({ win }, { brk: 'melee', wid: 'b1' }).winCfg()).toEqual({ fontSize: 10, lineGap: 'compact', times: false, tags: false });
    expect(overlay({ win, fontSize: 13 }, { brk: 'guild', wid: 'b2' }).winCfg().fontSize).toBe(13);   // a window with no entry keeps the default
  });
  it('the window id is "main" or the breakout window\'s own id, whatever groups it holds; the ⚙ reaches a breakout\'s settings and hides the rest', () => {
    expect(overlay({}).winId()).toBe('main');
    expect(overlay({}, { brk: 'melee', wid: 'b3' }).winId()).toBe('b3');
    expect(overlay({}, { brk: ['melee', 'spells'], wid: 'b3' }).winId()).toBe('b3');
    expect(CHAT_HTML).toMatch(/body\.brk #onlypill,body\.brk #spanel \.nobrk\{display:none\}/);
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
  // opts: { brk (a group id or list: this is that breakout window), out (group ids held by breakouts, one window each unless
  // wins is given), wins ([{ id, groups }]), store (what localStorage already holds), groups }
  function row(prefs = {}, opts = {}) {
    const brkList = opts.brk ? [].concat(opts.brk) : [];
    const wins = opts.wins || (opts.out || []).map((g, i) => ({ id: 'b' + (i + 1), groups: [g] }));
    const base = { fontSize: 12, group: false, officer: false, custom: false, tells: false, melee: false, spells: false, skills: false, off: [], offChannels: [], only: '', win: {} };
    const api = evalBlock(`
      var _groups = ${JSON.stringify(opts.groups || agent.CHAT_GROUPS)};
      var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)};
      var _prefs = ${JSON.stringify({ ...base, ...prefs })};
      var _only = ${JSON.stringify(brkList)}, _out = ${JSON.stringify(wins.reduce((a, w) => a.concat(w.groups), []))}, _isBrk = ${!!opts.brk};
      var _wid = ${JSON.stringify(opts.brk ? (opts.wid || 'b1') : '')}, _brkOff = [], _wins = ${JSON.stringify(wins)};
      var __store = ${JSON.stringify(opts.store || {})};
      var localStorage = { getItem: function(k){ return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; }, setItem: function(k, v){ __store[k] = String(v); } };
      var handlers = {}, calls = { saved: [], moved: [], menu: null };
      var chipsEl = { innerHTML: '', addEventListener: function(t, f){ handlers[t] = f; } };
      function esc(s){ return String(s == null ? '' : s); }
      function brkGroupId(){ return _only[0] || ''; }
      function repaint(){} function openMenu(x, y, items){ calls.menu = items; }
      function savePrefs(p){ calls.saved.push(p); } function moveGroup(id, target){ calls.moved.push([id, target]); }
      ${sliceBlock(s, 'function groupOf(ch){', 'return out;\n  }')}
      ${sliceBlock(s, 'function winId(){', 'tags: w.tags !== false };\n  }')}
      ${sliceBlock(s, 'function groupLabel(id){', 'return null; }')}
      ${sliceBlock(s, 'var MAIN_CHIPS = [', 'chipsEl.__wpHtml = h; }\n  }')}
      ${sliceBlock(s, "chipsEl.addEventListener('click', function(e){", 'paintChips(); repaint();\n  });')}
      ${sliceBlock(s, 'function chipMenuItems(id, x, y){', '    return items;\n  }')}
      ${sliceBlock(s, "chipsEl.addEventListener('contextmenu', function(e){", "chipMenuItems(id, e.clientX, e.clientY));\n  });")}
      paintChips();
      function isOpen(){ return _moreOpen; }
    `, ['paintChips', 'setMore', 'isOpen', 'shownGroupIds', 'makeFilter', 'chipsEl', 'handlers', 'calls', '__store', '_groups', 'chipMenuItems']);
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
    expect(r.calls.moved).toEqual([['melee', 'new']]);
    // a chip that is already out offers to move it back, and is still found inside More
    const out = row({ melee: true }, { out: ['melee'] });
    out.setMore(true);
    expect(out.buttons().find(b => b.g === 'melee').cls).toContain('out');
    out.fire('contextmenu', 'melee');
    expect(out.calls.menu.map(i => i.label)).toEqual(['Move to main window']);
    out.calls.menu[0].run();
    expect(out.calls.moved).toEqual([['melee', 'main']]);
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
  it('a breakout window gets no More; its chip row is the groups it holds. A row with nothing to fold gets none either', () => {
    const brk = row({ melee: true }, { brk: 'melee' });
    expect(brk.chipsEl.innerHTML).not.toContain('data-more');
    expect(brk.labels()).toEqual(['Melee']);
    const small = row({}, { groups: agent.CHAT_GROUPS.filter(g => ['guild', 'raid', 'say'].includes(g.id)) });
    expect(small.labels()).toEqual(['Guild', 'Raid', 'Say']);
  });
  // ── combining windows: the menus ──
  const WINS = [{ id: 'b1', groups: ['melee', 'spells'] }, { id: 'b2', groups: ['guild'] }];
  it('right-click in the Chat window with breakouts open: "Move to window ▸" lists them by the groups they hold, then "New window"', () => {
    const r = row({ melee: true, spells: true }, { wins: [{ id: 'b1', groups: ['spells', 'skills'] }, { id: 'b2', groups: ['guild'] }] });
    r.setMore(true);
    r.fire('contextmenu', 'melee');
    expect(r.calls.menu.map(i => i.label)).toEqual(['Move to window ▸']);          // melee is in main: nothing to move back
    r.calls.menu[0].run();                                                          // opens the second level
    expect(r.calls.menu.map(i => i.label)).toEqual(['Spells + Skills', 'Guild', 'New window']);
    r.calls.menu[0].run();
    r.fire('contextmenu', 'melee'); r.calls.menu[0].run(); r.calls.menu[1].run();
    r.fire('contextmenu', 'melee'); r.calls.menu[0].run(); r.calls.menu[2].run();
    expect(r.calls.moved).toEqual([['melee', 'b1'], ['melee', 'b2'], ['melee', 'new']]);
  });
  it('right-click on a chip that is out (Chat window): back to main, or on to another window, but not to the window it is already in', () => {
    const r = row({ melee: true, spells: true }, { wins: WINS });
    r.setMore(true);
    r.fire('contextmenu', 'melee');
    expect(r.calls.menu.map(i => i.label)).toEqual(['Move to main window', 'Move to window ▸']);
    r.calls.menu[1].run();
    expect(r.calls.menu.map(i => i.label)).toEqual(['Guild', 'New window']);        // b1 (its own) is not offered
    r.calls.menu[1].run();
    expect(r.calls.moved).toEqual([['melee', 'new']]);
  });
  it('inside a breakout: its chip row shows the groups it holds; right-click offers "Move to main window" and "Move to window ▸"', () => {
    const r = row({ melee: true, spells: true }, { brk: ['melee', 'spells'], wid: 'b1', wins: WINS });
    expect(r.labels()).toEqual(['Melee', 'Spells']);                                // the agent's order, and no More
    r.fire('contextmenu', 'spells');
    expect(r.calls.menu.map(i => i.label)).toEqual(['Move to main window', 'Move to window ▸']);
    r.calls.menu[0].run();
    expect(r.calls.moved).toEqual([['spells', 'main']]);
    r.calls.menu[1].run();
    expect(r.calls.menu.map(i => i.label)).toEqual(['Guild', 'New window']);
    r.calls.menu[0].run();
    expect(r.calls.moved).toEqual([['spells', 'main'], ['spells', 'b2']]);
  });
  it('a group alone in its breakout is offered no "New window" (it would only swap windows), just main and the others', () => {
    const r = row({ melee: true }, { brk: 'melee', wid: 'b1', wins: [{ id: 'b1', groups: ['melee'] }, { id: 'b2', groups: ['guild'] }] });
    r.fire('contextmenu', 'melee');
    expect(r.calls.menu.map(i => i.label)).toEqual(['Move to main window', 'Move to window ▸']);
    r.calls.menu[1].run();
    expect(r.calls.menu.map(i => i.label)).toEqual(['Guild']);
    const only = row({ melee: true }, { brk: 'melee', wid: 'b1', wins: [{ id: 'b1', groups: ['melee'] }] });
    only.fire('contextmenu', 'melee');
    expect(only.calls.menu.map(i => i.label)).toEqual(['Move to main window']);
  });
  it('a chip in a multi-group breakout hides and shows that group in THIS window only, remembered under the window id; a solo window has nothing to switch', () => {
    const r = row({ melee: true, spells: true }, { brk: ['melee', 'spells'], wid: 'b1', wins: WINS });
    expect(r.buttons().map(b => b.cls.includes('on'))).toEqual([true, true]);
    r.fire('click', 'spells');
    expect(r.__store).toEqual({ 'wpChatBrkOff:b1': 'spells' });
    expect(r.buttons().find(b => b.g === 'spells').cls).not.toContain('on');
    expect(r.calls.saved).toEqual([]);                                              // never written to the shared prefs
    expect(r.makeFilter(r.shownGroupIds())({ ch: 'spell' })).toBe(false);
    expect(r.makeFilter(r.shownGroupIds())({ ch: 'melee' })).toBe(true);
    r.fire('click', 'spells');
    expect(r.__store).toEqual({ 'wpChatBrkOff:b1': '' });
    const solo = row({ melee: true }, { brk: 'melee', wid: 'b1', wins: [{ id: 'b1', groups: ['melee'] }] });
    solo.fire('click', 'melee');
    expect(solo.__store).toEqual({});
    expect(solo.buttons()[0].cls).toContain('solo');
  });
  it('every chip is a real button (the hover handshake) and a gated group in a breakout still has its chip, dim, so it can be moved out', () => {
    const r = row({}, { brk: ['guild', 'officer'], wid: 'b2', wins: [{ id: 'b2', groups: ['guild', 'officer'] }] });
    expect(r.chipsEl.innerHTML).toMatch(/^<button type="button" class="chip/);
    const off = r.buttons().find(b => b.g === 'officer');
    expect(off.cls).not.toContain('on');                                            // officer is off: dim, not missing
    expect(r.buttons().find(b => b.g === 'guild').cls).toContain('on');
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

// A breakout window follows the list main keeps: groups moved in show up, groups moved out go, the title is the joined names.
describe('chat.html: a breakout follows the window list main hands it', () => {
  const s = script_();
  function page(opts = {}) {
    return evalBlock(`
      var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
      var _prefs = ${JSON.stringify({ off: [], melee: true, spells: true, skills: true, ...(opts.prefs || {}) })};
      var _wid = ${JSON.stringify(opts.brk ? 'b1' : '')}, _only = ${JSON.stringify(opts.brk || [])}, _isBrk = ${!!opts.brk};
      var _wins = [], _out = [], _brkOff = [];
      var CHIP_LABEL = { group: 'Party' };
      var log = { paint: 0, sent: [], title: '', doc: '', hb: '' };
      function paintChips(){ log.paint++; } function repaint(){ log.paint++; } function paintSettings(){ log.paint++; }
      function brkGroupId(){ return _only[0] || ''; }
      var document = { title: '', getElementById: function(id){ return id === 'ttl' ? ttl : hide; } };
      var ttl = { textContent: '' }, hide = { title: '' };
      var window = { mimic: {
        chatMoveGroup: function(g, t){ log.sent.push(['move', g, t]); return Promise.resolve(ANSWER); },
        chatBreakoutClose: function(w){ log.sent.push(['close', w]); return Promise.resolve(ANSWER); } } };
      var ANSWER = [];
      function gateOn(g){ return !g.gate || !!_prefs[g.gate]; }
      ${sliceBlock(s, 'function moveGroup(id, target){', 'return null; }')}
      ${sliceBlock(s, 'function paintBrkTitle(){', "hb.title = 'Put ' + label + ' back in the Chat window';\n  }")}
      ${sliceBlock(s, 'function brkEmptyText(){', "return 'nothing yet in ' + brkTitleText();\n  }")}
      function answer(a){ ANSWER = a; }
    `, ['takeOut', 'moveGroup', 'closeBreakout', 'paintBrkTitle', 'brkEmptyText', 'namesOf', 'holdsGroup', 'homeOf', 'answer', 'log', 'document', 'ttl', 'hide', '_groups', '_prefs']);
  }
  it('the Chat window marks every group held by any breakout as out, and nothing else', () => {
    const p = page();
    p.takeOut([{ id: 'b1', groups: ['melee', 'spells'] }, { id: 'b2', groups: ['guild'] }]);
    expect(p.homeOf('spells').id).toBe('b1');
    expect(p.homeOf('guild').id).toBe('b2');
    expect(p.homeOf('raid')).toBeNull();
    expect(p.holdsGroup('anything')).toBe(true);                        // the Chat window holds whatever is not out
  });
  it('a breakout takes its own entry: a group moved in is held, one moved out is gone, another window\'s groups are not', () => {
    const p = page({ brk: ['melee'] });
    expect(p.holdsGroup('spells')).toBe(false);
    p.takeOut([{ id: 'b1', groups: ['melee', 'spells'] }, { id: 'b2', groups: ['guild'] }]);
    expect(p.holdsGroup('spells')).toBe(true);
    expect(p.holdsGroup('guild')).toBe(false);
    p.takeOut([{ id: 'b1', groups: ['spells'] }, { id: 'b2', groups: ['guild'] }]);
    expect(p.holdsGroup('melee')).toBe(false);
    expect(p.holdsGroup('spells')).toBe(true);
  });
  it('a list without this window in it (it is closing) leaves the window as it was', () => {
    const p = page({ brk: ['melee', 'spells'] });
    p.takeOut([{ id: 'b2', groups: ['guild'] }]);
    expect(p.holdsGroup('melee')).toBe(true);
    expect(p.holdsGroup('spells')).toBe(true);
  });
  it('junk in the list is ignored: bad shapes, bad group ids, and a group named twice', () => {
    const p = page({ brk: ['melee'] });
    p.takeOut([null, 'b1', { id: 'b1' }, { id: 7, groups: ['x'] }, { id: 'b1', groups: ['melee', 'melee', '../x', 'Guild', 5, 'spells'] }]);
    expect(p.holdsGroup('spells')).toBe(true);
    expect(p.holdsGroup('x')).toBe(false);
    p.takeOut('nope'); p.takeOut(undefined);
  });
  it('a list that has not changed repaints nothing', () => {
    const p = page({ brk: ['melee'] });
    const list = () => [{ id: 'b1', groups: ['melee', 'spells'] }];
    p.takeOut(list());
    const n = p.log.paint;
    p.takeOut(list());
    expect(p.log.paint).toBe(n);
    p.takeOut([{ id: 'b1', groups: ['melee'] }]);
    expect(p.log.paint).toBeGreaterThan(n);
  });
  it('the title is the joined group names, in the window and in the title bar, and the ✕ says what it puts back', () => {
    const p = page({ brk: ['melee', 'spells'] });
    p.paintBrkTitle();
    expect(p.ttl.textContent).toBe('💬 Melee + Spells');
    expect(p.document.title).toBe('chat: Melee + Spells');
    expect(p.hide.title).toBe('Put Melee + Spells back in the Chat window');
    const one = page({ brk: ['guild'] }); one.paintBrkTitle();
    expect(one.ttl.textContent).toBe('💬 Guild');
    const party = page({ brk: ['guild', 'group'] }); party.paintBrkTitle();
    expect(party.ttl.textContent).toBe('💬 Guild + Party');
  });
  it('an empty window says what it waits for: the first switched-off group when every group is off, else the names', () => {
    expect(page({ brk: ['melee', 'spells'], prefs: { melee: false, spells: false } }).brkEmptyText()).toBe('Melee is off: switch it on in the Chat window\'s ⚙');
    expect(page({ brk: ['melee', 'spells'], prefs: { melee: false } }).brkEmptyText()).toBe('nothing yet in Melee + Spells');
    expect(page({ brk: ['tell', 'melee'], prefs: { tells: false, melee: false } }).brkEmptyText()).toMatch(/^Tells are off/);
  });
  it('moving a group and closing a window go through the preload, and the answer (the new list) is taken at once', async () => {
    const p = page({ brk: ['melee'] });
    p.answer([{ id: 'b1', groups: ['melee', 'spells'] }]);
    p.moveGroup('spells', 'b1');
    await Promise.resolve(); await Promise.resolve();
    expect(p.log.sent).toEqual([['move', 'spells', 'b1']]);
    expect(p.holdsGroup('spells')).toBe(true);
    p.closeBreakout();
    expect(p.log.sent.pop()).toEqual(['close', 'b1']);
    expect(page().log.sent).toEqual([]);
    const main = page(); main.closeBreakout();                          // the Chat window has no window id: nothing to close
    expect(main.log.sent).toEqual([]);
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
    expect(ids(els.optins.innerHTML)).toEqual(['away', 'group', 'officer', 'custom']);
    expect(ids(els.moreoptins.innerHTML)).toEqual(['melee', 'spells', 'skills', 'loot', 'random', 'other']);
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

// ── Loot [LT], Random [RND] and Other [OT] (the guild lead, 2026-10-15: "chat overlay needs the rest of the channels
// available, loot, money, other, etc"). Every line below is a shape the repo already parses or holds in a fixture:
// trackLootedLine's "--You have looted--", the /random pair of trackRollLine, the XP line of _XP_LINE_RX, the faction
// lines of parseFactionLine, and the golden line-families log. Money has no row (no coin line anywhere in the repo).
describe('Loot, Random and Other: three more opt-in groups, built the way Skills was', () => {
  beforeEach(() => agent._resetLocalChatForTest());
  const LOOT = '--You have looted a Cloak of Flames.--';
  const DIE = '**A Magic Die is rolled by Corvale.';
  const RESULT = '**It could have been any number from 0 to 333, but this time it turned up a 116.';
  // fixtures: me-hud-timers (xp), the agent's faction header comment, test/fixtures/golden/line-families.log (rest)
  const OTHERS = [
    'You gain experience!!', 'You gain party experience!!',
    'Your faction standing with VeliumHounds got worse.', 'Your faction standing with KaladimCitizens got better.',
    'Loading bandolier set [emp]', 'Bandolier set [1] is already equipped', 'You are too busy to equip bandolier set!',
    'Sylvarra is an Officer of Wolf Pack.', 'Returning to home point, please wait...', 'You are bleeding to death!', 'You died.',
    'Torvahk has become ENRAGED.', 'You are snared.', 'You throw your head back and let loose a piercing blast.',
  ];

  it('each group is a gated chip with a channel colour and an EQ-style tag', () => {
    for (const [id, ch, tag] of [['loot', 'loot', 'LT'], ['random', 'random', 'RND'], ['other', 'other', 'OT']]) {
      expect(agent.CHAT_GROUPS.find(g => g.id === id), id).toMatchObject({ channels: [ch], gate: id });
      expect(agent.CHAT_CHANNELS[ch].tag).toBe(tag);
      expect(agent.CHAT_CHANNELS[ch].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const colours = Object.values(agent.CHAT_CHANNELS).map(c => c.color.toLowerCase());
    expect(new Set(colours).size).toBe(colours.length);                      // a colour is a channel's identity: no two alike
  });

  it('Loot: your own looted line, whole, with no speaker; a quoted one is chat\'s, not Loot\'s', () => {
    expect(agent.classifyLootLine(L(LOOT))).toMatchObject({ ch: 'loot', who: '', text: LOOT, self: true, npc: false });
    expect(agent.classifyLootLine(L('You have looted a Cloak of Flames.'))).toBeNull();                       // the dashes are part of the shape
    expect(agent.classifyLootLine(L('Corvale says, \'--You have looted a Cloak of Flames.--\''))).toBeNull();   // someone quoting it
    expect(agent.classifyLootLine(L('Corvale has looted a Cloak of Flames.'))).toBeNull();                    // not a shape the repo has ever seen
    expect(agent.classifyLootLine('')).toBeNull();
  });
  it('Random: both lines of the pair, and nothing resembling them', () => {
    expect(agent.classifyRandomLine(L(DIE))).toMatchObject({ ch: 'random', who: '', text: DIE, self: false });
    expect(agent.classifyRandomLine(L(RESULT))).toMatchObject({ ch: 'random', who: '', text: RESULT });
    expect(agent.classifyRandomLine(L('A Magic Die is rolled by Corvale.'))).toBeNull();
    expect(agent.classifyRandomLine(L('Corvale says, \'**A Magic Die is rolled by Brackwyn.\''))).toBeNull();
  });
  for (const t of OTHERS) {
    it(`Other: "${t}" is a game line nothing else claims`, () => {
      expect(agent.classifyOtherLine(L(t), ME), t).toMatchObject({ ch: 'other', who: '', text: t, npc: false });
    });
  }
  it('Other is never Loot or Random, and Loot and Random are never Other', () => {
    for (const t of [LOOT, DIE, RESULT]) expect(agent.classifyOtherLine(L(t), ME), t).toBeNull();
    for (const t of OTHERS) { expect(agent.classifyLootLine(L(t)), t).toBeNull(); expect(agent.classifyRandomLine(L(t)), t).toBeNull(); }
  });

  it('nothing is captured until the overlay asks, and each switch is its own', () => {
    for (const t of [LOOT, DIE, 'You gain experience!!']) expect(agent.noteLocalChatLine(L(t), ME, 1), t).toBe(false);   // no policy yet
    agent.setChatPolicy({}, 1);
    for (const t of [LOOT, DIE, 'You gain experience!!']) expect(agent.noteLocalChatLine(L(t), ME, 1), t).toBe(false);
    agent.setChatPolicy({ loot: true }, 2);
    expect(agent.noteLocalChatLine(L(LOOT), ME, 2)).toBe(true);
    expect(agent.noteLocalChatLine(L(DIE), ME, 2)).toBe(false);
    expect(agent.noteLocalChatLine(L('You gain experience!!'), ME, 2)).toBe(false);
    agent.setChatPolicy({ random: true }, 3);
    expect(agent.noteLocalChatLine(L(DIE), ME, 3)).toBe(true);
    expect(agent.noteLocalChatLine(L(LOOT.replace('Cloak', 'Robe')), ME, 3)).toBe(false);
    agent.setChatPolicy({ other: true }, 4);
    expect(agent.noteLocalChatLine(L('You gain experience!!'), ME, 4)).toBe(true);
    expect(agent.noteLocalChatLine(L(RESULT), ME, 4)).toBe(false);                    // Random's line is not Other's when Random is off
    expect(agent.noteLocalChatLine(L(LOOT.replace('Cloak', 'Cape')), ME, 4)).toBe(false);
    expect(agent._lootRingForTest().map(r => r.text)).toEqual([LOOT]);
    expect(agent._randomRingForTest().map(r => r.text)).toEqual([DIE]);
    expect(agent._otherRingForTest().map(r => r.text)).toEqual(['You gain experience!!']);
    expect(agent.serializeLocalChat({ loot: true, random: true, other: true }, 5).lines.map(l => l.ch)).toEqual(['loot', 'random', 'other']);
    expect(agent.serializeLocalChat({ random: true }, 5).lines.map(l => l.ch)).toEqual(['random']);
    expect(agent.serializeLocalChat({}, 5).lines).toHaveLength(0);                     // asked off: held, not served
  });
  it('/api/chat reads loot=1, random=1 and other=1 as the switches', () => {
    agent.setChatPolicy({ loot: true, random: true, other: true }, Date.now());
    for (const t of [LOOT, DIE, 'You gain experience!!']) agent.noteLocalChatLine(L(t), ME);
    const get = (qs) => { const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
      agent._handleLocalChatForTest({ url: '/api/chat?since=0' + qs, headers: {} }, res); return JSON.parse(res.body); };
    expect(get('&loot=1&random=1&other=1').lines.map(l => l.ch)).toEqual(['loot', 'random', 'other']);
    expect(get('&other=1').lines.map(l => l.ch)).toEqual(['other']);
    expect(get('').lines).toEqual([]);
    expect(get('&other=1').groups.map(g => g.id)).toEqual(expect.arrayContaining(['loot', 'random', 'other']));
  });

  // ── Other is a fallback: it must never take a line another group owns, and never a line that is speech ──
  it('Other does not take a line Melee, Spells or Skills owns, whichever of their switches is on', () => {
    const OWNED = ['You begin casting Spirit of Wolf.', 'You have become better at Swimming! (45)', 'You mend your wounds and heal some damage.',
      'You have fallen to the ground.', 'Brackwyn begins to cast a spell.', 'You slash a goblin for 120 points of damage.',
      'You try to kick a goblin, but miss!', 'Your spell fizzles!'];
    for (const t of OWNED) expect(agent.classifyOtherLine(L(t), ME), t).toBeNull();
    agent.setChatPolicy({ other: true }, 1);                                           // every owning switch OFF
    for (const t of OWNED) expect(agent.noteLocalChatLine(L(t), ME, 1), t).toBe(false);
    expect(agent._otherRingForTest()).toHaveLength(0);
    agent.setChatPolicy({ other: true, melee: true, spells: true, skills: true }, 2);   // all ON: each line lands in its own ring only
    for (const t of OWNED) expect(agent.noteLocalChatLine(L(t), ME, 2), t).toBe(true);
    expect(agent._otherRingForTest()).toHaveLength(0);
    expect(agent._meleeRingForTest().length + agent._spellRingForTest().length + agent._skillRingForTest().length).toBe(OWNED.length);
  });
  it('Other never takes chat of any channel, quoted or not, gated or not', () => {
    const CHAT = ['Corvale tells the guild, \'pull in five\'', 'You say to your guild, \'on my way\'', 'Corvale tells you, \'got a minute?\'',
      'You told Corvale, \'sure\'', 'Brackwyn tells the group, \'inc\'', 'You tell your party, \'ok\'', 'Rethlan tells Wolfpackofficer:5, \'keep this quiet\'',
      'Zarrin tells General:2, \'anyone for a group\'', 'Zarrin says, \'hello there\'', 'Zarrin shouts, \'train to zone\'',
      'a goblin warrior says, \'You will not leave this place alive\'', 'Gobn tells you, \'Attacking Lord Nagafen Master.\'',
      '[G] [Corvale]: hello', '[2] [Zarrin]: a', '[Zz] [Corvale]: an unknown abbreviation tag',
      'Corvale tells the guild, \'ZEALTAG | x\'', '[Zeal] ZT | 12 34'];
    for (const t of CHAT) expect(agent.classifyOtherLine(L(t), ME), t).toBeNull();
    // and through the real entry point, with Other on and EVERY private switch off
    agent.setChatPolicy({ other: true }, 1);
    for (const t of CHAT) agent.noteLocalChatLine(L(t), ME, 1);
    expect(agent._otherRingForTest()).toHaveLength(0);
    // the public channels are chat's own (they show by default); no private one leaked into the chat ring either
    const PUBLIC = ['guild', 'raid', 'say', 'ooc', 'shout', 'auction', 'npc', 'zone'];
    expect(agent._chatRingForTest().length).toBeGreaterThan(0);
    for (const r of agent._chatRingForTest()) expect(PUBLIC, r.text).toContain(r.ch);
  });
  it('privacy gates are unchanged: with every new switch on, tells, group, officer and custom stay behind their own', () => {
    agent.setChatPolicy({ loot: true, random: true, other: true }, 1);
    const PRIVATE = ['Corvale tells you, \'got a minute?\'', 'Brackwyn tells the group, \'inc\'', 'Rethlan tells Wolfpackofficer:5, \'quiet\'',
      'Zarrin tells General:2, \'anyone\'', 'You told Corvale, \'sure\''];
    for (const t of PRIVATE) expect(agent.noteLocalChatLine(L(t), ME, 1), t).toBe(false);
    expect(agent.serializeLocalChat({ loot: true, random: true, other: true }, 1).lines).toHaveLength(0);
    // switching a private channel on shows it as itself, never as Other
    agent.setChatPolicy({ other: true, officer: true }, 2);
    expect(agent.noteLocalChatLine(L(PRIVATE[2]), ME, 2)).toBe(true);
    expect(agent.serializeLocalChat({ other: true, officer: true }, 2).lines.map(l => l.ch)).toEqual(['officer']);
    expect(agent._otherRingForTest()).toHaveLength(0);
    // the default policy is still the public one
    expect(agent.chatPolicyNow()).toMatchObject({ tells: false, group: false, officer: false, custom: false, loot: false, random: false, other: false });
  });
  it('combat damage and the loading banner are not Other', () => {
    for (const t of ['You flying kick Lord Nagafen for 452 points of damage.', 'Lord Nagafen was hit by Ancient: Scourge of Nife for 1240 points of damage.',
      'Torvahk tries to bash Lord Nagafen, but Lord Nagafen is INVULNERABLE!', 'LOADING, PLEASE WAIT...']) expect(agent.classifyOtherLine(L(t), ME), t).toBeNull();
  });

  it('a /random heard by two of your characters is one copy; your own loot and experience lines are each kept', () => {
    agent.setChatPolicy({ loot: true, random: true, other: true }, 1);
    expect(agent.noteLocalChatLine(L(DIE), 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(L(DIE), 'Corvale', 1)).toBe(false);
    expect(agent.noteLocalChatLine(L(LOOT), 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(L(LOOT), 'Corvale', 1)).toBe(true);                  // two characters, two loots
    expect(agent.noteLocalChatLine(L('You gain experience!!'), 'Aldenmar', 1)).toBe(true);
    expect(agent.noteLocalChatLine(L('You gain experience!!'), 'Corvale', 1)).toBe(true);
    expect(agent._lootRingForTest()).toHaveLength(2);
    expect(agent._randomRingForTest()).toHaveLength(1);
    expect(agent._otherRingForTest()).toHaveLength(2);
  });
  it('a flood cannot push anything out: a ring each, capped at 300, one cursor over all of them', () => {
    agent.setChatPolicy({ loot: true, random: true, other: true }, 1);
    for (let i = 0; i < 5; i++) agent.noteLocalChatLine(L(`Corvale tells the guild, 'line ${i}'`), ME, 1);
    for (let i = 0; i < 400; i++) {
      const s = String(i % 60).padStart(2, '0');
      agent.noteLocalChatLine(`[Wed Oct 14 21:12:${s} 2026] --You have looted a Item Number ${i}.--`, ME, 1);
      agent.noteLocalChatLine(`[Wed Oct 14 21:13:${s} 2026] **It could have been any number from 0 to 100, but this time it turned up a ${i % 100}.`, ME, 1);
      agent.noteLocalChatLine(`[Wed Oct 14 21:14:${s} 2026] Your faction standing with Faction${i} got better.`, ME, 1);
    }
    expect([agent.CHAT_LOOT_RING_MAX, agent.CHAT_RANDOM_RING_MAX, agent.CHAT_OTHER_RING_MAX]).toEqual([300, 300, 300]);
    expect(agent._lootRingForTest()).toHaveLength(300);
    expect(agent._otherRingForTest()).toHaveLength(300);
    expect(agent._otherRingForTest().pop().text).toBe('Your faction standing with Faction399 got better.');   // the newest are kept
    expect(agent._chatRingForTest().filter(r => r.ch === 'guild')).toHaveLength(5);                      // chat untouched
    const page = agent.serializeLocalChat({ loot: true, random: true, other: true }, 1);
    const seqs = page.lines.map(l => l.n);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(page.lines.length).toBeLessThanOrEqual(agent.CHAT_PAGE_MAX);
    expect(agent.serializeLocalChat({ other: true }, 1).lines.every(l => l.ch === 'other')).toBe(true);   // a switch that is off leaves its ring unread
  });

  it('local only: the rows enter through the same guarded call as chat, touch no upload buffer, and are read nowhere else', () => {
    const code = stripJs(AGENT_SRC);
    expect(code.match(/classifyOtherLine\(/g)).toHaveLength(2);                          // its definition, and noteLocalChatLine
    expect(code.match(/classifyLootLine\(/g)).toHaveLength(3);                            // its definition, noteLocalChatLine, classifyOtherLine
    expect(code.match(/classifyRandomLine\(/g)).toHaveLength(3);
    const note = sliceBlock(code, 'function noteLocalChatLine(line, character, now) {', '\n}\n');
    for (const used of ['classifyLootLine(line)', 'classifyRandomLine(line)', 'classifyOtherLine(line, character,']) expect(note, used).toContain(used);
    expect(note.indexOf('classifyOtherLine(')).toBeGreaterThan(note.indexOf('classifySpellLine('));   // asked last
    const block = stripJs(AGENT_SRC.slice(AGENT_SRC.indexOf('// ── Loot, Random and Other rows'), AGENT_SRC.indexOf('// The overlay\'s switches, handed over')));
    expect(block.length).toBeGreaterThan(1500);                                          // the anchors found the block
    expect(block).not.toMatch(/chatBuffer|tellBuffer|enqueueUpload|fetch\(|writeFile|fs\./);
    // the patterns are the existing parsers' own, not copies
    expect(block).toContain('_LOOTED_RX.test(body)');
    expect(block).toContain('_ROLL_DIE_RX.test(line)');
    expect(block).toContain('_ROLL_RESULT_RX.test(line)');
    // upload buffers do not move when the rows are captured
    const before = agent._uploadBuffersForTest();
    const sizes = [before.chatBuffer.length, before.tellBuffer.length, before.recentTells.length];
    agent.setChatPolicy({ loot: true, random: true, other: true }, 1);
    for (const t of [LOOT, DIE, RESULT, ...OTHERS]) agent.noteLocalChatLine(L(t), ME, 1);
    const after = agent._uploadBuffersForTest();
    expect([after.chatBuffer.length, after.tellBuffer.length, after.recentTells.length]).toEqual(sizes);
  });
  it('history stays chat only: none of the three is read back from the log files', () => {
    expect(stripJs(HISTORY_BLOCK)).not.toMatch(/classifyLootLine|classifyRandomLine|classifyOtherLine/);
  });

  // ── the overlay ──
  it('in the overlay all three stay out of the main view until their switch is on, then are chips like any group, tagged and nameless', () => {
    const lines = {
      loot: { n: 1, t: 0, ch: 'loot', who: '', text: LOOT, self: true },
      random: { n: 2, t: 0, ch: 'random', who: '', text: RESULT },
      other: { n: 3, t: 0, ch: 'other', who: '', text: 'You gain experience!!', self: true },
    };
    const off = overlay({});
    for (const id of ['loot', 'random', 'other']) {
      expect(off.shownGroupIds(), id).not.toContain(id);
      expect(off.makeFilter(off.shownGroupIds())(lines[id]), id).toBe(false);
      const on = overlay({ [id]: true });                                                // one switch does not bring the others
      expect(on.shownGroupIds(), id).toContain(id);
      expect(on.makeFilter(on.shownGroupIds())(lines[id]), id).toBe(true);
      for (const other of Object.keys(lines).filter(x => x !== id)) expect(on.makeFilter(on.shownGroupIds())(lines[other]), `${id} on, ${other}`).toBe(false);
      const brk = overlay({ [id]: true }, { brk: id });
      expect(brk.makeFilter(brk.shownGroupIds())(lines[id]), `${id} breakout`).toBe(true);
      const still = overlay({}, { brk: id });
      expect(still.makeFilter(still.shownGroupIds())(lines[id]), `${id} breakout, still gated`).toBe(false);
    }
    const all = overlay({ loot: true, random: true, other: true });
    for (const [id, tag] of [['loot', 'LT'], ['random', 'RND'], ['other', 'OT']]) {
      expect(all.lineHtml(lines[id])).toContain(`[${tag}]`);
      expect(all.lineHtml(lines[id])).not.toContain('class="who');                       // the log's own sentence: no speaker
    }
  });
  it('the ⚙ lists the three switches in the fold, sends them with every poll, and reads them back with the prefs', () => {
    const code = stripJs(CHAT_HTML);
    for (const id of ['loot', 'random', 'other']) expect(code).toMatch(new RegExp(`\\['${id}',\\s+'${id[0].toUpperCase()}${id.slice(1)}',`));
    expect(code).toMatch(/'&loot=' \+ \(_prefs\.loot \? 1 : 0\) \+ '&random=' \+ \(_prefs\.random \? 1 : 0\) \+ '&other=' \+ \(_prefs\.other \? 1 : 0\)/);
    expect(code).toMatch(/loot: !!p\.loot, random: !!p\.random, other: !!p\.other/);
    expect(code).toMatch(/loot: false, random: false, other: false, away: true, meleeShow/);         // off until switched on, before the first prefs arrive
    // all three are the "more" kind (they sit in the fold with Melee/Spells/Skills), not the visible row
    const optins = sliceBlock(code, 'var OPTINS = [', '\n  ];');
    for (const id of ['loot', 'random', 'other']) expect(optins).toMatch(new RegExp(`\\['${id}',[^\\n]*, 1\\]`));
  });
  it('Mimic remembers the three switches (default off) and only as booleans', () => {
    const code = stripJs(MAIN);
    expect(code).toMatch(/for \(const k of \['group', 'officer', 'custom', 'melee', 'spells', 'skills', 'loot', 'random', 'other', 'away'\]\) if \(typeof inc\[k\] === 'boolean'\)/);
    for (const id of ['loot', 'random', 'other']) expect(code).toContain(`${id}: p.${id} === true,`);
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
//   • (2026-10-15, Loot/Random/Other) removed the Skills re-ask from classifyOtherLine  → "Other does not take a line Melee, Spells or Skills owns" went red
//   • (2026-10-15, Loot/Random/Other) removed the CHAT_OTHER_SPEECH_RX guard             → "Other never takes chat of any channel" went red
// Not mutation-checked: the "call runs ahead of shouldKeep" ordering test (it asserts an index comparison that no
// natural edit flips without also tripping the guard test).
