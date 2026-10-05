// test/kill-context.test.js — which instance was this kill in, and does it start a board timer?
//
// The guild lead, 2026-10-05: "Lord of Ire PVP kills are still being triggered as regular guild instance
// kills. We need to know if our players are in live or in instance when they kill mobs in bastion of thunder
// or any other planes of power locations… If anyone from outside of our guild is in the zone there's a good
// chance they are in live and we do not count those timers."
//
// Four layers, each mutation-checked (break the rule, watch the named test go red, restore):
//   1. classifyKillContext(): the six rules and their ORDER, run as behaviour.
//   2. gatherKillSignals(): the reads it makes, against a stand-in supabase.
//   3. the encounter handler's _decideKillDeferred, SLICED OUT of index.js and run: only `ours` records a
//      timer, the others stamp the encounter, a failed read falls back to today's behaviour.
//   4. text: the call site is post-ack and confirmed-only; the migration filters on classification.
//
// Fixture names are invented (Aldenmar … Raider01); none is a member.
//
// Run: npx vitest run test/kill-context.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';
import kc from '../utils/killContext.js';
import kl from '../utils/killLockouts.js';

const requireBot = createRequire(BOT_INDEX);

const KILL = Date.parse('2026-10-05T03:32:05Z');
const MIN = 60_000, DAY = 86_400_000;
const OURS = 'Wolf Pack';

// A roster of the invented names plus fillers; `fighters` picks who fought.
const ROSTER = new Set(['aldenmar', 'brackwyn', 'corvale', 'rethlan', 'nyssara', 'zarrin',
  ...Array.from({ length: 20 }, (_, i) => `raider${String(i + 1).padStart(2, '0')}`)]);
const ours = (n) => ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'].slice(0, n);
// Letters only, like a real name: the handler's participant filter drops anything else.
const STRANGERS = ['Oruvane', 'Kestrel', 'Pelloran', 'Havrick', 'Tamsyn', 'Yorrel'];
const strangers = (n) => STRANGERS.slice(0, n);

const base = (over = {}) => ({
  killedAtMs: KILL,
  zoneNames: ['Plane of Hate'],
  participants: [...ours(4)],
  roster: ROSTER,
  ourGuild: OURS,
  pvpBroadcasts: [], flagEvents: [], whoSightings: [],
  ...over,
});
const verdict = (over) => kc.classifyKillContext(base(over)).verdict;

const bcast = (offsetMs, instanced = true) => ({ atMs: KILL + offsetMs, instanced });
const flag = (character, on, offsetMs) => ({ character, on, atMs: KILL + offsetMs });
// Observer = the character whose /who it was; Aldenmar fights in every base() fight.
const seen = (guild, zone, offsetMs = 0, observer = 'Aldenmar') => ({ character: 'Oruvane', guild, zone, atMs: KILL + offsetMs, observer });

describe('rule 1 — a PvP "(Instanced)" boss-kill broadcast within ±2 minutes', () => {
  it('makes the kill pvp, however ours the fighters look', () => {
    expect(verdict({ pvpBroadcasts: [bcast(0)] })).toBe('pvp');
    expect(verdict({ pvpBroadcasts: [bcast(-90_000)] })).toBe('pvp');
    expect(verdict({ pvpBroadcasts: [bcast(+90_000)] })).toBe('pvp');
  });
  it('the window is exactly two minutes, inclusive', () => {
    expect(verdict({ pvpBroadcasts: [bcast(+120_000)] })).toBe('pvp');
    expect(verdict({ pvpBroadcasts: [bcast(-120_000)] })).toBe('pvp');
    expect(verdict({ pvpBroadcasts: [bcast(+120_001)] })).toBe('ours');
    expect(verdict({ pvpBroadcasts: [bcast(-120_001)] })).toBe('ours');
  });
  it('only an (Instanced) broadcast counts', () => {
    expect(verdict({ pvpBroadcasts: [bcast(0, false)] })).toBe('ours');
  });
  it('beats the roster share: mostly strangers + a broadcast is pvp, not live', () => {
    const mostlyStrangers = { participants: [...ours(1), ...strangers(4)] };
    expect(verdict(mostlyStrangers)).toBe('live');
    expect(verdict({ ...mostlyStrangers, pvpBroadcasts: [bcast(0)] })).toBe('pvp');
  });
  it('beats the /who rule too', () => {
    const r = kc.classifyKillContext(base({
      pvpBroadcasts: [bcast(0)], whoSightings: [seen('Mayhem', 'Plane of Hate')],
    }));
    expect(r.verdict).toBe('pvp');
    expect(r.reason).toMatch(/broadcast/);
  });
  it('is not zone-gated: it fires in a zone no flag can apply in', () => {
    expect(verdict({ zoneNames: ['Bastion of Thunder'], pvpBroadcasts: [bcast(0)] })).toBe('pvp');
  });
});

