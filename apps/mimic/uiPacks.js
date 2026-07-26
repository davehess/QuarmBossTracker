// uiPacks.js — one-click install / update for common Quarm custom UI packs
// (Nillipuss et al.), plus "apply an option layout." Same idea as zealUpdater,
// but a UI pack installs a NAMED FOLDER into uifiles/ (not Zeal.asi at the root),
// and ships alternate layouts in an Options/ subfolder that the user "applies"
// by copying files up into the main pack folder.
//
// These are all GitHub-released repos, so version detection is the release
// tag_name — identical to Zeal. Download/unzip/backup come from ghDownload.
//
// Runs on the END USER's machine (api.github.com reachable), never from the
// CI/agent proxy.

const fs   = require('fs');
const path = require('path');
const { httpsGet, unzip, backupAndWriteBinary } = require('./ghDownload');

// Curated registry of guild-blessed UI packs. `packDir` is the folder name the
// pack extracts to under uifiles/ AND the /load target; `loadCmd` is what the
// user types in-game after install.
const PACKS = [
  {
    id:      'nillipuss1080',
    name:    'Nillipuss UI — 1080p',
    repo:    'NilliP/NillipussUI_1080p',
    packDir: 'NillipussUI_1080p',
    loadCmd: '/load nillipussui_1080p 1',
    notes:   'Large, Zeal-aware UI tuned for 1080p (a good fit for the Deck at 1440×900). Requires Zeal.',
  },
  {
    id:      'nillipuss1440',
    name:    'Nillipuss UI — 1440p',
    repo:    'NilliP/NillipussUI_1440p',
    packDir: 'NillipussUI_1440p',
    loadCmd: '/load nillipussui_1440p 1',
    notes:   'The 1440p (2560×1440) large-UI variant. Requires Zeal.',
  },
];

function getPack(id) { return PACKS.find(p => p.id === id) || null; }
function listPacks() { return PACKS.map(p => ({ id: p.id, name: p.name, repo: p.repo, packDir: p.packDir, loadCmd: p.loadCmd, notes: p.notes })); }

// ── GitHub release → download URL ───────────────────────────────────────────
// Prefer a custom .zip asset the author attached (matching the pack/repo name),
// else fall back to the auto-generated source zipball (always present). Both are
// handled by the same packDir-segment install mapping below.
async function checkLatest(pack) {
  const rel = await httpsGet(`https://api.github.com/repos/${pack.repo}/releases/latest`, { json: true });
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const short = pack.repo.split('/').pop().toLowerCase();
  const custom = assets.find(a => /\.zip$/i.test(a.name || '') &&
    (a.name.toLowerCase().includes(pack.packDir.toLowerCase()) || a.name.toLowerCase().includes(short)));
  const zipUrl = (custom && custom.browser_download_url) || rel.zipball_url;
  if (!zipUrl) throw new Error(`latest ${pack.name} release has no downloadable zip`);
  return {
    tag:         rel.tag_name || null,
    name:        rel.name || rel.tag_name || null,
    htmlUrl:     rel.html_url || null,
    publishedAt: rel.published_at || null,
    assetUrl:    zipUrl,
    assetName:   (custom && custom.name) || 'source.zip',
  };
}

// Local status — no network. installed = the pack folder exists in uifiles/.
function localStatus(eqDir, pack, installedTag) {
  const dir = String(eqDir || '').trim();
  const packPath = dir ? path.join(dir, 'uifiles', pack.packDir) : null;
  const installed = !!packPath && fs.existsSync(packPath) && fs.statSync(packPath).isDirectory();
  return { eqDir: dir || null, packDir: pack.packDir, installed, installedTag: installedTag || null };
}

// Map a zip entry to its destination, or null to skip. We install ONLY the
// pack's own folder subtree: find the `<packDir>/` segment anywhere in the path
// (handles the GitHub source zipball's `<repo>-<tag>/<packDir>/…` wrapper AND a
// custom asset zipped as `<packDir>/…`) and re-root it under uifiles/.
//   …/NillipussUI_1080p/EQUI_x.xml         → uifiles/NillipussUI_1080p/EQUI_x.xml
//   …/NillipussUI_1080p/Options/QQ/x.xml   → uifiles/NillipussUI_1080p/Options/QQ/x.xml
function _destFor(eqDir, packDir, entryName) {
  const parts = entryName.split(/[\\/]/).filter(Boolean);
  if (parts.some(p => p === '..')) return null;                     // traversal guard
  const idx = parts.findIndex(p => p.toLowerCase() === packDir.toLowerCase());
  if (idx < 0 || idx === parts.length - 1) return null;            // not under the pack folder
  return path.join(eqDir, 'uifiles', ...parts.slice(idx));
}

