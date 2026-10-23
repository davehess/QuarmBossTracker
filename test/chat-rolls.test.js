// test/chat-rolls.test.js: /random rolls in Mimic's Chat overlay, and a broken-out window's history.
//
// The guild lead, 2026-10-23:
//   • "chat overlay is missing random rolls (and if we can link to what it was for even better)"
//   • "sometimes when popping out a window we don't get the full history from that session or timeframe"
//
// Rolls: the lines were reaching the overlay's classifier all along; the Random switch was OFF unless someone found it
// (under ⚙ → More settings), and the history read-back never included Random at all. A roll is also two log lines, so it
// read as two rows. Now it is ONE row, "<Name> rolled 692 (0–711)", with the item the raid called it for.
// History: a new breakout window had no history pick of its own (it is stored per window id) so it opened with history OFF,
// and the request carried every channel, so the 3000-line cap counted the busiest channel's lines, not the window's.
//
// Run: npx vitest run test/chat-rolls.test.js

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const agent = require_(AGENT_INDEX);
const AGENT_SRC = readSource(AGENT_INDEX);
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const CHAT_HTML = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chat.html'), 'utf8');
const SCRIPT = CHAT_HTML.slice(CHAT_HTML.indexOf('<script>'), CHAT_HTML.indexOf('</script>'));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `[${DAYS[d.getDay()]} ${MONS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
const NOW = new Date(2026, 9, 23, 22, 0, 0).getTime();
const MIN = 60_000;
const at = (minAgo, text) => `${stamp(NOW - minAgo * MIN)} ${text}`;
const ME = 'Aldenmar';

// The two lines of one roll, exactly as the game logs them.
const pair = (minAgo, who, lo, hi, n) => [
  at(minAgo, `**A Magic Die is rolled by ${who}.`),
  at(minAgo, `**It could have been any number from ${lo} to ${hi}, but this time it turned up a ${n}.`),
];
const feed = (lines, character = ME, now) => lines.map(l => agent.noteLocalChatLine(l, character, now));

beforeEach(() => { agent._resetLocalChatForTest(); agent._resetChatHistoryForTest(); agent._setRollItemsForTest([], []); });

// ── 1. Why rolls were missing: the path a real pair takes ────────────────────────────────────
describe('a real roll pair, end to end through the overlay\'s feed', () => {
  it('reaches the Random ring as ONE line, and is served to a window that asks for Random', () => {
    agent.setChatPolicy({ random: true }, NOW);
    const [die, res] = pair(0, 'Halvard', 0, 711, 692);
    expect(feed([die, res], ME, NOW)).toEqual([false, true]);     // the die line waits for its result line
    expect(agent._randomRingForTest().map(r => r.text)).toEqual(['Halvard rolled 692 (0–711)']);
    const page = agent.serializeLocalChat({ random: true }, NOW);
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0]).toMatchObject({ ch: 'random', who: '', text: 'Halvard rolled 692 (0–711)', roll: { name: 'Halvard', value: 692, from: 0, to: 711 } });
  });
  it('is held back from a window that did not ask for Random: the switch is the whole gate', () => {
    agent.setChatPolicy({ random: false }, NOW);
    expect(feed(pair(0, 'Halvard', 0, 711, 692), ME, NOW)).toEqual([false, false]);
    expect(agent._randomRingForTest()).toHaveLength(0);
  });
  it('a result line with no die line before it is still shown, as the game printed it', () => {
    agent.setChatPolicy({ random: true }, NOW);
    const [, res] = pair(0, 'Halvard', 0, 711, 692);
    expect(agent.noteLocalChatLine(res, ME, NOW)).toBe(true);
    expect(agent._randomRingForTest()[0].text).toBe('**It could have been any number from 0 to 711, but this time it turned up a 692.');
  });
  it('a die line from a different second is not paired with a later result line', () => {
    agent.setChatPolicy({ random: true }, NOW);
    agent.noteLocalChatLine(pair(1, 'Halvard', 0, 100, 5)[0], ME, NOW);
    agent.noteLocalChatLine(pair(0, 'Brackwyn', 0, 100, 50)[1], ME, NOW);
    expect(agent._randomRingForTest().map(r => r.text)).toEqual(['**It could have been any number from 0 to 100, but this time it turned up a 50.']);
  });
  it('the same roll heard by two of your characters is one row', () => {
    agent.setChatPolicy({ random: true }, NOW);
    const [die, res] = pair(0, 'Halvard', 0, 711, 692);
    feed([die, res], 'Aldenmar', NOW); feed([die, res], 'Corvale', NOW);
    expect(agent._randomRingForTest()).toHaveLength(1);
  });
  it('two rolls in a row are two rows, each with its own name and number', () => {
    agent.setChatPolicy({ random: true }, NOW);
    feed([...pair(0, 'Halvard', 0, 711, 692), ...pair(0, 'Brackwyn', 0, 711, 100)], ME, NOW);
    expect(agent._randomRingForTest().map(r => r.text)).toEqual(['Halvard rolled 692 (0–711)', 'Brackwyn rolled 100 (0–711)']);
  });
  it('the roll keeps its shape through the Chat cache', () => {
    agent.setChatPolicy({ random: true }, NOW);
    agent._setRollItemsForTest([[711, { item: 'Ethereal Parchment', qty: null, atMs: NOW }]], [[28034, 'Ethereal Parchment', 'pop']]);
    feed(pair(0, 'Halvard', 0, 711, 692), ME, NOW);
    const snap = agent.chatCacheSnapshot(NOW, { maxAgeMs: 3_600_000, perRingMax: 300 });
    agent._resetLocalChatForTest();
    agent.chatCacheRestore(JSON.parse(JSON.stringify(snap)), NOW, { maxAgeMs: 3_600_000, perRingMax: 300 });
    expect(agent._randomRingForTest()[0].roll).toMatchObject({ name: 'Halvard', value: 692, item: 'Ethereal Parchment', id: 28034 });
  });
});

// ── 2. What the roll was for ──────────────────────────────────────────────────────────────────
describe('the item a roll was for', () => {
  const CATALOG = [[28034, 'Ethereal Parchment', 'pop'], [1001, 'Cloak of Flames', 'classic']];
  it('comes from the raid\'s loot call (the roll tracker\'s own range -> item map) and links by catalog id', () => {
    agent.setChatPolicy({ random: true }, NOW);
    agent._setRollItemsForTest([], CATALOG);
    // the loot call, as the tracker reads it: "<Item> <range>" in raid chat, through the tracker's own entry point
    agent.trackRollItemLine(at(0, 'Brackwyn tells the raid, \'Ethereal Parchment 711 | Cloak of Flames 333\''));
    feed(pair(0, 'Halvard', 0, 711, 692), ME, NOW);
    expect(agent.serializeLocalChat({ random: true }, NOW).lines[0].roll).toMatchObject({ item: 'Ethereal Parchment', id: 28034 });
  });
  it('the call parser puts a range on an item, so this is the same mapping the Rolls card uses', () => {
    expect(agent.parseRollItemLine('Ethereal Parchment 711')).toEqual([expect.objectContaining({ num: 711, item: 'Ethereal Parchment' })]);
  });
  it('has the item name but no link when the catalog does not know the name exactly', () => {
    agent._setRollItemsForTest([[711, { item: 'Ethereal Parchments', qty: null, atMs: NOW }]], CATALOG);
    const e = agent.classifyRollPair(...pair(0, 'Halvard', 0, 711, 692), null);
    expect(e.roll.item).toBe('Ethereal Parchments');
    expect(e.roll.id).toBeUndefined();
  });
  it('is not borrowed from a call made long before or after (the tracker\'s 20-minute rule)', () => {
    agent._setRollItemsForTest([[711, { item: 'Ethereal Parchment', qty: null, atMs: NOW - agent.ROLL_ITEM_LINK_MS - 60_000 }]], CATALOG);
    expect(agent.classifyRollPair(...pair(0, 'Halvard', 0, 711, 692), null).roll.item).toBeUndefined();
  });
  it('a roll with no call before it has no item, and says only who rolled what', () => {
    const e = agent.classifyRollPair(...pair(0, 'Halvard', 0, 711, 692), null);
    expect(e.text).toBe('Halvard rolled 692 (0–711)');
    expect(e.roll.item).toBeUndefined();
  });
});

describe('the highest roll so far', () => {
  it('marks a first roll that beats every earlier one of the range; not the first roll, a tie, a lower roll or a re-roll', () => {
    const st = new Map();
    const mark = (who, n, ms) => agent.chatRollMark(st, who, 0, 100, n, ms);
    expect([mark('Halvard', 40, 0), mark('Brackwyn', 70, 1000), mark('Corvale', 70, 2000), mark('Zarrin', 20, 3000), mark('Brackwyn', 99, 4000), mark('Rethlan', 71, 5000)])
      .toEqual([false, true, false, false, false, true]);
  });
  it('starts over after the set goes quiet, and keeps ranges apart', () => {
    const st = new Map();
    agent.chatRollMark(st, 'Halvard', 0, 100, 90, 0);
    expect(agent.chatRollMark(st, 'Brackwyn', 0, 100, 95, 1000)).toBe(true);
    expect(agent.chatRollMark(st, 'Corvale', 0, 333, 5, 2000)).toBe(false);
    expect(agent.chatRollMark(st, 'Zarrin', 0, 100, 10, 2000)).toBe(false);
    const later = 11 * 60_000;
    agent.chatRollMark(st, 'Halvard', 0, 100, 10, later);
    expect(agent.chatRollMark(st, 'Brackwyn', 0, 100, 20, later + 1000)).toBe(true);
  });
  it('is on the served line, and the second log\'s copy does not mark it twice', () => {
    agent.setChatPolicy({ random: true }, NOW);
    feed([...pair(0, 'Halvard', 0, 711, 400), ...pair(0, 'Brackwyn', 0, 711, 692)], 'Aldenmar', NOW);
    feed([...pair(0, 'Halvard', 0, 711, 400), ...pair(0, 'Brackwyn', 0, 711, 692)], 'Corvale', NOW);
    const lines = agent.serializeLocalChat({ random: true }, NOW).lines;
    expect(lines.map(l => !!(l.roll && l.roll.top))).toEqual([false, true]);
  });
});

// ── 3. The default, for new installs and for people who never touched it ───────────────────────
describe('Random is on unless someone switched it off', () => {
  function prefs(chatPrefs) {
    globalThis.__H = {};
    evalBlock(`
      const ipcMain = { handle: (n, f) => { globalThis.__H[n] = f; } };
      let CFG = ${JSON.stringify({ chatPrefs })};
      function _pushChatWindows() {}
      function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
      function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); }
      ${sliceBlock(MAIN, 'function _chatCharKey(char) {', "  return _chatPrefsPayload(cfg, char);\n});")}
    `, []);
    return { get: () => globalThis.__H['chat-prefs-get']({}, ME), set: (p) => globalThis.__H['chat-prefs-set']({}, ME, p) };
  }
  it('a new install (nothing saved) gets Random', async () => { expect((await prefs({}).get()).random).toBe(true); });
  it('an existing install that never touched the switch gets it too: other saved prefs do not hide it', async () => {
    expect((await prefs({ fontSize: 15, group: false, officer: true }).get()).random).toBe(true);
  });
  it('a switch someone turned off stays off, and one turned on stays on', async () => {
    expect((await prefs({ random: false }).get()).random).toBe(false);
    expect((await prefs({ random: true }).get()).random).toBe(true);
  });
  it('switching it off writes false (so it can be told from "never touched"), and nothing else writes it', async () => {
    const p = prefs({});
    expect((await p.set({ random: false })).random).toBe(false);
    expect((await p.set({ fontSize: 14, loot: true })).random).toBe(false);   // a later save of another switch does not bring it back
  });
  it('the overlay\'s own default, before the first prefs arrive, is on too', () => {
    expect(stripJs(SCRIPT)).toMatch(/loot: false, random: true, other: false, away: true/);
  });
});

// ── 4. The overlay row ──────────────────────────────────────────────────────────────────────────
describe('chat.html: a roll row', () => {
  function row(line) {
    const api = evalBlock(`
      var _channels = ${JSON.stringify(agent.CHAT_CHANNELS)}, _copiedN = 0, _chanNames = {}, _prefs = { offChannels: [], only: '' }, _isBrk = false;
      function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
      ${sliceBlock(SCRIPT, 'function learnChannel(l){', "esc(t) + ']</span>' : '';\n  }")}
      ${sliceBlock(SCRIPT, 'function hhmm(t){', '}\n')}
      ${sliceBlock(SCRIPT, 'function lineHtml(l, tag){', "+ viaMark + '</div>';\n  }")}
      ${sliceBlock(SCRIPT, 'function copyLineText(l){', '+ l.text;\n  }')}
    `, ['lineHtml', 'copyLineText']);
    return { html: api.lineHtml(line), copy: api.copyLineText(line) };
  }
  const base = { n: 1, t: NOW, ch: 'random', who: '', text: 'Halvard rolled 692 (0–711)' };
  it('is one row with no speaker column: the sentence names the roller', () => {
    const { html } = row({ ...base, roll: { name: 'Halvard', value: 692, from: 0, to: 711 } });
    expect(html).toContain('<span class="tx">Halvard rolled 692 (0–711)</span>');
    expect(html).not.toContain('class="who');
  });
  it('links the item to its PQDI page when the agent matched an id, and the link is a plain anchor the click handler opens', () => {
    const { html } = row({ ...base, roll: { name: 'Halvard', value: 692, from: 0, to: 711, item: 'Ethereal Parchment', id: 28034 } });
    expect(html).toContain('Halvard rolled 692 (0–711) for <a class="itm" href="#" data-url="https://www.pqdi.cc/item/28034"');
    expect(html).toContain('>Ethereal Parchment</a>');
    const code = stripJs(SCRIPT);
    expect(code).toContain("closest('a.itm')");
    expect(code).toContain('window.mimic.openExternal(url)');
    expect(code).toContain('/^https:\\/\\/www\\.pqdi\\.cc\\/item\\/[0-9]{1,8}$/');   // only a PQDI item page is ever opened
  });
  it('shows the item name without a link when there is no id, and escapes it', () => {
    const { html } = row({ ...base, roll: { name: 'Halvard', value: 692, from: 0, to: 711, item: 'Wand <b>of</b> Allure' } });
    expect(html).toContain(' for Wand &lt;b&gt;of&lt;/b&gt; Allure</span>');
    expect(html).not.toContain('<a class="itm"');
  });
  it('marks the highest roll, and a line copied from the overlay carries the item and the mark', () => {
    const r = row({ ...base, roll: { name: 'Halvard', value: 692, from: 0, to: 711, item: 'Ethereal Parchment', id: 28034, top: true } });
    expect(r.html).toContain('<span class="rtop"');
    expect(r.copy).toMatch(/Halvard rolled 692 \(0–711\) for Ethereal Parchment ▲ high$/);
  });
  it('a line with no roll data (an old one, or an unpaired result line) renders exactly as before', () => {
    const { html } = row({ ...base, text: '**It could have been any number from 0 to 711, but this time it turned up a 692.' });
    expect(html).toContain('<span class="tx">**It could have been any number from 0 to 711, but this time it turned up a 692.</span>');
  });
  it('the Random switch\'s own description says one line, the item link, and that it is on unless switched off', () => {
    expect(CHAT_HTML).toMatch(/\['random',\s+'Random',\s+'(?:[^'\\]|\\')*one line each(?:[^'\\]|\\')*link to the item(?:[^'\\]|\\')*On unless you switch it off\.', 1\]/);
  });
});

// ── 5. History: Random is read back, and a breakout asks only for its own groups ──────────────────
let DIR;
beforeAll(() => { DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-rolls-')); });
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
function mk(name, lines) {
  const f = path.join(DIR, `eqlog_${name}_pq.proj.txt`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const when = new Date(NOW);   // written "now" on the fixture's clock, so the file counts as written inside the window
  fs.utimesSync(f, when, when);
  return f;
}
const HIST = (files, q) => agent.buildChatHistory({ hours: 6, ...q }, NOW, { files });
// 3,200 OOC lines in the last hour: more than the 3,000 the history keeps, so a request for every channel trims the oldest lines
const busyOoc = () => Array.from({ length: 3200 }, (_, i) => at(55 - i * (50 / 3200), `Zarrin says out of character, 'ooc ${i}'`));

describe('history reads Random back, as the same one line', () => {
  it('joins the pair (the result line is read first, going backwards), skips it with Random off, and marks the highest', async () => {
    const f = mk('Aldenmar_rolls', [
      at(90, 'Zarrin says, \'before\''),
      ...pair(60, 'Halvard', 0, 711, 400), ...pair(59, 'Brackwyn', 0, 711, 692), ...pair(58, 'Corvale', 0, 711, 10),
      at(30, 'Zarrin says, \'after\''),
    ]);
    const on = await HIST([{ character: ME, file: f }], { random: true });
    expect(on.lines.map(l => l.text)).toEqual(['before', 'Halvard rolled 400 (0–711)', 'Brackwyn rolled 692 (0–711)', 'Corvale rolled 10 (0–711)', 'after']);
    expect(on.lines.filter(l => l.roll && l.roll.top).map(l => l.roll.name)).toEqual(['Brackwyn']);
    const off = await HIST([{ character: ME, file: f }], { random: false });
    expect(off.lines.map(l => l.text)).toEqual(['before', 'after']);
  });
  it('a roll heard by two logs is one line', async () => {
    const lines = [...pair(10, 'Halvard', 0, 100, 50)];
    const a = mk('Aldenmar_dup', lines), b = mk('Corvale_dup', lines);
    const r = await HIST([{ character: 'Aldenmar', file: a }, { character: 'Corvale', file: b }], { random: true });
    expect(r.lines.filter(l => l.ch === 'random')).toHaveLength(1);
  });
});

describe('a broken-out window\'s history request', () => {
  it('chatGroupsChannels turns group ids into channels, ignores junk, and means "all" when it names nothing', () => {
    expect([...agent.chatGroupsChannels('guild')]).toEqual(['guild']);
    expect([...agent.chatGroupsChannels('ooc,guild')].sort()).toEqual(['guild', 'ooc', 'shout']);
    expect(agent.chatGroupsChannels('')).toBeNull();
    expect(agent.chatGroupsChannels('../x,NOPE')).toBeNull();
    expect(agent.chatGroupsChannels(undefined)).toBeNull();
  });
  it('a quiet group is not trimmed away by a busy one: the cap counts the window\'s own lines', async () => {
    const quiet = Array.from({ length: 5 }, (_, i) => at(300 - i * 10, `Brackwyn tells the guild, 'guild ${i}'`));
    const f = mk('Aldenmar_busy', [...quiet, ...busyOoc()]);
    const all = await HIST([{ character: ME, file: f }], { hours: 6 });
    expect(all.lines.filter(l => l.ch === 'guild')).toHaveLength(0);          // the reported symptom: the window starts without them
    expect(all.truncated).toBe(true);
    const own = await HIST([{ character: ME, file: f }], { hours: 6, groups: 'guild' });
    expect(own.lines.map(l => l.text)).toEqual(['guild 0', 'guild 1', 'guild 2', 'guild 3', 'guild 4']);
    expect(own.truncated).toBe(false);
  });
  it('the groups are part of the short cache\'s key: two windows asking for different groups do not share a body', () => {
    expect(stripJs(AGENT_SRC)).toContain("[[...(chatGroupsChannels(q && q.groups) || [])].sort().join(',')]");
  });
  it('the HTTP route passes groups through as text, never as a switch', () => {
    const handler = sliceBlock(stripJs(AGENT_SRC), 'async function _handleLocalChatHistory(req, res) {', '\n}\n');
    expect(handler).toContain("for (const k of CHAT_POLICY_KEYS) q[k] = q[k] === '1';");
    expect(handler).not.toMatch(/q\.groups\s*=/);
  });
});

describe('chat.html: the window\'s history pick and request', () => {
  function page(opts = {}) {
    return evalBlock(`
      var _isBrk = ${!!opts.brk}, _wid = ${JSON.stringify(opts.brk ? 'b2' : '')}, _only = ${JSON.stringify(opts.only || [])};
      var _prefs = ${JSON.stringify({ tells: false, group: true, officer: false, custom: true, random: true, ...(opts.prefs || {}) })};
      var _histHours = 0;
      var __store = ${JSON.stringify(opts.store || {})};
      var localStorage = { getItem: function(k){ return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; }, setItem: function(k, v){ __store[k] = String(v); } };
      function brkGroupId(){ return _only[0] || ''; }
      function winId(){ return _isBrk ? (_wid || brkGroupId()) : 'main'; }
      ${sliceBlock(SCRIPT, 'var HIST_CHOICES = [', '    } catch (e) {}\n  }')}
      ${sliceBlock(SCRIPT, 'function histQuery(){', "(_isBrk && _only.length ? '&groups=' + encodeURIComponent(_only.join(',')) : '');\n  }")}
    `, ['_histHours', 'histQuery']);
  }
  it('a new breakout window starts with the Chat window\'s history pick, not with history off', () => {
    expect(page({ brk: true, only: ['guild'], store: { 'wpChatHistH:main': '6' } })._histHours).toBe(6);
  });
  it('a window that made its own pick keeps it, even "History off"', () => {
    expect(page({ brk: true, only: ['guild'], store: { 'wpChatHistH:main': '6', 'wpChatHistH:b2': '2' } })._histHours).toBe(2);
    expect(page({ brk: true, only: ['guild'], store: { 'wpChatHistH:main': '6', 'wpChatHistH:b2': '0' } })._histHours).toBe(0);
  });
  it('the Chat window itself does not borrow anything, and an unset main pick leaves history off', () => {
    expect(page({ store: { 'wpChatHistH:b1': '12' } })._histHours).toBe(0);
    expect(page({ brk: true, only: ['guild'], store: {} })._histHours).toBe(0);
  });
  it('the request names the groups a breakout holds and carries the Random switch; the Chat window asks for everything', () => {
    const b = page({ brk: true, only: ['guild', 'raid'], store: { 'wpChatHistH:main': '3' } });
    expect(b.histQuery()).toBe('hours=3&tells=0&group=1&officer=0&custom=1&random=1&away=0&groups=guild%2Craid');
    const m = page({ store: { 'wpChatHistH:main': '3' } });
    expect(m.histQuery()).toBe('hours=3&tells=0&group=1&officer=0&custom=1&random=1&away=0');   // no groups: it holds whatever is not broken out
  });
  it('a group moved into a window re-reads its history (the request changed), but only when history is on and the agent has answered', () => {
    const takeOut = sliceBlock(stripJs(SCRIPT), 'function takeOut(list){', '\n  }');
    expect(takeOut).toContain('if (_histHours && _connectedOnce && histQuery() !== _histSig) loadHistory();');
  });
  it('end to end: the request a broken-out Guild window sends, read by the agent, returns every guild line of the timeframe', async () => {
    const f = mk('Aldenmar_e2e', [at(240, 'Brackwyn tells the guild, \'early\''), at(120, 'Brackwyn tells the guild, \'middle\''), ...busyOoc(), at(1, 'Brackwyn tells the guild, \'late\'')]);
    const b = page({ brk: true, only: ['guild'], store: { 'wpChatHistH:main': '6' } });
    const q = {};
    new URLSearchParams(b.histQuery()).forEach((v, k) => { q[k] = v; });
    for (const k of ['tells', 'group', 'officer', 'custom', 'random']) q[k] = q[k] === '1';
    const r = await agent.buildChatHistory(q, NOW, { files: [{ character: ME, file: f }] });
    expect(r.lines.filter(l => l.ch === 'guild').map(l => l.text)).toEqual(['early', 'middle', 'late']);
  });
});
