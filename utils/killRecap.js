// utils/killRecap.js — the "how did we do" recap that rides on a raid boss's kill card.
//
// The guild lead, 2026-10-13: after each raid boss kill, a short recap — "how much faster than last time" —
// that (1) sits INSIDE the kill card the bot already posts to the raid-night thread (a field on that card,
// never a second message), (2) is also published for wolfpack.quest/screen's Overview so the whole raid sees
// it on the stream, and (3) mentions the fun events and highlights stellar performance. DECISIONS §284: the
// announcers say nothing DURING a fight, so a recap exists only once the kill is confirmed.
//
// THREE LAYERS, so each can be tested and replayed on its own:
//   buildRecap(input)       pure: numbers in, { lines, fun, stars } out. No clock, no I/O.
//   assembleInputs(rows)    pure: raw table rows -> buildRecap's input. This is where "which kills count as a
//                           prior" and "which deaths belong to this fight" are decided.
//   fetchRecapRows()/loadRecap()   the only code that touches Supabase (paged / bounded reads); loadRecap
//                           chains the three. scripts/replay-kill-recaps.js feeds assembleInputs from a
//                           JSON dump instead, which is how a recap is replayed on last week's fights.
//
// RULES THIS FILE HOLDS (each is a decision, not an accident):
//   * Raid DPS is damage / duration_sec of the raiders on the parse. encounters.total_dps is NOT used (it is
//     inflated: the merge sums per-player rates over the longest window).
//   * A raider is a parse row whose name is in `characters`. Pets and strangers do not count.
//   * A prior is an earlier CONFIRMED kill (ended_at set) of the same npc that is unclassified (a 'pvp',
//     'live' or 'foreign' row is not ours), not flagged data_incomplete, with >= MIN_RAIDERS raiders.
//   * Deaths: uploads carry deaths from long after the fight (a Grummus parse held one 20 minutes late), so
//     each contributor's list is CLIPPED to the fight +/- DEATH_CLIP_MS before the web page's dedup runs.
//     contributions.raw_parse is nulled after 7 days, so an old prior has UNKNOWN deaths (null), which is not
//     the same as zero: nothing is claimed about a fight whose deaths we cannot read.
//   * Raid size differs from the last kill by > SIZE_DIFF_FRAC -> the headline is DPS per raider, because a
//     fight with 37 against one with 21 says nothing about speed.
//   * A DPS figure more than DPS_SANE_RATIO times (or under a third of) the last kill's is treated as a partial
//     parse on one side: the DPS line and the personal-best stars are dropped; the time comparison stands.
//   * Stars are honest or absent: a record needs >= RECORD_MIN_PRIORS priors, a personal best needs the
//     raider to have >= PB_MIN_PRIOR_KILLS earlier kills AND to beat them by PB_MIN_GAIN, flawless needs
//     deaths we could read. Thin data (< MIN_RAIDERS on this kill) -> no recap at all.

'use strict';

const { dedupParseDeaths } = require('./parseDeaths');

const MIN_RAIDERS = 10;
const MIN_ROSTER_FRAC = 0.5;          // fewer than half the parse on our roster = not our raid (killLockouts' line)
const SIZE_DIFF_FRAC = 0.25;
const SAME_PCT = 0.03;                // within 3% = "about the same"
const DPS_SANE_RATIO = 3;             // DPS more than 3x (or under 1/3 of) the last kill's = a partial parse, not news
const DEATH_CLIP_MS = 10_000;
const FUN_WINDOW_MS = 60_000;
const RECORD_MIN_PRIORS = 2;
const PB_MIN_PRIOR_KILLS = 2;
const PB_MIN_GAIN = 0.05;
const PRIOR_MAX = 100;                // newest priors read for players
const PLAYER_CHUNK = 25;              // encounter ids per encounter_players read
const MAX_FUN_LINES = 3;
const MAX_STARS = 3;
const ROSTER_TTL_MS = 10 * 60_000;
const RECAP_TZ = 'America/New_York';

