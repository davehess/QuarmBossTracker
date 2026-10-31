// test/guilds-new.test.js — "Start a guild" and invites (the guild lead, 2026-10-31, DECISIONS §492; wizard steps 2 and 3
// in docs/DESIGN-raidmimic-hosted.md §4). Pins:
//   - the slug derived from a name, and the shape rules (name 3-40, slug 3-24 in the registry's shape, never 'wolfpack',
//     a Discord server id of 5-25 digits or empty);
//   - createGuild, RUN against an in-memory database: guild + owner row + audit row, the redirect to /guilds/<slug>, a taken
//     slug or Discord server, one guild per player per 24 hours, a rollback when the owner row cannot be written;
//   - invite codes: the alphabet is the hub_invites check constraint, six characters, seven days, 25 uses, and every
//     refusal (member, stranger, another guild's officer, the cap, a collision);
//   - revoking sets expires_at to now, scoped to the guild;
//   - who may open /guilds/<slug> (member / open-guild visitor / 404) and that a member's request never reads hub_invites;
//   - the pageMeta entries, the noindex, and the /guilds links.
//
// Action code is EVALUATED (real source, stubbed collaborators); source-text assertions run over comment-stripped source
// (CLAUDE.md "comments satisfy text assertions").
//
// Run: npx vitest run test/guilds-new.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  slugFromName, cleanDisplayName, validateGuildInput, guildAccess, canManageInvites, generateInviteCode, newInviteRow,
  inviteIsActive, activeInvites, INVITE_ALPHABET, RESERVED_SLUGS, INVITE_MAX_USES, INVITE_TTL_MS, CREATE_LIMIT, CREATE_WINDOW_MS,
} from '../web/lib/hubGuilds.ts';
import { INVITE_CODE_RX, GUILD_SLUG_RX } from '../web/lib/hubRegistry.ts';
import { isRaidmimicOpenPath } from '../web/lib/raidmimicHost.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const webRequire = createRequire(path.join(ROOT, 'web/package.json'));

function mockBoth(id, factory) {
  vi.doMock(id, factory);
  try { vi.doMock(webRequire.resolve(id), factory); } catch { /* not installed here */ }
}

// ── An in-memory stand-in for the slice of supabase-js these actions use ────────────────────────────────────────
// `unique` lists the key sets that raise 23505 on insert; `failInsert` makes one table's insert fail; a table set to null is
// "relation does not exist".
function memDb(tables = {}, { unique = {}, failInsert = {} } = {}) {
  const writes = [];
  const reads = [];
  let n = 0;
  return {
    tables, writes, reads,
    from(name) {
      const q = { op: 'select', filters: [], payload: null, opts: null, selectOpts: null, returning: false, single: null };
      const rows = () => (tables[name] ??= []);
      const run = () => {
        if (tables[name] === null) return { data: null, count: null, error: { message: `relation "${name}" does not exist` } };
        const hit = (r) => q.filters.every(f => f(r));
        let out = [];
        if (q.op === 'select') {
          reads.push(name);
          out = rows().filter(hit);
          if (q.selectOpts?.head) return { data: null, count: out.length, error: null };
        } else if (q.op === 'update') {
          out = rows().filter(hit);
          out.forEach(r => Object.assign(r, q.payload));
          writes.push({ table: name, op: 'update', payload: JSON.parse(JSON.stringify(q.payload)) });
        } else if (q.op === 'delete') {
          const gone = rows().filter(hit);
          tables[name] = rows().filter(r => !hit(r));
          writes.push({ table: name, op: 'delete' });
          out = gone;
        } else if (q.op === 'insert') {
          if (failInsert[name]) return { data: null, error: { message: failInsert[name] } };
          const row = { created_at: new Date().toISOString(), ...q.payload };   // the column default every hub_* table has
          for (const keys of unique[name] ?? []) {
            if (rows().some(r => keys.every(k => r[k] != null && r[k] === row[k]))) {
              return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${name}_${keys.join('_')}_key"` } };
            }
          }
          writes.push({ table: name, op: 'insert', payload: JSON.parse(JSON.stringify(q.payload)) });
          rows().push(row);
          out = [row];
        } else if (q.op === 'upsert') {
          const keys = String(q.opts?.onConflict ?? '').split(',').filter(Boolean);
          const row = { ...q.payload };
          writes.push({ table: name, op: 'upsert', payload: JSON.parse(JSON.stringify(q.payload)) });
          const at = keys.length ? rows().find(r => keys.every(k => r[k] === row[k])) : null;
          if (at) { Object.assign(at, row); out = [at]; }
          else { const r = { ...(name === 'hub_players' ? { player_id: `p${++n}` } : {}), ...row }; rows().push(r); out = [r]; }
        }
        if (q.single === 'one') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'expected one row' } };
        if (q.single === 'maybe') return { data: out[0] ?? null, error: null };
        return { data: q.op === 'select' || q.returning ? out.map(r => ({ ...r })) : null, error: null };
      };
      const b = {
        select(_cols, opts) { if (q.op !== 'select') q.returning = true; else q.selectOpts = opts ?? null; return b; },
        eq(c, v) { q.filters.push(r => r[c] === v); return b; },
        is(c, v) { q.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
        gte(c, v) { q.filters.push(r => r[c] != null && r[c] >= v); return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; },
        upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return b; },
        update(p) { q.op = 'update'; q.payload = p; return b; },
        delete() { q.op = 'delete'; return b; },
        single() { q.single = 'one'; return Promise.resolve(run()); },
        maybeSingle() { q.single = 'maybe'; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const hours = (h) => new Date(Date.now() - h * 3600_000).toISOString();

// ── 1. The name, the slug, the shape rules ──────────────────────────────────────────────────────────────────────
describe('slugFromName', () => {
  it.each([
    ['Wolf Pack', 'wolf-pack'],
    ['  The   Brackwyn Raiders!! ', 'the-brackwyn-raiders'],
    ['Café Corvale', 'cafe-corvale'],
    ['A--B__C', 'a-b-c'],
    ['---edge---', 'edge'],
    ['Rethlan 2', 'rethlan-2'],
  ])('%j -> %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });
  it('is cut to 24 characters and never ends on a dash', () => {
    const s = slugFromName('Nyssara Zarrin Aldenmar Brackwyn Corvale Rethlan');
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s).toMatch(/[a-z0-9]$/);
    expect(slugFromName('abcdefghijklmnopqrstuvw xyz')).toBe('abcdefghijklmnopqrstuvw');   // 23 chars then a space: no trailing dash
  });
  it('anything that is not a name gives an empty slug (the form then refuses it)', () => {
    for (const v of [null, undefined, '', '!!!', '日本語']) expect(slugFromName(v)).toBe('');
  });
  it('every non-empty result of 3+ characters is in the registry slug shape', () => {
    for (const n of ['Wolf Pack', 'The Brackwyn Raiders', 'X Y Z', 'Café', 'a1b2c3d4e5f6g7h8i9j0k1l2m3']) {
      const s = slugFromName(n);
      if (s.length >= 3) expect(s, n).toMatch(GUILD_SLUG_RX);
    }
  });
});

describe('validateGuildInput', () => {
  const ok = { displayName: 'Brackwyn Raiders', slug: 'brackwyn-raiders', discordGuildId: '', openJoin: false };
  it('accepts a good guild and returns clean values (name trimmed and squeezed, empty Discord id null)', () => {
    expect(validateGuildInput({ ...ok, displayName: '  Brackwyn   Raiders ' })).toEqual({
      ok: true, values: { displayName: 'Brackwyn Raiders', slug: 'brackwyn-raiders', discordGuildId: null, openJoin: false },
    });
  });
  it('the name is 3 to 40 characters after cleaning', () => {
    for (const bad of ['', '  ', 'ab', ' a  ', 'x'.repeat(41)]) {
      expect(validateGuildInput({ ...ok, displayName: bad }), JSON.stringify(bad)).toMatchObject({ ok: false, errors: { displayName: expect.any(String) } });
    }
    expect(validateGuildInput({ ...ok, displayName: 'abc' }).ok).toBe(true);
    expect(validateGuildInput({ ...ok, displayName: 'x'.repeat(40) }).ok).toBe(true);
  });
  it('control characters in a name become spaces: one line', () => {
    expect(cleanDisplayName('a\nb\u0000c\td')).toBe('a b c d');
  });
  it('the slug is 3 to 24 characters in the registry shape', () => {
    for (const bad of ['', 'ab', 'a'.repeat(25), '-abc', 'abc-', 'ab c', 'ab_c', 'a.b', '../x', 'ABC!']) {
      expect(validateGuildInput({ ...ok, slug: bad }), JSON.stringify(bad)).toMatchObject({ ok: false, errors: { slug: expect.any(String) } });
    }
    for (const good of ['abc', 'a-b', 'a'.repeat(24), 'a1-2b']) expect(validateGuildInput({ ...ok, slug: good }).ok, good).toBe(true);
  });
  it('a slug typed in capitals is lowered, not refused', () => {
    expect(validateGuildInput({ ...ok, slug: 'Brackwyn-Raiders' })).toMatchObject({ ok: true, values: { slug: 'brackwyn-raiders' } });
  });
  it("'wolfpack' is never a hub guild (the table refuses it too), and neither is 'new' (it would be shadowed by /guilds/new)", () => {
    for (const s of ['wolfpack', 'WolfPack', ' wolfpack ', 'new']) {
      expect(validateGuildInput({ ...ok, slug: s }), s).toMatchObject({ ok: false, errors: { slug: expect.stringMatching(/reserved/) } });
    }
    expect(RESERVED_SLUGS).toEqual(expect.arrayContaining(['wolfpack', 'new']));
    expect(stripSql(read('supabase/migrations/20261023160000_open_hub_registry.sql'))).toMatch(/guild_id <> 'wolfpack'/);
  });
  it('the Discord server id is empty or 5 to 25 digits', () => {
    for (const good of ['', '12345', '1168893924329402420', '9'.repeat(25), null, undefined]) {
      expect(validateGuildInput({ ...ok, discordGuildId: good }).ok, String(good)).toBe(true);
    }
    for (const bad of ['1234', '9'.repeat(26), '12 345', 'abc12345', '123.456', '-12345']) {
      expect(validateGuildInput({ ...ok, discordGuildId: bad }), bad).toMatchObject({ ok: false, errors: { discordGuildId: expect.any(String) } });
    }
    expect(stripSql(read('supabase/migrations/20261031150000_hub_registry_discord_guild.sql'))).toContain("'^[0-9]{5,25}$'");
  });
  it('open_join is on only for a strict true (a checkbox string or a missing value is off)', () => {
    expect(validateGuildInput({ ...ok, openJoin: true })).toMatchObject({ values: { openJoin: true } });
    for (const v of [false, undefined, null, 'true', 'on', 1]) expect(validateGuildInput({ ...ok, openJoin: v })).toMatchObject({ values: { openJoin: false } });
  });
  it('reports every bad field at once', () => {
    const r = validateGuildInput({ displayName: 'x', slug: 'x', discordGuildId: '1' });
    expect(Object.keys(r.errors).sort()).toEqual(['discordGuildId', 'displayName', 'slug']);
  });
});

// ── 2. createGuild, run ─────────────────────────────────────────────────────────────────────────────────────────
describe('the createGuild server action, run (web/app/guilds/new/actions.ts)', () => {
  let store, user, redirected;
  async function load() {
    vi.resetModules();
    redirected = [];
    mockBoth('next/cache', () => ({ revalidatePath() {} }));
    mockBoth('next/navigation', () => ({ redirect: (to) => { redirected.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { to }); } }));
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => store }));
    vi.doMock('@/lib/lockout', async () => await import('../web/lib/lockout.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    vi.doMock('@/lib/hubGuilds', async () => await import('../web/lib/hubGuilds.ts'));
    const { createGuild } = await import('../web/app/guilds/new/actions.ts');
    // a success redirects (throws NEXT_REDIRECT in the framework); the helper turns that into a return value for the test
    return async (input) => {
      try { return { returned: await createGuild(input) }; } catch (e) { if (e?.message === 'NEXT_REDIRECT') return { redirectedTo: e.to }; throw e; }
    };
  }
  const UNIQUE = { hub_guilds: [['guild_id'], ['discord_guild_id']] };
  const good = { displayName: 'Brackwyn Raiders', slug: 'brackwyn-raiders', discordGuildId: '', openJoin: false };
  const fresh = (extra = {}, opts = { unique: UNIQUE }) => memDb({ hub_players: [], hub_guilds: [], hub_memberships: [], audit_log: [], ...extra }, opts);

  function beforeEachCase() {
    user = { id: 'auth-u1', app_metadata: { provider_id: 'd-100' }, user_metadata: { custom_claims: { global_name: 'Aldenmar' } } };
    store = fresh();
  }

  it('refuses a signed-out caller and writes nothing', async () => {
    beforeEachCase(); user = null;
    const create = await load();
    expect((await create(good)).returned).toEqual({ ok: false, message: 'Sign in first.' });
    expect(store.writes).toEqual([]);
  });
  it('creates the guild on the commons plan, makes the creator its owner, and goes to /guilds/<slug>', async () => {
    beforeEachCase();
    const create = await load();
    const res = await create({ ...good, discordGuildId: '1168893924329402420', openJoin: true });
    expect(res).toEqual({ redirectedTo: '/guilds/brackwyn-raiders' });
    expect(redirected).toEqual(['/guilds/brackwyn-raiders']);
    const player = store.tables.hub_players[0];
    expect(player).toMatchObject({ discord_id: 'd-100', display_name: 'Aldenmar' });
    expect(store.tables.hub_guilds).toEqual([expect.objectContaining({
      guild_id: 'brackwyn-raiders', display_name: 'Brackwyn Raiders', plan: 'commons', open_join: true,
      discord_guild_id: '1168893924329402420', created_by: player.player_id,
    })]);
    expect(store.tables.hub_memberships).toEqual([expect.objectContaining({ guild_id: 'brackwyn-raiders', player_id: player.player_id, role: 'owner' })]);
  });
  it('the guild is written before its owner row, and open_join defaults to false, the Discord server to null', async () => {
    beforeEachCase();
    const create = await load();
    await create(good);
    const order = store.writes.filter(w => w.op === 'insert').map(w => w.table);
    expect(order.indexOf('hub_guilds')).toBeLessThan(order.indexOf('hub_memberships'));
    expect(store.tables.hub_guilds[0]).toMatchObject({ open_join: false, discord_guild_id: null });
  });
  it('writes an audit row tagged with the new guild (not Wolf Pack), naming who started it and no free text', async () => {
    beforeEachCase();
    const create = await load();
    await create({ ...good, discordGuildId: '123456789' });
    expect(store.writes.filter(w => w.table === 'audit_log')).toEqual([{
      table: 'audit_log', op: 'insert',
      payload: {
        action: 'hub_guild_created', actor_discord_id: 'd-100', actor_name: 'Aldenmar', guild_id: 'brackwyn-raiders',
        payload: { guild_id: 'brackwyn-raiders', open_join: false, has_discord_server: true },
      },
    }]);
  });
  it('a failing audit write never undoes the guild', async () => {
    beforeEachCase(); store = fresh({ audit_log: null });
    const create = await load();
    expect(await create(good)).toEqual({ redirectedTo: '/guilds/brackwyn-raiders' });
    expect(store.tables.hub_guilds).toHaveLength(1);
  });
  it('an invalid form comes back with per-field errors and writes nothing', async () => {
    beforeEachCase();
    const create = await load();
    const r = (await create({ displayName: 'x', slug: 'wolfpack', discordGuildId: '12' })).returned;
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['discordGuildId', 'displayName', 'slug']);
    expect(store.writes).toEqual([]);
  });
  it('the creator is the SESSION player: a player id smuggled into the input is ignored', async () => {
    beforeEachCase();
    const create = await load();
    await create({ ...good, created_by: 'someone-else', playerId: 'someone-else', role: 'member' });
    expect(store.tables.hub_guilds[0].created_by).toBe(store.tables.hub_players[0].player_id);
    expect(store.tables.hub_memberships[0].role).toBe('owner');
  });
  it('a taken address is refused on the slug field and creates nothing', async () => {
    // no unique keys here: it is the action's own check that must catch it (the next test is the keys' turn)
    beforeEachCase(); store = fresh({ hub_guilds: [{ guild_id: 'brackwyn-raiders', display_name: 'Other', created_by: 'px', created_at: hours(500) }] }, { unique: {} });
    const create = await load();
    const r = (await create(good)).returned;
    expect(r).toEqual({ ok: false, errors: { slug: expect.stringMatching(/already taken/) } });
    expect(store.tables.hub_guilds).toHaveLength(1);
    expect(store.tables.hub_memberships).toEqual([]);
  });
  it('a Discord server that already belongs to a guild is refused on its own field', async () => {
    beforeEachCase(); store = fresh({ hub_guilds: [{ guild_id: 'other-guild', display_name: 'Other', discord_guild_id: '123456789', created_by: 'px', created_at: hours(500) }] }, { unique: {} });
    const create = await load();
    const r = (await create({ ...good, discordGuildId: '123456789' })).returned;
    expect(r).toEqual({ ok: false, errors: { discordGuildId: expect.stringMatching(/already belongs/) } });
    expect(store.tables.hub_guilds).toHaveLength(1);
  });
  it('losing a race for the address (the unique key fires after the check) is the same answer, not a crash', async () => {
    beforeEachCase();
    const create = await load();
    const realFrom = store.from.bind(store);
    store.from = (name) => {   // the pre-check saw a free address; somebody else's insert lands just before ours
      const b = realFrom(name);
      if (name === 'hub_guilds') {
        const ins = b.insert.bind(b);
        b.insert = (p) => { store.tables.hub_guilds.push({ guild_id: p.guild_id, display_name: 'Won', created_by: 'px', created_at: hours(500) }); return ins(p); };
      }
      return b;
    };
    const r = (await create(good)).returned;
    expect(r).toEqual({ ok: false, errors: { slug: expect.stringMatching(/already taken/) } });
  });
  it('one guild per player per 24 hours: the second is refused with a plain message and creates nothing', async () => {
    beforeEachCase();
    const create = await load();
    expect((await create(good)).redirectedTo).toBe('/guilds/brackwyn-raiders');
    const second = (await create({ ...good, displayName: 'Second', slug: 'second-guild' })).returned;
    expect(second).toMatchObject({ ok: false, message: expect.stringMatching(/One a day/) });
    expect(store.tables.hub_guilds.map(g => g.guild_id)).toEqual(['brackwyn-raiders']);
    expect(CREATE_LIMIT).toBe(1);
    expect(CREATE_WINDOW_MS).toBe(24 * 3600_000);
  });
  it('the limit counts the last 24 hours only: a guild started 25 hours ago does not block a new one', async () => {
    beforeEachCase();
    const create0 = await load();
    await create0(good);   // seeds the player
    store.tables.hub_guilds[0].created_at = hours(25);
    const create = await load();
    expect((await create({ ...good, displayName: 'Second', slug: 'second-guild' })).redirectedTo).toBe('/guilds/second-guild');
  });
  it('...while one started 23 hours ago does', async () => {
    beforeEachCase();
    const create0 = await load();
    await create0(good);
    store.tables.hub_guilds[0].created_at = hours(23);
    const create = await load();
    expect((await create({ ...good, displayName: 'Second', slug: 'second-guild' })).returned).toMatchObject({ ok: false, message: expect.stringMatching(/One a day/) });
  });
  it('the limit is per player, and a guild someone else started does not count against you', async () => {
    beforeEachCase();
    const create = await load();
    await create(good);
    user = { id: 'auth-u2', app_metadata: { provider_id: 'd-200' }, user_metadata: {} };
    expect((await create({ ...good, displayName: 'Other Guild', slug: 'other-guild' })).redirectedTo).toBe('/guilds/other-guild');
  });
  it('a refused attempt (bad form, taken address) does not use up the day', async () => {
    beforeEachCase();
    const create = await load();
    await create({ ...good, slug: 'wolfpack' });
    await create({ ...good, displayName: 'x' });
    expect((await create(good)).redirectedTo).toBe('/guilds/brackwyn-raiders');
  });
  it('if the owner row cannot be written the guild is taken back, so no guild is left without an owner', async () => {
    beforeEachCase(); store = fresh({}, { unique: UNIQUE, failInsert: { hub_memberships: 'boom' } });
    const create = await load();
    const r = (await create(good)).returned;
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Could not start/) });
    expect(store.tables.hub_guilds).toEqual([]);
    expect(redirected).toEqual([]);
  });
  it('a database without the registry says so instead of throwing', async () => {
    beforeEachCase(); store = memDb({ hub_players: null });
    const create = await load();
    expect((await create(good)).returned).toEqual({ ok: false, message: 'The guild registry is not open yet.' });
  });
});

// ── 3. Invite codes ─────────────────────────────────────────────────────────────────────────────────────────────
describe('invite code generation', () => {
  it('the alphabet is exactly the hub_invites check constraint: 31 characters, no 0 O 1 I L', () => {
    expect(INVITE_ALPHABET).toHaveLength(31);
    expect(new Set(INVITE_ALPHABET).size).toBe(31);
    for (const bad of '01OIL') expect(INVITE_ALPHABET).not.toContain(bad);
    for (const ch of INVITE_ALPHABET) expect(ch).toMatch(/^[A-HJKMNP-Z2-9]$/);
    // and every character the constraint allows is in the alphabet
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(INVITE_ALPHABET.includes(ch), ch).toBe(/^[A-HJKMNP-Z2-9]$/.test(ch));
    }
    expect(stripSql(read('supabase/migrations/20261023160000_open_hub_registry.sql'))).toContain(INVITE_CODE_RX.source);
  });
  it('a code is six characters in the constraint shape, over many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) { const c = generateInviteCode(); expect(c).toMatch(INVITE_CODE_RX); seen.add(c); }
    expect(seen.size).toBeGreaterThan(1990);   // 31^6 is ~887 million: a repeat in 2000 draws would be a broken generator
  });
  it('uses every letter of the alphabet and no other', () => {
    const letters = new Set();
    for (let i = 0; i < 3000; i++) for (const ch of generateInviteCode()) letters.add(ch);
    expect([...letters].sort().join('')).toBe([...INVITE_ALPHABET].sort().join(''));
  });
  it('maps bytes onto the alphabet in order, and skips the bytes past the last whole multiple of 31 (no letter is likelier)', () => {
    expect(generateInviteCode((b) => b.fill(0))).toBe('AAAAAA');
    expect(generateInviteCode((b) => { b.set([1, 2, 3, 4, 5, 6]); return b; })).toBe('BCDEFG');
    // 248 is the first skipped byte (256 - 256 % 31 = 248): the six after it are used instead
    expect(generateInviteCode((b) => { b.set([248, 255, 250, 7, 8, 9, 10, 11, 12]); return b; })).toBe('HJKMNP');
  });
  it('draws more bytes when too many are skipped', () => {
    let calls = 0;
    const c = generateInviteCode((b) => { calls++; b.fill(calls === 1 ? 250 : 3); return b; });
    expect(c).toBe('DDDDDD');
    expect(calls).toBe(2);
  });
  it('the row: 25 uses, seven days from now, the guild and the officer who made it', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    const row = newInviteRow('alpha', 'p1', now, 'K7M2QP');
    expect(row).toEqual({ code: 'K7M2QP', guild_id: 'alpha', created_by: 'p1', expires_at: '2026-11-07T12:00:00.000Z', max_uses: 25 });
    expect(INVITE_MAX_USES).toBe(25);
    expect(INVITE_TTL_MS).toBe(7 * 86400_000);
    expect(newInviteRow('alpha', 'p1').code).toMatch(INVITE_CODE_RX);
  });
  it('max_uses stays inside the table’s check (1 to 100)', () => {
    expect(INVITE_MAX_USES).toBeGreaterThanOrEqual(1);
    expect(INVITE_MAX_USES).toBeLessThanOrEqual(100);
    expect(stripSql(read('supabase/migrations/20261023160000_open_hub_registry.sql'))).toMatch(/max_uses\s+integer not null default 25 check \(max_uses between 1 and 100\)/);
  });
});

describe('which codes are live', () => {
  const NOW = new Date('2026-10-31T12:00:00Z');
  const inv = (over) => ({ code: 'K7M2QP', uses: 0, max_uses: 25, expires_at: '2026-11-07T12:00:00Z', ...over });
  it('live: not expired and with a use left', () => {
    expect(inviteIsActive(inv(), NOW)).toBe(true);
    expect(inviteIsActive(inv({ uses: 24 }), NOW)).toBe(true);
  });
  it('expired (the instant of expiry too), used up, or a garbage date is not live', () => {
    expect(inviteIsActive(inv({ expires_at: '2026-10-31T11:59:59Z' }), NOW)).toBe(false);
    expect(inviteIsActive(inv({ expires_at: '2026-10-31T12:00:00Z' }), NOW)).toBe(false);
    expect(inviteIsActive(inv({ uses: 25 }), NOW)).toBe(false);
    expect(inviteIsActive(inv({ expires_at: 'garbage' }), NOW)).toBe(false);
  });
  it('a revoked code (expires_at set to now) drops out of the list', () => {
    expect(activeInvites([inv({ code: 'AAAAAA', expires_at: NOW.toISOString() }), inv({ code: 'BBBBBB' })], NOW).map(i => i.code)).toEqual(['BBBBBB']);
  });
  it('the list is the live ones, the longest-lived first', () => {
    const rows = [inv({ code: 'AAAAAA', expires_at: '2026-11-01T00:00:00Z' }), inv({ code: 'BBBBBB', expires_at: '2026-11-07T00:00:00Z' }), inv({ code: 'CCCCCC', uses: 25 })];
    expect(activeInvites(rows, NOW).map(i => i.code)).toEqual(['BBBBBB', 'AAAAAA']);
  });
});

// ── 4. createInvite and revokeInvite, run ───────────────────────────────────────────────────────────────────────
describe('the invite server actions, run (web/app/guilds/[slug]/actions.ts)', () => {
  let store, user, revalidated;
  async function load() {
    vi.resetModules();
    revalidated = [];
    mockBoth('next/cache', () => ({ revalidatePath: (p) => revalidated.push(p) }));
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => store }));
    vi.doMock('@/lib/lockout', async () => await import('../web/lib/lockout.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    vi.doMock('@/lib/hubGuilds', async () => await import('../web/lib/hubGuilds.ts'));
    return await import('../web/app/guilds/[slug]/actions.ts');
  }
  const soon = (d = 3) => new Date(Date.now() + d * 864e5).toISOString();
  function setup(over = {}) {
    store = memDb({
      hub_players: [
        { player_id: 'p-owner', discord_id: 'd-owner', deleted_at: null },
        { player_id: 'p-off', discord_id: 'd-off', deleted_at: null },
        { player_id: 'p-mem', discord_id: 'd-mem', deleted_at: null },
        { player_id: 'p-guest', discord_id: 'd-guest', deleted_at: null },
        { player_id: 'p-left', discord_id: 'd-left', deleted_at: null },
        { player_id: 'p-stranger', discord_id: 'd-stranger', deleted_at: null },
        { player_id: 'p-other', discord_id: 'd-other', deleted_at: null },
      ],
      hub_guilds: [
        { guild_id: 'alpha', display_name: 'Alpha', suspended_at: null, open_join: false },
        { guild_id: 'beta', display_name: 'Beta', suspended_at: null, open_join: false },
        { guild_id: 'frozen', display_name: 'Frozen', suspended_at: '2026-10-01T00:00:00Z', open_join: false },
      ],
      hub_memberships: [
        { guild_id: 'alpha', player_id: 'p-owner', role: 'owner', left_at: null },
        { guild_id: 'alpha', player_id: 'p-off', role: 'officer', left_at: null },
        { guild_id: 'alpha', player_id: 'p-mem', role: 'member', left_at: null },
        { guild_id: 'alpha', player_id: 'p-guest', role: 'guest', left_at: null },
        { guild_id: 'alpha', player_id: 'p-left', role: 'officer', left_at: '2026-10-02T00:00:00Z' },
        { guild_id: 'beta', player_id: 'p-other', role: 'owner', left_at: null },
        { guild_id: 'frozen', player_id: 'p-owner', role: 'owner', left_at: null },
      ],
      hub_invites: [
        { code: 'BETA22', guild_id: 'beta', created_by: 'p-other', created_at: hours(1), expires_at: soon(), max_uses: 25, uses: 0 },
      ],
      ...over,
    }, { unique: { hub_invites: [['code']] } });
  }
  const as = (id) => { user = id ? { id: `auth-${id}`, app_metadata: { provider_id: id }, user_metadata: {} } : null; };

  describe('createInvite', () => {
    it.each(['d-owner', 'd-off'])('an %s makes a code: 25 uses, 7 days, this guild, made by them', async (who) => {
      setup(); as(who);
      const { createInvite } = await load();
      const r = await createInvite('alpha');
      expect(r.ok).toBe(true);
      expect(r.code).toMatch(INVITE_CODE_RX);
      const row = store.tables.hub_invites.find(i => i.code === r.code);
      expect(row).toMatchObject({ guild_id: 'alpha', max_uses: 25, created_by: who === 'd-owner' ? 'p-owner' : 'p-off' });
      const ttl = Date.parse(row.expires_at) - Date.now();
      expect(ttl).toBeGreaterThan(7 * 864e5 - 60_000);
      expect(ttl).toBeLessThanOrEqual(7 * 864e5);
      expect(revalidated).toEqual(['/guilds/alpha']);
    });
    it.each([
      ['a member', 'd-mem'], ['a guest', 'd-guest'], ['an officer who LEFT', 'd-left'], ['a stranger', 'd-stranger'],
      ['the owner of ANOTHER guild', 'd-other'], ['someone with no hub_players row', 'd-nobody'],
    ])('%s is refused and nothing is written', async (_label, who) => {
      setup(); as(who);
      const { createInvite } = await load();
      const r = await createInvite('alpha');
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/owner or an officer/) });
      expect(store.writes).toEqual([]);
    });
    it('signed out is refused; a suspended guild and a malformed slug are refused even for its owner', async () => {
      setup(); as(null);
      const { createInvite } = await load();
      expect(await createInvite('alpha')).toEqual({ ok: false, message: 'Sign in first.' });
      as('d-owner');
      expect((await createInvite('frozen')).ok).toBe(false);
      expect((await createInvite('../alpha')).ok).toBe(false);
      expect((await createInvite('ALPHA')).ok).toBe(false);
      expect(store.writes).toEqual([]);
    });
    it('a deleted account holds no office', async () => {
      setup(); as('d-owner'); store.tables.hub_players[0].deleted_at = '2026-10-20T00:00:00Z';
      const { createInvite } = await load();
      expect((await createInvite('alpha')).ok).toBe(false);
    });
    it('at ten live codes it asks for a revoke first; expired and used-up codes do not count', async () => {
      setup(); as('d-owner');
      const live = (i) => ({ code: `LIVE${i}A`.slice(0, 6).replace(/[01OIL]/g, 'X'), guild_id: 'alpha', expires_at: soon(), max_uses: 25, uses: 0 });
      const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE', 'FFFFFF', 'GGGGGG', 'HHHHHH', 'JJJJJJ', 'KKKKKK'];
      store.tables.hub_invites.push(...codes.map(c => ({ ...live(0), code: c })));
      store.tables.hub_invites.push({ ...live(0), code: 'MMMMMM', expires_at: hours(1) }, { ...live(0), code: 'NNNNNN', uses: 25 });
      const { createInvite } = await load();
      expect(await createInvite('alpha')).toMatchObject({ ok: false, message: expect.stringMatching(/10 live codes/) });
      store.tables.hub_invites.find(i => i.code === 'AAAAAA').expires_at = hours(1);   // revoked
      expect((await createInvite('alpha')).ok).toBe(true);
    });
    it('another guild’s codes do not count toward this guild’s cap', async () => {
      setup(); as('d-owner');
      const { createInvite } = await load();
      expect((await createInvite('alpha')).ok).toBe(true);
    });
    it('a code that already exists is redrawn, never overwritten', async () => {
      setup(); as('d-owner');
      const { createInvite } = await load();
      let n = 0;
      const realFrom = store.from.bind(store);
      store.from = (name) => {
        const b = realFrom(name);
        if (name !== 'hub_invites') return b;
        const ins = b.insert.bind(b);
        b.insert = (p) => ins(n++ < 2 ? { ...p, code: 'BETA22' } : p);   // the first two draws collide with beta's code
        return b;
      };
      const r = await createInvite('alpha');
      expect(r.ok).toBe(true);
      expect(r.code).not.toBe('BETA22');
      expect(store.tables.hub_invites.find(i => i.code === 'BETA22').guild_id).toBe('beta');
    });
    it('five collisions in a row give up politely', async () => {
      setup(); as('d-owner');
      const { createInvite } = await load();
      const realFrom = store.from.bind(store);
      store.from = (name) => {
        const b = realFrom(name);
        if (name !== 'hub_invites') return b;
        const ins = b.insert.bind(b);
        b.insert = (p) => ins({ ...p, code: 'BETA22' });
        return b;
      };
      expect(await createInvite('alpha')).toMatchObject({ ok: false, message: expect.stringMatching(/Could not make a code/) });
    });
    it('a database without the registry is a message, not a throw', async () => {
      setup({ hub_players: null }); as('d-owner');
      const { createInvite } = await load();
      expect(await createInvite('alpha')).toEqual({ ok: false, message: 'The guild registry is not open yet.' });
    });
  });

  describe('revokeInvite', () => {
    const seed = () => store.tables.hub_invites.push({ code: 'K7M2QP', guild_id: 'alpha', created_by: 'p-owner', created_at: hours(1), expires_at: soon(), max_uses: 25, uses: 3 });
    it('sets expires_at to now: the code is spent, and the row (and its use count) is kept', async () => {
      setup(); seed(); as('d-off');
      const { revokeInvite } = await load();
      const before = Date.now();
      const r = await revokeInvite('alpha', 'K7M2QP');
      expect(r).toEqual({ ok: true, message: 'Revoked K7M2QP.', code: 'K7M2QP' });
      const row = store.tables.hub_invites.find(i => i.code === 'K7M2QP');
      expect(Date.parse(row.expires_at)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(row.expires_at)).toBeLessThanOrEqual(Date.now() + 1000);
      expect(row.uses).toBe(3);
      expect(inviteIsActive(row)).toBe(false);
      expect(store.writes.filter(w => w.op === 'delete')).toEqual([]);
      expect(revalidated).toEqual(['/guilds/alpha']);
    });
    it('accepts the code in any case, with spaces or dashes', async () => {
      setup(); seed(); as('d-owner');
      const { revokeInvite } = await load();
      expect((await revokeInvite('alpha', ' k7m-2qp ')).ok).toBe(true);
    });
    it('a member, a guest and a stranger cannot revoke', async () => {
      for (const who of ['d-mem', 'd-guest', 'd-stranger', 'd-left']) {
        setup(); seed(); as(who);
        const { revokeInvite } = await load();
        expect((await revokeInvite('alpha', 'K7M2QP')).ok, who).toBe(false);
        expect(store.writes, who).toEqual([]);
      }
    });
    it('an officer of one guild cannot revoke another guild’s code by naming its letters', async () => {
      setup(); seed(); as('d-other');   // owner of beta
      const { revokeInvite } = await load();
      expect((await revokeInvite('alpha', 'K7M2QP')).ok).toBe(false);                       // not an officer of alpha
      expect(await revokeInvite('beta', 'K7M2QP')).toMatchObject({ ok: false, message: expect.stringMatching(/not one of this guild/) });   // alpha's code, beta's slug
      const alphas = store.tables.hub_invites.find(i => i.code === 'K7M2QP');
      expect(inviteIsActive(alphas)).toBe(true);
    });
    it('a malformed code never reaches the database', async () => {
      setup(); as('d-owner');
      const { revokeInvite } = await load();
      for (const bad of ['', 'K7M2Q', 'K7M2Q0', "K7M2Q' or 1=1", null]) expect((await revokeInvite('alpha', bad)).ok, String(bad)).toBe(false);
      expect(store.writes).toEqual([]);
    });
    it('a code that does not exist is a plain answer', async () => {
      setup(); as('d-owner');
      const { revokeInvite } = await load();
      expect(await revokeInvite('alpha', 'ZZZZZZ')).toMatchObject({ ok: false });
    });
  });
});

// ── 5. Who may open /guilds/<slug> ──────────────────────────────────────────────────────────────────────────────
describe('guildAccess (the page’s visibility rules)', () => {
  const open = { display_name: 'Open Guild', open_join: true, suspended_at: null };
  const closed = { display_name: 'Closed Guild', open_join: false, suspended_at: null };
  const mem = (role, left_at = null) => ({ role, left_at });
  it.each(['owner', 'officer', 'member', 'guest'])('an active %s sees the guild, with their role', (role) => {
    expect(guildAccess(closed, mem(role))).toEqual({ kind: 'member', role });
    expect(guildAccess(open, mem(role))).toEqual({ kind: 'member', role });
  });
  it('a non-member of an OPEN guild sees its name only (a visitor)', () => {
    expect(guildAccess(open, null)).toEqual({ kind: 'visitor' });
    expect(guildAccess(open, mem('member', '2026-10-01T00:00:00Z'))).toEqual({ kind: 'visitor' });   // someone who left
  });
  it('a non-member of a CLOSED guild gets a 404: the page never confirms it exists', () => {
    expect(guildAccess(closed, null)).toEqual({ kind: 'hidden' });
    expect(guildAccess(closed, mem('officer', '2026-10-01T00:00:00Z'))).toEqual({ kind: 'hidden' });
  });
  it('open_join must be strictly true: null, missing, "true" and 1 are closed', () => {
    for (const v of [null, undefined, 'true', 1]) expect(guildAccess({ ...open, open_join: v }, null)).toEqual({ kind: 'hidden' });
  });
  it('no such guild, or a suspended one, is a 404 for everyone, members included', () => {
    expect(guildAccess(null, mem('owner'))).toEqual({ kind: 'hidden' });
    expect(guildAccess(undefined, null)).toEqual({ kind: 'hidden' });
    expect(guildAccess({ ...open, suspended_at: '2026-10-01T00:00:00Z' }, mem('owner'))).toEqual({ kind: 'hidden' });
  });
  it('only an owner or officer manages invites', () => {
    expect(canManageInvites('owner')).toBe(true);
    expect(canManageInvites('officer')).toBe(true);
    for (const r of ['member', 'guest', '', null, undefined, 'Owner', 'admin']) expect(canManageInvites(r), String(r)).toBe(false);
  });
});

