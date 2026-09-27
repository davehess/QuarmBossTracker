// utils/feedbackShots.js — screenshots on feedback and suggestions.
//
// The guild lead, 2026-09-26: "feedback and suggestion needs to be able to take screenshots..top
// priority". Every feedback path (Mimic/Parser card, the web form, roadmap suggestions, Discord
// /feedback) stores its images here, in the PRIVATE `feedback-screenshots` bucket (migration
// 20260927003234): no storage policies, so only the service role can read or write. The bot re-posts
// them to the feedback thread as real attachments; the officer page shows them via signed URLs.
//
// The client's claimed type is never trusted: the bytes are sniffed, and anything that is not a
// JPEG, PNG or WebP is dropped.

const crypto = require('crypto');

const BUCKET    = 'feedback-screenshots';
const MAX_BYTES = 5 * 1024 * 1024;   // per image; the bucket enforces the same limit
const MAX_SHOTS = 3;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// A data URL or bare base64 string → { buf, mime }, or null when it is not an acceptable image.
function decodeShot(s) {
  if (typeof s !== 'string' || !s) return null;
  const m = /^data:[^;,]{1,64};base64,/.exec(s);
  const b64 = m ? s.slice(m[0].length) : s;
  if (b64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return null;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return null;
  const mime = sniffImage(buf);
  return mime ? { buf, mime } : null;
}
function decodeShots(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_SHOTS).map(decodeShot).filter(Boolean);
}

function _storageHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...(extra || {}) };
}
function _enabled() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }

// Path: <yyyy-mm>/<source>/<time>-<random>.<ext> — no names in it.
function shotPath(source, mime, now) {
  const d = new Date(now || Date.now());
  const ym = d.toISOString().slice(0, 7);
  const src = String(source || 'x').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'x';
  return `${ym}/${src}/${d.getTime()}-${crypto.randomBytes(6).toString('hex')}.${EXT[mime]}`;
}

async function uploadShot(shot, source) {
  if (!_enabled() || !shot || !EXT[shot.mime]) return null;
  const path = shotPath(source, shot.mime);
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: _storageHeaders({ 'Content-Type': shot.mime, 'x-upsert': 'false' }),
      body: shot.buf,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { console.warn('[feedback-shots] upload failed:', res.status, (await res.text()).slice(0, 200)); return null; }
    return path;
  } catch (err) { console.warn('[feedback-shots] upload failed:', err?.message); return null; }
}
async function uploadShots(shots, source) {
  const out = [];
  for (const s of shots || []) { const p = await uploadShot(s, source); if (p) out.push(p); }
  return out;
}

async function downloadShot(path) {
  if (!_enabled() || typeof path !== 'string' || !/^[\w./-]{1,200}$/.test(path) || path.includes('..')) return null;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
      headers: _storageHeaders(), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return sniffImage(buf) ? buf : null;
  } catch { return null; }
}

// Discord attachments for stored paths (or freshly decoded shots): [{ attachment, name }].
function discordFiles(items) {
  return (items || []).map((it, i) => {
    const buf = Buffer.isBuffer(it) ? it : it && it.buf;
    const mime = sniffImage(buf);
    return mime ? { attachment: buf, name: `screenshot-${i + 1}.${EXT[mime]}` } : null;
  }).filter(Boolean);
}

module.exports = {
  BUCKET, MAX_BYTES, MAX_SHOTS,
  sniffImage, decodeShot, decodeShots, shotPath,
  uploadShot, uploadShots, downloadShot, discordFiles,
};
