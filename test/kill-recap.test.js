// test/kill-recap.test.js — the "how did we do" recap on a raid boss's kill card.
//
// The guild lead, 2026-10-13: after a raid boss kill, a short recap ("how much faster than last time") on the
// card the bot already posts, the same recap on wolfpack.quest/screen, with fun events and honest highlights.
// What can go wrong without anyone noticing:
//   * a recap that flatters (a "record" off one prior kill, a personal best off a single data point, "nobody
//     died" about a fight whose deaths we could not read);
//   * a death from twenty minutes AFTER the fight (uploads carry them) counted against this kill;
//   * a 37-raider kill compared by clock against a 21-raider one;
//   * a fun event from another pull in the room;
//   * a read that PostgREST quietly cut at 1,000 rows, or a failed read turned into a confident recap;
//   * the screen feed serving a stale recap, or anything beyond the named fields.
// buildRecap / assembleInputs are run for real; the loader runs against test/_cap_fake_supabase.js, a fake
// PostgREST that enforces the row cap. Fixture names are invented (Raider01…); none is a member.
//
// Run: npx vitest run test/kill-recap.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const require = createRequire(import.meta.url);
const kr = require('../utils/killRecap.js');
const screenLive = require('../utils/screenLive.js');

const T0 = Date.parse('2026-10-11T01:30:00Z');         // a kill's start
const DAY = 86_400_000;
const nameOf = (i) => `Raider${String(i + 1).padStart(2, '0')}`;
const crew = (n, dmg = 10_000) => Array.from({ length: n }, (_, i) => ({ name: nameOf(i), damage: dmg }));
const prior = (over = {}) => ({
  startedAtMs: T0 - 3 * DAY, durationSec: 100, raiders: 30, damage: 30 * 10_000 * 1, deaths: null, ...over,
});
const kill = (over = {}) => ({ name: 'Manaetic Behemoth', startedAtMs: T0, durationSec: 70, ...over });
const text = (r) => r.lines.join('\n');