describe('rule 2 — a fighter was PvP-flagged, in a PvP-capable zone', () => {
  it('makes the kill pvp when the latest toggle before the kill is ON', () => {
    expect(verdict({ flagEvents: [flag('Aldenmar', true, -3600_000)] })).toBe('pvp');
  });
  it('the LATEST toggle wins: on then off is not flagged', () => {
    expect(verdict({ flagEvents: [flag('Aldenmar', true, -7200_000), flag('Aldenmar', false, -3600_000)] })).toBe('ours');
    expect(verdict({ flagEvents: [flag('Aldenmar', false, -7200_000), flag('Aldenmar', true, -3600_000)] })).toBe('pvp');
  });
  it('a toggle AFTER the kill says nothing about the kill', () => {
    expect(verdict({ flagEvents: [flag('Aldenmar', true, +60_000)] })).toBe('ours');
  });
  it('a toggle older than the 30-day lookback is stale', () => {
    expect(verdict({ flagEvents: [flag('Aldenmar', true, -31 * DAY)] })).toBe('ours');
    expect(verdict({ flagEvents: [flag('Aldenmar', true, -29 * DAY)] })).toBe('pvp');
  });
  it('only a fighter\'s flag counts, and names compare case-blind', () => {
    expect(verdict({ flagEvents: [flag('Havrick', true, -60_000)] })).toBe('ours');
    expect(verdict({ flagEvents: [flag('aldenmar', true, -60_000)] })).toBe('pvp');
  });
  it('only counts in a PvP-capable zone', () => {
    const on = [flag('Aldenmar', true, -60_000)];
    for (const zone of ['Plane of Hate', 'Plane of Fear', 'Plane of Sky', 'The Hole', 'hateplane']) {
      expect(verdict({ zoneNames: [zone], flagEvents: on }), zone).toBe('pvp');
    }
    for (const zone of ['Bastion of Thunder', 'Plane of Innovation', "Nagafen's Lair", 'Temple of Veeshan']) {
      expect(verdict({ zoneNames: [zone], flagEvents: on }), zone).toBe('ours');
    }
  });
  it('a PvP-capable alias is enough: the boss zone may be long-form and the encounter short-form', () => {
    expect(verdict({ zoneNames: ['Some Long Name', 'fearplane'], flagEvents: [flag('Aldenmar', true, -60_000)] })).toBe('pvp');
  });
  it('beats the roster share: a flagged fighter in a mostly-stranger fight is pvp, not live', () => {
    const r = kc.classifyKillContext(base({
      participants: [...ours(1), ...strangers(4)], flagEvents: [flag('Aldenmar', true, -60_000)],
    }));
    expect(r.verdict).toBe('pvp');
    expect(r.reason).toMatch(/flag/);
  });
});

describe('rule 3 — three or more fighters and fewer than half are ours', () => {
  it('makes the kill live', () => {
    expect(verdict({ participants: [...ours(1), ...strangers(2)] })).toBe('live');     // 1 of 3
    expect(verdict({ participants: [...ours(2), ...strangers(4)] })).toBe('live');     // 2 of 6
    expect(verdict({ participants: strangers(5) })).toBe('live');                      // 0 of 5
  });
  it('exactly half is ours', () => {
    expect(verdict({ participants: [...ours(2), ...strangers(2)] })).toBe('ours');
    expect(verdict({ participants: [...ours(3), ...strangers(3)] })).toBe('ours');
  });
  it('just under half is live', () => {
    expect(verdict({ participants: [...ours(2), ...strangers(3)] })).toBe('live');     // 2 of 5
  });
  it('is the same line classifyOurs draws (reused, not re-invented)', () => {
    expect(kl.GUILD_EVENT_MIN_MEMBER_FRAC).toBe(0.5);
    expect(kl.MIN_PLAYERS_TO_JUDGE).toBe(3);
  });
  it('cannot judge without a roster: three strangers and no roster is not accused', () => {
    expect(verdict({ participants: strangers(3), roster: null })).toBe('ours');
    expect(verdict({ participants: strangers(3), roster: new Set() })).toBe('ours');
  });
  it('counts distinct fighters: a repeated name is one fighter', () => {
    expect(verdict({ participants: ['Oruvane', 'oruvane', 'Oruvane'] })).toBe('unknown');
  });
});

