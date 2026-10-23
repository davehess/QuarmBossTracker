// test/open-hub.test.js — the open hub's rules (utils/openHub.js, docs/DESIGN-open-hub.md): who counts toward a
// guild's 12, what the gate does as the count climbs, and how long the hub keeps each usage stream.
//
// The guild lead, 2026-10-23: "anyone can join, once a guild has 12 members they need to stand up their own or
// pay for the 25 hosting. Usage logs will not be kept for long term on my storage, but instead be available in the
// end user's mimic." Names below are invented tags, not people.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const hub = require('../utils/openHub.js');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 15, 0, 0);          // 2026-10-23 15:00 UTC
const dayStr = (ago) => new Date(NOW - ago * DAY).toISOString().slice(0, 10);

// n players p1..pn, each active on `days` distinct recent days under `guild`.
function roster(guild, n, days = 3, role) {
  const rows = [];
  for (let p = 1; p <= n; p++) for (let d = 0; d < days; d++) rows.push({ guild_id: guild, player_id: `${guild}-p${p}`, day: dayStr(d), ...(role ? { role } : {}) });
  return rows;
}

describe('countActivePlayers: members are PLAYERS who actually showed up', () => {
  it('counts distinct players, not rows or characters', () => {
    const { counts } = hub.countActivePlayers(roster('nightfall', 5, 4), { now: NOW });
    expect(counts).toEqual({ nightfall: 5 });
  });

  it('needs MIN_ACTIVE_DAYS distinct days: a single stray upload does not make a member', () => {
    const rows = [...roster('nightfall', 3, 3), { guild_id: 'nightfall', player_id: 'visitor', day: dayStr(1) }];
    expect(hub.countActivePlayers(rows, { now: NOW }).counts.nightfall).toBe(3);
    // the same visitor on a second day does count
    rows.push({ guild_id: 'nightfall', player_id: 'visitor', day: dayStr(2) });
    expect(hub.countActivePlayers(rows, { now: NOW }).counts.nightfall).toBe(4);
  });

  it('ignores days outside the rolling window, and days in the future', () => {
    const rows = [
      { guild_id: 'g', player_id: 'old', day: dayStr(30) }, { guild_id: 'g', player_id: 'old', day: dayStr(31) },   // 30 days ago is outside a 30-day window ending today
      { guild_id: 'g', player_id: 'edge', day: dayStr(29) }, { guild_id: 'g', player_id: 'edge', day: dayStr(28) }, // the oldest day still inside
      { guild_id: 'g', player_id: 'future', day: dayStr(-1) }, { guild_id: 'g', player_id: 'future', day: dayStr(-2) },
    ];
    expect(hub.countActivePlayers(rows, { now: NOW }).players.g).toEqual(['edge']);
  });

  it('never counts a guest', () => {
    const rows = [...roster('nightfall', 4, 3), ...roster('nightfall', 20, 5, 'guest').map(r => ({ ...r, player_id: 'x' + r.player_id }))];
    expect(hub.countActivePlayers(rows, { now: NOW }).counts.nightfall).toBe(4);
  });

  it('counts a player once, in the guild they were active in most', () => {
    const rows = [
      ...['a', 'b', 'c'].flatMap(d => [{ guild_id: 'main-guild', player_id: 'shared', day: dayStr(+({ a: 0, b: 1, c: 2 })[d]) }]),   // 3 days
      { guild_id: 'alt-raids', player_id: 'shared', day: dayStr(0) }, { guild_id: 'alt-raids', player_id: 'shared', day: dayStr(5) }, // 2 days
    ];
    const { counts } = hub.countActivePlayers(rows, { now: NOW });
    expect(counts).toEqual({ 'main-guild': 1 });
  });

  it('breaks a tie by guild_id, so two runs agree', () => {
    const rows = [
      { guild_id: 'zeta', player_id: 'p', day: dayStr(0) }, { guild_id: 'zeta', player_id: 'p', day: dayStr(1) },
      { guild_id: 'alpha', player_id: 'p', day: dayStr(0) }, { guild_id: 'alpha', player_id: 'p', day: dayStr(1) },
    ];
    expect(hub.countActivePlayers(rows, { now: NOW }).counts).toEqual({ alpha: 1 });
  });

  it('survives junk rows', () => {
    expect(hub.countActivePlayers([null, {}, { guild_id: 'g' }, { guild_id: 'g', player_id: 'p', day: 5 }], { now: NOW }).counts).toEqual({});
    expect(hub.countActivePlayers(undefined, { now: NOW }).counts).toEqual({});
  });
});

