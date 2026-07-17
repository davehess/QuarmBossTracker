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

## The queue

### Wave 0 — this week (pre-Sunday, freeze-friendly)
*Rule: nothing risky ships before an officer-light raid. Everything here is a
fix to something already broken, or write-only capture.*

| Order | Item | Why now | Size |
|---|---|---|---|
| 0.1 | Hotfix trio: auth 503-not-401 (P0 #1) · buff_casts per-row upsert (P0 #2) · `{s}` backtick fix (P0 #3) | Two silent data-loss bugs + the trigger bug killing current-era callouts. Bot parts deploy anytime; agent part rides the graduation. | S |
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
| 2.3 | [#74] Control plane: extend flag_shed to every kind + per-component kill switch/min-version, crash-loop auto-rollback + LKG agent file, per-channel manifest (`?channel=beta`) → **beta hot-swaps too** | Independent deployment requires independent disablement. Prereq for [#65]. | M |
| 2.4 | [#58] Railway healthcheck / zero-downtime deploys | Old debt; matters more as deploys get rarer but bigger. | S |

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

## Decision points for Hitya
1. Friday: go/no-go on the Sunday write-only roll+loot capture (0.3).
2. Saturday: confirm the stable graduation after beta soak (0.2).
3. Wave 2 scheduling: before PoP launch is the hard deadline; sooner if
  attendance grows past ~45.
4. Whether the hotfix trio (0.1) ships this week or rides Saturday's
  graduation (bot parts can go anytime — they're redeploy-decoupled from the
  agent now).
