// test/dashboard-pop-capture.test.js — the dashboard's "Capture latest PoP flags, Seer and Maelin messages" card
// (the guild lead, 2026-10-26). The agent half (route, guard, reader) is in test/pop-rescan-agent.test.js; this is the
// page: where the card sits, that it paints into its own placeholder, that its controls are byte-stable while progress
// ticks, and what it says. The functions are the SHIPPED ones, sliced out of dashboard.html and run.
//
// Run: npx vitest run test/dashboard-pop-capture.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));

// wpPcDaysSet … wpPcProgHtml (everything before wpPcRepaint), with the neighbours' helpers it calls.
const card = sliceBlock(dash, 'function wpPcDaysSet(el) {', 'function wpPcRepaint() {').slice(0, -'function wpPcRepaint() {'.length);
const helpers = sliceBlock(dash, 'function wpRbNum(n) {', '\n') + sliceBlock(dash, 'function wpRbSize(b) {', '\n');
function load() {
  const prelude = "const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n"
    + "var _wpPc = { status: null, at: 0, busy: false, character: '', days: 14, note: '' };\n";
  return evalBlock(prelude + helpers + card, ['_wpPc', 'wpPcCtlHtml', 'wpPcProgHtml', 'wpPcSummary', 'wpPcDaysSet']);
}
const idle = (extra = {}) => ({ ok: true, running: false, by: null, queued: 0, upload: { upload: true, why: null }, maxDays: 60, defaultDays: 14,
  characters: [{ name: 'Aldenmar', excluded: false }, { name: 'Brackwyn', excluded: false }, { name: 'Rethlan', excluded: true }], run: null, ...extra });
const run = (o = {}) => ({ by: 'local', state: 'done', character: null, current: null, error: null, startedAt: 1_780_000_000_000, finishedAt: 1_780_000_060_000, days: 14,
  files: 3, filesDone: 3, excluded: [], bytesRead: 12 * 1048576, found: 12, logs: 3, sent: 12, upload: true, why: null, ...o });

