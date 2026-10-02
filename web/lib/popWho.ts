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
// Pure, so the rules are testable without a database.

import { POP_FLAGS, POP_ZONE_BY_KEY } from './popFlags';

// The server's short name → the chart's zone key, for the planes behind a gate. The lower Crypt of
// Decay is the same zone as the upper, so a sighting there proves only the upper's gate.
export const WHO_ZONE: Record<string, string> = {
  postorms: 'storms', povalor: 'valor', codecay: 'cod', nightmareb: 'ponb', potorment: 'torment',
  bothunder: 'bot', hohonora: 'hoh', hohonorb: 'hohb', potactics: 'tactics', solrotower: 'solro',
  poeartha: 'earth', poearthb: 'poeb', poair: 'air', powater: 'water', pofire: 'fire',
  potimea: 'time', potimeb: 'time',
};
export const WHO_ZONE_SHORTS = Object.keys(WHO_ZONE);

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

// "Seen on /who in the Bastion of Thunder, reached through the Plane of Storms."
export function seenText(zoneKey: string): string {
  const name = POP_ZONE_BY_KEY[zoneKey]?.name ?? zoneKey;
  const via = wayInChain(zoneKey).map(z => POP_ZONE_BY_KEY[z]?.name ?? z);
  return `Seen on /who in ${name}${via.length ? `, reached through ${via.join(' and ')}` : ''}.`;
}
