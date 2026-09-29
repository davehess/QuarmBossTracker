// Essences of Power: the guild's loot queue for the four elemental essences (the guild lead, 2026-09-29).
//
//   "it will be an opendkp bid out for the entire item. this means the guild needs to see the order for
//    who is next on the loot list for those items, and if they're present to get them, if they are not,
//    we would bid out the item again and add to the queue … as long as we bid the item only when we
//    don't have someone in queue we're good … we can see who has which pieces from having bid"
//
// The rules, as code:
//   - One bid buys the whole set. Winning it puts you in the queue, in the order you won.
//   - When an essence drops, it goes to the first person in the queue who does not have that one yet
//     and is in the raid.
//   - Nobody like that there? Bid it again. The winner loots it and joins the end of the queue.
//   - Four pieces and you are done; you leave the queue.
//
// Where it comes from: OpenDKP awards (opendkp_loot, with the raid's date) of any of the four essences or
// of the bid item, plus Mimic seeing someone loot an essence (looted_items). An award with DKP is a bid
// won; 0 DKP is a queued hand-out. Pure — the page reads the rows and hands them in.

export const ESSENCES = [
  { key: 'fire', name: 'Essence of Fire', id: 16262, god: 'Fennin Ro' },
  { key: 'wind', name: 'Essence of Wind', id: 16263, god: 'Xegony' },
  { key: 'water', name: 'Essence of Water', id: 16265, god: 'Coirnav' },
  { key: 'earth', name: 'Essence of Earth', id: 32111, god: 'the Avatar of Earth' },
] as const;
export type EssenceKey = typeof ESSENCES[number]['key'];

// What the bid for the whole set may be entered as in OpenDKP, besides the essence that dropped.
export const BID_ITEM_NAMES = ['Essences of Power', 'Power of the Planes'];

export type Award = { character: string; item: string; dkp: number; at: string | null };
export type Looted = { character: string; item: string; at: string | null };
export type Piece = { key: EssenceKey; source: 'opendkp' | 'mimic'; at: string | null; dkp: number | null };
export type QueueEntry = {
  name: string;
  joinedAt: string | null;
  joinedDkp: number | null;   // the DKP of the first award: > 0 means they joined by winning a bid
  pieces: Partial<Record<EssenceKey, Piece>>;
  done: boolean;
  present: boolean | null;    // null: no live raid roster, so we cannot tell
};
export type NextUp = { key: EssenceKey; name: string | null; waiting: string[]; bid: boolean };

const lc = (s: string) => String(s || '').trim().toLowerCase();
const essenceByName = new Map<string, EssenceKey>(ESSENCES.map(e => [e.name.toLowerCase(), e.key]));
const isBidItem = (item: string) => BID_ITEM_NAMES.some(b => b.toLowerCase() === lc(item));
const byTime = (a: string | null, b: string | null) => String(a ?? '9999').localeCompare(String(b ?? '9999'));

/** The queue, in order; who is done; and for each essence, who gets the next one. */
export function buildEssenceQueue(
  awards: Award[], looted: Looted[], present: Set<string> | null,
): { queue: QueueEntry[]; done: QueueEntry[]; next: NextUp[] } {
  const people = new Map<string, QueueEntry>();
  const entry = (name: string) => {
    const k = lc(name);
    let e = people.get(k);
    if (!e) { e = { name: name.trim(), joinedAt: null, joinedDkp: null, pieces: {}, done: false, present: null }; people.set(k, e); }
    return e;
  };
  // Awards first, oldest first: the first one sets your place in the queue.
  for (const a of [...awards].sort((x, y) => byTime(x.at, y.at))) {
    const key = essenceByName.get(lc(a.item));
    if (!key && !isBidItem(a.item)) continue;
    const e = entry(a.character);
    if (e.joinedAt === null && e.joinedDkp === null) { e.joinedAt = a.at; e.joinedDkp = a.dkp; }
    if (key && !e.pieces[key]) e.pieces[key] = { key, source: 'opendkp', at: a.at, dkp: a.dkp };
  }
  // Mimic's loot lines only fill in pieces; a loot with no award never jumps the queue.
  for (const l of looted) {
    const key = essenceByName.get(lc(l.item));
    const e = key ? people.get(lc(l.character)) : undefined;
    if (key && e && !e.pieces[key]) e.pieces[key] = { key, source: 'mimic', at: l.at, dkp: null };
  }
  const all = [...people.values()].sort((a, b) => byTime(a.joinedAt, b.joinedAt) || a.name.localeCompare(b.name));
  for (const e of all) {
    e.done = ESSENCES.every(x => e.pieces[x.key]);
    e.present = present ? present.has(lc(e.name)) : null;
  }
  const queue = all.filter(e => !e.done);
  const next: NextUp[] = ESSENCES.map(({ key }) => {
    const waiting = queue.filter(e => !e.pieces[key]);
    // With a live roster, the first one there. Without one, the first in line (if present).
    const pick = present ? waiting.find(e => e.present) : waiting[0];
    return { key, name: pick ? pick.name : null, waiting: waiting.map(e => e.name), bid: !pick };
  });
  return { queue, done: all.filter(e => e.done), next };
}

// Sample data for comparing the layouts before any essence has dropped (?demo=1). The names are the
// repo's invented placeholders — none of them is anybody.
export function demoEssenceQueue() {
  const a = (character: string, item: string, dkp: number, at: string): Award => ({ character, item, dkp, at });
  const awards = [
    a('Aldenmar', 'Essence of Fire', 420, '2026-11-02'), a('Aldenmar', 'Essence of Wind', 0, '2026-11-05'),
    a('Aldenmar', 'Essence of Water', 0, '2026-11-09'), a('Aldenmar', 'Essence of Earth', 0, '2026-11-16'),
    a('Brackwyn', 'Essence of Water', 380, '2026-11-06'), a('Brackwyn', 'Essence of Fire', 0, '2026-11-12'),
    a('Corvale', 'Essence of Earth', 350, '2026-11-12'),
    a('Rethlan', 'Essences of Power', 300, '2026-11-19'),
  ];
  const looted: Looted[] = [{ character: 'Corvale', item: 'Essence of Wind', at: '2026-11-19T03:10:00Z' }];
  return { ...buildEssenceQueue(awards, looted, new Set(['brackwyn', 'rethlan', 'nyssara'])),
    classOf: { aldenmar: 'Cleric', brackwyn: 'Enchanter', corvale: 'Wizard', rethlan: 'Monk' } as Record<string, string | null>,
    raidLive: true };
}
