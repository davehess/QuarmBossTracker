# Wolf Pack EQ Platform — Claude Code Handoff

A guild platform for Wolf Pack on Project Quarm (EverQuest emu), grown from a
Discord raid-timer bot into four independently-versioned components in one
monorepo. This file is the authoritative architectural map; `README.md` is the
user-facing setup guide + command reference. When they conflict, this file wins.

| Component | Path | Runs on | Ships from |
|---|---|---|---|
| **Bot** (Discord + HTTP API) | `/` (`index.js`, ~18k lines) | Railway, auto-deploys on push to `main` | `main` |
| **Web** (`wolfpack.quest`) | `web/` (Next.js 14) | Vercel, auto-deploys on push to `main` | `main` |
| **Agent** (`wolfpack-logsync`) | `packages/wolfpack-logsync/` (single-file Node, zero deps) | End-user machines — bundled inside Mimic, or standalone via `Parser.bat` | bundled with Mimic; CLI zip via `release-parser.yml` |
| **Mimic** (Electron desktop) | `apps/mimic/` | End-user Windows machines, auto-updates via electron-updater | `release-mimic.yml` on version bump (`main` = stable channel, `beta` = beta channel) |

**Versions live in each component's `package.json` — nowhere else.** Do NOT
maintain version numbers in this file or in README.md. (We used to keep a
version table here; it caused repeated merge conflicts between `main` and
`beta` and drifted constantly. `git log --oneline -5` + the four package.json
files are the source of truth.)

Other fixed facts: Node 20, discord.js v14, Supabase project
`zhtoekwakucbckvatfky`, guild `DISCORD_GUILD_ID=1168893924329402420`.

