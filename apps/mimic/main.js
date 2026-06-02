// Wolf Pack Mimic — Electron main process.
//
// Responsibilities:
//   1. Locate the wolfpack-logsync agent (dev: repo; packaged: resources/agent),
//      copy it into a WRITABLE per-user dir (userData/agent) so its state files
//      (queue, stats) don't collide with a Parser.bat install — true coexistence.
//   2. Run the agent under Electron's OWN Node (ELECTRON_RUN_AS_NODE) so the user
//      needs no separate Node.js install. Picks a free port starting at 7779 so
//      a running Parser.bat on 7777 doesn't clash.
//   3. Open a real window onto the agent's dashboard. NO token wall on first
//      launch — local-only mode (no uploads) until they click "Connect to
//      Wolf Pack" and paste a token.
//   4. Open a transparent, always-on-top, click-through OVERLAY that polls
//      /api/state for live DPS + boss timers (the DnDOverlay-style parity proof).
//   5. Tray icon: show/hide window, toggle each overlay independently, master
//      "Quiet mode" toggle (uploads only, no local UI — for testers running
//      EQLogParser or GINA in parallel), in-place auto-update via
//      electron-updater.
//
// BETA. Not code-signed yet (SmartScreen will warn — "More info → Run anyway").
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog, screen } = require('electron');
const path  = require('path');
const fs    = require('fs');
const net   = require('net');
const http  = require('http');
const { spawn } = require('child_process');

// Hide the default File/Edit/View/Window/Help menubar — this is a focused
// tray app, those entries just look unfinished. Must run before window
// creation so it applies to all BrowserWindows.
Menu.setApplicationMenu(null);

// electron-updater is optional in dev (not installed when running `electron .`
// without an npm install). Tolerate its absence so unpacked launches still work.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { /* dev w/o deps */ }

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'mimic.config.json');
const AGENT_DIR   = () => path.join(app.getPath('userData'), 'agent');
const AGENT_LOG   = () => path.join(app.getPath('userData'), 'agent.log');
const BASE_PORT   = 7779; // 7777/7778 left for Parser.bat coexistence

const WOLFPACK_URL    = 'https://wolfpack.quest';
const WOLFPACK_ME_URL = 'https://wolfpack.quest/me';

let mainWindow = null;
let overlayWindow = null;
let triggerWindow = null;
let settingsWindow = null;
// Per-panel overlay windows — keyed by panel slug (e.g. "live-threat",
// "damage-done-this-session"). One window per panel; calling
// createPanelOverlay again with the same key focuses the existing window.
const panelOverlays = new Map(); // panelKey -> BrowserWindow
let tray = null;
let agentProc = null;
let agentPort = BASE_PORT;
let restartBackoff = 1000;
let quitting = false;
let updatePending = null; // { version } once an update is downloaded and ready
// Setup mode — when true, every overlay is shown + unlocked and gets an
// inline control strip with opacity / hide / lock-here. Lets a user place
// every overlay at once instead of toggling them on individually.
let setupMode = false;

// ── Config ────────────────────────────────────────────────────────────────
function defaultConfig() {
  return {
    eqPath: null,            // legacy single-folder (kept for back-compat read)
    eqPaths: [],             // multi-folder picker — every EQ install to tail
    eqPathsExcluded: [],     // auto-detected paths the user explicitly unchecked
    botUrl: 'https://wolfpackparse.up.railway.app/api/agent/encounter',
    token: null,
    showHud: true,           // DPS HUD overlay user pref
    enableTriggerTts: true,  // Trigger TTS overlay user pref
    quietMode: false,        // master "I use EQLogParser" — hides all local UI
    tellsMode: 'off',        // 'off' | 'local' | 'synced' — display ships v0.2
    onboarded: false,        // false until user dismisses or completes loading
    // Overlay positioning. Locked = click-through, lives in place. Unlocked =
    // draggable + resizable handle shown, NOT click-through, so the user can
    // reposition. Toggling lock is a pure window operation — NEVER restarts
    // the agent. Bounds persist so position survives a restart.
    overlaysLocked: true,
    hudBounds:     null,     // { x, y, width, height } | null (use default)
    triggerBounds: null,
    // Per-overlay opacity. Keyed by 'hud', 'trigger', or 'panel:<panelKey>'.
    // Defaults to 1.0 (opaque). 0.25 = mostly transparent.
    overlayOpacity: {},
  };
}
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    // Migration: old `tellsEnabled` boolean → `tellsMode` string.
    if (raw.tellsEnabled !== undefined && raw.tellsMode === undefined) {
      raw.tellsMode = raw.tellsEnabled ? 'local' : 'off';
      delete raw.tellsEnabled;
    }
    // Migration: legacy single-folder eqPath → eqPaths array. We keep eqPath
    // populated alongside eqPaths for one release so anything still reading
    // the old field gets at least the primary folder.
    if (!Array.isArray(raw.eqPaths)) {
      raw.eqPaths = raw.eqPath ? [raw.eqPath] : [];
    }
    if (!Array.isArray(raw.eqPathsExcluded)) {
      raw.eqPathsExcluded = [];
    }
    return Object.assign(defaultConfig(), raw);
  } catch { return defaultConfig(); }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
}

// ── Agent staging (read-only resources → writable userData) ─────────────────
function bundledAgentDir() {
  // Packaged: resources/agent. Dev: the repo's package.
  if (app.isPackaged) return path.join(process.resourcesPath, 'agent');
  return path.resolve(__dirname, '..', '..', 'packages', 'wolfpack-logsync');
}
function ensureWritableAgent() {
  const src = bundledAgentDir();
  const dst = AGENT_DIR();
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['index.js', 'supervisor.js', 'package.json']) {
    const s = path.join(src, f);
    if (!fs.existsSync(s)) continue;
    const d = path.join(dst, f);
    const newer = !fs.existsSync(d) || fs.statSync(s).mtimeMs > fs.statSync(d).mtimeMs;
    if (newer) fs.copyFileSync(s, d);
  }
  return path.join(dst, 'index.js');
}

// ── Free-port probe ─────────────────────────────────────────────────────────
function findFreePort(start, left = 20) {
  return new Promise((resolve) => {
    if (left <= 0) return resolve(start);
    const srv = net.createServer();
    srv.once('error', () => { srv.close(); resolve(findFreePort(start + 1, left - 1)); });
    srv.once('listening', () => srv.close(() => resolve(start)));
    srv.listen(start, '127.0.0.1');
  });
}

// ── Wait until the agent's dashboard is answering ───────────────────────────
function waitForAgent(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() > deadline) return resolve(false);
      const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1500 }, (res) => {
        res.resume(); resolve(true);
      });
      req.on('error',   () => setTimeout(tick, 500));
      req.on('timeout', () => { req.destroy(); setTimeout(tick, 500); });
    };
    tick();
  });
}

// ── Recent-line agent log (capped, persisted to disk) ───────────────────────
const LOG_TAIL_MAX = 2000;
const logTail = [];
function appendAgentLog(line) {
  logTail.push(line);
  if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  try { fs.appendFileSync(AGENT_LOG(), line); } catch {}
}

