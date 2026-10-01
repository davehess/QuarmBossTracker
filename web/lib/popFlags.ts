// PoP progression catalog — flags, zones, and the gate graph.
//
// ⚠ THE GATES BELOW ARE QUARM'S, READ OFF THE SERVER (2026-10-01, the day PoP opened; DECISIONS §119).
// potranquility/player.lua (in eqemu_quest_scripts) is the portal script that decides who may pass,
// and Quarm turned the classic level bypasses off. So Storms needs the Justice flag like Valor
// (the guild lead: "PLANE OF STORMS REQUIRES flagging, but it shows everyone"), Torment needs both
// Tranquility thank-yous, Sol Ro needs the cipher and Maelin's reading, and the elemental planes need
// Maelin's power-source step. Where a gate is one of the server's own steps rather than a classic kill,
// the flag key IS the step ('fuirstel_5' = the server's fuirstel 5); the bot writes those rows
// (utils/popFlagStages.js). The history below is how the classic chart was built, kept for its sources.
//
// Rebuilt 2026-07-08 against the corroborated classic progression (EQProgression
// planar-progression guide + Fanra flagging guide + Samanna planar chart v3.0 —
// the TAKP wiki mirrors this; its exact page was network-blocked, see
// docs/DESIGN-pop-flags.md for the source trail). Key corrections vs the old
// draft: Terris Thule flags PLANE OF TORMENT (not Tactics); Manaetic Behemoth
// flags PLANE OF TACTICS (the Zek arc); elemental access is a five-flag bundle
// (Marr + Agnarr + Saryrn + Rallos Zek + Bertoxxulous), Fire additionally
// needs Solusek Ro.
//
// ⚠ Quarm will ship documented QoL deviations at launch — every gate here is
// DATA, so corrections are edits to this file + the bot's POP_FLAG_BY_BOSS
// map (index.js — KEEP IN SYNC). flag rows with flag_key='unmapped' on /pop
// are grants the bot couldn't attribute: the catalog's live TODO list.

export type FlagKind = 'kill' | 'trial' | 'quest' | 'event' | 'loot';

export type PopFlagDef = {
  key: string;
  label: string;        // short human label ("Kill Grummus")
  kind: FlagKind;
  zone: string;         // zone key where it's earned
  verified: boolean;    // corroborated across 2+ sources
  note?: string;
};

export type PopNode = {
  key: string;
  name: string;
  short: string;               // compact card title
  tier: 1 | 2 | 3 | 4 | 5;
  col: number;                 // chart column (1..5) within the tier band
  requires: string[];          // flag keys — ALL required to enter
  grants: string[];            // flag keys earned inside this zone
  levelBypass?: number;        // classic unflagged-entry level (Quarm QoL TBD)
  subZoneOf?: string;          // rendered attached to parent (CoDB, HoHB, Ragrax)
  verified: boolean;
  note?: string;
};

