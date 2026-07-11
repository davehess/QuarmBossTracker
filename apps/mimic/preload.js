// Preload — minimal contextBridge surface. No nodeIntegration in renderers.
const { contextBridge, ipcRenderer } = require('electron');

// ── Shared overlay chrome helpers ──────────────────────────────────────────
// Every built-in overlay used to inline ~35 lines of right-click menu HTML +
// styling + hover-interactive handshake. They drifted over time ("alignment
// is all different across each one"), and small windows clipped the bottom
// of the menu. Centralized here so one fix lands on every overlay at once.

// Inner-menu hover handshake — same forward-true click-through pattern as
// the corner controls: flip the window briefly interactive while the cursor
// is over an item, then restore the lock state on mouseleave.
function _hoverOn()  { try { ipcRenderer.invoke('overlay-hover-interactive', true);  } catch (e) {} }
function _hoverOff() { try { ipcRenderer.invoke('overlay-hover-interactive', false); } catch (e) {} }

// ── Document-level hover-interact (the windowed-fullscreen fix) ─────────────
// Locked overlays are click-through with {forward:true}, so the renderer
// still sees mousemove while EQ keeps the cursor. Only the corner controls
// (✕ / ✥ / ⚙) had per-element arm/disarm wiring — every OTHER control
// (Mob Info's Stats/Loot/Spells tabs, the HUD's DPS/Tank tabs, charm
// buttons, melody toggles…) never armed the window, so players in windowed
// fullscreen had to alt-tab to Mimic before any overlay click would land.
// One capture-phase mousemove in the preload covers every overlay at once:
// cursor over anything interactive → arm; off it → restore the lock state.
// The legacy per-element handlers stay (harmless — the IPC is idempotent).
let _wpHoverArmed = false;
// OVERLAY DOCUMENTS ONLY. This preload also loads in the MAIN window,
// settings, and UI Studio — none of which are ever click-through, and on a
// solid (non-transparent) window an accidental setIgnoreMouseEvents(true) is
// UNRECOVERABLE: mouse forwarding only works on transparent windows, so no
// mousemove ever reaches the page again to re-arm it (the "Mimic window
// completely dead" bug). Every overlay HTML carries the ✥ #move-btn; gate on
// its presence, cached once the DOM can answer. main.js refuses the IPC from
// non-overlay windows too — this just stops the wasted invoke traffic.
let _wpIsOverlayDoc = null;
function _wpOverlayDoc() {
  if (_wpIsOverlayDoc === null && document.body) {
    _wpIsOverlayDoc = !!document.getElementById('move-btn');
  }
  return _wpIsOverlayDoc === true;
}
function _wpIsInteractive(el) {
  while (el && el.nodeType === 1 && el !== document.body) {
    try {
      if (el.matches('button, a, input, select, textarea, [role="button"], [data-wp-interact]')) return true;
    } catch (e) { return false; }
    el = el.parentElement;
  }
  return false;
}
let _wpLastAssert = 0;
document.addEventListener('mousemove', function (ev) {
  if (!_wpOverlayDoc()) return;
  const want = _wpIsInteractive(ev.target);
  const now = Date.now();
  if (want) {
    // Re-assert every 150ms while over a control — a legacy per-element
    // mouseleave (button → button hop) may have disarmed behind our back,
    // and the IPC is cheap enough to keep this authoritative.
    if (!_wpHoverArmed || (now - _wpLastAssert) > 150) { _hoverOn(); _wpLastAssert = now; }
    _wpHoverArmed = true;
  } else if (_wpHoverArmed) {
    _wpHoverArmed = false;
    _hoverOff();
  }
}, { capture: true, passive: true });
// Cursor left the window entirely (possible straight off a button edge) —
// make sure the click-through state is restored for the game.
document.addEventListener('mouseout', function (ev) {
  if (!_wpOverlayDoc()) return;
  if (!ev.relatedTarget && _wpHoverArmed) { _wpHoverArmed = false; _hoverOff(); }
}, { capture: true, passive: true });

