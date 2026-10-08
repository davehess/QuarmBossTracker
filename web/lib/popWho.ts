// Which PoP flags a /who sighting proves (the guild lead, 2026-10-01: "from /who in the zone for users
// that don't have mimic, and if they're in that zone that requires other zones we should note it").
//
// /who all prints every visible player's zone, and any raider's Mimic uploads it (who_observations), so
// this reaches characters whose owners never run Mimic. Being IN a flagged plane means the character
// passed that plane's gate, and the gate of every plane on the way in: someone in the Bastion of Thunder
// came through Storms (the Justice flag) and touched the shrine (Askr's talisman). A flag a gate step
// proves follows the bot's STAGE_IMPLIES (utils/popFlagStages.js; test/pop-who.test.js keeps the two in
// step). A kill or trial happens inside its plane, so it proves that plane's way in as well.
//
// What it does not count: a plane's instanced copy shows on /who under another name ("… (Instanced)"),
// and a GM is skipped by the query (pop_who_sightings). It only ever adds flags, never takes one away.
// Loot in a plane (pop_loot_sightings) proves the same flags, at the bottom of this file.
// Pure, so the rules are testable without a database.

import { POP_FLAGS, POP_ZONE_BY_KEY } from './popFlags';

// A /who zone → the chart's zone key, for the planes behind a gate. Two spellings reach the table:
// `/who all` puts the server's short name on each row, and a plain /who (your own zone, the one most
// people type) names it once in its footer, which the agent uploads lower-cased (agent 3.7.62; the
// guild lead, 2026-10-01: "using /who all doesn't give us who is in my current zone"). The long names
// are eqemu_zone's. The lower Crypt of Decay is the same zone as the upper, and Ragrax shares
// "Plane of Earth" with the plane above it, so those prove only the outer gate.
export const WHO_ZONE: Record<string, string> = {
  postorms: 'storms', povalor: 'valor', codecay: 'cod', nightmareb: 'ponb', potorment: 'torment',
  bothunder: 'bot', hohonora: 'hoh', hohonorb: 'hohb', potactics: 'tactics', solrotower: 'solro',
  poeartha: 'earth', poearthb: 'poeb', poair: 'air', powater: 'water', pofire: 'fire',
  potimea: 'time', potimeb: 'time',
  'plane of storms': 'storms', 'plane of valor': 'valor', 'the crypt of decay': 'cod',
  'the lair of terris thule': 'ponb', 'torment, the plane of pain': 'torment', 'bastion of thunder': 'bot',
  'halls of honor': 'hoh', 'temple of marr': 'hohb', 'drunder, the fortress of zek': 'tactics',
  'tower of solusek ro': 'solro', 'plane of earth': 'earth', 'plane of air': 'air', 'plane of water': 'water',
  'plane of fire': 'fire', 'plane of time': 'time',
};
export const WHO_ZONE_NAMES = Object.keys(WHO_ZONE);

// The plane you must come through to reach another (its door is inside that plane, not in Tranquility),
// for saying so on the page. whoProves does not need it (see there).
export const WAY_IN: Record<string, string> = {
  cod: 'disease', codb: 'cod', ponb: 'nightmare', hoh: 'valor', hohb: 'hoh', bot: 'storms', poeb: 'earth', fire: 'solro',
};

// What each server step in a gate proves (the bot's STAGE_IMPLIES for the same keys).
export const GATE_IMPLIES: Record<string, string[]> = {
  fuirstel_5: ['grummus_dead', 'bert_dead'],
  thelin_4: ['hedge_event', 'tthule_dead'],
  cipher_1: ['saryrn_dead', 'marr_dead'],
  zeks_6: ['behemoth_dead', 'vallon_dead', 'tallon_dead'],
  zebuxoruk_2: ['askr_quest', 'agnarr_dead', 'marr_dead'],
  time_1: ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead'],
};

// The planes a character came through to stand in `zoneKey`, nearest first.
export function wayInChain(zoneKey: string): string[] {
  const out: string[] = [];
  for (let z = WAY_IN[zoneKey]; z && !out.includes(z); z = WAY_IN[z]) out.push(z);
  return out;
}

