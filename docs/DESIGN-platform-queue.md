# The Queue — framework, ordering, and the story (post-audit)

*Written 2026-07-17, the morning after the raid-night live-ops session. This is
the reviewable queue Hitya asked for: every open workstream (task board #71–#90
plus carried items), ordered into waves, grounded in a code-level audit of the
agent, bot, shell, and update machinery. Numbers below are receipt-backed by
that audit (4 investigator passes + adversarial verification) — corrected
figures are marked. Board task numbers in [#brackets].*

---

## The story (how to rally the troops)

Five movements. Each one earns the next; each has a visible payoff a raider can
feel. This is the narrative for Discord posts, not just engineering order:

1. **Trust the floor** — overlays that never blank, callouts that always fire.
2. **Survive success** — the 60-raider insurance, installed before it's needed.
3. **Fight smarter** — briefs before the pull, the parse in /rs, burn windows
   that count themselves.
4. **Grow the pack** — a new raider useful on night one; an officer fluent in
   one runbook, not 20 pages.
5. **Remember everything** — every raid compounds into the Wolf Pack Raid
   Guide; PoP becomes an advantage, not a scramble.

---

## What the audit found (the receipts that set this order)

### Verified load envelope
- Steady-state raid traffic to the single bot container: **~40–68 req/s at 15
  clients → ~190–240 req/s at 60** (verified order-of-magnitude; ~70% is GET
  polling for cross-client overlay state). Every stream is per-client; there is
  **no cross-machine election anywhere** — the uploader lock is per-machine
  (`os.tmpdir()` + pid liveness), meaningless across the raid.
- **buff_casts**: every observer uploads the same landing. Duplicate fraction is
  (N−1)/N: 92.9% at 14 clients (measured **86.8%** of bot log lines in a clean
  5-min fight window), **98.3% at 60**. A raid-wide buff round at 60 offers
  ~54,000 rows of which ~53,100 are duplicates.
- **raid_roster** (corrected): heartbeat gate is **3s** (`RAID_ROSTER_HP_MS`),
  end-to-end ceiling ~**15 POST/s at 60** (Zeal type-5 coalescing, not 20/s as
  first estimated). Each POST = 1 DELETE + up to ~40-row upsert → ~600 row
  writes + 15 whole-snapshot deletes per second of pure churn on one table.
  The code's own comment admits one uploader is sufficient; the docstring still
  claims a 60s heartbeat that was never true.
- **recent-fires**: 1.5s poll per client → **40 req/s at 60**; the in-code
  capacity comment underestimates by exactly 60× (it computed per-client rate
  as fleet rate). **target-buffs** is the only hot-path GET that hits Supabase
  per request (no bot cache). **character-live-state**: 24–72 GET/s at 60,
  Supabase-bounded by a 2s bot cache but HTTP-unbounded.

### New P0 defects (found by the audit, not previously known)
1. **A Supabase blip converts to permanent fleet-wide data loss.**
   `_resolveSessionToken` can't distinguish "query failed" from "token not
   found" — during a 522/520 window (we had one at boot tonight) valid agents
   get 401/403, and the agent durable queue **drops 4xx as permanent**. Fix:
   auth-lookup failure must return 503 (retryable), never 401. *(Small, bot.)*
2. **buff_casts dedup is broken and silently lossy.** `insertIgnoreDuplicates`
   sends `Prefer: resolution=ignore-duplicates` with **no on_conflict target**,
   so PostgREST 409s the whole batch — and any genuinely-new rows batched with
   a duplicate are **lost**. Worse: the endpoint's `written` count is always 0
   even on success, so the bot cannot observe the loss. Fix: per-row upsert
   with a real conflict target (or RPC). *(Small, bot.)*
3. **The `{s}` trigger placeholder excludes backticks** — Luclin-era names like
   Rhag\`Zhezum can never match a name-captured trigger. One-character regex
   fix. Directly explains a chunk of "TTS never fires." *(Tiny, agent.)*
4. **Ghost callouts**: trigger relays ride the durable FIFO, so a queue backlog
   (tonight's 409 storm) delivers fires **minutes late**, and the bot serves
   them for 60s from `posted_at` — stale callouts speak as if live.
5. **The trigger "Test" button is not a rehearsal** — it bypasses the tail
   pipeline (pattern exec, cooldowns, suppression), giving false confidence.
6. **Unauthenticated write vector**: `/api/mimic-link/start` does a Supabase
   INSERT per call with no rate limit.
7. **Two endpoints bypass even the per-machine election** (`debuff-clear`,
   `buff-lag-report`).
8. **Single-replica is load-bearing**: a second bot replica would double-post
   every Discord message (two gateway sessions). Horizontal scaling is not an
   option; admission control is.

### What already exists to build on (don't reinvent)
- `flag_shed_<kind>` remote load-shed (200-ack-and-drop **before** auth/body
  work) — wired for live_state, raid_roster, casting, threat. This is the
  embryo of the control plane.
- `raid_hold` broadcast (90s overlay-tuning poll), `mimic_notices`, the
  decoupled manifest (`AGENT_RELEASE_REF`, bot 3.0.195) with sha-of-served-file.
- Payload caps on every ingest endpoint; genuinely good field-level validation
  on most hot paths; in-memory chat dedup on the live path.

---

## Agreed execution order (2026-07-17, Hitya's call)

**Chunk 2 → 0 → 1 → R → 3 → 4 → 5.** Survive-success safeguards lead; the
weekend keystones (0.2 Saturday graduation, 0.3 Sunday capture) are
calendar-pinned and interleave on their dates rather than blocking the Chunk-2
build thread. Rationale: the audit's P0 blast-radius risk (no cross-machine
election, single load-bearing replica) is the thing that turns a good night
into an outage, and it must be installed *before* the next big raid, not after.

Active build thread starts at **[#72] designated-reporter election** (Wave 2.1).

### The queue

### Wave 0 — this week (pre-Sunday, freeze-friendly)
*Rule: nothing risky ships before an officer-light raid. Everything here is a
fix to something already broken, or write-only capture.*

| Order | Item | Why now | Size |
|---|---|---|---|
| 0.1 | ✅ SHIPPED (2026-07-17) Hotfix **duo**: auth 503-not-401 (P0 #1, bot 3.0.197) · `{s}` backtick fix (P0 #3, agent 3.3.75 beta). **P0 #2 (buff_casts upsert) was already fixed in prod** (`insertIgnoreDuplicates`) — dropped from the list. | Silent data-loss + the trigger bug killing current-era callouts. Test cases in `BETA-TESTING.md`. | S |
| 0.2 | [#89] Graduate agent → stable Saturday after beta soak | Fixes the fleet-wide tank/command blanking (stable has the undeclared-variable bug too). Maiden run of the redeploy-free pipeline. | S |
| 0.3 | [#90] Sunday capture: write-only roll+loot upload (go/no-go Friday) + hand-built Monday review | Roll loot is the point of the alt raid; outcomes currently never leave the machine. Worst failure = no data. | S/M |

### Wave 1 — trust the floor (next ~week)
| Order | Item | Notes | Size |
|---|---|---|---|
| 1.1 | [#71] Release gates: ESLint no-undef, res.ok everywhere, contract boot-test | The undeclared-variable class dies here; sub-second CI cost. | S |
| 1.2 | [#76] Callout reliability: checkpoint journal + diag card + real REHEARSE + sticky critical callouts | Audit delivered full specs (6 checkpoints; rehearsal must drive the tail pipeline, not `_fireTriggerActions` directly; fix ghost-callout staleness with a fire TTL). | M |
| 1.3 | [#79] Neural TTS voice + per-name pronunciation dictionary | Rides 1.2 — reliability first, beauty second. | M |
| 1.4 | Small fleet fixes: release-announce DM failures (15/26 failed), forceStable nag loop, revert-restages-agent + reset-agent button (from [#74], pulled forward), [#44] pvp/bosskill Discord defer | Each is small; together they end the "recent crashes" perception. | S |

### Wave 2 — survive success (before any 60-raider night / PoP launch)
| Order | Item | Notes | Size |
|---|---|---|---|
| 2.1 | [#72] Designated-reporter election (roster → 1 reporter + hash-verify failover; buffs/chat → caster-authoritative or 2–3 observers; cover the two stray endpoints) | Kills the 98.3%-duplicate future. Roster also drops DELETE+upsert for plain upsert + staleness filter. | M/L |
| 2.2 | [#73] Admission control: per-token budgets + 429/Retry-After, Supabase circuit breaker + request timeout (the wrapper has none), bot cache for target-buffs, consolidate the six GET loops into one multiplexed poll (or SSE), rate-limit mimic-link/start | The durable queue already honors backoff — the bot just never asks. | M/L |
| 2.3 | ✅ DONE (2026-07-18, bot 3.0.209 + agent 3.3.86 beta) [#74] Control plane: extend flag_shed to every kind + per-component kill switch/min-version, crash-loop auto-rollback + LKG agent file, per-channel manifest (`?channel=beta`) → **beta hot-swaps too**. See STATUS.md. | Independent deployment requires independent disablement. Prereq for [#65]. | M |
| 2.4 | ✅ DONE (2026-07-18, bot 3.0.209) [#58] Railway healthcheck / zero-downtime deploys — `/health` readiness gate + graceful SIGTERM drain (config half; full overlap needs the Railway plan feature). | Old debt; matters more as deploys get rarer but bigger. | S |

### Wave 3 — fight smarter (the conversion wins)
[#78] Boss playbook + approach briefs (Sunday v1 seeds it; Discord pipe is the
adoption engine) → [#83] Post-to-/rs + Discord↔site deep links → [#84] AOE burn
windows (retire /parseaoe) → [#36] AoE dance callouts → [#85] raid-night script
learning. Each lands in a room people already live in.

### Wave 4 — grow the pack
[#75] Pre-raid drill + golden-log CI (also the regression net for everything
above) → [#86] role-aware first-raid mode (+[#53]) → [#87] officer runbooks +
console → [#88] in-flow discovery + dark-feature counts → [#77] transparency
panel + report cards + close-the-loop feedback.

### Wave 5 — remember everything
[#80] Raid Night Review (template = Monday's hand-built one) → [#81] the Wolf
Pack Raid Guide → [#82] Quartermaster (Shield of the Immaculate board proven:
23 owners / ~38 copies queryable today) → [#65] hot-servable overlays (gated on
the four-gate rule below) → data-quality tail: [#47]/[#51] same-name
segmentation, [#56] HP serialization, [#46]/[#52] base stats, [#54]/[#55],
[#64] Zeal exit-crash, death-count witness dedup (bot merge), [#66]/[#67]/[#3]
overlay polish, [#68]–[#70] DKP round-out, [#1] per-character overlay profiles.

---

## The four-gate rule (for every independently-updatable component)

No component ships on its own update track until it has:
1. **Schema handshake** — declares the state-schema version it needs; shell
   degrades gracefully on mismatch, never blanks.
2. **Kill switch** — remotely disable *that component at that version* with
   zero deploys (control plane, Wave 2.3).
3. **Drill test** — participates in the pre-raid check (Wave 4).
4. **Rollback** — last-known-good kept locally; crash-loop auto-reverts.

## Dependency edges (why this order and not another)
- Reporter election [#72] and admission control [#73] before any 60-raider
  event — the math says the bot does mostly duplicate work during fight bursts
  at 14 already.
- Control plane [#74] before hot-servable overlays [#65] — gates 2 and 4.
- Callout journal [#76] before the neural voice [#79] — a beautiful voice that
  fires 80% of the time still isn't trusted.
- Drill [#75] before first-raid mode [#86] — the drill *is* the tutorial.
- Review [#80] before Guide [#81] — the Guide is accreted Reviews + playbooks.
- Playbook [#78] seeds from Sunday's captured ordering [#90] and later from
  script learning [#85].

## Post-verification addendum (2026-07-17, resumed run — 13/13 agents)

*The synthesis + the bot-guardrails adversarial pass completed after this doc
first shipped. Both Wave-0.1 data-loss P0s are **CONFIRMED** (auth-blip →
permanent queue loss; buff_casts batch-409 destroying batch passengers). The
run also surfaced findings this doc did not have — deltas below, explicitly
flagged rather than silently merged.*

### The callout trifecta (NEW — this is why "TTS never triggers")
1. **P0: trigger evaluation runs AFTER the combat-line privacy whitelist** —
   **9 of the 17 shipped suggested trigger templates** (mob_enraged,
   self_snared, self_mezzed, cast_fizzle, …) can *never* fire because
   `shouldKeep` drops those log lines before the trigger engine sees them.
   Fix: evaluate triggers before the drop (locally — the dropped lines still
   never upload, privacy unchanged). → joins Wave 1.2, first item.
2. **P0: the trigger overlay's ✕ silently sets `enableTriggerTts=false`
   persistently** — one mid-fight misclick permanently mutes every future
   callout, countdown, and warning until manually re-enabled. Decouple hide
   from mute (S — can ride the Saturday graduation).
3. **P1: every bot deploy makes the fleet relay-deaf for hours-to-days** —
   the relay's in-memory `nextId` resets to 1 on deploy while agent cursors
   only ratchet upward, so agents skip everything until the counter passes
   their old cursor. Fix: cursor-reset detection (S). → "deploy-safety trio"
   in Wave 1.4, with a 404 catch-all and intra-batch upsert dedup.

Together with the backtick fix these four explain essentially the whole
"callouts are unreliable" experience — none of them are TTS-engine problems.

### Other additions/corrections
- **Figure correction**: "79% of log lines were 409s" → measured **86.8% in
  the peak 5-min window, ~67% over 10 min, 0 in quiet windows** (night-wide
  number unrecoverable — Railway log cap + the 02:30 redeploy split history).
- **Deadline**: quantifying how many *new* rows died inside 409'd batches is
  possible via one agent's `--since` backfill diff, but **buff_casts retention
  is 7 days** — do it this week or lose the evidence.
- **Wave 2 additions** (fold into #73): Supabase fetch has **no timeout** →
  brownout zombie chains (600–1,200 held handlers per 60s brownout at 60);
  poison-payload hardening (a garbage `cast_at` → handler 500 → agent re-posts
  the same 256KB batch forever); encounter-burst flattening (~90MB offered per
  boss kill at 60); GET-side collapse (cache target-buffs, batch live-state,
  long-poll recent-fires).
- **Wave 1 addition**: release-announce DM fanout — err.code logging first
  (50007 "DMs off" is the prior); the 15-failure cohort repeats every release
  until diagnosed.
- **Control-plane keys** (#74): add `flag_agent_kill` (fleet dormancy) and
  `min_agent_ver_num` (floor version) to the tuning channel — policy semantics
  need officer sign-off.
- **Honesty ledger**: the run's remaining unknowns are recorded in the audit
  output (adoption rates behind the at-60 GET range, Zeal's native type-5
  emission rate, the observed-20s roster cadence matching no shipped code
  path, fielded-agent 429 handling, SAPI voice availability per machine).
  None change the wave order; several are answerable from Supabase
  `_trackUpload` data when we want them.

## Rules-mechanization thread (added 2026-07-17 pm — after ingesting #rules/#raid-rules/#loot-rules)

The Discord rulebook is mostly arithmetic over data we already collect. This is
a **cross-cutting thread**, not a single wave — its keystone (#92) is a
prerequisite the earlier waves don't need, so it runs in parallel and lands its
pieces as they're ready. Ordering *within* the thread:

| Order | Item | Why | Blocks |
|---|---|---|---|
| R.1 | [#94] Ingest rules → structured guild-rules store | One source of eligibility/loot facts so R.3/R.4/R.5 don't each hard-code (and drift from) the rulebook. Small, pure data. | — |
| R.2 | [#92] Attendance & tick metrics engine (60/90/lifetime RA% + tick counts) | **The number half the rules depend on**: seating priority (60 core slots when raid >72), Active-roster (30-day drop-off), every tiebreak. Nothing below computes without it. | #96, seating, review cards |
| R.3 | [#95] Raid Kit readiness checker (rule 12) | 100 MR floor from gear + EB/Lev/self-port/self-invis + Necro coffin. MR-floor alone is a shippable v1 off the gear snapshot we already have. Pure "helping not watching." | — (v1 independent) |
| R.4 | [#93] Raid composition template + planned-vs-actual matcher | RaidHelper-fed archetype groups → readiness + role-gap deltas at pull time. | — |
| R.5 | [#91] Off-night NBG roll capture (Fri/alt-raid) | Write-only parse of `/random` + `/rs` awards, link REUSED roll sessions. The one piece gated on a **Friday go/no-go**. | — |

**Epic resolver [#96] is OUT of the priority set.** Hitya confirmed epics are
trivial in this era (early-game, anyone who fills the Google-Sheet tracker gets
one), so the loot-rule epic tiebreak ladder is vestigial. The logic is captured
in the task for the day a genuinely-contested epic drop appears; until then it
does not consume a slot.

Where the thread's outputs plug into the main waves: R.2's numbers feed the
Raid Night Review [#80] (Wave 5) and any seating/attendance surface; R.3/R.4
are the concrete first payloads of "big brother **helping**" [#77]; R.5 seeds
the Monday alt-raid review [#90].

## Decision points for Hitya
1. Friday: go/no-go on the Sunday write-only roll+loot capture (0.3) **and** the
   off-night NBG roll capture (R.5 / [#91]) — same capture machinery, same call.
2. Saturday: confirm the stable graduation after beta soak (0.2).
3. Wave 2 scheduling: before PoP launch is the hard deadline; sooner if
  attendance grows past ~45.
4. Whether the hotfix trio (0.1) ships this week or rides Saturday's
  graduation (bot parts can go anytime — they're redeploy-decoupled from the
  agent now).
5. Rules thread: R.2 [#92] is the unlock for the whole loot/seating half — slot
   it as soon as Wave 1 frees hands; R.1/R.3-v1 can run alongside Wave 1 (no
   raid-night risk, mostly read-only web + data).
