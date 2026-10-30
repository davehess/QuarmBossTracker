// test/relv-mephit-counter.test.js — the Command Center's mephit counter for Relv the Mysterious (Plane of Storms).
//
// The guild lead, 2026-10-30: "add in a mephit counter into the command center ... for this event only."
// The server script spawns 30 blazing/burning mephits; Falto, Lord of Thunder spawns when none is left and sends
// mephit ADDS with the same display names, so deaths after Falto is up must not count. Runs the agent's REAL
// tracker (sliced from the source, with the real zone table) and the overlay's REAL relvHtml.
//
// Run: npx vitest run test/relv-mephit-counter.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const zoneBlock = sliceBlock(agentSrc, 'const MAP_ZONE_SHORT = ', 'return Number.isFinite(n) && n > 0 ? (MAP_ZONE_SHORT[n] || null) : null;\n}');
const relvBlock = sliceBlock(agentSrc, 'const _DEATH_SLAIN_BY_RX', '// ── end Relv mephit counter');

let zeal, T;
function fresh() {
  zeal = {};
  // _zealState is read live by the tracker; hand it in as a closure variable.
  const make = new Function('_zealState', zoneBlock + '\n' + relvBlock + '\nreturn { note: _relvNoteLine, snap: _relvSnapshot, state: _relvState };');
  return make(zeal);
}
beforeEach(() => { T = fresh(); });

const WHO = 'Aldenmar';
let clock = Date.UTC(2026, 9, 30, 20, 0, 0);
const at = (ms) => `[Fri Oct 30 20:00:00 2026]`;
const say = (text, now = clock) => T.note(`${at()} ${text}`, WHO, now);
const slainBy = (mob) => say(`${mob} has been slain by Brackwyn!`);
const snap = (now = clock) => T.snap(WHO, now);

const START = "Relv the Mysterious says, 'As I had hoped. I regret that I have only enough strength to send four parties through the brush to the other side, and only one party at a time.'";
const PORT = 'A powerfully green aura surrounds Relv as he opens a small rift in the brushes beyond, then sends you and your party forth into the burning forest beyond.';
const BACK = 'The powerful green aura that had pushed you through to the other side of the brush dims as you and your party are pulled back to Relv the Mysterious.';

function killMephits(n) {
  for (let i = 0; i < n; i++) slainBy(i % 2 ? 'A burning mephit' : 'A blazing mephit');
}

describe('counting', () => {
  it('is null when nothing has happened', () => {
    expect(snap()).toBeNull();
  });

  it('starts on the event line and counts blazing and burning mephit deaths', () => {
    say(START);
    expect(snap()).toMatchObject({ mephits: 0, total: 30, falto_up: false, falto_slain: false });
    slainBy('A blazing mephit');
    slainBy('A burning mephit');
    say('You have slain a blazing mephit!');
    expect(snap().mephits).toBe(3);
  });

  it('counts mepheekas separately', () => {
    say(START);
    slainBy('A fiery mepheeka');
    slainBy('A fiery mepheeka');
    expect(snap()).toMatchObject({ mephits: 0, mepheekas: 2 });
  });

  it('starts on a port emote', () => {
    say(PORT);
    expect(snap()).toMatchObject({ mephits: 0 });
    slainBy('A blazing mephit');
    expect(snap().mephits).toBe(1);
  });

  it('a port emote for the next party does not reset the count', () => {
    say(START);
    killMephits(4);
    say(PORT);
    expect(snap().mephits).toBe(4);
  });

  it('starts on the first mephit death only inside Plane of Storms', () => {
    slainBy('A blazing mephit');
    expect(snap()).toBeNull();                      // zone unknown
    zeal[WHO] = { zone: 202 };                      // Plane of Knowledge
    slainBy('A blazing mephit');
    expect(snap()).toBeNull();
    zeal[WHO] = { zone: 210 };                      // postorms
    slainBy('A blazing mephit');
    expect(snap()).toMatchObject({ mephits: 1 });
  });

  it('falls back to the log zone line when Zeal has no zone', () => {
    say('You have entered Plane of Storms.');
    slainBy('A burning mephit');
    expect(snap().mephits).toBe(1);
  });

  it('ignores unrelated deaths', () => {
    say(START);
    slainBy('A fire giant');
    expect(snap().mephits).toBe(0);
  });
});

