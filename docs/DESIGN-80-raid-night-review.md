# [#80] Raid Night Review — design

*Wave 5 of `docs/DESIGN-platform-queue.md`. Written 2026-08-02 for the Sunday
2026-08-02 raid — the first night that should produce one automatically.*

The ask, in the guild lead's words, is "let us review the raid at 9am, not
11:30pm." Today an officer hand-builds that writeup (the Monday review this
item names as its template). This design replaces the hand-build with a
**generated** review that lands in the same place the raid already lives —
that night's Discord thread — and links out to the page that already exists on
the website.

---

## 0. What already exists (read this before writing anything)

`#80` is **half shipped**. The web half landed 2026-07-23 as web v1.0.266 and
was fixed up in v1.0.267:

| Surface | State | Files |
|---|---|---|
| `/raid/review` (index of nights) | **shipped** | `web/app/raid/review/page.tsx` |
| `/raid/review/[date]` (one night) | **shipped** | `web/app/raid/review/[date]/page.tsx` |
| Pure helpers (death dedup, slows, spans) | **shipped + unit-tested** | `web/lib/raidReview.ts`, `test/raid-review.test.js` |
| **Discord post into the night thread** | **missing — this design** | — |
| **Automatic generation (no officer types a command)** | **missing — this design** | — |

The open roadmap card (`web/lib/roadmapData.ts`, `key: 'raid-night-review'`,
`num: '#80'`) is explicit about what is still owed: *"generated from the
night's data and **posted to that night's thread**."* That is the whole
remaining scope. This design does **not** rebuild the web page and does not
invent a second review generator — per the fleet charter, #81 (Raid Guide)
reads what #80 emits, so there must stay exactly one.

---

## 1. Where it posts, and when

### The thread
`utils/raidNight.js` already owns "which thread does a timestamp belong to,"
with a documented parent-channel fallback chain, single-flight racing
protection, and name-based re-adoption after a volume wipe. The review
**must not grow a second copy of any of that.** It calls
`getRaidNightTarget(client, ts)` like every other consumer.

The subtle part is *which* `ts`. The thread key comes from the scheduled-event
window (`utils/raidEvents.js`), and by the time the review runs the window has
closed. Passing `Date.now()` would fall through to the weekday fallback and —
for a raid that ran past midnight — could resolve a different plan than the one
that opened the thread.

**Rule: the review anchors on the night's FIRST ENCOUNTER timestamp.** That is
by construction a timestamp inside whatever window minted the thread, so
`planFor` returns the identical `key` and `name` and `_resolve` hits its memory
/`channelSlots`/by-name path. A night with no encounters has no review to post,
so there is no "what if there's no anchor" case. This is what makes
"reuses the existing night thread rather than creating a second one" a
*property* of the design rather than a hope.

### The clock
The midnight chain runs at 00:00 in the default TZ. **Raids run to 00:30.**
Posting the review at 00:00 would cut the last half hour of pulls off it.

So the midnight chain does not post the review — it **schedules** it:

```
runMidnightTasks()  … existing steps, unchanged, in order …
  └─ scheduleRaidNightReview(client)     ← new, LAST link, returns immediately
        └─ setTimeout(+RAID_REVIEW_DELAY_MIN, post)   default 45 min → ~00:45 ET
```

`scheduleRaidNightReview` is synchronous and cannot throw (it is
try/caught internally *and* the call site wraps it). It never awaits Supabase
or Discord, so **the chain's cost and ordering are unchanged** — a failing
review cannot stop archives, parse consolidation, or the daily resets. That
isolation is the single most important property here and is what
`test/raid-review-post.test.js` pins.

### Surviving a restart
A `setTimeout` dies with the process, and 00:45 ET is *exactly* when a deploy
is most likely — the raid-night freeze lifts at 00:30 and CLAUDE.md tells
everyone to "land it after midnight ET." So there is a second trigger:

`catchUpRaidNightReview(client)` runs once on boot (from
`scheduleMidnightSummary`, the same startup path the chain lives in). It walks
back to the **most recent night that is already over** — `nightKey(now)`, or
the day before it when `now` is still inside the current night's posting hold —
and posts only if:

* the night is inside `RAID_REVIEW_CATCHUP_HOURS` (default 36) — a bot that was
  down all week does not spam an ancient review;
* the night has at least `RAID_REVIEW_MIN_KILLS` (default 1) confirmed kills;
* **no review message is already stored for that night.**

That last check is what makes the two triggers safe together: posting is
idempotent by construction (below), so worst case the second trigger *edits*
what the first one posted.

### Idempotence
The review message id is stored in `state.channelSlots['rreview_<nightKey>']`
with the same anchor + prune shape as `rn_<nightKey>` and
`rollcard_<threadId>` (keep the newest 10). A re-run **edits in place** — the
house pattern for every other card in this codebase. So:

