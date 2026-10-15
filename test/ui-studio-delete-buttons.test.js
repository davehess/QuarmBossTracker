// test/ui-studio-delete-buttons.test.js — UI Studio's delete controls: the chat window 🗑 and the named
// layout Delete.
//
// The guild lead, 2026-10-15: "DELETE BUTTONS DON'T WORK IN UI STUDIO. LOAD DOES."
//
// What was found (both delete paths were driven end to end in a DOM harness first; the layout Delete
// worked every time, the chat 🗑 did too until the layout counted as "edited"):
//   1. 🗑 refuses while any layout rectangle differs from the last Load ("unsaved window moves"), because
//      deleting a chat window renumbers the later ones. Two things made that refusal look like a dead button:
//      (a) the only message was a note at the TOP of the chat block, out of sight once the list was scrolled;
//      (b) after a toolbar Save the moves were still "different from the last Load", so the refusal never
//          went away — saving, the very thing the message asks for, did not clear it.
//   2. A press on a rectangle that wobbled a pixel moved the window (and snap pulled it further), so a
//      layout nobody meant to change counted as edited.
//
// The model helpers are pure and are sliced out of ui-studio.html and RUN. The page wiring that cannot be
// run here is checked on the comment-stripped source (test/_source-slice.js: a comment must not satisfy it).
//
// FIXTURES are invented; names and numbers belong to nobody.
//
// Run: npx vitest run test/ui-studio-delete-buttons.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const uiLayouts = require('../apps/mimic/uiLayouts.js');

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'preload.js'), 'utf8');
const code = stripJs(html);

// eslint-disable-next-line no-new-func
const C = new Function(sliceBlock(html, '  // ── Chat window structure: rename', '// ── /Chat window structure') + `
return { _chatDeleteWindow, _chatDeleteBlocked, _chatAdoptSaved, _chatModelDiff, _csClone };`)();
// eslint-disable-next-line no-new-func
const W = new Function(sliceBlock(html, '  function _sizeChanged(w){', '    }\n  }\n  // Writes into the TARGET') .replace(/\n  \/\/ Writes into the TARGET$/, '') + `
return { _sizeChanged, _windowChanged, _rebaselineWindows };`)();
// eslint-disable-next-line no-new-func
const D = new Function(sliceBlock(html, '  var DRAG_DEAD_ZONE = 4;', '  // /drag dead zone') + `
return { _dragPassedDeadZone, DRAG_DEAD_ZONE };`)();

// ── a character's chat setup, invented: 4 windows ────────────────────────────
function model() {
  return {
    cm: {
      NumWindows: '4',
      ChatWindow0_Name: 'Main', ChatWindow0_DefaultChannel: '0', ChatWindow0_ChatChannel: '0',
      ChatWindow1_Name: 'Combat', ChatWindow1_DefaultChannel: '0', ChatWindow1_ChatChannel: '0',
      ChatWindow2_Name: 'Loot', ChatWindow2_DefaultChannel: '0', ChatWindow2_ChatChannel: '0',
      ChatWindow3_Name: 'Pets', ChatWindow3_DefaultChannel: '0', ChatWindow3_ChatChannel: '0',
      ChannelMap0: '0', ChannelMap6: '2', ChannelMap26: '3',
    },
    geo: {
      MainChat: { XPos2560x1440: '20', YPos2560x1440: '900', Width: '500', Height: '300' },
      'Chat 1': { XPos2560x1440: '520', YPos2560x1440: '900', Width: '400', Height: '250' },
      'Chat 2': { XPos2560x1440: '530', YPos2560x1440: '910', Width: '410', Height: '260' },
      'Chat 3': { XPos2560x1440: '540', YPos2560x1440: '920', Width: '420', Height: '270' },
    },
  };
}
const win = (o) => ({ x: 10, y: 20, w: 100, h: 50, origX: 10, origY: 20, origW: 100, origH: 50, hasWH: true, ...o });

describe('the 🗑 refusal says why, and only when it must', () => {
  it('a window that can go, in a layout with no unsaved moves: no refusal', () => {
    const m = model();
    expect(C._chatDeleteBlocked(C._chatDeleteWindow(m, 2), false)).toBe('');
  });

  it('unsaved moves in the layout: refused with a message that names the way out', () => {
    const m = model();
    const why = C._chatDeleteBlocked(C._chatDeleteWindow(m, 2), true);
    expect(why).toMatch(/^Not deleted/);
    expect(why).toMatch(/Save/);
    expect(why).toMatch(/Reset/);
  });

  it('the model\'s own refusals (Main Chat) come through unchanged', () => {
    const m = model();
    const r = C._chatDeleteWindow(m, 0);
    expect(r.ok).toBe(false);
    expect(C._chatDeleteBlocked(r, false)).toBe(r.error);
    expect(C._chatDeleteBlocked(r, true)).toBe(r.error);   // the more basic reason wins
  });
});

