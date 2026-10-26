// test/pop-flags-paste.test.js — paste what `#popflags` prints, get your flags set (the guild lead, 2026-10-26).
//
// The reader (web/lib/popFlagsPaste.ts) and the save rules (web/lib/popFlagsPasteSave.ts) run for real. The lines
// are the ones the server prints, written out here AGAIN from SecretsOTheP/EQMacEmu zone/gm_commands/popflags.cpp
// (commit 11024c196790cfa370f1a44d6f03d70a23deac39, 967 lines) rather than imported from the parser's own tables,
// so a typo on either side fails. Names below are invented; nobody is in the command's output but the stage words.
// The page wiring is read as stripped source (stripJs: a comment must not answer for the code).
//
// Run: npx vitest run test/pop-flags-paste.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  parsePopFlags, STAGE_TABLES, SECTIONS, NOT_IN_CATALOG,
} from '../web/lib/popFlagsPaste.ts';
import { PASTE_SOURCE, MAX_LINES, MAX_LINE_LEN, pasteRows, savePopFlags } from '../web/lib/popFlagsPasteSave.ts';
import { makeLimiter } from '../web/lib/popRecitalSave.ts';
import { POP_STEPS } from '../web/lib/popSteps.ts';
import { RECITAL_STAGES } from '../web/lib/popRecital.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const STAMP = '[Mon Oct 26 21:10:01 2026] ';
const EMITTABLE = new Set([...Object.values(POP_STEPS).flat().map(s => s.key), ...RECITAL_STAGES.map(([, k]) => k)]);

// popflags.cpp description arrays, verbatim: [label, series, texts[value-1]]. The cite is the array's line range.
const SRC = [
  // cpp:370-374 · printed at 396-402
  ["Mavuin's case", 'mavuin', ['The evidence needed to save Mavuin has been requested', "The Tribunal has agreed to hear Mavuin's case", "Mavuin's case is complete"]],
  // cpp:376-382 · 414-420
  ['Fuirstel progression', 'fuirstel', ['Obtain the Ward for Milyk', 'Grummus defeated; return to Elder Fuirstel', 'Elder Fuirstel aided; defeat Bertoxxulous', 'Bertoxxulous defeated; return to Elder Fuirstel', 'Fuirstel progression complete']],
  // cpp:384-390 · 435-441 (count 5)
  ['Thelin progression', 'thelin', ['Help Thelin escape the hedge maze', 'Defeat Terris Thule', 'Terris Thule was defeated', 'Thelin was released from Terris Thule', 'Nightmare progression complete']],
  // cpp:473-476 · 494-500
  ['Aerin`Dar progression', 'aerindar', ['Aerin`Dar defeated; the meaning of Justice remains', 'Halls of Honor access unlocked']],
  // cpp:478-483 · 514-520 (Tier 2)
  ['Askr and Karana progression', 'karana', ['Prove yourself to Askr', "Complete Mavuin's case, then use the Storms shrine to enter Bastion of Thunder", 'Bastion of Thunder progression recorded', "Karana's information obtained"]],
  // cpp:585-590 · 646-652 (Tier 3)
  ['Agnarr and Karana progression', 'karana', ['Return to Askr', "Complete Mavuin's case, then use the Storms shrine to enter Bastion of Thunder", 'Karana progression continues', "Karana's information obtained"]],
  // cpp:485-488 · 548-554
  ['Tylis progression', 'tylis', ['Rescue Tylis from the Plane of Torment', 'Tylis progression complete']],
  // cpp:575-583 · 660-666
  ['Giwin and Zek progression', 'zeks', ['Initial Zek progression recorded', 'Meet Giwin in Drunder', "Vallon Zek's information obtained", "Tallon Zek's information obtained", 'Both Zek information sets obtained', 'Defeat Rallos Zek', 'Zek progression complete']],
];
// What our catalog holds for a value the command prints but we keep no step for.
const EXPAND = { zeks_5: ['zeks_3', 'zeks_4'], thelin_5: ['thelin_4'] };

const flagsOf = (text) => parsePopFlags(text).flags;
const sorted = (a) => [...a].sort();

