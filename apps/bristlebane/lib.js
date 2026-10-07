// apps/bristlebane/lib.js — the parts of Bristlebane with no Discord in them: config, the join/leave
// rule, the consent list, the recording writer, deleting what was recorded, and the texts it posts.
// index.js is the glue that feeds these from the gateway and the voice connection. Node built-ins only, so
// the repo's vitest suite can load this file without apps/bristlebane/node_modules being installed
// (test/bristlebane.test.js).
//
// RECORDING IS OPT-IN ONLY (the guild lead, 2026-10-05: "we don't need to have voices in from those that
// don't consent"). Nobody is recorded until they run /bristlebane optin; there is deliberately no mode that
// records everyone who has not objected.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── Config ───────────────────────────────────────────────────────────────────

const RECORD_MODES = ['off', 'optin'];

// ── guild/discord.json → unset env (the guild kit) ──────────────────────────
// Resolution order is environment → guild/discord.json → built-in default, and env always wins, so a
// deployment that sets every id in its environment (Wolf Pack's) behaves exactly as it did before the file
// layer existed. The loader is the main bot's (index.js at the repo root), copied rule for rule: fill only
// keys the environment leaves unset or blank, stringify values, join arrays with commas, skip `_` keys and
// nulls, refuse secret-shaped keys with a warning, and treat a missing or invalid file as "nothing to do".
//
// loadConfig narrows it to the four Discord ids below. BOT_API_URL and SCREEN_URL are deployment values and
// BOT_API_KEY is a secret, so those three stay env-only even if someone writes them into the file.
const GUILD_FILE_KEYS = ['DISCORD_GUILD_ID', 'RAID_VOICE_CHANNEL_ID', 'RAID_CHAT_CHANNEL_ID', 'OFFNIGHT_VOICE_CHANNEL_ID'];
const DEFAULT_GUILD_FILE = path.join(__dirname, '..', '..', 'guild', 'discord.json');

/**
 * Fill `env` (modified in place) from the JSON file at `file`. `only`, when given, is a list of the only
 * keys it may fill; the secret-shaped check still looks at every key in the file. Returns
 * { filled, skipped, refused }: keys set from the file, keys left alone because env already had a value,
 * and secret-shaped keys it would not read. Logs key names only, never values.
 */
