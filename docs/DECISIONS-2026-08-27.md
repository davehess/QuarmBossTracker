# Decisions — 2026-08-27

Written the same session, per CLAUDE.md. Everything here is Hitya unless it
came through the `feedback` table.

---

## The full download runs on the raid calendar, not on a rolling timer

> "we don't need a full download that often, just before a raid. three times a
> week."

The OpenDKP list sync (`/audits`, `/adjustments`) has two modes. The cheap one
reads the last page and stops. The expensive one — the **full sweep** — re-offers
every row so a gap below our watermark heals: 17 pages, 6.2 MB, on audits.

The sweep used to run on a 24-hour rolling timer, which meant it fired at
whatever time of day the bot process last happened to boot. On 2026-08-26 that
was mid-raid.

**It now anchors to 6pm ET on Sun/Wed/Thu** — two hours ahead of the pull, clear
of the 19:30 deploy freeze, and three times a week instead of seven. DKP is a
thing raids change, so the healing pass belongs immediately before one. Worst
case a gap waits from Thursday 6pm to Sunday 6pm (74h), which is fine for a pass
whose entire job is closing gaps that should not exist in the first place.

Tunable without a deploy: `OPENDKP_LIST_FULL_SWEEP_HOUR_ET` (default 18) and
`OPENDKP_LIST_FULL_SWEEP_MAX_HOURS` (default 96 — a safety net, not a schedule;
if it ever fires, the anchor math is wrong).

## …and the bigger cost turned out to be the redeploys

Going in, the assumption was that the periodic sweep was what remained of the
audits bill. The per-minute data says otherwise. From `opendkp_call_stats`, the
night this shipped:

| minute (UTC) | calls | payload |
|---|---|---|
| 01:13 | 18 | 6.2 MB |
| 01:15 | 17 | 6.2 MB |
| 01:18 | 17 | 6.2 MB |
| 01:22 | 17 | 6.2 MB |
| 01:52 | **1** | **5.8 KB** |

Those four are not a 30-minute cadence — they are **three deploys inside ten
minutes** (3.1.82 at 01:16, 3.1.83 at 01:20), each paying a 17-page walk. 01:52
is the steady state on the shipped build: one call, mid-raid, with new rows
collected. The fast path works. The problem was that a fresh process cannot
*use* it, because the page-count hint it needs is process-local and a boot
starts with none — so the walk re-learned from all 17 pages what page 1 had
already told it.

Two fixes, both shipped in bot **3.1.84**:

1. **Cold-start jump.** Page 1 proves the ordering is oldest-first (its ids sit
   2.7 million below our watermark). Nothing between there and the end can be
   new, so jump straight to the last page. **Two calls instead of seventeen.**
   The one case it can be wrong about — the last page coming back *entirely*
   new, meaning the boundary sits on an earlier page after a rollover — hands
   the saved calls back and walks the middle. A silent gap is the worse outcome.
2. **A cold process adopts the current anchor instead of sweeping.** `main`
   takes 12–42 pushes a day; "no marker → sweep" was a full download per
   deploy. The next real anchor still fires, at most 74h out.

**Expected per-day audits volume after this: ~48 fast-path calls (a few hundred
KB) + 3 sweeps a week + 2 calls per deploy — against 381 calls / 140 MB
measured over the preceding 24h.**

## Why this matters for the API request to Moncs

It changes what we are asking for. The ask is no longer "let us keep polling" —
it is:

- we take **three full pulls a week**, anchored to raid nights, and
- **deltas in between** (a single last-page read per 30-minute pass),
- so a `since`/time-window parameter on the list endpoints would let even those
  three become nothing.

That is a materially more sympathetic request than the one we could have made
yesterday, and it is true before we send it rather than after.

---

## Open — read this first

| Item | State |
|---|---|
| **Verify 3.1.84 on the live counter** | Expect `/clients/{client}/audits` at ~1 call per 30-min pass, 2 per deploy, and a 17-page walk only at 18:00 ET Sun/Wed/Thu. `wolfpack.quest/opendkp`, or the per-minute query in this file |
| **The API request to Moncs** | Not sent. Reframe around "3 full pulls a week + deltas", per above |
| **`OPENDKP_HALT` is OFF** (unblocked 2026-08-26) | Stats flowing. The kill switch still works from `/admin` without a deploy if he reports trouble again |
| **`/characters` (85 calls / 12.1 MB per day) and the mirror `/auctions` (34 / 22.3 MB)** | Untouched. Next two candidates once audits is confirmed settled |
| **Tag channel autojoin file-write** | Still blocked on one line from a real character ini — see `STATUS.md` |
