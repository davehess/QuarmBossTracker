# Wolf Pack Mimic on Steam Deck / Linux (#156)

Native Linux build of Mimic for the Steam Deck (and any Linux EQ setup running
Project Quarm under Wine/Proton). **It does not touch the Windows fleet** — the
stable/beta Mimic builds are unchanged; the Linux build ships on its own
`linux.yml` channel from `build-mimic-linux.yml`.

> **Installing?** Follow **`docs/RUNBOOK-deck-install.md`** — the ordered,
> checkable install (prereqs → pinned GE-Proton → lutris.net script → the
> renderer chain → Mimic → Zeal last), with the failure signatures for every way
> it breaks. Before you play, run **`bash scripts/deck-preflight.sh`**.
> This file is the *design + capability* map; the runbook is the *procedure*.

## Status — where the Deck line actually stands (2026-08-23)

| Feature | Native Linux | Needs |
|---|---|---|
| **Mimic itself** — launches and renders on the Deck | ✅ **field-verified** (2.6.1-linux.19) | nothing — the AppImage runs in Desktop Mode |
| **UI Studio** — resolution presets (1280×800 + 1440×900), hotkey/spellset backup + import | ✅ Phase 1 | just the EQ folder path (ini files are plain files on the Linux FS) |
| **Dashboard** (`localhost:7779`) | ✅ Phase 1 | nothing — it's a local web server |
| **Log-based upload** — parses, /gu + /rs chat, triggers that key off log lines | ✅ Phase 1 | the EQ folder path (tails `eqlog_*_pq.proj.txt`) |
| **Zeal + custom-UI-pack install** — one click, no file dragging | ✅ Phase 1 | the EQ folder path; EQ closed for the Zeal write |
| **EQ itself** — client boots and renders under Lutris + GE-Proton | ✅ **field-verified**, chain documented | the dgVoodoo → DXVK chain intact (`RUNBOOK-deck-install.md` §5) |
| **Resolution lock** — puts `[VideoMode]` back to the Deck target after the client stomps it to 4:3 | ✅ **landed**, opt-in, no Settings card yet | the EQ folder path. Off by default; corrects the file only while EQ is closed (the client holds it open and rewrites it at exit). See `DECISIONS-2026-08-24.md` |
| **Live overlays** — DPS/Tank HUD, Mob Info, Buff queue, charm/pet | ⚠️ Phase 2 — bridge supervisor **landed**, needs `outflow.exe` dropped in + on-Deck verification | Zeal's Windows named pipe **bridged out of Wine** from inside EQ's own wineserver (`linuxZealBridge.js`); see `docs/mimic-steamdeck-zeal-bridge.md` |
| **Auto-update** | ✅ on the isolated `linux` channel | `autoUpdater.channel = 'linux'`; never serves Windows clients |

The split is fundamental: UI Studio and the dashboard are filesystem + HTTP, so
they run natively. The overlays read **Zeal's `\\.\pipe\zeal_<pid>` named pipe**,
which lives *inside* the Wine prefix — a native Linux process can't see it
without a bridge. Phase 2 is that bridge.

### What 2026-08-23 settled on the EQ side

The evening's real cost was the **renderer chain**, not Mimic. Recorded in full
in `docs/RUNBOOK-deck-install.md` §5; the short version:

- The Quarm client is the **TAKP/EQMac-era D3D8 client**. On a Deck it renders
  through `eqgame → dgVoodoo D3D8 → D3D11 → DXVK → Vulkan/RADV`, and every link
  is load-bearing.
- **Two files in the game folder are the whole dgVoodoo requirement:
  `D3D8.dll` + `dgVoodoo.conf`.** (`D3D9.dll` and the `*backup.dll` copies exist
  on both Deck installs but are absent from the working Windows desktop set —
  installer drift, not requirement.)
- Break the wrapper and you get **`Failed to load the graphics DLL!`**; break
  DXVK behind it and you get **`EverQuest requires DirectX 6.0 or higher`**,
  with `dxgi_factory_IsCurrent` stub / `shader_set_limits "4.0"` /
  `CheckFormatSupport` partial-stub in the Wine log. Two strings, two
  directions — debug from the signature.