// ── Flags ────────────────────────────────────────────────────────────────────
export const POP_FLAG_DEFS: PopFlagDef[] = [
  // Tier 1 arcs
  { key: 'trial_justice',  label: 'Justice flag (trial + Mavuin)', kind: 'trial', zone: 'justice',    verified: true,  note: 'Win one trial (its mark), say "Mavuin" to the Tribunal, then hail Mavuin: the server\'s mavuin 3. Opens Valor and Storms.' },
  { key: 'grummus_dead',   label: 'Kill Grummus',                  kind: 'kill',  zone: 'disease',    verified: true },
  { key: 'behemoth_dead',  label: 'Kill Manaetic Behemoth',        kind: 'kill',  zone: 'innovation', verified: true,  note: 'Zek arc — flags Plane of Tactics (Giwin Mirakon hail)' },
  { key: 'hedge_event',    label: 'Hedge event',                   kind: 'event', zone: 'nightmare',  verified: true,  note: 'Opens the Lair of Terris Thule' },
  // Tier 2
  { key: 'tthule_dead',    label: 'Kill Terris Thule',             kind: 'kill',  zone: 'ponb',       verified: true,  note: 'Flags Plane of Torment (Adroha + Elder Poxbourne hails)' },
  { key: 'aerindar_dead',  label: 'Kill Aerin`Dar',                kind: 'kill',  zone: 'valor',      verified: true,  note: 'Flags Halls of Honor' },
  { key: 'askr_quest',     label: 'Storms shrine (Askr\'s talisman)', kind: 'quest', zone: 'storms',  verified: true,  note: 'Askr\'s giant pieces, then touch the shrine in Storms with the talisman: the server\'s karana 3. Opens the Bastion of Thunder.' },
  // Server steps that gate a zone on Quarm (potranquility/player.lua). The key is the step itself.
  { key: 'fuirstel_5',     label: 'Elder Fuirstel thanks you',     kind: 'quest', zone: 'cod',        verified: true,  note: 'After Bertoxxulous: hail his projection, then Elder Fuirstel in Tranquility. Half of the Torment gate.' },
  { key: 'thelin_4',       label: 'Thelin thanks you',             kind: 'quest', zone: 'ponb',       verified: true,  note: 'After Terris Thule: hail her projection, then Elder Poxbourne in Tranquility. Half of the Torment gate.' },
  { key: 'cipher_1',       label: 'Cipher of the Divine Language', kind: 'quest', zone: 'torment',    verified: true,  note: 'The halves from Saryrn and Mithaniel Marr, taken to Maelin in Knowledge. Half of the Sol Ro gate.' },
  { key: 'zeks_6',         label: 'Maelin reads the Zek notes',    kind: 'quest', zone: 'tactics',    verified: true,  note: 'Tallon\'s and Vallon\'s notes taken to Maelin. Half of the Sol Ro gate.' },
  { key: 'zebuxoruk_2',    label: 'Maelin\'s power source',        kind: 'quest', zone: 'bot',        verified: true,  note: 'Karana\'s and Mithaniel\'s notes translated by Maelin. Opens Air, Earth and Water.' },
  { key: 'time_1',         label: 'Bond with the Plane of Time',   kind: 'quest', zone: 'time',       verified: true,  note: 'Meldrath\'s time machine in Innovation sets it. The portal also needs level 65.' },
  { key: 'carprin_cycle',  label: 'Tarkil Adan\'s key (Carprin cycle)', kind: 'event', zone: 'cod',   verified: true,  note: 'Beat the Carprin cycle, then hail Tarkil Adan: the server\'s bertox_key. Opens lower Crypt (Bertoxxulous). No raid-in' },
  { key: 'bert_dead',      label: 'Kill Bertoxxulous',             kind: 'kill',  zone: 'codb',       verified: true },
  { key: 'keeper_dead',    label: 'Kill Keeper of Sorrows',        kind: 'kill',  zone: 'torment',    verified: true,  note: 'Mini-raid; requester must be fully flagged to here' },
  { key: 'saryrn_dead',    label: 'Kill Saryrn',                   kind: 'kill',  zone: 'torment',    verified: true },
  // Tier 3
  { key: 'hoh_trials',     label: 'HoH trials ×3',                 kind: 'trial', zone: 'hoh',        verified: false, note: 'Villagers, Nomads, Rydda`Dar — opens Temple of Marr' },
  { key: 'marr_dead',      label: 'Kill Mithaniel Marr',           kind: 'kill',  zone: 'hohb',       verified: true },
  { key: 'agnarr_dead',    label: 'Kill Agnarr',                   kind: 'kill',  zone: 'bot',        verified: true },
  { key: 'tallon_dead',    label: 'Kill Tallon Zek',               kind: 'kill',  zone: 'tactics',    verified: true },
  { key: 'vallon_dead',    label: 'Kill Vallon Zek',               kind: 'kill',  zone: 'tactics',    verified: true },
  { key: 'rallos_dead',    label: 'Kill Rallos Zek',               kind: 'kill',  zone: 'tactics',    verified: true,  note: 'Classic: Marr kill flag must precede the RZ flag registering' },
  { key: 'solro_minis',    label: 'Sol Ro minis ×5',               kind: 'event', zone: 'solro',      verified: true,  note: 'Jiva, Xuzl, Arlyxir, Rizlona, Protector of Dresolik — opens Solusek Ro’s chamber' },
  { key: 'solro_dead',     label: 'Kill Solusek Ro',               kind: 'kill',  zone: 'solro',      verified: true,  note: 'Flags Doomfire (PoFire)' },
  // Tier 4 (elemental)
  { key: 'arbitor_dead',   label: 'Kill Arbitor of Earth',         kind: 'kill',  zone: 'earth',      verified: false, note: 'With the 4 earth rings — opens Ragrax (PoEB)' },
  { key: 'rathe_dead',     label: 'Kill the Rathe Council',        kind: 'kill',  zone: 'poeb',       verified: true },
  { key: 'stone_loot',     label: 'Loot Mound of Living Stone',    kind: 'loot',  zone: 'poeb',       verified: true },
  { key: 'avatars_air',    label: 'Kill the 4 air avatars',        kind: 'event', zone: 'air',        verified: false, note: 'Opens Xegony’s island' },
  { key: 'xegony_dead',    label: 'Kill Xegony',                   kind: 'kill',  zone: 'air',        verified: true },
  { key: 'cloud_loot',     label: 'Loot Amorphous Cloud of Air',   kind: 'loot',  zone: 'air',        verified: true },
  { key: 'coirnav_dead',   label: 'Kill Coirnav',                  kind: 'kill',  zone: 'water',      verified: true },
  { key: 'sphere_loot',    label: 'Loot Sphere of Coalesced Water', kind: 'loot', zone: 'water',      verified: true },
  { key: 'fennin_dead',    label: 'Kill Fennin Ro',                kind: 'kill',  zone: 'fire',       verified: true },
  { key: 'globe_loot',     label: 'Loot Globe of Dancing Flame',   kind: 'loot',  zone: 'fire',       verified: true },
  // Time
  { key: 'quarm_dead',     label: 'Kill Quarm',                    kind: 'kill',  zone: 'time',       verified: true,  note: 'Phase VI — the end of the road' },
  // Funnel
  { key: 'unmapped',       label: 'Unattributed flag grant',       kind: 'event', zone: '',           verified: true,  note: 'The bot saw a grant it could not name — catalog TODO' },
];

