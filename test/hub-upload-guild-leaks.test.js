// Three places on the parse-upload path used the process guild (or no guild) for an upload that belongs to another hosted
// guild: the threat-snapshot claims, the charm_sessions stamp, and the bosses_local self-registration. A home-guild upload
// must send exactly the requests it always did.
//
// Run: npx vitest run test/hub-upload-guild-leaks.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const supabase = require('../utils/supabase.js');
globalThis.__namedBosses = require('../utils/namedBosses.js');
globalThis.__supabase = supabase;

const SERVICE_KEY = 'service-key-for-tests';
const src = readSource(BOT_INDEX);

// ── 1. threat-snapshot claims, through the real recordParse and a stubbed PostgREST ──────────────────────────────────
function fakeRest() {
  const calls = [];
  const fetchStub = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method || 'GET', path: u.pathname.replace('/rest/v1', ''), query: u.search, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const json = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data), headers: { get: () => null } });
    if (call.path === '/bosses_local') return json([{ npc_id: 5, zone_short: 'zone' }]);
    if (call.path === '/rpc/find_or_create_encounter') return json('enc-uuid-1');
    if (call.path === '/eqemu_npc_types') return json([{ name: 'A_Boss' }]);
    if (call.path === '/contributions') return json([{ id: 'contrib-1' }]);
    if (call.path === '/encounters' && call.method === 'GET') return json([{ npc_healed_total: 0 }]);
    return json([]);
  });
  return { calls, fetchStub };
}
const runRecordParse = (scoped) => supabase.recordParse({
  bossInternalId: 'a_boss',
  parsed: { duration: 90, totalDamage: 1000, players: [{ name: 'Aldenmar' }] },
  timestampMs: Date.parse('2026-10-26T16:00:00Z'),
  contributorDiscordId: null, contributorCharacter: 'Aldenmar', uploadedByDiscordId: 'd1', scoped,
});
const snapPatches = (calls) => calls.filter((c) => c.method === 'PATCH' && c.path === '/encounter_threat_snapshots');

describe('threat-snapshot claims carry the upload guild', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const HOME_BOSS = '?boss_name=ilike.A%20Boss&encounter_id=is.null'
    + '&snapshot_at=gte.2026-10-26T15%3A58%3A00.000Z&snapshot_at=lte.2026-10-26T16%3A03%3A30.000Z';
  const HOME_UPLOADER = '?uploader=eq.Aldenmar&encounter_id=is.null'
    + '&snapshot_at=gte.2026-10-26T15%3A59%3A40.000Z&snapshot_at=lte.2026-10-26T16%3A01%3A50.000Z';

  it('home guild, flag off (scoped null): both claims are byte-identical to before, no guild term', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse(null);
    expect(snapPatches(calls).map((c) => c.query)).toEqual([HOME_BOSS, HOME_UPLOADER]);
    expect(snapPatches(calls).every((c) => !c.query.includes('guild_id'))).toBe(true);
  });

  it('home guild through a scoped client (flag on): still no guild term', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse({ guildId: 'wolfpack', scoped: true, token: null });
    expect(snapPatches(calls).map((c) => c.query)).toEqual([HOME_BOSS, HOME_UPLOADER]);
  });

  it('a hub guild: both claims add guild_id=eq.<that guild>, everything else unchanged', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse({ guildId: 'acme', scoped: true, token: null });
    expect(snapPatches(calls).map((c) => c.query)).toEqual([HOME_BOSS + '&guild_id=eq.acme', HOME_UPLOADER + '&guild_id=eq.acme']);
  });

  it('the guild value is URL-encoded', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse({ guildId: 'a&b', scoped: true, token: null });
    expect(snapPatches(calls)[0].query.endsWith('&guild_id=eq.a%26b')).toBe(true);
  });

  it('the claim helpers called directly: omitted guildId = home request', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await supabase.claimThreatSnapshots({ encounterId: 'e', uploader: 'Aldenmar', startedAtMs: Date.parse('2026-10-26T16:00:00Z'), durationSec: 90 });
    await supabase.claimThreatSnapshots({ encounterId: 'e', uploader: 'Aldenmar', startedAtMs: Date.parse('2026-10-26T16:00:00Z'), durationSec: 90, guildId: 'wolfpack' });
    const q = snapPatches(calls).map((c) => c.query);
    expect(q[0]).toBe(HOME_UPLOADER);
    expect(q[1]).toBe(HOME_UPLOADER);
  });
});

// ── 2. the guild an upload belongs to (charm_sessions stamp + registration switch) ───────────────────────────────────
const helperBlock = sliceBlock(src, 'function _uploadGuildId(', "!== require('./utils/supabase').guildId();\n}");
const { _uploadGuildId, _uploadIsForeignGuild } = evalBlock(
  'const require = () => globalThis.__supabase;\n' + helperBlock, ['_uploadGuildId', '_uploadIsForeignGuild']);

describe('_uploadGuildId', () => {
  beforeEach(() => { process.env.SUPABASE_GUILD_ID = 'wolfpack'; });
  it('a home upload is the process guild, with or without a scoped client', () => {
    expect(_uploadGuildId(null, { guild_id: 'wolfpack', hub_guild: null })).toBe('wolfpack');
    expect(_uploadGuildId({ guildId: 'wolfpack' }, { guild_id: 'wolfpack' })).toBe('wolfpack');
    expect(_uploadGuildId(null, null)).toBe('wolfpack');
    expect(_uploadIsForeignGuild(null, { hub_guild: null })).toBe(false);
  });
  it('the process guild env override is honoured for a home upload', () => {
    process.env.SUPABASE_GUILD_ID = 'tower';
    expect(_uploadGuildId(null, { hub_guild: null })).toBe('tower');
    expect(_uploadIsForeignGuild(null, { hub_guild: null })).toBe(false);
  });
  it('a hub upload is its own guild', () => {
    expect(_uploadGuildId({ guildId: 'acme' }, { hub_guild: 'acme' })).toBe('acme');
    expect(_uploadGuildId(null, { hub_guild: 'acme' })).toBe('acme');
    expect(_uploadIsForeignGuild({ guildId: 'acme' }, { hub_guild: 'acme' })).toBe(true);
  });
});

describe('the charm_sessions rows are stamped with the upload guild', () => {
  const body = stripJs(sliceBlock(src, 'if (recParseResult?.encounterId && Array.isArray(encounter.charm_sessions)', "'charm_sessions', charmRows,"));
  it('takes the stamp from _uploadGuildId, not the process env', () => {
    expect(body).toMatch(/const guildId = _uploadGuildId\(guildDb, identity\);/);
    expect(body).not.toMatch(/process\.env\.SUPABASE_GUILD_ID/);
    expect(body).toMatch(/guild_id:\s+guildId,/);
  });
  it('the stamp a hub upload gets is the hub guild; a home upload gets exactly the old value', () => {
    const stamp = (guildDb, identity) => _uploadGuildId(guildDb, identity);
    expect(stamp({ guildId: 'acme' }, { hub_guild: 'acme' })).not.toBe('wolfpack');
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
    expect(stamp(null, { hub_guild: null })).toBe(process.env.SUPABASE_GUILD_ID || 'wolfpack');
  });
});

// ── 3. bosses_local self-registration ────────────────────────────────────────────────────────────────────────────────
const resolverBlock = sliceBlock(src, 'function _bossPersistKeys(',
  "console.warn('[lockout] promote failed for \"' + bossName + '\":', e?.message);\n  }\n}");
const { _resolveBossForPersist } = evalBlock(
  'const console = { log(){}, warn(){} };\nconst namedBosses = globalThis.__namedBosses;\n' + resolverBlock, ['_resolveBossForPersist']);

function fakeCatalog() {
  const inserts = [];
  const reads = [];
  return {
    inserts, reads,
    async select(table, query) {
      reads.push({ table, query });
      if (table === 'eqemu_npc_types') return [{ id: 777001, name: 'A_Fresh_Mob' }];
      return [];
    },
    async insertIgnoreDuplicates(table, rows) { inserts.push({ table, rows }); return rows; },
    async update() { return []; },
  };
}

describe('bosses_local self-registration', () => {
  it('a home upload registers a first-time mob exactly as before', async () => {
    const sb = fakeCatalog();
    const r = await _resolveBossForPersist('A Fresh Mob', null, sb);
    expect(r).toEqual({ internalId: 'a_fresh_mob', registered: true });
    expect(sb.inserts).toHaveLength(1);
    expect(sb.inserts[0].table).toBe('bosses_local');
    expect(sb.inserts[0].rows[0]).toMatchObject({ npc_id: 777001, internal_id: 'a_fresh_mob', auto_registered: true });
    expect(sb.reads.map((x) => x.query)).toEqual([
      'internal_id=in.(a_fresh_mob,fresh_mob)&select=internal_id,auto_registered',
      'or=(name.eq.A_Fresh_Mob,name.eq.%23A_Fresh_Mob)&select=id,name&limit=3',
      'npc_id=eq.777001&select=internal_id,auto_registered&limit=1',
      'npc_id=eq.777001&select=internal_id&limit=1',
    ]);
  });

  it('a hub upload (registerNew false) writes nothing to bosses_local and resolves to null', async () => {
    const sb = fakeCatalog();
    const r = await _resolveBossForPersist('A Fresh Mob', null, sb, { registerNew: false });
    expect(r).toBeNull();
    expect(sb.inserts).toEqual([]);
  });

  it('a hub upload still resolves a mob the shared catalog already holds', async () => {
    const sb = fakeCatalog();
    const sel = sb.select;
    sb.select = async (t, q) => (t === 'bosses_local' && q.startsWith('internal_id=in.(')) ? [{ internal_id: 'a_fresh_mob', auto_registered: false }] : sel(t, q);
    const r = await _resolveBossForPersist('A Fresh Mob', null, sb, { registerNew: false });
    expect(r).toEqual({ internalId: 'a_fresh_mob', registered: false });
  });

  it('the upload handler passes registerNew from the upload guild', () => {
    const call = stripJs(sliceBlock(src, 'const resolved = await _resolveBossForPersist(', ');'));
    expect(call).toMatch(/registerNew:\s*!_uploadIsForeignGuild\(guildDb, identity\)/);
  });
});
