// test/ai-methodology.test.js — /ai cannot quietly disagree with the repo.
//
// Hitya 2026-08-23 asked for the methodology to be published at
// wolfpack.quest/ai, human- and agent-readable. Publishing a restatement of
// rules that actually live in CLAUDE.md and docs/ creates a second copy, and
// a second copy rots — which is precisely the failure mode several of the
// published rules exist to prevent (a stale feature index produces the wrong
// "we don't have that"; a lagging ledger reported a shipped feature as
// blocked).
//
// So the page is allowed to restate the rules ONLY because this test holds the
// restatement to the source: every cited document must exist, and every `quote`
// must still appear verbatim in the document it cites. Rewrite a rule in
// CLAUDE.md and this goes red until the published copy is updated too.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'web/lib/aiMethodology.ts'), 'utf8');

/** Pull the object literals out of the TS module without compiling it. The
 *  fields we assert on are all plain strings, so a scan is enough and keeps
 *  this test free of a TS toolchain. */
function fieldsOf(name) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`missing export: ${name}`);
  const end = src.indexOf('\n];', start);
  if (end < 0) throw new Error(`unterminated export: ${name}`);
  return src.slice(start, end);
}

const readString = (block, key) =>
  [...block.matchAll(new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g'))]
    .map(m => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));

const PRINCIPLES = fieldsOf('PRINCIPLES');
const MILESTONES = fieldsOf('MILESTONES');

describe('/ai — published methodology tracks the repo', () => {
  it('every cited document exists', () => {
    const docs = readString(PRINCIPLES, 'sourceDoc');
    expect(docs.length).toBeGreaterThan(8);
    const missing = docs.filter(d => !fs.existsSync(path.join(ROOT, d)));
    expect(missing).toEqual([]);
  });

  it('every quote still appears verbatim in the document it cites', () => {
    // Pair each sourceDoc with the quote that follows it in the same object.
    // NOTE: no `\n` before `quote:` — the preceding `\s*` has already eaten the
    // newline and indentation. Getting that wrong makes the optional group
    // never match, and the test passes vacuously (caught by deliberately
    // corrupting a quote and watching it stay green).
    const entries = [...PRINCIPLES.matchAll(
      /sourceDoc:\s*'((?:[^'\\]|\\.)*)',\s*(?:quote:\s*'((?:[^'\\]|\\.)*)',)?/g,
    )];
    expect(entries.length).toBeGreaterThan(8);
    // Guard the guard: if the pairing regex stops capturing quotes, this test
    // would silently verify nothing.
    expect(entries.filter(e => e[2]).length).toBeGreaterThan(8);

    const broken = [];
    for (const [, docRaw, quoteRaw] of entries) {
      if (!quoteRaw) continue;               // quote is optional
      const doc = docRaw.replace(/\\'/g, "'");
      const quote = quoteRaw.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      const body = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      if (!body.includes(quote)) broken.push(`${doc} no longer contains: ${quote}`);
    }
    expect(broken).toEqual([]);
  });

  it('milestone commit shas are full-length-prefix hex, not placeholders', () => {
    const shas = readString(MILESTONES, 'sha');
    expect(shas.length).toBeGreaterThan(10);
    expect(shas.filter(s => !/^[0-9a-f]{8,40}$/.test(s))).toEqual([]);
  });

  it('every principle points at a milestone that exists', () => {
    const ids = new Set(readString(MILESTONES, 'id'));
    const refs = readString(PRINCIPLES, 'milestone');
    expect(refs.filter(r => !ids.has(r))).toEqual([]);
  });

  it('dates are ISO and every principle is adopted at or after its milestone', () => {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const mDates = Object.fromEntries(
      [...MILESTONES.matchAll(/id:\s*'([^']+)',\s*\n\s*date:\s*'([^']+)'/g)].map(m => [m[1], m[2]]),
    );
    expect(Object.values(mDates).every(d => iso.test(d))).toBe(true);

    const pairs = [...PRINCIPLES.matchAll(
      /adopted:\s*'([^']+)',\s*\n\s*milestone:\s*'([^']+)'/g,
    )];
    expect(pairs.length).toBeGreaterThan(8);
    const bad = pairs
      .filter(([, adopted, ms]) => !iso.test(adopted) || adopted < mDates[ms])
      .map(([, adopted, ms]) => `${ms} (${mDates[ms]}) has a rule adopted ${adopted}`);
    expect(bad).toEqual([]);
  });

  it('ids are unique — the slider and the JSON both key on them', () => {
    for (const block of [PRINCIPLES, MILESTONES]) {
      const ids = readString(block, 'id');
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('the gate listed on the page is the gate the repo actually runs', () => {
    // A published gate that does not match package.json would send an agent
    // down a procedure that fails on the first command.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const script of ['lint', 'check:dashboard', 'test', 'golden:check']) {
      expect(pkg.scripts[script], `package.json is missing "${script}"`).toBeTruthy();
      expect(src).toContain(`npm run ${script === 'test' ? 'test' : script}`.replace('npm run test', 'npm test'));
    }
  });
});
