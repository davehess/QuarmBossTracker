# DESIGN — External tenancy: letting other guilds use Mimic + the platform

*Status: **DESIGN ONLY**, nothing built, nothing changed. Written 2026-08-02
against `origin/main` @ `13fb678`. Every number below was verified against the
live Supabase project (`zhtoekwakucbckvatfky`) or the repo; where something is
unverified it says so in bold.*

**Hitya's ask (verbatim):** *"I would like to Enable other guilds to use miMIC
either hosted themselves or with me. We have a fairly complex deployment, i'm
curious how much people could put this together in their own instances. Can you
start a process for external deployment, or tenant deployment within our
supabase"* — plus, moments later: *"can you also leave out pieces of the PVP
/who for that buildout? We don't want to give away our advantage for nothing."*

> **UPDATE 2026-08-12 — two of the three abandonment points are now closed, and
> the schema question is answered with numbers.** Self-hosted Supabase and the
> web app outside Vercel were both stood up and verified end to end
> (`docs/RUNBOOK-unraid-supabase-replica.md`, `docs/RUNBOOK-local-web-coolify.md`),
> and the bot was already containerized. On "170 migrations + no catalog": applying
> the now-193 migrations to an empty Postgres gives **182 clean / 11 failed —
> unusable**, because SIX tables production uses are created by no migration at all
> (`fun_events`, `pvp_kills`, `pvp_boss_kills`, `pvp_assists`, `mimic_sessions`,
> `trigger_timing_feedback`) — out-of-band applies whose files were never
> committed. With `supabase/bootstrap/` + `scripts/selfhost-bootstrap-db.sh` it is
> **190 clean / 3 partial / 0 failed, 124 tables, 79 functions**, and the partials
> create no schema. The catalog gap and the ~30-anchor-ID Discord ceremony are
> unchanged, and remain the likely give-up points. Guide: `docs/SELFHOSTING.md`.

---

## 0. TL;DR — the recommendation in one page

**Answer to "how much could people put this together themselves": today, almost
nobody would finish.** Not because the code is bad, but because the deployment
is a four-surface distributed system whose Discord half is configured by
~30 hand-copied message/channel/thread IDs, and whose data half is 170
migrations + a 97 MB reference catalog that has no self-serve import path. My
honest estimate for a competent-but-not-expert guild officer, working alone from
today's `README.md`, is **8–20 hours spread over a week, with a ~70–80% chance of
abandonment**, and the most likely give-up points are (a) the anchor-ID ceremony
in "First-Time Setup Order", (b) Supabase project + 170 migrations + no catalog,
(c) the first time something silently doesn't work and there is no diagnostic.

**Full multi-tenancy on our Supabase is a bigger job than it looks and is the
wrong first move.** The blocker is not the 35 tables missing `guild_id`. It is
that **tenancy is currently a property of the bot PROCESS, not of the request**:
`SUPABASE_GUILD_ID` is read from `process.env` at ~40 call sites and stamped on
writes, while the agent identity (`mimic_sessions` → `wolfpack_members`) carries
no tenant at all, and the web makes **522 Supabase queries of which only 148
filter `guild_id` — and it holds the service-role key, so RLS does not stop the
other 374**. One bot process = one tenant is the current architecture, and
that's actually fine — it's the *shared-process* variant that's expensive.

**Recommended shape (Model C, hybrid), in this order:**

1. **Ship the catalog, not the platform.** Publish the `eqemu_*` mirror as a
   read-only public resource (it already is `anon`-readable; 97 MB, 31 tables,
   already synced weekly). That is the single most valuable, lowest-risk,
   lowest-support thing we own that another guild wants, and it costs us one
   documentation page and a rate limit. **Zero tenancy work required.**
2. **Make Mimic point somewhere else cleanly.** `cfg.botUrl` is already a
   Settings text field and the agent already takes `--bot-url`; what's missing
   is that the *sign-in* URL, the `wolfpack.quest` deep links and the branding
   are hardcoded. Roughly a day's work to make one Mimic binary serve any bot.
