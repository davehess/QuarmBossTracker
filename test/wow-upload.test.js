// test/wow-upload.test.js -- the bot side of the WoW reader (utils/wowUpload.js + the branch in index.js).
//
// The guild lead, 2026-10-19: "start supporting other games." A reader for another game posts the SAME envelope as
// the EverQuest agent plus `game: 'wow'`. The bot must (1) route it to the key-based encounter RPC, (2) never run
// the EverQuest boss resolver or touch bosses_local for it, and (3) leave an upload with no `game` exactly as it was.
//
// Layers: normalisation (behaviour), the RPC sequence against a stand-in supabase (behaviour), the SHIPPED
// _handleWowUpload sliced out of index.js and run (behaviour), and where the branch sits in _handleAgentUpload (text,
// comments stripped).
//
// Run: npx vitest run test/wow-upload.test.js

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const wow = require('../utils/wowUpload.js');

const NOW = Date.parse('2026-10-19T20:00:00Z');
const body = (over = {}, enc = {}) => ({
  game: 'wow', agent_version: '0.1.0', character: 'Aldenmar', backfill: false,
  encounter: {
    started_at: '2026-10-19T19:00:00.000Z', ended_at: '2026-10-19T19:03:00.000Z',
    boss_name: 'Lucifron', boss_key: 'wow:encounter:663', events: [], confirmed_kill: true, active_duration_s: 180,
    players: [
      { name: 'Aldenmar', damage: 3800, directDamage: 3300, petDamage: 500, healed: 0 },
      { name: 'Brackwyn', damage: 0, directDamage: 0, petDamage: 0, healed: 600 },
    ],
    deaths: [{ name: 'Brackwyn', ts: '2026-10-19T19:02:10.000Z' }],
    ...enc,
  },
  ...over,
});

function fakeSupabase() {
  const calls = [];
  const s = {
    calls,
    isEnabled: () => true,
    guildId: () => 'wolfpack',
    rpc: vi.fn(async (fn, args) => { calls.push(['rpc', fn, args]); return 'enc-uuid-1'; }),
    recordContribution: vi.fn(async (a) => { calls.push(['recordContribution', a]); return 'contrib-1'; }),
    update: vi.fn(async (t, q, d) => { calls.push(['update', t, q, d]); return []; }),
    select: vi.fn(async () => { throw new Error('a WoW upload must not read bosses_local or any EQ catalog'); }),
    upsert: vi.fn(async () => { throw new Error('unexpected upsert'); }),
    insert: vi.fn(async () => { throw new Error('unexpected insert'); }),
  };
  return s;
}

describe('isWowUpload', () => {
  it('is true only for the literal game:"wow"', () => {
    expect(wow.isWowUpload(body())).toBe(true);
    for (const p of [null, undefined, {}, { encounter: {} }, { game: 'eq' }, { game: 'WoW' }, { game: ' wow' }, { game: true }]) {
      expect(wow.isWowUpload(p)).toBe(false);
    }
  });
});

describe('normalizeWowUpload', () => {
  it('builds a contribution-shaped parse with ranks, dps and a healers list', () => {
    const r = wow.normalizeWowUpload(body(), NOW);
    expect(r.ok).toBe(true);
    expect(r.rec).toMatchObject({ bossKey: 'wow:encounter:663', bossName: 'Lucifron', duration: 180, confirmedKill: true, character: 'Aldenmar' });
    expect(r.rec.rawParse.players[0]).toMatchObject({ name: 'Aldenmar', damage: 3800, rank: 1, dps: 21, hasPets: true });
    expect(r.rec.rawParse.healers).toEqual([{ name: 'Brackwyn', healed: 600, ticks: 0 }]);
    expect(r.rec.rawParse.totalDamage).toBe(3800);
    expect(r.rec.rawParse.game).toBe('wow');
  });

  it('accepts both key forms and refuses anything else', () => {
    expect(wow.normalizeWowUpload(body({}, { boss_key: 'wow:npc:12118' }), NOW).ok).toBe(true);
    for (const k of ['', 'eq:npc:12118', 'wow:npc:', 'wow:npc:12a', 'wow:name:lucifron', 'wow:encounter:1234567890', "wow:npc:1'; drop"]) {
      expect(wow.normalizeWowUpload(body({}, { boss_key: k }), NOW)).toMatchObject({ ok: false });
    }
  });

  it('refuses a missing character, a missing boss name, a bad time, and drops bad player names', () => {
    expect(wow.normalizeWowUpload(body({ character: '' }), NOW).ok).toBe(false);
    expect(wow.normalizeWowUpload(body({}, { boss_name: '  ' }), NOW).ok).toBe(false);
    expect(wow.normalizeWowUpload(body({}, { started_at: 'yesterday' }), NOW).ok).toBe(false);
    expect(wow.normalizeWowUpload(body({}, { started_at: '2026-01-01T00:00:00Z' }), NOW).ok).toBe(false);
    const r = wow.normalizeWowUpload(body({}, { players: [{ name: 'Aldenmar', damage: 5 }, { name: 'a b; drop table', damage: 5 }, { name: 'Zed', damage: 'x' }] }), NOW);
    expect(r.rec.rawParse.players.map(p => p.name)).toEqual(['Aldenmar']);
  });

  it('clamps an absurd duration and strips control characters from the boss name', () => {
    const r = wow.normalizeWowUpload(body({}, { active_duration_s: 999999, boss_name: 'Luci\u0007fron' }), NOW);
    expect(r.rec.duration).toBe(3 * 3600);
    expect(r.rec.bossName).toBe('Lucifron');
  });
});

