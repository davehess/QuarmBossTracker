# Loot, DKP & wishlists

Loot drops, OpenDKP, bids, wishlists, soft reserve. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/6 — Loot bidding (2026-08-09)
*2026-08-09 · DECISIONS-2026-08-07.md · Capped display query must not define a set*

**A capped DISPLAY query must never double as a SET.** `bid-history` seeded the
"already won" set from `wins` — `opendkp_loot … order=fetched_at.desc&limit=100`.
The the guild lead/a member/a member family has 187 awards, so 87 read as unwon and came back
as "bid on but not yet won" and RECENT MISSES. The three items reported sat at
rows 101, 120 and 184. Worse, `fetched_at` is the MIRROR SYNC time, so *which*
100 survived would have reshuffled on every weekly sync. Won-set is now its own
uncapped `item_id`-only sweep; `wins` orders by `raid_id.desc` (real award order).
→ bot 3.1.33, pinned by `test/loot-won-set.test.js`.

**Nobody types their own main and alts.** OpenDKP already knows the family, so
the panel adopts it on sign-in — wholesale when empty, additive when not (a
hand-typed name is never removed, the chosen main is never demoted). `⟲ from
OpenDKP` is the explicit replace path.

**Loot history is hidden by default and re-hides on every load.** The dashboard
gets screen-shared during raids and a visible wishlist is a bidding tell.

**Dismissals are local-only.** The wishlist is INFERRED from OpenDKP bid history —
there is nothing upstream to delete — so ✕ writes `logsync.lootdismiss.json` and
uploads nothing. Always reversible via "restore all".

**The expansion filter opens on the current expansion**, derived from the newest
award rather than hard-coded, so it advances by itself when PoP unlocks. Falls
back to "all" rather than showing an empty panel.

## 2026-08-14/11 — A roll call is not a pipe-separated list
*2026-08-14 · DECISIONS-2026-08-14.md · Roll call parsing fix for roll sessions*

**The report (the guild lead).** *"These rolls didn't get consolidated to loot in the
website but did on here"* — the /rolls page showing eleven sessions for the
night, every one **unlabeled roll**, LOOTED BY empty, next to a Command Center
screenshot of the same four ranges.

**The cause was one line, and it had been there since #91:**

```js
if (!line || line.indexOf('|') === -1) return;   // the convention always separates with |
```

The convention did not always separate with `|`. a member's call was:

```
[G] [Kestrelle]: Black Tear 111 , Platinum Tear 222 , Poison Tear 333, Runed Tear 444
```

**Why one missing label emptied two columns.** `attributeLoot()` opens with
`if (!session.item) return []`. So the item name is not just the label — it is
the JOIN KEY to `looted_items`. No name, no loot attribution, no LOOTED BY. The
loot itself had been captured perfectly all along: all four Tears were in
`looted_items`, and two of them went to someone **other** than the roll winner
(333 a member → looted by a member, 444 a member → looted by a member), which is
precisely the case the column exists to show. The data was there; the join
wasn't.

**What the chat actually looks like.** Reading 45 days of `chat_messages`
instead of trusting the convention, three shapes matter and only the first
worked:

| | example | before |
|---|---|---|
| A pipe | `Choker of the Wretched 111 \| Crown of Narandi 222` | worked |
| B comma | `Black Tear 111 , Platinum Tear 222` | dropped |
| C tier list | `Helmet of Shadow 311 pick, 322 upgrade, 333 alt` | dropped |
| D bare | `Atramentous Shield 333` | dropped |

D is the most common of all, and C is what Tanidian/Rikel type every raid. So
the pipe rule was matching the *documented* convention rather than the *used*
one, and had been quietly dropping most calls for a month.

**Where it landed (agent 3.5.84).** `parseRollItemLine` walks the NUMBERS
instead of splitting on a separator: the text since the previous number names
that number's item. Shape C falls out for free — the text between 311 and 322
is `pick,`, which is a tier, so 322 carries the previous item forward.

**The real work was the negatives, and fixtures did not find them.** A pipe is
nearly proof of intent; a comma is not, and the parser now reads every chat
line. So I swept it over every captured line within 20 minutes of a live roll
set — the actual blast radius — and it wanted to label four of them:

- `I think we were randoming 100.  Cordove got a 22 I think?`
- `You didn't even bid 100. Doubt!`
- `DI - Guts 100 )`
- `Do a 777 if you want a Shield of the Immaculate`

Each sat minutes from a real 0-100 or 0-777 set, so each would have appeared on
the page as that session's item. They produced four guards — majority-
capitalised significant words, no ALL-CAPS raid shorthand (DI/CH/MT), at least
one ≥4-letter word, and a range must be a bare 3-4 digit number not followed by
a letter or `%`. The same sweep caught two regressions my own fixtures missed,
where a numberless linked drop glued itself onto the next item
(`Golden Ember Powder | Unadorned Plate Boots 444`).

**The lesson is the one the loot fold taught, applied earlier this time:** a
parser is only as good as the corpus you point it at, and the corpus is in the
database, not in your head. Eighteen green tests hid the loot fold's truncation
for a day. Here the tests were written FROM the real lines, and the sweep found
four defects the tests I would otherwise have written never would have.

**Known and accepted:** `Holytomato 111, Emoo 222, Glarez 333, Kaviar 444`
labels player names as items — that roll really was about those four people, so
it is not wrong so much as unusual, and the officer edit button covers it. And
`Do a 777 if you want a Shield of the Immaculate` stays unlabeled: the item is
named after the number, mid-sentence, and every rule that would catch it also
catches real chatter. That exact line is the one cited in the
`roll_set_overrides` migration header as the reason officer edits exist.

**Backfill.** Last night's four Tears were relabelled through
`roll_set_overrides` — additive, reversible with one DELETE, and applied before
loot attribution, so the two pass/re-roll cases now show their real looter.

---

## 2026-08-14/4 — Loot rows really are missing — 758 of them
*2026-08-14 · DECISIONS-2026-08-14.md · Missing loot rows traced and backfilled*

**The question (the guild lead).** Target Info → Loot showed *Silver Band of Secrets*
with no "N× won" pill, but a member had won it. *"Are we missing rows of loot
drops?"*

**Yes, and the boundary is exact.** a member won it at **raid 98561 for 150
DKP** — present in `opendkp_loot`, which syncs automatically and was current
(last fetch 02:22 that night, up to raid 100367). The Loot tab reads
`loot_observations`, which **stops at raid 96805 / 2026-06-04**: **758 awards
across 28 raids**, roughly ten weeks.

**Cause: two tables, one sync.** `opendkp_loot` has an automatic job.
`loot_observations` has none — it is only ever written by the officer command
`/backfillopendkploot`, and someone last ran it on June 4. Note `loot_drops` is
a third table and is **completely empty** (0 rows); nothing reads it for this
surface, but do not mistake it for the source.

