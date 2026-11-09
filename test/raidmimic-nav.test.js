// test/raidmimic-nav.test.js — the raidmimic.com top bar (the guild lead, 2026-11-09, Decision Desk pick A, centred):
// five top links, and a centred second row of the current section's pages. Runs the pure data in web/lib/raidmimicNav.ts.
//
// Run: npx vitest run test/raidmimic-nav.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { RAIDMIMIC_SECTIONS, sectionOfPath, pageIsCurrent } from '../web/lib/raidmimicNav.ts';
import { GUILDS_STAY_PATH } from '../web/lib/guildSites.ts';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Every path that exists on a raidmimic host (web/lib/raidmimicHost.ts): the open paths, the rewritten pages and the demo.
const EXISTING = ['/', '/characters', '/guilds', '/guilds/new', '/setup', '/register', '/privacy', '/terms', '/refunds',
  '/demo', '/demo/flags', '/demo/capture', '/demo/events', '/demo/events/needs', '/demo/raid'];
const allHrefs = RAIDMIMIC_SECTIONS.flatMap(s => [s.href, ...s.pages.map(p => p.href)]);

describe('the raidmimic.com nav data', () => {
  it('has exactly five top links, in order', () => {
    expect(RAIDMIMIC_SECTIONS.map(s => s.label)).toEqual(['/me', 'Flagging', 'Guild', 'Raids', 'Spectator']);
  });
  it('points every link at a page that exists on a raidmimic host', () => {
    for (const h of allHrefs) {
      const p = h.split(/[?#]/)[0];
      expect(EXISTING, h).toContain(p);
    }
  });
  it('keeps stay=1 on "Your guilds"', () => {
    expect(GUILDS_STAY_PATH).toBe('/guilds?stay=1');
    expect(RAIDMIMIC_SECTIONS.find(s => s.key === 'guild').pages[0].href).toBe(GUILDS_STAY_PATH);
  });
  it('spells no Wolf Pack address', () => {
    for (const h of allHrefs) expect(h).not.toMatch(/wolfpack|quest|https?:/i);
    expect(code('web/lib/raidmimicNav.ts')).not.toMatch(/wolfpack/i);
    expect(code('web/components/RaidmimicSubnav.tsx')).not.toMatch(/wolfpack/i);
  });
  it('gives a second row only to sections with 2+ pages (Flagging, Guild, Raids)', () => {
    expect(RAIDMIMIC_SECTIONS.filter(s => s.pages.length > 1).map(s => s.key)).toEqual(['flagging', 'guild', 'raids']);
  });
  it('links Spectator to the landing block that exists', () => {
    expect(RAIDMIMIC_SECTIONS[4].href).toBe('/#replay');
    expect(code('web/app/raidmimic/_landing/StoryParts.tsx')).toMatch(/<li key=\{f\.id\} id=\{f\.id\}/);
    expect(fs.readFileSync(path.join(ROOT, 'web/lib/raidmimicStory.ts'), 'utf8')).toMatch(/id: 'replay', name: 'Replay & spectator'/);
  });
});

describe('sectionOfPath', () => {
  const key = (p) => sectionOfPath(p)?.key ?? null;
  it('places each page', () => {
    expect(key('/characters')).toBe('flagging');
    expect(key('/demo/flags')).toBe('flagging');
    expect(key('/guilds')).toBe('guild');
    expect(key('/guilds/abc')).toBe('guild');
    expect(key('/guilds/new')).toBe('guild');
    expect(key('/register')).toBe('guild');
    expect(key('/setup')).toBe('guild');
    expect(key('/demo/events/needs')).toBe('raids');
    expect(key('/demo/raid')).toBe('raids');
    expect(key('/demo')).toBe('raids');
    expect(key('/')).toBe('me');
  });
  it('puts the legal pages and strangers in no section', () => {
    expect(key('/privacy')).toBeNull();
    expect(key('/terms')).toBeNull();
    expect(key('/charactersx')).toBeNull();
  });
  it('ignores a query, a trailing slash and case', () => {
    expect(key('/Characters/')).toBe('flagging');
    expect(key('/guilds?stay=1')).toBe('guild');
  });
  it('marks one current page, and /guilds/new does not light "Your guilds"', () => {
    const g = sectionOfPath('/guilds/new');
    expect(g.pages.filter(p => pageIsCurrent(g, p, '/guilds/new')).map(p => p.label)).toEqual(['Start a guild']);
    expect(g.pages.filter(p => pageIsCurrent(g, p, '/guilds/abc')).map(p => p.label)).toEqual(['Your guilds']);
    const r = sectionOfPath('/demo/events/needs');
    expect(r.pages.filter(p => pageIsCurrent(r, p, '/demo/events/needs')).map(p => p.label)).toEqual(['Needs board']);
  });
});

describe('the bar', () => {
  const frame = code('web/components/RaidmimicFrame.tsx');
  const sub = code('web/components/RaidmimicSubnav.tsx');
  it('keeps HostBar a server component and only the second row a client one', () => {
    expect(frame).not.toMatch(/['"]use client['"]/);
    expect(sub).toMatch(/^'use client';/);
    expect(sub).toMatch(/usePathname\(\)/);
  });
  it('centres the second row and marks the current page', () => {
    expect(sub).toMatch(/justify-center/);
    expect(sub).toMatch(/aria-current=\{on \? 'page' : undefined\}/);
    expect(frame).toMatch(/<RaidmimicSubnav \/>/);
  });
  it('keeps the second row inside the sticky header', () => {
    const header = frame.slice(frame.indexOf('<header'), frame.indexOf('</header>'));
    expect(header).toMatch(/sticky top-0/);
    expect(header).toMatch(/<RaidmimicSubnav \/>/);
  });
});
