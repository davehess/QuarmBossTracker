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
// Not code-signed yet (SmartScreen will warn — "More info → Run anyway").
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog, screen, safeStorage, Notification } = require('electron');
const path  = require('path');
const fs    = require('fs');
const net   = require('net');
const http  = require('http');
const { spawn } = require('child_process');
const { startZealWatch } = require('./zealPipe');

// Hide the default File/Edit/View/Window/Help menubar — this is a focused
// tray app, those entries just look unfinished. Must run before window
// creation so it applies to all BrowserWindows.
Menu.setApplicationMenu(null);

// ── Single-instance lock ────────────────────────────────────────────────────
// Mimic bundles + runs its own parser engine on a fixed port. Launching a
// SECOND copy (e.g. clicking the taskbar/Start-menu shortcut while one is
// already running) used to spawn a second window whose engine immediately
// exited ("Service already running") — leaving a blank "Engine failed to
// start" dashboard while the FIRST instance was fine. Now the second launch
// surrenders the lock + quits, and the running instance just surfaces its
// window (the dashboard). This must run before app.whenReady().
const _gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!_gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // A second launch was attempted — show + focus the existing window
    // instead of starting another copy.
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      } else {
        // Window was closed-to-tray and destroyed — recreate it on the dash.
        createMainWindow();
        navigateToDashboard('second-instance-recreate');
      }
    } catch (e) { /* non-fatal */ }
  });
}

// electron-updater is optional in dev (not installed when running `electron .`
// without an npm install). Tolerate its absence so unpacked launches still work.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { /* dev w/o deps */ }

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'mimic.config.json');
const AGENT_DIR   = () => path.join(app.getPath('userData'), 'agent');
const AGENT_LOG   = () => path.join(app.getPath('userData'), 'agent.log');
const ZEAL_RAW_LOG = () => path.join(app.getPath('userData'), 'zeal-raw.ndjson');
const BASE_PORT   = 7779; // 7777/7778 left for Parser.bat coexistence

const WOLFPACK_URL    = 'https://wolfpack.quest';

let mainWindow = null;
let overlayWindow = null;
let triggerWindow = null;
let charmWindow   = null;
let petsWindow    = null;
let mobInfoWindow = null;
let buffQueueWindow = null;
let whoWindow     = null;
let melodyWindow  = null;
let zealWindow    = null;
let threatWindow  = null;
let chChainWindow = null;
let tankWindow    = null;
let extTargetWindow = null;
let commandWindow = null;
let uiStudioWindow = null;
let settingsWindow = null;
// Per-panel overlay windows — keyed by panel slug (e.g. "live-threat",
// "damage-done-this-session"). One window per panel; calling
// createPanelOverlay again with the same key focuses the existing window.
const panelOverlays = new Map(); // panelKey -> BrowserWindow
// Named dashboard panels surfaced as tray "Overlays" toggles (in addition to
// the card "🪟 overlay" buttons). `key` is the emoji-stripped panel title; the
// dashboard overlay matcher resolves it to the real (emoji-titled) card via
// _pkStrip. Keep these in sync with the dashboard <h2> titles in the agent.
const PANEL_OVERLAYS = [
  { label: '💥 DEEPS — damage breakdown', key: 'deeps' },
  { label: '💚 Healing — this fight',     key: 'healing' },
  { label: '🛡 Incoming damage (tanking)', key: 'incoming damage' },
  { label: '⚔️ Threat detail',            key: 'threat detail' },
  { label: '📊 Top damage (overall)',     key: 'top damage this session' },
];
let tray = null;
let agentProc = null;
let agentPort = BASE_PORT;
let restartBackoff = 1000;
let quitting = false;
let updatePending = null; // { version } once an update is downloaded and ready
let _agentZeroLogs = false;     // agent launched with no logs (waiting for some)
let _zeroLogsRecheckTimer = null;
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
    // Overlays default OFF on a fresh install — a brand-new user shouldn't be
    // ambushed by floating windows before they've opted in. They turn these on
    // from the first-run setup page or the tray "Overlays" submenu. (Existing
    // installs keep whatever they had: loadConfig does Object.assign over the
    // saved config, and onboarded users have these persisted already.)
    showHud: false,          // DPS HUD overlay user pref
    enableTriggerTts: true,  // Trigger TTS overlay user pref — default ON
                             // so fresh installs see countdown timer rows
                             // during a raid without an extra opt-in.
                             // Existing installs keep whatever they saved.
    quietMode: false,        // master "I use EQLogParser" — hides all local UI
    // Quiet updates (default ON): a downloaded update applies silently on the
    // next quit (autoInstallOnAppQuit), so the "Restart now?" pop-up is just
    // nagging — especially when releases come in bursts. When true we skip the
    // dialog and surface the ready update as a dashboard banner + the tray
    // "Restart to install" item instead. Toggle in the tray.
    quietUpdates: true,
    // Beta release channel opt-in. Off = stable only (latest.yml). On = follow
    // prereleases AND stable (beta.yml — published alongside latest.yml on every
    // release via generateUpdatesFilesForAllChannels). A stable installer with
    // this flipped on rolls forward into the next beta automatically; flipping
    // it back off doesn't downgrade — they just stop receiving new betas until
    // stable catches up. Toggle in the tray.
    betaChannel: false,
    tellsMode: 'off',        // 'off' | 'local' | 'synced' — display ships v0.2
    onboarded: false,        // false until user dismisses or completes loading
    // Per-character "do not transmit" list. Names are case-sensitive as they
    // appear in the eqlog filename (eqlog_<Name>_pq.proj.txt → <Name>). The
    // agent honors this at the OUTERMOST boundary — excluded log files are
    // never opened. Going-forward only; doesn't touch already-uploaded data.
    excludedCharacters: [],
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
    // Per-character overlay layouts (v1.2 Phase B). When enabled, Mimic swaps
    // the overlay visibility set to the active character's saved profile as you
    // change toons (multibox: monk hides Charm, enchanter shows it). Opt-in —
    // saving the first profile flips charProfilesEnabled on. Map is
    // charLower → { show: { <flag>: bool, … }, savedAt }.
    charProfilesEnabled: false,
    charProfiles: {},
    // Auto-start Mimic when Windows logs in. Default ON — the installer also
    // writes the HKCU\…\Run key so a fresh install auto-starts on next login
    // without any in-app configuration. Users opt out via the tray "Start
    // with Windows" checkbox, which routes through Electron's
    // setLoginItemSettings to remove the Run key.
    autoStart: true,
    // Hide overlays when EverQuest isn't running. Default ON — the overlays
    // are only useful while playing, and a tester reported the floating HUDs
    // being distracting on their desktop while alt-tabbed out. Unlocking
    // (setup mode) overrides this so they can still be positioned without EQ.
    hideOverlaysWhenEqDown: true,
    // Diagnostic: dump every raw Zeal pipe object to zeal-raw.ndjson (userData).
    // Off by default — it's a "show me exactly what the pipe sends" capture for
    // protocol work, not something a normal user needs running. Toggled from the
    // tray; capped + rotated so it can't fill the disk.
    zealRawCapture: false,
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

// ── Secret-at-rest (safeStorage / OS keychain) ──────────────────────────────
// The per-user upload token is a bearer credential — anyone who can read it
// can upload as this user (exactly the "copied log file uploaded as someone
// else" class of abuse we're closing). We encrypt it at rest with Electron
// safeStorage (DPAPI on Windows, Keychain on macOS) so a leaked
// mimic.config.json — or a cloud-synced EQ folder that drags the config along
// — can't be replayed on another machine. Falls back to plaintext ONLY when
// the OS has no encryption backend (bare Linux without a keyring); Windows,
// our shipping target, always has DPAPI.
function _encryptSecret(plain) {
  if (!plain) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(String(plain)).toString('base64') };
    }
  } catch (e) { void e; }
  return { plain: String(plain) };   // last-resort, keyring unavailable
}
function _decryptSecret(box) {
  if (!box) return null;
  if (box.enc) {
    try { return safeStorage.decryptString(Buffer.from(box.enc, 'base64')); }
    catch (e) { void e; return null; }
  }
  return box.plain || null;
}

// The canonical upload token. Reads, in priority order:
//   1. cfg.session.tokenBox  — encrypted per-user token (current model)
//   2. cfg.session.token     — legacy plaintext session token (pre-safeStorage)
//   3. cfg.token             — legacy top-level pasted token (pre-per-user)
// Returns the decrypted plaintext (or null for local-only mode).
function resolveUploadToken(cfg) {
  const s = cfg.session || {};
  if (s.tokenBox) { const t = _decryptSecret(s.tokenBox); if (t) return t; }
  if (s.token)    return s.token;
  if (cfg.token)  return cfg.token;
  return null;
}

// Persist a freshly-obtained upload token (from the Discord device-link OR a
// manual /token paste) encrypted at rest, alongside the resolved identity.
// Drops every legacy plaintext field so the secret only lives in tokenBox.
// Mutates + returns cfg; caller is responsible for saveConfig.
function storeUploadToken(cfg, plain, identity) {
  cfg.session = cfg.session || {};
  cfg.session.tokenBox = _encryptSecret(plain);
  delete cfg.session.token;     // retire legacy plaintext session token
  if (identity) cfg.session.identity = identity;
  cfg.session.linked_at = cfg.session.linked_at || Date.now();
  delete cfg.token;             // retire legacy top-level pasted token
  return cfg;
}

// Strip secrets before handing config to a renderer. get-config feeds the
// onboarding + settings UIs, which never need the raw token — they render
// "connected as <name>" from status.mimicSession instead. Keeps the bearer
// out of the renderer process entirely.
// Returns a short human reason if the user hasn't finished setup, or null when
// everything's wired. Used to gate the "close to tray" behavior (we refuse to
// hide Mimic when setup is incomplete — the tray is the #1 thing people don't
// notice), the launch-time toast, and the tray-tooltip prefix.
function _setupIssue() {
  try {
    const cfg = loadConfig();
    if (!resolveUploadToken(cfg)) return 'Not signed in to Discord';
    if (!Array.isArray(cfg.eqPaths) || cfg.eqPaths.length === 0) return 'No EverQuest folder selected';
    return null;
  } catch { return null; }
}

function configForRenderer(cfg) {
  const safe = Object.assign({}, cfg);
  if (safe.session) {
    safe.session = Object.assign({}, safe.session);
    delete safe.session.tokenBox;
    delete safe.session.token;
  }
  delete safe.token;
  // Derived booleans the UI actually wants.
  safe.connected   = !!resolveUploadToken(cfg);
  safe.connectedAs = cfg.session?.identity?.display_name || null;
  return safe;
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
  // Refresh decision by VERSION, not mtime. electron-builder / asar extraction
  // does NOT preserve file mtimes, so the old `src.mtime > dst.mtime` check
  // could SKIP the copy after a Mimic update whose bundled agent happens to
  // carry an earlier mtime than the first-run userData copy. That pinned a
  // STALE agent in userData forever — the dashboard never changed across Mimic
  // updates because the OLD agent kept serving it (the blank-dashboard bug).
  // Now: copy when the bundled agent is strictly newer than what's installed
  // (or nothing is installed). We never downgrade a userData agent that the
  // hot-swap already pulled to a newer version than the bundle.
  const readVer = (dir) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; }
    catch { return null; }
  };
  const bundledVer   = readVer(src);
  const installedVer = readVer(dst);
  const refresh = !installedVer || _agentVersionNewer(bundledVer, installedVer);
  for (const f of ['index.js', 'supervisor.js', 'package.json']) {
    const s = path.join(src, f);
    if (!fs.existsSync(s)) continue;
    const d = path.join(dst, f);
    if (refresh || !fs.existsSync(d)) fs.copyFileSync(s, d);
  }
  if (refresh && bundledVer) {
    try { appendAgentLog(`[mimic] refreshed userData agent ${installedVer || '(none)'} → bundled v${bundledVer}\n`); } catch {}
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
// agent.log rotation (2026-07-07 review): the file previously grew without
// bound — the zeal connect/drop failure loop (elevation mismatch) could churn
// it indefinitely. Check size every 200 appends; at 5MB rotate to a single
// .1 sibling (older history discarded — the in-memory tail + the .1 file
// cover every real support case we've had).
let _agentLogAppends = 0;
function appendAgentLog(line) {
  logTail.push(line);
  if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  try {
    if (++_agentLogAppends % 200 === 0) {
      const p = AGENT_LOG();
      try {
        if (fs.statSync(p).size > 5 * 1024 * 1024) {
          try { fs.rmSync(p + '.1', { force: true }); } catch {}
          fs.renameSync(p, p + '.1');
        }
      } catch {}
    }
    fs.appendFileSync(AGENT_LOG(), line);
  } catch {}
}

// ── Raw Zeal capture (opt-in diagnostic) ────────────────────────────────────
// When enabled (Info tab toggle → cfg.zealRawCapture), every raw Zeal pipe
// object is appended to zeal-raw.ndjson — full and untruncated, with `data`
// un-double-encoded. This is the definitive "what does the pipe actually send"
// record; the in-app sampler only keeps the FIRST object per type, capped at
// 600 chars. Off by default. Capped + rotated (one prior kept) so a long
// session can't fill the disk. Byte counter is tracked in-process so we don't
// stat the file on every event (the pipe pushes 200+/sec).
const ZEAL_RAW_CAP_BYTES = 25 * 1024 * 1024;   // rotate at 25 MB
let zealRawCapture = false;
let _zealRawBytes  = 0;
function setZealRawCapture(on, { marker = true } = {}) {
  zealRawCapture = !!on;
  if (!zealRawCapture) return;
  // Seed the counter from the existing file so rotation stays accurate across
  // restarts / re-enables.
  try { _zealRawBytes = fs.existsSync(ZEAL_RAW_LOG()) ? fs.statSync(ZEAL_RAW_LOG()).size : 0; }
  catch { _zealRawBytes = 0; }
  if (marker) _writeZealRaw({ _capture: 'started', at: new Date().toISOString() });
}
function _writeZealRaw(obj) {
  let line;
  try { line = JSON.stringify(obj) + '\n'; } catch { return; }
  try {
    if (_zealRawBytes + line.length > ZEAL_RAW_CAP_BYTES) {
      try { fs.renameSync(ZEAL_RAW_LOG(), ZEAL_RAW_LOG() + '.1'); } catch {}
      _zealRawBytes = 0;
    }
    fs.appendFileSync(ZEAL_RAW_LOG(), line);
    _zealRawBytes += line.length;
  } catch { /* best effort */ }
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

// ── EQ log-file detection ───────────────────────────────────────────────────
// Canonical EQ log: eqlog_<Name>_pq.proj.txt exactly.
const EQ_LOG_CANONICAL_RX = /^eqlog_.+_pq\.proj\.txt$/i;
// Rotated / backup variants keep the "eqlog_<Name>_pq.proj" stem but carry an
// extra suffix the strict .txt pattern misses: .txt2 / .txt3 (players manually
// rotate the live log to keep it small — EQ slows down on multi-GB logs),
// " BACKUP.txt", ".txt.old", etc. We still want these so a rotated history
// isn't silently dropped. Lazy capture stops at "_pq.proj".
const EQ_LOG_STEM_RX = /^eqlog_(.+?)_pq\.proj/i;
// Every EQ log opens with "[<timestamp>] Welcome to EverQuest!". We use that
// signature to confirm a NON-canonical filename really is an EQ log (vs some
// unrelated eqlog_-ish file) before we tail it.
const EQ_WELCOME_RX = /^\[[^\]]+\]\s+Welcome to EverQuest!/;

// Character name from an EQ log filename, tolerant of rotation/backup suffixes.
function _characterFromLogName(filename) {
  const m = filename.match(EQ_LOG_STEM_RX);
  return m ? m[1] : null;
}

// Read just the first 256 bytes and test the EQ welcome signature on line 1.
function _firstLineIsEqWelcome(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    const line = buf.toString('utf8', 0, n).split(/\r?\n/, 1)[0];
    return EQ_WELCOME_RX.test(line);
  } catch { return false; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}

// Should Mimic treat this directory entry as an EQ log to tail? Canonical .txt
// files pass on the filename alone (cheap, and a freshly-created log may not
// have written the welcome line yet). Non-canonical files that still carry the
// eqlog_*_pq.proj stem (rotation / backup) pass only when line 1 is the EQ
// welcome signature — so renamed logs are caught without tailing arbitrary
// eqlog_-prefixed junk.
function _isEqLogFile(dir, filename) {
  if (EQ_LOG_CANONICAL_RX.test(filename)) return true;
  if (!EQ_LOG_STEM_RX.test(filename)) return false;
  return _firstLineIsEqWelcome(path.join(dir, filename));
}

// True if `dir` contains at least one EQ log file. Cheap probe — used by
// both the default-dirs scan and the walk-up-from-Mimic-exe scan below.
function _dirHasEqLogs(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some(f => _isEqLogFile(dir, f));
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
        if (!_isEqLogFile(dir, f)) return null;
        const name = _characterFromLogName(f);
        if (!name) return null;
        try {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          return { name, path: fullPath, size: stat.size, mtime: stat.mtimeMs };
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

// Resolve the EQ install folder(s) from the RUNNING eqgame.exe process(es).
// The static scan (detectEqDir) only knows a handful of common paths, so a
// non-standard install is invisible to it — but if the game is running we can
// ask Windows for the exe's full path and take its parent dir. This is what
// rescues users whose Zeal pipe connects (proving EQ is up) yet "0 folders"
// were found. Returns absolute dir paths (may or may not contain logs). Empty
// on non-Windows / when EQ isn't running / on any failure.
function getRunningEqDirs() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    try {
      const { execFile } = require('child_process');
      // Get-CimInstance ships on every supported Windows (PowerShell 5.1+) and
      // — unlike the deprecated wmic — survives Windows 11 24H2. One line per
      // running eqgame.exe with its full ExecutablePath.
      const psCmd = "Get-CimInstance Win32_Process -Filter \"Name='eqgame.exe'\" | ForEach-Object { $_.ExecutablePath }";
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) return resolve([]);
          const dirs = new Set();
          for (const line of String(stdout).split(/\r?\n/)) {
            const p = line.trim();
            if (p && /eqgame\.exe$/i.test(p)) {
              try { dirs.add(path.dirname(p)); } catch (e) { void e; }
            }
          }
          resolve([...dirs]);
        });
    } catch { resolve([]); }
  });
}

