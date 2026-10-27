// scripts/pop-quest-planes.js — the hand-set PLANE of every PoP guide step, for the drill-down blocks in the
// PoP overlay's Quests mode (era → plane → quest). Read by scripts/sync-pop-quests.js, which writes each
// step's `plane` and the era list into the generated apps/mimic/pop-quests.js.
//
// The guild lead, 2026-10-04: "Maybe we make the catalog for quests an era/continent/plane separation in an
// easy big block way up top. the left/right can go through a specific quest or zone's quests, and we can drill
// down from top to bottom or up with the up button." Picked as the Drill-down blocks, Decision Desk
// 2026-10-19 (docs/DESIGN-history-and-quest-nav.md §3).
//
// WHY A TABLE AND NOT A GUESS. A step's plane cannot be read off where it happens: about a third of the steps
// are said in the hub zones (Tranquility, Knowledge) on behalf of a plane that is somewhere else ("Disease,
// before Grummus: ask Adler Fuirstel about the ward" is a Plane of Disease step spoken in Tranquility). So
// each step carries one tag, here. It is the block you would look for that step under.
//
// THREE BLOCKS ARE NOT A PLANE, and say so in their titles:
//   spells     the class-spell steps, which belong to no plane
//   levelling  "level and farm in the tier-one planes", which belongs to all four
//   chains     the optional multi-part quests (the Binden Concerrentia, the Essences of Power) whose parts are
//              in different tiers: one block keeps each chain together, in order
//   maelin     Grand Librarian Maelin's readings, in Knowledge, each of which opens the next tier
//
// A NEW STEP in web/lib/popGuide.ts needs a line in PLANE_OF; the sync stops without one (and stops on a plane
// no step uses, and on a PLANE_OF line for a step the guide no longer has), and test/pop-quest-nav.test.js
// says the same. The planes are listed in the order the blocks are drawn.
'use strict';

const ERAS = [
  {
    key: 'pop',
    title: 'Planes of Power',
    planes: [
      { key: 'pok',        title: 'Plane of Knowledge' },
      { key: 'spells',     title: 'Your PoP spells' },
      { key: 'levelling',  title: 'Levelling and farming' },
      { key: 'justice',    title: 'Plane of Justice' },
      { key: 'innovation', title: 'Plane of Innovation' },
      { key: 'disease',    title: 'Plane of Disease' },
      { key: 'nightmare',  title: 'Plane of Nightmare' },
      { key: 'tthule',     title: 'Lair of Terris Thule' },
      { key: 'decay',      title: 'Crypt of Decay' },
      { key: 'storms',     title: 'Plane of Storms' },
      { key: 'valor',      title: 'Plane of Valor' },
      { key: 'torment',    title: 'Plane of Torment' },
      { key: 'thunder',    title: 'Bastion of Thunder' },
      { key: 'honor',      title: 'Halls of Honor' },
      { key: 'maelin',     title: 'Maelin’s readings' },
      { key: 'tactics',    title: 'Plane of Tactics' },
      { key: 'solro',      title: 'Tower of Solusek Ro' },
      { key: 'fire',       title: 'Plane of Fire' },
      { key: 'air',        title: 'Plane of Air' },
      { key: 'water',      title: 'Plane of Water' },
      { key: 'earth',      title: 'Plane of Earth' },
      { key: 'chains',     title: 'Optional chains' },
      { key: 'time',       title: 'Plane of Time' },
    ],
  },
];

