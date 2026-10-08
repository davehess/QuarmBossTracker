// test/target-casts-last-casters.test.js — Target Info can name who cast an
// effect, long after the cast finished.
//
// The guild lead, 2026-10-08: mousing over a timer "should show you how long it
// lasted and who cast it". EQ's landing lines never name a caster and
// buff_casts has no caster column, so the only source is the casting relay.
// That relay forgets a cast ~3s after it ends, so the bot now remembers the
// LAST caster per (target, spell) for 3h and serves it as `last_casters` on
// GET /api/agent/target-casts.
//
// Everything here runs the REAL shipped functions (sliced out of index.js and
// eval'd with stubbed collaborators) — no text assertions, so a comment cannot
// satisfy a test. Caster/character names are invented example tokens.
//
// Run: npx vitest run test/target-casts-last-casters.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const { groupRaids } = createRequire(import.meta.url)('../utils/raidGroups.js');

const src = readSource(BOT_INDEX);

const memBlock = sliceBlock(src, 'const _LAST_CASTER_TTL_MS', '// ── end last-caster memory');
// The same scope predicates the live casts loop uses (see the sibling test).
const scopeBlock = sliceBlock(
  src,
  'function _zoneScopeKeep(requesterZone, observerZone) {',
  '\n// GET /api/agent/target-casts?name=<npc|player>',
);
const readSrc = sliceBlock(src, 'async function _handleAgentTargetCasts(req, res) {', '\n// Curse counter map');
const ingestSrc = sliceBlock(src, 'async function _handleAgentCasting(req, res) {', '\n// Ingest the live raid roster');

const spellFxSrc = sliceBlock(src, 'let _spellFxByName = null;', '  return _spellFxByName || new Map();\n}');
const raidSplitSrc = sliceBlock(src, 'async function _liveRaidSplit(', '\n}\n');

const HOUR = 3600 * 1000;
const T0 = Date.parse('2026-10-08T20:00:00Z');

function makeBot() {
  const mem = evalBlock(memBlock, [
    '_noteLastCaster', '_lastCastersFor', '_lastCasterByTargetSpell', '_LAST_CASTER_TTL_MS', '_LAST_CASTER_MAX', '_groupmatesFromSplit',
  ]);
  const scope = evalBlock(scopeBlock, ['_zoneScopeKeepForName', '_idScopeKeep']);
  const castingByTarget = new Map();
  const cureCastByTarget = new Map();
  const state = { zones: new Map(), nameZones: 1, split: null };
  const fx = new Map();   // spell fx catalog stub: nameLower → { groupCast? }
  const mimicLink = { requireAgentAuth: async () => ({ ok: true }) };

  const readFn = new Function(
    'mimicLink', '_liveZoneMap', '_nameZoneCount', '_pruneCasts', '_castingByTarget',
    '_zoneScopeKeepForName', '_idScopeKeep', '_lastCastersFor',
    readSrc + '\nreturn _handleAgentTargetCasts;',
  )(
    mimicLink, async () => state.zones, async () => state.nameZones, () => {}, castingByTarget,
    scope._zoneScopeKeepForName, scope._idScopeKeep, mem._lastCastersFor,
  );
  const ingestFn = new Function(
    'mimicLink', '_spellFxByName', '_spellFxMap', '_cureCastByTarget', '_healAmtFor',
    '_castingByTarget', '_pruneCasts', '_noteLastCaster', '_groupmatesOf',
    ingestSrc + '\nreturn _handleAgentCasting;',
  )(
    mimicLink, fx, async () => {}, cureCastByTarget, () => 0,
    castingByTarget, () => {}, mem._noteLastCaster,
    async (c) => mem._groupmatesFromSplit(state.split, c),
  );

  const mkRes = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } });
  return {
    mem, state, fx, castingByTarget,
    async cast(casts) {
      const res = mkRes();
      const buf = Buffer.from(JSON.stringify({ casts }));
      await ingestFn({ async *[Symbol.asyncIterator]() { yield buf; } }, res);
      return JSON.parse(res.body);
    },
    async read(query) {
      const res = mkRes();
      await readFn({ url: '/api/agent/target-casts?' + new URLSearchParams(query).toString() }, res);
      return JSON.parse(res.body);
    },
  };
}

const cast = (caster, spell, target, extra = {}) => ({ caster, spell, target, cast_secs: 3, ...extra });

let bot;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  bot = makeBot();
});
afterEach(() => { vi.useRealTimers(); });

