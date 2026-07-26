# Steam Deck — live overlays via the Zeal pipe bridge (#156 Phase 2)

Research + recommended deployment for getting Zeal's live data (target HP, buffs,
gauges → the DPS/Tank/Target-Info/Buff overlays and the Zeal Health panel) into
the **native Linux Mimic** on a Steam Deck. Companion to `docs/mimic-steamdeck.md`
(Phase 1, which is done and field-validated).

## The one thing that decides everything: the wineserver, not a flag

Zeal streams game state out a **Windows named pipe** (`\\.\pipe\zeal_<eqgame-PID>`).
Wine named pipes are owned by the **wineserver** of the exact Wine instance that
created them, and reachable only through that same wineserver's socket namespace.

That is why the bridge can't see the pipe from "outside": **Bottles runs Wine
inside a Flatpak sandbox** with its own `/tmp` + `XDG_RUNTIME_DIR`, so a bridge
started as a normal host process talks to a *different* wineserver and sees
nothing. (Steam's own Proton has the same problem via its pressure-vessel
container.) No environment variable fixes this — it's a deployment property.

Two ways out, and only one is clean:
- **Run the bridge INSIDE the same Wine env as EQ** — works, but awkward to wire
  from inside a Flatpak/pressure-vessel.
- **Don't sandbox EQ's Wine at all** — run it under **Lutris + GE-Proton**, whose
  wineserver is a plain host process. Then the bridge is just another `wine
  program.exe` sharing that wineserver. This is also the community-standard,
  officially-documented way to run Quarm on the Deck — and it gives Steam Input
  keybinds via a Steam shortcut. **Ditch Bottles for this.**

You already flagged Bottles as flaky and version-pinned; that's the same root
cause biting from a different angle. Moving to Lutris fixes the deployment *and*
unblocks the bridge.

---

## Recommended deployment (per the official Quarm.Guide)

Follow **quarm.guide/2025/04/23/linux-and-steam-deck-install-guide** (source:
`github.com/LordDemonos/Quarm.Guide`). In short:

1. **Discover → install Lutris + ProtonUp-Qt.**
2. **ProtonUp-Qt → install for Lutris → GE-Proton** (the guide pins `GE-Proton8-7`
   + `GE-Proton8-26`; a current GE-Proton is fine and, being Wine 10-based, is
   what `outflow` wants).
3. **Lutris → install EverQuest (Quarm)** from lutris.net; check **"Create steam
   shortcut."** Client lands at **`~/Games/everquest/client/`**, prefix under
   **`~/Games/everquest/`**.
4. **Zeal**: extract into `~/Games/everquest/client/`, and move **`Zeal.asi`**
   there too. (Zeal-compatible UI required or it crashes at char-select.)
5. **Steam Deck launch option**: `ENABLE_GAMESCOPE_WSI=0` (may be needed).
6. Right-click in Lutris → **Create Steam Shortcut** → gets Steam Input keybinds
   in Gaming Mode.

Net: EQ + Zeal run under a **host** GE-Proton wineserver at a **known path**,
launchable with your controller config intact.

Mimic Phase 1 works exactly the same here — point its EQ folder at
`~/Games/everquest/client` (logs + `UI_*.ini` live there), and Background Mode /
UI Studio / callouts behave as they already do on your Deck.

Two guide specifics worth knowing:
- The guide's **Bonus Step 7** sets `eqclient.ini` `[VideoMode]` to **1440×900**
  as the Deck optimum — so **UI Studio's target should be 1440×900** (added as a
  preset), matching the `XPos1440x900`/`YPos1440x900` keys EQ writes. (1280×800 is
  the native panel; use it only if you set VideoMode to native.)
- The guide's **Bonus Step 8** (manually copying `UI_[char]_pq.proj.ini` /
  `[char]_pq.proj.ini` between machines via cloud) is exactly what **Mimic's UI
  Studio backup/import replaces** — so that whole step goes away.

---

## The bridge: `outflow` (preferred) or `winestreamproxy`