3. **"Bring your own Postgres, borrow our brain."** A self-host bundle where
   the guild runs bot + web + their own Supabase, but points `eqemu_*` reads at
   our shared catalog. Needs a one-command bootstrap (`/setup` doing what the
   README's ten manual steps do) and a schema-squash migration.
4. **Only then**, if there is demand and Hitya wants the hosting business,
   do real multi-tenancy — and do it as **bot-process-per-guild against a
   schema-per-tenant Supabase**, not one shared bot with row-level tenancy.

**PvP carve-out: recommendation is `who_observations` moves to a separate
Supabase project entirely, and the PvP *code* ships but starts empty.** Details
in §2 — this is designed as a first-class constraint, not a filter we remember
to apply.

---

## 1. Verified ground truth

Everything in this section was checked, not assumed. Method in the right column.

| Fact | Value | How verified |
|---|---|---|
| Public tables | 124 | `pg_class` where `relkind='r'`, schema `public` |
| `eqemu_*` reference mirrors | 31 tables, **97 MB** | same query, `relname like 'eqemu_%'` |
| Guild data | **833 MB**; whole DB **947 MB** | `pg_total_relation_size` split |
| Tables carrying `guild_id` | 52 non-`eqemu_` | `information_schema.columns` |
| Non-`eqemu_` tables WITHOUT `guild_id` | **35** (coordinator said 34 — the difference is classification of one reference-ish table, see §4.2) | listed in §4.2 |
| Distinct `guild_id` values in prod | exactly one: the string **`'wolfpack'`** (not a Discord snowflake) | `group by guild_id` across 7 largest tenant tables |
| Migrations | **170** files, `20260525120000` → `20260802031500` | `ls supabase/migrations` |
| Env vars in `.env.example` | **113** `KEY=` lines in a 527-line file | grep |
| Slash commands | **83** files in `commands/` | `ls` |
| Hardcoded Wolf-Pack literals | **213 occurrences across 66 files** | grep for the 6 literals |
| RLS | enabled on all 124 tables; **most tenant policies are `qual: true` for `authenticated`** | `pg_policies` |
| Bot DB role | `service_role` (bypasses RLS) | `utils/supabase.js` |
| **Web DB role** | **also has service-role** (`supabaseAdmin()` in `web/lib/supabase.ts` + `web/lib/officer.ts`), used in 89 files | grep |
| Web Supabase queries | **522 `.from(` calls**, of which **148** hardcode `.eq('guild_id','wolfpack')` | grep |
| Bot tenancy plumbing | `process.env.SUPABASE_GUILD_ID \|\| 'wolfpack'` at ~40 sites incl. `utils/supabase.js:18` | grep |
| Agent identity | per-user opaque bearer `wpms_…` → `mimic_sessions` → `wolfpack_members`. **Neither table has a tenant column.** | `utils/mimicLink.js`, schema |
| Mimic bot URL | `cfg.botUrl`, default `https://wolfpackparse.up.railway.app/api/agent/encounter`, **editable in Settings** (`apps/mimic/settings.html:52`) | read |
| Agent bot URL | `--bot-url` flag / `WOLFPACK_BOT_URL` env, same default | `packages/wolfpack-logsync/index.js:64` |
| Discord intents needed | Guilds, GuildMembers, GuildMessages, GuildVoiceStates (+ optional MessageContent behind `MESSAGE_CONTENT_INTENT=1`) | `index.js:254` |
| Catalog source | `SecretsOTheP/EQMacEmu` weekly tarball, parsed by `scripts/sync-from-eqmac.js`, whitelist of 10 upstream tables | read |

### 1.1 The number that should shape the hosting conversation

What one actively-raiding guild costs in Postgres, measured:

| Table | Size | Bounded? |
|---|---|---|
| `encounter_threat_snapshots` | **384 MB** (452,501 rows, 2026-07-02→08-02) | Yes — 30-day sweep + 7-day 1/min downsample (`index.js:2915`, `THREAT_SNAPSHOT_RETENTION_DAYS`) |
| `chat_messages` | **180 MB** over ~9 weeks | **No retention sweep** — accumulates ≈20 MB/week |
| `who_observations` | 80 MB | Yes — `WHO_OBS_RETENTION_DAYS` |
| `buff_casts` | 51 MB | Yes — 7-day sweep |
| `opendkp_audits` | 22 MB | No |
| `encounter_combat_rollup` | 14 MB | No |
| **Total guild data** | **833 MB** | — |

So the honest picture is **≈500 MB of bounded steady state per guild, plus
≈100 MB/month of unbounded growth dominated by `chat_messages`.** Not the
runaway I first read it as — three of the four biggest tables already have
retention, which is good engineering we should take credit for.

Still: Supabase Pro includes 8 GB. **Wolf Pack alone is 947 MB.** Five hosted
tenants at our raid cadence is ~4 GB of steady state before a month of growth,
and `chat_messages` has no sweep. Whatever else we decide, "host with me" has a
real recurring marginal cost per tenant — see §5.6 and the open questions. (A
`chat_messages` retention policy is worth having regardless of tenancy.)

---

## 2. The PvP carve-out (read this before designing anything else)

### 2.1 What's actually being protected

The protected asset is **`who_observations`**, and it is not guild data. Verified:

- **110,652 rows**, **80 MB**
- **12,281 distinct characters**, of whom **11,865 are not in our `characters`
  table** — i.e. ~97% of it is other people
- **52 distinct guild names** observed
- observation window **2023-11-10 → 2026-08-02** — nearly three years of
  accumulation, including imports predating the platform
- **241 rows in `who_overrides`** (the manual de-anonymization corrections)
- **54 rows / 38 characters** carry `inferred_zek_at` + `inferred_zek_evidence`
  — the PvP-proximity inference

It has a `guild_id` column, and every row says `'wolfpack'`. That column is a
*lie about the data's nature*: it records who **we** saw, but what it contains
is a server-wide census — name, level, race, class, guild, guild rank, zone,
anon flag, GM flag, timestamped to the minute. Combined with `who_overrides` it
de-anonymizes players who are deliberately anonymous. On a PvP-enabled server
that is exactly the "advantage" Hitya means.

Related tables in the carve-out: `who_overrides`, `pvp_kills` (528),
`pvp_boss_kills` (381), `pvp_assists` (54), `pvp_quake`, `hate_kills` (27).
Those are much smaller and much less sensitive — they're *our* kill history. The
crown jewel is `who_observations` + `who_overrides`.

### 2.2 The enforcement problem, stated honestly

"We just won't query it for tenants" is not an answer, for three specific
reasons that exist in the code today:

1. **The web holds the service-role key.** `supabaseAdmin()` bypasses RLS
   entirely and is used in 89 files. Any tenant-facing page that reaches for it
   — or any future page whose author forgets — can read the whole table.
2. **The current RLS policy on `who_observations` is `who_obs_read` for
   `authenticated` with `qual: true`.** In a multi-tenant world, "authenticated"
   would include every tenant's members. Today that policy is harmless because
   there is one guild. On day one of tenancy it becomes a full data leak that
   requires no bug, no exploit, and no mistake — just a tenant signing in.
3. **The harvest path is coupled to PvP ingest.** `/api/agent/pvp` and
   `/api/agent/pvp_assists` *both* upsert into `who_observations`
   (`index.js:4611`, `index.js:5055`), plus two more paths at `index.js:509`
   and `index.js:13909`. There is no single choke point to disable.

### 2.3 Recommended enforcement — three layers, in priority order

**Layer 1 (the real one): a separate Supabase project.**
Move `who_observations`, `who_overrides` and the `pvp_*` / `hate_kills` tables
to a second Supabase project that **only our own bot process has credentials
for** (`SUPABASE_PVP_URL` / `SUPABASE_PVP_SERVICE_KEY`, unset everywhere else).
A tenant's bot has no credential, a tenant's web has no credential, and a bug in
a shared query cannot cross a project boundary. This is the only mechanism on
this list that is not defeated by a code mistake.

Cost: a second project (free tier fits 80 MB comfortably), a cross-project
client in `utils/supabase.js`, and the `/whois` + `/who` + `/pvp` surfaces
learn a second connection. Estimated **1–2 days**, and it is worth doing
*even if we never ship tenancy*, because it also fixes the "the web can read
everything" exposure that exists right now.

**Layer 2 (defense in depth): deny-by-default RLS + a self-scoped view.**
Even inside our own project, replace `who_obs_read (qual: true)` with a policy
that denies `authenticated` outright, and expose a
`who_observations_self` view filtered to `guild_id = current tenant` for the
legitimate "who did *my* guild see" use case. A self-hosting or tenant guild
naturally builds its own observations from its own raids — that is fine and
expected. What must not happen is a tenant reading *ours*.

**Layer 3 (belt): schema separation as a tripwire.**
Move the tables to a non-`public` schema (`intel.who_observations`). PostgREST
only exposes schemas listed in its config, so a mis-scoped query 404s rather
than returning rows. Cheap, and it makes accidental use loud.

Do Layer 1. Do Layer 2 regardless. Layer 3 is optional if Layer 1 lands.

### 2.4 Does the PvP *code* ship in the self-host bundle?

There is a defensible argument each way, so here is the argument and then a
recommendation.

**Argument for withholding the code:** the parsing rules for `/who` output,
the anon de-anonymization heuristics, the `inferred_zek_*` proximity inference,
the multi-relayer dedup in `_isPvpDupe`, the respawn-window prediction — those
represent real design work. Handing them over lowers the cost for a rival to
build the same intelligence asset from scratch.

**Argument for shipping it:** the advantage is **the accumulated data, not the
code**. Three years and 110k observations cannot be re-derived by reading our
source. Meanwhile withholding the code is expensive and leaky: PvP is
**305 `pvp|PVP` references in `index.js`, 164 in the agent, and 16 of the 83
slash commands** (`pvpalert`, `pvphate`, `pvphatekill`, `pvpkill`,
`pvpnightpings`, `pvprole`, `pvpspawn`, `pvpunkill`, `quake`, `hateboard`,
`livehate`, `livehatekill`, `who`, `whoall`, `whoimport`, `whois`). Maintaining
a code-stripped fork means a permanent second branch, divergent tests, and a
merge tax on every release — and the `/who` harvest is structurally *inside* the
PvP ingest handlers, so stripping it cleanly is surgery, not deletion.

**Recommendation: ship the code, withhold the data — and make that the stated
policy.** Concretely:

- The self-host bundle contains the PvP + `/who` code, unmodified. A guild that
  runs it accumulates **their own** `who_observations` from **their own**
  raids. That's their asset, built with their effort, and we should be happy
  for them to have it.
- The bundle ships with `who_observations` **empty** and no import path from
  ours. The 241 `who_overrides` never leave.
- `/api/agent/who-lookup` on *our* bot serves *our* de-anonymization cache. A
  tenant's Mimic pointed at their own bot gets their own cache. A tenant's
  Mimic must **never** be allowed to point at our bot for who-lookup while
  storing elsewhere — which is naturally prevented by Layer 1, since our bot
  only answers requests from sessions in our own `mimic_sessions`.
- For a **hosted tenant on our Supabase**, PvP features are **off by design**,
  not merely unqueried: their bot has no PvP-project credential, so
  `/api/agent/pvp` 503s and the `/pvp`, `/who`, `/whois` surfaces are absent
  from their web build. Say this in the tenant agreement, not just in code.

One caveat to flag honestly: **a hosted tenant's agents still run the same
parser**, so if we ever ingest their `/who` uploads into a shared table we'd be
*receiving* their intelligence. That is a trust question for Hitya (§10), not a
technical one — but the default should be that we don't collect it.

---

## 3. What a tenant actually gets — feature matrix

Legend: **P** = portable as-is · **P\*** = portable but needs config the guild
must supply · **WP** = Wolf-Pack-specific, needs rework or is meaningless
elsewhere · **✖** = deliberately withheld.

| Feature | Where it lives | Class | Notes |
|---|---|---|---|
| Raid timers / boss boards | `index.js`, `data/bosses.json` (133 bosses) | **P** | `bosses.json` is generic Quarm data — zone, expansion, timer hours, PQDI links. Genuinely portable. |
| Expansion threads + anchored cards | `index.js` + ~30 env IDs | **P\*** | The env-anchor ceremony is the single biggest setup burden. See §4.1. |
| Parse aggregation → Supabase | `utils/supabase.js`, RPCs | **P\*** | Needs their own Supabase + all 170 migrations. |
| Agent / Mimic ingest surface | `/api/agent/*` | **P** | Works against any bot URL. |
| DPS HUD, Tank, Command Center, Charm/Pet, Melody, Mob Info | Mimic overlays | **P** | Pure client-side; no Wolf Pack coupling. |
| Zeal pipe bridge | `apps/mimic/zealPipe.js` | **P** | Client-side. |
| Triggers (guild + personal) | agent + `/admin/triggers` | **P** | Guild set is per-deployment data. |
| CH chain tracker + DDR | agent + `chchain.html` | **P** | Parses raid chat callouts; conventions are EQ-generic. |
| Buff / debuff / cure queue | `raid-buff-queue` | **P** | `_CURSE_COUNTERS` is Quarm-content data, portable. |
| UI Studio + cloud backup | Mimic + `ui_snapshots` | **P\*** | Needs their own `WISHLIST_BID_KEY`. |
| Mob Info / spell + item catalogs | `eqemu_*` | **P\*** | **This is the thing they can't easily get.** See §4.3. |
| Raid Night Review, Raid Guide | `utils/raidReview.js`, `web/lib/raidGuide.ts` | **P** | Generated from their own history. Empty until they have one. |
| Roll-loot / Hot Dice nights | `utils/rollLoot.js`, `hotDiceNight.js` | **WP-ish** | Encodes *our* roll conventions (`/random` ranges, session winner). Portable code, opinionated rules. |
| Raid-night windows (Sun/Wed/Thu 20:00 ET) | `raidEvents.js`, `timeWindow.ts` | **WP** | Now driven by Discord scheduled events (good), but `RAID_EVENT_RAID_DAYS` still defaults to our nights and several web helpers hardcode the window. |
| OpenDKP integration | `utils/opendkp.js`, `openDkpSync.js`, 7 `opendkp_*` tables | **WP** | Requires *their* OpenDKP instance + Cognito creds. Throws if unset — see §4.4. Should become a feature flag. |
| Wishlists / sealed bids | `wishlists`, `bidCrypto.js` | **P\*** | Needs their `WISHLIST_BID_KEY`; the encryption boundary is sound. |
| Roster in Discord threads | `utils/roster.js` | **P\*** | Two thread IDs. |
| Onboarding + CHANGELOGS | `utils/onboarding.js` | **WP** | 30 occurrences of `wolfpack.quest` — it's *our* changelog, literally. |
| Member sync (Discord → members) | `utils/wolfpackMembers.js` | **P\*** | Table is literally named `wolfpack_members`. |
| Officer console + runbooks | `/admin/console`, `web/lib/runbooks.ts` | **WP** | Every runbook is grounded in a dated *Wolf Pack* incident. Ships fine; reads oddly. |
| Web member surfaces (`/me`, `/parses`, `/raid`, …) | `web/` | **P\*** | Needs their own Vercel + Discord OAuth app. |
| Demo / obfuscation mode | `web/lib/obfuscate.ts` | **P** | Already has a per-guild salt env var — nice precedent for tenancy. |
| **PvP kills / hate / quake boards** | 16 commands, `pvp_*` tables | **✖ data / P code** | See §2.4. |
| **`/who`, `/whois`, who-lookup de-anon** | `who_observations`, `who_overrides` | **✖ data / P code** | The carve-out. Ships empty. |

---

## 4. Model A — self-hosted. Walking the actual path.

This section is deliberately unkind. The question was "how much could people put
this together in their own instances," and a flattering answer is useless.

### 4.1 Step by step, with the real friction

**Step 1 — Discord application (30–45 min, low risk of failure).**
Create an app, bot user, token, invite with the right permission integer.
Intents: Guilds, GuildMembers (**privileged — must be toggled in the portal**),
GuildMessages, GuildVoiceStates. `README.md:228` covers this adequately. Message
Content is optional (`MESSAGE_CONTENT_INTENT=1`). *Realistic failure mode:* they
miss the privileged Server Members intent, the bot connects, and member sync
silently never works. There is no startup check that says so.

**Step 2 — Supabase project + 170 migrations (1–3 hours, HIGH risk).**
There is no documented path for this. Our migrations auto-apply via the GitHub
integration on merge to `main` — a fork owner would need to replicate that
integration or run `supabase db push` against 170 files, several of which were
written knowing the prior state of *our* database. **I did not attempt a
from-scratch replay and cannot claim the chain applies cleanly on an empty
project.** That's an unverified assumption in the current story and the first
thing to test if we pursue this.

**Step 3 — the `eqemu_*` catalog (BLOCKING today, see §4.3).**

**Step 4 — env vars (2–5 hours, HIGH risk of abandonment).**
113 declared vars. The README's "Required" table is 13, plus 6 platform vars,
plus ~14 "hardcoded slot anchors (recommended)". But the *anchors are only
obtainable after the bot is running*, per the README's own "First-Time Setup
Order": create five expansion threads by hand, create four more named threads by
hand, paste nine IDs, deploy, run `/board`, then **right-click each of ~14
generated messages, Copy ID, paste into env, redeploy, run `/board` again to
confirm nothing re-posts**. That is a 10-step ceremony involving two deploys and
about 25 manual snowflake copies, and if any one is wrong the failure is silent
(a duplicate card, or an edit that lands in the wrong thread). **This is the
step where I expect most people to quit**, and it's the one identified in
`CLAUDE.md` as "probably the single biggest multi-tenant blocker."

**Step 5 — Railway + Vercel (45–90 min, medium risk).**
`railway.toml` and `Dockerfile` exist; `/health` readiness is wired. The web
needs its own Vercel project, its own Discord OAuth app (a *second* Discord
application config — the callback URL differs), `SUPABASE_SERVICE_ROLE_KEY`,
`ALLOWED_ROLE_NAMES`, and `DISCORD_GUILD_ID`. Note `web/lib/discord.ts:9`
defaults `GUILD_ID` to **our snowflake** — a guild that forgets to set
`DISCORD_GUILD_ID` gets a site that silently gates against Wolf Pack.

**Step 6 — OpenDKP (0 min if skipped, 2+ hours if not; see §4.4).**

**Step 7 — Mimic (blocked today, see §7).**
Their raiders would install *our* Mimic, then each individually edit the bot URL
in Settings — but sign-in would still send them to `wolfpack.quest/auth/mimic-link`,
which is our site and would not know them.

**Step 8 — the 213 literals.**
Most are cosmetic: comments (~40%), and ~20 `wolfpack.quest` deep links baked
into the agent's `WEB_HTML` dashboard, plus 30 in `utils/onboarding.js`. They
don't break anything; they make the product read as somebody else's. The ones
that *are* load-bearing are small in number and mostly already have env
fallbacks — `ALLOWED_ROLE_NAMES` defaults to `'Pack Member'` (`utils/roles.js:9`),
`OPENDKP_CLIENT_NAME` defaults to `'wolfpack'` (`utils/loot.js:260`),
`MIMIC_LINK_VERIFICATION_URL` defaults to our URL (`utils/mimicLink.js:25`),
`WEB_BASE_URL` defaults to ours (`index.js:5364`). Two known-id fallbacks are
hardcoded with no env escape at the *final* fallback position:
`RAID_CHAT_CHANNEL_ID` → `1193692008812920863` and `EVENT_CHAT_CHANNEL_ID` →
`1194336972785848380` (both documented in `HOW-ITS-BUILT.md`). For another guild
those resolve to channels the bot can't see; the code permission-checks each
candidate and logs rejections, so it degrades rather than crashes — but it's
still wrong-by-default.

### 4.2 The 35 tables without `guild_id`, and what to do with each

Verified list. My classification, with reasoning — this is the "decide per table"
the coordinator asked for.

**(a) Child tables — tenancy flows through a parent FK. Do NOT denormalize (5):**
`encounter_players`, `contributions`, `combat_events`, `loot_drops`,
`opendkp_auction_bids` → all reachable via `encounter_id` / `auction_id`.
*Reasoning:* denormalizing invites drift (a row whose `guild_id` disagrees with
its parent's is a silent cross-tenant leak that no constraint catches). The
correct fix is an RLS policy using an `EXISTS` subquery on the parent, exactly
as the existing `tells read own only` policy already does. **Cost:** the
subquery is on the hot parse-read path — `encounter_players` is 35k rows and
`contributions` 3.2k, small enough that an index on the FK makes this a
non-issue. *Caveat: I did not benchmark it.*

**(b) Genuinely tenant-scoped, need a real `guild_id` (12):**
`audit_log`, `bosses_local`, `bot_boards`, `officer_notes`, `wishlists`,
`ui_snapshots`, `page_views`, `rh_signups`, `mimic_sessions`,
`mimic_link_codes`, `wolfpack_members`, `wolfpack_roles`.
The last four are the important ones: **they are the identity spine**, and
without a tenant column `requireAgentAuth` cannot tell you *whose* guild an
upload belongs to. Any multi-tenant design starts here.

**(c) The `opendkp_*` family (6): `opendkp_adjustments`, `opendkp_audits`,
`opendkp_loot`, `opendkp_raids`, `opendkp_ticks`, `opendkp_auctions`.**
These mirror an *external* system that is already per-guild
(`<client>.opendkp.com`). Recommend `guild_id` **plus** keeping
`OPENDKP_CLIENT_NAME` as the natural key, because two guilds can have colliding
raid/loot ids upstream. **Do not merge these into shared tables.**

**(d) PvP carve-out (1): `hate_kills`** — moves with §2 regardless.

**(e) Actually shared reference data — leave alone (8):**
`spell_level_seed` (PQDI scrape), `quest_required_item`, `scripted_npc_turnins`,
`travel_paths`, `locked_zone_keys`, `patch_notes`, `sync_meta`, `ui_window_usage`.
These are Quarm facts or platform infra, not guild data. *(This is where my count
of 35 and the coordinator's 34 diverge — one of these was probably classified as
reference already. Immaterial.)*

**(f) Our own product surfaces, not tenant data (3):**
`roadmap_votes`, `test_server_comments`, `test_server_interests`. These belong to
wolfpack.quest-the-product. In a tenant world they stay ours.

### 4.3 The catalog problem — the honest blocker

A self-hosting guild's Mob Info, spell catalog, item clickies, loot tables, Raid
Guide, Quartermaster, gear pages and mob-specials row-picker all read `eqemu_*`.
Today `scripts/sync-from-eqmac.js` can populate it — it pulls the public
`SecretsOTheP/EQMacEmu` tarball and needs only `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`. So this is *technically* self-serve.

**But**: the 555-item haste/regen/manaregen/damageshield/attack backfill came
from a local `peq` MariaDB (`CLAUDE.md`, 2026-07-11) because the eqmac dump omits
those columns. `spell_level_seed` came from a PQDI scrape that 403s cloud IPs.
`eqemu_spell_pop`. The `#171` row-picker conventions. **A fresh sync produces a
catalog that is materially worse than ours**, and the guild has no way to know
which parts are missing.

This is precisely why **§0 step 1 — publish the catalog as a shared read-only
resource — is both the highest-value and easiest move.** They can't rebuild it;
we already maintain it; it's already `anon`-readable; and giving it away costs us
nothing competitively (it's upstream server data plus curation, not guild
intelligence).

### 4.4 Is OpenDKP optional?

Verified: `utils/opendkp.js` **throws** when `OPENDKP_COGNITO_CLIENT_ID` /
`OPENDKP_USERNAME` / `OPENDKP_PASSWORD` are missing (line 68), and
`OPENDKP_RAIDS_URL` / `OPENDKP_CLIENT_ID` throw at lines 96/103/109. Those throws
are inside sync/auth functions, so a guild that never triggers DKP paths is
*probably* fine — but `/loot`, `/dkp`, `/tick`, `/syncopendkp`, the loot
auction card, the Raid Review's DKP block and `/admin/links` all reach for it,
and `utils/loot.js:260` builds a URL against `OPENDKP_CLIENT_NAME || 'wolfpack'`
— so an unconfigured tenant would be shown links to **our** DKP site.

**I did not run the bot without OpenDKP configured and cannot claim it starts
clean.** Recommendation: an explicit `FEATURE_OPENDKP=0` that gates the commands
out of registration and the surfaces out of the UI. Small, well-bounded, and
needed for *any* external deployment.

### 4.5 Honest time estimate

| Persona | Estimate | Where they quit |
|---|---|---|
| A software engineer who raids | 6–10 h over a weekend | Probably finishes; will file issues about the anchor ceremony |
| Competent officer, comfortable with Railway/Vercel, not a dev | 15–25 h over 2 weeks, **~70% abandon** | Step 4 (anchors), or Step 2 (migrations) if the chain doesn't replay |
| Officer who "is good with computers" | does not finish | Step 2 |

**Smallest set of changes that makes it a weekend job** (this is the real
deliverable of §4):

1. **`/setup` — one slash command that does the whole ceremony.** Create the
   channel, create the five expansion threads + four named threads, post the
   anchors, and **write every resulting ID into `state.channelSlots`** (which is
   already the second-priority resolver). Then the env-var anchors become
   *optional hardening*, not a setup requirement. This one change removes ~25
   manual snowflake copies and two redeploys. **Highest leverage item in this
   entire document.**
2. **A squashed baseline migration** — one `00000000_baseline.sql` representing
   current schema, so a new project is one file, not 170. Keep the 170 for our
   own history.
3. **Point `eqemu_*` at our shared catalog** (a `SHARED_CATALOG_URL` +
   publishable key) so step 3 disappears.
4. **`FEATURE_OPENDKP=0`** and a matching `FEATURE_PVP=0`.
5. **A `/health`-style startup self-check** that prints a red/green list: intents
   granted, Supabase reachable, catalog reachable, anchors resolved, agent token
   set. We already have `_preRaidHealthCheck()` and `scripts/preraid-drill.js` —
   this is a re-aim, not a new thing.
6. **`WEB_BASE_URL` / brand vars honored everywhere**, including the agent
   dashboard's ~20 hardcoded links and Mimic's `WOLFPACK_URL`.

With those six, my estimate for the "competent officer" persona drops to
**3–5 hours with a ~70% completion rate.** Items 1, 2 and 4 are the ones I'd
actually build; 3 and 5 are the ones that make it *feel* supported.

---

## 5. Model B — multi-tenant on our Supabase

### 5.1 Tenant identity and provisioning

There is no tenant entity today. `guild_id` is a bare `text` column with one
value. A real model needs:

```
tenants(
  guild_id text primary key,          -- slug: 'wolfpack', 'nightfall'
  display_name text,
  discord_guild_id text unique,       -- the snowflake
  status text,                        -- trial | active | suspended | departed
  plan text,
  features jsonb,                     -- {opendkp:false, pvp:false, ...}
  anchors jsonb,                      -- THE ANCHOR-AS-DATA FIX (§5.3)
  created_at, suspended_at, purge_after
)
```

Joining flow: Hitya invites the bot to their Discord → the bot sees an unknown
`guild.id` → creates a `tenants` row in `status='trial'` → an officer runs
`/setup` (§4.5 item 1) → anchors land in `tenants.anchors`. That is a genuinely
nice onboarding *if* `/setup` exists, and impossible without it.

### 5.2 One bot vs bot-per-guild — the fork, and what breaks

A single discord.js client **can** be in many guilds. Here is what actually
breaks if we try:

| Thing | Breaks how |
|---|---|
| `process.env.SUPABASE_GUILD_ID` at ~40 sites | Every write stamps one tenant. Must become a per-request/per-interaction lookup. This is the core refactor and it touches `utils/supabase.js`, `index.js`, and 12+ util modules. |
| Every `process.env.<ANCHOR>_ID` | One process cannot hold five guilds' thread IDs in env. Must become `tenants.anchors`. |
| `requireAgentAuth` | Returns `{discord_id, role_names, is_officer}` with **no tenant**. Every ingest handler would need `identity.guild_id`, sourced from a tenant column on `mimic_sessions`. |
| In-memory state | `state.channelSlots`, `state.petOwners`, `_reporterRegistry`, `_extHurtSince`, `_mtLiveStateByName`, `_sessionCache`, `_chGradeCall` state, the trash tally, the raid-review debounce — **all global singletons keyed by name, not by guild.** Two guilds with a raider named "Fargan" collide. This is a large, diffuse, easy-to-get-subtly-wrong refactor across a 15k-line file. |
| Background jobs | Spawn checker, midnight chain (TZ-aware — per tenant!), member sync, chat GC, reporter elections all assume one guild and one timezone. |
| `data/state.json`, `data/parses.json` | Single-file local mirrors. |
| Load-shed + control plane | `overlay_tuning` already has `guild_id` — good. But `flag_agent_kill` etc. would need to be tenant-scoped or one officer pauses everyone's fleet. |
| Rate limits / budgets | `_overBudget` is per-uploader × kind; fine. But one tenant's bad night degrades everyone's bot process. |
| Blast radius | One process, one Railway service. A crash takes down every tenant's raid night, mid-raid. |

**Verdict: do not do one-bot-many-guilds.** The state-singleton problem alone is
weeks of work with a long tail of "two guilds interfered" bugs that only appear
under concurrent raid load — the hardest possible thing to test. The
`CLAUDE.md` minimal-diff rule exists because this file is a structural hazard;
this refactor is the opposite of a minimal diff.

**Do bot-process-per-guild instead.** Each tenant gets a Railway service (or a
container in one service) with its own `DISCORD_TOKEN` and its own
`SUPABASE_GUILD_ID`. Zero refactor of the state singletons. Zero cross-tenant
blast radius. The cost is per-tenant infrastructure (~$5–10/mo on Railway) and
per-tenant deploy management — which is a *business* problem, not an
architectural one, and a much better problem to have.

This also means the answer to "should we do row-level multi-tenancy?" is: **only
in the database, not in the process.** Which is far more tractable.

### 5.3 The anchors-as-data problem

Concretely, the change is: `resolveAnchor(key)` today is
`process.env[key] ?? state.channelSlots[key] ?? null`. It becomes
`process.env[key] ?? tenants.anchors[guildId][key] ?? state.channelSlots[key] ?? null`.

Because the env-first order is preserved, **our own deployment is bit-identical**
— we keep our env pins, nothing changes for Wolf Pack. That's what makes this
safe to do incrementally. And note `/setup` (§4.5) writes into
`state.channelSlots` today, so the machinery for "anchors as data" already half
exists; `tenants.anchors` is the durable, per-tenant version of it.

### 5.4 Data isolation

With bot-process-per-guild, the bot side is isolated by credential. The
remaining exposure is **the web**, and it is significant: 522 queries, 148
guild-filtered, service-role key in hand. Options:

- **(i) Schema-per-tenant.** Each tenant gets `t_<slug>` schema; the tenant's
  web deployment gets a PostgREST role scoped to that schema. Strong isolation,
  and migrations become "apply to N schemas" (annoying but mechanical). Shared
  `eqemu_*` stays in `public`. **Recommended if we ever host.**
- **(ii) RLS + drop the service-role key from web.** Correct in principle,
  but it means auditing 522 call sites and adding real policies to ~90 tables,
  many of which currently have RLS on with **zero policies** (they work only
  because everything uses service-role). That's a large, high-risk migration to
  our own live product, for tenants we don't have yet. Not first.
- **(iii) A trusted middle tier.** Route all web reads through the bot's API.
  Architecturally clean, but the web currently reads Supabase directly in 86
  files — this is a rewrite of the web data layer.

**Recommendation: (i) schema-per-tenant.** It buys isolation without rewriting
our own product, and it composes with the PvP carve-out (§2) which is also
"separate the data, not the code."

### 5.5 `/admin` when officers are per-tenant

`isOfficer()` reads `wolfpack_members.role_names` against `OFFICER_ROLE_NAMES`.
Per-tenant, that becomes a lookup keyed by (tenant, discord_id). The web's
officer gate is inherited from `web/app/admin/layout.tsx`, so it's one choke
point — good. But note **`/admin/console` and `/admin/overlays` write control-plane
flags** (`flag_agent_kill`, `min_agent_ver_num`, `flag_shed_*`) into
`overlay_tuning`, which *does* have `guild_id`. Those writes must be
tenant-scoped or a tenant officer pauses our fleet. `web/lib/runbooks.ts` also
references our incidents and our `/admin` routes; harmless but should be
suppressed for tenants.

### 5.6 Support burden, abuse, trust

- **Support.** We would be on the hook for every tenant's raid night. Our own
  incident history (the 2026-07-13 queue backup, the beta-channel atom-feed
  outage, the raid-freeze rule) shows this platform needs an operator who
  understands it. Hosting N guilds means N raid nights a week where someone
  pages Hitya. **This is the real cost of Model B and it is not technical.**
- **Abuse.** `/api/mimic-link/start` is unauthenticated (rate-limited 10/10min/IP).
  Payload limits are 256 KB chat / 10 MB encounter. Budgets exist per uploader ×
  kind. A hostile tenant could still fill storage — see §1.1.
- **Trust.** We would hold another guild's chat logs, tells (encrypted, but
  ours to decrypt), roster, DKP and private character data. `docs/PRIVACY.md`
  is written for Wolf Pack members; a tenant version needs to say what we can
  see, what we retain, and what happens on exit. That's §10.

---

## 6. Model C — hybrid (recommended)

**"Bring your own Postgres and Discord; borrow our catalog and our client."**

| Component | Who runs it | Why |
|---|---|---|
| Discord bot | **They do** — Railway/Docker, own token | Avoids the entire state-singleton refactor and the blast-radius problem. |
| Web | **They do** — Vercel, own OAuth app | Or skip it entirely; Mimic + Discord is already a complete product. |
| Guild Supabase | **They do** — own project, squashed baseline | Their data is theirs; no isolation engineering needed; no storage cost to us. |
| `eqemu_*` catalog | **We do** — shared, read-only, `anon` | The thing they can't rebuild. Already `anon`-readable and weekly-synced. |
| Mimic binary | **We do** — one build, configurable `botUrl` | One artifact, one updater, one support surface. |
| `who_observations` / PvP data | **Ours only** — separate project | §2. |

**Why this is the sweet spot:**
- Zero multi-tenancy work in the bot. `SUPABASE_GUILD_ID` per process already
  works today.
- Zero storage cost to us (§1.1's 400 MB/month/guild is their bill).
- Zero raid-night support obligation.
- The carve-out is enforced by *not having credentials*, which is unbreakable.
- We still own the two things that make the platform special: **the curated
  catalog and the Mimic client.**
- It's reversible into Model B later if Hitya decides hosting is a business.

**What it needs** (this is the whole engineering bill):
1. `/setup` — the anchor ceremony as one command (§4.5 item 1)
2. Squashed baseline migration
3. `SHARED_CATALOG_URL` — `eqemu_*` reads split from tenant reads
4. `FEATURE_OPENDKP` / `FEATURE_PVP` flags
5. Mimic de-branding: configurable sign-in URL + web base URL (§7)
6. A real self-host guide replacing README §"Bot install"

---

## 7. The Mimic client angle

### 7.1 What's already portable

Verified: `cfg.botUrl` is a first-class config value with a **text input in
Settings** (`apps/mimic/settings.html:52`), persisted to
`%APPDATA%/…/mimic.config.json`, passed to the agent as `--bot-url`
(`main.js:2018`), and the agent independently accepts `--bot-url` /
`WOLFPACK_BOT_URL` (`packages/wolfpack-logsync/index.js:64`). `_botBaseUrl(cfg)`
strips to origin for all non-ingest calls (`main.js:1022`). **Changing the bot
URL and relaunching the agent already works today** (`settings.html:564`).

So the answer to "is one Mimic binary serving multiple guilds feasible?" is
**yes, and it's closer than you'd think.**

### 7.2 What actually blocks it

1. **Sign-in URL — already portable, verified.** `utils/mimicLink.js:25`
   defaults to `https://wolfpack.quest/auth/mimic-link` but is env-overridable
   (`MIMIC_LINK_VERIFICATION_URL`), and **Mimic honors whatever the bot
   returns**: `main.js:1533` destructures `verification_url` /
   `verification_url_complete` from the `/api/mimic-link/start` response and
   `shell.openExternal`s it (`main.js:1538`). The only hardcoding is the
   *display* fallback string in `loading.html:672` and `settings.html:608`
   (`… || 'wolfpack.quest/auth/mimic-link'`), which is cosmetic. **A tenant bot
   setting `MIMIC_LINK_VERIFICATION_URL` works today with no client change.**
   That is a much better starting position than expected.
2. **~20 hardcoded `wolfpack.quest` links** in the agent dashboard `WEB_HTML`
   (`/me`, `/parses`, `/pvp`, `/fun`, `/raid`, `/admin/triggers`, …) plus
   `WOLFPACK_URL` in `main.js:90` and the tray item at `main.js:5009`. All should
   read a `webBaseUrl` served by the bot (the bot already has `WEB_BASE_URL`,
   `index.js:5364`) — one manifest field on `/api/agent/latest-version` or the
   `poll` bundle would carry it.
3. **Branding.** `appId: quest.wolfpack.mimic`, `productName: Wolf Pack Mimic`,
   `artifactName: Wolf-Pack-Mimic-${version}`. Changing these forks the updater
   channel and the install path.
4. **Updater feed.** `publish: github / davehess / QuarmBossTracker`. A rebranded
   fork would need its own releases — and per `CLAUDE.md`, the 10-entry
   `releases.atom` cap is already a live hazard for our own channels. **Do not
   add tenant channels to our repo's release feed.**

### 7.3 Recommendation

**One binary, multi-guild, our branding.** Mimic stays "Wolf Pack Mimic" (or gets
a neutral name if Hitya wants — that's a naming call and per `CLAUDE.md` naming
is the guild lead's call). It gains:

- a **first-run "which guild?" step** that sets `botUrl` from a short list or a
  pasted URL, instead of burying it in Settings;
- **`webBaseUrl` + `guildLabel` served by the bot**, so the dashboard's links and
  the title bar say the right thing;
- feature flags from the same manifest so a tenant's Mimic hides the `/pvp` and
  `/who` links rather than 404ing.

That is roughly **one focused day of work** and it delivers real value even with
zero tenants: it's the same manifest plumbing that would let us move
`wolfpack.quest` to a new domain without a client release.

**Do not** build a per-guild rebranded Mimic. One installer, one updater channel,
one support surface. The alternative multiplies the release matrix we already
struggle with (three channels, an atom-feed cap, and an unsigned installer).

---

## 8. Staged plan

Each stage is independently shippable and independently valuable. **Stage 0 and
Stage 1 commit us to nothing.**

### Stage 0 — Publish the catalog (≈ half a day, no tenancy commitment)
- A `/catalog` page documenting the 31 `eqemu_*` tables, the publishable key, the
  conventions from `docs/eqemu-catalog-cheatsheet.md`, and the weekly sync.
- Rate limit + an `anon` read role scoped to `eqemu_*` only.
- **Value:** immediate goodwill and the strongest "host with us" argument, with
  no data risk (it's upstream server data + our curation).
- **Risk:** none material. Verify the `anon` policies really are read-only —
  they are `SELECT`-only today, but re-check before advertising.

### Stage 1 — The PvP separation (1–2 days, do this regardless)
- Second Supabase project; move `who_observations`, `who_overrides`, `pvp_*`,
  `hate_kills`; cross-project client.
- Replace `who_obs_read (qual: true)` with deny-by-default + a self-scoped view.
- **Value even with zero tenants:** it closes the "our web holds service-role and
  can read the whole census" exposure that exists *today*.
- **Risk:** touches live `/whois`, `/who`, `/pvp`, the PvP boards and the
  who-lookup cache. Do it outside a raid window. Needs its own mini-design.

### Stage 2 — `/setup` + squashed baseline (2–4 days)
- `/setup` creates channels/threads/anchors and persists them.
- One baseline migration.
- Startup self-check (green/red list).
- **Value:** makes *our own* disaster recovery vastly better. If we lost the
  Discord volume today, recovery is the 10-step README ceremony.
- **Risk:** low; `/setup` is additive and env-first resolution is preserved.

### Stage 3 — Feature flags + de-branding (2–3 days)
- `FEATURE_OPENDKP`, `FEATURE_PVP`, `FEATURE_WEB`.
- `WEB_BASE_URL` / `guildLabel` honored in the agent dashboard + Mimic, served
  from the bot manifest.
- Mimic first-run "which guild?" step.
- **Value:** the same manifest plumbing decouples the client from our domain.

### Stage 4 — Self-host bundle, one pilot guild (1 week + support)
- A real `SELF-HOST.md` walking Stages 0–3.
- **Pick one friendly guild and sit with them through it.** Everything in §4 is
  an estimate until somebody actually does it. Do not write the guide first and
  the pilot second.
- **Exit criterion:** they complete it in under 5 hours with ≤3 questions.

### Stage 5 — Hosted tenancy (only if Hitya wants the business)
- `tenants` table, schema-per-tenant, bot-process-per-guild, tenant `/admin`
  scoping, storage retention (see §1.1 — this becomes mandatory, not optional).
- **Gate:** at least two guilds who completed Stage 4 and asked to be hosted.
  Do not build hosting for hypothetical demand.

---

## 9. What I could not verify

Stated plainly so nobody builds on it:

1. **Whether the 170-migration chain replays cleanly on an empty Supabase
   project.** I did not attempt it. This is the load-bearing assumption of every
   self-host story and should be tested first.
2. **Whether the bot starts and runs usefully with `OPENDKP_*` unset.** The
   throws are inside sync/auth functions and *look* lazy, but I did not run it.
3. **Query cost of parent-FK RLS** on `encounter_players` / `contributions`
   (§4.2a). Small tables, likely fine, not benchmarked.
4. **Whether the `anon` role's `eqemu_*` policies are genuinely read-only in
   every case.** They are all `cmd: SELECT` today, but re-audit before
   advertising the catalog publicly (Stage 0).
5. **Whether one Railway service can host N bot processes economically**, or
   whether each tenant needs its own service (§5.2). Affects Stage 5 pricing
   only.

*(Two earlier uncertainties were resolved during writing and are now stated as
fact: Mimic does honor the bot-supplied `verification_url` (§7.2), and
`encounter_threat_snapshots` does have a 30-day retention sweep (§1.1).)*

---

## 10. Open questions for Hitya

**Business**
1. **Do we charge?** If hosting costs ~400 MB/mo/guild of Postgres plus a
   Railway service plus your raid-night attention, "free" has a real price. A
   flat $10–15/mo per guild would roughly cover infrastructure and nothing else.
   Free-and-limited (bot + timers + parses, no web) is also a coherent product.
2. **Is this a product or a favor?** A favor for 1–2 allied guilds is Model C
   and needs almost nothing. A product needs Stage 5, a support commitment, and
   a name. Very different amounts of work.
3. **Do we want a competitor running our stack?** Everything here assumes
   friendly guilds. Is there a guild you'd decline?

**Data & trust**
4. **What do we promise about a tenant's data?** Concretely: can we read their
   guild chat? (Technically yes, in any hosted model.) Do we say so up front?
   `docs/PRIVACY.md` needs a tenant edition.
5. **What happens when a tenant leaves?** Export (what format?), retention
   period, hard delete. Answer this *before* the first tenant, not after.
6. **Do we ingest a hosted tenant's `/who` data?** Default recommendation:
   **no** — but if their agents upload it and we store it, we'd be accumulating
   their intelligence. That is exactly the thing you're protecting against being
   done to us. I recommend we don't; confirm.
7. **Does the PvP *code* ship?** §2.4 recommends yes-code/no-data. Your call —
   the counter-argument (the heuristics themselves have value) is real.

**Product**
8. **Does a self-hosting guild get the web app, or just bot + Mimic?**
   Bot + Mimic is a complete product and roughly halves the setup. The web is
   the biggest source of hardcoded literals and a second Vercel + OAuth setup.
9. **Mimic branding.** One binary, our name, many guilds — or a neutral name?
   Per `CLAUDE.md`, naming is your call and I shouldn't propose one.
10. **What's the first move?** My recommendation is **Stage 0 (publish the
    catalog) + Stage 1 (split the PvP data)** — because both are worth doing on
    their own merits and neither commits us to being anyone's host.

---

## Appendix A — where the tenancy seams already are (good news)

Not everything needs building. These already exist and are the right shape:

- `SUPABASE_GUILD_ID` env with a `'wolfpack'` default, used consistently at
  ~40 sites — the write path is already parameterized.
- `overlay_tuning` is already keyed by `guild_id` — the whole control plane
  (shed flags, budgets, kill switch, version floor) is tenant-ready.
- `ALLOWED_ROLE_NAMES`, `OFFICER_ROLE_NAMES`, `OPENDKP_CLIENT_NAME`,
  `MIMIC_LINK_VERIFICATION_URL`, `WEB_BASE_URL`, `DEFAULT_TIMEZONE`,
  `DEMO_OBFUSCATE_SALT` — all already env-driven with our values as defaults.
- Anchor resolution is already a **three-tier waterfall** with `state.channelSlots`
  in the middle — adding `tenants.anchors` is inserting a tier, not inventing one.
- Per-user opaque bearer tokens (`wpms_…`) with a revocation table — the agent
  auth model is already per-identity, not per-deployment shared secret.
- `cfg.botUrl` / `--bot-url` — the client already points anywhere.
- `web/lib/obfuscate.ts` already has a per-guild salt — precedent for
  guild-scoped derivation.
- `/health` readiness + `scripts/preraid-drill.js` — the bones of a setup
  self-check already exist.

## Appendix B — the tables in the PvP carve-out

| Table | Rows | Size | Sensitivity |
|---|---|---|---|
| `who_observations` | 110,652 | 80 MB | **Critical** — 12,281 characters, 52 guilds, 2023-11-10→present, 97% non-guild |
| `who_overrides` | 241 | 128 kB | **Critical** — hand-built de-anonymization |
| `pvp_kills` | 528 | 448 kB | Ours; moderate |
| `pvp_boss_kills` | 381 | 392 kB | Ours; moderate |
| `pvp_assists` | 54 | 152 kB | Ours; low |
| `pvp_quake` | — | 32 kB | Low |
| `hate_kills` | 27 | 112 kB | Low |

Consumers to re-point if these move: `/whois`, `/who`, `/whoall`, `/whoimport`,
`/markzek`, the 8 `pvp*` commands, `hateboard`/`livehate*`, `/quake`,
`GET /api/agent/who-lookup`, the `who_directory` view, `web/app/who/`,
`web/app/pvp/`, and the four `who_observations` upsert sites in `index.js`
(lines ~509, ~4611, ~5055, ~13909).
