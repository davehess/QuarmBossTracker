// test/worn-sets.test.js — worn-set history (gear variations option B, "from most often captured").
//
// The guild lead, 2026-10-31: saved gear sets should come from the combinations a character is captured WEARING most
// often. character_gear and character_inventory are replaced on every upload, so each accepted Quarmy or inventory
// upload now records the equipped slots in character_worn_sets (utils/wornSets.js, migration 20261031130000).
//
// The pure half (normalise + hash) is called directly. The wiring is EVALUATED: the real upload handlers are built from
// index.js around an in-memory fake of the supabase helper, so a comment cannot satisfy any of it. The migration is
// text-asserted over comment-stripped SQL.
//
// Run: npx vitest run test/worn-sets.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, stripSql } from './_source-slice.js';

const wornSets = createRequire(import.meta.url)('../utils/wornSets.js');
const { normaliseWornSlots, wornSlotsFromQuarmy, wornSlotsFromInventory, wornSetHash, COUNT_GAP_MS } = wornSets;

// The handlers, built from the real source (same region the upload-freshness test builds).
const INDEX = readSource(path.join(ROOT, 'index.js'));
const START = INDEX.indexOf('async function _stampCharacterUpload');
const END = INDEX.indexOf('// POST /api/agent/buff_casts');
if (START < 0 || END < START) throw new Error('worn-sets: handler region markers not found');
const REGION = INDEX.slice(START, END);

function buildHandlers(fake) {
  const factory = new Function(
    'mimicLink', 'require', '_trackUpload', '_dedupeRows', 'wornSets',
    `${REGION}\nreturn { _handleAgentQuarmy, _handleAgentInventory };`,
  );
  return factory({ requireAgentAuth: async () => ({ discord_id: 'd1' }) }, () => fake, () => {}, (rows) => rows, wornSets);
}

// In-memory supabase: serves one characters row, stored gear/inventory, and a real little worn-sets table that
// understands the filters the module sends (set_hash, source, id, newest-last_seen).
function fakeSupabase(charRow, { gear = [], inventory = [], failWornWrites = false } = {}) {
  const worn = [];
  let nextId = 1;
  const eq = (q, key) => (new RegExp(`(?:^|&)${key}=eq\\.([^&]*)`).exec(q) || [])[1];
  const fake = {
    worn,
    isEnabled: () => true,
    select: async (table, q = '') => {
      if (table === 'characters') return charRow ? [charRow] : [];
      if (table === 'character_gear') return gear;
      if (table === 'character_inventory') return inventory;
      if (table === 'character_worn_sets') {
        let rows = worn.filter(r => r.source === eq(q, 'source'));
        const h = eq(q, 'set_hash');
        if (h) rows = rows.filter(r => r.set_hash === h);
        if (/order=last_seen\.desc/.test(q)) rows = [...rows].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
        return rows.slice(0, 1);
      }
      return [];
    },
    insert: async (table, rows) => {
      if (table === 'character_worn_sets') {
        if (failWornWrites) throw new Error('boom');
        for (const r of rows) worn.push({ id: nextId++, ...r });
      }
      return rows;
    },
    update: async (table, q, body) => {
      if (table === 'character_worn_sets') {
        if (failWornWrites) throw new Error('boom');
        const row = worn.find(r => String(r.id) === eq(q, 'id'));
        if (row) Object.assign(row, body);
      }
      return [];
    },
    del: async () => [],
    upsert: async (t, rows) => rows,
  };
  return fake;
}

async function post(handler, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const req = { async *[Symbol.asyncIterator]() { yield body; } };
  const out = { status: null, body: null };
  const res = { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b ? JSON.parse(b) : null; } };
  await handler(req, res);
  return out;
}

