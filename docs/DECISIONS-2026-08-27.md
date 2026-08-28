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

It first became **6pm ET on Sun/Wed/Thu** — two hours ahead of the pull, clear
of the 19:30 deploy freeze, three times a week instead of seven. An hour later
Hitya cut it again:

> "let's make the full audit once per week then until we have the new version
> that has the since tag."

**So it is Sunday 6pm ET only — one full download a week** (bot 3.1.85), ahead of
the first pull of the raid week.

That is deliberately slacker than the healing pass wants: a gap can now sit for
seven days. **It is temporary, and it is tied to the API request.** If OpenDKP
gains a `since` / `afterId` parameter, a full pull stops costing anything and
this goes back to being frequent — or stops being a separate mode at all. Until
then we are buying his bandwidth with our staleness, which is the right way
round: the rows we would be healing are rows his API has no cheap way to hand us.

Tunable without a deploy, and the days are a **list** on purpose:
`OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` restores the three raid nights, which is the
first thing to try if audit rows ever go missing.
`OPENDKP_LIST_FULL_SWEEP_HOUR_ET` (default 18) moves the hour.

⚠ **The safety net has to move with the schedule.** `OPENDKP_LIST_FULL_SWEEP_MAX_HOURS`
was 96 when the cadence was three-a-week. Left there it would have fired every
fourth day and quietly reinstated the cadence we had just removed — **a net
tighter than the schedule *becomes* the schedule.** It is now **240** (10 days),
above the 168h gap one weekly anchor can produce. A test asserts that
*relationship* rather than the number, so the next change to the days cannot
reintroduce it.

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
KB) + ONE 6.2 MB sweep a week + 2 calls per deploy — against 381 calls / 140 MB
measured over the preceding 24h.**

## Why this matters for the API request to Moncs

It changes what we are asking for. The ask is no longer "let us keep polling" —
it is:

- we take **one full pull a week**, on Sunday ahead of the raid week, and
- **deltas in between** (a single last-page read per 30-minute pass),
- so a `since`/time-window parameter on the list endpoints would let even those
  one become nothing — and would let us go back to reading *often*, which is
  what we actually want.

That is a materially more sympathetic request than the one we could have made
yesterday, and it is true before we send it rather than after.

## ⚠ UNEXPLAINED: one full sweep fired at ET midnight, and the model says it shouldn't have

The morning after 3.1.85 shipped, `/audits` for the whole night was **20 calls /
6.10 MB**, against 381 calls / 140 MB the day before. Per-minute:

| minute (UTC) | calls | payload | |
|---|---|---|---|
| 03:03 | 2 | 403 KB | boot — cold-start jump, as designed |
| 03:32 | 1 | 7.3 KB | fast path |
| **04:02** | **17** | **6.2 MB** | **`audits_full_sweep: true` — should not have happened** |
| 04:32 | 1 | 7.3 KB | fast path |
| 09:02 | 1 | 7.3 KB | fast path |

04:02 UTC is **00:02 ET** — the first pass after ET midnight. Both `audits` and
`adjustments` swept on the same pass.

**What was ruled out, with evidence rather than reasoning:**
- **Not a restart.** Railway shows one deployment and no new container; the logs
  run continuously across the window (agent uploads 03:38–03:52, the midnight
  chain at 04:00:10). So the process was warm and its marker was the one adopted
  at boot.
- **Not another code path.** `full_sweep` in the result can only come from
  `_dueForFullSweep` — grep confirms one assignment, one call site.
- **Not the environment.** Railway has no `OPENDKP_LIST_*` var and no `TZ`.
- **Not the version.** `audits_pages: 2` at boot is a signature only 3.1.84+ can
  produce (the jump), and `full_sweep: false` at boot only 3.1.84+ (the adopt).

**And the shipped decision function, replayed offline against those exact
timestamps, returns `false` at 04:02 — under 3.1.85's Sunday anchor AND under
3.1.84's Sun/Wed/Thu anchors.** Worked by hand both ways too: for `last < anchor`
to be true, the anchor must move between 03:02 and 04:02, and a 6pm anchor
cannot. So the model and production genuinely disagree and the cause is not yet
known.

**What was done about it: an instrument, not a guess.** A full sweep now logs
every input the decision took — prior marker, anchor, day list, hour, max-age,
now. The next occurrence is one log line to diagnose instead of an evening of
inference. **Do not remove that line until a sweep has been seen firing on the
right day for the right reason.**

⚠ **Cost of the unknown is bounded and small** — one extra 6.2 MB read. Weigh
that against shipping a speculative fix to a mechanism that is otherwise
measurably working; the volume is already down ~95%.

## A real bug the investigation did turn up: `Number('') === 0`

`_parseSweepDays` split the env var, then `Number()`'d each segment. An unset
var produced `['']` → `Number('') === 0` → a legitimate-looking **Sunday**, so
the documented fallback was unreachable. It agreed with the default by luck,
which is exactly why it would have gone unnoticed until the default changed —
and **the test passed for the wrong reason**, asserting `toEqual([0])` where both
paths give `[0]`. Empty segments are now dropped before `Number()`, and the test
asserts the fallback by **identity** (`toBe(_SWEEP_ANCHOR_DAYS_DEFAULT)`), which
distinguishes the two paths.

## ⚠ Uilnayar is NOT Hitya — the attribution rule was wrong for three weeks

Hitya, seeing the rule quoted back in `GEMINI-SPARK-HELPER.md`:

> "this helper file still references me as Uilnayar. they are not me, different
> person"

From 2026-08-09 until now, `CLAUDE.md` and the Gemini helper both listed
`Uilnayar` as one of Hitya's alts, and instructed every agent reading them to
re-credit anything under that name to Hitya. **Uilnayar is a separate member.**

Corrected in both files. What the fix has to preserve, in both directions:

- **Existing `(Uilnayar <date>)` credits in code comments are CORRECT** and must
  not be rewritten. They predate or survived the bad rule, and they name the
  right person. The death-awareness design, the group-death watcher, the clock-
  correction clerics roster and the trigger scanner all carry real Uilnayar
  attributions.
- **Attributions TO Hitya dated 2026-08-09 → 2026-08-28 are now suspect** —
  there are 234 of them and they cannot be audited from here. Most are genuinely
  Hitya. The rule now says to treat that window as uncertain and prefer the
  original report where one can be found, rather than trusting the comment.
- Uilnayar remains a real character name in fixtures, golden logs and the
  `{s}`-capture worked example. Attribution text only — never a blanket rename.

**The lesson is about the rule's shape, not this one name.** A rule that
collapses many names into one person fails in the direction that *erases other
people's contributions*, and it fails silently: the wrong attribution reads
exactly like a right one, and the only way it ever gets caught is a human
noticing their own name. The rule already warned "a name being in a code comment
today is not evidence" — it now also warns that a name being on the alt list is
not evidence either, because this one sat there wrongly for nearly three weeks.

---

## Open — read this first

| Item | State |
|---|---|
| ⚠ **One unexplained full sweep at 00:02 ET on 2026-08-27** | Ruled out restart / env / version / another code path; the shipped decision replays as `false` for that instant. A diagnostic log line now prints every input on any sweep — **read it the next time one fires** (expected Sunday 18:00 ET). Bounded cost: one extra 6.2 MB read. See the section above |
| **Otherwise 3.1.85 is behaving** | Verified: boot 2 calls / 403 KB, routine passes 1 call / 7.3 KB. Overnight `/audits` total 20 calls / 6.10 MB, against 381 / 140 MB the day before |
| **The weekly sweep is a TEMPORARY setting** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` the moment OpenDKP ships a `since` parameter — and it is also the first thing to try if audit rows go missing |
| ⚠ **The alt list needs a human pass** | `Uilnayar` was wrongly on it for 3 weeks. The remaining names (Canopy, Rockin, vj, Hopeya, Utoh, Melting) have NOT been re-verified with Hitya. `Dant` is also evidently distinct — they @-mention Hitya in Discord — but is not in the `feedback` table, so the rule as written would still collapse them into Hitya |
| **The API request to Moncs** | Not sent. Framed as "one full pull a week + deltas in between" — artifact updated |
| **`OPENDKP_HALT` is OFF** (unblocked 2026-08-26) | Stats flowing. The kill switch still works from `/admin` without a deploy if he reports trouble again |
| **`/characters` (85 calls / 12.1 MB per day) and the mirror `/auctions` (34 / 22.3 MB)** | Untouched. Next two candidates once audits is confirmed settled |
| **Tag channel autojoin file-write** | Still blocked on one line from a real character ini — see `STATUS.md` |
