// test/trigger-pattern-compiler.test.js — compileTriggerPattern, the unified
// GINA / EQLogParser / native trigger-pattern pipeline.
//
// Background (pq-companion comparison, analysis 01, 2026-08-07): the old pair
// of translators left 92 of 583 corpus patterns throwing at compile, all 311
// ^-anchored imports structurally dead (we match the RAW timestamped line;
// GINA/EQLP strip the timestamp first), {s1}/{s2} renumbered by position so
// action text spoke the wrong capture, and {c} compiled to a wildcard that
// fired for every player. Vectors below are the report's, verified against
// its fixture corpus.
//
// Run: npx vitest run test/trigger-pattern-compiler.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _scanRegexSource(src, visit) {',
  '\n  return bag;\n}',
);

const harness = `
  const stats = { watchedLogs: [] };
  function _escapeForLiteralMatch(s) {
    return String(s || '').replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }
` + block + `
  return { compileTriggerPattern, _captureConditionsPass, _buildCaptureBag,
           _rewriteAnchorsForRawLine, _normalizeRegexDialect, _expandTriggerTokens };
`;
// eslint-disable-next-line no-new-func
const H = new Function(harness)();

const TS = '[Tue Aug 04 21:14:33 2026] ';

describe('anchor rewrite — imported ^ patterns fire on raw lines', () => {
  it('vector 1: charm-break with plain parens', () => {
    const c = H.compileTriggerPattern("^Your (Charm|Beguile|Allure|Boltran`s Agacerie) spell has worn off of (.*).");
    const m = c.regex.exec(TS + 'Your Allure spell has worn off of a stone golem.');
    expect(m).toBeTruthy();
    const bag = H._buildCaptureBag(m, TS + '…', {}, c.aliases);
    expect(bag['2']).toBe('a stone golem');
  });

  it('vector 2: ^{s1} binds the token digit, not the position', () => {
    const c = H.compileTriggerPattern('^{s1} has become ENRAGED.');
    const m = c.regex.exec(TS + 'Aten Ha Ra has become ENRAGED.');
    expect(m.groups.s1).toBe('Aten Ha Ra');   // old code named this `s`
  });

  it('vector 3: multi-token raid-assist — {s2} spans ",  \'" (the old class could not)', () => {
    const c = H.compileTriggerPattern('^{s1} tells the raid{s2}assist{s3}(me|on|assist){s4}');
    const m = c.regex.exec(TS + "Grokii tells the raid,  'assist on Aten Ha Ra'");
    expect(m.groups.s1).toBe('Grokii');
  });

  it('vector 10: legacy Wolfpack \\]-idiom patterns are untouched — no regression', () => {
    const c = H.compileTriggerPattern('\\]\\s+(?<victim>[A-Za-z]+) has been slain by');
    expect(c.anchorsRewritten).toBe(0);
    const m = c.regex.exec(TS + 'Hitya has been slain by Aten Ha Ra');
    expect(m.groups.victim).toBe('Hitya');
  });

  it('[^abc] negated classes are not mistaken for anchors', () => {
    const c = H.compileTriggerPattern('^You hear [^a]+ noise');
    expect(c.anchorsRewritten).toBe(1);        // only the real anchor
    expect(c.regex.test(TS + 'You hear x noise')).toBe(true);
  });
});

describe('dialect normalisation', () => {
  it('vector 6: scoped inline flags (?i:…) compile instead of throwing', () => {
    const c = H.compileTriggerPattern(
      "^(?!(?:zotmule)(?!\\w))(?<seller>[A-Za-z]*) auctions, '(?i:WTS|selling).*(?<item>(?i:blade of earth)).*'");
    const m = c.regex.exec(TS + "Ferrin auctions, 'WTS Blade of Earth 20k'");
    expect(m.groups.seller).toBe('Ferrin');
    expect(m.groups.item).toBe('Blade of Earth');
  });

  it('(?P<name>…) Go form and (?#comments) normalise; \\k<name> backrefs survive', () => {
    const c = H.compileTriggerPattern('(?P<caster>\\w+)(?# who) says (?<w>\\w+) and \\k<w> again');
    const m = c.regex.exec(TS + 'Hopeya says go and go again');
    expect(m.groups.caster).toBe('Hopeya');
  });

  it('duplicate named groups rename with an alias, and the bag folds them back', () => {
    const c = H.compileTriggerPattern('(?:(?<who>\\w+) yells|shouts (?<who>\\w+))');
    const m = c.regex.exec(TS + 'shouts Melting');
    const bag = H._buildCaptureBag(m, '', {}, c.aliases);
    expect(bag.who).toBe('Melting');
  });

  it('vector 9: {2,3} repetition passes through untouched', () => {
    const c = H.compileTriggerPattern('^You have become better at ([A-Za-z ]*)! \\(([0-9]{1,3})\\)');
    const m = c.regex.exec(TS + 'You have become better at Baking! (121)');
    const bag = H._buildCaptureBag(m, '', {}, c.aliases);
    expect(bag['1']).toBe('Baking');
    expect(bag['2']).toBe('121');
  });
});

describe('tokens', () => {
  it('vector 4: bare {s} keeps the name `s` (charm-pet filter compat) and {n} exists now', () => {
    const c = H.compileTriggerPattern('^{s} won the need roll on {n} items.');
    const m = c.regex.exec(TS + 'Melting won the need roll on 2 items.');
    expect(m.groups.s).toBe('Melting');
    expect(m.groups.n).toBe('2');
  });

  it('vector 5: {c} matches YOUR characters only — never a wildcard', () => {
    const c = H.compileTriggerPattern('^{c} begins watching the time.', { characters: ['Grokii'] });
    expect(c.regex.test(TS + 'Grokii begins watching the time.')).toBe(true);
    expect(c.regex.test(TS + 'Melting begins watching the time.')).toBe(false);
  });

  it('{c} with no known character stays literal (unmatchable), with a warning', () => {
    const c = H.compileTriggerPattern('^{c} begins casting.', { characters: [] });
    expect(c.regex.test(TS + 'Grokii begins casting.')).toBe(false);
    expect(c.warnings.some(w => w.includes('left literal'))).toBe(true);
  });

  it('vector 7: numeric guards gate the fire', () => {
    const c = H.compileTriggerPattern('^(?<mob>.+) (?<action>\\w+) YOU for {N>=50000} points of damage.');
    const hit = c.regex.exec(TS + 'Aten Ha Ra kicks YOU for 61000 points of damage.');
    expect(H._captureConditionsPass(c.conditions, hit.groups)).toBe(true);
    const weak = c.regex.exec(TS + 'Aten Ha Ra kicks YOU for 900 points of damage.');
    expect(H._captureConditionsPass(c.conditions, weak.groups)).toBe(false);
  });

  it('{target}/{seller}-style non-token braces pass through to the dialect layer', () => {
    // Unknown alpha keys are left alone by the token pass — they are either
    // template-only tokens or (as here) become a literal that never matches.
    const c = H.compileTriggerPattern('hail, {target}');
    expect(c.regex.test(TS + 'hail, {target}')).toBe(true);
  });
});

describe('capture bag extras', () => {
  it('exposes {L} (whole line) and {sN}→numbered fallback for plain parens', () => {
    const c = H.compileTriggerPattern('^(\\w+) won the roll');
    const line = TS + 'Melting won the roll';
    const m = c.regex.exec(line);
    const bag = H._buildCaptureBag(m, line, {}, c.aliases);
    expect(bag.L).toBe(line);
    expect(bag.s1).toBe('Melting');   // {s1} answers even for plain ( )
  });
});
