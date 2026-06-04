// patch-latest-yml.js — recompute electron-updater hashes after code signing.
//
// Authenticode signing rewrites the .exe (the signature is embedded in the PE),
// so its SHA-512 and byte size change. electron-builder generated dist/latest.yml
// from the UNSIGNED exe during the build; if we sign afterward and ship that
// latest.yml unchanged, electron-updater will REJECT the update ("sha512
// mismatch") and auto-update silently breaks. This rewrites the exe's hash+size
// in latest.yml to match the signed file.
//
// Only the .exe is signed (SignPath signs the NSIS installer), so we touch ONLY
// the exe's entry + the top-level sha512 (which mirrors the primary file) and
// leave any other artifact rows (e.g. the .zip) untouched. The stale .blockmap
// is harmless — electron-updater falls back to a full download when it doesn't
// match — so we don't regenerate it.
//
// Run from apps/mimic AFTER signing, BEFORE publishing the release.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distDir = path.join(__dirname, '..', 'dist');
const ymlPath = path.join(distDir, 'latest.yml');

if (!fs.existsSync(ymlPath)) {
  console.error('[patch-latest-yml] dist/latest.yml not found — nothing to patch.');
  process.exit(1);
}

// The primary installer electron-updater tracks.
const exe = fs.readdirSync(distDir).find((f) => /^Wolf-Pack-Mimic-Setup-.*\.exe$/i.test(f));
if (!exe) {
  console.error('[patch-latest-yml] no Wolf-Pack-Mimic-Setup-*.exe in dist.');
  process.exit(1);
}

const buf    = fs.readFileSync(path.join(distDir, exe));
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
const size   = buf.length;

// Line-walk the YAML so we only edit the exe's file block + the top-level
// (non-indented) sha512. Track which artifact's block we're inside via `url:`.
const lines = fs.readFileSync(ymlPath, 'utf8').split('\n');
let curUrl = null;
for (let i = 0; i < lines.length; i++) {
  const u = lines[i].match(/^\s*-?\s*url:\s*(.+?)\s*$/);
  if (u) { curUrl = u[1].trim(); continue; }
  if (/^\s+sha512:/.test(lines[i]) && curUrl === exe) {
    lines[i] = lines[i].replace(/sha512:.*/, `sha512: ${sha512}`);
  } else if (/^\s+size:/.test(lines[i]) && curUrl === exe) {
    lines[i] = lines[i].replace(/size:.*/, `size: ${size}`);
  } else if (/^sha512:/.test(lines[i])) {
    // Top-level sha512 corresponds to `path:` (the primary exe).
    lines[i] = `sha512: ${sha512}`;
  }
}
fs.writeFileSync(ymlPath, lines.join('\n'));
console.log(`[patch-latest-yml] ${exe}: sha512=${sha512.slice(0, 20)}… size=${size}`);
