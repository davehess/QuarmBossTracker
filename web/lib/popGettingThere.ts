// "Getting there": one plain line per Planes of Power zone, built from the cited routes in popTravel.ts, for the
// PoP guide's ?v=b layout (the guild lead, 2026-10-29: "take the paths we know and build that into the plan").
//
// popTravel.ts is ~90 KB of citations (every hop carries its `src` and `unverified`). None of that reaches the
// browser: the page calls guideGettingThere() on the server and ships only the finished sentences. The wording below
// is a summary of each hop's `gate` and `note`; a gate that popTravel marks `unverified` is worded as the data words
// it, never firmer. Every hop a forward route uses MUST have a phrase here (test/pop-getting-there.test.js).
//
// Mechanics come from the scripts and the database, never a guide (the guild lead, 2026-10-21): this file adds no
// fact of its own, so a change to a route in popTravel.ts is a change to the line.

import { FORWARD_ROUTES, type HopId, type PopZone } from './popTravel';
import { GUIDE_ITEMS, type GuideItem } from './popGuide';

export type { GettingThere, GuideGettingThere } from './popGettingThereRuns';
export { startsOfRuns } from './popGettingThereRuns';
import type { GettingThere, GuideGettingThere } from './popGettingThereRuns';

/**
 * How one hop reads. `go` is what you click or walk into, in order (the book is two words: the book, then where it
 * lands). `need` is what stops you, in the guide's own flag words ("Mavuin 3" is the flag at level 3).
 */
const PHRASE: Partial<Record<HopId, { go: string[]; need?: string }>> = {
  pok_tranq: { go: ['PoK book', 'Tranquility'] },
  tranq_disease: { go: ['Disease zone line'] },
  tranq_nightmare: { go: ['Nightmare portal'] },
  nightmare_lair: { go: ['Lair portal'], need: 'needs Thelin 2 or more' },
  tranq_justice: { go: ['Justice portal'] },
  tranq_innov: { go: ['Innovation portal'] },
  tranq_valor: { go: ['Valor portal'], need: 'needs Mavuin 3' },
  tranq_storms: { go: ['Storms portal'], need: 'needs Mavuin 3' },
  disease_codecay: { go: ['the drop by Grummus into the Crypt'], need: 'needs the Grummus flag' },
  tranq_codecay: { go: ['Crypt portal'], need: 'works after your first trip in' },
  tranq_torment: { go: ['Torment portal'], need: 'needs Fuirstel 5 and Thelin 4' },
  valor_hoh: { go: ['Valor underground tunnel portal'], need: 'needs the Aerin`Dar flag' },
  tranq_hoh: { go: ['Halls of Honor portal'], need: 'works after your first trip in' },
  hoh_marr: { go: ['Temple of Marr portal'], need: 'needs all three trials' },
  storms_bot: { go: ['Storms shrine'], need: 'needs Karana 2 and Mavuin 3, or Karana 3 already' },
  tranq_bot: { go: ['Bastion portal'], need: 'needs Karana 3' },
  tranq_tactics: { go: ['Drunder portal'], need: 'needs Zeks 2' },
  tranq_solro: { go: ['Solusek Ro Tower portal'], need: 'needs the cipher and Zeks 6' },
  solro_chamber: { go: ['lava runes up to Solusek Ro'], need: 'needs all five wings and Zeks 7' },
  solro_fire: { go: ['Lava Well of Ro'], need: 'needs the second Fire flag' },
  tranq_fire: { go: ['Fire portal'], need: 'works after your first trip in' },
  tranq_air: { go: ['Air portal'], need: 'needs Zebuxoruk 2' },
  tranq_water: { go: ['Water portal'], need: 'needs Zebuxoruk 2' },
  tranq_earth: { go: ['Earth portal'], need: 'needs Zebuxoruk 2' },
  earth_earthb: { go: ['second-area portal'], need: 'needs the Earth key flag' },
  innov_time: { go: ['time machine'], need: 'needs Zebuxoruk 2 and the Quintessence in your bags' },
  tranq_time: { go: ['Time portal'], need: 'level 65, works after your first trip in' },
  time_timeb: { go: ['dial portals'], need: 'level 65, raid of 7 or more' },
};

