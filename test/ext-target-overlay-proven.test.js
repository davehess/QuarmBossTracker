// test/ext-target-overlay-proven.test.js — the overlay stops warning about a
// row it can now be certain of.
//
// The asterisk on the Extended Target overlay is a WARNING: "this row's
// debuffs may belong to a different mob of the same name, because the pipe
// cannot tell them apart." Zeal PR #229 puts the spawn id on the pipe, so for
// a row the bot marks `id_proven` that warning is simply false.
//
// ⚠ The subtle half is the FOOTER. It prints a legend explaining the asterisk
// whenever any row is ambiguous. Leave that keyed on `ambiguous` alone and a
// board of entirely id-proven rows explains a symbol that is not on screen —
// which reads as a warning about rows that are, in fact, certain.
//
// ⚠ `ambiguous` deliberately STAYS TRUE on a proven split (it also gates the
// bot's name-keyed restore cache), so the overlay must read `id_proven` rather
// than assume the bot cleared `ambiguous`.
//
// Run: npx vitest run test/ext-target-overlay-proven.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
const clean = stripJs(src);

describe('a proven row shows its id, not a caveat', () => {
  it('branches on id_proven BEFORE the ambiguous warning', () => {
    const i = clean.indexOf('if (t.id_proven)');
    const j = clean.indexOf('} else if (t.ambiguous) {');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);            // else-if, so they cannot both render
  });

  it('renders the spawn id on the proven row', () => {
    expect(clean).toMatch(/class="known"[^']*#' \+ esc\(t\.spawn_id/);
  });

  it('keeps the asterisk for rows that are still guesses', () => {
    expect(clean).toContain('class="amb"');
    expect(clean).toContain('Non-unique name');
  });

  it('does not reuse the warning colour for the settled marker', () => {
    // The amber asterisk means "this might be the wrong mob"; borrowing its
    // colour would carry the alarm over to a row that has none.
    const amb = /\.row \.amb\{color:(#[0-9a-f]{3,6})/i.exec(clean);
    const known = /\.row \.known\{color:(#[0-9a-f]{3,6})/i.exec(clean);
    expect(amb).toBeTruthy();
    expect(known).toBeTruthy();
    expect(known[1].toLowerCase()).not.toBe(amb[1].toLowerCase());
  });
});

describe('the footer legend', () => {
  it('is not summoned by a row that shows no asterisk', () => {
    expect(clean).toContain('if (t.ambiguous && !t.id_proven) anyAmb = true;');
  });

  it('still explains the asterisk when an unproven row is on the board', () => {
    expect(clean).toMatch(/if \(anyAmb\) footParts\.push/);
  });
});

describe('it reads the bot’s flag rather than assuming', () => {
  it('never treats id_proven as implying ambiguous was cleared', () => {
    // The bot keeps `ambiguous` true on a proven split on purpose.
    expect(clean).not.toMatch(/id_proven[^;\n]*ambiguous\s*=\s*false/);
  });

  it('leaves the same-name debuff pooling alone for now', () => {
    // Un-pooling proven rows is the next step, but it needs real multi-reporter
    // id data to validate against — nobody but the author runs a patched Zeal
    // yet, and wrong per-mob debuffs are worse than pooled ones.
    expect(clean).toContain('if (gt.ambiguous || (gt.same_name_count && gt.same_name_count > 1))');
  });
});
