'use strict';
/**
 * Derive character lockouts from a confirmed raid-boss kill.
 *
 * Hitya 2026-08-22, pointing at a Ventani parse Taeya had uploaded from a
 * non-guild raid: "taeya reported this Ventani kill so they should have a
 * lockout."
 *
 * The lockout table shipped a day earlier reading only /sll relays, and /sll
 * is something a human has to type in game. It had never held a row. Meanwhile
 * the encounter pipeline had already captured three foreign raid kills from
 * that same player that week. A confirmed kill parse IS a lockout observation;
 * this module turns one into rows.
 *
 * Two things it deliberately does NOT do:
 *   • guess who was there. Only names the parse actually carries — the
 *     uploader, the damage list, the healer list, the tank list. A cleric who
 *     healed and never swung, on a night nobody in the raid was running Mimic,
 *     is invisible to us and must stay invisible rather than be inferred.
 *   • guess whether it was ours. `ours` stays three-state (see below).
 */

const HOUR_MS = 3600000;

/** Longest lockout we will ever synthesize. A boss timer larger than this is a
 *  data error (a mis-set bosses.json row), and writing a year-long lockout off
 *  one bad number is worse than writing nothing. */
const MAX_TIMER_HOURS = 24 * 21;

/** Names that appear in parse output but are not characters. */
const NOT_A_CHARACTER = new Set([
  'you', 'unknown', 'unknown pet', 'pet', 'none', 'null', 'undefined',
  'total', 'totals', 'raid', 'group', 'yourself',
]);

/**
 * Normalize one parse-supplied name to a character name, or null if it isn't
 * one. Pets ("Gyzak`s pet"), NPC noise (multi-word attackers) and the parser's
 * own placeholder rows all get dropped here.
 */
function normalizeCharacterName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return null;
  // EQ character names are a single capitalized word, 3–15 letters. Anything
  // with a space is an NPC or a pet phrase; anything with punctuation is a
  // possessive pet ("Gyzak`s pet") or garbage.
  if (!/^[A-Za-z]{3,15}$/.test(name)) return null;
  if (NOT_A_CHARACTER.has(name.toLowerCase())) return null;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Collect the character names a single upload can prove were present.
 *
 * @param {object} a
 * @param {string} [a.contributor]  the uploading character — highest confidence
 * @param {Array}  [a.players]      damage rows ({ name } or bare strings)
 * @param {Array}  [a.healers]      healer rows ({ name } or bare strings)
 * @param {Array}  [a.defenders]    tank rows ({ name } or bare strings)
 * @returns {string[]} deduped, normalized, stable-sorted
 */
