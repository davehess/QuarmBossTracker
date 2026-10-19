// test/chat-zeal-channels.test.js: the Chat overlay's channels from ZEAL (the guild lead, 2026-10-19; DECISIONS §383:
// "I need the differentiation to be present based on the Zeal options, not just what's in the logs based and using the
// standard Everquest breakdown. A LOT of items currently end up in Other.").
//
// What Zeal sends: for every line the game prints, a pipe type-0 message { type: <colour index>, text }. The index is the
// channel (Zeal/game_structures.h USERCOLOR_* = 256 + n; Zeal/chatfilter.h CHANNEL_* = 1000+). The log has none of it.
// Mimic reads it (zealPipe.js chatLineOf), the agent keeps it as a short HINT per character + text and asks it when the
// log tail reads the same line. The log line stays the source of what is shown; the hint only names its channel.
//
// ⚠ FIXTURES. The LOG lines below are real (test/fixtures/golden/*.log). The pipe colours are NOT captured traffic: no real
// type-0 capture exists in the repo. Each colour is the one Zeal's source assigns to that kind of line, and the envelope is
// the shape Zeal's NamedPipe::chat_msg writes (data double-encoded). Lines marked (synthetic) are invented sentences used
// only where the route is decided by the colour alone (a coin split, an emote).
//
// Run: npx vitest run test/chat-zeal-channels.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const pipe = require_(path.join(ROOT, 'apps', 'mimic', 'zealPipe.js'));
const AGENT_SRC = readSource(AGENT_INDEX);
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'golden');

const ME = 'Aldenmar';
const TS = '[Sun Aug 02 20:41:20 2026]';
const L = (s) => `${TS} ${s}`;
const T0 = 1_000_000;
const golden = (f) => fs.readFileSync(path.join(GOLDEN, f), 'utf8').split(/\r?\n/).filter(Boolean);
const body = (l) => l.slice(l.indexOf('] ') + 2);

// What Zeal's NamedPipe::chat_msg puts on the wire for one printed line.
const wire = (character, colour, text) => ({ type: 0, character, data: JSON.stringify({ type: colour, text }) });
// Hand the agent what Mimic would send for these (character, colour, text) triples.
const hear = (triples, now = T0) => agent.zealChatTake({ lines: triples.map(([c, k, x]) => ({ c, k, x })) }, now);
const ring = () => agent._otherRingForTest();
const chans = () => ring().map(r => r.ch);

beforeEach(() => agent._resetLocalChatForTest());

// ── 1. The colour table is Zeal's, not ours ───────────────────────────────────────────────
describe('ZEAL_CHAT_COLOR: indices are Zeal\'s own (game_structures.h USERCOLOR_*, chatfilter.h CHANNEL_*)', () => {
  const C = agent.ZEAL_CHAT_COLOR;
  it('chat colours are claimed by the log parser, never Other and never re-homed', () => {
    // 256 say, 257 tell, 258 group, 259 guild, 260 ooc, 261 auction, 262 shout, 290-300 chat channels, 327 raid say
    for (const k of [256, 257, 258, 259, 260, 261, 262, 290, 291, 300, 327]) expect(C[k], String(k)).toBeNull();
    for (const k of [307, 313, 315, 324]) expect(C[k], `echo ${k}`).toBeNull();
  });
  it('each Zeal channel the overlay did not have routes to its own chip', () => {
    expect(C[263]).toMatchObject({ ch: 'emote' });                                  // USERCOLOR_EMOTE
    expect(C[285]).toMatchObject({ ch: 'money' });                                  // USERCOLOR_MONEY_SPLIT
    expect(C[328]).toMatchObject({ ch: 'money' });                                  // USERCOLOR_ECHO_AUTOSPLIT
    expect(C[281]).toMatchObject({ ch: 'who' });                                    // USERCOLOR_WHO
    expect(C[277]).toMatchObject({ ch: 'death' });                                  // USERCOLOR_YOUR_DEATH
    expect(C[278]).toMatchObject({ ch: 'death' });                                  // USERCOLOR_OTHER_DEATH
    expect(C[269]).toMatchObject({ ch: 'bcast' });                                  // USERCOLOR_DUELS (broadcasts)
    expect(C[282]).toMatchObject({ ch: 'bcast' });                                  // USERCOLOR_YELL
    expect(C[1002]).toMatchObject({ ch: 'pet' });                                   // CHANNEL_MYPETSAY
    expect(C[1003]).toMatchObject({ ch: 'pet' });                                   // CHANNEL_OTHERPETSAY
    for (const k of [1006, 1007, 1010, 1011, 1012]) expect(C[k], String(k)).toMatchObject({ ch: 'zeal' });   // mystats, item speech, spam, bandolier x2
  });
  it('the groups that already existed keep their own channel', () => {
    expect(C[286]).toMatchObject({ ch: 'loot' });
    expect(C[287]).toMatchObject({ ch: 'random' });
    expect(C[270]).toMatchObject({ ch: 'skill' });
    expect(C[271]).toMatchObject({ ch: 'skill' });
    expect(C[264]).toMatchObject({ ch: 'spell' });
    expect(C[304]).toMatchObject({ ch: 'melee', cat: 'others' });                   // NPC rampage
    expect(C[267]).toMatchObject({ ch: 'melee', cat: 'mine', miss: true });
    expect(C[268]).toMatchObject({ ch: 'melee', cat: 'on_me', miss: true });
    expect(C[1004]).toMatchObject({ ch: 'melee', cat: 'mine' });                    // my melee special
  });
  it('the default colour (273) and the tick (0) are in no table: the log text decides', () => {
    expect(273 in C).toBe(false);
    expect(0 in C).toBe(false);
  });
  it('every route lands on a channel the overlay serves, and on a group that gates it', () => {
    for (const [k, r] of Object.entries(C)) {
      if (r === null) continue;
      expect(agent.CHAT_CHANNELS[r.ch], `colour ${k} -> ${r.ch}`).toBeTruthy();
      expect(agent.CHAT_GROUPS.some(g => g.channels.includes(r.ch)), `colour ${k} -> ${r.ch}`).toBe(true);
    }
  });
});

