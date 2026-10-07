# Run the standalone agent (Parser.bat and the command line)

For a raider or host who cannot, or does not want to, run Mimic. At the end a log-reading agent runs on your PC (or a server), uploads your fights to your guild's bot under your own key, and serves a dashboard on your machine. Mimic bundles this same agent, so this is the same engine without the window.

## Mimic or Parser?

Prefer **Mimic** for almost everyone. Mimic adds the overlays, the tray, its own Node runtime and updates, and the **Zeal pipe bridge**: only Mimic reads Zeal's live feed (HP, mana, groups, the raid roster, charm breaks) and hands it to the agent. Parser has none of that. Choose Parser for a headless or always-on box, for macOS or Linux (the agent is plain Node), or as a minimal fallback. Run only one on a PC: the agents elect a single uploader through a lock file, and the second runs read-only. Mimic's Settings can retire an old Parser.

## 1. Get the files and Node

1. Download the repo (**Code → Download ZIP** on GitHub, or `git clone`) and extract it. You need `Parser.bat`, `start-logsync.ps1`, `RUN-FIRST-for-Node.js.bat`, `install-node.ps1` and `packages\wolfpack-logsync\`.
2. Double-click **`RUN-FIRST-for-Node.js.bat`** once and approve the admin prompt. It installs Node.js through `winget`, falling back to an MSI from nodejs.org.

> ⚠ The release notes and `release-parser.yml` promise `WolfPackParser.zip` at `releases/latest/download/`. The newest release is a Mimic build, the only release carrying that zip is v2.5.1 from May 2026, and the copy under `releases/` in the repo is from May 2026 too. Use the repo download instead.

> ⚠ The zip's `README.txt` says Node 18 is enough; `install-node.ps1` requires 20 or newer and upgrades 18. The agent itself declares `>=18`.

**Check it worked:** `node --version` prints v20 or higher in a new window.

## 2. First run

Double-click **`Parser.bat`** from the extracted folder. It asks, in order:

1. **EQ directory:** it scans drive roots for `EverQuest`, `EQ`, `TAKP` and common install paths. Confirm, or type the folder holding `eqgame.exe`.
2. It **copies itself into your EQ folder** (`wolfpack-logsync\`, `start-logsync.ps1`, `Parser.bat`). The repo copy is no longer needed.
3. **Bot URL:** `https://<your-bot-host>/api/agent/encounter`. ⚠ The default is Wolf Pack's own bot; another guild must type its own.
4. **Token:** your personal key from `/token` (section 5).
5. **Startup:** [1] run automatically (a hidden Task Scheduler task named `WolfpackParser`, at logon), [2] desktop shortcut, [3] Start menu, [4] none.

Settings are saved in **`logsync.config.json`** in your EQ folder: `EqDir`, `BotUrl`, `Token` (plain text) and `AutoUpdate`. The window then lists the logs it watches and "Uploading to: …". From now on use the `Parser.bat` in your EQ folder or your shortcut.

**Check it worked:** open `http://localhost:7777`. The standalone dashboard is bound to `127.0.0.1` only. If 7777 is taken, the supervisor tries the next port; the window prints the real address. (Mimic uses 7779 and up, so both dashboards can run, but only one instance uploads.)

## 3. Wrapper flags

`Parser.bat` forwards no arguments, so run the script itself from your EQ folder: `powershell -ExecutionPolicy Bypass -File .\start-logsync.ps1 -Setup`.

| Flag | Does |
|---|---|
| `-Setup` | re-run the startup choice |
| `-Remove` | delete the scheduled task and shortcuts |
| `-Reset` | forget saved settings and start over |
| `-DryRun` | parse and print, upload nothing |
| `-StaleAfterDays 7` | narrow the recent-log window (default 30) |
| `-EqDir "D:\TAKP"` | use this folder without asking |
| `-NoUpdate` / `-ForceUpdate` | skip, or force, the update check |

> ⚠ The on-screen hint says "re-run Parser.bat -Reset"; the batch file does not pass `-Reset` on.

