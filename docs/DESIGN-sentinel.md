# DESIGN — the Data Sentinel (continuous ingest review, raid-aware)

**The ask (Hitya, 2026-08-16):** *"I think it would be helpful for me to
implement something like this to continuously review the data coming into the
database, especially during raids and as a way to review the live test cases
you write up during implementation"* — pointing at
`github.com/PrimeIntellect-ai/prime-agent` and asking how long-running actions
fit our flow.

**Verdict up front: don't adopt the stack; adopt its two good ideas.** The job
splits into a deterministic half that belongs in the bot (it is already awake,
already holds service-role, already posts to Discord) and a judgment half that
belongs in scheduled Claude sessions (which this repo's tooling already
supports). Running a third agent framework to do either would add a
code-executing daemon next to our credentials to get capabilities we already
have. Full reasoning below, then the design.

---

## 1. What prime-agent is (reviewed 2026-08-16)

MIT, ~16.3k stars, actively developed. An open-source coding/research agent
whose distinguishing features are:

- **Long-running sessions** — daemon-backed, surviving disconnects, with
  `/heartbeat` and `prime-agent schedule` to re-enter a session periodically
  or at a set time.
- **Autonomous mode with budgets and quality gates** — "continues within
  configured turn, token, and time budgets and can run user-defined quality
  gates," with the README's own caveat that "a passed gate checks only what
  that gate verifies; reaching a limit does not imply task success."
- **A "Continual Harness"** — durable memories/skills/prompts refined across
  sessions by "small, evidence-backed updates."
- A persistent IPython REPL where tool and sub-agent calls are Python.

Two things worth saying plainly:

1. **Its philosophy already matches ours.** "A passed gate checks only what
   that gate verifies" is our "green CI is necessary, never sufficient." The
   Continual Harness is DECISIONS-*.md + the session-digest hook + `/recall`,
   independently invented — the architect doc called that discipline our moat.
   Convergent design is a good sign for the ideas and an argument *against*
   needing the second implementation of them.
2. **Its own README warns what it is:** it "executes model-generated Python
   and project commands with your user permissions"; its process model is
   "**not** a security sandbox," and untrusted work belongs "in an external
   sandbox." An unattended code-executing loop is exactly the thing we would
   have to park next to the service-role key to do this job. We declined
   Agent-Reach over a milder version of the same trade (2026-08-14 entry).

## 2. Why not run it for this job

- **Deterministic checks should be deterministic.** A raid-window watcher
  ticks every few minutes for 4.5 hours, three nights a week, and almost every
  tick finds *nothing*. Paying model tokens to run SQL that returns zero rows
  is the wrong shape. An LLM earns its cost when a check FIRES (diagnosis) or
  when the battery needs authoring — not per tick.
- **There is no good host.** Our always-on machines are Railway (the bot) and
  the EQ desktop. A new VPS is new cost and new surface; the EQ machine is the
  worst possible place for an autonomous code executor (it holds `A:\EQ`,
  the local MariaDB creds, and would need the service-role key).
- **Every differentiating feature already exists in our stack**: scheduled
  re-entry = Claude Code cron sessions (already available in this repo's
  tooling); quality gates = our seven enforced CI gates; durable memory = the
  docs discipline. The only genuinely new thing is the Python REPL, which the
  sentinel job does not need.

**What would change the verdict:** if we ever want a genuinely open-ended 24/7
researcher (not a watcher) — e.g. continuously mining the log corpus for new
trigger patterns — prime-agent's shape fits that, on an isolated box with a
read-only DB role, never the service-role key.

## 3. The design: two loops

### Loop 1 — the Sentinel (deterministic, in the bot)

A named battery of invariants run by the bot on its existing job cadence
(piggybacking the 5-minute checker; the raid-window set runs every tick,
the rest every 30 minutes). Results write to Postgres; Discord only renders —
per the projection rule ratified 2026-08-16.

- `sentinel_findings(id, invariant, severity, value, threshold, detail jsonb,
  raid_night, first_seen, last_seen, resolved_at)` — a firing invariant
  UPSERTS (one open row per invariant, `last_seen` advancing), so a
  4-hour breach is one finding, not 48 posts.
- Projection: one officer-thread message per OPEN finding, edited in place,
  ✅-edited on resolve. Quiet nights post nothing.
- Each invariant is a row in code: `{ key, severity, raidOnly, sql | fn,
  threshold, note: 'the incident that motivated it' }`. Adding one is a
  one-line push — the KIT_CATALOG idiom.

**The seed battery — every entry cites a real incident, live values measured
tonight (2026-08-16):**