// One outfit, as each feed writes it. The Quarmy export numbers the paired slots; the inventory file does not.
const QUARMY_EQUIPPED = [
  { slot: 'Head', item_id: 101, item_name: 'Helm' },
  { slot: 'Ear1', item_id: 102, item_name: 'Stud' },
  { slot: 'Ear2', item_id: 103, item_name: 'Hoop' },
  { slot: 'Primary', item_id: 104, item_name: 'Sword' },
  { slot: 'Fingers1', item_id: 105, item_name: 'Band' },
  { slot: 'Ammo', item_id: 999, item_name: 'Arrows' },
];
const INVENTORY_ROWS = [
  { slot_label: 'Head', item_id: 101, item_name: 'Helm', quantity: 1 },
  { slot_label: 'Ear', item_id: 102, item_name: 'Stud', quantity: 1 },
  { slot_label: 'Ear', item_id: 103, item_name: 'Hoop', quantity: 1 },
  { slot_label: 'Primary', item_id: 104, item_name: 'Sword', quantity: 1 },
  { slot_label: 'Fingers', item_id: 105, item_name: 'Band', quantity: 1 },
  { slot_label: 'Ammo', item_id: 999, item_name: 'Arrows', quantity: 80 },
  { slot_label: 'General1', item_id: 500, item_name: 'Bag', quantity: 1 },
  { slot_label: 'Bank3', item_id: 501, item_name: 'Stored', quantity: 1 },
];
const OUTFIT = { Head: 101, Ear1: 102, Ear2: 103, Primary: 104, Fingers1: 105 };

describe('normalise and hash', () => {
  it('both payload shapes normalise to the same slots and the same hash', () => {
    // The inventory handler drops a second row with the same label; the module must cope with either feed.
    const fromQuarmy = wornSlotsFromQuarmy(QUARMY_EQUIPPED);
    const fromInventory = wornSlotsFromInventory(INVENTORY_ROWS);
    expect(fromQuarmy).toEqual(OUTFIT);
    expect(fromInventory).toEqual(OUTFIT);
    expect(wornSetHash(fromQuarmy)).toBe(wornSetHash(fromInventory));
  });

  it('un-numbered paired labels take the first free number', () => {
    expect(normaliseWornSlots([
      { slot: 'Wrist', item_id: 1 }, { slot: 'Wrist', item_id: 2 }, { slot: 'Finger', item_id: 3 },
    ])).toEqual({ Wrist1: 1, Wrist2: 2, Fingers1: 3 });
    // A numbered label claims its number even when an un-numbered one came first.
    expect(normaliseWornSlots([{ slot: 'Ear', item_id: 7 }, { slot: 'Ear1', item_id: 8 }])).toEqual({ Ear1: 8, Ear2: 7 });
  });

  it('the hash is stable under input order and moves when an item changes', () => {
    const a = wornSetHash(wornSlotsFromQuarmy(QUARMY_EQUIPPED));
    const b = wornSetHash(wornSlotsFromQuarmy([...QUARMY_EQUIPPED].reverse()));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    const swapped = QUARMY_EQUIPPED.map(e => (e.slot === 'Head' ? { ...e, item_id: 202 } : e));
    expect(wornSetHash(wornSlotsFromQuarmy(swapped))).not.toBe(a);
  });

  it('empty slots, Ammo, bags and bank are ignored', () => {
    const slots = normaliseWornSlots([
      { slot: 'Head', item_id: 101 },
      { slot: 'Neck', item_id: null }, { slot: 'Face', item_id: 0 }, { slot: 'Back' },
      { slot: 'Ammo', item_id: 999 }, { slot: 'General2-Slot3', item_id: 5 }, { slot: 'Bank1', item_id: 6 },
      null, { item_id: 9 },
    ]);
    expect(slots).toEqual({ Head: 101 });
    // An Ammo swap alone does not make a new set.
    const withArrows = wornSetHash(normaliseWornSlots([{ slot: 'Head', item_id: 101 }, { slot: 'Ammo', item_id: 1 }]));
    const withBolts = wornSetHash(normaliseWornSlots([{ slot: 'Head', item_id: 101 }, { slot: 'Ammo', item_id: 2 }]));
    expect(withArrows).toBe(withBolts);
  });

  it('an empty set has no hash', () => {
    expect(wornSetHash({})).toBeNull();
    expect(wornSetHash(wornSlotsFromQuarmy([]))).toBeNull();
    expect(wornSlotsFromInventory(undefined)).toEqual({});
  });
});

