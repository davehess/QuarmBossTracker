# Hosting, database & costs

Supabase, Railway, Vercel, the home server, retention, the self-host wizard. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/1 — Storage / data
*2026-08-07 · DECISIONS-2026-08-07.md · Keep threat snapshots only for raid activity*

**Threat snapshots are gated to raid activity.** Keep a snapshot when it names
a boss, OR it is raid time and 8+ players are in the fight
(`THREAT_SNAPSHOT_MIN_GROUP`). Trash pulls during a raid are deliberately IN —
"we can still include trash when we're all together". Off-hours duo camping is
out: measured at 54% of the payload, answering nothing. Named bosses are kept
regardless of clock, so off-night kills still count.
→ bot 3.1.32+, `_handleAgentThreatSnapshot`.

**Threat data links to raid nights.** `raid_night_id` on both snapshots and the
roll-up, using the platform's 06:00-ET rollover, so a 00:30 Thursday pull
belongs to Wednesday's raid.

**Roll-up keys on `(boss_name, started_at)`, never `encounter_id`.**
`encounter_id` is assigned at fight END by `find_or_create_encounter`, so it is
NULL on 99.3% of snapshots. A first attempt keyed on it silently summarised
0.7% of the table and missed King Tormax, Aten Ha Ra and Diabo Xi Xin Thall.
**If you ever join threat data on `encounter_id`, you are reading a 0.7%
sample.**

**Unchanged scoreboards are not stored.** Consecutive snapshots were routinely
byte-identical (same totals six seconds apart). Bot-side content hash, sorted
keys — the agent rebuilds `per_player` per upload and raw `JSON.stringify`
order varies, so hashing unsorted would never hit.

**Chat history stays in Postgres.** Not moving `chat_messages` to object
storage; ~79 MB/year is a decade from mattering.

**OpenDKP mirror: closed raids barely change.** Re-upsert a raid only when its
upstream `Version` moves. Ticks/DKP/attendance corrections still flow.
*Not yet implemented* — `opendkp_raids` and `opendkp_auctions` are still
rewriting themselves (1.5M and 3.7M updates).

**Threat snapshot raw retention: still undecided.** Default is 120 days and the
comment justifying it estimates ~7 MB/week against an actual ~90 MB/week.

## 2026-08-10/11 — Local wolfpack.quest: Coolify in a VM, pointed at the LOCAL Supabase (guild lead, 2026-08-11)
*2026-08-10 · DECISIONS-2026-08-10.md · Local site in Coolify VM, local database*

Two calls. **Coolify runs in an Unraid VM**, not on bare Unraid — its installer
wants systemd and the Docker daemon, and its proxy wants ports 80/443, which
collides with Unraid's own web UI. **The site points at the local Supabase
stack**, so officer pages can be clicked without touching production; the cost is
that the data is a snapshot refreshed by restoring a nightly dump.

Local Discord sign-in turns out to be viable with no second Discord app and no
second Supabase project: the callback upserts `wolfpack_members` with
`onConflict: 'discord_id'`, so a local GoTrue user with a fresh `auth.users` UUID
still lands on the restored member row, and the role gate reads live Discord plus
the restored `wolfpack_roles`. What it needs is a redirect URI added to the
EXISTING Discord app. ⚠ Gated on having the Discord client secret — Discord shows
it once, and resetting it breaks production sign-in until the cloud provider
config is updated. Full steps: `docs/RUNBOOK-local-web-coolify.md`.

## 2026-08-10/13 — Self-hosting: the repo could not rebuild its own schema (measured 2026-08-12)
*2026-08-10 · DECISIONS-2026-08-10.md · Repo could not rebuild its own schema*

Goal from Guild lead: let another guild run this without the hosting bill, and drop
our own monthly fees. Tonight's Unraid work had already proven the two hard
layers (self-hosted Supabase; the web app outside Vercel) and the bot was already
containerized — so the open question was the database, which
`DESIGN-external-tenancy.md` had flagged as untested.

Tested it properly against an empty Postgres 16. **182 of 193 migrations apply;
11 fail.** The cause is not migration bugs: **six tables production depends on are
created by no migration at all** — `fun_events`, `pvp_kills`, `pvp_boss_kills`,
`pvp_assists`, `mimic_sessions`, `trigger_timing_feedback` — applied out-of-band
without committing the file, exactly the drift CLAUDE.md's Migrations rule warns
about. This is a disaster-recovery finding as much as a self-hosting one: the repo
cannot currently rebuild OUR database either.

Fix shipped as `supabase/bootstrap/` (prereq roles/extensions/publication/auth
helpers + the six tables, all idempotent) and `scripts/selfhost-bootstrap-db.sh`
→ **190 clean / 3 partial / 0 failed, 124 tables, 79 functions**. The three
partials are hardening and one-time data repair on objects a new install lacks;
the script re-runs failures non-strict so `pin_function_search_path` still lands
its other 23 statements instead of aborting on one missing function.

Deliberately kept OUT of `supabase/migrations/`: landing them there needs
timestamps older than the migrations referencing them, which rewrites applied
history on a project where the tables already exist. **Open call for the guild lead:**
commit them as real migrations / squash to a baseline, or keep bootstrap as the
fresh-install path. The six tables are created EMPTY — per-guild data, never ours.

Still open and unchanged: the ~97 MB `eqemu_*` catalog has no self-serve import,
and the ~30 hand-copied Discord anchor IDs remain the likeliest place a new guild
gives up.

## 2026-08-10/18 — The local box keeps history production discards (guild lead, 2026-08-12)
*2026-08-10 · DECISIONS-2026-08-10.md · Local archive keeps history production deletes*

*"local should not lose any history"* — so `refresh-local-archive.sh` replaces
`refresh-local-sandbox.sh`. The old script restored with `--clean`, which meant
the local copy faithfully reproduced production's retention deletes and was no
more of an archive than production is.

The merge is per-table by an explicit allowlist, because a production DELETE
means two different things. For `buff_casts`, `raid_roster`,
`target_observations`, `who_observations` and the threat snapshots it means
"retention expired" — the row is still true, production just cannot afford it.
For `character_inventory`, `_gear`, `_spellbook`, `_aas` (and `common_macros`,
`ui_socials_index`, `mimic_link_codes`) it means "no longer true": those are
deleted and re-inserted on every upload, so archiving them would show a character
carrying items they no longer own. The allowlist is deliberately the SMALLER
list, so an unclassified table defaults to mirroring — which can only ever make
the local copy match production, while the opposite mistake silently accumulates
stale rows that look real. Proved by `scripts/test-archive-merge.sh`.

**And the standing rule that came with it:** every design or infrastructure
decision now writes to `docs/DESIGN-selfhost-wizard.md` §3 as it is made. The
retention question turns out to be a hosting-BILL question — hosted Supabase
charges for storage, which is exactly why production prunes to 7 days, while an
on-prem box keeps everything for electricity. So "how long do we keep this" has
a different answer per deployment, and a future setup wizard for other guilds can
only be built from decisions recorded at the time. Rule added to CLAUDE.md.

## 2026-08-10/9 — Unraid Supabase: backup first, then dev sandbox (guild lead, 2026-08-11)
*2026-08-10 · DECISIONS-2026-08-10.md · Local Supabase backup first, then sandbox*

Not the live replica. Ordering matters twice over: the nightly `pg_dump` needs
only the SESSION pooler (IPv4 — the replication path's IPv6/IPv4-add-on caveat
vanishes), and the dump becomes the sandbox's seed data. Phase 1 is committed
copy-paste ready (`scripts/unraid-backup-supabase.sh` + runbook §Phase 1;
execution is a needs-local-session item). Phase 2 (supabase CLI sandbox) waits
on Phase 1 proving out — and its first `db reset` doubles as the first-ever
test of whether the 193 committed migrations rebuild the live schema.

## 2026-08-10/10 — Unraid Phase 1 PROVEN, and four bugs it flushed out (2026-08-11)
*2026-08-11 · DECISIONS-2026-08-10.md · Local backup restore proven; four bugs found*

Backup + restore both exercised on real data the same night: 106 MB dump
(1527 TOC entries, server 17.6) restored into the local stack, `encounters` =
1575. The evening's real value was the failure list, all now in
`RUNBOOK-unraid-supabase-replica.md`: (1) relative compose binds put PGDATA on
the FAT32 boot flash — chown EPERM crash loop; (2) a UI-created Compose Manager
project has NO `volumes/` tree, so Docker auto-created empty directories and
Postgres came up "healthy" having run none of its bootstrap — the role list, not
the healthcheck, is the acceptance test; (3) the backup script pinned a
`postgres:15` client against a 17.6 server, which pg_dump refuses; (4)
`pg_dump -f /dev/stdout` fsyncs on completion and dies AFTER writing a complete
dump. Also: Studio's project ref follows `POOLER_TENANT_ID` (`/project/wolfpack`,
not `/project/default`), and `docker cp` of `latest.dump` copies the symlink.

## 2026-08-10/12 — Local mirror automation: pull, don't expose (2026-08-11)
*2026-08-11 · DECISIONS-2026-08-10.md · Local mirror polls for updates, not exposed*

Asked to turn the evening's manual steps into automated deployment. Three pieces
shipped, each traceable to something that actually broke.

**The mirror follows `main` by polling, not by webhook.** Coolify's auto-deploy
needs GitHub to reach Coolify, and ours is LAN-only; the fixes for that (publish
port 8000, or a Tailscale Funnel) put a container-deploying dashboard on the open
internet. Polling is outbound-only and costs ≤5 minutes of lag. Justification for
automating a sandbox at all: it is the ONLY place the site runs outside Vercel,
and it just caught a bug Vercel had been masking for months (auth redirects built
from `new URL(req.url).origin`, which is localhost in a container — web 1.1.41).
A mirror that needs a click drifts and catches nothing.

**The sandbox data refreshes nightly**, which doubles as a nightly proof that the
backup restores — the verification most backup setups never perform.

**Deliberately not automated:** applying migrations to the local stack on a
schedule (DDL on a timer is fine 50 times and catastrophic once), and anything
touching `main` during a raid window.

Related fix from the same session: **Vercel scopes env vars per environment**, and
`b.wolfpack.quest` is a Preview deployment — a Production-only
`SUPABASE_SERVICE_ROLE_KEY` meant beta rendered fine but sign-in died server-side.
Rule recorded in CLAUDE.md.

## 2026-08-10/16 — The migration pipeline was stalled, and it was hiding a broken feature (2026-08-12)
*2026-08-12 · DECISIONS-2026-08-10.md · Migration pipeline had silently stalled*

Officer roll edits failed on first use — `roll_set_overrides` did not exist. The
cause was not that migration: **the Supabase GitHub integration had applied
nothing since 2026-08-09**, so every migration committed after that was sitting
in the repo believed-applied.

The one that mattered: `20260811120000_trigger_feedback_dismissal_directions`
widens `trigger_timing_feedback`'s direction check to allow `dismissed` and
`expired`. Unapplied, production still rejected both — so #207's dismissal
telemetry, which the callout-overlay design depends on to learn which callouts
raiders do not want, was writing nothing and failing quietly. It shipped on beta
believing it worked.

Both applied by hand via the MCP per CLAUDE.md's documented fallback; the
committed files are idempotent so the integration re-applying them is a no-op.

The lesson generalises past this incident: **a migration pipeline that stops is
indistinguishable from one that works, because the repo still shows the file.**
Nothing checks that the newest committed migration is actually applied. Until the
integration is fixed, treat every new migration as needing the manual MCP step —
and worth building: a check that compares the newest file in
`supabase/migrations/` against `supabase_migrations.schema_migrations`.

## 2026-08-10/17 — PostgREST's 1000-row cap was silently wrong across the site (2026-08-12)
*2026-08-12 · DECISIONS-2026-08-10.md · Thousand-row query cap silently truncated results*

The guild lead asked whether rolls were limited to 1000 looted items. They were — and so
was a lot else. `.limit(N)` only lowers PostgREST's `max-rows`, never raises it,
so every query matching more than ~1000 rows returned the first 1000 with no
error and no flag. The failure mode is the dangerous one: not an empty page, but
a plausible wrong number.

Audited every read in `web/` against live row counts. 52 sites query a table
that exceeds the cap without paging. Three were verifiably wrong today and are
fixed via `web/lib/supabase-paged.ts`: `/rolls` was reading 1000 of 5,622
`looted_items` — the OLDEST loot, which is what older nights need to attribute a
winner, so their "Looted by" column simply showed nothing; `/fun` counted 1,000
of 4,004 dragon punches; and `/fun`'s Drunkard award displayed an EXACT total
next to a top-3 leaderboard tallied from the truncated 1,000, so a right number
sat beside a wrong ranking.

The rest are mostly officer pages over `chat_messages` (344k) and
`who_observations` (113k) and are queued in STATUS. Deliberately not mass-fixed:
most of the 52 are `eqemu_*` catalog or per-character reads that never approach
the cap, and paging them all would be churn — each needs checking against a real
count first. The general lesson is worth keeping: **an ORM-shaped API that caps
silently makes truncation indistinguishable from a complete answer**, and the
only defence is measuring the table, not reading the code.

## 2026-09-01/3 — We are on Supabase Pro, and there is no call budget to blow
*2026-09-01 · DECISIONS-2026-09-01.md · Supabase is Pro; no per-request budget*

**Corrected 2026-09-01.** Code comments and archived docs across the repo say the
project is on the Supabase **free tier**. It is on **Pro** (
verified through the Management API), and has been since before several of those
comments were written. Three live files carried the stale claim, one of them in
copy displayed to officers on `/admin/agents`; all three fixed.

**The bigger correction is what Supabase actually meters: NOT requests.** Neither
Free nor Pro has a per-request quota — the line items are Egress (250 GB/mo on
Pro), Database Size (8 GB/project), Storage, MAU, Edge Function invocations and
Realtime. So "how many POSTs a day can we afford" has no answer, and any design
that budgets calls is budgeting against a limit that does not exist.

What follows from that, and it is close to the opposite of how this repo has been
reasoning:

- **Uploads are nearly free. READS are what cost.** Egress is data leaving
  Supabase. A stream's send frequency barely registers; a poll cadence, a wide
  `select`, or an un-cached overlay refresh is the bill. Optimise the read side.
- **Database size is the only meter that ratchets.** 1.72 GB of 8 GB (21%) today.
  That is the real justification for pruning `buff_casts` to 7 days and for
  retiring the row-per-upload `agent_uploads` log — both were argued as call-cap
  savings, and both are right for the wrong reason.
- **Railway is not a constraint at all.** The bot averages 0.4% of an 8-vCPU limit
  and 1.6% of 8 GB RAM over 7 days, peaking at 8.7% CPU.

⚠ **Two things nobody has actually checked, both dashboard-only:** the **Spend
Cap** setting (with it ON, an overage means read-only mode and 402s, not a bill),
and **current egress against the 250 GB**. The Management API exposes neither.
Until someone reads them off the dashboard, do not quote an egress percentage and
do not assume an overage would merely cost money.

This is also why the mid-raid load-shed flags and the admission-control budgets
are still worth having — they exist to protect *raid-night latency and the bot's
own responsiveness*, not a billing quota. Keep them; just stop justifying them
with the free tier.

## 2026-09-01/4 — The retention sweep that has never swept (found 2026-09-01, NOT fixed)
*2026-09-01 · DECISIONS-2026-09-01.md · Threat snapshot retention sweep never worked*

Chasing "what does the plan afford" turned up the real answer: not calls, but one
table. **`encounter_threat_snapshots` is 920 MB — 57% of the entire 1.72 GB
database — and accretes ~15 MB/day.**

It has a 30-day retention sweep in the midnight chain, coded correctly, enabled
(`THREAT_SNAPSHOT_RETENTION_DAYS` unset → default 30). **It has never removed a
row.** 857k rows span 61 days in a FLAT age distribution; 448k of them (52%) are
past the cutoff. A working sweep cannot produce a flat distribution.

**Diagnosis — the predicate has no index.** The table's seven indexes all either
lead on another column (`guild_id, uploader, …`, `lower(boss_name), …`) or are
partial (`snapshot_at WHERE encounter_id IS NULL`). Nothing serves a bare
`snapshot_at < cutoff`. So the nightly DELETE seq-scans 857k rows / 920 MB to
remove 448k, exceeds the Supabase client's ~10s AbortController, aborts, rolls
back, and the surrounding try/catch logs a warning and moves on. Every night.
The 7-day `thin_threat_snapshots` downsample is the same shape and shows the same
symptom (aged buckets are not smaller — the 50-59 day bucket is the LARGEST).

⚠ **Not fixed, deliberately.** The fix deletes ~448k rows, which is destructive
and irreversible, and it wants a decision on shape: add the index and let one
sweep run, or batch the delete so it never depends on a single statement
finishing inside the timeout — probably both, plus a row count in the log line so
a future failure is visible. Awaiting the guild lead.

**The transferable lesson, already written into the wizard doc:** a retention
sweep whose predicate has no index looks *exactly* like a sweep with nothing to
do. Every retention window needs a matching index and a sweep that reports rows
actually removed.

## 2026-09-01/5 — Free tier vs paid, written down for other guilds
*2026-09-01 · DECISIONS-2026-09-01.md · Document free versus paid tier differences*

The guild lead, 2026-09-01: *"we should denote the difference between free and paid for
others' implementation expectations."* Written into
`docs/DESIGN-selfhost-wizard.md` §2a rather than here, since that is the doc the
wizard gets built from. The load-bearing findings:

- **Railway Free cannot run the bot at all** — 0.5 GB RAM ceiling against our
  observed 0.70 GB peak. Hobby ($5/mo) fits with room; our measured draw is
  ≈ $1.92/mo.
- **Supabase Free is tighter than 500 MB sounds**: a fresh deployment spends
  119 MB on the `eqemu_*` catalog before its first raid, leaving ~380 MB.
- **Our 30-day threat retention is a PAID default.** Even working, it settles
  around 450 MB — more than a whole Free project. A free deployment needs ~7 days
  or the stream shed off. Retention windows must be sized from the target plan's
  ceiling, not copied from ours.
- **The ephemeral streams fill a small database, not the durable guild data.**
  `chat_messages` holds 913 days of guild history in 214 MB; threat telemetry
  holds 61 days in 920 MB.
- Hosted floor ≈ **$30/mo**. Vercel Hobby is fine for a guild but is
  non-commercial under Vercel's ToS.

## 2026-09-04/5 — Tower, written down as one picture
*2026-09-04 · DECISIONS-2026-09-04.md · Home server backups documented in one picture*

Guild lead: *"can you give me an MD about coolify and supabase backups on tower."*
`docs/TOWER-coolify-and-supabase-backups.md` — the overview on top of the two
2026-08-11 runbooks: what runs on the box and why, the backup's parts and the
reason for each, the archive merge, the Coolify VM, three restore cases, a
five-minute health check, and the open list. Two things it surfaces that the
runbooks did not:

- **The backup is an egress cost.** Table data is 1,162 MB of the 1,833 MB
  hosted database (indexes are the rest and are not dumped), so each nightly
  pull is ~1.1 GB — ~33 GB a month, ~13% of Pro's allowance. 754 MB of that is
  `encounter_threat_snapshots`, the table whose sweep has never run. Fixing the
  sweep shrinks the database, the wire and the dump in one move; a lean nightly
  is the fallback lever, recorded not implemented.
- **What is verified and what is not.** The dump, the restore, the stack and
  the local site were all proven 2026-08-11. The two User Scripts schedules,
  the corrected backup copy, local Discord sign-in, and the auto-deploy timer
  were committed ready but no session has confirmed them on the box. The check
  in §6 answers each in one command.

## 2026-09-18/11 — Cost accounting, the code-signing case, and what de-branding actually costs
*2026-09-18 · DECISIONS-2026-09-18.md · Cost accounting, code signing, de-branding cost*

> *"I would like to have an accounting for how much this project has cost since
> its inception… so that I can justify donations against it… I'd rather have
> someone contribute quality enhancements over dollars… update our case for
> getting this open source signed… if a guild decided to use this tomorrow and
> didn't want to have all of the wolf pack branding… how difficult would it be?"*

**Cost accounting → `docs/COSTS.md`.** Measured: **≈ $120 of infrastructure to
date** — Railway $5/mo since 2026-04-21 (≈$25), Supabase Pro $25/mo since
2026-05-25 (≈$95), Vercel $0 on Hobby. Two figures could NOT be measured and are
marked as needing the guild lead: the domain, and Claude/development tooling.
They are deliberately blank rather than estimated.

Three findings that shape the answer:
- **Railway's bill is the plan floor, not usage.** Measured 0.080 GB RAM and
  0.0196 vCPU average = **$1.20/mo of actual resources** against a $5 plan that
  includes $5. The bot is cheap; the database is the cost.
- **Supabase Pro is billed per ORGANISATION and the org holds two projects** —
  so "$25/mo" is not automatically this project's. Two defensible attributions
  (~$10 marginal, ~$25 causal) differ by more than double. **The causal basis is
  the stronger argument and the recommendation**, because the database is
  **2.20 GB — 4.5× the 500 MB ceiling of Supabase Free**. This platform cannot
  run free; the plan exists because of it. Whichever basis is used, say which.
- **The largest real cost is deliberately not converted to dollars:** 2,278
  commits over 4.9 months of unpaid evenings. Putting a rate on it invites an
  argument about the rate, and the rate is not the point.

`COSTS.md` §6 states what a donation is and is not — buys nothing, gates nothing
— and records the guild lead's own ordering: **contributions beat dollars.**
§7 notes the cheapest way to cut the bill is fixing the threat-snapshot
retention sweep, which has never worked (`DECISIONS-2026-09-01.md`) — a better
answer to cost than asking for money.

**Code signing → `docs/code-signing.md`, case rebuilt.** Two of the three
historical rejections were "not an OSI licence" and "user base too small". The
first is **gone** — AGPL-3.0-or-later is OSI-approved (§10). The case is now
written from checkable facts: 2,278 commits in 4.9 months, **730 published
release tags (145 stable, 584 prereleases)**, public repo, GitHub-hosted builds,
one named maintainer. ⚠ **The user count goes in the application, never in the
repo** — `CLAUDE.md` forbids publishing fleet-size figures, and it is public.
Re-apply to SignPath (free; its required attribution is already live in the site
footer) before paying for Azure Artifact Signing.

**De-branding → `DESIGN-guild-kit.md` §7a.** Measured: **1,217 brand tokens, of
which 251 are internal identifiers a fork should keep** (package names, env
vars, table names), leaving **~966 visible strings**; plus 7 brand-carrying build
icons, and 4 build-identity fields in `apps/mimic/package.json`.

**The finding that matters: the cost is not the 966 replacements — a fork does
those in an afternoon. It is that they pay them again on every upstream merge,
against a repo taking 12–42 commits a day.** Within a month such a fork either
stops merging or becomes a full-time rebase. So de-branding is *today* hard and
**permanently** hard, and **after slice 2 it is one JSON file.** That reorders
the queue: slice 2 is worth more than any single overlay rendition.

Three things config cannot fix and the wizard must handle: the **images**
(needs a `guild/assets/` override convention, designed into slice 2 rather than
bolted on), the **`appId`** (`quest.wolfpack.mimic` — a fork MUST change it or
its installer collides with ours and their updates fight ours), and the
**update feed** (a fork publishes from its own repository).

**Generic build: yes, as a default rather than a second product.** When
`guild/config.json` is absent the build falls back to neutral naming and plain
marks; Wolf Pack becomes *a* configuration rather than *the* one. Costs almost
nothing once slice 2 exists — it is the `||` on the other side of each config
read — and avoids a second thing to release and keep in sync. ⚠ **What it is
called is the guild lead's call**, not a design decision.

## 2026-09-18/2 — The hosted-tenant model (recorded, nothing built)
*2026-09-18 · DECISIONS-2026-09-18.md · Hosted-tenant model recorded, nothing built*

> *"if I choose to host others instances we should have this able to be spun up
> quickly, know the full cost and be able to turn it over quickly, fully working
> and in their own repo that derives from this one, where we could see the
> optimizations and choose to promote them up."*

Recorded as the target shape for `DESIGN-external-tenancy.md` and
`DESIGN-selfhost-wizard.md`, which already carry the deployment analysis:
**tenant = a fork of this repository**, deployed from that fork, upstream = this
repo, improvements flow up as PRs the guild lead can promote. Four properties
every tenant stand-up must have: fast to spin up, **full cost known before
starting** (both layers are paid — `DESIGN-selfhost-wizard.md` §2a), fast to hand
over, and working on day one. Three prerequisites already on record and not to
be forgotten: **Vercel Hobby is non-commercial under Vercel's ToS** (a paid
service needs a paid plan — selfhost §2a); the tenancy doc's **§10 data and
trust questions** are prerequisites to taking money, not follow-ups; and a
**conversation with the Project Quarm operators** before charging — this is
tooling for an emulator that runs on tolerance, and its value depends entirely
on their server continuing to exist.

## 2026-09-18/3 — A tenant's data is the tenant's (policy)
*2026-09-18 · DECISIONS-2026-09-18.md · Tenant data belongs to the tenant*

> *"their guild data should be theirs and I should not see theirs without their
> express access and consent for troubleshooting, and honestly we should be able
> to extract anonymized data if need be."*

This answers tenancy §10 question 4. **Policy:** tenant data is tenant-owned;
the operator does not read it without **express, per-incident consent** for
troubleshooting; **anonymised aggregate extraction is permitted** — which means
the anonymisation must run *inside* the tenant before anything leaves it, so
"we can extract aggregates" never becomes "we can read the rows." Needs a
tenant edition of `docs/PRIVACY.md` before the first tenant, and shapes the
tenancy design toward per-tenant isolation with no standing operator
service-role access.

## 2026-09-18/4 — Other databases (MSSQL) — an epic, sized honestly
*2026-09-18 · DECISIONS-2026-09-18.md · Other databases epic sized, not started*

> *"I would be interested in additional database options, like running it
> directly in mssql."*

Recorded, not started, and **not a driver swap.** The platform is coupled to
Supabase-flavoured Postgres in four places at once: the bot talks through a
PostgREST client (`supabase.insert` / `.from()`), not SQL; the RPCs
(`find_or_create_encounter`, `merge_encounter_players` and 77 others — 79
functions, 124 tables per the tenancy doc) are PL/pgSQL; row visibility is RLS;
sign-in is Supabase Auth. MSSQL has none of those in the same shape. The honest
prerequisite is a real data-access layer that both databases sit behind, and
that refactor is the epic; the port is what follows it.

## 2026-09-18/7 — The guild kit — one configurable spot, a wizard, and a route back upstream (the guild lead)
*2026-09-18 · DECISIONS-2026-09-18.md · Guild kit: configurable spot, wizard, upstream route*

> *"a configurable spot for users to fill out their guild's particular bits that
> we wouldn't consider improvements, just their own style and format … it should
> be build able into their own guild … perhaps through a wizard … install into
> on prem infrastructure, or choose our path … allow you or other AI tools to
> assist with troubleshooting … a framework that their own AI platforms could
> also use … a direct route upward that we can review from their GitHub, and the
> config should be their promise bits (envs and whatnot)"*

**Designed, slice 0 landed.** `docs/DESIGN-guild-kit.md`; the contract is
`guild/config.example.json` + `guild/README.md`; the deployment decisions are in
`DESIGN-selfhost-wizard.md` §3 under today's date. The four calls it makes:

1. **The "promise bits" are two kinds, and today they are mixed.** Of the 114
   variables in `.env.example`, **75 are Discord identifiers and 11 are real
   secrets.** Identifiers go in a committed `guild/discord.json`; style and
   format go in a committed `guild/config.json`; the ~11 secrets stay in the
   platform's secret store and are referenced by name. Channel *passwords* are
   secrets; channel *names* are config. Resolution everywhere is env → file →
   fallback, so nothing we run changes.
2. **The de-branding sweep now has a target and a size.** ~580 hardcoded sites
   across the four surfaces (297 × "Wolf Pack", 267 × `wolfpack.quest`) plus
   seven source files that hardcode the Discord guild id or the Supabase ref.
   It does not start until slice 1 gives it somewhere to point.
3. **Wizard shape picked (the guild lead, same day, "yes" to all four):** a
   CLI engine that provisions the Discord layout itself (the tenancy doc's #1
   abandonment point); fork as the default repo shape; palette as a semantic
   set; the hosted path stubbed to "talk to us" until Stage 5. Options and
   four-number costs in the design §4.
4. **AI assistance is the `CLAUDE.md` pattern, generated per tenant, vendor
   neutral:** `TENANT.md` + `tenant.json` + `wolfpack doctor`, whose bundle
   cannot contain a secret or member data because it never reads either.

Route upward: their repo is a fork; `sync-upstream.yml` never touches
`guild/`; `wolfpack diff-upstream` lists what changed outside it — improvement
candidates by definition — and a PR brings them here under `CONTRIBUTING.md` §9.

## 2026-09-18/8 — The tenancy questions, answered (the guild lead)
*2026-09-18 · DECISIONS-2026-09-18.md · Ten tenancy questions answered*

Ten answers to `DESIGN-external-tenancy.md` §10, each with the decision it
makes and where it landed. The one-line versions are appended to that doc's
§10; the hosted terms they imply are drafted in `docs/TERMS-hosted.md`.

1. **Size for the free tiers.** *"its more talking about the setup wizard, if
   they would size the environment for the free levels of railway, supabase,
   and vercel."* → The wizard gets a **free-tier profile** (the S size in §8.8):
   retention windows derived from the tier's storage, features that do not fit
   turned off, and honesty where free is impossible — **Railway Free cannot run
   the bot** (0.5 GB ceiling against a 0.70 GB peak, `CLAUDE.md`), so the S
   profile runs the bot on the guild's own box via Docker or names the smallest
   paid tier. Vercel Hobby is fine for a guild and not for anything paid.
