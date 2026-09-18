# Hosted service terms — DRAFT for legal review

> **This is a draft written by the maintainers, not by a lawyer, on
> 2026-09-18.** It records the shape of a hosted arrangement as decided
> (`DECISIONS-2026-09-18.md` §8) in plain language, so that anyone approaching
> us today knows what they are agreeing to and so that a lawyer has something
> concrete to correct. Nothing here is offered as a binding contract until it
> has been reviewed and the placeholders in §9 are filled. The code license is
> separate and already binding: `LICENSE` (Business Source License 1.1,
> converting to AGPL-3.0-or-later), explained in `docs/LICENSING.md`.

## 1. What this covers

A **hosted arrangement**: the Licensor runs a deployment of the Wolf Pack EQ
Platform for your guild — the Discord bot, and depending on size the web
application and the client update channel — on infrastructure the Licensor
operates, in exchange for a fee. It does not cover running the software
yourself; that is free under the license, in any of the three sizes below,
with no arrangement needed.

## 2. What you get, and what you do not

**You get:** a working deployment of the size you chose (§3), kept running,
kept on a supported version, and backed up; and **feature requests taken on a
best-effort basis with no committed timelines.** Requests that would help every
guild are built upstream and reach you on the next release; requests that are
particular to your guild are your own configuration (`guild/`) and yours to
carry.

**You do not get:** a service-level agreement. There is no uptime guarantee,
no response-time commitment and no penalty for either. This is one person's
platform run for a handful of guilds on a game server with a limited life;
the fee pays for infrastructure and time, not for guarantees.

## 3. Sizes

Three, all offered from the start, all also available to self-host free:

| Size | Includes | Runs on |
|---|---|---|
| **S** | the Discord bot, the parsing agent and the Mimic client | free tiers where they fit; the bot on a paid tier or your own box, because Railway's free tier cannot run it |
| **M** | S plus the web application, on **your own domain** | a paid hosting plan (the free plans are non-commercial) |
| **L** | everything | as M |

The Licensor shows the full infrastructure cost of a size before anything is
provisioned. That cost is part of the fee, not in addition to it.

## 4. Fee and cycle

- Billed **monthly, in advance.** A month is paid before it starts.
- The fee covers the infrastructure of your deployment plus the Licensor's
  time and resources. It is agreed per guild against the size chosen and is
  not published here.
- **Non-renewal ends the arrangement at the end of the paid month.** There is
  no partial month, no automatic continuation without payment, and no
  obligation to keep a lapsed deployment running.

## 5. Your data is yours

- **Observations made under your deployment belong to your guild** — parses,
  timers, rosters, chat relays, everything your members' clients upload.
- **The Licensor does not read your guild's data** — chat, tells, member
  records — **without your express consent for a specific troubleshooting
  request.** Access is per incident, not standing. The support tooling
  (`wolfpack doctor`) is built so its output cannot contain your secrets or
  your members' data.
- **The Licensor may compute anonymised aggregates** (counts, totals, no names,
  no characters) for operating the service, with the anonymisation performed
  inside your deployment before anything leaves it.
- **Your `/who` observations are never ingested into the Licensor's own
  dataset.** A future per-person "be known" opt-in may let an individual player
  choose to publish their own presence; it will be the individual's choice,
  never the guild's, and it does not exist today.
- **Data from other tenants is never merged into yours as fact,** and yours is
  never merged into theirs. Observations can be fabricated; separation is the
  protection.
- Member-facing privacy rules are in `docs/PRIVACY.md`, which applies to your
  deployment as it applies to ours.

## 6. Leaving

- At the end of your last paid month, **your data is exported, encrypted to a
  key that you hold, and handed to you.** The export is complete enough to
  stand as your guild's archive on its own, and to import into a self-hosted
  deployment under the free license.
- After handover, the Licensor deletes your data from its infrastructure.
  **[Placeholder — the deletion window after handover has not been decided.]**
- You may leave at any month end for any reason; the Licensor may end the
  arrangement at any month end with notice. **[Placeholder — notice period.]**

## 7. Ownership

- **Whatever the Licensor sets up for you is in your name** — billing accounts,
  servers, and your domain. If the Licensor hosts on infrastructure it
  operates, that infrastructure is the Licensor's; your data on it is yours
  (§5).
- **You own your domain, always.** The Licensor takes DNS delegation, never
  the registrar account. A subdomain under the Licensor's own domain is
  available as a zero-setup start and belongs to the Licensor; moving to your
  own domain is supported at any time.
- Your configuration (`guild/`) and any code you change are yours, under the
  contribution terms in `CONTRIBUTING.md` if you send them upstream.

## 8. Gated components

Competitive components — PvP `/who` collection and PvP timers — are
feature-gated and off by default. The de-anonymisation of anonymous players
requires both the feature and a generated alliance code, issued to allied
guilds by agreement. These gates exist for competition on the game server, not
for billing, and apply identically to self-hosted and hosted deployments.

## 9. What a lawyer needs to settle

1. Limitation of liability and warranty disclaimer for the *service* (the code
   license already disclaims for the software).
2. Governing law and venue.
3. The deletion window after handover (§6) and the notice period for ending
   (§6).
4. Whether §5's consent-for-support needs a written form.
5. Whether anything here conflicts with the game server's own rules for
   third-party tools — a conversation with its operators is a prerequisite to
   the first paid arrangement.

## 10. Changes

These terms can change between months; a change is announced before the month
it takes effect in, and continuing into that month is acceptance. The version
in force is the one in this repository at the start of the paid month.
