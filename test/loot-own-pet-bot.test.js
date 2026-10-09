// test/loot-own-pet-bot.test.js — gear a charmer loots back off their OWN pet's corpse is not loot.
//
// The guild lead, 2026-10-09: "anything a charmer gives to their pet (and we have the spawn ID) and they loot is not
// counted as loot. It was already theirs." The charmer's agent sets `from_own_pet: true` on the looted event (agent
// branch, test/loot-own-pet-agent.test.js); this side stores it, keeps it sticky, and leaves those rows out of the
// per-looter value, the "who looted what" list and /admin/loot.
//   SQL:  supabase/migrations/20261009050000_looted_items_from_own_pet.sql (text assertions on the comment-stripped file);
//   JS:   _handleAgentLooted + _nightLootPanelBody sliced out of index.js and run for real; utils/lootValue.js required.
// Item and character names are invented fixtures.
//
// Run: npx vitest run test/loot-own-pet-bot.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, stripSql, stripJs, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const require_ = createRequire(BOT_INDEX);
const { buildLootValue, _resetPriceCache } = require_('./utils/lootValue');

const MIG = path.join(ROOT, 'supabase', 'migrations');
const MIG_FILE = path.join(MIG, '20261009050000_looted_items_from_own_pet.sql');
const sql = stripSql(readSource(MIG_FILE)).replace(/\s+/g, ' ');
const prevSql = stripSql(readSource(path.join(MIG, '20261009030000_loot_value_skip_pet_gear.sql'))).replace(/\s+/g, ' ');
const src = readSource(BOT_INDEX);

const NOW = Date.parse('2026-10-09T03:00:00Z');
const MIN = 60_000, HOUR = 3_600_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

beforeEach(() => { _resetPriceCache(); });

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('migration 20261009050000', () => {
  it('adds the column idempotently, NOT NULL default false', () => {
    expect(sql).toMatch(/alter table public\.looted_items add column if not exists from_own_pet boolean not null default false;/i);
  });

  it('loot_value_rows keeps its signature and return columns, and never DROPs anything', () => {
    const head = (s) => s.match(/create or replace function public\.loot_value_rows\(.*?\) language sql/i)?.[0];
    expect(head(sql)).toBeTruthy();
    expect(head(sql)).toBe(head(prevSql));
    expect(sql).not.toMatch(/\bdrop (function|table|trigger|column|index|policy|view)\b/i);
  });

  it('excludes own-pet lines in the l CTE and keeps the charm-pet-gear CTE and anti-join', () => {
    expect(sql).toMatch(/with l as \( select li\.looter_lower, li\.looter_character, li\.item_name, li\.zone, li\.looted_at from looted_items li where li\.guild_id = p_guild_id and li\.looted_at >= p_since and not li\.from_own_pet \)/i);
    expect(sql).toMatch(/pet as \( select n\.item_name from names n where exists \(select 1 from eqemu_items i where i\.name = n\.item_name and i\.mr < 0\) or lower\(n\.item_name\) in \(select lower\(g\.item_name\) from loot_pet_gear_names g\) \)/i);
    expect(sql).toMatch(/left join pet on pet\.item_name = l\.item_name where pet\.item_name is null/i);
  });

  it('is otherwise the body it replaces: removing the new clause leaves the previous function body', () => {
    const body = (s) => s.slice(s.indexOf('as $$'), s.lastIndexOf('$$') + 2);
    expect(body(sql).replace(/ and not li\.from_own_pet/, '')).toBe(body(prevSql));
  });

  it('is idempotent: only IF NOT EXISTS / CREATE OR REPLACE / COMMENT statements', () => {
    const noInline = stripSql(readSource(MIG_FILE)).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    const stmts = noInline.replace(/\$\$.*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''").split(';').map(s => s.trim()).filter(Boolean);
    expect(stmts.length).toBe(3);
    for (const s of stmts) expect(s).toMatch(/^(alter table public\.looted_items add column if not exists|create or replace function|comment on function)/i);
  });

  it('loot_value_grouped and loot_value_by_looter_v3 read loot_value_rows, so they inherit it untouched', () => {
    expect(sql).not.toMatch(/loot_value_grouped|loot_value_by_looter_v3/i);
    const g = stripSql(readSource(path.join(MIG, '20261008190000_loot_value_grouped.sql'))).replace(/\s+/g, ' ');
    expect(g).toMatch(/from loot_value_rows\(p_guild_id, p_since\) r group by r\.looter_lower, r\.item_name/i);
    expect(g).toMatch(/from loot_value_rows\(p_guild_id, p_since\) r group by r\.looter_lower order by/i);
    expect(g.slice(g.indexOf('function public.loot_value_grouped'))).not.toMatch(/from looted_items/i);
  });
});

// ── ingest: _handleAgentLooted ──────────────────────────────────────────────────────────────────────────────
function makeIngest({ columnMissing = false } = {}) {
  const block = sliceBlock(src, 'async function _handleAgentLooted', '\n}\n');
  const upserts = [];
  const sb = { isEnabled: () => true, upsert: async (table, rows, key) => {
    upserts.push({ table, rows, key });
    if (columnMissing && rows.some(r => 'from_own_pet' in r)) return null;   // PostgREST 400 -> the helper answers null
    return rows;
  } };
  globalThis.__lootSb = sb;
  const out = evalBlock(`
    const mimicLink = { requireAgentAuth: async () => ({ discord_id: 'd1' }) };
    const _scheduleEventRollCard = () => {};
    const require = () => globalThis.__lootSb;
    ${block}`, ['_handleAgentLooted']);
  async function post(events) {
    const body = Buffer.from(JSON.stringify({ events }));
    const req = { async *[Symbol.asyncIterator]() { yield body; } };
    const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } };
    await out._handleAgentLooted(req, res);
    return res;
  }
  return { post, upserts };
}
const ev = (item, extra = {}) => ({ item, looter: 'Aldenmar', zone: 'The Overthere', at: iso(MIN), ...extra });

describe('_handleAgentLooted — from_own_pet', () => {
  it('stores from_own_pet: true on a flagged event, on the same upsert key as before', async () => {
    const { post, upserts } = makeIngest();
    const res = await post([ev('Cloak of Flames', { from_own_pet: true })]);
    expect(res.code).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('looted_items');
    expect(upserts[0].key).toBe('guild_id,looter_lower,item_name,looted_at');
    expect(upserts[0].rows[0].from_own_pet).toBe(true);
  });

  it('accepts only the boolean true: strings, numbers, objects and false never flag', async () => {
    const { post, upserts } = makeIngest();
    const bad = ['true', 'TRUE', 1, '1', {}, [], null, false, 'yes'];
    await post(bad.map((v, i) => ev('Item ' + i, { from_own_pet: v })));
    const rows = upserts.flatMap(u => u.rows);
    expect(rows).toHaveLength(bad.length);
    expect(rows.every(r => !('from_own_pet' in r))).toBe(true);   // the key is only ever written when true
  });

  it('an unflagged row carries no from_own_pet key at all, so a re-send cannot flip an existing true to false', async () => {
    const { post, upserts } = makeIngest();
    await post([ev('Plain Band')]);
    expect(upserts[0].rows[0]).not.toHaveProperty('from_own_pet');
  });

  it('a mixed batch is two upserts (flagged rows never share a body with rows that omit the key)', async () => {
    const { post, upserts } = makeIngest();
    await post([ev('Plain Band'), ev('Pet Cloak', { from_own_pet: true })]);
    expect(upserts).toHaveLength(2);
    const flagged = upserts.filter(u => u.rows.every(r => r.from_own_pet === true));
    const plain = upserts.filter(u => u.rows.every(r => !('from_own_pet' in r)));
    expect(flagged).toHaveLength(1);
    expect(plain).toHaveLength(1);
    expect(flagged[0].rows.map(r => r.item_name)).toEqual(['Pet Cloak']);
    expect(plain[0].rows.map(r => r.item_name)).toEqual(['Plain Band']);
  });

  it('the same line twice in one batch keeps the flag whichever copy carried it', async () => {
    for (const order of [[false, true], [true, false]]) {
      const { post, upserts } = makeIngest();
      await post(order.map(f => ev('Pet Cloak', f ? { from_own_pet: true } : {})));
      const rows = upserts.flatMap(u => u.rows);
      expect(rows).toHaveLength(1);
      expect(rows[0].from_own_pet).toBe(true);
    }
  });

  it('before the column exists, a flagged line is stored again without the flag instead of being lost', async () => {
    const { post, upserts } = makeIngest({ columnMissing: true });
    const res = await post([ev('Plain Band'), ev('Pet Cloak', { from_own_pet: true })]);
    expect(res.code).toBe(200);
    expect(upserts).toHaveLength(3);
    const last = upserts[2];
    expect(last.rows.map(r => r.item_name)).toEqual(['Pet Cloak']);
    expect(last.rows[0]).not.toHaveProperty('from_own_pet');
    expect(upserts[0].rows.map(r => r.item_name)).toEqual(['Plain Band']);
  });

  it('with the column there, a flagged line is upserted once', async () => {
    const { post, upserts } = makeIngest();
    await post([ev('Pet Cloak', { from_own_pet: true })]);
    expect(upserts).toHaveLength(1);
  });

  it('the old fields are unchanged', async () => {
    const { post, upserts } = makeIngest();
    await post([ev('Cloak of Flames')]);
    expect(upserts[0].rows[0]).toMatchObject({ guild_id: 'wolfpack', looter_character: 'Aldenmar', looter_lower: 'aldenmar', item_name: 'Cloak of Flames', zone: 'The Overthere', source: 'local_agent_v1', uploaded_by_discord_id: 'd1' });
  });
});

// ── Mimic Loot tab: totals and list ─────────────────────────────────────────────────────────────────────────
describe('buildLootValue — own-pet rows are not loot', () => {
  const values = new Map([
    ['Cloak of Flames', { value_cp: 54000, nodrop: true, pet_gear: false }],
    ['Haste Wand', { value_cp: 7000, nodrop: false, pet_gear: false }],
    ['Rusty Band', { value_cp: 9000, nodrop: true, pet_gear: true }],
  ]);
  const row = (looter, item, ago, extra = {}) => ({ looter_character: looter, item_name: item, zone: 'Z', looted_at: iso(ago), ...extra });

  it('leaves them out of items, value, priced and unpriced, and counts them in own_pet_items', () => {
    const rows = [
      row('Aldenmar', 'Cloak of Flames', MIN),
      row('Aldenmar', 'Haste Wand', 2 * MIN, { from_own_pet: true }),
      row('Brackwyn', 'Unknown Thing', 3 * MIN, { from_own_pet: true }),
    ];
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR });
    expect(out.totals).toEqual([{ looter: 'Aldenmar', items: 1, value_cp: 54000, nodrop_items: 1 }]);
    expect(out.total_value_cp).toBe(54000);
    expect(out.priced_items).toBe(1);
    expect(out.unpriced_items).toBe(0);
    expect(out.own_pet_items).toBe(2);
    expect(out.pet_gear_items).toBe(0);
  });

  it('an own-pet row that is also charm-pet gear counts once, as own-pet', () => {
    const out = buildLootValue([row('Aldenmar', 'Rusty Band', MIN, { from_own_pet: true })], values, { nowMs: NOW, windowMs: 12 * HOUR });
    expect(out.own_pet_items).toBe(1);
    expect(out.pet_gear_items).toBe(0);
  });

  it('only the boolean true counts, and only inside the window', () => {
    const rows = [
      row('Aldenmar', 'Cloak of Flames', MIN, { from_own_pet: 'true' }),
      row('Aldenmar', 'Cloak of Flames', 2 * MIN, { from_own_pet: false }),
      row('Aldenmar', 'Cloak of Flames', 20 * HOUR, { from_own_pet: true }),
    ];
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR });
    expect(out.totals[0].items).toBe(2);
    expect(out.own_pet_items).toBe(0);
  });
});

describe('_nightLootPanelBody — end to end through the shipped body', () => {
  const body = () => {
    const bodyBlock = sliceBlock(src, 'async function _nightLootPanelBody', '// ── end night-loot panel fetch ──');
    globalThis.__ownPetRequire = require_;
    return evalBlock('const require = globalThis.__ownPetRequire;\n' + bodyBlock, ['_nightLootPanelBody'])._nightLootPanelBody;
  };
  const loot = (id, looter, item, ago, extra = {}) => ({ id, guild_id: 'wolfpack', looter_character: looter, item_name: item, zone: 'Z', looted_at: iso(ago), ...extra });
  const itemRow = (id, name, price) => ({ id, name, price, nodrop: true, mr: 0 });
  const tables = () => ({
    roll_sets: [],
    looted_items: [
      loot(1, 'Aldenmar', 'Cloak of Flames', MIN),
      loot(2, 'Aldenmar', 'Haste Wand', 2 * MIN, { from_own_pet: true }),
      loot(3, 'Brackwyn', 'Haste Wand', 3 * MIN, { from_own_pet: false }),
      loot(4, 'Brackwyn', 'Cloak of Flames', 4 * MIN),
    ],
    eqemu_items: [itemRow(1, 'Cloak of Flames', 54000), itemRow(2, 'Haste Wand', 7000)],
    loot_pet_gear_names: [],
  });

  it('removes own-pet rows from the list and the totals, and counts them', async () => {
    const out = await body()(makeCapFake({ tables: tables() }), 'wolfpack', NOW, 12);
    expect(out.loot.map(r => r.looter + ':' + r.item).sort()).toEqual(['Aldenmar:Cloak of Flames', 'Brackwyn:Cloak of Flames', 'Brackwyn:Haste Wand']);
    expect(out.loot_total).toBe(3);
    expect(out.totals).toEqual([
      { looter: 'Brackwyn', items: 2, value_cp: 61000, nodrop_items: 0 },
      { looter: 'Aldenmar', items: 1, value_cp: 54000, nodrop_items: 0 },
    ]);
    expect(out.own_pet_items).toBe(1);
  });

  it('asks for the column, and a read that answers null (column absent) retries without it and still serves the panel', async () => {
    const fake = makeCapFake({ tables: tables() });
    const asked = [];
    const real = fake.selectAllPaged;
    fake.selectAllPaged = (table, qs, order) => {
      if (table === 'looted_items') asked.push(qs);
      if (table === 'looted_items' && /select=[^&]*from_own_pet/.test(qs)) return Promise.resolve(null);
      if (table === 'looted_items') return real(table, qs, order).then(rows => rows.map(({ from_own_pet, ...r }) => r));   // a table without the column
      return real(table, qs, order);
    };
    const out = await body()(fake, 'wolfpack', NOW, 12);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/select=[^&]*\bfrom_own_pet\b/);
    expect(asked[1]).not.toMatch(/from_own_pet/);
    expect(out.loot_total).toBe(4);               // no flag to read: nothing is excluded, nothing throws
    expect(out.own_pet_items).toBe(0);
  });

  it('still throws when the looted read fails outright (a hollow night is not an empty night)', async () => {
    const fake = makeCapFake({ tables: tables(), missing: ['looted_items'] });
    await expect(body()(fake, 'wolfpack', NOW, 12)).rejects.toThrow(/fetch failed/);
  });
});

// ── comments must not satisfy the assertions above ──────────────────────────────────────────────────────────
describe('source text', () => {
  it('index.js writes the field only for the boolean true, in the looted handler', () => {
    const handler = stripJs(sliceBlock(src, 'async function _handleAgentLooted', '\n}\n'));
    expect(handler).toMatch(/e\?\.from_own_pet === true/);
    expect(handler).toMatch(/\.\.\.\(fromOwnPet \? \{ from_own_pet: true \} : \{\}\)/);
  });
});