describe('nextGateState: ok -> nearing -> over -> grace -> limited', () => {
  const run = (plan, counts, start = null, t0 = NOW) => {
    let prev = start; const trail = [];
    counts.forEach((n, i) => { prev = hub.nextGateState({ plan, activePlayers: n, now: t0 + i * DAY, prev }); trail.push(prev); });
    return trail;
  };

  it('is ok below 9, nearing from 9, with a heads-up once', () => {
    expect(hub.nextGateState({ activePlayers: 8, now: NOW }).state).toBe('ok');
    const a = hub.nextGateState({ activePlayers: 9, now: NOW });
    expect(a.state).toBe('nearing'); expect(a.notify).toBe('nearing');
    const b = hub.nextGateState({ activePlayers: 11, now: NOW + DAY, prev: a });
    expect(b.state).toBe('nearing'); expect(b.notify).toBe(null);
  });

  it('needs three evaluations in a row at 12 before it is real', () => {
    const t = run('commons', [12, 12]);
    expect(t.map(x => x.state)).toEqual(['nearing', 'nearing']);
    expect(hub.nextGateState({ activePlayers: 12, now: NOW + 2 * DAY, prev: t[1] }).state).toBe('over');
  });

  it('a one-night crowd that falls back resets the streak', () => {
    const t = run('commons', [12, 12, 10, 12, 12]);
    expect(t.map(x => x.state)).toEqual(['nearing', 'nearing', 'nearing', 'nearing', 'nearing']);
    expect(t[4].overStreak).toBe(2);
  });

  it('day zero is over (notice), then grace for 14 days, then limited', () => {
    const t = run('commons', Array(20).fill(13));
    expect(t[2].state).toBe('over'); expect(t[2].notify).toBe('over');
    expect(t[2].graceEndsAt).toBe(NOW + 2 * DAY + 14 * DAY);
    expect(t[3].state).toBe('grace'); expect(t[3].daysLeft).toBe(13);
    const limitedAt = t.findIndex(x => x.state === 'limited');
    expect(limitedAt).toBe(2 + 14);
    expect(t[limitedAt].notify).toBe('limited');
    expect(t[limitedAt + 1].notify).toBe(null);
  });

  it('reminds at 7 and 2 days left, and only then', () => {
    const t = run('commons', Array(17).fill(14));
    const reminders = t.map((x, i) => [i, x.notify, x.daysLeft]).filter(r => r[1] === 'grace_reminder');
    expect(reminders.map(r => r[2])).toEqual([7, 2]);
  });

  it('shared streams and new members stop only at limited; everything else, and the local Mimic, never', () => {
    for (const s of hub.STATES) {
      const l = hub.limitsFor(s);
      expect(l.localMimic).toBe(true);
      expect(l.history).toBe(true);
      expect(l.personal).toBe(true);
      expect(l.sharedStreams).toBe(s !== 'limited');
      expect(l.newMembers).toBe(s !== 'limited');
    }
  });

  it('one extension of 14 days, once, and not after the cut', () => {
    const t = run('commons', Array(4).fill(13));            // over at index 2, grace at 3
    const ext = hub.nextGateState({ activePlayers: 13, now: NOW + 4 * DAY, prev: t[3], extendGrace: true });
    expect(ext.graceEndsAt).toBe(t[3].graceEndsAt + 14 * DAY);
    expect(ext.graceExtraDays).toBe(14);
    const again = hub.nextGateState({ activePlayers: 13, now: NOW + 5 * DAY, prev: ext, extendGrace: true });
    expect(again.graceEndsAt).toBe(ext.graceEndsAt);
    // limited cannot be extended away
    const lim = hub.nextGateState({ activePlayers: 13, now: ext.graceEndsAt + DAY, prev: ext });
    expect(lim.state).toBe('limited');
    expect(hub.nextGateState({ activePlayers: 13, now: ext.graceEndsAt + 2 * DAY, prev: lim, extendGrace: true }).state).toBe('limited');
  });

  it('a guild is let off only when it falls to 10, not at 11 (no flapping)', () => {
    const t = run('commons', Array(6).fill(13));
    const at11 = hub.nextGateState({ activePlayers: 11, now: NOW + 6 * DAY, prev: t[5] });
    expect(at11.state).toBe('grace');
    const at10 = hub.nextGateState({ activePlayers: 10, now: NOW + 7 * DAY, prev: at11 });
    expect(at10.state).toBe('nearing'); expect(at10.notify).toBe('recovered');
    expect(at10.graceEndsAt).toBe(null);
    const lowest = hub.nextGateState({ activePlayers: 4, now: NOW + 8 * DAY, prev: at11 });
    expect(lowest.state).toBe('ok');
  });

  it('a limited guild that trims back is restored; one that stays big stays limited', () => {
    const t = run('commons', Array(20).fill(13));
    const lim = t[19];
    expect(lim.state).toBe('limited');
    expect(hub.nextGateState({ activePlayers: 12, now: NOW + 20 * DAY, prev: lim }).state).toBe('limited');
    const back = hub.nextGateState({ activePlayers: 10, now: NOW + 20 * DAY, prev: lim });
    expect(back.state).toBe('nearing'); expect(back.limits.sharedStreams).toBe(true);
  });

  it('paying (managed) clears the limit and moves the cap to 60; it only ever reports', () => {
    const limited = run('commons', Array(20).fill(13))[19];
    const paid = hub.nextGateState({ plan: 'managed', activePlayers: 13, now: NOW + 21 * DAY, prev: limited });
    expect(paid.state).toBe('ok'); expect(paid.notify).toBe('recovered');
    const big = run('managed', Array(40).fill(64));
    expect(big[2].state).toBe('over'); expect(big[2].notify).toBe('over');
    expect(big[39].state).toBe('over');
    expect(big.some(x => x.state === 'grace' || x.state === 'limited')).toBe(false);
    expect(big[39].limits.sharedStreams).toBe(true);
  });

  it('a self-hosted guild is not counted at all', () => {
    const r = hub.nextGateState({ plan: 'self_hosted', activePlayers: 500, now: NOW, prev: { state: 'limited' } });
    expect(r.state).toBe('ok'); expect(r.notify).toBe(null);
  });

  it('rejects a plan it does not know', () => {
    expect(() => hub.nextGateState({ plan: 'free-for-all', activePlayers: 1, now: NOW })).toThrow(/unknown plan/);
  });
});

