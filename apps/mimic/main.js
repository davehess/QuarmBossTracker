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
const zealUpdater = require('./zealUpdater');
const uiPacks = require('./uiPacks');

// Hide the default File/Edit/View/Window/Help menubar — this is a focused
// tray app, those entries just look unfinished. Must run before window
// creation so it applies to all BrowserWindows.
Menu.setApplicationMenu(null);

// ── Audio: allow overlays to speak/beep without a click (#120) ──────────────
// Field report: suggested-trigger TTS was silent AND Windows' volume mixer had
// NO Mimic audio session at all — i.e. Chromium never opened an output stream.
// Cause: the trigger overlay is a passive, click-through, never-focused window,
// so its document never gets a user gesture, and Chromium gates BOTH
// speechSynthesis.speak() and HTMLMediaElement.play() behind user activation —
// silently dropping them. Relaxing the autoplay policy process-wide lets every
// overlay produce audio without a click. Must run before app.whenReady(). Paired
// with a per-document synthetic gesture on the trigger window (below) as a
// belt-and-suspenders for the speechSynthesis activation check specifically.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

// Standard webPreferences for every window we open, PLUS a name stamped onto
// that renderer's own command line.
//
// "Can these expose their names in Task manager as well?" (Hitya 2026-08-04)
// — partly. The Name column cannot change: every renderer is the same
// Wolf Pack Mimic.exe and Task Manager reads that column from the exe's version
// resource. (The Dashboard row is named only because it owns a visible taskbar
// window, whose title Task Manager appends. Overlays are skipTaskbar so they
// have no such window — deliberately, or they would flood alt-tab.)
//
// What CAN carry a name is the process command line, and additionalArguments
// lands there. Task Manager → Details → right-click any column header → Select
// columns → Command line shows it, as do Process Explorer and Resource Monitor.
// Costs nothing at runtime: nothing reads process.argv in the renderers.
function _wpPrefs(name, extra) {
  return Object.assign({
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    additionalArguments: ['--wp-window=' + String(name || 'window').replace(/\s+/g, '-')],
  }, extra || {});
}

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
let popRaidWindow = null;
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

// ── Last-known-good agent + crash-loop auto-rollback (#74 Part 3, four-gate rule) ──
// Before any hot-swap we snapshot the working agent to index.lkg.js/package.lkg.json.
// If the swapped-in child crash-loops (≥3 exits in 2 min right after a swap) we
// restore LKG, blacklist the bad version (don't re-offer until a NEWER build
// ships), and surface a tray/dashboard notice. One log line per state transition.
let _agentSwapAt = 0;               // when the last hot-swap landed (0 = none on trial)
let _agentSwapToVersion = null;     // the version we swapped TO (on trial)
let _recentExits = [];              // exit timestamps (pruned to the crash-loop window)
let _blacklistedAgentVersion = null;// a version that crash-looped post-swap
let _crashNoticeShown = false;      // one diagnostic notice per no-swap crash-loop burst
let _lkgReverted = null;            // { from, to, at } once a revert has happened
const LKG_CRASHLOOP_WINDOW_MS = 2 * 60_000;
const LKG_CRASHLOOP_EXITS = 3;
const LKG_SWAP_TRIAL_MS = 10 * 60_000;  // "right after a swap" bound
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
    enableTriggerTts: true,  // Trigger TTS/callouts MASTER switch — default ON
                             // so fresh installs see countdown timer rows
                             // during a raid without an extra opt-in.
                             // Existing installs keep whatever they saved.
    showTriggerOverlay: true, // Whether the trigger overlay is VISIBLE (#97).
                             // Decoupled from enableTriggerTts: the overlay ✕
                             // sets this false (hides the visual) but TTS keeps
                             // firing from the hidden window. Re-shown when the
                             // user turns triggers on via tray/dashboard.
    // 💥 Damage-taken audio alert (Hitya 2026-07-31) — speaks "taking damage"
    // the first time something lands on you after a quiet period, then holds a
    // ~5s cooldown so a tank eating a swing a second isn't narrated to death.
    // DEFAULT OFF, deliberately: it's an opt-in cue, and a fresh install (or a
    // user who never touched it) must come up silent. Toggled from the tray,
    // the global hotkey (damageAlertHotkey, Ctrl+Shift+D by default), or the
    // dashboard Overlays tab; pushed to the agent on every change + relaunch.
    damageAlert: false,
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
    // Zeal auto-updater. zealInstalledTag records the CoastalRedwood/Zeal
    // release tag we last installed (null = never installed via Mimic / manual
    // install of unknown version). zealAutoCheck lets Mimic poll GitHub in the
    // background and NOTIFY when a newer Zeal ships — it never auto-overwrites
    // Zeal.asi (that stays a one-click user action; the game may have it loaded).
    zealInstalledTag: null,
    zealAutoCheck: true,
    // Custom UI packs (Nillipuss etc.) installed via the uiPacks updater —
    // map of pack id → last-installed release tag. Same idea as zealInstalledTag
    // but per-pack, since a user can install more than one.
    uiPackTags: {},
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
  // Any config write can change where we should be looking for EverQuest
  // (eqPaths / eqPathsExcluded), so drop the memoized scans rather than trying
  // to detect which keys moved — config saves are rare user actions, and a
  // needless re-scan is far cheaper than serving a stale answer to someone who
  // just picked their folder. try/catch because saveConfig is defined well
  // above the caches and may run during module init, before their `const`
  // declarations have executed.
  try { _invalidateEqScan(); } catch { /* not initialised yet — nothing cached */ }
  // An explicitly configured folder must never stay on the learned skip list —
  // the user pointing at it outranks anything we inferred from a slow probe.
  try {
    const paths = Array.isArray(cfg && cfg.eqPaths) ? cfg.eqPaths : (cfg && cfg.eqPath ? [cfg.eqPath] : []);
    for (const p of paths) _eqSkipForget(path.normalize(String(p)));
    _flushEqSkip();
  } catch { /* pre-init — nothing learned yet */ }
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

// Overlay-visibility state for the renderer: whether hide-all is on, and
// whether the hotkey that undoes it is actually bound.
function hideAllStatusForRenderer() {
  return { hideAllActive: !!_hideAllActive, hideAllHotkeyBound: _hideAllHotkeyBound(),
           hideAllHotkeyLabel: _hideAllHotkeyMenuLabel() };
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
// ── Persistent verdict cache (Hitya 2026-08-04) ──────────────────────────
// "we should be able to track the previous last updated dates on those files
// and file size to not interpret them again."
//
// Right. The expensive half of this scan is _firstLineIsEqWelcome — an
// open+read+close per non-canonical candidate — and it re-ran from scratch on
// EVERY launch, for files whose answer cannot have changed. EQ logs are
// APPEND-ONLY: once line 1 is the welcome banner it stays the welcome banner
// forever, no matter how large the file grows. Re-sniffing a 1.4 GB log to
// re-learn what we already knew is pure waste.
//
// So the verdict is cached to disk keyed on (size, mtime), and a hit costs ONE
// statSync instead of three syscalls plus a content read.
//
// Invalidation is deliberately asymmetric, because append-only is the whole
// premise: a file that GREW is still the same file, so the verdict stands. A
// file that SHRANK was replaced or truncated, so we re-sniff. That is the only
// direction that can change the first line.
const _EQ_VERDICT_FILE = () => path.join(app.getPath('userData'), 'eqlog-verdicts.json');
let _eqVerdicts = null;      // path(lower) → { v: bool, size, mtimeMs }
let _eqVerdictsDirty = false;

function _loadEqVerdicts() {
  if (_eqVerdicts) return _eqVerdicts;
  _eqVerdicts = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(_EQ_VERDICT_FILE(), 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && typeof v.size === 'number') _eqVerdicts.set(k, v);
    }
  } catch { /* absent or corrupt — start empty, it rebuilds itself */ }
  return _eqVerdicts;
}

function _flushEqVerdicts() {
  if (!_eqVerdictsDirty || !_eqVerdicts) return;
  _eqVerdictsDirty = false;
  try {
    // Bound it so a folder churning through rotated logs can't grow this
    // unboundedly; newest-touched win.
    const entries = [..._eqVerdicts.entries()].slice(-500);
    fs.writeFileSync(_EQ_VERDICT_FILE(), JSON.stringify(Object.fromEntries(entries)));
  } catch { /* cache is an optimisation — never fail a scan over it */ }
}

function _isEqLogFile(dir, filename) {
  if (EQ_LOG_CANONICAL_RX.test(filename)) return true;   // filename alone — no I/O
  if (!EQ_LOG_STEM_RX.test(filename)) return false;      // not even a candidate
  const full = path.join(dir, filename);
  const key  = full.toLowerCase();
  const map  = _loadEqVerdicts();
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  const hit = map.get(key);
  // Grew or unchanged → the first line is untouched, reuse the verdict.
  if (hit && st.size >= hit.size) return hit.v;
  const v = _firstLineIsEqWelcome(full);
  map.set(key, { v, size: st.size, mtimeMs: st.mtimeMs });
  _eqVerdictsDirty = true;
  return v;
}

// True if `dir` contains at least one EQ log file. Cheap probe — used by
// both the default-dirs scan and the walk-up-from-Mimic-exe scan below.
// Shared TTL for both EQ-scan caches. Declared here because _dirHasEqLogs is
// the first thing that reads it, and a const used above its declaration is a
// temporal-dead-zone trap waiting for someone to call this during init.
const _EQ_SCAN_TTL_MS = 30_000;

// Local FIXED drive letters ("C:", "D:", …), enumerated once per process.
//
// Used to keep the speculative EQ-install scan off network and removable
// drives. A mapped NAS that is asleep costs ~21 SECONDS on a single
// fs.existsSync (measured 2026-08-04: B:\Quarm, 21046ms of a 21050ms scan),
// and that runs on the main process, so every Mimic window freezes with it.
//
// DriveType — NOT IsReady. IsReady queries free space and would block on the
// very drives we are trying to skip, turning the guard into the bug. DriveType
// comes from the drive map without touching the device.
//
// Returns null if enumeration fails, and callers then skip filtering entirely:
// failing OPEN keeps today's (slow but correct) behaviour rather than silently
// hiding someone's EQ folder because a PowerShell spawn misbehaved.
// ── Learned dead ends ───────────────────────────────────────────────────────
//
// "it didn't show up on my list of installs but it showed up in the logs. We
// should be able to ignore it" (Hitya 2026-08-04, on B:\Quarm costing 21s).
//
// The DriveType filter catches the network-drive case, but it only knows about
// drive TYPES. A slow dead end on a local fixed drive — a failing disk, a
// dismounted encrypted volume, a folder behind a filter driver — would sail
// straight past it. The durable rule is simpler and covers all of them: a
// SPECULATIVE path that was slow AND held nothing is not worth asking about
// again.
//
// Guard rails, because a skip-list that hides a real EQ folder is far worse
// than a slow scan:
//   • only SPECULATIVE probes are ever recorded — never a folder the user
//     configured, and never the walk-up-from-Mimic path;
//   • only when the probe found NOTHING. A slow directory that contains EQ
//     stays in the rotation, however slow it is;
//   • entries EXPIRE, so installing EQ somewhere we once wrote off is found
//     again within the month;
//   • configuring that folder explicitly makes it a hint, which is always
//     probed regardless of this list.
const _EQ_SKIP_FILE  = () => path.join(app.getPath('userData'), 'eq-scan-skip.json');
const _EQ_SKIP_MS    = 2000;                    // "slow" — 4ms is typical, 21046ms was the NAS
const _EQ_SKIP_TTL   = 30 * 24 * 60 * 60 * 1000; // re-check monthly
let _eqSkip = null;                             // path(lower) → { at, ms }
let _eqSkipDirty = false;

function _loadEqSkip() {
  if (_eqSkip) return _eqSkip;
  _eqSkip = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(_EQ_SKIP_FILE(), 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && typeof v.at === 'number' && (now - v.at) < _EQ_SKIP_TTL) _eqSkip.set(k, v);
    }
  } catch { /* absent or corrupt — rebuilds itself */ }
  return _eqSkip;
}
function _flushEqSkip() {
  if (!_eqSkipDirty || !_eqSkip) return;
  _eqSkipDirty = false;
  try {
    fs.writeFileSync(_EQ_SKIP_FILE(), JSON.stringify(Object.fromEntries(_eqSkip)));
  } catch { /* optimisation only — never fail a scan over it */ }
}
function _eqSkipHas(dir) {
  return _loadEqSkip().has(String(dir).toLowerCase());
}
function _eqSkipRemember(dir, ms) {
  _loadEqSkip().set(String(dir).toLowerCase(), { at: Date.now(), ms });
  _eqSkipDirty = true;
}
// Called when the user picks or configures a folder, so an explicit choice always
// beats anything we previously learned about that path.
function _eqSkipForget(dir) {
  if (!dir) return;
  if (_loadEqSkip().delete(String(dir).toLowerCase())) _eqSkipDirty = true;
}

