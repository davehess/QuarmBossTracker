// test/who-lookup-levels.test.js — /who overlay levels for our own anon members (the guild lead,
// 2026-10-04: "We shouldn't have a gap in our own players levels.").
//
// Mimic's /who overlay fills an /anon row from the bot's GET /api/agent/who-lookup. Two members showed
// a class and no level: the class came from the roster / overrides, which carry no level, and the only
// level source was a live /who. Pass 3b now asks one RPC, latest_character_levels, for two levels per
// name, and the handler takes the highest:
//   level      the member's own Mimic-reported level (xp_events) — exact and current
//   who_level  the last non-anon /who level (who_observations) — history, but covers non-Mimic toons
// who_directory (pass 2) is deliberately NOT widened to chase levels: the view scans all of
// who_observations on every call (~1.4 s for 10 names on production), so pass 2 must still run only
// for a name missing a CLASS. The RPC reads who_observations on its own index (~3 ms).
//
// Everything runs against the REAL handler (_handleAgentWhoLookup sliced out of index.js) on fake
// state / roster / tables. The fake RPC mirrors the SQL (xp_events exact-case match + guild filter,
// who_observations on lower(), newest non-null first, LEFT joins, a name with neither is omitted), so
// a handler that sent lowercase names would miss the xp row. Plus the migration file and its contract
// with the handler's call. Fixture names are invented (Aldenmar, Brackwyn, ...); none is a member.
//
// Run: npx vitest run test/who-lookup-levels.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const classTitles = require('../utils/classTitles.js');

const SRC = readSource(BOT_INDEX);
const HANDLER_SRC = sliceBlock(SRC,
  'async function _handleAgentWhoLookup(req, res) {',
  '// ── Backfill requests');
const { _assembleWhoEnrichment } = evalBlock(
  sliceBlock(SRC, '// ── #111 /who overlay enrichment assembly', '// ── end #111 enrichment assembly'),
  ['_assembleWhoEnrichment']);

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

// A row of xp_events, as the agent uploads it. `at` is minutes ago.
const xp = (character, level, levelAfter, minAgo, guild = 'wolfpack') =>
  ({ guild_id: guild, character, at: ago(minAgo), kind: 'party', level, level_after: levelAfter });

// A row of who_observations. level null = an /anon sighting.
const obs = (character, level, minAgo) => ({ character, level, observed_at: ago(minAgo) });

// latest_character_levels, in JS: the rows the SQL returns.
function sqlLatestLevels({ xpRows, whoRows }, { p_guild_id, p_names }) {
  const out = [];
  for (const n of p_names) {
    const x = xpRows
      .filter(r => r.guild_id === p_guild_id && r.character === n && (r.level_after ?? r.level) != null)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const w = whoRows
      .filter(r => r.character.toLowerCase() === n.toLowerCase() && r.level != null)
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
    if (!x && !w) continue;
    out.push({ character: n, level: x ? (x.level_after ?? x.level) : null, at: x ? x.at : null, who_level: w ? w.level : null });
  }
  return out;
}

// A who_directory row; only what the handler selects.
const dirRow = (key, cls, level, extra = {}) => ({
  character_key: key, observed_class: cls, level, guild_name: null, last_seen: ago(60 * 24 * 6),
  ever_zek_guild: false, ever_inferred_zek: false, ...extra,
});

