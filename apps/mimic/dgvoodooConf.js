// dgvoodooConf.js — the only place an FPS cap actually works on this client.
//
// WHY. The lutris.net Quarm installer's own notes (revision `quarmNov2025`,
// captured 2026-08-26) say it plainly:
//
//   "I have found that EQ will ignore the FPS limit in the 'eqclient.ini' file.
//    I have to set 'FPSLimit' in the 'dgVoodoo.conf' file to something
//    reasonable so this ancient game doesn't make my computer sound like a
//    vacuum cleaner."
//
// And the dgVoodoo.conf that ships with the install has `FPSLimit = 0`, which
// means UNLIMITED. A 1999 game rendering uncapped is nothing on a desktop and a
// real problem on a Steam Deck: the fan spins up on a character-select screen,
// the APU heats, and battery goes in about half the time it should. There is no
// in-game setting that fixes it — the client's own limiter is ignored — so this
// file is the whole mechanism.
//
// Deliberately a SIBLING of resolutionLock.js rather than part of it, because
// the two have opposite timing requirements. eqclient.ini is held open and
// rewritten by the client at exit, so resolutionLock has to fight for it. Nothing
// rewrites dgVoodoo.conf except dgVoodooCpl.exe when a human opens it, so this is
// an ordinary one-time write with no enforcement loop. Sharing a module would
// have meant sharing machinery only one of them needs.
//
// ⚠ This file lives NEXT TO eqgame.exe, not in the Wine prefix's Windows dir —
// dgVoodoo reads it from the application directory. On a Lutris install the
// prefix root IS the game dir (the installer sets `exe: $GAMEDIR/eqgame.exe`,
// `prefix: $GAMEDIR`), so those are the same folder there; do not "helpfully"
// go looking under drive_c.
//
// Test: test/dgvoodoo-conf.test.js (the pure transforms).

const fs   = require('fs');
const path = require('path');

const CONF_NAME = 'dgVoodoo.conf';

// Section → key. Both are matched case-insensitively because dgVoodoo writes
// `[GeneralExt]` / `[DirectX]` but hand-edited files vary.
const FPS_SECTION  = 'generalext';
const FPS_KEY      = 'fpslimit';
const WM_SECTION   = 'directx';
const WM_KEY       = 'dgvoodoowatermark';

// 0 is meaningful (dgVoodoo's own encoding for "unlimited"), so this accepts it
// and only rejects negatives / non-integers. The upper bound is a sanity rail:
// a typo'd 600000 is not a cap anyone wants.
function _fps(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null;
}

// ── The transform (PURE — string in, string out) ────────────────────────────
// Same discipline as resolutionLock.applyVideoMode, and for the same reason:
// this file is not ours to reformat. It ships with ~300 lines of explanatory
// comments that are the user's only in-place documentation of every other knob,
// and a parse + re-serialize round trip would delete all of it. So split on line
// terminators KEEPING them, rewrite exactly the one `Key = value` line inside
// exactly the one section, and hand every other byte back untouched.
//
// Returns { changed, out, from, to }. When nothing needs changing `out` is the
// INPUT STRING itself, so an already-correct file is byte-identical and the
// caller can skip the write.
//
// NEVER invents the section. If `[GeneralExt]` is absent this is not the
// dgVoodoo.conf we think it is, and writing a section into a file we do not
// recognise is how you break someone's renderer — the one thing on a Deck that
// is genuinely hard to get back (RUNBOOK §5).
function _setKeyInSection(text, sectionLc, keyLc, value) {
  const src = String(text == null ? '' : text);
  const parts = src.split(/(\r\n|\n|\r)/);
  let inSection = false;
  let changed = false;
  let from = null;
  let sawSection = false;

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    const sect = /^\s*\[([^\]]*)\]\s*$/.exec(line);
    if (sect) {
      inSection = sect[1].trim().toLowerCase() === sectionLc;
      if (inSection) sawSection = true;
      continue;
    }
    if (!inSection) continue;
    // A commented-out line stays commented. dgVoodoo.conf documents several
    // keys as `;LogToFile = false`; turning a comment into a live setting by
    // accident is a silent behaviour change.
    // ⚠ REDUNDANT TODAY, deliberately kept: the key regex below anchors on
    // `[A-Za-z0-9_]+`, which already cannot match a leading `;` or `#`, so
    // removing this line changes nothing and no test can tell the difference
    // (verified by mutation, 2026-08-26). It is here so that broadening that
    // character class later cannot silently start editing comments. If you
    // touch the regex, this guard is what keeps that safe.
    if (/^\s*[;#]/.test(line)) continue;
    const m = /^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*?)(\s*)$/.exec(line);
    if (!m || m[2].toLowerCase() !== keyLc) continue;
    from = m[4];
    if (m[4] === String(value)) continue;      // already correct — leave the bytes
    parts[i] = m[1] + m[2] + m[3] + String(value) + m[5];
    changed = true;
  }
  return { changed, out: changed ? parts.join('') : src, from, to: String(value), sawSection };
}

