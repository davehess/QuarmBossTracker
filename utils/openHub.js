// utils/openHub.js — the open "commons" hub's rules, as pure functions (docs/DESIGN-open-hub.md).
//
// The guild lead, 2026-10-23: "anyone can join, once a guild has 12 members they need to stand up their own or
// pay for the 25 hosting. Usage logs will not be kept for long term on my storage, but instead be available in
// the end user's mimic."
//
// DORMANT. Nothing in index.js, commands/ or the agent requires this file yet (phase 0 of the design). It holds
// the three rules that must be decided once and tested before any route is built on them:
//   1. who counts as a member of a guild (countActivePlayers) — in PLAYERS, never characters;
//   2. what happens as that number climbs (nextGateState): ok -> nearing -> over -> grace -> limited;
//   3. how long the hub keeps each usage stream (RETENTION, retentionCutoff), per plan.
// Pure: no Discord, no Supabase, no clock of its own (the caller passes `now`).

'use strict';

// ── 1. Counting ───────────────────────────────────────────────────────────────

const ACTIVE_WINDOW_DAYS = 30;   // rolling window, UTC days, today included
const MIN_ACTIVE_DAYS = 2;       // a player counts only after uploading on this many distinct days in the window
const DAY_MS = 86_400_000;

const _dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Distinct ACTIVE PLAYERS per guild over a rolling window.
 *
 * rows: [{ guild_id, player_id, day: 'YYYY-MM-DD', role? }] — one row per (guild, player, UTC day with an accepted
 * upload), the shape of hub_player_activity. A character is never a unit here: callers pass the PLAYER id.
 *
 *  - A day outside [today - (windowDays - 1), today] is ignored.
 *  - A 'guest' (raid-code or guest-pass visitor) never counts: a guest is not a member of the guild's bill.
 *  - A player needs minDays distinct days in the window under a guild to count there at all (one stray upload
 *    from a visitor must not tip a guild over its cap).
 *  - A player counts ONCE: in the guild where they were active on the most days (ties: the smaller guild_id).
 *    Someone who raids with two groups costs one seat, in the group they mostly play with.
 *
 * Returns { counts: { [guild_id]: n }, players: { [guild_id]: [player_id...] } }.
 */
function countActivePlayers(rows, { now, windowDays = ACTIVE_WINDOW_DAYS, minDays = MIN_ACTIVE_DAYS } = {}) {
  const today = _dayOf(now);
  const first = _dayOf(now - (windowDays - 1) * DAY_MS);
  const days = new Map();   // player -> guild -> Set(day)
  for (const r of rows || []) {
    if (!r || !r.guild_id || !r.player_id || typeof r.day !== 'string') continue;
    if (r.role === 'guest') continue;
    if (r.day < first || r.day > today) continue;
    let g = days.get(r.player_id);
    if (!g) days.set(r.player_id, g = new Map());
    let s = g.get(r.guild_id);
    if (!s) g.set(r.guild_id, s = new Set());
    s.add(r.day);
  }
  const counts = {};
  const players = {};
  for (const [player, g] of days) {
    let best = null;
    for (const [guild, s] of g) {
      if (s.size < minDays) continue;
      if (!best || s.size > best.n || (s.size === best.n && guild < best.guild)) best = { guild, n: s.size };
    }
    if (!best) continue;
    counts[best.guild] = (counts[best.guild] || 0) + 1;
    (players[best.guild] || (players[best.guild] = [])).push(player);
  }
  for (const g of Object.keys(players)) players[g].sort();
  return { counts, players };
}

// ── 2. The gate ───────────────────────────────────────────────────────────────

const COMMONS_CAP = 12;            // the guild lead's number: at 12 active players a commons guild has to choose
const MANAGED_CAP = 60;            // the managed plan's price band (DECISIONS §386): $25/mo up to 60 raiders
const NEARING_FRACTION = 0.75;     // 9 of 12: the heads-up
const RELEASE_AT = 10;           // a guild that was over must fall to THIS (commons) before it is let off: no flapping at 11-12
const CONFIRM_EVALS = 3;           // consecutive daily evaluations at/over the cap before it is real (a one-night guest crowd is not)
const GRACE_DAYS = 14;             // the same length as the managed trial
const MAX_GRACE_EXTENSION_DAYS = 14;   // one extension, asked for by the guild's owner, granted by the guild lead

