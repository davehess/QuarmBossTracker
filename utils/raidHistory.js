// utils/raidHistory.js — six raid streams the bot used to hold only in memory, now SAVED (the guild lead,
// 2026-10-29, option C: "start saving" what a restart used to erase).
//
//   mob_sightings  where a raider's target stood: a row when the character's target spawn changes, or the mob has
//                  moved more than SIGHTING_MOVE_UNITS since that character's last saved row   → raid_mob_sightings
//   mob_hp         a mob's health, when it stepped HP_STEP points from the last saved value, or hit 0    → raid_mob_hp
//   casts          who cast what on whom, one row per cast start                                            → raid_casts
//   zone_changes   a character's zone, when it changes                                                  → raid_zone_changes
//   pet_owners     each new "my leader is <owner>" declaration                                           → raid_pet_owners
//   trigger_fires  a guild trigger fire that the relay accepted                                        → raid_trigger_fires
//
// WHY ONE MODULE. Every stream is "decide cheaply in memory whether this observation is NEW, then append". The
// deciding is per stream (below), the appending is shared: ONE batched writer.
//
// THE WRITER (never on the request path). push() puts a row in a per-table buffer and returns; a timer flushes every
// FLUSH_MS, or at once when a table holds BATCH_ROWS. A flush is one INSERT per table per chunk (return=minimal, so no
// body comes back). The buffer is BOUNDED: past MAX_BUFFER the oldest rows are dropped and that is logged ONCE on
// stdout (CLAUDE.md: an expected condition is not an error line). While the Supabase breaker is open nothing is sent;
// rows wait in the (bounded) buffer. A failed chunk is retried with a growing pause and dropped after
// MAX_ATTEMPTS, so one unwritable batch cannot wedge a table (the retries are what a missing table looks like until the
// migration is applied — apply it BEFORE this deploys).
//
// SHEDDING (mid-raid kill switch). Each stream has a kind in index.js `_SHED_KINDS` (`hist_<stream>`), so an officer sets
// `flag_shed_hist_<stream>` = 1 in the tuning map exactly like the ingest kinds. The flags are read from the same 60 s
// tuning cache by refreshShed(), which every flush runs; push() reads the last answer synchronously. A shed stream drops
// at push() and clears its buffer at the next flush.
//
// RETENTION. RETENTION_DAYS (60) in Supabase, swept nightly by pruneAll(): each table's time column leads its index
// (the encounter_threat_snapshots sweep never worked because its time predicate had no usable index), and the delete
// goes in time SLICES so no single DELETE can outrun the client's 10 s timeout.
//
// ONE REPLICA. The dedupe state is process memory; a second bot replica would only double-record the first sight of
// each key. A restart forgets it, which costs at most one repeat row per live key — never a lost one.
//
// Nothing here throws into a handler: every public note*() is wrapped.

'use strict';

const FLUSH_MS = 5_000;
const BATCH_ROWS = 500;
const MAX_BUFFER = 20_000;            // rows held per table; past it the oldest go
const MAX_CHUNKS_PER_FLUSH = 4;       // 2,000 rows per table per tick at most
const MAX_ATTEMPTS = 3;               // consecutive failures of one chunk before it is dropped
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 10 * 60 * 1000;
const SHED_REFRESH_MS = 30_000;
const RETENTION_DAYS = 60;
const PRUNE_SLICE_MS = 6 * 60 * 60 * 1000;
const PRUNE_MAX_SLICES = 16;          // per table per night; the rest waits for tomorrow
const PRUNE_BUDGET_MS = 90_000;       // wall clock for the whole sweep

const SIGHTING_MOVE_UNITS = 10;
const HP_STEP = 5;
const CAST_DEDUPE_MS = 2_000;
const STATE_TTL_MS = 2 * 60 * 60 * 1000;
const PET_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_MAX = 4_000;

// stream → table, the column the table's index leads with, and the shed kind (flag_shed_<shed>).
const STREAMS = {
  mob_sightings: { table: 'raid_mob_sightings', timeCol: 'seen_at',     shed: 'hist_mob_sightings' },
  mob_hp:        { table: 'raid_mob_hp',        timeCol: 'at',          shed: 'hist_mob_hp' },
  casts:         { table: 'raid_casts',         timeCol: 'cast_at',     shed: 'hist_casts' },
  zone_changes:  { table: 'raid_zone_changes',  timeCol: 'at',          shed: 'hist_zone_changes' },
  pet_owners:    { table: 'raid_pet_owners',    timeCol: 'declared_at', shed: 'hist_pet_owners' },
  trigger_fires: { table: 'raid_trigger_fires', timeCol: 'fired_at',    shed: 'hist_trigger_fires' },
};
const SHED_KINDS = Object.values(STREAMS).map(s => s.shed);

