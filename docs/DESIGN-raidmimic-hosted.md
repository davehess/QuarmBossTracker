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
