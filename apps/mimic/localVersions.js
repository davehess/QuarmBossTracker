// localVersions.js — copies of files that Mimic keeps on THIS computer so a bad restore or a bad night can be undone
// without the cloud (the guild lead, 2026-11-11). Plain fs, no Electron, so a test can point it at a temp folder.
//
//   stampedCopy(dir, name)        eqclient.ini -> eqclient.ini.mimic-<YYYYMMDD-HHMMSS>.bak next to it, newest 10 kept.
//                                 Taken before ANY restore or bring-in writes, and before every write to the two files
//                                 EverQuest and Zeal share between all characters.
//   saveVersion / listVersions    a character's files copied to <root>/<char>/<YYYYMMDD-HHMMSS>/, newest 5 kept,
//   / readVersion                 offered in the restore card as "On this computer" (compare-first, like a cloud backup).
'use strict';

const fs = require('fs');
const path = require('path');

const KEEP_STAMPED = 10;
const KEEP_VERSIONS = 5;
const LOCAL_ID = /^local-(\d{8}-\d{6})$/;

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  const t = d instanceof Date ? d : new Date(d == null ? Date.now() : d);
  return t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '-' + pad(t.getHours()) + pad(t.getMinutes()) + pad(t.getSeconds());
}
function stampToMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns the copy's file name, or null when the file is not there (nothing to protect) or the copy failed.
// Two copies in the same second share a name, so a restore plus the write underneath it make ONE copy.
function stampedCopy(dir, name, now, keep = KEEP_STAMPED) {
  try {
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) return null;
    const copy = name + '.mimic-' + stamp(now) + '.bak';
    const dest = path.join(dir, copy);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    const rx = new RegExp('^' + esc(name) + '\\.mimic-\\d{8}-\\d{6}\\.bak$', 'i');
    const mine = fs.readdirSync(dir).filter(f => rx.test(f)).sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - keep))) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* in use */ } }
    return copy;
  } catch { return null; }
}

const safeChar = (c) => /^[A-Za-z]+$/.test(String(c || '')) ? String(c) : null;

// Saves { filename: text } as a new version unless the newest one is already identical. Returns the version id or null.
function saveVersion(root, character, files, now, keep = KEEP_VERSIONS) {
  const c = safeChar(character);
  if (!c || !files || !Object.keys(files).length) return null;
  try {
    const base = path.join(root, c.toLowerCase());
    const newest = listVersions(root, c)[0];
    if (newest) {
      const prev = readVersion(root, c, newest.id);
      const a = Object.keys(files).sort(), b = Object.keys(prev || {}).sort();
      if (prev && a.length === b.length && a.every((n, i) => n === b[i] && files[n] === prev[n])) return null;   // nothing changed
    }
    const id = stamp(now);
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(files)) {
      if (typeof t !== 'string' || n !== path.basename(n)) continue;
      fs.writeFileSync(path.join(dir, n), t, 'utf8');
    }
    const all = fs.readdirSync(base).filter(d => /^\d{8}-\d{6}$/.test(d)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) { try { fs.rmSync(path.join(base, old), { recursive: true, force: true }); } catch { /* next time */ } }
    return 'local-' + id;
  } catch { return null; }
}

// Newest first: [{ id: 'local-<stamp>', at: ms, file_count }].
function listVersions(root, character) {
  const c = safeChar(character);
  if (!c) return [];
  const base = path.join(root, c.toLowerCase());
  try {
    return fs.readdirSync(base).filter(d => /^\d{8}-\d{6}$/.test(d)).sort().reverse().map(d => {
      let n = 0;
      try { n = fs.readdirSync(path.join(base, d)).length; } catch { /* gone */ }
      return { id: 'local-' + d, at: stampToMs(d), file_count: n };
    });
  } catch { return []; }
}

// → { filename: text } or null.
function readVersion(root, character, id) {
  const c = safeChar(character), m = LOCAL_ID.exec(String(id || ''));
  if (!c || !m) return null;
  const dir = path.join(root, c.toLowerCase(), m[1]);
  try {
    const out = {};
    for (const f of fs.readdirSync(dir)) out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    return out;
  } catch { return null; }
}

const isLocalId = (id) => LOCAL_ID.test(String(id || ''));

module.exports = { KEEP_STAMPED, KEEP_VERSIONS, stamp, stampedCopy, saveVersion, listVersions, readVersion, isLocalId };
