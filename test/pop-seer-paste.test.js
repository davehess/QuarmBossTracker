// test/pop-seer-paste.test.js — "Paste what the Seer says" on /pop/guide (the guild lead, 2026-10-14: "reverse
// engineer this so that peoples flags can just copy what the seer says and fix their flags and get next steps").
//
// The reader (web/lib/popRecital.ts) and the save rules (web/lib/popRecitalSave.ts) run for real. The sentences are
// the ones Quarm's own script prints (poknowledge/Seer_Mal_Nae-Shi.lua, read from eqemu_quest_scripts on
// 2026-10-14), written out in full, so a table entry that only matches its own opening is still caught. The page
// wiring is read as stripped source (stripJs: a comment must not answer for the code).
//
// Run: npx vitest run test/pop-seer-paste.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import {
  RECITAL_STAGES, STAGE_IMPLIES, parseRecital, heldClosure, zoneViews, recitalRows,
} from '../web/lib/popRecital.ts';
import { STEP_GUIDE, guideStepsProven, guideStepFor } from '../web/lib/popGuideSeer.ts';
import { MAX_SENTENCES, MAX_SENTENCE_LEN, makeLimiter, saveRecital } from '../web/lib/popRecitalSave.ts';
import { GUIDE_ITEMS, GUIDE_KEYS } from '../web/lib/popGuide.ts';
import { POP_FLAGS } from '../web/lib/popFlags.ts';
import { POP_STEPS } from '../web/lib/popSteps.ts';

const require = createRequire(import.meta.url);
const S = require('../utils/popFlagStages.js');
const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// What the Seer prints, whole, per stage (Message(257, …) in her script; Aldenmar and friends are not in it).
const SAID = {
  time_1: 'Your soul has formed a bond with the Plane of Time.  You can now pass through the portal in the Plane of Tranquility safely.',
  zebuxoruk_1: 'The History translated for you reveals the fate of Zebuxoruk.  Trapped in the Plane of Time you must gain the power of the elements to gain entrance.',
  zebuxoruk_2: "Learning of Zebuxoruk's fate, the only way to save him is gather materials that will allow you to power up the machine to send you into the Plane of Time.  Maelin has charged you with finding an elemental power source sufficient to activate Meldrath's time machine.",
  mmarr_book_1: 'The information obtained from Mithaniel is written in a language that you cannot comprehend.',
  karana_1: 'You have shown your prowess in battle to Askr, now you must make strides to get to the Bastion of Thunder.',
  karana_2: 'You have obtained the Talisman of Thunderous Foyer from Askr, he seeks further assistance in the Bastion of Thunder.',
  karana_4: 'The information obtained from Karana is written in a language that you cannot comprehend.',
  cipher_1: 'The Cipher of the Divine Language appears on your arms for a brief moment then fades.',
  saryrn_1: 'Saryrn been destroyed.  An aura surrounds the mystical symbols that have appeared on your arm.',
  mmarr_1: 'Mithaniel has been bested.  An aura surrounds the mystical symbols that have appeared on your arm.',
  hohtrials_111: "You have completed all of Honor's Trials.",
  hoh_trial_1: "You have beaten Rydda`Dar in the first of Honor's Trials.",
  hoh_trial_2: "You have saved the villagers in the second of Honor's Trials.",
  hoh_trial_3: "You have defeated the nomads in the third of Honor's Trials.",
  aerindar_2: "You have bested Aerin`Dar and proven yourself honorable enough to pass into Mithaniel's Halls.",
  mavuin_1: 'The evidence of Mavuin is the only thing that can save him now.',
  mavuin_2: "Having endured the trials, the Tribunal has agreed to reconsider Mavuin's case.",
  mavuin_3: 'Mavuin is grateful to you for taking his case before the Tribunal.  The information provided to you, that Mithaniel Marr and Karana carry information you should seek, could be quite useful.',
  tylis_1: 'Tylis is being tortured by Saryrn.  The only way for him to get away from his misery is to escape from the Plane of Torment.',
  tylis_2: 'Tylis has been removed from his agony.',
  thelin_1: 'Thelin being tormented by the imagery of Terris Thule needs assisstance escaping from the Plane of Nightmares.',
  thelin_2: 'Thelin has completed his pact with Terris Thule, but has been refused. The only way to escape his torment now is to destroy Terris Thule.',
  thelin_3: "Terris Thule's grasp over Thelin has been released.",
  thelin_4: 'Saved from a world of eternal nightmares, Thelin is forever in your debt.',
  fuirstel_1: 'Alder Fuirstel wishes you to obtain the Ward from the Plane of Disease and take it to his ill brother Milyk.',
  fuirstel_2: 'Grummus has been destroyed, about his corpse you found a small ward to protect from disease.',
  fuirstel_3: 'Milyk has been saved from certain death, but is not recovering.  Only by destroying the ruler of all things pestilent will his curse be lifted.',
  fuirstel_4: 'Bertoxxulous has been slain, the curse from Milyk now lifted.',
  fuirstel_5: 'Saved from certain doom, Milyk and Adler are forever in your debt.',
  grummus_1: 'Now that Grummus has been destroyed, the entrance to the Crypt of Bertoxxulous should open before your might.',
  pofire_1: 'The portal into the Plane of Fire has been altered.  Miak needs you to find the correct way to channel the portal.',
  sol_room_1: "Xuzl's arcane wisdom pulses in your mind.",
  sol_room_2: "Arlyxir's wealth of knowledge flows through your mind.",
  sol_room_3: 'The power of Dresolik surges through you.',
  sol_room_4: "Rizlona's song slips through your thoughts.",
  sol_room_5: "Jiva's strength fills your body.",
  pofire_2: 'The true route to the Plane of Fire is now clear in your mind.',
  zeks_2: 'Giwin would like you to find him in Drunder so he can present you to Rallos Zek.',
  zeks_3: 'The pack of notes from Vallon are scribbled in a language that you cannot comprehend.',
  zeks_4: 'The pack of notes from Tallon are scribbled in a language that you cannot comprehend.',
  zeks_6: "The words of Maelin echo in your mind, 'The Zeks and Solusek are planning an invasion of Norrath, find out more from Rallos if you can.'",
  zeks_7: 'The parchments of Rallos are scribed in a language that you cannot comprehend; they do however have detailed drawings of the manaetic behemoth that you have already destroyed.',
  poi_door_1: "You remember Nitram's words - 'three small turns to the right on the bottommost rivet should open the door'.",
};
const STAMP = '[Tue Oct 14 20:11:02 2026] ';