describe('recordWowUpload', () => {
  const rec = () => wow.normalizeWowUpload(body(), NOW).rec;

  it('finds the encounter by KEY, records the contribution (which merges players), stamps ended_at on a kill', async () => {
    const sb = fakeSupabase();
    const out = await wow.recordWowUpload({ supabase: sb, guildId: 'wolfpack', identity: { discord_id: 'd1' }, payload: body(), rec: rec() });
    expect(out).toEqual({ encounterId: 'enc-uuid-1', contributionId: 'contrib-1' });
    expect(sb.rpc).toHaveBeenCalledTimes(1);
    expect(sb.rpc.mock.calls[0][0]).toBe('find_or_create_encounter_by_key');
    expect(sb.rpc.mock.calls[0][1]).toMatchObject({
      p_guild_id: 'wolfpack', p_game: 'wow', p_boss_key: 'wow:encounter:663', p_boss_name: 'Lucifron', p_duration: 180, p_window_min: 30 });
    expect(sb.rpc.mock.calls[0][1]).not.toHaveProperty('p_npc_id');
    expect(sb.recordContribution.mock.calls[0][0]).toMatchObject({
      encounterId: 'enc-uuid-1', contributorCharacter: 'Aldenmar', source: 'wow_logsync_v1', uploadedByDiscordId: 'd1' });
    expect(sb.update).toHaveBeenCalledWith('encounters', 'id=eq.enc-uuid-1&ended_at=is.null', { ended_at: '2026-10-19T19:03:00.000Z' });
    expect(sb.select).not.toHaveBeenCalled();       // no bosses_local / eqemu read
  });

  it('a wipe does not stamp ended_at', async () => {
    const sb = fakeSupabase();
    const payload = body({}, { confirmed_kill: false });
    await wow.recordWowUpload({ supabase: sb, guildId: 'wolfpack', identity: {}, payload, rec: wow.normalizeWowUpload(payload, NOW).rec });
    expect(sb.update).not.toHaveBeenCalled();
  });

  it('does nothing when the store is off or the RPC fails', async () => {
    const off = fakeSupabase(); off.isEnabled = () => false;
    expect(await wow.recordWowUpload({ supabase: off, guildId: 'g', identity: {}, payload: body(), rec: rec() })).toBeNull();
    const bad = fakeSupabase(); bad.rpc = vi.fn(async () => null);
    expect(await wow.recordWowUpload({ supabase: bad, guildId: 'g', identity: {}, payload: body(), rec: rec() })).toBeNull();
    expect(bad.recordContribution).not.toHaveBeenCalled();
  });
});

