// PoP guide checklist — what to do, in what order, and who you need for it.
//
// The guild lead, 2026-09-28: "we need a page made up for PoP guidance, where to start, what quests are
// must haves, what can be done with a group or a raid or solo. Make this a checkbox type of thing."
//
// Pure data. `key` is the storage key in pop_guide_ticks — NEVER rename one; add a new key instead.
// `flag` names a POP_FLAGS key: when the agent has recorded that flag for the character (pop_flags),
// the box is ticked for them. Who-you-need comes from the NPC catalog's HP (150k+ is a raid; the
// group items are trash, medallion farming and the capped hedge maze) and the 2026-09-28 patch notes.

import { POP_FLAGS } from './popFlags';

export type Who = 'solo' | 'group' | 'raid';

export type GuideItem = {
  key: string;
  section: SectionKey;
  title: string;
  who: Who;
  must?: boolean;
  detail?: string;
  link?: { href: string; label: string };
  flag?: string;
  check?: boolean;   // not yet confirmed on Quarm — say so on the row
};

export type SectionKey = 'start' | 'pok' | 'spells' | 't1' | 't2' | 't3' | 't4' | 'time';

export const GUIDE_SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: 'start', title: 'Start here', blurb: 'Do these first. Most take a minute.' },
  { key: 'pok', title: 'Plane of Knowledge quests', blurb: 'Open now, ordered easy to hard. Small rewards; good for alts.' },
  { key: 'spells', title: 'Your PoP spells', blurb: 'Casters: this is where most of your power in PoP comes from.' },
  { key: 't1', title: 'Tier one: the four open planes', blurb: 'Every plane here opens at 46. Each has one flag that unlocks the next tier.' },
  { key: 't2', title: 'Tier two', blurb: 'Each needs its tier-one flag.' },
  { key: 't3', title: 'Tier three', blurb: 'The gods’ champions. All raids.' },
  { key: 't4', title: 'The elemental planes', blurb: 'Need Marr, Agnarr, Saryrn, Rallos Zek and Bertoxxulous. Fire also needs Solusek Ro.' },
  { key: 'time', title: 'The Plane of Time', blurb: 'Needs all four elemental gods.' },
];

const pqdiNpc = (id: number) => ({ href: `https://www.pqdi.cc/npc/${id}`, label: 'PQDI' });
const popZone = (key: string) => ({ href: `/pop?zone=${key}`, label: 'who has it' });