function fillEnvFromGuildFile(env, file = DEFAULT_GUILD_FILE, only = null) {
  const out = { filled: [], skipped: [], refused: [] };
  let raw;
  // No file → nothing to do, and silently (the absent default path is the normal case). A path that exists but
  // cannot be read as a file is a mistake worth a line: a directory (EISDIR — what Docker makes of a mistyped
  // `-v` host path) or a file the process may not open (EACCES).
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[guild] ${file} could not be read (${e.code}) — ignored`);
    return out;
  }
  let obj;
  // Position only, never e.message: Node's parse error quotes a snippet of the file, which could be a value.
  try { obj = JSON.parse(raw); }
  catch (e) {
    const at = (String(e.message).match(/position \d+/) || [''])[0];
    console.warn(`[guild] ${file} is not valid JSON — ignored (${e.name}${at ? ' at ' + at : ''})`);
    return out;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.warn(`[guild] ${file} is not a JSON object — ignored`);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_') || v == null) continue;                      // _comment, nulls
    if (/SPEC|TOKEN|KEY|SECRET|PASSWORD/.test(k)) { out.refused.push(k); continue; }
    if (only && !only.includes(k)) continue;
    if (env[k] != null && String(env[k]).trim() !== '') { out.skipped.push(k); continue; }
    // A JSON number past 2^53 has already been rounded by JSON.parse, so String(v) would hand Discord a wrong id.
    if (typeof v === 'number' && !Number.isSafeInteger(v)) {
      console.warn(`[guild] ${file}: ${k} is a number too large to keep exactly — write ids as strings`);
      continue;
    }
    env[k] = Array.isArray(v) ? v.join(',') : String(v);
    out.filled.push(k);
  }
  if (out.refused.length) console.warn(`[guild] ${file}: refused secret-shaped key(s) ${out.refused.join(', ')} — secrets belong in the environment, never in a committed file`);
  if (out.filled.length) console.log(`[guild] ${file} filled ${out.filled.length} unset id(s): ${out.filled.join(', ')}`);
  return out;
}

/**
 * Read the service's settings from an env object. Throws one Error naming EVERY problem, so a bad
 * deploy is fixed in one pass instead of one variable per crash loop.
 *
 * The four Discord ids (GUILD_FILE_KEYS) may come from the guild file when env leaves them unset. Which file:
 * `guildFile` if given, else BRISTLEBANE_GUILD_FILE, else guild/discord.json at the repo root. `env` itself is
 * never modified. The Docker image is built from apps/bristlebane alone and cannot see the repo's guild/
 * folder, so a container points BRISTLEBANE_GUILD_FILE at a mounted copy (README).
 */
function loadConfig(env, guildFile) {
  const e = { ...env };
  const explicit = guildFile || String(e.BRISTLEBANE_GUILD_FILE ?? '').trim();
  if (explicit && !fs.existsSync(explicit)) console.warn(`[guild] ${explicit} does not exist — no ids read from a file`);
  fillEnvFromGuildFile(e, explicit || undefined, GUILD_FILE_KEYS);

  const problems = [];
  const need = (k) => {
    const v = String(e[k] ?? '').trim();
    if (!v) problems.push(`${k} is not set`);
    return v;
  };
  const opt = (k) => String(e[k] ?? '').trim() || null;

  const cfg = {
    token: need('BRISTLEBANE_TOKEN'),
    guildId: need('DISCORD_GUILD_ID'),
    appId: opt('BRISTLEBANE_APP_ID'),                           // optional: the bot's own user id is the application id
    raidVoiceChannelId: need('RAID_VOICE_CHANNEL_ID'),
    offnightVoiceChannelId: opt('OFFNIGHT_VOICE_CHANNEL_ID'),   // reserved: phase 1 never joins it
    raidChatChannelId: opt('RAID_CHAT_CHANNEL_ID'),
    apiUrl: need('BOT_API_URL').replace(/\/+$/, ''),
    apiKey: need('BOT_API_KEY'),                                // = BRISTLEBANE_API_KEY on the main bot
    recordMode: (opt('RECORD_MODE') || 'optin').toLowerCase(),
    recordingsDir: opt('RECORDINGS_DIR') || '/data/recordings',
    screenUrl: opt('SCREEN_URL'),                               // optional: the raid screen page, linked in the join notice
    pollMs: 30_000,
  };
  if (cfg.screenUrl && !/^https:\/\/[^\s]+$/.test(cfg.screenUrl)) {
    problems.push(`SCREEN_URL must be a full https:// address (got "${cfg.screenUrl}")`);
  }
  if (!RECORD_MODES.includes(cfg.recordMode)) {
    problems.push(`RECORD_MODE must be one of ${RECORD_MODES.join(' | ')} (got "${cfg.recordMode}")`
      + (cfg.recordMode === 'optout' ? ' — recording is opt-in only; there is no opt-out mode' : ''));
  }
  const secs = parseInt(e.POLL_SECONDS, 10);
  if (Number.isFinite(secs)) cfg.pollMs = Math.min(300, Math.max(5, secs)) * 1000;
  if (problems.length) throw new Error('bad configuration: ' + problems.join('; '));
  return cfg;
}

// ── The raid-live answer ─────────────────────────────────────────────────────

/**
 * GET /api/agent/raid-live → the shape decide() reads. Anything that is not a JSON object is "unreachable":
 * a proxy's HTML error page must never read as "not live".
 */
