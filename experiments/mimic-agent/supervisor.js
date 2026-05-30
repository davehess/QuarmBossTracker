#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Mimic Agent supervisor — PROTOTYPE (Path B from docs/MIMIC_AGENT.md)
//
// Demonstrates the "easy update-in-place, coexist with old agents" mechanism
// WITHOUT Electron and WITHOUT npm deps (matches the current agent's ethos).
//
// What it proves:
//   1. Version check against the bot's GET /api/agent/latest-version.
//   2. Hash-verified download of a new agent file (SHA-256 from the manifest).
//   3. Atomic swap (.tmp → rename) so a half-download never replaces a good file.
//   4. Child lifecycle: launch the agent, restart with exponential backoff on
//      crash, and relaunch after an in-place update — no external wrapper.
//   5. Free-port probe so a stale old instance on 7777 doesn't block the UI.
//
// What is STILL STUBBED (deliberately — these need real infra decisions):
//   * The download URL + manifest. Today the manifest is faked from
//     /api/agent/latest-version (which only returns a version string). A real
//     rollout needs the bot (or the GitHub release) to publish
//     { version, url, sha256 } so the integrity check has something to verify.
//   * Code signing of the supervisor itself (SmartScreen).
//
// Run:  node experiments/mimic-agent/supervisor.js --agent ./path/to/agent.js
//       (defaults to ../../packages/wolfpack-logsync/index.js for local testing)
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');
const net   = require('net');
const { spawn } = require('child_process');

const args = parseArgs(process.argv.slice(2));
const BOT_URL   = args.bot   || process.env.WOLFPACK_BOT_URL || 'https://wolfpackparse.up.railway.app/api/agent/encounter';
const AGENT_PATH = path.resolve(args.agent || path.join(__dirname, '../../packages/wolfpack-logsync/index.js'));
const CHECK_INTERVAL_MS = Number(args.interval || 10 * 60_000);  // 10 min
const BASE_PORT = Number(args.port || 7777);

let child = null;
let restartBackoffMs = 1000;
let stopping = false;

// ── Free-port probe — coexist with a stale old agent still holding 7777 ──────
function findFreePort(start, attemptsLeft = 20) {
  return new Promise((resolve) => {
    if (attemptsLeft <= 0) return resolve(start);  // give up, let the agent fail loudly
    const srv = net.createServer();
    srv.once('error', () => { srv.close(); resolve(findFreePort(start + 1, attemptsLeft - 1)); });
    srv.once('listening', () => { srv.close(() => resolve(start)); });
    srv.listen(start, '127.0.0.1');
  });
}

// ── Version check ────────────────────────────────────────────────────────────
function getJson(url, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        { method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
          headers: { 'User-Agent': 'mimic-supervisor/proto' }, timeout: timeoutMs },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

function localAgentVersion() {
  try {
    const pkg = require(path.join(path.dirname(AGENT_PATH), 'package.json'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function semverGt(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// ── Hash-verified atomic download ────────────────────────────────────────────
// Downloads `url` to a temp file, verifies sha256 (when provided), then
// renames over the destination. Returns true on a verified swap.
function downloadVerified(url, destPath, expectedSha256) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const tmp = destPath + '.download-' + process.pid;
      const out = fs.createWriteStream(tmp);
      const hash = crypto.createHash('sha256');
      const req = mod.get(u, (res) => {
        if (res.statusCode !== 200) { res.resume(); cleanup(tmp); return resolve(false); }
        res.on('data', (c) => hash.update(c));
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          const got = hash.digest('hex');
          if (expectedSha256 && got.toLowerCase() !== String(expectedSha256).toLowerCase()) {
            console.error(`[supervisor] hash mismatch: expected ${expectedSha256}, got ${got} — refusing swap`);
            cleanup(tmp);
            return resolve(false);
          }
          try { fs.renameSync(tmp, destPath); resolve(true); }
          catch (e) { console.error('[supervisor] swap failed:', e.message); cleanup(tmp); resolve(false); }
        }));
      });
      req.on('error', (e) => { console.error('[supervisor] download error:', e.message); cleanup(tmp); resolve(false); });
    } catch { resolve(false); }
  });
  function cleanup(p) { try { fs.unlinkSync(p); } catch {} }
}

async function checkForUpdate() {
  // STUB: /api/agent/latest-version only returns { latest_agent_version }.
  // A real rollout publishes { version, url, sha256 }; until then we can detect
  // a newer version but can't safely download (no url/hash) — so we log the
  // delta and let the user update via the existing path.
  const verUrl = BOT_URL.replace(/\/encounter(\?.*)?$/, '/latest-version');
  const manifest = await getJson(verUrl);
  if (!manifest) return;
  const latest = manifest.latest_agent_version;
  const local  = localAgentVersion();
  if (latest && semverGt(latest, local)) {
    if (manifest.url && manifest.sha256) {
      console.log(`[supervisor] update ${local} → ${latest}; downloading…`);
      const ok = await downloadVerified(manifest.url, AGENT_PATH, manifest.sha256);
      if (ok) { console.log('[supervisor] verified swap done — relaunching agent'); restartChild(); }
    } else {
      console.log(`[supervisor] newer agent available (${local} → ${latest}) but manifest has no url+sha256 yet (stub). Skipping auto-download.`);
    }
  }
}

// ── Child lifecycle ──────────────────────────────────────────────────────────
async function startChild() {
  if (stopping) return;
  const port = await findFreePort(BASE_PORT);
  if (port !== BASE_PORT) console.log(`[supervisor] :${BASE_PORT} busy (old agent?) — using :${port}`);
  console.log(`[supervisor] launching agent: ${AGENT_PATH} (dashboard :${port})`);
  child = spawn(process.execPath, [AGENT_PATH, '--web-port', String(port), ...passthroughArgs()], {
    stdio: 'inherit', cwd: path.dirname(AGENT_PATH),
  });
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    // Marker written by the agent on POST /api/update means "relaunch me".
    const marker = path.join(path.dirname(AGENT_PATH), '.force-update-on-restart');
    if (fs.existsSync(marker)) {
      try { fs.unlinkSync(marker); } catch {}
      console.log('[supervisor] update marker seen — relaunching immediately');
      restartBackoffMs = 1000;
      return startChild();
    }
    // Otherwise it crashed/exited — back off and restart.
    console.log(`[supervisor] agent exited (code ${code}); restarting in ${restartBackoffMs}ms`);
    setTimeout(startChild, restartBackoffMs);
    restartBackoffMs = Math.min(restartBackoffMs * 2, 60_000);
  });
  // Healthy run resets backoff.
  setTimeout(() => { if (child) restartBackoffMs = 1000; }, 30_000);
}

function restartChild() {
  if (child) { try { child.kill('SIGTERM'); } catch {} }
  // exit handler will relaunch
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; }
  }
  return o;
}
function passthroughArgs() {
  // Forward anything after `--` to the agent unchanged.
  const idx = process.argv.indexOf('--');
  return idx >= 0 ? process.argv.slice(idx + 1) : [];
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function shutdown() { stopping = true; if (child) { try { child.kill('SIGTERM'); } catch {} } process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[supervisor] Mimic agent supervisor (prototype) starting');
console.log(`[supervisor] agent=${AGENT_PATH}`);
console.log(`[supervisor] local agent version=${localAgentVersion()}`);
startChild();
checkForUpdate();
setInterval(checkForUpdate, CHECK_INTERVAL_MS);
