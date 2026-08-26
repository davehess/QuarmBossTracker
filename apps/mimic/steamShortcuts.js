// steamShortcuts.js — read and write Steam's binary `shortcuts.vdf` so Mimic can
// put EverQuest in the Steam library as ONE entry (#156, Steam Deck).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
// ─────────────────────────────────────────────────────────────────────────────
// The Deck runbook's last manual step is "create the Steam shortcut" — the thing
// that makes the whole stack (EQ + Zeal + the pipe bridge + Mimic) launchable
// from Gaming Mode with Steam Input keybinds. Doing that by hand means Desktop
// Mode, a file manager, and a third-party tool (steamtinkerlaunch), which is the
// exact friction the Deck work exists to remove. Steam has no CLI and no API for
// it: the ONLY supported way to add a non-Steam game is to edit
// `~/.steam/steam/userdata/<steamid3>/config/shortcuts.vdf`, Valve's binary
// KeyValues file. So we parse and rewrite it ourselves.
//
// Zero npm dependencies — `fs`/`path`/`os` only, like the rest of apps/mimic.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FORMAT (binary KeyValues) — enough to not corrupt somebody's library
// ─────────────────────────────────────────────────────────────────────────────
// Every field is: <type byte> <NUL-terminated key> <value>.
//   0x00 map    — nested contents follow, terminated by one 0x08
//   0x01 string — NUL-terminated UTF-8 value
//   0x02 int32  — exactly 4 bytes, LITTLE-endian, SIGNED
//   0x08        — end of the current map
// The document is one map named "shortcuts" whose keys are the stringified
// indices "0", "1", "2"… each a map of that shortcut's fields. So a well-formed
// file ends with TWO 0x08 bytes: one closing the shortcuts map, one closing the
// document. Booleans are int32 0/1 — there is no bool type.
//
// Typical per-shortcut fields, in the case Steam writes them (key names ARE
// case-sensitive): appid, AppName, Exe, StartDir, icon, ShortcutPath,
// LaunchOptions, IsHidden, AllowDesktopConfig, AllowOverlay, OpenVR, Devkit,
// DevkitGameID, DevkitOverrideAppID, LastPlayTime, FlatpakAppID, and a nested
// `tags` map keyed "0","1",… with string values (that is where "Favorite" and
// the user's collections live).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE RULES THAT KEEP US FROM WRECKING A USER'S LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
// 1. **Preserve everything we do not understand.** Steam gains fields across
//    client versions and this file holds ALL of a user's non-Steam games, not
//    just ours. parseShortcuts→serializeShortcuts is byte-stable for anything it
//    read, unknown keys included, and a structurally corrupt file THROWS rather
//    than parsing to something short that we would then write back. Dropping a
//    field or an entry is silent data loss in somebody else's game.
// 2. **Upserting is idempotent.** Running the installer twice must not produce
//    two "EverQuest" entries. upsertShortcut() matches an existing row by
//    AppName or by the same Exe (quoted or not) and updates it in place.
// 3. **Steam must not be running when we write.** Steam holds shortcuts.vdf in
//    memory and rewrites it from that copy on exit, so a write while it is up is
//    simply erased at logout. Callers check first and tell the user to quit
//    Steam (on a Deck: Gaming Mode → Power → Switch to Desktop Mode, or just
//    write before the first launch).
//
// `appid` is the legacy CRC id Steam derives from Exe+AppName; grid artwork is
// filed under it (`<appid >>> 0>p.png` and friends), which is why an update must
// carry the OLD appid forward rather than recompute one — recomputing orphans
// the artwork the user set.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Type bytes. See the format note above.
const T_MAP = 0x00;
const T_STR = 0x01;
const T_INT = 0x02;
const T_END = 0x08;

const ROOT_KEY = 'shortcuts';

// A .bak we take once, the first time we ever touch a user's file. Not
// timestamped on purpose: this is "the file as it was before Mimic existed",
// and one of those is worth more than N copies of our own output.
const BACKUP_SUFFIX = '.wolfpack.bak';

// ── Binary KeyValues: reading ───────────────────────────────────────────────