function normalizePoll(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'not a JSON object' };
  return {
    ok: true,
    live: body.live === true,
    ended: body.ended === true,
    placed: Number.isFinite(Number(body.placed)) ? Number(body.placed) : 0,
    nightKey: typeof body.nightKey === 'string' ? body.nightKey : null,
    inWindow: body.inWindow === true,
  };
}

// ── The join / leave rule ────────────────────────────────────────────────────
//
//   JOIN   (not in the channel): the raid reads live on JOIN_AFTER_LIVE_POLLS polls in a row, it has not
//          been ended by an officer, AND at least one human is in the raid voice channel.
//   LEAVE  (in the channel), the first that applies:
//            • an officer ended the raid                                   → 'ended'
//            • the bot API has been unreachable for 10 minutes             → 'api unreachable 10m'
//            • the raid has read not-live for 10 minutes straight          → 'not live 10m'
//            • the channel has held no human for 5 minutes straight        → 'no humans 5m'
//
// "Live" is the bot's own call (placed raiders >= RAID_TRACK_MIN_PLACED); `ended` is the officer's End raid
// button. The roster stays live after End raid — everyone is still logged in — so an ended night must also
// block the JOIN, or the bot would walk straight back in after leaving.
//
// An unreachable API changes nothing on its own: it never joins, and a bot already in the channel keeps its
// not-live and empty-channel clocks where they were and stays up to 10 minutes, so a bot restart on a raid
// night does not drop the voice channel.

const JOIN_AFTER_LIVE_POLLS = 2;
const LEAVE_NOT_LIVE_MS = 10 * 60_000;
const LEAVE_EMPTY_MS = 5 * 60_000;
const LEAVE_UNREACHABLE_MS = 10 * 60_000;

function initialState() {
  return { joined: false, liveStreak: 0, notLiveSince: null, emptySince: null, unreachableSince: null };
}

/**
 * One decision. Pure: `state` is not modified; the next state comes back with the answer.
 * poll   = { ok, live, ended } (normalizePoll; { ok: false } when the API could not be read)
 * humans = people (not bots) in the raid voice channel right now
 * now    = ms
 * Returns { action: 'join' | 'leave' | 'none', reason, state }. The state assumes the action worked; when a
 * join fails the caller goes back to initialState().
 */
function decide(state, poll, humans, now) {
  const s = { ...state };
  const ok = !!(poll && poll.ok);
  const ended = ok && poll.ended === true;
  const live = ok && poll.live === true && !ended;
  const people = Number.isFinite(humans) ? humans : 0;

  if (!s.joined) {
    s.liveStreak = live ? s.liveStreak + 1 : 0;
    if (s.liveStreak < JOIN_AFTER_LIVE_POLLS) {
      const why = !ok ? 'api unreachable' : ended ? 'raid ended' : live ? `live ${s.liveStreak}/${JOIN_AFTER_LIVE_POLLS}` : 'not live';
      return { action: 'none', reason: why, state: s };
    }
    if (people < 1) return { action: 'none', reason: 'live, nobody in the channel', state: s };
    return { action: 'join', reason: 'live', state: { ...initialState(), joined: true, liveStreak: s.liveStreak } };
  }

  if (ended) return { action: 'leave', reason: 'ended', state: initialState() };

  if (!ok) {
    if (s.unreachableSince == null) s.unreachableSince = now;
  } else {
    s.unreachableSince = null;
    if (poll.live === true) s.notLiveSince = null;
    else if (s.notLiveSince == null) s.notLiveSince = now;
  }
  if (people > 0) s.emptySince = null;
  else if (s.emptySince == null) s.emptySince = now;

  let why = null;
  if (s.unreachableSince != null && now - s.unreachableSince >= LEAVE_UNREACHABLE_MS) why = 'api unreachable 10m';
  else if (s.notLiveSince != null && now - s.notLiveSince >= LEAVE_NOT_LIVE_MS) why = 'not live 10m';
  else if (s.emptySince != null && now - s.emptySince >= LEAVE_EMPTY_MS) why = 'no humans 5m';
  if (why) return { action: 'leave', reason: why, state: initialState() };
  // What is running down, so the log shows a clock starting (one line per change, see index.js)
  const holding = !ok ? 'api unreachable, holding (leaves at 10m)'
    : poll.live !== true ? 'not live (leaves at 10m)'
    : people < 1 ? 'channel empty (leaves at 5m)'
    : 'stay';
  return { action: 'none', reason: holding, state: s };
}

