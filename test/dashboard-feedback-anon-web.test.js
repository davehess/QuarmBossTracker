// test/dashboard-feedback-anon-web.test.js — the signed-out feedback card (the guild lead, 2026-10-08).
//
// A Mimic that is not signed in (local mode, no token) cannot send feedback to the guild, and its
// promise is that it makes NO calls to our server. So the card swaps Send for a button that opens the
// anonymous form on eqmimic.quest in the user's own browser, the words riding in the URL FRAGMENT.
//
// Behaviour over text: renderFeedback and the link builder are run for real; the only text assertions
// are comment-stripped.
//
// Run: npx vitest run test/dashboard-feedback-anon-web.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const page = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const RENDER = sliceBlock(page, 'function renderFeedback(s) {', '  _wpFbWire();\n}');
const LINK = sliceBlock(page, 'var WP_FB_WEB_MAX = 1800;', '    trimmed: trimmed,\n  };\n}');

function card(state) {
  const { run } = evalBlock(`
    var el = { _wpBuilt: false, innerHTML: '' };
    var document = { getElementById: function () { return el; } };
    var location = { hash: '' };
    function wpKeep() { return 'data-keep="x"'; }
    function _wpFbWire() {}
    var _wpFbVer = '';
    ${RENDER}
    function run(s) { renderFeedback(s); return el.innerHTML; }
  `, ['run']);
  return run(state);
}

it('signing in (or out) rebuilds the card; staying put does not', () => {
  const { run, poke } = evalBlock(`
    var el = { _wpBuilt: false, innerHTML: '' };
    var document = { getElementById: function () { return el; } };
    var location = { hash: '' };
    function wpKeep() { return ''; }
    function _wpFbWire() {}
    var _wpFbVer = '';
    ${RENDER}
    function run(s) { renderFeedback(s); return el.innerHTML; }
    function poke() { el.innerHTML = 'UNTOUCHED'; }
  `, ['run', 'poke']);
  expect(run({ localOnly: true })).toContain('wpFbWeb');
  poke();
  expect(run({ localOnly: true })).toBe('UNTOUCHED');   // same mode: not rebuilt over a half-typed report
  expect(run({ localOnly: false })).toContain('id="wpFbSend"');
  expect(run({ localOnly: true })).toContain('wpFbWeb');
});

const link = evalBlock(`${LINK}`, ['_wpFbWebUrl', 'WP_FB_WEB_MAX'])._wpFbWebUrl;

describe('the card, signed out (local mode)', () => {
  const html = card({ localOnly: true, version: '3.7.107' });
  it('offers the eqmimic.quest button and not Send', () => {
    expect(html).toContain('id="wpFbWeb"');
    expect(html).toContain('Send anonymously on eqmimic.quest');
    expect(html).not.toContain('id="wpFbSend"');
  });
  it('says what happens, and that no logs or screenshots go', () => {
    expect(html).toContain('Opens your browser. Nothing is sent until you press Send there.');
    expect(html).toContain('Leave your Discord name on the form if you want a reply.');
    expect(html).toMatch(/No logs or screenshots/);
  });
  it('drops the screenshot and log-slice controls it cannot honour', () => {
    expect(html).not.toContain('wpFbSnap');
    expect(html).not.toContain('wpFbPick');
    expect(html).not.toContain('wpFbAttach');
  });
});

describe('the card, signed in', () => {
  const html = card({ localOnly: false, version: '3.7.107' });
  it('keeps Send and has no eqmimic.quest path', () => {
    expect(html).toContain('<button type="button" id="wpFbSend">Send</button>');
    expect(html).not.toContain('wpFbWeb');
    expect(html).not.toContain('eqmimic.quest');
  });
  it('keeps screenshots and the log slice', () => {
    expect(html).toContain('id="wpFbSnap"');
    expect(html).toContain('id="wpFbAttachRow"');
    expect(html).toContain('id="wpFbPreview"');
  });
  it('a state with no localOnly at all is the signed-in card, byte for byte', () => {
    expect(card({ version: '3.7.107' })).toBe(html);
  });
});

describe('the link', () => {
  it('puts the words after # and never in a query string', () => {
    const { url } = link('bug', 'it broke & "burned"', '3.7.107', 'win');
    expect(url.startsWith('https://eqmimic.quest/feedback#cat=bug&text=')).toBe(true);
    expect(url).not.toContain('?');
    expect(url.split('#').length).toBe(2);
  });
  it('percent-encodes the text, so & and # in it cannot split the fragment', () => {
    const { url } = link('idea', 'a&b#c d', '3.7.107', 'linux');
    expect(url).toBe('https://eqmimic.quest/feedback#cat=idea&text=a%26b%23c%20d&v=3.7.107&p=linux');
  });
  it('anything but idea is a bug', () => {
    expect(link('whatever', 'x', '', '').url).toContain('#cat=bug&');
  });
  it('caps the text at 1800 characters and says it trimmed', () => {
    const long = link('bug', 'a'.repeat(1900), 'v', 'p');
    expect(long.trimmed).toBe(true);
    expect(long.url).toContain('text=' + 'a'.repeat(1800) + '&v=');
    expect(long.url).not.toContain('a'.repeat(1801));
    const exact = link('bug', 'a'.repeat(1800), 'v', 'p');
    expect(exact.trimmed).toBe(false);
  });
  it('never cuts a surrogate pair in half (encodeURIComponent would throw)', () => {
    const t = 'a'.repeat(1799) + '\u{1F43A}\u{1F43A}';
    const r = link('bug', t, 'v', 'p');
    expect(r.trimmed).toBe(true);
    expect(() => decodeURIComponent(r.url.split('text=')[1].split('&v=')[0])).not.toThrow();
  });
});

describe('the click', () => {
  const code = stripJs(page);
  it('routes wpFbWeb to the browser opener, and Send still routes to the engine', () => {
    expect(code).toMatch(/t\.id === 'wpFbWeb'\) \{ _wpFbWeb\(\); return; \}/);
    expect(code).toMatch(/t\.id === 'wpFbSend'\) \{ _wpFbSend\(\); return; \}/);
  });
  it('opens through Mimic\'s openExternal, falling back to a noopener tab', () => {
    const fn = sliceBlock(code, 'async function _wpFbWeb() {', "'✕ could not open your browser';\n}");
    expect(fn).toMatch(/window\.mimic\.openExternal\(link\.url\)/);
    expect(fn).toMatch(/window\.open\(link\.url, '_blank', 'noopener'\)/);
    expect(fn).not.toMatch(/fetch\(/);
  });
  it('the signed-out path makes no request to the engine or the server', () => {
    const fn = sliceBlock(code, 'async function _wpFbWeb() {', "'✕ could not open your browser';\n}");
    expect(fn).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/);
  });
});