describe('buildRecap — what it says about the kill', () => {
  it('a boss we have never killed: "First kill!", no comparison, no invented stars', () => {
    const r = kr.buildRecap({ kill: kill(), priors: [], players: crew(30), deaths: null });
    expect(r.lines[0]).toMatch(/^First kill! Down in 1:10 with 30 raiders/);
    expect(text(r)).not.toMatch(/last time|faster|slower/);
    expect(r.stars.every(s => /^Top damage:/.test(s))).toBe(true);
  });

  it('earlier kills exist but all were small groups: the honest claim is the narrower one', () => {
    const r = kr.buildRecap({ kill: kill(), priors: [prior({ raiders: 4 })], players: crew(30), deaths: null });
    expect(r.lines[0]).toMatch(/^First kill with a full raid!/);
  });

  it('faster than last time says by how much, against the right kill', () => {
    const r = kr.buildRecap({
      kill: kill({ durationSec: 70 }),
      priors: [prior({ startedAtMs: T0 - 8 * DAY, durationSec: 200 }), prior({ startedAtMs: T0 - 3 * DAY, durationSec: 100 })],
      players: crew(30), deaths: null,
    });
    expect(r.lines[0]).toBe('Down in 1:10 — 30s faster than last time (1:40, Oct 7).');
  });

  it('slower than last time says so plainly, and a near-tie is "about the same"', () => {
    const slower = kr.buildRecap({ kill: kill({ durationSec: 130 }), priors: [prior()], players: crew(30), deaths: null });
    expect(slower.lines[0]).toMatch(/30s slower than last time/);
    const same = kr.buildRecap({ kill: kill({ durationSec: 101 }), priors: [prior()], players: crew(30), deaths: null });
    expect(same.lines[0]).toMatch(/about the same as last time/);
  });

  it('raid DPS is raiders\' damage over the fight, compared with last time\'s the same way', () => {
    // 30 raiders x 10,000 over 70 s = 4,286 vs 300,000 over 100 s = 3,000: +43%.
    const r = kr.buildRecap({ kill: kill(), priors: [prior()], players: crew(30), deaths: null });
    expect(text(r)).toContain('Raid DPS 4,286 — up 43% on last time (3,000).');
  });

  it('a raid of a very different size leads with DPS per raider, not the clock', () => {
    const r = kr.buildRecap({
      kill: kill({ durationSec: 100 }),
      priors: [prior({ raiders: 37, damage: 37 * 10_000, durationSec: 100 })],   // 100 per raider
      players: crew(20, 15_000), deaths: null,                                    // 150 per raider
    });
    expect(r.lines[0]).toBe('150 DPS per raider — 50% higher than last time (100), with 20 raiders against 37.');
    expect(text(r)).not.toMatch(/Raid DPS/);
    // inside the 25% band the clock leads and the raid-wide DPS line is used instead
    const close = kr.buildRecap({ kill: kill(), priors: [prior({ raiders: 27 })], players: crew(30), deaths: null });
    expect(close.lines[0]).toMatch(/^Down in/);
    expect(text(close)).toMatch(/Raid DPS/);
  });

  it('a DPS jump of 3x or more is a partial parse, not news: no DPS line and no personal-best star', () => {
    const r = kr.buildRecap({
      kill: kill(), priors: [prior({ damage: 30 * 1000 })],                    // last time's parse barely saw damage
      players: crew(30), deaths: null,
      personalBests: [{ name: nameOf(0), priorKills: 3, priorBestDps: 10 }],
    });
    expect(text(r)).not.toMatch(/DPS/);
    expect(r.stars.join('\n')).not.toMatch(/personal best/);
    expect(r.lines[0]).toMatch(/faster than last time/);                       // the clock is still honest
  });

  it('too few raiders on the parse, or no damage: nothing honest to say', () => {
    expect(kr.buildRecap({ kill: kill(), priors: [], players: crew(9), deaths: null })).toBeNull();
    expect(kr.buildRecap({ kill: kill(), priors: [], players: crew(12, 0), deaths: null })).toBeNull();
    expect(kr.buildRecap({ kill: kill({ durationSec: 0 }), priors: [], players: crew(12), deaths: null })).toBeNull();
  });

  it('deaths: a count against last time, "nobody died" only when the deaths were readable', () => {
    const base = { kill: kill(), priors: [prior({ deaths: 6 })], players: crew(30) };
    const some = kr.buildRecap({ ...base, deaths: [{ name: 'Raider01', ts: T0 }, { name: 'Raider02', ts: T0 }] });
    expect(text(some)).toContain('2 deaths (last time 6).');
    const none = kr.buildRecap({ ...base, deaths: [] });
    expect(text(none)).toContain('Nobody died (last time 6).');
    const unreadable = kr.buildRecap({ ...base, deaths: null });
    expect(text(unreadable)).not.toMatch(/died|death/);
    expect(unreadable.stars.join('\n')).not.toMatch(/Flawless/);
    // last time's deaths unreadable (old parse): no "(last time …)" claim
    const oldPrior = kr.buildRecap({ kill: kill(), priors: [prior({ deaths: null })], players: crew(30), deaths: [] });
    expect(text(oldPrior)).toContain('Nobody died.');
  });
});

