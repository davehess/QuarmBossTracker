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

describe('header chrome', () => {
  const header = read('components/SiteHeader.tsx');
  const headerCode = strip(header);
  const icons = strip(read('components/HeaderIcons.tsx'));
  const tzCode = strip(read('components/TimezonePicker.tsx'));

  // Chips that drop their text MUST carry the label some other way, or their
  // accessible name becomes an emoji.
  it.each([['/feedback', 'Feedback'], ['https://wolfpack.opendkp.com', 'OpenDKP'], ['/admin', 'Admin']])(
    'keeps an accessible name on the %s chip when its text is hidden',
    (href, label) => {
      const i = headerCode.indexOf(href);
      expect(i).toBeGreaterThan(-1);
      const el = headerCode.slice(i - 120, i + 400);
      expect(el).toContain(`aria-label="${label}"`);
      expect(el).toMatch(/hidden xl:inline/);
    },
  );

  it('keeps the home link named when the wordmark is dropped', () => {
    expect(headerCode).toMatch(/aria-label="WolfPack\.quest — home"/);
    // The wordmark is the first thing to go when the bar folds.
    expect(headerCode).toMatch(/!compact && \(/);
  });

  it('folds on scroll AND on width, through one piece of state', () => {
    // "when you scroll down collapse it to one bar" and "when there isn't
    // enough room, like in mobile mode" are the same layout, so they must not
    // become two. One `compact` drives both.
    expect(headerCode).toMatch(/const compact = scrolled \|\| !roomy/);
    expect(headerCode).toMatch(/window\.addEventListener\('scroll'/);
    expect(headerCode).toMatch(/matchMedia\(ROOMY\)/);
    // Passive, or the listener fights the scroll it is watching.
    expect(headerCode).toMatch(/\{ passive: true \}/);
  });

  it('builds the Menu from the nav\'s own groups, never a second copy', () => {
    expect(headerCode).toMatch(/import Nav, \{ GROUPS \} from '\.\/Nav'/);
    expect(headerCode).toMatch(/GROUPS\.map/);
    // A second hard-coded list is how one of them goes stale.
    expect(headerCode).not.toMatch(/const GROUPS\s*[:=]/);
  });

  it('folds every bar link into the Menu rather than dropping it', () => {
    const menu = headerCode.slice(headerCode.indexOf('id="site-menu"'));
    for (const href of ['/', '/me', '/feedback', 'wolfpack.opendkp.com']) {
      expect(menu).toContain(href);
    }
    expect(menu).toMatch(/TimezonePicker/);
  });

  it('shows the three channels as symbols alone when space is short', () => {
    // Only the label drops; the glyph is what stays.
    expect(icons).toMatch(/\{showLabel && <span>\{c\.label\}<\/span>\}/);
    // ⚠ The stable channel's symbol is the DOWNLOAD icon, not the mimic logo
    // (Hitya, 2026-08-28) — the logo is the brand mark in the same bar, so the
    // folded bar was showing one picture twice, as "home" and as "download".
    expect(icons).toMatch(/glyph: <DownloadArrow/);
    expect(icons).not.toMatch(/glyph:[^\n]*mimic-logo/);
    // ...and exactly one download mark per chip, not a glyph plus a trailing one.
    const link = icons.slice(icons.indexOf('function ChannelLink'));
    expect((link.match(/DownloadArrow/g) || []).length).toBe(0);
    // Every channel keeps a real name even with no visible text.
    const names = icons.match(/name: '[^']+'/g) || [];
    expect(names.length).toBe(3);
    expect(icons).toMatch(/aria-label=\{c\.name\}/);
    expect(icons).toMatch(/🐧/);
  });

  it('reads the timezone as a clock and an abbreviation, over a real select', () => {
    expect(tzCode).toMatch(/ClockFace/);
    expect(tzCode).toMatch(/timeZoneName: 'short'/);
    // The native control has to survive: it is the focusable, labelled picker.
    expect(tzCode).toMatch(/<select/);
    expect(tzCode).toMatch(/aria-label="Timezone for all displayed times"/);
    expect(tzCode).toMatch(/opacity-0/);
  });

  it('stacks the banner and the bar in ONE sticky container', () => {
    // Two independently sticky elements at top-0 sit on top of each other, and
    // the bar has to sit below a banner whose height changes when folded.
    expect(bannerCode).not.toMatch(/sticky/);
    expect(layoutCode).toMatch(/<div className="sticky top-0 z-50">/);
    const box = layoutCode.slice(layoutCode.indexOf('sticky top-0 z-50'));
    expect(box.indexOf('BetaBanner')).toBeGreaterThan(-1);
    expect(box.indexOf('SiteHeader')).toBeGreaterThan(box.indexOf('BetaBanner'));
  });
});
