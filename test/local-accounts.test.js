// test/local-accounts.test.js — what the local "My account inventory" page (web/local) decides about the
// characters on this PC (web/lib/localAccounts.ts) and how the shared bank prefers a trustworthy snapshot
// (web/lib/sharedBank.ts pickSharedRows, web/lib/inventoryAggregate.ts).
//
// The guild lead (2026-10-26): the page guessed 23 accounts for someone who owns 6; characters made for one
// thing and never seen again clutter it; and a character whose game was left by an unclean exit has an
// inventory file that no longer describes it. What can go wrong without anyone noticing:
//   * a one-off flag that catches a parked alt (short log is not enough, silence is not enough, BOTH are needed),
//     or one that fires with no log at all, or whose thresholds drift;
//   * a stale flag that fires on the export's own log echo, or on a character with no log;
//   * hiding a one-off character that also removes the shared bank its account's other characters use;
//   * a stale snapshot winning the shared bank when a trustworthy one is close in age, or a trustworthy one
//     that is MONTHS older beating the genuinely newer export;
//   * placements not reaching the aggregation, so the header counts guessed accounts again.
// Fixture names are the invented ones. Run: npx vitest run test/local-accounts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ONE_OFF_MAX_SPAN_MS, ONE_OFF_IDLE_MS, STALE_GRACE_MS,
  isOneOff, isSnapshotStale, classifyCharacters, dropCharacters,
} from '../web/lib/localAccounts.ts';
import { pickSharedRows, planSharedBanks, TRUST_PREFERENCE_WINDOW_MS } from '../web/lib/sharedBank.ts';
import { aggregateInventory } from '../web/lib/inventoryAggregate.ts';
import { stripJs, ROOT } from './_source-slice.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400_000;

describe('thresholds', () => {
  it('are one day of play and thirty days of silence, and the stale grace is two minutes', () => {
    expect(ONE_OFF_MAX_SPAN_MS).toBe(DAY);
    expect(ONE_OFF_IDLE_MS).toBe(30 * DAY);
    expect(STALE_GRACE_MS).toBe(2 * 60_000);
  });
});

describe('isOneOff', () => {
  const made = NOW - 90 * DAY;
  const f = (spanMs, idleMs) => ({ name: 'Zarrin', observed_at: iso(made), log_first_at: iso(NOW - idleMs - spanMs), log_last_at: iso(NOW - idleMs) });

  it('a log under a day long that went quiet 30+ days ago is one-off', () => {
    expect(isOneOff(f(40 * 60_000, 60 * DAY), NOW)).toBe(true);
  });
  it('both halves are needed: an alt that was played for days, then parked, is NOT one-off', () => {
    expect(isOneOff(f(5 * DAY, 60 * DAY), NOW)).toBe(false);
  });
  it('and a brand new character with a short log is NOT one-off', () => {
    expect(isOneOff(f(40 * 60_000, 2 * DAY), NOW)).toBe(false);
  });
  it('the edges: exactly a day of play is not under a day; exactly 30 days quiet is enough', () => {
    expect(isOneOff(f(ONE_OFF_MAX_SPAN_MS, 60 * DAY), NOW)).toBe(false);
    expect(isOneOff(f(ONE_OFF_MAX_SPAN_MS - 1, 60 * DAY), NOW)).toBe(true);
    expect(isOneOff(f(60_000, ONE_OFF_IDLE_MS), NOW)).toBe(true);
    expect(isOneOff(f(60_000, ONE_OFF_IDLE_MS - 1), NOW)).toBe(false);
  });
  it('no log, an unreadable log, or an impossible one is never called one-off', () => {
    expect(isOneOff({ name: 'Zarrin', observed_at: iso(made) }, NOW)).toBe(false);
    expect(isOneOff({ name: 'Zarrin', observed_at: iso(made), log_first_at: null, log_last_at: null }, NOW)).toBe(false);
    expect(isOneOff({ name: 'Zarrin', observed_at: null, log_first_at: 'nonsense', log_last_at: 'nonsense' }, NOW)).toBe(false);
    expect(isOneOff({ name: 'Zarrin', observed_at: null, log_first_at: iso(NOW - 40 * DAY), log_last_at: iso(NOW - 50 * DAY) }, NOW)).toBe(false);
  });
});