const STATES = ['ok', 'nearing', 'over', 'grace', 'limited'];
const PLANS = ['commons', 'managed', 'self_hosted'];

function capFor(plan) { return plan === 'managed' ? MANAGED_CAP : COMMONS_CAP; }
function nearingAt(plan) { return Math.ceil(capFor(plan) * NEARING_FRACTION); }
function releaseAt(plan) { return plan === 'managed' ? Math.floor(MANAGED_CAP * 0.9) : RELEASE_AT; }

/** What a state takes away. `localMimic` is true in EVERY state and a test holds it there: a player's own Mimic never stops. */
function limitsFor(state) {
  const limited = state === 'limited';
  return {
    sharedStreams: !limited,   // raid-wide uploads the guild's overlays read: roster, live state, casting, buff queue, trigger relay
    newMembers: !limited,      // joining the guild
    history: true,             // read and export what the hub still holds (never taken away; export is the exit)
    personal: true,            // a player's own character data about themselves
    localMimic: true,          // the app, its overlays, triggers, meter and the local store
    banner: state === 'ok' ? null : state,
  };
}

/**
 * One daily evaluation of one guild.
 *
 * input: { plan, activePlayers, now, extendGrace?, prev? }
 *   prev: { state, overStreak, overSince (ms|null), graceEndsAt (ms|null), graceExtraDays }  (omit for a new guild)
 * returns { state, overStreak, overSince, graceEndsAt, graceExtraDays, daysLeft, notify, limits }
 *   notify (null, or what to tell the guild's owner and officers THIS evaluation; the caller de-duplicates by
 *   guild + notify + daysLeft because an evaluation may run twice in a day):
 *   'nearing' | 'over' | 'grace_reminder' (7 and 2 days left) | 'limited' | 'recovered'
 *
 * Plans: 'commons' has the 12 cap and the grace/limit path. 'managed' has a 60 cap and only ever reports (a guild
 * that outgrew its price band is a conversation, not a cut-off). 'self_hosted' is not counted at all.
 */
function nextGateState({ plan = 'commons', activePlayers, now, extendGrace = false, prev = null } = {}) {
  if (!PLANS.includes(plan)) throw new Error(`unknown plan: ${plan}`);
  const blank = { state: 'ok', overStreak: 0, overSince: null, graceEndsAt: null, graceExtraDays: 0 };
  if (plan === 'self_hosted') return _out({ ...blank }, null, null);

  const cap = capFor(plan);
  const p = prev && STATES.includes(prev.state) ? { ...blank, ...prev } : { ...blank };
  const n = Math.max(0, Number(activePlayers) || 0);
  const wasPast = p.state === 'over' || p.state === 'grace' || p.state === 'limited';
  const limitable = plan === 'commons';

  if (wasPast) {
    if (n <= releaseAt(plan)) {
      const state = n >= nearingAt(plan) ? 'nearing' : 'ok';
      return _out({ ...blank, state }, null, 'recovered');
    }
    if (!limitable) return _out({ ...p, state: 'over' }, null, null);
    let extra = p.graceExtraDays || 0;
    let ends = p.graceEndsAt;
    if (extendGrace && extra < MAX_GRACE_EXTENSION_DAYS && p.state !== 'limited' && ends) {
      extra = MAX_GRACE_EXTENSION_DAYS;
      ends += MAX_GRACE_EXTENSION_DAYS * DAY_MS;
    }
    if (p.state === 'limited' || now >= ends) {
      return _out({ ...p, state: 'limited', graceExtraDays: extra, graceEndsAt: ends }, now, p.state === 'limited' ? null : 'limited');
    }
    const left = _daysLeft(ends, now);
    return _out({ ...p, state: 'grace', graceExtraDays: extra, graceEndsAt: ends }, now, (left === 7 || left === 2) ? 'grace_reminder' : null);
  }

  if (n >= cap) {
    const streak = (p.overStreak || 0) + 1;
    if (streak < CONFIRM_EVALS) return _out({ ...p, state: 'nearing', overStreak: streak }, null, streak === 1 && p.state !== 'nearing' ? 'nearing' : null);
    // Confirmed. Day zero is `over` (the notice goes out); the next evaluation is `grace` (the countdown).
    if (!limitable) return _out({ ...blank, state: 'over', overStreak: streak, overSince: now }, null, 'over');
    const ends = now + (GRACE_DAYS + (p.graceExtraDays || 0)) * DAY_MS;
    return _out({ ...blank, state: 'over', overStreak: streak, overSince: now, graceEndsAt: ends, graceExtraDays: p.graceExtraDays || 0 }, now, 'over');
  }
  if (n >= nearingAt(plan)) return _out({ ...blank, state: 'nearing' }, null, p.state === 'nearing' ? null : 'nearing');
  return _out({ ...blank, state: 'ok' }, null, null);
}

