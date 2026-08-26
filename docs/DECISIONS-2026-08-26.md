# Decisions — 2026-08-26

## PoP page: My Characters tab, and default views scope to mains (Hitya)

> "let's have a my characters mode on the pop page for individuals can track
> all of their characters in one place. due to the nature of pop flagging
> they may do it for many of their toons and we shouldnt only track mains.
> we should default our views to mains"

Two calls, opposite directions, both land in `web/app/pop/page.tsx`:

1. **Guild-wide surfaces (chart, matrix, planner, "PoP spells ... still
   need") default to `?scope=mains`**, with a one-click toggle to
   `?scope=all`. That's the number an officer planning a raid night wants —
   how many MAINS can walk into a zone tonight — without alts inflating or
   deflating it.
2. **A new `?view=mine` tab ignores scope entirely** and always shows every
   character linked to the viewer's account (`ownedCharacters()`, same helper
   `/me`'s inventory page uses) — main and alt alike, same table shapes as
   Matrix (zone access) and the spell-needs table, plus which of their
   characters have no spellbook on file yet (a distinction the guild-wide
   table can't make in aggregate — see its long-standing "nothing missing, or
   nothing submitted" hedge, unchanged, it just doesn't apply per-character
   the way `?view=mine` can afford to check).

**Required widening `pop_spell_needs` off main-only** (migration
`20260826010000_pop_spell_needs_all_characters.sql`) — it now returns every
non-deleted, non-excluded character with a submitted spellbook (main or alt)
and an `is_main` column per row, so the mains-default and the My Characters
view both read the same RPC and just filter differently. Signature changed
(new column) → dropped and recreated, same pattern as every prior
`pop_spell_needs` revision.

### ⚠ The widening exposed a real perf bug, not caused by widening itself
Going from 28 mains to 117 eligible characters (4.2×) turned a latent problem
into a reproducible 60s+ hang calling the function directly: the per-character
level lookup was a **correlated subquery against `who_directory`** — a view
with six `DISTINCT ON` / `GROUP BY` passes over the full `who_observations`
table (120k+ rows), not materialized. Postgres can't push a character filter
below those passes, so *every row* of the candidate set re-ran the entire
view — measured at 267k buffer hits for one run; ×117 ≈ 31M. Fixed with a
plain `LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)`
instead of `(SELECT MAX(w.level) FROM who_directory w WHERE ...)` — the view
computes once, characters hash-join against it. Verified against prod:
1.185s end-to-end for all 2,550 output rows. `who_directory` already returns
one row per character (its own internal `DISTINCT ON`), so the join is exact,
not an approximation of the old `MAX()`.

**Lesson for next time a guild-wide RPC's input set gets widened**: if it
touches `who_directory` (or any other unmaterialized multi-pass view) via a
correlated subquery, check whether the row count multiplier turns a "fine at
N" query into "broken at 4N" *before* shipping — `EXPLAIN ANALYZE` on the
inlined function body (not the wrapped `SELECT * FROM fn(...)` call, which
Postgres treats as an opaque black box and won't show the real plan) is what
caught this.

Shipped: web 1.1.97, migration applied + committed, `test/pop-spell-needs-all-characters.test.js`
(9 cases) guards both the mains-only-filter removal and the join-not-subquery
fix so neither regresses silently. Full test suite green (2,340 passed),
`tsc --noEmit` clean.

---

## Open — read this first

⚠ **This table lagged three days (2026-08-21, -24, -25 shipped without
refreshing it)** — carrying forward only what this session can directly
confirm true right now. For anything not listed here, `DECISIONS-2026-08-20.md`
is the last verified snapshot; treat items there as unconfirmed until a
session re-checks them.

| Item | State |
|---|---|
| **`OPENDKP_HALT=1` is still ON** | Set 2026-08-25 after OpenDKP's owner (Moncs) reported $200+/mo API Gateway costs from our traffic. Root cause fixed + shipped (bot 3.1.71–3.1.72: fan-in auction cache, `/auctions/active`, outbound governor) — see `DECISIONS-2026-08-25.md`. **Stays on until Moncs unblocks our Railway IP and we confirm the new volume is sane.** Flip before the next raid (Wed 8pm ET) or bidding is dead that night |
| **PoP page: this session's `?view=mine` + mains-default scope** | Shipped clean (web 1.1.97, migration `20260826010000` applied). No open follow-up |
| **Everything from `DECISIONS-2026-08-20.md`'s table** | Not re-verified since — re-check before treating as current (raid-night items especially age fast) |


---

## A public OpenDKP counter, and a kill switch that doesn't need a deploy

> "moncs is ready to unblock us, so I need a live counter site that's open
> access on wolfpack.quest (make it /opendkp) and I need to be able to shut it
> down quickly if it's not fixed."

**`wolfpack.quest/opendkp` — no sign-in, deliberately.** It is the only
member-facing page without an auth check. The reason is the whole point of the
page: the person who most needs it is OpenDKP's owner, who is not in our
Discord and is being asked to unblock our IP on our word after our traffic cost
him real money. A page behind our sign-in would be useless to exactly one
person, and he is the one.

**What it exposes, and nothing else:** endpoint shapes, call counts, bytes,
error counts, halt state. No member names, no character names, no DKP, no
credentials. `opendkp_call_stats` is consequently the single `anon`-readable
table in the schema — a deliberate exception, recorded here so nobody widens it
by pattern-matching later.

**Endpoints are normalized to HIS log shape** (`/clients/{client}/auctions/{id}/bids`)
rather than ours, so his API Gateway table and our page can be read across
without a translation step. Our numbers in our own format is what he already had
reason to distrust.

**The counter must not become the thing it measures.** Counts aggregate in
memory and flush once per COMPLETED minute; a row per call would be the same
write amplification that caused the incident. Blocked calls are still counted,
so the page distinguishes "the kill switch is working" from "the bot fell over"
— without that, halted and dead look identical from outside.

**TWO halts now, and the difference matters:**
1. `OPENDKP_HALT` env var — needs a Railway redeploy (~90s).
2. `flag_opendkp_halt` in the `overlay_tuning` map — set from `/admin/overlays`,
   lands within the existing 60s tuning cache, **no deploy**.

The second is what "shut it down quickly" actually requires; a build is not
quickly, and promising a fast stop we could not deliver would be the second
broken promise in the same conversation. Either halts; both must be clear to
resume. Officer-gated by living on `/admin/overlays` — the counter page is
public, the switch is not, because a public kill switch is an abuse surface.

Shipped: bot 3.1.73, web 1.1.98, migration `20260826120000_opendkp_call_stats`
(applied + committed). Tests: `test/opendkp-call-stats.test.js` (11).

---

## Unblock day: what the 1,486 actually was (bot 3.1.74 / web 1.1.99)

Moncs lifted the block, `OPENDKP_HALT` went to 0, and the page immediately read
**1,486 "refused by us" against 4 real calls.** Hitya: *"stats are flowing but
I'm concerned by our block."* Right to be — that reads like we tried to hammer
him 1,486 times an hour.

**We didn't. Every one of them was AWS Cognito** — our own sign-in provider,
`POST /`, which never touches OpenDKP's API. Zero reached his infrastructure.
Confirmed by grouping `opendkp_call_stats` by endpoint rather than reasoning
about it.

But the cause was a real hole I shipped on 2026-08-25, and the halt was the only
thing hiding it:

**1. The fan-in cache had no negative caching.** `_panelAuctions` cached
successes only. With a COLD cache and a failing upstream, every dashboard poll
re-attempted — so the guarantee the whole design rests on ("N dashboards cost
what one costs") **evaporated exactly when OpenDKP was unreachable**, which is
the moment it matters most. Measured: ~106 attempts/minute, which is 4
dashboards × 7s × the auctions+my-bids pair. Had Moncs's API been merely *slow*
rather than blocking us, we would have done this to him for real. Failures now
cache for 20s — long enough to collapse a poll storm, short enough that
recovery is seconds, and on its own TTL so "upstream broken" never masquerades
as "no auctions open" for the 120s idle window.

**2. A failing token turns one retrying caller into an auth storm.** Every
endpoint wrapper calls `getAuthToken()` first, and because a *local* refusal
fails without touching the network, the loop spun at CPU speed rather than
network speed. Failed auth now backs off 15s.

**3. …but a local refusal must NOT arm that backoff.** Caught by
`test/opendkp-halt.test.js`, which asserts both wrappers report "halted": with
the naive version the first refusal armed the auth backoff and the second call
reported *"auth backing off"* instead — for 15s after the halt was cleared.
A halted call never reaches Cognito, so there is nothing to back off from.
Local refusals are now tagged (`err.localRefusal`) and skip it.

**4. The page was overstating our traffic.** Folding Cognito into "calls to
OpenDKP" is wrong in the one direction a page built to regain trust must never
be wrong in — it invites a re-block for traffic we never sent. Auth is now
counted and displayed **separately and explicitly labelled "not OpenDKP"**.

Tests: `test/opendkp-panel-negative-cache.test.js` (5, mutation-checked —
removing the negative cache kills two), plus 5 more in
`test/opendkp-call-stats.test.js`. Suite green (2,361).

---

## "Why are we auditing so frequently" — the early break was never engaging

> "this still feels like a lot. the dkp numbers don't change outside of raids
> unless we have to override something. why are we auditing so frequently"

Right on both counts, and the live counter proved it. Grouping
`opendkp_call_stats` by minute:

```
14:58  17 calls  6214 kB
14:28  17 calls  6214 kB
13:58  17 calls  6214 kB
13:29  17 calls  6214 kB
```

**Byte-for-byte identical, every 30 minutes — 297 MB/day, essentially all of it
spent discovering that nothing had happened.** The 2026-08-26 early break is
NOT engaging.

**Why:** the break only fires once page 1 *proves* newest-first ordering
(page-1 max id ≥ our watermark). That guard is doing exactly its job — it
cannot prove it, so it falls back to the full walk. Which means **audits almost
certainly page OLDEST-first**, and the assumption behind the break (inferred
from the auctions endpoint's "page 1 = most recent" note) was wrong for this
endpoint. Recorded rather than fixed blind: a one-line probe now logs page 1's
id range against the watermark each pass, so the next session reads the ordering
off Railway instead of inferring it from a sibling endpoint a second time.

**The fix shipped now is Hitya's framing, not mine, and it is better** — it
needs no ordering assumption at all. The endpoint has no `since` filter, so
there is no cheap way to *ask* whether anything changed. If the answer keeps
being no, ask less often:

- Doubling idle backoff per consecutive empty pass: 30m → 1h → 2h → 4h, capped
  at `OPENDKP_LIST_IDLE_MAX_HOURS` (default 6).
- **Any new row resets it instantly.**
- **A raid window pins it to every pass** (Sun/Wed/Thu 8pm–midnight ET, hour
  either side) — DKP moves during raids, and a 6h delay there is the one time
  it would matter.
- `OPENDKP_LIST_IDLE_BACKOFF=0` disables the whole thing, so a bad backoff can
  never wedge the sync.
- When backed off it makes **no HTTP call at all** — not a cheaper call, none.

Expected effect on an ordinary Tuesday: **48 walks/day → ~6**, i.e. 297 MB/day
→ roughly 37 MB. The deliberate trade: a manual override made at 3pm on a
non-raid day is picked up within 6 hours instead of within 30 minutes.

Still open, and the reason the probe exists: if audits really are oldest-first,
the *right* fix is to jump to the LAST page (new rows land at the end) instead
of walking from page 1 — which would take a pass from 17 calls to ~1 even
during raids. Do not implement that until the log confirms the ordering.

Tests: 5 more in `test/opendkp-list-endpoint-writes.test.js`, mutation-checked
(disabling the skip, and making the raid window always-true, each kill tests).
Two self-inflicted errors worth noting: the first slice-marker change dropped
`_pkColFor` and broke all 11 existing tests, and the first raid-window fixture
used a SATURDAY timestamp while claiming Sunday — asserting the opposite of
what it said. Both caught by the suite, both now commented in place.