// NUL-terminated UTF-8. Returns the value plus where the next field starts.
function _readCString(buf, off) {
  const end = buf.indexOf(0x00, off);
  if (end < 0) throw new Error(`shortcuts.vdf: unterminated string at byte ${off}`);
  return { value: buf.toString('utf8', off, end), next: end + 1 };
}

// Read fields until the map's 0x08 terminator. Returns a plain object, which
// preserves insertion order for the non-numeric keys shortcut fields use — that
// is what makes a rewrite a minimal diff against what Steam wrote.
//
// Anything we cannot make sense of throws. That is deliberate: the alternative
// is returning a partial list which the caller then writes back, silently
// deleting the games it failed to read.
function _parseMap(buf, off) {
  const map = {};
  let i = off;
  while (i < buf.length) {
    const type = buf[i++];
    if (type === T_END) return { map, next: i };
    const key = _readCString(buf, i);
    i = key.next;
    if (type === T_MAP) {
      const nested = _parseMap(buf, i);
      i = nested.next;
      map[key.value] = nested.map;
    } else if (type === T_STR) {
      const val = _readCString(buf, i);
      i = val.next;
      map[key.value] = val.value;
    } else if (type === T_INT) {
      if (i + 4 > buf.length) {
        throw new Error(`shortcuts.vdf: truncated int32 for "${key.value}" at byte ${i}`);
      }
      map[key.value] = buf.readInt32LE(i);
      i += 4;
    } else {
      throw new Error(
        `shortcuts.vdf: unknown field type 0x${type.toString(16).padStart(2, '0')} at byte ${i - 1}`);
    }
  }
  throw new Error('shortcuts.vdf: unexpected end of file (a map was never closed)');
}

// ── Binary KeyValues: writing ───────────────────────────────────────────────

function _cstr(s) {
  return Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0x00])]);
}

// Signed, little-endian, wrapping. `| 0` is JS's ToInt32, so a caller that hands
// us the UNSIGNED form of an appid (0x8xxxxxxx as a positive number, which is
// how Steam's grid filenames spell it) still writes the right four bytes.
function _int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(Math.trunc(Number(n) || 0) | 0, 0);
  return b;
}

// Encode a map's CONTENTS (no terminator — the caller appends 0x08). JS type
// picks the VDF type: string → 0x01, number/boolean → 0x02, object → nested map.
// null/undefined are skipped; there is no way to spell them in this format and
// writing a 0 or "" in their place would be an invention.
function _encodeMapBody(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      parts.push(Buffer.from([T_STR]), _cstr(k), _cstr(v));
    } else if (typeof v === 'boolean') {
      parts.push(Buffer.from([T_INT]), _cstr(k), _int32(v ? 1 : 0));
    } else if (typeof v === 'number') {
      parts.push(Buffer.from([T_INT]), _cstr(k), _int32(v));
    } else if (typeof v === 'object') {
      parts.push(Buffer.from([T_MAP]), _cstr(k), _encodeMapBody(v), Buffer.from([T_END]));
    }
  }
  return Buffer.concat(parts);
}

// ── crc32 (IEEE 802.3) ──────────────────────────────────────────────────────

// Steam's shortcut appid is a CRC32, so we need one. Eight lines beats a
// dependency in a zero-dep app, and the table is built once on first use.
let _CRC_TABLE = null;
function _crcTable() {
  if (_CRC_TABLE) return _CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  _CRC_TABLE = t;
  return t;
}

// Standard CRC-32, returned unsigned. crc32("123456789") === 0xCBF43926.
function _crc32(input) {
  const table = _crcTable();
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Exe quoting ─────────────────────────────────────────────────────────────

// Steam writes Exe and StartDir wrapped in double quotes ("/home/deck/foo.sh").
// Hand-edited files and other tools often don't. Same shortcut either way, so
// every comparison goes through here.
function _unquote(s) {
  const v = String(s == null ? '' : s).trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

// The form Steam itself writes. Used when we BUILD a shortcut; never applied to
// a value we merely read back, so a user's existing spelling survives untouched.
function _quote(s) {
  const v = _unquote(s);
  return v ? `"${v}"` : '';
}

// ── Public API: parse / serialize ───────────────────────────────────────────

// Buffer → array of shortcut objects. A missing or zero-length file is not an
// error — it is a Deck that has never had a non-Steam game added, which is the
// common case on a fresh install.
function parseShortcuts(buf) {
  if (!buf || !buf.length) return [];
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] !== T_MAP) {
    throw new Error(`shortcuts.vdf: expected a root map (0x00), found 0x${(b[0] || 0).toString(16)}`);
  }
  const rootKey = _readCString(b, 1);          // "shortcuts"
  const { map } = _parseMap(b, rootKey.next);
  const out = [];
  // Keys are "0","1","2"… — JS orders integer-like keys ascending, which is
  // Steam's own order. Non-map entries (none in the wild) are ignored.
  for (const v of Object.values(map)) {
    if (v && typeof v === 'object') out.push(v);
  }
  return out;
}

