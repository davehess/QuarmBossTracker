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
    const outside = stripJs(AGENT_SRC.replace(CHAT_BLOCK, ''));
    const uses = outside.split('\n').filter(l => /\b(?:_chatRing|serializeLocalChat|_handleLocalChat|CHAT_BOOT|noteLocalChatLine|classifyChatLine|chatChannelAllowed|CHAT_GROUPS)\b/.test(l)).map(l => l.trim());
    // exactly five lines mention the feed outside its block: the route, the tail tap, and three export lines
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
    expect(script).toMatch(/el\.closest\('\.title, #chips, #spanel, #feed, #newchip'\)/);
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
    const lineHtml = script.slice(script.indexOf('function lineHtml(l){'), script.indexOf('function pinned()'));
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
  it('does not build tabs or tear-out yet (B now, A later)', () => {
    // (the header comment names them as the plan, so look at markup and code only)
    const markup = stripCss(html.slice(html.indexOf('</style>'), html.indexOf('<script>')));
    expect(markup).not.toMatch(/role="tab"|class="tab\b|tearout|tear-out|detach/i);
    expect(script).not.toMatch(/tearOut|tear-out|detach|role="tab"|class="tab\b/i);
  });
});

// The feed's filter, run for real: this is the seam tabs will use.
describe('chat.html: the feed is painted through a filter handed a list of groups', () => {
  const script = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));
  const make = (prefs) => evalBlock(`
    var _groups = ${JSON.stringify(agent.CHAT_GROUPS)};
    var _prefs = ${JSON.stringify({ fontSize: 12, group: false, officer: false, custom: false, tells: false, off: [], ...prefs })};
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
    expect(make({}).shownGroupIds()).toEqual(['guild', 'raid', 'say', 'ooc', 'auction', 'npc']);
    expect(make({ off: ['raid', 'auction'] }).shownGroupIds()).toEqual(['guild', 'say', 'ooc', 'npc']);
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
      function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
      function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); SAVED.push(CFG); }
      ${sliceBlock(MAIN, 'function _chatCharKey(char) {', "  return _chatPrefsPayload(cfg, char);\n});")}
    `.replace('HANDLERS', 'globalThis.__H').replace('SAVED', 'globalThis.__S'), ['_chatCharKey', '_chatPrefsPayload']);
    return { r, get: (...a) => globalThis.__H['chat-prefs-get']({}, ...a), set: (...a) => globalThis.__H['chat-prefs-set']({}, ...a), saved: () => globalThis.__S };
  }
  beforeEach(() => { globalThis.__H = {}; globalThis.__S = []; });
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
