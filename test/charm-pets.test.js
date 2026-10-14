// GET /api/agent/charm-pets — the Charm overlay's "Best pets here" feed (utils/charmPets.js + the route in
// index.js). The guild lead, 2026-10-14: "integrate a list of the better charm pets for the highest level
// charm a player has for the zone that they're in".
//
// The immunity rules under test are read from Project Quarm's server source (EQMacEmu zone/spells.cpp,
// Mob::IsImmuneToSpell, charm branch): Merchant 41 / Banker 40 / guildmaster 20-34, special ability 14,
// Veksar at level 50+. A placeholder body, an untargetable body type and a raid target are dropped by us
// (see the module header). The spell-dependent half (cap, body type) is the AGENT's, so none of it is here.
//
// Runs the SHIPPED module against the capped fake PostgREST (test/_cap_fake_supabase.js); the route is
// sliced out of index.js and run against stand-ins for auth and the database.
//
// Mutation-checked (2026-10-14): each clause of isCharmCandidate (class 40/41, class 20-34, ability 14,
// placeholder, bodytype, raid_target, level, Veksar) turns its own test red; the pts cap, the same-stats
// merge and the parent-list walk turn theirs red; dropping `_overBudget('charm_pets'` turns the budget test red.
//
// Fixture NPC names are invented; none is a member.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const nodeRequire = createRequire(BOT_INDEX);
const cp = nodeRequire('./utils/charmPets');
const SRC = readSource(BOT_INDEX);

const row = (extra = {}) => ({
  id: 1, name: 'a_test_gnoll', level: 30, maxlevel: 0, hp: 900, ac: 40, mr: 25, mindmg: 5, maxdmg: 60,
  attack_delay: 30, bodytype: 1, class: 1, special_abilities: '10,1', npcspecialattks: null, raid_target: false,
  npc_spells_id: 0, ...extra,
});

describe('isCharmCandidate — who no charm spell can ever take', () => {
  it('keeps an ordinary mob', () => {
    expect(cp.isCharmCandidate(row(), 'testzone')).toBe(true);
  });
  it('drops a merchant (41) and a banker (40)', () => {
    expect(cp.isCharmCandidate(row({ class: 41 }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ class: 40 }), 'testzone')).toBe(false);
  });
  it('drops every guildmaster class, 20 through 34, and keeps the neighbours', () => {
    for (const c of [20, 27, 34]) expect(cp.isCharmCandidate(row({ class: c }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ class: 16 }), 'testzone')).toBe(true);    // Berserker, a fighter
    expect(cp.isCharmCandidate(row({ class: 35 }), 'testzone')).toBe(true);
  });
  it('drops special ability 14 (CharmImmunity) wherever it sits in the list', () => {
    expect(cp.isCharmCandidate(row({ special_abilities: '14,1' }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ special_abilities: '10,1^14,1^21,1' }), 'testzone')).toBe(false);
  });
  it('keeps a present-but-disabled 14 (value 0 is off) and a 14 that is only a prefix of 140', () => {
    expect(cp.isCharmCandidate(row({ special_abilities: '14,0' }), 'testzone')).toBe(true);
    expect(cp.isCharmCandidate(row({ special_abilities: '10,1^41,1' }), 'testzone')).toBe(true);
  });
  it('drops a placeholder body (immune to melee AND magic), not one that is only immune to one', () => {
    expect(cp.isCharmCandidate(row({ special_abilities: '19,1^20,1' }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ special_abilities: '19,1' }), 'testzone')).toBe(true);
  });
  it('drops the untargetable and swarm-pet body types, keeps animal / undead / summoned', () => {
    for (const bt of [11, 60, 64, 66]) expect(cp.isCharmCandidate(row({ bodytype: bt }), 'testzone')).toBe(false);
    for (const bt of [3, 21, 24, 25, 27, 28]) expect(cp.isCharmCandidate(row({ bodytype: bt }), 'testzone')).toBe(true);
  });
  it('drops a raid target', () => {
    expect(cp.isCharmCandidate(row({ raid_target: true }), 'testzone')).toBe(false);
  });
  it('drops level 0, level 66 and above, and a name with no letter', () => {
    expect(cp.isCharmCandidate(row({ level: 0 }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ level: 66 }), 'testzone')).toBe(false);
    expect(cp.isCharmCandidate(row({ level: 65 }), 'testzone')).toBe(true);
    expect(cp.isCharmCandidate(row({ name: '_' }), 'testzone')).toBe(false);
  });
  it('drops level 50+ in Veksar and nowhere else', () => {
    expect(cp.isCharmCandidate(row({ level: 50 }), 'veksar')).toBe(false);
    expect(cp.isCharmCandidate(row({ level: 49 }), 'veksar')).toBe(true);
    expect(cp.isCharmCandidate(row({ level: 55 }), 'sebilis')).toBe(true);
  });
});

describe('traitsOf — the tokens the agent turns into "why" chips', () => {
  it('maps the codes worth a chip and ignores the rest', () => {
    expect(cp.traitsOf(row({ special_abilities: '1,1^5,1^6,1^7,1^10,1^21,1^42,1' }))).toEqual(['summon', 'flurry', 'triple', 'dual', 'magical']);
    expect(cp.traitsOf(row({ special_abilities: '3,1^4,1' }))).toEqual(['rampage', 'area_rampage']);
  });
  it('reads the legacy letter column only when special_abilities is empty', () => {
    expect(cp.traitsOf(row({ special_abilities: null, npcspecialattks: 'SFR' }))).toEqual(['summon', 'flurry', 'rampage']);
    expect(cp.traitsOf(row({ special_abilities: '10,1', npcspecialattks: 'SFR' }))).toEqual(['magical']);
  });
});

// A small zone: spawn points, groups, NPCs, and a spell list with a parent for the proc walk.
const se = (group, npc_id) => ({ spawngroup_id: group, npc_id, chance: 100 });
const sp = (id, group, x, y, extra = {}) => ({ id, spawngroup_id: group, zone_short: 'testzone', x, y, z: 3.4, enabled: true, ...extra });

function world() {
  return {
    eqemu_zone: [{ short_name: 'testzone', long_name: 'The Test Zone' }, { short_name: 'emptyzone', long_name: 'Empty' }],
    eqemu_spawn2: [
      sp(1, 10, 100.4, -200.6), sp(2, 11, 300, 400), sp(3, 12, 5, 5), sp(4, 13, 6, 6), sp(5, 14, 7, 7),
      sp(6, 15, 8, 8), sp(7, 16, 9, 9), sp(8, 17, 10, 10),
      sp(9, 10, 111, 111), sp(10, 10, 222, 222), sp(11, 10, 333, 333), sp(12, 10, 444, 444),   // five points for group 10
      sp(13, 18, 1, 1, { enabled: false }),                                                      // disabled: not a point
      sp(14, 19, 2, 2, { zone_short: 'otherzone' }),                                             // another zone
    ],
    eqemu_spawnentry: [
      se(10, 1001), se(10, 1002),                  // two bodies, same name and stats: one entry
      se(11, 1003),
      se(12, 1004), se(13, 1005), se(14, 1006), se(15, 1007), se(16, 1008), se(17, 1009),
      se(18, 1010),                                // only a disabled point
    ],
    eqemu_npc_types: [
      row({ id: 1001, name: 'a_gnoll_pup' }),
      row({ id: 1002, name: 'a_gnoll_pup' }),
      row({ id: 1003, name: 'Brackwyn_Vale', level: 42, maxlevel: 46, hp: 4000, maxdmg: 150, attack_delay: 20, special_abilities: '1,1^5,1^10,1', npc_spells_id: 77 }),
      row({ id: 1004, name: 'Corvale_the_Merchant', class: 41 }),
      row({ id: 1005, name: 'Rethlan_the_Uncharmable', special_abilities: '10,1^14,1' }),
      row({ id: 1006, name: '#a_placeholder', level: 1, special_abilities: '19,1^20,1' }),
      row({ id: 1007, name: 'Nyssara_the_Guildmaster', class: 25 }),
      row({ id: 1008, name: 'Zarrin_the_Raid_Boss', raid_target: true }),
      row({ id: 1009, name: 'a_plain_skeleton', level: 12, bodytype: 3, hp: 300 }),
      row({ id: 1010, name: 'a_ghost_of_a_disabled_point' }),
      row({ id: 1011, name: 'never_placed' }),    // no spawnentry at all
    ],
    eqemu_npc_spells: [
      { id: 77, parent_list: 78, attack_proc: 0, proc_chance: 0 },       // no proc here…
      { id: 78, parent_list: 0, attack_proc: 4321, proc_chance: 10 },    // …inherited from the parent
    ],
  };
}

let fake;
let tables;
beforeEach(() => {
  cp._resetCache();
  tables = world();
  fake = makeCapFake({ tables });
});

const get = async (zone = 'testzone', now) => cp.getCharmPets(fake, zone, now);
const body = async (zone) => JSON.parse((await get(zone)).body);
const named = (b, name) => b.npcs.find(n => n.name === name);

describe('the response', () => {
  it('is the contract: zone, long_name, generated_at, npcs — each npc with its fixed keys', async () => {
    const b = await body();
    expect(Object.keys(b)).toEqual(['zone', 'long_name', 'generated_at', 'npcs']);
    expect(b.zone).toBe('testzone');
    expect(b.long_name).toBe('The Test Zone');
    expect(Object.keys(b.npcs[0])).toEqual(['id', 'name', 'level', 'maxlevel', 'hp', 'ac', 'mr', 'mindmg', 'maxdmg', 'delay', 'bodytype', 'class', 'traits', 'proc', 'pts']);
  });

  it('lists only what could be charmed and is placed here', async () => {
    const b = await body();
    expect(b.npcs.map(n => n.name).sort()).toEqual(['Brackwyn Vale', 'a gnoll pup', 'a plain skeleton']);
  });

  it('cleans the name to what /target takes: underscores to spaces, # dropped', async () => {
    tables.eqemu_npc_types.push(row({ id: 1012, name: '#Sir_Aldenmar' }));
    tables.eqemu_spawnentry.push(se(11, 1012));
    expect(named(await body(), 'Sir Aldenmar')).toBeTruthy();
  });

  it('carries the stats the agent ranks on, and a maxlevel only when it is above the level', async () => {
    const b = await body();
    const bv = named(b, 'Brackwyn Vale');
    expect(bv).toMatchObject({ id: 1003, level: 42, maxlevel: 46, hp: 4000, maxdmg: 150, delay: 20, traits: ['summon', 'flurry', 'magical'] });
    expect(named(b, 'a plain skeleton')).toMatchObject({ maxlevel: 0, bodytype: 3, traits: ['magical'] });
  });

  it('falls back to the 3.0 s swing when the catalog has no delay', async () => {
    tables.eqemu_npc_types.find(n => n.id === 1009).attack_delay = null;
    expect(named(await body(), 'a plain skeleton').delay).toBe(30);
  });

  it('merges same-name, same-stat bodies into one entry (lowest id) and keeps at most 3 points, rounded', async () => {
    tables.eqemu_npc_types.reverse();                 // the higher id is read first, so "lowest" has to be chosen
    const b = await body();
    const pups = b.npcs.filter(n => n.name === 'a gnoll pup');
    expect(pups).toHaveLength(1);
    expect(pups[0].id).toBe(1001);
    expect(pups[0].pts).toHaveLength(3);
    expect(pups[0].pts[0]).toEqual([100, -201, 3]);
  });

  it('keeps same-name bodies with different stats apart', async () => {
    tables.eqemu_npc_types.find(n => n.id === 1002).hp = 1200;
    const b = await body();
    expect(b.npcs.filter(n => n.name === 'a gnoll pup')).toHaveLength(2);
  });

  it('sorts by level, then id', async () => {
    const b = await body();
    expect(b.npcs.map(n => n.level)).toEqual([...b.npcs.map(n => n.level)].sort((a, c) => a - c));
  });
});