**Where it lands.** Immediate: `/backfillopendkploot days:90`, no deploy needed.
Durable: a scheduled fold of new `opendkp_loot` rows into `loot_observations`
reusing the existing NPC resolution (single-NPC-drop = confident, multi =
ambiguous) — task #37, bot, after the raid freeze. Guild lead: *"Yes we need that."*

**The shape to recognise.** A derived table fed only by a manual command looks
identical to a working one right up until someone notices a specific missing
row — the surface degrades silently and partially (older items still show
counts), which is why it survived ten weeks. Same failure family as the
Raid-Helper sync above: **any table whose only writer is a human running a
command needs a staleness alarm or an automatic feeder.**

## 2026-08-14/7 — The post-raid change train — 2026-08-14
*2026-08-14 · DECISIONS-2026-08-14.md · Post-raid change train, loot folds itself in*

Five things shipped once the raid ended, in this order and for this reason.

**1. Bot 3.1.45 — OpenDKP loot folds itself in.** The night's own finding: a
derived table (`loot_observations`) whose only writer was a human command had
been ten weeks stale, and nobody could have known. Shipped first because it was
the explicit ask and because every hour it waits is more availability of the
kind that has no second copy.

**2. Mimic 2.5.0 stable.** Graduated the whole beta line — nine agent versions,
3.5.72 → 3.5.80 — because the two things the guild lead hit live during the raid (the CH
chain picking up a spot-healer, the damage meter doubling people) were both
fixed on beta and both worth the fleet having before Sunday. A meaningful line
takes a minor bump.
- **The graduation was verified byte-exact, not assumed.** After promoting the
  files, `git diff origin/main origin/beta -- apps/mimic packages/wolfpack-logsync`
  returned exactly one line: the version park. That is the check worth repeating
  — a graduation that silently drops a file looks identical to one that doesn't.
- Beta re-parked at **2.5.1**, above the stable. A park at or below would tag
  prereleases that semver-sort *below* the stable and the updater would quietly
  stop offering betas. Discarding beta's history was safe because every beta
  build's commit stays reachable through its release tag (v2.4.1-beta.1 … .11).

**3. Web 1.1.52 — roadmap.** The 2.4.0 entry's headline feature was "the damage
meter now shows the whole raid", which 2.5.0 partly reverses. Leaving that
unqualified would have read as a regression rather than a correction.

**4. Bot 3.1.46 — Raid-Helper staleness alarm.** Same failure family as #1,
caught before it cost anything.

**5. Task #27 held.** See the Open table. Worth stating the general rule: *the
gate on a fleet-wide content change is whether the fleet has the fix, not
whether the fix exists.* The stable was minutes old; nobody had it.

**One process note, recorded because it nearly shipped to the wrong place.** The
RH alarm was committed while checked out on `beta` and pushed with
`git push -u origin main`, which reported "Everything up-to-date" — it pushed
the *local* `main` ref, which had not moved, while the commit sat on beta. The
tell is a push that succeeds with nothing to say. Cherry-picked onto main and
beta reset. Check `git branch --show-current` before committing, not after.

## 2026-08-14/8 — The loot fold read only the first 1000 rows
*2026-08-14 · DECISIONS-2026-08-14.md · Loot fold read only first thousand rows*

Caught by checking, hours after shipping it, whether the thing had actually run.
It had — badly.

**PostgREST caps a response at the server's max-rows setting (1000 on Supabase),
and `limit=50000` in the query string does NOT lift it.** The cap is silent:
1000 rows and a 200.

Both sides of the fold's set-difference were truncated. The dangerous side is
the already-folded set: raids that HAD been folded fell outside the first 1000
rows, looked unfolded, and got re-inserted on the next pass. Two 30-minute
passes ran, leaving **116 duplicate rows** — inflating the very "N× won" counts
the feature exists to fix. The same truncation meant it was walking the OLDEST
pending raids instead of the newest, so only 5 of 28 pending raids had moved.

**Fixed in bot 3.1.47:** `selectAllPaged()` walks with ordered limit/offset until
a short page ends it. Two details that are load-bearing:
- **ordered**, because an unordered offset walk can skip and repeat rows;
- a failed page returns **null, not a short list**. Reading a failure as "the
  table is empty" would mean "nothing is folded yet" and re-fold all history.

The 116 duplicates were deleted, one row kept per award, and the folded range
verified clean.

**Why the tests didn't catch it, which is the part worth keeping.**
`test/opendkp-loot-fold.test.js` shipped with 18 cases and all of them passed
while the thing was truncating in production — because every one tested the
*logic given its inputs* (id reconciliation, dedup keys, wiring) and none tested
*whether the inputs were complete*. `utils/supabase.js` had documented this exact
cap for months, on `upsert()`'s return path. It bites reads identically.

**The general lesson: "did the deploy work?" is a different question from "do
the tests pass", and only the first one would have found this.** A feature whose
whole job is to move rows between tables should be verified by counting rows in
the destination, on the day it ships — not by trusting green CI.

---

## 2026-08-25/4 — The OpenDKP incident — halt, root cause, and the governor (bot 3.1.71–3.1.72)
*2026-08-25 · DECISIONS-2026-08-25.md · OpenDKP traffic incident, halt and governor*

**What happened.** OpenDKP's owner (Moncs) reported high-volume automated
traffic and blocked our bot's IP at his WAF. His API Gateway logs (6h window,
2026-08-25): **1,678 calls to `GET /clients/{client}/auctions`, 1,115 MB**
(~665 KB per response), plus 632 `GET /clients/{client}/dkp` and 416
`GET /clients/{client}/characters`.

**Root cause — NOT the 30-min mirror sync.** The Mimic dashboard's Loot
bidding panel polls every 7s per open dashboard, and the bot's `server-panel`
`auctions`/`my-bids` keys forwarded **every poll upstream, uncached** — with
`my-bids` adding a per-auction `getAuction()` N+1 and a `getCharacters()` per
request. One open dashboard ≈ 37k upstream calls/day. The poll shipped broken
(mis-escaped `WEB_HTML` interval — never armed), was *fixed* in `90024a1f`,
and reached the whole fleet in Mimic v2.0.0 on **2026-07-19**. Correct
escaping is what turned the firehose on.

**Decisions:**
1. **`OPENDKP_HALT=1`** stays until fixes are verified and Moncs unblocks.
   The halt lives at `_get`/`_post` in `utils/opendkp.js` — no wrapper can
   bypass it (bot 3.1.71 + `test/opendkp-halt.test.js`).
2. **The panel reads `GET /clients/{name}/auctions/active`** — OpenDKP's own
   documented "Get Active Auctions" (their Postman doc) — through ONE shared
   bot-side cache: 15s TTL while auctions are live, 120s idle, stale-on-error.
   N dashboards now cost the same as one. `my-bids` reads the same cache's
   inline `Bids[]`; its N+1 and per-request roster fetch are deleted (roster
   cached 1h). Bot 3.1.72, `test/server-panel-auction-cache.test.js`.