// ── Solid backdrop (Uilnayar 2026-07-10) ────────────────────────────────────
// One injected rule + a body class = every overlay gets a toggleable opaque
// plate with zero per-HTML changes. Main pushes 'wp-backdrop' on toggle; the
// load-time pull covers windows created after the last push. Gated to overlay
// documents (the main window / settings must never get a forced background).
ipcRenderer.on('wp-backdrop', function (_e, on) {
  try { if (_wpOverlayDoc()) document.body.classList.toggle('wp-backdrop', !!on); } catch (e) {}
});
document.addEventListener('DOMContentLoaded', function () {
  try {
    const st = document.createElement('style');
    st.textContent = 'body.wp-backdrop{background:rgba(8,10,14,0.92) !important}';
    document.head.appendChild(st);
    ipcRenderer.invoke('wp-overlay-menu-state').then(function (s) {
      if (s && s.backdrop && _wpOverlayDoc()) document.body.classList.add('wp-backdrop');
    }).catch(function () {});
  } catch (e) {}
});

// Build the right-click menu: setup entries, visibility/layout actions, and
// the 5 width presets. Identical structure + styling on every overlay so the
// muscle memory carries. `state` = wp-overlay-menu-state (toggle labels).
function _buildOverlayMenu(onClose, state) {
  const prior = document.getElementById('wpResizeMenu'); if (prior) prior.remove();
  const menu = document.createElement('div');
  menu.id = 'wpResizeMenu';
  menu.style.cssText = [
    'position:fixed', 'top:30px', 'left:6px', 'z-index:200',
    'background:rgba(14,17,22,0.95)', 'border:1px solid rgba(88,166,255,0.4)',
    'border-radius:5px', 'padding:4px',
    'display:flex', 'flex-direction:column', 'gap:2px',
    'font-family:ui-monospace,Menlo,Consolas,monospace',
    'min-width:180px', 'box-shadow:0 4px 12px rgba(0,0,0,0.6)',
  ].join(';');
  const mkItem = (label, accent, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'background:#21262d', 'color:#c9d1d9', 'border:1px solid #30363d',
      'border-radius:3px', 'padding:5px 10px', 'cursor:pointer',
      'text-align:left', 'font-family:inherit', 'font-size:11px',
      'white-space:nowrap',
    ].join(';');
    b.onmouseenter = function() { b.style.background = accent; b.style.color = '#fff'; _hoverOn(); };
    b.onmouseleave = function() { b.style.background = '#21262d'; b.style.color = '#c9d1d9'; };
    b.onclick      = function() { try { onClick(); } catch (e) {} menu.remove(); _hoverOff(); if (onClose) onClose(); };
    return b;
  };
  // "Setup ALL" first — the most-used entry sits at the top.
  menu.appendChild(mkItem('🛠 Setup ALL overlays', '#2a3d57', () => ipcRenderer.invoke('set-setup-mode', true)));
  menu.appendChild(mkItem('🛠 Setup THIS overlay',  '#3d2a57', () => ipcRenderer.invoke('set-setup-mode-this', true)));
  // Visibility + layout actions (Uilnayar 2026-07-10). `state` comes from
  // main's wp-overlay-menu-state so the toggles show their current value.
  const st = state || {};
  menu.appendChild(mkItem('👁 Hide this overlay', '#6b2130', () => ipcRenderer.invoke('hide-overlay')));
  menu.appendChild(mkItem('🌫 Background: ' + (st.backdrop ? 'ON' : 'off') + ' (this overlay)', '#3a3320',
    () => ipcRenderer.invoke('wp-backdrop-toggle')));
  menu.appendChild(mkItem('✨ Auto-arrange overlays', '#20503a',
    () => ipcRenderer.invoke('auto-arrange-overlays')));
  menu.appendChild(mkItem('✨ Arrange when overlays open: ' + (st.arrangeOnShow ? 'ON' : 'off'), '#20503a',
    () => ipcRenderer.invoke('auto-arrange-onshow-toggle')));
  // Thin divider before the size presets so the menu reads "actions / sizes".
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:3px 0';
  menu.appendChild(sep);
  [['xs','XS · 200px wide'], ['sm','S · 260px'], ['md','M · 320px'],
   ['lg','L · 400px'],       ['xl','XL · 500px']].forEach(([key, label]) => {
    menu.appendChild(mkItem(label, '#1f6feb', () => ipcRenderer.invoke('overlay-resize-preset', key)));
  });
  document.body.appendChild(menu);
  return menu;
}

