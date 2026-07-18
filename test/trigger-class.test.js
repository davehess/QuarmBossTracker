// _translateDotNetRegex `{s}`-placeholder compile — SOURCE-SLICE fidelity tier.
//   Source: packages/wolfpack-logsync/index.js (function _translateDotNetRegex,
//     ~line 20614). Internal/unexported in a single-file zero-dep agent, so we
//     slice the real block out of the shipped source and eval it (see
//     test/_source-slice.js). Edit the function and this suite exercises the new
//     behavior; rename/delete it and the slice throws loudly.
//
// _translateDotNetRegex turns an EQLogParser/GINA `.NET` trigger pattern into a
// JS RegExp source: `(?>...)` atomic groups become `(?:...)`, and each
// `{s}`/`{S}`/`{c}` placeholder becomes a NAMED capture (`s`, `s1`, …) with a
// permissive name char class `[\w'` -]+?` (word char + apostrophe + BACKTICK +
// space + hyphen) so multi-word AND backtick-bearing EQ mob names still match
// anchored patterns like `{s} has become ENRAGED.`.
//
// UPGRADED from MIRROR → SOURCE-SLICE (2026-07-18): the `{s}` backtick fix
// (agent 3.3.75) landed on main with the 1.9 beta graduation, so the real
// function now includes the backtick in its char class and can be sliced
// directly. Cases unchanged from the mirror they replaced.

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

// Slice the real _translateDotNetRegex (self-contained: only String + replace).
const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _translateDotNetRegex(pattern) {',
  '  return p;\n}',
);
const { _translateDotNetRegex } = evalBlock(block, ['_translateDotNetRegex']);

// The real function returns an UNANCHORED JS regex source; the live evaluator
// anchors with ^...$, so mirror that here.
function fires(pat, line) {
  const rx = new RegExp('^' + _translateDotNetRegex(pat) + '$', 'i');
  return rx.exec(line);
}

describe('trigger {s} placeholder → named capture (source-sliced from agent)', () => {
  it('sliced the real function', () => {
    expect(typeof _translateDotNetRegex).toBe('function');
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
});
