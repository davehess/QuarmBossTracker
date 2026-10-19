// test/hail-board.test.js — the hail board: who in the raid still has to hail the NPC a boss's death spawns.
//
// The guild lead, 2026-10-05: "Upon boss death and spawn of a creature that needs to be hailed, we should
// have that as an available slot in command center to track who has not yet hailed and who has already. If
// we know they've already completed that section we do not need to track them for needing to hail."
// Option A: one shared board, every Mimic feeds it, any raider can tap a name.
//
// BEHAVIOUR tier. utils/hailBoard.js runs for real against an in-memory PostgREST that enforces the
// 1,000-row cap (test/_fake-postgrest.js) and a fake clock; the endpoint handlers and the kill listener run
// as sliced from index.js / utils/state.js. The names below are invented tokens, not members.
//
// Run: npx vitest run test/hail-board.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { makeFakePostgrest } from './_fake-postgrest.js';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';
import path from 'node:path';

const require = createRequire(import.meta.url);
const hailBoard = require('../utils/hailBoard.js');
const popFlagStages = require('../utils/popFlagStages.js');
const popSelfProof = require('../utils/popSelfProof.js');
import { WHO_ZONE, whoProves } from '../web/lib/popWho.ts';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';
import { SELF_TICK_KEYS, flagForTickKey } from '../web/lib/popSelfFlags.ts';

const MIN = 60_000;
const KILL = Date.parse('2026-10-05T23:30:00Z');
const at = (min) => new Date(KILL + min * MIN).toISOString();
const RAID = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavish', 'Merrowyn', 'Ulric', 'Wenlow'];

const rosterRows = (names, uploader, minAgo = 0) =>
  names.map(n => ({ guild_id: 'g', name: n, uploaded_by_discord_id: uploader, captured_at: at(-minAgo) }));

// One board over a fake database and a clock the test moves.
function env(tables = {}, { enabled = true } = {}) {
  const t = { raid_roster: [], pop_flags: [], pop_guide_ticks: [], bot_kv: [],
    characters: RAID.map(name => ({ guild_id: 'g', name })), ...tables };
  const fake = makeFakePostgrest(t);
  const upserts = [];
  let nextId = 1;
  for (const r of t.pop_flags) r.id = r.id ?? nextId++;
  const sb = {
    isEnabled: () => enabled,
    select: (...a) => fake.select(...a),
    // e.failRoster simulates a raid_roster read that times out (decided when the read ends); e.hold (a promise)
    // parks a raid_roster read until it resolves, a slow Supabase; e.rosterReads counts every attempt.
    selectAllPaged: (table, ...a) => {
      if (table === 'pop_guide_ticks' && e.failTicks) return Promise.resolve(null);    // a tick read that timed out
      if (table !== 'raid_roster') return fake.selectAllPaged(table, ...a);
      e.rosterReads++;
      if (!e.hold) return e.failRoster ? Promise.resolve(null) : fake.selectAllPaged(table, ...a);
      return e.hold.then(() => (e.failRoster ? null : fake.selectAllPaged(table, ...a)));
    },
    // e.rpc stands in for pop_who_sightings, which the fake does not carry; it may return null or throw.
    rpc: (fn, p) => (e.rpc ? e.rpc(fn, p) : fake.rpc(fn, p)),
    upsert: async (table, rows) => {
      upserts.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
      if (table === 'bot_kv') {
        for (const r of rows) {
          const i = t.bot_kv.findIndex(x => x.guild_id === r.guild_id && x.key === r.key);
          const copy = JSON.parse(JSON.stringify(r));
          if (i >= 0) t.bot_kv[i] = copy; else t.bot_kv.push(copy);
        }
      }
      return rows;
    },
  };
  const e = { tables: t, fake, upserts, clock: KILL + 20_000, failRoster: false, rosterReads: 0 };
  e.hb = hailBoard.create({ supabase: sb, guildId: 'g', now: () => e.clock, log: { warn() {} } });
  e.boot = () => hailBoard.create({ supabase: sb, guildId: 'g', now: () => e.clock, log: { warn() {} } });
  e.calls = (table, re) => fake.calls.filter(c => c.table === table && (!re || re.test(c.query))).length;
  e.flag = (character, flagKey, source, when, extra = {}) =>
    t.pop_flags.push({ id: nextId++, guild_id: 'g', character, flag_key: flagKey, source, npc: null, zone: null, earned_at: when, ...extra });
  e.advance = (ms) => { e.clock += ms; };
  e.tick = (character, itemKey, when = at(5), guild = 'g') =>
    t.pop_guide_ticks.push({ guild_id: guild, character_name: character, item_key: itemKey, ticked_at: when, ticked_by: null });
  // A /who sighting row as pop_who_sightings returns it (one per character and zone).
  e.sight = (character, zone, when = at(-3 * 24 * 60)) => ({ character_key: character.toLowerCase(), zone, first_seen: when, last_seen: when, seen: 3 });
  return e;
}
const flush = () => new Promise(r => setTimeout(r, 0));

// ── The map ──────────────────────────────────────────────────────────────────────────────────────────

describe('which kills have a hail', () => {
  it('finds a boss by the board id, the catalog name or the log name', () => {
    expect(hailBoard.hailFor({ bossId: 'grummus' }).npc).toBe('A Planar Projection');
    expect(hailBoard.hailFor({ bossId: 'terris_thule' }).id).toBe('terris_thule');
    expect(hailBoard.hailFor({ bossName: 'Terris-Thule' }).id).toBe('terris_thule');
    expect(hailBoard.hailFor({ bossName: 'Terris_Thule' }).id).toBe('terris_thule');
    expect(hailBoard.hailFor({ bossName: '#Aerin`Dar' }).id).toBe('aerin_dar');
    expect(hailBoard.hailFor({ bossName: "Aerin'Dar" }).id).toBe('aerin_dar');
    expect(hailBoard.hailFor({ bossName: 'Lord Mithaniel Marr' }).id).toBe('lord_mithaniel_marr');
    expect(hailBoard.hailFor({ bossName: 'The Keeper of Sorrows' }).npc).toBe('Tylis Newleaf');
    expect(hailBoard.hailFor({ bossName: 'Manaetic Behemoth' }).npc).toBe('Giwin Mirakon');
    expect(hailBoard.hailFor({ bossName: 'A Mystical Arbitor of Earth' }).id).toBe('arbitor_of_earth');
    expect(hailBoard.hailFor({ bossName: 'Rallos_Zek_' }).id).toBe('rallos_zek_warlord');
    expect(hailBoard.hailFor({ bossId: 'rallos_zek_warlord' }).id).toBe('rallos_zek_warlord');
  });

  it('Agnarr is not a hail (Karana wants a phrase), and a trash mob is not a boss', () => {
    expect(hailBoard.hailFor({ bossName: 'Agnarr the Storm Lord' })).toBeNull();
    expect(hailBoard.hailFor({ bossId: 'agnarr_storm_lord' })).toBeNull();
    expect(hailBoard.hailFor({ bossName: 'a bat' })).toBeNull();
    expect(hailBoard.hailFor({})).toBeNull();
  });

  it('every key a row names is one the flag tables can actually produce', () => {
    const bot = readSource(BOT_INDEX);
    const { POP_FLAG_BY_BOSS } = evalBlock(
      sliceBlock(bot, 'const POP_FLAG_BY_BOSS = {', '\n};'), ['POP_FLAG_BY_BOSS']);
    const produced = new Set([
      ...popFlagStages.PREV_STAGES.map(r => r[3]),
      ...popFlagStages.RECITAL_STAGES.map(r => r[1]),
      ...Object.values(popFlagStages.ZONE_ONLY.grant), ...Object.values(popFlagStages.ZONE_ONLY.checklist),
      ...Object.values(popFlagStages.TACTICS_CHECKLIST_BY_BOSS),
      ...Object.keys(popFlagStages.STAGE_IMPLIES), ...Object.values(popFlagStages.STAGE_IMPLIES).flat(),
      ...Object.values(POP_FLAG_BY_BOSS),
    ]);
    // What the Seer's recital can establish: the stages she recites and what each one implies.
    const recital = new Set(popFlagStages.RECITAL_STAGES.flatMap(r => [r[1], ...(popFlagStages.STAGE_IMPLIES[r[1]] || [])]));
    for (const b of hailBoard.HAIL_BOSSES) {
      expect(b.done.length, b.id).toBeGreaterThan(0);
      for (const k of [...b.done, ...(b.checklist ? [b.checklist] : [])]) expect(produced.has(k), `${b.id}: ${k}`).toBe(true);
      // A prerequisite is only claimed missing for a raider whose recital we hold, so it must be one the
      // recital reports; otherwise nobody could ever satisfy it.
      for (const k of b.prior.flat()) expect(recital.has(k), `${b.id} prior: ${k}`).toBe(true);
    }
  });
});

// ── Opening a window ─────────────────────────────────────────────────────────────────────────────────

