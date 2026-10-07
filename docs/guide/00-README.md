# The Wolf Pack EQ handbook

One set of instructions for the platform, written from the code and checked against it. Each chapter says who it is for and what you will have at the end. Where an older document disagrees with the code, the chapter says so with a ⚠ and follows the code.

> **Draft, 2026-10-07.** Every chapter was written from `main` at that date. Anything marked `⚠ unverified` has not been run end to end; treat it as a plan, not a promise.

## Start here

| You are | Read |
|---|---|
| A raider who wants the overlays and parses | [02 Install and use Mimic](02-raiders-install-mimic.md), then [09 Privacy and your data](09-privacy-and-data.md) |
| A raider who cannot run Mimic (Linux, macOS, a headless box) | [06 The standalone agent](06-standalone-agent.md) |
| An officer standing the platform up | [01 How it fits together](01-overview.md) → [03 The Discord bot](03-officers-discord-bot.md) → [05 The database](05-database-supabase.md) → [04 The website](04-officers-website.md) |
| An officer of another guild asking "could we run this?" | [11 Running it for another guild](11-self-hosting-another-guild.md) |
| A maintainer pushing code | [07 Releases and branches](07-releases-and-branches.md), [08 Contributing](08-contributing.md) |
| Anyone whose setup misbehaves | [10 Troubleshooting](10-troubleshooting.md) |

## Chapters

| # | Chapter | What you have at the end |
|---|---|---|
| 01 | [How it fits together](01-overview.md) | The four parts, where each runs, how one log line travels, and the rules the design keeps |
| 02 | [Install and use Mimic](02-raiders-install-mimic.md) | Mimic installed, signed in or local-only, reading your logs, overlays placed, and a clear idea of what leaves your PC |
| 03 | [The Discord bot](03-officers-discord-bot.md) | The bot online, boards in place, uploads accepted, the first-time order done |
| 04 | [The website](04-officers-website.md) | The site on Vercel, Discord sign-in working, the beta mirror, the role gates |
| 05 | [The database](05-database-supabase.md) | One Supabase project with the schema, the reference catalog and your guild's data; how it changes, what it costs, how it is backed up |
| 06 | [The standalone agent](06-standalone-agent.md) | The same engine Mimic bundles, running without the window |
| 07 | [Releases and branches](07-releases-and-branches.md) | Which branch a change goes to, how a stable Mimic is cut, the raid-night freeze, the `FB-n` loop |
| 08 | [Contributing](08-contributing.md) | The verification gate, the dashboard and test rules, the public-repo rules, the licence |
| 09 | [Privacy and your data](09-privacy-and-data.md) | What is filtered, what is uploaded, who sees it, how long it is kept, how to opt out or ask for deletion |
| 10 | [Troubleshooting](10-troubleshooting.md) | Symptom → cause → fix, with the source of each |
| 11 | [Running it for another guild](11-self-hosting-another-guild.md) | What you need, the order, what is still hard-coded to Wolf Pack, free versus paid |

## What this handbook replaces, and what it does not

The handbook owns **instructions**. These keep their jobs and are not restated here:

| Document | Role |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | The architecture map and the working rules; wins over anything that conflicts with it |
| [`docs/HOW-ITS-BUILT.md`](../HOW-ITS-BUILT.md) | Feature → file index. Read it before saying "we don't have that" |
| [`docs/STATUS.md`](../STATUS.md) | The ledger: done, queued, abandoned |
| `docs/DECISIONS-*.md` | Why each call was made; the newest file's "Open" table is what a session reads first |
| `docs/DESIGN-*.md` | Designs, some built, some not; STATUS says which |
| [`docs/PRIVACY.md`](../PRIVACY.md) | The privacy statement of record, mirrored at wolfpack.quest/privacy |
| `docs/RUNBOOK-*.md` | Step-by-step fixes for specific incidents; chapter 10 links the ones that still apply |
| [`docs/eqemu-catalog-cheatsheet.md`](../eqemu-catalog-cheatsheet.md) | Conventions of the EverQuest reference tables |

The older top-level README carried install steps, env-var tables and a partial command list. Those moved into chapters 02, 03 and 06, corrected against the code (the counts, the Planes of Power unlock, the per-user upload tokens). `CONTRIBUTING.md`, `docs/SELFHOSTING.md`, `docs/GEMINI-SPARK-HELPER.md` and the component READMEs under `apps/`, `web/` and `supabase/` predate parts of the product; each chapter notes where they are stale.

## Conventions

- Placeholders in angle brackets: `<your-site>`, `<beta-host>`, `<your-project-ref>`, `<your-bot-host>`. The repository is public and carries no addresses or identifiers of anyone's machine.
- People are named by role: the guild lead, an officer, a member. Characters in examples are invented.
- A `Source:` line under a section names the file a maintainer should check if the text and the code ever disagree.