function _daysLeft(ends, now) { return Math.max(0, Math.ceil((ends - now) / DAY_MS)); }
function _out(s, now, notify) {
  return {
    ...s,
    daysLeft: s.graceEndsAt && now != null ? _daysLeft(s.graceEndsAt, now) : null,
    notify,
    limits: limitsFor(s.state),
  };
}

// ── 3. Retention ──────────────────────────────────────────────────────────────

const H = 1, D = 24;   // hours

// One row per hub stream. `commons` is the free hub's window, `managed` the paid tenant's (Wolf Pack's own
// windows; null = no sweep), both in hours. `mbPerPlayerDay` is what one player's uploads add per day, MEASURED
// 2026-10-23 on Wolf Pack's database over the last 14 days (42 uploading players; bytes per row = table incl.
// indexes / live rows, so it is the real disk cost): docs/DESIGN-open-hub.md section 5.
// `sweep` names the column the sweeper's DELETE filters on: every one needs a leading index on it (DESIGN-selfhost-wizard
// section 3, 2026-09-01: a sweep with no usable index is a seq scan that the client timeout kills silently).
const RETENTION = {
  character_live_state:        { table: 'character_live_state',        sweep: 'updated_at',  commons: 6 * H,    managed: 24 * H,   mbPerPlayerDay: 0 },
  raid_roster:                 { table: 'raid_roster',                 sweep: 'captured_at', commons: 6 * H,    managed: 12 * H,   mbPerPlayerDay: 0 },
  encounter_threat_snapshots:  { table: 'encounter_threat_snapshots',  sweep: 'snapshot_at', commons: 2 * D,    managed: 30 * D,   mbPerPlayerDay: 1.325 },
  buff_casts:                  { table: 'buff_casts',                  sweep: 'cast_at',     commons: 3 * D,    managed: 7 * D,    mbPerPlayerDay: 0.300 },
  raid_track_minutes:          { table: 'raid_track_minutes',          sweep: 'minute_at',   commons: 7 * D,    managed: null,     mbPerPlayerDay: 0.026 },
  encounter_events:            { table: 'encounter_events',            sweep: 'at',          commons: 14 * D,   managed: null,     mbPerPlayerDay: 0.075 },
  encounter_combat_rollup:     { table: 'encounter_combat_rollup',     sweep: 'created_at',  commons: 14 * D,   managed: null,     mbPerPlayerDay: 0.049 },
  contributions:               { table: 'contributions',               sweep: 'created_at',  commons: 30 * D,   managed: null,     mbPerPlayerDay: 0.024 },
  encounters:                  { table: 'encounters',                  sweep: 'started_at',  commons: 60 * D,   managed: null,     mbPerPlayerDay: 0.0075 },
  encounter_players:           { table: 'encounter_players',           sweep: 'encounter_id', via: 'encounters', commons: 60 * D, managed: null, mbPerPlayerDay: 0.014 },
  encounter_threat_graph:      { table: 'encounter_threat_graph',      sweep: 'encounter_id', via: 'encounters', commons: 60 * D, managed: null, mbPerPlayerDay: 0.009 },
};

