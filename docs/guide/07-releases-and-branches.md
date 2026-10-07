# Releases and branches (for maintainers)

For officers and maintainers who push code, and for the AI sessions that push it for them. Read this before your first push to `main` or `beta`.

## The branches

| Branch | What ships from it | Notes |
|---|---|---|
| `main` | The bot (Railway), the website (Vercel), **stable** Mimic and its bundled agent; the Parser zip comes from a version tag. | Always green. A push deploys. |
| `beta` | **Mimic beta** only, plus the website preview at `b.wolfpack.quest`. | `sync-beta.yml` merges `main` into it on every `main` push. |
| `alpha` | The Mimic 3.0 alpha (overlay builder). | `sync-alpha.yml` merges `beta`, then `main`. Parked at 3.0.0. |
| `claude/*`, `contrib/<name>/*` | Nothing. Working branches. | Cut from `main`; agent and Mimic work from `beta`. |

- **There is no bot beta.** One Railway environment, pinned to `main`.
- **Never merge `beta` into `main`.** Beta carries the parked Mimic version and unfinished work. Stable cuts are file-level promotions (below).
- **The sync keeps beta's side for two files only**: `apps/mimic/package.json` and `packages/wolfpack-logsync/package.json`. Any other conflict fails the run. Resolve it by hand.
- **The sync pushes with the workflow token**, which starts no other workflows, so it cuts no stray `-beta.N`. Before swapping in a personal token, add a `[sync]` guard to `release-mimic.yml`.
- **A workflow that names a branch may not run on it.** GitHub runs the file from the pushed branch (that is how an agent that crashed at boot reached beta). Put a two-branch workflow on both.
- **Only `main` and `beta` build the website** (`web/vercel.json`). Vercel Hobby allows 100 deployments a day and every push to any branch spends one. `ignoreCommand` skips a push whose *last* commit leaves `web/` alone, so make the web commit last in its push.

Source: `CLAUDE.md` (Release playbook); `.github/workflows/sync-*.yml`; `web/vercel.json`.

## Where a change goes

| Change | Push to | Bump |
|---|---|---|
| Bot (`index.js`, `commands/`, `utils/`) | `main` | root `package.json`; a `CHANGELOGS` entry if members will notice |
| Web | `main`; to review first, `beta`, then read `b.wolfpack.quest/<same path>` | `web/package.json`; roadmap entry |
| Agent, for beta users | `beta` | `packages/wolfpack-logsync/package.json` only |
| Mimic | `beta`; stable is cut on `main`; the 3.0 builder goes to `alpha` | Nothing per push: the version stays **parked** |
| Bristlebane (raid-voice bot) | `main` | its own `package.json`; redeploy by hand in Coolify, no auto-deploy |
| Supabase migration | `main` | None. `YYYYMMDDHHMMSS_description.sql`, idempotent |
| Docs only | `main` | None |

- Patch bump by default. **Versions live in each `package.json` and nowhere else**, never in docs.
- A change spanning bot and agent is two commits on two branches.
- A **new** web page goes live on `main` marked `[beta]` at the top. Changes to an **existing** page iterate on `b.wolfpack.quest`. Never promote a `?v=b` variant without the guild lead's pick.
- A migration the agents need *now*: apply it with the Supabase tooling **and** commit the identical file. Otherwise merging to `main` applies it.

Source: `CLAUDE.md` (Routing a change, Migrations).

## Mimic channels and tag names

| Channel | Branch | Version / tag | Feed |
|---|---|---|---|
| Windows stable | `main` | `vX.Y.Z` | `latest.yml` |
| Windows beta | `beta` | `vX.Y.Z-beta.N` | `beta.yml` |
| Windows alpha | `alpha` | built as `<park>-alpha.<run>`, one rolling release tagged `mimic-alpha` | `alpha.yml` at that fixed release |
| Linux / Deck (experimental) | a Deck branch, not `main` | `<parked>-linux.<run>` | `linux.yml` |

`release-mimic.yml` runs on pushes to `main`, `beta` or `alpha` that touch `apps/mimic/**` or `packages/wolfpack-logsync/**` (the agent is bundled), or by hand with a tag to retry a build.

- **main:** the tag is `v` plus the version in `apps/mimic/package.json`. If that tag exists, the run stops.
- **beta:** keep the version plain and parked at the line's target. Each push gets the next `-beta.N`, so never bump Mimic per iteration.
- **The release feed holds only 10 entries.** A flood of Deck builds once pushed every beta out, and testers saw "No published versions". Anything picking "the newest beta" must require a `-beta.N` tag. `prune-linux-releases.yml` trims Deck builds.

Source: `.github/workflows/release-mimic.yml`, `prune-linux-releases.yml`; `docs/beta-releases.md`.

## Cutting a stable

Only when the whole fleet needs it: a raid-critical fix, a broken stable, or a batch the guild lead asks to promote. **Release names are the guild lead's call.** Unnamed means the plain version.