let _fixedDrives;   // undefined = not tried, null = unavailable, Set = known
function _fixedDriveSet() {
  if (_fixedDrives !== undefined) return _fixedDrives;
  _fixedDrives = null;
  if (process.platform !== 'win32') return _fixedDrives;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
       "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' } | ForEach-Object { $_.Name }"],
      { timeout: 10000, windowsHide: true, encoding: 'utf8' });
    const set = new Set();
    for (const line of String(out || '').split(/\r?\n/)) {
      const m = /^([A-Za-z]):/.exec(line.trim());
      if (m) set.add(m[1].toUpperCase() + ':');
    }
    if (set.size) {
      _fixedDrives = set;
      appendAgentLog(`[eq-scan] local fixed drives: ${[...set].join(' ')}\n`);
    }
  } catch (e) {
    appendAgentLog(`[eq-scan] could not enumerate drives (${e && e.message}) — scanning all defaults\n`);
  }
  return _fixedDrives;
}
// Memoized for the same reason findEqInstalls is (see the scan-cache note
// there): this is sync fs on the main process, six different call paths reach
// it, and several of them re-probe the SAME directories in a loop. `.some()`
// short-circuits on the first match, so a real EQ folder is cheap — but a
// directory with many non-canonical eqlog files and no match reads 256 bytes
// from every one of them before returning false, and that is the case that got
// slower as rotated logs piled up.
const _eqDirLogCache = new Map();   // dir (lowercased) → { at, has }
function _invalidateEqScan() { _eqDirLogCache.clear(); if (typeof _eqScanCache !== 'undefined') _eqScanCache.clear(); }
function _dirHasEqLogs(dir) {
  if (!dir) return false;
  const key = String(dir).toLowerCase();
  const hit = _eqDirLogCache.get(key);
  if (hit && (Date.now() - hit.at) < _EQ_SCAN_TTL_MS) return hit.has;
  let has = false;
  try {
    if (fs.existsSync(dir)) has = fs.readdirSync(dir).some(f => _isEqLogFile(dir, f));
  } catch { has = false; }
  _eqDirLogCache.set(key, { at: Date.now(), has });
  return has;
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
// ── Scan cache ──────────────────────────────────────────────────────────────
// The scan below is ALL-SYNCHRONOUS fs, and its callers sit in ipcMain.handle
// bodies — so it runs on the MAIN process event loop, and while it runs every
// Mimic window stops pumping messages. That is why a slow scan shows up as the
// dashboard AND Settings both freezing, with Windows painting "(Not
// Responding)" on the title bar (Hitya, 2026-08-04: "Something on the initial
// loading page is taking a long time to load. same with the settings page. It
// has gotten worse lately.").
//
// Cost scales with FILES IN THE EQ FOLDER, which is why it got worse rather than
// staying constant: every entry matching the eqlog stem but not the canonical
// name (.txt2 / .txt3 / " BACKUP.txt" — the rotations players make precisely
// BECAUSE EQ slows on multi-GB logs) costs an open+read+close to sniff its first
// line, and each of those syscalls goes through Defender. This user's folder has
// 58 log files totalling ~40 GB.
//
// And it was re-walked constantly: find-eq-installs runs it once per configured
// hint PLUS once for null, the loading page and Settings each call that handler,
// and _newestUiIniFile runs its own copy of the same loop.
//
// So: memoize per hint for a short TTL. Correctness is preserved because the
// only things that change the answer are user actions, and those invalidate
// explicitly (_invalidateEqScan). A 30s stale window on "where is EverQuest
// installed" is not a real risk; freezing the UI is.
const _eqScanCache = new Map();   // hint (lowercased) → { at, result }

function findEqInstalls(hint) {
  const key = 'h:' + String(hint || '').toLowerCase();
  const hit = _eqScanCache.get(key);
  if (hit && (Date.now() - hit.at) < _EQ_SCAN_TTL_MS) return hit.result;
  const t0 = Date.now();
  const result = _findEqInstallsUncached(hint);
  const ms = Date.now() - t0;
  _flushEqVerdicts();
  _flushEqSkip();   // persist anything this scan had to sniff for the first time
  // Log the real cost so "it feels slow" becomes a number we can read off a
  // user's agent.log instead of guessing. Only when it is worth noticing.
  if (ms >= 250) {
    appendAgentLog(`[eq-scan] scanned ${result.scanned.length} dir(s) in ${ms}ms`
      + (hint ? ` (hint ${hint})` : '') + ` — cached ${_EQ_SCAN_TTL_MS / 1000}s`
      + ((result.slow && result.slow.length) ? ` — SLOW: ${result.slow.join(', ')}` : '') + '\n');
  }
  _eqScanCache.set(key, { at: Date.now(), result });
  return result;
}

function _findEqInstallsUncached(hint) {
  const scanned = [];
  const found   = [];
  const slow    = [];   // dirs that individually cost >=500ms — the real culprits
  const skipped = [];   // paths on drives that are absent or have no media
  const seen    = new Set();
  const probe   = (dir, source) => {
    if (!dir) return;
    const norm = path.normalize(dir);
    if (seen.has(norm.toLowerCase())) return;
    seen.add(norm.toLowerCase());
    // A speculative path we already learned is a slow dead end. Never applies
    // to a configured folder or the walk-up, which are always probed.
    if (source === 'common' && _eqSkipHas(norm)) { skipped.push(norm); return; }
    scanned.push(norm);
    const foundBefore = found.length;
    // Per-directory timing. The aggregate ("26 dirs in 20383ms") proved the
    // scan was the problem but not WHICH probe, and on Windows the answer is
    // usually one absent or offline drive letter costing seconds by itself.
    // Naming the specific directory turns the next report into a fix.
    const _t = Date.now();
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
    finally {
      const _ms = Date.now() - _t;
      if (_ms >= 500) slow.push(norm + ' ' + _ms + 'ms');
      // Learn the dead end: slow, speculative, and held nothing. `found` is
      // checked by length because probe() pushes on success — if this path
      // contributed an install it is NOT a dead end, however slow it was.
      if (source === 'common' && _ms >= _EQ_SKIP_MS && found.length === foundBefore) {
        _eqSkipRemember(norm, _ms);
        appendAgentLog(`[eq-scan] ignoring ${norm} from now on — ${_ms}ms and no EverQuest install `
          + `(re-checked in ${Math.round(_EQ_SKIP_TTL / 86400000)} days, or immediately if you pick it yourself)\n`);
      }
    }
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

  // 3. The known common EQ install paths — the SPECULATIVE pass, and the
  //    expensive one. Two guards, both earned from a measurement:
  //
  //    [eq-scan] scanned 26 dir(s) in 21050ms (hint A:\EQ) — SLOW: B:\Quarm 21046ms
  //
  //    B: is a mapped NAS backup drive. When the NAS is asleep or unreachable,
  //    fs.existsSync on it blocks for TWENTY-ONE SECONDS waiting on SMB, on the
  //    main process, freezing every window. One directory was the entire hang;
  //    the other 25 were free.
  //
  //    NOT solved by stopping early once a hint resolves, tempting as that is.
  //    This user has TWO installs — A:\EQ (configured) and D:\EQ (28 logs,
  //    discovered here and offered as an unticked option). An early return
  //    after the hint would silently delete D:\EQ from the picker, trading a
  //    performance bug for a correctness one. Discovery has to keep running.
  //
  //    Restrict speculation to LOCAL FIXED drives instead.
  //        Deliberately DriveType, not IsReady: IsReady queries free space,
  //        which for an unreachable network drive blocks on exactly the SMB
  //        timeout we are trying to avoid — the check would become the bug.
  //        DriveType reads the drive map and never touches the device.
  //        Network and removable drives are excluded from GUESSING only; a
  //        folder the user actually configured is always probed, so EQ on a NAS
  //        or a USB disk still works when you point us at it.
  const local = _fixedDriveSet();
  for (const dir of EQ_DEFAULT_DIRS) {
    if (local && /^[A-Za-z]:/.test(dir) && !local.has(dir.slice(0, 2).toUpperCase())) {
      skipped.push(dir);
      continue;
    }
    probe(dir, 'common');
  }
  if (skipped.length) {
    appendAgentLog(`[eq-scan] skipped ${skipped.length} speculative path(s) on non-local drives: ${skipped.join(', ')}\n`);
  }

  // Rank: eqgame.exe present beats logs-only; more logs wins as a tiebreaker.
  found.sort((a, b) => (Number(b.hasEqgame) - Number(a.hasEqgame)) || (b.logCount - a.logCount));
  return { scanned, found, slow };
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
  if (win === popRaidWindow) return 'popRaidBounds';
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
    // mouse" (Hitya 2026-06-22, CH chain + threat). Make the window
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
    // #187 — the character's spell-set gem file (<Char>_spellsets.ini and any
    // server-suffixed variant) so UI Studio can bulk-swap a song/spell across
    // every named set. Real-name resolved like the rest, written back with .bak.
    const ms = f.match(/^([A-Za-z]+).*spellsets.*\.ini$/i);
    if (ms && ms[1].toLowerCase() === cLower) want.push(f);
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
    // Per-mille → percent, CLAMPED to [0,100]. Zeal emits occasional negative
    // gauge values (observed -3 per-mille, which stored as target_hp_pct = -0.3
    // on 5 live rows, 2026-08-03) — a negative HP% is nonsense and silently
    // poisons anything doing a threshold or a min(): the off-heal "lowest HP"
    // pick would choose a dead/invalid target over a genuinely hurt raider.
    //
    // NOTE on precision, measured rather than assumed: 300 of 303 stored values
    // have fractional part EXACTLY .900 and the rest .000, so the real
    // granularity is ONE percentage point and the .9 is a constant −0.1
    // artifact, not resolution. EQ only exposes target HP as an integer percent;
    // the per-mille is Zeal's container, not extra information. Deliberately NOT
    // "corrected" by adding 0.1 (that would invent data) and NOT rounded to int
    // (that would throw away any finer resolution Zeal might ship later). Treat
    // this as ~1% granularity anywhere it feeds same-name mob inference.
    const _pct = (v) => Math.max(0, Math.min(100, Number(v) / 10));
    const self = inner.find(g => g && g.type === 1);
    const tgt  = inner.find(g => g && g.type === 6 && g.text);
    if (self) s.self_hp_pct = _pct(self.value);
    if (tgt)  { s.target_name = tgt.text; s.target_hp_pct = _pct(tgt.value); }
    else      { s.target_name = null; s.target_hp_pct = null; }
    // Pet — Zeal gauge slot 16 (confirmed from a live charmed-pet dump:
    // 1=self, 6=target, 16=pet). Require a name so an empty/fixed UI gauge
    // never reads as a pet. Surfaced so gauge-condition triggers + the charm
    // overlay can use live pet HP directly.
    const pet = inner.find(g => g && g.type === 16 && g.text);
    if (pet) { s.pet_name = pet.text; s.pet_hp_pct = _pct(pet.value); }
    else     { s.pet_name = null; s.pet_hp_pct = null; }
    // Retain every populated gauge slot verbatim — the agent reads slot 16 for
    // the pet and keeps the full list for the diagnostic gauge dump + the
    // charm-tracker name cross-reference fallback.
    const slots = [];
    for (const g of inner) {
      if (!g || g.type == null || g.value == null) continue;
      // value=0 happens for empty slots; skip those so the array isn't noise.
      if (g.value === 0 && !g.text) continue;
      slots.push({ slot: g.type, hp_pct: _pct(g.value), text: g.text || '' });
    }
    s.gauges = slots;
    // Group HP: gauge slots other than self(1)/target(6) that carry a name.
    let minPct = null, minName = null;
    for (const g of inner) {
      if (!g || g.type === 1 || g.type === 6 || !g.text || g.value == null) continue;
      const pct = _pct(g.value);
      // `> 0` already skipped negatives here by luck; the clamp makes it
      // explicit and keeps this consistent with the other three gauge reads.
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
      // Live position + facing (Zeal named_pipe.cpp player payload:
      // location {x,y,z}, heading). Note EQ's in-game /loc prints as Y, X, Z
      // — these are the raw Zeal Vec3 fields (x,y,z), transpose when matching
      // /loc. Exposed for the Info-tab explorer + future proximity features.
      if (inner.location && typeof inner.location === 'object') {
        s.loc = { x: inner.location.x, y: inner.location.y, z: inner.location.z };
      }
      if (typeof inner.heading === 'number') s.heading = inner.heading;
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
  } else if (type === 6) {                            // group — this char's group
    // Zeal group payload per member: { name, loc {x,y,z}, heading } always,
    // plus { hp_current, hp_max, class, level, zone_id } when /pipeverbose is
    // ON. Absorb the roster; the verbose HP fields are strictly better than
    // the gauge-slot HP cross-ref the agent falls back to. pipe_verbose is a
    // client-global setting, so seeing hp_current on ANY member proves it's on.
    const inner = _zealParseData(obj);
    if (Array.isArray(inner)) {
      const gm = [];
      let verbose = false;
      for (const mrec of inner) {
        if (!mrec || !mrec.name) continue;
        if (mrec.hp_current != null) verbose = true;
        gm.push({
          name:       String(mrec.name),
          loc:        mrec.loc || null,
          heading:    typeof mrec.heading === 'number' ? mrec.heading : null,
          hp_current: mrec.hp_current != null ? Number(mrec.hp_current) : null,
          hp_max:     mrec.hp_max     != null ? Number(mrec.hp_max)     : null,
          class:      mrec.class != null ? mrec.class : null,
          level:      mrec.level != null ? mrec.level : null,
          zone_id:    mrec.zone_id != null ? mrec.zone_id : null,
        });
      }
      s.group_members = gm;
      if (verbose) s.pipe_verbose = true;
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
  //
  // shell.openExternal returns a PROMISE. The old `try { shell.openExternal(x) }
  // catch {}` could never catch a launch failure — the rejection escaped the
  // synchronous catch entirely, so a browser that refused to open produced an
  // unhandled rejection and, on screen, absolute silence. Emma/Camping hit this
  // on Firefox 2026-08-06: clicked Sign in, nothing happened, no error.
  // Await it, and record the failure so Settings can tell the user to open the
  // page themselves instead of leaving them staring at a dead button.
  pub.browser_opened = null;                       // null = still trying
  const linkUrl = verification_url_complete || verification_url;
  shell.openExternal(linkUrl).then(
    () => { pub.browser_opened = true;  pushStatus(); },
    (err) => {
      pub.browser_opened = false;
      pub.browser_error  = String(err && err.message || err || '').slice(0, 200);
      console.warn('[mimic-link] could not open the browser:', pub.browser_error);
      pushStatus();
    },
  );
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
          appendAgentLog('[mimic] sign-in completed — restarting agent to pick up the new token\n');
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
  appendAgentLog('[mimic] sign-out — restarting agent without a token\n');
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
      // Fresh-install class seeding (one-shot; no-ops instantly once done).
      try { _maybeSeedClassSet(s); } catch {}
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

// ── Class-default overlay seeding (pretty-place phase 2) ─────────────────────
// Officer-crafted per-class overlay sets from /admin/overlays ride the agent's
// overlay-tuning poll and surface on /api/state as `classOverlaySets` (+ the
// active toon's class as `activeCharacterClass`). A BRAND-NEW install — user
// has never enabled an overlay, no per-character profiles — gets the class's
// set applied ONCE, then auto-arranged around the player's in-game windows.
// One-shot per install (cfg.classSetSeeded): an install the user has already
// shaped is marked seeded without changes, and a later set edit never re-fires.
const _CLASS_SET_WINDOWS = [
  ['showHud',          () => overlayWindow,   createOverlayWindow],
  ['enableTriggerTts', () => triggerWindow,   createTriggerOverlay],
  ['showCharm',        () => charmWindow,     createCharmOverlay],
  ['showPets',         () => petsWindow,      createPetsOverlay],
  ['showMobInfo',      () => mobInfoWindow,   createMobInfoOverlay],
  ['showBuffQueue',    () => buffQueueWindow, createBuffQueueOverlay],
  ['showWho',          () => whoWindow,       createWhoOverlay],
  ['showMelody',       () => melodyWindow,    createMelodyOverlay],
  ['showZeal',         () => zealWindow,      createZealHealthOverlay],
  ['showThreat',       () => threatWindow,    createThreatMeterOverlay],
  ['showChChain',      () => chChainWindow,   createChChainOverlay],
  ['showTank',         () => tankWindow,      createTankOverlay],
  ['showExtTarget',    () => extTargetWindow, createExtTargetOverlay],
  ['showCommand',      () => commandWindow,   createCommandOverlay],
  ['showPopRaid',      () => popRaidWindow,   createPopRaidOverlay],
];
// toggle-overlay key (what /admin/overlays stores) → cfg flag.
const _CLASS_SET_FLAG_BY_KEY = {
  hud: 'showHud', trigger: 'enableTriggerTts', charm: 'showCharm', pet: 'showPets',
  mobinfo: 'showMobInfo', buffQueue: 'showBuffQueue', who: 'showWho', melody: 'showMelody',
  zeal: 'showZeal', threat: 'showThreat', chchain: 'showChChain', tank: 'showTank',
  exttarget: 'showExtTarget', command: 'showCommand', popraid: 'showPopRaid',
};
function _maybeSeedClassSet(s) {
  const sets = s && s.classOverlaySets;
  const cls  = s && s.activeCharacterClass;
  if (!sets || !cls) return;                       // wait for a poll that has both
  const cfg = loadConfig();
  if (cfg.classSetSeeded) return;
  if (_hideAllActive || setupMode) return;
  // An install the user already shaped is off-limits: any overlay flag on
  // (trigger TTS defaults ON — excluded) or any saved per-char profile means
  // this isn't fresh. Mark seeded so this check never runs again.
  const shaped = cfg.charProfilesEnabled
    || _HIDEALL_FLAGS.some(f => f !== 'enableTriggerTts' && cfg[f]);
  if (shaped) { cfg.classSetSeeded = true; saveConfig(cfg); return; }
  const classKey = String(cls).toLowerCase().replace(/[^a-z]/g, '');
  const set = Array.isArray(sets[classKey]) ? sets[classKey] : null;
  if (!set || !set.length) return;                 // no set crafted → leave alone
  const flags = set.map(k => _CLASS_SET_FLAG_BY_KEY[k]).filter(Boolean);
  if (!flags.length) return;
  for (const f of flags) cfg[f] = true;
  cfg.classSetSeeded = true;
  saveConfig(cfg);
  for (const [flag, get, create] of _CLASS_SET_WINDOWS) {
    if (cfg[flag] && !get()) { try { create(); } catch {} }
  }
  applyAllVisibility();
  pushStatus();
  try { buildTrayMenu(); } catch {}
  appendAgentLog(`[class-set] seeded ${flags.length} overlay(s) for ${cls} (${_activeCharName || '?'})\n`);
  // First-boot pretty-place: pack the new set around the player's in-game
  // windows once everything has created + auto-heighted.
  setTimeout(() => {
    try { _autoArrangeOverlays(); } catch {}
    const c2 = loadConfig();
    if (!c2.firstArrangeDone) { c2.firstArrangeDone = true; saveConfig(c2); }
  }, 1500);
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

  // The agent holds the Zeal-update notice in memory, so a relaunch (config
  // save, crash, tray "Restart agent") wipes it. Without this it would stay
  // blank until the next 12h check. Delayed so the agent's HTTP server is up.
  if (_zealNotifiedTag) {
    setTimeout(() => { try { _pushZealUpdateToAgent(_zealNotifiedTag, loadConfig().zealInstalledTag); } catch { /* */ } }, 8000);
  }

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
  // Opt-in crash telemetry (tray → "Share crash reports"). Env-gated so the
  // agent literally cannot scan the crashes/ folder unless the user opted in.
  if (cfg.crashReports === true) env.WOLFPACK_CRASH_REPORTS = '1';

  agentProc = spawn(process.execPath, args, {
    env,
    cwd: AGENT_DIR(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agentProc.stdout.on('data', d => { const s = `[agent] ${d}`; process.stdout.write(s); appendAgentLog(s); });
  agentProc.stderr.on('data', d => { const s = `[agent] ${d}`; process.stderr.write(s); appendAgentLog(s); });
  agentProc.on('exit', (code, signal) => {
    agentProc = null;
    pushStatus();
    if (quitting) return;
    const marker = path.join(AGENT_DIR(), '.force-update-on-restart');
    if (fs.existsSync(marker)) { try { fs.unlinkSync(marker); } catch {} restartBackoff = 1000; return launchAgent(); }

    // #74 Part 3 — crash-loop detection. Track exits within the crash-loop window.
    const now = Date.now();
    _recentExits = _recentExits.filter(t => now - t < LKG_CRASHLOOP_WINDOW_MS);
    _recentExits.push(now);
    const swapOnTrial = _agentSwapAt && (now - _agentSwapAt) < LKG_SWAP_TRIAL_MS;

    if (swapOnTrial && _recentExits.length >= LKG_CRASHLOOP_EXITS) {
      // The just-swapped agent is crash-looping → auto-revert to last-known-good,
      // blacklist the bad version, and relaunch from LKG.
      const bad = _agentSwapToVersion;
      const lkgVer = _restoreAgentLkg();
      _agentSwapAt = 0; _agentSwapToVersion = null; _recentExits = [];
      if (lkgVer) {
        _blacklistedAgentVersion = bad;
        _lkgReverted = { from: bad, to: lkgVer, at: now };
        appendAgentLog(`[mimic] CRASH-LOOP after hot-swap to v${bad || '?'} (${LKG_CRASHLOOP_EXITS} exits in ${Math.round(LKG_CRASHLOOP_WINDOW_MS / 1000)}s) — reverted to last-known-good v${lkgVer}; won't re-offer v${bad || '?'} until a newer build ships\n`);
        try { _notifyLkgRevert(bad, lkgVer); } catch { /* best-effort */ }
        pushStatus();
        restartBackoff = 1000;
        return launchAgent();
      }
      appendAgentLog(`[mimic] crash-loop after hot-swap to v${bad || '?'} but no last-known-good to restore — backing off\n`);
    } else if (!swapOnTrial && _recentExits.length >= LKG_CRASHLOOP_EXITS && !_crashNoticeShown) {
      // Crash-loop with NO recent swap (LKG == current): the current agent is
      // failing on its own. Keep the existing exponential backoff (below) — never
      // a tight restart loop — but surface a diagnostic notice once.
      _crashNoticeShown = true;
      appendAgentLog(`[mimic] agent crash-looping (${_recentExits.length} exits in ${Math.round(LKG_CRASHLOOP_WINDOW_MS / 1000)}s) with no recent update — see Zeal health / diagnostics. Backing off restarts.\n`);
      try { _notifyAgentCrashLoop(); } catch { /* best-effort */ }
    }

    // code=null + a signal = something called kill() on the child. Every
    // shell-side kill path now logs its reason first — an exit here with NO
    // preceding [mimic] reason line is external (AV, OS, or the agent dying
    // to a raised signal). Raid night 2026-07-15 had five such orphan exits;
    // this line is the instrumentation to name the killer next time.
    appendAgentLog(`[mimic] agent exited (code=${code} signal=${signal || 'none'}); restarting in ${restartBackoff}ms\n`);
    setTimeout(launchAgent, restartBackoff);
    restartBackoff = Math.min(restartBackoff * 2, 60000);
  });
  setTimeout(() => {
    if (agentProc) {
      restartBackoff = 1000;
      _recentExits = [];
      _crashNoticeShown = false;
      // The swapped-in version has run stable for 30s → accept it as good.
      if (_agentSwapAt) {
        _agentSwapAt = 0; _agentSwapToVersion = null;
        appendAgentLog('[mimic] hot-swapped agent stable for 30s — accepted\n');
      }
    }
  }, 30000);

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
  // Re-point EVERY overlay window at the (possibly new) agent port. Each
  // overlay subscribes via onAgentPort, but 'agent-port' was only ever sent
  // once, in each window's ready-to-show — so an agent restart that moved
  // ports left every open overlay polling the dead old port forever (CH
  // chain red "OVERLAY BLIND", blank Command Center — 2026-07-15 raid).
  // Broadcasting to all windows is safe: pages without an onAgentPort
  // subscription simply never registered the listener.
  try {
    if (up) {
      for (const w of BrowserWindow.getAllWindows()) {
        try { if (!w.isDestroyed()) w.webContents.send('agent-port', agentPort); } catch (e) { void e; }
      }
    }
  } catch (e) { /* non-fatal */ }
  // Re-assert the per-machine "pause Discord tells" deadline — the agent keeps
  // it in-process only, so a (re)launch would otherwise resume DMs silently.
  try {
    const paused = Number(loadConfig().tellsDmPausedUntil) || 0;
    if (paused > Date.now()) pushTellsDmPause(paused);
  } catch (e) { /* non-fatal */ }
  // Same rationale for the damage-taken alert: the agent's copy is in-memory
  // and defaults OFF, so an enabled alert has to be re-asserted after every
  // (re)launch. No `announce` — a relaunch isn't a user toggle.
  try { if (up) pushDamageAlert(false); } catch (e) { /* non-fatal */ }
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
// Self-healing port watcher (Hitya 2026-07-15: "Can't reach the parser
// engine at :7779" appearing constantly). The one-shot reload after
// launchAgent() only fires when waitForAgent succeeds INSIDE its window — a
// slow agent boot (23 logs to open), a crash-restart with backoff, or a
// lingering old process holding the port all leave the dashboard window
// stranded on a dead port showing the banner until a manual click. This
// watcher closes every one of those gaps: whenever the window's URL port
// drifts from the live agentPort AND the live port answers, re-navigate.
// Throttled so a flapping agent can't thrash the window.
let _lastDriftNavAt = 0;
setInterval(() => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || !agentPort) return;
    const cur = mainWindow.webContents.getURL() || '';
    const m = cur.match(/^https?:\/\/127\.0\.0\.1:(\d+)\//);
    if (!m || parseInt(m[1], 10) === agentPort) return;   // not on the agent, or already right
    if (Date.now() - _lastDriftNavAt < 15000) return;
    const probe = http.get({ host: '127.0.0.1', port: agentPort, path: '/api/state', timeout: 1200 }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        _lastDriftNavAt = Date.now();
        appendAgentLog(`[mimic] port drift detected (window ${m[1]} → agent ${agentPort}) — auto-reloading\n`);
        navigateToDashboard('port-drift');
      }
    });
    probe.on('error', () => {});
    probe.on('timeout', () => { try { probe.destroy(); } catch {} });
  } catch { /* watcher must never throw */ }
}, 4000);

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
  // An UNATTENDED auto-install counts as an auto-start too (Hitya,
  // 2026-08-04: "The settings/dashboard did pop up to the foreground").
  //
  // The whole promise of install-on-EQ-close is that it happens without
  // interrupting you — but the relaunch afterwards is not a login and carries no
  // --autostart, so the dashboard came up SHOWN and grabbed focus. If the raider
  // had relaunched EverQuest in the meantime, that lands a window over the game:
  // exactly the outcome the feature exists to avoid ("it should not become the
  // active window while they're doing things in game").
  //
  // A user-initiated "Restart now" is NOT this: they asked for it and expect the
  // window back, so only the unattended path sets the flag. The flag is
  // one-shot — cleared as soon as it is read, so a later manual launch shows the
  // dashboard normally.
  let _autoInstalled = false;
  try {
    const _c = loadConfig();
    if (_c && _c.pendingSilentRelaunch) {
      _autoInstalled = true;
      delete _c.pendingSilentRelaunch;
      saveConfig(_c);
      appendAgentLog('[updater] relaunched after an unattended install — starting to tray, not to the foreground\n');
    }
  } catch (e) { void e; }
  const _autoStarted =
    _autoInstalled ||
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
    webPreferences: _wpPrefs('Dashboard'),
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

// ── Overlay home display (multi-monitor, Hitya 2026-07-15) ────────────────
// "I've lost several overlays off my window and cannot find them." Overlays
// can legitimately sit on ANY connected display (so _boundsOnScreen passes)
// while the user plays EQ on another. The HOME display is where overlays
// belong: stamped from the cursor position whenever the user runs 🧲 Rescue
// (they click it on the monitor they're playing on — we can't ask Windows
// where the EQ window is without native deps). Auto-arrange + the fullscreen
// EQ scaler target this display; default = primary (pre-2026-07-15 behavior).
function _overlayHomeDisplay() {
  try {
    const cfg = loadConfig();
    if (cfg.overlayHomePoint && Number.isFinite(cfg.overlayHomePoint.x)) {
      return screen.getDisplayNearestPoint({ x: cfg.overlayHomePoint.x, y: cfg.overlayHomePoint.y });
    }
  } catch { /* fall through */ }
  return screen.getPrimaryDisplay();
}
// Gather every overlay window onto the display under the cursor, then
// auto-arrange there. Stamps that display as home so future arranges (and
// the resolution-change fallback) stay on it.
function _rescueOverlays() {
  const pt = screen.getCursorScreenPoint();
  const cfg = loadConfig();
  cfg.overlayHomePoint = { x: pt.x, y: pt.y };
  saveConfig(cfg);
  const disp = screen.getDisplayNearestPoint(pt);
  const a = disp.workArea;
  let moved = 0;
  const report = [];
  const present = new Set();
  for (const [key, win] of _overlayEntries()) {
    try {
      present.add(key);
      const b = win.getBounds();
      // "Already home" = the window's CENTER sits on the home display. The
      // first cut tested for a mere sliver of overlap, so a window straddling
      // the monitor boundary (Hitya 2026-07-15: CH chain never came back)
      // was counted as home and skipped — still mostly lost off-screen.
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const onHome = cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
      if (onHome) { report.push(`${key}: kept (${b.x},${b.y} ${win.isVisible() ? 'visible' : 'hidden'})`); continue; }
      // Park inside the home display; auto-arrange below finds real spots.
      win.setBounds({
        x: Math.max(a.x + 8, Math.min(a.x + a.width  - b.width  - 8, a.x + 40 + (moved * 24))),
        y: Math.max(a.y + 8, Math.min(a.y + a.height - b.height - 8, a.y + 40 + (moved * 24))),
        width: b.width, height: b.height,
      });
      moved++;
      report.push(`${key}: moved from (${b.x},${b.y}) ${win.isVisible() ? 'visible' : 'HIDDEN'}`);
    } catch (e) { report.push(`${key}: error ${e.message}`); }
  }
  // Overlays with NO window at all (disabled via ✕/tray, or gated off) can't
  // be rescued — name them in the log so "still missing X" has an answer:
  // it needs re-enabling from tray → Overlays, not another rescue.
  const KNOWN = ['hud', 'trigger', 'charm', 'pets', 'mobinfo', 'buffQueue', 'who', 'melody', 'zeal', 'threat', 'chchain', 'tank', 'exttarget', 'command', 'popraid'];
  const missing = KNOWN.filter(k => !present.has(k));
  // Re-evaluate every show/hide gate BEFORE arranging so anything that should
  // be visible on the home display participates in the packing.
  try { applyAllVisibility(); } catch { /* best effort */ }
  let arranged = null;
  try { arranged = _autoArrangeOverlays(); } catch { /* best effort */ }
  appendAgentLog(`[rescue] home display ${disp.id} (${disp.size.width}x${disp.size.height}) · moved ${moved}\n`
    + report.map(r => `[rescue]   ${r}`).join('\n') + '\n'
    + (missing.length ? `[rescue]   NO WINDOW (disabled/gated — re-enable from tray → Overlays): ${missing.join(', ')}\n` : ''));
  return { moved, display: `${disp.size.width}x${disp.size.height}`, missing, arranged };
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
  if (popRaidWindow && !popRaidWindow.isDestroyed()) out.push(['popraid', popRaidWindow]);
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

// ── Per-overlay solid backdrop (Hitya 2026-07-10) ─────────────────────────
// A dark opaque plate behind the WHOLE overlay window (not just the cards) so
// overlays stay readable over bright scenes. Per-overlay in the right-click
// chrome menu; all-at-once via the backdrop hotkey (default Ctrl+Shift+B,
// override with cfg.backdropHotkey). The renderer side is injected by
// preload.js (body.wp-backdrop class), so every overlay gets it with no
// per-HTML change. State: cfg.overlayBackdrop = { key → bool }.
function _backdropOn(key) {
  const cfg = loadConfig();
  return !!((cfg.overlayBackdrop || {})[key]);
}
function applyOverlayBackdrop(win, key) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('wp-backdrop', _backdropOn(key)); } catch {}
}
function applyAllOverlayBackdrops() {
  for (const [key, win] of _overlayEntries()) applyOverlayBackdrop(win, key);
}
function toggleAllBackdrops() {
  const cfg = loadConfig();
  const map = (cfg.overlayBackdrop && typeof cfg.overlayBackdrop === 'object') ? cfg.overlayBackdrop : {};
  const keys = _overlayEntries().map(([k]) => k);
  if (keys.length === 0) return;
  const anyOff = keys.some(k => !map[k]);   // uniform flip: any off → all on
  for (const k of keys) map[k] = anyOff;
  cfg.overlayBackdrop = map;
  saveConfig(cfg);
  applyAllOverlayBackdrops();
}

// ── Auto-arrange overlays around the in-game UI (Hitya 2026-07-10) ────────
// Reads the freshest UI_<Char>_*.ini (position data EQ itself writes; we NEVER
// write these — EQ overwrites them on camp/zone/quit), projects the player's
// window rects onto the primary display, and packs the VISIBLE overlay windows
// into the free space (right edge first). Sizes are kept, shrinking through
// the preset ladder only when a spot can't be found at the current width.
// V1 heuristics, deliberately conservative: every positioned UI section counts
// as occupied (a placed-but-closed EQ window just costs free space), and the
// dominant XPos<W>x<H> resolution block is assumed to be the live layout.
const _UI_PHANTOM_RX = /^(zoneselect|characterlist|charselect|charactercreate|serverselect|login|connection|cursorattachment|confirmationdialog|mailwnd|barter|tribute|guildbank|expedition|mercenary|overseer|voicemacro|raidoptions|dragitem|itemdisplay|spelldisplay|bookwindow|givewnd|tradewnd|lootwnd|colorpicker|fileselection|helpwnd|storewnd|bazaarwnd|bazaarsearchwnd|alarmwnd|musicplayer|videomodes|textentrywnd)/i;
function _newestUiIniFile() {
  const cfg = loadConfig();
  const hints = Array.isArray(cfg.eqPaths) ? cfg.eqPaths : (cfg.eqPath ? [cfg.eqPath] : []);
  const dirs = new Set();
  for (const h of [...hints, null]) {
    try {
      const r = findEqInstalls(h);
      for (const f of (r.found || [])) dirs.add(f.path);
    } catch { /* keep scanning */ }
  }
  let newest = null;
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!/^UI_[A-Za-z]+.*\.ini$/i.test(f)) continue;
      try {
        const full = path.join(dir, f);
        const mt = fs.statSync(full).mtimeMs || 0;
        if (!newest || mt > newest.mtimeMs) newest = { file: full, mtimeMs: mt };
      } catch { /* unreadable — skip */ }
    }
  }
  return newest ? newest.file : null;
}
function _parseUiWindowRects() {
  try {
    const file = _newestUiIniFile();
    if (!file) return null;
    const text = fs.readFileSync(file, 'utf8');
    const sections = {};
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const s = raw.trim();
      const m = s.match(/^\[(.+)\]$/);
      if (m) { cur = {}; sections[m[1]] = cur; continue; }
      if (!cur) continue;
      const eq = s.indexOf('=');
      if (eq > 0) cur[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
    }
    // The live layout = the resolution block with the most XPos<W>x<H> keys.
    const resCount = new Map();
    for (const props of Object.values(sections)) {
      for (const k of Object.keys(props)) {
        const m = k.match(/^XPos(\d+)x(\d+)$/i);
        if (m) { const key = m[1] + 'x' + m[2]; resCount.set(key, (resCount.get(key) || 0) + 1); }
      }
    }
    let res = null, best = 0;
    for (const [k, n] of resCount) if (n > best) { best = n; res = k; }
    const rw = res ? parseInt(res.split('x')[0], 10) : null;
    const rh = res ? parseInt(res.split('x')[1], 10) : null;
    const db = _overlayHomeDisplay().bounds;   // fullscreen EQ covers the HOME display (multi-monitor)
    const sx = rw > 0 ? db.width / rw : 1;
    const sy = rh > 0 ? db.height / rh : 1;
    const rects = [];
    for (const [name, props] of Object.entries(sections)) {
      if (_UI_PHANTOM_RX.test(name)) continue;
      const gx = (res && props['XPos' + res] != null) ? props['XPos' + res] : props.XPos;
      const gy = (res && props['YPos' + res] != null) ? props['YPos' + res] : props.YPos;
      if (gx == null || gy == null) continue;
      const x = parseInt(gx, 10), y = parseInt(gy, 10);
      const w = parseInt(props.Width != null ? props.Width : (props['Size.cx'] != null ? props['Size.cx'] : 200), 10);
      const h = parseInt(props.Height != null ? props.Height : (props['Size.cy'] != null ? props['Size.cy'] : 100), 10);
      if (![x, y, w, h].every(Number.isFinite)) continue;
      if (w <= 0 || h <= 0 || x < -50 || y < -50) continue;
      rects.push({
        name,
        x: Math.round(db.x + x * sx), y: Math.round(db.y + y * sy),
        w: Math.round(w * sx), h: Math.round(h * sy),
      });
    }
    return { rects, file, resolution: res || null };
  } catch (e) {
    appendAgentLog('[auto-arrange] UI parse failed: ' + e.message + '\n');
    return null;
  }
}
function _autoArrangeOverlays(pinnedKey) {
  const t0 = Date.now();
  const area = _overlayHomeDisplay().workArea;   // home display, not always primary (multi-monitor)
  const ui = _parseUiWindowRects();
  const MARGIN = 8, STEP = 16;
  const occupied = [];
  if (ui) for (const r of ui.rects) occupied.push({ x: r.x - MARGIN, y: r.y - MARGIN, w: r.w + MARGIN * 2, h: r.h + MARGIN * 2 });
  // Drop UI rects fully contained in another (bags inside the inventory,
  // gems inside the spellbar, …) — they add obstacle-scan cost but never
  // change placement. EQ inis carry 60-100 sections; this typically halves
  // the obstacle list.
  for (let i = occupied.length - 1; i >= 0; i--) {
    const a = occupied[i];
    for (let j = 0; j < occupied.length; j++) {
      if (i === j) continue;
      const b = occupied[j];
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        occupied.splice(i, 1);
        break;
      }
    }
  }
  // Perimeter rule (Hitya 2026-07-11 — "they should stay out of the center
  // of the screen for the most part, lining the outside"): the middle ~52% of
  // the display is the play view and is a soft no-go zone. Pass 1 blocks it,
  // which fills the right column → top/bottom bands → left column; pass 2
  // (per overlay, only when NOTHING fits on the perimeter at any width)
  // allows it rather than stranding the overlay.
  const czW = Math.round(area.width * 0.52), czH = Math.round(area.height * 0.52);
  const centerZone = {
    x: area.x + Math.round((area.width - czW) / 2),
    y: area.y + Math.round((area.height - czH) / 2),
    w: czW, h: czH,
  };
  // Every candidate's CURRENT rect blocks placement until that overlay is
  // itself moved — placing A onto B's spot while B ends up skipped was the
  // "overlays in contention" pile-up. Skipped overlays keep their block.
  const pendingCur = new Map();
  const pad = (b) => ({ x: b.x - MARGIN, y: b.y - MARGIN, w: b.width + MARGIN * 2, h: b.height + MARGIN * 2 });
  // Visible overlays, biggest first (big ones need the scarce large gaps).
  const wins = _overlayEntries()
    .filter(([, w]) => { try { return w.isVisible(); } catch { return false; } })
    .map(([key, win]) => ({ key, win, b: win.getBounds() }))
    .sort((a, b) => (b.b.width * b.b.height) - (a.b.width * a.b.height));
  for (const o of wins) pendingCur.set(o.key, pad(o.b));
  // Pinned overlay (arrange-on-show passes the just-opened one, Uilnayar
  // 2026-07-12: "the overlay must not jump when opening"): it stays exactly
  // at its saved bounds — its rect blocks placement and it is never moved.
  // Manual auto-arrange passes nothing and repacks everything as before.
  const moveList = pinnedKey ? wins.filter(o => o.key !== pinnedKey) : wins;
  let placed = 0, skipped = 0;
  for (const o of moveList) {
    // Shrink-only preset ladder: try the current width, then narrower presets
    // ("auto-resize" — a too-wide overlay steps down until it fits somewhere).
    // No resizing during arrange (Hitya 2026-07-12): windows keep their
    // exact size — an overlay that fits nowhere at its current size is
    // simply left where it was.
    const ladder = [o.b.width];
    let done = false;
    for (const blockCenter of [true, false]) {
      for (const w of ladder) {
        const h = o.b.height;   // height re-fits to content via overlayAutoHeight
        let spot = null;
        // Right edge first, then sweep left — keeps the EQ center clear and
        // matches how raiders park overlays today.
        //
        // Skip-ahead sweep (Hitya 2026-07-13: "hitting autoarrange lags
        // out the system"): the old inner loop stepped y 16px at a time
        // through BLOCKED space — up to ~12k candidate rects per overlay,
        // each overlap-checked against every obstacle, all synchronous on
        // the Electron main process (which freezes every overlay window +
        // IPC while it runs). Now each column pre-filters the obstacles
        // that overlap it, and on a collision y JUMPS straight past the
        // blocking rect instead of crawling through it — same placement
        // semantics (first fit, right-to-left, top-to-bottom), ~100× fewer
        // checks, zero per-candidate allocations.
        const colObstacles = [];
        for (let x = area.x + area.width - w; x >= area.x && !spot; x -= STEP) {
          // Obstacles whose x-range intersects this column (padded rects).
          colObstacles.length = 0;
          if (blockCenter && centerZone.x < x + w && centerZone.x + centerZone.w > x) colObstacles.push(centerZone);
          for (const ob of occupied) if (ob.x < x + w && ob.x + ob.w > x) colObstacles.push(ob);
          for (const [k, r] of pendingCur) if (k !== o.key && r.x < x + w && r.x + r.w > x) colObstacles.push(r);
          let y = area.y;
          while (y + h <= area.y + area.height) {
            let blocker = null;
            for (const ob of colObstacles) {
              if (ob.y < y + h && ob.y + ob.h > y) { blocker = ob; break; }
            }
            if (!blocker) { spot = { x, y, w, h }; break; }
            // Jump to the first y where this blocker clears; never move by
            // less than STEP so a stack of touching obstacles can't stall.
            y = Math.max(y + STEP, blocker.y + blocker.h);
          }
        }
        if (spot) {
          try { o.win.setBounds({ x: spot.x, y: spot.y, width: w, height: h }); } catch {}
          pendingCur.delete(o.key);
          occupied.push({ x: spot.x - MARGIN, y: spot.y - MARGIN, w: w + MARGIN * 2, h: h + MARGIN * 2 });
          placed++; done = true; break;
        }
      }
      if (done) break;
    }
    if (!done) skipped++;   // left where it was — its pendingCur rect keeps blocking
  }
  const summary = { placed, skipped, ms: Date.now() - t0, uiWindows: ui ? ui.rects.length : 0, uiFile: ui ? path.basename(ui.file) : null, resolution: ui ? ui.resolution : null };
  appendAgentLog('[auto-arrange] ' + JSON.stringify(summary) + '\n');
  return summary;
}