// ── Character auto-detect (largest eqlog file wins) ────────────────────────
// The agent normally infers character from log filenames itself, but some
// uploads (especially right after boot, before any combat) can land with
// character=null and show up as "(unknown)" in the admin agent fleet view.
// Detecting on the Mimic side and passing --character closes that gap.
const EQ_DEFAULT_DIRS = [
  // C: drive — most common
  'C:\\Quarm', 'C:\\Project Quarm', 'C:\\Project1999',
  'C:\\Program Files\\EverQuest', 'C:\\Program Files (x86)\\EverQuest',
  'C:\\EQ',
  // D: drive — second most common
  'D:\\Quarm', 'D:\\Project Quarm', 'D:\\Project1999', 'D:\\EQ',
  // A: / B: / E: / F: — power-user partitions (Hitya runs A:)
  'A:\\Quarm', 'A:\\Project Quarm', 'A:\\EQ',
  'B:\\Quarm', 'B:\\EQ',
  'E:\\Quarm', 'E:\\Project Quarm', 'E:\\EQ',
  'F:\\Quarm', 'F:\\Project Quarm', 'F:\\EQ',
];

// True if `dir` contains at least one EQ log file. Cheap probe — used by
// both the default-dirs scan and the walk-up-from-Mimic-exe scan below.
function _dirHasEqLogs(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some(f => /^eqlog_.+_pq\.proj\.txt$/i.test(f));
  } catch { return false; }
}

