// test/lab-rm-first-screen.test.js — the raidmimic first-screen draft (design lab, three versions behind ?hero=a|b|c).
// Run: npx vitest run test/lab-rm-first-screen.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { COPY, MEDIA } from '../web/lib/lab/fixtures/rm-first-screen.ts';

const WEB = path.join(ROOT, 'web');
const code = (rel) => stripJs(fs.readFileSync(path.join(WEB, rel), 'utf8'));
const HEROES = { a: 'HeroA', b: 'HeroB', c: 'HeroC' };

describe('?hero= leaves the default page alone', () => {
  const page = code('app/raidmimic/page.tsx');
  const sw = code('components/lab/rm-first-screen/HeroSwitch.tsx');   // a lab file: the landing folder holds only the live page's own
  it('the page still renders the story stage and reads no query itself', () => {
    expect(page).toMatch(/<StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>/);
    expect(page).not.toMatch(/searchParams/);
    expect(page).toMatch(/<HeroSwitch [^>]*>\{top\}<\/HeroSwitch>/);
  });
  it('only a, b or c swap the first screen; anything else renders the children', () => {
    expect(sw).toMatch(/get\('hero'\)/);
    expect(sw).toMatch(/if \(hero !== 'a' && hero !== 'b' && hero !== 'c'\) return <>\{children\}<\/>;/);
  });
  it('does not touch the existing v parameter', () => {
    expect(sw).not.toMatch(/get\('v'\)/);
  });
});

describe.each(Object.entries(HEROES))('version %s', (_k, file) => {
  const src = code(`components/lab/rm-first-screen/${file}.tsx`);
  it('has exactly one h1', () => { expect(src.match(/<h1\b/g)).toHaveLength(1); });
  it('has at most two buttons', () => { expect((src.match(/<Btn\b/g) || []).length).toBeLessThanOrEqual(2); expect(src).not.toMatch(/<button\b[^>]*>\s*\{copy\.download/); });
});

describe('media and copy', () => {
  const files = [MEDIA.video.src, MEDIA.video.poster, MEDIA.video.endPoster, MEDIA.video.captions, MEDIA.dps.src, MEDIA.stats.src, MEDIA.cc.src];
  it.each(files)('%s exists under web/public', (f) => { expect(fs.existsSync(path.join(WEB, 'public', f))).toBe(true); });
  it('never says Wolf Pack, never uses an em dash', () => {
    const all = JSON.stringify([COPY, MEDIA]);
    expect(all).not.toMatch(/wolf\s*pack|wolfpack/i);
    expect(all).not.toMatch(/—/);
    for (const f of ['fixtures/rm-first-screen.ts', 'drafts/rm-first-screen.ts']) expect(code(`lib/lab/${f}`)).not.toMatch(/wolf\s*pack|wolfpack/i);
    for (const h of Object.values(HEROES)) expect(code(`components/lab/rm-first-screen/${h}.tsx`)).not.toMatch(/wolf\s*pack|wolfpack|—/i);
  });
});