describe('retention: short on the hub, per stream, per plan', () => {
  it('cuts each stream at its window', () => {
    const at = (s, p = 'commons') => (NOW - Date.parse(hub.retentionCutoff(s, p, NOW))) / 3_600_000;
    expect(at('encounter_threat_snapshots')).toBe(48);
    expect(at('buff_casts')).toBe(72);
    expect(at('raid_roster')).toBe(6);
    expect(at('encounters')).toBe(60 * 24);
    expect(at('encounter_threat_snapshots', 'managed')).toBe(30 * 24);
  });

  it('a managed plan keeps what Wolf Pack keeps; a self-hosted guild has nothing swept', () => {
    expect(hub.retentionCutoff('encounters', 'managed', NOW)).toBe(null);
    expect(hub.retentionCutoff('raid_track_minutes', 'managed', NOW)).toBe(null);
    for (const s of Object.keys(hub.RETENTION)) expect(hub.retentionCutoff(s, 'self_hosted', NOW)).toBe(null);
  });

  it('the commons never keeps anything longer than the managed plan does', () => {
    for (const [s, r] of Object.entries(hub.RETENTION)) {
      if (r.managed != null) expect(r.commons, s).toBeLessThanOrEqual(r.managed);
      expect(r.commons, s).toBeLessThanOrEqual(60 * 24);   // nothing on the free hub outlives 60 days
    }
  });

  it('refuses the streams that name people or belong on the PC', () => {
    for (const s of ['tells', 'chat', 'historical_chat', 'pvp', 'pvp_assists', 'who_observations', 'xp_events', 'inventory']) expect(hub.commonsAccepts(s), s).toBe(false);
    for (const s of ['encounter', 'raid_roster', 'buff_casts', 'bosskill']) expect(hub.commonsAccepts(s), s).toBe(true);
  });

  it('sweepPlan lists exactly the streams a plan sweeps', () => {
    expect(hub.sweepPlan('commons', NOW).length).toBe(Object.keys(hub.RETENTION).length);
    const managed = hub.sweepPlan('managed', NOW).map(x => x.stream).sort();
    expect(managed).toEqual(['buff_casts', 'character_live_state', 'encounter_threat_snapshots', 'raid_roster']);
    expect(hub.sweepPlan('self_hosted', NOW)).toEqual([]);
    expect(() => hub.retentionCutoff('nonsense', 'commons', NOW)).toThrow(/unknown stream/);
  });

  it('holds about 8 MB per player on the hub, against ~79 over six months of Wolf Pack windows', () => {
    const hubMb = hub.steadyStateMbPerPlayer('commons');
    const wpMb = hub.steadyStateMbPerPlayer('managed', 180);
    expect(hubMb).toBeGreaterThan(7.9); expect(hubMb).toBeLessThan(8.2);
    expect(wpMb).toBeGreaterThan(77); expect(wpMb).toBeLessThan(81);
    const saved = (n) => Math.round((wpMb - hubMb) * n);
    expect(saved(10)).toBeGreaterThan(700); expect(saved(10)).toBeLessThan(760);       // ~0.7 GB
    expect(saved(50)).toBeGreaterThan(3500); expect(saved(50)).toBeLessThan(3800);     // ~3.6 GB
    expect(saved(200)).toBeGreaterThan(14000); expect(saved(200)).toBeLessThan(15200); // ~14.4 GB
  });
});

