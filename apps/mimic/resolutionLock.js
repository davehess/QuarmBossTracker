// resolutionLock.js — hold eqclient.ini's [VideoMode] at the resolution the
// USER chose, against a client that keeps rewriting it behind their back.
//
// WHY (Hitya, 2026-08-24): "make sure we're resetting the height and width each
// time the game tries to overwrite it into the crapped 4:3 formats it expects."
// The old EQ client rewrites eqclient.ini's [VideoMode] block on exit and from
// its first-run display dialog, stomping the Steam Deck's 1280×800 (or the
// 1440×900 supersample quarm.guide's Bonus Step 7 recommends) back to a 4:3
// mode — 640×480 / 800×600 / 1024×768. Every session after that is letterboxed
// until the player edits the file by hand again.
//
// ⚠ TIMING IS THE WHOLE DESIGN. EQ holds eqclient.ini OPEN and flushes it ON
// EXIT, so writing while eqgame is alive is both futile (the client's copy wins
// at exit) and a corruption risk (two writers, one file). This module does NOT
// check for a running client — that gate lives with every caller
// (`_enforceResolutionLock` in main.js), which is also what keeps this file
// platform-agnostic and testable without Electron.
//
// Enforcement points wired today (main.js): the EQ running→stopped transition,
// an fs.watch on the EQ folder, and a settings save. A Mimic-initiated LAUNCH
// path is the obvious third trigger and deliberately has no call site — Mimic
// does not start EverQuest today. Whoever adds a launcher: call enforce()
// immediately before spawning the client.
//
// Test: test/resolution-lock.test.js (the pure transform, applyVideoMode).

const fs   = require('fs');
const path = require('path');

const VIDEO_SECTION = 'videomode';

function _int(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── The transform (PURE — string in, string out) ────────────────────────────
// Regex-level, deliberately: eqclient.ini is not ours to reformat. A parse +
// re-serialize round trip would rewrite the whole file (key order, spacing,
// CRLF, the top-section keys like VideoModeBitsPerPixel / WindowedMode that we
// have no business touching), and any of that churn is indistinguishable from
// corruption if we ever get it wrong. So: split on line terminators KEEPING
// them, edit only `Width=` / `Height=` lines that sit inside `[VideoMode]`, and
// hand every other byte back exactly as it arrived.
//
// Returns { changed, out, from, to }. `changed:false` returns the INPUT STRING
// itself, so an already-correct file is byte-identical and the caller can skip
// the write entirely — a no-op rewrite would churn the mtime for nothing and
// (via our own fs.watch) feed back as another change event.
function applyVideoMode(text, width, height) {
  const src  = String(text == null ? '' : text);
  const to   = { width: _int(width), height: _int(height) };
  const from = { width: null, height: null };
  // No usable target → no-op. Never "lock" someone to a garbage resolution.
  if (!to.width || !to.height) return { changed: false, out: src, from, to };

  // Even indices are line content, odd indices are the terminators that
  // followed them. join('') is therefore an exact reconstruction, and a
  // CRLF file stays CRLF without us ever naming the convention.
  const parts = src.split(/(\r\n|\n|\r)/);
  let inVideo = false;
  let changed = false;

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    const sect = /^\s*\[([^\]]*)\]\s*$/.exec(line);
    if (sect) { inVideo = sect[1].trim().toLowerCase() === VIDEO_SECTION; continue; }
    // Anything outside [VideoMode] is untouchable — including the top-section
    // keys EQ writes above the first header (VideoModeBitsPerPixel,
    // WindowedMode), whose names deliberately look like ours.
    if (!inVideo) continue;
    // Whole-key match only: `Width2=` / `WidthFoo=` must not match, so the key
    // has to be followed straight away by the `=`.
    const kv = /^(\s*)(Width|Height)(\s*=\s*)(.*)$/i.exec(line);
    if (!kv) continue;

    const key  = kv[2].toLowerCase();
    const raw  = kv[4].trim();
    const cur  = /^-?\d+$/.test(raw) ? Number(raw) : null;
    if (from[key] === null) from[key] = cur;

    const want = key === 'width' ? to.width : to.height;
    if (cur === want) continue;              // already right — leave the bytes alone
    parts[i] = kv[1] + kv[2] + kv[3] + String(want);
    changed = true;
  }

  return { changed, out: changed ? parts.join('') : src, from, to };
}

