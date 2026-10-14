// test/ui-studio-chat-windows.test.js — UI Studio's chat window rename / font / add / delete, and the
// Hotbar Pages editor's "discard changes?" question.
//
// The guild lead, 2026-10-14: "need to be able to delete or rename chats, or make new ones in the UI
// Studio" / "include chat fontsize" / "clicking off the hotbar pages should ask if you want to cancel
// changes. The UI should shrink to not sit over top of the hotbar pages".
//
// The model functions are pure, so they are sliced out of ui-studio.html and RUN; their edits are then
// pushed through the real key-edit writer (iniKeyEdits.js) and the result re-read, which is the same
// path Save takes ('ui-studio-write-pages' -> applyIniKeyEdits).
//
// FIXTURES are invented: window names, targets and numbers belong to nobody. Keys are the real ones
// (see the KEYS note above "Chat window structure" in ui-studio.html for where each was confirmed).
//
// Run: npx vitest run test/ui-studio-chat-windows.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { applyIniKeyEdits } = require('../apps/mimic/iniKeyEdits.js');

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const code = stripJs(html);

const block = sliceBlock(html, '  // ── Chat window structure: rename', '// ── /Chat window structure');
// eslint-disable-next-line no-new-func
const L = new Function(block + `
return { _chatNameClean, _chatView, _chatRenameModel, _chatSetFont, _chatAddWindow, _chatDeleteCheck, _chatDeleteWindow,
  _chatDeleteConfirmText, _chatModelDiff, _chatFontOptions, _csApplyEdit, _csClone, _hotbarLeaveAction, _hotbarAnswer,
  _hotbarRevertInputs, CHAT_NAME_MAX, CHAT_WINDOWS_MAX };`)();

// ── a character's UI ini, invented ───────────────────────────────────────────
// 5 windows: 0 Main, 1 Combat, 2 Loot, 3 a Tell window, 4 Pets (the ★ window).
const INI = [
  '[Main]', 'UISkin=default',
  '[ChatManager]',
  'NumWindows=5',
  'ChatWindow0_Name=Main', 'ChatWindow0_DefaultChannel=0', 'ChatWindow0_ChatChannel=0', 'ChatWindow0_FontStyle=4',
  'ChatWindow1_Name=Combat', 'ChatWindow1_DefaultChannel=0', 'ChatWindow1_ChatChannel=0', 'ChatWindow1_FontStyle=2',
  'ChatWindow2_Name=Loot', 'ChatWindow2_DefaultChannel=0', 'ChatWindow2_ChatChannel=0', 'ChatWindow2_FontStyle=3',
  'ChatWindow3_Name=Tell Aldenmar', 'ChatWindow3_DefaultChannel=3', 'ChatWindow3_ChatChannel=-1', 'ChatWindow3_TellTarget=Aldenmar', 'ChatWindow3_FontStyle=4',
  'ChatWindow4_Name=Pets', 'ChatWindow4_DefaultChannel=0', 'ChatWindow4_ChatChannel=0', 'ChatWindow4_FontStyle=1', 'ChatWindow4_AlwaysHere=1',
  'ChannelMap0=0', 'ChannelMap1=0', 'ChannelMap9=1',
  'ChannelMap6=2', 'ChannelMap7=2',
  'ChannelMap26=4', 'ChannelMap27=4', 'ChannelMap46=4',
  '[MainChat]', 'XPos1920x1080=10', 'YPos1920x1080=700', 'XPos2560x1440=20', 'YPos2560x1440=900', 'Width=500', 'Height=300',
  '[Chat 1]', 'XPos1920x1080=520', 'YPos1920x1080=700', 'Width=400', 'Height=250', 'Alpha=200',
  '[Chat 2]', 'XPos1920x1080=530', 'YPos1920x1080=710', 'Width=410', 'Height=260',
  '[Chat 3]', 'XPos1920x1080=540', 'YPos1920x1080=720', 'Width=420', 'Height=270', 'Locked=1',
  '[Chat 4]', 'XPos1920x1080=550', 'YPos1920x1080=730', 'Width=430', 'Height=280',
  '[Compass]', 'XPos1920x1080=5',
  '',
].join('\r\n');

// the same read main.js does for the inspector (chat.cm_props + chat.geometry)
function parse(text) {
  const cm = {}, geo = {};
  let sec = null, inCM = false;
  for (const l of text.split(/\r?\n/)) {
    const sm = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sm) { inCM = sm[1] === 'ChatManager'; const n = sm[1].trim(); sec = /^(MainChat|Chat\s*\d+)$/i.test(n) && !(n in geo) ? n : null; if (sec) geo[sec] = {}; continue; }
    const kv = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (sec && kv) geo[sec][kv[1]] = kv[2];
    if (inCM && kv) cm[kv[1]] = kv[2];
  }
  return { cm, geo };
}
const disk = () => parse(INI);
// what Save does: the model's difference from disk, through the real key writer
function save(orig, next, text = INI) {
  const edits = L._chatModelDiff(orig, next);
  return { edits, text: applyIniKeyEdits(text, edits.map((e) => ({ section: e.section, key: e.key, value: e.value }))).text };
}

describe('the fixture parses the way the inspector reads it', () => {
  it('5 windows, 2 routed to Loot, 3 to Pets, and the geometry blocks by their own names', () => {
    const v = L._chatView(disk());
    expect(v.windows.map((w) => [w.index, w.name, w.font])).toEqual([[0, 'Main', 4], [1, 'Combat', 2], [2, 'Loot', 3], [3, 'Tell Aldenmar', 4], [4, 'Pets', 1]]);
    expect(v.routed[2]).toEqual([6, 7]);
    expect(v.routed[4]).toEqual([26, 27, 46]);
    expect(v.alwaysIdx).toBe(4);
    expect(v.num).toBe(5);
    expect(Object.keys(disk().geo)).toEqual(['MainChat', 'Chat 1', 'Chat 2', 'Chat 3', 'Chat 4']);
  });
});

describe('rename', () => {
  it('writes ChatWindow<N>_Name and nothing else', () => {
    const o = disk();
    const r = L._chatRenameModel(o, 2, 'Loot Drops');
    expect(r.ok).toBe(true);
    expect(L._chatModelDiff(o, r.model)).toEqual([{ section: 'ChatManager', key: 'ChatWindow2_Name', value: 'Loot Drops' }]);
    expect(parse(save(o, r.model).text).cm.ChatWindow2_Name).toBe('Loot Drops');
  });

  it('sanitises: control characters, brackets and runs of spaces go; length is capped; empty is refused', () => {
    expect(L._chatNameClean('  a\r\n[b]\tc   d ')).toBe('a b c d');
    expect(L._chatNameClean('x'.repeat(80)).length).toBe(L.CHAT_NAME_MAX);
    expect(L._chatRenameModel(disk(), 2, ' \n [] ').ok).toBe(false);
    const sneaky = L._chatRenameModel(disk(), 2, 'Evil\r\n[ChatManager]\r\nNumWindows=1');
    expect(sneaky.name).not.toMatch(/[\r\n\[\]]/);
    const t = save(disk(), sneaky.model).text;
    expect(parse(t).cm.NumWindows).toBe('5');   // the name could not smuggle a key in
  });

  it('refuses a window that is not there', () => {
    expect(L._chatRenameModel(disk(), 9, 'x').ok).toBe(false);
  });
});

