// PoP progression catalog — flags, zones, and the gate graph.
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
  { key: 'trial_justice',  label: 'Justice trial (any of 6)',      kind: 'trial', zone: 'justice',    verified: true,  note: 'Execution, Flame, Hanging, Lashing, Stoning, or Torture + Mavuin hail' },
  { key: 'grummus_dead',   label: 'Kill Grummus',                  kind: 'kill',  zone: 'disease',    verified: true },
  { key: 'behemoth_dead',  label: 'Kill Manaetic Behemoth',        kind: 'kill',  zone: 'innovation', verified: true,  note: 'Zek arc — flags Plane of Tactics (Giwin Mirakon hail)' },
  { key: 'hedge_event',    label: 'Hedge event',                   kind: 'event', zone: 'nightmare',  verified: true,  note: 'Opens the Lair of Terris Thule' },
  // Tier 2
  { key: 'tthule_dead',    label: 'Kill Terris Thule',             kind: 'kill',  zone: 'ponb',       verified: true,  note: 'Flags Plane of Torment (Adroha + Elder Poxbourne hails)' },
  { key: 'aerindar_dead',  label: 'Kill Aerin`Dar',                kind: 'kill',  zone: 'valor',      verified: true,  note: 'Flags Halls of Honor' },
  { key: 'askr_quest',     label: 'Askr the Lost (medallions)',    kind: 'quest', zone: 'storms',     verified: true,  note: 'Giant medallions → Bastion of Thunder' },
  { key: 'carprin_cycle',  label: 'Carprin cycle (5 nameds)',      kind: 'event', zone: 'cod',        verified: false, note: 'Opens lower Crypt (Bertoxxulous). No raid-in' },
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

// The five-flag elemental bundle (classic): every elemental plane requires
// these; Fire additionally requires Solusek Ro.
export const ELEMENTAL_BUNDLE = ['marr_dead', 'agnarr_dead', 'saryrn_dead', 'rallos_dead', 'bert_dead'];

// "Need all six and Keeper" (Samanna chart) — Sol Ro tower entry. Exact
// composition to re-verify against Quarm at launch (data-only fix).
export const SOLRO_GATE = ['tthule_dead', 'bert_dead', 'saryrn_dead', 'keeper_dead', 'marr_dead', 'agnarr_dead'];

