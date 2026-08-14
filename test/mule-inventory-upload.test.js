// test/mule-inventory-upload.test.js — bringing in characters nothing else can see.
//
// Hitya, 2026-08-14: "can you make it so that anyone can upload additional
// inventory files from the /me page and have it bring in their other
// characters/mules?"
//
// The existing per-character 🎒 upload cannot: it is gated on the character
// ALREADY being in `characters` AND already linked to your discord_id, which is
// exactly what a mule is not. Pyxil's bank toons (Archanistsells, Lavenderna,
// Pyxtrade…) have no logs, no /who sighting and no OpenDKP row — Mimic only
// knows they exist from per-character ini files in C:\TAKPv22. The inventory
// file is the only thing that carries both the data AND the identity.
//
// Two things can go badly wrong here and both are tested hard:
//   • the NAME comes from the file name, so a bad parse invents a junk
//     character row somebody has to clean up;
//   • creating the row is a CLAIM, so the rules about when we may claim decide
//     whether an upload can quietly take someone else's character.
//
// Run: npx vitest run test/mule-inventory-upload.test.js

import { describe, it, expect } from 'vitest';
import {
  parseInventory, characterFromInventoryFilename, claimVerdict,
} from '../web/lib/inventoryFile.ts';

const HOUSEHOLD = new Set(['111', '222']);      // one person, two Discord ids
const other = { name: 'Wabumkin', discord_id: '999', opendkp_id: 7 };

describe('working out whose file this is', () => {
  it('reads the character out of what EQ actually writes', () => {
    expect(characterFromInventoryFilename('Pyxtrade-Inventory.txt')).toBe('Pyxtrade');
  });

  it('accepts the spellings people end up with', () => {
    for (const f of [
      'Pyxtrade_Inventory.txt', 'Pyxtrade Inventory.txt', 'Pyxtrade-inventory.txt',
      'PyxtradeInventory.txt', 'Pyxtrade.txt',
    ]) {
      expect(characterFromInventoryFilename(f), f).toBe('Pyxtrade');
    }
  });

  it('survives the copies people keep', () => {
    // Browsers add " (1)"; players add dates when they keep a history.
    expect(characterFromInventoryFilename('Pyxtrade-Inventory (1).txt')).toBe('Pyxtrade');
    expect(characterFromInventoryFilename('Pyxtrade-Inventory-2026-08-14.txt')).toBe('Pyxtrade');
    expect(characterFromInventoryFilename('Pyxtrade-Inventory copy.txt')).toBe('Pyxtrade');
  });

  it('strips a directory when one comes along', () => {
    expect(characterFromInventoryFilename('C:\\TAKPv22\\Pyxtrade-Inventory.txt')).toBe('Pyxtrade');
    expect(characterFromInventoryFilename('/home/x/Kalee-Inventory.txt')).toBe('Kalee');
  });

  it('normalises casing the way EQ does', () => {
    expect(characterFromInventoryFilename('PYXTRADE-Inventory.txt')).toBe('Pyxtrade');
    expect(characterFromInventoryFilename('pyxtrade-Inventory.txt')).toBe('Pyxtrade');
  });

  it('refuses anything that is not a plausible EQ name', () => {
    // EQ names are letters only — no digits, no spaces (the "Atlasius2 is a
    // backup file, not a person" finding). Guessing here creates a junk
    // character row that someone then has to delete.
    for (const f of [
      'Inventory.txt', '-Inventory.txt', 'Atlasius2-Inventory.txt',
      'My Guy-Inventory.txt', 'x-Inventory.txt', '', '   ', 'report.pdf',
    ]) {
      expect(characterFromInventoryFilename(f), f).toBeNull();
    }
  });

  it('does not mistake a real name ENDING in something for a marker', () => {
    // "Lavenderna" ends in "na", not a suffix we strip.
    expect(characterFromInventoryFilename('Lavenderna-Inventory.txt')).toBe('Lavenderna');
    expect(characterFromInventoryFilename('Archanistsells-Inventory.txt')).toBe('Archanistsells');
  });
});

describe('who may claim a character', () => {
  it('a brand-new name is created and claimed', () => {
    // Nothing in the guild has ever heard of it and the file was on your disk.
    expect(claimVerdict(null, HOUSEHOLD)).toEqual({ action: 'upload', claim: true });
  });

  it('one already yours uploads without re-claiming', () => {
    const mine = { name: 'Kalee', discord_id: '222', opendkp_id: null };
    expect(claimVerdict(mine, HOUSEHOLD)).toEqual({ action: 'upload', claim: false });
  });

  it('REFUSES a character that belongs to somebody else', () => {
    // The one that matters. An upload must never overwrite another member's
    // inventory snapshot or take their character.
    const v = claimVerdict(other, HOUSEHOLD);
    expect(v.action).toBe('refuse');
    expect(v.reason).toMatch(/another member/);
  });

  it('refuses even when the other person has no OpenDKP row', () => {
    expect(claimVerdict({ name: 'X', discord_id: '999', opendkp_id: null }, HOUSEHOLD).action)
      .toBe('refuse');
  });

  it('takes the data but NOT the character when it is a real unclaimed raider', () => {
    // An OpenDKP row means a genuine member who simply has not linked Discord.
    // Silently attaching them to whoever uploaded a file would be a theft with
    // a friendly UI.
    const unlinkedReal = { name: 'Someone', discord_id: null, opendkp_id: 42 };
    expect(claimVerdict(unlinkedReal, HOUSEHOLD)).toEqual({ action: 'upload-unclaimed', claim: false });
  });

  it('does claim a row that only exists from a sighting', () => {
    // No discord_id and no opendkp_id = conjured by a /who or a chat line.
    // That is the shape of a mule someone typed at once, so it is claimable.
    const ghost = { name: 'Pyxtrade', discord_id: null, opendkp_id: null };
    expect(claimVerdict(ghost, HOUSEHOLD)).toEqual({ action: 'upload', claim: true });
  });

  it('honours the whole household, not just the signed-in id', () => {
    // A person with two merged Discord accounts owns characters on both.
    const onAlias = { name: 'Kalee', discord_id: '111', opendkp_id: null };
    expect(claimVerdict(onAlias, HOUSEHOLD).action).toBe('upload');
    expect(claimVerdict(onAlias, new Set(['333'])).action).toBe('refuse');
  });
});