3. **`opendkp-auth-config` is halt-gated (503).** The agent's #124 standings
   fetch calls OpenDKP **directly from members' machines** — the one path the
   bot-side halt can't block. It CAN starve it: token refresh depends on this
   config (≤1h config cache + ~1h token life), so a halted bot dries up the
   whole fleet's direct calls within ~2h, no agent update needed.
4. **Outbound governor at the primitives** (bot 3.1.72):
   `OPENDKP_MAX_CALLS_PER_MIN` sliding budget (default 60, 0=off) + global
   cooldown honoring 429 `Retry-After` (default 30s, cap 5min). This is the
   standing guarantee no future caller repeats this, and the ready position
   for the rate limiting Moncs will likely add.
   `test/opendkp-outbound-budget.test.js`.
5. **Audits/adjustments early-break**: the list walk stops at the first page
   with nothing above the watermark, but only after page 1 *proves*
   newest-first ordering (page-1 max id ≥ watermark); the 24h full sweep
   still heals gaps. Steady state: 15 pages/48k rows per pass → 1 page.
6. **Queued for the next agent/Mimic beta** (fleet can't update by raid
   night; bot-side cache already makes these cheap): panel poll 7s→adaptive,
   agent standings cache 60s→5min, back-off when `document.hidden`.

**Numbers for the record** (model in the artifact page shown to Moncs):
before = ~37k upstream calls/day per open dashboard; after = ≤720/day idle
fleet-wide, ~1.5k on a raid night with bidding, bounded by the governor at
60/min worst case.

## 2026-08-26/2 — A public OpenDKP counter, and a kill switch that doesn't need a deploy
*2026-08-26 · DECISIONS-2026-08-26.md · Public OpenDKP counter with quick kill switch*

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

## 2026-08-26/3 — Unblock day: what the 1,486 actually was (bot 3.1.74 / web 1.1.99)
*2026-08-26 · DECISIONS-2026-08-26.md · Unblock day: refused counts were sign-in calls*

Moncs lifted the block, `OPENDKP_HALT` went to 0, and the page immediately read
**1,486 "refused by us" against 4 real calls.** Guild lead: *"stats are flowing but
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

## 2026-08-26/4 — "Why are we auditing so frequently" — the early break was never engaging
*2026-08-26 · DECISIONS-2026-08-26.md · Audit frequency cut; early break never engaged*

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

**The fix shipped now is the guild lead's framing, not mine, and it is better** — it
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


---

## 2026-08-26/5 — Audits: PROVED oldest-first, and the fast path that follows from it
*2026-08-26 · DECISIONS-2026-08-26.md · Audits proven oldest-first; fast path added*

> "8MB in the last hour is still too much on audits"

Right. The idle backoff (3.1.75) halved the frequency but every walk was still
17 calls / 6.2 MB, so a raid window — where backoff correctly pins it to every
pass — puts it straight back to 12 MB/hour.

**The ordering probe answered the open question from production:**

```
audits: page1 ids 1669729..1968002 vs watermark 4627656 — NOT newest-first
```