// Single source of truth for "which EQ folders should we tail." Layers, in
// priority order: user-configured (cfg.eqPaths) → static autodetect → the
// running eqgame.exe's own folder. Only returns folders that actually contain
// eqlog_*_pq.proj.txt right now. Excluded folders are honored throughout.
async function resolveEqDirsWithLogs() {
  const cfg = loadConfig();
  const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length > 0
                  ? cfg.eqPaths
                  : (cfg.eqPath ? [cfg.eqPath] : []);
  const excluded = new Set((cfg.eqPathsExcluded || []).map(p => String(p || '').toLowerCase()));
  const withLogs = new Set();
  for (const p of userPaths) {
    if (!excluded.has(String(p).toLowerCase()) && _dirHasEqLogs(p)) withLogs.add(p);
  }
  if (withLogs.size === 0) {
    const auto = detectEqDir(null);
    if (auto && !excluded.has(auto.toLowerCase())) withLogs.add(auto);
  }
  // Last resort: ask the running game. This is the path that fixes a fresh
  // install whose EQ folder is somewhere the static scan never looks.
  let runningDirs = [];
  if (withLogs.size === 0) {
    runningDirs = await getRunningEqDirs();
    for (const d of runningDirs) {
      if (!excluded.has(d.toLowerCase()) && _dirHasEqLogs(d)) withLogs.add(d);
    }
    // Persist a freshly-discovered folder so the next launch is instant and the
    // Settings UI shows it ticked.
    const found = [...withLogs];
    if (found.length > 0) {
      try {
        const c = loadConfig();
        const existing = Array.isArray(c.eqPaths) ? c.eqPaths : [];
        const merged = [...new Set([...existing, ...found])];
        if (merged.length !== existing.length) {
          c.eqPaths = merged;
          saveConfig(c);
          appendAgentLog(`[mimic] auto-detected EQ folder from the running game: ${found.join(', ')}\n`);
        }
      } catch (e) { void e; }
    }
  }
  return { dirs: [...withLogs], runningDirs };
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
      // Compute the log set once (the non-canonical check reads a few bytes
      // per candidate, so we don't want to run it twice).
      const logFiles  = entries.filter(f => _isEqLogFile(norm, f));
      const hasLogs   = logFiles.length > 0;
      if (hasEqgame || hasLogs) {
        found.push({ path: norm, hasEqgame, hasLogs, logCount: logFiles.length, source });
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
// Map an overlay window to its config bounds key, so a manual ✥-drag persists
// to the SAME key the window restores from (_resolveBounds). Without this the
// drag end persisted to `undefined`, so position never saved → every launch
// fell back to the default. THE position-reset bug.
function _boundsKeyForWindow(win) {
  if (!win) return null;
  if (win === overlayWindow) return 'hudBounds';
  if (win === triggerWindow) return 'triggerBounds';
  if (win === charmWindow)   return 'charmBounds';
  if (win === petsWindow)    return 'petsBounds';
  if (win === mobInfoWindow) return 'mobInfoBounds';
  if (win === buffQueueWindow) return 'buffQueueBounds';
  if (win === whoWindow)     return 'whoBounds';
  if (win === melodyWindow)  return 'melodyBounds';
  if (win === zealWindow)    return 'zealBounds';
  if (win === threatWindow)  return 'threatBounds';
  if (win === chChainWindow) return 'chChainBounds';
  if (win === tankWindow)    return 'tankBounds';
  if (win === extTargetWindow) return 'extTargetBounds';
  if (win === commandWindow) return 'commandBounds';
  for (const [panelKey, w] of panelOverlays.entries()) {
    if (w === win) return 'panelBounds_' + panelKey;
  }
  return null;
}
function _startWindowDrag(win, persistKey) {
  if (!win || win.isDestroyed()) return;
  _stopWindowDrag();
  try {
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // Non-focusable overlays (CH chain, set focusable:false so they never
    // steal EQ focus) can't reliably deliver the renderer's document.mouseup
    // that ends a drag — the window gets WS_EX_NOACTIVATE, the cursor slides
    // off the moving window, and mouseup lands on EQ instead. Result: the
    // 60fps setBounds stays glued to the cursor = "the overlay is stuck to my
    // mouse" (Uilnayar 2026-06-22, CH chain + threat). Make the window
    // focusable for the duration of the drag so mouseup is delivered, then
    // restore its resting focusability on drag end. isFocusable() captures the
    // resting state so we only re-disable windows that were non-focusable.
    let wasFocusable = true;
    try { wasFocusable = win.isFocusable(); } catch {}
    if (!wasFocusable) { try { win.setFocusable(true); } catch {} }
    _dragSession = {
      win,
      persistKey: persistKey || _boundsKeyForWindow(win),
      offsetX: c.x - b.x,
      offsetY: c.y - b.y,
      width:   b.width,
      height:  b.height,
      interval: null,
      restoreFocusable: !wasFocusable,
      startedAt: Date.now(),
    };
    _dragSession.interval = setInterval(() => {
      if (!_dragSession) return;
      if (_dragSession.win.isDestroyed()) { _stopWindowDrag(); return; }
      // Safety watchdog — if a drag somehow runs past 30s the mouseup was
      // missed entirely; auto-stop so the overlay can never be permanently
      // glued to the cursor. The legitimate case (positioning an overlay)
      // is always sub-second.
      if (Date.now() - _dragSession.startedAt > 30_000) { _stopWindowDrag(); return; }
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
  // CRITICAL: key the bundle by the REAL on-disk filename (exact case), never a
  // reconstructed name. EQ reads UI_<Char>_pq.proj.ini with the character's
  // canonical case at login; if Save writes back a different case (because the
  // dropdown character case differs from the file), EQ keeps reading the old
  // file and the edits silently never apply. User-confirmed: fixing the case
  // made the changes load. So we resolve each wanted name to its real entry.
  let entries = [];
  try { entries = fs.readdirSync(eqDir); } catch { return files; }
  const realByLower = new Map();          // lowercased name → real on-disk name
  for (const f of entries) realByLower.set(f.toLowerCase(), f);

  const want = [...UI_STUDIO_GLOBAL, ..._uiStudioFilesFor(character)];
  // Also pick up UI_<char>*.ini variants at any server suffix (a user who
  // swapped servers or /loadskin'd under a different suffix), by their REAL
  // name so read+write stay case-exact.
  const cLower = String(character).toLowerCase();
  for (const f of entries) {
    const m = f.match(/^UI_([A-Za-z]+).*\.ini$/i);
    if (m && m[1].toLowerCase() === cLower) want.push(f);
  }

  for (const wanted of want) {
    const real = realByLower.get(String(wanted).toLowerCase());
    if (!real || files[real]) continue;
    try {
      const fp = path.join(eqDir, real);
      const stat = fs.statSync(fp);
      if (stat.isFile() && stat.size > 0 && stat.size < 4 * 1024 * 1024) {
        files[real] = fs.readFileSync(fp, 'utf8');   // key = exact on-disk name
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
function _backupAndWriteFile(targetPath, contents, backupTag) {
  // Atomic-ish: backup existing first (so a partial write can be reverted),
  // then write to <target>.tmp + rename. Renaming a same-filesystem path is
  // atomic on Windows when the destination doesn't exist + via MoveFileEx
  // otherwise (Node handles it). backupTag labels the .bak so the user can tell
  // a UI-Studio save (no tag) from EQ's own last-written copy (tag 'eq') that a
  // deferred save replaced after logout.
  const ts = Date.now();
  const tag = backupTag ? `bak-${backupTag}` : 'bak';
  const bakPath = `${targetPath}.${tag}-${ts}`;
  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, bakPath);
  }
  const tmp = targetPath + `.tmp-${ts}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, targetPath);
  return bakPath;
}

// ── UI Studio deferred saves (apply on logout) ──────────────────────────────
// A save made while the character is logged in can't take effect: EQ keeps the
// UI layout in memory and overwrites the file on the next camp/zone/quit. So
// instead of requiring UI Studio to stay open, we persist the pending edits in
// the MAIN process and apply them automatically once the character leaves the
// Zeal pipe (= logged out → EQ has written its final layout). Survives closing
// UI Studio and a Mimic restart.
function _uiDeferFile() { return path.join(app.getPath('userData'), 'ui-studio-pending.json'); }
let _uiDeferred = [];   // [{ character, eqDir, bundle:{name:text}, tgtSuffix, queuedAt, sawActive }]
function _loadUiDeferred() {
  try {
    const fp = _uiDeferFile();
    if (fs.existsSync(fp)) { const raw = JSON.parse(fs.readFileSync(fp, 'utf8')); if (Array.isArray(raw)) _uiDeferred = raw; }
  } catch { _uiDeferred = []; }
}
function _saveUiDeferred() {
  try { fs.writeFileSync(_uiDeferFile(), JSON.stringify(_uiDeferred), 'utf8'); } catch {}
}
function _uiCharActiveInZeal(charLower) {
  for (const [name, cur] of _zealLiveByChar.entries()) {
    if (String(name).toLowerCase() !== charLower) continue;
    if (cur && cur.lastSeen && (Date.now() - cur.lastSeen) < 30000) return true;
  }
  return false;
}
function _applyDeferredEntry(entry) {
  let written = 0;
  try {
    for (const [name, contents] of Object.entries(entry.bundle || {})) {
      if (typeof contents !== 'string' || !contents.length) continue;
      if (!/^[\w.-]+\.ini$/i.test(name)) continue;
      _backupAndWriteFile(path.join(entry.eqDir, name), contents, 'eq');  // EQ's copy → .bak-eq
      written++;
    }
  } catch (err) { appendAgentLog(`[ui-studio] deferred apply failed for ${entry.character}: ${err && err.message}\n`); return false; }
  appendAgentLog(`[ui-studio] applied deferred save for ${entry.character} (${written} file(s)) after logout\n`);
  try {
    if (Notification.isSupported()) new Notification({
      title: 'UI Studio — layout applied',
      body: `${entry.character} logged out, so your saved UI layout was applied (${written} file(s)). Log back in to see it.`,
      silent: true,
    }).show();
  } catch {}
  return true;
}
let _uiDeferTickBusy = false;
async function _tickUiDeferred() {
  if (_uiDeferTickBusy || !_uiDeferred.length) return;
  _uiDeferTickBusy = true;
  try {
    let eqUp = null;   // resolved lazily, once, only if needed
    const keep = [];
    for (const entry of _uiDeferred) {
      const charLower = String(entry.character || '').toLowerCase();
      if (_uiCharActiveInZeal(charLower)) { entry.sawActive = true; keep.push(entry); continue; }
      // Not in Zeal. Apply when we previously saw it in-game (logged out now),
      // or it was never in-game AND no EverQuest is running (nothing to clobber).
      if (!entry.sawActive) {
        if (eqUp === null) { try { eqUp = await _isEqRunning(); } catch { eqUp = false; } }
        if (eqUp) { keep.push(entry); continue; }   // EQ up, char not seen → wait
      }
      // Stabilization: let EQ finish its logout write before we overwrite.
      if (Date.now() - (entry.queuedAt || 0) < 6000) { keep.push(entry); continue; }
      _applyDeferredEntry(entry);   // drop on success or failure (don't loop forever)
    }
    if (keep.length !== _uiDeferred.length) { _uiDeferred = keep; _saveUiDeferred(); }
  } finally { _uiDeferTickBusy = false; }
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
    // Restore resting non-focusable state for overlays we temporarily made
    // focusable to receive the drag-ending mouseup (CH chain etc.).
    if (_dragSession.restoreFocusable && _dragSession.win && !_dragSession.win.isDestroyed()) {
      try { _dragSession.win.setFocusable(false); } catch {}
    }
    _dragSession = null;
  }
}

// ── Zeal pipe capture (spike) ───────────────────────────────────────────────
// Connects to any running Zeal named pipe and logs a SAMPLE of the traffic to
// the agent log so we can see the real message shapes before wiring Zeal into
// the trigger evaluator. Sampling: first time we see each (pid,type) we log the
// full object; thereafter we only log a per-type running count every 60s. This
// keeps the agent log readable while still proving the stream is flowing and
// capturing one concrete example of every message type for protocol design.
// Opt-out via cfg.zealPipe === false.
let zealWatch = null;
let zealLastConnectedPids = [];
// Batched forward to the agent so the dashboard's Triggers tab can show Zeal
// status. We coalesce events into a ~2s window: one sample per type per flush
// (the agent keeps the latest), plus per-type counts, so a chatty pipe doesn't
// hammer the localhost endpoint or balloon the payload.
const _zealPending = { events: [], sampledTypes: new Set() };
function _flushZealToAgent() {
  if (!agentPort) return;
  const conn = zealLastConnectedPids;
  if (_zealPending.events.length === 0 && conn.length === 0) return;
  const body = JSON.stringify({ connectedPids: conn, events: _zealPending.events });
  _zealPending.events = [];
  _zealPending.sampledTypes.clear();
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/zeal-event', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}

// Live Zeal state per character, parsed from the gauge(2)/player(3) stream.
// Drives gauge-condition triggers. We keep the running state here in Mimic
// (cheap — updated per event) and push a condensed snapshot to the agent at a
// throttled cadence rather than forwarding 225 raw events/sec.
const _zealLiveByChar = new Map();   // character → { snapshot, dirty, pid, lastSeen }
function _zealParseData(obj) {
  // Pipe payload wraps the real data in obj.data as a JSON string.
  let inner = obj && obj.data;
  if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { return null; } }
  return inner;
}
// Character logged off (camped, client closed, or someone else logged in on
// the same client). Drop the local live state AND tell the agent to forget
// its _zealState entry — otherwise Mob Info keeps showing the camped
// character's last target forever (the "stale Dafeet" bug: switch characters
// with no target on the new one → the old entry stays the freshest WITH a
// target and wins _currentTargetState()).
function _retireZealChar(character, why, swappedTo) {
  if (!_zealLiveByChar.has(character)) return;
  _zealLiveByChar.delete(character);
  appendAgentLog(`[zeal] retired live state for ${character}${why ? ' (' + why + ')' : ''}\n`);
  if (!agentPort) return;
  // swapped_to = the character that took over this client (same-pid swap).
  // The agent forwards it to the bot so /raid can show "(swapped to X)".
  const body = JSON.stringify({ character, disconnected: true, ...(swappedTo ? { swapped_to: swappedTo } : {}) });
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/zeal-state', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}
function _zealAbsorb(obj, pid) {
  const character = obj && obj.character;
  if (!character) return;
  const type = obj.type;
  let cur = _zealLiveByChar.get(character);
  if (!cur) { cur = { snapshot: {}, dirty: false }; _zealLiveByChar.set(character, cur); }
  cur.lastSeen = Date.now();   // liveness for UI Studio's "apply on logout" watcher
  if (pid != null && cur.pid !== pid) {
    cur.pid = pid;
    // One client runs one character at a time: if another character's state
    // is still pinned to this pid, that character just logged off (character
    // switch on the same eqgame.exe — the pipe never closes for that case).
    for (const [name, other] of _zealLiveByChar) {
      if (name !== character && other.pid === pid) _retireZealChar(name, `pid ${pid} now ${character}`, character);
    }
  }
  const s = cur.snapshot;
  if (type === 2) {                                   // gauge — HP per-mille (0..1000)
    const inner = _zealParseData(obj);
    if (!Array.isArray(inner)) return;
    const self = inner.find(g => g && g.type === 1);
    const tgt  = inner.find(g => g && g.type === 6 && g.text);
    if (self) s.self_hp_pct = self.value / 10;
    if (tgt)  { s.target_name = tgt.text; s.target_hp_pct = tgt.value / 10; }
    else      { s.target_name = null; s.target_hp_pct = null; }
    // Pet — Zeal gauge slot 16 (confirmed from a live charmed-pet dump:
    // 1=self, 6=target, 16=pet). Require a name so an empty/fixed UI gauge
    // never reads as a pet. Surfaced so gauge-condition triggers + the charm
    // overlay can use live pet HP directly.
    const pet = inner.find(g => g && g.type === 16 && g.text);
    if (pet) { s.pet_name = pet.text; s.pet_hp_pct = pet.value / 10; }
    else     { s.pet_name = null; s.pet_hp_pct = null; }
    // Retain every populated gauge slot verbatim — the agent reads slot 16 for
    // the pet and keeps the full list for the diagnostic gauge dump + the
    // charm-tracker name cross-reference fallback.
    const slots = [];
    for (const g of inner) {
      if (!g || g.type == null || g.value == null) continue;
      // value=0 happens for empty slots; skip those so the array isn't noise.
      if (g.value === 0 && !g.text) continue;
      slots.push({ slot: g.type, hp_pct: g.value / 10, text: g.text || '' });
    }
    s.gauges = slots;
    // Group HP: gauge slots other than self(1)/target(6) that carry a name.
    let minPct = null, minName = null;
    for (const g of inner) {
      if (!g || g.type === 1 || g.type === 6 || !g.text || g.value == null) continue;
      const pct = g.value / 10;
      if (pct > 0 && (minPct === null || pct < minPct)) { minPct = pct; minName = g.text; }
    }
    s.group_min_hp_pct = minPct;
    s.group_min_name   = minName;
    cur.dirty = true;
  } else if (type === 3) {                            // player — zone / autoattack
    const inner = _zealParseData(obj);
    if (inner && typeof inner === 'object') {
      // Zone change clears the current target — Zeal sometimes lags a gauge
      // tick (type 2) behind the zone event, so without this we keep showing
      // the pre-zone target ("General Kizuhx" in the user's repro) until the
      // next gauge update. Same for the pet — they don't follow you zoning.
      if (s.zone !== inner.zone) {
        s.target_name   = null;
        s.target_hp_pct = null;
        s.pet_name      = null;
        s.pet_hp_pct    = null;
      }
      s.zone = inner.zone;
      s.autoattack = !!inner.autoattack;
      cur.dirty = true;
    }
  } else if (type === 1) {                            // label — buff window + casting
    const inner = _zealParseData(obj);
    if (Array.isArray(inner)) {
      // Buff slots: label IDs 45-59 (slots 0-14) and 135-140 (slots 15-20),
      // each value=buff name, meta.ticks=remaining 6s ticks. Label 134 =
      // the spell currently being cast. (Char info lives in IDs 1-13 — we
      // ignore those here.) See CoastalRedwood/Zeal named_pipe.cpp.
      // Bard short-duration songs may land in different label IDs depending
      // on Zeal build, so we ALSO capture a raw diagnostic dump of every
      // labeled entry (id + value + ticks) and forward it — the agent
      // surfaces it on /api/state.buffsRawDebug so OFF-chip tooltips can
      // show what Zeal is actually sending when a row fails to match.
      const buffs = [];
      const rawDebug = [];
      const charInfo = [];   // Zeal char-info label fields (EQType ids 1-44).
      let casting = null;
      for (const it of inner) {
        if (!it || it.type == null) continue;
        const id = it.type;
        // Char-info label ids — the classic EQ client UI "EQType" label ids.
        // Zeal queries a fixed LabelNames map and forwards whatever the client
        // populates (CoastalRedwood/Zeal named_pipe.cpp — the authoritative
        // list, confirmed against two live side-by-sides, Canopy + Manamana
        // 2026-07-07/08):
        //   1 Name · 2 Level · 3 Class · 4 Deity · 5-11 STR/STA/DEX/AGI/WIS/
        //   INT/CHA · 12 poison / 13 disease / 14 fire / 15 cold / 16 magic
        //   resists · 17 HP cur · 18 HP max · 19 HP % · 20 mana % ·
        //   21 endurance % · 22 AC (mitigation) · 23 ATK (offense) ·
        //   24/25 weight cur/max · 26 XP % · 27 AA XP % · 28 target name ·
        //   29 target HP % (NOT pet — earlier guess corrected by the source) ·
        //   30-34 group member 1-5 name · 35-39 group member 1-5 HP % ·
        //   40-44 group pet 1-5 HP % · 60-67 spell gem 1-8 name ·
        //   68 pet name · 69 pet HP % · 70 "cur/max" HP text ·
        //   71 AA points banked · 72 AA % · 73 last name · 74 title ·
        //   80 "cur/max" mana text · 81 exp per hour · 82 target pet owner ·
        //   124 mana cur · 125 mana max
        // Buff slots (45-59, 135-140) and casting (134) are parsed separately
        // below; every other label id is captured verbatim for the Info tab
        // Zeal Pipe explorer + the self HP/mana readers.
        const isBuffBand = (id >= 45 && id <= 59) || (id >= 134 && id <= 140);
        if (!isBuffBand) {
          if (it.value !== undefined && it.value !== null && it.value !== '') {
            charInfo.push({ id, value: String(it.value) });
          }
          continue;
        }
        const v = it.value;
        if (v !== undefined && v !== null && v !== '' && String(v).toLowerCase() !== 'none') {
          const ticks = it.meta && typeof it.meta.ticks === 'number' ? it.meta.ticks : null;
          rawDebug.push({ id, value: String(v), ticks });
        }
        if ((id >= 45 && id <= 59) || (id >= 135 && id <= 140)) {
          const name = it.value;
          if (name && name !== '' && String(name).toLowerCase() !== 'none') {
            const ticks = it.meta && typeof it.meta.ticks === 'number' ? it.meta.ticks : null;
            // song:true = the short-duration song window (Zeal ids 135-140,
            // 6 slots) vs the main 15-slot buff window (45-59). Rides through
            // the agent's live-state upload so /raid can show songs separately
            // and Mob Info can render "Buffs n/15 · Songs m/6".
            // slot = 1-based window position. Debuffs sitting in buff slots
            // 1-4 are cheap to dispel — the queue's "slot N" callout needs it.
            const isSongWin = (id >= 135 && id <= 140);
            buffs.push({ name: String(name), ticks, song: isSongWin, slot: isSongWin ? (id - 134) : (id - 44) });
          }
        } else if (id === 134) {
          if (it.value && it.value !== '') casting = String(it.value);
        }
      }
      // Only update when we actually saw buff/casting labels — a char-info-only
      // label message shouldn't wipe the buff list.
      if (buffs.length > 0 || casting !== null) {
        s.buffs = buffs;
        s.casting = casting;
        cur.dirty = true;
      }
      // Always refresh the raw debug dump — it's the diagnostic channel and
      // should reflect the latest Type 1 message even if no recognized buff
      // slot changed.
      if (rawDebug.length > 0) {
        s.buffsRawDebug = rawDebug.slice(0, 30);
        cur.dirty = true;
      }
      // Char-info: surface it for the diagnostic + detect the player's own raw
      // HP numbers from it. A char-info-only label packet must still forward
      // (it never carries buffs), so mark dirty when we captured any.
      if (charInfo.length > 0) {
        s.charInfo = charInfo.slice(0, 80);
        _detectSelfHp(cur, s, charInfo);
        _detectSelfMana(s, charInfo);
        cur.dirty = true;
      }
    }
  } else if (type === 4) {                            // custom — in-game /pipe <text>
    // The player typed /pipe <string> in EQ — Zeal forwards the raw string.
    // Keep a small recent ring per character for the Info tab explorer; this
    // is also the future hook for in-game → Mimic commands ("/pipe timer 30").
    const inner = _zealParseData(obj);
    const text = typeof inner === 'string' ? inner
               : (inner && typeof inner.text === 'string') ? inner.text
               : (inner != null ? JSON.stringify(inner) : null);
    if (text) {
      if (!Array.isArray(s.custom_recent)) s.custom_recent = [];
      s.custom_recent.push({ at: Date.now(), text: String(text).slice(0, 300) });
      while (s.custom_recent.length > 8) s.custom_recent.shift();
      cur.dirty = true;
    }
  }
}

// Discover the player's OWN current/max HP from Zeal's char-info fields.
// Ids 1-13 are a CONFIRMED non-HP block (name/level/class/deity/stats/
// resists — Canopy side-by-side, 2026-07-07), so only the 14-44 band is
// scanned. Candidates are validated against the gauge's already-trusted HP%:
//   • The classic UI EQTypes put current HP at label 17 and max HP at 18 —
//     if that exact pair is present and its ratio matches the gauge, pin it
//     immediately (known-prior fast path, still data-validated).
//   • Any other (cur ≤ max) pair must match the gauge at TWO readings at
//     least 3 points apart before it pins. A real HP pair tracks the gauge
//     at every level; a coincidental stat or mana pair matches only near one
//     fixed ratio, so requiring agreement at two distinct HP levels
//     eliminates it (a druid's 3406 mana vs 1662 HP would beat any
//     size-based tiebreak — only behavior over time separates them).
// Once pinned, the pair is read at any % (tracks max-HP buffs live) and kept
// while it still agrees with the gauge. If nothing validates, self_hp_cur/max
// stay null and every overlay falls back to the plain % it already shows.
function _detectSelfHp(cur, s, charInfo) {
  const nums = charInfo
    .map(ci => ({ id: ci.id, n: Number(ci.value) }))
    .filter(x => x.id >= 14 && x.id <= 44 && Number.isFinite(x.n) && x.n > 0);
  if (nums.length < 2) return;
  const pct = (typeof s.self_hp_pct === 'number') ? s.self_hp_pct : null;
  // Stickiness: keep the pinned pair while it still tracks the gauge. A wrong
  // pin (coincidental ratio) self-evicts as soon as the ratios diverge.
  if (cur.hpIds && pct != null) {
    const c0 = nums.find(x => x.id === cur.hpIds.curId);
    const m0 = nums.find(x => x.id === cur.hpIds.maxId);
    if (c0 && m0 && m0.n > 0 && c0.n <= m0.n) {
      const err0 = Math.abs((c0.n / m0.n) * 100 - pct);
      if (err0 <= 2) { s.self_hp_cur = c0.n; s.self_hp_max = m0.n; return; }
    }
    cur.hpIds = null;   // stopped tracking — was a coincidence, relearn
  }
  // Known-prior fast path: EQType 17/18 — CONFIRMED cur/max HP (Canopy
  // side-by-side 2026-07-08: 17=1422, 18=1662 vs in-game 1425/1662). Since
  // the ids are field-verified, pin at ANY HP level when the ratio agrees —
  // including full HP, where the generic learner can't (cur == max matches
  // every full bar). Without this, raw numbers only appeared after the first
  // hit of the session.
  if (pct != null && !cur.hpIds) {
    const c17 = nums.find(x => x.id === 17);
    const m18 = nums.find(x => x.id === 18);
    if (c17 && m18 && c17.n <= m18.n && Math.abs((c17.n / m18.n) * 100 - pct) <= 1.5) {
      cur.hpIds = { curId: 17, maxId: 18 };
    }
  }
  // Generic fallback (no 17/18 on this client): learn only when HP is
  // distinct from full (< 97%) so cur ≠ max.
  if (pct != null && pct < 97) {
    if (!cur.hpIds) {
      // Generic scan with two-point agreement. _hpCand remembers, per id
      // pair, the HP% it last matched at; a second match ≥3 points away
      // proves the pair FOLLOWS the gauge rather than crossing it once.
      if (!cur._hpCand) cur._hpCand = {};
      for (const a of nums) {
        for (const b of nums) {
          if (a.id === b.id || a.n > b.n) continue;   // a = cur, b = max
          if (Math.abs((a.n / b.n) * 100 - pct) > 1.5) continue;
          const key = a.id + '|' + b.id;
          const prior = cur._hpCand[key];
          if (prior != null && Math.abs(prior - pct) >= 3) {
            cur.hpIds = { curId: a.id, maxId: b.id };
            cur._hpCand = {};
            break;
          }
          if (prior == null) cur._hpCand[key] = pct;
        }
        if (cur.hpIds) break;
      }
    }
  }
  // Read the pinned pair (works at any %, reflects live max).
  if (cur.hpIds) {
    const c = nums.find(x => x.id === cur.hpIds.curId);
    const m = nums.find(x => x.id === cur.hpIds.maxId);
    if (c && m && m.n > 0 && c.n <= m.n) { s.self_hp_cur = c.n; s.self_hp_max = m.n; }
  }
}
// Raw mana from the label band — no inference needed, the ids are in Zeal's
// LabelNames map: 124 = current mana, 125 = max mana, with 80 = "cur/max" as
// a combined-text fallback. Whether the 2002-era client populates them varies
// by UI state; nulls simply mean not exposed right now.
function _detectSelfMana(s, charInfo) {
  let cur = null, max = null;
  for (const ci of charInfo) {
    if (ci.id === 124) { const n = Number(ci.value); if (Number.isFinite(n)) cur = n; }
    else if (ci.id === 125) { const n = Number(ci.value); if (Number.isFinite(n)) max = n; }
  }
  if (cur == null || max == null) {
    const combo = charInfo.find(ci => ci.id === 80 && /^\d+\s*\/\s*\d+$/.test(String(ci.value || '')));
    if (combo) {
      const m = String(combo.value).match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) { cur = Number(m[1]); max = Number(m[2]); }
    }
  }
  if (cur != null && max != null && max > 0 && cur <= max) {
    s.self_mana_cur = cur;
    s.self_mana_max = max;
  }
}
function _flushZealStateToAgent() {
  if (!agentPort) return;
  for (const [character, cur] of _zealLiveByChar) {
    if (!cur.dirty) continue;
    cur.dirty = false;
    const body = JSON.stringify({ character, state: cur.snapshot });
    const req = http.request({
      host: '127.0.0.1', port: agentPort, path: '/api/zeal-state', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 3000,
    }, (res) => { res.resume(); });
    req.on('error', () => {}); req.on('timeout', () => req.destroy());
    req.write(body); req.end();
  }
}
// Push the "pause Discord tells" deadline to the local agent. The agent stamps
// it onto subsequent tell uploads (dm_pause_until) so the bot stores the tell
// but skips the Discord DM. The deadline lives only in the agent process, so we
// re-push after every (re)launch — see launchAgent(). `until` is a ms epoch; 0
// (or past) resumes immediately.
function pushTellsDmPause(until) {
  if (!agentPort) return;
  const u = (Number(until) || 0) > Date.now() ? Number(until) : 0;
  const body = JSON.stringify({ until: u });
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/tells-dm-pause', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}
// Persist + apply a "pause Discord tells" deadline. `until` is a ms epoch; 0
// (or past) resumes now. Saves to cfg so it survives a Mimic restart, pushes to
// the live agent, and refreshes the tray so the label/enabled state update.
function _setTellsDmPause(until) {
  const u = (Number(until) || 0) > Date.now() ? Number(until) : 0;
  const cfg = loadConfig();
  cfg.tellsDmPausedUntil = u;
  saveConfig(cfg);
  pushTellsDmPause(u);
  pushStatus();
}
// ── Mimic Discord login (device-code flow) ─────────────────────────────────
// State lives in `cfg.session` so it persists across upgrades; electron-updater
// swaps the .exe but userData (CONFIG_FILE) is untouched. Shape:
//   cfg.session = { token, identity: { user_id, discord_id, display_name,
//                   is_officer, role_names }, linked_at }
// `_linkInFlight` tracks an active /start poll loop so a second Sign-In click
// while one is pending doesn't fan out two browser tabs.
let _linkInFlight = null;   // { device_code, user_code, expires_at, timer }
function _httpsJsonPost(baseOrigin, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(baseOrigin + path); } catch (e) { reject(e); return; }
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const payload = JSON.stringify(body || {});
    const req = mod.request({
      method: 'POST',
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: null }); }
      });
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload); req.end();
  });
}
// Push the current session to the local agent. The agent forwards the token
// to the bot on every latest-version poll and surfaces the identity on
// /api/state so the dashboard can render the "Signed in as <name>" badge.
function pushMimicSession() {
  if (!agentPort) return;
  const cfg = loadConfig();
  const sess = cfg.session || null;
  const body = JSON.stringify({
    token:    resolveUploadToken(cfg) || '',
    identity: sess?.identity || null,
  });
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/mimic-session', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}
// Begin a fresh device-code link. Returns { user_code, verification_url,
// expires_in } so the Settings window can show the code + nudge. Polling starts
// immediately and continues in the background until linked/expired/cancelled.
async function startMimicLink() {
  if (_linkInFlight) {
    // Re-use the in-flight code; opening a second tab would just confuse.
    return { ok: true, ..._linkInFlight._pub };
  }
  const cfg = loadConfig();
  const base = _botBaseUrl(cfg);
  let resp;
  try {
    resp = await _httpsJsonPost(base, '/api/mimic-link/start', { agent_version: 'mimic ' + app.getVersion() });
  } catch (e) {
    return { ok: false, error: 'Could not reach the Wolf Pack server: ' + (e && e.message || e) };
  }
  if (resp.status !== 200 || !resp.body || !resp.body.device_code) {
    return { ok: false, error: 'Server rejected the link request' + (resp.body?.error ? ': ' + resp.body.error : '') };
  }
  const { user_code, device_code, verification_url, verification_url_complete, expires_in, poll_interval } = resp.body;
  const expiresAt = Date.now() + (expires_in * 1000);
  const pub = { user_code, verification_url, verification_url_complete, expires_at: expiresAt };
  _linkInFlight = { device_code, user_code, expires_at: expiresAt, _pub: pub, timer: null };
  // Open the user's browser at the verification URL with the code prefilled.
  try { shell.openExternal(verification_url_complete || verification_url); } catch (e) { void e; }
  // Start the poll loop.
  const intervalMs = Math.max(1500, Number(poll_interval || 2) * 1000);
  const tick = async () => {
    if (!_linkInFlight) return;
    if (Date.now() > _linkInFlight.expires_at) {
      _linkInFlight = null;
      pushStatus();
      return;
    }
    try {
      const p = await _httpsJsonPost(_botBaseUrl(loadConfig()), '/api/mimic-link/poll', { device_code });
      if (p.status === 200 && p.body) {
        if (p.body.status === 'linked' && p.body.session_token) {
          const c = loadConfig();
          // The session token IS the per-user upload token now — store it
          // encrypted at rest and retire any legacy plaintext.
          storeUploadToken(c, p.body.session_token, {
            user_id:      p.body.user_id,
            discord_id:   p.body.discord_id,
            display_name: p.body.display_name,
            is_officer:   !!p.body.is_officer,
            role_names:   Array.isArray(p.body.role_names) ? p.body.role_names : [],
          });
          c.session.linked_at = Date.now();
          saveConfig(c);
          _linkInFlight = null;
          pushMimicSession();
          pushStatus();
          // Relaunch the agent so it picks up the new token (passed via env at
          // spawn time). Kill → the exit handler auto-relaunches; if it's not
          // running, start it directly. This is what makes the just-completed
          // sign-in actually start uploading without a manual restart.
          if (agentProc) { try { agentProc.kill(); } catch (e) { void e; } }
          else { launchAgent(); }
          return;
        }
        if (p.body.status === 'expired') {
          _linkInFlight = null;
          pushStatus();
          return;
        }
      }
    } catch (e) { void e; /* transient — keep polling */ }
    _linkInFlight.timer = setTimeout(tick, intervalMs);
  };
  _linkInFlight.timer = setTimeout(tick, intervalMs);
  pushStatus();
  return { ok: true, ...pub };
}
// Cancel an in-flight link (e.g. user closed the Settings window without
// finishing). Doesn't touch any saved session.
function cancelMimicLink() {
  if (_linkInFlight) {
    if (_linkInFlight.timer) clearTimeout(_linkInFlight.timer);
    _linkInFlight = null;
    pushStatus();
  }
}
// Sign out. Best-effort revoke on the bot; clear cfg.session locally regardless
// so the user is signed out even if the network is down.
async function signOutMimic() {
  const cfg = loadConfig();
  const token = resolveUploadToken(cfg) || '';
  delete cfg.session;
  delete cfg.token;     // also clear any legacy top-level token
  saveConfig(cfg);
  pushMimicSession();
  pushStatus();
  // Drop the agent back to local-only by relaunching without a token.
  if (agentProc) { try { agentProc.kill(); } catch (e) { void e; } }
  if (token) {
    try { await _httpsJsonPost(_botBaseUrl(cfg), '/api/mimic-link/revoke', {}, { 'X-Wolfpack-Mimic-Session': token }); } catch (e) { void e; }
  }
}
// Short "resumes at" clock for the tray label, e.g. "3:45 PM".
function _fmtPauseClock(ms) {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return 'soon'; }
}
function startZealCapture() {
  try {
    const cfg = loadConfig();
    if (cfg.zealPipe === false) { appendAgentLog('[zeal] capture disabled (cfg.zealPipe=false)\n'); return; }
    const seenTypes = new Set();          // "pid:type" we've already log-sampled
    // Just-in-time Zeal-setup hint. If EQ is running for 60s but the pipe is
    // silent, we surface a one-time toast suggesting the user enable Zeal's
    // pipe output. Solves the "melody is empty" / "charm tracker blank" class
    // of bug reports caused by Zeal pipe being off in the user's EQ config.
    let _zealFirstEqAt   = 0;
    let _zealHintFired   = false;
    let _zealAnyEventYet = false;
    // Restore the raw-capture flag from config (no "started" marker — that's
    // only for an explicit user toggle, not a silent resume on launch).
    setZealRawCapture(loadConfig().zealRawCapture === true, { marker: false });
    zealWatch = startZealWatch({
      log: appendAgentLog,
      onStatus: (s) => {
        zealLastConnectedPids = s.connectedPids || [];
        if (zealLastConnectedPids.length > 0 && !_zealFirstEqAt) _zealFirstEqAt = Date.now();
        if (zealLastConnectedPids.length === 0) _zealFirstEqAt = 0;   // EQ closed — reset window
        // Pipe closed → its character logged off (or the whole client exited).
        // Retire every character pinned to a pid that's no longer connected so
        // Mob Info / triggers don't keep acting on a camped character's state.
        // A transient pipe drop re-populates within seconds of reconnect.
        const live = new Set(zealLastConnectedPids);
        for (const [name, cur] of [..._zealLiveByChar]) {
          if (cur.pid != null && !live.has(cur.pid)) _retireZealChar(name, 'pipe closed');
        }
        _flushZealToAgent();              // push connection change immediately
      },
      onEvent: (pid, obj) => {
        _zealAnyEventYet = true;
        const type = (obj && (obj.type !== undefined ? String(obj.type) : 'noType'));
        const key = pid + ':' + type;
        // Log one full sample per (pid,type) the first time — keeps the agent
        // log as the durable protocol record.
        if (!seenTypes.has(key)) {
          seenTypes.add(key);
          let sample = '';
          try { sample = JSON.stringify(obj).slice(0, 600); } catch {}
          appendAgentLog(`[zeal] sample pid=${pid} type=${type}: ${sample}\n`);
        }
        // Forward to the agent: count always, attach a sample once per type
        // per flush (agent keeps the newest).
        const evt = { type };
        if (!_zealPending.sampledTypes.has(type)) {
          _zealPending.sampledTypes.add(type);
          evt.sample = obj;
        }
        _zealPending.events.push(evt);
        // Cap pending so a runaway pipe can't grow the buffer unbounded.
        if (_zealPending.events.length > 2000) _zealPending.events.splice(0, 1000);
        // Opt-in raw capture: persist the full object (data un-double-encoded)
        // for protocol/diagnostic work. No-op unless the user enabled it.
        if (zealRawCapture) {
          let inner = obj && obj.data;
          if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { /* keep raw string */ } }
          _writeZealRaw({ at: Date.now(), pid, type: obj && obj.type, character: obj && obj.character, data: inner });
        }
        // Absorb gauge/player into live state for gauge-condition triggers.
        // pid rides along so a character switch on the same client retires
        // the previous character's state (see _zealAbsorb/_retireZealChar).
        try { _zealAbsorb(obj, pid); } catch (e) { void e; }
      },
    });
    setInterval(_flushZealToAgent, 2000);
    setInterval(_flushZealStateToAgent, 300);   // gauge-condition snapshots
    // Idle sweep — covers sitting at character select: the pipe stays open
    // (same pid) but the camped character stops streaming. After 2 minutes
    // of silence, retire it so overlays clear instead of showing the last
    // target from the previous session.
    setInterval(() => {
      const now = Date.now();
      for (const [name, cur] of [..._zealLiveByChar]) {
        if (cur.lastSeen && (now - cur.lastSeen) > 120_000) _retireZealChar(name, 'idle 2m');
      }
    }, 30_000);
    // Hint check: every 15s, look at the EQ-running window vs zeal traffic.
    // Suppressed after the first fire (a single user session shouldn't get
    // nagged repeatedly) AND after any zeal event has arrived (proves pipe
    // is wired). Also honors cfg.zealHintShown so a once-acknowledged user
    // doesn't get re-prompted across launches.
    setInterval(() => {
      if (_zealHintFired || _zealAnyEventYet) return;
      if (!_zealFirstEqAt || (Date.now() - _zealFirstEqAt) < 60_000) return;
      const cfgNow = loadConfig();
      if (cfgNow.zealHintShown) return;
      _zealHintFired = true;
      try { cfgNow.zealHintShown = true; saveConfig(cfgNow); } catch {}
      appendAgentLog('[zeal] no traffic detected after EQ has been running 60s — prompting user\n');
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'Wolf Pack miMIC — Zeal pipes look off',
            // Lead with the admin-mismatch fix: EQ-running-but-no-Zeal-data is
            // the classic signature of it. If EQ runs elevated and Mimic
            // doesn't, Windows' pipe ACL blocks the connection (it connects
            // then instantly drops), so no data ever arrives — cost Jankzer a
            // couple hours before "run Mimic as admin" fixed it (2026-07-05).
            body:  'EQ is running but no Zeal data is flowing. #1 fix: if you run EQ as Administrator, run Mimic as Administrator too (right-click Mimic → Run as administrator). Otherwise open Zeal in-game → Settings → Pipes and enable all data types. Verify: Tray → Overlays → Zeal health.',
          });
          n.on('click', () => {
            const cfg2 = loadConfig();
            cfg2.showZeal = true;
            saveConfig(cfg2);
            if (!zealWindow) createZealHealthOverlay(); else applyZealVisibility();
            pushStatus();
          });
          n.show();
        }
      } catch {}
    }, 15_000);
    appendAgentLog('[zeal] capture started — watching for eqgame.exe + Zeal pipes\n');
  } catch (e) {
    appendAgentLog(`[zeal] capture failed to start: ${e && e.message}\n`);
  }
}

// ── Blind Mode poll (v1.1.8) ───────────────────────────────────────────────
// When the active character is blinded (Pitted Iron Ring self-clicky or a
// hostile NPC blind), auto-pop Mob Info + Pet/Charm overlays so the player
// can keep doing useful things through the blind without alt-tabbing.
// State source is the agent's /api/state.blind — it does the log scanning
// and per-char tracking. We only flip the visibility override on transitions
// so the rest of the visibility system (quietMode, locked, EQ-running gate)
// keeps working normally outside of a blind window.
let _blindActive   = false;
let _blindSource   = null;
let _blindStartMs  = 0;
const _BLIND_FORCED_KEYS = ['mobinfo', 'charm', 'pets', 'triggers'];
function _blindForceOpen(key) { return _blindActive && _BLIND_FORCED_KEYS.includes(key); }
function _pollBlindState() {
  // Idle gate (2026-07-07 review): blind auto-pop only matters in game — no
  // point fetching the full agent state blob at 1Hz on an idle desktop.
  if (!_eqRunning) return;
  if (!agentPort) return;
  const req = http.get({
    host: '127.0.0.1', port: agentPort, path: '/api/state', timeout: 1500,
  }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; if (body.length > 256 * 1024) { body = ''; req.destroy(); } });
    res.on('end', () => {
      let s;
      try { s = JSON.parse(body || '{}'); } catch { return; }
      // Per-character overlay profiles — swap the visibility set when the
      // active toon changes (cheap; only acts on an actual change).
      try { _onActiveCharacter(s && s.activeCharacter); } catch {}
      const a = s && s.blind && s.blind.active;
      const nowOn = !!(a && a.active);
      if (nowOn && !_blindActive) {
        _blindActive  = true;
        _blindSource  = a.source || 'blind';
        _blindStartMs = Date.now();
        appendAgentLog(`[blind] entering blind mode (source=${_blindSource})\n`);
        // Make sure the windows exist so showInactive() has something to show.
        if (!mobInfoWindow) createMobInfoOverlay();
        if (!charmWindow)   createCharmOverlay();
        if (!petsWindow)    createPetsOverlay();
        if (!triggerWindow) createTriggerOverlay();
        applyMobInfoVisibility();
        applyCharmVisibility();
        applyPetsVisibility();
        applyTriggerVisibility();
      } else if (!nowOn && _blindActive) {
        _blindActive = false;
        appendAgentLog(`[blind] leaving blind mode (was ${_blindSource})\n`);
        _blindSource = null;
        // Restore the user's normal visibility prefs for the four overlays.
        applyMobInfoVisibility();
        applyCharmVisibility();
        applyPetsVisibility();
        applyTriggerVisibility();
      }
    });
  });
  req.on('error',   () => {});
  req.on('timeout', () => { req.destroy(); });
}

// ── Per-character overlay profiles (v1.2 Phase B) ───────────────────────────
// A player who multiboxes wants different overlays per toon: the monk has no
// charm pet so the Charm tracker is noise, but the same player's enchanter
// lives by it. Mimic learns the active character from the agent's
// /api/state.activeCharacter (the most-recently-active tailed log) and, when
// per-character layouts are enabled, swaps the overlay visibility set to that
// character's saved profile on every change. Opt-in: nothing happens until the
// user saves a profile (the first save flips the master switch on).
//
// Scope note (B-1): this captures the eleven overlay VISIBILITY flags only —
// the same set applyAllVisibility() manages. Per-character POSITION and OPACITY
// are deliberately out of scope here (they carry screen-signature + on-screen
// validation complexity); they're the B-2 follow-up. showTank is excluded — it
// is a HUD sub-tab mode, not a standalone overlay window, and applyAllVisibility
// doesn't manage it.
const _CHAR_PROFILE_FLAGS = [
  'showHud', 'enableTriggerTts', 'showCharm', 'showPets', 'showMobInfo',
  'showBuffQueue', 'showWho', 'showMelody', 'showZeal', 'showThreat', 'showChChain',
  'showExtTarget',
];
// flag → (live-window getter, creator) so apply can materialize a window for an
// overlay the profile turns on. Getters (not captured refs) read the current
// `let` window var each call.
const _CHAR_PROFILE_WINDOWS = [
  { flag: 'showHud',          get: () => overlayWindow,   create: () => createOverlayWindow() },
  { flag: 'enableTriggerTts', get: () => triggerWindow,   create: () => createTriggerOverlay() },
  { flag: 'showCharm',        get: () => charmWindow,     create: () => createCharmOverlay() },
  { flag: 'showPets',         get: () => petsWindow,      create: () => createPetsOverlay() },
  { flag: 'showMobInfo',      get: () => mobInfoWindow,   create: () => createMobInfoOverlay() },
  { flag: 'showBuffQueue',    get: () => buffQueueWindow, create: () => createBuffQueueOverlay() },
  { flag: 'showWho',          get: () => whoWindow,       create: () => createWhoOverlay() },
  { flag: 'showMelody',       get: () => melodyWindow,    create: () => createMelodyOverlay() },
  { flag: 'showZeal',         get: () => zealWindow,      create: () => createZealHealthOverlay() },
  { flag: 'showThreat',       get: () => threatWindow,    create: () => createThreatMeterOverlay() },
  { flag: 'showExtTarget',    get: () => extTargetWindow, create: () => createExtTargetOverlay() },
  { flag: 'showChChain',      get: () => chChainWindow,   create: () => createChChainOverlay() },
];
let _activeCharName = null;     // last activeCharacter seen on /api/state (display)
let _lastProfileChar = null;    // last char we applied a profile for (change-gate)

// Snapshot the current visibility set into the character's profile. Returns the
// saved-to char (lower) or null. First successful save enables the feature so
// the user doesn't have to find a separate toggle to make it take effect.
function _captureCharProfile(charLower) {
  if (!charLower) return null;
  const cfg = loadConfig();
  const show = {};
  for (const k of _CHAR_PROFILE_FLAGS) show[k] = !!cfg[k];
  cfg.charProfiles = cfg.charProfiles || {};
  cfg.charProfiles[charLower] = { show, savedAt: Date.now() };
  cfg.charProfilesEnabled = true;   // first save opts in
  saveConfig(cfg);
  return charLower;
}
// Apply a saved profile's visibility set to live config + windows. No-op if the
// character has no profile, or while a hide-all is active (we must not stomp the
// hide-all restore snapshot — the user's explicit "clear the screen" wins).
function _applyCharProfile(charLower) {
  if (!charLower) return false;
  if (_hideAllActive) return false;
  const cfg = loadConfig();
  const prof = cfg.charProfiles && cfg.charProfiles[charLower];
  if (!prof || !prof.show) return false;
  for (const k of _CHAR_PROFILE_FLAGS) {
    if (typeof prof.show[k] === 'boolean') cfg[k] = prof.show[k];
  }
  saveConfig(cfg);
  // Materialize a window for anything the profile turns on (applyXVisibility
  // no-ops on a missing window, so it can't show what doesn't exist yet).
  for (const d of _CHAR_PROFILE_WINDOWS) {
    if (cfg[d.flag] && !d.get()) { try { d.create(); } catch {} }
  }
  applyAllVisibility();
  pushStatus();
  buildTrayMenu();
  appendAgentLog(`[profile] applied overlay layout for ${charLower}\n`);
  return true;
}
// Called from the 1s state poll with the agent's current activeCharacter. Only
// fires on an actual change (and only when the feature is on), so it's free on
// the steady-state poll. First observation of a character applies their profile
// too — launching as that toon restores their layout.
function _onActiveCharacter(name) {
  const cl = name ? String(name).toLowerCase() : null;
  _activeCharName = name || null;
  if (!cl || cl === _lastProfileChar) return;
  _lastProfileChar = cl;
  const cfg = loadConfig();
  // _applyCharProfile rebuilds the tray itself; when the feature is off we
  // still rebuild so the "Save layout for <toon>" label tracks the new char.
  if (cfg.charProfilesEnabled && _applyCharProfile(cl)) return;
  try { buildTrayMenu(); } catch {}
}
// Tray-menu items for the per-character overlay layouts — the on/off switch,
// "save layout for <toon>", and (if one exists) "forget". Built fresh each
// menu render so the active-character label + profile presence stay current.
function _charProfileTrayItems() {
  const cfg = loadConfig();
  const char  = _activeCharName;
  const charLc = char ? char.toLowerCase() : null;
  const hasProfile = !!(charLc && cfg.charProfiles && cfg.charProfiles[charLc]);
  const items = [
    { type: 'separator' },
    { label: 'Per-character overlay layouts', type: 'checkbox',
      checked: !!cfg.charProfilesEnabled,
      click: (mi) => {
        const c = loadConfig(); c.charProfilesEnabled = mi.checked; saveConfig(c);
        // Turning it on while a profiled toon is active? Apply it right away
        // (clear the change-gate so _onActiveCharacter doesn't skip it).
        if (mi.checked && charLc) { _lastProfileChar = null; _onActiveCharacter(char); }
        buildTrayMenu(); pushStatus();
      } },
    { label: char ? `💾 Save current layout for ${char}` : '💾 Save layout (no active character yet)',
      enabled: !!charLc,
      click: () => {
        if (_captureCharProfile(charLc)) { _lastProfileChar = charLc; buildTrayMenu(); pushStatus(); }
      } },
  ];
  if (hasProfile) {
    items.push({ label: `🗑 Forget ${char}'s saved layout`,
      click: () => {
        const c = loadConfig();
        if (c.charProfiles) { delete c.charProfiles[charLc]; saveConfig(c); }
        buildTrayMenu();
      } });
  }
  return items;
}

// ── Launch the agent under Electron's Node ──────────────────────────────────
async function launchAgent() {
  if (quitting) return;
  const cfg = loadConfig();
  const agentPath = ensureWritableAgent();
  agentPort = await findFreePort(BASE_PORT);

  const args = [agentPath, '--watch', '--web-port', String(agentPort)];
  // Local-only: no token → don't pass --bot-url, so the agent runs dashboard +
  // tail only and never attempts uploads (no 4xx-spam in the queue).
  //
  // The token is passed via the WOLFPACK_TOKEN ENV VAR (set below), NOT a
  // --token argv flag. argv is visible to any process that can list the
  // process table (Task Manager → Details, wmic) — for a bearer credential
  // that's needless exposure. The agent reads --token OR env WOLFPACK_TOKEN.
  const uploadToken = resolveUploadToken(cfg);
  if (uploadToken && cfg.botUrl) {
    args.push('--bot-url', cfg.botUrl);
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
  const { dirs: eqDirs, runningDirs } = await resolveEqDirsWithLogs();
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
  } else if (runningDirs && runningDirs.length > 0) {
    // We FOUND a running EQ (its folder), but it has no eqlog_* files — in-game
    // logging is almost certainly off. This is the common "Zeal works but no
    // parses" case. Tell the user exactly how to fix it; the agent runs the
    // dashboard meanwhile and we re-check so it starts tailing the moment a log
    // file appears.
    appendAgentLog(`[mimic] Found EQ at ${runningDirs.join(', ')} but NO log files — in-game logging is off. In EQ, type /log on (and set Logging=on in eqclient.ini). Logs are picked up automatically once they appear.\n`);
  } else {
    appendAgentLog(`[mimic] NO EQ logs found and EQ doesn't appear to be running. Launch EverQuest, or open Settings → EverQuest folders to point Mimic at your install.\n`);
  }
  // Remember whether we launched with zero logs so the re-check loop knows to
  // watch for logs appearing (newly-enabled logging, EQ launched after Mimic,
  // a folder configured in Settings) and restart the agent to tail them.
  _agentZeroLogs = (totalLogs === 0);
  if (_agentZeroLogs) _scheduleZeroLogsRecheck();
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE:   '1',
    WOLFPACK_CLIENT:        'mimic',
    WOLFPACK_APP_VERSION:   app.getVersion(),
  };
  if (primaryEqDir) env.WOLFPACK_EQ_DIR = primaryEqDir;
  // Hand the bearer token to the agent out-of-band (env, not argv). Only set
  // when we have a token + upload URL — local-only installs leave it unset so
  // the agent never tries to upload.
  if (uploadToken && cfg.botUrl) env.WOLFPACK_TOKEN = uploadToken;
  // Per-character "do not transmit" list — for friends' boxes that play in
  // other guilds, or any toon the user wants kept out of our DB entirely. The
  // agent honors this at the outermost boundary (excluded logs aren't tailed),
  // so nothing about those characters can leave the machine. Set from
  // onboarding / Settings; user owns the choice.
  const excluded = Array.isArray(cfg.excludedCharacters)
    ? cfg.excludedCharacters.map(s => String(s || '').trim()).filter(Boolean)
    : [];
  if (excluded.length > 0) env.WOLFPACK_EXCLUDED_CHARS = excluded.join(',');

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
      // ALWAYS reload after a restart when the dashboard is already showing the
      // agent — a restart means a new port OR new dashboard code (hot-swap).
      // The previous version only reloaded on a port CHANGE, so a same-port
      // hot-swap left the window running the OLD (possibly broken) dashboard
      // JS → blank, and a manual reload-to-same-URL couldn't fix it either.
      // Re-navigating to the live port forces fresh code + a reconnect.
      // (First launch shows loading.html on file://, so this is skipped there.)
      if (/^https?:\/\/127\.0\.0\.1:\d+\//.test(cur)) {
        navigateToDashboard('agent-restart');
      }
    }
  } catch (e) { /* non-fatal */ }
  // Re-assert the per-machine "pause Discord tells" deadline — the agent keeps
  // it in-process only, so a (re)launch would otherwise resume DMs silently.
  try {
    const paused = Number(loadConfig().tellsDmPausedUntil) || 0;
    if (paused > Date.now()) pushTellsDmPause(paused);
  } catch (e) { /* non-fatal */ }
  // Re-assert the Mimic Discord-login session — same rationale: the agent
  // keeps the token + identity in memory only, so a relaunch would otherwise
  // de-identify the dashboard until the next latest-version poll. Re-pushing
  // unconditionally lets a freshly-cleared session also propagate.
  try { pushMimicSession(); } catch (e) { /* non-fatal */ }
  pushStatus();
  // Blind Mode poll — 1s cadence is plenty for a state change driven by
  // log lines that take ≥1.5s to even fully cast. Single timer, shared
  // across all watched characters; the agent's per-char map decides which.
  if (up && !global.__blindPollTimer) {
    global.__blindPollTimer = setInterval(_pollBlindState, 1000);
  }
  return up;
}

// When the agent is running with ZERO logs (no EQ folder yet, or logging is
// off), poll every 20s for logs becoming available — the user enables /log on,
// launches EQ, or configures a folder in Settings. The moment a tail-able log
// appears, restart the agent so it picks it up. Auto-stops once logs are found
// or the flag clears (e.g. a Settings save already relaunched with logs).
function _scheduleZeroLogsRecheck() {
  if (_zeroLogsRecheckTimer) return;
  _zeroLogsRecheckTimer = setInterval(async () => {
    if (quitting || !_agentZeroLogs) {
      clearInterval(_zeroLogsRecheckTimer); _zeroLogsRecheckTimer = null;
      return;
    }
    let dirs = [];
    try { ({ dirs } = await resolveEqDirsWithLogs()); } catch (e) { void e; }
    if (dirs.length > 0) {
      appendAgentLog('[mimic] EQ logs are now available — restarting the agent to tail them.\n');
      _agentZeroLogs = false;
      clearInterval(_zeroLogsRecheckTimer); _zeroLogsRecheckTimer = null;
      // Kill the running (log-less) agent; its exit handler relaunches, and the
      // fresh launch resolves the now-available logs.
      restartBackoff = 1000;
      if (agentProc) { try { agentProc.kill(); } catch (e) { void e; } }
      else { launchAgent(); }
    }
  }, 20000);
}

// ── Windows ─────────────────────────────────────────────────────────────────

// Centralized, instrumented navigation to the agent dashboard. Every
// blank-dashboard report so far has the same shape — "works in a browser,
// blank in the Mimic window" — which points at one of two things: (a) a stale
// HTTP cache in the window's session still serving an OLDER (broken) dashboard
// build after a hot-swap, or (b) a silent load failure with no retry, leaving
// the window stranded on a blank/dead page. This helper addresses both: it
// clears the session cache before loading, sends no-cache request headers, and
// logs the attempt + outcome to the agent log so a stuck load is diagnosable
// from the log tail (and the loading.html diagnostics panel) even when the
// renderer itself shows nothing.
let _dashNavSeq = 0;
function _curWindowUrl() {
  try { return (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL()) || '(none)'; }
  catch { return '(err)'; }
}
function navigateToDashboard(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    appendAgentLog(`[mimic] dashboard nav skipped — no window (reason=${reason})\n`);
    return;
  }
  const seq = ++_dashNavSeq;
  const url = 'http://127.0.0.1:' + agentPort + '/';
  appendAgentLog(`[mimic] dashboard nav #${seq}: loading ${url} (reason=${reason}, was=${_curWindowUrl()})\n`);
  const wc = mainWindow.webContents;
  Promise.resolve()
    .then(() => wc.session.clearCache())
    .catch((e) => appendAgentLog(`[mimic] dashboard nav #${seq}: clearCache failed (${e && e.message})\n`))
    .then(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      return wc.loadURL(url, { extraHeaders: 'pragma: no-cache\nCache-Control: no-cache\n' });
    })
    .then(() => appendAgentLog(`[mimic] dashboard nav #${seq}: load OK (url=${_curWindowUrl()})\n`))
    .catch((err) => appendAgentLog(`[mimic] dashboard nav #${seq}: load REJECTED — ${err && err.message}\n`));
}

let _lastConsoleMsg = '';
function createMainWindow() {
  // Launched via Windows-login autostart? Start hidden-to-tray so the dashboard
  // doesn't ambush the user mid-login. The user can pop it open from the tray.
  // Detected via the --autostart arg (set in applyAutoStart) OR Electron's
  // openAsHidden flag (which Windows passes when "Start hidden" was checked).
  const _autoStarted =
    process.argv.includes('--autostart') ||
    (process.platform === 'win32' && app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAtLogin);
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#0e1116',
    title: 'Wolf Pack miMIC — Main window (Dashboard)',
    show: !_autoStarted,
    // Window + taskbar icon while running. build/icon.ico is buildResources
    // (not shipped), so use the packaged assets PNG. The Start-menu/.exe icon
    // comes separately from build/icon.ico via electron-builder win.icon.
    icon: path.join(__dirname, 'assets', 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // Keep the OS/Task-Manager title stable instead of letting the loaded page
  // (loading.html → the agent dashboard) overwrite it — so this process stays
  // identifiable as the main window rather than "Mimic — getting ready" etc.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // ── Load diagnostics ──────────────────────────────────────────────────────
  // These make a blank window self-explanatory from the agent log: which URL
  // loaded, which failed (and why), renderer crashes, and dashboard JS errors
  // (e.g. the WEB_HTML escape-hazard SyntaxError that blanks the page). A
  // failed DASHBOARD load (http://127.0.0.1:<port>) auto-retries — loading.html
  // is file:// and drives its own retry via pollEngine, so we leave that alone.
  const wc = mainWindow.webContents;
  wc.on('did-finish-load', () => appendAgentLog(`[mimic] window did-finish-load url=${_curWindowUrl()}\n`));
  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // ERR_ABORTED — a newer navigation superseded this one
    appendAgentLog(`[mimic] window did-fail-load code=${code} desc=${desc} url=${validatedURL}\n`);
    if (/^https?:\/\/127\.0\.0\.1:\d+\//.test(validatedURL || '')) {
      setTimeout(() => navigateToDashboard('retry-after-fail'), 1200);
    }
  });
  wc.on('render-process-gone', (_e, details) => {
    appendAgentLog(`[mimic] window render-process-gone reason=${details && details.reason}\n`);
    if (/^https?:\/\//.test(_curWindowUrl())) setTimeout(() => navigateToDashboard('render-process-gone'), 800);
  });
  wc.on('unresponsive', () => appendAgentLog(`[mimic] window unresponsive\n`));
  wc.on('console-message', (_e, level, message, lineNo, sourceId) => {
    // Surface renderer warnings/errors (level 2=warning, 3=error) into the
    // agent log — a blank page from a dashboard script error is otherwise
    // invisible. Dedupe consecutive identical lines so a per-poll warning
    // can't flood the capped log tail.
    if (level < 2) return;
    const sig = `${level}:${message}:${sourceId}:${lineNo}`;
    if (sig === _lastConsoleMsg) return;
    _lastConsoleMsg = sig;
    appendAgentLog(`[mimic] dashboard console[${level === 3 ? 'error' : 'warn'}]: ${message} (${sourceId}:${lineNo})\n`);
  });

  mainWindow.loadFile('loading.html');
  // Stop the taskbar flash the moment the user actually looks at Mimic — the
  // flash is a "look over here" cue, not a permanent decoration.
  mainWindow.on('focus', () => { try { mainWindow.flashFrame(false); } catch {} });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    // Normally close-to-tray; but when setup is incomplete, REFUSE to hide.
    // The user reports that "people don't notice the taskbar" — vanishing to
    // tray with unresolved setup means they forget Mimic exists and never see
    // the in-page setup banners. Keep it on screen + fire a toast so they
    // know exactly why.
    const issue = _setupIssue();
    if (issue) {
      try { mainWindow.show(); mainWindow.focus(); } catch {}
      try { if (process.platform === 'win32') mainWindow.flashFrame(true); } catch {}
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: '⚠ Wolf Pack miMIC — setup needed',
            body:  issue + ' — Mimic is staying visible until setup is complete. Click "Open Settings" in the banner.',
            silent: false,
          }).show();
        }
      } catch (e) { void e; }
      return;
    }
    mainWindow.hide();
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
  if (charmWindow   && !charmWindow.isDestroyed())   out.push(['charm',   charmWindow]);
  if (petsWindow    && !petsWindow.isDestroyed())    out.push(['pets',    petsWindow]);
  if (mobInfoWindow && !mobInfoWindow.isDestroyed()) out.push(['mobinfo', mobInfoWindow]);
  if (buffQueueWindow && !buffQueueWindow.isDestroyed()) out.push(['buffQueue', buffQueueWindow]);
  if (whoWindow     && !whoWindow.isDestroyed())     out.push(['who',     whoWindow]);
  if (melodyWindow  && !melodyWindow.isDestroyed())  out.push(['melody',  melodyWindow]);
  if (zealWindow    && !zealWindow.isDestroyed())    out.push(['zeal',    zealWindow]);
  if (threatWindow  && !threatWindow.isDestroyed())  out.push(['threat',  threatWindow]);
  if (chChainWindow && !chChainWindow.isDestroyed()) out.push(['chchain', chChainWindow]);
  if (tankWindow    && !tankWindow.isDestroyed())    out.push(['tank',    tankWindow]);
  if (extTargetWindow && !extTargetWindow.isDestroyed()) out.push(['exttarget', extTargetWindow]);
  if (commandWindow && !commandWindow.isDestroyed()) out.push(['command', commandWindow]);
  for (const [panelKey, win] of panelOverlays.entries()) {
    if (win && !win.isDestroyed()) out.push(['panel:' + panelKey, win]);
  }
  return out;
}

