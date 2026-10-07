# Install Wolf Pack Mimic (for raid members)

For a raider on 64-bit Windows. At the end Mimic will be installed, linked to your Discord account (or local-only), reading your logs, with overlays you can show, hide, move and lock, and you will know what leaves your PC.

## 1. Download

- **Stable:** `https://wolfpack.quest/mimic?direct=1` downloads the newest `Wolf-Pack-Mimic-Setup-<version>.exe`. Without `?direct=1` it opens the GitHub release page.
- **Beta:** `https://wolfpack.quest/mimic/beta?direct=1`.
- **Every build:** `https://github.com/davehess/QuarmBossTracker/releases`.

> ⚠ The README calls `/mimic` a "one-click installer"; `web/app/mimic/route.ts` only redirects, and the installer is an ordinary wizard.

**Check it worked:** `Wolf-Pack-Mimic-Setup-<version>.exe` is in Downloads.

## 2. Install

1. The installer is not code-signed, so your browser may flag it. Edge: Ctrl+J, hover the file, **⋯ → Keep → Show more → Keep anyway**. Chrome: **⋯ → Keep**.
2. Run it. SmartScreen: **More info → Run anyway**.
3. It installs for you only, with no admin prompt. Keep the default folder, click **Install**. Never pick your EverQuest folder.
4. Leave **Run Wolf Pack Mimic** ticked, click **Finish**. Mimic now starts with Windows, hidden in the tray (tray → **Start with Windows** turns that off).

**Check it worked:** a wolf icon in the tray. Right-click shows `Wolf Pack Mimic v… — Local only · :7779`; left-click opens the window.

## 3. First run and setup

Stable builds first show the classic **Set up Mimic** page: the same three required steps, with a plain tick-list of characters (untick one to stop transmitting it). Its **Beta: try the step-by-step setup** link opens the walkthrough described here; beta and alpha builds also have tray → **Setup walkthrough**.

1. **Wolf Pack account.** Click **Sign in with Discord**. Your browser opens the site's `/auth/mimic-link` page and Mimic shows a 6-character code; sign in if asked, then paste or confirm the code within 10 minutes. There is no token to copy. Or choose **Run local-only for now**.
2. **EverQuest folder.** Tick the folder Mimic found (the one holding `eqgame.exe`) or **Browse**, then **Save folder**. The engine restarts.
3. **Your characters.** Star your **Main**. Per character choose **Main / alt**, **Inventory only** (kept for your account inventory, left out of lists and charts) or **Hide completely** (Mimic stops reading that log; the site hides it). The dashboard's **Me** card ("How each character shows") and My Stats on the site hold the same switches.

Optional steps, all repeatable from the dashboard's Setup card:

- **Zeal:** installs `Zeal.asi` and `uifiles` into your EQ folder. Close EverQuest first.
- **Set up EverQuest:** writes `Log=TRUE` to `eqclient.ini`, and `ExportOnCamp`, `PipeDelay`, `PipeVerbose` and the tag settings to `zeal.ini`. Close EverQuest first; it rewrites `eqclient.ini` on exit. Already in game? Type `/log on`.
- **Windows Defender** and **clock** buttons ask Windows for permission once.
- **Old fights and chat:** ticked by default. Finishing signed in uploads your main's whole log once (your first character if you starred none); untick it to skip. You can add old log folders or files here too.

Gear, inventory and spellbook come from files in your EQ folder: `<Name>-Inventory.txt`, `<Name>-Spellbook.txt` (`/outputfile inventory`, `/outputfile spellbook`) and the Quarmy export `<Name>Quarmy.txt`. Mimic rescans every 10 minutes. It strips bank, shared-bank and coin rows from the Quarmy export on your PC; the inventory export goes up whole, bank included, visible to you and officers. Zeal's **Export data on /camp**, which Set up EverQuest switches on, saves inventory and spellbook each time you camp.

> ⚠ `docs/PRIVACY.md` says old-log upload is off until you turn it on; the walkthrough ticks it by default (`apps/mimic/welcome.html`).
>
> ⚠ unverified: whether a camp refreshes the Quarmy file (the dashboard says yes; `docs/eqemu-catalog-cheatsheet.md` says no). If gear looks stale, re-run the export in game.
>
> ⚠ The classic page's **Your /tells** choice does not control uploads; tell relay on the site's `/me` does.

**Check it worked:** Dashboard tab, **Setup checklist**: Mimic account linked, Uploading enabled, EQ logs found, In-game logging ON, Zeal connected. Zeal stays red until a character is logged in.

## 4. The dashboard

