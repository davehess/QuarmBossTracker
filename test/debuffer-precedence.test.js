// test/debuffer-precedence.test.js — the debuffer's landing takes precedence (the guild lead, 2026-11-01).
//
// The report, raid night: Target Info showed "🐌 SLOWED?" on a conjured automaton although a raid shaman had slowed it,
// and its debuff list read "Turgur's Insects (<a raider>) 659/65 · 1h05". Two causes:
//   1. The badge read only THIS agent's own tracker. The shaman's agent knew the exact spell, but its landing came
//      back only through the bot's target-buffs relay, which never reached the badge; the reader saw the shared
//      "yawns." emote alone: an ambiguous slow, and "?" because the emote names no spawn.
//   2. One PC stamped its log an hour AHEAD (the clocks had gone back), so the relay row's time left was an hour
//      longer than the spell.
// The rule: a landing reported by its CASTER (the relay's `by_caster`, from the bot's self_cast column) outranks a
// bystander's landing of the same effect, in the badge and in the debuff list; a caster landing with no spawn id
// still counts for the mob on screen; one tied to a DIFFERENT spawn does not; and an hour-ahead landing is put
// back or dropped.
//
// Runs the REAL functions sliced from the agent and the bot. Names are invented example tokens.
// Run: npx vitest run test/debuffer-precedence.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, AGENT_INDEX, BOT_INDEX, ROOT } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const bot = readSource(BOT_INDEX);
const slowBlock = sliceBlock(agent, 'const SLOW_SPELLS = new Set([', '// ── end #130 slow status');
const mergeBlock = sliceBlock(agent, 'function _reconcileLandingClock(', '\n// Name the caster of each Target Info effect');

function build() {
  // eslint-disable-next-line no-new-func
  return new Function(`
    const _zealState = {};
    function _pushOverlay() {}
    function _rampageOnMainTarget() { return false; }
    function _durTicksForLevel(f, d) { return Number(d) || 0; }
    function _assumedCasterLevel() { return 60; }
    function _normMobNameAgent(n) { return String(n || '').toLowerCase(); }
    ${slowBlock}
    ${mergeBlock}
    return { _noteSlowForTarget, _noteRemoteCasterSlows, _bestSlowForTarget, _remoteSlowsByTarget, _slowsByTarget,
             _reconcileLandingClock, _sanitizeRemoteBuffs, _applyDebufferPrecedence, _slowSameFamily };
  `)();
}

const MOB = 'A Conjured Automaton';
const MOBL = MOB.toLowerCase();
const HOUR = 3600000;
// A bystander's view of the shared "yawns." emote: the crowned guess, flagged ambiguous (parseDebuffLanding's shape).
const emote = (h, atMs = Date.now()) => h._noteSlowForTarget({
  spell_name: "Turgur's Insects", target: MOB, cast_at: new Date(atMs).toISOString(), dur_formula: 7, dur_ticks: 65,
  ambiguous: true, family: ["Turgur's Insects", "Togor's Insects", "Tagar's Insects", 'Walking Sleep', 'Drowsy'],
}, null);
// A relay row as the bot sends it (target-buffs): the caster's own report of a 65-tick (390 s) slow.
const relayRow = (over = {}) => ({
  name: "Togor's Insects", observed_at_ms: Date.now() - 20000, total_secs: 390, remaining_secs: 370,
  owner: 'Brackwyn', by_caster: true, target_id: null, good: null, ...over,
});
const feed = (h, rows, wantId = null, now = Date.now()) =>
  h._noteRemoteCasterSlows(MOB, h._sanitizeRemoteBuffs(rows, now, wantId));