1. On `main`, check out `apps/mimic`, `packages/wolfpack-logsync` and their tests from `beta` (`git checkout origin/beta -- <paths>`). Leave behind tests for web previews still waiting on a pick.
2. Run the full gate on that tree (chapter 8).
3. Write the message to a file: `mimic vX.Y.Z — stable: …`. The body is a `<!--player-notes-->…<!--/player-notes-->` block (New, Better, Fixed bullets; members credited by role, "suggested by a member, FB-n"), a technical paragraph, then a `Fixes FB-n` line for every report it graduates.
4. **Make it the tip of its push.** The release body comes from the *last* commit, and the #mimic-releases announcer reposts it. A wrong body can only be fixed by editing the release on GitHub.
5. **Re-park beta one patch above** (stable 2.7.9, beta parks at 2.7.10). A park at or below stable makes betas sort *below* it, and the updater stops offering them.
6. Push the roadmap and docs commit separately, afterwards, with the stable version in STATUS. Update the private Branch inventory if you can reach it.

Promoting the agent files also moves the stable agent line: the fleet hot-swaps the agent before it takes the installer.

Source: `CLAUDE.md`; `release-mimic.yml` ("Build release notes"); `docs/DECISIONS-2026-09-21.md` §176.

## Hot-swapping an agent fix to stable

The bot re-reads the agent at the tip of `main` every 3 minutes, no redeploy. Each Mimic asks every 15 minutes and swaps only to a strictly newer version.

1. Put the scoped fix on `main`: just that change, never the whole beta.
2. Set `main`'s agent version to the next number above beta's current one.
3. Push (mind the freeze).
4. Make sure `beta` has the fix, and set its agent version one above `main`'s so the beta line stays on top.

An agent will not swap mid-fight, during a backfill, with uploads queued, or in the **raid hold** (Sun/Wed/Thu 19:00 to 00:30 ET; `flag_raid_hold = 0` in `/admin/overlays` lifts it). A swap that crash-loops reverts to the last-known-good copy. `flag_agent_kill` pauses the fleet; `min_agent_ver_num` sets a version floor.

Source: `index.js` (agent manifest, `_raidHoldNow`); `apps/mimic/main.js` (`checkAgentUpdate`); `docs/DECISIONS-2026-09-21.md` §119, §123.

## The raid-night deploy freeze

**Never push to `main` Sun, Wed or Thu from 19:30 to 00:30 ET.** Check: `TZ=America/New_York date '+%A %H:%M'`. Beta pushes are fine; Mimic updates are pull-based. A fix that must ship mid-raid carries `[hotfix]` in its message. That also waives `raid-freeze.yml`, which only turns the push red, since Railway and Vercel deploy regardless. Land everything else after midnight.

Source: `CLAUDE.md`; `.github/workflows/raid-freeze.yml`.

## Commit messages

- **Subject:** `<component> vX.Y.Z — short reason` (`bot`, `web`, `agent`, `mimic`; `docs —` for docs only). Railway shows the merge commit message as the deploy name: never merge with `--no-edit`.
- **Use `git commit -F <file>`.** In a double-quoted `-m`, backticks run as commands. That has eaten words and once executed a tool mid-commit.
- **Text a raider reads** (stable commit body, roadmap, Discord changelogs): bullets, no code identifiers. EverQuest terms are fine.

Source: `CLAUDE.md`; `docs/GEMINI-SPARK-HELPER.md` §8.

## Every release also updates

- **The roadmap:** a new entry at the **top** of `releases[]` in `web/lib/roadmapData.ts` for any user-facing change: version pill (`channel: 'beta'` if beta-only), headline, plain-language features, fixes last. Bump `web/package.json`.
- **`CHANGELOGS`** in `utils/onboarding.js`, for a user-facing bot release: keyed by bot version, one to three short bullets. It feeds "what's new since you last looked" on `/onboarding` and the rejoin message.
- **The docs, at both gates:** the STATUS entry and HOW-ITS-BUILT row land with the change on `beta`, and again with the stable version. No doc edit in the diff means the ship is not done.

Source: `CLAUDE.md`; `web/lib/roadmapData.ts`; `utils/onboarding.js`.

## Closing member reports: the FB-n loop

Every bug or idea report has a handle, **`FB-<n>`**, on its Discord card and in `/admin/feedback`.

1. Put `Fixes FB-12` **on its own line** in the commit that answers it. `Implements`, `Closes` and `Resolves` work too; one line may list several numbers. A bare mention moves nothing.
2. Every 10 minutes the bot reads the newest 40 commits of `beta`, then `main`, from the public repo.
3. A `beta` commit moves the report to **🧪 On beta**; a `main` commit to **✅ Implemented**. The bot edits the card, adds a dated note and DMs the submitter.
4. **A report never moves backwards**, because `main` merges into `beta` constantly. A closed report never reopens.
5. **A stable Mimic cut must repeat the FB numbers it graduates**, or they stay at "on beta". A fix shipped without an FB line leaves the report open forever.

Source: `utils/feedbackRefs.js`; `index.js` (`_feedbackCommitWatch`).