2. **The window is short, and that shapes everything.** *"this server only has
   about 9 months or less in viability for large groups before people start to
   merge together to have enough people to play … people leaving and coming back
   to guilds a quarter their size, or raiding severely less often. eventually
   [the operator] may turn off this server."* → Three consequences: keep the
   commercial ambition proportionate — Stage 5 is not where the effort goes;
   **design for merges** — tenants combining, rosters shrinking to a quarter,
   raid cadence dropping (tick math already assumes nothing per night; roster
   and DKP merges do not exist yet); and **export and portability outrank
   hosting** — a shutdown must leave every guild holding its own archive, and
   the Quarm-specific seams (`_pq.proj` log suffix, the `eqemu_*` catalog) are
   the portability list for any other EQEmu server.
3. **Gate the competitive parts; "commercial" means managed hosting.** *"I
   would rather gate certain components, like the pvp who collection or pvp
   timers. but that's for competition. the commercial part would be if I were
   hosting it and providing feature requests without set timelines for a fee
   that would cover the architecture of their deployment and my time and
   resources."* → PvP /who collection and PvP timers are **feature-gated**, not
   license-gated. The commercial offering is **managed hosting plus best-effort
   feature requests with no committed timelines**, priced to cover that
   deployment's infrastructure and the guild lead's time. **No SLA.**
4. **Privacy, stated up front — and cross-tenant data is untrusted.** *"yes
   privacy is important, observations made by a guild are their own. data is
   easily fake able and could be garbage."* → Confirms §3 and answers the
   "do we say so" half: yes, in the terms. New rule: **observations made under
   another tenant are never merged into ours as fact** — the same data can be
   fabricated, and a shared pool would be a poisoning vector.
5. **Exit: monthly, in advance, encrypted handover at term end.** *"if the
   tenant costs money it needs to be exited by the next month, or the guild
   needs to be on a cycle where they've already paid for that month. if they
   have not paid or renewed the hosted option by then, their data will be
   encrypted and provided to them at term end."* → Paid tenants are on a
   monthly cycle paid in advance; non-renewal ends the term; **at term end
   their data is exported, encrypted to a key they hold, and handed over.**
   Deletion from our side after handover follows; its window is the one open
   detail (terms draft §6).
6. **No `/who` ingestion — with a per-person opt-in kept for later.** *"no we
   don't ingest their who data, unless individuals choose to have their who
   data synced up to a central repository - it lets them be known if they want
   to, as not everyone pvps. many just want their current player online to be
   known … our members could also have this info synced if they so chose, not
   to be taken lightly."* → Default **no**. Recorded, not built, and flagged
   sensitive: a **per-individual "be known" presence opt-in** — one player
   choosing to publish that they are online as a given character — applying
   equally to our own members, consent-gated per person, never per guild.
7. **PvP code ships; de-anonymising is double-locked.** *"lock the ability to
   override anon players without a feature flag or generated alliance code."*
   → The code ships in the bundle; the **anon-override path (the who-lookup
   de-anonymisation) requires BOTH `features.pvp` AND a generated alliance
   code** supplied as a secret. Stage 1's intent (split the PvP data) is served
   by this gate for tenants; our own project is unchanged.
8. **T-shirt sizes, all available at once; whatever we set up is in their
   name.** *"what can stand on its own? t-shirt sizes for effort and features
   make sense to me. some guild should be able to have everything if they
   deploy a website and own the domain. same thing with hosting, if I make it
   for them, they have everything for billing in their names, own the server.
   if I'm hosting it and pay for the domain perhaps we need what the industry
   permits. do I own the domain or do they? I think all at once."* → **S** =
   bot + Mimic on free tiers; **M** = + the web app on the guild's own domain;
   **L** = everything. All three offered from the start. **Ownership rule:
   anything we set up is in the guild's name — billing, server, domain.** On
   the question asked back — *who owns the domain when we host?* — the answer
   recorded is **the guild, always**: we take DNS delegation, never the
   registrar account, because §8.5's exit promise is impossible if the host
   owns the name. A subdomain under `wolfpack.quest` is the zero-setup start
   and is ours by nature; moving to their own domain is supported and expected.
9. **Mimic stays Mimic; guilds may rename their copy.** *"mimic is probably
   pretty engrained but if people want to change it for their guild I think
   that's fine."* → The binary and installer keep the name; the displayed name
   is per-tenant (`wording.mimicName`, already in the kit).
10. **Terms first, then the path, then the instructions.** *"make sure if
    someone starts doing some of it today, I'm covered. terms first then start
    on the way to spin it off, instructions for other guilds to follow."* →
    Order of work: (1) coverage — the license (done), `CONTRIBUTING.md` §9
    (done), **`docs/TERMS-hosted.md` drafted today for legal review**, tenant
    privacy folded into it and pointed to from `PRIVACY.md`; (2) the guild-kit
    slices; (3) `SELFHOSTING.md` → the wizard, as the instructions other guilds
    follow. Stages 0–1 of the tenancy plan are not scheduled ahead of these.

## §334 — Raid night 2026-10-14: an overloaded database, slow mode for every boss, and the post-raid fix batch (bot 3.1.268–3.1.271, agent 3.7.177–3.7.179)
*2026-09-21 · DECISIONS-2026-09-21.md · Database overloaded mid-raid, fix batch*

(§333 is the Vercel deploy-hook decision, still on branch `claude/sharp-lamport-dC0TW` until its secrets exist.)
- **The database ran out of room mid-raid.** Supabase compute is Micro (1 GB): RAM 88–93%, swapping, CPU 92% mostly iowait, status
  "Unhealthy"; bot requests hit the 10 s abort in bursts. The DB is 4.07 GB and `encounter_threat_snapshots` is 2.48 GB of it (61%) plus
  ~370 MB of its indexes. Shed `flag_shed_threat_snapshot=1` at ~21:33 ET (timeouts stopped within 2 min); cleared after the raid.
  **The real fix is the guild lead's pick: compute upgrade (A) and/or the cleanup below (B).**
- **Buff landings lost whole batches** (bot 3.1.268 `[hotfix]` `e1bc98fb`): one duplicate on a partial unique index 409'd the batch.
  `insert_buff_casts(jsonb)` (migration `20261015014500`, applied live) does `ON CONFLICT DO NOTHING` with no target; the old two inserts
  remain the fallback. Two test rows with observer `__hotfix_test__` stay in `buff_casts` and age out in 7 days.
- **Officers lost the Admin tab, then a Mimic DKP tick came back "cannot submit"** (bot 3.1.270 `757e79ea`): during a stall the session
  lookup's `wolfpack_members` read failed and `_lookupSessionToken` cached roles `[]` for 5 minutes, so the bot answered 403 "officers only".
  A failed read now keeps the last good identity and retries in 15 s (`test/mimic-session-member-retry.test.js`). The dashboard now shows
  the bot's own refusal (`j.error`) instead of the generic text (agent 3.7.178 beta `777d6b59`).
