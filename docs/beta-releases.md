# Mimic Beta Releases — how the beta channel works

This is the "beta form" — how we ship a test build to a few people without
touching the whole guild, and how those testers auto-update through betas and
eventually graduate to stable.

## The two tracks

electron-updater picks the channel from **the running build's own version**
(baked into `app-update.yml` at build time):

| Build version | Channel | `allowPrerelease` | Behavior |
|---|---|---|---|
| `1.0.20` (plain semver) | `latest` | false | Only updates to other **stable** releases. Never sees betas. |
| `1.0.20-beta.3` (prerelease) | `beta` | true | Rolls forward through newer **betas**, and **graduates to stable** once stable's version exceeds the beta. |

The switch is in `apps/mimic/main.js` → `wireAutoUpdater()`:
`autoUpdater.allowPrerelease = /-/.test(app.getVersion())`. No global flag, so
the tracks can't bleed into each other.

`apps/mimic/package.json` build config has `generateUpdatesFilesForAllChannels: true`,
so **every** release ships both `latest.yml` and `beta.yml` — that's what lets a
beta install read a stable release's `beta.yml` and graduate.

## Cutting a beta

The release workflow (`.github/workflows/release-mimic.yml`) has a
`workflow_dispatch` with a `tag` input. A manual dispatch **pins the built
version to the tag**, so we can build a beta from a feature branch without
committing a `-beta` suffix into the branch.

**To cut `vX.Y.Z-beta.N`:**
- GitHub → Actions → **Release Mimic (Electron)** → Run workflow
- **Use workflow from:** the feature branch (so it builds the branch's code)
- **Tag:** `vX.Y.Z-beta.N` (the `-` makes it a GitHub *prerelease* → invisible to
  stable installs)
- Run. ~10–15 min → a prerelease with the installer + `latest.yml` + `beta.yml`.

Install `beta.1` once (over the current Mimic — settings/token preserved). Every
beta after lands **in place** (no re-download). Stable users never see them.

> Claude can dispatch this directly now (the GitHub App was granted Actions
> write). No manual clicking required.

## Cutting stable

Stable ships automatically: **merge to `main` with a bumped
`apps/mimic/package.json` version** → `release-mimic.yml` auto-builds + publishes
`v<version>` (plain semver, stable channel). The whole guild auto-updates, and
any beta testers graduate onto it.

## Current state (2026-06-05)

- Stable line: **v1.0.20** shipping to main (this session's work).
- Betas cut during testing: `v1.0.20-beta.1 / .2 / .3` (charm tracker fix → voice
  schema → charm duration bar + overlay position fix). These graduate to stable
  v1.0.20.
- **Tomorrow's beta work** (buff timers, font-size, Dragon Punch fix) starts a
  new cycle from the v1.0.20 base → `v1.0.21-beta.1`, etc.

## Gotcha

The agent (inside Mimic) **hot-swaps on its own** (separate from the shell
updater), so agent-only fixes reach testers between Mimic shell updates. Overlay
HTML (charm.html etc.) and main.js are part of the **shell** — those need a new
Mimic build to ship.
