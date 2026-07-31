# Design — Onboarding overhaul: a "New Here?" walkthrough on web + Discord

Status: **proposal, awaiting Hitya sign-off.** Design only — no feature code has
been written. Trigger: Hitya, 2026-07-31 09:38 — *"our /onboarding really needs
an overhaul. We're likely going to want some screenshots in there, or a 'New
Here?' guided walkthrough on the website and the discord."*

Scope note: this doc owns the **guild-side** first-hour experience (Discord card,
web walkthrough, screenshots, progress tracking). The **Mimic first-run gate**
(`loading.html` + the "Set up for me" EQ-config writer) is task **#53**, already
queued separately under `[#86] role-aware first-raid mode (+[#53])` in
`docs/DESIGN-platform-queue.md:138`. This design *links to* that flow and treats it as
one checklist step; it does not absorb or redesign it.

---

## TL;DR — what we found and what we're proposing

The overhaul is not just a cosmetic rewrite. While mapping the current surfaces
we found `/onboarding` is **throwing a hard error for 81% of the members who
have ever used it** (verified, see "The live bug" below). So the plan is:

1. **Fix the break first** (small bot patch, ships independently of everything else).
2. **v1** — slim the Discord welcome card down to a hook + link + role buttons;
   add a `/start` web walkthrough that **auto-checks off the steps it can already
   prove** from existing tables; leave screenshot slots empty until assets land.
3. **v2** — per-persona deep paths + a guided Discord thread/DM sequence.

---

## Verified current-state map

Every claim below was read in the code at the cited line on `origin/main`
@ `247eb5d` (bot 3.0.233 · web 1.0.280 · agent 3.4.36 · Mimic 2.1.2).

### Discord — the welcome card

| Piece | Where | What it actually does |
|---|---|---|
| Welcome embed | `utils/onboarding.js:565` `buildWelcomeEmbed()` | Four fields: ⚔️ Accountability / ⏱️ Timing / 📣 Coordination / 🔒 Your data, your call. The privacy field links `wolfpack.quest/privacy` + `wolfpack.quest/me` (`:596-601`). |
| Buttons | `utils/onboarding.js:760` `buildWelcomeComponents()` | Row 1: `onb_pvp` "Count me in for PVP" · `onb_organizer` "I want to help organize" · `onb_deeps` "Set up the parser" · `onb_attend` "Just here to attend". Row 2: `onb_ignore:<version>` "Don't show me this again". |
| Dispatch | `index.js:959-965` | Five `customId` branches → the handlers below. |

**What each button actually changes — this surprised us:**

| Button | Handler | Effect |
|---|---|---|
| `onb_pvp` | `index.js:521` `handleOnbPvp` | **The only one that mutates anything.** Toggles the Discord role named `process.env.PVP_ROLE` (default `PVP`, `commands/pvprole.js:10`) on/off. |
| `onb_organizer` | `index.js:2255` | Replies with `buildOrganizerEmbed()` (`utils/onboarding.js:606`). No role, no row, no DM. |
| `onb_deeps` | `index.js:2260` | Replies with `buildParseOverviewEmbed()` (`utils/onboarding.js:653`). No role, no row, no DM. |
| `onb_attend` | `index.js:2265` | Replies with `buildAttendeeEmbed()` (`utils/onboarding.js:632`). No role, no row, no DM. |
| `onb_ignore` | `index.js:2270` | `setOptedOut(userId, version)` → `member_onboarding_state.opted_out = true` and overwrites `last_seen_version` with whatever token is in the customId. |

**So three of the four "persona" buttons are pure text.** Nothing anywhere
records which persona a member picked — there is no column for it, and no
downstream consumer. Any per-persona path we build needs a new place to store
the answer (see "Per-role paths" below).

### Discord — how the card gets shown

Three entry points, all reading the same `member_onboarding_state` row:

1. **`/onboarding`** (`commands/onboarding.js`) — first-ever view → full welcome
   (`:31-38`); already at current version → "✅ You're up to date"
   (`:41-47`); otherwise → diff-only `buildChangesEmbed` (`:49-56`).
2. **Passive first-command trigger** — `maybeShowWelcome()` (`index.js:1641`)
   runs as a `followUp` after **any** successful slash command
   (`index.js:996`). Gated on `isOptedOut()` **and** a volatile
   `state.json` `seenWelcome` list; the double gate was added after the
   2026-06-21 report that the dismiss button "doesn't work" (comment at
   `index.js:1645-1654`).
3. **`GuildMemberAdd`** (`index.js:2312`) — new/returning member joins → DM
   (full welcome for first-timers, diff for returners), falling back to
   `ONBOARDING_THREAD_ID` with a mention if DMs are closed (`:2341-2351`).

