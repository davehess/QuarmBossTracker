# Wolf Pack Mimic on Steam Deck / Linux (#156)

Native Linux build of Mimic for the Steam Deck (and any Linux EQ setup running
Project Quarm under Wine/Proton). This is the working design + setup guide for
the build cut on `claude/sharp-lamport-dC0TW`. **It does not touch the Windows
fleet** — the stable/beta Mimic builds are unchanged.

## What works where

| Feature | Native Linux | Needs |
|---|---|---|
| **UI Studio** — resolution updates, hotkey/spellset backup + import | ✅ Phase 1 | just the EQ folder path (ini files are plain files on the Linux FS) |
| **Dashboard** (`localhost:7779`) | ✅ Phase 1 | nothing — it's a local web server |
| **Log-based upload** — parses, /gu + /rs chat, triggers that key off log lines | ✅ Phase 1 | the EQ folder path (tails `eqlog_*_pq.proj.txt`) |
| **Resolution lock** — puts `[VideoMode]` back to 1280×800 after the client stomps it to 4:3 | ✅ Phase 1, **opt-in** | the EQ folder path. Off by default; corrects the file only while EQ is closed (the client holds it open and rewrites it at exit). See `DECISIONS-2026-08-24.md` |
| **Live overlays** — DPS/Tank HUD, Target Info, Buff queue, charm/pet | ⚠️ Phase 2 | Zeal's Windows named pipe **bridged out of Wine** (winestreamproxy) |
| **Auto-update** | later | Linux `latest.yml` channel — off for the hand-built AppImage |

The split is fundamental: UI Studio and the dashboard are filesystem + HTTP, so
they run natively. The overlays read **Zeal's `\\.\pipe\zeal_<pid>` named pipe**,
which lives *inside* the Wine prefix — a native Linux process can't see it
without a bridge. Phase 2 is that bridge, and it's genuinely experimental (make-
or-break is whether Zeal's DX hook survives DXVK under Proton).

---

## Recommended reference setup (fresh install)

You said you'd install fresh for a cleaner result — do. A **known, fixed layout**
makes EQ auto-detection deterministic and gives the pipe bridge a predictable
socket path. Use **Bottles** (matches your "same bottle" wording and makes it
trivial to add the bridge later).

1. **Install Bottles** (Discover → Bottles, or `flatpak install flathub com.usebottles.bottles`).
2. **Create one gaming bottle** named exactly **`Quarm`**. That fixes the prefix at:
   ```
   ~/.var/app/com.usebottles.bottles/data/bottles/bottles/Quarm/drive_c/
   ```
