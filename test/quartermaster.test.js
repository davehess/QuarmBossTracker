// test/quartermaster.test.js — #82 Quartermaster v1.
//
// Real-imports the new pure lib (web/lib/quartermaster.ts). Covers Board 1
// utility-kit coverage assembly (distinct-owner dedup, family main resolution,
// nobody / class-scoped gaps) and Board 2 quest-step matching (item-id vs
// name-only vs label-only "unknown", quantity thresholds, optional steps, and
// the completion rollup). Fixtures over live data.

import { describe, it, expect } from 'vitest';
import {
  KIT_CATALOG,
  KIT_ITEM_IDS,
  computeKitCoverage,
  ownedFromRows,
  matchStep,
  computeQuestProgress,
} from '../web/lib/quartermaster.ts';

// ── Board 1 — utility-kit coverage ───────────────────────────────────────────

describe('KIT_CATALOG', () => {
  it('has 8-15 well-attested entries with unique keys and non-empty item ids', () => {
    expect(KIT_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(KIT_CATALOG.length).toBeLessThanOrEqual(15);
    const keys = new Set(KIT_CATALOG.map((e) => e.key));
    expect(keys.size).toBe(KIT_CATALOG.length);
    for (const e of KIT_CATALOG) expect(e.itemIds.length).toBeGreaterThan(0);
  });

  it('KIT_ITEM_IDS flattens + dedups every catalog id', () => {
    expect(KIT_ITEM_IDS).toContain(999);    // Shield of the Immaculate
    expect(KIT_ITEM_IDS).toContain(11551);  // its variant id — both present
    expect(KIT_ITEM_IDS.length).toBe(new Set(KIT_ITEM_IDS).size);
  });
});

// A tiny fixture catalog so coverage assertions don't move when the real
// catalog grows.
const FIX_CATALOG = [
  { key: 'cure', label: 'Cure Shield', category: 'cure', itemIds: [10, 11], grants: 'x', wantClass: 'Cleric' },
  { key: 'lev', label: 'Lev Cloak', category: 'travel', itemIds: [20], grants: 'x' },
  { key: 'charm', label: 'Puppet Thing', category: 'charm', itemIds: [30], grants: 'x' },
];

describe('computeKitCoverage', () => {
  const rows = [
    // Fronzz owns the cure shield in two slots + via both variant ids → ONE owner.
    { itemId: 10, character: 'Fronzz', main: 'Squeekie', className: 'Cleric' },
    { itemId: 11, character: 'Fronzz', main: 'Squeekie', className: 'Cleric' },
    { itemId: 10, character: 'Fargan', main: 'Fargan', className: 'Cleric' },
    // Lev cloak owned by two non-clerics.
    { itemId: 20, character: 'Wabumkin', main: 'Wabumkin', className: 'Wizard' },
    { itemId: 20, character: 'Adiwen', main: 'Wabumkin', className: 'Enchanter' },
    // charm (id 30) owned by NOBODY.
  ];
  const cov = computeKitCoverage(FIX_CATALOG, rows);
  const byKey = Object.fromEntries(cov.map((c) => [c.entry.key, c]));

  it('dedups a character across slots and variant ids', () => {
    expect(byKey.cure.ownerCount).toBe(2);              // Fronzz + Fargan, not 3
    expect(byKey.cure.owners.map((o) => o.character)).toEqual(['Fargan', 'Fronzz']);
    expect(byKey.cure.owners[1].main).toBe('Squeekie'); // family main resolved
    expect(byKey.cure.gap).toBeNull();                  // a Cleric owns it
  });

  it('falls back to the character as its own main when main is blank', () => {
    const c = computeKitCoverage([FIX_CATALOG[1]], [
      { itemId: 20, character: 'Solo', main: null, className: 'Bard' },
    ]);
    expect(c[0].owners[0].main).toBe('Solo');
  });

  it('flags a nobody gap', () => {
    expect(byKey.charm.ownerCount).toBe(0);
    expect(byKey.charm.gap).toBe('Nobody owns Puppet Thing');
  });

  it('flags a class-scoped gap when owners exist but none is the wanted class', () => {
    const c = computeKitCoverage([FIX_CATALOG[0]], [
      { itemId: 10, character: 'Wabumkin', main: 'Wabumkin', className: 'Wizard' },
    ]);
    expect(c[0].ownerCount).toBe(1);
    expect(c[0].gap).toBe('No Cleric owns Cure Shield');
  });

  it('honors level-title class folding for the wanted class (Templar = Cleric)', () => {
    const c = computeKitCoverage([FIX_CATALOG[0]], [
      { itemId: 11, character: 'Fargan', main: 'Fargan', className: 'Templar' },
    ]);
    expect(c[0].gap).toBeNull();
  });
});

// ── Board 2 — quest-step matching ────────────────────────────────────────────

describe('ownedFromRows + matchStep', () => {
  const owned = ownedFromRows([
    { item_id: 29216, item_name: 'Quarter of a Diaku Emblem', quantity: 1 },
    { item_id: 22185, item_name: 'A Lucid Shard', quantity: 1 },
    { item_id: null, item_name: 'Bone Chips', quantity: 4 },
  ]);

  it('detects an item-id step (same-name components stay distinct by id)', () => {
    expect(matchStep({ label: 'p1', itemId: 29216 }, owned).status).toBe('have');
    expect(matchStep({ label: 'p2', itemId: 29217 }, owned).status).toBe('missing'); // different id, not held
  });

  it('enforces a quantity threshold on id AND name matches', () => {
    // Name-only rows sum quantity too: 4 held < 8 needed → missing; 4 needed → have.
    expect(matchStep({ label: 'chips', itemName: 'Bone Chips', quantity: 8 }, owned).status).toBe('missing');
    expect(matchStep({ label: 'chips', itemName: 'Bone Chips', quantity: 4 }, owned).status).toBe('have');
    const single = matchStep({ label: 'shard', itemId: 22185, quantity: 1 }, owned);
    expect(single.status).toBe('have');
    expect(single.haveQty).toBe(1);
  });

  it('matches a name-only step case-insensitively', () => {
    expect(matchStep({ label: 'shard', itemName: 'a lucid shard' }, owned).status).toBe('have');
    expect(matchStep({ label: 'nope', itemName: 'Totally Absent' }, owned).status).toBe('missing');
  });

  it('reports a label-only step as unknown (officer/manual territory)', () => {
    expect(matchStep({ label: 'Hail Diabo Xi Xin', quantity: 1 }, owned).status).toBe('unknown');
  });
});

describe('computeQuestProgress', () => {
  const quest = {
    id: 1,
    name: 'Emperor Ssraeshza Key',
    steps: [
      { label: 'Quarter 1', itemId: 29216 },
      { label: 'Quarter 2', itemId: 29217 },
      { label: 'Completed Diaku Emblem', itemId: 29215 },
      { label: 'Officer-verify: final hail', /* label-only */ },
      { label: 'Optional spare', itemId: 29999, optional: true },
    ],
  };

  it('counts only required, detectable steps toward completion; unknowns do not block', () => {
    const owned = ownedFromRows([{ item_id: 29216, item_name: 'Quarter of a Diaku Emblem', quantity: 1 }]);
    const p = computeQuestProgress(quest, owned);
    expect(p.detectable).toBe(3);      // 3 item-backed required steps (optional + label-only excluded)
    expect(p.have).toBe(1);            // only Quarter 1 held
    expect(p.complete).toBe(false);
    expect(p.hasUnknown).toBe(true);   // the label-only step
  });

  it('is complete when every required detectable step is satisfied', () => {
    const owned = ownedFromRows([
      { item_id: 29216, item_name: 'q1', quantity: 1 },
      { item_id: 29217, item_name: 'q2', quantity: 1 },
      { item_id: 29215, item_name: 'done', quantity: 1 },
    ]);
    const p = computeQuestProgress(quest, owned);
    expect(p.have).toBe(3);
    expect(p.detectable).toBe(3);
    expect(p.complete).toBe(true);     // label-only + optional steps don't hold it back
  });

  it('is never complete when nothing is detectable', () => {
    const labelOnly = { id: 2, name: 'All flags', steps: [{ label: 'hail A' }, { label: 'hail B' }] };
    const p = computeQuestProgress(labelOnly, ownedFromRows([]));
    expect(p.detectable).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.hasUnknown).toBe(true);
  });
});