// ── Consent ──────────────────────────────────────────────────────────────────
// ${RECORDINGS_DIR}/../consent.json = { "optin": [userId…], "updatedAt": "<ISO>" }, kept NEXT TO the
// recordings directory rather than inside it so wiping recordings never wipes who said yes (or who said
// stop). Only the people listed are ever recorded.

const SNOWFLAKE = /^\d{5,25}$/;

function consentPath(recordingsDir) {
  return path.resolve(recordingsDir, '..', 'consent.json');
}

/** Write a file so a crash leaves the old whole file or the new whole file, never half of one. */
function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* it was never written */ }
    throw err;
  }
}

/**
 * Who has opted in. The slash commands change it, so this process holds the list and writes it through on
 * every change; load() picks up a hand edit between sessions.
 *
 * A missing file is an empty list (nobody has said yes). A file that exists but cannot be read or understood
 * leaves `error` set: nobody is recorded (shouldRecord) and optIn() refuses to write over it, so a bad edit
 * can never silently drop everyone's consent or invent anyone's. optOut() always takes effect in memory
 * first — stopping a recording must not wait on the disk — and then reports it if the file could not be saved.
 */
class ConsentStore {
  constructor(file, now = Date.now) {
    this.file = file;
    this._now = now;
    this.optin = new Set();
    this.updatedAt = null;
    this.error = null;
  }

  load() {
    this.optin = new Set();
    this.updatedAt = null;
    this.error = null;
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); }
    catch (err) {
      if (!(err && err.code === 'ENOENT')) this.error = err.message;
      return this;
    }
    try {
      const j = JSON.parse(text);
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not a JSON object');
      if (j.optin != null && !Array.isArray(j.optin)) throw new Error('optin is not a list');
      for (const id of j.optin || []) this.optin.add(String(id));
      this.updatedAt = typeof j.updatedAt === 'string' ? j.updatedAt : null;
    } catch (err) {
      this.optin = new Set();
      this.error = 'consent.json: ' + err.message;
    }
    return this;
  }

  has(userId) { return !this.error && this.optin.has(String(userId)); }

  _persist(next) {
    const updatedAt = new Date(this._now()).toISOString();
    writeFileAtomic(this.file, JSON.stringify({ optin: [...next].sort(), updatedAt }, null, 2) + '\n');
    this.optin = next;
    this.updatedAt = updatedAt;
  }

  /** Opt a user in. True when that changed anything. Throws, changing nothing, when it cannot be saved. */
  optIn(userId) {
    const id = String(userId);
    if (!SNOWFLAKE.test(id)) throw new Error('not a user id');
    if (this.error) throw new Error(this.error);
    if (this.optin.has(id)) return false;
    const next = new Set(this.optin);
    next.add(id);
    this._persist(next);
    return true;
  }

  /** Opt a user out. True when they were in. Always removes them in memory; throws if the file could not be updated. */
  optOut(userId) {
    const id = String(userId);
    const was = this.optin.delete(id);
    if (this.error) throw new Error(this.error);
    if (was) this._persist(new Set(this.optin));
    return was;
  }
}

/** May this user's audio be recorded? Only in optin mode, only if they opted in, and never while the list is unreadable. */
function shouldRecord(mode, consent, userId) {
  if (mode !== 'optin') return false;
  if (!consent || consent.error) return false;
  return consent.optin.has(String(userId));
}

