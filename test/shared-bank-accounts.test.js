// test/shared-bank-accounts.test.js — game-account grouping for /me/inventory
// (the guild lead, 2026-10-13). Real-imports the pure libs; no source-text
// assertions, so a comment cannot satisfy any of these.
//
// What is pinned:
//   • stale snapshots of ONE account (measured 0.84 / 0.73 / 0.64 pairwise)
//     are one group, while genuinely different banks stay apart;
//   • an owner-placed account (character_accounts open row) beats inference;
//   • each shared slot counts once per account, from the newest snapshot;
//   • the Characters chip hides an account's shared holding only when ALL of
//     its characters are off;
//   • the placement loader fails open when the tables are missing.
// Character names are invented.

import { describe, it, expect } from 'vitest';
import {
  clusterSharedBanks, planSharedBanks, pickSharedRows, holdingVisible, agreement,
} from '../web/lib/sharedBank.ts';
import { loadAccountPlacements } from '../web/lib/accountPlacements.ts';

const SLOTS = 100;
const baseKey = i => `id:${4000 + i}|1`;

// One character's bank as rows: slot i holds keyFor(i), at `at`.
function rowsFor(character, at, keyFor) {
  return Array.from({ length: SLOTS }, (_, i) => ({
    character, slot: `SharedBank1-Slot${i + 1}`, itemKey: keyFor(i), observedAt: at,
  }));
}
const toMap = rows => new Map(rows.map(r => [r.slot.toLowerCase(), r.itemKey]));

// The measured triangle, built exactly. Newest = Aldenmar, middle = Brackwyn,
// oldest = Corvale.
//   Brackwyn differs from Aldenmar on slots 0..15                  -> 0.84
//   Corvale  differs from Aldenmar on slots 0..12 and 16..38 (36)  -> 0.64
//   Corvale  matches Brackwyn on slots 0..11 only                  -> 0.73
function triangle() {
  return [
    ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
    ...rowsFor('Brackwyn', '2026-10-01T20:00:00Z', i => (i < 16 ? `id:m${i}|1` : baseKey(i))),
    ...rowsFor('Corvale',  '2026-09-20T20:00:00Z', i =>
      i < 12 ? `id:m${i}|1` : i === 12 ? 'id:o12|1' : (i >= 16 && i < 39) ? `id:o${i}|1` : baseKey(i)),
  ];
}

describe('stale snapshots of one account', () => {
  it('the fixture really scores 0.84 / 0.73 / 0.64', () => {
    const rows = triangle();
    const by = c => toMap(rows.filter(r => r.character === c));
    expect(agreement(by('Aldenmar'), by('Brackwyn')).score).toBeCloseTo(0.84, 2);
    expect(agreement(by('Brackwyn'), by('Corvale')).score).toBeCloseTo(0.73, 2);
    expect(agreement(by('Aldenmar'), by('Corvale')).score).toBeCloseTo(0.64, 2);
  });

  it('is ONE group, represented by the newest snapshot', () => {
    const { groups, accountCount, repByCharacter, skip } = clusterSharedBanks(triangle());
    expect(accountCount).toBe(1);
    expect(groups).toEqual([['Aldenmar', 'Brackwyn', 'Corvale']]);
    expect(repByCharacter.get('corvale')).toBe('Aldenmar');
    expect(skip.size).toBe(2);
  });

  it('holds whichever way round the three scores fall', () => {
    // Newest snapshot belongs to the character at the OTHER end of the chain.
    const flipped = triangle().map(r => ({
      ...r,
      observedAt: { Aldenmar: '2026-09-20T20:00:00Z', Corvale: '2026-10-12T20:00:00Z' }[r.character] ?? r.observedAt,
    }));
    expect(clusterSharedBanks(flipped).accountCount).toBe(1);
  });

  it('two genuinely different banks stay apart', () => {
    const rows = [
      ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
      ...rowsFor('Nyssara',  '2026-10-12T20:00:00Z', i => `id:${8000 + i}|1`),
    ];
    const { accountCount, skip } = clusterSharedBanks(rows);
    expect(accountCount).toBe(2);
    expect(skip.size).toBe(0);
  });

  it('a chain of drifting snapshots cannot drag in a bank that disagrees with the newest', () => {
    // Each bank differs from its NEIGHBOUR in one 14-slot block (0.86, well
    // over the link bar), so single-link alone chains all four together. But
    // bank k differs from the newest in k blocks: 0.86 / 0.72 / 0.58.
    const chain = [];
    const at = ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21'];
    at.forEach((d, k) => {
      chain.push(...rowsFor(`link${k}`, `${d}T20:00:00Z`, i => {
        const block = Math.floor(i / 14);
        return block < k ? `id:new${block}|1` : baseKey(i);
      }));
    });
    const { groups } = clusterSharedBanks(chain);
    // link0..link2 hold together; link3 scores 0.58 against the newest and is
    // cut loose rather than chained in.
    expect(groups.map(g => g.length).sort()).toEqual([1, 3]);
    expect(groups.find(g => g.length === 1)).toEqual(['link3']);
  });
});

describe('owner-placed accounts beat inference', () => {
  // Aldenmar + Brackwyn read the same bank, but the owner placed Brackwyn on
  // a DIFFERENT account — similarity must not merge them.
  const rows = [
    ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
    ...rowsFor('Brackwyn', '2026-10-12T20:00:00Z', baseKey),
    ...rowsFor('Corvale',  '2026-10-12T20:00:00Z', baseKey),
  ];

  it('a character placed elsewhere is not merged by bank similarity', () => {
    const plan = planSharedBanks(rows, [
      { character: 'Brackwyn', accountId: 'acct-b', slot: 2 },
      { character: 'Nyssara',  accountId: 'acct-b', slot: 2 },
    ]);
    expect(plan.accountOf.get('brackwyn')).toBe('acct-b');
    // The two unplaced characters still infer one group between themselves…
    const inferred = plan.accounts.find(a => !a.placed);
    expect(inferred.members).toEqual(['Aldenmar', 'Corvale']);
    // …and Brackwyn is never in it.
    expect(plan.accountOf.get('aldenmar')).not.toBe('acct-b');
    expect(plan.accountOf.get('aldenmar')).toBe(plan.accountOf.get('corvale'));
  });

  it('labels: "Account 3 (…)" when placed, the account label when set, "same account? (…)" when inferred', () => {
    const placed = planSharedBanks(rows, [
      { character: 'Aldenmar', accountId: 'a3', slot: 3 },
      { character: 'Brackwyn', accountId: 'a3', slot: 3 },
    ]);
    expect(placed.accounts.find(a => a.id === 'a3').label).toBe('Account 3 (Aldenmar, Brackwyn)');

    const named = planSharedBanks(rows, [
      { character: 'Aldenmar', accountId: 'a3', slot: 3, label: 'Bank mule acct' },
      { character: 'Brackwyn', accountId: 'a3', slot: 3, label: 'Bank mule acct' },
    ]);
    expect(named.accounts.find(a => a.id === 'a3').label).toBe('Bank mule acct (Aldenmar, Brackwyn)');

    const inferred = planSharedBanks(rows.filter(r => r.character !== 'Corvale'));
    expect(inferred.accounts).toHaveLength(1);
    expect(inferred.accounts[0].placed).toBe(false);
    expect(inferred.accounts[0].label).toBe('same account? (Aldenmar, Brackwyn)');
  });

  it('a placed account lists members that have no shared-bank rows too', () => {
    const plan = planSharedBanks(rows.filter(r => r.character === 'Aldenmar'), [
      { character: 'Aldenmar', accountId: 'a1', slot: 1 },
      { character: 'Nyssara',  accountId: 'a1', slot: 1 },
    ]);
    expect(plan.accounts[0].members).toEqual(['Aldenmar', 'Nyssara']);
    expect(plan.accountCount).toBe(1);
  });

  it('no placements at all behaves as pure inference (tables missing / empty)', () => {
    expect(planSharedBanks(triangle()).accounts.map(a => a.members)).toEqual([['Aldenmar', 'Brackwyn', 'Corvale']]);
    expect(planSharedBanks(triangle(), []).accountCount).toBe(1);
  });

  it('a placed account is NOT capped at the inference threshold — placement is trusted', () => {
    // Banks that disagree completely, but the owner says one account.
    const two = [
      ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
      ...rowsFor('Nyssara',  '2026-10-12T20:00:00Z', i => `id:${8000 + i}|1`),
    ];
    const plan = planSharedBanks(two, [
      { character: 'Aldenmar', accountId: 'a1', slot: 1 },
      { character: 'Nyssara',  accountId: 'a1', slot: 1 },
    ]);
    expect(plan.accountOf.get('aldenmar')).toBe(plan.accountOf.get('nyssara'));
  });
});