describe('font', () => {
  it('writes ChatWindow<N>_FontStyle (the key Zeal reads, 0..6) and survives the writer', () => {
    const o = disk();
    const r = L._chatSetFont(o, 1, 5);
    expect(L._chatModelDiff(o, r.model)).toEqual([{ section: 'ChatManager', key: 'ChatWindow1_FontStyle', value: '5' }]);
    expect(parse(save(o, r.model).text).cm.ChatWindow1_FontStyle).toBe('5');
  });

  it('refuses anything outside 0..6 and a window that is not there', () => {
    expect(L._chatSetFont(disk(), 1, 7).ok).toBe(false);
    expect(L._chatSetFont(disk(), 1, -1).ok).toBe(false);
    expect(L._chatSetFont(disk(), 1, 'x').ok).toBe(false);
    expect(L._chatSetFont(disk(), 9, 3).ok).toBe(false);
  });

  it('the picker shows the index, selects the current one, and never claims a missing value', () => {
    expect(L._chatFontOptions(2)).toMatch(/<option value="2" selected>2<\/option>/);
    expect((L._chatFontOptions(2).match(/selected/g) || []).length).toBe(1);
    expect(L._chatFontOptions(null)).toMatch(/value="" selected disabled/);
    expect(L._chatFontOptions(9)).toMatch(/value="9" selected disabled/);
  });

  it('a font change SURVIVES a delete\'s renumbering: Pets (4, font 1) keeps font 1 as Chat 3', () => {
    const o = disk();
    const f = L._chatSetFont(o, 4, 6).model;           // Pets font 1 -> 6
    const d = L._chatDeleteWindow(f, 2);               // delete Loot: Tell becomes 2, Pets becomes 3
    expect(d.ok).toBe(true);
    const out = parse(save(o, d.model).text).cm;
    expect(out.ChatWindow3_FontStyle).toBe('6');
    expect(out.ChatWindow3_Name).toBe('Pets');
    expect(out.ChatWindow4_FontStyle).toBeUndefined();
  });
});

describe('new window', () => {
  const o = disk();
  const r = L._chatAddWindow(o, '');

  it('is window N = NumWindows and bumps NumWindows', () => {
    expect(r.ok).toBe(true);
    expect(r.index).toBe(5);
    const t = parse(save(o, r.model).text);
    expect(t.cm.NumWindows).toBe('6');
    expect(t.cm.ChatWindow5_Name).toBe('Chat 5');
  });

  it('takes Chat 0\'s per-window keys (so the same font), but not its name, tell target or ★', () => {
    const cm = parse(save(o, r.model).text).cm;
    expect(cm.ChatWindow5_FontStyle).toBe('4');
    expect(cm.ChatWindow5_DefaultChannel).toBe('0');
    expect(cm.ChatWindow5_ChatChannel).toBe('0');
    expect(cm.ChatWindow5_TellTarget).toBeUndefined();
    expect(cm.ChatWindow5_AlwaysHere).toBeUndefined();
  });

  it('starts empty: no channel is routed to it, and the others are untouched', () => {
    const v = L._chatView(r.model);
    expect(v.routed[5]).toBeUndefined();
    expect(v.routed[2]).toEqual([6, 7]);
    expect(v.alwaysIdx).toBe(4);
  });

  it('gets a geometry block named in the same spelling as its siblings, offset from Chat 0, with a size', () => {
    expect(r.section).toBe('Chat 5');
    const t = parse(save(o, r.model).text);
    expect(t.geo['Chat 5'].XPos1920x1080).toBe('40');     // MainChat 10 + 30
    expect(t.geo['Chat 5'].YPos1920x1080).toBe('730');    // 700 + 30
    expect(t.geo['Chat 5'].Width).toBe('430');            // the newest sibling's size
    expect(t.geo['Chat 5'].Height).toBe('280');
    expect(t.geo['Chat 1'].XPos1920x1080).toBe('520');    // nothing else moved
  });

  it('follows the other spelling when that is what the file uses, and names it only from a real sibling', () => {
    const ini = '[ChatManager]\r\nNumWindows=2\r\nChatWindow0_Name=Main\r\nChatWindow1_Name=B\r\n[MainChat]\r\nXPos1920x1080=10\r\nYPos1920x1080=20\r\n[Chat1]\r\nXPos1920x1080=1\r\nYPos1920x1080=2\r\nWidth=9\r\nHeight=8\r\n';
    const a = L._chatAddWindow(parse(ini), 'Third');
    expect(a.section).toBe('Chat2');
    expect(parse(save(parse(ini), a.model, ini).text).geo.Chat2.XPos1920x1080).toBe('40');
    // no numbered sibling at all: the section spelling is unknown, so none is written
    const lone = '[ChatManager]\r\nNumWindows=1\r\nChatWindow0_Name=Main\r\nChatWindow0_FontStyle=3\r\n[MainChat]\r\nXPos1920x1080=10\r\n';
    const b = L._chatAddWindow(parse(lone), '');
    expect(b.ok).toBe(true);
    expect(b.section).toBeNull();
    expect(L._chatModelDiff(parse(lone), b.model).every((e) => e.section === 'ChatManager')).toBe(true);
    expect(parse(save(parse(lone), b.model, lone).text).cm.ChatWindow1_FontStyle).toBe('3');
  });

  it('stops at the 32 windows the game keeps', () => {
    const cm = { NumWindows: '32', ChatWindow0_Name: 'Main' };
    expect(L._chatAddWindow({ cm, geo: {} }, '').ok).toBe(false);
  });
});

