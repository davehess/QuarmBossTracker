// /pop/guide as collapsible sections (the guild lead, 2026-10-14: "Collapse all of the pop/guide stuff down into
// subsections, Tiers and plane of knowledge, move the POK stuff except for the seer at the top. Give a sidebar
// nav for the different sections to drop down. It should be a simple set of clicks.").
//
// Pure data and pure functions, so the grouping can be tested without a browser. GUIDE_ITEMS (popGuide.ts)
// stays the one list of steps; this file only says WHERE each one is shown:
//   - one section per tier, the /pop chart's own tiers (TIER_LABELS): Tier One … Tier Four, Plane of Time;
//   - one for the Plane of Knowledge, which holds the flag fixers, the Traveler's Manual, the Knowledge quests
//     and the spell turn-in;
//   - inside a tier, one sub-section per plane (POP_ZONES, a lower crypt or temple folded into its parent),
//     then "Grand Librarian Maelin" and "Any plane in this tier" for the steps that belong to no single plane.
// Every step lands in exactly one sub-section. A step with no entry in STEP_HOME is not lost: it falls into its
// section's catch-all (test/pop-guide-sections.test.js fails on it, so a new step gets a home on purpose).
//
// The ids are the page's URL hashes (#tier-2, #tier-2-valor, #pok, #pok-spells). They are links people share
// and bookmark: change one and every old link stops opening anything.

import { GUIDE_ITEMS, GUIDE_SECTIONS, type SectionKey } from './popGuide';
import { POP_ZONES, TIER_COLORS, TIER_LABELS } from './popFlags';

export type GuideGroup = { id: string; title: string; blurb?: string; keys: string[] };
export type GuideTreeSection = {
  id: string;
  title: string;
  sub: string;          // a line under the title: the planes it holds
  blurb: string;
  color: string;
  groups: GuideGroup[];
  split: boolean;       // more than one group: only then are the sub-sections drawn (a tier of one plane lists its steps)
  keys: string[];       // every step in it, in the guide's order
};

const TIER_OF: Partial<Record<SectionKey, number>> = { t1: 1, t2: 2, t3: 3, t4: 4, time: 5 };
const SECTION_BLURB = (k: SectionKey) => GUIDE_SECTIONS.find(s => s.key === k)?.blurb ?? '';

// Where each step is shown: a POP_ZONES key (a plane), 'maelin' or 'general' inside a tier, or 'flags' /
// 'quests' / 'spells' inside the Plane of Knowledge. A step that sits in Tranquility or Knowledge but is part of
// one plane's run (Adler Fuirstel's ward, Maelin between the Zeks) stays with that plane, so a tier still reads
// in the order you do it.
export const STEP_HOME: Record<string, string> = {
  // Plane of Knowledge
  start_flag_fixers: 'flags', start_traveler_manual: 'flags',
  pok_taxidermy: 'quests', pok_merchant_crate: 'quests', pok_instruments: 'quests', pok_reflecting_pools: 'quests',
  pok_sage_research: 'quests', pok_books: 'quests', pok_gems: 'quests', pok_idols: 'quests',
  spells_submit_book: 'spells', spells_parchments: 'spells', spells_turn_in: 'spells',
  // Tier One
  t1_trash: 'general',
  disease_ward: 'disease', flag_grummus: 'disease',
  justice_mavuin_info: 'justice', flag_trial_justice: 'justice', justice_tribunal: 'justice',
  justice_mavuin_hail: 'justice', justice_seventh_hammer: 'justice',
  innovation_door_key: 'innovation', innovation_test: 'innovation', flag_behemoth: 'innovation',
  nightmare_adroha: 'nightmare', flag_hedge: 'nightmare', essences_escort: 'nightmare',
  binden_small: 'general',
  // Tier Two
  flag_tthule: 'ponb', nightmare_poxbourne: 'ponb',
  cod_fuirstel_before: 'cod', flag_carprin: 'cod', flag_bert: 'cod', cod_fuirstel_after: 'cod',
  flag_askr: 'storms', storms_zone_bot: 'storms',
  valor_globe: 'valor', flag_aerindar: 'valor', valor_zone_hoh: 'valor',
  torment_fahlia: 'torment', torment_sphere: 'torment', flag_keeper: 'torment', flag_saryrn: 'torment', torment_return: 'torment',
  // Tier Three
  bot_symbol: 'bot', bot_tower: 'bot', flag_agnarr: 'bot',
  hoh_trial_dragon: 'hoh', hoh_trial_villagers: 'hoh', hoh_trial_villager: 'hoh', flag_marr: 'hoh',
  tactics_maelin_before: 'tactics', flag_vallon: 'tactics', flag_tallon: 'tactics', zeks_maelin: 'tactics',
  flag_rallos: 'tactics', tactics_maelin_after: 'tactics',
  maelin_cipher: 'maelin', maelin_lore: 'maelin', zebuxoruk_maelin: 'maelin',
  pofire_miak: 'solro', flag_solro_minis: 'solro', flag_solro: 'solro',
  binden_powered: 'general',
  // Tier Four
  flag_fennin: 'fire',
  air_key: 'air', flag_avatars_air: 'air', flag_xegony: 'air',
  flag_coirnav: 'water',
  earth_key: 'earth', flag_arbitor: 'earth', flag_rathe: 'earth',
  essences_power: 'general', binden_final: 'general',
  // The Plane of Time (one group, so the page lists them without a sub-section)
  time_vial: 'time', time_quintessence: 'time', time_muon: 'time', time_timelockout: 'time', flag_quarm: 'time',
};

