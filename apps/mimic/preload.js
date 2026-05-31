// Preload — minimal contextBridge surface. No nodeIntegration in renderers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mimic', {
  getConfig:     () => ipcRenderer.invoke('get-config'),
  saveConfig:    (cfg) => ipcRenderer.invoke('save-config', cfg),
  getAgentPort:  () => ipcRenderer.invoke('get-agent-port'),
  relaunchAgent: () => ipcRenderer.invoke('relaunch-agent'),
  onAgentPort:   (cb) => ipcRenderer.on('agent-port', (_e, port) => cb(port)),

  // Runtime status — also pushed via onStatus when it changes.
  getStatus:     () => ipcRenderer.invoke('get-status'),
  onStatus:      (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),

  // User-facing toggles.
  setQuietMode:    (on)   => ipcRenderer.invoke('set-quiet-mode', !!on),
  setTellsMode:    (mode) => ipcRenderer.invoke('set-tells-mode', mode),
  markOnboarded:   ()     => ipcRenderer.invoke('mark-onboarded'),
  openDashboard:   ()     => ipcRenderer.invoke('open-dashboard'),

  // Updates.
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Diagnostics.
  getAgentLogTail: (lines) => ipcRenderer.invoke('get-agent-log-tail', lines),
});