describe('delete', () => {
  const o = disk();
  const d = L._chatDeleteWindow(o, 2);   // Loot
  const out = parse(save(o, d.model).text);

  it('moves every channel routed to the deleted window to Main Chat (0)', () => {
    expect(d.ok).toBe(true);
    expect(d.moved.sort((a, b) => a - b)).toEqual([6, 7]);
    expect(out.cm.ChannelMap6).toBe('0');
    expect(out.cm.ChannelMap7).toBe('0');
  });

  it('renumbers the later windows\' ChannelMap values, and leaves the earlier ones alone', () => {
    expect(out.cm.ChannelMap26).toBe('3');   // Pets was 4
    expect(out.cm.ChannelMap27).toBe('3');
    expect(out.cm.ChannelMap46).toBe('3');
    expect(out.cm.ChannelMap9).toBe('1');    // Combat is before it
    expect(out.cm.ChannelMap0).toBe('0');
  });

  it('shifts every per-window key down, drops the last, and carries ★ with its window', () => {
    expect(out.cm.NumWindows).toBe('4');
    expect(out.cm.ChatWindow2_Name).toBe('Tell Aldenmar');
    expect(out.cm.ChatWindow2_TellTarget).toBe('Aldenmar');
    expect(out.cm.ChatWindow2_DefaultChannel).toBe('3');
    expect(out.cm.ChatWindow3_Name).toBe('Pets');
    expect(out.cm.ChatWindow3_AlwaysHere).toBe('1');
    expect(Object.keys(out.cm).filter((k) => /^ChatWindow4_/.test(k))).toEqual([]);
    expect(out.cm.ChatWindow1_Name).toBe('Combat');
  });

  it('moves the geometry blocks too: later windows\' positions shift down, the last block is emptied', () => {
    expect(out.geo['Chat 2'].XPos1920x1080).toBe('540');   // was Chat 3's
    expect(out.geo['Chat 2'].Locked).toBe('1');            // a key only Chat 3 had comes along
    expect(out.geo['Chat 3'].XPos1920x1080).toBe('550');   // was Chat 4's
    expect(out.geo['Chat 3'].Locked).toBeUndefined();      // and is gone from where it was
    expect(out.geo['Chat 4']).toEqual({});                 // nothing left in the last block
    expect(out.geo['Chat 1'].Alpha).toBe('200');
    expect(out.geo.MainChat.Width).toBe('500');
  });

  it('only the chat windows\' blocks and [ChatManager] are written; other sections are byte-identical', () => {
    const t = save(o, d.model).text;
    expect(t).toContain('[Compass]\r\nXPos1920x1080=5\r\n');
    expect(t).toContain('[Main]\r\nUISkin=default\r\n');
  });

  it('deleting the ★ window clears the ★; deleting the last window needs no renumbering', () => {
    const p = L._chatDeleteWindow(o, 4);
    expect(p.ok).toBe(true);
    expect(p.mode).toBe('last');
    expect(p.renumbered).toEqual([]);
    const t = parse(save(o, p.model).text);
    expect(t.cm.NumWindows).toBe('4');
    expect(Object.keys(t.cm).some((k) => /AlwaysHere/.test(k))).toBe(false);
    expect(t.cm.ChannelMap26).toBe('0');
    expect(t.geo['Chat 4']).toEqual({});
  });

  it('is refused for Main Chat (0) and for Tell windows, and for a window that is not there', () => {
    const m = L._chatDeleteWindow(o, 0);
    expect(m.ok).toBe(false); expect(m.code).toBe('main');
    const t = L._chatDeleteWindow(o, 3);
    expect(t.ok).toBe(false); expect(t.code).toBe('tell');
    expect(L._chatDeleteWindow(o, 11).ok).toBe(false);
    expect(L._chatModelDiff(o, o)).toEqual([]);   // a refusal stages nothing
  });

  it('falls back to "last window only" when [ChatManager] holds a numbered key it cannot place', () => {
    const odd = disk();
    odd.cm.HighlightColor2 = '255';
    const mid = L._chatDeleteWindow(odd, 2);
    expect(mid.ok).toBe(false);
    expect(mid.code).toBe('last-only');
    expect(mid.error).toMatch(/Only the last chat window \(Chat 4\)/);
    expect(mid.error).toMatch(/HighlightColor2/);
    expect(L._chatDeleteWindow(odd, 4).ok).toBe(true);
  });

  it('the confirmation says where the channels go and what renumbers', () => {
    const txt = L._chatDeleteConfirmText('Loot', 2, ['Auction', 'Shout'], d.renumbered);
    expect(txt).toMatch(/move to Main Chat \(0\): Auction, Shout/);
    expect(txt).toMatch(/Chat 3 becomes Chat 2, Chat 4 becomes Chat 3/);
    expect(txt).toMatch(/Nothing is written until you press Save changes/);
  });
});

