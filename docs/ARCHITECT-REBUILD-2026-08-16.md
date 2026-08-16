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
