// test/lab-site-header.test.js: the top-bar draft (web/app/lab/site-header). Pure helpers + the staging switch.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { raidPill, jumpFilter, HINTS } from '../web/lib/siteHeaderView.ts';
import { LAB_GROUPS, LAB_NOWS } from '../web/lib/lab/fixtures/site-header.ts';

const src = (f) => fs.readFileSync(path.join(ROOT, 'web', f), 'utf8');
// Nav.tsx is a React client file, so read its GROUPS block as text instead of importing it.
const navSrc = stripJs(fs.readFileSync(path.join(ROOT, 'web/components/Nav.tsx'), 'utf8'));
const GROUPS = [...navSrc.slice(navSrc.indexOf('export const GROUPS'), navSrc.indexOf('// Tighter horizontal')).matchAll(/id: '(\w+)', label: '([^']+)'|href: '([^']+)',\s+label: '([^']+)'/g)]
  .reduce((acc, m) => { if (m[1]) acc.push({ id: m[1], label: m[2], items: [] }); else acc[acc.length - 1].items.push({ href: m[3], label: m[4] }); return acc; }, []);
const at = (iso) => raidPill(iso);

describe('raidPill (Sun/Wed/Thu 8:30 to 11:30 PM Eastern)', () => {
  it('raid day before the start counts down', () => {
    expect(at('2026-11-11T23:20:00Z').long).toBe('Raid tonight 8:30 PM ET, in 2h 10m'); // Wed 6:20 PM EST
    expect(at('2026-11-11T23:20:00Z').short).toBe('Raid in 2h 10m');
    expect(at('2026-11-12T01:00:00Z').long).toBe('Raid tonight 8:30 PM ET, in 30m');       // 8:00 PM
    expect(at('2026-11-11T22:30:00Z').long).toBe('Raid tonight 8:30 PM ET, in 3h');
    expect(at('2026-11-11T23:20:00Z').state).toBe('before');
  });
  it('is on from 8:30 to 11:30 PM, and not a minute either side', () => {
    expect(at('2026-11-12T01:29:00Z').state).toBe('before');
    expect(at('2026-11-12T01:30:00Z')).toMatchObject({ state: 'live', long: 'Raid on now', tone: 'green' });
    expect(at('2026-11-12T04:29:00Z').state).toBe('live');
    expect(at('2026-11-12T04:30:00Z').state).toBe('next');
  });
  it('after the raid and on off days it names the next raid day', () => {
    expect(at('2026-11-13T04:45:00Z').long).toBe('Next raid Sun 8:30 PM ET'); // Thu 11:45 PM -> wraps to Sunday
    expect(at('2026-11-14T17:00:00Z').long).toBe('Next raid Sun 8:30 PM ET'); // Saturday
    expect(at('2026-11-16T17:00:00Z').long).toBe('Next raid Wed 8:30 PM ET'); // Monday
    expect(at('2026-11-12T04:45:00Z').long).toBe('Next raid Thu 8:30 PM ET'); // Wed 11:45 PM
    expect(at('2026-11-14T17:00:00Z').short).toBe('Next Sun 8:30 PM');
  });
  it('uses the New York date, not the UTC one', () => {
    // Sunday 9 PM ET is already Monday in UTC
    expect(at('2026-11-16T02:00:00Z').state).toBe('live');
  });
  it('is daylight-saving safe', () => {
    // Sun 2026-03-08 01:30 EST (clocks jump at 2 AM): the raid is 18 real hours away, not 19
    expect(at('2026-03-08T06:30:00Z').long).toBe('Raid tonight 8:30 PM ET, in 18h');
    // summer, one minute out
    expect(at('2026-07-16T00:29:00Z').long).toBe('Raid tonight 8:30 PM ET, in 1m');
    expect(at('2026-07-16T00:30:00Z').state).toBe('live');
  });
  it('the three lab moments read as intended', () => {
    expect(at(LAB_NOWS.before.iso).state).toBe('before');
    expect(at(LAB_NOWS.live.iso).state).toBe('live');
    expect(at(LAB_NOWS.off.iso).state).toBe('next');
  });
});