describe('a hail boss kill opens a window', () => {
  it('snapshots the raid at the kill: fresh roster names once each, stale rows left out, and stores it in bot_kv', async () => {
    const e = env({ raid_roster: [
      ...rosterRows(RAID, 'u1'), ...rosterRows(RAID.slice(0, 6), 'u2'), ...rosterRows(['Staleguy'], 'u3', 20),
    ] });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    expect(w).toMatchObject({
      id: `grummus:${KILL / 1000}`, boss_id: 'grummus', boss_name: 'Grummus', npc_name: 'A Planar Projection',
      zone: 'Plane of Disease', opened_at: at(0), expires_at: at(20),
    });
    expect([...w.roster].sort()).toEqual([...RAID].sort());
    expect([...w.uploaders].sort()).toEqual(['u1', 'u2']);
    const kv = e.tables.bot_kv.find(r => r.key === 'hail_windows');
    expect(kv.value.windows).toHaveLength(1);
    expect(kv.value.windows[0].id).toBe(w.id);
  });

  it('opens by name for bosses the board does not carry, and a Tylis window is the thirty minutes the 2026-10-17 patch notes gave him', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const marr = await e.hb.openWindow({ bossName: 'Lord Mithaniel Marr', killedAtMs: KILL });
    expect(marr).toMatchObject({ boss_id: 'lord_mithaniel_marr', zone: 'Temple of Marr', expires_at: at(20) });
    const keeper = await e.hb.openWindow({ bossName: 'The Keeper of Sorrows', killedAtMs: KILL });
    expect(keeper).toMatchObject({ npc_name: 'Tylis Newleaf', expires_at: at(30) });
  });

  it('does not open for a boss with no hail, Agnarr included', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    for (const args of [
      { bossId: 'gaukr_sandstorm', killedAtMs: KILL }, { bossName: 'Agnarr the Storm Lord', killedAtMs: KILL },
      { bossId: 'ture', killedAtMs: KILL }, { bossName: 'a bat', killedAtMs: KILL },
    ]) expect(await e.hb.openWindow(args)).toBeNull();
    expect(e.upserts).toHaveLength(0);
    expect(e.calls('raid_roster')).toBe(0);
  });

  it('does not open for a kill whose NPC is already gone, and asks the database nothing', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    e.advance(21 * MIN);
    expect(await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL })).toBeNull();
    e.clock = KILL + 20 * MIN;        // the NPC leaves at exactly +20: nothing left to hail
    expect(await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL })).toBeNull();
    expect(e.calls('raid_roster')).toBe(0);
    expect(e.upserts).toHaveLength(0);
  });

  it('uses the fight\'s participants when no roster is fresh, and still opens (pending) when there is nobody at all', async () => {
    const none = env();
    const empty = await none.hb.openWindow({ bossId: 'saryrn', killedAtMs: KILL });
    expect(empty).toMatchObject({ roster: [], roster_pending: true });
    const e = env();
    const w = await e.hb.openWindow({ bossId: 'saryrn', killedAtMs: KILL, participants: ['Aldenmar', 'Brackwyn', 'Aldenmar', 'a bat'] });
    expect(w.roster).toEqual(['Aldenmar', 'Brackwyn']);
    expect(w.uploaders).toEqual([]);
    expect(w.roster_pending).toBe(true);
  });

  it('the roster is the snapshot UNION the fight\'s participants, deduped without regard to case', async () => {
    const e = env({ raid_roster: rosterRows(['Aldenmar', 'Brackwyn', 'Corvale'], 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL,
      participants: ['brackwyn', 'Rethlan', 'Nyssara', 'a bat'] });
    expect([...w.roster].sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Rethlan']);
    expect(w.roster_pending).toBeUndefined();         // the read worked and found people: nothing to retry
    expect(w.uploaders).toEqual(['u1']);
  });

  it('a pet in the fight\'s player list is not a raider: only fighters the guild knows join the board', async () => {
    // A summoned pet whose owner the parse could not resolve is listed as a player, with damage, like a raider.
    const e = env({ raid_roster: rosterRows(['Aldenmar', 'Brackwyn'], 'u1') });
    const w = await e.hb.openWindow({ bossName: 'The Keeper of Sorrows', killedAtMs: KILL,
      participants: ['Aldenmar', 'Rethlan', 'Lararer'] });
    expect([...w.roster].sort()).toEqual(['Aldenmar', 'Brackwyn', 'Rethlan']);
    // ... and with the roster read failed, the pet is still not a raider.
    const f = env();
    f.failRoster = true;
    const p = await f.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL, participants: ['Rethlan', 'Lararer'] });
    expect(p.roster).toEqual(['Rethlan']);
    // A failed characters read keeps the names rather than thinning the roster.
    const g = env();
    g.fake.selectAllPaged = ((orig) => (t, ...a) => (t === 'characters' ? Promise.reject(new Error('timeout')) : orig(t, ...a)))(g.fake.selectAllPaged);
    const k = await g.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL, participants: ['Rethlan', 'Lararer'] });
    expect(k.roster).toEqual(['Rethlan', 'Lararer']);
  });

  it('a roster read that fails does not freeze the window: it opens pending with the participants', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    e.failRoster = true;
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL, participants: ['Aldenmar'] });
    expect(w).toMatchObject({ roster: ['Aldenmar'], uploaders: [], roster_pending: true });
    expect(e.tables.bot_kv[0].value.windows[0].roster_pending).toBe(true);
  });

  it('is one window per death: a second report folds in, and the earlier kill time wins', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const first = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL + 40_000 });
    e.advance(30_000);
    const again = await e.hb.openWindow({ bossName: 'Grummus', killedAtMs: KILL });   // the death line, seen earlier
    expect(again.id).toBe(first.id);
    expect(e.hb._windows()).toHaveLength(1);
    expect(again.opened_at).toBe(at(0));
    expect(again.expires_at).toBe(at(20));
    expect(e.calls('raid_roster')).toBe(1);
  });

  it('survives a restart: the window is read back from bot_kv, with no roster read', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const rebooted = e.boot();
    const board = await rebooted.getBoard();
    expect(board.windows.map(x => x.id)).toEqual([w.id]);
    expect(e.calls('raid_roster')).toBe(1);
  });

  it('never overwrites what it could not read: a failed bot_kv read does not wipe the open windows', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const saved = JSON.parse(JSON.stringify(e.tables.bot_kv));
    // A fresh process whose first read of bot_kv fails (Supabase down), then a second kill opens.
    const writes = [];
    const sbDown = { isEnabled: () => true, select: async () => null,
      selectAllPaged: (...a) => e.fake.selectAllPaged(...a),
      upsert: async (...a) => { writes.push(a); return null; } };
    const b = hailBoard.create({ supabase: sbDown, guildId: 'g', now: () => e.clock, log: { warn() {} } });
    expect(await b.openWindow({ bossId: 'saryrn', killedAtMs: KILL })).toBeTruthy();
    expect(writes).toEqual([]);
    expect(e.tables.bot_kv).toEqual(saved);
  });
});

// ── Who still has to hail ────────────────────────────────────────────────────────────────────────────

describe('the board sorts every raider from what we already collect', () => {
  async function grummusNight() {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const day = -2 * 24 * 60;
    e.flag('Aldenmar', 'fuirstel_2', 'event', at(day));                           // held since two days ago
    e.flag('Brackwyn', 'fuirstel_2', 'event', at(3));                             // the grant landed after the kill
    e.flag('Corvale', 'hail', 'hail_witnessed', at(5), { npc: 'A Planar Projection' });   // seen hailing
    e.flag('Nyssara', 'mavuin_3', 'recital', at(-30));                            // recital on file, no ward step
    e.flag('Tavish', 'fuirstel_1', 'recital', at(-30));                           // recital on file, ward step done
    e.flag('Merrowyn', 'cl_grummus', 'checklist', at(4));                         // hailed, got the checklist flag
    e.flag('Ulric', 'fuirstel_2', 'recital', at(1));                              // the Seer, after the kill
    e.flag('Wenlow', 'cl_grummus', 'checklist', at(day));                         // an OLD checklist flag is not done
    e.flag('Wenlow', 'hail', 'hail_witnessed', at(2), { npc: 'Seer Mal Nae' });   // a different NPC
    e.flag('Wenlow', 'hail', 'hail_witnessed', at(-10), { npc: 'A Planar Projection' });  // before the kill
    await e.hb.markHailed({ windowId: w.id, name: 'RETHLAN', hailed: true, by: 'Aldenmar' });
    return { e, w };
  }

  it('still / hailed / already flagged, with how and by whom', async () => {
    const { e, w } = await grummusNight();
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.id).toBe(w.id);
    expect(view.already_flagged).toEqual(['Aldenmar', 'Ulric']);
    expect(view.hailed).toEqual([
      { name: 'Brackwyn', how: 'flag' },
      { name: 'Corvale', how: 'seen' },
      { name: 'Merrowyn', how: 'flag' },
      { name: 'Rethlan', how: 'marked', by: 'Aldenmar' },
    ]);
    expect(view.still).toEqual([
      { name: 'Nyssara', prior_missing: true },
      { name: 'Tavish', prior_missing: false },
      { name: 'Wenlow', prior_missing: false },
      { name: 'Zarrin', prior_missing: false },
    ]);
  });

  it('a raider already flagged is not tracked: a mark cannot move them, and they are in no other list', async () => {
    const { e, w } = await grummusNight();
    const r = await e.hb.markHailed({ windowId: w.id, name: 'Aldenmar', hailed: true, by: 'Zarrin' });
    expect(r.window.already_flagged).toContain('Aldenmar');
    expect(r.window.hailed.map(h => h.name)).not.toContain('Aldenmar');
    expect(r.window.still.map(s => s.name)).not.toContain('Aldenmar');
  });

  it('unknown is not missing: a prerequisite is claimed absent only for a raider whose recital we hold', async () => {
    const { e } = await grummusNight();
    const [view] = (await e.hb.getBoard()).windows;
    const by = Object.fromEntries(view.still.map(s => [s.name, s.prior_missing]));
    expect(by.Zarrin).toBe(false);      // no rows at all
    expect(by.Wenlow).toBe(false);      // only an old checklist flag: still not a recital
    expect(by.Nyssara).toBe(true);      // recital, no ward step
    expect(by.Tavish).toBe(false);      // recital, ward step done
  });

  it('a grant that earns the step later in its series settles the earlier one (Bertoxxulous done = fuirstel 4)', async () => {
    const e = env({ raid_roster: rosterRows(['Aldenmar', 'Brackwyn'], 'u1') });
    await e.hb.openWindow({ bossId: 'bertoxxulous', killedAtMs: KILL });
    e.flag('Aldenmar', 'fuirstel_5', 'event', at(-60 * 24));
    e.flag('Brackwyn', 'fuirstel_3', 'recital', at(-5));
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.already_flagged).toEqual(['Aldenmar']);
    expect(view.still).toEqual([{ name: 'Brackwyn', prior_missing: false }]);   // fuirstel 3 is the step it needs
  });

  it('a hail witnessed for one of two projections credits the earlier window, the second hail the later one', async () => {
    const e = env({ raid_roster: rosterRows(['Aldenmar'], 'u1') });
    await e.hb.openWindow({ bossId: 'tallon_zek', killedAtMs: KILL });
    e.advance(3 * MIN);
    await e.hb.openWindow({ bossId: 'vallon_zek', killedAtMs: KILL + 2 * MIN });
    e.flag('Aldenmar', 'hail', 'hail_witnessed', at(2.5), { npc: 'a planar projection', zone: '214' });
    e.flag('Aldenmar', 'hail', 'hail_witnessed', at(2.6), { npc: 'A Planar Projection', zone: '207' });   // other zone
    let board = await e.hb.getBoard();
    let by = Object.fromEntries(board.windows.map(w => [w.boss_id, w.hailed.map(h => h.how)]));
    expect(by).toEqual({ tallon_zek: ['seen'], vallon_zek: [] });
    e.flag('Aldenmar', 'hail', 'hail_witnessed', at(4), { npc: 'A Planar Projection', zone: '214' });
    e.advance(6_000);
    board = await e.hb.getBoard();
    by = Object.fromEntries(board.windows.map(w => [w.boss_id, w.hailed.map(h => h.how)]));
    expect(by).toEqual({ tallon_zek: ['seen'], vallon_zek: ['seen'] });
  });

  it('a hail by Giwin or Tylis answers to their first name too', async () => {
    const e = env({ raid_roster: rosterRows(['Aldenmar', 'Brackwyn'], 'u1') });
    await e.hb.openWindow({ bossName: 'The Keeper of Sorrows', killedAtMs: KILL });
    e.flag('Aldenmar', 'hail', 'hail_witnessed', at(3), { npc: 'Tylis' });
    e.flag('Brackwyn', 'hail', 'hail_witnessed', at(3), { npc: 'A Planar Projection' });
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed).toEqual([{ name: 'Aldenmar', how: 'seen' }]);
    expect(view.still.map(s => s.name)).toEqual(['Brackwyn']);
  });

  it('seen_by counts the roster feeders and the raiders whose own Mimic reported a grant', async () => {
    const e = env({ raid_roster: [...rosterRows(RAID, 'u1'), ...rosterRows(RAID, 'u2')] });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    e.flag('Brackwyn', 'fuirstel_2', 'event', at(3));
    e.flag('Corvale', 'hail', 'hail_witnessed', at(3), { npc: 'A Planar Projection' });   // seen, not self-reported
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.seen_by).toBe(3);
  });
});

// ── Proof pop_flags does not hold: guide ticks and /who sightings ────────────────────────────────────────
// The guild lead, raid night 2026-10-14: the board listed raiders who already had the flag. It decided "done"
// from pop_flags alone; the site also counts a member's own tick on the PoP guide (pop_guide_ticks) and a /who
// sighting in a plane the flag opens (pop_who_sightings). Both now settle a raider the same way the Seer does:
// they prove the step is held, not when it began.

describe('a raider the guide ticks and /who sightings settle is not listed', () => {
  const night = async (bossId = 'bertoxxulous', names = RAID) => {
    const e = env({ raid_roster: rosterRows(names, 'u1') });
    await e.hb.openWindow({ bossId, killedAtMs: KILL });
    return e;
  };
  const split = async (e) => {
    const [view] = (await e.hb.getBoard()).windows;
    return { view, already: view.already_flagged, still: view.still.map(s => s.name) };
  };

  it('a member\'s own tick of the step settles it, whenever the tick was stored', async () => {
    const e = await night();
    e.tick('Aldenmar', 'flag_bert');                       // the guide's "Kill Bertoxxulous", ticked after the kill
    e.tick('Brackwyn', 'flag:bert_dead');                  // the same flag from the flag matrix
    e.tick('Corvale', 'flag_grummus');                     // a step BEFORE this hail: not a done key
    e.tick('Rethlan', 'flag_bert', at(5), 'another-guild');   // somebody else's guild
    e.tick('Zarrin', 'justice_mavuin_hail');               // a step that is nowhere in this series
    const { view, already, still } = await split(e);
    expect(already).toEqual(['Aldenmar', 'Brackwyn']);
    expect(still).toEqual(expect.arrayContaining(['Corvale', 'Rethlan', 'Zarrin']));
    expect(still).not.toContain('Aldenmar');
    // A tick is not a grant the NPC handed out: it never counts against the flag cap.
    expect(view.hailed).toEqual([]);
    expect(view.flags_granted).toBe(0);
  });

  it('a tick of a later step carries the steps it implies (Maelin\'s power-source reading settles the Mithaniel Marr hail)', async () => {
    const e = await night('lord_mithaniel_marr', ['Aldenmar', 'Brackwyn']);
    e.tick('Aldenmar', 'zebuxoruk_maelin');                // zebuxoruk 2 is built from Marr's notes: it implies marr_dead
    const { already, still } = await split(e);
    expect(already).toEqual(['Aldenmar']);
    expect(still).toEqual(['Brackwyn']);
  });

  it('a /who sighting in a plane the flag opens settles it, before or after the kill; the RPC is asked only about the roster and the planes that matter', async () => {
    const e = await night();
    const asked = [];
    e.rpc = (fn, p) => {
      asked.push({ fn, p });
      return [
        e.sight('Aldenmar', 'potorment'),                              // Torment needs the Bertoxxulous thank-you
        e.sight('Brackwyn', 'Plane of Time', at(4)),                   // first seen after the kill: still proof
        e.sight('Corvale', 'codecay'),                                 // the Crypt proves only the Grummus step
        e.sight('Rethlan', 'postorms'),                                // Storms proves the Justice flag
      ];
    };
    const { already, still } = await split(e);
    expect(already).toEqual(['Aldenmar', 'Brackwyn']);
    expect(still).toEqual(expect.arrayContaining(['Corvale', 'Rethlan']));
    expect(asked).toHaveLength(1);
    expect(asked[0].fn).toBe('pop_who_sightings');
    expect(asked[0].p.p_guild_id).toBe('g');
    expect([...asked[0].p.p_names].sort()).toEqual(RAID.map(n => n.toLowerCase()).sort());
    expect(asked[0].p.p_zones).toEqual(expect.arrayContaining(['potorment', 'torment, the plane of pain', 'plane of time']));
    expect(asked[0].p.p_zones).not.toContain('postorms');
    expect(asked[0].p.p_zones).not.toContain('codecay');
  });

  it('the Grummus ward step is not proven by standing in the Crypt, but is by standing past it', async () => {
    const e = await night('grummus', ['Aldenmar', 'Brackwyn']);
    e.rpc = () => [e.sight('Aldenmar', 'potorment'), e.sight('Brackwyn', 'codecay')];
    const { already, still } = await split(e);
    expect(already).toEqual(['Aldenmar']);
    expect(still).toEqual(['Brackwyn']);
  });

  it('works with nothing from pop_flags at all, and still lists a hail the raider genuinely needs', async () => {
    const e = await night('bertoxxulous', ['Aldenmar', 'Brackwyn']);
    e.tick('Aldenmar', 'flag_bert');
    e.flag('Brackwyn', 'fuirstel_3', 'recital', at(-5));
    const { view } = await split(e);
    expect(view.already_flagged).toEqual(['Aldenmar']);
    expect(view.still).toEqual([{ name: 'Brackwyn', prior_missing: false }]);
  });

  it('fails open: a tick read or a /who read that fails leaves the pop_flags answer, and the board still comes back', async () => {
    const e = await night();
    e.flag('Aldenmar', 'fuirstel_5', 'event', at(-60 * 24));
    e.tick('Brackwyn', 'flag_bert');
    e.failTicks = true;
    e.rpc = () => { throw new Error('rpc blew up'); };
    let r = await split(e);
    expect(r.already).toEqual(['Aldenmar']);
    expect(r.still).toContain('Brackwyn');
    // The other failure shapes: an RPC that answers null, and one that rejects.
    for (const rpc of [() => null, () => Promise.reject(new Error('timeout'))]) {
      e.advance(61_000); e.rpc = rpc;
      r = await split(e);
      expect(r.already).toEqual(['Aldenmar']);
    }
  });

  it('keeps the last good proof for the same roster when a later refresh fails', async () => {
    const e = await night();
    e.tick('Aldenmar', 'flag_bert');
    e.rpc = () => [e.sight('Brackwyn', 'potorment')];
    expect((await split(e)).already).toEqual(['Aldenmar', 'Brackwyn']);
    e.advance(61_000);
    e.failTicks = true; e.rpc = () => null;
    expect((await split(e)).already).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('costs one tick query and one /who call per refresh, for the roster only: a poll inside five seconds or a minute adds none', async () => {
    const e = await night();
    e.rpc = (fn, p) => { e.rpcCalls = (e.rpcCalls || 0) + 1; return []; };
    await Promise.all([e.hb.getBoard(), e.hb.getBoard(), e.hb.getBoard()]);
    e.advance(6_000);
    await e.hb.getBoard();
    expect(e.calls('pop_guide_ticks')).toBe(1);
    expect(e.rpcCalls).toBe(1);
    const q = e.fake.calls.find(c => c.table === 'pop_guide_ticks').query;
    expect(q).toMatch(/guild_id=eq\.g/);
    const inList = /character_name=in\.\(([^)]*)\)/.exec(q)[1].split(',').sort();
    expect(inList).toEqual([...RAID].sort());
    e.advance(61_000);
    await e.hb.getBoard();
    expect(e.calls('pop_guide_ticks')).toBe(2);
    expect(e.rpcCalls).toBe(2);
  });
});

// The bot cannot load the site's TypeScript, so utils/popSelfProof.js carries copies of two tables. They are
// compared with the originals here, so a gate or guide step edited on the site cannot leave the board behind.
describe('the bot\'s copies of the site\'s proof tables have not drifted', () => {
  it('/who zones and what each proves match web/lib/popWho.ts', () => {
    expect(popSelfProof.WHO_ZONE).toEqual(WHO_ZONE);
    for (const zone of new Set(Object.values(WHO_ZONE))) {
      expect(new Set(popSelfProof.WHO_PROVES[zone]), zone).toEqual(new Set(whoProves(zone)));
    }
    expect(Object.keys(popSelfProof.WHO_PROVES).sort()).toEqual([...new Set(Object.values(WHO_ZONE))].sort());
  });

  it('a guide tick reports the same flag as web/lib/popSelfFlags.ts, for every guide key and every flag: key', () => {
    const fromGuide = Object.fromEntries(GUIDE_ITEMS.filter(i => i.flag).map(i => [i.key, i.flag]));
    expect(popSelfProof.GUIDE_TICK_FLAG).toEqual(fromGuide);
    for (const k of SELF_TICK_KEYS) {
      const flag = flagForTickKey(k);
      expect(popSelfProof.flagsForTickKey(k)[0], k).toBe(flag);
    }
    expect(popSelfProof.flagsForTickKey('not_a_step')).toEqual([]);
    expect(popSelfProof.flagsForTickKey('flag:unmapped')).toEqual([]);
  });
});

// ── A roster that arrived thin (FB-71) ────────────────────────────────────────────────────────────────
// A member, 2026-10-10: "The command center did not capture everyone's hails for grummus". 48 raiders hailed
// and the card showed one name: the post-kill upload burst timed the raid_roster read out, the window froze on
// the uploader's own player list, and every other hailer was invisible to the board for the whole 20 minutes.

describe('a roster read that failed is retried, and a witnessed hailer is on the board', () => {
  const POLL = 30_000;

  async function pendingGrummus(extra = {}) {
    const e = env({ raid_roster: rosterRows(RAID, 'u1'), ...extra });
    e.failRoster = true;
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL, participants: ['Aldenmar'] });
    e.failRoster = false;
    return { e, w };
  }
  const everyone = (v) => [...v.still.map(s => s.name), ...v.hailed.map(h => h.name), ...v.already_flagged].sort();

  it('a poll after 30 s re-reads the roster, unions the whole raid in, clears pending and persists it', async () => {
    const { e, w } = await pendingGrummus();
    expect(e.rosterReads).toBe(1);
    expect(everyone((await e.hb.getBoard()).windows[0])).toEqual(['Aldenmar']);   // inside the 30 s: still thin
    e.advance(POLL);
    const [view] = (await e.hb.getBoard()).windows;
    expect(e.rosterReads).toBe(2);
    expect(everyone(view)).toEqual([...RAID].sort());
    expect(view.seen_by).toBe(1);                                     // the roster's uploader is now counted
    expect(w.roster_pending).toBeUndefined();
    const stored = e.tables.bot_kv[0].value.windows[0];
    expect(stored.roster_pending).toBeUndefined();
    expect([...stored.roster].sort()).toEqual([...RAID].sort());
    expect(stored.uploaders).toEqual(['u1']);
    // Settled: no further roster read however long the window stays open.
    e.advance(5 * MIN);
    await e.hb.getBoard();
    expect(e.rosterReads).toBe(2);
  });

  it('never retries inside 30 s, never twice at once, and keeps trying every 30 s while the read keeps failing', async () => {
    const { e } = await pendingGrummus();
    e.failRoster = true;
    for (const ms of [5_000, 10_000, 14_000]) { e.advance(ms); await e.hb.getBoard(); }   // 29 s after the open
    expect(e.rosterReads).toBe(1);
    e.advance(1_000);
    await Promise.all([e.hb.getBoard(), e.hb.getBoard(), e.hb.getBoard()]);              // 30 s: one retry for all three
    expect(e.rosterReads).toBe(2);
    expect(e.hb._windows()[0].roster_pending).toBe(true);
    e.advance(29_000); await e.hb.getBoard();
    expect(e.rosterReads).toBe(2);
    e.advance(1_000); await e.hb.getBoard();
    expect(e.rosterReads).toBe(3);
  });

  it('a slow retry is never doubled: a poll that arrives while it is in flight waits for it', async () => {
    const { e } = await pendingGrummus();
    let release; e.hold = new Promise(r => { release = r; });
    e.advance(POLL);
    const first = e.hb.getBoard();
    await flush();
    expect(e.rosterReads).toBe(2);
    e.advance(POLL + 1_000);                       // a second poll well past the throttle, the read still parked
    const second = e.hb.getBoard();
    await flush();
    expect(e.rosterReads).toBe(2);
    e.failRoster = true;                            // the parked read times out: the window is still pending...
    release();
    await Promise.all([first, second]);
    expect(e.hb._windows()[0].roster_pending).toBe(true);
    expect(e.rosterReads).toBe(2);                  // ...and the second poll did not start a read of its own
  });

  it('a read that works but finds nobody keeps the window pending; the retry reads only the window\'s own span', async () => {
    const e = env({ raid_roster: rosterRows(['Staleguy'], 'u9', 40) });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    expect(e.hb._windows()[0]).toMatchObject({ roster: [], roster_pending: true });
    e.tables.raid_roster.push(...rosterRows(['Lateguy'], 'u8', -30));
    e.advance(POLL);
    await e.hb.getBoard();
    // Lateguy was captured 30 minutes AFTER the kill, past the NPC's departure: not the raid at the kill.
    expect(e.hb._windows()[0]).toMatchObject({ roster: [], roster_pending: true });
    e.tables.raid_roster.push(...rosterRows(['Aldenmar'], 'u1', -5));
    e.advance(POLL);
    const [view] = (await e.hb.getBoard()).windows;
    expect(everyone(view)).toEqual(['Aldenmar']);
    expect(e.hb._windows()[0].roster_pending).toBeUndefined();
  });

  it('a hailer the roster missed is added to the board as seen, once, and kept across a restart', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const npc = { npc: 'A Planar Projection' };
    e.flag('Quillon', 'hail', 'hail_witnessed', at(3), npc);                         // not on the roster
    e.flag('Sarnoth', 'hail', 'hail_witnessed', at(3), { npc: 'Seer Mal Nae' });      // a different NPC
    e.flag('Brindlo', 'hail', 'hail_witnessed', at(-10), npc);                       // before this kill
    e.flag('Tolvane', 'hail', 'hail_witnessed', at(3), { ...npc, zone: '214' });      // another zone's projection
    e.flag('Corvale', 'hail', 'hail_witnessed', at(4), npc);                         // already on the roster
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed).toEqual([{ name: 'Corvale', how: 'seen' }, { name: 'Quillon', how: 'seen' }]);
    expect(everyone(view)).toEqual([...RAID, 'Quillon'].sort());
    e.advance(6_000);
    expect((await e.hb.getBoard()).windows[0].hailed.map(h => h.name)).toEqual(['Corvale', 'Quillon']);
    expect(e.hb._windows()[0].roster.filter(n => n === 'Quillon')).toHaveLength(1);
    await flush();
    expect(e.tables.bot_kv[0].value.windows[0].roster).toContain('Quillon');
    const back = (await e.boot().getBoard()).windows[0];
    expect(back.hailed.map(h => h.name)).toContain('Quillon');
  });

  it('a witnessed hailer joins the earliest window their hail fits, not every window', async () => {
    const e = env({ raid_roster: rosterRows(['Aldenmar'], 'u1') });
    await e.hb.openWindow({ bossId: 'tallon_zek', killedAtMs: KILL });
    e.advance(3 * MIN);
    await e.hb.openWindow({ bossId: 'vallon_zek', killedAtMs: KILL + 2 * MIN });
    e.flag('Quillon', 'hail', 'hail_witnessed', at(2.5), { npc: 'a planar projection', zone: '214' });
    const by = Object.fromEntries((await e.hb.getBoard()).windows.map(w => [w.boss_id, everyone(w)]));
    expect(by).toEqual({ tallon_zek: ['Aldenmar', 'Quillon'], vallon_zek: ['Aldenmar'] });
  });

  it('a pending window with nobody on it asks nothing about raiders, and an idle board makes no read at all', async () => {
    const e = env();
    e.failRoster = true;
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const afterOpen = e.fake.calls.length;
    const [view] = (await e.hb.getBoard()).windows;
    expect(view).toMatchObject({ still: [], hailed: [], already_flagged: [] });
    expect(e.fake.calls.filter(c => c.table === 'pop_flags' && /character=in\./.test(c.query))).toEqual([]);
    expect(e.fake.calls.length).toBeGreaterThan(afterOpen);          // the one hail read; nothing per-raider
    // The window ends: no board, no retry, no read of any table, however long the poll goes on.
    e.advance(21 * MIN);
    const reads = e.rosterReads, calls = e.fake.calls.length;
    for (let i = 0; i < 3; i++) { expect(await e.hb.getBoard()).toEqual({ windows: [] }); e.advance(MIN); }
    expect(e.rosterReads).toBe(reads);
    expect(e.fake.calls.length).toBe(calls);
  });
});

// ── GET /hail-board ──────────────────────────────────────────────────────────────────────────────────

describe('the board a poller gets', () => {
  it('has exactly the contract\'s fields', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const board = await e.hb.getBoard();
    expect(Object.keys(board)).toEqual(['windows']);
    expect(Object.keys(board.windows[0]).sort()).toEqual(
      ['already_flagged', 'boss_id', 'boss_name', 'expires_at', 'flag_cap', 'flags_granted', 'flags_left', 'hailed', 'id',
        'ms_left', 'npc_name', 'opened_at', 'seen_by', 'still', 'zone']);
    expect(board.windows[0].still.every(s => typeof s.name === 'string' && typeof s.prior_missing === 'boolean')).toBe(true);
  });

  it('is empty, and costs no query at all, while nothing is open or once everything has expired', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    expect(await e.hb.getBoard()).toEqual({ windows: [] });
    const afterLoad = e.fake.calls.length;
    expect(await e.hb.getBoard()).toEqual({ windows: [] });
    expect(e.fake.calls.length).toBe(afterLoad);

    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    expect((await e.hb.getBoard()).windows).toHaveLength(1);
    e.advance(21 * MIN);
    const before = e.fake.calls.length;
    expect(await e.hb.getBoard()).toEqual({ windows: [] });
    expect(e.fake.calls.length).toBe(before);
  });

  it('is computed once per five seconds however many raiders poll, and the history only once a minute', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    await Promise.all([e.hb.getBoard(), e.hb.getBoard(), e.hb.getBoard()]);
    const pop = () => e.calls('pop_flags');
    const history = () => e.calls('pop_flags', /flag_key=in\./);
    const n = pop();
    await e.hb.getBoard();
    expect(pop()).toBe(n);
    e.advance(6_000);
    await e.hb.getBoard();
    expect(pop()).toBeGreaterThan(n);
    expect(history()).toBe(1);
    e.advance(61_000);
    await e.hb.getBoard();
    expect(history()).toBe(2);
  });

  it('reads pop_flags for the whole roster without the 1,000-row cap clipping it', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    // 1,100 stale re-uploads of one done key: more rows than one response can carry.
    for (let i = 0; i < 1100; i++) e.flag('Zarrin', 'fuirstel_2', 'event', at(-100 - i));
    e.flag('Zarrin', 'fuirstel_2', 'event', at(-5000));
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.already_flagged).toContain('Zarrin');
    expect(e.fake.truncated).toEqual([]);
  });
});

// ── The flag cap and when the NPC leaves ─────────────────────────────────────────────────────────────
// The guild lead, 2026-10-07: "add the 72-flag cap to the hail board, and the countdown timers for when
// those mobs disappear". Every number below was read from the NPC's own script in eqemu_quest_scripts the
// same day: a counter that resets on spawn and rises once per flag granted, a timer that depops the NPC.

describe('the flag cap and the NPC\'s departure', () => {
  // boss id → [cap in raiders, minutes the NPC stays]. Grummus and Marr declare 72 * 2 because one hail can
  // tick twice. The server's patch notes of 2026-10-17 changed three rows: Saryrn's projection stays 30 minutes
  // (was 20), Tylis stays 30 (was 10), and the Arbitor of Earth (MAX_KEYS, no FLAG_LIMIT) flags 72 (was 54).
  const SCRIPTS = {
    grummus: [72, 20], bertoxxulous: [72, 20], terris_thule: [72, 20], aerin_dar: [72, 20], saryrn: [72, 30],
    keeper_of_sorrows: [72, 30], lord_mithaniel_marr: [72, 20], manaetic_behemoth: [72, 10],
    tallon_zek: [72, 20], vallon_zek: [72, 20], rallos_zek_warlord: [72, 20], solusek_ro: [72, 20],
    arbitor_of_earth: [72, 20],
  };

  it('every hail boss carries the cap and the stay its script gives, and no boss is missing from this list', async () => {
    expect(hailBoard.HAIL_BOSSES.map(b => b.id).sort()).toEqual(Object.keys(SCRIPTS).sort());
    for (const [id, [cap, minutes]] of Object.entries(SCRIPTS)) {
      const e = env({ raid_roster: rosterRows(RAID, 'u1') });
      await e.hb.openWindow({ bossId: id, killedAtMs: KILL });
      const [view] = (await e.hb.getBoard()).windows;
      expect(view.flag_cap, id).toBe(cap);
      expect(view.expires_at, id).toBe(at(minutes));
      expect(view.ms_left, id).toBe(minutes * MIN - 20_000);
    }
  });

  it('a boss whose script states no cap gets none: null, not zero and not a guess', async () => {
    const row = hailBoard.HAIL_BOSSES.find(b => b.id === 'saryrn');
    const kept = row.flagCap;
    try {
      delete row.flagCap;
      const e = env({ raid_roster: rosterRows(RAID, 'u1') });
      await e.hb.openWindow({ bossId: 'saryrn', killedAtMs: KILL });
      const [view] = (await e.hb.getBoard()).windows;
      expect(view).toMatchObject({ flag_cap: null, flags_left: null, flags_granted: 0 });
    } finally { row.flagCap = kept; }
  });

  it('counts the raiders whose grant landed after the kill — not a witnessed hail, a tap, or a flag held before', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    e.flag('Aldenmar', 'fuirstel_2', 'event', at(-2 * 24 * 60));                   // held since two days ago: no grant here
    e.flag('Brackwyn', 'fuirstel_2', 'event', at(3));                              // a real flag
    e.flag('Merrowyn', 'cl_grummus', 'checklist', at(4));                          // a checklist flag counts too
    e.flag('Corvale', 'hail', 'hail_witnessed', at(5), { npc: 'A Planar Projection' });   // seen: said hail, nothing proven
    e.flag('Ulric', 'fuirstel_2', 'recital', at(1));                               // the Seer reports state, not a grant
    const marked = await e.hb.markHailed({ windowId: `grummus:${KILL / 1000}`, name: 'Rethlan', hailed: true, by: 'Aldenmar' });
    expect(marked.window.hailed.map(h => h.how).sort()).toEqual(['flag', 'flag', 'marked', 'seen']);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view).toMatchObject({ flag_cap: 72, flags_granted: 2, flags_left: 70 });
    expect(marked.window).toMatchObject({ flag_cap: 72, flags_granted: 2, flags_left: 70 });
  });

  it('flags_left runs down to zero and stops there, however many grants we saw', async () => {
    // 76 raiders with a letters-only name each (the roster validator), all granted: more than the Arbitor's 72 keys.
    const names = Array.from({ length: 76 }, (_, i) => 'Raider' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)));
    const e = env({ raid_roster: rosterRows(names, 'u1') });
    await e.hb.openWindow({ bossId: 'arbitor_of_earth', killedAtMs: KILL });
    names.slice(0, 68).forEach((n) => e.flag(n, 'earthb_key_1', 'event', at(2)));
    expect((await e.hb.getBoard()).windows[0]).toMatchObject({ flag_cap: 72, flags_granted: 68, flags_left: 4 });
    names.slice(68).forEach((n) => e.flag(n, 'earthb_key_1', 'event', at(3)));
    e.advance(6_000);
    expect((await e.hb.getBoard()).windows[0]).toMatchObject({ flag_cap: 72, flags_granted: 76, flags_left: 0 });
  });

  it('ms_left is read off the clock at each response, not frozen in the five-second cache', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    await e.hb.openWindow({ bossId: 'manaetic_behemoth', killedAtMs: KILL });
    const first = (await e.hb.getBoard()).windows[0];
    const queries = e.fake.calls.length;
    e.advance(2_000);
    const second = (await e.hb.getBoard()).windows[0];
    expect(e.fake.calls.length).toBe(queries);                  // still the cached board...
    expect(first.ms_left).toBe(10 * MIN - 20_000);
    expect(second.ms_left).toBe(10 * MIN - 22_000);             // ...with a fresh countdown
    expect(second.expires_at).toBe(first.expires_at);
  });
});

