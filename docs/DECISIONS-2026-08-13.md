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

## Open — read this first

| Item | State |
|---|---|
| **Dashboard split — live check** | Sidebar + 📊 Stats / 🩺 Diagnostics are on beta only; browser-verified but not yet used in a raid. Graduate with the next Mimic stable |
| **Task #27** | Restore the 8 muted trash triggers — unblocked, fix is on stable |
| **#204–#207** | Graduate to stable after beta test + one raid cycle |
| **Item icons** | Above icon 1723 render blank — count how many real items are affected. Atlas is 1.6 MB; `pngquant` would roughly halve it |
| **Live guild DPS** | Open judgement call: is the parenthetical raw damage or a percentage? Currently raw |
| **Noisy eqlogparser triggers** | Offered, not accepted: disabling Too Far / Can Not See / Can Not Hit From Here / Out of Range / Range, which were filling the trigger checkpoint journal |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |
