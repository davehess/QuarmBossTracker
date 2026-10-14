// Every character-flag step the server keeps, zone by zone (the guild lead, 2026-10-13: "update the entire page
// with all of the character flag steps required, not just the main ones").
//
// The server's flags are a handful of character variables (qglobals) that the zone scripts set: mavuin 1-3,
// fuirstel 1-5, thelin 1-4, zeks 1-7, karana 1-4 and so on. The list and every rule below were read off
// Quarm's own scripts (eqemu_quest_scripts: poknowledge/Seer_Mal_Nae-Shi.lua heads the full list; each
// projection and flag NPC sets its own), not a guide. utils/popFlagStages.js names the same stages from the
// lines the server prints, and pop_flags stores each one under its own key ('fuirstel_1').
//
// Three things the old chart could not say, all in the scripts:
//  - Several steps are a hail BEFORE the kill (Adler Fuirstel before Grummus, Adroha before the maze, Giwin
//    before the Behemoth, Fahlia before the Keeper). Kill first and the projection only gives a checklist
//    flag, which the Seer's "unlock memories" turns into the real one once the hail is done.
//  - Some steps print no flag line at all (the Crypt of Decay key from Grummus's projection, Aerin`Dar's
//    projection). Only the Seer's guided meditation shows them.
//  - A projection flags only the raid (or group) that got the kill (lua_modules/projection_eligibility.lua);
//    anyone else is refused without a word.

import type { FlagKind } from './popFlags';

export type StepHow = FlagKind | 'hail' | 'touch';

export type PopStep = {
  key: string;          // the stage key in pop_flags ('fuirstel_1'), or a catalog flag for steps with no stage
  label: string;        // what to do, in plain words
  where?: string;       // where it happens, when that is not the card's own zone
  how: StepHow;
  silent?: boolean;     // the server prints no flag line: only the Seer's meditation shows it
  checklist?: string;   // the checklist flag a kill leaves when the step before it is missing
  note?: string;
};

// Ordered steps per zone card (keys of POP_ZONES). A step sits on the card of the zone it unlocks or is
// earned in; a hail elsewhere names its place in `where`.
export const POP_STEPS: Record<string, PopStep[]> = {
  justice: [
    { key: 'mavuin_1', label: 'Hail Mavuin, take his case', how: 'hail' },
    { key: 'mavuin_2', label: 'Win a trial for the Tribunal', how: 'trial' },
    { key: 'mavuin_3', label: 'Say "Mavuin" to the Tribunal, then hail Mavuin', how: 'hail', note: 'The Justice flag: opens Valor and Storms' },
  ],
  innovation: [
    { key: 'zeks_1', label: 'Hail Giwin Mirakon before the Behemoth', how: 'hail' },
    { key: 'zeks_2', label: 'Kill the Manaetic Behemoth, hail Giwin', how: 'kill', checklist: 'cl_behemoth', note: 'Opens Tactics' },
    { key: 'poi_door_1', label: 'Kill Xanamech: Nitram opens the door', how: 'kill', note: 'The door to Meldrath\'s machine (Time)' },
  ],
  disease: [
    { key: 'fuirstel_1', label: 'Hail Adler Fuirstel before the kill', where: 'Tranquility', how: 'hail' },
    { key: 'fuirstel_2', label: 'Kill Grummus, hail the Planar Projection', how: 'kill', checklist: 'cl_grummus' },
    { key: 'grummus_1', label: 'Crypt of Decay key (same hail)', how: 'event', silent: true, note: 'Opens the Crypt of Decay' },
  ],
  nightmare: [
    { key: 'thelin_1', label: 'Hail Adroha Jezith before the maze', where: 'Tranquility', how: 'hail' },
    { key: 'thelin_2', label: 'Hedge maze, then hail Thelin Poxbourne', how: 'event', checklist: 'cl_maze', note: 'Opens the Lair of Terris Thule' },
  ],
  storms: [
    { key: 'karana_1', label: 'Kill the storm giants, hail Askr', how: 'kill' },
    { key: 'karana_2', label: 'Bring Askr the pieces: the talisman', how: 'quest' },
    { key: 'karana_3', label: 'Touch the shrine with the talisman', how: 'touch', note: 'Opens the Bastion of Thunder' },
  ],
  valor: [
    { key: 'aerindar_1', label: 'Kill Aerin`Dar, hail the Planar Projection', how: 'kill', silent: true, note: 'Needs the Justice flag first' },
    { key: 'aerindar_2', label: 'Enter the Halls of Honor door', how: 'event', note: 'Opens the Halls of Honor' },
  ],
  cod: [
    { key: 'fuirstel_3', label: 'Bring the ward to Elder Fuirstel', where: 'Tranquility', how: 'hail' },
    { key: 'bertox_key_1', label: 'Carprin cycle, then hail Tarkil Adan', how: 'event', note: 'Opens the lower Crypt' },
  ],
  codb: [
    { key: 'fuirstel_4', label: 'Kill Bertoxxulous, hail the Planar Projection', how: 'kill', checklist: 'cl_bertox' },
    { key: 'fuirstel_5', label: 'Hail Elder Fuirstel again', where: 'Tranquility', how: 'hail', note: 'Half of the Torment gate' },
  ],
  ponb: [
    { key: 'thelin_3', label: 'Kill Terris Thule, hail the Planar Projection', how: 'kill', checklist: 'cl_terris' },
    { key: 'thelin_4', label: 'Hail Thelin', where: 'Tranquility', how: 'hail', note: 'Half of the Torment gate' },
  ],
  torment: [
    { key: 'tylis_1', label: 'Hail Fahlia Shadyglade before the Keeper', where: 'Tranquility', how: 'hail' },
    { key: 'tylis_2', label: 'Kill the Keeper of Sorrows, hail Tylis Newleaf', how: 'kill', checklist: 'cl_keeper' },
    { key: 'saryrn_1', label: 'Kill Saryrn, hail the Planar Projection', how: 'kill', checklist: 'cl_saryrn', note: 'Half of the cipher' },
  ],
  bot: [
    { key: 'karana_4', label: 'Kill Agnarr, hail Karana: his notes', how: 'kill', checklist: 'cl_karana' },
    { key: 'zebuxoruk_1', label: 'Maelin reads Karana\'s and Mithaniel\'s notes', where: 'Knowledge', how: 'quest' },
    { key: 'zebuxoruk_2', label: 'Maelin: find a power source', where: 'Knowledge', how: 'quest', note: 'Opens Air, Earth and Water' },
  ],
  hoh: [
    { key: 'hoh_trial_1', label: 'Trial: beat Rydda`Dar', how: 'trial' },
    { key: 'hoh_trial_2', label: 'Trial: save the villagers', how: 'trial' },
    { key: 'hoh_trial_3', label: 'Trial: defeat the nomads', how: 'trial' },
  ],
  hohb: [
    { key: 'mmarr_1', label: 'Kill Mithaniel Marr, hail the Planar Projection', how: 'kill', checklist: 'cl_mmarr', note: 'Half of the cipher' },
    { key: 'mmarr_book_1', label: 'Mithaniel\'s notes (same hail)', how: 'kill', checklist: 'cl_mmarr_book', note: 'For Maelin\'s power source' },
    { key: 'cipher_1', label: 'Maelin joins the cipher halves', where: 'Knowledge', how: 'quest', note: 'Half of the Sol Ro gate' },
  ],
  tactics: [
    { key: 'zeks_3', label: 'Kill Vallon Zek, hail the Planar Projection', how: 'kill', checklist: 'cl_vallon' },
    { key: 'zeks_4', label: 'Kill Tallon Zek, hail the Planar Projection', how: 'kill', checklist: 'cl_tallon' },
    { key: 'zeks_6', label: 'Maelin reads both Zek notes', where: 'Knowledge', how: 'quest', note: 'Half of the Sol Ro gate' },
    { key: 'zeks_7', label: 'Kill Rallos Zek, hail the Planar Projection', how: 'kill', checklist: 'cl_rallos', note: 'Needed for the Doomfire flag' },
  ],
  solro: [
    { key: 'sol_room_1', label: 'Xuzl\'s wing: touch the cauldron', how: 'touch' },
    { key: 'sol_room_2', label: 'Arlyxir\'s wing: touch the cauldron', how: 'touch' },
    { key: 'sol_room_3', label: 'Protector of Dresolik\'s wing: touch the cauldron', how: 'touch' },
    { key: 'sol_room_4', label: 'Rizlona\'s wing: touch the cauldron', how: 'touch' },
    { key: 'sol_room_5', label: 'Jiva\'s wing: touch the cauldron', how: 'touch' },
    { key: 'pofire_1', label: 'Ask Miak about the portal\'s destination', where: 'Tranquility', how: 'hail' },
    { key: 'pofire_2', label: 'Kill Solusek Ro, hail the Planar Projection', how: 'kill', checklist: 'cl_solusek', note: 'Needs all five wings, Miak and the Rallos Zek step. Opens Doomfire' },
  ],
  earth: [
    { key: 'earthb_key_1', label: 'Kill the Arbitor (four rings), hail the projection', how: 'kill', note: 'Opens Ragrax' },
  ],
  poeb: [
    { key: 'rathe_dead', label: 'Kill the Rathe Council', how: 'kill' },
    { key: 'stone_loot', label: 'Loot the Mound of Living Stone', how: 'loot' },
  ],
  air: [
    { key: 'avatars_air', label: 'Kill the four air avatars', how: 'event' },
    { key: 'xegony_dead', label: 'Kill Xegony', how: 'kill' },
    { key: 'cloud_loot', label: 'Loot the Amorphous Cloud of Air', how: 'loot' },
  ],
  water: [
    { key: 'coirnav_dead', label: 'Kill Coirnav', how: 'kill' },
    { key: 'sphere_loot', label: 'Loot the Sphere of Coalesced Water', how: 'loot' },
  ],
  fire: [
    { key: 'fennin_dead', label: 'Kill Fennin Ro', how: 'kill' },
    { key: 'globe_loot', label: 'Loot the Globe of Dancing Flame', how: 'loot' },
  ],
  time: [
    { key: 'time_1', label: 'Meldrath\'s time machine with the four elemental items', where: 'Innovation', how: 'quest', note: 'The portal also needs level 65' },
    { key: 'quarm_dead', label: 'Kill Quarm', how: 'kill' },
  ],
};

