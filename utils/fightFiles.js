// utils/fightFiles.js — a fight's per-second snapshots live in the bot's memory while the fight is on, and go to
// Supabase Storage as ONE gzipped file when it ends, instead of one Postgres row per snapshot.
//
// The guild lead, 2026-11-05 ("do A, keep everything"): encounter_threat_snapshots was 2.6 GB (53% of the
// database) and ~12.5k inserts + 2.9k updates per two raid hours; the Micro instance ran out of disk IO on
// 2026-11-04 (DECISIONS §538). Files are kept forever.
//
// Switch (tuning map key `snapshot_store`, read by index.js): 0 = rows only (today), 1 = rows AND memory + files,
// 2 = memory + files only. This module is only handed rows when the switch is >= 1.
//
// Parts:
//   · the in-memory buffer (createStore): rows grouped into fights the way /live-damage groups them (same guild,
//     same boss, starts within 20 s), a fight ends after FIGHT_IDLE_MS with no snapshot, then it is written.
//   · the file: fight-snapshots/<guild>/<YYYY-MM-DD>/<boss>/<start>_s<HHMMSS>.ndjson.gz. First line a header, then
//     one JSON line per stored row. The first-snapshot suffix keeps a bot restart mid-fight from overwriting the
//     file the earlier process wrote for the same start.
//   · the rank contribution (rankRows): what rollup_threat_ranks (migration 20260808050000) would compute from the
//     same rows, in JS, upserted into encounter_threat_rank when the file is written.
//   · readers: liveRows (memory) and readStoredFight (the files, for a fight older than the memory window).
//
// Trash (no boss name) is grouped per run of activity rather than per pull, so a night is a handful of files and
// not thousands. Its rank rows are per NIGHT (as in SQL), so they are merged into the night's existing row.