Page 1 holds the OLDEST audits **by 2.7 million ids**. A forward walk from page
1 can never reach a new row, which the sync result confirms exactly:
`audits_pages: 17, audits_offered: 0` — seventeen calls, zero rows offered,
every single pass. So the 2026-08-25 early break could never have fired, and my
newest-first assumption (inferred from the auctions endpoint's "page 1 = most
recent" note) was simply wrong for this endpoint.

**Fix: new rows land at the END, so go straight to the LAST page.** If nothing
there is above the watermark, done in ONE call instead of seventeen —
**6.2 MB → ~365 KB per check, and it works during raids**, which the backoff
deliberately cannot.

- `TotalPages` is learned from any response and cached per table. A page fills
  roughly every couple of months at ~37 audits/day, so the hint is stable and a
  stale one self-corrects on the next response.
- If the last page DOES hold something new, it falls through to the full walk —
  correctness over cheapness. At 37 audits/day that is once or twice a day
  instead of 48 times.
- **A full sweep still walks everything** (the 24h heal is untouched).
- **An unknown payload shape does NOT read as "nothing new."** Silently treating
  an unrecognised response as empty would stop the sync dead while reporting
  success — the worst available failure — so it throws and falls through to the
  walk, which reports the shape properly.
- The payload-shape extraction is now ONE helper shared by both paths.
  Duplicating that list is how one of them silently starts seeing nothing.

Two of my own errors caught by the suite while building this, both worth the
telling: the page-count capture was initially placed at the END of the loop
body, *after* the early break — so it never ran and the fast path had no hint to
work from; and the fall-through test's fixture returned the SAME rows on every
page, which double-counted the fresh row and proved nothing. Both now commented
in place.

Tests: 6 more in `test/opendkp-list-endpoint-writes.test.js` (22 total),
mutation-checked — claiming done on an unknown shape, running during a full
sweep, and ignoring a grown page count each kill a test.

---

## 2026-08-26/6 — The fast path was fast only while idle (bot 3.1.82) — MID-RAID FIX
*2026-08-26 · DECISIONS-2026-08-26.md · Fast path only worked idle; mid-raid fix*

> "clients/{client}/audits is still WAAAAY too often or high. we're mid raid now"

The per-minute data named it immediately, and the shape is the whole story:

```
22:43    1 call     438 bytes   <- fast path working
23:13    1 call     438 bytes   <- fast path working
23:43   18 calls    6.2 MB      <- raid starts
00:13   18 calls    6.2 MB
00:43   18 calls    6.2 MB
```

**3.1.80's fast path fell through to the full 17-page walk whenever the last
page held anything new — and during a raid EVERY pass does**, because loot
awards and ticks generate audit entries. So it was fast exactly while nothing
was happening and reverted to 6.2 MB a pass exactly when raiding, which is the
worst possible split and precisely the hours that cost OpenDKP money.

**The fall-through was lazy, not necessary.** Oldest-first means new rows
APPEND to the end, so the last page — which we have already fetched — *already
contains them*. There is nothing to go back for. It now collects the fresh rows
from that page and writes them: **one call, ~438 bytes, raid or not.**

The one case that genuinely needs the walk is a page ROLLOVER, which shows up
as *every* row on the last page being fresh. At ~37 audits/day against a
~2,800-row page that is a once-every-couple-of-months event, and the code
detects it precisely (`fresh.length === rows.length`) rather than guessing.

Expected: audits drops from 109 MB/24h to well under 1 MB, during raids
included.

Tests: 23 in `test/opendkp-list-endpoint-writes.test.js`, mutation-checked —
reverting the fall-through, dropping the write, and treating a full page of
fresh rows as done each kill a test. The last of those matters most: it would
silently LOSE audit rows on a rollover, which is the kind of bug that shows up
as a missing loot correction weeks later.

---

## 2026-08-26/7 — "Is there an alternative in the APIs?" — checked the doc, mixed answer
*2026-08-26 · DECISIONS-2026-08-26.md · OpenDKP API has no incremental audit option*

**Audits: NO.** OpenDKP's own Postman collection documents exactly one
parameter on `/clients/{client}/audits` — `page`. No `since`, no `count`, no
sort. `GET /audits/{id}` exists but ids are global across all OpenDKP clients
(page 1 held 1,669,729–1,968,002 against our watermark of 4,627,656), so
probing forward from a watermark would mostly 404. **So there is no way to ask
for less; the only lever is asking for the RIGHT page**, which is what the
last-page fast path does. That fix stands as the ceiling for this endpoint.

**Raids: YES, and we were not using it.** `/clients/{client}/raids?count=10` is
documented. We were pulling all 412 raids every 30 minutes at ~90 KB a call to
re-learn rows that had not moved.

Shipped (3.1.83): the routine pass asks for the newest `OPENDKP_RAIDS_COUNT`
(default 25); an **uncounted full fetch still runs every
`OPENDKP_RAIDS_FULL_HOURS` (default 24)** so an upstream EDIT to an older raid
cannot hide forever, with the #110 audit reconcile as a second net. The result
reports `scope: 'newest 25' | 'full'` so the logs are not ambiguous about why a
count changed.

### A vacuous test of mine, caught by mutation-checking

The first version of the "still takes the FULL list periodically" test asserted
only that the strings `_raidsFullEveryHours` and `const fullDue` appeared in the
source. A mutation forcing `useCount = true` — which **deletes the periodic heal
entirely** — left it green. A test that cannot fail is worse than no test,
because it manufactures confidence.

Fixed by extracting the decision into a pure `_raidsFetchMode(now, lastFullAt,
count, fullEveryHours)` and testing the BEHAVIOUR: routine pass uses the count,
elapsed interval forces full, a cold process forces full, and a nonsense count
(0, negative, fractional, null, 'ten', NaN) falls back to full rather than
sending `?count=0` and asking for nothing. The same mutation now kills three
tests.

Still untouched and worth a look after the raid: `/characters` (73 calls,
9.9 MB — roster changes on officer action, not mid-raid) and the mirror's
`/auctions` full-history pull (30 calls, 18.6 MB).

## 2026-08-27/1 — The full download runs on the raid calendar, not on a rolling timer
*2026-08-27 · DECISIONS-2026-08-27.md · Full OpenDKP download follows raid calendar*

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
The guild lead cut it again:

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

## 2026-08-27/2 — …and the bigger cost turned out to be the redeploys
*2026-08-27 · DECISIONS-2026-08-27.md · Redeploys were the bigger OpenDKP cost*

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

## 2026-08-27/3 — Why this matters for the API request to Moncs
*2026-08-27 · DECISIONS-2026-08-27.md · Revised ask to OpenDKP owner: weekly pull*

It changes what we are asking for. The ask is no longer "let us keep polling" —
it is:

- we take **one full pull a week**, on Sunday ahead of the raid week, and
- **deltas in between** (a single last-page read per 30-minute pass),
- so a `since`/time-window parameter on the list endpoints would let even those
  one become nothing — and would let us go back to reading *often*, which is
  what we actually want.

That is a materially more sympathetic request than the one we could have made
yesterday, and it is true before we send it rather than after.

## 2026-08-27/4 — ⚠ UNEXPLAINED: one full sweep fired at ET midnight, and the model says it shouldn't have
*2026-08-27 · DECISIONS-2026-08-27.md · Unexplained midnight full sweep investigated*

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

## 2026-08-27/5 — A real bug the investigation did turn up: `Number('') === 0`
*2026-08-27 · DECISIONS-2026-08-27.md · Empty env var parsed as Sunday bug*

`_parseSweepDays` split the env var, then `Number()`'d each segment. An unset
var produced `['']` → `Number('') === 0` → a legitimate-looking **Sunday**, so
the documented fallback was unreachable. It agreed with the default by luck,
which is exactly why it would have gone unnoticed until the default changed —
and **the test passed for the wrong reason**, asserting `toEqual([0])` where both
paths give `[0]`. Empty segments are now dropped before `Number()`, and the test
asserts the fallback by **identity** (`toBe(_SWEEP_ANCHOR_DAYS_DEFAULT)`), which
distinguishes the two paths.

## 2026-08-30/1 — OpenDKP: full bid histories, one detail call per auction per lifetime
*2026-08-30 · DECISIONS-2026-08-30.md · Fetch full bid histories once per auction*

**The call:** the bids mirror was winners-only (the auctions list's `Bids[]`
carries only winning bids — measured 1.08 bids/auction, 92% of auctions with no
losing bid), which made RECENT MISSES structurally blind: a member's losing bid on
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

⚠ **Set conservatively without an explicit the guild lead sign-off on the added
traffic** — the knob and the kill switch exist precisely so this can be turned
down (`OPENDKP_BIDS_PER_PASS=0`) without a deploy conversation. Landed where
it landed because the implied ask of "the misses list is wrong" is "make it
right", and there is no way to be right without the detail endpoint.

Also in the same fix: `characters.opendkp_id` is now the authoritative
char_id→name map (MODE-over-loot heuristic demoted to fallback). That is what
un-blanked CHAR and stopped a member's multi-winner WIN reading as a family miss.

## §301 — Roll ties: a top tie is shown and settled by deathroll (agent 3.7.167, Mimic beta, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Roll ties highlighted and settled by deathroll*

- **The ask (the guild lead, 2026-10-14):** from a Rolls card reading `611 (Carved Bone Ring) — <name> 507 · 7 rolls open` with two characters
  on 507: *"if two toons roll the same number on a roll it should trigger a deathroll and highlight the tie"*.
- **The rule:** only the TOP tie triggers anything — two or more distinct characters sharing the highest FIRST roll (a character rolling twice is
  already a re-roll and never counts). A lower tie is a dim `=` on the row. With a linked quantity (3), a top group no bigger than the quantity
  is not contested, so it is not a tie. One helper, `rollSetTies` in the agent, decides it; both Rolls surfaces draw what the snapshot carries.
- **The deathroll starts at the TIED number, not the original range.** Both deathroll detectors (the agent's and `utils/deathroll.js`) chain a
  roll only when its range is the previous result, and the tied number IS the previous result: `/random 507` chains straight onto the 0-611
  roll. The first character to have rolled the tied number starts. With three or more tied, the first 0 puts one out and the rest start again
  from the tied number until no more than the quantity remain.
- **Nothing is sent to the game.** The Command Center 📋 copies one `/rs` line (plain ASCII, 250 characters at most). The agent reads the
  follow-up /random lines the same way the detector does, so the tie resolves to the deathroll's winner without any bot change; a two-roll game
  (which the detector's three-roll minimum would not record) still resolves the card. The tie's game is drawn on the tie, not again as "Deathroll 611".
- **Not built:** a spoken "Roll tie" callout — the agent speaks no roll events, so there is no path to add one to.
- **Where it landed:** `rollSetTies` / `_rollTieResolve` in `rollSetsSnapshot`; `_wpRollWhoHtml` / `_wpRollTiePrompt` / `_wpRollRowMark` in
  `dashboard.html`; `rollTie*` in `apps/mimic/command.html`; `test/roll-tie.test.js`.

## §10 — Deathrolls (2026-09-23)
*2026-09-23 · DECISIONS-2026-09-21.md · Deathrolls tracked as one expandable game*

The guild lead, on a Rolls card showing one game as eleven "1 roller · open"
sets: *"These are called Deathrolls. First one to roll a zero loses - we should
track these for fun."*

**The calls.** Display option **A** (one expandable line per game in the Rolls
card and the Command Center), not B (a separate Deathrolls card). And *"yes post
it to Wlfpck-general"* — `DEATHROLL_CHANNEL_ID`, set on Railway.

**Where it landed.** Detection is BOT-side over `roll_sets`, which every Mimic
already uploads, so recording needed no fleet update (bot 3.1.142,
`utils/deathroll.js`). Each game: one `deathroll` fun_event, one post. The
shape that identifies a game — each range is the last result, a different
player each step, ≤2 min apart, ≥3 rolls, ends on 0 — is one loot rolls never
have. The first captured game was seen by seven uploaders whose clocks
disagreed by up to 9 s, which is why detection runs per uploader and merges
after. `fun_events.detail` (migration `20260924050246`) carries start, rolls,
players and steps so /fun can rank without parsing a sentence.

**Still to land:** the one-line display (agent, beta) and the /fun card (web,
beta first at `b.wolfpack.quest/fun`). Not changed, and worth knowing: the
event-night rolled-loot card, the Hot Dice night award and `/rolls` still see a
deathroll's steps as ordinary one-roller sets.

## §96 — Essences of Power: the loot queue, and where it shows (2026-09-29, web beta `7b942d11`)
*2026-09-29 · DECISIONS-2026-09-21.md · Essences loot queue and bidding rule*

**The guild's rule (the guild lead):** *"it will be an opendkp bid out for the entire item. this means the
guild needs to see the order for who is next on the loot list for those items, and if they're present to
get them, if they are not, we would bid out the item again and add to the queue. That person that bids
would get to loot that item, and we would continue onwards · raid 1, someone bids and wins the item,
they're queued up for the first set · if raid 3 that person's not there, we bid the item and whoever comes
in is next in the queue · as long as we bid the item only when we don't have someone in queue we're good"*.
As written into `web/lib/essencesQueue.ts`:
1. **One OpenDKP bid buys the whole set.** Winning it puts you in the queue, in the order you won.
2. **An essence drop goes to the first person in the queue** who lacks that essence and is in the raid.
3. **Nobody like that there? Bid it again.** The winner loots it and joins the end of the queue.
4. **Four pieces and you are done.** You leave the queue.

**Where the page reads it from.** It is guild-wide on `/pop`, members-only like the rest of that page
(the guild lead: *"a public item on the pop landing page … we can see who has which pieces"*).
- **The queue** is every OpenDKP award (`opendkp_loot`) of an essence, or of the bid item, in award
  order: oldest raid first, then the order OpenDKP recorded them.
  - An award with DKP is a bid won; 0 DKP is a queued hand-out.
  - The bid item may be entered as **"Essences of Power"** or **"Power of the Planes"**. Anything else
    is not seen.
- **Pieces** come from those awards, plus Mimic seeing someone loot an essence (`looted_items`). A loot on
  its own never queues anyone.
- **"In the raid"** is the live raid roster: a row in the last 15 minutes, as `/raid` uses. With no raid on,
  the next name is simply the first in line.

**Two layouts on beta, to pick from.** No `?v=` stays production as it was.
- **`?v=b` by person:** the queue as rows, one ✓ per piece held, "next" in the cell of the essence that
  person gets next, and a "next drop" strip on top. It answers *"who has which pieces"*.
- **`?v=c` by essence:** four columns, each the order that essence goes out in, first one "next". It
  answers *"who gets this drop"* at loot time.
- **Sample data:** `&demo=1` shows invented names, labelled on the card, since nothing has dropped yet.
- **Costs:**

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | b | S | low | 5 small reads per /pop view with ?v | low |
  | c | S | low | same | low |

- **Needs the guild to record every piece in OpenDKP:** a bid for the first, 0 DKP for each queued
  hand-out. Mimic's loot line is a backstop, not the record.
- **Tests:** `test/essences-queue.test.js` runs the guild lead's story raid by raid. Mutation-checked.

## §116 — FB-45: a new loot call with the same numbers starts new rolls (2026-10-01, agent 3.7.56 beta `2020a8c4`)
*2026-10-01 · DECISIONS-2026-09-21.md · New loot call starts new rolls*

The guild lead, from a Command Center Rolls card that showed two loot calls as one: *"when we do rolls way
later we should post the new items - we had a long time in between these rolls and we should have made them
separate rolls even if it's the same numbers"*.
- **What happened:** one raid call put 111/222/333 on three items at 22:08, the next put the same numbers on
  three new items at 22:15. Seven minutes is inside the 10-minute same-range window and rolls were still
  landing, so the second wave joined the first wave's sets under the old names (a set is only labelled
  once), and a raider who rolled in both waves showed as re-rolling.
- **The rule now:** a set ends when a call made after it started gives its number to a **different** item.
  The same item posted again is a reminder and keeps the set. A set that has no item yet ends only when the
  call comes more than **2 minutes after its last roll**: calls often follow the first rolls by up to a
  minute (54 s and 10 s measured), and that call names the set rather than starting a new one. Only the
  newest set of a range can take a roll. An ended set shows closed at once on the Rolls card and the
  Command Center.
- **Where:** `_rollSetSuperseded` in the agent, used by `trackRollLine` and `rollSetsSnapshot`. No bot
  change: uploaded sets are keyed on `started_at`, so a new set is a new row. `test/roll-sets-new-call.test.js`.
- **Not done:** an item-less call ("roll 333") still cannot start a new set, because it carries no name to
  compare. A long pause on its own (no new call) still runs to the 10-minute window as before.

## §139 — Mimic's Loot tab: who looted what, and who looted a roll (2026-10-03, bot 3.1.192 · agent 3.7.73 beta)
*2026-10-03 · DECISIONS-2026-09-21.md · Mimic Loot tab who looted what*

The guild lead: *"the loot tab on mimic should have the 'who looted what' section on there for items, as
well as the rolls for loot."*

- **Who looted what · last 12 hours**, a new section on the Loot tab: time, looter, item, zone, newest
  first, with a day line where the date changes. Each agent only sees its own "You have looted" lines, so
  the list comes from the bot: server-panel key `night-loot` (bot 3.1.192, live), the guild's
  `looted_items` for 12 hours plus the roll sessions, cached 60 s for the whole guild.
- **Rolls:** a roll set someone other than the winner looted now says "📦 looted by <name>". The merge is
  the one the Discord rolled-loot card and `/rolls` already use (`utils/rollLoot.js`), not a third copy.
- Polls only while the Loot tab is open or a raid window is on (the bidding card's gate), every 30 s.
- No `exclude_from_stats` filter on read, matching `/rolls` and the Discord card: an excluded character's
  own agent never uploads its loot or rolls.
- Open for the guild lead: the Rolls card still lists only the rolls this Mimic heard; the guild-wide
  sessions are in the panel and could be listed. The Command Center's rolls row does not show "looted by".

## §171 — Long-term bidding stays out of the timers, everywhere (2026-10-06, agent 3.7.92 stable hot-swap · 3.7.93 beta)
*2026-10-06 · DECISIONS-2026-09-21.md · Long-term bids hidden from timers*

The guild lead: *"Longterm bidding for items needs to not show up in timers. Can we kill those across all
sessions?"*, then *"Same with the command center"*. Eleven ~60-day Ethereal Parchment auctions were sitting in every
timers window and Command Center (§ "OpenDKP auctions, one timer each", 2026-10-02).

- **The rule:** an OpenDKP auction set to run longer than **6 hours** (`AUCTION_TIMER_MAX_MS`, end minus start) is not
  a raid call: no countdown, no Command Center row, even in its last minutes. Raid auctions run minutes, extended by
  late bids; nothing near 6 hours.
- **Bidding is untouched:** the Loot bidding window reads the bot's auction list itself (`/api/server/auctions`), so
  long-term auctions stay biddable. That is also why the fix is in the agent, not the bot: the bot serves one list to
  both, and filtering there would have taken the auctions out of bidding.
- **"Across all sessions":** main's agent went **3.7.75 → 3.7.92** with only this change (`f5850e89`), so every
  stable Mimic takes it on its next agent check (the §123 precedent; not a raid night, so no hold). Beta went to
  **3.7.93** (`d32c7582`) so the beta line stays above it; alpha follows beta by sync.
- **The ✕ on those chips "can't be clicked"** (same evening): the dismiss path is sound end to end (✕ →
  `/api/timers/cancel` → `_dkpAuctionsDismissed`; nothing spares a loot chip from a single ✕), so it is hit-testing,
  not logic. One real gap fixed on beta (`cf817067`): the countdown ✕ and the pinned-callout ✕ were `<span>`s armed
  only by their own mouseenter; both now carry `data-wp-interact`, so the preload's document-level arm (re-asserted
  every 150 ms) covers them, which matters most inside a Canvas panel iframe. Ranked remaining causes: (1) a locked
  Canvas where forwarded mouse moves never reach the iframe (unproven either way on real Windows); (2) the Canvas
  in arrange/unlocked mode, where panels take no clicks by design (`body.edit .panel > iframe{pointer-events:none}`);
  (3) another panel's transparent iframe over the stack, or chips clipped past the panel's top. **If it is still
  dead:** add a rate-limited log of `e.senderFrame.url` to `overlay-hover-interactive` in main.js and read one hover.

## §197 — Loot is valued in platinum, totalled per character, over a chosen window (2026-10-08, bot 3.1.226 · Mimic beta)
*2026-10-08 · DECISIONS-2026-09-21.md · Loot valued in platinum per character*

The guild lead: *"quantify the loot tab with how much each item is worth and say how much each toon has looted
equivalently in platinum from what you've seen, and time bound it"*.
- **Worth = `eqemu_items.price`**, the item's base merchant value (copper; shown as platinum). Not bazaar
  prices: those live only in trader files on players' PCs. ~90% of looted rows are NO DROP, which can only ever
  go to a merchant, so the merchant value is the one figure that applies to everything; NO DROP rows are tagged.
  Measured: 10,738 loots in 7 days by 63 characters, all matched by exact name, ≈223k pp.
- **Bot** (`utils/lootValue.js`, `_nightLootPanelBody`): server-panel `night-loot` takes `?hours=` 12 / 24 / 168
  / 720 (anything else → 12, so an old agent sees exactly what it did). Prices by exact `name=in.(…)` (the only
  indexed lookup; lowest id wins), cached 6 h. Per-looter totals are summed over EVERY row in the window (paged),
  only the list is capped at 200. Cache 60 s for 12 h, 300 s for longer windows; a partial price read is not
  cached.
- **Mimic** (dashboard Loot tab): window chips, a "Totals by character" table, a Value column and an ND tag; an
  old bot renders exactly as before.
- **Who looted is not who kept it**: rows are each raider's own "You have looted" line; master-looting and
  hand-offs mean the looter is often not the owner. Said on the officer page (§198) and in the footnote.

## §198 — Officer page: loot by value (2026-10-08, web 1.8.120 · migration 20261008170000, applied)
*2026-10-08 · DECISIONS-2026-09-21.md · Officer loot-by-value page*

The guild lead: *"make an admin page with loot, sortable by highest value. note at the top that who looted it is
not always the person that ends up with it"*.
- **`/admin/loot` [beta]** (new route → live on main with the marker, §135; officer-gated like its siblings):
  the note first, then a window (24h · 7d · 30d · 90d, default 7d, `?days=`), a totals-by-character table
  (items, value, NO DROP count, most valuable item) over EVERY row in the window, and the item list (top 2,000
  by value) sortable by value (default), time, looter or item.
- **Two RPCs** (`loot_value_items`, `loot_value_by_looter`; service_role only; exact-name join, lowest id per
  name): applied on production before the push and run over 90 days (135 looters, 2,000-row list).
- **Known skew:** merchant prices for Luclin horse bridles are huge (White Ornate Chain Bridle 150,000 pp,
  Silken Bridles ~60,000 pp), so a looted bridle dominates any total it is in. Shown as-is: it IS the item's
  merchant value. If that misleads, the next step is a per-item cap or excluding mount items — the guild lead's
  call.
- **DKP items are listed but not counted** (the guild lead: *"If something has a DKP bid associated with it, don't
  count that in the totals"*). `looted_items` carries no auction link, so a looted row is DKP when the same item
  name had an OpenDKP auction with a winner or a bid within ±6 h, or an OpenDKP award in a raid dated within
  ±12 h. 30 days: 120 of 24,478 looted rows. The page's per-character value, headline total and "most valuable
  item" skip them; a DKP column counts them and a DKP tag marks the rows. Migration `20261008180000` adds
  `loot_value_items_v2` / `loot_value_by_looter_v2` (the page calls these).
- ⚠ **A `DROP FUNCTION` hung on production on 2026-10-08** — through both `apply_migration` and `execute_sql`,
  with no lock or other session visible, while a plain `CREATE` returned at once. Hence `_v2` beside the
  unused v1 pair instead of drop-and-recreate. Left behind by the probing: `public._tmp_probe2_20261008()`
  (returns 1, unused) — drop it, and the v1 pair, once a DROP works again (try from the Supabase SQL editor).
- **Mimic's Loot tab (bot 3.1.226) does not yet leave DKP items out** — the same rule belongs in
  `utils/lootValue.js`; queued.

## §198b — /admin/loot: one row per looter + item, paged in the database (2026-10-08, web 1.8.122 · migration 20261008190000, applied)
*2026-10-08 · DECISIONS-2026-09-21.md · Loot page paged, grouped per looter*

**The call** (the guild lead): *"that page … takes forever to load. bringing in a full list of loot on there isn't
great. it lags out my machine just to open it. Please paginate, and give distinct looter+item+count rows instead,
and totals for that row."*
- **Where it landed:** `loot_value_grouped(p_guild_id, p_since, p_sort, p_limit, p_offset)` groups per looter +
  item: count, DKP count, value of one, row total (non-DKP lines only), NO DROP, latest zone and time, and the
  group count for the pager. The page asks for 50 rows at a time (`?page=`); each column header is a link that
  sorts on the server (`?sort=total|unit|count|recent|looter|item`). `LootTable.tsx` is now a server component, so
  the browser gets plain HTML and no sorting script. The per-character table moved to `loot_value_by_looter_v3`.
- **Why it was slow:** two things. The browser drew up to 1,000 single-loot rows. And the DKP test ran two
  look-ups per looted line, one of them on `opendkp_loot`, which has no item-name index: 2.2 s for 90 days. The new
  shared base `loot_value_rows()` collects the window's DKP events (auctions with a winner or bid, awards) once, then
  tests each line against that small set: 0.9 s for 90 days. Same DKP rule as §198, and v3's totals match v2's
  exactly (30 days: 24,477 items, 120 DKP, same platinum total).
- 90 days is about 7,150 looter + item rows, so 143 pages of 50.
- v1 / v2 stay in place, unused, until a DROP FUNCTION works on production again (§198).

## §210 — Charm-pet gear is not loot (2026-10-09, bot · web [beta], migration `20261009030000`, applied 2026-10-09)
*2026-10-09 · DECISIONS-2026-09-21.md · Charm-pet gear not counted as loot*

**The ask** (the guild lead, 2026-10-09, looking at `/admin/loot` "By character"): *"when someone gives their charm pet items,
they should not be counted as loot. Silver Jacinth ring has negative MR for charming, similar to Rusty Spiked Shoulderpads,
Adamantium ring, or other pet weapons or haste items."* A charmer loots an item and hands it to the charmed pet; gear with
NEGATIVE magic resist is worn by charm pets on purpose (lower MR keeps the charm on longer), so the log's "has looted" line
is not a keep-for-self drop.
- **The call.** An item NAME is charm-pet gear when ANY `eqemu_items` row with that exact name has `mr < 0`, OR its
  lower-cased name is in the new officer table `loot_pet_gear_names` (`item_name` primary key, `note`, `created_at`; RLS on, no
  anon/authenticated policy, ships EMPTY). Name-based because `looted_items` carries only the item name.
- **The data** (90 days to 2026-10-09): 7 looted names have `mr < 0`, 152 of 41,447 rows: Adamantite Band (-10, 61x; the
  "Adamantium ring"), Rusty Spiked Shoulderpads (-10, 61x), Silver Jacinth Wedding Ring (-7 version id 14696; 20x),
  Gauntlets of Mortality (-5, 4x), Astral Leggings of the Titans (-5, 3x), Astral Cloak of the Titans (-5, 2x), Greenish Metal
  Shard (-7, 1x).
- **Known cost of "any row", the guild lead may veto.** The same-name `mr 0` Silver Jacinth Wedding Ring (id 16792) is also left
  out (the log carries a name, not an id), and the three -5 pieces (Gauntlets of Mortality, Astral Leggings and Cloak of the
  Titans) are included: 9 rows in 90 days. If those should count, the fix is to key the rule on the lowest-id row only, or to
  exempt names; say so and it changes.
- **Not covered yet:** "pet weapons or haste items" were named but not which. They are not detected by any stat; officers (or a
  session) add them with `INSERT INTO loot_pet_gear_names (item_name, note) VALUES (...)`. Comparison is case-insensitive.
- **Where it landed.** SQL: `loot_value_rows` leaves those rows out, decided once per DISTINCT name (a `pet` CTE and an
  anti-join, so the 90-day window keeps the speed of `20261008190000`); same signature, `CREATE OR REPLACE`, no DROP.
  `loot_value_grouped` and `loot_value_by_looter_v3` read `loot_value_rows`, so both inherit it untouched. Bot: the Mimic Loot
  tab's per-looter VALUE totals (`utils/lootValue.js`: `lookupItemValues` now selects `mr`, `loadPetGearNames` reads the table
  and fails OPEN to the `mr` rule alone, `buildLootValue` skips the rows and reports `pet_gear_items`). The Mimic "who looted
  what" LIST still shows these items (it is built by `buildNightLootPanel`, a different path, and is the record of what was
  looted); only the totals drop them. Web: one sentence under the `/admin/loot` description so the exclusion is never a mystery.
- Tests: `test/loot-pet-gear.test.js` (migration text, the JS definition, the panel body end to end; mutation-checked),
  `test/night-loot-value.test.js` (value shape gained `pet_gear`).

## §211 — Gear a charmer loots back off their own pet's corpse is not loot (2026-10-09, bot half; agent half on `beta`; migration `20261009050000`, applied 2026-10-09)
*2026-10-09 · DECISIONS-2026-09-21.md · Gear looted back from pet corpse*

**The ask** (the guild lead, 2026-10-09): *"anything a charmer gives to their pet (and we have the spawn ID) and they loot is not
counted as loot. It was already theirs."* A charmer hands gear to a charmed pet, the pet dies, the charmer loots the gear back
off its corpse, and the log's `--You have looted <item>.--` line was stored as ordinary loot.
- **The call (design "D").** The charmer's OWN agent remembers its pet's spawn id while the pet is alive and sets
  `from_own_pet: true` on the looted event only when the looter's current Zeal target is that same id, in the same zone, the
  record is fresh, and the target's name ends in "'s corpse" (conditions and tests on the agent branch). The bot stores the flag;
  it never infers one. Charm-pet gear by stat (§210) is a separate rule and still applies to everything else.
- **Accepted limits.** (1) No log line exists when an item is handed to a pet, so nothing marks the hand-over itself.
  (2) It needs Zeal 1.4.6 or newer with a known pet id; about half the fleet is on it, and without an id the line simply is not
  flagged (a missed flag counts as loot, as before). (3) The loot target must still be the corpse when the line is written;
  that is UNTESTED (STATUS: needs a local session), and if it fails the feature flags nothing, never something wrong. (4) Only
  the charmer's own agent can flag it; another raider's agent that saw the same line cannot (it is self-only in EQ anyway).
  (5) The raid-screen feed (`/api/screen/feed`) and the Discord rolled-loot card still read `looted_items` unfiltered; only
  the Mimic Loot tab and `/admin/loot` were asked for.
- **Where it landed.** `looted_items.from_own_pet boolean not null default false`. `loot_value_rows` gained
  `and not li.from_own_pet` in its first CTE and kept §210's charm-pet-gear CTE and anti-join; `loot_value_grouped` and
  `loot_value_by_looter_v3` inherit it. Same signature, `CREATE OR REPLACE`, no DROP.
- **True is sticky, by construction.** `_handleAgentLooted` accepts only the boolean `true` and writes the key ONLY on a flagged
  row (two upserts per batch: the flagged rows, then the rest; a PostgREST bulk body fills a key one row omits with NULL).
  A merge-duplicates upsert updates just the columns in the body, so a re-send without the flag (older agent, restart that
  lost the pet record) leaves a true alone, and a re-send with it upgrades a false. The same line twice in one batch keeps the flag.
  Undoing one is a direct UPDATE. If the flagged body fails (the migration is not applied yet) the rows are stored again
  without the key, i.e. as ordinary loot, never dropped.
- **Mimic Loot tab.** `_nightLootPanelBody` reads `from_own_pet` and, if that read answers null (no column yet), re-reads
  without it. Own-pet rows leave the "who looted what" list, the roll attribution and the per-looter value (unlike charm-pet gear,
  which the list keeps), and `buildLootValue` reports them as `own_pet_items`, like `pet_gear_items`. Web: the one `/admin/loot`
  sentence about charm-pet gear also says this.
- Tests: `test/loot-own-pet-bot.test.js` (migration text, strict-boolean ingest, sticky/mixed-batch/column-missing behaviour,
  totals and list, the absent-column read; mutation-checked).

## §236 — Command Center rolls show the whole range when it does not start at 0 (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Command Center roll range shown*

- **The ask** (the guild lead, with a screenshot): *"Need to see the range if it's not 0 to X"*. A set rolled 999 to
  999 sat in the Command Center as "999 (Spectral Parchment)", which reads like an ordinary 0 to 999 roll.
- **Landed:** the set header in `apps/mimic/command.html` prints `from–to` when `from` is not 0 (for example
  "999–999"); a 0-based set keeps the plain top number. The agent already kept `from` per set, and the agent
  dashboard and the web /rolls page already printed both ends. Beta `16fb1aaa`, test `test/roll-range-label.test.js`
  (fails with the fix reverted). Reaches Windows beta testers with the next beta build; stable at the next cut.

## §447 — Add to wishlist + sealed pre-bid on the gear upgrades page; ears, wrists and rings side by side (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Wishlist and sealed pre-bid on upgrades page*

The guild lead: *"add in 'add to wishlist' for gear upgrades page so people get those on their list to add a pre-bid amount"*, then
*"put wrists and ears together so we can see them easier, since they're interchangeable"*.
- **The bid never touches the website.** `WISHLIST_BID_KEY` lives only in the bot, and the encrypted columns are service-role-only, so the
  page's server actions hand the request to the bot (`POST /api/web/wishlist`, `utils/webWishlist.js`), which encrypts with
  `bidCrypto.encryptBid`. A bid is refused (503) when the key is unset, where `/wishlist add` stores nothing and says nothing.
- **Why not the existing web-to-bot call.** `/api/admin/*` wants the agent bearer, which `requireAgentAuth` stopped accepting at the
  2026-06-04 cutover (per-user `wpms_` tokens only), and `opendkp-actions.ts` already moved off `BOT_BASE_URL` for being a foot-gun. The
  one live web-to-bot channel is the raid screen's: an HMAC ticket with `SCREEN_TOKEN_SECRET`. Reused with a second audience (`wishlist`,
  60 s, server to server only), so a screen ticket (which reaches browsers for two hours) cannot open a write. The bot's address is the
  origin of `SCREEN_LIVE_URL`: no new variable.
