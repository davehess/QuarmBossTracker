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

Append here as decisions land. Each entry: the choice, why, and what the wizard
must therefore ask or verify.

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