export const GUIDE_ITEMS: GuideItem[] = [
  // ── Start here ────────────────────────────────────────────────────────────
  { key: 'start_level46', section: 'start', who: 'solo', must: true, title: 'Reach level 46',
    detail: 'Every PoP zone needs 46. The Plane of Knowledge does not; the Plane of Time asks for more.' },
  { key: 'start_pok_bind', section: 'start', who: 'solo', title: 'Get to the Plane of Knowledge and bind there',
    detail: 'Its books reach most of Norrath, so it becomes your home for the expansion.' },
  { key: 'start_popflags', section: 'start', who: 'solo', must: true, title: 'Type #popflags in game',
    detail: 'New server command: lists your PoP flags by tier. Add overview, 1 to 5, time or all.' },
  { key: 'start_mimic', section: 'start', who: 'solo', title: 'Run Mimic while you play',
    detail: 'Every flag you earn is recorded for you and ticks the matching box on this page.' },
  { key: 'start_guild_books', section: 'start', who: 'solo', must: true, title: 'Find the guild-instance books in the Plane of Tranquility',
    detail: 'PoP raids now run in guild instances. You must be in the guild or the raid to use the books.' },
  { key: 'start_hails', section: 'start', who: 'solo', must: true, title: 'After every flag kill, hail the NPC who grants it',
    detail: 'No hail, no flag. Justice trial: Mavuin. Manaetic Behemoth: Giwin Mirakon. Terris Thule: Adroha Jezith and Elder Poxbourne.' },
  { key: 'start_traveler_manual', section: 'start', who: 'solo', must: true, title: 'Planar Traveler’s Manual (Willamina’s Needles)',
    detail: 'All inside PoK, no fighting. Needed for the Beginner Manual quests later. Ask Willamina about "quests".',
    link: pqdiNpc(202055) },

  // ── PoK quests (open now) ────────────────────────────────────────────────
  { key: 'pok_taxidermy', section: 'pok', who: 'solo', title: 'Collection of Taxidermy → Fine Antique Ring',
    detail: 'Rockhopper eye, froglok tongue, cockatrice beak, cougarskin. Say "collector’s box" to Curator Merri; hand to Holly Longtail.',
    link: pqdiNpc(202021) },
  { key: 'pok_merchant_crate', section: 'pok', who: 'solo', title: 'Merchant’s Crate of Supplies → 60 pp',
    detail: 'Six vendor items, one combine, hand to Trep Thilcan.', link: pqdiNpc(202057) },
  { key: 'pok_instruments', section: 'pok', who: 'solo', title: 'Collection of Instruments → Fine Antique Amice',
    detail: 'Minotaur horn, tambourine, stretched skin drum, orcish lute. Hand to Lohie Cantare.', link: pqdiNpc(202016) },
  { key: 'pok_reflecting_pools', section: 'pok', who: 'solo', title: 'The Reflecting Pools of Tanaan → diamond-inlaid mask + exp',
    detail: 'Sarnak blood to Tarerd Gahar, then a trip to Droga and back to Tratlan Jowyr.', link: pqdiNpc(202299) },
  { key: 'pok_sage_research', section: 'pok', who: 'group', title: 'Sage research → a clicky and exp per turn-in',
    detail: 'Combine a Rune with its matching Words from classic research drops; turn the Words in to Sage Balic.',
    link: pqdiNpc(202051) },
  { key: 'pok_books', section: 'pok', who: 'group', title: 'Collection of Books → Fine Antique Locket',
    detail: 'Needs one rare Luclin world drop (Book of Inspiration). Hand to Alexis Dubbani.', link: pqdiNpc(202013) },
  { key: 'pok_gems', section: 'pok', who: 'group', title: 'Collection of Gems → Fine Antique Veil',
    detail: 'Needs one rare Luclin world drop (Hope Diamond). Hand to Drelynn Beaufax.', link: pqdiNpc(202018) },
  { key: 'pok_idols', section: 'pok', who: 'group', title: 'Collection of Idols → Fine Antique Velvet Rose',
    detail: 'Needs one rare Luclin world drop (Petrified Totem). Hand to Curator Merri.', link: pqdiNpc(202017) },

  // ── Spells ────────────────────────────────────────────────────────────────
  { key: 'spells_submit_book', section: 'spells', who: 'solo', must: true, title: 'Submit your spellbook on the PoP page',
    detail: 'Then the PoP page shows exactly which spells you still need, per parchment.',
    link: { href: '/pop?view=mine', label: 'my spells' } },
  { key: 'spells_parchments', section: 'spells', who: 'group', must: true, title: 'Collect Ethereal and Spectral Parchments and Glyphed Rune Words',
    detail: 'They drop in the planes and now stack to 20.' },
  { key: 'spells_turn_in', section: 'spells', who: 'solo', must: true, title: 'Turn them in to your class trainer in PoK',
    detail: 'One at a time; each gives a random spell from that parchment’s list for your class.' },

  // ── Tier one ──────────────────────────────────────────────────────────────
  { key: 't1_trash', section: 't1', who: 'group', title: 'Level and farm in the tier-one planes',
    detail: 'Justice, Innovation, Disease and Nightmare trash is group content from 46.' },
  { key: 'flag_trial_justice', section: 't1', who: 'raid', must: true, flag: 'trial_justice', title: 'Win a Justice trial, then hail Mavuin',
    detail: 'Any one of the six. Opens the Plane of Valor. A win can be rerun in 10 minutes.', link: popZone('justice') },
  { key: 'flag_grummus', section: 't1', who: 'group', must: true, flag: 'grummus_dead', title: 'Kill Grummus (Plane of Disease)',
    detail: 'Opens the Crypt of Decay.', link: popZone('disease') },
  { key: 'flag_behemoth', section: 't1', who: 'raid', must: true, flag: 'behemoth_dead', title: 'Kill the Manaetic Behemoth, then hail Giwin Mirakon',
    detail: 'Wakes when the 10th clockwork device dies. Opens the Plane of Tactics.', link: popZone('innovation') },
  { key: 'flag_hedge', section: 't1', who: 'group', must: true, flag: 'hedge_event', title: 'Thelin’s hedge maze (Plane of Nightmare)',
    detail: 'Up to 24 players, 4 groups per dream. Opens the Lair of Terris Thule.', link: popZone('nightmare') },

  // ── Tier two ──────────────────────────────────────────────────────────────
  { key: 'flag_askr', section: 't2', who: 'group', must: true, flag: 'askr_quest', title: 'Giant medallions for Askr the Lost (Plane of Storms)',
    detail: 'Compound trash drops them, the six minibosses drop 1 to 3, the lords 5 to 8. Opens the Bastion of Thunder.',
    link: popZone('storms') },
  { key: 'flag_aerindar', section: 't2', who: 'raid', must: true, flag: 'aerindar_dead', title: 'Kill Aerin`Dar (Plane of Valor)',
    detail: 'Opens the Halls of Honor.', link: popZone('valor') },
  { key: 'flag_carprin', section: 't2', who: 'group', flag: 'carprin_cycle', check: true, title: 'The Carprin cycle (Crypt of Decay)',
    detail: 'Five nameds; opens the lower Crypt and Bertoxxulous.', link: popZone('cod') },
  { key: 'flag_tthule', section: 't2', who: 'raid', must: true, flag: 'tthule_dead', title: 'Kill Terris Thule, then hail Adroha Jezith and Elder Poxbourne',
    detail: 'Opens the Plane of Torment.', link: popZone('ponb') },
  { key: 'flag_bert', section: 't2', who: 'raid', must: true, flag: 'bert_dead', title: 'Kill Bertoxxulous', link: popZone('codb') },
  { key: 'flag_keeper', section: 't2', who: 'raid', flag: 'keeper_dead', title: 'Kill the Keeper of Sorrows (Plane of Torment)',
    detail: 'A small raid; resets every 2 hours. Whoever asks must be flagged this far.', link: popZone('torment') },
  { key: 'flag_saryrn', section: 't2', who: 'raid', must: true, flag: 'saryrn_dead', title: 'Kill Saryrn', link: popZone('torment') },

  // ── Tier three ────────────────────────────────────────────────────────────
  { key: 'flag_hoh_trials', section: 't3', who: 'raid', must: true, flag: 'hoh_trials', check: true, title: 'The three Halls of Honor trials',
    detail: 'A failed trial can be retried after 10 minutes. Opens the Temple of Marr.', link: popZone('hoh') },
  { key: 'flag_marr', section: 't3', who: 'raid', must: true, flag: 'marr_dead', title: 'Kill Mithaniel Marr', link: popZone('hoh') },
  { key: 'flag_agnarr', section: 't3', who: 'raid', must: true, flag: 'agnarr_dead', title: 'Kill Agnarr the Storm Lord', link: popZone('bot') },
  { key: 'flag_tallon', section: 't3', who: 'raid', flag: 'tallon_dead', title: 'Kill Tallon Zek', link: popZone('tactics') },
  { key: 'flag_vallon', section: 't3', who: 'raid', flag: 'vallon_dead', title: 'Kill Vallon Zek', link: popZone('tactics') },
  { key: 'flag_rallos', section: 't3', who: 'raid', must: true, flag: 'rallos_dead', title: 'Kill Rallos Zek', link: popZone('tactics') },
  { key: 'flag_solro_minis', section: 't3', who: 'raid', flag: 'solro_minis', title: 'The five Tower of Solusek Ro minis',
    detail: 'Jiva, Xuzl, Arlyxir, Rizlona and the Protector of Dresolik. Opens Solusek Ro’s chamber.', link: popZone('solro') },
  { key: 'flag_solro', section: 't3', who: 'raid', must: true, flag: 'solro_dead', title: 'Kill Solusek Ro',
    detail: 'Needed for the Plane of Fire.', link: popZone('solro') },

  // ── Elemental ─────────────────────────────────────────────────────────────
  { key: 'flag_arbitor', section: 't4', who: 'raid', flag: 'arbitor_dead', check: true, title: 'The four earth rings and the Arbitor of Earth',
    detail: 'Opens Ragrax.', link: popZone('earth') },
  { key: 'flag_rathe', section: 't4', who: 'raid', must: true, flag: 'rathe_dead', title: 'Kill the Rathe Council (the Avatar of Earth)', link: popZone('poeb') },
  { key: 'flag_avatars_air', section: 't4', who: 'raid', flag: 'avatars_air', check: true, title: 'Kill the four air avatars',
    detail: 'Opens Xegony’s island.', link: popZone('air') },
  { key: 'flag_xegony', section: 't4', who: 'raid', must: true, flag: 'xegony_dead', title: 'Kill Xegony', link: popZone('air') },
  { key: 'flag_coirnav', section: 't4', who: 'raid', must: true, flag: 'coirnav_dead', title: 'Kill Coirnav', link: popZone('water') },
  { key: 'flag_fennin', section: 't4', who: 'raid', must: true, flag: 'fennin_dead', title: 'Kill Fennin Ro', link: popZone('fire') },

  // ── Time ──────────────────────────────────────────────────────────────────
  { key: 'time_timelockout', section: 'time', who: 'solo', title: 'Type #timelockout',
    detail: 'Shows your guild’s timeline, when it retires, and which encounters are open in each phase.' },
  { key: 'flag_quarm', section: 'time', who: 'raid', must: true, flag: 'quarm_dead', title: 'Kill Quarm', link: popZone('time') },
];

export const GUIDE_KEYS = new Set(GUIDE_ITEMS.map(i => i.key));

export const WHO_LABEL: Record<Who, string> = { solo: 'Solo', group: 'Group', raid: 'Raid' };

/** Keys ticked for a character: their manual ticks plus every item whose flag the agent recorded. */
export function tickedKeys(manual: Iterable<string>, flags: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of manual) if (GUIDE_KEYS.has(k)) out.add(k);
  const f = new Set(flags);
  for (const i of GUIDE_ITEMS) if (i.flag && f.has(i.flag)) out.add(i.key);
  return out;
}

/** Items whose box is locked on because a recorded flag ticked it. */
export function recordedKeys(flags: Iterable<string>): Set<string> {
  const f = new Set(flags);
  return new Set(GUIDE_ITEMS.filter(i => i.flag && f.has(i.flag)).map(i => i.key));
}

/** Every flag this guide names must exist in the PoP catalog. */
export function unknownFlags(): string[] {
  return GUIDE_ITEMS.filter(i => i.flag && !POP_FLAGS[i.flag]).map(i => i.key);
}
