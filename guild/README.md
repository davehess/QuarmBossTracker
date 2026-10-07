# `guild/` — your guild's bits, not ours

This folder is the one place a guild running this platform puts **its own style
and format** — the things two guilds would legitimately want different, where
neither is wrong. Everything else in the repository is code, and improvements to
it belong upstream (`CONTRIBUTING.md`).

Design: `docs/DESIGN-guild-kit.md`. Status: **slice 1a is live — the bot reads
`discord.json` at boot** (bot 3.1.129) and fills any anchor it finds unset in
the environment. **Slice 1b: `config.json` is now read at boot and by
`utils/guildConfig.js`** — the loader fills unset env names from it, and new
code reads typed getters (`guildName()`, `webBase()`, `repo()`, `roles()` …)
instead of a literal. The rest of the de-brand sweep is slice 2.
`discord.example.json` lists every anchor key the bot knows, generated from the
code; `config.example.json` is the schema by example.

### What `config.json` can fill

At boot the bot fills these env names from `config.json` **only when they are
unset** (arrays join with commas; example placeholders such as `<your-guild>` are
ignored, with a warning at boot naming each one):

| Env name | `config.json` path |
|---|---|
| `SUPABASE_GUILD_ID` | `guild.tag` |
| `DISCORD_GUILD_ID` | `discord.guildId` |
| `ALLOWED_ROLE_NAMES` | `discord.roles.member` + `discord.roles.officer` (Discord roles are flat, so the allow-list is the union; a set legacy `ALLOWED_ROLE_NAME` also counts as "already set") |
| `OFFICER_ROLE_NAMES` | `discord.roles.officer` |
| `OPENDKP_CLIENT_NAME` | `opendkp.clientName` |
| `DEFAULT_TIMEZONE` | `guild.timezone` |
| `TAG_CHANNEL_NAME`, `OFFICER_CHANNEL_NAME` | `channels.raidTag`, `channels.officer` |
| `WEB_BASE_URL` | `sites.web` |
| `PVP_GUILD_NAME` | `guild.inGameGuild` |
| `GITHUB_REPO` | `repo` (`owner/name`) |
| `GUILD_NAME`, `GUILD_SHORT` | `guild.name`, `guild.short` |
| `GUILD_PROVISION`, `_OPTIONAL`, `_SKIP`, `_CREATE_CHANNELS`, `_LOCK`, `_PIN` | `discord.provision.*` |

Keys with `spec`, `token`, `key`, `secret` or `password` as a word of their name
(`apiKey`, `api_key`, `botToken`, `spec` — not `keyboard`) are refused when the
file is read — they are logged and ignored, never used.

Committing your own `guild/config.json` is the intended setup; the test suite
never reads the real `guild/` folder, so a fork's `npm test` stays green with it.

## What goes where

| File | Who writes it | Committed? | Holds |
|---|---|---|---|
| `config.json` | you (or the wizard) | **yes** | identity, palette, wording, channel *names*, raid schedule, sites, APIs, feature flags |
| `discord.json` | the provisioner | **yes** | every Discord anchor id the bot needs — channel, thread, message and role ids. Ids are not secrets; anyone in your Discord can see them |
| `TENANT.md` / `tenant.json` | `wolfpack doctor --write` | **yes** | a description of *this* deployment that a person or any AI assistant can read to help you |
| `.env` (repo root) | you (or the wizard) | **never** | the real secrets: Discord token, database service key, channel passwords, OpenDKP credentials, the agent token |

**The line between `config.json` and `.env` is: would you paste it in a public
channel?** A channel's *name* — yes. Its *password* — no. The name goes in
`config.json`; the password goes in `.env` and is referenced by the name.

## Resolution order

Every consumer resolves a value the same way: **environment variable →
`guild/` file → built-in fallback.** Environment always wins, so a value you
set on your host overrides the file, and nothing changes for a deployment that
never adopts `guild/` at all. The built-in fallbacks are Wolf Pack's own
values, so a missing `config.json` behaves exactly as before.

A few safety-critical values keep a hardcoded fallback on purpose — the
officer-chat privacy filter, for one — so a misconfigured name cannot turn a
protection off.

## What the upstream sync does with this folder

Nothing. `guild/` is excluded from the upstream merge entirely; a release from
upstream can never overwrite your config. Anything you change *outside* this
folder is, by definition, an improvement candidate — `wolfpack diff-upstream`
lists it and a pull request brings it back to everyone.
