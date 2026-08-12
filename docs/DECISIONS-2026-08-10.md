# Decisions — 2026-08-10

## Tank-buster callout moved from "as it happens" to a prep sequence

**The call (Hitya, post-Ssra):** the Emperor tank buster needs a warning at
**10s** ("big heals and spell shields") and at **4s** ("start curse cures") —
not a single announcement when it lands.

**Why.** The prep is a sequence, not a reaction: shaman/druid off-heals want to
be in flight ~10s out so they land *into* the hit, spellshields have to be up
before it, and curse cures started at 5/4/3s strip the curse the instant it
lands so the follow-up heal is fully effective. A callout at T-0 is too late for
every one of those. On the wipe pull Bardtholemu — who normally calls this
verbally — was busy stabilising after Lenolshot died, so the raid got nothing.
**That is the case automation exists for: the raid leader is a single point of
failure and is least available exactly when the raid most needs the call.**

**What was actually wrong.** Nothing missing in code. `guild_triggers` supports
multiple warnings via the `timer_warnings` jsonb column (agent 3.5.52, the
EQLogParser-parity work; the fleet is on 3.5.54/3.5.55, so every raider already
has it). The trigger `Emperor Ssra Tank Buster — countdown`
(`0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83`) simply had `warning_seconds = null` and
no `timer_warnings` — it spoke once on match, then counted 60s in silence.

**Applied 2026-08-10, DB only, no release:**

```sql
update guild_triggers set timer_warnings = '[
  {"seconds": 10, "text": "10 SECONDS. BIG HEALS AND SPELL SHIELDS.", "tts": true},
  {"seconds": 4,  "text": "START CURSE CURES", "tts": true}
]'::jsonb where id = '0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83';
```

Shape per `_timerWarnings`: `seconds` counts *before* expiry, `text` drives both
the overlay and the spoken line, `tts` defaults true. Sorted descending, so 10s
fires before 4s.

**Revert** (back to silence): `set timer_warnings = null`.

**Caveats.**
- The warnings inherit whatever accuracy the 60s cadence has. If the buster
  drifts, they drift with it — the « Earlier / ✓ Good! / » Too early buttons on
  the callout remain the way to correct it.
- This adds two spoken lines per 60s cycle, raid-wide, for the whole Emperor
  fight. That is a deliberate raid-noise trade against the alternative of the
  prep not happening. If it reads as too chatty, drop the 10s line first — the
  curse-cure call is the one with no verbal substitute mid-crisis.

## Emperor Ssraeshza: the melee proc, the Blood shell, and where playbooks live

**Three findings, all now live in production data rather than a doc.**

### 1. The Emperor casts TWO things, and the second explains the threat problem

Hitya spotted a second spell. It is not a spell — it is a **melee attack proc**:
`eqemu_npc_spells.attack_proc = 2981`, `proc_chance = 4`.

**Diminutive Stature** (2981), unresistable: **SPA 64 spin stun + SPA 114 −95%
aggro**, 5-tick duration, emote `<target> looks far less imposing.` It lands on
whoever he is meleeing, i.e. the main tank.

So the tank absorbs **two aggro wipes**: a guaranteed −95% every 60s from Rage of
Ssraeshza, plus a random −95% on 4% of swings. That is the mechanical reason dps
passes the tank, and it confirms Luter's "the tank is getting spin stun proc'd on
a lot" — SPA 64 *is* that stun.

Settled at the same time: **the buster has no healing component.** SPA 114 is
aggro, proven by the family — `Calming Visage` −5 / `Beguiling Visage` −50
("non-threatening") against `Haunting` +5 / `Horrifying Visage` +10
("threatening"), plus the `Voice of` hate line at +2/+4/+6/+10/+12. The Emperor's
spell list contains exactly one spell, so nothing else lands alongside. What
makes healing *feel* useless is the **−1000 AC**. The real 75% heal reduction is
the Devourers' proc, on the **offtanks**.

**Trigger created** (`d2f9b74d-80aa-4df2-94c7-fb8ff4ab7842`), broadcast, 15s
cooldown, on `^\[.+?\]\s+{s} looks far less imposing\.$` — anchored per the
CLAUDE.md rule so `{s}` cannot eat the timestamp.

