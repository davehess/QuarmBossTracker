// test/pop-guide-steps.test.js — the PoP guide's say/hand-in fill (the guild lead, 2026-10-03: the Mimic
// PoP overlay should show "all of the things to say or do for any of the pop quests or flags"). The steps
// that were only "hail X" or "kill X" were filled from the quest scripts in eqemu_quest_scripts; every
// phrase carries `src`, the script it was read from.
//
// Nothing here can reach the database, so SCRIPT_KEYWORDS below is a snapshot: every findi("…") keyword
// of each cited script, pulled with one regexp_matches over eqemu_quest_scripts.body on 2026-10-03. A say
// must be EXACTLY one of its script's keywords — the bracketed words are what the player types, and a
// paraphrase ("what lore" for "lore") is the failure this guards. Re-pull the list if a script is cited
// that is not in it. ⚠ Upstream scripts (SecretsOTheP/quests): Quarm may differ.
//
// Run: npx vitest run test/pop-guide-steps.test.js

import { describe, it, expect } from 'vitest';
import { GUIDE_ITEMS, GUIDE_KEYS, ZONE_NAMES, splitItems, guideItemIds } from '../web/lib/popGuide.ts';
import { STEP_MORE, stepPlaces } from '../web/lib/popGuideMore.ts';
import { POP_FLAGS } from '../web/lib/popFlags.ts';

const step = (k) => GUIDE_ITEMS.find(i => i.key === k);
const at = (k) => GUIDE_ITEMS.findIndex(i => i.key === k);
const words = (k) => (step(k).says ?? []).map(s => s.text);
const ids = (t) => splitItems(t ?? '').filter(p => 'item' in p).map(p => p.item.id);

const SCRIPT_KEYWORDS = {
  'potranquility/Elder_Poxbourne.lua': ['hail'],
  'potranquility/Elder_Fuirstel.lua': ['hail'],
  'potranquility/Miak_the_Searedsoul.lua': ['hail', 'plane of fire', 'demise', "portal's destination"],
  'potranquility/Fahlia_Shadyglade.lua': ['hail', 'condition', 'black cube', 'plane of torment', 'will go'],
  'potranquility/Tylis_Newleaf.lua': ['hail'],
  'potorment/#Tylis_Newleaf.lua': ['hail', 'ready to return'],
  'codecay/Tarkil_Adan.lua': ['hail'],
  'poinnovation/#Giwin_Mirakon.lua': ['hail'],
  'poinnovation/Nitram_Anizok.lua': ['hail', 'advanced tinkering', 'construction', 'instinct for survival', 'combination of batteries', 'collecting materials'],
  'poinnovation/#Chronographer_Muon.lua': ['hail', 'yes'],
  'poinnovation/Loreseeker_Maelin.lua': ['hail', 'researched'],
  'pojustice/#Mavuin.lua': ['hail', 'information'],
  'poknowledge/Grand_Librarian_Maelin.lua': ['hail', 'lore', 'information'],
  'ponightmare/encounters/Maze.lua': ['hail', 'dagger', 'help', 'ready'],
  'hohonora/encounters/RyddaDar.lua': ['hail', 'trials', 'ready'],
  'hohonora/encounters/Villagers.lua': ['hail', 'ready'],
  'hohonora/encounters/Crazed.lua': ['hail', 'ready'],
};

// Every step whose phrases were added from a script.
const FILLED = [
  'nightmare_poxbourne', 'cod_fuirstel_before', 'cod_fuirstel_after', 'flag_hedge', 'flag_carprin',
  'flag_behemoth', 'innovation_door_key', 'torment_return', 'flag_keeper', 'justice_mavuin_hail',
  'hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager',
  'maelin_cipher', 'maelin_lore', 'zeks_maelin', 'zebuxoruk_maelin', 'pofire_miak', 'time_muon',
];

describe('every filled step has phrases, each with a script and exactly that script’s keyword', () => {
  for (const key of FILLED) {
    it(key, () => {
      const s = step(key);
      expect(s, `${key} is missing`).toBeTruthy();
      expect(s.says?.length, `${key} has no says`).toBeGreaterThan(0);
      for (const say of s.says) {
        expect(say.text.trim(), key).not.toBe('');
        expect(say.src, `${key} “${say.text}” has no src`).toBeTruthy();
        const kws = SCRIPT_KEYWORDS[say.src];
        expect(kws, `${key}: ${say.src} is not in the keyword snapshot`).toBeTruthy();
        expect(kws, `${key}: “${say.text}” is not a keyword of ${say.src}`).toContain(say.text.toLowerCase());
        expect(say.text.startsWith('/'), key).toBe(false);
        expect(/\bdelete\b/i.test(say.text), key).toBe(false);
      }
    });
  }
});