describe('rule 4 — a /who sighting of another guild in the zone, within ±10 minutes', () => {
  it('makes the kill live', () => {
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate')] })).toBe('live');
  });
  it('only a fighter\'s own /who counts: a guildmate elsewhere in the zone sees live, not our instance', () => {
    // 2026-10-05: an any-uploader rule marked 6 of the day's 20 Bastion named kills live, most of them
    // all-guild groups, because someone standing in live Bastion of Thunder saw a dozen guilds there.
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', 0, 'Raider07')] })).toBe('ours');
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', 0, null)] })).toBe('ours');
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', 0, 'brackwyn')] })).toBe('live');
  });
  it('the window is ten minutes, inclusive', () => {
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', +10 * MIN)] })).toBe('live');
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', -10 * MIN)] })).toBe('live');
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', +10 * MIN + 1)] })).toBe('ours');
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Hate', -10 * MIN - 1)] })).toBe('ours');
  });
  it('our own guild is not an outsider, in any capitalisation', () => {
    expect(verdict({ whoSightings: [seen('Wolf Pack', 'Plane of Hate')] })).toBe('ours');
    expect(verdict({ whoSightings: [seen('wolf pack', 'Plane of Hate')] })).toBe('ours');
  });
  it('an unguilded player is not an outsider', () => {
    for (const g of ['', '   ', null, undefined, '<>', '<null>', 'null']) {
      expect(verdict({ whoSightings: [seen(g, 'Plane of Hate')] }), String(g)).toBe('ours');
    }
  });
  it('the sighting must be in the kill\'s zone, under any spelling of it', () => {
    expect(verdict({ whoSightings: [seen('Mayhem', 'Plane of Fear')] })).toBe('ours');
    expect(verdict({ whoSightings: [seen('Mayhem', null)] })).toBe('ours');
    for (const z of ['the plane of hate', 'Plane of Hate (Instanced)', 'PLANE OF HATE']) {
      expect(verdict({ whoSightings: [seen('Mayhem', z)] }), z).toBe('live');
    }
    expect(verdict({ zoneNames: ['Plane of Hate', 'hateplane'], whoSightings: [seen('Mayhem', 'hateplane')] })).toBe('live');
    expect(verdict({ zoneNames: ['Bastion of Thunder'], whoSightings: [seen('Mayhem', 'torden, the bastion of thunder')] })).toBe('live');
  });
  it('is skipped when we do not know our own guild tag (it could not tell ours from theirs)', () => {
    expect(verdict({ ourGuild: '', whoSightings: [seen('Mayhem', 'Plane of Hate')] })).toBe('ours');
    expect(verdict({ ourGuild: undefined, whoSightings: [seen('Mayhem', 'Plane of Hate')] })).toBe('ours');
  });
  it('fires on a duo too: it comes before the "too few to judge" rule', () => {
    expect(verdict({ participants: ours(2), whoSightings: [seen('Mayhem', 'Plane of Hate')] })).toBe('live');
  });
  it('comes after the roster share: a stranger-heavy fight with a sighting is judged on the roster', () => {
    const r = kc.classifyKillContext(base({
      participants: [...ours(1), ...strangers(4)], whoSightings: [seen('Mayhem', 'Plane of Hate')],
    }));
    expect(r.verdict).toBe('live');
    expect(r.reason).toMatch(/roster/);
  });
  it('names the guild, not a player', () => {
    const r = kc.classifyKillContext(base({ whoSightings: [seen('Mayhem', 'Plane of Hate')] }));
    expect(r.reason).toMatch(/<Mayhem>/);
    expect(r.reason).not.toMatch(/Oruvane/);
  });
});

describe('rules 5 and 6 — unknown for a duo, ours for the rest', () => {
  it('one or two fighters and no signal is unknown, not ours and not live', () => {
    expect(verdict({ participants: ours(1) })).toBe('unknown');
    expect(verdict({ participants: ours(2) })).toBe('unknown');
    expect(verdict({ participants: strangers(2) })).toBe('unknown');   // two strangers are too few to accuse
    expect(verdict({ participants: [] })).toBe('unknown');
  });
  it('three or more with no signal is ours', () => {
    expect(verdict({ participants: ours(3) })).toBe('ours');
    expect(verdict({ participants: ours(6) })).toBe('ours');
  });
  it('a missing signal object does not throw', () => {
    expect(kc.classifyKillContext().verdict).toBe('unknown');
    expect(kc.classifyKillContext({}).verdict).toBe('unknown');
  });
  it('an unusable kill time cannot confirm a time-bound signal', () => {
    expect(verdict({ killedAtMs: NaN, pvpBroadcasts: [bcast(0)], flagEvents: [flag('Aldenmar', true, -60_000)],
      whoSightings: [seen('Mayhem', 'Plane of Hate')] })).toBe('ours');
  });
  it('every verdict carries a reason', () => {
    for (const over of [{ pvpBroadcasts: [bcast(0)] }, { flagEvents: [flag('Aldenmar', true, -1)] },
      { participants: strangers(4) }, { whoSightings: [seen('Mayhem', 'Plane of Hate')] },
      { participants: ours(1) }, {}]) {
      expect(kc.classifyKillContext(base(over)).reason.length).toBeGreaterThan(5);
    }
  });
});