function detectEqDir(hint) {
  // 1. Honor an explicit hint (user-configured EQ path) first.
  if (hint && _dirHasEqLogs(hint)) return hint;

  // 2. Walk UP from the Mimic .exe's install dir — if a user installs
  //    Mimic inside their EQ folder (Hitya did: A:\EQ\Mimic\...), the EQ
  //    dir is one or two levels up. Stops at the drive root.
  try {
    const exePath = app.getPath('exe');
    let dir = path.dirname(exePath);
    for (let i = 0; i < 5; i++) {
      if (_dirHasEqLogs(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}

  // 3. Fall back to scanning the common default install locations.
  for (const dir of EQ_DEFAULT_DIRS) {
    if (_dirHasEqLogs(dir)) return dir;
  }

  return null;
}
function detectCharacterFromLogs(dir) {
  if (!dir) return null;
  try {
    const logs = fs.readdirSync(dir)
      .map(f => {
        const m = f.match(/^eqlog_(.+)_pq\.proj\.txt$/i);
        if (!m) return null;
        try {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          return { name: m[1], path: fullPath, size: stat.size, mtime: stat.mtimeMs };
        } catch { return null; }
      })
      .filter(Boolean);
    if (logs.length === 0) return null;
    // Largest log wins — that's the character with the most history. If
    // sizes tie, fall back to most-recently-modified.
    logs.sort((a, b) => (b.size - a.size) || (b.mtime - a.mtime));
    return { character: logs[0].name, path: logs[0].path, candidates: logs };
  } catch { return null; }
}

// ── EQ install discovery (eqgame.exe) ──────────────────────────────────────
// Scans the common EQ default dirs (and the walk-up-from-Mimic path) for
// eqgame.exe — the actual game binary, present from install regardless of
// whether the user has combat-logged yet. Returns ALL candidates so the
// settings/loading UIs can present a picker rather than guessing.
//
// `scanned` is the literal list of paths probed so we can show the user
// exactly where we looked ("we scanned these common EQ directories").
function findEqInstalls(hint) {
  const scanned = [];
  const found   = [];
  const seen    = new Set();
  const probe   = (dir, source) => {
    if (!dir) return;
    const norm = path.normalize(dir);
    if (seen.has(norm.toLowerCase())) return;
    seen.add(norm.toLowerCase());
    scanned.push(norm);
    try {
      if (!fs.existsSync(norm)) return;
      const entries = fs.readdirSync(norm);
      const hasEqgame = entries.some(f => /^eqgame\.exe$/i.test(f));
      const hasLogs   = entries.some(f => /^eqlog_.+_pq\.proj\.txt$/i.test(f));
      if (hasEqgame || hasLogs) {
        const logCount = entries.filter(f => /^eqlog_.+_pq\.proj\.txt$/i.test(f)).length;
        found.push({ path: norm, hasEqgame, hasLogs, logCount, source });
      }
    } catch { /* unreadable dir — fine */ }
  };

  // 1. Explicit override always wins (still recorded so the UI can show it).
  if (hint) probe(hint, 'override');

  // 2. Walk UP from the Mimic exe — if Mimic was installed inside the EQ dir
  //    (e.g. A:\EQ\Mimic\), eqgame.exe is one or two levels up.
  try {
    const exePath = app.getPath('exe');
    let dir = path.dirname(exePath);
    for (let i = 0; i < 5; i++) {
      probe(dir, 'walk-up');
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}

  // 3. The 14 known common EQ install paths.
  for (const dir of EQ_DEFAULT_DIRS) probe(dir, 'common');

  // Rank: eqgame.exe present beats logs-only; more logs wins as a tiebreaker.
  found.sort((a, b) => (Number(b.hasEqgame) - Number(a.hasEqgame)) || (b.logCount - a.logCount));
  return { scanned, found };
}

// ── Manual window drag (replaces broken CSS -webkit-app-region) ────────────
// Chromium's drag region implementation is buggy on transparent (WS_EX_LAYERED)
// Windows: cursor deltas are wrong, the window jumps, lags, sometimes
// teleports. Renderers signal start/end; main polls screen.getCursorScreenPoint
// at ~60fps and applies setBounds. 1:1 cursor-to-window motion, no Chromium
// hit-test path involved.
let _dragSession = null;  // { win, offsetX, offsetY, width, height, interval }
function _startWindowDrag(win) {
  if (!win || win.isDestroyed()) return;
  _stopWindowDrag();
  try {
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    _dragSession = {
      win,
      offsetX: c.x - b.x,
      offsetY: c.y - b.y,
      width:   b.width,
      height:  b.height,
      interval: null,
    };
    _dragSession.interval = setInterval(() => {
      if (!_dragSession) return;
      if (_dragSession.win.isDestroyed()) { _stopWindowDrag(); return; }
      try {
        const cur = screen.getCursorScreenPoint();
        _dragSession.win.setBounds({
          x: cur.x - _dragSession.offsetX,
          y: cur.y - _dragSession.offsetY,
          width:  _dragSession.width,
          height: _dragSession.height,
        });
      } catch {}
    }, 16);  // ~60fps
  } catch {}
}

// ── UI Studio — capture & restore EQ ini files ──────────────────────────────
// Bundles every relevant ini file for a character (plus the global
// eqclient.ini) so a player switching to a new machine can re-import in one
// click. The bot encrypts before storing; we send plaintext over HTTPS.
const UI_STUDIO_GLOBAL = ['eqclient.ini'];
function _uiStudioFilesFor(character) {
  // Quarm log files are *_pq.proj.txt; the matching ini suffix is
  // _pq.proj.ini for per-character files and bare for the globals.
  const c = String(character).trim();
  return [
    `UI_${c}_pq.proj.ini`,
    `${c}_pq.proj.ini`,
    `Sock_${c}_pq.proj.ini`,
    `Socials_${c}_pq.proj.ini`,
  ];
}
function _readUiBundle(eqDir, character) {
  const files = {};
  if (!eqDir || !character) return files;
  for (const name of [...UI_STUDIO_GLOBAL, ..._uiStudioFilesFor(character)]) {
    try {
      const fp = path.join(eqDir, name);
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp);
        if (stat.size > 0 && stat.size < 4 * 1024 * 1024) {
          files[name] = fs.readFileSync(fp, 'utf8');
        }
      }
    } catch {}
  }
  return files;
}
async function _isEqRunning() {
  // Windows: tasklist returns rows when match found; an "INFO:" line when
  // no match. We just check whether the eqgame.exe substring is in the output.
  if (process.platform !== 'win32') return false;  // dev / Linux harness
  return new Promise((resolve) => {
    try {
      const { exec } = require('child_process');
      exec('tasklist /FI "IMAGENAME eq eqgame.exe"', { timeout: 5000 }, (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(/eqgame\.exe/i.test(stdout || ''));
      });
    } catch { resolve(false); }
  });
}
function _backupAndWriteFile(targetPath, contents) {
  // Atomic-ish: backup existing first (so a partial write can be reverted),
  // then write to <target>.tmp + rename. Renaming a same-filesystem path is
  // atomic on Windows when the destination doesn't exist + via MoveFileEx
  // otherwise (Node handles it).
  const ts = Date.now();
  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, targetPath + `.bak-${ts}`);
  }
  const tmp = targetPath + `.tmp-${ts}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, targetPath);
  return targetPath + `.bak-${ts}`;
}
function _clampUiIni(contents, screenW, screenH) {
  // Walk every line; when we see XPos/YPos = N, clamp to (0, screenW - minW)
  // / (0, screenH - minH). minW/minH unknown without parsing XSize/YSize, so
  // we use a conservative 80px so a window's caption bar remains grabbable.
  if (!contents || !screenW || !screenH) return contents;
  return contents.replace(/^([ \t]*)(XPos|YPos)=(-?\d+)/gmi, (_m, indent, key, val) => {
    const n = parseInt(val, 10);
    const limit = key.toLowerCase() === 'xpos' ? Math.max(0, screenW - 80)
                                               : Math.max(0, screenH - 80);
    const clamped = Math.max(0, Math.min(n, limit));
    return `${indent}${key}=${clamped}`;
  });
}
async function _httpsJson(url, opts = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'http:' ? require('http') : require('https');
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 400)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}
function _botBaseUrl(cfg) {
  // cfg.botUrl points at /api/agent/encounter — strip to the origin.
  try { return new URL(cfg.botUrl).origin; }
  catch { return 'https://wolfpackparse.up.railway.app'; }
}
function _stopWindowDrag() {
  if (_dragSession) {
    clearInterval(_dragSession.interval);
    // Final persist — the periodic setBounds calls fire 'moved' but the
    // debounce may swallow the last one if the user lifts quickly.
    try { _persistBounds(_dragSession.persistKey, _dragSession.win); } catch {}
    _dragSession = null;
  }
}

// ── Launch the agent under Electron's Node ──────────────────────────────────
async function launchAgent() {
  if (quitting) return;
  const cfg = loadConfig();
  const agentPath = ensureWritableAgent();
  agentPort = await findFreePort(BASE_PORT);

  const args = [agentPath, '--watch', '--web-port', String(agentPort)];
  // Local-only: no token → don't pass --bot-url or --token, so the agent runs
  // dashboard + tail only and never attempts uploads (no 4xx-spam in the queue).
  if (cfg.token && cfg.botUrl) {
    args.push('--bot-url', cfg.botUrl);
    args.push('--token', cfg.token);
  }
  // Auto-detect the EQ install dir + every eqlog_*_pq.proj.txt file in it.
  // The agent REQUIRES --log <path> (one per log) or it exits with
  // "At least one --log is required" — Mimic must thread the discovered
  // paths through.
  //
  // IMPORTANT: do NOT pass a global --character. With multiple --log files
  // the agent applies one --character to EVERY log, which mis-attributes
  // an alt's combat + chat to the main (the "Wabumkin/Adiwen" bug). Each
  // log self-identifies from its filename (characterFromFilename) when no
  // --character is given, which is exactly what we want for a multi-char
  // install. Single-character installs still resolve correctly from the
  // filename, so the flag is unnecessary.
  // Multi-folder EQ discovery. Build a deduplicated set of folders to tail:
  //   1. Every cfg.eqPaths (the multi-folder picker UI saves these).
  //   2. Legacy cfg.eqPath (single-folder, kept for back-compat).
  //   3. Walk-up + 14-path autodetect (only if cfg.eqPaths is empty AND
  //      not explicitly excluded by the user).
  // Logs from all folders get appended as --log args; each self-identifies
  // from its filename so multi-char + multi-install boxers parse correctly.
  const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length > 0
                  ? cfg.eqPaths
                  : (cfg.eqPath ? [cfg.eqPath] : []);
  const excluded  = new Set((cfg.eqPathsExcluded || []).map(p => String(p || '').toLowerCase()));
  const dirSet    = new Set();
  for (const p of userPaths) {
    if (!excluded.has(String(p).toLowerCase()) && _dirHasEqLogs(p)) dirSet.add(p);
  }
  // If the user hasn't configured anything explicitly, fall back to autodetect.
  if (dirSet.size === 0) {
    const auto = detectEqDir(null);
    if (auto && !excluded.has(auto.toLowerCase())) dirSet.add(auto);
  }
  const eqDirs = [...dirSet];
  const primaryEqDir = eqDirs[0] || null;

  let totalLogs = 0;
  let firstCharacter = null;
  const allCandidates = [];
  for (const dir of eqDirs) {
    const det = detectCharacterFromLogs(dir);
    if (!det || det.candidates.length === 0) continue;
    if (!firstCharacter) firstCharacter = det.character;
    for (const c of det.candidates) {
      args.push('--log', c.path);
      allCandidates.push({ ...c, dir });
      totalLogs++;
    }
  }
  if (totalLogs > 0) {
    appendAgentLog(`[mimic] tailing ${totalLogs} log(s) across ${eqDirs.length} folder(s); each self-identifies from filename. Primary: ${firstCharacter}\n`);
    if (allCandidates.length > 1) {
      const alts = allCandidates.slice(1, 5)
        .map(c => `${c.name} (${Math.round(c.size / 1024)}KB)`).join(', ');
      appendAgentLog(`[mimic] other characters: ${alts}\n`);
    }
  } else {
    appendAgentLog(`[mimic] NO log files found across ${eqDirs.length} configured folder(s). Open Settings → EverQuest folders to add or fix.\n`);
  }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE:   '1',
    WOLFPACK_CLIENT:        'mimic',
    WOLFPACK_APP_VERSION:   app.getVersion(),
  };
  if (primaryEqDir) env.WOLFPACK_EQ_DIR = primaryEqDir;

  agentProc = spawn(process.execPath, args, {
    env,
    cwd: AGENT_DIR(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agentProc.stdout.on('data', d => { const s = `[agent] ${d}`; process.stdout.write(s); appendAgentLog(s); });
  agentProc.stderr.on('data', d => { const s = `[agent] ${d}`; process.stderr.write(s); appendAgentLog(s); });
  agentProc.on('exit', (code) => {
    agentProc = null;
    pushStatus();
    if (quitting) return;
    const marker = path.join(AGENT_DIR(), '.force-update-on-restart');
    if (fs.existsSync(marker)) { try { fs.unlinkSync(marker); } catch {} restartBackoff = 1000; return launchAgent(); }
    appendAgentLog(`[mimic] agent exited (${code}); restarting in ${restartBackoff}ms\n`);
    setTimeout(launchAgent, restartBackoff);
    restartBackoff = Math.min(restartBackoff * 2, 60000);
  });
  setTimeout(() => { if (agentProc) restartBackoff = 1000; }, 30000);

  const up = await waitForAgent(agentPort);
  // loading.html (renderer) drives the FIRST navigation to the dashboard once
  // setup is dismissed. But on a RESTART (agent hot-swap, crash-restart, or a
  // relaunch from a settings change) the dashboard window is already showing
  // the agent — and findFreePort may have landed on a DIFFERENT port than the
  // previous run (if the old process hadn't released 7779 yet). The loaded
  // page keeps polling the dead old port → every /api/state fails → blank
  // bodies even though the static shell is still there. It also still holds
  // the OLD dashboard HTML/JS after a hot-swap. Reloading the window to the
  // live port fixes both. Skipped on first launch (window is on loading.html,
  // a file:// URL — not http — so the guard below is false there).
  try {
    if (up && mainWindow && !mainWindow.isDestroyed()) {
      const cur = mainWindow.webContents.getURL() || '';
      if (/^http:\/\/127\.0\.0\.1:\d+\//.test(cur) &&
          cur.indexOf('127.0.0.1:' + agentPort + '/') === -1) {
        mainWindow.loadURL('http://127.0.0.1:' + agentPort + '/');
      }
    }
  } catch (e) { /* non-fatal — window will still self-heal if port is unchanged */ }
  pushStatus();
  return up;
}

// ── Windows ─────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#0e1116',
    title: 'Wolf Pack Mimic — Main window (Dashboard)',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // Keep the OS/Task-Manager title stable instead of letting the loaded page
  // (loading.html → the agent dashboard) overwrite it — so this process stays
  // identifiable as the main window rather than "Mimic — getting ready" etc.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.loadFile('loading.html');
  mainWindow.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWindow.hide(); } // close to tray
  });
}

// Current total screen resolution signature — the sum of all displays'
// work areas, used to detect "did the user's monitor setup change?" When it
// does, saved overlay coordinates may point off-screen, so we discard them
// and fall back to defaults instead of stranding an overlay where it can't
// be seen or grabbed.
function _screenSignature() {
  try {
    return screen.getAllDisplays()
      .map(d => `${d.bounds.x},${d.bounds.y},${d.size.width}x${d.size.height}`)
      .sort().join('|');
  } catch { return ''; }
}

// True if a bounds rect is at least partially visible on some display, so a
// saved overlay isn't restored fully off-screen (e.g. after unplugging a
// second monitor without a full resolution-signature change).
function _boundsOnScreen(b) {
  if (!b) return false;
  try {
    return screen.getAllDisplays().some(d => {
      const a = d.workArea;
      const ix = Math.max(a.x, b.x), iy = Math.max(a.y, b.y);
      const ax = Math.min(a.x + a.width, b.x + b.width), ay = Math.min(a.y + a.height, b.y + b.height);
      return (ax - ix) > 40 && (ay - iy) > 24; // at least a grabbable sliver visible
    });
  } catch { return false; }
}

// Resolve the starting bounds for an overlay: use the saved rect only if the
// screen signature still matches what it was saved under AND it's on-screen;
// otherwise use the default. This is the "persist position unless resolution
// changes" rule.
function _resolveBounds(boundsKey, sigKey, def) {
  const cfg = loadConfig();
  const saved = cfg[boundsKey];
  const savedSig = cfg[sigKey];
  if (saved && savedSig === _screenSignature() && _boundsOnScreen(saved)) {
    return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  return def;
}

// Debounced bounds persistence — writes overlay x/y/w/h + the screen
// signature to config on move/resize so position survives a restart. The
// signature lets the next launch decide whether the saved coords are still
// valid for the current monitor layout.
const _boundsSaveTimers = {};
function _persistBounds(key, win) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(_boundsSaveTimers[key]);
  _boundsSaveTimers[key] = setTimeout(() => {
    try {
      const b = win.getBounds();
      const cfg = loadConfig();
      cfg[key] = { x: b.x, y: b.y, width: b.width, height: b.height };
      cfg[key + 'Sig'] = _screenSignature();
      saveConfig(cfg);
    } catch {}
  }, 400);
}

// Apply lock state to an overlay WITHOUT restarting anything. Locked =
// click-through + not resizable + drag handle hidden (renderer). Unlocked =
// interactive + resizable + drag handle shown so the user can grab + move it.
// Iterate every overlay window with its identifying key. The key is used to
// look up per-window state in config (opacity bounds) and to address
// individual windows over IPC.
function _overlayEntries() {
  const out = [];
  if (overlayWindow && !overlayWindow.isDestroyed()) out.push(['hud',     overlayWindow]);
  if (triggerWindow && !triggerWindow.isDestroyed()) out.push(['trigger', triggerWindow]);
  for (const [panelKey, win] of panelOverlays.entries()) {
    if (win && !win.isDestroyed()) out.push(['panel:' + panelKey, win]);
  }
  return out;
}

// Apply the per-window opacity saved in config (defaults to 1.0). Called on
// window create + whenever a slider in setup mode moves.
function applyOverlayOpacity(win, key) {
  if (!win || win.isDestroyed()) return;
  const cfg = loadConfig();
  const o = (cfg.overlayOpacity || {})[key];
  const val = (typeof o === 'number' && o >= 0.15 && o <= 1.0) ? o : 1.0;
  try { win.setOpacity(val); } catch {}
}
function applyAllOverlayOpacities() {
  for (const [key, win] of _overlayEntries()) applyOverlayOpacity(win, key);
}

function applyOverlayInteractivity() {
  const cfg = loadConfig();
  // Setup mode overrides: every overlay is unlocked + visible regardless of
  // user prefs, so they can all be placed at once.
  const locked = !setupMode && cfg.overlaysLocked !== false;
  for (const [key, win] of _overlayEntries()) {
    if (locked) {
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setResizable(false);
    } else {
      win.setIgnoreMouseEvents(false);
      win.setResizable(true);
      win.showInactive();
    }
    try {
      win.webContents.send('overlay-locked', locked);
      // Tell the renderer who it is (for opacity slider IPC) and whether
      // we're in setup mode (so it can show the control strip).
      win.webContents.send('setup-mode', { active: setupMode, overlayKey: key });
    } catch {}
  }
}

// Master setup-mode toggle. ON: force-show every overlay (DPS HUD, trigger,
// every panel overlay) + unlock so the user can place them all at once.
// Also ensures HUD + trigger exist (creates them if user hid them earlier).
// OFF: restore user prefs (visibility + lock), keep opacities.
function applySetupMode(on) {
  setupMode = !!on;
  if (setupMode) {
    if (!overlayWindow) createOverlayWindow();
    if (!triggerWindow) createTriggerOverlay();
    // Force-show every overlay
    for (const [, win] of _overlayEntries()) {
      try { win.showInactive(); } catch {}
    }
  }
  applyOverlayInteractivity();
  applyOverlayVisibility();
  applyTriggerVisibility();
  applyAllOverlayOpacities();
  pushStatus();
}

// Create (or focus) a panel-overlay window for a specific dashboard panel.
// Loads the agent dashboard with ?overlay=<panelKey>; the dashboard JS
// strips chrome + hides everything except the target panel. Reuses the
// dashboard's live render loop so the overlay updates with zero
// duplication. Bounds + screen-signature persist per panelKey.
function createPanelOverlay(panelKey) {
  if (typeof panelKey !== 'string' || !panelKey) return false;
  // Normalize so caller can pass loose user input (e.g. an <h2> text);
  // matched against the dashboard's own panelKey() lowercasing.
  panelKey = panelKey.toLowerCase().trim();
  // Focus existing
  const existing = panelOverlays.get(panelKey);
  if (existing && !existing.isDestroyed()) {
    existing.showInactive();
    return true;
  }
  const boundsKey = 'panelBounds_' + panelKey;
  const sigKey    = 'panelBoundsSig_' + panelKey;
  const b = _resolveBounds(boundsKey, sigKey, { x: 100, y: 100, width: 360, height: 220 });
  const win = new BrowserWindow({
    // Descriptive title so this process is identifiable in Task Manager /
    // Alt-Tab (e.g. "Wolf Pack Mimic — DEEPS panel overlay") instead of a
    // wall of identical "Wolf Pack Mimic" entries.
    title: `Wolf Pack Mimic — ${panelKey} panel overlay`,
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 200, minHeight: 100,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  // Load the live dashboard with the overlay flag — the dashboard JS reads
  // ?overlay=<key> and applies overlay styling + single-panel filtering.
  win.loadURL(`http://127.0.0.1:${agentPort}/?overlay=${encodeURIComponent(panelKey)}`);
  win.on('moved',  () => _persistBounds(boundsKey, win));
  win.on('resize', () => _persistBounds(boundsKey, win));
  win.on('closed', () => { panelOverlays.delete(panelKey); });
  win.once('ready-to-show', () => {
    win.showInactive();
    applyOverlayInteractivity();
    applyOverlayOpacity(win, 'panel:' + panelKey);
  });
  panelOverlays.set(panelKey, win);
  return true;
}