describe.each([
  { name: 'quarmy', handler: '_handleAgentQuarmy', checksumCol: 'quarmy_checksum', outfit: OUTFIT,
    payload: (extra = {}) => ({ character: 'Aldenmar', checksum: 'new', equipped: QUARMY_EQUIPPED, bags: [], aas: [], ...extra }) },
  // The inventory handler keeps one row per label (the table is unique by slot), so a second Ear/Wrist/Fingers row never
  // arrives: that feed's set has Ear1 only, which is why the two sources are stored apart.
  { name: 'inventory', handler: '_handleAgentInventory', checksumCol: 'inventory_checksum',
    outfit: { Head: 101, Ear1: 102, Primary: 104, Fingers1: 105 },
    payload: (extra = {}) => ({ character: 'Aldenmar', checksum: 'new', rows: INVENTORY_ROWS, ...extra }) },
])('$name upload records the worn set', (c) => {
  const T0 = Date.parse('2026-10-31T12:00:00Z');
  const MIN = 60_000;

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const run = async (fake, payload) => post(buildHandlers(fake)[c.handler], payload);

  it('a real write inserts the set with times_seen 1', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', class: 'Wizard', [c.checksumCol]: 'old' });
    const out = await run(fake, c.payload());
    expect(out.body.ok).toBe(true);
    expect(fake.worn).toHaveLength(1);
    expect(fake.worn[0]).toMatchObject({
      guild_id: 'wolfpack', character_name: 'Aldenmar', source: c.name, slots: c.outfit, times_seen: 1,
      set_hash: wornSetHash(c.outfit),
    });
  });

  it('a new set is a new row; the same set again within the hour moves last_seen but not times_seen', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'old' });
    await run(fake, c.payload());
    vi.setSystemTime(T0 + 10 * MIN);
    await run(fake, c.payload({ checksum: 'new2' }));
    expect(fake.worn).toHaveLength(1);
    expect(fake.worn[0].times_seen).toBe(1);
    expect(Date.parse(fake.worn[0].last_seen)).toBe(T0 + 10 * MIN);

    vi.setSystemTime(T0 + 20 * MIN);
    const other = c.name === 'quarmy'
      ? { equipped: QUARMY_EQUIPPED.map(e => (e.slot === 'Head' ? { ...e, item_id: 202 } : e)) }
      : { rows: INVENTORY_ROWS.map(r => (r.slot_label === 'Head' ? { ...r, item_id: 202 } : r)) };
    await run(fake, c.payload({ checksum: 'new3', ...other }));
    expect(fake.worn).toHaveLength(2);
  });

  it('the same set captured again after the hour counts', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'old' });
    await run(fake, c.payload());
    vi.setSystemTime(T0 + COUNT_GAP_MS + MIN);
    await run(fake, c.payload({ checksum: 'new2' }));
    expect(fake.worn).toHaveLength(1);
    expect(fake.worn[0].times_seen).toBe(2);
  });

  it('the unchanged path counts the newest set, at most once an hour', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'old' });
    await run(fake, c.payload());                                   // real write: times_seen 1
    const unchanged = c.payload({ checksum: 'same' });
    const stored = { name: 'Aldenmar', [c.checksumCol]: 'same' };
    const again = fakeSupabase(stored);
    again.worn.push(...fake.worn);

    // Every 10 minutes for 50 minutes: still inside the hour of the real write, so nothing counts.
    for (let m = 10; m <= 50; m += 10) {
      vi.setSystemTime(T0 + m * MIN);
      expect((await run(again, unchanged)).body).toEqual({ ok: true, skipped: 'unchanged' });
    }
    expect(again.worn[0].times_seen).toBe(1);
    expect(Date.parse(again.worn[0].last_seen)).toBe(T0 + 50 * MIN);   // still observed, just not counted

    // Past the hour: one count, then the cap closes again however often the upload repeats.
    for (let m = 61; m <= 100; m += 10) {
      vi.setSystemTime(T0 + m * MIN);
      await run(again, unchanged);
    }
    expect(again.worn[0].times_seen).toBe(2);
    vi.setSystemTime(T0 + 125 * MIN);
    await run(again, unchanged);
    expect(again.worn[0].times_seen).toBe(3);
  });

  it('the unchanged path counts the NEWEST set, not an older one', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'same' });
    const old = { id: 1, source: c.name, set_hash: 'aaa', slots: { Head: 1 }, times_seen: 5, last_seen: new Date(T0 - 5 * 86_400_000).toISOString(), counted_at: new Date(T0 - 5 * 86_400_000).toISOString() };
    const cur = { id: 2, source: c.name, set_hash: 'bbb', slots: { Head: 2 }, times_seen: 1, last_seen: new Date(T0 - 2 * 3_600_000).toISOString(), counted_at: new Date(T0 - 2 * 3_600_000).toISOString() };
    fake.worn.push(old, cur);
    await run(fake, c.payload({ checksum: 'same' }));
    expect(old.times_seen).toBe(5);
    expect(cur.times_seen).toBe(2);
  });

  it('the unchanged path with no history seeds the set from what is stored', async () => {
    const stored = c.name === 'quarmy'
      ? { gear: QUARMY_EQUIPPED.map(e => ({ slot: e.slot, item_id: e.item_id })) }
      : { inventory: INVENTORY_ROWS.filter((r, i, a) => a.findIndex(x => x.slot_label === r.slot_label) === i).map(r => ({ slot_label: r.slot_label, item_id: r.item_id })) };
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'same' }, stored);
    const out = await run(fake, c.payload({ checksum: 'same' }));
    expect(out.body).toEqual({ ok: true, skipped: 'unchanged' });
    expect(fake.worn).toHaveLength(1);
    expect(fake.worn[0]).toMatchObject({ source: c.name, slots: c.outfit, times_seen: 1 });
  });

  it('records nothing for a character opted out of stats', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', exclude_from_stats: true, [c.checksumCol]: 'old' });
    const out = await run(fake, c.payload());
    expect(out.body.ok).toBe(true);                                  // the upload itself is still served
    expect(fake.worn).toHaveLength(0);
    const unchangedFake = fakeSupabase({ name: 'Aldenmar', exclude_from_stats: true, [c.checksumCol]: 'same' }, {
      gear: QUARMY_EQUIPPED, inventory: INVENTORY_ROWS,
    });
    await run(unchangedFake, c.payload({ checksum: 'same' }));
    expect(unchangedFake.worn).toHaveLength(0);
  });

  it('records nothing for a character opted out of inventory (and keeps the early return)', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', exclude_inventory: true, [c.checksumCol]: 'old' });
    const out = await run(fake, c.payload());
    expect(out.body).toEqual({ ok: true, skipped: 'opted_out' });
    expect(fake.worn).toHaveLength(0);
  });

  it('an upload with nothing worn records nothing', async () => {
    const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: 'old' });
    const empty = c.name === 'quarmy'
      ? { equipped: [{ slot: 'Ammo', item_id: 999, item_name: 'Arrows' }], bags: [{ slot: 'General1', item_id: 5, item_name: 'Bag' }] }
      : { rows: [{ slot_label: 'General1', item_id: 5, item_name: 'Bag', quantity: 1 }] };
    const out = await run(fake, c.payload(empty));
    expect(out.body.ok).toBe(true);
    expect(fake.worn).toHaveLength(0);
  });

  it('a failing worn-set write never fails the upload (real write and unchanged path)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const stored of ['old', 'same']) {
      const fake = fakeSupabase({ name: 'Aldenmar', [c.checksumCol]: stored }, {
        failWornWrites: true, gear: QUARMY_EQUIPPED, inventory: INVENTORY_ROWS,
      });
      const out = await run(fake, c.payload({ checksum: stored === 'same' ? 'same' : 'new' }));
      expect(out.status).toBe(200);
      expect(out.body.ok).toBe(true);
    }
  });
});

