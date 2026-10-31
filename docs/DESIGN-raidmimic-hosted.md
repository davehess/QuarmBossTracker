# Raid Mimic hosted guilds: setup requirements and data segmentation

*Written 2026-10-28 (the guild lead: "work through all of the setup requirements on raidmimic.com. the wizard, our ability to
segment the data from wolfpack's data even if it's in the same database"). DECISIONS §460. Measured against production
(read-only catalog queries) and `origin/main`; numbers will drift, re-measure before acting on them.*

**What this changes.** The 2026-09-18 tenant model (`docs/decisions/infra-costs.md` 2026-09-18/2) was "a tenant is a fork with
its own deployment" — its own database. The guild lead now wants a hosted guild able to live in **our** database, segmented
from Wolf Pack's data. The fork model stays available for a guild that wants its own install; this document is the
same-database path. The tenant-data policy (2026-09-18/3: a guild's data is the guild's; no operator reading without consent;
anonymised aggregates only) applies unchanged and is a requirement on everything below.

## 1. Where raidmimic.com stands today

- raidmimic.com / .net / .quest and www are served by the same Vercel deployment as wolfpack.quest; `web/middleware.ts`
  (~95–114) rewrites by host to `web/app/raidmimic/` (`/setup` to `/raidmimic/setup`, everything else to the landing page).
- The landing page ([beta]) offers three doors: **Player** (free download, set it up yourself), **Guild** ("Ask about a hub",
  marked Coming) and **Self-host** (GitHub guide). There is **no sign-up, no guild record and no setup flow**; "Ask about a hub"
  opens the anonymous form on eqmimic.quest (`anon_feedback`, reviewed by people, never acted on automatically).
- Sign-in would not work there: Supabase only honours redirects to wolfpack.quest and b.wolfpack.quest, and the auth callback
  rejects anyone outside the Wolf Pack Discord (`web/app/auth/callback/route.ts`).

## 2. Can another guild share our database today? Not safely.

| Layer | Today | Why it blocks a second guild |
|---|---|---|
| Guild tag on rows | 90 of 139 guild tables have `guild_id` (49 default to `'wolfpack'`). **49 guild-data tables have none**: `contributions`, `encounter_players`, `loot_drops`, `wishlists`, `audit_log`, `combat_events`, the `opendkp_*` set, `wolfpack_members`, `wolfpack_roles`, `officer_notes`, `mimic_sessions`, `rh_signups`, … | Their rows cannot be told apart by guild at all. |
| Keys | Natural keys without the guild: `wishlists(character_name,item_id)`, `bosses_local(npc_id)`, `wolfpack_members(discord_id)` | Two guilds' rows collide; one person cannot belong to two guilds. |
| Who is which guild | No guilds table. The guild is one process-wide setting (`SUPABASE_GUILD_ID`, `web/lib/guild.ts` `GUILD_TAG`, `DISCORD_GUILD_ID` default in `web/lib/discord.ts`). One shared agent token. | Nothing per request or per user decides the guild. |
| Security rules (RLS) | On for every table, but 37 guild tables let any signed-in user read **all** rows (`using true`); only 3 policies mention a guild, hardcoded `'wolfpack'`. | A signed-in member of another guild could read Wolf Pack's rows in those tables. |
| Queries | The bot and web server use the service role (bypasses RLS). A sample of ~800 calls on guild-keyed tables: ~27% carry no guild filter. 16 functions and 2 views hardcode `'wolfpack'`; 10 views run as their owner. | Isolation rests on every query remembering the filter, and a quarter don't. |

## 3. Segmentation: the build order (each step safe on its own; Wolf Pack keeps working at every step)

1. **A guild registry.** `guilds(guild_id, discord_guild_id, name, created_at, status)` and `guild_members(user_id, guild_id,
   discord_id, roles)`. Seed Wolf Pack. Nothing reads them yet.
2. **Tag every guild table.** `guild_id text not null default 'wolfpack'` on the 49 untagged tables, backfilled from parents
   (`encounter_players` from `encounters`, etc.). Idempotent; Wolf Pack's rows all read `'wolfpack'`.
3. **Keys include the guild.** Rebuild the natural-key primary/unique keys with `guild_id` (wishlists, bosses_local, …);
   `wolfpack_members` stays as Wolf Pack's own table, `guild_members` carries everyone.
4. **A test that refuses unscoped queries.** A lint/test that fails on a `.from(<guild table>)` / `supabase.select('<guild
   table>'…)` with no guild filter, then fix the ~215 unscoped calls. This is the step that makes the service role safe.
5. **RLS by membership.** Replace `using (true)` with `guild_id in (select guild_id from guild_members where user_id =
   auth.uid())`; views to `security_invoker`; a guild parameter on the 16 hardcoded functions.
6. **The guild per request.** Bot: resolve the guild from the Discord server an interaction or upload belongs to; agent tokens
   per guild (a token row carries its `guild_id`); web: resolve from the signed-in user's membership and the host.
7. **Operator access.** No standing operator read of another guild's rows (policy 2026-09-18/3): the operator's own sign-in
   is a member of Wolf Pack only; troubleshooting access is a per-incident, consented, logged grant.

Steps 1–3 are migrations with no behaviour change; 4 is the large one (code); 5–7 only matter once a second guild exists.

**Progress (2026-10-28):**
- **Backup first.** All 33 tables the change touches were copied to schema `backup_seg_20261028` (117 MB, not exposed to the
  API; row counts verified against live) before anything changed. Tower's archive (`archive_meta.merge_log`, daily) had merged
  138 tables at 12:37 UTC the same day, covering 27 of the 33; the six it does not carry are `guild_media`, `member_lockouts`,
  `feedback_replies` and the three `gallery_*` children. This session's Tower access is read-only (`claude_ro`, a Coolify token
  that lists no databases), so a fresh Tower backup cannot be started from a cloud session. Drop the snapshot schema once step 3
  has landed and settled.