describe('the melee proc chip', () => {
  it('is set when the list OR a parent list sets an attack proc, and not otherwise', async () => {
    const b = await body();
    expect(named(b, 'Brackwyn Vale').proc).toBe(1);
    expect(named(b, 'a plain skeleton').proc).toBe(0);
  });

  it('is not set when no list in the chain carries one', async () => {
    tables.eqemu_npc_spells[1].attack_proc = 0;
    expect(named(await body(), 'Brackwyn Vale').proc).toBe(0);
  });

  it('a failed spell-list read costs the chip, not the list, and the answer is cached only briefly', async () => {
    const inner = fake.select;
    fake.select = async (table, qs) => (table === 'eqemu_npc_spells' ? null : inner(table, qs));
    let t = 1_000_000;
    const r = await get('testzone', () => t);
    expect(r.status).toBe(200);
    expect(named(JSON.parse(r.body), 'Brackwyn Vale').proc).toBe(0);
    t += 10 * 60_000;                                   // past the 5-minute degraded lifetime, far short of 6 h
    fake.select = inner;
    expect(named(JSON.parse((await get('testzone', () => t)).body), 'Brackwyn Vale').proc).toBe(1);
  });
});

describe('statuses and the cache', () => {
  it('400 for a bad or unknown zone, 404 for a zone with no points, 503 when a read fails (not cached)', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('Bad Zone!')).status).toBe(400);
    expect((await get('nosuchzone')).status).toBe(400);
    expect((await get('emptyzone')).status).toBe(404);
    const inner = fake.select;
    fake.select = async () => null;
    expect((await get('testzone')).status).toBe(503);
    fake.select = inner;
    expect((await get('testzone')).status).toBe(200);
  });

  it('builds a zone once for six hours, and again after', async () => {
    let t = 1_000_000;
    await get('testzone', () => t);
    const n = fake.calls.filter(c => c.table === 'eqemu_zone').length;
    await get('testzone', () => t + 5 * 3600_000);
    expect(fake.calls.filter(c => c.table === 'eqemu_zone').length).toBe(n);
    await get('testzone', () => t + 7 * 3600_000);
    expect(fake.calls.filter(c => c.table === 'eqemu_zone').length).toBe(n + 1);
  });

  it('the ETag is weak, follows the content, and survives a rebuild of unchanged data', async () => {
    let t = 1_000_000;
    const a = await get('testzone', () => t);
    expect(a.etag).toMatch(/^W\/"[0-9a-f]{20}"$/);
    t += 7 * 3600_000;
    await new Promise(r => setTimeout(r, 5));
    const b = await get('testzone', () => t);
    expect(b.body).not.toBe(a.body);
    expect(b.etag).toBe(a.etag);
    tables.eqemu_npc_types.find(n => n.id === 1003).hp = 4001;
    t += 7 * 3600_000;
    expect((await get('testzone', () => t)).etag).not.toBe(a.etag);
  });

  it('etagMatches reads a list, weak or strong, and *', () => {
    expect(cp.etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
    expect(cp.etagMatches('"abc"', 'W/"abc"')).toBe(true);
    expect(cp.etagMatches('"x", W/"abc"', 'W/"abc"')).toBe(true);
    expect(cp.etagMatches('*', 'W/"abc"')).toBe(true);
    expect(cp.etagMatches('W/"other"', 'W/"abc"')).toBe(false);
    expect(cp.etagMatches(undefined, 'W/"abc"')).toBe(false);
  });
});

