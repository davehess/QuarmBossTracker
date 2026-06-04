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
; A discoverable Start Menu uninstaller. electron-builder registers the
; Add/Remove Programs entry, but testers expected to FIND an uninstaller — so
; drop a shortcut next to the app's Start Menu entry. ${UNINSTALL_FILENAME} is
; the electron-builder-provided uninstaller exe name in $INSTDIR.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Uninstall Wolf Pack Mimic.lnk" "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall Wolf Pack Mimic.lnk"
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\wolfpack-mimic"
    RMDir /r "$APPDATA\Wolf Pack Mimic"
  ${endIf}
!macroend
