// test/shared-bank.test.js — clustering characters into game accounts by their
// shared bank. Real-imports the pure lib (web/lib/sharedBank.ts).
//
// The bug this pins (Hitya 2026-08-20): "Fairly certain that these are
// duplicates for the shared bank bits of 1 or 3 items." Ten characters each
// reported SharedBank6-Slot9 = Words of the Spectre x3 — ONE physical stack,
// counted ten times, because the first implementation hashed the WHOLE bank
// and their snapshots were taken minutes apart (107 / 104 / 108 rows). Slot
// agreement survives that skew; whole-bank identity does not.

import { describe, it, expect } from 'vitest';
import { clusterSharedBanks, sameAccount, MIN_COMMON_SLOTS, MAX_ACCOUNT_CHARACTERS } from '../web/lib/sharedBank.ts';

// Build one account's rows: `chars` all read the same bank of `slots` items.
function bank(chars, slots, opts = {}) {
  const rows = [];
  chars.forEach((c, ci) => {
    slots.forEach((key, si) => {
      // `drift` makes the Nth character's first item stale, like a snapshot
      // taken before someone moved a stack.
      const stale = opts.drift && ci === 1 && si === 0;
      rows.push({
        character: c,
        slot: `SharedBank${opts.bankNo ?? 6}-Slot${si + 1}`,
        itemKey: stale ? 'id:99999|1' : key,
        observedAt: opts.times?.[ci] ?? `2026-08-20T18:0${ci}:00Z`,
      });
    });
  });
  return rows;
}

const TEN_SLOTS = Array.from({ length: 10 }, (_, i) => `id:${1000 + i}|1`);

describe('sameAccount', () => {
  it('identical banks are the same account', () => {
    const rows = bank(['a', 'b'], TEN_SLOTS);
    const { skip, accountCount } = clusterSharedBanks(rows);
    expect(accountCount).toBe(1);
    expect(skip.size).toBe(1);
  });

  it('THE REAL CASE: a few drifted rows still group (snapshots minutes apart)', () => {
    const rows = bank(['canopy', 'hidya'], TEN_SLOTS, { drift: true });
    const { accountCount, skip } = clusterSharedBanks(rows);
    expect(accountCount).toBe(1);          // 9/10 slots agree
    expect(skip.size).toBe(1);
  });

  it('different accounts holding different things do NOT group', () => {
    const a = bank(['woordup'], TEN_SLOTS, { bankNo: 6 });
    const other = Array.from({ length: 10 }, (_, i) => `id:${5000 + i}|1`);
    const b = bank(['stranger'], other, { bankNo: 6 });
    const { accountCount, skip } = clusterSharedBanks([...a, ...b]);
    expect(accountCount).toBe(2);
    expect(skip.size).toBe(0);
  });

  it('a coincidental tiny overlap is NOT enough to merge two accounts', () => {
    // Both banks hold one identical stack in the same slot — and nothing else.
    const rows = [
      { character: 'muleA', slot: 'SharedBank1-Slot1', itemKey: 'id:13005|20' },
      { character: 'muleB', slot: 'SharedBank1-Slot1', itemKey: 'id:13005|20' },
    ];
    const { accountCount, skip } = clusterSharedBanks(rows);
    expect(accountCount).toBe(2);          // below MIN_COMMON_SLOTS
    expect(skip.size).toBe(0);
    expect(MIN_COMMON_SLOTS).toBeGreaterThan(1);
  });

  it('grouping is transitive across a whole account (ten characters, one stack)', () => {
    const chars = ['utoh', 'manamana', 'melting', 'rockin', 'canopy',
                   'hidya', 'hitya', 'hopeya', 'okigetyou', 'pearlclutcher'];
    const { accountCount, skip } = clusterSharedBanks(bank(chars, TEN_SLOTS, { drift: true }));
    expect(accountCount).toBe(1);
    expect(skip.size).toBe(chars.length - 1);   // exactly one bank counts
  });
});

describe('representative choice', () => {
  it('the FRESHEST snapshot represents the account', () => {
    const rows = bank(['old', 'new'], TEN_SLOTS, {
      times: ['2026-08-20T18:00:00Z', '2026-08-20T20:00:00Z'],
    });
    const { repByCharacter, skip } = clusterSharedBanks(rows);
    expect(repByCharacter.get('old')).toBe('new');
    expect(skip.has('old')).toBe(true);
    expect(skip.has('new')).toBe(false);
  });
});

describe('degenerate input', () => {
  it('no shared-bank rows means no clusters and nothing skipped', () => {
    const { accountCount, skip } = clusterSharedBanks([]);
    expect(accountCount).toBe(0);
    expect(skip.size).toBe(0);
  });

  it('a lone character represents its own account', () => {
    const { accountCount, skip } = clusterSharedBanks(bank(['solo'], TEN_SLOTS));
    expect(accountCount).toBe(1);
    expect(skip.size).toBe(0);
  });
});

describe('guards against over-merging', () => {
  it('a small bank that is merely a SUBSET of a big one does not merge', () => {
    // The chain-merge that produced a 29-character "account" on the first pass:
    // scoring agreement over the overlap alone let a 6-slot mule bank "fully
    // agree" with a 60-slot bank it shares six stacks with.
    const big = Array.from({ length: 60 }, (_, i) => `id:${2000 + i}|1`);
    const rows = [
      ...bank(['bigbank'], big),
      ...bank(['smallmule'], big.slice(0, 6)),
    ];
    const { accountCount, skip } = clusterSharedBanks(rows);
    expect(accountCount).toBe(2);
    expect(skip.size).toBe(0);
  });

  it('a cluster bigger than an EQ account is NOT deduped — visible dupes beat hidden losses', () => {
    const chars = Array.from({ length: MAX_ACCOUNT_CHARACTERS + 3 }, (_, i) => `c${i}`);
    const { skip, oversized } = clusterSharedBanks(bank(chars, TEN_SLOTS));
    expect(oversized).toHaveLength(1);
    expect(oversized[0]).toHaveLength(chars.length);
    expect(skip.size).toBe(0);       // nobody dropped
  });

  it('a real-world-sized account (10 characters, measured) still dedups', () => {
    // Hitya's own account: Canopy/Hidya/Hitya/Hopeya/Manamana/Melting/
    // Okigetyou/Pearlclutcher/Rockin/Utoh — the guard must never veto it.
    const chars = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const { skip, oversized } = clusterSharedBanks(bank(chars, TEN_SLOTS));
    expect(oversized).toHaveLength(0);
    expect(skip.size).toBe(9);
    expect(MAX_ACCOUNT_CHARACTERS).toBeGreaterThanOrEqual(10);
  });
});
