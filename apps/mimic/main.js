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
let tray = null;
let agentProc = null;
let agentPort = BASE_PORT;
let restartBackoff = 1000;
let quitting = false;
let updatePending = null; // { version } once an update is downloaded and ready

// ── Config ────────────────────────────────────────────────────────────────
function defaultConfig() {
  return {
    eqPath: null,
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
  const eqDir     = detectEqDir(cfg.eqPath);
  const detection = detectCharacterFromLogs(eqDir);
  if (detection && detection.candidates.length > 0) {
    for (const c of detection.candidates) {
      args.push('--log', c.path);
    }
    appendAgentLog(`[mimic] tailing ${detection.candidates.length} log(s) from ${eqDir}; each self-identifies from filename. Primary: ${detection.character}\n`);
    if (detection.candidates.length > 1) {
      const alts = detection.candidates.slice(1, 5)
        .map(c => `${c.name} (${Math.round(c.size / 1024)}KB)`).join(', ');
      appendAgentLog(`[mimic] other characters: ${alts}\n`);
    }
  } else {
    // No logs found anywhere — agent will fail with "At least one --log
    // required" exactly the way it did before this fix landed. Loading
    // screen surfaces the error inline. User likely needs to set their
    // EQ path in Settings.
    appendAgentLog(`[mimic] NO log files found (eqDir=${eqDir || 'unknown'}). Set your EQ path in Settings if Quarm isn't at C:\\Quarm.\n`);
  }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE:   '1',
    // Identify uploads on the admin agent fleet board so Mimic installs
    // are visibly distinct from Parser.bat installs (agent v2.5.2+ reads
    // these and stamps every payload's agent_state with them).
    WOLFPACK_CLIENT:        'mimic',
    WOLFPACK_APP_VERSION:   app.getVersion(),
  };
  if (cfg.eqPath || eqDir) env.WOLFPACK_EQ_DIR = cfg.eqPath || eqDir;

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
  // loading.html (renderer) is responsible for navigating to the dashboard
  // once the user dismisses the setup cards or the auto-timeout fires.
  // We just push status; the renderer polls /api/state to detect ready.
  pushStatus();
  return up;
}

// ── Windows ─────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#0e1116',
    title: 'Wolf Pack Mimic (beta)',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
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
function applyOverlayInteractivity() {
  const cfg = loadConfig();
  const locked = cfg.overlaysLocked !== false; // default locked
  for (const win of [overlayWindow, triggerWindow]) {
    if (!win || win.isDestroyed()) continue;
    if (locked) {
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setResizable(false);
    } else {
      win.setIgnoreMouseEvents(false);
      win.setResizable(true);
      win.showInactive(); // make sure it's visible to grab, without stealing game focus
    }
    try { win.webContents.send('overlay-locked', locked); } catch {}
  }
}

function createOverlayWindow() {
  const b = _resolveBounds('hudBounds', 'hudBoundsSig', { x: 40, y: 40, width: 320, height: 220 });
  overlayWindow = new BrowserWindow({
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
  });
}

function createTriggerOverlay() {
  const b = _resolveBounds('triggerBounds', 'triggerBoundsSig', { x: 700, y: 200, width: 600, height: 200 });
  triggerWindow = new BrowserWindow({
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
    ? { label: `Restart to install update v${updatePending.version}`, click: () => { try { autoUpdater && autoUpdater.quitAndInstall(); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } } }
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
function wireAutoUpdater() {
  if (!autoUpdater) return;
  // Pin Mimic to its own update channel so this repo's other releases (bot
  // v2.x.y, agent v2.x.y) never get mistaken for Mimic updates. The channel
  // name matches the publish-config `channel` field in package.json, which
  // makes electron-builder emit `mimic-beta.yml` instead of `latest.yml`.
  // Releases without that file are invisible to the updater.
  autoUpdater.channel = 'mimic-beta';
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
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
        if (response === 0) { try { autoUpdater.quitAndInstall(); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } }
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

// ── IPC ─────────────────────────────────────────────────────────────────────
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
ipcMain.handle('check-for-updates', () => { safeCheckForUpdates(true); return true; });
ipcMain.handle('get-agent-log-tail', (_e, lines) => {
  const n = Math.max(1, Math.min(500, lines || 80));
  return logTail.slice(-n).join('');
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createMainWindow();
  makeTrayIcon();
  wireAutoUpdater();

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
