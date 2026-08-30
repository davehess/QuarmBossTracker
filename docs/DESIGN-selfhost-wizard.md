# EPIC — the self-host setup wizard

**Status: PLANNING TARGET, not scheduled** (Hitya, 2026-08-12). Nothing here is
built. This file exists so that design and infrastructure decisions have
somewhere to land *as they are made*, instead of being reconstructed later from
runbooks written for one specific box.

> *"Ideally we have a walkthrough wizard that's able to guide through setting
> this up. That's an epic for another time, but every design and infrastructure
> decision moving forward should write to that planning."* — Hitya, 2026-08-12

**The standing rule that comes with it:** any decision that changes how the
platform is deployed, what it stores, or what it costs to run gets a line in
§3 below at the time it is made. A decision recorded only in a runbook is a
decision the wizard will not know about.

---

## 1. Why a wizard, and what it is competing against

`DESIGN-external-tenancy.md` measured the honest baseline: a competent guild
officer working alone from the README faces **8–20 hours over a week with a
~70–80% chance of abandoning**. The give-up points it named were the ~30
hand-copied Discord anchor IDs, the database bootstrap, and the absence of any
diagnostic when something silently does not work.

Two of those are now materially better — `scripts/selfhost-bootstrap-db.sh`
builds the schema in one command (190/193 migrations clean, measured), and
`docs/SELFHOSTING.md` composes the proven layers. The Discord ceremony and the
"nothing tells you it is broken" problem are untouched, and they are exactly
what a wizard is for.

**The wizard is not documentation with buttons.** Its job is to make the
*failure* visible at the moment it happens, because every trap this platform has
produced so far looked like success:

- a Postgres that reported `healthy` having run none of its bootstrap
- a container "Running" with nothing published on the port
- a build log that simply stopped, no error, on an OOM kill
- sign-in that completed and silently redirected to the wrong host
- migrations that were committed but never applied, for three days
- a query that returned 1,000 of 5,622 rows and looked complete

A wizard that only walks forward through happy paths reproduces every one of
these. Each step must *verify*, and say what it verified.

## 2. The cost decision the wizard has to surface

**This is the reason self-hosting matters, and it is a spectrum, not a switch**
(Hitya, 2026-08-12). Hosted Supabase bills on storage and egress, which is why
production prunes: `buff_casts` is swept to 7 days because it reached 118 MB,
and every live consumer only reads 3 hours back. On-prem has no such pressure.

| Layer | Hosted | On-prem | What the guild gives up |
|---|---|---|---|
| Database | Supabase paid tier | Supabase Docker stack | Someone else's uptime and backups |
| Web | Vercel | Coolify / Docker | CDN, TLS, public DNS |
| Bot | Railway | `docker compose up -d` at the repo root | Nothing — it is already containerized |
| **History** | **pruned on timers to control cost** | **kept forever** | — |

That last row is the interesting one. The wizard should offer three shapes:

1. **All hosted** — simplest, costs money, retention stays tight.
2. **All on-prem** — free beyond electricity, guild owns uptime.
3. **Hybrid (what Wolf Pack runs)** — hosted production for the raid-night
   surfaces, on-prem for backup *and* the long-horizon archive.

Shape 3 is the one worth explaining well, because it is the one that buys
something neither pure option does: production stays small and cheap while the
local box answers questions the 3-hour window never can — slow uptime across an
expansion, threat patterns over months.

