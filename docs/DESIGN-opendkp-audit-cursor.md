# API proposal to OpenDKP: an incremental audit feed

**Status: designed 2026-08-27, not yet sent.** Supersedes the earlier
"`?since` on the list endpoints" ask (`opendkp-api-request` artifact), which was
right in spirit and aimed at too many endpoints.

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

## The ask — two fields, one endpoint

1. **`?since=<AuditId>`** on `/clients/{client}/audits` — rows above that id,
   oldest first. An indexed range scan on a table he already writes to.
2. **The affected row's id** on each audit entry (plus an `EntityType` if the
   `Action` string isn't reliably one-to-one with a type).

**No new endpoints.** `/auctions/{id}`, `/raids/{id}` and the character reads
already exist and we already call them (`utils/opendkp.js` — `getAuction`,
`getRaid`). This makes one existing endpoint answerable incrementally; it adds
no resources, no webhooks, no schema redesign, and it's additive — a caller that
omits `since` sees exactly what it sees today.

**If only one is feasible, take `?since=`.** It's the larger win alone, and we
can fall back to timestamp-scoped list reads for the rest.

## Why it's the cheap version for him

- Reuses the existing write path — a column on a row he already writes.
- Replaces a **table scan with a range scan**: today `/audits` re-serialises
  48,055 rows across 17 pages so we can discover a handful of new ones.
- Scales with **activity, not client count**: 163 events on a busy day is 163
  events whether one member is online or forty.

## The numbers that make the case

**The whole guild generates 63 audit events a day** (three-week average; 163 on
the busiest day, 15 days with activity). We download **116 MB/day** to find them.

| endpoint | today / 24h | after |
|---|---|---|
| `/auctions` | 33 · 20.6 MB | gone — `/auctions/{id}` on the few that changed |
| `/audits` | 168 · 55.5 MB | becomes the delta poll, a few hundred bytes |
| `/characters` | 79 · 10.8 MB | gone — only on Character events |
| `/raids` + `/raids/{id}` | 330 · 3.3 MB | list poll gone; detail only on Raid events |
| `/adjustments` | 18 · 1.0 MB | gone — only on Adjustment Created |
| `/auctions/active` | 702 · 96 KB | keep — already the right shape |

**~116 MB/day → ~1.5 MB/day, and fewer requests too** (~1,600 vs ~2,075).
⚠ Unlike the previous ask, this is cheaper on **both** axes API Gateway bills —
requests *and* transfer — rather than trading one for the other. That was the
weak point of the "more calls, 2,300× less data" framing.

## How it settles the auction need specifically

Today the loot flow is split: live auctions come from `/auctions/active` (cheap,
correct), but *settled* ones — winner, price, which feed the bid history and the
inferred wishlist — only arrive by pulling the full `/auctions` list, our single
most expensive call at ~680 KB. With an id on `Auction Closed` we fetch exactly
the auction that closed, when it closes. **The 665 KB list read disappears
entirely**, and settled results land in seconds instead of within a sync window.

## Open

| Item | State |
|---|---|
| **Not sent** | Artifact written; needs Hitya to send it |
| **`EntityType` may be unnecessary** | If `Action` → type is one-to-one upstream, the id alone suffices. Stated as optional in the ask so it can't become a reason to decline |
| **Assumes `AuditId` is monotonic per client** | Consistent with everything observed (ids are global across OpenDKP clients — page 1 held 1,669,729–1,968,002 against our watermark 4,635,602), but worth confirming with him rather than relying on it |