## 4. Run the agent directly

On any OS with Node, from `packages/wolfpack-logsync/`:

```
node index.js --log "<EQ folder>/eqlog_<Name>_pq.proj.txt" --watch \
  --bot-url https://<your-bot-host>/api/agent/encounter --token wpms_… --web-port 7777
```

- `--log <path>` is repeatable, one per character. `--watch` tails forever and is the default when no mode is given. With no `--log` it runs the dashboard only and tails nothing.
- `--since "2026-05-25T20:00:00"` (with optional `--until`) is a one-shot backfill of boss fights, `/gu` and `/rs` chat, and other event types; then it exits. `--once` scans once and exits. `--dry-run` uploads nothing.
- `--character`, `--config <json>`, `--no-auto-open`, `--version`, `--help`. The token may come from `WOLFPACK_TOKEN` and the URL from `WOLFPACK_BOT_URL`; that default URL is also Wolf Pack's.

## 5. Your upload key

In Discord run **`/token`**. It lists your active keys with **Revoke** buttons and a **+ Mint new token** button; the new key (`wpms_…`) is shown once. Paste it at the prompt or into `Token` in `logsync.config.json`. Press **K** in the window to be prompted again. Old shared secrets are rejected. Not in the member sync yet (it runs every 6 hours)? An officer can mint one with `/token for:@you`.

**Check it worked:** the dashboard's Setup checklist shows **EQ logs found** and **Uploading enabled**.

## 6. What it watches and keeps

- **Logs:** every `eqlog_<Name>_pq.proj.txt` in your EQ folder modified within 30 days. Characters active in the last hour show green. If none is recent it offers to watch them all.
- **Exports:** `<Name>Quarmy.txt`, `<Name>-Inventory.txt` and `<Name>-Spellbook.txt` in the same folder, rescanned every 10 minutes. The Quarmy export loses its bank, shared-bank and coin rows on your PC; the inventory export is sent whole.
- **Privacy:** officer chat, tells, group chat and custom channels are dropped at byte level before parsing. `/gu` and `/rs` go to the bot; so do fights. See `docs/PRIVACY.md`.
- **Durable queue:** every upload waits in `logsync.queue.json` beside `index.js`. It retries every 15 seconds, backing off from 30 seconds to 10 minutes, and survives restarts. A 4xx answer (400, 401, 403, 404, 422) drops the item as permanent; 429 is retried. It holds up to 5,000 items or 128 MB.

## 7. Updates and the update gate

At each launch the wrapper compares itself with GitHub `main`, and it re-fetches the agent at most every 12 hours. The supervisor also checks the bot every 10 minutes for a hash-verified agent and swaps it in place. Press **U** in the window to update now. It refuses while a raid hold is on, uploads are pending, a backfill runs or a fight is live; **Shift+U** forces it and may lose unflushed data. `AutoUpdate: false` in the config, or `-NoUpdate`, stops automatic updates. The URLs are hard-coded to Wolf Pack's repository; a fork changes `$AGENT_RAW_URL`, `$AGENT_PKG_RAW_URL` and `$SCRIPT_RAW_URL` in `start-logsync.ps1`.

Other keys in the window: **T** tanks, **H** healers, **P** pets, **I** info, **O** opt-in backfill, **B** detach to a background service.

## If it goes wrong

- **"No eqlog_*_pq.proj.txt files found":** turn logging on in game (`/log on`, `Logging=on` in `eqclient.ini`) and check the folder. `-Reset` re-asks.
- **Uploads fail with 401:** the token is wrong, revoked or an old shared secret; mint a new one.
- **"Another agent is already uploading … read-only":** Mimic or another Parser holds the upload lock; stop one.
- **Port busy, or "Service already running":** pick **V** to view, **K** to stop, or **R** to restart it here.
- **Queue number never reaches zero:** a bad item parks after 25 failures and retries every 30 minutes; the dashboard's drain-now action retries it.
- **Update does nothing:** a gate reason is shown; finish the fight or backfill, or press Shift+U.
