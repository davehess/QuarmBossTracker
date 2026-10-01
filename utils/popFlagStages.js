// utils/popFlagStages.js — PoP flags as the server keeps them.
//
// The guild lead, 2026-10-01, the day PoP opened: "POP is open, we need the flags to start updating"
// (DECISIONS §119). Every grant had been stored as 'unmapped': the grant line never names the flag,
// and the bot could only name one from the boss killed just before it. The trials, the Tranquility
// NPCs and the Seer have no boss.
//
// What the server really keeps is a handful of character variables (qglobals) that the zone scripts
// set: mavuin 1-3, fuirstel 1-5, thelin 1-4, zeks 1-7, karana 1-4 and so on (the full list heads
// poknowledge/Seer_Mal_Nae-Shi.lua in eqemu_quest_scripts). A STAGE here is one value of one of
// them: 'mavuin_3' is mavuin = 3. Every table below was read off those scripts on 2026-10-01; none
// of it comes from a guide.
//
// Three ways a stage is recognised, best first:
//  1. prev: every script prints a fixed line just before "You have received a character flag!".
//     The agent sends the start of that line when it opens like a flag NPC (agent 3.7.59+).
//  2. recital: sit, then say "guided meditation" to Seer Mal Nae`Shi in Plane of Knowledge, and she
//     prints one fixed sentence for every flag the character holds. The whole state in one go.
//  3. zone: where a zone has only one grant, the zone alone names it (older agents send only that).
// The bot's older boss map (POP_FLAG_BY_BOSS in index.js) still applies after these.
'use strict';

// Zeal reports the zone by number. eqemu_zone, checked 2026-10-01.
const ZONE_BY_ID = {
  200: 'codecay', 201: 'pojustice', 202: 'poknowledge', 203: 'potranquility', 204: 'ponightmare',
  205: 'podisease', 206: 'poinnovation', 207: 'potorment', 208: 'povalor', 209: 'bothunder',
  210: 'postorms', 211: 'hohonora', 212: 'solrotower', 213: 'powar', 214: 'potactics', 215: 'poair',
  216: 'powater', 217: 'pofire', 218: 'poeartha', 219: 'potimea', 220: 'hohonorb', 221: 'nightmareb',
  222: 'poearthb', 223: 'potimeb',
};

