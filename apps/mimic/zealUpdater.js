// zealUpdater.js — keep CoastalRedwood/Zeal current without hand file-ops.
//
// Why this exists: on the Steam Deck (and honestly on Windows too) the manual
// Zeal update dance — download zeal_v[#].zip, unzip, drag Zeal.asi into the
// client folder, drag uifiles/ over the top — is exactly the kind of file
// shuffling that's miserable in Desktop Mode on a handheld. Mimic already owns
// the EQ client folder for UI Studio, so it can do this for the user: fetch the
// latest release, back up what's there, and drop the new files in place.
//
// Scope, deliberately narrow (mirrors the official Quarm.Guide steps):
//   • install the top-level  Zeal.asi
//   • merge everything under  uifiles/**
//   • touch nothing else in the zip (readme/license/etc.) and nothing else in
//     the EQ folder — every replaced file gets a timestamped .bak first.
//
// The download/unzip/backup machinery is shared with uiPacks.js via ghDownload.

const fs   = require('fs');
const path = require('path');
const { httpsGet, unzip, backupAndWriteBinary } = require('./ghDownload');

const GH_API = 'https://api.github.com/repos/CoastalRedwood/Zeal/releases/latest';

// Map a zip entry to its destination under the EQ client folder, or null to
// skip it. Handles both flat zips and zips nested under a top-level folder:
//   <anything>/Zeal.asi            → <eqDir>/Zeal.asi
//   <anything>/uifiles/<rest...>   → <eqDir>/uifiles/<rest...>
// Everything else (readme, license, loose extras) is intentionally ignored.
function _destFor(eqDir, entryName) {
  const parts = entryName.split(/[\\/]/).filter(Boolean);
  if (parts.some(p => p === '..')) return null;             // path-traversal guard
  const base = parts[parts.length - 1];
  const uiIdx = parts.findIndex(p => p.toLowerCase() === 'uifiles');
  if (uiIdx >= 0 && uiIdx < parts.length - 1) {
    return path.join(eqDir, 'uifiles', ...parts.slice(uiIdx + 1));
  }
  if (base.toLowerCase() === 'zeal.asi' && uiIdx < 0) {
    return path.join(eqDir, 'Zeal.asi');
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

// Fetch the latest release metadata. Picks the zeal_v*.zip asset (falls back to
// any .zip). Network-only, no disk writes.
async function checkLatest() {
  const rel = await httpsGet(GH_API, { json: true });
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const zip = assets.find(a => /^zeal_v.*\.zip$/i.test(a.name))
           || assets.find(a => /\.zip$/i.test(a.name));
  if (!zip || !zip.browser_download_url) {
    throw new Error('latest Zeal release has no .zip asset');
  }
  return {
    tag:         rel.tag_name || null,
    name:        rel.name || rel.tag_name || null,
    htmlUrl:     rel.html_url || null,
    publishedAt: rel.published_at || null,
    assetName:   zip.name,
    assetUrl:    zip.browser_download_url,
    assetSize:   zip.size || 0,
  };
}

// Report what's installed locally, without touching the network.
//   installedTag — the tag we last installed (null if we never have / unknown)
//   hasZealAsi   — a Zeal.asi already sits in the folder (manual install, tag unknown)
function localStatus(eqDir, installedTag) {
  const dir = String(eqDir || '').trim();
  const hasZealAsi = !!dir && fs.existsSync(path.join(dir, 'Zeal.asi'));
  return { eqDir: dir || null, hasZealAsi, installedTag: installedTag || null };
}

// Download the release zip and install Zeal.asi + uifiles/ into eqDir, backing
// up every replaced file. Returns { ok, tag, written:[], backedUp:[] }.
// `release` may be passed in (from a prior checkLatest) to avoid a second fetch.
async function install(eqDir, { release } = {}) {
  const dir = String(eqDir || '').trim();
  if (!dir) throw new Error('no EverQuest folder set');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('EverQuest folder not found: ' + dir);
  }
  const rel = release || await checkLatest();
  const buf = await httpsGet(rel.assetUrl, { json: false });
  const entries = unzip(buf);
  const written = [], backedUp = [];
  let installedAsi = false;
  for (const e of entries) {
    const dest = _destFor(dir, e.name);
    if (!dest) continue;
    const bak = backupAndWriteBinary(dest, e.data, 'zeal');
    written.push(path.relative(dir, dest));
    if (bak) backedUp.push(path.relative(dir, bak));
    if (path.basename(dest).toLowerCase() === 'zeal.asi') installedAsi = true;
  }
  if (!installedAsi) {
    throw new Error('release zip contained no Zeal.asi — nothing installed');
  }
  return { ok: true, tag: rel.tag, name: rel.name, written, backedUp };
}

module.exports = { checkLatest, localStatus, install, _destFor };
