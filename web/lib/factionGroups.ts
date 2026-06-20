// Faction bloc catalog — groups factions next to the ones you typically see
// together, because faction hits come in opposing PAIRS: killing one side of
// a war raises the other. Displaying "Kromzek −400 hits" right next to
// "Claws of Veeshan +400 hits" is how a player actually reasons about their
// standing ("I'm grinding CoV by killing Kael").
//
// Each bloc also carries a MEMBER catalog: the canonical factions of that
// war. Members with no recorded hits yet render as "?" rows with an
// ESTIMATED base standing from race/class. The estimates are coarse,
// race-first heuristics — real base faction is race+class+deity dependent
// and we don't capture deity yet (characters table has class/race only), so
// every estimate is labeled "est." with that caveat. Refine per faction as
// members report mismatches; this is display-only data.
//
// Matching is keyword-regex on the faction string straight from the log
// ("Your faction standing with <X> ...") — server spellings vary (backtick
// vs apostrophe possessives, e.g. Ry`Gorr / Ry'Gorr), so keep patterns
// tolerant. First matching group wins; anything unmatched lands in "Other".

export type Standing =
  | 'ally' | 'warmly' | 'kindly' | 'amiably' | 'indifferently'
  | 'apprehensively' | 'dubiously' | 'threateningly' | 'scowls';

export type BaseCtx = { race: string | null; cls: string | null };

export type FactionMember = {
  name: string;            // canonical display name
  match: RegExp;           // matches the log's faction string
  base: (ctx: BaseCtx) => Standing;
};

export type FactionGroup = {
  key: string;
  label: string;
  hint: string;            // one-liner explaining the see-saw
  match: RegExp;           // bloc-level catch-all for recorded rows
  members: FactionMember[];
};

const EVIL_RACES = ['dark elf', 'troll', 'ogre', 'iksar'];
const isEvil  = (c: BaseCtx) => !!c.race && EVIL_RACES.some(r => c.race!.toLowerCase().includes(r));
const isRace  = (c: BaseCtx, r: string) => !!c.race && c.race.toLowerCase().includes(r);
// Necromancers / Shadow Knights eat a tier with good-aligned factions even
// on neutral races — the classic "your guild trains on you" effect.
const isDarkClass = (c: BaseCtx) => !!c.cls && /necromancer|shadow ?knight/i.test(c.cls);

// Everyone-KOS factions (raid blocs, monster cities).
const KOS = (): Standing => 'scowls';