describe('the gaps from the research pass', () => {
  it('Elder Poxbourne, both Elder Fuirstel visits, Tarkil Adan, Giwin and the Mavuin hail each say Hail', () => {
    for (const k of ['nightmare_poxbourne', 'cod_fuirstel_before', 'cod_fuirstel_after', 'flag_carprin', 'flag_behemoth', 'justice_mavuin_hail']) {
      expect(words(k), k).toEqual(['Hail']);
    }
    expect(step('nightmare_poxbourne').detail).toMatch(/no “have”/);
    expect(step('cod_fuirstel_before').detail).toMatch(/from 2 to 3/);
    expect(step('cod_fuirstel_after').detail).toMatch(/to 5/);
  });

  it('the hedge maze: four words outside, two inside, and the last hail', () => {
    const maze = step('flag_hedge');
    expect(maze.says.map(s => [s.to, s.text])).toEqual([
      ['Thelin Poxbourne (outside the maze)', 'Hail'], ['Thelin Poxbourne (outside the maze)', 'dagger'],
      ['Thelin Poxbourne (outside the maze)', 'help'], ['Thelin Poxbourne (outside the maze)', 'ready'],
      ['Thelin (inside the dream)', 'Hail'], ['Thelin (inside the dream)', 'ready'],
      ['Thelin (after he and Terris have talked)', 'Hail'],
    ]);
    expect(maze.where.map(l => [l.zone, l.y, l.x])).toEqual([['ponightmare', 1104, -1519]]);
    expect(ids(maze.detail)).toEqual([9258, 9259]);   // Dagger Blade Shard in, Thelin's Dagger out
    expect(maze.detail).toMatch(/5 minutes/);
  });

  it('the Halls of Honor trials: start words, then the hail after the win', () => {
    expect(step('hoh_trial_dragon').says.map(s => s.text)).toEqual(['Hail', 'trials', 'ready', 'Hail']);
    expect(step('hoh_trial_villagers').says.map(s => s.text)).toEqual(['Hail', 'ready', 'Hail']);
    expect(step('hoh_trial_villager').says.map(s => s.text)).toEqual(['Hail', 'ready', 'Hail']);
    for (const k of ['hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager']) {
      const phases = step(k).says.map(s => s.to);
      expect(phases[0], k).toMatch(/to start the trial/);
      expect(phases[phases.length - 1], k).toMatch(/after the win/);
    }
  });

  it('the Fahlia and Tylis return hails are story only, and Tylis in Torment adds "ready to return"', () => {
    expect(step('torment_return').says.map(s => [s.to, s.text])).toEqual([['Fahlia Shadyglade', 'Hail'], ['Tylis Newleaf', 'Hail']]);
    expect(step('torment_return').detail).toMatch(/neither hail gives a flag/);
    expect(words('flag_keeper')).toEqual(['Hail', 'ready to return']);
  });
});