// ── POST /hail-mark ──────────────────────────────────────────────────────────────────────────────────

describe('a tap on a name', () => {
  it('toggles the mark, keeps the roster\'s own spelling, and shows at once', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    await e.hb.getBoard();                                   // warm the cache: a mark must not wait it out
    let r = await e.hb.markHailed({ windowId: w.id, name: ' zarrin ', hailed: true, by: 'Tavish' });
    expect(r.window.hailed).toEqual([{ name: 'Zarrin', how: 'marked', by: 'Tavish' }]);
    expect((await e.hb.getBoard()).windows[0].hailed).toEqual([{ name: 'Zarrin', how: 'marked', by: 'Tavish' }]);
    expect(e.tables.bot_kv[0].value.windows[0].marks.zarrin).toMatchObject({ name: 'Zarrin', by: 'Tavish' });
    r = await e.hb.markHailed({ windowId: w.id, name: 'Zarrin', hailed: false, by: 'Tavish' });
    expect(r.window.hailed).toEqual([]);
    expect(r.window.still.map(s => s.name)).toContain('Zarrin');
    expect(e.tables.bot_kv[0].value.windows[0].marks).toEqual({});
  });

  it('refuses a name that is not in the kill roster and a window that does not exist', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const saves = e.upserts.length;
    expect(await e.hb.markHailed({ windowId: w.id, name: 'Nobodyhere', hailed: true, by: 'x' }))
      .toEqual({ status: 400, error: 'not in the kill roster' });
    expect(await e.hb.markHailed({ windowId: 'grummus:1', name: 'Zarrin', hailed: true, by: 'x' }))
      .toEqual({ status: 404, error: 'unknown or expired window' });
    expect(e.upserts.length).toBe(saves);
  });

  it('a mark by a raider who is not signed in carries no name', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    const r = await e.hb.markHailed({ windowId: w.id, name: 'Zarrin', hailed: true, by: null });
    expect(r.window.hailed).toEqual([{ name: 'Zarrin', how: 'marked' }]);
  });
});

// ── Expiry ───────────────────────────────────────────────────────────────────────────────────────────

describe('expiry', () => {
  it('leaves the board at the NPC\'s departure but takes a late mark for ten minutes more, then prunes bot_kv', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const w = await e.hb.openWindow({ bossId: 'grummus', killedAtMs: KILL });
    e.clock = KILL + 25 * MIN;                               // five minutes after the NPC left
    expect(await e.hb.getBoard()).toEqual({ windows: [] });
    const late = await e.hb.markHailed({ windowId: w.id, name: 'Zarrin', hailed: true, by: 'Tavish' });
    expect(late.window.hailed.map(h => h.name)).toEqual(['Zarrin']);

    e.clock = KILL + 31 * MIN;                               // past the grace
    expect(await e.hb.getBoard()).toEqual({ windows: [] });
    await flush();
    expect(e.tables.bot_kv.find(r => r.key === 'hail_windows').value.windows).toEqual([]);
    expect((await e.hb.markHailed({ windowId: w.id, name: 'Zarrin', hailed: true, by: 'x' })).status).toBe(404);
  });
});

// ── The kill hook in utils/state.js ──────────────────────────────────────────────────────────────────

describe('every recorded kill reaches the listeners', () => {
  const stateSrc = readSource(path.join(ROOT, 'utils', 'state.js'));
  const wrapper = sliceBlock(stateSrc, 'const _killListeners = [];', '  return entry;\n}');
  const load = (recordKill) =>
    // eslint-disable-next-line no-new-func
    // slowMode: the wrapper also applies the slow-mode timer (test/slow-mode.test.js); here it changes nothing.
    new Function('recordKill', 'slowMode', `${wrapper}\nreturn { onKillRecorded, recordKillNotifying };`)(recordKill, { timerHoursForKill: (id, h) => h });

  it('hands each listener the boss, the kill time and the killer, and returns the record untouched', () => {
    const entry = { killedAt: 1234, nextSpawn: 9999, killedBy: 'x' };
    const { onKillRecorded, recordKillNotifying } = load(() => entry);
    const seen = [];
    onKillRecorded((k) => seen.push(k));
    expect(recordKillNotifying('grummus', 24, 'x', 1234)).toBe(entry);
    expect(seen).toEqual([{ bossId: 'grummus', killedAt: 1234, killedBy: 'x' }]);
  });

  it('a listener that throws or rejects never fails the kill or starves the next listener', async () => {
    const { onKillRecorded, recordKillNotifying } = load(() => ({ killedAt: 1 }));
    const seen = [];
    onKillRecorded(() => { throw new Error('boom'); });
    onKillRecorded(async () => { throw new Error('async boom'); });
    onKillRecorded((k) => seen.push(k.bossId));
    expect(() => recordKillNotifying('saryrn', 66, null)).not.toThrow();
    await flush();
    expect(seen).toEqual(['saryrn']);
  });

  it('the module exports the notifying wrapper as recordKill, and the listener registrar', () => {
    const code = stripJs(stateSrc);
    expect(code).toMatch(/recordKill:\s*recordKillNotifying/);
    expect(code).toMatch(/\bonKillRecorded\b[^\n]*\n[^\n]*overrideTimer/);
  });
});

// ── A flag NPC no kill stands up: the hedge maze's Thelin ────────────────────────────────────────────
// The guild lead, 2026-10-13: the board "did not end up displaying the nightmare hedges [maze] to unlock
// Terris Thule and it didn't display how many people already had the flags." Then 2026-10-14, after it popped
// at the START of the maze: "This is supposed to come up after the last boss dies, not right at the beginning
// of the hedge event"; "the one on the inside won't give you flags until after he talks to terris thule at the
// end". So the first grant opens it, never a hail.