describe('classificationPatch', () => {
  it('stamps pvp and live as an auto mark, with the reason and a time', () => {
    for (const v of ['pvp', 'live']) {
      const p = kc.classificationPatch({ verdict: v, reason: 'because' }, KILL);
      expect(p).toEqual({
        classification: v, classification_reason: 'because',
        classification_at: new Date(KILL).toISOString(), classification_by: 'auto',
      });
    }
  });
  it('leaves ours and unknown null-classified', () => {
    expect(kc.classificationPatch({ verdict: 'ours', reason: 'x' })).toBeNull();
    expect(kc.classificationPatch({ verdict: 'unknown', reason: 'x' })).toBeNull();
    expect(kc.classificationPatch(null)).toBeNull();
  });
  it('only writes values the encounters CHECK constraint allows', () => {
    const allowed = ['wipe', 'live', 'pvp', 'test', 'foreign'];
    for (const v of ['pvp', 'live']) expect(allowed).toContain(kc.classificationPatch({ verdict: v }).classification);
  });
});

describe('zone helpers', () => {
  it('PvP-capable: Hate, Fear, Sky and The Hole, under any spelling', () => {
    for (const z of ['Plane of Hate', 'the plane of hate', 'Plane of Hate (Instanced)', 'Plane of Fear', 'Plane of Sky',
      'The Hole', 'The Hole (Instanced)', 'hateplane', 'fearplane', 'airplane', 'hole']) {
      expect(kc.isPvpCapableZone(z), z).toBe(true);
    }
    for (const z of ['Bastion of Thunder', 'bothunder', 'Plane of Tactics', 'Plane of Growth', '', null, undefined, 7]) {
      expect(kc.isPvpCapableZone(z), String(z)).toBe(false);
    }
  });
  it('sameZone: spellings meet, near-misses do not', () => {
    expect(kc.sameZone('torden, the bastion of thunder', 'Bastion of Thunder')).toBe(true);
    expect(kc.sameZone('The Hole', 'hole')).toBe(true);
    expect(kc.sameZone('Plane of Fear (Instanced)', 'fearplane')).toBe(false);   // short names meet only via zoneNames aliases
    expect(kc.sameZone('plane of fear', 'plane of hate')).toBe(false);
    expect(kc.sameZone('the black hole', 'hole')).toBe(false);                    // a one-word name matches only exactly
    expect(kc.sameZone('', 'hole')).toBe(false);
  });
  it('a kill in a PvP-capable zone waits for the broadcast; the wait is 150 s', () => {
    expect(kc.PVP_DEFER_MS).toBe(150_000);
    expect(kc.PVP_DEFER_MS).toBeGreaterThan(kc.PVP_BROADCAST_WINDOW_MS);
  });
});

describe('buildKillLockouts — the ours flag follows the verdict, the lockout stays', () => {
  const boss = { id: 'lord_of_ire', name: 'Lord of Ire', timerHours: 66 };
  const args = (over = {}) => ({
    boss, killedAtMs: Date.now() - 60_000, participants: ['Aldenmar', 'Brackwyn', 'Corvale'],
    roster: ROSTER, guildId: 'wolfpack', ...over,
  });
  it('a pvp or live verdict writes a lockout for every fighter with ours=false', () => {
    for (const killVerdict of ['pvp', 'live']) {
      const rows = kl.buildKillLockouts(args({ killVerdict }));
      expect(rows).toHaveLength(3);
      expect(rows.every(r => r.ours === false)).toBe(true);
      expect(rows.every(r => r.source === 'kill' && r.boss_key === 'lord_of_ire')).toBe(true);
    }
  });
  it('beats a raid-night binding that would call it ours', () => {
    expect(kl.buildKillLockouts(args({ inRaidNight: true })).every(r => r.ours === true)).toBe(true);
    expect(kl.buildKillLockouts(args({ inRaidNight: true, killVerdict: 'pvp' })).every(r => r.ours === false)).toBe(true);
  });
  it('an ours, unknown or absent verdict leaves the three-state classifyOurs alone', () => {
    for (const killVerdict of ['ours', 'unknown', undefined]) {
      expect(kl.buildKillLockouts(args({ killVerdict })).every(r => r.ours === true), String(killVerdict)).toBe(true);   // all on the roster
      const cantTell = kl.buildKillLockouts(args({ killVerdict, roster: null, inRaidWindow: true }));
      expect(cantTell.every(r => r.ours === null), String(killVerdict)).toBe(true);
    }
  });
});

// ── gatherKillSignals — the reads ───────────────────────────────────────────────────────────────────────

