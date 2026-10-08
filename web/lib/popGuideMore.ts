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

import { GUIDE_ITEMS, type Loc, type SectionKey } from './popGuide';
import { POP_ZONES, TIER_COLORS, TIER_LABELS } from './popFlags';

// The checklist by progression level (the guild lead, 2026-10-01: "group them by the progression level
// and give us a side bar in that page. collapse them as well by default"). The tiers are the /pop
// chart's, in its colours, each naming its planes; everything before the first plane is one level.
export type GuideLevel = { key: string; title: string; sub: string; color: string; sections: SectionKey[] };
const planesOf = (tier: number) => POP_ZONES.filter(z => z.tier === tier && !z.subZoneOf).map(z => z.short).join(' · ');
const tierLevel = (key: SectionKey, tier: number): GuideLevel =>
  ({ key, title: TIER_LABELS[tier].name, sub: planesOf(tier), color: TIER_COLORS[tier], sections: [key] });
export const GUIDE_LEVELS: GuideLevel[] = [
  { key: 'before', title: 'Before the planes', sub: 'Start here · Knowledge quests · your spells', color: '#6e7681', sections: ['start', 'pok', 'spells'] },
  tierLevel('t1', 1), tierLevel('t2', 2), tierLevel('t3', 3), tierLevel('t4', 4), tierLevel('time', 5),
];

