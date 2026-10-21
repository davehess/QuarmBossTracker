// Mimic's Feedback form as its own window (the guild lead, 2026-10-15, option A).
//
// Why: the form lived inside the agent dashboard page, and Mimic reloads that page for reasons the
// reporter never causes (agent restart or hot-swap -> navigateToDashboard, port drift, the self-heal
// reload), wiping a half-typed report. The form now opens in a plain Mimic window that loads the same
// dashboard page as /?feedback=1 (the one card, nothing else rendered), and the draft also lives in
// localStorage so even a reload of that window keeps it.
//
// Run: npx vitest run test/feedback-popup.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const dashRaw = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const mainRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preloadRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
// Comments stripped before any text assertion (CLAUDE.md "comments satisfy text assertions"). The
// raw sources are only used where a slice anchor is itself code.
const dash = stripJs(dashRaw);
const main = stripJs(mainRaw);
const preload = stripJs(preloadRaw);

describe('feedback mode is switched on by ?feedback=1 and nothing else', () => {
  const { _wpFbModeFromSearch } = evalBlock(
    sliceBlock(dash, 'function _wpFbModeFromSearch(search) {', '\n}'), ['_wpFbModeFromSearch']);
  it('matches the query the Mimic window loads', () => {
    expect(_wpFbModeFromSearch('?feedback=1')).toBe(true);
    expect(_wpFbModeFromSearch('?x=2&feedback=1')).toBe(true);
    expect(_wpFbModeFromSearch('?feedback=1&x=2')).toBe(true);
  });
  it('does not match look-alikes or the other modes', () => {
    expect(_wpFbModeFromSearch('')).toBe(false);
    expect(_wpFbModeFromSearch(undefined)).toBe(false);
    expect(_wpFbModeFromSearch('?feedback=10')).toBe(false);
    expect(_wpFbModeFromSearch('?feedback=0')).toBe(false);
    expect(_wpFbModeFromSearch('?overlay=feedback')).toBe(false);
    expect(_wpFbModeFromSearch('?myfeedback=1')).toBe(false);
  });
});