describe('the slow badge: the debuffer outranks the emote', () => {
  it('a bystander emote alone is "SLOWED" (the baseline this rule improves on)', () => {
    const h = build();
    emote(h);
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).toMatchObject({ ambiguous: true, display_name: 'SLOWED' });
  });

  it('a caster landing beats the emote: named spell, percentage, "by <caster>", not ambiguous', () => {
    const h = build();
    emote(h);
    feed(h, [relayRow()]);
    const b = h._bestSlowForTarget(MOBL, Date.now(), null);
    expect(b).toMatchObject({ name: "Togor's Insects", magnitude: 70, caster: 'Brackwyn', ambiguous: false, uncertain: false });
    expect(b.remaining_secs).toBeGreaterThan(300);
  });

  it('it wins even when the emote\'s crowned guess is the STRONGER slow (75% vs 70%)', () => {
    const h = build();
    emote(h);   // crowned Turgur's, 75%
    feed(h, [relayRow({ name: "Togor's Insects" })]);   // 70%
    expect(h._bestSlowForTarget(MOBL, Date.now(), null).name).toBe("Togor's Insects");
  });

  it('a caster landing with NO spawn id is certain for a reader that has one (no "?")', () => {
    const h = build();
    emote(h);
    feed(h, [relayRow()], 4425);
    const b = h._bestSlowForTarget(MOBL, Date.now(), 4425);
    expect(b).toMatchObject({ name: "Togor's Insects", caster: 'Brackwyn', ambiguous: false, uncertain: false });
  });

  it('a caster landing tied to a DIFFERENT spawn is excluded: the emote stays uncertain', () => {
    const h = build();
    emote(h);
    // Entries are what _noteRemoteCasterSlows stores; the sanitizer would already have dropped this row for a
    // reader on 4425, so go around it to prove the badge's own id rule as well.
    h._noteRemoteCasterSlows(MOB, [relayRow({ target_id: 4471 })]);
    const b = h._bestSlowForTarget(MOBL, Date.now(), 4425);
    expect(b).toMatchObject({ ambiguous: true, uncertain: true });
    expect(b.caster).toBeNull();
  });

  it('a caster landing tied to THIS spawn is certain', () => {
    const h = build();
    h._noteRemoteCasterSlows(MOB, [relayRow({ target_id: 4425 })]);
    expect(h._bestSlowForTarget(MOBL, Date.now(), 4425)).toMatchObject({ caster: 'Brackwyn', uncertain: false });
  });

  it('a bystander of ANOTHER family is not displaced by the caster', () => {
    const h = build();
    // "slows down." family (Tepid Deeds ...), 50%: nothing the "yawns." caster's landing could have been.
    h._noteSlowForTarget({ spell_name: 'Tepid Deeds', target: MOB, cast_at: new Date().toISOString(), dur_formula: 7, dur_ticks: 65,
      ambiguous: true, family: ['Tepid Deeds', 'Forlorn Deeds'] }, null);
    feed(h, [relayRow({ name: 'Walking Sleep' })]);   // 35%, a "yawns." caster; the stronger other-family emote stays
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).toMatchObject({ ambiguous: true, display_name: 'SLOWED' });
  });

  it('a relay row that is not a caster report never reaches the badge', () => {
    const h = build();
    feed(h, [relayRow({ by_caster: false })]);
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).toBeNull();
  });

  it('an empty relay answer clears what the last one stored', () => {
    const h = build();
    feed(h, [relayRow()]);
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).not.toBeNull();
    feed(h, []);
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).toBeNull();
  });

  it('a relayed slow that has run out is gone', () => {
    const h = build();
    feed(h, [relayRow({ observed_at_ms: Date.now() - 400000, total_secs: 390 })]);
    expect(h._bestSlowForTarget(MOBL, Date.now(), null)).toBeNull();
  });
});