// Array of shortcut objects → Buffer. Indices are renumbered from 0, which is
// what Steam does too; everything else is written back exactly as handed in, so
// parseShortcuts(serializeShortcuts(x)) deep-equals x.
function serializeShortcuts(list) {
  const parts = [Buffer.from([T_MAP]), _cstr(ROOT_KEY)];
  const arr = Array.isArray(list) ? list : [];
  arr.forEach((sc, i) => {
    parts.push(Buffer.from([T_MAP]), _cstr(String(i)), _encodeMapBody(sc), Buffer.from([T_END]));
  });
  parts.push(Buffer.from([T_END, T_END]));     // close shortcuts map, close document
  return Buffer.concat(parts);
}

// ── Public API: the appid ───────────────────────────────────────────────────

// Steam's legacy non-Steam-game id: crc32(Exe + AppName) with the top bit set.
// Returned SIGNED so it round-trips through the int32 field unchanged; the
// unsigned form (`shortcutAppId(...) >>> 0`) is what grid-art filenames use.
//
// Pass Exe in whatever form you WRITE to the file — Steam hashes the stored
// string, quotes included — so quote it first if the shortcut will be quoted.
function shortcutAppId(exe, appname) {
  return (_crc32(String(exe == null ? '' : exe) + String(appname == null ? '' : appname)) | 0x80000000) | 0;
}

// ── Public API: idempotent upsert ───────────────────────────────────────────

// Same shortcut? AppName exact (case-sensitive — Steam treats "Mimic" and
// "mimic" as two library entries) OR the same Exe ignoring quoting. Two matchers
// because either half can legitimately change: a user renames the library entry,
// or we move the launcher script.
function _matchesShortcut(existing, sc) {
  if (!existing || !sc) return false;
  if (sc.AppName && existing.AppName === sc.AppName) return true;
  const a = _unquote(existing.Exe);
  const b = _unquote(sc.Exe);
  return !!a && a === b;
}

// Add `sc`, or update the row it matches. Returns a NEW list (the input array is
// never mutated) plus whether we appended and which index we landed on.
//
// On update we keep the existing row's fields and overwrite only what `sc`
// carries — so appid, tags, LastPlayTime and any Steam-version field we do not
// know about survive. A falsy appid on `sc` is ignored outright: a caller
// building a fresh shortcut object with `appid: 0` must never overwrite the real
// id, because that id is where the user's grid artwork is filed.
function upsertShortcut(list, sc) {
  const out = Array.isArray(list) ? list.slice() : [];
  const shortcut = sc || {};
  const index = out.findIndex(e => _matchesShortcut(e, shortcut));
  if (index < 0) {
    out.push(Object.assign({}, shortcut));
    return { list: out, added: true, index: out.length - 1 };
  }
  const merged = Object.assign({}, out[index]);
  for (const [k, v] of Object.entries(shortcut)) {
    if (v === undefined || v === null) continue;
    if (k === 'appid' && !v) continue;
    merged[k] = v;
  }
  out[index] = merged;
  return { list: out, added: false, index };
}

// ── Public API: finding the file ────────────────────────────────────────────

// Both layouts exist on a Deck and are usually the same directory: SteamOS ships
// `~/.steam/steam` as a symlink to `~/.local/share/Steam`. We look in both
// because which one is real varies by distro and by how Steam was installed.
function _steamUserdataRoots(homeDir) {
  const h = String(homeDir || os.homedir());
  return [
    path.join(h, '.steam', 'steam', 'userdata'),        // preferred when both exist
    path.join(h, '.local', 'share', 'Steam', 'userdata'),
  ];
}