describe('stage lines: the printed text for value N is the step <qglobal>_<N>', () => {
  for (const [label, series, texts] of SRC) {
    it(`${label}: every value, with and without the log timestamp`, () => {
      texts.forEach((text, i) => {
        const key = `${series}_${i + 1}`;
        const want = EXPAND[key] ?? [key];
        for (const line of [`${label}: ${text}`, STAMP + `${label}: ${text}`, '[21:10:01] ' + `${label}: ${text}`, `   ${label}:  ${text}   `]) {
          const p = parsePopFlags(line);
          expect(sorted(p.flags), line).toEqual(sorted(want));
          expect(p.unknown, line).toEqual([]);
        }
      });
    });
  }
  it('the parser carries exactly these tables (a stage text added or reordered on either side fails)', () => {
    expect(STAGE_TABLES.map(t => [t.label, t.series, t.texts])).toEqual(SRC);
  });
  it('thelin has FIVE strings: value 5 is "Nightmare progression complete", and our catalog stops at thelin_4', () => {
    expect(SRC.find(r => r[1] === 'thelin')[2]).toHaveLength(5);
    expect(flagsOf('Thelin progression: Thelin was released from Terris Thule')).toEqual(['thelin_4']);
    expect(flagsOf('Thelin progression: Terris Thule was defeated')).toEqual(['thelin_3']);
    expect(flagsOf('Thelin progression: Nightmare progression complete')).toEqual(['thelin_4']);
    expect(NOT_IN_CATALOG.thelin_5).toEqual(['thelin_4']);
  });
  it('zeks 5 is Vallon and Tallon both; zeks 6 and 7 are Maelin and Rallos', () => {
    expect(flagsOf('Giwin and Zek progression: Both Zek information sets obtained')).toEqual(['zeks_3', 'zeks_4']);
    expect(flagsOf('Giwin and Zek progression: Defeat Rallos Zek')).toEqual(['zeks_6']);
    expect(flagsOf('Giwin and Zek progression: Zek progression complete')).toEqual(['zeks_7']);
  });
  it('Karana prints different words in Tier 2 and Tier 3 for the same value, and each is read under its own label', () => {
    expect(flagsOf('Askr and Karana progression: Prove yourself to Askr')).toEqual(['karana_1']);
    expect(flagsOf('Agnarr and Karana progression: Return to Askr')).toEqual(['karana_1']);
    expect(flagsOf('Askr and Karana progression: Bastion of Thunder progression recorded')).toEqual(['karana_3']);
    expect(flagsOf('Agnarr and Karana progression: Karana progression continues')).toEqual(['karana_3']);
    // Tier 2's words under Tier 3's label are not a line the command prints.
    const p = parsePopFlags('Agnarr and Karana progression: Bastion of Thunder progression recorded');
    expect(p.flags).toEqual([]);
    expect(p.unknown).toHaveLength(1);
    // The value 2 and 4 words are the same in both tables.
    expect(flagsOf("Agnarr and Karana progression: Karana's information obtained")).toEqual(['karana_4']);
  });
  it('"Not started" and "Progress recorded" prove nothing and are not unknown (cpp:70, 83)', () => {
    for (const [label] of SRC) {
      for (const rest of ['Not started', 'Progress recorded']) {
        const p = parsePopFlags(`${label}: ${rest}`);
        expect(p.flags, `${label}: ${rest}`).toEqual([]);
        expect(p.unknown, `${label}: ${rest}`).toEqual([]);
      }
    }
  });
  it('"combined into Zebuxoruk lore" (cpp:510, 642) is Maelin having read the notes: zebuxoruk_1', () => {
    expect(flagsOf('Askr and Karana progression: Complete; combined into Zebuxoruk lore')).toEqual(['zebuxoruk_1']);
    expect(flagsOf('Agnarr and Karana progression: Complete; combined into Zebuxoruk lore')).toEqual(['zebuxoruk_1']);
  });
  it('a stage text the table does not hold (a server update) is shown as unknown, not guessed', () => {
    const p = parsePopFlags('Fuirstel progression: Fuirstel is pleased with a brand new thing');
    expect(p.flags).toEqual([]);
    expect(p.unknown).toEqual(['Fuirstel progression: Fuirstel is pleased with a brand new thing']);
  });
});