// The fun events worth a line DURING a boss fight, in raider words. Anything not listed is ignored.
const FUN = {
  dragon_punch:   { emoji: '🥊', one: 'dragon punch',  many: 'dragon punches' },
  mind_wrack_cast:{ emoji: '🧠', one: 'Mind Wrack',    many: 'Mind Wracks' },
  mana_twitch:    { emoji: '🔮', one: 'mana twitch',   many: 'mana twitches' },
  drunkard:       { emoji: '🍺', one: 'drunken stumble', many: 'drunken stumbles' },
  hot_dice:       { emoji: '🎲', one: 'Hot Dice roll', many: 'Hot Dice rolls' },
  deathroll:      { emoji: '🎲', one: 'deathroll',     many: 'deathrolls' },
};

const arr = (v) => (Array.isArray(v) ? v : []);
const lower = (s) => String(s || '').trim().toLowerCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : 0; };
const plural = (n, one, many) => (n === 1 ? one : many);

function fmtDur(sec) {
  const s = Math.max(0, Math.round(num(sec)));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
/** A gap in plain words: "14s", "1m 04s". */
function fmtGap(sec) {
  const s = Math.max(0, Math.round(num(sec)));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function fmtNum(n) { return Math.round(num(n)).toLocaleString('en-US'); }
function fmtDmg(n) {
  const v = num(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}
function fmtDay(atMs) {
  try { return new Date(atMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: RECAP_TZ }); }
  catch { return ''; }
}
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);

/** An earlier kill we can fairly compare against. */
function isComparable(p) {
  return !!p && num(p.durationSec) > 0 && num(p.raiders) >= MIN_RAIDERS;
}

// ── buildRecap ────────────────────────────────────────────────────────────────

/**
 * @param {object} i
 * @param {{ name:string, startedAtMs:number, durationSec:number }} i.kill
 * @param {Array<{ startedAtMs:number, durationSec:number, raiders:number, damage:number, deaths:(number|null) }>} i.priors
 *        earlier unclassified confirmed kills of this boss, any size (small ones only decide "first kill" wording)
 * @param {Array<{ name:string, damage:number }>} i.players   this kill's raiders (roster rows only)
 * @param {Array<{ name:string, ts:number }>|null} i.deaths   this fight's raider deaths, or null = unreadable
 * @param {Array<{ type:string, caster:string, atMs:number }>} [i.funEvents]
 * @param {Array<{ name:string, priorKills:number, priorBestDps:number }>} [i.personalBests]
 * @returns {{ lines:string[], fun:string[], stars:string[] }|null}  null = nothing honest to say
 */
function buildRecap(i = {}) {
  const kill = i.kill || {};
  const dur = num(kill.durationSec);
  const players = arr(i.players).filter(p => p && p.name);
  const raiders = players.length;
  if (dur <= 0 || raiders < MIN_RAIDERS) return null;

  const startMs = num(kill.startedAtMs);
  const damage = players.reduce((s, p) => s + num(p.damage), 0);
  if (damage <= 0) return null;
  const raidDps = damage / dur;
  const perRaider = raidDps / raiders;
  const boss = kill.name || 'the boss';

  const allPriors = arr(i.priors).filter(p => p && ms(p.startedAtMs) < startMs);
  const priors = allPriors.filter(isComparable).sort((a, b) => ms(a.startedAtMs) - ms(b.startedAtMs));
  const last = priors[priors.length - 1] || null;
  const best = priors.reduce((m, p) => (!m || p.durationSec < m.durationSec ? p : m), null);

  const deathsKnown = Array.isArray(i.deaths);
  const deathCount = deathsKnown ? i.deaths.length : null;

  const lines = [];
  const stars = [];
  let dpsSuspect = false;

  if (!last) {
    // Nothing comparable. "First kill" only when no earlier kill of any size exists; otherwise the earlier ones
    // were small groups and the honest claim is the narrower one.
    const first = allPriors.length === 0 ? 'First kill!' : 'First kill with a full raid!';
    lines.push(`${first} Down in ${fmtDur(dur)} with ${raiders} raiders — ${fmtNum(raidDps)} raid DPS.`);
  } else {
    const lastPerRaider = (last.damage / last.durationSec) / last.raiders;
    const sizeFar = Math.abs(raiders - last.raiders) / last.raiders > SIZE_DIFF_FRAC;
    const diff = dur - last.durationSec;
    const prev = `${fmtDur(last.durationSec)}, ${fmtDay(last.startedAtMs)}`;
    let timeLine;
    if (Math.abs(diff) / last.durationSec <= SAME_PCT) timeLine = `Down in ${fmtDur(dur)} — about the same as last time (${prev}).`;
    else if (diff < 0) timeLine = `Down in ${fmtDur(dur)} — ${fmtGap(-diff)} faster than last time (${prev}).`;
    else timeLine = `Down in ${fmtDur(dur)} — ${fmtGap(diff)} slower than last time (${prev}).`;

    // A damage figure three times (or a third of) the last kill's, at the same raid strength, is a partial parse
    // on one side, not a raid that changed: say nothing about DPS and award no DPS star rather than print it.
    const lastDps = last.damage / last.durationSec;
    const ratio = (sizeFar ? perRaider / lastPerRaider : raidDps / lastDps);
    dpsSuspect = !(ratio > 1 / DPS_SANE_RATIO && ratio < DPS_SANE_RATIO);

    if (sizeFar) {
      const g = pct(perRaider, lastPerRaider);
      const how = Math.abs(g) < 1 ? 'the same as' : `${Math.abs(g)}% ${g > 0 ? 'higher than' : 'lower than'}`;
      if (!dpsSuspect) lines.push(`${fmtNum(perRaider)} DPS per raider — ${how} last time (${fmtNum(lastPerRaider)}), with ${raiders} raiders against ${last.raiders}.`);
      lines.push(timeLine);
    } else {
      lines.push(timeLine);
      const g = pct(raidDps, lastDps);
      if (!dpsSuspect) lines.push(`Raid DPS ${fmtNum(raidDps)} — ${Math.abs(g) < 1 ? 'level with' : `${g > 0 ? 'up' : 'down'} ${Math.abs(g)}% on`} last time (${fmtNum(lastDps)}).`);
    }
    if (best && best !== last && dur > best.durationSec) {
      lines.push(`Our best is ${fmtDur(best.durationSec)} (${fmtDay(best.startedAtMs)}).`);
    }
  }

  if (deathsKnown) {
    const lastDeaths = last && Number.isFinite(last.deaths) ? last.deaths : null;
    const against = lastDeaths === null ? '' : ` (last time ${lastDeaths})`;
    lines.push(deathCount === 0 ? `Nobody died${against}.` : `${deathCount} ${plural(deathCount, 'death', 'deaths')}${against}.`);
  }

  // ── Stars ───────────────────────────────────────────────────────────────────
  if (best && priors.length >= RECORD_MIN_PRIORS && dur < best.durationSec) {
    stars.push(`New record — fastest ${boss} yet: ${fmtDur(dur)}, ${fmtGap(best.durationSec - dur)} under the old best (${fmtDur(best.durationSec)}).`);
  }
  if (deathsKnown && deathCount === 0) stars.push(`Flawless — nobody died, ${raiders} raiders.`);

  const pbs = dpsSuspect ? [] : arr(i.personalBests).filter(b => b && b.name);
  const dpsOf = new Map(players.map(p => [lower(p.name), num(p.damage) / dur]));
  let topPb = null;
  for (const b of pbs) {
    const now = dpsOf.get(lower(b.name));
    if (!now || num(b.priorKills) < PB_MIN_PRIOR_KILLS || num(b.priorBestDps) <= 0) continue;
    const gain = (now - b.priorBestDps) / b.priorBestDps;
    if (gain >= PB_MIN_GAIN && (!topPb || gain > topPb.gain)) topPb = { name: players.find(p => lower(p.name) === lower(b.name)).name, now, was: b.priorBestDps, gain };
  }
  if (topPb) stars.push(`${topPb.name} set a personal best on ${boss}: ${fmtNum(topPb.now)} DPS, up from ${fmtNum(topPb.was)}.`);

  const top = players.reduce((m, p) => (!m || num(p.damage) > num(m.damage) ? p : m), null);
  if (top) stars.push(`Top damage: ${top.name} — ${fmtDmg(top.damage)} (${Math.round((num(top.damage) / damage) * 100)}% of the raid).`);

  return { lines, fun: funLines(i.funEvents, startMs, dur), stars: stars.slice(0, MAX_STARS) };
}

/** Fun events inside the fight +/- a minute, most frequent first, as "🥊 14 dragon punches (6 raiders)". */
function funLines(events, startMs, durSec) {
  const from = startMs - FUN_WINDOW_MS;
  const to = startMs + durSec * 1000 + FUN_WINDOW_MS;
  const by = new Map();
  for (const e of arr(events)) {
    const def = e && FUN[e.type];
    const at = ms(e && e.atMs);
    if (!def || at < from || at > to) continue;
    const g = by.get(e.type) || { n: 0, who: new Map() };
    g.n += 1;
    if (e.caster) g.who.set(lower(e.caster), e.caster);
    by.set(e.type, g);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, MAX_FUN_LINES)
    .map(([type, g]) => {
      const def = FUN[type];
      const names = [...g.who.values()];
      const who = names.length === 0 ? '' : names.length <= 3 ? ` — ${names.join(', ')}` : ` (${names.length} raiders)`;
      return `${def.emoji} ${g.n} ${plural(g.n, def.one, def.many)}${who}`;
    });
}

// ── assembleInputs (pure) ─────────────────────────────────────────────────────

/** Deaths the fight owns: each contributor's list clipped to the fight +/- DEATH_CLIP_MS, THEN the web page's
 *  dedup, then raiders only. null when no contributor's raw_parse survives (unreadable, not zero). */
function fightDeaths(contribs, startMs, durSec, rosterSet) {
  const rows = arr(contribs);
  if (!rows.some(c => c && c.dur != null)) return null;
  const lo = startMs - DEATH_CLIP_MS;
  const hi = startMs + durSec * 1000 + DEATH_CLIP_MS;
  const lists = rows.map(c => arr(c && c.deaths).filter(d => {
    const t = ms(d && d.ts);
    return t >= lo && t <= hi;
  }));
  return dedupParseDeaths(lists)
    // A raider is on the roster, or the log gave the death a class (a pet or an NPC namesake has neither).
    .filter(d => rosterSet.has(lower(d.name)) || !!d.class)
    .map(d => ({ name: d.name, ts: ms(d.ts), count: d.count }))
    .flatMap(d => Array.from({ length: Math.max(1, d.count) }, () => ({ name: d.name, ts: d.ts })));
}

const toRoster = (r) => (r instanceof Set ? r : new Set(arr(r).map(lower)));

/**
 * Raw rows -> buildRecap's input, or null when this kill should not get a recap.
 * rows: { roster, kill, killPlayers, killContribs, priorEncs, priorPlayers, priorContribs, funRows }
 *   kill / priorEncs   encounters rows { id, npc_id, started_at, ended_at, duration_sec, classification, data_incomplete }
 *   killPlayers / priorPlayers   encounter_players rows { encounter_id?, character_name, total_damage }
 *   killContribs / priorContribs contributions rows { encounter_id?, deaths, dur }  (dur = raw_parse->duration)
 *   funRows            fun_events rows { event_type, caster, event_ts }
 */
function assembleInputs(rows, { bossName } = {}) {
  const r = rows || {};
  const k = r.kill;
  if (!k || !k.ended_at || k.classification || k.data_incomplete === true) return null;
  const roster = toRoster(r.roster);
  const startMs = ms(k.started_at);
  const durSec = num(k.duration_sec);
  if (!startMs || durSec <= 0) return null;

  const rowsOf = arr(r.killPlayers).filter(p => p && p.character_name);
  const players = rowsOf.filter(p => roster.has(lower(p.character_name)))
    .map(p => ({ name: p.character_name, damage: num(p.total_damage) }));
  if (roster.size > 0 && rowsOf.length > 0 && players.length / rowsOf.length < MIN_ROSTER_FRAC) return null;

  const playersBy = new Map();
  for (const p of arr(r.priorPlayers)) {
    if (!p || !roster.has(lower(p.character_name))) continue;
    const l = playersBy.get(p.encounter_id) || [];
    l.push({ name: p.character_name, damage: num(p.total_damage) });
    playersBy.set(p.encounter_id, l);
  }
  const contribsBy = new Map();
  for (const c of arr(r.priorContribs)) {
    const l = contribsBy.get(c && c.encounter_id) || [];
    l.push(c);
    contribsBy.set(c && c.encounter_id, l);
  }

  const priors = [];
  for (const e of arr(r.priorEncs)) {
    if (!e || !e.ended_at || e.classification || e.data_incomplete === true) continue;
    const eStart = ms(e.started_at);
    if (!eStart || eStart >= startMs) continue;
    const ps = playersBy.get(e.id) || [];
    const cs = contribsBy.get(e.id);
    const theirDeaths = cs ? fightDeaths(cs, eStart, num(e.duration_sec), roster) : null;
    priors.push({
      id: e.id,
      startedAtMs: eStart,
      durationSec: num(e.duration_sec),
      raiders: ps.length,
      damage: ps.reduce((s, p) => s + p.damage, 0),
      players: ps,
      deaths: theirDeaths ? theirDeaths.length : null,
    });
  }

  // Each current raider's earlier kills (comparable ones only) and best DPS in them.
  const comparable = priors.filter(isComparable);
  const personalBests = players.map(p => {
    let kills = 0, bestDps = 0;
    for (const pr of comparable) {
      const mine = pr.players.find(q => lower(q.name) === lower(p.name));
      if (!mine || mine.damage <= 0) continue;
      kills += 1;
      bestDps = Math.max(bestDps, mine.damage / pr.durationSec);
    }
    return { name: p.name, priorKills: kills, priorBestDps: bestDps };
  });

  return {
    kill: { name: bossName || null, startedAtMs: startMs, durationSec: durSec, npcId: k.npc_id ?? null },
    priors,
    players,
    deaths: fightDeaths(r.killContribs, startMs, durSec, roster),
    funEvents: arr(r.funRows).filter(f => f && FUN[f.event_type])
      .map(f => ({ type: f.event_type, caster: f.caster, atMs: ms(f.event_ts) })),
    personalBests,
  };
}

// ── The loader (the only Supabase code in this file) ──────────────────────────

let _rosterMemo = { at: 0, guild: null, set: null };

async function loadRoster(supabase, guildId, nowMs) {
  if (_rosterMemo.set && _rosterMemo.guild === guildId && nowMs - _rosterMemo.at < ROSTER_TTL_MS) return _rosterMemo.set;
  const rows = await supabase.selectAllPaged('characters', `guild_id=eq.${encodeURIComponent(guildId)}&select=name`, 'name');
  if (!Array.isArray(rows)) throw new Error('characters read failed');
  const set = new Set(rows.map(x => lower(x && x.name)).filter(Boolean));
  _rosterMemo = { at: nowMs, guild: guildId, set };
  return set;
}

const needRows = (rows, what) => {
  if (!Array.isArray(rows)) throw new Error(`${what} read failed`);
  return rows;
};

/**
 * Read everything assembleInputs wants for one encounter id. THROWS on any failed read (supabase answers null,
 * which is not "no rows"), so a brownout reads as "no recap", never as a recap built from half a picture.
 * Every read names its bound (limit=, or the shared pager) — see test/db-read-discipline.test.js.
 * Returns null when the encounter is missing or not a confirmed kill.
 */
async function fetchRecapRows({ supabase, guildId, encounterId, nowMs = Date.now() }) {
  const enc = encodeURIComponent;
  if (!guildId) throw new Error('fetchRecapRows: guildId is required');
  const gid = guildId;
  const iso = (t) => enc(new Date(t).toISOString());

  const kr =needRows(await supabase.select('encounters',
    `id=eq.${enc(encounterId)}&select=id,npc_id,started_at,ended_at,duration_sec,classification,data_incomplete&limit=1`), 'encounters');
  const kill = kr[0];
  if (!kill || !kill.ended_at || !kill.npc_id) return null;
  const startMs = ms(kill.started_at);
  const durSec = num(kill.duration_sec);
  const from = startMs - FUN_WINDOW_MS;
  const to = startMs + durSec * 1000 + FUN_WINDOW_MS;

  const [roster, killPlayers, killContribs, priorEncsAll, funRows] = await Promise.all([
    loadRoster(supabase, gid, nowMs),
    supabase.select('encounter_players',
      `encounter_id=eq.${enc(encounterId)}&select=character_name,total_damage&limit=500`),
    supabase.select('contributions',
      `encounter_id=eq.${enc(encounterId)}&select=id,deaths:raw_parse->deaths,dur:raw_parse->duration&limit=200`),
    supabase.selectAllPaged('encounters',
      `guild_id=eq.${enc(gid)}&npc_id=eq.${enc(kill.npc_id)}&ended_at=not.is.null&started_at=lt.${iso(startMs)}`
      + '&select=id,npc_id,started_at,ended_at,duration_sec,classification,data_incomplete', 'started_at.desc,id'),
    supabase.selectAllPaged('fun_events',
      `guild_id=eq.${enc(gid)}&event_type=in.(${Object.keys(FUN).join(',')})`
      + `&event_ts=gte.${iso(from)}&event_ts=lte.${iso(to)}&select=event_type,caster,event_ts`, 'event_ts,id'),
  ]);
  needRows(killPlayers, 'encounter_players');
  needRows(killContribs, 'contributions');
  const priorEncs = needRows(priorEncsAll, 'encounters').slice(0, PRIOR_MAX);
  needRows(funRows, 'fun_events');

  // Players for every prior (chunked: a long id list is a long URL), deaths for the newest usable one only.
  const ids = priorEncs.filter(e => !e.classification && e.data_incomplete !== true).map(e => e.id);
  const priorPlayers = [];
  for (let n = 0; n < ids.length; n += PLAYER_CHUNK) {
    const part = ids.slice(n, n + PLAYER_CHUNK);
    const got = await supabase.selectAllPaged('encounter_players',
      `encounter_id=in.(${part.map(enc).join(',')})&select=encounter_id,character_name,total_damage`, 'encounter_id,character_name');
    priorPlayers.push(...needRows(got, 'encounter_players (priors)'));
  }
  const nameCount = new Map();
  for (const p of priorPlayers) nameCount.set(p.encounter_id, (nameCount.get(p.encounter_id) || 0) + 1);
  const lastUsable = priorEncs.find(e => ids.includes(e.id) && (nameCount.get(e.id) || 0) >= MIN_RAIDERS);
  const priorContribs = lastUsable
    ? needRows(await supabase.select('contributions',
        `encounter_id=eq.${enc(lastUsable.id)}&select=encounter_id,deaths:raw_parse->deaths,dur:raw_parse->duration&limit=200`), 'contributions (prior)')
    : [];

  return { roster, kill, killPlayers, killContribs, priorEncs, priorPlayers, priorContribs, funRows };
}

/** fetch + assemble + build, for one encounter id. null = no recap (not a kill, not ours, too thin). */
async function loadRecap({ supabase, guildId, encounterId, bossName, nowMs }) {
  const rows = await fetchRecapRows({ supabase, guildId, encounterId, nowMs });
  if (!rows) return null;
  const input = assembleInputs(rows, { bossName });
  if (!input) return null;
  const recap = buildRecap(input);
  if (!recap) return null;
  return { ...recap, boss: bossName || null, npcId: input.kill.npcId, killedAtMs: input.kill.startedAtMs + input.kill.durationSec * 1000 };
}

/** The Discord card field: the lines, the stars, then the fun. Capped under the 1,024-char field limit. */
function recapFieldValue(recap) {
  if (!recap) return '';
  const parts = [...recap.lines];
  if (recap.stars.length) parts.push('', ...recap.stars.map(s => `⭐ ${s}`));
  if (recap.fun.length) parts.push('', ...recap.fun);
  let out = parts.join('\n');
  if (out.length > 1024) out = out.slice(0, 1021) + '...';
  return out;
}

function _resetRosterMemo() { _rosterMemo = { at: 0, guild: null, set: null }; }

module.exports = {
  buildRecap, assembleInputs, fetchRecapRows, loadRecap, recapFieldValue, fightDeaths,
  MIN_RAIDERS, SIZE_DIFF_FRAC, DPS_SANE_RATIO, DEATH_CLIP_MS, FUN_WINDOW_MS, RECORD_MIN_PRIORS, PB_MIN_PRIOR_KILLS, PB_MIN_GAIN,
  _resetRosterMemo,
};
