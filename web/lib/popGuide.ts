// PoP guide checklist — what to do, in what order, and who you need for it.
//
// The guild lead, 2026-09-28: "we need a page made up for PoP guidance, where to start, what quests are
// must haves, what can be done with a group or a raid or solo. Make this a checkbox type of thing."
// Then: "add in mousover for any items mentioned, Put Locations for anyone that we need to reach with
// a copy of /map <Y> <x>", "anything you have to say should also have a copy button next to it with
// /say in front of it", and fold in the EQProgression planar flagging guide.
//
// Pure data. `key` is the storage key in pop_guide_ticks — never reuse one for a different step.
// `flag` names a POP_FLAGS key: when the agent has recorded that flag for the character (pop_flags),
// the box ticks itself. Who-you-need comes from the NPC catalog's HP (150k+ is a raid) and the
// 2026-09-28 patch notes.
//
// Sources: the step order is the EQProgression flagging checklist
// (eqprogression.com/planes-of-power-planar-progression-flagging); every /say phrase was checked
// against the NPC's quest script in eqemu_quest_scripts; every /map is the NPC's placed spawn
// (eqemu_spawn2), written Y then X — the order /loc prints and Zeal's /map takes (checked against
// PQDI, which labels its coordinates "(Y, X, Z)"). Items are written [[Name#itemId]] and get the
// site's item card on hover.
//
// The guild lead, 2026-10-03: the Mimic PoP overlay should show "all of the things to say or do for
// any of the pop quests or flags", so the steps that were only "hail X" or "kill X" were filled from the
// quest scripts. Every phrase added then carries `src`, the eqemu_quest_scripts path it was read from
// (test/pop-guide-steps.test.js holds each script's own keyword list). A step whose script is a click
// and no words says so in its detail and has no `says`. ⚠ The scripts are upstream's
// (SecretsOTheP/quests): Quarm may differ, so where a step says "the script", that is what it rests on.

import { POP_FLAGS } from './popFlags';

export type Who = 'solo' | 'group' | 'raid';
// sit: the NPC only answers while you sit (the Seer's script checks IsSitting(); the guild lead,
// 2026-09-28: "For Seer Mal Nae'Shi i had to sit down first"). The page puts a /sit chip first.
// src: the quest script the phrase was read from (an eqemu_quest_scripts path, e.g.
// potranquility/Miak_the_Searedsoul.lua).
export type Say = { to: string; text: string; sit?: boolean; src?: string };
export type Loc = { npc: string; zone: ZoneKey; y: number; x: number; note?: string };

export type GuideItem = {
  key: string;
  section: SectionKey;
  title: string;
  who: Who;
  must?: boolean;
  detail?: string;
  link?: { href: string; label: string };
  flag?: string;
  check?: boolean;     // not yet confirmed on Quarm — say so on the row
  says?: Say[];
  where?: Loc[];
  chain?: Chain;
};

// A quest that is a chain of NPCs (the guild lead, 2026-09-28: "Follow the chain and show the
// first item that seems to be required … and show the full quest chain with minimize sections
// there. Highlight stages where you will have input/output", then "That quest chain really
// looks like it should start from … Agrakath Theric"). `first` is where you actually start:
// the NPC, what to say, and the item to `fetch` for them. `handins` is the order you walk it,
// each one an item in and an item out; `talk` is the optional story in the order the quest
// giver tells it. give/get are [[Item#id]] tokens.
export type ChainStage = { at: Loc; say?: string[]; give?: string; get?: string; note?: string };
export type Chain = {
  first: { text: string; at: Loc; say?: string[]; fetch?: Loc };
  talk: ChainStage[];
  handins: ChainStage[];
};

export type SectionKey = 'start' | 'pok' | 'spells' | 't1' | 't2' | 't3' | 't4' | 'time';

export const ZONE_NAMES = {
  poknowledge: 'Plane of Knowledge',
  potranquility: 'Plane of Tranquility',
  pojustice: 'Plane of Justice',
  poinnovation: 'Plane of Innovation',
  postorms: 'Plane of Storms',
  bothunder: 'Bastion of Thunder',
  hohonora: 'Halls of Honor',
  ponightmare: 'Plane of Nightmare',
  droga: 'Droga',
  codecay: 'Crypt of Decay',
  povalor: 'Plane of Valor',
  solrotower: 'Tower of Solusek Ro',
} as const;
export type ZoneKey = keyof typeof ZONE_NAMES;

export const GUIDE_SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: 'start', title: 'Start here', blurb: 'Do these first. Most take a minute.' },
  { key: 'pok', title: 'Plane of Knowledge quests', blurb: 'Open now, ordered easy to hard. Small rewards; good for alts.' },
  { key: 'spells', title: 'Your PoP spells', blurb: 'Casters: this is where most of your power in PoP comes from.' },
  { key: 't1', title: 'Tier one: the four open planes', blurb: 'Every plane here opens at 46. Talk to the NPC BEFORE each boss, or the kill will not flag you.' },
  { key: 't2', title: 'Tier two', blurb: 'Each needs its tier-one flag. Zone into the next plane from the one you just finished.' },
  { key: 't3', title: 'Tier three', blurb: 'The gods’ champions. All raids.' },
  { key: 't4', title: 'The elemental planes', blurb: 'Need Marr, Agnarr, Saryrn, Rallos Zek and Bertoxxulous. Fire also needs Solusek Ro. Can’t zone in with every flag done? Go back and forth between Grand Librarian Maelin and the Seer until neither has more for you.' },
  { key: 'time', title: 'The Plane of Time', blurb: 'Needs all four elemental gods and their four essences.' },
];

const pqdiNpc = (id: number) => ({ href: `https://www.pqdi.cc/npc/${id}`, label: 'PQDI' });
const popZone = (key: string) => ({ href: `/pop?zone=${key}`, label: 'who has it' });