**[FyraLabs/outflow](https://github.com/FyraLabs/outflow)** is the better fit — it
runs *as a Wine program* using Wine 10's `AF_UNIX` support, and Zeal's pipe is
**outbound** (`PIPE_ACCESS_OUTBOUND`), which it has a mode for:

```bash
# run with the SAME wine + WINEPREFIX as EQ, so it shares the wineserver
WINEPREFIX="$HOME/Games/everquest"  <ge-proton-wine>  outflow.exe \
   --pipe "\\\\.\\pipe\\zeal_<PID>" --socket "/tmp/zeal.sock" --outbound-pipe
```
Config can also come from env: `WINE_PROXY_PIPE`, `WINE_PROXY_SOCKET`. Remove a
stale socket first (`rm -f /tmp/zeal.sock`).

**winestreamproxy** is the fallback (same idea, older): `./start.sh` with
`WINEPREFIX` set and `WINESTREAMPROXY_PIPE_NAME=zeal_<PID>` /
`WINESTREAMPROXY_SOCKET_PATH=/tmp/zeal.sock`. It must likewise run in EQ's Wine
env.

Mimic is **already wired for the socket end** — set `ZEAL_PIPE_SOCKET=/tmp/zeal.sock`
and the Zeal reader connects to it; the JSON framing on the socket is byte-identical
to the Windows pipe, so every overlay works once bytes flow (built earlier, in
`zealPipe.js`).

### Easiest first test (no scripting)
Lutris → the game's launch button has a **second arrow → "Run EXE inside Wine
prefix"** (and **"Wine console"** / **"Open bash terminal"**) — the same menu the
guide uses in Bonus Step 10. Run `outflow.exe` with the args above from there. That uses EXACTLY EQ's wine + prefix, so
if outflow connects, the pipe is reachable and Phase 2 is a go. If it can't find
the pipe with EQ in-game, that's the Proton-DX-hook answer — and log-driven
overlays (DPS HUD, trigger callouts) still stand.

---

## The PID problem + an automated launcher

The pipe name carries eqgame's **Windows** PID, which changes per launch, so a
one-liner isn't durable. A wrapper discovers it and starts everything in order.
This is the automation you asked for — a single launcher you can point a Steam
shortcut at:

```bash
#!/usr/bin/env bash
# wolfpack-eq.sh — launch EQ, bridge Zeal, then Mimic. Point a Steam shortcut here.
set -u
PREFIX="$HOME/Games/everquest"
WINE="$(command -v ge-proton-wine || echo "$PREFIX/.wine-runner/bin/wine")"  # the wine Lutris uses
CLIENT="$PREFIX/client"
SOCK="/tmp/zeal.sock"
export WINEPREFIX="$PREFIX"

# 1) Launch EQ however you normally do (Lutris CLI, or the eqgame launcher).
lutris lutris:rungame/everquest &   # or: "$WINE" "$CLIENT/eqgame.exe" patchme &

# 2) Wait for eqgame + read its WINDOWS pid from the shared wineserver.
wine_pid() { WINEPREFIX="$WINEPREFIX" "$WINE" tasklist 2>/dev/null \
  | awk 'tolower($1)=="eqgame.exe"{print $2; exit}'; }
for _ in $(seq 1 90); do PID="$(wine_pid)"; [ -n "${PID:-}" ] && break; sleep 2; done
[ -z "${PID:-}" ] && { echo "eqgame.exe never appeared"; }

# 3) Bridge Zeal's pipe -> unix socket, in the SAME wine env.
if [ -n "${PID:-}" ]; then
  rm -f "$SOCK"
  WINEPREFIX="$WINEPREFIX" "$WINE" "$CLIENT/outflow.exe" \
    --pipe "\\\\.\\pipe\\zeal_${PID}" --socket "$SOCK" --outbound-pipe &
fi

# 4) Start Mimic pointed at the socket (harmless if the bridge never came up —
#    Mimic falls back to log-only, ECONNREFUSED stays quiet).
ZEAL_PIPE_SOCKET="$SOCK" "$HOME/Applications/Wolf-Pack-Mimic.AppImage" &
wait
```

Wiring options (pick one):
- **Steam shortcut → this script** (Gaming Mode + keybinds + one launch does all).
- **Lutris pre-launch script** starts the PID-watch + bridge; Lutris launches EQ;
  a post-exit script `rm -f "$SOCK"`.
- Keep Mimic separate and only have the script do steps 2–3 (bridge only).

Unknowns to confirm on the Deck (can't be settled remotely): the exact GE-Proton
`wine` binary path Lutris uses, whether `wine tasklist` reports eqgame's pid
cleanly, and — the make-or-break — whether **Zeal creates its pipe under
GE-Proton at all**.

---

## What Mimic could do to make this one-click (proposed)

Once the manual path is proven on the Deck, fold it into Mimic so nobody scripts:
1. **Bundle `outflow.exe`** in the Linux build's resources.
2. On Linux, add a **"Bridge Zeal (Linux)"** action to the Zeal Health overlay
   that: derives the wine + prefix from the detected EQ dir's parent, discovers
   eqgame's pid, runs `wine outflow.exe … --outbound-pipe`, and sets its own
   `ZEAL_PIPE_SOCKET` — then reconnects `zealPipe.js` live.
3. Make the Zeal Health overlay **Linux-aware** (drop the Windows "Run as
   Administrator" hint; show bridge status instead) — small, already on the
   Phase-1 cleanup list.

That turns Phase 2 into a button. But step 0 is always: prove Zeal's pipe exists
under GE-Proton with the manual `outflow.exe` test above.

---

## Bottom line
- **Re-home EQ from Bottles → Lutris + GE-Proton** (official Deck path). Fixes the
  flakiness, keeps keybinds, and is the only clean way to reach Zeal's pipe.
- **Bridge with `outflow` (`--outbound-pipe`)** run in EQ's wine env; Mimic reads
  `ZEAL_PIPE_SOCKET`.
- **Automate with one launcher script**, then graduate it into a Mimic button.
- If Zeal's pipe doesn't survive GE-Proton, that's the ceiling — Phase 1
  (UI Studio, dashboard, log-driven callouts) remains fully working.

### Sources
- Quarm.Guide Linux/Deck install — github.com/LordDemonos/Quarm.Guide (mirrors quarm.guide/2025/04/23/…)
- FyraLabs/outflow — github.com/FyraLabs/outflow
- winestreamproxy — github.com/openglfreak/winestreamproxy