// ── 2. Mimic's side: the pipe message → { c, k, x } ───────────────────────────────────────
describe('zealPipe.chatLineOf: the pipe\'s log message', () => {
  it('reads the double-encoded data Zeal writes', () => {
    expect(pipe.chatLineOf(wire(ME, 285, 'You receive 5 platinum as your split.'))).toEqual({ c: ME, k: 285, x: 'You receive 5 platinum as your split.' });
  });
  it('reads data that arrived already decoded', () => {
    expect(pipe.chatLineOf({ type: 0, character: ME, data: { type: 263, text: 'Torvahk bows to you.' } })).toEqual({ c: ME, k: 263, x: 'Torvahk bows to you.' });
  });
  it('the 6 s tick (colour 0, "Tick") is kept: it is how the agent knows the pipe is talking', () => {
    expect(pipe.chatLineOf(wire(ME, 0, 'Tick'))).toEqual({ c: ME, k: 0, x: 'Tick' });
  });
  it('melee hits and non-melee damage are not sent: the flood, already read from the log', () => {
    for (const k of [265, 266, 279, 283, 1000, 1001]) expect(pipe.chatLineOf(wire(ME, k, 'a')), String(k)).toBeNull();
  });
  it('misses are sent: a bare "X misses Y." is not a line the log parsers claim', () => {
    for (const k of [267, 268, 280]) expect(pipe.chatLineOf(wire(ME, k, 'Lord Nagafen misses Torvahk.')), String(k)).not.toBeNull();
  });
  it('anything else is nothing: other pipe types, no character, no text, a colour out of range, broken data', () => {
    expect(pipe.chatLineOf({ type: 2, character: ME, data: '[]' })).toBeNull();
    expect(pipe.chatLineOf({ type: 0, data: JSON.stringify({ type: 1, text: 'a' }) })).toBeNull();
    expect(pipe.chatLineOf({ type: 0, character: ME, data: JSON.stringify({ type: 1 }) })).toBeNull();
    expect(pipe.chatLineOf(wire(ME, -1, 'a'))).toBeNull();
    expect(pipe.chatLineOf(wire(ME, 99999, 'a'))).toBeNull();
    expect(pipe.chatLineOf(wire(ME, 'x', 'a'))).toBeNull();
    expect(pipe.chatLineOf({ type: 0, character: ME, data: '{not json' })).toBeNull();
    expect(pipe.chatLineOf(null)).toBeNull();
  });
});

describe('Mimic forwards the pipe\'s chat only while the Chat overlay exists', () => {
  // Run the real _zealChatNote with its collaborators handed in, so what it does with a message is observed, not read.
  function harness(win) {
    const posts = [];
    const timers = [];
    const http = { request: (opts, cb) => { const r = { on() {}, write(b) { posts.push({ opts, body: JSON.parse(b) }); }, end() {}, destroy() {} }; return r; } };
    const src = sliceBlock(MAIN, 'let _zealChatPending = [];', '\n}\n\n// Live Zeal state per character');
    const fn = new Function('chatWindow', 'chatLineOf', 'agentPort', 'http', 'setTimeout', 'clearTimeout',
      src + '\nreturn { note: _zealChatNote, flush: _flushZealChat, pending: () => _zealChatPending };');
    return { ...fn(win, pipe.chatLineOf, 7777, http, (f) => { timers.push(f); return timers.length; }, () => {}), posts, timers };
  }
  it('no Chat overlay: nothing is read, nothing is sent', () => {
    for (const win of [null, { isDestroyed: () => true }]) {
      const h = harness(win);
      h.note(wire(ME, 259, 'Corvale tells the guild, \'x\''));
      expect(h.pending()).toEqual([]);
      expect(h.posts).toEqual([]);
      expect(h.timers).toHaveLength(0);
    }
  });
  it('with the overlay open, lines are batched and POSTed to the local agent only', () => {
    const h = harness({ isDestroyed: () => false });
    h.note(wire(ME, 285, 'a'));
    h.note(wire(ME, 265, 'a flood hit'));                                            // not sent
    h.note(wire(ME, 263, 'b'));
    expect(h.pending()).toEqual([{ c: ME, k: 285, x: 'a' }, { c: ME, k: 263, x: 'b' }]);
    h.flush();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].opts).toMatchObject({ host: '127.0.0.1', port: 7777, path: '/api/zeal-chat', method: 'POST' });
    expect(h.posts[0].body.lines).toHaveLength(2);
    expect(h.pending()).toEqual([]);
  });
  it('the overlay closing drops whatever was waiting', () => {
    const win = { isDestroyed: () => false };
    const h = harness(win);
    h.note(wire(ME, 285, 'a'));
    win.isDestroyed = () => true;
    h.note(wire(ME, 285, 'b'));
    expect(h.pending()).toEqual([]);
  });
});