describe('migration 20261031130000', () => {
  const SQL = stripSql(readSource(path.join(ROOT, 'supabase/migrations/20261031130000_character_worn_sets.sql')));
  it('is idempotent', () => {
    expect(SQL).toMatch(/create table if not exists public\.character_worn_sets/);
    expect(SQL.match(/create (unique )?index/gi)).toHaveLength(2);
    expect(SQL.match(/create (unique )?index if not exists/gi)).toHaveLength(2);
  });
  it('keys a character like the inventory and spellbook tables, per source', () => {
    expect(SQL).toMatch(/create unique index if not exists character_worn_sets_uniq\s+on public\.character_worn_sets \(guild_id, lower\(character_name\), source, set_hash\)/);
  });
  it('indexes the top sets of a character by times_seen', () => {
    expect(SQL).toMatch(/\(guild_id, lower\(character_name\), source, times_seen desc, last_seen desc\)/);
  });
  it('is owner-private: RLS on, no policy for anyone, service role only', () => {
    expect(SQL).toMatch(/alter table public\.character_worn_sets enable row level security/);
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).toMatch(/grant all on public\.character_worn_sets to service_role/);
    expect(SQL).not.toMatch(/to (anon|authenticated|public)/i);
  });
  it('is not destructive', () => {
    expect(SQL).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/i);
  });
});