// [zone, kind, opening of the line printed just before the grant, stage]. kind is 'grant' for
// "You have received a character flag!" (Elder Poxbourne prints "You receive a character flag!")
// and 'checklist' for "You have received a new checklist flag!" (a kill without the step before it;
// the Seer's "unlock memories" turns it into the real flag later).
const PREV_STAGES = [
  ['pojustice',     'grant', "Mavuin tells you, 'I know it has been said for years", 'mavuin_1'],
  ['pojustice',     'grant', 'The Tribunal tells you, \'You have completed a trial', 'mavuin_2'],
  ['pojustice',     'grant', "Mavuin tells you, 'So you have pleaded my case", 'mavuin_3'],
  ['pojustice',     'grant', "The Tribunal tells you, 'Most impressive.", 'seventh_1'],
  ['potranquility', 'grant', "Adler Fuirstel tells you, 'The ward is carried", 'fuirstel_1'],
  ['potranquility', 'grant', 'Elder Fuirstel slowly turns towards you.', 'fuirstel_3'],
  ['potranquility', 'grant', "Elder Fuirstel tells you, 'Welcome back friend.", 'fuirstel_5'],
  ['potranquility', 'grant', "Adroha Jezith tells you, 'It is our belief that Terris-Thule", 'thelin_1'],
  ['potranquility', 'grant', "Thelin tells you, 'I apologize but I cannot stand to greet you.", 'thelin_4'],
  ['potranquility', 'grant', "Fahlia Shadyglade tells you, 'Wonderful. I did not think", 'tylis_1'],
  ['potranquility', 'grant', "Miak the Searedsoul says, 'I do not know if I will ever be able to correct", 'pofire_1'],
  ['podisease',     'grant', 'You recognize the sound of the voice echoing in your mind to be Milyk', 'fuirstel_2'],
  ['codecay',       'grant', "Milyk Fuirstel's thoughts enter into your own.", 'fuirstel_4'],
  ['codecay',       'grant', 'Tarkil Adan lets out a groan', 'bertox_key_1'],
  ['ponightmare',   'grant', "Thelin Poxbourne tells you, 'Please destroy her", 'thelin_2'],
  ['nightmareb',    'grant', "You recognize the voice in your mind to be Thelin Poxbourne's.", 'thelin_3'],
  ['poinnovation',  'grant', "Giwin Mirakon tells you, 'Haha!  I knew I sensed the warring spirit", 'zeks_1'],
  ['poinnovation',  'grant', 'Giwin Mirakon gives you a look of disbelief and then concern.', 'zeks_2'],
  ['poinnovation',  'grant', "Nitram Anizok tells you, 'Whew that was a close one!", 'poi_door_1'],
  ['potactics',     'grant', "You realize that the image is a projection of Maelin Starpyre's thoughts.  His thoughts enter into your own.  'The pack of notes you now possess from Vallon", 'zeks_3'],
  ['potactics',     'grant', "You realize that the image is a projection of Maelin Starpyre's thoughts.  His thoughts enter into your own.  'The pack of notes you now possess from Tallon", 'zeks_4'],
  ['potactics',     'grant', "Maelin Starpyre's thoughts enter into your own.  'The singed parchment", 'zeks_7'],
  ['potorment',     'grant', "Tylis Newleaf tells you, 'I must thank you for your kind efforts", 'tylis_2'],
  ['potorment',     'grant', "The Planar Projection's thoughts enter your own.  'You have done well,", 'saryrn_1'],
  ['hohonorb',      'grant', "The Planar Projection's thoughts enter your own.  'You have done well,", 'mmarr_1'],
  ['bothunder',     'grant', 'Karana begins to laugh quietly.', 'karana_4'],
  ['postorms',      'grant', 'Askr looks over the remnants of the storm giants', 'karana_1'],
  ['postorms',      'grant', "Askr the Lost says 'You have retrieved the pieces!", 'karana_2'],
  ['postorms',      'grant', 'An aura of soft light gleams around you as the shrine reacts', 'karana_3'],
  ['poeartha',      'grant', "A Planar Projection says, 'Your will must be strong", 'earthb_key_1'],
  ['solrotower',    'grant', "Miak the Searedsoul's thoughts enter into your own.  'That is it!", 'pofire_2'],
  ['solrotower',    'grant', 'As you place your hand on the burning cauldron, you feel arcane wisdom', 'sol_room_1'],
  ['solrotower',    'grant', 'As you place your hand on the burning cauldron, you feel a wealth of knowledge', 'sol_room_2'],
  ['solrotower',    'grant', 'As you place your hand on the burning cauldron, you feel a bolt of energy', 'sol_room_3'],
  ['solrotower',    'grant', 'As you place your hand on the burning cauldron, you feel relaxed as a short tune', 'sol_room_4'],
  ['solrotower',    'grant', 'As you place your hand on the burning cauldron, you feel your body fill with strength', 'sol_room_5'],
  ['poknowledge',   'grant', "Maelin tells you, 'Astounding, this truly is the Cipher", 'cipher_1'],
  ['poknowledge',   'grant', "Maelin tells you, 'This is quite interesting friends.", 'zebuxoruk_1'],
  ['poknowledge',   'grant', 'Maelin takes a deep breath and continues', 'zebuxoruk_2'],
  ['poknowledge',   'grant', "Maelin tells you, 'This cannot be.  You must hurry!", 'zeks_6'],
  // The Seer's "unlock memories": the remembered line comes first, then the grant.
  ['poknowledge',   'grant', 'For a moment you pause, sticking a hand in your pocket.', 'fuirstel_2'],
  ['poknowledge',   'grant', "Thelin speaks in your mind, 'It was an act of kindness", 'thelin_2'],
  ['poknowledge',   'grant', "Giwin Mirakon's image appears in your mind", 'zeks_2'],
  ['poknowledge',   'grant', 'You have learned the meaning of both Justice and Honor.', 'aerindar_2'],
  ['poknowledge',   'grant', 'You black out for a moment, in your nightmare you see Terris-Thule', 'thelin_3'],
  ['poknowledge',   'grant', 'You focus back to your battle with the Plaguebringer', 'fuirstel_4'],
  ['poknowledge',   'grant', "Tylis voice rings in your ears, 'Now I remember you.", 'tylis_2'],
  ['poknowledge',   'grant', 'You feel the searing pain of torment as half of the Cipher', 'saryrn_1'],
  ['poknowledge',   'grant', "Giwin's invitation to Drunder reminds you of some notes you found around Vallon's body.", 'zeks_3'],
  ['poknowledge',   'grant', "Giwin's invitation to Drunder reminds you of some notes you found around Tallon's body.", 'zeks_4'],
  ['poknowledge',   'grant', 'The Cipher on your arm glows for a moment', 'zeks_7'],
  ['poknowledge',   'grant', 'As you think back to your meeting with Karana the Talisman in your chest warms', 'karana_4'],
  ['poknowledge',   'grant', "An Image of Mithaniel flashes before you, 'You have finally earned a place of Honor.", 'mmarr_1'],
  ['poknowledge',   'grant', "An Image of Mithaniel flashes before you, 'These notes should assist you", 'mmarr_book_1'],
  ['codecay',       'checklist', 'The Planar Projection seems to flicker in and out of existence.', 'cl_bertox'],
  ['podisease',     'checklist', "The Planar Projection tells you, 'Now that Grummus has fallen", 'cl_grummus'],
  ['poinnovation',  'checklist', "Giwin Mirakon tells you, 'Hey what are you doing!", 'cl_behemoth'],
  ['ponightmare',   'checklist', "Thelin Poxbourne tells you, 'I do not recognize your face.", 'cl_maze'],
  ['potorment',     'checklist', "Tylis Newleaf tells you, 'I don't recognize you, stranger.", 'cl_keeper'],
  ['potorment',     'checklist', 'The Planar Projection seems to flicker in and out of existence.', 'cl_saryrn'],
  ['hohonorb',      'checklist', "The Planar Projection's thoughts enter your own.  'You have done well,", 'cl_mmarr'],
  ['bothunder',     'checklist', 'Karana begins to laugh quietly.', 'cl_karana'],
  ['solrotower',    'checklist', 'The Planar Projection flickers in and out of existence.', 'cl_solusek'],
];

