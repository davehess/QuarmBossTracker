'use strict';
// wowlogsync core -- pure functions, no I/O. index.js tails the file and posts; everything that decides what
// leaves the machine lives here so a test can pin it.
//
// SOURCES this parser is built on (and nothing else):
//   https://warcraft.wiki.gg/wiki/COMBAT_LOG_EVENT   field order, prefixes/suffixes, advanced parameters
//   https://warcraft.wiki.gg/Combat_Log              file is Logs\WoWCombatLog.txt after /combatlog
// Line shape: `M/D HH:MM:SS.mmm  SUBEVENT,field,field,...` -- the wiki's header example is
//   `11/21 12:01:34.071  COMBAT_LOG_VERSION,19,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,9.1.5,PROJECT_ID,1`
//
// TOLERANCE. Classic's exact columns are not confirmed from the wiki, so no field is located by an absolute
// column. Every event is: subevent, 8 base fields (sourceGUID, sourceName, sourceFlags, sourceRaidFlags, destGUID,
// destName, destFlags, destRaidFlags), a prefix of 0 (SWING_) or 3 (RANGE_/SPELL_) fields, an OPTIONAL block of 17
// advanced fields, then the suffix, whose FIRST field is the amount. Whether the advanced block is present is read
// per line (its first field is a GUID, an amount is a number), so a log with advanced logging off, on, or toggled
// mid-file all parse. Fields after the amount are only used for overkill / overhealing (the next field) and are
// ignored when absent, so a suffix with a different tail (baseAmount, isOffHand) does not matter.
//
// ALLOW-LIST. A line whose subevent is not in ALLOWED is dropped from the first comma on: it is never split into
// fields, never held, never counted, and cannot reach a payload. That is the privacy boundary.

const ALLOWED = new Set([
  'ENCOUNTER_START', 'ENCOUNTER_END',
  'SWING_DAMAGE', 'RANGE_DAMAGE', 'SPELL_DAMAGE', 'SPELL_PERIODIC_DAMAGE',
  'SPELL_HEAL', 'SPELL_PERIODIC_HEAL',
  'UNIT_DIED',
]);
const PREFIX_LEN = { SWING: 0, RANGE: 3, SPELL: 3, SPELL_PERIODIC: 3 };
const ADV_LEN = 17;
const ZERO_GUID = '0000000000000000';
const NAME_RE = /^[\p{L}'-]{1,24}$/u;
const LINE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:[+-]\d{1,2})?\s+(.*)$/;
const GUID_RE = /^(?:Player|Pet|Creature|Vehicle|GameObject|Item|Vignette)-/;

// Comma split that keeps commas inside "quoted names" together and strips the quotes.
function splitCsv(s) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Log timestamps carry no year (and, as far as the wiki shows, no zone): read as this machine's local time and put
// in the most recent year that is not in the future.
function parseStamp(m, nowMs) {
  const now = new Date(nowMs);
  let year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
  const mk = y => new Date(y, Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]),
    m[7] ? Number(m[7].padEnd(3, '0')) : 0).getTime();
  let t = mk(year);
  if (!m[3] && t > nowMs + 86400e3) t = mk(year - 1);
  return Number.isFinite(t) ? t : null;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// -> null (not allowed / malformed) or one of
//   { type:'encStart', tsMs, id, name }
//   { type:'encEnd',   tsMs, id, name, success }
//   { type:'damage',   tsMs, srcGuid, srcName, dstGuid, dstName, amount, overkill, infoGuid, ownerGuid }
//   { type:'heal',     tsMs, srcGuid, srcName, dstGuid, dstName, amount, overheal, infoGuid, ownerGuid }
//   { type:'died',     tsMs, dstGuid, dstName, unconscious }
function parseLine(line, nowMs = Date.now()) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const rest = m[8];
  const comma = rest.indexOf(',');
  const sub = comma < 0 ? rest : rest.slice(0, comma);
  if (!ALLOWED.has(sub)) return null;                       // the allow-list: nothing past here for other events
  const tsMs = parseStamp(m, nowMs);
  if (tsMs == null) return null;
  const f = splitCsv(rest);

  if (sub === 'ENCOUNTER_START' || sub === 'ENCOUNTER_END') {
    // Assumed (the wiki documents these as event payloads, not as log columns): id, name, difficultyID, groupSize,
    // and for END a trailing success flag.
    const id = num(f[1]);
    if (id == null || id < 0) return null;
    if (sub === 'ENCOUNTER_START') return { type: 'encStart', tsMs, id: Math.trunc(id), name: String(f[2] || '').trim() };
    return { type: 'encEnd', tsMs, id: Math.trunc(id), name: String(f[2] || '').trim(), success: f[5] === '1' };
  }

  if (f.length < 9) return null;
  if (sub === 'UNIT_DIED') {
    // recapID at 9, unconsciousOnDeath at 10 (positions 12 and 13 on the wiki's numbering): '1' is a feign death.
    return { type: 'died', tsMs, dstGuid: f[5], dstName: f[6], unconscious: f[10] === '1' };
  }

  const prefix = sub.slice(0, sub.lastIndexOf('_'));
  const isHeal = sub.endsWith('_HEAL');
  const plen = PREFIX_LEN[prefix];
  if (plen === undefined) return null;
  let at = 9 + plen;
  let infoGuid = null, ownerGuid = null;
  if (GUID_RE.test(f[at] || '') || f[at] === ZERO_GUID) {   // advanced block present
    infoGuid = f[at];
    ownerGuid = f[at + 1] && f[at + 1] !== ZERO_GUID ? f[at + 1] : null;
    at += ADV_LEN;
  }
  const amount = num(f[at]);
  if (amount == null) return null;
  const extra = num(f[at + 1]);
  const ev = { type: isHeal ? 'heal' : 'damage', tsMs, srcGuid: f[1], srcName: f[2], dstGuid: f[5], dstName: f[6],
    amount, infoGuid, ownerGuid };
  if (isHeal) ev.overheal = extra != null && extra > 0 ? extra : 0;
  else ev.overkill = extra != null && extra > 0 ? extra : 0;       // -1 means none
  return ev;
}

