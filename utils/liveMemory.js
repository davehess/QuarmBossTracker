// utils/liveMemory.js — the latest raid_roster and character_live_state rows, held in the bot's memory.
//
// Why (the guild lead, 2026-10-16, option A: "log ingestion is WAY over"): Supabase logs every API request.
// The bot is the ONE process every agent uploads these two streams to (~81k roster and ~48k live-state
// POSTs a day), and it then READ the same rows straight back for the raid split, Extended Target, the buff
// queue, di-status, the zone map and the character-live-state relay. Two changes here:
//   1. READS: a reader asks for the rows in its window and gets them from memory once memory is warm.
//   2. WRITES: every row still reaches Supabase (the web, the replay recorder and the raid screen read the
//      tables), but as one upsert per table every 2 s, the newest row per key, instead of one per upload.
//
// ⚠ ONE-REPLICA RULE. Memory is complete ONLY IF a single bot process receives every upload. A second replica
// would see half of them and answer from half a raid. The bot runs one Railway replica (CLAUDE.md), and the
// warm-up gate below is also why a fresh process starts from Supabase: until it has been receiving a stream
// for a reader's whole window it knows nothing about the rows that arrived before it started, so it answers
// null and the reader runs its original Supabase read UNCHANGED. A deploy's overlap window, a restart and a
// second replica all look the same to the gate: cold, so Supabase.
//
// Upsert semantics: an upsert with a subset of columns keeps the others. The handlers send full rows today,
// but memory and the pending batch both merge `{ ...earlier, ...later }`, and a batch whose rows carry
// different column sets is sent as one upsert per column set, so a partial row would behave in memory and in
// Supabase exactly as it would have as its own upsert.
//
// ⚠ Rows handed out are COPIES (one level deep): the nested arrays (buffs, zeal_tags) are shared, so read
// them and do not edit them.

const FLUSH_MS = 2_000;                   // one upsert per table per tick
const KEEP_MS = 30 * 60 * 1000;           // memory drops entries older than this (readers' widest window is 15 min)
const SWEEP_EVERY_MS = 60 * 1000;         // ...checked on write, at most this often
const MAX_PENDING = 5_000;                // unflushed keys per table; past it the oldest are dropped

const _sb = { client: null };             // a test hands in a fake; production requires the real one lazily
const supabase = () => _sb.client || require('./supabase');

function makeStream(table, onConflict, key, timeField) {
  return {
    table, onConflict, key, timeField,
    mem: new Map(),        // key → latest merged row
    pending: new Map(),    // key → merged row not yet in Supabase, oldest first
    inflight: null,        // the flush request in the air, if any
    timer: null,
    startedAt: null,       // when this process first noted a row of the stream: the warm-up gate's clock
    lastSweep: 0,
    overflowed: false,
  };
}

// raid_roster's unique key is (guild_id, uploaded_by_discord_id, name), live state's is (guild_id, character).
const roster = makeStream('raid_roster', 'guild_id,uploaded_by_discord_id,name',
  (r) => `${r.guild_id}|${r.uploaded_by_discord_id}|${r.name}`, 'captured_at');
const live = makeStream('character_live_state', 'guild_id,character',
  (r) => `${r.guild_id}|${r.character}`, 'updated_at');

function sweep(s, now) {
  if (now - s.lastSweep < SWEEP_EVERY_MS) return;
  s.lastSweep = now;
  for (const [k, row] of s.mem) {
    const at = Date.parse(row[s.timeField]);
    if (!(at >= now - KEEP_MS)) s.mem.delete(k);
  }
}

function capPending(s) {
  if (s.pending.size <= MAX_PENDING) return;
  if (!s.overflowed) {
    s.overflowed = true;
    console.warn(`[liveMemory] ${s.table}: more than ${MAX_PENDING} rows waiting to be written — dropping the oldest`);
  }
  for (const k of s.pending.keys()) {
    if (s.pending.size <= MAX_PENDING) break;
    s.pending.delete(k);
  }
}

function schedule(s) {
  if (s.timer || !s.pending.size) return;
  s.timer = setTimeout(() => { s.timer = null; flush(s).catch(() => {}); }, FLUSH_MS);
  if (s.timer.unref) s.timer.unref();
}

function note(s, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const now = Date.now();
  if (s.startedAt == null) s.startedAt = now;
  for (const row of rows) {
    if (!row) continue;
    const k = s.key(row);
    s.mem.set(k, { ...s.mem.get(k), ...row });
    const pend = s.pending.get(k);
    s.pending.delete(k);                      // re-insert: the Map stays ordered oldest → newest
    s.pending.set(k, pend ? { ...pend, ...row } : { ...row });
  }
  sweep(s, now);
  capPending(s);
  schedule(s);
}

