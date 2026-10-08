// test/raid-appearance.test.js — how each raider looked on a raid night (utils/raidAppearance.js).
//
// What can go wrong without anyone noticing: a raider who opted out being written (or their gear being
// read), a look hash that moves when nothing visible changed (a new row every hour for everyone) or that
// does NOT move when a dye did, a catalog with no model data turning "unknown" into "wearing nothing", a
// gear read cut at PostgREST's 1,000 rows so half the raid is a bare race, and a snapshot that fires every
// minute or never. These tests run the real module against test/_cap_fake_supabase.js (which enforces the
// cap) with an insert that honours the table's primary key; the wiring into the raid-track recorder, the
// two migrations' key lines and the Tower archive are checked as text with comments stripped.
//
// Fixture names are invented (Aldenmar, Brackwyn, Corvale … and Raider001…); none is a member.
//
// Run: npx vitest run test/raid-appearance.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, stripJs, stripSql, sliceBlock } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const require = createRequire(import.meta.url);
const ra = require('../utils/raidAppearance.js');
const rt = require('../utils/raidTrack.js');
const raidNight = require('../utils/raidNight.js');

const GUILD = 'wolfpack';
const NIGHT = '2026-10-07';
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 7, 1, 0, 0);
const DYE = 4294967168;                       // the largest colour in the real catalog: 0xFFFFFF80

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
const ITEMS = [
  { id: 1001, idfile: 'IT63',  material: 16, color: DYE },    // a dyed cap
  { id: 1002, idfile: 'IT10',  material: 3,  color: 0 },      // plate chest
  { id: 1003, idfile: 'IT10',  material: 2,  color: 0 },      // chain chest (a swap for 1002)
  { id: 2001, idfile: 'IT27',  material: 0,  color: 0 },      // a weapon
  { id: 2002, idfile: 'IT190', material: 0,  color: 0 },      // a shield
  { id: 3001, idfile: '0',     material: 0,  color: 0 },      // a ring: not a visible slot
  { id: 4001, idfile: 'IT1',   material: 5,  color: 255 },    // a wrist guard
  { id: 4002, idfile: 'IT1',   material: 9,  color: 0 },      // what the SECOND wrist holds: never drawn
];
const char = (name, over = {}) => ({ guild_id: GUILD, name, race: 'Dark Elf', class: 'Necromancer', deity_id: 201, exclude_from_stats: false, exclude_inventory: false, ...over });
const gear = (character, slot, item_id) => ({ guild_id: GUILD, character, loc: 'equipped', slot, item_id });
const inv = (id, character_name, slot_label, item_id) => ({ id, guild_id: GUILD, character_name, slot_label, item_id });

function fixtures() {
  return {
    characters: [
      char('Aldenmar'),
      char('Brackwyn', { race: 'Half-Elf', class: 'Cleric', deity_id: 0 }),
      char('Corvale', { race: 'Human' }),
      char('Rethlan', { race: 'UNKNOWN' }),
      char('Nyssara', { exclude_from_stats: true }),
      char('Zarrin', { exclude_inventory: true }),
    ],
    character_gear: [
      gear('Aldenmar', 'Head', 1001), gear('Aldenmar', 'Chest', 1002), gear('Aldenmar', 'Primary', 2001),
      gear('Aldenmar', 'Secondary', 2002), gear('Aldenmar', 'Neck', 3001), gear('Aldenmar', 'Fingers1', 3001),
      gear('Brackwyn', 'Wrist1', 4001), gear('Brackwyn', 'Wrist2', 4002),
      gear('Nyssara', 'Head', 1001),
      gear('Zarrin', 'Head', 1001), gear('Zarrin', 'Chest', 1002),
    ],
    character_inventory: [
      inv(1, 'Corvale', 'Head', 1001), inv(2, 'Corvale', 'Wrist', 4001), inv(3, 'Corvale', 'General1-Slot1', 1002),
      inv(4, 'Zarrin', 'Head', 1001),
    ],
    eqemu_items: ITEMS,
  };
}

// The cap fake, with an insert that ignores a duplicate primary key like ON CONFLICT DO NOTHING and replies
// with the rows it really inserted (what `return=representation` does).
function makeFake(over = {}) {
  const tables = { ...fixtures(), ...over.tables };
  const store = new Map();
  const inserts = [];
  const fake = makeCapFake({ tables, missing: over.missing || [] });
  fake.insertIgnoreDuplicates = async (table, rows, opts) => {
    inserts.push({ table, rows, opts });
    if (over.failInsert) return null;
    const out = [];
    for (const r of rows) {
      const key = [r.guild_id, r.night_key, r.name_key, r.look_hash].join('|');
      if (store.has(key)) continue;
      store.set(key, r);
      out.push({ name_key: r.name_key });
    }
    return out;
  };
  if (over.disabled) fake.isEnabled = () => false;
  return { fake, tables, store, inserts, rows: () => [...store.values()], byName: (n) => [...store.values()].filter(r => r.name_key === n.toLowerCase()) };
}
const queries = (fake) => fake.calls.filter(c => c.kind === 'select').map(c => ({ table: c.table, qs: decodeURIComponent(c.qs) }));
const snap = (fake, names, extra = {}) => ra.snapshotNight({ supabase: fake, guildId: GUILD, nightKey: NIGHT, names, ...extra });