describe('a Save clears the "unsaved moves" answer (it used to stay for good)', () => {
  const dirty = (wins) => wins.some(W._windowChanged);   // what _chatLayoutDirty asks

  it('a moved window is unsaved, and saved once the Save has been taken as the baseline', () => {
    const wins = [win({ x: 15 }), win({ id: 'b' })];
    expect(dirty(wins)).toBe(true);
    W._rebaselineWindows(wins);
    expect(dirty(wins)).toBe(false);
    expect(wins[0].origX).toBe(15);
  });

  it('a size pinned on a window with no size in the ini counts as saved, and stays pinned', () => {
    const wins = [win({ hasWH: false, w: 140, sizeEdited: true })];
    expect(dirty(wins)).toBe(true);
    W._rebaselineWindows(wins);
    expect(dirty(wins)).toBe(false);
    expect(wins[0].hasWH).toBe(true);        // the ini holds Width/Height now, as a fresh Load would show
    expect(wins[0].origW).toBe(140);
  });

  it('the raid bars\' box has real edges once a sized box is saved', () => {
    const wins = [win({ zealBar: 'raidbars', hasWH: false, toEdgeR: true, toEdgeB: true, sizeEdited: true })];
    W._rebaselineWindows(wins);
    expect(wins[0].toEdgeR).toBe(false);
    expect(wins[0].toEdgeB).toBe(false);
    expect(dirty(wins)).toBe(false);
  });

  it('a move made AFTER the Save is unsaved again', () => {
    const wins = [win({ x: 15 })];
    W._rebaselineWindows(wins);
    wins[0].y = 99;
    expect(dirty(wins)).toBe(true);
  });

  it('the Save path takes the baseline, and tells the open editor', () => {
    const save = code.slice(code.indexOf('async function _writeEdits('));
    const body = save.slice(0, save.indexOf('return true;'));
    expect(body).toMatch(/_rebaselineWindows\(STATE\.windows\)/);
    expect(body).toMatch(/if \(INSPECTOR_SAVED\) INSPECTOR_SAVED\(built\.edits\)/);
    // ...only after the write succeeded
    expect(body.indexOf('_rebaselineWindows(')).toBeGreaterThan(body.indexOf("setStatus('save failed: '"));
  });
});

describe('after a Save, the editor\'s chat geometry is what the Save wrote (a delete would copy stale positions)', () => {
  it('the saved positions land in the model, in the sections it holds', () => {
    const m = model();
    C._chatAdoptSaved(m, [
      { file: 'UI_x.ini', section: 'Chat 2', key: 'XPos2560x1440', value: 777 },
      { file: 'UI_x.ini', section: 'MainChat', key: 'Height', value: 321 },
    ], 'UI_x.ini');
    expect(m.geo['Chat 2'].XPos2560x1440).toBe('777');   // strings, like a read of the file
    expect(m.geo.MainChat.Height).toBe('321');
  });

  it('other files, windows that are not chat windows, and sections the model lacks are left alone', () => {
    const m = model();
    const before = JSON.stringify(m);
    C._chatAdoptSaved(m, [
      { file: 'zeal.ini', section: 'Chat 2', key: 'XPos2560x1440', value: 1 },
      { file: 'UI_x.ini', section: 'Compass', key: 'XPos2560x1440', value: 2 },
      { file: 'UI_x.ini', section: 'Chat 9', key: 'XPos2560x1440', value: 3 },
    ], 'UI_x.ini');
    expect(JSON.stringify(m)).toBe(before);
  });

  it('adopting into both copies stages nothing, and a delete then carries the SAVED position down', () => {
    const orig = model(), cur = C._csClone(orig);
    const edits = [{ file: 'UI_x.ini', section: 'Chat 3', key: 'XPos2560x1440', value: 888 }];
    C._chatAdoptSaved(orig, edits, 'UI_x.ini');
    C._chatAdoptSaved(cur, edits, 'UI_x.ini');
    expect(C._chatModelDiff(orig, cur)).toEqual([]);
    const r = C._chatDeleteWindow(cur, 2);                 // Chat 3 becomes Chat 2
    expect(r.ok).toBe(true);
    expect(r.model.geo['Chat 2'].XPos2560x1440).toBe('888');
  });

  it('the editor registers the hook while open, and clears it on close', () => {
    expect(code).toMatch(/INSPECTOR_SAVED = function\(edits\)\{[^}]*_chatAdoptSaved\(CHAT_ORIG, edits, chat\.file\);[^}]*_chatAdoptSaved\(CHAT_MODEL, edits, chat\.file\);/);
    expect(code).toMatch(/INSPECTOR_GUARD = null;\s*INSPECTOR_SAVED = null;/);
  });
});