// Apply the per-window opacity saved in config (defaults to 1.0). Called on
// window create + whenever a slider in setup mode moves.
//
// 1.2 refactor: the slider now drives the card SURFACE alpha (via a CSS
// variable broadcast as 'bg-alpha'), not the whole-window setOpacity that
// dimmed text along with background. The bug it fixes: slider at 100% used
// to leave cards at their baked rgba(0,0,0,0.55) — visibly see-through
// despite the label saying "opaque." Now 100% genuinely means an opaque
// card surface that hides EQ behind it; text stays at full brightness at
// every slider position so even very transparent cards stay readable.
// setOpacity is held at 1.0 always (no compound dim).
function applyOverlayOpacity(win, key) {
  if (!win || win.isDestroyed()) return;
  const cfg = loadConfig();
  const o = (cfg.overlayOpacity || {})[key];
  const val = (typeof o === 'number' && o >= 0.15 && o <= 1.0) ? o : 1.0;
  try { win.setOpacity(1.0); } catch {}
  try { win.webContents.send('bg-alpha', val); } catch {}
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
    // A window mid single-overlay setup keeps its unlocked state — a global
    // interactivity sweep (tray toggle, status push) must not re-lock it
    // out from under the user while its setup strip is open.
    if (_inSingleSetup(win)) continue;
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
    if (!charmWindow)   createCharmOverlay();
    if (!petsWindow)    createPetsOverlay();
    if (!mobInfoWindow) createMobInfoOverlay();
    if (!buffQueueWindow) createBuffQueueOverlay();
    if (!whoWindow)     createWhoOverlay();
    if (!melodyWindow)  createMelodyOverlay();
    if (!zealWindow)    createZealHealthOverlay();
    if (!threatWindow)  createThreatMeterOverlay();
    if (!chChainWindow) createChChainOverlay();
    if (!tankWindow)    createTankOverlay();
    if (!extTargetWindow) createExtTargetOverlay();
    if (!commandWindow) createCommandOverlay();
    // Force-show every overlay
    for (const [, win] of _overlayEntries()) {
      try { win.showInactive(); } catch {}
    }
  }
  applyOverlayInteractivity();
  applyOverlayVisibility();
  applyTriggerVisibility();
  applyCharmVisibility();
  applyPetsVisibility();
  applyMobInfoVisibility();
  applyBuffQueueVisibility();
  applyWhoVisibility();
  applyMelodyVisibility();
  applyZealVisibility();
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
  // TOGGLE — clicking the overlay button on a panel that already has its
  // overlay open closes the overlay instead of focusing it. That matches
  // the user expectation that the same control opens and closes the same
  // thing (the previous focus behavior left no way to close from the
  // dashboard — the user had to find the floating window and X it).
  const existing = panelOverlays.get(panelKey);
  if (existing && !existing.isDestroyed()) {
    existing.close();
    panelOverlays.delete(panelKey);
    return true;
  }
  const boundsKey = 'panelBounds_' + panelKey;
  const sigKey    = 'panelBoundsSig_' + panelKey;
  const b = _resolveBounds(boundsKey, sigKey, { x: 100, y: 100, width: 360, height: 220 });
  const win = new BrowserWindow({
    // Descriptive title so this process is identifiable in Task Manager /
    // Alt-Tab (e.g. "Wolf Pack Mimic — DEEPS panel overlay") instead of a
    // wall of identical "Wolf Pack Mimic" entries.
    title: `Wolf Pack miMIC — ${panelKey} panel overlay`,
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
  win.on('closed', () => { panelOverlays.delete(panelKey); try { pushStatus(); } catch {} });
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
    title: 'Wolf Pack miMIC — HUD overlay',
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
    title: 'Wolf Pack miMIC — Triggers overlay',
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

// UI Studio — graphical EQ-window editor. Loads per-character ini files
// from the user's EQ folder, parses XPos/YPos/Size.cx/Size.cy from each
// section, rescales 1440 → 1080 (or any source→target res), lets the user
// drag/resize windows with snap-to-edges, then writes back with .bak
// backups. Lets users prep a UI for a new monitor without launching EQ.
function openUiStudio() {
  if (uiStudioWindow) { uiStudioWindow.focus(); return; }
  uiStudioWindow = new BrowserWindow({
    width: 1200, height: 780, title: 'Wolf Pack miMIC — UI Studio',
    backgroundColor: '#0d1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  uiStudioWindow.setMenu(null);
  uiStudioWindow.loadFile('ui-studio.html');
  uiStudioWindow.on('closed', () => { uiStudioWindow = null; });
}

// Read a character's full ini bundle (existing UI Studio capture helper
// gives us this) and return raw text contents per file so the renderer
// can parse + edit + save in one round-trip.
ipcMain.handle('ui-studio-read-bundle', (_e, character, eqDir) => {
  try {
    const c = String(character || '').trim();
    const d = String(eqDir || '').trim();
    if (!c || !d) return null;
    return _readUiBundle(d, c);
  } catch { return null; }
});

// Write the edited bundle back to disk with .bak backups (via
// _backupAndWriteFile). Only writes files explicitly present in the
// bundle map — unchanged INIs are left alone, never accidentally cleared.
ipcMain.handle('ui-studio-write-bundle', (_e, eqDir, bundle, opts) => {
  try {
    const d = String(eqDir || '').trim();
    if (!d || !bundle || typeof bundle !== 'object') {
      return { ok: false, error: 'eqDir + bundle required' };
    }
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      return { ok: false, error: 'eqDir does not exist: ' + d };
    }
    // backupTag distinguishes the .bak — a deferred save (applied after the
    // character logged out) tags it 'eq' so the user sees that the replaced
    // copy was EQ's own last-written layout, not a prior UI Studio save.
    const backupTag = (opts && /^[\w-]{1,16}$/.test(String(opts.backupTag || ''))) ? String(opts.backupTag) : null;
    const written = [];
    for (const [name, contents] of Object.entries(bundle)) {
      if (typeof contents !== 'string' || contents.length === 0) continue;
      // Sanity: only allow plain ini filenames in the EQ dir — no path
      // traversal, no overwriting files outside the directory.
      if (!/^[\w.-]+\.ini$/i.test(name)) continue;
      const target = path.join(d, name);
      _backupAndWriteFile(target, contents, backupTag);
      written.push(name);
    }
    return { ok: true, written, count: written.length };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Open UI Studio from the dashboard nav button. Same entry point as the
// tray menu item — openUiStudio focuses the existing window if one is
// already open instead of stacking duplicates.
ipcMain.handle('open-ui-studio', () => { openUiStudio(); return true; });

// ── PvP Sets (bundled in apps/mimic/pvp-sets/) ─────────────────────────────
// Shared rotations contributed by guildies — pre-built hotkey pages,
// spell-set notes, clicky lineups, potion picks. First template: the
// bard "Dirge Team 6™" PvP rotation (credit: Vann | Barb). UI Studio
// shows a class-matched picker; the agent never writes back to the EQ
// socials INI yet — we drop a plain-markdown summary alongside the user's
// UI files so they can configure in-game without risk to existing data.
function _pvpSetsDir() {
  // In dev, the templates ship next to main.js. In packaged builds they're
  // baked into the asar — fs.readFileSync from process.resourcesPath/app
  // works for both since Electron mounts asar transparently.
  return path.join(__dirname, 'pvp-sets');
}

ipcMain.handle('ui-studio-list-pvp-sets', (_e, characterClass) => {
  try {
    const dir = _pvpSetsDir();
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!raw || !raw.id) continue;
        // Class filter — if the caller passes a class, only return templates
        // whose `class` field matches (case-insensitive). Always include
        // templates with no `class` field (universal sets).
        if (characterClass && raw.class
            && String(raw.class).toLowerCase() !== String(characterClass).toLowerCase()) continue;
        out.push({
          id:          raw.id,
          name:        raw.name,
          class:       raw.class || null,
          credit:      raw.credit || null,
          description: raw.description || '',
          phase_count: Array.isArray(raw.phases) ? raw.phases.length : 0,
        });
      } catch (err) {
        appendAgentLog(`[pvp-sets] skipping ${f}: ${err && err.message}\n`);
      }
    }
    return out;
  } catch { return []; }
});

ipcMain.handle('ui-studio-load-pvp-set', (_e, id) => {
  try {
    const dir = _pvpSetsDir();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (raw && raw.id === id) return raw;
    }
    return null;
  } catch { return null; }
});

ipcMain.handle('ui-studio-import-pvp-set', (_e, params) => {
  try {
    const id     = String(params?.id || '').trim();
    const eqDir  = String(params?.eqDir || '').trim();
    const character = String(params?.character || '').trim();
    if (!id || !eqDir) return { ok: false, error: 'id + eqDir required' };
    const dir = _pvpSetsDir();
    let raw = null;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j && j.id === id) { raw = j; break; }
    }
    if (!raw) return { ok: false, error: 'template not found: ' + id };

    let md = '# ' + raw.name + '\n\n';
    if (raw.credit) md += '_Credit: ' + raw.credit + '_  \n';
    if (raw.class)  md += '_Class:  ' + raw.class  + '_  \n';
    md += '\n';
    if (raw.description) md += raw.description + '\n\n';
    if (raw.availability_note) {
      md += '> **Bring what you have on the truck.** ' + raw.availability_note + '\n\n';
    }

    if (Array.isArray(raw.phases)) {
      md += '## Rotation (core — required)\n\n';
      for (const ph of raw.phases) {
        md += '### ' + ph.name + (ph.page_label ? '  —  ' + ph.page_label : '') + '\n\n';
        if (Array.isArray(ph.buttons)) {
          md += '| Slot | Label | Color | Cast | Notes |\n';
          md += '|------|-------|-------|------|-------|\n';
          for (const b of ph.buttons) {
            md += '| ' + (b.slot != null ? b.slot + 1 : '?') + ' | ' + (b.label || '') + ' | ' + (b.color != null ? b.color : '') + ' | `' + (Array.isArray(b.lines) ? b.lines.join(' ; ') : '') + '` | ' + (b.notes || '') + ' |\n';
          }
          md += '\n';
        }
      }
    }

    if (Array.isArray(raw.spell_sets) && raw.spell_sets.length) {
      md += '## Spell Sets\n\n';
      for (const ss of raw.spell_sets) {
        md += '**' + ss.name + '**:\n';
        for (const sp of (ss.spells || [])) md += '- ' + sp + '\n';
        md += '\n';
      }
    }
    if (Array.isArray(raw.clickies) && raw.clickies.length) {
      md += '## Optional clickies\n\n_All of these are gear-tier-dependent. Skip any you don\'t have on the truck — alternatives are listed where available._\n\n';
      for (const c of raw.clickies) {
        const tierTag = c.tier ? '_' + c.tier + '_' : '';
        const requiredTag = c.required ? '**REQUIRED**' : '_optional_';
        md += '- **' + c.slot + '**: ' + (c.item || '') + '  ' + tierTag + ' · ' + requiredTag + '\n';
        if (c.provides)              md += '    - Provides: ' + c.provides + '\n';
        if (Array.isArray(c.alternatives) && c.alternatives.length) {
          md += '    - If you don\'t have it: ' + c.alternatives.join(' / ') + '\n';
        }
        if (c.notes)                 md += '    - ' + c.notes + '\n';
      }
      md += '\n';
    }
    if (Array.isArray(raw.potions) && raw.potions.length) {
      md += '## Optional potions\n\n';
      for (const p of raw.potions) {
        md += '- **' + (p.name || '') + '**: ' + (p.use || '') + '\n';
      }
      md += '\n';
    }
    md += '---\n*Generated by Wolf Pack Mimic — UI Studio*\n';

    const safeId   = id.replace(/[^\w.-]/g, '_');
    const safeChar = character ? character.replace(/[^\w]/g, '') : 'all';
    const targetName = `WolfPack_PvPSet_${safeId}_${safeChar}.md`;
    const targetPath = path.join(eqDir, targetName);
    fs.writeFileSync(targetPath, md, 'utf8');
    return { ok: true, file: targetName, path: targetPath };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Inspect socials INI files for the loaded character. Returns the parsed
// sections (raw section name + key/value props) so the UI Studio can render
// a "Hotbar Pages" inspector. Helps the user see what's actually in their
// INI and gives us format samples to refine the parser against.
// Surgical INI writer — preserves comments, blank lines, key order, and any
// sections we don't touch. Edits are { file, section, key, value | null } —
// when value === null the key is REMOVED (used to drop Socials lines when the
// user clears them). Adds the key at the end of its section if it doesn't
// exist yet. Writes a .bak alongside (suffix matches uiStudioWriteBundle's
// pattern) before writing the new content.
// Scan the active UI skin's XML files for each window's design size. EQ
// stores window definitions under <eqDir>/uifiles/<skin>/*.xml; the skin name
// comes from eqclient.ini UISkin= (default 'default'). Inside each file a
// window is defined as <Screen item="Name">…<Size><CX>w</CX><CY>h</CY></Size>;
// some skins use the lowercase Schema variant with width/height attributes.
//
// We use these sizes as the AUTHORITATIVE MAX for the visual layout — the
// per-character INI's Width/Height can desync (resized at a different
// resolution, partially saved, etc.) so the XML size is the right cap.
// Returns { skin, sizes: { windowName: { cx, cy, file } }, scanned: <count> }.
ipcMain.handle('ui-studio-scan-window-defaults', (_e, eqDir) => {
  try {
    const d = String(eqDir || '').trim();
    if (!d || !fs.existsSync(d)) return { ok: false, error: 'eqDir does not exist' };
    // Resolve the active skin from eqclient.ini. Falls back to 'default' when
    // missing — that's what EQ uses too. Case-insensitive UISkin lookup
    // because some clients write USkin / UI_SKIN variants.
    let skin = 'default';
    const eqClient = path.join(d, 'eqclient.ini');
    if (fs.existsSync(eqClient)) {
      try {
        const txt = fs.readFileSync(eqClient, 'utf8');
        const m = txt.match(/^\s*UISkin\s*=\s*(.+?)\s*$/im);
        if (m && m[1].trim()) skin = m[1].trim();
      } catch {}
    }
    const skinDir = path.join(d, 'uifiles', skin);
    if (!fs.existsSync(skinDir) || !fs.statSync(skinDir).isDirectory()) {
      return { ok: true, skin, sizes: {}, scanned: 0, note: 'skin dir missing: ' + skinDir };
    }
    const sizes = {};
    let scanned = 0;
    const files = fs.readdirSync(skinDir).filter(f => /\.xml$/i.test(f));
    for (const f of files) {
      const fp = path.join(skinDir, f);
      let xml;
      try { xml = fs.readFileSync(fp, 'utf8'); } catch { continue; }
      scanned++;
      // Two formats observed across EQ skin variants:
      //   1. <Screen item="MainChatWindow">…<Size><CX>800</CX><CY>600</CY></Size>
      //   2. <Window item="MainChatWindow">…<Size width="800" height="600"/>
      // Regex-based extraction is robust enough for our needs (max-size hint);
      // a full XML parse isn't worth the dependency. We match nested-tag and
      // self-closing-attribute Size shapes per Screen/Window block.
      const rxItem = /<(Screen|Window)\b[^>]*\bitem\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
      let mi;
      while ((mi = rxItem.exec(xml)) !== null) {
        const name = mi[2].trim();
        const body = mi[3];
        if (!name) continue;
        if (sizes[name]) continue;   // first-seen wins; some skins have inherited Screen wrappers
        let cx = null, cy = null;
        const sNest = body.match(/<Size\b[^>]*>([\s\S]*?)<\/Size>/i);
        if (sNest) {
          const cxm = sNest[1].match(/<CX>\s*(-?\d+)\s*<\/CX>/i);
          const cym = sNest[1].match(/<CY>\s*(-?\d+)\s*<\/CY>/i);
          if (cxm) cx = parseInt(cxm[1], 10);
          if (cym) cy = parseInt(cym[1], 10);
        }
        if (cx == null || cy == null) {
          const sAttr = body.match(/<Size\b([^/]*?)\/>/i);
          if (sAttr) {
            const wm = sAttr[1].match(/\bwidth\s*=\s*"(-?\d+)"/i);
            const hm = sAttr[1].match(/\bheight\s*=\s*"(-?\d+)"/i);
            if (wm) cx = parseInt(wm[1], 10);
            if (hm) cy = parseInt(hm[1], 10);
          }
        }
        if (cx != null && cy != null && cx > 0 && cy > 0) {
          sizes[name] = { cx, cy, file: f };
        }
      }
    }
    return { ok: true, skin, sizes, scanned };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

ipcMain.handle('ui-studio-write-pages', (_e, eqDir, edits) => {
  try {
    const d = String(eqDir || '').trim();
    if (!d || !Array.isArray(edits) || edits.length === 0) {
      return { ok: false, error: 'eqDir + edits required' };
    }
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      return { ok: false, error: 'eqDir does not exist: ' + d };
    }
    // Group edits by file → section → key.
    const byFile = new Map();
    for (const e of edits) {
      if (!e || !e.file || !e.section || !e.key) continue;
      const fp = path.join(d, String(e.file));
      // Path-traversal guard: must resolve inside eqDir.
      const resolved = path.resolve(fp);
      if (!resolved.startsWith(path.resolve(d) + path.sep)) continue;
      if (!fs.existsSync(resolved)) continue;
      if (!byFile.has(resolved)) byFile.set(resolved, []);
      byFile.get(resolved).push({
        section: String(e.section),
        key:     String(e.key),
        value:   e.value == null ? null : String(e.value),
      });
    }
    const written = [];
    for (const [fp, eds] of byFile) {
      const orig = fs.readFileSync(fp, 'utf8');
      const eol  = /\r\n/.test(orig) ? '\r\n' : '\n';
      const lines = orig.split(/\r?\n/);
      // Build (section, key) → desired value map; null means delete.
      const want = new Map();
      for (const e of eds) want.set(e.section + '' + e.key, e.value);
      // Pass 1: walk the file, applying in-place updates / deletions. Track
      // which section ends each section starts/ends at so we can append new
      // keys to the right section in pass 2.
      const sectionEnds = new Map();   // sectionName → index AFTER last line of that section
      let curSec = null, curStart = -1;
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        const ms = L.match(/^\s*\[([^\]]+)\]\s*$/);
        if (ms) {
          // Close the previous section before opening the new one.
          if (curSec) sectionEnds.set(curSec, out.length);
          curSec = ms[1]; curStart = out.length;
          out.push(L);
          continue;
        }
        if (curSec) {
          const mk = L.match(/^(\s*)([\w.]+)\s*=\s*(.*?)(\s*)$/);
          if (mk) {
            const k = mk[2];
            const sig = curSec + '' + k;
            if (want.has(sig)) {
              const newVal = want.get(sig);
              want.delete(sig);
              if (newVal === null) continue;   // delete line entirely
              out.push(mk[1] + k + '=' + newVal + mk[4]);
              continue;
            }
          }
        }
        out.push(L);
      }
      if (curSec) sectionEnds.set(curSec, out.length);
      // Pass 2: append remaining (still-wanted) keys at the end of their
      // section. Walk in reverse so we don't invalidate later indices.
      const remaining = [...want.entries()].map(([sig, value]) => {
        const [section, key] = sig.split('');
        return { section, key, value };
      }).filter(e => e.value !== null);
      remaining.sort((a, b) => (sectionEnds.get(b.section) ?? -1) - (sectionEnds.get(a.section) ?? -1));
      for (const e of remaining) {
        const idx = sectionEnds.get(e.section);
        if (idx == null) {
          // Section doesn't exist — append a fresh one at end of file.
          out.push('[' + e.section + ']');
          out.push(e.key + '=' + e.value);
        } else {
          out.splice(idx, 0, e.key + '=' + e.value);
          // Shift any later section ends.
          for (const [s, n] of sectionEnds) if (n > idx) sectionEnds.set(s, n + 1);
        }
      }
      const next = out.join(eol);
      if (next === orig) { written.push({ file: path.basename(fp), unchanged: true }); continue; }
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const bakPath = fp + '.studio-' + ts + '.bak';
      try { fs.writeFileSync(bakPath, orig); } catch {}
      fs.writeFileSync(fp, next);
      written.push({ file: path.basename(fp), bak: path.basename(bakPath) });
    }
    return { ok: true, written };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

ipcMain.handle('ui-studio-inspect-socials', (_e, character, eqDir) => {
  try {
    const c = String(character || '').trim();
    const d = String(eqDir || '').trim();
    if (!c || !d) return { ok: false, error: 'character + eqDir required' };
    const candidates = [
      `Sock_${c}_pq.proj.ini`,
      `Socials_${c}_pq.proj.ini`,
      `${c}_pq.proj.ini`,
    ];
    const files = [];
    for (const name of candidates) {
      const fp = path.join(d, name);
      if (!fs.existsSync(fp)) continue;
      try {
        const text = fs.readFileSync(fp, 'utf8');
        // Quick section parse — same algorithm the ui-studio renderer uses.
        // We keep ALL keys per section now (was capped at 8) because [HotButtons]
        // and [Socials] are flat-key sections that can carry hundreds of
        // Page<P>Button<N>… entries; truncating made the inspector look
        // "incomplete" and hid most of the user's actual hotbars.
        const sections = [];
        const lines = text.split(/\r?\n/);
        let cur = null;
        for (const L of lines) {
          const m = L.match(/^\s*\[([^\]]+)\]\s*$/);
          if (m) {
            cur = { name: m[1], props: {} };
            sections.push(cur);
            continue;
          }
          if (!cur) continue;
          const kv = L.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
          if (kv) cur.props[kv[1]] = kv[2];
        }
        // Structured view: group [HotButtons] + [Socials] flat keys by
        // (page, button) so the renderer can show a hotbar-per-page grid.
        // Quarm's per-char ini uses the flattened shape:
        //   [HotButtons] Page<P>Button<N> = <hotkey>        (e.g. E18)
        //   [Socials]    Page<P>Button<N>Name  = <label>
        //                Page<P>Button<N>Color = <int>
        //                Page<P>Button<N>Line<M> = <command>
        const pages = { hotbuttons: {}, socials: {} };
        for (const sec of sections) {
          if (sec.name === 'HotButtons') {
            for (const [k, v] of Object.entries(sec.props)) {
              const mk = k.match(/^Page(\d+)Button(\d+)$/i);
              if (!mk) continue;
              const [, P, B] = mk;
              if (!pages.hotbuttons[P]) pages.hotbuttons[P] = {};
              pages.hotbuttons[P][B] = v;
            }
          } else if (sec.name === 'Socials') {
            for (const [k, v] of Object.entries(sec.props)) {
              const mk = k.match(/^Page(\d+)Button(\d+)(Name|Color|Line(\d+))$/i);
              if (!mk) continue;
              const [, P, B, field, lineNo] = mk;
              if (!pages.socials[P]) pages.socials[P] = {};
              if (!pages.socials[P][B]) pages.socials[P][B] = { name: null, color: null, lines: [] };
              const cell = pages.socials[P][B];
              if (/^Name$/i.test(field))  cell.name  = String(v);
              else if (/^Color$/i.test(field)) cell.color = parseInt(v, 10) || 0;
              else if (lineNo)            cell.lines[parseInt(lineNo, 10) - 1] = String(v);
            }
            // Compact sparse lines arrays so undefined slots don't show.
            for (const P of Object.keys(pages.socials)) {
              for (const B of Object.keys(pages.socials[P])) {
                pages.socials[P][B].lines = pages.socials[P][B].lines.filter(x => x != null && x !== '');
              }
            }
          }
        }
        files.push({ file: name, section_count: sections.length, sections, pages });
      } catch (err) {
        files.push({ file: name, error: err && err.message });
      }
    }
    // ── Chat routing (read-only) ─────────────────────────────────────────
    // The UI_<char>_pq.proj.ini [ChatManager] section holds the real chat
    // wiring: per-window names + which EQ channel each defaults to, plus the
    // ChannelMap<N>=<windowIndex> table that routes each message category to a
    // window. We surface it so the user can SEE "Guild → window 1, Tells →
    // window 4" without spelunking the INI. (Editing/drag-drop is a follow-up
    // — the ChannelMap filter-index semantics need confirming before we write.)
    let chat = null;
    try {
      const uiName = `UI_${c}_pq.proj.ini`;
      let uiPath = path.join(d, uiName);
      if (!fs.existsSync(uiPath)) {
        // glob for UI_<char>*.ini at any server suffix
        const cl = c.toLowerCase();
        for (const f of fs.readdirSync(d)) {
          const mm = f.match(/^UI_([A-Za-z]+).*\.ini$/i);
          if (mm && mm[1].toLowerCase() === cl) { uiPath = path.join(d, f); break; }
        }
      }
      if (fs.existsSync(uiPath)) {
        const uiText = fs.readFileSync(uiPath, 'utf8');
        const cm = {};
        let inCM = false;
        for (const L of uiText.split(/\r?\n/)) {
          const sm = L.match(/^\s*\[([^\]]+)\]\s*$/);
          if (sm) { inCM = (sm[1] === 'ChatManager'); continue; }
          if (!inCM) continue;
          const kv = L.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
          if (kv) cm[kv[1]] = kv[2];
        }
        if (Object.keys(cm).length) {
          const windows = [];
          for (let i = 0; i <= 30; i++) {
            const name = cm[`ChatWindow${i}_Name`];
            const def  = cm[`ChatWindow${i}_DefaultChannel`];
            const chn  = cm[`ChatWindow${i}_ChatChannel`];
            const tt   = cm[`ChatWindow${i}_TellTarget`];
            if (name == null && def == null && chn == null) continue;
            windows.push({
              index: i,
              name: name != null ? String(name).trim() : null,
              default_channel: def != null ? parseInt(def, 10) : null,
              chat_channel: chn != null ? parseInt(chn, 10) : null,
              tell_target: tt || null,
            });
          }
          // ChannelMap<filter> = <windowIndex> → invert to windowIndex → [filters]
          const routed = {};
          for (const [k, v] of Object.entries(cm)) {
            const mk = k.match(/^ChannelMap(\d+)$/);
            if (!mk) continue;
            const win = parseInt(v, 10);
            if (!routed[win]) routed[win] = [];
            routed[win].push(parseInt(mk[1], 10));
          }
          // AlwaysHere flag — at most one window is pinned. Drives the bold +
          // highlight in the Inspector. Stored as ChatWindow<N>_AlwaysHere=1.
          let alwaysHereIdx = null;
          for (const [k, v] of Object.entries(cm)) {
            const mk = k.match(/^ChatWindow(\d+)_AlwaysHere$/i);
            if (mk && parseInt(v, 10) === 1) { alwaysHereIdx = parseInt(mk[1], 10); break; }
          }
          chat = {
            file: path.basename(uiPath),
            num_windows: parseInt(cm.NumWindows, 10) || windows.length,
            windows,
            routed_filters: routed,
            always_here_idx: alwaysHereIdx,
          };
        }
      }
    } catch {}

    // ── Tell windows (Zeal, read-only) ───────────────────────────────────
    // Zeal stores tell-window enablement in zeal.ini, keyed by character:
    //   [<Character>] TellWindows=TRUE / TellWindowsHist=TRUE
    //   [TellWindows_<Character>] Enabled=TRUE / HistoryEnabled=FALSE
    // The individual per-sender tell windows are placed by Zeal at runtime —
    // there are no per-sender position sections to manage here. We report the
    // on/off state for the loaded character and which other chars have them on.
    let tells = null;
    try {
      const zp = path.join(d, 'zeal.ini');
      if (fs.existsSync(zp)) {
        const ztext = fs.readFileSync(zp, 'utf8');
        const zsec = {};
        let curz = null;
        for (const L of ztext.split(/\r?\n/)) {
          const sm = L.match(/^\s*\[([^\]]+)\]\s*$/);
          if (sm) { curz = sm[1]; zsec[curz] = zsec[curz] || {}; continue; }
          if (!curz) continue;
          const kv = L.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
          if (kv) zsec[curz][kv[1]] = kv[2];
        }
        const truthy = (v) => /^(true|1|yes|on)$/i.test(String(v || '').trim());
        const self = zsec[c] || {};
        const selfTW = zsec[`TellWindows_${c}`] || {};
        const enabledFor = [];
        for (const [sec, props] of Object.entries(zsec)) {
          if (/^(TellWindows_|TargetRing_|FloatingDamage_|Zeal_)/.test(sec)) continue;
          if (props.TellWindows != null && truthy(props.TellWindows)) enabledFor.push(sec);
        }
        tells = {
          file: 'zeal.ini',
          character: c,
          enabled: truthy(self.TellWindows),
          history: truthy(self.TellWindowsHist),
          detail_enabled: selfTW.Enabled != null ? truthy(selfTW.Enabled) : null,
          detail_history: selfTW.HistoryEnabled != null ? truthy(selfTW.HistoryEnabled) : null,
          enabled_for_characters: enabledFor.sort(),
        };
      }
    } catch {}

    if (files.length === 0 && !chat && !tells) return { ok: false, error: 'no socials/UI/zeal INI found for ' + c };
    return { ok: true, files, chat, tells };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Capture a heuristic PvP-set draft from the user's Socials/Sock_ INI
// files. Writes a JSON file the user can review, annotate (notes,
// required, tier, alternatives) and share. The parser tolerates several
// section-naming conventions because Quarm/EQ clients use a few
// different shapes — anything that looks like a button row gets
// extracted, the rest is preserved as a `raw_props` blob.
ipcMain.handle('ui-studio-capture-pvp-draft', (_e, params) => {
  try {
    const character = String(params?.character || '').trim();
    const eqDir     = String(params?.eqDir || '').trim();
    const setName   = String(params?.setName || `${character} draft`).trim();
    if (!character || !eqDir) return { ok: false, error: 'character + eqDir required' };

    const candidates = [
      `Sock_${character}_pq.proj.ini`,
      `Socials_${character}_pq.proj.ini`,
    ];
    let combinedText = '';
    let foundFile = null;
    const sourceMtimes = {};       // file → ISO timestamp of last write
    let newestMtimeMs = 0;
    for (const name of candidates) {
      const fp = path.join(eqDir, name);
      if (!fs.existsSync(fp)) continue;
      try {
        const st = fs.statSync(fp);
        sourceMtimes[name] = new Date(st.mtimeMs).toISOString();
        if (st.mtimeMs > newestMtimeMs) newestMtimeMs = st.mtimeMs;
      } catch {}
      combinedText += `\n; ── ${name} ──\n` + fs.readFileSync(fp, 'utf8');
      foundFile = foundFile || name;
    }
    if (!combinedText) return { ok: false, error: 'no Sock_*/Socials_* INI files for ' + character };

    // Era detection — knowing WHEN the user last edited their socials
    // tells us roughly what Quarm expansion was current at the time, which
    // hints at what spells/songs/items they had access to. Wrong-era setups
    // are easy traps ("this rotation needs Cassindra's Chorale of Clarity
    // which won't drop until Velious"). Hard-coded lock dates from Quarm's
    // public schedule; update as new expansions unlock.
    const QUARM_EXPANSIONS = [
      { name: 'Classic',           start: '2024-01-01' },
      { name: 'Kunark',            start: '2024-08-01' },
      { name: 'Velious',           start: '2025-04-01' },
      { name: 'Luclin',            start: '2025-11-01' },
      { name: 'Planes of Power',   start: '2026-10-01' },   // matches isPopLocked()
    ];
    let eraGuess = null;
    if (newestMtimeMs > 0) {
      const editedAt = new Date(newestMtimeMs);
      for (let i = QUARM_EXPANSIONS.length - 1; i >= 0; i--) {
        if (editedAt >= new Date(QUARM_EXPANSIONS[i].start)) {
          eraGuess = QUARM_EXPANSIONS[i].name;
          break;
        }
      }
    }

    // Heuristic parse: walk all sections. For each section, look for
    // common button-shape patterns and emit a `buttons` array. If we
    // can't recognize the shape, preserve raw_props so the user can
    // hand-edit.
    const phases = [];
    const lines = combinedText.split(/\r?\n/);
    let cur = null;
    for (const L of lines) {
      const m = L.match(/^\s*\[([^\]]+)\]\s*$/);
      if (m) { cur = { name: m[1], props: {} }; phases.push(cur); continue; }
      if (!cur) continue;
      const kv = L.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (kv) cur.props[kv[1]] = kv[2];
    }
    // Convert each parsed section into a "phase or button". Two known
    // patterns:
    //   A) [PageN] with ButtonM=Name|Color|...|Line0|Line1|... entries
    //   B) [SocialsN] with Name + Line0..LineN props
    const draftPhases = [];
    for (const sec of phases) {
      // Pattern A: section name like Page0, Page1, ...
      const isPage = /^Page\d+$/i.test(sec.name);
      // Pattern B: section name like Socials0, Socials1, ...
      const isSocial = /^Socials?\d+$/i.test(sec.name);
      if (isPage) {
        const buttons = [];
        for (const [k, v] of Object.entries(sec.props)) {
          const bm = k.match(/^Button(\d+)$/i) || k.match(/^HotButton(\d+)$/i);
          if (!bm) continue;
          // Naive pipe-delimited button: Name|Color|...|Line0|Line1|...
          const parts = String(v).split('|');
          buttons.push({
            slot:  parseInt(bm[1], 10),
            label: parts[0] || '',
            color: parseInt(parts[1], 10) || 0,
            lines: parts.slice(4).filter(s => s && s.length),
            _raw:  v,
          });
        }
        if (buttons.length) {
          buttons.sort((a, b) => a.slot - b.slot);
          draftPhases.push({
            name:       sec.name,
            page:       parseInt(sec.name.replace(/^Page/i, ''), 10),
            page_label: 'Shift+' + (parseInt(sec.name.replace(/^Page/i, ''), 10) + 1),
            buttons,
          });
        }
      } else if (isSocial) {
        // Single-button section. Group adjacent socials into a page later
        // if we can; for now, emit each as its own slot.
        const name = sec.props.Name || sec.props.WindowName || sec.name;
        const lines = [];
        for (let i = 0; i < 5; i++) {
          const ln = sec.props['Line' + i] || sec.props['Line_' + i];
          if (ln) lines.push(ln);
        }
        draftPhases.push({
          name:       'Social: ' + name,
          page:       parseInt(sec.props.Page, 10) || 0,
          page_label: sec.props.Page != null ? 'Shift+' + (parseInt(sec.props.Page, 10) + 1) : null,
          buttons: [{
            slot:  parseInt(sec.props.HotKeyButtonNum || sec.props.HotButtonNum || 0, 10),
            label: name,
            color: parseInt(sec.props.Color, 10) || 0,
            lines,
            _raw:  null,
          }],
        });
      }
    }

    const slug = setName.replace(/[^\w]+/g, '-').toLowerCase().slice(0, 40);
    const draft = {
      id:                slug + '-' + character.toLowerCase(),
      name:              setName,
      version:           1,
      class:             null,
      credit:            character,
      description:       '(Add a description before sharing this set.)',
      availability_note: '(Tag required vs optional items before publishing.)',
      phases:            draftPhases,
      spell_sets:        [],
      bandolier:         [],
      clickies:          [],
      potions:           [],
      _captured:         true,
      _captured_at:      new Date().toISOString(),
      _source_files:     candidates.filter(f => fs.existsSync(path.join(eqDir, f))),
      _source_mtimes:    sourceMtimes,
      _era_guess:        eraGuess,
      _era_basis:        newestMtimeMs > 0 ? 'last-edit of source INI file' : null,
      _needs_review:     [
        'Add `class` (Bard / Druid / etc.) if class-specific.',
        'Per-clicky: add tier, set required:false, list alternatives.',
        'Per-phase: rename "PageN" to a meaningful label (Pre-dirge, Burn, etc.).',
        'Strip any /tells, /pet, character-specific keys you don\'t want to share.',
        'Confirm the heuristic parsed every button correctly (compare against in-game).',
        '_era_guess is HEURISTIC (based on file mtime vs Quarm expansion dates) — verify before publishing.',
      ],
    };

    const safeChar = character.replace(/[^\w]/g, '');
    const targetName = `WolfPack_Capture_${slug}_${safeChar}.json`;
    const targetPath = path.join(eqDir, targetName);
    fs.writeFileSync(targetPath, JSON.stringify(draft, null, 2), 'utf8');
    return {
      ok: true,
      file: targetName,
      path: targetPath,
      phase_count:  draftPhases.length,
      button_count: draftPhases.reduce((n, p) => n + (p.buttons || []).length, 0),
      source_file:  foundFile,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ── EQ-presence detection ───────────────────────────────────────────────────
// Poll Windows tasklist for eqgame.exe so overlays can hide themselves when
// the user isn't actually playing. The poll is cheap (one tasklist call every
// 5s) and runs only on Windows — other platforms keep the legacy "always on"
// behavior since there's no EverQuest target. State is sticky across one
// failed poll (CSV parse error etc.) to avoid flicker.
let _eqRunning = true;     // assume running until first poll resolves
let _eqPollTimer = null;
function _checkEqRunning() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(true);
    try {
      const child = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq eqgame.exe', '/NH', '/FO', 'CSV'], { windowsHide: true });
      let out = '';
      const onData = chunk => { out += chunk.toString(); };
      child.stdout.on('data', onData);
      child.stderr.on('data', () => {});
      const timer = setTimeout(() => { try { child.kill(); } catch {} ; resolve(_eqRunning); }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        // Match any eqgame.exe row — tasklist returns "INFO: No tasks…" on the
        // stdout when the filter has zero matches.
        resolve(/eqgame\.exe/i.test(out));
      });
      child.once('error', () => { clearTimeout(timer); resolve(_eqRunning); });
    } catch { resolve(_eqRunning); }
  });
}
async function _pollEqPresence() {
  const running = await _checkEqRunning();
  if (running !== _eqRunning) {
    _eqRunning = running;
    // Visibility flip — overlays appear/vanish as EQ comes up / goes down.
    try { applyAllVisibility(); } catch {}
  }
}
function _startEqPolling() {
  if (_eqPollTimer || process.platform !== 'win32') return;
  _pollEqPresence().catch(() => {});
  _eqPollTimer = setInterval(() => { _pollEqPresence().catch(() => {}); }, 10000);   // 5s->10s (2026-07-07 review: tasklist spawn pressure)
}
function _stopEqPolling() {
  if (_eqPollTimer) { clearInterval(_eqPollTimer); _eqPollTimer = null; }
}

// ── Visibility helpers (quiet mode is the master override) ─────────────────
// When overlays are UNLOCKED (positioning mode) we keep them visible
// regardless of quiet mode / pref toggles so the user can actually grab them
// — otherwise "unlock to move" would hide the thing you're trying to move.
// hideOverlaysWhenEqDown gates show-state on EQ being detected as running —
// also bypassed in unlock mode so the user can place overlays before launching
// EverQuest.
function _eqGateOk(cfg) {
  if (cfg.hideOverlaysWhenEqDown === false) return true;
  return _eqRunning;
}
function applyOverlayVisibility() {
  if (!overlayWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || (cfg.showHud && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) overlayWindow.showInactive(); else overlayWindow.hide();
}
function applyTriggerVisibility() {
  if (!triggerWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || _blindForceOpen('triggers') || (cfg.enableTriggerTts && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) triggerWindow.showInactive(); else triggerWindow.hide();
}
function createCharmOverlay() {
  const b = _resolveBounds('charmBounds', 'charmBoundsSig', { x: 700, y: 420, width: 300, height: 180 });
  charmWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Charm tracker overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 200, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  charmWindow.setAlwaysOnTop(true, 'screen-saver');
  charmWindow.setVisibleOnAllWorkspaces(true);
  charmWindow.loadFile('charm.html');
  charmWindow.on('moved',  () => _persistBounds('charmBounds', charmWindow));
  charmWindow.on('resize', () => _persistBounds('charmBounds', charmWindow));
  charmWindow.once('ready-to-show', () => {
    charmWindow.webContents.send('agent-port', agentPort);
    applyCharmVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(charmWindow, 'charm');
  });
}
function applyCharmVisibility() {
  if (!charmWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Charm tracker is opt-in (default off) — it's only useful to charm classes.
  const shouldShow = unlocked || _blindForceOpen('charm') || (cfg.showCharm && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) charmWindow.showInactive(); else charmWindow.hide();
}

// Pet tracker — summoned pets (mage/necro/beastlord) + their /pet health buff
// counters. Distinct from the charm tracker: no 6s tickdown, no recharm alarm,
// no break detection — just HP + buff timers for a pet you keep around.
function createPetsOverlay() {
  const b = _resolveBounds('petsBounds', 'petsBoundsSig', { x: 700, y: 620, width: 300, height: 160 });
  petsWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Pet tracker overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 200, minHeight: 70,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  petsWindow.setAlwaysOnTop(true, 'screen-saver');
  petsWindow.setVisibleOnAllWorkspaces(true);
  petsWindow.loadFile('pets.html');
  petsWindow.on('moved',  () => _persistBounds('petsBounds', petsWindow));
  petsWindow.on('resize', () => _persistBounds('petsBounds', petsWindow));
  petsWindow.once('ready-to-show', () => {
    petsWindow.webContents.send('agent-port', agentPort);
    applyPetsVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(petsWindow, 'pets');
  });
}
function applyPetsVisibility() {
  if (!petsWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — only useful to pet classes. EQ-gated.
  const shouldShow = unlocked || _blindForceOpen('pets') || (cfg.showPets && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) petsWindow.showInactive(); else petsWindow.hide();
}

// Buff Queue — buff + debuff/cure queue (same data the web /raid page shows),
// pinned in-game so a buffer can work the list without alt-tabbing. Polls the
// agent which proxies the bot's /api/agent/raid-buff-queue with a 3s cache.
function createBuffQueueOverlay() {
  const b = _resolveBounds('buffQueueBounds', 'buffQueueBoundsSig', { x: 1020, y: 60, width: 330, height: 260 });
  buffQueueWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Buff queue overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 100,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  buffQueueWindow.setAlwaysOnTop(true, 'screen-saver');
  buffQueueWindow.setVisibleOnAllWorkspaces(true);
  buffQueueWindow.loadFile('buffqueue.html');
  buffQueueWindow.on('moved',  () => _persistBounds('buffQueueBounds', buffQueueWindow));
  buffQueueWindow.on('resize', () => _persistBounds('buffQueueBounds', buffQueueWindow));
  buffQueueWindow.once('ready-to-show', () => {
    buffQueueWindow.webContents.send('agent-port', agentPort);
    applyBuffQueueVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(buffQueueWindow, 'buffQueue');
  });
}
function applyBuffQueueVisibility() {
  if (!buffQueueWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — most useful to support classes (clerics, druids,
  // shaman, enchanters, bards). EQ-gated.
  const shouldShow = unlocked || (cfg.showBuffQueue && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) buffQueueWindow.showInactive(); else buffQueueWindow.hide();
}

// Mob Info — current target's catalog stats (HP/AC/resists/special attacks).
function createMobInfoOverlay() {
  const b = _resolveBounds('mobInfoBounds', 'mobInfoBoundsSig', { x: 700, y: 60, width: 320, height: 200 });
  mobInfoWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Target Info overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 230, minHeight: 90,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  mobInfoWindow.setAlwaysOnTop(true, 'screen-saver');
  mobInfoWindow.setVisibleOnAllWorkspaces(true);
  mobInfoWindow.loadFile('mobinfo.html');
  mobInfoWindow.on('moved',  () => _persistBounds('mobInfoBounds', mobInfoWindow));
  mobInfoWindow.on('resize', () => _persistBounds('mobInfoBounds', mobInfoWindow));
  mobInfoWindow.once('ready-to-show', () => {
    mobInfoWindow.webContents.send('agent-port', agentPort);
    applyMobInfoVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(mobInfoWindow, 'mobinfo');
  });
}
function applyMobInfoVisibility() {
  if (!mobInfoWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || _blindForceOpen('mobinfo') || (cfg.showMobInfo && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) mobInfoWindow.showInactive(); else mobInfoWindow.hide();
}

// /who overlay — latest /who + recently-gone, anon rows de-anon'd from history.
function createWhoOverlay() {
  const b = _resolveBounds('whoBounds', 'whoBoundsSig', { x: 40, y: 300, width: 320, height: 280 });
  whoWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — /who overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 220, minHeight: 100,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  whoWindow.setAlwaysOnTop(true, 'screen-saver');
  whoWindow.setVisibleOnAllWorkspaces(true);
  whoWindow.loadFile('who.html');
  whoWindow.on('moved',  () => _persistBounds('whoBounds', whoWindow));
  whoWindow.on('resize', () => _persistBounds('whoBounds', whoWindow));
  whoWindow.once('ready-to-show', () => {
    whoWindow.webContents.send('agent-port', agentPort);
    applyWhoVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(whoWindow, 'who');
  });
}
function applyWhoVisibility() {
  if (!whoWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  const shouldShow = unlocked || (cfg.showWho && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) whoWindow.showInactive(); else whoWindow.hide();
}

// Melody overlay — bard /melody twist queue with per-song play / casting /
// stopped state. Reads from /api/state.bardMelody (per-character).
function createMelodyOverlay() {
  const b = _resolveBounds('melodyBounds', 'melodyBoundsSig', { x: 40, y: 600, width: 280, height: 180 });
  melodyWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Melody overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 200, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  melodyWindow.setAlwaysOnTop(true, 'screen-saver');
  melodyWindow.setVisibleOnAllWorkspaces(true);
  melodyWindow.loadFile('melody.html');
  melodyWindow.on('moved',  () => _persistBounds('melodyBounds', melodyWindow));
  melodyWindow.on('resize', () => _persistBounds('melodyBounds', melodyWindow));
  melodyWindow.once('ready-to-show', () => {
    melodyWindow.webContents.send('agent-port', agentPort);
    applyMelodyVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(melodyWindow, 'melody');
  });
}
function applyMelodyVisibility() {
  if (!melodyWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — only useful to bards. EQ-gated.
  const shouldShow = unlocked || (cfg.showMelody && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) melodyWindow.showInactive(); else melodyWindow.hide();
}

// Zeal health overlay — surfaces the live data-type tally from
// /api/state.zeal so users can diagnose missing Zeal pipes (no buff
// slot data → melody empty, no gauge data → charm tracker blank, etc.)
// without having to read the agent log. Opt-in.
function createZealHealthOverlay() {
  const b = _resolveBounds('zealBounds', 'zealBoundsSig', { x: 40, y: 800, width: 280, height: 220 });
  zealWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Zeal health overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 220, minHeight: 100,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  zealWindow.setAlwaysOnTop(true, 'screen-saver');
  zealWindow.setVisibleOnAllWorkspaces(true);
  zealWindow.loadFile('zealhealth.html');
  zealWindow.on('moved',  () => _persistBounds('zealBounds', zealWindow));
  zealWindow.on('resize', () => _persistBounds('zealBounds', zealWindow));
  zealWindow.once('ready-to-show', () => {
    zealWindow.webContents.send('agent-port', agentPort);
    applyZealVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(zealWindow, 'zeal');
  });
}
function applyZealVisibility() {
  if (!zealWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — diagnostic; users only need it during setup
  // or when something else looks broken. EQ-gated.
  const shouldShow = unlocked || (cfg.showZeal && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) zealWindow.showInactive(); else zealWindow.hide();
}

// Tank overlay — DS total, buffs+timers, Divine Aura countdown, current target
// HP, boss enrage warning, current rampage target. Reads /api/tank-state which
// aggregates everything from the locally-watched Zeal state. Cross-raid HP sync
// is Tier 4 (deferred); the overlay shows the active local character only.
// (Uilnayar 2026-06-25.)
function createTankOverlay() {
  const b = _resolveBounds('tankBounds', 'tankBoundsSig', { x: 40, y: 480, width: 300, height: 280 });
  tankWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Tank overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 120,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  tankWindow.setAlwaysOnTop(true, 'screen-saver');
  tankWindow.setVisibleOnAllWorkspaces(true);
  tankWindow.loadFile('tank.html');
  tankWindow.on('moved',  () => _persistBounds('tankBounds', tankWindow));
  tankWindow.on('resize', () => _persistBounds('tankBounds', tankWindow));
  tankWindow.once('ready-to-show', () => {
    tankWindow.webContents.send('agent-port', agentPort);
    applyTankVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(tankWindow, 'tank');
  });
}
function applyTankVisibility() {
  if (!tankWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in — most members don't tank, so default off. EQ-gated like the rest.
  const shouldShow = unlocked || (cfg.showTank && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) tankWindow.showInactive(); else tankWindow.hide();
}

// Threat meter overlay — per-fight per-player aggro breakdown (swing / proc /
// spell / heal stacked bar) reading stats.currentEncounterThreat. Tanks see
// where their hate is coming from; non-tanks see when they're about to pull.
// Opt-in (default off); EQ-gated like every other built-in.
function createThreatMeterOverlay() {
  const b = _resolveBounds('threatBounds', 'threatBoundsSig', { x: 40, y: 320, width: 320, height: 200 });
  threatWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Threat meter overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  threatWindow.setAlwaysOnTop(true, 'screen-saver');
  threatWindow.setVisibleOnAllWorkspaces(true);
  threatWindow.loadFile('threatmeter.html');
  threatWindow.on('moved',  () => _persistBounds('threatBounds', threatWindow));
  threatWindow.on('resize', () => _persistBounds('threatBounds', threatWindow));
  threatWindow.once('ready-to-show', () => {
    threatWindow.webContents.send('agent-port', agentPort);
    applyThreatVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(threatWindow, 'threat');
  });
}
function applyThreatVisibility() {
  if (!threatWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — primarily for tanks but useful to anyone who
  // wants to see if they're about to pull. EQ-gated.
  const shouldShow = unlocked || (cfg.showThreat && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) threatWindow.showInactive(); else threatWindow.hide();
}

// Extended Target overlay — raid-wide "who's targeting what", sorted by raider
// count, with HP + debuffs per target. Polls /api/extended-target (agent proxy
// of the bot aggregation). Opt-in (default off); EQ-gated. (Uilnayar 2026-06-29.)
function createExtTargetOverlay() {
  const b = _resolveBounds('extTargetBounds', 'extTargetBoundsSig', { x: 40, y: 360, width: 320, height: 240 });
  extTargetWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Extended Target overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  extTargetWindow.setAlwaysOnTop(true, 'screen-saver');
  extTargetWindow.setVisibleOnAllWorkspaces(true);
  extTargetWindow.loadFile('extarget.html');
  extTargetWindow.on('moved',  () => _persistBounds('extTargetBounds', extTargetWindow));
  extTargetWindow.on('resize', () => _persistBounds('extTargetBounds', extTargetWindow));
  extTargetWindow.once('ready-to-show', () => {
    extTargetWindow.webContents.send('agent-port', agentPort);
    applyExtTargetVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(extTargetWindow, 'exttarget');
  });
}
function applyExtTargetVisibility() {
  if (!extTargetWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off). EQ-gated like every other built-in.
  const shouldShow = unlocked || (cfg.showExtTarget && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) extTargetWindow.showInactive(); else extTargetWindow.hide();
}

// Command Center overlay — the "one window" raid board (Uilnayar 2026-07-03):
// boss/MT/rampage/enrage/Death Touch (same data as the Tank overlay) plus
// raid-wide DA/invuln status and healer mana parsed from raid-chat macros,
// plus Curse/Cure alerts from the buff queue. Reads /api/command-center.
function createCommandOverlay() {
  const b = _resolveBounds('commandBounds', 'commandBoundsSig', { x: 40, y: 40, width: 320, height: 360 });
  commandWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Command Center',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 260, minHeight: 160,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  commandWindow.setAlwaysOnTop(true, 'screen-saver');
  commandWindow.setVisibleOnAllWorkspaces(true);
  commandWindow.loadFile('command.html');
  commandWindow.on('moved',  () => _persistBounds('commandBounds', commandWindow));
  commandWindow.on('resize', () => _persistBounds('commandBounds', commandWindow));
  commandWindow.once('ready-to-show', () => {
    commandWindow.webContents.send('agent-port', agentPort);
    applyCommandVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(commandWindow, 'command');
  });
}
function applyCommandVisibility() {
  if (!commandWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off). EQ-gated like every other built-in.
  const shouldShow = unlocked || (cfg.showCommand && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) commandWindow.showInactive(); else commandWindow.hide();
}

// CH chain overlay — cleric Complete Heal rotation read from the zone-visible
// shout/raid callouts ("004 - CH - Naggato - Mana: 52%" / "005 GO GO GO").
// Slot order, caller + mana, live cast bar, NEXT cue + beat countdown.
// Reads stats.chChain via /api/state — fully local, no relay. Opt-in.
function createChChainOverlay() {
  const b = _resolveBounds('chChainBounds', 'chChainBoundsSig', { x: 40, y: 540, width: 280, height: 240 });
  chChainWindow = new BrowserWindow({
    title: 'Wolf Pack Mimic — CH chain overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 220, minHeight: 90,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true,
    // focusable: false → on Windows this sets WS_EX_NOACTIVATE on the
    // overlay's native HWND, so clicks fire DOM events without bringing
    // the window to the foreground. Reported by Uilnayar (2026-06-19) —
    // clicking ⚙ / lock / move on the CH chain overlay pulled focus from
    // EQ, and missing-the-refocus-on-the-way-back cost real CH heals. We
    // don't take keyboard input on this overlay and drag is custom IPC
    // (mousedown → setBounds), so neither relies on activation. Safe to
    // extend to the other read-only overlays once we've validated this
    // one in a live raid.
    focusable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  chChainWindow.setAlwaysOnTop(true, 'screen-saver');
  chChainWindow.setVisibleOnAllWorkspaces(true);
  chChainWindow.loadFile('chchain.html');
  chChainWindow.on('moved',  () => _persistBounds('chChainBounds', chChainWindow));
  chChainWindow.on('resize', () => _persistBounds('chChainBounds', chChainWindow));
  chChainWindow.once('ready-to-show', () => {
    chChainWindow.webContents.send('agent-port', agentPort);
    applyChChainVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(chChainWindow, 'chchain');
  });
}
function applyChChainVisibility() {
  if (!chChainWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — healers + raid leads watching the rotation. EQ-gated.
  const shouldShow = unlocked || (cfg.showChChain && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) chChainWindow.showInactive(); else chChainWindow.hide();
}

// Convenience: refresh every overlay's visibility at once. Used by the EQ-
// presence poller (on running ↔ not-running flips) and by config toggles.
function applyAllVisibility() {
  applyOverlayVisibility();
  applyTriggerVisibility();
  applyCharmVisibility();
  applyPetsVisibility();
  applyMobInfoVisibility();
  applyBuffQueueVisibility();
  applyWhoVisibility();
  applyMelodyVisibility();
  applyZealVisibility();
  applyThreatVisibility();
  applyChChainVisibility();
  applyTankVisibility();
  applyExtTargetVisibility();
  applyCommandVisibility();
}

// ── Hide-all-overlays toggle ────────────────────────────────────────────────
// Quick way to clear the screen for a screenshot / a tough fight / whatever.
// Snapshots the user's per-overlay show prefs, flips them all OFF, then
// restores on the next toggle so individual choices survive the round-trip.
// Bound to a tray menu item + a global hotkey (Ctrl+Shift+H by default).
let _hideAllActive = false;
let _hideAllPrev = null;          // { showHud, enableTriggerTts, showCharm, ... }
const _DEFAULT_HIDE_HOTKEY = 'CommandOrControl+Shift+H';
let _registeredHideAccel = null;  // the accelerator currently registered
function _hideAllAccelerator() {
  const cfg = loadConfig();
  const h = (cfg && typeof cfg.hideAllHotkey === 'string' && cfg.hideAllHotkey.trim()) ? cfg.hideAllHotkey.trim() : _DEFAULT_HIDE_HOTKEY;
  return h;
}
function _fmtAccel(accel) { return String(accel || '').replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl'); }
function _hideAllHotkeyLabelNow() { const a = _hideAllAccelerator(); return a ? _fmtAccel(a) : ''; }
function toggleHideAllOverlays() {
  const cfg = loadConfig();
  if (!_hideAllActive) {
    // Snapshot + flip all off.
    _hideAllPrev = {
      showHud:          !!cfg.showHud,
      enableTriggerTts: !!cfg.enableTriggerTts,
      showCharm:        !!cfg.showCharm,
      showPets:         !!cfg.showPets,
      showMobInfo:      !!cfg.showMobInfo,
      showBuffQueue:    !!cfg.showBuffQueue,
      showWho:          !!cfg.showWho,
      showMelody:       !!cfg.showMelody,
      showZeal:         !!cfg.showZeal,
      showThreat:       !!cfg.showThreat,
      showChChain:      !!cfg.showChChain,
      showTank:         !!cfg.showTank,
      showExtTarget:    !!cfg.showExtTarget,
    };
    cfg.showHud = false;
    cfg.enableTriggerTts = false;
    cfg.showCharm = false;
    cfg.showPets = false;
    cfg.showMobInfo = false;
    cfg.showBuffQueue = false;
    cfg.showWho = false;
    cfg.showMelody = false;
    cfg.showZeal = false;
    cfg.showThreat = false;
    cfg.showChChain = false;
    cfg.showTank = false;
    cfg.showExtTarget = false;
    _hideAllActive = true;
  } else if (_hideAllPrev) {
    // Restore from snapshot — respects whatever individual prefs the user
    // had when they hid. Skip restore when no snapshot exists.
    Object.assign(cfg, _hideAllPrev);
    _hideAllActive = false;
    _hideAllPrev = null;
  } else {
    // Active but no snapshot (e.g. restarted while hidden, snapshot lost in an
    // older build): SHOW the core overlays so the hotkey can never get stuck
    // unable to unhide.
    cfg.showHud = true; cfg.showCharm = true; cfg.showPets = true;
    cfg.showMobInfo = true; cfg.showBuffQueue = true; cfg.showWho = true; cfg.showMelody = true; cfg.showZeal = true; cfg.showThreat = true;
    _hideAllActive = false;
  }
  // Persist the toggle state so a restart-while-hidden still knows it's hidden
  // and the hotkey restores correctly next launch (the bug: in-memory only).
  cfg.hideAllActive = _hideAllActive;
  cfg.hideAllPrev   = _hideAllPrev;
  saveConfig(cfg);
  applyAllVisibility();
  pushStatus();
}
function registerHideAllHotkey() {
  try {
    const { globalShortcut } = require('electron');
    // Restore persisted hide state so the toggle is correct across restarts.
    const cfg = loadConfig();
    if (typeof cfg.hideAllActive === 'boolean') _hideAllActive = cfg.hideAllActive;
    if (cfg.hideAllPrev && typeof cfg.hideAllPrev === 'object') _hideAllPrev = cfg.hideAllPrev;
    // (Re)register the configured accelerator, dropping any prior binding.
    if (_registeredHideAccel) { try { globalShortcut.unregister(_registeredHideAccel); } catch {} _registeredHideAccel = null; }
    const accel = _hideAllAccelerator();
    if (!accel) return;
    const ok = globalShortcut.register(accel, toggleHideAllOverlays);
    if (ok) _registeredHideAccel = accel;
    else appendAgentLog(`[mimic] failed to register hide-all hotkey "${accel}" (in use by another app?)\n`);
  } catch (e) { appendAgentLog('[mimic] hide-all hotkey error: ' + e.message + '\n'); }
}

// Autostart-with-Windows wiring. Backed by app.setLoginItemSettings — Electron
// writes/removes the registry entry under HKCU\…\Run for us. Called from the
// tray toggle and on startup so the registry stays consistent with the saved
// config.
//
// CRITICAL: pass the explicit `name` matching what the NSIS installer writes
// ("WolfPackMimic"). Without this, Electron uses the app's executable-name
// default ("Wolf Pack Mimic" or "wolfpack-mimic" depending on packaging),
// which is DIFFERENT from the installer's key — so Windows ends up with TWO
// Run keys for the same app, and the Startup apps page shows two entries.
// _AUTOSTART_REG_NAME is the canonical key name; cleanupDuplicateAutostart
// below also sweeps any stragglers from older builds that used a different
// name so existing dupes drain out.
const _AUTOSTART_REG_NAME = 'WolfPackMimic';
function applyAutoStart() {
  if (process.platform !== 'win32') return;
  try {
    const cfg = loadConfig();
    app.setLoginItemSettings({
      openAtLogin: !!cfg.autoStart,
      // Launch hidden-to-tray so an auto-start session doesn't pop the
      // dashboard window in the user's face right after login.
      args: ['--autostart'],
      name: _AUTOSTART_REG_NAME,
    });
  } catch (e) { void e; }
  // Always sweep dupes after applying — covers the "user upgraded from a
  // version that wrote a different name" path so they don't see two
  // Mimic entries in the Startup apps list.
  cleanupDuplicateAutostartEntries();
}

// Remove any HKCU\…\Run entries that point at the installed Mimic exe but
// use a different value name than our canonical _AUTOSTART_REG_NAME. Users
// who installed → autostart enabled, then upgraded to a build that started
// using a new name, would otherwise see two entries in Windows' Startup
// apps page (both pointing at Mimic). Idempotent: safe to call on every
// boot + every toggle.
function cleanupDuplicateAutostartEntries() {
  if (process.platform !== 'win32') return;
  try {
    const { execFile } = require('child_process');
    // Query the Run key; expect a few rows. We strip everything except
    // entries whose value-data is the path to OUR mimic exe.
    execFile('reg.exe',
      ['QUERY', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return;
        const exeHint = (app.getPath('exe') || '').toLowerCase();
        const myExeName = 'wolf pack mimic.exe';   // also covers older builds
        const lines = stdout.split(/\r?\n/);
        const toDelete = [];
        for (const line of lines) {
          // Format: "    NAME    REG_SZ    DATA"
          const m = line.match(/^\s+(\S.*?)\s+REG_SZ\s+(.+)$/);
          if (!m) continue;
          const name = m[1].trim();
          const data = m[2].trim().toLowerCase();
          if (name === _AUTOSTART_REG_NAME) continue;        // canonical — keep
          // Only touch entries that actually point at Mimic (don't go
          // wiping unrelated apps the user has in their Run key).
          if (data.includes(myExeName) || (exeHint && data.includes(exeHint))) {
            toDelete.push(name);
          }
        }
        for (const name of toDelete) {
          execFile('reg.exe',
            ['DELETE', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/V', name, '/F'],
            { windowsHide: true, timeout: 5000 },
            () => { /* best-effort */ });
        }
      });
  } catch (e) { void e; }
}

// ── Status + Tray ──────────────────────────────────────────────────────────
function currentStatus() {
  const cfg = loadConfig();
  const localOnly = !resolveUploadToken(cfg);
  return {
    agentPort,
    agentRunning: !!agentProc,
    localOnly,
    quietMode: !!cfg.quietMode,
    tellsMode: cfg.tellsMode || 'off',
    tellsDmPausedUntil: (Number(cfg.tellsDmPausedUntil) || 0) > Date.now() ? Number(cfg.tellsDmPausedUntil) : 0,
    showHud: !!cfg.showHud,
    enableTriggerTts: !!cfg.enableTriggerTts,
    showCharm: !!cfg.showCharm,
    showPets: !!cfg.showPets,
    showMobInfo: !!cfg.showMobInfo,
    showBuffQueue: !!cfg.showBuffQueue,
    showWho: !!cfg.showWho,
    showMelody: !!cfg.showMelody,
    melodyBardOnly: !!cfg.melodyBardOnly,
    showZeal: !!cfg.showZeal,
    showThreat: !!cfg.showThreat,
    showChChain: !!cfg.showChChain,
    showTank: !!cfg.showTank,
    showExtTarget: !!cfg.showExtTarget,
    showCommand: !!cfg.showCommand,
    overlaysLocked: cfg.overlaysLocked !== false,
    setupMode: !!setupMode,
    onboarded: !!cfg.onboarded,
    updatePending: updatePending ? updatePending.version : null,
    botUrl: cfg.botUrl,
    // Mimic Discord login (v1). `mimicSession` is the cached identity if
    // we've completed the device-code dance; `mimicLinking` is the in-flight
    // user code so the Settings window can show it while polling.
    mimicSession: cfg.session ? {
      discord_id:   cfg.session.identity?.discord_id   || null,
      display_name: cfg.session.identity?.display_name || null,
      is_officer:   !!cfg.session.identity?.is_officer,
      linked_at:    cfg.session.linked_at || null,
    } : null,
    mimicLinking: _linkInFlight ? {
      user_code:        _linkInFlight._pub.user_code,
      verification_url: _linkInFlight._pub.verification_url,
      expires_at:       _linkInFlight._pub.expires_at,
    } : null,
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
  if (!s.agentRunning) return `Wolf Pack miMIC ${v} — agent starting…`;
  // Setup state wins the tooltip when something's wrong — the tray icon is the
  // last visible Mimic surface for users who hide the window, so the tooltip
  // should call out what to fix when they finally hover.
  const issue = _setupIssue();
  if (issue) return `⚠ Wolf Pack miMIC ${v} — SETUP NEEDED: ${issue}`;
  const mode = s.localOnly ? 'Local only' : 'Uploading';
  const quiet = s.quietMode ? ' · Quiet mode' : '';
  const upd = s.updatePending ? ` · update ${s.updatePending} ready` : '';
  return `Wolf Pack miMIC ${v} — ${mode} · port ${s.agentPort}${quiet}${upd}`;
}

// ── Self-uninstall ──────────────────────────────────────────────────────────
// electron-builder always generates an uninstaller (Add/Remove Programs entry +
// Uninstall <App>.exe in the install dir) — but a tray app gives no obvious way
// to FIND it, which testers hit. Surface it directly from the tray. The exe
// lives next to our own (process.execPath = <INSTDIR>\Wolf Pack Mimic.exe), so
// the uninstaller is <INSTDIR>\Uninstall Wolf Pack Mimic.exe. Returns null in
// dev mode / non-Windows / if the file isn't there, so the tray item hides
// rather than offering a dead action.
function _uninstallerPath() {
  if (process.platform !== 'win32') return null;
  try {
    const dir = path.dirname(process.execPath);
    // electron-builder names the uninstaller "Uninstall <ProductName>.exe", but
    // the exact casing/name has drifted (install dir is "wolfpack-mimic" but the
    // exe may be productName-cased), so glob rather than hardcode. Take the
    // first "Uninstall*.exe" sitting next to our own exe.
    const exact = path.join(dir, 'Uninstall Wolf Pack Mimic.exe');
    if (fs.existsSync(exact)) return exact;
    const hit = fs.readdirSync(dir).find(f => /^uninstall.*\.exe$/i.test(f));
    return hit ? path.join(dir, hit) : null;
  } catch { return null; }
}
async function runUninstaller() {
  const exe = _uninstallerPath();
  if (!exe) {
    try {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Uninstall Wolf Pack Mimic',
        message: 'Uninstall from Windows Settings',
        detail: 'Open Windows Settings → Apps → Installed apps → Wolf Pack Mimic → Uninstall. (The in-app uninstaller is only available on packaged installs.)',
      });
    } catch (e) { void e; }
    return;
  }
  const res = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Uninstall Wolf Pack Mimic',
    message: 'Uninstall Wolf Pack Mimic?',
    detail: 'This closes Mimic and launches the uninstaller. Your saved Wolf Pack login, agent token, and settings on this machine will be removed.',
  });
  if (res.response !== 0) return;
  // Quit ourselves first so the running .exe isn't locked, then launch the
  // detached uninstaller. unref() lets it outlive us.
  quitting = true;
  try { if (agentProc) agentProc.kill(); } catch (e) { void e; }
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    try { appendAgentLog(`[mimic] failed to launch uninstaller: ${e && e.message}\n`); } catch (_) {}
  }
  setTimeout(() => app.quit(), 400);
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

  // Overlays — the actual on-screen overlays + their placement controls. Renamed
  // from the old "Live alerts" (misleading: these are overlays, not alerts).
  const overlaysSubmenu = [
    { label: 'DPS HUD', type: 'checkbox', checked: s.showHud, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showHud = mi.checked; saveConfig(cfg);
        if (mi.checked && !overlayWindow) createOverlayWindow(); else applyOverlayVisibility();
        pushStatus();
      } },
    { label: 'Trigger alerts (TTS)', type: 'checkbox', checked: s.enableTriggerTts, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.enableTriggerTts = mi.checked; saveConfig(cfg);
        if (mi.checked && !triggerWindow) createTriggerOverlay(); else applyTriggerVisibility();
        pushStatus();
      } },
    { label: 'Charm tracker', type: 'checkbox', checked: s.showCharm, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showCharm = mi.checked; saveConfig(cfg);
        if (mi.checked && !charmWindow) createCharmOverlay(); else applyCharmVisibility();
        pushStatus();
      } },
    { label: 'Pet tracker (summoned pets)', type: 'checkbox', checked: s.showPets, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showPets = mi.checked; saveConfig(cfg);
        if (mi.checked && !petsWindow) createPetsOverlay(); else applyPetsVisibility();
        pushStatus();
      } },
    { label: 'Target Info (target stats)', type: 'checkbox', checked: s.showMobInfo, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showMobInfo = mi.checked; saveConfig(cfg);
        if (mi.checked && !mobInfoWindow) createMobInfoOverlay(); else applyMobInfoVisibility();
        pushStatus();
      } },
    { label: 'Buff queue (raid gaps + cures)', type: 'checkbox', checked: s.showBuffQueue, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showBuffQueue = mi.checked; saveConfig(cfg);
        if (mi.checked && !buffQueueWindow) createBuffQueueOverlay(); else applyBuffQueueVisibility();
        pushStatus();
      } },
    { label: '/who (zone roster)', type: 'checkbox', checked: s.showWho, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showWho = mi.checked; saveConfig(cfg);
        if (mi.checked && !whoWindow) createWhoOverlay(); else applyWhoVisibility();
        pushStatus();
      } },
    { label: 'Casting tracker (melody on bards, spells otherwise)', type: 'checkbox', checked: s.showMelody, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showMelody = mi.checked; saveConfig(cfg);
        if (mi.checked && !melodyWindow) createMelodyOverlay(); else applyMelodyVisibility();
        pushStatus();
      } },
    { label: '  ↳ Only show on bard characters', type: 'checkbox', checked: s.melodyBardOnly, enabled: !s.quietMode && s.showMelody, click: (mi) => {
        const cfg = loadConfig(); cfg.melodyBardOnly = mi.checked; saveConfig(cfg);
        pushStatus();
      } },
    { label: 'Zeal health (diagnostic)', type: 'checkbox', checked: s.showZeal, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showZeal = mi.checked; saveConfig(cfg);
        if (mi.checked && !zealWindow) createZealHealthOverlay(); else applyZealVisibility();
        pushStatus();
      } },
    { label: 'Threat meter', type: 'checkbox', checked: s.showThreat, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showThreat = mi.checked; saveConfig(cfg);
        if (mi.checked && !threatWindow) createThreatMeterOverlay(); else applyThreatVisibility();
        pushStatus();
      } },
    { label: 'Tank HUD (DS, buffs, DA, rampage)', type: 'checkbox', checked: s.showTank, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showTank = mi.checked; saveConfig(cfg);
        if (mi.checked && !tankWindow) createTankOverlay(); else applyTankVisibility();
        pushStatus();
      } },
    { label: 'CH chain', type: 'checkbox', checked: s.showChChain, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showChChain = mi.checked; saveConfig(cfg);
        if (mi.checked && !chChainWindow) createChChainOverlay(); else applyChChainVisibility();
        pushStatus();
      } },
    { label: 'Extended Target (raid-wide targets)', type: 'checkbox', checked: s.showExtTarget, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showExtTarget = mi.checked; saveConfig(cfg);
        if (mi.checked && !extTargetWindow) createExtTargetOverlay(); else applyExtTargetVisibility();
        pushStatus();
      } },
    { label: 'Command Center (one-window raid board)', type: 'checkbox', checked: s.showCommand, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showCommand = mi.checked; saveConfig(cfg);
        if (mi.checked && !commandWindow) createCommandOverlay(); else applyCommandVisibility();
        pushStatus();
      } },
    { type: 'separator' },
    // Panel-overlay tray toggles removed per user feedback — the per-card
    // "🪟 overlay" buttons on the dashboard cover ad-hoc pop-outs without a
    // global list that pretends to be raid-window state. PANEL_OVERLAYS
    // stays defined for createPanelOverlay key resolution.
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
    // Hide-all toggle — flips every overlay off in one shot, then back to
    // their previous visibility on the next toggle. The "memory" lives in
    // _hideAllPrev so the user's pref selection is preserved across the
    // hide/show round-trip. Bindable hotkey lives in registerHideAllHotkey().
    { label: _hideAllActive ? '👁 Show overlays (' + (_hideAllHotkeyLabelNow() || 'no hotkey') + ')' : '🙈 Hide all overlays (' + (_hideAllHotkeyLabelNow() || 'no hotkey') + ')',
      click: () => { toggleHideAllOverlays(); } },
    // Per-character overlay layouts (v1.2 Phase B) — save/restore the visibility
    // set per toon, swapped automatically as the active character changes.
    ..._charProfileTrayItems(),
  ];

  // My /tells — its own section now (was buried inside the overlay submenu).
  const tellsSubmenu = [
    { label: 'Off — ignore tells',
      type: 'radio', checked: s.tellsMode === 'off',
      click: () => { const c = loadConfig(); c.tellsMode = 'off';    saveConfig(c); pushStatus(); } },
    { label: 'Local only — show on this machine',
      type: 'radio', checked: s.tellsMode === 'local',
      click: () => { const c = loadConfig(); c.tellsMode = 'local';  saveConfig(c); pushStatus(); } },
    { label: 'Synced (encrypted) — read on wolfpack.quest/me/tells',
      type: 'radio', checked: s.tellsMode === 'synced',
      click: () => { const c = loadConfig(); c.tellsMode = 'synced'; saveConfig(c); pushStatus(); } },
    { type: 'separator' },
    // Pause Discord DMs — temporary, per-machine. Tells still write to the
    // table (so /me/tells stays current); only the Discord DM ping is muted
    // until the deadline. setPause(0) resumes now. Only meaningful in synced
    // mode (that's the mode that DMs), so we disable it otherwise.
    { label: s.tellsDmPausedUntil
        ? `Discord DMs paused — resumes ${_fmtPauseClock(s.tellsDmPausedUntil)}`
        : 'Discord DMs: active',
      enabled: false },
    { label: 'Pause Discord DMs',
      enabled: s.tellsMode === 'synced',
      submenu: [
        { label: 'For 15 minutes', click: () => _setTellsDmPause(Date.now() + 15 * 60 * 1000) },
        { label: 'For 1 hour',     click: () => _setTellsDmPause(Date.now() + 60 * 60 * 1000) },
        { label: 'For 4 hours',    click: () => _setTellsDmPause(Date.now() + 4 * 60 * 60 * 1000) },
        { label: 'Until tomorrow', click: () => _setTellsDmPause(Date.now() + 24 * 60 * 60 * 1000) },
      ] },
    { label: 'Resume Discord DMs now',
      enabled: !!s.tellsDmPausedUntil,
      click: () => _setTellsDmPause(0) },
  ];

  const connectItem = s.localOnly
    ? { label: 'Connect to Wolf Pack…', click: openSettings }
    : { label: 'Disconnect (revert to local only)', click: async () => {
        // Full sign-out: clears the encrypted session token + legacy token,
        // best-effort revokes server-side, and relaunches local-only.
        await signOutMimic();
      } };

  const updateItem = updatePending
    ? { label: `Restart to install update v${updatePending.version}`, click: () => { try { autoUpdater && autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } } }
    : { label: 'Check for updates…', click: () => safeCheckForUpdates(true), enabled: !!autoUpdater };
  // When unchecked (default), a ready update shows only as a dashboard banner +
  // the tray item above and applies on next quit — no pop-up. Check it to get
  // the "Restart now?" dialog back.
  const updatePopupItem = {
    label: 'Pop up when an update is ready',
    type: 'checkbox',
    checked: loadConfig().quietUpdates === false,
    click: (mi) => { const cfg = loadConfig(); cfg.quietUpdates = !mi.checked; saveConfig(cfg); pushStatus(); },
  };
  // Beta channel opt-in. Persisted in cfg; takes effect immediately by
  // reconfiguring the live autoUpdater + kicking off a fresh check so the user
  // gets feedback right away (a beta will start downloading if one is out, or
  // the agent log will show "no update available"). Disabled if electron-updater
  // didn't load (dev mode running via `electron .`).
  const betaChannelItem = {
    label: 'Receive beta updates',
    type: 'checkbox',
    checked: loadConfig().betaChannel === true,
    enabled: !!autoUpdater,
    click: (mi) => {
      const cfg = loadConfig();
      cfg.betaChannel = !!mi.checked;
      saveConfig(cfg);
      if (autoUpdater) {
        _applyUpdaterChannel();
        appendAgentLog(`[updater] beta channel ${cfg.betaChannel ? 'enabled' : 'disabled'} — checking…\n`);
        safeCheckForUpdates(true);
      }
      pushStatus();
    },
  };

  const menu = Menu.buildFromTemplate([
    { label: headerLabel, enabled: false },
    { type: 'separator' },
    // Most-used actions up top: open the local dashboard, jump to the site.
    { label: 'Show dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Open wolfpack.quest ↗', click: () => shell.openExternal(WOLFPACK_URL) },
    { type: 'separator' },
    { label: 'I use EQLogParser / other parser (Quiet mode)', type: 'checkbox', checked: s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.quietMode = mi.checked; saveConfig(cfg);
        applyAllVisibility();
        pushStatus();
      } },
    ...(process.platform === 'win32' ? [
      { label: 'Start with Windows', type: 'checkbox', checked: !!s.autoStart, click: (mi) => {
          const cfg = loadConfig(); cfg.autoStart = !!mi.checked; saveConfig(cfg);
          applyAutoStart(); pushStatus();
        } },
      { label: 'Hide overlays when EverQuest isn\'t running', type: 'checkbox', checked: s.hideOverlaysWhenEqDown !== false, click: (mi) => {
          const cfg = loadConfig(); cfg.hideOverlaysWhenEqDown = !!mi.checked; saveConfig(cfg);
          // Re-probe immediately so the next visibility flip is accurate
          // instead of waiting up to 5s for the poller to tick.
          _pollEqPresence().then(() => applyAllVisibility()).catch(() => applyAllVisibility());
          pushStatus();
        } },
    ] : []),
    { label: 'My /tells  🔒 PRIVATE', submenu: tellsSubmenu },
    { type: 'separator' },
    connectItem,
    { label: 'Show agent log…', click: () => shell.openPath(AGENT_LOG()) },
    { label: 'Open dashboard in browser', click: () => shell.openExternal(`http://127.0.0.1:${agentPort}/`) },
    { label: 'UI Studio — rescale EQ UI for a new resolution', click: () => openUiStudio() },
    updatePopupItem,
    betaChannelItem,
    // Uninstall lives in the maintenance block — deliberately NOT next to Quit.
    // The tray menu opens upward with the cursor resting at the BOTTOM, so a
    // bottom-adjacent uninstall was far too easy to mis-click (tester feedback).
    ...(_uninstallerPath() ? [{ label: 'Uninstall Wolf Pack Mimic…', click: () => { runUninstaller(); } }] : []),
    { type: 'separator' },
    // Bottom block per user request: Overlays sits right above Restart agent
    // (the tray opens upward, so this puts the most-used submenu nearest the
    // cursor), then Check for updates directly below Restart, then Settings →
    // Quit as the two safe bottom actions.
    { label: 'Overlays', submenu: overlaysSubmenu },
    { label: 'Restart agent', click: async () => {
        if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); }
      } },
    updateItem,
    { label: 'Settings…', click: openSettings },
    { label: 'Quit Mimic', click: () => { quitting = true; if (agentProc) { try { agentProc.kill(); } catch {} } app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(tooltipFor(s));
}

// ── Auto-update ────────────────────────────────────────────────────────────
// `verbose` (the manual "Check for updates…" click / dashboard button) used
// to ONLY affect the "check failed to even start" case — the actual result
// (found / not found / downloaded) came back through electron-updater's
// events, which fire identically whether the check was manual or the silent
// hourly poll, so a manual click when already current gave literally zero
// feedback (Uilnayar 2026-07-03: "the check for update doesn't look like
// it's working - no popup"). _manualCheckPending bridges that: set here,
// consumed + cleared by whichever updater event fires next in wireAutoUpdater.
let _manualCheckPending = false;
function safeCheckForUpdates(verbose) {
  if (!autoUpdater) {
    if (verbose) dialog.showMessageBox({ type: 'info', message: 'Updates aren\'t available in dev mode.' });
    return;
  }
  if (verbose) {
    _manualCheckPending = true;
    // Safety net — if nothing resolves it within 30s (unlikely; checkForUpdates
    // itself times out well before that), don't leave a stale flag around to
    // pop a dialog on some LATER unrelated background event.
    clearTimeout(safeCheckForUpdates._clearT);
    safeCheckForUpdates._clearT = setTimeout(() => { _manualCheckPending = false; }, 30_000);
  }
  try {
    autoUpdater.checkForUpdates().catch((e) => {
      appendAgentLog(`[updater] check failed: ${e.message || e}\n`);
      if (verbose) {
        _manualCheckPending = false;
        dialog.showMessageBox({ type: 'info', message: `Update check failed: ${e.message || e}` });
      }
    });
  } catch (e) {
    appendAgentLog(`[updater] check threw: ${e.message || e}\n`);
    if (verbose) _manualCheckPending = false;
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
  // Beta Mimic builds ship their own agent and should NOT hot-swap from
  // main — main's `/api/agent/latest-version` could be on an older agent
  // than the one bundled in this beta build, or worse, on a stable release
  // that's missing beta-only changes. Detect prerelease via the build's own
  // version (presence of `-` per semver) and skip the swap entirely.
  // Stable Mimic installs keep their existing 30-min hot-swap cadence.
  if (/-/.test(String(app.getVersion() || ''))) return;
  _agentUpdateInFlight = true;
  try {
    const cfg = loadConfig();
    const base = _botBaseUrl(cfg);
    let manifest;
    const _authToken = resolveUploadToken(cfg);
    try {
      manifest = await _httpsJson(`${base}/api/agent/latest-version`,
        _authToken ? { headers: { 'Authorization': 'Bearer ' + _authToken } } : {});
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

// Channel resolution. Two inputs feed it:
//   1. This BUILD's own version (baked into app-update.yml at electron-builder
//      time) — `-beta.N` suffix means the user originally installed a beta.
//   2. The USER's current preference (`cfg.betaChannel`), toggled from the
//      tray menu and persisted.
// Either being true enables the beta track. The two-input rule means a tester
// who first installed a beta keeps getting betas even without touching the
// toggle, AND a stable-installer user can opt in/out at any time. Every release
// publishes both latest.yml and beta.yml (generateUpdatesFilesForAllChannels),
// so the beta channel sees stable too — opting OUT just stops the flow of new
// betas; the user keeps whatever they have until stable catches up.
function _applyUpdaterChannel() {
  if (!autoUpdater) return false;
  const _buildIsBeta = /-/.test(String(app.getVersion() || ''));
  const userOptedIn  = !!loadConfig().betaChannel;
  const wantBeta     = _buildIsBeta || userOptedIn;
  autoUpdater.allowPrerelease = wantBeta;
  autoUpdater.channel         = wantBeta ? 'beta' : 'latest';
  return wantBeta;
}

function wireAutoUpdater() {
  if (!autoUpdater) return;
  _applyUpdaterChannel();
  autoUpdater.autoDownload    = true;
  // Apply a downloaded shell update SILENTLY on the next normal quit (no NSIS
  // wizard, no UAC since perMachine:false). Combined with quitAndInstall(true,
  // true) on the explicit "Restart now" path, the user never sees the
  // installer again after the first manual install. Frequent updates are the
  // agent, which hot-swaps in place (no installer at all).
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    appendAgentLog(`[updater] update available: v${info && info.version}\n`);
    // Don't clear _manualCheckPending here — update-downloaded (or error)
    // follows shortly since autoDownload is on, and THAT'S the meaningful
    // "here's your feedback" moment. Popping a dialog at both points would
    // just be two prompts in a row for one click.
  });
  autoUpdater.on('update-not-available', () => {
    appendAgentLog(`[updater] no update available\n`);
    // This is the case that was completely silent before — a manual "Check
    // for updates…" click when already current produced zero feedback.
    if (_manualCheckPending) {
      _manualCheckPending = false;
      dialog.showMessageBox({ type: 'info', message: `You're up to date (v${app.getVersion()}).` });
    }
  });
  autoUpdater.on('download-progress', (p) => {
    appendAgentLog(`[updater] download ${Math.round(p.percent)}%\n`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updatePending = info || { version: '?' };
    appendAgentLog(`[updater] downloaded v${updatePending.version} — ready to install\n`);
    // pushStatus() refreshes the tray "Restart to install vX" item AND the
    // dashboard banner (preload reads status.updatePending). The update also
    // applies on its own at the next normal quit (autoInstallOnAppQuit), so a
    // pop-up is optional in the background-poll case. Show it either when the
    // user has explicitly opted out of quiet updates, OR when they just
    // clicked "Check for updates…" themselves — an explicit ask deserves an
    // explicit answer regardless of the quiet-updates preference.
    pushStatus();
    const quiet = loadConfig().quietUpdates !== false;
    const manual = _manualCheckPending;
    _manualCheckPending = false;
    if ((!quiet || manual) && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Wolf Pack miMIC — update ready',
        message: `Mimic v${updatePending.version} is ready to install.`,
        detail: 'Restart now to apply the update. Your settings and agent state are preserved.',
      }).then(({ response }) => {
        if (response === 0) { try { autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); } }
      });
    }
  });
  autoUpdater.on('error', (err) => {
    appendAgentLog(`[updater] error: ${err && (err.message || err)}\n`);
    if (_manualCheckPending) {
      _manualCheckPending = false;
      dialog.showMessageBox({ type: 'info', message: `Update check failed: ${(err && (err.message || err)) || 'unknown error'}` });
    }
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
    _startWindowDrag(win, _boundsKeyForWindow(win));
  } catch {}
  return true;
});
ipcMain.handle('overlay-drag-end', () => { _stopWindowDrag(); return true; });

// Auto-fit the overlay window to its rendered content height. The renderer
// passes the natural content height (scrollHeight of #wrap) — we add a small
// chrome margin, clamp to the work-area height, and apply only when the
// delta is meaningful so we don't fight the user mid-drag.
ipcMain.handle('overlay-auto-height', (e, h) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    const wanted = Math.max(50, Math.round(+h || 0));
    if (!wanted) return false;
    const bounds = win.getBounds();
    const disp   = screen.getDisplayMatching(bounds);
    const maxH   = Math.max(80, disp.workArea.height - 20);
    const target = Math.min(maxH, wanted);
    // Don't bounce on tiny pixel-rounding deltas (Chromium font metrics jitter
    // by ±1 between paints); 4 px hysteresis is the sweet spot. Also ignore
    // shrinks smaller than 12 px — a card collapsing for one tick (e.g. a
    // re-render between data fetches) shouldn't snap the window down.
    const delta = target - bounds.height;
    if (Math.abs(delta) < 4) return true;
    if (delta < 0 && delta > -12) return true;
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: target });
    return true;
  } catch { return false; }
});

// Ensure the calling overlay window has at least `h` px of height — the
// shared right-click chrome menu needs ~280 px to render its 7 buttons,
// and an XS-preset overlay (100 px tall) clips the bottom of the menu
// because the menu DOM lives inside the window. Grows the window without
// moving its top-left; the overlay's regular overlayAutoHeight call
// shrinks it back to content size once the menu closes.
ipcMain.handle('overlay-ensure-min-height', (e, h) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    const wanted = Math.max(50, Math.round(+h || 0));
    if (!wanted) return false;
    const b = win.getBounds();
    if (b.height >= wanted) return true;
    const disp = screen.getDisplayMatching(b);
    const maxH = Math.max(80, disp.workArea.height - 20);
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.min(maxH, wanted) });
    return true;
  } catch { return false; }
});