### Working rule — minimal diff
Touch only the code the task requires. If a change appears to need edits to
adjacent or unrelated code, stop and flag it before proceeding. (The
18k-line `index.js` monolith makes "small line count" a poor proxy for "small
blast radius" — reaching into unrelated behavior is a structural hazard here.)

### Working rule — attribution: mostly Hitya, with named exceptions
**You almost always interact with one person: Hitya.** A decision, a bug report,
a sketch or a live-test result arriving under one of their characters is still
Hitya, and gets credited to **Hitya**.

**The alt list, CONFIRMED BY HITYA 2026-08-28** (not inferred — asked and
answered, which is the only reason it can be trusted):

`Canopy` · `Rockin` · `Manamana` · `Utoh` · `vj` · `Melting` · `Hopeya`

⚠ **`Uilnayar` is NOT Hitya — a different person** (corrected 2026-08-28). This
file listed them as an alt from 2026-08-09 until then, so **any attribution to
Hitya dated in that window may actually be Uilnayar's** — treat those as suspect
rather than settled, and prefer the original report if you can find it.
Uilnayar keeps their own name. Existing `(Uilnayar <date>)` credits in code
comments are CORRECT and must not be rewritten to Hitya.

⚠ **`Dant` is treated as a different person too.** They @-mention Hitya in
Discord (the 2026-08-27 loot/raid-selection report), and they are absent from the
confirmed list above. Not explicitly confirmed either way, so this is the safe
default rather than a fact: **crediting a real member by their own name costs
nothing if wrong; collapsing them into Hitya erases them, silently.** Apply that
asymmetry to any new name — keep it until Hitya says otherwise.

**The other exception is the `feedback` table** — the wolfpack.quest feedback
form and `/feedback`. Those are genuinely other members and KEEP their own
names. The complete list, from the table itself:

| Submitter | What |
|---|---|
| `Wabumkin/Adiwen` | 3 × general (Jun 2026) |
| `Jankzer` | bug + idea (Jul 2026) |
| `Ashieron/Donaldus/Oravayne` | the log-archiving idea (2026-08-07) |

If you are about to credit anyone who is NOT `Uilnayar` and NOT in that table,
it is Hitya. Check the table rather than trusting an existing comment — a name
being in a code comment today is not evidence, since that is exactly what was
wrong before. **And a name being on the alt list above is not evidence either:
Uilnayar sat on it, wrongly, for nearly three weeks.**

⚠ These are also real CHARACTER NAMES in test fixtures, golden logs and worked
examples (the `{s}`-capture rule below turns on capturing `" Uilnayar"` with a
leading space). Attribution text only — never blanket-rename.

### Working rule — the two vendored agent skills, and what they DON'T override
Installed 2026-08-28 at Hitya's request. Both are permissively licensed and
vendored into `.claude/skills/` (committed, so cloud sessions get them too)
rather than installed per-machine.

| Skill | What it does | Licence |
|---|---|---|
| **`impeccable`** (pbakaus) | 23 design commands + 59 deterministic anti-pattern detectors; a `PostToolUse` hook scans UI files after every Edit/Write and a `Stop` hook runs a deep pass | Apache-2.0 |
| **`ponytail`** (DietrichGebert) | "Laziest solution that works" — YAGNI ladder, stdlib/native/existing-dep before new code | MIT |

⚠ **`frontend-design` WINS over impeccable where they disagree.** That skill
carries this platform's *real* tokens and the constraints generic design advice
does not know about — an overlay is read mid-raid, at a glance, over a moving 3D
scene, by someone who cannot afford to parse it. Use impeccable's **detectors**
(deterministic, checkable) freely; treat its **aesthetic** guidance as a default
that repo-specific guidance overrides.

⚠ **Ponytail reinforces the minimal-diff rule above; it does not replace it.**
They answer different questions — ponytail asks *"should this code exist at
all?"*, minimal-diff asks *"what else does this change touch?"* In an 18k-line
monolith the second is the one that bites, so ponytail's ladder does not license
a "simpler" change that reaches into unrelated behaviour. Its own SKILL.md is
explicit that it never simplifies security, validation, or explicit
requirements — that holds here too.

⚠ **Do NOT run `/impeccable init` without a decision first.** It writes
`PRODUCT.md` and `DESIGN.md` at the repo root, and **this file is the authority**
(it says so at the top). Three competing doc roots is how the next session reads
the wrong one. If we want them, the precedence goes in here first.

⚠ **The hooks run on every turn.** `PostToolUse` (5s) fires on Edit/Write —
verified to no-op on non-UI files — and `Stop` (30s) runs a design deep pass.
They were MERGED into `.claude/settings.json` alongside the existing
`SessionStart` digest hook, not copied over it: impeccable ships its own
`settings.json` which would have replaced ours and silently killed
`session-digest.sh`. If the deep pass ever costs more than it returns, delete
the `Stop` block and keep `PostToolUse`.

### Working rule — commit messages go through a FILE, never `-m`
`git commit -m "…"` in a double-quoted shell string executes anything in
backticks. It happened twice on 2026-08-27/28: once eating two words, once
running `npx impeccable install` mid-commit and splicing its help output into
the message (which then had to be amended and force-pushed). Our messages quote
code constantly, so this is not an edge case here — it is the normal case.

**Write the message to a file and use `git commit -F <file>`.** Put the file in
the scratchpad. Costs one extra line; removes the whole class.

### Working rule — comments satisfy text assertions; strip before matching
A test that asserts on source TEXT (`toMatch`/`toContain`/`indexOf` over a file
read) is matching the comments too — and this repo's comments are good enough
to answer for the code: they quote reporters, name removed code, and describe
the exact behavior under test. It bit five times in 2026-08-28..30 alone, in
BOTH directions: a deleted warning stayed green because the file's own header
still named it, and a migration failed a `not.toMatch(/bosses_local/)` because
its header explained why it avoids `bosses_local`. The false PASS is the
dangerous direction — a green test guarding nothing, invisible until mutation.
A full sweep (2026-08-30, comments stripped from all sources, suite re-run)
found two more shipped: the #207 every-countdown-✕ test matched only the
comment, and a sync-ordering test anchored to a comment's position.

**The rules:**
- Strip comments before any text assertion: `stripJs` / `stripSql` / `stripCss`
  in `test/_source-slice.js`. Whole-line strip only — a `//`-anywhere strip
  eats `https://` inside string literals and corrupts what you're asserting on.
- ⚠ Never strip a source you also `sliceBlock` with comment anchors — the
  anchors ARE comments and stripping breaks them loudly. Comment anchors are
  FINE (they fail loud, never pass silent); strip only the string handed to
  `toMatch`. Negative assertions are exactly as vulnerable as positive ones.
- Prefer behaviour over text where possible: `evalBlock` runs the real
  function, and a comment cannot satisfy a function call.
- Sibling trap, same symptom: the VACUOUS assertion — a cap tested with a
  corpus smaller than the cap passes whether the cap exists or not. Mutation-
  check new assertions; green alone proves nothing.

### Working rule — decisions get WRITTEN DOWN, same session
A decision that lives only in chat is lost: cloud and desktop sessions cannot
share a conversation, and a container reset takes the scratchpad with it. When
the guild lead makes a call — a default, a threshold, a policy, a "we don't do
that" — append it to **`docs/DECISIONS-<YYYY-MM-DD>.md`** before the session
ends, and fold anything that outlives the week into this file. Each entry: the
call, why, and where it landed. Keep the "Open — read this first" table at the
bottom current; that table is what the next session reads first.

Retrieval is automatic and cheap: `.claude/hooks/session-digest.sh` runs on
SessionStart and prints the open-items table + doc index + live versions, and
`/recall <question>` fans a Haiku subagent over `docs/` to answer from the
files with citations. Both are only as good as the writing discipline above —
**the reading half was never the weak link.**

### Working rule — deployment decisions write to the self-host epic
**Every design or infrastructure decision that changes how the platform is
deployed, what it stores, or what it costs to run gets a line in
`docs/DESIGN-selfhost-wizard.md` §3 AT THE TIME IT IS MADE** (Hitya,
2026-08-12). The end goal is a walkthrough wizard that stands the whole platform
up for another guild — an epic for later, but one that can only be built from
decisions that were recorded as they happened. A choice captured only in a
runbook is written for one specific box and the wizard will not know about it.

This has a direct cost dimension, which is the point: hosted Supabase bills on
storage and egress, which is *why* production prunes `buff_casts` to 7 days —
while an on-prem box keeps everything for the price of electricity. So
"how long do we keep this?" is not a data-modelling question, it is a hosting-bill
question, and the answer differs per deployment. Anything that assumes our
retention windows, our hosting mix, or our Discord layout needs to say so.

### Working rule — "do we already have X?" (answer from the index, not one grep)
For any *does-this-exist / where-does-it-live* question, read
**`docs/HOW-ITS-BUILT.md`** (the feature-by-feature index) FIRST — it maps every
feature to its file + surface. A **"no, we don't have that" answer is the
failure-prone direction**: never conclude it from a single file. A feature can
live on any of FOUR surfaces and often spans several — the agent dashboard
(`WEB_HTML` in `packages/wolfpack-logsync/index.js`), Mimic
(`apps/mimic/*.html` + `main.js` + `preload.js`), the bot (`index.js` +
`commands/` + `utils/`), and web (`web/`). Grep ALL of them (and the index)
before saying "no." When a feature ships, add/refresh its `HOW-ITS-BUILT.md`
entry so the index stays trustworthy — a stale index causes exactly the wrong
"we don't have it" answer (the eqclient/zeal "Set up for me" miss, 2026-07-19).

---

## Release playbook

### Branches
- **`main`** — production. Bot (Railway), web (Vercel), and *stable* Mimic
  releases ship from here. Always green.
- **`beta`** — Mimic beta channel, and ONLY that. `release-mimic.yml` builds a
  prerelease whenever `apps/mimic/package.json`'s version changes on this
  branch. Because the agent is *bundled inside* Mimic, agent fixes that beta
  users need must land on `beta` (and bump Mimic) — they do NOT reach beta
  users via `main`.
  **There is no bot beta** (2026-08-09) — the bot has ONE Railway environment
  pinned to `main`. Verified in the Railway config, not assumed.
  **The web beta is `b.wolfpack.quest`** (Hitya, 2026-08-09): put a `b.` in
  front of any page to see it as it stands on `beta`. Vercel had been building
  the branch anyway, but only onto a throwaway preview URL nobody could guess;
  this makes it addressable. Wiring:
  - `web/vercel.json` → `"git": { "deploymentEnabled": { "beta": true } }`;
  - Vercel → Domains → Add `b.wolfpack.quest`. **Pick the `Preview`
    environment, then set Git Branch to `beta`.** There is no "beta"
    environment and there should not be — Vercel's environments are
    Production/Preview (+ paid Custom Environments, which this project has
    none of); a branch is a separate field ON the domain (`gitBranch`, per
    `PATCH /v9/projects/{id}/domains/{domain}`).
    ⚠ **Leaving Git Branch blank is the trap**: the domain then follows the
    most recent preview deployment from ANY branch, so `b.wolfpack.quest`
    would drift onto whatever `claude/*` branch built last instead of beta.
    Then Vercel shows whether DNS is already delegated to it or a CNAME →
    `cname.vercel-dns.com` is needed at the registrar. `next.config.js` says
    that registrar is Porkbun; **treat that as unverified** — a cloud session
    cannot check (DNS-over-HTTPS and `api.porkbun.com` are both blocked by the
    egress proxy, and `dig` is absent), and two other long-standing doc claims
    turned out stale the same night. Let the Vercel UI tell you.
    ⚠ There is **no Porkbun integration** — no MCP connector exists (registry
    searched 2026-08-09), no credentials in the repo, and the REST API is
    unreachable from cloud sessions. This step is human-only, or needs a local
    session;
  - **Supabase → Authentication → URL Configuration → Redirect URLs must list
    `https://b.wolfpack.quest/**`** — otherwise sign-in silently fails on the
    mirror (Hitya, 2026-08-10: *"can't actually sign into beta"*). `SignInButton`
    sends `redirectTo = window.location.origin + '/auth/callback'`, and Supabase
    **ignores a redirectTo that is not on the allowlist and uses the Site URL
    instead** — so the user completes Discord consent and lands signed-in on
    production while beta still shows Sign in. Nothing errors; it just never
    takes. Leave Site URL as `https://wolfpack.quest`.
    ⚠ **This does NOT need a second Discord app / "beta SSO."** Discord never
    sees the app host: the redirect URI registered with Discord is Supabase's
    own `https://zhtoekwakucbckvatfky.supabase.co/auth/v1/callback`, which is
    host-independent. A second Discord app would be actively harmful — Supabase
    allows ONE Discord provider config per project, so it would force a second
    Supabase project, and then beta users get different `auth.users` ids,
    `wolfpack_members.user_id` diverges and the mirror stops reflecting
    production data. The app code is already fully host-relative
    (`window.location.origin` / `url.origin`); nothing in the repo needs to
    change for beta auth.
    ⚠ Dashboard-only from a cloud session — the Supabase MCP exposes no
    auth-config tool (checked 2026-08-10), same shape as the Vercel domain step
    above;
  - **Every env var must be enabled for the `Preview` environment too, not just
    `Production`** (Hitya, 2026-08-11). Vercel scopes env vars per environment and
    `b.wolfpack.quest` is a *Preview* deployment, so a Production-only var simply
    does not exist there. The failure is partial and therefore easy to miss: the
    public pages render fine and only the server-side path breaks — sign-in on beta
    died with *"SUPABASE_SERVICE_ROLE_KEY not set on the server"* while the same
    key worked on production. Applies to all of them
    (`SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_GUILD_ID`, `ALLOWED_ROLE_NAMES`,
    `OFFICER_ROLE_NAMES`, `DEMO_OBFUSCATE_SALT`, the `NEXT_PUBLIC_*` set); they
    all address the same Supabase project, so there is no reason to withhold any.
    Env changes need a redeploy to take effect.
  - `next.config.js` sets `NEXT_PUBLIC_IS_BETA` from `VERCEL_GIT_COMMIT_REF`,
    so the flag is a BUILD-time constant. Deliberately not a Host-header check:
    reading headers in the root layout forces every page dynamic.
  - `components/BetaBanner.tsx` renders the bar and links back to the same path
    on production; the layout also flips metadata to `noindex, nofollow` and
    titles to "(beta)". **The noindex is load-bearing** — the mirror serves the
    same pages on another host, which is duplicate content that would otherwise
    compete with wolfpack.quest in search.
  ⚠ `web/vercel.json` is strict-schema — Vercel rejects unknown properties, so
  **never add a `comment` key** to it. Document here instead.
- **Working branches** (`claude/*`) — branch off `main`, merge back with a
  versioned `-m` message.

### RULE — when `main` gets something, `beta` gets it too (Hitya, 2026-08-10)
Automated, not remembered: **`.github/workflows/sync-beta.yml`** merges `main`
into `beta` on every push to `main`. So beta is continuously `main` + whatever
agent/Mimic work is in flight, rather than a snapshot that starts rotting the
moment it is taken.

- The only files the sync will not pull backwards are the two deliberately-ahead
  version files — `apps/mimic/package.json` (the park) and
  `packages/wolfpack-logsync/package.json`. On a conflict there, beta wins.
- **Any other conflict fails the workflow loudly** rather than auto-resolving.
  That means main and beta genuinely diverged on shared code, and silently
  picking a side is how you lose work.
- It pushes with `GITHUB_TOKEN`, which by design does not trigger `on: push`
  workflows — so a sync never cuts a spurious `-beta.N` and never double-runs CI.
- **This does not make a `beta → main` branch merge safe.** Beta still carries
  the park and in-flight Mimic work, so graduations stay file-level promotions.
  The sync removes the *drift*, not the *direction*.

⚠ **Why the old "re-sync at each graduation" was never enough — a re-sync is a
SNAPSHOT, not a link (measured 2026-08-10).** The 2026-08-09 re-sync landed at
02:05 UTC; `main` took **50 more commits** over the next day and a half (it runs
12–42 commits/day — bot, web and docs all land there), so by the next graduation
beta was already 7,714 deletions behind, including three test files and a whole
`/about` page main had gained *after* the re-sync. Nothing on beta was deleted —
**main moved forward.** Kept here because the failure mode is worth recognising:
if the sync workflow is ever disabled, beta starts rotting again within hours.

**`beta` is `main` + the Mimic park, and must be RE-SYNCED after every
graduation (2026-08-09).** Nothing ever flowed main→beta — agent/Mimic work
landed on `beta`, graduations copied FILES to `main`, and the rest of the repo
on `beta` just aged. It reached **79,199 lines behind** on bot/web/docs/tests.
Two concrete costs: `git merge beta` into `main` would have DELETED the raid
review, raid guide, officer console, `/me` surfaces, 60+ migrations and 50+ test
files (so every graduation had to be a hand-picked file list, and picking wrong
was silent); and `beta` carried **35 test files against main's 90**, which is
why the `{s}`-eats-the-timestamp P1 rode through agent 3.5.44–3.5.53 unseen —
`test/trigger-class.test.js` simply did not exist there. After cutting a stable:
`git checkout beta && git reset --hard origin/main`, re-park
`apps/mimic/package.json` one patch above the new stable, verify the agent +
Mimic files are byte-identical to the beta being replaced, run the full gate,
then `push --force-with-lease`. Discarding beta's history is safe **because
every beta build's commit stays reachable through its release tag**
(`v2.3.4-beta.1` … `v2.3.5-beta.1`) — check that before force-pushing.

**CI runs on `beta` as of 2026-08-04 — it did not before, and that cost us a
P0.** `test.yml` and `golden-log.yml` both declared `push: branches: [main,
beta]`, but **GitHub runs the workflow file from the branch being pushed**, and
neither file existed on `beta` (24 golden-log runs on main, 0 on beta). So the
branch every agent + Mimic change lands on was the one with nothing checking it,
and agent 3.5.5–3.5.14 shipped an agent that crashed at boot. Lint caught it on
the first run there. **A workflow that DECLARES a branch is not a workflow that
runs on it** — `test/workflow-yaml.test.js` catches a *broken* workflow, not a
*missing* one, and both look exactly like green CI. When adding a workflow meant
for both branches, put the file on both.

### Routing a change
| Change touches | Push to | Bump |
|---|---|---|
| Bot (`index.js`, `commands/`, `utils/`) | `main` | root `package.json` (+ a `CHANGELOGS` entry in `utils/onboarding.js` — drives `/onboarding` "what's new"; skip if nothing user-facing) |
| Web (`web/`) | `main` (default — web still ships straight to main). To have a change reviewable first, land it on `beta` and read it at `b.wolfpack.quest/<same path>`, then graduate to `main` | `web/package.json` |
| Agent, for beta users | `beta` | `packages/wolfpack-logsync/package.json` only. Since 2026-07-08 ANY beta push touching `apps/mimic/**` or `packages/wolfpack-logsync/**` builds; do NOT bump Mimic per iteration |
| Mimic | `beta` (or `main` to cut stable) | `apps/mimic/package.json` stays PARKED at the line's target — the workflow auto-increments the `-beta.N` tag per push (v1.7.2-beta.1, -beta.2, …). Bump only when opening a new line or cutting stable on `main`. **Cadence rule (Hitya 2026-07-14): everything EXCEPT Mimic ships straight to `main`; Mimic alone runs the beta→stable loop** — cut stable when the line is *meaningful*, re-park beta, iterate, repeat. A meaningful feature set takes a MINOR bump for its line (the healer-attribution work is the **1.9** line), routine fix rounds take a patch. **After cutting a stable, immediately re-park beta above it** (stable 1.7.1 → beta parks at 1.7.2): a park at/below the stable would tag prereleases that semver-sort BELOW it, and the updater would stop offering new betas (Hitya 2026-07-09) |
| Supabase migration | `main` (file) + apply | see Migrations below |
| Docs only | `main` | none |

**RULE — shipping updates the docs at BOTH gates (Hitya, 2026-08-11).** A
feature or fix that lands on `beta` updates its documentation IN THE SAME
CHANGE — its `docs/STATUS.md` entry plus the relevant design doc /
`HOW-ITS-BUILT.md` row — and when it graduates to `main` the entry is updated
AGAIN with the stable release version. Not optional polish: a ledger that lags
its code is what made `/recall` report #202 as "blocked on the call" the day
after it shipped. If the doc edit isn't in the diff, the ship isn't done.

Patch bump by default. Commit message convention: `<component> vX.Y.Z — short
reason` (Railway shows the merge commit message as the deploy name — never
merge with `--no-edit`). When one change spans bot + agent, land the bot part
on `main` and the agent part on `beta` as two commits; cherry-pick or
file-checkout between branches rather than merging whole branches (the beta
branch must never promote stale bot/web files to `main`). Graduating a Mimic
beta to stable: merge the Mimic/agent state to `main` with a stable version.

**Release-visible text is member-facing, not a git log (Hitya 2026-08-07,
from the v1.1.20 announcement wall-of-text).** The graduation/stable commit
body becomes the GitHub release body, which the #mimic-releases announcer
reposts verbatim — so write it for a raider on a phone: **bullet every
user-facing item** (one `- ` line each, never a prose paragraph), and **no
technical jargon** — no code identifiers, API/library names, or internal
shorthand. EverQuest-mechanic terms (rampage, DA, slow, CH chain, mez) are
fine; `shell.openExternal` is not. The same rule applies to
`web/lib/roadmapData.ts` release entries and any Discord-facing changelog.
Detailed technical commits stay technical — this rule is only for text that
reaches a release surface.

**Beta-first (Hitya, 2026-07-23): Mimic/agent changes ship to `beta` by
default.** Cut a stable graduation only when something specifically warrants
the whole fleet getting it (a raid-critical fix, a broken stable, or an
accumulated batch the guild lead asks to promote) — not per-iteration.
**Release names are the guild lead's call**: never name a release (roadmap
titles, commit messages, announcements) without consulting Hitya first;
propose, they pick. Unnamed = plain version string.

