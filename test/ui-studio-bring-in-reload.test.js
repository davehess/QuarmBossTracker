// test/ui-studio-bring-in-reload.test.js — what an open UI Studio does when a bring-in (restore) is written behind it.
//
// Mimic 3.0.11 review (2026-11-14), area "studio": the canvas went stale after a queued bring-in, so its guessed
// places were written over the brought-in layout; a reload after another character's bring-in dropped an unsaved
// Fit / cloud-backup preview; and the status line advised "press Load", which throws the moves away. The main
// process now tells the window when a restore is WRITTEN (ui-studio-restored); _reloadAfterBringIn decides.
//
// The shipped functions are sliced out of ui-studio.html and RUN with stubs (no text matching on the decisions).
//
// Run: npx vitest run test/ui-studio-bring-in-reload.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'));

// A top-level function of the page's script, from its `function` line to the closing brace at two-space indent.
function fn(name) {
  const at = html.indexOf('\n  function ' + name + '(');
  const start = at >= 0 ? at : html.indexOf('\n  async function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  const end = html.indexOf('\n  }\n', start + 1);
  return html.slice(start + 1, end + 4);
}
const NAMES = ['_sameDir', '_hasUnsavedEdits', '_reloadAfterBringIn', '_staleNotice', '_staleHide', '_writeAllReason', '_sizeChanged',
  '_windowChanged', '_unplacedUntilOpened', '_noPlaceCount', '_buildSaveEdits', '_withoutGuesses', '_confirmSaveOverQueued', '_queueDefer', '_restoreQueuedHere'];

function make(over) {
  const src = NAMES.map(fn).join('\n');
  const calls = { status: [], load: 0, native: null, defer: [], staleBtn: 'none' };
  const STATE = Object.assign({ character: 'Aldenmar', eqDir: 'C:\\EQ', bundle: {}, windows: [], srcW: 1920, srcH: 1080, tgtW: 1920, tgtH: 1080,
    srcSuffix: '1920x1080', fromCloud: false }, over || {});
  let pending = [];
  const h_answer = { v: true };
  const asked = [];
  const window = { confirm: (m) => { asked.push(m); return h_answer.v; }, mimic: {
    uiStudioDeferSave: async (p) => { calls.defer.push(p); return { ok: true }; },
    uiStudioPendingList: async () => pending,
  } };
  const document = { getElementById: () => ({ style: { set display(v) { calls.staleBtn = v; } } }) };
  const setStatus = (m, c) => calls.status.push([m, c]);
  const loadAndRescale = (native) => { calls.load++; calls.native = native; return Promise.resolve(); };
  const _showDeferBanner = () => {};
  const _zealBarEdits = (w) => ({ Left: w.x, Top: w.y });
  const api = new Function('STATE', 'window', 'document', 'setStatus', 'loadAndRescale', '_showDeferBanner', '_zealBarEdits',
    src + '\nreturn {' + NAMES.join(',') + '};')(STATE, window, document, setStatus, loadAndRescale, _showDeferBanner, _zealBarEdits);
  return { api, STATE, calls, asked, answer: (v) => { h_answer.v = v; }, setPending: (p) => { pending = p; } };
}

const win = (file, section, noBlock, extra) => Object.assign({ file, section, category: 'chat', hasWH: false, x: 10, y: 20, w: 200, h: 100,
  origX: 10, origY: 20, origW: 200, origH: 100, noBlock: !!noBlock }, extra || {});
const OWN = 'UI_Aldenmar_pq.proj.ini';
const canvas = () => [win(OWN, 'A', false), win(OWN, 'B', true), win(OWN, 'C', true), win(OWN, 'D', true)];
const bundle = () => ({ 'eqclient.ini': '', 'Zeal.ini': '', [OWN]: '', 'Aldenmar_pq.proj.ini': '' });
const done = (character, names, eqDir) => ({ character, kind: 'done', eqDir, files: names.map((n) => ({ name: n, parts: [] })) });
// (a queued row carries no file list in practice; one is given here so only its kind keeps it from counting as written)
const queued = (character, busy) => ({ character, kind: 'queued', busy, parts: 'windows', files: [{ name: OWN }] });
const run = (rows, over, mutate) => {
  const h = make(Object.assign({ bundle: bundle(), windows: canvas() }, over || {}));
  if (mutate) mutate(h.STATE);
  h.api._reloadAfterBringIn(true, rows);
  return h;
};
const noBlocks = (h) => h.STATE.windows.map((w) => (w.noBlock ? 1 : 0)).join('');