// Resolve the real on-disk eqclient.ini inside an EQ folder.
// Case-insensitive on purpose: Linux/Deck prefixes are case-SENSITIVE
// filesystems, and the client, the guides and the various kit zips are not
// consistent about eqclient.ini vs EQClient.ini. A case-exact path.join would
// silently miss the file and the lock would look like it simply never ran.
function resolveIniPath(eqDir, fsImpl = fs) {
  const dir = String(eqDir || '').trim();
  if (!dir) return null;
  try {
    for (const name of fsImpl.readdirSync(dir)) {
      if (/^eqclient\.ini$/i.test(name)) return path.join(dir, name);
    }
  } catch { return null; }
  return null;
}

function _fmt(v) { return v == null ? '?' : String(v); }

// ── The I/O half ────────────────────────────────────────────────────────────
// enforce({ eqDir, width, height, trigger, log }) → result
//
// result.reason is always set so a caller can explain a no-op:
//   'no-target' | 'no-eq-dir' | 'missing-file' | 'read-failed'
//   'no-videomode' | 'already-locked' | 'write-failed' | 'locked'
//
// The caller MUST have established that eqgame is not running first.
function enforce(opts = {}) {
  const {
    eqDir, width, height,
    trigger = 'unknown',
    log = () => {},
    fsImpl = fs,
  } = opts;

  const to = { width: _int(width), height: _int(height) };
  if (!to.width || !to.height) return { ok: false, changed: false, reason: 'no-target', to };

  const iniPath = resolveIniPath(eqDir, fsImpl);
  // A configured folder with no eqclient.ini in it is a different problem from
  // having no folder at all, and the caller reports them differently.
  if (!iniPath) return { ok: false, changed: false, reason: eqDir ? 'missing-file' : 'no-eq-dir', to };

  let before;
  try {
    // latin1, not utf8: it round-trips every byte 1:1, so a file carrying any
    // high-byte content we did not put there survives our rewrite untouched.
    before = fsImpl.readFileSync(iniPath, 'latin1');
  } catch (err) {
    const msg = (err && err.message) || String(err);
    log(`[reslock] ${trigger}: could not read ${iniPath} — ${msg}\n`);
    return { ok: false, changed: false, reason: err && err.code === 'ENOENT' ? 'missing-file' : 'read-failed', path: iniPath, to };
  }

  const res = applyVideoMode(before, to.width, to.height);
  if (!res.changed) {
    const nothingSeen = res.from.width === null && res.from.height === null;
    return {
      ok: true, changed: false,
      // Never invent a [VideoMode] section (or its keys). If the client has
      // not written one yet there is no user choice to defend, and guessing at
      // a file format we only half-understand is how you brick someone's client.
      reason: nothingSeen ? 'no-videomode' : 'already-locked',
      path: iniPath, from: res.from, to,
    };
  }

  // One-time backup: the FIRST thing we ever change is worth keeping forever,
  // because that copy is the user's pristine pre-Mimic file. Re-backing-up on
  // every enforcement would overwrite it with our own last output within a
  // session — i.e. destroy the only thing the backup is for.
  const bak = iniPath + '.mimic-bak';
  try { if (!fsImpl.existsSync(bak)) fsImpl.copyFileSync(iniPath, bak); } catch { /* best-effort */ }

  // Atomic: full write to a sibling temp, then rename over the target. A
  // half-written eqclient.ini is a client that will not start.
  const tmp = iniPath + '.mimic-tmp';
  try {
    fsImpl.writeFileSync(tmp, res.out, 'latin1');
    fsImpl.renameSync(tmp, iniPath);
  } catch (err) {
    try { fsImpl.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    const msg = (err && err.message) || String(err);
    log(`[reslock] ${trigger}: could not write ${iniPath} — ${msg}\n`);
    return { ok: false, changed: false, reason: 'write-failed', path: iniPath, from: res.from, to };
  }

  // One line per enforcement, carrying old → new and which trigger fired —
  // so "it went 4:3 again" is answerable from agent.log without a repro.
  log(`[reslock] ${trigger}: [VideoMode] ${_fmt(res.from.width)}×${_fmt(res.from.height)}`
    + ` → ${to.width}×${to.height} — ${iniPath}\n`);

  return { ok: true, changed: true, reason: 'locked', path: iniPath, from: res.from, to, backup: bak };
}

module.exports = { applyVideoMode, resolveIniPath, enforce };