// ── Recording ────────────────────────────────────────────────────────────────
//
// opusraw v1, one file per speaker per session — a plain sequence of records:
//     [uint32 BE  arrival_ms_since_session_start][uint16 BE  length][length bytes of Opus]
// @discordjs/voice 0.19 hands over bare Opus payloads with no RTP header, so there is no sequence number
// or timestamp to keep: the arrival time is the only clock, and a later offline tool turns the file into a
// gap-filled Ogg Opus. Packets are stored exactly as received (including Discord's trailing silence frames).

const RECORD_HEADER_BYTES = 6;
const MAX_PAYLOAD = 0xffff;

function encodeRecord(arrivalMs, payload) {
  const at = Math.min(0xffffffff, Math.max(0, Math.round(arrivalMs)));
  const out = Buffer.allocUnsafe(RECORD_HEADER_BYTES + payload.length);
  out.writeUInt32BE(at, 0);
  out.writeUInt16BE(payload.length, 4);
  payload.copy(out, RECORD_HEADER_BYTES);
  return out;
}

/** The inverse, for tests and the offline converter: { records: [{ atMs, payload }], leftover } where leftover counts trailing bytes that are not a whole record (a crash mid-write). */
function decodeRecords(buf) {
  const records = [];
  let i = 0;
  while (i + RECORD_HEADER_BYTES <= buf.length) {
    const len = buf.readUInt16BE(i + 4);
    if (i + RECORD_HEADER_BYTES + len > buf.length) break;
    records.push({ atMs: buf.readUInt32BE(i), payload: buf.subarray(i + RECORD_HEADER_BYTES, i + RECORD_HEADER_BYTES + len) });
    i += RECORD_HEADER_BYTES + len;
  }
  return { records, leftover: buf.length - i };
}

/** "10/05/2026" (the bot's night key, MM/DD/YYYY) → "2026-10-05", which sorts; anything else is made filename-safe. */
function nightDirName(nightKey) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(nightKey || ''));
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return String(nightKey || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-night';
}

/** 2026-10-05T01:30:12Z with the colons turned to dashes so the name is safe on every filesystem. */
function fsSafeIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function sessionDir(recordingsDir, nightKey, startMs) {
  return path.join(recordingsDir, nightDirName(nightKey), fsSafeIso(startMs));
}

/**
 * One continuous stay in the voice channel. Owns the directory, one .opusraw writer per speaker and
 * session.json. `now` is injectable so tests control the clock.
 */
class SessionRecorder {
  constructor({ dir, startMs, guildId, channelId, nightKey, recordMode, now = Date.now }) {
    this.dir = dir;
    this.startMs = startMs;
    this._now = now;
    this._writers = new Map();     // userId → fs.WriteStream
    this._counts = new Map();      // userId → { packets, bytes, errors, minutePackets, minuteSpeaks }
    this._dirty = true;
    this._closed = false;
    this.meta = {
      version: 1,
      format: 'opusraw v1: repeated [uint32 BE arrival_ms_since_startedAtMs][uint16 BE length][Opus payload]',
      startedAtMs: startMs,
      startedAtIso: new Date(startMs).toISOString(),
      endedAtMs: null,
      guildId, channelId, nightKey, recordMode,
      users: {},
      events: [],
    };
    fs.mkdirSync(dir, { recursive: true });
    this.writeMeta();
  }

  _t() { return Math.max(0, this._now() - this.startMs); }

  _count(userId) {
    let c = this._counts.get(userId);
    if (!c) { c = { packets: 0, bytes: 0, errors: 0, minutePackets: 0, minuteSpeaks: 0 }; this._counts.set(userId, c); }
    return c;
  }

