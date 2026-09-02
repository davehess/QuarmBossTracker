// test/dashboard-setup-callout.test.js — the first-run checklist is findable.
//
// Hitya, 2026-09-02: "The main dashboard says Engine and is by default minimized
// where the setup is. We should callout that it's the setup for first time
// users."
//
// The five first-run checks (account linked, uploading on, logs found, in-game
// logging on, Zeal connected) lived inside a COLLAPSED panel named after our
// internals. The one person who most needed them — someone whose /log is off and
// who does not know it — had no reason to open a panel called "Engine".
//
// ⚠ THE TRAP THIS FILE EXISTS FOR: "open by default" must yield the instant the
// user expresses a preference. The dashboard repaints every ~2s, so a naive
// default-open re-opens the panel on every poll after someone closes it. That is
// worse than never opening it — it is a panel you cannot dismiss.
//
// Run: npx vitest run test/dashboard-setup-callout.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

// ⚠ dashboard.html is AUTHORITATIVE; WEB_HTML in the agent is its machine-folded
// copy. Assert against the source, and let check:dashboard prove the fold matches.
const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const src = readSource(DASH);

function build() {
  return evalBlock(
    'var _wpOpenDetails = {};\n'
    + 'function esc(v){ return String(v); }\n'
    + sliceBlock(src, 'function wpKeep(key, defaultOpen) {', '\n// ── The DOM write path')
    + '\nfunction setOpen(k, v){ _wpOpenDetails[k] = v; }',
    ['wpKeep', 'setOpen'],
  );
}
let h;
beforeEach(() => { h = build(); });

const isOpen = (attr) => / open$/.test(attr);

describe('the default-open contract', () => {
  it('opens when asked and untouched — the first-run case', () => {
    expect(isOpen(h.wpKeep('engine', true))).toBe(true);
  });

  it('stays shut when nothing needs doing', () => {
    expect(isOpen(h.wpKeep('engine', false))).toBe(false);
  });

  // ⚠ The whole point. Closing it must stick across every later repaint.
  it('STAYS CLOSED once the user closes it, even while still defaulting open', () => {
    h.setOpen('engine', false);
    expect(isOpen(h.wpKeep('engine', true))).toBe(false);
  });

  it('stays open once the user opens it, even when the default is closed', () => {
    h.setOpen('engine', true);
    expect(isOpen(h.wpKeep('engine', false))).toBe(true);
  });

  // Every other <details> on the dashboard calls wpKeep with one argument.
  it('is closed by default when no default is passed at all', () => {
    expect(isOpen(h.wpKeep('somethingElse'))).toBe(false);
  });

  it('always emits the data-keep attribute the build check requires', () => {
    for (const a of [h.wpKeep('k'), h.wpKeep('k', true), h.wpKeep('k', false)]) {
      expect(a).toContain('data-keep="k"');
    }
  });
});

describe('the Setup panel', () => {
  const dash = stripJs(src);

  it('is called Setup, not Engine', () => {
    expect(dash).toContain('⚙ Setup');
    expect(dash).not.toContain('⚙ Engine');
  });

  it('defaults open only while a check is outstanding', () => {
    expect(dash).toContain("wpKeep('engine', _todo > 0)");
  });

  // Legible without opening it — the count is the callout.
  it('shows the outstanding count in the summary', () => {
    expect(dash).toContain("_todo + ' to finish");
  });

  it('says ready rather than nothing when setup is complete', () => {
    const fn = sliceBlock(dash, 'function renderEngine(s) {', '\n  morphInto(el, h);');
    expect(fn).toMatch(/✓ ready/);
  });

  // ⚠ One source for the checks. A second copy would let the badge disagree
  // with the list under it, which is worse than having no badge.
  it('counts from the same rows the checklist renders', () => {
    expect(dash).toContain('const _rows = _setupCheckRows(s);');
    const checks = sliceBlock(dash, 'function renderSetupChecks(s) {', '\n  const rows = _setupCheckRows(s);');
    expect(checks).not.toContain('mimicSignedIn');   // the rows are built in the shared helper
  });

  // The store key stays 'engine' on purpose: renaming it would reset the
  // open/closed preference of everyone who already set one.
  it('keeps the original store key so existing preferences survive', () => {
    expect(dash).toContain("wpKeep('engine'");
  });
});
