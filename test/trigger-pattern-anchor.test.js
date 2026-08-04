// Save-time guard for #190 — a trigger that can never fire must not be
// creatable. Real-imports web/lib/triggerPattern.ts (the comp.ts pattern).
//
// Background: the agent matches patterns against the RAW log line, which starts
// with "[Sun Aug 02 21:10:01 2026] ", using flags 'i' with no 'm'. So a leading
// `^` anchors before the timestamp and the trigger is dead. 37 of 109 enabled
// triggers were written that way — including eight callouts added the same day
// the defect was found, one of which had been rushed out ahead of a raid.
//
// The cases below don't just assert string rewriting: the important ones
// COMPILE the normalized pattern and run it against a realistic line, because
// "the string looks right" is what everyone already believed about the 37.
//
// Run: npx vitest run test/trigger-pattern-anchor.test.js

import { describe, it, expect } from 'vitest';
import { normalizeTriggerPattern, isDeadAnchored, TIMESTAMP_PREFIX } from '../web/lib/triggerPattern.ts';

const TS = '[Sun Aug 02 21:10:01 2026] ';

// Mirrors the agent's _translateDotNetRegex for the {s} family, so these cases
// exercise what actually ships rather than a simplified stand-in.
function translate(pattern) {
  let p = String(pattern || '').replace(/\(\?>/g, '(?:');
  let i = 0;
  p = p.replace(/\{[sScC]\d*\}/g, () => {
    const name = i === 0 ? 's' : `s${i}`;
    i++;
    return `(?<${name}>[\\w'\` -]+?)`;
  });
  return p;
}
const compile = (pattern) => new RegExp(translate(pattern), 'i');
const runOn = (pattern, body) => compile(pattern).exec(TS + body);

describe('normalizeTriggerPattern — the anchor rewrite', () => {
  it('THE BUG: a bare ^ pattern does not match a real line before normalizing', () => {
    const raw = '^{s} looks somewhat dimwitted\\.$';
    expect(runOn(raw, 'Uilnayar looks somewhat dimwitted.'),
      'if this ever matches, the premise changed — re-read RUNBOOK-dead-triggers.md').toBeNull();
  });

  it('…and does match after normalizing, capturing a CLEAN name', () => {
    const fixed = normalizeTriggerPattern('^{s} looks somewhat dimwitted\\.$');
    const m = runOn(fixed, 'Uilnayar looks somewhat dimwitted.');
    expect(m).not.toBeNull();
    // The leading-space trap: stripping `^` instead would capture " Uilnayar".
    expect(m.groups.s).toBe('Uilnayar');
  });

  it('captures multi-word and backtick mob names', () => {
    const cure = normalizeTriggerPattern('^{s} is entrapped by living shadows\\.$');
    expect(runOn(cure, 'Aten Ha Ra is entrapped by living shadows.').groups.s).toBe('Aten Ha Ra');

    const ae = normalizeTriggerPattern('^{s} falls to the ground and convulses\\.$');
    expect(runOn(ae, 'Rhag`Zhezum falls to the ground and convulses.').groups.s).toBe('Rhag`Zhezum');

    const enrage = normalizeTriggerPattern('^(?:{s} has become) ENRAGED\\.$');
    expect(runOn(enrage, 'a shissar disciple has become ENRAGED.').groups.s).toBe('a shissar disciple');
  });

  it('handles a self-message with no capture at all', () => {
    const p = normalizeTriggerPattern('^You are surrounded by living shadows\\.$');
    expect(runOn(p, 'You are surrounded by living shadows.')).not.toBeNull();
  });

  it('WRAPS a top-level alternation instead of anchoring only its first branch', () => {
    // Without the wrap this becomes `^\[.+?\]\s+A|B`, which reads as
    // "(anchored A) or (unanchored B)" — B silently stops being anchored.
    const p = normalizeTriggerPattern('^You feel weak\\.|You feel strong\\.$');
    expect(p).toBe(TIMESTAMP_PREFIX + '(?:You feel weak\\.|You feel strong\\.$)');
    expect(runOn(p, 'You feel weak.')).not.toBeNull();
    expect(runOn(p, 'You feel strong.')).not.toBeNull();
  });

  it('does NOT treat a | inside a group or a character class as top-level', () => {
    const grouped = normalizeTriggerPattern('^(?:alpha|beta) arrives\\.$');
    expect(grouped).toBe(TIMESTAMP_PREFIX + '(?:alpha|beta) arrives\\.$');   // no extra wrap
    expect(runOn(grouped, 'beta arrives.')).not.toBeNull();

    const klass = normalizeTriggerPattern('^[a|b]oo\\.$');
    expect(klass).toBe(TIMESTAMP_PREFIX + '[a|b]oo\\.$');

    const escaped = normalizeTriggerPattern('^a\\|b\\.$');
    expect(escaped).toBe(TIMESTAMP_PREFIX + 'a\\|b\\.$');
  });

  it('leaves alone everything that already works', () => {
    for (const p of [
      'prepares for carnage!',                 // unanchored
      '^\\[.+?\\]\\s+already normalized$',     // already has the prefix
      '^\\[.+?\\] hand written$',              // hand-written timestamp anchor
      '^.*anything goes$',                     // ^. consumes the timestamp itself
      '^.+ok$',
      '',
    ]) {
      expect(normalizeTriggerPattern(p), `must not rewrite: ${p}`).toBe(p);
    }
  });

  it('is idempotent — re-saving a trigger cannot stack prefixes', () => {
    const once  = normalizeTriggerPattern('^{s} yawns\\.$');
    const twice = normalizeTriggerPattern(once);
    expect(twice).toBe(once);
  });

  it('survives null/undefined without throwing', () => {
    expect(normalizeTriggerPattern(undefined)).toBe('');
    expect(normalizeTriggerPattern(null)).toBe('');
  });
});

describe('isDeadAnchored — flagging the 37 rows already in the table', () => {
  it('flags the real dead patterns we found', () => {
    for (const p of [
      '^{s} yawns\\.$',                                  // Shaman Slow landed
      '^(?:{s} has become) ENRAGED\\.$',                 // Enrage (Begin)
      '^Your mind fills with images of death\\.$',       // Wave of Death — ON YOU
      '^(?<victim>[A-Z][\\w\'`]+) has been slain by ',   // Death touch — RIP
    ]) {
      expect(isDeadAnchored(p), `should be flagged dead: ${p}`).toBe(true);
    }
  });

  it('does not flag working patterns', () => {
    for (const p of [
      'prepares for carnage!',
      '^\\[.+?\\]\\s+fine$',
      '^.*fine$',
      "(?<tank>[A-Z][\\w']+) feels the watchful eyes",   // the DI trigger: unanchored
    ]) {
      expect(isDeadAnchored(p), `should NOT be flagged: ${p}`).toBe(false);
    }
  });

  it('agrees with normalizeTriggerPattern — flagged iff rewritten', () => {
    for (const p of [
      '^{s} yawns\\.$', 'prepares for carnage!', '^.*x$', '^\\[.+?\\]\\s+y$', '^A|B',
    ]) {
      expect(isDeadAnchored(p)).toBe(normalizeTriggerPattern(p) !== p);
    }
  });
});
