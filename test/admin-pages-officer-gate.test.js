// test/admin-pages-officer-gate.test.js — every /admin page checks the officer
// role itself, as the first thing it does.
//
// The /admin layout checks too, but a layout is not a gate for its pages: Next
// does not wait on the layout before it runs a page's data loading. So each
// page that loads anything calls requireOfficer() (web/lib/officer.ts) as its
// first statement, before its first query. The two pages that load nothing (the
// admin index of links, and /admin/who's redirect) are the only exceptions.
//
// Run: npx vitest run test/admin-pages-officer-gate.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const ADMIN = path.join(ROOT, 'web', 'app', 'admin');
const NO_DATA = new Set(['page.tsx', path.join('who', 'page.tsx')]);

function pages(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...pages(path.join(dir, e.name), r));
    else if (e.name === 'page.tsx') out.push(r);
  }
  return out;
}

// The first statement inside the default-exported function's body.
function firstStatement(src) {
  const at = src.indexOf('export default');
  expect(at, 'a default export').toBeGreaterThanOrEqual(0);
  // The body opens at the first "{" that ends a line after the signature
  // (a destructured parameter list spans several lines and has braces of its own).
  const rest = src.slice(at);
  const open = rest.search(/\)\s*(:\s*[^{]+)?\{\s*\n/);
  expect(open, 'the function body').toBeGreaterThanOrEqual(0);
  const body = rest.slice(open).replace(/^[^{]*\{\s*\n/, '');
  return body.split('\n').map(l => l.trim()).find(l => l.length > 0);
}

describe('/admin pages gate themselves', () => {
  const all = pages(ADMIN);

  it('finds the admin pages (not a vacuous pass)', () => {
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  for (const rel of all) {
    if (NO_DATA.has(rel)) continue;
    it(`${rel} calls requireOfficer() first`, () => {
      const src = stripJs(readSource(path.join(ADMIN, rel)));
      expect(src).toMatch(/import \{[^}]*\brequireOfficer\b[^}]*\} from '@\/lib\/officer';/);
      expect(firstStatement(src)).toBe('await requireOfficer();');
    });
  }

  it('the two exceptions really load nothing', () => {
    for (const rel of NO_DATA) {
      const src = stripJs(readSource(path.join(ADMIN, rel)));
      expect(src).not.toMatch(/supabase|fetch\(|load[A-Z]\w*\(/i);
    }
  });

  it('requireOfficer checks the session and the officer role, and redirects otherwise', () => {
    const src = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'officer.ts')));
    const fn = src.slice(src.indexOf('export async function requireOfficer'));
    expect(fn).toMatch(/auth\.getUser\(\)/);
    expect(fn).toMatch(/if \(!user\) redirect\(/);
    expect(fn).toMatch(/if \(!\(await isOfficer\(user\.id\)\)\) redirect\(/);
  });
});
