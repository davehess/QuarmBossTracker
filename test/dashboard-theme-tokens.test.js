// DESIGN-theming §2 / §7 step 3: the agent dashboard speaks the same --wp-* token names as the site and the
// overlays, seeded with today's values so nothing changes visually. Three things are pinned here:
//   1. :root defines every slot, with the agreed values (and the old short names still resolve to them);
//   2. a ratchet on raw hex literals in dashboard.html — it may only shrink as more moves onto the tokens;
//   3. a token-valued hex followed by `;` (the CSS / inline-style shape) never comes back outside :root.
// All matching runs on comment-stripped text: this file's own comments, and dashboard.html's, quote the values.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripCss } from './_source-slice.js';

const DASH = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');
const AGENT = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8');

// Whole-line `//` comments and block comments out. A `//`-anywhere strip would eat `https://` in strings.
const strip = (s) => stripCss(s).replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const CODE = strip(DASH);

// The hex table from DESIGN-theming §2.
const TOKENS = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9', dim: '#6e7681',
  accent: '#1f6feb', blue: '#58a6ff', purple: '#a371f7',
  green: '#56d364', red: '#f85149', gold: '#d29922', orange: '#ffa657',
};
// Today's dashboard short names (each is an alias of the token of the same name).
const ALIASES = ['bg', 'panel', 'border', 'text', 'dim', 'blue', 'gold', 'green', 'red', 'orange'];

// The `:root { … }` blocks, concatenated.
const rootCss = [...CODE.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
const decl = (name) => (rootCss.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);')) || [])[1]?.trim();

describe('dashboard theme tokens (--wp-*)', () => {
  it('defines every colour slot with its agreed value', () => {
    for (const [slot, hex] of Object.entries(TOKENS)) {
      expect(decl('wp-' + slot), 'slot --wp-' + slot).toBe(hex);
    }
  });

  it('defines the radius and font slots', () => {
    expect(decl('wp-radius')).toBe('6px');
    expect(decl('wp-font-mono')).toMatch(/Cascadia Code/); // today's dashboard stack, kept so nothing shifts
    expect(decl('wp-font-ui')).toMatch(/system-ui/);
  });

  it('keeps the old short names as aliases of the tokens', () => {
    for (const slot of ALIASES) {
      expect(decl(slot), '--' + slot).toBe('var(--wp-' + slot + ')');
    }
  });

  it('ratchet: raw hex literals only shrink (baseline 422, was 549 before the move onto tokens)', () => {
    const n = (CODE.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    expect(n).toBeLessThanOrEqual(422);
    expect(n).toBeGreaterThan(300); // a stripper bug that empties CODE must not pass the <= for free
  });

  it('no token-valued hex literal in a CSS declaration outside :root', () => {
    const outside = CODE.replace(/:root\s*\{[^}]*\}/g, '');
    for (const [slot, hex] of Object.entries(TOKENS)) {
      expect(outside.includes(hex + ';'), slot + ' ' + hex + ' literal returned').toBe(false);
    }
  });

  it('the colour-theme buttons and their mechanism are untouched (Mimic still applies the theme)', () => {
    expect(CODE).toMatch(/class="wp-theme-pick" data-th="/);
    expect(CODE).toMatch(/st\.overlayTheme/);
    expect(CODE).toMatch(/\.wp-theme-pick'\)/);
  });

  it('the shipped WEB_HTML literal carries the same :root (synced, not hand-edited)', () => {
    expect(AGENT).toContain('--wp-accent:#1f6feb');
    expect(AGENT).toContain('--wp-purple:#a371f7');
  });

  it('matches apps/mimic/theme.css when that file exists', () => {
    const p = path.join(ROOT, 'apps', 'mimic', 'theme.css');
    if (!fs.existsSync(p)) return; // drafted separately; until it lands, the table above is the reference
    const css = strip(fs.readFileSync(p, 'utf8'));
    for (const [slot, hex] of Object.entries(TOKENS)) {
      const m = css.match(new RegExp('--wp-' + slot + '\\s*:\\s*([^;]+);'));
      if (m) expect(m[1].trim().toLowerCase(), '--wp-' + slot).toBe(hex);
    }
  });
});