- **Bottles is not the destination** (its sandboxed wineserver blocks the
  bridge), and it carries two traps that produce those signatures: a
  **per-program** override can force DXVK off while the bottle says on, and an
  **empty Working Directory** hangs the client after the splash.
- ⚠ **Mimic's Linux auto-detect scans `~/Games/<name>/drive_c`**, but a Lutris
  install can put `eqgame.exe` at the **prefix root, beside `drive_c`** (observed:
  `/home/deck/Games/ProjectQuarm`). Auto-detect misses that layout — the
  Settings folder-picker is the answer, and the preflight script flags it.

---

## Recommended reference setup (fresh install)

**Lutris + a pinned GE-Proton, installed by the lutris.net Quarm script.** Full
procedure: **`docs/RUNBOOK-deck-install.md`**.

Two reasons this is the destination, not a preference:

1. **The Zeal bridge needs a host wineserver.** Bottles runs Wine inside a
   Flatpak sandbox with its own `/tmp` + `XDG_RUNTIME_DIR`, so a bridge started
   as a normal host process talks to a *different* wineserver and sees nothing.
   No env var fixes it — it is a deployment property
   (`docs/mimic-steamdeck-zeal-bridge.md`).
2. **The installer script encodes the working prefix** — the dgVoodoo placement
   and the DLL overrides the renderer chain depends on. A hand-built prefix is
   how you end up debugging §5 of the runbook.

> ⚠ **This reverses the earlier recommendation in this file, which said to use
> Bottles.** It was written before the wineserver constraint was understood and
> before the 2026-08-23 field session; Bottles also carries the two traps in
> `RUNBOOK-deck-install.md` §6. If you are on Bottles today, that section has the
> migration checklist.

Mimic's Linux detector scans Bottles/Lutris/Proton/`~/.wine` prefixes for
`eqgame.exe` + `eqlog_*`, but see the prefix-root caveat above — **the
Settings → pick EQ folder dialog always works**, and on the Deck it is the
recommended step rather than the fallback.

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

> **Status: implementation in progress** (companion work on this line, as of
> 2026-08-23). **`docs/mimic-steamdeck-zeal-bridge.md` is the current design and
> supersedes this section** — it prefers **`outflow`** (Wine 10 `AF_UNIX`, with an
> `--outbound-pipe` mode matching Zeal's `PIPE_ACCESS_OUTBOUND`) over
> winestreamproxy, and it is where the wineserver constraint that rules out
> Bottles is worked through. The sketch below is kept for the flow diagram and
> the Mimic-side wiring, both of which are unchanged.

Goal: expose Zeal's named pipe to the native Linux Mimic so the overlays get
their live gauge/target/HP stream. The original candidate was **winestreamproxy**
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

- `.github/workflows/build-mimic-linux.yml` — builds the AppImage on
  `ubuntu-latest` from a `claude/**` working branch and publishes it as a
  prerelease versioned **`<parked>-linux.<run_number>`** (e.g. `2.6.1-linux.19`).
  The `-linux.N` prerelease suffix is what makes electron-builder emit
  **`linux.yml`** — the isolated channel the Linux client pins via
  `autoUpdater.channel = 'linux'`. Windows clients read `latest`/`beta` and can
  never install a `-linux.N` build.
  ⚠ **Isolation covers what a client INSTALLS, not how it DISCOVERS releases** —
  every release lands in one 10-entry `releases.atom` feed, and a burst of Deck
  builds once pushed the whole Windows beta channel out of it.
  `prune-linux-releases.yml` runs after every Linux build to keep that from
  recurring. See CLAUDE.md → "Mimic release channels".
- The AppImage is built from the SAME `apps/mimic` source as Windows; the only
  Linux-specific code is guarded by `process.platform === 'linux'` (EQ-dir scan,
  `--no-sandbox`, `_isEqRunning` via `pgrep`, the `ZEAL_PIPE_SOCKET` reader), so
  it never affects the Windows build.
- Phase 1 **is** proven on the Deck (2.6.1-linux.19 launches and renders,
  2026-08-23). Graduating the Linux support code off the working branch still
  waits on Phase 2 — see CLAUDE.md for the cherry-pick rule that keeps the
  experimental Linux plumbing off the Windows fleet.