describe('buildRecap — the stars are honest or absent', () => {
  const three = [prior({ startedAtMs: T0 - 9 * DAY, durationSec: 120 }), prior({ startedAtMs: T0 - 6 * DAY, durationSec: 90 }), prior({ startedAtMs: T0 - 3 * DAY, durationSec: 100 })];

  it('a record needs at least two comparable priors and a time under the best', () => {
    const rec = kr.buildRecap({ kill: kill({ durationSec: 60 }), priors: three, players: crew(30), deaths: null });
    expect(rec.stars[0]).toBe('New record — fastest Manaetic Behemoth yet: 1:00, 30s under the old best (1:30).');
    // one prior only: faster than last time, but not a "record"
    const one = kr.buildRecap({ kill: kill({ durationSec: 60 }), priors: [three[2]], players: crew(30), deaths: null });
    expect(one.stars.join('\n')).not.toMatch(/record/);
    // not under the best: no star, and the best is named on a line instead
    const no = kr.buildRecap({ kill: kill({ durationSec: 95 }), priors: three, players: crew(30), deaths: null });
    expect(no.stars.join('\n')).not.toMatch(/record/);
    expect(text(no)).toContain('Our best is 1:30 (Oct 4).');
  });

  it('a small earlier kill is not a record to beat', () => {
    const r = kr.buildRecap({
      kill: kill({ durationSec: 60 }), players: crew(30), deaths: null,
      priors: [prior({ durationSec: 20, raiders: 3 }), prior({ durationSec: 90 }), prior({ durationSec: 100, startedAtMs: T0 - 2 * DAY })],
    });
    expect(r.stars[0]).toMatch(/under the old best \(1:30\)/);
  });

  it('flawless needs readable deaths and zero of them', () => {
    const r = kr.buildRecap({ kill: kill(), priors: [], players: crew(30), deaths: [] });
    expect(r.stars).toContain('Flawless — nobody died, 30 raiders.');
  });

  it('a personal best needs two earlier kills and a real gain', () => {
    const base = { kill: kill(), priors: [prior()], players: crew(30, 10_000), deaths: null };   // each raider: 142.9 dps
    const mk = (priorKills, priorBestDps) => kr.buildRecap({ ...base, personalBests: [{ name: 'Raider05', priorKills, priorBestDps }] }).stars.join('\n');
    expect(mk(2, 100)).toContain('Raider05 set a personal best on Manaetic Behemoth: 143 DPS, up from 100.');
    expect(mk(1, 100)).not.toMatch(/personal best/);        // one earlier kill is a coin flip, not a trend
    expect(mk(3, 140)).not.toMatch(/personal best/);        // 2% better is noise
    expect(mk(3, 0)).not.toMatch(/personal best/);
  });

  it('only the biggest personal best is named, and at most three stars come back', () => {
    const r = kr.buildRecap({
      kill: kill({ durationSec: 60 }), priors: three, players: crew(30), deaths: [],
      personalBests: [{ name: 'Raider02', priorKills: 3, priorBestDps: 150 }, { name: 'Raider03', priorKills: 3, priorBestDps: 100 }],
    });
    expect(r.stars).toHaveLength(3);
    expect(r.stars.join('\n')).toMatch(/Raider03 set a personal best/);
    expect(r.stars.join('\n')).not.toMatch(/Raider02 set/);
  });

  it('the top damage line carries the raider\'s share', () => {
    const players = crew(30, 10_000); players[4] = { name: 'Raider05', damage: 40_000 };
    const r = kr.buildRecap({ kill: kill(), priors: [], players, deaths: null });
    expect(r.stars.at(-1)).toBe('Top damage: Raider05 — 40k (12% of the raid).');
  });
});

describe('buildRecap — fun events', () => {
  const ev = (type, dt, caster = 'Raider01') => ({ type, caster, atMs: T0 + dt * 1000 });

  it('lists only events inside the fight +/- a minute, most frequent first', () => {
    const r = kr.buildRecap({
      kill: kill({ durationSec: 70 }), priors: [], players: crew(30), deaths: null,
      funEvents: [
        ev('dragon_punch', 10, 'Raider01'), ev('dragon_punch', 20, 'Raider02'), ev('dragon_punch', -59, 'Raider03'),
        ev('dragon_punch', -61, 'Raider04'),               // a minute and a second before the pull
        ev('dragon_punch', 70 + 61, 'Raider05'),           // after the fight window closed
        ev('drunkard', 30, 'Raider06'),
        ev('pvp_flag_on', 30, 'Raider07'),                 // not a fun line
      ],
    });
    expect(r.fun).toEqual(['🥊 3 dragon punches — Raider01, Raider02, Raider03', '🍺 1 drunken stumble — Raider06']);
  });

  it('many casters read as a count, and no more than three lines appear', () => {
    const many = Array.from({ length: 9 }, (_, i) => ev('dragon_punch', 5, nameOf(i)));
    const r = kr.buildRecap({
      kill: kill(), priors: [], players: crew(30), deaths: null,
      funEvents: [...many, ev('drunkard', 1), ev('hot_dice', 2), ev('deathroll', 3), ev('mana_twitch', 4)],
    });
    expect(r.fun[0]).toBe('🥊 9 dragon punches (9 raiders)');
    expect(r.fun).toHaveLength(3);
  });

  it('a quiet fight has no fun lines', () => {
    expect(kr.buildRecap({ kill: kill(), priors: [], players: crew(30), deaths: null, funEvents: [] }).fun).toEqual([]);
  });
});

