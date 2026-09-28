// uiPacks.js — one-click install / update for common Quarm custom UI packs
// (Nillipuss et al.), plus ticking the pack's option layouts on and off. Same idea as zealUpdater,
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
const { httpsGet, unzip, stamp, backupAndWriteBinary } = require('./ghDownload');

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
// With a tag, that release instead (ensureDefaults, for the version installed).
async function checkLatest(pack, tag) {
  const which = tag ? `tags/${encodeURIComponent(tag)}` : 'latest';
  const rel = await httpsGet(`https://api.github.com/repos/${pack.repo}/releases/${which}`, { json: true });
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
  return _installEntries(dir, pack, unzip(buf), rel);
}

// The local half of install, split out so it runs without a network. The
// options a member has ticked survive an update: they are read before the new
// files land and put back after. A fresh install has nothing ticked.
function _installEntries(dir, pack, entries, rel) {
  const packRoot = path.join(dir, 'uifiles', pack.packDir);
  const zipDefaults = _zipDefaults(entries, pack.packDir);
  let keepOn = [];
  try {
    keepOn = optionsState(dir, pack, _readDefaults(packRoot) || zipDefaults)
      .choices.filter(c => c.applied).map(c => c.id);
  } catch { keepOn = []; }
  const written = [], backedUp = [];
  for (const e of entries) {
    const dest = _destFor(dir, pack.packDir, e.name);
    if (!dest) continue;
    // Options/ holds the pack's own files, never the member's: no backup, so
    // no .uibak copies pile up inside an option folder.
    const inOptions = path.relative(packRoot, dest).split(path.sep)[0].toLowerCase() === 'options';
    let bak = null;
    if (inOptions) _writeAtomic(dest, e.data);
    else bak = backupAndWriteBinary(dest, e.data, 'ui');
    written.push(path.relative(dir, dest));
    if (bak) backedUp.push(path.relative(dir, bak));
  }
  if (!written.length) {
    throw new Error(`release zip didn't contain a ${pack.packDir}/ folder — nothing installed`);
  }
  _saveDefaults(packRoot, rel && rel.tag, zipDefaults);
  let reapplied = [];
  try { reapplied = keepOn.length ? setOptions(dir, pack, keepOn).applied : []; } catch { reapplied = []; }
  return { ok: true, tag: rel && rel.tag, name: rel && rel.name, written, backedUp, reapplied };
}

// ── Options (alternate layouts) ─────────────────────────────────────────────
// The pack ships alternates under uifiles/<packDir>/Options/<OptionName>/. All
// local file ops — no network — except ensureDefaults.
//
// Checkboxes, not one dropdown (the guild lead, 2026-09-28: "Default should be
// no options, but you should be able to choose or remove multiple options.
// Resolve which ones have overlap and make it checkboxes"). The dropdown could
// only ever ADD a layout and never showed what was on, so the pack drifted:
// Nillipuss 3.1's main bank IS the all-bags bank, and an update put it back
// over the "Bank - Default layout" a member had applied.
//
// A CHOICE is one box:
//   Options/<Name>/<files>            → "<Name>"
//   Options/<Name>/<Variant>/<files>  → "<Name>/<Variant>": the option's own
//                                        files with the variant's on top
//                                        (Theme - Colors/Purple).
// Every file lands in the pack's main folder under its own name. Two choices
// that change the same file can't both be on; everything else stacks.
//
// The pack's own copy of every file an option touches is kept in
// <packDir>/.mimic-defaults/, from the release zip. With it an untick puts the
// file back, the boxes are read off the files themselves (no second record to
// drift), and an option file identical to the default is ignored: it changes
// nothing, so it clashes with nothing (QQ Layout's hotbar, "Blue (default)").

const DEFAULTS_DIR = '.mimic-defaults';
const MANIFEST = 'manifest.json';
const OWN_FILE_RX = /\.[a-z]*(?:bak|tmp)-[0-9-]+$/i;   // our backups and temp files
const ASSET_RX = /\.(?:xml|tga|dds|bmp)$/i;

function _optionsDir(eqDir, pack) {
  const base = path.join(String(eqDir || ''), 'uifiles', pack.packDir);
  if (!fs.existsSync(base)) return null;
  // Case-insensitive match for the "Options" folder (repo uses capital O).
  const child = fs.readdirSync(base).find(f => f.toLowerCase() === 'options'
    && fs.statSync(path.join(base, f)).isDirectory());
  return child ? path.join(base, child) : null;
}

// Names in a folder, sorted, dot-names skipped (that hides .mimic-defaults).
function _ls(dir, wantDirs) {
  try {
    return fs.readdirSync(dir).filter(f => {
      if (f.startsWith('.')) return false;
      try { return fs.statSync(path.join(dir, f)).isDirectory() === wantDirs; } catch { return false; }
    }).sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}
function _read(p) { try { return fs.readFileSync(p); } catch { return null; } }
function _writeAtomic(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${stamp()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}
const _safeName = n => !!n && n !== '.' && n !== '..' && !/[\\/]/.test(n);

// The defaults as a release zip ships them: every main-folder file that some
// option also ships, keyed by lower-cased name. data null = only an option has
// that file, so taking the option off deletes it.
function _zipDefaults(entries, packDir) {
  const main = new Map(), optionNames = new Map();
  for (const e of entries) {
    const parts = e.name.split(/[\\/]/).filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === packDir.toLowerCase());
    if (idx < 0) continue;
    const rest = parts.slice(idx + 1);
    const n = rest[rest.length - 1];
    if (!_safeName(n) || OWN_FILE_RX.test(n)) continue;
    if (rest.length === 1) main.set(n.toLowerCase(), { name: n, data: e.data });
    else if (rest.length >= 3 && rest[0].toLowerCase() === 'options') optionNames.set(n.toLowerCase(), n);
  }
  const files = new Map();
  for (const [k, n] of optionNames) {
    const m = main.get(k);
    files.set(k, m ? { name: m.name, data: m.data } : { name: n, data: null });
  }
  return files;
}

function _saveDefaults(packRoot, tag, defaults) {
  const store = path.join(packRoot, DEFAULTS_DIR);
  fs.rmSync(store, { recursive: true, force: true });
  fs.mkdirSync(store, { recursive: true });
  const manifest = { tag: tag || null, files: {} };
  for (const [k, f] of defaults) {
    manifest.files[k] = { name: f.name, present: !!f.data };
    if (f.data) fs.writeFileSync(path.join(store, k), f.data);
  }
  // Written last: a manifest means the store is complete.
  fs.writeFileSync(path.join(store, MANIFEST), JSON.stringify(manifest, null, 1));
}

function _readDefaults(packRoot) {
  const store = path.join(packRoot, DEFAULTS_DIR);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(store, MANIFEST), 'utf8')); } catch { return null; }
  const files = new Map();
  for (const [k, f] of Object.entries((manifest && manifest.files) || {})) {
    if (!_safeName(k) || !f) continue;
    const data = f.present ? _read(path.join(store, k)) : null;
    if (f.present && !data) return null;               // damaged store: fetch it again
    files.set(k, { name: String(f.name || k), data });
  }
  return files;
}

// Every choice in the installed pack. A file counts when EQ would read it: it
// is a UI asset type, or the main folder has one by that name (dzbars.png
// does; Screenshot.png and Readme.txt do not). `effective` drops files that
// are byte-for-byte the default.
function _choices(packRoot, optDir, defaults) {
  const inMain = n => fs.existsSync(path.join(packRoot, n));
  const isLayout = n => !OWN_FILE_RX.test(n) && (ASSET_RX.test(n) || inMain(n));
  const filesIn = d => _ls(d, false).filter(isLayout).map(n => ({ key: n.toLowerCase(), name: n, src: path.join(d, n) }));
  const out = [];
  for (const opt of _ls(optDir, true)) {
    const own = filesIn(path.join(optDir, opt));
    const mk = (id, variant, list) => {
      const files = new Map();
      for (const f of list) files.set(f.key, f);        // a variant's file wins over its option's
      const effective = new Map();
      for (const [k, f] of files) {
        const def = defaults && defaults.get(k);
        const data = def && def.data ? _read(f.src) : null;
        if (data && data.equals(def.data)) continue;
        effective.set(k, f);
      }
      out.push({ id, option: opt, variant, files, effective });
    };
    if (own.length) mk(opt, null, own);
    for (const v of _ls(path.join(optDir, opt), true)) {
      const vf = filesIn(path.join(optDir, opt, v));
      if (vf.length) mk(opt + '/' + v, v, [...own, ...vf]);
    }
  }
  return out;
}

// Two variants of one option are alternatives even where their files don't
// overlap: 1440p's "Blue (Default)" and "Purple" change disjoint textures, and
// both on would be half of each theme.
const _sameOptionVariants = (a, b) => !!a.variant && !!b.variant && a.option === b.option;

// What the Settings card draws. applied = every file the choice changes is its
// copy right now, read off the files. Until the defaults are stored (ready
// false) nothing can be judged, so nothing reads as on.
function optionsState(eqDir, pack, defaultsOverride) {
  const dir = String(eqDir || '').trim();
  const optDir = dir ? _optionsDir(dir, pack) : null;
  if (!optDir) return { ready: false, choices: [] };
  const packRoot = path.join(dir, 'uifiles', pack.packDir);
  const defaults = defaultsOverride || _readDefaults(packRoot);
  const all = _choices(packRoot, optDir, defaults);
  const choices = all.map(c => {
    const eff = [...c.effective.values()];
    const conflicts = [];
    for (const o of all) {
      if (o === c) continue;
      const shared = eff.filter(f => o.effective.has(f.key)).map(f => f.name);
      if (shared.length || _sameOptionVariants(c, o)) conflicts.push({ id: o.id, files: shared });
    }
    const applied = !!defaults && eff.length > 0 && eff.every(f => {
      const cur = _read(path.join(packRoot, f.name));
      const mine = _read(f.src);
      return !!cur && !!mine && cur.equals(mine);
    });
    return {
      id: c.id, option: c.option, variant: c.variant,
      files: eff.map(f => f.name), conflicts, applied, noop: !!defaults && eff.length === 0,
    };
  });
  return { ready: !!defaults, choices };
}

// Make the ticked set true: every file any option changes ends up as the
// ticked choice's copy, or back to the pack default. A set where two choices
// change the same file is refused before anything is written. A file that is
// neither the default nor any option's copy is the member's own edit, so it
// is backed up before it changes.
function setOptions(eqDir, pack, ids) {
  const dir = String(eqDir || '').trim();
  const optDir = dir ? _optionsDir(dir, pack) : null;
  if (!optDir) throw new Error(`${pack.name} isn't installed (no Options folder found)`);
  const packRoot = path.join(dir, 'uifiles', pack.packDir);
  const defaults = _readDefaults(packRoot);
  if (!defaults) throw new Error(`Mimic doesn't have ${pack.name}'s default files yet`);
  const all = _choices(packRoot, optDir, defaults);
  const byId = new Map(all.map(c => [c.id, c]));
  const owner = new Map(), picked = [];
  for (const id of [...new Set((ids || []).map(String))]) {
    const c = byId.get(id);
    if (!c) throw new Error('unknown option: ' + id);
    const twin = picked.find(p => _sameOptionVariants(p, c));
    if (twin) throw new Error(`"${twin.id}" and "${id}" are two versions of ${c.option}; pick one`);
    picked.push(c);
    for (const [k, f] of c.effective) {
      if (owner.has(k)) throw new Error(`"${owner.get(k).id}" and "${id}" both change ${f.name}; pick one`);
      owner.set(k, { id, f });
    }
  }
  const known = (k, buf) => {
    const def = defaults.get(k);
    if (def && def.data && def.data.equals(buf)) return true;
    return all.some(c => { const f = c.files.get(k); const d = f && _read(f.src); return !!d && d.equals(buf); });
  };
  const touched = new Map();
  for (const c of all) for (const [k, f] of c.effective) if (!touched.has(k)) touched.set(k, f.name);
  const changed = [], backedUp = [];
  for (const [k, name] of touched) {
    const o = owner.get(k);
    const def = defaults.get(k);
    const dest = path.join(packRoot, o ? o.f.name : (def ? def.name : name));
    const target = o ? _read(o.f.src) : (def ? def.data : null);
    if (o && !target) throw new Error('could not read ' + o.f.src);
    const cur = _read(dest);
    if (target === null) {
      // Not in the pack by default: taking the option off removes it, unless
      // what is there now is the member's own.
      if (cur && known(k, cur)) { fs.unlinkSync(dest); changed.push(name); }
      continue;
    }
    if (cur && cur.equals(target)) continue;
    if (cur && !known(k, cur)) {
      const bak = backupAndWriteBinary(dest, target, 'ui');
      if (bak) backedUp.push(path.relative(dir, bak));
    } else {
      _writeAtomic(dest, target);
    }
    changed.push(name);
  }
  const applied = optionsState(dir, pack).choices.filter(c => c.applied).map(c => c.id);
  return { ok: true, applied, changed, backedUp, loadCmd: pack.loadCmd };
}

// A pack installed before this change, or by hand, has no stored defaults.
// Take them from its release zip without touching the installed files: the
// tag Mimic installed when it knows one, else the latest (a hand-installed
// older release gets the newest defaults, the closest record there is).
async function ensureDefaults(eqDir, pack, tag) {
  const dir = String(eqDir || '').trim();
  const packRoot = path.join(dir, 'uifiles', pack.packDir);
  if (_readDefaults(packRoot)) return false;
  if (!dir || !_optionsDir(dir, pack)) throw new Error(`${pack.name} isn't installed`);
  const rel = await checkLatest(pack, tag);
  const buf = await httpsGet(rel.assetUrl, { json: false });
  _saveDefaults(packRoot, rel.tag, _zipDefaults(unzip(buf), pack.packDir));
  return true;
}

module.exports = {
  PACKS, getPack, listPacks, checkLatest, localStatus, install,
  optionsState, setOptions, ensureDefaults, _destFor, _installEntries, _zipDefaults,
};
