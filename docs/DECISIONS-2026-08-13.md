# Decisions — 2026-08-13

## Dashboard navigation: a sidebar, and a split by JOB rather than by size

**The ask (Hitya):** *"the dashboard having a sidebar for quick navigation is
something I'd like to consider — having to scroll in our dashboard is somewhat
annoying to navigate."* Confirmed as the **Mimic** dashboard (not wolfpack.quest),
and scoped to **sidebar + split the fat tabs** rather than the sidebar alone.

**Why both halves.** A sidebar moves the navigation but does not remove the
scroll — the cards are still stacked in the same piles. Splitting the piles is
what fixes the hunting; the sidebar is what makes room for the extra
destinations, because a horizontal tab strip runs out of width at about eight
buttons and a vertical rail does not. Neither half is worth much alone.

**The split rule: carve by the QUESTION a card answers, not by card count.**
Info had reached 16 cards and Triggers 12, and both had grown the same way — by
absorbing cards that had nowhere else to live. Measured, Info was answering three
unrelated questions at once:

| Question | Went to |
|---|---|
| "What did my log see this session?" | **📊 Stats** (new) |
| "Is the machinery working?" | **🩺 Diagnostics** (new) |
| "What is this parser / this install?" | Info (kept) |
| "What will call out, and did it?" | Triggers (kept) |

Splitting on *volume* instead ("take the bottom half of Info") would have left
the same three questions interleaved across two tabs, which is worse than one
long tab — a member would have to know which half a card fell into.

**What deliberately did NOT move:**

- **The crash review card stays on Info.** Hitya placed it there the same day
  (*"the review my crashes button in the dashboard is the wrong spot for it,
  lets put that in info"*). It is arguably a diagnostic, but it was a direct
  call and a fresh one — moving it would have quietly reversed a decision
  hours old.
- **Client versions stays on Info.** "What build is my client running" is a
  fact about the install, not a health check.
- **The Dashboard tab was left alone** at 9 cards, despite being third-fattest.
  Its cards are all "me, right now" and most are hidden until they have data;
  the only structural candidate for eviction was ⚙ Engine → Logsync, and Engine
  is already a collapsed `<details>` contributing one summary line of scroll.
  Moving it would also have buried the **setup checklist** — the first-run
  "is this working" panel — under a tab a new user has no reason to open. Not
  worth the blast radius. Revisit only if Dashboard grows.

**Implementation constraint that shaped the diff: move MARKUP, never renderers.**
Each card's volatile content lives in its own `wp*` placeholder filled by its own
render fn, which is what keeps a section's HTML byte-stable between 2s polls (a
section that differs every poll rewrites wholesale — flicker, form resets, lost
scroll). Relocating a card therefore means moving one `h += '<div id="wpFoo">'`
line to a different render fn and leaving the filler untouched. Two new section
owners (`renderStats`, `renderDiag`) rather than two rewritten ones.

**Ordering rule this exposed.** A filler that runs BEFORE the fn emitting its
placeholder is a no-op — the card is blank for one poll on a cold load, then
silently fixes itself. `renderCrashReview` had been in exactly that state since
the crash card moved to Info earlier the same day. `renderDiag` had to be
inserted into `_sections` above its six fillers for the same reason.

**Known benign side effect: hidden panels come back once.** The ✕/⚙ Panels
preference key is `sectionId|title`, so a card the user hid on Info reappears
under its new section. Nothing is lost and re-hiding sticks. Recorded because it
will look like a bug the first time someone hits it.

**Shipped:** agent 3.5.72 on `beta`. Tests: `test/dashboard-tabs.test.js` —
guards the four lists that have to agree (nav buttons ↔ `.section` panes ↔
`_sections` entries ↔ placeholder ownership) plus filler ordering. Every one of
those disagreements previously failed silently; the ordering assertion is what
caught the crash-card bug.

## Attendance has two sources, and the ephemeral one is the one that answers questions

