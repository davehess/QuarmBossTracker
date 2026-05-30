# Mimic Agent supervisor — prototype

Runnable proof-of-concept for **Path B** in `docs/MIMIC_AGENT.md`: a zero-dep
supervisor that gives the agent **update-in-place** without the PowerShell
wrapper, and lets a new agent **coexist** with a stale one.

> ⚠️ Prototype. Not wired into distribution. Demonstrates the mechanism so we can
> decide on the Electron investment with eyes open.

## Run
```sh
# Supervises the real agent for local testing (defaults to the repo's agent):
node experiments/mimic-agent/supervisor.js

# Point at a specific agent file / bot:
node experiments/mimic-agent/supervisor.js --agent ./path/to/index.js --bot https://…/api/agent/encounter

# Pass-through args to the agent after `--`:
node experiments/mimic-agent/supervisor.js -- --watch --once
```

## What it proves
- **Version check** against `GET /api/agent/latest-version`.
- **Hash-verified download**: streams the new file, computes SHA-256, and only
  swaps if it matches the manifest's `sha256`. A corrupt/truncated download never
  replaces a working agent.
- **Atomic swap** (`.tmp` → `rename`).
- **Child lifecycle**: launches the agent, relaunches instantly when the agent
  writes its `.force-update-on-restart` marker (same marker the agent already
  uses), restarts with exponential backoff on a crash. No PS wrapper involved.
- **Free-port probe**: if `:7777` is held by a stale old agent, walks up to the
  next free port and launches the new dashboard there — they coexist instead of
  one blocking the other.

## What's still stubbed (needs an infra decision before it's real)
1. ~~Update manifest.~~ ✅ **Done (bot v2.5.47):** `/api/agent/latest-version` now
   returns `{ latest_agent_version, url, sha256 }` — a raw single-file URL plus
   the SHA-256 of exactly what `main` holds, computed from the bot's own image.
   The supervisor verifies the hash before swapping. Override the URL with
   `AGENT_RAW_URL` if the repo/branch moves.
2. **Distribution swap.** The supervisor must become the *launched* process (it
   spawns the agent), i.e. `Parser.bat` / the installer should run `supervisor.js`
   instead of `index.js`. Small change, deferred until we commit to the rollout.
3. **Signing the supervisor** so Windows SmartScreen doesn't flag it.

## How this becomes Mimic
The Electron app (`docs/MIMIC.md`) wraps this exact supervised-engine model:
Electron's main process *is* the supervisor, `electron-updater` replaces the
hand-rolled download/swap, and the dashboard moves from `localhost:<port>` into a
real renderer window. Proving the lifecycle here first means the Electron port is
shell-only, not a logic rewrite.