// What holding a key proves about the other steps. The Seer shows only the latest value of a series and a
// later value can only follow the earlier ones, so a later value carries them; the catalog flags the rest of
// the page uses (web/lib/popFlags.ts) carry their own stage, so /who, loot and the owner's ticks count here too.
export const STEP_IMPLIES: Record<string, string[]> = {
  // series
  mavuin_3: ['mavuin_2'], mavuin_2: ['mavuin_1'],
  thelin_4: ['thelin_3'], thelin_3: ['thelin_2'], thelin_2: ['thelin_1'],
  fuirstel_5: ['fuirstel_4'], fuirstel_4: ['fuirstel_3', 'bertox_key_1'], fuirstel_3: ['fuirstel_2'],
  fuirstel_2: ['fuirstel_1', 'grummus_1'],   // one hail sets both (podisease/A_Planar_Projection.lua)
  bertox_key_1: ['grummus_1'],
  karana_4: ['karana_3'], karana_3: ['karana_2'], karana_2: ['karana_1'],
  tylis_2: ['tylis_1'], saryrn_1: ['tylis_2'],
  zeks_7: ['zeks_6'], zeks_6: ['zeks_5'], zeks_5: ['zeks_3', 'zeks_4'], zeks_3: ['zeks_2'], zeks_4: ['zeks_2'], zeks_2: ['zeks_1'],
  aerindar_2: ['aerindar_1'], aerindar_1: ['mavuin_3'],
  hohtrials_111: ['hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3'],
  mmarr_1: ['hohtrials_111'], mmarr_book_1: ['hohtrials_111'],
  cipher_1: ['saryrn_1', 'mmarr_1'],                 // the cipher replaces both halves
  zebuxoruk_2: ['zebuxoruk_1'], zebuxoruk_1: ['karana_4', 'mmarr_book_1'],   // and replaces both notes
  pofire_2: ['pofire_1', 'zeks_7', 'sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4', 'sol_room_5'],
  // catalog flags → their stage
  trial_justice: ['mavuin_3'], grummus_dead: ['grummus_1'], bert_dead: ['fuirstel_4'], carprin_cycle: ['bertox_key_1'],
  hedge_event: ['thelin_2'], tthule_dead: ['thelin_3'], behemoth_dead: ['zeks_2'],
  vallon_dead: ['zeks_3'], tallon_dead: ['zeks_4'], rallos_dead: ['zeks_7'],
  askr_quest: ['karana_3'], agnarr_dead: ['karana_4'], aerindar_dead: ['aerindar_2'],
  hoh_trials: ['hohtrials_111'], marr_dead: ['mmarr_1'], keeper_dead: ['tylis_2'], saryrn_dead: ['saryrn_1'],
  solro_minis: ['sol_room_1', 'sol_room_2', 'sol_room_3', 'sol_room_4', 'sol_room_5'],
  solro_dead: ['pofire_2'], arbitor_dead: ['earthb_key_1'],
};

// Every step a set of held keys proves: the keys themselves and everything they imply, all the way down.
export function stepsHeld(flags: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...flags];
  while (stack.length) {
    const k = stack.pop() as string;
    if (out.has(k)) continue;
    out.add(k);
    for (const next of STEP_IMPLIES[k] ?? []) if (!out.has(next)) stack.push(next);
  }
  return out;
}
