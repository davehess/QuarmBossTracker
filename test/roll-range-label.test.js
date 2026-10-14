// test/roll-range-label.test.js — a roll set whose range does not start at 0 shows the whole range.
//
// The guild lead, 2026-10-12: "Need to see the range if it's not 0 to X". A set rolled 999 to 999 sat
// in the Command Center as "999 (Spectral Parchment)", the same label as an ordinary 0 to 999 roll.
// The dashboard and /rolls already print from–to; the Command Center printed only the top.
//
// Run: npx vitest run test/roll-range-label.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const cmd = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'command.html')));

describe('Command Center roll-set label', () => {
  it('prefixes the low end when it is not 0, and keeps the plain top for a 0-based roll', () => {
    const at = cmd.indexOf('<div class="row roll-row"><span class="nm"><b>');
    expect(at).toBeGreaterThan(-1);
    const header = cmd.slice(at, cmd.indexOf('</b>', at));
    expect(header).toContain("(rs.from ? rs.from + '–' : '') + rs.to");
  });
});