// Resize an overlay window to a named preset, anchored at its CURRENT
// top-left so a user picking "Larger" from the move-icon context menu sees
// the same overlay grow rightward rather than jumping to a new position.
// HEIGHT is intentionally preserved from current bounds — the overlay's
// own overlayAutoHeight call (every tick after render) will re-fit the
// height to its content, so the size preset only changes width. Avoids
// the "preset shrunk my overlay below its content" bug the user reported.
ipcMain.handle('overlay-resize-preset', (e, preset) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    const widths = { xs: 200, sm: 260, md: 320, lg: 400, xl: 500 };
    const w = widths[String(preset || '').toLowerCase()];
    if (!w) return false;
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y, width: w, height: b.height });
    return true;
  } catch { return false; }
});

// Hover-to-interact for click-through overlays. When overlays are LOCKED they
// are click-through (setIgnoreMouseEvents(true,{forward:true})), so a corner
// button (✕ hide / ⚙ gear) wouldn't catch a click. The forward:true flag means
// the renderer still receives mousemove/enter/leave, so a control can ask us to
// momentarily make ITS window interactive while the cursor is over it, then
// restore the click-through state on mouseleave. Standard Electron recipe.
ipcMain.handle('overlay-hover-interactive', (e, wantInteractive) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    // OVERLAY WINDOWS ONLY. The shared preload's document-level hover
    // handshake (beta.2) fires from EVERY window that loads it — including
    // the MAIN Mimic window, where the mouseleave restore path was applying
    // setIgnoreMouseEvents(true) and making the whole app click-through
    // inside the EQ window's bounds. Non-overlay windows are never lockable;
    // ignore their hover traffic entirely.
    const isOverlay = _overlayEntries().some(([, w]) => w === win);
    if (!isOverlay) return false;
    if (wantInteractive) {
      win.setIgnoreMouseEvents(false);
    } else {
      // Restore whatever the lock state dictates for this window. A window
      // in SINGLE-overlay setup mode stays interactive — this restore path
      // is exactly what used to re-lock it on the first mouseleave, making
      // its Done button and resize edges unclickable.
      if (_inSingleSetup(win)) { win.setIgnoreMouseEvents(false); return true; }
      const cfg = loadConfig();
      const locked = !setupMode && cfg.overlaysLocked !== false;
      if (locked) win.setIgnoreMouseEvents(true, { forward: true });
      else        win.setIgnoreMouseEvents(false);
    }
  } catch {}
  return true;
});