// Zones with a single grant (or a single checklist) script: the zone alone names it, so grants from
// agents that send only the zone still resolve. Plane of Valor's grant is the Halls of Honor door
// (the Aerin`Dar projection sets its step silently).
const ZONE_ONLY = {
  grant: {
    povalor: 'aerindar_2', bothunder: 'karana_4', hohonorb: 'mmarr_1', nightmareb: 'thelin_3',
    podisease: 'fuirstel_2', poeartha: 'earthb_key_1', ponightmare: 'thelin_2',
  },
  checklist: {
    codecay: 'cl_bertox', podisease: 'cl_grummus', poinnovation: 'cl_behemoth', ponightmare: 'cl_maze',
    nightmareb: 'cl_terris', hohonorb: 'cl_mmarr', bothunder: 'cl_karana', solrotower: 'cl_solusek',
  },
};

// The three Plane of Tactics projections print the same checklist line; the boss just killed says which.
const TACTICS_CHECKLIST_BY_BOSS = { 'vallon zek': 'cl_vallon', 'tallon zek': 'cl_tallon', 'rallos zek': 'cl_rallos' };

// The Seer's guided meditation: [opening of the sentence, stage]. She shows only the latest value of a
// series, which is why STAGE_IMPLIES below fills in what a later value proves.
const RECITAL_STAGES = [
  ['Your soul has formed a bond with the Plane of Time', 'time_1'],
  ['The History translated for you reveals the fate of Zebuxoruk', 'zebuxoruk_1'],
  ["Learning of Zebuxoruk's fate, the only way to save him", 'zebuxoruk_2'],
  ['The information obtained from Mithaniel is written', 'mmarr_book_1'],
  ['You have shown your prowess in battle to Askr', 'karana_1'],
  ['You have obtained the Talisman of Thunderous Foyer from Askr', 'karana_2'],
  ['The information obtained from Karana is written', 'karana_4'],
  ['The Cipher of the Divine Language appears on your arms', 'cipher_1'],
  ['Saryrn been destroyed.', 'saryrn_1'],
  ['Mithaniel has been bested.', 'mmarr_1'],
  ["You have completed all of Honor's Trials.", 'hohtrials_111'],
  ["You have beaten Rydda`Dar in the first of Honor's Trials.", 'hoh_trial_1'],
  ["You have saved the villagers in the second of Honor's Trials.", 'hoh_trial_2'],
  ["You have defeated the nomads in the third of Honor's Trials.", 'hoh_trial_3'],
  ['You have bested Aerin`Dar and proven yourself honorable enough', 'aerindar_2'],
  ['The evidence of Mavuin is the only thing that can save him now.', 'mavuin_1'],
  ['Having endured the trials, the Tribunal has agreed to reconsider', 'mavuin_2'],
  ['Mavuin is grateful to you for taking his case before the Tribunal.', 'mavuin_3'],
  ['Tylis is being tortured by Saryrn.', 'tylis_1'],
  ['Tylis has been removed from his agony.', 'tylis_2'],
  ['Thelin being tormented by the imagery of Terris Thule', 'thelin_1'],
  ['Thelin has completed his pact with Terris Thule', 'thelin_2'],
  ["Terris Thule's grasp over Thelin has been released.", 'thelin_3'],
  ['Saved from a world of eternal nightmares, Thelin is forever in your debt.', 'thelin_4'],
  ['Alder Fuirstel wishes you to obtain the Ward', 'fuirstel_1'],
  ['Grummus has been destroyed, about his corpse you found a small ward', 'fuirstel_2'],
  ['Milyk has been saved from certain death, but is not recovering.', 'fuirstel_3'],
  ['Bertoxxulous has been slain, the curse from Milyk now lifted.', 'fuirstel_4'],
  ['Saved from certain doom, Milyk and Adler are forever in your debt.', 'fuirstel_5'],
  ['Now that Grummus has been destroyed, the entrance to the Crypt of Bertoxxulous', 'grummus_1'],
  ['The portal into the Plane of Fire has been altered.', 'pofire_1'],
  ["Xuzl's arcane wisdom pulses in your mind.", 'sol_room_1'],
  ["Arlyxir's wealth of knowledge flows through your mind.", 'sol_room_2'],
  ['The power of Dresolik surges through you.', 'sol_room_3'],
  ["Rizlona's song slips through your thoughts.", 'sol_room_4'],
  ["Jiva's strength fills your body.", 'sol_room_5'],
  ['The true route to the Plane of Fire is now clear in your mind.', 'pofire_2'],
  ['Giwin would like you to find him in Drunder', 'zeks_2'],
  ['The pack of notes from Vallon are scribbled', 'zeks_3'],
  ['The pack of notes from Tallon are scribbled', 'zeks_4'],
  ["The words of Maelin echo in your mind, 'The Zeks and Solusek", 'zeks_6'],
  ['The parchments of Rallos are scribed in a language', 'zeks_7'],
  ["You remember Nitram's words", 'poi_door_1'],
];

