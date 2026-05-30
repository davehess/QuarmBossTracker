# Mimic Agent — rearchitecture effort assessment + sample

> Scoping for "how much effort is the Electron rearchitecture" + the sample
> self-updating agent. Companion to `docs/MIMIC.md` (the overall vision).
> Written 2026-05-30.

## Where the agent is today
- **One file, 6,492 lines, zero npm deps** (`packages/wolfpack-logsync/index.js`).
  Tails `eqlog_*_pq.proj.txt`, builds encounters, durable upload queue, serves a
  dashboard on `localhost:7777`.
- **Distribution:** `releases/WolfPackParser.zip` = the agent + a bundled Node
  launcher, plus `RUN-FIRST-for-Node.js.bat` (installs Node 20), `Parser.bat`
  (runs it), and `start-logsync.ps1` (a **40 KB** PowerShell wrapper).
- **Updates today:** the agent can't update itself. On `[U]`/`POST /api/update`
  it writes a `.force-update-on-restart` marker and exits; **`start-logsync.ps1`
  re-downloads the agent and relaunches.** So every update round-trips through the
  PS wrapper and a process bounce — this is the "we had to restart so many times"
  pain.

The engine is solid. The **packaging + update story** is the weak point, and it's
what both the Electron vision and the immediate win below are about.

## Two paths

### Path B — self-updating Node agent (do this first) ⭐
A tiny **zero-dep supervisor** that owns the lifecycle the PS wrapper does today,
but does it *in process* and cross-platform:
- Launches the agent as a child, watches for the update marker / version delta.
- Downloads the new agent file, **verifies a SHA-256 against the version manifest**,
  atomic-swaps it (`.tmp` → `rename`), relaunches the child. No PS wrapper, no
  full reinstall — **update-in-place**.
- Survives the child crashing (restart w/ backoff). The queue file already makes
  data loss a non-issue across bounces.

**Effort: ~2–4 focused days.** Delivers the update-pain fix immediately, needs no
Electron toolchain, and becomes the exact thing Electron later wraps. A runnable
prototype ships with this doc (see below).

### Path A — Electron app (the Mimic shell)
Wrap the same engine in Electron for the things a served-HTML tab can't do
(transparent overlays, real audio/TTS, native file R/W for the UI editor, tray,
packaged installer + auto-update).
- Electron shell + `electron-builder` (NSIS one-click installer): ~3–5 days
- `electron-updater` auto-update plumbing (background download, restart-on-quit): folds into the above
- Port the engine into the main process / a forked child — it's already a clean
  single file, but assumes a CLI + `process.exit` + a localhost server: ~3–5 days
- Dashboard HTML → renderer window (keep the existing HTML at first, React later): ~2–4 days
- Code signing (cert + CI; kills SmartScreen friction): ~1–2 days + cert $
- **MVP (installer + auto-update + current dashboard in a window): ~2–3 weeks.**
- **Full Mimic (overlays, timer bars, DPS meter, UI editor, tells panel): ~6–10 weeks.**

## Recommended sequence
1. **Path B now** — kill the update pain, stabilize the engine as the contract
   (this *is* Mimic Phase 0 from `docs/MIMIC.md`).
2. **Document the agent's local HTTP API** as the frozen contract Electron consumes.
3. **Path A** — Electron wraps the supervised engine, dashboard moves into a real
   window, then overlays/panels land incrementally.

## Coexistence — "run alongside those that haven't updated yet"
Two distinct cases:

- **Across the guild (different machines):** already works. The bot's endpoints
  accept any `agent_version`; new fields are additive and old agents simply don't
  send them. Nothing to do — a member on the old agent and a member on the new one
  both upload fine.
- **Same machine, during a swap:** the supervisor **replaces** the running agent
  rather than running two in parallel — two agents tailing the same logs would
  double-tail. A brief overlap (old still flushing its queue while new starts) is
  **harmless** because every ingest path is idempotent: `find_or_create_encounter`
  dedups encounters, and chat / pvp / tells carry `dedup_key`s. The supervisor
  also **probes for a free dashboard port** (7777 → 7778 → …) so a stale old
  instance can't block the new one's UI from coming up.

## Sample
`experiments/mimic-agent/` ships a runnable, zero-dep prototype of Path B:
- `supervisor.js` — version check, hash-verified download, atomic swap, child
  lifecycle with restart backoff, free-port probe.
- `README.md` — how to run it, what's proven, what's still stubbed (real download
  source + signing).

It's intentionally a **prototype**, not wired into distribution yet — it
demonstrates the mechanism so we can decide before investing in Electron.
