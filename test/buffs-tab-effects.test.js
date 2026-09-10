// test/buffs-tab-effects.test.js — the Buffs tab says what each buff gives you,
// and sums up what you are carrying.
//
// Hitya, 2026-09-02: "The buffs on the buffs page should give the affects that
// they're providing each, and then a summary below of all of the things that
// are provided."
//
// ⚠ THE SUMMARY LISTS, IT NEVER ADDS. EQ does not stack two buffs of the same
// kind — the stronger one applies and the other is doing nothing. Summing them
// would invent a number the game never gives you, and it is exactly the number
// someone would then plan around.
//
// Run: npx vitest run test/buffs-tab-effects.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

// dashboard.html is the AUTHORITATIVE source; WEB_HTML is its machine-folded
// copy (check:dashboard fails the build on drift), so testing the .html tests
// what ships.
const src = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');

const { _wpBuffFx, _wpBuffSummary } = evalBlock(
  `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }\n`
  + sliceBlock(src, 'function _wpBuffFx(fx) {', '\n// ── Buffs tab '),
  ['_wpBuffFx', '_wpBuffSummary'],
);

const { _wpSecs } = evalBlock(
  sliceBlock(src, 'function _wpSecs(secs) {', '\n// What a buff gives you, on its own card.'),
  ['_wpSecs'],
);

const buff = (name, fx) => ({ name, fx });

describe('effects on the buff card', () => {
  it('lists every effect the buff provides', () => {
    const html = _wpBuffFx(['Target size +25%', 'Magnification 115%', 'Mana +3/tick', 'See Invisible']);
    for (const f of ['Target size +25%', 'Magnification 115%', 'Mana +3/tick', 'See Invisible']) {
      expect(html).toContain(f);
    }
  });

  it('renders nothing at all for a buff the catalog does not know', () => {
    // Must degrade to exactly the old card, not to an empty bordered strip.
    expect(_wpBuffFx(null)).toBe('');
    expect(_wpBuffFx([])).toBe('');
    expect(_wpBuffFx(undefined)).toBe('');
  });

  it('escapes the effect text', () => {
    expect(_wpBuffFx(['<script>x</script>'])).not.toContain('<script>');
  });
});

describe('the summary underneath', () => {
  it('gathers each stat with the buff that provides it', () => {
    const html = _wpBuffSummary([
      buff('Girdle of Karana', ['STR +42']),
      buff('Mask of the Stalker', ['Mana +3/tick', 'See Invisible']),
      buff('Ancient: Legacy of Blades', ['Damage shield 34/hit']),
    ]);
    expect(html).toContain('STR');
    expect(html).toContain('+42');
    expect(html).toContain('Girdle of Karana');
    expect(html).toContain('See Invisible');
    expect(html).toContain('Damage shield');
    expect(html).toContain('Ancient: Legacy of Blades');
  });

  it('does NOT add two buffs of the same stat together', () => {
    // The whole point. 128 and 141 haste is not 269 haste; it is one of them
    // doing nothing.
    const html = _wpBuffSummary([
      buff('Celerity', ['Haste +28%']),
      buff('Swift like the Wind', ['Haste +41%']),
    ]);
    expect(html).toContain('+28%');
    expect(html).toContain('+41%');
    expect(html).not.toContain('+69%');
  });

  it('says out loud that same-stat buffs do not stack', () => {
    const html = _wpBuffSummary([
      buff('Celerity', ['Haste +28%']),
      buff('Swift like the Wind', ['Haste +41%']),
    ]);
    expect(html).toMatch(/do not stack/i);
  });

  it('does not print the not-stacking note for a stat with one source', () => {
    const html = _wpBuffSummary([buff('Girdle of Karana', ['STR +42'])]);
    expect(html).not.toMatch(/do not stack/i);
  });

  it('splits a flag effect from a numeric one', () => {
    // "See Invisible" has no amount and is its own stat; "STR +42" splits into
    // stat and amount so the column lines up.
    const html = _wpBuffSummary([buff('Mask of the Stalker', ['See Invisible', 'STR +42'])]);
    expect(html).toContain('See Invisible');
    expect(html).toContain('STR');
    expect(html).toContain('+42');
  });

  it('renders nothing when no buff has known effects', () => {
    expect(_wpBuffSummary([buff('Something Unknown', null)])).toBe('');
    expect(_wpBuffSummary([])).toBe('');
  });

  it('ignores buffs without effects while keeping the ones that have them', () => {
    const html = _wpBuffSummary([buff('Unknown Thing', null), buff('Girdle of Karana', ['STR +42'])]);
    expect(html).toContain('+42');
    expect(html).not.toContain('Unknown Thing');
  });
});

describe('wiring', () => {
  const clean = stripJs(src);
  it('puts the effects on the card', () => {
    expect(clean).toMatch(/_wpBuffFx\(b\.fx\)/);
  });
  it('puts the summary under each character, not once for all of them', () => {
    // Buffs are per character; one merged column across five boxes would read
    // as one character with five sets of stats.
    // ⚠ Anchored on the CALL, not the name: /_wpBuffSummary\(list\)/ also matches
    // the function's own declaration, so deleting the call site left this green.
    expect(clean).toMatch(/h \+= _wpBuffSummary\(list\);/);
  });
  it('the agent supplies the effects per active buff', () => {
    const agent = stripJs(fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8'));
    expect(agent).toMatch(/fx: _buffEffectsFor\(b\.name\)/);
    // Backtick possessives — EQ logs "Talisman of Altuna" style names with a
    // backtick where the catalog stores an apostrophe.
    expect(agent).toMatch(/_spellByNameLower\.get\(k\.replace\(\/`\/g, "'"\)\)/);
  });
});

// ⚠ THE BUG THIS CLASS EXISTS TO PREVENT. The Buffs tab shipped with a seconds
// formatter declared as _wpDur — a name already taken further down the same
// single-scope file by a MILLISECONDS formatter. Two top-level `function`
// declarations with one name silently resolve to the LAST, so every buff
// rendered at 1/1000 of its real time and nothing threw. Hitya caught it against
// the in-game buff window: Girdle of Karana's 56 minutes read "3s", and its
// 4320-second catalog duration read "~4s".
//
// Expectations below are the GAME's own numbers from that screenshot.
describe('buff times, against what the game shows', () => {
  it("formats Girdle of Karana's catalog duration as the game states it", () => {
    expect(_wpSecs(720 * 6)).toBe('1h 12m');     // spell data: "720 ticks (1h12m)"
  });

  it('formats its remaining time as the buff window shows it', () => {
    expect(_wpSecs(560 * 6)).toBe('56m 00s');    // buff window: 56m
  });

  it("formats Mask of the Stalker's three hours", () => {
    expect(_wpSecs(1800 * 6)).toBe('3h 00m');    // spell data: "1800 ticks [3h]"
  });

  it('never divides seconds by a thousand', () => {
    // The actual regression, pinned directly: these all collapsed to "3s",
    // "9s", "1s", "0s" under the ms formatter.
    expect(_wpSecs(3360)).not.toBe('3s');
    expect(_wpSecs(9846)).not.toBe('9s');
    expect(_wpSecs(1080)).not.toBe('1s');
    expect(_wpSecs(120)).toBe('2m 00s');
  });

  it('still reads small values as seconds', () => {
    expect(_wpSecs(0)).toBe('0s');
    expect(_wpSecs(45)).toBe('45s');
    expect(_wpSecs(null)).toBe('—');
  });
});
