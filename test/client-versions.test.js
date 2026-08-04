// `/zeal version` → what the client actually has LOADED.
//
// Fixture lines are the REAL output Uilnayar pasted on 2026-08-04, not invented:
//
//   [09:34:08] Zeal version: 1.4.3 (23c766f)
//   [09:34:08] eqw.dll version: 1.0.1 (Jan 20 2026 22:09:32)
//   [09:34:08] eqgame.dll version: 7 (Jul 7 2026 09:14:03)
//
// That matters here more than usual: the last three trigger/parser defects we
// found were all patterns written against TEXT SOMEONE ASSUMED (the invented
// Divine Intervention wording, the mis-signatured AOE_DANCE entry, the 37
// `^`-anchored triggers). This parser is written against a transcript.
//
// Two properties are load-bearing:
//   1. It must anchor PAST the EQ timestamp. Patterns here see the raw line, so
//      a bare `^` would anchor before "[09:34:08]" and never match — the #190
//      trap, in the same file that documents it.
//   2. It must survive the value formats actually observed: a bare semver with
//      a parenthesised git hash, and free-text build dates containing colons,
//      spaces and their own parentheses.
//
// Run: npx vitest run test/client-versions.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

// EQ writes a full timestamp; the in-game display shows only the clock. Use the
// real log form, which is what the tail actually hands the parser.
const P = '[Tue Aug 04 09:34:08 2026] ';
const ZEAL   = 'Zeal version: 1.4.3 (23c766f)';
const EQW    = 'eqw.dll version: 1.0.1 (Jan 20 2026 22:09:32)';
const EQGAME = 'eqgame.dll version: 7 (Jul 7 2026 09:14:03)';

function feed(character, ...bodies) {
  for (const b of bodies) agent.noteClientVersionLine(P + b, character);
  return agent.clientVersionsSnapshot().find(
    (r) => r.character === String(character).toLowerCase());
}

describe('/zeal version harvest', () => {
  it('parses all three lines from one /zeal version block', () => {
    const rec = feed('Bootcheck', ZEAL, EQW, EQGAME);
    expect(rec).toBeTruthy();
    expect(rec.zeal).toBe('1.4.3');
    expect(rec.zeal_hash).toBe('23c766f');
    expect(rec.eqw).toBe('1.0.1 (Jan 20 2026 22:09:32)');
    expect(rec.eqgame).toBe('7 (Jul 7 2026 09:14:03)');
    expect(Date.parse(rec.at)).toBeGreaterThan(0);
  });

  it('THE ANCHOR: matches despite the leading [timestamp] (the #190 trap)', () => {
    // The same line WITHOUT a timestamp must not match, which proves the
    // pattern is anchored to the log form rather than accidentally loose.
    expect(agent.noteClientVersionLine(P + ZEAL, 'Anchortest')).toBe(true);
    expect(agent.noteClientVersionLine(ZEAL, 'Anchortest')).toBe(false);
  });

  it('keeps per-character records — one box can run several clients', () => {
    feed('Charone', 'Zeal version: 1.4.3 (23c766f)');
    feed('Chartwo', 'Zeal version: 1.4.1 (deadbee)');
    const snap = agent.clientVersionsSnapshot();
    const one = snap.find((r) => r.character === 'charone');
    const two = snap.find((r) => r.character === 'chartwo');
    expect(one.zeal).toBe('1.4.3');
    expect(two.zeal).toBe('1.4.1');
    expect(two.zeal_hash).toBe('deadbee');
  });

  it('a later run overwrites — this tracks CURRENT state, not history', () => {
    feed('Upgrader', 'Zeal version: 1.4.1 (aaaaaaa)');
    const after = feed('Upgrader', 'Zeal version: 1.4.4 (bbbbbbb)');
    expect(after.zeal).toBe('1.4.4');
    expect(after.zeal_hash).toBe('bbbbbbb');
  });

  it('tolerates a Zeal build with no parenthesised hash', () => {
    const rec = feed('Nohash', 'Zeal version: 1.5.0');
    expect(rec.zeal).toBe('1.5.0');
    expect(rec.zeal_hash).toBeNull();
  });

  it('ignores unrelated lines, including other "version:" text', () => {
    const before = agent.clientVersionsSnapshot().length;
    for (const body of [
      'Hitya tells you, \'Zeal version: 9.9.9\'',   // chat quoting it — not our own client
      'You have entered The Nexus.',
      'Uilnayar hits a shissar disciple for 412 points of damage.',
    ]) {
      expect(agent.noteClientVersionLine(P + body, 'Ignorer'),
        `must not match: ${body}`).toBe(false);
    }
    expect(agent.clientVersionsSnapshot().length).toBe(before);
  });

  it('is cheap and safe on junk input', () => {
    expect(agent.noteClientVersionLine('', 'X')).toBe(false);
    expect(agent.noteClientVersionLine(null, 'X')).toBe(false);
    expect(agent.noteClientVersionLine(P + ZEAL, null)).toBe(false);
  });
});
