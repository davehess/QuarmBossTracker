// test/trigger-youify-self.test.js — a callout about YOUR character says "You".
//
// THE BUG (the guild lead, 2026-09-18): the main tank saw Divine Intervention
// announced two different ways for one event. Their own client writes the line
// in second person — "You feel the watchful eyes of the gods upon you." — so
// the trigger's {tank} captures "You" and the flash reads "D.I. ✓ You". But
// every OTHER raider's client sees "<Tank> feels the watchful eyes…", captures
// the NAME, and relays that. The tank's overlay therefore showed their own
// character name from the relays and "You" from themselves, for the same DI.
//
// The fix rewrites a watched character's name to "You" on the two LOCAL
// surfaces (overlay text + spoken text) and nowhere else. The exclusions are
// the load-bearing part of the test: the same expansion also builds the
// cross-raider dedup key and the Discord / raid-voice message, and "You" in
// either of those is a real regression — a key that differs per machine stops
// N raiders collapsing to one fire, and a Discord post reading "You" names
// nobody.
//
// Behaviour-tested by executing the shipped helper: this is a string transform
// whose bugs (word boundaries, case, multiple characters) are invisible to a
// text assertion over the source.
//
// Run: npx vitest run test/trigger-youify-self.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// _youifyForMe reads the module-level `stats.watchedLogs`, so the harness
// supplies one and the REAL function runs against it.
function youify(characters, s) {
  const watchedLogs = characters.map(c => ({ character: c, logPath: 'x' }));
  const { _youifyForMe } = evalBlock(
    'const stats = ' + JSON.stringify({ watchedLogs }) + ';\n'
      + sliceBlock(src, 'function _youifyForMe(s) {', '\n}'),
    ['_youifyForMe'],
  );
  return _youifyForMe(s);
}

describe('a relayed callout naming my character', () => {
  it('reads "You" — the reported DI case', () => {
    expect(youify(['Currygoat'], 'D.I. ✓ Currygoat')).toBe('D.I. ✓ You');
  });

  it('does the same to the spoken line, so flash and speech agree', () => {
    expect(youify(['Currygoat'], 'D I landed on Currygoat')).toBe('D I landed on You');
  });

  it('leaves another raider alone', () => {
    expect(youify(['Currygoat'], 'D.I. ✓ Aldenmar')).toBe('D.I. ✓ Aldenmar');
  });

  it('is case-insensitive — the log does not always match the roster casing', () => {
    expect(youify(['Currygoat'], 'D.I. ✓ CURRYGOAT')).toBe('D.I. ✓ You');
  });

  it('covers every character this machine watches, not just the first', () => {
    expect(youify(['Currygoat', 'Aldenmar'], 'RIP Aldenmar')).toBe('RIP You');
  });
});

describe('what it must NOT touch', () => {
  it('never rewrites a name inside a longer word', () => {
    // Whole-word only. A short character name sitting inside a mob name is the
    // way a naive replace corrupts an unrelated callout.
    expect(youify(['Ash'], 'Ashieron is ENRAGED')).toBe('Ashieron is ENRAGED');
  });

  it('leaves a local fire that already says You alone', () => {
    // EQ already wrote it in second person; there is nothing to rewrite and no
    // double-substitution to make.
    expect(youify(['Currygoat'], 'D.I. ✓ You')).toBe('D.I. ✓ You');
  });

  it('is a no-op when no character is known yet', () => {
    // Agent started, no log tailed yet — must not blank or mangle the callout.
    expect(youify([], 'D.I. ✓ Currygoat')).toBe('D.I. ✓ Currygoat');
  });

  it('passes empty/missing text straight through', () => {
    expect(youify(['Currygoat'], '')).toBe('');
  });
});

describe('the surfaces it is wired into', () => {
  // The exclusions are the whole reason this lives outside _expandTemplate.
  // If someone later "simplifies" it by folding it in there, these fail.
  it('is applied to the overlay text and the spoken text', () => {
    expect(src).toMatch(/const text = _youifyForMe\(_expandTemplate\(a\.text/);
    expect(src).toMatch(/const ttsText = a\.tts \? _youifyForMe\(_expandTemplate\(a\.tts/);
  });

  it('is NOT applied inside _expandTemplate itself', () => {
    // _expandTemplate also builds the dedup key and the Discord/voice message.
    const block = sliceBlock(src, 'function _expandTemplate(template, captures) {', '\n}');
    expect(block).not.toMatch(/_youifyForMe/);
  });

  it('leaves the dedup key and the broadcast message expanding raw', () => {
    // Both must keep resolving to the real NAME so every raider computes the
    // same key and the guild reads a name it recognises.
    expect(src).toMatch(/const key = a\.key \? _expandTemplate\(a\.key, captures \|\| \{\}\) :/);
    expect(src).toMatch(/const msg = _expandTemplate\(a\.message \|\| a\.text \|\| '', captures \|\| \{\}\)\.trim\(\)/);
  });
});