## 3. Decisions already made that the wizard must carry
- **2026-08-16 — sentinel tiers split by deployment** (`docs/DESIGN-sentinel.md`): freshness invariants run next to the LIVE DB (hosted: the bot; on-prem: the box itself); heavy analytical invariants run on the backup replica (hosted: Hitya's Unraid docker alongside the Supabase backup; on-prem: same DB, so the tiers collapse). The wizard should ship the battery file as config, not code.

Append here as decisions land. Each entry: the choice, why, and what the wizard
must therefore ask or verify.

### Third-party API citizenship (outbound call budgets)
- **2026-08-25 — every third-party API the platform calls gets an outbound
  budget at its HTTP primitives** (the Moncs/OpenDKP incident: one uncached
  7s dashboard poll = 1,678 calls / 1.1 GB in an afternoon on someone ELSE'S
  AWS bill, and our IP blocked). The pattern (see `utils/opendkp.js`):
  per-service kill switch (`OPENDKP_HALT`), sliding per-minute budget
  (`OPENDKP_MAX_CALLS_PER_MIN`, default 60, 0=off), 429/Retry-After cooldown,
  and a fan-in cache so N clients cost one upstream call
  (`_panelAuctions` in `index.js`). All of it env-tunable because the right
  numbers differ per deployment: hosted-OpenDKP guilds are spending the
  provider's money (budget LOW, cache LONG); a guild self-hosting OpenDKP on
  its own box can turn the budget off. The wizard must ask which OpenDKP the
  guild uses and set `OPENDKP_MAX_CALLS_PER_MIN` + cache TTLs accordingly,
  and it must carry the inbound admission budgets (#73,
  `budget_<kind>_per_min`) as the same knob pointing the other direction —
  sizing a deployment means setting BOTH tables.
- **2026-08-27 — a "refresh everything" pass is scheduled against the DOMAIN'S
  clock, never a rolling timer.** Hitya, looking at 140 MB/day of audits:
  *"we don't need a full download that often, just before a raid. three times a
  week"* — and an hour later, *"once per week then until we have the new version
  that has the since tag."* Any endpoint with no `since` filter forces a choice
  between a cheap incremental read and a periodic full re-read that heals gaps;
  the full one should land where the data actually moves, and **how often is a
  negotiation with the upstream operator, not a constant.** Ours is
  `OPENDKP_LIST_FULL_SWEEP_DAYS` (default `0` = Sunday) at
  `_FULL_SWEEP_HOUR_ET` (18). **The wizard must ask for the guild's raid nights
  and write them here, not default to 24h**: a rolling interval fires at
  whatever hour the process last booted, which for us was mid-raid.
  ⚠ **And the max-age safety net must be derived from the schedule, not typed
  next to it.** Ours was 96h under a three-a-week cadence; the moment the
  cadence went weekly (a 168h gap) that net would have fired every fourth day
  and silently restored the old volume. A net tighter than the schedule *is*
  the schedule. The wizard should compute it from the chosen days, and any
  hand-written value needs a test asserting the relationship rather than the
  number.
- **2026-08-27 — cadence state that is process-local must not make a redeploy
  expensive.** The same sweep marker lives in a `Map`, so "no marker → sweep"
  meant a full download per boot; `main` takes 12–42 pushes a day and that
  per-deploy walk turned out to be MOST of the remaining bill (measured: three
  deploys inside ten minutes, 17 calls / 6.2 MB apiece). A cold process now
  adopts the current anchor rather than sweeping. Generalises to any deployment
  whose platform restarts on push — which is all of the PaaS options the wizard
  offers.

### Catalog fan-out to clients (item catalog, 2026-08-30)

**Decision: the item list is pushed to every agent as an ETag'd catalog it
caches on disk, NOT queried per keystroke.** Hitya asked what it would cost
before agreeing to it, so the numbers are the decision:

| Universe | Rows | Raw | Gzipped |
|---|---|---|---|
| Every item in the catalog | 26,972 | 865 kB | ~295 kB |
| **Everything any NPC can drop** (shipped) | **11,099** | **380 kB** | **~130 kB** |
| Only what our tracked bosses drop | 3,191 | — | — |
| Only what this guild has ever seen | 1,700 | 54 kB | ~19 kB |

Gzip ratio 2.93× measured on a real 250-name sample; the full payload does
better (a 32 kB window understates 380 kB of repetitive armour-set names).

- **Fleet cost ≈ 2 MB/week.** ~16 PLAYERS (not 178 characters — the fleet is
  counted in players), source moves only on the weekly `sync-quarm.yml`, so each
  agent downloads once a week and 304s otherwise (~200 bytes).
- **Supabase cost is set by the TTL, and that is the only expensive knob.** The
  bot builds the catalog once and serves it from memory, so clients never reach
  the database. At the spell catalog's 1h TTL a full miss cycle re-reads 380 kB
  24×/day (~9 MB/day); at **12h** it is twice (~760 kB/day). ⚠ Do not lower it —
  the source table changes weekly.
- **Client cost:** 380 kB on disk, ~1.5 MB resident. Irrelevant next to Electron.

⚠ **The universe is "everything droppable", deliberately not "everything our
bosses drop".** Hitya: include Planes of Power so people can build a wishlist
before the 2026-10-01 unlock. Only **12 PoP bosses** are registered in
`bosses_local` (against 407 Luclin) because that board is built out AFTER
unlock, so a boss-driven universe reached **113 of 1,212** PoP items. Keying on
the drop table needs no boss registration and cannot go stale when `/addboss`
runs later. A self-hosting guild inherits this: their picker works for content
they have not started tracking yet.

⚠ **There was nothing to save — this ENABLES a feature.** Before it, adding a
wishlist item was one `ilike` with `limit=2`, so you had to type the name almost
exactly or it failed; there was no item typeahead anywhere. The wizard should
present this as a feature cost, not an optimisation.

**Web does NOT get a local copy.** `/api/search` already does server-side
`ilike` on `eqemu_items`; a browser pulling 130 kB to avoid a 20 ms query is the
wrong trade. The local copy exists for Mimic, which has to work mid-raid without
waiting on the network.

### Storage & retention
- **Local is an ARCHIVE, not a mirror** (2026-08-12). `refresh-local-archive.sh`
  merges each nightly dump instead of restoring with `--clean`, so rows
  production prunes survive locally forever. The wizard must ask *"do you want
  the local copy to keep history production discards?"* and explain the growth
  (~9,500 buff_casts rows/day; budget a few GB/year).
- **Archive vs mirror is per table and cannot be guessed.** A production DELETE
  means "retention expired" for `buff_casts` / `raid_roster` /
  `target_observations` / `who_observations` / threat snapshots, but means "no
  longer true" for `character_inventory` / `_gear` / `_spellbook` / `_aas`,
  which are deleted and re-inserted on every upload. The allowlist in
  `scripts/lib/archive-merge.sql` is deliberately the smaller list so an
  unclassified table defaults to mirroring. Proof:
  `scripts/test-archive-merge.sh`.
- **Retention windows are env-tunable on the bot** (`BUFF_CASTS_RETENTION_DAYS`
  and friends, `0` disables). A self-hoster with cheap storage may want them
  disabled entirely — the wizard should offer that rather than leaving the
  hosted-tier defaults in place.
- **Encounter collection is OPEN — volume scales with member farming**
  (2026-08-20). Since bot 3.1.52 every exactly-matched mob persists encounters
  (first kills are sacred); one member's overnight farm session wrote 336
  encounter rows in a day. Display filters (`bosses_local.auto_registered`),
  not ingest gates, keep the surfaces readable — so `encounters` growth is a
  hosting-bill question the wizard must surface alongside the buff_casts
  windows. There is deliberately no encounters retention window today.
- **The `parses_offcard_rollup` RPC hardcodes `America/New_York`** as the
  raid-day bucket (matches the web's `dayKey`). That is OUR raid timezone — a
  guild setting the wizard must parameterize (same knob as the raid schedule
  and the deploy freeze).

- **Crash dumps NEVER leave the machine** (2026-08-12). Zeal writes
  `crashes/<ts>.zip` (minidump + `crash_reason.txt`); the agent uploads only the
  PARSED fields plus a system snapshot, keeping `zip_name` so a specific dump can
  be requested by hand for the rare cluster that needs WinDbg. That is a storage
  decision as much as a privacy one — dumps are megabytes, signatures are bytes.
  The wizard must ask for crash-review consent explicitly (per-crash and a
  standing preference, both default OFF), because today it is an environment
  variable and that is why 393 reports have exactly TWO uploaders.
  Design: `docs/DESIGN-crash-review.md`.

### Database
- **The repo alone cannot build the schema** (2026-08-12): 182/193 migrations
  apply to an empty Postgres. `supabase/bootstrap/` supplies six tables no
  migration creates plus the roles/extensions/publication a hosted project has.
  The wizard runs `selfhost-bootstrap-db.sh` and must check the ROLE LIST, not
  the healthcheck — a Postgres with no bootstrap still reports healthy.
- **The `eqemu_*` catalog (~97 MB) has no self-serve import.** Still the largest
  unsolved gap for a new guild; the standing recommendation is to publish it as
  a shared read-only resource rather than have each guild rebuild it.
- **Migrations can stall silently.** The hosted GitHub integration applied
  nothing for three days and nobody noticed until a feature failed. The wizard
  (and ideally CI) should compare the newest file in `supabase/migrations/`
  against `supabase_migrations.schema_migrations`.

- **Mob scripts are a SECOND upstream, and a cheap one** (2026-08-13). The
  catalog comes from a SQL dump; the `.lua` mob scripts come from a different
  repo entirely (`SecretsOTheP/quests`, GPL-3.0). At **~3.7 MB** it is nothing
  beside the 97 MB catalog, so unlike that one it does NOT force an on-prem
  decision — it fits a hosted tier comfortably. The wizard should fetch it by
  default and say what it is for: verifying that a trigger watches text which
  actually exists. GPL-3.0 permits redistribution; do not confuse it with the
  unlicensed `pq-companion` material.
- **A competitor ships the whole catalog as one SQLite file inside the
  installer** (`docs/pq-companion/06-data-provenance-and-gaps.md` §1) — offline,
  zero latency, frozen at build time, every user downloading the lot. Ours is a
  shared Postgres: fresh, tiny on the client, useless without network. **A
  self-hosting guild on a flaky box may genuinely prefer their shape**, so the
  wizard must not present the server-side answer as self-evidently correct.

### Identity & auth
- **A sandbox/self-host instance uses its OWN Discord application.** The
  "never a second Discord app" rule applies only to surfaces sharing the
  production Supabase project. Any app works: sign-in requests
  `identify guilds.members.read` and the callback checks the signed-in user's
  own membership, so the app never needs to be in the guild.
- **`wolfpack_members` upserts on `discord_id`**, not on the Supabase user id —
  which is why a fresh auth store still resolves to the right member row. Any
  tenancy work must preserve that.
- **Redirect allow-lists fail silently.** GoTrue ignores a `redirectTo` that is
  not listed and substitutes `SITE_URL`; nothing errors. The wizard must
  round-trip an actual sign-in, not just write the config.

- **A no-Discord door exists and carries deployment-shaped choices
  (2026-08-24, Gonner/Lacunanight — Discord's phone-verification wall).**
  Officer-issued invites (`site_access_invites`, service-role only) let a
  member set username+password on `/auth/claim`; the account is created
  pre-confirmed as `<username>@<login domain>` and stamped onto
  `wolfpack_members.user_id` — the same binding OAuth writes. What the wizard
  must handle:
  - **The login domain is a per-deployment value.** Production hardcodes
    `login.wolfpack.quest` in `web/app/auth/claim/page.tsx` AND
    `web/components/PasswordSignIn.tsx` (two constants that must agree). The
    wizard should template it — any never-mailed domain the deployer controls
    conceptually; it exists only inside GoTrue.
  - **Supabase Auth "Email" provider must be ENABLED** (dashboard-only; no
    MCP/API surface — same shape as the redirect-URL step). "Allow new users
    to sign up" must stay ON (first-time Discord OAuth counts as a signup);
    "Confirm email" state is irrelevant (invites pre-confirm via admin API).
  - **No SMTP anywhere by design** — password reset is an officer re-invite.
    A deployment wanting real email reset is an optional extension with its
    own SMTP config, not a default the wizard should demand.
  - **`ALLOWED_ROLE_NAMES` is enforced at claim time** (the flow's sign-in
    moment) — one more consumer of that env var to keep in parity across
    environments.

### Hosting & deployment
- **Env vars are per environment on Vercel**, and a Production-only value leaves
  preview deployments rendering fine while server-side paths fail.
- **Next.js inlines `NEXT_PUBLIC_*` at BUILD time** — a runtime-only value ships
  as `undefined`.
- **Auth redirects must derive the origin from headers, not `req.url`**
  (`web/lib/request-origin.ts`) — the container's own address is not the user's.
- **Coolify's `Ports Exposes` is metadata; `Ports Mappings` publishes.**
- **`next build` needs ~8 GB**; 4 GB is OOM-killed during type-checking with no
  error in the log.

### Design & UI
- **One visual language across four surfaces** (2026-08-12). The same twelve hex
  values and the monospace stack appear in `web/`, the agent dashboard's
  `WEB_HTML`, and every Mimic overlay — verified by grep, not assumed. A
  self-hosting guild will want their own colours; the wizard should treat the
  palette as ONE token set applied to all surfaces rather than something to
  re-theme per surface, or the product stops feeling like one product.
  Tokens and the mid-raid constraints that shape them:
  `.claude/skills/frontend-design/SKILL.md`.

### Data access
- **PostgREST caps responses at ~1000 rows and says nothing.** `.limit(N)` only
  lowers that ceiling. Anything that can match more must page
  (`web/lib/supabase-paged.ts`). A self-hoster changing `max-rows` changes
  behaviour everywhere, which is itself a reason to page rather than configure.

## 4. Open questions for whoever builds it

- **What does the wizard run as?** A CLI in the repo, a page in the local web
  app, or a one-shot container? A page cannot help before the web app exists,
  which argues for CLI-first.
- **How does it verify Discord?** The ~30 anchor IDs are the top abandonment
  risk. Can the bot create its own channels and threads on first run and report
  the IDs, turning the ceremony into a confirmation step?
- **Where does the eqemu catalog come from?** Unresolved and load-bearing.
- **How much does it own vs check?** Writing `.env` files is easy; the value is
  in verifying each layer and naming the failure.
