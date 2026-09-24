// test/mobinfo-class-variants-overlay.test.js — Mob Info shows the pair when a
// name is two classes (the bot side is test/mobinfo-class-variants.test.js).
//
// The guild lead, 2026-09-15: Plane of Hate's forsaken revenants — male Magician,
// female Enchanter — showed as Magician for both. Runs the overlay's class
// line as a real function over a fake `mob` object.
//
// Run: npx vitest run test/mobinfo-class-variants-overlay.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const start = html.indexOf("    var cls = '';");
const end   = html.indexOf("    // Header strip", start);
if (start < 0 || end < 0) throw new Error('class line not found');
const block = html.slice(start, end);
// The block also reads `mi` (the Harm Touch chip, round seven) and `fmtSecs`.
const fmtSecsSrc = html.slice(html.indexOf('  function fmtSecs(s)'), html.indexOf('\n', html.indexOf('  function fmtSecs(s)')));
const render = (mob, mi = {}) => new Function('mob', 'esc', 'mi', fmtSecsSrc + '\n' + block + '\nreturn cls;')(mob, (s) => String(s), mi);

describe('Mob Info class line', () => {
  it('shows every class with its sex when the bodies disagree', () => {
    const out = render({ class: 'Magician', class_ambiguous: true,
      class_variants: [{ class: 'Magician', gender: 'male' }, { class: 'Enchanter', gender: 'female' }] });
    expect(out).toContain('Magician ♂ / Enchanter ♀');
  });
  it('shows the one class when there is no disagreement', () => {
    expect(render({ class: 'Warrior', class_ambiguous: false, class_variants: [{ class: 'Warrior', gender: 'male' }] })).toContain('(Warrior)');
    expect(render({ class: 'Warrior' })).toContain('(Warrior)');
    expect(render(null)).toBe('');
  });
  // Round seven (the guild lead, 2026-09-24): "Next to name (Shadow Knight) it
  // should say HT with a checkmark or HT with a red X and a timer".
  it('a Shadow Knight mob carries HT ✓, or HT ✗ with the time until it is back', () => {
    const sk = { class: 'Shadow Knight' };
    expect(render(sk, { target_npc_ht: { ready: true, ready_in_ms: 0 } })).toMatch(/\(Shadow Knight\)<\/span> <span class="ht ok"[^>]*>HT ✓<\/span>/);
    expect(render(sk, { target_npc_ht: { ready: false, ready_in_ms: 38 * 60_000 + 5000 } })).toMatch(/<span class="ht used"[^>]*>HT ✗ 38:05<\/span>/);
    expect(render(sk, {})).not.toContain('HT');                          // the agent sent none: nothing drawn
  });
});