function stubSupabase({ tables = {}, fail = [] } = {}) {
  const asked = [];
  return {
    asked,
    async select(table, q) {
      asked.push({ table, q: decodeURIComponent(q) });
      if (fail.includes(table)) return null;
      return tables[table] || [];
    },
    async selectAllPaged(table, q) {
      asked.push({ table, q: decodeURIComponent(q), paged: true });
      if (fail.includes(table)) return null;
      return tables[table] || [];
    },
  };
}
const HATE = { id: 'lord_of_ire', name: 'Lord of Ire', zone: 'Plane of Hate', timerHours: 66 };
const BASTION = { id: 'gaukr_sandstorm', name: 'Gaukr Sandstorm', zone: 'Bastion of Thunder', timerHours: 3 };
const gather = (sb, over = {}) => kc.gatherKillSignals({
  supabase: sb, guildId: 'wolfpack', ourGuild: OURS, boss: HATE, encounterId: 'enc-1',
  killedAtMs: KILL, participants: ours(4), ...over,
});

describe('gatherKillSignals', () => {
  const tables = () => ({
    encounters: [{ zone_short: 'hateplane', classification: null }],
    characters: [{ name: 'Aldenmar' }, { name: 'brackwyn' }, { name: null }],
    pvp_boss_kills: [
      { killed_at: new Date(KILL).toISOString(), raw_text: 'Zarrin of <Mayhem> has killed Lord of Ire in Plane of Hate (Instanced)!' },
      { killed_at: new Date(KILL + 1000).toISOString(), raw_text: 'Zarrin of <Mayhem> has killed Lord of Ire in Plane of Hate!' },
    ],
    fun_events: [{ caster: 'Aldenmar', event_type: 'pvp_flag_on', event_ts: new Date(KILL - 60_000).toISOString() }],
    who_observations: [
      { character: 'Oruvane', guild_name: 'Mayhem', zone: 'the plane of hate', observed_at: new Date(KILL).toISOString(), uploaded_by: 'Corvale' },
      { character: 'Kestrel', guild_name: 'Eclipse', zone: 'Plane of Hate (Instanced)', observed_at: new Date(KILL).toISOString(), uploaded_by: 'pvp-relay' },
    ],
  });

  it('maps each store to the signal shape the classifier reads', async () => {
    const { signals, existingClassification } = await gather(stubSupabase({ tables: tables() }));
    expect(existingClassification).toBeNull();
    expect(signals.zoneNames).toEqual(['Plane of Hate', 'hateplane']);
    expect(signals.roster).toEqual(new Set(['aldenmar', 'brackwyn']));
    expect(signals.pvpBroadcasts.map(b => b.instanced)).toEqual([true, false]);   // "(Instanced)" is read off the broadcast text
    expect(signals.flagEvents).toEqual([{ character: 'Aldenmar', on: true, atMs: KILL - 60_000 }]);
    expect(signals.ourGuild).toBe(OURS);
  });

  it('drops the PvP relay\'s who rows: a broadcast\'s killer is not somebody seen in the zone', async () => {
    const { signals } = await gather(stubSupabase({ tables: tables() }));
    expect(signals.whoSightings.map(w => w.character)).toEqual(['Oruvane']);
  });

  it('carries whose /who each sighting was, so rule 4 can keep only the fighters\' own', async () => {
    const { signals } = await gather(stubSupabase({ tables: tables() }));
    expect(signals.whoSightings.map(w => w.observer)).toEqual(['Corvale']);
  });

  it('feeds the classifier end to end', async () => {
    const t = tables();
    const { signals } = await gather(stubSupabase({ tables: t }));
    expect(kc.classifyKillContext(signals).verdict).toBe('pvp');                    // the (Instanced) broadcast
    t.pvp_boss_kills = [];
    t.fun_events = [];
    const again = await gather(stubSupabase({ tables: t }));
    expect(kc.classifyKillContext(again.signals).verdict).toBe('live');             // the /who sighting
  });

  it('carries an existing classification back so an officer\'s mark gates the timer', async () => {
    const t = tables();
    t.encounters = [{ zone_short: 'hateplane', classification: 'wipe' }];
    expect((await gather(stubSupabase({ tables: t }))).existingClassification).toBe('wipe');
  });

  it('asks each store for this boss, this guild and the right window, with an explicit bound', async () => {
    const sb = stubSupabase({ tables: tables() });
    await gather(sb);
    const q = (t) => sb.asked.find(a => a.table === t).q;
    const iso = (ms) => new Date(ms).toISOString();
    expect(q('pvp_boss_kills')).toContain('guild_id=eq.wolfpack');
    expect(q('pvp_boss_kills')).toContain('boss_id=eq.lord_of_ire');
    expect(q('pvp_boss_kills')).toContain(`killed_at=gte.${iso(KILL - kc.PVP_BROADCAST_WINDOW_MS)}`);
    expect(q('pvp_boss_kills')).toContain(`killed_at=lte.${iso(KILL + kc.PVP_BROADCAST_WINDOW_MS)}`);
    expect(q('fun_events')).toContain('event_type=in.(pvp_flag_on,pvp_flag_off)');
    expect(q('fun_events')).toContain('caster=in.(Aldenmar,Brackwyn,Corvale,Rethlan)');
    expect(q('fun_events')).toContain(`event_ts=lte.${iso(KILL)}`);
    expect(q('who_observations')).toContain(`observed_at=gte.${iso(KILL - kc.WHO_WINDOW_MS)}`);
    expect(q('who_observations')).toContain(`observed_at=lte.${iso(KILL + kc.WHO_WINDOW_MS)}`);
    expect(q('who_observations')).toContain('guild_name=not.is.null');
    expect(q('who_observations')).toContain('guild_name=not.ilike.Wolf Pack');      // our own rows would fill the page
    expect(q('who_observations')).toContain('zone.ilike."*plane of hate*"');
    expect(q('who_observations')).toContain('zone.ilike."*hateplane*"');            // the encounter's short zone
    for (const t of ['pvp_boss_kills', 'fun_events', 'who_observations', 'encounters']) expect(q(t), t).toMatch(/limit=\d+/);
    expect(sb.asked.find(a => a.table === 'characters').paged).toBe(true);          // the roster pages past the 1,000-row cap
  });

  it('reads no PvP flags where a flag means nothing', async () => {
    const sb = stubSupabase({ tables: { ...tables(), encounters: [{ zone_short: 'bothunder', classification: null }] } });
    await gather(sb, { boss: BASTION });
    expect(sb.asked.some(a => a.table === 'fun_events')).toBe(false);
    expect(sb.asked.find(a => a.table === 'who_observations').q).toContain('zone.ilike."*bastion of thunder*"');
  });

  it('reads no /who when it cannot tell ours from theirs, and no encounter when there is none yet', async () => {
    const sb = stubSupabase({ tables: tables() });
    await gather(sb, { ourGuild: '', encounterId: null });
    expect(sb.asked.some(a => a.table === 'who_observations')).toBe(false);
    expect(sb.asked.some(a => a.table === 'encounters')).toBe(false);
  });

  it('THROWS when any read fails — a null is not "no rows"', async () => {
    for (const table of ['encounters', 'pvp_boss_kills', 'fun_events', 'who_observations', 'characters']) {
      await expect(gather(stubSupabase({ tables: tables(), fail: [table] })), table).rejects.toThrow(/read failed/);
    }
  });
});