// ── GUIDs and names ─────────────────────────────────────────────────────────
const guidKind = g => String(g || '').split('-')[0];
// Creature-0-<server>-<instance>-<zone>-<npcId>-<spawn> (the wiki's examples; the layout itself is assumed).
function npcIdOf(g) {
  const p = String(g || '').split('-');
  return (p[0] === 'Creature' || p[0] === 'Vehicle') && /^\d{1,9}$/.test(p[5] || '') ? p[5] : null;
}
// "Name-Realm" -> "Name". The realm is not uploaded; a letters-only name is the only thing that is.
function playerName(raw) {
  const s = String(raw || '');
  const n = s.indexOf('-') > 0 ? s.slice(0, s.indexOf('-')) : s;
  return NAME_RE.test(n) ? n : null;
}

// ── Fight tracking ──────────────────────────────────────────────────────────
class FightTracker {
  // onFight(summary) is called once per finished fight that clears the floors.
  constructor({ onFight, gapMs = 20000, fallback = true, includeWipes = false, minFallbackSec = 30, minFallbackPlayers = 2 } = {}) {
    this.onFight = onFight || (() => {});
    this.gapMs = gapMs;
    this.fallback = fallback;
    this.includeWipes = includeWipes;
    this.minFallbackSec = minFallbackSec;
    this.minFallbackPlayers = minFallbackPlayers;
    this.owners = new Map();     // pet guid -> owner guid, learned from the advanced block
    this.enc = null;             // open ENCOUNTER_START fight
    this.gap = null;             // open combat-gap fight
    this.lastWall = 0;
  }

  _link(ev) {
    if (ev.ownerGuid && ev.infoGuid && ev.infoGuid !== ev.ownerGuid) {
      if (this.owners.size > 5000) this.owners.clear();
      this.owners.set(ev.infoGuid, ev.ownerGuid);
    }
  }

  // guid -> { guid, name } of the Player it belongs to (itself, or via up to three owner links); isPet says which.
  _owner(guid, name) {
    let g = guid, hops = 0;
    while (guidKind(g) !== 'Player' && this.owners.has(g) && hops++ < 3) g = this.owners.get(g);
    if (guidKind(g) !== 'Player') return null;
    return { guid: g, isPet: g !== guid, name: g === guid ? playerName(name) : null };
  }

  _friendly(guid) { return guidKind(guid) === 'Player' || guidKind(guid) === 'Pet' || this.owners.has(guid); }

  _newFight(extra) {
    return Object.assign({ players: new Map(), names: new Map(), targets: new Map(), killed: new Set(), deaths: [],
      unlinkedPetDamage: 0, lastMs: 0 }, extra);
  }

  _player(f, o) {
    let name = o.name || f.names.get(o.guid);
    if (!name) return null;
    f.names.set(o.guid, name);
    let p = f.players.get(name);
    if (!p) f.players.set(name, p = { direct: 0, pet: 0, healed: 0, overheal: 0 });
    return p;
  }

  feed(ev, wallMs = Date.now()) {
    this.lastWall = wallMs;
    if (ev.type === 'encStart') {
      this._closeGap();
      this.enc = this._newFight({ kind: 'encounter', key: `wow:encounter:${ev.id}`, name: ev.name, startMs: ev.tsMs, lastMs: ev.tsMs });
      return;
    }
    if (ev.type === 'encEnd') {
      const f = this.enc;
      this.enc = null;
      if (f && f.key === `wow:encounter:${ev.id}`) this._finish(f, ev.tsMs, ev.success);
      return;
    }
    this._link(ev);
    let f = this.enc;
    if (!f && this.fallback) {
      if (this.gap && ev.tsMs - this.gap.lastMs > this.gapMs) this._closeGap();
      f = this.gap;
      if (!f && ev.type === 'damage' && this._ours(ev) && !this._friendly(ev.dstGuid)) {
        f = this.gap = this._newFight({ kind: 'gap', startMs: ev.tsMs, lastMs: ev.tsMs });
      }
    }
    if (!f) return;
    if (ev.type === 'damage') this._damage(f, ev);
    else if (ev.type === 'heal') this._heal(f, ev);
    else if (ev.type === 'died') this._died(f, ev);
  }