export const POP_FLAGS: Record<string, PopFlagDef> =
  Object.fromEntries(POP_FLAG_DEFS.map(f => [f.key, f]));

// ── Zones (chart nodes) ──────────────────────────────────────────────────────
// Every `requires` below is what potranquility/player.lua checks at that portal (Quarm, 2026-10-01).
// Valor and Storms share one check (mavuin 3); Torment needs fuirstel 5 AND thelin 4; Thunder karana
// 3 or more; Tactics zeks 2 or more; Sol Ro the cipher AND zeks 6 or more; Air, Earth and Water
// zebuxoruk 2; Time the time flag (and level 65). Crypt of Decay and Halls of Honor open from inside
// their neighbour (the pipe by Grummus; the Valor door after Aerin`Dar), and Doomfire from the Sol
// Ro tower after Solusek Ro. No level lets anyone in unflagged.
export const POP_ZONES: PopNode[] = [
  // Tier 1 — open at 46 (the Plane of Knowledge portal's only check)
  { key: 'justice',    name: 'Plane of Justice',      short: 'Justice',    tier: 1, col: 1, requires: [], grants: ['trial_justice'],                verified: true },
  { key: 'innovation', name: 'Plane of Innovation',   short: 'Innovation', tier: 1, col: 2, requires: [], grants: ['behemoth_dead'],                verified: true },
  { key: 'disease',    name: 'Plane of Disease',      short: 'Disease',    tier: 1, col: 3, requires: [], grants: ['grummus_dead'],                 verified: true },
  { key: 'nightmare',  name: 'Plane of Nightmare',    short: 'Nightmare',  tier: 1, col: 4, requires: [], grants: ['hedge_event'],                  verified: true },
  // Tier 2
  { key: 'storms',     name: 'Plane of Storms',       short: 'Storms',     tier: 2, col: 1, requires: ['trial_justice'], grants: ['askr_quest'],    verified: true, note: 'Same portal check as Valor: the Justice flag' },
  { key: 'valor',      name: 'Plane of Valor',        short: 'Valor',      tier: 2, col: 2, requires: ['trial_justice'], grants: ['aerindar_dead'], verified: true },
  { key: 'cod',        name: 'Crypt of Decay',        short: 'Decay',      tier: 2, col: 3, requires: ['grummus_dead'], grants: ['carprin_cycle'],  verified: true, note: 'Drop down the pipe by Grummus once he is dead' },
  { key: 'codb',       name: 'Crypt of Decay (lower)', short: 'Bertoxx',   tier: 2, col: 3, requires: ['carprin_cycle'], grants: ['bert_dead', 'fuirstel_5'], subZoneOf: 'cod', verified: true, note: 'Tarkil Adan\'s key (the server\'s bertox_key). No raid-in' },
  { key: 'ponb',       name: 'Lair of Terris Thule',  short: 'T. Thule',   tier: 2, col: 4, requires: ['hedge_event'], grants: ['tthule_dead', 'thelin_4'], verified: true },
  { key: 'torment',    name: 'Plane of Torment',      short: 'Torment',    tier: 2, col: 5, requires: ['fuirstel_5', 'thelin_4'], grants: ['keeper_dead', 'saryrn_dead'], verified: true, note: 'Both Tranquility thank-yous: Bertoxxulous and Terris Thule dead, then the Fuirstels and Thelin' },
  // Tier 3
  { key: 'bot',        name: 'Bastion of Thunder',    short: 'Thunder',    tier: 3, col: 1, requires: ['askr_quest'], grants: ['agnarr_dead', 'zebuxoruk_2'], verified: true },
  { key: 'hoh',        name: 'Halls of Honor',        short: 'Honor',      tier: 3, col: 2, requires: ['aerindar_dead'], grants: ['hoh_trials'],    verified: true },
  { key: 'hohb',       name: 'Temple of Marr',        short: 'M. Marr',    tier: 3, col: 2, requires: ['hoh_trials'], grants: ['marr_dead'],        subZoneOf: 'hoh', verified: false },
  { key: 'tactics',    name: 'Plane of Tactics',      short: 'Tactics',    tier: 3, col: 3, requires: ['behemoth_dead'], grants: ['tallon_dead', 'vallon_dead', 'zeks_6', 'rallos_dead'], verified: true },
  { key: 'solro',      name: 'Tower of Solusek Ro',   short: 'Sol Ro',     tier: 3, col: 4, requires: ['cipher_1', 'zeks_6'], grants: ['solro_minis', 'solro_dead'], verified: true, note: 'The cipher (Saryrn + Marr halves) and Maelin\'s reading of the Zek notes' },
  // Tier 4 — elementals
  { key: 'earth',      name: 'Plane of Earth',        short: 'Earth',      tier: 4, col: 1, requires: ['zebuxoruk_2'], grants: ['arbitor_dead'], verified: true, note: '4 rings + Arbitor open Ragrax' },
  { key: 'poeb',       name: 'Ragrax, Stronghold of the Twelve', short: 'Ragrax', tier: 4, col: 1, requires: ['arbitor_dead'], grants: ['rathe_dead', 'stone_loot'], subZoneOf: 'earth', verified: false, note: 'No raid-in' },
  { key: 'air',        name: 'Eryslai, the Kingdom of Wind', short: 'Air', tier: 4, col: 2, requires: ['zebuxoruk_2'], grants: ['avatars_air', 'xegony_dead', 'cloud_loot'], verified: true },
  { key: 'water',      name: 'Reef of Coirnav',       short: 'Water',      tier: 4, col: 3, requires: ['zebuxoruk_2'], grants: ['coirnav_dead', 'sphere_loot'], verified: true },
  { key: 'fire',       name: 'Doomfire, the Burning Lands', short: 'Fire', tier: 4, col: 4, requires: ['solro_dead'], grants: ['fennin_dead', 'globe_loot'], verified: true, note: 'Opened from the Sol Ro tower after Solusek Ro' },
  // Time
  { key: 'time',       name: 'Plane of Time',         short: 'Time',       tier: 5, col: 2, requires: ['time_1'], grants: ['quarm_dead'], verified: true, note: 'Level 65 too. Phases I–VI' },
];

