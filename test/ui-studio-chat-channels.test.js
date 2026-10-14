// test/ui-studio-chat-channels.test.js — UI Studio's "Chat windows & routing" panel.
//
// The guild lead, 2026-10-14, with screenshots: "These Channels need to say what's
// actually in these chats, not just Ch 26 or Ch 46" and "the labels are wrong".
// They were: the old table named ChannelMap id 4 "Auction" and id 6 "Guild" (the
// opposite of the player's own windows), and stopped at 24, so 25..56 read "Ch N".
// ChannelMap<N> is the position in the client's chat-filter menu (eqlib's
// eChatChannel for 0..40, Zeal's Extended_ChannelMaps for 41..56), not a colour id.
//
// Also covered here: selecting a chat window in the layout <-> its routing card,
// and dropping a routing chip on a layout rectangle (same reroute as the card).
//
// GOLDEN FIXTURES: two windows the guild lead read off EQ's own right-click ->
// Filters menus (`*` = routed to that window), turned into the [ChatManager]
// ChannelMap values that produce them. The /join channel names are INVENTED
// (zz*): channel names are user data, and the real ones stay out of the repo.
//
// ⚠ Source slices use their comment anchors, so the whole-file text is stripped
// only for the assertions (CLAUDE.md "comments satisfy text assertions").
//
// Run: npx vitest run test/ui-studio-chat-channels.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const code = stripJs(html);

// eval a sliced block with the page globals it leans on passed in
function run(block, names, env = {}) {
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, block + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => env[k]));
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const channelBlock = sliceBlock(html, '  var CHAT_CHANNEL_ROWS = [', '// ── /Chat channel names');
const { CHAT_CHANNEL_ROWS, _chatChannelInfo, _chatChipInner, _defaultChannelInfo } = run(
  channelBlock, ['CHAT_CHANNEL_ROWS', '_chatChannelInfo', '_chatChipInner', '_defaultChannelInfo'], { escapeHtml });

const linkBlock = sliceBlock(html, '  var CHAT_ROUTER = null;', '// ── /Chat window ↔ layout link');
const mkLink = (STATE, renderStage = () => {}, doc = { querySelectorAll: () => [] }) => run(
  linkBlock,
  ['_parseChipDrop', '_dropChipOnWindow', '_chatWinOfRect', '_rectOfChatWin', '_selectChatWindow',
    '_clearSelection', '_syncChatCardSelection', '_labelDy'],
  { STATE, renderStage, document: doc });

const { _autojoinNames } = run(
  sliceBlock(mainJs, 'function _autojoinNames(iniText, character) {', "map((s) => s.split(':')[0]);\n}"),
  ['_autojoinNames']);

// [ChatManager] ChannelMap<N>=<win> -> { win: [ids] }, the same inversion main.js does
function routedFrom(ini) {
  const out = {};
  for (const L of ini.split(/\r?\n/)) {
    const m = L.match(/^ChannelMap(\d+)=(\d+)$/);
    if (m) (out[Number(m[2])] ||= []).push(Number(m[1]));
  }
  return out;
}

// ── golden 1: the "Auction" window (Chat 4) ────────────────────────────────
// In game: Filters -> * Auction (Say, Tell, Group, Raid, Guild, OOC, Shout, Emotes
// not starred); Chat Channel -> slot 1 NOT starred, slots 2..5 starred.
const AUCTION_INI = [
  'ChannelMap0=0', 'ChannelMap1=0', 'ChannelMap2=0', 'ChannelMap3=0', 'ChannelMap4=0', 'ChannelMap5=0',
  'ChannelMap6=4', 'ChannelMap7=0', 'ChannelMap8=0',
  'ChannelMap12=0', 'ChannelMap13=4', 'ChannelMap14=4', 'ChannelMap15=4', 'ChannelMap16=4',
].join('\n');
const AUCTION_EQCLIENT = '[Defaults]\nChannelAutoJoin=zzofficer:pw1 zztag:pw2 zzgeneral zzlfg zzports\n';

// ── golden 2: "F THIS CHAT" (Chat 13) ───────────────────────────────────────
// In game: Melee -> others; Zeal -> Other Pet Say / Other Pet Damage / Other Melee
// Special / Other Melee Critical / Other Damage Shield / Zeal Spam.
const OTHERS_INI = [
  'ChannelMap26=13', 'ChannelMap27=13', 'ChannelMap46=13', 'ChannelMap47=13',
  'ChannelMap50=13', 'ChannelMap53=13', 'ChannelMap54=13', 'ChannelMap55=13',
  'ChannelMap9=0', 'ChannelMap44=0', 'ChannelMap49=0', 'ChannelMap45=0',
].join('\n');

