// test/inventory-aggregate.test.js — the account-inventory aggregation, now a pure lib
// (web/lib/inventoryAggregate.ts) shared by the hosted /me/inventory page and the local page that ships
// inside Mimic (web/local, "On this PC").
//
// The lib was MOVED out of web/app/me/inventory/page.tsx (the hosted page's behaviour must not change), so
// the first block runs the lib against a frozen copy of the code that used to live inline in that page, on
// the same fixture, and requires identical output. The second block pins the rules the move must keep:
// the shared bank counted once per game account, tags from item meta, and the local page's no-meta case.
//
// Run: npx vitest run test/inventory-aggregate.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateInventory, locGroup, tagsFor } from '../web/lib/inventoryAggregate.ts';
import { planSharedBanks, pickSharedRows } from '../web/lib/sharedBank.ts';
import { stripJs, ROOT } from './_source-slice.js';

// ── The old inline code, verbatim in behaviour (web/app/me/inventory/page.tsx before the extraction) ──────
function legacyLocGroup(slot) {
  const s = slot || '';
  if (/^SharedBank/i.test(s)) return 'shared';
  if (/^Bank/i.test(s)) return 'bank';
  if (/^(General|Cursor)/i.test(s) || /-Slot/i.test(s)) return 'bags';
  return 'equipped';
}
const LEGACY_CONSUMABLE = new Set([14, 15, 20, 21, 38]);
function legacyTagsFor(m, name) {
  const t = [];
  const isSpell = /^(Spell|Song|Tome|Ancient):\s/i.test(name) || m?.itemtype === 20;
  if (isSpell) t.push('spell');
  if (m) {
    if ((m.damage ?? 0) > 0) t.push('weapon');
    if ((m.ac ?? 0) > 0 && (m.damage ?? 0) === 0) t.push('armor');
    if (m.nodrop === false) t.push('nodrop');
    if (!isSpell && (m.damage ?? 0) === 0 && (m.ac ?? 0) === 0 && (m.slots ?? 0) === 0
        && !LEGACY_CONSUMABLE.has(m.itemtype ?? -1)) t.push('tradeskill');
  }
  return t;
}
function legacyAggregate(rows, placements, metaById) {
  const sharedRows = rows
    .filter(r => legacyLocGroup(r.slot_label) === 'shared')
    .map(r => ({
      character: r.character_name,
      slot:      r.slot_label,
      itemKey:   (r.item_id ? `id:${r.item_id}` : `nm:${r.item_name.toLowerCase()}`)
                 + '|' + String(r.quantity ?? 1),
      observedAt: r.observed_at,
      inv: r,
    }));
  const plan = planSharedBanks(sharedRows, placements);
  const countedShared = new Set(pickSharedRows(sharedRows, plan.accountOf).map(s => s.inv));
  const accountById = new Map(plan.accounts.map(a => [a.id, a]));
  const byKey = new Map();
  for (const r of rows) {
    const grp = legacyLocGroup(r.slot_label);
    if (grp === 'shared' && !countedShared.has(r)) continue;
    const key = r.item_id ? `id:${r.item_id}` : `nm:${r.item_name.toLowerCase()}`;
    let it = byKey.get(key);
    if (!it) {
      it = { key, item_id: r.item_id ?? null, name: r.item_name, total: 0,
             tags: legacyTagsFor(r.item_id ? metaById.get(r.item_id) : undefined, r.item_name), holdings: [] };
      byKey.set(key, it);
    }
    const qty = Math.max(1, r.quantity ?? 1);
    it.total += qty;
    const acct = grp === 'shared' ? accountById.get(plan.accountOf.get(r.character_name.toLowerCase()) ?? '') : undefined;
    const h = acct
      ? it.holdings.find(x => x.account?.id === acct.id)
      : it.holdings.find(x => !x.account && x.character === r.character_name && x.location === grp);
    if (h) h.qty += qty;
    else it.holdings.push(acct
      ? { character: acct.label, location: grp, qty, account: { id: acct.id, label: acct.label, members: acct.members, placed: acct.placed } }
      : { character: r.character_name, location: grp, qty });
  }
  const items = [...byKey.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { items, sharedAccountCount: plan.accountCount, oversized: plan.oversized };
}

// ── Fixture: invented names only (Aldenmar, Brackwyn, Corvale, Rethlan, Nyssara) ─────────────────────────
// Aldenmar + Brackwyn read the SAME shared bank (Brackwyn's snapshot is a few minutes older and one stack
// has since moved). Corvale is on another account with a different bank. Rethlan + Nyssara have no shared
// bank rows at all.
const SHARED = [
  ['Words of Quiet Tides', 41001, 3], ['Pristine Wolfhide', 41002, 12], ['Shard of Cinder Glass', 41003, 8],
  ['Quill of Faint Stars', 41004, 1], ['Velvet Dusk Mantle', 41005, 2], ['Spell: Tide Warding', 41006, 2],
];
const row = (character_name, slot_label, item_name, item_id, quantity, observed_at) =>
  ({ character_name, slot_label, item_name, item_id, quantity, observed_at });
const T1 = '2026-10-20T18:00:00Z';
const T2 = '2026-10-20T18:09:00Z';
function bankRows(character, at, drift) {
  return SHARED.map(([name, id, qty], i) =>
    row(character, `SharedBank${i + 1}-Slot1`, name, id, drift && i === 0 ? qty + 1 : qty, at));
}
const ROWS = [
  row('Aldenmar', 'Primary', 'Rustfang Cleaver', 51001, 1, T2),
  row('Aldenmar', 'Head', 'Dented Oathbreaker Helm', 51002, 1, T2),
  row('Aldenmar', 'Bank1-Slot2', 'Sunwoven Bracer', 51003, 1, T2),
  row('Aldenmar', 'General1-Slot1', 'Sunwoven Bracer', 51003, 1, T2),
  ...bankRows('Aldenmar', T2, false),
  row('Brackwyn', 'General2-Slot3', 'Shard of Cinder Glass', 41003, 6, T1),
  row('Brackwyn', 'Bank3', 'Ashen Mirror Charm', 51004, 1, T1),
  ...bankRows('Brackwyn', T1, true),
  row('Corvale', 'Charm', 'Hexed Pilgrim\'s Staff', 51005, 1, T2),
  row('Corvale', 'General1', 'Pristine Wolfhide', 41002, 12, T2),
  row('Corvale', 'SharedBank1-Slot1', 'Tarnished Sentinel Ring', 61001, 1, T2),
  row('Corvale', 'SharedBank2-Slot1', 'Ember Thread', 61002, 4, T2),
  row('Corvale', 'SharedBank3-Slot1', 'Glassblown Phial', 61003, 2, T2),
  row('Corvale', 'SharedBank4-Slot1', 'Dewdrop Prism', 61004, 9, T2),
  row('Corvale', 'SharedBank5-Slot1', 'Hollow Reed', 61005, 5, T2),
  row('Corvale', 'SharedBank6-Slot1', 'Tarnished Sentinel Ring', 61001, 1, T2),
  row('Rethlan', 'Fingers', 'Tarnished Sentinel Ring', 61001, 2, T2),
  row('Rethlan', 'Bank1', 'Sunwoven Bracer', 51003, 1, T2),
  row('Nyssara', 'Cursor', 'Quill of Faint Stars', 41004, 1, T2),
  row('Nyssara', 'General3-Slot4', 'No Id Curio', null, 2, T2),
  row('Nyssara', 'General3-Slot5', 'no id curio', null, 1, T2),
];
const META = new Map([
  [51001, { id: 51001, damage: 12, ac: 0, nodrop: true, itemtype: 1, slots: 8192 }],     // weapon
  [51002, { id: 51002, damage: 0, ac: 9, nodrop: true, itemtype: 10, slots: 4 }],        // armor
  [51003, { id: 51003, damage: 0, ac: 3, nodrop: true, itemtype: 10, slots: 1536 }],     // armor
  [51004, { id: 51004, damage: 0, ac: 0, nodrop: false, itemtype: 11, slots: 0 }],       // nodrop + tradeskill
  [41003, { id: 41003, damage: 0, ac: 0, nodrop: true, itemtype: 17, slots: 0 }],        // tradeskill
  [41006, { id: 41006, damage: 0, ac: 0, nodrop: true, itemtype: 20, slots: 0 }],        // spell by itemtype
]);

describe('aggregateInventory — parity with the code that used to live in the page', () => {
  it('matches the old inline aggregation exactly (no placements, inference only)', () => {
    expect(aggregateInventory(ROWS, [], META)).toEqual(legacyAggregate(ROWS, [], META));
  });
  it('matches with owner-placed game accounts', () => {
    const placements = [
      { character: 'Rethlan', accountId: 'acct-9', label: 'Alt account', slot: 3 },
      { character: 'Nyssara', accountId: 'acct-9', label: 'Alt account', slot: 3 },
    ];
    expect(aggregateInventory(ROWS, placements, META)).toEqual(legacyAggregate(ROWS, placements, META));
  });
  it('matches with no item meta at all (the local page today)', () => {
    expect(aggregateInventory(ROWS, [], new Map())).toEqual(legacyAggregate(ROWS, [], new Map()));
  });
  it('locGroup and tagsFor are the old functions', () => {
    for (const s of ['Primary', 'Bank1', 'Bank1-Slot2', 'SharedBank6-Slot9', 'General3-Slot4', 'Cursor', 'Charm', 'Fingers']) {
      expect(locGroup(s)).toBe(legacyLocGroup(s));
    }
    for (const [id, m] of META) expect(tagsFor(m, 'x')).toEqual(legacyTagsFor(m, 'x'));
    expect(tagsFor(undefined, 'Spell: Tide Warding')).toEqual(legacyTagsFor(undefined, 'Spell: Tide Warding'));
  });
});

describe('aggregateInventory — the rules', () => {
  const agg = aggregateInventory(ROWS, [], META);
  const byName = Object.fromEntries(agg.items.map(i => [i.name, i]));

  it('THE CASE: a shared-bank stack read by two characters of one account counts ONCE (the freshest snapshot)', () => {
    // Aldenmar's snapshot is newer (T2): Pristine Wolfhide x12 in the shared bank, not 24 and not 25.
    const wolfhide = byName['Pristine Wolfhide'];
    const shared = wolfhide.holdings.filter(h => h.location === 'shared');
    expect(shared).toHaveLength(1);
    expect(shared[0].qty).toBe(12);
    expect(shared[0].account.members).toEqual(['Aldenmar', 'Brackwyn']);
    expect(shared[0].account.placed).toBe(false);
    // Corvale's own bags are a separate, plain holding: total = 12 shared (once) + 12 bags.
    expect(wolfhide.total).toBe(24);
  });

  it('the stale snapshot is dropped whole: its moved stack does not leak in', () => {
    // Brackwyn's older snapshot had Words of Quiet Tides at 4; the account counts the newer 3.
    expect(byName['Words of Quiet Tides'].total).toBe(3);
  });

  it('a lone character with a shared bank keeps a plain character holding, not an account one', () => {
    const ring = byName['Tarnished Sentinel Ring'];
    const corvale = ring.holdings.find(h => h.character === 'Corvale' && h.location === 'shared');
    expect(corvale).toBeTruthy();
    expect(corvale.account).toBeUndefined();
  });

  it('counts the shared accounts it saw', () => {
    expect(agg.sharedAccountCount).toBe(2);
  });

  it('tags come from item meta; with no meta only the name-based spell tag survives', () => {
    expect(byName['Rustfang Cleaver'].tags).toEqual(['weapon']);
    expect(byName['Dented Oathbreaker Helm'].tags).toEqual(['armor']);
    expect(byName['Ashen Mirror Charm'].tags).toEqual(['nodrop', 'tradeskill']);
    expect(byName['Shard of Cinder Glass'].tags).toEqual(['tradeskill']);
    expect(byName['Spell: Tide Warding'].tags).toEqual(['spell']);
    const bare = aggregateInventory(ROWS, [], new Map());
    const bareBy = Object.fromEntries(bare.items.map(i => [i.name, i]));
    expect(bareBy['Rustfang Cleaver'].tags).toEqual([]);
    expect(bareBy['Spell: Tide Warding'].tags).toEqual(['spell']);
  });

  it('rows without an item id group by lower-cased name', () => {
    expect(byName['No Id Curio'].total).toBe(3);
    expect(byName['No Id Curio'].holdings).toHaveLength(1);
  });

  it('sorts by total, then name', () => {
    const totals = agg.items.map(i => i.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('owner-placed accounts beat inference and label the holding', () => {
    const placements = [
      { character: 'Aldenmar', accountId: 'acct-1', label: 'Main account', slot: 1 },
      { character: 'Brackwyn', accountId: 'acct-1', label: 'Main account', slot: 1 },
    ];
    const placed = aggregateInventory(ROWS, placements, META);
    const w = placed.items.find(i => i.name === 'Pristine Wolfhide').holdings.find(h => h.location === 'shared');
    expect(w.account.placed).toBe(true);
    expect(w.character).toBe('Main account (Aldenmar, Brackwyn)');
  });
});

describe('the hosted page uses the lib and keeps its own wiring', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/me/inventory/page.tsx'), 'utf8'));
  it('aggregates through aggregateInventory, no inline copy of the rules', () => {
    expect(page).toMatch(/aggregateInventory\(rows, placements, metaById\)/);
    expect(page).not.toMatch(/function locGroup|function tagsFor|planSharedBanks|pickSharedRows/);
  });
  it('still reads the owner-private rows through the service role, paginated', () => {
    expect(page).toMatch(/selectAll<InvRow>/);
    expect(page).toMatch(/\.from\('character_inventory'\)/);
    expect(page).toMatch(/loadAccountPlacements\(admin, GUILD_TAG, charNames\)/);
  });
});
