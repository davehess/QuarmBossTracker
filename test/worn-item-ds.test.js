// test/worn-item-ds.test.js — the HUD's damage-shield badge adds the shield from worn gear
// (the guild lead, 2026-10-04: "Missing my additional DS from my neck slot. It only gets added when you
// have other damage shield" — a Talisman of Vah Kerrath, +8, on top of a 10-point shield spell, hit
// for 18 in game while the badge read 10).
//
// Runs the agent's real _setWornDsCatalog / _wornItemDs / _loadItemClickiesFromDisk against stub
// inventories; the DS block in _serializeMeState is checked as text (comments stripped).
// Run: npx vitest run test/worn-item-ds.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const WORN_SLOTS = sliceBlock(agent, 'const INVENTORY_WORN_SLOTS = new Set([', ']);');
const WORN_FNS = sliceBlock(agent, 'let _wornDsByItem = new Map();', '\n// ── XP events');

const CATALOG = [
  { id: 8364, name: 'Talisman of Vah Kerrath', ds: 8 },
  { id: 15805, name: 'Shroud of Eternity', ds: 5 },
];

function load({ inv = null, quarmy = null } = {}) {
  const block = `
    const stats = { characterInventories: ${JSON.stringify(inv ? { Aldenmar: inv } : {})} };
    function _quarmyLocalItems() { return ${JSON.stringify(quarmy)}; }
    ${WORN_SLOTS}
    ${WORN_FNS.replace(/\n\/\/ ── XP events$/, '')}
  `;
  return evalBlock(block, ['_setWornDsCatalog', '_wornItemDs']);
}

describe('_wornItemDs: the shield from the gear a character wears', () => {
  it('adds a worn Talisman of Vah Kerrath (+8) from /output inventory, matched by item id', () => {
    const h = load({ inv: { _updatedAt: '2026-10-04T20:00:00Z', items: [
      { name: 'Talisman of Vah Kerrath', id: 8364, count: 1, loc: 'Neck' },
      { name: 'Cloak of Flames', id: 1, count: 1, loc: 'Back' },
    ] } });
    h._setWornDsCatalog(CATALOG);
    expect(h._wornItemDs('aldenmar')).toBe(8);
  });

  it('counts only worn slots — not one in a bag or the bank', () => {
    const h = load({ inv: { items: [
      { name: 'Talisman of Vah Kerrath', id: 8364, count: 1, loc: 'General3-Slot2' },
      { name: 'Shroud of Eternity', id: 15805, count: 1, loc: 'Bank4' },
    ] } });
    h._setWornDsCatalog(CATALOG);
    expect(h._wornItemDs('Aldenmar')).toBe(0);
  });

  it('reads the Quarmy export when it is newer, with its numbered slots, and matches by name without an id', () => {
    const h = load({
      inv: { _updatedAt: '2026-09-01T00:00:00Z', items: [] },
      quarmy: { at: Date.parse('2026-10-04T00:00:00Z'), items: [
        { name: 'Talisman of Vah Kerrath', id: null, count: 1, loc: 'Neck' },
        { name: 'Shroud of Eternity', id: 15805, count: 1, loc: 'Back' },
        { name: 'Shroud of Eternity', id: 15805, count: 1, loc: 'General1' },
      ] },
    });
    h._setWornDsCatalog(CATALOG);
    expect(h._wornItemDs('Aldenmar')).toBe(13);
  });

  it('is 0 with no catalog (an older bot sends no worn_ds), and ignores entries with no positive ds', () => {
    const h = load({ inv: { items: [{ name: 'Talisman of Vah Kerrath', id: 8364, count: 1, loc: 'Neck' }] } });
    expect(h._wornItemDs('Aldenmar')).toBe(0);
    h._setWornDsCatalog(undefined);
    expect(h._wornItemDs('Aldenmar')).toBe(0);
    h._setWornDsCatalog([{ id: 8364, name: 'Talisman of Vah Kerrath', ds: 0 }]);
    expect(h._wornItemDs('Aldenmar')).toBe(0);
  });

  it('is 0 for a character with no export', () => {
    const h = load();
    h._setWornDsCatalog(CATALOG);
    expect(h._wornItemDs('Nobody')).toBe(0);
  });
});

describe('the HUD badge adds the gear shield only on top of a shield spell', () => {
  const body = stripJs(sliceBlock(agent, '  const dsKnown = _knownDsPerHitFor(active, dsWorn);', '  // HUD: swing timer'));

  // The ESTIMATE: what the badge reads until a hit of the shield has landed this fight. Once one has
  // (FB-58) the measured amount wins — test/me-hud-timers.test.js, "the shield badge reads what the
  // shield did".
  it('per hit = spell shield + gear shield while a spell shield is up; the last landed hit otherwise', () => {
    expect(body).toMatch(/const dsItem = dsKnown \? _wornItemDs\(active\) : 0;/);
    expect(body).toMatch(/combat\.ds\.per_hit = seen != null \? seen : \(dsKnown \? dsKnown \+ dsItem : combat\.ds\.last\);/);
    expect(body).toMatch(/combat\.ds\.from_items = dsItem;/);
  });

  it('a cancelled shield (Mark of the Plague Lords) still reads 0', () => {
    expect(body).toMatch(/if \(dsWorn\.off\) \{[^}]*combat\.ds\.per_hit = 0;/);
  });
});

describe('the item-clickies disk cache keeps the worn-shield list', () => {
  function loadDisk(file) {
    const block = `
      const ITEM_CLICKY_FILE = 'x.json';
      const fs = { existsSync: () => true, readFileSync: () => ${JSON.stringify(JSON.stringify(file))} };
      const console = { log() {}, warn() {} };
      let _itemClickyByNameLower = new Map();
      let _itemClickyMeta = null;
      let _wornSeen = null;
      function _setWornDsCatalog(list) { _wornSeen = list; }
      ${sliceBlock(agent, 'function _loadItemClickiesFromDisk() {', '\n}')}
      function meta() { return _itemClickyMeta; }
      function worn() { return _wornSeen; }
    `;
    const h = evalBlock(block, ['_loadItemClickiesFromDisk', 'meta', 'worn']);
    h._loadItemClickiesFromDisk();
    return h;
  }

  it('loads worn_ds and keeps the etag when the file has it', () => {
    const h = loadDisk({ fetched_at: 't', etag: '"abc"', entries: [], worn_ds: CATALOG });
    expect(h.worn()).toEqual(CATALOG);
    expect(h.meta().etag).toBe('"abc"');
  });

  it('forgets the etag of a file written before worn_ds, so the next fetch is a full one', () => {
    const h = loadDisk({ fetched_at: 't', etag: '"abc"', entries: [] });
    expect(h.meta().etag).toBeNull();
  });

  it('writes worn_ds to disk with what the bot sent', () => {
    const fetchBody = stripJs(sliceBlock(agent, 'function fetchItemClickies({ botUrl, token }) {', '\n}'));
    expect(fetchBody).toMatch(/_setWornDsCatalog\(data\.worn_ds\);/);
    expect(fetchBody).toMatch(/worn_ds: data\.worn_ds \|\| \[\]/);
  });
});