// ── the encounter handler's decision, sliced out of index.js and RUN ────────────────────────────────────

const SRC = readSource(BOT_INDEX);
const DECIDE = sliceBlock(SRC, 'const _decideKillDeferred = async () => {', '\n  };\n');

function runDecision({ boss = BASTION, tables: t, enabled = true, fail = [], bossState, playersIn = ours(4), classifiedAs } = {}) {
  const sb = stubSupabase({
    tables: {
      encounters: [{ zone_short: boss === HATE ? 'hateplane' : 'bothunder', classification: classifiedAs || null }],
      characters: [...ROSTER].map(name => ({ name })),
      ...(t || {}),
    },
    fail,
  });
  sb.isEnabled = () => enabled;
  sb.updates = [];
  sb.update = async (table, q, body) => { sb.updates.push({ table, q: decodeURIComponent(q), body }); return []; };
  const calls = { recordKill: [], post: [], lockouts: [] };
  const fakeRequire = (p) => {
    if (p === './utils/killContext') return kc;
    if (p === './utils/killLockouts') return kl;
    if (p === './utils/supabase') return sb;
    if (p === './utils/state') {
      return {
        getBossState: () => bossState,
        recordKill: (...a) => { calls.recordKill.push(a); },
      };
    }
    if (p === './utils/killops') return { postKillUpdate: (...a) => { calls.post.push(a); return Promise.resolve(); } };
    return requireBot(p);
  };
  const logs = [];
  const decide = new Function(
    'require', 'encounter', 'matchedBoss', 'startedMs', 'duration', 'character', 'players', 'uploadedHealers',
    'uploadedDefenders', '_encIdForLink', 'isRaidWindow', 'WP_GUILD_NAME', '_recordKillLockouts', 'client',
    'process', 'console',
    `${DECIDE}\nreturn _decideKillDeferred;`,
  )(
    fakeRequire,
    { ended_at: new Date(KILL).toISOString() }, boss, KILL - 100_000, 100, 'Aldenmar',
    playersIn.map(name => ({ name })), [], [], 'enc-1', false, OURS,
    (a) => { calls.lockouts.push(a); return Promise.resolve(); }, {},
    { env: { SUPABASE_GUILD_ID: 'wolfpack', TIMER_CHANNEL_ID: 'chan' } },
    { log: (m) => logs.push(String(m)), warn: (...a) => logs.push(a.map(String).join(' ')) },
  );
  return { decide, sb, calls, logs };
}