function _attachOverlayMenu(moveBtn) {
  if (!moveBtn || moveBtn._wpMenuAttached) return;
  moveBtn._wpMenuAttached = true;
  moveBtn.addEventListener('contextmenu', function(ev) {
    ev.preventDefault();
    // Grow window first so the menu doesn't clip on tiny overlays. Menu is
    // ~380 px tall (11 items + paddings + divider); 420 leaves a buffer.
    try { ipcRenderer.invoke('overlay-ensure-min-height', 420); } catch (e) {}
    // Fetch toggle states first so Background / Arrange-on-show labels are
    // accurate; menu still opens (with default labels) if the invoke fails.
    ipcRenderer.invoke('wp-overlay-menu-state').catch(function () { return null; }).then(function (state) {
      _openOverlayMenu(state);
    });
  });
}

function _openOverlayMenu(state) {
  const menu = _buildOverlayMenu(_hoverOff, state);
  _hoverOn();
  // Dismiss on outside click. Defer so the click that opened the menu
  // doesn't immediately close it on the same event loop tick.
  setTimeout(function() {
    document.addEventListener('mousedown', function closer(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closer);
        _hoverOff();
      }
    });
  }, 0);
}

// Ask main to size the window to the renderer's content height. Pass the
// wrap element whose scrollHeight defines the desired height; falls back to
// document.body if nothing's passed. Adds a small buffer so the bottom of
// the last card isn't flush against the window edge.
function _autoFitOverlay(wrapEl) {
  try {
    const w = wrapEl || document.getElementById('wrap') || document.body;
    if (!w) return;
    const h = (w.scrollHeight || 0) + 12;
    if (h > 0) ipcRenderer.invoke('overlay-auto-height', h);
  } catch (e) {}
}

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
  // Toggle a named built-in overlay (hud/trigger/charm/pet/mobinfo) on/off from
  // the dashboard's Overlays tab. Returns the updated status snapshot.
  toggleOverlay:   (name) => ipcRenderer.invoke('toggle-overlay', name),
  markOnboarded:   ()     => ipcRenderer.invoke('mark-onboarded'),
  openDashboard:   ()     => ipcRenderer.invoke('open-dashboard'),
  openExternal:    (url)  => ipcRenderer.invoke('open-external', url),
  openZealCapture: ()     => ipcRenderer.invoke('open-zeal-capture'),

  // Overlay lock state — main pushes this to overlay renderers so they can
  // show/hide their drag handle.
  onOverlayLocked: (cb)   => ipcRenderer.on('overlay-locked', (_e, locked) => cb(locked)),
  // Setup-mode state — pushed to each overlay with its identifying key so
  // the renderer can show the per-window control strip (opacity slider, etc.)
  onSetupMode:      (cb)         => ipcRenderer.on('setup-mode', (_e, payload) => cb(payload)),
  setSetupMode:     (on)         => ipcRenderer.invoke('set-setup-mode', !!on),
  // Setup mode for JUST this overlay window — driven by right-click on the
  // ✥ move icon. Doesn't flip the global setupMode.
  setSetupModeThis: (on)          => ipcRenderer.invoke('set-setup-mode-this', on === undefined ? true : !!on),
  setOverlayOpacity:(key, value) => ipcRenderer.invoke('set-overlay-opacity', key, value),
  // Background-alpha push from main → overlay renderer. The slider value drives
  // a CSS variable (--bg-alpha) on each overlay so "100%" means an OPAQUE card
  // surface (EQ hidden) rather than a dimmed window (text + bg fade together).
  // Text colors stay at full brightness; only the card surface alpha changes.
  onBgAlpha:        (cb)         => ipcRenderer.on('bg-alpha', (_e, v) => cb(v)),

  // Manual overlay drag — replaces the buggy Chromium app-region drag on
  // transparent windows. Renderer mousedown on the ✥ handle calls
  // overlayDragStart; document mouseup calls overlayDragEnd.
  overlayDragStart: () => ipcRenderer.invoke('overlay-drag-start'),
  overlayDragEnd:   () => ipcRenderer.invoke('overlay-drag-end'),
  // Renderer reports its content height; main resizes the window to fit so
  // multi-card overlays (charm, pets, /who) grow with their content.
  overlayAutoHeight: (h) => ipcRenderer.invoke('overlay-auto-height', h),
  // (overlayResizePreset / overlayEnsureMinHeight bridge wrappers deleted
  // 2026-07-09 — no overlay ever called them; the shared chrome below invokes
  // the 'overlay-resize-preset' / 'overlay-ensure-min-height' IPC directly.)
  // Shared chrome — wires the right-click "resize presets + Setup THIS/ALL"
  // menu on the ✥ move icon and a content-size auto-fit helper. Every overlay
  // calls these instead of re-implementing them, so they're guaranteed to
  // align + behave identically across the suite.
  attachOverlayMenu: (moveBtn) => _attachOverlayMenu(moveBtn),
  autoFitOverlay:    (wrapEl)  => _autoFitOverlay(wrapEl),

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
  listEqCharacters: () => ipcRenderer.invoke('list-eq-characters'),

  // UI Studio — capture / restore EQ ini files (windows, hotkeys, chat
  // tabs, bandolier, socials, eqclient.ini) so a user can set up an
  // identical install on a different machine.
  uiStudioListDisplays:   ()        => ipcRenderer.invoke('ui-studio-list-displays'),
  uiStudioIsEqRunning:    ()        => ipcRenderer.invoke('ui-studio-eq-running'),
  // Background deferred save — applied by the main process when the character
  // logs out (survives closing UI Studio + a Mimic restart).
  uiStudioDeferSave:      (params)  => ipcRenderer.invoke('ui-studio-defer-save', params),
  uiStudioPendingList:    ()        => ipcRenderer.invoke('ui-studio-pending-list'),
  uiStudioCancelDefer:    (params)  => ipcRenderer.invoke('ui-studio-cancel-defer', params),
  uiStudioListCharacters: ()        => ipcRenderer.invoke('ui-studio-list-characters'),
  uiStudioCapture:        (params)  => ipcRenderer.invoke('ui-studio-capture', params),
  uiStudioListSnapshots:  (character)=> ipcRenderer.invoke('ui-studio-list-snapshots', character),
  uiStudioGetSnapshot:    (params)  => ipcRenderer.invoke('ui-studio-get-snapshot', params),
  uiStudioRestore:        (params)  => ipcRenderer.invoke('ui-studio-restore', params),
  // Visual UI Studio editor — read/write per-character ini bundles for the
  // graphical resolution-rescaling editor. Read returns a raw filename →
  // text map; write takes the edited map and persists with .bak backups.
  uiStudioReadBundle:     (character, eqDir) => ipcRenderer.invoke('ui-studio-read-bundle', character, eqDir),
  uiStudioWriteBundle:    (eqDir, bundle, opts) => ipcRenderer.invoke('ui-studio-write-bundle', eqDir, bundle, opts),
  // Open the standalone UI Studio editor window from the dashboard's nav.
  openUiStudio:           ()                 => ipcRenderer.invoke('open-ui-studio'),
  // Bundled PvP rotation templates (Dirge Team 6™ etc.) — list by class,
  // load full content, and import = write a markdown summary alongside
  // the EQ folder so the user can build their hotkey pages by reference
  // without risking the live socials INI.
  uiStudioListPvpSets:    (characterClass)   => ipcRenderer.invoke('ui-studio-list-pvp-sets', characterClass),
  uiStudioLoadPvpSet:     (id)               => ipcRenderer.invoke('ui-studio-load-pvp-set', id),
  uiStudioImportPvpSet:   (params)           => ipcRenderer.invoke('ui-studio-import-pvp-set', params),
  // Backup + capture flow — surface the existing cloud-backup IPC from
  // the visual editor + add a heuristic local capture for Sock_/Socials_
  // files so users can share their PvP setups as draft templates.
  uiStudioInspectSocials: (character, eqDir) => ipcRenderer.invoke('ui-studio-inspect-socials', character, eqDir),
  // Surgical write-back for the UI Inspector's editable HotButton + Socials
  // fields. edits = [{ file, section, key, value | null }, ...] — null deletes
  // the key. Preserves comments/order; .studio-*.bak written before save.
  uiStudioWritePages:    (eqDir, edits)      => ipcRenderer.invoke('ui-studio-write-pages', eqDir, edits),
  // Scan the active UI skin's XML files for each window's design size — used
  // as the authoritative MAX size in the visual layout. Returns { skin, sizes }.
  uiStudioScanWindowDefaults: (eqDir)        => ipcRenderer.invoke('ui-studio-scan-window-defaults', eqDir),
  uiStudioCapturePvpDraft:(params)           => ipcRenderer.invoke('ui-studio-capture-pvp-draft', params),

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