// Cap the frame rate. `fps` of 0 restores dgVoodoo's "unlimited".
function applyFpsLimit(text, fps) {
  const to = _fps(fps);
  if (to === null) return { changed: false, out: String(text == null ? '' : text), from: null, to: null, sawSection: false };
  const r = _setKeyInSection(text, FPS_SECTION, FPS_KEY, to);
  return { ...r, to };
}

// The dgVoodoo watermark. RUNBOOK §9 has a manual "open dgVoodooCpl.exe and
// untick it" step; this does the same edit without launching a Windows control
// panel inside Wine on a handheld. The conf that ships with the Nov-2025
// installer already has it false, so this is for installs that don't.
function applyWatermark(text, show) {
  return _setKeyInSection(text, WM_SECTION, WM_KEY, show ? 'true' : 'false');
}

function confPathFor(eqDir) {
  return path.join(String(eqDir || ''), CONF_NAME);
}

// ── The write ───────────────────────────────────────────────────────────────
// latin1 end to end: dgVoodoo.conf is a plain 8-bit file and reading it as utf8
// would mangle any high byte on the round trip. One-time `.mimic-bak` (never
// overwritten, so the pre-Mimic original is always recoverable) then a
// tmp + rename so a crash mid-write cannot leave a truncated conf — which would
// present as the renderer failing to start, the worst thing to debug on a Deck.
//
// Returns { ok, changed, reason?, path, from, to, backedUp }.
function enforce(eqDir, { fps = null, watermark = null } = {}, fsLike) {
  const F = fsLike || fs;
  const p = confPathFor(eqDir);
  if (!eqDir) return { ok: false, changed: false, reason: 'no EQ folder', path: p };
  let text;
  try {
    if (!F.existsSync(p)) return { ok: false, changed: false, reason: 'no dgVoodoo.conf beside eqgame.exe', path: p };
    text = F.readFileSync(p, 'latin1');
  } catch (e) {
    return { ok: false, changed: false, reason: 'unreadable: ' + (e && e.message), path: p };
  }

  let out = text, changed = false, from = null, to = null;
  if (fps !== null) {
    const r = applyFpsLimit(out, fps);
    if (!r.sawSection && r.to !== null) {
      return { ok: false, changed: false, reason: 'no [GeneralExt] section — not writing into a file we do not recognise', path: p };
    }
    out = r.out; changed = changed || r.changed; from = r.from; to = r.to;
  }
  if (watermark !== null) {
    const r = applyWatermark(out, watermark);
    out = r.out; changed = changed || r.changed;
  }
  if (!changed) return { ok: true, changed: false, path: p, from, to, backedUp: null };

  let backedUp = null;
  try {
    const bak = p + '.mimic-bak';
    if (!F.existsSync(bak)) { F.copyFileSync(p, bak); backedUp = bak; }
    const tmp = p + '.mimic-tmp';
    F.writeFileSync(tmp, out, 'latin1');
    F.renameSync(tmp, p);
  } catch (e) {
    return { ok: false, changed: false, reason: 'write failed: ' + (e && e.message), path: p };
  }
  return { ok: true, changed: true, path: p, from, to, backedUp };
}

module.exports = {
  applyFpsLimit,
  applyWatermark,
  confPathFor,
  enforce,
  CONF_NAME,
  _setKeyInSection,
  _fps,
};