function applyOverlayInteractivity() {
  const cfg = loadConfig();
  // Unlocking force-shows EVERY overlay for placement — including ones whose
  // pref is off, whose windows lazy creation has not built (or has reaped).
  // Build them first or "unlock to move" would silently skip them.
  _materializeEnabledOverlays();
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
    // Every overlay has to exist to be placed. _overlayForcedOn() reports true
    // for all of them while setupMode is set, so this builds the full set.
    _materializeEnabledOverlays();
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
  // Leaving setup mode hands back the renderers it built for overlays the user
  // does not actually run. No-op on the way IN — _overlayForcedOn() spares
  // everything while setupMode is set.
  _reapDisabledOverlays();
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
    webPreferences: _wpPrefs('panel overlay ' + panelKey),
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
    webPreferences: _wpPrefs('DPS HUD'),
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
    // backgroundThrottling:false so a HIDDEN trigger overlay keeps running its
    // TTS + countdowns full-speed — the ✕ hides the visual only (#97), it must
    // never throttle or silence callouts.
    webPreferences: _wpPrefs('Trigger alerts', { backgroundThrottling: false }),
  });
  triggerWindow.setAlwaysOnTop(true, 'screen-saver');
  triggerWindow.setVisibleOnAllWorkspaces(true);
  triggerWindow.loadFile('triggers.html');
  triggerWindow.on('moved',  () => _persistBounds('triggerBounds', triggerWindow));
  triggerWindow.on('resize', () => _persistBounds('triggerBounds', triggerWindow));
  triggerWindow.once('ready-to-show', () => {
    triggerWindow.webContents.send('agent-port', agentPort);
    // #120 — the trigger overlay is never clicked, so its document never earns
    // the user activation Chromium requires before speechSynthesis will make
    // sound. executeJavaScript with userGesture=true flips that activation bit
    // once, for the document's lifetime, so trigger/blind TTS is audible. Cheap,
    // idempotent, no visible effect; ignore failures (page mid-load, etc.).
    try {
      triggerWindow.webContents.executeJavaScript('void 0', true).catch(() => {});
    } catch (e) { /* non-fatal */ }
    applyTriggerVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(triggerWindow, 'trigger');
  });
}

function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 540, height: 560, title: 'Mimic Settings', backgroundColor: '#0e1116',
    webPreferences: _wpPrefs('Settings'),
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// Resource use — its own window as of 2026-08-04 (Hitya), reachable
// from the tray and the dashboard rather than only from inside Settings.
// "Is Mimic costing me anything?" gets asked while the game is running, so the
// answer has to be openable next to EQ and leavable open; buried in Settings it
// meant keeping a form with a Save button open to watch a number.
//
// A plain window, NOT an overlay: it is not frameless/transparent/always-on-top
// and never sits over the game, so the overlay feature-parity checklist
// (hide button, hover-interact handshake, _HIDEALL_FLAGS, …) does not apply —
// it is a sibling of Settings and UI Studio.
let resourcesWindow = null;
function openResources() {
  if (resourcesWindow) { resourcesWindow.focus(); return; }
  resourcesWindow = new BrowserWindow({
    width: 520, height: 520, title: 'Mimic — Resource use', backgroundColor: '#0e1116',
    webPreferences: _wpPrefs('Resource use'),
  });
  resourcesWindow.loadFile('resources.html');
  resourcesWindow.on('closed', () => {
    resourcesWindow = null;
    // Nothing reads these now, and a stale snapshot would be served to the next
    // open before its first query lands.
    _wsPrivate.byPid = new Map();
    _wsPrivate.at = 0;
    _wsPrivate.lastMs = 0;
  });
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
    webPreferences: _wpPrefs('UI Studio'),
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

// The EQ folders that count as OURS, lowercased with trailing separators
// stripped. Empty means we have nothing to compare against — callers must then
// fail OPEN and accept any eqgame.exe.
function _ourEqDirs() {
  let cfg; try { cfg = loadConfig(); } catch { return []; }
  const excluded = new Set((cfg.eqPathsExcluded || []).map(p => String(p || '').toLowerCase()));
  const raw = (Array.isArray(cfg.eqPaths) && cfg.eqPaths.length)
    ? cfg.eqPaths
    : (cfg.eqPath ? [cfg.eqPath] : []);
  return raw
    // Only folders we are ACTUALLY tailing count. A stale eqPaths entry that
    // holds no logs would otherwise disown the client the user really plays —
    // resolveEqDirsWithLogs() falls back past those entries, so trusting them
    // here would let this check disagree with the rest of Mimic. No usable
    // folder → empty → fail open, same as an unconfigured install.
    .filter(p => _dirHasEqLogs(p))
    .map(p => String(p || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase())
    .filter(p => p && !excluded.has(p));
}

// PID → "is this OUR EverQuest?".
//
// eqgame.exe is the binary name for EVERY EverQuest client, so the process name
// alone cannot tell Project Quarm from another install on the same machine.
// Hitya 2026-08-04: EQLegends was the running client and Mimic reported
// "EverQuest running" — overlays up over the wrong game, the Zeal-missing nag
// primed, and the EQ-close auto-install armed against a process we don't care
// about. Only the full ExecutablePath distinguishes them.
//
// Get-CimInstance is far too heavy for a 5s poll, so the verdict is cached per
// PID: the lookup runs once per game launch and never again while it's up.
const _eqPidVerdict = new Map();
// pid → exe path, for the eqgame.exe processes we decided are NOT ours.
const _eqIgnoredPaths = new Map();

// Resolve ownership for PIDs we haven't judged yet. Every failure path marks
// them OURS — a lookup we couldn't perform must degrade to the old
// name-only behavior, never to hiding a real raider's overlays.
function _resolveEqPidOwners(pids) {
  return new Promise((resolve) => {
    const claimAll = () => { for (const p of pids) _eqPidVerdict.set(p, true); resolve(); };
    const dirs = _ourEqDirs();
    if (!dirs.length) return claimAll();       // nothing configured → can't tell
    try {
      const { execFile } = require('child_process');
      const filter = pids.map(p => `ProcessId=${p}`).join(' OR ');
      const psCmd = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) return claimAll();
          const judged = new Set();
          for (const line of String(stdout).split(/\r?\n/)) {
            const m = line.trim().match(/^(\d+)\|(.+)$/);
            if (!m) continue;
            const pid = Number(m[1]);
            const exe = m[2].trim();
            const low = exe.replace(/\//g, '\\').toLowerCase();
            const ours = dirs.some(d => low.startsWith(d + '\\'));
            _eqPidVerdict.set(pid, ours);
            judged.add(pid);
            if (ours) { _eqIgnoredPaths.delete(pid); continue; }
            // Remember WHICH client we passed on. "EverQuest closed" while an
            // EverQuest is visibly running is alarming without this — the
            // Resource use window prints it, so the answer is on screen instead
            // of buried in agent.log.
            _eqIgnoredPaths.set(pid, exe);
            appendAgentLog(`[eq] ignoring eqgame.exe pid ${pid} — ${exe} is not under a configured EQ folder (${dirs.join(', ') || 'none'})\n`);
          }
          for (const p of pids) if (!judged.has(p)) _eqPidVerdict.set(p, true);
          resolve();
        });
    } catch { claimAll(); }
  });
}

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
        // Parse the CSV rows for PIDs rather than substring-matching the name:
        // tasklist prints "INFO: No tasks…" to STDOUT when the filter matches
        // nothing, and we need the PIDs anyway to check which install each one
        // came from.
        const pids = [];
        for (const m of String(out).matchAll(/"eqgame\.exe"\s*,\s*"(\d+)"/gi)) pids.push(Number(m[1]));
        if (!pids.length) { _eqPidVerdict.clear(); _eqIgnoredPaths.clear(); return resolve(false); }
        // Drop exited PIDs so the verdict map can't grow across a long session.
        for (const known of [..._eqPidVerdict.keys()]) if (!pids.includes(known)) { _eqPidVerdict.delete(known); _eqIgnoredPaths.delete(known); }
        // `!== false` keeps the fail-open default: only a PID we positively
        // identified as someone else's client is discounted.
        const done = () => resolve(pids.some(p => _eqPidVerdict.get(p) !== false));
        const unknown = pids.filter(p => !_eqPidVerdict.has(p));
        if (!unknown.length) return done();
        _resolveEqPidOwners(unknown).then(done, done);
      });
      child.once('error', () => { clearTimeout(timer); resolve(_eqRunning); });
    } catch { resolve(_eqRunning); }
  });
}
// ── Pending-update install + nag ─────────────────────────────────────────────
// Raiders kept arriving on old builds without realising it and quietly missing
// features (Hitya 2026-08-03). autoInstallOnAppQuit already applies an update
// at the next normal Mimic quit — but people leave Mimic running for days, so
// that almost never fires.
//
// EQ closing is the safest instant that exists to restart Mimic: they are
// provably not playing, let alone mid-pull. So we install there, and otherwise
// only NAG.
//
// The nag is an OS Notification on purpose. It cannot take focus or raise a
// window over the game — the hard requirement here is that nothing yanks the
// user out of EverQuest ("it should not become the active window while they're
// doing things in game"). Same surface checkZealUpdate() already uses.
const EQ_CLOSE_INSTALL_GRACE_MS = 15_000;
const UPDATE_NAG_EVERY_MS       = 60 * 60 * 1000;
let _updateNagAt = 0;