  /** Name a speaker in session.json. The latest name wins, so a placeholder (the id) can be upgraded once the display name is known. */
  addUser(userId, name) {
    const v = String(name || userId);
    if (this.meta.users[userId] !== v) { this.meta.users[userId] = v; this._dirty = true; }
  }

  /** join | leave | speaking-start … with its time in ms since the session started. */
  event(type, extra = {}) {
    if (this._closed) return;
    if (type === 'speaking-start' && extra.userId) this._count(extra.userId).minuteSpeaks++;
    this.meta.events.push({ t: this._t(), type, ...extra });
    this._dirty = true;
  }

  noteError(userId) { this._count(userId).errors++; }

  /** Append one Opus packet to the speaker's file. Returns false when it was not stored. */
  packet(userId, payload) {
    if (this._closed || !SNOWFLAKE.test(String(userId))) return false;
    if (!Buffer.isBuffer(payload) || payload.length === 0 || payload.length > MAX_PAYLOAD) return false;
    let w = this._writers.get(userId);
    if (!w) {
      w = fs.createWriteStream(path.join(this.dir, `${userId}.opusraw`), { flags: 'a' });
      w.on('error', (err) => { this.noteError(userId); console.warn(`[rec] write failed for ${userId}:`, err.message); });
      this._writers.set(userId, w);
    }
    w.write(encodeRecord(this._t(), payload));
    const c = this._count(userId);
    c.packets++; c.bytes += payload.length; c.minutePackets++;
    return true;
  }

  /** Per-speaker totals so far. */
  stats() {
    const out = {};
    for (const [id, c] of this._counts) out[id] = { packets: c.packets, bytes: c.bytes, errors: c.errors };
    return out;
  }

  /** The last minute's activity per speaker { packets, speaks }, then start a fresh minute. */
  rollMinute() {
    const out = {};
    for (const [id, c] of this._counts) {
      if (c.minutePackets || c.minuteSpeaks) out[id] = { packets: c.minutePackets, speaks: c.minuteSpeaks };
      c.minutePackets = 0; c.minuteSpeaks = 0;
    }
    return out;
  }

  /** Write session.json (temp file + rename, so a crash leaves the last whole one). A no-op when nothing changed. */
  writeMeta() {
    if (!this._dirty) return;
    writeFileAtomic(path.join(this.dir, 'session.json'), JSON.stringify(this.meta));
    this._dirty = false;
  }

  /**
   * Take one speaker out of THIS session entirely: close and delete their file, and drop their name and their
   * events from session.json (written straight away). The caller destroys the live stream first so nothing
   * more arrives; this keeps the recorder's in-memory copy of session.json from writing the speaker back.
   */
  async dropUser(userId) {
    const id = String(userId);
    const w = this._writers.get(id);
    this._writers.delete(id);
    if (w) {
      await new Promise((resolve) => {
        if (w.destroyed) return resolve();
        w.once('close', resolve);
        w.end();
      });
    }
    try { fs.unlinkSync(path.join(this.dir, `${id}.opusraw`)); } catch { /* none was written */ }
    delete this.meta.users[id];
    this.meta.events = this.meta.events.filter((e) => e.userId !== id);
    this._counts.delete(id);
    this._dirty = true;
    this.writeMeta();
  }

  /** Log the leave, flush every file and write the final session.json. Safe to call twice. */
  async close(reason) {
    if (this._closed) return;
    this.event('leave', reason ? { reason } : {});
    this._closed = true;
    this.meta.endedAtMs = this._now();
    this._dirty = true;
    await Promise.all([...this._writers.values()].map((w) => new Promise((resolve) => {
      if (w.destroyed) return resolve();
      w.once('close', resolve);
      w.end();
    })));
    this._writers.clear();
    this.writeMeta();
  }
}

/**
 * The five-minute watchdog line from the last few per-minute snapshots (SessionRecorder.rollMinute()):
 *   [rec] 3 users, packets/min 1001=48 1002=41 1003=0     (busiest first; each user's average per minute,
 *   a minute with no activity counting as 0)
 * plus a WARN for anyone whose speaking was seen but whose packets never arrived — what a DAVE or key
 * problem looks like from here.
 */