const PLANE_OF = {
  // Before the planes
  start_flag_fixers: 'pok',
  start_traveler_manual: 'pok',
  pok_taxidermy: 'pok',
  pok_merchant_crate: 'pok',
  pok_instruments: 'pok',
  pok_reflecting_pools: 'pok',
  pok_sage_research: 'pok',
  pok_books: 'pok',
  pok_gems: 'pok',
  pok_idols: 'pok',
  spells_submit_book: 'spells',
  spells_parchments: 'spells',
  spells_turn_in: 'spells',
  // Tier one
  t1_trash: 'levelling',
  disease_ward: 'disease',
  flag_grummus: 'disease',
  justice_mavuin_info: 'justice',
  flag_trial_justice: 'justice',
  justice_tribunal: 'justice',
  justice_mavuin_hail: 'justice',
  justice_seventh_hammer: 'justice',
  innovation_door_key: 'innovation',
  innovation_test: 'innovation',
  flag_behemoth: 'innovation',
  nightmare_adroha: 'nightmare',
  flag_hedge: 'nightmare',
  essences_escort: 'chains',
  binden_small: 'chains',
  // Tier two
  flag_tthule: 'tthule',
  nightmare_poxbourne: 'nightmare',
  cod_fuirstel_before: 'decay',
  flag_carprin: 'decay',
  flag_bert: 'decay',
  cod_fuirstel_after: 'decay',
  flag_askr: 'storms',
  storms_zone_bot: 'storms',
  valor_globe: 'valor',
  flag_aerindar: 'valor',
  valor_zone_hoh: 'valor',
  torment_fahlia: 'torment',
  torment_sphere: 'torment',
  flag_keeper: 'torment',
  flag_saryrn: 'torment',
  torment_return: 'torment',
  // Tier three
  bot_symbol: 'thunder',
  bot_tower: 'thunder',
  flag_agnarr: 'thunder',
  hoh_trial_dragon: 'honor',
  hoh_trial_villagers: 'honor',
  hoh_trial_villager: 'honor',
  flag_marr: 'honor',
  tactics_maelin_before: 'maelin',
  maelin_cipher: 'maelin',
  maelin_lore: 'maelin',
  flag_vallon: 'tactics',
  flag_tallon: 'tactics',
  zeks_maelin: 'maelin',
  flag_rallos: 'tactics',
  tactics_maelin_after: 'maelin',
  zebuxoruk_maelin: 'maelin',
  pofire_miak: 'solro',
  flag_solro_minis: 'solro',
  flag_solro: 'solro',
  binden_powered: 'chains',
  // Tier four
  flag_fennin: 'fire',
  air_key: 'air',
  flag_avatars_air: 'air',
  flag_xegony: 'air',
  flag_coirnav: 'water',
  earth_key: 'earth',
  flag_arbitor: 'earth',
  flag_rathe: 'earth',
  essences_power: 'chains',
  binden_final: 'chains',
  // Plane of Time
  time_vial: 'time',
  time_quintessence: 'time',
  time_muon: 'time',
  time_timelockout: 'time',
  flag_quarm: 'time',
};

// The PLANE each flag-chart zone (web/lib/popFlags.ts POP_ZONES) belongs to, for the Flags mode of the overlay: a tier
// chip ("Decay 0/2") jumps to that plane's step list. The chart splits some planes in two (the lower Crypt, the Temple
// of Marr, Ragrax, the Lair of Terris Thule); the blocks do not. The sync stops on a chart zone with no line here, on a
// line for a zone the chart dropped, and on a plane the table above does not list.
const ZONE_PLANE = {
  justice: 'justice', innovation: 'innovation', disease: 'disease', nightmare: 'nightmare',
  storms: 'storms', valor: 'valor', cod: 'decay', codb: 'decay', ponb: 'tthule', torment: 'torment',
  bot: 'thunder', hoh: 'honor', hohb: 'honor', tactics: 'tactics', solro: 'solro',
  earth: 'earth', poeb: 'earth', air: 'air', water: 'water', fire: 'fire',
  time: 'time',
};

// Two flag steps the server gives with the SAME hail as another step, so the guide has one step for both (web/lib/popSteps.ts
// labels them "(same hail)"): the Crypt of Decay key comes with Grummus's projection, Mithaniel's notes with Marr's. They
// have no STEP_GUIDE line of their own; the Flags mode links them to the step that does the hail.
const SAME_HAIL = { grummus_1: 'fuirstel_2', mmarr_book_1: 'mmarr_1' };

module.exports = { ERAS, PLANE_OF, ZONE_PLANE, SAME_HAIL };