describe('access lines, bit strings, Maelin, Miak', () => {
  it('"<label> access: Unlocked" proves its step; Locked proves nothing (cpp:406-455, 529-541, 803-823)', () => {
    const cases = {
      'Crypt of Decay access': 'grummus_1', 'Lower Crypt access': 'bertox_key_1', 'Factory door access': 'poi_door_1',
      'Air, Earth, and Water access': 'zebuxoruk_2', 'Plane of Fire access': 'pofire_2', 'Plane of Earth B access': 'earthb_key_1',
    };
    for (const [label, key] of Object.entries(cases)) {
      expect(flagsOf(`${label}: Unlocked`), label).toEqual([key]);
      expect(flagsOf(`${label}: Locked`), label).toEqual([]);
      expect(parsePopFlags(`${label}: Locked`).unknown, label).toEqual([]);
    }
  });
  it('the Plane of Time access line says whether the member holds the time flag', () => {
    expect(flagsOf('Plane of Time access: Unlocked')).toEqual(['time_1']);
    const locked = parsePopFlags('Plane of Time access: Locked');
    expect(locked.flags).toEqual([]);
    expect(locked.time).toBe('no');
  });
  it('Seventh Hammer is read and reported, but we keep no step for it, so nothing is written', () => {
    const p = parsePopFlags('Seventh Hammer access: Unlocked');
    expect(p.flags).toEqual([]);
    expect(p.noKey).toEqual(['Seventh Hammer access: Unlocked']);
    expect(p.unknown).toEqual([]);
    expect(EMITTABLE.has('seventh_1')).toBe(false);
  });
  it('the hohtrials bits are three lines (cpp:609-627); all three Complete is the Seer\'s "all of Honor\'s Trials"', () => {
    expect(flagsOf('Rydda`Dar trial: Complete\nVillage trial: Incomplete\nNomad trial: Complete')).toEqual(['hoh_trial_1', 'hoh_trial_3']);
    expect(flagsOf('Rydda`Dar trial: Complete\nVillage trial: Complete\nNomad trial: Complete'))
      .toEqual(['hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3', 'hohtrials_111']);
    expect(flagsOf('Halls of Honor trials: None completed')).toEqual([]);
    expect(parsePopFlags('Halls of Honor trials: None completed').unknown).toEqual([]);
  });
  it('the sol_room bits are five lines in the order Xuzl, Arlyxir, Dresolik, Rizlona, Jiva (cpp:731-767)', () => {
    const names = ['Xuzl', 'Arlyxir', 'Dresolik', 'Rizlona', 'Jiva'];
    names.forEach((n, i) => {
      expect(flagsOf(`${n}: Complete`), n).toEqual([`sol_room_${i + 1}`]);
      expect(flagsOf(`${n}: Incomplete`), n).toEqual([]);
    });
    expect(flagsOf('Tower wing flags: None completed')).toEqual([]);
  });
  it('Maelin: cipher, lore, combined Zek, final elemental (cpp:678-708)', () => {
    expect(flagsOf('Cipher information: Received')).toEqual(['cipher_1']);
    expect(flagsOf('Zebuxoruk lore: Received')).toEqual(['zebuxoruk_1']);
    expect(flagsOf('Combined Zek information: Received')).toEqual(['zeks_3', 'zeks_4']);
    expect(flagsOf('Final elemental information: Received')).toEqual(['zebuxoruk_2']);
    for (const l of ['Cipher information', 'Zebuxoruk lore', 'Combined Zek information', 'Final elemental information']) {
      expect(flagsOf(`${l}: Missing`), l).toEqual([]);
    }
  });
  it('Plane of Fire progression: only "Unlocked" is a step (cpp:773-779)', () => {
    expect(flagsOf('Plane of Fire progression: Unlocked')).toEqual(['pofire_2']);
    expect(flagsOf('Plane of Fire progression: In progress')).toEqual([]);
    expect(flagsOf('Plane of Fire progression: Not started')).toEqual([]);
  });
});

