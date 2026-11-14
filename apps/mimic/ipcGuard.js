'use strict';
// ipcGuard — one sender check for every ipcMain handler (readiness audit #22, 2026-11-12).
//
// WHY: main.js registers ~228 handlers and none looked at who was calling. Mimic loads two kinds of page with the
// `window.mimic` bridge attached: its own files (file:// inside the app folder) and the local agent's dashboard,
// overlays and "On this PC" pages (http://127.0.0.1:<agentPort>). Anything else that ever ends up in a window (a
// navigation, a redirect, an iframe) must not be able to drive the bridge, so the guard accepts only those two origins.
//
// TIERS: the dashboard legitimately uses ~60 channels (settings, overlays, updates). The channels that WRITE files
// or INSTALL things and that the dashboard never calls are STRICT_CHANNELS: file:// pages only, so a compromised
// local web page cannot reach them even though it passes the general check.
//
// HOW: installIpcGuard() replaces ipcMain.on / .once / .handle ONCE, before any registration, so every call site
// (and every test that matches the call-site text) stays as it was.
const path = require('path');
const { fileURLToPath } = require('url');

const STRICT_CHANNELS = new Set([
  'setup-share-apply', 'ui-studio-write-edits', 'ui-studio-write-bundle', 'ui-studio-import-pvp-set',
  'ui-studio-write-pages', 'ui-studio-defer-save', 'ui-studio-layout-save', 'ui-studio-layout-delete',
  'ui-studio-layout-import', 'ui-studio-restore', 'ui-restore-plan', 'ui-restore-parts', 'ui-pack-install',
  'canvas-save', 'canvas-groups-save', 'dock-layout-save', 'dock-layout-delete', 'overlay-setup-import',
]);

// Pure: is a frame at `url` allowed to call `channel`?
//   appDir    absolute folder the app's own pages live in (__dirname)
//   agentPort the local agent's current port (number or string)
function isAllowedSender(url, opts) {
  const { appDir, agentPort, channel } = opts || {};
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol === 'file:') {
    if (u.host && u.host !== 'localhost') return false;        // file://server/share (UNC) is not ours
    let p;
    try { p = path.resolve(fileURLToPath(u)); } catch { return false; }
    const root = path.resolve(String(appDir || ''));
    if (!appDir) return false;
    const ci = process.platform === 'win32';
    const rel = path.relative(ci ? root.toLowerCase() : root, ci ? p.toLowerCase() : p);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
  if (STRICT_CHANNELS.has(channel)) return false;
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
    return !!agentPort && u.port === String(agentPort);
  }
  return false;
}

// The URL of the frame that sent `e`; '' when it is gone.
function senderUrl(e) {
  if (e && e.senderFrame) return String(e.senderFrame.url || '');
  if (e && e.senderFrame === undefined && e.sender && typeof e.sender.getURL === 'function') {
    try { return String(e.sender.getURL() || ''); } catch { return ''; }
  }
  return '';
}

// ROLLOUT: 'report' logs what WOULD be blocked and lets the call through; 'enforce' blocks it. The first beta ships
// 'report', because nobody has yet watched this in a real Mimic window and a wrong guess about a legitimate page (an
// agent port that moved, a page served from a folder this file does not know) would break that window mid-raid. Once a
// raid-night soak shows no "[ipc] would block" line for a legitimate page, IPC_GUARD_MODE becomes 'enforce' in a later
// build. Anything but 'report' enforces, so a typo cannot switch the guard off.
const IPC_GUARD_MODE = 'report';

function installIpcGuard(ipcMain, { appDir, getAgentPort, log, mode = IPC_GUARD_MODE }) {
  const seen = new Set();
  const report = mode === 'report';
  const ok = (e, channel) => {
    const url = senderUrl(e);
    if (isAllowedSender(url, { appDir, agentPort: getAgentPort(), channel })) return true;
    let origin = '(none)';
    try { origin = new URL(url).origin; if (origin === 'null') origin = new URL(url).protocol; } catch { /* keep (none) */ }
    const key = channel + ' ' + origin;
    if (!seen.has(key) && seen.size < 200) { seen.add(key); try { log('[ipc] ' + (report ? 'would block ' : 'blocked ') + channel + ' from ' + origin); } catch { /* a log line is never worth it */ } }
    return report;
  };
  const orig = { on: ipcMain.on.bind(ipcMain), once: ipcMain.once.bind(ipcMain), handle: ipcMain.handle.bind(ipcMain) };
  ipcMain.on = (ch, fn) => orig.on(ch, (e, ...a) => { if (ok(e, ch)) return fn(e, ...a); });
  ipcMain.once = (ch, fn) => orig.once(ch, (e, ...a) => { if (ok(e, ch)) return fn(e, ...a); });
  ipcMain.handle = (ch, fn) => orig.handle(ch, (e, ...a) => {
    if (!ok(e, ch)) throw new Error('ipc: sender not allowed for ' + ch);
    return fn(e, ...a);
  });
}

module.exports = { installIpcGuard, isAllowedSender, STRICT_CHANNELS, IPC_GUARD_MODE };
