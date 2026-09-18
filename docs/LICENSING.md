# Licensing — the plain-language version

`LICENSE` is the binding text. This page is what it means for the three kinds of
people who will read it. It is not legal advice; nobody involved is a lawyer.

**The license is the GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later). It is open source** — OSI-approved, FSF-published, the same
license Grafana, Mastodon and Nextcloud use.

## If you are a guild that wants to run this

Take it. No arrangement, no fee, no asking.

- Read the code, change it, fork it, redistribute it, and run it for your
  guild — on your own box, in your own cloud, or on hosting you pay for.
- Charge your own members for the server bill if you like. That is between you
  and them.
- There is no time limit and nothing expires.

**The one obligation, and it is the point of choosing this license:** if you
modify the platform and let other people use your modified version **over a
network** — a Discord bot, a website, anything they reach remotely — you must
offer those users its source. That is AGPL **§13**, and it is why this license
rather than a permissive one: the fix you made for your guild's hardware, or
your database port, or your platform-compatibility work, comes back to everyone
instead of dying in a private fork.

Using it unmodified, or keeping your changes to yourself and never letting
outsiders use them over a network, triggers nothing.

## If you want to host it for other guilds

You can, under AGPL, including for money — and if you do, §13 applies: your
users get your source. That is the deal, and it is a fair one.

If you want to host a modified version commercially **without** publishing your
changes, that needs a separate commercial license from the Licensor, who retains
copyright. Open an issue titled "Commercial license" and we will work out terms.

## Paying for it

**Nothing about this project is for profit.** It is tooling for an emulated
server that the community runs as a labour of love, and that is the posture here
too. The only money that changes hands is **cost recovery** — infrastructure
bills, and time spent on development.

- **Donations** are the mechanism: they cover the hosting bill and nothing more.
  Giving nothing costs you nothing and changes nothing about what you can do.
- **If the maintainer runs a deployment for your guild**, the cost of that
  deployment is shared with you. No license permits or forbids that — charging
  for a service you operate is outside every open-source license. The shape of
  such an arrangement is in `docs/TERMS-hosted.md`.
- There is no paid tier, no feature behind a paywall, and no plan for one. Every
  feature is in the repository, under this license, for everyone.

## If you are contributing

There is no CLA to sign. Opening a pull request is the agreement, and the terms
are in `CONTRIBUTING.md` under *Licensing*. In short: you keep your authorship,
your contribution is AGPL like the rest, and you grant the Licensor the right to
license it under other terms as well — which is what keeps the commercial-license
option above available once the code is no longer one person's.

## How it got here, and why not the alternatives

Worth recording, because the project changed licenses twice in two days and the
reasoning is the useful part:

- **BSD-3** (until 2026-09-18) let anyone take the code, host it, charge for it
  and give nothing back. That is fine for a library and wrong for a platform.
- **BSL 1.1** (2026-09-18, one day) reserved commercial use to the Licensor.
  It did that job, but at three costs: it is *not* open source, which reads badly
  in a community that is deliberately not-for-profit; it disqualified the project
  from free code signing; and — the one that decided it — the BSL Covenants let
  its Additional Use Grant only *add* permission, never impose a condition, so it
  **could not compel share-back at all**. Self-hosters' improvements were a
  request in `CONTRIBUTING.md`, not a term.
- **AGPL-3.0** (2026-09-18, current) is open source, fits a not-for-profit game
  community, and its §13 makes share-back an obligation rather than a request —
  the thing that was actually wanted. What it gives up is the ability to stop
  someone else charging; retained copyright plus the contribution grant keeps a
  commercial license available for anyone who wants to host without §13.

## The bundled third-party code is unchanged

`.claude/skills/impeccable` (Apache-2.0) and `.claude/skills/ponytail` (MIT) are
vendored under their own licenses, which they keep. Both are AGPL-compatible
inbound. Nothing here relicenses anyone else's work.
