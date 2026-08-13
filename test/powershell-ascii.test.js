// test/powershell-ascii.test.js — every .ps1 must be parseable by PowerShell 5.1.
//
// THE RULE: a .ps1 is either pure ASCII, or it carries a UTF-8 BOM. Not both
// required — either one is sufficient, and both are already in use here.
//
// WHY: Windows PowerShell 5.1 (still the default shell on every Windows box we
// support) decodes a .ps1 using the system ANSI codepage unless the file starts
// with a UTF-8 BOM. Our house style is full of em-dashes and arrows; in a
// BOM-less UTF-8 file an em-dash arrives as three bytes whose third is a quote
// character. That quote terminates the nearest string, and the parser then
// reports "missing terminator" and "unexpected }" at lines nowhere near the
// real problem.
//
// Not hypothetical: the first cut of scripts/pack-item-icons.ps1 was BOM-less
// UTF-8 with nine non-ASCII characters and would not parse AT ALL on Hitya's
// machine, failing with three cascading errors pointing at the wrong lines.
//
// ⚠ The first version of THIS test demanded ASCII unconditionally, which would
// have failed install-node.ps1 and start-logsync.ps1 — two shipped, working
// scripts that solve it with a BOM instead. Enforce the real invariant, not the
// one fix that happened to be in front of me.
//
// Run: npx vitest run test/powershell-ascii.test.js

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

// git ls-files, NOT a filesystem walk: the repo accumulates .claude/worktrees/
// copies from subagent runs, and walking them checks stale duplicates of files
// that are already covered by their tracked original.
const files = execFileSync('git', ['ls-files', '*.ps1'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

describe('PowerShell scripts parse under Windows PowerShell 5.1', () => {
  it('finds the tracked .ps1 files', () => {
    // Guards the guard: if `git ls-files` stops matching, the suite would pass
    // vacuously forever.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const rel of files) {
    it(`${rel} is ASCII-only or BOM-tagged`, () => {
      const buf = fs.readFileSync(path.join(ROOT, rel));
      const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      if (hasBom) return;                      // BOM settles the encoding

      const offenders = [];
      for (let i = 0; i < buf.length && offenders.length < 5; i++) {
        if (buf[i] > 0x7f) {
          const line = buf.subarray(0, i).toString('latin1').split('\n').length;
          offenders.push(`line ${line}: byte 0x${buf[i].toString(16)}`);
        }
      }
      expect(offenders,
        `${rel} is BOM-less UTF-8 with non-ASCII bytes. PowerShell 5.1 will read `
        + `these in the ANSI codepage and fail to parse. Either use plain ASCII `
        + `(-, ->, (!)) or save the file with a UTF-8 BOM.`).toEqual([]);
    });
  }
});
