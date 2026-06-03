// Preload — minimal contextBridge surface. No nodeIntegration in renderers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mimic', {
  openSettings:        ()         => ipcRenderer.invoke('open-settings'),
  createPanelOverlay:  (panelKey) => ipcRenderer.invoke('create-panel-overlay', panelKey),
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
  setOverlaysLocked: (on) => ipcRenderer.invoke('set-overlays-locked', !!on),
  markOnboarded:   ()     => ipcRenderer.invoke('mark-onboarded'),
  openDashboard:   ()     => ipcRenderer.invoke('open-dashboard'),
  openExternal:    (url)  => ipcRenderer.invoke('open-external', url),

  // Overlay lock state — main pushes this to overlay renderers so they can
  // show/hide their drag handle.
  onOverlayLocked: (cb)   => ipcRenderer.on('overlay-locked', (_e, locked) => cb(locked)),
  // Setup-mode state — pushed to each overlay with its identifying key so
  // the renderer can show the per-window control strip (opacity slider, etc.)
  onSetupMode:      (cb)         => ipcRenderer.on('setup-mode', (_e, payload) => cb(payload)),
  setSetupMode:     (on)         => ipcRenderer.invoke('set-setup-mode', !!on),
  setOverlayOpacity:(key, value) => ipcRenderer.invoke('set-overlay-opacity', key, value),

  // Manual overlay drag — replaces the buggy Chromium app-region drag on
  // transparent windows. Renderer mousedown on the ✥ handle calls
  // overlayDragStart; document mouseup calls overlayDragEnd.
  overlayDragStart: () => ipcRenderer.invoke('overlay-drag-start'),
  overlayDragEnd:   () => ipcRenderer.invoke('overlay-drag-end'),

  // EQ install discovery + folder picker for the multi-folder UI.
  findEqInstalls: () => ipcRenderer.invoke('find-eq-installs'),
  pickEqDir:      () => ipcRenderer.invoke('pick-eq-dir'),

  // UI Studio — capture / restore EQ ini files (windows, hotkeys, chat
  // tabs, bandolier, socials, eqclient.ini) so a user can set up an
  // identical install on a different machine.
  uiStudioListCharacters: ()        => ipcRenderer.invoke('ui-studio-list-characters'),
  uiStudioCapture:        (params)  => ipcRenderer.invoke('ui-studio-capture', params),
  uiStudioListSnapshots:  (character)=> ipcRenderer.invoke('ui-studio-list-snapshots', character),
  uiStudioRestore:        (params)  => ipcRenderer.invoke('ui-studio-restore', params),

  // Updates.
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Diagnostics.
  getAgentLogTail: (lines) => ipcRenderer.invoke('get-agent-log-tail', lines),
});

// ── Dashboard chrome injection (Mimic only) ─────────────────────────────────
// The main window loads the AGENT dashboard (served over http on localhost),
// which is shared verbatim with Parser.bat and has no Mimic-specific UI. We
// inject two Mimic affordances into THAT page only (file:// overlays/settings
// are skipped):
//   1. A ⚙ gear button, top-right → opens the Mimic Settings window.
//   2. A "Not connected" banner when no token is set, so a missing token is
//      surfaced as a fixable problem instead of silently not uploading.
// This runs in the isolated preload world; it only touches the DOM + the
// already-exposed window.mimic bridge, so there's no security surface change.
if (location.protocol === 'http:') {
  const ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };
  ready(() => {
    // Panel overlays load the dashboard with ?overlay=<key>. In that context
    // the gear button means something different — there's no main-window
    // Settings need from a tiny floating overlay, but there IS a real need
    // to reposition / resize / unlock the overlay itself. Detect the mode
    // once and branch the gear's behavior + title.
    const isOverlayWindow = /[?&]overlay=/.test(location.search);
    let setupOn = false;

    // Gear button
    const gear = document.createElement('button');
    gear.textContent = '⚙';
    gear.title = isOverlayWindow
      ? 'Place / move / resize this overlay (toggles Setup mode)'
      : 'Mimic Settings';
    gear.setAttribute('style', [
      'position:fixed', 'top:10px', 'right:12px', 'z-index:99999',
      'width:34px', 'height:34px', 'border-radius:8px',
      'background:#161b22', 'color:#c9d1d9', 'border:1px solid #2a3140',
      'font-size:17px', 'cursor:pointer', 'line-height:1',
    ].join(';'));
    gear.onmouseenter = () => { gear.style.borderColor = '#58a6ff'; gear.style.color = '#58a6ff'; };
    gear.onmouseleave = () => {
      gear.style.borderColor = setupOn && isOverlayWindow ? '#d69922' : '#2a3140';
      gear.style.color       = setupOn && isOverlayWindow ? '#d69922' : '#c9d1d9';
    };
    gear.onclick = () => {
      try {
        if (isOverlayWindow) {
          setupOn = !setupOn;
          ipcRenderer.invoke('set-setup-mode', setupOn);
          // Reflect state on the button so the user can see it's "armed"
          // even when the cursor leaves.
          gear.style.borderColor = setupOn ? '#d69922' : '#2a3140';
          gear.style.color       = setupOn ? '#d69922' : '#c9d1d9';
          gear.title = setupOn
            ? 'Setup ON — drag ✥ to move, corners to resize. Click ⚙ again to lock.'
            : 'Place / move / resize this overlay (toggles Setup mode)';
        } else {
          ipcRenderer.invoke('open-settings');
        }
      } catch (e) {}
    };
    document.body.appendChild(gear);

    // Skip the connection banner in overlay windows — the banner is a
    // main-dashboard nudge ("paste your token to start sharing parses").
    // It clutters tiny floating overlays and has no actionable affordance
    // there since opening Settings from an overlay is also intentionally
    // suppressed by the gear branch above.
    if (isOverlayWindow) return;

    // Token / connection banner
    const banner = document.createElement('div');
    banner.id = 'mimic-conn-banner';
    banner.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
      'display:none', 'align-items:center', 'justify-content:center', 'gap:10px',
      'padding:8px 14px', 'background:#3a2a0a', 'color:#f6c365',
      'border-bottom:1px solid #6b5320', 'font-size:13px', 'font-family:ui-monospace,Consolas,monospace',
    ].join(';'));
    const connectBtn = document.createElement('button');
    connectBtn.textContent = 'Connect now';
    connectBtn.setAttribute('style', [
      'background:#1f6feb', 'color:#fff', 'border:none', 'border-radius:5px',
      'padding:4px 12px', 'cursor:pointer', 'font-size:12px',
    ].join(';'));
    connectBtn.onclick = () => { try { ipcRenderer.invoke('open-settings'); } catch (e) {} };
    const msg = document.createElement('span');
    msg.innerHTML = '⚠ <b>Not connected</b> — no Wolf Pack token set, so your parses aren\'t being shared. Paste your <code>/token</code> to fix.';
    banner.appendChild(msg);
    banner.appendChild(connectBtn);
    document.body.appendChild(banner);

    const refreshBanner = (s) => {
      const localOnly = s && s.localOnly;
      banner.style.display = localOnly ? 'flex' : 'none';
      gear.style.top = localOnly ? '50px' : '10px'; // nudge gear below banner
    };
    // Initial + live updates.
    ipcRenderer.invoke('get-status').then(refreshBanner).catch(() => {});
    ipcRenderer.on('status', (_e, s) => refreshBanner(s));
  });
}