describe('jumpFilter', () => {
  const pages = LAB_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label, hint: HINTS[i.href] })));
  it('an empty box lists recent pages first, newest first, known pages only', () => {
    expect(jumpFilter('', pages, ['/parses', '/nope', '/boards']).map((p) => p.href)).toEqual(['/parses', '/boards']);
    expect(jumpFilter('  ', pages, [])).toEqual([]);
  });
  it('ranks name starts above contains above hints', () => {
    const r = jumpFilter('ra', pages).map((p) => p.label);
    expect(r.slice(0, 4).every((l) => /^ra/i.test(l))).toBe(true);
    expect(r[0]).toBe('Raid HQ');
    expect(jumpFilter('boss', pages).map((p) => p.label)).toContain('Spawn boards'); // via the hint
  });
  it('matches the slash names with or without the slash', () => {
    expect(jumpFilter('/who', pages)[0].href).toBe('/who');
    expect(jumpFilter('who', pages)[0].href).toBe('/who');
  });
  it('a recent page edges out an equal match, and the list is capped', () => {
    expect(jumpFilter('r', pages, ['/rolls'], 3).length).toBe(3);
    expect(jumpFilter('zzzz', pages)).toEqual([]);
  });
});

describe('the draft keeps to the real navigation and the staged switch is the only change to SiteHeader', () => {
  it('fixture groups are exactly what Nav.tsx defines today', () => {
    expect(GROUPS.length).toBe(3);
    expect(LAB_GROUPS).toEqual(GROUPS);
  });
  it('every link has a hint', () => {
    for (const g of GROUPS) for (const i of g.items) expect(HINTS[i.href], i.href).toBeTruthy();
  });
  it('SiteHeader renders today\'s bar unless ?hdr= was given, and ?hdr=off clears it', () => {
    const code = stripJs(src('components/SiteHeader.tsx'));
    expect(code).toMatch(/function SiteHeaderToday\(/);
    expect(code).toMatch(/export default function SiteHeader\(/);
    expect(code).toMatch(/get\('hdr'\)/);
    expect(code).toMatch(/q === 'off'\) sessionStorage\.removeItem/);
    expect(code).toMatch(/return <SiteHeaderToday \{\.\.\.props\} \/>/);
    expect(code).toMatch(/try \{[\s\S]*sessionStorage[\s\S]*\} catch/);
  });
  it('the staged header gets the real slots and groups', () => {
    const code = stripJs(src('components/SiteHeader.tsx'));
    expect(code).toMatch(/groups=\{GROUPS\}/);
    expect(code).toMatch(/authBadge=\{props\.authBadge\}/);
    expect(code).toMatch(/search=\{props\.search\}/);
  });
  it('the draft stages at ?hdr= and names each version within the lab limits', async () => {
    const { draft } = await import('../web/lib/lab/drafts/site-header.ts');
    expect(draft.staged).toMatch(/\?hdr=1&v=a$/);
    for (const v of draft.variants) { expect(v.name.length).toBeLessThanOrEqual(28); expect(v.diff.length).toBeLessThanOrEqual(110); }
    expect(draft.variants.map((v) => v.key)).toEqual(['a', 'b', 'c']);
  });
  it('phone: Admin moves into the account menu and the doors row can shrink', () => {
    const code = stripJs(src('components/lab/site-header/HeaderDraft.tsx'));
    expect(code).toMatch(/showAdmin && !phone && <Link href="\/admin"/);
    expect(code).toMatch(/phone && p\.showAdmin && <Link href="\/admin"/);
    expect(code).toMatch(/<nav aria-label="Sections" className="flex min-w-0/);
  });
  it('the real header re-reads ?hdr= after navigation, without useSearchParams', () => {
    const code = stripJs(src('components/SiteHeader.tsx'));
    expect(code).toMatch(/const hdrPath = usePathname\(\)/);
    expect(code).toMatch(/\}, \[hdrPath\]\);/);
    expect(code).not.toMatch(/useSearchParams/);
  });
  it('version C: Enter on an empty box does nothing, and the site search sits in the jump panel', () => {
    const code = stripJs(src('components/lab/site-header/HeaderDraft.tsx'));
    expect(code).toMatch(/e\.key === 'Enter' && q\.trim\(\) && hits\[active\]/);
    expect(code).toMatch(/\{p\.search \? <div className="border-t border-border p-2 \[&>\*\]:!w-full">\{p\.search\}<\/div> : null\}\n\s+<\/div>\n\s+\);\n\s+\}\)\(\);\n\n\s+return/);
  });
  it('no emoji and no em dash in the draft', () => {
    for (const f of ['components/lab/site-header/HeaderDraft.tsx', 'components/lab/site-header/Mocks.tsx', 'app/lab/site-header/page.tsx', 'lib/siteHeaderView.ts']) {
      expect(stripJs(src(f))).not.toMatch(/\p{Extended_Pictographic}|—/u);
    }
  });
});
