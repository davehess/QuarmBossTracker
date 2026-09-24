// test/pqdi-links.test.js — every outbound PQDI link uses `www.pqdi.cc`.
//
// A member, 2026-09-24: clicking an item on the inventory pages "don't ever
// load". PQDI answers only on the www host; the bare `pqdi.cc` resets the
// connection, so a link without the `www.` is dead on arrival. Most of the site
// already had it right, and four links did not — the kind of drift a test
// catches and a reviewer does not.
//
// Same visit, the second dead link: `pqdi.cc/search?term=` was never a PQDI
// URL at all. Its search is a POST form carrying a CSRF token, so there is no
// GET address to deep-link; a name-only fallback goes to OUR /search instead.
//
// Run: npx vitest run test/pqdi-links.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const FILES = ['app', 'components', 'lib'].flatMap(d => walk(path.join(ROOT, 'web', d)));

function offenders(rx) {
  const hits = [];
  for (const f of FILES) {
    const src = stripJs(fs.readFileSync(f, 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (rx.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  return hits;
}

describe('PQDI links', () => {
  it('walks a real corpus (a vacuous pass would prove nothing)', () => {
    expect(FILES.length).toBeGreaterThan(100);
    // At least one correct link exists, so the negative checks below are
    // looking in the right place.
    expect(offenders(/https:\/\/www\.pqdi\.cc\/item\//).length).toBeGreaterThan(3);
  });

  it('never links the bare pqdi.cc host', () => {
    expect(offenders(/https?:\/\/pqdi\.cc\//)).toEqual([]);
  });

  it('never deep-links a PQDI search URL (there is no GET search)', () => {
    expect(offenders(/pqdi\.cc\/search\?/)).toEqual([]);
  });
});
