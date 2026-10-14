// Which PoP guide steps a flag step stands for, so a Seer paste can tick them (the guild lead, 2026-10-14: the
// next steps should tick or highlight the guide's own steps on the same page). The guide (popGuide.ts) names
// its steps by what you DO ("Kill Grummus"), the Seer by the server's variable value ("fuirstel 2"); this is the
// join. A step with a catalog `flag` is also proven by that flag (popGuide.ts tickedKeys), so the table only
// has to name the ones a flag cannot reach.
//
// Several flag steps can stand for one guide step (Askr's pieces and talisman are one quest), and a guide step
// can ask for several (the five Sol Ro wings). A guide step is proven when EVERY flag step listed for it is held.

import { GUIDE_ITEMS } from './popGuide';

export const STEP_GUIDE: Record<string, string> = {
  mavuin_1: 'justice_mavuin_info',
  mavuin_2: 'flag_trial_justice',
  mavuin_3: 'justice_tribunal',
  zeks_1: 'innovation_test',
  zeks_2: 'flag_behemoth',
  poi_door_1: 'innovation_door_key',
  fuirstel_1: 'disease_ward',
  fuirstel_2: 'flag_grummus',
  thelin_1: 'nightmare_adroha',
  thelin_2: 'flag_hedge',
  karana_1: 'flag_askr',
  karana_2: 'flag_askr',
  karana_3: 'storms_zone_bot',
  aerindar_1: 'flag_aerindar',
  aerindar_2: 'valor_zone_hoh',
  fuirstel_3: 'cod_fuirstel_before',
  bertox_key_1: 'flag_carprin',
  fuirstel_4: 'flag_bert',
  fuirstel_5: 'cod_fuirstel_after',
  thelin_3: 'flag_tthule',
  thelin_4: 'nightmare_poxbourne',
  tylis_1: 'torment_fahlia',
  tylis_2: 'flag_keeper',
  saryrn_1: 'flag_saryrn',
  karana_4: 'flag_agnarr',
  hoh_trial_1: 'hoh_trial_dragon',
  hoh_trial_2: 'hoh_trial_villagers',
  hoh_trial_3: 'hoh_trial_villager',
  mmarr_1: 'flag_marr',
  cipher_1: 'maelin_cipher',
  zebuxoruk_1: 'maelin_lore',
  zeks_3: 'flag_vallon',
  zeks_4: 'flag_tallon',
  zeks_6: 'zeks_maelin',
  zeks_7: 'flag_rallos',
  zebuxoruk_2: 'zebuxoruk_maelin',
  pofire_1: 'pofire_miak',
  sol_room_1: 'flag_solro_minis',
  sol_room_2: 'flag_solro_minis',
  sol_room_3: 'flag_solro_minis',
  sol_room_4: 'flag_solro_minis',
  sol_room_5: 'flag_solro_minis',
  pofire_2: 'flag_solro',
  earthb_key_1: 'flag_arbitor',
  avatars_air: 'flag_avatars_air',
  xegony_dead: 'flag_xegony',
  coirnav_dead: 'flag_coirnav',
  rathe_dead: 'flag_rathe',
  fennin_dead: 'flag_fennin',
  time_1: 'time_muon',
  quarm_dead: 'flag_quarm',
};

const STAGES_FOR: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [stage, guide] of Object.entries(STEP_GUIDE)) m.set(guide, [...(m.get(guide) ?? []), stage]);
  return m;
})();

/** The guide step a flag step belongs to, or null when the guide has no step for it. */
export function guideStepFor(stage: string): string | null {
  return STEP_GUIDE[stage] ?? null;
}

/** Every guide step that a set of held flag keys (already closed over what they imply: popRecital heldClosure)
 *  proves: the step's own catalog flag is held, or every flag step listed for it is. */
export function guideStepsProven(held: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const i of GUIDE_ITEMS) {
    if (i.flag && held.has(i.flag)) out.add(i.key);
    const stages = STAGES_FOR.get(i.key);
    if (stages && stages.every(s => held.has(s))) out.add(i.key);
  }
  return out;
}
