# Licensing — the plain-language version

`LICENSE` is the binding text. This page is what it means for the three kinds
of people who will read it. It is not legal advice; nobody involved is a lawyer,
and if real money ever moves under the commercial arrangement, have one read
both files first.

**The license is the Business Source License 1.1, and every version becomes
AGPL-3.0-or-later four years after it ships.**

## If you are a guild that wants to run this

You can. Free, no arrangement needed.

- Clone it, fork it, modify it, and run it — on your own box, in your own cloud,
  or on hosting you pay for — for your guild, your raid, or a player community
  you belong to.
- Keep your changes private or publish them; the license does not compel you
  either way until the Change Date. **We ask that you send them upstream** (a
  database port, a performance fix, platform compatibility) — see
  `CONTRIBUTING.md`. A fork that carries its improvements back is how the next
  guild gets them.
- Covering your own costs from your own members is your business, not ours.

The one thing you may not do without talking to us: **offer it to other people
for money.** Hosting it for third-party guilds for a fee or subscription,
selling a service built substantially on it, or bundling it into something you
charge for — those need a commercial license from the Licensor. Open an issue
titled "Commercial license" and we will work out terms.

## If you want to host it for others commercially

Come and talk. That is the whole point of the choice: the code stays open to
read, run and improve, and a paid hosted offering is a conversation rather than
a free ride. The terms of that conversation are not fixed in the license; they
are agreed per arrangement. The shape of an arrangement — sizes, monthly cycle,
no SLA, your data stays yours, encrypted handover when you leave, you own your
domain — is drafted in plain language in `docs/TERMS-hosted.md`, marked for
legal review.

## If you are contributing

There is no CLA to sign. Opening a pull request is the agreement, and the terms
are in `CONTRIBUTING.md` under *Licensing*. The short version: you keep your
authorship, your contribution is licensed the same way as the rest, and you
grant the Licensor the right to relicense it — which is the clause that keeps
the commercial license and the four-year conversion workable once the code is
no longer one person's.

## Why this license and not the obvious ones

- **Not BSD-3 (where it started).** Permissive licensing lets anyone take the
  code, host it, charge for it and owe nothing back — including a guild we
  would decline. That is the story behind every relicensing-under-pressure of
  the last decade, and choosing correctly up front is far less ugly.
- **Not AGPL alone.** AGPL would enforce the share-back we want from
  self-hosters, but its §10 forbids adding any further restriction, royalties
  included — under it anyone may charge freely as long as they publish their
  changes. A revenue arrangement is impossible on AGPL.
- **BSL, converting to AGPL.** Commercial use is reserved to the Licensor now,
  so charging requires an arrangement; the Change License means the whole
  thing still ends up fully open source, on the copyleft license that actually
  reaches hosted services. The Covenants of Licensor mean the Additional Use
  Grant can only *add* permission, so share-back cannot be a condition of the
  grant — until the Change Date it is a norm we ask for, not a term we enforce.

Two footnotes for the lawyer, if there is ever one:

1. Covenant 1 requires the Change License to be compatible with GPL-2.0 *or a
   later version*. AGPL-3.0 combines with GPL-3.0 under GPL-3.0 §13, which is
   the reading relied on here. If that is judged too thin, GPL-3.0-or-later is
   the fallback and loses only the network-service clause.
2. Relicensing from BSD-3 was clean because the repository has effectively one
   copyright holder. That stops being true at the first merged outside
   contribution, which is why the contribution grant exists and why it landed
   in the same change as the license.

## The bundled third-party code is unchanged

`.claude/skills/impeccable` (Apache-2.0) and `.claude/skills/ponytail` (MIT) are
vendored under their own licenses, which they keep. Nothing here relicenses
anyone else's work.