describe('the gates that had no step', () => {
  it('the cipher, the Zek notes and the power source are Maelin’s three words, in the order the script needs', () => {
    expect(words('maelin_cipher')).toEqual(['Hail']);
    expect(words('maelin_lore')).toEqual(['lore']);
    expect(words('zeks_maelin')).toEqual(['information']);
    expect(words('zebuxoruk_maelin')).toEqual(['information']);
    // Marr, then the cipher and the notes, the Zeks, the Zek reading before Rallos, the power source after him.
    const seq = ['flag_marr', 'maelin_cipher', 'maelin_lore', 'flag_vallon', 'flag_tallon', 'zeks_maelin', 'flag_rallos',
      'tactics_maelin_after', 'zebuxoruk_maelin'];
    expect(seq.map(at)).toEqual([...seq.map(at)].sort((a, b) => a - b));
    expect(seq.every(k => at(k) >= 0)).toBe(true);
  });

  it('each ticks from its own catalog flag, and no two steps share one', () => {
    expect(step('maelin_cipher').flag).toBe('cipher_1');
    expect(step('zeks_maelin').flag).toBe('zeks_6');
    expect(step('zebuxoruk_maelin').flag).toBe('zebuxoruk_2');
    expect(step('time_muon').flag).toBe('time_1');
    for (const k of ['maelin_cipher', 'zeks_maelin', 'zebuxoruk_maelin', 'time_muon']) expect(POP_FLAGS[step(k).flag], k).toBeTruthy();
    const flags = GUIDE_ITEMS.map(i => i.flag).filter(Boolean);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('sit with the neighbours: solo, must, tier three', () => {
    for (const k of ['maelin_cipher', 'maelin_lore', 'zeks_maelin', 'zebuxoruk_maelin', 'pofire_miak']) {
      expect(step(k).section, k).toBe('t3');
      expect(step(k).who, k).toBe('solo');
      expect(step(k).must, k).toBe(true);
    }
  });

  it('Miak’s four words, before the Sol Ro steps, at her placed spot', () => {
    expect(words('pofire_miak')).toEqual(['Hail', 'plane of fire', 'demise', "portal's destination"]);
    expect(at('pofire_miak')).toBeLessThan(at('flag_solro_minis'));
    expect(at('pofire_miak')).toBeLessThan(at('flag_solro'));
    expect(step('pofire_miak').where.map(l => [l.zone, l.y, l.x])).toEqual([['potranquility', 255, -2255]]);
  });

  it('Chronographer Muon and Loreseeker Maelin carry you to the machine; the click is the Plane of Time flag', () => {
    const t = step('time_muon');
    expect(t.says.map(s => [s.to, s.text])).toEqual([['Chronographer Muon', 'Hail'], ['Chronographer Muon', 'yes'], ['Loreseeker Maelin', 'researched']]);
    expect(t.where.map(l => l.npc)).toEqual(['Chronographer Muon', 'Loreseeker Maelin', 'The time machine']);
    expect(t.detail).toMatch(/Clicking the time machine is what sets your Plane of Time flag/);
  });
});

describe('what the script shows as a click or a trade, not a phrase', () => {
  it('the Crystalline Globe and the five Sol Ro wings have no says, and say they are clicks', () => {
    for (const k of ['valor_globe', 'flag_solro_minis']) {
      expect(step(k).says, k).toBeUndefined();
      expect(step(k).detail, k).toMatch(/click/);
    }
    expect(step('valor_globe').detail).toMatch(/Nobody speaks/);
    expect(step('flag_solro_minis').detail).toMatch(/Nobody speaks/);
  });

  it('the five wings give a boss and a cauldron each, in the order of the server’s sol_room digits', () => {
    const w = step('flag_solro_minis').where;
    expect(w.map(l => l.npc)).toEqual([
      'Xuzl', 'Xuzl’s flaming cauldron', 'Arlyxir', 'Arlyxir’s flaming cauldron',
      'The Protector of Dresolik', 'Dresolik’s flaming cauldron', 'Rizlona', 'Rizlona’s flaming cauldron',
      'Jiva', 'Jiva’s flaming cauldron',
    ]);
    for (const l of w) {
      expect(l.zone).toBe('solrotower');
      expect(Number.isInteger(l.y) && Number.isInteger(l.x), l.npc).toBe(true);
    }
    expect(step('valor_globe').where.map(l => l.zone)).toEqual(['povalor', 'povalor']);
  });

  it('the factory "key" is a flag from Nitram Anizok after three parts, said so, with the trade in "Who takes what"', () => {
    const k = step('innovation_door_key');
    expect(k.detail).toMatch(/The script gives no item/);
    expect(k.says.map(s => s.text)).toEqual(['Hail', 'advanced tinkering', 'construction', 'instinct for survival',
      'combination of batteries', 'collecting materials', 'Hail']);
    const give = STEP_MORE.innovation_door_key.turnIn[0];
    expect(give.to.npc).toBe('Nitram Anizok');
    expect(ids(give.give)).toEqual([9295, 9426, 9434]);
    // The item cards load from the step's own text, so the same ids must be named there.
    for (const id of [9295, 9426, 9434]) expect(guideItemIds()).toContain(id);
    expect(STEP_MORE.innovation_door_key.back[0].npc).toBe('The main factory door');
  });

  it('Tarkil Adan’s script sets a flag, and the step still says what it said before', () => {
    expect(step('flag_carprin').detail).toMatch(/keyring/);
    expect(step('flag_carprin').detail).toMatch(/bertox_key/);
  });
});

describe('the new places', () => {
  it('every zone they name is a known zone, so the copy buttons and maps work', () => {
    for (const z of ['codecay', 'povalor', 'solrotower']) expect(ZONE_NAMES[z], z).toBeTruthy();
    for (const k of FILLED.concat(['valor_globe', 'flag_solro_minis'])) {
      for (const l of stepPlaces(step(k), STEP_MORE[k])) {
        expect(ZONE_NAMES[l.zone], `${k} ${l.npc}`).toBeTruthy();
        expect(Number.isInteger(l.y) && Number.isInteger(l.x), `${k} ${l.npc}`).toBe(true);
      }
    }
    expect(step('flag_carprin').where.map(l => [l.zone, l.y, l.x])).toEqual([['codecay', 330, 309]]);
  });

  it('no step lost its key', () => {
    for (const k of ['innovation_door_key', 'flag_behemoth', 'flag_hedge', 'nightmare_poxbourne', 'cod_fuirstel_before',
      'cod_fuirstel_after', 'flag_carprin', 'valor_globe', 'flag_keeper', 'torment_return', 'justice_mavuin_hail',
      'hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager', 'tactics_maelin_before', 'tactics_maelin_after',
      'flag_solro_minis', 'time_muon']) expect(GUIDE_KEYS.has(k), k).toBe(true);
  });
});
