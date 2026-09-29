// More per step for the PoP checklist's beta layouts (the guild lead, 2026-09-29: "the pop guide page
// needs some love. more detail, maps, who to turn things into, expectations and who you will go back
// to. a sidebar nav with sections"). Keyed by GUIDE_ITEMS key, so web/lib/popGuide.ts stays the one
// list of steps and this file only adds to them.
//
//   expect  — what to expect: who comes, how long, what can go wrong.
//   turnIn  — who takes what, and what you get back. give/get are [[Item#id]] tokens.
//   back    — who you go back to afterwards.
//   auto    — how the step fills itself in (Mimic or the database), in words for the row.
//
// Every NPC here is placed (eqemu_spawn2) and every hand-in is read off the NPC's quest script
// (eqemu_quest_scripts), same rules as popGuide.ts.

import { GUIDE_ITEMS, type Loc } from './popGuide';

export type TurnIn = { to: Loc; give: string; get?: string; note?: string };
export type StepMore = { expect?: string; turnIn?: TurnIn[]; back?: Loc[]; auto?: string };

// A place a step already names, so this file never re-types coordinates (popGuide.ts owns them).
// A missing one reads as a hole the test catches (test/pop-guide-more.test.js), never a crash.
function at(key: string, i = 0): Loc {
  return GUIDE_ITEMS.find(g => g.key === key)?.where?.[i] as Loc;
}

const FLAG_AUTO = 'Ticks itself when Mimic sees “You have received a character flag!” right after this kill.';

// Checked 2026-09-29 against the quest scripts (#Mavuin, The_Tribunal, Askr_the_Lost, postorms and
// bothunder player.lua, Karana) — DECISIONS §86.
export const STEP_MORE: Record<string, StepMore> = {
  start_level46: { auto: 'Ticks itself from your level on /who.' },
  start_mimic: { auto: 'Ticks itself once Mimic has reported this character.' },
  start_traveler_manual: { auto: 'Ticks itself when your last inventory upload holds the manual.' },
  spells_submit_book: { auto: 'Ticks itself once your spellbook is uploaded.' },
  spells_parchments: { auto: 'Ticks itself when your last inventory upload holds all three.' },

  justice_mavuin_info: {
    expect: 'Solo, a minute. He tells his story; “information” is the word that counts.',
    back: [at('justice_tribunal')],
  },
  flag_trial_justice: {
    expect: 'A raid. Six Marks drop per win, one each, so bring six who need it and run it again for the rest. Pick any of the six trials. A loss can be retried in a minute, a win in ten.',
    back: [at('justice_tribunal')],
    auto: 'Ticks itself when Mimic sees you loot a Mark in the Plane of Justice.',
  },
  justice_tribunal: {
    expect: 'Solo, seconds. The Tribunal looks for a Mark in your bags. You keep it, so hold on to it for the Seventh Hammer.',
    back: [at('justice_mavuin_hail')],
  },
  justice_mavuin_hail: {
    expect: 'Solo, seconds. This hail is the Justice flag, and the Storms shrine checks it before it lets you into the Bastion of Thunder.',
  },
  justice_seventh_hammer: {
    expect: 'A raid, later. Needs all six Marks on one person, so six trial wins. Not needed for any flag.',
  },

  flag_askr: {
    expect: 'A group clears a camp at a time. Everyone needs their own head, their own three parts and two medallions from different camps, and each camp’s named drops three medallions. Stay in the zone until you are done with him: leaving resets the conversation.',
    turnIn: [
      { to: at('flag_askr'), give: 'one [[Storm Giant Head#28749]] (any camp’s)', get: '[[Askr’s Bag of Verity#17192]] after “it was me”, “paying attention”, “continue”, “continue”' },
      { to: at('flag_askr'), give: '[[Askr’s Sealed Bag of Verity#11487]] (beard + bone + sash combined in the bag)', get: 'the first flag; say “bastion of thunder” for a second bag' },
      { to: at('flag_askr'), give: '[[Esoteric Meld#11488]] (two medallions from different camps, combined)', get: 'the Askr flag' },
    ],
    back: [at('storms_zone_bot')],
  },
  storms_zone_bot: {
    expect: 'Solo. With both flags the shrine sends you to the lower halls of the Bastion of Thunder. Without the Justice flag it finds “no mystic symbol”: go back to Mavuin.',
  },

  bot_symbol: {
    expect: 'The raid farms the four spheres and one Unadorned Symbol. One raider carries the finished Symbol; everyone else clicks the portal within 5 minutes of them.',
    turnIn: [{ to: at('bot_symbol'), give: 'the [[Symbol of Torden#9433]] on your cursor, then click', get: '5 minutes for your raid to follow you in' }],
  },
  bot_tower: {
    expect: 'A raid. Everyone talks to Askr twice, once after each tower boss. Askr, the vortex and Karana stay 55 minutes.',
    back: [at('flag_agnarr')],
  },
  flag_agnarr: {
    expect: 'A raid. Karana answers up to 72 people from the raid with the kill. Ask for the path of the Fallen before “send me”, which casts Gate.',
    auto: FLAG_AUTO,
  },

  flag_behemoth: {
    expect: 'A raid. The Behemoth wakes when the 10th clockwork device dies. Giwin Mirakon appears near the boss room afterwards.',
    back: [at('innovation_test')],
    auto: FLAG_AUTO,
  },
  flag_grummus: { auto: FLAG_AUTO },
  flag_tthule: { back: [at('nightmare_poxbourne')], auto: FLAG_AUTO },
  flag_bert: { back: [at('cod_fuirstel_after')], auto: FLAG_AUTO },
  flag_aerindar: { auto: FLAG_AUTO },
  flag_saryrn: { back: [at('torment_return'), at('torment_return', 1)], auto: FLAG_AUTO },
  flag_keeper: { back: [at('torment_return', 1)], auto: FLAG_AUTO },
};

// Every place a step sends you: where[] + the chain's start + turn-ins + who you go back to.
export function stepPlaces(item: { where?: Loc[]; chain?: { first: { at: Loc } } }, more?: StepMore): Loc[] {
  const out: Loc[] = [...(item.where ?? [])];
  if (item.chain) out.push(item.chain.first.at);
  for (const t of more?.turnIn ?? []) out.push(t.to);
  for (const b of more?.back ?? []) out.push(b);
  const seen = new Set<string>();
  return out.filter(l => {
    if (!l) return false;
    const k = `${l.zone}|${l.npc}|${l.y}|${l.x}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
