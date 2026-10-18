# Plan — old Mimics update, or they pause (October 2026)

The guild lead, 2026-10-17: *"start forming a plan to notify old mimics to update or get shut off"*.
**Status: draft plan, not started.** It runs after the next Mimic + agent minor release.

## Where the fleet is (2026-10-18, players who uploaded in the last 14 days)

| Agent | Mimic | Players |
|---|---|---|
| 3.7.194–3.7.195 | beta | 3 |
| 3.7.189 | beta | 1 |
| 3.7.176 | stable 2.9.1 | 33 |
| 3.7.75–3.7.156 | older stables | 7 |

Counted in players (latest upload per Discord id), never characters (the fleet rule in CLAUDE.md).
⚠ One 3.7.176 install has a dead login and retries every ~1.5 s; it shows as 401s in the bot log. It is one of the
33 or a former member — the DM step below finds out.

## What we already have

- **Version floor** (`min_agent_ver_num`, #74, honoured since agent 3.3.85 — every install above qualifies). Officers
  set it on `/admin/overlays` → 🛑 Kill switches. An agent below it **stops uploading and polling**, holds its upload
  queue (nothing lost), keeps every overlay working on local data, and shows a banner: *"Your agent is below the
  guild minimum… Uploads are paused until you update"*. Fail-open: if the bot is unreachable for 5 minutes it runs
  normally.
- **Auto-update.** Stable Mimic downloads a new stable in the background and installs on the next restart. Most of the
  33 on 2.9.1 will move on their own within a raid night of the release.
- **The release announcer** posts every stable to #mimic-releases.

What we do **not** have: a per-player nudge, and anything server-side that refuses an old agent that ignores the floor.

## The plan

| When | Step | Who / what |
|---|---|---|
| T0 (release day, after the stable is cut) | Release goes out; #mimic-releases post says it is required by T+7 | announcer (existing) + the release body |
| T0 | **DM each player whose latest upload is below the new version**: what's new, "restart Mimic to update", a link to wolfpack.quest/mimic, the date uploads pause | bot — new one-shot officer command `/fleet nudge` (build) |
| T+3 | Second DM, only to those still below; officers get the list | same command, `--remind` |
| T+7 (not a raid night) | **Set the floor** to the new version (e.g. agent 3.8.0 → `30800`). Old installs pause uploads and show the banner | officer, `/admin/overlays` |
| T+14 | **Server-side backstop**: the bot answers write requests from an agent below the floor with `426 Upgrade Required` (read from the `wolfpack-logsync/x.y.z` user agent), so an install that never polls the floor still stops writing | bot change (build) |
| T+30 | Revoke the login of any install still below the floor (the new agent wipes its cached chat first; older ones have none) | officer, `/token` revoke |

## Decisions for the guild lead

- **What "shut off" means.**
  - A, pause uploads (recommended): what the floor does today. Overlays keep working, nothing is lost.
  - B, also blank the guild overlays: Command Center, raid queue and Extended Target stop. Harsher, and needs agent
    code that only the new version would carry.
- **The grace period:** 7 days to the floor (recommended), or 14.
- **Whether beta testers below the new beta are nudged too** (recommended: no, beta moves daily).

## To build

1. Bot: `/fleet nudge` (officer): reads the latest upload per player, DMs those below a version, logs who was
   messaged; `--remind` for the second pass; dry-run by default.
2. Bot: 426 backstop on ingest routes for agents below `min_agent_ver_num` (after T+14, behind a tuning flag).
3. Agent (new minor): banner text names the date uploads pause, so the warning shows before the floor bites.