describe('qty counts each slot once per account', () => {
  const sum = rows => rows.reduce((n, r) => n + Number(r.itemKey.split('|')[1]), 0);

  it('three stale snapshots of one account count the bank once, not three times', () => {
    const rows = triangle();
    const plan = planSharedBanks(rows);
    const counted = pickSharedRows(rows, plan.accountOf);
    expect(counted).toHaveLength(SLOTS);            // one row per slot
    expect(sum(counted)).toBe(SLOTS);
    expect(sum(rows)).toBe(3 * SLOTS);              // what the page used to add up
  });

  it('only the account\'s NEWEST snapshot counts', () => {
    const rows = triangle();
    const counted = pickSharedRows(rows, planSharedBanks(rows).accountOf);
    const at = n => counted.find(r => r.slot === `SharedBank1-Slot${n}`);
    expect(at(1).character).toBe('Aldenmar');        // slot every snapshot has
    expect(at(1).itemKey).toBe(baseKey(0));          // newest value, not the stale one
    // A slot only an OLDER snapshot lists is what the bank held then — withdrawn since, or moved: not counted.
    const older = [
      ...rows,
      { character: 'Corvale', slot: 'SharedBank9-Slot9', itemKey: 'id:77|4', observedAt: '2026-09-20T20:00:00Z' },
    ];
    const c2 = pickSharedRows(older, planSharedBanks(older).accountOf);
    expect(c2.find(r => r.slot === 'SharedBank9-Slot9')).toBeUndefined();
    expect(c2).toHaveLength(SLOTS);
  });

  it('freshness decides, not name order', () => {
    // The newest snapshot is the alphabetically LAST character.
    const rows = [
      ...rowsFor('Aldenmar', '2026-09-01T20:00:00Z', baseKey),
      ...rowsFor('Corvale',  '2026-10-12T20:00:00Z', i => (i < 5 ? `id:fresh${i}|1` : baseKey(i))),
    ];
    const counted = pickSharedRows(rows, planSharedBanks(rows).accountOf);
    expect(counted).toHaveLength(SLOTS);
    expect(counted.find(r => r.slot === 'SharedBank1-Slot1')).toMatchObject({ character: 'Corvale', itemKey: 'id:fresh0|1' });
  });

  it('two different accounts each count their own bank', () => {
    const rows = [
      ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
      ...rowsFor('Nyssara',  '2026-10-12T20:00:00Z', i => `id:${8000 + i}|1`),
    ];
    const counted = pickSharedRows(rows, planSharedBanks(rows).accountOf);
    expect(counted).toHaveLength(2 * SLOTS);
  });

  it('owner-placed accounts dedupe the same way', () => {
    const rows = [
      ...rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey),
      ...rowsFor('Nyssara',  '2026-09-01T20:00:00Z', i => (i < 30 ? `id:old${i}|1` : baseKey(i))),
    ];
    const plan = planSharedBanks(rows, [
      { character: 'Aldenmar', accountId: 'a1', slot: 1 },
      { character: 'Nyssara',  accountId: 'a1', slot: 1 },
    ]);
    const counted = pickSharedRows(rows, plan.accountOf);
    expect(counted).toHaveLength(SLOTS);
    expect(counted.every(r => r.character === 'Aldenmar')).toBe(true);
  });

  it('a character outside every account counts alone', () => {
    const rows = rowsFor('Aldenmar', '2026-10-12T20:00:00Z', baseKey);
    expect(pickSharedRows(rows, new Map())).toHaveLength(SLOTS);
  });
});