// Streams the commons refuses outright (a 200-and-drop at the door, like the shed pattern). Each is either personal
// (it stays on the player's PC, the local-first rule), or names people who never agreed to a stranger's hub, or
// is the PvP /who carve-out (DECISIONS 2026-09-18 section 8.6: we never ingest other tenants' /who).
const COMMONS_REFUSED = Object.freeze([
  'tells', 'chat', 'historical_chat', 'guild_chat',
  'pvp', 'pvp_assists', 'who_observations',
  'xp_events', 'faction', 'inventory', 'spellbook',
  'fun_event',
]);

/** Is this inbound stream accepted by the commons hub at all? */
function commonsAccepts(stream) { return !COMMONS_REFUSED.includes(stream); }

/** The newest timestamp (ISO) a row of `stream` may have and be deleted, or null when the plan keeps it. */
function retentionCutoff(stream, plan, now) {
  const r = RETENTION[stream];
  if (!r) throw new Error(`unknown stream: ${stream}`);
  if (!PLANS.includes(plan)) throw new Error(`unknown plan: ${plan}`);
  if (plan === 'self_hosted') return null;   // the hub holds nothing for a self-hosted guild
  const hours = plan === 'managed' ? r.managed : r.commons;
  return hours == null ? null : new Date(now - hours * 3_600_000).toISOString();
}

/** The streams a sweep has to run for a plan today, with their cutoffs. */
function sweepPlan(plan, now) {
  return Object.keys(RETENTION)
    .map(stream => ({ stream, table: RETENTION[stream].table, column: RETENTION[stream].sweep, via: RETENTION[stream].via || null, before: retentionCutoff(stream, plan, now) }))
    .filter(x => x.before);
}

/**
 * Disk one player holds on the hub at steady state, MB: the sum over the streams of (measured MB a day) x (window in days).
 * A plan that keeps a stream forever (null) is counted for `horizonDays` of growth instead, so the two plans can be set side by side.
 */
function steadyStateMbPerPlayer(plan, horizonDays = 180) {
  let mb = 0;
  for (const r of Object.values(RETENTION)) {
    const hours = plan === 'managed' ? r.managed : r.commons;
    const days = hours == null ? horizonDays : hours / 24;
    mb += r.mbPerPlayerDay * days;
  }
  return mb;
}

// ── Guild slugs ───────────────────────────────────────────────────────────────

// A guild's tag is a guild_id on every row: lowercase, 3-24 chars, letters/digits/hyphen, no leading or trailing
// hyphen. These are reserved: Wolf Pack's own tag (the commons must never be able to write into it), the commons'
// own bucket names, and words that would read as the platform itself.
const RESERVED_SLUGS = Object.freeze(['wolfpack', 'wolf-pack', 'commons', 'hub', 'admin', 'raidmimic', 'raid-mimic', 'eqmimic', 'solo', 'guest', 'system', 'null', 'undefined']);
const SLUG_RX = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;

function validGuildSlug(slug) {
  const s = String(slug || '');
  return SLUG_RX.test(s) && !s.includes('--') && !RESERVED_SLUGS.includes(s) && !s.startsWith('solo-');
}

module.exports = {
  ACTIVE_WINDOW_DAYS, MIN_ACTIVE_DAYS, COMMONS_CAP, MANAGED_CAP, RELEASE_AT, CONFIRM_EVALS, GRACE_DAYS, MAX_GRACE_EXTENSION_DAYS,
  STATES, PLANS, RETENTION, COMMONS_REFUSED, RESERVED_SLUGS,
  countActivePlayers, nextGateState, limitsFor, capFor, nearingAt,
  retentionCutoff, sweepPlan, commonsAccepts, steadyStateMbPerPlayer, validGuildSlug,
};
