# Project Quarm on an Android phone (Winlator) — DRAFT, not yet proven

**Status (2026-10-11):** nobody has reported EverQuest running under Winlator. No
report exists for Winlator, Frost, Cmod, Mobox or GameHub either (web search,
2026-10-11). This runbook carries the Steam Deck's *working* Wine recipe
(`docs/RUNBOOK-deck-install.md` on the Deck branch, §5) across to Winlator. Every
step marked **[verify]** is a guess until someone has done it on a phone. When a
step works or fails, write the result here, and keep device details out (no model
serials, IMEI, phone numbers or device names; the repo is public).

**What you get:** the real Windows client with Zeal, in game.
**What you don't get:** Mimic and its overlays (it is a Windows/Linux desktop app
with its own windows), and log uploads (the agent runs inside Mimic). For overlays
on a phone, stream from the PC instead (bottom of this page).

---

## The chain that has to hold

It is the same chain as the Deck. Only the bottom link changes:

```
eqgame.exe → dgVoodoo D3D8.dll (+ dgVoodoo.conf) → D3D11 → DXVK → Vulkan / Turnip (Adreno)
```

Two files in the game folder (`D3D8.dll`, `dgVoodoo.conf`), plus DXVK as the
container's DX wrapper. On the Deck, nothing else in the renderer path is
load-bearing.

## 1. Install Winlator

- The official build only: `github.com/brunodev85/Winlator` → Releases → the APK.
  The README named 11.2 as current on 2026-10-11. Drop any other fork you tried
  first.
- Samsung phones: **Auto Blocker** refuses sideloaded APKs. Turn it off, install,
  then turn it back on.
- **Google Play Protect then shows "Unsafe app blocked … built for an older
  version of Android"** (Android 16, 2026-10-11). This is about the Android
  version the app was built for, not a malware finding. The plain-text **"Install
  anyway"** above the green "Got it" button is the way through; "Got it" cancels.
  If "Install anyway" fails, open Play Store → profile → Play Protect → ⚙ and turn
  off "Scan apps with Play Protect". Install, then turn it back on.
- "App not installed" after that usually means another Winlator build is still
  installed with a different signature. Uninstall it first.
- On first run Winlator unpacks its system files. Let it finish.

## 2. Copy the EQ folder over

- Copy **the PC folder you actually raid from**: it already has `D3D8.dll`,
  `dgVoodoo.conf`, `Zeal.asi` and your `uifiles/`. Zip it on the PC, leaving out
  `Logs/` and old `eqlog_*.txt` (they are big and not needed).
- Put the zip in the phone's **Download** folder and unzip it there, so you get
  `Download/EQ/eqgame.exe`.
- Community guides say Winlator's **D:** drive is the Download folder. **[verify]**
  Check it in the container's Drives settings.

## 3. Create the container

| Setting | First try | If that fails |
|---|---|---|
| Wine version | the default | — |
| Box64 preset | **Stability** (for the first boot only) | then Intermediate, then Performance, once it boots |
| Graphics driver | **Turnip** (Snapdragon / Adreno; Adreno 750 is in the A7xx builds) | a Turnip build labelled "One UI" (Samsung); then the **system** driver; then Vortek |
| DX wrapper | **DXVK** (default version) | an older DXVK (1.10.x) |
| Screen size | **1280×720** | — |
| Audio | default | — |

**Environment variables** (Container settings → Environment variables):

- `MESA_EXTENSION_MAX_YEAR=2003`: Winlator's own README gives this one for older
  games that will not open.
- `WINEDLLOVERRIDES=d3d8=n,b`: load dgVoodoo's `D3D8.dll` from the game folder
  ahead of Wine's own. **[verify]** that Winlator passes the variable through to
  Wine as written.

## 4. Two file edits before the first launch

- **`eqclient.ini` → `[VideoMode]`:** set `Width=1280` and `Height=720` to match
  the container. ⚠ The client resets this to 4:3 when it exits (seen on the Deck),
  so check it again if the screen looks wrong.