describe('isSnapshotStale', () => {
  const wrote = NOW - 5 * DAY;
  const f = (lastMs) => ({ name: 'Aldenmar', observed_at: iso(wrote), log_last_at: lastMs === null ? null : iso(lastMs) });

  it('play after the inventory file was written is stale', () => {
    expect(isSnapshotStale(f(wrote + 3 * 3600_000))).toBe(true);
  });
  it('log activity right after the export (its own echo) is within the grace and is not stale', () => {
    expect(isSnapshotStale(f(wrote + 30_000))).toBe(false);
    expect(isSnapshotStale(f(wrote + STALE_GRACE_MS))).toBe(false);
    expect(isSnapshotStale(f(wrote + STALE_GRACE_MS + 1))).toBe(true);
  });
  it('a log that ends before the file was written is not stale', () => {
    expect(isSnapshotStale(f(wrote - DAY))).toBe(false);
  });
  it('no log, or no file time, means no claim', () => {
    expect(isSnapshotStale(f(null))).toBe(false);
    expect(isSnapshotStale({ name: 'Aldenmar', observed_at: null, log_last_at: iso(NOW) })).toBe(false);
  });
});

describe('classifyCharacters and dropCharacters', () => {
  const chars = [
    { name: 'Zarrin', observed_at: iso(NOW - 80 * DAY), log_first_at: iso(NOW - 81 * DAY), log_last_at: iso(NOW - 81 * DAY + 600_000) },
    { name: 'Aldenmar', observed_at: iso(NOW - 3 * DAY), log_first_at: iso(NOW - 400 * DAY), log_last_at: iso(NOW - DAY) },
    { name: 'Brackwyn', observed_at: iso(NOW - DAY), log_first_at: iso(NOW - 400 * DAY), log_last_at: iso(NOW - 2 * DAY) },
  ];
  it('names come back lowercased, one set per verdict', () => {
    const v = classifyCharacters(chars, NOW);
    expect([...v.oneOff]).toEqual(['zarrin']);
    expect([...v.stale]).toEqual(['aldenmar']);
  });
  it('hiding drops a character\'s own rows but keeps its shared-bank rows (the account uses them)', () => {
    const rows = [
      { character_name: 'Zarrin', slot_label: 'Primary' },
      { character_name: 'Zarrin', slot_label: 'Bank1' },
      { character_name: 'Zarrin', slot_label: 'SharedBank1-Slot1' },
      { character_name: 'Aldenmar', slot_label: 'Primary' },
    ];
    const kept = dropCharacters(rows, new Set(['zarrin']));
    expect(kept.map(r => `${r.character_name}:${r.slot_label}`)).toEqual(['Zarrin:SharedBank1-Slot1', 'Aldenmar:Primary']);
    expect(dropCharacters(rows, new Set())).toBe(rows);
  });
});

// ── the shared bank prefers a trustworthy snapshot ──────────────────────────────────────────────────────────
const bank = (character, observedAt, stale, itemSuffix = '') => Array.from({ length: 8 }, (_, i) => ({
  character, slot: `SharedBank${i + 1}-Slot1`, itemKey: `id:${100 + i}${itemSuffix}|1`, observedAt: iso(observedAt), stale,
}));
const counted = (rows, accountOf) => [...new Set(pickSharedRows(rows, accountOf).map(r => r.character))];
const together = new Map([['aldenmar', 'a'], ['brackwyn', 'a']]);

describe('pickSharedRows — freshest TRUSTWORTHY snapshot', () => {
  it('without any stale flag the freshest wins, as before', () => {
    const rows = [...bank('Aldenmar', NOW), ...bank('Brackwyn', NOW - DAY)];
    expect(counted(rows, together)).toEqual(['Aldenmar']);
  });
  it('a stale freshest snapshot yields to a trustworthy one a few hours older', () => {
    const rows = [...bank('Aldenmar', NOW, true), ...bank('Brackwyn', NOW - 6 * 3600_000, false)];
    expect(counted(rows, together)).toEqual(['Brackwyn']);
  });
  it('but not to one older than the preference window: a genuinely newer export still wins', () => {
    const rows = [...bank('Aldenmar', NOW, true), ...bank('Brackwyn', NOW - TRUST_PREFERENCE_WINDOW_MS - 3600_000, false)];
    expect(counted(rows, together)).toEqual(['Aldenmar']);
  });
  it('when every snapshot is stale the freshest still counts', () => {
    const rows = [...bank('Aldenmar', NOW, true), ...bank('Brackwyn', NOW - DAY, true)];
    expect(counted(rows, together)).toEqual(['Aldenmar']);
  });
  it('a stale snapshot alone on its account still counts (nothing else to trust)', () => {
    expect(counted(bank('Aldenmar', NOW, true), new Map())).toEqual(['Aldenmar']);
  });
});

