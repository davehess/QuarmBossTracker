// iniDiff.js — what changed between two copies of a character's EverQuest / Zeal files, key by key.
//
// The guild lead, 2026-11-11: "we should always retain previous and show diff to previous not including what we have
// changed in the UI studio and then list all of the changes not just the ones that we've made in the UI studio."
// UI Studio used to show only what it had changed itself. This lists EVERY change between the previous version
// Mimic kept (localVersions.js) and the files now, and labels where each one came from, so the changes the game
// itself made (it rewrites these files on camp) can be read on their own with Mimic's own hidden.
//
// Pure: strings in, plain objects out. No fs, no Electron, so a test runs the real thing.
//
//   diffBundles(prev, cur, { origin })   { file: text } x2 -> every added / removed / changed key, by file and section
//   changedKeys(before, after)           the keys one write changed, as hashes, for the version's `writes` record
//   makeOrigin(records, complete)        the `origin` callback: who changed a key, from those records
//
// Reads: section and key names match case-insensitively (the profile API EQ reads these with); a repeat of a key in a
// section keeps the first; only the VALUE's surrounding whitespace is ignored, and ordering never matters.
// Never shows: a key matching /password/i or /ChannelAutoJoin/i comes out as "(hidden)" on both sides, so the secret
// never reaches the page. (A chat channel's name and its password sit in the auto-join line.)
'use strict';

const crypto = require('crypto');

const HIDDEN = '(hidden)';
const isSecretKey = (k) => /password/i.test(k) || /ChannelAutoJoin/i.test(k);
const MIMIC_SOURCES = ['ui-studio', 'restore', 'layout'];
const isMimicOrigin = (o) => MIMIC_SOURCES.includes(o);

const SEC_RE = /^\s*\[([^\]]+)\]\s*$/;

// → Map(lowercase section → { name, keys: Map(lowercase key → { key, value }) })
function parseIni(text) {
  const out = new Map();
  let cur = null;
  for (const line of String(text == null ? '' : text).split(/\r\n|\n|\r/)) {
    const ms = SEC_RE.exec(line);
    if (ms) {
      const name = ms[1].trim(), lower = name.toLowerCase();
      if (!out.has(lower)) out.set(lower, { name, keys: new Map() });
      cur = out.get(lower);
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key[0] === ';') continue;
    const lk = key.toLowerCase();
    if (!cur.keys.has(lk)) cur.keys.set(lk, { key, value: line.slice(eq + 1).trim() });
  }
  return out;
}

function byLowerName(files) {
  const m = new Map();
  for (const [name, text] of Object.entries(files && typeof files === 'object' ? files : {})) {
    if (typeof text === 'string') m.set(name.toLowerCase(), { name, text });
  }
  return m;
}

// Calls cb(file, fileStatus, section, key, kind, oldRaw, newRaw) for every changed key, in a stable order.
function walk(prev, cur, cb) {
  const a = byLowerName(prev), b = byLowerName(cur);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const ln of names) {
    const pa = a.get(ln), pb = b.get(ln);
    const status = !pa ? 'added' : !pb ? 'removed' : 'changed';
    const file = (pb || pa).name;
    if (pa && pb && pa.text === pb.text) continue;
    const sa = pa ? parseIni(pa.text) : new Map(), sb = pb ? parseIni(pb.text) : new Map();
    for (const sl of [...new Set([...sb.keys(), ...sa.keys()])]) {
      const secA = sa.get(sl), secB = sb.get(sl);
      const section = (secB || secA).name;
      for (const kl of [...new Set([...(secB ? secB.keys.keys() : []), ...(secA ? secA.keys.keys() : [])])]) {
        const ka = secA && secA.keys.get(kl), kb = secB && secB.keys.get(kl);
        if (ka && kb) {
          if (ka.value !== kb.value) cb(file, status, section, kb.key, 'changed', ka.value, kb.value);
        } else if (kb) cb(file, status, section, kb.key, 'added', null, kb.value);
        else cb(file, status, section, ka.key, 'removed', ka.value, null);
      }
    }
  }
}

// opts.origin(file, section, key, newRawValueOrNull) -> a label string; left out, no labels.
function diffBundles(prev, cur, opts) {
  const origin = opts && typeof opts.origin === 'function' ? opts.origin : null;
  const files = [];
  const index = new Map();   // "file\0section" -> section object
  const byOrigin = {};
  let total = 0;
  walk(prev, cur, (file, status, section, key, kind, o, n) => {
    let f = files.find(x => x.file === file);
    if (!f) { f = { file, status, count: 0, sections: [] }; files.push(f); }
    const sk = file + '\0' + section;
    let s = index.get(sk);
    if (!s) { s = { section, changes: [] }; index.set(sk, s); f.sections.push(s); }
    const hidden = isSecretKey(key);
    const c = { key, kind, old: hidden ? (o == null ? null : HIDDEN) : o, new: hidden ? (n == null ? null : HIDDEN) : n };
    if (hidden) c.hidden = true;
    if (origin) { c.origin = String(origin(file, section, key, n)); byOrigin[c.origin] = (byOrigin[c.origin] || 0) + 1; }
    s.changes.push(c);
    f.count++; total++;
  });
  return { files, total, filesChanged: files.length, byOrigin };
}

const hashVal = (v) => v == null ? '-' : crypto.createHash('sha1').update(String(v).trim()).digest('hex').slice(0, 10);

// The keys one write changed: { file: { section: { key: hash-of-the-new-value } } }, all lowercase. A hash, not the
// value, so a record on disk never holds a second copy of a setting (or a password).
function changedKeys(before, after) {
  const out = Object.create(null);
  walk(before, after, (file, _st, section, key, _kind, _o, n) => {
    const f = file.toLowerCase(), s = section.toLowerCase();
    if (!out[f]) out[f] = Object.create(null);
    if (!out[f][s]) out[f][s] = Object.create(null);
    out[f][s][key.toLowerCase()] = hashVal(n);
  });
  return out;
}
const countKeys = (keys) => Object.values(keys || {}).reduce((t, secs) => t + Object.values(secs).reduce((u, ks) => u + Object.keys(ks).length, 0), 0);

const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;

// records: oldest first, [{ source, keys }] — the writes Mimic made after the base version.
// complete: true when every version from the base up has such a record. Then a key no record covers was changed by the
// game (or something else); when not complete it could just as well be a Mimic write we have no record of: 'unknown'.
// A key a record covers whose value is no longer what Mimic wrote was changed again since: 'game' / 'unknown' too.
function makeOrigin(records, complete) {
  const rest = complete ? 'game' : 'unknown';
  const list = Array.isArray(records) ? records : [];
  return (file, section, key, rawNew) => {
    const f = String(file).toLowerCase(), s = String(section).toLowerCase(), k = String(key).toLowerCase();
    for (let i = list.length - 1; i >= 0; i--) {
      const h = own(own(own(list[i] && list[i].keys, f), s), k);
      if (h !== undefined) return h === hashVal(rawNew) ? String(list[i].source || rest) : rest;
    }
    return rest;
  };
}

module.exports = { HIDDEN, MIMIC_SOURCES, isMimicOrigin, isSecretKey, parseIni, diffBundles, changedKeys, countKeys, hashVal, makeOrigin };