function participantsFromUpload({ contributor, players, healers, defenders } = {}) {
  const seen = new Map();     // lowercased → canonical
  const add = (v) => {
    const n = normalizeCharacterName(typeof v === 'string' ? v : v && v.name);
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  };
  add(contributor);
  for (const list of [players, healers, defenders]) {
    if (Array.isArray(list)) for (const row of list) add(row);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Share of the named players who are on our roster. This is the signal that
 * separates a guild event from somebody else's raid, and it separates them
 * cleanly — measured over ten days of real encounters, our raids run 0.75–0.89
 * and the pug raids our people joined run 0.14–0.22.
 */
function memberFraction(participants, roster) {
  if (!Array.isArray(participants) || participants.length === 0) return null;
  const have = roster instanceof Set ? roster
             : new Set((roster || []).map(n => String(n).toLowerCase()));
  if (have.size === 0) return null;
  let members = 0;
  for (const p of participants) if (have.has(String(p).toLowerCase())) members++;
  return members / participants.length;
}

/** Majority-of-roster is a guild event. Same line as
 *  REVIEW_FOREIGN_MAX_MEMBER_FRAC in web/lib/anomalies.ts — kept identical on
 *  purpose so the two surfaces can never disagree about the same fight. */
const GUILD_EVENT_MIN_MEMBER_FRAC = 0.5;

/** Below this many named players the fraction is too noisy to accuse anyone
 *  with. A 2-player fight that happens to name one outsider is not evidence. */
const MIN_PLAYERS_TO_JUDGE = 3;

/**
 * Was this kill ours? Three-state, and never guessed — an unknown must not
 * read as an accusation that somebody raided elsewhere.
 *
 *   true  — bound to one of our raid nights, OR most of the named players are
 *           on our roster. The second clause exists because a raid night is
 *           not the only thing we run: Hitya 2026-08-22, on the Friday classic
 *           kills this first shipped as foreign — "Friday was a guild rolling
 *           event, so internal, but still a lockout." An internal event off
 *           the calendar is ours; only the roster share can tell us that.
 *   false — mostly strangers, on enough players to be sure.
 *   null  — we cannot tell: too few players to judge, no roster to judge
 *           against, or an unbound kill inside a raid window (a binding that
 *           didn't take, not evidence of anything).
 */
function classifyOurs({ inRaidNight, inRaidWindow, memberFrac, playerCount } = {}) {
  if (inRaidNight === true) return true;
  if (Number.isFinite(memberFrac)) {
    if (memberFrac >= GUILD_EVENT_MIN_MEMBER_FRAC) return true;
    // A clear minority of ours AND enough bodies to mean it.
    if (Number.isFinite(playerCount) && playerCount >= MIN_PLAYERS_TO_JUDGE) return false;
    return null;
  }
  if (inRaidWindow === true) return null;
  return false;
}

/**
 * Build character_lockouts rows for one confirmed kill.
 *
 * @param {object}   a
 * @param {object}   a.boss          bosses.json row — needs { id, name, timerHours }
 * @param {number}   a.killedAtMs    when the boss died
 * @param {string[]} a.participants  from participantsFromUpload()
 * @param {boolean}  [a.inRaidNight] encounter bound to a raid_nights row
 * @param {boolean}  [a.inRaidWindow] kill time falls in a scheduled raid window
 * @param {Set|Array} [a.roster]     lowercased guild character names, for the
 *                                   guild-event test in classifyOurs
 * @param {string}   [a.guildId]
 * @param {string}   [a.encounterId]
 * @param {string}   [a.observedBy]  the uploading character
 * @param {number}   [a.observedAtMs]
 * @returns {Array} rows ready to upsert on (guild_id,character,boss_key)
 */
function buildKillLockouts({
  boss, killedAtMs, participants,
  inRaidNight, inRaidWindow, roster,
  guildId, encounterId, observedBy, observedAtMs,
} = {}) {
  if (!boss || !boss.id || !boss.name) return [];
  const hours = Number(boss.timerHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_TIMER_HOURS) return [];
  if (!Number.isFinite(killedAtMs) || killedAtMs <= 0) return [];
  if (!Array.isArray(participants) || participants.length === 0) return [];

  const expiresAt = killedAtMs + hours * HOUR_MS;
  // Already lifted by the time we worked it out (a deep backfill of old logs).
  // Recording an expired lockout is noise on every officer surface that reads
  // this table, so drop it here rather than making each reader filter.
  if (expiresAt <= (Number.isFinite(observedAtMs) ? observedAtMs : Date.now())) return [];

  const ours = classifyOurs({
    inRaidNight, inRaidWindow,
    memberFrac: memberFraction(participants, roster),
    playerCount: participants.length,
  });
  const gid  = guildId || 'wolfpack';
  const obs  = new Date(Number.isFinite(observedAtMs) ? observedAtMs : Date.now()).toISOString();

  return participants.map(character => ({
    guild_id:        gid,
    character,
    boss_key:        boss.id,
    boss_name:       boss.name,
    expires_at:      new Date(expiresAt).toISOString(),
    implied_kill_at: new Date(killedAtMs).toISOString(),
    ours,
    observed_at:     obs,
    observed_by:     observedBy ? String(observedBy).slice(0, 64) : null,
    source:          'kill',
    encounter_id:    encounterId || null,
  }));
}

/**
 * Drop kill-derived rows that would clobber a live /sll row for the same
 * (character, boss). /sll carries the server's own remaining time; a
 * kill-derived expiry is computed from the boss timer and is the weaker
 * number. The upsert has no way to express "only if not already better", so
 * the caller filters with this after one read.
 *
 * @param {Array} rows      candidate kill rows
 * @param {Array} existing  current character_lockouts rows for those characters
 * @param {number} [nowMs]
 */
function dropRowsShadowedBySll(rows, existing, nowMs) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const authoritative = new Set();
  for (const e of (Array.isArray(existing) ? existing : [])) {
    if (!e || e.source !== 'sll') continue;
    const exp = Date.parse(e.expires_at);
    if (!Number.isFinite(exp) || exp <= now) continue;   // stale — no longer protects
    authoritative.add(`${String(e.character).toLowerCase()}|${e.boss_key}`);
  }
  if (authoritative.size === 0) return rows;
  return rows.filter(r => !authoritative.has(`${r.character.toLowerCase()}|${r.boss_key}`));
}

module.exports = {
  normalizeCharacterName,
  participantsFromUpload,
  memberFraction,
  classifyOurs,
  GUILD_EVENT_MIN_MEMBER_FRAC,
  MIN_PLAYERS_TO_JUDGE,
  buildKillLockouts,
  dropRowsShadowedBySll,
  MAX_TIMER_HOURS,
};