describe('the hedge maze board opens on Thelin\'s first flag (after the Terris talk), not on the hails that start the maze', () => {
  const NIGHTMARE = '204';                                              // the zone id the agent sends
  const NAMES = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'];
  const roster = (minAgo = 0) => NAMES.map(name =>
    ({ guild_id: 'g', name, group_num: 1, uploaded_by_discord_id: 'u1', captured_at: at(-minAgo) }));
  const hedgeEnv = () => env({ raid_roster: roster(1) });
  // A row as the pop-flags ingest stores it, and hands it to noteGrants.
  const row = (e, name, key, source, min, extra = {}) => {
    e.flag(name, key, source, at(min), { zone: NIGHTMARE, ...extra });
    return { character: name, flag_key: key, source, earned_at: at(min), zone: NIGHTMARE, npc: null, ...extra };
  };
  const hail = (e, name, min, extra = {}) => row(e, name, 'hail', 'hail_witnessed', min, { npc: 'Thelin Poxbourne', ...extra });
  const grant = (e, name, min, extra = {}) => row(e, name, 'thelin_2', 'event', min, { stage: 'thelin_2', ...extra });

  it('has a Thelin entry with the right steps, a 10-minute stay, a card heading the agent keeps whole, and no kill finds it', () => {
    const cfg = hailBoard.HAIL_FLAGGERS.find(f => f.id === 'hedge_maze');
    expect(cfg).toMatchObject({ zoneShort: 'ponightmare', checklist: 'cl_maze', prior: [['thelin_1']], minutes: 10 });
    expect(cfg.done).toEqual(['thelin_2', 'thelin_3', 'thelin_4', 'hedge_event']);
    expect(cfg.opensOn).toEqual(['thelin_2', 'cl_maze']);
    // Both state-4 answers are what the stage tables store for this zone.
    expect(popFlagStages.ZONE_ONLY.grant.ponightmare).toBe('thelin_2');
    expect(popFlagStages.ZONE_ONLY.checklist.ponightmare).toBe('cl_maze');
    expect(popFlagStages.zoneShort(NIGHTMARE)).toBe('ponightmare');
    expect(popFlagStages.STAGE_IMPLIES.thelin_2).toContain('hedge_event');
    expect(popFlagStages.RECITAL_STAGES.map(r => r[1])).toContain('thelin_1');
    expect(cfg.npc).toMatch(/Hedge maze.*Thelin Poxbourne.*Lair of Terris Thule/);
    expect(cfg.npc.length).toBeLessThanOrEqual(64);                     // the agent trims card text at 64
    expect(hailBoard.hailFor({ bossId: 'hedge_maze' })).toBeNull();
    expect(hailBoard.hailFor({ bossName: 'Thelin Poxbourne' })).toBeNull();
    expect(hailBoard.HAIL_BOSSES.some(b => b.id === 'hedge_maze')).toBe(false);
  });

  it('the hails that start the maze open nothing, and ask nothing of the database', async () => {
    const e = hedgeEnv();
    const rows = NAMES.map((n, i) => hail(e, n, i * 0.1));               // the whole raid hails at the start
    expect(await e.hb.noteGrants(rows)).toBeNull();
    expect(e.hb._windows()).toEqual([]);
    expect(e.fake.calls).toEqual([]);
  });

  it('the first grant opens one window over the current raid, for 10 minutes, with the already-flagged count', async () => {
    const e = hedgeEnv();
    e.flag('Nyssara', 'thelin_1', 'recital', at(-30));
    e.flag('Zarrin', 'thelin_2', 'recital', at(-30));                    // already holds the step
    e.flag('Rethlan', 'thelin_3', 'event', at(-3 * 24 * 60));            // and a later step of the series
    hail(e, 'Aldenmar', -5);                                             // a hail from the maze's start
    const w = await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    expect(w).toMatchObject({ boss_id: 'hedge_maze', boss_name: 'Hedge maze' });
    expect(w.npc_name).toBe(hailBoard.HAIL_FLAGGERS[0].npc);
    expect(w.roster.slice().sort()).toEqual(NAMES.slice().sort());
    expect(Date.parse(w.opened_at)).toBe(KILL);                          // from the grant
    expect(Date.parse(w.expires_at)).toBe(KILL + 10 * MIN);             // Thelin's state-4 depop
    expect(e.tables.bot_kv[0].value.windows.map(x => x.id)).toEqual([w.id]);

    const [view] = (await e.hb.getBoard()).windows;
    expect(view.already_flagged).toEqual(['Rethlan', 'Zarrin']);
    expect(view.hailed).toEqual([{ name: 'Aldenmar', how: 'flag' }]);
    // The start-of-maze hail is before the window: it credits nobody.
    expect(view.still.map(s => s.name)).toEqual(['Brackwyn', 'Corvale', 'Nyssara']);
    expect(view).toMatchObject({ flag_cap: null, flags_left: null, flags_granted: 1, zone: 'Plane of Nightmare' });
  });

  it('a checklist answer ("I do not recognize your face") opens it too', async () => {
    const e = hedgeEnv();
    const w = await e.hb.noteGrants([row(e, 'Brackwyn', 'cl_maze', 'checklist', 0)]);
    expect(w).toMatchObject({ boss_id: 'hedge_maze' });
  });

  it('a raider whose recital shows no Adroha step is told the hail may not flag them', async () => {
    const e = hedgeEnv();
    e.flag('Brackwyn', 'mavuin_3', 'recital', at(-30));                  // recital on file, thelin_1 not in it
    await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.still.find(s => s.name === 'Brackwyn')).toEqual({ name: 'Brackwyn', prior_missing: true });
  });

  it('opens once: a second grant, and a concurrent pair of reports, leave one window', async () => {
    const e = hedgeEnv();
    const rows = [grant(e, 'Aldenmar', 0)];
    const [a, b] = await Promise.all([e.hb.noteGrants(rows), e.hb.noteGrants(rows)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    e.advance(2 * MIN);
    expect(await e.hb.noteGrants([grant(e, 'Corvale', 2)])).toBeNull();
    expect(e.hb._windows()).toHaveLength(1);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed.map(h => h.name)).toEqual(['Aldenmar', 'Corvale']);
  });

  it('a late upload of a closed window\'s grant opens nothing; the next maze run opens a new one', async () => {
    const e = hedgeEnv();
    await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    e.advance(11 * MIN);
    expect(await e.hb.noteGrants([grant(e, 'Corvale', 5)])).toBeNull();  // inside the closed window
    e.advance(5 * MIN);
    e.tables.raid_roster = roster(0).map(r => ({ ...r, captured_at: new Date(e.clock).toISOString() }));
    const next = await e.hb.noteGrants([grant(e, 'Nyssara', 16)]);
    expect(next).not.toBeNull();
    expect(e.hb._windows()).toHaveLength(2);
  });

  it('a hail inside an open window joins the board as seen, through the existing witnessed-hailer path', async () => {
    const e = hedgeEnv();
    await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    hail(e, 'Outsider', 3);                                              // not on the roster, stood at the NPC
    e.advance(MIN);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed.map(h => h.name)).toContain('Outsider');
  });

  it('opens nothing for the other Thelins\' grants, a zoneless grant, a recital, a stale grant or a disabled store', async () => {
    const e = hedgeEnv();
    // The Plane of Knowledge and Tranquility Thelins give thelin steps too; the Seer recites thelin_2 anywhere.
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', 0, { zone: '202' })])).toBeNull();
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', 0, { zone: 'potranquility' })])).toBeNull();
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', 0, { zone: null })])).toBeNull();
    expect(await e.hb.noteGrants([row(e, 'Aldenmar', 'thelin_2', 'recital', 0)])).toBeNull();
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', -60)])).toBeNull();   // an old log's backfill
    expect(await e.hb.noteGrants([row(e, 'Aldenmar', 'fuirstel_2', 'event', 0)])).toBeNull();
    expect(await e.hb.noteGrants([])).toBeNull();
    expect(await e.hb.noteGrants(undefined)).toBeNull();
    expect(e.fake.calls).toEqual([]);
    const off = env({ raid_roster: roster(1) }, { enabled: false });
    expect(await off.hb.noteGrants([grant(off, 'Aldenmar', 0)])).toBeNull();
  });

  it('a window that opens while the roster read fails is pending, with the granter on it, and fills in later', async () => {
    const e = hedgeEnv();
    e.failRoster = true;
    const w = await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    expect(w.roster_pending).toBe(true);
    expect(w.roster).toEqual(['Aldenmar']);
    e.failRoster = false;
    e.advance(35_000);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.still.length + view.hailed.length).toBe(NAMES.length);
  });

  it('a store that throws is swallowed', async () => {
    const e = hedgeEnv();
    e.fake.selectAllPaged = () => { throw new Error('db down'); };
    e.fake.select = () => { throw new Error('db down'); };
    await expect(e.hb.noteGrants([grant(e, 'Aldenmar', 0)])).resolves.toBeNull();
  });
});

// ── The endpoints in index.js ────────────────────────────────────────────────────────────────────────

describe('the endpoints', () => {
  const bot = readSource(BOT_INDEX);
  const block = sliceBlock(bot, 'async function _handleAgentHailBoard(req, res) {', "res.end(JSON.stringify({ ok: true, ...r.window }));\n}");

  function load({ identity = { discord_id: '111', display_name: 'Brackwyn' }, board = { windows: [] }, mark } = {}) {
    const calls = [];
    const stubs = {
      mimicLink: { requireAgentAuth: async () => identity },
      _hailBoard: () => ({
        getBoard: async () => board,
        markHailed: async (a) => { calls.push(a); return mark ? mark(a) : { window: { id: a.windowId, still: [], hailed: [], already_flagged: [] } }; },
      }),
    };
    // eslint-disable-next-line no-new-func
    const fns = new Function('mimicLink', '_hailBoard', `${block}\nreturn { _handleAgentHailBoard, _handleAgentHailMark };`)(stubs.mimicLink, stubs._hailBoard);
    return { ...fns, calls };
  }
  const res = () => ({ code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } });
  const post = (obj) => Readable.from([Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))]);

  it('GET answers with the board, and stays silent for an unauthenticated caller', async () => {
    const board = { windows: [{ id: 'grummus:1' }] };
    const r = res();
    await load({ board })._handleAgentHailBoard({}, r);
    expect(r.code).toBe(200);
    expect(JSON.parse(r.body)).toEqual(board);
    const r2 = res();
    await load({ identity: null })._handleAgentHailBoard({}, r2);
    expect(r2.code).toBeNull();
  });

  it('POST marks as the signed-in raider and answers with the updated window', async () => {
    const h = load();
    const r = res();
    await h._handleAgentHailMark(post({ window_id: 'grummus:1', name: 'Zarrin', hailed: true }), r);
    expect(h.calls).toEqual([{ windowId: 'grummus:1', name: 'Zarrin', hailed: true, by: 'Brackwyn' }]);
    expect(r.code).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, id: 'grummus:1', still: [], hailed: [], already_flagged: [] });
  });

  it('hailed:false unmarks; a missing hailed means mark; an unlinked install is marked by no one', async () => {
    const h = load({ identity: { discord_id: '111', display_name: '111' } });
    await h._handleAgentHailMark(post({ window_id: 'w', name: 'Zarrin', hailed: false }), res());
    await h._handleAgentHailMark(post({ window_id: 'w', name: 'Zarrin' }), res());
    expect(h.calls.map(c => [c.hailed, c.by])).toEqual([[false, null], [true, null]]);
  });

  it('turns the board\'s refusals into their status codes, and bad bodies into 400 / 413', async () => {
    const h = load({ mark: () => ({ status: 404, error: 'unknown or expired window' }) });
    let r = res();
    await h._handleAgentHailMark(post({ window_id: 'w', name: 'Zarrin' }), r);
    expect([r.code, JSON.parse(r.body)]).toEqual([404, { error: 'unknown or expired window' }]);
    for (const bad of ['not json', {}, { window_id: 'w' }, { name: 'Zarrin' }, { window_id: 7, name: 'Zarrin' }]) {
      r = res();
      await h._handleAgentHailMark(post(bad), r);
      expect(r.code).toBe(400);
    }
    expect(h.calls).toHaveLength(1);
    r = res();
    await h._handleAgentHailMark(post({ window_id: 'w', name: 'x'.repeat(5000) }), r);
    expect(r.code).toBe(413);
  });
});