describe('ingest remembers the caster', () => {
  it('serves who cast a spell on the target, after the live cast is long gone', async () => {
    await bot.cast([cast('Aldenmar', 'Tashan', 'a gnoll pup')]);
    vi.setSystemTime(T0 + 20 * 60 * 1000);                 // far past the live-cast window
    const out = await bot.read({ name: 'A Gnoll Pup' });   // lookup is case-insensitive
    expect(out.last_casters).toEqual([{ spell: 'Tashan', caster: 'Aldenmar', at_ms: T0 }]);
  });

  it('a later cast of the same spell on the same target overwrites the caster', async () => {
    await bot.cast([cast('Aldenmar', 'Tashan', 'a gnoll pup')]);
    vi.setSystemTime(T0 + 60 * 1000);
    await bot.cast([cast('Brackwyn', 'tashan', 'A Gnoll Pup')]);   // case-insensitive key
    const out = await bot.read({ name: 'a gnoll pup' });
    expect(out.last_casters).toHaveLength(1);
    expect(out.last_casters[0].caster).toBe('Brackwyn');
    expect(out.last_casters[0].at_ms).toBe(T0 + 60 * 1000);
  });

  it('keeps one entry per spell and only for the asked target', async () => {
    await bot.cast([
      cast('Aldenmar', 'Tashan', 'a gnoll pup'),
      cast('Brackwyn', 'Malo', 'a gnoll pup'),
      cast('Corvale', 'Tashan', 'a different mob'),
    ]);
    const out = await bot.read({ name: 'a gnoll pup' });
    expect(out.last_casters.map((e) => e.spell).sort()).toEqual(['Malo', 'Tashan']);
    expect(out.last_casters.find((e) => e.spell === 'Tashan').caster).toBe('Aldenmar');
  });

  it('does not record a cast the caster reported as failed', async () => {
    await bot.cast([cast('Aldenmar', 'Remove Greater Curse', 'a gnoll pup', { cure_failed: true })]);
    const out = await bot.read({ name: 'a gnoll pup' });
    expect(out.last_casters).toEqual([]);
  });
});

describe('bounds', () => {
  it('drops entries older than 3 hours, keeps ones just inside', async () => {
    await bot.cast([cast('Aldenmar', 'Tashan', 'a gnoll pup')]);
    vi.setSystemTime(T0 + 3 * HOUR - 1000);
    expect((await bot.read({ name: 'a gnoll pup' })).last_casters).toHaveLength(1);
    vi.setSystemTime(T0 + 3 * HOUR + 1000);
    expect((await bot.read({ name: 'a gnoll pup' })).last_casters).toEqual([]);
    expect(bot.mem._lastCasterByTargetSpell.size).toBe(0);   // pruned, not just hidden
  });

  it('caps the map and evicts the oldest first; a re-cast refreshes recency', () => {
    const { _noteLastCaster, _lastCasterByTargetSpell: m, _LAST_CASTER_MAX: max } = bot.mem;
    for (let i = 0; i < max; i++) _noteLastCaster('Aldenmar', 'Tashan', `mob ${i}`, null, T0);
    expect(m.size).toBe(max);
    _noteLastCaster('Aldenmar', 'Tashan', 'mob 0', null, T0 + 1);    // refresh the oldest
    _noteLastCaster('Aldenmar', 'Tashan', 'mob extra', null, T0 + 2);
    expect(m.size).toBe(max);
    expect(m.has('mob 0|tashan')).toBe(true);        // refreshed, survived
    expect(m.has('mob 1|tashan')).toBe(false);       // oldest untouched, evicted
    expect(m.has('mob extra|tashan')).toBe(true);
  });
});