describe('edits stack: routing, rename, font, add and delete together diff against the disk once', () => {
  it('a chip moved onto a window that is then deleted ends up at Main Chat, not at a stale number', () => {
    const o = disk();
    let m = L._csClone(o);
    L._csApplyEdit(m, { section: 'ChatManager', key: 'ChannelMap9', value: '4' });   // Combat's chip onto Pets
    m = L._chatDeleteWindow(m, 4).model;                                              // delete Pets
    expect(parse(save(o, m).text).cm.ChannelMap9).toBe('0');
  });

  it('a chip moved and moved back stages nothing', () => {
    const o = disk();
    const m = L._csClone(o);
    L._csApplyEdit(m, { section: 'ChatManager', key: 'ChannelMap9', value: '4' });
    L._csApplyEdit(m, { section: 'ChatManager', key: 'ChannelMap9', value: '1' });
    expect(L._chatModelDiff(o, m)).toEqual([]);
  });

  it('adding then deleting the new window leaves the ini as it was', () => {
    const o = disk();
    const a = L._chatAddWindow(o, 'Temp');
    const back = L._chatDeleteWindow(a.model, a.index);
    const t = save(o, back.model).text;
    const after = parse(t);
    expect(after.cm).toEqual(o.cm);
    expect(after.geo).toEqual(o.geo);                  // not even an empty [Chat 5] header is left behind
    expect(t).toBe(INI);
  });
});