describe('the wiring in index.js', () => {
  const bot = readSource(BOT_INDEX);

  it('serves both endpoints, behind the agent auth the handlers call', () => {
    const code = stripJs(bot);
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.startsWith\('\/api\/agent\/hail-board'\)/);
    expect(code).toMatch(/req\.method === 'POST' && req\.url === '\/api\/agent\/hail-mark'/);
  });

  it('opens a window from every recorded kill, the relay\'s off-board kills, and a confirmed encounter', () => {
    const listener = stripJs(bot);
    expect(listener).toMatch(/onKillRecorded\(\(\{ bossId, killedAt \}\) => _hailKill\(\{ bossId, killedAtMs: killedAt \}\)\)/);
    const relay = stripJs(sliceBlock(bot, '// Boss not on the board: the kill listener never sees it', "_hailKill({ bossName, killedAtMs: killedAt });"));
    expect(relay).toMatch(/_hailKill\(\{ bossName, killedAtMs: killedAt \}\)/);
    const enc = stripJs(sliceBlock(bot, '// ── Hail board: a confirmed kill of a boss', '// ── Best-effort Supabase write'));
    expect(enc).toMatch(/!isBackfill && encounter\.confirmed_kill === true && encounter\.boss_name/);
    expect(enc).toMatch(/participants: players\.map\(p => p\.name\)/);
    // Outside the Supabase block: a gated-out uncurated boss must still open its window.
    expect(bot.indexOf('// ── Hail board: a confirmed kill of a boss')).toBeLessThan(
      bot.indexOf('// ── Best-effort Supabase write. Falls through silently'));
  });

  it('hands every stored row to the kill-less opener once the upsert worked, and swallows its failure', () => {
    const ingest = stripJs(sliceBlock(bot, 'async function _handleAgentPopFlags(req, res) {', '\n}\n'));
    expect(ingest).toMatch(/if \(Array\.isArray\(r\)\) \{\s*written = r\.length;\s*_hailGrants\(rows\);/);
    const note = stripJs(sliceBlock(bot, 'function _hailGrants(rows) {', '\n}\n'));
    expect(note).toMatch(/_hailBoard\(\)\.noteGrants\(rows\)\.catch\(/);
    // Behaviour: a throw (or a rejection) from the board never escapes into the ingest path.
    const noteFn = (board) => new Function('_hailBoard', 'console', `${sliceBlock(bot, 'function _hailGrants(rows) {', '\n}\n')}\nreturn _hailGrants;`)(() => board, { warn() {} });
    expect(() => noteFn({ noteGrants: () => { throw new Error('x'); } })([])).not.toThrow();
    expect(() => noteFn({ noteGrants: () => Promise.reject(new Error('x')) })([])).not.toThrow();
  });
});

// ── a boss's projection opens on its first flag grant when no kill was confirmed (the guild lead, 2026-10-15:
// "still no Planar Projection on the command center" — Bertoxxulous died, 60 raiders were flagged, but the one
// kill upload had no death line, so the kill-confirmed opener never ran) ──────────────────────────────────────
describe('a boss window opens from its first fresh flag grant', () => {
  const CODECAY = '200';                                               // the zone id the agent sends
  const grant = (e, name, min, key = 'fuirstel_4', zone = CODECAY) => {
    e.flag(name, key, 'event', at(min), { zone });
    return { character: name, flag_key: key, source: 'event', earned_at: at(min), zone, npc: null };
  };
  it('Bertoxxulous: the first fuirstel_4 in the Crypt of Decay opens its projection window over the raid', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    const w = await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    expect(w).toMatchObject({ boss_id: 'bertoxxulous', npc_name: 'A Planar Projection', zone: 'The Crypt of Decay' });
    expect(Date.parse(w.expires_at) - Date.parse(w.opened_at)).toBe(20 * MIN);
    expect(w.roster.slice().sort()).toEqual(RAID.slice().sort());
  });
  it('a later stage of the series, or the right flag in another zone, opens nothing', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', 0, 'fuirstel_5')])).toBeNull();
    expect(await e.hb.noteGrants([grant(e, 'Aldenmar', 0, 'fuirstel_4', '205')])).toBeNull();
    expect(e.hb._windows()).toEqual([]);
  });
  it('a confirmed kill arriving afterwards joins the same window instead of opening a second', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    await e.hb.noteGrants([grant(e, 'Aldenmar', 0)]);
    await e.hb.openWindow({ bossName: 'Bertoxxulous', killedAtMs: KILL - MIN, participants: ['Brackwyn'] });
    expect(e.hb._windows().filter(w => w.boss_id === 'bertoxxulous')).toHaveLength(1);
  });
});

// ── The three Halls of Honor trials (the guild lead, 2026-10-18: "we did not get credit on the command center
// for this trial hailing - we should do it for each HoH trial"). The lines are the server script's own words
// (hohonora/encounters/RyddaDar.lua), as in the guild lead's log of 2026-10-18 ────────────────────────────────
describe('Halls of Honor trials', () => {
  const HOH = '211';                                                   // the zone id the agent sends
  const MIST = 'An ethereal mist descends from the air and surrounds your very being. Your body begins to emanate with the power of Trydan Faye.';
  const HELD = 'You have already received credit for completing this trial.';
  const VILLAGERS = ['Granmuck_Reiga', 'Fligg_Starp', 'Trann_Berk', 'Shott_Tarbs', 'Ruark_Barr', 'Zullkata_Reeps',
    'Maeryn_Malladry', 'Thullias_Rhidron', 'Herot_Terkins', 'Mirezvakla_Ry`Ten', 'Yarezka_Tri`Lok', 'Merken_Lysonn'];

  it('winning trial 1 (Rydda`Dar dies) opens a Trydan Faye window for 10 minutes', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    const w = await e.hb.openWindow({ bossName: 'Rydda`Dar', killedAtMs: KILL });
    expect(w).toMatchObject({ boss_id: 'hoh_trial_1', zone: 'Halls of Honor' });
    expect(w.npc_name).toMatch(/^Trydan Faye/);
    expect(Date.parse(w.expires_at) - Date.parse(w.opened_at)).toBe(10 * MIN);
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.still.map(s => s.name).sort()).toEqual(RAID.slice().sort());
  });

  it('a witnessed hail of the trial NPC in the Halls credits "seen"; another NPC does not', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    await e.hb.openWindow({ bossName: 'Rydda`Dar', killedAtMs: KILL });
    e.flag('Aldenmar', 'hail', 'hail_witnessed', at(3), { npc: 'Trydan Faye', zone: 'hohonora' });
    e.flag('Brackwyn', 'hail', 'hail_witnessed', at(3), { npc: 'Rhaliq Trell', zone: 'hohonora' });
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed).toEqual([{ name: 'Aldenmar', how: 'seen' }]);
  });

  it('the mist line (a fresh grant) is "flag"; the already-held line settles them as already flagged', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    await e.hb.openWindow({ bossName: 'Rydda`Dar', killedAtMs: KILL });
    const mist = popFlagStages.resolveStage({ kind: 'trial', text: MIST, zone: HOH }, '');
    const held = popFlagStages.resolveStage({ kind: 'trial', text: HELD, npc: 'Trydan Faye', zone: HOH }, '');
    expect(mist).toMatchObject({ stage: 'hoh_trial_1', fresh: true });
    expect(held).toMatchObject({ stage: 'hoh_trial_1', fresh: false });
    e.flag('Aldenmar', mist.stage, 'event', at(5));
    e.flag('Brackwyn', held.stage, 'credit', at(6));
    const [view] = (await e.hb.getBoard()).windows;
    expect(view.hailed).toEqual([{ name: 'Aldenmar', how: 'flag' }]);
    expect(view.already_flagged).toEqual(['Brackwyn']);
  });

  it('a mist grant opens the window by itself when no kill was seen', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    const w = await e.hb.noteGrants([{ character: 'Aldenmar', flag_key: 'hoh_trial_2', source: 'event', earned_at: at(0), zone: HOH }]);
    expect(w).toMatchObject({ boss_id: 'hoh_trial_2' });
    expect(w.npc_name).toMatch(/^Rhaliq Trell/);
  });

  it('trial 3 opens only when all three bosses have died; trial 2 only when all twelve have', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1', 1) });
    expect(await e.hb.openWindow({ bossName: 'Advocent_Joran', killedAtMs: KILL - 4 * MIN })).toBeNull();
    expect(await e.hb.openWindow({ bossName: 'Halgoz_Rellinic', killedAtMs: KILL - 2 * MIN })).toBeNull();
    const w3 = await e.hb.openWindow({ bossName: 'Freegan_Haun', killedAtMs: KILL });
    expect(w3).toMatchObject({ boss_id: 'hoh_trial_3', opened_at: new Date(KILL).toISOString() });
    // A second agent reporting the same last death folds into the same window.
    await e.hb.openWindow({ bossName: 'Freegan Haun', killedAtMs: KILL + 1000 });
    expect(e.hb._windows().filter(w => w.boss_id === 'hoh_trial_3')).toHaveLength(1);
    for (const n of VILLAGERS.slice(0, 11)) expect(await e.hb.openWindow({ bossName: n, killedAtMs: KILL })).toBeNull();
    expect(await e.hb.openWindow({ bossName: VILLAGERS[11], killedAtMs: KILL })).toMatchObject({ boss_id: 'hoh_trial_2' });
  });

  it('a mist line for an NPC that is not a trial NPC, or the held line with no NPC, resolves to nothing', () => {
    expect(popFlagStages.resolveStage({ kind: 'trial', text: MIST.replace('Trydan Faye', 'Somebody Else') }, '')).toBeNull();
    expect(popFlagStages.resolveStage({ kind: 'trial', text: HELD }, '')).toBeNull();
    expect(popFlagStages.resolveStage({ kind: 'trial', text: 'You say, hello' }, '')).toBeNull();
  });
});
