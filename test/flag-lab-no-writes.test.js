// test/flag-lab-no-writes.test.js — the officer Flag lab (/admin/flag-lab) is an in-memory sandbox:
// nothing it renders or calls may write to the database.
//
// SOURCE-text tier. Comments are stripped first (CLAUDE.md, "comments satisfy text assertions"): the files
// below explain in prose that they never write, which would otherwise satisfy a positive match and, worse,
// trip a negative one. Covers the page, the client component, an actions file if one is ever added, and the
// two pure libraries the lab is built on.
//
// Run: npx vitest run test/flag-lab-no-writes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const LAB_DIR = path.join(ROOT, 'web', 'app', 'admin', 'flag-lab');
const FILES = [
  ...fs.readdirSync(LAB_DIR).filter(f => /\.(tsx?|jsx?)$/.test(f)).map(f => path.join(LAB_DIR, f)),
  path.join(ROOT, 'web', 'lib', 'hailBoardView.ts'),
  path.join(ROOT, 'web', 'lib', 'flagLabModel.ts'),
];

const WRITES = /\.(insert|upsert|update|delete|rpc)\(/;

describe('/admin/flag-lab never writes', () => {
  it('finds the page, the component and both libraries (not a vacuous pass)', () => {
    const names = FILES.map(f => path.basename(f));
    for (const n of ['page.tsx', 'FlagLab.tsx', 'hailBoardView.ts', 'flagLabModel.ts']) expect(names).toContain(n);
  });

  for (const file of FILES) {
    it(`${path.relative(ROOT, file)} has no write call`, () => {
      expect(stripJs(readSource(file))).not.toMatch(WRITES);
    });

    it(`${path.relative(ROOT, file)} reaches no database or network client`, () => {
      const src = stripJs(readSource(file));
      expect(src).not.toMatch(/supabase|\.from\(|fetch\(|XMLHttpRequest/i);
    });
  }

  it('the guard itself bites (mutation check)', () => {
    expect('sb.from("t").insert({})').toMatch(WRITES);
    expect('sb.rpc("f", {})').toMatch(WRITES);
    expect('const rows = []; rows.push(1);').not.toMatch(WRITES);
  });

  it('the page is off unless FLAG_LAB is exactly 1, and gates itself first', () => {
    const src = stripJs(readSource(path.join(LAB_DIR, 'page.tsx')));
    expect(src).toMatch(/process\.env\.FLAG_LAB === '1'/);
    expect(src).toMatch(/\{enabled && <FlagLab \/>\}/);
    expect(src).toMatch(/import \{ requireOfficer \} from '@\/lib\/officer';/);
  });

  it('every banner says the data is fake', () => {
    const src = stripJs(readSource(path.join(LAB_DIR, 'FlagLab.tsx')));
    expect(src).toContain('FAKE DATA — nothing here is saved.');
    // one <FakeBanner /> per panel
    expect(src.match(/<FakeBanner \/>/g)?.length).toBe(2);
  });

  it('a server action file, if one is added, must gate itself (none exists today)', () => {
    const actions = path.join(LAB_DIR, 'actions.ts');
    if (!fs.existsSync(actions)) return;
    const src = stripJs(readSource(actions));
    expect(src).toMatch(/requireOfficer\(\)/);
  });
});