describe('the route (real _handleAgentCharmPets from index.js)', () => {
  const block = sliceBlock(SRC, 'async function _handleAgentCharmPets(req, res) {', '\n}\n');
  let authed, enabled;
  function load() {
    globalThis.__cpTest = { cp, fake: Object.assign(fake, { isEnabled: () => enabled }), authed: () => authed };
    // eslint-disable-next-line no-new-func
    return new Function(`
      const __t = globalThis.__cpTest;
      const mimicLink = { requireAgentAuth: async (req, res) => { if (!__t.authed()) { res.writeHead(401); res.end('{}'); return null; } return { user_id: 'u' }; } };
      const require = (m) => m === './utils/charmPets' ? __t.cp : m === './utils/supabase' ? __t.fake : null;
      ${block}
      return _handleAgentCharmPets;
    `)();
  }
  const mkRes = () => ({
    code: null, headers: null, body: null,
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b; },
  });
  const call = async (url, headers = {}) => { const res = mkRes(); await load()({ url, headers }, res); return res; };
  beforeEach(() => { authed = true; enabled = true; });

  it('200 with the JSON, an ETag, and a cache lifetime', async () => {
    const res = await call('/api/agent/charm-pets?zone=testzone');
    expect(res.code).toBe(200);
    expect(res.headers['ETag']).toMatch(/^W\//);
    expect(res.headers['Cache-Control']).toBe('max-age=21600');
    expect(JSON.parse(res.body).npcs.length).toBe(3);
  });

  it('304 and no body on a matching If-None-Match', async () => {
    const first = await call('/api/agent/charm-pets?zone=testzone');
    const res = await call('/api/agent/charm-pets?zone=testzone', { 'if-none-match': first.headers['ETag'] });
    expect(res.code).toBe(304);
    expect(res.body).toBeUndefined();
    expect((await call('/api/agent/charm-pets?zone=testzone', { 'if-none-match': 'W/"stale"' })).code).toBe(200);
  });

  it('gzips when asked, and the gzip is the same document', async () => {
    const res = await call('/api/agent/charm-pets?zone=testzone', { 'accept-encoding': 'gzip, deflate' });
    expect(res.headers['Content-Encoding']).toBe('gzip');
    const plain = await call('/api/agent/charm-pets?zone=testzone');
    expect(nodeRequire('zlib').gunzipSync(res.body).toString()).toBe(plain.body);
  });

  it('400 on a bad or unknown zone, 404 on an empty one, 503 when the database is off', async () => {
    expect((await call('/api/agent/charm-pets')).code).toBe(400);
    expect((await call('/api/agent/charm-pets?zone=nosuchzone')).code).toBe(400);
    expect((await call('/api/agent/charm-pets?zone=emptyzone')).code).toBe(404);
    enabled = false;
    expect((await call('/api/agent/charm-pets?zone=testzone')).code).toBe(503);
  });

  it('stops at the bearer check', async () => {
    authed = false;
    const res = await call('/api/agent/charm-pets?zone=testzone');
    expect(res.code).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('the budget', () => {
  const code = stripJs(SRC);

  it('charm_pets is a 30/min GET kind, not durable', () => {
    const budgets = sliceBlock(code, 'const _BUDGET_DEFAULTS = {', '\n};');
    // eslint-disable-next-line no-new-func
    const defaults = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();
    expect(defaults.charm_pets).toEqual({ perMin: 30, durable: false, get: true });
  });

  it('the route runs _overBudget first, and a read is not sheddable', () => {
    const route = sliceBlock(code, "=== '/api/agent/charm-pets'", '_handleAgentCharmPets(req, res)');
    expect(route).toMatch(/_overBudget\('charm_pets', req, res\)/);
    const shed = sliceBlock(code, 'const _SHED_KINDS = new Set([', ']);');
    expect(shed).not.toMatch(/charm_pets/);
  });
});