async function lookup({
  names, whoData = {}, roster = {}, overrides = {}, directory = [], xpRows = [], whoRows = [], rpc = null, enabled = true,
}) {
  const calls = { select: [], rpc: [] };
  const sb = {
    isEnabled: () => enabled,
    select: async (table, qs) => {
      calls.select.push({ table, qs: decodeURIComponent(qs) });
      if (table !== 'who_directory') return [];
      const m = /character_key=in\.\((.*?)\)&select/.exec(qs);
      const wanted = new Set(decodeURIComponent(m[1]).split(',').map(s => s.replace(/"/g, '')));
      return directory.filter(r => wanted.has(r.character_key));
    },
    rpc: async (fn, params) => {
      calls.rpc.push({ fn, params });
      return rpc ? rpc(fn, params) : sqlLatestLevels({ xpRows, whoRows }, params);
    },
  };
  const modules = {
    './utils/state': { getWhoEntry: (nm) => whoData[nm.toLowerCase()] || null },
    './utils/roster': { getCharacter: (nm) => roster[nm.toLowerCase()] || null },
    './utils/supabase': sb,
    './utils/classTitles': classTitles,
  };
  const scope = {
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u1' }) },
    _freshWhoOverrides: async () => new Map(Object.entries(overrides)),
    _assembleWhoEnrichment,
    _freshMainNames: async () => new Map(),
    _freshMimicPrimaries: () => new Set(),
    _hideMainNamesSet: async () => new Set(),
    require: (p) => { if (!(p in modules)) throw new Error('unstubbed require ' + p); return modules[p]; },
  };
  const proxy = new Proxy(scope, { has: (t, k) => Object.prototype.hasOwnProperty.call(t, k) });
  // eslint-disable-next-line no-new-func
  const handler = new Function('__scope', `with (__scope) { ${HANDLER_SRC}\nreturn _handleAgentWhoLookup; }`)(proxy);
  let status = null, body = null;
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  await handler({ url: '/api/agent/who-lookup?names=' + encodeURIComponent(names.join(',')), headers: {} }, res);
  return { status, results: JSON.parse(body).results, calls };
}

let warn;
let savedGuild;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  savedGuild = process.env.SUPABASE_GUILD_ID;
  delete process.env.SUPABASE_GUILD_ID;
});
afterEach(() => {
  warn.mockRestore();
  if (savedGuild === undefined) delete process.env.SUPABASE_GUILD_ID; else process.env.SUPABASE_GUILD_ID = savedGuild;
});
const whoWarns = () => warn.mock.calls.filter(c => String(c[0]).startsWith('[who-lookup]'));

describe('who-lookup — who_directory (pass 2) stays as it was', () => {
  it('is NOT asked for a name whose class is already known: the view scans all of who_observations', async () => {
    const { calls } = await lookup({
      names: ['Aldenmar', 'Brackwyn', 'Corvale'],
      whoData: { aldenmar: { class: 'Cleric', level: 62 } },
      roster: { brackwyn: { class: 'Warrior' } },        // class from the roster, no level
      overrides: { corvale: { class: 'Wizard', is_zek: false } },
    });
    expect(calls.select.some(c => c.table === 'who_directory')).toBe(false);
  });

  it('is still asked for a name with no class, and can CREATE a result for a cross-guild name', async () => {
    const { results, calls } = await lookup({
      names: ['Corvale', 'Brackwyn'],
      roster: { brackwyn: { class: 'Warrior' } },
      directory: [dirRow('corvale', 'Enchanter', 62, { guild_name: 'Elsewhere' })],
    });
    const dir = calls.select.find(c => c.table === 'who_directory');
    expect(dir.qs).toContain('"corvale"');
    expect(dir.qs).not.toContain('"brackwyn"');
    expect(results.corvale).toMatchObject({ class: 'Enchanter', level: 62, guild: 'Elsewhere', source: 'who_directory' });
  });

  it('does not CREATE a result from a who_directory row with no class', async () => {
    const { results } = await lookup({
      names: ['Brackwyn'],
      directory: [dirRow('brackwyn', null, 61)],
    });
    expect(results.brackwyn).toBeUndefined();
  });
});

describe('who-lookup — levels from latest_character_levels (pass 3b)', () => {
  const roster = { aldenmar: { class: 'Cleric' } };

  it('the reported bug: a class from the roster and no live level gets the last non-anon /who level', async () => {
    const { status, results, calls } = await lookup({
      names: ['Aldenmar'], roster,
      whoRows: [obs('Aldenmar', 58, 60 * 24 * 9), obs('Aldenmar', 60, 60 * 24 * 6), obs('Aldenmar', null, 60)],
    });
    expect(status).toBe(200);
    expect(results.aldenmar).toMatchObject({ class: 'Cleric', level: 60, source: 'roster' });
    expect(calls.select.some(c => c.table === 'who_directory')).toBe(false);   // cost: the view is not touched
  });

  it('Mimic 64 against who_level 59 → 64', async () => {
    const { results } = await lookup({
      names: ['Aldenmar'], roster,
      xpRows: [xp('Aldenmar', 58, 59, 600), xp('Aldenmar', 63, 64, 30), xp('Aldenmar', 62, 63, 90)],
      whoRows: [obs('Aldenmar', 59, 60 * 24 * 6)],
    });
    expect(results.aldenmar).toMatchObject({ class: 'Cleric', level: 64, source: 'roster' });
  });

  it('who_level 60 and no Mimic row → 60; the Mimic row of another character does not leak in', async () => {
    const { results } = await lookup({
      names: ['Aldenmar'], roster,
      xpRows: [xp('Brackwyn', 64, 64, 5)],
      whoRows: [obs('Aldenmar', 60, 60 * 24 * 6)],
    });
    expect(results.aldenmar.level).toBe(60);
  });

  it('takes the HIGHEST when sources disagree: a stale row never lowers a level', async () => {
    const stale = await lookup({
      names: ['Aldenmar'], roster,
      xpRows: [xp('Aldenmar', 63, 64, 30)],
      whoRows: [obs('Aldenmar', 65, 60)],
    });
    expect(stale.results.aldenmar.level).toBe(65);

    const live = await lookup({
      names: ['Aldenmar'],
      whoData: { aldenmar: { class: 'Cleric', level: 65 } },       // live /who level already on the result
      xpRows: [xp('Aldenmar', 63, 64, 30)],
      whoRows: [obs('Aldenmar', 60, 60)],
    });
    expect(live.results.aldenmar.level).toBe(65);
  });

  it('a Mimic level beats an older live /who level', async () => {
    const { results } = await lookup({
      names: ['Aldenmar'],
      whoData: { aldenmar: { class: 'Cleric', level: 62 } },
      xpRows: [xp('Aldenmar', 63, 64, 30)],
    });
    expect(results.aldenmar.level).toBe(64);
  });

  it('a Mimic level beats the who_directory level of a classless name (pass 2 then pass 3b)', async () => {
    const { results } = await lookup({
      names: ['Corvale'],
      directory: [dirRow('corvale', 'Enchanter', 59)],
      xpRows: [xp('Corvale', 63, 64, 30)],
    });
    expect(results.corvale).toMatchObject({ class: 'Enchanter', level: 64, source: 'who_directory' });
  });

  it('a name known only from a /who sighting gets a result with its level, source who', async () => {
    const { results } = await lookup({
      names: ['zarrin'],                      // the overlay may send any case
      whoRows: [obs('Zarrin', 61, 60 * 24 * 3)],
    });
    expect(results.zarrin).toEqual({
      class: null, level: 61, guild: null, guild_rank: null, is_zek: false, last_seen: null, source: 'who',
    });
  });

  it('a name known only from its own uploads gets a result with its level, source mimic', async () => {
    const { results } = await lookup({
      names: ['zarrin'],
      xpRows: [xp('Zarrin', 63, 64, 10)],
    });
    expect(results.zarrin).toEqual({
      class: null, level: 64, guild: null, guild_rank: null, is_zek: false, last_seen: null, source: 'mimic',
    });
  });

  it('a created result with both sources takes the higher level and source mimic', async () => {
    const { results } = await lookup({
      names: ['Zarrin'],
      xpRows: [xp('Zarrin', 63, 64, 10)],
      whoRows: [obs('Zarrin', 59, 60 * 24 * 6)],
    });
    expect(results.zarrin).toMatchObject({ class: null, level: 64, source: 'mimic' });
  });

  it('does not touch the other fields of a result an earlier pass built', async () => {
    const { results } = await lookup({
      names: ['Aldenmar'],
      whoData: { aldenmar: { class: 'Cleric', level: 60, guild: 'Wolf Pack', guildRank: 'Officer', is_zek: false, lastSeen: '2026-09-28T00:00:00Z' } },
      xpRows: [xp('Aldenmar', 63, 64, 30)],
    });
    expect(results.aldenmar).toMatchObject({
      class: 'Cleric', level: 64, guild: 'Wolf Pack', guild_rank: 'Officer', last_seen: '2026-09-28T00:00:00Z', source: 'who',
    });
  });

  it('asks for EQ-capitalised, de-duplicated names and the guild id; matches back case-insensitively', async () => {
    const { results, calls } = await lookup({
      names: ['aldenmar', 'ALDENMAR', 'bRACKWYN'],
      xpRows: [xp('Aldenmar', 63, 64, 10)],
      whoRows: [obs('Brackwyn', 61, 60 * 24)],
    });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe('latest_character_levels');
    expect(calls.rpc[0].params).toEqual({ p_guild_id: 'wolfpack', p_names: ['Aldenmar', 'Brackwyn'] });
    expect(results.aldenmar.level).toBe(64);
    expect(results.brackwyn.level).toBe(61);
  });

  it('uses SUPABASE_GUILD_ID when set', async () => {
    process.env.SUPABASE_GUILD_ID = 'testguild';
    const { results, calls } = await lookup({
      names: ['Aldenmar'],
      xpRows: [xp('Aldenmar', 63, 64, 10, 'testguild'), xp('Aldenmar', 20, 20, 5, 'wolfpack')],
    });
    expect(calls.rpc[0].params.p_guild_id).toBe('testguild');
    expect(results.aldenmar.level).toBe(64);
  });

  it('skips rows with no usable level and creates nothing from them', async () => {
    const { results } = await lookup({
      names: ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara'],
      rpc: async () => [
        { character: 'Aldenmar', level: 0, who_level: 0 }, { character: 'Brackwyn', level: null, who_level: null },
        { character: 'Corvale', level: 'x', who_level: 'y' }, { character: '', level: 70, who_level: 70 }, null,
        { character: 'Rethlan', level: 64.5, who_level: 61.5 }, { character: 'Nyssara' },
      ],
    });
    expect(results).toEqual({});
  });

  it('one bad column does not hide the other', async () => {
    const { results } = await lookup({
      names: ['Aldenmar', 'Brackwyn'],
      rpc: async () => [
        { character: 'Aldenmar', level: 'x', who_level: 61 },
        { character: 'Brackwyn', level: 64, who_level: null },
      ],
    });
    expect(results.aldenmar).toMatchObject({ level: 61, source: 'who' });
    expect(results.brackwyn).toMatchObject({ level: 64, source: 'mimic' });
  });

  it('is not called, and nothing changes, when Supabase is disabled', async () => {
    const { results, calls } = await lookup({
      names: ['Aldenmar'], roster, enabled: false,
      xpRows: [xp('Aldenmar', 63, 64, 10)],
    });
    expect(calls.rpc).toHaveLength(0);
    expect(results.aldenmar.level).toBeNull();
  });

  it('is not called for an empty names list', async () => {
    const { results, calls } = await lookup({ names: [], xpRows: [xp('Aldenmar', 63, 64, 10)] });
    expect(calls.rpc).toHaveLength(0);
    expect(results).toEqual({});
  });
});

describe('who-lookup — fail-open on the level pass', () => {
  const base = {
    names: ['Aldenmar', 'Zarrin'],
    roster: { aldenmar: { class: 'Cleric' } },
  };
  const baseline = async () => (await lookup({ ...base, rpc: async () => [] })).results;

  it('a thrown RPC logs one [who-lookup] warning, changes nothing and still answers 200', async () => {
    const want = await baseline();
    warn.mockClear();
    const { status, results } = await lookup({ ...base, rpc: async () => { throw new Error('boom'); } });
    expect(status).toBe(200);
    expect(results).toEqual(want);
    expect(results.aldenmar.level).toBeNull();
    expect(results.zarrin).toBeUndefined();
    expect(whoWarns()).toHaveLength(1);
    expect(String(whoWarns()[0][1] ?? whoWarns()[0][0])).toContain('boom');
  });

  it.each([
    ['null (a failed request)', null],
    ['an error body', { message: 'function not found' }],
    ['a string', 'upstream said no'],
  ])('a non-array result (%s) logs one [who-lookup] warning and changes nothing', async (_label, value) => {
    const want = await baseline();
    warn.mockClear();
    const { status, results } = await lookup({ ...base, rpc: async () => value });
    expect(status).toBe(200);
    expect(results).toEqual(want);
    expect(whoWarns()).toHaveLength(1);
  });
});

describe('migration 20261004120000_latest_character_levels.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261004120000_latest_character_levels.sql');
  const sql = stripSql(fs.readFileSync(file, 'utf8')).replace(/\s+/g, ' ');
  // the two lateral bodies, cut at their closing alias
  const laterals = sql.split(/left join lateral \(/i);
  const xpLateral = (laterals[1] || '').split(') x on true')[0];
  const whoLateral = (laterals[2] || '').split(') w on true')[0];

  it('creates latest_character_levels(p_guild_id text, p_names text[]) idempotently', () => {
    expect(sql).toMatch(/create or replace function public\.latest_character_levels\(p_guild_id text, p_names text\[\]\)/i);
    expect(sql).toMatch(/returns table\("character" text, level int, at timestamptz, who_level int\)/i);
    expect(sql).toMatch(/language sql stable security invoker set search_path = public/i);
    expect(sql).not.toMatch(/security definer/i);
  });

  it('LEFT joins both laterals, so a name with only one source still comes back', () => {
    expect(sql).toMatch(/from unnest\(p_names\) as n\(nm\) left join lateral \(/i);
    expect(sql).toMatch(/\) x on true left join lateral \(/i);
    expect(sql).toMatch(/\) w on true where /i);
    expect(sql.match(/\bleft join lateral\b/gi)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(?:cross|inner)\s+join\b/i);
    expect(sql).not.toMatch(/(?<!left )\bjoin lateral\b/i);
  });

  it('drops a name with neither level', () => {
    expect(sql).toMatch(/where x\.lvl is not null or w\.level is not null/i);
    expect(sql).toMatch(/select n\.nm as "character", x\.lvl as level, x\.at as at, w\.level as who_level/i);
  });

  it('xp lateral: this guild, exact name, prefers level_after, newest first, limit 1', () => {
    expect(xpLateral).not.toBe('');
    expect(xpLateral).toMatch(/select coalesce\(e\.level_after, e\.level\) as lvl, e\.at from xp_events e/i);
    expect(xpLateral).toMatch(/e\.guild_id = p_guild_id/i);
    expect(xpLateral).toMatch(/e\.character = n\.nm/i);
    expect(xpLateral).toMatch(/coalesce\(e\.level_after, e\.level\) is not null/i);
    const order = xpLateral.search(/order by e\.at desc/i);
    expect(order).toBeGreaterThan(-1);
    expect(xpLateral.search(/limit 1\b/i)).toBeGreaterThan(order);
  });

  it('who lateral: who_observations on lower() both sides, a level, newest first, limit 1, no guild filter', () => {
    expect(whoLateral).not.toBe('');
    expect(whoLateral).toMatch(/select o\.level from who_observations o/i);
    expect(whoLateral).toMatch(/lower\(o\.character\) = lower\(n\.nm\)/i);
    expect(whoLateral).toMatch(/o\.level is not null/i);
    const order = whoLateral.search(/order by o\.observed_at desc/i);
    expect(order).toBeGreaterThan(-1);
    expect(whoLateral.search(/limit 1\b/i)).toBeGreaterThan(order);
    expect(whoLateral).not.toMatch(/guild_id/i);      // who_directory has none either
  });

  it('is callable by service_role only', () => {
    expect(sql).toMatch(/revoke all on function public\.latest_character_levels\(text, text\[\]\) from public/i);
    expect(sql).toMatch(/revoke all on function public\.latest_character_levels\(text, text\[\]\) from anon/i);
    expect(sql).toMatch(/revoke all on function public\.latest_character_levels\(text, text\[\]\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.latest_character_levels\(text, text\[\]\) to service_role/i);
  });

  it('takes the parameter names the handler sends, and returns the columns it reads', async () => {
    const { calls } = await lookup({ names: ['Aldenmar'], xpRows: [] });
    expect(calls.rpc[0].fn).toBe('latest_character_levels');
    for (const key of Object.keys(calls.rpc[0].params)) expect(sql).toContain(`${key} `);
    for (const col of ['"character"', 'level', 'who_level']) expect(sql).toContain(col);
  });
});
