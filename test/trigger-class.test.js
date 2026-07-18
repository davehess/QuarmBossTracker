// MIRROR: _translateDotNetRegex `{s}`-placeholder compile
//   Source: packages/wolfpack-logsync/index.js  (function _translateDotNetRegex, ~line 19852)
//   Tier:   MIRROR (last resort) — see drift note below.
//
// _translateDotNetRegex turns an EQLogParser/GINA `.NET` trigger pattern into a
// JS RegExp source: `(?>...)` atomic groups become `(?:...)`, and each
// `{s}`/`{S}`/`{c}` placeholder becomes a NAMED capture (`s`, `s1`, …) with a
// permissive name char class so multi-word and punctuated EQ mob names still
// match anchored patterns like `{s} has become ENRAGED.`.
//
// ⚠ DRIFT: the SHIPPED char class as of this port (main @ 243888e) is
//   `[\\w' -]+?`  — it does NOT include the backtick. Real Quarm boss names use
//   a backtick ("Rhag`Zhezum", "Aten`Ha`Ra", "Yar`Lir"), so those `{s}` triggers
//   silently never fire under the shipped code. This suite mirrors the INTENDED
//   fix — char class `[\\w'` -]+?` (backtick added) — which the scratchpad
//   characterization test asserts. It cannot be source-sliced today because the
//   sliced real function would fail these cases. WHEN the backtick lands in
//   _translateDotNetRegex, delete this mirror and source-slice the real function
//   instead (test/_source-slice.js). If the shipped char class changes shape,
//   this copy will drift from it undetected — that is the cost of the mirror.
//
// Ported from the session's scratchpad backtick_test.js (5 cases).

import { describe, it, expect } from 'vitest';

// Mirror of the {s}/{S}/{c} compile with the intended backtick-inclusive class.
function translate(pattern) {
  let p = String(pattern || '');
  p = p.replace(/\(\?>/g, '(?:');        // atomic group → non-capturing
  let sIdx = 0;
  p = p.replace(/\{[sScC]\d*\}/g, () => {
    const name = sIdx === 0 ? 's' : `s${sIdx}`;
    sIdx++;
    return `(?<${name}>[\\w'\` -]+?)`;    // word char + apostrophe + BACKTICK + space + hyphen
  });
  return p;
}

function fires(pat, line) {
  const rx = new RegExp('^' + translate(pat) + '$', 'i');
  return rx.exec(line);
}

describe('trigger {s} placeholder → named capture (backtick-inclusive class)', () => {
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