describe('_reloadAfterBringIn decides when the canvas re-reads', () => {
  it('a queued result does not reload (nothing was written yet)', () => {
    const h = run([queued('Aldenmar', 'camp'), queued('Aldenmar', 'close')]);
    expect(h.calls.load).toBe(0);
    expect(noBlocks(h)).toBe('0111');
  });

  it('written for the loaded character reloads the native view, whatever the case of the name', () => {
    const h = run([done('ALDENMAR', [OWN], 'c:/eq/')]);
    expect([h.calls.load, h.calls.native]).toEqual([1, true]);
  });

  it('another character that rewrote the shared zeal.ini reloads, with the file name in any case', () => {
    expect(run([done('Brackwyn', ['zeal.ini', 'UI_Brackwyn_pq.proj.ini'])]).calls.load).toBe(1);
    expect(run([done('Brackwyn', ['ZEAL.INI'])]).calls.load).toBe(1);
  });

  it('another character that wrote only its own files does not reload', () => {
    expect(run([done('Brackwyn', ['UI_Brackwyn_pq.proj.ini'])]).calls.load).toBe(0);
  });

  it('a bring-in into another EverQuest folder wrote nothing here', () => {
    expect(run([done('Aldenmar', [OWN], 'D:\\EQ2')]).calls.load).toBe(0);
  });

  it('no rows, empty rows and a done row with no files do not crash and behave as before', () => {
    expect(run(undefined).calls.load).toBe(1);
    expect(run([]).calls.load).toBe(0);
    expect(run([done('Aldenmar', [])]).calls.load).toBe(0);
    expect(run([{ character: 'Brackwyn', kind: 'done', files: [null, {}] }]).calls.load).toBe(0);
    expect(() => run([done('Brackwyn', ['zeal.ini'])], { bundle: null })).not.toThrow();
  });

  it('unsaved moves are kept: no reload, the move is still there, the status does not advise Load', () => {
    for (const rows of [[done('Aldenmar', [OWN])], [done('Brackwyn', ['zeal.ini'])]]) {
      const h = run(rows, {}, (S) => { S.windows[0].x = 99; });
      expect(h.calls.load).toBe(0);
      expect(h.STATE.windows[0].x).toBe(99);
      const msg = h.calls.status.map((s) => s[0]).join(' ');
      expect(msg).toMatch(/Save your moves first, then reload/);
      expect(msg).not.toMatch(/press Load/i);
      expect(h.calls.staleBtn).toBe('');           // the reload-after-confirm button is shown
    }
  });

  it('an unsaved Fit / Load + Rescale preview or a cloud-backup preview counts as unsaved changes', () => {
    // no window moved, but Save would write every window (all = rescale / cloud)
    const rescale = run([done('Brackwyn', ['zeal.ini'])], { srcSuffix: '2560x1440' });
    expect(rescale.calls.load).toBe(0);
    const cloud = run([done('Aldenmar', [OWN])], { fromCloud: true });
    expect(cloud.calls.load).toBe(0);
  });

  it('noBlock is cleared only for windows whose layout file was written for the loaded character in this folder', () => {
    const socialsOnly = run([done('Aldenmar', ['Socials_Aldenmar_pq.proj.ini'])], {}, (S) => { S.windows[0].x = 99; });
    expect(noBlocks(socialsOnly)).toBe('0111');
    const layout = run([done('Aldenmar', [OWN.toLowerCase()], 'C:\\EQ')], {}, (S) => { S.windows[0].x = 99; });
    expect(noBlocks(layout)).toBe('0000');
    const other = run([done('Brackwyn', ['zeal.ini', OWN])], {}, (S) => { S.windows[0].x = 99; });
    expect(noBlocks(other)).toBe('0111');
    const elsewhere = run([done('Aldenmar', [OWN], 'D:\\EQ2')], {}, (S) => { S.windows[0].x = 99; });
    expect(noBlocks(elsewhere)).toBe('0111');
  });
});

describe('guessed places are not saved over a bring-in that has not landed', () => {
  const guessCanvas = () => [win(OWN, 'A', true, { x: 11, origX: 11 }), win(OWN, 'B', false, { x: 99 })];

  it('with a bring-in queued for this character, the save drops the guessed edits and keeps the moves', async () => {
    const h = make({ windows: guessCanvas() });
    h.STATE.windows[1].origX = 10;                 // B was moved
    const built = h.api._buildSaveEdits();
    expect(built.edits.some((e) => e.guess)).toBe(true);
    h.setPending([{ character: 'aldenmar', eqDir: 'c:/eq', kind: 'restore' }]);
    expect(await h.api._restoreQueuedHere()).toBe(true);
    const kept = h.api._withoutGuesses(built);
    expect(kept.edits.length).toBeGreaterThan(0);
    expect(kept.edits.every((e) => !e.guess && e.section === 'B')).toBe(true);
    expect(kept.windows).toBe(1);
  });

  it('a queued restore for another character or folder, or a queued save, is not a bring-in waiting here', async () => {
    const h = make({ windows: guessCanvas() });
    h.setPending([{ character: 'Brackwyn', eqDir: 'C:\\EQ', kind: 'restore' }, { character: 'Aldenmar', eqDir: 'D:\\EQ2', kind: 'restore' },
      { character: 'Aldenmar', eqDir: 'C:\\EQ', kind: 'edits' }]);
    expect(await h.api._restoreQueuedHere()).toBe(false);
  });
});

