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
  scopeKitCoverage,
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

// ── Board 1 — who may see an owner's NAME ────────────────────────────────────
//
// Hitya, 2026-08-14: "quartermaster should display raider information for that
// user not for everyone. it can display for everyone for admins."
//
// Board 1 shipped naming every owner of every utility item to every signed-in
// member. These are the tests that keep it from drifting back: a member sees
// their own characters and nobody else's, an officer sees the roster, and the
// nameless COUNT survives both ways (it is what makes a gap distinguishable
// from a blind spot).

describe('scopeKitCoverage', () => {
  const rows = [
    { itemId: 20, character: 'Hitya', main: 'Hitya', className: 'Cleric' },
    { itemId: 20, character: 'Uilnayar', main: 'Hitya', className: 'Enchanter' },
    { itemId: 20, character: 'Wabumkin', main: 'Wabumkin', className: 'Wizard' },
    { itemId: 20, character: 'Jankzer', main: 'Jankzer', className: 'Rogue' },
  ];
  const base = computeKitCoverage([FIX_CATALOG[1]], rows);
  const MINE = new Set(['hitya', 'uilnayar']);

  it('names only the viewer\'s own characters for a member', () => {
    const [c] = scopeKitCoverage(base, MINE, false);
    expect(c.owners.map(o => o.character)).toEqual(['Hitya', 'Uilnayar']);
    expect(c.yours).toBe(2);
  });

  it('never leaks another raider\'s NAME to a member, anywhere on the row', () => {
    // The assertion that actually matters — serialize the whole scoped row and
    // check no outsider's name appears in it, so a future field that carries
    // names (a "top owner", a tooltip) fails here instead of in production.
    const [c] = scopeKitCoverage(base, MINE, false);
    const blob = JSON.stringify(c);
    expect(blob).not.toMatch(/Wabumkin/);
    expect(blob).not.toMatch(/Jankzer/);
  });

  it('keeps the guild-wide COUNT, which names nobody', () => {
    // Deliberate: "4 own it, none of them you" is the useful answer and
    // identifies no one. Narrowing the count too would leave a member unable to
    // tell a real coverage gap from their own blind spot.
    const [c] = scopeKitCoverage(base, new Set(), false);
    expect(c.ownerCount).toBe(4);
    expect(c.owners).toEqual([]);
    expect(c.yours).toBe(0);
    expect(c.hidden).toBe(4);
  });

  it('gives officers the whole list', () => {
    const [c] = scopeKitCoverage(base, MINE, true);
    expect(c.owners).toHaveLength(4);
    expect(c.hidden).toBe(0);
    expect(c.yours).toBe(2);          // still tells an officer which are theirs
  });

  it('leaves the gap line alone — it is a guild fact, not a person', () => {
    const nobody = computeKitCoverage([FIX_CATALOG[2]], []);
    const [c] = scopeKitCoverage(nobody, new Set(), false);
    expect(c.gap).toBe('Nobody owns Puppet Thing');
    expect(c.ownerCount).toBe(0);
  });

  it('does not mutate the board it was given', () => {
    // The page scopes ONE guild-wide board per request; an in-place filter would
    // make the result depend on call order.
    const before = base[0].owners.length;
    scopeKitCoverage(base, MINE, false);
    expect(base[0].owners).toHaveLength(before);
    expect(base[0].hidden).toBe(0);
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
