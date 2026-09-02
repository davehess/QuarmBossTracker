// test/dashboard-eaten-backslash.test.js — regexes that lost a backslash.
//
// The old hand-escaped WEB_HTML template literal ate backslashes. That class of
// bug is INVISIBLE: `/^file:(d+)$/` is a perfectly valid regex, it just matches
// a literal "d" instead of a digit, so it never throws, never logs, and reads
// correctly at a glance. Five survivors were still shipping on 2026-08-30, found
// only because one of them produced a raid-night report:
//
//   • /^file:(d+)$/  ×2 — an officer picking a RaidTick file for a DKP tick got
//     "No attendees in that source." (Hitya: "this upload did not work from the
//     raid tick that was taken. copying directly in worked"). 44 players parsed
//     and displayed fine; the CLICK could never resolve "file:0".
//   • .split(/s+/)   ×2 — silently defeated the wp-* class preservation that its
//     own comment describes, so panels hidden by show/hide reappeared on the
//     next 2s poll.
//   • /^✥s*/         ×1 — cosmetic; left the space after the glyph.
//
// The dashboard slice (agent 3.6.9) stopped NEW ones being created. This test
// plus the build check stop old ones surviving unnoticed.
//
// Run: npx vitest run test/dashboard-eaten-backslash.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
// The REAL detector the build check runs — not a copy of it.
const { checkEatenBackslashes } = require(path.join(ROOT, 'scripts', 'check-agent-dashboard.js'));

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const CMD  = path.join(ROOT, 'apps', 'mimic', 'command.html');

// The detector prints to stderr; silence it and count.
function scan(text, label) {
  const err = console.error;
  console.error = () => {};
  const log = console.log;
  console.log = () => {};
  try { return checkEatenBackslashes(text, label); }
  finally { console.error = err; console.log = log; }
}

describe('no regex in a shipped overlay has lost its backslash', () => {
  it('dashboard.html is clean', () => {
    expect(scan(fs.readFileSync(DASH, 'utf8'), 'dashboard.html')).toBe(0);
  });

  it('command.html is clean', () => {
    expect(scan(fs.readFileSync(CMD, 'utf8'), 'command.html')).toBe(0);
  });

  // ⚠ Positive control. Without it, "0 findings" would also be the answer if the
  // detector were broken — the vacuous-assertion trap (CLAUDE.md).
  it('the detector actually catches each of the five real historical bugs', () => {
    const historical = [
      'var m = /^file:(d+)$/.exec(source);',
      "var lc = (live.getAttribute('class') || '').split(/s+/);",
      'var label = (r.label || r.key).replace(/^✥s*/, "");',
      'if (/w+/.test(x)) return 1;',
      'text.match(/D{2}/);',
    ];
    for (const line of historical) {
      expect(scan(line, 'probe')).toBeGreaterThan(0);
    }
  });

  it('...and does not flag the CORRECT spellings', () => {
    const good = [
      'var m = /^file:(\\d+)$/.exec(source);',
      "var lc = (live.getAttribute('class') || '').split(/\\s+/);",
      'var label = (r.label || r.key).replace(/^✥\\s*/, "");',
      'if (/[dsw]+/.test(x)) return 1;',        // a real character class of letters
      'var re = /seconds?/i;',                  // plain letters, no quantifier abuse
      'var re = /already dead/i;',
    ];
    for (const line of good) {
      expect(scan(line, 'probe')).toBe(0);
    }
  });
});

// ── The bug the officer actually hit ───────────────────────────────────────
const src = fs.readFileSync(DASH, 'utf8');
const PLAYERS = sliceBlock(src, 'function _dkpTickPlayers(source) {', '\n}\n');
const POINTS  = sliceBlock(src, 'function _dkpTickPoints(source) {', '\n}\n');

function tick(dkpTick) {
  return evalBlock(
    `var window = { __wpLastState: ${JSON.stringify({ dkpTick })} };\n` + PLAYERS + POINTS,
    ['_dkpTickPlayers', '_dkpTickPoints'],
  );
}

const FILE_ROW = { name: 'RaidTick-2026-08-30_22-55-27.txt', count: 44, points: 1,
                   players: Array.from({ length: 44 }, (_, i) => 'Player' + (i + 1)) };

describe('DKP tick — picking a RaidTick file resolves its attendees', () => {
  it('resolves file:0 to that file’s players', () => {
    const t = tick({ liveRoster: null, files: [FILE_ROW] });
    expect(t._dkpTickPlayers('file:0')).toHaveLength(44);
    expect(t._dkpTickPlayers('file:0')[0]).toBe('Player1');
  });

  it('resolves a file further down the list, not just the first', () => {
    const t = tick({ liveRoster: null, files: [FILE_ROW, { ...FILE_ROW, players: ['Solo'] }] });
    expect(t._dkpTickPlayers('file:1')).toEqual(['Solo']);
  });

  it('reads the points off the chosen file, not the live-roster default', () => {
    const t = tick({ liveRoster: null, files: [{ ...FILE_ROW, points: 3 }] });
    expect(t._dkpTickPoints('file:0')).toBe(3);
  });

  it('still serves the live roster, which was never broken', () => {
    const t = tick({ liveRoster: { players: ['Rockin', 'Canopy'] }, files: [FILE_ROW] });
    expect(t._dkpTickPlayers('roster')).toEqual(['Rockin', 'Canopy']);
    expect(t._dkpTickPoints('roster')).toBe(1);
  });

  it('an out-of-range or unknown source is empty, not a crash', () => {
    const t = tick({ liveRoster: null, files: [FILE_ROW] });
    expect(t._dkpTickPlayers('file:9')).toEqual([]);
    expect(t._dkpTickPlayers('nonsense')).toEqual([]);
    expect(t._dkpTickPoints('file:9')).toBe(1);
  });
});