### Mimic release channels — Linux (Deck) vs Windows (consult before routing a Mimic change)
Mimic builds to THREE electron-updater channels, and they are deliberately
isolated. Know which one a change targets before you push:

| Channel | Ships from | Workflow | Version / feed | Audience |
|---|---|---|---|---|
| **Windows stable** | `main` | `release-mimic.yml` | plain `X.Y.Z` → `latest.yml` | whole Windows fleet |
| **Windows beta** | `beta` | `release-mimic.yml` | auto `X.Y.Z-beta.N` → `beta.yml` | Windows beta testers |
| **Linux / Steam Deck** (#156, EXPERIMENTAL) | `claude/**` working branch | `build-mimic-linux.yml` | `<parked>-linux.<run_number>` → `linux.yml` | Deck testers only |

Load-bearing facts:
- **The Linux/Deck build is isolated for what a client INSTALLS — but NOT for
  how it DISCOVERS releases.** It publishes ONLY to `linux.yml`; the Linux
  client pins `autoUpdater.channel = 'linux'`, and Windows clients read
  `latest`/`beta`, so a Windows box can never *install* a `-linux.N` build.
  **Discovery is a different story and bit us (2026-07-30):** every release —
  linux, beta, stable — lands in ONE `releases.atom` feed that GitHub caps at
  **10 entries**. Fourteen Deck builds in two days pushed `v2.1.1-beta.2`,
  `-beta.1` and `v2.1.0` out of that window, so beta clients (which walk the
  atom entries for a tag whose prerelease id starts with `beta`) found only
  `linux` tags and failed with *"Update check failed: No published versions on
  GitHub"* — the whole Windows beta channel, unable to update. Stable was
  spared only because it resolves via `/releases/latest` instead of the feed.
  **Mitigation:** `prune-linux-releases.yml` keeps the newest N `-linux.N`
  releases and runs at the end of every Linux build. Never let Deck iteration
  fill the feed again — and remember the isolation guarantee covers installs,
  not the release list.
- **Linux support code lives on the working branch + its own channel until
  #156 graduates.** All of it is `process.platform === 'linux'`-guarded (inert
  on Windows), but keep it isolated — don't let it ride to the Windows fleet or
  to stable before the Deck work is blessed.
