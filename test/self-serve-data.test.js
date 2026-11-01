// test/self-serve-data.test.js — "Download my data" and "Delete my account" (the guild lead, 2026-11-01: the privacy
// page said "you ask an officer, and it is done by hand"; self-serve before payments go live).
//
// Three kinds of check, because each guards something the others cannot:
//   · BEHAVIOUR: web/lib/selfData.ts is imported and run against a fake client that enforces PostgREST's 1,000-row
//     response cap and records every query. The scoping, the secrets, the cap, the rate limit, and the ORDER of the
//     delete are asserted on what was actually called.
//   · SQL: supabase/migrations/20261101140000_member_self_delete.sql is read (comments stripped) and held to the
//     same table lists the export uses: every personal table is handled, no guild raid-record table is deleted.
//   · WIRING: the route, the action and the pages are read as source (comments stripped: a comment that explains
//     the rule must not satisfy the match) to hold that nothing about the person is taken from the request.
// Invented names throughout (Aldenmar, Brackwyn, Corvale, Zarrin): none of them is anybody.
//
// Run: npx vitest run test/self-serve-data.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  SELF_TABLES, PERSONAL_TABLES, GUILD_RECORD_TABLES, UNLINK_TARGETS, UNLINK_BATCH,
  EXPORT_ROW_CAP, EXPORT_CHARACTER_CAP, EXPORT_COOLDOWN_MIN, DELETE_WORD,
  isDeleteConfirmed, resolveSelf, exportChunks, claimExport, runSelfDelete, filterParts, exportKey,
} from '../web/lib/selfData.ts';
import { isRaidmimicOpenPath } from '../web/lib/raidmimicHost.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const js = (rel) => stripJs(read(rel));
const SQL_REL = 'supabase/migrations/20261101140000_member_self_delete.sql';
const sql = () => stripSql(read(SQL_REL));

const ME = { userId: '11111111-1111-4111-8111-111111111111', discordId: '700000000000000001' };
const OTHER_DISCORD = '700000000000000002';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

