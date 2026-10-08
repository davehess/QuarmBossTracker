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

// One step as ONE ordered list (the guild lead, 2026-10-03: "some of the steps require you to hail after
// something else or say a line multiple times. the hand in items should be in order with the text we say
// to them"). says[], where[], chain and turnIn (popGuideMore.ts) each keep a piece of a step, so the order
// between saying, handing in and hailing again was lost. `seq` is that order, read off the quest scripts;
// where a step has one, the checklist, its beta layouts and the Mimic PoP overlay draw it in place of the
// pieces. The old fields stay (nothing was deleted) and stay the fallback when a step has no `seq`.
//   hail  — hail `to`; `text` is an optional qualifier ("only the group with the kill credit")
//   say   — say `text` to `to`. `sit`: only while seated. `times`: said that many times in a row.
//           `until`: say it again until that is true ("she has nothing new to unlock")
//   give  — hand `items` ([[Name#id]] tokens) to `to`
//   get   — receive `items` and/or `text` (a character flag, experience). Drawn on the row it follows.
//   kill  — defeat `to`
//   click — click `to`; `items` are held on the cursor, or put in the bag, for it
//   zone  — the click or the drop that FLAGS you or zones you in. The server sets those flags on the
//           click (potranquility/player.lua, postorms/player.lua, …), not an NPC, so it is its own kind
//   wait  — wait for `text`
//   note  — a caveat, drawn under the row before it and not numbered
// `src` is the eqemu_quest_scripts path the act was read from. ⚠ Upstream's scripts: Quarm may differ.
// test/pop-guide-seq.test.js holds every say to its script's own keyword and every item to a real id.
export type ActKind = 'hail' | 'say' | 'give' | 'get' | 'kill' | 'click' | 'zone' | 'wait' | 'note';
export type Act = {
  kind: ActKind;
  to?: string;
  text?: string;
  items?: string[];
  sit?: boolean;
  times?: number;
  until?: string;
  src: string;
};

// A step that is really several runs of the same thing (the guild lead, 2026-10-04: "The Justice Trials
// each could use their own subsection"). The parent step keeps its own seq; each part is a short seq of
// its own plus the place it starts from. Only the Mimic PoP overlay draws parts (a fold each); the
// website still draws the parent alone, so the parent's seq must keep reading on its own.
export type GuidePart = { key: string; title: string; where?: Loc[]; seq: Act[] };

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
  seq?: Act[];         // the whole step in the order the script needs (see Act); attached from SEQ below
  parts?: GuidePart[]; // the step's runs, one each (see GuidePart); attached from PARTS below
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
  // The Binden Concerrentia (eqemu_spawn2 rows of Jimlok_Keylifter, Tabben_Bromal and Elder_Clinka). Jimlok's own
  // script sends you to his cousin "in the Jeral section of New Tanaan".
  jimlok: { npc: 'Jimlok Keylifter', zone: 'potranquility', y: -540, x: -1388 },
  tabben: { npc: 'Tabben Bromal', zone: 'poknowledge', y: -391, x: 540, note: 'his tinker’s shop in the Jeral section' },
  clinka: { npc: 'Elder Clinka', zone: 'potranquility', y: -384, x: -1271 },
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