describe('where the card sits', () => {
  it('under Rebuild on the Logsync tab, in its own placeholder, filled by its own renderer', () => {
    expect(dash).toMatch(/<div id="wpRebuild" class="card wide"><\/div>';\n\s*h \+= '<div id="wpPopCapture" class="card wide"><\/div>';/);
    expect(dash).toMatch(/\['rebuild', renderRebuildCard\], \['raidcode', renderRaidCodeCard\], \['popcapture', renderPopCaptureCard\],/);
  });
  it('the Logsync section repaint puts the card back, since the placeholder it emits is empty', () => {
    expect(stripJs(dash)).toMatch(/if \(!setSectionHTML\('optin', h\)\) return;[^]*?try \{ wpPcRepaint\(\); \} catch/);
  });
  it('the section HTML that emits the placeholder holds nothing volatile of the card (byte-stable)', () => {
    const emit = dash.slice(dash.indexOf('<div id="wpPopCapture"'), dash.indexOf('<div id="wpPopCapture"') + 120);
    expect(emit).toMatch(/^<div id="wpPopCapture" class="card wide"><\/div>/);
  });
  it('paints into two children so a progress tick never rebuilds the controls', () => {
    const rep = sliceBlock(stripJs(dash), 'function wpPcRepaint() {', '\n}\n');
    expect(rep).toMatch(/id="wpPcCtl"[^]*id="wpPcProg"/);
    expect(rep).toMatch(/morphInto\(document\.getElementById\('wpPcCtl'\), wpPcCtlHtml\(\)\)/);
    expect(rep).toMatch(/morphInto\(document\.getElementById\('wpPcProg'\), wpPcProgHtml\(\)\)/);
  });
  it('talks to exactly the two local routes, and never puts class="name" on a cell, or a <details> in the card', () => {
    const all = card + sliceBlock(dash, 'function wpPcRepaint() {', 'function wpPcStart() {');
    expect(all).toMatch(/fetch\('\/api\/local\/pop-rescan\/status'/);
    expect(dash).toMatch(/fetch\('\/api\/local\/pop-rescan', \{ method: 'POST'/);
    expect(all).not.toMatch(/class="name"/);
    expect(all).not.toMatch(/<details/);
  });
  it('polls only while the Logsync tab is open (10 s idle, 2 s running) and not twice at once', () => {
    const poll = sliceBlock(stripJs(dash), 'function wpPcPoll(force) {', '\n}\n');
    expect(poll).toMatch(/if \(_wpPc\.busy\) return;/);
    expect(poll).toMatch(/getElementById\('optin'\)[^]*classList\.contains\('active'\)/);
    expect(poll).toMatch(/running \? 1900 : 10000/);
  });
});

describe('the controls', () => {
  it('idle: the button, a character picker with every character (kept-out ones greyed), days 1..60', () => {
    const { _wpPc, wpPcCtlHtml } = load();
    _wpPc.status = idle();
    const h = wpPcCtlHtml();
    expect(h).toContain('📥 Capture latest PoP flags, Seer and Maelin messages');
    expect(h).not.toMatch(/id="wpPcGo"[^>]*disabled/);
    expect(h).toContain('All my characters (3)');
    expect(h).toMatch(/<option value="Aldenmar">Aldenmar<\/option>/);
    expect(h).toMatch(/<option value="Rethlan" disabled>Rethlan \(kept out of stats\)<\/option>/);
    expect(h).toMatch(/id="wpPcDays" min="1" max="60" step="1" value="14"/);
  });
  it('running (either the button\'s run or the website\'s): button, picker and days are all disabled', () => {
    const { _wpPc, wpPcCtlHtml } = load();
    for (const by of ['local', 'website']) {
      _wpPc.status = idle({ running: true, by });
      const h = wpPcCtlHtml();
      expect(h).toMatch(/id="wpPcGo"[^>]*disabled/);
      expect(h).toMatch(/id="wpPcChar" disabled/);
      expect(h).toMatch(/id="wpPcDays"[^>]*disabled/);
      expect(h).toContain('⏳ Reading…');
    }
  });
  it('no logs at all: the button is disabled', () => {
    const { _wpPc, wpPcCtlHtml } = load();
    _wpPc.status = idle({ characters: [] });
    expect(wpPcCtlHtml()).toMatch(/id="wpPcGo"[^>]*disabled/);
  });
  it('the controls are byte-identical across progress ticks (only the progress child changes)', () => {
    const { _wpPc, wpPcCtlHtml, wpPcProgHtml } = load();
    _wpPc.status = idle({ running: true, by: 'local', run: run({ state: 'running', filesDone: 0, bytesRead: 100, found: 0, current: 'Aldenmar' }) });
    const a = wpPcCtlHtml(); const pa = wpPcProgHtml();
    _wpPc.status = idle({ running: true, by: 'local', run: run({ state: 'running', filesDone: 2, bytesRead: 9_000_000, found: 7, current: 'Brackwyn' }) });
    expect(wpPcCtlHtml()).toBe(a);
    expect(wpPcProgHtml()).not.toBe(pa);
  });
  it('the same status paints the same HTML twice (nothing in it reads the clock)', () => {
    const { _wpPc, wpPcCtlHtml, wpPcProgHtml } = load();
    _wpPc.status = idle({ run: run() });
    expect([wpPcCtlHtml(), wpPcProgHtml()]).toEqual([wpPcCtlHtml(), wpPcProgHtml()]);
  });
  it('local mode / paused is said before the click', () => {
    const { _wpPc, wpPcCtlHtml } = load();
    _wpPc.status = idle({ upload: { upload: false, why: 'local mode' } });
    expect(wpPcCtlHtml()).toContain('This agent is in local mode: the lines are read and counted here, and nothing is uploaded.');
    _wpPc.status = idle({ upload: { upload: false, why: 'paused' } });
    expect(wpPcCtlHtml()).toContain('This agent is paused by the guild: the lines are read and counted here, and nothing is uploaded.');
  });
  it('days entry is clamped to the server\'s range and the default', () => {
    const { _wpPc, wpPcDaysSet } = load();
    _wpPc.status = idle();
    for (const [typed, want] of [['30', 30], ['0', 1], ['500', 60], ['-3', 1], ['abc', 14], ['', 14]]) {
      const el = { value: typed };
      wpPcDaysSet(el);
      expect(_wpPc.days, typed).toBe(want);
      expect(el.value).toBe(String(want));
    }
  });
});

describe('what it says', () => {
  it('the result line: read N logs · M flag lines found · uploaded', () => {
    const { wpPcSummary } = load();
    expect(wpPcSummary(run())).toBe('read 3 logs · 12 flag lines found · uploaded');
    expect(wpPcSummary(run({ logs: 1, found: 1 }))).toBe('read 1 log · 1 flag line found · uploaded');
    expect(wpPcSummary(run({ sent: 0, found: 0 }))).toBe('read 3 logs · 0 flag lines found · nothing new to upload');
  });
  it('not uploaded, with the reason, when the agent is in local mode or paused', () => {
    const { wpPcSummary } = load();
    expect(wpPcSummary(run({ upload: false, why: 'local mode', sent: 0 }))).toBe('read 3 logs · 12 flag lines found · not uploaded (local mode)');
    expect(wpPcSummary(run({ upload: false, why: 'paused', sent: 0 }))).toBe('read 3 logs · 12 flag lines found · not uploaded (paused)');
  });
  it('no log read is said plainly', () => {
    const { wpPcSummary } = load();
    expect(wpPcSummary(run({ logs: 0, found: 0, sent: 0 }))).toBe('Could not read any log.');
  });
  it('progress, done, error, a website run, and the kept-out names', () => {
    const { _wpPc, wpPcProgHtml } = load();
    _wpPc.status = idle({ run: run({ state: 'running', current: 'Aldenmar', filesDone: 1, files: 3, found: 5 }) });
    const r = wpPcProgHtml();
    expect(r).toContain('Reading Aldenmar · log 2 of 3');
    expect(r).toContain('12.0MB read · 5 flag lines so far');
    _wpPc.status = idle({ run: run({ excluded: ['Rethlan'] }) });
    const d = wpPcProgHtml();
    expect(d).toContain('✓ read 3 logs · 12 flag lines found · uploaded');
    expect(d).toContain('Skipped, kept out of stats: Rethlan');
    _wpPc.status = idle({ run: run({ state: 'error', error: 'boom' }) });
    expect(wpPcProgHtml()).toContain('⚠ Stopped: boom');
    _wpPc.status = idle({ run: run({ by: 'website' }) });
    expect(wpPcProgHtml()).toContain('The website asked for this one.');
    _wpPc.status = idle();
    expect(wpPcProgHtml()).toContain('Nothing captured yet.');
    _wpPc.status = { error: true };
    expect(wpPcProgHtml()).toContain('The agent did not answer.');
  });
  it('an unknown name in the list cannot break out of the markup', () => {
    const { _wpPc, wpPcCtlHtml, wpPcProgHtml } = load();
    _wpPc.status = idle({ characters: [{ name: '<b>"x"', excluded: false }], run: run({ excluded: ['<i>'] }) });
    expect(wpPcCtlHtml()).not.toMatch(/<b>"x"/);
    expect(wpPcProgHtml()).not.toContain('<i>');
  });
});

describe('the embedded copy', () => {
  it('index.js carries the card (the dashboard was synced into WEB_HTML)', () => {
    expect(agent).toContain('id="wpPopCapture"');
    expect(agent).toContain('function wpPcStart()');
    expect(fs.existsSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'))).toBe(true);
  });
});