function formatRecSummary(snapshots) {
  const total = new Map();
  for (const snap of snapshots) {
    for (const [id, v] of Object.entries(snap)) {
      const t = total.get(id) || { packets: 0, speaks: 0 };
      t.packets += v.packets; t.speaks += v.speaks;
      total.set(id, t);
    }
  }
  const n = Math.max(1, snapshots.length);
  const rows = [...total].map(([id, t]) => ({ id, avg: Math.round(t.packets / n), speaks: t.speaks, packets: t.packets }))
    .sort((a, b) => b.avg - a.avg || a.id.localeCompare(b.id));
  let line = `[rec] ${rows.length} users, packets/min ${rows.map(r => `${r.id}=${r.avg}`).join(' ') || '-'}`;
  const dead = rows.filter(r => r.speaks > 0 && r.packets === 0);
  if (dead.length) line += ` | WARN spoke but no packets: ${dead.map(r => `${r.id}(${r.speaks})`).join(' ')}`;
  return line;
}

// ── Deleting what was recorded ───────────────────────────────────────────────

/**
 * Remove one person from the recordings on disk: their <userId>.opusraw in every session folder, and their
 * name and events from that folder's session.json. Walks RECORDINGS_DIR/<night>/<session>/.
 *   nights  null = every night (/bristlebane forget); an array of night folder names = only those
 *           (/bristlebane optout deletes "tonight"); an empty array deletes nothing.
 * Returns { files, sessions, errors }: audio files removed, session.json files rewritten, things it could not
 * read or remove. A session.json it cannot parse is left alone and counted, never overwritten.
 * The session being recorded right now is handled by SessionRecorder.dropUser (it holds its own copy of
 * session.json, which would otherwise write the person straight back) — call that first.
 */
function forgetUser(recordingsDir, userId, { nights = null } = {}) {
  const id = String(userId);
  if (!SNOWFLAKE.test(id)) throw new Error('not a user id');   // it becomes a file name
  const out = { files: 0, sessions: 0, errors: 0 };
  const dirsIn = (dir) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
    catch (err) { if (!(err && err.code === 'ENOENT')) out.errors++; return []; }
  };
  let nightDirs = dirsIn(recordingsDir);
  if (Array.isArray(nights)) { const want = new Set(nights); nightDirs = nightDirs.filter((n) => want.has(n)); }
  for (const night of nightDirs) {
    for (const session of dirsIn(path.join(recordingsDir, night))) {
      const dir = path.join(recordingsDir, night, session);
      try { fs.unlinkSync(path.join(dir, `${id}.opusraw`)); out.files++; }
      catch (err) { if (!(err && err.code === 'ENOENT')) out.errors++; }
      const metaFile = path.join(dir, 'session.json');
      let text;
      try { text = fs.readFileSync(metaFile, 'utf8'); }
      catch (err) { if (!(err && err.code === 'ENOENT')) out.errors++; continue; }
      try {
        const meta = JSON.parse(text);
        let changed = false;
        if (meta.users && typeof meta.users === 'object' && Object.hasOwn(meta.users, id)) { delete meta.users[id]; changed = true; }
        if (Array.isArray(meta.events)) {
          const kept = meta.events.filter((e) => !(e && e.userId === id));
          if (kept.length !== meta.events.length) { meta.events = kept; changed = true; }
        }
        if (changed) { writeFileAtomic(metaFile, JSON.stringify(meta)); out.sessions++; }
      } catch { out.errors++; }
    }
  }
  return out;
}

// ── What it says ─────────────────────────────────────────────────────────────

const BASE_NICK = 'Bristlebane';
const REC_NICK = '[REC] Bristlebane';

