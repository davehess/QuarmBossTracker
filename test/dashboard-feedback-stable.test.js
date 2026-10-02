// test/dashboard-feedback-stable.test.js — FB-47: "This send feedback section refreshes and we
// lose what we were ready to submit".
//
// The feedback card is built once, inside #dash. #dash was rewritten whenever its HTML changed,
// and it still carried the Recent Parses table inline, so every kill rewrote it and took the
// half-typed report with it. Recent Parses now fills its own card; #dash is placeholders only.
// The card also keeps the words, the kind and the pictures across a rebuild.
//
// Run: npx vitest run test/dashboard-feedback-stable.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const page = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const DASH = sliceBlock(page, 'function renderDash(s) {', "  setSectionHTML('dash', h);\n}");

function dashHtml(state) {
  const { run } = evalBlock(`
    let out = null;
    function setSectionHTML(id, h) { out = h; }
    function esc(x) { return String(x); }
    function fmtK(n) { return String(n); }
    ${DASH}
    function run(s) { renderDash(s); return out; }
  `, ['run']);
  return run(state);
}

describe('#dash does not change when a kill lands', () => {
  it('the same HTML before and after a new parse', () => {
    const before = dashHtml({ recentParses: [] });
    const after = dashHtml({ recentParses: [{ bossName: 'Vallon Zek', eventCount: 900, totalDamage: 123456, spellDotDamage: 7 }] });
    expect(after).toBe(before);
    expect(before).toContain('<div id="wpFeedback"></div>');
    expect(before).toContain('<div id="wpRecentParses" class="card"></div>');
  });
});

describe('a rebuilt feedback card comes back as it was', () => {
  const code = stripJs(page);
  it('the words typed so far', () => {
    expect(code).toMatch(/var _wpFbDraft = '';/);
    expect(code).toMatch(/fbText\.value = _wpFbDraft;\n\s+fbText\.addEventListener\('input', function \(\) \{ _wpFbDraft = fbText\.value; \}\);/);
  });
  it('the kind and the pictures', () => {
    const wire = sliceBlock(code, 'function _wpFbWire() {', '_wpFbRenderShots();');
    expect(wire).toMatch(/_wpFbSetKind\(_wpFbKind\);/);
    expect(wire).not.toMatch(/_wpFbSetKind\('bug'\)/);
  });
  it('a sent report clears the draft', () => {
    expect(code).toMatch(/if \(ta\) ta\.value = '';\n\s+_wpFbDraft = '';/);
  });
});