  _ours(ev) { return !!this._owner(ev.srcGuid, ev.srcName) || guidKind(ev.srcGuid) === 'Pet'; }

  _damage(f, ev) {
    if (this._friendly(ev.dstGuid)) return;                 // duels, mind control, friendly fire are not boss damage
    const amt = Math.max(0, ev.amount - ev.overkill);
    const o = this._owner(ev.srcGuid, ev.srcName);
    if (!o) {
      if (guidKind(ev.srcGuid) === 'Pet') f.unlinkedPetDamage += amt;   // a pet the log never linked to an owner
      return;
    }
    const p = this._player(f, o);
    if (!p) return;
    if (o.isPet) p.pet += amt; else p.direct += amt;
    const t = f.targets.get(ev.dstGuid) || { name: ev.dstName, damage: 0 };
    t.damage += amt;
    f.targets.set(ev.dstGuid, t);
    f.lastMs = ev.tsMs;
  }

  _heal(f, ev) {
    const o = this._owner(ev.srcGuid, ev.srcName);
    const p = o && this._player(f, o);
    if (!p) return;
    p.healed += Math.max(0, ev.amount - ev.overheal);
    p.overheal += ev.overheal;
    f.lastMs = ev.tsMs;
  }

  _died(f, ev) {
    if (guidKind(ev.dstGuid) === 'Player') {
      const name = playerName(ev.dstName);
      if (name && !ev.unconscious && f.deaths.length < 200) f.deaths.push({ name, tsMs: ev.tsMs });
    } else if (ev.dstGuid && ev.dstGuid !== ZERO_GUID) f.killed.add(ev.dstGuid);
    f.lastMs = ev.tsMs;
  }

  // Wall-clock idle check for the live tail: a quiet log still ends a fight.
  idle(wallMs = Date.now()) {
    if (this.gap && wallMs - this.lastWall > this.gapMs) this._closeGap();
  }

  flush() { this._closeGap(); }

  _closeGap() {
    const f = this.gap;
    this.gap = null;
    if (f) this._finish(f, f.lastMs, null);
  }

  _finish(f, endMs, success) {
    const players = [...f.players.entries()]
      .map(([name, p]) => ({ name, directDamage: Math.round(p.direct), petDamage: Math.round(p.pet),
        damage: Math.round(p.direct + p.pet), healed: Math.round(p.healed), overheal: Math.round(p.overheal) }))
      .filter(p => p.damage > 0 || p.healed > 0);
    if (!players.length) return;
    const activeSec = Math.max(1, Math.round((endMs - f.startMs) / 1000));
    let key = f.key, name = f.name, confirmed = success === true;

    if (f.kind === 'encounter') {
      if (!confirmed && !this.includeWipes) return;          // a wipe would merge into the kill's encounter row
    } else {
      // Combat-gap fallback (no ENCOUNTER events, e.g. a world boss): the most-damaged target names the fight, and it
      // only counts when that target died. Floors keep a lone mob out; they are heuristics, not a catalog.
      let top = null;
      for (const [guid, t] of f.targets) if (!top || t.damage > top.t.damage) top = { guid, t };
      const npc = top && npcIdOf(top.guid);
      if (!npc || !f.killed.has(top.guid)) return;
      if (activeSec < this.minFallbackSec) return;
      if (players.filter(p => p.damage > 0).length < this.minFallbackPlayers) return;
      key = `wow:npc:${npc}`; name = top.t.name; confirmed = true;
    }
    if (!name) return;
    this.onFight({
      kind: f.kind, key, name, confirmed, startMs: f.startMs, endMs, activeSec, players,
      deaths: f.deaths.filter(d => d.tsMs >= f.startMs - 1000 && d.tsMs <= endMs + 1000),
      unlinkedPetDamage: Math.round(f.unlinkedPetDamage),
    });
  }
}

// Everything in a payload is built here, from a finished fight summary. Field by field: nothing is spread in.
function buildPayload(s, { character, version }) {
  return {
    game: 'wow',
    agent_version: version,
    character,
    backfill: false,
    encounter: {
      started_at: new Date(s.startMs).toISOString(),
      ended_at: new Date(s.endMs).toISOString(),
      boss_name: String(s.name).slice(0, 80),
      boss_key: s.key,
      events: [],
      confirmed_kill: s.confirmed === true,
      active_duration_s: s.activeSec,
      players: s.players.map(p => ({ name: p.name, damage: p.damage, directDamage: p.directDamage,
        petDamage: p.petDamage, healed: p.healed })),
      deaths: s.deaths.map(d => ({ name: d.name, ts: new Date(d.tsMs).toISOString() })),
    },
  };
}

module.exports = { ALLOWED, parseLine, splitCsv, FightTracker, buildPayload, npcIdOf, playerName };