| invariant | motivating incident | live value tonight |
|---|---|---|
| `dup_award_groups = 0` | the loot fold's 116 dupes + the 560 legacy rows | **0** (schema-pinned; this is the regression sensor) |
| `ingest_freshness` — encounters/chat/rolls rows arriving while a raid window is open and ≥N agents heartbeat | "check that the loot fold actually ran" — shipped broken for 18h | last chat row 03:44Z, last encounter 02:32Z (healthy) |
| `unlabeled_roll_sessions` (rolling 14d) | the 2026-08-14 "unlabeled roll" night | **47** — live signal *right now*: the 3.5.84 parser fix hasn't reached the fleet |
| `fold_lag` — newest opendkp_loot raid vs newest folded raid | the June 4 → Aug 14 ten-week silent gap | (fold current) |
| `encounters_null_zone` | find_or_create doesn't set zone on insert (scope boundary in CLAUDE.md) | **0** in 30d |
| `dead_enabled_triggers` — enabled triggers with zero fires in 14d of recent_fires | the 37-of-109 dead-trigger discovery | 107 enabled (join to fires = the check) |
| `clock_skew_outliers` — uploader offset > 10 min | the doubled live damage that killed combined-DPS | (per-raid) |
| `chat_rewrite_pairs` — near-duplicate chat rows, same text stripped of punctuation, different speaker, ±5s | the open Hawkner/Syko mystery | (bounded to raid window) |
| `duplicate_projection_posts` — same review/summary posted >1× per night | bot 3.1.8's eleven raid reviews | (bot_kv migration made this rare; sensor keeps it honest) |
| `queue_depth` — agent durable-queue depth via upload stats | the 2026-07-13 mid-raid queue backup | (per-raid) |

### Loop 2 — judgment (scheduled Claude sessions, existing tooling)

- **Post-raid triage, ~00:45 ET Sun/Wed/Thu** (after the freeze lifts): a
  scheduled session reads open `sentinel_findings` + the night's counts,
  diagnoses anything open, writes the triage into DECISIONS/STATUS, and
  proposes battery additions. Bounded task, normal gates; it does not push
  during the freeze by construction (it runs after).
- **On-demand**: a firing HIGH finding is a session prompt away — the
  session-digest hook already surfaces open items at session start, so adding
  open sentinel findings to that digest makes every future session see them.

This is the prime-agent feature set mapped onto what we run: heartbeat →
cron re-entry; autonomous budget → a bounded scheduled task; quality gates →
the same CI gates every session already obeys; continual harness → the docs.

### The live-test promotion rule (the second half of the ask)

The verification scripts written during implementation (the browser drives,
the end-to-end SQL checks) die with the scratchpad today. The rule going
forward: **when a ship's verification proves something about PRODUCTION
behaviour — "the fold ran and rows moved", "labels appear after a raid",
"dup groups stayed 0" — that check graduates into the sentinel battery in the
same change.** The unit test guards the logic; the sentinel invariant guards
the deployment. This institutionalizes the loot-fold lesson ("did the deploy
work is a different question from do the tests pass") as a standing mechanism
instead of a memory.

## 3b. Placement addendum — the Unraid replica (Hitya, 2026-08-16)

Hitya: *"I like the idea of one running on the backup local DB alongside it in
my unraids docker."* That slots in cleanly as a SECOND sentinel tier, not a
replacement for the bot's:

- **Raid-critical freshness checks must stay on the LIVE database** — the
  replica lags by the backup cadence, so "are rows arriving right now" is
  unanswerable there by construction.
- **Heavy analytical invariants belong on the replica**: the chat-rewrite
  near-dup scan over 342k rows, dead-trigger joins, long-window skew
  analysis — free compute, zero prod load, zero egress cost, and a read-only
  copy by nature (the safest possible place for exploratory SQL). A container
  in the existing Unraid stack next to `unraid-backup-supabase.sh`'s target,
  running the same battery file on a nightly timer, posting findings back
  through the bot's API (or just writing a findings file the triage session
  reads).
- This also gives the sentinel a second life in the self-host picture: on a
  full on-prem deployment the "replica tier" IS the main DB, and the battery
  runs entirely locally. (Recorded in DESIGN-selfhost-wizard §3.)

## 4. Cost and order

- Sentinel v1 (table + battery runner + projection + 6 seed invariants):
  **~3–4h bot work + one migration.** No new hosts, no new keys, no LLM cost
  on quiet ticks.
- Post-raid triage session: **~15 min to schedule** once findings exist.
- NOT built tonight, deliberately: Sunday's raid is Mimic 2.5.0's first live
  test, and a brand-new periodic subsystem deployed hours before it would
  contaminate the one experiment we most want clean. Land Monday.

**Needs Hitya's word:** the officer-thread surface (which thread; severity
threshold for posting) and the go to build. The battery seeds are listed
above; edits welcome.
