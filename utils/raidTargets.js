// utils/raidTargets.js — what the raid has targeted, and where, for the Mimic Map (the guild lead, 2026-10-14).
//
// Two picks, one source:
//   B — "also important for MA": the Map's focus ring (the MA's target, else the most-targeted mob) can only be
//       placed where the agent already knows the mob. Each Mimic's current target now rides its ordinary
//       live-state upload (target_id / target_name / target_type / target_map / target_zone); the bot keeps the
//       latest per character IN MEMORY and serves, per zone, each targeted NPC's latest position and how many
//       raiders are on it. Ephemeral on purpose, the same class as live_state: nothing here is a table, and it
//       sheds with `flag_shed_live_state` because it IS that stream.
//   A — "for these types of babysitting escort quests": the same samples feed a shared trail for the escort NPCs
//       in ESCORT_NPCS, with the rules of the agent's local _mapNotePath (a point every 12+ units, a break after a
//       20 s gap or a 400-unit jump, 800 kept, dropped after 12 h). It is stored in bot_kv (state.json does not
//       survive a Railway deploy), one row per guild + zone + NPC name, written in batches: at most once per
//       SAVE_EVERY_MS per trail.
//
// SCOPE. A sample is shown to a requester by the same rule Extended Target uses (utils/groupScope.js):
//   raid  — samples from raiders in the requester's raid. With two raids live (`multi`) the other raid's raiders
//           are dropped; a raider in no raid stays (fail open, as Extended Target does). One raid: everyone in zone.
//   group — only the requester's own group.
//   zone / legacy (no raid, no group known, the kill switch, a failed roster read) — the requester's own
//           characters only. Fail closed: showing another group's mobs is the leak the guild lead reported.
// The ESCORT TRAILS are not scoped: they are an NPC's path, carry no raider name, and are keyed per guild + zone.
// ⚠ Two raids in two copies of the same zone would share one trail per escort; the 400-unit jump break is the only
// thing that separates them.
//
// Target id 0 is "no target" on the Zeal pipe, never spawn zero (CLAUDE.md): a sample needs an id above zero.
// Positions are in the Map's SERVER frame (the agent swaps the pipe's x/y before sending); the bot never swaps.
//
// Privacy: a target's name and position is game state, not chat. A sample is held for SAMPLE_FRESH_MS and then
// forgotten; the trail rows hold an NPC's points and nothing else (no character, no discord id).
//
// Pure apart from the injected `supabase` (utils/supabase or a stand-in), clock and timer.
'use strict';

const { ZONE_RE } = require('./mapSync');

// Escort NPCs whose walk is shared as a trail: { zone short name: [normalised names] }. ADD AN ESCORT HERE, one
// line per zone (lowercase, no leading '#', spaces for underscores). The agent's MAP_TRACKED_PATHS must hold the same
// list (test/raid-targets-escort-list.test.js fails if the two drift).
// Match is on zone + name, never on spawn id: Garadain Glacierbane has several ids across zones.
const ESCORT_NPCS = {
  ponightmare: ['thelin poxbourne', 'aid eino'],
  poinnovation: ['nitram anizok'],
  eastwastes: ['garadain glacierbane'],
  iceclad: ['general bragmur'],
  cazicthule: ['gimlik cogboggle'],
  steamfont: ['cargo clockwork'],
  tenebrous: ['johanius barleou'],
  fungusgrove: ['caller groo', 'caller murkin', 'caller torgal'],
  netherbian: ['lerin sardor'],
  eastkarana: ['teloa'],
  sharvahl: ['shainai'],
  grimling: ['scout husman', 'scout derrin', 'scout danarin', 'captain necin', 'sergeant jherum', 'veteran vadrel', 'scout gergil'],
};

const SAMPLE_FRESH_MS = 90 * 1000;        // live-state heartbeats every 45 s; two missed and the target is stale
const SAMPLES_MAX     = 2000;
const TARGETS_MAX     = 40;               // rows served per zone
const COORD_MAX       = 100000;
const INT4_MAX        = 2147483647;