export const POP_ZONE_BY_KEY: Record<string, PopNode> =
  Object.fromEntries(POP_ZONES.map(z => [z.key, z]));

export const TIER_LABELS: Record<number, { name: string; sub: string }> = {
  1: { name: 'Tier One',   sub: 'Open at 46' },
  2: { name: 'Tier Two',   sub: 'Flag required; no level bypass on Quarm' },
  3: { name: 'Tier Three', sub: 'Flag required; no level bypass on Quarm' },
  4: { name: 'Tier Four — Elemental', sub: 'Maelin\'s power-source step' },
  5: { name: 'Plane of Time', sub: 'The time flag and level 65' },
};

// The six Justice trial marks (items from each trial's last mob) and the Mark of Justice the Tribunal
// hands over once all six are held. Ids from eqemu_items; the Tribunal counts exactly these
// (pojustice/The_Tribunal.lua FindMarks). "Mark of Stone" also names an unrelated item elsewhere, so
// a looted mark only counts from the Plane of Justice (zone 201).
export const JUSTICE_MARKS = [
  { id: 31842, name: 'Mark of Execution',   trial: 'Execution' },
  { id: 31796, name: 'Mark of Flame',       trial: 'Flame' },
  { id: 31846, name: 'Mark of Suffocation', trial: 'Hanging' },
  { id: 31960, name: 'Mark of Lashing',     trial: 'Lashing' },
  { id: 31845, name: 'Mark of Stone',       trial: 'Stoning' },
  { id: 31844, name: 'Mark of Torture',     trial: 'Torture' },
] as const;
export const MARK_OF_JUSTICE = { id: 31599, name: 'The Mark of Justice' } as const;

export function zoneAccess(zone: PopNode, flags: Set<string>): boolean {
  return zone.requires.every(f => flags.has(f));
}

// Flags a character is missing for a zone.
export function missingFor(zone: PopNode, flags: Set<string>): string[] {
  return zone.requires.filter(f => !flags.has(f));
}
