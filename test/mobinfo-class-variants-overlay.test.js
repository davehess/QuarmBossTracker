// test/mobinfo-class-variants-overlay.test.js — Mob Info shows the pair when a
// name is two classes (the bot side is test/mobinfo-class-variants.test.js).
//
// Hitya, 2026-09-15: Plane of Hate's forsaken revenants — male Magician,
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
const render = (mob) => new Function('mob', 'esc', block + '\nreturn cls;')(mob, (s) => String(s));

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
});