describe('aggregateInventory with placements — what the local header says', () => {
  const row = (character, slot, id, name, qty, observedMs) => ({
    character_name: character, slot_label: slot, item_id: id, item_name: name, quantity: qty, observed_at: iso(observedMs),
  });
  // Two characters of ONE game account whose shared-bank snapshots are weeks apart and barely agree (the
  // inference can not link them), plus a third on its own account.
  const old = NOW - 40 * DAY;
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row('Aldenmar', `SharedBank${i + 1}-Slot1`, 200 + i, `Item ${i}`, 1, NOW)),
    ...Array.from({ length: 6 }, (_, i) => row('Brackwyn', `SharedBank${i + 1}-Slot1`, 300 + i, `Other ${i}`, 1, old)),
    ...Array.from({ length: 6 }, (_, i) => row('Corvale', `SharedBank${i + 1}-Slot1`, 400 + i, `Third ${i}`, 1, NOW)),
  ];
  const placements = [
    { character: 'Aldenmar', accountId: 'acct-1', slot: 1, label: null },
    { character: 'Brackwyn', accountId: 'acct-1', slot: 1, label: null },
    { character: 'Corvale', accountId: 'acct-2', slot: 2, label: null },
  ];

  it('guessing counts three accounts; the owner\'s list says two', () => {
    expect(aggregateInventory(rows).sharedAccountCount).toBe(3);
    const withList = aggregateInventory(rows, placements);
    expect(withList.sharedAccountCount).toBe(2);
    expect(withList.sharedCharacterCount).toBe(3);   // "Shared banks: 2 accounts (3 characters)"
  });
  it('the account counts once, from its freshest snapshot', () => {
    const a = aggregateInventory(rows, placements);
    expect(a.items.some(i => i.name === 'Item 0')).toBe(true);
    expect(a.items.some(i => i.name === 'Other 0')).toBe(false);
  });
  it('reports when the counted shared bank came from a stale snapshot', () => {
    const a = aggregateInventory(rows, placements, new Map(), new Set(['aldenmar', 'brackwyn']));
    // both stale -> freshest still counts, and the caller is told
    expect(a.staleSharedSources).toEqual(['Aldenmar']);
    const b = aggregateInventory(rows, placements, new Map(), new Set(['aldenmar']));
    // Brackwyn is trustworthy but 40 days older than Aldenmar: outside the window, Aldenmar still counts, flagged
    expect(b.staleSharedSources).toEqual(['Aldenmar']);
    expect(aggregateInventory(rows, placements).staleSharedSources).toEqual([]);
  });
  it('planSharedBanks is untouched by the stale flag (it only changes which snapshot counts)', () => {
    const plain = planSharedBanks(rows.filter(r => /^SharedBank/.test(r.slot_label)).map(r => ({ character: r.character_name, slot: r.slot_label, itemKey: String(r.item_id), observedAt: r.observed_at })), placements);
    const flagged = planSharedBanks(rows.filter(r => /^SharedBank/.test(r.slot_label)).map(r => ({ character: r.character_name, slot: r.slot_label, itemKey: String(r.item_id), observedAt: r.observed_at, stale: true })), placements);
    expect(flagged.accountCount).toBe(plain.accountCount);
  });
});

describe('the local page wiring', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/local/app/inventory/LocalInventory.tsx'), 'utf8'));
  it('hands placements and the stale set to the SAME aggregation the website uses', () => {
    expect(page).toMatch(/aggregateInventory\(rows, data\.placements \?\? \[\], new Map\([^)]*\)\), verdicts\.stale\)/);
  });
  it('the one-off chip defaults to OFF and is remembered locally, behind try/catch', () => {
    expect(page).toMatch(/useState\(false\)/);
    expect(page).toMatch(/try \{ return localStorage\.getItem\(HIDE_ONE_OFF_KEY\) === '1'; \} catch/);
    expect(page).toMatch(/try \{ localStorage\.setItem\(HIDE_ONE_OFF_KEY/);
  });
  it('says what the header counts and offers the opt-out', () => {
    expect(page).toMatch(/Shared banks:/);
    expect(page).toMatch(/Hide one-off characters \(\{oneOffNames\.length\}\)/);
    expect(page).toMatch(/Use my account list from wolfpack\.quest/);
    expect(page).toMatch(/'\/api\/local\/account-list'/);
  });
  it('the local page never sends inventory anywhere: its only POST is the opt-out switch', () => {
    expect(page.match(/method:\s*'POST'/g)).toHaveLength(1);
  });
});