// ── 3. The agent keeps hints only while the overlay asks, and only for what it can use ────────
describe('zealChatTake: hints are short-lived, local, and only while the overlay is asking', () => {
  it('nothing is kept until the Chat overlay has asked (a closed overlay leaves nothing accumulating)', () => {
    expect(hear([[ME, 263, 'Torvahk bows to you.']])).toBe(0);
    expect(agent.zealChannelHint(ME, L('Torvahk bows to you.'), T0)).toBeNull();
    agent.setChatPolicy({ other: true }, T0);
    expect(hear([[ME, 263, 'Torvahk bows to you.']])).toBe(1);
    expect(agent.zealChannelHint(ME, L('Torvahk bows to you.'), T0)).toMatchObject({ k: 263 });
  });
  it('the overlay going quiet stops it again', () => {
    agent.setChatPolicy({ other: true }, T0);
    expect(hear([[ME, 263, 'a']], T0 + agent.CHAT_POLICY_TTL_MS + 1)).toBe(0);
  });
  it('a hint belongs to one character and one sentence', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 263, 'Torvahk bows to you.']]);
    expect(agent.zealChannelHint('Brackwyn', L('Torvahk bows to you.'), T0)).toBeNull();
    expect(agent.zealChannelHint(ME, L('Torvahk bows to Brackwyn.'), T0)).toBeNull();
    expect(agent.zealChannelHint(ME.toUpperCase(), L('Torvahk bows to you.'), T0)).not.toBeNull();   // names are case-blind
  });
  it('a hint expires (the same sentence later is a different line)', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 263, 'Torvahk bows to you.']]);
    expect(agent.zealChannelHint(ME, L('Torvahk bows to you.'), T0 + 29_000)).not.toBeNull();
    expect(agent.zealChannelHint(ME, L('Torvahk bows to you.'), T0 + 31_000)).toBeNull();
  });
  it('an item link matches on both sides: the pipe drops the control character, the log keeps it', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 1007, 'Gobn says, He gave you 0022194A Lucid Shard']]);
    expect(agent.zealChannelHint(ME, L('Gobn says, He gave you \x120022194A Lucid Shard\x12'), T0)).toMatchObject({ k: 1007 });
  });
  it('an unknown colour or a malformed row is ignored, an oversize batch is cut, memory stays bounded', () => {
    agent.setChatPolicy({ other: true }, T0);
    expect(hear([[ME, 4000, 'x'], [ME, 'q', 'x'], ['', 263, 'x'], [ME, 263, ''], [ME, 263, 5]])).toBe(0);
    const many = Array.from({ length: 1500 }, (_, i) => [ME, 263, 'line ' + i]);
    for (let i = 0; i < many.length; i += 400) hear(many.slice(i, i + 400));
    let held = 0;
    for (let i = 0; i < 1500; i++) if (agent.zealChannelHint(ME, L('line ' + i), T0)) held++;
    expect(held).toBeLessThanOrEqual(800);
    expect(held).toBeGreaterThan(0);
  });
  it('an excluded character feeds nothing (the same rule as the log tap)', () => {
    // exclude_from_stats keeps the character's log out of the overlay already; its hints are refused as well.
    const src = stripJs(AGENT_SRC);
    const take = sliceBlock(src, 'function zealChatTake(payload, now) {', '\n}\n');
    expect(take).toContain('shouldUploadForCharacter(r.c)');
    expect(take.indexOf('shouldUploadForCharacter')).toBeLessThan(take.indexOf('_zealChatHints.set'));
  });
});

