'use strict';
/**
 * Which instance did this kill happen in — ours, or somebody else's?
 *
 * The guild lead 2026-10-05: "Lord of Ire PVP kills are still being triggered as regular guild instance
 * kills. We need to know if our players are in live or in instance when they kill mobs in bastion of
 * thunder or any other planes of power locations… If anyone from outside of our guild is in the zone
 * there's a good chance they are in live and we do not count those timers."
 *
 * Zone ids cannot tell the instances apart: Plane of Hate is zone 76 for the open world, our guild
 * instance and the PvP instance, and the Planes of Power guild instances share the open-world id. So the
 * only evidence is circumstantial, and this module reads it in a fixed order (first hit wins):
 *
 *   1. pvp     a PvP "(Instanced)" boss-kill broadcast for that boss lands within ±2 min of the kill
 *   2. pvp     a fighter had their PvP flag ON at the kill, and the boss is in a PvP-capable zone
 *   3. live    3+ distinct fighters and fewer than half are on our roster
 *   4. live    a /who taken by one of the fighters within ±10 min shows a player in another guild in
 *              the zone. Only a fighter's own /who: a guildmate standing in live Bastion of Thunder sees
 *              a dozen guilds there while our group is in the guild instance (measured 2026-10-05: an
 *              any-uploader rule would have marked 6 of the day's 20 Bastion named kills live, most of
 *              them all-guild groups).
 *   5. unknown 1–2 fighters and none of the above (cannot judge a duo)
 *   6. ours    everything else
 *
 * Only `ours` starts a board timer. Every parse is still stored — a non-ours verdict also stamps
 * encounters.classification, which already keeps the fight out of guild kill counts and /parses.
 *
 * Membership is the lockout code's notion, reused rather than re-invented: the `characters` roster,
 * memberFraction(), and the same 0.5 / 3-player lines classifyOurs() draws (utils/killLockouts.js).
 *
 * classifyKillContext() is pure — everything it needs arrives in `signals`. gatherKillSignals() is the
 * one place that reads Supabase, and it THROWS on any failed read so the caller can fall back to
 * today's behaviour (record the timer) instead of acting on half a picture.
 */

const kl = require('./killLockouts');

/** A PvP boss-kill broadcast this close to the fight's end belongs to it. The broadcast is stamped with
 *  the log line's own time, but the relay can land up to ~2 min after the upload, so the bot waits
 *  PVP_DEFER_MS before judging a PvP-capable zone. */
const PVP_BROADCAST_WINDOW_MS = 2 * 60_000;
/** A /who sighting this close to the kill counts as "in the zone at the time". */
const WHO_WINDOW_MS = 10 * 60_000;
/** How far back a /togglepvp line still says what a character's flag is. */
const FLAG_LOOKBACK_MS = 30 * 86_400_000;
/** How long a kill in a PvP-capable zone waits before it is judged (the broadcast can trail the upload). */
const PVP_DEFER_MS = 150_000;

/** Zones where a character can be PvP-flagged. Keyed as zoneKey() writes them: the long names as
 *  bosses.json spells them ("The Hole" → "hole") plus the short names the encounters table carries. */
const PVP_CAPABLE_ZONES = new Set([
  'plane of hate', 'plane of fear', 'plane of sky', 'hole',
  'hateplane', 'fearplane', 'airplane',
]);

/**
 * One comparable spelling for the zone names that reach us: bosses.json says "Plane of Hate", /who says
 * "the plane of hate", "Plane of Hate (Instanced)" or the short "hateplane", and a PoP zone's /who name
 * is "torden, the bastion of thunder". Lower-cased, parenthetical tag and punctuation dropped, a leading
 * "the" dropped.
 */
