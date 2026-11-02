// test/raidmimic-frame.test.js — every raidmimic.com page carries the Raid Mimic header and footer (the guild lead, 2026-11-02, on
// raidmimic.com/guilds: "This looks like it's hard-tied to wolfpack here. And we're missing the whole header and privacy policy
// and whatnot at the bottom of the page"). The root layout gives a raidmimic host a bare shell, so each page brings its own:
// web/components/RaidmimicFrame.tsx for the pages that had none.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

describe('the Raid Mimic frame', () => {
  const frame = code('web/components/RaidmimicFrame.tsx');
  it('draws the bar (home + nav) and the Raid Mimic footer, and nothing on a Wolf Pack host', () => {
    expect(frame).toMatch(/import \{ Footer \} from '@\/app\/raidmimic\/_landing\/Parts';/);
    expect(frame).toMatch(/<nav aria-label="Raid Mimic"/);
    expect(frame).toMatch(/href: '\/guilds'/);
    expect(frame).toMatch(/<Footer onHost \/>/);
    expect(frame).toMatch(/if \(!onHost\) return <>\{children\}<\/>;/);
    expect(frame).not.toMatch(/['"]use client['"]/);
  });

  it('wraps every raidmimic-host page that had no header or footer', () => {
    for (const f of ['web/app/guilds/page.tsx', 'web/app/guilds/new/page.tsx', 'web/app/guilds/[slug]/page.tsx', 'web/app/raidmimic/register/page.tsx']) {
      const src = code(f);
      expect(src, f).toMatch(/import HostFrame from '@\/components\/RaidmimicFrame';/);
      const opens = (src.match(/<HostFrame onHost=\{onHost\}>/g) || []).length;
      expect(opens, f).toBeGreaterThan(0);
      expect((src.match(/<\/HostFrame>/g) || []).length, f).toBe(opens);   // every return that opens it closes it
    }
    // /guilds/<slug> has two returns (a visitor's and a member's); both are framed
    expect((code('web/app/guilds/[slug]/page.tsx').match(/<HostFrame onHost=\{onHost\}>/g) || []).length).toBe(2);
    // the set-up guide ends in its own footer, so it takes the bar only
    const setup = code('web/app/raidmimic/setup/page.tsx');
    expect(setup).toMatch(/\{onHost && <HostBar \/>\}/);
    expect(setup).not.toMatch(/<HostFrame/);
  });

  it('/guilds: Wolf Pack\'s card reads like the others, and "Find my guilds" never says "none" beside a listed guild', () => {
    const page = code('web/app/guilds/page.tsx');
    expect(page).toMatch(/Open the guild &rarr;<\/a>[\s\S]*Open the guild &rarr;<\/a>/);   // Wolf Pack's card and each hub card
    expect(page).not.toMatch(/Open my page/);
    expect(page).toMatch(/findNote\(searchParams\.find, searchParams\.found, closed\.length, !!wolf \|\| hub\.length > 0\)/);
    expect(page).toMatch(/\$\{listed \? 'No other' : 'None'\} of your Discord servers is a guild on Raid Mimic yet/);
  });
});