// ── 4. Routing: the same real log lines, with and without Zeal's channel ──────────────────
describe('a line nothing else claims goes to the channel Zeal says', () => {
  // [log line (real, golden), Zeal colour for that kind of line, channel it must reach]
  const ROUTED = [
    ['Fenrisk has been slain by Lord of Ire!',               278, 'death'],
    ['You died.',                                            277, 'death'],
    ['Syko dies.',                                           278, 'death'],
    ['Players on EverQuest:',                                281, 'who'],
    ['[60 Minstrel] Sylvarra (Half Elf) <Wolf Pack>',        281, 'who'],
    ['There are 8 players in the plane of fear.',            281, 'who'],
    ['Loading bandolier set [emp]',                          1011, 'zeal'],
    ['Bandolier set [1] is already equipped',                1011, 'zeal'],
    ['You are too busy to equip bandolier set!',             1012, 'zeal'],
    ['Gobn says, \'My leader is Orvo.\'',                    1002, 'pet'],
    ['Gobn tells you, \'Attacking Lord Nagafen Master.\'',   1003, 'pet'],
    ['You receive 5 platinum as your split. (synthetic)',    285, 'money'],
    ['Torvahk bows to you. (synthetic)',                     263, 'emote'],
    ['Fluffy has a lot to say. (synthetic)',                 1007, 'zeal'],
  ];
  for (const [text, colour, want] of ROUTED) {
    it(`${want}: "${text}" (colour ${colour})`, () => {
      agent.setChatPolicy({ other: true }, T0);
      hear([[ME, colour, text]]);
      expect(agent.noteLocalChatLine(L(text), ME, T0)).toBe(true);
      expect(ring().map(r => [r.ch, r.text])).toEqual([[want, text]]);
    });
  }
  it('a pet\'s one-word "tells you" is a Pet line only with Zeal; the log alone drops it (it reads as a merchant\'s or pet\'s chatter)', () => {
    const t = 'Gobn tells you, \'Attacking Lord Nagafen Master.\'';
    agent.setChatPolicy({ other: true, tells: true }, T0);
    expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(false);
    expect(ring()).toHaveLength(0);
  });
  it('the line shown is the LOG\'s own sentence, whole and nameless, with the timestamp the log gave it', () => {
    agent.setChatPolicy({ other: true }, T0);
    const t = 'Torvahk bows to you.';
    hear([[ME, 263, 'Torvahk bows to you.']]);
    agent.noteLocalChatLine(L(t), ME, T0);
    expect(ring()[0]).toMatchObject({ ch: 'emote', who: '', text: t, t: new Date(2026, 7, 2, 20, 41, 20).getTime(), on: ME });
  });
  it('a first-person line is marked self, so the overlay can tell yours', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 277, 'You died.']]);
    agent.noteLocalChatLine(L('You died.'), ME, T0);
    expect(ring()[0]).toMatchObject({ ch: 'death', self: true });
  });
  it('NPC rampage, enrage and critical lines reach Melee (not Other) when Melee is on, and vanish when it is off', () => {
    const LINES = [['Lord of Ire goes on a RAMPAGE against Fenrisk!', 304], ['Torvahk has become ENRAGED.', 306], ['Torvahk scores a critical hit!(412)', 1008]];
    agent.setChatPolicy({ other: true }, T0);
    hear(LINES.map(([t, k]) => [ME, k, t]));
    for (const [t] of LINES) expect(agent.noteLocalChatLine(L(t), ME, T0), t).toBe(false);          // Melee is off: not Other either
    expect(ring()).toHaveLength(0);
    agent.setChatPolicy({ other: true, melee: true }, T0 + 1);
    for (const [t] of LINES) expect(agent.noteLocalChatLine(L(t), ME, T0 + 1), t).toBe(true);
    expect(agent._meleeRingForTest().map(r => [r.text, r.cat])).toEqual([[LINES[0][0], 'others'], [LINES[1][0], 'others'], [LINES[2][0], 'others']]);
    expect(ring()).toHaveLength(0);
  });
  it('a miss without "but" ("X misses Y.") is Melee\'s with its miss mark, from the colour; the log alone leaves it in Other', () => {
    const t = 'Lord Nagafen misses Torvahk.';
    agent.setChatPolicy({ other: true, melee: true }, T0);
    expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(true);
    expect(chans()).toEqual(['other']);                                              // no Zeal: the old answer
    agent._resetLocalChatForTest();
    agent.setChatPolicy({ other: true, melee: true }, T0);
    hear([[ME, 280, t]]);
    expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(true);
    expect(chans()).toEqual([]);
    expect(agent._meleeRingForTest()[0]).toMatchObject({ text: t, cat: 'others', miss: true });
  });
  it('a spell the log parsers left (the catalog is not loaded here) reaches Spells from its colour, and a fizzle is "mine"', () => {
    const t = 'Your Tuyen`s Chant of Flame spell fizzles.';
    agent.setChatPolicy({ other: true, spells: true }, T0);
    hear([[ME, 289, t]]);
    expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(true);
    expect(agent._spellRingForTest()[0]).toMatchObject({ text: t, cat: 'mine' });
    expect(ring()).toHaveLength(0);
  });
});