export type TurnIn = { to: Loc; give: string; get?: string; note?: string };
// brief: the step in one or two plain sentences, 120 characters at most (the guild lead, 2026-10-04: "The
// What to do is wordy"). The Mimic PoP overlay shows it in place of `detail` and folds the full detail and
// `expect` under "More"; nothing in `detail` or `expect` was removed for it. It never repeats a phrase or a
// place that the step's seq or where already lists.
export type StepMore = { expect?: string; turnIn?: TurnIn[]; back?: Loc[]; auto?: string; brief?: string };

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
    auto: 'Ticks itself when Mimic records your Justice flag, which is this hail.',
  },
  justice_seventh_hammer: {
    expect: 'A raid, later. Needs all six Marks on one person, so six trial wins. Not needed for any flag.',
  },

  flag_askr: {
    expect: 'A group clears a camp at a time. Everyone needs their own head, their own three parts and two medallions from different camps, and each camp’s named drops three medallions. Stay in the zone until you are done with him: leaving resets the conversation.',
    turnIn: [
      { to: at('flag_askr'), give: 'one [[Storm Giant Head#28749]] (any camp’s)', get: '[[Askr’s Bag of Verity#17192]] after “it was me”, “paying attention”, “continue”, “continue”' },
      { to: at('flag_askr'), give: '[[Askr’s Sealed Bag of Verity#11487]] (beard + bone + sash combined in the bag)', get: 'the first flag; say “bastion of thunder” for a second bag' },
      { to: at('flag_askr'), give: '[[Esoteric Meld#11488]] (two medallions from different camps, combined)', get: 'Askr’s second flag; the shrine click after it is your Bastion of Thunder flag' },
    ],
    back: [at('storms_zone_bot')],
  },
  storms_zone_bot: {
    expect: 'Solo. With both flags the shrine sends you to the lower halls of the Bastion of Thunder. Without the Justice flag it finds “no mystic symbol”: go back to Mavuin.',
    auto: 'Ticks itself when Mimic records your Bastion of Thunder flag, which is this click.',
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

  // The say/hand-in fill (the guild lead, 2026-10-03: "all of the things to say or do for any of the pop
  // quests or flags"). Nitram Anizok's trade is poinnovation/Nitram_Anizok.lua (check_turn_in 9295, 9426,
  // 9434); the wings are solrotower/player.lua. The tokens are also in popGuide.ts's detail, which is what
  // loads their item cards.
  innovation_door_key: {
    expect: 'A raid, and a while. Finding the three parts (about 2% each) is the slow part; once they are handed in Nitram walks to the beast and the fight is a raid fight. Everyone who hails him with the kill credit gets the flag, and he leaves after 10 minutes.',
    turnIn: [
      { to: at('innovation_door_key'), give: '[[Copper Node#9295]], [[Bundle of Super Conductive Wires#9426]] and [[Intact Power Cell#9434]], all three in one trade', get: 'Nitram walks to the beast and puts the power unit in; kill it, then hail him for the flag' },
    ],
    back: [at('innovation_door_key', 2)],
  },
  flag_solro_minis: {
    expect: 'A raid, a wing at a time, in any order. Each wing is a boss fight and then a click on its flaming cauldron, which stays 30 minutes. Everyone clicks their own.',
  },

  // Essences of Power (§95): ponightmare/Aid_Eino.lua, poknowledge/Councilwoman_Kerasha.lua.
  essences_escort: {
    expect: 'A group or two. The waves come at points along his walk, with a rest between each. He waits 30 minutes for the strand at the portal, then leaves, and only one person gets the Fist per run, so plan a run each.',
    back: [at('essences_power')],
    auto: 'Ticks itself when your last inventory upload holds the Tiny Gold Fist.',
  },
  essences_power: {
    expect: 'Solo once you hold all four essences. Getting them is four raid kills at 40% each, so the guild decides who they go to.',
    turnIn: [
      { to: at('essences_power'), give: '[[Power of the Planes#16266]] (the four essences combined in the bowl)', get: '[[Jade Hoop of Speed#32106]]' },
      { to: at('essences_power'), give: 'the reward you hold', get: 'the next one: Coin Purse, Cord, Mace, Ring, then the Hoop again' },
    ],
    auto: 'Ticks itself when your last inventory upload holds any of the five rewards.',
  },

  // The Binden Concerrentia: potranquility/Jimlok_Keylifter.lua, poknowledge/Tabben_Bromal.lua, potranquility/Elder_Clinka.lua.
  binden_small: {
    expect: 'Solo once you hold the parts, and the parts are four zones of trash farming: a rat, then Disease, Nightmare and Innovation mobs at 8 to 10% each. Nothing is lore or no drop, so a group can pool them.',
    turnIn: [
      { to: at('binden_small'), give: '[[Tiny Bottle and Note#28277]]', get: '[[Strange Jeweler’s Schematic#28278]]' },
      { to: at('binden_small', 1), give: '[[Strange Jeweler’s Schematic#28278]]', get: '[[Small parts kit#17277]] and the schematic back' },
      { to: at('binden_small', 1), give: '[[Sealed Parts Box#28283]] (the four parts combined in the kit)', get: '[[Small Clockwork Talisman#28284]] and a [[Small Parts Container#17278]]' },
    ],
    back: [at('binden_powered')],
    auto: 'Ticks itself when your last inventory upload holds the Small Clockwork Talisman or anything made from it.',
  },
  binden_powered: {
    expect: 'Solo once you hold the parts. They come from Valor, Tactics, the Tower of Solusek Ro and Torment, so each of those zones’ own entry flags come first. Tabben asks for nothing else and does not take the container.',
    turnIn: [
      { to: at('binden_powered'), give: '[[Locked Parts Box#28289]] (four parts and the Small Clockwork Talisman, combined in the container)', get: '[[Powered Clockwork Talisman#28290]] and [[The Talisman Schematic#28291]]' },
    ],
    back: [at('binden_final')],
    auto: 'Ticks itself when your last inventory upload holds the Powered Clockwork Talisman or anything made from it.',
  },
  binden_final: {
    expect: 'Solo once you hold the four fragments. They are trash drops in the four elemental planes at 8 to 9%, so a group can farm them in any order; you need each plane’s entry flags, not a boss kill.',
    turnIn: [
      { to: at('binden_final'), give: '[[The Talisman Schematic#28291]]', get: '[[Small Lined Case#17279]]' },
      { to: at('binden_final'), give: '[[Sealed Lined Case#28297]] (the four fragments and the Powered Talisman, combined in the case)', get: '[[The Binden Concerrentia#28296]]' },
    ],
    auto: 'Ticks itself when your last inventory upload holds The Binden Concerrentia.',
  },
};

