// The decision record by feature set (docs/decisions/, the guild lead, 2026-10-28; DECISIONS §456): every set
// file parses, every entry is in the ID index, IDs are unique, and the numbered entries the code cites resolve.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SETS, readAll, readInbox } = require('../scripts/decisions/build.js');
const DIR = path.join(__dirname, '..', 'docs', 'decisions');

describe('docs/decisions', () => {
  const all = readAll();

  it('has a file per set and every entry in a known set', () => {
    for (const [set] of SETS) expect(fs.existsSync(path.join(DIR, set + '.md'))).toBe(true);
    expect(all.length).toBeGreaterThan(600);
  });

  it('keeps IDs unique and indexed', () => {
    const ids = all.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const index = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
    const missing = ids.filter(id => !index.includes(`| ${id} |`));
    expect(missing).toEqual([]);
  });

  it('resolves the numbered entries CLAUDE.md cites', () => {
    const ids = new Set(all.map(e => e.id));
    for (const n of [79, 80, 101, 108, 117, 135, 192, 348, 406, 455]) expect(ids.has('§' + n)).toBe(true);
  });

  it('accepts the inbox as it stands (each entry carries a valid [set])', () => {
    expect(() => readInbox()).not.toThrow();
  });
});