There is a **fourth, dead** path: `handleWelcomePvp` / `handleWelcomeOrganizer` /
`handleWelcomeAttendee` (`index.js:1669`, `:1690`, `:1704`) are fully written but
**referenced by nothing** — grep across the repo returns only their own
definitions. They're an older duplicate of the `onb_*` handlers. Delete or adopt,
but don't leave two copies of the persona copy that can drift.

### Discord — the CHANGELOGS "what's new" system

- `CHANGELOGS` (`utils/onboarding.js:31-313`) — **103 version entries**, oldest
  `1.0.0`, newest `3.0.233`. Hand-written raider-facing prose. Bumping this is a
  documented release step (`CLAUDE.md` routing table).
- `changesSince(v)` (`:432`) — semver-aware; returns every bullet strictly above
  `v`, joined by `buildChangesEmbed` (`:681`) into the embed **description**.
- `member_onboarding_state` is the store. Verified live shape (read-only query):

```
guild_id text NOT NULL, discord_id text NOT NULL          -- PK (guild_id, discord_id)
last_seen_version text NULL
last_seen_agent_version text NULL
opted_out boolean NOT NULL DEFAULT false
updated_at timestamptz NOT NULL DEFAULT now()
```

- **Reach, measured 2026-07-31:** 387 `wolfpack_members` with `is_member`;
  **36** have an onboarding row at all; **355 members have never touched it**;
  5 are opted out; 16 have a `last_seen_agent_version` (so the agent-release DM
  fanout at `index.js:541` can reach at most ~31 people).

> **The current onboarding reaches ~9% of the guild.** That is the number the
> overhaul has to move, and it argues for a surface people already visit
> (the website, a pinned channel post) over one they have to know to invoke.

### ⚠ The live bug — `/onboarding` is broken for 81% of its users

`buildChangesEmbed` (`utils/onboarding.js:681`) passes the joined bullet list
straight to `.setDescription()` with **no truncation and no paging**. Discord's
embed description cap is 4096 characters, and discord.js v14's builder validates
at build time. Measured against the real `CHANGELOGS`:

```
lastSeen 3.0.224 →  5 bullets,  2,506 chars   ok
lastSeen 3.0.121 → 34 bullets, 22,548 chars   ❌ over
lastSeen 3.0.91  → 41 bullets, 25,873 chars   ❌ over
lastSeen 2.2.28  → 96 bullets, 43,626 chars   ❌ over
(no lastSeen)    → 103 bullets, 44,214 chars  ❌ over  [not reachable: falsy lastSeen takes the full-welcome branch]
```

Cross-referenced against the live `last_seen_version` distribution:
**29 of the 36 rows (81%) throw.** What the member sees:

- **`/onboarding`** → the throw propagates out of `cmd.execute`, is caught at
  `index.js:997`, and the member gets **"❌ An error occurred."** Every time.
  They can never reach their diff, and never reach `[Show full welcome]`
  (that button lives on the embed that failed to build).
- **`GuildMemberAdd` rejoin** → `buildChangesEmbed` is called at
  `index.js:2332`, **outside** the `try` at `:2338`. The listener rejects, so
  there is **no DM and no thread fallback**, and `setLastSeenVersion` at `:2336`
  never runs — meaning it fails identically on every future rejoin.

This alone probably explains most of "our /onboarding really needs an
overhaul." The agent-release DM path is **not** affected — `data/agent_release_notes.json`
has 11 versions and the widest slice renders at 2,385 chars.

**Fix (Phase 0, ~20 lines, ships alone):** cap `changesSince` output — take the
newest N entries (N≈6) that fit under ~3,800 chars, then append
`_…and NN older updates — full history at wolfpack.quest/roadmap_`. Move the
`buildChangesEmbed` call in `GuildMemberAdd` inside the `try`. Then decide
whether `CHANGELOGS` should be pruned at all (see Open questions).

### Discord — the parser walkthrough already exists, and already has screenshot slots

`commands/parsehelp.js` is the best-built onboarding surface we have and the
model to copy:

- A simple top embed (`:22`) + buttons (`:44`) — 📖 Step-by-step guide, plus
  **live-resolved** direct installer links for stable and beta
  (`utils/mimicReleases.js` via `getMimicDownloadUrls()`).
- A 4-step ephemeral paged walkthrough (`STEPS`, `:60-107`) with ◀ Back / Next ▶
  (`:119-124`), driven by `parsehelp_guide` / `parsehelp_step:<i>`
  (`index.js:985-986`).