⚠ **We cannot scope it to "currently attacking the Emperor."** `ZEAL_FIELDS` is
numeric-only (`target_hp_pct`, `self_hp_pct`, `group_min_hp_pct`), so there is no
target-name condition. The closest available is `applies_to_classes`, which the
bot DOES honour server-side when serving guild triggers. Scoped to
**Monk, Rogue, Ranger, Beastlord, Wizard, Magician, Necromancer** — tanks must
NOT back off, and healers/enchanters/bards have add duty. The callout says
"ON EMP? BACK OFF" and leaves the judgement to the player. Making it exact would
need a target-name zeal condition, which does not exist today.

### 2. We fight Blood of Ssraeshza, NOT the Ssraeshzian Blood Golem

Settled from our own `encounters`, not from a writeup: **162189
`#Blood_of_Ssraeshza` — 9 kills. 162493 `#Ssraeshzian_Blood_Golem` — 0
engagements, ever.** Same shell/real split as the Emperor. Strategy writeups link
162493; the mob is 162189, and its resists differ (MR **90**, not 60 — DR and PR
both 1000 either way, so disease is useless on Blood and is the *only* way into
the Emperor).

Also recorded: Blood is the **clock, not the fight**. One tank holds it while add
control happens; killing it starts the 2m10s Emperor countdown and is a one-way
door.

### 3. Playbooks belong on wolfpack.quest, not in a chat artifact

Hitya: *"where are these artifacts getting placed? our point is to have these
things in our Wolfpack quest."* Correct — Claude artifacts live on claude.ai and
are fine for drafting, wrong as a destination.

The home already existed: **`/guide/<internal_id>`**, whose Approach block renders
`bosses_local.strat_notes` as pre-wrapped plain text (no markdown). Both rows were
empty and are now written — `emperor_ssraeshza` (6.3k chars) and
`blood_ssraeshza` (2.4k). No deploy needed; the page reads the DB.

The guide index doubles as an authoring worklist, sorted so the bosses we kill
most with nothing written float to the top. **Write strategy there, not into a
doc or a chat page.**

## RULE: when `main` gets something, `beta` gets it too

**The call (Hitya, 2026-08-10):** beta must track main continuously, not be
re-synced at graduations.

**Why.** Re-syncing by hand was already the documented practice and it still did
not work, because a re-sync is a snapshot rather than a link. Measured: the
2026-08-09 re-sync landed 02:05 UTC, main took 50 more commits over the next day
and a half, and by the next graduation beta was 7,714 deletions behind — three
test files and a whole `/about` page main had gained *after* the snapshot.
Nothing on beta was deleted; main moved forward, at 12–42 commits/day, because
bot, web and docs all land there. Any rule that depends on remembering loses to
that rate.

**Where it landed.** `.github/workflows/sync-beta.yml` — merges main into beta on
every push to main, serialised so two quick pushes cannot race. Rule + rationale
in `CLAUDE.md` → Branches.

- The two deliberately-ahead version files keep beta's side on conflict: the
  Mimic park (`apps/mimic/package.json`) and the in-flight agent version. A park
  at or below stable would tag prereleases sorting BELOW it and the updater would
  stop offering betas.
- Any other conflict **fails loudly** instead of auto-resolving — that means the
  branches diverged on shared code, and silently picking a side loses work.
- Pushes with `GITHUB_TOKEN`, which by design does not trigger `on: push`
  workflows: no spurious `-beta.N` (the release feed caps at 10 and filling it
  once broke beta updates fleet-wide), no duplicate CI. If anyone swaps it for a
  PAT, add a `[sync]` guard to `release-mimic.yml` in the same change.

**What it does NOT change.** A `beta → main` branch merge is still unsafe: beta
carries the park and in-flight Mimic work, so graduations remain file-level
promotions. The sync removes the drift, not the direction.

**Verified on the first run** (2026-08-10): beta contains all of main, the park
held at 2.3.6 against the 2.3.5 stable, and the files that previously showed as
deletions are present on beta.