describe('without Zeal the log text still splits what it can, and says exactly what it cannot', () => {
  const FROM_TEXT = [
    ['Fenrisk has been slain by Lord of Ire!', 'death'],
    ['You have been slain by Lord Nagafen!', 'death'],
    ['Players on EverQuest:', 'who'],
    ['---------------------------', 'who'],
    ['[60 Minstrel] Sylvarra (Half Elf) <Wolf Pack>', 'who'],
    ['AFK [60 Storm Warden] Brambleth (Wood Elf) <Wolf Pack>', 'who'],
    ['[60 Storm Warden] Brambleth (Wood Elf) <Wolf Pack> ZONE: fearplane', 'who'],
    ['[ANONYMOUS] Orvo <Wolf Pack>', 'who'],
    ['[GM] Sysop', 'who'],
    ['There are 8 players in the plane of fear.', 'who'],
    ['Loading bandolier set [emp]', 'zeal'],
    ['Bandolier set [1] is already equipped', 'zeal'],
    ['PVP Druzzil Ro BROADCASTS, \'Corvale of Wolf Pack has killed Zarrin of Others in Plane of Hate.\'', 'bcast'],
    ['You receive 5 platinum as your split.', 'money'],
  ];
  for (const [t, want] of FROM_TEXT) {
    it(`${want}: "${t}"`, () => {
      agent.setChatPolicy({ other: true }, T0);
      expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(true);
      expect(chans()).toEqual([want]);
    });
  }
  it('lines that only Zeal can place stay in Other (or nowhere) without it: emotes, pet replies, item speech', () => {
    agent.setChatPolicy({ other: true }, T0);
    for (const t of ['Torvahk bows to you.', 'Gobn says, \'My leader is Orvo.\'', 'Sylvarra is an Officer of Wolf Pack.']) agent.noteLocalChatLine(L(t), ME, T0);
    expect(ring().map(r => r.text)).toEqual(['Torvahk bows to you.', 'Sylvarra is an Officer of Wolf Pack.']);   // the pet reply is speech: dropped, as before
    expect(chans()).toEqual(['other', 'other']);
  });
  it('a quoted line is never taken by a split, whatever it says', () => {
    agent.setChatPolicy({ other: true }, T0);
    for (const t of ['Corvale says, \'Fenrisk has been slain by Lord of Ire!\'', 'Corvale tells the guild, \'There are 8 players in the plane of fear.\'',
      'Corvale says, \'Loading bandolier set [emp]\'']) agent.noteLocalChatLine(L(t), ME, T0);
    expect(ring()).toHaveLength(0);                                                  // none became a split
    expect(agent._chatRingForTest().map(r => r.ch)).toEqual(['say', 'guild', 'say']);   // each is just the chat it was
  });
});