describe('the time rule: "Complete" is `<test> || time` (cpp:171-176, 717)', () => {
  const BOSS = [
    ['Grummus flag', 'fuirstel_2'], ['Terris Thule flag', 'thelin_3'], ['Manaetic Behemoth flag', 'zeks_2'],
    ['Aerin`Dar flag', 'aerindar_1'], ['Bertoxxulous flag', 'fuirstel_4'], ['Keeper of Sorrows flag', 'tylis_2'],
    ['Saryrn cipher half', 'saryrn_1'], ['Mithaniel Marr cipher half', 'mmarr_1'], ['Mithaniel Marr book', 'mmarr_book_1'],
    ['Agnarr / Karana flag', 'karana_4'], ['Vallon Zek flag', 'zeks_3'], ['Tallon Zek flag', 'zeks_4'],
    ['Rallos Zek flag', 'zeks_7'], ['Solusek Ro flag', 'pofire_2'], ['Miak the Searedsoul preflag', 'pofire_1'],
  ];
  const NOT_TIME = 'Plane of Time access: Locked';
  it('with no word on the time flag a Complete line is listed as unproven and writes nothing', () => {
    for (const [label] of BOSS) {
      const p = parsePopFlags(`${label}: Complete`);
      expect(p.flags, label).toEqual([]);
      expect(p.unproven, label).toEqual([`${label}: Complete`]);
      expect(p.time).toBe('unknown');
    }
  });
  it('when the same paste shows time is NOT held, the Complete line proves its step, wherever the time line sits', () => {
    for (const [label, key] of BOSS) {
      for (const text of [`${label}: Complete\n${NOT_TIME}`, `${NOT_TIME}\n${label}: Complete`]) {
        const p = parsePopFlags(text);
        expect(p.flags, text).toEqual([key]);
        expect(p.unproven, text).toEqual([]);
      }
    }
  });
  it('the overview says it too: Tier 4 not Complete, or Tier 5 Not started (cpp:343-355)', () => {
    expect(parsePopFlags('Tier 4: In progress\nGrummus flag: Complete').flags).toEqual(['fuirstel_2']);
    expect(parsePopFlags('Tier 4: Not started\nGrummus flag: Complete').flags).toEqual(['fuirstel_2']);
    expect(parsePopFlags('Tier 5 - Plane of Time: Not started\nGrummus flag: Complete').flags).toEqual(['fuirstel_2']);
  });
  it('when time IS held it explains the Complete lines: time_1 is written and they are neither read nor unproven', () => {
    for (const text of ['Plane of Time access: Unlocked\nGrummus flag: Complete', 'Tier 4: Complete\nGrummus flag: Complete',
      'Tier 5 - Plane of Time: Complete\nGrummus flag: Complete']) {
      const p = parsePopFlags(text);
      expect(p.flags, text).toEqual(['time_1']);
      expect(p.unproven, text).toEqual([]);
      expect(p.time).toBe('yes');
    }
  });
  it('the two "Tier complete" lines whose test IS Has("time") say time; tiers 1-3 say nothing new (cpp:269, 866)', () => {
    expect(flagsOf('Tier complete: The powers of Air, Earth, Fire, and Water have been joined. The way into the Plane of Time now stands open.')).toEqual(['time_1']);
    expect(flagsOf('Tier complete: The Plane of Time recognizes your soul. Beyond its shifting portals, the gods await.')).toEqual(['time_1']);
    for (const lore of [
      "Justice has been served, Disease's grip weakened, Nightmare ended, and Innovation's hidden plot uncovered.",
      'Valor has been proven, Storms weathered, the Crypt of Decay purged, and Torment overcome.',
      'Honor has been earned, the Bastion of Thunder conquered, the Warlord defeated, and the Burning Prince\'s plot exposed. The Elemental Planes now stand open.',
    ]) {
      const p = parsePopFlags('Tier complete: ' + lore);
      expect(p.flags).toEqual([]);
      expect(p.unknown).toEqual([]);
    }
  });
  it('a paste that says both yes and no (two runs, two days) is no answer: nothing time-gated is written', () => {
    const p = parsePopFlags('Plane of Time access: Locked\nPlane of Time access: Unlocked\nGrummus flag: Complete');
    expect(p.time).toBe('unknown');
    expect(p.flags).toEqual([]);
    expect(p.unproven).toEqual(['Grummus flag: Complete']);
  });
  it('"Pending memory" and "Missing" prove nothing and are not unknown (cpp:162-166, 176)', () => {
    for (const [label] of BOSS) {
      // The Miak line is printed by its own code (cpp:718): "Complete" or "Missing", never "Pending memory".
      for (const rest of label.startsWith('Miak') ? ['Missing'] : ['Pending memory', 'Missing']) {
        const p = parsePopFlags(`${NOT_TIME}\n${label}: ${rest}`);
        expect(p.flags, `${label}: ${rest}`).toEqual([]);
        expect(p.unknown, `${label}: ${rest}`).toEqual([]);
      }
    }
    expect(parsePopFlags('Miak the Searedsoul preflag: Pending memory').unknown).toHaveLength(1);
    expect(parsePopFlags("Pending memory: Thelin's hedge maze").unknown).toEqual([]);
    expect(parsePopFlags('Pending memory: Karana').flags).toEqual([]);
  });
});