// One pending install timer at a time. Without this, the "EQ is already closed"
// path below would arm a fresh 15s timer on every presence poll.
let _installArmed = false;

function _installPendingUpdateOnEqClose() {
  if (!updatePending || !autoUpdater) return;
  if (_installArmed) return;
  _installArmed = true;
  const ver = updatePending.version;
  appendAgentLog(`[updater] EQ closed with v${ver} pending — installing in ${EQ_CLOSE_INSTALL_GRACE_MS / 1000}s\n`);
  // Grace window: a crash-and-relaunch, or alt-F4 followed by starting EQ again,
  // must NOT get Mimic pulled out from under them. Re-check before committing.
  setTimeout(() => {
    _installArmed = false;
    if (_eqRunning)   { appendAgentLog('[updater] EQ came back — deferring install to the next close\n'); return; }
    if (!updatePending) return;
    appendAgentLog(`[updater] installing v${ver} now (EQ closed)\n`);
    // Mark the relaunch as unattended so the new instance starts to TRAY.
    // Written before quitAndInstall because that call does not return.
    try {
      const c = loadConfig();
      c.pendingSilentRelaunch = true;
      saveConfig(c);
    } catch (e) { void e; }
    try { autoUpdater.quitAndInstall(true, true); }
    catch (e) { appendAgentLog(`[updater] quitAndInstall failed: ${e && e.message}\n`); }
  }, EQ_CLOSE_INSTALL_GRACE_MS);
}

function _nagPendingUpdate() {
  if (!updatePending) return;
  const now = Date.now();
  if (now - _updateNagAt < UPDATE_NAG_EVERY_MS) return;
  _updateNagAt = now;
  if (!Notification.isSupported()) return;
  try {
    // Deliberately reassuring, not demanding: the whole point is that they do
    // NOT have to act. A nag that asks for nothing stops being pestering.
    const n = new Notification({
      title:  `Mimic ${updatePending.version} is ready`,
      body:   'It installs by itself the next time you close EverQuest — nothing to do.',
      silent: true,
    });
    n.show();
  } catch { /* notifications unavailable — the tray item still shows it */ }
}