describe('_decideKillDeferred (the real handler code, run)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ours: records the timer once and posts the board update', async () => {
    const { decide, calls } = runDecision();
    await decide();
    expect(calls.recordKill).toEqual([['gaukr_sandstorm', 3, null]]);
    expect(calls.post).toHaveLength(1);
    expect(calls.lockouts).toHaveLength(1);
    expect(calls.lockouts[0].killVerdict).toBe('ours');
  });

  it('pvp: no timer, no board post, the encounter is stamped, the lockout is still written with the verdict', async () => {
    const { decide, calls, sb } = runDecision({
      boss: HATE,
      tables: { pvp_boss_kills: [{ killed_at: new Date(KILL - 5000).toISOString(), raw_text: 'Zarrin of <Mayhem> has killed Lord of Ire in Plane of Hate (Instanced)!' }] },
    });
    vi.useFakeTimers();
    const p = decide();
    await vi.advanceTimersByTimeAsync(kc.PVP_DEFER_MS + 1);
    await p;
    expect(calls.recordKill).toEqual([]);
    expect(calls.post).toEqual([]);
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0].table).toBe('encounters');
    expect(sb.updates[0].q).toBe('id=eq.enc-1&classification=is.null');             // never over an officer's mark
    expect(sb.updates[0].body).toMatchObject({ classification: 'pvp', classification_by: 'auto' });
    expect(calls.lockouts).toHaveLength(1);
    expect(calls.lockouts[0].killVerdict).toBe('pvp');
  });

  it('live: a stranger-heavy fight stamps live and starts nothing', async () => {
    const { decide, calls, sb } = runDecision({ playersIn: [...ours(1), ...strangers(4)] });
    await decide();
    expect(calls.recordKill).toEqual([]);
    expect(sb.updates[0].body.classification).toBe('live');
    expect(calls.lockouts[0].killVerdict).toBe('live');
  });

  it('unknown: a duo starts no timer and does NOT touch the encounter', async () => {
    const { decide, calls, sb } = runDecision({ playersIn: ours(2) });
    await decide();
    expect(calls.recordKill).toEqual([]);
    expect(sb.updates).toEqual([]);
    expect(calls.lockouts[0].killVerdict).toBe('unknown');
  });

  it('an officer\'s mark already on the encounter keeps the timer down even on an ours verdict', async () => {
    const { decide, calls, sb } = runDecision({ classifiedAs: 'wipe' });
    await decide();
    expect(calls.recordKill).toEqual([]);
    expect(sb.updates).toEqual([]);
  });

  it('a boss already on cooldown keeps its timer (read after the awaits)', async () => {
    const { decide, calls } = runDecision({ bossState: { killedAt: Date.now() - 1000, nextSpawn: Date.now() + 3600_000 } });
    await decide();
    expect(calls.recordKill).toEqual([]);
  });

  it('FALLS BACK to today\'s behaviour on a failed read: the timer is recorded and the failure is logged', async () => {
    for (const fail of [['who_observations'], ['characters'], ['pvp_boss_kills'], ['encounters']]) {
      const { decide, calls, sb, logs } = runDecision({ fail });
      await decide();
      expect(calls.recordKill, fail[0]).toHaveLength(1);
      expect(sb.updates, fail[0]).toEqual([]);
      expect(logs.some(l => /classification failed/.test(l)), fail[0]).toBe(true);
    }
  });

  it('records the timer when Supabase is not configured', async () => {
    const { decide, calls } = runDecision({ enabled: false });
    await decide();
    expect(calls.recordKill).toHaveLength(1);
  });

  it('a PvP-capable zone waits 150 s before it reads anything; any other zone does not wait', async () => {
    vi.useFakeTimers();
    const hate = runDecision({ boss: HATE });
    const pHate = hate.decide();
    await vi.advanceTimersByTimeAsync(kc.PVP_DEFER_MS - 1000);
    expect(hate.sb.asked).toEqual([]);
    expect(hate.calls.recordKill).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    await pHate;
    expect(hate.sb.asked.length).toBeGreaterThan(0);
    expect(hate.calls.recordKill).toHaveLength(1);        // nothing said otherwise, so ours — but only after the wait

    const bastion = runDecision({ boss: BASTION });
    await bastion.decide();                                // resolves with no timer advance
    expect(bastion.calls.recordKill).toHaveLength(1);
  });
});

// ── text — the wiring around it ─────────────────────────────────────────────────────────────────────────

