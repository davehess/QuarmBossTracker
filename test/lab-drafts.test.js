// test/lab-drafts.test.js — the design lab (web/app/lab, beta branch only).
//
// The guild lead, 2026-11-14: "do everything as drafts, a few versions of each graphical change and let me choose
// in the decision deck." A draft is a page at /lab/<slug> that shows two or three versions of a redesign with
// MADE-UP data, so anyone can open it and it shows no member's data. This file holds the lab to that:
//   - never indexed;
//   - nothing under the lab reads the database, the session or a secret;
//   - every draft in the registry has its page, and every lab page is in the registry;
//   - a draft names its versions the way the Decision Desk needs (a name and a few-word difference each), and its
//     recommended version is one of them.
//
// Run: npx vitest run test/lab-drafts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { LAB_DRAFTS, labVariant } from '../web/lib/lab/registry.ts';
import { LAB_RAID, labRand, labInt } from '../web/lib/lab/people.ts';

const WEB = path.join(ROOT, 'web');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d).flatMap((n) => {
  const p = path.join(d, n);
  return fs.statSync(p).isDirectory() ? walk(p) : (/\.(ts|tsx)$/.test(n) ? [p] : []);
}) : []);
const LAB_FILES = [...walk(path.join(WEB, 'app', 'lab')), ...walk(path.join(WEB, 'components', 'lab')), ...walk(path.join(WEB, 'lib', 'lab'))];
const rel = (f) => path.relative(WEB, f).split(path.sep).join('/');

describe('the lab is a closed room', () => {
  it('finds the lab files (a path bug would make the rest vacuous)', () => {
    expect(LAB_FILES.map(rel)).toEqual(expect.arrayContaining(['app/lab/layout.tsx', 'app/lab/page.tsx', 'lib/lab/registry.ts', 'lib/lab/people.ts', 'components/lab/LabFrame.tsx']));
  });

  it('is never indexed', () => {
    const layout = stripJs(fs.readFileSync(path.join(WEB, 'app', 'lab', 'layout.tsx'), 'utf8'));
    expect(layout).toMatch(/export const metadata\s*=\s*\{\s*robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}\s*\}/);
  });

  it('nothing in it reads the database, the session, the request or a secret', () => {
    const offenders = [];
    for (const f of LAB_FILES) {
      const code = stripJs(fs.readFileSync(f, 'utf8'));
      if (/@\/lib\/supabase|supabase-server|supabaseAdmin|supabaseServer|@supabase\/|getSessionUser|next\/headers|cookies\(\)|process\.env\.(?!NODE_ENV)|\bfetch\(/.test(code)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });

  it('a lab file imports only from the lab, from shared presentational components, or from pure libraries', () => {
    // A draft may reuse a real component so the versions are honest about what exists, but only one that takes its
    // data as props. Anything that loads data itself would pull the database into the lab.
    const LOADERS = /from '@\/lib\/(session|officer|member|supabase|supabase-server|selfData|hubGuilds|guildSettings\w*|raidScreenServer|pageMetaData)'/;
    const offenders = LAB_FILES.filter((f) => LOADERS.test(stripJs(fs.readFileSync(f, 'utf8')))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('the registry and the pages agree', () => {
  const pageSlugs = fs.readdirSync(path.join(WEB, 'app', 'lab'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(WEB, 'app', 'lab', e.name, 'page.tsx'))).map((e) => e.name).sort();

  it('every draft has a page and every page is a draft', () => {
    expect(LAB_DRAFTS.map((d) => d.slug).sort()).toEqual(pageSlugs);
    expect(new Set(LAB_DRAFTS.map((d) => d.slug)).size).toBe(LAB_DRAFTS.length);
  });

  it.each(LAB_DRAFTS.map((d) => [d.slug, d]))('%s is described the way the Decision Desk needs', (_slug, d) => {
    expect(d.slug).toMatch(/^[a-z][a-z0-9-]{2,30}$/);
    expect(['wolfpack.quest', 'raidmimic.com']).toContain(d.site);
    expect(d.variants.length).toBeGreaterThanOrEqual(2);
    expect(d.variants.length).toBeLessThanOrEqual(3);
    expect(d.variants.map((v) => v.key)).toEqual(['a', 'b', 'c'].slice(0, d.variants.length));
    for (const v of d.variants) {
      expect(v.name.length).toBeGreaterThan(2);
      expect(v.name.length).toBeLessThanOrEqual(28);
      expect(v.diff.length).toBeGreaterThan(10);
      expect(v.diff.length).toBeLessThanOrEqual(110);
    }
    expect(d.variants.map((v) => v.key)).toContain(d.rec);
    expect(d.problem.length).toBeGreaterThan(15);
    expect(d.why.length).toBeGreaterThan(15);
    if (d.live) expect(d.live).toMatch(/^\/([a-z]|$)/);     // a page, or "/" for a part on every page (the top bar)
    // the staged version is a preview: behind ?v= or a /lab path, never the page's default
    if (d.staged) expect(d.staged).toMatch(/[?&]v=[abc]\b|^\/lab\//);
  });

  it.each(LAB_DRAFTS.map((d) => [d.slug]))('%s: its page takes ?v= through the registry and names itself', (slug) => {
    const src = stripJs(fs.readFileSync(path.join(WEB, 'app', 'lab', slug, 'page.tsx'), 'utf8'));
    expect(src).toMatch(/labVariant\(/);
    expect(src).toMatch(/<LabFrame\b/);
    expect(src).toMatch(/export const metadata\s*=\s*\{[^}]*title:/s);
    expect(src).toMatch(/description:/);
  });

  it('an unknown or missing ?v= falls back to the recommended version', () => {
    const d = { variants: [{ key: 'a' }, { key: 'b' }], rec: 'b' };
    expect([labVariant(undefined, d), labVariant('z', d), labVariant('a', d), labVariant(['a', 'b'], d), labVariant('c', d)]).toEqual(['b', 'b', 'a', 'a', 'b']);
  });
});

describe('made-up people', () => {
  it('is one fixed list of distinct invented names with a real class each', () => {
    expect(LAB_RAID.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LAB_RAID.map((p) => p.name)).size).toBe(LAB_RAID.length);
    for (const p of LAB_RAID) { expect(p.name).toMatch(/^[A-Z][a-z]{3,11}$/); expect(p.level).toBeGreaterThanOrEqual(50); }
  });
  it('made-up numbers are stable between renders', () => {
    expect(labRand('Aldenmar', 1)).toBe(labRand('Aldenmar', 1));
    expect(labRand('Aldenmar', 1)).not.toBe(labRand('Aldenmar', 2));
    for (const p of LAB_RAID) { const n = labInt(p.name, 10, 20); expect(n).toBeGreaterThanOrEqual(10); expect(n).toBeLessThanOrEqual(20); }
  });
});