// Placed NPCs people walk to.
const L = {
  soulbinder: { npc: 'Soulbinder Jera', zone: 'poknowledge', y: -221, x: -53 },
  seer: { npc: 'Seer Mal Nae`Shi', zone: 'poknowledge', y: -42, x: -224, note: 'next to the Plane of Tranquility book' },
  maelin: { npc: 'Grand Librarian Maelin', zone: 'poknowledge', y: 6, x: 1016, note: 'top of the library elevator' },
  gram: { npc: 'Gram Dunnar', zone: 'poknowledge', y: -341, x: -181 },
  willamina: { npc: 'Willamina', zone: 'poknowledge', y: -427, x: 1154 },
  bolcen: { npc: 'Bolcen Tendag', zone: 'poknowledge', y: 685, x: 954 },
  // Willamina's Needles, the rest of the chain (placed spawns; the book is a ground spawn).
  mirao: { npc: 'Mirao Frostpouch', zone: 'poknowledge', y: -88, x: -215 },
  cador: { npc: 'Oracle Cador', zone: 'poknowledge', y: 696, x: 102 },
  onirelin: { npc: 'Onirelin Gali', zone: 'poknowledge', y: -650, x: 1053 },
  narik: { npc: 'Arch Mage Narik', zone: 'poknowledge', y: 428, x: 20 },
  elisha: { npc: 'Elisha Dirtyshoes', zone: 'poknowledge', y: 394, x: 945 },
  boiron: { npc: 'Boiron Ston', zone: 'poknowledge', y: 30, x: 323 },
  caden: { npc: 'Caden Zharik', zone: 'poknowledge', y: -342, x: 752 },
  agrakath: { npc: 'Agrakath Theric', zone: 'poknowledge', y: -554, x: 1219 },
  scaleBook: { npc: 'History of Evils: The Age of Scale', zone: 'poknowledge', y: -94, x: 973, note: 'on the floor, upper level of Myrist' },
  merri: { npc: 'Curator Merri', zone: 'poknowledge', y: 865, x: 668 },
  holly: { npc: 'Holly Longtail', zone: 'poknowledge', y: 878, x: 563 },
  trep: { npc: 'Trep Thilcan', zone: 'poknowledge', y: -426, x: 864 },
  lohie: { npc: 'Lohie Cantare', zone: 'poknowledge', y: 820, x: 640 },
  tarerd: { npc: 'Tarerd Gahar', zone: 'poknowledge', y: 675, x: 407 },
  vicar: { npc: 'Vicar Thiran', zone: 'poknowledge', y: 8, x: 1104 },
  jeren: { npc: 'Jeren Manri', zone: 'droga', y: 472, x: 1745 },
  tratlan: { npc: 'Tratlan Jowyr', zone: 'poknowledge', y: 867, x: 796 },
  balic: { npc: 'Sage Balic', zone: 'poknowledge', y: -24, x: 56 },
  alexis: { npc: 'Alexis Dubbani', zone: 'poknowledge', y: 908, x: 640 },
  drelynn: { npc: 'Drelynn Beaufax', zone: 'poknowledge', y: 847, x: 563 },
  adler: { npc: 'Adler Fuirstel', zone: 'potranquility', y: 1786, x: -1467, note: 'outside the Plane of Disease portal' },
  adroha: { npc: 'Adroha Jezith', zone: 'potranquility', y: -258, x: -1428, note: 'sick bay' },
  poxbourne: { npc: 'Elder Poxbourne', zone: 'potranquility', y: -251, x: -1426, note: 'sick bay' },
  fuirstel: { npc: 'Elder Fuirstel', zone: 'potranquility', y: -291, x: -1417, note: 'sick bay' },
  fahlia: { npc: 'Fahlia Shadyglade', zone: 'potranquility', y: -301, x: -1365, note: 'sick bay' },
  tylis: { npc: 'Tylis Newleaf', zone: 'potranquility', y: -294, x: -1371, note: 'sick bay' },
  mavuin: { npc: 'Mavuin', zone: 'pojustice', y: -455, x: 742 },
  // The six around the trial room. The other circle (Y 1225, X 75) is inside the Seventh Hammer's
  // room, reachable only with The Mark of Justice — it was listed here by mistake until 2026-09-29.
  tribunalA: { npc: 'The Tribunal', zone: 'pojustice', y: 765, x: 469, note: 'any of the six around the trial room' },
  giwin: { npc: 'Giwin Mirakon', zone: 'poinnovation', y: -52, x: 49, note: 'inside the factory door' },
  muon: { npc: 'Chronographer Muon', zone: 'poinnovation', y: 34, x: -310 },
  askr: { npc: 'Askr the Lost', zone: 'postorms', y: -1255, x: -2576 },
  // The shrine in the heart of Mount Grenidor (postorms door 4, BOTPOSPORT500): clicking it IS the
  // "Talisman of Thunderous Foyer" (postorms/player.lua).
  stormsShrine: { npc: 'The shrine in Mount Grenidor', zone: 'postorms', y: -163, x: -362, note: 'the stone in the middle of Storms' },
  botTower: { npc: 'The tower portal', zone: 'bothunder', y: 11, x: 170, note: 'in the courtyard' },
  askrTower1: { npc: 'Askr the Lost', zone: 'bothunder', y: -1732, x: -1123, note: 'appears when Evynd Firestorm dies' },
  askrTower2: { npc: 'Askr the Lost', zone: 'bothunder', y: -1733, x: -1065, note: 'appears when Emmerik Skyfury dies' },
  karana: { npc: 'Karana', zone: 'bothunder', y: -1758, x: -477, note: 'appears when Agnarr dies' },
  trydan: { npc: 'Trydan Faye', zone: 'hohonora', y: 2040, x: -1725, note: 'northeast trial' },
  rhaliq: { npc: 'Rhaliq Trell', zone: 'hohonora', y: 1374, x: 456, note: 'northwest trial' },
  alekson: { npc: 'Alekson Garn', zone: 'hohonora', y: -1724, x: -2330, note: 'southeast trial' },
  // Essences of Power (EQProgression's quest page, checked against poknowledge/Aid_Eino,
  // Councilwoman_Kerasha and ponightmare/Aid_Eino, EinoInvisNight). The tree is where the hidden
  // night spawn stands; it answers "Quellious be my guide" within 30 of it.
  einoPok: { npc: 'Aid Eino', zone: 'poknowledge', y: -11, x: 1005, note: 'top of the library elevator' },
  einoTree: { npc: 'The big tree by the waterfall', zone: 'ponightmare', y: -510, x: 1687, note: 'upper plateau; say it right beside the tree' },
  kerasha: { npc: 'Councilwoman Kerasha', zone: 'poknowledge', y: 0, x: 1003, note: 'top of the library elevator' },
  // The say/hand-in fill (2026-10-03). y/x are eqemu_spawn2 rows for placed NPCs, eqemu_doors pos_y/pos_x
  // for the things you click, and, for an NPC the quest script spawns itself, the spot the script names
  // (Tarkil Adan: codecay/#High_Priest_Ultor_Szanvon.lua; Loreseeker Maelin: poinnovation/#Chronographer_Muon.lua).
  thelinOutside: { npc: 'Thelin Poxbourne', zone: 'ponightmare', y: 1104, x: -1519, note: 'outside the hedge maze' },
  miak: { npc: 'Miak the Searedsoul', zone: 'potranquility', y: 255, x: -2255, note: 'next to the Plane of Fire portal' },
  tarkil: { npc: 'Tarkil Adan', zone: 'codecay', y: 330, x: 309, note: 'appears where High Priest Ultor Szanvon dies' },
  nitram: { npc: 'Nitram Anizok', zone: 'poinnovation', y: 1532, x: 974, note: 'in the junkyard' },
  nitramBeast: { npc: 'Xanamech Nezmirthafen', zone: 'poinnovation', y: 1583, x: -711, note: 'waits here until Nitram wakes it' },
  factoryDoor: { npc: 'The main factory door', zone: 'poinnovation', y: 84, x: 0, note: 'click it once Nitram has given you the flag' },
  loreseeker: { npc: 'Loreseeker Maelin', zone: 'poinnovation', y: -837, x: 763, note: 'appears once Chronographer Muon sends you up' },
  timeMachine: { npc: 'The time machine', zone: 'poinnovation', y: -858, x: 886, note: 'click it with the Quintessence in your bags' },
  glassSwitchA: { npc: 'Glass-door switch', zone: 'povalor', y: 1802, x: 304, note: 'hold the globe on your cursor and click it' },
  glassSwitchB: { npc: 'Glass-door switch (the other one)', zone: 'povalor', y: 1909, x: 375, note: 'either switch works' },
  // The five Sol Ro wings, in the order of the server's sol_room digits: the boss, then the cauldron you click.
  xuzl: { npc: 'Xuzl', zone: 'solrotower', y: -716, x: 1835 },
  xuzlCauldron: { npc: 'Xuzl’s flaming cauldron', zone: 'solrotower', y: -315, x: 1836, note: 'click it after the kill' },
  arlyxir: { npc: 'Arlyxir', zone: 'solrotower', y: 1684, x: 1726 },
  arlyxirCauldron: { npc: 'Arlyxir’s flaming cauldron', zone: 'solrotower', y: 1944, x: 1571, note: 'click it after the kill' },
  dresolik: { npc: 'The Protector of Dresolik', zone: 'solrotower', y: 1584, x: 606, note: 'appears when the last of the four Guardians of Dresolik dies' },
  dresolikCauldron: { npc: 'Dresolik’s flaming cauldron', zone: 'solrotower', y: 1479, x: 216, note: 'click it after the Protector dies' },
  rizlona: { npc: 'Rizlona', zone: 'solrotower', y: 2384, x: -1103, note: 'a second Rizlona stands up where she falls; kill that one too' },
  rizlonaCauldron: { npc: 'Rizlona’s flaming cauldron', zone: 'solrotower', y: 2664, x: -944, note: 'click it after the second one dies' },
  jiva: { npc: 'Jiva', zone: 'solrotower', y: -257, x: -2252 },
  jivaCauldron: { npc: 'Jiva’s flaming cauldron', zone: 'solrotower', y: 59, x: -2094, note: 'click it after the kill' },
} satisfies Record<string, Loc>;

// Scripts quoted more than once below.
const MAZE = 'ponightmare/encounters/Maze.lua';
const MAELIN = 'poknowledge/Grand_Librarian_Maelin.lua';

const PROJECTION = 'Then hail A Planar Projection before anyone leaves.';