* the deferred timer posts it;
* a restart's catch-up edits it, not duplicates it;
* an officer running `/raidreview` after a late upload lands refreshes it;
* losing `data/state.json` costs at most one duplicate post — acceptable, and
  the same trade every other slot in `state.js` makes.

### Off-night events
`getRaidNightTarget` returns `kind: 'event'` for a Monday/Friday guild event.
**The review is raid-only** — it skips `kind === 'event'`. A roll-loot night
already has its own live card (`utils/rollLoot.js`) that says everything a
review would.

---

## 2. Content — what goes in, and what deliberately does not

The document a raider reads Monday morning. House voice per
`utils/onboarding.js` CHANGELOGS and `web/lib/roadmapData.ts`: plain language,
accomplishment-forward, numbers that mean something, fixes at the bottom.

Rendered against the real 2026-07-30 (Thursday, Ssraeshza Temple) night, the
review is ~1.6k characters — one embed, readable on a phone.

### IN

| § | Content | Source | Why |
|---|---|---|---|
| Header | Night label, zone(s), first pull → last kill, elapsed | `encounters` | The one line that says "this was the night" |
| The numbers | kills · total damage · raiders on the parse · deaths | `encounters` + `encounter_players` + `contributions.raw_parse->deaths` | Four numbers is the whole night at a glance; more is a table nobody reads |
| 🏆 Kills | Each kill: time · boss · duration · damage, in kill order, zone-grouped | `encounters` (confirmed = `ended_at` set) | This IS the raid. Ordered by kill time to match `/parses` |
| ⭐ Standouts | Top damage of the night · best single-fight DPS · the hardest fight | `encounter_players` | Named recognition is why people read a review |
| 💰 Loot | item → winner · DKP, top 8 by price + total spent | `opendkp_loot_recent` view | The other reason people read a review |
| 🫂 Attendance | tick-by-tick headcount, DKP awarded, who was on the first tick but not the last | `opendkp_raids` + `opendkp_ticks` | Officer-useful and grounded; "left early" is a real fact, not an inference |
| 🩹 What to work on | deaths by fight (top 3) · fights slower than our own median · engaged-but-not-confirmed (wipes) | night deaths + a 90-day per-boss duration history | The "what went wrong" section, grounded in data we own — **compared against our own history, never a made-up target** |
| 🎪 Around the campfire | top two `fun_events` counts, one line | `fun_events` | House voice. One line, capped, drops out when the night is quiet |
| Footer | contributing uploads · link to `wolfpack.quest/raid/review/<date>` | — | The Discord post is the digest; the web page is the detail |

Every section renders **only when it has data.** An empty night produces no
post at all (not an embed that says "nothing happened").

### OUT — and why

* **Healing / top heal.** Heal attribution (`healsReceived` / `healCasts`) is
  merged into the *Discord card state* by `_handleAgentEncounter` and is never
  written to Supabase. There is no queryable per-night heal total, so a "top
  heal" line would either be absent most nights or wrong. Cut until heal
  attribution has a durable table. **This is the biggest gap in the review and
  the first thing to add when the data exists.**
* **Signed up but didn't show.** `rh_signups` is populated now (14k rows), but
  (a) the mirror holds *duplicate* `rh_events` rows for the same night
  (two ids for 2026-07-30 SSRA), and (b) signup → character needs
  `discord_id → characters`, which only resolves mains, so every raider who
  showed on an alt would be published as a no-show. A wrong no-show list is
  worse than no list. Cut; revisit when the RH mirror dedups events and the
  alt→main map is trusted.
* **Slows landed / callouts fired.** On the web page already, and correct
  there — 40 slow rows and 3,000 fire rows are a *scrollable table*, not a
  digest. The Discord post links to them instead.
* **Full DPS tables.** Every kill already posted its own parse card in the same
  thread, and `/parses` has the sortable version. The review names three people
  and links out; it does not restate 44 rows.
* **Sealed bids / wishlists.** Bid columns are service-role-encrypted, and
  OpenDKP already publishes the price actually paid. Nothing to add.
* **Chat highlights.** 2,025 `chat_messages` for the night with no quality
  signal to rank them by. A random quote is a coin flip, not a review.
* **Per-class or per-raider report cards.** That is `#77` (transparency panel
  + report cards), not this. Keeping them out is what keeps the review a
  *celebration + one honest fix list* rather than a performance review.

### The data-quality footnotes that matter

* **Deaths** come from `contributions.raw_parse->deaths`, which the midnight
  chain **nulls after 7 days**. A review generated the morning after always has
  them; `/raidreview` for a night older than a week renders the rest of the
  review with the deaths section absent. Documented in the footer text, not
  silently wrong.
* **Death counting reuses `utils/parseDeaths.js` `dedupParseDeaths`** — the
  same #134 phantom-suppression + cross-parser window dedup the parse card and
  the web page use — plus the night-level 60-second cross-encounter collapse
  (`dedupNightDeaths` on the web). Three surfaces, one algorithm; the review
  must never invent a fourth death count.
* **Foreign raids** (a guildie pugging another guild) are dropped with the same
  roster-share rule `/parses` uses (`AUTO_FOREIGN_MAX_MEMBER_FRAC = 0.34`,
  `AUTO_FOREIGN_MIN_PLAYERS = 10`) so the review and the site agree.
* `characters.exclude_from_stats` is honored everywhere a name is printed.

---

## 3. The night window, and one known inconsistency

The bot buckets by **night key** — `utils/raidNight.js`, a timestamp pulled
back over `RAID_NIGHT_ROLLOVER_HOUR` (6) — so a 23:50 kill and a 00:20 kill are
the same night. The review uses the night window
`[D 06:00, D+1 06:00)` local, which is exactly the set of fights that landed in
the thread it is posting to.

**The shipped web page buckets by the plain Eastern calendar day**
(`zonedDayRangeUtc` in `web/lib/raidReview.ts`), matching `/parses`' `dayKey`.
So a kill at 00:20 Friday appears in Thursday's Discord review but on
*Friday's* web page.

This is pre-existing and is left alone deliberately (minimal diff — changing it
edits a shipped page's content for every past night). **Flagged for the
coordinator:** the clean fix is to give `web/lib/raidReview.ts` a
rollover-aware window matching the bot, which would also fix `/parses`' own
midnight split. Not this branch.

---

## 4. Code shape

```
utils/raidReview.js          NEW. Three layers, deliberately separated:
  ├ pure     nightWindowFor / reviewDateKey / mostRecentReviewableNight
  │          summarizeNight(rows)      ← all the composition math, no I/O
  │          renderReviewEmbeds(sum)   ← EmbedBuilder output, no I/O
  ├ fetch    collectNightData(fromMs,toMs)   ← 7 bounded Supabase selects,
  │                                            every one best-effort (null-safe)
  └ post     postRaidNightReview(client, opts)     resolve thread → edit or send
             scheduleRaidNightReview(client)       the midnight-chain link
             catchUpRaidNightReview(client)        the boot link

commands/raidreview.js       NEW. Officer `/raidreview [date] [preview]`.
index.js                     TWO added lines in scheduleMidnightSummary:
                               • scheduleRaidNightReview(...) as the LAST
                                 step of runMidnightTasks
                               • catchUpRaidNightReview(...) at startup
utils/state.js               NEW slot pair getRaidReviewMessageId /
                             setRaidReviewMessageId (mirrors rn_ / rollcard_)
```

`summarizeNight` and `renderReviewEmbeds` take plain arrays and return plain
data, so the whole review is unit-testable against a fixture of the real
2026-07-30 night with **no Discord and no network**. That is how the sample in
the report was produced.

### Failure isolation contract (the regression the charter asks for)

1. `scheduleRaidNightReview` and `catchUpRaidNightReview` **never throw and
   never await network** — they are safe to call from inside the chain.
2. `postRaidNightReview` returns `{ ok, reason }`, never rejects.
3. Every Supabase call in `collectNightData` degrades to `[]` (the util already
   returns `null` on failure/timeout/breaker-open) — a review missing loot
   still ships the kills.
4. `RAID_REVIEW=0` disables the automatic post entirely; the command still
   works. This is the kill switch if the first night's output is wrong at 00:45
   on a Monday.

### Env

| Var | Default | Meaning |
|---|---|---|
| `RAID_REVIEW` | `1` | `0` disables the automatic post (command still works) |
| `RAID_REVIEW_DELAY_MIN` | `45` | Minutes after midnight to post — must clear the 00:30 raid tail |
| `RAID_REVIEW_CATCHUP_HOURS` | `36` | How stale a night the boot catch-up will still post |
| `RAID_REVIEW_MIN_KILLS` | `1` | Below this, no review is posted |

### Schema

**None.** Everything the review reads already exists. The one thing that would
improve it — a durable per-encounter heal-attribution table — is out of scope
and named above.

---

## 5. Regression coverage

`test/raid-review-post.test.js` (new sibling to `test/raid-night-events.test.js`):

* **Midnight chain order preserved.** A fake chain runs its existing steps in
  order with the review link appended; the recorded step order is asserted
  unchanged, and the review is asserted to be last.
* **A throwing review does not break the chain.** The review link is forced to
  throw/reject; archives, parse consolidation and resets still run and the
  chain still reports complete.
* **Thread reuse.** `postRaidNightReview` resolves through
  `getRaidNightTarget` with the first-encounter anchor and lands on the SAME
  thread id the night's parse cards used — `threads.create` is asserted never
  to be called when the night thread already exists.
* **Idempotence.** A second post for the same night EDITS the stored message
  instead of sending a second one.
* **Composition** against a fixture of the real 2026-07-30 night: kill order,
  death dedup agreeing with `utils/parseDeaths.js`, exclusion honored, foreign
  encounters dropped, empty night → no post.

`test/raid-night-events.test.js` is untouched and must stay green — it is the
proof the thread machinery itself did not move.