describe('the shipped _handleWowUpload (sliced out of index.js and run)', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'async function _handleWowUpload(res, payload, identity) {', '\n}\n');
  function build(sb) {
    const req = (p) => (p === './utils/wowUpload' ? wow : p === './utils/supabase' ? sb : (() => { throw new Error('unexpected require ' + p); })());
    // eslint-disable-next-line no-new-func
    return new Function('require', 'process', 'console', `${block}\nreturn _handleWowUpload;`)(req, { env: {} }, console);
  }
  // the shipped handler reads the real clock, so its fixtures are relative to now
  const fresh = (over = {}, enc = {}) => body(over, { started_at: new Date(Date.now() - 600000).toISOString(), ended_at: new Date(Date.now() - 420000).toISOString(), ...enc });
  const fakeRes = () => { const r = { status: null, out: null, writeHead(s) { r.status = s; }, end(b) { r.out = JSON.parse(b); } }; return r; };

  it('200 + key RPC for a good upload; the EQ RPC and catalog reads never happen', async () => {
    const sb = fakeSupabase();
    const res = fakeRes();
    await build(sb)(res, fresh(), { discord_id: 'd1' });
    expect(res.status).toBe(200);
    expect(res.out).toMatchObject({ ok: true, game: 'wow', encounter_id: 'enc-uuid-1' });
    const fns = sb.calls.filter(c => c[0] === 'rpc').map(c => c[1]);
    expect(fns).toEqual(['find_or_create_encounter_by_key']);
    expect(fns).not.toContain('find_or_create_encounter');
    expect(sb.select).not.toHaveBeenCalled();
  });

  it('400 for a bad key, and still 200 when the database write throws (the agent must not retry forever)', async () => {
    const res = fakeRes();
    await build(fakeSupabase())(res, fresh({}, { boss_key: 'nope' }), {});
    expect(res.status).toBe(400);
    const sb = fakeSupabase(); sb.rpc = vi.fn(async () => { throw new Error('db down'); });
    const res2 = fakeRes();
    await build(sb)(res2, fresh(), {});
    expect(res2.status).toBe(200);
    expect(res2.out.encounter_id).toBeNull();
  });
});

describe('where the branch sits in _handleAgentUpload', () => {
  const src = readSource(BOT_INDEX);
  const handler = stripJs(sliceBlock(src, 'async function _handleAgentUpload(req, res) {', '\n}\n'));
  const wowFn   = stripJs(sliceBlock(src, 'async function _handleWowUpload(res, payload, identity) {', '\n}\n'));

  it('hands a game:wow body over BEFORE the EverQuest resolver, the who merge and the card code', () => {
    const at = handler.indexOf("require('./utils/wowUpload').isWowUpload(payload)");
    expect(at).toBeGreaterThan(0);
    for (const eq of ['findBossFromName', '_resolveBossForPersist', 'mergeWhoData', 'recordParse', 'bosses_local', 'logParseToDiscord']) {
      const i = handler.indexOf(eq);
      expect(i, eq).toBeGreaterThan(at);
    }
    expect(handler).toMatch(/if \(require\('\.\/utils\/wowUpload'\)\.isWowUpload\(payload\)\) return _handleWowUpload\(res, payload, identity\);/);
  });

  it('the WoW handler never names an EverQuest resolver, catalog table or Discord card builder', () => {
    for (const eq of ['findBossFromName', '_resolveBossForPersist', 'bosses_local', 'eqemu_', 'recordParse', 'logParseToDiscord', 'buildParseEmbed', 'recordKill', 'find_or_create_encounter(']) {
      expect(wowFn, eq).not.toContain(eq);
    }
    const lib = stripJs(readSource(require.resolve('../utils/wowUpload.js')));
    for (const eq of ['bosses_local', 'eqemu_', "'find_or_create_encounter'", 'recordParse']) expect(lib, eq).not.toContain(eq);
  });
});

describe('migration 20261019130000_encounters_game_and_boss_key.sql (draft)', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261019130000_encounters_game_and_boss_key.sql'), 'utf8'));

  it('is additive and re-runnable: IF NOT EXISTS columns, OR REPLACE function, no drops of data', () => {
    expect(sql).toMatch(/add column if not exists game\s+text not null default 'eq'/i);
    expect(sql).toMatch(/add column if not exists boss_name text/i);
    expect(sql).toMatch(/add column if not exists boss_key\s+text/i);
    expect(sql).toMatch(/alter column npc_id drop not null/i);
    expect(sql).toMatch(/create index if not exists/i);
    expect(sql).toMatch(/create or replace function public\.find_or_create_encounter_by_key/i);
    expect(sql).not.toMatch(/drop (table|column|constraint|function)|delete from|truncate/i);
    expect(sql).not.toMatch(/find_or_create_encounter\s*\(/i);     // the EQ RPC is not redefined
  });

  it('dedupes on (guild, game, boss_key) inside +/- the window and is service_role only', () => {
    expect(sql).toMatch(/game\s+= p_game\s+and boss_key = p_boss_key/i);
    expect(sql).toMatch(/started_at between p_started_at - \(p_window_min/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    for (const who of ['public', 'anon', 'authenticated']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.find_or_create_encounter_by_key\\([^)]*\\) from ${who};`, 'i'));
    }
    expect(sql).toMatch(/grant execute on function public\.find_or_create_encounter_by_key\([^)]*\) to service_role;/i);
  });
});