3. **Put EQ at a fixed subfolder**: extract your TAKP/Quarm files (no installer —
   it's a folder copy) to:
   ```
   .../Quarm/drive_c/Quarm/          ← eqgame.exe + eqclient.ini + UI_*.ini live here
   ```
4. **Install Zeal** into that same EQ folder as you would on Windows.
5. **Run EQ from the bottle** (add `eqgame.exe patchme` as the bottle's program,
   or a shortcut). Confirm it launches and writes `eqlog_<You>_pq.proj.txt`.

Mimic's Linux detector already scans Bottles/Lutris/Proton/`~/.wine` prefixes for
`eqgame.exe` + `eqlog_*` — with the layout above it will find `.../Quarm/drive_c/Quarm`
on its own. If it doesn't, the **Settings → pick EQ folder** dialog always works;
point it at that folder once and Mimic remembers it.

> Lutris works too (the detector scans `~/Games/*/drive_c`), but Bottles gives the
> cleanest path for the Phase 2 bridge, so prefer it if starting fresh.

---

## Phase 1 — install & run

1. Download `Wolf-Pack-Mimic-<ver>-linux-x86_64.AppImage` (from the
   **build-mimic-linux** GitHub Action artifact — link comes with the build).
2. Make it executable and run it (Deck **Desktop Mode**):
   ```bash
   chmod +x Wolf-Pack-Mimic-*-linux-x86_64.AppImage
   ./Wolf-Pack-Mimic-*-linux-x86_64.AppImage
   ```
   The AppImage already passes `--no-sandbox` (SteamOS has no user-namespace
   sandbox helper); if it ever refuses to start, run it with
   `--appimage-extract-and-run`.
3. Sign in with Discord, let it detect (or pick) your EQ folder.
4. **UI Studio** tab → back up your current UI, edit resolution, swap
   hotkeys/spellsets, import onto another character — all against the ini files
   in the bottle. Backups write a `.bak` first, exactly like Windows.

### Reaching the dashboard while you play (the "same bottle" ask)

You **don't** need the dashboard inside Wine. Mimic serves it at
`http://localhost:7779` on the Linux host, so:
- **Desktop Mode:** open it in Firefox/Chromium — bookmark it.
- **Gaming Mode:** add it as a **non-Steam shortcut** (a browser launched at
  `http://localhost:7779`) so it shows in your library, *or* use the Steam
  overlay's built-in browser on that URL. Either way it floats over EQ without
  alt-tabbing.

I can drop a `wolfpack-dashboard.desktop` launcher into the build if you want a
one-tap icon — say the word.

---

## Phase 2 — live overlays via the Wine→Unix pipe bridge (experimental)

Goal: expose Zeal's named pipe to the native Linux Mimic so the overlays get
their live gauge/target/HP stream. The clean tool is **winestreamproxy**
(github.com/openglfreak/winestreamproxy) — it runs a tiny server *inside* the
Wine prefix that connects to a Win32 named pipe and forwards its bytes to a Unix
socket on the Linux side.

**Flow:** `Zeal (\\.\pipe\zeal_<pid>) → winestreamproxy (in the bottle) → /tmp/zeal.sock (Linux) → Mimic`

Mimic side is already wired: set the env var **`ZEAL_PIPE_SOCKET`** to the Unix
socket path and the Zeal reader connects to it via `net.connect({ path })` — the
JSON framing is byte-identical to the Windows pipe, so every overlay works
unchanged once bytes flow.

Deck side (the part we'll iterate on together, on your hardware):
```bash
# in the Quarm bottle's Wine prefix
winestreamproxy 'zeal_<PID>' 'unix:///tmp/zeal.sock'    # forwards the pipe → socket
# then launch Mimic with the socket wired up:
ZEAL_PIPE_SOCKET=/tmp/zeal.sock ./Wolf-Pack-Mimic-*-linux-x86_64.AppImage
```
Open questions we can only answer on the Deck:
- Does Zeal even create its pipe under Proton/DXVK? (Its overlay is a DX hook —
  if the hook doesn't load, no pipe exists. This is the make-or-break.)
- The pipe name carries the eqgame PID; a small helper can discover it
  (`WINEPREFIX=… wine tasklist` or Zeal's own log) and template the winestreamproxy
  call. I'll script that once we confirm the pipe exists.

If the DX hook survives, everything downstream is easy. If it doesn't, Phase 1
(UI Studio + dashboard + log upload) still stands on its own.

---

## Background Mode (Gaming Mode vs Desktop Mode)

Gaming Mode (gamescope) can't host our floating overlay windows, and Desktop
Mode changes how the Deck's controller keybinds work — so Mimic detects the
session and adapts:

- **Detection:** `plasmashell` alive → Desktop Mode; gamescope session (no
  plasmashell, `GAMESCOPE_WAYLAND_DISPLAY` / `XDG_CURRENT_DESKTOP=gamescope`) →
  Gaming Mode. Process state beats env vars (env can be stale if Mimic launched
  outside the session). Re-checked every 15s, so switching modes flips it live.
- **`backgroundMode` setting** (`auto` default · `on` · `off`):
  - **auto** — Background Mode ON in Gaming Mode, OFF in Desktop Mode.
  - **on** — always background (audio-only anywhere).
  - **off** — always try to show visual overlays.
- **What Background Mode does:** hides the visual overlay windows only. The
  trigger overlay's renderer keeps running while hidden, so **audio callouts,
  parse/chat upload, and the dashboard are unaffected** — Mimic runs as a
  behind-the-scenes callout companion. Unlocking overlays (setup) still shows
  them, so you can reposition anytime.
- The detected mode is written to the agent log (`[mimic] Steam Deck session:
  gaming → Background Mode …`) so you can confirm detection on the Deck.

> **TTS caveat:** callouts use Chromium's Web Speech API, which on Linux needs
> speech-dispatcher + a voice (espeak-ng) — SteamOS may ship neither. First
> thing to verify on the Deck; if it's silent, the fix is bundling a
> self-contained voice (piper) or pre-rendered clips (both compositor- and
> speech-dispatcher-independent). The `backgroundMode` UI toggle (Auto/On/Off in
> Settings) is a follow-up; `auto` works out of the box.

## Build / delivery

- `.github/workflows/build-mimic-linux.yml` — `workflow_dispatch` on any branch,
  builds the AppImage on `ubuntu-latest` and uploads it as a run **artifact**
  (no release-page clutter, no auto-update channel). This is how you get each
  iteration.
- The AppImage is built from the SAME `apps/mimic` source as Windows; the only
  Linux-specific code is guarded by `process.platform === 'linux'` (EQ-dir scan,
  `--no-sandbox`, `_isEqRunning` via `pgrep`, the `ZEAL_PIPE_SOCKET` reader), so
  it never affects the Windows build.
- Promotion to a real Linux release channel (auto-updating) waits until Phase 1
  is proven on your Deck.