/** Every hop id a forward route uses, so a test can hold the table above to it. */
export function routeHopIds(): HopId[] {
  return [...new Set(FORWARD_ROUTES.flatMap(r => r.hops))];
}
export function hasPhrase(id: HopId): boolean {
  return !!PHRASE[id];
}

const say = (id: HopId): string => {
  const p = PHRASE[id];
  if (!p) return id; // the test fails on a missing phrase; a visible id beats a blank in the meantime
  return p.go.join(' → ') + (p.need ? ` (${p.need})` : '');
};

/**
 * The line for a zone: the first-visit route, and, where popTravel has one, the repeat-visit shortcut as a second
 * line that starts after the hops the two routes share. null for the Plane of Knowledge itself.
 */
export function gettingThere(zone: PopZone): GettingThere | null {
  const main = FORWARD_ROUTES.find(r => r.to === zone && !r.alt);
  if (!main) return null;
  const out: GettingThere = { main: main.hops.map(say).join(' → ') };
  const alt = FORWARD_ROUTES.find(r => r.to === zone && r.alt);
  if (alt) {
    let n = 0;
    while (n < alt.hops.length && alt.hops[n] === main.hops[n]) n++;
    const tail = alt.hops.slice(n).map(say);
    // The alternative always begins in Tranquility, one hop past the shared book.
    if (tail.length) out.alt = `Repeat visits: Tranquility's ${tail.join(' → ')}`;
  }
  return out;
}

// ── which zone a guide step needs you in ──────────────────────────────────────────────────────────────────────
// A step's `/pop?zone=` link names its flag chart zone; the keys differ from the server's short names.
const LINK_ZONE: Record<string, PopZone> = {
  disease: 'podisease', justice: 'pojustice', innovation: 'poinnovation', ponb: 'nightmareb', cod: 'codecay',
  codb: 'codecay', storms: 'postorms', valor: 'povalor', torment: 'potorment', bot: 'bothunder', hoh: 'hohonora',
  tactics: 'potactics', solro: 'solrotower', fire: 'pofire', air: 'poair', water: 'powater', earth: 'poeartha',
  poeb: 'poearthb', time: 'potimea',
};
// The NPC zones popGuide's `where` rows use, where one is a Planes of Power zone. `droga` is not.
const WHERE_ZONE: Record<string, PopZone> = {
  poknowledge: 'poknowledge', potranquility: 'potranquility', pojustice: 'pojustice', poinnovation: 'poinnovation',
  postorms: 'postorms', bothunder: 'bothunder', hohonora: 'hohonora', ponightmare: 'ponightmare', codecay: 'codecay',
  povalor: 'povalor', solrotower: 'solrotower',
};
/** Steps with neither a zone link nor a placed NPC, where the step's own title says which zone it is in. */
const STEP_ZONE: Record<string, PopZone> = {
  valor_zone_hoh: 'povalor', torment_sphere: 'potorment', air_key: 'poair', earth_key: 'poeartha',
};

/** The zone a step is done in: its override, else its flag-chart link, else its first placed NPC; null when it has none. */
export function stepZone(item: Pick<GuideItem, 'key' | 'link' | 'where'>): PopZone | null {
  if (STEP_ZONE[item.key]) return STEP_ZONE[item.key];
  const lz = /^\/pop\?zone=([a-z]+)$/.exec(item.link?.href ?? '')?.[1];
  if (lz && LINK_ZONE[lz]) return LINK_ZONE[lz];
  for (const w of item.where ?? []) if (WHERE_ZONE[w.zone]) return WHERE_ZONE[w.zone];
  return null;
}

/** What the beta layout needs, as plain strings. This is the only thing that crosses to the browser. */
export function guideGettingThere(items: GuideItem[] = GUIDE_ITEMS): GuideGettingThere {
  const steps: Record<string, string> = {};
  const lines: Record<string, GettingThere> = {};
  for (const i of items) {
    const z = stepZone(i);
    if (!z) continue;
    steps[i.key] = z;
    const l = gettingThere(z);
    if (l) lines[z] = l;
  }
  return { steps, lines };
}