describe('a whole paste', () => {
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'popflags-output.txt'), 'utf8');
  const WANT = [
    'mavuin_3', 'fuirstel_2', 'fuirstel_3', 'grummus_1', 'thelin_3', 'thelin_4', 'poi_door_1', 'zeks_2', 'zeks_3', 'zeks_4',
    'aerindar_1', 'aerindar_2', 'karana_3', 'bertox_key_1', 'tylis_2', 'saryrn_1', 'hoh_trial_1', 'hoh_trial_3', 'mmarr_1',
    'cipher_1', 'pofire_1', 'sol_room_1', 'sol_room_3',
  ];
  it('the shared fixture reads to exactly these steps, every section, nothing unknown', () => {
    const p = parsePopFlags(fixture);
    expect(sorted(p.flags)).toEqual(sorted(WANT));
    expect(p.sections).toEqual(SECTIONS.map(s => s.title));
    expect(p.time).toBe('no');
    expect(p.unknown).toEqual([]);
    expect(p.unproven).toEqual([]);
    expect(p.noKey).toEqual(['Seventh Hammer access: Unlocked']);
  });
  it('without the timestamps, with Windows line ends and blank lines, the same steps', () => {
    const bare = fixture.split('\n').map(l => l.replace(/^\[[^\]]*\]\s*/, '')).join('\r\n\r\n');
    expect(sorted(flagsOf(bare))).toEqual(sorted(WANT));
  });
  it('flags come back in catalog order, each once, each one a step our catalog keeps', () => {
    const p = parsePopFlags(fixture + '\n' + fixture);
    expect(new Set(p.flags).size).toBe(p.flags.length);
    for (const k of p.flags) expect(EMITTABLE.has(k), k).toBe(true);
    expect(p.flags.indexOf('mavuin_3')).toBeLessThan(p.flags.indexOf('sol_room_1'));
  });
  it('found carries each step\'s plain label, its zone card, and the line that proved it', () => {
    const f = parsePopFlags(fixture).found;
    expect(f.length).toBe(WANT.length);
    const m = f.find(x => x.key === 'mavuin_3');
    expect(m.label).toMatch(/Mavuin/);
    expect(m.zone).toBe('Justice');
    expect(m.line).toBe("Mavuin's case: Mavuin's case is complete");
  });
  it('the recognised lines alone (used) read to the same steps: that is all a save sends', () => {
    const p = parsePopFlags(fixture);
    expect(p.used.length).toBeGreaterThan(20);
    expect(p.used.every(l => !/^\[/.test(l))).toBe(true);
    expect(sorted(flagsOf(p.used.join('\n')))).toEqual(sorted(WANT));
    // …and the chat line in the middle of the paste is not among them.
    expect(p.used.some(l => /Brackwyn/.test(l))).toBe(false);
  });
  it('other chat in a pasted log is dropped without a word; a new command-shaped line is shown', () => {
    const p = parsePopFlags([
      STAMP + 'Brackwyn tells the guild, \'anyone want to do the Tribunal tonight\'',
      STAMP + 'You hit a gnoll pup for 12 points of damage.',
      STAMP + 'Zarrin says, \'my progression is slow\'',
      STAMP + 'Corvale access: Unlocked',
      STAMP + 'Rethlan tier flag memory book',
    ].join('\n'));
    expect(p.flags).toEqual([]);
    expect(p.unknown).toEqual(['Corvale access: Unlocked', 'Rethlan tier flag memory book']);
  });
  it('nothing recognised is an empty read, not a throw; a huge paste stays bounded', () => {
    for (const t of ['', '   \n\n', 'hello', null, undefined]) expect(parsePopFlags(t).flags, String(t)).toEqual([]);
    const big = Array.from({ length: 4000 }, (_, i) => `${STAMP}Some progression flag line number ${i}`).join('\n');
    const p = parsePopFlags('Mavuin\'s case: Mavuin\'s case is complete\n' + big);
    expect(p.flags).toEqual(['mavuin_3']);
    expect(p.unknown.length).toBeLessThanOrEqual(25);
    // …and only the first 200,000 characters are read.
    expect(parsePopFlags(big + '\n' + 'Mavuin\'s case: Mavuin\'s case is complete').flags).toEqual([]);
  });
});

describe('saving: your own characters, one source tag, nothing twice', () => {
  const LINES = ["Mavuin's case: Mavuin's case is complete", 'Crypt of Decay access: Unlocked', 'Rydda`Dar trial: Complete'];
  function deps(over = {}) {
    const inserted = [];
    const held = new Set();
    const d = {
      guildId: 'wolfpack',
      userId: async () => 'user-1',
      owned: async () => ['Aldenmar', 'Brackwyn'],
      heldKeys: async (_c, keys) => keys.filter(k => held.has(k)),
      insert: async (rows) => { inserted.push(...rows); rows.forEach(r => held.add(r.flag_key)); return null; },
      now: () => new Date('2026-10-26T21:30:00Z'),
      allow: () => true,
      ...over,
    };
    return { d, inserted, held };
  }
  it('writes the steps and the catalog flags they imply, tagged popflags_paste, under the character\'s real casing', async () => {
    const { d, inserted } = deps();
    const res = await savePopFlags(d, 'aldenmar', LINES);
    expect(res.ok).toBe(true);
    expect(inserted.every(r => r.source === PASTE_SOURCE && r.source === 'popflags_paste')).toBe(true);
    expect(inserted.every(r => r.character === 'Aldenmar' && r.guild_id === 'wolfpack' && r.earned_at === '2026-10-26T21:30:00.000Z')).toBe(true);
    const keys = inserted.map(r => r.flag_key);
    for (const k of ['mavuin_3', 'trial_justice', 'grummus_1', 'grummus_dead', 'hoh_trial_1']) expect(keys, k).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inserted.find(r => r.flag_key === 'trial_justice').stage).toBe('mavuin_3');
    expect(res.steps).toBe(3);
  });
  it('a second save of the same paste writes nothing', async () => {
    const { d, inserted } = deps();
    await savePopFlags(d, 'Aldenmar', LINES);
    const n = inserted.length;
    const again = await savePopFlags(d, 'Aldenmar', LINES);
    expect(again).toMatchObject({ ok: true, written: 0 });
    expect(again.already).toBe(n);
    expect(inserted.length).toBe(n);
  });
  it('someone else\'s character, a signed-out visitor and a rate-limited member write nothing', async () => {
    const a = deps();
    expect(await savePopFlags(a.d, 'Zarrin', LINES)).toEqual({ ok: false, error: 'not your character' });
    const b = deps({ userId: async () => null });
    expect(await savePopFlags(b.d, 'Aldenmar', LINES)).toEqual({ ok: false, error: 'not signed in' });
    const c = deps({ allow: () => false });
    expect((await savePopFlags(c.d, 'Aldenmar', LINES)).ok).toBe(false);
    expect(a.inserted.length + b.inserted.length + c.inserted.length).toBe(0);
  });
  it('the ownership check comes before any read of the table', async () => {
    let read = false;
    const { d } = deps({ heldKeys: async () => { read = true; return []; } });
    await savePopFlags(d, 'Zarrin', LINES);
    expect(read).toBe(false);
  });
  it('bad requests: no lines, too many, too long, not strings, no character; nothing readable', async () => {
    const { d, inserted } = deps();
    for (const [c, l] of [['Aldenmar', []], ['Aldenmar', Array(MAX_LINES + 1).fill('x')], ['Aldenmar', ['y'.repeat(MAX_LINE_LEN + 1)]],
      ['Aldenmar', [1, 2]], ['Aldenmar', 'text'], ['', LINES], [null, LINES], ['n'.repeat(65), LINES]]) {
      expect(await savePopFlags(d, c, l)).toEqual({ ok: false, error: 'bad request' });
    }
    expect((await savePopFlags(d, 'Aldenmar', ['hello there'])).ok).toBe(false);
    expect(inserted).toEqual([]);
  });
  it('a failed check or a failed insert is an error, not a silent success', async () => {
    expect((await savePopFlags(deps({ heldKeys: async () => null }).d, 'Aldenmar', LINES)).ok).toBe(false);
    expect((await savePopFlags(deps({ insert: async () => 'boom' }).d, 'Aldenmar', LINES)).ok).toBe(false);
  });
  it('the server reads the lines again: a key the browser invented is not written', async () => {
    const { d, inserted } = deps();
    await savePopFlags(d, 'Aldenmar', ['time_1', 'quarm_dead', 'Plane of Time access: Unlocked'.replace('Unlocked', 'Locked')]);
    expect(inserted).toEqual([]);
  });
  it('pasteRows de-duplicates a flag two steps imply', () => {
    const rows = pasteRows('wolfpack', 'Aldenmar', ['fuirstel_2', 'grummus_1'], '2026-10-26T00:00:00.000Z');
    expect(rows.filter(r => r.flag_key === 'grummus_dead')).toHaveLength(1);
  });
  it('the limiter is the Seer paste\'s, eight saves in ten minutes', () => {
    let t = 0;
    const allow = makeLimiter(8, 10 * 60_000, () => t);
    for (let i = 0; i < 8; i++) expect(allow('u')).toBe(true);
    expect(allow('u')).toBe(false);
    t += 10 * 60_000;
    expect(allow('u')).toBe(true);
  });
});

