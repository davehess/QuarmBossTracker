'use strict';
// EverQuest file creation dates — the "EQ only starts after I change my Windows time zone" fix
// (the guild lead, 2026-11-03: "integrate this in for a fix for anyone that's having DST crashes for EQ").
//
// Players on the Project Quarm Discord found that the game starts for some people only after they change
// the Windows time zone. The cause they traced is a few game files with an INVALID CREATION DATE (the server
// files zip is the likely source; copying a file resets its date, so a fresh copy can also clear it). The
// community fix gives those files a valid creation date again. This module does the same thing without
// reading the English-only `dir` output: it asks Node for each file's creation time, so it works on any
// Windows language.
//
// It changes ONLY creation dates. Nothing inside a file is read or written. Zero dependencies; every
// outside effect (file system, PowerShell) is passed in, so test/eq-file-dates.test.js runs it all.

const fs = require('fs');
const os = require('os');
const path = require('path');

// A creation time is unusable when it is not a number, or sits outside 1980..2100. Windows stores it as a
// 64-bit count of 100 ns ticks since 1601; a value outside the range the game's own time conversion can
// handle is what makes `dir` print "The parameter is incorrect" and what breaks the local-time conversion
// when the time zone (daylight saving) changes. Real files are never older than the 1980 DOS epoch or newer
// than 2100, so anything outside is garbage, and the bounds leave every genuine date alone.
const MIN_OK_MS = Date.UTC(1980, 0, 1);
const MAX_OK_MS = Date.UTC(2100, 0, 1);
const SCAN_LIMIT = 50000;

function isBadCreationTime(stat) {
  const ms = stat && stat.birthtimeMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return true;
  return ms < MIN_OK_MS || ms >= MAX_OK_MS;
}

// Inside `root`, by path arithmetic (a symlink is never followed, so this is the only escape to guard).
function _inside(root, p) {
  const r = path.resolve(root);
  const q = path.resolve(p);
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  return norm(q).startsWith(norm(r.endsWith(path.sep) ? r : r + path.sep));
}

async function scanEqFileDates(eqDir, { fsImpl = fs, limit = SCAN_LIMIT } = {}) {
  const root = path.resolve(String(eqDir || ''));
  const P = fsImpl.promises;
  try { await P.access(path.join(root, 'eqgame.exe')); }
  catch { return { error: `eqgame.exe not found in ${root}` }; }

  const bad = [];
  let scanned = 0, errors = 0, truncated = false;
  const stack = [root];
  while (stack.length && !truncated) {
    const dir = stack.pop();
    let ents;
    try { ents = await P.readdir(dir, { withFileTypes: true }); } catch { errors++; continue; }
    for (const ent of ents) {
      if (ent.isSymbolicLink()) continue;          // never follow a link out of the folder
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(abs); continue; }
      if (!ent.isFile()) continue;
      if (scanned >= limit) { truncated = true; break; }
      scanned++;
      try {
        if (isBadCreationTime(await P.lstat(abs))) bad.push(abs);
      } catch { errors++; }
    }
  }
  return { scanned, bad, errors, truncated };
}

// The PowerShell that does the fixing. It contains NO path: the list file's location arrives in the
// WP_EQ_LIST environment variable and the file holds one absolute path per line, so no folder or file
// name is ever quoted into code (apostrophes, spaces and accents in a path cannot break or inject).
function fixScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$lines = [IO.File]::ReadAllLines($env:WP_EQ_LIST, [System.Text.Encoding]::UTF8)',
    'foreach ($p in $lines) {',
    '  if (-not $p) { continue }',
    '  try {',
    '    [IO.File]::SetCreationTimeUtc($p, [DateTime]::UtcNow)',
    '    "fixed: $p"',
    '  } catch {',
    "    $m = ($_.Exception.Message -replace '\\s+', ' ')",
    '    "FAILED: $p - $m"',
    '  }',
    '}',
  ].join('\n');
}

function _runPowerShell(script, env) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env }, encoding: 'utf8' },
      (err, stdout) => resolve({ ok: !err || !!stdout, stdout: String(stdout || ''), error: err ? err.message : null }));
  });
}

// `bad` is expected to be a fresh scan's result; each path is still re-checked to be inside eqDir, so a
// path that did not come from the scan can never reach PowerShell.
async function fixEqFileDates(eqDir, bad, { spawnImpl = _runPowerShell, fsImpl = fs, tmpDir = os.tmpdir() } = {}) {
  const root = path.resolve(String(eqDir || ''));
  const failed = [];
  const todo = [];
  for (const p of Array.isArray(bad) ? bad : []) {
    if (typeof p !== 'string' || /[\r\n\0]/.test(p) || !path.isAbsolute(p) || !_inside(root, p)) {
      failed.push({ path: String(p), msg: 'not inside the EverQuest folder' });
    } else todo.push(path.resolve(p));
  }
  let fixed = 0;
  if (todo.length) {
    const list = path.join(tmpDir, `wp-eqdates-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    try {
      await fsImpl.promises.writeFile(list, todo.join('\n'), 'utf8');
      const run = await spawnImpl(fixScript(), { WP_EQ_LIST: list });
      const done = new Set();
      for (const line of String(run.stdout || '').split(/\r?\n/)) {
        let m;
        if ((m = /^fixed: (.+)$/.exec(line))) { if (todo.includes(m[1])) done.add(m[1]); }
        else if ((m = /^FAILED: (.+?) - (.*)$/.exec(line))) failed.push({ path: m[1], msg: m[2] });
      }
      fixed = done.size;
      if (!run.ok && !fixed && !failed.length) failed.push({ path: '', msg: run.error || 'PowerShell did not run' });
    } finally {
      try { await fsImpl.promises.unlink(list); } catch { /* best effort */ }
    }
  }
  const again = await scanEqFileDates(root, { fsImpl });
  return { fixed, failed, remaining: again.error ? null : again.bad.length };
}

module.exports = { isBadCreationTime, scanEqFileDates, fixScript, fixEqFileDates, MIN_OK_MS, MAX_OK_MS, SCAN_LIMIT };
