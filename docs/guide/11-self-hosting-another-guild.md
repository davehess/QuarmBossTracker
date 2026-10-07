# Running the platform for another guild (for officers)

For an officer of another guild who wants an honest answer to "could we run this for our own members?" Yes, it is free under the licence, and it is **not turnkey yet**. The setup wizard that would make it so is designed but not built.

## The honest picture

- **The licence allows it.** AGPL-3.0-or-later: run, change, fork and self-host for free. If you modify it and let others use your version over a network, you must offer them the source (section 13).
- **It is a four-part system configured by hand.** An August 2026 estimate for a capable officer working alone was 8 to 20 hours over a week, with a 70 to 80 percent chance of giving up. ⚠ That predates the database bootstrap script and has not been re-measured. The recorded give-up points: copying about 30 Discord ids by hand, the database setup, and failures that look like success.
- **The smallest path hosts nothing.** Mimic has a local-only mode, picked in setup. Overlays, triggers and meters run on the raider's PC and nothing is sent to a guild server (Mimic still checks GitHub for updates).

Source: `docs/LICENSING.md`; `docs/DESIGN-external-tenancy.md` §0; `docs/DESIGN-guild-kit.md`; `apps/mimic/main.js`.

## What you need

| Piece | Notes |
|---|---|
| A Discord application of your own | Bot token, the privileged **Server Members** intent on, invited with the permissions in `README.md` ("Required Bot Permissions"). One app serves both the timers and raid voice |
| A Supabase project | Hosted, or the self-hosted Docker stack |
| A bot host | Railway, or any Docker host (`Dockerfile`, `docker-compose.yml`) |
| A web host | Vercel, or Coolify or Docker with base directory `web/`. `next build` needs about 8 GB of memory |
| A domain | For the site and for sign-in redirects |
| A fork of the repository | Mimic builds and the bot's update feeds read a GitHub repository |
| Optional | OpenDKP, Raid-Helper, an always-on box for the raid-voice bot and backups |

The draft hosting terms name three sizes: **S** is the bot, agent and Mimic; **M** adds the website on your own domain; **L** is everything.

Source: `README.md`; `docs/SELFHOSTING.md`; `docs/TERMS-hosted.md` §3.

## The order to stand it up

Chapters 03 to 06 cover each step in detail.

1. **Fork** the repo and read `CLAUDE.md`.
2. **Discord.** Create the application and the channel and thread layout. Put the ids in env vars, or in `guild/discord.json`, which the bot reads at boot to fill any anchor your environment leaves unset. Passwords never go in that file.
3. **Database.** Create the Supabase project. Migrations alone fail on an empty database, because six tables no migration creates; run `scripts/selfhost-bootstrap-db.sh` on a self-hosted Postgres, and judge it by the **role list**, not the healthcheck. ⚠ unverified: whether that bootstrap has been run against a hosted project.
4. **Catalog.** The `eqemu_*` reference mirror (about 97 MB) is filled weekly by `sync-quarm.yml` using three secrets. ⚠ The design docs still call the catalog import the largest unsolved gap, so test it on an empty database.
5. **Bot.** Copy `.env.example` to `.env`, then `docker compose up -d` or deploy to Railway. Slash commands register at startup; run `/board`. Do not rely on a volume.
6. **Web.** Set the variables for **Production and Preview**; `NEXT_PUBLIC_*` values are fixed at build time. In Supabase Auth, enable the Discord provider with your own Discord app and list your redirect URLs.
7. **Mimic and the agent.** Point Mimic at your bot (`cfg.botUrl`, or `--bot-url`). Set `MIMIC_LINK_VERIFICATION_URL` on the bot so sign-in opens your site.
8. **Backups.** Schedule a nightly dump and **restore one** before you need it.

Source: `docs/SELFHOSTING.md`; `README.md`; `guild/README.md`; `supabase/bootstrap/`.

## What to change: settings that exist

| Setting | Default is Wolf Pack's | Notes |
|---|---|---|
| `DISCORD_GUILD_ID` | Web falls back to our server | Set it on **bot and web**. Unset on the web, your site gates against *our* guild |
| `ALLOWED_ROLE_NAMES`, `OFFICER_ROLE_NAMES` | `Pack Member`, `Officer`… | Unset on the web, any guild member can sign in |
| Channel and thread ids | About 75 env vars | Plus 14 literal id fallbacks, below |
| `DEFAULT_TIMEZONE`, raid schedule | Eastern; Sun, Wed, Thu | Also `raid-freeze.yml` and `_raidHoldNow` in `index.js` |
| `PVP_GUILD_NAME`, `OPENDKP_CLIENT_NAME` (your OpenDKP subdomain), `OPENDKP_*` | `Wolf Pack`, `wolfpack` | Whether your OpenDKP is hosted or your own sets the call budget |
| `TAG_CHANNEL_SPEC`, `OFFICER_CHANNEL_SPEC` | Unset | Channel *names* are config; their passwords are secrets, in `.env` only |

Source: `.env.example`; `web/.env.example`; `guild/config.example.json`.

## Not yet generalised: no setting exists

