// test/pop-flags-real.test.js — `#popflags` as the live server really printed it (the guild lead, 2026-10-26).
//
// Two captures, timestamps off, verbatim: A (test/fixtures/popflags-real-a.txt) is a log of a character with tiers 1-3
// complete, all four tier commands; B (popflags-real-b.txt) is a character partway, transcribed from screenshots, which
// never printed the overview or Tier 4 and so never said a word about the Plane of Time. The first fixture
// (popflags-output.txt) was built from the source's format strings; these are what the server DID print, and they
// carry strings the 11024c19 source builds at runtime: "Complete; combined into Zebuxoruk lore", "Tylis progression
// complete", "Both Zek information sets obtained", the Seer notice and the Miak advice line.
//
// The agent's live reader is run on the same lines in test/pop-flags-live-parity.test.js (beta).
// Names: none in these lines. Run: npx vitest run test/pop-flags-real.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import { parsePopFlags, SECTIONS } from '../web/lib/popFlagsPaste.ts';
import { heldClosure } from '../web/lib/popRecital.ts';
import { pasteRows } from '../web/lib/popFlagsPasteSave.ts';

const fx = (n) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', n), 'utf8');
const A = fx('popflags-real-a.txt');
const B = fx('popflags-real-b.txt');
const sorted = (a) => [...a].sort();

// A: tiers 1-3 complete → every step through Tier 3 and the Plane of Fire door; NOT Earth B's key, NOT time.
const A_WANT = [
  'mavuin_3', 'zeks_2', 'zeks_3', 'zeks_4', 'zeks_7', 'poi_door_1', 'fuirstel_2', 'fuirstel_4', 'fuirstel_5', 'grummus_1',
  'aerindar_1', 'aerindar_2', 'bertox_key_1', 'thelin_3', 'thelin_4', 'tylis_2', 'saryrn_1', 'karana_4',
  'zebuxoruk_1', 'zebuxoruk_2', 'hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3', 'hohtrials_111', 'mmarr_1', 'mmarr_book_1', 'cipher_1',
  'sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4', 'sol_room_5', 'pofire_1', 'pofire_2',
];
// B: partway. thelin 4 and "Both Zek information sets obtained" (zeks 5 = Vallon's 3 and Tallon's 4) come from stage
// lines; the "Complete" boss lines (Terris Thule, Behemoth, Aerin`Dar, Vallon, Tallon) are proven because the SAME paste
// says "Missing" / "Pending memory" on others, which the server prints only without the time flag (cpp:175-176).
const B_WANT = [
  'mavuin_3', 'grummus_1', 'bertox_key_1', 'karana_3', 'aerindar_1', 'aerindar_2', 'thelin_3', 'thelin_4',
  'zeks_2', 'zeks_3', 'zeks_4',
];

describe('capture A: tiers 1-3 complete, all four tier commands', () => {
  const p = parsePopFlags(A);
  it('reads to every step through Tier 3 and the Fire door, and nothing from Tier 4 or Time', () => {
    expect(sorted(p.flags)).toEqual(sorted(A_WANT));
    for (const k of ['earthb_key_1', 'time_1', 'quarm_dead']) expect(p.flags).not.toContain(k);
  });
  it('every header, nothing unknown, nothing unproven, time known not held', () => {
    expect(p.sections).toEqual(['Planes of Power Progression', 'Tier 2 Progression', 'Tier 1 Progression', 'Tier 3 Progression', 'Tier 4 Progression']);
    for (const s of p.sections) expect(SECTIONS.some(x => x.title === s), s).toBe(true);
    expect(p.unknown).toEqual([]);
    expect(p.unproven).toEqual([]);
    expect(p.noKey).toEqual([]);          // "Seventh Hammer access: Locked" proves nothing
    expect(p.time).toBe('no');
  });
  it('the new "Complete; combined" and "<series> complete" words are read: Zebuxoruk lore, Tylis 2, Zek 7', () => {
    const line = (k) => p.found.find(f => f.key === k)?.line;
    expect(line('zebuxoruk_1')).toMatch(/combined into Zebuxoruk lore/i);
    expect(line('tylis_2')).toBe('Tylis progression: Tylis progression complete');
    expect(line('zeks_7')).toBe('Giwin and Zek progression: Zek progression complete');
    expect(line('fuirstel_5')).toBe('Fuirstel progression: Fuirstel progression complete');
  });
  it('the recognised lines alone (used) read to the same steps, advice and Tier lore lines left out', () => {
    expect(sorted(parsePopFlags(p.used.join('\n')).flags)).toEqual(sorted(A_WANT));
    expect(p.used.some(l => /^Tier complete:/.test(l))).toBe(false);
    expect(p.used.some(l => /^If one of these is missing/.test(l))).toBe(false);
  });
  it('with a timestamp on every line, the same', () => {
    const stamped = A.split('\n').filter(Boolean).map(l => '[Mon Oct 26 21:10:01 2026] ' + l).join('\r\n');
    expect(sorted(parsePopFlags(stamped).flags)).toEqual(sorted(A_WANT));
  });
});