describe('scope matches the live casts loop', () => {
  it("drops a caster who is provably in another zone when the name is ambiguous", async () => {
    bot.state.nameZones = 2;
    bot.state.zones = new Map([
      ['rethlan',  { zone_name: 'Crystal Caverns' }],   // the requester
      ['aldenmar', { zone_name: 'Crystal Caverns' }],
      ['brackwyn', { zone_name: 'The Wakening Land' }],
    ]);
    await bot.cast([cast('Aldenmar', 'Tashan', 'a geonid'), cast('Brackwyn', 'Malo', 'a geonid')]);
    const out = await bot.read({ name: 'a geonid', character: 'Rethlan' });
    expect(out.last_casters.map((e) => e.caster)).toEqual(['Aldenmar']);
  });

  it('keeps a caster we cannot place when the name exists in only one zone', async () => {
    bot.state.nameZones = 1;
    bot.state.zones = new Map([['rethlan', { zone_name: 'Crystal Caverns' }]]);
    await bot.cast([cast('Corvale', 'Tashan', 'a gnoll pup')]);
    const out = await bot.read({ name: 'a gnoll pup', character: 'Rethlan' });
    expect(out.last_casters.map((e) => e.caster)).toEqual(['Corvale']);
  });

  it('drops a provably different spawn, keeps the same or an unproven one', async () => {
    await bot.cast([
      cast('Aldenmar', 'Tashan', 'a thought horror evoker', { target_id: 200 }),   // sibling
      cast('Brackwyn', 'Malo',   'a thought horror evoker', { target_id: 100 }),   // this mob
      cast('Corvale',  'Slow',   'a thought horror evoker'),                       // no id sent
    ]);
    const out = await bot.read({ name: 'a thought horror evoker', target_id: '100' });
    expect(out.last_casters.map((e) => e.caster).sort()).toEqual(['Brackwyn', 'Corvale']);
  });

  it('serves every caster to a requester that sent no spawn id', async () => {
    await bot.cast([
      cast('Aldenmar', 'Tashan', 'a thought horror evoker', { target_id: 200 }),
      cast('Brackwyn', 'Malo',   'a thought horror evoker', { target_id: 100 }),
    ]);
    const out = await bot.read({ name: 'a thought horror evoker' });
    expect(out.last_casters).toHaveLength(2);
  });
});

describe('existing response is unchanged', () => {
  it('still returns casts with every field, plus last_casters beside it', async () => {
    await bot.cast([cast('Aldenmar', 'Tashan', 'a gnoll pup', { heal_amount: 500, heal_fixed: true })]);
    const out = await bot.read({ name: 'a gnoll pup' });
    expect(Object.keys(out).sort()).toEqual(['casts', 'last_casters']);
    expect(out.casts).toHaveLength(1);
    expect(Object.keys(out.casts[0]).sort()).toEqual(
      ['cast_secs', 'caster', 'ends_at_ms', 'heal_amount', 'heal_fixed', 'remaining_secs', 'spell'].sort(),
    );
    expect(out.casts[0]).toMatchObject({ caster: 'Aldenmar', spell: 'Tashan', cast_secs: 3, ends_at_ms: T0 + 3000 });
  });

  it('an unknown target returns empty arrays, not an error', async () => {
    const out = await bot.read({ name: 'nothing here' });
    expect(out).toEqual({ casts: [], last_casters: [] });
    expect(await bot.read({})).toEqual({ casts: [], last_casters: [] });
  });
});

// ── Group spells: a groupmate's landing is the caster's too ──────────────────
// The guild lead, 2026-10-08: "we should know it since we have the timer and the
// person casting it when they start, the target, the target's group if they're
// using mimic". A group spell (targettype 3 / 41) cast on one member lands on
// the caster's whole group, so each groupmate's Target Info row can name it.

const row = (name, group, extra = {}) => ({
  name, group_num: group, rank: null, uploaded_by_discord_id: '1',
  captured_at: new Date(T0).toISOString(), ...extra,
});
// Raid of one leader and two groups; group 0 is "ungrouped".
const raidRows = () => [
  row('Rethlan', 1, { rank: 'Raid Leader' }),
  row('Aldenmar', 1), row('Brackwyn', 1), row('Corvale', 1),
  row('Nyssara', 2), row('Zarrin', 2),
  row('Loner', 0),
];