## Boss zone audit — `bosses_local.zone_short` had drifted from the repo seed

**Reported (Hitya):** `/parses` filed Galiel Spirithoof under *Plane of Mischief*.

**It is Plane of Growth**, and the error was in the database, not the page.
`bosses_local.zone_short` said `mischiefplane`; `data/bosses.json` — the seed —
correctly says "Plane of Growth". The DB drifted from the repo.

**Method — three independent sources, not one guess.** For every boss:
1. `data/bosses.json`, the committed seed;
2. the npc-id convention (`id = zoneid*1000 + n`, per the catalog cheat-sheet);
3. the **authoritative** `spawnentry → spawn2` join, which carries real placement
   data (the denormalised `eqemu_npc_types.zone_short` is NULL catalog-wide, so
   this join is the documented way to read a mob's zone).

Nine rows disagreed with the id convention. Only fixing the reported one would
have left eight.

**Fixed (≥2 sources agreeing), 6 rows in `bosses_local` + 35 in `encounters`:**

| boss | was | now |
|---|---|---|
| galiel_spirithoof | mischiefplane | growthplane |
| master_yael | chardok | hole |
| nortlav_scalekeeper | chardok | hole |
| kelorek_dar | *(null)* | cobaltscar |
| severilous | *(null)* | emeraldjungle |
| ssraeshzian_blood_golem | *(null)* | ssratemple |

The encounter backfill reached back to **January 2025** — Galiel was mis-zoned on
8 separate kill dates and Severilous carried no zone across 20.

**Deliberately NOT fixed — needs a human, all PoP (locked until 2026-10-01):**

- `bertoxxulous` — seed and DB both say `podisease`; only the id convention says
  `codecay`, and it has **zero spawn points**, so nothing corroborates. Two
  sources against one is not enough to overwrite.
- `aerin_dar` (seed+DB `postorms` vs spawn `povalor`) and `agnarr_storm_lord`
  (seed+DB `postorms` vs spawn `bothunder`) — here the *spawn* data contradicts
  both the seed and the DB. Spawn placement is the stronger source, so these are
  probably wrong in the seed too, but they are locked content nobody can verify
  in-game right now.

**Add to the PoP unlock checklist** (alongside `/board` and refreshing
`pqdiUrl`s): re-run this audit and settle those three against PQDI.

**Re-runnable audit** — the query that found it, worth repeating after any boss
import:

```sql
select b.internal_id, b.zone_short as recorded, z.short_name as by_npcid,
       string_agg(distinct s2.zone_short, ', ') as by_spawn_join
from bosses_local b
join eqemu_zone z on z.zone_id = (b.npc_id / 1000)
left join eqemu_spawnentry se on se.npc_id = b.npc_id
left join eqemu_spawn2 s2 on s2.spawngroup_id = se.spawngroup_id
where b.zone_short is distinct from z.short_name
group by b.internal_id, b.zone_short, z.short_name;
```

## RULE: shipping updates the docs at both gates (2026-08-11)

**The call (Hitya):** *"implementation of a feature or fix must update that
documentation once it graduates to beta, and upon shipping to main it needs to
be updated again with the stable release version."*

**Why:** the 2026-08-11 `/recall` run reported #202 (clock offset at ingest) as
"blocked on the call" — it had shipped in bot 3.1.20 and was extended twice
since. The ledger lagged the code by weeks, and a stale ledger produces
confidently wrong answers for every future session. Landed in `CLAUDE.md`
(Release playbook, above the commit conventions) and as the standing note in
`STATUS.md`'s 2026-08-10→11 section.

## Open — read this first (refreshed 2026-08-11)

| Item | State |
|---|---|
| **#204–#207 implementations** | Four Opus agents dispatched 2026-08-11 (DI callout, group-HP death watcher, instant-mechanic capture, callout overlay UX) — review + integrate to beta; only #207 is testable by Hitya without a raid |
| **Dead-trigger risk FLIPPED** | 3.5.54+ compiler revives `^`-anchored rows as the fleet updates to 2.3.5 — expect surprise callouts Wednesday; re-audit the 37 before/at the raid (`STATUS.md`, reconciled entry) |
| **Task #27 unblocked** | Restore the 8 muted trash triggers once raiders are on 2.3.5; TTS stays off unless asked |
| **Buff/debuff queue + CH DDR** | Open questions walked through with Hitya 2026-08-11 — answers pending |
| **Kill switches untested** | Unchanged — never pulled in the field |
| **Timer-warning sweep** | Which timer triggers have a duration but no `timer_warnings`? Emperor's was a blank field |
| **PR #78** | CLOSED 2026-08-11 (diff had become the 2.3.6 park — merging would have cut an accidental stable) |
| **PoP unlock checklist** | + settle bertoxxulous / aerin_dar / agnarr zones against PQDI |

## Buff/debuff queue: anyone resolves, ephemeral store (Hitya, 2026-08-11)

The two questions that were still live in `DESIGN-buff-debuff-queue.md`:
**anyone can resolve** a queue item (everyone-workflow philosophy — a wrong
resolve costs one re-enqueue; a locked resolve costs a stale queue mid-fight),
and the store is **ephemeral** (in-memory ring on the bot, ~1h TTL, trigger-relay
shape — no table, no migration). The other three questions were overtaken by
shipped code and are marked so in the design doc. Remaining build: the shared
manual layer + one-click resolve on the existing auto queues.

## Unraid Supabase: backup first, then dev sandbox (Hitya, 2026-08-11)

Not the live replica. Ordering matters twice over: the nightly `pg_dump` needs
only the SESSION pooler (IPv4 — the replication path's IPv6/IPv4-add-on caveat
vanishes), and the dump becomes the sandbox's seed data. Phase 1 is committed
copy-paste ready (`scripts/unraid-backup-supabase.sh` + runbook §Phase 1;
execution is a needs-local-session item). Phase 2 (supabase CLI sandbox) waits
on Phase 1 proving out — and its first `db reset` doubles as the first-ever
test of whether the 193 committed migrations rebuild the live schema.

## Unraid Phase 1 PROVEN, and four bugs it flushed out (2026-08-11)

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

## Local wolfpack.quest: Coolify in a VM, pointed at the LOCAL Supabase (Hitya, 2026-08-11)

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

## Local mirror automation: pull, don't expose (2026-08-11)

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

## Self-hosting: the repo could not rebuild its own schema (measured 2026-08-12)

Goal from Hitya: let another guild run this without the hosting bill, and drop
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
history on a project where the tables already exist. **Open call for Hitya:**
commit them as real migrations / squash to a baseline, or keep bootstrap as the
fresh-install path. The six tables are created EMPTY — per-guild data, never ours.

Still open and unchanged: the ~97 MB `eqemu_*` catalog has no self-serve import,
and the ~30 hand-copied Discord anchor IDs remain the likeliest place a new guild
gives up.

## Automation that fails where nobody looks (2026-08-12)

`sync-beta` failed on EVERY push for eight consecutive commits and beta sat eight
hours stale — the precise rot the workflow was built to prevent. It behaved
correctly the whole time: it refused to auto-resolve and it left a red X. The
failure was that a red X in the Actions tab is not a notification.

Three fixes, in order of durability: `.gitattributes` sets `merge=union` on the
append-only ledgers (`docs/DECISIONS-*.md`, `docs/STATUS.md`) so the cause cannot
recur — both branches only append, so keeping both sides is always right, and it
is scoped away from code and CLAUDE.md where a conflict is real information;
beta was re-merged by hand with both sides kept; and the workflow now posts to
Discord on failure, gated on a `DISCORD_SYNC_WEBHOOK` secret so forks and
self-hosters do not fail on a missing one.

The general rule this bought: **automation that reports failure only where nobody
looks is indistinguishable from automation that does not run.** Applies equally
to the mirror's autodeploy poller and the nightly backup — both already log, and
both need somewhere the log is actually read.

## The migration pipeline was stalled, and it was hiding a broken feature (2026-08-12)

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

## PostgREST's 1000-row cap was silently wrong across the site (2026-08-12)

Hitya asked whether rolls were limited to 1000 looted items. They were — and so
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