beforeEach(() => {
  ra._reset();
  rt._reset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  ra._reset();
  rt._reset();
  vi.restoreAllMocks();
});

// ── the hash ────────────────────────────────────────────────────────────────────────────────────────
describe('lookHash', () => {
  const base = { race_id: 6, gender: 1, face: 2, hair_style: 3, hair_color: 4, beard_style: 0, beard_color: 0, texture: 0, height: 5.5,
    mat: [16, 3, 0, 0, 0, 0, 0], tint: [DYE, 0, 0, 0, 0, 0, 0], prim_it: 27, sec_it: 190 };

  it('is 16 hex characters and stable: the same look, however the object is built, is the same hash', () => {
    const h = ra.lookHash(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(ra.lookHash({ ...base })).toBe(h);
    expect(ra.lookHash(Object.fromEntries(Object.entries(base).reverse()))).toBe(h);
    expect(ra.lookHash({ ...base, mat: [...base.mat], tint: [...base.tint] })).toBe(h);
  });

  it('moves with every visible field, including one dye and one armor slot', () => {
    const h = ra.lookHash(base);
    const variants = {
      race_id: 7, gender: 0, face: 3, hair_style: 4, hair_color: 5, beard_style: 1, beard_color: 1, texture: 1, height: 6,
      mat: [16, 2, 0, 0, 0, 0, 0], tint: [DYE, 0, 0, 0, 0, 0, 1], prim_it: 28, sec_it: 191,
    };
    for (const [k, v] of Object.entries(variants)) expect(ra.lookHash({ ...base, [k]: v }), k).not.toBe(h);
  });

  it('does not move with what is not visible: deity, worn items, source, a name', () => {
    const h = ra.lookHash(base);
    expect(ra.lookHash({ ...base, deity: 211, worn: [{ slot: 'Head', item_id: 1 }], source: 'zeal_entity', character_name: 'Aldenmar' })).toBe(h);
  });

  it('treats a missing field as unknown (null), and a height to two places', () => {
    expect(ra.lookHash({ race_id: 6 })).toBe(ra.lookHash({ race_id: 6, gender: null, face: undefined, mat: null }));
    expect(ra.lookHash({ ...base, height: 5.501 })).toBe(ra.lookHash({ ...base, height: 5.504 }));
    expect(ra.lookHash({ ...base, height: 5.51 })).not.toBe(ra.lookHash({ ...base, height: 5.5 }));
  });

  it('falls back to the race NAME when the race has no number, case-insensitively', () => {
    expect(ra.lookHash({ race: 'Froggish' })).toBe(ra.lookHash({ race: 'froggish' }));
    expect(ra.lookHash({ race: 'Froggish' })).not.toBe(ra.lookHash({ race: 'Other' }));
    expect(ra.lookHash({ race_id: 6, race: 'Dark Elf' })).toBe(ra.lookHash({ race_id: 6 }));
  });
});

describe('races', () => {
  it('maps the playable races to the client numbers, hyphens and case aside', () => {
    expect(ra.raceId('Dark Elf')).toBe(6);
    expect(ra.raceId('Half-Elf')).toBe(7);
    expect(ra.raceId('half elf')).toBe(7);
    expect(ra.raceId('Vah Shir')).toBe(130);
    expect(ra.raceId('Iksar')).toBe(128);
    expect(ra.raceId('Froglok')).toBe(330);
  });
  it('treats UNKNOWN, empty and NULL as no race at all', () => {
    for (const r of ['UNKNOWN', 'unknown', '', '  ', null, undefined, 6]) {
      expect(ra.cleanRace(r)).toBeNull();
      expect(ra.raceId(r)).toBeNull();
    }
  });
});

// ── the look of a set of worn items ─────────────────────────────────────────────────────────────────
describe('lookFromWorn', () => {
  const models = new Map(ITEMS.map(i => [i.id, { idfile: i.idfile, material: i.material, color: i.color }]));
  const worn = (o) => new Map(Object.entries(o));

  it('puts armor materials and dyes in the client order and weapons by their model number', () => {
    const l = ra.lookFromWorn(worn({ Head: 1001, Chest: 1002, Wrist1: 4001, Primary: 2001, Secondary: 2002 }), models);
    expect(l.mat).toEqual([16, 3, 0, 5, 0, 0, 0]);
    expect(l.tint).toEqual([DYE, 0, 0, 255, 0, 0, 0]);
    expect(l.prim_it).toBe(27);
    expect(l.sec_it).toBe(190);
    expect(l.worn.map(w => w.slot)).toEqual(['Head', 'Chest', 'Wrist1', 'Primary', 'Secondary']);
    expect(l.worn[0]).toEqual({ slot: 'Head', item_id: 1001, idfile: 'IT63', material: 16, color: DYE });
  });

  it('empty slots are 0 and no weapon is null; an item the catalog lacks reads as nothing drawn', () => {
    const l = ra.lookFromWorn(worn({ Legs: 99999 }), models);
    expect(l.mat).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(l.tint).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(l.prim_it).toBeNull();
    expect(l.sec_it).toBeNull();
  });

  it('a weapon whose idfile is not an IT number has no model number', () => {
    const m = new Map([[1, { idfile: '0', material: 0, color: 0 }]]);
    expect(ra.lookFromWorn(worn({ Primary: 1 }), m).prim_it).toBeNull();
  });

  it('with NO catalog data the model columns are null — unknown, never "wearing nothing"', () => {
    const l = ra.lookFromWorn(worn({ Head: 1001 }), null);
    expect(l).toEqual({ worn: [{ slot: 'Head', item_id: 1001, idfile: null, material: null, color: null }], mat: null, tint: null, prim_it: null, sec_it: null });
  });
});

// ── the snapshot ────────────────────────────────────────────────────────────────────────────────────
describe('snapshotNight: one row per raider, from data we already hold', () => {
  it('writes every raider who has not opted out, with the right source', async () => {
    const m = makeFake();
    const res = await snap(m.fake, ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin']);
    expect(res).toMatchObject({ ok: true, names: 5, written: 5, inserted: 5, sources: { quarmy: 2, inventory: 1, who: 2 } });
    const src = Object.fromEntries(m.rows().map(r => [r.character_name, r.source]));
    expect(src).toEqual({ Aldenmar: 'quarmy', Brackwyn: 'quarmy', Corvale: 'inventory', Rethlan: 'who', Zarrin: 'who' });
  });

  it('builds the look of a Quarmy raider: race, models, worn list, and a hash that matches the fields', async () => {
    const m = makeFake();
    await snap(m.fake, ['Aldenmar']);
    const [r] = m.byName('Aldenmar');
    expect(r).toMatchObject({
      guild_id: GUILD, night_key: NIGHT, name_key: 'aldenmar', character_name: 'Aldenmar', source: 'quarmy',
      race: 'Dark Elf', race_id: 6, deity: 201, gender: null, face: null, hair_style: null, hair_color: null,
      beard_style: null, beard_color: null, texture: null, height: null,
      mat: [16, 3, 0, 0, 0, 0, 0], tint: [DYE, 0, 0, 0, 0, 0, 0], prim_it: 27, sec_it: 190,
    });
    // the ring and the neck are not visible and are not read into the look
    expect(r.worn.map(w => w.slot)).toEqual(['Head', 'Chest', 'Primary', 'Secondary']);
    expect(r.look_hash).toBe(ra.lookHash(r));
    expect(r.look_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('only the first wrist is drawn: Wrist1 counts, Wrist2 does not', async () => {
    const m = makeFake();
    await snap(m.fake, ['Brackwyn']);
    const [r] = m.byName('Brackwyn');
    expect(r.mat[3]).toBe(5);
    expect(r.tint[3]).toBe(255);
    expect(r.worn).toHaveLength(1);
    expect(r.race_id).toBe(7);          // 'Half-Elf'
    expect(r.deity).toBeNull();         // deity_id 0 is "none"
  });

  it('a raider with no Quarmy export but an inventory file is built from the inventory\'s worn rows', async () => {
    const m = makeFake();
    await snap(m.fake, ['Corvale']);
    const [r] = m.byName('Corvale');
    expect(r.source).toBe('inventory');
    expect(r.mat).toEqual([16, 0, 0, 5, 0, 0, 0]);       // 'Wrist' is the first wrist; the bag slot is not read
    expect(r.worn.map(w => w.slot)).toEqual(['Head', 'Wrist1']);
    expect(queries(m.fake).find(q => q.table === 'character_inventory').qs).toContain('slot_label=in.(Head,Chest,Arms,Wrist,Wrist1,Hands,Legs,Feet,Primary,Secondary)');
  });

  it('prefers the Quarmy export over the inventory file when both exist, and never reads the inventory for it', async () => {
    const m = makeFake();
    m.tables.character_inventory.push(inv(9, 'Aldenmar', 'Head', 4001));
    await snap(m.fake, ['Aldenmar']);
    expect(m.byName('Aldenmar')[0].source).toBe('quarmy');
    expect(queries(m.fake).filter(q => q.table === 'character_inventory')).toHaveLength(0);
  });

  it('a raider with neither is written with race and deity only (source who), UNKNOWN race as null', async () => {
    const m = makeFake();
    await snap(m.fake, ['Rethlan']);
    const [r] = m.byName('Rethlan');
    expect(r).toMatchObject({ source: 'who', race: null, race_id: null, mat: null, tint: null, prim_it: null, sec_it: null, worn: null });
  });

  it('a raider the characters table has never heard of is still written, under the name as given', async () => {
    const m = makeFake();
    await snap(m.fake, ['Wanderer']);
    expect(m.byName('Wanderer')[0]).toMatchObject({ character_name: 'Wanderer', source: 'who', race: null, deity: null });
  });

  it('matches a name however its capital letters came in', async () => {
    const m = makeFake();
    await snap(m.fake, ['ALDENMAR', 'aldenmar']);
    expect(m.rows()).toHaveLength(1);
    expect(m.rows()[0]).toMatchObject({ name_key: 'aldenmar', character_name: 'Aldenmar', source: 'quarmy' });
  });

  it('is idempotent, and a swapped item adds ONE new row for that raider only', async () => {
    const m = makeFake();
    const names = ['Aldenmar', 'Brackwyn', 'Corvale'];
    expect((await snap(m.fake, names)).inserted).toBe(3);
    expect((await snap(m.fake, names)).inserted).toBe(0);
    m.tables.character_gear.find(g => g.character === 'Aldenmar' && g.slot === 'Chest').item_id = 1003;
    const again = await snap(m.fake, names);
    expect(again).toMatchObject({ ok: true, written: 3, inserted: 1 });
    expect(m.byName('Aldenmar')).toHaveLength(2);
    expect(m.byName('Aldenmar').map(r => r.mat[1]).sort()).toEqual([2, 3]);
    expect(m.byName('Brackwyn')).toHaveLength(1);
  });

  it('the same look on another night is its own row', async () => {
    const m = makeFake();
    await snap(m.fake, ['Aldenmar']);
    await snap(m.fake, ['Aldenmar'], { nightKey: '2026-10-08' });
    expect(m.byName('Aldenmar').map(r => r.night_key).sort()).toEqual([NIGHT, '2026-10-08']);
  });

  it('inserts with the representation echo narrowed to one column, in chunks', async () => {
    const m = makeFake();
    const names = Array.from({ length: 450 }, (_, i) => `Raider${String(i).padStart(3, '0')}`);
    await snap(m.fake, names);
    expect(m.inserts.map(i => i.rows.length)).toEqual([200, 200, 50]);
    expect(m.inserts.every(i => i.table === 'raid_night_appearance?select=name_key' && i.opts.representation === true)).toBe(true);
  });
});

describe('privacy', () => {
  it('a raider with exclude_from_stats is never written and never looked up for gear, inventory or items', async () => {
    const m = makeFake();
    await snap(m.fake, ['Nyssara', 'Aldenmar']);
    expect(m.byName('Nyssara')).toHaveLength(0);
    expect(m.rows().some(r => JSON.stringify(r).toLowerCase().includes('nyssara'))).toBe(false);
    for (const q of queries(m.fake)) {
      if (q.table === 'characters') continue;   // the flag list itself is read by flag, not by name
      expect(q.qs.toLowerCase(), q.table).not.toContain('nyssara');
    }
    expect(queries(m.fake).filter(q => q.table === 'characters').some(q => q.qs.includes('name=in.') && q.qs.includes('Nyssara'))).toBe(false);
  });

  it('a raider with exclude_inventory is written with NO item data, and their gear and inventory are not read', async () => {
    const m = makeFake();
    await snap(m.fake, ['Zarrin', 'Aldenmar']);
    expect(m.byName('Zarrin')[0]).toMatchObject({ source: 'who', mat: null, tint: null, prim_it: null, sec_it: null, worn: null, race: 'Dark Elf' });
    for (const q of queries(m.fake).filter(q => q.table === 'character_gear' || q.table === 'character_inventory')) {
      expect(q.qs).not.toContain('Zarrin');
    }
  });

  it('the privacy flags are matched on lowercase, whatever case the table stores', async () => {
    const m = makeFake();
    m.tables.characters.find(c => c.name === 'Nyssara').name = 'NYSSARA';
    await snap(m.fake, ['nyssara', 'Aldenmar']);
    expect(m.byName('nyssara')).toHaveLength(0);
  });

  it('fails closed: when the flags cannot be read nothing is written, and nothing is read about anyone', async () => {
    const m = makeFake({ missing: ['characters'] });
    const res = await snap(m.fake, ['Aldenmar', 'Nyssara']);
    expect(res).toEqual({ ok: false, reason: 'flags_unreadable' });
    expect(m.inserts).toHaveLength(0);
    expect(queries(m.fake).some(q => q.table === 'character_gear' || q.table === 'eqemu_items')).toBe(false);
  });

  it('reads the flag lists with the shared pager, ordered by name, for this guild', async () => {
    const m = makeFake();
    await snap(m.fake, ['Aldenmar']);
    const flagReads = queries(m.fake).filter(q => q.table === 'characters' && /exclude_(from_stats|inventory)=eq\.true/.test(q.qs));
    expect(flagReads).toHaveLength(2);
    for (const q of flagReads) expect(q.qs).toMatch(/guild_id=eq\.wolfpack.*&order=name\.asc&limit=1000&offset=0/);
  });
});

describe('the catalog: models tolerated absent', () => {
  const naked = async (over) => {
    const m = makeFake(over);
    await snap(m.fake, ['Aldenmar']);
    return m.byName('Aldenmar')[0];
  };
  const noModels = ITEMS.map(i => ({ id: i.id, idfile: null, material: null, color: null }));

  it('an eqemu_items that cannot be read (columns not there yet) leaves the model columns null but keeps the item ids', async () => {
    const r = await naked({ missing: ['eqemu_items'] });
    expect(r).toMatchObject({ source: 'quarmy', mat: null, tint: null, prim_it: null, sec_it: null, race_id: 6 });
    expect(r.worn.map(w => w.item_id)).toEqual([1001, 1002, 2001, 2002]);
    expect(r.worn[0]).toMatchObject({ idfile: null, material: null, color: null });
  });

  it('a catalog whose model columns are all NULL (the sync has not run) reads as unknown, not as naked', async () => {
    const r = await naked({ tables: { eqemu_items: noModels } });
    expect(r.mat).toBeNull();
    expect(r.tint).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no model data'));
  });

  it('and the "unknown" look hashes differently from a genuinely naked one, so the real one lands later', async () => {
    const unknown = await naked({ tables: { eqemu_items: noModels } });
    const m = makeFake({ tables: { character_gear: [gear('Aldenmar', 'Neck', 3001)] } });
    await snap(m.fake, ['Aldenmar']);
    const nakedLook = m.byName('Aldenmar')[0];
    expect(nakedLook.mat).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(unknown.look_hash).not.toBe(nakedLook.look_hash);
  });

  it('reads the item models in bounded chunks, only for visible items', async () => {
    const m = makeFake();
    await snap(m.fake, ['Aldenmar']);
    const reads = queries(m.fake).filter(q => q.table === 'eqemu_items');
    expect(reads).toHaveLength(1);
    expect(reads[0].qs).toMatch(/^id=in\.\(1001,1002,2001,2002\)&select=id,idfile,material,color&limit=4$/);
  });
});

describe('failures and limits', () => {
  it('a failed insert reports it and never throws', async () => {
    const m = makeFake({ failInsert: true });
    expect(await snap(m.fake, ['Aldenmar'])).toEqual({ ok: false, reason: 'insert_failed' });
  });

  it('Supabase off, no night, no names: nothing happens', async () => {
    const off = makeFake({ disabled: true });
    expect(await snap(off.fake, ['Aldenmar'])).toEqual({ ok: false, reason: 'disabled' });
    const m = makeFake();
    expect(await snap(m.fake, ['Aldenmar'], { nightKey: '' })).toEqual({ ok: false, reason: 'disabled' });
    expect(await snap(m.fake, [])).toMatchObject({ ok: true, names: 0 });
    expect(await snap(m.fake, null)).toMatchObject({ ok: true, names: 0 });
    expect(m.inserts).toHaveLength(0);
  });

  it('a throwing Supabase never escapes', async () => {
    const flags = makeFake();
    flags.fake.selectAllPaged = async () => { throw new Error('boom'); };
    expect(await snap(flags.fake, ['Aldenmar'])).toEqual({ ok: false, reason: 'flags_unreadable' });
    const reads = makeFake();
    reads.fake.select = async () => { throw new Error('boom'); };      // the pager keeps its own, so the flags read fine
    expect(await snap(reads.fake, ['Aldenmar'])).toEqual({ ok: false, reason: 'error' });
    expect(reads.inserts).toHaveLength(0);
  });

  it('a 120-raider raid is read in full: 2,640 equipped rows are paged, not cut at PostgREST\'s 1,000', async () => {
    const SLOTS = ['Head', 'Chest', 'Arms', 'Wrist1', 'Hands', 'Legs', 'Feet', 'Primary', 'Secondary', 'Neck', 'Ear1', 'Ear2', 'Fingers1', 'Fingers2', 'Back', 'Shoulders', 'Waist', 'Face', 'Range', 'Ammo', 'Wrist2', 'Charm'];
    const names = Array.from({ length: 120 }, (_, i) => `Raider${String(i + 1).padStart(3, '0')}`);
    const g = names.flatMap(n => SLOTS.map(s => gear(n, s, s === 'Chest' ? 1002 : 3001)));
    expect(g.length).toBe(2640);
    const m = makeFake({ tables: { character_gear: g, characters: names.map(n => char(n)) } });
    const res = await snap(m.fake, names);
    expect(res).toMatchObject({ ok: true, written: 120, inserted: 120, sources: { quarmy: 120, inventory: 0, who: 0 } });
    expect(m.rows().every(r => r.mat[1] === 3 && r.source === 'quarmy')).toBe(true);
    // every raider got a chest, i.e. none was lost to a truncated page
    const gearReads = queries(m.fake).filter(q => q.table === 'character_gear');
    expect(gearReads.length).toBeGreaterThanOrEqual(3);
    expect(gearReads.every(q => /&order=character\.asc,slot\.asc&limit=1000&offset=\d+$/.test(q.qs))).toBe(true);
  });

  it('the reads of characters and items name their bound; gear and inventory go through the shared pager', () => {
    const src = stripJs(readSource(path.join(ROOT, 'utils', 'raidAppearance.js')));
    expect(src).not.toMatch(/\.select\(\s*'character_(gear|inventory)'/);
    expect(src).toMatch(/selectAllPaged\('character_gear'/);
    expect(src).toMatch(/selectAllPaged\('character_inventory'/);
    expect(src).toMatch(/select=name,race,deity_id&limit=\$\{chunk\.length\}/);
    expect(src).toMatch(/select=id,idfile,material,color&limit=\$\{chunk\.length\}/);
  });
});

// ── the trigger ─────────────────────────────────────────────────────────────────────────────────────
describe('noteMinute: once per night, a raider\'s first minute, then hourly', () => {
  const attempted = (m) => m.inserts.map(i => i.rows.map(r => r.character_name).sort());
  const note = (m, nowMs, names, over = {}) => ra.noteMinute({ supabase: m.fake, guildId: GUILD, nightKey: NIGHT, nowMs, names, ...over });

  it('snapshots the whole minute the first time a night is seen, and nothing for the same raiders again', async () => {
    const m = makeFake();
    await note(m, T0, ['Aldenmar', 'Brackwyn']);
    expect(attempted(m)).toEqual([['Aldenmar', 'Brackwyn']]);
    await note(m, T0 + 60_000, ['Aldenmar', 'Brackwyn']);
    await note(m, T0 + 120_000, ['Brackwyn', 'Aldenmar']);
    expect(attempted(m)).toHaveLength(1);
  });

  it('a raider who shows up later is snapshotted alone, in the minute they appear', async () => {
    const m = makeFake();
    await note(m, T0, ['Aldenmar']);
    await note(m, T0 + 60_000, ['Aldenmar', 'Corvale']);
    expect(attempted(m)).toEqual([['Aldenmar'], ['Corvale']]);
  });

  it('everyone is snapshotted again once an hour has passed, not a minute before', async () => {
    const m = makeFake();
    await note(m, T0, ['Aldenmar', 'Brackwyn']);
    await note(m, T0 + HOUR - 60_000, ['Aldenmar', 'Brackwyn']);
    expect(attempted(m)).toHaveLength(1);
    await note(m, T0 + HOUR, ['Aldenmar', 'Brackwyn']);
    expect(attempted(m)).toEqual([['Aldenmar', 'Brackwyn'], ['Aldenmar', 'Brackwyn']]);
    await note(m, T0 + HOUR + 60_000, ['Aldenmar', 'Brackwyn']);
    expect(attempted(m)).toHaveLength(2);
    await note(m, T0 + 2 * HOUR, ['Aldenmar']);
    expect(attempted(m)).toHaveLength(3);
  });

  it('the hourly pass picks up a gear swap (and only that raider gains a row)', async () => {
    const m = makeFake();
    await note(m, T0, ['Aldenmar', 'Brackwyn']);
    m.tables.character_gear.find(g => g.character === 'Aldenmar' && g.slot === 'Chest').item_id = 1003;
    await note(m, T0 + 10 * 60_000, ['Aldenmar', 'Brackwyn']);
    expect(m.byName('Aldenmar')).toHaveLength(1);              // not before the hour
    await note(m, T0 + HOUR, ['Aldenmar', 'Brackwyn']);
    expect(m.byName('Aldenmar')).toHaveLength(2);
    expect(m.byName('Brackwyn')).toHaveLength(1);
  });

  it('each night has its own clock', async () => {
    const m = makeFake();
    await note(m, T0, ['Aldenmar']);
    await note(m, T0 + 1000, ['Aldenmar'], { nightKey: '2026-10-08' });
    expect(attempted(m)).toHaveLength(2);
    expect(m.rows().map(r => r.night_key).sort()).toEqual([NIGHT, '2026-10-08']);
  });

  it('keeps state for the last few nights only', async () => {
    const m = makeFake();
    for (let d = 1; d <= 6; d++) await note(m, T0 + d, ['Aldenmar'], { nightKey: `2026-10-0${d}` });
    expect(ra._state().nights.map(n => n.night)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('a failed snapshot leaves its raiders unseen, so the next minute asks again', async () => {
    const m = makeFake({ failInsert: true });
    await note(m, T0, ['Aldenmar']);
    expect(attempted(m)).toHaveLength(1);
    expect(ra._state().nights[0].seen).toBe(0);
    await note(m, T0 + 60_000, ['Aldenmar']);
    expect(attempted(m)).toHaveLength(2);
  });

  it('raiders who opted out are marked seen too, so they are not asked about every minute', async () => {
    const m = makeFake();
    await note(m, T0, ['Nyssara', 'Aldenmar']);
    const before = m.fake.calls.length;
    await note(m, T0 + 60_000, ['Nyssara', 'Aldenmar']);
    expect(m.fake.calls.length).toBe(before);
  });

  it('names that arrive while a pass is running are picked up by that pass', async () => {
    const m = makeFake();
    const first = note(m, T0, ['Aldenmar']);
    const second = note(m, T0 + 60_000, ['Brackwyn']);
    await Promise.all([first, second]);
    await note(m, T0 + 120_000, ['Aldenmar', 'Brackwyn']);
    expect(new Set(m.rows().map(r => r.character_name))).toEqual(new Set(['Aldenmar', 'Brackwyn']));
    expect(m.rows()).toHaveLength(2);
  });

  it('never throws and never rejects, on garbage or a broken Supabase', async () => {
    const m = makeFake();
    for (const bad of [{}, { nightKey: NIGHT }, { nightKey: NIGHT, names: 'x' }, { nightKey: NIGHT, names: [] }, { nightKey: NIGHT, names: [null, 3, {}] }, undefined]) {
      await expect(ra.noteMinute(bad)).resolves.toBeNull();
    }
    const broken = makeFake();
    broken.fake.isEnabled = () => { throw new Error('boom'); };
    await expect(note(broken, T0, ['Aldenmar'])).resolves.toBeUndefined();
  });
});

// ── the recorder calls it ───────────────────────────────────────────────────────────────────────────
describe('the raid-track recorder hands its minute to the snapshot', () => {
  const row = (name, x) => ({ name, class: 'Warrior', group_num: 1, level: 60, hp_pct: null, loc_x: x, loc_y: 5, loc_z: 5, heading: null });

  function trackFake() {
    const m = makeFake();
    const upserts = [];
    m.fake.upsert = async (table, rows) => { upserts.push({ table, rows }); return rows.map(r => ({ guild_id: r.guild_id, minute_at: r.minute_at })); };
    return { ...m, upserts };
  }
  function recordMinute(m, names, { at = T0 } = {}) {
    process.env.RAID_TRACK_MIN_PLACED = '1';
    rt._setDeps({ supabase: m.fake });
    rt.noteRows(names.map((n, i) => row(n, 10 + i)), 'u1', at + 1000);
    rt.takeFrame(at + 2000);
    rt.closeFinished(at + 60_000);
    return rt.flush();
  }
  afterEach(() => { delete process.env.RAID_TRACK_MIN_PLACED; });

  it('after a minute row lands, the minute\'s raiders (opted-out ones removed) are snapshotted under that minute\'s night', async () => {
    const m = trackFake();
    m.tables.characters.find(c => c.name === 'Nyssara').exclude_from_stats = true;
    await recordMinute(m, ['Aldenmar', 'Brackwyn', 'Nyssara']);
    expect(m.upserts).toHaveLength(1);
    await vi.waitFor(() => expect(m.rows().length).toBe(2));
    expect(m.rows().map(r => r.character_name).sort()).toEqual(['Aldenmar', 'Brackwyn']);
    expect(new Set(m.rows().map(r => r.night_key))).toEqual(new Set([raidNight.nightKey(T0)]));
  });

  it('a minute that failed to write snapshots nothing', async () => {
    const m = trackFake();
    m.fake.upsert = async () => null;
    await recordMinute(m, ['Aldenmar', 'Brackwyn']);
    await new Promise(r => setTimeout(r, 20));
    expect(m.inserts).toHaveLength(0);
  });

  it('a snapshot that throws cannot fail the minute', async () => {
    const m = trackFake();
    const spy = vi.spyOn(ra, 'noteMinute').mockImplementation(() => { throw new Error('boom'); });
    await recordMinute(m, ['Aldenmar', 'Brackwyn']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(m.upserts).toHaveLength(1);
    expect(rt._state().pending).toBe(0);
  });

  it('the hook sits right after the successful upsert, in its own try/catch, not awaited', () => {
    const src = stripJs(readSource(path.join(ROOT, 'utils', 'raidTrack.js')));
    const fn = sliceBlock(src, 'async function _writeMinute(m) {', '\n}\n');
    const upsert = fn.indexOf("sb.upsert('raid_track_minutes'");
    const guard = fn.indexOf('if (!Array.isArray(res)) return false;');
    const hook = fn.indexOf("require('./raidAppearance').noteMinute({ supabase: sb, guildId: row.guild_id, nightKey: row.night_key, nowMs: m.minuteStartMs, names })");
    expect(upsert).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(upsert);
    expect(hook).toBeGreaterThan(guard);
    expect(fn.slice(fn.lastIndexOf('try {', hook), hook)).not.toMatch(/catch/);
    expect(fn.slice(hook, hook + 260)).toMatch(/\}\s*catch\s*\{\s*\}/);
    expect(fn.slice(hook - 12, hook)).not.toMatch(/await/);
    expect(fn.trimEnd().endsWith('return true;\n}')).toBe(true);
  });
});

// ── the migrations and the archive ──────────────────────────────────────────────────────────────────
describe('the migration and the Tower archive (text, comments stripped)', () => {
  const mig = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261006020000_raid_night_appearance.sql')));
  const merge = stripSql(readSource(path.join(ROOT, 'scripts', 'lib', 'archive-merge.sql')));
  const selfTest = readSource(path.join(ROOT, 'scripts', 'test-archive-merge.sh'));

  it('the table is idempotent, keyed on (guild, night, lowercase name, look), service-role only', () => {
    expect(mig).toMatch(/create table if not exists public\.raid_night_appearance \(/i);
    expect(mig).toMatch(/primary key \(guild_id, night_key, name_key, look_hash\)/i);
    expect(mig).toMatch(/alter table public\.raid_night_appearance enable row level security/i);
    expect(mig).not.toMatch(/create policy|\bgrant\b|\bdrop\b/i);
  });

  it('the source check lists exactly the four sources', () => {
    const m = /source\s+text\s+not null check \(source in \(([^)]*)\)\)/i.exec(mig);
    expect(m).not.toBeNull();
    expect(m[1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual(['zeal_entity', 'quarmy', 'inventory', 'who']);
  });

  it('the columns the writer sends all exist, with types that hold the data', () => {
    for (const re of [
      /guild_id\s+text\s+not null/, /night_key\s+text\s+not null/, /name_key\s+text\s+not null/, /look_hash\s+text\s+not null/,
      /character_name\s+text\s+not null/, /first_seen_at\s+timestamptz\s+not null\s+default now\(\)/,
      /race\s+text,/, /race_id\s+integer,/, /gender\s+integer,/, /face\s+integer,/, /hair_style\s+integer,/, /hair_color\s+integer,/,
      /beard_style\s+integer,/, /beard_color\s+integer,/, /texture\s+integer,/, /height\s+real,/, /deity\s+integer,/,
      /mat\s+integer\[\],/, /prim_it\s+integer,/, /sec_it\s+integer,/, /worn\s+jsonb,/,
      /tint\s+bigint\[\],/,           // unsigned 32-bit dye: int[] would reject 4294967168
    ]) expect(mig).toMatch(re);
    const sent = Object.keys(ra.buildRow({ guildId: GUILD, nightKey: NIGHT, name: 'Aldenmar', char: null, worn: null, models: null, source: 'who' }));
    for (const col of sent) expect(mig, col).toMatch(new RegExp(`\\b${col}\\s+(text|integer|real|bigint\\[\\]|integer\\[\\]|jsonb)`));
  });

  it('the Tower archive creates it with the same definition and keeps it as an ARCHIVE table (never deletes)', () => {
    expect(merge).toMatch(/create table if not exists public\.raid_night_appearance \(/);
    expect(merge).toMatch(/primary key \(guild_id, night_key, name_key, look_hash\)/);
    expect(merge).toMatch(/tint\s+bigint\[\]/);
    const list = merge.match(/archive_tables text\[\] := array\[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toMatch(/'raid_night_appearance'/);
    // the copy in the archive script is the migration's table, column for column
    const cols = (sql, name) => {
      const body = new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql)[1];
      return body.split('\n').map(l => l.trim().replace(/\s+/g, ' ').replace(/,$/, '')).filter(l => l && !/^primary key/i.test(l)).map(l => l.split(' ').slice(0, 2).join(' '));
    };
    expect(cols(merge, 'raid_night_appearance')).toEqual(cols(mig, 'raid_night_appearance'));
  });

  it('the archive self-test covers its creation, its arrays, and a pruned look staying', () => {
    expect(selfTest).toMatch(/create table snap\.raid_night_appearance/);
    expect(selfTest).toMatch(/merge creates raid_night_appearance and fills it, arrays and all/);
    expect(selfTest).toMatch(/raid_night_appearance keeps a look production dropped/);
  });
});
