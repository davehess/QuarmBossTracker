# PRODUCT.md — wolfpack.quest

⚠ **`CLAUDE.md` at the repo root remains the authority for this project.** This
file records *product truth for design work only* (audience, mechanism, scene).
Where the two disagree about architecture, routing, or policy, CLAUDE.md wins.
Recorded 2026-08-28 at Hitya's direction when Impeccable was adopted.

## What it is

The guild-wide companion site for **Wolf Pack**, a raiding guild on **Project
Quarm** — an EverQuest emulator running the game's 1999–2003 era. The site is one
surface of a four-part platform (Discord bot, this site, a log-parsing agent, and
Mimic, an Electron overlay app that runs on top of the game).

## The unique mechanism

**Every raider's game client is a sensor.** A local agent tails EverQuest's log
files and a named pipe from the Zeal client mod, and uploads what it sees. The
site is where forty people's separate views of the same fight are merged into one
truth: damage, healing, deaths, attendance, loot, who was casting what on whom.
No single player can see what this shows them.

## Audience and scene

Adult hobbyists, most with jobs and families, playing a twenty-five-year-old game
seriously. They raid **Sunday, Wednesday and Thursday, 8pm to midnight Eastern**.

Two scenes, and they are opposites:

- **Mid-raid** — Mimic's overlays, read at a glance, over a moving 3D scene,
  while the person is tanking or chain-healing. Milliseconds. Not this surface.
- **Between raids** — this site. Someone on a phone or a second monitor, on a
  Tuesday, looking up how they did, what dropped, who showed up, what they owe.
  Unhurried, curious, sometimes competitive.

The landing page is read by the *between-raids* visitor, and by a prospective
member deciding whether this guild is serious.

## What the landing page must prove

That this guild instruments itself better than anyone else on the server. Not
"we have a website" — that **the data is real, live, and specific**: named
bosses, real timestamps, real damage numbers, from raids that happened.

## Constraints and truths that bind design

- **Members sign in with Discord.** Most data pages are gated; the landing page
  is the only public marketing surface, and it must work signed-out.
- **Real content exists** — recent kills, the platform map, per-character stats.
  Nothing needs to be invented or faked.
- **Phone-first is real.** Officers and members check this on phones constantly.
- **Dark ground is not a style choice.** The audience reads this next to a dark
  game client, often at night, and every other surface of the platform is dark.
- No pricing, no customers, no benchmarks: this is a guild, not a company. There
  is nothing to sell and no claim to inflate.

## Brand commitments

- The name **Wolf Pack**, and the wolf, are the guild's identity. (⚠ Pinned by
  Hitya 2026-08-28 for the landing page: a huge wolf face in the background with
  further wolves appearing behind it — the pack assembling. A pinned brief beats
  any generated direction.)
- `wolfpack.quest` is the domain; `b.wolfpack.quest` is the beta mirror where
  this work is reviewed before it reaches members.

## Assumptions (labelled, not interviewed)

Written from the working session's accumulated product knowledge rather than a
fresh interview, because the facts above are all evidenced in the repo,
`CLAUDE.md`, and this session. Anything a future round contradicts, believe the
round.