// Every catalog flag a character standing in `zoneKey` must hold. The planes on the way in need no
// step of their own: a gate flag is earned inside the plane before it (Thunder's shrine is in Storms),
// so following each flag to its zone already walks the way in.
export function whoProves(zoneKey: string): string[] {
  const flags = new Set<string>();
  const zones = new Set<string>();
  const addZone = (z: string) => {
    if (zones.has(z)) return;
    zones.add(z);
    for (const f of POP_ZONE_BY_KEY[z]?.requires ?? []) addFlag(f);
  };
  const addFlag = (f: string) => {
    if (flags.has(f)) return;
    flags.add(f);
    if (GATE_IMPLIES[f]) { for (const g of GATE_IMPLIES[f]) addFlag(g); return; }
    const z = POP_FLAGS[f]?.zone;
    if (z) addZone(z);
  };
  addZone(zoneKey);
  return [...flags];
}

export type Sighting = { zone: string; first_seen: string; last_seen: string };
// One flag proven by /who: the plane the character was seen in (chart key) and the first time.
export type WhoProof = { flag: string; zone: string; at: string };

// Flags proven by a character's sightings, each by its earliest one.
export function flagsFromSightings(rows: Sighting[]): Map<string, WhoProof> {
  const out = new Map<string, WhoProof>();
  const sorted = rows.filter(r => WHO_ZONE[r.zone]).sort((a, b) => a.first_seen.localeCompare(b.first_seen));
  for (const r of sorted) {
    const zone = WHO_ZONE[r.zone];
    for (const flag of whoProves(zone)) if (!out.has(flag)) out.set(flag, { flag, zone, at: r.first_seen });
  }
  return out;
}

// "Bastion of Thunder, reached through Plane of Storms": where a proof was, for the sentences below.
function placeText(zoneKey: string): string {
  const name = POP_ZONE_BY_KEY[zoneKey]?.name ?? zoneKey;
  const via = wayInChain(zoneKey).map(z => POP_ZONE_BY_KEY[z]?.name ?? z);
  return `${name}${via.length ? `, reached through ${via.join(' and ')}` : ''}`;
}

// "Seen on /who in the Bastion of Thunder, reached through the Plane of Storms."
export function seenText(zoneKey: string): string {
  return `Seen on /who in ${placeText(zoneKey)}.`;
}

// Loot is presence proof too (the guild lead, 2026-10-03: "if anyone has looted any distinct items from any
// of the planes we should go through and flag them up to that plane"). A character that looted something
// inside a plane stood in it, so it holds exactly what a /who sighting there proves. The rows come from
// pop_loot_sightings, which names the plane by the same short names WHO_ZONE keys (a test keeps the SQL's
// list and this table's in step), so they run through flagsFromSightings itself: one rule for what a
// plane proves, instanced copies and open planes ignored the same way.
//   'looted'    the character's own "--You have looted <item>.--" in that plane;
//   'inventory' a NO DROP item that drops only in that plane, in an uploaded inventory.
export type LootSighting = {
  zone: string; first_at: string; last_at: string; items: number; sample_item: string | null; source: 'looted' | 'inventory';
};
// One flag proven by loot: the plane (chart key), the first time, and which kind of proof it was.
export type LootProof = WhoProof & { source: LootSighting['source'] };

// Flags proven by a character's loot, each by its earliest row.
export function flagsFromLoot(rows: LootSighting[]): Map<string, LootProof> {
  const out = new Map<string, LootProof>();
  const proven = flagsFromSightings(rows.map(r => ({ zone: r.zone, first_seen: r.first_at, last_seen: r.last_at })));
  for (const [flag, p] of proven) {
    const row = rows.find(r => WHO_ZONE[r.zone] === p.zone && r.first_at === p.at);
    out.set(flag, { ...p, source: row?.source ?? 'looted' });
  }
  return out;
}

// "Looted in Bastion of Thunder, reached through Plane of Storms."
export function lootText(zoneKey: string, source: LootSighting['source'] = 'looted'): string {
  return source === 'inventory'
    ? `Holds a NO DROP item that drops only in ${placeText(zoneKey)}.`
    : `Looted in ${placeText(zoneKey)}.`;
}