// Toggle a named built-in overlay on/off from the dashboard's Overlays tab.
// Mirrors the tray checkboxes: flips the cfg pref, creates the window on first
// enable (else applies visibility), and returns the fresh status so the
// dashboard can repaint the button. Returns null for an unknown name.
ipcMain.handle('toggle-overlay', (_e, name) => {
  const cfg = loadConfig();
  switch (name) {
    case 'hud':
      cfg.showHud = !cfg.showHud; saveConfig(cfg);
      if (cfg.showHud && !overlayWindow) createOverlayWindow(); else applyOverlayVisibility();
      break;
    case 'trigger':
      cfg.enableTriggerTts = !cfg.enableTriggerTts; saveConfig(cfg);
      if (cfg.enableTriggerTts && !triggerWindow) createTriggerOverlay(); else applyTriggerVisibility();
      break;
    case 'charm':
      cfg.showCharm = !cfg.showCharm; saveConfig(cfg);
      if (cfg.showCharm && !charmWindow) createCharmOverlay(); else applyCharmVisibility();
      break;
    case 'pet':
      cfg.showPets = !cfg.showPets; saveConfig(cfg);
      if (cfg.showPets && !petsWindow) createPetsOverlay(); else applyPetsVisibility();
      break;
    case 'mobinfo':
      cfg.showMobInfo = !cfg.showMobInfo; saveConfig(cfg);
      if (cfg.showMobInfo && !mobInfoWindow) createMobInfoOverlay(); else applyMobInfoVisibility();
      break;
    case 'buffQueue':
      cfg.showBuffQueue = !cfg.showBuffQueue; saveConfig(cfg);
      if (cfg.showBuffQueue && !buffQueueWindow) createBuffQueueOverlay(); else applyBuffQueueVisibility();
      break;
    case 'who':
      cfg.showWho = !cfg.showWho; saveConfig(cfg);
      if (cfg.showWho && !whoWindow) createWhoOverlay(); else applyWhoVisibility();
      break;
    case 'melody':
      cfg.showMelody = !cfg.showMelody; saveConfig(cfg);
      if (cfg.showMelody && !melodyWindow) createMelodyOverlay(); else applyMelodyVisibility();
      break;
    case 'zeal':
      cfg.showZeal = !cfg.showZeal; saveConfig(cfg);
      if (cfg.showZeal && !zealWindow) createZealHealthOverlay(); else applyZealVisibility();
      break;
    case 'threat':
      cfg.showThreat = !cfg.showThreat; saveConfig(cfg);
      if (cfg.showThreat && !threatWindow) createThreatMeterOverlay(); else applyThreatVisibility();
      break;
    case 'chchain':
      cfg.showChChain = !cfg.showChChain; saveConfig(cfg);
      if (cfg.showChChain && !chChainWindow) createChChainOverlay(); else applyChChainVisibility();
      break;
    case 'tank':
      cfg.showTank = !cfg.showTank; saveConfig(cfg);
      if (cfg.showTank && !tankWindow) createTankOverlay(); else applyTankVisibility();
      break;
    case 'exttarget':
      cfg.showExtTarget = !cfg.showExtTarget; saveConfig(cfg);
      if (cfg.showExtTarget && !extTargetWindow) createExtTargetOverlay(); else applyExtTargetVisibility();
      break;
    case 'command':
      cfg.showCommand = !cfg.showCommand; saveConfig(cfg);
      if (cfg.showCommand && !commandWindow) createCommandOverlay(); else applyCommandVisibility();
      break;
    default:
      return null;
  }
  pushStatus();
  return currentStatus();
});