// ─── a fake PostgREST: the 1,000-row cap, and a log of every query ─────────────────────────────────────────────
function fakeDb({ tables = {}, fail = new Set() } = {}) {
  const log = [];
  const from = (table) => {
    const q = { table, select: null, or: null, eq: [], orders: [], range: null };
    const run = () => {
      log.push(q);
      if (fail.has(table)) return { data: null, error: { message: 'boom' } };
      const all = tables[table] ?? [];
      const [a, b] = q.range ?? [0, 999];
      return { data: all.slice(a, Math.min(b, a + 999) + 1), error: null };   // PostgREST never returns more than 1,000
    };
    const api = {
      select(s) { q.select = s; return api; },
      or(s) { q.or = s; return api; },
      eq(c, v) { q.eq.push([c, v]); return api; },
      order(c, o) { q.orders.push([c, o?.ascending !== false]); return api; },
      range(a, b) { q.range = [a, b]; return api; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  return { from, log };
}

const drain = async (gen) => { let s = ''; for await (const c of gen) s += c; return s; };

const CHARS = [
  { guild_id: 'wolfpack', name: 'Aldenmar' },
  { guild_id: 'wolfpack', name: 'Brackwyn' },
  { guild_id: 'hubguild', name: 'Corvale' },
];

describe('the typed confirm', () => {
  it('accepts DELETE (spaces forgiven) and nothing else', () => {
    expect(DELETE_WORD).toBe('DELETE');
    expect(isDeleteConfirmed('DELETE')).toBe(true);
    expect(isDeleteConfirmed('  DELETE ')).toBe(true);
    for (const bad of ['delete', 'Delete', '', 'DELETE ME', 'DELET', null, undefined, 7, ['DELETE']]) {
      expect(isDeleteConfirmed(bad)).toBe(false);
    }
  });
});

describe('who is asking: the session, and only the session', () => {
  const userFor = (id, did) => ({ id, app_metadata: { provider_id: did } });
  it('takes the login id and Discord id off the user', async () => {
    const db = fakeDb({ tables: { wolfpack_members: [] } });
    expect(await resolveSelf(db, userFor(ME.userId, ME.discordId))).toEqual({ ok: true, ids: ME });
  });
  it('refuses a login the members table ties to a DIFFERENT Discord id', async () => {
    const db = fakeDb({ tables: { wolfpack_members: [{ discord_id: OTHER_DISCORD }] } });
    expect(await resolveSelf(db, userFor(ME.userId, ME.discordId))).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('refuses a user with no usable Discord id', async () => {
    const db = fakeDb();
    expect((await resolveSelf(db, userFor(ME.userId, 'not-a-number'))).ok).toBe(false);
    expect((await resolveSelf(db, userFor(ME.userId, null))).ok).toBe(false);
    expect((await resolveSelf(db, null)).ok).toBe(false);
  });
});

describe('the download: scoped to the session, secrets never read', () => {
  async function runExport(extra = {}) {
    const db = fakeDb({
      tables: {
        characters: CHARS,
        hub_players: [{ player_id: '33333333-3333-4333-8333-333333333333' }],
        ...extra,
      },
    });
    const text = await drain(exportChunks(db, ME, new Date('2026-11-01T12:00:00Z')));
    return { db, text, out: JSON.parse(text) };
  }

  it('is one valid JSON document with every table in the list, and says what it leaves out', async () => {
    const { out } = await runExport();
    expect(Object.keys(out.tables)).toEqual(SELF_TABLES.map(t => t.table));
    expect(out.exported_at).toBe('2026-11-01T12:00:00.000Z');
    expect(out.not_included.length).toBeGreaterThan(0);
    expect(out.row_cap).toBe(EXPORT_ROW_CAP);
  });

  it('keys every query on the session\'s ids, their hub player, or their own character names, and nothing else', async () => {
    const { db } = await runExport();
    const allowedValues = new Set([ME.discordId, ME.userId, '33333333-3333-4333-8333-333333333333']);
    const allowedNames = new Set(CHARS.map(c => c.name));
    const bootstrap = new Set(['characters', 'hub_players']);
    let checked = 0;
    for (const q of db.log) {
      if (bootstrap.has(q.table) && q.or == null) {
        // the two lookups the export starts with: each is an .eq on the session's own Discord id
        expect(q.eq.every(([, v]) => v === ME.discordId)).toBe(true);
        continue;
      }
      expect(q.or, `${q.table} has an .or() filter`).toBeTruthy();
      for (const part of q.or.split(',')) {
        const m = /^([a-z_]+)\.(eq|in|ilike)\.(.+)$/.exec(part);
        expect(m, `${q.table}: ${part}`).toBeTruthy();
        const val = m[3].replace(/^\(|\)$/g, '');
        expect(allowedValues.has(val) || allowedNames.has(val), `${q.table}: ${part}`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(SELF_TABLES.length);
  });

  it('never mentions anyone else\'s id, even when the fixtures hold other people\'s rows', async () => {
    const decoy = [{ owner_discord_id: OTHER_DISCORD, user_id: OTHER_USER, text: 'not yours' }];
    const { db } = await runExport({ tells: decoy, mimic_sessions: decoy });
    const sent = JSON.stringify(db.log);
    expect(sent).not.toContain(OTHER_DISCORD);
    expect(sent).not.toContain(OTHER_USER);
  });

  it('runs name-keyed tables once per guild the person has characters in, with a guild filter, so another guild\'s same-named character is never read', async () => {
    const { db } = await runExport();
    const inv = db.log.filter(q => q.table === 'character_inventory');
    expect(inv.map(q => q.eq.find(([c]) => c === 'guild_id')?.[1]).sort()).toEqual(['hubguild', 'wolfpack']);
    expect(inv.find(q => q.eq.some(([, v]) => v === 'wolfpack')).or).toBe('character_name.ilike.Aldenmar,character_name.ilike.Brackwyn');
    expect(inv.find(q => q.eq.some(([, v]) => v === 'hubguild')).or).toBe('character_name.ilike.Corvale');
    // a table keyed on the Discord id needs no guild filter
    expect(db.log.filter(q => q.table === 'tells').every(q => q.eq.length === 0)).toBe(true);
  });

  it('cleans a character name to letters before it goes into a filter', () => {
    const spec = SELF_TABLES.find(t => t.table === 'character_inventory');
    // filterParts is handed already-cleaned names by loadOwnCharacters; the clean-up itself is exercised end to end:
    expect(filterParts(spec, ME, [], ['Aldenmar'])).toEqual(['character_name.ilike.Aldenmar']);
  });

  it('strips punctuation out of a stored name (a filter value can never carry a comma or a parenthesis)', async () => {
    const db = fakeDb({ tables: { characters: [{ guild_id: 'wolfpack', name: 'Zar,rin).or(x' }] } });
    await drain(exportChunks(db, ME));
    const inv = db.log.find(q => q.table === 'character_inventory');
    expect(inv.or).toBe('character_name.ilike.Zarrinorx');
  });

  it('never selects a secret, never selects *', () => {
    const SECRET = /session_token|token_hash|edit_key_hash|ip_hash|payload_enc|user_code|device_code|bid_amount|_enc\b|password|secret/i;
    for (const t of SELF_TABLES) {
      expect(t.select, t.table).not.toMatch(SECRET);
      expect(t.select, t.table).not.toContain('*');
    }
    const src = js('web/lib/selfData.ts');
    expect(src).not.toMatch(/select\(\s*['"`]\*/);
  });

  it('pages past the 1,000-row cap and stops at the per-table cap, saying so', async () => {
    const tells = Array.from({ length: EXPORT_ROW_CAP + 100 }, (_, i) => ({ id: i }));
    const { out } = await runExport({ tells });
    expect(out.tables.tells.row_count).toBe(EXPORT_ROW_CAP);
    expect(out.tables.tells.capped).toBe(true);
    expect(out.tables.tells.cap).toBe(EXPORT_ROW_CAP);
    expect(out.tables.tells.rows).toHaveLength(EXPORT_ROW_CAP);
  });

  it('returns a whole table that is under the cap but over one response, with capped false', async () => {
    const tells = Array.from({ length: 2300 }, (_, i) => ({ id: i }));
    const { out } = await runExport({ tells });
    expect(out.tables.tells.row_count).toBe(2300);
    expect(out.tables.tells.capped).toBe(false);
  });

  it('gives a character\'s private uploads the larger cap (an inventory runs past 8,000 rows)', async () => {
    expect(EXPORT_CHARACTER_CAP).toBeGreaterThan(8302);
    const rows = Array.from({ length: 6200 }, (_, i) => ({ id: i }));
    const { out } = await runExport({ character_inventory: rows });
    // two guilds each return the fixture; the point is that 5,000 < the count is NOT capped
    expect(out.tables.character_inventory.capped).toBe(false);
  });

  it('orders every query newest-first on its own order list, ending on a unique-looking column', async () => {
    const { db } = await runExport();
    for (const spec of SELF_TABLES) {
      const q = db.log.find(x => x.table === spec.table && x.or);   // (characters is also read once, bare, to find the names)
      expect(q.orders.map(([c]) => c)).toEqual(spec.order.map(o => o.col));
      expect(spec.order.length).toBeGreaterThan(0);
    }
  });

  it('reports a table it could not read inside the file instead of leaving a silent gap', async () => {
    const db = fakeDb({ tables: { characters: CHARS }, fail: new Set(['tells']) });
    const out = JSON.parse(await drain(exportChunks(db, ME)));
    expect(out.tables.tells.error).toMatch(/could not be read/);
    expect(out.tables.page_views.row_count).toBe(0);     // the rest of the file is intact
  });

  it('a person with no characters still gets their own data, and the name-keyed tables are simply empty', async () => {
    const db = fakeDb({ tables: { characters: [] } });
    const out = JSON.parse(await drain(exportChunks(db, ME)));
    expect(out.tables.character_inventory.row_count).toBe(0);
    expect(db.log.some(q => q.table === 'character_inventory')).toBe(false);
    expect(db.log.some(q => q.table === 'tells')).toBe(true);
  });
});

describe('the download is limited to one per 10 minutes per person', () => {
  // a bot_kv with the same primary key (guild_id, key) the real one has
  function fakeKv() {
    const rows = new Map();
    const id = (g, k) => `${g}|${k}`;
    return {
      rows,
      from(table) {
        expect(table).toBe('bot_kv');
        return {
          update(v) {
            const f = {};
            const api = {
              eq(c, val) { f[c] = val; return api; },
              lt(c, val) { f.lt = [c, val]; return api; },
              select() {
                const r = rows.get(id(f.guild_id, f.key));
                if (r && r.updated_at < f.lt[1]) { Object.assign(r, v); return Promise.resolve({ data: [{ key: f.key }], error: null }); }
                return Promise.resolve({ data: [], error: null });
              },
            };
            return api;
          },
          insert(row) {
            if (rows.has(id(row.guild_id, row.key))) return Promise.resolve({ error: { code: '23505', message: 'dup' } });
            rows.set(id(row.guild_id, row.key), { ...row });
            return Promise.resolve({ error: null });
          },
          select() {
            const f = {};
            const api = { eq(c, v) { f[c] = v; return api; }, maybeSingle() { return Promise.resolve({ data: rows.get(id(f.guild_id, f.key)) ?? null, error: null }); } };
            return api;
          },
        };
      },
    };
  }

  const T0 = Date.parse('2026-11-01T12:00:00Z');
  it('lets the first through, blocks the next inside the window with a Retry-After, lets one through after it', async () => {
    const kv = fakeKv();
    expect(await claimExport(kv, ME.userId, T0)).toEqual({ ok: true });
    const blocked = await claimExport(kv, ME.userId, T0 + 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(EXPORT_COOLDOWN_MIN * 60 - 60);
    expect(await claimExport(kv, ME.userId, T0 + EXPORT_COOLDOWN_MIN * 60_000 + 1000)).toEqual({ ok: true });
  });
  it('is per person: someone else\'s download does not use up yours', async () => {
    const kv = fakeKv();
    await claimExport(kv, OTHER_USER, T0);
    expect(await claimExport(kv, ME.userId, T0 + 1000)).toEqual({ ok: true });
  });
  it('keys the marker on the login id, in the table the delete cleans up', () => {
    expect(exportKey(ME.userId)).toBe(`data_export:${ME.userId}`);
    expect(sql()).toContain("'data_export:' || p_user_id::text");
  });
  it('the route claims the slot BEFORE it reads anything, and answers 429 with Retry-After', () => {
    const src = js('web/lib/selfDataRoute.ts');
    expect(src.indexOf('claimExport(')).toBeGreaterThan(0);
    expect(src.indexOf('claimExport(')).toBeLessThan(src.indexOf('exportChunks('));
    expect(src).toMatch(/429/);
    expect(src).toContain("'Retry-After'");
  });
});

describe('the download route reads nothing from the request', () => {
  it('both doors call handleExport() and take the request only as a required, unused argument', () => {
    for (const rel of ['web/app/me/data/export/route.ts', 'web/app/guilds/data/export/route.ts']) {
      const src = js(rel);
      expect(src, rel).toMatch(/export async function GET\(_request: Request\)/);
      expect(src, rel).toContain('return handleExport();');
      expect(src, rel).not.toMatch(/searchParams|\.url\b|headers\(|nextUrl|formData|\.json\(\)/);
      expect(src, rel).toContain("export const dynamic = 'force-dynamic'");
    }
  });
  it('the handler takes no argument and identifies the person from the session cookie only', () => {
    const src = js('web/lib/selfDataRoute.ts');
    expect(src).toMatch(/export async function handleExport\(\): Promise<Response>/);
    expect(src).not.toMatch(/searchParams|request\.|\.url\b|headers\(|nextUrl|formData/);
    expect(src).toContain('supabaseServer().auth.getUser()');
    expect(src).toContain('resolveSelf(db, user)');
    expect(src).toContain('exportChunks(db, me.ids');
  });
  it('is a downloaded file named for the day, uncached, and 401 when signed out', () => {
    const src = js('web/lib/selfDataRoute.ts');
    expect(src).toContain('Content-Disposition');
    expect(src).toMatch(/attachment; filename="raidmimic-data-\$\{[^}]*slice\(0, 10\)\}\.json"/);
    expect(src).toContain("'Cache-Control': 'no-store'");
    expect(src).toMatch(/if \(!user\) return json\(401/);
  });
  it('raidmimic.com can reach the /guilds door and not the /me door', () => {
    expect(isRaidmimicOpenPath('/guilds/data/export')).toBe(true);
    expect(isRaidmimicOpenPath('/me/data/export')).toBe(false);
    expect(isRaidmimicOpenPath('/me')).toBe(false);
  });
});

describe('deleting the account: the order of the steps, and what a failure leaves', () => {
  function deleteDb({ rpc = {}, screenshots = ['2026-10/web/abc.png'], removeError = null } = {}) {
    const order = [];
    const audit = [];
    const calls = [];
    const db = {
      from(table) {
        if (table === 'feedback') {
          const api = {
            select() { return api; },
            eq(c, v) { calls.push(['feedback.eq', c, v]); return api; },
            then(res, rej) { return Promise.resolve({ data: [{ screenshot_paths: screenshots }, { screenshot_paths: null }], error: null }).then(res, rej); },
          };
          return api;
        }
        if (table === 'audit_log') return { insert(row) { order.push('audit'); audit.push(row); return Promise.resolve({ error: null }); } };
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from(b) { return { remove(paths) { order.push(`storage:${b}`); calls.push(['remove', paths]); return Promise.resolve({ error: removeError }); } }; } },
      rpc(fn, args) {
        order.push(fn === 'member_self_unlink_batch' ? `unlink:${args.p_target}` : fn);
        calls.push([fn, args]);
        const h = rpc[fn] ?? (() => ({ data: fn === 'member_self_delete' ? { tells: 3 } : 0, error: null }));
        return Promise.resolve(typeof h === 'function' ? h(args) : h);
      },
      auth: { admin: { deleteUser(id) { order.push('deleteUser'); calls.push(['deleteUser', id]); return Promise.resolve({ error: null }); } } },
    };
    return { db, order, audit, calls };
  }

  it('removes screenshots, deletes in one call, unlinks every raid-record column, ends sessions, deletes the login LAST', async () => {
    const { db, order, calls } = deleteDb();
    const r = await runSelfDelete(db, ME);
    expect(r.ok).toBe(true);
    expect(order[0]).toBe('storage:feedback-screenshots');
    expect(order[1]).toBe('member_self_delete');
    expect(order.filter(o => o.startsWith('unlink:')).map(o => o.slice(7))).toEqual(UNLINK_TARGETS);
    expect(order.slice(-3)).toEqual(['audit', 'end_member_web_sessions', 'deleteUser']);
    expect(order.filter(o => o === 'deleteUser')).toHaveLength(1);       // once, and only at the very end
    expect(order.filter(o => o === 'member_self_delete')).toHaveLength(1);
    expect(calls.find(c => c[0] === 'member_self_delete')[1]).toEqual({ p_discord_id: ME.discordId, p_user_id: ME.userId });
    expect(calls.find(c => c[0] === 'end_member_web_sessions')[1]).toEqual({ p_user_id: ME.userId });
    expect(calls.find(c => c[0] === 'deleteUser')[1]).toBe(ME.userId);
  });

  it('looks up screenshots by the session\'s Discord id only, and removes only those paths', async () => {
    const { db, calls } = deleteDb();
    await runSelfDelete(db, ME);
    expect(calls.filter(c => c[0] === 'feedback.eq').map(c => c.slice(1))).toEqual([['guild_id', 'wolfpack'], ['submitter_discord_id', ME.discordId]]);
    expect(calls.find(c => c[0] === 'remove')[1]).toEqual(['2026-10/web/abc.png']);
  });

  it('writes an audit row of table names and counts: no Discord id, no login id, no name', async () => {
    const { db, audit } = deleteDb({ rpc: { member_self_unlink_batch: () => ({ data: 5, error: null }) } });
    await runSelfDelete(db, ME);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('account_deleted_records');
    expect(audit[0].actor_discord_id).toBeNull();
    expect(audit[0].actor_name).toBeNull();
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain(ME.discordId);
    expect(text).not.toContain(ME.userId);
    expect(Object.values(audit[0].payload.unlinked).every(Number.isInteger)).toBe(true);
  });

  it('unlinks in slices until a short slice comes back', async () => {
    let n = 0;
    const { db, calls } = deleteDb({ rpc: { member_self_unlink_batch: ({ p_target }) => ({ data: p_target === 'contributions.contributor_discord_id' ? (n++ === 0 ? UNLINK_BATCH : 7) : 0, error: null }) } });
    const r = await runSelfDelete(db, ME);
    expect(calls.filter(c => c[0] === 'member_self_unlink_batch' && c[1].p_target === 'contributions.contributor_discord_id')).toHaveLength(2);
    expect(r.unlinked['contributions.contributor_discord_id']).toBe(UNLINK_BATCH + 7);
  });

  it('a table that will not unlink is reported and audited, and the delete still finishes (the data is already gone)', async () => {
    const { db, audit, order } = deleteDb({ rpc: { member_self_unlink_batch: ({ p_target }) => p_target === 'chat_messages.uploaded_by' ? { data: null, error: { message: 'timeout' } } : { data: 0, error: null } } });
    const r = await runSelfDelete(db, ME);
    expect(r.ok).toBe(true);
    expect(r.unlinkFailed).toEqual(['chat_messages.uploaded_by']);
    expect(audit[0].payload.unlink_failed).toEqual(['chat_messages.uploaded_by']);
    expect(order.at(-1)).toBe('deleteUser');
  });

  it('an owner of a guild is refused BEFORE anything else happens after the transaction call', async () => {
    const { db, order } = deleteDb({ rpc: { member_self_delete: { data: null, error: { message: 'member_self_delete: owns_guild' } } } });
    const r = await runSelfDelete(db, ME);
    expect(r).toEqual({ ok: false, error: 'owns_guild' });
    expect(order).toEqual(['storage:feedback-screenshots', 'member_self_delete']);   // no unlink, no sessions, no deleteUser
  });

  it('a screenshot that will not delete stops everything: no row has been touched yet', async () => {
    const { db, order } = deleteDb({ removeError: { message: 'nope' } });
    expect(await runSelfDelete(db, ME)).toEqual({ ok: false, error: 'screenshots' });
    expect(order).toEqual(['storage:feedback-screenshots']);
  });

  it('if the login cannot be deleted the person is told so and can press the button again', async () => {
    const { db } = deleteDb();
    db.auth.admin.deleteUser = () => Promise.resolve({ error: { message: 'no' } });
    expect(await runSelfDelete(db, ME)).toEqual({ ok: false, error: 'account' });
  });
});

describe('the delete action', () => {
  const src = js('web/app/me/data/actions.ts');
  it('takes only the typed word, and checks it, then the session, then the identity, then deletes', () => {
    expect(src).toMatch(/export async function deleteMyAccount\(typed: string\)/);
    expect(src).not.toMatch(/formData|searchParams|headers\(|cookies\(/);
    const i = (s) => src.indexOf(s);
    expect(i('isDeleteConfirmed(typed)')).toBeGreaterThan(0);
    expect(i('isDeleteConfirmed(typed)')).toBeLessThan(i('auth.getUser()'));
    expect(i('auth.getUser()')).toBeLessThan(i('resolveSelf(db, user)'));
    expect(i('resolveSelf(db, user)')).toBeLessThan(i('runSelfDelete(db, me.ids)'));
  });
  it('is a server action file', () => {
    expect(read('web/app/me/data/actions.ts').startsWith("'use server';")).toBe(true);
  });
  it('the box asks for the same word the server checks, and the button waits for it', () => {
    const ui = js('web/app/me/data/DeleteAccount.tsx');
    expect(ui).toContain(`const WORD = '${DELETE_WORD}'`);
    expect(ui).toMatch(/disabled=\{pending \|\| typed\.trim\(\) !== WORD\}/);
    expect(ui).toContain('deleteMyAccount(typed)');
  });
  it('says plainly what goes and what stays, including officers\' audit entries and the guild records', () => {
    const ui = read('web/app/me/data/DeleteAccount.tsx');
    expect(ui).toMatch(/cannot be undone/i);
    expect(ui).toMatch(/Removed/);
    expect(ui).toMatch(/Stays/);
    expect(ui).toMatch(/raid records/);
    expect(ui).toMatch(/audit log/);
    expect(ui).toMatch(/officer\s+can remove them if you ask/);
  });
});

describe('the migration: one transaction for the person\'s own data, slices for the guild\'s records', () => {
  const s = sql();
  const DEL = s.slice(s.indexOf('create or replace function public.member_self_delete'), s.indexOf('create or replace function public.member_self_unlink_batch'));
  const UNL = s.slice(s.indexOf('create or replace function public.member_self_unlink_batch'));
  const tuples = (block) => [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)].map(m => [m[1], m[2]]);
  // tables the function handles with a hand-written statement rather than a VALUES row
  const SPECIAL = {
    characters: /update public\.characters\s+set discord_id = null/,
    wolfpack_members: /update public\.wolfpack_members set user_id = null/,
    hub_players: /update public\.hub_players\s+set discord_id = 'deleted:'/,
    hub_memberships: /update public\.hub_memberships set left_at/,
    hub_player_activity: /delete from public\.hub_player_activity where player_id = v_player/,
  };

  it('both functions are security definer, revoked from everyone, granted to service_role only', () => {
    for (const fn of ['member_self_delete(text, uuid)', 'member_self_unlink_batch(text, text, int)']) {
      const esc = fn.replace(/[()]/g, '\\$&');
      expect(s).toMatch(new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated;`));
      expect(s).toMatch(new RegExp(`grant execute on function public\\.${esc} to service_role;`));
    }
    expect((s.match(/security definer/g) || []).length).toBe(2);
    expect(s).not.toMatch(/grant[^;]*\bto (anon|authenticated|public)\b/);
  });

  it('handles EVERY personal table the export lists (a delete row, or its own statement)', () => {
    const handled = new Set(tuples(DEL).map(t => t[0]));
    for (const t of PERSONAL_TABLES) {
      if (SPECIAL[t]) expect(DEL, t).toMatch(SPECIAL[t]);
      else expect(handled.has(t), `${t} is deleted by member_self_delete`).toBe(true);
    }
  });

  it('deletes by the columns the export reads them by (the delete may add one: live state rows the person\'s agent uploaded under their id)', () => {
    const rows = tuples(DEL);
    const EXTRA = { character_live_state: ['uploaded_by'] };
    for (const spec of SELF_TABLES.filter(t => t.group !== 'guild' && !SPECIAL[t.table])) {
      const cols = [...spec.clauses.map(c => c.col), ...(EXTRA[spec.table] ?? [])];
      const mine = rows.filter(r => r[0] === spec.table).map(r => r[1]);
      expect(mine.length, spec.table).toBeGreaterThan(0);
      for (const c of mine) expect(cols, `${spec.table}.${c}`).toContain(c);
    }
  });

  it('NEVER deletes from a guild raid-record table (they keep their rows)', () => {
    const handled = new Set(tuples(DEL).map(t => t[0]));
    for (const t of GUILD_RECORD_TABLES) {
      expect(handled.has(t), `${t} must not be a delete row`).toBe(false);
      expect(DEL, t).not.toMatch(new RegExp(`(delete from|update|truncate)\\s+public\\.${t}\\b`));
    }
    // and the tables that are not ours to remove at all
    for (const t of ['audit_log', 'encounters', 'contributions', 'encounter_events', 'loot_drops', 'wolfpack_members', 'guild_triggers', 'member_lockouts']) {
      expect(DEL, t).not.toMatch(new RegExp(`delete from public\\.${t}\\b`));
    }
    expect(DEL).not.toMatch(/\btruncate\b|\bdrop\b/i);
  });

  it('deletes the per-character uploads BEFORE it unlinks the characters, and matches them within the same guild', () => {
    expect(DEL.indexOf("('character_inventory'")).toBeGreaterThan(0);
    expect(DEL.indexOf("('character_inventory'")).toBeLessThan(DEL.indexOf('update public.characters'));
    expect(DEL).toMatch(/c\.discord_id = \$1 and c\.guild_id = t\.guild_id and lower\(c\.name\) = lower\(t\.%I\)/);
  });

  it('clears wolfpack_members.user_id (and keeps the row) so the login deletion cannot cascade it away', () => {
    expect(DEL).toMatch(/update public\.wolfpack_members set user_id = null/);
    expect(DEL).not.toMatch(/delete from public\.wolfpack_members/);
  });

  it('writes the account_deleted audit row from counts only: it never reads the Discord id or the login id', () => {
    const m = /insert into public\.audit_log[\s\S]*?;/.exec(DEL);
    expect(m, 'audit insert').toBeTruthy();
    expect(m[0]).toContain("'account_deleted'");
    expect(m[0]).toMatch(/values \('account_deleted', null, null, jsonb_build_object\('self_service', true, 'removed', v_counts\), v_guild\)/);
    expect(m[0]).not.toMatch(/p_discord_id|p_user_id/);
  });

  it('refuses a mismatched identity and a sole guild owner, and validates its inputs', () => {
    expect(DEL).toContain('identity_mismatch');
    expect(DEL).toContain('owns_guild');
    expect(DEL).toMatch(/p_discord_id !~ '\^\[0-9\]\{5,25\}\$'/);
  });

  it('the unlink function unlinks exactly UNLINK_TARGETS, by an allow-list, with a bounded batch', () => {
    expect(tuples(UNL).map(t => `${t[0]}.${t[1]}`)).toEqual(UNLINK_TARGETS);
    expect(UNL).toMatch(/set %I = null where ctid in \(select ctid from public\.%I where %I = \$1 limit \$2\)/);
    expect(UNL).toMatch(/unknown target/);
    expect(UNL).toMatch(/least\(coalesce\(p_limit, 20000\), 50000\)/);
    // it only ever NULLs the id: no delete
    expect(UNL).not.toMatch(/\bdelete\b/i);
    expect(UNLINK_BATCH).toBe(20000);
  });

  it('every unlink target is a column that holds the id in a guild record the delete must keep', () => {
    for (const t of UNLINK_TARGETS) {
      const [table] = t.split('.');
      expect(PERSONAL_TABLES, `${table} is not a table the delete removes`).not.toContain(table);
    }
  });
});

describe('where the section lives', () => {
  it('is on /me (classic and hub), anchored #your-data, and on /guilds only for raidmimic hosts with a link on the rest', () => {
    expect(js('web/app/me/page.tsx')).toContain('<YourData exportHref="/me/data/export" />');
    expect(js('web/app/me/MeHub.tsx')).toContain('<YourData exportHref="/me/data/export" />');
    expect(js('web/app/me/data/YourData.tsx')).toContain('id="your-data"');
    const g = js('web/app/guilds/page.tsx');
    expect(g).toContain('{onHost && <div className="mt-6"><YourData exportHref="/guilds/data/export" /></div>}');
    expect(g).toContain("href={onHost ? '#your-data' : '/me#your-data'}");
    expect(g).toContain('Your data →');
  });
});