async function _pollEqPresence() {
  const running = await _checkEqRunning();
  if (running !== _eqRunning) {
    const wasRunning = _eqRunning;
    _eqRunning = running;
    // Visibility flip — overlays appear/vanish as EQ comes up / goes down.
    try { applyAllVisibility(); } catch {}
    // EQ just went away — take the free restart.
    if (wasRunning && !running) { try { _installPendingUpdateOnEqClose(); } catch { /* never break presence polling */ } }
  }
  // EQ is closed and an update is waiting — install it, EVEN THOUGH no
  // close-transition happened on our watch.
  //
  // THE BUG (Hitya, 2026-08-04: "beta 9 did not update after eq closed"):
  // the call above only fires on the FALLING EDGE, so it required us to observe
  // running → closed. It misses the common orderings entirely:
  //   • the download finishes while EQ is already shut (the overnight case —
  //     Mimic sits idle, polls hourly, downloads at 3am, and then waits for the
  //     user to both LAUNCH and QUIT the game before it will install);
  //   • Mimic starts with an update already downloaded and EQ not running;
  //   • EQ was never running this session at all.
  // In every one of those the tray says "Restart to install" indefinitely and
  // the update silently never applies — which is exactly what "it did not
  // update in place" looks like from the outside.
  //
  // _installArmed makes this safe to evaluate on every poll, and the existing
  // 15s grace re-check still protects a launch that lands mid-window.
  if (!running && updatePending) {
    try { _installPendingUpdateOnEqClose(); } catch { /* never break presence polling */ }
  }
  // Hourly, focus-safe reminder while they're still playing on the old build.
  if (running) { try { _nagPendingUpdate(); } catch { /* ditto */ } }
}
// Presence polling backs OFF while EQ is absent.
//
// Some raiders quit Mimic between sessions "to save on processing" (Hitya
// 2026-08-03), and they had a point about this one: everything else already
// idles hard — the 1Hz blind poll early-returns on !_eqRunning, the 300ms Zeal
// flush no-ops when no snapshot is dirty — but _checkEqRunning() SPAWNS
// tasklist.exe unconditionally. At a flat 10s that is ~8,640 process spawns a
// day on a desktop that is not even running the game, and spawn pressure is
// already why this went 5s -> 10s in the 2026-07-07 review.
//
// While EQ is up, keep 10s: overlay show/hide gating hangs off this and needs to
// feel immediate. While EQ is down, nothing is time-critical except noticing it
// come back, so ease out to 45s after a minute of absence — ~87% fewer idle
// spawns, and the worst case is overlays appearing a few seconds later on
// launch. Any transition resets to the fast cadence immediately.
const EQ_POLL_ACTIVE_MS = 10_000;
const EQ_POLL_IDLE_MS   = 45_000;
const EQ_POLL_IDLE_AFTER = 6;        // consecutive absent polls (~1 min) before easing off
let _eqAbsentStreak = 0;
let _eqPollStopped  = false;
function _eqPollDelay() {
  return (!_eqRunning && _eqAbsentStreak >= EQ_POLL_IDLE_AFTER) ? EQ_POLL_IDLE_MS : EQ_POLL_ACTIVE_MS;
}
function _startEqPolling() {
  if (_eqPollTimer || process.platform !== 'win32') return;
  _eqPollStopped = false;
  const tick = async () => {
    const before = _eqRunning;
    try { await _pollEqPresence(); } catch { /* never let a poll kill the loop */ }
    if (_eqPollStopped) { _eqPollTimer = null; return; }   // stopped mid-flight
    // Streak drives the backoff; any state change snaps back to fast polling so
    // launching EQ is picked up promptly even from a long idle.
    if (_eqRunning) _eqAbsentStreak = 0;
    else if (before === _eqRunning) _eqAbsentStreak++;
    else _eqAbsentStreak = 0;
    // Self-rescheduling: a fixed setInterval cannot change its own period.
    _eqPollTimer = setTimeout(tick, _eqPollDelay());
  };
  _eqPollTimer = setTimeout(tick, 0);
}
function _stopEqPolling() {
  // _eqPollStopped is load-bearing, not belt-and-braces: the tick awaits
  // _pollEqPresence (which spawns tasklist), so a stop landing mid-flight would
  // otherwise be undone by that tick's own reschedule and resurrect the loop.
  _eqPollStopped = true;
  if (_eqPollTimer) { clearTimeout(_eqPollTimer); _eqPollTimer = null; }
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
  const shouldShow = unlocked || _blindForceOpen('triggers') || (cfg.enableTriggerTts && cfg.showTriggerOverlay !== false && !cfg.quietMode && _eqGateOk(cfg));
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
    webPreferences: _wpPrefs('Charm tracker'),
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
    webPreferences: _wpPrefs('Pet tracker'),
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
    webPreferences: _wpPrefs('Buff queue'),
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

// PoP Raid Slideshow — encounter-by-encounter raid guide (callouts, guide
// stats, shared raid-wide objective checkboxes, hotlinked EQProgression
// diagrams, ⚑ anomaly flags). Data ships in pop-raids.js; the shared
// objective board + loot proxy through the local agent.
function createPopRaidOverlay() {
  const b = _resolveBounds('popRaidBounds', 'popRaidBoundsSig', { x: 880, y: 80, width: 440, height: 540 });
  popRaidWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — PoP raids overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 300, minHeight: 160,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: _wpPrefs('PoP raids'),
  });
  popRaidWindow.setAlwaysOnTop(true, 'screen-saver');
  popRaidWindow.setVisibleOnAllWorkspaces(true);
  popRaidWindow.loadFile('popraid.html');
  popRaidWindow.on('moved',  () => _persistBounds('popRaidBounds', popRaidWindow));
  popRaidWindow.on('resize', () => _persistBounds('popRaidBounds', popRaidWindow));
  popRaidWindow.once('ready-to-show', () => {
    popRaidWindow.webContents.send('agent-port', agentPort);
    applyPopRaidVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(popRaidWindow, 'popraid');
  });
}
function applyPopRaidVisibility() {
  if (!popRaidWindow) return;
  const cfg = loadConfig();
  const unlocked  = cfg.overlaysLocked === false;
  // Opt-in (default off) — raid leaders + anyone following the fight plan.
  const shouldShow = unlocked || (cfg.showPopRaid && !cfg.quietMode && _eqGateOk(cfg));
  if (shouldShow) popRaidWindow.showInactive(); else popRaidWindow.hide();
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
    webPreferences: _wpPrefs('Mob Info'),
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
    webPreferences: _wpPrefs('/who'),
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
    webPreferences: _wpPrefs('Melody'),
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
    webPreferences: _wpPrefs('Zeal health'),
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
// (Hitya 2026-06-25.)
function createTankOverlay() {
  const b = _resolveBounds('tankBounds', 'tankBoundsSig', { x: 40, y: 480, width: 300, height: 280 });
  tankWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Tank overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 120,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: _wpPrefs('Tank HUD'),
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
    webPreferences: _wpPrefs('Threat meter'),
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
// of the bot aggregation). Opt-in (default off); EQ-gated. (Hitya 2026-06-29.)
function createExtTargetOverlay() {
  const b = _resolveBounds('extTargetBounds', 'extTargetBoundsSig', { x: 40, y: 360, width: 320, height: 240 });
  extTargetWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Extended Target overlay',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 240, minHeight: 80,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: _wpPrefs('Extended target'),
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

// #65 Hot-servable overlays. Probe an agent-served overlay route on the local
// agent port; resolves true only on a 200. Fast + non-throwing: a short
// timeout / any error / a dead port all resolve false so the caller falls back
// to the bundled file. 127.0.0.1 only (matches the agent's bind).
function _probeAgentOverlay(pathname, timeoutMs = 900) {
  return new Promise((resolve) => {
    if (!agentPort) return resolve(false);
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const req = http.get({ host: '127.0.0.1', port: agentPort, path: pathname, timeout: timeoutMs }, (res) => {
        const ok = res.statusCode === 200;
        res.resume();   // drain so the socket frees
        finish(ok);
      });
      req.on('error',   () => finish(false));
      req.on('timeout', () => { try { req.destroy(); } catch (e) { void e; } finish(false); });
    } catch (e) { void e; finish(false); }
  });
}

// #65 Load an overlay preferring the agent-served copy (which rides the
// agent's [U] hot-swap) and falling back to the bundled file when the agent is
// down / unreachable / not answering 200 — an overlay must NEVER be blind
// because the agent is restarting (the #59 lesson). The probe is fast so the
// fallback is quick. Reload-on-recovery is intentionally OMITTED: a later
// agent recovery does not force-reload an already-open overlay mid-raid (that
// would reset scroll / local dismiss state); the file:// fallback is byte-
// identical to the served copy (drift-checked), and the next OPEN gets served.
// The window's preload applies to the http:// origin exactly as to file://, so
// window.mimic is present either way.
async function _loadOverlayPreferAgent(win, overlayPath, fallbackFile) {
  if (!win || win.isDestroyed()) return;
  let served = false;
  try { served = await _probeAgentOverlay(overlayPath); } catch (e) { void e; served = false; }
  if (win.isDestroyed()) return;
  if (served) {
    try { await win.loadURL(`http://127.0.0.1:${agentPort}${overlayPath}`); return; }
    catch (e) { void e; /* probe passed but load failed — fall through to file */ }
  }
  if (win.isDestroyed()) return;
  try { await win.loadFile(fallbackFile); } catch (e) { void e; /* last resort — nothing more to try */ }
}

// Command Center overlay — the "one window" raid board (Hitya 2026-07-03):
// boss/MT/rampage/enrage/Death Touch (same data as the Tank overlay) plus
// raid-wide DA/invuln status and healer mana parsed from raid-chat macros,
// plus Curse/Cure alerts from the buff queue. Reads /api/command-center.
// (#65) Served from the agent at /overlay/command so overlay updates ride
// agent hot-swaps; falls back to the bundled command.html when the agent is down.
function createCommandOverlay() {
  const b = _resolveBounds('commandBounds', 'commandBoundsSig', { x: 40, y: 40, width: 320, height: 360 });
  commandWindow = new BrowserWindow({
    title: 'Wolf Pack miMIC — Command Center',
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 260, minHeight: 160,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: _wpPrefs('Command center'),
  });
  commandWindow.setAlwaysOnTop(true, 'screen-saver');
  commandWindow.setVisibleOnAllWorkspaces(true);
  commandWindow.on('moved',  () => _persistBounds('commandBounds', commandWindow));
  commandWindow.on('resize', () => _persistBounds('commandBounds', commandWindow));
  commandWindow.once('ready-to-show', () => {
    commandWindow.webContents.send('agent-port', agentPort);
    applyCommandVisibility();
    applyOverlayInteractivity();
    applyOverlayOpacity(commandWindow, 'command');
  });
  // #65: prefer the agent-served /overlay/command (hot-swappable), fall back to
  // the bundled command.html when the agent is unreachable. Handlers above are
  // registered first so the async probe+load can't race ready-to-show.
  _loadOverlayPreferAgent(commandWindow, '/overlay/command', 'command.html');
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
    webPreferences: _wpPrefs('CH chain'),
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

// ── Overlay window lifecycle: create when enabled, free when not ───────────
//
// Every Electron BrowserWindow is its OWN Chromium renderer process — ~80 MB
// resident before it paints a single pixel. Boot used to create ten of them
// unconditionally, so a user running two overlays still paid for ten — around
// 800 MB of renderers for overlays that were switched OFF (Hitya measured
// the per-overlay floor at 80 MB, 2026-08-04). Windows now exist only while
// their pref says they should.
//
// The invariant everything else hangs off: **a window must exist whenever
// anything can SHOW it.** applyAllVisibility() is the funnel every visibility
// re-evaluation already runs through, so materializing at the TOP of it means
// hide-all restore, per-character profiles, class-set seeding, the EQ-presence
// flip and the unlock/placement path all get their windows without any of them
// having to know to ask. That also makes a wrong reap self-healing: the next
// apply pass builds the window back.
//
// Getters (not captured refs) because these are module-level `let`s that the
// creators reassign; the destroyers null them so a reaped entry reads as
// missing rather than as a destroyed window.
const _OVERLAY_WINDOWS = [
  { key: 'hud',       flag: 'showHud',          get: () => overlayWindow,   create: createOverlayWindow,       drop: () => { overlayWindow = null; } },
  // The trigger overlay's flag is enableTriggerTts, NOT showTriggerOverlay:
  // #97 decoupled them and TTS deliberately fires from the HIDDEN window, so
  // the visual being off must never free the renderer.
  { key: 'trigger',   flag: 'enableTriggerTts', get: () => triggerWindow,   create: createTriggerOverlay,      drop: () => { triggerWindow = null; },   blind: 'triggers' },
  { key: 'charm',     flag: 'showCharm',        get: () => charmWindow,     create: createCharmOverlay,        drop: () => { charmWindow = null; } },
  { key: 'pets',      flag: 'showPets',         get: () => petsWindow,      create: createPetsOverlay,         drop: () => { petsWindow = null; } },
  { key: 'mobinfo',   flag: 'showMobInfo',      get: () => mobInfoWindow,   create: createMobInfoOverlay,      drop: () => { mobInfoWindow = null; } },
  { key: 'buffQueue', flag: 'showBuffQueue',    get: () => buffQueueWindow, create: createBuffQueueOverlay,    drop: () => { buffQueueWindow = null; } },
  { key: 'who',       flag: 'showWho',          get: () => whoWindow,       create: createWhoOverlay,          drop: () => { whoWindow = null; } },
  { key: 'melody',    flag: 'showMelody',       get: () => melodyWindow,    create: createMelodyOverlay,       drop: () => { melodyWindow = null; } },
  { key: 'zeal',      flag: 'showZeal',         get: () => zealWindow,      create: createZealHealthOverlay,   drop: () => { zealWindow = null; } },
  { key: 'threat',    flag: 'showThreat',       get: () => threatWindow,    create: createThreatMeterOverlay,  drop: () => { threatWindow = null; } },
  { key: 'chchain',   flag: 'showChChain',      get: () => chChainWindow,   create: createChChainOverlay,      drop: () => { chChainWindow = null; } },
  { key: 'tank',      flag: 'showTank',         get: () => tankWindow,      create: createTankOverlay,         drop: () => { tankWindow = null; } },
  { key: 'exttarget', flag: 'showExtTarget',    get: () => extTargetWindow, create: createExtTargetOverlay,    drop: () => { extTargetWindow = null; } },
  { key: 'command',   flag: 'showCommand',      get: () => commandWindow,   create: createCommandOverlay,      drop: () => { commandWindow = null; } },
  { key: 'popraid',   flag: 'showPopRaid',      get: () => popRaidWindow,   create: createPopRaidOverlay,      drop: () => { popRaidWindow = null; } },
];

// True when something OTHER than the overlay's own pref can put it on screen,
// in which case its window has to exist (and must not be reaped) whatever the
// flag says.
function _overlayForcedOn(cfg, e) {
  if (setupMode) return true;                    // 🛠 place-them-all mode
  if (cfg.overlaysLocked === false) return true; // unlocked → every overlay force-shown for dragging
  if (_blindForceOpen(e.blind || e.key)) return true;
  // NOT hide-all. It looked like it belonged here — the flags are off only
  // until the hotkey flips back — but cfg.hideAllActive PERSISTS across
  // restarts, so sparing it meant a user who hid once got all fifteen
  // renderers built at every boot and never freed: the exact opposite of the
  // point. It is also unnecessary. toggleHideAllOverlays() restores the
  // snapshot into cfg and saves BEFORE calling applyAllVisibility(), so the
  // materialize pass reads the restored flags and rebuilds what was hidden.
  return false;
}

// Does this overlay need a window right now?
//
// "we have a toggle in taskbar for 'Hide Overlays when Everquest is not
// running', and we should adhere to that" (Hitya 2026-08-04). Right: an
// overlay the EQ gate is hiding has no reason to hold an ~35 MB renderer, and
// the same argument covers quiet mode. So existence tracks VISIBILITY, not just
// the pref — which is the bulk of the saving, since EQ is closed most of the
// day.
//
// One exception, and it is load-bearing: the trigger overlay. #97 has TTS
// firing from the HIDDEN window, and triggers.html polls the agent itself —
// no window, no voice. It exists whenever enableTriggerTts is on, gate or no
// gate. Reaping it would trade a missed raid callout for 35 MB while EQ is
// closed, which is precisely when nobody cares about the 35 MB.
function _overlayWanted(cfg, e) {
  if (_overlayForcedOn(cfg, e)) return true;
  if (!cfg[e.flag]) return false;
  if (e.key === 'trigger') return true;
  if (cfg.quietMode) return false;
  return _eqGateOk(cfg);
}

// Build any window whose overlay is (or can be) shown. Cheap no-op once they
// exist, so it is safe to call on every visibility pass.
function _materializeEnabledOverlays() {
  let cfg; try { cfg = loadConfig(); } catch { cfg = {}; }
  for (const e of _OVERLAY_WINDOWS) {
    if (e.get()) continue;
    if (!_overlayWanted(cfg, e)) continue;
    try { e.create(); }
    catch (err) { appendAgentLog(`[overlay] could not create ${e.key}: ${err && err.message}\n`); }
  }
}

// Free the renderer behind an overlay the user has switched off. Deliberately
// conservative: _overlayForcedOn() covers every mode that shows an overlay past
// its own pref, and a window the user is actively placing ("Setup THIS") is
// spared even though the global setupMode flag is not set for it.
function _reapDisabledOverlays() {
  let cfg; try { cfg = loadConfig(); } catch { return; }
  for (const e of _OVERLAY_WINDOWS) {
    const win = e.get();
    if (!win) continue;
    if (_overlayWanted(cfg, e)) continue;
    if (_inSingleSetup(win)) continue;
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
    e.drop();
    const why = !cfg[e.flag] ? `${e.flag} is off`
              : cfg.quietMode ? 'quiet mode'
              : 'EverQuest is not running';
    appendAgentLog(`[overlay] freed ${e.key} — ${why}\n`);
  }
}

// Convenience: refresh every overlay's visibility at once. Used by the EQ-
// presence poller (on running ↔ not-running flips) and by config toggles.
// Materialize BEFORE applying (each apply*Visibility no-ops without a window)
// and reap AFTER (so a window is only freed once it has been asked to hide).
function applyAllVisibility() {
  _materializeEnabledOverlays();
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
  applyPopRaidVisibility();
  _reapDisabledOverlays();
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
// True only when the OS actually gave us the accelerator. Windows hands a
// global shortcut to whoever asks FIRST, so Edge (Ctrl+Shift+H is one of its
// defaults) or any other app can own it and our register() silently returns
// false — the user then presses a dead key forever. Field report: Naggato
// 2026-08-07, overlays hidden, hotkey doing nothing, about to reinstall.
function _hideAllHotkeyBound() { return !!_registeredHideAccel; }
// What the tray/menu should SAY about the hotkey: the key when it works, an
// explicit warning when the OS refused it. Never show a key we don't own.
function _hideAllHotkeyMenuLabel() {
  const cfg = loadConfig();
  if (cfg && cfg.hideAllHotkeyEnabled === false) return 'hotkey off';
  if (!_hideAllAccelerator()) return 'no hotkey';
  return _hideAllHotkeyBound() ? _hideAllHotkeyLabelNow() : '⚠ hotkey blocked by another app';
}
// EVERY overlay's show flag, in one list — the old hand-written snapshot/flip
// blocks silently missed showCommand (the Command Center kept showing through
// hide-all, Hitya 2026-07-10). New overlays: add the flag HERE and it's
// covered automatically.
const _HIDEALL_FLAGS = [
  'showHud', 'enableTriggerTts', 'showCharm', 'showPets', 'showMobInfo',
  'showBuffQueue', 'showWho', 'showMelody', 'showZeal', 'showThreat',
  'showChChain', 'showTank', 'showExtTarget', 'showCommand', 'showPopRaid',
];
function toggleHideAllOverlays() {
  const cfg = loadConfig();
  if (!_hideAllActive) {
    // Snapshot + flip all off.
    _hideAllPrev = {};
    for (const f of _HIDEALL_FLAGS) { _hideAllPrev[f] = !!cfg[f]; cfg[f] = false; }
    _hideAllActive = true;
  } else if (_hideAllPrev) {
    // Restore from snapshot — respects whatever individual prefs the user
    // had when they hid. Skip restore when no snapshot exists.
    //
    // Only fills flags that are still OFF. Hiding wrote every flag false, so
    // anything reading true now was switched on BY HAND while hidden — and a
    // blanket Object.assign would quietly revert it, which looks like the
    // hotkey turning your overlay back off. Their later choice wins.
    for (const f of _HIDEALL_FLAGS) if (!cfg[f]) cfg[f] = !!_hideAllPrev[f];
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
let _registeredBackdropAccel = null;
const _DEFAULT_BACKDROP_HOTKEY = 'CommandOrControl+Shift+B';

// ── 💥 Damage-taken audio alert ────────────────────────────────────────────
// Mimic owns the durable pref (cfg.damageAlert, default false — see
// defaultConfig) and the agent owns the detection + the spoken cue. Same split
// (and the same re-assert-after-relaunch rule) as the tells-DM pause: the agent
// keeps the flag in memory only, so pushDamageAlert() runs on every flip AND
// after each (re)launch or the alert would silently revert to off.
const _DEFAULT_DAMAGE_HOTKEY = 'CommandOrControl+Shift+D';
let _registeredDamageAccel = null;
function _damageAlertAccelerator() {
  const cfg = loadConfig();
  return (cfg && typeof cfg.damageAlertHotkey === 'string' && cfg.damageAlertHotkey.trim())
    ? cfg.damageAlertHotkey.trim()
    : _DEFAULT_DAMAGE_HOTKEY;
}
function _damageAlertHotkeyLabelNow() { const a = _damageAlertAccelerator(); return a ? _fmtAccel(a) : ''; }
// Push the current pref to the local agent. `announce` asks the agent to speak
// the new state back through the trigger overlay — set for the hotkey + tray
// flips (the user isn't looking at a window) and cleared for the boot re-assert.
function pushDamageAlert(announce) {
  if (!agentPort) return;
  const cfg = loadConfig();
  const body = JSON.stringify({ enabled: !!cfg.damageAlert, announce: !!announce });
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/damage-alert', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 3000,
  }, (res) => { res.resume(); });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}
// Single writer for the pref — hotkey, tray, and the dashboard Overlays-tab
// button all land here so the dead-toggle guard below can't be bypassed.
function _applyDamageAlert(next, announce) {
  const cfg = loadConfig();
  cfg.damageAlert = !!next;
  // Dead-toggle guard. The cue rides the trigger overlay's speech path, whose
  // fire() returns early when the master "Trigger alerts (TTS)" switch is off —
  // and with that switch off the window may not even exist, so enabling the
  // damage alert would do literally nothing. Turning ON a spoken alert means
  // "speak to me", so switch the master on with it (same "turn on what it
  // needs" move the tray's own Trigger-alerts item makes). We deliberately do
  // NOT touch showTriggerOverlay: #97 decoupled the ✕ (visual) from TTS, and a
  // user who hid the visual keeps it hidden — TTS fires from the hidden window.
  // Never reverted on disable; that's the user's switch to own.
  if (cfg.damageAlert && !cfg.enableTriggerTts) {
    cfg.enableTriggerTts = true;
    appendAgentLog('[mimic] damage-taken alert on — turning on Trigger alerts (TTS), which is the path it speaks through\n');
  }
  saveConfig(cfg);
  try { if (cfg.enableTriggerTts && !triggerWindow) createTriggerOverlay(); } catch (e) { void e; }
  appendAgentLog(`[mimic] damage-taken alert ${cfg.damageAlert ? 'ENABLED' : 'disabled'}\n`);
  pushDamageAlert(announce);
  pushStatus();
}
// The hotkey + tray toggle both land here: flip, persist, push (with spoken
// confirmation), refresh the tray checkbox.
function toggleDamageAlert() { _applyDamageAlert(!loadConfig().damageAlert, true); }

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
    // Per-hotkey kill switch (dashboard Enable/Disable) — default enabled.
    if (accel && cfg.hideAllHotkeyEnabled !== false) {
      const ok = globalShortcut.register(accel, toggleHideAllOverlays);
      if (ok) _registeredHideAccel = accel;
      else appendAgentLog(`[mimic] failed to register hide-all hotkey "${accel}" (in use by another app?)\n`);
    }
    // Backdrop hotkey — flips the solid background on/off for ALL overlays at
    // once (per-overlay control lives in the right-click chrome menu).
    // Override with cfg.backdropHotkey.
    if (_registeredBackdropAccel) { try { globalShortcut.unregister(_registeredBackdropAccel); } catch {} _registeredBackdropAccel = null; }
    const bAccel = (typeof cfg.backdropHotkey === 'string' && cfg.backdropHotkey.trim()) ? cfg.backdropHotkey.trim() : _DEFAULT_BACKDROP_HOTKEY;
    if (bAccel && cfg.backdropHotkeyEnabled !== false) {
      const ok2 = globalShortcut.register(bAccel, toggleAllBackdrops);
      if (ok2) _registeredBackdropAccel = bAccel;
      else appendAgentLog(`[mimic] failed to register backdrop hotkey "${bAccel}" (in use by another app?)\n`);
    }
    // 💥 Damage-taken alert hotkey — same shape as the two above: configurable
    // accelerator (cfg.damageAlertHotkey), per-hotkey kill switch, and a log
    // line when the OS refuses the binding because another app owns it.
    if (_registeredDamageAccel) { try { globalShortcut.unregister(_registeredDamageAccel); } catch {} _registeredDamageAccel = null; }
    const dAccel = _damageAlertAccelerator();
    if (dAccel && cfg.damageAlertHotkeyEnabled !== false) {
      const ok3 = globalShortcut.register(dAccel, toggleDamageAlert);
      if (ok3) _registeredDamageAccel = dAccel;
      else appendAgentLog(`[mimic] failed to register damage-alert hotkey "${dAccel}" (in use by another app?)\n`);
    }
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
    showPopRaid: !!cfg.showPopRaid,
    // 💥 Damage-taken audio alert — drives the tray checkbox (and is available
    // to any renderer that wants to show the state). Default off.
    damageAlert: !!cfg.damageAlert,
    overlayTheme: cfg.overlayTheme || 'default',
    overlaysLocked: cfg.overlaysLocked !== false,
    // Hide-all flips every show* flag to false, which makes "I turned this off"
    // and "the hotkey hid this" look identical everywhere — the dashboard, the
    // tray, this payload (Hitya 2026-08-04: "we should be able to see in the
    // overlays section which ones were previously off but are hidden").
    // Shipping the snapshot alongside the flags lets a UI tell them apart:
    // flag false + hideAllPrev[flag] true means HIDDEN, and it is coming back.
    hideAllActive: !!_hideAllActive,
    hideAllPrev: (_hideAllActive && _hideAllPrev) ? { ..._hideAllPrev } : null,
    setupMode: !!setupMode,
    onboarded: !!cfg.onboarded,
    updatePending: updatePending ? updatePending.version : null,
    // #74 Part 3 — "reverted to last-known-good" notice (shown ~30 min after a
    // crash-loop auto-rollback so the dashboard/settings can surface it).
    lkgReverted: _lkgReverted && (Date.now() - _lkgReverted.at < 30 * 60_000) ? _lkgReverted : null,
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
      // The code-prefilled variant, so the manual "Open page" retry lands the
      // user on the same URL the automatic launch would have.
      verification_url_complete: _linkInFlight._pub.verification_url_complete || null,
      // null = still launching, true = opened, false = the OS refused. Settings
      // shows the "open it yourself" hint only on false.
      browser_opened:   _linkInFlight._pub.browser_opened ?? null,
      browser_error:    _linkInFlight._pub.browser_error || null,
      expires_at:       _linkInFlight._pub.expires_at,
    } : null,
  };
}
function pushStatus() {
  const s = Object.assign(currentStatus(), hideAllStatusForRenderer());
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
  // Overlays hidden outranks the normal tooltip: when every overlay is gone
  // the tray icon is the ONLY Mimic surface left, and "nothing is showing" is
  // indistinguishable from "Mimic is broken" without this line.
  if (_hideAllActive) {
    return `⚠ Wolf Pack miMIC ${v} — OVERLAYS HIDDEN · right-click → Show overlays`
      + (_hideAllHotkeyBound() ? '' : ' (hotkey blocked by another app)');
  }
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
        if (mi.checked && !overlayWindow) createOverlayWindow(); else applyOverlayVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Trigger alerts (TTS)', type: 'checkbox', checked: s.enableTriggerTts, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.enableTriggerTts = mi.checked;
        if (mi.checked) cfg.showTriggerOverlay = true;   // turning on → show the visual too (#97)
        saveConfig(cfg);
        if (mi.checked && !triggerWindow) createTriggerOverlay(); else applyTriggerVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Charm tracker', type: 'checkbox', checked: s.showCharm, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showCharm = mi.checked; saveConfig(cfg);
        if (mi.checked && !charmWindow) createCharmOverlay(); else applyCharmVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Pet tracker (summoned pets)', type: 'checkbox', checked: s.showPets, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showPets = mi.checked; saveConfig(cfg);
        if (mi.checked && !petsWindow) createPetsOverlay(); else applyPetsVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Target Info (target stats)', type: 'checkbox', checked: s.showMobInfo, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showMobInfo = mi.checked; saveConfig(cfg);
        if (mi.checked && !mobInfoWindow) createMobInfoOverlay(); else applyMobInfoVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Buff queue (raid gaps + cures)', type: 'checkbox', checked: s.showBuffQueue, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showBuffQueue = mi.checked; saveConfig(cfg);
        if (mi.checked && !buffQueueWindow) createBuffQueueOverlay(); else applyBuffQueueVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: '/who (zone roster)', type: 'checkbox', checked: s.showWho, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showWho = mi.checked; saveConfig(cfg);
        if (mi.checked && !whoWindow) createWhoOverlay(); else applyWhoVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Casting tracker (melody on bards, spells otherwise)', type: 'checkbox', checked: s.showMelody, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showMelody = mi.checked; saveConfig(cfg);
        if (mi.checked && !melodyWindow) createMelodyOverlay(); else applyMelodyVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: '  ↳ Only show on bard characters', type: 'checkbox', checked: s.melodyBardOnly, enabled: !s.quietMode && s.showMelody, click: (mi) => {
        const cfg = loadConfig(); cfg.melodyBardOnly = mi.checked; saveConfig(cfg);
        pushStatus();
      } },
    { label: 'Zeal health (diagnostic)', type: 'checkbox', checked: s.showZeal, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showZeal = mi.checked; saveConfig(cfg);
        if (mi.checked && !zealWindow) createZealHealthOverlay(); else applyZealVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Threat meter', type: 'checkbox', checked: s.showThreat, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showThreat = mi.checked; saveConfig(cfg);
        if (mi.checked && !threatWindow) createThreatMeterOverlay(); else applyThreatVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Tank HUD (DS, buffs, DA, rampage)', type: 'checkbox', checked: s.showTank, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showTank = mi.checked; saveConfig(cfg);
        if (mi.checked && !tankWindow) createTankOverlay(); else applyTankVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'CH chain', type: 'checkbox', checked: s.showChChain, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showChChain = mi.checked; saveConfig(cfg);
        if (mi.checked && !chChainWindow) createChChainOverlay(); else applyChChainVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Extended Target (raid-wide targets)', type: 'checkbox', checked: s.showExtTarget, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showExtTarget = mi.checked; saveConfig(cfg);
        if (mi.checked && !extTargetWindow) createExtTargetOverlay(); else applyExtTargetVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'Command Center (one-window raid board)', type: 'checkbox', checked: s.showCommand, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showCommand = mi.checked; saveConfig(cfg);
        if (mi.checked && !commandWindow) createCommandOverlay(); else applyCommandVisibility(); _reapDisabledOverlays();
        pushStatus();
      } },
    { label: 'PoP raids (encounter slideshow)', type: 'checkbox', checked: s.showPopRaid, enabled: !s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.showPopRaid = mi.checked; saveConfig(cfg);
        if (mi.checked && !popRaidWindow) createPopRaidOverlay(); else applyPopRaidVisibility(); _reapDisabledOverlays();
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
    { label: _hideAllActive ? '👁 Show overlays (' + _hideAllHotkeyMenuLabel() + ')' : '🙈 Hide all overlays (' + _hideAllHotkeyMenuLabel() + ')',
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
    : { label: 'Check for updates…',
        // Manual check covers BOTH update channels — the Electron shell AND
        // the agent hot-swap (Hitya 2026-07-16: "check for updates also
        // check for newer agents rather than waiting for 30 minutes"). The
        // dashboard header's update button already did both via the
        // check-for-updates IPC; the tray item was shell-only.
        click: () => { safeCheckForUpdates(true); checkAgentUpdate({ manual: true }); },
        enabled: !!autoUpdater };
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
      if (cfg.betaChannel) delete cfg.forceStable;   // re-opting into betas lifts a stable pin
      saveConfig(cfg);
      if (autoUpdater) {
        _applyUpdaterChannel();
        appendAgentLog(`[updater] beta channel ${cfg.betaChannel ? 'enabled' : 'disabled'} — checking…\n`);
        safeCheckForUpdates(true);
      }
      pushStatus();
    },
  };
  // Revert-to-stable — only offered while the beta track is actually in
  // effect (beta build or opt-in, and not already pinned to stable).
  const _revertEligible = !!autoUpdater
    && loadConfig().forceStable !== true
    && (/-/.test(String(app.getVersion() || '')) || loadConfig().betaChannel === true);
  const revertStableItem = {
    label: '↩ Revert to stable…',
    visible: _revertEligible,
    click: async () => {
      const res = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Revert to stable', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Wolf Pack miMIC — revert to stable',
        message: 'Switch back to the stable release?',
        detail: 'Mimic will download the current stable build and install it on your next restart. Your settings, overlays, and login are untouched. You can rejoin the beta any time from this menu.',
      });
      if (res.response === 0) revertToStable('tray');
    },
  };
  // Crash-report sharing — OPT-IN, default off. When on, the agent watches
  // the EQ folder's Zeal crashes/ directory and uploads parsed crash_reason
  // metadata + a system snapshot (GPU, client-DLL fingerprints) to the guild
  // DB so crash clusters can be compared across users. The minidump itself
  // NEVER leaves the machine. Flag reaches the agent as an env var at spawn,
  // so toggling restarts the agent (same auto-relaunch path as Restart agent).
  const crashReportsItem = {
    label: 'Share crash reports with the guild (opt-in)',
    type: 'checkbox',
    checked: loadConfig().crashReports === true,
    click: (mi) => {
      const cfg = loadConfig();
      cfg.crashReports = !!mi.checked;
      saveConfig(cfg);
      appendAgentLog(`[mimic] crash-report sharing ${cfg.crashReports ? 'ENABLED — dumps stay local; only crash metadata uploads' : 'disabled'}; restarting agent\n`);
      if (agentProc) { try { agentProc.kill(); } catch {} } else { launchAgent(); }
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
    // Multi-monitor rescue — run from the tray on the monitor you play on;
    // every overlay gathers there and auto-arranges (Hitya 2026-07-15:
    // "lost several overlays off my window and cannot find them").
    { label: '🧲 Rescue overlays to this screen', click: () => {
        try { _rescueOverlays(); } catch (e) { appendAgentLog('[rescue] failed: ' + e.message + '\n'); }
      } },
    { label: 'I use EQLogParser / other parser (Quiet mode)', type: 'checkbox', checked: s.quietMode, click: (mi) => {
        const cfg = loadConfig(); cfg.quietMode = mi.checked; saveConfig(cfg);
        applyAllVisibility();
        pushStatus();
      } },
    // 💥 Damage-taken audio alert — top level (not the Overlays submenu): it's
    // an audio cue, not an overlay, and "toggleable from the taskbar" (Hitya)
    // means one click from the tray. Label carries the live hotkey so the
    // binding is discoverable without opening the dashboard. Disabled under
    // Quiet mode because the trigger overlay stays silent there anyway.
    { label: '💥 Damage-taken alert (' + (_damageAlertHotkeyLabelNow() || 'no hotkey') + ')',
      type: 'checkbox', checked: !!s.damageAlert, enabled: !s.quietMode,
      click: () => { toggleDamageAlert(); } },
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
    { label: 'Resource use — what Mimic costs this machine', click: () => openResources() },
    updatePopupItem,
    betaChannelItem,
    revertStableItem,
    crashReportsItem,
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
        appendAgentLog('[mimic] tray "Restart agent" clicked\n');
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
// feedback (Hitya 2026-07-03: "the check for update doesn't look like
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

// Snapshot the CURRENT working agent as last-known-good (before we overwrite it
// in a hot-swap). Best-effort — a copy failure just means no LKG this round.
function _saveAgentLkg() {
  try {
    const dir = AGENT_DIR();
    const idx = path.join(dir, 'index.js');
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(idx)) fs.copyFileSync(idx, path.join(dir, 'index.lkg.js'));
    if (fs.existsSync(pkg)) fs.copyFileSync(pkg, path.join(dir, 'package.lkg.json'));
    return true;
  } catch (e) { appendAgentLog(`[mimic] warn: could not snapshot LKG agent: ${e && e.message}\n`); return false; }
}
// Restore the last-known-good agent over the (crash-looping) current one.
// Returns the LKG version on success, or null when there is no LKG / restore failed.
function _restoreAgentLkg() {
  const dir = AGENT_DIR();
  const lkgIdx = path.join(dir, 'index.lkg.js');
  const lkgPkg = path.join(dir, 'package.lkg.json');
  if (!fs.existsSync(lkgIdx)) return null;
  let lkgVer = null;
  try { lkgVer = JSON.parse(fs.readFileSync(lkgPkg, 'utf8')).version || null; } catch { /* keep null */ }
  try {
    fs.copyFileSync(lkgIdx, path.join(dir, 'index.js'));
    if (fs.existsSync(lkgPkg)) fs.copyFileSync(lkgPkg, path.join(dir, 'package.json'));
    return lkgVer || 'unknown';
  } catch (e) { appendAgentLog(`[mimic] ERROR: LKG restore failed: ${e && e.message}\n`); return null; }
}
function _notifyLkgRevert(badVer, lkgVer) {
  try {
    if (tray && typeof tray.displayBalloon === 'function') {
      tray.displayBalloon({
        title: 'Wolf Pack Mimic — agent reverted',
        content: `The v${badVer || '?'} agent crash-looped; reverted to last-known-good v${lkgVer}. It won't be re-offered until a newer build ships.`,
      });
    }
  } catch { /* balloons are best-effort (Windows-only) */ }
}
function _notifyAgentCrashLoop() {
  try {
    if (tray && typeof tray.displayBalloon === 'function') {
      tray.displayBalloon({
        title: 'Wolf Pack Mimic — agent unstable',
        content: 'The agent is restarting repeatedly. Open the dashboard → Zeal health / diagnostics. Restarts are backing off automatically.',
      });
    }
  } catch { /* best-effort */ }
}

async function checkAgentUpdate(opts) {
  const manual = !!(opts && opts.manual);
  if (_agentUpdateInFlight) return;
  // #74 Part 4 — per-channel hot-swap. Beta builds (prerelease `-` in the build
  // version) now hot-swap along the BETA agent line via `?channel=beta` instead
  // of waiting for a full electron-updater beta installer; stable builds keep the
  // main-line manifest. This is safe ONLY because the fleet kill switch (#74 Part
  // 2) + the LKG crash-loop rollback below are the gates that catch a bad beta
  // agent (the four-gate rule). Was: beta builds skipped the hot-swap entirely.
  const isBetaBuild = /-/.test(String(app.getVersion() || ''));
  _agentUpdateInFlight = true;
  try {
    const cfg = loadConfig();
    const base = _botBaseUrl(cfg);
    let manifest;
    const _authToken = resolveUploadToken(cfg);
    const manifestUrl = `${base}/api/agent/latest-version${isBetaBuild ? '?channel=beta' : ''}`;
    try {
      manifest = await _httpsJson(manifestUrl,
        _authToken ? { headers: { 'Authorization': 'Bearer ' + _authToken } } : {});
    } catch (e) { return; }  // bot unreachable — try again next cycle
    const latest = manifest && manifest.latest_agent_version;
    const url    = manifest && manifest.url;
    const sha    = manifest && manifest.sha256;
    if (!latest || !url) return;

    // #74 Part 3 — don't re-offer a version that just crash-looped and was
    // reverted, until a strictly NEWER build appears (which clears the block).
    if (_blacklistedAgentVersion) {
      if (_agentVersionNewer(latest, _blacklistedAgentVersion)) {
        appendAgentLog(`[mimic] agent update: newer build v${latest} supersedes blacklisted v${_blacklistedAgentVersion}; clearing blacklist\n`);
        _blacklistedAgentVersion = null;
      } else {
        if (manual) appendAgentLog(`[mimic] manual agent check: v${latest} is blacklisted (crash-looped) — not re-offering until a newer build ships\n`);
        return;
      }
    }

    const current = _readAgentVersion();
    if (!_agentVersionNewer(latest, current)) {
      if (manual) appendAgentLog(`[mimic] manual agent check: current (installed ${current}, latest ${latest})\n`);
      return;  // already current/ahead
    }

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
    // #74 Part 3 — snapshot the CURRENT working agent as last-known-good BEFORE
    // we overwrite it, so a crash-loop on the new version can auto-revert.
    _saveAgentLkg();
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

    // #74 Part 3 — the swapped-in version is now ON TRIAL: mark the swap so the
    // exit handler can auto-revert to LKG if it crash-loops. Cleared once it runs
    // stable for 30s (the 30s-post-launch timer), or on a revert.
    _agentSwapAt = Date.now();
    _agentSwapToVersion = latest;
    _recentExits = [];
    appendAgentLog(`[mimic] agent updated to ${latest}; restarting child (window stays up) — on trial, auto-reverts to LKG if it crash-loops\n`);
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
  const cfg = loadConfig();
  const _buildIsBeta = /-/.test(String(app.getVersion() || ''));
  // forceStable (Hitya 2026-07-16: raid-night testers stuck on beta could
  // not get back to the stable release everyone else was fixed by): an
  // explicit "revert to stable" overrides even the installed-a-beta-build
  // input, and allowDowngrade lets electron-updater install a stable whose
  // semver is BELOW the running prerelease (its default refuses that, which
  // is exactly the trap). Cleared automatically once a stable build is
  // running, or when the user re-opts into betas.
  const forceStable  = cfg.forceStable === true;
  const userOptedIn  = !!cfg.betaChannel;
  const wantBeta     = !forceStable && (_buildIsBeta || userOptedIn);
  autoUpdater.allowPrerelease = wantBeta;
  autoUpdater.channel         = wantBeta ? 'beta' : 'latest';
  autoUpdater.allowDowngrade  = forceStable && _buildIsBeta;
  return wantBeta;
}

// Revert to stable — one action that pins the channel to stable, permits the
// semver downgrade, and checks immediately. The downloaded stable installs
// exactly like any update (quietly on next quit, or "Restart now" from the
// tray). Reachable from the tray, the manual-check dialog, and the dashboard
// header's link next to the BETA badge.
async function revertToStable(source) {
  const cfg = loadConfig();
  cfg.forceStable = true;
  cfg.betaChannel = false;
  saveConfig(cfg);
  appendAgentLog(`[updater] revert to stable requested (${source || 'unknown'}) — pinning channel to stable and checking…\n`);
  _applyUpdaterChannel();
  safeCheckForUpdates(true);
  pushStatus();
}

function wireAutoUpdater() {
  if (!autoUpdater) return;
  // A forceStable pin has done its job once a stable build is running —
  // clear it so future channel choices start from a clean slate.
  try {
    if (!/-/.test(String(app.getVersion() || '')) && loadConfig().forceStable === true) {
      const cfg = loadConfig();
      delete cfg.forceStable;
      saveConfig(cfg);
      appendAgentLog('[updater] stable build running — revert-to-stable pin cleared\n');
    }
  } catch (e) { void e; }
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
      // On the beta track, "up to date" is exactly where a tester lands when
      // they actually want the STABLE build (Hitya 2026-07-16: beta users
      // needed last night's stable release and had no way back) — offer the
      // way back right here.
      const _onBetaTrack = /-/.test(String(app.getVersion() || '')) || loadConfig().betaChannel === true;
      if (_onBetaTrack && loadConfig().forceStable !== true) {
        dialog.showMessageBox({
          type: 'info',
          buttons: ['OK', '↩ Revert to stable'],
          defaultId: 0,
          cancelId: 0,
          message: `You're up to date (v${app.getVersion()}).`,
          detail: 'You are on the beta track. If you need the stable release instead, revert below — it installs on your next restart and you can rejoin the beta any time.',
        }).then(({ response }) => { if (response === 1) revertToStable('up-to-date dialog'); });
      } else {
        dialog.showMessageBox({ type: 'info', message: `You're up to date (v${app.getVersion()}).` });
      }
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
// 15 min (was 30 — the 2026-07-15 raid-night hotfix took most of an hour to
// reach the fleet; the fight-live/queue-pending gate already protects raids,
// so a tighter poll only speeds up the calm-moment swaps). checkAgentUpdate
// is a no-op when already current.
function scheduleAgentUpdates() {
  setTimeout(() => { checkAgentUpdate(); }, 45 * 1000);
  setInterval(() => { checkAgentUpdate(); }, 15 * 60 * 1000);
}

// ── IPC ─────────────────────────────────────────────────────────────────────
// Manual overlay drag — the renderer signals start/end when its ✥ handle
// button gets mousedown'd. We track cursor via screen.getCursorScreenPoint
// at 60fps and apply setBounds; this bypasses Chromium's broken
// app-region drag hit-test on transparent (WS_EX_LAYERED) windows.
ipcMain.handle('overlay-drag-start', (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.__wpPreMenuBounds = null;   // drag supersedes the menu-grow stash
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
    // Grow-upward mode (Hitya 2026-07-11, asked for Extended Target): the
    // BOTTOM edge stays anchored and the top moves — for overlays parked
    // near the bottom of the screen, where growing downward runs off-screen.
    // Per-overlay opt-in via the right-click chrome menu (cfg.overlayGrowUp).
    // If the chrome menu temporarily grew this window (ensure-min-height),
    // anchor against the STASHED pre-grow bounds instead of the grown ones —
    // otherwise the re-fit would treat the artificially extended edge as the
    // real one and relocate the overlay.
    const stash = win.__wpPreMenuBounds;
    const stashFresh = !!(stash && (Date.now() - stash.at) < 60_000);
    win.__wpPreMenuBounds = null;
    const growsUp = _overlayGrowsUp(win);
    let y = bounds.y;
    let clampedAtTop = false;
    if (growsUp) {
      const anchorBottom = stashFresh ? (stash.y + stash.height) : (bounds.y + bounds.height);
      const wantY = anchorBottom - target;
      y = Math.max(disp.workArea.y, wantY);
      clampedAtTop = y > wantY;   // couldn't grow up any further — hit the screen top
    } else if (stashFresh) {
      y = stash.y;
    }
    // Temporary grow-up diagnostic (Hitya 2026-07-13 "grows downward"): one
    // line per resize while grow-up is enabled, so a live repro shows whether
    // the branch fired and whether it clamped at the screen top (= overlay is
    // parked too high to grow up). Remove once confirmed.
    if (growsUp) {
      let key = null; for (const [k, w] of _overlayEntries()) if (w === win) { key = k; break; }
      appendAgentLog(`[grow-up] ${key} h ${bounds.height}->${target} y ${bounds.y}->${y}${clampedAtTop ? ' CLAMPED-AT-TOP(no room above)' : ''} workAreaY=${disp.workArea.y}\n`);
    }
    win.setBounds({ x: bounds.x, y, width: bounds.width, height: target });
    return true;
  } catch { return false; }
});

// Does this overlay grow upward (bottom-anchored auto-height)?
function _overlayGrowsUp(win) {
  try {
    let key = null;
    for (const [k, w] of _overlayEntries()) if (w === win) { key = k; break; }
    if (!key) return false;
    const cfg = loadConfig();
    return !!((cfg.overlayGrowUp && typeof cfg.overlayGrowUp === 'object') ? cfg.overlayGrowUp[key] : false);
  } catch { return false; }
}

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
    const target = Math.min(maxH, wanted);
    // Stash the REAL (pre-grow) bounds so the post-menu re-fit anchors
    // against them, not the temporarily grown edges. Without this, toggling
    // ⬆ Grow upward from the menu bottom-anchored the re-fit to the grown
    // window's extended bottom and teleported the overlay far south
    // (Hitya 2026-07-11). Consumed by the next overlay-auto-height.
    if (!win.__wpPreMenuBounds) {
      win.__wpPreMenuBounds = { x: b.x, y: b.y, width: b.width, height: b.height, at: Date.now() };
    }
    // Grow-upward overlays sit near the bottom edge — extending downward
    // would push the menu off-screen, so anchor the bottom here too.
    let y = b.y;
    if (_overlayGrowsUp(win)) y = Math.max(disp.workArea.y, b.y + b.height - target);
    win.setBounds({ x: b.x, y, width: b.width, height: target });
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
      cfg.enableTriggerTts = !cfg.enableTriggerTts;
      if (cfg.enableTriggerTts) cfg.showTriggerOverlay = true;   // turning on → show the visual too (#97)
      saveConfig(cfg);
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
    case 'popraid':
      cfg.showPopRaid = !cfg.showPopRaid; saveConfig(cfg);
      if (cfg.showPopRaid && !popRaidWindow) createPopRaidOverlay(); else applyPopRaidVisibility();
      break;
    default:
      return null;
  }
  // Auto-arrange on toggle REMOVED (Hitya 2026-07-12, 1.7.4-beta.2 test:
  // "take out that automatic movement — it's very disruptive"). Turning an
  // overlay on/off never moves anything; arranging is manual-only via the
  // right-click ✨ Auto-arrange item.
  // Toggling OFF should hand the ~80 MB renderer back now, not at the next
  // EQ-presence flip. Deferred a tick so this handler answers the dashboard
  // first (currentStatus reads config, never window existence).
  setImmediate(() => { try { _reapDisabledOverlays(); } catch { /* never break the toggle */ } });
  pushStatus();
  return currentStatus();
});

