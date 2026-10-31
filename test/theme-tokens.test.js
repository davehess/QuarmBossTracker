// test/theme-tokens.test.js — the website's colours come from ONE token file, and the count of strays only shrinks.
//
// docs/DESIGN-theming.md §2/§7: web/app/tokens.css holds the --wp-* slots (RGB triplets, seeded with today's hex),
// tailwind.config.ts maps every colour NAME to rgb(var(--wp-<name>) / <alpha-value>), and globals.css names no raw
// colour. A guild theme later overrides the variables and nothing else; a hex literal left in a component is a place the
// theme cannot reach, so the number of them is a ratchet.
//
// Every check is a pure function of a source string, and the last describe block runs each one against a deliberately
// broken copy: a ratchet that is never seen to fail guards nothing (CLAUDE.md, "comments satisfy text assertions").
// Comments are stripped before matching: this repo's comments quote the very hex values being counted.
//
// Run: npx vitest run test/theme-tokens.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripCss } from './_source-slice.js';

const WEB = path.join(ROOT, 'web');
const read = (...p) => fs.readFileSync(path.join(WEB, ...p), 'utf8');

// docs/DESIGN-theming.md §2. The colours Tailwind names, and the non-colour slots the site seeds.
const COLOURS = ['bg', 'panel', 'border', 'text', 'dim', 'blue', 'gold', 'green', 'red', 'orange', 'purple', 'accent'];
const OTHER_SLOTS = ['radius', 'font-mono', 'font-ui'];

// Raw hex colour literals outside tokens.css and the raidmimic landing pages (they keep their own off-white and navy).
// 3-8 hex digits, the same pattern the task names; it also catches the odd `#abc` that is not a colour, which is fine
// for a number that only has to not grow.
// BASELINE measured 2026-10-31 on beta with globals.css already clean. Lower it when it shrinks; never raise it.
const HEX_BASELINE = 1025;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

// ── checks (pure, so the mutation block below can feed them broken input) ──
export const slotsMissing = (tokensCss) => {
  const body = stripCss(tokensCss);
  return [...COLOURS, ...OTHER_SLOTS].filter(n => !new RegExp(`--wp-${n}\\s*:\\s*\\S`).test(body));
};
// A colour slot must be an RGB triplet, never a hex, or Tailwind's alpha utilities (`bg-accent/20`) break.
export const slotsNotTriplets = (tokensCss) => {
  const body = stripCss(tokensCss);
  return COLOURS.filter(n => !new RegExp(`--wp-${n}\\s*:\\s*\\d{1,3}\\s+\\d{1,3}\\s+\\d{1,3}\\s*;`).test(body));
};
export const coloursUnmapped = (configTs) => {
  const body = stripJs(configTs);
  return COLOURS.filter(n => !new RegExp(`\\b${n}:\\s*'rgb\\(var\\(--wp-${n}\\) / <alpha-value>\\)'`).test(body));
};
export const hexIn = (css) => stripCss(css).match(HEX) || [];
export const hexInSource = (src) => stripJs(src).match(HEX) || [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(full, out);
    } else if (/\.(tsx?|css)$/.test(e.name)) out.push(full);
  }
  return out;
}
const LANDING = path.join(WEB, 'app', 'raidmimic', '_landing') + path.sep;
const TOKENS = path.join(WEB, 'app', 'tokens.css');
export function countStrayHex() {
  let total = 0;
  const byFile = {};
  for (const dir of ['app', 'components']) {
    for (const f of walk(path.join(WEB, dir))) {
      if (f === TOKENS || f.startsWith(LANDING)) continue;
      const src = fs.readFileSync(f, 'utf8');
      const n = (f.endsWith('.css') ? hexIn(src) : hexInSource(src)).length;
      if (n) { byFile[path.relative(ROOT, f)] = n; total += n; }
    }
  }
  return { total, byFile };
}

describe('the site token layer', () => {
  it('(a) tokens.css defines every §2 slot, and the colours are RGB triplets', () => {
    const css = read('app', 'tokens.css');
    expect(slotsMissing(css)).toEqual([]);
    expect(slotsNotTriplets(css)).toEqual([]);
  });

  it('(b) tailwind.config.ts resolves every colour name to rgb(var(--wp-<name>) / <alpha-value>)', () => {
    expect(coloursUnmapped(read('tailwind.config.ts'))).toEqual([]);
  });

  it('(c) globals.css names no raw hex colour (they live in tokens.css)', () => {
    expect(hexIn(read('app', 'globals.css'))).toEqual([]);
  });

  it('(c) globals.css loads tokens.css before Tailwind', () => {
    const css = stripCss(read('app', 'globals.css'));
    const at = css.indexOf("@import './tokens.css'");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(css.indexOf('@tailwind base'));
  });

  it('(d) raw hex literals outside tokens.css and the raidmimic landing only shrink', () => {
    const { total, byFile } = countStrayHex();
    // Printed so the next person lowering the baseline sees where the strays are.
    console.log(`[theme-tokens] stray hex literals: ${total} (baseline ${HEX_BASELINE})`, byFile);
    expect(total).toBeLessThanOrEqual(HEX_BASELINE);
  });

  it('the root layout carries the data-theme hook', () => {
    expect(stripJs(read('app', 'layout.tsx'))).toMatch(/<html lang="en" data-theme="guild"/);
  });
});

// Each check is fed a broken copy and must notice. If one of these goes green on its own, the real assertion above it
// has stopped guarding anything.
describe('mutation: the checks see a broken input', () => {
  const tokens = () => read('app', 'tokens.css');
  const config = () => read('tailwind.config.ts');

  it('(a) a deleted slot is reported', () => {
    const broken = tokens().replace(/^\s*--wp-gold:.*$/m, '');
    expect(slotsMissing(broken)).toEqual(['gold']);
  });
  it('(a) a slot that only appears in a comment is still missing', () => {
    const broken = tokens().replace(/^\s*--wp-red:.*$/m, '/* --wp-red: 248 81 73; */');
    expect(slotsMissing(broken)).toEqual(['red']);
  });
  it('(a) a hex colour slot is rejected (it would break bg-accent/20)', () => {
    const broken = tokens().replace(/--wp-accent:[^;]*;/, '--wp-accent: #1f6feb;');
    expect(slotsNotTriplets(broken)).toEqual(['accent']);
  });
  it('(b) a colour put back to a hex is reported', () => {
    const broken = config().replace(/panel:\s*'[^']*'/, "panel:  '#161b22'");
    expect(coloursUnmapped(broken)).toEqual(['panel']);
  });
  it('(b) a mapping that lost its alpha placeholder is reported', () => {
    const broken = config().replace("rgb(var(--wp-dim) / <alpha-value>)", 'rgb(var(--wp-dim))');
    expect(coloursUnmapped(broken)).toEqual(['dim']);
  });
  it('(c) a hex put back into globals.css is found, and one in a comment is not', () => {
    const css = read('app', 'globals.css');
    expect(hexIn(css + '\nbody { color: #c9d1d9; }\n')).toEqual(['#c9d1d9']);
    expect(hexIn(css + '\n/* was #c9d1d9 */\n')).toEqual([]);
  });
  it('(d) a stray hex in a component is counted, and one in a comment is not', () => {
    expect(hexInSource("const c = '#abcdef';\n// was #123456\n")).toEqual(['#abcdef']);
  });
});