// Hide the overlay that sent this — the ✕ in an overlay's corner. For the
// named overlays (hud/trigger/charm) we flip the matching pref OFF (so it
// stays hidden across restarts and the tray checkbox updates); for a panel
// overlay we just close the window. The user re-enables named overlays from
// the tray "Overlays" submenu.
ipcMain.handle('hide-overlay', (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    const cfg = loadConfig();
    if (win === overlayWindow) {
      cfg.showHud = false; saveConfig(cfg);
      try { overlayWindow.hide(); } catch {}
    } else if (win === triggerWindow) {
      cfg.enableTriggerTts = false; saveConfig(cfg);
      try { triggerWindow.hide(); } catch {}
    } else if (win === charmWindow) {
      cfg.showCharm = false; saveConfig(cfg);
      try { charmWindow.hide(); } catch {}
    } else if (win === petsWindow) {
      cfg.showPets = false; saveConfig(cfg);
      try { petsWindow.hide(); } catch {}
    } else if (win === mobInfoWindow) {
      cfg.showMobInfo = false; saveConfig(cfg);
      try { mobInfoWindow.hide(); } catch {}
    } else if (win === whoWindow) {
      cfg.showWho = false; saveConfig(cfg);
      try { whoWindow.hide(); } catch {}
    } else if (win === buffQueueWindow) {
      cfg.showBuffQueue = false; saveConfig(cfg);
      try { buffQueueWindow.hide(); } catch {}
    } else if (win === melodyWindow) {
      cfg.showMelody = false; saveConfig(cfg);
      try { melodyWindow.hide(); } catch {}
    } else if (win === zealWindow) {
      cfg.showZeal = false; saveConfig(cfg);
      try { zealWindow.hide(); } catch {}
    } else if (win === threatWindow) {
      cfg.showThreat = false; saveConfig(cfg);
      try { threatWindow.hide(); } catch {}
    } else if (win === chChainWindow) {
      cfg.showChChain = false; saveConfig(cfg);
      try { chChainWindow.hide(); } catch {}
    } else if (win === tankWindow) {
      cfg.showTank = false; saveConfig(cfg);
      try { tankWindow.hide(); } catch {}
    } else if (win === extTargetWindow) {
      cfg.showExtTarget = false; saveConfig(cfg);
      try { extTargetWindow.hide(); } catch {}
    } else if (win === commandWindow) {
      cfg.showCommand = false; saveConfig(cfg);
      try { commandWindow.hide(); } catch {}
    } else {
      for (const [key, w] of panelOverlays.entries()) {
        if (w === win) { try { w.close(); } catch {} panelOverlays.delete(key); break; }
      }
    }
    pushStatus();
    return true;
  } catch { return false; }
});

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