describe('feedback mode renders ONLY the card', () => {
  it('refresh() narrows the section list to the feedback renderer before the loop runs', () => {
    const between = sliceBlock(dash, 'var _sections = [', 'for (var _si = 0;');
    expect(between).toContain("if (WP_FEEDBACK_MODE) _sections = [['feedback', renderFeedback]];");
  });
  it('the card host is created under <body> because renderDash never runs', () => {
    const boot = sliceBlock(dash, 'if (WP_FEEDBACK_MODE) {\n  document.body.classList.add', '\n}');
    expect(boot).toContain("document.body.classList.add('wp-feedback-mode')");
    expect(boot).toContain("_wpFbHost.id = 'wpFeedback'");
    expect(boot).toContain('document.body.appendChild(_wpFbHost)');
  });
  it('CSS hides every other child of <body>, keeping the card and the engine-down banner', () => {
    const css = stripCss(dashRaw);
    expect(css).toMatch(/body\.wp-feedback-mode > \*:not\(#wpFeedback\):not\(#wpConnError\):not\(script\):not\(style\) \{ display:none !important; \}/);
  });
  it('the card opens itself (the #feedback hash it already honours) and takes focus in this mode', () => {
    const boot = sliceBlock(dash, 'if (WP_FEEDBACK_MODE) {\n  document.body.classList.add', '\n}');
    expect(boot).toContain("history.replaceState(null, '', location.pathname + location.search + '#feedback')");
    const fn = sliceBlock(dash, 'function renderFeedback(s) {', '\n}\n');
    expect(fn).toContain("(location.hash || '').toLowerCase() === '#feedback'");
    expect(fn).toContain("wpKeep('feedback', _fbWanted)");
    const wire = sliceBlock(dash, 'function _wpFbWire() {', '\n}\n');
    expect(wire).toContain('if (fbText && WP_FEEDBACK_MODE) { try { fbText.focus(); }');
  });
  it('the dashboard self-heal reload does not run in the popup', () => {
    expect(dash).toContain('if (_refreshFailures >= 15 && !WP_FEEDBACK_MODE) {');
  });
});

describe('the draft survives a reload of the window (localStorage)', () => {
  const block = sliceBlock(dash, "var WP_FB_DRAFT_KEY = 'wpFeedbackDraft';",
    "else localStorage.setItem(WP_FB_DRAFT_KEY, JSON.stringify({ text: _wpFbDraft, kind: _wpFbKind }));\n  } catch (e) { void e; }\n}");
  function make(store, opts = {}) {
    const localStorage = opts.throwing
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    return new Function('localStorage', `
      var _wpFbDraft = ${JSON.stringify(opts.draft || '')};
      var _wpFbKind = ${JSON.stringify(opts.kind || 'bug')};
      ${block}
      return { load: _wpFbDraftLoad, save: _wpFbDraftSave,
        get draft() { return _wpFbDraft; }, set draft(v) { _wpFbDraft = v; },
        get kind() { return _wpFbKind; }, set kind(v) { _wpFbKind = v; } };
    `)(localStorage);
  }
  it('saves text and kind, and a fresh page load gets both back', () => {
    const store = {};
    const a = make(store);
    a.draft = 'the trigger window froze'; a.kind = 'idea'; a.save();
    expect(JSON.parse(store.wpFeedbackDraft)).toEqual({ text: 'the trigger window froze', kind: 'idea' });
    const b = make(store);          // the reloaded page: empty memory, same storage
    b.load();
    expect(b.draft).toBe('the trigger window froze');
    expect(b.kind).toBe('idea');
  });
  it('an empty draft clears the stored one (what a successful send does)', () => {
    const store = { wpFeedbackDraft: JSON.stringify({ text: 'x', kind: 'bug' }) };
    const a = make(store); a.draft = ''; a.save();
    expect('wpFeedbackDraft' in store).toBe(false);
  });
  it('ignores a corrupt or hostile stored value', () => {
    const a = make({ wpFeedbackDraft: '{not json' }); a.load();
    expect(a.draft).toBe('');
    const b = make({ wpFeedbackDraft: JSON.stringify({ text: 'ok', kind: 'evil' }) }); b.load();
    expect(b.draft).toBe('ok');
    expect(b.kind).toBe('bug');
    const c = make({ wpFeedbackDraft: JSON.stringify({ text: 'y'.repeat(9000) }) }); c.load();
    expect(c.draft.length).toBe(4000);
  });
  it('blocked storage never throws (private window, cleared site data)', () => {
    const a = make({}, { throwing: true, draft: 'hello there' });
    expect(() => { a.load(); a.save(); }).not.toThrow();
    expect(a.draft).toBe('hello there');
  });
  it('is wired: typing saves, a kind change saves, the build loads, a successful send clears', () => {
    const wire = sliceBlock(dash, 'function _wpFbWire() {', '\n}\n');
    expect(wire).toContain("if (!_wpFbDraft) _wpFbDraftLoad();");
    expect(wire).toContain("fbText.addEventListener('input', _wpFbDraftSave);");
    // load must come before the kind and the text are put back on the card
    expect(wire.indexOf('_wpFbDraftLoad()')).toBeLessThan(wire.indexOf('_wpFbSetKind(_wpFbKind)'));
    expect(wire.indexOf('_wpFbDraftLoad()')).toBeLessThan(wire.indexOf('fbText.value = _wpFbDraft'));
    const kind = sliceBlock(dash, 'function _wpFbSetKind(k) {', "\n  var b = document.getElementById('wpFbBug')");
    expect(kind).toContain('_wpFbDraftSave();');
    const send = sliceBlock(dash, 'async function _wpFbSend() {', '\n}\n');
    expect(send).toMatch(/_wpFbDraft = '';\n\s+_wpFbDraftSave\(\);/);
  });
});

describe('after a send in the popup the result stays up and offers Close', () => {
  const send = sliceBlock(dash, 'async function _wpFbSend() {', '\n}\n');
  it('adds one Close button that closes the window, only in feedback mode', () => {
    expect(send).toContain("if (WP_FEEDBACK_MODE && msg && msg.parentNode && !document.getElementById('wpFbClose')) {");
    expect(send).toContain("closeBtn.addEventListener('click', function () { try { window.close(); }");
  });
  it('sits inside the success branch, not the failure one', () => {
    expect(send.indexOf("id = 'wpFbClose'")).toBeLessThan(send.indexOf("'✕ ' + ((j && j.reason)"));
    expect(send.indexOf("'✓ sent'")).toBeLessThan(send.indexOf("id = 'wpFbClose'"));
  });
});

describe('the dashboard 💬 button prefers the Mimic window', () => {
  it('the button calls wpFeedbackClick, not the in-page opener directly', () => {
    expect(dash).toMatch(/id="wpFbBtn"[^>]*onclick="wpFeedbackClick\(\)"/);
    expect(dash).not.toMatch(/id="wpFbBtn"[^>]*onclick="wpOpenFeedback\(\)"/);
  });
  function click(win) {
    const calls = [];
    const { wpFeedbackClick } = new Function('window', 'wpOpenFeedback', `
      ${sliceBlock(dash, 'function wpFeedbackClick() {', '\n}\n')}
      return { wpFeedbackClick };
    `)(win, () => calls.push('inpage'));
    wpFeedbackClick();
    return calls;
  }
  it('uses window.mimic.openFeedback when it exists and the in-page card stays closed', async () => {
    const opened = [];
    const calls = click({ mimic: { openFeedback: () => { opened.push(1); return Promise.resolve(true); } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual([1]);
    expect(calls).toEqual([]);
  });
  it('falls back to the in-page card when Mimic answers false or rejects', async () => {
    const a = click({ mimic: { openFeedback: () => Promise.resolve(false) } });
    const b = click({ mimic: { openFeedback: () => Promise.reject(new Error('x')) } });
    await new Promise((r) => setTimeout(r, 0));
    expect(a).toEqual(['inpage']);
    expect(b).toEqual(['inpage']);
  });
  it('a plain browser, or a Mimic without the bridge, opens the in-page card', () => {
    expect(click({})).toEqual(['inpage']);
    expect(click({ mimic: {} })).toEqual(['inpage']);
  });
});

describe('Mimic main process', () => {
  const fn = sliceBlock(main, 'function openFeedback() {', "feedbackWindow.on('closed', () => { feedbackWindow = null; });\n  return true;\n}");
  it('has an open-feedback IPC handler that returns the opener result', () => {
    expect(main).toContain("ipcMain.handle('open-feedback', () => openFeedback());");
  });
  it('loads the dashboard in feedback mode on the live agent port', () => {
    expect(fn).toContain('`http://127.0.0.1:${agentPort}/?feedback=1`');
    expect(fn).toContain('feedbackWindow.loadURL(url)');
  });
  it('is a singleton plain window: normal frame, resizable, titled, own prefs', () => {
    expect(fn).toContain('if (feedbackWindow && !feedbackWindow.isDestroyed()) {');
    expect(fn).toContain('resizable: true');
    expect(fn).toContain("title: 'Raid Mimic — Feedback'");
    expect(fn).toContain("webPreferences: _wpPrefs('Feedback')");
    expect(fn).not.toMatch(/frame:\s*false|transparent|alwaysOnTop|setIgnoreMouseEvents/);
  });
  it('returns false without an agent port so callers can fall back', () => {
    expect(fn).toContain('if (!agentPort) return false;');
  });
  it('is not an overlay: absent from _overlayEntries and _HIDEALL_FLAGS', () => {
    const entries = stripJs(sliceBlock(mainRaw, 'function _overlayEntries() {', '\n}\n'));
    const flags = stripJs(sliceBlock(mainRaw, 'const _HIDEALL_FLAGS = [', '\n];'));
    expect(entries).not.toMatch(/feedbackWindow/);
    expect(flags).not.toMatch(/[Ff]eedback/);
  });
  it('the tray item opens the window, keeping the browser route only as the fallback', () => {
    const tray = sliceBlock(main, "label: 'Send feedback — bug or idea',", '},');
    expect(tray).toContain('if (!openFeedback()) shell.openExternal(');
    expect(tray).toContain('/#feedback');
  });
  it('the screenshot capture fades the window that asked, so it works from this one', () => {
    const cap = sliceBlock(main, "ipcMain.handle('capture-screens', async (e) => {", 'setOpacity(0)');
    expect(cap).toContain('BrowserWindow.fromWebContents(e.sender)');
  });
});

describe('preload bridge', () => {
  it('exposes openFeedback over the open-feedback channel', () => {
    expect(preload).toContain("openFeedback:        ()         => ipcRenderer.invoke('open-feedback'),");
  });
});