describe('Hotbar Pages editor: leaving asks only when something changed', () => {
  const guard = (dirty) => {
    const calls = [];
    return { calls, isDirty: () => dirty, revert: () => calls.push('revert'), close: () => calls.push('close') };
  };

  it('nothing changed: no question', () => {
    expect(L._hotbarLeaveAction(guard(false))).toBe('leave');
    expect(L._hotbarLeaveAction(null)).toBe('leave');
  });

  it('something changed: ask', () => {
    expect(L._hotbarLeaveAction(guard(true))).toBe('ask');
  });

  it('Keep editing changes nothing; Discard reverts, then closes', () => {
    const k = guard(true);
    expect(L._hotbarAnswer(k, 'keep')).toBe('kept');
    expect(k.calls).toEqual([]);
    const d = guard(true);
    expect(L._hotbarAnswer(d, 'discard')).toBe('discarded');
    expect(d.calls).toEqual(['revert', 'close']);
  });

  it('reverting puts every field back to the value it was opened with', () => {
    const mk = (orig, value) => ({ value, getAttribute: (n) => (n === 'data-orig' ? orig : null) });
    const ins = [mk('E18', 'X1'), mk('', 'typed'), mk('/rs hi', '')];
    L._hotbarRevertInputs(ins);
    expect(ins.map((i) => i.value)).toEqual(['E18', '', '/rs hi']);
  });
});

describe('wiring in the page (comments stripped)', () => {
  it('the guard holds a press outside the editor only while it is dirty, and the × asks too', () => {
    expect(code).toMatch(/document\.addEventListener\('mousedown', _inspectorOutsidePress, true\)/);
    expect(code).toMatch(/_hotbarLeaveAction\(INSPECTOR_GUARD\) === 'leave'\) return;/);
    expect(code).toMatch(/getElementById\('uiInspectorClose'\)\.addEventListener\('click', _inspectorTryLeave\)/);
    expect(code).toMatch(/Discard changes to hotbar pages\?/);
    expect(code).toMatch(/id="discardKeep"/);
    expect(code).toMatch(/id="discardGo"/);
    expect(code).not.toMatch(/getElementById\('socialsInspector'\)\.remove\(\)"/);   // no unguarded inline close
  });

  it('the editor is docked in #content (not fixed over it) and the properties panel steps aside', () => {
    expect(code).toMatch(/getElementById\('content'\)\.appendChild\(dlg\)/);
    expect(code).not.toMatch(/'position:fixed;top:50px;right:0;bottom:0;width:' \+ savedW/);
    expect(stripCss(html)).toMatch(/body\.inspecting #side\{display:none !important\}/);
    expect(code).toMatch(/new ResizeObserver\(function\(\)\{ if \(STATE\.windows\.length\) renderStage\(\); \}\)\.observe\(stageWrap\)/);
  });

  it('every chat change is staged as the diff of the model, and Save sends _chatEdits through write-pages', () => {
    expect(code).toMatch(/var ds = _chatModelDiff\(CHAT_ORIG, CHAT_MODEL\)/);
    expect(code).toMatch(/for \(var ce of _chatEdits\.values\(\)\) \{\n\s+edits\.push\(\{ file: chatF, section: ce\.section, key: ce\.key, value: ce\.value \}\);/);
    expect(code).toMatch(/uiStudioWritePages\(STATE\.eqDir, edits\)/);
    expect(code).toMatch(/if \(!anyDirty\)|var anyDirty = _anyDirty\(\)/);   // the Save button reads the one dirty answer
  });

  it('the cards carry rename, font, delete and a New button; delete is disabled for Main and Tell', () => {
    expect(code).toMatch(/class="chatRenameBtn"/);
    expect(code).toMatch(/class="chatFontSel"/);
    expect(code).toMatch(/class="chatDeleteBtn"/);
    expect(code).toMatch(/id="chatAddBtn"/);
    expect(code).toMatch(/cwn\.index === 0 \? 'Main Chat \(0\) cannot be deleted' : \(isTell \? 'Tell windows cannot be deleted here' : ''\)/);
  });

  it('the inspector read hands the model the whole [ChatManager] and the chat geometry blocks', () => {
    const c = stripJs(mainJs);
    expect(c).toMatch(/cm_props: cm,/);
    expect(c).toMatch(/geometry,\s/);
    expect(c).toMatch(/font_style: fs_ != null/);
    expect(c).toMatch(/ChatWindow\$\{i\}_FontStyle/);
  });
});

function stripCss(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }
