// The chrome above the fold on a phone, and the beta bar that sits on top of it.
//
// Measured at 390px on 2026-08-28: 362px of banner + header before the page's
// own content started. The costs were not where they looked. The account block
// wrapped "Sign in" onto its own line by FOUR pixels; the nav wrapped at 360;
// and the beta bar's one sentence ran three lines. All three are width
// problems, so all three fixes are responsive and none removes a control.
//
// These assert the shape, not the pixels — a browser measures pixels, and did.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.join(__dirname, '..', 'web');
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const banner = read('components/BetaBanner.tsx');
const bannerCode = strip(banner);
const layout = read('app/layout.tsx');
const layoutCode = strip(layout);

describe('beta banner', () => {
  it('can be dismissed, and comes back', () => {
    expect(bannerCode).toMatch(/aria-label="Collapse the beta notice"/);
    expect(bannerCode).toMatch(/aria-label="Show the beta notice"/);
    expect(bannerCode).toMatch(/aria-expanded/);
  });

  it('remembers the dismissal', () => {
    expect(bannerCode).toMatch(/localStorage\.getItem\(/);
    expect(bannerCode).toMatch(/localStorage\.setItem\(/);
    // Private mode throws on access rather than returning null, so both sides
    // must be guarded or the whole banner takes the page down with it.
    expect((bannerCode.match(/try\s*\{/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('never disappears entirely — dismissal collapses, it does not remove', () => {
    // "You are not on production" has to survive being dismissed, or someone
    // files a bug against the wrong site. The collapsed branch still says BETA.
    expect(bannerCode).not.toMatch(/if\s*\(\s*collapsed\s*\)\s*return\s+null/);
    const collapsedBranch = bannerCode.slice(
      bannerCode.indexOf('if (collapsed)'),
      bannerCode.indexOf('role="status"'),
    );
    expect(collapsedBranch).toMatch(/BETA/);
  });

  it('reads its stored state before paint, not after', () => {
    // A plain useEffect flashes the full bar at full height on every navigation
    // before collapsing it. useLayoutEffect warns during SSR, so it is chosen
    // by environment rather than suppressed.
    expect(bannerCode).toMatch(/typeof window === 'undefined' \? useEffect : useLayoutEffect/);
  });
});

describe('header chrome on a phone', () => {
  // Chips that drop their text below sm MUST carry the label some other way,
  // or their accessible name becomes an emoji.
  it.each([['/feedback', 'Feedback'], ['https://wolfpack.opendkp.com', 'OpenDKP'], ['/admin', 'Admin']])(
    'keeps an accessible name on the %s chip when its text is hidden',
    (href, label) => {
      const i = layoutCode.indexOf(href);
      expect(i).toBeGreaterThan(-1);
      const el = layoutCode.slice(i, i + 700);
      expect(el).toContain(`aria-label="${label}"`);
      expect(el).toMatch(/hidden sm:inline/);
    },
  );

  it('keeps the home link named when the wordmark is trimmed', () => {
    // ".quest" is dropped under 400px; the link's name must not shrink with it.
    expect(layoutCode).toMatch(/aria-label="WolfPack\.quest — home"/);
    expect(layoutCode).toMatch(/min-\[400px\]:inline/);
  });

  it('tightens only horizontal padding on nav chips, never the tap target', () => {
    const nav = strip(read('components/Nav.tsx'));
    const chip = nav.slice(nav.indexOf('const chip'), nav.indexOf('const chipIdle'));
    expect(chip).toMatch(/px-2 sm:px-3/);
    expect(chip).toMatch(/py-1\.5/);      // vertical size is a tap target — unchanged
  });
});
