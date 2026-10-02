// test/ext-target-main-assist.test.js — the overlay marks the main assist's target.
//
// The guild lead, 2026-10-02: "when someone is declared as main assist in raid chat, their target
// should be at the top of the extended target list." The bot (utils/mainAssist.js, bot 3.1.186)
// moves that row first and flags it `ma_target`, and names the MA in `main_assist`; the overlay
// says so on the row and in the header.
//
// Run: npx vitest run test/ext-target-main-assist.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const clean = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8'));

describe('Extended Target: main assist', () => {
  it('marks the row the bot pinned as the MA\'s target', () => {
    expect(clean).toMatch(/if \(t\.ma_target\) nm \+= '<span class="tank-tag"[^']*>MA<\/span>'/);
  });
  it('names the main assist in the header', () => {
    expect(clean).toMatch(/var ma = payload && payload\.main_assist;/);
    expect(clean).toMatch(/'">MA ' \+ esc\(ma\.name\)/);
  });
});
