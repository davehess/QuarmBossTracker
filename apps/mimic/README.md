# Wolf Pack Mimic — Electron desktop client (BETA, codename *mimic*)

> 4th component alongside bot / agent / web. Wraps the existing
> `wolfpack-logsync` agent in a native shell with a real window + an
> always-on-top overlay. **Bundles its own Node runtime — no separate
> Node.js install.** This is the parity-test build, not the polished
> release. See `docs/MIMIC.md` + `docs/MIMIC_AGENT.md` for the vision.

## What it does today
- **One engine, no rebuild.** Mimic runs the *same* `packages/wolfpack-logsync`
  agent as a child process under Electron's Node (`ELECTRON_RUN_AS_NODE`). The
  agent's log-tail, encounter builder, durable upload queue, triggers, privacy
  filter — all unchanged.
- **Real window** onto the agent dashboard (the same UI as `localhost:7777`, now
  in an app window with a tray icon).
- **Always-on-top overlay** (`overlay.html`): transparent, click-through HUD that
  polls `/api/state` for the current boss + top damage. This is the DnDOverlay-
  style proof — a live in-game overlay driven by our own engine.
- **Coexistence with Parser.bat**: Mimic copies the agent into a *writable
  per-user dir* (`userData/agent`) with its own state files, and binds the
  dashboard to port **7779+** (probing past a running Parser.bat on 7777). Run
  both at once; uploads dedup server-side.
- **Tray**: show dashboard · toggle overlay · toggle overlay click-through ·
  settings · open dashboard in browser · quit.
- **In-place agent updates** still work: the bundled supervisor + the agent's
  `.force-update-on-restart` marker are honored by the main process.

## Build it (on Mac or Windows with Node + npm)
```sh
cd apps/mimic
npm install                 # also stages the agent via postinstall
npm start                   # dev run against the repo's agent
npm run dist                # build Wolf-Pack-Mimic-Setup-<version>.exe (Windows NSIS)
```
`npm run dist` emits the installer to `apps/mimic/dist/`. First launch opens
**Settings** — paste the `/token` value, optionally set the EQ folder, Save.

## Honest status (what's verified vs. not)
- ✅ All JS syntax-checked; package.json + electron-builder config valid.
- ✅ Architecture matches the agent's real `/` + `/api/state` server.
- ⚠️ **Not built into a binary from CI** — needs `npm install && npm run dist`
  on a machine with the Electron toolchain (the dev sandbox has no Electron).
- ⚠️ **Not code-signed** — Windows SmartScreen will warn ("More info → Run
  anyway"). Signing cert is a follow-up.
- ⚠️ Overlay reads `/api/state` fields defensively; the exact `sessionDeeps`
  shape may need a one-line tweak once tested against a live fight.
- ⚠️ EQ-folder auto-detect inside the agent is reused as-is; the polished
  "stupid-simple installer" acceptance criteria (Defender exclusion, logging
  auto-enable, earliest-log surfacing) are NOT in this beta yet.

## Why this is the right shape
The agent stays the single source of truth. Electron is shell + overlays only,
so the engine never forks. When overlays/triggers/audio land, they're new
windows reading the same local API — not a rewrite. `electron-updater` (auto-
update of the shell itself) and the production installer are the next passes.