const PATH_STEP_UNITS = 12;               // a point is kept only this far from the last
const PATH_GAP_MS     = 20 * 1000;        // nobody had him targeted this long: no line across the gap
const PATH_JUMP_UNITS = 400;              // further than a walk: another body of that name
const PATH_MAX        = 800;
const PATH_KEEP_MS    = 12 * 60 * 60 * 1000;
const PATH_LIVE_MS    = 15 * 1000;
// Several escorts also stand still in a town with the same name (Teloa, Shainai, the Grimling scouts). A stretch of
// trail is served only once it has moved this far from where it began, so an idle copy never draws.
const PATH_MIN_SHOWN_UNITS = 100;
const SAVE_EVERY_MS   = 10 * 1000;        // at most one bot_kv write per trail per this
const LOAD_RETRY_MS   = 60 * 1000;
const KV_PREFIX       = 'escort_trail';

const MAP_CORPSE_RE = /[`'’]s\s+corpse\d*$/i;

// One spelling for a mob name; the same rules as the agent's _mapNormName.
function normName(n) {
  return String(n == null ? '' : n).toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[`'’]s\s+corpse\d*$/, '')
    .replace(/[`'’]/g, '')
    .replace(/^[#!~]+/, '')
    .replace(/(?<=[a-z])\d+$/, '')
    .replace(/\s+/g, ' ').trim();
}

const isEscort = (zone, norm) => !!(ESCORT_NPCS[zone] && ESCORT_NPCS[zone].includes(norm));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const slug = (norm) => norm.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

// One live-state record's target fields → a sample, or null when there is nothing to place: no target, id 0, a
// player or a corpse, no position, an odd zone. Never throws.
function cleanSample(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const character = typeof raw.character === 'string' ? raw.character.trim() : '';
  if (!character || character.length > 64) return null;
  const zone = typeof raw.zone === 'string' && ZONE_RE.test(raw.zone) ? raw.zone : null;
  const id = Number(raw.target_id);
  if (!zone || !Number.isInteger(id) || id <= 0 || id > INT4_MAX) return null;     // 0 is "no target"
  const name = typeof raw.target_name === 'string' ? raw.target_name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  if (!name || MAP_CORPSE_RE.test(name)) return null;
  const type = raw.target_type == null ? null : Number(raw.target_type);
  if (type != null && type !== 1) return null;                                      // players and corpses are not mobs
  const p = raw.target_map && typeof raw.target_map === 'object' ? raw.target_map : null;
  const x = p ? num(p.x) : null, y = p ? num(p.y) : null, z = p ? (num(p.z) || 0) : 0;
  if (x == null || y == null || Math.abs(x) > COORD_MAX || Math.abs(y) > COORD_MAX || Math.abs(z) > COORD_MAX) return null;
  return { character, zone, id, name, type: 1, x, y, z };
}

// May `requester` see a sample from `character`? scope is groupScope.scopeFor()'s result ({mode,...}); raidForName
// is the roster split's lookup (lowercase name → raid key or null); own is the Set of the requester's lowercase
// characters. See SCOPE above.
function keepSample(scope, character, { raidForName, own } = {}) {
  const c = String(character || '').toLowerCase();
  if (own && own.has(c)) return true;
  if (!scope) return false;
  if (scope.mode === 'raid') {
    const theirs = typeof raidForName === 'function' ? raidForName(c) : null;
    if (scope.multi) return !theirs || theirs === scope.raidKey;
    return true;
  }
  if (scope.mode === 'group') return !!(scope.names && scope.names.has(c));
  return false;
}

// Split a trail at its breaks and keep only the stretches that moved PATH_MIN_SHOWN_UNITS from where they began.
// → [{ pts, qt }] with qt the time of the point that crossed the line (a stretch is new to a reader once it does).
function shownStretches(pts) {
  const out = [];
  let seg = [];
  const close = () => {
    if (seg.length) {
      const q = seg.findIndex(p => dist2(p[0], p[1], seg[0][0], seg[0][1]) >= PATH_MIN_SHOWN_UNITS);
      if (q > 0) out.push({ pts: seg, qt: seg[q][3] });
    }
    seg = [];
  };
  for (const p of pts) { if (p[4] === 1) close(); seg.push(p); }
  close();
  return out;
}

function create({ supabase = null, guildId = null, now = Date.now, log = console, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const gid = () => (typeof guildId === 'function' ? guildId() : guildId)
    || (supabase && typeof supabase.guildId === 'function' ? supabase.guildId() : '');
  const enabled = () => !!(supabase && supabase.isEnabled && supabase.isEnabled());
  const samples = new Map();   // character lower → sample + { at }
  const trails = new Map();    // zone|norm → { zone, norm, name, at, pts, dirty, loaded, tryAt, lastSave, timer }

  const kvKey = (t) => `${KV_PREFIX}:${t.zone}:${slug(t.norm)}`;
  function trailOf(zone, norm, name) {
    const k = zone + '|' + norm;
    let t = trails.get(k);
    if (!t) { t = { zone, norm, name: name || norm, at: 0, pts: [], dirty: false, loaded: false, tryAt: -Infinity, lastSave: -Infinity, timer: null }; trails.set(k, t); }
    return t;
  }

  // Never throws. A failed read is not an empty store: it is retried a minute later, and nothing is written until a
  // read has succeeded, so a flaky boot cannot erase a trail an earlier deploy saved.
  async function load(t) {
    if (t.loaded) return true;
    if (!enabled()) return false;
    if (now() - t.tryAt < LOAD_RETRY_MS) return false;
    t.tryAt = now();
    let rows = null;
    try {
      rows = await supabase.select('bot_kv', `guild_id=eq.${encodeURIComponent(gid())}&key=eq.${encodeURIComponent(kvKey(t))}&select=value&limit=1`);
    } catch (err) { log.warn('[raid-targets] trail load failed:', err && err.message); return false; }
    if (!Array.isArray(rows)) return false;
    const v = rows[0] && rows[0].value;
    const stored = v && Array.isArray(v.pts) && Number.isFinite(Number(v.at)) && now() - Number(v.at) <= PATH_KEEP_MS
      ? v.pts.filter(p => Array.isArray(p) && p.length >= 4 && p.slice(0, 4).every(Number.isFinite)) : [];
    // Points taken since boot (before this read came back) go after the stored ones.
    const mem = t.pts;
    const first = mem[0];
    const base = stored.filter(p => !first || p[3] < first[3]);
    if (first && base.length) {
      const last = base[base.length - 1];
      first[4] = (first[3] - last[3] > PATH_GAP_MS || dist2(first[0], first[1], last[0], last[1]) > PATH_JUMP_UNITS) ? 1 : first[4];
    }
    t.pts = base.concat(mem).slice(-PATH_MAX);
    if (v && Number.isFinite(Number(v.at))) t.at = Math.max(t.at, Number(v.at));
    if (v && typeof v.name === 'string' && v.name) t.name = v.name.slice(0, 80);
    t.loaded = true;
    if (t.dirty) scheduleSave(t);
    return true;
  }

  async function doSave(t) {
    if (!t.dirty || !enabled() || !t.loaded) return;
    t.dirty = false; t.lastSave = now();
    try {
      await supabase.upsert('bot_kv', [{ guild_id: gid(), key: kvKey(t), value: { name: t.name, at: t.at, pts: t.pts },
        updated_at: new Date(now()).toISOString() }], 'guild_id,key');
    } catch (err) { t.dirty = true; log.warn('[raid-targets] trail save failed:', err && err.message); }
  }
  // Batched: the first change writes now, then at most one write per SAVE_EVERY_MS per trail (the last change in a
  // burst is written when the interval ends).
  function scheduleSave(t) {
    if (!t.loaded || !t.dirty || t.timer) return;
    const wait = Math.max(0, t.lastSave + SAVE_EVERY_MS - now());
    if (wait === 0) { doSave(t); return; }
    t.timer = setTimer(() => { t.timer = null; doSave(t); }, wait);
    if (t.timer && t.timer.unref) t.timer.unref();
  }

  // One more look at an escort. Same rules as the agent's _mapNotePath.
  function noteTrail(s, tnow) {
    const norm = normName(s.name);
    if (!isEscort(s.zone, norm)) return false;
    const t = trailOf(s.zone, norm, s.name.replace(/^[#!~]+/, ''));
    if (!t.loaded) load(t).catch(() => {});
    if (tnow - t.at > PATH_KEEP_MS) t.pts = [];
    const last = t.pts[t.pts.length - 1];
    const gap = tnow - t.at > PATH_GAP_MS;
    t.at = tnow;
    const d = last ? dist2(last[0], last[1], s.x, s.y) : Infinity;
    if (d < PATH_STEP_UNITS) { if (t.loaded && t.dirty) scheduleSave(t); return false; }
    t.pts.push([Math.round(s.x), Math.round(s.y), Math.round(s.z), tnow, last && (gap || d > PATH_JUMP_UNITS) ? 1 : 0]);
    if (t.pts.length > PATH_MAX) t.pts.splice(0, t.pts.length - PATH_MAX);
    t.dirty = true;
    scheduleSave(t);
    return true;
  }

  // The live-state handler hands every record's target fields here. No usable target clears the character's sample.
  function noteSample(raw) {
    const tnow = now();
    const s = cleanSample(raw);
    const key = raw && typeof raw.character === 'string' ? raw.character.trim().toLowerCase() : '';
    if (!s) { if (key) samples.delete(key); return false; }
    if (samples.size >= SAMPLES_MAX) {
      for (const [k, v] of samples) if (tnow - v.at > SAMPLE_FRESH_MS) samples.delete(k);
      if (samples.size >= SAMPLES_MAX) return false;
    }
    samples.set(key, Object.assign(s, { at: tnow }));
    noteTrail(s, tnow);
    return true;
  }
  const forget = (character) => { samples.delete(String(character || '').trim().toLowerCase()); };

  // Each targeted NPC in `zone` the requester may see: its latest position and how many raiders are on it.
  function targetsFor({ zone, scope, raidForName, own }) {
    const tnow = now();
    const by = new Map();
    for (const [k, s] of samples) {
      if (tnow - s.at > SAMPLE_FRESH_MS) { samples.delete(k); continue; }
      if (s.zone !== zone || !keepSample(scope, s.character, { raidForName, own })) continue;
      let g = by.get(s.id);
      if (!g) { g = { name: s.name, id: s.id, type: 1, x: s.x, y: s.y, z: s.z, at: s.at, raiders: new Set() }; by.set(s.id, g); }
      g.raiders.add(k);
      if (s.at > g.at) Object.assign(g, { name: s.name, x: s.x, y: s.y, z: s.z, at: s.at });
    }
    return [...by.values()].sort((a, b) => b.raiders.size - a.raiders.size || b.at - a.at).slice(0, TARGETS_MAX)
      .map(g => ({ name: g.name, id: g.id, type: 1, x: g.x, y: g.y, z: g.z, n: g.raiders.size, at: g.at }));
  }

  // The zone's escort trails past `tsince` (the newest point time the reader already holds; 0 = everything). Only
  // stretches that moved PATH_MIN_SHOWN_UNITS are served; a stretch that crossed that line after `tsince` goes whole,
  // since the reader never held its early points.
  async function trailsFor(zone, tsince = 0) {
    const tnow = now();
    const out = {};
    for (const norm of ESCORT_NPCS[zone] || []) {
      const t = trails.get(zone + '|' + norm) || (enabled() ? trailOf(zone, norm) : null);
      if (!t) continue;
      if (!t.loaded) await load(t).catch(() => {});
      if (!t.pts.length || tnow - t.at > PATH_KEEP_MS) continue;
      const shown = shownStretches(t.pts);
      if (!shown.length) continue;
      const pts = [];
      for (const st of shown) {
        if (st.qt > tsince) pts.push(...st.pts); else for (const p of st.pts) if (p[3] > tsince) pts.push(p);
      }
      out[norm] = { name: t.name, at: t.at, live: tnow - t.at <= PATH_LIVE_MS, pts };
    }
    return out;
  }

  // Write every trail that is waiting (a shutdown hook, and the tests).
  async function flush() {
    for (const t of trails.values()) { if (t.timer) { clearTimer(t.timer); t.timer = null; } await doSave(t); }
  }

  return { noteSample, forget, targetsFor, trailsFor, flush, _samples: samples, _trails: trails };
}

module.exports = {
  ESCORT_NPCS, SAMPLE_FRESH_MS, TARGETS_MAX, PATH_STEP_UNITS, PATH_GAP_MS, PATH_JUMP_UNITS, PATH_MAX, PATH_KEEP_MS,
  PATH_MIN_SHOWN_UNITS, SAVE_EVERY_MS, normName, cleanSample, keepSample, shownStretches, create,
};