// Download + install the pack folder into uifiles/, backing up replaced files.
async function install(eqDir, pack, { release } = {}) {
  const dir = String(eqDir || '').trim();
  if (!dir) throw new Error('no EverQuest folder set');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('EverQuest folder not found: ' + dir);
  }
  const rel = release || await checkLatest(pack);
  const buf = await httpsGet(rel.assetUrl, { json: false });
  const entries = unzip(buf);
  const written = [], backedUp = [];
  for (const e of entries) {
    const dest = _destFor(dir, pack.packDir, e.name);
    if (!dest) continue;
    const bak = backupAndWriteBinary(dest, e.data, 'ui');
    written.push(path.relative(dir, dest));
    if (bak) backedUp.push(path.relative(dir, bak));
  }
  if (!written.length) {
    throw new Error(`release zip didn't contain a ${pack.packDir}/ folder — nothing installed`);
  }
  return { ok: true, tag: rel.tag, name: rel.name, written, backedUp };
}

// ── Options (alternate layouts) ─────────────────────────────────────────────
// The pack ships alternates under uifiles/<packDir>/Options/<OptionName>/. All
// local file ops — no network.
function _optionsDir(eqDir, pack) {
  const base = path.join(String(eqDir || ''), 'uifiles', pack.packDir);
  if (!fs.existsSync(base)) return null;
  // Case-insensitive match for the "Options" folder (repo uses capital O).
  const child = fs.readdirSync(base).find(f => f.toLowerCase() === 'options'
    && fs.statSync(path.join(base, f)).isDirectory());
  return child ? path.join(base, child) : null;
}

// List the available options for an installed pack (immediate subfolders of
// Options/). Returns [] if the pack or its Options folder isn't present.
function listOptions(eqDir, pack) {
  try {
    const optDir = _optionsDir(eqDir, pack);
    if (!optDir) return [];
    return fs.readdirSync(optDir)
      .filter(f => { try { return fs.statSync(path.join(optDir, f)).isDirectory(); } catch { return false; } })
      .sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

// Apply an option: copy every file under Options/<optionName>/ up into the main
// pack folder (preserving any relative structure under the option dir), backing
// up whatever it replaces. optionName is validated against the actual list to
// block path traversal. The user runs /reloadskin afterward.
function applyOption(eqDir, pack, optionName) {
  const dir = String(eqDir || '').trim();
  const optDir = _optionsDir(dir, pack);
  if (!optDir) throw new Error(`${pack.name} isn't installed (no Options folder found)`);
  if (!listOptions(dir, pack).includes(optionName)) {
    throw new Error('unknown option: ' + optionName);
  }
  const src = path.join(optDir, optionName);
  const packRoot = path.join(dir, 'uifiles', pack.packDir);
  const written = [], backedUp = [];
  const walk = (rel) => {
    const abs = path.join(src, rel);
    for (const f of fs.readdirSync(abs)) {
      const childRel = rel ? path.join(rel, f) : f;
      const childAbs = path.join(abs, f);
      const st = fs.statSync(childAbs);
      if (st.isDirectory()) { walk(childRel); continue; }
      const dest = path.join(packRoot, childRel);
      const bak = backupAndWriteBinary(dest, fs.readFileSync(childAbs), 'ui');
      written.push(childRel);
      if (bak) backedUp.push(path.relative(dir, bak));
    }
  };
  walk('');
  if (!written.length) throw new Error(`option "${optionName}" had no files to copy`);
  return { ok: true, option: optionName, written: written.length, backedUp: backedUp.length, loadCmd: pack.loadCmd };
}

module.exports = { PACKS, getPack, listPacks, checkLatest, localStatus, install, listOptions, applyOption, _destFor };