// UI Studio — detected displays so the user can pick a custom resolution
// that matches their actual monitor instead of the four preset dropdowns.
// Returns { primary: {w,h}, displays: [{ id, label, w, h, primary, scaleFactor }] }.
// Widescreen/ultrawide users (3840×1600, 5120×1440, etc.) weren't covered by
// the dropdown — this lets them pick exact values without typing.
// Is EverQuest running right now? UI Studio uses this to warn at Save time:
// a running client keeps the window layout in memory, ignores on-disk edits on
// a skin reload, and OVERWRITES UI_<char>.ini on the next camp/zone/quit — so
// edits only stick if EQ is fully closed when you Save, then relaunched.
ipcMain.handle('ui-studio-eq-running', async () => {
  try { return await _isEqRunning(); } catch { return false; }
});

// Queue a deferred save — applied by the background watcher once the character
// leaves the Zeal pipe (logged out). Replaces any prior pending save for the
// same character+folder so re-saving just updates the pending edits.
ipcMain.handle('ui-studio-defer-save', (_e, params) => {
  try {
    const character = String(params?.character || '').trim();
    const eqDir     = String(params?.eqDir || '').trim();
    const bundle    = params?.bundle;
    if (!character || !eqDir || !bundle || typeof bundle !== 'object') return { ok: false, error: 'character + eqDir + bundle required' };
    const charLower = character.toLowerCase();
    _uiDeferred = _uiDeferred.filter(e => !(String(e.character).toLowerCase() === charLower && e.eqDir === eqDir));
    _uiDeferred.push({
      character, eqDir, bundle,
      tgtSuffix: params?.tgtSuffix || null,
      queuedAt: Date.now(),
      sawActive: _uiCharActiveInZeal(charLower),   // seed from current liveness
    });
    _saveUiDeferred();
    return { ok: true };
  } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
});
ipcMain.handle('ui-studio-pending-list', () => {
  return _uiDeferred.map(e => ({ character: e.character, eqDir: e.eqDir, tgtSuffix: e.tgtSuffix, queuedAt: e.queuedAt, sawActive: !!e.sawActive }));
});
ipcMain.handle('ui-studio-cancel-defer', (_e, params) => {
  const character = String(params?.character || '').trim().toLowerCase();
  const eqDir     = String(params?.eqDir || '').trim();
  const before = _uiDeferred.length;
  _uiDeferred = _uiDeferred.filter(e => !(String(e.character).toLowerCase() === character && (!eqDir || e.eqDir === eqDir)));
  if (_uiDeferred.length !== before) _saveUiDeferred();
  return { ok: true, removed: before - _uiDeferred.length };
});

ipcMain.handle('ui-studio-list-displays', () => {
  try {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays();
    const displays = all.map((d, i) => {
      const isPrimary = d.id === primary.id;
      // size = full pixel resolution; workAreaSize subtracts taskbar etc.
      // EQ renders fullscreen → use `size`, not `workAreaSize`.
      const w = (d.size && d.size.width)  || d.workAreaSize.width;
      const h = (d.size && d.size.height) || d.workAreaSize.height;
      return {
        id: d.id,
        label: `Display ${i + 1}${isPrimary ? ' (primary)' : ''} — ${w}×${h}`,
        w, h,
        primary: isPrimary,
        scaleFactor: d.scaleFactor || 1,
      };
    });
    return {
      primary: { w: primary.size.width, h: primary.size.height },
      displays,
    };
  } catch (err) {
    return { primary: null, displays: [], error: err && err.message };
  }
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
      // Characters known from log files (incl. rotated/backup variants).
      for (const f of entries) {
        if (!_isEqLogFile(dir, f)) continue;
        const name = _characterFromLogName(f);
        if (name) chars.add(name);
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
        // Log-file size drives the default ordering (biggest = most-played).
        let logSize = 0;
        try {
          const lp = path.join(dir, 'eqlog_' + c + '_pq.proj.txt');
          if (fs.existsSync(lp)) logSize = fs.statSync(lp).size;
        } catch {}
        out.push({ character: c, eqDir: dir, ini_count: iniCount, has_eqclient: hasEqClient, log_size: logSize });
      }
    } catch {}
  }
  // Biggest log first (most-played characters at the top of the picker).
  out.sort((a, b) => (b.log_size || 0) - (a.log_size || 0));
  return out;
});

// Enumerate every character detected in the user's configured EQ folders by
// log filename (eqlog_<Name>_pq.proj.txt). Used by the onboarding "Transmit?"
// picker so the user can opt characters out of uploads before any data leaves
// the machine. log_size lets us sort most-played first; ago_days lets the UI
// hint at clearly-dormant boxes.
ipcMain.handle('list-eq-characters', () => {
  const cfg = loadConfig();
  const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length > 0
                  ? cfg.eqPaths
                  : (cfg.eqPath ? [cfg.eqPath] : []);
  const dirs = userPaths.filter(p => _dirHasEqLogs(p));
  if (dirs.length === 0) return [];
  const byName = new Map();
  const now = Date.now();
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!_isEqLogFile(dir, f)) continue;
      const name = _characterFromLogName(f);
      if (!name) continue;
      let size = 0, mtime = 0;
      try { const st = fs.statSync(path.join(dir, f)); size = st.size; mtime = st.mtime.getTime(); } catch {}
      const prev = byName.get(name);
      if (!prev || size > prev.log_size) byName.set(name, { character: name, eqDir: dir, log_size: size, last_mtime: mtime });
    }
  }
  const excluded = new Set(((cfg.excludedCharacters) || []).map(s => String(s || '').toLowerCase()));
  return [...byName.values()]
    .map(r => ({
      ...r,
      ago_days: r.last_mtime ? Math.floor((now - r.last_mtime) / (24 * 3600 * 1000)) : null,
      excluded: excluded.has(r.character.toLowerCase()),
    }))
    .sort((a, b) => (b.log_size || 0) - (a.log_size || 0));
});

// Capture: read every ini for the character, upload encrypted to the bot.
ipcMain.handle('ui-studio-capture', async (_e, params) => {
  const character = String(params?.character || '').trim();
  const eqDir     = String(params?.eqDir || '').trim();
  const label     = params?.label ? String(params.label).slice(0, 80) : null;
  if (!character || !eqDir) return { ok: false, error: 'character + eqDir required' };
  const cfg = loadConfig();
  const _uiToken = resolveUploadToken(cfg);
  if (!_uiToken) return { ok: false, error: 'no token configured — set it in Settings' };

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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_uiToken}` },
      body: { character, label, server_short: 'pq.proj', source_width: srcW, source_height: srcH, files, agent_version: app.getVersion() },
    });
    return { ok: true, id: result?.id, file_count: fileCount, pending_link: !!result?.pending_link };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// List snapshots for a character.
ipcMain.handle('ui-studio-list-snapshots', async (_e, character) => {
  const c = String(character || '').trim();
  const cfg = loadConfig();
  const _uiToken = resolveUploadToken(cfg);
  if (!c) return { ok: false, error: 'character required' };
  if (!_uiToken) return { ok: false, error: 'no token configured' };
  try {
    const r = await _httpsJson(`${_botBaseUrl(cfg)}/api/agent/ui_layout?character=${encodeURIComponent(c)}`, {
      headers: { 'Authorization': `Bearer ${_uiToken}` },
    });
    return { ok: true, snapshots: r?.snapshots || [] };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Download a snapshot's raw { filename → text } file map WITHOUT writing it to
// disk. Powers UI Studio's "📥 Restore" button: the editor loads the cloud
// bundle into memory, lets the user rescale it to this machine's monitor, then
// Save writes it locally — the deploy-on-a-new-computer flow. (The older
// ui-studio-restore handler below writes straight to disk, bypassing rescale;
// this one keeps the user in the visual editor.)
ipcMain.handle('ui-studio-get-snapshot', async (_e, params) => {
  const character = String(params?.character || '').trim();
  const snapId    = String(params?.id || '').trim();
  if (!character || !snapId) return { ok: false, error: 'character + id required' };
  const cfg = loadConfig();
  const _uiToken = resolveUploadToken(cfg);
  if (!_uiToken) return { ok: false, error: 'no token configured' };
  try {
    const snap = await _httpsJson(
      `${_botBaseUrl(cfg)}/api/agent/ui_layout/${encodeURIComponent(snapId)}?character=${encodeURIComponent(character)}`,
      { headers: { 'Authorization': `Bearer ${_uiToken}` } },
    );
    if (!snap || !snap.files) return { ok: false, error: 'snapshot empty' };
    return {
      ok: true,
      files: snap.files,
      source_width:  snap.source_width  || null,
      source_height: snap.source_height || null,
      label: snap.label || null,
    };
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
  const _uiToken = resolveUploadToken(cfg);
  if (!_uiToken) return { ok: false, error: 'no token configured' };

  // Safety guard: never write while EQ is running. Refusal is permanent
  // for this call — the user must close EQ and click Restore again.
  if (await _isEqRunning()) {
    return { ok: false, error: 'EQ is running. Close all EverQuest instances before restoring.' };
  }

  let snap;
  try {
    snap = await _httpsJson(`${_botBaseUrl(cfg)}/api/agent/ui_layout/${encodeURIComponent(snapId)}?character=${encodeURIComponent(character)}`, {
      headers: { 'Authorization': `Bearer ${_uiToken}` },
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

ipcMain.handle('get-config', () => configForRenderer(loadConfig()));
ipcMain.handle('save-config', async (_e, incoming) => {
  const merged = Object.assign(loadConfig(), incoming || {});
  // Manual /token paste comes in as { token: "wpms_..." }. Route it through
  // the encrypted-at-rest path instead of persisting plaintext, then relaunch
  // the agent so the new token takes effect. A blank/cleared token signs out.
  let tokenChanged = false;
  if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'token')) {
    const pasted = String(incoming.token || '').trim();
    if (pasted) {
      storeUploadToken(merged, pasted, merged.session?.identity || null);
    } else {
      delete merged.session;
    }
    delete merged.token;
    tokenChanged = true;
  }
  saveConfig(merged);
  // Re-bind the hide-all hotkey if the user changed it in settings.
  if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'hideAllHotkey')) {
    try { registerHideAllHotkey(); } catch {}
  }
  // Apply a raw-Zeal-capture toggle live (Info tab control) without a restart.
  if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'zealRawCapture')) {
    try { setZealRawCapture(!!merged.zealRawCapture); } catch {}
  }
  // Create any newly-enabled overlay window that doesn't exist yet — windows
  // are only created at startup when their pref was already on, so a flip
  // from onboarding/settings was a silent no-op until restart (the apply*
  // functions return early on a missing window). Mirrors toggle-overlay.
  try {
    if (merged.showHud          && !overlayWindow)   createOverlayWindow();
    if (merged.enableTriggerTts && !triggerWindow)   createTriggerOverlay();
    if (merged.showCharm        && !charmWindow)     createCharmOverlay();
    if (merged.showPets         && !petsWindow)      createPetsOverlay();
    if (merged.showMobInfo      && !mobInfoWindow)   createMobInfoOverlay();
    if (merged.showBuffQueue    && !buffQueueWindow) createBuffQueueOverlay();
    if (merged.showWho          && !whoWindow)       createWhoOverlay();
    if (merged.showMelody       && !melodyWindow)    createMelodyOverlay();
    if (merged.showZeal         && !zealWindow)      createZealHealthOverlay();
    if (merged.showThreat       && !threatWindow)    createThreatMeterOverlay();
    if (merged.showChChain      && !chChainWindow)   createChChainOverlay();
    if (merged.showTank         && !tankWindow)      createTankOverlay();
    if (merged.showExtTarget    && !extTargetWindow) createExtTargetOverlay();
    if (merged.showCommand      && !commandWindow)   createCommandOverlay();
  } catch (e) { void e; }
  applyOverlayVisibility(); applyTriggerVisibility(); applyCharmVisibility(); applyPetsVisibility(); applyMobInfoVisibility(); applyBuffQueueVisibility(); applyWhoVisibility(); applyMelodyVisibility(); applyZealVisibility(); applyThreatVisibility(); applyChChainVisibility(); applyTankVisibility(); applyExtTargetVisibility(); applyCommandVisibility(); applyOverlayInteractivity();
  // Sync autostart-with-Windows with the saved pref. No-op on non-Windows;
  // on Windows this writes/removes the HKCU\…\Run registry entry via
  // setLoginItemSettings — no UAC, no admin rights.
  applyAutoStart();
  pushStatus();
  if (tokenChanged) {
    pushMimicSession();
    if (agentProc) { try { agentProc.kill(); } catch (e) { void e; } }
    else { await launchAgent(); }
  }
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
  applyOverlayVisibility(); applyTriggerVisibility(); applyCharmVisibility(); applyPetsVisibility(); applyMobInfoVisibility(); applyBuffQueueVisibility(); applyWhoVisibility();
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
  navigateToDashboard('renderer-open-dashboard');
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
// Per-window setup mode — triggered by right-clicking the ✥ on a single
// overlay. Doesn't flip the global setupMode (so the other overlays stay
// where they are). The renderer flips body.setup itself to show its own
// opacity slider; we just unlock + force-show THIS window so it can be
// moved/resized without affecting the rest.
// Windows currently in SINGLE-overlay setup mode (webContents ids). The
// hover-interact restore path and applyOverlayInteractivity() both recompute
// "locked" from the GLOBAL setupMode — which single mode never sets — so
// without this registry the first mouseleave after opening the setup strip
// flipped the window back to click-through: the Done button and the resize
// edges went dead while the strip stayed on screen.
const _singleSetupWins = new Set();
function _inSingleSetup(win) {
  try { return !!win && !win.isDestroyed() && _singleSetupWins.has(win.webContents.id); }
  catch { return false; }
}
ipcMain.handle('set-setup-mode-this', (e, on) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    const key = _boundsKeyForWindow(win).replace(/Bounds$/, '');
    // Done — exit single-overlay setup mode for THIS window. Restore the
    // persisted lock state instead of forcing unlocked, so the Done button
    // actually puts things back the way the user had them. Without this,
    // Done was a no-op in scope='this' because the global setupMode was
    // never set in the first place.
    if (on === false) {
      _singleSetupWins.delete(win.webContents.id);
      const cfg = loadConfig();
      const locked = cfg.overlaysLocked !== false;
      try { win.setIgnoreMouseEvents(locked, { forward: true }); } catch {}
      try { win.setResizable(!locked); } catch {}
      try {
        win.webContents.send('overlay-locked', locked);
        win.webContents.send('setup-mode', { active: false, overlayKey: key, scope: 'this' });
      } catch {}
      return true;
    }
    // Unlock + show JUST this window; keep the others' state intact.
    _singleSetupWins.add(win.webContents.id);
    win.once('closed', () => { try { _singleSetupWins.delete(win.webContents.id); } catch {} });
    win.setIgnoreMouseEvents(false);
    win.setResizable(true);
    try { win.showInactive(); } catch {}
    try {
      win.webContents.send('overlay-locked', false);
      win.webContents.send('setup-mode', { active: true, overlayKey: key, scope: 'this' });
    } catch {}
    return true;
  } catch { return false; }
});
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
// Open the raw Zeal capture file in the OS default app (Info-tab diagnostic).
// Returns false if capture has never run (no file yet) so the renderer can hint.
ipcMain.handle('open-zeal-capture', () => {
  try {
    if (!fs.existsSync(ZEAL_RAW_LOG())) return false;
    shell.openPath(ZEAL_RAW_LOG());
    return true;
  } catch { return false; }
});
// Mimic Discord login (device-code flow).
ipcMain.handle('mimic-link-start',   async () => await startMimicLink());
ipcMain.handle('mimic-link-cancel',  () => { cancelMimicLink(); return true; });
ipcMain.handle('mimic-link-signout', async () => { await signOutMimic(); return true; });
ipcMain.handle('check-for-updates', () => { safeCheckForUpdates(true); checkAgentUpdate(); return true; });
// Dashboard "update ready" banner button → apply the downloaded update now.
ipcMain.handle('restart-to-update', () => {
  try { autoUpdater && autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); }
  return true;
});
ipcMain.handle('get-agent-log-tail', (_e, lines) => {
  const n = Math.max(1, Math.min(500, lines || 80));
  return logTail.slice(-n).join('');
});

// ── Boot ────────────────────────────────────────────────────────────────────
// Guard the entire boot on the single-instance lock. A second launch already
// called app.quit() above, but app.quit() is async — without this guard the
// losing instance would race ahead, spawn a second agent (which then dies with
// "Service already running"), and flash a blank dashboard before quitting.
app.whenReady().then(async () => {
  if (!_gotSingleInstanceLock) return;
  appendAgentLog(`[mimic] boot — Mimic v${app.getVersion()}, single-instance lock acquired, userData=${app.getPath('userData')}\n`);
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
  createCharmOverlay();
  createPetsOverlay();
  createMobInfoOverlay();
  createWhoOverlay();
  createMelodyOverlay();
  createZealHealthOverlay();
  createChChainOverlay();
  createTankOverlay();
  pushStatus();
  startZealCapture();

  // UI Studio deferred saves — load any pending from a prior session and start
  // the background watcher that applies them once the character logs out.
  _loadUiDeferred();
  setInterval(() => { _tickUiDeferred().catch(() => {}); }, 8000);

  // First-launch + every-launch nudge: if setup is incomplete, fire a Windows
  // toast notification so the user knows something needs their attention even
  // when Mimic has been minimized to tray. Delayed a few seconds so it doesn't
  // collide with the loading screen + so the agent has had a moment to come
  // up; flashFrame draws attention in the taskbar for users who saw the toast
  // and want to find Mimic in their open windows.
  setTimeout(() => {
    const issue = _setupIssue();
    if (!issue) return;
    try { if (mainWindow && process.platform === 'win32') mainWindow.flashFrame(true); } catch {}
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: '⚠ Wolf Pack miMIC — setup needed',
          body:  issue + ' — open Mimic to finish.',
          silent: false,
        }).show();
      }
    } catch (e) { void e; }
  }, 6000);

  // Rescue overlays if the monitor layout changes while running (unplug a
  // second display, resolution switch, etc.). If an overlay ends up off the
  // new screen, snap it back to its default position so it's never lost.
  const _rescueOverlays = () => {
    for (const [win, def] of [
      [overlayWindow, { x: 40, y: 40, width: 320, height: 220 }],
      [triggerWindow, { x: 700, y: 200, width: 600, height: 200 }],
      [charmWindow,   { x: 700, y: 420, width: 300, height: 180 }],
      [petsWindow,    { x: 700, y: 620, width: 300, height: 160 }],
      [mobInfoWindow, { x: 700, y: 60,  width: 320, height: 200 }],
      [whoWindow,     { x: 40,  y: 300, width: 320, height: 280 }],
      [melodyWindow,  { x: 40,  y: 600, width: 280, height: 180 }],
      [chChainWindow, { x: 40,  y: 540, width: 280, height: 240 }],
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

  // Apply autostart setting on every launch — re-synchronizes the HKCU\…\Run
  // entry with the saved pref (in case the user uninstalled/reinstalled, or
  // the installer flipped the default).
  applyAutoStart();

  // Begin polling eqgame.exe presence so overlays auto-hide when the user
  // isn't in EverQuest. No-op on non-Windows.
  _startEqPolling();

  // Hide-all overlays global hotkey (Ctrl+Shift+H on Windows). Single-shot
  // toggle: snapshots current prefs, hides everything, restores on second
  // press. Bindable from tray menu too.
  registerHideAllHotkey();
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => {
  quitting = true;
  _stopEqPolling();
  try { const { globalShortcut } = require('electron'); globalShortcut.unregisterAll(); } catch {}
  if (agentProc) { try { agentProc.kill(); } catch {} }
});
