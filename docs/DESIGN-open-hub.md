# DESIGN — the open hub ("the commons"): anyone can join, a guild at 12 chooses, history lives on the PC

**Status: DESIGN, written 2026-10-23. Phase 0 is built and dormant** (pure rules + one unapplied migration, §14); nothing
in a live request path changes. Every number is marked **measured** (from Wolf Pack's database or code, with the date) or
**estimated** (arithmetic on a measured number, or a guess), so a reader can tell which to trust.

> *"Lets start with a buildout of the common 'anyone can join, once a guild has 12 members they need to stand up their
> own or pay for the 25 hosting'. Usage logs will not be kept for long term on my storage, but instead be available in
> the end user's mimic. If they auth into a guild's tenant they would be able to load in their data."* — the guild lead,
> 2026-10-23

**Already decided, not re-opened here** (`DECISIONS-2026-09-21.md` §358, §385–§389, §402–§404): Raid Mimic is managed
hosting per guild, flat $25/mo up to 60 raiders, 14-day trial, billed to the guild and never a player; self-hosting is
free; rows are person-keyed (a person's data is their own; when someone leaves, the guild keeps its records under an
anonymised `<Class>-<id>`, the DKP ledger keeps names); full raw fight data is a +$5/mo add-on; raw threat rows go after
30 days on a paid tenant; the shared trial is **never** in Wolf Pack's production database.

---

## 0. The answer in one page

| Question | The call this design makes |
|---|---|
| Where does the commons live? | A **separate Supabase project and a headless copy of the bot** (`HUB_MODE=commons`: HTTP API only, no Discord client, no boards, no midnight chain). Not Wolf Pack's database (§358). Managed and self-hosted guilds are the exit, not a room in the commons. |
| How do you join? | **Discord sign-in, `identify` scope only** (no guild list, no email), through the existing Mimic device flow. No guild password, no Wolf Pack role. |
| What is a guild? | A group of players who **name** it. The creator is the owner and promotes officers. Tag = the same `guild_id` text every table already carries. Players join by a 6-character invite code (or, if the owner opens it, by tag). |
| Who counts toward 12? | **Distinct active PLAYERS**: a player with accepted uploads on at least **2 distinct UTC days in the last 30**, counted once in the guild they were active in most. Guests and characters never count. (§3) |
| What happens at 12? | Three confirming daily counts, then a notice to the owner and officers with two doors (own instance / $25 hosting) and a **14-day grace** (one 14-day extension). After that the guild is **limited**: shared streams and new joins stop. History stays readable and exportable, personal data keeps working, and **a player's own Mimic never stops.** (§3) |
| How long does the hub keep usage logs? | **48 h to 60 days by stream** (§4), about **8 MB per player** at steady state, against about **79 MB per player after six months** at Wolf Pack's windows. |
| Where does history live? | **In each player's Mimic** (summaries by default, about 5 MB a month; the raid recorder about 40 MB a month; raw streams opt-in). Mimic pulls down what the hub still holds, before the hub forgets it. (§5) |
| "Auth into a guild's tenant, load in their data" | A **push from the PC**: Mimic previews from the local copy, the player consents per guild, only that guild's fights go, everyone else's name is rewritten to `<Class>-<id>` on the PC **and** again on the server, signed, rate-limited, audit-logged, revertable by import id. (§6) |
| Tenancy in our code | `guild_id` moves from `process.env` to the **session token** through one request-scoped context, so the 123 identical `process.env.SUPABASE_GUILD_ID || 'wolfpack'` reads in `index.js` become one helper call. A route manifest and a two-tenant test make a new unscoped route fail the build. (§7) |
| Cost to us | About **$13 / $24 / $72 a month** at 10 / 50 / 200 players (estimated; storage is measured and is never the large line). One managed guild at $25 covers the hub at about 50 players. (§9) |
| Build | **~15 days for phase 1**, ~37 days for everything (§10). **Do not announce the commons publicly before phase 3** (the gate), or a 60-person guild squats on it free. |

---

## 1. The shape

```
 player's PC                          the commons (separate project)                     exits
┌────────────────────┐   Bearer       ┌──────────────────────────────────┐
│ Mimic + agent      │   wpms_… ───▶ │ hub bot (HTTP only)              │──▶ managed tenant  ($25, 60 raiders, §9)
│  local store (NDJSON)│  (token →     │  session → { player, guild_id,   │──▶ self-hosted    (free; wizard imports an export)
│  90–120 d of history │   guild_id)   │  plan, role }                    │
│  raid codes, rmpack  │ ◀── local-sync│  tenant-scoped handlers          │
└────────────────────┘   (pull before │ hub Postgres: hub_* registry +   │
                         the hub       │  the usual guild tables, swept   │
                         forgets)      │  on short windows (§4)           │
                                       └──────────────────────────────────┘
```

Three properties carry the whole design:

1. **The hub is disposable on purpose.** Everything it holds about usage can be thrown away after days or weeks, because
   the player's Mimic already has it or can pull it first. Its backup is the registry tables only (kilobytes), not the
   usage tables (§9).
2. **The player is the owner.** `uploaded_by_discord_id` (or the hub's `player_id`) is the key everything hangs on; the guild
   is an association (§387). Leaving takes your logs, wishlist and settings with you and leaves an anonymised `<Class>-<id>`.
3. **The commons has no raid-night promise.** It is free and best-effort; a crash of the shared process affects every
   tenant, which is why a paid guild graduates to its own process or schema (`DESIGN-external-tenancy.md` §5.2 stays the
   answer for anything with a service level).

## 2. Joining and forming a guild

**Sign-in.** Mimic already runs the device flow (`/api/mimic-link/start|poll`, `utils/mimicLink.js`; the verification
page address is bot-controlled by `MIMIC_LINK_VERIFICATION_URL`). On the hub the page is one static page the hub bot
serves itself (no Next.js project in phase 1) and the OAuth app is the hub's own Discord application with the
`identify` scope only. It creates a `hub_players` row (`discord_id`, `player_id` uuid) and mints a `wpms_` session
(`mimic_sessions`), exactly as `mintSessionForUser` does today. The check that rejects non-members
(`ALLOWED_ROLE_NAMES`) is replaced in commons mode by "has a hub_players row".

**A guild is a group of players who name it.** `POST /api/hub/guilds { tag, name }`:
- the tag passes `validGuildSlug` (3–24 chars, lowercase, `wolfpack` and platform words reserved, `solo-` prefix reserved);
- the creator becomes **owner** (one owner per guild, a unique index); the owner promotes **officers**; there are no
  Discord roles in the commons. Owner and officers can: make invite codes, remove members, rename, open or close
  joining, read the member count and the gate notices, pick a plan.
- limits: 2 guild creations per player per 30 days; 20 invite codes live per guild; a code is 6 characters (no 0 O 1 I L,
  like a raid code), valid 7 days, 25 uses by default.
- a player with no guild is **solo**: their uploads land under a private `solo-<id>` tag that only they read. Creating or
  joining a guild switches the session's active guild; the solo rows stay theirs.

**One token, one active guild.** `mimic_sessions` gains a `guild_id`. A player in two guilds holds one token per guild
(Mimic keeps them side by side and picks by the raid code rule it already has: a raid code holds raid-wide uploads, so a
visitor feeds neither hub). Switching is a route that checks `hub_memberships`.

**Guests.** A raid-code or guest-pass visitor (§402) has role `guest` in that guild: overlay feeds yes, no member pages,
never counted toward 12, parses they attend carry **GUEST**.

## 3. Who counts, and what happens at 12

### 3.1 The count (`countActivePlayers` in `utils/openHub.js`)

Counted in **PLAYERS, never characters** (CLAUDE.md fleet-adoption rule). One row in `hub_player_activity` is written per
(guild, player, UTC day) with at least one accepted upload; the count reads only that table.

- window: **30 rolling UTC days**, today included;
- a player counts after **2 distinct days** (a visitor's single night does not tip a guild);
- a player counts **once**, in the guild where they were active on the most days (ties: the smaller tag). Someone who
  raids with two groups costs one seat, in the group they mostly play with;
- guests never count; a character's alts are the same `player_id` by construction.

Why not "listed members": a roster is a promise, an upload is a cost. The cost the cap protects (storage, egress, the
shared process) comes from players who run Mimic. A non-Mimic raider on a roster costs nearly nothing and does not count.
The honest hole: a guild can keep 11 Mimic users and let the rest ride on rosters. That is accepted; those players use
the guild's data without adding to the load that the cap exists to limit.

### 3.2 The states (`nextGateState`, evaluated once a day at 04:00 UTC)

| State | Enters when | Shown as | Takes away |
|---|---|---|---|
| **ok** | fewer than 9 | nothing | nothing |
| **nearing** | 9 to 11, or 12 not yet confirmed | one heads-up to the owner and officers | nothing |
| **over** | 12+ on **3 evaluations in a row** | the notice, with the two doors; the 14-day clock starts | nothing |
| **grace** | the evaluation after `over` | banner in every member's Mimic and on the owner's page; reminders at 7 and 2 days | nothing |
| **limited** | grace ran out | banner says what stopped and why | shared streams and joining |
| back to ok / nearing | the count falls to **10 or fewer** (not 11: no flapping), or the plan changes | "recovered" | nothing, and everything returns |

- **Grace is 14 days** (the same length as the managed trial) with **one 14-day extension** the owner can ask for and the
  guild lead can grant: a guild in the middle of a progression push should not be cut off on a Tuesday.
- **Limited takes away:** raid-wide uploads the guild's overlays read (roster, live state, casting, buff queue, trigger
  relay), and new members. Over-limit uploads get `402 { error: "guild_limited" }`; an agent treats a 4xx as permanent and
  drops the payload, which is acceptable because the PC's local store already has it.
- **Limited never takes away:** the player's Mimic (overlays, triggers, DPS meter, the local store, raid codes, export),
  read and export of whatever the hub still holds (`history`), and personal data about the player's own character.
  `limitsFor(state).localMimic` is `true` in every state and a test holds it there.
- **Managed (cap 60)** only reports: a guild past 60 is a conversation about the next band, never a cut-off. **Self-hosted**
  is not counted at all.
- **The count is public to the guild**: members see "9 of 12 active players" and the list the count used, so nobody is
  surprised and nobody is shamed.

### 3.3 The notice (sample)

```
 Nightfall · 12 active players over 3 days            [Mimic banner and the owner's page]
 Commons guilds are free up to 12 active players. You have 14 days (until Nov 6) to pick:
   A  Run your own server — free. The setup wizard imports your guild's export.      [Open the wizard]
   B  Raid Mimic hosting — $25 a month up to 60 raiders, 14-day trial.               [Start the trial]
 Your own Mimic keeps working either way, and nothing you have recorded is lost.      [Ask for 14 more days]
```

### 3.4 What each door does

- **A, stand up their own.** The wizard (`DESIGN-selfhost-wizard.md`) gets a "move from the commons" step: it pulls a
  guild export (§8), loads it into the new project, and the guild sets `self_host_url`. Mimic learns the new server from
  the signed directory document (`eqmimic.quest/g/<tag>`, §388, lookup only) or from a `redirect` the hub returns, and
  re-signs in; no player installs anything.
- **B, $25 hosting.** The plan flips to `managed`: cap 60, Wolf Pack's longer windows (§4), and the +$5 raw-data add-on is
  offered at signup (§386). Until a billing rail exists this is a manual flip by the guild lead; **billing is not in
  phases 1–3**.

## 4. Short retention on the hub

**The rule:** the hub keeps a usage stream only as long as a *shared* feature needs to read it, and only the **summary**
outlives the raw rows. Every window is a row in `hub_retention` (and `RETENTION` in `utils/openHub.js`, held equal by a
test), so the guild lead changes a number, not code. Sweeps are off (`enabled=false`) until switched on.

| Stream (table) | Commons keeps | Managed keeps | Why |
|---|---|---|---|
| `character_live_state`, `raid_roster` | **6 h** | 24 h / 12 h | live views only; the bot already holds them in memory (`liveMemory`) |
| `encounter_threat_snapshots` (raw) | **48 h** | 30 d (§389) | 62% of Wolf Pack's database by itself; the curve survives in `encounter_threat_graph` |
| `buff_casts` | **3 d** | 7 d | the buff queue reads 3 h back |
| `raid_track_minutes` | **7 d** | kept | shared spectator and replay; the PC's own recorder keeps 90 d |
| `encounter_events`, `encounter_combat_rollup` | **14 d** | kept | per-fight detail the guild's review pages read |
| `contributions` | **30 d** | kept | raw uploaded parses; the merged encounter is what survives |
| `encounters` + `encounter_players` + `encounter_threat_graph` | **60 d** | kept | the guild's shared record of a fight |
| registry (`hub_*`), the kill ledger (one ~100-byte row per boss kill), the gate log | **kept** | kept | membership, who owes what, and "when did we first kill X" cost kilobytes |

**Refused at the door** (200-and-drop, like the shed pattern): tells, chat (live and historical), guild chat, PvP and
`who_observations` (the §8.6 carve-out: we never ingest other tenants' /who), XP events, faction hits, inventory,
spellbook, fun events. They name people who never agreed to a stranger's hub, or they are personal and stay on the PC.
`commonsAccepts(stream)` is the list.

**Every window needs a matching leading index before its sweep is switched on, and a sweep must report how many rows it
removed** (`DESIGN-selfhost-wizard.md` §3, 2026-09-01). Child tables (`encounter_players`, `encounter_threat_graph`) go
with their parent encounter, not by their own timestamp.

**What this saves, from measured per-player rates.** Rate = (table size including indexes ÷ live rows) × rows a day over
the last 14 days ÷ the 42 distinct uploading players in that period (**measured 2026-10-23**, Wolf Pack):

| Stream | MB per player per day (measured) | Commons window | MB held per player |
|---|---|---|---|
| threat snapshots | 1.325 | 2 d | 2.65 |
| buff casts | 0.300 | 3 d | 0.90 |
| track minutes | 0.026 | 7 d | 0.18 |
| encounter events | 0.075 | 14 d | 1.05 |
| combat rollup | 0.049 | 14 d | 0.69 |
| contributions | 0.024 | 30 d | 0.72 |
| encounters + players + threat graph | 0.031 | 60 d | 1.83 |
| **Total** | **1.83 + live streams** | | **8.0 MB** |

Cross-check: §386 measured 567 MB of new rows in a week for 38–44 players, which is 13.8 MB per player-week, 1.97 MB per
player-day. Within 8% of the 1.83 above (that week had `xp_events` and `faction_hits` in it, which the hub refuses).

| Players | Commons at steady state | Wolf Pack windows, six months in | Disk not held |
|---|---|---|---|
| 10 | 80 MB | 790 MB | **~0.7 GB** |
| 50 | 400 MB | 3.9 GB | **~3.5 GB** |
| 200 | 1.6 GB | 15.7 GB | **~14 GB** |

(Wolf Pack windows = threat 30 d, buffs 7 d, everything else kept for 180 days: **estimated** from the same rates.)

**Be honest about the dollars:** disk is $0.125 per GB a month above 8 GB, so 14 GB saved is under $2. The reasons that
matter are different: (1) 200 players at Wolf Pack's windows would pass the **8 GB included** and force a plan change;
(2) a nightly `pg_dump` moves table data out as egress (`DESIGN-selfhost-wizard.md` §3, 2026-09-04), and 15.7 GB nightly
is ~470 GB a month against 250 GB included, so the commons takes **no nightly full dump** (registry only);
(3) holding less of strangers' data is also the privacy position. Savings are in headroom and risk, not in the bill.

## 5. The user's Mimic is the long-term home

Mimic already has the machine for it (agent ~62910, DECISIONS §401–§403): a zero-dependency append-only NDJSON store at
`local/<kind>/<UTC day>.ndjson`, per-kind retention and byte caps (oldest segment dropped first), `track_minute` 90 d / 400
MB, `hub_encounter` 120 d / 64 MB, `hub_state` 30 d / 4 MB, a `GET /api/agent/local-sync` change-cursor pull with
tombstones, a random per-install `person_key`, and `.rmpack` export/import. The commons builds on that and adds only:

| Kept on the PC | Source | Default | Size per month (**estimated**) |
|---|---|---|---|
| Position recording (My replay) | the PC's own recorder | on, 90 d | ~40 MB (the hub's own 0.5 GB a year figure for 50-raider nights, §161) |
| My fights, deaths, loot seen | the PC's own parser | on, 120 d | ~2 MB |
| **Guild summaries**: merged encounters, per-player rollup, threat graph, kills | `local-sync`, new kinds `hub_rollup`, `hub_graph`, `hub_kill` | on, 120 d | ~5 MB (0.18 MB per player-day of the hub's measured rates, 30 days) |
| **Raw streams** (threat snapshots, buff casts) | what the PC itself uploaded, written to the store as it is sent | **off**, a toggle | ~40–55 MB if on (the hub's 1.6 MB per player-day measured, before NDJSON savings) |
| Default total | | | **~45 MB a month, ~150 MB at 120 days**, capped by the existing per-kind byte limits |

**Sync down before the hub forgets.** The pull runs at startup, every 30 minutes while a raid is live, and on exit. The
shortest window of anything it pulls is **60 days** (the encounter record), so a PC that was off for a month still
catches up; a PC off for two months misses only what it did not witness, and anything it witnessed it already holds.
Raw streams are never pulled back — the player's agent produced them, so keeping them is a local write, not a download.
`local-sync` learns a `kinds=` filter and a `guild=` check against the session; per-kind cursors live in `hub_state`.

**Every local record is stamped with the active guild at record time** (`guild` on the stored line). That stamp is what
makes §6 possible, and a record without one (everything recorded before this ships) is "unattributed" and is treated as
inferred (§6.2).

**The player owns the copy.** Deleting `local/` deletes it; "delete my account" on the hub clears the rows the hub holds
and keeps the anonymised placeholder the guild is owed (§387). An export is the existing `.rmpack`, extended with the new
kinds.

## 6. "Auth into a guild's tenant, load in their data"

The plain-language flow: a player signs into a guild's tenant (a commons guild they just joined, a managed tenant, or a
self-hosted guild's server) with the normal session flow; Mimic notices it holds data that belongs to that guild and
offers to load it.

1. **From the local copy first.** The preview is computed on the PC from the store: "142 fights between Oct 1 and Oct 22,
   31 deaths, 880 position minutes, 96 loot lines", listed by kind. Nothing leaves until the player presses Import.
2. **Consent per guild, per kind.** Fights and deaths on by default; position minutes and loot seen opt-in; never offered:
   chat, tells, inventory, XP, buffs on others, anything from `who`. Consent is remembered per (guild, kind) and revoked in
   one click.
3. **Only that guild's fights.** A record is eligible when its `guild` stamp equals the importing guild (exact), or, for
   unstamped records, when the fight's roster overlaps the guild's roster by at least half **and** the player says so
   (marked `inferred`). A fight recorded under a raid code is eligible only for the guild that issued the code.
4. **Others' names are anonymised, twice.** The PC rewrites every character that is not the player's own, or not in the
   importing guild's roster at that time, to `<Class>-<4 hex>` (the hex is derived from the install's `person_key`, so one
   stranger is one label across the whole bundle). The server then **checks again** against the guild's roster as of the
   fight's time and rewrites anything that slipped through. The server never trusts the client's rewrite.
5. **Signed.** The bundle carries the `person_key`, the target guild, a server-issued nonce and an HMAC over the bundle
   hash with the session token (the `.rmpack` header precedent: no Discord id, no account name inside). A bundle for guild
   A is rejected by guild B; a reused nonce is rejected.
6. **Limits.** One import per guild per player per 24 h; 20 MB; nothing older than 180 days or in the future; at most 5,000
   fights; the existing encounter dedup (`find_or_create_encounter`, ±30 min) **attaches** instead of duplicating.
7. **What an import can never do.** Create attendance, DKP, loot-ledger entries, kill-flags that move a timer, or officer
   notes. Imported encounters carry `source = 'import'` and a `import_id`, and show **IMPORTED** wherever they show.
8. **Audit.** `hub_import_audit` (append-only, phase 5): who, guild, counts per kind, bundle hash, accepted and rejected
   counts, `inferred` count. The guild's officers and the importer can read it. An officer can **revert an import by its id**
   (delete every row with that `import_id`); a player can revert their own.
9. **If the PC lacks it.** The hub can hand back what it still holds inside its windows ("download my data"), then the
   normal import.

## 7. Tenancy mechanics on our code

### 7.1 Today (measured 2026-10-23)

- Tenancy is a property of the **process**: `process.env.SUPABASE_GUILD_ID` is read **123 times in `index.js`**, every time
  as the identical expression `process.env.SUPABASE_GUILD_ID || 'wolfpack'`, plus 30 times across `utils/`, 5 in `web/`
  (server-only), ~10 slash commands. `utils/supabase.js` already exports `guildId()` (23 `index.js` callers use it).
- Auth is per-member: `requireAgentAuth` → `_resolveSessionToken` → `mimic_sessions` (`user_id, discord_id, revoked_at`) →
  `wolfpack_members` (roles); the identity has **no guild**.
- 91 distinct `/api/agent/*` route names. By name (a first pass; the manifest in 7.4 makes it exact): about 40
  tenant-scoped reads and writes, about 15 tenant-free catalogs (`spell-catalog`, `item-catalog`, `mob-pack`,
  `latest-version`, `pronunciations`…), and about 25 Wolf-Pack-only (DKP, bids, PvP and /who, tells and chat, Discord
  loot posts, feedback) that answer 404 or 200-and-drop in the commons.

### 7.2 The change: a request-scoped guild, one chokepoint

1. `mimic_sessions.guild_id` (nullable; null = the deployment default, so Wolf Pack's tokens are untouched) and
   `hub_player_id`. `_lookupSessionToken` selects the new column; the identity gains `{ guild_id, plan, hub_role }` and is
   cached with the rest of the identity (5 min).
2. A tiny module, `utils/tenantContext.js` (`AsyncLocalStorage`), is entered by `requireAgentAuth` on success.
   `supabase.guildId()` becomes: the context's guild, else `process.env.SUPABASE_GUILD_ID`, else `'wolfpack'`.
   **In `HUB_MODE=commons` a call with no context throws** — a background job or a forgotten path fails closed instead of
   writing into a default tenant.
3. The 123 + 30 identical expressions are replaced by `supabase.guildId()` in **one reviewed mechanical change** (a
   one-regex codemod, run once, whose diff is read, and a test that fails if the expression reappears in a request-path
   file). Wolf Pack's behaviour is byte-identical: no context, same env value.
4. **The module-level maps** keyed by a character or target name alone (`_reporterRegistry`, `_extHurtSince`,
   `_mtLiveStateByName`, the trash tally, `_chGradeCall` state; `external-tenancy` §5.2) get a `${guildId}|` key prefix.
   `liveMemory` and the class cache already key on the guild. EverQuest names are unique per server, so a collision means one
   person in two guilds, but "my other guild's live buffs showed in this guild's queue" is exactly the leak to prevent.
5. **Commons mode boots headless**: `HUB_MODE=commons` skips `client.login`, the spawn checker, the midnight chain, member
   sync, the announcers and every board; it registers only the HTTP routes the manifest marks `tenant` or `catalog`.
   This is what makes one shared process tolerable where `external-tenancy` §5.2 ruled it out: the singleton problem was the
   *Discord* half, and the commons has none of it.
6. **Control plane** (`flag_agent_kill`, `min_agent_ver_num`, `flag_shed_*`, `budget_*`) is already read from
   `overlay_tuning`, which has `guild_id`. The commons has its **own** tuning map (separate project), so a commons operator
   decision never pauses Wolf Pack, and a guild's owner gets none of it.

### 7.3 Which handlers change

| Group | Routes (representative) | Change |
|---|---|---|
| Ingest, tenant-scoped (writes stamp `guild_id`) | `encounter`, `bosskill`, `lockout`, `raid-roster`, `character-live-state`, `live-state`, `buff_casts`, `casting`, `threat-snapshot`, `looted`, `trigger`, `trigger-relay`, `map-sync`, `live-damage`… | the `guildId()` swap; the activity row (`hub_player_activity`) written once per player-guild-day from one place in `requireAgentAuth`'s success path; gate check (`limited` → 402) |
| Query, tenant-scoped | `poll`, `guild-triggers`, `raid-buff-queue`, `target-buffs`, `target-casts`, `extended-target`, `hail-board`, `local-sync`, `my-parses`, `replay-window`, `raid-live`, `overlay-tuning` | the `guildId()` swap; per-guild cache keys |
| Tenant-free | catalogs, `mob-pack`, `latest-version`, `pronunciations` | none |
| Refused in the commons | `tells`, `chat`, `historical_chat`, `guild-chat`, `pvp`, `pvp_assists`, `who-lookup`, `who-override`, `dkp-tick`, `place-bid`, `bid-prefs`, `loot-post`, `xp-events`, `faction`, `inventory`, `spellbook`, `fun_event`, `feedback`, `quarmy`… | `commonsAccepts()` at the top of the dispatcher |
| New | `/api/hub/guilds`, `/members`, `/invites`, `/join`, `/leave`, `/switch`, `/export`, `/status` | phase 1 and later |

### 7.4 Isolation tests (the part that must not be skipped)

1. **A route manifest**, `routes.manifest.json`: every `/api/agent/*` string in `index.js` is listed with `scope: tenant |
   catalog | wolfpack-only`. A test fails on any route in `index.js` that is not in the manifest, so **a new route cannot
   ship unclassified**. (This is the missing-vs-broken lesson: a check that only validates what exists passes on a gap.)
2. **Two-tenant read test**: with a fake PostgREST (`test/_fake-postgrest.js`), write as guild A, read as guild B on every
   `tenant` query route; B must see nothing. Mutation-check it by deleting one `guild_id` filter.
3. **Every write stamps the session's guild**: a fake records every inserted row during a request; none may carry another
   guild's tag or the env default.
4. **No context in commons mode throws** (`guildId()`), and **no `process.env.SUPABASE_GUILD_ID` remains in a request-path
   file** (comments stripped, per the repo's text-assertion rule).
5. **Cache-key test**: the same character name uploaded under two guilds never returns the other's row from a name-keyed map.
6. **Reserved tags**: a hub guild can never be `wolfpack` (a DB CHECK and `validGuildSlug`).
7. **Sweeper test**: a sweep deletes only rows older than its stream's cutoff, reports the count, and refuses a column
   with no index (it reads `pg_indexes` first).

### 7.5 Abuse limits

| Surface | Limit |
|---|---|
| Sign-in start | existing: 10 per 10 min per IP; failed-auth throttle on tokens |
| Guild creation | 2 per player per 30 days; tag rules; a new guild with ≥50% of its first six active players from a `limited` guild inherits that guild's state (no re-forming to dodge the cap) |
| Invites | 20 live per guild, 25 uses default, 7-day expiry; wrong-code throttle as raid codes (15 an hour) |
| Uploads | the existing per-uploader × per-kind admission budgets (#73), enforced from day one in the commons (`budget_enforce_*` on), plus a **per-guild** budget so one guild's bad night cannot starve the rest |
| Storage | per-guild byte quota on the registry-adjacent tables; payload limits as today (chat n/a, encounter 10 MB) |
| Names | impersonation guard on display names (no `wolfpack`, `raid mimic`, `official`); report-and-reclaim by the guild lead |
| Imports | §6.6 |

## 8. What the self-host wizard needs from this

The commons' windows are, nearly row for row, **the wizard's "free-tier profile"** (`DESIGN-selfhost-wizard.md` §3,
2026-09-18): a guild on Supabase Free should start from them instead of Wolf Pack's. So:

1. **A guild export** (`GET /api/hub/export`, owner or officer): one versioned bundle per stream plus the registry slice
   for that guild, anonymised placeholders kept, DKP not included (it lives in OpenDKP). The wizard's "move from the
   commons" step loads it after `selfhost-bootstrap-db.sh` and `selfhost-load-game-data.js`, then counts what it loaded.
2. The wizard never sets `HUB_MODE`. A self-hosted deployment stays single-tenant (`SUPABASE_GUILD_ID` fixed), so the new
   code path is inert there.
3. `hub_retention` ships with the schema as the retention defaults (`commons_hours` column = the free-tier profile).
4. The hand-off: the guild sets `self_host_url`; the directory document and a `redirect` in the hub's `latest-version`
   response point Mimic at the new server.
5. The wizard asks "move from the commons?" before "start from nothing", and says the PC copy is the other half of the
   migration (§6 loads it).

## 9. Costs

### 9.1 Per piece — the four costs (build days · maintenance · runtime · change)

| Piece | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|
| Commons project + headless boot | 2.5 d | medium: migrations apply to **two** projects (the "migrations stall silently" trap, doubled) | ~$10/mo fixed | low |
| Tenant context + session guild + the 153-site swap + map prefixes | 4 d | medium-high: every new handler must use the helper; the manifest test is what holds the line | ~0 (one column in a cached lookup) | **high**: it touches the 18k-line file widely, mechanically; the one piece to review line by line |
| Sign-in page + `hub_players` | 2 d | low | 1 OAuth app, a static page | low |
| Guild create / join / invite / roles + Mimic card | 3.5 d | low | tiny tables (KB) | medium: roles beyond owner/officer are a schema change |
| Retention sweeper (11 streams, indexes, counts) | 1.5 d | **medium**: windows drift from reality; the config table plus the test keeps them honest | one DELETE per stream per day, indexed | low (a number in a table) |
| Isolation tests + manifest + abuse limits | 2 d | low | none | low |
| Mimic: hub URL, sign-in, Hub card | 1 d | medium: ~20 hard-coded wolfpack.quest links stay until a manifest field exists | none | low |
| Local store kinds + stamp + `local-sync` kinds (phase 2) | 4.5 d | medium: store schema versions live on every PC for months | ~45 MB/month disk per PC; one pull per 30 min in raid | **high**: records already on disks cannot be re-stamped |
| 12-member gate: counter, state job, notices, enforcement (phase 3) | 5 d | low: pure rules, tested | one daily query over ~1.5k activity rows | low |
| Exits: export + wizard step + managed flip (phase 4) | 6 d (+ billing rail) | medium | export is a one-off read | medium |
| Tenant import (phase 5) | 6 d | medium: the anonymiser is a privacy-critical path | rare, bounded by §6.6 | **high**: the bundle format is a contract with every installed Mimic |

### 9.2 What the hub costs a month

| | 10 players | 50 players | 200 players | Basis |
|---|---|---|---|---|
| Disk held (§4) | 80 MB | 400 MB | 1.6 GB (+0.12 GB game catalog) | **measured rates** × windows |
| Supabase second project, compute | $10 | $10 | $15 (Small) | **estimated**; $10 is COSTS.md §3's marginal basis, the org stays on Pro regardless |
| Supabase overage (disk, egress) | $0 | $0 | $0 | disk far under 8 GB; egress unmeasured (dashboard-only, CLAUDE.md) |
| Railway, headless bot | ~$0 | ~$0 | ~$3 | **measured** $1.20/mo for ~42 players (COSTS.md §2) scaled linearly, inside Hobby's $5 until ~110 players |
| Variable (reads, polls, egress, rest) | $2.70 | $13.50 | $54 | **estimated upper bound**: $16 at 60 raiders after compression (§386) is $0.27 per player; likely lower for solo players |
| **Hub total** | **≈ $13** | **≈ $24** | **≈ $72** | all estimated except disk |

- One managed guild at $25 covers the hub at about 50 players. A 12-player commons guild costs about $3.60 a month in
  variable cost; a 60-player managed guild about $16 (§386). The cap at 12 exists because the free tier's economics stop
  there.
- The compression of `/poll`, buff-queue and live-damage (§386's open item) matters more to this table than anything
  retention does. **Not built.** Do it before phase 1 opens.

## 10. Phased plan

| Phase | Slice | Build | Gate to the next |
|---|---|---|---|
| **0** | This design; the dormant rules (`utils/openHub.js`), the registry migration (unapplied), tests | done (~1 d) | the guild lead answers §12 |
| **1** | **Open door.** A non-Wolf-Pack player signs in, creates or joins a guild, and their Mimic uploads into the commons with short retention. Commons project, headless boot, tenant context, sign-in page, guild/invite routes, the sweeper (report-only first), manifest + isolation tests, a Hub card in Mimic. **Invite-only closed beta** (a code from the guild lead) | **~15 d** (13 if invites are cut and joining is `open_join` only) | two weeks with real non-Wolf-Pack guilds; sweeper counts reviewed |
| **2** | **Mimic is home.** Stamp local records, `local-sync` kinds, sync-down cadence, raw-stream opt-in, disk meter | 4.5 d | a PC rebuilds a guild's last 60 days from the hub after a reinstall |
| **3** | **The gate.** Counter job, state machine, notices (Mimic banner, owner page), enforcement (`402`), report-only first | 5 d | **the commons can be announced** |
| **4** | **Exits.** Guild export, wizard "move from the commons", managed plan flip, a billing rail, ToS and privacy rewrite | 6 d + legal | first guild leaves by a door |
| **5** | **Tenant import.** The flow in §6, audit table, revert | 6 d | |

Total about **37 days** of build, **phase 1 is the smallest thing that is the product**. Run phase 1 closed, build phases
2 and 3 behind it, and open the door only when the gate exists.

## 11. Privacy and legal

- The commons holds strangers' data under rules written for a guild: **`docs/PRIVACY.md` and the public privacy page are
  Wolf Pack's** and say "members only". A commons version is needed before anyone outside the guild signs in: what we
  hold (Discord id, display name, uploads by stream and window), what we never receive (§4 refused list), the anonymised
  placeholder on leaving, no self-serve delete today (phase 4 adds export and delete).
- The deletion window, the backup-expiry window and the notice period are **a professional's call**, as §358 already
  records; a session drafts the mechanics with those left as marked placeholders.
- Discord's minimum age is 13. We collect nothing beyond what Discord gives on `identify`; say so.
- The directory document on eqmimic.quest (§388) carries no data about members.

## 12. Open questions for the guild lead

Each carries what makes it different, a picture, and a tag. **My pick is marked.**

**1. Choose A, B or C for the count:**
- **A — Active players**: a player counts after uploads on 2 days in 30, once, in their main guild — `9 of 12 active` — *(recommended; what the cap protects is load)*
- **B — Listed members**: whoever is on the roster — `14 of 12 listed` — *(simplest to explain; a roster is gameable and costs nothing)*
- **C — Anyone who ever uploaded**: no window — `31 of 12 ever` — *(never shrinks; punishes churn)*

**2. Choose A, B or C for grace after the notice:**
- **A — 14 days** + one 14-day extension — *(recommended; same as the trial)*
- **B — 30 days**, no extension — *(gentler, a full month of free overage)*
- **C — 7 days** — *(cheapest for us, a hard week for a guild mid-progression)*

**3. Choose A, B or C for what "limited" takes away:**
- **A — Shared streams and new joins**; local Mimic, history, personal data stay — `roster, live, buff queue stop` — *(recommended; the cost is the shared load)*
- **B — Everything the hub accepts**, including personal uploads — *(simplest to enforce; makes a player's own data stop for the guild's size)*
- **C — Banner only**, no enforcement — *(no build; the cap becomes a request)*

**4. Choose A or B for how the notice reaches people (no email: we run no SMTP):**
- **A — In Mimic and on the hub page** — *(zero scope, fastest)*
- **B — A + an opt-in join to a small "Raid Mimic Commons" Discord server** (`guilds.join` scope), for DMs and an announcements channel — *(recommended; the only way an owner who has stopped raiding hears about it; can be added later to A)*

**5. Choose A or B for officers in a commons guild:**
- **A — The owner promotes officers** — *(recommended; no Discord needed)*
- **B — Link a Discord server, roles sync** — *(familiar, a bigger build and a second consent; a later add-on to A)*

**6. Choose A or B for the commons' website in phase 1:**
- **A — No website**: Mimic's dashboard card plus one bot-served sign-in page — *(recommended; ~4 days cheaper, nothing to host)*
- **B — A `/hub` section on raidmimic.com**: sign-in, guild page, member list — *(a second Vercel project with Preview env vars, +4–5 days; better front door, wait for phase 3)*

**7. Choose A or B before any stranger signs in:**
- **A — Closed beta first**: a commons invite from you for two weeks, ToS and privacy drafted in that window — *(recommended)*
- **B — Open on day one** — *(faster; we would hold strangers' data under Wolf Pack's privacy page)*

**8. Choose A or B for a guild that drops under the cap after being limited and then re-forms under a new tag:**
- **A — It inherits the state** (≥50% of its first six active players came from the limited guild) — *(recommended)*
- **B — Fresh start** — *(simplest; the cap becomes optional)*

## 13. What I could not verify

- **Egress.** Supabase egress and the Spend Cap are dashboard-only (CLAUDE.md); the $0.27 per player is an upper bound derived
  from §386's own estimate, not a measurement.
- **The route classification** (§7.1) is by name; the manifest in 7.4 is what makes it exact, and it is phase 1 work.
- **Whether an unscoped read exists in `web/`**: not in play, because the commons has no website in phase 1. External tenancy
  §5.4 measured 522 web queries with 148 filtering `guild_id` and a service-role key; a `/hub` web section (question 6 B)
  inherits that problem and must use schema-per-guild or the bot's API.
- **Whether `uploaded_by_discord_id` is the right person key** for the commons (it is on most tables; `character_live_state`
  has `uploaded_by`, `xp_events` has `uploaded_by`, `raid_roster` has `uploaded_by_discord_id`). Phase 1 maps them; the
  person-keyed schema (§387) is still unbuilt.
- **Per-player rates** are one 14-day window with 42 players and about five raid nights. A new expansion, a boss-heavy
  week or a different class mix moves them; the config table is why that is cheap to change.

## 14. What this change adds (phase 0, dormant)

- `utils/openHub.js` — `countActivePlayers`, `nextGateState`, `limitsFor`, `RETENTION`, `retentionCutoff`, `sweepPlan`,
  `commonsAccepts`, `steadyStateMbPerPlayer`, `validGuildSlug`. Required by nothing live; a test asserts `index.js`,
  `utils/supabase.js`, `utils/mimicLink.js` and the agent do not mention it.
- `supabase/migrations/20261023160000_open_hub_registry.sql` — seven `hub_*` tables, RLS on with no policies, retention
  seeds. **Not applied, and not for Wolf Pack's database.** A test holds the seeds equal to `RETENTION`.
- `test/open-hub.test.js` — 30 behaviour tests, mutation-checked.
- `docs/DESIGN-selfhost-wizard.md` §3 — five entries for the deployment decisions here.
