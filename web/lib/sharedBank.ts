// Grouping characters into GAME ACCOUNTS by their shared bank, tolerant of
// snapshot skew. Pure + tested (test/shared-bank.test.js).
//
// The server rules that shape this (Hitya, 2026-08-20):
//   • A game account holds at most 8 characters.
//   • One person can own ~10 game accounts under a single forum account, so
//     "same owner" and "same account" are DIFFERENT questions. Ownership is
//     already answered elsewhere (Discord link / OpenDKP family); this file
//     answers only "same shared bank".
//   • Characters move between a person's game accounts with
//     `#charactertransfer <account name>` — so account membership is not
//     stable, and any grouping has to re-derive itself from fresh data rather
//     than be curated.
//
// Why the shared bank is the signal: it is account-level, so every character
// on an account exports the same SharedBank rows. Summing them per character
// counted one physical stack once per character (ten characters each
// reporting SharedBank6-Slot9 = Words of the Spectre x3).
//
// Why SLOT AGREEMENT rather than hashing the whole bank: a character's
// inventory file is written whenever THAT character last ran /outputfile
// inventory, so one account's snapshots are taken hours or days apart and
// drift (measured: 104 / 107 / 108 rows on one real account). Whole-bank
// identity almost never holds. A slot address is account-scoped and stable,
// so a stale snapshot still agrees on the slots that did not change.

export type SharedBankRow = {
  character: string;
  slot: string;        // e.g. 'SharedBank6-Slot9'
  itemKey: string;     // stable per item+qty, e.g. 'id:12345|3'
  observedAt?: string | null;
};

// Two banks are the same account when their slot->item maps agree, scored
// JACCARD over the UNION of both banks. Scoring over the overlap alone let a
// small bank "fully agree" with a big one it is merely a subset of, and
// union-find chained those weak links into a 29-character and a 17-character
// "account" (measured before this changed).
export const MIN_COMMON_SLOTS = 5;
export const MIN_AGREEMENT     = 0.75;

// Hard server rule, not a guess: 8 characters per game account.
export const MAX_ACCOUNT_CHARACTERS = 8;

// When a cluster comes out larger than an account can hold, the threshold was
// too loose for that neighbourhood — two of the owner's accounts hold similar
// stock, or a transferred character still carries its old account's bank in a
// stale export. Re-cluster just those members at progressively stricter
// thresholds and stop at the FIRST one that fits, so we split at the natural
// gap instead of shattering the group. Measured on the real case: the true
// 8-character account agrees at >=0.99 internally, the two transferred
// characters at 0.97 with each other and <=0.95 with the account, so 0.96
// separates them correctly.
const ESCALATION = [0.80, 0.85, 0.90, 0.93, 0.95, 0.96, 0.97, 0.98, 0.99];

export type SharedBankClusters = {
  /** character (lowercased) -> the character whose shared bank COUNTS for its account. */
  repByCharacter: Map<string, string>;
  /** Characters whose shared-bank rows must be skipped (someone else represents their account). */
  skip: Set<string>;
  /** Number of distinct accounts seen. */
  accountCount: number;
  /**
   * Groups that could not be split down to a plausible account even at the
   * strictest threshold. NOT deduped — a merge we cannot explain would hide
   * items, and a visible duplicate is a far better failure than a missing one.
   */
  oversized: string[][];
};

type SlotMap = Map<string, string>;

function buildMaps(rows: SharedBankRow[]) {
  const maps = new Map<string, SlotMap>();
  const newest = new Map<string, string>();
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

/** Jaccard agreement between two banks: matching slots over the union. */
export function agreement(a: SlotMap, b: SlotMap): { common: number; score: number } {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0, agree = 0;
  for (const [slot, key] of small) {
    const other = large.get(slot);
    if (other === undefined) continue;
    common++;
    if (other === key) agree++;
  }
  const union = a.size + b.size - common;
  return { common, score: union > 0 ? agree / union : 0 };
}

/** Do these two characters read the same physical shared bank? */
export function sameAccount(a: SlotMap, b: SlotMap, threshold = MIN_AGREEMENT): boolean {
  const { common, score } = agreement(a, b);
  if (common < MIN_COMMON_SLOTS) return false;
  return score >= threshold;
}

/** Connected components over "same account at `threshold`", within `members`. */
function componentsAt(members: string[], maps: Map<string, SlotMap>, threshold: number): string[][] {
  const parent = new Map<string, string>(members.map(c => [c, c]));
  const find = (x: string): string => {
    let p = parent.get(x)!;
    while (p !== parent.get(p)!) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = maps.get(members[i])!, b = maps.get(members[j])!;
      if (sameAccount(a, b, threshold)) {
        const rx = find(members[i]), ry = find(members[j]);
        if (rx !== ry) parent.set(rx, ry);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const c of members) {
    const root = find(c);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(c);
  }
  return [...groups.values()];
}

/**
 * Cluster characters by shared bank and pick one representative per account.
 * The representative is the freshest, largest snapshot — the closest thing we
 * have to the bank's current truth. (Note `observedAt` is UPLOAD time, and a
 * batch upload gives a whole family the same instant, so bank SIZE does most
 * of the tie-breaking in practice.)
 */
export function clusterSharedBanks(rows: SharedBankRow[]): SharedBankClusters {
  const { maps, newest } = buildMaps(rows);
  const chars = [...maps.keys()];

  const accepted: string[][] = [];
  const oversized: string[][] = [];

  // Split anything larger than an account can hold by tightening the bar.
  const queue: Array<{ members: string[]; step: number }> =
    componentsAt(chars, maps, MIN_AGREEMENT).map(members => ({ members, step: 0 }));

  while (queue.length) {
    const { members, step } = queue.shift()!;
    if (members.length <= MAX_ACCOUNT_CHARACTERS) { accepted.push(members); continue; }
    if (step >= ESCALATION.length) { oversized.push([...members].sort()); continue; }
    const parts = componentsAt(members, maps, ESCALATION[step]);
    // No progress at this threshold — try the next one on the same group.
    if (parts.length === 1) { queue.push({ members, step: step + 1 }); continue; }
    for (const p of parts) queue.push({ members: p, step: step + 1 });
  }

  const repByCharacter = new Map<string, string>();
  const skip = new Set<string>();
  for (const members of accepted) {
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
  for (const members of oversized) {
    for (const m of members) repByCharacter.set(m.toLowerCase(), m);
  }

  return { repByCharacter, skip, accountCount: accepted.length + oversized.length, oversized };
}
