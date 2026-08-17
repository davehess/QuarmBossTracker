# The Architect's Rebuild — 2026-08-16

Premise, per Hitya: act as the platform's new architect. If this were rebuilt
from scratch knowing everything fourteen months of operation have taught, what
changes first, why didn't we do it the first time, and what is actually costing
us. **This is an assessment, not a migration plan** — CLAUDE.md remains the map
of what IS; nothing here licenses a rewrite (see "What I would not do").

Every number in this doc was measured today, on this checkout or the live
database, with the method stated. Where a claim is an estimate it says so.

---

## What the rebuild keeps

The change list below is only credible next to the list of things that were
right — some of them unfashionably so:

- **The monorepo and the four-component split.** One repo, four independently
  versioned components, each shipping from the branch its deploy target watches.
- **One managed Postgres (Supabase) as the guild-data store**, with the
  eqemu_* mirror tier and RLS scoping. Correct on day one, still correct.
- **The bot as a single deployable.** At guild scale, microservices would be
  self-harm. The problem below is not "monolith," it's monolith *gravity*.
- **Zero runtime dependencies for the agent.** Raiders run this on gaming PCs;
  no supply chain, no node_modules, one file to audit. Keep absolutely.
- **Beta-first Mimic cadence** and the pull-based updater channels.
- **The docs discipline.** DECISIONS-*.md, STATUS.md, HOW-ITS-BUILT.md and the
  session-digest hook are this project's actual moat — the reason a fresh
  session (or a fresh architect) can be productive in minutes. Most commercial
  teams do not have this.
- **Tests written from the real corpus** (golden logs, captured chat lines,
  live-measured fixtures) rather than imagined inputs.
- **Fun as a feature.** Hot Dice, the DDR grade, the Pottymouth award. A guild
  platform that isn't fun doesn't get run on 30 gaming PCs voluntarily.

---

## The rebuild, in six decisions

1. **Durable state gets exactly one home — Postgres. Every other surface is a
   projection.** Discord messages are *renders* of database state, idempotently
   upserted, their message ids stored in the DB, recreatable from it at any
   time. ← the first change; argued in full below.
2. **All database access goes through one owned layer, and identity lives in
   the schema.** One paged reader (not three), timeouts and breakers in one
   place, and unique indexes wherever the domain has a natural key. The
   PostgREST 1,000-row cap gets solved once, structurally, instead of
   per-incident.
3. **The agent keeps zero *runtime* deps but gains a build step.** Dashboard
   HTML/JS live as real files, esbuild folds them into the single artifact.
   The double-escape hazard class (`WEB_HTML` — shipped twice), the
   `check:dashboard` gate, and `sync-command-embed.js` all exist because
   source format and artifact format are the same file today.
4. **Release channels are tags, not long-lived branches.** `main` is the only
   branch; beta = prerelease tags; in-flight Mimic work rides feature flags.
   The park, the graduation file-lists, `sync-beta.yml`, and the re-park ritual
   are machinery for keeping two branches from diverging — which tags cannot do.
   (The 79,199-line drift, the 35-vs-90 test files, the agent 3.5.5–3.5.14
   boot-crash P0: all branch-model costs, already paid.)
5. **Client time is corrected at ingest from the first multi-uploader merge.**
   Every consumer that merged two machines' timestamps eventually needed the
   offset (dedup windows, death confirmation, relay correction, the doubled
   damage that killed live combined-DPS). It was retrofitted four times.
6. **"Did the deploy work" is part of shipping, not a separate virtue.** A
   feature that moves rows is verified by counting rows in the destination on
   ship day. Green CI is necessary, never sufficient — the loot fold's 18 green
   tests and the 24-vs-0 golden-log runs on beta are the same lesson twice.

---

## Decision #1 in full: one home for durable state

### What was built instead

State was placed wherever the writing code already stood. Today durable state
lives in **five homes**: Discord messages (roster as chunked JSON in threads —
`utils/roster.js`, 480 lines; hate state as hidden JSON embeds; the parses log
thread as the *source of truth*, reloaded on boot), `data/state.json` (10 live
reference sites — and **it does not persist on Railway**), ~114 env vars in
`.env.example` (mostly anchor ids, the fallback lattice for when Discord state
is lost), `bot_kv` (46 references — the correct home, arrived late), and
Supabase. Plus the compensating machinery: `/restore`, `/recoverkills`,
anchor-priority chains, atomic mirror writes.

The recurring bill: the 2026-08-04 discovery that every deploy boots stateless;
**bot 3.1.8 posting the same raid review eleven times in one night** (eleven
redeploys, one per-night message id in state.json); every "anchors survive
volume loss" workaround; every recovery command.

### Why we didn't, the first time — separated honestly

**Couldn't have known.** `utils/roster.js` was born **2026-05-01**. The first
Supabase migration is **2026-05-25**. For the project's first stretch there was
*no database in the stack at all* — the bot was a raid timer, Discord messages
were simultaneously the UI and the only free persistence that survived a
redeploy. Standing up Postgres for a 200-line timer bot would have failed the
over-engineering test this very document applies below. The first placements
were correct *at the time they were made*. Likewise nobody could have known a
timer bot would become a four-component platform with a website, a desktop app
and a 35k-line log agent; designing for that in May would have been speculative
generality.

**Didn't want to know.** The hinge has a date: 2026-05-25, after which the
stack had a real database — and state kept landing in Discord and state.json
for months anyway. Three reasons, none of them technical:

1. **Migration ships no feature.** There is no demo, no announcement, no
   roadmap bullet for "the roster moved to Postgres." Every week it lost the
   priority fight to something visible, and each individual placement was a
   sane 5-minute patch. Rational debt — but with **no ledger**: nothing summed
   the placements. The sum was measurable the whole time — the env-var count
   (114 today) *was* the debt meter — and we documented it as a virtue
   ("`.env.example` documents every variable") instead of reading it as a
   symptom count.
2. **Monolith gravity.** In a 17,706-line `index.js`, the nearest existing
   pattern wins. Every new feature copied the persistence idiom of the code
   beside it, so the old pattern compounded even after `bot_kv` existed. (Note:
   CLAUDE.md still says the bot is "~8k lines" and the agent "~16k" — both are
   2.2× stale, measured today at 17,706 and 35,234. The map lagging the
   territory by 2× is itself a small instance of not wanting to know; corrected
   in this commit.)
3. **The purest form of not-wanting-to-know is a comfortable written-down
   assumption.** `.dockerignore` said state.json "must come from the mounted
   volume." *The volume was never mounted.* The check was two minutes in the
   Railway service config; the belief sat unverified for months because it
   FELT like knowledge — it was written down, after all. It was finally
   verified on 2026-08-04, after the eleven-review night, not before.

The migration path is already underway and is the right one: the CLAUDE.md rule
("anything keyed per-anything-dynamic goes in `bot_kv`") stops the bleeding for
new state; roster/hate/parses move opportunistically, one at a time, when their
code is next open. No big bang.

---

## Most over-engineered: the admission-control budget enforcement (#73)

Per-uploader × per-kind windowed ingest budgets, tunable overrides
(`budget_<kind>_per_min`), a global kill (`flag_disable_budgets`), and an
enforcement mode (`budget_enforce_<kind>`) that upgrades over-budget durable
kinds to real 429s with `Retry-After` — choreography the fleet had to be
version-gated for (agents ≥3.3.85 honor Retry-After). Forty-one control-plane
references in the bot plus a dedicated test file, tuning keys, and paragraphs
of CLAUDE.md — protecting one Node process from a fleet of roughly **thirty
agents** owned by people we know by name.

The fair half: it was incident-driven (2026-07-13, mid-raid queue backup), and
the **shed half earns its keep** — 200-ack-and-drop for ephemeral streams is
the correct mid-raid valve and has been used. The over-build is the
*enforcement* half: designed to ship dormant ("leave off until the fleet…"),
and as far as any decision doc records, **never armed since**. Insurance with
no claims, premium paid in cognitive surface — every ingest change threads
through budget checks that have never fired in anger.

Runner-up: `utils/bidCrypto.js` — 177 lines of AES-256-GCM sealing DKP bids
against a reader that RLS column grants already exclude, at the price of key
custody forever. Born 2026-05-25, the same day as the initial schema; crypto
was never this project's threat model.

**Named separately because it is NOT over-engineering: the Discord recovery
machinery** (`/restore`, `/recoverkills`, chunked roster, anchor lattice).
It looks over-built, but it is *compensating complexity* — scaffolding around
decision #1's absence, correctly built given the foundation it stood on. You
don't fix compensating complexity by simplifying it; you fix it by removing
what it compensates for, and it falls off on its own.

---

## Most under-engineered: the database read/write layer

The evidence is that **the same footgun was rediscovered independently three
times**, each discovery producing its own paginator:

| paginator | where | born of |
|---|---|---|
| `selectAllPaged` | `utils/openDkpSync.js` | the loot-fold truncation, 2026-08-14 |
| `selectAll` | `web/lib/selectAll.ts` | the quartermaster officer rollup |
| `fetchAllPages` | `web/lib/supabase-paged.ts` | `/rolls`, defensively |

PostgREST silently caps any response at 1,000 rows — documented for months in
`utils/supabase.js` on the *upsert* return path, and it bit reads anyway,
because a warning in a file is not a layer. What it cost, documented:

- **The loot fold shipped broken** (2026-08-14): both sides of its set-diff
  truncated, two passes re-inserted **116 duplicate rows** into member-facing
  loot history, walking the oldest raids instead of newest — while **18 tests
  stayed green**, because they tested logic given inputs, never whether inputs
  were complete.
- **The quartermaster officer rollup computed from ~5% of the data** (1,000 of
  18,320 inventory rows) until caught.
- **Identity is not in the schema**: nothing stops a re-run from double-
  inserting an award. Measured live this morning: **337 duplicate groups / 560
  excess rows** in `loot_observations`, inflating "N× won" pills members see
  today (task #39, awaiting Hitya's word on the destructive cleanup + unique
  index).

Exposure surface, measured today: **177** raw `supabase.select(` call sites in
the bot outside the paged helper; **518** `.from('` sites in the web tree, of
which **30** use `.range(` and **6** go through a paged helper. (Raw greps are
upper bounds — many sites are single-row or bounded — but the audited subset
that *can* exceed 1,000 rows has produced an incident roughly biweekly.)

Runner-up: trigger-pattern validation — 37 of 109 enabled triggers dead in the
table for months, invisible precisely because *enabled reads as coverage*.
Same genus: a correctness property nobody's layer owned.

---

## Which one is actually costing more

**The under-engineered thing, by roughly an order of magnitude — and its cost
compounds while the other's is sunk.**

Documented hours, the last fortnight alone (estimates marked):

