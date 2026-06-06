; Custom NSIS hooks for Wolf Pack Mimic. electron-builder includes this via
; build.nsis.include and invokes the customUnInstall macro from the generated
; uninstaller.
;
; Goal: a *complete* uninstall. The standard uninstaller removes the installed
; program files but leaves the per-user data directory Electron created at
;   %APPDATA%\Wolf Pack Mimic
; which holds mimic.config.json (the saved Discord login + agent token + EQ
; folder list), agent.log, the staged agent copy, and the upload-queue state.
; Testers reported "it doesn't fully uninstall" — this is that leftover folder.
; We remove it on a genuine user uninstall.
;
; CRITICAL — DO NOT delete appData during an auto-update. electron-updater
; applies a new version by silently running the OLD uninstaller, which calls
; this same macro. In that path electron-builder sets ${isUpdated}. Deleting
; the data dir there would wipe every user's saved login + token + settings on
; every single update. The guard below restricts deletion to real uninstalls.
;
; NOTE: $APPDATA in NSIS is the Roaming AppData root, where Electron's
; app.getPath('userData') resolves. Electron uses the package `name` (NOT the
; build productName, which only lives in the electron-builder config) for
; app.getName(), so the real folder is %APPDATA%\wolfpack-mimic — confirmed by
; the boot log "userData=...\AppData\Roaming\wolfpack-mimic". We also sweep the
; productName-cased path in case a future build flips that mapping; RMDir on a
; missing path is a harmless no-op.
; Directory-page guidance + install-mode framing.
;
; Install mode: this installer is per-user (build.nsis.perMachine=false) with
; elevation disabled (allowElevation=false), so it NEVER triggers a UAC prompt
; and NEVER asks "install for all users / just me" — it always installs only
; for the current logged-in user, into %LOCALAPPDATA%\Programs. That default IS
; the "Express / Fast" path: the user can simply click Install without touching
; anything. The directory page is still shown (allowToChangeInstallationDirectory
; =true) so anyone who wants a "Custom" location can change it — but it's
; optional, and the default needs no decision.
;
; Testers (incl. the guild leader) had a hard time choosing an install location
; because it wasn't clear what the choice means — and one tester dropped the
; setup .exe into his EverQuest folder expecting it to install there / be his EQ
; folder. So the copy below makes explicit: the default is recommended (just
; click Install), this is only where the small Mimic APP lives (NOT your
; EverQuest folder), and the EQ folder is picked INSIDE the app on first run.
; customHeader is inserted before the MUI pages, so the define lands in time.
; Guard with !ifndef so we never collide with an electron-builder define (a
; redefine would error; a no-op never breaks the build). If the assisted
; template doesn't consume this constant, it's simply ignored — harmless either
; way.
!macro customHeader
  !ifndef MUI_DIRECTORYPAGE_TEXT_TOP
    !define MUI_DIRECTORYPAGE_TEXT_TOP "Fast install: just click Install — the default location below is recommended for almost everyone (it installs only for you, no admin needed). This is only where the small Mimic app lives, NOT your EverQuest folder — Mimic finds your EQ logs for you on first run. Custom: change the folder below if you'd rather keep everything in one place."
  !endif
!macroend

; Skip the "Choose Installation Options / Who should this be installed for?"
; page entirely. perMachine=false + allowElevation=false already prevent the
; all-users path + UAC, but electron-builder's assisted template STILL renders
; that selection page (with the all-users option greyed out and the current
; user's real name shown, e.g. "Only for me (Dave)"). Forcing
; $isForceCurrentInstall in customInstallMode — the documented electron-builder
; hook, invoked before the install-mode page is decided — makes the installer
; commit to a per-user install and drop the page, so the first thing the user
; sees is the install-location page (where "just click Install" is the fast
; path). Also removes the personal-name label from the flow.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; A discoverable Start Menu uninstaller. electron-builder registers the
; Add/Remove Programs entry, but testers expected to FIND an uninstaller — so
; drop a shortcut next to the app's Start Menu entry. ${UNINSTALL_FILENAME} is
; the electron-builder-provided uninstaller exe name in $INSTDIR.
;
; Also opts the user into Start-with-Windows on install — they kept asking for
; an installer-time autostart toggle, so we make autostart the default by
; writing the per-user Run key with --autostart. Mimic's tray "Start with
; Windows" toggle hooks the same HKCU\…\Run path via Electron's
; setLoginItemSettings, so the user can flip it later without re-running the
; installer. The --autostart arg signals createMainWindow() to start
; hidden-to-tray so login sessions don't ambush them with the dashboard.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Uninstall Wolf Pack Mimic.lnk" "$INSTDIR\${UNINSTALL_FILENAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WolfPackMimic" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall Wolf Pack Mimic.lnk"
  ; Real uninstall (NOT an electron-updater silent in-place re-install) — drop
  ; the autostart Run key so we don't try to relaunch from a deleted path next
  ; login. ${isUpdated} preserves user preference across update reinstalls.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WolfPackMimic"
    RMDir /r "$APPDATA\wolfpack-mimic"
    RMDir /r "$APPDATA\Wolf Pack Mimic"
  ${endIf}
!macroend