- **`const STEP_IMAGES = {}` (`:58`)** — *"filled in later"*, consumed at `:117`
  via `embed.setImage(STEP_IMAGES[i])`. **The screenshot plumbing is already
  built and empty.** Dropping four URLs into that object lights up per-step
  screenshots with zero new code.
- `/postparsehelp` (`commands/postparsehelp.js`) posts the identical embed
  publicly and reuses the same builders, so the two can't drift. Officer-gated.

### Discord — the named thread

`ONBOARDING_THREAD_ID` (`.env.example:147`, live id `1498883334065885296`).
Two consumers: `postOrUpdateInstructions()` (`utils/onboarding.js:542`) edits a
single pinned "📖 Wolf Pack Raid Tracker — Quick Start" embed in place
(located on boot by title at `:479`), and the `GuildMemberAdd` DM fallback
(`index.js:2342`).

That Quick Start embed (`buildInstructionsEmbed`, `:496`) is **officer-command
reference**, not new-member content: `/kill`, `/unkill`, `/updatetimer`,
`/board`, `/cleanup`, `/restore`, `/addboss`. A brand-new attendee can run
approximately none of it. It also predates Mimic entirely — no mention of the
parser, the website, or the raid schedule.

⚠ `.env.example` documents this thread twice (`:143-147` and `:160-165`) and
both blurbs still describe the **retired** design ("the registry message stores
salted SHA-256 hashes only"). State moved to Supabase on 2026-05-30
(`utils/onboarding.js:6-12`). Stale but harmless; worth a one-line fix while
we're in here.

### Web — what a new member touches in their first hour

| Surface | File | State |
|---|---|---|
| Landing `/` | `web/app/page.tsx` | Already carries **"🗺 New here? See the whole platform on one page →"** (`:57`) — the exact phrase Hitya used. It points at `/platform`. |
| `/platform` | `web/app/platform/page.tsx` | A **showcase**, not a walkthrough: hero, stat strip, architecture mindmap, drill-down branch cards, evolution timeline, privacy section (`:100-110`). Public, no auth. Answers *"what is all of this?"* — never *"what do I do first?"*. |
| Nav | `web/components/Nav.tsx:7-22` | 15 links + Me/Admin. **No Start / Getting-started entry.** |
| Header | `web/app/layout.tsx:62-98` | Three download CTAs (Mimic stable / Beta / Linux) sit under the wordmark on every page — good; a first-timer can't miss the installer. |
| Footer | `web/app/layout.tsx:148-163` | Privacy + Roadmap + *"Your logs stay on your device. Toggle exclusions any time on /me."* |
| `/mimic` | `web/app/mimic/route.ts` | **Not a page** — a 302 to the newest non-prerelease GitHub release (`?direct=1` → straight to the `.exe`). Siblings `/mimic/beta`, `/mimic/linux`. So "the /mimic download page" is a redirect; there is no place to *explain* the download. |
| `/privacy` | `web/app/privacy/page.tsx` | Strong, plain-language, mirrors `docs/PRIVACY.md`. Leads with **"Is it a keylogger? Is it a virus?"** (`:39`) — exactly the objection a new raider has. Buried in the footer today. |
| `/me` | `web/app/me/page.tsx` | The real first-run surface (see below). |

**`/me` already computes almost the whole checklist.** It builds a top-of-page
sync banner (`:620-646`) from live signals:

- `allChars.length === 0` → *"No characters linked yet."* (`:626-628`), and the
  body renders an explicit CTA: *"No characters linked to your Discord account…
  An officer needs to link your characters via the admin tool, or you can ask in
  `#feedback`."* (`:961-968`).
- `liveCount` / `recentCount` / `everSynced` from `loadSyncHeartbeats()`
  (`:473-485`, reading `agent_upload_stats.last_uploaded_at` + `agent_version`),
  thresholded at ≤10 min = **live**, ≤6h = **recent** (`:588-601`).
- Per-character privacy toggles via `ExclusionToggles` (`web/app/me/ExclusionToggles.tsx`)
  → `exclude_from_stats`, `exclude_inventory`, `tell_relay`, `tell_dm`,
  `show_inventory_publicly`.

⚠ Two content-drift bits a first-timer will hit: the `/me` banner still says
*"Re-launch Parser.bat"* (`:638`, `:642`) — Parser.bat is the legacy CLI, not
Mimic — and the port story disagrees across surfaces (landing page + footer say
`localhost:7779`, which is Mimic's bundled agent per `components/LocalDashboardLink.tsx`;
`CLAUDE.md` and the agent-release DM footer at `utils/onboarding.js:734` say
`7777`, the standalone default at `packages/wolfpack-logsync/index.js:81`).
Both ports are real; the copy just never says which is which.

### Mimic first-run (cross-reference only — task #53)

`apps/mimic/loading.html` is a 3-step gate: **1 · Sign in with Discord**
(`:126`), **2 · Your EverQuest folder** (`:172`), **3 · Your characters**
(`:197`, per-character transmit opt-out). `cfg.onboarded` (`:452`) sends
returning users straight to the dashboard. The separate **"Set up for me"**
one-click EQ configurator is `_applyEqSetup()` in the agent, exposed at
`POST /api/eq-setup`, surfaced on the agent dashboard and Mimic Settings
(`docs/HOW-ITS-BUILT.md:294-306`). The walkthrough should **link into** this,
not restate it — and the wiring TODO stays with #53
(`docs/STATUS.md:1344`, `docs/DESIGN-platform-queue.md:138`).

### Related items already on the books

- `docs/STATUS.md:1353` — *"guided walkthrough tours (overlaps board #86-88)"*,
  carried over from `CONTINUATION_QUEUE.md`. **This design is that item**, made
  concrete; it should stop being a one-liner.
- `docs/DESIGN-platform-queue.md:170` — *"Drill [#75] before first-raid mode [#86] —
  the drill *is* the tutorial."* Same instinct as auto-checkoff: prove readiness
  from signals, don't ask.

---

## The design

### Principle: one content source, two renderers

The failure mode to design against is the one this repo has already hit twice
(`/parsehelp` vs the dead `handleWelcome*` handlers; `docs/PRIVACY.md` vs
`web/app/privacy/page.tsx`): the same words maintained in two places, drifting.

So: **one TypeScript module in `web/lib/` is the source of truth for the
walkthrough steps**, and both surfaces render from it.

```
web/lib/onboardingSteps.ts       ← the ONLY place step copy lives
  export const STEPS: OnbStep[]
  export type OnbStep = {
    id:        'discord' | 'roles' | 'install' | 'logging' | 'link' | 'firstraid' | 'loot' | 'privacy'
    title:     string
    blurb:     string          // 1-2 plain sentences, /onboarding CHANGELOGS tone
    detail?:   string[]        // bullets, shown expanded on web
    shot?:     string          // '/onboarding/03-mimic-dashboard.png' | undefined
    personas:  Persona[]       // which of the four paths show this step
    check?:    CheckId         // which auto-signal marks it done (see below)
    cta?:      { label: string; href: string }
  }
```

- **Web** renders it directly at `/start` (Next.js page, `web/app/start/page.tsx`).
- **Discord** does *not* re-import it (the bot is a separate deploy with no
  build step against `web/`). Instead the bot fetches a tiny public JSON
  projection — `GET https://wolfpack.quest/api/onboarding-steps` (a Next route
  handler that serializes the same module, `revalidate: 3600`) — and falls back
  to a small hard-coded stub if the fetch fails. One source, no bundler
  coupling, and the bot degrades to "here's the link" rather than breaking.
  *(Alternative if we'd rather not add a cross-service dependency: keep the
  Discord copy deliberately tiny — hook + link + buttons only, as v1 proposes —
  so there is almost nothing to drift. Hitya's call; the v1 slim card makes the
  fetch optional.)*

### Surface 1 — Discord: the card slims down

The welcome card stops being a brochure and becomes a **doorway**. Target: fits
on one phone screen without scrolling.

```
🐺 Welcome to the Wolf Pack

We track raid timers, merge everyone's parse of every fight, and keep
loot + DKP honest. Two minutes to get set up.

▶ Start here: wolfpack.quest/start        ← the walkthrough, checks itself off
🔒 Your logs stay on your machine — wolfpack.quest/privacy

[ ⚔ I'll be raiding ]  [ 🗡 PvP me in ]  [ 🛠 I help organize ]  [ 👀 Just watching ]
[ 🔕 Don't show me this again ]
```

- Keeps the four persona buttons (same `customId`s, so no dispatch churn) but
  **each now records the persona** and deep-links to `/start?path=<persona>`.
- Keeps the privacy line **in the card body, above the fold** — it is not moved
  into a sub-embed. (See "What stays" below.)
- Drops the Accountability / Timing / Coordination pillars and the officer
  command list; those move into `/start` and the persona pages, where a member
  reads them when they're relevant instead of at minute zero.
- The **`/onboarding` diff** ("what's new") stays exactly as a concept — it's
  genuinely liked — but gets the Phase-0 truncation fix and a
  *"full history → wolfpack.quest/roadmap"* footer link.

`buildInstructionsEmbed()` (the pinned Quick Start in `ONBOARDING_THREAD_ID`)
gets rewritten from officer-command reference to the same doorway content, so
the pinned post and the card agree.

### Surface 2 — Web: `/start`

A single public-until-step-3 page. Public prefix matters: a member who hasn't
signed in yet must be able to read steps 1-3 (that's the point).

```
🐺 New here? Here's the whole thing in 6 steps.
[ ▸ I'm raiding ] [ ▸ PvP ] [ ▸ Organizing ] [ ▸ Just attending ]     ← persona filter

✅ 1. You're in the Discord                      (auto — you're signed in)
✅ 2. Grab your roles                            (auto — @Pack Member, @PVP)
◻ 3. Install Mimic            [ Download ↓ ]     (auto — Mimic sign-in seen?)
◻ 4. Turn logging on           /log on           (auto — first upload seen?)
◻ 5. Link your characters                        (auto — characters.discord_id)
◻ 6. Your first raid night     Sun/Wed/Thu 8pm ET
   └ where loot + DKP rules live · what to expect · who to ask
🔒 Your data, your call — read this, then set your toggles on /me
```

- Each step is a card: title, one-sentence blurb, an expandable detail list, a
  screenshot slot, and a CTA button.
- **Signed-out** visitors see the same steps with every checkbox hollow and a
  "sign in to track your progress" nudge — the page is still useful as a
  static guide (and is what the Discord card links to before anyone has an
  account).
- Nav gets a `🐺 Start` entry (`web/components/Nav.tsx:7`), and the landing
  page's existing "New here?" link (`web/app/page.tsx:57`) is **re-pointed from
  `/platform` to `/start`**, with `/platform` demoted to a secondary
  "…or see the whole platform →". `/platform` keeps its job (what *is* this);
  `/start` gets the new job (what do I *do*).

### The differentiator: auto-checkoff from signals we already have

This is the part that makes it not-a-static-page. Every check below maps to a
column that exists **today** — no new ingest, no agent change, no migration
except the one persona column.

| # | Step | Check | Signal (verified) | Confidence |
|---|---|---|---|---|
| 1 | In the Discord | `in_guild` | `wolfpack_members.is_member` for the signed-in `discord_id` (387 rows today) | **certain** |
| 2 | Roles | `has_roles` | `wolfpack_members.role_names[]` contains `Pack Member` (or the `ALLOWED_ROLE_NAMES` set, `utils/roles.js:9`); `PVP` for the PvP persona | **certain** |
| 3 | Mimic installed + signed in | `mimic_linked` | `mimic_sessions` row with this `discord_id` and `revoked_at IS NULL`; `agent_version` gives the version, `machine_label` the box. **32 distinct discord_ids today.** | **certain for Mimic sign-in**, ⚠ *proves the sign-in, not the install* — a local-only Mimic user never appears. Copy must say "Mimic linked to your account", not "Mimic installed". |
| 4 | Logging on / first upload | `first_upload` | `agent_upload_stats` — `first_uploaded_at` / `last_uploaded_at` / `agent_version` / `uploaded_by_discord_id`, keyed by `character`. 985 rows, 274 characters, **29 distinct uploaders**, earliest 2026-06-01. `/me` already reads this via `loadSyncHeartbeats` (`web/app/me/page.tsx:473`). | **certain** — reuse `/me`'s exact ≤10min / ≤6h thresholds so the two pages can never disagree |
| 5 | Characters linked | `chars_linked` | `characters.discord_id IS NOT NULL` for this member (166 distinct linked discord_ids today, vs 387 members). Pending state: `character_link_requests` where `status='pending'` (9 rows all-time) → render as ⏳ "requested, waiting on an officer" rather than ◻ | **certain**, and the ⏳ state is the nicer UX |
| 6 | First raid | `first_raid` | An `encounter_players` / `contributions` row for one of their characters inside a raid window, **or** an OpenDKP attendance tick (`opendkp_attendance_recent`). Cheapest v1: reuse the `/me` `encounterCount > 0` aggregate | **good** — v1 can be "we've seen you in a parse", refine later |
| — | Privacy reviewed | *(not auto)* | Deliberately **not** auto-checked — see below | n/a |

**Auto-checkoff rules that keep it honest:**

- **Never show a step as done that the member can't verify themselves.** Each
  ✅ carries its evidence inline: *"✅ Mimic linked — v3.4.36 on DESKTOP-7QK,
  last seen 4 minutes ago."* If we can't name the evidence, it stays hollow.
- **Hollow ≠ failed.** Unchecked renders neutral grey with a "how" link, never
  red. A member who deliberately runs local-only should not be nagged.
- **Never auto-check privacy.** Step 🔒 gets an explicit *"I've read this"*
  affordance or no checkbox at all. Auto-checking a consent step because
  someone loaded a page is exactly the pattern `docs/PRIVACY.md` exists to
  avoid.
- **One query, cached.** All six checks are one server component load against
  tables `/me` already hits. `export const dynamic = 'force-dynamic'` like `/me`.
- **`exclude_from_stats` members still get a real page.** Their step 4 reads
  *"You've opted this character out of stats — that's fine, nothing to do
  here"* rather than an eternal ◻.

**Storage for persona.** The only new column: `member_onboarding_state.persona
text NULL` (values `raider|pvp|organizer|attendee`), written by the four button
handlers and by the `/start` persona filter. Idempotent migration per
`CLAUDE.md`. Optional companion `walkthrough_dismissed_at timestamptz` if we
want the "don't show me the banner" affordance separate from `opted_out`
(today `opted_out` conflates "stop DMing me" with "I dismissed a card").

### Screenshots

**Host them in `web/public/onboarding/`.** Both surfaces then use the same
asset: web via `<Image src="/onboarding/…">`, Discord via
`embed.setImage('https://wolfpack.quest/onboarding/…')`.

This is a **proven pattern in this repo, not a proposal** — `index.js:9123`
already does `.setImage('https://wolfpack.quest/roadmap/mimic-20-harmonic-howl.png')`
against `web/public/roadmap/mimic-20-harmonic-howl.png`. And the Discord
consumer is already written: `STEP_IMAGES` in `commands/parsehelp.js:58`, read
at `:117`.

No route collision: there is no `web/app/onboarding/` route, and the walkthrough
page is `/start`, so `public/onboarding/*` is unambiguous.

Naming: `NN-slug.png`, zero-padded, so the file order matches step order.
Target ≤400KB each (the existing `mimic-20-harmonic-howl.png` and the four
`docs/screenshot-*.png` are all well under). Annotate on-image (arrow + short
caption baked in) — Discord embeds can't overlay anything, so any annotation
that only exists in web markup would silently vanish in Discord.

#### Shot list

**Needs Hitya or a local Windows session** (live EQ + Mimic + Discord required;
a cloud session cannot produce these):

| # | File | Shot | Annotate |
|---|---|---|---|
| 1 | `01-download-warning.png` | Edge/Chrome download warning + the ⋯ → Keep path | circle **Keep** / **Keep anyway** — this is the #1 drop-off, and `commands/parsehelp.js:66-70` already spends a paragraph on it |
| 2 | `02-mimic-firstrun.png` | Mimic `loading.html` gate, all three steps visible | number the steps 1·2·3 |
| 3 | `03-mimic-dashboard.png` | Mimic dashboard, healthy — green sync state | arrow at "uploading ✅" |
| 4 | `04-overlays-ingame.png` | **The money shot.** EQ running with DPS HUD + trigger alert + buff queue up | label each overlay |
| 5 | `05-eq-log-on.png` | `/log on` typed in the EQ chat window | circle the confirmation line |
| 6 | `06-discord-board.png` | `#raid-mobs` `/board` — cooldown card + Spawning in 24h | arrow at a kill button |
| 7 | `07-discord-parsecard.png` | An auto-parse card in the Parses Log thread | arrow at the 🔗 wolfpack.quest link |

⚠ Shots 4 and 7 contain **real character names**. Decide with Hitya whether to
use the existing obfuscation helper (`web/lib/obfuscate.ts`) or to ship them as-is
with named raiders' okay — `docs/PRIVACY.md` is the standard we hold others to.

**Capturable without Hitya** — these are public, unauthenticated wolfpack.quest
pages, so a cloud session with the Playwright MCP can screenshot them headlessly:

| # | File | Shot |
|---|---|---|
| 8 | `08-web-platform.png` | `/platform` mindmap |
| 9 | `09-web-privacy.png` | `/privacy`, framed on the "Is it a keylogger?" section |

**Needs a signed-in session** (Discord OAuth gate — Hitya, or any member with a
browser; not a cloud session):

| # | File | Shot | Annotate |
|---|---|---|---|
| 10 | `10-web-me.png` | `/me` with the green sync banner + a character card | arrow at the banner and at the exclusion toggles |
| 11 | `11-web-parses.png` | `/parses` night view | — |

**v1 ships with every slot empty.** The step cards render fine without a
`shot`, and `STEP_IMAGES` already no-ops on a missing key
(`commands/parsehelp.js:117`). Assets land incrementally; nothing blocks on
them. Shots 1-5 are the highest value (they cover the install cliff); 8-9 are
free; 6-7 and 10-11 are nice-to-have.

While we're here: `README.md:67` and `:79` still embed
`docs/screenshot-logsync-setup.png` / `-run.png` — **Parser.bat CLI screenshots**
that no longer describe how anyone installs this. Refresh or retire them in the
same pass.

### Per-role paths

The four buttons already name four personas. What each path emphasizes — same
six steps, reordered and re-weighted, plus one path-specific step:

| Persona | Button | Emphasis | Path-specific step |
|---|---|---|---|
| **Raider** (`onb_deeps` → relabel "I'll be raiding") | Success/green | Steps 3-4 front and centre: install Mimic, `/log on`, see your first parse. This is the path that produces guild data, so it gets the screenshots. | *"Read your first parse card"* — link a real `/parses/<id>` |
| **PvP** (`onb_pvp`) | Danger/red | The one button that already works. After the role toggle: quiet-hours (`PVP_QUIET_START`/`_END`, 1am-8am ET), `/pvpnightpings` opt-in board, the `/pvp` page. Mimic optional but strongly suggested — the PvP ledger is agent-fed. | *"Set your overnight ping preference"* |
| **Organizer** (`onb_organizer`) | Primary/blue | The *only* path that surfaces commands, because it's the only one where they're relevant: `/announce`, `/addtarget`, `/adjusttime`, board buttons, `/raidbosshelp`. Note the role gate up front (`getAllowedRoles()`, `utils/onboarding.js:607`) so nobody bounces off a permission error. | *"Post your first `/announce`"*, plus a pointer to the officer `/admin/*` pages if they hold an officer role |
| **Attendee** (`onb_attend`) | Secondary/grey | Shortest path, and it must not read as a consolation prize. Raid schedule, Discord events, where loot is announced, `/me`. **Explicitly:** "you can install Mimic later, and there's no obligation." | *"Turn on raid event notifications"* |

Everyone, regardless of path, gets steps 1, 2, and the privacy step. A member
can switch paths at any time — the filter is a URL param, not a commitment.

### What stays — privacy is load-bearing

`docs/PRIVACY.md` and the toggles it promises are non-negotiable and must stay
**prominent, not buried**:

1. The privacy line stays **in the Discord card body**, above the fold, with
   both links — `wolfpack.quest/privacy` and `wolfpack.quest/me` — exactly as
   `utils/onboarding.js:596-601` has it today.
2. `/start` ends with a **full-width privacy card**, not a footnote, linking
   `/privacy` and deep-linking the per-character toggles on `/me`.
3. The **"Is it a keylogger? Is it a virus?"** section
   (`web/app/privacy/page.tsx:40`) gets quoted (2-3 lines) inline on the
   *install* step, where the objection actually occurs. Answering it after
   someone has already installed is answering it too late.
4. Mimic's step-3 per-character transmit opt-out (`apps/mimic/loading.html:197`)
   is called out in the walkthrough copy — most members don't know it exists.
5. The privacy step is **never auto-checked** (above).
6. `web/app/privacy/page.tsx:1-5` carries a stale comment — *"(when the
   onboarding wiring lands) from the welcome DM"* — the welcome DM has linked
   `/privacy` for a while. One-line fix.

### Phasing

**Phase 0 — unbreak it (ships alone, any time, bot-only, no design dependency)**
- Truncate `changesSince`/`buildChangesEmbed` output under the 4096 cap +
  "…and NN older updates → /roadmap" tail.
- Move the `buildChangesEmbed` call inside `GuildMemberAdd`'s `try`
  (`index.js:2332` → after `:2338`).
- Delete the three dead `handleWelcome*` functions (`index.js:1669-1710`).
- Routes to `main`, root `package.json` patch bump + a `CHANGELOGS` entry.
  **Respect the raid freeze** (Sun/Wed/Thu 19:30-00:30 ET).

**Phase 1 — v1 (the ask)**
- `web/lib/onboardingSteps.ts` + `web/app/start/page.tsx` with all six steps,
  auto-checkoff for the five signals that exist today, empty screenshot slots.
- Nav entry; landing "New here?" re-pointed to `/start`.
- Discord card slimmed to hook + `/start` link + the four persona buttons;
  persona persisted (`member_onboarding_state.persona`, idempotent migration).
- `buildInstructionsEmbed()` (the pinned thread post) rewritten to match.
- Fill `STEP_IMAGES` in `commands/parsehelp.js` as shots 1-5 land.
- Routing: web → `main` (`web/package.json` bump + a `roadmapData.ts` entry per
  the release rule); bot → `main` (root bump + `CHANGELOGS`); migration → `main`
  + apply.

**Phase 2 — v2**
- Per-persona deep pages (`/start/raider`, `/start/pvp`, …) with the
  path-specific steps and the persona-targeted screenshots.
- **Guided Discord sequence**: on persona pick, the bot opens a private thread
  (or DM chain) that walks the steps one message at a time and **advances when
  the signal flips** — "✅ Saw your first upload from Hitya. Next: …", driven by
  the same check functions. This is the piece that makes Discord feel guided
  rather than linked-away-from, and it's only worth building once the signals
  are proven correct on the web page.
- Re-invite the dismissed cohort (see Open questions).
- Officer view: `/admin/onboarding` — who's stuck on which step. The data is
  already there (355 members with no row; 166 of 387 with a linked character);
  this just renders it, and turns onboarding from a broadcast into a follow-up
  list.

### Risks / what could go wrong

- **Auto-checkoff that lies is worse than no checkoff.** `mimic_linked` proving
  sign-in rather than install is the sharpest edge; the copy fix above is
  mandatory, not cosmetic.
- **Cross-service fetch for the shared step JSON** adds a bot→web dependency.
  Mitigated by the hard-coded fallback, and made almost moot by the v1 slim card.
- **`/start` becomes another stale page.** Tie it to the release rule: any
  release that changes the install flow updates `onboardingSteps.ts`, same as it
  updates `roadmapData.ts`.
- **Screenshots go stale faster than prose** — Mimic's UI moves weekly. Prefer
  shots of things that change slowly (the download warning, `/log on`, the EQ
  overlay composite) over shots of a specific dashboard layout.

---

## Open questions for Hitya

1. **Tone.** The current card is earnest-and-explanatory; `/platform` is
   confident marketing; `/privacy` is warm and disarming (*"a rough night is
   just a rough night"*). Which voice should `/start` speak in? Our instinct is
   `/privacy`'s.
2. **Which screenshots first?** We think 1-5 (the install cliff) and that shot 4
   (overlays over live EQ) is the one that actually recruits. Agree?
3. **Real names in screenshots** — obfuscate (`web/lib/obfuscate.ts`) or ship
   as-is with the named raiders' okay?
4. **The dismissed cohort — 5 members.** They clicked "Don't show me this
   again," but the thing they dismissed was broken. Re-invite them **once** with
   a "we rebuilt this" DM and honor the flag thereafter? Or leave dismissed
   meaning dismissed, permanently?
5. **The 355 with no row at all** (92% of the guild) never saw any of this.
   A one-time announcement post in a raid channel pointing at `/start` seems
   right — but that's a release-adjacent announcement, and naming/announcing is
   your call per `CLAUDE.md`. Do you want one, and where?
6. **Loot / DKP rules.** Step 6 wants to link them, and we could not find a
   canonical page — the search turned up nothing in `web/`, `docs/`, or the bot.
   Do they live in a Discord pinned post, on OpenDKP, or only in your head?
   (If the last one: this is a good excuse to write them down once.)
7. **Prune `CHANGELOGS`?** 103 entries back to `1.0.0`. Phase 0's truncation
   makes the size harmless, but should old entries be archived to `/roadmap`
   and dropped from the bot, or kept forever as the record?
8. **Rename the buttons?** "Set up the parser" → "I'll be raiding" reframes the
   default path around what a person *is* rather than what they *install*. Same
   `customId`s, so it's a label change only. Worth it, or is the current wording
   what people expect?
9. **`/start` vs `/new-here`** as the URL. `/start` is shorter to say out loud
   in raid chat; `/new-here` matches the phrase already on the landing page.

---

## References

- Bot: `utils/onboarding.js`, `commands/onboarding.js`, `commands/parsehelp.js`,
  `commands/postparsehelp.js`, `index.js:521-600` (handlers),
  `index.js:1641-1710` (welcome + dead handlers), `index.js:2312-2360`
  (GuildMemberAdd), `index.js:9111-9130` (embed-image precedent).
- Web: `web/app/page.tsx`, `web/app/platform/page.tsx`, `web/app/me/page.tsx`,
  `web/app/privacy/page.tsx`, `web/app/layout.tsx`, `web/components/Nav.tsx`,
  `web/app/mimic/route.ts`, `web/app/me/ExclusionToggles.tsx`.
- Mimic: `apps/mimic/loading.html` (first-run gate — task #53).
- Docs: `docs/PRIVACY.md`, `docs/HOW-ITS-BUILT.md:294-306` (Setup & onboarding),
  `docs/STATUS.md:1344` (#53), `docs/STATUS.md:1353` (guided walkthrough tours),
  `docs/DESIGN-platform-queue.md:138,170` (#86 first-raid mode).
- Supabase (read-only, verified 2026-07-31): `member_onboarding_state`,
  `wolfpack_members`, `characters`, `character_link_requests`,
  `agent_upload_stats`, `mimic_sessions`, `opendkp_attendance_recent`.
