// PoP zone/flag catalog — DRAFT, pre-built for the 2026-10-01 unlock.
// ⚠ Verify every edge against wiki.takp.info/index.php/Planes_of_Power_progression
// and takp.info/flag-check before launch — those sources were network-blocked
// from the dev sandbox when this was written, so edges marked verified:false
// are from memory of the classic flowchart and WILL contain mistakes.
// Corrections are data-only edits here + in the bot's POP_FLAG_BY_BOSS map
// (index.js — keep in sync). flag_key 'unmapped' rows on /pop mean the bot
// saw a grant it couldn't attribute — those are the catalog's TODO list.

export type PopZone = {
  key: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  requires: string[];      // flag_keys — ALL required (empty = open)
  verified: boolean;
};

export const POP_FLAGS: Record<string, string> = {
  trial_justice:  'PoJustice trial complete',
  cod_access:     'Crypt of Decay access (Grummus)',
  hoh_access:     'Halls of Honor access (Aerin`Dar)',
  tactics_access: 'Plane of Tactics access (Terris Thule)',
  mb_dead:        'Manaetic Behemoth (PoInnovation)',
  saryrn_dead:    'Saryrn (PoTorment)',
  bert_dead:      'Bertoxxulous (Crypt of Decay)',
  marr_dead:      'Mithaniel Marr (Temple of Marr)',
  agnarr_dead:    'Agnarr (Bastion of Thunder)',
  earth_access:   'Plane of Earth access (Rallos Zek)',
  fire_access:    'Doomfire access (Solusek Ro)',
  fennin_dead:    'Fennin Ro (Doomfire)',
  coirnav_dead:   'Coirnav (Reef of Coirnav)',
  rathe_dead:     'Rathe Council (PoEarth)',
  xegony_dead:    'Xegony (PoAir)',
  time_complete:  'Plane of Time (Quarm)',
  unmapped:       'Unattributed flag grant',
};

export const POP_ZONES: PopZone[] = [
  { key: 'tranquility', name: 'Plane of Tranquility', tier: 1, requires: [], verified: true },
  { key: 'justice',     name: 'Plane of Justice',     tier: 1, requires: [], verified: true },
  { key: 'disease',     name: 'Plane of Disease',     tier: 1, requires: [], verified: true },
  { key: 'innovation',  name: 'Plane of Innovation',  tier: 1, requires: [], verified: true },
  { key: 'nightmare',   name: 'Plane of Nightmare',   tier: 1, requires: [], verified: true },
  { key: 'storms',      name: 'Plane of Storms',      tier: 2, requires: [], verified: false },
  { key: 'torment',     name: 'Plane of Torment',     tier: 2, requires: [], verified: false },
  { key: 'valor',       name: 'Plane of Valor',       tier: 2, requires: ['trial_justice'], verified: false },
  { key: 'cod',         name: 'Crypt of Decay',       tier: 2, requires: ['cod_access'], verified: false },
  { key: 'terris',      name: 'Lair of Terris Thule', tier: 2, requires: [], verified: false },
  { key: 'hoh',         name: 'Halls of Honor',       tier: 3, requires: ['hoh_access'], verified: false },
  { key: 'tactics',     name: 'Plane of Tactics',     tier: 3, requires: ['tactics_access'], verified: false },
  { key: 'bot',         name: 'Bastion of Thunder',   tier: 3, requires: [], verified: false },
  { key: 'solro',       name: 'Tower of Solusek Ro',  tier: 3, requires: [], verified: false },
  { key: 'fire',        name: 'Doomfire (PoFire)',    tier: 4, requires: ['fire_access'], verified: false },
  { key: 'earth',       name: 'Plane of Earth',       tier: 4, requires: ['earth_access'], verified: false },
  { key: 'water',       name: 'Reef of Coirnav',      tier: 4, requires: [], verified: false },
  { key: 'air',         name: 'Plane of Air',         tier: 4, requires: [], verified: false },
  { key: 'time',        name: 'Plane of Time',        tier: 4,
    requires: ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead'], verified: false },
];

export function zoneAccess(zone: PopZone, flags: Set<string>): boolean {
  return zone.requires.every(f => flags.has(f));
}
