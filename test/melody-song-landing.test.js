// test/melody-song-landing.test.js — songs sung from /melody count as cast, so their landings reach Target Info.
//
// The guild lead, 2026-10-13: "Pacify songs like Silent Song of Quelius should show on the target info."
// Quarm logs no "You begin singing X." for melody-queued songs, so a melody song's landing line ("A gnoll appears at
// ease.") never matched a cast. Zeal's casting label does change per song; during an active /melody the agent now
// records that as the cast, with a stand-in line in the same shape as the log's.
//
// Run: npx vitest run test/melody-song-landing.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, stripJs, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const js = stripJs(src);

describe('melody songs count as cast (2026-10-13)', () => {
  it('the stand-in line parses as a cast of the song, like a logged one', () => {
    const line = src.split('\n').find(l => l.startsWith('const _CAST_BEGIN_RX = '));
    const { _CAST_BEGIN_RX } = evalBlock(line, ['_CAST_BEGIN_RX']);
    const m = ('[] You begin singing Silent Song of Quellious.').match(_CAST_BEGIN_RX);
    expect(m && m[1]).toBe('Silent Song of Quellious');
    expect('[Tue Oct 13 02:10:01 2026] You begin singing Silent Song of Quellious.'.match(_CAST_BEGIN_RX)[1]).toBe('Silent Song of Quellious');
  });
  it('the Zeal casting-label change records the cast only while a /melody is playing', () => {
    expect(js).toMatch(/const _mel = _bardMelody\.get\(String\(character\)\.toLowerCase\(\)\);\s*if \(_mel && _mel\.melodyActive\) \{\s*try \{ noteSelfCast\('\[\] You begin singing ' \+ newCasting \+ '\.', character\); \} catch \(e\) \{ void e; \}/);
    // ...inside the same "a new song started" branch that bumps the melody display
    const at = js.indexOf("noteSelfCast('[] You begin singing ' + newCasting");
    const bump = js.lastIndexOf('_bumpBardMelody(character, newCasting', at);
    expect(bump).toBeGreaterThan(-1);
    expect(at - bump).toBeLessThan(600);
  });
});