export const GUIDE_ITEMS: GuideItem[] = [
  // ── Start here ────────────────────────────────────────────────────────────
  { key: 'start_level46', section: 'start', who: 'solo', must: true, title: 'Reach level 46',
    detail: 'Every PoP zone needs 46. The Plane of Knowledge does not; the Plane of Time asks for more.' },
  { key: 'start_pok_bind', section: 'start', who: 'solo', title: 'Get to the Plane of Knowledge and bind there',
    detail: 'Its books reach most of Norrath, so it becomes your home for the expansion.',
    says: [{ to: 'Soulbinder Jera', text: 'bind my soul' }], where: [L.soulbinder] },
  { key: 'start_popflags', section: 'start', who: 'solo', must: true, title: 'Type #popflags in game',
    detail: 'New server command: lists your PoP flags by tier. Add overview, 1 to 5, time or all.' },
  { key: 'start_mimic', section: 'start', who: 'solo', title: 'Run Mimic while you play',
    detail: 'Every flag you earn is recorded for you and ticks the matching box on this page.' },
  { key: 'start_guild_books', section: 'start', who: 'solo', must: true, title: 'Find the guild-instance books in the Plane of Tranquility',
    detail: 'PoP raids now run in guild instances. You must be in the guild or the raid to use the books.' },
  { key: 'start_hails', section: 'start', who: 'solo', must: true, title: 'The two rules that break flags',
    detail: 'Talk to the right NPC before AND after each boss; after a kill, hail A Planar Projection. And the first time you earn a flag, zone into the next plane from the one you are in (Valor → Halls of Honor, Storms → Bastion of Thunder).' },
  { key: 'start_flag_fixers', section: 'start', who: 'solo', must: true, title: 'Meet the two flag fixers in PoK',
    detail: 'Seer Mal Nae`Shi shows and repairs your flags, but only while you sit: /sit, then say her line. If she answers that “no recent events spark a memory”, there is nothing new to unlock yet. Grand Librarian Maelin hands out the flags you are owed. Repeat each phrase until nothing new comes. Visit Maelin before and after the Zeks and after Saryrn.',
    says: [
      { to: 'Seer Mal Nae`Shi', text: 'guided meditation', sit: true },
      { to: 'Seer Mal Nae`Shi', text: 'unlock my memories', sit: true },
      { to: 'Grand Librarian Maelin', text: 'Hail' },
      { to: 'Grand Librarian Maelin', text: 'what lore' },
      { to: 'Grand Librarian Maelin', text: 'what information' },
    ],
    where: [L.seer, L.maelin] },
  { key: 'start_charm', section: 'start', who: 'solo', must: true, check: true, title: 'Pick up your charm, the Intricate Wooden Figurine',
    detail: 'Gram Dunnar gives it free. Come back each time you open a new zone for free AA and charm upgrades.',
    says: [{ to: 'Gram Dunnar', text: 'craft' }, { to: 'Gram Dunnar', text: 'I have stories' }], where: [L.gram] },
  { key: 'start_traveler_manual', section: 'start', who: 'solo', must: true, title: '[[Planar Traveler’s Manual#28745]] (Willamina’s Needles)',
    detail: 'All inside PoK, no fighting. Start at Agrakath Theric and fetch him one book; ten hand-ins later, Willamina gives you the manual. Needed for the Beginner Manual quests later.',
    link: pqdiNpc(202058),
    // No step-level says/where: the chain's "Start here" box carries Agrakath's /say and both /maps.
    chain: {
      first: {
        text: 'Start at Agrakath Theric. He wants [[History of Evils: The Age of Scale#28188]], which lies on the floor on the upper level of Myrist: one is up at a time, back 30 minutes after someone takes it. Hand it to him and walk the hand-ins below; no NPC needs the talk before taking its item.',
        at: L.agrakath,
        say: ['erase the debt'],
        fetch: L.scaleBook,
      },
      talk: [
        { at: L.willamina, say: ['quests', 'help'], note: 'Her needles are late. Bolcen Tendag was bringing them.' },
        { at: L.bolcen, say: ['needles'], note: 'He is too ill to go. Mirao Frostpouch has an elixir.' },
        { at: L.mirao, say: ['I have come for the elixir'], note: 'Out of medicine: he needs black lava powder, and Cador has some.' },
        { at: L.cador, say: ['black lava powder'], note: 'Only for an artifact that Onirelin Gali holds.' },
        { at: L.onirelin, say: ['artifact'], note: 'Only for his jewel back. Arch Mage Narik took it.' },
        { at: L.narik, say: ['jewel'], note: 'Only for his engagement ring. Elisha Dirtyshoes has it.' },
        { at: L.elisha, say: ['ring'], note: 'Only if Boiron Ston likes her.' },
        { at: L.boiron, say: ['Do you like Elisha Dirtyshoes'], note: 'His family standard is gone. Caden Zharik stole it.' },
        { at: L.caden, say: ['standard'], note: 'He stole it to pay Agrakath Theric.' },
        { at: L.agrakath, say: ['erase the debt'], note: 'He will clear the debt for the book in Myrist.' },
      ],
      handins: [
        { at: L.agrakath, give: '[[History of Evils: The Age of Scale#28188]]', get: '[[Note to Caden#28084]]' },
        { at: L.caden, give: '[[Note to Caden#28084]]', get: '[[Boiron’s Standard#28085]]' },
        { at: L.boiron, give: '[[Boiron’s Standard#28085]]', get: '[[Letter to Elisha#28086]]' },
        { at: L.elisha, give: '[[Letter to Elisha#28086]]', get: '[[Narik’s Ring#28087]]' },
        { at: L.narik, give: '[[Narik’s Ring#28087]]', get: '[[Onirelin’s Jewel#28088]]' },
        { at: L.onirelin, give: '[[Onirelin’s Jewel#28088]]', get: '[[Cador’s Artifact#28089]]' },
        { at: L.cador, give: '[[Cador’s Artifact#28089]]', get: '[[Black Lava Powder#28090]]' },
        { at: L.mirao, give: '[[Black Lava Powder#28090]]', get: '[[Curative Potion#28091]]' },
        { at: L.bolcen, give: '[[Curative Potion#28091]]', get: '[[New Sewing Needles#28092]]' },
        { at: L.willamina, give: '[[New Sewing Needles#28092]]', get: '[[Planar Traveler’s Manual#28745]]' },
      ],
    } },

  // ── PoK quests (open now) ────────────────────────────────────────────────
  { key: 'pok_taxidermy', section: 'pok', who: 'solo', title: 'Collection of Taxidermy → [[Fine Antique Ring#28237]]',
    detail: 'Get a [[Collector’s Box#17769]] from Curator Merri, combine [[Tiny Rockhopper Eye#7154]], [[Undead Froglok Tongue#16532]], [[Cockatrice Beak#11935]] and [[High Quality Cougarskin#30030]] in it, and hand it to Holly Longtail.',
    link: pqdiNpc(202021),
    says: [{ to: 'Curator Merri', text: 'collector\'s box' }], where: [L.merri, L.holly] },
  { key: 'pok_merchant_crate', section: 'pok', who: 'solo', title: 'Merchant’s Crate of Supplies → 60 pp',
    detail: 'Trep gives you a crate for a purification tablet (Freeport), keg of beer (Qeynos), ball of twine (Shadeweaver), bundle of weapons (Firiona), armor assortment (Thurgadin) and case of meat (Bazaar). Combine and hand back the [[Merchants Crate of Supplies#15978]].',
    link: pqdiNpc(202057),
    says: [{ to: 'Trep Thilcan', text: 'ready to begin' }], where: [L.trep] },
  { key: 'pok_instruments', section: 'pok', who: 'solo', title: 'Collection of Instruments → [[Fine Antique Amice#28239]]',
    detail: '[[Minotaur Horn#13077]], [[Tambourine of Rituals#28074]], [[Stretched Skin Drum#3392]] and [[Orcish Lute of Singing#28025]] in a Collector’s Box; hand to Lohie Cantare.',
    link: pqdiNpc(202016),
    says: [{ to: 'Curator Merri', text: 'collector\'s box' }], where: [L.merri, L.lohie] },
  { key: 'pok_reflecting_pools', section: 'pok', who: 'solo', title: 'The Reflecting Pools of Tanaan → [[Fine Cut, Diamond Inlaid Mask#9321]] + exp',
    detail: 'Bring [[Sarnak Blood#22519]] to Tarerd Gahar. His note goes to Vicar Thiran, whose book goes to Jeren Manri in Droga; bring back what Jeren gives you to Tratlan Jowyr.',
    link: pqdiNpc(202299),
    says: [{ to: 'Tarerd Gahar', text: 'from me' }], where: [L.tarerd, L.vicar, L.jeren, L.tratlan] },
  { key: 'pok_sage_research', section: 'pok', who: 'group', title: 'Sage research → a clicky and exp per turn-in',
    detail: 'Sage Balic starts you on a [[Sage’s Box of Research#17176]]. Combine a Rune with its matching Words (classic research drops) and turn the Words in.',
    link: pqdiNpc(202051),
    says: [{ to: 'Sage Balic', text: 'continue' }, { to: 'Sage Balic', text: 'their research' }], where: [L.balic] },
  { key: 'pok_books', section: 'pok', who: 'group', title: 'Collection of Books → [[Fine Antique Locket#28240]]',
    detail: 'Black Tome, [[Tome of the Eternal#14719]], [[Codex of the Warrior#28071]] and the rare [[Book of Inspiration#4680]] in a Collector’s Box; hand to Alexis Dubbani.',
    link: pqdiNpc(202013), where: [L.alexis] },
  { key: 'pok_gems', section: 'pok', who: 'group', title: 'Collection of Gems → [[Fine Antique Veil#28242]]',
    detail: '[[Blackened Sapphire#13238]], [[Greenscale Emerald#28073]], [[Shimmering Velium Ruby#27999]] and the rare [[Hope Diamond#4696]] in a Collector’s Box; hand to Drelynn Beaufax.',
    link: pqdiNpc(202018), where: [L.drelynn] },
  { key: 'pok_idols', section: 'pok', who: 'group', title: 'Collection of Idols → [[Fine Antique Velvet Rose#28241]]',
    detail: '[[Forlorn Totem of Rolfron Zek#2569]], [[Idol of Woven Grass#28075]], [[Coldain Fetish#28072]] and the rare [[Petrified Totem#4748]] in a Collector’s Box; hand back to Curator Merri.',
    link: pqdiNpc(202017),
    says: [{ to: 'Curator Merri', text: 'special items' }], where: [L.merri] },

  // ── Spells ────────────────────────────────────────────────────────────────
  { key: 'spells_submit_book', section: 'spells', who: 'solo', must: true, title: 'Submit your spellbook on the PoP page',
    detail: 'Then the PoP page shows exactly which spells you still need, per parchment.',
    link: { href: '/pop?view=mine', label: 'my spells' } },
  { key: 'spells_parchments', section: 'spells', who: 'group', must: true, title: 'Collect [[Ethereal Parchment#29112]], [[Spectral Parchment#29131]] and [[Glyphed Rune Word#29132]]',
    detail: 'They drop in the planes and now stack to 20.' },
  { key: 'spells_turn_in', section: 'spells', who: 'solo', must: true, title: 'Turn them in to your class trainer in PoK',
    detail: 'One at a time; each gives a random spell from that parchment’s list for your class.' },

  // ── Tier one ──────────────────────────────────────────────────────────────
  { key: 't1_trash', section: 't1', who: 'group', title: 'Level and farm in the tier-one planes',
    detail: 'Justice, Innovation, Disease and Nightmare trash is group content from 46.' },
  // Disease
  { key: 'disease_ward', section: 't1', who: 'solo', must: true, title: 'Disease, before Grummus: ask Adler Fuirstel about the ward',
    says: [{ to: 'Adler Fuirstel', text: 'what ward' }], where: [L.adler] },
  { key: 'flag_grummus', section: 't1', who: 'group', must: true, flag: 'grummus_dead', title: 'Kill Grummus (Plane of Disease)',
    detail: `${PROJECTION} Then jump into the pit to reach the Crypt of Decay.`, link: popZone('disease') },
  // Justice
  { key: 'justice_mavuin_info', section: 't1', who: 'solo', must: true, title: 'Justice, before the trial: ask Mavuin for his information',
    says: [{ to: 'Mavuin', text: 'information' }], where: [L.mavuin] },
  { key: 'flag_trial_justice', section: 't1', who: 'raid', must: true, flag: 'trial_justice', title: 'Win a Justice trial and loot its Mark',
    detail: 'Any one of the six: [[Mark of Execution#31842]], [[Mark of Flame#31796]], [[Mark of Lashing#31960]], [[Mark of Stone#31845]], [[Mark of Suffocation#31846]] or [[Mark of Torture#31844]]. The trial’s boss drops SIX of its Mark, one each, so one win covers six people; run it again for the rest. To start, tell that trial’s Tribunal “prove”, then “prepared”, then “I am ready to begin the Trial of Lashing” (or Execution, Stoning, Torture, Hanging, Flame); it takes everyone in your group standing close. After a win it can run again in 10 minutes, after a loss in 1.',
    says: [{ to: 'The Tribunal (at the trial)', text: 'prove' }, { to: 'The Tribunal (at the trial)', text: 'prepared' }],
    link: popZone('justice') },
  { key: 'justice_tribunal', section: 't1', who: 'solo', must: true, title: 'With your Mark in your bags, tell a Tribunal “mavuin sent me”',
    detail: 'Needs Mavuin’s “information” first. The Tribunal checks that you carry a Mark but does not take it; without one it says “You must prove yourself in one of our trials”. Keep the Mark.',
    says: [{ to: 'The Tribunal', text: 'mavuin sent me' }], where: [L.tribunalA] },
  { key: 'justice_mavuin_hail', section: 't1', who: 'solo', must: true, title: 'Go back and hail Mavuin: that is your Justice flag',
    detail: 'The Bastion of Thunder shrine in the Plane of Storms checks for this flag, so do not skip it. Needs the Tribunal’s “mavuin sent me” first (your Mavuin flag at 2); this hail moves it to 3, which the Valor and Storms portals in Tranquility check, and so does Aerin`Dar’s projection. His reply points you to Karana and Mithaniel Marr.',
    says: [{ to: 'Mavuin', text: 'Hail', src: 'pojustice/#Mavuin.lua' }], where: [L.mavuin] },
  { key: 'justice_seventh_hammer', section: 't1', who: 'raid', title: 'Optional: The Seventh Hammer (all six Marks)',
    detail: 'With all six Marks in your bags, tell a Tribunal “knowledge” for [[The Mark of Justice#31599]]; the Marks are checked, not taken. With only some it says there are more trials yet. Hold The Mark of Justice on your cursor and click a trial portal to reach the Hammer. Per person, and not needed for any flag.',
    says: [{ to: 'The Tribunal', text: 'knowledge' }], where: [L.tribunalA] },
  // Innovation
  // The "key" is a flag, not an item (poinnovation/Nitram_Anizok.lua, poinnovation/player.lua door 7,
  // poinnovation/#Xanamech_Nezmirthafen.lua; Xanamech's loot table holds no key). The Seer lists it as poi_door.
  { key: 'innovation_door_key', section: 't1', who: 'raid', title: 'Optional: the factory door key from Xanamech Nezmirthafen',
    detail: 'One person in the raid needs it. The script gives no item: Xanamech Nezmirthafen is the beast Nitram Anizok builds, and killing it lets you hail Nitram for the flag that opens the main factory door. His talk is only story (“collecting materials” is where he names the parts); the trade is what starts it: give him a [[Copper Node#9295]], a [[Bundle of Super Conductive Wires#9426]] and an [[Intact Power Cell#9434]] (each drops at about 2% from Innovation’s clockwork), all three in one trade. He walks to the beast and puts the power unit in; kill it, then hail him while your group or raid still holds the kill credit. He leaves 10 minutes later. Then click the factory door.',
    says: [
      { to: 'Nitram Anizok', text: 'Hail', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok', text: 'advanced tinkering', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok', text: 'construction', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok', text: 'instinct for survival', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok', text: 'combination of batteries', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok', text: 'collecting materials', src: 'poinnovation/Nitram_Anizok.lua' },
      { to: 'Nitram Anizok (after the beast dies)', text: 'Hail', src: 'poinnovation/Nitram_Anizok.lua' },
    ],
    where: [L.nitram, L.nitramBeast, L.factoryDoor] },
  { key: 'innovation_test', section: 't1', who: 'solo', must: true, title: 'Innovation, before the Behemoth: tell Giwin Mirakon you will test the machine',
    says: [{ to: 'Giwin Mirakon', text: 'I will test the machine' }], where: [L.giwin] },
  { key: 'flag_behemoth', section: 't1', who: 'raid', must: true, flag: 'behemoth_dead', title: 'Kill the Manaetic Behemoth, then hail Giwin Mirakon',
    detail: 'He appears near the boss room after the kill. The Behemoth wakes when the 10th clockwork device dies. He answers only the group or raid that has the kill credit, and the hail gives the real flag only if you told Giwin you would test the machine first; otherwise it is a checklist flag, which the Seer’s “unlock my memories” turns into the real one afterwards.',
    says: [{ to: 'Giwin Mirakon (appears after the kill)', text: 'Hail', src: 'poinnovation/#Giwin_Mirakon.lua' }],
    link: popZone('innovation') },
  // Nightmare
  { key: 'nightmare_adroha', section: 't1', who: 'solo', must: true, title: 'Nightmare, before the maze: talk to Adroha Jezith',
    says: [{ to: 'Adroha Jezith', text: 'Hail' }, { to: 'Adroha Jezith', text: 'tortured by nightmares' }], where: [L.adroha] },
  { key: 'flag_hedge', section: 't1', who: 'group', must: true, flag: 'hedge_event', title: 'Thelin’s hedge maze (Plane of Nightmare), then hail Thelin Poxbourne',
    detail: 'Up to 24 players, 4 groups per dream. Hail Thelin at the end to zone out. Opens the Lair of Terris Thule. Needs Adroha’s “tortured by nightmares” first (your Thelin flag at 1): without it Thelin only screams and falls back asleep. Each group leader tells Thelin “ready” outside and is carried in; three dreams run at once, and the group has 5 minutes to tell the Thelin inside “ready” too, or Terris Thule throws everyone out. He then walks the maze collecting the dagger pieces, a wave at each stop. The boss at the end always drops the [[Dagger Blade Shard#9258]]: hand it to Thelin for [[Thelin’s Dagger#9259]]. When he and Terris have finished talking, hail him: that is the flag, and it ports you out. He stays 10 minutes. Anyone in the group without Adroha’s flag only gets a checklist flag, which the Seer’s “unlock my memories” turns into the real one afterwards. Before the end, only “ready” (outside, then inside) moves things on; Hail, “dagger” and “help” are his story.',
    says: [
      { to: 'Thelin Poxbourne (outside the maze)', text: 'Hail', src: MAZE },
      { to: 'Thelin Poxbourne (outside the maze)', text: 'dagger', src: MAZE },
      { to: 'Thelin Poxbourne (outside the maze)', text: 'help', src: MAZE },
      { to: 'Thelin Poxbourne (outside the maze)', text: 'ready', src: MAZE },
      { to: 'Thelin (inside the dream)', text: 'Hail', src: MAZE },
      { to: 'Thelin (inside the dream)', text: 'ready', src: MAZE },
      { to: 'Thelin (after he and Terris have talked)', text: 'Hail', src: MAZE },
    ],
    where: [L.thelinOutside], link: popZone('nightmare') },
  // Essences of Power, part 1 (the guild lead, 2026-09-29: "consume this too and put it on the pop
  // guide", eqprogression.com/essences-of-power-quest-pop-elemental-gods). Waves, times and the
  // one-strand-per-run limit are read off ponightmare/Aid_Eino.lua and the Dreamkeeper's loot table.
  { key: 'essences_escort', section: 't1', who: 'group', title: 'Optional: escort Aid Eino through Nightmare for the [[Tiny Gold Fist#16260]] (Essences of Power, part 1)',
    detail: 'The start phrase works only at night in game (8 PM to 7 AM). Stand by the big tree near the waterfall on the upper plateau and say “Quellious be my guide”. Aid Eino steps out and walks the zone while four waves come for him: 4 tortured banshees; 2 nightstalkers; 5 hobgoblins; then 4 banshees and 4 bats. He sits for a few minutes, then The Dreamkeeper appears (level 64, 40,000 HP, hits up to 622, slowable). Keep everything off Eino: he is level 50 with 10,000 HP. Loot the [[Strand of Nightmare#16261]], follow him to the Tranquility portal, and when he says “Hand me the strand from the beast”, give it to him for the Fist and 100,000 experience. One strand drops and he leaves after the hand-in, so it is one Fist per run. The tree answers again 36 minutes after a start. Keep the Fist: part two needs it. Hailing Aid Eino in PoK first is optional; “help” is where he tells you all this.',
    link: pqdiNpc(204467),
    says: [{ to: 'The big tree in Nightmare', text: 'Quellious be my guide' }, { to: 'Aid Eino (PoK, optional)', text: 'help' }],
    where: [L.einoTree, L.einoPok] },

  // ── Tier two ──────────────────────────────────────────────────────────────
  // Nightmare B
  { key: 'flag_tthule', section: 't2', who: 'raid', must: true, flag: 'tthule_dead', title: 'Kill Terris Thule (Lair of Terris Thule)',
    detail: PROJECTION, link: popZone('ponb') },
  { key: 'nightmare_poxbourne', section: 't2', who: 'solo', must: true, title: 'Hail Elder Poxbourne in Tranquility',
    detail: 'He answers as Thelin, and only once your Thelin flag stands at 3: Terris Thule dead and her projection hailed. Before that Adroha says there is no response to be had from Thelin. This hail is the other half of the Torment portal check, with the second Elder Fuirstel visit. His script prints “You receive a character flag!” (no “have”).',
    says: [{ to: 'Elder Poxbourne', text: 'Hail', src: 'potranquility/Elder_Poxbourne.lua' }], where: [L.poxbourne] },
  // Crypt of Decay
  { key: 'cod_fuirstel_before', section: 't2', who: 'solo', must: true, title: 'Crypt of Decay, first: hail Elder Fuirstel',
    detail: 'Only answers once your Grummus flag is done, and only if you asked Adler about the ward before Grummus fell: the projection after Grummus moves your Fuirstel flag to 2 only from 1, and this hail moves it from 2 to 3. Before that he only groans. Do it before Bertoxxulous dies, because his projection moves the flag from 3 to 4.',
    says: [{ to: 'Elder Fuirstel', text: 'Hail', src: 'potranquility/Elder_Fuirstel.lua' }], where: [L.fuirstel] },
  { key: 'flag_carprin', section: 't2', who: 'group', flag: 'carprin_cycle', check: true, title: 'The Carprin event, then hail Tarkil Adan',
    detail: 'Five nameds. Tarkil puts the key to the lower Crypt on your keyring. (The upstream script sets your bertox_key flag instead, which the door to the lower Crypt checks, and adds no item.) He appears where High Priest Ultor Szanvon dies and answers only the group or raid with the kill credit, once each; he leaves after 10 minutes.',
    says: [{ to: 'Tarkil Adan', text: 'Hail', src: 'codecay/Tarkil_Adan.lua' }], where: [L.tarkil], link: popZone('cod') },
  { key: 'flag_bert', section: 't2', who: 'raid', must: true, flag: 'bert_dead', title: 'Kill Bertoxxulous', detail: PROJECTION, link: popZone('codb') },
  { key: 'cod_fuirstel_after', section: 't2', who: 'solo', must: true, title: 'Hail Elder Fuirstel again',
    detail: 'Needs Bertoxxulous dead and his projection hailed (that moves your Fuirstel flag to 4); this hail moves it to 5. It is the other half of the Torment portal check, with Elder Poxbourne.',
    says: [{ to: 'Elder Fuirstel', text: 'Hail', src: 'potranquility/Elder_Fuirstel.lua' }], where: [L.fuirstel] },
  // Storms
  { key: 'flag_askr', section: 't2', who: 'group', must: true, flag: 'askr_quest', title: 'Askr the Lost: one head, one bag, one meld (Plane of Storms)',
    detail: 'Everyone does their own. 1) Hand Askr ONE [[Storm Giant Head#28749]] (any camp’s; 60% from its giants). Then say “it was me”, “paying attention”, and “continue” twice for [[Askr’s Bag of Verity#17192]]. 2) Combine a [[Storm Volaas Beard#28750]] (south camp), a [[Storm Taarid Bone#28751]] (west) and a [[Storm Satuur Sash#28764]] (north) in the bag; give him [[Askr’s Sealed Bag of Verity#11487]]. 3) Say “bastion of thunder” for a second bag; combine two [[Esoteric Medallion#28765]]s from DIFFERENT camps in it (south, west or north; each camp’s named drops three) and give him the [[Esoteric Meld#11488]]. Leaving the zone resets his conversation, so answer him right after each hand-in.',
    says: [
      { to: 'Askr the Lost', text: 'it was me' }, { to: 'Askr the Lost', text: 'paying attention' },
      { to: 'Askr the Lost', text: 'continue' }, { to: 'Askr the Lost', text: 'bastion of thunder' },
    ],
    where: [L.askr], link: popZone('storms') },
  { key: 'storms_zone_bot', section: 't2', who: 'solo', must: true, title: 'Click the shrine in Mount Grenidor to enter the Bastion of Thunder',
    detail: 'Needs Askr’s flag AND your Justice flag (the last Mavuin hail). The “Talisman of Thunderous Foyer” is this click, a flag, not a keyring item. Without both flags the shrine says it finds no mystic symbol. You land in the lower halls.',
    where: [L.stormsShrine] },
  // Valor
  // A click and no words (povalor/player.lua doors 8 and 9, the switches by the glass door 2).
  { key: 'valor_globe', section: 't2', who: 'group', title: 'Optional: [[A Crystalline Globe#25596]] for Aerin`Dar’s door',
    detail: 'At least one person needs it. The patch doubled the globe-piece drops. Nobody speaks to anything here: hold the globe on your cursor and click either of the two switches by the glass door, and the glass door opens.',
    where: [L.glassSwitchA, L.glassSwitchB] },
  { key: 'flag_aerindar', section: 't2', who: 'raid', must: true, flag: 'aerindar_dead', title: 'Kill Aerin`Dar (Plane of Valor)',
    detail: PROJECTION, link: popZone('valor') },
  { key: 'valor_zone_hoh', section: 't2', who: 'solo', must: true, title: 'Zone into the Halls of Honor by the Valor underground tunnel' },
  // Torment
  { key: 'torment_fahlia', section: 't2', who: 'solo', must: true, title: 'Torment, first: tell Fahlia Shadyglade you will go',
    detail: 'Needs the Disease, Crypt and Nightmare flags done in order.',
    says: [{ to: 'Fahlia Shadyglade', text: 'i will go' }], where: [L.fahlia] },
  { key: 'torment_sphere', section: 't2', who: 'raid', title: 'Optional: [[A Screaming Sphere#22954]] for Saryrn’s tower door',
    detail: 'One person needs it. An Unimaginable Horror now respawns in 30 minutes.' },
  { key: 'flag_keeper', section: 't2', who: 'raid', flag: 'keeper_dead', title: 'The Keeper of Sorrows, then hail Tylis Newleaf',
    detail: 'A small raid; resets every 2 hours. Whoever asks for it must be flagged this far. Tylis stands in Torment after the kill. His hail gives the flag (your Tylis flag from 1 to 2) only if Fahlia’s “will go” came first; otherwise it is a checklist flag the Seer’s “unlock my memories” turns into the real one. “ready to return” asks him to send you out of the plane.',
    says: [
      { to: 'Tylis Newleaf (in Torment)', text: 'Hail', src: 'potorment/#Tylis_Newleaf.lua' },
      { to: 'Tylis Newleaf (in Torment)', text: 'ready to return', src: 'potorment/#Tylis_Newleaf.lua' },
    ],
    link: popZone('torment') },
  { key: 'flag_saryrn', section: 't2', who: 'raid', must: true, flag: 'saryrn_dead', title: 'Kill Saryrn', detail: PROJECTION, link: popZone('torment') },
  { key: 'torment_return', section: 't2', who: 'solo', title: 'Hail Fahlia Shadyglade and Tylis Newleaf in the sick bay, then Maelin',
    detail: 'Story only: neither hail gives a flag. Fahlia thanks you, and Tylis points you at the Grand Librarian in Knowledge for the cipher.',
    says: [
      { to: 'Fahlia Shadyglade', text: 'Hail', src: 'potranquility/Fahlia_Shadyglade.lua' },
      { to: 'Tylis Newleaf', text: 'Hail', src: 'potranquility/Tylis_Newleaf.lua' },
    ],
    where: [L.fahlia, L.tylis, L.maelin] },

  // ── Tier three ────────────────────────────────────────────────────────────
  // Bastion of Thunder
  { key: 'bot_symbol', section: 't3', who: 'raid', title: 'The [[Symbol of Torden#9433]] opens Agnarr’s tower: one per raid, and the raid needs it',
    detail: 'Combine the [[Sandstorm Sphere#9429]], [[Lightning Sphere#9430]], [[Blizzard Sphere#9431]] and [[Tornado Sphere#9432]] inside an [[Unadorned Symbol of Torden#17169]]. Each sphere is a 25% drop from wing trash; the Unadorned Symbol drops from Auliffe Chaoswind, Brynju Thunderclap, Eindride Icestorm, Kuanbyr Hailstorm or Agnarr’s four adds. The holder puts it on the cursor and clicks the courtyard tower portal; the raid then has 5 minutes to click in. Anyone else clicking wakes the storm watchers.',
    where: [L.botTower] },
  { key: 'bot_tower', section: 't3', who: 'raid', must: true, title: 'In the tower: Evynd Firestorm, then Askr; Emmerik Skyfury, then Askr again',
    detail: 'Everyone does both. When Evynd Firestorm dies, hail Askr the Lost and say “transport”. When Emmerik Skyfury dies, hail him again and say “what storm”; he opens A Chaotic Vortex. Click it to reach Agnarr. Askr, the vortex and Karana leave after 55 minutes.',
    says: [{ to: 'Askr the Lost', text: 'transport' }, { to: 'Askr the Lost', text: 'what storm' }],
    where: [L.askrTower1, L.askrTower2] },
  { key: 'flag_agnarr', section: 't3', who: 'raid', must: true, flag: 'agnarr_dead', title: 'Kill Agnarr the Storm Lord, then speak to Karana',
    detail: 'Karana answers only the raid that got the kill, up to 72 people. “Follow the path of the Fallen” gives the real flag only if you came into the Bastion through the Storms shrine. “Send me on my path” casts Gate: you land at your bind point.',
    says: [{ to: 'Karana', text: 'I will follow the path of the Fallen.' }, { to: 'Karana', text: 'Send me on my path.' }],
    where: [L.karana], link: popZone('bot') },
  // Halls of Honor
  // The three trial givers (hohonora/encounters/RyddaDar.lua, Villagers.lua, Crazed.lua). Each starts the
  // trial on "ready"; after a win a second copy of the same NPC stands there and its hail is your credit
  // (one digit of hohtrials), printed as an "ethereal mist" line rather than the usual flag message.
  { key: 'hoh_trial_dragon', section: 't3', who: 'raid', must: true, title: 'Halls of Honor trial 1 (the dragon), then hail Trydan Faye',
    detail: 'Only “ready” starts the trial; Hail and “trials” are his story. After the win he stands here again; hail him while you are in the group or raid that won. That is your credit for this trial, with a line about an ethereal mist instead of the usual flag message.',
    says: [
      { to: 'Trydan Faye (to start the trial)', text: 'Hail', src: 'hohonora/encounters/RyddaDar.lua' },
      { to: 'Trydan Faye (to start the trial)', text: 'trials', src: 'hohonora/encounters/RyddaDar.lua' },
      { to: 'Trydan Faye (to start the trial)', text: 'ready', src: 'hohonora/encounters/RyddaDar.lua' },
      { to: 'Trydan Faye (after the win)', text: 'Hail', src: 'hohonora/encounters/RyddaDar.lua' },
    ],
    where: [L.trydan] },
  { key: 'hoh_trial_villagers', section: 't3', who: 'raid', must: true, title: 'Trial 2 (save the villagers), then hail Rhaliq Trell',
    detail: 'Only “ready” starts the trial; Hail is his story. After the win he stands here again; hail him while you are in the group or raid that won, for your credit (the same ethereal mist line).',
    says: [
      { to: 'Rhaliq Trell (to start the trial)', text: 'Hail', src: 'hohonora/encounters/Villagers.lua' },
      { to: 'Rhaliq Trell (to start the trial)', text: 'ready', src: 'hohonora/encounters/Villagers.lua' },
      { to: 'Rhaliq Trell (after the win)', text: 'Hail', src: 'hohonora/encounters/Villagers.lua' },
    ],
    where: [L.rhaliq] },
  { key: 'hoh_trial_villager', section: 't3', who: 'raid', must: true, title: 'Trial 3 (save one villager), then hail Alekson Garn',
    detail: 'A failed trial can be retried after 10 minutes. Only “ready” starts the trial; Hail is his story. After the win he stands here again; hail him while you are in the group or raid that won, for your credit. All three credits together are what opens the Temple of Marr portals and what Mithaniel Marr’s projection checks.',
    says: [
      { to: 'Alekson Garn (to start the trial)', text: 'Hail', src: 'hohonora/encounters/Crazed.lua' },
      { to: 'Alekson Garn (to start the trial)', text: 'ready', src: 'hohonora/encounters/Crazed.lua' },
      { to: 'Alekson Garn (after the win)', text: 'Hail', src: 'hohonora/encounters/Crazed.lua' },
    ],
    where: [L.alekson] },
  { key: 'flag_marr', section: 't3', who: 'raid', must: true, flag: 'marr_dead', title: 'Kill Mithaniel Marr (Temple of Marr)', detail: PROJECTION, link: popZone('hoh') },
  // Tactics
  { key: 'tactics_maelin_before', section: 't3', who: 'solo', must: true, title: 'Before the Zeks: visit Grand Librarian Maelin',
    detail: 'One visit, split into the next two steps so each can tick: Hail gives the cipher, and “lore” has him read Karana’s and Mithaniel’s notes. “information” has nothing for you until the Zek notes exist.',
    says: [{ to: 'Grand Librarian Maelin', text: 'Hail' }, { to: 'Grand Librarian Maelin', text: 'what lore' }, { to: 'Grand Librarian Maelin', text: 'what information' }],
    where: [L.maelin] },
  // Maelin's four readings, each a different word to the same NPC (poknowledge/Grand_Librarian_Maelin.lua):
  // Hail = the cipher (cipher 1), lore = the Karana + Mithaniel notes (zebuxoruk 1), information = the Zek
  // notes (zeks 6) and, later, the power source (zebuxoruk 2). Order matters; the branches are exclusive.
  { key: 'maelin_cipher', section: 't3', who: 'solo', must: true, flag: 'cipher_1', title: 'The cipher: take Saryrn’s and Mithaniel Marr’s halves to Grand Librarian Maelin',
    detail: 'Hail him once you hold both flags: the Saryrn projection and the Mithaniel Marr projection each gave you half. He joins them, gives your cipher flag and clears the two halves. It is half of the Sol Ro tower gate; the other half is the Zek notes (two steps on). If you already have the cipher, Hail only asks whether you found any lore.',
    says: [{ to: 'Grand Librarian Maelin', text: 'Hail', src: MAELIN }], where: [L.maelin] },
  { key: 'maelin_lore', section: 't3', who: 'solo', must: true, title: 'Maelin reads Karana’s and Mithaniel’s notes',
    detail: 'Needs both: Karana’s “path of the Fallen” (your Karana flag at 4) and the notes Mithaniel Marr’s projection gives you, silently, when you hail it after the Temple of Marr. Say “lore”. With only one of the two he says there must be another piece. With both he reads them, gives a flag and clears the two notes. His second reading needs this one.',
    says: [{ to: 'Grand Librarian Maelin', text: 'lore', src: MAELIN }], where: [L.maelin] },
  { key: 'flag_vallon', section: 't3', who: 'raid', flag: 'vallon_dead', title: 'Kill Vallon Zek', detail: PROJECTION, link: popZone('tactics') },
  { key: 'flag_tallon', section: 't3', who: 'raid', flag: 'tallon_dead', title: 'Kill Tallon Zek', detail: PROJECTION, link: popZone('tactics') },
  { key: 'zeks_maelin', section: 't3', who: 'solo', must: true, flag: 'zeks_6', title: 'Between the Zeks and Rallos: Maelin reads Vallon’s and Tallon’s notes',
    detail: 'Needs the cipher and both Zek projections hailed (your Zeks flag at 5). Say “information”: he reads the notes and moves you to Zeks 6. Rallos Zek’s projection needs 6 before it gives the real flag, and the Sol Ro tower portal checks 6 together with the cipher. Without the cipher he only says the notes cannot be read. If you did Rallos first, his projection gave only a checklist flag; once this reading is done the Seer’s “unlock my memories” turns it into the real one.',
    says: [{ to: 'Grand Librarian Maelin', text: 'information', src: MAELIN }], where: [L.maelin] },
  { key: 'flag_rallos', section: 't3', who: 'raid', must: true, flag: 'rallos_dead', title: 'Kill Rallos Zek', detail: PROJECTION, link: popZone('tactics') },
  { key: 'tactics_maelin_after', section: 't3', who: 'solo', must: true, title: 'After the Zeks: Maelin again, then the Seer',
    detail: 'Say “information” once more: with your Zeks flag at 7 it gives the second reading (the next step). If Rallos Zek’s projection gave only a checklist flag, the Seer’s “unlock my memories” makes it the real one first, so go back and forth until neither has more.',
    says: [{ to: 'Grand Librarian Maelin', text: 'what information' }, { to: 'Seer Mal Nae`Shi', text: 'unlock my memories', sit: true }],
    where: [L.maelin, L.seer] },
  { key: 'zebuxoruk_maelin', section: 't3', who: 'solo', must: true, flag: 'zebuxoruk_2', title: 'The power source: Maelin’s second reading (opens Air, Earth and Water)',
    detail: 'Needs his first reading (“lore”, your Zebuxoruk flag at 1) and Rallos Zek’s projection hailed (your Zeks flag at 7). Say “information”: he tells you the time machine in Innovation needs the essence of the elements, and your Zebuxoruk flag becomes 2. That is what the Air, Earth and Water portals in Tranquility check, and the Plane of Time needs it too. If your Zeks flag is still at 5 or 6, “information” gives the Zek reading instead.',
    says: [{ to: 'Grand Librarian Maelin', text: 'information', src: MAELIN }], where: [L.maelin] },
  // Solusek Ro
  { key: 'pofire_miak', section: 't3', who: 'solo', must: true, title: 'Before the tower: ask Miak the Searedsoul about the portal’s destination',
    detail: 'In Tranquility, at the Plane of Fire portal. Hail, “plane of fire” and “demise” are her story; “portal\'s destination” is the one that gives your first Fire flag. Do it before Solusek Ro: his projection moves you to the second Fire flag only from this one. If you skip it his projection gives a checklist flag, and the Seer’s “unlock my memories” turns that into the second flag as long as your Zeks flag is at 7, so it can be mended afterwards.',
    says: [
      { to: 'Miak the Searedsoul', text: 'Hail', src: 'potranquility/Miak_the_Searedsoul.lua' },
      { to: 'Miak the Searedsoul', text: 'plane of fire', src: 'potranquility/Miak_the_Searedsoul.lua' },
      { to: 'Miak the Searedsoul', text: 'demise', src: 'potranquility/Miak_the_Searedsoul.lua' },
      { to: 'Miak the Searedsoul', text: "portal's destination", src: 'potranquility/Miak_the_Searedsoul.lua' },
    ],
    where: [L.miak] },
  // The five wings are clicks and no words (solrotower/player.lua doors 12, 7, 10, 6, 11 and the Xuzl,
  // Arlyxir, Protector of Dresolik, #Rizlona and Jiva scripts that spawn the cauldron). Each click sets one
  // digit of the server's sol_room; 11111 is what the chamber portals and Solusek Ro's projection check.
  { key: 'flag_solro_minis', section: 't3', who: 'raid', flag: 'solro_minis', title: 'The five Tower of Solusek Ro minis',
    detail: 'Xuzl, Arlyxir, the Protector of Dresolik, Rizlona and Jiva, in any order. Each wing is a boss fight and then a click, and everyone clicks their own: when the boss dies a flaming cauldron appears for 30 minutes, and while it is up you click the cauldron to take that wing’s flag. Click when it is not there and you only become disoriented. Dresolik’s Protector appears when the last of the four Guardians of Dresolik dies; Rizlona has a second form where she falls, and it is that one’s death that leaves the cauldron. Nobody speaks to anything here. All five wings, with your Zeks flag at 7 (every flag up to Rallos Zek and the Zek notes), open the lava runes that take you into Solusek Ro’s chamber, and his projection checks all five too.',
    where: [L.xuzl, L.xuzlCauldron, L.arlyxir, L.arlyxirCauldron, L.dresolik, L.dresolikCauldron, L.rizlona, L.rizlonaCauldron, L.jiva, L.jivaCauldron],
    link: popZone('solro') },
  { key: 'flag_solro', section: 't3', who: 'raid', must: true, flag: 'solro_dead', title: 'Kill Solusek Ro',
    detail: `${PROJECTION} Then drop into the lava pit in his chamber to reach the Plane of Fire.`, link: popZone('solro') },

  // ── Elemental ─────────────────────────────────────────────────────────────
  { key: 'flag_fennin', section: 't4', who: 'raid', must: true, flag: 'fennin_dead', title: 'Kill Fennin Ro (Plane of Fire)',
    detail: 'Hail A Planar Projection to receive the [[Globe of Dancing Flame#29147]].', link: popZone('fire') },
  { key: 'air_key', section: 't4', who: 'raid', title: 'Optional: [[A Wind Etched Key#28638]] to reach Xegony’s island',
    detail: 'One per group. Once the holder clicks the rainbow, the group has 5 minutes to follow.' },
  { key: 'flag_avatars_air', section: 't4', who: 'raid', flag: 'avatars_air', check: true, title: 'Kill the four air avatars', link: popZone('air') },
  { key: 'flag_xegony', section: 't4', who: 'raid', must: true, flag: 'xegony_dead', title: 'Kill Xegony (Plane of Air)',
    detail: 'Hail A Planar Projection to receive the [[Amorphous Cloud of Air#29164]].', link: popZone('air') },
  { key: 'flag_coirnav', section: 't4', who: 'raid', must: true, flag: 'coirnav_dead', title: 'Kill Coirnav (Plane of Water)',
    detail: 'Hail A Planar Projection to receive the [[Sphere of Coalesced Water#29163]].', link: popZone('water') },
  { key: 'earth_key', section: 't4', who: 'raid', title: 'Optional: [[A Gem-Etched Key#28636]] from Tantisala Jaggedtooth',
    detail: 'One person needs it to open the door to the tunnels in Plane of Earth A.' },
  { key: 'flag_arbitor', section: 't4', who: 'raid', must: true, flag: 'arbitor_dead', check: true, title: 'The four earth rings and A Mystical Arbitor of Earth',
    detail: 'Hail A Planar Projection for the Passkey of the Twelve, then click the door into Plane of Earth B.', link: popZone('earth') },
  { key: 'flag_rathe', section: 't4', who: 'raid', must: true, flag: 'rathe_dead', title: 'Kill the Rathe Council (the Avatar of Earth)',
    detail: 'Hail A Planar Projection to receive the [[Mound of Living Stone#29146]].', link: popZone('poeb') },
  // Essences of Power, part 2 (poknowledge/Councilwoman_Kerasha.lua; the bowl recipe is tradeskill
  // recipe 9921; each essence is 40% on its god's loot table, one per kill, and lore).
  { key: 'essences_power', section: 't4', who: 'raid', title: 'Optional: the four Essences of Power for a [[Jade Hoop of Speed#32106]] or another reward (part 2)',
    detail: 'Carry the [[Tiny Gold Fist#16260]]: Councilwoman Kerasha answers only while you have it, and checks no flags. Say “essences of power” for a [[Sacred Bowl#17183]]. Put in the [[Essence of Fire#16262]] (Fennin Ro), [[Essence of Wind#16263]] (Xegony), [[Essence of Water#16265]] (Coirnav) and [[Essence of Earth#32111]] (the Avatar of Earth, the Rathe Council), and combine for [[Power of the Planes#16266]]. Each god drops its essence on 40% of kills, one per kill, and you can hold only one of each, so they are a loot call. They are not the four the Plane of Time needs. Give her Power of the Planes for the Jade Hoop of Speed. To change it, hand the reward back for the next one, in this order: [[Frizzniks Endless Coin Purse#17209]], [[Cord of Invigoration#32107]], [[Mace of the Ancients#32108]], [[Ring of Farsight#32109]], then the Hoop again.',
    link: pqdiNpc(202126),
    says: [{ to: 'Councilwoman Kerasha', text: 'essences of power' }],
    where: [L.kerasha] },

  // ── Time ──────────────────────────────────────────────────────────────────
  { key: 'time_vial', section: 'time', who: 'solo', title: 'Optional: craft an [[Odylic Vial#17186]]',
    detail: 'A tradable four-slot pottery container; one per raid is enough.' },
  { key: 'time_quintessence', section: 'time', who: 'solo', must: true, title: 'Combine the four essences into the [[Quintessence of Elements#29165]]',
    detail: 'In the Odylic Vial: the Globe of Dancing Flame, Amorphous Cloud of Air, Sphere of Coalesced Water and Mound of Living Stone.' },
  // time_1 is the click on the machine (poinnovation/player.lua door 145), not either NPC: Muon only carries
  // you up, and Loreseeker Maelin's "researched" is story that the click never checks.
  { key: 'time_muon', section: 'time', who: 'solo', must: true, flag: 'time_1', title: 'Enter the Plane of Time from Innovation',
    detail: 'Carry the Quintessence to Chronographer Muon, go up to the clocks, tell Loreseeker Maelin you have researched, then click the machine. Needs Maelin’s second reading (your Zebuxoruk flag at 2) and the Quintessence in your bags (Muon does not count the bank). Muon: Hail, then “yes” carries you up to the time-projection chamber, and Loreseeker Maelin appears there. Clicking the time machine is what sets your Plane of Time flag and carries you in. The portal back in Tranquility then also asks for level 65.',
    says: [
      { to: 'Chronographer Muon', text: 'Hail', src: 'poinnovation/#Chronographer_Muon.lua' },
      { to: 'Chronographer Muon', text: 'yes', src: 'poinnovation/#Chronographer_Muon.lua' },
      { to: 'Loreseeker Maelin', text: 'researched', src: 'poinnovation/Loreseeker_Maelin.lua' },
    ],
    where: [L.muon, L.loreseeker, L.timeMachine] },
  { key: 'time_timelockout', section: 'time', who: 'solo', title: 'Type #timelockout',
    detail: 'Shows your guild’s timeline, when it retires, and which encounters are open in each phase.' },
  { key: 'flag_quarm', section: 'time', who: 'raid', must: true, flag: 'quarm_dead', title: 'Kill Quarm', link: popZone('time') },
];

export const GUIDE_KEYS = new Set(GUIDE_ITEMS.map(i => i.key));

export const WHO_LABEL: Record<Who, string> = { solo: 'Solo', group: 'Group', raid: 'Raid' };

/** What the copy buttons put on the clipboard. */
export const mapCommand = (l: Pick<Loc, 'y' | 'x'>) => `/map ${l.y} ${l.x}`;
export const sayCommand = (s: Pick<Say, 'text'>) => `/say ${s.text}`;

// [[Item Name#itemId]] in a title or detail becomes an item card on hover.
const ITEM_TOKEN = /\[\[([^\]#]+)#(\d+)\]\]/g;
export type TextPart = { text: string } | { item: { name: string; id: number } };

export function splitItems(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(ITEM_TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ item: { name: m[1], id: Number(m[2]) } });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Every item id the guide mentions, for one card lookup per page render. */
export function guideItemIds(): number[] {
  const ids = new Set<number>();
  for (const i of GUIDE_ITEMS) {
    const chain = i.chain ? [i.chain.first.text, ...i.chain.handins.flatMap(s => [s.give ?? '', s.get ?? ''])] : [];
    for (const t of [i.title, i.detail ?? '', ...chain]) for (const p of splitItems(t)) if ('item' in p) ids.add(p.item.id);
  }
  return [...ids].sort((a, b) => a - b);
}

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
