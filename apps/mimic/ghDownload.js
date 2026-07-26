// ghDownload.js — shared machinery for "download a GitHub release, unzip it into
// the EQ folder with backups." Used by both zealUpdater.js (Zeal.asi + uifiles/)
// and uiPacks.js (custom UI packs into uifiles/<name>/). Zero npm deps: the zip
// is unpacked with a tiny pure-JS reader over Node's built-in zlib.
//
// All of this runs on the END USER's machine, where api.github.com is reachable
// — never from the CI/agent proxy that 403s the GitHub API.

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── HTTPS GET, redirect-following ───────────────────────────────────────────
// GitHub asset browser_download_url (and the API zipball_url) 302-redirect to
// codeload / objects.githubusercontent; the API itself needs a User-Agent or it
// 403s. json:true parses the body; otherwise we resolve a Buffer (the zip).
function httpsGet(url, { json = false, redirects = 5 } = {}) {
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
      // Follow redirects (GitHub asset / zipball URLs bounce to a signed CDN link).
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpsGet(next, { json, redirects: redirects - 1 }));
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
// fine for a UI/Zeal release (dozens of small files, standard deflate).
function unzip(buf) {
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

// Monotonic-ish stamp for backup/tmp filenames. Date.now() alone would collide
// on two writes in the same millisecond, so we add a private counter.
let _seq = 0;
function stamp() { return `${Date.now()}-${_seq++}`; }

// Binary-safe backup-then-write (main.js's _backupAndWriteFile is utf8-only, and
// these payloads include .tga/.dll binaries). Copies any existing file to
// <target>.<tag>bak-<ts>, then writes atomically via .tmp + rename.
function backupAndWriteBinary(target, data, tag = 'wpk') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let backedUp = null;
  if (fs.existsSync(target)) {
    backedUp = `${target}.${tag}bak-${stamp()}`;
    fs.copyFileSync(target, backedUp);
  }
  const tmp = `${target}.tmp-${stamp()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
  return backedUp;
}

module.exports = { httpsGet, unzip, stamp, backupAndWriteBinary };
