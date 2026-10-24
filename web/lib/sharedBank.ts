// Grouping characters into GAME ACCOUNTS by their shared bank, tolerant of
// snapshot skew. Pure + tested (test/shared-bank.test.js).
//
// The server rules that shape this (the guild lead, 2026-08-20):
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

// Staleness skew (the guild lead, 2026-10-13): three characters of ONE account
// whose snapshots were weeks apart scored 0.84 / 0.73 / 0.64 pairwise. A
// single-link bar of 0.75 dropped the 0.73 link, the group split, and an item
// was counted three times. Staleness grows with the TIME GAP, so the pair
// furthest apart scores lowest while each neighbouring pair still scores
// well. Two bars, then:
//   LINK      — single-link at 0.70 builds a candidate group (neighbouring
//               snapshots chain together);
//   CONSENSUS — every member must still score >= 0.60 against the group's
//               NEWEST snapshot, the closest thing we have to the bank's
//               current truth. That check is what stops the looser link bar
//               from chaining unrelated banks: a member that only hangs on
//               through a long chain is cut loose.
export const LINK_AGREEMENT      = 0.70;
export const CONSENSUS_AGREEMENT = 0.60;

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
  /** The accepted groups (each one inferred account), members sorted. Lone characters appear as groups of one. */
  groups: string[][];
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
export function sameAccount(a: SlotMap, b: SlotMap, threshold = LINK_AGREEMENT): boolean {
  const { common, score } = agreement(a, b);
  if (common < MIN_COMMON_SLOTS) return false;
  return score >= threshold;
}

/** Freshest snapshot first; ties go to the larger bank, then the name. */
function rankByFreshness(members: string[], maps: Map<string, SlotMap>, newest: Map<string, string>): string[] {
  return [...members].sort((x, y) => {
    const nx = newest.get(x) || '', ny = newest.get(y) || '';
    if (nx !== ny) return nx < ny ? 1 : -1;
    const sx = maps.get(x)!.size, sy = maps.get(y)!.size;
    if (sx !== sy) return sy - sx;
    return x.localeCompare(y);
  });
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

  // Stage 1: single-link at LINK_AGREEMENT, then cut loose anyone who does not
  // agree with the group's NEWEST snapshot at CONSENSUS_AGREEMENT. Whoever is
  // cut loose is re-clustered among themselves (the newest member always
  // stays, so every pass shrinks the remainder and the loop ends).
  const stage1: string[][] = [];
  const pending: string[][] = chars.length ? [chars] : [];
  while (pending.length) {
    for (const comp of componentsAt(pending.pop()!, maps, LINK_AGREEMENT)) {
      const top = rankByFreshness(comp, maps, newest)[0];
      const keep = comp.filter(c => c === top || sameAccount(maps.get(c)!, maps.get(top)!, CONSENSUS_AGREEMENT));
      stage1.push(keep);
      const rest = comp.filter(c => !keep.includes(c));
      if (rest.length) pending.push(rest);
    }
  }

  // Split anything larger than an account can hold by tightening the bar.
  const queue: Array<{ members: string[]; step: number }> =
    stage1.map(members => ({ members, step: 0 }));

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
    const rep = rankByFreshness(members, maps, newest)[0];
    for (const m of members) {
      repByCharacter.set(m.toLowerCase(), rep);
      if (m !== rep) skip.add(m);
    }
  }
  for (const members of oversized) {
    for (const m of members) repByCharacter.set(m.toLowerCase(), m);
  }

  return {
    repByCharacter, skip, accountCount: accepted.length + oversized.length, oversized,
    groups: accepted.map(g => [...g].sort()),
  };
}

// ── Owner-placed accounts beat inference (the guild lead, 2026-10-13) ───────
// `character_accounts` (open row = valid_to null) says which game account a
// character is on. That is authoritative; bank similarity only places the
// characters that have no such row.

export type AccountPlacement = {
  character: string;
  accountId: string;
  /** game_accounts.label, when the owner named it. */
  label?: string | null;
  /** game_accounts.slot (1..10) — "Account 3". */
  slot?: number | null;
};

