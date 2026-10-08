// test/group-scope.test.js — callouts and Extended Target keep to your raid, or your group when you are
// not in one.
//
// The guild lead, 2026-10-07 (a Wednesday, after the raid broke into groups): "We need to do a better job
// of not leaking other group's mobs or callouts when we're not in a raid mode." Two leaks, one cause:
//   1. the trigger relay kept EVERY guild callout guild-wide for the whole Sun/Wed/Thu evening window, and
//      for ten minutes after any raid-roster upload, whether or not the listener was in a raid;
//   2. Extended Target scoped a non-raid player by ZONE only, so two groups in one zone saw each other's
//      mobs (the screenshot: five mobs targeted from other groups, "21 online · MA <name>").
// The rule now (utils/groupScope.js): in a raid = the live roster puts you in one; else your GROUP when
// your Mimic reported it (reporter heartbeat `group_names`); else the same-zone rule and nothing wider.
//
// These run the SHIPPED handlers (sliced out of index.js) against a fake Supabase, with invented names
// (Aldenmar… are nobody). Run: npx vitest run test/group-scope.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);
const gs = requireBot('./utils/groupScope.js');
const raidGroups = requireBot('./utils/raidGroups.js');

function sliceFunction(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('slice: function not found: ' + name);
  const end = src.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error('slice: no closing brace for ' + name);
  return src.slice(m.index, end + 3);
}
function loadBotMany(names, injected) {
  const inj = Object.keys(injected);
  const body = names.map(n => sliceFunction(SRC, n)).join('\n') + `\nreturn { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(...inj, body)(...inj.map(n => injected[n]));
}

const GUILD = 'wolfpack';
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const mkRes = () => { const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; };

// Invented people. Group A is three accounts, group B two; all stand in one zone.
const PEOPLE = {
  a1: 'Aldenmar', a2: 'Brackwyn', a3: 'Corvale', b1: 'Rethlan', b2: 'Nyssara', c1: 'Zarrin',
};
const GROUP_A = ['aldenmar', 'brackwyn', 'corvale'];
const GROUP_B = ['rethlan', 'nyssara'];
const entry = (acct, names, over = {}) => ({
  last_seen: Date.now(), live_character: PEOPLE[acct], group_names: names, ...over,
});
const bookOf = (obj) => ({ get: (id) => obj[id] });
// One upload: every row carries the same captured_at, as the bot writes them.
const rosterRows = (uploader, leader, others, secAgo = 5) => {
  const at = ago(secAgo * 1000);
  return [
    { guild_id: GUILD, name: leader, rank: 'Raid Leader', uploaded_by_discord_id: uploader, captured_at: at },
    ...others.map(n => ({ guild_id: GUILD, name: n, rank: null, uploaded_by_discord_id: uploader, captured_at: at })),
  ];
};

// ── the pure helper ─────────────────────────────────────────────────────────────────────────────────────
describe('utils/groupScope.js', () => {
  const NOW = 1_000_000;
  describe('groupOf: the heartbeat → the names standing with the character being played', () => {
    it('a fresh heartbeat names the group, the played character included', () => {
      expect(gs.groupOf(entry('a2', ['aldenmar'], { last_seen: NOW }), NOW, null).sort()).toEqual(['aldenmar', 'brackwyn']);
    });
    it('an empty list from a fresh heartbeat is a real answer: a group of one', () => {
      expect(gs.groupOf(entry('a2', [], { last_seen: NOW }), NOW, 'Brackwyn')).toEqual(['brackwyn']);
    });
    it('unknown (null) when no group was ever sent, the heartbeat is stale, or it describes another character', () => {
      expect(gs.groupOf(entry('a2', null, { last_seen: NOW }), NOW, null)).toBe(null);
      expect(gs.groupOf(undefined, NOW, null)).toBe(null);
      expect(gs.groupOf(entry('a2', ['aldenmar'], { last_seen: NOW - gs.GROUP_FRESH_MS - 1 }), NOW, null)).toBe(null);
      expect(gs.groupOf(entry('a2', ['aldenmar'], { last_seen: NOW }), NOW, 'Zarrin')).toBe(null);
      expect(gs.groupOf({ last_seen: NOW, group_names: [] }, NOW, null)).toBe(null);   // cannot name ourselves
    });
  });
  describe('relayVerdict: one fire against one listener (true keep · false drop · null = the zone rule decides)', () => {
    const inRaid = (multi) => ({ mode: 'raid', raidKey: 'aldenmar', multi });
    const inGroup = { mode: 'group', names: new Set(GROUP_A) };
    it('one raid keeps everything, whatever key a fire was stamped with (a leader change must not silence it)', () => {
      expect(gs.relayVerdict(inRaid(false), { origin_raid: 'someone-else' })).toBe(true);
      expect(gs.relayVerdict(inRaid(false), { origin_raid: null })).toBe(true);
    });
    it('two raids drop only a sender KNOWN to be in the other one', () => {
      expect(gs.relayVerdict(inRaid(true), { origin_raid: 'nyssara' })).toBe(false);
      expect(gs.relayVerdict(inRaid(true), { origin_raid: 'aldenmar' })).toBe(true);
      expect(gs.relayVerdict(inRaid(true), { origin_raid: null })).toBe(true);
    });
    it('a group keeps its own members\' fires, drops a raid\'s and another group\'s, and defers on an unknown sender', () => {
      expect(gs.relayVerdict(inGroup, { origin_group: ['corvale', 'zarrin'], origin_raid: null })).toBe(true);
      expect(gs.relayVerdict(inGroup, { origin_group: ['corvale'], origin_raid: 'nyssara' })).toBe(true);   // a groupmate wins over a lagging roster
      expect(gs.relayVerdict(inGroup, { origin_group: ['rethlan', 'nyssara'], origin_raid: null })).toBe(false);
      expect(gs.relayVerdict(inGroup, { origin_group: null, origin_raid: 'nyssara' })).toBe(false);
      expect(gs.relayVerdict(inGroup, { origin_group: null, origin_raid: null })).toBe(null);
      expect(gs.relayVerdict(inGroup, { origin_group: [], origin_raid: null })).toBe(null);
    });
    it('zone, legacy and no scope have no opinion', () => {
      for (const s of [{ mode: 'zone' }, { mode: 'legacy' }, undefined, null]) {
        expect(gs.relayVerdict(s, { origin_raid: 'x', origin_group: ['y'] })).toBe(null);
      }
    });
  });
  it('cleanNames keeps EQ names only, lowercased, once each, capped', () => {
    expect(gs.cleanNames(['Aldenmar', 'aldenmar', 'x', 'Bad Name', 'Rethlan1', 42, null, ' Corvale '])).toEqual(['aldenmar', 'corvale']);
    expect(gs.cleanNames('nope')).toEqual([]);
    expect(gs.cleanNames(Array.from({ length: 40 }, (_, i) => 'Name' + String.fromCharCode(97 + (i % 26)).repeat(2) + String.fromCharCode(97 + Math.floor(i / 26)))).length).toBeLessThanOrEqual(12);
  });
});

// ── the relay, end to end: POST stamps the sender, GET filters for the listener ──────────────────────────
function relayRig({ book = {}, tune = {}, inWindow = false, raid = [], rosterFails = false, uploaders = [],
  zones = {}, accountOf = PEOPLE } = {}) {
  const sb = makeCapFake({ tables: { raid_roster: raid } });
  const supabase = rosterFails
    ? { ...sb, isEnabled: () => true, guildId: () => GUILD, selectAllPaged: () => Promise.reject(new Error('down')) }
    : { ...sb, isEnabled: () => true, guildId: () => GUILD };
  const zoneOf = { aldenmar: 'Test Zone', brackwyn: 'Test Zone', corvale: 'Test Zone', rethlan: 'Test Zone', nyssara: 'Test Zone', zarrin: 'Far Zone', ...zones };
  const liveZones = new Map(Object.entries(zoneOf).map(([c, z]) => [c, { zone_name: z, zone_id: 1 }]));
  const discordByChar = new Map(Object.entries(accountOf).map(([id, name]) => [name.toLowerCase(), id]));
  let current = null, zoneReads = 0;
  const triggerRelay = { entries: [], nextId: 1 };
  const fns = loadBotMany([
    '_handleTriggerRelayPost', '_senderStamp', '_groupScopeInputs', '_groupNamesFor', '_requesterChars', '_requesterZones',
    '_recentFiresFor', '_relayScopeFor', '_relayScopeKeep', '_liveRaidSplit',
  ], {
    mimicLink: { requireAgentAuth: async () => current },
    require: (p) => (p === './utils/supabase' ? supabase : requireBot(p)),
    _groupScope: gs, _raidGroups: raidGroups,
    _overlayTuningMap: async () => tune,
    _reporterGuildBook: () => bookOf(book),
    _liveZoneMap: async () => { zoneReads++; return liveZones; }, _charDiscordMap: async () => discordByChar,
    _keepRaidSplit: (s) => s, _raidSplitCache: { at: 0, split: null },
    _inRaidWindowEt: () => inWindow,
    _raidUploaderIds: async () => new Set(uploaders),
    _lootPostedSince: () => ({ loot_posted: [], loot_next_id: 0 }),
    _triggerRelay: triggerRelay, _triggerRate: new Map(), TRIGGER_RATE_WINDOW_MS: 1000, TRIGGER_RATE_MAX: 100,
    TRIGGER_RELAY_DEDUP_WINDOW_MS: 8000, TRIGGER_RELAY_MAX_ENTRIES: 500,
    _senderClockOffsetMs: () => 0,
  });
  let n = 0;
  return {
    entries: triggerRelay.entries,
    zoneReads: () => zoneReads,
    async fire(acct) {
      current = { discord_id: acct };
      const req = { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ fires: [{ name: 'Fire ' + (++n) + ' from ' + acct, key: 'k' + n }] })); } };
      const res = mkRes();
      await fns._handleTriggerRelayPost(req, res);
      expect(res.status).toBe(200);
    },
    // Which senders (account ids) does `acct` hear?
    async hears(acct) {
      current = { discord_id: acct };
      const scope = await fns._relayScopeFor(current);
      return fns._recentFiresFor(current, 0, 0, scope).fires.map(f => f.name.split(' from ')[1]).sort();
    },
  };
}

describe('the relay keeps to your group when you are not in a raid', () => {
  const book = {
    a1: entry('a1', GROUP_A), a2: entry('a2', GROUP_A), a3: entry('a3', GROUP_A),
    b1: entry('b1', GROUP_B), b2: entry('b2', GROUP_B),
  };

  it('⚠ the report: on a raid evening, in the same zone, another group\'s callout is NOT heard', async () => {
    const rig = relayRig({ book, inWindow: true });
    for (const a of ['a1', 'a3', 'b1', 'b2']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1', 'a3']);       // own group only
    expect(await rig.hears('b2')).toEqual(['b1']);
  });

  it('a groupmate on another machine is heard whatever zone they stand in', async () => {
    const rig = relayRig({ book, zones: { corvale: 'Far Zone' } });
    await rig.fire('a3');
    expect(await rig.hears('a2')).toEqual(['a3']);
  });

  it('group unknown (an agent that sends none) → the zone rule, and the raid-window blanket is gone', async () => {
    const noGroup = { a2: entry('a2', null), a1: entry('a1', null), c1: entry('c1', null) };
    const rig = relayRig({ book: noGroup, inWindow: true });
    for (const a of ['a1', 'b1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1', 'b1']);       // same zone kept, 'Far Zone' (c1) dropped
  });

  it('a sender in a raid is not in your group, even in your zone and with no group of their own reported', async () => {
    const rig = relayRig({ book: { a2: entry('a2', GROUP_A) }, raid: rosterRows('b1', 'Rethlan', ['Nyssara', 'Zarrin']) });
    await rig.fire('b1');                 // raid leader Rethlan, same zone as the listener, no heartbeat group
    expect(await rig.hears('a2')).toEqual([]);
  });

  it('sender\'s group unknown but listener\'s known → still the zone rule for that sender', async () => {
    const rig = relayRig({ book: { a2: entry('a2', GROUP_A), a1: entry('a1', null), c1: entry('c1', null) } });
    for (const a of ['a1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1']);
  });

  it('identity unknown: a listener nobody can place hears the evening as before, and nothing off-evening (today\'s rule)', async () => {
    const stranger = { discord_id: 'zz' };
    const inWindow = relayRig({ book, inWindow: true, accountOf: { ...PEOPLE } });
    await inWindow.fire('a1');
    expect(await inWindow.hears(stranger.discord_id)).toEqual(['a1']);
    const outside = relayRig({ book, inWindow: false });
    await outside.fire('a1');
    expect(await outside.hears(stranger.discord_id)).toEqual([]);
  });
});

describe('in a raid', () => {
  const book = { a1: entry('a1', GROUP_A), a2: entry('a2', GROUP_A), b1: entry('b1', GROUP_B), c1: entry('c1', null) };
  const RAID_A = rosterRows('a1', 'Aldenmar', ['Brackwyn', 'Corvale', 'Rethlan']);

  it('one raid: every fire is kept, even from outside it, exactly as today', async () => {
    const rig = relayRig({ book, raid: RAID_A, zones: { corvale: 'Far Zone' } });
    for (const a of ['a1', 'b1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1', 'b1', 'c1']);   // c1 is in no raid and another zone: still kept
  });

  it('a listener in a raid costs no zone lookup — zones are not consulted in a raid', async () => {
    const rig = relayRig({ book, raid: RAID_A });
    await rig.fire('a1');
    const before = rig.zoneReads();
    await rig.hears('a2');
    expect(rig.zoneReads() - before).toBe(1);        // the account's characters only; the zone rule's lookup is skipped
    const off = relayRig({ book: { a2: entry('a2', GROUP_A) } });
    await off.fire('a1');
    const b2 = off.zoneReads();
    await off.hears('a2');
    expect(off.zoneReads() - b2).toBe(2);            // characters + zones when the zone rule can be reached
  });

  it('two raids: the other raid\'s callouts are dropped, own raid\'s and unplaced senders\' kept', async () => {
    const two = [...RAID_A, ...rosterRows('b2', 'Nyssara', ['Zarrin'])];
    const rig = relayRig({ book: { ...book, b2: entry('b2', GROUP_B) }, raid: two });
    for (const a of ['a1', 'b1', 'b2', 'c1']) await rig.fire(a);
    // b1 is Rethlan, listed in raid A; b2 leads raid B; c1 (Zarrin) is in raid B by name; accounts with no roster presence keep
    expect(await rig.hears('a2')).toEqual(['a1', 'b1']);
    expect(await rig.hears('b2')).toEqual(['c1']);
  });

  it('a roster that has aged out (2 minutes) is no raid: the listener is back on their group', async () => {
    const rig = relayRig({ book, raid: rosterRows('a1', 'Aldenmar', ['Brackwyn', 'Corvale'], 200), inWindow: true });
    for (const a of ['a1', 'b1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1']);
  });
});

describe('the kill switch and the failed read restore the old rule', () => {
  const book = { a1: entry('a1', GROUP_A), a2: entry('a2', GROUP_A), b1: entry('b1', GROUP_B), c1: entry('c1', null) };

  it('flag_disable_groupscope=1: the raid-evening blanket is back', async () => {
    const rig = relayRig({ book, inWindow: true, tune: { flag_disable_groupscope: 1 } });
    for (const a of ['a1', 'b1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1', 'b1', 'c1']);
  });
  it('flag_disable_groupscope=1 off the evening: the 10-minute roster-upload blanket is back', async () => {
    const rig = relayRig({ book, uploaders: ['a2'], tune: { flag_disable_groupscope: 1 } });
    for (const a of ['b1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['b1', 'c1']);
  });
  it('flag_disable_groupscope=0 is not the switch', async () => {
    const rig = relayRig({ book, inWindow: true, tune: { flag_disable_groupscope: 0 } });
    for (const a of ['a1', 'b1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1']);
  });
  it('a roster read that fails is not "no raid": the old rule applies', async () => {
    const rig = relayRig({ book, inWindow: true, rosterFails: true });
    for (const a of ['a1', 'b1', 'c1']) await rig.fire(a);
    expect(await rig.hears('a2')).toEqual(['a1', 'b1', 'c1']);
  });
});

describe('what the relay stamps on a fire', () => {
  it('the sender\'s raid key and group, null when unknown', async () => {
    const rig = relayRig({
      book: { a1: entry('a1', GROUP_A), b1: entry('b1', null) },
      raid: rosterRows('a1', 'Aldenmar', ['Brackwyn']),
    });
    await rig.fire('a1'); await rig.fire('b1');
    expect(rig.entries.map(e => [e.origin_raid, e.origin_group && e.origin_group.slice().sort()])).toEqual([
      ['aldenmar', GROUP_A.slice().sort()],
      [null, null],
    ]);
  });
});

// ── Extended Target, end to end ───────────────────────────────────────────────────────────────────────────
describe('Extended Target', () => {
  const live = (character, target, zone = 'Test Zone') => ({
    guild_id: GUILD, character, zone_name: zone, self_hp_pct: 100, target_name: target, target_hp_pct: 70, target_id: null,
    pet_name: null, pet_hp_pct: null, incoming_mob: null, incoming_mob_since: null, loc_x: 1, loc_y: 2, loc_z: 3,
    observed_tanks: null, zeal_tags: null, updated_at: ago(3_000),
  });
  const LIVE = [
    live('Brackwyn', 'a goblin'), live('Aldenmar', 'a goblin'), live('Corvale', 'a goblin'),
    live('Rethlan', 'a spider'), live('Nyssara', 'a spider'), live('Zarrin', 'a wasp', 'Far Zone'),
  ];
  function rig({ book = {}, tune = {}, raid = [], rosterFails = false, character = 'Brackwyn', params = '', ma = null } = {}) {
    const sb = makeCapFake({
      tables: { character_live_state: LIVE, buff_casts: [], raid_roster: raid },
      rpcs: { recent_debuff_landings: { args: ['p_guild_id', 'p_since'], run: () => [] } },
    });
    const supabase = rosterFails
      ? { ...sb, selectAllPaged: (t, ...a) => (t === 'raid_roster' ? Promise.reject(new Error('down')) : sb.selectAllPaged(t, ...a)) }
      : sb;
    const fns = loadBotMany([
      '_extAttributeDebuffs', '_extBindInstances', '_extDebuffInstances', '_extIdInstances', '_extMergeByAgreedId',
      '_extPlaceTags', '_extPosCluster', '_extHeadingPoint', '_mainAssistPin', '_isJunkSpellName', '_liveRaidSplit',
      '_groupNamesFor', '_handleAgentExtendedTarget',
    ], {
      require: (p) => (p === './utils/supabase' ? supabase : requireBot(p)),
      mimicLink: { requireAgentAuth: async () => ({ discord_id: 'a2' }) },
      _overlayTuningMap: async () => tune,
      _rosterNameSet: async () => new Set(),
      _keepRaidSplit: (s) => s, _raidGroups: raidGroups, _groupScope: gs,
      _raidSplitCache: { at: 0, split: null },
      _reporterGuildBook: () => bookOf(book),
      _mainAssistStore: { get: () => ma },
      _extHurtSince: new Map(), _extMobLastSeen: new Map(),
      _JUNK_SPELL_RX: /^(kneel test)$/i,
      EXT_ONLINE_MS: 60_000, EXT_HURT_PCT: 85, EXT_HURT_MIN_MS: 10_000, EXT_HP_SPLIT_TOL: 8,
      EXT_POS_CLUSTER_UNITS: 25, EXT_POS_FRESH_MS: 30_000, EXT_STALE_GRACE_MS: 90_000, EXT_OFFTANK_FRESH_MS: 30_000,
    });
    return async () => {
      delete globalThis._extBundleCache;
      const res = mkRes();
      await fns._handleAgentExtendedTarget({ url: `/api/agent/extended-target?character=${character}${params}`, headers: {} }, res);
      expect(res.status).toBe(200);
      return JSON.parse(res.body);
    };
  }
  const mobs = (out) => out.targets.filter(t => t.kind === 'npc').map(t => t.name).sort();
  const book = { a2: entry('a2', GROUP_A) };
  const MA = { name: 'Aldenmar', called_target: null, by: 'Rethlan', declared_at: Date.now() };

  it('⚠ the screenshot: not in a raid, another group\'s mobs in the same zone are NOT on the board', async () => {
    const out = await rig({ book })();
    expect(mobs(out)).toEqual(['a goblin']);
    expect(out.scope).toBe('group');
    expect(out.online).toBe(3);                         // your group's three, not the zone's five
    expect(out.targets.find(t => t.name === 'a goblin').raiders.sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });

  it('the raid\'s main assist is not shown to a grouped player outside the raid', async () => {
    const out = await rig({ book, ma: MA })();
    expect(out.main_assist).toBeUndefined();
  });

  it('group unknown → exactly the zone scope it had (same-zone five, no scope field)', async () => {
    const out = await rig({ book: {} })();
    expect(mobs(out)).toEqual(['a goblin', 'a spider']);
    expect(out.scope).toBeUndefined();
    expect(out.online).toBe(5);
  });

  it('identity unknown (no character on the request, nothing from the heartbeat) → the zone scope, never an empty board', async () => {
    const out = await rig({ book: {}, character: '' })();
    expect(mobs(out).length).toBeGreaterThan(0);
    expect(out.scope).toBeUndefined();
  });

  it('a heartbeat for another character, or a stale one, is "group unknown"', async () => {
    const other = await rig({ book: { a2: entry('a2', GROUP_A, { live_character: 'Zarrin' }) } })();
    expect(mobs(other)).toEqual(['a goblin', 'a spider']);
    const stale = await rig({ book: { a2: entry('a2', GROUP_A, { last_seen: Date.now() - 5 * 60_000 }) } })();
    expect(mobs(stale)).toEqual(['a goblin', 'a spider']);
  });

  it('flag_disable_groupscope=1 restores the zone-wide board (and the main assist)', async () => {
    const out = await rig({ book, tune: { flag_disable_groupscope: 1 }, ma: MA })();
    expect(mobs(out)).toEqual(['a goblin', 'a spider']);
    expect(out.scope).toBeUndefined();
    expect(out.main_assist && out.main_assist.name).toBe('Aldenmar');
  });

  it('a failed roster read is not "no raid": the zone scope stands', async () => {
    const out = await rig({ book, rosterFails: true })();
    expect(mobs(out)).toEqual(['a goblin', 'a spider']);
  });

  it('in one raid the board is the raid\'s, unchanged — a reported group does not narrow it', async () => {
    const raid = rosterRows('a1', 'Aldenmar', ['Brackwyn', 'Corvale', 'Rethlan', 'Nyssara']);
    const out = await rig({ book, raid, ma: MA })();
    expect(mobs(out)).toEqual(['a goblin', 'a spider']);
    expect(out.scope).toBeUndefined();
    expect(out.raids).toBeUndefined();                          // one raid: nothing new in the payload
    expect(out.main_assist && out.main_assist.name).toBe('Aldenmar');
  });

  it('with two raids the other raid\'s raiders are still dropped, group or not', async () => {
    const raid = [...rosterRows('a1', 'Aldenmar', ['Brackwyn', 'Corvale']), ...rosterRows('b1', 'Rethlan', ['Nyssara'])];
    const out = await rig({ book, raid })();
    expect(mobs(out)).toEqual(['a goblin']);
    expect(out.scope).toBeUndefined();
    expect(out.raids.map(r => r.mine)).toEqual([true, false]);
  });

  it('the zone toggle off still sees every zone, but a grouped player outside a raid sees only their group', async () => {
    const out = await rig({ book, params: '&same_zone=0' })();
    expect(mobs(out)).toEqual(['a goblin']);
  });
});

describe('the roster read the relay shares with Extended Target and the buff queue', () => {
  const SENTINEL = { raids: [], multi: false, cached: true };
  function run(maxAge) {
    let reads = 0;
    const supabase = { selectAllPaged: async () => { reads++; return []; } };
    const { _liveRaidSplit } = loadBotMany(['_liveRaidSplit'], {
      _raidSplitCache: { at: Date.now() - 10_000, split: SENTINEL },
      _keepRaidSplit: (s) => s, _raidGroups: raidGroups,
    });
    return (maxAge === undefined ? _liveRaidSplit(supabase, GUILD) : _liveRaidSplit(supabase, GUILD, maxAge))
      .then(split => ({ split, reads }));
  }
  it('answers from a 10-second-old memo only when the caller allows that age (the relay does, 15 s)', async () => {
    expect((await run(15_000)).split).toBe(SENTINEL);
    const fresh = await run();                     // the default 5 s: read again
    expect(fresh.split).not.toBe(SENTINEL);
    expect(fresh.reads).toBe(1);
  });
  it('a read that fails says so, so "no raids" is never mistaken for "could not look"', async () => {
    const supabase = { selectAllPaged: () => Promise.reject(new Error('down')) };
    const { _liveRaidSplit } = loadBotMany(['_liveRaidSplit'], {
      _raidSplitCache: { at: 0, split: null }, _keepRaidSplit: (s) => s, _raidGroups: raidGroups,
    });
    expect((await _liveRaidSplit(supabase, GUILD)).failed).toBe(true);
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('wiring', () => {
  const bot = stripJs(SRC);
  it('the heartbeat keeps the sanitized group names, in memory only', () => {
    expect(bot).toContain('group_names: Array.isArray(payload.group_names) ? _groupScope.cleanNames(payload.group_names) : null,');
  });
  it('the relay reads the roster through the shared memo, up to 15 seconds old (a poll every 1.5 s per agent)', () => {
    expect(bot).toContain('_liveRaidSplit(supabase, guildId, 15_000)');
  });
  it('both relay paths and Extended Target read the same kill switch', () => {
    expect(bot).toContain('Number(tune.flag_disable_groupscope) >= 1 || !supabase.isEnabled()');
    expect(bot).toContain("tn('flag_disable_groupscope', 0) >= 1");
  });
});
