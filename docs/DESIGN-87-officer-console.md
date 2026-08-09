# #87 — Officer runbooks + console

*Design, 2026-08-02. Wave 4 of `DESIGN-platform-queue.md`
("[#86] role-aware first-raid mode → **[#87] officer runbooks + console** →
[#88] in-flow discovery"). Roadmap card: `officer-console` — "The 'how do I fix
X mid-raid' knowledge, written down and wired to buttons — one officer surface
instead of knowledge living in three heads."*

**Status:** design + phase-1 implementation (`/admin/console`, additive, web-only).
Bot-side items in §7.2 are **proposed, not built** — they need Hitya's call and,
in one case, a lever that can silence the fleet.

---

## 0. The short version

Nearly every lever an officer needs **already exists**. #72/#73/#74 built a real
control plane in July: fleet dormancy, per-stream load-shed, per-uploader×kind
budgets, a version floor, reporter pins, Mimic Mail, a Supabase circuit breaker,
a readiness-gated `/health`, and a pre-raid dependency probe that posts to
Discord. What does *not* exist is:

1. **the written procedure** that says which lever, in what order, and when NOT
   to pull one; and
2. **a place that tells you something is wrong before a raider does.**

So #87 is not a control-plane project. It is a **knowledge + detection**
project that borrows the controls it already has. The console's job is to turn
four failures into non-failures:

| Failure | Today | What fixes it |
|---|---|---|
| **Discovery** — the officer doesn't know the lever exists | 14 kill switches live at the bottom of a page called "Overlay tuning" | Runbook names the lever and links straight to it |
| **Diagnosis** — knowing *which* lever | Lives in one or two people's heads | The runbook, ordered cheapest-check-first |
| **Detection** — knowing at all | A raider says "chat is dead" | The health board + drift panel |
| **Reversal** — turning the mitigation back off | Nobody does | Drift panel with an age, and a nag |

### Three live proofs, pulled from prod while writing this (2026-08-02)

These are not hypotheticals. Every one is a real, currently-true condition that
nobody is looking at, and every one is a single SQL predicate away from being on
a screen:

1. **`dedup_chat = 0` has been set for 14 days.** It is the mitigation from the
   2026-07-19 chat blackout. `BETA-TESTING.md` #112 contains an explicit
   three-step *"Re-enable procedure (officer, do this once the fleet is on agent
   ≥3.3.91)"*. The fleet has been ≥3.3.91 for a fortnight. Nothing reverted it,
   because nothing shows it. → **Failure 4, reversal.**
2. **29 of 101 enabled guild triggers are structurally dead.** The `^`-anchored
   patterns the 2026-07-31 audit found (agent matches against the RAW line
   including the `[Thu Jul 31 …] ` prefix, so `^` can never match) are still
   enabled and still silent. Both test surfaces validate a timestamp-free string,
   so **Rehearse passes on all 29.** → **Failure 3, detection.**
3. **92 `agent_backfill_requests` sit at `status='pending'`.** The board on
   `/admin/agents` shows them; nothing tells anyone the number is 92. →
   **Failure 3.**

A console that showed only those three numbers on one page would already have
paid for itself.

---

## 1. Who this is for, and when

Be honest about the medium. **An officer mid-raid is inside EverQuest.** They
are not going to alt-tab to a Next.js page while the MT is at 30%. This is why
#118 exists at all — its premise, verbatim from the ledger, was *"officers rarely
have the web admin open mid-raid"*, so the kill switches got mirrored into
Mimic's 🛡 Admin tab.

So the surfaces divide by *when*, not by *what*:

| When | Surface | Why |
|---|---|---|
| **Before the pull** (setup, 19:00–19:30) | `/admin/console` + the bot's 19:30 pre-raid Discord line | Second monitor, phone, or the officer who isn't leading. This is when the drift panel and the health board earn their keep. |
| **Mid-fight** | Mimic **🛡 Admin** tab (already built: 🛑 kill switches with typed confirm, 📡 Reporters swap/include) | In-game, no alt-tab, works on local data if the bot is unreachable |
| **Between pulls / after** | `/admin/console` | Triage, clearing mitigations, filing what broke |
| **The next day** | The runbooks themselves | The written half is what makes a *different* officer able to do it |

**Design consequence:** the console must be phone-legible (single column, big
targets, no hover-only affordances), and **every runbook step must name its
Mimic-side equivalent when one exists.** A runbook that only works from a laptop
is a runbook that doesn't work at 21:40 on a Thursday.

**Second consequence:** the console never becomes a second source of truth.
Every write goes through the *same* `overlay_tuning.tuning` read-modify-write
that `/admin/overlays` (web) and `POST /api/agent/flag-override` (Mimic) already
use, so all three surfaces agree. Nothing moves out of its current home — see
§7.1.

---

## 2. The control surface that already exists (inventory)

Written down here because the single biggest cause of "we don't have that" in
this repo is not grepping all four surfaces (CLAUDE.md's own working rule). This
is the officer-lever census as of bot 3.0.242.

### 2.1 Control plane — `overlay_tuning.tuning` (jsonb, 60s bot cache)

| Key | Effect | Set from | Blast radius |
|---|---|---|---|
| `flag_agent_kill=1` | **Whole fleet dormant.** All uploads + non-control polls stop; durable queue HOLDS; heartbeat continues; overlays keep running on local data | `/admin/overlays`, Mimic 🛡 (typed confirm) | ☠ total |
| `min_agent_ver_num=<n>` | Version floor (`major*10000+minor*100+patch`). Below-floor agents stand down + nudge | same | ☠ partial-to-total (a fat-fingered value stands the fleet down) |
| `flag_shed_<kind>` | Bot 200-acks and DROPS that ingest stream. 11 sheddable kinds | same | one stream |
| `flag_disable_budgets=1` | Turns off admission control entirely | same | protection off |
| `budget_<kind>_per_min` / `budget_enforce_<kind>` | Per-uploader×kind windowed budget; `enforce` promotes a durable kind from log-only to real 429+`Retry-After` | **SQL/MCP only — no UI** | rate limiting |
| `flag_raid_hold` | 1 = force agents to defer background file work; 0 = force off; unset = the Sun/Wed/Thu 19:00→00:30 auto schedule | Mimic 🛡 (`_FLAG_OVERRIDE_KEYS`); **not on the web page** | background work |
| `flag_disable_reporter_election` | Every agent uploads chat/buffs/roster again | `/admin/overlays`, Mimic 🛡 | load ↑, correctness ↑ |
| `dedup_chat` / `dedup_buffs` / `dedup_roster` | Per-stream reporter dedup on/off | same | load ↔ coverage |
| `reporter_pin_<svc>` / `reporter_extra_<svc>` | Pin/add a reporter for chat/buffs/roster | Mimic 📡 Reporters | one stream's coverage |
| `agent_release_ref_beta` | Which ref the beta manifest serves | SQL/MCP | beta hot-swap target |
| `hide_main_names` | Privacy exception list | SQL/MCP | display |
| `ext_*` / `offheal_*` / `ch_*` | Numeric overlay knobs | `/admin/overlays` (web only, by design) | display |

**Deliberately not sheddable** (`_SHED_NEVER` in `index.js`): `encounter`,
`chat`, `bosskill`, `lockout`, `historical_chat`. `_isShedded` refuses them even
if a flag is set. This is a *feature*, and every runbook must respect it: there
is no officer action that turns the raid's parse collection off, and there
should never be one.

### 2.2 Other officer levers

- **`/admin/agents`** — fleet board (per character: version, last upload, endpoint
  mix, queue depth, errors) + the backfill request board.
- **`/admin/triggers`** — enable/disable/edit guild callouts (10-min agent poll).
- **`/admin/notices`** — Mimic Mail: broadcast to every Mimic within ~90s;
  `severity: critical` also posts to Discord. **Version-independent** — reaches
  every Mimic ever built with no release. This is the "tell the raid something"
  lever and it is badly under-used (last notice: 2026-07-15).
- **`/admin/encounters`** — HP-vs-damage health, duplicate detection, merge,
  mark-incomplete, file a backfill request.
- **`/admin/audit`** — searchable audit trail (the Discord thread has officer
  Undo buttons on kill/unkill/updatetimer).
- **`/admin/feedback`**, **`/admin/queue`**, **`/admin/voice`** (TTS ripcord).
- **Discord**: `/token` (list/revoke agent sessions; officers can mint on a
  member's behalf), `/parseagents` (who's uploading, last 20 min),
  `/restore <links>` (rebuild timers from Discord cards), `/recoverkills`
  (rebuild timers from Supabase encounters), `/syncopendkp`, `/board`.
- **Automated**: the **19:30 ET pre-raid health check** (Discord ping / DB /
  GoTrue / wolfpack.quest, `bot_kv`-latched); the `raid-freeze.yml` tripwire;
  Mimic **LKG crash-loop auto-rollback**; the Supabase **circuit breaker** +
  request timeout, both on `GET /health`.

### 2.3 The health data that exists but is not aggregated

`GET /health` (bot): `{ok, ready, shutting_down, supabase_breaker, budgets}`.
`GET /api/health` (web): `{ok, degraded, checks:{auth, db}}` — deliberately
separates GoTrue from Postgres because *that is what 2026-07-13 looked like*
(GoTrue 504s, Postgres fine).

Supabase carries the rest as freshness-of-last-row: `agent_upload_stats`,
`chat_messages`, `encounters`, `character_live_state`, `guild_triggers`,
`agent_backfill_requests`, `overlay_tuning`, `mimic_notices`.

**Nothing reads these together.** That is the console.

---

## 3. The runbook set — ranking and justification

Ranked by **likelihood × pain**, where likelihood is grounded in how often the
thing has actually happened in the recorded history (`STATUS.md`, the release
`fixes[]` in `roadmapData.ts`, `BETA-TESTING.md`, CLAUDE.md's hard-won rules),
not in how bad it sounds.

| # | Runbook | Likelihood | Pain | Score | The receipts |
|---|---|---|---|---|---|
| **RB-01** | **A callout didn't fire** | **Very high** — every raid week | High (a tank dies) | ★★★★★ | Callout trifecta (2026-07-17: triggers ran *after* the privacy filter, 9/17 shipped templates could never fire; ✕ silently persisted `enableTriggerTts=false`; relay `nextId` reset made the fleet relay-deaf for hours). `{s}` excluded backticks → Luclin names unmatched. **29/101 enabled triggers `^`-dead, live right now.** Emperor tank-buster pattern matched **0 of 7** real lines. DT pet-victim capture. Cleric-hammer-pet DT false positive. TTS silent on machines where Windows muted a never-clicked overlay window. |
| **RB-02** | **Parses are missing or wrong** | High | **Very high** (guild memory + DKP) | ★★★★★ | Auth-blip 401 → agent queue drops 4xx as *permanent* → silent fleet-wide loss (P0, 2026-07-17). 409 storm 2026-07-13 (86.8% of bot log lines in the peak 5 min). Charm-pet attribution corruption 2026-07-30 (3.05M phantom damage; totals past boss HP; one corrupted uploader per fight). Death over-count (#134). Lord of Ire split-vs-knit (2026-07-13). `insertIgnoreDuplicates` batch-409 destroying passengers. |
| **RB-03** | **The bot is down / everything froze mid-raid** | Medium | **Maximal** | ★★★★★ | 2026-07-13: GoTrue 504s wedged the site while Postgres was fine; **web pushes were restarting the bot** (fixed via `railway.toml` watchPatterns); mid-raid restarts amplified the queue backup and the announcer spam. Single replica is load-bearing (a second replica double-posts every Discord message). Readiness gate + graceful drain shipped as #58. |
| **RB-04** | **One agent is misbehaving** | Medium-high | High | ★★★★☆ | 2026-07-30 charm corruption was **per-uploader** (Hawkner on Blood, Bardtholemu 3.05M, Uilnayar at 01:05). 2026-07-19 chat blackout was **one** elected reporter heartbeating with its character logged out. Version spread today: 9 agent versions in 7 days, oldest still-active 3.4.22. |
| **RB-05** | **Guild chat stopped reaching Discord** | Low (mitigated) but **unresolved** | High | ★★★★☆ | The 2026-07-19 blackout, 6:43am–3:16pm. Fixed in #112 by liveness + zone-spread — but the mitigation `dedup_chat=0` **is still on 14 days later**, so the fix has never actually been exercised in prod. |
| **RB-06** | **Mimic won't update / a bad build is out** | Medium | Medium-high | ★★★☆☆ | 2026-07-30 atom-feed starvation: 14 Deck builds in 2 days pushed every `beta` tag out of GitHub's 10-entry `releases.atom` window → *the entire Windows beta channel* failed with "No published versions on GitHub". 2026-07-09: parking beta at/below stable stops the updater offering betas. `forceStable` nag loop. LKG crash-loop rollback + blacklist. |
| **RB-07** | **A raider can't get Mimic/Zeal working** | **Highest volume** | Low each | ★★★☆☆ | In-EQ-folder install breaks Zeal DX-hook detection (n=1, 2026-06-12) *and* `detectEqDir()` actively steers people into that layout. Elevation mismatch = silent connect-then-close. `/log on` not set. Token lockout (`/token for:@member` exists precisely for this). Release-announce DMs failed for 15 of 26. |
| **RB-08** | **Something must ship during the raid window** | Medium | High if fumbled | ★★★☆☆ | The freeze rule itself (Hitya 2026-07-13) and its `[hotfix]` escape hatch; `raid-freeze.yml` is advisory only — Railway/Vercel deploy regardless. |
| RB-09 | Night thread in the wrong channel / missing | Medium | Low-medium | ★★☆☆☆ | 2026-07-31: v1's parent chain stopped at `RAID_CHAT_CHANNEL_ID`, unset on Railway → night one's threads all landed in #raid-mobs. |
| RB-10 | Loot / DKP didn't propagate | Medium | High (disputes) | ★★★☆☆ | #138 OpenDKP upsert PG 21000 — whole batches silently never mirrored. #110 "Backpack" incident: 3 deleted awards still live on the site. |
| RB-11 | A trigger is spamming the raid | Low-medium | Medium-high | ★★☆☆☆ | Ghost callouts (relays riding the durable FIFO, served for 60s from `posted_at`); the DT false positive; the `voice` action retry loop. |
| RB-12 | Boards / timers are wrong | Low | Medium | ★★☆☆☆ | PoP-lock leakage via PvP-event lockouts named for the war gods (2026-07-13); stale-alert suppression post-redeploy; `/restore` + `/recoverkills` exist for volume loss. |

**Why RB-01 is first and not RB-03.** RB-03 is scarier, but the platform has
been through exactly one bot-down raid and four+ callout-failure raids. Officers
ask "why didn't the callout fire" *weekly*. And it is the runbook with the most
counter-intuitive content: **the overwhelming majority of callout failures are
not the trigger engine.** Ordering the checks correctly is worth more here than
anywhere else.

---

## 4. The runbooks

Format is fixed on purpose — the console renders it, and the anti-rot test
(§8) parses it:

> **Symptom** (what someone actually says) · **Grounded in** (the incident) ·
> **How you tell** (signals, cheapest first) · **Do this** (steps, each with its
> lever and where the lever lives) · **If that didn't work** · **After** ·
> **Don't** (the anti-patterns, which are the part that gets lost)

---

### RB-01 — "The callout didn't fire"

**Symptom.** A raider says the tank-buster / Death Touch / enrage callout never
spoke, or spoke for some people and not others, or fired minutes late.

**Grounded in.** The callout trifecta (2026-07-17 audit); the `{s}` backtick
exclusion; the `^`-anchored dead-pattern class (2026-07-31, **29 still live**);
the Emperor Ssraeshza tank-buster pattern that matched **zero of seven** real
log lines; the Windows-muted-overlay TTS silence (2026-07-22).

**How you tell — in this order.** Each step is cheap and rules out a whole class.

1. **Did it fire for anyone else?** Mimic dashboard → **Triggers** tab → recent
   fires (and the why-didn't-it-fire panel), or the bot's `#trigger` relay posts.
   - Fired for others → **it's that one machine.** Jump to step 5.
   - Fired for nobody → keep going.
2. **Is the pattern structurally alive?** Console → *Trigger set health* → the
   **dead-pattern** count. A pattern starting with `^` **can never match** — the
   agent tests against the RAW log line, timestamp prefix included.
   *This is the single largest bucket today (29/101).*
3. **Does the log line the trigger needs actually exist?** Get the **verbatim**
   line from a raider's `eqlog_*_pq.proj.txt`. EQ **never names a mob's spell** —
   it prints a bare `begins to cast a spell.`. A trigger that waits for the
   words "tank buster" waits forever. (Emperor Ssraeshza: the old pattern
   demanded the literal words and matched 0/7 real lines, including plain hits.)
4. **Rehearse it — and know Rehearse's blind spot.** Mimic → Triggers →
   **Rehearse** drives the real tail pipeline (unlike the old "Test" button,
   which bypassed pattern exec, cooldowns and suppression). **But
   `_synthesizeMatchingLine` strips anchors**, so *Rehearse passes on all 29 dead
   patterns.* Rehearse proves the action path (TTS/overlay/timer), not the match.
   To prove the match, use **Replay** (`#101`) over a real log slice that contains
   the real line.
5. **Machine-local causes**, in order:
   - **Audio**: does "Mimic" appear in the Windows volume mixer during a
     Rehearse? Windows silently blocks audio from a window that is never clicked
     — that was a real class of "I see the flash, hear nothing".
   - **Muted**: was the trigger overlay closed with ✕ on an old build? That used
     to persist `enableTriggerTts=false` forever. Fixed in the 1.9 line — but
     check the agent version.
   - **Class filter / `require_raid_member`** on the guild trigger row
     (`/admin/triggers`).
   - **Agent version** — console → *Fleet versions*. Backtick names (`Rhag\`Zhezum`)
     need the `{s}` fix (agent ≥3.3.75).
6. **Late, not missing?** That's the ghost-callout path: relays ride the durable
   FIFO, so a queue backlog delivers fires minutes late and the bot serves them
   for 60s from `posted_at`. Check the uploader's queue depth on `/admin/agents`
   → RB-02 step 2.

**Do this.**

| Cause | Action | Where |
|---|---|---|
| `^`-anchored pattern | Replace `^` with `\]\s+`, or unanchor. **One row at a time, each confirmed against a real log line.** | `/admin/triggers` — live on the 10-min agent poll, no release |
| Pattern demands text EQ never prints | Rewrite as the EQLogParser two-alternative shape (damage line **OR** generic cast line) | `/admin/triggers` |
| One machine silent | Walk them through Rehearse → volume mixer → agent version | Mimic Triggers tab |
| Trigger genuinely wrong | Disable the row, tell the raid in `#raid-chat`, fix after | `/admin/triggers` + console **Mimic Mail** |

**If that didn't work.** File it on the console with the **verbatim log line
attached**. A callout bug without a verbatim line is not actionable — that is
exactly why "#169 Death Touch not captured when the victim is a PET" is still
open.

**After.** If you changed a pattern, note it. Guild triggers propagate on the
10-min poll — tell the raid the callout is back rather than letting them
discover it at the next pull.

**Don't.**
- **Don't loosen a pattern without the verbatim line.** Widening the Death Touch
  victim group blind risks *eating real Death Touches*.
- **Don't bulk-fix all 29 dead anchors mid-raid-week.** A bulk un-mute of 29
  callouts is its own incident. Reviewed batch, one confirmed line each.
- **Don't trust a green Rehearse as proof the pattern matches.** It isn't.
- **Don't** conclude "TTS is broken" from one machine. It's per-machine far more
  often than not.

---

### RB-02 — "Parses are missing / the numbers are wrong"

**Symptom.** A fight has no parse card; or the card exists but someone's damage
is absurd, a name is on it who wasn't there, or the total exceeds the boss's HP.

**Grounded in.** The auth-blip P0 (2026-07-17): `_resolveSessionToken` couldn't
distinguish "query failed" from "token not found", so during a Supabase 5xx
window valid agents got 401 — **and the agent's durable queue drops 4xx as
permanent.** A blip became permanent fleet-wide data loss. The 2026-07-13 409
storm. The 2026-07-30 charm-pet corruption (Jankzer top DPS while mezzing;
Bardtholemu 3.05M; encounter total 70k past the boss's HP pool). The `#134`
death over-count. Lord of Ire's split-vs-knit dedup.

**Branch first: MISSING or WRONG?** They have completely different causes.

#### Branch A — nothing landed

**How you tell.**
1. Console → **Parses landing** (freshest `encounters.started_at`) and **Ingest
   heartbeat** (freshest `agent_upload_stats.last_uploaded_at`).
   - Ingest fresh but no encounters → the *encounter* path specifically. Go to 3.
   - Ingest also stale → it's platform-wide. **→ RB-03.**
2. Console → **Upload errors** — uploaders whose `last_ok=false`, grouped by
   `last_status_code`.
   - **401/403 across many uploaders** → this is the auth-blip signature. The bot
     fix (503-not-401) shipped 2026-07-17, but if you ever see it again: **it is
     an emergency**, because every agent behind it is *dropping* those payloads
     permanently, not retrying.
   - **429** → admission control. Check `budget_enforce_*` and
     `budget_<kind>_per_min` (SQL/MCP today — see §7.2 for why this needs UI).
   - **5xx** → bot or Supabase. → RB-03.
3. Console → **Queue backlog**: max `last_agent_state.queuePending` across
   uploaders. A raid-wide backlog means Discord or Supabase is slow; the queue is
   doing its job and will drain. Tell people **not** to restart Mimic (the
   restart is fine — the queue is durable — but the panic isn't).
4. Confirm the fight was even *eligible*: `raidNight.parseCardPassesFilter` gates
   the **night-thread copy** on ≥15s and ≥3 players for non-boss mobs. The Parse
   Log embed and Supabase **always** get every encounter — so "no card in the
   night thread" ≠ "no parse".

**Do this.** Nothing, usually — the durable queue recovers on its own. If the
data is genuinely gone, file a **backfill request** (`/admin/encounters` →
backfill) and have that raider re-run the agent with `--since`;
`find_or_create_encounter` dedups, so a re-submission attaches instead of
duplicating.

#### Branch B — it landed and it's wrong

**How you tell.** `/admin/encounters` HP-vs-damage: a total ≫ the catalog HP is
the tell. `/parses/[id]` shows per-contributor rows — a *single* uploader
carrying the anomaly is the 2026-07-30 signature.

**Do this.**
1. Identify the bad uploader (per-contributor rows). → **RB-04**.
2. Mark the encounter incomplete or merge duplicates: `/admin/encounters`.
3. If damage is credited to a pet or a phantom name, check the 🐾 Charmed field
   on the parse card — it lists which charm pets split to whom.
4. Repair is a **service-role SQL edit** with the original preserved
   (precedent: `players_pre_petfix`, 2026-07-31). Not a console button. Ever.

**After.** Anything repaired by hand goes in `STATUS.md`. The 2026-07-31 repair
is only auditable because it was written down.

**Don't.**
- **Don't tell people to clear their upload queue.** It is the durable record.
- **Don't shed `encounter`.** You can't — `_SHED_NEVER` refuses it — and that
  refusal exists precisely so this instinct can't do damage.
- **Don't re-run a merge to "fix" numbers** without knowing which uploader was
  wrong: `merge_encounter_players` takes max-damage-per-player, so a bad
  submitter wins the merge.

---

### RB-03 — "Everything is frozen"

**Symptom.** Overlays blank, no parse cards, chat not relaying, the site won't
load — all at once, mid-raid.

**Grounded in.** 2026-07-13: Supabase **GoTrue** returned 504s (site-wide
`MIDDLEWARE_INVOCATION_TIMEOUT`) while **Postgres stayed healthy** — a single
"is it up?" ping could not tell those apart, which is why `/api/health` now
probes them separately. Same night: **web pushes were restarting the bot**
(fixed by `railway.toml` watchPatterns) and mid-raid restarts amplified the
queue backup and announcer spam — which is where the deploy freeze came from.

**How you tell — the triage order matters, and it is not the obvious one.**

1. **Is it just one machine?** Ask a second raider. Overlays are local; a single
   blank HUD is a Mimic problem (→ RB-07), not an outage. **Do this first** —
   it's free and it's the answer more often than not.
2. **Discord bot alive?** Any bot slash command (`/timers`). Discord itself is
   independent of Supabase.
3. **wolfpack.quest/api/health** → `{checks:{auth, db}}`. This is the 2026-07-13
   discriminator:
   - `auth: down`, `db: ok` → **GoTrue**. The site's sign-in wedges; **the raid
     does not care** — agents authenticate through the bot with their own bearer
     tokens. Do nothing but say so in `#raid-chat`.
   - `db: down` → Supabase Postgres. Everything analytical stops. The bot's
     circuit breaker will already be open (see 4).
   - both ok → it's the bot or the fleet.
4. **The bot's own view**: `GET <bot>/health` → `{ready, shutting_down,
   supabase_breaker, budgets}`. `ready:false` means the container is booting or
   draining; `supabase_breaker` open means the bot has stopped hammering a dead
   DB on purpose. (Console shows this via the proposed heartbeat row, §7.2 — until
   then, infer from ingest freshness: **if any agent uploaded in the last 5
   minutes, the bot is up**, because the bot is what writes those rows.)
5. **Was there a deploy?** Railway shows the merge commit message as the deploy
   name. A deploy inside Sun/Wed/Thu 19:30→00:30 ET should never have happened
   (`raid-freeze.yml` turns it red but **cannot stop it** — Railway/Vercel deploy
   on push regardless).

**Do this.**

| Diagnosis | Action |
|---|---|
| GoTrue only | Nothing. Say so. Sign-in returns on its own. |
| Postgres down | Nothing to pull — the breaker already backed off. Announce via **Mimic Mail (critical)**, which also posts to Discord. Parses queue durably on every agent and land when it returns. |
| Bot restarting | Wait one healthcheck. Do **not** push anything. |
| Bot up but drowning | Shed the **ephemeral** streams in this order: `live_state` → `raid_roster` → `casting` → `threat_snapshot` → `buff_casts`. Each is 200-ack-and-drop, reversible, ~60s to take effect. **Never touches parses or chat.** |
| Genuinely unknown, fleet suspected | `flag_agent_kill=1` is the last resort. It is **safe by design** — queues hold, nothing drops, overlays keep running on local data, and clearing it resumes within one heartbeat. But it makes the raid blind to everything cross-client. Two-step confirm; tell the raid first. |

**If that didn't work.** A fix that must ship *now* → **RB-08**.

**After.** Clear every shed flag. The drift panel will nag, but clear them
deliberately — a shed stream that stays shed is a feature quietly dead.

**Don't.**
- **Don't push to `main` to fix it** unless the commit message contains
  `[hotfix]` and you have decided the restart is worth it. A restart mid-raid is
  what *amplified* 2026-07-13.
- **Don't add a second bot replica.** Two gateway sessions double-post every
  Discord message. Horizontal scaling is not available here; admission control is.
- **Don't shed `encounter`/`chat`/`bosskill`/`lockout`/`historical_chat`.** The
  bot will refuse; the instinct is the bug.

---

### RB-04 — "One agent is poisoning the data"

**Symptom.** One raider's uploads carry impossible numbers, or one elected
reporter has silently stopped covering its stream, or someone is on an agent
version old enough to be missing a correctness fix.

**Grounded in.** 2026-07-30: exactly **one corrupted uploader per fight**
(whoever's stale `petOwners` residue matched that fight's mob names) — Hawkner on
Blood, Bardtholemu 3.05M, Uilnayar at 01:05. 2026-07-19: **one** elected chat
reporter heartbeating while its character was logged out darkened guild chat for
8.5 hours. Today: 9 agent versions across the fleet in 7 days, oldest
still-active **3.4.22**.

**How you tell.**
1. Console → **Fleet versions**: distinct `agent_version` among uploaders active
   in 7d, oldest first, with the version floor drawn on it.
2. Console → **Upload errors**: uploaders with `last_ok=false`, newest first.
3. `/parses/[id]` per-contributor rows: is the anomaly one submitter or all of
   them?
4. Mimic → 🛡 Admin → **📡 Reporters**: per uploader — character, zone, group,
   version, camping, **last-line age**, fresh. A reporter that is *elected* but
   *stale* is the 2026-07-19 shape.

**Do this — least-blast-radius first.**

| Situation | Lever | Where |
|---|---|---|
| Elected reporter stale/wrong | **Swap the pin** to a live+fresh character, or **add an include** | Mimic 📡 Reporters (`reporter_pin_<svc>` / `reporter_extra_<svc>`) |
| Fleet-wide correctness bug fixed in a newer agent | **`min_agent_ver_num`** — below-floor agents stand down + get an update nudge | `/admin/overlays` 🛑 / Mimic 🛑 — **typed confirm; a wrong digit stands the whole fleet down** |
| One uploader flooding a *stream* | `budget_<kind>_per_min` (per-uploader×kind) | SQL/MCP today (§7.2) |
| One uploader corrupting *encounters* | **No lever exists.** See §7.2 — proposed `uploader_quarantine`. Today: repair after the fact + ask them to update/restart. |
| Uploader is compromised / must stop entirely | `/token` → **Revoke** their session | Discord. **Nuclear** — it logs them out of Mimic. Talk to them first. |

**If that didn't work.** Repair the data (RB-02 branch B) and file the root
cause. "Restart Mimic" is a legitimate ask — it clears in-memory residue like
`petLeaders` — and it costs nothing, because the queue is durable.

**After.** Clear any pin you set. A pin that is dead/stale is *ignored*
(fail-open) so a forgotten pin isn't dangerous — but it hides the fact that the
election is being overridden.

**Don't.**
- **Don't revoke a token as a first move.** It removes a raider from the raid's
  data entirely and they have to be re-onboarded.
- **Don't set a version floor mid-raid** unless the below-floor behavior is
  actively worse than having those raiders dark. Standing agents down mid-fight
  removes their overlays' cross-client data.
- **Don't pin `encounter`/mob streams.** You can't — per-observer streams are
  structurally never elected — and that is correct.

---

### RB-05 — "Guild chat stopped reaching Discord" *(outline)*

**Symptom.** `#guild-chat` silent while the raid is visibly playing.
**Grounded in.** 2026-07-19, dark 6:43am–3:16pm: the single elected chat
reporter's *agent* kept heartbeating while its *character* was logged out. The
PvP feed (not election-gated) posted all day, which is exactly why nobody
noticed the fleet was fine and one stream was dead.
**How you tell.** Console → *Chat relay* freshness vs *Ingest heartbeat*: chat
stale **while ingest is fresh** is the signature. Mimic 📡 Reporters →
elected chat reporter's **last-line age**.
**Do this.** (1) Set `dedup_chat = 0` — instant fail-open, everyone uploads,
bot's 10s dedup collapses the duplicates. (2) Or swap the pin to a live+fresh
character. (3) Confirm chat resumes within ~60s.
**Open item.** `dedup_chat` is **still 0, 14 days on**. #112's liveness +
zone-spread fix was built to make re-enabling safe and the fleet has long since
passed agent 3.3.91. Re-enable procedure: `BETA-TESTING.md` #112 §"Re-enable
procedure". Doing this is a **deliberate, non-raid-night** action.
**Don't.** Don't re-enable during a raid. Don't conclude the fleet is broken
because one stream is — check a non-elected stream (PvP, live-state) first.

---

### RB-06 — "Mimic won't update / a bad build is out there" *(outline)*

**Symptom.** "Update check failed: No published versions on GitHub", or a
release that crashes on launch, or beta testers stuck.
**Grounded in.** 2026-07-30: 14 Linux/Deck builds in two days pushed
`v2.1.1-beta.2`, `-beta.1` and `v2.1.0` out of GitHub's **10-entry**
`releases.atom` window, and beta clients — which walk that feed — found only
`linux` tags. The whole Windows beta channel could not update. Stable was spared
only because it resolves via `/releases/latest`. 2026-07-09: parking beta at or
below stable makes prereleases semver-sort below stable and the updater stops
offering them.
**How you tell.** GitHub releases list — count non-`linux` entries in the newest
10. Console → *Fleet versions* — are beta testers frozen at one version?
**Do this.** (1) Feed starvation → run `prune-linux-releases.yml` (it also runs
at the end of every Linux build now). (2) Beta parked wrong → re-park **above**
stable. (3) Bad build crashing → Mimic's **LKG auto-rollback** already handles a
crash-loop (restores last-known-good, blacklists the version); confirm via the
tray notice. (4) Bad build that *doesn't* crash → `min_agent_ver_num` floors the
agent half; the shell half needs a new release. (5) Tell people:
**Mimic Mail (critical)** reaches every Mimic version ever built.
**Don't.** Don't merge the Deck working branch to `beta` to "ship the fix" —
cherry-pick the feature commits (CLAUDE.md). Don't let Deck iteration fill the
feed again.

---

### RB-07 — "A raider can't get Mimic/Zeal working" *(outline)*

**Symptom.** No overlays, no Zeal, "it says I'm not signed in", no logs.
**Grounded in.** In-EQ-folder installs break Zeal DX-hook detection — and
`detectEqDir()` *supports* in-folder installs for log detection, so the product
steers people into the layout that breaks it. Elevation mismatch (EQ as admin,
Mimic not) = connect-then-close with **no error**. `Log=TRUE` not set. Token
lockouts. Release-announce DMs failed for 15 of 26 members (50007 = DMs off).
**The script, in order.** (1) **Settings → "Set up for me"** — writes
`Log=TRUE` + Zeal's `PipeVerbose`/`ExportOnCamp`/`PipeDelay` across every known
EQ folder. Must be done with **EQ closed** (EQ rewrites `eqclient.ini` from
memory on exit). (2) Zeal health overlay / dashboard Zeal card. (3) Is Mimic
installed **inside** the EQ folder? → reinstall outside. (4) Is EQ running as
admin? → run Mimic as admin too. (5) `/token` → mint; officers can use
`/token for:@member` when they can't run it themselves. (6) DMs off →
`#mimic-releases` instead.
**Don't.** Don't debug Zeal by hand before the Zeal-health card and the 🐺 Charm
diagnostic card — they walk the checkpoints for you.

---

### RB-08 — "It's raid night and this has to ship" *(outline)*

**Symptom.** Something is broken *now* and the fix is a code change.
**Grounded in.** Hitya 2026-07-13. Any `main` push restarts production
surfaces the raid depends on.
**Decide first: does it *have* to ship?** A tuning flag, a guild-trigger row, a
Mimic Mail notice, and a reporter pin all take effect in 60s–10min **with no
deploy**. Reach for those first — that is what the whole control plane is for.
**If it must ship.** (1) `[hotfix]` in the commit message — required for
`raid-freeze.yml` and, more importantly, it marks the push as deliberate.
(2) Know what restarts: **bot** = `main` touching bot paths (Railway);
**web** = `main` touching `web/` (Vercel; `railway.toml` watchPatterns keep this
from bouncing the bot); **Mimic/agent** = `beta`, pull-based, safe any time.
(3) Announce in `#raid-chat` before, not after.
**Don't.** Don't merge with `--no-edit` — Railway shows the merge commit message
as the deploy name. Don't stage unrelated work into a hotfix.

---

### RB-09 — "The night thread is in the wrong channel / missing" *(outline)*

**Grounded in.** 2026-07-31: the v2 parent chain (`RAID_NIGHT_THREAD_PARENT_ID`
→ `RAID_CHAT_CHANNEL_ID` → the known #raid-chat id → `TIMER_CHANNEL_ID`) exists
because v1 stopped at `RAID_CHAT_CHANNEL_ID`, unset on Railway, so night one's
threads landed in #raid-mobs.
**How you tell.** Bot logs `[raid-night] parent …` for every rejected candidate.
**Do this.** Resolution order is env pin → memory → `channelSlots.rn_<key>` →
an open `/raidnight` session → **an active thread with the same name** → create.
That name-match is how it recovers from volume loss — so an existing correctly-named
thread gets adopted. Set `RAID_NIGHT_THREAD_PARENT_ID` to fix permanently;
`RAID_NIGHT_THREADS=0` disables. **The canonical parse record never moves** —
`PARSES_LOG_THREAD_ID` always gets the JSON embed, so a misplaced night thread
is cosmetic, never data loss.

---

### RB-10 — "The loot/DKP didn't show up" *(outline)*

**Grounded in.** #138: OpenDKP upserts 500'd with PG 21000 whenever a batch
carried ≥2 rows sharing the conflict key — the **whole batch** silently never
mirrored. #110 "Backpack": 3 awards deleted in OpenDKP still showed on the site
because `opendkp_loot` was append-only and `_raidNeedsDetail` stopped re-fetching
settled raids.
**How you tell.** `/admin/audit` + the site's loot surfaces vs OpenDKP itself.
**Do this.** `/syncopendkp` (add `full:true` to reconcile every raid). The
reconcile fails **safe**: it never deletes for a raid whose fetch errored, and
aborts its deletes if the removal set exceeds `max(20, 25% of scanned)`.
**Don't.** Don't hand-edit the mirror — it's a mirror; fix upstream and re-sync.

---

### RB-11 — "A callout is spamming the raid" *(outline)*

**Grounded in.** Ghost callouts (relays ride the durable FIFO; the bot serves
fires for 60s from `posted_at`, so a backlog speaks stale callouts as if live).
The Cleric-hammer-pet Death Touch false positive. A failing `voice` action used
to make the agent retry forever.
**Do this.** (1) Disable the row on `/admin/triggers` — 10-min poll. (2) Faster:
`flag_shed_trigger_relay` kills only the *cross-client replay* (local callouts
still fire) — 60s. (3) TTS ripcord: `/admin/voice` master enable + skip patterns.
(4) Tell the raid.
**Don't.** Don't shed the whole trigger path hoping to catch one bad row —
`trigger` ingest is not sheddable, only the relay fan-out is.

---

### RB-12 — "The board / timers are wrong" *(outline)*

**Grounded in.** PvP-event lockouts named for the war gods ("Tallon Zek" /
"Vallon Zek") name-matched Plane of Tactics bosses and synthesized timers onto
the PoP-locked board (2026-07-13). Every manual clear path is itself PoP-locked,
so an officer *couldn't* remove them — hence the startup sweep.
**Do this.** `/updatetimer`, or `/restore <message links>` (rebuild from Discord
cards — the latest `nextSpawn` per boss wins across pasted messages), or
`/recoverkills` (rebuild from Supabase encounters, default 72h, dry-run
supported). Post-redeploy stale alerts are suppressed on purpose.
**Note.** PoP is locked until `2026-10-01`; after unlock, run `/board` and
refresh `pqdiUrl`s via `/addboss`.

---

## 5. The console

### 5.1 Route and gate

`/admin/console`. Officer gate is **inherited**, not invented — `web/app/admin/layout.tsx`
already redirects non-officers, and `lib/officer.ts` `isOfficer()` is the
per-request check. Server actions re-check `isOfficer()` on every write, exactly
like `/admin/overlays` `saveOverlayTuning`. **No new gate. No new env var.**

### 5.2 The health signal set

Chosen so that **every red is actionable and points at exactly one runbook.**
A signal that can't be acted on is noise, and noise is how a board gets ignored.

| # | Signal | Source | Amber | Red | → |
|---|---|---|---|---|---|
| S1 | **Ingest heartbeat** | `max(agent_upload_stats.last_uploaded_at)` | >10m | >30m **in a raid window** | RB-03 |
| S2 | **Fleet now** | distinct characters w/ upload in 15m | < half the raid | 0 in a raid window | RB-03/04 |
| S3 | **Chat relay** | `max(chat_messages.ts)` | >30m in-window | >60m in-window **while S1 is fresh** | **RB-05** |
| S4 | **Parses landing** | `max(encounters.started_at)`, count today | none yet, >30m into raid | none, >60m into raid | RB-02 |
| S5 | **Live state** | `max(character_live_state.updated_at)` | >5m | >15m while S1 fresh | RB-03 |
| S6 | **Upload errors** | rows `last_ok=false` in 24h, grouped by `last_status_code` | any | ≥3 uploaders sharing a code (esp. **401/403**) | RB-02/04 |
| S7 | **Fleet versions** | distinct `agent_version` active in 7d | >4 versions | any below `min_agent_ver_num` | RB-04/06 |
| S8 | **Control-plane drift** | `overlay_tuning.tuning` vs default | any control key set | set **>7d**, or `flag_agent_kill=1` | **§5.3** |
| S9 | **Site** | `GET /api/health` | `degraded` | `auth` or `db` down | RB-03 |
| S10 | **Backlog** | pending `agent_backfill_requests`; max agent `queuePending` | >0 pending | >25 pending, or queue depth >500 | RB-02 |
| S11 | **Trigger set health** | enabled `guild_triggers`; count with `pattern LIKE '^%'` | — | **any** `^`-anchored | **RB-01** |
| S12 | **Last Mimic Mail** | `max(mimic_notices.created_at)` | — | — | informational |

**"Raid window"** = the schedule the rest of the platform already uses
(Sun/Wed/Thu 19:30→00:30 ET). Outside it, every freshness amber/red **downgrades
to grey "quiet"** — a stale chat relay at 4am is not an incident, and a board
that cries wolf overnight is a board nobody reads on Thursday.

**S11 deserves emphasis.** It is a pure predicate over data we already have, it
catches a class of failure that is *invisible to both existing test surfaces*
(Rehearse strips anchors), and it is red **right now** at 29/101.

### 5.3 The drift panel — the anti-rot device for *state*

A dedicated card: **every control-plane key currently set, with its age, who set
it, what it does, the runbook it came from, and a Clear button.**

Two classes, and the distinction is load-bearing:
- **Control keys** (`flag_*`, `min_agent_ver_num`, `budget_*`, `dedup_*`,
  `reporter_pin_*`, `reporter_extra_*`) — default is *absent*. Any of these being
  set is **drift**: someone mitigated something. Show age. Nag past 7 days.
- **Config keys** (`ext_*`, `offheal_*`, `ch_*`, `hide_main_names`,
  `agent_release_ref_beta`) — intended, permanent. Show as *configured*, never
  as drift.

Today this panel would read:

> ⚠ **1 control-plane override active**
> `dedup_chat = 0` — set **14 days ago**. Chat reporter dedup is OFF; every agent
> uploads chat. This was the 2026-07-19 blackout mitigation. **RB-05** ·
> *re-enable procedure: `BETA-TESTING.md` #112.* — [Clear] [Keep, remind in 7d]

That single card is the highest-value thing in this design.

### 5.4 Runbook cards

Rendered from `web/lib/runbooks.ts` (typed catalog, §8). Each card:

- Title + symptom, collapsed by default (open on `#rb-01` deep-link so Discord
  links land on the right one).
- A live **status chip** from its signals — a runbook whose signals are red rises
  to the top of the list.
- **Grounded in** — the dated incident. A runbook with no incident is a guess and
  is labeled `speculative`.
- Numbered steps; each step carries **either** a link to the existing surface
  **or** an inline action button, by safety class (§5.5).
- **Don't** block rendered in red. This is the part that gets lost when knowledge
  moves by word of mouth, so it gets the loudest treatment.

### 5.5 Button safety classes — what's one click and what isn't

The governing question is *what does an accidental click cost, and how fast is
it undone?*

**Class A — one click, no confirm.** Reversible in ≤90s, blast radius one
stream or less, and the failure mode is "some data is briefly missing", never
"the raid is blind".
- Clear any `flag_shed_*` · clear a `reporter_pin_*` / `reporter_extra_*` ·
  clear `dedup_*` back to default · toggle `flag_raid_hold` · re-run the pre-raid
  health check · open a runbook.

**Class B — typed confirm (two-step).** Fleet-scale, or a value where a typo is
worse than the action.
- **`flag_agent_kill`** — silences every agent. Mimic already requires a typed
  confirm here; the web must match. Confirm string: `PAUSE FLEET`.
- **`min_agent_ver_num`** — a wrong digit stands the *whole* fleet down. Confirm
  by re-typing the number **and** showing "this will stand down N of M currently
  active agents" computed from live version data *before* the write.
- **Set** (as opposed to clear) any `flag_shed_*` — dropping a stream mid-raid is
  a real decision.
- **`flag_disable_budgets`**, **`budget_enforce_*`** — turning a durable kind's
  over-budget from log-only into real 429s. The fleet must be on agent ≥3.3.85
  (honors `Retry-After`) first; the console should *check that from live version
  data* and refuse otherwise.
- **Revoke an agent session** (`/token`) — it logs a raider out of Mimic.

**Class C — not a button, deliberately.** The console shows the procedure and
the link; the action happens somewhere with more friction.
- Anything touching `_SHED_NEVER` streams (the bot refuses anyway — belt and
  braces).
- **Bulk trigger enable/disable.** The 29 dead anchors *must* be fixed in a
  reviewed batch, one confirmed log line each. A "fix all" button is an incident
  generator. (`STATUS.md` says this in as many words.)
- Any data repair / delete. Precedent is service-role SQL with the original
  preserved (`players_pre_petfix`).
- Anything requiring a deploy.
- **Mimic Mail composition** stays on `/admin/notices` — the console links to it
  pre-filled. Broadcasting to every Mimic deserves the page that's designed for it.

**Class D — needs Hitya's sign-off before it exists at all.** See §7.2.

### 5.6 Where the console does *not* go

- It does not replace `/admin/overlays` — free-form numeric knobs stay there
  (that's already the `_FLAG_OVERRIDE_KEYS` boundary the bot enforces).
- It does not replace `/admin/agents` — the per-character fleet table is fine
  where it is; the console shows the *aggregate* and deep-links.
- It does not add a Discord command. The pre-raid check already posts to Discord;
  it should carry the console link (one-line change, §7.2).

---

## 6. Interaction with #80 (Raid Night Review)

Per the fleet charter: #80 owns the raid-night *data* (the review generator + its
Discord post); #87 owns `/admin` console pages. **No shared files.** The one
place they touch conceptually is that a Raid Night Review is the natural home for
"what broke last night" — so the console's drift panel and the Review's incident
line should eventually reference each other. Deliberately **not** built here: the
console must not grow a second review generator.

---

## 7. Controls: what mirrors, what moves, what's new

### 7.1 Nothing moves

Officers have muscle memory, and the mid-raid surface (Mimic 🛡) is the one that
actually gets used under pressure. Moving levers to a new page would break the
first and not help the second. The console **mirrors**: it reads the same
`overlay_tuning` row, writes through the same read-modify-write, and links out
for anything it doesn't own. Three surfaces, one source of truth.

### 7.2 New levers — proposed, NOT built

| # | Proposal | Why | Size | Needs |
|---|---|---|---|---|
| **N1** | **Bot heartbeat row.** Bot upserts `bot_kv['health_snapshot']` every ~60s with `{ready, uptime_s, version, discord_ping_ms, supabase_breaker, budgets, deployed_at}` | Today the console cannot distinguish "bot down" from "quiet night" without a cross-service HTTP call — and `BOT_BASE_URL` on Vercel is a **documented repeat foot-gun** (`opendkp-actions.ts` migrated *away* from it for exactly this reason). `bot_kv` needs no env var and staleness of the row *is* the down signal. | ~25 lines, `index.js` | Bot change — **not taken in this pass** (charter: #171 owns `index.js`) |
| **N2** | **Flag expiry.** `flag_expires_<key>` (ISO string) in the same tuning jsonb; `_overlayTuningMap()` drops a flag past its expiry | The direct fix for `dedup_chat` sitting at 0 for 14 days. Mitigations should default to temporary. String tuning keys are precedent (`hide_main_names`, `reporter_pin_*`, `agent_release_ref_beta`). | ~15 lines bot + UI | Bot change + Hitya (does an auto-revert mid-raid scare anyone?) |
| **N3** | **Per-uploader encounter quarantine.** `uploader_quarantine` (comma discord-ids); the encounter handler still **stores** the contribution but stamps `contributions.quarantined=true` so `merge_encounter_players` skips it | 2026-07-30's failure was per-uploader, and there is **no lever for it**. Budgets are per-kind; token revoke is nuclear. Quarantine is reversible (clear the flag, re-run the merge) and **lossless** — which is why it must be *quarantine*, not drop. | ~40 lines bot + RPC arg | **Hitya's call.** This is the one proposal that touches the durable parse path. |
| **N4** | **Budget UI.** Surface `budget_<kind>_per_min` / `budget_enforce_<kind>` / `flag_disable_budgets` on the console (Class B) | They're in `_FLAG_OVERRIDE_KEYS` (Mimic can write them) but have **no web UI** — SQL-only. That's an inconsistency, not a design. | small, web-only | — |
| **N5** | **`flag_raid_hold` on the web.** It's in `_FLAG_OVERRIDE_KEYS` and on Mimic's card, but missing from `/admin/overlays` | Same inconsistency. | tiny, web-only | — |
| **N6** | **Console link on the pre-raid Discord line** | The 19:30 post is the one time an officer reliably looks. Append `wolfpack.quest/admin/console`. | 1 line, `index.js` | Bot change |

**Explicitly NOT proposed:** new shed kinds (the set is complete), a second kill
switch, a "restart the bot" button (Railway owns that, and a mid-raid restart is
the 2026-07-13 amplifier), or *any* console path to shedding a `_SHED_NEVER`
stream.

### 7.3 Proposed SQL — **not applied** (coordinator/local session applies)

The console as designed needs **no schema change** — every signal reads an
existing table. The only optional additions are index hygiene for the aggregate
queries:

```sql
-- OPTIONAL, not required. The console's freshness reads are max()/count() over
-- tables the admin pages already scan; these make them cheap enough to run on
-- every page view without a cache.
-- File: supabase/migrations/YYYYMMDDHHMMSS_officer_console_indexes.sql

create index if not exists agent_upload_stats_last_uploaded_idx
  on public.agent_upload_stats (last_uploaded_at desc);

create index if not exists agent_backfill_requests_status_idx
  on public.agent_backfill_requests (status, requested_at desc);
```

`chat_messages`, `encounters`, `character_live_state` are already indexed on
their time columns by the existing member surfaces.

**If N1 (bot heartbeat) is taken**, it needs **no migration** — `bot_kv` already
exists with the right shape and is service-role-only, which is exactly right for
a health snapshot.

**If N3 (quarantine) is taken**, it needs one column and the merge RPC updated:

```sql
-- ONLY IF Hitya approves N3.
alter table public.contributions
  add column if not exists quarantined boolean not null default false;
create index if not exists contributions_quarantined_idx
  on public.contributions (encounter_id) where quarantined;
-- merge_encounter_players() then adds `and not c.quarantined` to its source scan.
```

---

## 8. How runbooks stay true (the rot problem)

This repo has an explicit, earned position on doc rot — CLAUDE.md: *"a stale
index causes exactly the wrong 'we don't have it' answer (the eqclient/zeal 'Set
up for me' miss, 2026-07-19)"* — and an enforcement precedent:
`check-agent-dashboard.js` **fails the build** on an emitted `<details>` without
`wpKeep(`. "This rule is enforced, not advisory."

Runbooks rot the same way and worse: a runbook that names a flag that no longer
exists is *actively harmful at 21:40*. Four defenses, in decreasing strength:

**D1 — Runbooks are data, not prose.** `web/lib/runbooks.ts` is a typed catalog.
Every step that references a lever declares it structurally:
`{ kind: 'flag', key: 'flag_shed_live_state' }`, `{ kind: 'route', href:
'/admin/triggers' }`, `{ kind: 'command', name: 'recoverkills' }`,
`{ kind: 'doc', path: 'docs/BETA-TESTING.md#112' }`. Prose is only in the fields
that *are* prose.

**D2 — A test asserts every reference still resolves.** `test/runbooks-catalog.test.js`
(root vitest, imports the `.ts` catalog directly — the existing pattern from
`test/raid-kit.test.js`):

- every `flag` key appears in `index.js`'s `_FLAG_OVERRIDE_KEYS` **or** in
  `/admin/overlays`'s `FLAGS`/`VERSION_FLOOR_KEY`;
- every `route` has a real `web/app/**/page.tsx`;
- every `command` has a real `commands/<name>.js`;
- every `doc` path exists on disk;
- every runbook has a non-empty `groundedIn` **or** is explicitly
  `speculative: true`;
- every runbook id referenced by a health signal exists, and vice-versa
  (no orphan signals, no runbook with no way to notice it).

**This is the load-bearing defense.** Rename a flag and CI tells you which
runbook lies now. It is the same trick as `check:dashboard`, applied to
knowledge.

**D3 — Provenance is mandatory.** `groundedIn: [{ date, what, where }]`. The
ranking in §3 *is* those receipts. A runbook nobody can date is a guess, and the
console labels it as one. This also keeps the set from bloating with imagined
failures — the fastest way to make a runbook set useless is to make it long.

**D4 — Review pressure, not review process.** Each runbook carries
`lastReviewed`. The console sorts stale ones down and shows the date; it does
**not** block on it. A mandatory quarterly runbook review is a process nobody in
a 60-person EQ guild will keep. What actually keeps these true is D2 firing in
CI plus the habit CLAUDE.md already enforces: *when a feature ships, refresh its
`HOW-ITS-BUILT.md` entry* — extended to *"if it changed how an officer fixes
something, touch the runbook."*

---

## 9. What phase 1 ships

Additive, web-only, zero bot changes, zero migrations.

| File | What |
|---|---|
| `web/lib/runbooks.ts` | Typed catalog. RB-01…RB-04 full; RB-05…RB-12 outlined, all with `groundedIn` and structured lever refs |
| `web/lib/consoleHealth.ts` | Pure signal evaluation: raid-window awareness, thresholds, signal→runbook mapping. No I/O — testable |
| `web/app/admin/console/page.tsx` | Server component: health board, drift panel, runbook cards |
| `web/app/admin/console/actions.ts` | Server actions — Class A clears + Class B confirms; same `overlay_tuning` read-modify-write as `/admin/overlays`, `isOfficer()` re-checked per write |
| `web/app/admin/page.tsx` | One Card added |
| `test/runbooks-catalog.test.js` | The D2 anti-rot test |

Deferred to phase 2 (each needs a bot change or a decision): N1 heartbeat row,
N2 flag expiry, N3 quarantine, N6 pre-raid Discord link.

---

## 10. For Hitya

1. **`dedup_chat` has been 0 for 14 days.** #112 shipped the liveness +
   zone-spread fix specifically so it could go back on, and the fleet passed
   3.3.91 long ago. Re-enable (non-raid-night), or decide "everyone uploads
   chat" is the permanent answer and delete the re-enable procedure from
   `BETA-TESTING.md` so it stops looking undone. **Either is fine; the current
   state is the only bad one.**
2. **29 of 101 enabled guild triggers are structurally dead.** Confirmed live.
   Needs a reviewed batch (one real log line per row), *not* a bulk fix. Who
   owns it and when?
3. **92 pending backfill requests.** Is that queue meant to be drained, or is it
   a graveyard? If the latter, the console should show it as "informational" and
   `/admin/agents` should say so.
4. **Which destructive levers deserve a confirmation step?** My proposal is §5.5:
   typed confirm on `flag_agent_kill` (matching Mimic), `min_agent_ver_num`,
   *setting* a shed flag, `budget_enforce_*`, and token revocation; one click for
   every *clear*. **Rationale: clearing a mitigation should always be easier than
   setting one.** Say if you want the bar higher or lower.
5. **N3 (per-uploader encounter quarantine)** — the only proposal that touches
   the durable parse path. It is designed to be lossless and reversible, but
   `_SHED_NEVER` exists because we decided nobody should be able to switch parse
   collection off. Quarantine is narrower than that, but it is the same family.
   **Your call whether it exists at all.**
6. **N2 (flag auto-expiry)** — should a mitigation flag be able to expire on its
   own? It fixes item 1 permanently, but an auto-revert mid-raid is a surprise.
   My suggestion: expiry allowed, but never fires inside a raid window — it waits
   for the window to close.
7. **Naming.** Per CLAUDE.md, release names are yours. "Officer console" is
   descriptive, not a name.
