// Wolf Pack Mimic — Electron main process.
//
// Responsibilities:
//   1. Locate the wolfpack-logsync agent (dev: repo; packaged: resources/agent),
//      copy it into a WRITABLE per-user dir (userData/agent) so its state files
//      (queue, stats) don't collide with a Parser.bat install — true coexistence.
//   2. Run the agent under Electron's OWN Node (ELECTRON_RUN_AS_NODE) so the user
//      needs no separate Node.js install. Picks a free port starting at 7779 so
//      a running Parser.bat on 7777 doesn't clash.
//   3. Open a real window onto the agent's dashboard (http://127.0.0.1:<port>/).
//   4. Open a transparent, always-on-top, click-through OVERLAY that polls
//      /api/state for live DPS + boss timers (the DnDOverlay-style parity proof).
//   5. Tray icon: show/hide window, toggle overlay, toggle overlay click-through,
//      quit. Lifecycle: restart the agent on crash with backoff.
//
// BETA. Not code-signed yet (SmartScreen will warn — "More info → Run anyway").
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const net   = require('net');
const http  = require('http');
const { spawn } = require('child_process');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'mimic.config.json');
const AGENT_DIR   = () => path.join(app.getPath('userData'), 'agent');
const BASE_PORT   = 7779; // 7777/7778 left for Parser.bat coexistence

let mainWindow = null;
let overlayWindow = null;
let triggerWindow = null;
let settingsWindow = null;
let tray = null;
let agentProc = null;
let agentPort = BASE_PORT;
let restartBackoff = 1000;
let quitting = false;
let overlayClickThrough = true;

// ── Config ────────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')); }
  catch { return { eqPath: null, botUrl: 'https://wolfpackparse.up.railway.app/api/agent/encounter', token: null }; }
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
    // Copy if missing or the bundled file is newer (post-update).
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

// ── Launch the agent under Electron's Node ──────────────────────────────────
async function launchAgent() {
  if (quitting) return;
  const cfg = loadConfig();
  const agentPath = ensureWritableAgent();
  agentPort = await findFreePort(BASE_PORT);

  const args = [agentPath, '--watch', '--web-port', String(agentPort)];
  if (cfg.botUrl) { args.push('--bot-url', cfg.botUrl); }
  if (cfg.token)  { args.push('--token', cfg.token); }
  // Point the agent at the EQ log dir via --log-dir if the agent supports it;
  // otherwise the agent auto-detects. We pass eqPath through env for the agent's
  // own detection logic.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (cfg.eqPath) env.WOLFPACK_EQ_DIR = cfg.eqPath;

  agentProc = spawn(process.execPath, args, {
    env,
    cwd: AGENT_DIR(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agentProc.stdout.on('data', d => process.stdout.write(`[agent] ${d}`));
  agentProc.stderr.on('data', d => process.stderr.write(`[agent] ${d}`));
  agentProc.on('exit', (code) => {
    agentProc = null;
    if (quitting) return;
    // The agent writes .force-update-on-restart when the supervisor swaps it;
    // relaunch immediately in that case.
    const marker = path.join(AGENT_DIR(), '.force-update-on-restart');
    if (fs.existsSync(marker)) { try { fs.unlinkSync(marker); } catch {} restartBackoff = 1000; return launchAgent(); }
    console.warn(`[mimic] agent exited (${code}); restarting in ${restartBackoff}ms`);
    setTimeout(launchAgent, restartBackoff);
    restartBackoff = Math.min(restartBackoff * 2, 60000);
  });
  setTimeout(() => { if (agentProc) restartBackoff = 1000; }, 30000);

  const up = await waitForAgent(agentPort);
  if (up && mainWindow) mainWindow.loadURL(`http://127.0.0.1:${agentPort}/`);
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

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 320, height: 220, x: 40, y: 40,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.loadFile('overlay.html');
  overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.webContents.send('agent-port', agentPort);
  });
}

function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 520, height: 460, title: 'Mimic Settings', backgroundColor: '#0e1116',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────
function makeTrayIcon() {
  // 16x16 wolf-ish dot — a real icon ships in build/ for packaged builds.
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOElEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBQAAAyEAAH8m0r3AAAAAElFTkSuQmCC'
  );
  tray = new Tray(img);
  tray.setToolTip('Wolf Pack Mimic');
  const menu = Menu.buildFromTemplate([
    { label: 'Show dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Toggle overlay', click: () => {
        if (!overlayWindow) createOverlayWindow();
        else overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
      } },
    { label: 'Trigger alerts (TTS)', type: 'checkbox', checked: true, click: (mi) => {
        if (mi.checked) { if (!triggerWindow) createTriggerOverlay(); else triggerWindow.show(); }
        else if (triggerWindow) triggerWindow.hide();
      } },
    { label: 'Overlay click-through', type: 'checkbox', checked: overlayClickThrough, click: (mi) => {
        overlayClickThrough = mi.checked;
        if (overlayWindow) overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
      } },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { label: 'Open dashboard in browser', click: () => shell.openExternal(`http://127.0.0.1:${agentPort}/`) },
    { type: 'separator' },
    { label: 'Quit Mimic', click: () => { quitting = true; if (agentProc) { try { agentProc.kill(); } catch {} } app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('get-agent-port', () => agentPort);
ipcMain.handle('relaunch-agent', async () => { if (agentProc) { try { agentProc.kill(); } catch {} } else { await launchAgent(); } return true; });

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createMainWindow();
  makeTrayIcon();

  const cfg = loadConfig();
  if (!cfg.token) openSettings(); // first run — need at least an agent token

  await launchAgent();
  createOverlayWindow();
  createTriggerOverlay();
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => { quitting = true; if (agentProc) { try { agentProc.kill(); } catch {} } });