/**
 * The notice posted to the raid chat when the bot joins. `optedIn` of `total` is how many of the people in
 * the channel have opted in. Not recording (RECORD_MODE=off) says so and offers nothing to opt into.
 * `screenUrl` (SCREEN_URL) adds a line pointing at the raid screen page.
 */
function joinNotice({ channelId, recording, optedIn, total, screenUrl = null }) {
  const screen = screenUrl ? `\n📺 Raid screen: ${screenUrl}` : '';
  if (!recording) return `🎙 Bristlebane is in 🔊 <#${channelId}> (not recording).${screen}`;
  return `🎙 Bristlebane is in 🔊 <#${channelId}>. Recording only members who opted in — ${optedIn} of ${total} here. `
    + 'Want in? /bristlebane optin. Change your mind any time: /bristlebane optout or /bristlebane forget.' + screen;
}

/** "[REC]" only while at least one opted-in member is in the channel; otherwise the plain name. */
function desiredNick(recording, optedInHere) {
  return recording && optedInHere > 0 ? REC_NICK : BASE_NICK;
}

/** The reply to /bristlebane status. `inChannel` = the bot is in the raid channel right now. */
function statusText({ optedIn, recordMode, inChannel, channelId, optedInHere, total }) {
  const lines = [optedIn
    ? '**You:** opted in. Your voice is recorded while Bristlebane is in the raid channel and you are in it.'
    : '**You:** not opted in, so you are not recorded. `/bristlebane optin` to join.'];
  if (recordMode === 'off') lines.push('**Recording:** switched off on this deployment.');
  else if (!inChannel) lines.push('**Recording:** no — Bristlebane is not in the raid channel right now.');
  else if (optedInHere > 0) lines.push(`**Recording:** yes — Bristlebane is in <#${channelId}> recording opted-in members only.`);
  else lines.push(`**Recording:** no — Bristlebane is in <#${channelId}>, but nobody there has opted in.`);
  lines.push(`**In the channel:** ${optedInHere} of ${total} opted in.`);
  return lines.join('\n');
}

// ── The slash command ────────────────────────────────────────────────────────

/** Guild commands, as plain JSON for the REST bulk-overwrite (type 1 = subcommand). */
const COMMANDS = [{
  name: 'bristlebane',
  description: 'Bristlebane, the raid voice bot: recording is opt-in',
  options: [
    { type: 1, name: 'optin', description: 'Record my voice in the raid channel from now on' },
    { type: 1, name: 'optout', description: 'Stop recording me now and delete what was recorded of me tonight' },
    { type: 1, name: 'forget', description: 'Delete every recording of me, all nights' },
    { type: 1, name: 'status', description: 'Am I opted in, is Bristlebane recording, how many here are opted in' },
  ],
}];

/** The confirm / cancel buttons on /bristlebane forget carry who they are for, so only that person's press counts. */
function forgetButtonId(action, userId) { return `bb:forget:${action}:${userId}`; }
function parseForgetButton(customId) {
  const m = /^bb:forget:(yes|no):(\d{5,25})$/.exec(String(customId || ''));
  return m ? { action: m[1], userId: m[2] } : null;
}

module.exports = {
  RECORD_MODES, GUILD_FILE_KEYS, DEFAULT_GUILD_FILE, fillEnvFromGuildFile, loadConfig, normalizePoll,
  JOIN_AFTER_LIVE_POLLS, LEAVE_NOT_LIVE_MS, LEAVE_EMPTY_MS, LEAVE_UNREACHABLE_MS, initialState, decide,
  consentPath, ConsentStore, shouldRecord,
  RECORD_HEADER_BYTES, encodeRecord, decodeRecords, nightDirName, fsSafeIso, sessionDir, SessionRecorder,
  formatRecSummary, forgetUser,
  BASE_NICK, REC_NICK, joinNotice, desiredNick, statusText, COMMANDS, forgetButtonId, parseForgetButton,
};