function createOverlayWindow() {
  const b = _resolveBounds('hudBounds', 'hudBoundsSig', { x: 40, y: 40, width: 320, height: 220 });
  overlayWindow = new BrowserWindow({
    title: 'Wolf Pack Mimic — HUD overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 180, minHeight: 90,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true,
    focusable: true, // needed so it can be dragged when unlocked
    show: false,     // visibility decided from config + quiet mode below
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.loadFile('overlay.html');
  overlayWindow.on('moved',   () => _persistBounds('hudBounds', overlayWindow));
  overlayWindow.on('resize',  () => _persistBounds('hudBounds', overlayWindow));
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.webContents.send('agent-port', agentPort);
    applyOverlayVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(overlayWindow, 'hud');
  });
}

function createTriggerOverlay() {
  const b = _resolveBounds('triggerBounds', 'triggerBoundsSig', { x: 700, y: 200, width: 600, height: 200 });
  triggerWindow = new BrowserWindow({
    title: 'Wolf Pack Mimic — Triggers overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  triggerWindow.setAlwaysOnTop(true, 'screen-saver');
  triggerWindow.setVisibleOnAllWorkspaces(true);
  triggerWindow.loadFile('triggers.html');
  triggerWindow.on('moved',  () => _persistBounds('triggerBounds', triggerWindow));
  triggerWindow.on('resize', () => _persistBounds('triggerBounds', triggerWindow));
  triggerWindow.once('ready-to-show', () => {
    triggerWindow.webContents.send('agent-port', agentPort);
    applyTriggerVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(triggerWindow, 'trigger');
  });
}

function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 540, height: 560, title: 'Mimic Settings', backgroundColor: '#0e1116',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Visibility helpers (quiet mode is the master override) ─────────────────
// When overlays are UNLOCKED (positioning mode) we keep them visible
// regardless of quiet mode / pref toggles so the user can actually grab them
// — otherwise "unlock to move" would hide the thing you're trying to move.
function applyOverlayVisibility() {
  if (!overlayWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || (cfg.showHud && !cfg.quietMode);
  if (shouldShow) overlayWindow.showInactive(); else overlayWindow.hide();
}
function applyTriggerVisibility() {
  if (!triggerWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || (cfg.enableTriggerTts && !cfg.quietMode);
  if (shouldShow) triggerWindow.showInactive(); else triggerWindow.hide();
}

// ── Status + Tray ──────────────────────────────────────────────────────────
function currentStatus() {
  const cfg = loadConfig();
  const localOnly = !cfg.token;
  return {
    agentPort,
    agentRunning: !!agentProc,
    localOnly,
    quietMode: !!cfg.quietMode,
    tellsMode: cfg.tellsMode || 'off',
    showHud: !!cfg.showHud,
    enableTriggerTts: !!cfg.enableTriggerTts,
    overlaysLocked: cfg.overlaysLocked !== false,
    setupMode: !!setupMode,
    onboarded: !!cfg.onboarded,
    updatePending: updatePending ? updatePending.version : null,
    botUrl: cfg.botUrl,
  };
}
function pushStatus() {
  const s = currentStatus();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status', s);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('status', s);
  if (tray) tray.setToolTip(tooltipFor(s));
  buildTrayMenu();
}
function tooltipFor(s) {
  const v = `v${app.getVersion()}`;
  if (!s.agentRunning) return `Wolf Pack Mimic ${v} — agent starting…`;
  const mode = s.localOnly ? 'Local only' : 'Uploading';
  const quiet = s.quietMode ? ' · Quiet mode' : '';
  const upd = s.updatePending ? ` · update ${s.updatePending} ready` : '';
  return `Wolf Pack Mimic ${v} — ${mode} · port ${s.agentPort}${quiet}${upd}`;
}

function makeTrayIcon() {
  // Load the real wolf-in-mimic icon from assets/. Electron picks up the
  // @2x sibling automatically on high-DPI displays. Falls back to a plain
  // dot if the file is missing (dev mode without a built icon).
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let img;
  if (fs.existsSync(iconPath)) {
    img = nativeImage.createFromPath(iconPath);
  } else {
    img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOElEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBQAAAyEAAH8m0r3AAAAAElFTkSuQmCC'
    );
  }
  tray = new Tray(img);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const s = currentStatus();
  const v = `v${app.getVersion()}`;
  const headerLabel = s.localOnly
    ? `🐺 Wolf Pack Mimic ${v} — Local only · :${s.agentPort}`
    : `🐺 Wolf Pack Mimic ${v} — Connected · :${s.agentPort}`;

  const liveAlertsSubmenu = [
    { label: 'Trigger alerts (TTS)', type: 'checkbox', checked: s.enableTriggerTts, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.enableTriggerTts = mi.checked; saveConfig(cfg);
        if (mi.checked && !triggerWindow) createTriggerOverlay(); else applyTriggerVisibility();
        pushStatus();
      } },
    { label: 'My /tells  🔒 PRIVATE  (display ships v0.2)', submenu: [
        { label: 'Off — ignore tells',
          type: 'radio', checked: s.tellsMode === 'off',
          click: () => { const c = loadConfig(); c.tellsMode = 'off';    saveConfig(c); pushStatus(); } },
        { label: 'Local only — show on this machine',
          type: 'radio', checked: s.tellsMode === 'local',
          click: () => { const c = loadConfig(); c.tellsMode = 'local';  saveConfig(c); pushStatus(); } },
        { label: 'Synced (encrypted) — read on wolfpack.quest',
          type: 'radio', checked: s.tellsMode === 'synced',
          click: () => { const c = loadConfig(); c.tellsMode = 'synced'; saveConfig(c); pushStatus(); } },
      ] },
    { label: 'DPS HUD', type: 'checkbox', checked: s.showHud, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showHud = mi.checked; saveConfig(cfg);
        if (mi.checked && !overlayWindow) createOverlayWindow(); else applyOverlayVisibility();
        pushStatus();
      } },
    { type: 'separator' },
    // Lock toggle — unchecking makes the overlays grabbable so you can drag +
    // resize them; checking locks them click-through in place. Pure window
    // op, never restarts the agent.
    { label: s.overlaysLocked ? 'Overlays: Locked (click to move)' : 'Overlays: Unlocked — drag to position',
      type: 'checkbox', checked: !s.overlaysLocked, click: (mi) => {
        const cfg = loadConfig(); cfg.overlaysLocked = !mi.checked; saveConfig(cfg);
        applyOverlayInteractivity();
        pushStatus();
      } },
    // Setup mode — shows every overlay at once with opacity sliders so the
    // user can place + dial them all in a single pass.
    { label: setupMode ? '🛠 Exit setup mode' : '🛠 Setup mode — place all overlays',
      click: () => { applySetupMode(!setupMode); } },
  ];

  const wolfpackSubmenu = [
    { label: 'Open wolfpack.quest', click: () => shell.openExternal(WOLFPACK_URL) },
    { label: 'Open /me  (your stats)', click: () => shell.openExternal(WOLFPACK_ME_URL) },
    { type: 'separator' },
    s.localOnly
      ? { label: 'Connect to Wolf Pack…', click: openSettings }
      : { label: 'Disconnect (revert to local only)', click: async () => {
          const cfg = loadConfig(); cfg.token = null; saveConfig(cfg);
          if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); }
          pushStatus();
        } },
  ];

  const serviceSubmenu = [
    { label: s.agentRunning ? 'Status: running 🟢' : 'Status: restarting…', enabled: false },
    { label: 'Restart agent', click: async () => {
        if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); }
      } },
    { label: 'Show agent log…', click: () => shell.openPath(AGENT_LOG()) },
    { label: 'Open dashboard in browser', click: () => shell.openExternal(`http://127.0.0.1:${agentPort}/`) },
  ];

  const updateItem = updatePending
    ? { label: `Restart to install update v${updatePending.version}`, click: () => { try { autoUpdater && autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } } }
    : { label: 'Check for updates…', click: () => safeCheckForUpdates(true), enabled: !!autoUpdater };

  const menu = Menu.buildFromTemplate([
    { label: headerLabel, enabled: false },
    { type: 'separator' },
    { label: 'Show dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'I use EQLogParser / other parser (Quiet mode)', type: 'checkbox', checked: s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.quietMode = mi.checked; saveConfig(cfg);
        applyOverlayVisibility(); applyTriggerVisibility();
        pushStatus();
      } },
    { label: 'Live alerts', submenu: liveAlertsSubmenu },
    { label: 'Wolf Pack', submenu: wolfpackSubmenu },
    { label: 'Service', submenu: serviceSubmenu },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    updateItem,
    { type: 'separator' },
    { label: 'Quit Mimic', click: () => { quitting = true; if (agentProc) { try { agentProc.kill(); } catch {} } app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(tooltipFor(s));
}

// ── Auto-update ────────────────────────────────────────────────────────────
function safeCheckForUpdates(verbose) {
  if (!autoUpdater) {
    if (verbose) dialog.showMessageBox({ type: 'info', message: 'Updates aren\'t available in dev mode.' });
    return;
  }
  try {
    autoUpdater.checkForUpdates().catch((e) => {
      appendAgentLog(`[updater] check failed: ${e.message || e}\n`);
      if (verbose) dialog.showMessageBox({ type: 'info', message: `Update check failed: ${e.message || e}` });
    });
  } catch (e) {
    appendAgentLog(`[updater] check threw: ${e.message || e}\n`);
  }
}
// ── In-place AGENT hot-swap (no installer, no window restart) ───────────────
// The wolfpack-logsync agent — which does all the real work (log tail,
// encounter build, dashboard, uploads) — bumps constantly (v2.5.x) while the
// Electron shell (1.0.0) rarely changes. We update the agent in place by
// downloading the new single-file index.js (hash-verified against the bot's
// /api/agent/latest-version manifest), writing it to the writable agent dir,
// and restarting ONLY the child process. The window stays up; no .exe runs.
// The Electron shell still uses electron-updater/NSIS for its own rare changes.
let _agentUpdateInFlight = false;

function _readAgentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(AGENT_DIR(), 'package.json'), 'utf8')).version || null; }
  catch { return null; }
}
// Plain semver-ish compare (agent versions are x.y.z, no prerelease). Returns
// true if `a` is strictly newer than `b`.
function _agentVersionNewer(a, b) {
  if (!a) return false;
  if (!b) return true;
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
function _httpsGetBuffer(url) {
  const lib = new URL(url).protocol === 'http:' ? require('http') : require('https');
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      // Follow a single redirect (GitHub raw → CDN).
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(_httpsGetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function checkAgentUpdate() {
  if (_agentUpdateInFlight) return;
  _agentUpdateInFlight = true;
  try {
    const cfg = loadConfig();
    const base = _botBaseUrl(cfg);
    let manifest;
    try {
      manifest = await _httpsJson(`${base}/api/agent/latest-version`,
        cfg.token ? { headers: { 'Authorization': 'Bearer ' + cfg.token } } : {});
    } catch (e) { return; }  // bot unreachable — try again next cycle
    const latest = manifest && manifest.latest_agent_version;
    const url    = manifest && manifest.url;
    const sha    = manifest && manifest.sha256;
    if (!latest || !url) return;

    const current = _readAgentVersion();
    if (!_agentVersionNewer(latest, current)) return;  // already current/ahead

    // Respect the agent's OWN update gate — don't bounce it mid-fight, mid
    // opt-in-backfill, or with a non-empty upload queue. /api/state exposes
    // updateBlocked: <reason> | null when those conditions hold.
    try {
      const st = await _httpsJson(`http://127.0.0.1:${agentPort}/api/state`);
      if (st && st.updateBlocked) {
        appendAgentLog(`[mimic] agent ${current}→${latest} deferred: ${st.updateBlocked}\n`);
        return;
      }
    } catch {}

    appendAgentLog(`[mimic] agent update ${current} → ${latest} available; downloading…\n`);
    const buf = await _httpsGetBuffer(url);
    if (sha) {
      const crypto = require('crypto');
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (got.toLowerCase() !== String(sha).toLowerCase()) {
        // Common + benign during the Railway redeploy window: the bot still
        // serves its OLD image's sha while `url` (GitHub main) already has the
        // new file. Fail safe — keep the working agent, retry next cycle.
        appendAgentLog(`[mimic] agent update held: sha256 mismatch (bot redeploy in progress?) expected ${String(sha).slice(0,12)}… got ${got.slice(0,12)}…\n`);
        return;
      }
    }
    // Atomic write of index.js, then bump package.json version so the new code
    // (which reads ./package.json.version) reports the new version and we don't
    // re-trigger on the next poll.
    const dst = path.join(AGENT_DIR(), 'index.js');
    const tmp = dst + '.tmp-' + Date.now();
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dst);
    try {
      const pkgPath = path.join(AGENT_DIR(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.version = latest;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    } catch (e) {
      appendAgentLog(`[mimic] warn: could not bump agent package.json: ${e && e.message}\n`);
    }

    appendAgentLog(`[mimic] agent updated to ${latest}; restarting child (window stays up)\n`);
    // Restart ONLY the agent child. The exit handler relaunches via
    // launchAgent(), which re-reads the freshly-written AGENT_DIR/index.js.
    restartBackoff = 1000;
    if (agentProc) { try { agentProc.kill(); } catch {} }
    else { launchAgent(); }
  } catch (err) {
    appendAgentLog(`[mimic] agent update check failed: ${err && err.message ? err.message : err}\n`);
  } finally {
    _agentUpdateInFlight = false;
  }
}

function wireAutoUpdater() {
  if (!autoUpdater) return;
  // Pin Mimic to its own update channel so this repo's other releases (bot
  // v2.x.y, agent v2.x.y) never get mistaken for Mimic updates.
  //
  // CRITICAL — how electron-updater (v6) resolves a CUSTOM channel:
  // it scans the GitHub releases atom feed and, for a custom channel name
  // (anything other than "alpha"/"beta"), only accepts a release whose tag
  // satisfies `semver.prerelease(tag)[0] === channel`. That means the
  // release VERSION must carry the channel as its prerelease identifier —
  // i.e. `0.1.0-mimic-beta.N` — and the TAG must be plain semver (`v<ver>`)
  // so `semver.prerelease()` can parse it. A `mimic-v…` tag prefix is NOT
  // valid semver, so it parses to null and NOTHING matches → the updater
  // throws "No published versions on GitHub". (That was the beta.16 bug.)
  //
  // So the contract is, all in lockstep:
  //   • package.json version  → `0.1.0-mimic-beta.N`  (prerelease = mimic-beta)
  //   • git tag               → `v0.1.0-mimic-beta.N` (plain semver)
  //   • publish channel below → `mimic-beta`          (emits mimic-beta.yml)
  autoUpdater.channel = 'mimic-beta';
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  // Apply a downloaded shell update SILENTLY on the next normal quit (no NSIS
  // wizard, no UAC since perMachine:false). Combined with quitAndInstall(true,
  // true) on the explicit "Restart now" path, the user never sees the
  // installer again after the first manual install. Frequent updates are the
  // agent, which hot-swaps in place (no installer at all).
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    appendAgentLog(`[updater] update available: v${info && info.version}\n`);
  });
  autoUpdater.on('update-not-available', () => {
    appendAgentLog(`[updater] no update available\n`);
  });
  autoUpdater.on('download-progress', (p) => {
    appendAgentLog(`[updater] download ${Math.round(p.percent)}%\n`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updatePending = info || { version: '?' };
    appendAgentLog(`[updater] downloaded v${updatePending.version} — ready to install\n`);
    pushStatus();
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Wolf Pack Mimic — update ready',
        message: `Mimic v${updatePending.version} is ready to install.`,
        detail: 'Restart now to apply the update. Your settings and agent state are preserved.',
      }).then(({ response }) => {
        if (response === 0) { try { autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } }
      });
    }
  });
  autoUpdater.on('error', (err) => {
    appendAgentLog(`[updater] error: ${err && (err.message || err)}\n`);
  });
  // Initial + hourly. Delay 8s so the agent boot doesn't compete for bandwidth.
  setTimeout(() => safeCheckForUpdates(false), 8000);
  setInterval(() => safeCheckForUpdates(false), 60 * 60 * 1000);
}

