# Linux: getting Zeal's live data into Mimic under Wine

*Written 2026-09-25. Covers any Linux box running EverQuest under Wine — a desktop
or a Steam Deck. The Deck-specific install (renderer chain, controller, Steam
shortcut) is a separate runbook on the Deck branch (see the end).*

> ⚠ **Status: built, never proven end to end.** Mimic's Linux build carries an
> automatic bridge, and the manual route below uses the same pieces, but nobody
> has yet reported JSON arriving on the socket from a real game. The first
> person to try it is the test — **please report what happened** (§7).

## 1. What works without any of this

The Linux build of Mimic reads EverQuest's **log files** natively, so the
dashboard, parse and chat uploads, log-driven trigger callouts and UI Studio all
work on Linux already. What needs Zeal's pipe is everything **live**: target HP,
buffs and debuffs, the DPS/Tank HUD, Target Info, Extended Target, the Buff
queue, the charm and pet trackers, the HUD ring.

## 2. Why it needs a bridge

Zeal publishes live game state on a **Windows named pipe**,
`\\.\pipe\zeal_<pid>`. Under Wine, a named pipe belongs to the Wine session
(the *wineserver*) that created it, and only programs in that same session can
open it. A normal Linux program — Mimic included — cannot see it at all.

So a small **Windows** program runs inside EverQuest's own Wine session, reads
the pipe, and copies every byte to a **Unix socket** that Mimic can read. The
bytes on the socket are identical to the Windows pipe, so every overlay works
unchanged once they flow.

The bridge is **outflow** (github.com/FyraLabs/outflow). The older
**winestreamproxy** does the same job and is the fallback for Wine older than 10.

## 3. Requirements

| Need | Why | Check |
|---|---|---|
| **EverQuest on Wine 10 or newer** (e.g. a GE-Proton 10 runner) | outflow uses Wine 10's Unix-socket support, and it must run in EQ's own Wine — so EQ's Wine is the one that has to be new enough | ⚠ The Quarm guide's Linux install pins **GE-Proton 8**, which is too old. Switch the game's runner, or use winestreamproxy |
| **EQ's Wine not sandboxed** | the bridge has to join EQ's wineserver | Native **Lutris** or plain `wine`: fine. **Steam's own Proton**: no — it runs in a container, and Mimic reports it as unsupported. **Bottles**, or **Lutris installed as a Flatpak** (what Discover installs on a Deck): Mimic has a path for it (`flatpak enter`), untested |
| **Zeal installed and loading** | Zeal creates the pipe; there is nothing to switch on in `zeal.ini` | Zeal's options window opens in game |
| **Mimic's Linux build** | only this build has the bridge supervisor | **`v2.6.1-linux.26`** (2026-08-26) — wolfpack.quest/mimic/linux. ⚠ It is a month behind Windows: no HUD, no mini modes |
| **`outflow.exe`** | the bridge itself; Mimic does not ship it | github.com/FyraLabs/outflow. If there is no ready-made build, it builds with Rust: `cargo build --release --target x86_64-pc-windows-gnu` |

## 4. Route A — let Mimic do it

1. Put **`outflow.exe` next to `eqgame.exe`**. That folder is inside the Wine
   prefix, so both Linux and a sandboxed Wine can see it.
2. Start EverQuest with Zeal, and log in to a character.
3. Start Mimic (the AppImage). On its own, every few seconds, it:
   - finds the running `eqgame.exe` and reads its Wine settings (prefix, Wine
     binary) from `/proc` — no root needed;
   - asks that same Wine for eqgame's **Windows** process id. The pipe name uses
     that id, not the Linux one;
   - starts outflow in EQ's Wine with `--outbound-pipe`, writing to
     `$XDG_RUNTIME_DIR/wolfpack-zeal.sock` (Flatpak case:
     `~/.var/app/<app-id>/data/wolfpack-zeal.sock`, because a Flatpak's `/tmp`
     is private);
   - points its Zeal reader at the socket;
   - retries with backoff (15 s up to 5 min), and stops the bridge when EQ exits.