describe('Falto and the 30 cap', () => {
  it('caps at 30 and calls Falto up; his adds do not count', () => {
    say(START);
    killMephits(30);
    expect(snap()).toMatchObject({ mephits: 30, falto_up: true });
    killMephits(5);                                  // Falto's adds, same names
    expect(snap().mephits).toBe(30);
  });

  it('Falto seen early (missed deaths) stops the count at the floor', () => {
    say(START);
    killMephits(22);
    say('Falto, Lord of Thunder slashes YOU for 120 points of damage.');
    expect(snap()).toMatchObject({ mephits: 22, falto_up: true });
    killMephits(3);
    expect(snap().mephits).toBe(22);
  });

  it('our own swing at Falto also marks him up', () => {
    say(START);
    killMephits(10);
    say('You slash Falto, Lord of Thunder for 300 points of damage.');
    expect(snap().falto_up).toBe(true);
  });

  it('a chat line that only names Falto does not', () => {
    say(START);
    killMephits(10);
    say("Corvale tells the guild, 'Falto, Lord of Thunder should be up soon'");
    say("You tell your guild, 'Falto, Lord of Thunder is next'");
    expect(snap().falto_up).toBe(false);
    killMephits(1);
    expect(snap().mephits).toBe(11);
  });

  it('records his death', () => {
    say(START);
    killMephits(30);
    say('Falto, Lord of Thunder has been slain by Brackwyn!');
    expect(snap()).toMatchObject({ falto_up: true, falto_slain: true });
    say('You have slain Falto, Lord of Thunder!');
    expect(snap().falto_slain).toBe(true);
  });
});

describe('reset rules', () => {
  it('a new start line restarts at zero', () => {
    say(START);
    killMephits(12);
    say(START);
    expect(snap().mephits).toBe(0);
  });

  it('the pulled-back line ends it', () => {
    say(START);
    killMephits(5);
    say(BACK);
    expect(snap()).toBeNull();
  });

  it('leaving the zone ends it, re-entering Plane of Storms does not', () => {
    say(START);
    killMephits(5);
    say('You have entered Plane of Storms.');
    expect(snap().mephits).toBe(5);
    say('You have entered Plane of Knowledge.');
    expect(snap()).toBeNull();
  });

  it('ends 3 hours after the start', () => {
    say(START, clock);
    killMephits(5);
    expect(snap(clock + 3 * 3600e3 - 1000)).not.toBeNull();
    expect(snap(clock + 3 * 3600e3 + 1000)).toBeNull();
  });

  it('ends 10 minutes after Falto dies', () => {
    say(START);
    killMephits(30);
    say('Falto, Lord of Thunder has been slain by Brackwyn!');
    expect(snap(clock + 9 * 60e3)).not.toBeNull();
    expect(snap(clock + 11 * 60e3)).toBeNull();
  });

  it('keeps one tracker per character', () => {
    say(START);
    expect(T.snap('Corvale', clock)).toBeNull();
  });
});

describe('Command Center row', () => {
  const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
  const relvHtml = evalBlock(sliceBlock(cmd, '  function relvHtml(v){', '\n  }'), ['relvHtml']).relvHtml;
  const plain = (h) => h.replace(/<[^>]+>/g, '');

  it('shows the count, what is left and the mepheekas', () => {
    expect(plain(relvHtml({ mephits: 20, total: 30, mepheekas: 7 }))).toBe('🔥 Relv: mephits 20/30 · 10 leftmepheekas killed 7');
  });
  it('turns into Falto is up, then Falto slain', () => {
    expect(plain(relvHtml({ mephits: 30, total: 30, mepheekas: 90, falto_up: true }))).toContain('Falto is up');
    expect(plain(relvHtml({ mephits: 30, total: 30, mepheekas: 90, falto_up: true, falto_slain: true }))).toContain('Falto slain');
  });
  it('is wired into render only when s.relv is present, and the agent sends it', () => {
    expect(stripJs(cmd)).toMatch(/if \(s\.relv\) html \+= relvHtml\(s\.relv\);/);
    expect(stripJs(agentSrc)).toMatch(/relv:\s+_relvSnapshot\(activeChar, Date\.now\(\)\)/);
    expect(stripJs(agentSrc)).toMatch(/_relvNoteLine\(line, b\.character, Date\.now\(\)\)/);
  });
});