| incident | cost |
|---|---|
| Loot fold truncation: diagnose, fix, dedupe 116 rows, document | ≈5h (est.), + wrong member-facing data live ~1 day |
| Quartermaster 5%-of-data rollup: catch + `selectAll` + rework | ≈1.5h (est.) |
| Third paginator written defensively for `/rolls` | ≈1h (est.) duplicated effort |
| Legacy 560 dupes: pending cleanup + index (#39) | ≈2–4h (est.) still owed, wrongness live since ≤June |

≈ **8–11 engineer-hours per fortnight of active surface**, plus the cost that
matters more than hours: members seeing wrong loot history, which is the trust
this platform trades on. Every new aggregate read (518 candidate sites in web
alone) is another draw from the same deck until a shared layer exists.

The budget-enforcement machinery, by contrast: build cost sunk (≈6–10h est. at
bot 3.0.208), ongoing cost minutes per month, incidents caused zero, incidents
prevented by the *enforce* half zero — because it has never been armed. In
dollars: hosting here is flat-rate and small; **the dollars are the hours**, so
the comparison stands as stated. The one real cost over-engineering shares with
the loot fold is subtler: machinery that *looks* like safety breeds false
confidence — 18 green tests guarding a broken fold is the same failure as an
elaborate control plane guarding streams nobody throttles.

### The numbers to track (prove it or drop it)

- **U2 — duplicate award groups** *(the headline number)*:
  `select count(*) from (select 1 from loot_observations group by source,
  raid_id, item_id, winner_character, dkp_amount having count(*) > 1) g;`
  **Baseline today: 337 groups / 560 excess rows. Target: 0, pinned by the
  #39 unique index so it can never regress.** Queryable in one statement,
  member-facing, and directly measures the wrongness members can see.
- **U1 — unpaged read call sites outside the shared reader.** Baselines today:
  bot 177, web 518/30/6 as above. Consolidate the three paginators into one
  import, then gate in CI exactly the way `check-agent-dashboard.js` gates the
  overlay rules — this repo already knows that enforced-not-advisory is the
  only kind of rule that holds.
- **O1 — budget-enforcement armed-days and 429s served.** Baseline: 0 and 0
  since ship. **Review 2026-12-01:** if both are still zero, delete the
  enforce half (keep shed + kill switch) or keep it as *consciously chosen*
  documented insurance — either is fine; unexamined is not.

Falsifiable, both directions: if U1 trends to zero and the silent-truncation
class stops for a quarter, the under-engineering thesis is proven by absence.
If O1 is still 0-for-0 in December, the enforcement half was premium without a
claim, and this doc's over-engineering pick is confirmed.

---

## What I would not do

- **No big-bang rewrite, of anything.** Knowing everything includes knowing
  that working systems die in rewrites. Every change above has an incremental
  path: `bot_kv` placement rule (already law), opportunistic state moves, one
  shared paginator adopted file-by-file, the unique index after #39's cleanup,
  channels-as-tags only if/when a natural Mimic line break makes it cheap.
- **No microservices, no queue infrastructure, no second database.** The scale
  ceiling of this platform is a 60-slot raid; the durable-queue-in-a-JSON-file
  on each agent is honestly sized.
- **No weakening of the agent's zero-runtime-dep stance** to get the build
  step — the build step is dev-side only; the shipped artifact stays one file.
- **No new rules without enforcement.** The pattern is proven here three times
  over (`check:dashboard`, `wpKeep` gate, golden logs): a rule that is not a
  failing check is a suggestion.

## Open questions for Hitya

1. Adopt **U1** as a CI gate (one shared paginator, grep-enforced)? ~2h to
   consolidate, then mechanical adoption.
2. **#39** — the 560-row cleanup + unique index is the other half of U2 and is
   already awaiting your word; this doc only raises its priority.
3. Set the **O1 review date** (proposed 2026-12-01) for the budget-enforce
   half: delete, or keep consciously.

---

# Part II — the rest of the platform (same day, after U1/U2 landed)

Hitya's follow-up, verbatim on the direction: *"discord was a source of
semi-truth. now it should just be a projection"* — decision #1 is ratified —
and *"let's start looking at the database read/write layers as that is
complexity I have not designed in."* Part I's six decisions covered bot state,
the data layer, the agent build, branches, time, and deploy verification. This
part reviews what they did NOT touch, with tonight's measurements, and outlines
the optimizations with lasting operational effect. Everything already DONE
tonight is marked; everything else is ordered by effect-per-hour.

## What landed tonight (U1, U2, and the advisor sweep)

- **U2 → 0 and pinned.** Migration `20260816041125_loot_award_unique`: all 560
  duplicate rows backed up (service-role-only table, droppable after
  2026-09-16), deleted keeping the earliest row per award (10,321 → 9,761),
  and `loot_observations_award_uniq` created — PARTIAL on `raid_id IS NOT
  NULL` (chat/loot-command DROP observations carry no raid and must not
  collide), `NULLS NOT DISTINCT` inside the raid-bound world. Verified
  refusing a re-inserted award with 23505. The fold and `/backfillopendkploot`
  now write `insertIgnoreDuplicates` — a re-run is a schema no-op.
- **U1 structural.** One paginator per runtime: `utils/supabase.js
  selectAllPaged` (bot) and `web/lib/selectAll.ts` (web);
  `supabase-paged.ts` retired, its four call sites migrated.
  `test/db-read-discipline.test.js` enforces single-paginator + the
  load-bearing properties + an **85-site ratchet** on `.limit(>1000)` — the
  count may only shrink.
- **Security (advisor-driven, applied):** `rollup_threat_ranks` — a
  SECURITY DEFINER function that WRITES — was executable by `anon`; revoked
  from public/anon/authenticated (the bot's service-role call is unaffected).
  `search_path` pinned on the four flagged functions. The 46 "RLS enabled, no
  policy" INFOs are the *intended* deny-all posture for bot-only tables — the
  linter reads our default as an omission; it is the design.
- **Performance (advisor-driven, applied):** four RLS policies re-evaluated
  `auth.uid()` PER ROW (`tells` — 9,025 rows, every /me/tells read — plus
  wolfpack_members, member_onboarding_state, page_views). Rewritten as
  InitPlan subqueries; identical semantics.

## The ratchet backlog, priority-ordered by measured table size

The 85 over-cap sites are not equal. Crossing them with tonight's
`pg_class.reltuples` names the ones lying TODAY (table ≥ rows the site asks
for the impossible over):

| site | table | est. rows | asked for |
|---|---|---|---|
| `web/lib/admin-queue.ts:477` | chat_messages | **341,750** | 20,000 |
| `web/app/pvp/*` (4 sites) | who_observations | **117,377** | 20,000 |
| `web/app/fun/page.tsx:109,130` | fun_events | 20,356 | 5–8,000 |
| `web/lib/admin-queue.ts:509` | character_inventory | 18,320 | 20,000 |
| `web/app/admin/signups/page.tsx:230` | rh_signups | 14,893 | 50,000 |
| `web/app/admin/analytics/page.tsx:38` | page_views | 8,710 | 50,000 |

Each conversion: check the ordering key (the 2026-08-05 lesson — unordered
walks drop the NEWEST rows), swap to `selectAll`, lower `OVER_CAP_BASELINE`.
An hour each, and the ratchet locks every one.

## Discord becomes a projection — the execution order (ratified tonight)

The rule for NEW state is already law (`bot_kv`). The existing five-home
estate migrates in blast-radius order, each step leaving Discord messages as
*renders* whose ids live in the database:

1. **`state.json`'s remaining dynamic keys** (~10 reference sites measured
   tonight: fanout marks, welcome/seen flags, agent test cards, session
   damage, announce ids). 2–3h. Kills the redeploy-races-a-raid-night class
   (the eleven-review night) permanently.
2. **Roster** — chunked-JSON threads → a table + one rendered embed.
   `utils/roster.js` (480 lines) shrinks; `/restore` loses its biggest
   customer.
3. **Hate state** — hidden JSON embeds → table + render.
4. **Parses thread** — last, deliberately: it is the largest and the recovery
   path (`loadParsesFromDiscord`) guards real history. After it moves, boot
   no longer depends on Discord read-back at all.

The projection direction also shrinks the ~114-env-var anchor lattice:
a projection can re-post a lost message and record the new id itself — the
anchor fallback becomes self-healing instead of hand-maintained.

## Component review — what Part I didn't touch

**Mimic (operations).** The 7-point overlay parity checklist in CLAUDE.md is
manual, and "overlay missing one checklist item" was a whole class of beta
bugs. The lasting fix is the repo's proven move — make the rule a failing
check: `test/overlay-parity.test.js` walking the 19 overlay .html files +
main.js for ✕-button/IPC branch, hover handshake, `WP_OVERLAY_ROWS`,
`_HIDEALL_FLAGS`, `_overlayEntries()`. ~3h. Metric: parity bugs per beta line
(historically ≥1; target 0). Crash-loop LKG rollback + prune-linux-releases
are already sound.

**Web (operations).** (a) **Env parity Production↔Preview** — the
`b.wolfpack.quest` sign-in outage class ("SUPABASE_SERVICE_ROLE_KEY not set")
recurs every time a var is added to one environment only. A ~1h script
diffing Vercel env keys across environments (runnable in CI on env-touching
PRs) retires the class. (b) 72 of the web's pages are `force-dynamic` — every
view is a live Supabase fan-out. Fine at guild scale; noted as the first
lever if hosting cost ever matters (self-host doc already owns that trade).

**Bot (operations).** Decision 6 operationalized: a post-deploy smoke —
after Railway restarts, hit `/health` and one canary read (e.g. bosses count)
from a workflow; alert on failure. ~2h. Today a bad deploy is discovered by a
raider mid-raid; the smoke moves discovery to deploy+2min. (The raid-freeze
tripwire already guards WHEN; this guards WHETHER it came up.)

**Supabase (remaining advisor items).** 13 unindexed FKs — the hot ones are
`combat_events`, `encounter_players`, `encounters`, `fun_events`; one ~30min
migration. 62 unused indexes flagged — weak evidence on a young database;
re-run the advisor at 90 days and drop what is STILL unused (each one taxes
every ingest write until then). Two tables carry duplicate permissive
policies (`characters`, `bosses_local`) — merge to one each. Auth server
capped at 10 connections — correct at guild scale, a self-host wizard note.

**External dependencies.** OpenDKP is the one SaaS whose loss is
unrecoverable-by-us — but the `opendkp_*` mirror tables ARE the archive, and
the fold now being idempotent means a full re-pull is safe to re-fold at any
time. Raid-Helper's board self-deletes on raid day; the mirror + staleness
alarm (#34) already treat it as the archive. GitHub releases: the 10-entry
atom-feed trap has its prune workflow. Discord: every projection step above
reduces its blast radius from "source of truth" to "display."

## The operating rule this all rolls up to

Every lasting fix above is the same move performed on a different surface:
**take a rule that lives in memory or prose, and make it a failing check or a
schema constraint.** The platform's four existing gates (dashboard escape,
wpKeep, golden logs, COMMAND_HTML sync) proved the pattern; tonight added
three more (award uniqueness, single-paginator, the over-cap ratchet). The
backlog above is six more instances of the identical move. That — not any
rewrite — is what "designed in" looks like from here.