- **`dgVoodoo.conf` → `[GeneralExt]` → `FPSLimit = 30`** (or 60). EverQuest ignores
  the FPS limit in `eqclient.ini`, and dgVoodoo ships uncapped. On a phone,
  uncapped means heat and a fast-draining battery for frames nobody sees.

## 5. Launch

- Make a **shortcut** to `D:\EQ\eqgame.exe`, with **`patchme`** as its argument
  (skips the client's own patcher, as the Deck launcher does) and **the EQ folder
  as its working directory**.
- The working directory matters: the client loads `eqmain.dll` by relative path.
- Set the shortcut's controls profile to **None** when a keyboard and mouse are
  connected.
- You want, in order: splash → login → server select → **character select** →
  in game. Stop at the first step that does not happen and look it up below.

| You see | Means | Try |
|---|---|---|
| `Failed to load the graphics DLL!` | dgVoodoo's `D3D8.dll` did not load | check it is beside `eqgame.exe`; check the `WINEDLLOVERRIDES` line |
| `EverQuest requires DirectX 6.0 or higher` | no working D3D11 behind dgVoodoo | DX wrapper must be DXVK, driver Turnip; then try the older DXVK |
| `Couldn't load eqmain.dll`, **after** splash art | working directory is wrong (the graphics already worked) | set the shortcut's working directory to the EQ folder |
| crash or black screen at boot | Box64 or the driver | Box64 **Stability**; then driver Vortek |
| still nothing | the dgVoodoo route itself | **Plan B:** move `D3D8.dll` aside (do not delete it), set the DX wrapper to **WineD3D**, remove the override and launch again |

## 6. Zeal

- Install Zeal only **after** a clean character select. A mod on top of a client
  that does not boot makes the next failure impossible to diagnose.
- It is the same `Zeal.asi` that is already in the copied folder. How the client
  loads it is not established (Deck runbook §3a [verify]). Do not guess at a
  loader. If Zeal's options do not appear in game, write that here.

## 7. Input

- A Bluetooth keyboard and mouse are the realistic way to play. Touch alone does
  not cover hotkeys, chat and mouse-look.
- How right-click and mouse-look behave under Winlator: **[verify]**. Nothing was
  found on it.

## 8. What to report back

Which step you reached; the exact error text (a photo of the box is fine); and
which row of the step 3 table you were on. Leave out phone identifiers.

---

## The dependable fallback: stream the PC

Moonlight on the phone with Sunshine on the PC, or Steam Link, runs **the real PC
client**: Mimic, overlays, log uploads, all of it. The costs are a PC that stays
on, and Wi-Fi/LTE latency. It is the right answer for "play from the couch". The
Winlator route is for "the PC is not on".

- Sunshine captures the composed desktop (Desktop Duplication), so Mimic's
  always-on-top overlays should appear in the stream. **[verify]** Run EQ
  **windowed or borderless**: Desktop Duplication has trouble with
  exclusive-fullscreen games.
- Use the native Moonlight Android app. A browser client exists
  (`moonlight-web-stream`, WebRTC), but it needs HTTPS for keyboard lock and its
  low-latency path, and nothing confirms it works in mobile Chrome.

## Games in the browser (checked 2026-10-11, not a route)

- **No browser EverQuest client can play Quarm.** EQ Requiem is an archived
  experiment with its own server, aimed at the RoF2/Titanium clients, not the
  Mac-era protocol Quarm speaks. LanternEQ is a Unity remake, not a browser
  client. Quarm's rules also ban unapproved programs that interact with the client
  (rule 3; approved ones are listed in `#server-files`).
- **Windows-in-the-browser** (BoxedWine, CheerpX): about 1 fps on 3D games in the
  reports found. Not playable.
- **Mimic in a phone browser is possible.** The overlays are plain HTML that poll
  the agent over HTTP. The agent is OS-neutral Node and could run in Termux,
  tailing the log Winlator writes to `Download/`. This would need a small agent
  change: serve the overlay files from the agent itself, and take the port from
  the page address. Only log-driven panels would work (triggers, timers, the DPS
  meter); anything fed by Zeal's pipe stays dark, because that pipe lives inside
  Wine. Not built (DECISIONS §234).