// A plane's heading: the chart's own name, or the name the guide's steps use where the chart's is a place name.
const PLANE_TITLE: Record<string, string> = {
  cod: 'Crypt of Decay (and the lower crypt)',
  hoh: 'Halls of Honor (and the Temple of Marr)',
  earth: 'Plane of Earth (and Ragrax)',
  air: 'Plane of Air (Eryslai)',
  water: 'Plane of Water (Reef of Coirnav)',
  fire: 'Plane of Fire (Doomfire)',
};

type GroupDef = { home: string; title: string; blurb?: string; fallback?: boolean };

const planeDefs = (tier: number): GroupDef[] => [
  ...POP_ZONES.filter(z => z.tier === tier && !z.subZoneOf).map(z => ({ home: z.key, title: PLANE_TITLE[z.key] ?? z.name })),
  ...(tier === 3 ? [{ home: 'maelin', title: 'Grand Librarian Maelin (Plane of Knowledge)', blurb: 'The hand-ins between the planes. Each one waits for the plane before it.' }] : []),
  { home: 'general', title: 'Any plane in this tier', fallback: true },
];

const POK_DEFS: GroupDef[] = [
  { home: 'flags', title: 'Flag fixers and the Traveler’s Manual' },
  { home: 'quests', title: 'Knowledge quests', blurb: SECTION_BLURB('pok'), fallback: true },
  { home: 'spells', title: 'Your PoP spells', blurb: SECTION_BLURB('spells') },
];

function build(
  id: string, prefix: string, head: { title: string; sub: string; blurb: string; color: string },
  sections: SectionKey[], defs: GroupDef[],
): GuideTreeSection {
  const catchAll = (defs.find(d => d.fallback) ?? defs[defs.length - 1]).home;
  const known = new Set(defs.map(d => d.home));
  const bucket = new Map<string, string[]>();
  for (const item of GUIDE_ITEMS) {
    if (!sections.includes(item.section)) continue;
    const want = STEP_HOME[item.key];
    const home = want && known.has(want) ? want : catchAll;
    bucket.set(home, [...(bucket.get(home) ?? []), item.key]);
  }
  const groups: GuideGroup[] = defs.filter(d => bucket.has(d.home))
    .map(d => ({ id: `${prefix}-${d.home}`, title: d.title, ...(d.blurb ? { blurb: d.blurb } : {}), keys: bucket.get(d.home)! }));
  return { id, ...head, groups, split: groups.length > 1, keys: groups.flatMap(g => g.keys) };
}

const planesOf = (tier: number) => POP_ZONES.filter(z => z.tier === tier && !z.subZoneOf).map(z => z.short).join(' · ');
const TIER_SECTIONS: SectionKey[] = ['t1', 't2', 't3', 't4', 'time'];

// The page's order: the tiers, then the Plane of Knowledge. The tiers are the route, so they read top to bottom as
// you play it; Knowledge is the shelf beside it (repair a flag, quests for alts, the spell turn-in), and the Seer
// paste at the very top already covers the urgent part of it.
export const GUIDE_TREE: GuideTreeSection[] = [
  ...TIER_SECTIONS.map((sk, n) => build(
    `tier-${n + 1}`, `tier-${n + 1}`,
    { title: TIER_LABELS[n + 1].name, sub: planesOf(n + 1), blurb: SECTION_BLURB(sk), color: TIER_COLORS[n + 1] },
    [sk], planeDefs(n + 1),
  )),
  build('pok', 'pok', {
    title: 'Plane of Knowledge', sub: 'Flag fixers · quests · spells',
    blurb: 'Everything that happens in the Plane of Knowledge: fixing your flags, the quests that are open now, and your spells.', color: '#6e7681',
  }, ['pok', 'spells'], POK_DEFS),
];

export const SECTION_IDS = GUIDE_TREE.map(s => s.id);
export const GROUP_IDS = GUIDE_TREE.flatMap(s => (s.split ? s.groups.map(g => g.id) : []));

// What the sidebar lists: the same ids as the sections on the page, because it is built from the same tree.
export type NavEntry = { id: string; title: string; color: string; subs: { id: string; title: string }[] };
export const GUIDE_NAV: NavEntry[] = GUIDE_TREE.map(s => ({
  id: s.id, title: s.title, color: s.color,
  subs: s.split ? s.groups.map(g => ({ id: g.id, title: g.title })) : [],
}));

// The ids a step sits under, outermost first: the section, then its sub-section when the section has them.
const HOME_OF = new Map<string, string[]>();
for (const s of GUIDE_TREE) for (const g of s.groups) for (const k of g.keys) HOME_OF.set(k, s.split ? [s.id, g.id] : [s.id]);
export const idsForStep = (key: string): string[] => HOME_OF.get(key) ?? [];

// Open every <details> around an element, and the element itself when it is one. Shaped for a DOM element but
// written against the three fields it uses, so a test can walk a fake tree. Returns how many it opened.
export type DetailsLike = { tagName?: string; open?: boolean; parentElement?: DetailsLike | null };
export function openParents(el: DetailsLike | null | undefined): number {
  let opened = 0;
  for (let e = el; e; e = e.parentElement ?? null) {
    if (e.tagName === 'DETAILS' && !e.open) { e.open = true; opened++; }
  }
  return opened;
}
