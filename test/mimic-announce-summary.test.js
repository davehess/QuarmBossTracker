// Mimic release announcer — the Discord card's body. SOURCE-SLICE tier.
//
// Field report (Uilnayar 2026-08-05, screenshot of the v2.3.0 and v2.3.1
// cards): "This wall of text is unreadable." Two defects, both visible:
//
//   1. The bold subject line appeared TWICE — once as the embed title (which
//      is derived from it) and again as the first line of the description.
//   2. The description was the release COMMIT MESSAGE, budgeted at 20 lines /
//      1550 chars. Release commits here carry file-checkout rationale, blast
//      radius, promotion mechanics and test counts — none of which a raider
//      wants — and the budget cut mid-sentence anyway.
//
// The card is the one artifact raiders read about a release, so the summary is
// now a LEDE + the bullet block, with everything else one click away.
//
// Run: npx vitest run test/mimic-announce-summary.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// The real shipped _summaryOf, lifted out of _announceMimicReleases.
const summaryOf = (() => {
  const block = sliceBlock(src, '  const _summaryOf = (rel) => {', "\n  };");
  // eslint-disable-next-line no-new-func
  return new Function(block.replace(/^\s*const _summaryOf =/, 'const _summaryOf =')
    + '\nreturn _summaryOf;')();
})();

// The two bodies from the screenshot, verbatim in shape: bold subject, prose
// paragraphs, a bullet block, then more prose.
const V231_BODY = `**Mimic v2.3.1 stable — Zeal tag capture + same-name split to the whole fleet**

Graduates the beta line (Mimic 2.3.1, agent 3.5.29 → 3.5.36) so tonight's raid
runs #194 on stable and the tank-side work can land on a clean beta afterwards.

File-level promotion, NOT a branch merge: beta is 68k lines behind main on
bot/web, so only packages/wolfpack-logsync/**, apps/mimic/extarget.html + its
package.json, and the three agent-side test files are taken across. Golden
fixtures verified identical on both branches before the swap.

What reaches the fleet:
  · #194 Zeal /tag capture — the broadcast carries the mob's TRUE spawn id, the
    field the pipe has never exposed.
  · #194 same-name instance split — two same-name adds tanked apart show as
    separate rows with per-row tank labels and debuff attribution.
  · One Mimic covers the raid's positions and observed tanks.
  · zeal.ini readiness card that names the settings which draw the nameplate
    arrow while broadcasting nothing.
  · Pet tracker: a new pet no longer inherits the previous pet's buffs.

1134 tests, lint, dashboard check and golden:check all clean on this tree.
Pushed with four agents online and none in combat.

---

Install boilerplate nobody reads.`;

describe('release card summary', () => {
  const out = summaryOf({ body: V231_BODY });

  it('never repeats the subject line — the title is already built from it', () => {
    // The exact duplication in the screenshot.
    expect(out).not.toMatch(/Zeal tag capture \+ same-name split to the whole fleet/);
    expect(out.startsWith('**')).toBe(false);
  });

  it('leads with the first prose paragraph', () => {
    expect(out).toMatch(/^Graduates the beta line/);
  });

  it('keeps the bullet block — that is the "what you get" part', () => {
    expect(out).toMatch(/Zeal \/tag capture/);
    expect(out).toMatch(/same-name instance split/);
    expect(out).toMatch(/Pet tracker/);
  });

  it('drops the engineering prose a raider will not read', () => {
    expect(out, 'promotion mechanics').not.toMatch(/branch merge|68k lines|packages\/wolfpack-logsync/);
    expect(out, 'test counts').not.toMatch(/1134 tests|golden:check/);
    expect(out, 'below the --- rule').not.toMatch(/Install boilerplate/);
  });

  it('fits on a screen — this is the whole complaint', () => {
    expect(out.length).toBeLessThanOrEqual(900);
    // The old budget allowed 20 lines; the wall in the screenshot was ~18.
    expect(out.split('\n').filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it('clips at a sentence boundary, never mid-word', () => {
    const long = '**Subject**\n\n' + ('The quick brown fox jumps over the lazy dog. '.repeat(40));
    const s = summaryOf({ body: long });
    expect(s.length).toBeLessThanOrEqual(900);
    expect(s, 'no dangling partial word').toMatch(/(\.|…)$/);
  });

  it('a bullet-only body still produces a card', () => {
    const s = summaryOf({ body: '**Subject**\n\n· one thing\n· another thing\n' });
    expect(s).toMatch(/· one thing/);
    expect(s).toMatch(/· another thing/);
  });

  it('a body with no bullets at all is just the lede', () => {
    const s = summaryOf({ body: '**Subject**\n\nOne short paragraph about the release.\n\nA second one that is dropped.' });
    expect(s).toBe('One short paragraph about the release.');
  });

  it('a long bullet list cannot reintroduce the wall', () => {
    const many = '**Subject**\n\nLede.\n\n' + Array.from({ length: 30 }, (_, i) => `· bullet ${i}`).join('\n');
    const s = summaryOf({ body: many });
    expect(s.split('\n').filter(l => l.startsWith('·')).length).toBe(5);
  });

  it('the lede skips a bullet block that comes FIRST', () => {
    // A body that opens with bullets (no prose lede) must not have its first
    // bullet promoted to the lede and then repeated in the bullet list.
    const s = summaryOf({ body: '**Subject**\n\n· first bullet\n· second bullet\n\nThe prose lede.' });
    expect(s.startsWith('The prose lede.'), 'prose leads even when bullets come first').toBe(true);
    expect(s.match(/first bullet/g), 'and the bullet appears exactly once').toHaveLength(1);
  });

  it('the hard cap binds when a max-length lede meets a full bullet list', () => {
    // lede 340 + 5 bullets × ~132 = ~1000 > 900. Without the final slice the
    // per-part clips alone are not enough.
    const lede = 'x'.repeat(400);
    const bullets = Array.from({ length: 5 }, () => '· ' + 'y'.repeat(200)).join('\n');
    const s = summaryOf({ body: `**Subject**\n\n${lede}\n\n${bullets}` });
    expect(s.length).toBeLessThanOrEqual(900);
  });

  it('an empty or missing body degrades to empty, not a crash', () => {
    expect(summaryOf({ body: '' })).toBe('');
    expect(summaryOf({})).toBe('');
  });
});
