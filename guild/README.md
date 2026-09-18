# `guild/` — your guild's bits, not ours

This folder is the one place a guild running this platform puts **its own style
and format** — the things two guilds would legitimately want different, where
neither is wrong. Everything else in the repository is code, and improvements to
it belong upstream (`CONTRIBUTING.md`).

Design: `docs/DESIGN-guild-kit.md`. Status: **the contract exists; the code does
not read it yet** (slice 1 of that design wires it in). Until then this folder
documents the target, and `config.example.json` is the schema by example.

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
never adopts `guild/` at all.

A few safety-critical values keep a hardcoded fallback on purpose — the
officer-chat privacy filter, for one — so a misconfigured name cannot turn a
protection off.

## What the upstream sync does with this folder

Nothing. `guild/` is excluded from the upstream merge entirely; a release from
upstream can never overwrite your config. Anything you change *outside* this
folder is, by definition, an improvement candidate — `wolfpack diff-upstream`
lists it and a pull request brings it back to everyone.
