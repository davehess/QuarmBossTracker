// Grouping characters into GAME ACCOUNTS by their shared bank, tolerant of
// snapshot skew. Pure + tested (test/shared-bank.test.js).
//
// Why this replaced a whole-bank hash (Hitya 2026-08-20, second look): the
// first cut fingerprinted each character's entire SharedBank row-set and
// grouped exact matches. That is correct in theory and useless in practice —
// each character's inventory file is written whenever THAT character last ran
// /outputfile inventory, so ten characters on one account hold ten snapshots
// taken minutes or hours apart. Items move between them, row counts drift
// (107 / 104 / 108 on one real account), and a SINGLE differing row breaks the
// whole hash. Result: no grouping at all, and one stack of Words of the
// Spectre counted ten times.
//
// The durable signal is the SLOT ADDRESS. `SharedBank6-Slot9` is account-
// scoped: if two characters both report that slot holding the same item, they
// are reading the same physical stack. So we compare characters slot-by-slot
// and cluster on AGREEMENT RATIO rather than demanding identity — a snapshot
// that is 4 rows stale still agrees on the other 100.
//
// Two same-account characters therefore cluster; two genuinely different
// accounts (different items at the same slot numbers) do not.

export type SharedBankRow = {
  character: string;
  slot: string;        // e.g. 'SharedBank6-Slot9'
  itemKey: string;     // stable per item+qty, e.g. 'id:12345|3'
  observedAt?: string | null;
};

// Tuning. MIN_COMMON_SLOTS stops two nearly-empty banks from "agreeing" on one
// coincidental Water Flask; MIN_AGREEMENT allows real drift between snapshots.
//
// The score is JACCARD — matching slots over the UNION of both banks, not over
// their overlap. Measuring only the overlap lets a small bank "fully agree"
// with a big one it is merely a subset of, and union-find then chains those
// weak links into absurd clusters (a first pass produced a 29-character and a
// 17-character "account"; an EQ account holds at most 8). Over the union, a
// 20-slot mule bank scores 20/108 against a 108-slot bank and stays separate,
// while two snapshots of the SAME bank score ~0.99 (measured: 107/108).
export const MIN_COMMON_SLOTS = 5;
export const MIN_AGREEMENT     = 0.75;
// Runaway-merge guard, NOT a game fact — we do not know Quarm's per-account
// character limit and must not invent one. Calibrated against reality: with
// the Jaccard score above, the largest genuine cluster measured across the
// whole guild is 10 characters (one real account, ~100% slot agreement over
// 107 slots), and every other cluster is 8 or fewer. A cluster far past that
// means the scoring has gone wrong somewhere, so we stop deduping it rather
// than silently hiding items.
export const MAX_ACCOUNT_CHARACTERS = 16;

export type SharedBankClusters = {
  /** character (lowercased) → the character whose shared bank COUNTS for its account. */
  repByCharacter: Map<string, string>;
  /** Characters whose shared-bank rows must be skipped (someone else represents their account). */
  skip: Set<string>;
  /** Number of distinct accounts seen. */
  accountCount: number;
  /**
   * Clusters larger than an EQ account can hold. These are NOT deduped — a
   * merge we cannot explain would silently hide items, and a visible duplicate
   * is a much better failure than a missing one. Surfaced so it can be logged.
   */
  oversized: string[][];
};

function slotMaps(rows: SharedBankRow[]) {
  const maps = new Map<string, Map<string, string>>();     // char → slot → itemKey
  const newest = new Map<string, string>();                // char → newest observedAt
  for (const r of rows) {
    if (!r.character || !r.slot) continue;
    let m = maps.get(r.character);
    if (!m) { m = new Map(); maps.set(r.character, m); }
    m.set(r.slot.toLowerCase(), r.itemKey);
    const seen = newest.get(r.character);
    if (r.observedAt && (!seen || r.observedAt > seen)) newest.set(r.character, r.observedAt);
  }
  return { maps, newest };
}

/** Do these two characters read the same physical shared bank? */
export function sameAccount(a: Map<string, string>, b: Map<string, string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0, agree = 0;
  for (const [slot, key] of small) {
    const other = large.get(slot);
    if (other === undefined) continue;
    common++;
    if (other === key) agree++;
  }
  if (common < MIN_COMMON_SLOTS) return false;
  const union = a.size + b.size - common;
  if (union <= 0) return false;
  return agree / union >= MIN_AGREEMENT;      // Jaccard — see the note above
}

/**
 * Cluster characters by shared bank and pick one representative per account.
 * The representative is the FRESHEST snapshot — it is the closest thing we
 * have to the bank's current truth.
 */
export function clusterSharedBanks(rows: SharedBankRow[]): SharedBankClusters {
  const { maps, newest } = slotMaps(rows);
  const chars = [...maps.keys()];

  // Union-find over "same account".
  const parent = new Map<string, string>(chars.map(c => [c, c]));
  const find = (x: string): string => {
    let p = parent.get(x)!;
    while (p !== parent.get(p)!) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  const union = (x: string, y: string) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      if (sameAccount(maps.get(chars[i])!, maps.get(chars[j])!)) union(chars[i], chars[j]);
    }
  }

  const groups = new Map<string, string[]>();
  for (const c of chars) {
    const root = find(c);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(c);
  }

  const repByCharacter = new Map<string, string>();
  const skip = new Set<string>();
  const oversized: string[][] = [];
  for (const members of groups.values()) {
    if (members.length > MAX_ACCOUNT_CHARACTERS) {
      // Cannot be one account. Leave every member counting its own bank.
      oversized.push([...members].sort());
      for (const m of members) repByCharacter.set(m.toLowerCase(), m);
      continue;
    }
    // Freshest snapshot wins; then the bigger bank (less likely to be a
    // truncated read); then name, so the pick is deterministic.
    const rep = [...members].sort((x, y) => {
      const nx = newest.get(x) || '', ny = newest.get(y) || '';
      if (nx !== ny) return nx < ny ? 1 : -1;
      const sx = maps.get(x)!.size, sy = maps.get(y)!.size;
      if (sx !== sy) return sy - sx;
      return x.localeCompare(y);
    })[0];
    for (const m of members) {
      repByCharacter.set(m.toLowerCase(), rep);
      if (m !== rep) skip.add(m);
    }
  }

  return { repByCharacter, skip, accountCount: groups.size, oversized };
}