describe('assembleInputs — which rows count', () => {
  const roster = new Set(Array.from({ length: 60 }, (_, i) => nameOf(i).toLowerCase()));
  const startIso = new Date(T0).toISOString();
  const enc = (over = {}) => ({ id: 'k', npc_id: 1, started_at: startIso, ended_at: new Date(T0 + 70_000).toISOString(), duration_sec: 70, classification: null, data_incomplete: false, ...over });
  const plr = (id, n, dmg = 10_000) => Array.from({ length: n }, (_, i) => ({ encounter_id: id, character_name: nameOf(i), total_damage: dmg }));
  const death = (name, dtSec, extra = {}) => ({ name, ts: new Date(T0 + dtSec * 1000).toISOString(), class: 'Warrior', ...extra });
  const rows = (over = {}) => ({ roster, kill: enc(), killPlayers: plr('k', 30), killContribs: [], priorEncs: [], priorPlayers: [], priorContribs: [], funRows: [], ...over });

  it('an unconfirmed, classified or incomplete kill gets no recap', () => {
    expect(kr.assembleInputs(rows({ kill: enc({ ended_at: null }) }))).toBeNull();
    expect(kr.assembleInputs(rows({ kill: enc({ classification: 'pvp' }) }))).toBeNull();
    expect(kr.assembleInputs(rows({ kill: enc({ classification: 'foreign' }) }))).toBeNull();
    expect(kr.assembleInputs(rows({ kill: enc({ data_incomplete: true }) }))).toBeNull();
    expect(kr.assembleInputs(rows())).not.toBeNull();
  });

  it('a parse that is mostly strangers is not our raid', () => {
    const strangers = Array.from({ length: 30 }, (_, i) => ({ encounter_id: 'k', character_name: `Stranger${i}`, total_damage: 10_000 }));
    expect(kr.assembleInputs(rows({ killPlayers: [...plr('k', 10), ...strangers] }))).toBeNull();
    // pets and a few strangers among a real raid are simply not counted as raiders
    const ok = kr.assembleInputs(rows({ killPlayers: [...plr('k', 30), ...strangers.slice(0, 3)] }));
    expect(ok.players).toHaveLength(30);
  });

  it('deaths from long after the fight are clipped off; the fight\'s own are kept', () => {
    const contrib = { dur: 70, deaths: [death('Raider01', 5), death('Raider02', -8), death('Raider03', 20 * 60), death('Raider04', 70 + 11)] };
    const a = kr.assembleInputs(rows({ killContribs: [contrib] }));
    expect(a.deaths.map(d => d.name).sort()).toEqual(['Raider01', 'Raider02']);
  });

  it('a late death does not turn a real in-fight death into a "phantom" (clip first, then dedup)', () => {
    // The same raider appears twice in ONE upload: in the fight and 20 minutes later. Deduping the raw list
    // would call that an NPC namesake and drop both; the late one is not this fight's.
    const a = kr.assembleInputs(rows({ killContribs: [{ dur: 70, deaths: [death('Raider01', 5), death('Raider01', 1200)] }] }));
    expect(a.deaths).toHaveLength(1);
  });

  it('two parsers seeing the same death count it once', () => {
    const a = kr.assembleInputs(rows({ killContribs: [{ dur: 70, deaths: [death('Raider01', 5)] }, { dur: 60, deaths: [death('Raider01', 7)] }] }));
    expect(a.deaths).toHaveLength(1);
  });

  it('no surviving raw_parse means deaths are UNKNOWN (null), not zero', () => {
    expect(kr.assembleInputs(rows({ killContribs: [{ dur: null, deaths: null }, { dur: null, deaths: null }] })).deaths).toBeNull();
    expect(kr.assembleInputs(rows({ killContribs: [{ dur: 70, deaths: null }] })).deaths).toEqual([]);
    expect(kr.assembleInputs(rows({ killContribs: [] })).deaths).toBeNull();
  });

  it('a pet or NPC namesake that is neither on the roster nor classed is not a raider death', () => {
    const a = kr.assembleInputs(rows({ killContribs: [{ dur: 70, deaths: [death('Raider01', 5), death('A Warder', 6, { class: null }), death('Newcomer', 7)] }] }));
    expect(a.deaths.map(d => d.name).sort()).toEqual(['Newcomer', 'Raider01']);   // Newcomer carries a class in the log
  });

  it('priors: earlier, confirmed, unclassified, complete — and only the previous kill carries deaths', () => {
    const p = (id, over = {}) => enc({ id, started_at: new Date(T0 - DAY).toISOString(), ended_at: new Date(T0 - DAY + 90_000).toISOString(), duration_sec: 90, ...over });
    const a = kr.assembleInputs(rows({
      priorEncs: [
        p('ok'),
        p('later', { started_at: new Date(T0 + DAY).toISOString() }),
        p('pvp', { classification: 'pvp' }),
        p('foreign', { classification: 'foreign' }),
        p('partial', { data_incomplete: true }),
        p('open', { ended_at: null }),
      ],
      priorPlayers: [...plr('ok', 30), ...plr('later', 30), ...plr('pvp', 30), ...plr('foreign', 30), ...plr('partial', 30), ...plr('open', 30)],
      priorContribs: [{ encounter_id: 'ok', dur: 80, deaths: [{ name: 'Raider01', ts: new Date(T0 - DAY + 10_000).toISOString(), class: 'Monk' }] }],
    }));
    expect(a.priors.map(x => x.id)).toEqual(['ok']);
    expect(a.priors[0]).toMatchObject({ raiders: 30, durationSec: 90, deaths: 1 });
  });

  it('personal bests come from comparable priors only, per raider', () => {
    const p = (id, dtDays) => enc({ id, started_at: new Date(T0 - dtDays * DAY).toISOString(), ended_at: new Date(T0 - dtDays * DAY + 100_000).toISOString(), duration_sec: 100 });
    const a = kr.assembleInputs(rows({
      priorEncs: [p('a', 3), p('b', 2), p('tiny', 1)],
      priorPlayers: [...plr('a', 30, 20_000), ...plr('b', 30, 30_000), ...plr('tiny', 3, 90_000)],   // the 3-raider kill is ignored
    }));
    const pb = a.personalBests.find(x => x.name === 'Raider01');
    expect(pb).toEqual({ name: 'Raider01', priorKills: 2, priorBestDps: 300 });
  });

  it('fun rows are kept only for the listed kinds', () => {
    const a = kr.assembleInputs(rows({ funRows: [{ event_type: 'drunkard', caster: 'Raider01', event_ts: startIso }, { event_type: 'pvp_flag_on', caster: 'Raider02', event_ts: startIso }] }));
    expect(a.funEvents.map(f => f.type)).toEqual(['drunkard']);
  });
});

