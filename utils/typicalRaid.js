// utils/typicalRaid.js — "what does a normal raid night of ours look like?", for the
// pre-raid checklist (commands/preraid.js).
//
// The guild lead, 2026-10-21: "these numbers are so skewed" — the checklist said
// "thin roster (52 vs ~82) · 11 class shortages" on a night with a healthy signup.
//
// WHY NOT raid_roster: it is a LIVE view (the log-ingestion cut keeps about half a day of it,
// utils/liveMemory.js), so a "typical" read from it was just whatever was logged in earlier the same
// day — a morning raid with another group, every alt swap — and it counted CHARACTERS against
// signups, which are PLAYERS.
//
// SOURCE: the OpenDKP ticks (opendkp_raids + opendkp_ticks). They are the officers' own record of who
// raided, kept after the roster is gone, and they leave out the tiny alt-raid nights on their own.
//   - raid nights only (Sun/Wed/Thu, utils/raidNight.js RAID_DAY_NAMES), never tonight's;
//   - one PLAYER counted once per night (a character's family: main_name, else itself), as the class of
//     the character that sat on the most of that night's ticks;
//   - a night under MIN_NIGHT_PLAYERS is a side event, not a raid night;
//   - fewer than MIN_NIGHTS usable nights => "not enough history", never a number.
//
// Pure: no Discord, no Supabase, no clock of its own. Tested in test/typical-raid.test.js.

const { dateKeyForMs, nightKey, RAID_DAY_NAMES } = require('./raidNight');
const { getDefaultTz } = require('./timezone');

const NIGHTS_BACK       = 6;    // how many raid nights "our average" covers
const MIN_NIGHTS        = 2;    // below this there is no honest average
const MIN_NIGHT_PLAYERS = 30;   // a "night" smaller than this is an alt raid or a stub, not a raid night

const CLASSES = [
  'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician', 'Monk', 'Necromancer',
  'Paladin', 'Ranger', 'Rogue', 'Shadow Knight', 'Shaman', 'Warrior', 'Wizard',
];
const CLASS_BY_KEY = new Map(CLASSES.map(c => [c.toLowerCase().replace(/[^a-z]/g, ''), c]));

/** "Shadowknight" (signups) and "Shadow Knight" (characters, roster) are one class. null = not a class
 *  (Unknown, Late, Tentative, Bench ...). */
function canonClass(raw) {
  return CLASS_BY_KEY.get(String(raw || '').toLowerCase().replace(/[^a-z]/g, '')) || null;
}

/**
 * The raid nights the OpenDKP raids fall on, newest first.
 * @param {Array<{raid_id:number, ts:string}>} raids
 * @returns {Array<{key:string, ms:number, raidIds:number[]}>}
 */
function candidateRaidNights(raids, nowMs) {
  const tz = getDefaultTz();
  const tonight = nightKey(nowMs);
  const byKey = new Map();
  for (const r of raids || []) {
    const ms = Date.parse(r && r.ts);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const key = dateKeyForMs(ms);
    if (key === tonight) continue;
    const day = new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }).toLowerCase();
    if (!RAID_DAY_NAMES.has(day)) continue;
    const n = byKey.get(key) || { key, ms: 0, raidIds: [] };
    n.ms = Math.max(n.ms, ms);
    n.raidIds.push(r.raid_id);
    byKey.set(key, n);
  }
  return [...byKey.values()].sort((a, b) => b.ms - a.ms);
}

/**
 * @param {object} a
 * @param {Array} a.nights       candidateRaidNights() output
 * @param {Array<{raid_id,tick_id,attendees:string[]}>} a.ticks
 * @param {Array<{name,main_name,class}>} a.characters
 * @returns {{nightCount:number, enough:boolean, nights:Array, avgByClass:Map<string,number>, typicalHeadcount:number}}
 */
function typicalRaidNights({ nights = [], ticks = [], characters = [], count = NIGHTS_BACK, minPlayers = MIN_NIGHT_PLAYERS } = {}) {
  const info = new Map();
  for (const c of characters) {
    if (!c || !c.name) continue;
    const name = String(c.name).toLowerCase();
    info.set(name, { family: String(c.main_name || c.name).toLowerCase(), cls: canonClass(c.class) });
  }
  const ticksByRaid = new Map();
  for (const t of ticks) {
    if (!ticksByRaid.has(t.raid_id)) ticksByRaid.set(t.raid_id, []);
    ticksByRaid.get(t.raid_id).push(t);
  }

  const used = [];
  for (const night of nights) {
    if (used.length >= count) break;
    // character -> the distinct ticks of this night it was credited on
    const seen = new Map();
    for (const rid of night.raidIds) {
      for (const t of ticksByRaid.get(rid) || []) {
        for (const a of Array.isArray(t.attendees) ? t.attendees : []) {
          const nm = String(a || '').trim().toLowerCase();
          if (!nm) continue;
          if (!seen.has(nm)) seen.set(nm, new Set());
          seen.get(nm).add(`${rid}:${t.tick_id}`);
        }
      }
    }
    // player -> the character that sat on the most ticks (ties: first by name, so it is stable)
    const best = new Map();
    for (const [nm, set] of seen) {
      const i = info.get(nm);
      const family = i ? i.family : nm;
      const cur = best.get(family);
      if (!cur || set.size > cur.n || (set.size === cur.n && nm < cur.nm)) best.set(family, { nm, n: set.size, cls: i ? i.cls : null });
    }
    if (best.size < minPlayers) continue;
    const byClass = new Map();
    for (const { cls } of best.values()) if (cls) byClass.set(cls, (byClass.get(cls) || 0) + 1);
    used.push({ key: night.key, players: best.size, byClass });
  }

  const enough = used.length >= MIN_NIGHTS;
  const avgByClass = new Map();
  let typicalHeadcount = 0;
  if (enough) {
    const totals = new Map();
    for (const n of used) for (const [c, k] of n.byClass) totals.set(c, (totals.get(c) || 0) + k);
    for (const [c, k] of totals) avgByClass.set(c, k / used.length);
    typicalHeadcount = used.reduce((s, n) => s + n.players, 0) / used.length;
  }
  return { nightCount: used.length, enough, nights: used, avgByClass, typicalHeadcount };
}

module.exports = { typicalRaidNights, candidateRaidNights, canonClass, NIGHTS_BACK, MIN_NIGHTS, MIN_NIGHT_PLAYERS };