describe('golden window: Auction (Chat 4)', () => {
  const ids = routedFrom(AUCTION_INI)[4];
  const joined = _autojoinNames(AUCTION_EQCLIENT, 'Anyone');

  it('the ini routes exactly Auction plus user-channel slots 2..5', () => {
    expect(ids.sort((a, b) => a - b)).toEqual([6, 13, 14, 15, 16]);
  });

  it('every chip reads as the in-game starred item', () => {
    const texts = ids.sort((a, b) => a - b).map((n) => _chatChannelInfo(n, joined).text);
    expect(texts).toEqual([
      'Auction',
      'Chat Channel · zztag', 'Chat Channel · zzgeneral', 'Chat Channel · zzlfg', 'Chat Channel · zzports',
    ]);
  });

  it('the unstarred items are not in the window (Say..Emotes, slot 1)', () => {
    const names = ids.map((n) => _chatChannelInfo(n, joined).text);
    for (const n of ['Say', 'Tell', 'Group', 'Raid', 'Guild', 'OOC', 'Shout', 'Emotes']) expect(names).not.toContain(n);
    expect(names).not.toContain('Chat Channel · zzofficer');
  });

  it('without a join list the slots read "Chat channel N", never a guessed name', () => {
    expect([13, 14, 15, 16].map((n) => _chatChannelInfo(n).text)).toEqual(
      ['Chat channel 2', 'Chat channel 3', 'Chat channel 4', 'Chat channel 5']);
  });
});

describe('golden window: F THIS CHAT (Chat 13)', () => {
  const ids = routedFrom(OTHERS_INI)[13].sort((a, b) => a - b);
  const infos = ids.map((n) => _chatChannelInfo(n));

  it('Melee -> others is ids 26 and 27', () => {
    expect(infos.filter((i) => i.group === 'Melee').map((i) => i.name)).toEqual(["Others' hits", "Others' misses"]);
  });

  it('Zeal -> exactly the six starred filters, none of the unstarred', () => {
    expect(infos.filter((i) => i.group === 'Zeal').map((i) => i.name)).toEqual([
      'Other Pet Say', 'Other Pet Damage', 'Other Melee Special', 'Other Melee Critical', 'Other Damage Shield', 'Zeal Spam']);
    expect(infos.length).toBe(8);   // nothing "Ch N" is left
    expect(infos.every((i) => i.known)).toBe(true);
  });
});