'use strict';

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const BUCKET = 'fight-snapshots';
const GROUP_WINDOW_MS = 20_000;          // the same window /live-damage uses to call two starts one fight
const TRASH_KEY = '(raid trash)';        // boss_name_key the SQL rollup gives trash
const MIN_GROUP = 8;                     // v_min_group in rollup_threat_ranks
const DEFAULTS = {
  idleMs: 5 * 60_000,                    // no snapshot for this long = the fight is over
  retainMs: 30 * 60_000,                 // a written fight stays readable (the History's post-fight re-asks)
  maxFights: 24,
  maxRowsPerFight: 6000,                 // a fight at this size is written now and the next row opens a new one
  maxBytes: 192 * 1024 * 1024,           // rough size of everything held
  tickMs: 30_000,
  retryBaseMs: 30_000,
  retryMaxMs: 10 * 60_000,
  maxAttempts: 8,
};

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────────────
function slug(s, dflt) {
  const t = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || dflt;
}
function compactIso(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function filePath(guild, boss, startMs, firstSnapMs) {
  const d = new Date(startMs).toISOString().slice(0, 10);
  const hms = new Date(firstSnapMs).toISOString().slice(11, 19).replace(/:/g, '');
  return `${slug(guild, 'guild')}/${d}/${slug(boss, 'trash')}/${compactIso(startMs)}_s${hms}.ndjson.gz`;
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function encodeFile(header, rows) {
  const lines = [JSON.stringify(header)];
  for (const r of rows) lines.push(JSON.stringify(r));
  return gzip(Buffer.from(lines.join('\n') + '\n', 'utf8'));
}
async function decodeFile(buf) {
  const text = (await gunzip(buf)).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  if (!lines.length) return { header: null, rows: [] };
  return { header: JSON.parse(lines[0]), rows: lines.slice(1).map((l) => JSON.parse(l)) };
}

// ── the rank contribution: rollup_threat_ranks re-expressed ─────────────────────────────────────────────
// America/New_York wall clock of an instant, as if it were UTC.
const _nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});
function _nyWallAsUtc(ms) {
  const p = {};
  for (const x of _nyFmt.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
// date_trunc('day', (t AT TIME ZONE 'America/New_York') - interval '6 hours') AT TIME ZONE 'America/New_York'
function nightStartMs(snapMs) {
  const wall = _nyWallAsUtc(snapMs) - 6 * 3600_000;
  const dayWall = Math.floor(wall / 86_400_000) * 86_400_000;       // local midnight, as a wall clock
  let guess = dayWall - (_nyWallAsUtc(dayWall) - dayWall);          // midnight is never inside a DST gap here
  guess = dayWall - (_nyWallAsUtc(guess) - guess);
  return guess;
}
// jsonb_each walks keys shortest first, then by bytes; row_number() over equal scores keeps that order.
function _jsonbKeyOrder(a, b) {
  const la = Buffer.byteLength(a), lb = Buffer.byteLength(b);
  return la !== lb ? la - lb : Buffer.compare(Buffer.from(a), Buffer.from(b));
}
const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const _field = (v, k) => (v && typeof v === 'object' && !Array.isArray(v) ? _num(v[k]) : 0);
// round(sum / n, 2), half away from zero, in integers (the SQL rounds a numeric, so no float error)
const _avg2 = (sum, n) => Math.floor((200 * sum + n) / (2 * n)) / 100;

// rows: stored-shape snapshot rows. Returns the encounter_threat_rank rows the SQL would upsert for them.
function rankRows(rows, { minGroup = MIN_GROUP } = {}) {
  const parts = new Map();                      // partition: guild, boss, started_at, snapshot_at, uploader
  for (const r of rows || []) {
    if (!r || !r.started_at) continue;
    const startMs = Date.parse(r.started_at), snapMs = Date.parse(r.snapshot_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(snapMs)) continue;
    const pp = r.per_player;
    if (!pp || typeof pp !== 'object' || Array.isArray(pp)) continue;
    if (r.boss_name == null && r.raid_night_id == null) continue;
    const key = [r.guild_id, r.boss_name == null ? '' : r.boss_name, startMs, snapMs, r.uploader].join('\u0000');
    parts.set(key, { r, startMs, snapMs });     // the same key is one stored row (the upsert replaced it)
  }
  const agg = new Map();
  for (const { r, startMs, snapMs } of parts.values()) {
    const names = Object.keys(r.per_player).sort(_jsonbKeyOrder);
    const scored = names.map((name) => {
      const v = r.per_player[name];
      return { name, score: _field(v, 'swing') + _field(v, 'proc') + _field(v, 'spell') + _field(v, 'heal') };
    });
    scored.sort((a, b) => b.score - a.score);   // stable: ties keep the jsonb order
    const field = scored.length;
    const isBoss = r.boss_name != null;
    const bossKey = isBoss ? r.boss_name : TRASH_KEY;
    const keyMs = isBoss ? startMs : nightStartMs(snapMs);
    scored.forEach((s, i) => {
      const rank = i + 1;
      const k = [r.guild_id, bossKey, keyMs, s.name].join('\u0000');
      let a = agg.get(k);
      if (!a) {
        a = { guild_id: r.guild_id, boss_name_key: bossKey, startMs: keyMs, character_name: s.name,
          boss_name: isBoss ? r.boss_name : null, encounter_id: null, raid_night_id: null, starts: new Set(),
          snapshots: 0, top1: 0, top3: 0, best: rank, worst: rank, sumRank: 0, sumField: 0 };
        agg.set(k, a);
      }
      if (isBoss && (a.boss_name == null || r.boss_name < a.boss_name)) a.boss_name = r.boss_name;
      if (a.encounter_id == null && r.encounter_id) a.encounter_id = r.encounter_id;
      if (a.raid_night_id == null && r.raid_night_id) a.raid_night_id = r.raid_night_id;
      a.starts.add(startMs);
      a.snapshots++; if (rank === 1) a.top1++; if (rank <= 3) a.top3++;
      if (rank < a.best) a.best = rank; if (rank > a.worst) a.worst = rank;
      a.sumRank += rank; a.sumField += field;
    });
  }
  const out = [];
  for (const a of agg.values()) {
    const avgField = _avg2(a.sumField, a.snapshots);
    if (a.boss_name == null && !(avgField >= minGroup)) continue;
    const iso = new Date(a.startMs).toISOString();
    out.push({
      guild_id: a.guild_id, boss_name_key: a.boss_name_key, started_at_key: iso, character_name: a.character_name,
      boss_name: a.boss_name, encounter_id: a.encounter_id, raid_night_id: a.raid_night_id, started_at: iso,
      fights_counted: a.starts.size, snapshots: a.snapshots, times_top1: a.top1, times_top3: a.top3,
      best_rank: a.best, worst_rank: a.worst, avg_rank: _avg2(a.sumRank, a.snapshots), avg_field: avgField,
    });
  }
  return out;
}

// A trash night is ONE row per character no matter how many files fed it: fold this file's row into the
// night's existing row. The averages are rebuilt from avg * snapshots, so they carry the two-decimal rounding
// of what was stored (the nightly SQL rollup, while it still runs, recomputes the night exactly).
function mergeRank(existing, add) {
  if (!existing) return add;
  const n = existing.snapshots + add.snapshots;
  const avg = (ea, aa) => Math.round(((_num(ea) * existing.snapshots + _num(aa) * add.snapshots) / n) * 100) / 100;
  return {
    ...add,
    encounter_id: add.encounter_id || existing.encounter_id || null,
    raid_night_id: add.raid_night_id || existing.raid_night_id || null,
    fights_counted: _num(existing.fights_counted) + add.fights_counted,
    snapshots: n,
    times_top1: existing.times_top1 + add.times_top1,
    times_top3: existing.times_top3 + add.times_top3,
    best_rank: Math.min(existing.best_rank, add.best_rank),
    worst_rank: Math.max(existing.worst_rank, add.worst_rank),
    avg_rank: avg(existing.avg_rank, add.avg_rank),
    avg_field: avg(existing.avg_field, add.avg_field),
  };
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────
// deps: now(), log(msg), putObject(path, buf), getObject(path), putIndex(record), putRanks(fight, rows),
//       listIndex({guild, loMs, hiMs}), config overrides.
function createStore(deps = {}) {
  const cfg = { ...DEFAULTS, ...(deps.config || {}) };
  const now = deps.now || Date.now;
  const log = deps.log || ((m) => console.log(m));
  const fights = [];
  let timer = null;
  let heldBytes = 0;
  const stored = new Map();             // path → { at, parsed } small cache of files read back

  function remove(f) {
    const i = fights.indexOf(f);
    if (i >= 0) { fights.splice(i, 1); heldBytes -= f.bytes; }
  }
  function find(guild, bossKey, refMs) {
    for (let i = fights.length - 1; i >= 0; i--) {
      const f = fights[i];
      if (f.guild !== guild || f.bossKey !== bossKey || f.full) continue;
      if (bossKey === '' || Math.abs(f.anchorMs - refMs) <= GROUP_WINDOW_MS) return f;
    }
    return null;
  }
  function evict(keep) {
    while (fights.length > cfg.maxFights || heldBytes > cfg.maxBytes) {
      const others = fights.filter((f) => f !== keep && !f.inflight);
      const victim = others.find((f) => f.state === 'done') || others[0];
      if (!victim) return;
      log(`[fight-files] memory bound: dropped ${victim.state} fight "${victim.boss || 'trash'}" (${victim.rows.size} rows`
        + `${victim.state === 'done' ? ', already written' : ', NOT written'})`);
      remove(victim);
    }
  }

  function add(row) {
    if (!row || !row.uploader) return false;
    const snapMs = Date.parse(row.snapshot_at);
    if (!Number.isFinite(snapMs)) return false;
    const startMs = Date.parse(row.started_at);
    const refMs = Number.isFinite(startMs) ? startMs : snapMs;
    const bossKey = row.boss_name ? String(row.boss_name).toLowerCase() : '';
    let f = find(row.guild_id, bossKey, refMs);
    if (!f) {
      f = {
        guild: row.guild_id, bossKey, boss: row.boss_name || null, anchorMs: refMs, firstSnapMs: snapMs,
        rows: new Map(), bytes: 0, lastAt: now(), state: 'open', full: false,
        path: filePath(row.guild_id, row.boss_name, refMs, snapMs),
        uploaded: false, indexed: false, ranked: false, rankedOnce: false,
        attempts: 0, nextAt: 0, failed: false, inflight: null, dirty: false, doneAt: 0,
      };
      fights.push(f);
    }
    const k = `${row.uploader}\u0000${row.boss_name || ''}\u0000${snapMs}`;
    const old = f.rows.get(k);
    const size = JSON.stringify(row.per_player || {}).length + 200;
    if (old) { f.bytes -= old.size; heldBytes -= old.size; }
    f.rows.set(k, { row, snapMs, startMs: Number.isFinite(startMs) ? startMs : null, size });
    f.bytes += size; heldBytes += size;
    f.lastAt = now();
    if (f.state === 'done') {
      // a straggler for a fight already written: write it again (same path, upsert)
      f.state = 'open'; f.uploaded = false; f.indexed = false; f.ranked = false; f.attempts = 0; f.failed = false;
    } else if (f.state === 'closing') {
      f.dirty = true;
    }
    if (f.rows.size >= cfg.maxRowsPerFight && f.state === 'open') { f.full = true; close(f); }
    evict(f);
    start();
    return true;
  }

  function close(f) { f.state = 'closing'; f.nextAt = 0; void flush(f); }

  function fileRows(f) {
    return [...f.rows.values()].sort((a, b) => a.snapMs - b.snapMs).map((e) => e.row);
  }
  function describe(f) {
    const rows = fileRows(f);
    const ups = [...new Set(rows.map((r) => r.uploader))];
    const header = {
      v: 1, guild_id: f.guild, boss_name: f.boss, started_at: new Date(f.anchorMs).toISOString(),
      ended_at: new Date(Math.max(...[...f.rows.values()].map((e) => e.snapMs))).toISOString(),
      uploaders: ups, rows: rows.length,
    };
    return { rows, header, ups };
  }

  function flush(f) {
    if (f.inflight) return f.inflight;
    f.inflight = (async () => {
      f.state = 'closing';
      try {
        const { rows, header, ups } = describe(f);
        if (!f.uploaded) {
          const buf = await encodeFile(header, rows);
          await deps.putObject(f.path, buf);
          f.uploaded = true; f.fileBytes = buf.length;
        }
        if (!f.indexed) {
          await deps.putIndex({
            guild_id: f.guild, boss_name: f.boss, started_at: header.started_at, ended_at: header.ended_at,
            path: f.path, uploaders: ups, rows: rows.length, bytes: f.fileBytes || 0,
            encounter_id: (rows.find((r) => r.encounter_id) || {}).encounter_id || null,
            raid_night_id: (rows.find((r) => r.raid_night_id) || {}).raid_night_id || null,
          });
          f.indexed = true;
        }
        if (!f.ranked) {
          // Trash folds into the night's row, so a second write of the same file must not count it twice.
          if (!(f.bossKey === '' && f.rankedOnce)) await deps.putRanks(f, rankRows(rows), f.bossKey === '');
          f.ranked = true; f.rankedOnce = true;
        }
        f.state = 'done'; f.doneAt = now(); f.attempts = 0;
        log(`[fight-files] wrote ${f.path} (${rows.length} rows, ${f.fileBytes} bytes)`);
      } catch (err) {
        f.attempts++;
        const wait = Math.min(cfg.retryMaxMs, cfg.retryBaseMs * 2 ** (f.attempts - 1));
        f.nextAt = now() + wait;
        if (f.attempts >= cfg.maxAttempts) {
          f.failed = true; f.doneAt = now();
          log(`[fight-files] giving up on ${f.path} after ${f.attempts} tries (${err && err.message}); the rows stay in memory until evicted`);
        } else {
          log(`[fight-files] write of ${f.path} failed (${err && err.message}); retry ${f.attempts}/${cfg.maxAttempts} in ${Math.round(wait / 1000)}s`);
        }
      } finally {
        f.inflight = null;
        if (f.dirty) {
          f.dirty = false;
          if (f.state === 'done') { f.state = 'open'; f.uploaded = false; f.indexed = false; f.ranked = false; }
          else if (f.state === 'closing') { f.uploaded = false; f.indexed = false; f.ranked = false; }
        }
      }
    })();
    return f.inflight;
  }

  function tick() {
    const t = now();
    for (const f of fights.slice()) {
      if (f.inflight) continue;
      if (f.state === 'open' && t - f.lastAt >= cfg.idleMs) close(f);
      else if (f.state === 'closing' && !f.failed && f.nextAt <= t) void flush(f);
      else if ((f.state === 'done' || f.failed) && t - f.doneAt >= cfg.retainMs) remove(f);
    }
    for (const [p, v] of stored) if (t - v.at > 5 * 60_000) stored.delete(p);
    if (!fights.length && timer) { clearInterval(timer); timer = null; }
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, cfg.tickMs);
    if (timer.unref) timer.unref();
  }

  // SIGTERM: every fight not yet written is written now, one try each, inside the shutdown drain window.
  async function flushAll() {
    const pending = [];
    for (const f of fights) {
      if (f.state === 'done' && !f.dirty) continue;
      if (f.state === 'open') { f.state = 'closing'; f.nextAt = 0; }
      pending.push(flush(f));
    }
    await Promise.allSettled(pending);
  }

  // Memory twin of live_damage_snapshots(): same filters, newest first, at most 400.
  function liveRows({ guild, boss, sinceMs, loMs = null, hiMs = null }) {
    const want = String(boss || '').toLowerCase();
    const out = [];
    for (const f of fights) {
      if (f.guild !== guild || f.bossKey !== want || !want) continue;
      for (const e of f.rows.values()) {
        if (e.snapMs < sinceMs) continue;
        if (loMs != null && !(e.startMs != null && e.startMs >= loMs)) continue;
        if (hiMs != null && !(e.startMs != null && e.startMs <= hiMs)) continue;
        out.push(e);
      }
    }
    out.sort((a, b) => b.snapMs - a.snapMs);
    return out.slice(0, 400).map((e) => ({ uploader: e.row.uploader, snapshot_at: new Date(e.snapMs).toISOString(), per_player: e.row.per_player }));
  }

  // The files twin, for a fight older than the memory window (mode 2 has no rows to fall back on).
  async function readStoredFight({ guild, boss, loMs, hiMs }) {
    const want = String(boss || '').toLowerCase();
    let idx;
    try { idx = await deps.listIndex({ guild, loMs: loMs - 10 * 60_000, hiMs: hiMs + 10 * 60_000 }); } catch { return []; }
    const rows = [];
    for (const rec of Array.isArray(idx) ? idx : []) {
      if (String(rec.boss_name || '').toLowerCase() !== want) continue;
      let parsed = stored.get(rec.path);
      if (!parsed) {
        try {
          const buf = await deps.getObject(rec.path);
          parsed = { at: now(), parsed: await decodeFile(buf) };
          stored.set(rec.path, parsed);
          if (stored.size > 4) stored.delete(stored.keys().next().value);
        } catch (err) { log(`[fight-files] read of ${rec.path} failed: ${err && err.message}`); continue; }
      }
      for (const r of parsed.parsed.rows) {
        const st = Date.parse(r.started_at);
        if (!(st >= loMs && st <= hiMs)) continue;
        rows.push({ uploader: r.uploader, snapshot_at: r.snapshot_at, per_player: r.per_player });
      }
    }
    rows.sort((a, b) => Date.parse(b.snapshot_at) - Date.parse(a.snapshot_at));
    return rows.slice(0, 400);
  }

  function stats() {
    return { fights: fights.length, rows: fights.reduce((n, f) => n + f.rows.size, 0), bytes: heldBytes,
      open: fights.filter((f) => f.state === 'open').length, pending: fights.filter((f) => f.state === 'closing').length };
  }
  function _stop() { if (timer) clearInterval(timer); timer = null; }

  return { add, tick, flushAll, liveRows, readStoredFight, stats, _stop, _fights: fights };
}

// ── the real storage + database client ──────────────────────────────────────────────────────────────────
function _storageHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...(extra || {}) };
}
function _storageEnabled() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }

function defaultDeps(fetchImpl) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const supabase = () => require('./supabase');
  const RANK_CONFLICT = 'guild_id,boss_name_key,started_at_key,character_name';
  return {
    async putObject(path, buf) {
      if (!_storageEnabled()) throw new Error('storage not configured');
      const res = await doFetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encPath(path)}`, {
        method: 'POST',
        headers: _storageHeaders({ 'Content-Type': 'application/gzip', 'x-upsert': 'true' }),
        body: buf, signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`storage ${res.status} ${(await res.text()).slice(0, 160)}`);
    },
    async getObject(path) {
      if (!_storageEnabled()) throw new Error('storage not configured');
      const res = await doFetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${encPath(path)}`, {
        headers: _storageHeaders(), signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`storage ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async putIndex(rec) {
      const ok = await supabase().upsert('fight_snapshot_files', [rec], 'guild_id,path', { minimal: true, confirm: true });
      if (!ok) throw new Error('index upsert failed');
    },
    async listIndex({ guild, loMs, hiMs }) {
      const q = `guild_id=eq.${encodeURIComponent(guild)}`
        + `&started_at=gte.${encodeURIComponent(new Date(loMs).toISOString())}`
        + `&started_at=lte.${encodeURIComponent(new Date(hiMs).toISOString())}&select=path,boss_name,started_at&limit=50`;
      return (await supabase().select('fight_snapshot_files', q)) || [];
    },
    // rows: this file's rank rows. A trash night is one row per character, so they are folded into what is there.
    async putRanks(fight, rows, isTrash) {
      if (!rows.length) return;
      const sb = supabase();
      let out = rows;
      if (isTrash) {
        out = [];
        for (const r of rows) {
          const q = `guild_id=eq.${encodeURIComponent(r.guild_id)}&boss_name_key=eq.${encodeURIComponent(r.boss_name_key)}`
            + `&started_at_key=eq.${encodeURIComponent(r.started_at_key)}&character_name=eq.${encodeURIComponent(r.character_name)}&select=*&limit=1`;
          const ex = await sb.select('encounter_threat_rank', q);
          if (ex == null) throw new Error('rank read failed');
          out.push(mergeRank(ex[0] || null, r));
        }
      }
      // PostgREST fills a key a row lacks with NULL, so rows missing the optional ids go in their own batch.
      const batches = new Map();
      const at = new Date().toISOString();
      for (const r of out) {
        const o = { ...r, rolled_up_at: at };
        if (!o.encounter_id) delete o.encounter_id;
        if (!o.raid_night_id) delete o.raid_night_id;
        const sig = `${'encounter_id' in o}${'raid_night_id' in o}`;
        if (!batches.has(sig)) batches.set(sig, []);
        batches.get(sig).push(o);
      }
      for (const b of batches.values()) {
        const ok = await sb.upsert('encounter_threat_rank', b, RANK_CONFLICT, { minimal: true, confirm: true });
        if (!ok) throw new Error('rank upsert failed');
      }
    },
  };
}

let _store = null;
function getStore() {
  if (!_store) _store = createStore(defaultDeps());
  return _store;
}
function _resetStore() { if (_store) _store._stop(); _store = null; }

module.exports = {
  BUCKET, GROUP_WINDOW_MS, TRASH_KEY, DEFAULTS,
  filePath, encodeFile, decodeFile, nightStartMs, rankRows, mergeRank,
  createStore, defaultDeps, getStore, _resetStore,
};