describe('a Save that writes every window does not silently overwrite a queued bring-in', () => {
  it('asks when a bring-in is queued and the save writes every window; Cancel means nothing is saved', () => {
    const h = make({ windows: canvas(), srcSuffix: '2560x1440' });      // an unsaved Fit / rescale preview
    const built = h.api._buildSaveEdits();
    expect(built.all).toBe('rescale');
    h.answer(false);
    expect(h.api._confirmSaveOverQueued(built, true)).toBe(false);
    expect(h.asked[0]).toMatch(/Aldenmar is waiting to be written/);
    h.answer(true);
    expect(h.api._confirmSaveOverQueued(built, true)).toBe(true);
  });
  it('does not ask for an ordinary save, or when nothing is queued', () => {
    const h = make({ windows: canvas(), srcSuffix: '2560x1440' });
    h.answer(false);
    expect(h.api._confirmSaveOverQueued(h.api._buildSaveEdits(), false)).toBe(true);
    const plain = make({ windows: canvas() });
    plain.answer(false);
    expect(plain.api._confirmSaveOverQueued(plain.api._buildSaveEdits(), true)).toBe(true);
    expect(h.asked.length + plain.asked.length).toBe(0);
  });
  it('the Save button asks before the cloud-restore branch too', () => {
    const s = stripJs(html);
    const at = s.indexOf("getElementById('saveBtn').addEventListener");
    expect(s.indexOf('_confirmSaveOverQueued(built, waiting)', at)).toBeGreaterThan(0);
    expect(s.indexOf('_confirmSaveOverQueued(built, waiting)', at)).toBeLessThan(s.indexOf('_saveCloudRestore(built)', at));
  });
});

describe('windows the game leaves unplaced until they are opened', () => {
  const layoutInUse = () => {
    const ws = [];
    for (let i = 0; i < 10; i++) ws.push(win(OWN, 'Chat' + i, false));
    for (let i = 0; i < 6; i++) ws.push(win(OWN, 'BagBank' + i, true, { category: 'bank' }));
    for (let i = 0; i < 6; i++) ws.push(win(OWN, 'BagInv' + i, true, { category: 'bags' }));
    ws.push(win(OWN, 'MerchantWnd', true, { category: 'vendor' }));
    ws.push(win('zeal.ini', 'ZealItemDisplay3', true, { category: 'zeal' }));
    ws.push(win(OWN, 'ZealButtonWnd', true, { category: 'zeal' }));
    return ws;
  };

  it('do not make an in-use layout look made for another screen', () => {
    const h = make({ windows: layoutInUse() });
    expect(h.api._noPlaceCount()).toEqual({ missing: 0, total: 10, many: false });
  });

  it('real windows with no place still do', () => {
    const ws = layoutInUse();
    for (let i = 0; i < 5; i++) ws[i].noBlock = true;
    expect(make({ windows: ws }).api._noPlaceCount().many).toBe(true);
  });

  it('a scheduled save never writes a guess for them, even when many other windows have no place', async () => {
    const ws = layoutInUse();
    for (let i = 0; i < 5; i++) ws[i].noBlock = true;
    const h = make({ windows: ws });
    await h.api._queueDefer(h.api._buildSaveEdits());
    const sections = new Set(h.calls.defer[0].edits.map((e) => e.section));
    expect(sections.has('Chat0')).toBe(true);
    expect([...sections].filter((s) => /^(BagBank|BagInv|MerchantWnd|ZealItemDisplay|ZealButtonWnd)/.test(s))).toEqual([]);
  });
});

describe('the wiring', () => {
  const src = stripJs(html);
  it('the card no longer reloads from its own onDone: the main process says when a restore is written', () => {
    expect(src).toMatch(/mount\(document\.getElementById\('bringCard'\), \{ all: true, fresh: true \}\)/);
    expect(src).toMatch(/window\.mimic\.onUiStudioRestored\(function\(info\)/);
  });
  it('"Sort your chat channels" asks before it re-reads or switches the canvas', () => {
    const goto = src.slice(src.indexOf('onUiStudioGoto(function(goto)'), src.indexOf("getElementById('bringBtn')"));
    expect(goto.indexOf('_hasUnsavedEdits()')).toBeGreaterThan(0);
    expect(goto.indexOf('_hasUnsavedEdits()')).toBeLessThan(goto.indexOf('loadAndRescale(true)'));
  });
});