- **Step 2 done:** `20261028170000_guild_id_on_untagged_tables.sql` applied; 33 of 33 tables carry `guild_id text not null
  default 'wolfpack'`. Excluded on purpose (game data or platform-wide): the `eqemu_*` mirrors and 16 others listed in the file.
- **Step 4 started:** `test/guild-scope.test.js` ratchet — 230 unscoped calls today (bot 56, utils 22, commands 8, web 144),
  listed in `scripts/guild-scope-baseline.json`; a new one fails the build, and a fixed one must leave the list.
- Next: step 1 (apply the `hub_*` registry), step 3 (keys with the guild), then working the 230 down.

**How this meets the open-hub design.** `docs/DESIGN-open-hub.md` (§358) puts the free "commons" in a **separate Supabase
project** with a headless bot, and its registry migration (`20261023160000_open_hub_registry.sql`: `hub_guilds`,
`hub_players`, `hub_memberships`, `hub_invites`, …) is written but not applied. Steps 1–4 above are needed **either way**: the
guest-raid tagging (§408 A) needs rows tagged by guild, and a separate project still needs every query to carry the guild once
it holds more than one. So build 1–4 now, reuse the `hub_*` registry tables for step 1 rather than a second registry, and leave
"same project or separate project" as the one open call (§460).

## 4. The setup wizard (raidmimic.com → a working guild)

Status: **built** / **partly** / **designed** / **missing**. Who: **G** the new guild's officer, **U** us, **A** automatic.