// What a stage proves, in the catalog's terms (web/lib/popFlags.ts). A later value of a series
// carries the earlier steps, and the cipher and Zebuxoruk steps replace the flags they were built from.
// Steps that prove no catalog flag (mavuin_1, the checklist flags, ...) map to nothing and are kept
// as their own rows only.
const STAGE_IMPLIES = {
  mavuin_3: ['trial_justice'],
  fuirstel_2: ['grummus_dead'], fuirstel_3: ['grummus_dead'], grummus_1: ['grummus_dead'],
  fuirstel_4: ['grummus_dead', 'bert_dead'], fuirstel_5: ['grummus_dead', 'bert_dead'],
  bertox_key_1: ['carprin_cycle'],
  thelin_2: ['hedge_event'], thelin_3: ['hedge_event', 'tthule_dead'], thelin_4: ['hedge_event', 'tthule_dead'],
  zeks_2: ['behemoth_dead'],
  zeks_3: ['behemoth_dead', 'vallon_dead'], zeks_4: ['behemoth_dead', 'tallon_dead'],
  zeks_5: ['behemoth_dead', 'vallon_dead', 'tallon_dead'], zeks_6: ['behemoth_dead', 'vallon_dead', 'tallon_dead'],
  // zeks 7 can only follow 6, and Sol Ro's portal asks for "6 or more" (catalog key zeks_6).
  zeks_7: ['behemoth_dead', 'vallon_dead', 'tallon_dead', 'rallos_dead', 'zeks_6'],
  aerindar_2: ['aerindar_dead'],
  tylis_2: ['keeper_dead'],
  saryrn_1: ['saryrn_dead'],
  mmarr_1: ['marr_dead'], hohtrials_111: ['hoh_trials'],
  cipher_1: ['saryrn_dead', 'marr_dead'],
  // Thunder's portal asks for karana 3 or more (the Storms shrine); Askr's medallion (2) is not enough.
  karana_3: ['askr_quest'], karana_4: ['askr_quest', 'agnarr_dead'],
  zebuxoruk_1: ['askr_quest', 'agnarr_dead', 'marr_dead'], zebuxoruk_2: ['askr_quest', 'agnarr_dead', 'marr_dead'],
  earthb_key_1: ['arbitor_dead'],
  pofire_2: ['solro_dead'],
  time_1: ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead'],
};