// ── Overlay chrome-menu IPC (auto-arrange / backdrop / menu state) ───────────
ipcMain.handle('auto-arrange-overlays', () => {
  try { return _autoArrangeOverlays(); } catch (e) { return { error: e.message }; }
});
// 🧲 Rescue — gather every overlay onto the display under the cursor (the
// monitor the user is looking at when they click the button), stamp it as
// the overlay HOME display, and auto-arrange there. The fix for "I've lost
// overlays somewhere on my other monitors" (Hitya 2026-07-15).
ipcMain.handle('rescue-overlays', () => {
  try { return _rescueOverlays(); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('auto-arrange-onshow-toggle', () => {
  const cfg = loadConfig();
  cfg.autoArrangeOnShow = !cfg.autoArrangeOnShow;
  saveConfig(cfg);
  return !!cfg.autoArrangeOnShow;
});
// State for the right-click chrome menu — which overlay this window is, its
// backdrop flag, and the arrange-on-show setting (labels reflect state).
ipcMain.handle('wp-overlay-menu-state', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let key = null;
  for (const [k, w] of _overlayEntries()) if (w === win) { key = k; break; }
  const cfg = loadConfig();
  return {
    key,
    backdrop: key ? !!((cfg.overlayBackdrop || {})[key]) : false,
    arrangeOnShow: !!cfg.autoArrangeOnShow,
    growUp: key ? !!((cfg.overlayGrowUp || {})[key]) : false,
    theme: cfg.overlayTheme || 'default',
  };
});
// Overlay color theme — one global setting for every overlay window, applied
// renderer-side as a body-level CSS filter (see preload _WP_THEME_CSS). The
// chrome-menu item cycles through the list; new windows pick the theme up
// from their wp-overlay-menu-state pull at load.
const _WP_THEMES = ['default', 'light', 'bright', 'soft', 'contrast'];
// Global opacity — one slider on the dashboard drives every overlay. Writes
// cfg.overlayOpacity for ALL known keys (so windows opened later inherit it)
// and re-applies to the live set.
const _ALL_OVERLAY_KEYS = ['hud','trigger','charm','pets','mobinfo','buffQueue','who','melody','zeal','threat','chchain','tank','exttarget','command','popraid'];
ipcMain.handle('wp-opacity-all', (_e, v) => {
  const val = Math.max(0.15, Math.min(1, +v || 1));
  const cfg = loadConfig();
  const map = (cfg.overlayOpacity && typeof cfg.overlayOpacity === 'object') ? cfg.overlayOpacity : {};
  for (const k of _ALL_OVERLAY_KEYS) map[k] = val;
  for (const [k] of _overlayEntries()) map[k] = val;   // panels + anything new
  cfg.overlayOpacity = map;
  saveConfig(cfg);
  applyAllOverlayOpacities();
  return val;
});
// Direct theme set (dashboard Overlays-tab picker) — same broadcast path.
// All-overlay backdrop flip — same as the Ctrl+Shift+B hotkey.
ipcMain.handle('wp-backdrop-toggle-all', () => { try { toggleAllBackdrops(); return true; } catch { return false; } });
ipcMain.handle('wp-theme-set', (_e, theme) => {
  if (!_WP_THEMES.includes(theme)) return false;
  const cfg = loadConfig();
  cfg.overlayTheme = theme;
  saveConfig(cfg);
  for (const [, win] of _overlayEntries()) {
    try { win.webContents.send('wp-theme', theme); } catch { /* mid-close */ }
  }
  pushStatus();
  return theme;
});
ipcMain.handle('wp-theme-cycle', () => {
  const cfg = loadConfig();
  const cur = _WP_THEMES.indexOf(cfg.overlayTheme || 'default');
  const next = _WP_THEMES[(cur + 1) % _WP_THEMES.length];
  cfg.overlayTheme = next;
  saveConfig(cfg);
  for (const [, win] of _overlayEntries()) {
    try { win.webContents.send('wp-theme', next); } catch { /* window mid-close */ }
  }
  return next;
});
// Per-overlay grow-upward toggle (bottom-anchored auto-height). Flipping it
// on immediately re-anchors: the window keeps its current bounds, and the
// next auto-height call moves the top edge instead of the bottom.
ipcMain.handle('wp-growup-toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let key = null;
  for (const [k, w] of _overlayEntries()) if (w === win) { key = k; break; }
  if (!key) return false;
  const cfg = loadConfig();
  const map = (cfg.overlayGrowUp && typeof cfg.overlayGrowUp === 'object') ? cfg.overlayGrowUp : {};
  map[key] = !map[key];
  cfg.overlayGrowUp = map;
  saveConfig(cfg);
  return !!map[key];
});
ipcMain.handle('wp-backdrop-toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let key = null;
  for (const [k, w] of _overlayEntries()) if (w === win) { key = k; break; }
  if (!key) return false;
  const cfg = loadConfig();
  const map = (cfg.overlayBackdrop && typeof cfg.overlayBackdrop === 'object') ? cfg.overlayBackdrop : {};
  map[key] = !map[key];
  cfg.overlayBackdrop = map;
  saveConfig(cfg);
  applyOverlayBackdrop(win, key);
  return !!map[key];
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
    _exitSingleSetup(win);   // (#116) never leave setup chrome on a hidden overlay
    const cfg = loadConfig();
    if (win === overlayWindow) {
      cfg.showHud = false; saveConfig(cfg);
      try { overlayWindow.hide(); } catch {}
    } else if (win === triggerWindow) {
      // #97: hide the VISUAL only — TTS/callouts keep firing from the hidden
      // window (enableTriggerTts untouched). Re-show via tray → Overlays.
      cfg.showTriggerOverlay = false; saveConfig(cfg);
      try { triggerWindow.hide(); } catch {}
      try { buildTrayMenu(); } catch {}
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
    } else if (win === popRaidWindow) {
      cfg.showPopRaid = false; saveConfig(cfg);
      try { popRaidWindow.hide(); } catch {}
    } else {
      for (const [key, w] of panelOverlays.entries()) {
        if (w === win) { try { w.close(); } catch {} panelOverlays.delete(key); break; }
      }
    }
    // ✕ means "I'm done with this one" — free its renderer. Deferred a tick so
    // this handler returns to the (possibly reaped) sender before it goes away.
    // The trigger overlay is untouched here on purpose: ✕ clears
    // showTriggerOverlay only, and TTS keeps firing from the hidden window (#97).
    setImmediate(() => { try { _reapDisabledOverlays(); } catch { /* never break hide */ } });
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
  // SKIP the speculative pass when a configured folder already answers the
  // question (Hitya 2026-08-04: 20383ms, then 21027ms, hint A:\EQ).
  //
  // The `null` hint is the DISCOVERY pass — 20 hard-coded default paths across
  // drives A: through F:. Probing a drive letter that is not present, or is
  // mapped to something offline, is exactly the operation Windows is slowest to
  // fail: this user's 26-directory scan took TWENTY SECONDS, on the main
  // process, freezing every window. And it ran on every scan even though their
  // EQ folder was already configured and valid, so all twenty probes were
  // asking a question we had already answered.
  //
  // Discovery still runs for someone with nothing configured — which is exactly
  // when a slow first scan is acceptable, because there is no faster answer to
  // be had.
  const configuredWorks = hints.some(h => { try { return _dirHasEqLogs(h); } catch { return false; } });
  const passes = configuredWorks ? hints : [...hints, null];
  const merged = { scanned: [], found: [], skippedDiscovery: configuredWorks };
  const seen = new Set();
  for (const h of passes) {
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
  // Re-bind the global hotkeys if the user changed any binding OR enable
  // flag (2026-07-12: backdropHotkey saves were ignored until restart —
  // only hideAllHotkey was in this condition).
  const HOTKEY_KEYS = ['hideAllHotkey', 'backdropHotkey', 'hideAllHotkeyEnabled', 'backdropHotkeyEnabled',
    'damageAlertHotkey', 'damageAlertHotkeyEnabled'];
  if (incoming && HOTKEY_KEYS.some(k => Object.prototype.hasOwnProperty.call(incoming, k))) {
    try { registerHideAllHotkey(); } catch {}
  }
  // 💥 Damage-taken alert flipped from the dashboard Overlays tab — route it
  // through the same single writer the hotkey/tray use so the dead-toggle
  // guard runs and the agent gets the push + spoken confirmation.
  if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'damageAlert')) {
    try { _applyDamageAlert(!!merged.damageAlert, true); } catch {}
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
    if (merged.showPopRaid      && !popRaidWindow)   createPopRaidOverlay();
  } catch (e) { void e; }
  applyOverlayVisibility(); applyTriggerVisibility(); applyCharmVisibility(); applyPetsVisibility(); applyMobInfoVisibility(); applyBuffQueueVisibility(); applyWhoVisibility(); applyMelodyVisibility(); applyZealVisibility(); applyThreatVisibility(); applyChChainVisibility(); applyTankVisibility(); applyExtTargetVisibility(); applyCommandVisibility(); applyPopRaidVisibility(); applyOverlayInteractivity();
  // Sync autostart-with-Windows with the saved pref. No-op on non-Windows;
  // on Windows this writes/removes the HKCU\…\Run registry entry via
  // setLoginItemSettings — no UAC, no admin rights.
  applyAutoStart();
  pushStatus();
  if (tokenChanged) {
    pushMimicSession();
    appendAgentLog('[mimic] token pasted in Settings — restarting agent to apply it\n');
    if (agentProc) { try { agentProc.kill(); } catch (e) { void e; } }
    else { await launchAgent(); }
  }
  return true;
});
// Lock / unlock overlays — pure window op, NEVER restarts the agent.
ipcMain.handle('set-overlays-locked', (_e, locked) => {
  const cfg = loadConfig(); cfg.overlaysLocked = !!locked; saveConfig(cfg);
  // An explicit lock means "done positioning" — clear any single-overlay setup
  // so the 🔒 button tears its setup chrome down too (#116). Without this,
  // applyOverlayInteractivity() skips single-setup windows and their unlocked
  // chrome stays on screen.
  if (locked) _exitAllSingleSetup();
  applyOverlayInteractivity();
  pushStatus();
  return currentStatus();
});
ipcMain.handle('get-agent-port', () => agentPort);
// "Set up for me" from Settings — bridge to the agent's single writer
// (POST /api/eq-setup → _applyEqSetup). Routed through main (Node, no CORS) so
// Settings can READ the full result (incl. the "EQ is running" warning); a raw
// file:// fetch can't read the cross-origin body. Same writer the dashboard
// button uses — one source of truth for the eqclient.ini/zeal.ini changes.
ipcMain.handle('eq-setup-for-me', () => new Promise((resolve) => {
  if (!agentPort) return resolve({ ok: false, message: 'The parser engine is not running yet — open the dashboard once, then try again.' });
  const req = http.request({
    host: '127.0.0.1', port: agentPort, path: '/api/eq-setup', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': 0 }, timeout: 8000,
  }, (res) => {
    let buf = '';
    res.on('data', (c) => { buf += c; });
    res.on('end', () => {
      try { resolve(JSON.parse(buf)); }
      catch { resolve({ ok: false, message: 'Unexpected response from the engine.' }); }
    });
  });
  req.on('error', (e) => resolve({ ok: false, message: 'Could not reach the engine: ' + (e && e.message || e) }));
  req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: 'The engine did not respond in time.' }); });
  req.end();
}));
ipcMain.handle('relaunch-agent', async () => {
  appendAgentLog('[mimic] relaunch-agent requested by a renderer (Settings/Setup save)\n');
  if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); }
  return true;
});
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
  // First-boot pretty-place (pretty-place phase 2): if onboarding enabled any
  // overlays, pack them into the free space around the player's in-game
  // windows instead of leaving them at the stacked defaults. mark-onboarded
  // fires exactly once per install, so existing setups can never be touched.
  // (Class-set seeding runs its own arrange; the firstArrangeDone flag keeps
  // the two paths from double-packing.)
  try {
    const anyOn = _HIDEALL_FLAGS.some(f => f !== 'enableTriggerTts' && cfg[f]);
    if (!cfg.firstArrangeDone && anyOn) {
      cfg.firstArrangeDone = true; saveConfig(cfg);
      setTimeout(() => { try { _autoArrangeOverlays(); } catch {} }, 1500);
      appendAgentLog('[arrange] first-boot auto-arrange scheduled (onboarding)\n');
    }
  } catch {}
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
ipcMain.handle('open-resources', () => { openResources(); return true; });
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
// Tear down single-overlay ("Setup THIS") mode for ONE window: drop it from
// the registry and restore the persisted lock + hide its setup strip — the
// same teardown set-setup-mode-this(false) does. Used by the explicit lock
// (🔒) and hide (✕) paths so setup chrome never survives a user action that
// means "I'm done here" (#116). applyOverlayInteractivity() deliberately SKIPS
// single-setup windows, so without this those paths leave the unlocked chrome
// (blue outline + placeholder) stuck on screen.
function _exitSingleSetup(win) {
  try {
    if (!win || win.isDestroyed() || !_singleSetupWins.has(win.webContents.id)) return false;
    _singleSetupWins.delete(win.webContents.id);
    const cfg = loadConfig();
    const locked = cfg.overlaysLocked !== false;
    const key = _boundsKeyForWindow(win).replace(/Bounds$/, '');
    try { win.setIgnoreMouseEvents(locked, { forward: true }); } catch {}
    try { win.setResizable(!locked); } catch {}
    try {
      win.webContents.send('overlay-locked', locked);
      win.webContents.send('setup-mode', { active: false, overlayKey: key, scope: 'this' });
    } catch {}
    return true;
  } catch { return false; }
}
// Exit single-overlay setup for EVERY window still in it (used on an explicit
// global lock — "done positioning"). Resolves webContents ids back to windows
// via the live window list so a closed window just gets dropped.
function _exitAllSingleSetup() {
  if (_singleSetupWins.size === 0) return;
  const byId = new Map();
  for (const w of BrowserWindow.getAllWindows()) { try { byId.set(w.webContents.id, w); } catch {} }
  for (const wcId of Array.from(_singleSetupWins)) {
    const win = byId.get(wcId);
    if (win) _exitSingleSetup(win); else _singleSetupWins.delete(wcId);
  }
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
// Open an external URL in the OS default browser. Allowlist so a compromised
// renderer can't open arbitrary links: wolfpack.quest, the GitHub repo, plus
// the PoP raid overlay's sources — EQProgression guide pages/diagrams and the
// phase strategy videos on YouTube.
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string') return false;
  const ALLOW = /^https:\/\/(wolfpack\.quest|github\.com\/davehess\/QuarmBossTracker|(www\.)?eqprogression\.com\/|(www\.)?pqdi\.cc\/|(www\.)?youtube\.com\/watch|youtu\.be\/)/i;
  if (!ALLOW.test(url)) {
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

// ── Zeal auto-updater (CoastalRedwood/Zeal) ─────────────────────────────────
// Resolve the EQ client folder Zeal lives in — same folder as eqgame.exe +
// the log files (where uifiles/ and Zeal.asi go). Reuses the UI-Studio path
// logic: first configured folder that actually holds EQ logs, else auto-detect.
function _zealEqDir() {
  const cfg = loadConfig();
  const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length > 0
                  ? cfg.eqPaths
                  : (cfg.eqPath ? [cfg.eqPath] : []);
  for (const p of userPaths) { if (_dirHasEqLogs(p)) return p; }
  return detectEqDir(null);
}
// ── Windows Defender exclusions (opt-in, explicit, never silent) ────────────
//
// Real-time scanning sits in front of every file open, and both halves of Mimic
// are I/O-shaped: the agent re-reads its spell/clicky catalogs and queue from
// userData on each start, and the EQ folder holds multi-GB append-only logs we
// tail continuously. Excluding those folders is the single biggest win
// available on a Windows box (Hitya 2026-08-04, whose EQ folder was already
// excluded but Mimic's was not).
//
// DELIBERATELY NOT IN THE INSTALLER. An unsigned installer that silently
// excludes its own folder from antivirus is behaving exactly like the thing
// antivirus exists to catch, and our installer runs without UAC today
// (perMachine:false) so adding elevation solely for this would make every
// install scarier for a benefit most users do not know they are getting. This
// is a button: the user sees the exact paths first, clicks, and approves one
// UAC prompt.
//
// Elevation goes through a temp .ps1 rather than an inline -Command string
// because the nested quoting of Start-Process -ArgumentList around a command
// containing Windows paths is a well-known way to ship a quoting bug.
function _defenderPaths() {
  const out = [];
  const seen = new Set();
  const add = (p, why) => {
    if (!p) return;
    const norm = path.normalize(String(p));
    const k = norm.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ path: norm, why });
  };
  // EQ folders — configured first, then whatever autodetect can see.
  try {
    const cfg = loadConfig();
    const userPaths = Array.isArray(cfg.eqPaths) && cfg.eqPaths.length ? cfg.eqPaths
                    : (cfg.eqPath ? [cfg.eqPath] : []);
    for (const p of userPaths) add(p, 'EverQuest folder');
    if (out.length === 0) {
      for (const f of (findEqInstalls(null).found || [])) add(f.path, 'EverQuest folder (detected)');
    }
  } catch (e) { void e; }
  // Mimic's own two locations: the per-user data dir (agent catalogs, upload
  // queue, logs — read and written constantly) and the install dir (the exe and
  // the bundled Node runtime).
  try { add(app.getPath('userData'), 'Mimic data folder'); } catch (e) { void e; }
  try { add(path.dirname(app.getPath('exe')), 'Mimic program folder'); } catch (e) { void e; }
  return out;
}

