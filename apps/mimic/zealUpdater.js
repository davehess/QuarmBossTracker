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
// Zero npm deps: the zip is unpacked with a tiny pure-JS reader over Node's
// built-in zlib (the agent's zero-dep rule; Mimic inherits the spirit). Network
// + install run on the END USER's machine, where api.github.com is reachable —
// this module is never exercised from the CI/agent proxy that 403s the API.

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const GH_API = 'https://api.github.com/repos/CoastalRedwood/Zeal/releases/latest';

// ── HTTPS GET, redirect-following ───────────────────────────────────────────
// GitHub asset browser_download_url 302-redirects to codeload / objects.github
// -usercontent; the API itself needs a User-Agent or it 403s. json:true parses
// the body; otherwise we resolve a Buffer (the zip).
function _httpsGet(url, { json = false, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'WolfPackMimic',
        'Accept': json ? 'application/vnd.github+json' : '*/*',
      },
      timeout: 30000,
    }, (res) => {
      const code = res.statusCode || 0;
      // Follow redirects (GitHub asset URLs bounce to a signed CDN link).
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(_httpsGet(next, { json, redirects: redirects - 1 }));
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`HTTP ${code} for ${u.hostname}${u.pathname}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!json) { resolve(buf); return; }
        try { resolve(JSON.parse(buf.toString('utf8'))); }
        catch (e) { reject(new Error('bad JSON from ' + u.hostname)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ── Minimal ZIP reader (store + deflate) over the central directory ─────────
// Returns [{ name, data:Buffer }] for file entries. No ZIP64, no encryption —
// a Zeal release zip is a handful of small files, so this is plenty.
function _unzip(buf) {
  const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50;
  // Locate the End Of Central Directory record (scan back through any comment).
  let eocd = -1;
  const minScan = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minScan; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no EOCD)');
  const total  = buf.readUInt16LE(eocd + 10);
  let ptr      = buf.readUInt32LE(eocd + 16);   // start of central directory
  const out = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(ptr) !== CEN_SIG) break;
    const method   = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen  = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const cmtLen   = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name     = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + cmtLen;
    if (name.endsWith('/')) continue;   // directory entry — no data
    // Data offset lives in the LOCAL header (its name/extra lengths can differ).
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0)      data = Buffer.from(raw);                 // stored
    else if (method === 8) data = zlib.inflateRawSync(raw);        // deflate
    else throw new Error(`unsupported zip compression ${method} for ${name}`);
    out.push({ name, data });
  }
  return out;
}

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

// Binary-safe backup-then-write (main.js's _backupAndWriteFile is utf8-only and
// Zeal.asi is a DLL). Copies any existing file to <target>.zealbak-<ts>, then
// writes atomically via .tmp + rename.
function _backupAndWriteBinary(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let backedUp = null;
  if (fs.existsSync(target)) {
    backedUp = `${target}.zealbak-${_stamp()}`;
    fs.copyFileSync(target, backedUp);
  }
  const tmp = `${target}.tmp-${_stamp()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
  return backedUp;
}

// Monotonic-ish stamp for backup/tmp filenames. Date.now() would be ideal but
// callers pass a fresh value per invocation; we keep a private counter so two
// writes in the same call never collide on the tmp name.
let _seq = 0;
function _stamp() { return `${Date.now()}-${_seq++}`; }

// ── Public API ──────────────────────────────────────────────────────────────

// Fetch the latest release metadata. Picks the zeal_v*.zip asset (falls back to
// any .zip). Network-only, no disk writes.
async function checkLatest() {
  const rel = await _httpsGet(GH_API, { json: true });
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
// up every replaced file. Returns { ok, tag, written:[], backedUp:[], skipped:[] }.
// `release` may be passed in (from a prior checkLatest) to avoid a second fetch.
async function install(eqDir, { release } = {}) {
  const dir = String(eqDir || '').trim();
  if (!dir) throw new Error('no EverQuest folder set');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('EverQuest folder not found: ' + dir);
  }
  const rel = release || await checkLatest();
  const buf = await _httpsGet(rel.assetUrl, { json: false });
  const entries = _unzip(buf);
  const written = [], backedUp = [];
  let installedAsi = false;
  for (const e of entries) {
    const dest = _destFor(dir, e.name);
    if (!dest) continue;
    const bak = _backupAndWriteBinary(dest, e.data);
    written.push(path.relative(dir, dest));
    if (bak) backedUp.push(path.relative(dir, bak));
    if (dest.toLowerCase().endsWith(path.sep + 'zeal.asi')
        || path.basename(dest).toLowerCase() === 'zeal.asi') installedAsi = true;
  }
  if (!installedAsi) {
    throw new Error('release zip contained no Zeal.asi — nothing installed');
  }
  return { ok: true, tag: rel.tag, name: rel.name, written, backedUp };
}

module.exports = { checkLatest, localStatus, install, _unzip, _destFor };
