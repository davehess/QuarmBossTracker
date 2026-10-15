// test/wolfpack-members-departures.test.js — wolfpack_members.is_member goes false when someone leaves the guild.
//
// Before this, the 6-hourly sync only ever wrote is_member:true, so a kicked member kept their roles (and
// officer-gate / Mimic identity) forever. Runs the real syncWolfpackMembers / markMemberLeft against a fake
// utils/supabase.js (functions swapped on the shared CJS module object, restored after each test) and a fake
// guild. The guildMemberRemove listener in index.js is sliced out and executed with a fake client.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const members = nodeRequire('./utils/wolfpackMembers');

const GUILD = '900000000000000001';
const idOf = (n) => String(100000000000000000n + BigInt(n));   // snowflakes exceed 2^53, so no Number math

// The wolfpack_members table, held in memory, answering the calls the module makes.
function fakeTable(rows) {
  const table = rows.map(r => ({ roles: ['r1'], role_names: ['Raid Pack'], ...r }));
  const updates = [];
  const swapped = {};
  const patch = (k, fn) => { swapped[k] = supabase[k]; supabase[k] = fn; };
  patch('isEnabled', () => true);
  patch('upsert', async (t, chunk) => {
    if (t !== 'wolfpack_members') return chunk;
    for (const row of chunk) {
      const hit = table.find(r => r.discord_id === row.discord_id);
      if (hit) Object.assign(hit, row); else table.push({ ...row });
    }
    return chunk;
  });
  // The real selectAllPaged, fed from the table, so its paging contract is exercised too.
  const realPaged = swapped.selectAllPaged = supabase.selectAllPaged;
  supabase.selectAllPaged = (t, q, order) => realPaged(t, q, order, async (_t, query) => {
    expect(query).toContain('is_member=eq.true');
    return table.filter(r => r.is_member).slice(Number(/offset=(\d+)/.exec(query)[1]), Number(/offset=(\d+)/.exec(query)[1]) + 1000)
      .map(r => ({ discord_id: r.discord_id }));
  });
  patch('update', async (t, query, body) => {
    updates.push({ t, query, body });
    const eq = /^discord_id=eq\.(\d+)$/.exec(query);
    const inn = /^discord_id=in\.\(([\d,]+)\)&is_member=eq\.true$/.exec(query);
    if (!eq && !inn) throw new Error('fake: unsupported update filter ' + query);
    const ids = new Set(eq ? [eq[1]] : inn[1].split(','));
    const hit = table.filter(r => ids.has(r.discord_id) && (eq || r.is_member));
    hit.forEach(r => Object.assign(r, body));
    return hit.map(r => ({ ...r }));
  });
  return { table, updates, restore: () => { for (const k of Object.keys(swapped)) supabase[k] = swapped[k]; } };
}

// A guild whose full fetch returns the given ids (plus optional bot).
function fakeClient(presentIds, { bots = [] } = {}) {
  const mk = (id, bot) => ({
    id, nickname: 'n' + id, joinedAt: new Date(0), displayAvatarURL: () => 'a',
    roles: { cache: new Map([['r1', { id: 'r1', name: 'Raid Pack' }]]) },
    user: { bot, globalName: null, username: 'u' + id },
  });
  const fetched = new Map([...presentIds.map(i => [i, mk(i, false)]), ...bots.map(i => [i, mk(i, true)])]);
  fetched.filter = (fn) => [...fetched.values()].filter(fn);   // discord.js Collection.filter, as a plain array
  const guild = { id: GUILD, name: 'g', roles: { cache: new Map() }, members: { fetch: async () => fetched } };
  return { guilds: { cache: new Map([[GUILD, guild]]), fetch: async () => guild } };
}

let env;
beforeEach(() => {
  env = { ...process.env };
  process.env.SUPABASE_URL = 'https://x.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.DISCORD_GUILD_ID = GUILD;
});
let fake;
afterEach(() => { fake?.restore(); fake = null; process.env = env; });

const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => idOf(from + i));

describe('syncWolfpackMembers — departures', () => {
  it('flips members absent from a full fetch to is_member=false and clears their roles', async () => {
    fake = fakeTable(ids(1, 10).map(discord_id => ({ discord_id, is_member: true, user_id: 'u-' + discord_id, nickname: 'keep' })));
    const res = await members.syncWolfpackMembers(fakeClient(ids(1, 8)));
    expect(res.departed).toBe(2);
    for (const r of fake.table) {
      const left = r.discord_id === idOf(9) || r.discord_id === idOf(10);
      expect(r.is_member).toBe(!left);
      expect(r.role_names).toEqual(left ? [] : ['Raid Pack']);
      expect(r.roles).toEqual(left ? [] : ['r1']);
      expect(r.user_id).toBe('u-' + r.discord_id);      // history and name resolution survive
      expect(r.nickname).toBe(left ? 'keep' : 'n' + r.discord_id);
    }
  });

  it('does not count bots as present, and does not resurrect a row that already left', async () => {
    fake = fakeTable([
      { discord_id: idOf(1), is_member: true },
      { discord_id: idOf(2), is_member: true },
      { discord_id: idOf(3), is_member: false, role_names: [], roles: [] },
    ]);
    const res = await members.syncWolfpackMembers(fakeClient([idOf(1)], { bots: [idOf(2)] }));
    expect(res.departed).toBe(1);
    expect(fake.table.find(r => r.discord_id === idOf(2)).is_member).toBe(false);
    expect(fake.table.find(r => r.discord_id === idOf(3)).is_member).toBe(false);
  });

  it('a person who rejoined is restored by the sync (upsert writes is_member:true again)', async () => {
    fake = fakeTable([{ discord_id: idOf(1), is_member: false, role_names: [], roles: [] }, { discord_id: idOf(2), is_member: true }]);
    await members.syncWolfpackMembers(fakeClient([idOf(1), idOf(2)]));
    const back = fake.table.find(r => r.discord_id === idOf(1));
    expect(back.is_member).toBe(true);
    expect(back.role_names).toEqual(['Raid Pack']);
  });

  it('partial-fetch guard: a fetch under half the rows on file flips nobody', async () => {
    fake = fakeTable(ids(1, 10).map(discord_id => ({ discord_id, is_member: true })));
    const res = await members.syncWolfpackMembers(fakeClient(ids(1, 4)));      // 4 < 50% of 10
    expect(res.departed).toBe(0);
    expect(fake.updates).toHaveLength(0);
    expect(fake.table.every(r => r.is_member)).toBe(true);
  });

  it('the guard is a ratio, not a ban: exactly half is accepted', async () => {
    fake = fakeTable(ids(1, 10).map(discord_id => ({ discord_id, is_member: true })));
    const res = await members.syncWolfpackMembers(fakeClient(ids(1, 5)));
    expect(res.departed).toBe(5);
  });

  it('an empty fetch flips nobody', async () => {
    fake = fakeTable(ids(1, 3).map(discord_id => ({ discord_id, is_member: true })));
    const res = await members.reconcileDepartedMembers([]);
    expect(res.skipped).toBe('partial-fetch');
    expect(fake.updates).toHaveLength(0);
  });

  it('a failed read of the current members flips nobody', async () => {
    fake = fakeTable(ids(1, 3).map(discord_id => ({ discord_id, is_member: true })));
    supabase.selectAllPaged = async () => null;                                 // restored by fake.restore()
    const res = await members.reconcileDepartedMembers(ids(1, 2));
    expect(res.skipped).toBe('read-failed');
    expect(fake.updates).toHaveLength(0);
  });

  it('flips in batches of 50 ids so the filter URL stays short', async () => {
    fake = fakeTable(ids(1, 160).map(discord_id => ({ discord_id, is_member: true })));
    const res = await members.reconcileDepartedMembers(ids(1, 100));            // 60 gone
    expect(res.flipped).toBe(60);
    expect(fake.updates.map(u => u.query.split(',').length)).toEqual([50, 10]);
  });

  it('a failure in the reconcile does not fail the sync', async () => {
    fake = fakeTable(ids(1, 4).map(discord_id => ({ discord_id, is_member: true })));
    supabase.selectAllPaged = async () => { throw new Error('boom'); };
    const res = await members.syncWolfpackMembers(fakeClient(ids(1, 4)));
    expect(res.synced).toBe(4);
    expect(res.departed).toBe(0);
  });
});

describe('markMemberLeft + guildMemberRemove listener', () => {
  it('flips exactly one member and leaves the rest', async () => {
    fake = fakeTable(ids(1, 3).map(discord_id => ({ discord_id, is_member: true })));
    expect(await members.markMemberLeft(idOf(2))).toBe(true);
    expect(fake.table.map(r => r.is_member)).toEqual([true, false, true]);
    expect(fake.table[1].role_names).toEqual([]);
    expect(fake.table[0].role_names).toEqual(['Raid Pack']);
  });

  it('never throws and refuses a non-numeric id', async () => {
    fake = fakeTable([{ discord_id: idOf(1), is_member: true }]);
    expect(await members.markMemberLeft('1 or 1=1')).toBe(false);
    expect(fake.updates).toHaveLength(0);
    supabase.update = async () => { throw new Error('down'); };
    await expect(members.markMemberLeft(idOf(1))).resolves.toBe(false);
  });

  // Run the real listener block from index.js against a fake client.
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'client.on(Events.GuildMemberRemove,', '\n});');
  function register() {
    let handler;
    const client = { on: (ev, fn) => { if (ev === 'REMOVE') handler = fn; } };
    new Function('client', 'Events', 'require', 'process', block)(client, { GuildMemberRemove: 'REMOVE' }, () => members, process);
    return handler;
  }

  it('listener marks the leaver in this guild immediately', async () => {
    fake = fakeTable(ids(1, 3).map(discord_id => ({ discord_id, is_member: true })));
    register()({ id: idOf(3), guild: { id: GUILD }, user: { bot: false } });
    await new Promise(r => setImmediate(r));
    expect(fake.table.map(r => r.is_member)).toEqual([true, true, false]);
  });

  it('listener ignores other guilds and bots, and survives a malformed event', async () => {
    fake = fakeTable(ids(1, 2).map(discord_id => ({ discord_id, is_member: true })));
    const h = register();
    h({ id: idOf(1), guild: { id: 'other' }, user: { bot: false } });
    h({ id: idOf(2), guild: { id: GUILD }, user: { bot: true } });
    expect(() => h(null)).not.toThrow();
    await new Promise(r => setImmediate(r));
    expect(fake.updates).toHaveLength(0);
  });
});