describe('a clock an hour ahead is put back, or the landing is dropped', () => {
  const now = Date.UTC(2026, 10, 1, 21, 0, 0);

  it('_reconcileLandingClock: a sane landing is untouched', () => {
    const h = build();
    expect(h._reconcileLandingClock(now - 30000, 390, now)).toEqual({ castAtMs: now - 30000, shifted: false });
  });

  it('an hour ahead, and still inside the length once put back: shifted by one hour', () => {
    const h = build();
    // Landed 36 s ago by the real clock, stamped 59.4 minutes ahead (the 659/65 row).
    const stamped = now - 36000 + HOUR;
    expect(h._reconcileLandingClock(stamped, 390, now)).toEqual({ castAtMs: now - 36000, shifted: true });
  });

  it('two hours ahead is shifted by two', () => {
    const h = build();
    expect(h._reconcileLandingClock(now - 10000 + 2 * HOUR, 390, now)).toEqual({ castAtMs: now - 10000, shifted: true });
  });

  it('an hour ahead but it would already have worn off: dropped', () => {
    const h = build();
    expect(h._reconcileLandingClock(now - 500000 + HOUR, 390, now)).toBeNull();
  });

  it('minutes ahead, no whole hour explains it: dropped', () => {
    const h = build();
    expect(h._reconcileLandingClock(now + 10 * 60000, 390, now)).toBeNull();
  });

  it('seconds ahead is ordinary skew between two PCs: kept as just landed', () => {
    const h = build();
    expect(h._reconcileLandingClock(now + 45000, 390, now)).toEqual({ castAtMs: now, shifted: false });
  });

  it('a length-less landing more than 2 minutes ahead is shifted too; under 2 minutes is kept', () => {
    const h = build();
    expect(h._reconcileLandingClock(now - 5000 + HOUR, 0, now)).toEqual({ castAtMs: now - 5000, shifted: true });
    expect(h._reconcileLandingClock(now + 60000, 0, now)).toEqual({ castAtMs: now + 60000, shifted: false });
  });

  it('_sanitizeRemoteBuffs shows the hour-ahead row with the right time left', () => {
    const h = build();
    const row = { name: "Turgur's Insects", observed_at_ms: now - 36000 + HOUR, total_secs: 390, remaining_secs: 3954, owner: 'Brackwyn' };
    const [fixed] = h._sanitizeRemoteBuffs([row], now, null);
    expect(fixed.remaining_secs).toBe(354);   // 390 - 36, not 3954
    expect(fixed.observed_at_ms).toBe(now - 36000);
    expect(fixed.clock_shifted).toBe(true);
    expect(row.remaining_secs).toBe(3954);    // the relay's row is not mutated
  });

  it('_sanitizeRemoteBuffs drops what cannot be placed and leaves a sane row as the same object', () => {
    const h = build();
    const sane = { name: 'Tashania', observed_at_ms: now - 5000, total_secs: 240, remaining_secs: 235 };
    const out = h._sanitizeRemoteBuffs([
      sane,
      { name: 'Malosini', observed_at_ms: now - 900000 + HOUR, total_secs: 390, remaining_secs: 2700 },   // expired once put back
      { name: 'Splurt', observed_at_ms: now + 15 * 60000, total_secs: 390, remaining_secs: 390 },        // 15 min ahead
    ], now, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(sane);
  });

  it('_sanitizeRemoteBuffs leaves out a row proven to be another spawn', () => {
    const h = build();
    const out = h._sanitizeRemoteBuffs([{ name: 'Tashania', observed_at_ms: now - 5000, total_secs: 240, target_id: 4471 }], now, 4425);
    expect(out).toHaveLength(0);
    expect(h._sanitizeRemoteBuffs([{ name: 'Tashania', observed_at_ms: now - 5000, total_secs: 240, target_id: null }], now, 4425)).toHaveLength(1);
  });

  it('end to end: the hour-ahead caster row reaches the badge with the right time left', () => {
    const h = build();
    const t = Date.now();
    feed(h, [relayRow({ observed_at_ms: t - 36000 + HOUR, remaining_secs: 3954 })], null, t);
    const b = h._bestSlowForTarget(MOBL, t, null);
    expect(b.remaining_secs).toBeGreaterThan(340);
    expect(b.remaining_secs).toBeLessThanOrEqual(354);
    expect(b.total_secs).toBe(390);
  });
});

describe('the debuff list: the debuffer\'s row replaces a bystander\'s of the same effect', () => {
  const local = (name, over = {}) => ({ name, remaining_secs: 300, total_secs: 390, good: 0, ...over });

  it('the same spell: the caster\'s relay row replaces the local bystander row', () => {
    const h = build();
    const out = h._applyDebufferPrecedence([local("Turgur's Insects")], [relayRow({ name: "Turgur's Insects" })]);
    expect(out.local).toHaveLength(0);
    expect(out.remote).toHaveLength(1);
    expect(out.remote[0]).toMatchObject({ name: "Turgur's Insects", caster: 'Brackwyn' });
  });

  it('the same shared-emote family: the local crowned guess goes, the caster\'s named spell stays', () => {
    const h = build();
    const out = h._applyDebufferPrecedence([local("Turgur's Insects")], [relayRow({ name: "Togor's Insects" })]);
    expect(out.local).toHaveLength(0);
    expect(out.remote.map(b => b.name)).toEqual(["Togor's Insects"]);
  });

  it('a bystander relay row of the same family goes too; the caster\'s stays', () => {
    const h = build();
    const out = h._applyDebufferPrecedence([], [
      relayRow({ name: "Togor's Insects" }),
      relayRow({ name: "Turgur's Insects", by_caster: false, owner: 'Corvale' }),
    ]);
    expect(out.remote.map(b => b.name)).toEqual(["Togor's Insects"]);
  });

  it('our own cast (local by_caster) is never replaced', () => {
    const h = build();
    const mine = local("Turgur's Insects", { by_caster: true, caster: 'Aldenmar' });
    const out = h._applyDebufferPrecedence([mine], [relayRow({ name: "Turgur's Insects" })]);
    expect(out.local).toEqual([mine]);
  });

  it('unrelated rows are untouched, and with no caster row nothing changes', () => {
    const h = build();
    const tash = local('Tashania');
    const bys = relayRow({ name: "Turgur's Insects", by_caster: false });
    const out = h._applyDebufferPrecedence([tash, local("Turgur's Insects")], [bys]);
    expect(out.local).toHaveLength(2);
    expect(out.remote).toEqual([bys]);
    const withCaster = h._applyDebufferPrecedence([tash], [relayRow({ name: "Togor's Insects" })]);
    expect(withCaster.local).toEqual([tash]);
  });

  it('_slowSameFamily: same name, listed possibility, shared emote; not a different family', () => {
    const h = build();
    expect(h._slowSameFamily('Tashania', { name: 'Tashania' })).toBe(true);
    expect(h._slowSameFamily("Togor`s Insects", { name: "Togor's Insects" })).toBe(true);
    expect(h._slowSameFamily('Drowsy', { name: "Turgur's Insects", family: ['Drowsy'] })).toBe(true);
    expect(h._slowSameFamily("Togor's Insects", { name: "Turgur's Insects" })).toBe(true);
    expect(h._slowSameFamily("Togor's Insects", { name: 'Tepid Deeds' })).toBe(false);
  });
});

describe('the wiring', () => {
  const clean = stripJs(agent);
  it('Target Info clock-corrects the relay, feeds the badge, and applies the precedence before merging', () => {
    expect(clean).toContain('_sanitizeRemoteBuffs((ctb && Array.isArray(ctb.buffs)) ? ctb.buffs : [], nowRelay, _curIdForRelay)');
    expect(clean).toContain('_noteRemoteCasterSlows(st.target_name, remoteOk)');
    expect(clean).toContain('_applyDebufferPrecedence(targetBuffsFor(tnameLower, _curIdForRelay), remoteOk)');
  });
  it('a landing from our own cast carries by_caster out of targetBuffsFor', () => {
    expect(clean).toContain('...((b && b.cast_by) ? { by_caster: true, caster: b.cast_by } : {})');
  });
});

describe('the bot: carries who cast it', () => {
  const cleanBot = stripJs(bot);
  it('ingest stores the agent\'s self-cast flag, and target-buffs selects and serves it', () => {
    expect(cleanBot).toMatch(/self_cast:\s+c\._selfCast === true/);
    expect(cleanBot).toContain('&select=spell_name,dur_ticks,cast_at,observer,is_charm_spell,target_id,self_cast&order=cast_at.desc');
    expect(cleanBot).toContain('by_caster:      !!v.row.self_cast');
  });

  // The per-spell pick, run for real: newest wins, but the caster's own report beats a bystander's of the SAME cast.
  const pick = sliceBlock(bot, '    const bySpell = new Map();', '    const buffs = [];');
  function run(rows, now) {
    // eslint-disable-next-line no-new-func
    return new Function('rows', 'now', 'requesterZone', 'zoneMap', '_nameZones', 'targetId',
      '_zoneScopeKeepForName', '_idScopeKeep', '_isJunkSpellName',
      pick + '\nreturn [...bySpell.values()].map(v => v.row.observer);')(
      rows, now, null, new Map(), 1, null, () => true, () => true, () => false);
  }
  const now = Date.now();
  const row = (observer, ageSec, self_cast) => ({
    spell_name: "Togor's Insects", dur_ticks: 65, observer, self_cast, target_id: null,
    cast_at: new Date(now - ageSec * 1000).toISOString(),
  });
  it('a caster\'s row beats a bystander\'s newer-by-seconds row of the same cast', () => {
    // Newest first, as the query returns them: the bystander is 3 s newer.
    expect(run([row('Corvale', 20, false), row('Brackwyn', 23, true)], now)).toEqual(['Brackwyn']);
  });
  it('a clearly newer bystander row is a recast and still wins', () => {
    expect(run([row('Corvale', 5, false), row('Brackwyn', 60, true)], now)).toEqual(['Corvale']);
  });
  it('with no caster row, the newest wins as before', () => {
    expect(run([row('Corvale', 5, false), row('Zarrin', 9, false)], now)).toEqual(['Corvale']);
  });
});

describe('the migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261102090000_buff_casts_self_cast.sql'), 'utf8'));
  it('adds the column and promotes a stored row when the caster\'s copy lost the dedup race', () => {
    expect(sql).toMatch(/add column if not exists self_cast boolean not null default false/i);
    expect(sql).toMatch(/on conflict do nothing/i);
    expect(sql).toMatch(/set self_cast = true/i);
    expect(sql).toMatch(/revoke all on function public\.insert_buff_casts\(jsonb\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.insert_buff_casts\(jsonb\) to service_role/);
  });
});