- **Slow mode = 18 h for EVERY boss we kill** (the guild lead: *"anything that died within our instances since 8pm should be 18 hour
  respawn"*, *"18 hours is the rule once the zones get converted to slow mode, which should show up in the logs"*). Supersedes §237's
  four-named list: `effectiveTimerHours` returns `slowModeHours` or 18 for any boss inside the window (bot 3.1.269 `aa991621`); only kills
  judged ours reach `recordKill`, so live/PvP copies are untouched. Tonight's window (2026-10-15 00:00Z → 08:00Z, from guild chat) was written
  to `bot_kv`, and the deploy's startup rebuild recovered 12 timers on it. Agent 3.7.177 (beta `254e7dc3`) reports Druzzil Ro's
  "thread of time" guild lines: "natural pace" = off, any other = on, because **the ON wording has never been captured**. The bot keeps
  the opening line as `slow_mode.set_line`: read it after the next slow-mode night and pin the exact text. Our chat relay does not store
  Druzzil's lines, which is why it could not be found tonight.
- **Member lockout works on a kicked member:** the lock wrote (`member_lockouts`, 02:37:43 UTC); the "Locked out now (0)" view was stale.
  Found on the way: `wolfpack_members.is_member` was never set false. Bot 3.1.271 flips departed members (and clears their roles,
  because the officer gate and Mimic identity read `role_names` without `is_member`) on the 6-hourly sync, guarded against a short fetch,
  plus a `guildMemberRemove` listener. 75 of 413 rows on the first run.
- **Post-raid batch (bot 3.1.271 `8bf34c67`)**, drafted by Sonnet agents and reviewed here:
  - hail board counts guide ticks (`pop_guide_ticks`) and /who sightings (`pop_who_sightings`) as "already flagged"
    (`utils/popSelfProof.js`, copies of the site's tables, drift-tested);
  - `raid_nights` id cached per process (most of the 409s were the `zone_main` FK, not duplicates);
  - `merge_encounter_players` takes `pg_advisory_xact_lock` per encounter (migration `20261015040000`; the MCP apply was cancelled, so the
    GitHub integration applies it from main; the body is otherwise identical to live);
  - the threat sweep is `prune_threat_snapshots` (migration `20261015041000`, applied live): 2,000-row batches off existing indexes, 2 min
    a night, resumes next night, refuses a cutoff newer than 7 days. Space returns to disk only after `VACUUM FULL`/`pg_repack`, off-hours.
- **Website:** production deploys of main's head CANCEL whenever the last commit doesn't touch `web/` (the `ignoreCommand`, §134), so
  web 1.8.158/1.8.159 went up by deploying `0cf809fb` (its `web/` is identical to main's head) through the Vercel MCP. `/pop/latest`
  answers 307; the 2.9.1 #raid-chat card posted at 04:52 UTC.
- **Mimic:** chat lines wrap back under the line instead of down a column (beta `270b1cb7`). **Feedback opens in its own window**
  (the guild lead picked A: *"leaving feedback sometimes will refresh the screen we're writing it on"*; cause: the dashboard reloads after
  every agent restart and the form only kept its draft in memory). Agent 3.7.179 beta `fb30386f`: `openFeedback()` loads the dashboard
  page in a feedback-only mode (`/?feedback=1`), the draft autosaves, tray and 💬 button share it. Not tried in a live Electron yet.
- **Main window drag stutter** (the guild lead): nothing in Mimic moves the dashboard window (its `main.js` is identical to 2.9.1).
  Asked the guild lead to bisect: hide all overlays, then Map Full/Canvas, GPU off, overlays-follow-EQ off, and say which monitor and scale.
- Known red test: `test/my-logs-local.test.js` fails on main and beta, unrelated to tonight.
- **No database upgrade (the guild lead: *"I don't want to pay for more database server and upgrade. Was it DB or
  was it Vercel?"*).** It was the database; Vercel only held back the website deploy. `pg_stat_statements` (since
  2026-10-12) put ~70% of all DB time on one read: the DPS meter's `/api/agent/live-damage` query of
  `encounter_threat_snapshots` filtered `boss_name =`, but the only boss index is on `lower(boss_name)`, so 183k calls
  each walked the time range (153–172 ms). `live_damage_snapshots(...)` (migration `20261015060000`, applied) reads on
  `lower(boss_name)`: 2.8 ms, no new index (bot 3.1.272 `6373212b`). Next in line: `who_directory` (1.27 s × 7.5k) and
  a `p_guild_id, p_since, p_limit` RPC (0.5 s × 11.7k).
- **Alpha builds now follow beta** (ci `e1c776e0`): `sync-alpha.yml` dispatches `release-mimic.yml` on alpha whenever
  alpha's Mimic or agent differs from the `mimic-alpha` build (GITHUB_TOKEN pushes never start on-push builds, so alpha
  installs had sat a day behind the branch). First automatic build: 3.0.0-alpha.1085, 05:17 UTC.
- **Read sweep, round two (bot 3.1.273 `9491d51a`; the guild lead: *"fix the who_directory read too, scan for any
  other scenarios where the database should be much faster or we have overconstrained things"*).** Measured with
  EXPLAIN ANALYZE on production, before → after:
  - `who_directory` by key: 1,270 ms → ~4 ms for 60 keys. The view is six DISTINCT ON passes over all ~203k
    `who_observations` rows, so a `character_key=in.(…)` filter applies only after the whole directory is built.
    `who_directory_lookup(p_keys)` (migration `20261015071000`, live) returns the view's own row type, computed per
    asked key with LATERAL reads on `who_obs_character_idx`; identical rows (EXCEPT ALL both ways = 0). The bot's
    de-anon pass calls it and falls back to the view.
  - Trigram GIN indexes (migration `20261015070000`, live) for PostgREST `ilike.Name` matches, which a btree cannot
    serve: OpenDKP bids 765 → 0.9 ms, `encounter_players.character_name` 954 → 0.6 ms, `eqemu_npc_types.name`
    70 → 0.7 ms.
  - The 30-day damage board (`encounter_damage_by_character`, 0.5 s × 11.7k) is memoised 5 minutes in the bot.
  - ⚠ **The MCP cancels any statement that replaces an existing object**: the `who_directory` view rewrite (same
    file `20261015070000`) and the `merge_encounter_players` advisory lock (`20261015040000`). New objects went
    through. **The GitHub integration did NOT apply `20261015040000` from main** (live function still has no lock,
    checked 2026-10-15), so the line above saying it would is wrong. Both wait on the guild lead pasting the files
    into the Supabase SQL editor; both are idempotent.
  - Unused/redundant indexes (scan counts cover only ~3 days, so weekly jobs may not show): `idx_threat_snapshots_uploader`
    157 MB / 9 scans (its `(guild_id, uploader)` prefix is the unique index's); `target_observations`' three indexes,
    72 MB / 0 scans (the table is written and swept, never read); `faction_hits_char_faction_ts_idx` 24 MB, an exact
    prefix of `faction_hits_dedup_idx`. **The guild lead picked A and B**: all four go
    (`20261015080000_drop_unused_indexes.sql`, about 230 MB); `target_observations_at_idx` stays.
  - **Applied by the guild lead in the SQL editor, 2026-10-15:** `20261015040000` (the merge function now takes
    the lock) and `20261015070000` (the view is the per-key rewrite, 10 keys in ~7 ms; `who_directory_v2` gone).
    The drop file goes the same way. The rule: **anything that replaces or drops an existing object goes to the
    guild lead as a file to paste**; the MCP cancels it every time, retrying included.

## §9 — Cloud sessions reach Tower over Tailscale (2026-09-23)
*2026-09-23 · DECISIONS-2026-09-21.md · Cloud sessions reach home server via Tailscale*

The guild lead: *"how can we build you a path to work on the local instance of
this database rather than me having to do it?"* The choice was between running
Claude Code ON Tower (a container driven via `claude remote-control`) and letting
cloud sessions JOIN the tailnet. **The guild lead picked Tailscale.** A Claude in
Chrome session did the Tailscale-console and Unraid work, from a private
setup brief (an artifact, not in the repo; it names the steps, not the values).

**What exists now.** A cloud session joins as an ephemeral device tagged
`tag:claude-cloud`, using a reusable, pre-approved, 90-day auth key. The tailnet
policy lets that tag reach exactly two things: Tower on 5432 (the Supavisor
pooler — `supabase-db` itself publishes no port, and still doesn't) and the
Coolify VM on 8000, through Tower's existing subnet route. The default
`src: ["*"]` grant became `autogroup:member`, because a tagged device counts as
`*`. Policy `tests` refuse a save that opens anything else. The database login is
`claude_ro`: SELECT on `public` + `archive_meta`, minus `tells` and
`chat_messages`, password set with `\password` so it is in no history file. The
Coolify token is read-only without `read:sensitive`, because that scope reads
every deployed app's environment variables.

**Verified the same evening** from this session: joined as `claude-cloud`;
`select current_user` → `claude_ro`; `tells` → permission denied; Tower 22 and
8000 time out (blocked by policy); Coolify answers. Relay-only over DERP, since
UDP is blocked.

**Three things that cost time, for the next session:**
- **`no_proxy` sends LAN addresses around SOCKS.** The cloud environment's
  `no_proxy` lists the private ranges, so `curl --socks5-hostname` to the Coolify
  VM dials it DIRECTLY and times out. Prefix `no_proxy= NO_PROXY=`. psql goes
  through a `socat` → `tailscale nc` forward, which is unaffected.
- **`pgrep -f 'tailscaled --tun'` matches its own shell's command line**, so a
  "start it unless running" guard never starts it. Run `tailscaled` and `socat` as
  background tasks.
- **Supavisor wants `claude_ro.<tenant-id>`** as the username; plain `claude_ro`
  fails to log in.

**The values live in the cloud environment's variables** (`TS_AUTHKEY`,
`TOWER_TS_HOST`, `TOWER_DB_PORT`, `TOWER_PGDATABASE`, `TOWER_PGUSER`,
`TOWER_PGPASSWORD`, `COOLIFY_HOST`, `COOLIFY_TOKEN`). Anyone who can use that
environment can read them, which is why each is scoped as above. The repo carries
names only, never values.

## §101 — Only main and beta build the website; Vercel's 100-a-day cap (2026-09-29, web 1.8.53)
*2026-09-29 · DECISIONS-2026-09-21.md · Only main and beta build website*

The guild lead, on the Essences card: *"still not showing for me"*. The code was on beta and built; the
website was not being built.
- **Cause: Vercel's Hobby plan allows 100 deployments a day, and every push to every branch spends one.**
  Each commit's Vercel status read *"Deployment rate limited — retry in 24 hours"*. In the 24 hours before,
  alpha took 103 pushes, beta 87 and main 57. Alpha began that morning (§81), and `sync-alpha.yml` merges
  into it on every main and beta push. So b.wolfpack.quest was stuck on a 15:47 build, seven minutes
  before the Essences card, and production missed 1.8.52 too.
- **Picked by the guild lead:** only main and beta build the site. `web/vercel.json`:
  `"deploymentEnabled": { "**": false, "main": true, "beta": true }`. Alpha, `claude/*`, dependabot and
  task branches stop building. Mimic's alpha builds are GitHub Actions and are unaffected. Offered and
  not picked: Vercel Pro ($20 a month, 6,000 a day), both, or leaving it.
- ⚠ **An Ignored Build Step does not help:** Vercel counts a skipped build as a deployment. A docs-only
  push to main still spends one; that is accepted.
- **How to check next time:** a commit's Vercel status is readable without a token at
  `api.github.com/repos/<owner>/<repo>/commits/<sha>/status`. The Vercel connector in the session needed
  authorising, so this was the only window.
- **Also fixed (web 1.8.53):** a signed-out visit to `/pop?v=b&demo=1` sent you to sign-in with
  `next=/pop`, so you landed on plain `/pop` and never saw the card. The redirect now keeps the query.
  It sat next to beta's Essences lines, so the beta merge was resolved by hand (`e107f523`).
- **Tests:** `test/vercel-deploy-branches.test.js`; the redirect in `test/pop-planner-mains-alts.test.js`.

## §108 — Vercel Deployment Storage over the Hobby 10 GB (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Vercel deployment storage over limit*

The guild lead, with the Usage page: *"vercel is overdeployed on storage it seems"* — Deployment Storage
**10.32 GB / 10 GB** ("Exceeded free resources"). The 7-day chart climbed about 2 GB a day, dropped once
on Sep 26, and climbed again.
- **Why:** every finished build keeps its whole output until retention deletes it (Hobby default: 30 days
  for every kind). `web/public` alone is about 40 MB, and a 23 MB GIF (`pvp/deeps-pit-full.gif`) is more
  than half of that. Until §101 today, every push to every one of 50 branches built the site. Vercel also
  keeps the latest build of every branch that still exists, however old it is.
- **Done:** `web/vercel.json` `ignoreCommand: "git diff --quiet HEAD^ HEAD -- ."`. A main or beta push that
  changes nothing under `web/` now skips the build, and skipped builds store nothing; most pushes are
  bot, agent or docs changes. This does not change the 100-deployments-a-day count, since a skipped build
  still counts there. The site imports nothing from outside `web/`. `test/vercel-deploy-branches.test.js`;
  CLAUDE.md release playbook.
- **The guild lead's, in the dashboard** (the Vercel connector is not signed in, and no token is in the
  repo):
  1. Project → Settings → Security → Deployment Retention Policy: set Preview, Canceled and Errored to the
     shortest option offered. Production keeps its last builds anyway, because the live one carries the
     domain.
  2. Deployments list: delete old preview builds. The CLI does it in one line: `vercel remove <project>
     --safe --yes` removes every build that carries no live URL or domain.
- **Offered, not done:** deleting merged `task/*` and `claude/*` branches (about 40 of the 50) so their
  last builds can expire. Deleting branches cannot be undone, so it waits for a yes. Also offered:
  replacing the 23 MB GIF with a video of a few MB.
- **2026-09-30:** the guild lead said yes to both. Neither landed from the cloud session: the git proxy
  refused the remote branch deletes (403) and further attempts were then blocked. Both are the guild
  lead's to do on GitHub or from a local session.

## §155 — Every read past PostgREST's 1,000-row cap now returns complete data (2026-10-04, bot 3.1.198 · web 1.8.95)
*2026-10-04 · DECISIONS-2026-09-21.md · Reads past 1000-row cap return everything*

The guild lead: *"review all of the other tables for silent 500 or 100 caps. I thought we had something in
the design."* The design had `selectAll` / `selectAllPaged` and a ratchet that counted `.limit(N>1000)` text.
It missed three things. A single `.range(0, N)` call is capped too. So are a set-returning RPC and a view.
And a page that orders on a non-unique key drops and repeats rows at page boundaries.

- **How it ran:** three Sonnet audits (web pages, web lib/API, bot) measured every read against production.
  Eight Sonnet branches then fixed them, each with a cap-enforcing fake and a mutation check. They were merged
  here, with nine migrations applied through the MCP (`20261004140000` … `140800`).
- **What was broken, measured on production (a few of many):**
  - Timer recovery and the raid review read the first 1,000 boss kills. The review showed no slows on
    2026-09-27, with 174 in the window.
  - The buff queue saw 4 minutes of a 3-hour window: 49 of 354 running (target, spell) pairs, 0 of 71
    Aegolism-line casts.
  - Extended Target saw 27 of 97 running debuffs.
  - The Mimic damage panel's "30 d" top 25 shared 16 names with the real one.
  - 18 families' mirror DKP read low by up to 2,347.
  - /guide counted 581 kills of 1,436. /leaderboards' top spender was the wrong character.
  - /admin/agents was missing 190 of 435 characters. The analytics page showed 1,000 of 12,242 views.
  - /me stats for the heaviest raider read 1,000 of 3,807 fights.
  - /me/tells counted 1,000 of 9,156. 29 of 117 characters were missing from /pop spell needs.
  - /quartermaster lost 12 inventory rows and doubled 12 (non-unique order).
- **The fixes take one of three shapes:**
  - **Paged** over a unique ORDER BY (`selectAll` / `selectAllPaged`).
  - **Summed in SQL**: an aggregate RPC whose answer is a few rows.
  - **One jsonb value**, which is not row-capped.
  - New RPCs are `security invoker`, `search_path` pinned, and granted to `service_role` only.
    `me_tell_summary` filters on the owner inside the function.
- **Guards, so it cannot come back quietly:**
  - **Bot:** `select()` warns once per call site when a read returns exactly 1,000 rows unpaged, and
    `/health` carries `supabase_row_cap`. Two ratchets cover over-cap limits (now **22**, was 82) and
    unbounded big-table reads (**4**).
  - **Web:** `test/db-read-discipline-web.test.js` ratchets four counts: one-call `.range(0, N≥1000)` (**1**),
    unpaged set-returning RPCs (**24**), unbounded big-table reads (**93**) and paged reads on a non-unique
    key (**2**). The map of each paged table's unique key comes from `pg_index`.
- **Ruling made here: `selectAll` throws on a failed page.** It used to return the rows it had, which is the
  same silent partial set.
  - A page that can live without a section catches the throw. /me's suspects, attendance, heartbeats and loot
    do; the admin loaders turn it into their error banner.
  - Everything else shows the error page instead of a short list.
- **Behaviour changes worth knowing:**
  - /admin/encounters lists backfill candidates only on fights with missing damage (673 a week, not ~44
    names on every trash row).
  - The item-clickies catalog served to agents is the 1,611 real clickies, not the 1,000 lowest item ids.
  - Mimic's threat rank rows are now whole fights.
  - Bid-history's pooled DKP counts every family name (it stopped at 25).
  - `BUFF_QUEUE_POLL_LIMIT` is retired.
- **Found, not fixed (open items):**
  - `_refreshFocusHaste` decodes `eqemu_items.worneffect`, so it finds no foci. The foci are in
    `focus_effect`: 183 haste foci across 103 characters.
  - The /admin/triggers "Votes" total counts 48,200 `expired` rows; 12 are real votes.
  - ~~`/encounter tonight` reads `e.id` from a view that has no `id`.~~ **Fixed in bot 3.1.201** (2026-10-04):
    it threw on any day with a fight, so the command always answered with its error. It now reads
    `encounter_id`; `test/cap-safe-reads.test.js` §5 runs the command.
  - ~~`opendkp_loot_recent` repeats 13 auctions, because one OpenDKP id matches two characters.~~ **Fixed
    2026-10-04** (migration `20261004220000_opendkp_loot_recent_one_character`, applied and recorded). It was
    26 auctions: one OpenDKP id sits on two `characters` rows, a rename leftover the sync never cleared
    (`utils/openDkpSync.js` dedups by name only; left alone). The view now takes one character per id: not
    deleted, then most recent `updated_at`. 9,251 → 9,225 rows, one per auction. That also stops
    `leaderboard_loot_spend()` double-counting those auctions' DKP. The file also commits the two name fallbacks
    that were applied through the MCP in May and never written down.
  - ~~`guild_held_spell_needs` takes ~31 s, so /admin/spells likely shows its error.~~ **Fixed 2026-10-04**
    (migration `20261004221000_guild_held_spell_needs_fast`, applied and recorded): 29 s → under half a second,
    same 561 rows with the same md5. The per-spell subquery called `eq_class_bit()` ~312k times and scanned the
    spellbook unindexed; class bits are now computed once per character (a MATERIALIZED CTE: without it the
    planner put the call back and it took 12 s) and needers are one grouped join. Re-measured 2026-10-06:
    561 rows in ~1.1 s. The one-pass shape is now pinned by `test/cap-safe-admin2.test.js` (stripSql;
    mutation-checked: dropping MATERIALIZED, the `have` CTE or the LEFT join each fails it).
  - The threat rollup has not run since 2026-08-19. It is the unapplied `snapshot_at` index above.
  - Beta's /db/item preview (`?v=b` / `?v=c`) reads `item_recipes` in one call. One item is in 1,450
    recipes, so it must page before that preview graduates. The beta sync by hand (`015d55d2`) paged
    `quest_scripts_for_item`, which already stops at 200.
  - 627 `loot_observations` rows disagree with the drop tables (officer decision).
- **Self-host wizard:** the cap is a Supabase/PostgREST default (`max-rows`). A self-hosted PostgREST may set
  another, and the paged reads work under any value. Logged in `DESIGN-selfhost-wizard.md` §3.

## §167 — The guild lead's own machines are private; the platform gets the pattern (2026-10-06)
*2026-10-06 · DECISIONS-2026-09-21.md · Home lab details kept private*

The guild lead: *"this detail should be written outside of our GitHub repo for things not generalized for
the platform. design recommendations for hardware I operate can be part of it, but nothing with secrets or
that exposes me to anything."*

- **Where it lives:** a new **Home lab** tab in the private briefing holds which machine does what, the
  recommended jobs per machine, the Tower rebuild question and a hardening checklist. Rule recorded in
  `CLAUDE.md` beside the other private-briefing tabs.
- **What the repo gets:** only the generalized pattern, for the self-host wizard: always-on duties (the
  assistant, voices, speech-to-text, the raid voice bot) live on one wired box nobody games on; gaming PCs
  are helpers that take picture jobs only when they are free (no game running, idle, GPU free). Written into
  `DESIGN-selfhost-wizard.md` §3.
- **Raid announcers** (miMIC, Bristlebane, Lord Mobsincamp) are being designed now: the cast bible and the
  announcer engine come to the repo with no member names; anything about the guild lead's own setup goes to
  the Home lab tab.
- **Personas are written and rehearsed as character cards** (the guild lead picked A, 2026-10-06: a
  SillyTavern rehearsal room). Each announcer is a Character Card V2 (`chara_card_v2`) plus one shared
  lorebook of guild lore. The three play a raid night in a group chat before any raider hears them. The
  announcer engine's persona pack must import and export that card format, so the cards stay the one source
  for every surface: Mimic's in-ear lines, the Discord bots' personalities, and recorded clips. Another guild
  can bring its own cards. v0.1 cards went to the guild lead directly; v0.2 comes from the cast bible.

## §177 — Guild kit slices 1b, 2-prep and 3: the config loader, tag correctness, the one-shot gate, the Discord self-provisioner, Bristlebane's guild file (2026-10-07, bot 3.1.215 · bristlebane 0.1.2)
*2026-10-07 · DECISIONS-2026-09-21.md · Guild kit config loader and provisioner*

- **The call.** The guild lead asked for the hard-coded Wolf Pack values scoped and a provisioner designed
  (§310 of the session log, 2026-10-06), then "resume". Built as six reviewed branches by parallel agents, one
  adversarial reviewer per branch, every review "mergeable with fixes"; the fixes were applied per branch and
  the branches merged on `integ/guildkit`. The web half (slice A: `web/lib/guild.ts` + the literal swap) is
  reviewed separately and ships as web to `beta`.
- **Resolution order is law: env → `guild/` file → built-in fallback, env always wins.** Every slice was
  reviewed against "Wolf Pack production (every env var set, no `guild/config.json`) is byte-identical", and
  each reviewer traced that path. `utils/guildConfig.js` is the one helper; `roles()` now gives exactly what
  `utils/roles.js` sees after boot (the review found three cases where the two disagreed).
- **The one-shot announcers are gated on the guild TAG, not on a file.** The slice as built turned them off
  when a `guild/config.json` existed. The review found that two of the eight latches
  (`announce_vex_thal_cleared`, `announce_vex_thal_film`) have no row in production `bot_kv`, and the kit's own
  rule is that Wolf Pack commits a `config.json` too — so the day it landed, both would have reposted. Now:
  `ANNOUNCE_UPSTREAM_ONESHOTS` overrides; otherwise `guildTag() === 'wolfpack'` is on, anything else is off.
  The howl-card repair one-shot is gated the same way (nine gates, eight announcers).
- **The provisioner owns the layout through `bot_kv`, and auto mode is conservative.** A hand-configured
  server (every anchor in env) gets `report`: no writes, no fetches beyond today's. A virgin server gets
  `create` under a 120 s lease, bounded to 25 s per boot, and **resumes** an unfinished build on the next boot
  (the review caught that the first cut would have called a half-built layout "not virgin" and stopped).
  `GUILD_PROVISION=off` means off everywhere, `/setup` included. Hub-only channel creation; threads adopted
  by name; unknown is never gone (a 500 on a fetch does not delete an anchor).
- **Tag correctness is a ratchet.** `test/guild-tag-rest.test.js` pins the count of inline
  `process.env.SUPABASE_GUILD_ID || 'wolfpack'` reads at 160 and fails on a new one or on any `'wolfpack'`
  REST literal; the four pre-existing unencoded filters are encoded. `characterPrefs` was the last literal
  behind a live Mimic route (`?mine=1` and set-prefs would have found no rows on any other tag).
- **Loaders print key names, never values.** Both `discord.json` loaders (root and Bristlebane) warn on an
  existing-but-unreadable file (`EISDIR` is the Docker mount typo), give a parse position but no snippet on
  bad JSON, and refuse a numeric id above 2^53 instead of passing on a rounded snowflake.
- **Where it landed.** `utils/guildConfig.js`, `utils/discordProvisioner.js`, `commands/setup.js`,
  `scripts/provision-discord.js`, `data/discord-layout.json`, `apps/bristlebane/lib.js`, the root loader in
  `index.js`, `.env.example` (`ANNOUNCE_UPSTREAM_ONESHOTS`, `GUILD_PROVISION*`), `guild/README.md`,
  `guild/config.example.json`, `guild/discord.example.json`; tests under `test/guild-*.test.js`,
  `test/discord-provisioner-*.test.js`, `test/setup-command.test.js`, `test/announce-upstream-gate.test.js`,
  `apps/bristlebane/test/guild-file.test.js`. Docs: `DESIGN-guild-kit.md` §7, `HOW-ITS-BUILT.md`,
  `DESIGN-selfhost-wizard.md` §3, `STATUS.md`.
- **Still owed (slice 2 and later).** The de-branding sweep proper (the 11 getter-only env names the config
  test lists are read by nothing yet; `GITHUB_REPO` among them); the agent/Mimic manifest route; SQL bootstrap
  tag substitution; literal Discord ids after a production env check; `doctor`; the wizard CLI.

## §217 — More real-time map data needs no plan upgrade; Vercel Hobby is the ceiling to keep the live feed off (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Realtime map data needs no plan upgrade*

**The question** (the guild lead): *"to implement more of this realtime reporting do we need to increase our plan for
supabase, vercel, or railway"*, plus *"can we build in more visual top-down maps with actual graphics"*, and a page of
findings and mockups others can comment on.
- **Supabase Pro: no change.** The spectator positions read is ~6 KB per poll for a full raid (one row per raider from
  `spectator_positions`); 20 viewers × 3 s × 4 h × 12 raids ≈ 7 GB/month of the 250 GB egress. Live mob dots must NOT
  be stored in Postgres (database size is the one meter that only grows); keep them in the bot's memory beside the
  positions. A raid-replay recording is the feature that would cost database size.
- **Railway: no change.** The live feed is already the bot's in-memory `/api/screen/live` (signed ticket, every 3 s);
  up to ~70 nearby mobs per uploader adds a few KB.
- **Vercel Hobby: no change, but it is the ceiling.** Hobby includes 1,000,000 function invocations, 1M CDN requests and
  4 active CPU-hours a month (vercel.com/docs/plans/hobby, read 2026-10-10), and going over **pauses the feature for 30
  days** instead of billing. If the bot feed is down and every viewer falls back to the Vercel polls, 20 viewers × 3 s ×
  4 h × 12 raids ≈ 1.15M calls, over the cap. So: live data stays on the bot, and the fallback stays slow. Whether
  `SCREEN_LIVE_URL` + `SCREEN_TOKEN_SECRET` are set on Vercel production was NOT confirmed (the env listing a session
  can read was partial).
- **Map art options** (A parchment generated from our own walls/floors/spawn density; B real textures rendered from the
  player's own client files, Mimic-only because the website would be redistributing game art; C one AI-painted map per
  zone; D community map images, not recommended for licence and coverage). Recommendation: A on the web now, B as a
  Mimic option later.
- **Where it landed:** a claude.ai workshop page (owner-shared, so not linked here) with the findings, three live
  mockups (A radar, B zone board, C tracker) with layer toggles and the three art styles, picks for version / art /
  the three open 2.9 picks, and a notes board. The beta `/spectator` variants are built after the picks.

## §348 — Log ingestion and database load: self-inflicted, cut at the bot (2026-10-16, bot 3.1.282–3.1.283)
*2026-10-16 · DECISIONS-2026-09-21.md · Cut self-inflicted log ingestion and database load*

- **The asks** (the guild lead): Supabase log ingestion *"is WAY over"* (53 GB of 20 GB included this cycle,
  ~2 GB/day; overage billing starts after the 2027 grace period), RaidBosses at 90% CPU on Micro, and *"is it
  possible they are finding a way to spam a stream to us or is this all self inflicted?"* after a talk with a
  competing guild.
- **Measured (edge logs, 24 h to 2026-10-16 04:00 UTC, a raid night):** 1.18 M API-gateway requests, every one
  with our service key: Railway (the bot) ~1.05 M, one Google Cloud address ~127 k (the SAME bot: Railway traffic
  stopped in the 05:00 hour exactly as it began, and came back at the 3.1.282 deploy), the website's edge check
  ~4.9 k, browser sign-ins ~15. Zero public-key requests, one 401 all day. The bot's own API took 2.5 M requests,
  94% accepted (logged-in Mimics), tracking raid hours; 4xx steady with no burst. **Not an outside attack.**
- **Cause:** every bot read cache was check → await → set with no in-flight sharing, so ~60 Mimics polling
  every 1.5–6 s each sent their own copy of the same read; plus one stat RPC per upload (164 k/day).
- **Shipped:** 3.1.282 batches the upload counters (one `bump_agent_upload_stats` call a minute, migration
  `20261016043000`). 3.1.283 adds `utils/ttlCache.js` (shared in-flight reads) on the live zone map, target-buffs,
  di-status, live damage, the Extended Target and buff-queue bundles and guild triggers (60 s: an edit now
  reaches agents in ~3 min), one shared raid_roster snapshot for three readers (`utils/readSnapshots.js`), and a
  batched raid-helper sync. Estimated 400–500 k fewer requests a day; **re-measure after the next raid.**
- **Database size, same night:** `encounter_threat_snapshots` was 2.6 GB of 4.2 GB because the 30-day sweep never
  ran: its graph watermark sat at 2025-01-14 since `build_encounter_threat_graphs(5000)` timed out every night
  from 2026-09-28 (12,645 fights ungraphed). The backlog was built by hand in batches (graphs now through
  2026-10-11); the archive watermark (Tower, set by hand 2026-09-23, through 2026-09-06) is now the limit, with
  915 k rows deletable. ⏳ Nightly graph build in small batches; Tower archive watermark refresh; the guild lead's
  call on deleting the 915 k now vs nightly. Next lever on request volume: Mimic polling less while nothing changes.
- **Next lever picked: A — live raid state in bot memory** (the guild lead, 2026-10-16: *"going to have to be A, but
  then are we getting riskier on state and redeploys?"*). Rejected: load-balancing the bot (each replica keeps its
  own caches, so reads multiply, and the cast relays / guild feed / Discord connection assume one process) and
  changing ingress/egress (the log bill counts requests, not direction or source). The promised safety rules:
  (1) Supabase stays the record — every roster/live-state row is still written, batched every ~2 s; durable readers
  (replay recorder, screen, web) keep reading Supabase; (2) a fresh process answers from Supabase until it has
  received a stream for the reader's whole window (15 min roster, ~10 min live state), so a redeploy behaves like
  today; (3) ONE bot replica — memory is complete only if one process receives every upload; (4) shed/budget
  behaviour unchanged. **Shipped bot 3.1.284** (`utils/liveMemory.js`; the one-replica rule is in CLAUDE.md).
  ⏳ After the next raid: confirm roster/live-state writes arrive batched and the request count dropped.

## §358 — The shared hosted trial: a separate project, a schema per guild (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Shared hosted trial, schema per guild*

The guild lead's direction for a multi-tenant "raid orchestration + analytics as a service": a shared trial we run →
graduation to the guild's own account. Decisions made this session:
- **Hosting/billing:** we run the free/shared trial (our infra, we bill, scale economics), and a guild that graduates
  moves to a dedicated tenant **in their own account + domain** — the epic's exit-promise (§609) stays intact. The
  trial is **NOT in the Wolf Pack production database** (the guild lead: *"not in the Wolfpack database"*).
- **Isolation (the guild lead's pick):** **one separate Supabase project, a Postgres schema per guild.** Never
  production. Migrating a guild out = dump its schema into their new project; removing one = `DROP SCHEMA`. This is
  external-tenancy §5.4(i). It also makes offboarding safe — a tenant can be exported or wiped with zero risk to our
  DB.
- **Tenant unit = a prospective guild's small cohort (6–12 raiders cap each), not a melting pot of strangers.** That
  keeps "data belongs to your guild" true and gives the dedicated tenant an owner at graduation. ⚠ This REVERSES the
  earlier read of "shared tenant" as unrelated individuals; the scoping showed a mixed-guild roster breaks three
  TERMS-hosted promises and has nobody to own the graduated tenant.
- ⚠ **A shared project leaks today:** RLS is an app sign-in gate, not data scoping (71 `using (true)`, the web holds
  service-role, ~480 unfiltered web queries). So the schema-per-guild isolation (a role per schema) is load-bearing,
  not optional — a plain shared project would serve every guild's rows to any signed-in trial user.
- **Trial agents run PvP/who-collection OFF** (`features.pvp=false`, `flag_shed_pvp*`) — DECISIONS §8.6, we never
  ingest other tenants' /who.
- **Vercel Hobby is non-commercial** — a paid-ish trial needs a paid Vercel plan or careful framing (DESIGN-business
  §4.1).
- **Offline/non-platform replay capture:** local-file + a no-account viewer first (the agent already captures the
  raid window locally; mostly a packaging job), then a signed-in "claim/merge" later. There is **no raid id today** —
  the workable merge key is shared-roster-overlap + the zone-copy token (`host:port` from `dbg.txt`), which works with
  no account.
- **Offboarding / ToS / privacy (the guild lead asked for contractual data removal, updated privacy agreements, and
  ending service for an abusive customer with a data export + an audit log of the removal):** the flow is suspend →
  encrypted export → audit-logged purge, on a new `tenants` table (status / `purge_after`) with an **append-only
  removal log that lives OUTSIDE the tenant's data** (an operator-side project) so deleting the tenant can't erase the
  record. ⚠ Conflicts to resolve: the public privacy page currently says "no self-serve export or delete — ask an
  officer" (must be rewritten), and our nightly `pg_dump` backup + the never-delete Tower archive hold tenant rows
  past a delete, so the terms need an explicit **backup-expiry window**. ⚠ **The deletion window, backup expiry, and
  notice period are a professional's call — a session drafts the mechanics + copy with those left as clearly-marked
  placeholders, never invented.**
- **Brand:** `raidboss.quest` is the pick for the trial's front door (available ~$2 first year / ~$17 renewal; `.boss`
  is not a TLD; `.io`/`.gg`/`.app` of "raidboss" are taken). Needs registration at Porkbun (human-only; the API is
  blocked from cloud sessions). `eqmimic.quest` (owned) is the alternative front door.
- **Priority (the guild lead):** shared-SaaS funnel, Discord-app wizard + pricing, and the quick wins first; the
  chat-window overlay + Zeal-geometry work is scoped but parked.
- **Still open for the guild lead:** what "Discord linking as an app" means (OAuth sign-in vs a bot installed per
  guild vs a user-installable app — each is a different build); whether a single shared trial bot or one per tenant;
  and §62a (eqmimic service model + licence) stays open.
Full scoping in this session's handback; surfaces to touch for offboarding are in the report (member lockouts +
`mimic_sessions` revoke + `audit_log`, which today has no tenant key and is not append-only).

## §387 — Data ownership: the person keeps their data (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Person keeps their data across guilds*

The guild lead: *"A users data is their own. They can be associated with their guild but the individual should keep
their data."*
- **A, person-keyed rows.** Raid Mimic stores rows against the person, associated with a guild.
- **When a raider leaves:** the guild keeps its records under an anonymised `<Class>-<id>` placeholder, so there are no
  holes in fights or attendance. The raider leaves with their own logs, backups, wishlist and anything not observed in
  game or in DKP. The DKP/loot ledger keeps the name: it is the guild's book and already lives in OpenDKP.
- **Why:** the guild lead's own rule for it: *"if a person decides or leaves a guild, an anonymized '<class name>-<Uid>'
  fills the data so there's no holes. the guild accounts for their actions, the person leaves with their own physical
  logs and backups, wishlist, etc. anything not observed in the game or in DKP, which is already logged."*
- **Next:** not built; it shapes the Raid Mimic schema when that starts.

## §389 — Threat data: delete raw snapshots 30 days after the graph is stored (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Delete raw threat snapshots after 30 days*

- **B.** Raw threat snapshots are deleted after 30 days once the fight's graph is stored, **whether or not the home
  archive has them**. Why: the home-archive watermark has been stuck at 2026-09-06, and raw threat was 2.5 GB of the
  4.1 GB database (about 38 MB a day). Supersedes the "deletion waits on the archive" gate in §8.
- **NOT built.** The bot's nightly sweep still gates on the archive watermark. Open: also the "top of threat" rank rollup
  last ran 2026-08-19 and has stalled.
- **Next:** build the sweep (bot, main, outside a raid window); find why the rank rollup stopped. Both in the Open table.

## §397 — PostgREST's `ignore-duplicates` targets the primary key only; one duplicate no longer costs a batch (2026-10-20, bot 3.2.14)
*2026-10-20 · DECISIONS-2026-09-21.md · Duplicate-ignore fix so one dupe spares batch*

- **Fact (measured in the Postgres log):** `Prefer: resolution=ignore-duplicates` without `on_conflict` compiles to
  `ON CONFLICT("id") DO NOTHING`, so any OTHER unique index raised 23505 and rejected the whole batch: 220 a day on
  `encounter_events_dedup`, 3 on `faction_hits_dedup_idx`.
- **Fix:** `public.insert_ignore_duplicates(p_table, p_rows, p_return_rows default false)` (applied to production
  2026-10-20 through the MCP; migration `20261020200000`). `insertIgnoreDuplicates` routes through it, with a PGRST202
  fallback; it returns rows only when asked (egress).
- **Also in bot 3.2.14:** `encounter_combat_rollup` rows are sorted before upsert (deadlock), `charm_sessions` durations
  are rounded. Shipped to `main` 2026-10-21 01:20 UTC with web 1.9.19; Railway's builder reported "failed to fetch
  snapshot" for a while before it took.

## §423 — The open hub: anyone can join, a guild chooses at 12, history lives on the PC (2026-10-23, design + dormant rules)
*2026-10-23 · DECISIONS-2026-09-21.md · Open hub, guild stands up at 12 members*

The guild lead: *"Lets start with a buildout of the common 'anyone can join, once a guild has 12 members they need to stand up
their own or pay for the 25 hosting'. Usage logs will not be kept for long term on my storage, but instead be available in the end
user's mimic. If they auth into a guild's tenant they would be able to load in their data."*
- **The call:** a free "commons" anyone can sign into with Discord (identify only). A guild is a group of players who name it; the
  creator is the owner and promotes officers. At **12 active players** (uploads on 2 UTC days in 30, counted once per player, never
  characters or guests) the guild gets a notice with two doors, stand up its own (the wizard) or $25 hosting (§386), then a
  14-day grace (one extension), then `limited`: raid-wide uploads and new joins stop. A player's own Mimic never stops.
- **Short retention:** 6 h live state, 48 h raw threat, 3 d buffs, 7 d position minutes, 14 d events and rollup, 30 d raw parses,
  60 d encounters; about 8 MB a player held, against about 79 MB after six months at Wolf Pack's windows (measured 2026-10-23, 42
  players). The history is in the player's Mimic, which pulls down before the hub forgets. Disk dollars are tiny ($0.125 a GB);
  the gains are staying under 8 GB and not dumping a growing database to backup egress every night.
- **Tenancy:** a separate Supabase project and a headless copy of the bot (`HUB_MODE=commons`); `guild_id` moves from
  `process.env.SUPABASE_GUILD_ID` (123 identical reads in `index.js`) to the session token through one request-scoped helper that
  throws outside a request in commons mode; a route manifest and a two-tenant test stop an unscoped route shipping.
- **Tenant import (phase 5):** from the local copy, consent per guild and kind, only that guild's fights, other people's names
  `<Class>-<id>` twice over, signed, rate-limited, audited, revertable.
- **Costs:** hub about $13 / $24 / $72 a month at 10 / 50 / 200 players (estimated; storage measured); phase 1 about 15 build days,
  all five phases about 37.
- **Recommendation recorded:** run phase 1 as an invite-only closed beta; do not announce the commons until the gate (phase 3)
  exists; compress `/poll`, buff-queue and live-damage first (§386).
- **Where it landed:** `docs/DESIGN-open-hub.md`; five entries in `docs/DESIGN-selfhost-wizard.md` section 3; `utils/openHub.js`,
  `supabase/migrations/20261023160000_open_hub_registry.sql` (not applied; for the commons project, not Wolf Pack's) and
  `test/open-hub.test.js` on branch `draft/open-hub`. Nothing in a live request path.
- **Next:** the guild lead's eight picks (design section 12); then phase 1.

## §440 — Vercel's CPU warning: trim the waste in code, stay on the free plan (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Trim Vercel CPU use, stay on free plan*

Vercel emailed that the free team had used 75% of its monthly Fluid Active CPU (4 hours); past 100% the project is
paused, which takes https://wolfpack.quest and https://raidmimic.com down until the month resets. The guild lead picked
**A, trim the waste in code**, over B (Pro, $20/month) and C (move the web to Tower).
- **Measured: nothing.** Hobby shows no per-route CPU (Observability Plus is Pro-only) and keeps one hour of logs, so the
  causes were read from the code. The likeliest: /raid re-ran its server render every 15 s while open.
- **On main (web 2.1.38):** the middleware matcher skips mp4, webm, vtt, wav, mp3, ogg and tga as it already skipped
  images, so a playing video's byte-range requests no longer run the sign-in check and page-view logging.
- **On beta (web 2.1.38), to look at before main:** /raid refreshes every 60 s, only while visible and only in the raid
  window (Sun/Wed/Thu 19:30-00:30 ET); the raid timeline strip and the route planner poll every 30 s (were 10 s); the
  OpenDKP page every 60 s (was 30 s). Mimic's overlays are unaffected.
- **Next:** the guild lead can confirm the cause from Vercel → Usage → Fluid Active CPU (the per-function list) and the
  cycle's reset date. If the beta set holds, graduate it; if CPU still climbs, the next candidates are caching the
  raidmimic page (built per request today) and the shared-raid pages' minute refresh.
- **Measured, the same day (the guild lead's Vercel usage screenshots + page_views):** 3 h 4 m of 4 h in the last 30
  days, ~8.5 min a day (the allowance sustains ~8), 61% in the edge runtime (the middleware), 71% in iad1. page_views over
  7 days: **8,785 of 10,653 signed-in page requests came in bursts of 3+ per second per member**, i.e. Next's automatic
  link prefetches, not reads; the top routes were the menu items and /character/<name>. The /raid refresh was only ~575
  requests a week, so the earlier guess was the smaller cause.
- **Fix, on beta (web 2.1.39):** `next/link` resolves to `web/components/NoPrefetchLink.tsx` (prefetch off unless asked),
  wired in next.config.js both as a top-level alias and inside Next's own per-layer rule aliases, which Next 14.2 keys by
  the file path (`<next>/link.js`) and which otherwise win. Verified on a full production build: all 121 pages use it.
  `test/no-prefetch-link.test.js` runs the config. Links load on click, a moment slower. Recommended for main together
  with the /raid refresh change.
