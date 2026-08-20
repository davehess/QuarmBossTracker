// test/inventory-upload-scan.test.js — the agent half of inventory auto-upload
// (SOURCE-SLICE fidelity tier: the parser is sliced out of the shipped agent).
//
// The gap this pins (Hitya 2026-08-20, "are the inventory lists missing or are
// we not consuming inventory files when they get updated?"): the bot's
// /api/agent/inventory endpoint existed since June but the agent never had a
// scan for <Char>-Inventory.txt — quarmy and spellbook shipped, inventory
// stayed manual-upload-only, and Ancient spell scrolls bought in August were
// invisible because the newest snapshot was July 15.
//
// Run: npx vitest run test/inventory-upload-scan.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(
  src,
  'function parseInventoryFileForUpload(',
  "return 'inv' + rows.length + '-' + crypto.createHash('sha1').update(parts).digest('hex').slice(0, 16);\n}",
);
// Stub crypto — the checksum's hashing is not under test, its shape is.
const { parseInventoryFileForUpload, _inventoryChecksum } = evalBlock(
  "const crypto = { createHash: () => ({ update: () => ({ digest: () => '0123456789abcdef0123456789abcdef' }) }) };\n" + block,
  ['parseInventoryFileForUpload', '_inventoryChecksum'],
);

const FILE = [
  'Location\tName\tID\tCount\tSlots',
  'Charm\tGuise of the Hunter\t31210\t1\t0',
  'General5\tBag of the Tinkerers\t32619\t1\t8',
  'General5-Slot1\tVeil of Hidden Thought\t26559\t1\t0',
  'General5-Slot2\tAncient: Legacy of Blades\t26609\t1\t0',
  'General5-Slot3\tEmpty\t0\t0\t0',
  'Held\tSome Cursor Item\t1234\t1\t0',
  'Bank1\tAncient Wyvern Hide Boots\t20622\t1\t0',
  'Bank1-Slot1\tPeridot\t10028\t14\t0',
  'Bank-Coin\tPlatinum\t0\t9999\t0',
  'Currency\tPlatinum\t0\t123\t0',
].join('\r\n');

describe('parseInventoryFileForUpload', () => {
  const rows = parseInventoryFileForUpload(FILE);
  const bySlot = Object.fromEntries(rows.map(r => [r.slot_label, r]));

  it('THE CASE: an Ancient spell scroll in a bag makes it into the rows', () => {
    expect(bySlot['General5-Slot2']).toEqual({
      slot_label: 'General5-Slot2', item_id: 26609,
      item_name: 'Ancient: Legacy of Blades', quantity: 1,
    });
  });

  it('worn, bag, and bank ITEM slots all upload; stack quantity survives', () => {
    expect(bySlot['Charm'].item_id).toBe(31210);
    expect(bySlot['General5'].item_name).toBe('Bag of the Tinkerers');
    expect(bySlot['Bank1'].item_name).toBe('Ancient Wyvern Hide Boots');
    expect(bySlot['Bank1-Slot1'].quantity).toBe(14);
  });

  it('coin, Currency, the Held cursor, Empty, and the header never leave the machine', () => {
    const slots = rows.map(r => r.slot_label);
    expect(slots).not.toContain('Bank-Coin');
    expect(slots).not.toContain('Currency');
    expect(slots).not.toContain('Held');
    expect(slots).not.toContain('General5-Slot3');   // Empty
    expect(slots).not.toContain('Location');
  });

  it('duplicate slot labels collapse to the first (schema is unique-by-slot)', () => {
    const dup = parseInventoryFileForUpload('A\tFirst\t1\t1\t0\nA\tSecond\t2\t1\t0');
    expect(dup).toHaveLength(1);
    expect(dup[0].item_name).toBe('First');
  });
});

describe('_inventoryChecksum', () => {
  it('is order-independent over the row set and carries the row count', () => {
    const rows = parseInventoryFileForUpload(FILE);
    const a = _inventoryChecksum(rows);
    const b = _inventoryChecksum([...rows].reverse());
    expect(a).toBe(b);
    expect(a.startsWith('inv' + rows.length + '-')).toBe(true);
  });
});