// ── 5. Before / after, on the real golden logs ────────────────────────────────────────────
describe('how much leaves Other: both golden logs, replayed', () => {
  const LOGS = [...golden('raid-pull.log'), ...golden('line-families.log')];
  // Colours Zeal's source assigns to these kinds of line (not captured traffic; see the header).
  const COLOURS = new Map([
    ['Lord of Ire goes on a RAMPAGE against Fenrisk!', 304], ['Torvahk has become ENRAGED.', 306], ['Torvahk scores a critical hit!(412)', 1008],
    ['Fenrisk has been slain by Lord of Ire!', 278], ['Lord of Ire has been slain by a fear touched drolvarg!', 278],
    ['You died.', 277], ['Syko dies.', 278], ['a fear touched drolvarg died.', 278], ['a greater gnoll pup has died.', 278],
    ['Item with ID [21809] not found in inventory for bandolier set [caen], canceling set load.', 1012],
    ['No empty inventory slot to unequip Nature Walker\'s Scimitar, canceling set load.', 1012], ['You are too busy to equip bandolier set!', 1012],
    ['Loading bandolier set [emp]', 1011], ['Bandolier set [1] is already equipped', 1011],
    ['Nyxaria begins casting Dire Charm.', 288], ['Lord Nagafen misses Torvahk.', 280], ['Your Tuyen`s Chant of Flame spell fizzles.', 289],
    ['Gobn says, \'My leader is Orvo.\'', 1002],
  ]);
  const replay = (withZeal, policy) => {
    agent._resetLocalChatForTest();
    agent.setChatPolicy(policy, T0);
    const WHO = /^(?:Players on EverQuest:|-{10,}|(?:AFK )?\[\d+ |\[ANONYMOUS\]|\[GM\]|There are \d+ players)/;
    if (withZeal) hear(LOGS.filter(l => COLOURS.has(body(l)) || WHO.test(body(l))).map(l => [ME, COLOURS.get(body(l)) || 281, body(l)]));
    for (const l of LOGS) agent.noteLocalChatLine(l, ME, T0);
    agent.zealChatFlushDeferred(T0 + 1000);                                          // the lines that waited for a hint that never came
    return { other: ring().filter(r => r.ch === 'other').map(r => r.text), all: ring().map(r => r.ch) };
  };
  // What Other held before this change: everything classifyOtherLine takes (it is unchanged, so this is the old bucket).
  const before = LOGS.filter(l => agent.classifyOtherLine(l, ME, {}) && !agent.classifyChatLine(l, ME)).length;

  it('before: a good part of two ordinary logs is Other', () => {
    expect(before).toBeGreaterThanOrEqual(25);
  });
  it('without Zeal, the log text alone moves the lines it can read', () => {
    const r = replay(false, { other: true });
    expect(r.other.length).toBeLessThan(before);
    expect(r.all.filter(c => c !== 'other')).toEqual(expect.arrayContaining(['death', 'who', 'zeal']));
  });
  it('with Zeal\'s channel, far fewer are Other, and what remains has no channel', () => {
    const none = replay(false, { other: true });
    const zeal = replay(true, { other: true });
    expect(zeal.other.length).toBeLessThan(none.other.length);
    expect(zeal.other.length).toBeLessThanOrEqual(Math.floor(before / 2));
    expect(zeal.other).toEqual([
      'Lord of Ire was pierced by thorns.',
      'You throw your head back and moan a desperate dirge.',
      'Sylvarra is an Officer of Wolf Pack.',
      'a glyphed familiar regards Nyxaria as an ally.',
      'a glyphed familiar snaps out of the charm.',
      'a fear touched drolvarg is no longer charmed.',
      'You have slain a fear touched drolvarg!',
      'You are bleeding to death!',
      'Returning to home point, please wait...',
      'Lord Nagafen was burned by brambles.',
      'You throw your head back and let loose a piercing blast.',
      'You are snared.',
      'Nyxaria begins casting Dire Charm.',
    ].filter(t => !COLOURS.has(t)));
  });
  it('the numbers, so a regression is a diff and not a feeling', () => {
    const none = replay(false, { other: true }), zeal = replay(true, { other: true });
    const count = (r, c) => r.all.filter(x => x === c).length;
    expect({ before, withoutZealOther: none.other.length, withZealOther: zeal.other.length,
      withZealWho: count(zeal, 'who'), withZealDeath: count(zeal, 'death'), withZealZeal: count(zeal, 'zeal'), withZealPet: count(zeal, 'pet') })
      .toEqual({ before: 33, withoutZealOther: 25, withZealOther: 12, withZealWho: 14, withZealDeath: 6, withZealZeal: 5, withZealPet: 1 });
  });
});

// ── 6. The race: the pipe speaks first, but the log tail can beat the POST ────────────────
describe('a line that beats its hint waits a moment, once', () => {
  const T = 'Torvahk bows to you.';
  beforeEach(() => agent.setChatPolicy({ other: true }, T0));
  it('with the pipe talking, an unclaimed line waits; when the hint lands it goes where Zeal said', () => {
    hear([[ME, 0, 'Tick']], T0);                                                   // the heartbeat: this character's pipe is live
    expect(agent.noteLocalChatLine(L(T), ME, T0)).toBe(false);                      // waiting
    expect(ring()).toHaveLength(0);
    hear([[ME, 263, T]], T0 + 50);                                                 // the hint arrives
    expect(agent.zealChatFlushDeferred(T0 + 100)).toBe(0);                          // not due yet
    expect(agent.zealChatFlushDeferred(T0 + 400)).toBe(1);
    expect(chans()).toEqual(['emote']);
  });
  it('a hint that never comes: the log text decides after the wait, and the line is not lost', () => {
    hear([[ME, 0, 'Tick']], T0);
    expect(agent.noteLocalChatLine(L(T), ME, T0)).toBe(false);
    expect(agent.zealChatFlushDeferred(T0 + 400)).toBe(1);
    expect(chans()).toEqual(['other']);
  });
  it('it waits only once: the second look does not wait again', () => {
    hear([[ME, 0, 'Tick']], T0);
    agent.noteLocalChatLine(L(T), ME, T0);
    agent.zealChatFlushDeferred(T0 + 400);
    expect(ring()).toHaveLength(1);
  });
  it('no Zeal for this character (no tick heard): no wait at all', () => {
    expect(agent.noteLocalChatLine(L(T), ME, T0)).toBe(true);
    expect(chans()).toEqual(['other']);
  });
  it('a stale tick (the pipe has been silent for over 15 s) is no Zeal either', () => {
    hear([[ME, 0, 'Tick']], T0);
    agent.setChatPolicy({ other: true }, T0 + 16_000);
    expect(agent.noteLocalChatLine(L(T), ME, T0 + 16_000)).toBe(true);
  });
  it('another character\'s pipe does not make this one wait', () => {
    hear([['Brackwyn', 0, 'Tick']], T0);
    expect(agent.noteLocalChatLine(L(T), ME, T0)).toBe(true);
  });
  it('nothing waits when no switch could use a hint (the overlay asked for chat only)', () => {
    agent.setChatPolicy({ group: true }, T0);
    hear([[ME, 0, 'Tick']], T0);
    expect(agent.noteLocalChatLine(L(T), ME, T0)).toBe(false);
    expect(agent.zealChatFlushDeferred(T0 + 400)).toBe(0);
  });
  it('combat lines never wait (their colours are not sent, so no hint could come)', () => {
    agent.setChatPolicy({ other: true, melee: true }, T0);
    hear([[ME, 0, 'Tick']], T0);
    expect(agent.noteLocalChatLine(L('You slash a goblin for 120 points of damage.'), ME, T0)).toBe(true);
    expect(agent.noteLocalChatLine(L('You try to kick a goblin, but miss!'), ME, T0)).toBe(true);
    expect(agent.zealChatFlushDeferred(T0 + 400)).toBe(0);
  });
  it('chat never waits: it is read from the log at once, hint or no hint', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 0, 'Tick']], T0);
    expect(agent.noteLocalChatLine(L('Corvale tells the guild, \'pull in five\''), ME, T0)).toBe(true);
  });
});