const _norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const _PREV = PREV_STAGES.map(([zone, kind, prefix, stage]) => ({ zone, kind, prefix: _norm(prefix), stage }));
const _RECITAL = RECITAL_STAGES.map(([prefix, stage]) => ({ prefix: _norm(prefix), stage }));

function zoneShort(zone) {
  if (zone == null || zone === '') return null;
  const n = Number(zone);
  if (Number.isInteger(n) && ZONE_BY_ID[n]) return ZONE_BY_ID[n];
  return String(zone).toLowerCase();
}

// One uploaded event → { stage, via } or null. `boss` is the agent's last boss kill, already lowercased
// by the caller's key function.
function resolveStage(e, bossKey) {
  if (!e) return null;
  const kind = e.kind === 'checklist' ? 'checklist' : (e.kind === 'recital' ? 'recital' : 'grant');
  if (kind === 'recital') {
    const t = _norm(e.text);
    if (!t) return null;
    const hit = _RECITAL.find(r => t.startsWith(r.prefix));
    return hit ? { stage: hit.stage, via: 'recital' } : null;
  }
  const zone = zoneShort(e.zone);
  const prev = _norm(e.prev);
  if (prev) {
    // The longest matching opening wins, so the two Tactics projections (same first 120 characters)
    // are told apart by the rest.
    let best = null;
    for (const p of _PREV) {
      if (p.kind !== kind || !prev.startsWith(p.prefix)) continue;
      if (zone && p.zone !== zone) continue;
      if (!best || p.prefix.length > best.prefix.length) best = p;
    }
    if (best) return { stage: best.stage, via: 'prev' };
  }
  if (kind === 'checklist' && zone === 'potactics' && TACTICS_CHECKLIST_BY_BOSS[bossKey]) {
    return { stage: TACTICS_CHECKLIST_BY_BOSS[bossKey], via: 'boss' };
  }
  const only = zone && ZONE_ONLY[kind][zone];
  return only ? { stage: only, via: 'zone' } : null;
}

module.exports = {
  ZONE_BY_ID, PREV_STAGES, RECITAL_STAGES, ZONE_ONLY, STAGE_IMPLIES, TACTICS_CHECKLIST_BY_BOSS,
  zoneShort, resolveStage,
};