describe('capture B: partway, no overview, no Plane of Time line', () => {
  const p = parsePopFlags(B);
  it('reads to exactly the steps it proves', () => {
    expect(sorted(p.flags)).toEqual(sorted(B_WANT));
  });
  it('NOT fuirstel, the Factory door, Tylis, the cipher, Zebuxoruk, Fire or any trial', () => {
    const held = heldClosure(p.flags);
    for (const k of ['fuirstel_1', 'fuirstel_2', 'fuirstel_3', 'fuirstel_4', 'poi_door_1', 'tylis_1', 'tylis_2', 'saryrn_1', 'cipher_1',
      'zebuxoruk_1', 'zebuxoruk_2', 'pofire_1', 'pofire_2', 'sol_room_1', 'hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3', 'hohtrials_111',
      'mmarr_1', 'mmarr_book_1', 'karana_4', 'zeks_5', 'zeks_6', 'zeks_7', 'time_1', 'earthb_key_1']) expect(held.has(k), k).toBe(false);
  });
  it('the series carry their earlier steps: Thelin 4, Karana 3, Zek 3 and 4, Aerin`Dar 2, Mavuin 3', () => {
    const held = heldClosure(p.flags);
    for (const k of ['thelin_1', 'thelin_2', 'karana_1', 'karana_2', 'zeks_1', 'zeks_2', 'aerindar_1', 'mavuin_1', 'mavuin_2']) expect(held.has(k), k).toBe(true);
  });
  it('"Pending memory" and "Missing" set nothing (Grummus, Rallos, Bertoxxulous, the cipher halves, Solusek Ro)', () => {
    const lines = p.found.map(f => f.line);
    expect(lines.some(l => /^Grummus flag/.test(l))).toBe(false);
    expect(lines.some(l => /^Rallos Zek flag/.test(l))).toBe(false);
    expect(lines.some(l => /^Bertoxxulous flag/.test(l))).toBe(false);
    expect(lines.some(l => /^Solusek Ro flag/.test(l))).toBe(false);
    expect(p.unknown).toEqual([]);
  });
  it('the paste itself says time is not held, so nothing is left unproven', () => {
    expect(p.time).toBe('no');
    expect(p.unproven).toEqual([]);
    expect(p.noKey).toEqual([]);
  });
  it('the headers: Tier 1, 2 and 3 only', () => {
    expect(p.sections).toEqual(['Tier 1 Progression', 'Tier 2 Progression', 'Tier 3 Progression']);
  });
  it('the recognised lines alone (used) carry the time answer too: a save re-reads them and gets the same steps', () => {
    expect(sorted(parsePopFlags(p.used.join('\n')).flags)).toEqual(sorted(B_WANT));
    expect(p.used.length).toBeLessThan(120);
  });
  it('the save rows are the proven steps only', () => {
    const rows = pasteRows('wolfpack', 'Aldenmar', p.flags, '2026-10-26T21:10:01.000Z');
    const keys = rows.map(r => r.flag_key);
    for (const k of B_WANT) expect(keys, k).toContain(k);
    for (const k of ['fuirstel_2', 'zeks_7', 'poi_door_1', 'tylis_2', 'pofire_2', 'time_1']) expect(keys, k).not.toContain(k);
    for (const k of keys) expect(k.startsWith('cl_'), k).toBe(false);
  });
  it('the advice lines the command appends are not unknown, and say nothing about steps', () => {
    for (const l of ['Pending checklist memories exist, but their prerequisite steps are incomplete.',
      'Complete the unfinished progression shown above, then return to Seer Mal Nae`Shi.',
      "Speak to Miak the Searedsoul in Tranquility about 'portal's destination'; hailing alone does not grant the preflag.",
      'If one of these is missing, hail Maelin and ask about new lore and new information.',
      'Halls of Honor trials: None completed', 'Tower wing flags: None completed']) {
      const q = parsePopFlags(l);
      expect(q.flags, l).toEqual([]);
      expect(q.unknown, l).toEqual([]);
    }
  });
});