describe('loadRecap — the reads', () => {
  const GUILD = 'wolfpack';
  const iso = (ms) => new Date(ms).toISOString();
  let sb, fake;

  function world({ extraPriors = 0, brownout = null } = {}) {
    const encounters = [{ id: 'k1', guild_id: GUILD, npc_id: 206046, started_at: iso(T0), ended_at: iso(T0 + 70_000), duration_sec: 70, classification: null, data_incomplete: false }];
    const encounter_players = [];
    const contributions = [];
    const addFight = (id, startMs, dur, n, dmg) => {
      for (let i = 0; i < n; i++) encounter_players.push({ encounter_id: id, character_name: nameOf(i), total_damage: dmg });
      contributions.push({ encounter_id: id, deaths: null, dur });
    };
    addFight('k1', T0, 70, 30, 10_000);
    contributions.push({ encounter_id: 'k1', deaths: [{ name: 'Raider01', ts: iso(T0 + 5000), class: 'Cleric' }, { name: 'Raider02', ts: iso(T0 + 3_600_000), class: 'Cleric' }], dur: 70 });
    // priors: one day apart, each with 30 raiders, plus a pile of extras to cross the 1,000-row cap in players
    const n = 3 + extraPriors;
    for (let j = 1; j <= n; j++) {
      const id = `p${j}`;
      const s = T0 - j * DAY;
      encounters.push({ id, guild_id: GUILD, npc_id: 206046, started_at: iso(s), ended_at: iso(s + 100_000), duration_sec: 100, classification: null, data_incomplete: false });
      addFight(id, s, 100, 30, 9_000);
    }
    encounters.push({ id: 'other', guild_id: GUILD, npc_id: 999, started_at: iso(T0 - DAY), ended_at: iso(T0 - DAY + 1000), duration_sec: 50, classification: null, data_incomplete: false });
    const tables = {
      encounters, encounter_players, contributions,
      characters: Array.from({ length: 60 }, (_, i) => ({ guild_id: GUILD, name: nameOf(i) })),
      fun_events: [
        { guild_id: GUILD, event_type: 'dragon_punch', caster: 'Raider03', event_ts: iso(T0 + 10_000) },
        { guild_id: GUILD, event_type: 'dragon_punch', caster: 'Raider04', event_ts: iso(T0 + 10 * 60_000) },
      ],
    };
    if (brownout) tables[brownout] = () => { throw new Error('unused'); };
    return tables;
  }

  beforeEach(() => { kr._resetRosterMemo(); });

  it('builds the recap from the database, with prior kills before this one only', async () => {
    fake = makeCapFake({ tables: world() });
    const r = await kr.loadRecap({ supabase: fake, guildId: GUILD, encounterId: 'k1', bossName: 'Manaetic Behemoth', nowMs: T0 });
    expect(r.boss).toBe('Manaetic Behemoth');
    expect(r.npcId).toBe(206046);
    expect(r.killedAtMs).toBe(T0 + 70_000);
    expect(r.lines[0]).toMatch(/30s faster than last time \(1:40, Oct 9\)/);
    expect(r.lines.join('\n')).toContain('1 death (last time 0).');   // the death an hour later is clipped
    expect(r.fun).toEqual(['🥊 1 dragon punch — Raider03']);    // the one ten minutes later is outside the window
  });

  it('a kill that is not confirmed, or not there, gives null', async () => {
    const t = world(); t.encounters[0].ended_at = null;
    expect(await kr.loadRecap({ supabase: makeCapFake({ tables: t }), guildId: GUILD, encounterId: 'k1', bossName: 'X' })).toBeNull();
    expect(await kr.loadRecap({ supabase: makeCapFake({ tables: world() }), guildId: GUILD, encounterId: 'nope', bossName: 'X' })).toBeNull();
  });

  it('reads every prior\'s players even past the 1,000-row cap', async () => {
    // 40 priors x 30 raiders = 1,200 rows: a single capped read would drop the oldest priors' players.
    fake = makeCapFake({ tables: world({ extraPriors: 37 }) });
    const rows = await kr.fetchRecapRows({ supabase: fake, guildId: GUILD, encounterId: 'k1', nowMs: T0 });
    expect(rows.priorEncs).toHaveLength(40);
    expect(new Set(rows.priorPlayers.map(p => p.encounter_id)).size).toBe(40);
    expect(rows.priorPlayers).toHaveLength(1200);
  });

  it('a failed read is "no recap", never a recap built from half a picture', async () => {
    for (const table of ['encounters', 'encounter_players', 'contributions', 'fun_events', 'characters']) {
      kr._resetRosterMemo();
      const f = makeCapFake({ tables: world(), missing: [table] });
      const out = await kr.loadRecap({ supabase: f, guildId: GUILD, encounterId: 'k1', bossName: 'X' }).then(() => 'resolved', () => 'threw');
      expect(out, table).toBe('threw');
    }
  });

  it('every read names its bound', async () => {
    fake = makeCapFake({ tables: world() });
    await kr.loadRecap({ supabase: fake, guildId: GUILD, encounterId: 'k1', bossName: 'X', nowMs: T0 });
    const sel = fake.calls.filter(c => c.kind === 'select');
    expect(sel.length).toBeGreaterThan(4);
    for (const c of sel) expect(c.qs, `${c.table}: ${c.qs}`).toMatch(/limit=\d+/);
  });
});