It opens in Mimic's window and is also served at `http://127.0.0.1:7779/` (next free port if 7779 is busy; tray → **Open dashboard in browser**). Left rail: Dashboard, Overlays, Raid, Buffs, Buff blocks, Fights, My parses, Loot, Stats, Triggers, Diagnostics, Info, Logsync (plus Admin for officers). At its foot: **Tour**, **Feedback**, **Quit**. Settings is tray → **Settings…**.

## 5. Overlays

Overlays start off. Turn them on from tray → **Overlays** or the dashboard's **Overlays** tab (**Add an overlay**).

1. **Unlock** to move: the tray Overlays menu's **Overlays: Locked (click to move)**, or the tab's **Unlock overlays — move & resize**. **Setup mode** shows all of them.
2. Drag by **✥** (top-left), resize by the edges, hide with **✕** (top-right). Right-click ✥ for size presets.
3. **Lock overlays — done placing.** Locked overlays are click-through, so EverQuest still gets your clicks.
4. Lost one off-screen? **Rescue to this screen**. **Auto-arrange now** packs them.

| Hotkey | Does |
|---|---|
| Ctrl+Shift+H | hide / show all |
| Ctrl+Shift+B | backgrounds on / off |
| Ctrl+Shift+D | damage-taken alert |
| Ctrl+Shift+M | minimize all |

Per-overlay keys have no default: on the Overlays tab click a key and press Ctrl, Alt or Shift plus a key (Backspace clears, Esc cancels). Mimic takes it from EverQuest, so pick unused ones. **Quiet mode** mutes voice and sounds; **No overlays** hides everything but keeps uploading. Overlays hide while EverQuest is closed unless you untick that tray option.

**Check it worked:** tick an overlay and it appears; **✕** hides it.

## 6. Updates and channels

Mimic checks 8 seconds after launch, then hourly, downloads quietly and installs when you next quit (or tray → **Restart to install update**); tray → **Check for updates…** forces a check. Signed in, the engine also hot-swaps every 15 minutes, in a quiet moment. Channels: stable (default); **Receive beta updates** (tray, or the dashboard header's **beta** button); **Receive alpha updates (Mimic 3.0 builder)** (tray, or the **α alpha** button). **Revert to stable…** switches back, downgrade included.

**Check it worked:** **Check for updates…** answers "You're up to date (v…)".

## 7. What leaves your PC

From `docs/PRIVACY.md`, the source of truth.

- **Until you sign in, nothing goes to the guild's server.** Tray → **Disconnect** stops all uploads. Mimic still contacts GitHub (updates) and public time servers (clock).
- **Dropped on your PC first:** officer chat, group chat, custom channels, `/say`, OOC, shouts, auctions, and tells unless you switch on tell relay (site `/me`, per character).
- **Sent once signed in:** fights for everyone in them; `/gu` and `/rs` chat; `/who` results from any guild; your live status (zone, position, HP, mana, buffs, target), in or out of a raid; the raid roster; buffs, casts, threat, kills, loot, rolls, XP lines with your group's names; inventory and spellbook exports.
- **Off until you turn them on:** tell relay, crash reports, old-log upload, UI backups, attaching a log to feedback.
- **Not promised:** most data has no deletion date; opting out stops future uploads only; other raiders' Mimic still records you. Ask an officer to remove data.
- Mimic reads EverQuest and Zeal files, GINA and EQLogParser folders (to offer a trigger import) and the running-program list. It never records keystrokes, screen or clipboard.

## 8. Local mode

With no sign-in Mimic gives its engine no bot URL: overlays, your own triggers and the dashboard work, nothing uploads, and the guild's server is never called. Item and spell data ships in the installer. Sign in later from tray → **Connect to Wolf Pack…**.

## If it goes wrong

- **Agent log repeats `EPERM`, no Zeal data** (tray → **Show agent log…**): right-click `eqgame.exe` → Properties → Compatibility and untick compatibility mode (the XP mode that crash-fix checklists suggest blocks the Zeal pipe). Check this first.
- **Mimic cannot find Zeal at all:** reinstall Mimic outside your EverQuest folder.
- **Zeal connects, then drops, or no overlay shows over the game:** EverQuest and Mimic must run at the same level, both normal or both as administrator.
- **Zeal install or Set up fails with EPERM:** your EverQuest folder is read-only for Mimic (normal under Program Files). Move it, give your Windows account write access, or run Mimic and EverQuest both as administrator.
- **"Read-only mode: parser is the active uploader":** an old Parser also runs; Settings → **Retire the old Parser**.
- **"Engine didn't come up":** **Retry boot**, and copy the log shown to an officer.
- **Uninstall:** tray → **Uninstall Wolf Pack Mimic…**. It also deletes Mimic's data folder (`%APPDATA%\wolfpack-mimic`); updates do not.