// Agent hot-swap poll — independent of the Electron-shell updater above.
// First check 45s after boot (let the agent come up + settle), then every
// 30 min. The agent self-update gate (updateBlocked) keeps it from bouncing
// mid-fight; checkAgentUpdate is also a no-op when already current.
function scheduleAgentUpdates() {
  setTimeout(() => { checkAgentUpdate(); }, 45 * 1000);
  setInterval(() => { checkAgentUpdate(); }, 30 * 60 * 1000);
}

// ── IPC ─────────────────────────────────────────────────────────────────────
// Manual overlay drag — the renderer signals start/end when its ✥ handle
// button gets mousedown'd. We track cursor via screen.getCursorScreenPoint
// at 60fps and apply setBounds; this bypasses Chromium's broken
// app-region drag hit-test on transparent (WS_EX_LAYERED) windows.
ipcMain.handle('overlay-drag-start', (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    _startWindowDrag(win);
  } catch {}
  return true;
});
ipcMain.handle('overlay-drag-end', () => { _stopWindowDrag(); return true; });

// EQ install discovery — surfaced to the multi-folder picker UI.
ipcMain.handle('find-eq-installs', () => {
  const cfg = loadConfig();
  // Probe every user-configured path PLUS the autodetection passes. The
  // picker UI uses `scanned` to show "we looked in these paths".
  const hints = Array.isArray(cfg.eqPaths) ? cfg.eqPaths : (cfg.eqPath ? [cfg.eqPath] : []);
  const merged = { scanned: [], found: [] };
  const seen = new Set();
  for (const h of [...hints, null]) {
    const r = findEqInstalls(h);
    for (const p of r.scanned) {
      const k = p.toLowerCase();
      if (!seen.has(k)) { seen.add(k); merged.scanned.push(p); }
    }
    for (const f of r.found) {
      const k = f.path.toLowerCase();
      if (!merged.found.some(x => x.path.toLowerCase() === k)) merged.found.push(f);
    }
  }
  return merged;
});

// UI Studio — list characters available for capture across configured EQ
// folders. Returns [{ character, eqDir, ini_count, has_eqclient }, ...].
ipcMain.handle('ui-studio-list-characters', () => {
  const cfg = loadConfig();
  const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length > 0
                  ? cfg.eqPaths
                  : (cfg.eqPath ? [cfg.eqPath] : []);
  const dirs = userPaths.filter(p => _dirHasEqLogs(p));
  if (dirs.length === 0) {
    const auto = detectEqDir(null);
    if (auto) dirs.push(auto);
  }
  const out = [];
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir);
      const chars = new Set();
      // Characters known from log files
      for (const f of entries) {
        const m = f.match(/^eqlog_([^_]+)_pq\.proj\.txt$/i);
        if (m) chars.add(m[1]);
      }
      // Characters known from any per-char ini file (so we surface a char
      // even when there's no current log file but their UI settings exist).
      for (const f of entries) {
        const m = f.match(/^(?:UI_|Sock_|Socials_)?([A-Za-z]+)_pq\.proj\.ini$/i);
        if (m) chars.add(m[1]);
      }
      const hasEqClient = entries.some(f => /^eqclient\.ini$/i.test(f));
      for (const c of chars) {
        const iniCount = _uiStudioFilesFor(c)
          .filter(name => fs.existsSync(path.join(dir, name)))
          .length;
        out.push({ character: c, eqDir: dir, ini_count: iniCount, has_eqclient: hasEqClient });
      }
    } catch {}
  }
  return out;
});

// Capture: read every ini for the character, upload encrypted to the bot.
ipcMain.handle('ui-studio-capture', async (_e, params) => {
  const character = String(params?.character || '').trim();
  const eqDir     = String(params?.eqDir || '').trim();
  const label     = params?.label ? String(params.label).slice(0, 80) : null;
  if (!character || !eqDir) return { ok: false, error: 'character + eqDir required' };
  const cfg = loadConfig();
  if (!cfg.token) return { ok: false, error: 'no token configured — set it in Settings' };

  const files = _readUiBundle(eqDir, character);
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) return { ok: false, error: 'no ini files found for this character' };
  // Source resolution — we use the primary display as a best-guess. The
  // user can override at restore time if their tuning resolution differs.
  let srcW = null, srcH = null;
  try {
    const d = screen.getPrimaryDisplay();
    srcW = d.workAreaSize.width; srcH = d.workAreaSize.height;
  } catch {}

  try {
    const result = await _httpsJson(`${_botBaseUrl(cfg)}/api/agent/ui_layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.token}` },
      body: { character, label, server_short: 'pq.proj', source_width: srcW, source_height: srcH, files, agent_version: app.getVersion() },
    });
    return { ok: true, id: result?.id, file_count: fileCount };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// List snapshots for a character.
ipcMain.handle('ui-studio-list-snapshots', async (_e, character) => {
  const c = String(character || '').trim();
  const cfg = loadConfig();
  if (!c) return { ok: false, error: 'character required' };
  if (!cfg.token) return { ok: false, error: 'no token configured' };
  try {
    const r = await _httpsJson(`${_botBaseUrl(cfg)}/api/agent/ui_layout?character=${encodeURIComponent(c)}`, {
      headers: { 'Authorization': `Bearer ${cfg.token}` },
    });
    return { ok: true, snapshots: r?.snapshots || [] };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Restore: download a snapshot, refuse while EQ is running, backup +
// rewrite each file. Optionally clamp positions to the current display.
ipcMain.handle('ui-studio-restore', async (_e, params) => {
  const character = String(params?.character || '').trim();
  const snapId    = String(params?.id || '').trim();
  const eqDir     = String(params?.eqDir || '').trim();
  const clamp     = !!params?.clamp;
  if (!character || !snapId || !eqDir) return { ok: false, error: 'character + id + eqDir required' };
  const cfg = loadConfig();
  if (!cfg.token) return { ok: false, error: 'no token configured' };

  // Safety guard: never write while EQ is running. Refusal is permanent
  // for this call — the user must close EQ and click Restore again.
  if (await _isEqRunning()) {
    return { ok: false, error: 'EQ is running. Close all EverQuest instances before restoring.' };
  }

  let snap;
  try {
    snap = await _httpsJson(`${_botBaseUrl(cfg)}/api/agent/ui_layout/${encodeURIComponent(snapId)}?character=${encodeURIComponent(character)}`, {
      headers: { 'Authorization': `Bearer ${cfg.token}` },
    });
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
  if (!snap || !snap.files) return { ok: false, error: 'snapshot empty' };

  let targetW = null, targetH = null;
  try { const d = screen.getPrimaryDisplay(); targetW = d.workAreaSize.width; targetH = d.workAreaSize.height; } catch {}
  const written = [];
  const errors  = [];
  for (const [name, contents] of Object.entries(snap.files)) {
    try {
      const safeName = path.basename(name); // never let a path escape eqDir
      const targetPath = path.join(eqDir, safeName);
      const body = clamp ? _clampUiIni(contents, targetW, targetH) : contents;
      const backupPath = _backupAndWriteFile(targetPath, body);
      written.push({ name: safeName, backup: path.basename(backupPath) });
    } catch (err) {
      errors.push({ name, error: err && err.message ? err.message : String(err) });
    }
  }
  return {
    ok: errors.length === 0,
    written, errors,
    note: clamp
      ? `Wrote ${written.length} file(s). Positions clamped to ${targetW}×${targetH}.`
      : `Wrote ${written.length} file(s). Resolution unchanged.`,
  };
});

// Browse-for-folder. Used by both the Settings page "+ Add folder…" button
// and the loading.html first-run EQ-folder card.
ipcMain.handle('pick-eq-dir', async (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win || null, {
      title: 'Select your EverQuest folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
    return result.filePaths[0];
  } catch (err) {
    return null;
  }
});

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_e, cfg) => {
  saveConfig(Object.assign(loadConfig(), cfg));
  applyOverlayVisibility(); applyTriggerVisibility(); applyOverlayInteractivity();
  pushStatus();
  return true;
});
// Lock / unlock overlays — pure window op, NEVER restarts the agent.
ipcMain.handle('set-overlays-locked', (_e, locked) => {
  const cfg = loadConfig(); cfg.overlaysLocked = !!locked; saveConfig(cfg);
  applyOverlayInteractivity();
  pushStatus();
  return currentStatus();
});
ipcMain.handle('get-agent-port', () => agentPort);
ipcMain.handle('relaunch-agent', async () => { if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); } return true; });
ipcMain.handle('get-status', () => currentStatus());
ipcMain.handle('set-quiet-mode', (_e, on) => {
  const cfg = loadConfig(); cfg.quietMode = !!on; saveConfig(cfg);
  applyOverlayVisibility(); applyTriggerVisibility();
  pushStatus();
  return currentStatus();
});
ipcMain.handle('set-tells-mode', (_e, mode) => {
  const valid = ['off', 'local', 'synced'];
  const cfg = loadConfig();
  cfg.tellsMode = valid.includes(mode) ? mode : 'off';
  saveConfig(cfg);
  pushStatus();
  return currentStatus();
});
ipcMain.handle('mark-onboarded', () => {
  const cfg = loadConfig(); cfg.onboarded = true; saveConfig(cfg);
  pushStatus();
  return true;
});
// Renderer asks the main process to navigate to the agent's dashboard.
// loading.html calls this once setup is complete (or after auto-timeout).
ipcMain.handle('open-dashboard', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`http://127.0.0.1:${agentPort}/`);
  }
  return true;
});
// Gear icon on the dashboard opens the Settings window.
ipcMain.handle('open-settings', () => { openSettings(); return true; });
// "Send this panel to its own overlay window" — increment 2d of the
// customizable-dashboard work. Renderer passes a normalized panel key
// (stable <h2> prefix); spawns a transparent always-on-top window that
// loads the dashboard with ?overlay=<key> for live updates.
ipcMain.handle('create-panel-overlay', (_e, panelKey) => createPanelOverlay(panelKey));
// Master setup-mode toggle — every overlay shown + unlocked at once for
// placement; opacity sliders + lock-here buttons appear on each.
ipcMain.handle('set-setup-mode', (_e, on) => { applySetupMode(!!on); return setupMode; });
// Per-overlay opacity (renderer slider in setup mode). key matches the
// _overlayEntries() taxonomy: 'hud' | 'trigger' | 'panel:<panelKey>'.
ipcMain.handle('set-overlay-opacity', (_e, key, value) => {
  if (typeof key !== 'string' || typeof value !== 'number') return false;
  value = Math.max(0.15, Math.min(1.0, value));
  const cfg = loadConfig();
  cfg.overlayOpacity = cfg.overlayOpacity || {};
  cfg.overlayOpacity[key] = value;
  saveConfig(cfg);
  // Apply to the matching live window.
  for (const [k, win] of _overlayEntries()) if (k === key) applyOverlayOpacity(win, k);
  return true;
});
// Open an external URL in the OS default browser. Allowlist to wolfpack.quest
// and the GitHub repo so a compromised renderer can't open arbitrary links.
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string') return false;
  if (!/^https:\/\/(wolfpack\.quest|github\.com\/davehess\/QuarmBossTracker)/i.test(url)) {
    appendAgentLog(`[mimic] refused open-external: ${url}\n`);
    return false;
  }
  shell.openExternal(url);
  return true;
});
ipcMain.handle('check-for-updates', () => { safeCheckForUpdates(true); checkAgentUpdate(); return true; });
ipcMain.handle('get-agent-log-tail', (_e, lines) => {
  const n = Math.max(1, Math.min(500, lines || 80));
  return logTail.slice(-n).join('');
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createMainWindow();
  makeTrayIcon();
  wireAutoUpdater();
  scheduleAgentUpdates();

  // First launch: NO token wall. Agent boots in local-only mode; dashboard
  // works immediately. User clicks "Connect to Wolf Pack" in the tray menu
  // when they're ready to start uploading.
  await launchAgent();
  createOverlayWindow();
  createTriggerOverlay();
  pushStatus();

  // Rescue overlays if the monitor layout changes while running (unplug a
  // second display, resolution switch, etc.). If an overlay ends up off the
  // new screen, snap it back to its default position so it's never lost.
  const _rescueOverlays = () => {
    for (const [win, def] of [
      [overlayWindow, { x: 40, y: 40, width: 320, height: 220 }],
      [triggerWindow, { x: 700, y: 200, width: 600, height: 200 }],
    ]) {
      if (!win || win.isDestroyed()) continue;
      try {
        if (!_boundsOnScreen(win.getBounds())) {
          const p = screen.getPrimaryDisplay().workArea;
          win.setBounds({ x: p.x + def.x, y: p.y + def.y, width: def.width, height: def.height });
        }
      } catch {}
    }
  };
  screen.on('display-removed',          _rescueOverlays);
  screen.on('display-metrics-changed',  _rescueOverlays);
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => { quitting = true; if (agentProc) { try { agentProc.kill(); } catch {} } });
