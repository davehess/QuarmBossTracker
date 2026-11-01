// uiSync.js — the pure parts of UI Studio's "Keep in sync" (the guild lead, 2026-11-01: "add options to keep them
// up to date whenever signed out, and set the current machines expectations for screen size").
//
// main.js owns the timing (a backup after a character camps, a check for a newer copy from another PC) and the
// writes; this file holds the decisions so they can be tested without Electron:
//   - what an automatic backup leaves out (chat-channel passwords),
//   - whether a bundle changed since the last automatic backup,
//   - which cloud backup counts as "a newer copy from another PC",
//   - the overlay size this PC's screen suggests.
'use strict';

const crypto = require('crypto');

const AUTO_LABEL = 'Auto: after camp';
const NEWER_MODES = ['ask', 'quiet', 'never'];
// What a newer copy from another PC brings over unless the member picks otherwise. Keybinds are shared by every
// character on a PC, so they stay off until asked for.
const DEFAULT_SYNC_PARTS = ['layout', 'hotkeys', 'socials', 'spellsets', 'zeal', 'other'];

const SECRET_RX = /ChannelAutoJoin|password/i;

// An automatic backup runs without anyone looking, so it never carries a chat-channel password: in eqclient.ini
// and zeal.ini every key (and every whole section) named for channel auto-join or a password is left out. The
// files a member backs up by hand are untouched; this is only for the camp-time copy.
function redactForAutoBackup(files) {
  const out = {};
  for (const [name, text] of Object.entries(files || {})) {
    if (typeof text !== 'string') continue;
    if (!/^(eqclient|zeal)\.ini$/i.test(name)) { out[name] = text; continue; }
    let skipSection = false;
    const kept = [];
    for (const line of text.split(/(?<=\n)/)) {
      const sec = /^\s*\[([^\]]+)\]/.exec(line);
      if (sec) { skipSection = SECRET_RX.test(sec[1]); if (!skipSection) kept.push(line); continue; }
      if (skipSection) continue;
      const kv = /^\s*([^=;#\s][^=]*?)\s*=/.exec(line);
      if (kv && SECRET_RX.test(kv[1])) continue;
      kept.push(line);
    }
    out[name] = kept.join('');
  }
  return out;
}

// Same files, same text → same hash, whatever order they were read in.
function bundleHash(files) {
  const h = crypto.createHash('sha1');
  for (const name of Object.keys(files || {}).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    h.update(name.toLowerCase()); h.update('\0'); h.update(String(files[name])); h.update('\0');
  }
  return h.digest('hex');
}

// The newest backup made on ANOTHER computer after sync was turned on and after this PC last synced, that this PC
// has not already offered. Backups with no computer name are skipped: without one, "another PC" cannot be told
// from this one. `snapshots` is the bot's list (newest first, but sorted again here).
function newerElsewhere(snapshots, { machine, since, lastSyncAt, seenId } = {}) {
  const me = String(machine || '').toLowerCase();
  const floor = Math.max(Number(since) || 0, Number(lastSyncAt) || 0);
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s && s.id && s.machine_name && String(s.machine_name).toLowerCase() !== me)
    .map(s => ({ s, t: Date.parse(s.created_at) || 0 }))
    .filter(r => r.t > floor)
    .sort((a, b) => b.t - a.t);
  if (!rows.length || rows[0].s.id === seenId) return null;
  return rows[0].s;
}

// The overlay scale this screen suggests. Overlays were laid out on a 24-inch 1920×1080 screen at Windows' 100%
// (about 92 pixels to the inch). Electron already sizes windows in Windows-scaled pixels, so a 4K screen at 150%
// needs nothing more; a sharper screen at 100% does. With the screen's size known, match its sharpness; without
// it, go halfway towards the resolution's ratio, which is right for the common 27-inch 1440p case.
function suggestScale({ width, height, scaleFactor = 1, inches = null } = {}) {
  const sf = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
  const w = Number(width) / sf, h = Number(height) / sf;
  if (!(w > 0 && h > 0)) return null;
  let raw, why;
  const inch = Number(inches);
  if (inch >= 10 && inch <= 100) {
    const ppi = Math.sqrt(w * w + h * h) / inch;
    raw = ppi / 92;
    why = `${inch} in at ${Math.round(width)}×${Math.round(height)}${sf !== 1 ? ` (Windows ${Math.round(sf * 100)}%)` : ''} is ${raw >= 1.05 ? 'sharper' : raw <= 0.95 ? 'softer' : 'about as sharp'} than the 24 in 1080p screen overlays were made on`;
  } else {
    raw = 1 + (h / 1080 - 1) / 2;
    why = `${Math.round(width)}×${Math.round(height)}${sf !== 1 ? ` at Windows ${Math.round(sf * 100)}%` : ''}; add the screen's size for a closer fit`;
  }
  const scale = Math.max(0.8, Math.min(1.6, Math.round(raw * 20) / 20));
  return { scale, percent: Math.round(scale * 100), why };
}

function cleanSyncCfg(c) {
  const v = c && typeof c === 'object' ? c : {};
  const parts = Array.isArray(v.parts) ? v.parts.filter(p => typeof p === 'string' && /^[a-z]{2,12}$/.test(p)) : DEFAULT_SYNC_PARTS.slice();
  return {
    autoBackup: v.autoBackup === true,
    newer: NEWER_MODES.includes(v.newer) ? v.newer : 'ask',
    parts,
    since: Number(v.since) || 0,
  };
}

module.exports = { AUTO_LABEL, NEWER_MODES, DEFAULT_SYNC_PARTS, redactForAutoBackup, bundleHash, newerElsewhere, suggestScale, cleanSyncCfg };