Counts are from `main` on 2026-10-07. A raw search for `wolfpack` or `wolf pack` matches 211 lines in `index.js`, 148 lines in 35 files of `utils/`, 88 in 30 files of `web/lib/`, and 208 in the agent. Many are table and package names, so the table counts the ones that matter.

| Hard-coded | Count | Where |
|---|---|---|
| Database guild tag `wolfpack` in web queries | 213 lines, 74 files | `web/lib`, `web/app`. The bot reads `SUPABASE_GUILD_ID` (about 150 sites in 25 files), but the web does not: **leave it at the default** |
| Rank and role names (`Raid Pack`, `Pack Leader`, `Pack Member`…) | 25 files | `utils/roster.js`, `utils/opendkp.js`, `utils/openDkpSync.js`, `commands/register.js`, `web/lib/popRoster.ts`, `web/lib/officer.ts`, many `web/app/admin/*` pages |
| The name "Wolf Pack" | 331 mentions, 88 files | Mostly screens and messages: `apps/mimic`, `web/app`, `index.js` |
| `wolfpack.quest` links | 387 mentions, 77 files | `utils/onboarding.js`, `index.js`, the agent and its dashboard, `apps/mimic` |
| The sign-in account domain | 2 files | `web/app/auth/claim/page.tsx`, `web/components/PasswordSignIn.tsx` |
| Literal Discord id fallbacks | 14 ids, 5 files | `index.js`, `commands/retrigger.js`, `utils/hateBoard.js`, `utils/raidNight.js`, `web/lib/discord.ts` |
| The officer-channel and tag-channel names | The agent, one admin page | `packages/wolfpack-logsync/index.js`, `web/app/admin/overlays/page.tsx`. A generic rule still drops every custom channel |
| Time zone `America/New_York` | 47 mentions, 18 files | `index.js`, `utils/`, `web/lib`, the agent |
| The upstream GitHub repository (releases, feeds, links) | 22 files | `apps/mimic/package.json`, `main.js`, the bot's agent manifest in `index.js`, `utils/mimicReleases.js`, `web/app/mimic/*` |
| Supabase project reference | 5 code files | the agent, `utils/openDkpSync.js`, `web/lib/quartermaster.ts`, two scripts |
| Boss list and era | 158 bosses; one date | `data/bosses.json`; the Planes of Power unlock in `utils/config.js` |

A guild with its own Mimic builds must change the repository in **three** places: the build's publish target, the release feed and the alpha feed. PvP `/who` harvesting ships but its tables start empty; the planned `features.pvp` switch lives in `guild/config.json`, which the bot does not read yet.

Source: counts by `grep` on `main`; `docs/DESIGN-selfhost-wizard.md` §3; `docs/DESIGN-guild-kit.md` §1.

## Free or paid

Figures were recorded on 2026-09-01. ⚠ Check each vendor's current pricing.

| Layer | Free tier | Verdict |
|---|---|---|
| Supabase | 500 MB database, 5 GB egress, 1 GB storage; pauses after 7 days idle | **Briefly, and only with retention cut.** The catalog takes about 119 MB first, leaving about 380 MB. Our largest table, threat snapshots, grows about 15 MB a day |
| Railway | 0.5 GB memory | **No.** The bot peaked at 0.70 GB. The $5 Hobby plan fits; our measured draw was about $2 a month |
| Vercel Hobby | Free | **Yes**, but it is non-commercial and caps deployments at 100 a day |

The hosted floor is about $30 a month ($25 Supabase Pro plus $5 Railway). Fully on your own hardware it is electricity. Neither vendor meters *requests*. The bill is database size and egress, so poll cadence and wide reads cost more than write frequency.

**Our retention windows are paid defaults.** Threat snapshots 30 days, buff landings 7, `/who` 60, experience 30. On a free database set each env var (`THREAT_SNAPSHOT_RETENTION_DAYS`, `BUFF_CASTS_RETENTION_DAYS`, `WHO_OBS_RETENTION_DAYS`, `XP_EVENTS_RETENTION_DAYS`), aim for about 7 days on threat data or shed it with `flag_shed_threat_snapshot`, and set `TRACK_UNCURATED_MOBS=0`. `0` disables a sweep and keeps rows forever.

Source: `docs/DESIGN-selfhost-wizard.md` §2a, §3; `docs/COSTS.md`; `index.js` (retention sweeps).

## The planned wizard (not built)

`DESIGN-selfhost-wizard.md` is a **planning target, not scheduled**. Built so far: the `guild/` config contract, and the bot reading `guild/discord.json`. The design calls for a command-line tool that:

- creates the Discord layout and reports the ids, removing the biggest give-up point;
- bootstraps the database, writes `guild/config.json`, `guild/discord.json` and the secrets, and **verifies** each step (it completes a real sign-in rather than trusting config);
- derives retention from your chosen plan and shows the ceiling first;
- generates `TENANT.md`, `tenant.json` and a redacted `wolfpack doctor` bundle, so any AI assistant can help you without seeing secrets or member data.

A fork's upstream sync would never touch `guild/`. The hosted path is stubbed to "talk to us" (chapter 9). Record each deployment decision in `DESIGN-selfhost-wizard.md` §3 as you make it.

Source: `docs/DESIGN-selfhost-wizard.md`; `docs/DESIGN-guild-kit.md`; `guild/README.md`.