describe('a click does not move a window', () => {
  it('a wobble inside the dead zone is not a drag; a real drag is', () => {
    expect(D._dragPassedDeadZone(0, 0)).toBe(false);
    expect(D._dragPassedDeadZone(1, -1)).toBe(false);
    expect(D._dragPassedDeadZone(D.DRAG_DEAD_ZONE - 1, 0)).toBe(false);
    expect(D._dragPassedDeadZone(D.DRAG_DEAD_ZONE, 0)).toBe(true);
    expect(D._dragPassedDeadZone(0, -D.DRAG_DEAD_ZONE - 1)).toBe(true);
  });

  it('the pointer handler asks it before touching the window', () => {
    const mm = code.slice(code.indexOf("document.addEventListener('mousemove', function(e){"));
    const head = mm.slice(0, mm.indexOf('var w = STATE.windows[DRAG.i]'));
    expect(head).toMatch(/if \(!DRAG\.moved\) \{\s*if \(!_dragPassedDeadZone\(e\.clientX - DRAG\.startMx, e\.clientY - DRAG\.startMy\)\) return;\s*DRAG\.moved = true;/);
  });

  it('a freshly loaded window is its own baseline (nothing is "edited" before anyone touches it)', () => {
    expect(code).toMatch(/x: x, y: y, w: w, h: h,\s*origX: x, origY: y, origW: w, origH: h,/);
  });
});

describe('the page shows a refusal where the press was', () => {
  const del = code.slice(code.indexOf('function _chatDelete(idx){'));
  const body = del.slice(0, del.indexOf('var v = _chatView(CHAT_MODEL)'));

  it('a refusal goes into the window\'s card, the status bar and the note, then is scrolled to', () => {
    expect(body).toMatch(/_chatDeleteBlocked\(r, _chatLayoutDirty\(\)\)/);
    expect(body).toMatch(/_chatWhy = \{ idx: idx, msg: why \}/);
    expect(body).toMatch(/setStatus\(why, 'err'\)/);
    expect(body).toMatch(/_chatNote\(why\)/);
    expect(body).toMatch(/scrollIntoView/);
    expect(body).toMatch(/return;/);
  });

  it('the card draws it under the clicked window\'s header, and the next change clears it', () => {
    expect(code).toMatch(/if \(_chatWhy && _chatWhy\.idx === cwn\.index\) \{\s*html \+= '<div class="chatCardWhy" role="alert"/);
    expect(code).toMatch(/if \(logLine\) \{ _chatLog\.push\(logLine\); _chatWhy = null; \}/);
  });

  it('the layout Delete says so when it has nothing to delete, instead of doing nothing', () => {
    const ld = code.slice(code.indexOf("_layEl('layoutDelete').addEventListener('click'"));
    const head = ld.slice(0, ld.indexOf('window.confirm('));
    expect(head).toMatch(/_layMsg\(/);
    expect(head).toMatch(/'err'\); return;/);
  });
});

describe('the layout Delete reaches the store and persists', () => {
  it('page -> preload -> main -> store.remove, same channel name all the way', () => {
    expect(code).toMatch(/window\.mimic\.uiStudioLayoutDelete\(\{ character: who\.character, id: p\.id \}\)/);
    expect(preloadJs).toMatch(/uiStudioLayoutDelete:\s+\(params\)\s+=> ipcRenderer\.invoke\('ui-studio-layout-delete', params\)/);
    expect(stripJs(mainJs)).toMatch(/ipcMain\.handle\('ui-studio-layout-delete'[\s\S]*?s\.remove\(c, id\)/);
  });

  it('remove writes the file: a new store on the same folder no longer lists it; a second remove says so', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uis-del-'));
    const files = { 'UI_Aldenmar_pq.proj.ini': '[Main]\r\nUISkin=default\r\n' };
    const mk = () => uiLayouts.createLayoutStore({ dir, readBundle: () => files, backupAndWrite: () => '' });
    const s = mk();
    const a = s.save('Aldenmar', '/eq', 'Raid').layout, b = s.save('Aldenmar', '/eq', 'Quiet').layout;
    expect(s.remove('Aldenmar', a.id)).toEqual({ ok: true });
    const again = mk().list('Aldenmar', '/eq', {});
    expect(again.layouts.map((l) => l.id)).toEqual([b.id]);
    const r2 = s.remove('Aldenmar', a.id);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('notfound');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