// Read-only: which of our paths Windows already excludes. Get-MpPreference does
// not need elevation, so the UI can show state before asking for anything.
ipcMain.handle('defender-status', async () => {
  if (process.platform !== 'win32') return { ok: false, unsupported: true, paths: [] };
  const wanted = _defenderPaths();
  try {
    const { execFile } = require('child_process');
    const current = await new Promise((resolve) => {
      execFile('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
         '(Get-MpPreference).ExclusionPath -join [char]10'],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout || '')));
    });
    if (current === null) return { ok: false, error: 'Could not read Defender settings', paths: wanted };
    const have = new Set(current.split(/\r?\n/).map(s => path.normalize(s.trim()).toLowerCase()).filter(Boolean));
    return { ok: true, paths: wanted.map(p => ({ ...p, excluded: have.has(p.path.toLowerCase()) })) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), paths: wanted };
  }
});

// PowerShell single-quoted strings escape a quote by doubling it. Used to build
// every elevated script below — a path or peer name containing a quote must not
// be able to terminate the string and append a second statement.
const _psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Run a PowerShell script ELEVATED and read back the JSON it writes.
//
// Shared by the Defender and clock-sync buttons. Goes through a temp .ps1
// rather than an inline -Command because nesting Start-Process -ArgumentList
// around a command containing Windows paths is a well-known way to ship a
// quoting bug. The outer (non-elevated) PowerShell launches the elevated child
// with -Wait, so we learn when the user has answered UAC either way.
//
// `buildScript(outFile)` returns the script body; it must write its result JSON
// to outFile. A MISSING result file is treated as "cancelled", because that is
// overwhelmingly what it means: the user declined the prompt, which is a choice
// rather than a failure and should not be reported in red.
async function _runElevatedPs(tag, buildScript) {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only.' };
  const tmpDir  = app.getPath('temp');
  const psFile  = path.join(tmpDir, `wolfpack-${tag}.ps1`);
  const outFile = path.join(tmpDir, `wolfpack-${tag}-result.json`);
  try {
    const { execFile } = require('child_process');
    try { fs.unlinkSync(outFile); } catch { /* not there — fine */ }
    fs.writeFileSync(psFile, buildScript(outFile), 'utf8');
    // NO -RedirectStandardOutput/-RedirectStandardError here, however much we
    // want the elevated child's output: those live in Start-Process's DIRECT
    // parameter set and -Verb lives in the ShellExecute one. They are mutually
    // exclusive, and combining them throws "Parameter set cannot be resolved
    // using the specified named parameters" — which is exactly the regression
    // 3.5.25 shipped while trying to improve diagnostics. The script captures
    // its own errors into the result JSON instead (see the callers).
    const run = await new Promise((resolve) => {
      execFile('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
         'Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden ' +
         `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${_psq(psFile)}`],
        { timeout: 180000, windowsHide: true },
        (err, stdout, stderr) => resolve({
          code: err ? (err.code || 1) : 0,
          out: String(stdout || '').trim(),
          err: [String(stderr || '').trim(), (err && err.message) || ''].filter(Boolean).join(' | '),
        }));
    });
    // THE BUG (Hitya 2026-08-04: "I approved the UAC prompts", and still got
    // told it was cancelled). Windows PowerShell 5.1 — which is what
    // powershell.exe is — ALWAYS writes a UTF-8 BOM with `-Encoding UTF8`, and
    // there is no utf8NoBOM in 5.1. JSON.parse throws on a leading U+FEFF, so a
    // result file that was written perfectly read back as "no result", which we
    // then reported as a declined prompt.
    //
    // The elevated script had in fact run and the exclusions were applied; only
    // the reporting was broken. Strip the BOM, and trim, before parsing.
    let result = null;
    let rawOut = null;
    try { rawOut = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { /* none written */ }
    if (rawOut) {
      try { result = JSON.parse(rawOut); }
      catch (e) {
        appendAgentLog(`[${tag}] result file present but unparseable: ${e && e.message} :: ${rawOut.slice(0, 200)}\n`);
      }
    }
    try { fs.unlinkSync(psFile); } catch { /* */ }
    try { fs.unlinkSync(outFile); } catch { /* */ }
    if (!result) {
      // Do NOT blanket-call this "cancelled". Declining UAC and the elevated
      // script failing outright produced the SAME message before, so a real
      // failure looked like a user decision and nobody investigated it
      // (Hitya 2026-08-04: "i also did not see a note in there about the
      // clock sync working or the windows defender exception being created").
      //
      // Windows reports a declined UAC prompt as Win32 error 1223, surfaced by
      // Start-Process as "The operation was canceled by the user". Match that
      // specifically; anything else is a genuine error and must say so, with
      // whatever PowerShell actually printed.
      const blob = `${run.err}\n${run.out}`;
      const declined = /canceled by the user|cancelled by the user|1223/i.test(blob);
      appendAgentLog(`[${tag}] no result (exit ${run.code})`
        + (blob.trim() ? ` — ${blob.trim().replace(/\s+/g, ' ').slice(0, 400)}` : '') + '\n');
      if (declined) {
        return { ok: false, cancelled: true, error: 'Cancelled at the Windows permission prompt.' };
      }
      return { ok: false,
        error: (blob.trim() || `The elevated step did not run (exit ${run.code}) and reported nothing.`)
          .replace(/\s+/g, ' ').slice(0, 400) };
    }
    return { ok: true, result };
  } catch (e) {
    appendAgentLog(`[${tag}] elevated run failed: ${e && e.message}\n`);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

ipcMain.handle('defender-add-exclusions', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only.' };
  const wanted = _defenderPaths();
  if (wanted.length === 0) return { ok: false, error: 'Nothing to exclude — set your EverQuest folder first.' };
  const run = await _runElevatedPs('defender-exclusions', (outFile) => [
    '$ErrorActionPreference = "Stop"',
    '$done = @(); $failed = @()',
    ...wanted.map(p =>
      `try { Add-MpPreference -ExclusionPath ${_psq(p.path)}; $done += ${_psq(p.path)} } ` +
      `catch { $failed += (${_psq(p.path)} + " :: " + $_.Exception.Message) }`),
    `@{ done = $done; failed = $failed } | ConvertTo-Json -Compress | Set-Content -Path ${_psq(outFile)} -Encoding UTF8`,
  ].join('\n'));
  if (!run.ok) return run;
  const done = [].concat(run.result.done || []);
  const failed = [].concat(run.result.failed || []);
  appendAgentLog(`[defender] added ${done.length} exclusion(s)`
    + (failed.length ? `, ${failed.length} failed` : '') + `: ${done.join(', ')}\n`);
  return { ok: failed.length === 0, added: done, failed };
});

// ── Windows clock sync ──────────────────────────────────────────────────────
//
// Three installs are drifting ~1.5-3 s/day, one of them ~a minute behind after
// a month (2026-08-04). At that size a machine's deaths and casts land outside
// the dedup windows everyone else's fall in, so one bad clock corrupts numbers
// for the whole raid, not just its owner.
//
// A one-time "set the clock" does NOT hold — we watched exactly that fail:
// Bardtholemu's machine was synced to ~0 on Jul 26-27 and was 11s off again by
// Jul 29. So this deliberately fixes the CAUSE, in order:
//   1. w32time set to Automatic and started (the usual reason drift returns is
//      the service being Disabled or Manual and never running);
//   2. a resync;
//   3. only IF that fails, point it at time.windows.com and retry.
// Step 3 is last on purpose — overwriting the time source on a DOMAIN-JOINED
// machine would be rude and wrong, so it is a fallback, never the opening move.
ipcMain.handle('clock-status', async () => {
  if (process.platform !== 'win32') return { ok: false, unsupported: true };
  try {
    const { execFile } = require('child_process');
    const out = await new Promise((resolve) => {
      execFile('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
         '$s = Get-Service w32time -ErrorAction SilentlyContinue; ' +
         '@{ status = [string]$s.Status; startType = [string]$s.StartType; ' +
         'source = (w32tm /query /source 2>&1 | Out-String).Trim() } | ConvertTo-Json -Compress'],
        { timeout: 20000, windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout || '')));
    });
    if (!out) return { ok: false, error: 'Could not read the Windows Time service.' };
    const j = JSON.parse(out);
    return {
      ok: true,
      running: /running/i.test(j.status || ''),
      automatic: /automatic/i.test(j.startType || ''),
      status: j.status || null,
      startType: j.startType || null,
      source: j.source || null,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('clock-resync', async () => {
  const run = await _runElevatedPs('clock-sync', (outFile) => [
    '$steps = @(); $ok = $false',
    // 1. The service itself — the actual cause of recurring drift.
    'try { Set-Service -Name w32time -StartupType Automatic -ErrorAction Stop; $steps += "startup=Automatic" }',
    'catch { $steps += ("startup FAILED :: " + $_.Exception.Message) }',
    'try { if ((Get-Service w32time).Status -ne "Running") { Start-Service w32time -ErrorAction Stop }; $steps += "service=Running" }',
    'catch { $steps += ("start FAILED :: " + $_.Exception.Message) }',
    // 2. Resync with whatever source is already configured.
    'try { $r = (w32tm /resync /force 2>&1 | Out-String).Trim(); ' +
      'if ($LASTEXITCODE -eq 0) { $ok = $true; $steps += "resync=ok" } else { $steps += ("resync said: " + $r) } }',
    'catch { $steps += ("resync FAILED :: " + $_.Exception.Message) }',
    // 3. Fallback ONLY if the above did not work: give it a public NTP source.
    'if (-not $ok) {',
    '  try { w32tm /config /update /manualpeerlist:"time.windows.com,0x9" /syncfromflags:MANUAL | Out-Null;',
    '        Restart-Service w32time -ErrorAction SilentlyContinue;',
    '        $r2 = (w32tm /resync /force 2>&1 | Out-String).Trim();',
    '        if ($LASTEXITCODE -eq 0) { $ok = $true; $steps += "resync=ok (after setting time.windows.com)" }',
    '        else { $steps += ("still failing: " + $r2) } }',
    '  catch { $steps += ("fallback FAILED :: " + $_.Exception.Message) }',
    '}',
    '$src = (w32tm /query /source 2>&1 | Out-String).Trim()',
    `@{ ok = $ok; steps = $steps; source = $src } | ConvertTo-Json -Compress | Set-Content -Path ${_psq(outFile)} -Encoding UTF8`,
  ].join('\n'));
  if (!run.ok) return run;
  const r = run.result;
  appendAgentLog(`[clock-sync] ok=${r.ok} source=${r.source} — ${[].concat(r.steps || []).join(' | ')}\n`);
  return { ok: !!r.ok, steps: [].concat(r.steps || []), source: r.source || null };
});

// Local status only — no network. Feeds the Settings "Zeal" card on open.
ipcMain.handle('zeal-status', () => {
  try {
    const cfg = loadConfig();
    return zealUpdater.localStatus(_zealEqDir(), cfg.zealInstalledTag);
  } catch (e) { return { eqDir: null, hasZealAsi: false, installedTag: null }; }
});
// Check GitHub for the latest release (network). Returns the comparison the UI
// needs; never writes anything.
ipcMain.handle('zeal-check-update', async () => {
  try {
    const cfg = loadConfig();
    const eqDir = _zealEqDir();
    const local = zealUpdater.localStatus(eqDir, cfg.zealInstalledTag);
    const latest = await zealUpdater.checkLatest();
    return {
      ok: true,
      eqDir,
      installedTag: local.installedTag,
      hasZealAsi: local.hasZealAsi,
      latestTag: latest.tag,
      latestName: latest.name,
      htmlUrl: latest.htmlUrl,
      publishedAt: latest.publishedAt,
      // "Update available" whenever the newest tag differs from what we last
      // installed. If we've never installed via Mimic (installedTag null),
      // offer the install so the user gets a known-current Zeal either way.
      updateAvailable: latest.tag !== local.installedTag,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});
// Download + install the latest Zeal into the EQ folder. Refuses while EQ is
// running (the game holds Zeal.asi; on Windows the write would fail outright).
ipcMain.handle('zeal-install-update', async () => {
  try {
    const eqDir = _zealEqDir();
    if (!eqDir) return { ok: false, error: 'No EverQuest folder is set. Add one in Settings first.' };
    if (await _isEqRunning()) {
      return { ok: false, error: 'Close EverQuest first — Zeal.asi is loaded by the running game and can\'t be replaced while it\'s open.' };
    }
    const res = await zealUpdater.install(eqDir);
    const cfg = loadConfig();
    cfg.zealInstalledTag = res.tag || cfg.zealInstalledTag;
    saveConfig(cfg);
    appendAgentLog(`[zeal-update] installed ${res.tag} into ${eqDir} — ${res.written.length} file(s), ${res.backedUp.length} backed up\n`);
    return { ok: true, tag: res.tag, name: res.name, written: res.written.length, backedUp: res.backedUp.length };
  } catch (e) {
    appendAgentLog(`[zeal-update] install failed: ${e && e.message}\n`);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});
// Background NOTIFY-ONLY check. Never installs on its own — Zeal.asi is a game
// mod and silently overwriting it mid-session would be surprising (and fails
// while EQ is up anyway). Shows a native notification once per newly-seen tag;
// the user does the one-click install from Settings when they're ready.
// Relay Zeal update status to the agent, which surfaces it on the dashboard
// through the existing Mimic Mail list. Mimic owns Zeal detection (it knows the
// EQ dir and runs zealUpdater), the agent owns the dashboard — this is the
// bridge. Fire-and-forget: a missing agent must never break the Zeal check.
function _pushZealUpdateToAgent(tag, installed) {
  try {
    if (!agentPort) return;
    const body = JSON.stringify({ tag: tag || null, installed: installed || null });
    const req = http.request({
      host: '127.0.0.1', port: agentPort, path: '/api/zeal-update', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 3000,
    }, (res) => { res.resume(); });
    req.on('error', () => {}); req.on('timeout', () => req.destroy());
    req.write(body); req.end();
  } catch { /* agent not up yet — the next 12h check (or a manual one) re-pushes */ }
}
let _zealNotifiedTag = null;
async function checkZealUpdate({ manual = false } = {}) {
  try {
    const cfg = loadConfig();
    if (!manual && cfg.zealAutoCheck === false) return;
    const eqDir = _zealEqDir();
    if (!eqDir) return;                              // no EQ folder yet — nothing to update
    const latest = await zealUpdater.checkLatest();
    if (!latest.tag) return;
    const current = latest.tag === cfg.zealInstalledTag;
    // Tell the agent on EVERY check, before the once-per-tag latch below.
    // The dashboard notice must survive an agent restart (Mimic restarts it on
    // config saves and crashes), and it must CLEAR the moment Zeal is current —
    // a stale "update available" that never goes away is worse than none.
    _pushZealUpdateToAgent(current ? null : latest.tag, cfg.zealInstalledTag);
    if (current) return;                             // already current
    if (latest.tag === _zealNotifiedTag) return;     // already nudged for this tag
    _zealNotifiedTag = latest.tag;
    appendAgentLog(`[zeal-update] newer Zeal available: ${latest.tag} (installed: ${cfg.zealInstalledTag || 'unknown'})\n`);
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Zeal update available',
        body: `Zeal ${latest.tag} is out. Open Mimic Settings → Zeal to install it in one click.`,
        silent: true,
      });
      n.on('click', () => { try { openSettings(); } catch {} });
      n.show();
    }
  } catch (e) { appendAgentLog(`[zeal-update] background check failed: ${e && e.message}\n`); }
}

// ── Custom UI packs (Nillipuss etc.) ────────────────────────────────────────
// List the curated packs with LOCAL status (installed? which tag? which option
// layouts are available) — no network, so the Settings card renders instantly.
ipcMain.handle('ui-packs-list', () => {
  try {
    const cfg = loadConfig();
    const eqDir = _zealEqDir();                 // same EQ client folder as Zeal/UI Studio
    const tags = cfg.uiPackTags || {};
    return {
      eqDir: eqDir || null,
      packs: uiPacks.listPacks().map(p => {
        const st = uiPacks.localStatus(eqDir, p, tags[p.id]);
        return {
          ...p,
          installed: st.installed,
          installedTag: st.installedTag,
          options: st.installed ? uiPacks.listOptions(eqDir, p) : [],
        };
      }),
    };
  } catch (e) { return { eqDir: null, packs: [] }; }
});
// Check GitHub for a pack's latest release (network).
ipcMain.handle('ui-pack-check', async (_e, id) => {
  try {
    const pack = uiPacks.getPack(id);
    if (!pack) return { ok: false, error: 'unknown UI pack' };
    const cfg = loadConfig();
    const installedTag = (cfg.uiPackTags || {})[id] || null;
    const latest = await uiPacks.checkLatest(pack);
    return {
      ok: true, id, latestTag: latest.tag, latestName: latest.name,
      htmlUrl: latest.htmlUrl, publishedAt: latest.publishedAt,
      installedTag, updateAvailable: latest.tag !== installedTag,
    };
  } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
});
// Download + install (or update) a pack into uifiles/<packDir>/. Unlike Zeal.asi
// this doesn't require EQ closed — EQ only reads UI files at /loadskin, never
// holds them open — so a user can install a UI mid-session and /loadskin.
ipcMain.handle('ui-pack-install', async (_e, id) => {
  try {
    const pack = uiPacks.getPack(id);
    if (!pack) return { ok: false, error: 'unknown UI pack' };
    const eqDir = _zealEqDir();
    if (!eqDir) return { ok: false, error: 'No EverQuest folder is set. Add one in Settings first.' };
    const res = await uiPacks.install(eqDir, pack);
    const cfg = loadConfig();
    cfg.uiPackTags = cfg.uiPackTags || {};
    cfg.uiPackTags[id] = res.tag || cfg.uiPackTags[id];
    saveConfig(cfg);
    appendAgentLog(`[ui-pack] installed ${pack.packDir} ${res.tag} — ${res.written.length} file(s), ${res.backedUp.length} backed up\n`);
    return {
      ok: true, id, tag: res.tag, written: res.written.length, backedUp: res.backedUp.length,
      loadCmd: pack.loadCmd, options: uiPacks.listOptions(eqDir, pack),
    };
  } catch (e) {
    appendAgentLog(`[ui-pack] install failed (${id}): ${e && e.message}\n`);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});
// Apply one of a pack's Options/ layouts (copy its files up into the pack
// folder, backing up what's replaced). Local file op — no network.
ipcMain.handle('ui-pack-apply-option', async (_e, id, option) => {
  try {
    const pack = uiPacks.getPack(id);
    if (!pack) return { ok: false, error: 'unknown UI pack' };
    const eqDir = _zealEqDir();
    if (!eqDir) return { ok: false, error: 'No EverQuest folder is set.' };
    const res = uiPacks.applyOption(eqDir, pack, String(option || ''));
    appendAgentLog(`[ui-pack] applied option "${res.option}" to ${pack.packDir} — ${res.written} file(s), ${res.backedUp} backed up\n`);
    return { ok: true, id, option: res.option, written: res.written, backedUp: res.backedUp, loadCmd: pack.loadCmd };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});
// Mimic Discord login (device-code flow).
ipcMain.handle('mimic-link-start',   async () => await startMimicLink());
ipcMain.handle('mimic-link-cancel',  () => { cancelMimicLink(); return true; });
ipcMain.handle('mimic-link-signout', async () => { await signOutMimic(); return true; });
ipcMain.handle('check-for-updates', () => { safeCheckForUpdates(true); checkAgentUpdate({ manual: true }); checkZealUpdate({ manual: true }); return true; });
// Revert to stable from the dashboard header's link (next to the BETA badge).
// The native confirm lives HERE so the page-side control is a plain link and
// every entry point shares one confirmation.
ipcMain.handle('revert-to-stable', async () => {
  const res = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Revert to stable', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Wolf Pack miMIC — revert to stable',
    message: 'Switch back to the stable release?',
    detail: 'Mimic will download the current stable build and install it on your next restart. Your settings, overlays, and login are untouched. You can rejoin the beta any time from the tray menu.',
  });
  if (res.response === 0) { await revertToStable('dashboard'); return true; }
  return false;
});
// Dashboard "update ready" banner button → apply the downloaded update now.
ipcMain.handle('restart-to-update', () => {
  try { autoUpdater && autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('[updater] quitAndInstall failed', e); }
  return true;
});
// Real resource numbers, not a promise.
//
// Raiders quit Mimic between sessions to save processing (Hitya 2026-08-03),
// and the honest answer to "does it cost anything?" is a measurement they can
// take on their OWN machine with their OWN overlay set — not a reassurance from
// us. Electron's app.getAppMetrics() reports per-process CPU and working set for
// the main process, every overlay renderer, and the GPU/utility helpers; the
// agent runs as a separate child so we add it explicitly.
//
// percentCPUUsage is a share of ONE core sampled since the previous call, so the
// first reading after a cold start reads high — the renderer discards sample #1.
// OS pid → what that renderer actually IS. getAppMetrics() has no idea what a
// process is FOR, so ten identical "overlay / window" rows told the user
// nothing about WHICH overlays were alive (Hitya 2026-08-04). Only we can
// name them. Several windows can legitimately share one renderer process, so
// labels accumulate rather than overwrite.
// ── Private working set, straight from Windows ─────────────────────────────
//
// "This says 274MB but task manager calls out 161MB. Why is there such a gap?"
// (Hitya 2026-08-04.) Because they are two different measurements, and both
// are correct:
//
//   • Electron's privateBytes is PRIVATE COMMIT — every private page the
//     process has reserved from the pagefile, resident or not.
//   • Task Manager's Memory column is the PRIVATE WORKING SET — only the
//     private pages actually sitting in RAM right now.
//
// Commit is always ≥ working set, and the ratio varies wildly per process: the
// GPU helper reported 102 MB committed against ~32 MB resident because it
// reserves large buffers it never touches. So the gap is not an error to
// correct with a fudge factor — the honest fix is to report the same figure
// Task Manager does, which is what people compare against.
//
// Chromium exposes no working-set-private, so we ask Windows. The perf class
// Win32_PerfRawData_PerfProc_Process carries WorkingSetPrivate keyed by
// IDProcess — one query covers every Mimic process. Readable by a standard
// user, no elevation.
//
// It is NOT free (~200-400ms of PowerShell), and this window's whole claim is
// that Mimic costs nothing at idle, so it runs at most once every 12s and only
// while something is actually asking for metrics — i.e. while the Resource use
// window is open. Everything falls back to the committed figure.
// OFF BY DEFAULT. "I'd rather not take up extra cycles all the time just to be
// right and match Task Manager, but we should explain that we are provisioned
// for more committed RAM and that's why it wouldn't match" (Hitya
// 2026-08-04) — so the default is the free number plus the explanation, and
// this is a checkbox in the Resource use window for when an exact comparison is
// actually wanted. Each run times itself and reports the cost next to the
// toggle: a number measured on the user's machine beats an estimate from ours.
const _WS_TTL_MS = 12_000;
let _wsPrivate = { at: 0, byPid: new Map(), inFlight: false, lastMs: 0 };
// True only while the window that consumes these numbers is actually open.
// "when we close that resource use window make sure we're not matching task
// manager still and querying for the exact in the background" (Hitya
// 2026-08-04). Today the only caller is resources.html's 2s poll, so closing
// the window already stops it — but that is a property of the renderer, and a
// background PowerShell loop is not something to leave resting on one. This
// makes it structural in the main process instead.
function _resourcesWindowOpen() {
  return !!(resourcesWindow && !resourcesWindow.isDestroyed());
}

function _refreshPrivateWorkingSet(pids) {
  if (process.platform !== 'win32') return;
  if (!_resourcesWindowOpen()) { _wsPrivate.byPid = new Map(); return; }
  let cfg; try { cfg = loadConfig(); } catch { return; }
  if (!cfg.exactMemory) { _wsPrivate.byPid = new Map(); return; }
  if (_wsPrivate.inFlight) return;
  if (Date.now() - _wsPrivate.at < _WS_TTL_MS) return;
  if (!pids || !pids.length) return;
  _wsPrivate.inFlight = true;
  const started = Date.now();
  try {
    const { execFile } = require('child_process');
    const filter = pids.map(p => `IDProcess=${p}`).join(' OR ');
    const psCmd = `Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter "${filter}" | ForEach-Object { "$($_.IDProcess)|$($_.WorkingSetPrivate)" }`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        _wsPrivate.inFlight = false;
        // Stamp the time even on failure, or a broken query would re-spawn
        // PowerShell on every single 2s poll.
        _wsPrivate.at = Date.now();
        _wsPrivate.lastMs = _wsPrivate.at - started;
        if (err || !stdout) return;
        // The window can close mid-query. Landing the result then would leave a
        // populated cache behind for whoever opens it next, showing resident
        // numbers with the checkbox off.
        if (!_resourcesWindowOpen()) { _wsPrivate.byPid = new Map(); return; }
        const byPid = new Map();
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = line.trim().match(/^(\d+)\|(\d+)$/);
          if (m) byPid.set(Number(m[1]), Number(m[2]));   // bytes
        }
        if (byPid.size) _wsPrivate.byPid = byPid;
      });
  } catch { _wsPrivate.inFlight = false; _wsPrivate.at = Date.now(); }
}
// Checkbox in the Resource use window. Clearing it drops the cached snapshot on
// the next refresh, so the card falls straight back to the committed figure.
ipcMain.handle('set-exact-memory', (_e, on) => {
  const cfg = loadConfig();
  cfg.exactMemory = !!on;
  saveConfig(cfg);
  if (!cfg.exactMemory) { _wsPrivate.byPid = new Map(); _wsPrivate.lastMs = 0; }
  else _wsPrivate.at = 0;                    // let the next poll query at once
  appendAgentLog(`[metrics] exact memory (Windows working-set query) ${cfg.exactMemory ? 'ON' : 'off'}\n`);
  return !!cfg.exactMemory;
});

function _windowLabelsByPid() {
  const byPid = new Map();
  const put = (win, label) => {
    try {
      if (!win || win.isDestroyed()) return;
      const pid = win.webContents.getOSProcessId();
      if (!pid) return;
      const prior = byPid.get(pid);
      byPid.set(pid, prior ? prior + ' + ' + label : label);
    } catch { /* window mid-close */ }
  };
  let cfg; try { cfg = loadConfig(); } catch { cfg = {}; }
  const NAMES = {
    hud: 'DPS HUD', trigger: 'Trigger alerts', charm: 'Charm tracker',
    pets: 'Pet tracker', mobinfo: 'Mob Info', buffQueue: 'Buff queue',
    who: '/who', melody: 'Melody', zeal: 'Zeal health', threat: 'Threat meter',
    chchain: 'CH chain', tank: 'Tank HUD', exttarget: 'Extended target',
    command: 'Command center', popraid: 'PoP raids',
  };
  for (const e of _OVERLAY_WINDOWS) {
    // Flag the ones that are alive despite being switched off — that pairing is
    // the whole reason someone opens this window.
    put(e.get(), (NAMES[e.key] || e.key) + (cfg[e.flag] ? '' : ' (switched OFF)'));
  }
  for (const [key, win] of panelOverlays.entries()) put(win, 'panel overlay · ' + key);
  put(mainWindow,      'Dashboard');
  put(settingsWindow,  'Settings');
  put(uiStudioWindow,  'UI Studio');
  put(resourcesWindow, 'Resource use (this window)');
  return byPid;
}

ipcMain.handle('app-metrics', () => {
  const out = { at: Date.now(), eqRunning: _eqRunning, eqIgnored: [...new Set(_eqIgnoredPaths.values())], procs: [], agent: null };
  let labels = new Map();
  try { labels = _windowLabelsByPid(); } catch { /* naming is a bonus, never the point */ }
  let anyWorkingSet = false;   // no privateBytes at all (non-Windows)
  let anyEstimated  = false;   // no working-set-private for at least one pid
  try {
    for (const m of app.getAppMetrics()) {
      const mem = m.memory || {};
      // workingSetSize counts SHARED pages in EVERY process that maps them, and
      // every Chromium renderer maps the same tens of MB of Electron framework.
      // Summing it across 13 processes counted that framework 13 times: Mimic
      // reported 1267 MB where Task Manager showed 460 (Hitya 2026-08-04).
      // privateBytes is memory not shared with any other process — what Task
      // Manager's Memory column shows, and the only basis where the per-process
      // rows legitimately add up to a total.
      const privKb = Number(mem.privateBytes) || 0;
      if (!privKb) anyWorkingSet = true;
      // Working set private, if Windows has told us. Falls back to committed.
      const wsBytes = _wsPrivate.byPid.get(m.pid);
      if (wsBytes == null) anyEstimated = true;
      out.procs.push({
        pid:  m.pid,
        type: m.type || 'unknown',
        // serviceName/name disambiguate the several "Utility" rows.
        name: m.name || m.serviceName || null,
        label: labels.get(m.pid) || null,
        cpu:  m.cpu ? Number(m.cpu.percentCPUUsage) || 0 : 0,
        // The headline number: what Task Manager's Memory column shows.
        memMb: wsBytes != null
          ? Math.round(wsBytes / (1024 * 1024))
          : Math.round((privKb || mem.workingSetSize || 0) / 1024),
        // …and the committed figure alongside it. Keeping both on screen is
        // what stops the difference reading as an error. Both source fields
        // are KB on every platform electron supports.
        commitMb: Math.round((privKb || mem.workingSetSize || 0) / 1024),
      });
    }
  } catch { /* metrics unavailable — the card renders what it has */ }
  // Refresh AFTER building the payload: this poll uses the cached snapshot and
  // the next one picks up the new numbers, so nothing ever waits on PowerShell.
  try { _refreshPrivateWorkingSet(out.procs.map(p => p.pid)); } catch { /* best effort */ }
  // privateBytes is Windows-only, and the working-set query can fail or not
  // have run yet. Say which basis is on screen rather than let a number that
  // can't be compared to Task Manager pass as one that can.
  out.memBasis = anyEstimated ? (anyWorkingSet ? 'workingSet' : 'commit') : 'workingSetPrivate';
  // So the card can render the checkbox and show what the query costs HERE.
  try { out.exactMemory = !!loadConfig().exactMemory; } catch { out.exactMemory = false; }
  out.wsQueryMs = _wsPrivate.lastMs || 0;
  // The agent is a spawned node process, so it is NOT in getAppMetrics().
  try { if (agentProc && agentProc.pid) out.agent = { pid: agentProc.pid }; } catch { /* */ }
  out.totalCpu   = Math.round(out.procs.reduce((a, p) => a + p.cpu, 0) * 10) / 10;
  out.totalMemMb = out.procs.reduce((a, p) => a + p.memMb, 0);
  out.totalCommitMb = out.procs.reduce((a, p) => a + (p.commitMb || 0), 0);
  out.windows    = out.procs.filter(p => p.type === 'Tab' || p.type === 'Renderer').length;
  return out;
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
  // Zeal auto-updater: notify-only check ~25s after boot (let the EQ folder +
  // agent settle), then every 12h. Install stays a one-click user action; this
  // only nudges when CoastalRedwood ships a newer Zeal.
  setTimeout(() => checkZealUpdate({ manual: false }), 25000);
  setInterval(() => checkZealUpdate({ manual: false }), 12 * 60 * 60 * 1000);
  createMainWindow();
  makeTrayIcon();
  wireAutoUpdater();
  scheduleAgentUpdates();

  // First launch: NO token wall. Agent boots in local-only mode; dashboard
  // works immediately. User clicks "Connect to Wolf Pack" in the tray menu
  // when they're ready to start uploading.
  await launchAgent();
  // Only the overlays that are actually switched on. This used to be ten
  // unconditional create calls — ten Chromium renderers, ~80 MB each, for
  // overlays most users never turn on. See _materializeEnabledOverlays().
  _materializeEnabledOverlays();
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