// The steps as authored; GUIDE_ITEMS below is this list with each step's `seq` attached.
const BASE_ITEMS: GuideItem[] = [
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
  // The Justice flag (trial_justice = the server's mavuin 3) is finished by the Mavuin hail below, not by the
  // trial: the guild lead, 2026-10-03: "move the justice flag to the mavuin hail step". postorms/player.lua
  // lets you in only at mavuin >= 3 and the Tranquility portals check mavuin == "3", so the hail is what
  // completes Justice. This step ticks from a Mark looted, or from /who (web/lib/popGuideAuto.ts).
  { key: 'flag_trial_justice', section: 't1', who: 'raid', must: true, title: 'Win a Justice trial and loot its Mark',
    detail: 'Any one of the six: [[Mark of Execution#31842]], [[Mark of Flame#31796]], [[Mark of Lashing#31960]], [[Mark of Stone#31845]], [[Mark of Suffocation#31846]] or [[Mark of Torture#31844]]. The trial’s boss drops SIX of its Mark, one each, so one win covers six people; run it again for the rest. To start, tell that trial’s Tribunal “prove”, then “prepared”, then “I am ready to begin the Trial of Lashing” (or Execution, Stoning, Torture, Hanging, Flame); it takes everyone in your group standing close. After a win it can run again in 10 minutes, after a loss in 1.',
    says: [{ to: 'The Tribunal (at the trial)', text: 'prove' }, { to: 'The Tribunal (at the trial)', text: 'prepared' }],
    link: popZone('justice') },
  { key: 'justice_tribunal', section: 't1', who: 'solo', must: true, title: 'With your Mark in your bags, tell a Tribunal “mavuin sent me”',
    detail: 'Needs Mavuin’s “information” first. The Tribunal checks that you carry a Mark but does not take it; without one it says “You must prove yourself in one of our trials”. Keep the Mark.',
    says: [{ to: 'The Tribunal', text: 'mavuin sent me' }], where: [L.tribunalA] },
  { key: 'justice_mavuin_hail', section: 't1', who: 'solo', must: true, flag: 'trial_justice', title: 'Go back and hail Mavuin: that is your Justice flag',
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
    detail: 'Up to 24 players, 4 groups per dream. Hail Thelin at the end to zone out. The hail is your Thelin flag at 2; clicking the portal to the Lair of Terris Thule afterwards is what opens the Lair. Needs Adroha’s “tortured by nightmares” first (your Thelin flag at 1): without it Thelin only screams and falls back asleep. Each group leader tells Thelin “ready” outside and is carried in; three dreams run at once, and the group has 5 minutes to tell the Thelin inside “ready” too, or Terris Thule throws everyone out. He then walks the maze collecting the dagger pieces, a wave at each stop. The boss at the end always drops the [[Dagger Blade Shard#9258]]: hand it to Thelin for [[Thelin’s Dagger#9259]]. When he and Terris have finished talking, hail him: that is the flag, and it ports you out. He stays 10 minutes. Anyone in the group without Adroha’s flag only gets a checklist flag, which the Seer’s “unlock my memories” turns into the real one afterwards. Before the end, only “ready” (outside, then inside) moves things on; Hail, “dagger” and “help” are his story.',
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
  // The Binden Concerrentia, part 1 (the guild lead, 2026-10-08: "this needs to be tracked",
  // eqprogression.com/the-binden-concerrentia-quest-guide). Hand-ins and rewards are read off
  // potranquility/Jimlok_Keylifter.lua, poknowledge/Tabben_Bromal.lua and potranquility/Elder_Clinka.lua; the
  // combines are tradeskill recipes 9983, 9874 and 9980; the sources are the loot tables (eqemu_npc_drops).
  { key: 'binden_small', section: 't1', who: 'group', title: 'Optional: the [[Small Clockwork Talisman#28284]] (The Binden Concerrentia, part 1)',
    detail: 'Nobody in this chain checks a flag, a level or a phrase. Loot a [[Tiny Bottle and Note#28277]] from a festering rat in the Plane of Justice (10% a kill; they respawn in about 20 minutes) and give it to Jimlok Keylifter in the Plane of Tranquility for the [[Strange Jeweler’s Schematic#28278]]. Give that to Tabben Bromal in the Plane of Knowledge: he hands it back with a [[Small parts kit#17277]]. In the kit combine [[Creeping Silk Strands#28281]] (the piles of bile, goo and flesh in Disease, 8%), [[Congealed Bile-based Ooze#28282]] (virulent arachnids and hatchlings in Nightmare, 10%), [[Size C Spring#28280]] (corroded and erratic models in Innovation, 8%) and [[Tri-coated Metal Casing#28279]] (defective clockworks in Innovation, 8%) for a [[Sealed Parts Box#28283]]. Give that to Tabben for the Talisman and a [[Small Parts Container#17278]]; keep the container for part two. New over the source page: EQProgression has the silk and the ooze the wrong way round, so the ooze is Nightmare’s and the silk is Disease’s. The Talisman is already a gate (Talisman Gate, 5 charges), but part two uses it up.',
    link: pqdiNpc(202151),
    where: [L.jimlok, L.tabben] },

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
  // The Bastion flag is the shrine click's, not Askr's (the guild lead, 2026-10-03: "the flagging for bastion
  // of thunder REQUIRES you to enter the zone from plane of storms after doing the turnin"): the meld sets
  // karana 2, and only postorms/player.lua door 4 turns it into karana 3, which is what Mimic records as
  // askr_quest. So the flag sits on storms_zone_bot, and this step ticks from it (web/lib/popGuideAuto.ts).
  { key: 'flag_askr', section: 't2', who: 'group', must: true, title: 'Askr the Lost: one head, one bag, one meld (Plane of Storms)',
    detail: 'Everyone does their own. 1) Hand Askr ONE [[Storm Giant Head#28749]] (any camp’s; 60% from its giants). Then say “it was me”, “paying attention”, and “continue” twice for [[Askr’s Bag of Verity#17192]]. 2) Combine a [[Storm Volaas Beard#28750]] (south camp), a [[Storm Taarid Bone#28751]] (west) and a [[Storm Satuur Sash#28764]] (north) in the bag; give him [[Askr’s Sealed Bag of Verity#11487]]. 3) Say “bastion of thunder” for a second bag; combine two [[Esoteric Medallion#28765]]s from DIFFERENT camps in it (south, west or north; each camp’s named drops three) and give him the [[Esoteric Meld#11488]]. Leaving the zone resets his conversation, so answer him right after each hand-in.',
    says: [
      { to: 'Askr the Lost', text: 'it was me' }, { to: 'Askr the Lost', text: 'paying attention' },
      { to: 'Askr the Lost', text: 'continue' }, { to: 'Askr the Lost', text: 'bastion of thunder' },
    ],
    where: [L.askr], link: popZone('storms') },
  { key: 'storms_zone_bot', section: 't2', who: 'solo', must: true, flag: 'askr_quest', title: 'Click the shrine in Mount Grenidor to enter the Bastion of Thunder',
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
  // The Binden Concerrentia, part 2 (poknowledge/Tabben_Bromal.lua: "ready to write down" needs the Small Parts
  // Container in your bags and only reads the parts out; the hand-in of the Locked Parts Box checks nothing else).
  { key: 'binden_powered', section: 't3', who: 'group', title: 'Optional: the [[Powered Clockwork Talisman#28290]] (The Binden Concerrentia, part 2)',
    detail: 'Needs the Small Clockwork Talisman and the Small Parts Container from part one. Gather a [[Crystalline Carapace#28286]] (Crystalline and Lucid Arachnae in the Plane of Valor, 8%), a [[Dense Hammered Casing#28285]] (the Diaku in the Plane of Tactics, 10%), a [[Fiery Power Source#28287]] (protectors and sentries of Ro and sun guardians in the Tower of Solusek Ro, 10%) and [[Strands of Living Chain#28288]] (the parylyx spiders in the Plane of Torment, 50%). In the container combine those four and the Small Clockwork Talisman for a [[Locked Parts Box#28289]], and give it to Tabben Bromal for the Powered Talisman (15 charges) and [[The Talisman Schematic#28291]]. Saying “ready to write down” to Tabben while you hold the container only makes him read the four parts out. New over the source page: the Tactics casing comes from Diaku, not ogres; the Valor drops are arachnae only; sun guardians drop the power source too; and the chain is 50%, not a sure drop.',
    link: pqdiNpc(202151),
    says: [{ to: 'Tabben Bromal', text: 'ready to write down' }],
    where: [L.tabben] },

  // ── Elemental ─────────────────────────────────────────────────────────────
  { key: 'flag_fennin', section: 't4', who: 'raid', must: true, flag: 'fennin_dead', title: 'Kill Fennin Ro (Plane of Fire)',
    // The NPC that gives the item is "Essence of Fire", not A Planar Projection (pofire/encounters/Fennin.lua
    // spawns type 217454; the same for Air, Water and Earth below). Corrected 2026-10-03 from the scripts.
    detail: 'Hail Essence of Fire, who appears where Fennin Ro falls, to receive the [[Globe of Dancing Flame#29147]].', link: popZone('fire') },
  { key: 'air_key', section: 't4', who: 'raid', title: 'Optional: [[A Wind Etched Key#28638]] to reach Xegony’s island',
    detail: 'One per group. Once the holder clicks the rainbow, the group has 5 minutes to follow.' },
  { key: 'flag_avatars_air', section: 't4', who: 'raid', flag: 'avatars_air', check: true, title: 'Kill the four air avatars', link: popZone('air') },
  { key: 'flag_xegony', section: 't4', who: 'raid', must: true, flag: 'xegony_dead', title: 'Kill Xegony (Plane of Air)',
    detail: 'Hail Essence of Air, who appears where Xegony falls, to receive the [[Amorphous Cloud of Air#29164]].', link: popZone('air') },
  { key: 'flag_coirnav', section: 't4', who: 'raid', must: true, flag: 'coirnav_dead', title: 'Kill Coirnav (Plane of Water)',
    detail: 'Hail Essence of Water, who appears where Coirnav falls, to receive the [[Sphere of Coalesced Water#29163]].', link: popZone('water') },
  { key: 'earth_key', section: 't4', who: 'raid', title: 'Optional: [[A Gem-Etched Key#28636]] from Tantisala Jaggedtooth',
    detail: 'One person needs it to open the door to the tunnels in Plane of Earth A.' },
  { key: 'flag_arbitor', section: 't4', who: 'raid', must: true, flag: 'arbitor_dead', check: true, title: 'The four earth rings and A Mystical Arbitor of Earth',
    detail: 'Hail A Planar Projection for the Passkey of the Twelve, then click the door into Plane of Earth B.', link: popZone('earth') },
  { key: 'flag_rathe', section: 't4', who: 'raid', must: true, flag: 'rathe_dead', title: 'Kill the Rathe Council (the Avatar of Earth)',
    detail: 'Hail Essence of Earth, who appears where the Avatar of Earth falls, to receive the [[Mound of Living Stone#29146]].', link: popZone('poeb') },
  // Essences of Power, part 2 (poknowledge/Councilwoman_Kerasha.lua; the bowl recipe is tradeskill
  // recipe 9921; each essence is 40% on its god's loot table, one per kill, and lore).
  { key: 'essences_power', section: 't4', who: 'raid', title: 'Optional: the four Essences of Power for a [[Jade Hoop of Speed#32106]] or another reward (part 2)',
    detail: 'Carry the [[Tiny Gold Fist#16260]]: Councilwoman Kerasha answers only while you have it, and checks no flags. Say “essences of power” for a [[Sacred Bowl#17183]]. Put in the [[Essence of Fire#16262]] (Fennin Ro), [[Essence of Wind#16263]] (Xegony), [[Essence of Water#16265]] (Coirnav) and [[Essence of Earth#32111]] (the Avatar of Earth, the Rathe Council), and combine for [[Power of the Planes#16266]]. Each god drops its essence on 40% of kills, one per kill, and you can hold only one of each, so they are a loot call. They are not the four the Plane of Time needs. Give her Power of the Planes for the Jade Hoop of Speed. To change it, hand the reward back for the next one, in this order: [[Frizzniks Endless Coin Purse#17209]], [[Cord of Invigoration#32107]], [[Mace of the Ancients#32108]], [[Ring of Farsight#32109]], then the Hoop again.',
    link: pqdiNpc(202126),
    says: [{ to: 'Councilwoman Kerasha', text: 'essences of power' }],
    where: [L.kerasha] },
  // The Binden Concerrentia, part 3 (potranquility/Elder_Clinka.lua; recipe 9980). The fragments are 8-9% trash
  // drops: none is lore or no drop, which is why this has no loot call to make, unlike the essences above.
  { key: 'binden_final', section: 't4', who: 'group', title: 'Optional: [[The Binden Concerrentia#28296]] (part 3)',
    detail: 'Needs the Powered Clockwork Talisman and The Talisman Schematic from part two. Give the schematic to Elder Clinka in the Plane of Tranquility for a [[Small Lined Case#17279]]. In the case combine the Powered Talisman with [[A Living Fragment of Air#28292]] (the Temple Guardians in Air, 9%), [[A Living Fragment of Water#28293]] (the triloun in the Reef of Coirnav, 9%), [[A Living Fragment of Fire#28294]] (the jopal in Fire, 8%) and [[A Living Fragment of Earth#28295]] (the Vekerchiki and the Earthcrafted Assassins in Earth, 9%) for a [[Sealed Lined Case#28297]], and give that to Clinka for the Binden. New over the source page: the fragments drop from those mobs, not from mephits. Nothing here is lore or no drop, so unlike the essences there is no loot call: anyone can hold, trade or hand on a fragment. The Binden casts Talisman Gate with no charge limit; EQProgression says it lands you on the good side of the Plane of Knowledge, which our data cannot confirm.',
    link: pqdiNpc(203405),
    where: [L.clinka] },

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

// ── The order of each step (the guild lead, 2026-10-03; see Act above) ──────────────────────────────
// Read from eqemu_quest_scripts on 2026-10-03. Where a script keeps the order in a state machine
// (postorms/Askr_the_Lost.lua: head → "it was me" → "paying attention" → "continue" twice), the order is
// the script's. Where it is only a list of keywords with no state (most hails and "story" words), the
// guide's existing order is kept and the script does not fix it. Marked per step.
// ⚠ Steps with no quest script in the mirror have NO seq and keep says[] as they were: Gram Dunnar's charm
// ("craft", "I have stories") is in no eqemu_quest_scripts row, so there is nothing to cite.
const I = (name: string, id: number) => `[[${name}#${id}]]`;
const hail = (to: string, src: string, text?: string): Act => ({ kind: 'hail', to, ...(text ? { text } : {}), src });
const say = (to: string, text: string, src: string, more: { sit?: boolean; times?: number; until?: string } = {}): Act =>
  ({ kind: 'say', to, text, ...more, src });
const give = (to: string, items: string[], src: string, text?: string): Act =>
  ({ kind: 'give', to, items, ...(text ? { text } : {}), src });
const get = (src: string, o: { items?: string[]; text?: string } = {}): Act => ({ kind: 'get', ...o, src });
const kill = (to: string, src: string, text?: string): Act => ({ kind: 'kill', to, ...(text ? { text } : {}), src });
const click = (to: string, src: string, o: { items?: string[]; text?: string } = {}): Act => ({ kind: 'click', to, ...o, src });
const zone = (to: string, text: string, src: string): Act => ({ kind: 'zone', to, text, src });
const wait = (text: string, src: string): Act => ({ kind: 'wait', text, src });
const note = (text: string, src: string, items?: string[]): Act => ({ kind: 'note', text, ...(items ? { items } : {}), src });
// "You have received a character flag!" follows the act: the phrase or hail that earns it.
const FLAG = { text: 'a character flag' };

const SEER = 'poknowledge/Seer_Mal_Nae-Shi.lua';
const MERRI = 'poknowledge/Curator_Merri.lua';
const TRIBUNAL = 'pojustice/The_Tribunal.lua';
const MAVUIN = 'pojustice/#Mavuin.lua';
const POJ_PLAYER = 'pojustice/player.lua';
const ASKR = 'postorms/Askr_the_Lost.lua';
const NITRAM = 'poinnovation/Nitram_Anizok.lua';
const POI_PLAYER = 'poinnovation/player.lua';
const TRANQ = 'potranquility/player.lua';        // the Tranquility portals set the zone flags on the click
const SOLRO_PLAYER = 'solrotower/player.lua';
const FUIRSTEL = 'potranquility/Elder_Fuirstel.lua';
const KERASHA = 'poknowledge/Councilwoman_Kerasha.lua';
const JIMLOK = 'potranquility/Jimlok_Keylifter.lua';
const TABBEN = 'poknowledge/Tabben_Bromal.lua';
const CLINKA = 'potranquility/Elder_Clinka.lua';
const TORMENT_PORTAL = 'the Torment portal in the Plane of Tranquility';
const TORMENT_PORTAL_TEXT = 'Click it once both Elders have answered (your Fuirstel flag at 5 and your Thelin flag at 4): that click sets the Torment zone flag.';
const SHARD = I('Dagger Blade Shard', 9258);
const FIST = I('Tiny Gold Fist', 16260);
const BAG = I('Askr’s Bag of Verity', 17192);
const COLLECTORS_BOX = I('Collector’s Box', 17769);

const SEQ: Record<string, Act[]> = {
  // ── Start here ──
  start_pok_bind: [say('Soulbinder Jera', 'bind my soul', 'poknowledge/Soulbinder_Jera.lua')],
  // Order across the two NPCs is NOT fixed by either script: the Seer's checklist flags need flags Maelin sets
  // (cl_rallos needs zeks 6) and Maelin needs flags the Seer sets (cl_saryrn → saryrn, for the cipher), so it
  // is a loop. Within one visit to Maelin, "Hail" (cipher) must come before "information" (the Zek reading
  // needs the cipher) and "lore" before the second "information" (zebuxoruk 1 → 2).
  start_flag_fixers: [
    say('Seer Mal Nae`Shi', 'guided meditation', SEER, { sit: true }),
    say('Seer Mal Nae`Shi', 'unlock my memories', SEER, { sit: true, until: 'she has nothing new to unlock' }),
    hail('Grand Librarian Maelin', MAELIN),
    say('Grand Librarian Maelin', 'lore', MAELIN),
    say('Grand Librarian Maelin', 'information', MAELIN),
    note('Each of them unlocks what the other needs, so go back to the Seer and do it again, back and forth, until neither has anything new. Visit Maelin before and after the Zeks and after Saryrn.', SEER),
  ],
  // Willamina's Needles: the hand-ins are the item chain, so their order is fixed by what each NPC takes.
  // No NPC's trade checks that you spoke first; the story words stay in the chain's own folded section.
  start_traveler_manual: [
    get('poknowledge/Agrakath_Theric.lua', { items: [I('History of Evils: The Age of Scale', 28188)], text: 'from the floor on the upper level of Myrist' }),
    note('Nobody needs a phrase before taking an item, so the hand-ins are all there is; the optional story is folded below.', 'poknowledge/Agrakath_Theric.lua'),
    give('Agrakath Theric', [I('History of Evils: The Age of Scale', 28188)], 'poknowledge/Agrakath_Theric.lua'),
    get('poknowledge/Agrakath_Theric.lua', { items: [I('Note to Caden', 28084)] }),
    give('Caden Zharik', [I('Note to Caden', 28084)], 'poknowledge/Caden_Zharik.lua'),
    get('poknowledge/Caden_Zharik.lua', { items: [I('Boiron’s Standard', 28085)] }),
    give('Boiron Ston', [I('Boiron’s Standard', 28085)], 'poknowledge/Boiron_Ston.lua'),
    get('poknowledge/Boiron_Ston.lua', { items: [I('Letter to Elisha', 28086)] }),
    give('Elisha Dirtyshoes', [I('Letter to Elisha', 28086)], 'poknowledge/Elisha_Dirtyshoes.lua'),
    get('poknowledge/Elisha_Dirtyshoes.lua', { items: [I('Narik’s Ring', 28087)] }),
    give('Arch Mage Narik', [I('Narik’s Ring', 28087)], 'poknowledge/Arch_Mage_Narik.lua'),
    get('poknowledge/Arch_Mage_Narik.lua', { items: [I('Onirelin’s Jewel', 28088)] }),
    give('Onirelin Gali', [I('Onirelin’s Jewel', 28088)], 'poknowledge/Onirelin_Gali.lua'),
    get('poknowledge/Onirelin_Gali.lua', { items: [I('Cador’s Artifact', 28089)] }),
    give('Oracle Cador', [I('Cador’s Artifact', 28089)], 'poknowledge/Oracle_Cador.lua'),
    get('poknowledge/Oracle_Cador.lua', { items: [I('Black Lava Powder', 28090)] }),
    give('Mirao Frostpouch', [I('Black Lava Powder', 28090)], 'poknowledge/Mirao_Frostpouch.lua'),
    get('poknowledge/Mirao_Frostpouch.lua', { items: [I('Curative Potion', 28091)] }),
    give('Bolcen Tendag', [I('Curative Potion', 28091)], 'poknowledge/Bolcen_Tendag.lua'),
    get('poknowledge/Bolcen_Tendag.lua', { items: [I('New Sewing Needles', 28092)] }),
    give('Willamina', [I('New Sewing Needles', 28092)], 'poknowledge/Willamina.lua'),
    get('poknowledge/Willamina.lua', { items: [I('Planar Traveler’s Manual', 28745)] }),
  ],

  // ── PoK collections: the box from Curator Merri, the four things combined in it, the filled box handed
  // to its collector. Merri's "collector's box" is a keyword with no state, so the box can be had any time
  // before the combine; the guide's order (box first) is kept.
  pok_taxidermy: [
    say('Curator Merri', "collector's box", MERRI), get(MERRI, { items: [COLLECTORS_BOX] }),
    click('Combine', 'poknowledge/Holly_Longtail.lua', { text: 'put these four in the box first', items: [I('Tiny Rockhopper Eye', 7154), I('Undead Froglok Tongue', 16532), I('Cockatrice Beak', 11935), I('High Quality Cougarskin', 30030)] }),
    give('Holly Longtail', [I('Collection of Taxidermy', 28076)], 'poknowledge/Holly_Longtail.lua'),
    get('poknowledge/Holly_Longtail.lua', { items: [I('Fine Antique Ring', 28237)] }),
  ],
  // Trep's three keywords ("will do you a favor", "ready to begin") carry no state either; only the last one hands over the crate.
  pok_merchant_crate: [
    say('Trep Thilcan', 'ready to begin', 'poknowledge/Trep_Thilcan.lua'), get('poknowledge/Trep_Thilcan.lua', { items: [I('Empty Supplies Crate', 17177)] }),
    click('Combine', 'poknowledge/Trep_Thilcan.lua', { text: 'with all six in the crate: a purification tablet (Freeport), a keg of beer (Qeynos), a ball of twine (Shadeweaver), a bundle of weapons (Firiona), an armor assortment (Thurgadin) and a case of meat (Bazaar)' }),
    give('Trep Thilcan', [I('Merchants Crate of Supplies', 15978)], 'poknowledge/Trep_Thilcan.lua'),
    get('poknowledge/Trep_Thilcan.lua', { text: '60 platinum and experience' }),
  ],
  pok_instruments: [
    say('Curator Merri', "collector's box", MERRI), get(MERRI, { items: [COLLECTORS_BOX] }),
    click('Combine', 'poknowledge/Lohie_Cantare.lua', { text: 'put these four in the box first', items: [I('Minotaur Horn', 13077), I('Tambourine of Rituals', 28074), I('Stretched Skin Drum', 3392), I('Orcish Lute of Singing', 28025)] }),
    give('Lohie Cantare', [I('Collection of Instruments', 28080)], 'poknowledge/Lohie_Cantare.lua'),
    get('poknowledge/Lohie_Cantare.lua', { items: [I('Fine Antique Amice', 28239)] }),
  ],
  // Tarerd's "from me" is the keyword his own reply calls "[from you]"; his trade does not check it, so the
  // order is the item chain: Sarnak Blood → note → book → book → mask.
  pok_reflecting_pools: [
    say('Tarerd Gahar', 'from me', 'poknowledge/Tarerd_Gahar.lua'),
    give('Tarerd Gahar', [I('Sarnak Blood', 22519)], 'poknowledge/Tarerd_Gahar.lua'),
    get('poknowledge/Tarerd_Gahar.lua', { items: [I('Note from Tarerd', 15958)] }),
    give('Vicar Thiran', [I('Note from Tarerd', 15958)], 'poknowledge/Vicar_Thiran.lua'),
    get('poknowledge/Vicar_Thiran.lua', { items: [I('Goblins and Their Religions', 15959)] }),
    give('Jeren Manri', [I('Goblins and Their Religions', 15959)], 'droga/Jeren_Manri.lua'),
    get('droga/Jeren_Manri.lua', { items: [I('The Reflecting Pools of Tanaan', 15960)] }),
    give('Tratlan Jowyr', [I('The Reflecting Pools of Tanaan', 15960)], 'poknowledge/Tratlan_Jowyr.lua'),
    get('poknowledge/Tratlan_Jowyr.lua', { items: [I('Fine Cut, Diamond Inlaid Mask', 9321)], text: '150,000 experience' }),
  ],
  // Sage Balic: "continue" is the one real state machine here. It is a prompt that answers the first time
  // and then, with the 60-second timer still running, a second time, and only the second gives the box.
  pok_sage_research: [
    say('Sage Balic', 'your research', 'poknowledge/Sage_Balic.lua'),
    say('Sage Balic', 'continue', 'poknowledge/Sage_Balic.lua', { times: 2 }),
    get('poknowledge/Sage_Balic.lua', { items: [I('Sage’s Box of Research', 17176)], text: 'the second “continue” gives it, within a minute of the first' }),
    say('Sage Balic', 'their research', 'poknowledge/Sage_Balic.lua'),
    click('Combine', 'poknowledge/Sage_Balic.lua', { text: 'a Rune and its matching Words in the box; classic research drops' }),
    give('Sage Balic', [I('Word of Combine', 15946), I('Word of Sorcery', 15947), I('Word of Helix', 15948), I('Word of Inverse', 15949), I('Word of Impetus', 15950)], 'poknowledge/Sage_Balic.lua', 'one Word per turn-in; the other research drops (bindings, notes) hand in the same way for experience only'),
    get('poknowledge/Sage_Balic.lua', { items: [I('Sage’s Apprentice Cap', 32019), I('Twisted Talisman', 32020), I('Three Ringed Hoop', 32021), I('Joined Signet', 32022), I('Apprentice’s Notebook', 32023)], text: 'in that order, one per Word, and 100,000 experience each' }),
  ],
  pok_books: [
    say('Curator Merri', "collector's box", MERRI), get(MERRI, { items: [COLLECTORS_BOX] }),
    click('Combine', 'poknowledge/Alexis_Dubbani.lua', { text: 'put these four in the box first', items: [I('Black Tome with Silver Runes', 13400), I('Tome of the Eternal', 14719), I('Codex of the Warrior', 28071), I('Book of Inspiration', 4680)] }),
    give('Alexis Dubbani', [I('Collection of Books', 28081)], 'poknowledge/Alexis_Dubbani.lua'),
    get('poknowledge/Alexis_Dubbani.lua', { items: [I('Fine Antique Locket', 28240)] }),
  ],
  pok_gems: [
    say('Curator Merri', "collector's box", MERRI), get(MERRI, { items: [COLLECTORS_BOX] }),
    click('Combine', 'poknowledge/Drelynn_Beaufax.lua', { text: 'put these four in the box first', items: [I('Blackened Sapphire', 13238), I('Greenscale Emerald', 28073), I('Shimmering Velium Ruby', 27999), I('Hope Diamond', 4696)] }),
    give('Drelynn Beaufax', [I('Collection of Gems', 28077)], 'poknowledge/Drelynn_Beaufax.lua'),
    get('poknowledge/Drelynn_Beaufax.lua', { items: [I('Fine Antique Veil', 28242)] }),
  ],
  pok_idols: [
    say('Curator Merri', 'special items', MERRI),
    say('Curator Merri', "collector's box", MERRI), get(MERRI, { items: [COLLECTORS_BOX] }),
    click('Combine', MERRI, { text: 'put these four in the box first', items: [I('Forlorn Totem of Rolfron Zek', 2569), I('Idol of Woven Grass', 28075), I('Coldain Fetish', 28072), I('Petrified Totem', 4748)] }),
    give('Curator Merri', [I('Collection of Idols', 28082)], MERRI),
    get(MERRI, { items: [I('Fine Antique Velvet Rose', 28241)] }),
  ],

  // ── Tier one ──
  disease_ward: [say('Adler Fuirstel', 'what ward', 'potranquility/Adler_Fuirstel.lua'), get('potranquility/Adler_Fuirstel.lua', FLAG)],
  // Justice, in the order each NPC needs: Mavuin's "information" (mavuin 1), a Mark and the Tribunal's "mavuin"
  // (2), then the Mavuin hail (3). The trial itself can be won any time before the Tribunal.
  justice_mavuin_info: [say('Mavuin', 'information', MAVUIN), get(MAVUIN, FLAG)],
  flag_trial_justice: [
    say('The Tribunal (at the trial)', 'prove', TRIBUNAL),
    say('The Tribunal (at the trial)', 'prepared', TRIBUNAL),
    say('The Tribunal (at the trial)', 'ready to begin the Trial of Lashing', TRIBUNAL),
    note('Each Tribunal answers only its own trial, so use the name of the trial you stand at: Lashing, Execution, Stoning, Torture, Hanging or Flame. It takes everyone in your group standing close.', TRIBUNAL),
    kill('the trial’s boss', TRIBUNAL, 'win the trial'),
    get(TRIBUNAL, { items: [I('Mark of Execution', 31842), I('Mark of Flame', 31796), I('Mark of Lashing', 31960), I('Mark of Stone', 31845), I('Mark of Suffocation', 31846), I('Mark of Torture', 31844)], text: 'loot the one for that trial' }),
  ],
  justice_tribunal: [
    note('Have a Mark in your bags: the Tribunal checks for one and does not take it.', TRIBUNAL),
    say('The Tribunal', 'mavuin sent me', TRIBUNAL), get(TRIBUNAL, FLAG),
  ],
  justice_mavuin_hail: [
    hail('Mavuin', MAVUIN), get(MAVUIN, FLAG),
    zone('the Valor or Storms portal in the Plane of Tranquility', 'Click it with your Mavuin flag at 3: that click sets the zone flags for both planes.', TRANQ),
  ],
  justice_seventh_hammer: [
    note('Hold all six Marks in your bags: the Tribunal checks them and does not take them.', TRIBUNAL),
    say('The Tribunal', 'knowledge', TRIBUNAL), get(TRIBUNAL, { items: [I('The Mark of Justice', 31599)] }),
    click('a trial portal', POJ_PLAYER, { items: [I('The Mark of Justice', 31599)], text: 'hold it on your cursor' }),
  ],
  // Nitram's story words (hail … "collecting materials") are a keyword list with no state and the trade does
  // not check them; the guide's order is kept. The trade, the kill and the second hail are the script's order.
  innovation_door_key: [
    hail('Nitram Anizok', NITRAM),
    say('Nitram Anizok', 'advanced tinkering', NITRAM),
    say('Nitram Anizok', 'construction', NITRAM),
    say('Nitram Anizok', 'instinct for survival', NITRAM),
    say('Nitram Anizok', 'combination of batteries', NITRAM),
    say('Nitram Anizok', 'collecting materials', NITRAM),
    give('Nitram Anizok', [I('Copper Node', 9295), I('Bundle of Super Conductive Wires', 9426), I('Intact Power Cell', 9434)], NITRAM, 'all three in one trade; he then walks to the beast and puts the power unit in'),
    kill('Xanamech Nezmirthafen', 'poinnovation/#Xanamech_Nezmirthafen.lua'),
    hail('Nitram Anizok (after the beast dies)', NITRAM, 'only the group or raid with the kill credit'), get(NITRAM, FLAG),
    click('The main factory door', POI_PLAYER, { text: 'it opens only with that flag' }),
  ],
  innovation_test: [say('Giwin Mirakon', 'I will test the machine', 'poinnovation/Giwin_Mirakon.lua'), get('poinnovation/Giwin_Mirakon.lua', FLAG)],
  flag_behemoth: [
    kill('the Manaetic Behemoth', 'poinnovation/encounters/Behemoth.lua'),
    hail('Giwin Mirakon (appears after the kill)', 'poinnovation/#Giwin_Mirakon.lua', 'only the group or raid with the kill credit'), get('poinnovation/#Giwin_Mirakon.lua', FLAG),
    zone('the Plane of Tactics portal in the Plane of Tranquility', 'Click it with your Zeks flag at 2 or more: that click sets the zone flag.', TRANQ),
  ],
  // Adroha's story words are a keyword chain with no state; only "tortured by nightmares" sets the flag.
  nightmare_adroha: [
    hail('Adroha Jezith', 'potranquility/Adroha_Jezith.lua'),
    say('Adroha Jezith', 'tortured by nightmares', 'potranquility/Adroha_Jezith.lua'), get('potranquility/Adroha_Jezith.lua', FLAG),
  ],
  // The maze (ponightmare/encounters/Maze.lua is a state machine): "ready" outside (state 0 → 1), "ready" inside
  // within five minutes (1 → 2, he walks), the boss spawns (3), the shard is taken only in state 3 (his
  // dagger), the dialogue ends in state 4, and only then does a hail flag you and carry you out.
  flag_hedge: [
    hail('Thelin Poxbourne (outside the maze)', MAZE),
    say('Thelin Poxbourne (outside the maze)', 'dagger', MAZE),
    say('Thelin Poxbourne (outside the maze)', 'help', MAZE),
    say('Thelin Poxbourne (outside the maze)', 'ready', MAZE),
    note('Only “ready” moves things on; Hail, “dagger” and “help” are his story. Each group leader says it, and is carried in with the group standing near. Without Adroha’s flag he only screams and falls asleep.', MAZE),
    hail('Thelin (inside the dream)', MAZE),
    say('Thelin (inside the dream)', 'ready', MAZE),
    note('Say it within 5 minutes or Terris Thule throws everyone out. He then walks the maze collecting the dagger pieces, a wave at each stop.', MAZE),
    kill('the boss at the end of the maze', MAZE, 'a construct of nightmares'),
    get(MAZE, { items: [SHARD], text: 'it drops the last piece' }),
    give('Thelin (inside the dream)', [SHARD], MAZE),
    get(MAZE, { items: [I('Thelin’s Dagger', 9259)] }),
    wait('Thelin and Terris Thule to finish talking', MAZE),
    hail('Thelin (after he and Terris have talked)', MAZE), get(MAZE, { text: 'a character flag, and he carries you out' }),
    zone('the portal to the Lair of Terris Thule', 'Click it with your Thelin flag at 2 or more: that click sets the Lair’s zone flag.', 'ponightmare/player.lua'),
  ],
  // Essences of Power, part 1. The start phrase is a proximity-say at the tree (ponightmare/EinoInvisNight.lua);
  // the waves are Aid_Eino.lua's waypoints; the hand-in works only once he has reached the end (escortDone).
  essences_escort: [
    say('Aid Eino (PoK, optional)', 'help', 'poknowledge/Aid_Eino.lua'),
    say('The big tree in Nightmare', 'Quellious be my guide', 'ponightmare/EinoInvisNight.lua'),
    note('Say it at night in game (8 PM to 7 AM), right beside the tree. Four waves come at his stops: 4 tortured banshees; 2 nightstalkers; 5 hobgoblins; then 4 banshees and 4 bats. Keep everything off Eino.', 'ponightmare/Aid_Eino.lua'),
    kill('The Dreamkeeper', 'ponightmare/Aid_Eino.lua', 'he sits for a few minutes first'),
    get('ponightmare/Aid_Eino.lua', { items: [I('Strand of Nightmare', 16261)], text: 'loot it' }),
    give('Aid Eino', [I('Strand of Nightmare', 16261)], 'ponightmare/Aid_Eino.lua', 'when he asks for it at the Tranquility portal'),
    get('ponightmare/Aid_Eino.lua', { items: [FIST], text: '100,000 experience' }),
  ],

  // The Binden Concerrentia (potranquility/Jimlok_Keylifter.lua, poknowledge/Tabben_Bromal.lua, potranquility/
  // Elder_Clinka.lua). All trades: no script here tests a flag or a level, and the story phrases are flavour.
  binden_small: [
    note('Nobody here checks a flag or a level. Loot the Tiny Bottle and Note from a festering rat in the Plane of Justice.', JIMLOK, [I('Tiny Bottle and Note', 28277)]),
    give('Jimlok Keylifter', [I('Tiny Bottle and Note', 28277)], JIMLOK), get(JIMLOK, { items: [I('Strange Jeweler’s Schematic', 28278)] }),
    give('Tabben Bromal', [I('Strange Jeweler’s Schematic', 28278)], TABBEN),
    get(TABBEN, { items: [I('Small parts kit', 17277), I('Strange Jeweler’s Schematic', 28278)], text: 'he hands the schematic back' }),
    click('Combine', TABBEN, { text: 'in the Small parts kit', items: [I('Creeping Silk Strands', 28281), I('Congealed Bile-based Ooze', 28282), I('Size C Spring', 28280), I('Tri-coated Metal Casing', 28279)] }),
    get(TABBEN, { items: [I('Sealed Parts Box', 28283)] }),
    give('Tabben Bromal', [I('Sealed Parts Box', 28283)], TABBEN),
    get(TABBEN, { items: [I('Small Clockwork Talisman', 28284), I('Small Parts Container', 17278)] }),
  ],
  // "ready to write down" needs the Small Parts Container (HasItem 17278) and only has him read the parts out.
  binden_powered: [
    note('Keep the Small Parts Container from part one, and the Small Clockwork Talisman: the combine uses it up.', TABBEN, [I('Small Parts Container', 17278), I('Small Clockwork Talisman', 28284)]),
    say('Tabben Bromal', 'ready to write down', TABBEN),
    note('Optional: with the container in your bags he only reads the four parts out. The hand-in below needs no phrase.', TABBEN),
    click('Combine', TABBEN, { text: 'in the Small Parts Container', items: [I('Dense Hammered Casing', 28285), I('Crystalline Carapace', 28286), I('Fiery Power Source', 28287), I('Strands of Living Chain', 28288), I('Small Clockwork Talisman', 28284)] }),
    get(TABBEN, { items: [I('Locked Parts Box', 28289)] }),
    give('Tabben Bromal', [I('Locked Parts Box', 28289)], TABBEN),
    get(TABBEN, { items: [I('Powered Clockwork Talisman', 28290), I('The Talisman Schematic', 28291)] }),
  ],

  // ── Tier two ──
  flag_grummus: [
    kill('Grummus', 'podisease/#Grummus.lua'),
    hail('A Planar Projection', 'podisease/A_Planar_Projection.lua'), get('podisease/A_Planar_Projection.lua', FLAG),
    zone('the pit behind Grummus', 'Jump in: dropping into the Crypt of Decay is what sets its zone flag, and only with the Grummus flag from the projection.', 'podisease/player.lua'),
  ],
  flag_tthule: [
    kill('Terris Thule', 'nightmareb/Terris_Thule.lua'),
    hail('A Planar Projection', 'nightmareb/A_Planar_Projection.lua'), get('nightmareb/A_Planar_Projection.lua', FLAG),
  ],
  nightmare_poxbourne: [
    hail('Elder Poxbourne', 'potranquility/Elder_Poxbourne.lua'), get('potranquility/Elder_Poxbourne.lua', FLAG),
    zone(TORMENT_PORTAL, TORMENT_PORTAL_TEXT, TRANQ),
  ],
  cod_fuirstel_before: [hail('Elder Fuirstel', FUIRSTEL), get(FUIRSTEL, FLAG)],
  flag_carprin: [
    kill('the five Carprin nameds', 'codecay/#High_Priest_Ultor_Szanvon.lua', 'Tarkil Adan appears where High Priest Ultor Szanvon dies'),
    hail('Tarkil Adan', 'codecay/Tarkil_Adan.lua', 'only the group or raid with the kill credit'), get('codecay/Tarkil_Adan.lua', FLAG),
    click('the door to the lower Crypt', 'codecay/player.lua', { text: 'it opens only with that flag' }),
  ],
  flag_bert: [
    kill('Bertoxxulous', 'codecay/encounters/Bertox.lua'),
    hail('A Planar Projection', 'codecay/A_Planar_Projection.lua', 'it answers only with Tarkil Adan’s flag'), get('codecay/A_Planar_Projection.lua', FLAG),
  ],
  cod_fuirstel_after: [
    hail('Elder Fuirstel', FUIRSTEL), get(FUIRSTEL, FLAG),
    zone(TORMENT_PORTAL, TORMENT_PORTAL_TEXT, TRANQ),
  ],
  // Askr (postorms/Askr_the_Lost.lua) is the model case. His state per player: the head hand-in sets 6; "it was
  // me" (6 → 7), "paying attention" (7 → 8), then "continue" at 8 and at 9: the first only talks, the second
  // summons the bag. The sealed bag sets karana 1, "bastion of thunder" at 1 gives a second bag, the meld sets
  // karana 2, and postorms/player.lua door 4 (the shrine) turns karana 2 + mavuin 3 into karana 3 and the
  // zone-in. His state is in memory: it resets when you leave the zone, but he remembers the head, and a hail
  // then puts you straight at 8.
  flag_askr: [
    give('Askr the Lost', [I('Storm Giant Head', 28749)], ASKR, 'any camp’s'),
    get(ASKR, { items: [I('Storm Giant Head', 11486)], text: 'handed back; it will not work a second time' }),
    say('Askr the Lost', 'it was me', ASKR),
    say('Askr the Lost', 'paying attention', ASKR),
    say('Askr the Lost', 'continue', ASKR, { times: 2 }),
    get(ASKR, { items: [BAG], text: 'the second “continue” gives it' }),
    note('If you leave the zone his conversation resets: hail him once (he remembers the head), then say “continue” twice again.', ASKR),
    click('Combine', ASKR, { text: 'in the bag: one from each camp', items: [I('Storm Volaas Beard', 28750), I('Storm Taarid Bone', 28751), I('Storm Satuur Sash', 28764)] }),
    give('Askr the Lost', [I('Askr’s Sealed Bag of Verity', 11487)], ASKR), get(ASKR, FLAG),
    say('Askr the Lost', 'bastion of thunder', ASKR), get(ASKR, { items: [BAG], text: 'a second bag' }),
    click('Combine', ASKR, { text: 'in the bag: two from different camps', items: [I('Esoteric Medallion', 28765), I('Esoteric Medallion', 28765)] }),
    give('Askr the Lost', [I('Esoteric Meld', 11488)], ASKR), get(ASKR, FLAG),
    note('That is not your Bastion of Thunder flag yet: the shrine click in the next step is. It needs this flag AND your Justice flag (Mavuin at 3), or the shrine finds “no mystic symbol”.', 'postorms/player.lua'),
  ],
  storms_zone_bot: [
    zone('the shrine in the heart of Mount Grenidor', 'Click it: with Askr’s second flag and your Justice flag (Mavuin at 3) it sets your Bastion flag and sends you in; without both it refuses.', 'postorms/player.lua'),
  ],
  valor_globe: [
    click('either switch by the glass door', 'povalor/player.lua', { items: [I('A Crystalline Globe', 25596)], text: 'hold the globe on your cursor; the glass door opens' }),
  ],
  flag_aerindar: [
    kill('Aerin`Dar', 'povalor/#Aerin-Dar.lua'),
    hail('A Planar Projection', 'povalor/A_Planar_Projection.lua', 'it answers only with your Mavuin flag at 3'), get('povalor/A_Planar_Projection.lua', { text: 'your Aerin`Dar flag (no message)' }),
  ],
  valor_zone_hoh: [
    zone('the Halls of Honor portal, by the Valor underground tunnel', 'Click it: with the Aerin`Dar flag from the projection this click sets your Aerin`Dar flag to 2 and the Halls of Honor zone flag; without it the portal refuses you.', 'povalor/player.lua'),
  ],
  torment_fahlia: [say('Fahlia Shadyglade', 'i will go', 'potranquility/Fahlia_Shadyglade.lua'), get('potranquility/Fahlia_Shadyglade.lua', FLAG)],
  flag_keeper: [
    kill('The Keeper of Sorrows', 'potorment/The_Keeper_of_Sorrows.lua'),
    hail('Tylis Newleaf (in Torment)', 'potorment/#Tylis_Newleaf.lua', 'it flags you only if Fahlia’s “will go” came first'), get('potorment/#Tylis_Newleaf.lua', FLAG),
    say('Tylis Newleaf (in Torment)', 'ready to return', 'potorment/#Tylis_Newleaf.lua'),
  ],
  flag_saryrn: [
    kill('Saryrn', 'potorment/Saryrn.lua'),
    hail('A Planar Projection', 'potorment/A_Planar_Projection.lua'), get('potorment/A_Planar_Projection.lua', FLAG),
  ],
  torment_return: [
    hail('Fahlia Shadyglade', 'potranquility/Fahlia_Shadyglade.lua'),
    hail('Tylis Newleaf', 'potranquility/Tylis_Newleaf.lua'),
  ],

  // ── Tier three ──
  bot_symbol: [
    click('the tower portal in the courtyard', 'bothunder/player.lua', { items: [I('Symbol of Torden', 9433)], text: 'the holder puts it on the cursor and clicks; their raid or group then has 5 minutes' }),
    click('the tower portal in the courtyard', 'bothunder/player.lua', { text: 'everyone else, within those 5 minutes' }),
  ],
  // Askr in the tower is two different NPCs (#Askr_the_Lost after Evynd, ##Askr_the_Lost after Emmerik). Each
  // hail is story; "transport" and "what storm" are what act. "what storm" spawns the vortex, the vortex click carries you.
  bot_tower: [
    kill('Evynd Firestorm', 'bothunder/Evynd_Firestorm.lua'),
    hail('Askr the Lost (appears where Evynd falls)', 'bothunder/#Askr_the_Lost.lua'),
    say('Askr the Lost (appears where Evynd falls)', 'transport', 'bothunder/#Askr_the_Lost.lua'),
    kill('Emmerik Skyfury', 'bothunder/Emmerik_Skyfury.lua'),
    hail('Askr the Lost (appears where Emmerik falls)', 'bothunder/##Askr_the_Lost.lua'),
    say('Askr the Lost (appears where Emmerik falls)', 'what storm', 'bothunder/##Askr_the_Lost.lua'),
    click('A Chaotic Vortex', 'bothunder/player.lua', { text: 'it appears when he says that; clicking it carries you to Agnarr' }),
  ],
  flag_agnarr: [
    kill('Agnarr the Storm Lord', 'bothunder/Agnarr_the_Storm_Lord.lua'),
    say('Karana', 'I will follow the path of the Fallen.', 'bothunder/Karana.lua'), get('bothunder/Karana.lua', { text: 'a character flag, only if you came into the Bastion through the Storms shrine' }),
    say('Karana', 'Send me on my path.', 'bothunder/Karana.lua'), get('bothunder/Karana.lua', { text: 'Gate: you land at your bind point' }),
  ],
  // The three Halls of Honor trials share one shape (each script: Hail and "ready" are the first NPC's words, the
  // trial runs, and a second copy of the NPC stands there afterwards whose hail is the credit).
  hoh_trial_dragon: [
    hail('Trydan Faye (to start the trial)', 'hohonora/encounters/RyddaDar.lua'),
    say('Trydan Faye (to start the trial)', 'trials', 'hohonora/encounters/RyddaDar.lua'),
    say('Trydan Faye (to start the trial)', 'ready', 'hohonora/encounters/RyddaDar.lua'),
    kill('Rydda`Dar', 'hohonora/encounters/RyddaDar.lua'),
    hail('Trydan Faye (after the win)', 'hohonora/encounters/RyddaDar.lua', 'while you are in the group or raid that won'), get('hohonora/encounters/RyddaDar.lua', { text: 'your credit for this trial (a line about an ethereal mist)' }),
  ],
  hoh_trial_villagers: [
    hail('Rhaliq Trell (to start the trial)', 'hohonora/encounters/Villagers.lua'),
    say('Rhaliq Trell (to start the trial)', 'ready', 'hohonora/encounters/Villagers.lua'),
    note('Win the trial: save the villagers.', 'hohonora/encounters/Villagers.lua'),
    hail('Rhaliq Trell (after the win)', 'hohonora/encounters/Villagers.lua', 'while you are in the group or raid that won'), get('hohonora/encounters/Villagers.lua', { text: 'your credit for this trial (a line about an ethereal mist)' }),
  ],
  hoh_trial_villager: [
    hail('Alekson Garn (to start the trial)', 'hohonora/encounters/Crazed.lua'),
    say('Alekson Garn (to start the trial)', 'ready', 'hohonora/encounters/Crazed.lua'),
    note('Win the trial: save one villager.', 'hohonora/encounters/Crazed.lua'),
    hail('Alekson Garn (after the win)', 'hohonora/encounters/Crazed.lua', 'while you are in the group or raid that won'), get('hohonora/encounters/Crazed.lua', { text: 'your credit for this trial (a line about an ethereal mist)' }),
    zone('one of the Temple of Marr portals', 'Click it once all three trials are credited: that click sets the Temple of Marr zone flag.', 'hohonora/player.lua'),
  ],
  flag_marr: [
    kill('Mithaniel Marr', 'hohonorb/Lord_Mithaniel_Marr.lua'),
    hail('A Planar Projection', 'hohonorb/A_Planar_Projection.lua'), get('hohonorb/A_Planar_Projection.lua', FLAG),
  ],
  // Maelin keeps no conversation: what each word does depends only on your flags. One visit, in the order the
  // flags need: "Hail" (the cipher) before "information" (the Zek reading needs it), "lore" before the second
  // "information" (the power source needs zebuxoruk 1).
  tactics_maelin_before: [hail('Grand Librarian Maelin', MAELIN), say('Grand Librarian Maelin', 'lore', MAELIN), say('Grand Librarian Maelin', 'information', MAELIN)],
  maelin_cipher: [hail('Grand Librarian Maelin', MAELIN, 'once you hold both halves, Saryrn’s and Mithaniel Marr’s'), get(MAELIN, { text: 'your cipher flag (it clears the two halves)' })],
  maelin_lore: [say('Grand Librarian Maelin', 'lore', MAELIN), get(MAELIN, { text: 'a character flag (it clears the two notes)' })],
  flag_vallon: [
    kill('Vallon Zek', 'potactics/214317.lua'),
    hail('A Planar Projection', 'potactics/214324.lua'), get('potactics/214324.lua', FLAG),
  ],
  flag_tallon: [
    kill('Tallon Zek', 'potactics/214026.lua'),
    hail('A Planar Projection', 'potactics/214323.lua'), get('potactics/214323.lua', FLAG),
  ],
  zeks_maelin: [
    say('Grand Librarian Maelin', 'information', MAELIN), get(MAELIN, { text: 'a character flag (Zeks 6); it needs the cipher and both Zek projections' }),
    zone('the Tower of Solusek Ro portal in the Plane of Tranquility', 'Click it with the cipher and your Zeks flag at 6 or more: that click sets the zone flag.', TRANQ),
  ],
  flag_rallos: [
    kill('Rallos Zek', 'potactics/encounters/Rallos.lua'),
    hail('A Planar Projection', 'potactics/214322.lua', 'it gives the real flag only with your Zeks flag at 6'), get('potactics/214322.lua', FLAG),
  ],
  tactics_maelin_after: [
    say('Grand Librarian Maelin', 'information', MAELIN),
    say('Seer Mal Nae`Shi', 'unlock my memories', SEER, { sit: true, until: 'she has nothing new to unlock' }),
    note('If Rallos Zek’s projection gave only a checklist flag, the Seer makes it the real one first: go back and forth until neither has more.', SEER),
  ],
  zebuxoruk_maelin: [
    say('Grand Librarian Maelin', 'information', MAELIN), get(MAELIN, { text: 'a character flag (Zebuxoruk 2)' }),
    zone('the Air, Earth or Water portal in the Plane of Tranquility', 'Click one: that click sets the zone flags for all three, and needs your Zebuxoruk flag at 2.', TRANQ),
  ],
  pofire_miak: [
    hail('Miak the Searedsoul', 'potranquility/Miak_the_Searedsoul.lua'),
    say('Miak the Searedsoul', 'plane of fire', 'potranquility/Miak_the_Searedsoul.lua'),
    say('Miak the Searedsoul', 'demise', 'potranquility/Miak_the_Searedsoul.lua'),
    say('Miak the Searedsoul', "portal's destination", 'potranquility/Miak_the_Searedsoul.lua'), get('potranquility/Miak_the_Searedsoul.lua', { text: 'your first Fire flag' }),
  ],
  flag_solro_minis: [
    note('The five wings in any order. Each is a boss and then a click on its flaming cauldron, which is there for 30 minutes after the kill; click when it is not and you only become disoriented.', SOLRO_PLAYER),
    kill('Xuzl', 'solrotower/Xuzl.lua'),
    click('Xuzl’s flaming cauldron', SOLRO_PLAYER), get(SOLRO_PLAYER, FLAG),
    kill('Arlyxir', 'solrotower/Arlyxir.lua'),
    click('Arlyxir’s flaming cauldron', SOLRO_PLAYER), get(SOLRO_PLAYER, FLAG),
    kill('the four Guardians of Dresolik', 'solrotower/Guardian_of_Dresolik.lua', 'the Protector appears when the last one dies'),
    kill('The Protector of Dresolik', 'solrotower/The_Protector_of_Dresolik.lua'),
    click('Dresolik’s flaming cauldron', SOLRO_PLAYER), get(SOLRO_PLAYER, FLAG),
    kill('Rizlona', 'solrotower/Rizlona.lua'),
    kill('the second Rizlona, where she falls', 'solrotower/#Rizlona.lua'),
    click('Rizlona’s flaming cauldron', SOLRO_PLAYER), get(SOLRO_PLAYER, FLAG),
    kill('Jiva', 'solrotower/Jiva.lua'),
    click('Jiva’s flaming cauldron', SOLRO_PLAYER), get(SOLRO_PLAYER, FLAG),
  ],
  flag_solro: [
    kill('Solusek Ro', 'solrotower/Solusek_Ro.lua'),
    hail('A Planar Projection', 'solrotower/A_Planar_Projection.lua', 'it answers only after all five wings'), get('solrotower/A_Planar_Projection.lua', { text: 'a character flag (your second Fire flag needs the first one and your Zeks flag at 7; otherwise it is a checklist flag)' }),
    click('the floor doors in his chamber', SOLRO_PLAYER, { text: 'they open while the projection is up' }),
    zone('the lava pit in his chamber', 'Drop in: falling into the Plane of Fire is what sets its zone flag, and only with your second Fire flag. The Fire portal in Tranquility works only after that.', SOLRO_PLAYER),
  ],

  // ── Elemental ──
  flag_fennin: [
    kill('Fennin Ro', 'pofire/encounters/Fennin.lua'),
    hail('Essence of Fire', 'pofire/Essence_of_Fire.lua', 'only if you do not already hold the Globe or the Quintessence'), get('pofire/Essence_of_Fire.lua', { items: [I('Globe of Dancing Flame', 29147)] }),
  ],
  flag_xegony: [
    kill('Xegony', 'poair/encounters/Xegony.lua'),
    hail('Essence of Air', 'poair/Essence_of_Air.lua', 'only if you do not already hold the Cloud or the Quintessence'), get('poair/Essence_of_Air.lua', { items: [I('Amorphous Cloud of Air', 29164)] }),
  ],
  flag_coirnav: [
    kill('Coirnav', 'powater/encounters/Coirnav.lua'),
    hail('Essence of Water', 'powater/Essence_of_Water.lua', 'only if you do not already hold the Sphere or the Quintessence'), get('powater/Essence_of_Water.lua', { items: [I('Sphere of Coalesced Water', 29163)] }),
  ],
  flag_arbitor: [
    kill('the four earth rings (Dust, Mud, Stone and Vine)', 'poeartha/arbitor_guy.lua', 'all four within 24 hours, or the Arbitor does not appear'),
    kill('A Mystical Arbitor of Earth', 'poeartha/A_Mystical_Arbitor_of_Earth.lua'),
    hail('A Planar Projection', 'poeartha/A_Planar_Projection.lua'), get('poeartha/A_Planar_Projection.lua', { text: 'a character flag (the Passkey of the Twelve)' }),
    zone('the door into Plane of Earth B', 'Click it with that flag: the click sets the zone flag and carries you in.', 'poeartha/player.lua'),
  ],
  flag_rathe: [
    kill('the Avatar of Earth', 'poearthb/#Avatar_of_Earth.lua'),
    hail('Essence of Earth', 'poearthb/Essence_of_Earth.lua', 'only if you do not already hold the Mound or the Quintessence'), get('poearthb/Essence_of_Earth.lua', { items: [I('Mound of Living Stone', 29146)] }),
  ],
  // Part 2 of Essences of Power (poknowledge/Councilwoman_Kerasha.lua): she answers "essences of power" only while
  // you carry the Fist. The reward ring is a rotation: each hand-back gives the next one.
  essences_power: [
    note('Carry the Tiny Gold Fist: Councilwoman Kerasha answers only while you have it.', KERASHA, [FIST]),
    say('Councilwoman Kerasha', 'essences of power', KERASHA), get(KERASHA, { items: [I('Sacred Bowl', 17183)] }),
    click('Combine', KERASHA, { text: 'in the bowl: one of each, a loot call from the four gods', items: [I('Essence of Fire', 16262), I('Essence of Wind', 16263), I('Essence of Water', 16265), I('Essence of Earth', 32111)] }),
    get(KERASHA, { items: [I('Power of the Planes', 16266)] }),
    give('Councilwoman Kerasha', [I('Power of the Planes', 16266)], KERASHA), get(KERASHA, { items: [I('Jade Hoop of Speed', 32106)] }),
    give('Councilwoman Kerasha', [I('Jade Hoop of Speed', 32106), I('Frizzniks Endless Coin Purse', 17209), I('Cord of Invigoration', 32107), I('Mace of the Ancients', 32108), I('Ring of Farsight', 32109)], KERASHA, 'to change the reward, hand back the one you hold'),
    get(KERASHA, { items: [I('Frizzniks Endless Coin Purse', 17209), I('Cord of Invigoration', 32107), I('Mace of the Ancients', 32108), I('Ring of Farsight', 32109), I('Jade Hoop of Speed', 32106)], text: 'the next one, in that order (each hand-back gives the next)' }),
  ],
  // The Binden Concerrentia, part 3 (potranquility/Elder_Clinka.lua). Her story lines have no keywords.
  binden_final: [
    note('Keep the Powered Clockwork Talisman and The Talisman Schematic from part two. Elder Clinka checks no flag.', CLINKA, [I('Powered Clockwork Talisman', 28290), I('The Talisman Schematic', 28291)]),
    give('Elder Clinka', [I('The Talisman Schematic', 28291)], CLINKA), get(CLINKA, { items: [I('Small Lined Case', 17279)] }),
    click('Combine', CLINKA, { text: 'in the Small Lined Case', items: [I('A Living Fragment of Air', 28292), I('A Living Fragment of Earth', 28295), I('A Living Fragment of Fire', 28294), I('A Living Fragment of Water', 28293), I('Powered Clockwork Talisman', 28290)] }),
    get(CLINKA, { items: [I('Sealed Lined Case', 28297)] }),
    give('Elder Clinka', [I('Sealed Lined Case', 28297)], CLINKA), get(CLINKA, { items: [I('The Binden Concerrentia', 28296)] }),
  ],

  // ── Time ──
  // Muon answers only while zebuxoruk 2 AND the Quintessence is in your bags (not the bank). His "Hail" and "yes"
  // keywords carry no state, so the guide's order (Hail, then yes) is kept. The click on the machine is what flags you.
  time_muon: [
    note('Needs your Zebuxoruk flag at 2 and the Quintessence of Elements in your bags (the bank does not count).', 'poinnovation/#Chronographer_Muon.lua', [I('Quintessence of Elements', 29165)]),
    hail('Chronographer Muon', 'poinnovation/#Chronographer_Muon.lua'),
    say('Chronographer Muon', 'yes', 'poinnovation/#Chronographer_Muon.lua'),
    note('He carries you up to the time-projection chamber, and Loreseeker Maelin appears there.', 'poinnovation/#Chronographer_Muon.lua'),
    say('Loreseeker Maelin', 'researched', 'poinnovation/Loreseeker_Maelin.lua'),
    zone('The time machine', 'Click it with the Quintessence in your bags: that click sets your Plane of Time flag and carries you in. The portal back in Tranquility then also asks for level 65.', POI_PLAYER),
  ],
};

// ── The parts of a step (the guild lead, 2026-10-04; see GuidePart above) ───────────────────────────
// The six Justice trials, one part each. Read on 2026-10-04 from pojustice/The_Tribunal.lua (each Tribunal
// is one spawn point, and its trial number comes from that spawn point, so it answers only "ready to begin
// the Trial of <its own word>"), pojustice/encounters/*Trial.lua (the boss each spawns) and the bosses'
// loot tables (the Mark, 100%). `y`/`x` are the Tribunal's own placed spawn (eqemu_spawn2 345327-345332),
// Y then X like every other /map here. The Flame trial's script is BurningTrial.lua.
const JUSTICE_TRIALS: { word: string; script: string; y: number; x: number; boss: string; mark: [string, number] }[] = [
  { word: 'Lashing', script: 'LashingTrial', y: 817, x: 417, boss: 'Lashman Azakal', mark: ['Mark of Lashing', 31960] },
  { word: 'Execution', script: 'ExecutionTrial', y: 765, x: 393, boss: 'Prime Executioner Vathoch', mark: ['Mark of Execution', 31842] },
  { word: 'Stoning', script: 'StoningTrial', y: 714, x: 418, boss: 'Yurae Zhaleem', mark: ['Mark of Stone', 31845] },
  { word: 'Torture', script: 'TortureTrial', y: 713, x: 521, boss: 'Punisher Veshtaq', mark: ['Mark of Torture', 31844] },
  { word: 'Hanging', script: 'HangingTrial', y: 764, x: 543, boss: 'Gallows Master Teion', mark: ['Mark of Suffocation', 31846] },
  { word: 'Flame', script: 'BurningTrial', y: 816, x: 521, boss: 'Punisher of Flame', mark: ['Mark of Flame', 31796] },
];
const PARTS: Record<string, GuidePart[]> = {
  flag_trial_justice: JUSTICE_TRIALS.map(t => {
    const at = `The Tribunal (Trial of ${t.word})`;
    const script = `pojustice/encounters/${t.script}.lua`;
    return {
      key: t.word.toLowerCase(),
      title: `Trial of ${t.word} → ${t.mark[0]}`,
      where: [{ npc: 'The Tribunal', zone: 'pojustice' as const, y: t.y, x: t.x, note: `Trial of ${t.word}` }],
      seq: [
        say(at, 'prove', TRIBUNAL),
        say(at, 'prepared', TRIBUNAL),
        say(at, `ready to begin the Trial of ${t.word}`, TRIBUNAL),
        kill(t.boss, script),
        get(script, { items: [I(t.mark[0], t.mark[1])] }),
      ],
    };
  }),
};

export const GUIDE_ITEMS: GuideItem[] = BASE_ITEMS.map(i => (SEQ[i.key] || PARTS[i.key]
  ? { ...i, ...(SEQ[i.key] ? { seq: SEQ[i.key] } : {}), ...(PARTS[i.key] ? { parts: PARTS[i.key] } : {}) }
  : i));

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
    const seq = (i.seq ?? []).flatMap(a => a.items ?? []);   // the hand-ins in a seq name items no title does
    for (const t of [i.title, i.detail ?? '', ...chain, ...seq]) for (const p of splitItems(t)) if ('item' in p) ids.add(p.item.id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** A seq as the rows a page draws (the guild lead, 2026-10-03: "1. Hail …  2. /say lore  3. Give … → get …").
 *  Every act is a numbered row except two: a `get` rides on the row before it ("→ get …"), and a `note`
 *  hangs under the row before it with no number of its own. A note before any row is `lead`. A `get` with
 *  nothing before it (a pick-up from the floor) is a row of its own. The page and the Mimic overlay draw
 *  these rows; the overlay carries its own copy of this rule (apps/mimic/popraid.html, seqRows). */
export type SeqRow = { n: number; act: Act; gets: Act[]; notes: Act[] };
export function seqRows(seq: Act[]): { lead: Act[]; rows: SeqRow[] } {
  const lead: Act[] = [];
  const rows: SeqRow[] = [];
  for (const act of seq) {
    const last = rows[rows.length - 1];
    if (act.kind === 'note') (last ? last.notes : lead).push(act);
    else if (act.kind === 'get' && last) last.gets.push(act);
    else rows.push({ n: rows.length + 1, act, gets: [], notes: [] });
  }
  return { lead, rows };
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