const iso = (ms) => new Date(ms).toISOString();
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// A Map used as a bounded memo: insertion order is recency order (set() after delete()), so the oldest key is first.
function remember(map, key, value, max = STATE_MAX) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

function create({
  supabase = null,
  guildId = null,
  now = Date.now,
  log = console,
  tuning = null,                    // async () => the tuning map (index.js: _overlayTuningMap)
  flushMs = FLUSH_MS,
  batchRows = BATCH_ROWS,
  maxBuffer = MAX_BUFFER,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const sb = () => supabase || require('./supabase');
  const gid = () => (typeof guildId === 'function' ? guildId() : guildId) || require('./supabase').guildId();
  const enabled = () => { try { return !!sb().isEnabled(); } catch { return false; } };

  // ── The writer ─────────────────────────────────────────────────────────────
  const bufs = new Map();          // table → { rows, fails, retryAt, inflight, overflowLogged }
  for (const s of Object.values(STREAMS)) bufs.set(s.table, { rows: [], fails: 0, retryAt: 0, inflight: null, overflowLogged: false });
  let timer = null;
  const shedNow = new Map();       // shed kind → true
  let shedAt = -Infinity, shedBusy = null;
  const stats = { written: 0, dropped: 0, shed: 0, failed: 0 };

  function isShed(streamKey) {
    const s = STREAMS[streamKey];
    return !!(s && shedNow.get(s.shed));
  }
  // Re-reads flag_shed_hist_<stream> from the tuning map (60 s cached in index.js). Fail-open: an unreadable map
  // leaves the last answer alone, and an unset flag is not shed.
  function refreshShed(force = false) {
    if (typeof tuning !== 'function') return Promise.resolve();
    if (shedBusy) return shedBusy;
    if (!force && now() - shedAt < SHED_REFRESH_MS) return Promise.resolve();
    shedAt = now();
    shedBusy = (async () => {
      try {
        const map = (await tuning()) || {};
        for (const kind of SHED_KINDS) shedNow.set(kind, Number(map[`flag_shed_${kind}`]) >= 1);
      } catch { /* fail-open: keep the last answer */ }
    })().finally(() => { shedBusy = null; });
    return shedBusy;
  }

  function schedule() {
    if (timer) return;
    timer = setTimer(() => { timer = null; flush().catch(() => {}); }, flushMs);
    if (timer && timer.unref) timer.unref();
  }

  // → true when the row was accepted into the buffer.
  function push(streamKey, row) {
    try {
      const s = STREAMS[streamKey];
      if (!s || !row) return false;
      if (shedNow.size === 0 || now() - shedAt >= SHED_REFRESH_MS) refreshShed().catch(() => {});
      if (isShed(streamKey)) { stats.shed++; return false; }
      if (!enabled()) return false;
      const b = bufs.get(s.table);
      b.rows.push({ guild_id: gid(), ...row });
      if (b.rows.length > maxBuffer) dropOldest(b, s.table);
      if (b.rows.length >= batchRows) flushTable(streamKey).catch(() => {});
      else schedule();
      return true;
    } catch { return false; }
  }

  function dropOldest(b, table) {
    const over = b.rows.length - maxBuffer;
    if (over <= 0) return;
    // A tenth of the cap at a time, so a full buffer does not re-trim on every push.
    const cut = Math.max(over, Math.ceil(maxBuffer / 10));
    b.rows.splice(0, cut);
    stats.dropped += cut;
    if (!b.overflowLogged) {
      b.overflowLogged = true;
      log.log(`[raid-history] ${table}: more than ${maxBuffer} rows waiting to be written — dropping the oldest (logged once)`);
    }
  }

  async function flushTable(streamKey) {
    const s = STREAMS[streamKey];
    const b = bufs.get(s.table);
    if (b.inflight) return b.inflight;
    b.inflight = (async () => {
      if (isShed(streamKey)) { b.rows.length = 0; return; }
      if (!b.rows.length || !enabled()) return;
      if (now() < b.retryAt) return;
      let client;
      try { client = sb(); } catch { return; }
      // An open breaker fails fast inside the client anyway; not sending keeps the warn lines out of the log.
      try { if (client.breakerState && client.breakerState().open) return; } catch { /* no breaker info: try */ }
      for (let i = 0; i < MAX_CHUNKS_PER_FLUSH && b.rows.length; i++) {
        const chunk = b.rows.splice(0, batchRows);
        let ok = false;
        try { ok = (await client.insert(s.table, chunk, { minimal: true })) === true; } catch { ok = false; }
        if (ok) {
          stats.written += chunk.length;
          b.fails = 0; b.retryAt = 0; b.overflowLogged = false;
          continue;
        }
        b.fails++;
        stats.failed++;
        if (b.fails >= MAX_ATTEMPTS) {
          stats.dropped += chunk.length;
          log.log(`[raid-history] ${s.table}: dropped ${chunk.length} rows after ${b.fails} failed writes (is the migration applied?)`);
          b.fails = 0;
        } else {
          b.rows.unshift(...chunk);                    // back to the front: oldest first stays oldest
          if (b.rows.length > maxBuffer) dropOldest(b, s.table);
        }
        // 5 s, 20 s, then (after the drop) 80 s, growing fourfold per consecutive failure up to 10 min.
        b.retryAt = now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 4 ** ((b.fails || MAX_ATTEMPTS) - 1));
        break;
      }
    })().finally(() => { b.inflight = null; });
    return b.inflight;
  }

  async function flush() {
    await refreshShed(true);
    await Promise.all(Object.keys(STREAMS).map(k => flushTable(k).catch(() => {})));
    if ([...bufs.values()].some(b => b.rows.length)) schedule();
  }

  const pending = () => Object.fromEntries([...bufs].map(([t, b]) => [t, b.rows.length]));

  // ── 1. Mob sightings ───────────────────────────────────────────────────────
  // s = raidTargets' cleaned sample: { character, zone, id, name, x, y, z }. State: per character, the last SAVED
  // sighting. A row when there is none, the target spawn (zone + id) differs, or the mob is more than
  // SIGHTING_MOVE_UNITS from where this character last saved it.
  const lastSighting = new Map();
  function noteSighting(s, atMs = now()) {
    try {
      if (!s || !s.character || !s.zone || !Number.isInteger(s.id) || s.id <= 0 || !s.name) return false;   // 0 is "no target"
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
      const key = `${gid()}|${String(s.character).toLowerCase()}`;
      const z = Number.isFinite(s.z) ? s.z : 0;
      const prev = lastSighting.get(key);
      const p = prev && atMs - prev.at <= STATE_TTL_MS ? prev : null;
      if (p && p.zone === s.zone && p.id === s.id) {
        const d = Math.sqrt((s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (z - p.z) ** 2);
        if (!(d > SIGHTING_MOVE_UNITS)) return false;
      }
      if (!push('mob_sightings', {
        seen_at: iso(atMs), character: text(s.character, 64), zone: text(s.zone, 40), spawn_id: s.id,
        mob_name: text(s.name, 80), x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, z: Math.round(z * 10) / 10,
      })) return false;
      remember(lastSighting, key, { zone: s.zone, id: s.id, x: s.x, y: s.y, z, at: atMs });
      return true;
    } catch { return false; }
  }

  // ── 2. Mob HP ──────────────────────────────────────────────────────────────
  // Many Mimics poll the same mob, so this is keyed by the MOB — (guild, zone, spawn id), or the lowercased name when
  // the name is unique and no id came — never by who looked. State: the last SAVED hp. A row on the first reading,
  // when the hp is HP_STEP or more from the saved one (either direction: a heal or a reset is a move too), or on 0
  // (once: a corpse reading again at 0 is not another death).
  const lastHp = new Map();
  function noteMobHp({ zone, spawn_id, name, hp }, atMs = now()) {
    try {
      const h = num(hp);
      const nm = text(name, 80);
      if (h == null || !nm) return false;
      const sid = Number.isInteger(spawn_id) && spawn_id > 0 ? spawn_id : null;
      const z = text(zone, 40);
      const key = `${gid()}|${z.toLowerCase()}|${sid != null ? '#' + sid : 'n:' + nm.toLowerCase()}`;
      const hp1 = Math.max(0, Math.min(100, Math.round(h * 10) / 10));
      const prev = lastHp.get(key);
      const p = prev && atMs - prev.at <= STATE_TTL_MS ? prev : null;
      let save;
      if (!p) save = true;
      else if (hp1 <= 0) save = p.hp > 0;
      else save = Math.abs(hp1 - p.hp) >= HP_STEP;
      if (!save) { if (p) p.at = atMs; return false; }   // still seen: keep the state alive
      if (!push('mob_hp', { at: iso(atMs), zone: z, spawn_id: sid, mob_name: nm, hp_pct: hp1 })) return false;
      remember(lastHp, key, { hp: hp1, at: atMs });
      return true;
    } catch { return false; }
  }

  // ── 3. Casts ───────────────────────────────────────────────────────────────
  // A cast is reported by its caster's agent, and a retry or a second agent on the same character repeats it with
  // a start time a moment apart. Same caster + spell + target within CAST_DEDUPE_MS of a start already saved is the
  // same cast (a spell gem cannot be cast again that fast).
  const lastCast = new Map();
  function noteCast(c, atMs = now()) {
    try {
      const caster = text(c && c.caster, 64), spell = text(c && c.spell, 80), target = text(c && c.target, 80);
      if (!caster || !spell || !target) return false;
      let start = Number(c.started_at_ms);
      if (!Number.isFinite(start) || start > atMs + 60_000 || start < atMs - 10 * 60_000) start = atMs;   // a wild clock
      const key = `${gid()}|${caster.toLowerCase()}|${spell.toLowerCase()}|${target.toLowerCase()}`;
      const prev = lastCast.get(key);
      if (prev != null && Math.abs(start - prev) < CAST_DEDUPE_MS) return false;
      const tid = Number.isInteger(c.target_id) && c.target_id > 0 ? c.target_id : null;
      const heal = Number.isFinite(Number(c.heal_amount)) && Number(c.heal_amount) > 0 ? Math.trunc(Number(c.heal_amount)) : null;
      const secs = Number.isFinite(Number(c.cast_secs)) ? Math.round(Number(c.cast_secs) * 100) / 100 : null;
      if (!push('casts', { cast_at: iso(start), caster, spell, target, target_id: tid, cast_secs: secs, heal_amount: heal })) return false;
      remember(lastCast, key, start);
      return true;
    } catch { return false; }
  }

  // ── 4. Zone changes ────────────────────────────────────────────────────────
  // rows = the live-state upload's character_live_state rows ({ character, zone_id, zone_name, updated_at }). Same
  // shape as the bot's target-switch log: remember each character's last zone, write when it differs, and write the
  // first sight too (from_* null) so the history starts with where the character WAS.
  const lastZone = new Map();
  function noteLiveRows(rows, atMs = now()) {
    let n = 0;
    try {
      if (!Array.isArray(rows)) return 0;
      for (const r of rows) {
        if (!r || !r.character) continue;
        const zid = Number.isInteger(r.zone_id) ? r.zone_id : null;
        const zname = r.zone_name ? text(r.zone_name, 80) : null;
        if (zid == null && !zname) continue;                 // no zone in this record: nothing to compare
        const sig = zid != null ? `id:${zid}` : `n:${zname.toLowerCase()}`;
        const key = `${r.guild_id || gid()}|${String(r.character).toLowerCase()}`;
        const prev = lastZone.get(key);
        if (prev && prev.sig === sig) continue;
        const at = Number.isFinite(Date.parse(r.updated_at)) ? Date.parse(r.updated_at) : atMs;
        if (!push('zone_changes', {
          at: iso(at), character: text(r.character, 64), zone_id: zid, zone_name: zname,
          from_zone_id: prev ? prev.zid : null, from_zone_name: prev ? prev.zname : null,
        })) continue;
        remember(lastZone, key, { sig, zid, zname });
        n++;
      }
    } catch { /* never throws into the handler */ }
    return n;
  }

  // ── 5. Pet / charm owner declarations ──────────────────────────────────────
  // leaders = the encounter upload's pet_leaders { petName: ownerName }; ids = { petNameLower: spawnId }. The same
  // declaration arrives in every raider's upload of the fight, so a (pet, owner, spawn id) is written once per
  // PET_TTL_MS. (Pet names are re-rolled at a re-summon, so the same name next night is a new declaration.)
  const seenPet = new Map();
  function notePets(leaders, ids, atMs = now()) {
    let n = 0;
    try {
      if (!leaders || typeof leaders !== 'object') return 0;
      for (const [petRaw, ownerRaw] of Object.entries(leaders)) {
        if (typeof ownerRaw !== 'string') continue;
        const pet = text(petRaw, 40), owner = text(ownerRaw, 30);
        if (!pet || !owner) continue;
        const sid = ids && Number.isInteger(ids[pet.toLowerCase()]) && ids[pet.toLowerCase()] > 0 ? ids[pet.toLowerCase()] : null;
        const key = `${gid()}|${pet.toLowerCase()}|${owner.toLowerCase()}|${sid == null ? '' : sid}`;
        const prev = seenPet.get(key);
        if (prev != null && atMs - prev <= PET_TTL_MS) continue;
        if (!push('pet_owners', { declared_at: iso(atMs), pet, owner, pet_spawn_id: sid })) continue;
        remember(seenPet, key, atMs);
        n++;
      }
    } catch { /* never throws into the handler */ }
    return n;
  }

  // ── 6. Trigger fires ───────────────────────────────────────────────────────
  // e = the relay entry the bot just accepted ({ name, key, captures, fired_at_true_ms, posted_at_ms, uploaded_by });
  // the relay already collapsed several observers of one event into one entry, so every entry is a row.
  function noteTriggerFire(e) {
    try {
      const name = text(e && e.name, 120);
      if (!name) return false;
      const ms = Number(e.fired_at_true_ms) || Number(e.fired_at_ms) || Number(e.posted_at_ms) || now();
      let captures = null;
      if (e.captures && typeof e.captures === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(e.captures).slice(0, 8)) {
          if (v == null || typeof v === 'object') continue;
          out[text(k, 24)] = text(v, 60);
        }
        if (Object.keys(out).length) captures = out;
      }
      return push('trigger_fires', {
        fired_at: iso(Number.isFinite(ms) ? ms : now()), trigger_name: name, trigger_key: text(e.key, 200) || null,
        captures, uploaded_by: text(e.uploaded_by, 64) || null,
      });
    } catch { return false; }
  }

  // ── Retention ──────────────────────────────────────────────────────────────
  // Oldest row first, in PRUNE_SLICE_MS slices: "delete everything before oldest + slice" is an index range scan from
  // the front of the time-led index, so each DELETE touches one slice of rows. del() answers null whether it worked or
  // not, so progress is checked by re-reading the oldest row: no progress ends that table's sweep.
  async function pruneAll({ keepDays = RETENTION_DAYS, sliceMs = PRUNE_SLICE_MS, maxSlices = PRUNE_MAX_SLICES, budgetMs = PRUNE_BUDGET_MS } = {}) {
    const out = { deleted: {}, stopped: {} };
    if (!(keepDays > 0) || !enabled()) return out;
    const client = sb();
    const cutoff = now() - keepDays * 24 * 60 * 60 * 1000;
    const t0 = Date.now();
    const oldestOf = async (s) => {
      const rows = await client.select(s.table, `select=${s.timeCol}&order=${s.timeCol}.asc&limit=1`);
      const v = Array.isArray(rows) && rows[0] ? Date.parse(rows[0][s.timeCol]) : NaN;
      return Number.isFinite(v) ? v : null;
    };
    for (const s of Object.values(STREAMS)) {
      out.deleted[s.table] = 0; out.stopped[s.table] = 'done';
      try {
        let oldest = await oldestOf(s);
        for (let i = 0; i < maxSlices; i++) {
          if (oldest == null || oldest >= cutoff) break;
          if (Date.now() - t0 > budgetMs) { out.stopped[s.table] = 'budget'; break; }
          const hi = Math.min(cutoff, oldest + sliceMs);
          await client.del(s.table, `${s.timeCol}=lt.${encodeURIComponent(iso(hi))}`);
          out.deleted[s.table]++;
          const next = await oldestOf(s);
          if (next != null && next <= oldest) { out.stopped[s.table] = 'stalled'; break; }
          oldest = next;
          if (i === maxSlices - 1 && oldest != null && oldest < cutoff) out.stopped[s.table] = 'slices';
        }
      } catch { out.stopped[s.table] = 'error'; }
    }
    return out;
  }

  return {
    push, flush, refreshShed, isShed, pruneAll, pending,
    noteSighting, noteMobHp, noteCast, noteLiveRows, notePets, noteTriggerFire,
    stats, _state: { lastSighting, lastHp, lastCast, lastZone, seenPet, bufs },
  };
}

module.exports = {
  create, STREAMS, SHED_KINDS,
  FLUSH_MS, BATCH_ROWS, MAX_BUFFER, MAX_ATTEMPTS, RETENTION_DAYS,
  SIGHTING_MOVE_UNITS, HP_STEP, CAST_DEDUPE_MS,
};