- **Ownership is checked twice**: the action against `ownedCharacters`, and the bot from the Supabase user id (household + OpenDKP family,
  the same rule). A member sees only their own pre-bid, the view `/mywishlist` already gives them.
- **Same rules as Discord**: priority 1-10 (default 5), bid whole DKP 1-50,000, no per-character cap, any item in `eqemu_items`. One file,
  `utils/wishlistRules.js`; the slash command's option limits are built from it; `web/lib/wishlistRules.ts` is the site's twin, pinned by
  `test/web-wishlist.test.js`.
- **Pairs**: Ear1+Ear2, Wrist1+Wrist2 and (added unasked, easy to drop) Fingers1+Fingers2 sit under one heading, in the place of the pair's
  first slot, side by side from `md` up (`groupPairedSlots`). Scoring is unchanged: the same item can be suggested for both slots of a pair,
  since the finder only excludes what is already worn (noted, not fixed).
- **Ship order**: bot (4.0.18) to `main`, then web (2.1.46; 2.1.45 went to the /pop/raid Brewall maps) to `beta`. Beta web calls the
  one production bot, so a wishlist saved on `b.wolfpack.quest` is real.

## §448 — Loot picks: Soft Reserve per raid (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Soft Reserve loot picks per raid*

The guild lead: *"Some places do a loot pick system where you would select items from each mob to 'roll' on as your main
picks, this is a good practice for us to be able to support"*, then, between per-raid picks (A) and standing "main pick"
stars on the wishlist (B): *"and its Soft Reserve per raid"*.
- Called **Soft Reserve (SR)** in the UI. Before a raid each signed-up raider reserves items from the night's targets'
  loot tables for the character they bring; when one drops, the bot's loot post lists who reserved it and they go
  first. Picks decide WHO goes first, never the price: DKP sealed bids and rolls stay as they are. Picks end with the raid.
- Open, for the guild lead with the design: picks per person, per boss or per night, open or officer-only, which bosses,
  when picks lock, alts vs mains, whether a pick binds, and what happens to an item nobody reserved.
- Also open: adding ANY item to a wishlist from the website (A: the button wherever an item shows, recommended; B: a
  /me/wishlist page). Today only `/wishlist add` in Discord and the upgrades page (beta) can.
- Scoping and mocks in progress.