// userdata/ also holds `anonymous` (Steam's not-signed-in profile) and `0`
// (its placeholder id). Writing a shortcut into either does nothing visible, so
// neither is a real user.
function _isRealSteamUserDir(name) {
  if (!/^\d+$/.test(String(name))) return false;
  return String(name) !== '0';
}

// readdirSync returns strings by default but Dirents with { withFileTypes }.
// Injected test doubles hand back either; take the name from both.
function _entryName(ent) {
  if (ent && typeof ent === 'object' && typeof ent.name === 'string') return ent.name;
  return String(ent);
}

// Every real Steam user on this box, with the shortcuts.vdf path for each.
// `fsLike` (needs existsSync + readdirSync) is injectable so this is testable
// without a Steam install.
//
// The path is returned whether or not the file exists yet — `exists:false` is a
// user who has never added a non-Steam game, and creating the file is exactly
// what we are here to do. De-duplicated by steamId, since the two roots are
// usually one directory reached two ways.
function findSteamUserConfigs(homeDir, fsLike) {
  const F = fsLike || fs;
  const seen = new Set();
  const out = [];
  for (const root of _steamUserdataRoots(homeDir)) {
    let names;
    try {
      if (!F.existsSync(root)) continue;
      names = F.readdirSync(root) || [];
    } catch { continue; }                       // unreadable root: not our problem
    for (const ent of names) {
      const steamId = _entryName(ent);
      if (!_isRealSteamUserDir(steamId) || seen.has(steamId)) continue;
      const configDir = path.join(root, steamId, 'config');
      const shortcutsPath = path.join(configDir, 'shortcuts.vdf');
      let exists = false;
      let hasConfig = false;
      try { exists = !!F.existsSync(shortcutsPath); } catch { /* treat as absent */ }
      try { hasConfig = !!F.existsSync(configDir); } catch { /* treat as absent */ }
      if (!exists && !hasConfig) continue;      // a stray dir, not a Steam profile
      seen.add(steamId);
      out.push({ steamId, shortcutsPath, configDir, exists, root });
    }
  }
  return out;
}

// ── Public API: the file itself ─────────────────────────────────────────────

// Absent file → [] (see parseShortcuts). A file that exists but does not parse
// throws, and the caller must NOT write over it.
function readShortcutsFile(shortcutsPath, fsLike) {
  const F = fsLike || fs;
  try { if (!F.existsSync(shortcutsPath)) return []; } catch { return []; }
  return parseShortcuts(F.readFileSync(shortcutsPath));
}

// ⚠ Steam must be closed. It keeps shortcuts.vdf in memory and rewrites it from
// that copy on exit, so a write while Steam is running is simply discarded at
// logout — with no error anywhere. Callers check for a running Steam first.
//
// One .bak of the pre-Mimic file, then tmp + rename so a crash mid-write cannot
// leave a half-file where a user's whole non-Steam library used to be.
function writeShortcutsFile(shortcutsPath, list, fsLike) {
  const F = fsLike || fs;
  const buf = serializeShortcuts(list);
  F.mkdirSync(path.dirname(shortcutsPath), { recursive: true });
  const backup = shortcutsPath + BACKUP_SUFFIX;
  let backedUp = null;
  if (F.existsSync(shortcutsPath) && !F.existsSync(backup)) {
    F.copyFileSync(shortcutsPath, backup);
    backedUp = backup;
  }
  const tmp = shortcutsPath + '.tmp';
  F.writeFileSync(tmp, buf);
  F.renameSync(tmp, shortcutsPath);
  return { path: shortcutsPath, bytes: buf.length, count: Array.isArray(list) ? list.length : 0, backedUp };
}

module.exports = {
  parseShortcuts,
  serializeShortcuts,
  upsertShortcut,
  shortcutAppId,
  findSteamUserConfigs,
  readShortcutsFile,
  writeShortcutsFile,
  // Exported for tests — the pure halves of the reasoning above.
  _readCString,
  _parseMap,
  _encodeMapBody,
  _int32,
  _cstr,
  _crc32,
  _unquote,
  _quote,
  _matchesShortcut,
  _steamUserdataRoots,
  _isRealSteamUserDir,
  _entryName,
};