// The short version of every step whose detail runs past 300 characters, plus the Justice trial step
// (the guild lead, 2026-10-04). Kept in one block, not threaded through the entries above, so a reviewer
// reads the wording in one pass. Merged into STEP_MORE below; test/pop-guide-more.test.js holds each to
// 120 characters and to a step that is still long enough to need one.
const BRIEFS: Record<string, string> = {
  start_flag_fixers: 'Sit down before you talk to the Seer. Go back and forth between her and Maelin until neither has anything new.',
  flag_trial_justice: 'Win any ONE of the six trials. Its boss drops 6 of its Mark, one each. Retry 1 min after a loss, 10 after a win.',
  justice_mavuin_hail: 'Hail Mavuin: this is your Justice flag. Needs the Tribunal’s “mavuin sent me” first.',
  justice_seventh_hammer: 'Optional. Needs all six Marks in your bags at once. The Tribunal checks them but does not take them.',
  innovation_door_key: 'Optional. Hand Nitram three clockwork parts, kill the beast he builds, then hail him for the factory door flag.',
  flag_behemoth: 'Kill the Behemoth, then hail Giwin with the kill credit. Promise him a machine test first or it is a checklist flag.',
  flag_hedge: 'Up to 24 players, 4 groups per dream. Hail Thelin at the end: that hail is the flag.',
  essences_escort: 'Optional. Night in game only. Keep Aid Eino alive through four waves and the Dreamkeeper, then hand him the strand.',
  nightmare_poxbourne: 'Hail Elder Poxbourne once Terris Thule is dead and her projection is hailed. It is half of the Torment portal check.',
  cod_fuirstel_before: 'Hail Elder Fuirstel before Bertoxxulous dies. Needs Grummus done, and Adler asked about the ward before Grummus fell.',
  flag_carprin: 'Kill the five Carprin nameds, then hail Tarkil Adan while you hold the kill credit. It is your way into the lower Crypt.',
  flag_askr: 'Everyone does their own: a head for a bag, three parts for the flag, two medallions for the second. Stay in the zone.',
  flag_keeper: 'A small raid kills the Keeper, then hails Tylis. Do Fahlia’s step first or it is a checklist flag. Resets in 2 hours.',
  bot_symbol: 'Build one Symbol per raid: four spheres in an Unadorned Symbol. The holder clicks the portal; all follow in 5 minutes.',
  hoh_trial_villager: 'Win the trial, then hail Alekson while you are in the winning group for your credit. A loss can retry in 10 minutes.',
  maelin_cipher: 'Hail Maelin once you hold both halves, Saryrn’s and Mithaniel Marr’s. He joins them into your cipher flag.',
  maelin_lore: 'Needs Karana’s path flag and Mithaniel’s notes. Maelin reads both and gives you a flag.',
  zeks_maelin: 'Needs the cipher and both Zek projections hailed. Maelin reads the notes and moves you to Zeks 6.',
  zebuxoruk_maelin: 'Needs his first reading and Rallos Zek’s projection hailed. This second reading opens Air, Earth and Water.',
  pofire_miak: 'Ask Miak about the portal’s destination before you kill Solusek Ro. That gives your first Fire flag.',
  flag_solro_minis: 'Five wings, any order. Kill each boss, then click its flaming cauldron within 30 minutes. Everyone clicks their own.',
  essences_power: 'Optional. Keep the Fist, combine the four gods’ essences in the bowl, then trade the result for a reward.',
  binden_small: 'Optional. Trade a rat’s bottle for a schematic, fill Tabben’s kit with four planar parts, get your first talisman.',
  binden_powered: 'Optional. Fill Tabben’s container with four more parts and your first talisman, and trade the box for the Powered one.',
  binden_final: 'Optional. Trade the schematic for a case, fill it with four elemental fragments and the talisman, and trade it back.',
  time_muon: 'Needs your Zebuxoruk flag and the Quintessence in your bags. Muon takes you up; clicking the time machine is the flag.',
};
for (const [key, brief] of Object.entries(BRIEFS)) STEP_MORE[key] = { ...STEP_MORE[key], brief };

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