| # | Step | Today | Status | Who |
|---|---|---|---|---|
| 1 | Sign in with Discord on raidmimic.com | Sign-in checks ONE Discord server (`DISCORD_GUILD_ID`, Wolf Pack's by default) and says "Not a Wolf Pack EQ member"; raidmimic.com is not on Supabase's redirect list | missing | U builds; G signs in |
| 2 | Create the guild (name, Discord server, time zone, raid nights) | `hub_guilds` designed and written, not applied; no create/join/invite pages | designed | G |
| 3 | Invite people and set officers | `hub_invites` / `hub_memberships` designed; roles today come from Wolf Pack's role names held in two places | designed | G |
| 4 | Add the bot to their Discord | Permission integer and `/setup discord status / provision / export` exist; the layout builder (`bootProvision`) is tied to one server per bot process. Open call: one shared bot or one per guild | partly | G invites; U decides |
| 5 | Members link Mimic to the guild | Device-code link (`utils/mimicLink.js`) exists, but a session carries no guild, Mimic's server address defaults to ours, and ~20 links point at wolfpack.quest | partly | each member; A |
| 6 | Uploads count for the right guild | One shared agent token and one process-wide guild — every upload is Wolf Pack's | missing | A |
| 7 | Bosses and timers | 158 generic Quarm bosses + `/addboss`; PoP lock date hardcoded; raid nights per guild in `guild/config.json` | partly | G |
| 8 | Game data (items, spells, NPCs) | Shared catalog (`eqemu_*`); loader script for an empty project built, never run | built, unverified | U / A |
| 9 | DKP (optional) | OpenDKP wired; `FEATURE_OPENDKP` exists but nothing reads it, so without credentials `/loot` and `/dkp` break | missing gate | G gives creds; U adds the gate |
| 10 | Raid-Helper (optional) | Built; no wizard step | built | G |
| 11 | Keep data, cost | Commons retention windows and costs designed (≈ $13 / $24 / $72 a month at 10 / 50 / 200 players); sweeper not built | designed | U |
| 12 | Privacy and terms | Tenant privacy edition and `docs/TERMS-hosted.md` drafted; the public /privacy page is Wolf Pack's; deletion/backup/notice windows need a professional | partly | U (+ legal) |
| 13 | Billing | $25/month or $250/year up to 60 raiders, 14-day trial, designed; no payment rail; Vercel Hobby is non-commercial | designed | U |
| 14 | Domain | raidmimic.com live since 2026-10-19 (landing page + solo setup only) | built | U |
| 15 | Guest pass (a raider joining another guild's raid) | 6-hour raid codes and `.rmpack` export/import built; the hub reading guest overlay feeds is not | partly | A |
| 16 | Leave / export / size cap | 12-active-player cap rules, guild export, move-out step designed | designed | A / U |
| 17 | "Is my setup working?" check | `doctor` not built; silent traps known (Server Members intent, unlisted sign-in address, unapplied migrations) | missing | A |

**The documented give-up points** (external-tenancy §0, business §3.1): the hand-copied Discord IDs (now mostly solved by the
provisioner), the database/migrations/catalog stand-up (bootstrap script built; plain migrations fail 11), and silent failures
with no diagnostic (step 17).

## 5. Build order to a first outside guild

1. **Segmentation 1–4** (§3): registry (`hub_*`), tags on the 49 tables, keys with the guild, the unscoped-query test and its
   fixes. No behaviour change for Wolf Pack; unblocks guest-raid tagging too.
2. **Tenant context**: the guild per request (bot, agent tokens, web) instead of one process-wide setting.
3. **Sign-up and guild creation** on raidmimic.com (steps 1–3 of the wizard), with raidmimic.com added to Supabase's sign-in
   addresses and sign-in no longer pinned to Wolf Pack's Discord.
4. **Mimic "which guild"**: first-run sign-in to a guild, the server address and links served per guild (step 5–6).
5. **Discord side**: the shared-vs-per-guild bot call, multi-guild provisioner and `/setup`, the DKP gate, `doctor`.
6. **Legal, exit, money**: tenant privacy page and terms, export and logged purge, the player cap, a billing rail.

## 6. Open calls (the guild lead)

- **Same project or a separate one** for hosted guilds (open-hub §358 said separate; 2026-10-28 asks for same-database
  segmentation to be possible). Recommendation: build segmentation now either way; start the first hosted guild in the same
  project behind RLS-by-membership, keep a separate project as the exit for a guild that outgrows it or wants its own.
- **One shared bot or one bot per guild** (step 4).
- **What other guilds' raid data our raiders capture keeps** (§408 / 2026-10-28: tag now, move later; only kills, timers and
  boss behaviour for a public RaidMimic database).
- **Mimic signs into a guild of the raider's choosing** (§475, 2026-10-30: "it's hard-linked to wolfpack discord, but perhaps
  shouldn't be"). Today the link flow (`utils/mimicLink.js`, `/auth/mimic-link`, the Discord OAuth gate) assumes Wolf Pack.
  Needed: a guild picker in Mimic (first run and Settings), the link code minted by THAT guild's hub, and the agent's upload
  base URL and session per guild. Open: picker shape, and one Mimic holding links to several guilds. Guest links (§474) stand
  in until then.

## 7. The shared-server model: what one raid night costs, how guilds' fights merge, and what keeps the numbers honest (2026-10-31)

The guild lead (2026-10-31): *"how can we make the current implementation work as a hosted model? open source still works, the
easy mode is pay a certain amount and get access to the raid data when you're in it. dkp and guild specific elements need to
stay in guild, but each guild's loot distribution and rolling and parsing gets merged on same mobs … validate logs that people
aren't cheating them and padding their numbers, flag users that are anomalous … everyone's information should be anonymized …
could raid management be a piece of cake?"* This section answers from measurements of 2026-10-30's capture and the code as it
stands; §1–§6 above hold the segmentation build order it rests on. DECISIONS §484.

### 7a. What one raid night of one guild writes (measured 2026-10-30, 36 uploaders, 521 fights)

| Stream | Rows | Bytes | Share | Keep for |
|---|---|---|---|---|
| Threat snapshots (one per uploader per second of fight) | 42,744 | 41 MB | 75% | 30 days by policy; the sweep is broken, so forever |
| Buff landings | 26,119 | 4.4 MB | 8% | 7 days |
| /who sightings | 23,792 | 3.4 MB | 6% | forever |
| Raid tracker (one row a minute) | 938 | 3.1 MB | 6% | forever |
| Parse contributions | 1,660 | 2.3 MB | 4% | raw nulled at 7 days |
| Fights + per-player rows | 526 + 4,150 | 0.5 MB | 1% | forever |
| Chat relay | 3,404 | 0.6 MB | 1% | forever |

**About 55 MB a raid night, 41 of it the per-second threat feed.** Everything a guild would want to keep for a year (fights,
players, loot, rolls, tracker minutes, who) is under 8 MB a night. The database is 4.57 GB today (2.39 GB on 2026-09-22); the
threat-snapshot table alone is 2.49 GB, never vacuumed, 20k dead rows against 40k the planner thinks are live, and its 30-day
sweep still fails (CLAUDE.md, Supabase section). **Fixing that sweep is the first hosting task, not a chore**: at 41 MB a night it
is the whole storage story.

**Sizing the shared model.** A guild raids ~3 nights a week. Per guild-month: durable ≈ 100 MB, threat feed ≈ 500 MB at 30-day
retention. So:

| Guilds | Raiders (×40) | Durable, after a year | Threat feed, steady | Postgres total |
|---|---|---|---|---|
| 10 | 400 | 12 GB | 5 GB | ~17 GB |
| 100 | 4,000 | 120 GB | 50 GB | ~170 GB |
| 1,000 | 40,000 | 1.2 TB | 500 GB | ~1.7 TB |

Supabase Pro includes 8 GB and bills $0.125/GB/mo over it: 100 guilds ≈ $20/mo of storage, 1,000 ≈ $210/mo. **That is affordable
against $25 a guild only if the threat feed leaves Postgres.** The replay needs it for a few days (the raid review) and the
leaderboards never do; the right home is object storage (one compressed file per fight, ~1 KB a row → ~40 KB a fight gzipped,
$0.02/GB/mo) with Postgres keeping the per-fight summary. That turns 500 GB of hot rows at 1,000 guilds into ~20 GB of cold files.
Concurrency is not the problem: 36 uploaders tonight were 0.4% of the bot's CPU; "hundreds at a time" is tens of guilds raiding
together, a few hundred requests a second at most, which one Railway service already handles with a tuning map for shedding (#73,
#74). The real concurrency cost is reads (egress), and §385's unbuilt `/poll` compression is what pays for it.

### 7b. One database or many: share the schema, not the rows

Three documents pointed three ways (fork per tenant, schema per guild §358, same database with `guild_id` §460). The
measurements settle it for the easy mode: **one project, one schema, `guild_id` on every row, RLS by membership** (§460's §6
recommendation), because the cross-guild merge the guild lead wants (7c) is a JOIN across guilds, and a join across projects is
an export pipeline. The separate project stays the exit for a guild that wants its data alone (the fork, 2026-09-18/2). What
stays strictly in the guild: DKP (OpenDKP mirror, wishlists, bids), signups and soft reserves, triggers, member roster, officer
pages, chat. What may be read across guilds: fights, per-player parses, loot drops and rolls on the same mob, zone presence
(for the replay of a shared instance). That split is the `guild_id` ratchet's finishing line: 229 unscoped calls remain
(`scripts/guild-scope-baseline.json`), and every cross-guild read must be an explicit, audited exception, never the default.

### 7c. Merging fights across guilds: the "same spawn" key

Today a fight is `(guild_id, npc_id, started_at ± 30 min)` (`find_or_create_encounter`), with a respawn splitter and a 15-minute
gap splitter. Two guilds on the same mob are two rows that never meet. For the merge:
1. **Add a server key.** Nothing records which server a log came from. `encounters.server` (text, default `'quarm'`) and the
   same on `contributions`, read from the log line's server name where the client prints it, else the guild's configured server.
   Quarm, the test server (`/test-server`) and any other EQEmu box must never merge.
2. **Add a `fight_id` above the guild rows.** A new `fights (id, server, zone_id, npc_id, spawn_id, started_at, ended_at)` row
   that any guild's `encounters` row points at. `find_or_create_fight(server, zone, npc, spawn_id, started_at)` runs BEFORE the
   guild's `find_or_create_encounter`: same server + zone + npc within the window, and the same `spawn_id` when both sides have
   one, is one fight. Different `spawn_id`s in one window are two fights (two instances). No `spawn_id` on either side falls
   back to the window, with one more test: **shared raiders**. An instance is private, so two guilds in one fight means at least
   one character appears in both guilds' parses of it. No overlap in a window → treat as separate instances and do not merge.
3. **Carry the spawn id on the encounter payload.** Zeal 1.4.6 puts the spawn id on the pipe; the agent already stores it on buff
   landings (`buff_casts.target_id`, `0` means none). Add `spawn_id` + `zone_id` of the observer's target at engage to the
   `/api/agent/encounter` payload (agent + bot, one field each). Ids are per-zone-entry slots, so they only mean something with
   the zone and the window, never alone.
4. **Merge rules.** Parses: `merge_encounter_players` already takes the max per player across submitters; across guilds it
   runs over the `fight_id` instead of the `encounter_id`, so a raider seen by both guilds' uploaders gets one row. Loot drops
   and rolls: stay per guild (`loot_drops.guild_id`, `roll_sets.guild_id`) and are unioned at read on the fight page, each row
   labelled with its guild. DKP: never crosses. The 2026-09-18/4 rule ("observations made under another tenant are never merged
   as fact") gets its one exception here: a fight the two guilds **provably shared** (same `spawn_id`, or shared raiders) is a
   fact both saw.

### 7d. Extensible inputs: the agent is the only parser, and that is the bottleneck

All parsing happens in the agent on the member's PC; the bot receives structured events and keeps only aggregates. A whole
log file uploaded on the web, a PQ Companion export, or a Zeal spawn stream from another tool all need the same thing: **the
agent's parser as a library** (`packages/wolfpack-logsync/index.js` is one 35k-line file the bot already reads for its version).
Order of work: (1) split the parse functions (`shouldKeep`, the event parser, the encounter builder) into a module the bot can
`require`; (2) `POST /api/log-upload` runs it server-side in `--once` mode on an uploaded file, same privacy filter, same
payload shape, `source='log_upload'`; (3) PQ Companion: its trigger packs already import (`test/pqc-import.test.js`); its parse
export was studied (`docs/pq-companion/04`) and is a second reader for the same module; (4) spawn ids: the field in 7c.3, with
any source allowed to fill it. `contributions.raw_parse->source` already tells the sources apart, and agent data wins when both
exist (CLAUDE.md, chat-extracted parses).

### 7e. Honest numbers: validation that cannot be forged, only cross-checked

The agent is open source and runs on the member's machine, so nothing it signs can be trusted; a doctored upload with a big
number simply wins today's max-merge. Validation therefore has to be statistical and cross-submitter. What exists: bearer
auth per Mimic session, admission budgets (rate, not plausibility), the 10 MB / 1,800 s caps, the ±30 min dedup. **No
plausibility check of any kind exists** (grep `plausib|anomal|suspicious|cheat` finds only the PoP ⚑ human flag).

The signals, cheapest first, and where each lands:
1. **Submitter disagreement** (cheap, at ingest): N uploaders each report a player's damage in `contributions.raw_parse`; a
   player whose own upload says 2× what every other uploader saw is the padding signature. Store a per-fight, per-player
   `(submitters, min, median, max, self_reported)` vector at ingest (`raw_parse` is nulled after 7 days, so it must be computed
   then). Flag when `self_reported > 1.5 × median of others` with ≥ 3 others.
2. **Damage above the mob** (cheap): `encounters.total_damage` vs `eqemu_npc_types.hp` + `npc_healed_total`; the respawn
   splitter already computes the ratio.
3. **Peer band** (cheap): a character's DPS vs the 30-day distribution of its class at its level (`encounter_players`,
   `characters.class`, level from `who_observations`); flag past the 99th percentile three fights running.
4. **Events per second** (partly cheap): `raw_parse.eventCount / duration_sec` per submitter; a log cannot print more than the
   client writes.
5. **Presence** (needs a join): the submitter's character must appear in `raid_track_minutes` / `raid_roster` for that window;
   a parse from someone nobody saw is the strongest flag of all.
6. **Max hit per skill** (new storage): the agent's rollup gains `maxHit` and `crits` per skill, persisted by
   `upsertCombatRollup`; compared with the class's ceiling for its level and weapon.

Flags go to a `contribution_flags (contribution_id, kind, score, detail)` table and an officer page; a flagged contribution is
**excluded from the merge** (so it cannot win the max) but kept for review, and a character with three flags in 30 days is
"anomalous" on the officer page and on the server-wide stats (7f) is dropped. Nothing bans; officers decide.

### 7f. Anonymized server-wide stats

What exists: `AnonMap`/`anonName` (an opted-out character is "Cleric 2"), the token-credentialed `/share/raid/<token>` page,
the demo obfuscation salt, and the PRIVATE / ANON / GUILD scopes of `docs/PRIVACY.md`. What a public server page needs on top:
(1) the aggregation runs **inside** each guild's scope and exports counts only (the 2026-09-18/3 rule); (2) a minimum-count
threshold (no cell under 5 characters) and class/level bands instead of names; (3) per-guild opt-in, default on for guilds that
take the cross-guild merge (they are already sharing), off for self-hosted installs; (4) PvP and `/who` sightings stay out
(`docs/DESIGN-external-tenancy.md` §2). Published surface: kill counts and first kills per boss per week, class DPS bands per
boss, wipe rates, loot drop rates observed vs the catalog, raid sizes. Names never; guild names only where the guild opted in.

### 7g. Identity: Discord for everyone, one RaidMimic Discord, guilds as associations

Everything assumes one Discord guild: the sign-in gate fetches membership of `DISCORD_GUILD_ID` and upserts
`wolfpack_members` keyed on `discord_id` (one person, one guild); 17 reads of the id in `index.js` plus the provisioner; the
Supabase redirect list allows wolfpack.quest only; `mimicLink` carries no guild. The hosted shape:
- **Sign in with Discord (identify only)** on raidmimic.com, no guild membership required: a `players` row per Discord id.
- **A RaidMimic Discord** as the common room: the bot runs there too; a player who joins gets a role per guild they belong to,
  granted by that guild's officers through the bot (`/guild add @player`), which writes `guild_members (guild_id, player_id,
  role)`. Multi-guild is a second row. That table replaces `wolfpack_members` as the membership source; `wolfpack_roles` becomes
  `guild_roles`.
- **A guild's own Discord stays optional**: a guild that has one links it (the bot joins and mirrors roles, today's model); a
  guild that does not uses the RaidMimic Discord roles alone.
- The Mimic link code is minted by the guild the player picks (§475), and the agent's bearer carries `guild_id`, which is what
  makes per-request scoping (§3 step 6) possible.

### 7h. OpenDKP: a partnership, not a scraper

Today: one officer login, `noauth` reads with a static client id, 47 wired functions, the mirror in `opendkp_*`, and an unsent
three-tier ask (`docs/DESIGN-opendkp-audit-cursor.md`: `?count=`, `?since=<AuditId>`, entity ids on audits). For many guilds the
same traffic multiplies by N, which is exactly what the OpenDKP owner objected to in August. The partnership ask, in order:
(1) send the audit-cursor ask, framed as "N guilds, one well-behaved client"; (2) a per-guild API key issued by OpenDKP to the
guild, stored per `guild_id` (never one shared officer password); (3) a webhook from OpenDKP on auction close and tick, which
retires polling altogether; (4) in return, Raid Mimic pushes attendance ticks and loot winners to OpenDKP for guilds that want it.
Guilds on other DKP systems (EQDKP-Plus, Google Sheets) get the same `dkp_provider` seam: a per-guild adapter with `balances()`,
`ticks()`, `loot()`; OpenDKP is the first.

### 7i. Raid management "a piece of cake": what it would take

The pieces exist and are each guild-shaped: signups (Raid-Helper mirror), the plan and preflag table, soft reserves, the
tracker, the Command Center, spectator, guild triggers, the buff queue, lockout tracking. Making it easy is not a new feature;
it is one flow: **create raid → invite (Discord post + Mimic banner) → raiders sign up and soft-reserve → the night runs with the
Command Center, triggers and the buff queue → the session page closes it with attendance, loot, rolls and the replay → DKP
ticks post to the guild's DKP.** The missing joints are the first and the last: a "New raid" form that does not need
Raid-Helper, and the DKP push. Both are small once the guild seam exists; neither is worth building before it.

### 7j. Order of work, and what each unblocks

1. Fix the threat-snapshot sweep and move the feed to object storage (7a). Unblocks: any growth at all.
2. Per-request guild resolution (§3 step 6) + registry + RLS by membership (§3 steps 1, 5). Unblocks: a second guild in the database.
3. Sign-in without Wolf Pack: `players`, `guild_members`, raidmimic.com on the redirect list, the RaidMimic Discord (7g). Unblocks: anyone joining.
4. Server key + `fight_id` + spawn id on the payload (7c). Unblocks: the merge, and honest instance separation.
5. Validation signals 1–5 and the flags table (7e). Unblocks: trusting merged numbers.
6. Billing rail (§385's $25 flat per guild). Unblocks: the easy mode.
7. Parser as a library, log upload, PQ Companion reader (7d). Unblocks: raiders without Mimic.
8. OpenDKP per-guild keys and the audit cursor (7h). Unblocks: other guilds' DKP.
9. Anonymized server stats (7f) and the raid flow's two missing joints (7i).