4. If anything is missing, Mimic says so rather than failing silently. The
   bridge status is one of `waiting-eq`, `needs-bridge` (no `outflow.exe` found —
   the message names the folder), `unsupported` (Steam's Proton container),
   `running`, `error`; the same line lands in the agent log.

Optional settings in `mimic.config.json` (in `~/.config/<Mimic's folder>/`, next
to `agent.log`): `zealBridge: false` turns it off; `zealBridgeExe` (full path to
the bridge), `zealBridgeSocket`, `zealBridgeArgs`, `zealBridgeFlatpakMode`.

## 5. Route B — by hand (any Linux; the best first test)

Use EQ's exact Wine binary and prefix. On Lutris the easiest way is the game's
menu → **Run EXE inside Wine prefix** (or **Open bash terminal**, which sets the
environment for you).

```bash
export WINEPREFIX=~/Games/everquest              # EQ's prefix
WINE=/path/to/the/wine/EQ/runs/on                # e.g. the GE-Proton runner Lutris uses

# 1. EQ's WINDOWS process id (2nd column).
$WINE tasklist | grep -i eqgame
#    If that prints nothing: $WINE winedbg --command "info proc"
#    lists them in hex — convert with:  printf '%d\n' 0x<id>

# 2. Start the bridge. outflow cannot start over a leftover socket.
rm -f "$XDG_RUNTIME_DIR/zeal.sock"
$WINE /path/to/outflow.exe --pipe '\\.\pipe\zeal_<PID>' \
      --socket "$XDG_RUNTIME_DIR/zeal.sock" --outbound-pipe &

# 3. Check bytes flow: expect lines like {"type":…,"character":…}
socat - UNIX-CONNECT:"$XDG_RUNTIME_DIR/zeal.sock" | head -c 400

# 4. Start Mimic pointed at the socket.
ZEAL_PIPE_SOCKET="$XDG_RUNTIME_DIR/zeal.sock" ./Wolf-Pack-Mimic*.AppImage
```

A `ZEAL_PIPE_SOCKET` you set yourself wins: Mimic then leaves the bridge to you.
The pid changes every time EQ starts, so step 1 repeats each launch — that is
the chore Route A automates.

## 6. When it doesn't work

| Symptom | Likely cause | Fix |
|---|---|---|
| outflow exits with `WSAEADDRINUSE` | a socket file left from a previous run | `rm -f` the socket, start outflow again |
| outflow errors about sockets / `AF_UNIX` | Wine older than 10 | move EQ to a GE-Proton 10 runner, or use winestreamproxy |
| `tasklist` shows no `eqgame.exe` | a different Wine or prefix than EQ's | use the game's own Lutris menu (Route B intro) |
| outflow can't find `zeal_<PID>` | wrong pid, or Zeal didn't load | re-check step 1 with EQ in game; confirm Zeal's options window opens |
| `socat` connects but prints nothing | you're at the login screen, or the pipe isn't writing | log a character in; wait a few seconds |
| Mimic says `unsupported` | EQ was launched by Steam's Proton | launch EQ from Lutris (a Steam shortcut *to Lutris* is fine) |
| Mimic says `needs-bridge` | no `outflow.exe` where it looks | put it next to `eqgame.exe`, or set `zealBridgeExe` |
| Socket exists, Mimic shows nothing | Mimic can't see the socket (Flatpak `/tmp`) | use a path in your home folder; Route A does this automatically |

## 7. What to report back (first testers)

- Your distro (or SteamOS), how EQ is launched (Lutris native / Lutris Flatpak /
  Bottles / plain wine), and the Wine or GE-Proton version.
- Route A: the bridge status Mimic shows, and the `[zeal-bridge]` lines from
  `agent.log`.
- Route B: what `socat` printed — or the exact error from outflow.

Post it in `#feedback` or on wolfpack.quest/feedback.

## 8. Where the rest lives

- **Design and code:** `docs/mimic-steamdeck-zeal-bridge.md` and
  `apps/mimic/linuxZealBridge.js` on the **`claude/deck-156-refresh`** branch
  (Linux support stays on its own branch and update channel until it is proven —
  `CLAUDE.md`, "Mimic release channels").
- **Deck install** (renderer chain, controller layout, Steam shortcut):
  `docs/RUNBOOK-deck-install.md` on the same branch.
- **What's on the pipe:** `docs/zeal-pipe-protocol.md`.