describe('group spells attribute the whole caster group', () => {
  beforeEach(() => {
    bot.state.split = groupRaids(raidRows(), { now: T0 });
    bot.fx.set('group spirit', { groupCast: true });
  });

  it('records the caster under every groupmate, not other groups', async () => {
    await bot.cast([cast('Aldenmar', 'Group Spirit', 'Brackwyn')]);
    const seen = async (n) => (await bot.read({ name: n })).last_casters;
    expect(await seen('Brackwyn')).toEqual([{ spell: 'Group Spirit', caster: 'Aldenmar', at_ms: T0 }]);
    expect((await seen('Corvale')).map((e) => e.caster)).toEqual(['Aldenmar']);
    expect(await seen('Nyssara')).toEqual([]);   // group 2
    expect(await seen('Loner')).toEqual([]);     // ungrouped
  });

  it("the cast target keeps the spawn id it was cast on (mates do not overwrite it)", async () => {
    await bot.cast([cast('Aldenmar', 'Group Spirit', 'Brackwyn', { target_id: 100 })]);
    expect((await bot.read({ name: 'Brackwyn', target_id: '200' })).last_casters).toEqual([]);   // other spawn
    expect((await bot.read({ name: 'Brackwyn', target_id: '100' })).last_casters).toHaveLength(1);
  });

  it('a single-target spell stays on its target only', async () => {
    bot.fx.set('spirit of wolf', {});
    await bot.cast([cast('Aldenmar', 'Spirit of Wolf', 'Brackwyn')]);
    expect((await bot.read({ name: 'Brackwyn' })).last_casters).toHaveLength(1);
    expect((await bot.read({ name: 'Corvale' })).last_casters).toEqual([]);
  });

  it('an ungrouped caster has no mates; the cast target is still recorded', async () => {
    await bot.cast([cast('Loner', 'Group Spirit', 'Corvale')]);
    expect((await bot.read({ name: 'Corvale' })).last_casters.map((e) => e.caster)).toEqual(['Loner']);
    expect((await bot.read({ name: 'Brackwyn' })).last_casters).toEqual([]);
  });

  it('a caster missing from the roster, or no roster at all, degrades to the target only', async () => {
    await bot.cast([cast('Stranger', 'Group Spirit', 'Brackwyn')]);
    bot.state.split = null;
    await bot.cast([cast('Aldenmar', 'Group Spirit', 'Corvale')]);
    expect((await bot.read({ name: 'Brackwyn' })).last_casters.map((e) => e.caster)).toEqual(['Stranger']);
    expect((await bot.read({ name: 'Corvale' })).last_casters.map((e) => e.caster)).toEqual(['Aldenmar']);
  });

  it('mate entries obey the same 3h TTL', async () => {
    await bot.cast([cast('Aldenmar', 'Group Spirit', 'Brackwyn')]);
    vi.setSystemTime(T0 + 3 * HOUR + 1000);
    expect((await bot.read({ name: 'Corvale' })).last_casters).toEqual([]);
  });

  it('two raids at once reuse group numbers: only the caster\'s own raid is searched', () => {
    const other = [
      row('Veldrin', 1, { rank: 'Raid Leader', uploaded_by_discord_id: '2' }),
      row('Mythra', 1, { uploaded_by_discord_id: '2' }),
    ];
    const split = groupRaids([...raidRows(), ...other], { now: T0 });
    expect(split.multi).toBe(true);
    const mates = bot.mem._groupmatesFromSplit(split, 'aldenmar').sort();
    expect(mates).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
    expect(mates).not.toContain('Mythra');
  });
});

describe('the pieces group attribution depends on', () => {
  it('the spell catalog flags targettype 3 and 41 as group casts, nothing else', async () => {
    const rows = [
      { name: 'Group Heal', targettype: 41, good_effect: 1, raw: { eff: [0], base: [100] } },
      { name: 'Gate Group', targettype: 3, good_effect: 1, raw: { eff: [0], base: [1] } },
      { name: 'Single Heal', targettype: 5, good_effect: 1, raw: { eff: [0], base: [100] } },
      { name: 'PB Nuke', targettype: 4, good_effect: 0, raw: { eff: [0], base: [-100] } },
    ];
    let query = '';
    const fake = (id) => {
      expect(id).toBe('./utils/supabase');
      return { selectAllPaged: async (_t, q) => { query = q; return rows; } };
    };
    const { _spellFxMap } = new Function('require', spellFxSrc + '\nreturn { _spellFxMap };')(fake);
    const m = await _spellFxMap();
    expect(query).toMatch(/targettype/);
    expect(m.get('group heal').groupCast).toBe(true);
    expect(m.get('gate group').groupCast).toBe(true);
    expect(m.get('single heal').groupCast).toBeUndefined();
    expect(m.get('pb nuke').groupCast).toBeUndefined();
  });

  it('the raid-roster read the split is built from carries group_num', async () => {
    let query = '';
    const supabase = { selectAllPaged: async (_t, q) => { query = q; return raidRows(); } };
    const liveRaidSplit = new Function(
      '_raidSplitCache', '_raidGroups', '_keepRaidSplit', raidSplitSrc + '\nreturn _liveRaidSplit;',
    )({ split: null, at: 0 }, { RAID_LIVE_MS: 120000, groupRaids }, (s) => s);
    const split = await liveRaidSplit(supabase, 'wolfpack');
    expect(query).toMatch(/select=[^&]*group_num/);
    expect(bot.mem._groupmatesFromSplit(split, 'Aldenmar').sort()).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
  });
});