export type SharedAccount = {
  id: string;
  /** true = owner-placed (authoritative); false = inferred from the bank. */
  placed: boolean;
  /** Display label: "Account 3 (Aldenmar, Brackwyn)" or "same account? (Aldenmar, Brackwyn)". */
  label: string;
  /** The owner's own name for the account (a login name), or null for "Account 3" / "same account?". */
  name: string | null;
  /** Every character of the account we know about — INCLUDING ones with no shared-bank rows. */
  members: string[];
};

export type SharedBankPlan = {
  /** Multi-character accounts only; a lone unplaced character is not an "account" worth a label. */
  accounts: SharedAccount[];
  /** character (lowercased) -> account id, for the characters in `accounts`. */
  accountOf: Map<string, string>;
  /** Accounts counted for the header stat (placed with a bank + inferred, lone characters included). */
  accountCount: number;
  oversized: string[][];
};

const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

/** Build the account groups for one family's shared-bank rows. */
export function planSharedBanks(rows: SharedBankRow[], placements: AccountPlacement[] = []): SharedBankPlan {
  const placedBy = new Map<string, AccountPlacement>();
  for (const p of placements) if (p.character && p.accountId) placedBy.set(p.character.toLowerCase(), p);

  const accounts: SharedAccount[] = [];
  const accountOf = new Map<string, string>();

  const byAccount = new Map<string, AccountPlacement[]>();
  for (const p of placedBy.values()) {
    (byAccount.get(p.accountId) ?? byAccount.set(p.accountId, []).get(p.accountId)!).push(p);
  }
  const withBank = new Set(rows.map(r => r.character.toLowerCase()));
  let placedWithBank = 0;
  for (const [id, ps] of byAccount) {
    const members = ps.map(p => p.character).sort(byName);
    const named = ps.find(p => p.label && p.label.trim())?.label?.trim();
    const slot = ps.find(p => p.slot != null)?.slot;
    const base = named || (slot != null ? `Account ${slot}` : 'Account');
    accounts.push({ id, placed: true, label: `${base} (${members.join(', ')})`, name: named || null, members });
    for (const m of members) accountOf.set(m.toLowerCase(), id);
    if (members.some(m => withBank.has(m.toLowerCase()))) placedWithBank++;
  }

  // Only the characters with no open placement are inferred from their banks.
  const clusters = clusterSharedBanks(rows.filter(r => !placedBy.has(r.character.toLowerCase())));
  for (const g of clusters.groups) {
    if (g.length < 2) continue;
    const members = [...g].sort(byName);
    const id = `inferred:${members[0].toLowerCase()}`;
    accounts.push({ id, placed: false, label: `same account? (${members.join(', ')})`, name: null, members });
    for (const m of members) accountOf.set(m.toLowerCase(), id);
  }

  return { accounts, accountOf, accountCount: placedWithBank + clusters.accountCount, oversized: clusters.oversized };
}

/**
 * The shared-bank rows that COUNT: the account's FRESHEST snapshot, whole, and
 * nothing from its older ones. Characters outside `accountOf` are their own
 * account. An older export only says what the bank held then: mixing its slots
 * in would count an item withdrawn since, and count one moved between slots
 * twice. (The rule since 2026-08-20; the 2026-10-13 change was to the grouping.)
 */
export function pickSharedRows<T extends SharedBankRow>(rows: T[], accountOf: Map<string, string>): T[] {
  const { maps, newest } = buildMaps(rows);
  const acct = (c: string) => accountOf.get(c.toLowerCase()) ?? `solo:${c.toLowerCase()}`;
  const rep = new Map<string, string>();               // account → the character whose snapshot counts
  for (const c of rankByFreshness([...maps.keys()], maps, newest)) {
    if (!rep.has(acct(c))) rep.set(acct(c), c);
  }
  return rows.filter(r => !!r.character && !!r.slot && rep.get(acct(r.character)) === r.character);
}

/**
 * Explorer chip rule for one holding. A plain holding follows its character's
 * chip; an ACCOUNT holding (the shared bank) is hidden only when EVERY one of
 * the account's characters is off — any one of them can still pull from it.
 */
export function holdingVisible(
  h: { character: string; location: string; account?: { members: string[] } | null },
  offChars: ReadonlySet<string>,
  offLocs: ReadonlySet<string>,
): boolean {
  if (offLocs.has(h.location)) return false;
  if (h.account) return !h.account.members.every(m => offChars.has(m));
  return !offChars.has(h.character);
}