// ── 7. Privacy: what the pipe knows must not widen what the overlay shows ─────────────────
describe('Zeal\'s channel never widens what is shown', () => {
  it('a chat colour on a line the log parser could not read means "not Other": it is not shown at all', () => {
    const t = 'Corvale whispers something private to you.';                          // (synthetic) a shape classifyChatLine does not know
    agent.setChatPolicy({ other: true, tells: true, group: true, officer: true, custom: true }, T0);
    expect(agent.noteLocalChatLine(L(t), ME, T0)).toBe(true);                        // the old behaviour, no Zeal: it falls into Other
    agent._resetLocalChatForTest();
    agent.setChatPolicy({ other: true, tells: true, group: true, officer: true, custom: true }, T0);
    for (const k of [257, 258, 259, 290, 291, 327]) { hear([[ME, k, t]]); expect(agent.noteLocalChatLine(L(t), ME, T0), String(k)).toBe(false); }
    expect(ring()).toHaveLength(0);
    expect(agent._chatRingForTest()).toHaveLength(0);
  });
  it('a hint can name a channel but never open one that is switched off', () => {
    agent.setChatPolicy({ melee: false, spells: false, skills: false, loot: false, random: false, other: false }, T0);
    const CASES = [['Torvahk bows to you.', 263], ['Fenrisk has been slain by Lord of Ire!', 278], ['Lord Nagafen misses Torvahk.', 280],
      ['Your Tuyen`s Chant of Flame spell fizzles.', 289], ['You throw your head back and moan a desperate dirge.', 270], ['--You have looted a Cloak of Flames.--', 286],
      ['**A Magic Die is rolled by Corvale.', 287]];
    hear(CASES.map(([t, k]) => [ME, k, t]));
    for (const [t] of CASES) expect(agent.noteLocalChatLine(L(t), ME, T0), t).toBe(false);
    expect(agent.serializeLocalChat({}, T0).lines).toEqual([]);
  });
  it('tells, group and officer chat keep their switches and their defaults', () => {
    const CHAT = ['Corvale tells you, \'got a minute?\'', 'Brackwyn tells the group, \'inc\'', 'Rethlan tells Wolfpackofficer:5, \'keep this quiet\''];
    agent.setChatPolicy({ other: true }, T0);
    hear(CHAT.map((t, i) => [ME, [257, 258, 291][i], t]));
    for (const t of CHAT) expect(agent.noteLocalChatLine(L(t), ME, T0), t).toBe(false);
    expect(agent.serializeLocalChat({ other: true }, T0).lines).toEqual([]);
    agent.setChatPolicy({ other: true, tells: true, group: true, officer: true }, T0 + 1);
    for (const t of CHAT) expect(agent.noteLocalChatLine(L(t), ME, T0 + 1), t).toBe(true);
    expect(agent._chatRingForTest().map(r => r.ch)).toEqual(['tell', 'group', 'officer']);
  });
  it('the splits ride Other\'s switch: with Other off none of them is captured or served, with it on all seven are served', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 263, 'a (synthetic)'], [ME, 285, 'b (synthetic)'], [ME, 281, 'c (synthetic)'], [ME, 277, 'd (synthetic)'],
      [ME, 282, 'e (synthetic)'], [ME, 1003, 'f (synthetic)'], [ME, 1007, 'g (synthetic)']]);
    for (const t of 'abcdefg') agent.noteLocalChatLine(L(t + ' (synthetic)'), ME, T0);
    expect(chans()).toEqual(['emote', 'money', 'who', 'death', 'bcast', 'pet', 'zeal']);
    expect(agent.serializeLocalChat({ other: true }, T0).lines.map(l => l.ch)).toEqual(['emote', 'money', 'who', 'death', 'bcast', 'pet', 'zeal']);   // one ring, each line once
    expect(agent.serializeLocalChat({}, T0).lines).toEqual([]);
    expect(agent.serializeLocalChat({ tells: true, group: true, officer: true, custom: true, melee: true }, T0).lines).toEqual([]);
  });
  it('nothing new is uploaded, queued or written: the block names no buffer, no request and no file, and the route is local', () => {
    const code = stripJs(AGENT_SRC);
    const block = sliceBlock(code, 'const ZEAL_CHAT_COLOR = (() => {', 'function _chatLearnSlot(evt, character) {');
    expect(block.length).toBeGreaterThan(3000);
    expect(block).not.toMatch(/chatBuffer|tellBuffer|enqueueUpload|fetch\(|writeFile|fs\.|http\.request|https\./);
    const route = sliceBlock(code, "if (req.url === '/api/zeal-chat' && req.method === 'POST') {", '\n      }\n');
    expect(route).toContain('zealChatTake(payload)');
    expect(route).not.toMatch(/enqueue|queue|writeFile|fetch\(/);
  });
});

