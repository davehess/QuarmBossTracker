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
  isDeleteConfirmed, resolveSelf, claimExport, runSelfDelete, filterParts, exportKey,
  EXPORT_SECTIONS, findSection, exportHeader, exportSection, sectionBody,
  prepareIsOpen, PREPARE_WINDOW_MIN,
} from '../web/lib/selfData.ts';
import { assembleExport, prepareExport, formatBytes, exportFilename, PART_CONCURRENCY } from '../web/lib/selfDataPrepare.ts';
import { isRaidmimicOpenPath } from '../web/lib/raidmimicHost.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const js = (rel) => stripJs(read(rel));
const SQL_REL = 'supabase/migrations/20261101140000_member_self_delete.sql';
const sql = () => stripSql(read(SQL_REL));
// 2026-11-02: member_self_delete was redefined to also remove the synced flags and characters; THAT is the live one.
const SQL_HUB_REL = 'supabase/migrations/20261102220000_self_delete_hub_sync.sql';
const sqlHub = () => stripSql(read(SQL_HUB_REL));

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

// What the browser ends up with: every section from the part route's reader, stitched by the same assembler the page uses.
async function buildExport(db, now = new Date('2026-11-01T12:00:00Z')) {
  const parts = {};
  for (const spec of SELF_TABLES) parts[spec.table] = await exportSection(db, spec, ME);
  const manifest = { ...exportHeader(now), sections: SELF_TABLES.map(t => ({ name: t.table, group: t.group })) };
  return assembleExport(manifest, parts).join('');
}

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
    const text = await buildExport(db);
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
    const allowedNames = new Set(CHARS.flatMap(c => [c.name, c.name.toLowerCase()]));
    const bootstrap = new Set(['characters', 'hub_players']);
    let checked = 0;
    for (const q of db.log) {
      if (bootstrap.has(q.table) && q.or == null) {
        // the two lookups the export starts with: each is an .eq on the session's own Discord id
        expect(q.eq.every(([, v]) => v === ME.discordId)).toBe(true);
        continue;
      }
      expect(q.or, `${q.table} has an .or() filter`).toBeTruthy();
      for (const part of q.or.split(/,(?![^()]*\))/)) {         // commas inside in.(…) belong to the list
        const m = /^([a-z_]+)\.(eq|in)\.(.+)$/.exec(part);
        expect(m, `${q.table}: ${part}`).toBeTruthy();
        for (const val of m[3].replace(/^\(|\)$/g, '').split(',')) {
          expect(allowedValues.has(val) || allowedNames.has(val), `${q.table}: ${part}`).toBe(true);
        }
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
    expect(inv.find(q => q.eq.some(([, v]) => v === 'wolfpack')).or).toBe('character_name.in.(Aldenmar,aldenmar,Brackwyn,brackwyn)');
    expect(inv.find(q => q.eq.some(([, v]) => v === 'hubguild')).or).toBe('character_name.in.(Corvale,corvale)');
    // a table keyed on the Discord id needs no guild filter
    expect(db.log.filter(q => q.table === 'tells').every(q => q.eq.length === 0)).toBe(true);
  });

  it('cleans a character name to letters before it goes into a filter', () => {
    const spec = SELF_TABLES.find(t => t.table === 'character_inventory');
    // filterParts is handed already-cleaned names by loadOwnCharacters; the clean-up itself is exercised end to end:
    expect(filterParts(spec, ME, [], ['Aldenmar'])).toEqual(['character_name.in.(Aldenmar,aldenmar)']);
    // stored any case, read as written, Capitalised and lower case (the forms the tables hold); one exact `in`, no ilike
    expect(filterParts(spec, ME, [], ['zARRIN'])).toEqual(['character_name.in.(zARRIN,zarrin,Zarrin)']);
    expect(filterParts(spec, ME, [], [])).toEqual([]);
    expect(js('web/lib/selfData.ts')).not.toMatch(/\.ilike\./);
  });

  it('strips punctuation out of a stored name (a filter value can never carry a comma or a parenthesis)', async () => {
    const db = fakeDb({ tables: { characters: [{ guild_id: 'wolfpack', name: 'Zar,rin).or(x' }] } });
    await buildExport(db);
    const inv = db.log.find(q => q.table === 'character_inventory');
    expect(inv.or).toBe('character_name.in.(Zarrinorx,zarrinorx)');
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
    const out = JSON.parse(await buildExport(db));
    expect(out.tables.tells.error).toMatch(/could not be read/);
    expect(out.tables.page_views.row_count).toBe(0);     // the rest of the file is intact
  });

  it('a person with no characters still gets their own data, and the name-keyed tables are simply empty', async () => {
    const db = fakeDb({ tables: { characters: [] } });
    const out = JSON.parse(await buildExport(db));
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
  it('sections are served only within the window after the person\'s own Prepare (no Prepare, too late, or someone else\'s = closed)', async () => {
    const kv = fakeKv();
    expect(await prepareIsOpen(kv, ME.userId, T0)).toBe(false);
    await claimExport(kv, OTHER_USER, T0);
    expect(await prepareIsOpen(kv, ME.userId, T0 + 1000)).toBe(false);
    await claimExport(kv, ME.userId, T0);
    expect(await prepareIsOpen(kv, ME.userId, T0 + 60_000)).toBe(true);
    expect(await prepareIsOpen(kv, ME.userId, T0 + PREPARE_WINDOW_MIN * 60_000 + 1000)).toBe(false);
    const route = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/selfDataRoute.ts'), 'utf8'));
    const part = route.slice(route.indexOf('export async function handlePart'));
    expect(part.indexOf('prepareIsOpen(')).toBeGreaterThan(-1);
    expect(part.indexOf('prepareIsOpen(')).toBeLessThan(part.indexOf('exportSection('));
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
  it('the MANIFEST claims the slot (before it lists anything) and answers 429 with Retry-After; the PARTS never claim', () => {
    const src = js('web/lib/selfDataRoute.ts');
    const manifest = src.slice(src.indexOf('export async function handleManifest'), src.indexOf('export async function handlePart'));
    const part = src.slice(src.indexOf('export async function handlePart'));
    expect(manifest).toContain('claimExport(');
    expect(manifest.indexOf('claimExport(')).toBeLessThan(manifest.indexOf('exportHeader('));
    expect(manifest).toMatch(/429/);
    expect(manifest).toContain("'Retry-After'");
    expect(part.length).toBeGreaterThan(50);
    expect(part).not.toMatch(/claimExport|429|Retry-After/);
    expect(src.match(/claimExport\(/g)).toHaveLength(1);
  });
});

describe('the part route: an allow-listed section name picks a table and nothing else', () => {
  it('the allow-list is exactly the export\'s table list, in file order', () => {
    expect(EXPORT_SECTIONS).toEqual(SELF_TABLES.map(t => t.table));
    for (const t of SELF_TABLES) expect(findSection(t.table)).toBe(t);
  });

  it('an unknown, injected or non-string name finds nothing', () => {
    const bad = [
      'nope', '', ' tells', 'tells ', 'TELLS', 'tells,characters', 'tells;drop table tells', 'tells.or(x)', 'tells)', '*',
      '__proto__', 'constructor', 'toString', 'length', '../tells', `tells\u0000`,
      null, undefined, 7, ['tells'], { table: 'tells' },
    ];
    for (const b of bad) expect(findSection(b), JSON.stringify(b)).toBeNull();
  });

  it('the handler answers 400 when findSection finds nothing, before it reads a row', () => {
    const src = js('web/lib/selfDataRoute.ts');
    const part = src.slice(src.indexOf('export async function handlePart'));
    expect(part).toContain("findSection(new URL(request.url).searchParams.get('s'))");
    expect(part).toMatch(/if \(!spec\) return json\(400/);
    expect(part.indexOf('if (!spec)')).toBeLessThan(part.indexOf('exportSection('));
    // `s` is used for the lookup and for nothing else: the one searchParams read, and no other request input
    expect(part.match(/searchParams/g)).toHaveLength(1);
    expect(part).not.toMatch(/headers\(|nextUrl|formData|\.json\(\)|request\.headers/);
  });

  it('a section\'s read is keyed on the session\'s ids only; the section name never reaches a filter', async () => {
    const db = fakeDb({ tables: { characters: CHARS } });
    const spec = findSection('character_inventory');
    await exportSection(db, spec, ME);
    const inv = db.log.filter(q => q.table === 'character_inventory');
    expect(inv.length).toBe(2);                                          // once per guild, as before
    for (const q of inv) expect(q.or).toMatch(/^character_name\.in\.\((?:(?:Aldenmar|aldenmar|Brackwyn|brackwyn|Corvale|corvale),?)+\)$/);
  });

  it('reads only the lookups a section needs: a personal table asks for no characters, a hub table asks for the player id', async () => {
    const db = fakeDb({ tables: { characters: CHARS, hub_players: [{ player_id: '33333333-3333-4333-8333-333333333333' }] } });
    await exportSection(db, findSection('tells'), ME);
    expect(db.log.map(q => q.table)).toEqual(['tells']);
    const db2 = fakeDb({ tables: { hub_players: [{ player_id: '33333333-3333-4333-8333-333333333333' }] } });
    await exportSection(db2, findSection('hub_memberships'), ME);
    expect(db2.log.map(q => q.table)).toEqual(['hub_players', 'hub_memberships']);
    expect(db2.log[1].or).toBe('player_id.in.(33333333-3333-4333-8333-333333333333)');
  });

  it('a section whose character lookup fails says so, instead of coming back as an empty table', async () => {
    const db = fakeDb({ tables: {}, fail: new Set(['characters']) });
    const out = await exportSection(db, findSection('character_inventory'), ME);
    expect(out.error).toMatch(/could not be read/);
  });

  it('a section over the size a single response can carry is cut to its newest rows and says so', () => {
    const rows = Array.from({ length: 4000 }, (_, i) => ({ id: i, text: 'x'.repeat(200) }));
    const out = { group: 'personal', row_count: rows.length, capped: false, cap: EXPORT_ROW_CAP, rows };
    const body = sectionBody(out, 100_000);
    const parsed = JSON.parse(body);
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(100_000);
    expect(parsed.capped).toBe(true);
    expect(parsed.note).toMatch(/too large/);
    expect(parsed.rows[0].id).toBe(0);                                   // newest first, so the front is kept
    expect(parsed.row_count).toBe(parsed.rows.length);
    // a section that fits is untouched
    expect(JSON.parse(sectionBody({ ...out, rows: rows.slice(0, 3), row_count: 3 }, 100_000)).capped).toBe(false);
  });
});

describe('the manifest and part routes read nothing about the person from the request', () => {
  const DOORS = ['me', 'guilds'];
  it('both doors, both routes: a REQUIRED Request argument, dynamic, handler delegated', () => {
    for (const door of DOORS) {
      const m = js(`web/app/${door}/data/export/manifest/route.ts`);
      expect(m, door).toMatch(/export async function GET\(_request: Request\)/);
      expect(m, door).toContain('return handleManifest();');
      expect(m, door).not.toMatch(/searchParams|\.url\b|headers\(|nextUrl|formData|\.json\(\)/);
      expect(m, door).toContain("export const dynamic = 'force-dynamic'");
      const p = js(`web/app/${door}/data/export/part/route.ts`);
      expect(p, door).toMatch(/export async function GET\(request: Request\)/);
      expect(p, door).toContain('return handlePart(request);');
      expect(p, door).toContain("export const dynamic = 'force-dynamic'");
    }
  });
  it('the old single-stream route is gone, and nothing still calls the stream', () => {
    for (const door of DOORS) expect(fs.existsSync(path.join(ROOT, `web/app/${door}/data/export/route.ts`)), door).toBe(false);
    const all = ['web/lib/selfDataRoute.ts', 'web/lib/selfData.ts', 'web/app/me/data/PrepareData.tsx'].map(js).join('\n');
    expect(all).not.toMatch(/exportChunks|handleExport|ReadableStream/);
  });
  it('the manifest takes no argument; identity is the session cookie, resolved the same way for both routes', () => {
    const src = js('web/lib/selfDataRoute.ts');
    expect(src).toMatch(/export async function handleManifest\(\): Promise<Response>/);
    expect(src).toMatch(/export async function handlePart\(request: Request\): Promise<Response>/);
    expect(src.match(/supabaseServer\(\)\.auth\.getUser\(\)/g)).toHaveLength(1);
    expect(src).toContain('resolveSelf(db, user)');
    expect(src.match(/await whoIsAsking\(\)/g)).toHaveLength(2);         // one door for identity, used by both routes
    // the only request input anywhere in the handler file is the part route's `s`
    expect(src.match(/request\./g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/headers\(|nextUrl|formData|request\.headers|request\.json/);
    expect(src).toMatch(/if \(!user\) return json\(401/);
  });
  it('every response goes through the one builder that sets Content-Length from the encoded bytes', () => {
    const src = js('web/lib/selfDataRoute.ts');
    expect(src.match(/new Response\(/g)).toHaveLength(1);
    expect(src).toMatch(/const body = new TextEncoder\(\)\.encode\(text\)/);
    expect(src).toMatch(/'Content-Length': String\(body\.length\)/);
    expect(src).toContain("'Cache-Control': 'no-store'");
    // json() and the part's 200 both build through it
    expect(src).toMatch(/return bytes\(200, sectionBody\(/);
    expect(src).toMatch(/function json\([^)]*\): Response \{\s*return bytes\(/);
  });
  it('the manifest reads no table: it only claims the slot and lists names', () => {
    const src = js('web/lib/selfDataRoute.ts');
    const manifest = src.slice(src.indexOf('export async function handleManifest'), src.indexOf('export async function handlePart'));
    expect(manifest).not.toMatch(/exportSection|readTable|selectAll/);
  });
  it('raidmimic.com can reach the /guilds doors and not the /me doors', () => {
    for (const leaf of ['manifest', 'part']) {
      expect(isRaidmimicOpenPath(`/guilds/data/export/${leaf}`)).toBe(true);
      expect(isRaidmimicOpenPath(`/me/data/export/${leaf}`)).toBe(false);
    }
    expect(isRaidmimicOpenPath('/me')).toBe(false);
  });
});

describe('the manifest is the file\'s header and its section list', () => {
  it('lists every section in order, with the caps and what the file leaves out', () => {
    const h = exportHeader(new Date('2026-11-01T12:00:00Z'));
    expect(h.exported_at).toBe('2026-11-01T12:00:00.000Z');
    expect(h.row_cap).toBe(EXPORT_ROW_CAP);
    expect(h.character_row_cap).toBe(EXPORT_CHARACTER_CAP);
    expect(h.not_included.length).toBeGreaterThan(0);
    const src = js('web/lib/selfDataRoute.ts');
    expect(src).toContain('sections: SELF_TABLES.map(t => ({ name: t.table, group: t.group }))');
  });
});

describe('the browser assembles the same file the streamed download made', () => {
  const NOW = new Date('2026-11-01T12:00:00Z');
  const MANIFEST = () => ({ ...exportHeader(NOW), sections: SELF_TABLES.map(t => ({ name: t.table, group: t.group })) });

  it('top-level keys, order and per-table shape are the old shape', async () => {
    const db = fakeDb({ tables: { characters: CHARS, tells: [{ id: 1 }] } });
    const out = JSON.parse(await buildExport(db, NOW));
    expect(Object.keys(out)).toEqual(['exported_at', 'about', 'row_cap', 'character_row_cap', 'tables', 'not_included']);
    expect(Object.keys(out.tables)).toEqual(EXPORT_SECTIONS);
    expect(out.tables.tells).toEqual({ group: 'personal', row_count: 1, capped: false, cap: EXPORT_ROW_CAP, rows: [{ id: 1 }] });
    expect(out.tables.character_inventory.group).toBe('character');
    expect(out.tables.pvp_kills.group).toBe('guild');
  });

  it('is valid JSON in any order the parts arrive, and a missing part becomes a named error, not a hole', () => {
    const parts = { tells: { group: 'personal', row_count: 0, capped: false, cap: 1, rows: [] } };
    const out = JSON.parse(assembleExport(MANIFEST(), parts).join(''));
    expect(Object.keys(out.tables)).toEqual(EXPORT_SECTIONS);
    expect(out.tables.characters.error).toBeTruthy();
    expect(out.tables.characters.group).toBe('personal');
    expect(out.tables.tells.rows).toEqual([]);
  });

  it('prepareExport fetches the manifest, then every part, and builds the same file as a direct build', async () => {
    const db = fakeDb({ tables: { characters: CHARS, tells: [{ id: 1 }, { id: 2 }] } });
    const asked = [];
    const server = async (url) => {
      asked.push(url);
      if (url === 'M') return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(MANIFEST())) };
      const name = new URL(url, 'https://x.test').searchParams.get('s');
      const out = await exportSection(db, findSection(name), ME);
      return { ok: true, status: 200, json: async () => JSON.parse(sectionBody(out)) };
    };
    const progress = [];
    const done = await prepareExport(server, 'M', (s) => `/part?s=${encodeURIComponent(s)}`, (d, t) => progress.push([d, t]));
    expect(asked[0]).toBe('M');
    expect(asked).toHaveLength(1 + SELF_TABLES.length);
    expect(progress[0]).toEqual([0, SELF_TABLES.length]);
    expect(progress.at(-1)).toEqual([SELF_TABLES.length, SELF_TABLES.length]);
    expect(done.sections).toBe(SELF_TABLES.length);
    expect(done.failed).toEqual([]);
    expect(done.filename).toBe('raidmimic-data-2026-11-01.json');
    expect(done.pieces.join('')).toBe(await buildExport(db, NOW));
    expect(new Blob(done.pieces).size).toBe(new TextEncoder().encode(done.pieces.join('')).length);   // the size shown is the size saved
  });

  it('never has more than a few parts in flight at once', async () => {
    let live = 0, peak = 0;
    const server = async (url) => {
      if (url === 'M') return { ok: true, status: 200, json: async () => MANIFEST() };
      live++; peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 1));
      live--;
      return { ok: true, status: 200, json: async () => ({ group: 'personal', row_count: 0, capped: false, cap: 1, rows: [] }) };
    };
    await prepareExport(server, 'M', (s) => `P${s}`);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(PART_CONCURRENCY);
  });

  it('retries a failed part once, then names it in the file and in `failed` while the rest stays intact', async () => {
    const calls = {};
    const server = async (url) => {
      if (url === 'M') return { ok: true, status: 200, json: async () => MANIFEST() };
      calls[url] = (calls[url] ?? 0) + 1;
      if (url === 'Ptells' && calls[url] === 1) return { ok: false, status: 502, json: async () => ({}) };           // heals on the retry
      if (url === 'Pcrash_reports') return { ok: true, status: 200, json: async () => { throw new Error('cut short'); } };   // never heals
      if (url === 'Pxp_events') return { ok: true, status: 200, json: async () => ({ group: 'guild', error: 'This table could not be read just now.' }) };
      return { ok: true, status: 200, json: async () => ({ group: 'personal', row_count: 0, capped: false, cap: 1, rows: [] }) };
    };
    const done = await prepareExport(server, 'M', (s) => `P${s}`);
    expect(calls.Ptells).toBe(2);
    expect(calls.Pcrash_reports).toBe(2);                                  // exactly one retry, not a loop
    expect(calls.Pxp_events).toBe(1);                                      // a section that answered (with its own error) is not re-asked
    expect(done.failed).toEqual(['crash_reports', 'xp_events']);           // in file order
    const out = JSON.parse(done.pieces.join(''));
    expect(out.tables.tells.rows).toEqual([]);
    expect(out.tables.crash_reports.error).toMatch(/could not be fetched/);
    expect(out.tables.crash_reports.group).toBe('personal');
  });

  it('a refused manifest throws the server\'s sentence (the 10-minute wait, signed out) and fetches no part', async () => {
    const asked = [];
    const server = async (url) => { asked.push(url); return { ok: false, status: 429, json: async () => ({ error: 'You can prepare your data once every 10 minutes.' }) }; };
    await expect(prepareExport(server, 'M', (s) => `P${s}`)).rejects.toThrow('once every 10 minutes');
    expect(asked).toEqual(['M']);
    const dead = async () => ({ ok: false, status: 500, json: async () => { throw new Error('html'); } });
    await expect(prepareExport(dead, 'M', (s) => `P${s}`)).rejects.toThrow(/Try again/);
  });

  it('formats the size the way a phone shows it, and names the file for the day', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(850_400)).toBe('850 KB');
    expect(formatBytes(21_400_000)).toBe('21.4 MB');
    expect(exportFilename('2026-11-01T12:00:00.000Z')).toBe('raidmimic-data-2026-11-01.json');
  });
});

describe('the page: size on screen before Save, nothing saved until it is whole', () => {
  const ui = () => js('web/app/me/data/PrepareData.tsx');
  it('Prepare is the button; there is no direct download link left', () => {
    const src = ui();
    expect(src).toContain('Prepare my data');
    const yd = js('web/app/me/data/YourData.tsx');
    expect(yd).toContain('<PrepareData exportHref={exportHref} />');
    expect(yd).not.toMatch(/<a [^>]*download/);
    expect(yd).not.toContain('href={exportHref}');
  });
  it('shows progress as "N of M sections" while it works', () => {
    const src = ui();
    expect(src).toContain('Preparing… ${progress.done} of ${progress.total} sections');
    expect(src).toContain('role="progressbar"');
  });
  it('shows "Ready · size · sections" from the finished Blob, and Save file only inside that ready state', () => {
    const src = ui();
    const readyAt = src.indexOf('{ready && (');
    expect(readyAt).toBeGreaterThan(0);
    expect(src).toContain('Ready · {formatBytes(ready.bytes)} · {ready.sections} sections');
    expect(src).toContain('bytes: blob.size');
    expect(src.indexOf('Ready · {formatBytes(ready.bytes)}')).toBeLessThan(src.indexOf('Save file'));
    expect(src.indexOf('Save file')).toBeGreaterThan(readyAt);
    expect(src.match(/Save file/g)).toHaveLength(1);
    expect(src).toMatch(/<a href=\{ready\.url\} download=\{ready\.filename\}/);
    // the object URL is made after prepareExport resolved, never before
    expect(src.indexOf('await prepareExport(')).toBeLessThan(src.indexOf('URL.createObjectURL('));
    expect(src.match(/URL\.createObjectURL\(/g)).toHaveLength(1);
  });
  it('names a section that errored, and says the page must stay open', () => {
    const src = ui();
    expect(src).toContain('ready.failed.join(\', \')');
    expect(src).toContain('Keep this page open');
  });
  it('fetches the manifest and parts under the page\'s own export path, with the section in the query only', () => {
    const src = ui();
    expect(src).toContain('`${exportHref}/manifest`');
    expect(src).toContain('`${exportHref}/part?s=${encodeURIComponent(s)}`');
  });
  it('frees the object URL when it is replaced or the page closes', () => {
    const src = ui();
    expect(src).toContain('URL.revokeObjectURL');
    expect(src).toMatch(/useEffect\(\(\) => dropUrl, \[\]\)/);
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
  const DEL = sqlHub().slice(sqlHub().indexOf('create or replace function public.member_self_delete'));   // the live definition
  const UNL = s.slice(s.indexOf('create or replace function public.member_self_unlink_batch'));
  const tuples = (block) => [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)].map(m => [m[1], m[2]]);
  // tables the function handles with a hand-written statement rather than a VALUES row
  const SPECIAL = {
    characters: /update public\.characters\s+set discord_id = null/,
    wolfpack_members: /update public\.wolfpack_members set user_id = null/,
    hub_players: /update public\.hub_players\s+set discord_id = 'deleted:'/,
    hub_memberships: /update public\.hub_memberships set left_at/,
    hub_player_activity: /delete from public\.hub_player_activity where player_id = v_player/,
    hub_flags: /delete from public\.hub_flags where player_id = v_player/,
    hub_characters: /delete from public\.hub_characters where player_id = v_player/,
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

// ─── the synced flags and characters (DECISIONS §526): hub_players is anonymised, never deleted, so the ON DELETE
// CASCADE on hub_flags / hub_characters never fires; the function has to remove them itself.
describe('free flag syncing: Delete and Download cover hub_flags and hub_characters', () => {
  const NEW = sqlHub();
  const OLD = sql();
  const fnOf = (text) => text.slice(text.indexOf('create or replace function public.member_self_delete'), text.indexOf('create or replace function public.member_self_unlink_batch') > 0 ? text.indexOf('create or replace function public.member_self_unlink_batch') : undefined);
  const NEW_DEL = fnOf(NEW);
  const OLD_DEL = fnOf(OLD);
  const HUB_LINES = [
    /^ *delete from public\.hub_flags where player_id = v_player;\n/m,
    /^ *delete from public\.hub_characters where player_id = v_player;\n/m,
  ];

  it('the new migration deletes both hub tables for the player BEFORE the hub_players row is anonymised', () => {
    const iFlags = NEW_DEL.search(/delete from public\.hub_flags where player_id = v_player;/);
    const iChars = NEW_DEL.search(/delete from public\.hub_characters where player_id = v_player;/);
    const iAnon = NEW_DEL.search(/update public\.hub_players\s+set discord_id = 'deleted:'/);
    expect(iFlags).toBeGreaterThan(0);
    expect(iChars).toBeGreaterThan(0);
    expect(iAnon).toBeGreaterThan(iFlags);
    expect(iAnon).toBeGreaterThan(iChars);
    // both sit inside the `if v_player is not null` block that also leaves the guilds and clears the activity log
    expect(NEW_DEL.lastIndexOf('if v_player is not null then', iFlags)).toBeGreaterThan(NEW_DEL.indexOf('owns_guild'));
    expect(NEW_DEL.slice(NEW_DEL.lastIndexOf('if v_player is not null then', iFlags), iAnon)).toMatch(/delete from public\.hub_player_activity/);
    // the counts reach the audit row like every other table
    expect(NEW_DEL).toContain("jsonb_build_object('hub_flags', n)");
    expect(NEW_DEL).toContain("jsonb_build_object('hub_characters', n)");
  });

  it('nothing else changed: with the hub lines (and the two counts after them) removed, the body equals the previous definition', () => {
    let stripped = NEW_DEL;
    for (const re of HUB_LINES) {
      const m = re.exec(stripped);
      expect(m, String(re)).toBeTruthy();
      // the delete line, then its `get diagnostics` and `v_counts :=` lines
      const rest = stripped.slice(m.index + m[0].length);
      const tail = /^ *get diagnostics n = row_count;\n *v_counts := v_counts \|\| jsonb_build_object\('hub_(?:flags|characters)', n\);\n/.exec(rest);
      expect(tail, 'counts after ' + String(re)).toBeTruthy();
      stripped = stripped.slice(0, m.index) + rest.slice(tail[0].length);
    }
    const norm = (t) => t.replace(/\n{2,}/g, '\n').trim();
    expect(norm(stripped)).toBe(norm(OLD_DEL));
  });

  it('keeps the signature, security settings and grants', () => {
    expect(NEW).toContain('create or replace function public.member_self_delete(p_discord_id text, p_user_id uuid)');
    expect(NEW_DEL).toMatch(/security definer\s+set search_path = public, pg_temp/);
    expect(NEW).toMatch(/revoke all on function public\.member_self_delete\(text, uuid\) from public, anon, authenticated;/);
    expect(NEW).toMatch(/grant execute on function public\.member_self_delete\(text, uuid\) to service_role;/);
    expect(NEW).not.toMatch(/grant[^;]*\bto (anon|authenticated|public)\b/);
    expect(NEW).not.toMatch(/member_self_unlink_batch/);          // not redefined here
  });

  it('the export lists both as personal sections, matched by the person\'s hub player id, with explicit columns and a unique order', () => {
    for (const [table, order] of [['hub_flags', ['earned_at', 'id']], ['hub_characters', ['name_lc', 'player_id']]]) {
      const spec = SELF_TABLES.find(t => t.table === table);
      expect(spec, table).toBeTruthy();
      expect(spec.group).toBe('personal');
      expect(spec.clauses).toEqual([{ col: 'player_id', kind: 'player' }]);
      expect(spec.select).not.toContain('*');
      expect(spec.order.map(o => o[0] ?? o.col)).toEqual(order);
      expect(PERSONAL_TABLES).toContain(table);
      expect(GUILD_RECORD_TABLES).not.toContain(table);
      expect(findSection(table)).toBeTruthy();
    }
  });

  it('exporting hub_flags reads the player id first, then the table by player_id', async () => {
    const db = fakeDb({ tables: { hub_players: [{ player_id: '33333333-3333-4333-8333-333333333333' }] } });
    await exportSection(db, findSection('hub_flags'), ME);
    expect(db.log.map(q => q.table)).toEqual(['hub_players', 'hub_flags']);
    expect(db.log[1].or).toBe('player_id.in.(33333333-3333-4333-8333-333333333333)');
  });
});