describe('reading the inventory itself', () => {
  const file = [
    'Location\tName\tID\tCount\tSlots',
    'General1\tBone Chips\t13073\t20\t0',
    'General2\tEmpty\t0\t0\t0',
    'Bank1\tRune of Al`Kabor\t28034\t1\t0',
    'Bank-Coin\tCurrency\t0\t4210\t0',
  ].join('\n');

  it('keeps the real items', () => {
    const rows = parseInventory(file);
    expect(rows.map(r => r.item_name)).toEqual(['Bone Chips', 'Rune of Al`Kabor']);
    expect(rows[0]).toMatchObject({ slot_label: 'General1', item_id: 13073, quantity: 20 });
  });

  it('drops the header, empty slots and coin rows', () => {
    const rows = parseInventory(file);
    expect(rows.some(r => /empty/i.test(r.item_name))).toBe(false);
    expect(rows.some(r => /-Coin$/i.test(r.slot_label))).toBe(false);
    // Coin would otherwise land as a 4,210-quantity "item" and skew every
    // aggregate built on this table.
    expect(rows.every(r => r.quantity < 1000)).toBe(true);
  });

  it('reads space-padded files too', () => {
    const rows = parseInventory('General1    Bone Chips    13073    20    0');
    expect(rows).toHaveLength(1);
    expect(rows[0].item_id).toBe(13073);
  });

  it('keeps an item whose id we do not know, rather than dropping it', () => {
    // A Quarm-custom item the weekly catalog sync has not seen. The name is
    // still worth having.
    const rows = parseInventory('General3\tSome Custom Thing\t0\t1\t0');
    expect(rows).toHaveLength(1);
    expect(rows[0].item_id).toBeNull();
  });

  it('never returns two rows for one slot', () => {
    const rows = parseInventory('General1\tA\t1\t1\t0\nGeneral1\tB\t2\t1\t0');
    expect(rows).toHaveLength(1);
  });

  it('returns nothing for something that is not an inventory file', () => {
    expect(parseInventory('')).toEqual([]);
    expect(parseInventory('just some prose about nothing at all')).toEqual([]);
    expect(parseInventory('[Wed Aug 13 22:24:01 2026] You have entered Vex Thal.')).toEqual([]);
  });
});

describe('the server action holds the line', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT } = require('./_source-slice.js');
  const src = fs.readFileSync(path.join(ROOT, 'web', 'app', 'me', 'inventory-actions.ts'), 'utf8');
  const ui  = fs.readFileSync(path.join(ROOT, 'web', 'app', 'me', 'MuleUpload.tsx'), 'utf8');

  it('requires a signed-in, Discord-linked member', () => {
    const fn = src.slice(src.indexOf('export async function uploadMuleInventories'));
    expect(fn).toMatch(/if \(!user\) return \{ ok: false, results: \[\], error: 'not signed in' \}/);
    expect(fn).toMatch(/your Discord account is not linked yet/);
  });

  it('decides claims through the shared kernel, not its own copy', () => {
    // A second implementation of "may I take this character" is how the two
    // would drift into disagreeing.
    expect(src).toMatch(/const verdict = claimVerdict\(existing \?\? null, household\);/);
    expect(src).toMatch(/if \(verdict\.action === 'refuse'\)/);
  });

  it('stamps the web-registration audit trail when it creates a character', () => {
    expect(src).toMatch(/registered_via_web_at: new Date\(\)\.toISOString\(\)/);
    expect(src).toMatch(/registered_via_web_by_discord_id: me\.discord_id/);
  });

  it('reports per FILE, so a mixed batch says which ones failed', () => {
    expect(src).toMatch(/const results: MuleResult\[\] = \[\]/);
    expect(src).toMatch(/results\.push\(\{ file: fileName/);
  });

  it('refuses two files for the same character in one batch', () => {
    // Both would be replace-semantics writes to one snapshot; the second would
    // silently win and the user would never know which.
    expect(src).toMatch(/two files for the same character in one batch/);
  });

  it('bounds the batch on both sides', () => {
    expect(src).toMatch(/\.slice\(0, 40\)/);
    expect(ui).toMatch(/const MAX_FILES = 40;/);
    expect(ui).toMatch(/const MAX_BYTES =/);
  });

  it('shares the snapshot write with the single-character upload', () => {
    expect(src).toMatch(/async function writeInventory\(canonical: string, rows: ParsedInvRow\[\]\)/);
    const single = src.slice(src.indexOf('export async function uploadInventory'), src.indexOf('async function writeInventory'));
    expect(single).toMatch(/await writeInventory\(canonical, rows\)/);
  });
});
