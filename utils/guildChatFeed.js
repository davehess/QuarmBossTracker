// utils/guildChatFeed.js — an in-memory ring of the guild's recent /gu and /rs chat, served to Mimic's Chat
// overlay so a player who is NOT in game can still read the guild (the guild lead picked this shape,
// 2026-10-15). Fed by the chat ingest handler (POST /api/agent/chat) after its own dedup; read by
// GET /api/agent/guild-chat?since=<seq>&boot=<boot>.
//
// PRIVACY: an ALLOW-LIST of exactly two channels, 'guild' and 'raid'. Officer chat, tells, group and custom
// channels are never uploaded by the agent, and anything else handed to note() is dropped here as well, so a
// future upload path cannot widen what this ring serves.
//
// Memory only, by design: nothing durable lives here (the chat_messages table is the record). `boot` is a
// random id made once per process; a client holding a cursor from an older process sends the old boot, the
// route treats that as since=0, and the client re-reads the ring instead of waiting for a seq that restarted.

'use strict';

const crypto = require('crypto');

const RING_MAX = 300;
const DEDUPE_MS = 2000;
const MAX_LIMIT = 200;
const CHANNELS = new Set(['guild', 'raid']);

let boot = crypto.randomBytes(6).toString('hex');
let seq = 0;
let ring = [];   // oldest first

// Same line, different uploaders: case, spacing and punctuation differ between copies (the chat handler's
// own dedup is punctuation-insensitive for the same reason), so compare on letters and digits only.
function _norm(s) {
  const lower = String(s).toLowerCase();
  const alnum = lower.replace(/[^a-z0-9]+/g, ' ').trim();
  return alnum || lower.replace(/\s+/g, ' ').trim();
}

// Store one line. Returns the stored entry, or null when it was dropped (wrong channel, malformed, duplicate).
function note(line) {
  if (!line || !CHANNELS.has(line.ch)) return null;
  const who = typeof line.who === 'string' ? line.who.trim().slice(0, 64) : '';
  const text = typeof line.text === 'string' ? line.text.trim().slice(0, 400) : '';
  if (!who || !text) return null;
  const tn = Number(line.t);
  const t = Number.isFinite(tn) && tn > 0 ? Math.round(tn) : Date.now();

  const key = _norm(who) + '|' + _norm(text);
  for (let i = ring.length - 1; i >= 0; i--) {
    const e = ring[i];
    if (e.ch === line.ch && e._k === key && Math.abs(e.t - t) <= DEDUPE_MS) return null;
  }
  const entry = { seq: ++seq, t, ch: line.ch, who, text };
  Object.defineProperty(entry, '_k', { value: key, enumerable: false });   // dedupe key, never serialized
  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  return entry;
}

// Lines with seq > the given cursor, oldest first, at most `limit` (1..200, default 200).
function since(afterSeq, limit) {
  const a = Number(afterSeq);
  const after = Number.isFinite(a) && a > 0 ? Math.floor(a) : 0;
  const l = Number(limit);
  const cap = Number.isFinite(l) && l >= 1 ? Math.min(Math.floor(l), MAX_LIMIT) : MAX_LIMIT;
  const lines = [];
  for (const e of ring) {
    if (e.seq <= after) continue;
    lines.push({ seq: e.seq, t: e.t, ch: e.ch, who: e.who, text: e.text });
    if (lines.length >= cap) break;
  }
  return { boot, seq, lines };
}

// Seed the ring from chat_messages rows { ts, channel, speaker, text } (channel values stored there are
// already 'guild' / 'raid'). Oldest first, through note() so the allow-list and dedupe apply. Returns the
// number stored.
function preload(rows) {
  if (!Array.isArray(rows)) return 0;
  const mapped = [];
  for (const r of rows) {
    if (!r) continue;
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    mapped.push({ t, ch: r.channel, who: r.speaker, text: r.text });
  }
  mapped.sort((a, b) => a.t - b.t);
  let n = 0;
  for (const m of mapped) if (note(m)) n++;
  return n;
}

// How many PLAYERS are in game right now and feeding the guild (the Chat overlay's "nobody is in game" note).
// Input is the bot's reporter-heartbeat registry as [discordId, entry] pairs (one entry per PLAYER's Mimic;
// entry = { last_seen, last_line_ms, camping }). Counted in players, never characters: one Discord id is one
// player however many characters it plays, and an id seen twice counts once.
//   in game = heartbeat newer than ttlMs, not camping, and a log line within lineMs. last_line_ms is the age
//   of the newest line at heartbeat time, so it is projected forward by the time since the heartbeat; a
//   missing last_line_ms proves nothing, so it does not count.
function countInGame(entries, now, opts = {}) {
  const ttlMs = opts.ttlMs > 0 ? opts.ttlMs : 60_000;
  const lineMs = opts.lineMs > 0 ? opts.lineMs : 180_000;
  const ids = new Set();
  for (const pair of (entries || [])) {
    if (!Array.isArray(pair)) continue;
    const [id, e] = pair;
    if (id == null || !e || e.camping) continue;
    const seen = Number(e.last_seen) || 0;
    if (now - seen > ttlMs) continue;
    if (!Number.isFinite(e.last_line_ms) || e.last_line_ms < 0) continue;
    if (e.last_line_ms + Math.max(0, now - seen) >= lineMs) continue;
    ids.add(String(id));
  }
  return ids.size;
}

function currentBoot() { return boot; }

function _resetForTest() {
  ring = [];
  seq = 0;
  boot = crypto.randomBytes(6).toString('hex');
}

module.exports = { note, since, preload, countInGame, currentBoot, _resetForTest, RING_MAX, DEDUPE_MS, MAX_LIMIT };
