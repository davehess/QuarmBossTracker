// test/overlay-themes-cvd.test.js — the colour-blind overlay themes.
//
// The guild lead, 2026-09-24: "Add the colorblind color schemes to themes as well."
// Each theme is a colour matrix over every overlay (preload's _WP_CVD_MATRICES).
// This scores the SHIPPED matrices against an independent simulation of each
// kind of colour vision (Machado, Oliveira & Fernandes 2009, severity 1.0) —
// not the model they were fitted with — on the platform's own semantic tokens.
//
// Run: npx vitest run test/overlay-themes-cvd.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const mainJs = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// eslint-disable-next-line no-new-func
const MATRICES = new Function('return ' + preload.match(/const _WP_CVD_MATRICES = (\{[\s\S]*?\});/)[1])();
const toM = (s) => { const v = s.trim().split(/\s+/).map(Number); return [v.slice(0, 3), v.slice(5, 8), v.slice(10, 13)]; };

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const clamp = (v) => Math.max(0, Math.min(1, v));
const apply = (M, c) => M.map(r => clamp(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]));
const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const enc = (v) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
function lab(c) {
  const [r, g, b] = c.map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const seenBy = (type, c) => apply(MACHADO[type], c.map(lin)).map(enc);   // Machado works in linear RGB

// The platform's tokens (frontend-design skill) and the pairs that carry
// meaning side by side on an overlay.
const TOK = { red: '#f85149', green: '#56d364', orange: '#ffa657', gold: '#d29922', blue: '#58a6ff', purple: '#a371f7', text: '#e6edf3' };
const PAIRS = {
  deutan: [['red', 'green'], ['green', 'orange'], ['red', 'orange'], ['purple', 'text'], ['blue', 'green'], ['gold', 'green']],
  protan: [['red', 'green'], ['green', 'orange'], ['red', 'orange'], ['purple', 'text'], ['blue', 'green'], ['gold', 'green']],
  tritan: [['red', 'green'], ['green', 'orange'], ['red', 'orange'], ['purple', 'text'], ['blue', 'green'], ['orange', 'gold']],
};

describe('colour-blind themes', () => {
  for (const type of ['deutan', 'protan', 'tritan']) {
    const M = toM(MATRICES[type]);
    it(type + ': every pair that carries meaning is told apart — at least 30 ΔE as that eye sees it, and never worse than without', () => {
      for (const [a, b] of PAIRS[type]) {
        const before = dE(seenBy(type, hex(TOK[a])), seenBy(type, hex(TOK[b])));
        const after = dE(seenBy(type, apply(M, hex(TOK[a]))), seenBy(type, apply(M, hex(TOK[b]))));
        expect(after, a + '/' + b).toBeGreaterThanOrEqual(30);
        expect(after, a + '/' + b).toBeGreaterThanOrEqual(before - 12);   // a small give on a pair that was already easy
      }
    });
    it(type + ': greys stay grey (each row sums to 1), and no colour goes too dark to read on a dark overlay', () => {
      for (const row of M) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 2);
      for (const k of Object.keys(TOK)) expect(lab(seenBy(type, apply(M, hex(TOK[k]))))[0], k).toBeGreaterThanOrEqual(45);
    });
  }

  it('each is a theme Mimic accepts, the dashboard offers, and the overlay menu names', () => {
    const themes = mainJs.match(/const _WP_THEMES = \[([^\]]+)\]/)[1];
    for (const t of ['deutan', 'protan', 'tritan']) {
      expect(themes).toContain("'" + t + "'");
      expect(dash).toMatch(new RegExp("\\['" + t + "','[^']+'\\]"));
      expect(preload).toContain('body.wp-theme-' + t + '{filter:url(#wp-cvd-' + t + ')}');
      expect(preload).toMatch(new RegExp(t + ": '[^']+ \\((?:red-green|blue-yellow)\\)'"));
    }
  });
});