describe('recapFieldValue', () => {
  it('is the lines, then the stars, then the fun, and fits a Discord field', () => {
    const v = kr.recapFieldValue({ lines: ['L1', 'L2'], stars: ['S1'], fun: ['F1'] });
    expect(v).toBe('L1\nL2\n\n⭐ S1\n\nF1');
    expect(kr.recapFieldValue({ lines: ['x'.repeat(2000)], stars: [], fun: [] }).length).toBeLessThanOrEqual(1024);
    expect(kr.recapFieldValue(null)).toBe('');
  });
});

describe('the screen feed serves the recap for half an hour', () => {
  const NOW = Date.parse('2026-10-11T02:00:00Z');
  const stored = (over = {}) => ({ boss: 'Manaetic Behemoth', npcId: 206046, killedAt: new Date(NOW - 60_000).toISOString(), lines: ['Down in 1:10'], fun: ['f'], stars: ['s'], ...over });

  it('shape: exactly { boss, npcId, killedAt, lines, fun, stars }', () => {
    const r = screenLive.recapFor({ ...stored(), encounterId: 'secret', extra: 1 }, NOW);
    expect(Object.keys(r).sort()).toEqual(['boss', 'fun', 'killedAt', 'lines', 'npcId', 'stars']);
  });

  it('null when there is none, it is malformed, empty, from the future, or older than 30 minutes', () => {
    expect(screenLive.recapFor(null, NOW)).toBeNull();
    expect(screenLive.recapFor('x', NOW)).toBeNull();
    expect(screenLive.recapFor(stored({ lines: [] }), NOW)).toBeNull();
    expect(screenLive.recapFor(stored({ killedAt: 'soon' }), NOW)).toBeNull();
    expect(screenLive.recapFor(stored({ killedAt: new Date(NOW + 10 * 60_000).toISOString() }), NOW)).toBeNull();
    expect(screenLive.recapFor(stored({ killedAt: new Date(NOW - 29 * 60_000).toISOString() }), NOW)).not.toBeNull();
    expect(screenLive.recapFor(stored({ killedAt: new Date(NOW - 31 * 60_000).toISOString() }), NOW)).toBeNull();
  });

  it('buildPayload carries it, and null when the row is stale', async () => {
    const rt = { liveRows: () => [] };
    const mk = (value) => ({ isEnabled: () => true, select: async (table) => (table === 'bot_kv' ? (value ? [{ value }] : []) : []) });
    screenLive._reset();
    screenLive._setDeps({ supabase: mk(stored()), raidTrack: rt, now: () => NOW });
    expect((await screenLive.buildPayload()).recap).toMatchObject({ boss: 'Manaetic Behemoth', lines: ['Down in 1:10'] });
    screenLive._reset();
    screenLive._setDeps({ supabase: mk(stored({ killedAt: new Date(NOW - 3 * 3600_000).toISOString() })), raidTrack: rt, now: () => NOW });
    expect((await screenLive.buildPayload()).recap).toBeNull();
    screenLive._reset();
  });
});

describe('the card hook (source)', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
  it('adds ONE field to the card it already builds, only for raid bosses, and never throws into the card', () => {
    const i = src.indexOf("name: '⏱️ How we did'");
    expect(i).toBeGreaterThan(0);
    const around = src.slice(i - 900, i + 200);
    expect(around).toMatch(/_isBossCard && _encIdForLink/);
    expect(around).toMatch(/catch \(err\)/);
    expect(src.match(/How we did/g)).toHaveLength(1);        // no second message anywhere
  });
  it('writes the recap to bot_kv, not state.json', () => {
    expect(src).toMatch(/key: _KILL_RECAP_KEY/);
    expect(src).toMatch(/_KILL_RECAP_KEY = 'last_kill_recap'/);
  });
});