describe('the id -> name table', () => {
  it('covers 0..56 contiguously, one row each', () => {
    expect(CHAT_CHANNEL_ROWS.map((r) => r[0])).toEqual(Array.from({ length: 57 }, (_, i) => i));
  });

  it('41..56 is the Zeal submenu in the order the game shows it', () => {
    expect(CHAT_CHANNEL_ROWS.filter((r) => r[0] >= 41).map((r) => r[2])).toEqual([
      'Random', 'Loot', 'Money', 'My Pet Say', 'My Pet Damage', 'Other Pet Say', 'Other Pet Damage', '/who',
      'My Melee Special', 'Other Melee Special', '/mystats', 'Item Speech', 'Other Melee Critical',
      'Other Damage Shield', 'Zeal Spam', 'Bandolier']);
    expect(CHAT_CHANNEL_ROWS.filter((r) => r[0] >= 41).every((r) => r[1] === 'Zeal')).toBe(true);
  });

  it('the top of the menu matches the in-game order, and the old swap is gone', () => {
    expect(CHAT_CHANNEL_ROWS.slice(0, 9).map((r) => r[2])).toEqual(
      ['Say', 'Tell', 'Group', 'Raid', 'Guild', 'OOC', 'Auction', 'Shout', 'Emotes']);
    expect(_chatChannelInfo(4).text).toBe('Guild');
    expect(_chatChannelInfo(6).text).toBe('Auction');
    expect(_chatChannelInfo(11).text).toBe('Skills');
    expect(_chatChannelInfo(22).text).toBe('Other');
  });

  it('user channels are 12..21 and nothing else is', () => {
    const slots = CHAT_CHANNEL_ROWS.filter((r) => r[1] === 'Chat Channel').map((r) => r[0]);
    expect(slots).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it('the names the old table made up are gone', () => {
    const names = CHAT_CHANNEL_ROWS.map((r) => r[2]);
    for (const gone of ['Petition', 'Player NPC', 'Bard Songs', 'Faction', 'Group Inv', 'Combat', 'Damage', 'System', 'Yell', 'NPC', 'Pet', 'Death', 'Spells']) {
      expect(names).not.toContain(gone);
    }
  });

  it('an id no source confirms falls back to "Ch N" with an unknown tooltip', () => {
    for (const n of [57, 58, 72, 99]) {
      const i = _chatChannelInfo(n);
      expect(i.known).toBe(false);
      expect(i.text).toBe('Ch ' + n);
      expect(i.title).toMatch(/unknown channel id/);
    }
  });

  it('every id the panel can plausibly show (0..120) is sourced or falls back', () => {
    for (let n = 0; n <= 120; n++) {
      const i = _chatChannelInfo(n);
      if (n <= 56) { expect(i.known).toBe(true); expect(i.text).not.toMatch(/^Ch \d+$/); }
      else expect(i.text).toBe('Ch ' + n);
    }
  });
});

describe('the chip render', () => {
  it('shows the name plus the id as a dim suffix', () => {
    const h = _chatChipInner(26);
    expect(h).toContain("Melee · Others' hits");
    expect(h).toMatch(/<span class="chId"[^>]*>26<\/span>/);
    expect(_chatChipInner(55)).toContain('Zeal · Zeal Spam');
  });

  it('an unknown id reads "Ch N" once, with no second copy of the number', () => {
    const h = _chatChipInner(88);
    expect(h).toBe('Ch 88');
  });

  it('a /join name is escaped', () => {
    expect(_chatChipInner(13, [null, '<b>x</b>'])).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('the default pill names only what is sourced (3 = Tell), never "Combat"', () => {
    expect(_defaultChannelInfo(3).text).toBe('Tell');
    expect(_defaultChannelInfo(8).text).toBe('Ch 8');
    expect(_defaultChannelInfo(8).title).toMatch(/not confirmed/);
    expect(_defaultChannelInfo(null).text).toBe('—');
  });

  it('the inspector renders chips and the pill through those functions', () => {
    expect(code).toMatch(/_chatChipInner\(filt, JOINED\)/);
    expect(code).toMatch(/_defaultChannelInfo\(cwn\.default_channel\)\.text/);
    expect(code).not.toMatch(/FILTER_NAMES|_filterName|_channelName/);
  });
});

describe('/join names from eqclient.ini (main.js)', () => {
  it('reads the space-separated list in order and drops every password', () => {
    expect(_autojoinNames(AUCTION_EQCLIENT, 'Anyone')).toEqual(['zzofficer', 'zztag', 'zzgeneral', 'zzlfg', 'zzports']);
    expect(JSON.stringify(_autojoinNames(AUCTION_EQCLIENT, 'Anyone'))).not.toMatch(/pw[12]/);
  });
  it("prefers Zeal's per-character list, ignores other sections, tolerates absence", () => {
    const ini = '[Other]\nChannelAutoJoin=nope\n[Defaults]\nChannelAutoJoin=aa bb\nChannelAutoJoin_Someone=cc:x dd\n';
    expect(_autojoinNames(ini, 'Someone')).toEqual(['cc', 'dd']);
    expect(_autojoinNames(ini, 'Nobody')).toEqual(['aa', 'bb']);
    expect(_autojoinNames('', 'x')).toEqual([]);
    expect(_autojoinNames(null, 'x')).toEqual([]);
  });
  it('the handler hands the inspector the names', () => {
    expect(stripJs(mainJs)).toMatch(/_autojoinNames\(fs\.readFileSync\(path\.join\(d, 'eqclient\.ini'\)/);
  });
});

// ── selection + routing from the layout ─────────────────────────────────────
const rects = () => [
  { kind: 'buffs', label: 'Buffs' },
  { kind: 'chat', file: 'UI_A.ini', chatMeta: { index: 4, name: 'Auction', defaultChannel: 8 } },
  { kind: 'chat', file: 'UI_A.ini', chatMeta: { index: 7, name: 'Guild', defaultChannel: 8 } },
  { kind: 'chat', file: 'UI_A.ini', chatMeta: { index: 12, name: 'tells', defaultChannel: 3 } },
  { kind: 'chat', file: 'UI_B.ini', chatMeta: { index: 7, name: 'Guild', defaultChannel: 8 } },
];
const fakeCard = (win) => {
  const cls = new Set();
  const c = {
    win, scrolled: 0, cls,
    getAttribute: (k) => (k === 'data-win' ? String(win) : null),
    classList: {
      toggle: (n, on) => (on ? cls.add(n) : cls.delete(n)),
      add: (n) => cls.add(n), remove: (n) => cls.delete(n),
    },
    scrollIntoView: () => { c.scrolled++; },
    offsetWidth: 1,
  };
  return c;
};

describe('selection is one state, shared', () => {
  it('rectangle -> card: selecting a chat rectangle marks only its card, and scrolls once', () => {
    const cards = [fakeCard(4), fakeCard(7), fakeCard(12)];
    const STATE = { windows: rects(), selected: 1 };
    const L = mkLink(STATE, () => {}, { querySelectorAll: () => cards });
    L._syncChatCardSelection();
    expect(cards.map((c) => c.cls.has('chatSel'))).toEqual([true, false, false]);
    expect(cards[0].scrolled).toBe(1);
    expect(cards[0].cls.has('chatFlash')).toBe(true);
    // a drag tick re-renders: still selected, but no second scroll/flash
    L._syncChatCardSelection();
    expect(cards[0].scrolled).toBe(1);
    // moving the selection moves the mark
    STATE.selected = 2;
    L._syncChatCardSelection();
    expect(cards.map((c) => c.cls.has('chatSel'))).toEqual([false, true, false]);
    expect(cards[1].scrolled).toBe(1);
  });

  it('a non-chat rectangle (or nothing) marks no card', () => {
    const cards = [fakeCard(4)];
    const STATE = { windows: rects(), selected: 0 };
    const L = mkLink(STATE, () => {}, { querySelectorAll: () => cards });
    L._syncChatCardSelection();
    expect(cards[0].cls.has('chatSel')).toBe(false);
    STATE.selected = -1;
    L._syncChatCardSelection();
    expect(cards[0].cls.has('chatSel')).toBe(false);
  });

  it('card title -> rectangle: selects that window and re-renders; prefers the card\'s own file', () => {
    let renders = 0;
    const STATE = { windows: rects(), selected: -1 };
    const L = mkLink(STATE, () => { renders++; });
    expect(L._selectChatWindow(7, 'UI_B.ini')).toBe(true);
    expect(STATE.selected).toBe(4);
    expect(L._selectChatWindow(7, 'UI_A.ini')).toBe(true);
    expect(STATE.selected).toBe(2);
    expect(renders).toBe(2);
  });

  it('a window with no rectangle leaves the selection alone', () => {
    let renders = 0;
    const STATE = { windows: rects(), selected: 1 };
    const L = mkLink(STATE, () => { renders++; });
    expect(L._selectChatWindow(99, 'UI_A.ini')).toBe(false);
    expect(STATE.selected).toBe(1);
    expect(renders).toBe(0);
  });

  it('Esc clears the selection and repaints; a second Esc is a no-op', () => {
    let renders = 0;
    const STATE = { windows: rects(), selected: 2 };
    const L = mkLink(STATE, () => { renders++; });
    expect(L._clearSelection()).toBe(true);
    expect(STATE.selected).toBe(-1);
    expect(L._clearSelection()).toBe(false);
    expect(renders).toBe(1);
  });

  it('the Escape key is wired to it (and yields to dialogs and form fields)', () => {
    const k = code.slice(code.indexOf("document.addEventListener('keydown', function(e){\n    if (e.key !== 'Escape') return;"));
    const body = k.slice(0, k.indexOf('});') + 3);
    expect(body).toMatch(/_clearSelection\(\)/);
    expect(body).toMatch(/INPUT/);
    expect(body).toMatch(/displayPicker/);
  });

  it('both sides drive the same state', () => {
    // the stage repaints the cards from STATE.selected; the card title assigns it
    expect(code).toMatch(/_syncChatCardSelection\(\);\n  \}\n  window\.addEventListener\('resize'/);
    expect(code).toMatch(/_selectChatWindow\(parseInt\(this\.getAttribute\('data-win'\), 10\), chatBlock\.dataset\.file\)/);
  });
});

describe('routing a chip from the layout', () => {
  const row = (drop) => ({ getAttribute: (k) => (k === 'data-drop' ? drop : null) });
  const payload = (filter, fromWin) => JSON.stringify({ filter, fromWin });
  const L = mkLink({ windows: [], selected: -1 });

  it('a drop on a normal window calls the reroute with the same arguments the card path uses', () => {
    const calls = [];
    const r = row('1');
    expect(L._dropChipOnWindow(payload(26, 0), 13, () => r, (...a) => calls.push(a))).toBe(true);
    expect(calls).toEqual([[26, 0, 13, r]]);
  });

  it('a Tell window refuses the drop', () => {
    const calls = [];
    expect(L._dropChipOnWindow(payload(26, 0), 12, () => row('0'), (...a) => calls.push(a))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a window that is not in the Inspector, the same window, and junk payloads do nothing', () => {
    const calls = [];
    const rr = (...a) => calls.push(a);
    expect(L._dropChipOnWindow(payload(26, 0), 13, () => null, rr)).toBe(false);
    expect(L._dropChipOnWindow(payload(26, 13), 13, () => row('1'), rr)).toBe(false);
    expect(L._dropChipOnWindow('not json', 13, () => row('1'), rr)).toBe(false);
    expect(L._dropChipOnWindow('{"filter":"x"}', 13, () => row('1'), rr)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('the card row and the layout rectangle share ONE reroute and one write path', () => {
    // card row
    expect(code).toMatch(/_dropChipOnWindow\(raw, parseInt\(this\.getAttribute\('data-win'\), 10\), function\(\)\{ return thisRow; \}, _rerouteChip\)/);
    // layout rectangle
    expect(code).toMatch(/_dropChipOnWindow\(e\.dataTransfer\.getData\('text\/plain'\), parseInt\(el\.getAttribute\('data-chat-win'\), 10\), CHAT_ROUTER\.rowFor, CHAT_ROUTER\.reroute\)/);
    expect(code).toMatch(/reroute: _rerouteChip,/);
    // the ChannelMap write exists once (in _rerouteChip), not once per surface
    expect((code.match(/value: String\(toWin\)/g) || []).length).toBe(1);
    // and the stage never stages an edit itself
    const stageDrop = code.slice(code.indexOf("stage.addEventListener('drop'"), code.indexOf("document.addEventListener('dragend'"));
    expect(stageDrop).not.toMatch(/_stageChatEdit/);
  });

  it('only non-Tell chat rectangles are targets, and they light up while a chip is dragged', () => {
    expect(code).toMatch(/dropCls = \(cwin != null && w\.chatMeta\.defaultChannel !== 3\) \? ' chat-drop' : ''/);
    expect(code).toMatch(/var el = e\.target\.closest\('\.win\.chat-drop'\);\n    _clearChipHover\(\);\n    if \(!el\) return;/);
    expect(code).toMatch(/stage\.classList\.add\('chipDragging'\)/);
    expect(stripJsCss(html)).toMatch(/#stage\.chipDragging \.win\.chat-drop\{/);
  });
});

function stripJsCss(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

describe('stacked window titles stay readable', () => {
  const { _labelDy } = mkLink({ windows: [], selected: -1 });
  const it0 = (sx, sy, chars = 12, sw = 200, sh = 80) => ({ sx, sy, sw, sh, chars });

  it('two rectangles in the same corner get different title lines', () => {
    expect(_labelDy([it0(10, 10), it0(10, 10)])).toEqual([0, 11]);
  });
  it('three stack down in turn', () => {
    expect(_labelDy([it0(10, 10), it0(10, 10), it0(12, 10)])).toEqual([0, 11, 22]);
  });
  it('titles that do not collide are left alone', () => {
    expect(_labelDy([it0(10, 10), it0(300, 10), it0(10, 60)])).toEqual([0, 0, 0]);
  });
  it('a rectangle too short to take a second line is left as it was', () => {
    expect(_labelDy([it0(10, 10), it0(10, 10, 12, 200, 14)])).toEqual([0, 0]);
  });
  it('renderStage applies the offset to the title', () => {
    expect(code).toMatch(/var dys = _labelDy\(items\);/);
    expect(code).toMatch(/dys\[k\] \? ' style="top:' \+ \(2 \+ dys\[k\]\) \+ 'px"' : ''/);
  });
});