- **To route a Mimic FEATURE that should reach Windows, cherry-pick the
  specific feature commits onto `beta`** — never merge the whole Deck working
  branch (that drags the experimental Linux plumbing onto the Windows fleet,
  and onto stable at the next graduation). The feature code itself is
  cross-platform (the split is build/channel routing, not source). Drop any
  Deck-only docs from the cherry-pick (docs → `main`, and a Deck-bridge doc
  doesn't belong on `beta`). Precedent (2026-07-26): the **Zeal + custom-UI-pack
  auto-updater** (`ghDownload.js` / `zealUpdater.js` / `uiPacks.js` + Settings
  cards) was built on the Deck branch, then cherry-picked to `beta` as the two
  clean feature commits — resolving only the boot-timer hunk (its Linux anchor
  line is absent on beta) and dropping the Deck doc.

**Every release updates the roadmap** (Hitya 2026-07-08). Add/extend a
`releases[]` entry at the TOP of `web/lib/roadmapData.ts` (newest first) for
any user-facing change — bot, web, agent, or Mimic. Each entry: the version
pill (`Web 1.0.x · Bot 3.0.y`, add a `beta` channel flag for beta-only), a
one-line headline, the headline features as SIMPLIFIED plain-language bullets,
and the **bug fixes at the bottom**. This is what a raider reads (mirrors the
`/onboarding` CHANGELOGS in tone) — keep it human, not a git log. Bump
`web/package.json` for the roadmap edit like any web change.

### Raid-night deploy freeze (Hitya 2026-07-13)
**Never push to `main` during a raid window: Sun/Wed/Thu 19:30 ET → 00:30 ET.**
Any main push restarts production surfaces the raid depends on (and mid-raid
restarts are what amplified the 2026-07-13 queue backup + announcer spam).
Beta pushes are fine (Mimic updates are pull-based). If something is broken
*during* the raid and the fix must ship now, include `[hotfix]` in the commit
message — that's also the escape hatch for the `raid-freeze.yml` tripwire
(advisory red X; Railway/Vercel deploy on push regardless). Stage everything
else on a working branch and land it after midnight ET.

### Migrations
Timestamped `YYYYMMDDHHMMSS_description.sql` in `supabase/migrations/`,
idempotent (`IF NOT EXISTS`). The GitHub integration auto-applies on merge to
`main`. When a change needs the column *now* (agents already sending the new
field), apply via the Supabase MCP `apply_migration` with the same name AND
commit the identical file so repo and prod history stay in sync.

### When git state looks wrong
This environment's local clone can come up with stale refs (it has happened —
"my commits vanished"). Before concluding work was lost or force-pushing
anything: `git fetch origin main beta`, and verify the true branch heads via
the GitHub MCP (`list_commits`) — it queries the real API and is authoritative.
Then rebuild on the true head.

---

## Working across sessions (local desktop ↔ cloud)

Two kinds of Claude sessions work on this platform, and they cannot share a
conversation — they share **the repo, Supabase, and these docs** instead:

⚠ **A non-Claude agentic session** (Gemini Spark or similar) gets none of this
file automatically and does not run the SessionStart hook. Point it at
**`docs/GEMINI-SPARK-HELPER.md`** — boot order, branch routing, the full
verification gate, the test tiers, and the footguns that have already shipped
bugs. (`docs/AI-CONTRIBUTOR-BRIEF.md` is the different case: a chat AI with no
repo access, producing draft text a human carries back.)

- **Local (desktop) sessions** have the machine: `A:\EQ` (live Quarm client,
  Zeal, crash bundles in `crashes/`, character exports, trader `BZR_*.ini`
  price files), `D:\EQServer` (local MariaDB — authoritative `peq` item/NPC
  DB; creds in `eqemu_config.json`), `D:\EQLegends` (modern-client
  reference), and open egress (pqdi.cc, quarm.guide, eqemulator.org).
- **Cloud sessions** get the repo + Supabase MCP, but **no local files** and
  a restrictive egress proxy (eqemulator.org and PQDI are blocked there).

Rules that keep them married:
1. **Durable state lives in committed docs, never chat.** Status + durable
   queue: `docs/STATUS.md` (the single index/ledger; ordered plan in
   `docs/DESIGN-platform-queue.md`). Cross-session handoffs: write a handoff doc
   and commit it (the `*HANDOFF.md` pattern).
2. **Cloud sessions blocked on local-only data**: don't guess — add a
   "needs local session" item to `docs/STATUS.md` (⚠ Needs a local session)
   with the exact query or file wanted. A local (or phone-Dispatched) session
   picks it up.
