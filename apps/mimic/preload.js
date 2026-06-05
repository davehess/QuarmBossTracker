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

  // Click-through overlays: ask main to momentarily make THIS window
  // interactive while the cursor is over a corner control, so the click lands
  // even when overlays are locked. Pair mouseenter(true)/mouseleave(false).
  overlayHoverInteractive: (want) => ipcRenderer.invoke('overlay-hover-interactive', !!want),
  // Hide the overlay that calls this (the ✕). Named overlays flip their pref
  // off; panel overlays close.
  hideThisOverlay: () => ipcRenderer.invoke('hide-overlay'),

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

  // Mimic Discord login (device-code flow). `mimicLinkStart` returns
  // { ok, user_code, verification_url, verification_url_complete, expires_at }
  // and opens the browser; the renderer polls via getStatus()/onStatus() to
  // learn when the link completes (status.mimicSession is populated).
  mimicLinkStart:   ()  => ipcRenderer.invoke('mimic-link-start'),
  mimicLinkCancel:  ()  => ipcRenderer.invoke('mimic-link-cancel'),
  mimicLinkSignOut: ()  => ipcRenderer.invoke('mimic-link-signout'),

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
    // Hover-to-interact: when this is a (click-through) overlay window, ask
    // main to make the window interactive while the cursor is over the gear so
    // the click registers even when overlays are locked. Restore on leave.
    const _hoverInteractive = (on) => {
      if (!isOverlayWindow) return;
      try { ipcRenderer.invoke('overlay-hover-interactive', on); } catch (e) {}
    };
    gear.onmouseenter = () => { gear.style.borderColor = '#58a6ff'; gear.style.color = '#58a6ff'; _hoverInteractive(true); };
    gear.onmouseleave = () => {
      gear.style.borderColor = setupOn && isOverlayWindow ? '#d69922' : '#2a3140';
      gear.style.color       = setupOn && isOverlayWindow ? '#d69922' : '#c9d1d9';
      _hoverInteractive(false);
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

    // ✕ close button — overlay (panel) windows only. Closes this floating
    // panel directly so the user isn't stuck with a window they can't get rid
    // of (tester feedback: panel overlays popped up full-window with no way to
    // close). Sits just left of the gear. Works when locked via hover-interact.
    if (isOverlayWindow) {
      const close = document.createElement('button');
      close.textContent = '✕';
      close.title = 'Close this overlay';
      close.setAttribute('style', [
        'position:fixed', 'top:10px', 'right:52px', 'z-index:99999',
        'width:34px', 'height:34px', 'border-radius:8px',
        'background:#161b22', 'color:#c9d1d9', 'border:1px solid #2a3140',
        'font-size:15px', 'cursor:pointer', 'line-height:1',
      ].join(';'));
      close.onmouseenter = () => { close.style.borderColor = '#f87171'; close.style.color = '#f87171'; _hoverInteractive(true); };
      close.onmouseleave = () => { close.style.borderColor = '#2a3140'; close.style.color = '#c9d1d9'; _hoverInteractive(false); };
      close.onclick = () => { try { ipcRenderer.invoke('hide-overlay'); } catch (e) {} };
      document.body.appendChild(close);

      // ✥ move square — top-left corner. Drag the panel overlay directly
      // without flipping Setup mode. Works when the window is locked
      // (click-through) via the same hover-interact handshake: keep the window
      // interactive through the drag so document mouseup still fires, then
      // restore click-through after.
      const move = document.createElement('button');
      move.textContent = '✥';
      move.title = 'Drag to move this overlay';
      move.setAttribute('style', [
        'position:fixed', 'top:10px', 'left:12px', 'z-index:99999',
        'width:34px', 'height:34px', 'border-radius:8px',
        'background:#161b22', 'color:#c9d1d9', 'border:1px solid #2a3140',
        'font-size:15px', 'cursor:move', 'line-height:1',
      ].join(';'));
      let _panelDragging = false;
      move.onmouseenter = () => { move.style.borderColor = '#58a6ff'; move.style.color = '#58a6ff'; _hoverInteractive(true); };
      move.onmouseleave = () => { move.style.borderColor = '#2a3140'; move.style.color = '#c9d1d9'; if (!_panelDragging) _hoverInteractive(false); };
      move.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        _panelDragging = true;
        try { ipcRenderer.invoke('overlay-drag-start'); } catch (err) {}
      };
      document.addEventListener('mouseup', () => {
        if (_panelDragging) {
          _panelDragging = false;
          try { ipcRenderer.invoke('overlay-drag-end'); } catch (err) {}
          _hoverInteractive(false);
        }
      });
      document.body.appendChild(move);
    }

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

    // "Update ready" banner — replaces the naggy OS pop-up. Shows when a Mimic
    // update has downloaded (status.updatePending); restarts to apply on click.
    // The update also applies on its own at the next quit, so this is purely a
    // convenience nudge, not a demand.
    const upd = document.createElement('div');
    upd.id = 'mimic-update-banner';
    upd.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
      'display:none', 'align-items:center', 'justify-content:center', 'gap:10px',
      'padding:8px 14px', 'background:#0f2a1a', 'color:#56d364',
      'border-bottom:1px solid #1a7f37', 'font-size:13px', 'font-family:ui-monospace,Consolas,monospace',
    ].join(';'));
    const updMsg = document.createElement('span');
    const updBtn = document.createElement('button');
    updBtn.textContent = 'Restart to update';
    updBtn.setAttribute('style', [
      'background:#1a7f37', 'color:#fff', 'border:none', 'border-radius:5px',
      'padding:4px 12px', 'cursor:pointer', 'font-size:12px',
    ].join(';'));
    updBtn.onclick = () => { try { ipcRenderer.invoke('restart-to-update'); } catch (e) {} };
    const updDismiss = document.createElement('button');
    updDismiss.textContent = '✕';
    updDismiss.title = 'Dismiss (the update still applies next time you close Mimic)';
    updDismiss.setAttribute('style', [
      'background:transparent', 'color:#56d364', 'border:none', 'cursor:pointer', 'font-size:13px',
    ].join(';'));
    let _updDismissed = false;
    updDismiss.onclick = () => { _updDismissed = true; upd.style.display = 'none'; place(); };
    upd.appendChild(updMsg);
    upd.appendChild(updBtn);
    upd.appendChild(updDismiss);
    document.body.appendChild(upd);

    // Stack the two banners (update on top) and slide the gear below whichever
    // is showing.
    const place = () => {
      const updOn  = upd.style.display !== 'none';
      const connOn = banner.style.display !== 'none';
      banner.style.top = updOn ? '34px' : '0';
      gear.style.top = (updOn && connOn) ? '74px' : (updOn || connOn) ? '50px' : '10px';
    };
    const refreshBanner = (s) => {
      banner.style.display = (s && s.localOnly) ? 'flex' : 'none';
      if (s && s.updatePending && !_updDismissed) {
        updMsg.innerHTML = '⬆ <b>Mimic v' + String(s.updatePending).replace(/[<>&]/g, '') + ' is ready.</b> Restart to update — or it applies next time you close Mimic.';
        upd.style.display = 'flex';
      } else {
        upd.style.display = 'none';
      }
      place();
    };
    // Initial + live updates.
    ipcRenderer.invoke('get-status').then(refreshBanner).catch(() => {});
    ipcRenderer.on('status', (_e, s) => refreshBanner(s));
  });
}
