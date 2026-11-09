// web/lib/eventSplitsDefs.ts — the key moments of each scripted PoP event, for gold splits (DECISIONS §555).
//
// An ATTEMPT is one run of an event found in the encounter data. Its SPLITS are the event's key moments in order. A
// moment is matched by npc ids from the event's own mobs (web/lib/popEvents.ts):
//   start  the moment the run began (a death, or the first engage of a mob)
//   kill   a named or boss death (or an engage, for a fight that is its own landmark)
//   end    the final boss death; reaching it is what makes an attempt a success
// `time` says which edge of the encounter row the moment sits on: 'death' (ended_at, a kill) or 'engage'
// (started_at, a pull; a wipe still counts as an engage).
// Moments that share a `group` are UNORDERED: whichever dies first takes the first slot, so a run that kills the minis
// in another order still lines up slot for slot with the rest. `npcIds: 'any'` on a start means the first encounter of
// ANY of the event's mobs (the event has no single trigger mob we can see).
//
// Five elemental events are explicit; every other event gets the generic default (genericDef): the start is the first
// engage of any of its mobs (an engage, not a death, so the first segment is a real fight time), the kills are its named mobs' deaths in the order they happen, the last of them is the end.
// Public catalog data only: nothing here names a member.

import { eventBySlug, type PopEvent } from './popEvents';

export type MomentKind = 'start' | 'kill' | 'end';

export type Moment = {
  key: string;
  label: string;
  kind: MomentKind;
  npcIds: number[] | 'any';
  time?: 'death' | 'engage';
  group?: string;
};

export type SplitsDef = {
  slug: string;
  moments: Moment[];
  /** The generic default: success means at least one named death after the start, and the last one is the end. */
  generic?: boolean;
  /** Labels for the groups' slots: slot i reads `${groupLabels[group]} ${i + 1}`. */
  groupLabels: Record<string, string>;
};

const m = (key: string, label: string, kind: MomentKind, npcIds: number[] | 'any', extra: Partial<Moment> = {}): Moment =>
  ({ key, label, kind, npcIds, ...extra });

/** A mob is "named" when a run kills it at most three times and its name is capitalised ("elite guardian of ro" is trash). */
export function isNamed(n: PopEvent['npcs'][number]): boolean {
  return (n.kills ?? 1) <= 3 && /^[A-Z]/.test(n.name);
}

export function genericDef(e: PopEvent): SplitsDef {
  const named = e.npcs.filter(isNamed);
  const ids = named.map(n => n.npcId);
  const slots = Math.min(12, named.reduce((s, n) => s + (n.kills ?? 1), 0));
  const moments: Moment[] = [m('start', 'First engage', 'start', 'any', { time: 'engage' })];
  for (let i = 0; i < slots; i++) moments.push(m(`named${i + 1}`, `Named death ${i + 1}`, 'kill', ids, { group: 'named' }));
  return { slug: e.slug, moments, generic: true, groupLabels: { named: 'Named death' } };
}

const EXPLICIT: Record<string, SplitsDef> = {
  // Guardian of Coirnav dies (the 15-minute clock starts) -> the three real minibosses in any order -> Coirnav.
  // The 75th fiend is not a row (the fiends are not event mobs), so there is no moment for it.
  'powater-coirnav': {
    slug: 'powater-coirnav',
    groupLabels: { minis: 'Miniboss' },
    moments: [
      m('guardian', 'Guardian of Coirnav', 'start', [216053]),
      m('pwelon', 'Pwelon of Vapor', 'kill', [216236], { group: 'minis' }),
      m('nrinda', 'Nrinda of Ice', 'kill', [216245], { group: 'minis' }),
      m('vamuil', 'Vamuil of Water', 'kill', [216247], { group: 'minis' }),
      m('coirnav', 'Coirnav', 'end', [216048]),
    ],
  },
  // Engage the Guardian of Doomfire -> the four commanders (any order) -> the four council (any order) -> Fennin Ro.
  'pofire-fennin-ro': {
    slug: 'pofire-fennin-ro',
    groupLabels: { commanders: 'Commander', council: 'Council member' },
    moments: [
      m('guardian', 'Guardian of Doomfire engaged', 'start', [217050], { time: 'engage' }),
      m('azobian', 'Azobian the Darklord', 'kill', [217425], { group: 'commanders' }),
      m('javonn', 'Javonn the Overlord', 'kill', [217426], { group: 'commanders' }),
      m('hebabbilys', 'Hebabbilys the Ragelord', 'kill', [217453], { group: 'commanders' }),
      m('reaxnous', 'Reaxnous the Chaoslord', 'kill', [217427], { group: 'commanders' }),
      m('kirtra', 'Chancellor Kirtra', 'kill', [217432], { group: 'council' }),
      m('traxom', 'Chancellor Traxom', 'kill', [217433], { group: 'council' }),
      m('crato', 'Omni Magus Crato', 'kill', [217429], { group: 'council' }),
      m('prollaz', 'Warlord Prollaz', 'kill', [217428], { group: 'council' }),
      m('fennin', 'Fennin Ro', 'end', [217440]),
    ],
  },
  // The door has no mob: the start is the first Xegony-room fight. The six named waves arrive in random order -> Xegony.
  'poair-xegony': {
    slug: 'poair-xegony',
    groupLabels: { waves: 'Named wave' },
    moments: [
      m('first', 'First fight in the room', 'start', 'any', { time: 'engage' }),
      m('nuquernal', 'Nuquernal Belegrodian', 'kill', [215404], { group: 'waves' }),
      m('wesreh', 'Wesreh Galleantan', 'kill', [215403], { group: 'waves' }),
      m('rindaler', 'Rindaler Egulrtan', 'kill', [215408], { group: 'waves' }),
      m('arbitor', 'An Elemental Arbitor', 'kill', [215406], { group: 'waves' }),
      m('weruis', 'Weruis Herfadban', 'kill', [215407], { group: 'waves' }),
      m('huridaf', 'Huridaf Vorgaasna', 'kill', [215405], { group: 'waves' }),
      m('xegony', 'Xegony', 'end', [215056]),
    ],
  },
  // One mob: the pull and the death.
  'poeartha-mystical-arbitor': {
    slug: 'poeartha-mystical-arbitor',
    groupLabels: {},
    moments: [
      m('engage', 'Arbitor engaged', 'start', [218375], { time: 'engage' }),
      m('arbitor', 'Arbitor of Earth', 'end', [218375]),
    ],
  },
  // The first Rathe Councilman dies -> the Avatar is pulled (the twelve are down) -> the Avatar dies.
  'poearthb-rathe-council-avatar': {
    slug: 'poearthb-rathe-council-avatar',
    groupLabels: {},
    moments: [
      m('council', 'First Rathe Councilman', 'start', [222003, 222039]),
      m('avatar-pull', 'Avatar of Earth engaged', 'kill', [222040], { time: 'engage' }),
      m('avatar', 'Avatar of Earth', 'end', [222040]),
    ],
  },
};

export function splitsDefFor(slug: string): SplitsDef | undefined {
  if (EXPLICIT[slug]) return EXPLICIT[slug];
  const e = eventBySlug(slug);
  return e ? genericDef(e) : undefined;
}

export const EXPLICIT_SLUGS = Object.keys(EXPLICIT);

/** Every npc id a def can match, for the narrow encounters read. */
export function defNpcIds(def: SplitsDef, e: PopEvent): number[] {
  const ids = new Set<number>(e.npcs.map(n => n.npcId));
  for (const mo of def.moments) if (mo.npcIds !== 'any') for (const id of mo.npcIds) ids.add(id);
  return [...ids];
}