describe('the /guilds/[slug] page, as source', () => {
  const page = code('web/app/guilds/[slug]/page.tsx');
  it('needs a sign-in and sends the visitor back to the same guild after it', () => {
    expect(page).toMatch(/if \(!user\) redirect\(`\/auth\/signin\?next=\$\{encodeURIComponent\(`\/guilds\/\$\{slug\}`\)\}`\);/);
  });
  it('a bad slug, a hidden guild and a missing guild are all notFound()', () => {
    expect(page).toMatch(/if \(!GUILD_SLUG_RX\.test\(slug\)\) notFound\(\);/);
    expect(page).toMatch(/if \(access\.kind === 'hidden' \|\| !guild\) notFound\(\);/);
  });
  it('reads the invites ONLY inside the owner/officer branch, scoped to this guild', () => {
    const reads = page.match(/from\('hub_invites'\)/g) || [];
    expect(reads).toHaveLength(1);
    const at = page.indexOf("from('hub_invites')");
    expect(page.lastIndexOf('if (manage) {', at)).toBeGreaterThan(page.indexOf('const manage = canManageInvites(access.role);'));
    expect(page.slice(at, at + 160)).toMatch(/\.eq\('guild_id', slug\)/);
  });
  it('a member without office sees the ask and no controls; the controls are inside the manage branch', () => {
    expect(page).toMatch(/Ask an officer for an invite code\./);
    const manageBranch = page.slice(page.indexOf('{manage ? ('), page.indexOf('Ask an officer for an invite code.'));
    expect(manageBranch).toMatch(/<NewInviteButton/);
    expect(manageBranch).toMatch(/<RevokeButton/);
    expect(page.slice(page.indexOf('Ask an officer for an invite code.'))).not.toMatch(/<NewInviteButton|<RevokeButton/);
  });
  it('shows the Discord server id only when one is set, and never writes', () => {
    expect(page).toMatch(/\{guild\.discord_guild_id && \(/);
    expect(page).not.toMatch(/\.(?:insert|upsert|update|delete)\(/);
  });
  it('reads the player by the session’s Discord id, and the membership by that player: no id from the URL', () => {
    expect(page).toMatch(/from\('hub_players'\)[^;]*\.eq\('discord_id', discordId\)/);
    expect(page).toMatch(/from\('hub_memberships'\)[^;]*\.eq\('guild_id', slug\)\.eq\('player_id', player\.player_id\)/);
  });
  it('a visitor to an open guild is shown the display name and none of the guild’s other fields', () => {
    const visitor = page.slice(page.indexOf("access.kind === 'visitor'"), page.indexOf('const { count: memberCount }'));
    expect(visitor).toMatch(/guild\.display_name/);
    expect(visitor).not.toMatch(/discord_guild_id|guild\.plan|memberCount|hub_invites/);
  });
});

// ── 6. Cards, metadata, the door ────────────────────────────────────────────────────────────────────────────────
describe('Discord cards and search engines', () => {
  it('/guilds/new has its own card, marked [beta]', () => {
    const m = metaForPath('/guilds/new');
    expect(m.title).toBe('[beta] Start a guild');
    expect(m.description.length).toBeGreaterThan(20);
    expect(m.description.length).toBeLessThanOrEqual(300);
  });
  it('/guilds/<slug> has the generic "Guild" card and never a guild’s name', () => {
    for (const p of ['/guilds/brackwyn-raiders', '/guilds/some-open-guild/', '/guilds/UPPER']) {
      const m = metaForPath(p);
      expect(m.title, p).toBe('[beta] Guild');
      expect(m.title).not.toMatch(/brackwyn|open|upper/i);
    }
  });
  it('/guilds itself is unchanged, and /guilds/new is not mistaken for a guild', () => {
    expect(metaForPath('/guilds').title).toBe('[beta] Your guilds');
    expect(metaForPath('/guilds/new').title).not.toBe(metaForPath('/guilds/anything').title);
  });
  it('both pages are noindex and marked [beta]', () => {
    const newPage = code('web/app/guilds/new/page.tsx');
    expect(newPage).toMatch(/title: '\[beta\] Start a guild'/);
    expect(newPage).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(newPage).toMatch(/<NewPageTag/);
    const slugPage = code('web/app/guilds/[slug]/page.tsx');
    expect(slugPage).toMatch(/export async function generateMetadata/);
    expect(slugPage).toMatch(/pageMetadata\(`\/guilds\/\$\{encodeURIComponent\(params\.slug\)\}`\)/);
    expect(slugPage).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(slugPage).not.toMatch(/export const metadata/);
    expect(slugPage).toMatch(/<NewPageTag/);
  });
  it('/guilds/new needs a sign-in, and goes back to itself after it', () => {
    expect(code('web/app/guilds/new/page.tsx')).toMatch(/if \(!user\) redirect\('\/auth\/signin\?next=\/guilds\/new'\);/);
  });
});

describe('the door on raidmimic hosts', () => {
  it('/guilds/new and /guilds/<slug> are open paths (not rewritten to the landing page); look-alikes are not', () => {
    for (const p of ['/guilds/new', '/guilds/brackwyn-raiders']) expect(isRaidmimicOpenPath(p), p).toBe(true);
    for (const p of ['/guildsnew', '/guild/new']) expect(isRaidmimicOpenPath(p), p).toBe(false);
  });
});

describe('the /guilds page links', () => {
  const page = code('web/app/guilds/page.tsx');
  it('"Start a guild" is a link to /guilds/new, not a stub', () => {
    const start = page.slice(page.indexOf('Start a guild</h2>'));
    expect(start).toMatch(/href="\/guilds\/new"/);
    expect(start).not.toMatch(/Coming soon|setup#guild/);
  });
  it('each membership card opens /guilds/<slug>', () => {
    expect(page).toMatch(/href=\{`\/guilds\/\$\{g\.guild_id\}`\}/);
    expect(page).not.toMatch(/own page is coming soon/);
  });
  it('Wolf Pack stays the special case: its card still goes to wolfpack.quest, and no hub_guilds slug page is built for it', () => {
    expect(page).toMatch(/href=\{`\$\{PROD_SITE_URL\}\/me`\}/);
    expect(page).not.toMatch(/\/guilds\/wolfpack/);
  });
  it('the page itself still never writes, and still has its six reads', () => {
    expect(page).not.toMatch(/\.(?:insert|upsert|update)\(/);
    expect((page.match(/\.from\('/g) || []).length).toBe(6);
  });
});

describe('the new actions, as source', () => {
  const create = code('web/app/guilds/new/actions.ts');
  const invites = code('web/app/guilds/[slug]/actions.ts');
  it('are server-action files, and take the actor from the session', () => {
    expect(read('web/app/guilds/new/actions.ts')).toMatch(/^'use server';/m);
    expect(read('web/app/guilds/[slug]/actions.ts')).toMatch(/^'use server';/m);
    expect(create).toMatch(/supabaseServer\(\)\.auth\.getUser\(\)/);
    expect(invites).toMatch(/supabaseServer\(\)\.auth\.getUser\(\)/);
  });
  it('createGuild writes only commons guilds, and never the Wolf Pack tables', () => {
    expect(create).toMatch(/plan: 'commons'/);
    expect(create).not.toMatch(/wolfpack_members|wolfpack_roles|characters/);
  });
  it('revoke is keyed on the code AND the guild', () => {
    expect(invites).toMatch(/\.eq\('code', code\)\s*\.eq\('guild_id', slug\)/);
  });
  it('the form derives its slug with the same function the server shape-checks with', () => {
    const form = code('web/app/guilds/new/NewGuildForm.tsx');
    expect(form).toMatch(/import \{ slugFromName,/);
    expect(form).toMatch(/if \(!slugTouched\) setSlug\(slugFromName\(v\)\);/);
    expect(form).toMatch(/createGuild\(\{ displayName: name, slug, discordGuildId, openJoin \}\)/);
    expect(form).toMatch(/Project Quarm/);
  });
  it('the form’s open_join checkbox starts off', () => {
    expect(code('web/app/guilds/new/NewGuildForm.tsx')).toMatch(/useState\(false\);\s*const \[result/);
  });
});
