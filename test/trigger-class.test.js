// `{s}` placeholder → named capture: the BOSS-NAME cases — SOURCE-SLICE tier.
//
// These cases predate the trigger-pattern compiler. They were written against
// `_translateDotNetRegex`, whose `{s}` was an allow-list char class
// (`[\w'` -]+?`) that had to be widened by hand every time EQ produced a name
// it hadn't anticipated — the backtick fix (agent 3.3.75) was exactly that.
//
// That function was REMOVED on 2026-08-07 and superseded by
// compileTriggerPattern, where `{s}` is `.+?` rather than an allow-list (the
// old class could not span ", '" and killed the whole assist/CH trigger
// family). The cases are kept and re-pointed at the new compiler rather than
// deleted with the function: they are real names off this server, and "the new
// thing is more permissive so they must still pass" is an assumption worth
// holding to a test. The graduation of the 2.3.4 line is what surfaced this —
// the compiler shipped on `beta`, which does not carry this file.
//
// Coverage of the compiler ITSELF (anchors, {c} binding, token digits, dialect
// normalisation) lives in test/trigger-pattern-compiler.test.js.
//
// Run: npx vitest run test/trigger-class.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _scanRegexSource(src, visit) {',
  '\n  return bag;\n}',
);

// compileTriggerPattern reaches for a couple of module-scope helpers; stub the
// two it needs so the slice stands alone (same harness as the compiler suite).
const harness = `
  const stats = { watchedLogs: [] };
  function _escapeForLiteralMatch(s) {
    return String(s || '').replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }
` + block + `
  return { compileTriggerPattern };
`;
const H = new Function(harness)();

// Triggers match the RAW log line — timestamp and all. compileTriggerPattern
// rewrites anchors for that, so feed it a real line.
const TS = '[Sun Aug 02 21:10:45 2026] ';
function fires(pat, body) {
  const c = H.compileTriggerPattern(pat);
  return c.regex.exec(TS + body);
}

describe('trigger {s} placeholder → named capture (real EQ boss names)', () => {
  it('sliced the real compiler', () => {
    expect(typeof H.compileTriggerPattern).toBe('function');
  });

  it('captures a single-backtick boss name', () => {
    const m = fires('{s} has become ENRAGED.', 'Rhag`Zhezum has become ENRAGED.');
    expect(m && m.groups.s).toBe('Rhag`Zhezum');
  });

  it('captures a multi-backtick boss name', () => {
    const m = fires('{s} has become ENRAGED.', 'Aten`Ha`Ra has become ENRAGED.');
    expect(m && m.groups.s).toBe('Aten`Ha`Ra');
  });

  it('still captures a multi-word (space) name', () => {
    const m = fires('{s} has become ENRAGED.', 'Zov Va Dyn has become ENRAGED.');
    expect(m && m.groups.s).toBe('Zov Va Dyn');
  });

  it('captures a backtick name in a different trigger shape', () => {
    const m = fires('{s} says', 'Yar`Lir says');
    expect(m && m.groups.s).toBe('Yar`Lir');
  });

  it('still captures a plain lowercase multi-word NPC name', () => {
    const m = fires('{s} slows down.', 'an ancient croaker slows down.');
    expect(m && m.groups.s).toBe('an ancient croaker');
  });

  // The regression that retired the allow-list: a comma-and-quote name could
  // never match `[\w'` -]+?`, so an entire trigger family was silently dead.
  it('captures a name the old allow-list class could NOT span', () => {
    const m = fires('{s} has become ENRAGED.', "Vessel Drozlin's Guard, the Keeper has become ENRAGED.");
    expect(m && m.groups.s).toBe("Vessel Drozlin's Guard, the Keeper");
  });
});

// Found by graduating the 2.3.4 line to main (2026-08-09). `{s}` became `.+?`
// when compileTriggerPattern replaced the allow-list translator — and `.+?` at
// index 0 of an UNANCHORED pattern happily consumes "[Sun Aug 02 …] " into the
// name. The old class could not match "[", so the engine skipped past the
// timestamp by itself and the bug did not exist.
//
// It matters because CLAUDE.md tells trigger authors to write patterns
// UNANCHORED (a bare ^ anchors before the timestamp and can never fire), so the
// recommended shape was the broken one. A timestamp inside the capture breaks
// every name-keyed consumer at once: charm-pet suppression stops recognising
// your own pet, action text and TTS speak the timestamp aloud, and a captured
// timer key mints a fresh timer on every fire instead of reusing one.
describe('a leading {s} never swallows the timestamp', () => {
  it('the live "Razor Fang" guild trigger captures the name alone', () => {
    const m = fires('{S} is surrounded by an aura of nature.',
                    'a sand giant is surrounded by an aura of nature.');
    expect(m && m.groups.s).toBe('a sand giant');
  });

  it('leaves no bracket or digit from the timestamp in any {s} capture', () => {
    for (const pat of ['{s} has become ENRAGED.', '{s} says', '{s} slows down.']) {
      const m = fires(pat, 'Yar`Lir' + pat.slice(3));
      expect(m, pat).toBeTruthy();
      expect(m.groups.s, pat).toBe('Yar`Lir');
    }
  });

  it('binds the token digit, so {s1} is captured under s1', () => {
    const m = fires('{s1} has become ENRAGED.', 'Aten`Ha`Ra has become ENRAGED.');
    expect(m && m.groups.s1).toBe('Aten`Ha`Ra');
  });

  it('{n} leading a pattern captures the number alone', () => {
    const m = fires('{n} points of damage.', '4823 points of damage.');
    expect(m && m.groups.n).toBe('4823');
  });

  it('still matches a line with NO timestamp — the prefix is optional', () => {
    const c = H.compileTriggerPattern('{s} has become ENRAGED.');
    const m = c.regex.exec('Aten`Ha`Ra has become ENRAGED.');
    expect(m && m.groups.s).toBe('Aten`Ha`Ra');
  });

  it('does not disturb a pattern that opens with literal text', () => {
    // Period ESCAPED — an unescaped one is `any char`, and a lazy {s} then
    // stops after a single letter. That is correct regex behaviour, not a bug,
    // but it is a foot-gun worth spelling out in the fixture.
    const m = fires('Your (.+) spell has worn off of {s}\\.',
                    'Your Allure spell has worn off of a stone golem.');
    expect(m && m.groups.s).toBe('a stone golem');
  });

  it('leaves an explicitly ^-anchored pattern to the anchor rewrite', () => {
    const c = H.compileTriggerPattern('^{s} has become ENRAGED.');
    expect(c.anchorsRewritten).toBe(1);
    const m = c.regex.exec(TS + 'Aten`Ha`Ra has become ENRAGED.');
    expect(m && m.groups.s).toBe('Aten`Ha`Ra');
  });
});