describe('the wiring (stripped source: a comment cannot answer for the code)', () => {
  const action = read('web/app/pop/raid/me/popflagsActions.ts');
  const comp = read('web/app/pop/raid/me/PopFlagsPaste.tsx');
  it('the action is a server action that checks ownership through the same owner walk as the Seer paste', () => {
    expect(fs.readFileSync(path.join(ROOT, 'web/app/pop/raid/me/popflagsActions.ts'), 'utf8').startsWith("'use server';")).toBe(true);
    expect(action).toMatch(/ownedCharacters\(userId\)/);
    expect(action).toMatch(/\.eq\('source', PASTE_SOURCE\)/);
    expect(action).toMatch(/upsert\(rows, \{ onConflict: 'guild_id,character,flag_key,earned_at', ignoreDuplicates: true \}\)/);
    expect(action).toMatch(/makeLimiter\(8, 10 \* 60_000\)/);
    expect(action).toMatch(/from\('pop_flags'\)/);
  });
  it('the component sends only the recognised lines, to that action, for the picked character', () => {
    expect(comp).toMatch(/const lines = parsed\.used;/);
    expect(comp).toMatch(/savePopFlagsPaste\(character, lines\)/);
    expect(comp).toMatch(/Read and save/);
    for (const n of ['1', '2', '3', '4', '5']) expect(comp).toContain(`#popflags ${n}`);
    expect(comp).not.toMatch(/localStorage|sessionStorage/);
  });
  it('the component imports nothing from the page it drops into', () => {
    expect(comp).not.toMatch(/from '\.\/page'/);
  });
});
