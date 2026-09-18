# Running a deployment for another guild — the cost-share terms (DRAFT)

> **Draft written by the maintainers on 2026-09-18, revised the same day when
> the model changed from commercial hosting to cost recovery. Nobody who wrote
> it is a lawyer.** It records the shape of an arrangement in plain language so
> that a guild approaching us knows what they are agreeing to, and so a
> professional has something concrete to correct. The binding license is
> `LICENSE` (AGPL-3.0-or-later), explained in `docs/LICENSING.md`.

## 1. What this is, and what it is not

**This is not a product and there is no business.** This platform is tooling for
an emulated server that the community runs as a labour of love, and the same
posture applies here. If the maintainer runs a deployment for your guild, you
are **sharing the cost of it** — infrastructure, and time spent on development —
and nothing above that.

You never need this arrangement. **Running it yourself is free under the
license**, in any of the sizes below, and the self-host path is the one we would
rather you took. This exists for guilds who want the thing working without
standing up four surfaces themselves.

## 2. What you get, and what you do not

**You get:** a working deployment of the size you chose, kept running, kept on a
supported version, backed up; and feature requests taken on a best-effort basis
with no committed timelines. Requests that help every guild get built upstream
and reach you on the next release. Requests particular to your guild are your own
configuration (`guild/`) and yours to carry.

**You do not get:** a service-level agreement. No uptime guarantee, no
response-time commitment, no penalty for either. One person runs this alongside
a raid schedule; the cost share buys infrastructure and attention, not
guarantees. If you need guarantees, self-host — then the uptime is yours to own.

## 3. Sizes

| Size | Includes | Runs on |
|---|---|---|
| **S** | the Discord bot, the parsing agent, the Mimic client | free tiers where they fit; the bot needs a small paid tier or your own box, because Railway's free tier cannot run it |
| **M** | S plus the web application, on **your own domain** | a paid hosting plan |
| **L** | everything | as M |

All three are equally available to self-host, free, today.

## 4. The cost share

- **What it covers:** the measurable infrastructure cost of your deployment, plus
  time spent on development and support. Not profit. The real numbers it is
  computed from are in `docs/DESIGN-selfhost-wizard.md` §2a, and we will show you
  the arithmetic before anything is provisioned.
- **How:** monthly, in advance. A month is covered before it starts.
- **Stopping** simply ends it at the end of the covered month. No partial months,
  no automatic continuation, and no obligation on either side to continue.
- **Donations** toward the project generally are separate from this and are not
  payment for anything. They cover the bill and confer nothing — no priority, no
  feature, no support tier.

## 5. Your data is yours

- **Observations made under your deployment belong to your guild** — parses,
  timers, rosters, chat relays, everything your members' clients upload.
- **The maintainer does not read your guild's data** — chat, tells, member
  records — **without your express consent for a specific troubleshooting
  request.** Access is per incident, never standing. The support tooling
  (`wolfpack doctor`) is built so its output cannot contain your secrets or your
  members' data in the first place.
- **Anonymised aggregates** for operating the service are computed inside your
  deployment, before anything leaves it.
- **Your `/who` observations are never ingested** into anyone else's dataset. A
  future per-person "be known" opt-in may let an individual publish their own
  presence; it will be that person's choice, never the guild's, and it does not
  exist today.
- **No tenant's observations are merged into another's as fact.** Observations
  can be fabricated; separation is the protection.
- Member-facing rules are in `docs/PRIVACY.md`, which applies to your deployment
  as it applies to ours.

## 6. Leaving

- At the end of your last covered month, **your data is exported, encrypted to a
  key you hold, and handed to you.** The export is complete enough to stand as
  your guild's archive and to import into a self-hosted deployment.
- After handover the maintainer deletes your data.
  **[Placeholder — the deletion window has not been decided.]**
- Either side may stop at any month end.
  **[Placeholder — notice period.]**

## 7. Ownership

- **Whatever is set up for you is in your name** — billing accounts, servers,
  and your domain.
- **You own your domain, always.** The maintainer takes DNS delegation, never the
  registrar account. A subdomain under the maintainer's own domain is available
  as a zero-setup start and belongs to the maintainer; moving to your own domain
  is supported at any time.
- Your configuration (`guild/`) and any code you change are yours, under AGPL and
  the contribution terms in `CONTRIBUTING.md` if you send it upstream.

## 8. The competitive features, honestly

PvP `/who` collection and PvP timers sit behind `features.pvp`, off by default,
and de-anonymising anonymous players additionally needs a generated alliance
code. ⚠ **Under AGPL these are defaults, not protections.** Anyone with the
source can remove the check, and the source is public by design. The gates exist
so the features are not on by accident and so alliance data has a deliberate
switch — not because they can be enforced. Treat any competitive advantage they
provide as a courtesy the community extends, not a lock.

## 9. What a professional still needs to settle

Shorter than it was, because there is no service being sold:

1. How **donations and cost shares** are treated for tax where the maintainer
   lives — the question for an accountant, not a guess.
2. Whether accepting cost shares from other guilds needs any legal entity, given
   there is no profit and no SLA (`docs/DESIGN-business.md` §6 frames this as a
   liability question rather than a revenue one).
3. The deletion window and notice period in §6.
4. Whether §5's consent-for-support should be a written form.
5. Whether any of this conflicts with the game server's own rules for
   third-party tools — **a conversation with its operators is a prerequisite to
   the first arrangement**, and cost recovery is a far easier conversation than
   a paid service would have been.

## 10. Changes

These terms can change between months; a change is announced before the month it
takes effect in. The version in force is the one in this repository at the start
of the covered month.
