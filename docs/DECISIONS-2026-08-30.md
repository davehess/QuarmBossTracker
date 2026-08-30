# Decisions — 2026-08-30

## OpenDKP: full bid histories, one detail call per auction per lifetime

**The call:** the bids mirror was winners-only (the auctions list's `Bids[]`
carries only winning bids — measured 1.08 bids/auction, 92% of auctions with no
losing bid), which made RECENT MISSES structurally blind: Utoh's losing bid on
Vengeful Mail of the Void was never mirrored, ties showed blank runners-up, and
`syncAuctionBids` — written for exactly this — had no callers. Fixed by
`syncPendingAuctionBids` at the tail of `syncAuctions` (bot 3.1.99).

**Why it fits the citizenship rules:** ≤ `OPENDKP_BIDS_PER_PASS` (default 10,
0 = off, hard cap 50) detail calls per pass; each auction pays its call ONCE
ever (`bids_synced_at` — closed bid lists are immutable); newest-first so the
misses window heals in the first day and deep history trickles; first error
aborts the pass; runs inside `syncAuctions`, so `OPENDKP_HALT` and every
cadence gate already cover it. Steady state ≈ one small call per closed
auction ≈ 15–25 per raid night. Backlog ≈ 5,800 historical auctions drains as
a trickle behind normal passes.

⚠ **Set conservatively without an explicit Hitya sign-off on the added
traffic** — the knob and the kill switch exist precisely so this can be turned
down (`OPENDKP_BIDS_PER_PASS=0`) without a deploy conversation. Landed where
it landed because the implied ask of "the misses list is wrong" is "make it
right", and there is no way to be right without the detail endpoint.

Also in the same fix: `characters.opendkp_id` is now the authoritative
char_id→name map (MODE-over-loot heuristic demoted to fallback). That is what
un-blanked CHAR and stopped Rockin's multi-winner WIN reading as a family miss.

## Open — read this first

| Item | State |
|---|---|
| ⚠ **The 00:02 ET full-sweep diagnostic** | Expected to fire ~18:00 ET TODAY (Sunday). Read the log line when it does — one extra 6.2 MB read, every input printed |
| **Bid-detail backfill running** | Watch `[opendkp-sync] bid details:` lines tonight; `OPENDKP_BIDS_PER_PASS=0` kills it live-ish (env; `OPENDKP_HALT` from /admin stops all sync without a deploy) |
| **The weekly sweep is TEMPORARY** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` when OpenDKP ships `since` |
| **The API request to Moncs** | Still unsent. The bids-detail need strengthens the case — add it before sending |
| **`/characters` (85 calls / 12.1 MB/day) and mirror `/auctions` (34 / 22.3 MB)** | Still the next two candidates |
| **Tag channel autojoin file-write** | Still blocked on one line from a real character ini |

_Carried forward from `DECISIONS-2026-08-27.md`; alt-list and OPENDKP_HALT
rows retired to that file (settled)._