// Group a batch by column set, so a partial row is never sent next to a full one (PostgREST nulls the columns
// a row in the same request lacks).
function groups(batch) {
  const by = new Map();
  for (const [k, row] of batch) {
    const sig = Object.keys(row).sort().join(',');
    if (!by.has(sig)) by.set(sig, []);
    by.get(sig).push([k, row]);
  }
  return [...by.values()];
}

async function flush(s) {
  while (s.inflight) await s.inflight;
  if (!s.pending.size) return true;
  const batch = s.pending;
  s.pending = new Map();
  s.inflight = (async () => {
    const failed = [];
    let sb;
    try { sb = supabase(); } catch { sb = null; }
    for (const g of groups(batch)) {
      let ok = false;
      try {
        // `confirm` makes a return=minimal upsert answer true on success (an empty body otherwise reads as null,
        // which is also what a failure returns).
        ok = !!(sb && await sb.upsert(s.table, g.map(([, row]) => row), s.onConflict, { minimal: true, confirm: true }));
      } catch { ok = false; }
      if (!ok) failed.push(...g);
    }
    // Keep what failed; a newer row for the same key (noted while the request was out) wins field by field.
    for (const [k, row] of failed) {
      const newer = s.pending.get(k);
      s.pending.set(k, newer ? { ...row, ...newer } : row);
    }
    capPending(s);
  })().finally(() => { s.inflight = null; schedule(s); });
  await s.inflight;
  return s.pending.size === 0;
}

// Rows of the stream newer than `windowMs` for `guildId`, or null while the stream is not warm. `match` narrows
// by the key column (case-insensitive), the way the relay's ilike did.
function read(s, guildId, windowMs, matchCol, matchVal) {
  const now = Date.now();
  if (s.startedAt == null || now - s.startedAt < windowMs) return null;
  const since = now - windowMs;
  const want = matchVal == null ? null : String(matchVal).toLowerCase();
  const out = [];
  for (const row of s.mem.values()) {
    if (row.guild_id !== guildId) continue;
    if (!(Date.parse(row[s.timeField]) >= since)) continue;
    if (want != null && String(row[matchCol] || '').toLowerCase() !== want) continue;
    out.push({ ...row });
  }
  return out;
}

const noteRosterRows = (rows) => note(roster, rows);
const noteLiveStateRows = (rows) => note(live, rows);

// → raid_roster rows with captured_at inside the window, ordered like the SQL read (uploader, name); null = cold.
function rosterRowsSince(guildId, windowMs, name) {
  const rows = read(roster, guildId, windowMs, 'name', name);
  if (!rows) return null;
  return rows.sort((a, b) => {
    const ua = String(a.uploaded_by_discord_id || ''), ub = String(b.uploaded_by_discord_id || '');
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// → character_live_state rows with updated_at inside the window; null = cold.
const liveStateRowsSince = (guildId, windowMs, character) => read(live, guildId, windowMs, 'character', character);

// A character-swap stamp is an UPDATE of columns on a row that exists, not an upsert. Merge it into memory, and
// into the pending row if one is waiting (otherwise the batch would write swapped_to back to null). The caller
// then awaits flushLiveState() and sends its UPDATE, so the UPDATE cannot land before the row it patches.
function noteLiveStateSwap(guildId, character, patch) {
  const k = live.key({ guild_id: guildId, character });
  const cur = live.mem.get(k);
  if (cur) live.mem.set(k, { ...cur, ...patch });
  const pend = live.pending.get(k);
  if (pend) live.pending.set(k, { ...pend, ...patch });
}

const flushLiveState = () => flush(live);
const flushAll = () => Promise.all([flush(roster), flush(live)]);

// Tests only.
function _reset(client) {
  for (const s of [roster, live]) {
    if (s.timer) clearTimeout(s.timer);
    s.mem.clear(); s.pending.clear(); s.inflight = null; s.timer = null;
    s.startedAt = null; s.lastSweep = 0; s.overflowed = false;
  }
  _sb.client = client || null;
}
function _sizes() {
  return { rosterMem: roster.mem.size, rosterPending: roster.pending.size, liveMem: live.mem.size, livePending: live.pending.size };
}

module.exports = {
  noteRosterRows, noteLiveStateRows, noteLiveStateSwap,
  rosterRowsSince, liveStateRowsSince,
  flushLiveState, flushAll,
  FLUSH_MS, KEEP_MS, MAX_PENDING,
  _reset, _sizes,
};
