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

const MIN = 60_000;
const KILL = Date.parse('2026-10-05T23:30:00Z');
const at = (min) => new Date(KILL + min * MIN).toISOString();
const RAID = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavish', 'Merrowyn', 'Ulric', 'Wenlow'];

const rosterRows = (names, uploader, minAgo = 0) =>
  names.map(n => ({ guild_id: 'g', name: n, uploaded_by_discord_id: uploader, captured_at: at(-minAgo) }));

// One board over a fake database and a clock the test moves.
function env(tables = {}, { enabled = true } = {}) {
  const t = { raid_roster: [], pop_flags: [], bot_kv: [], ...tables };
  const fake = makeFakePostgrest(t);
  const upserts = [];
  let nextId = 1;
  for (const r of t.pop_flags) r.id = r.id ?? nextId++;
  const sb = {
    isEnabled: () => enabled,
    select: (...a) => fake.select(...a),
    selectAllPaged: (...a) => fake.selectAllPaged(...a),
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
  const e = { tables: t, fake, upserts, clock: KILL + 20_000 };
  e.hb = hailBoard.create({ supabase: sb, guildId: 'g', now: () => e.clock, log: { warn() {} } });
  e.boot = () => hailBoard.create({ supabase: sb, guildId: 'g', now: () => e.clock, log: { warn() {} } });
  e.calls = (table, re) => fake.calls.filter(c => c.table === table && (!re || re.test(c.query))).length;
  e.flag = (character, flagKey, source, when, extra = {}) =>
    t.pop_flags.push({ id: nextId++, guild_id: 'g', character, flag_key: flagKey, source, npc: null, zone: null, earned_at: when, ...extra });
  e.advance = (ms) => { e.clock += ms; };
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

  it('opens by name for bosses the board does not carry, and a Tylis window is the ten minutes his script gives', async () => {
    const e = env({ raid_roster: rosterRows(RAID, 'u1') });
    const marr = await e.hb.openWindow({ bossName: 'Lord Mithaniel Marr', killedAtMs: KILL });
    expect(marr).toMatchObject({ boss_id: 'lord_mithaniel_marr', zone: 'Temple of Marr', expires_at: at(20) });
    const keeper = await e.hb.openWindow({ bossName: 'The Keeper of Sorrows', killedAtMs: KILL });
    expect(keeper).toMatchObject({ npc_name: 'Tylis Newleaf', expires_at: at(10) });
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

  it('falls back to the fight\'s participants when no roster is fresh, and opens nothing when there is nobody', async () => {
    const e = env();
    expect(await e.hb.openWindow({ bossId: 'saryrn', killedAtMs: KILL })).toBeNull();
    const w = await e.hb.openWindow({ bossId: 'saryrn', killedAtMs: KILL, participants: ['Aldenmar', 'Brackwyn', 'Aldenmar', 'a bat'] });
    expect(w.roster).toEqual(['Aldenmar', 'Brackwyn']);
    expect(w.uploaders).toEqual([]);
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
  // tick twice; the Arbitor of Earth has no FLAG_LIMIT but MAX_KEYS = 54.
  const SCRIPTS = {
    grummus: [72, 20], bertoxxulous: [72, 20], terris_thule: [72, 20], aerin_dar: [72, 20], saryrn: [72, 20],
    keeper_of_sorrows: [72, 10], lord_mithaniel_marr: [72, 20], manaetic_behemoth: [72, 10],
    tallon_zek: [72, 20], vallon_zek: [72, 20], rallos_zek_warlord: [72, 20], solusek_ro: [72, 20],
    arbitor_of_earth: [54, 20],
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
    // 56 raiders with a letters-only name each (the roster validator), all granted: more than the Arbitor's 54 keys.
    const names = Array.from({ length: 56 }, (_, i) => 'Raider' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)));
    const e = env({ raid_roster: rosterRows(names, 'u1') });
    await e.hb.openWindow({ bossId: 'arbitor_of_earth', killedAtMs: KILL });
    names.slice(0, 50).forEach((n) => e.flag(n, 'earthb_key_1', 'event', at(2)));
    expect((await e.hb.getBoard()).windows[0]).toMatchObject({ flag_cap: 54, flags_granted: 50, flags_left: 4 });
    names.slice(50).forEach((n) => e.flag(n, 'earthb_key_1', 'event', at(3)));
    e.advance(6_000);
    expect((await e.hb.getBoard()).windows[0]).toMatchObject({ flag_cap: 54, flags_granted: 56, flags_left: 0 });
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
    new Function('recordKill', `${wrapper}\nreturn { onKillRecorded, recordKillNotifying };`)(recordKill);

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
});