describe('the encounter handler\'s wiring', () => {
  const code = stripJs(SRC);

  it('recordKill(matchedBoss…) is called exactly once, inside the kill decision, after the ours gate', () => {
    expect(code.match(/recordKill\(matchedBoss\.id/g)).toHaveLength(1);
    const body = stripJs(DECIDE);
    expect(body).toMatch(/recordKill\(matchedBoss\.id, matchedBoss\.timerHours, null\)/);
    expect(body.indexOf("verdict.verdict !== 'ours'")).toBeGreaterThan(-1);
    expect(body.indexOf("verdict.verdict !== 'ours'")).toBeLessThan(body.indexOf('recordKill('));
    expect(body.slice(body.indexOf("verdict.verdict !== 'ours'"), body.indexOf('recordKill(')))
      .toMatch(/\breturn;/);
  });

  it('the decision starts after the ack, and only for a confirmed kill of a matched (non-backfill) boss', () => {
    const ack = code.indexOf('events_received:       encounter.events.length');
    const call = code.indexOf('_decideKillDeferred().catch');
    expect(ack).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(ack);
    expect(code.slice(call - 120, call)).toMatch(/if \(matchedBoss && encounter\.confirmed_kill === true\) \{\s*$/);
    expect(code.match(/_decideKillDeferred\(\)/g)).toHaveLength(1);
  });

  it('classifies post-ack with an unref\'d wait, never overwriting a mark', () => {
    const body = stripJs(DECIDE);
    expect(body).toMatch(/kc\.isPvpCapableZone\(matchedBoss\.zone\)/);
    expect(body).toMatch(/setTimeout\(resolve, kc\.PVP_DEFER_MS\)\.unref\(\)/);
    expect(body).toMatch(/classification=is\.null/);
    expect(body).toMatch(/catch \(err\) \{[\s\S]*verdict = \{ verdict: 'ours'/);
  });

  it('the kill-derived lockout write moved out of the pre-ack Supabase block and carries the verdict', () => {
    // One call site, in the decision (the definition reads `function _recordKillLockouts({`).
    expect(code.replace('function _recordKillLockouts({', '').match(/_recordKillLockouts\(\{/g)).toHaveLength(1);
    expect(stripJs(DECIDE)).toMatch(/_recordKillLockouts\(\{[\s\S]*killVerdict:\s+verdict\.verdict/);
    const lockoutFn = stripJs(sliceBlock(SRC, 'async function _recordKillLockouts({', '\n}\n'));
    expect(lockoutFn).toMatch(/killVerdict/);
    expect(lockoutFn).toMatch(/buildKillLockouts\(\{[\s\S]*roster, killVerdict,/);
  });
});

describe('migration 20261005220000_latest_kill_per_npc_ours_only.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261005220000_latest_kill_per_npc_ours_only.sql');
  const sql = stripSql(fs.readFileSync(file, 'utf8')).replace(/\s+/g, ' ');
  const previous = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261004140000_latest_kill_per_npc.sql'), 'utf8'))
    .replace(/\s+/g, ' ');

  it('keeps only unclassified, finished encounters', () => {
    expect(sql).toMatch(/and e\.classification is null/i);
    expect(sql).toMatch(/and e\.ended_at is not null/i);
  });
  it('keeps only kills with three or more players, so an "unknown" duo kill cannot come back on a restart', () => {
    expect(sql).toMatch(/and exists \(select 1 from encounter_players ep where ep\.encounter_id = e\.id offset 2\)/i);
  });
  it('is the same function otherwise: signature, return shape, selection and ordering', () => {
    expect(sql).toMatch(/create or replace function public\.latest_kill_per_npc\(p_guild_id text, p_since timestamptz, p_npc_ids int\[\]\)/i);
    expect(sql).toMatch(/returns table\(npc_id int, started_at timestamptz, zone_short text, id uuid\)/i);
    expect(sql).toMatch(/select distinct on \(e\.npc_id\) e\.npc_id, e\.started_at, e\.zone_short, e\.id/i);
    expect(sql).toMatch(/order by e\.npc_id, e\.started_at desc, e\.id/i);
    expect(sql).toMatch(/e\.guild_id = p_guild_id/i);
    expect(sql).toMatch(/e\.started_at >= p_since/i);
    expect(sql).toMatch(/e\.npc_id = any\(p_npc_ids\)/i);
    expect(sql).toMatch(/language sql stable security invoker set search_path = public/i);
    expect(sql).not.toMatch(/security definer/i);
  });
  it('keeps the original grants: service_role only', () => {
    for (const who of ['public', 'anon', 'authenticated']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.latest_kill_per_npc\\(text, timestamptz, int\\[\\]\\) from ${who};`, 'i'));
    }
    expect(sql).toMatch(/grant execute on function public\.latest_kill_per_npc\(text, timestamptz, int\[\]\) to service_role;/i);
  });
  it('the old migration is untouched and still has no classification filter (history stays history)', () => {
    expect(previous).not.toMatch(/classification/i);
  });
  it('sorts after the migration it replaces', () => {
    expect(path.basename(file) > '20261004140000_latest_kill_per_npc.sql').toBe(true);
  });
});