3. **Local sessions mirror local-only facts into Supabase** so cloud
   sessions can use them. Precedents: `spell_level_seed` (PQDI scrape ran
   locally because the server 403s cloud IPs), the `eqemu_items`
   haste/regen/manaregen/damageshield/attack backfill (555 items from the
   local `peq` DB, 2026-07-11 — the eqmac dump omits those columns, so the
   weekly sync can't overwrite the backfill), `crash_reports` signatures.
4. **Only local sessions run migrations that need local verification**, and
   any session applying via MCP must also commit the identical file (see
   Migrations above).
5. **A stale local checkout hands work over as a zip** (patches + bundle +
   HANDOFF.md); the cloud session cherry-picks/ports onto the TRUE branch
   heads and re-versions — never fast-forward to a bundle from an old base
   (the 2026-07-11 handoff was built on a Jul-2 beta and shipped fine as
   cherry-picks).

---

## Scope boundaries (read before changing related code)

- **Historical chat: collection IS in scope, display is NOT.** Old-log `/gu` +
  `/rs` backfill flows into the `chat_messages` table
  (`POST /api/agent/historical_chat` — kept, not deprecated). We deliberately
  never replay old chat into Discord threads; live chat posts directly without
  era subdivision. Era-thread routing in `_handleAgentChat` and
  `commands/initerathreads.js` are deprecated.
- **PoP expansion locked until `2026-10-01`** via `isPopLocked()` in
  `utils/config.js`. PoP boss buttons return ephemeral lock messages, and the
  automated relays (`/api/agent/bosskill`, `/api/agent/lockout`) skip locked
  bosses too — PVP-event lockouts named for the war gods ("Tallon Zek" /
  "Vallon Zek") name-match Plane of Tactics bosses and used to synthesize
  timers onto the locked board (2026-07-13). A startup sweep clears any timer
  that leaks onto a locked boss. After unlock: run `/board`, refresh
  `pqdiUrl`s via `/addboss`.
- **`encounters.zone_short`**: the denormalized `eqemu_npc_types.zone_short` is
  NULL across the catalog (though the `spawn2`/`spawnentry` tables ARE now
  populated — see the catalog cheat-sheet). Historical rows were backfilled from
  `data/bosses.json`; `find_or_create_encounter` still doesn't set zone on
  insert — new encounters land NULL until the RPC/call-site passes it.
- **Zeal pipe carries no spawn id — same-name mobs are NOT disambiguable.**
  The named pipe's mob surface is the target (gauge slot 6) + pet (slot 16)
  gauges: display **name + HP per-mille only**, no entity id, level, or loc
  (confirmed against a live 71.5s raw capture — four `an orc warrior` spawns
  were byte-identical). So ≥2 identically-named mobs alive at once can't be
  told apart from the pipe; consumer-side correlation (death-boundary
  segmentation, HP-continuity) only resolves *sequential* same-name kills. Do
  NOT design features that need N≥3 simultaneous same-name identities **off the
  PIPE** — that surface can't support it.
  **Scoped 2026-08-07: the /tag CHANNEL is a different surface and DOES carry a
  spawn id, at any N we have been able to test.** Live measurements: 4
  simultaneous `a decaying skeleton`, 5 `a brown bear`, and in The Deep ~17
  `an elder thought horror` + ~11 `a horror guard` + ~9 `a thought horror
  evoker` — every one separable, captured losslessly by two independent agents.
  So same-name identity IS available; the catch is that it is **operator-driven,
  not passive** — a human must target and tag each mob, against a server chat
  rate limit (~8/min on `/tag chat` before a 30s lockout). Design for tags as
  high-confidence labels on the few mobs that matter, layered OVER position/HP
  clustering; never assume full coverage. Evidence + both upstream asks:
  `docs/zeal-tag-spawn-id-collision.md`, `docs/zeal-spawn-id-request.md`.
  **The upstream ask was aimed at the wrong surface (corrected 2026-08-05).**
  `docs/zeal-spawn-id-request.md` asks for `spawn_id` on those two GAUGES, which
  is the hardest possible place to put it — gauges are a stringly-typed
  `GetGauge(id, text)` channel with no room for structured fields. That is
  probably why it got no traction. The **entity** surface is trivial by
  comparison, and reading `Zeal/named_pipe.cpp` + `game_structures.h` proves it:
  - `Entity.SpawnId` sits at offset `0x0094`, with `PetOwnerSpawnId` at `0x0096`.
    The pipe's raid (type 5) and group (type 6) loops ALREADY hold that exact
    `Entity*` and dereference `->Position`, `->Heading`, `->HpCurrent` off it —
    `raid_data["spawn_id"] = entity->SpawnId;` is one line that is never written.
  - `player_data["target"] = {id, name}` via `get_target()->SpawnId` would close
    #194 outright.
  - **Pet position exists too** — Zeal reads it every frame to draw the pet arrow
    on the map (`zone_map.cpp:1056` `add_self_pet_position_vertices`:
    `self->ActorInfo->PetID` → `get_entity_by_id()` → `Position`/`Heading`). The
    pipe emits `loc` for exactly three things — raid member, group member, self —
    so a pet-tanked mob is unplaceable for us while being visible on the user's
    own map. Hitya spotted this 2026-08-05; do not repeat the claim that Zeal
    lacks the data.
  Rewrite the request against `named_pipe.cpp` before asking again.

---

## Bot (`index.js` + `commands/` + `utils/`)

Discord bot + bearer-auth HTTP API (token `WOLFPACK_AGENT_TOKEN`) on `PORT`.
~80 slash commands in `commands/` (full reference: README). Responsibilities:

1. **Raid timers** — instanced boss kill tracking (133 bosses in
   `data/bosses.json`, hot-reloaded), expansion-thread boards, spawn alerts,
   midnight summaries. PvP-server and Plane-of-Hate variants with their own
   timer math (±20% variance, quakes).
2. **Parse aggregation** — agent uploads + manual `/parse` paste merge into
   Supabase `encounters`/`encounter_players` via `find_or_create_encounter`
   (dedup by ±30min window) + `merge_encounter_players` (max-damage-per-player
   across submitters).
3. **Agent API** — the `/api/agent/*` surface below.
4. **DKP/loot/wishlist** (OpenDKP via `utils/opendkp.js`; sealed bids
   AES-256-GCM in `utils/bidCrypto.js`), **roster** (`utils/roster.js`,
   persisted as chunked JSON in Discord threads), **onboarding**, **audit
   trail** (officer Undo buttons), **member sync** (Discord guild →
   `wolfpack_members`, every 6h).

### Discord layout (env-var anchored)
`#raid-mobs` holds four fixed message slots (Active Cooldowns / Spawning in
24h / Daily Summary / thread links) plus one thread per expansion, each with a
cooldown card + zone kill cards + board panels — all edited in place, never
re-posted. Anchor-ID priority everywhere: `process.env.<KEY>` →
`state.channelSlots` → `null`, so anchors survive volume loss. Named threads
(Historic Kills, Parses Log, Onboarding, Hate, Roster ×2, Audit, Feedback,
PvP, Live…) are all env-var IDs — see `.env.example`, which documents every
variable.

**⚠ `data/state.json` DOES NOT PERSIST on Railway — there is no volume mounted
on the service.** Every deploy boots with `[state] state.json not found —
creating fresh state` (verified in the live deploy log + the Railway service
config, 2026-08-04). `.dockerignore` says the file "must come from the mounted
volume"; that intent is currently NOT true. Everything else survives because it
has an env-var fallback — which is what the anchor priority above is FOR — so
the gap only shows up for state whose key can't be pre-declared as an env var.
That is exactly how the raid review's per-night message id ended up posting
**eleven copies of the same review in one night** (eleven redeploys, bot 3.1.8).
**Anything keyed per-night / per-fight / per-anything-dynamic must go in
`bot_kv`, not `state.json`** — the trash tally and now the review id both do.
Treat `state.json` as a within-process cache, never as memory across a deploy.

**Discord is the source of truth** for parses (`PARSES_LOG_THREAD_ID`
reloaded on startup), hate state (hidden JSON embeds), and roster (chunked
messages); `data/state.json` and `data/parses.json` are local mirrors with
atomic writes (`.tmp` + rename). Recovery: `/restore <message links>`,
`/recoverkills` (from Supabase encounters).
⚠ **That is the CURRENT state, no longer the direction** (Hitya, 2026-08-16:
*"discord was a source of semi-truth. now it should just be a projection"*).
No NEW durable state goes into Discord messages or state.json — Postgres is
the home, Discord renders it. The existing estate migrates opportunistically
in the order state.json keys → roster → hate → parses thread
(`docs/ARCHITECT-REBUILD-2026-08-16.md` Part II).

### HTTP endpoints (`/api/agent/*`, bearer auth)
Ingest: `encounter` (combat events → parse cards + Supabase), `chat` (live
/gu + /rs relay), `historical_chat` (backfill → `chat_messages`), `pvp` +
`pvp_assists` (kill/death/assist broadcasts + /who harvest), `bosskill`
(instance kills → auto-timers), `lockout` (/sll relay), `live-state` (Zeal
buffs+zone snapshot → `character_live_state`), `raid-roster` (Zeal type-5 →
`raid_roster`), `buff_casts` (observed buff landings; `is_charm_spell` rows
are agent-synthesized charm timers), `casting` (cross-client cast relay),
`tells` (private tell history), `trigger` + `trigger-relay` (trigger fires →
Discord), `fun_event`, `quake`, `ui_layout` (UI Studio backups), `place-bid`.

Query: `latest-version` (agent update prompts), `mob-info` (NPC catalog
stats, 6h cache), `who-lookup` (de-anon from who history), `spell-catalog` +
`item-clickies` (ETag'd catalogs from `eqemu_*`), `target-casts` +
`target-buffs` (who's casting on / what's landed on a target — powers
cross-client Mob Info), `raid-buff-queue` (buff/debuff/cure queues: online
raiders only, same-zone first, tank-HP priority, curse-counter sort),
`guild-triggers` (2-min poll — a new/edited guild trigger reaches raiders in
~2 min; `_guildTriggersFor` reads Supabase live, so a direct DB write is served
immediately and the no-change gate is `max(updated_at)`), `backfill-requests`,
`character-prefs`
(opt-out flags), `recent-fires`, `threat-snapshot`, `incomplete-encounters`,
`server-panel`, `poll` (#106 multiplexed bundle — one GET carrying
`recent_fires`+`tuning`+`triggers`+`prefs`+`backfill`+`ui_edits` at each
stream's own cadence with per-stream cursors + shed-omission; agent 3.3.87+
runs one loop and falls back to the individual routes on a 404).

Payload limits: chat 256KB, encounter 10MB. Returns 503 if
`WOLFPACK_AGENT_TOKEN` unset.

**Mid-raid load-shed:** set `flag_shed_<kind>` (snake_case, e.g.
`flag_shed_live_state`) to `1` in the `/admin/overlays` tuning editor; the bot
200-acks-and-drops that stream within its 60s tuning cache, no deploy or agent
update. `0`/delete restores. Sheddable kinds (`#74`, bot 3.0.209): the four
ephemeral streams `live_state`/`raid_roster`/`casting`/`threat_snapshot` PLUS the
redundant/re-derivable `buff_casts`, `pvp`, `pvp_assists` (the /who-harvest rides
`pvp`/`pvp_assists`), `fun_event`, `trigger_relay`, `ui_layout`, `tells`.
**Deliberate exceptions — NEVER sheddable** (`_SHED_NEVER` in `index.js`):
`encounter`, `chat`, `bosskill`, `lockout`, `historical_chat` — the durable
streams; `_isShedded` refuses them even if the flag is set so nobody fat-fingers
the raid's parse collection off. Discord posting is deferred post-ack in the
`encounter`/`chat`/`trigger` handlers (v3.0.166) — agents never wait on Discord.

**Control plane (#74, bot 3.0.209):** two officer-facing policy keys ride the
same tuning map, served on BOTH the reporter-poll (20s) and guild-trigger (2min
backup) responses so agents honor them fail-open (missing/unparseable → no
effect; bot down → agents run normally): `flag_agent_kill=1` puts the whole fleet
dormant (agents stop all uploads + non-control polls, hold the durable queue, keep
their heartbeat, banner "⏸ Agent paused by guild control plane"; overlays keep
working on local data; clearing resumes within one heartbeat); `min_agent_ver_num=<n>`
is a version floor — agents whose numeric version (`major*10000+minor*100+patch`,
3.3.85 → 30385) is below it stand down like dormancy + show an update nudge. Both
are set in the `/admin/overlays` 🛑 Kill switches section. *Conservative v1 —
Hitya to sign off.* Per-channel manifest: `GET /api/agent/latest-version?channel=beta`
serves the beta-line agent (`AGENT_RELEASE_REF_BETA` env / `agent_release_ref_beta`
tuning) so beta Mimic hot-swaps along the beta ref; safe only because the kill
switch + Mimic LKG crash-loop rollback are the gates.

**Admission-control budgets (#73, bot 3.0.208):** per-uploader × per-kind
windowed budgets on the ingest surface via the SAME 60s tuning map —
`budget_<kind>_per_min` overrides the built-in default (`0` = unlimited),
`budget_enforce_<kind>=1` turns a durable kind's over-budget from log-only into
a real 429 + `Retry-After` (leave off until the fleet is on agent ≥3.3.85, which
honors Retry-After), `flag_disable_budgets=1` kills the whole feature. Durable
kinds default to log-only; ephemeral kinds default to 200-ack-and-drop over
budget (the shed pattern) — a healthy agent never trips them. Supabase calls
carry a ~10s AbortController timeout + a consecutive-failure circuit breaker
(env `SUPABASE_REQUEST_TIMEOUT_MS` / `SUPABASE_BREAKER_THRESHOLD` /
`SUPABASE_BREAKER_COOLDOWN_MS`; state on `GET /health`). `target-buffs` GET is
now 2s-cached like `character-live-state`.

### Background jobs
Spawn checker (5 min; also PvP/live/quake checks, stale-alert suppression
post-redeploy), TZ-aware midnight chain (daily summary → archives → parse
consolidation → resets), member sync (6h), chat dedup GC (10s), weekly
eqemu mirror sync (`.github/workflows/sync-quarm.yml`).

---

## Agent (`packages/wolfpack-logsync/index.js`, ~35k lines, zero npm deps)

Tails `eqlog_*_pq.proj.txt`, filters at byte level **before** parse: officer
chat, tells, group, custom channels never leave the machine (`docs/PRIVACY.md`).
Uploads combat events, /who, chat relay, and the streams above. Modes:
`--watch` (default), `--since <ISO>` backfill (boss combat + /who + chat),
`--once`, `--dry-run`. Serves a dashboard on `localhost:7777`.

Key subsystems and their non-obvious rules:

- **Durable upload queue** — every outbound POST persists to
  `logsync.queue.json`; 15s drain, exponential backoff to 10m; 4xx drops as
  permanent. Update gate refuses `[U]`/`POST /api/update` while queue pending,
  backfill running, or a fight is live (`Shift+U` / `?force=1` bypass).
- **Charm pipeline** — `_charmTickTracker` (gauge-driven via Zeal slot 16,
  1.5s debounce on land, 10s grace on re-charm gap), `CHARM_SPELLS` map
  (name → class + duration; EQ logs backtick possessives — keep both
  spellings), `_pendingCharmSpell` staged from BOTH the parseEvent cast path
  AND `noteSelfCast` (the former misses some self-casts). The slot-16
  article-prefix filter (`/^an?\s+/i`) is what distinguishes charm pets from
  summoned pets. The 🐺 Charm diagnostic card (Triggers tab) walks all four
  pipeline checkpoints — point users there before debugging by hand.
- **Buff landings** — `_buffLandingsByTarget` (keyed by target; feeds Mob
  Info) and `_petBuffLandings` (keyed by owner; feeds Charm/Pet trackers).
  Both MUST use the era-cap level fallback (`_assumedCasterLevel()`, 60 → 65
  at PoP) when /who level is unknown — level-formula spells compute 0 ticks
  otherwise and instantly show "fell off". On charm land,
  `_captureTargetBuffsOnCharm` sweeps target-keyed entries into the owner key
  (pre-charm debuffs are the norm — you can't debuff your own pet).
  Linger rules: HoTs and any catalog duration < 60s get one tick (6s);
  everything else gets the 5-min purple "fell off — rebuff" cue.
  Charm spells (Allure etc.) have `cast_on_other = NULL` — no log line
  exists, so `_recordCharmSpellOnTarget` synthesizes the entry and pushes it
  to `buff_casts` with `is_charm_spell` for cross-client visibility.
  `resolveSelfCastLanding` matches landings by `body.endsWith(expected)` —
  never split on first space (multi-word NPC names broke that).
- **Pets on the DPS meter** — the threat tracker's anti-NPC filters (no
  multi-word attackers; nothing in `this.targets`) are bypassed for names the
  agent can prove are OUR pets (`petLeaders` / `_activeCharms` /
  `_charmTickTracker` active). Those rows carry `pet_owner`, which the HUD
  uses to whitelist + label them.
- **Triggers** — guild set polled from the bot + local
  `personal_triggers.json`. `{s}`-style placeholders compile to NAMED capture
  groups, and `_captureMatchesCharmPet` suppresses fires caused by your own
  charm pet. Zeal gauge conditions (`target_hp_pct` etc.) fire without a log
  line.

### Dashboard authoring — edit `dashboard.html`, NEVER the `WEB_HTML` literal
**The agent dashboard is authored in `packages/wolfpack-logsync/dashboard.html`**
(Decision #3's first slice, `docs/ARCHITECT-REBUILD-2026-08-16.md`, shipped
agent 3.6.9). `npm run sync:dashboard` folds it into the generated `WEB_HTML`
literal — the shipped artifact is still ONE committed `index.js`, so the fleet's
raw-fetch update chain is untouched. Agent-side interpolations are written as
`{{WP:expr}}` (e.g. `{{WP:AGENT_VERSION}}`) — everything between `{{WP:` and
`}}` becomes CODE inside the agent; `${}` in the .html is page content and is
escaped. `check:dashboard` fails the build on any drift, in either direction
(unsynced .html edit, or a hand-edit to the literal).

This retired the escape-hazard class: the old hand-escaped template literal
blanked the whole page on one bad character and shipped that way twice
(v2.4.25 bare `\n`, v2.4.27 bare `\'`), then bit twice more in review
2026-08-29..30 (a bare `\n`; a backtick inside a COMMENT terminating the
literal). All escaping is now mechanical (`\`→`\\` · backtick→escaped ·
`${`→`\${`), and the three historical killers were authored naively into
`dashboard.html` and served byte-correct as the ship-time proof
(`test/dashboard-embed.test.js`). `command.html` keeps its own stricter
verbatim scheme (`sync-command-embed.js`) — it BANS the special characters
instead of escaping them; don't unify the two without reading both headers.

### Dashboard rendering rules
`morphInto`/`setSectionHTML` is plain `innerHTML` with byte-level
change-detection — a section's HTML string must be **byte-stable across polls
when nothing changed**, or the whole section rewrites every 2s (flicker, form
resets, lost scroll). Anything volatile (timestamps via `fmtAgo`, live
counters, gauges) must live in its own `wp*`-id placeholder card filled by a
dedicated render fn (`wpZealCard`, `wpRecentFires`, `wpCharmDiag` are the
pattern). Never put `class="name"` on a cell whose text isn't a character
name — the click delegation slices to the first word and opens
`/character/<token>` (404s for trigger names, ability labels, etc.).
**Every `<details>` the dashboard emits MUST be built as
`'<details ' + wpKeep('stable|unique|key') + ' …>'`** — repaints (including a
PARENT section's repaint, which wipes nested placeholders before their own
render runs) reset a plain `<details>` to closed every poll (the 1.7.0-beta.2
"Zeal pipe closes immediately" bug). wpKeep persists open-state in a
JS-side store fed by a capture-phase `toggle` listener; DOM snapshots taken
inside render fns are NOT safe. `check-agent-dashboard.js` fails the build
on any emitted `<details>` without `wpKeep(` — this rule is enforced, not
advisory.

---

## Mimic (`apps/mimic/`)

Electron shell that bundles the agent + its own Node runtime. `main.js` owns
the tray, the agent child process, and one frameless transparent
always-on-top `BrowserWindow` per overlay; `preload.js` exposes the
`window.mimic` IPC bridge; `zealPipe.js` bridges Zeal's named-pipe stream
into the local agent.

**Field issue (n=1, 2026-06-12):** if Mimic can't detect Zeal at all, the fix
is reinstalling Mimic *outside* the EQ folder. Pipe detection is
path-independent (tasklist → connect by PID), so it's environmental (Mimic's
DLLs shadowing Zeal's DX hook, or AV on the in-game-dir exe), not a code bug —
no fix beyond the workaround. Details in `zealPipe.js` header. Note the friction:
`detectEqDir()` intentionally supports in-EQ-folder installs for *log* detection,
which can steer users into the layout that breaks *Zeal* detection.

⚠ **Field issue (n=1, Chadivarius, 2026-08-13) — WINDOWS XP COMPATIBILITY MODE
ON `eqgame.exe` BREAKS THE ZEAL PIPE.** Symptom: the agent log churns
`[zeal] disconnected from \\.\pipe\zeal_<pid> (EPERM)` every poll forever, so no
Zeal data ever arrives. **Fix: untick "Run this program in compatibility mode
for" on eqgame.exe.** Confirmed by a clean before/after on the same machine —
nothing else changed.
- **`EPERM` is the tell**: libuv maps Win32 `ERROR_ACCESS_DENIED` (5) → `EPERM`,
  so Windows is actively *refusing* the open. That is a different failure from
  the 2026-06-12 case above (`ENOENT`, no pipe at all) and from the 2026-07-05
  Jankzer case (connects, then the server instantly closes — no error code).
  Three distinct causes, three distinct log signatures; read the code before
  guessing which one a report is.
- **The mechanism is NOT confirmed** — do not invent one. Compat mode does not
  change a process's integrity level or user, which is why "it can't be that"
  is the wrong call to make (it was made here, and it was wrong). To actually
  pin it: Process Explorer → eqgame.exe → Security tab (virtualization flag +
  integrity level), and `accesschk \\.\pipe\zeal_<pid>` to dump the pipe's ACL,
  with compat mode on vs off.
- ⚠ **This will recur.** `quarm.guide`'s "Xanax's Checklist for Minimal Crashes"
  — which the guild points people at — recommends XP SP2 compatibility mode as
  item 8, so every raider who followed it is a candidate. Ask about compat mode
  FIRST on any `EPERM` report.
- **Elevation is still a real cause of pipe failures** (Jankzer), just not this
  one — the admin checkbox was confirmed unticked here. Both live on the same
  Compatibility tab, so check them separately rather than treating them as one
  setting.

Overlays (each an `.html` file): DPS HUD (`overlay.html`, DPS/Tank tabs),
Trigger alerts + countdown timers (`triggers.html`), Charm tracker, Pet
tracker, Mob Info (Stats/Loot/Spells tabs), Buff queue, /who, Melody, Zeal
health (diagnostic), plus Settings, UI Studio, loading.

### RULE — tray ↔ dashboard parity (Hitya, 2026-08-19)
**"Anything that's available from the taskbar should be available from the
dashboard as well."** A control that exists only in the tray menu is a control
people forget exists (the per-character layout saves sat tray-only from v1.2
until Hitya met them tonight). When adding a tray item, put its equivalent on
the dashboard's Overlays tab (or Settings) in the same change, driving the
SAME internals — never a parallel path. Remaining tray-only items are a
queued audit in `docs/STATUS.md`.

### Overlay feature-parity checklist
Every overlay must have ALL of these — a whole class of beta bugs was
overlays missing one (dead ✕ on Zeal health, no right-click on Buff queue,
missing Overlays-tab row):
1. ✕ hide button (top-right) + a branch for its window in main.js's
   `hide-overlay` IPC handler (flips the right `cfg.show*` flag);
2. ✥ move button (top-left) with manual-drag IPC (never CSS app-region —
   buggy on transparent windows) **and** a right-click context menu
   (resize presets + Setup THIS/ALL);
3. **hover-interact handshake** (`overlayHoverInteractive(true/false)` on
   mouseenter/leave) on EVERY clickable control — locked overlays are
   click-through (`setIgnoreMouseEvents(true,{forward:true})`), so without
   the handshake clicks fall through to EQ ("the button does nothing");
4. a row in the dashboard's `WP_OVERLAY_ROWS` + its key in
   `wpRefreshOverlayToggles` + a case in the `toggle-overlay` IPC;
5. visibility via its `apply*Visibility()` fn (unlocked override, quiet
   mode, `_eqGateOk` EQ-running gate);
6. its `cfg.show*` flag in main.js's `_HIDEALL_FLAGS` list — the hide-all
   hotkey snapshots/flips exactly that list (the Command Center missed it
   and kept showing through hide-all, 2026-07-10) — and an entry in
   `_overlayEntries()` (drives opacity, backdrops, auto-arrange, hover).

Layout collisions matter: anything at the title bar's right edge sits under
the fixed-position ✕ (the Buff queue class picker hid the overlay on a stray
click — reserve a ~30px right gutter).

---

## Web (`web/` → wolfpack.quest)

Next.js 14 App Router + Supabase Auth (Discord OAuth). Two sign-in gates:
guild membership + role membership (role IDs from `wolfpack_roles`, synced by
the bot). Sessions via HTTP-only cookies refreshed in `middleware.ts`.

Routes: public landing + auth; member surfaces (`/me` — tells, buffs/zone,
characters, stats; `/parses`, `/raid`, `/buffs`, `/who`, `/pvp`, `/boards`,
`/boss`, `/character`, `/leaderboards`, `/loadouts`, `/bards`, `/fun`,
`/feedback`, `/planner`, `/mimic` download); officer `/admin/*` (triggers,
attendance, encounters, agents, members, who, chat, audit, voice, quarmy,
signups, links, feedback).

Pattern note: officer list pages with per-row actions (e.g.
`/admin/triggers`) use a client component with optimistic `useState` +
`useTransition`, server actions in a separate `actions.ts`, and skip
`router.refresh()` after toggles — `revalidatePath` alone keeps other
sessions fresh without re-rendering (and visually flashing) the whole list.

---

## Supabase

Tier 1 `eqemu_*` mirrors (zone/items/npc_types/spells/loot tree/spawn —
weekly sync via `sync-quarm.yml`; the `spawn*` tables ARE populated as of
2026-07-27 — ~43.6k placed spawn points w/ coords+respawn across 182 zones —
only the *denormalized* `npc_types.zone_short` column stays NULL, so read a
mob's zone from the `spawnentry → spawn2` join). **Before querying `eqemu_*` or touching the
gear/spells/inventory pages, read `docs/eqemu-catalog-cheatsheet.md`** — the
load-bearing conventions (NPC id encodes zone `id=zoneid*1000+n`,
`eqemu_zone.expansion` era codes, spell scrolls = items `Spell: %` with no
level data, the Quarmy-export vs `/output inventory` vs spellbook file split,
the `character_missing_spells` data path) live there so they don't get
re-derived from EXPLAIN plans each time. Tier 2 guild data we write: `characters`,
`bosses_local`, `raid_nights`, `encounters`, `encounter_players`,
`contributions` (with `agent_version` + `has_ability_detail` watermark),
`encounter_combat_rollup`, `loot_drops`, `wishlists` (encrypted bids),
`chat_messages`, `who_observations` (+ `inferred_zek_*` PvP proximity
columns), `character_live_state`, `buff_casts` (+ `is_charm_spell`),
`raid_roster`, `guild_triggers`, `fun_events`, `wolfpack_members`,
`wolfpack_roles`, `audit_log`, plus tells and PvP tables.

RPCs: `find_or_create_encounter(p_guild_id, p_npc_id, p_started_at,
p_duration, p_window_min)` and `merge_encounter_players(p_encounter_id)`.
The find-or-create dedup has a sequential-kill splitter (damage ≥ 0.9×catalog
HP + new start past the matched fight's window → separate encounter) that
additionally requires the matched encounter to be a CONFIRMED kill
(`ended_at` set) — an unconfirmed engagement can't have respawned, so a
dispel/FD reset that full-heals the mob knits into ONE kill instead of two
cards (Lord of Ire, 2026-07-13).
Views: `eqemu_npc_drops`, `item_with_proc`, `character_data_floor`,
`character_rollup_coverage`, `who_directory`.

RLS: Tier 1 readable by `anon`+`authenticated`; guild tables
`authenticated`-only; encrypted bid columns service-role-only; the bot uses
`service_role` and bypasses RLS.

---

## Domain policies (load-bearing — don't re-derive)

**Raid lockouts are ENGAGE locks, not loot locks (Hitya, 2026-08-21).** A
character with an active lockout on a raid mob **cannot fight it at all** — on
engage the server *teleports them out of the zone*. They can't participate and
can't loot. It is **per character**, so it is normally an ALT that carries one
for a current-era boss (a main raiding with us has no way to pick one up
elsewhere). Consequences for anything we build on `character_lockouts`: this is
a PRE-PULL question, not a loot-distribution one — a locked raider who pulls
anyway is a body that vanishes mid-fight, so the useful surface is "who in
tonight's raid is locked", not "who couldn't loot". Do not describe these as
"loot lockouts" in UI copy; the phrase understates what happens.

**Character identity scopes.** Three different "who is this" questions:
guild *membership* = union of (Discord role `Pack Member`+ via
`characters.discord_id`→`wolfpack_members`) OR (OpenDKP rank `Raid Pack`+).
Roster presence (`utils/roster.js`) is broader; "ever seen"
(`who_observations`) is broadest and only `/whois` uses it. Gap detection
candidates come from the membership predicate, never "every roster name".

**Per-character data floor.** `character_data_floor` view:
`member_since = LEAST(first /gu, first /rs, first OpenDKP tick)` across the
character's *family* (main + alts). PvP data is exempt (no floor). Opt-out
flags on `characters`: `exclude_from_stats`, `exclude_inventory` — consumers
must honor both.

**Combat rollups watermark.** Per-verb totals exist only for uploads at/after
the cutover agent version (`contributions.has_ability_detail`). History is
enriched opt-in by re-running the agent over old logs; `find_or_create_encounter`
dedups so re-submissions attach instead of duplicating.

**Stat visibility scopes.** Every log-derived stat declares `PRIVATE` (owner's
`/me` only) / `ANON` (nameless aggregates) / `GUILD` (named, signed-in
members). Excluded characters never contribute or display.

**Guild trigger shapes.** Default to the portable shape (`text_overlay` +
`tts`, trigger-level `timer_duration_sec`, `warning_seconds/_text`) — fires on
every Mimic version. The `voice` action with `marks` requires the newer agent;
use only for multi-callout sequences. Curse counters for the debuff queue live
in the bot's `_CURSE_COUNTERS` (Gravel Rain 12 … "Word of" 1).

**⚠ Trigger patterns match the RAW log line — never start one with a bare `^`.**
(Runtime nuance, discovered 2026-08-16: agent **3.5.46+** auto-rewrites a bare
`^` to `^(?:timestamp)?` at compile time — `_rewriteAnchorsForRawLine`, part of
the GINA compat work — so on the current fleet the bare-`^` class actually
fires. The rule stands for what we WRITE (explicit `^\[.+?\]\s+` works on
every agent version and is what the web normalizer stores), but the 2026-08-04
"37 of 109 dead" measurement predates 3.5.46 and the dead-triggers runbook
needs re-measuring before anyone acts on it.)
The line is `[Sun Aug 02 21:10:01 2026] <message>`, and patterns compile with
flags `i` and **no `m`**, so `^` anchors before the TIMESTAMP, not before the
message. `^{s} yawns\.$` can never fire. Write it unanchored, or anchor as
`^\[.+?\]\s+`. **Do NOT "fix" one by deleting the `^`** — `{s}` expands to a
class that includes space, so an unanchored pattern captures `" Uilnayar"` with
a leading space and corrupts every name-keyed consumer. `/admin/triggers` now
normalizes on save (`web/lib/triggerPattern.ts`) and flags existing dead rows,
but **37 of 109 enabled triggers are still dead in the table** — measured
2026-08-04, staged fix in `docs/RUNBOOK-dead-triggers.md`, deliberately unapplied
because turning 37 callouts on at once is a raid-noise decision. Two sibling
failure modes cost us the same way: an **invented pattern** (the Divine
Intervention trigger matched text that appears nowhere in spell 1546 — always
check `eqemu_spells.cast_on_you/cast_on_other/spell_fades` for the real string)
and a **mis-signatured** one (AOE_DANCE watching another spell's text). In all
three cases the trigger was *enabled*, which is what made it invisible — an
enabled trigger reads as coverage.

**Chat-extracted historical parses** under-count DoT classes and credit
damage shields to the tank — keep `contributions.raw_parse->source` distinct
(`eqlogparser_send_to_eq` / `local_agent_v1` / `chat_extracted`) so agent data
wins when both exist.

**Fleet adoption is counted in PLAYERS, never characters** (Hitya,
2026-08-16: "character counts mean almost nothing"). Players each play several
characters distinctly (3–12 watched logs), so `agent_upload_stats` rows
inflate ~10×: the "178
characters on 3.5.80" fleet was 16 players. The honest stat: distinct
`uploaded_by_discord_id`, each counted at their most-recent upload's version.
Any adoption gate, graduation argument, or sentinel invariant that counts the
fleet counts players.

**Raid schedule:** Sun/Wed/Thu 8pm–midnight Eastern — the default window for
any "should have been there" computation. **Since 2026-08-16 (Hitya, live):
alt raids and Seru+misc nights run 3 ticks / 2 hours (8–10pm ET), until
Planes of Power**; other nights keep the full window. Tick math needs no
change — RA is distinct-ticks ÷ total-ticks and never assumes a per-night
count. The 19:30→00:30 ET deploy freeze deliberately stays full-length on
all three nights (short raids can still run long; shortening the freeze is
its own call).

---

## Roadmap

**Status + durable queue: `docs/STATUS.md`** (single index/ledger — what's done,
TODO, abandoned, folly; retired queues live in `docs/archive/`). Ordered plan:
`docs/DESIGN-platform-queue.md`. Deeper designs:
`docs/raid-hub-roadmap.md`,
`docs/DESIGN-buff-debuff-queue.md`, `docs/DESIGN-ch-chain.md`,
`docs/MIMIC.md` / `docs/MIMIC_AGENT.md`, `docs/opendkp-capture-playbook.md`,
`docs/code-signing.md` (CLOSED 2026-07-14 — SignPath declined: user base too small; installers stay unsigned unless another provider appears), `docs/PRIVACY.md`.
Headline items parked for later: UI Studio web viewer/editor on `/me/ui` +
automatic UI/eqclient.ini cloud backups; OpenDKP auction wiring (creation
captured, bid/award endpoints not); guild timeline; chat→parse extraction;
spells/tradeskill/faction advisors on `/me`; long-haul storage partitioning.
