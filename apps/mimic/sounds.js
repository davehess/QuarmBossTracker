'use strict';
// sounds.js — the sound-effect library (the guild lead, 2026-10-14: a member wanted a custom "slap"
// when their Willsapper proc lands; then "allow users to add their own sound effects. allow them to
// use the sound effects instead of callouts tts").
//
// Two folders, one name space:
//   shipped  <resources>/sounds   generated with ffmpeg for this project (no third-party audio)
//   custom   <userData>/sounds    the member drops .wav / .mp3 / .ogg here
// A trigger stores a sound NAME ("slap"), or "custom:<file>" for a member's own file — never a path,
// so a guild or synced trigger plays on every PC. A custom file with the same name as a shipped one
// OVERRIDES it ("slap.mp3" in the custom folder replaces the shipped slap on this PC only).
// An http(s) URL still plays as it always did (the Vex Thal guild trigger uses a wolfpack.quest URL);
// that case is handled by the player, not here.
//
// Pure functions over two directories, so a test runs the shipped code without Electron.
// The agent has its own copy of the same rules (it is a single file with no sibling requires):
// packages/wolfpack-logsync/index.js `_soundFiles` / `_soundResolve`. Keep the two in step.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const EXTS = ['.wav', '.mp3', '.ogg'];
const MAX_BYTES = 8 * 1024 * 1024;   // a sound effect, not an album

function _scan(dir) {
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      if (!EXTS.includes(ext)) continue;
      let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
      if (!st.isFile() || st.size > MAX_BYTES || st.size === 0) continue;
      out.push({ file: f, base: path.basename(f, path.extname(f)).toLowerCase() });
    }
  } catch { /* a missing folder is an empty library */ }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// → [{ name, file, source }] with `name` the value a trigger stores. Shipped first, then custom-only.
function listSounds(shippedDir, userDir) {
  const shipped = _scan(shippedDir), custom = _scan(userDir);
  const customByBase = new Map(custom.map(c => [c.base, c]));
  const out = [];
  for (const s of shipped) {
    const over = customByBase.get(s.base);
    out.push({ name: s.base, file: over ? over.file : s.file, source: over ? 'custom' : 'shipped', overrides: !!over });
  }
  const shippedBases = new Set(shipped.map(s => s.base));
  for (const c of custom) {
    if (shippedBases.has(c.base)) continue;
    out.push({ name: 'custom:' + c.file, file: c.file, source: 'custom', overrides: false });
  }
  return out;
}

// name → absolute file path, or null (unknown name, a path, a traversal attempt).
function resolveSoundPath(name, shippedDir, userDir) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith('custom:')) {
    const file = raw.slice(7).trim();
    if (!file || file !== path.basename(file) || !EXTS.includes(path.extname(file).toLowerCase())) return null;
    const p = path.join(userDir, file);
    return fs.existsSync(p) ? p : null;
  }
  const base = raw.toLowerCase();
  if (!/^[a-z0-9][a-z0-9 _.-]{0,60}$/.test(base)) return null;
  const mine = _scan(userDir).find(c => c.base === base);
  if (mine) return path.join(userDir, mine.file);
  const ours = _scan(shippedDir).find(s => s.base === base);
  return ours ? path.join(shippedDir, ours.file) : null;
}

function resolveSoundUrl(name, shippedDir, userDir) {
  const p = resolveSoundPath(name, shippedDir, userDir);
  return p ? pathToFileURL(p).href : null;
}

module.exports = { EXTS, MAX_BYTES, listSounds, resolveSoundPath, resolveSoundUrl };
