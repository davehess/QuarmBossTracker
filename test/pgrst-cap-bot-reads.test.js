// test/pgrst-cap-bot-reads.test.js — the bot's reads that PostgREST silently cut to 1,000 rows.
//
// The guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100 caps." PostgREST
// answers at most 1,000 rows per response with no error and no flag, and `limit=5000` does not lift it.
// The audit measured a dozen bot reads that were wrong on a busy raid night for exactly that reason; each
// one passed its tests because the fixtures held ten rows.
//
// So these tests run the SHIPPED handlers and functions (sliced out of index.js, utils/openDkpSync.js and
// commands/backfillopendkploot.js) against test/_cap_fake_supabase.js, a fake that enforces the cap, on
// fixtures bigger than the cap. For every fix the case below FAILS against the old read (each was
// mutation-checked: restore the old read and the named test goes red) and passes against the new one.
//
// The migration is checked as text on stripSql (the objects exist, are read-only, are granted to
// service_role only); the SQL itself was checked against production, read-only, in the commit message.
//
// Fixture names are invented (Raider01…); none is a member.
//
// Run: npx vitest run test/pgrst-cap-bot-reads.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';
import { makeCapFake, PGRST_MAX_ROWS } from './_cap_fake_supabase.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);

// ── slicing top-level functions out of index.js and running them ────────────────────────────────────
function sliceFunction(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('slice: function not found: ' + name);
  const lineEnd = src.indexOf('\n', m.index);
  const firstLine = src.slice(m.index, lineEnd);
  if (/\}\s*$/.test(firstLine) && !/\{\s*$/.test(firstLine)) return firstLine;      // a one-line function
  const end = src.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error('slice: no closing brace for ' + name);
  return src.slice(m.index, end + 3);
}
// `injected` are the free identifiers the functions reach for in index.js (module state, helpers);
// `extra` is source that has to exist beside them (a const the functions close over).
function loadBotMany(names, injected, extra = '', src = SRC) {
  const inj = Object.keys(injected);
  const body = extra + '\n' + names.map(n => sliceFunction(src, n)).join('\n') + `\nreturn { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(...inj, body)(...inj.map(n => injected[n]));
}
const loadBot = (name, injected, extra) => loadBotMany([name], injected, extra)[name];

// A whole source file run against a stand-in './supabase' (no shared require cache touched).
function loadFile(file, overrides) {
  const requireFrom = createRequire(file);
  const mod = { exports: {} };
  const localRequire = (p) => (p in overrides ? overrides[p] : requireFrom(p));
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', '__dirname', '__filename', fs.readFileSync(file, 'utf8'))(
    localRequire, mod, mod.exports, path.dirname(file), file);
  return mod.exports;
}

const mkRes = () => {
  const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } };
  return r;
};
const json = (res) => JSON.parse(res.body);

const GUILD = 'wolfpack';
const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const realRequireWith = (sb) => (p) => (p === './utils/supabase' ? sb : requireBot(p));

// ── the fake itself ────────────────────────────────────────────────────────────────────────────────
describe('the cap-enforcing fake (so the other tests mean something)', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, g: 'x' }));

  it('answers 1,000 rows whatever limit says — the production failure', async () => {
    const sb = makeCapFake({ tables: { t: rows } });
    expect(await sb.select('t', 'limit=5000')).toHaveLength(PGRST_MAX_ROWS);
    expect(await sb.select('t', 'limit=400')).toHaveLength(400);
    expect(await sb.select('t', '')).toHaveLength(PGRST_MAX_ROWS);
  });

  it('selectAllPaged drains it, on a composite order, with nothing repeated or skipped', async () => {
    const sb = makeCapFake({ tables: { t: rows } });
    const got = await sb.selectAllPaged('t', 'g=eq.x', 'g.desc,id');
    expect(got).toHaveLength(2500);
    expect(new Set(got.map(r => r.id)).size).toBe(2500);
  });

  it('pages a GET /rpc/<fn> result the same way, function arguments out of the query string', async () => {
    const sb = makeCapFake({ rpcs: { f: { args: ['p_n'], run: ({ p_n }) => Array.from({ length: Number(p_n) }, (_, i) => ({ k: i })) } } });
    const got = await sb.selectAllPaged('rpc/f', 'p_n=2300', 'k');
    expect(got).toHaveLength(2300);
  });
});

// ── JS stand-ins for the SQL (see the header of _cap_fake_supabase.js) ──────────────────────────────
const expired = (b, atMs) => (b.dur_ticks || 0) > 0 && Date.parse(b.cast_at) + b.dur_ticks * 6000 < atMs;
function latestBuffLandings(rows, { p_guild_id, p_since }) {
  const best = new Map();
  for (const b of rows) {
    if (b.guild_id !== p_guild_id || Date.parse(b.cast_at) < Date.parse(p_since) || expired(b, Date.now())) continue;
    const k = b.target + '|' + b.spell_name;
    const prev = best.get(k);
    if (!prev || Date.parse(b.cast_at) > Date.parse(prev.cast_at) || (b.cast_at === prev.cast_at && b.id > prev.id)) best.set(k, b);
  }
  return [...best.values()].map(({ target, spell_name, dur_ticks, cast_at }) => ({ target, spell_name, dur_ticks, cast_at }));
}
function recentDebuffLandings(rows, { p_guild_id, p_since }) {
  return rows.filter(b => b.guild_id === p_guild_id && Date.parse(b.cast_at) >= Date.parse(p_since) && !expired(b, Date.now()))
    .map(({ id, target, target_id, spell_name, dur_ticks, cast_at, observer, is_charm_spell }) =>
      ({ id, target, target_id, spell_name, dur_ticks, cast_at, observer, is_charm_spell }));
}
function encounterDamageByCharacter(players, { p_guild_id, p_since, p_limit }) {
  const by = new Map();
  for (const r of players) {
    if (r.encounters.guild_id !== p_guild_id || Date.parse(r.encounters.started_at) < Date.parse(p_since)) continue;
    const k = r.character_name.toLowerCase();
    const cur = by.get(k) || { character_name: r.character_name, total_damage: 0, encounters: 0, peak_dps: 0 };
    cur.total_damage += r.total_damage || 0; cur.encounters += 1; cur.peak_dps = Math.max(cur.peak_dps, r.dps || 0);
    by.set(k, cur);
  }
  const out = [...by.values()].sort((a, b) => b.total_damage - a.total_damage || a.character_name.localeCompare(b.character_name));
  return p_limit != null ? out.slice(0, Number(p_limit)) : out;
}
function familyDkpMirror(ticks, loot, { p_names }) {
  const names = Array.isArray(p_names) ? p_names : [];
  const fam = new Set(names.map(n => n.toLowerCase()));
  const out = new Map();
  const row = (nl) => { if (!out.has(nl)) out.set(nl, { name_lower: nl, earned: 0, spent: 0, fetched_at: null }); return out.get(nl); };
  const newer = (a, b) => (!a || Date.parse(b) > Date.parse(a) ? b : a);
  for (const t of ticks) {
    if (!(t.attendees || []).some(a => names.includes(a))) continue;               // attendees && p_names, exact case
    for (const a of t.attendees) if (fam.has(a.toLowerCase())) { const r = row(a.toLowerCase()); r.earned += t.value || 0; r.fetched_at = newer(r.fetched_at, t.fetched_at); }
  }
  for (const l of loot) {
    if (!fam.has(String(l.character_name).toLowerCase())) continue;
    const r = row(l.character_name.toLowerCase()); r.spent += l.dkp || 0; r.fetched_at = newer(r.fetched_at, l.fetched_at);
  }
  return [...out.values()];
}
function itemDropOwners(drops) {                                // the eqemu_item_drop_owner view
  const by = new Map();
  for (const d of drops) {
    if (!by.has(d.item_id)) by.set(d.item_id, new Map());
    by.get(d.item_id).set(d.npc_id, d.npc_name);
  }
  return [...by].map(([item_id, npcs]) => {
    const first = Math.min(...npcs.keys());
    return { item_id, npc_count: npcs.size, npc_id: first, npc_name: npcs.get(first) };
  });
}

// ── a raid: 50 raiders seen by 21 uploaders (1,051 roster rows), Aegolism buried under newer casts ───
// Aegolism landed 90 minutes ago, then three minutes of Spirit of Wolf spam (2,000 newer rows). The
// roster is one row per uploader x name; the 1,051st is a raider only the last uploader sees.
function raidFixture() {
  const raiders = Array.from({ length: 50 }, (_, i) => 'Raider' + pad(i + 1));
  const characters = [...raiders, 'Zedd'].map(name => ({ guild_id: GUILD, name, class: 'Warrior' }));
  const roster = [];
  for (let u = 1; u <= 21; u++) {
    for (const name of raiders) {
      roster.push({ guild_id: GUILD, uploaded_by_discord_id: 'u' + pad(u), name, class: 'Warrior', group_num: 1, rank: null,
        level: 65, hp_pct: 100, loc_x: 1, loc_y: 2, loc_z: 3, heading: 0, loc_at: ago(5_000), captured_at: ago(30_000) });
    }
  }
  roster.push({ guild_id: GUILD, uploaded_by_discord_id: 'u21', name: 'Zedd', class: 'Warrior', group_num: 2, rank: null,
    level: 65, hp_pct: 100, loc_x: 1, loc_y: 2, loc_z: 3, heading: 0, loc_at: ago(5_000), captured_at: ago(30_000) });

  const casts = [];
  let id = 1;
  for (const target of raiders) {
    casts.push({ id: id++, guild_id: GUILD, target, spell_name: 'Aegolism', dur_ticks: 1000, cast_at: ago(90 * MIN), observer: 'Raider01', target_id: null });
  }
  for (let rep = 0; rep < 40; rep++) {
    for (const target of raiders) {
      casts.push({ id: id++, guild_id: GUILD, target, spell_name: 'Spirit of Wolf', dur_ticks: 900, cast_at: ago(3 * MIN - rep * 4000), observer: 'Raider01', target_id: null });
    }
  }
  return { raiders, characters, roster, casts };
}

// ── 1 + 6 + 3. raid-buff-queue: the buff_casts window, the roster, the burst-queue damage ───────────
function buffQueueHandler(sb) {
  return loadBot('_handleAgentRaidBuffQueue', {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u01' }) },
    _keepRaidSplit: (split) => split,
    _raidGroups: requireBot('./utils/raidGroups'),
    _lastRaiderDeath: new Map(),
    _spellFxMap: async () => new Map(),
    _buffDetailFor: () => ({}),
    _castingOnTarget: () => [],
    _mgbTrainedSet: async () => new Set(),
    _CURSE_COUNTERS_FOR: () => 0,
    _debuffClearMarks: new Map(),
    _applyCuredCounters: () => {},
    _cureStateFor: () => ({ state: 'none' }),
    _CURE_RANK: { curse: 0, blind: 1, poison: 2, disease: 3 },
  });
}
async function callBuffQueue(sb, query) {
  delete globalThis._rbqBundleCache; delete globalThis._burstDmgCache;
  const res = mkRes();
  await buffQueueHandler(sb)({ url: '/api/agent/raid-buff-queue?' + query, headers: {} }, res);
  expect(res.status).toBe(200);
  return json(res);
}

describe('raid-buff-queue reads the whole window, not the newest 1,000 rows', () => {
  let fx, sb;
  beforeEach(() => {
    fx = raidFixture();
    sb = makeCapFake({
      tables: { raid_roster: fx.roster, characters: fx.characters, buff_casts: fx.casts },
      rpcs: { latest_buff_landings: { args: ['p_guild_id', 'p_since'], run: (a) => latestBuffLandings(fx.casts, a) } },
    });
  });

  it('the fixture really is past the cap (or the tests below prove nothing)', () => {
    expect(fx.casts.length).toBeGreaterThan(PGRST_MAX_ROWS * 2);
    expect(fx.roster.length).toBeGreaterThan(PGRST_MAX_ROWS);
  });

  it('a buff cast an hour ago is seen: nobody reads as missing Aegolism', async () => {
    const out = await callBuffQueue(sb, 'class=cleric&character=Raider01');
    const row = out.roster.find(r => r.name === 'Raider07');
    expect(row.buffs.map(b => b.n)).toContain('Aegolism');
    expect(row.hp_missing).toBe(1);   // slot C (Khura/Brell/...) is open; A and B are filled by Aegolism
    // the queue is built from the same buffs: no raider is told they lack HP slot A or B
    const hpGaps = out.buff_queue.filter(r => r.missing.some(m => /^HP\b/.test(m)));
    expect(hpGaps.map(r => r.name)).toEqual([]);
  });

  it('a raider only the last of 21 uploaders sees is on the roster (the roster read is paged)', async () => {
    const out = await callBuffQueue(sb, 'class=cleric&character=Raider01');
    expect(out.roster.map(r => r.name)).toContain('Zedd');
    expect(out.roster).toHaveLength(51);
  });

  it('a failed buff read is not a quiet raid: the handler answers, with no inferred buffs', async () => {
    const down = makeCapFake({ tables: { raid_roster: fx.roster, characters: fx.characters }, rpcs: {} });   // function missing → null
    const out = await callBuffQueue(down, 'class=cleric&character=Raider01');
    expect(out.roster.find(r => r.name === 'Raider07').buffs).toEqual([]);
  });
});

describe('the burst queue sums the whole 6 hours of damage', () => {
  it('a shaman sees every raider\'s damage, not the first thousand rows of it', async () => {
    const fx = raidFixture();
    // 3,000 encounter_players rows: 50 raiders x 60 fights, a raider's rows together, so Raider50 sits at
    // the END of the table and a capped read never reaches the heaviest hitters.
    const players = [];
    for (const [i, name] of fx.raiders.entries()) {
      for (let fight = 0; fight < 60; fight++) {
        players.push({ character_name: name, total_damage: 1000 * (i + 1), dps: 100 + i,
          encounters: { guild_id: GUILD, started_at: ago((fight + 1) * 4 * MIN) } });
      }
    }
    const sb = makeCapFake({
      tables: { raid_roster: fx.roster, characters: fx.characters, buff_casts: fx.casts, encounter_players: players },
      rpcs: {
        latest_buff_landings: { args: ['p_guild_id', 'p_since'], run: (a) => latestBuffLandings(fx.casts, a) },
        encounter_damage_by_character: { args: [], run: (p) => encounterDamageByCharacter(players, p) },
      },
    });
    const out = await callBuffQueue(sb, 'class=shaman&character=Raider01');
    // no shaman on the roster, so the queue is the top 3 needing Feral Avatar, most damage first
    expect(out.feral_queue.map(r => [r.name, r.damage])).toEqual([
      ['Raider50', 60 * 50_000], ['Raider49', 60 * 49_000], ['Raider48', 60 * 48_000],
    ]);
  });
});

// ── 2 + 6. Extended Target: the debuffs landed earlier, the roster positions ────────────────────────
function loadExtTarget(sb) {
  return loadBotMany([
    '_extAttributeDebuffs', '_extBindInstances', '_extDebuffInstances', '_extIdInstances', '_extMergeByAgreedId',
    '_extPlaceTags', '_extPosCluster', '_extHeadingPoint', '_mainAssistPin', '_isJunkSpellName', '_liveRaidSplit',
    '_handleAgentExtendedTarget',
  ], {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u01' }) },
    _overlayTuningMap: async () => ({}),
    _rosterNameSet: async () => new Set(),
    _keepRaidSplit: (split) => split,
    _raidGroups: requireBot('./utils/raidGroups'),
    _raidSplitCache: { at: 0, split: null },
    _mainAssistStore: { get: () => null },
    _extHurtSince: new Map(),
    _extMobLastSeen: new Map(),
    _JUNK_SPELL_RX: /^(kneel test)$/i,
    EXT_ONLINE_MS: 60_000, EXT_HURT_PCT: 85, EXT_HURT_MIN_MS: 10_000, EXT_HP_SPLIT_TOL: 8,
    EXT_POS_CLUSTER_UNITS: 25, EXT_POS_FRESH_MS: 30_000, EXT_STALE_GRACE_MS: 90_000, EXT_OFFTANK_FRESH_MS: 30_000,
  });
}

describe('Extended Target keeps the debuffs that landed earlier in the 30-minute window', () => {
  const MOB = 'Lord of the Test';
  function fixture() {
    const live = ['Raider01', 'Raider02', 'Raider03'].map(character => ({
      guild_id: GUILD, character, zone_name: 'Test Zone', self_hp_pct: 100, target_name: MOB, target_hp_pct: 70, target_id: null,
      pet_name: null, pet_hp_pct: null, incoming_mob: null, incoming_mob_since: null, loc_x: 1, loc_y: 2, loc_z: 3,
      observed_tanks: null, zeal_tags: null, updated_at: ago(3_000),
    }));
    // Malo landed 20 minutes ago and runs 100 minutes; then 2,000 newer Snare landings crowd it out of a
    // newest-600 read (a 30-minute window really holds up to ~4,250 rows).
    const casts = [{ id: 1, guild_id: GUILD, target: MOB, target_id: null, spell_name: 'Malo', dur_ticks: 1000, cast_at: ago(20 * MIN), observer: 'Raider01', is_charm_spell: false }];
    for (let i = 0; i < 2000; i++) {
      casts.push({ id: 2 + i, guild_id: GUILD, target: MOB, target_id: null, spell_name: 'Snare', dur_ticks: 100, cast_at: ago(8 * MIN - i * 200), observer: 'Raider01', is_charm_spell: false });
    }
    // and long-expired rows that a complete read still has to skip, not choke on
    for (let i = 0; i < 300; i++) {
      casts.push({ id: 5000 + i, guild_id: GUILD, target: MOB, target_id: null, spell_name: 'Old Debuff ' + i, dur_ticks: 5, cast_at: ago(25 * MIN), observer: 'Raider01', is_charm_spell: false });
    }
    return { live, casts, roster: raidFixture().roster };
  }
  async function call(sb) {
    delete globalThis._extBundleCache;
    const res = mkRes();
    await loadExtTarget(sb)._handleAgentExtendedTarget({ url: '/api/agent/extended-target?character=Raider01', headers: {} }, res);
    expect(res.status).toBe(200);
    return json(res);
  }

  it('the Malo that landed 20 minutes ago is on the mob; so is the recent Snare', async () => {
    const fx = fixture();
    const sb = makeCapFake({
      tables: { character_live_state: fx.live, buff_casts: fx.casts, raid_roster: fx.roster },
      rpcs: { recent_debuff_landings: { args: ['p_guild_id', 'p_since'], run: (a) => recentDebuffLandings(fx.casts, a) } },
    });
    const out = await call(sb);
    const mob = out.targets.find(t => t.name === MOB);
    expect(mob).toBeTruthy();
    const names = mob.debuffs.map(d => d.name);
    expect(names).toContain('Malo');
    expect(names).toContain('Snare');
    expect(names.some(n => /^Old Debuff/.test(n))).toBe(false);      // expired rows are dropped, as before
  });

  it('reads the roster positions page by page: the 1,051st row is requested', async () => {
    const fx = fixture();
    const sb = makeCapFake({
      tables: { character_live_state: fx.live, buff_casts: fx.casts, raid_roster: fx.roster },
      rpcs: { recent_debuff_landings: { args: ['p_guild_id', 'p_since'], run: (a) => recentDebuffLandings(fx.casts, a) } },
    });
    await call(sb);
    const rosterCalls = sb.calls.filter(c => c.kind === 'select' && c.table === 'raid_roster' && /loc_at=gte/.test(c.qs));
    expect(rosterCalls.some(c => /offset=1000\b/.test(c.qs))).toBe(true);
  });
});

// ── 6. the other raid_roster readers ────────────────────────────────────────────────────────────────
describe('the raid split sees every uploader', () => {
  it('a second raid whose rows sit past the first 1,000 is found', async () => {
    const rows = [];
    for (let u = 1; u <= 20; u++) {
      for (let n = 1; n <= 50; n++) {
        rows.push({ guild_id: GUILD, uploaded_by_discord_id: 'a' + pad(u), name: n === 1 ? 'LeaderA' : 'RaidA' + pad(n), rank: n === 1 ? 'Raid Leader' : null, captured_at: ago(10_000) });
      }
    }
    for (let n = 1; n <= 12; n++) {   // a second raid, one uploader, its rows after the 1,000th
      rows.push({ guild_id: GUILD, uploaded_by_discord_id: 'zz', name: n === 1 ? 'LeaderB' : 'RaidB' + pad(n), rank: n === 1 ? 'Raid Leader' : null, captured_at: ago(10_000) });
    }
    expect(rows.length).toBeGreaterThan(PGRST_MAX_ROWS);
    const sb = makeCapFake({ tables: { raid_roster: rows } });
    const { _liveRaidSplit } = loadBotMany(['_liveRaidSplit'], {
      _keepRaidSplit: (split) => split, _raidGroups: requireBot('./utils/raidGroups'), _raidSplitCache: { at: 0, split: null },
    });
    const split = await _liveRaidSplit(sb, GUILD);
    expect(split.multi).toBe(true);
    expect(split.raids).toHaveLength(2);
  });
});

describe('the auto-bid gate finds a family member standing in a 1,000-row roster', () => {
  it('Raider99 is the 1,051st roster row and still counts as in the raid', async () => {
    const fx = raidFixture();
    const roster = fx.roster.map(r => r);
    roster.push({ guild_id: GUILD, uploaded_by_discord_id: 'u22', name: 'Raider99', captured_at: ago(20_000) });
    const sb = makeCapFake({ tables: { raid_roster: roster } });
    const { _familyInRaidTonight } = loadBotMany(['_familyInRaidTonight'], {
      require: realRequireWith(sb),
      _AUTOBID_ROSTER_FRESH_MS: 15 * MIN,
      _bidFamilyNamesFor: async () => new Set(['raider99']),
      _raidNightStartIso: () => ago(6 * HOUR),
    });
    const out = await _familyInRaidTonight('Raider99');
    expect(out).toMatchObject({ ok: true, via: 'roster', character: 'Raider99' });
  });
});

// ── 4 + 5. the Mimic server panel: damage and threat ────────────────────────────────────────────────
function loadServerPanel(sb, extraInjected = {}) {
  const lootCache = sliceBlock(SRC, 'const _lootPanelCache = new Map();', '_lootPanelCache.delete(first); } }');
  return loadBotMany([
    '_ilikeAnyClause', '_resolveCharIdNames', '_mergeWishlist', '_pruneWonWishlist', '_buildMisses', '_lootItemSummary',
    '_eraFromPool', '_suggestFamily', '_familyDkpTotals', '_familyDkpFromMirror', '_lootCacheGet', '_lootCacheSet',
    '_handleAgentServerPanel',
  ], {
    require: realRequireWith(sb),
    mimicLink: { requireAgentAuth: async () => ({ discord_id: 'u01' }) },
    ...extraInjected,
  }, lootCache + '\n');
}
async function callPanel(sb, key, query = '') {
  const res = mkRes();
  await loadServerPanel(sb)._handleAgentServerPanel({ url: `/api/agent/server-panel/${key}?${query}`, headers: {} }, res);
  return res;
}

describe('server-panel damage is a real 30-day total', () => {
  it('sums every fight per character: the top 25 of 100 characters, not the 4 with the biggest single fights', async () => {
    const players = [];
    for (let i = 0; i < 100; i++) {
      for (let fight = 0; fight < 50; fight++) {
        players.push({ character_name: 'Raider' + pad(i + 1, 3), total_damage: 1000 * (i + 1), dps: 50 + i,
          encounters: { guild_id: GUILD, started_at: ago((fight + 1) * HOUR) } });
      }
    }
    expect(players.length).toBeGreaterThan(PGRST_MAX_ROWS);
    const sb = makeCapFake({
      tables: { encounter_players: players },
      rpcs: { encounter_damage_by_character: { args: [], run: (p) => encounterDamageByCharacter(players, p) } },
    });
    const res = await callPanel(sb, 'damage');
    expect(res.status).toBe(200);
    const { rows } = json(res);
    expect(rows).toHaveLength(25);
    expect(rows[0]).toEqual({ character: 'Raider100', totalDamage: 50 * 100_000, encounters: 50, peakDps: 149 });
    expect(rows[24].character).toBe('Raider076');
    expect(rows.map(r => r.totalDamage)).toEqual([...rows.map(r => r.totalDamage)].sort((a, b) => b - a));
  });
});

describe('server-panel threat reads the rank rollup, paged', () => {
  const rankRow = (over) => ({
    guild_id: GUILD, character_name: 'Raider01', boss_name: 'a_test_boss', boss_name_key: 'a_test_boss',
    started_at_key: ago(2 * HOUR), snapshots: 10, times_top1: 1, times_top3: 2, avg_rank: 2.4, avg_field: 11.6, ...over,
  });

  it('totals every fight in the window — more rows than the cap — and lists the 10 newest', async () => {
    const rows = [];
    for (let i = 0; i < 1200; i++) rows.push(rankRow({ boss_name_key: 'boss_' + pad(i, 4), boss_name: 'boss_' + pad(i, 4), started_at_key: ago((i + 1) * 10 * MIN) }));
    rows.push(rankRow({ character_name: 'Someone', snapshots: 999 }));                         // another character
    rows.push(rankRow({ guild_id: 'elsewhere', snapshots: 999 }));                              // another guild
    rows.push(rankRow({ started_at_key: ago(45 * DAY), snapshots: 999, boss_name_key: 'ancient' }));   // past the 30 days
    const sb = makeCapFake({ tables: { encounter_threat_rank: rows } });
    const res = await callPanel(sb, 'threat', 'character=Raider01');
    expect(res.status).toBe(200);
    const out = json(res);
    // 30 days of 10-minute steps holds 4,320 of them, all 1,200 inside it
    expect(out.snapshots).toBe(1200 * 10);
    expect(out.times_topped_threat).toBe(1200);
    expect(out.times_top3).toBe(2400);
    expect(out.scope).toBe('last 30d');
    expect(out.recent).toHaveLength(10);
    expect(out.recent[0]).toMatchObject({ boss: 'boss_0000', rank: 2, of: 12 });
    expect(out.recent.map(r => r.boss)).toEqual(Array.from({ length: 10 }, (_, i) => 'boss_' + pad(i, 4)));   // newest first
  });

  it('answers a raid-trash row (no boss name) by its key, and a quiet character with zeros', async () => {
    const sb = makeCapFake({ tables: { encounter_threat_rank: [rankRow({ boss_name: null, boss_name_key: '(raid trash)' })] } });
    expect(json(await callPanel(sb, 'threat', 'character=Raider01')).recent[0].boss).toBe('(raid trash)');
    const none = json(await callPanel(sb, 'threat', 'character=Nobody'));
    expect(none).toMatchObject({ snapshots: 0, times_topped_threat: 0, times_top3: 0, recent: [] });
  });
});

// ── 7. the mirror DKP ───────────────────────────────────────────────────────────────────────────────
describe('_familyDkpFromMirror counts every tick the family attended', () => {
  const FAMILY = ['Raider01', 'Raider01Alt'];
  const ticks = [];
  for (let i = 0; i < 1456; i++) {
    ticks.push({ tick_id: i + 1, value: 3, attendees: i < 500 ? ['Raider01', 'Raider01Alt', 'Other'] : ['Raider01', 'Other'], fetched_at: ago((1456 - i) * MIN) });
  }
  const loot = [
    { character_name: 'Raider01', dkp: 10, fetched_at: ago(HOUR) }, { character_name: 'raider01alt', dkp: 25, fetched_at: ago(2 * HOUR) },
    { character_name: 'Other', dkp: 99, fetched_at: ago(HOUR) },
  ];
  const adjustments = [{ raw: { Character: { Name: 'Raider01' }, Value: -15 }, fetched_at: ago(3 * HOUR) }];
  const fns = (sb) => loadBotMany(['_familyDkpTotals', '_familyDkpFromMirror'], { require: realRequireWith(sb) });

  it('earned is every tick (3 DKP x 1,456 for the main, x 500 for the alt), not the first 1,000', async () => {
    const sb = makeCapFake({
      tables: { opendkp_ticks: ticks, opendkp_loot: loot, opendkp_adjustments: adjustments },
      rpcs: { family_dkp_mirror: { args: [], run: (p) => familyDkpMirror(ticks, loot, p) } },
    });
    const out = await fns(sb)._familyDkpFromMirror(FAMILY);
    const earned = 3 * 1456 + 3 * 500;
    expect(out.earned).toBe(earned);
    expect(out.spent).toBe(35);
    expect(out.adjustments).toBe(-15);
    expect(out.family_total).toBe(earned - 15 - 35);
    expect(out.per_character.Raider01).toMatchObject({ earned: 3 * 1456, spent: 10 });
    expect(out.per_character.Raider01Alt).toMatchObject({ earned: 3 * 500, spent: 25 });
    expect(out.fetched_at).toBe(ticks[1455].fetched_at);      // the newest mirror row that contributed
  });

  it('a failed read is an error, never a family that earned nothing', async () => {
    const sb = makeCapFake({ tables: { opendkp_adjustments: adjustments }, rpcs: {} });    // function missing → null
    await expect(fns(sb)._familyDkpFromMirror(FAMILY)).rejects.toThrow(/family_dkp_mirror/);
  });
});

// ── 8. bid history and item history ─────────────────────────────────────────────────────────────────
// bid-history also reads the pooled DKP (family_dkp_mirror); these cases are about the bids, so it answers none.
const NO_DKP = { family_dkp_mirror: { args: [], run: () => [] } };

describe('bid-history misses are built from every bid, not the first 1,000', () => {
  it('a family with 1,300 bids on 1,300 auctions: the 60 newest losses are the newest, wherever they sit', async () => {
    const bids = [], auctions = [];
    for (let i = 1; i <= 1300; i++) {
      bids.push({ id: i, auction_id: 70000 + i, character_id: 501, character_name: 'Raider01', user_login: 'raiderlogin', value: 10 });
      // later bid ids are later auctions: the newest 60 losses live in rows 1,241-1,300, past the cap
      auctions.push({ auction_id: 70000 + i, item_id: 90000 + i, item_name: 'Item ' + i, winner: 'someoneelse', winner_character_id: 999,
        bid_amount: 20, end_at: ago((1301 - i) * 5 * MIN), raid_id: 1000 + i });
    }
    const sb = makeCapFake({ tables: { opendkp_auction_bids: bids, opendkp_auctions: auctions }, rpcs: NO_DKP });
    const res = await callPanel(sb, 'bid-history', 'characters=Raider01&login=raiderlogin');
    expect(res.status).toBe(200);
    const { misses } = json(res);
    expect(misses).toHaveLength(60);
    expect(misses[0].item_id).toBe(90000 + 1300);
    expect(misses[59].item_id).toBe(90000 + 1241);
  }, 30_000);
});

describe('bid-history: the lookups behind the misses and the wins read every row', () => {
  it('a won auction\'s character is named from the loot of its raid, even when that loot row is the 1,100th', async () => {
    const loot = [];
    for (let i = 1; i <= 1099; i++) loot.push({ id: i, raid_id: 5000, item_id: 10000 + i, character_name: 'Filler' + (i % 40), dkp: 1 });
    loot.push({ id: 1100, raid_id: 5000, item_id: 70001, character_name: 'Aldenmar', dkp: 12 });
    const sb = makeCapFake({
      tables: {
        opendkp_auction_bids: [{ id: 1, auction_id: 80001, character_id: 501, character_name: 'Aldenmar', user_login: 'aldenlogin', value: 5 }],
        opendkp_auctions: [{ auction_id: 80001, item_id: 70001, item_name: 'Won Item', winner: 'aldenlogin', winner_character_id: 501, raid_id: 5000, end_at: ago(DAY) }],
        opendkp_loot: loot, characters: [],              // no characters.opendkp_id: the loot inference is the only name source
      },
      rpcs: NO_DKP,
    });
    const res = await callPanel(sb, 'bid-history', 'characters=Aldenmar&login=aldenlogin');
    expect(res.status).toBe(200);
    expect(json(res).suggested_family).toEqual({ main: 'Aldenmar', alts: [] });
  });

  it('every item carries its era and raid link: 150 items x 10 auctions is 1,500 rows, newest first', async () => {
    const wins = [], auctions = [], raids = [];
    for (let item = 1; item <= 150; item++) {
      wins.push({ id: item, raid_id: 100 + item, item_id: 60000 + item, item_name: 'Item ' + item, character_name: 'Aldenmar', dkp: 5, fetched_at: ago(HOUR) });
      raids.push({ raid_id: 6000 + item, pool_name: 'SoL' });
      // item 1's auctions are the newest, item 150's the oldest: a newest-1,000 read loses the last 50 items
      for (let a = 0; a < 10; a++) {
        auctions.push({ auction_id: item * 100 + a, item_id: 60000 + item, raid_id: 6000 + item, end_at: ago(item * DAY + a * HOUR) });
      }
    }
    const sb = makeCapFake({ tables: { opendkp_loot: wins, opendkp_auctions: auctions, opendkp_raids: raids }, rpcs: NO_DKP });
    const res = await callPanel(sb, 'bid-history', 'characters=Aldenmar');
    expect(res.status).toBe(200);
    const out = json(res);
    expect(out.wins).toHaveLength(150);
    expect(out.wins.filter(w => w.era !== 'Luclin').map(w => w.item_id)).toEqual([]);
  });

  it('every miss carries the item\'s last winning bid: 60 items x 30 settled auctions is 1,800 rows', async () => {
    const bids = [], auctions = [];
    for (let item = 1; item <= 60; item++) {
      bids.push({ id: item, auction_id: item * 100, character_id: 501, character_name: 'Aldenmar', user_login: 'aldenlogin', value: 4 });
      for (let a = 0; a < 30; a++) {
        auctions.push({ auction_id: item * 100 + a, item_id: 40000 + item, item_name: 'Item ' + item, winner: 'w' + a, winner_character_id: 999,
          bid_amount: 10 + a, end_at: ago(item * DAY + a * HOUR), raid_id: 4000 + item });
      }
    }
    expect(auctions.length).toBeGreaterThan(PGRST_MAX_ROWS);
    const sb = makeCapFake({ tables: { opendkp_auction_bids: bids, opendkp_auctions: auctions }, rpcs: NO_DKP });
    const res = await callPanel(sb, 'bid-history', 'characters=Aldenmar&login=aldenlogin');
    expect(res.status).toBe(200);
    const { misses } = json(res);
    expect(misses).toHaveLength(60);
    expect(misses.filter(m => m.last_winning_bid !== 10).map(m => m.item_id)).toEqual([]);   // the newest auction of every item
  });
});

describe('item-history answers every item asked about', () => {
  it('60 items x 30 settled auctions each: all 60 come back, not just the ones with the newest auctions', async () => {
    const auctions = [];
    for (let item = 1; item <= 60; item++) {
      for (let a = 0; a < 30; a++) {
        auctions.push({ auction_id: item * 100 + a, item_id: 50000 + item, item_name: 'Item ' + item, winner: 'w' + a, bid_amount: 10 + a,
          // item 1's auctions are the newest, item 60's the oldest: a newest-400 read stops near item 14
          end_at: ago(item * DAY + a * HOUR) });
      }
    }
    expect(auctions.length).toBeGreaterThan(PGRST_MAX_ROWS);
    const sb = makeCapFake({ tables: { opendkp_auctions: auctions } });
    const ids = Array.from({ length: 60 }, (_, i) => 50001 + i);
    const res = await callPanel(sb, 'item-history', 'items=' + ids.join(','));
    expect(res.status).toBe(200);
    const { items } = json(res);
    expect(items.map(i => i.item_id).sort((a, b) => a - b)).toEqual(ids);
    // and each is its MOST RECENT settled auction: a = 0 is the newest of an item's thirty
    expect(items.find(i => i.item_id === 50060).winner).toBe('w0');
  });
});

// ── 9. who drops an item ────────────────────────────────────────────────────────────────────────────
// Three items: A is dropped by 1,500 NPCs, B by exactly one, C by two. The table is ordered so a 1,000-row
// read sees only A, and C's two rows sit one before A and one after it.
function dropFixture() {
  const drops = [{ item_id: 5003, npc_id: 3001, npc_name: 'a_first_npc' }];
  for (let n = 0; n < 1500; n++) drops.push({ item_id: 5001, npc_id: 100000 + n, npc_name: 'npc_' + n });
  drops.push({ item_id: 5002, npc_id: 4001, npc_name: 'the_only_npc' });
  drops.push({ item_id: 5003, npc_id: 3002, npc_name: 'a_second_npc' });
  return drops;
}

describe('the loot fold attributes an item from its NPC count, not from a cut list', () => {
  it('B (one NPC) is confident, A (1,500) and C (two) are ambiguous', async () => {
    const drops = dropFixture();
    const awards = [
      { id: 1, raid_id: 7000, item_id: 5001, game_item_id: 5001, item_name: 'Item A', character_name: 'Raider01', dkp: 10 },
      { id: 2, raid_id: 7000, item_id: 5002, game_item_id: 5002, item_name: 'Item B', character_name: 'Raider02', dkp: 20 },
      { id: 3, raid_id: 7000, item_id: 5003, game_item_id: 5003, item_name: 'Item C', character_name: 'Raider03', dkp: 30 },
    ];
    const sb = makeCapFake({
      tables: {
        opendkp_loot: awards, loot_observations: [], opendkp_raids: [{ raid_id: 7000, ts: ago(DAY) }],
        eqemu_items: [{ id: 5001, name: 'Item A' }, { id: 5002, name: 'Item B' }, { id: 5003, name: 'Item C' }],
        eqemu_npc_drops: drops, eqemu_item_drop_owner: () => itemDropOwners(drops),
      },
    });
    const sync = loadFile(path.join(ROOT, 'utils', 'openDkpSync.js'), { './supabase': sb });
    const out = await sync.foldLootObservations({ dryRun: true });
    expect(out).toMatchObject({ dry_run: true, confident: 1, ambiguous: 2, unknown: 0 });
  });

  it('a failed drop-owner read writes nothing: filing a chunk as unknown would stick', async () => {
    const sb = makeCapFake({
      tables: {
        opendkp_loot: [{ id: 1, raid_id: 7000, item_id: 5002, game_item_id: 5002, item_name: 'Item B', character_name: 'Raider02', dkp: 20 }],
        loot_observations: [], opendkp_raids: [{ raid_id: 7000, ts: ago(DAY) }], eqemu_items: [{ id: 5002, name: 'Item B' }],
      },
      missing: ['eqemu_item_drop_owner'],             // the view is not there yet, or the read timed out
    });
    const sync = loadFile(path.join(ROOT, 'utils', 'openDkpSync.js'), { './supabase': sb });
    const out = await sync.foldLootObservations({});
    expect(out).toEqual({ skipped: 'drop owner read failed' });
    expect(sb.calls.filter(c => c.kind === 'insert')).toEqual([]);
  });
});

describe('/backfillopendkploot attributes an item from its NPC count', () => {
  it('runs the shipped attribution block: B owned by its one NPC, A and C ambiguous', async () => {
    const src = readSource(path.join(ROOT, 'commands', 'backfillopendkploot.js'));
    const block = sliceBlock(src, 'const distinctIds =', 'const dropOwnerByItem = new Map();   // item_id → { npc_id, npc_name } | null') + '\n'
      + sliceBlock(src, '// PostgREST `in.()` filter', "console.warn('[backfillopendkploot] drops lookup failed:', err?.message);\n      }\n    }");
    const drops = dropFixture();
    const sb = makeCapFake({ tables: { eqemu_npc_drops: drops, eqemu_item_drop_owner: () => itemDropOwners(drops) } });
    // eslint-disable-next-line no-new-func
    const run = new Function('supabase', 'awarded', 'return (async () => {\n' + block + '\nreturn dropOwnerByItem;\n})();');
    const owners = await run(sb, [5001, 5002, 5003].map(item_id => ({ item_id })));
    expect(owners.get(5002)).toEqual({ npc_id: 4001, npc_name: 'the_only_npc' });
    expect(owners.get(5001)).toBeNull();
    expect(owners.get(5003)).toBeNull();
  });

  it('a failed drop-owner read stops with a reply instead of filing the awards as unknown', async () => {
    const src = readSource(path.join(ROOT, 'commands', 'backfillopendkploot.js'));
    const block = sliceBlock(src, 'const distinctIds =', 'const dropOwnerByItem = new Map();   // item_id → { npc_id, npc_name } | null') + '\n'
      + sliceBlock(src, '// PostgREST `in.()` filter', "console.warn('[backfillopendkploot] drops lookup failed:', err?.message);\n      }\n    }");
    const sb = makeCapFake({ missing: ['eqemu_item_drop_owner'] });
    const replies = [];
    // eslint-disable-next-line no-new-func
    const run = new Function('supabase', 'awarded', 'interaction', 'return (async () => {\n' + block + '\nreturn dropOwnerByItem;\n})();');
    const out = await run(sb, [{ item_id: 5002 }], { editReply: async (m) => { replies.push(m); return 'replied'; } });
    expect(out).toBe('replied');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/nothing was written/);
  });
});

describe('Mob Info: "unique to this mob" counts every NPC that drops the item', () => {
  it('the item with a single dropper is unique; the one cut off by a 1,000-row read is not', async () => {
    const block = sliceBlock(SRC, 'const cands = await supabase.select(', 'it.unique_to_mob  = (n === 1);') + '\n}\n}';
    const drops = dropFixture();
    const sb = makeCapFake({ tables: { eqemu_npc_drops: drops, eqemu_item_drop_owner: () => itemDropOwners(drops) } });
    const loot = [5001, 5002, 5003].map(id => ({ id }));
    // eslint-disable-next-line no-new-func
    await new Function('supabase', 'itemIds', 'loot', 'return (async () => {' + block + '})();')(sb, loot.map(l => l.id), loot);
    expect(loot.map(l => [l.id, l.candidate_npcs, l.unique_to_mob])).toEqual([[5001, 1500, false], [5002, 1, true], [5003, 2, false]]);
  });
});

// ── 10. loot and roll windows ───────────────────────────────────────────────────────────────────────
// roll_to differs per set: sets of one range that start within minutes of each other are ONE session
// (mergeRollSetRows), and these fixtures need a thousand distinct ones.
const rollSet = (i, started) => ({
  roll_from: 0, roll_to: 100 + i, item: 'Item ' + i, qty: 1, zone: 'Test Zone', started_at: started, last_at: started,
  rolls: [{ name: 'Raider01', value: 50, at: started }, { name: 'Raider02', value: 40, at: started }],
});

describe('the night-loot panel reads the whole 12 hours', () => {
  it('1,100 roll sets and 1,100 looted rows come back in full, newest first', async () => {
    const { _nightLootPanelBody } = loadBotMany(['_nightLootPanelBody'], { require: requireBot });
    const rolls = [], looted = [];
    for (let i = 0; i < 1100; i++) {
      rolls.push({ id: 'r' + pad(i, 5), guild_id: GUILD, ...rollSet(i, ago(20 * MIN + i * 4000)) });
      looted.push({ id: i + 1, guild_id: GUILD, looter_character: 'Raider01', item_name: 'Item ' + i, zone: 'Test Zone', looted_at: ago(20 * MIN + i * 4000) });
    }
    const sb = makeCapFake({ tables: { roll_sets: rolls, looted_items: looted } });
    const out = await _nightLootPanelBody(sb, GUILD);
    // loot_total is the true count behind "showing 200 of N": a newest-500 read could never say more than 500
    expect(out.loot_total).toBe(1100);
    expect(out.loot).toHaveLength(200);
    expect(out.loot[0].item).toBe('Item 0');                                   // newest first
    expect(out.sessions).toHaveLength(100);
    expect(out.sessions[0].item).toBe('Item 0');
    // both reads walked past the first 1,000 rows
    for (const table of ['roll_sets', 'looted_items']) {
      expect(sb.calls.some(c => c.table === table && /offset=1000\b/.test(c.qs))).toBe(true);
    }
  }, 30_000);
});

describe('the event roll card counts every roll in the event window', () => {
  it('1,200 roll sets: the footer says 1200 captured, not 300', async () => {
    const posted = [];
    const thread = { id: 'th1', messages: { fetch: async () => { throw new Error('none'); } }, send: async (m) => { posted.push(m); return { id: 'm1' }; } };
    const { _refreshEventRollCardNow } = loadBotMany(['_refreshEventRollCardNow'], {
      client: {},
      require: (p) => {
        if (p === './utils/supabase') return sb;
        if (p === './utils/raidNight') return { getRaidNightTarget: async () => ({ thread, kind: 'event', event: { title: 'Test Event', startMs: Date.now() - 5 * HOUR, window: { fromMs: Date.now() - 5 * HOUR } } }) };
        if (p === './utils/state') return { getEventRollCardId: () => null, setEventRollCardId() {} };
        return requireBot(p);
      },
    });
    const rolls = [];
    for (let i = 0; i < 1200; i++) rolls.push({ id: 'r' + pad(i, 5), guild_id: GUILD, ...rollSet(i, ago(4 * HOUR - i * 10_000)) });
    const sb = makeCapFake({ tables: { roll_sets: rolls, looted_items: [] } });
    await _refreshEventRollCardNow();
    expect(posted).toHaveLength(1);
    expect(posted[0].embeds[0].data.footer.text).toMatch(/^1200 rolls captured/);
  }, 30_000);
});

describe('Hot Dice night counts every set of the night', () => {
  it('a dominant roller whose wins sit in rows 1,001-1,500 is still awarded', async () => {
    const tz = requireBot('./utils/timezone');
    const p = tz.nowPartsInTz(tz.getDefaultTz());
    const todayStart = tz.localToUTC(p.year, p.month, p.day, 0, 0, tz.getDefaultTz());
    const noonYesterday = todayStart.getTime() - 12 * HOUR;
    const rolls = [];
    // 1,000 contested sets that five rollers share evenly (nobody passes the 20% line on these alone) ...
    const five = ['Raider01', 'Raider02', 'Raider03', 'Raider04', 'Raider05'];
    for (let i = 0; i < 1000; i++) {
      const winner = five[i % 5], loser = 'Loser' + (i % 7);
      const t = new Date(noonYesterday + i * 1000).toISOString();
      rolls.push({ id: 'id' + pad(i, 5), guild_id: GUILD, roll_from: 0, roll_to: 100 + i, started_at: t, rolls: [{ name: winner, value: 90, at: t }, { name: loser, value: 10, at: t }] });
    }
    // ... then 500 more that one character wins, past the cap
    for (let i = 1000; i < 1500; i++) {
      const t = new Date(noonYesterday + i * 1000).toISOString();
      rolls.push({ id: 'id' + pad(i, 5), guild_id: GUILD, roll_from: 0, roll_to: 100 + i, started_at: t, rolls: [{ name: 'Corvale', value: 99, at: t }, { name: 'Loser' + (i % 7), value: 1, at: t }] });
    }
    const upserts = [];
    const sb = makeCapFake({ tables: { roll_sets: rolls } });
    sb.upsert = async (table, rows) => { upserts.push({ table, rows }); return rows; };
    const { computeHotDiceNightAward } = loadBotMany(['computeHotDiceNightAward'], {
      require: realRequireWith(sb),
      computeHotDiceNight: requireBot('./utils/hotDiceNight').computeHotDiceNight,
      getDefaultTz: tz.getDefaultTz, localToUTC: tz.localToUTC, nowPartsInTz: tz.nowPartsInTz,
    });
    await computeHotDiceNightAward();
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows[0]).toMatchObject({ event_type: 'hot_dice_night', caster: 'Corvale' });
  }, 30_000);
});

// ── the migration ───────────────────────────────────────────────────────────────────────────────────
describe('migration 20261004140200_cap_safe_reads.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261004140200_cap_safe_reads.sql');
  const sql = stripSql(fs.readFileSync(file, 'utf8'));

  it('creates every object the bot now calls, idempotently', () => {
    for (const fn of ['latest_buff_landings', 'recent_debuff_landings', 'encounter_damage_by_character', 'family_dkp_mirror']) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
    expect(sql).toMatch(/create or replace view public\.eqemu_item_drop_owner\s+with \(security_invoker = true\)/);
    expect(sql).not.toMatch(/\bcreate (function|view|table)\b/);               // every create is `or replace`
  });

  it('is read-only: no table is written, dropped or altered', () => {
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
  });

  it('is SECURITY INVOKER with a pinned search_path, and stable (GET /rpc needs it for paging)', () => {
    const fns = sql.split(/create or replace function/).slice(1);
    expect(fns).toHaveLength(4);
    for (const f of fns) {
      expect(f).toMatch(/\bstable\b/);
      expect(f).toMatch(/security invoker/);
      expect(f).toMatch(/set search_path = public/);
      expect(f).not.toMatch(/security definer/i);
    }
  });

  it('grants execute to service_role only', () => {
    for (const sig of ['latest_buff_landings\\(text, timestamptz\\)', 'recent_debuff_landings\\(text, timestamptz\\)',
      'encounter_damage_by_character\\(text, timestamptz, integer\\)', 'family_dkp_mirror\\(text\\[\\]\\)']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from public;`));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from anon;`));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig} to service_role;`));
    }
    expect(sql).toMatch(/grant select on public\.eqemu_item_drop_owner to service_role;/);
    expect(sql).not.toMatch(/to (anon|authenticated|public)\b/);
  });

  it('latest_buff_landings keeps the handler\'s expiry test and the newest row per (target, spell)', () => {
    const f = sql.slice(sql.indexOf('create or replace function public.latest_buff_landings'), sql.indexOf('create or replace function public.recent_debuff_landings'));
    expect(f).toMatch(/distinct on \(b\.target, b\.spell_name\)/);
    expect(f).toMatch(/order by b\.target, b\.spell_name, b\.cast_at desc/);
    expect(f).toMatch(/coalesce\(b\.dur_ticks, 0\) <= 0\s+or b\.cast_at \+ b\.dur_ticks \* interval '6 seconds' >= now\(\)/);
  });

  it('family_dkp_mirror counts a tick once per attending family character, like the JS it replaced', () => {
    const f = sql.slice(sql.indexOf('create or replace function public.family_dkp_mirror'), sql.indexOf('create or replace view'));
    expect(f).toMatch(/t\.attendees && p_names/);
    expect(f).toMatch(/cross join lateral unnest\(t\.attendees\)/);
    expect(f).toMatch(/group by lower\(a\)/);
  });

  it('every object the bot calls is one the migration creates', () => {
    const code = stripJs(SRC) + stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'openDkpSync.js'), 'utf8'))
      + stripJs(fs.readFileSync(path.join(ROOT, 'commands', 'backfillopendkploot.js'), 'utf8'));
    const called = new Set();
    for (const m of code.matchAll(/(?:rpc\(|selectAllPaged\()'(?:rpc\/)?(latest_buff_landings|recent_debuff_landings|encounter_damage_by_character|family_dkp_mirror)'/g)) called.add(m[1]);
    expect([...called].sort()).toEqual(['encounter_damage_by_character', 'family_dkp_mirror', 'latest_buff_landings', 'recent_debuff_landings']);
    expect(code).toMatch(/select\('eqemu_item_drop_owner'/);
  });
});