describe('the time answer a paste carries without a Plane of Time line', () => {
  const TT = 'Terris Thule flag: Complete';
  // each line is printed only when the member does not hold `time` (popflags.cpp:157,175-176,184,717-720)
  const NO_TIME = [
    'Grummus flag: Missing', 'Rallos Zek flag: Pending memory', 'Miak the Searedsoul preflag: Missing',
    "Pending memory: Thelin's hedge maze", 'Pending memory: Karana',
    'Pending checklist memories exist, but their prerequisite steps are incomplete.',
    'Complete the unfinished progression shown above, then return to Seer Mal Nae`Shi.',
    'A checklist memory is ready to be unlocked.',
    "Sit near Seer Mal Nae`Shi and say 'unlock memories', then check #popflags again.",
    "Speak to Miak the Searedsoul in Tranquility about 'portal's destination'; hailing alone does not grant the preflag.",
    'Tier 1: In progress', 'Tier 2: Not started', 'Tier 3: In progress',
  ];
  it('on its own a "Complete" boss line is unproven (it is `<test> || time`)', () => {
    const p = parsePopFlags(TT);
    expect(p.flags).toEqual([]);
    expect(p.unproven).toEqual([TT]);
    expect(p.time).toBe('unknown');
  });
  for (const line of NO_TIME) {
    it(`"${line.slice(0, 60)}" settles it: not held, so the Complete line counts, in either order`, () => {
      for (const text of [`${line}\n${TT}`, `${TT}\n${line}`]) {
        const p = parsePopFlags(text);
        expect(p.time, text).toBe('no');
        expect(p.flags, text).toEqual(['thelin_3']);
        expect(p.unproven, text).toEqual([]);
      }
    });
  }
  it('a Tier 1-3 that is Complete says nothing (it is `<steps> || time`)', () => {
    for (const l of ['Tier 1: Complete', 'Tier 2: Complete', 'Tier 3: Complete']) {
      const p = parsePopFlags(`${l}\n${TT}`);
      expect(p.time, l).toBe('unknown');
      expect(p.flags, l).toEqual([]);
    }
  });
  it('a paste that says both (time held in one, not in the other) is no answer: nothing written, nothing guessed', () => {
    const p = parsePopFlags(`Grummus flag: Missing\nTier 4: Complete\n${TT}`);
    expect(p.time).toBe('unknown');
    expect(p.flags).toEqual([]);
    const q = parsePopFlags(`Grummus flag: Missing\nPlane of Time access: Unlocked\n${TT}`);
    expect(q.flags).toEqual([]);
  });
  it('a chat line that merely quotes one of these is not read as the answer', () => {
    const p = parsePopFlags(`Zarrin says, 'Grummus flag: Missing'\n${TT}`);
    expect(p.time).toBe('unknown');
    expect(p.flags).toEqual([]);
  });
});