describe('Characters chip rule', () => {
  const acct = { members: ['Aldenmar', 'Brackwyn', 'Corvale'] };
  const shared = { character: 'x', location: 'shared', account: acct };
  const none = new Set();

  it('an account holding stays visible while ANY of its characters is on', () => {
    // The representative (newest snapshot) is off — the old rule hid the bank.
    expect(holdingVisible(shared, new Set(['Aldenmar']), none)).toBe(true);
    expect(holdingVisible(shared, new Set(['Aldenmar', 'Brackwyn']), none)).toBe(true);
  });

  it('is hidden only when ALL of the account\'s characters are off', () => {
    expect(holdingVisible(shared, new Set(acct.members), none)).toBe(false);
  });

  it('a plain holding still follows its own character chip', () => {
    const own = { character: 'Nyssara', location: 'bags' };
    expect(holdingVisible(own, new Set(['Nyssara']), none)).toBe(false);
    expect(holdingVisible(own, new Set(['Aldenmar']), none)).toBe(true);
  });

  it('the location chips still apply to account holdings', () => {
    expect(holdingVisible(shared, none, new Set(['shared']))).toBe(false);
  });
});

describe('loadAccountPlacements fails open', () => {
  // A fake of the supabase-js builder: every method chains, awaiting resolves
  // to `result(table)`.
  function fake(result) {
    const calls = [];
    return {
      calls,
      from(table) {
        const q = {
          select: () => q, eq: (c, v) => { calls.push([table, 'eq', c, v]); return q; },
          in: () => q, is: (c, v) => { calls.push([table, 'is', c, v]); return q; },
          then: (res, rej) => Promise.resolve(result(table)).then(res, rej),
        };
        return q;
      },
    };
  }

  it('returns [] when the tables do not exist (query errors)', async () => {
    const c = fake(() => ({ data: null, error: { message: 'relation "character_accounts" does not exist' } }));
    expect(await loadAccountPlacements(c, 'g', ['Aldenmar'])).toEqual([]);
  });

  it('returns [] when the client throws', async () => {
    const c = { from() { throw new Error('boom'); } };
    expect(await loadAccountPlacements(c, 'g', ['Aldenmar'])).toEqual([]);
  });

  it('reads only OPEN rows and joins slot + label from game_accounts', async () => {
    const c = fake(t => t === 'character_accounts'
      ? { data: [{ character_name: 'Aldenmar', account_id: 'a1' }], error: null }
      : { data: [{ id: 'a1', slot: 3, label: null }], error: null });
    const out = await loadAccountPlacements(c, 'g', ['Aldenmar', 'Brackwyn']);
    expect(out).toEqual([{ character: 'Aldenmar', accountId: 'a1', slot: 3, label: null }]);
    expect(c.calls).toContainEqual(['character_accounts', 'is', 'valid_to', null]);
  });

  it('keeps the placement when only the game_accounts lookup fails', async () => {
    const c = fake(t => t === 'character_accounts'
      ? { data: [{ character_name: 'Aldenmar', account_id: 'a1' }], error: null }
      : { data: null, error: { message: 'nope' } });
    const out = await loadAccountPlacements(c, 'g', ['Aldenmar']);
    expect(out).toEqual([{ character: 'Aldenmar', accountId: 'a1', slot: null, label: null }]);
  });
});
