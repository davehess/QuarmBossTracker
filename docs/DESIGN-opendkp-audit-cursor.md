# API proposal to OpenDKP: an incremental audit feed

**Status: designed 2026-08-27, REFRESHED 2026-08-31, not yet sent.** Supersedes
the earlier "`?since` on the list endpoints" ask (`opendkp-api-request`
artifact), which was right in spirit and aimed at too many endpoints.

⚠ **The 2026-08-27 numbers in this doc were stale and are now replaced.** We
cut our own traffic 60% in the four days after writing it (116 → 46 MB/day), so
quoting the old figures to Moncs would have been wrong in the direction that
damages credibility — he can read his own logs. Every number below is measured
from `opendkp_call_stats` over the 7 days to 2026-08-31.

⚠ **A cheaper tier was added on 2026-08-31**, from reading OpenDKP's own API
reference: `/raids` already accepts `?count=N`. So the smallest useful version
of this ask is a parameter he has already built somewhere else — see "The ask"
below, which is now a ladder rather than a single request.

Artifact for Moncs: https://claude.ai/code/artifact/924ea487-4fb4-4e55-ac66-4cb8ed6be897

---

## The finding

**OpenDKP already has the change feed we need. It's the audit log.** Verified
against our mirror (48,055 rows), the `Action` taxonomy covers every mutation we
care about:

| Action | rows | our use |
|---|---|---|
| `Auction Closed` | 15,702 | winner + price |
| `Auction Created` | 14,120 | new item up for bid |
| `Bid Delete` / `Bid Update` | 6,145 | re-read that auction's bids |
| `Auction Updated` / `Restored` / `Deleted` | 4,289 | re-fetch or drop |
| `Raid Created` / `Updated` | 3,799 | ticks, attendance |
| `Character Created` / `Updated` | 2,530 | roster |
| `Adjustment Created` | 344 | manual DKP |

**What's missing is the entity id.** A real row, verbatim:

```json
{"AuditId": 4635440, "ClientId": "8fa8662b40c12",
 "Timestamp": "2026-08-27T02:09:55Z", "CognitoUser": "Talames159",
 "Action": "Auction Closed"}
```

It says an auction closed. It never says *which*. So the only way to find out is
to download the whole auction list (665 KB) and diff.

## The ask — a ladder, cheapest first

Deliberately staged so that declining the big one still leaves an easy yes. Each
tier is independently useful and each is additive: a caller that passes none of
these sees exactly what it sees today.

### Tier 0 — `?count=N` (newest-first) on `/audits`

**He has already built this.** OpenDKP's own reference documents
`GET /clients/{client}/raids?count=10`. The same parameter on `/audits`,
returning the newest N, is the smallest possible change and needs no new
concept — no cursor, no timestamps, no schema.

It alone fixes the single largest line in our bill. We poll `/audits` to learn
one thing: whether the highest `AuditId` has moved. Today that costs a 330 KB
page. With `?count=10` it costs about 2 KB.

**27.0 MB/day → ~0.1 MB/day, on its own.**

### Tier 1 — `?since=<AuditId>` on `/audits`

Rows above that id, oldest first. An indexed range scan on a table he already
writes to. Strictly better than Tier 0 (no re-reading rows we hold, no guessing
N), but it is a new parameter rather than an existing one.

### Tier 2 — the affected row's id on each audit entry

Plus an `EntityType` if the `Action` string isn't reliably one-to-one with a
type. **This is the multiplier**: it is what turns the other full pulls into
targeted reads, because knowing *that* an auction closed is useless without
knowing *which*.

**No new endpoints in any tier.** `/auctions/{id}`, `/raids/{id}` and the
character reads already exist and we already call them (`utils/opendkp.js` —
`getAuction`, `getRaid`).

**If only one is feasible, take Tier 0** — it is the cheapest for him to build
and the largest single saving. Tier 2 is the one that changes the shape of our
whole integration.

## Why it's the cheap version for him

- Reuses the existing write path — a column on a row he already writes.
- Replaces a **table scan with a range scan**: today `/audits` re-serialises
  48,055 rows across 17 pages so we can discover a handful of new ones.
- Scales with **activity, not client count**: 163 events on a busy day is 163
  events whether one member is online or forty.

## The numbers that make the case

Measured over the 7 days to 2026-08-31, from our own outbound counter.

**The guild generates ~55 audit events on an active day** (17 of the last 21
days had any; 164 on the busiest). We spend **27 MB/day on `/audits`** to find
them — 48,377 rows re-serialised so we can notice a few dozen new ones.

| endpoint | today (per day) | after Tier 0 | after Tiers 1+2 |
|---|---|---|---|
| `/audits` | 82 calls · **27.02 MB** | ~82 calls · ~0.1 MB | delta poll, a few hundred bytes |
| `/characters` | 63 · 8.53 MB | unchanged | only on Character events |
| `/auctions` | 19 · 7.84 MB | unchanged | gone — `/auctions/{id}` on the few that changed |
| `/raids` + `/raids/{id}` | 179 · 1.74 MB | unchanged | detail only on Raid events |
| `/adjustments` | 10 · 0.60 MB | unchanged | only on Adjustment Created |
| `/dkp` | 5 · 0.49 MB | unchanged | unchanged — already cheap |
| `/auctions/active` | 656 · 0.11 MB | unchanged | **keep** — already the right shape |

**Total ≈ 46 MB/day.** Tier 0 alone takes it to **~19 MB/day**. Tiers 1+2 take
it to roughly **1.5 MB/day**, and reduce request count too.

⚠ Note `/auctions/active`: **656 calls for 0.11 MB.** That is the whole guild's
live bidding panel, served through one shared bot-side cache. It is already the
shape we are asking the rest of the API to be, and we are not asking him to
change it.

### We did our own homework first, and should say so

Between 2026-08-27 and 2026-08-31 we cut our own traffic from **116 MB/day to
46 MB/day** — a 60% reduction — with an idle backoff, a last-page fast path and
a cold-start jump, before asking him for anything. The remaining cost is not
carelessness on our side; it is the absence of a way to ask "what changed".
That is the sentence that makes this a collaboration rather than a complaint.

## How it settles the auction need specifically

Today the loot flow is split: live auctions come from `/auctions/active` (cheap,
correct), but *settled* ones — winner, price, which feed the bid history and the
inferred wishlist — only arrive by pulling the full `/auctions` list, our single
most expensive call at ~680 KB. With an id on `Auction Closed` we fetch exactly
the auction that closed, when it closes. **The 665 KB list read disappears
entirely**, and settled results land in seconds instead of within a sync window.

## The bid-detail case, added 2026-08-30

The strongest concrete example of Tier 2, and the newest one.

The auctions LIST carries only WINNING bids — measured at 1.08 bids/auction,
with 92% of auctions showing no losing bid at all. That made "recent misses"
structurally blind: a member's losing bid was never mirrored, and ties showed a
blank runner-up. The only fix is `/auctions/{id}/bids`, one call per auction.

We now make that call **once per auction, ever** (`bids_synced_at` — a closed
bid list is immutable), newest-first, capped at 10 per pass. Steady state is
~15–25 small calls on a raid night, plus a ~5,800-auction historical backlog
draining as a trickle behind normal passes.

**With an id on `Auction Closed` / `Bid Update` / `Bid Delete`, that becomes
exactly one call at the moment it matters** — and the backlog stops being
something we have to drain politely over weeks. It is the clearest case where
we are being forced to choose between "correct" and "cheap", and the id removes
the choice.

## Open

| Item | State |
|---|---|
| **Not sent** | Artifact written; needs Hitya to send it. ⚠ The artifact still carries the STALE 2026-08-27 numbers — refresh it from this doc before sending |
| **`EntityType` may be unnecessary** | If `Action` → type is one-to-one upstream, the id alone suffices. Stated as optional in the ask so it can't become a reason to decline |
| **Tier 0 assumes `?count=` can sort newest-first** | Our own probe proved `/audits` page 1 is OLDEST-first, so a `count` that returns the oldest N would be useless. Ask for newest-first explicitly rather than assuming `count` implies it |
| **Assumes `AuditId` is monotonic per client** | Consistent with everything observed (ids are global across OpenDKP clients — page 1 held 1,669,729–1,968,002 against our watermark 4,635,602), but worth confirming with him rather than relying on it |