describe('one source of truth: the web copy of the tables is the bot’s and the agent’s', () => {
  it('RECITAL_STAGES is utils/popFlagStages.js’s, entry for entry and in order', () => {
    expect(RECITAL_STAGES).toEqual(S.RECITAL_STAGES);
  });
  it('STAGE_IMPLIES is utils/popFlagStages.js’s', () => {
    expect(STAGE_IMPLIES).toEqual(S.STAGE_IMPLIES);
  });
  it('every sentence the Seer prints has an entry, and every entry a sentence here', () => {
    expect(Object.keys(SAID).sort()).toEqual(RECITAL_STAGES.map(([, stage]) => stage).sort());
  });
  it('reads every sentence to the stage the bot reads it to (resolveStage), however it is wrapped', () => {
    for (const [stage, said] of Object.entries(SAID)) {
      expect(S.resolveStage({ kind: 'recital', text: said }).stage, stage).toBe(stage);
      for (const wrapped of [said, STAMP + said, STAMP.trim() + '   ' + said + '  ']) {
        expect(parseRecital(wrapped).stages, `${stage} in ${wrapped.slice(0, 30)}`).toEqual([stage]);
      }
    }
  });
});

describe('what a paste looks like', () => {
  const lines = [SAID.mavuin_3, SAID.fuirstel_4, SAID.thelin_3];
  it('log lines, with a timestamp each', () => {
    const p = parseRecital(lines.map(l => STAMP + l).join('\n'));
    expect(p.stages.sort()).toEqual(['fuirstel_4', 'mavuin_3', 'thelin_3']);
    expect(p.unknown).toEqual([]);
  });
  it('a Tells-window copy: no timestamps, Windows line ends, blank lines, indentation', () => {
    const p = parseRecital(lines.map(l => '   ' + l).join('\r\n\r\n') + '\r\n');
    expect(p.stages.sort()).toEqual(['fuirstel_4', 'mavuin_3', 'thelin_3']);
  });
  it('the short clock a chat window copies', () => {
    expect(parseRecital('[20:11:02] ' + SAID.cipher_1).stages).toEqual(['cipher_1']);
    expect(parseRecital('[8:11 PM] ' + SAID.cipher_1).stages).toEqual(['cipher_1']);
  });
  it('curly quotes, a backtick for an apostrophe and any case', () => {
    expect(parseRecital("YOU HAVE COMPLETED ALL OF HONOR’S TRIALS.").stages).toEqual(['hohtrials_111']);
    expect(parseRecital("You have beaten Rydda'Dar in the first of Honor`s Trials.").stages).toEqual(['hoh_trial_1']);
  });
  it('a sentence a copy wrapped onto two lines is still one sentence', () => {
    const p = parseRecital("Alder Fuirstel wishes you to obtain the Ward from the\nPlane of Disease and take it to his ill brother Milyk.");
    expect(p.stages).toEqual(['fuirstel_1']);
    expect(p.unknown).toEqual([]);
  });
  it('a wrapped sentence with a clock on each line: the clock in the middle does not split it', () => {
    const p = parseRecital("[20:11:02] Alder Fuirstel wishes you to obtain the Ward from the\n[20:11:03] Plane of Disease and take it to his ill brother Milyk.");
    expect(p.stages).toEqual(['fuirstel_1']);
    expect(p.unknown).toEqual([]);
    expect(p.matched[0].text).not.toMatch(/\[|20:11/);
    // …and the sentence the clock would have split, matched across the break, is what proves it.
    expect(parseRecital("Giwin would like you to find him in [20:11:03] Drunder so he can present you to Rallos Zek.").stages).toEqual(['zeks_2']);
  });
  it('the whole session: her invitation, chat, a flag line and a sentence nobody knows', () => {
    const p = parseRecital([
      "Seer Mal Nae`Shi tells you, 'You will never be able to focus unless you are relaxed.  Please, sit down for a moment and allow me to [guide your meditation].'",
      STAMP + SAID.mavuin_2,
      STAMP + 'Brackwyn tells the guild, \'who has a spare ring for the Seer quest tonight\'',
      STAMP + 'You have received a character flag!',
      STAMP + 'You manage to recover some images from your childhood, but no recent events spark a memory.',
      STAMP + 'You hit a gnoll pup for 12 points of damage.',
      STAMP + 'Zarrin the Lost whispers a brand new sentence the table has never seen.',
      STAMP + 'Zarrin the Lost whispers a brand new sentence the table has never seen.',
    ].join('\n'));
    expect(p.stages).toEqual(['mavuin_2']);
    expect(p.unknown).toEqual(['Zarrin the Lost whispers a brand new sentence the table has never seen.']);   // once, no stamp
    expect(p.lines).toBe(8);
  });
  it('nothing recognised is an empty read, not a throw', () => {
    for (const t of ['', '   \n\n', 'hello', null, undefined]) {
      expect(parseRecital(t).stages, String(t)).toEqual([]);
    }
  });
  it('a whole log pasted by mistake stays bounded', () => {
    const big = Array.from({ length: 1500 }, (_, i) => `[Tue Oct 14 20:11:02 2026] Some narrator line number ${i} of a very long log`).join('\n');
    const p = parseRecital(big + '\n' + SAID.time_1);
    expect(p.stages).toEqual(['time_1']);
    expect(p.unknown.length).toBeLessThanOrEqual(25);
  });
  it('reads only the first 200,000 characters of a paste', () => {
    const pad = 'x'.repeat(200_001) + '\n';
    expect(parseRecital(pad + SAID.time_1).stages).toEqual([]);
    expect(parseRecital(SAID.time_1 + '\n' + pad).stages).toEqual(['time_1']);
  });
  it('each matched sentence, read alone, gives its stage back (what a save sends)', () => {
    const p = parseRecital(Object.values(SAID).map(s => STAMP + s).join('\n'));
    expect(p.stages.length).toBe(Object.keys(SAID).length);
    for (const m of p.matched) {
      expect(m.text.length).toBeLessThanOrEqual(MAX_SENTENCE_LEN);
      expect(parseRecital(m.text).stages).toContain(m.stage);
    }
  });
});

describe('what the stages prove', () => {
  it('a later value carries the earlier steps and the catalog flags', () => {
    const h = heldClosure(['fuirstel_4']);
    for (const k of ['fuirstel_3', 'fuirstel_2', 'fuirstel_1', 'grummus_dead', 'bert_dead', 'bertox_key_1', 'carprin_cycle']) expect(h.has(k), k).toBe(true);
    expect(h.has('fuirstel_5')).toBe(false);
  });
  it('the time bond carries the four elemental kills; the parchments carry the Zek notes and the Rallos kill', () => {
    const t = heldClosure(['time_1']);
    for (const k of ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead']) expect(t.has(k), k).toBe(true);
    const z = heldClosure(['zeks_7']);
    for (const k of ['zeks_6', 'zeks_3', 'zeks_4', 'zeks_1', 'rallos_dead', 'vallon_dead', 'tallon_dead', 'behemoth_dead']) expect(z.has(k), k).toBe(true);
  });
  it('the grid: Justice done opens Storms and Valor and leaves Torment shut, saying what it needs', () => {
    const v = Object.fromEntries(zoneViews(heldClosure(['mavuin_3'])).map(x => [x.zone.key, x]));
    expect(v.justice.todo).toEqual([]);
    expect(v.justice.done.map(s => s.key)).toEqual(['mavuin_1', 'mavuin_2', 'mavuin_3']);
    expect(v.storms.open && v.valor.open).toBe(true);
    expect(v.storms.todo[0].key).toBe('karana_1');
    expect(v.torment.open).toBe(false);
    expect(v.torment.missing.sort()).toEqual([POP_FLAGS.fuirstel_5.label, POP_FLAGS.thelin_4.label].sort());
    expect(v.disease.open && v.nightmare.open && v.innovation.open).toBe(true);
  });
  it('the lower crypt opens on Bertoxxulous’s key, which only the Crypt step and the closure give', () => {
    const v = Object.fromEntries(zoneViews(heldClosure(['fuirstel_4'])).map(x => [x.zone.key, x]));
    expect(v.codb.open).toBe(true);
  });
  it('the Seer cannot show a loot or the air avatars, so those are never "next"', () => {
    const all = zoneViews(heldClosure(['time_1'])).flatMap(v => v.todo);
    expect(all.some(s => s.how === 'loot' || s.key === 'avatars_air')).toBe(false);
  });
  it('a character with nothing: tier one is open with its first steps, the rest waits', () => {
    const v = zoneViews(heldClosure([]));
    expect(v.filter(x => x.open).map(x => x.zone.key).sort()).toEqual(['disease', 'innovation', 'justice', 'nightmare']);
    expect(v.every(x => x.done.length === 0)).toBe(true);
  });
});

describe('the guide’s own steps', () => {
  it('every flag step named points at a real guide step and a real stage step', () => {
    const steps = new Set(Object.values(POP_STEPS).flat().map(s => s.key));
    for (const [stage, guide] of Object.entries(STEP_GUIDE)) {
      expect(GUIDE_KEYS.has(guide), guide).toBe(true);
      expect(steps.has(stage), stage).toBe(true);
    }
  });
  it('a step with a catalog flag is proven by the stage that gives the flag (the two never disagree)', () => {
    for (const [stage, guide] of Object.entries(STEP_GUIDE)) {
      const flag = GUIDE_ITEMS.find(i => i.key === guide).flag;
      if (!flag || stage === 'aerindar_1' || stage === 'karana_1') continue;
      // The stage that names the guide step first in its series must carry the flag; a step later in the series does too.
      if (STAGE_IMPLIES[stage] || stage === flag) expect(heldClosure([stage]).has(flag), `${stage} → ${flag}`).toBe(true);
    }
  });
  it('Justice: mavuin 3 ticks the four steps before it, mavuin 1 only the first', () => {
    const all = guideStepsProven(heldClosure(['mavuin_3']));
    for (const k of ['justice_mavuin_info', 'flag_trial_justice', 'justice_tribunal', 'justice_mavuin_hail']) expect(all.has(k), k).toBe(true);
    const one = guideStepsProven(heldClosure(['mavuin_1']));
    expect(one.has('justice_mavuin_info')).toBe(true);
    expect(one.has('flag_trial_justice')).toBe(false);
  });
  it('the five Sol Ro wings are one step: four of them prove nothing, five do', () => {
    expect(guideStepsProven(heldClosure(['sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4'])).has('flag_solro_minis')).toBe(false);
    expect(guideStepsProven(heldClosure(['sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4', 'sol_room_5'])).has('flag_solro_minis')).toBe(true);
  });
  it('a plane’s next step maps to its row in the guide', () => {
    expect(guideStepFor('fuirstel_1')).toBe('disease_ward');
    expect(guideStepFor('quarm_dead')).toBe('flag_quarm');
    expect(guideStepFor('stone_loot')).toBeNull();
  });
});

describe('the rows a save writes', () => {
  const at = '2026-10-14T20:30:00.000Z';
  it('the shape the agent’s upload stores: the stage, then each flag it implies, source recital, one time', () => {
    const rows = recitalRows('wolfpack', 'Aldenmar', ['fuirstel_4'], at);
    expect(rows.map(r => r.flag_key)).toEqual(['fuirstel_4', 'grummus_dead', 'bert_dead']);
    for (const r of rows) {
      expect(r).toMatchObject({ guild_id: 'wolfpack', character: 'Aldenmar', source: 'recital', earned_at: at, stage: 'fuirstel_4', zone: null, boss: null, npc: null });
    }
  });
  it('one row per flag key even when two stages imply the same flag', () => {
    const rows = recitalRows('wolfpack', 'Aldenmar', ['zeks_3', 'zeks_4', 'zeks_7'], at);
    const keys = rows.map(r => r.flag_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('behemoth_dead');
  });
});

// A fake world: one signed-in member who owns two characters, a pop_flags table keyed like the real one.
function world({ user = 'u1', owned = ['Aldenmar', 'Brackwyn'], clock = '2026-10-14T20:30:00.000Z', allow = () => true } = {}) {
  const table = [];
  const calls = { owned: 0, keys: 0, insert: 0 };
  let now = new Date(clock);
  const deps = {
    guildId: 'wolfpack',
    userId: async () => user,
    owned: async () => { calls.owned++; return owned; },
    recitalKeys: async (name, keys) => { calls.keys++; return table.filter(r => r.source === 'recital' && r.character.toLowerCase() === name.toLowerCase() && keys.includes(r.flag_key)).map(r => r.flag_key); },
    insert: async (rows) => {
      calls.insert++;
      for (const r of rows) {
        if (table.some(x => x.guild_id === r.guild_id && x.character === r.character && x.flag_key === r.flag_key && x.earned_at === r.earned_at)) continue;   // the table's own key
        table.push(r);
      }
      return null;
    },
    now: () => now,
    allow,
  };
  return { deps, table, calls, tick: (ms) => { now = new Date(now.getTime() + ms); } };
}
const paste = (...stages) => stages.map(s => STAMP + SAID[s]);

describe('saving: whose character, and never twice', () => {
  it('writes the rows for your own character, under the roster’s casing, at one time', async () => {
    const w = world();
    const res = await saveRecital(w.deps, 'aldenmar', paste('fuirstel_4', 'mavuin_3'));
    expect(res).toEqual({ ok: true, written: 5, already: 0, stages: 2 });
    expect(new Set(w.table.map(r => r.character))).toEqual(new Set(['Aldenmar']));
    expect(new Set(w.table.map(r => r.earned_at)).size).toBe(1);
    expect(w.table.every(r => r.source === 'recital' && r.guild_id === 'wolfpack')).toBe(true);
    expect(w.table.map(r => r.flag_key).sort()).toEqual(['bert_dead', 'fuirstel_4', 'grummus_dead', 'mavuin_3', 'trial_justice']);
  });
  it('refuses a character that is not on your account, and writes and reads nothing', async () => {
    const w = world();
    const res = await saveRecital(w.deps, 'Zarrin', paste('mavuin_3'));
    expect(res).toEqual({ ok: false, error: 'not your character' });
    expect(w.table).toEqual([]);
    expect(w.calls.keys + w.calls.insert).toBe(0);
  });
  it('refuses a stranger’s character even if it is the same text in another case or padded', async () => {
    const w = world({ owned: ['Aldenmar'] });
    for (const name of ['Brackwyn', 'BRACKWYN ', 'Aldenmar2', 'Alden%', '%', '']) {
      expect((await saveRecital(w.deps, name, paste('mavuin_3'))).ok, JSON.stringify(name)).toBe(false);
    }
    expect(w.table).toEqual([]);
  });
  it('not signed in: no ownership lookup, no rows', async () => {
    const w = world({ user: null });
    expect(await saveRecital(w.deps, 'Aldenmar', paste('mavuin_3'))).toEqual({ ok: false, error: 'not signed in' });
    expect(w.calls.owned + w.calls.keys + w.calls.insert).toBe(0);
  });
  it('a re-paste never duplicates: the same paste a minute later writes nothing', async () => {
    const w = world();
    await saveRecital(w.deps, 'Aldenmar', paste('fuirstel_4'));
    const before = w.table.length;
    w.tick(60_000);
    const again = await saveRecital(w.deps, 'Aldenmar', paste('fuirstel_4'));
    expect(again).toEqual({ ok: true, written: 0, already: 3, stages: 1 });
    expect(w.table.length).toBe(before);
  });
  it('a longer paste later adds only what is new', async () => {
    const w = world();
    await saveRecital(w.deps, 'Aldenmar', paste('fuirstel_3'));
    w.tick(86_400_000);
    const res = await saveRecital(w.deps, 'Aldenmar', paste('fuirstel_5'));
    // fuirstel_5 + grummus_dead + bert_dead; grummus_dead was already saved by fuirstel_3.
    expect(res).toEqual({ ok: true, written: 2, already: 1, stages: 1 });
    expect(w.table.filter(r => r.flag_key === 'grummus_dead').length).toBe(1);
  });
  it('the same flag for two of your characters is two rows, one each', async () => {
    const w = world();
    await saveRecital(w.deps, 'Aldenmar', paste('mavuin_3'));
    await saveRecital(w.deps, 'Brackwyn', paste('mavuin_3'));
    expect(w.table.filter(r => r.flag_key === 'mavuin_3').map(r => r.character).sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });
  it('a flag Mimic already recorded under another source does not stop the recital row', async () => {
    const w = world();
    w.table.push({ guild_id: 'wolfpack', character: 'Aldenmar', flag_key: 'mavuin_3', source: 'event', earned_at: '2026-10-02T01:00:00Z' });
    const res = await saveRecital(w.deps, 'Aldenmar', paste('mavuin_3'));
    expect(res.written).toBe(2);
  });
  it('a paste with no Seer sentence in it saves nothing', async () => {
    const w = world();
    const res = await saveRecital(w.deps, 'Aldenmar', ['Brackwyn tells you, hello there my friend']);
    expect(res.ok).toBe(false);
    expect(w.calls.insert).toBe(0);
  });
  it('stores only the rows: no field carries pasted text', async () => {
    const w = world();
    await saveRecital(w.deps, 'Aldenmar', paste('mavuin_3').map(l => l + ' SECRET-WORDS'));
    expect(JSON.stringify(w.table)).not.toMatch(/SECRET-WORDS|Mavuin is grateful/);
    expect(Object.keys(w.table[0]).sort()).toEqual(['boss', 'character', 'earned_at', 'flag_key', 'guild_id', 'npc', 'source', 'stage', 'zone']);
  });
  it('bad requests are refused before anything is read', async () => {
    const w = world();
    const good = paste('mavuin_3');
    const bad = [
      [undefined, good], [42, good], ['Aldenmar', 'a string'], ['Aldenmar', []], ['Aldenmar', [1]],
      ['Aldenmar', new Array(MAX_SENTENCES + 1).fill(good[0])], ['Aldenmar', ['x'.repeat(MAX_SENTENCE_LEN + 1)]],
      ['x'.repeat(65), good],
    ];
    for (const [c, s] of bad) expect((await saveRecital(w.deps, c, s)).ok, JSON.stringify([c, String(s).slice(0, 20)])).toBe(false);
    expect(w.calls.owned + w.calls.keys + w.calls.insert).toBe(0);
  });
  it('the rate limit is asked after sign-in and before any read; a database failure is an error, not a silent skip', async () => {
    const limited = world({ allow: () => false });
    expect((await saveRecital(limited.deps, 'Aldenmar', paste('mavuin_3'))).ok).toBe(false);
    expect(limited.calls.owned).toBe(0);
    const w = world();
    w.deps.recitalKeys = async () => null;
    expect((await saveRecital(w.deps, 'Aldenmar', paste('mavuin_3'))).ok).toBe(false);
    const x = world();
    x.deps.insert = async () => 'boom: secret detail';
    const res = await saveRecital(x.deps, 'Aldenmar', paste('mavuin_3'));
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/boom|secret/);
  });
});

describe('the rate limit', () => {
  it('lets N through a window, then waits, then lets more through', () => {
    let t = 0;
    const allow = makeLimiter(3, 1000, () => t);
    expect([allow('a'), allow('a'), allow('a'), allow('a')]).toEqual([true, true, true, false]);
    expect(allow('b')).toBe(true);
    t = 1001;
    expect(allow('a')).toBe(true);
  });
});

describe('the page wiring (stripped source)', () => {
  const actions = read('web/app/pop/guide/actions.ts');
  const box = read('web/app/pop/guide/SeerPaste.tsx');
  const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
  const route = read('web/app/pop/guide/GuideRoute.tsx');
  it('the action takes the roster from ownedCharacters, writes with the service role and goes through saveRecital', () => {
    const from = actions.indexOf('export async function saveSeerRecital');
    const block = actions.slice(from, actions.indexOf('export async function', from + 10));
    expect(block).toMatch(/saveRecital\(/);
    expect(block).toMatch(/ownedCharacters\(userId\)/);
    expect(block).toMatch(/supabaseAdmin\(\)/);
    expect(block).toMatch(/\.eq\('source', 'recital'\)/);
    expect(block).toMatch(/ignoreDuplicates: true/);
    expect(block).toMatch(/onConflict: 'guild_id,character,flag_key,earned_at'/);
    expect(block).not.toMatch(/isOfficer/);   // an officer ticks for anyone; a recital is for YOUR character
  });
  it('the browser sends the matched sentences, never the whole paste', () => {
    expect(box).toMatch(/parsed\.matched\.map\(m => m\.text\)/);
    expect(box).toMatch(/saveSeerRecital\(character, sentences\)/);
    expect(box).not.toMatch(/saveSeerRecital\([^)]*\btext\b/);
    expect(box).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
  it('is a native <details> that starts closed, at the top of both layouts', () => {
    expect(box).toMatch(/<details className="bg-panel/);
    expect(box.slice(box.indexOf('<details className="bg-panel'), box.indexOf('<summary'))).not.toMatch(/\bopen\b/);
    expect(box).toMatch(/Paste what the Seer says/);
    expect(checklist.indexOf('<SeerPaste')).toBeGreaterThan(0);
    expect(checklist.indexOf('<SeerPaste')).toBeLessThan(checklist.indexOf('<section className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-3">'));
    expect(route.indexOf('<SeerPaste')).toBeLessThan(route.indexOf('<aside className="lg:w-60'));
  });
  it('switching character clears the paste, so its ticks never land on another', () => {
    expect(box).toMatch(/useEffect\(\(\) => \{ setParsed\(null\); setStatus\(null\); \}, \[character\]\)/);
  });
  it('a pasted step is locked like a recorded one, and the next step is ringed in both layouts', () => {
    expect(checklist).toMatch(/seer\?\.proven\.has\(item\.key\)\) return/);
    expect(checklist).toMatch(/seer === 'next'/);
    expect(route).toMatch(/seerNext/);
    expect(route).toMatch(/source: 'seer'/);
  });
});

describe('the Start here section and the figurine are gone', () => {
  it('no guide step, section, level, evidence rule or Mimic quest still names them', () => {
    const quests = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'pop-quests.js'), 'utf8');
    expect(quests).not.toMatch(/Wooden Figurine|start_level46|start_pok_bind|start_popflags|start_mimic|start_guild_books|start_hails|start_charm/);
    expect(quests).not.toMatch(/"title": "Start here"/);
    const auto = read('web/lib/popGuideAuto.ts');
    expect(auto).not.toMatch(/start_level46|start_mimic/);
    const route = read('web/app/pop/guide/routeData.ts');
    expect(route).not.toMatch(/who_directory|character_live_state/);
  });
});