function zoneKey(z) {
  if (typeof z !== 'string') return '';
  return z.toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Same zone under any of those spellings. The suffix rule exists for "torden the bastion of thunder" vs
 *  "bastion of thunder"; it needs a multi-word shorter side so a one-word name can only match exactly. */
function sameZone(a, b) {
  const x = zoneKey(a), y = zoneKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.includes(' ') && long.endsWith(' ' + short);
}

function isPvpCapableZone(z) {
  return PVP_CAPABLE_ZONES.has(zoneKey(z));
}

const arr = (v) => (Array.isArray(v) ? v : []);
const lower = (s) => String(s || '').trim().toLowerCase();

/** A real guild tag: not blank, not the "<>" / "<null>" the server prints for an unguilded player. */
function realGuild(g) {
  const s = typeof g === 'string' ? g.trim() : '';
  return !!s && s !== '<>' && !/^<?null>?$/i.test(s);
}

/** Characters whose LATEST /togglepvp line at or before `atMs` says the flag is on. */
function flaggedAt(flagEvents, participants, atMs) {
  const mine = new Set(arr(participants).map(lower));
  const latest = new Map();              // lowercased character → { at, on }
  for (const e of arr(flagEvents)) {
    const who = lower(e && e.character);
    if (!who || !mine.has(who)) continue;
    if (!Number.isFinite(e.atMs) || e.atMs > atMs || e.atMs < atMs - FLAG_LOOKBACK_MS) continue;
    const cur = latest.get(who);
    if (!cur || e.atMs > cur.at) latest.set(who, { at: e.atMs, on: e.on === true });
  }
  return [...latest.entries()].filter(([, v]) => v.on).map(([name]) => name);
}

/**
 * @param {object}   s
 * @param {number}   s.killedAtMs
 * @param {string[]} s.zoneNames       every name the kill's zone goes by (bosses.json zone, encounter zone_short)
 * @param {string[]} s.participants    distinct character names the parse proves were there
 * @param {Set|Array} [s.roster]       lowercased roster names; absent/empty = cannot judge membership
 * @param {string}   [s.ourGuild]      our in-game guild tag; absent = the /who rule is skipped
 * @param {Array}    [s.pvpBroadcasts] [{ atMs, instanced }] boss-kill broadcasts for this boss
 * @param {Array}    [s.flagEvents]    [{ character, on, atMs }] /togglepvp lines
 * @param {Array}    [s.whoSightings]  [{ character, guild, zone, atMs, observer }] — observer = the
 *                                     character whose /who it was (who_observations.uploaded_by)
 * @returns {{ verdict: 'ours'|'pvp'|'live'|'unknown', reason: string }}
 */
function classifyKillContext(s = {}) {
  const killedAtMs = Number(s.killedAtMs);
  const hasTime = Number.isFinite(killedAtMs);
  const zoneNames = arr(s.zoneNames).filter(Boolean);
  const participants = [...new Map(arr(s.participants).filter(Boolean).map(p => [lower(p), p])).values()];

  // 1 — the server itself said a PvP-instance kill of this boss happened right then.
  if (hasTime) {
    for (const b of arr(s.pvpBroadcasts)) {
      if (!b || b.instanced !== true || !Number.isFinite(b.atMs)) continue;
      const gap = Math.abs(b.atMs - killedAtMs);
      if (gap <= PVP_BROADCAST_WINDOW_MS) {
        return { verdict: 'pvp', reason: `a PvP "(Instanced)" kill broadcast for this boss landed ${Math.round(gap / 1000)}s from the kill` };
      }
    }
  }

  // 2 — someone in the fight was flagged, in a zone where flagging means anything.
  if (hasTime && zoneNames.some(isPvpCapableZone)) {
    const on = flaggedAt(s.flagEvents, participants, killedAtMs);
    if (on.length > 0) {
      return { verdict: 'pvp', reason: `${on.length} of ${participants.length} fighters had their PvP flag on in a PvP-capable zone` };
    }
  }

  // 3 — mostly strangers, on enough bodies to mean it (the same lines classifyOurs draws).
  const frac = kl.memberFraction(participants, s.roster);
  if (participants.length >= kl.MIN_PLAYERS_TO_JUDGE && frac !== null && frac < kl.GUILD_EVENT_MIN_MEMBER_FRAC) {
    return { verdict: 'live', reason: `${participants.length} fighters, only ${Math.round(frac * 100)}% on our roster` };
  }

  // 4 — one of the fighters saw somebody in another guild standing in the zone while we fought.
  const ours = lower(s.ourGuild);
  if (hasTime && ours) {
    const fighters = new Set(participants.map(lower));
    for (const w of arr(s.whoSightings)) {
      if (!w || !realGuild(w.guild) || lower(w.guild) === ours) continue;
      if (!fighters.has(lower(w.observer))) continue;
      if (!Number.isFinite(w.atMs) || Math.abs(w.atMs - killedAtMs) > WHO_WINDOW_MS) continue;
      if (!zoneNames.some(z => sameZone(w.zone, z))) continue;
      return { verdict: 'live', reason: `a /who sighting put a <${String(w.guild).trim()}> player in the zone within ${WHO_WINDOW_MS / 60_000} min of the kill` };
    }
  }

  // 5 — a duo, and nothing above settled it.
  if (participants.length < kl.MIN_PLAYERS_TO_JUDGE) {
    return { verdict: 'unknown', reason: `${participants.length} fighter(s) — too few to judge, and no PvP or outsider signal` };
  }

  return { verdict: 'ours', reason: `${participants.length} fighters, no PvP or outsider signal` };
}

/** The encounters PATCH for a verdict that is not ours — null when the verdict leaves the row alone.
 *  `ours` and `unknown` stay null-classified: the first is the default, the second is "we could not tell". */
function classificationPatch(result, nowMs = Date.now()) {
  if (!result || (result.verdict !== 'pvp' && result.verdict !== 'live')) return null;
  return {
    classification:        result.verdict,
    classification_reason: String(result.reason || '').slice(0, 300),
    classification_at:     new Date(nowMs).toISOString(),
    classification_by:     'auto',
  };
}

/**
 * Read every signal classifyKillContext() needs. Throws if ANY read fails (utils/supabase.js answers null
 * on an error, which is not the same as "no rows"), so the caller can fall back rather than judge half a
 * picture. Every read names its own bound — see test/db-read-discipline.test.js.
 *
 * @param {object}   a
 * @param {object}   a.supabase      utils/supabase
 * @param {string}   [a.guildId]
 * @param {string}   [a.ourGuild]
 * @param {object}   a.boss          bosses.json row — { id, zone }
 * @param {string}   [a.encounterId] the stored encounter, when there is one
 * @param {number}   a.killedAtMs
 * @param {string[]} a.participants
 * @returns {Promise<{ signals: object, existingClassification: string|null }>}
 */
async function gatherKillSignals({ supabase, guildId, ourGuild, boss, encounterId, killedAtMs, participants }) {
  const enc = encodeURIComponent;
  const gid = guildId || 'wolfpack';
  const iso = (ms) => enc(new Date(ms).toISOString());
  const need = (rows, what) => {
    if (!Array.isArray(rows)) throw new Error(`${what} read failed`);
    return rows;
  };
  const names = arr(participants);

  // The encounter row names the zone the way /who's short form does ("hateplane"), and carries any
  // classification an officer (or an earlier upload of this same kill) already put on it.
  let zoneShort = null;
  let existingClassification = null;
  if (encounterId) {
    const rows = need(await supabase.select('encounters',
      `id=eq.${enc(encounterId)}&select=zone_short,classification&limit=1`), 'encounters');
    if (rows[0]) {
      zoneShort = rows[0].zone_short || null;
      existingClassification = rows[0].classification || null;
    }
  }
  const zoneNames = [boss && boss.zone, zoneShort].filter(Boolean);

  // /who zone filter, server side: a name's own spelling anywhere in the column. sameZone() re-checks.
  const zoneOr = zoneNames.map(zoneKey).filter(Boolean).map(k => `zone.ilike."*${k}*"`);

  const wantFlags = zoneNames.some(isPvpCapableZone) && names.length > 0;

  const [broadcastRows, flagRows, whoRows, rosterRows] = await Promise.all([
    boss && boss.id
      ? supabase.select('pvp_boss_kills',
          `guild_id=eq.${enc(gid)}&boss_id=eq.${enc(boss.id)}`
          + `&killed_at=gte.${iso(killedAtMs - PVP_BROADCAST_WINDOW_MS)}&killed_at=lte.${iso(killedAtMs + PVP_BROADCAST_WINDOW_MS)}`
          + '&select=killed_at,raw_text&limit=50')
      : [],
    wantFlags
      ? supabase.select('fun_events',
          `guild_id=eq.${enc(gid)}&event_type=in.(pvp_flag_on,pvp_flag_off)&caster=in.(${names.map(enc).join(',')})`
          + `&event_ts=gte.${iso(killedAtMs - FLAG_LOOKBACK_MS)}&event_ts=lte.${iso(killedAtMs)}`
          + '&select=caster,event_type,event_ts&order=event_ts.desc&limit=1000')
      : [],
    zoneOr.length && ourGuild
      ? supabase.select('who_observations',
          `guild_id=eq.${enc(gid)}`
          + `&observed_at=gte.${iso(killedAtMs - WHO_WINDOW_MS)}&observed_at=lte.${iso(killedAtMs + WHO_WINDOW_MS)}`
          + `&guild_name=not.is.null&guild_name=not.ilike.${enc(ourGuild)}`
          + `&or=(${zoneOr.map(enc).join(',')})`
          + '&select=character,guild_name,zone,observed_at,uploaded_by&limit=500')
      : [],
    supabase.selectAllPaged('characters', `guild_id=eq.${enc(gid)}&select=name`, 'name'),
  ]);

  const signals = {
    killedAtMs,
    zoneNames,
    participants: names,
    ourGuild,
    roster: new Set(need(rosterRows, 'characters').map(r => lower(r && r.name)).filter(Boolean)),
    pvpBroadcasts: need(broadcastRows, 'pvp_boss_kills').map(r => ({
      atMs: Date.parse(r.killed_at),
      instanced: /\(Instanced\)/i.test(r.raw_text || ''),
    })),
    flagEvents: need(flagRows, 'fun_events').map(r => ({
      character: r.caster, on: r.event_type === 'pvp_flag_on', atMs: Date.parse(r.event_ts),
    })),
    // The PvP relay writes who rows for every broadcast's killer and victim: those are a broadcast's
    // words, not somebody seen in the zone, and rule 1 already reads the broadcasts themselves.
    whoSightings: need(whoRows, 'who_observations')
      .filter(r => r && r.uploaded_by !== 'pvp-relay')
      .map(r => ({ character: r.character, guild: r.guild_name, zone: r.zone, atMs: Date.parse(r.observed_at), observer: r.uploaded_by })),
  };
  return { signals, existingClassification };
}

module.exports = {
  classifyKillContext,
  classificationPatch,
  gatherKillSignals,
  zoneKey,
  sameZone,
  isPvpCapableZone,
  PVP_BROADCAST_WINDOW_MS,
  WHO_WINDOW_MS,
  FLAG_LOOKBACK_MS,
  PVP_DEFER_MS,
};