export const FACTION_GROUPS: FactionGroup[] = [
  {
    key: 'velious-war',
    label: 'Velious — the war',
    hint: 'Coldain + dragons vs the Kael giants — kills on one side swing the others.',
    match: /coldain|dain frostreaver|claws of veeshan|yelinak|kael|kromzek|kromrif|king tormax|ulthork|ry[`']?gorr/i,
    members: [
      { name: 'Coldain',             match: /^coldain/i,          base: c => isRace(c, 'dwarf') ? 'kindly' : (isEvil(c) || isDarkClass(c)) ? 'dubiously' : 'indifferently' },
      { name: 'Dain Frostreaver IV', match: /dain frostreaver/i,  base: c => isRace(c, 'dwarf') ? 'amiably' : (isEvil(c) || isDarkClass(c)) ? 'dubiously' : 'indifferently' },
      { name: 'Claws of Veeshan',    match: /claws of veeshan/i,  base: () => 'apprehensively' },
      { name: 'Yelinak',             match: /yelinak/i,           base: () => 'apprehensively' },
      { name: 'Kromzek (Kael)',      match: /kromzek|kael/i,      base: KOS },
      { name: 'Kromrif',             match: /kromrif/i,           base: KOS },
      { name: 'King Tormax',         match: /king tormax/i,       base: KOS },
      { name: 'Ry`Gorr Clan',        match: /ry[`']?gorr/i,       base: KOS },
      { name: 'Ulthork',             match: /ulthork/i,           base: KOS },
    ],
  },
  {
    key: 'luclin-war',
    label: 'Luclin — Seru vs Katta',
    hint: 'Sanctus Seru legionnaires vs Katta Castellum — the moon’s cold war.',
    match: /seru|katta|concillium|magus conlegium|validus custodus|coterie/i,
    members: [
      { name: 'Citizens of Seru',    match: /citizens of seru|^seru\b|hand of seru|eye of seru|heart of seru|shoulders of seru/i, base: () => 'apprehensively' },
      { name: 'Validus Custodus',    match: /validus custodus/i,  base: () => 'apprehensively' },
      { name: 'Katta Castellum',     match: /katta/i,             base: () => 'apprehensively' },
      { name: 'Concillium Universus', match: /concillium/i,       base: () => 'apprehensively' },
      { name: 'Magus Conlegium',     match: /magus conlegium/i,   base: () => 'apprehensively' },
      { name: 'Coterie of the Eternal Night', match: /coterie/i,  base: KOS },
    ],
  },
  {
    key: 'shar-vahl',
    label: 'Luclin — Shar Vahl',
    hint: 'Vah Shir city factions — hits usually land together from Hollowshade / Grimling runs.',
    match: /vah shir|shar vahl|khala dun|taruun|jharin|dar khura|grimling/i,
    members: [
      { name: 'Shar Vahl (city)',    match: /shar vahl|vah shir/i, base: c => isRace(c, 'vah shir') ? 'warmly' : 'indifferently' },
      { name: 'Khala Dun',           match: /khala dun/i,          base: c => isRace(c, 'vah shir') ? 'kindly' : 'indifferently' },
      { name: 'Taruun',              match: /taruun/i,             base: c => isRace(c, 'vah shir') ? 'kindly' : 'indifferently' },
      { name: 'Jharin',              match: /jharin/i,             base: c => isRace(c, 'vah shir') ? 'kindly' : 'indifferently' },
      { name: 'Dar Khura',           match: /dar khura/i,          base: c => isRace(c, 'vah shir') ? 'kindly' : 'indifferently' },
      { name: 'Grimlings',           match: /grimling/i,           base: KOS },
    ],
  },
  {
    key: 'kunark-chardok',
    label: 'Kunark — Sarnaks vs the goblin mines',
    hint: 'Chardok’s Di`Zok sarnaks vs the Nurga/Droga goblins.',
    match: /sarnak|di[`']?zok|chardok|mountain death|nurga|droga|frontier mountain/i,
    members: [
      { name: 'Brood of Di`Zok (Chardok)', match: /di[`']?zok|chardok/i, base: KOS },
      { name: 'Sarnak Collective',   match: /sarnak collective/i,  base: KOS },
      { name: 'Goblins of Mountain Death (Nurga/Droga)', match: /mountain death|nurga|droga/i, base: KOS },
    ],
  },
  {
    key: 'kunark-cabilis',
    label: 'Kunark — Cabilis',
    hint: 'Iksar city factions — quest turn-ins and outskirts kills move these as a set.',
    match: /cabilis|crusaders of greenmist|scaled mystics|swift tails|brood of kotiz/i,
    members: [
      { name: 'Legion of Cabilis',   match: /legion of cabilis|cabilis residents/i, base: c => isRace(c, 'iksar') ? 'amiably' : 'scowls' },
      { name: 'Crusaders of Greenmist', match: /crusaders of greenmist/i, base: c => isRace(c, 'iksar') ? 'indifferently' : 'scowls' },
      { name: 'Scaled Mystics',      match: /scaled mystics/i,     base: c => isRace(c, 'iksar') ? 'indifferently' : 'scowls' },
      { name: 'Swift Tails',         match: /swift tails/i,        base: c => isRace(c, 'iksar') ? 'indifferently' : 'scowls' },
      { name: 'Brood of Kotiz',      match: /brood of kotiz/i,     base: c => isRace(c, 'iksar') ? 'indifferently' : 'scowls' },
    ],
  },
  {
    key: 'kunark-ros',
    label: 'Kunark — Ring of Scale',
    hint: 'Old-world dragons and Venril Sathir’s line.',
    match: /ring of scale|venril sathir|veeshan[`']?s peak/i,
    members: [
      { name: 'Ring of Scale',       match: /ring of scale/i,      base: () => 'apprehensively' },
      { name: 'Venril Sathir',       match: /venril sathir/i,      base: KOS },
    ],
  },
  {
    key: 'planes',
    label: 'Planes — Growth vs Hate',
    hint: 'Tunare’s court vs Innoruuk’s minions — PoG clears tank one and raise the other.',
    match: /of growth|tunare|innoruuk|minions of hate/i,
    members: [
      { name: 'Protectors of Growth', match: /of growth|tunare/i,  base: KOS },
      { name: 'Minions of Innoruuk',  match: /innoruuk|minions of hate/i, base: KOS },
    ],
  },
];

export const OTHER_GROUP: FactionGroup = {
  key: 'other',
  label: 'Other factions',
  hint: 'Not yet mapped to a bloc — tell an officer and we’ll add the grouping.',
  match: /./,
  members: [],
};

export type GroupedFactions<T> = {
  group: FactionGroup;
  rows: T[];
  // Catalog members with NO recorded hits — rendered as "?" rows with the
  // estimated base standing for this character's race/class.
  missing: { name: string; base: Standing }[];
  totalWeight: number;
};

// Bucket recorded rows into catalog order, compute per-bloc missing members.
// Groups sort by total activity (most-ground war on top); blocs with zero
// recorded rows still render (all-"?") so the page doubles as a checklist;
// "Other" always last and never shows missing rows (it has no catalog).
export function groupFactions<T extends { faction: string }>(
  rows: T[],
  weight: (row: T) => number,
  ctx: BaseCtx,
): GroupedFactions<T>[] {
  const buckets = new Map<string, GroupedFactions<T>>();
  const ensure = (group: FactionGroup) => {
    let b = buckets.get(group.key);
    if (!b) { b = { group, rows: [], missing: [], totalWeight: 0 }; buckets.set(group.key, b); }
    return b;
  };
  for (const g of FACTION_GROUPS) ensure(g);
  for (const row of rows) {
    const group = FACTION_GROUPS.find(g => g.match.test(row.faction)) ?? OTHER_GROUP;
    const b = ensure(group);
    b.rows.push(row);
    b.totalWeight += weight(row);
  }
  for (const b of buckets.values()) {
    b.rows.sort((a, z) => weight(z) - weight(a));
    b.missing = b.group.members
      .filter(m => !b.rows.some(r => m.match.test(r.faction)))
      .map(m => ({ name: m.name, base: m.base(ctx) }));
  }
  const out = Array.from(buckets.values())
    .filter(b => b.rows.length > 0 || b.missing.length > 0);
  out.sort((a, z) => {
    if (a.group.key === 'other') return 1;
    if (z.group.key === 'other') return -1;
    return z.totalWeight - a.totalWeight;
  });
  return out;
}