// ── Zones (chart nodes) ──────────────────────────────────────────────────────
export const POP_ZONES: PopNode[] = [
  // Tier 1 — open at 46
  { key: 'justice',    name: 'Plane of Justice',      short: 'Justice',    tier: 1, col: 1, requires: [], grants: ['trial_justice'],                verified: true },
  { key: 'innovation', name: 'Plane of Innovation',   short: 'Innovation', tier: 1, col: 2, requires: [], grants: ['behemoth_dead'],                verified: true },
  { key: 'disease',    name: 'Plane of Disease',      short: 'Disease',    tier: 1, col: 3, requires: [], grants: ['grummus_dead'],                 verified: true },
  { key: 'nightmare',  name: 'Plane of Nightmare',    short: 'Nightmare',  tier: 1, col: 4, requires: [], grants: ['hedge_event'],                  verified: true },
  // Tier 2 — classic unflagged entry at 55
  { key: 'storms',     name: 'Plane of Storms',       short: 'Storms',     tier: 2, col: 1, requires: [], grants: ['askr_quest'],                   levelBypass: 55, verified: true, note: 'No flag to enter' },
  { key: 'valor',      name: 'Plane of Valor',        short: 'Valor',      tier: 2, col: 2, requires: ['trial_justice'], grants: ['aerindar_dead'], levelBypass: 55, verified: true },
  { key: 'cod',        name: 'Crypt of Decay',        short: 'Decay',      tier: 2, col: 3, requires: ['grummus_dead'], grants: ['carprin_cycle'],  levelBypass: 55, verified: true },
  { key: 'codb',       name: 'Crypt of Decay (lower)', short: 'Bertoxx',   tier: 2, col: 3, requires: ['carprin_cycle'], grants: ['bert_dead'],     subZoneOf: 'cod', verified: false, note: 'No raid-in' },
  { key: 'ponb',       name: 'Lair of Terris Thule',  short: 'T. Thule',   tier: 2, col: 4, requires: ['hedge_event'], grants: ['tthule_dead'],     levelBypass: 55, verified: true },
  { key: 'torment',    name: 'Plane of Torment',      short: 'Torment',    tier: 2, col: 5, requires: ['tthule_dead'], grants: ['keeper_dead', 'saryrn_dead'], levelBypass: 55, verified: true },
  // Tier 3 — classic unflagged entry at 62
  { key: 'bot',        name: 'Bastion of Thunder',    short: 'Thunder',    tier: 3, col: 1, requires: ['askr_quest'], grants: ['agnarr_dead'],      levelBypass: 62, verified: true },
  { key: 'hoh',        name: 'Halls of Honor',        short: 'Honor',      tier: 3, col: 2, requires: ['aerindar_dead'], grants: ['hoh_trials'],    levelBypass: 62, verified: true },
  { key: 'hohb',       name: 'Temple of Marr',        short: 'M. Marr',    tier: 3, col: 2, requires: ['hoh_trials'], grants: ['marr_dead'],        subZoneOf: 'hoh', verified: false },
  { key: 'tactics',    name: 'Plane of Tactics',      short: 'Tactics',    tier: 3, col: 3, requires: ['behemoth_dead'], grants: ['tallon_dead', 'vallon_dead', 'rallos_dead'], levelBypass: 62, verified: true },
  { key: 'solro',      name: 'Tower of Solusek Ro',   short: 'Sol Ro',     tier: 3, col: 4, requires: SOLRO_GATE, grants: ['solro_minis', 'solro_dead'], levelBypass: 62, verified: false, note: '“All six and Keeper” — verify exact set at launch' },
  // Tier 4 — elementals, no level bypass
  { key: 'earth',      name: 'Plane of Earth',        short: 'Earth',      tier: 4, col: 1, requires: [...ELEMENTAL_BUNDLE], grants: ['arbitor_dead'], verified: false, note: '4 rings + Arbitor open Ragrax' },
  { key: 'poeb',       name: 'Ragrax, Stronghold of the Twelve', short: 'Ragrax', tier: 4, col: 1, requires: ['arbitor_dead'], grants: ['rathe_dead', 'stone_loot'], subZoneOf: 'earth', verified: false, note: 'No raid-in' },
  { key: 'air',        name: 'Eryslai, the Kingdom of Wind', short: 'Air', tier: 4, col: 2, requires: [...ELEMENTAL_BUNDLE], grants: ['avatars_air', 'xegony_dead', 'cloud_loot'], verified: true },
  { key: 'water',      name: 'Reef of Coirnav',       short: 'Water',      tier: 4, col: 3, requires: [...ELEMENTAL_BUNDLE], grants: ['coirnav_dead', 'sphere_loot'], verified: true },
  { key: 'fire',       name: 'Doomfire, the Burning Lands', short: 'Fire', tier: 4, col: 4, requires: [...ELEMENTAL_BUNDLE, 'solro_dead'], grants: ['fennin_dead', 'globe_loot'], verified: true },
  // Time
  { key: 'time',       name: 'Plane of Time',         short: 'Time',       tier: 5, col: 2, requires: ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead'], grants: ['quarm_dead'], verified: true, note: 'Phases I–VI; classic alt: raid-gimp-in + Quintessence' },
];

export const POP_ZONE_BY_KEY: Record<string, PopNode> =
  Object.fromEntries(POP_ZONES.map(z => [z.key, z]));

export const TIER_LABELS: Record<number, { name: string; sub: string }> = {
  1: { name: 'Tier One',   sub: 'Open at 46' },
  2: { name: 'Tier Two',   sub: 'Classic: 55 if unflagged' },
  3: { name: 'Tier Three', sub: 'Classic: 62 if unflagged' },
  4: { name: 'Tier Four — Elemental', sub: 'No level-based entry' },
  5: { name: 'Plane of Time', sub: 'All four elemental god flags' },
};

export function zoneAccess(zone: PopNode, flags: Set<string>): boolean {
  return zone.requires.every(f => flags.has(f));
}

// Flags a character is missing for a zone.
export function missingFor(zone: PopNode, flags: Set<string>): string[] {
  return zone.requires.filter(f => !flags.has(f));
}
