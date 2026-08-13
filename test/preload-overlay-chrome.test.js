// test/preload-overlay-chrome.test.js — who gets Mimic's injected chrome.
//
// preload.js injects a ⚙ (and, for panel windows, a ✕) into pages loaded over
// http. That was written when the agent DASHBOARD was the only http page Mimic
// ever loaded, so "protocol is http" was a fine proxy for "this is the
// dashboard".
//
// #65 broke the proxy: real overlays are now served BY the agent at
// /overlay/<name> so they ride agent hot-swaps. The Command Center inherited a
// gear that opened Mimic Settings from inside a raid overlay (Hitya,
// 2026-08-13) — and because /overlay/command carries no `?overlay=` query, it
// was even misdetected as the main window rather than as an overlay.
//
// Three audiences, three answers, and the middle one is the regression:
//   main dashboard          http://…/            -> inject (Settings gear)
//   agent-served overlay    http://…/overlay/x   -> inject NOTHING
//   panel window            http://…/?overlay=k  -> inject (Setup gear + ✕)
//
// Run: npx vitest run test/preload-overlay-chrome.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const PRELOAD = path.join(ROOT, 'apps', 'mimic', 'preload.js');
const src = fs.readFileSync(PRELOAD, 'utf8');

// Evaluate the real guard expression against a given URL rather than asserting
// on source text, so a rewrite that keeps the behaviour still passes.
function injects(url) {
  const u = new URL(url);
  const guard = src.match(
    /const _isAgentServedOverlay = ([^;]+);\s*\nif \(location\.protocol === 'http:' && !_isAgentServedOverlay\)/,
  );
  if (!guard) throw new Error('preload guard not found — did the injection condition change shape?');
  // eslint-disable-next-line no-new-func
  const isOverlay = new Function('location', `return ${guard[1]};`)(u);
  return u.protocol === 'http:' && !isOverlay;
}

describe('injected dashboard chrome', () => {
  it('goes on the main dashboard', () => {
    expect(injects('http://127.0.0.1:7777/')).toBe(true);
    expect(injects('http://localhost:7777/?tab=triggers')).toBe(true);
  });

  it('does NOT go on an agent-served overlay — the Command Center regression', () => {
    expect(injects('http://127.0.0.1:7777/overlay/command')).toBe(false);
  });

  it('stays off ANY future agent-served overlay, not just command', () => {
    // The point of fixing this on the path prefix rather than special-casing
    // 'command': the next overlay moved behind /overlay/ inherits the fix.
    expect(injects('http://127.0.0.1:7777/overlay/tank')).toBe(false);
    expect(injects('http://127.0.0.1:7777/overlay/chchain?x=1')).toBe(false);
  });

  it('still goes on panel windows, which have no chrome of their own', () => {
    // Load-bearing: testers hit panel overlays that opened full-window with no
    // way to close them, which is why the injected ✕ exists at all.
    expect(injects('http://127.0.0.1:7777/?overlay=melody')).toBe(true);
  });

  it('never touches file:// overlays', () => {
    expect(injects('file:///C:/mimic/command.html')).toBe(false);
  });
});

describe('the overlays that ship their own chrome', () => {
  const commandHtml = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'command.html'), 'utf8');

  it('command.html has its own move and hide buttons, so injected ones duplicate them', () => {
    expect(commandHtml).toMatch(/id="move-btn"/);
    expect(commandHtml).toMatch(/id="hide-btn"/);
  });

  it('and does not define a gear of its own', () => {
    expect(commandHtml).not.toMatch(/⚙/);
  });
});
