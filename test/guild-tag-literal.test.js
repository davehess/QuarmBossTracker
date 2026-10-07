// test/guild-tag-literal.test.js — the website never spells its database guild tag out.
//
// The site used to hard-code 'wolfpack' about 222 times in 81 files. The guild kit moves the tag to ONE
// place, web/lib/guild.ts (GUILD_TAG), so a second guild can run the same code on its own tag. This guard is
// what keeps the count at zero: a new `.eq('guild_id', 'wolfpack')` is a red test, not a quiet regression.
//
// ⚠ Written to pass AFTER the literal-swap slices land. In a worktree that has only the module (no swaps
// yet) the "no literal" and "files import GUILD_TAG" cases are RED, by design.
//
// Run: npx vitest run test/guild-tag-literal.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { webSources } from './_web-read-scan.js';

const norm = (p) => p.replace(/\\/g, '/');
const files = webSources().map(norm);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The module itself defines the default. The ONE other place: obfuscate.ts uses the word as the default
// SALT for the demo-name scrambler (DEMO_OBFUSCATE_SALT), which is a secret-ish seed and not a guild tag;
// changing it would re-scramble every demo name.
const ALLOW = new Set(['web/lib/guild.ts', 'web/lib/obfuscate.ts']);

// The scanner under test: what, in a source's non-comment text, counts as a hard-coded guild tag.
const QUOTED = /['"`]wolfpack['"`]/;
const FILTER = /guild_id\s*(=|\.eq\.|=eq\.)\s*['"]?wolfpack/;
export function literalHits(src) {
  const body = stripJs(src);
  const hits = [];
  if (QUOTED.test(body)) hits.push('quoted');
  if (FILTER.test(body)) hits.push('filter');
  return hits;
}

// An import of GUILD_TAG from the guild module, by any relative or alias path.
const IMPORTS_TAG = /import\s*(?:type\s*)?\{[^}]*\bGUILD_TAG\b[^}]*\}\s*from\s*['"](?:@\/lib\/guild|(?:\.{1,2}\/)+(?:lib\/)?guild)['"]/;
const isClient = (src) => /^\s*['"]use client['"]/m.test(stripJs(src));

describe('scanner (inline unit, so the guard cannot go vacuous)', () => {
  it('a quoted literal hits, in all three quote styles', () => {
    expect(literalHits(`.eq('guild_id', 'wolfpack')`)).toContain('quoted');
    expect(literalHits(`{ guild_id: "wolfpack" }`)).toContain('quoted');
    expect(literalHits('const t = `wolfpack`;')).toContain('quoted');
  });

  it('a PostgREST filter string hits even without a quote around the value', () => {
    expect(literalHits('fetch(`/rest/v1/t?guild_id=eq.wolfpack&limit=1`)')).toContain('filter');
    expect(literalHits('x = "guild_id=wolfpack"')).toContain('filter');
  });

  it('a whole-line comment does not hit; code beside it still does', () => {
    expect(literalHits(`// the guild_id is 'wolfpack' today\nconst a = 1;`)).toEqual([]);
    expect(literalHits(`/*\n * 'wolfpack'\n */\nconst a = 1;`)).toEqual([]);
    expect(literalHits(`// note\nconst a = 'wolfpack';`)).toContain('quoted');
  });

  it('other words and URLs do not hit', () => {
    expect(literalHits(`const u = 'https://wolfpack.quest';`)).toEqual([]);
    expect(literalHits(`const n = 'wolfpack_members';`)).toEqual([]);
    expect(literalHits(`.eq('guild_id', GUILD_TAG)`)).toEqual([]);
  });

  it('import and client detection', () => {
    expect(IMPORTS_TAG.test(`import { GUILD_TAG } from '@/lib/guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import { memberRoles, GUILD_TAG, RANKS } from '../lib/guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import {\n  GUILD_NAME,\n  GUILD_TAG,\n} from './guild';`)).toBe(true);
    expect(IMPORTS_TAG.test(`import { GUILD_NAME } from '@/lib/guild';`)).toBe(false);
    expect(IMPORTS_TAG.test(`import { GUILD_TAG } from '@/lib/other';`)).toBe(false);
    expect(isClient(`'use client';\nimport x from 'y';`)).toBe(true);
    expect(isClient(`// 'use client' is mentioned\nexport const a = 1;`)).toBe(false);
  });
});

describe('the website source set is the one we think it is', () => {
  it('the scanner saw the whole site, not a corner of it', () => {
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(files).toContain('web/lib/guild.ts');
    expect(files.some(f => f.startsWith('web/app/'))).toBe(true);
    expect(files.some(f => f.startsWith('web/components/'))).toBe(true);
  });

  it('the allowlist is not stale: each entry exists and (except the module) still carries the literal', () => {
    for (const rel of ALLOW) expect(files, rel).toContain(rel);
    expect(literalHits(read('web/lib/obfuscate.ts')), 'obfuscate.ts SALT default').toContain('quoted');
  });
});

describe('no hard-coded guild tag in web/**', () => {
  it('no file but the module (and the documented allowlist) spells the tag out', () => {
    const offenders = files
      .filter(f => !ALLOW.has(f))
      .map(f => ({ f, hits: literalHits(read(f)) }))
      .filter(x => x.hits.length)
      .map(x => `${x.f} (${x.hits.join(', ')})`);
    expect(offenders).toEqual([]);
  });

  it('the files that need the tag import GUILD_TAG from the guild module (not a vacuous pass)', () => {
    const importers = files.filter(f => f !== 'web/lib/guild.ts' && IMPORTS_TAG.test(stripJs(read(f))));
    expect(importers.length).toBeGreaterThanOrEqual(60);
  });

  it('GUILD_TAG is never imported into a "use client" file (the module is client-safe, the tag is not a browser concern)', () => {
    const bad = files.filter(f => {
      const src = read(f);
      return isClient(src) && IMPORTS_TAG.test(stripJs(src));
    });
    expect(bad).toEqual([]);
  });
});