describe('guild slugs', () => {
  it('accepts a tag and refuses Wolf Pack\'s, the platform\'s and the malformed', () => {
    for (const ok of ['nightfall', 'the-reckoning', 'abc', 'a1b2c3']) expect(hub.validGuildSlug(ok), ok).toBe(true);
    for (const bad of ['wolfpack', 'wolf-pack', 'commons', 'ab', '-lead', 'trail-', 'Has Caps', 'two--hyphens', 'solo-4f3a', 'x'.repeat(30), '', null]) expect(hub.validGuildSlug(bad), String(bad)).toBe(false);
  });
});

describe('the registry migration agrees with the helper', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261023160000_open_hub_registry.sql'), 'utf8'));

  it('seeds exactly the RETENTION table', () => {
    const rows = [...sql.matchAll(/\(\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*(\d+),\s*(null|\d+),\s*([\d.]+)\)/g)]
      .map(m => ({ stream: m[1], table: m[2], sweep: m[3], commons: +m[4], managed: m[5] === 'null' ? null : +m[5], mb: +m[6] }));
    expect(rows.length).toBe(Object.keys(hub.RETENTION).length);
    for (const r of rows) {
      const j = hub.RETENTION[r.stream];
      expect(j, r.stream).toBeTruthy();
      expect(r.table, r.stream).toBe(j.table);
      expect(r.sweep, r.stream).toBe(j.sweep);
      expect(r.commons, r.stream).toBe(j.commons);
      expect(r.managed, r.stream).toBe(j.managed);
      expect(r.mb, r.stream).toBeCloseTo(j.mbPerPlayerDay, 6);
    }
  });

  it('is idempotent, RLS-on for every table it creates, and never drops anything', () => {
    const created = [...sql.matchAll(/create table if not exists (\w+)/g)].map(m => m[1]);
    expect(created.length).toBe(7);
    for (const t of created) expect(sql, t).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`));
    expect(sql).not.toMatch(/create table (?!if not exists)/);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it('keeps the thresholds in step: the same plans and states the helper uses', () => {
    for (const p of hub.PLANS) expect(sql).toContain(`'${p}'`);
    for (const s of hub.STATES) expect(sql).toContain(`'${s}'`);
    expect(sql).toMatch(/guild_id <> 'wolfpack'/);
  });

  it('is not wired into any live code path yet (phase 0 is dormant)', () => {
    for (const f of ['index.js', 'utils/supabase.js', 'utils/mimicLink.js', 'packages/wolfpack-logsync/index.js']) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/openHub/);
    }
  });
});