// ── 8. A joined channel's slot is learned from a line that names it ───────────────────────
describe('Zeal\'s /abc shows only a slot number: a slot known to be the officer channel is Officer, not Custom', () => {
  const NAMED = 'Rethlan tells Wolfpackofficer:5, \'noted\'';
  const ABBREV = '[5] [Rethlan]: keep this quiet';
  const on = { group: true, officer: true, custom: true };
  it('before the slot is known, an abbreviated line is Custom (the safe side, as it always was)', () => {
    expect(agent.classifyChatLine(L(ABBREV), ME)).toMatchObject({ ch: 'custom', cnum: 5 });
    agent.setChatPolicy(on, T0);
    agent.noteLocalChatLine(L(ABBREV), ME, T0);
    expect(agent._chatRingForTest().map(r => r.ch)).toEqual(['custom']);
  });
  it('after a line that names slot 5, the abbreviated one is Officer and behind the Officer switch', () => {
    agent.setChatPolicy({ custom: true }, T0);
    agent.noteLocalChatLine(L(NAMED), ME, T0);                                      // officer is off: not shown, but the name is learned
    expect(agent._chatRingForTest()).toHaveLength(0);
    expect(agent.noteLocalChatLine(L(ABBREV), ME, T0)).toBe(false);                 // Custom is ON by default, and this must not leak through it
    agent.setChatPolicy(on, T0 + 1);
    expect(agent.noteLocalChatLine(L(ABBREV), ME, T0 + 1)).toBe(true);
    expect(agent._chatRingForTest()[0]).toMatchObject({ ch: 'officer', who: 'Rethlan', cnum: 5, cn: 'Wolfpackofficer' });
  });
  it('the slot is the character\'s own: another character\'s slot 5 is not the officer channel', () => {
    agent.setChatPolicy(on, T0);
    agent.noteLocalChatLine(L(NAMED), ME, T0);
    agent.noteLocalChatLine(L(ABBREV), 'Brackwyn', T0);
    expect(agent._chatRingForTest().map(r => r.ch)).toEqual(['officer', 'custom']);
  });
  it('a slot that names an ordinary channel stays Custom, and carries its name', () => {
    agent.setChatPolicy(on, T0);
    agent.noteLocalChatLine(L('Zarrin tells General:2, \'a\''), ME, T0);
    agent.noteLocalChatLine(L('[2] [Zarrin]: b'), ME, T0);
    expect(agent._chatRingForTest().map(r => [r.ch, r.cn])).toEqual([['custom', 'General'], ['custom', 'General']]);
  });
});

// ── 9. The plumbing the new chips need ────────────────────────────────────────────────────
describe('the overlay is served the new groups', () => {
  it('/api/zeal-chat is routed, size-capped and answers with how many hints it kept', () => {
    const code = stripJs(AGENT_SRC);
    const route = sliceBlock(code, "if (req.url === '/api/zeal-chat' && req.method === 'POST') {", '\n      }\n');
    expect(route).toContain('_readBody(req, 256 * 1024)');
    expect(route).toContain('kept: zealChatTake(payload)');
  });
  it('Other and its splits are served together under the one switch, each with a colour, a tag and a label', () => {
    const served = agent.serializeLocalChat({ other: true }, T0);
    const ids = served.groups.filter(g => g.gate === 'other').map(g => g.id);
    expect(ids).toEqual(['other', 'money', 'emotes', 'pets', 'who', 'deaths', 'bcast', 'zeal']);
    for (const g of served.groups.filter(x => x.gate === 'other')) for (const c of g.channels) expect(served.channels[c], c).toMatchObject({ label: expect.any(String), tag: expect.any(String), color: expect.stringMatching(/^#[0-9a-f]{6}$/i) });
  });
  it('the cache saves and restores a split line like any Other line', () => {
    agent.setChatPolicy({ other: true }, T0);
    hear([[ME, 263, 'Torvahk bows to you.']]);
    agent.noteLocalChatLine(L('Torvahk bows to you.'), ME, T0);
    const snap = agent.chatCacheSnapshot(Date.now(), { perRingMax: 300, maxAgeMs: 10 * 365 * 24 * 3600 * 1000 });
    expect(snap.rings.other.map(r => r.ch)).toEqual(['emote']);
    agent._resetLocalChatForTest();
    expect(agent.chatCacheRestore(JSON.parse(JSON.stringify(snap)), Date.now(), { perRingMax: 300, maxAgeMs: 10 * 365 * 24 * 3600 * 1000 })).toBe(1);
    expect(ring().map(r => r.ch)).toEqual(['emote']);
  });
});