**The correction (Hitya, 2026-08-13):** asked to break out which raiders can only
make one or two nights and who joins late, the first pass answered entirely from
`opendkp_ticks` — who turned up. Hitya pointed out that the attendance piece is
exposed by **Raid-Helper, whose contents only last until the day of the raid**.

**Why that reframes it.** Ticks measure behaviour; Raid-Helper measures *intent*.
The first pass explicitly caveated that it "measures showing up, not availability"
and that separating "can't make Wednesdays" from "chooses not to" was a
conversation rather than a query. That was wrong — the data exists, in
`rh_signups`, with `absence` / `tentative` / `late` / `bench` statuses, and it
settles both questions:

- **Peopleslayer marked 19 of 19 Wednesdays `tentative`**, while signing in on
  18/19 Sundays and 19/19 Thursdays. Zero accepts, zero absences on that night.
  The inferred "blocked Wednesday" (p<0.0001 off the ticks) is his own declared,
  unbroken, four-month-long standing conditional. Nobody had aggregated it.
- **The late question improves into "who warns you".** Azara declares `late` 18
  times against 14 actual late arrivals — the most-late raider is also the most
  reliable signaller. Malthur declares 0 across 55 firm sign-ins and is late 47%
  of nights; same shape for Stupidrichard (0 / 40%) and Jankzer (0 / 37%). The
  actionable ask is not "be on time", it is "click late".

**We already capture it — and that capture is load-bearing.**
`utils/raidhelperApi.js` has been mirroring the board every 30 min since
2024-08: 292 events, 14,741 signups, no gaps against the DKP raid list.
**Because the upstream expires, the mirror is the archive, not a cache** — a sync
outage loses that window permanently rather than delaying it. Nothing monitors
the sync today; a silent failure looks exactly like a quiet signup board. That
is now the top open item below.

**Docs failure worth recording.** `HOW-ITS-BUILT.md` still claimed the mirror
"is empty as of 2026-07-31, so this path is unverified in prod." It had been
live for weeks. That single stale line is what made the first pass ship a
"we can't know that" caveat about data we had two years of — precisely the
failure mode the "answer from the index, not one grep" rule exists to prevent,
except here the index itself was wrong. Corrected in place with a ⚠ marker
naming the cost, plus a real feature entry for the archive.

**Method note for re-runs.** Raw per-night counts mislead: at 72 people × 3
nights, a raider attending 40% of raids looks "light on Thursday" a third of the
time by chance. Test each night against that person's *own* overall rate
(hypergeometric, one-tailed) and only six of 72 survive. Two other traps that
bit this analysis: six `opendkp_ticks` rows are named with raw filenames
(`RaidTick-*.txt`) plus one "Sign up Bonus" and so carry no tick position —
filter on `description ~ '^Tick [1-4] '` and require all four; and a raider who
*stopped* reads identically to one with a night constraint over a 120-day window,
which is how Armando got flagged "light on Sunday" when he had actually attended
2 of the last 25 raids.

## Open — read this first

| Item | State |
|---|---|
| **Raid-Helper sync is unmonitored** | It is the ONLY copy of declared availability (the upstream board expires on raid day) and nothing alerts on failure. Add a staleness check — no new `rh_signups` rows within ~48h of a raid should be loud |
| **Dashboard split — live check** | Sidebar + 📊 Stats / 🩺 Diagnostics are on beta only; browser-verified but not yet used in a raid. Graduate with the next Mimic stable |
| **Task #27** | Restore the 8 muted trash triggers — unblocked, fix is on stable |
| **#204–#207** | Graduate to stable after beta test + one raid cycle |
| **Item icons** | Above icon 1723 render blank — count how many real items are affected. Atlas is 1.6 MB; `pngquant` would roughly halve it |
| **Live guild DPS** | Open judgement call: is the parenthetical raw damage or a percentage? Currently raw |
| **Noisy eqlogparser triggers** | Offered, not accepted: disabling Too Far / Can Not See / Can Not Hit From Here / Out of Range / Range, which were filling the trigger checkpoint journal |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |
