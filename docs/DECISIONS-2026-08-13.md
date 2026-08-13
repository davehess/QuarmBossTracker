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
| **Zeal `EPERM` → ask about compat mode FIRST** | XP compatibility mode on eqgame.exe kills the pipe, and the guide we recommend tells people to turn it on. Mechanism unconfirmed; `lastError` still isn't surfaced anywhere in the UI |
| **Raid-Helper sync is unmonitored** | It is the ONLY copy of declared availability (the upstream board expires on raid day) and nothing alerts on failure. Add a staleness check — no new `rh_signups` rows within ~48h of a raid should be loud |
| **Dashboard split — live check** | Sidebar + 📊 Stats / 🩺 Diagnostics are on beta only; browser-verified but not yet used in a raid. Graduate with the next Mimic stable |
| **Task #27** | Restore the 8 muted trash triggers — unblocked, fix is on stable |
| **#204–#207** | Graduate to stable after beta test + one raid cycle |
| **Item icons** | Above icon 1723 render blank — count how many real items are affected. Atlas is 1.6 MB; `pngquant` would roughly halve it |
| **Live guild DPS** | Open judgement call: is the parenthetical raw damage or a percentage? Currently raw |
| **Noisy eqlogparser triggers** | Offered, not accepted: disabling Too Far / Can Not See / Can Not Hit From Here / Out of Range / Range, which were filling the trigger checkpoint journal |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |

## XP compatibility mode on eqgame.exe breaks the Zeal pipe (EPERM)

**The finding (Chadivarius, 2026-08-13).** Zeal data never reached Mimic; the
agent log churned `[zeal] disconnected from \\.\pipe\zeal_36464 (EPERM)` on
every 25s poll. **Turning OFF "Run this program in compatibility mode for
Windows XP (Service Pack 2)" on `eqgame.exe` fixed it immediately.** Clean
before/after on one machine, nothing else changed.

**Why this is worth a decision entry and not just a support note.** The guild
points new raiders at `quarm.guide`'s *Xanax's Checklist for Minimal Crashes*,
and **item 8 of that checklist recommends XP SP2 compatibility mode**. So the
guide we recommend actively steers people into a configuration that silently
kills Zeal integration. Every `EPERM` report should now open with "is compat
mode on?" — before elevation, before antivirus, before anything else.

**Three distinct pipe failures now, with three distinct signatures.** Read the
signature before guessing the cause; they have nothing in common but the symptom
"no Zeal data":

| Log signature | Cause | Fix |
|---|---|---|
| never connects, `ENOENT` | Mimic installed *inside* the EQ folder; its DLLs shadow Zeal's DX hook (Ashieron, 2026-06-12) | reinstall Mimic elsewhere |
| connects, then instantly closes, **no error code** | EQ elevated, Mimic not — pipe ACL denies the lower-integrity process (Jankzer, 2026-07-05) | match elevation |
| `(EPERM)` on connect | **XP compatibility mode on eqgame.exe** (Chadivarius, 2026-08-13) | untick compatibility mode |

**Mechanism unknown, and deliberately left unknown rather than invented.**
`EPERM` is libuv's mapping of Win32 `ERROR_ACCESS_DENIED` (5), so Windows is
refusing the open outright. Compatibility mode does not change a process's
integrity level or its user, which is exactly why I told Hitya it *couldn't* be
the cause — an inference that sounded solid and was wrong. What would actually
pin it: Process Explorer → eqgame.exe → Security tab (virtualization flag,
integrity level) and `accesschk \\.\pipe\zeal_<pid>` for the pipe's ACL, taken
with compat mode on and off. Until someone does that, the honest claim is the
observation, not a theory.

**Diagnostic worth keeping** — this splits "the pipe is broken" from "Mimic is
being blocked" in one shot, run non-elevated as the same user with EQ up:

```powershell
$p = New-Object System.IO.Pipes.NamedPipeClientStream('.','zeal_<pid>',[System.IO.Pipes.PipeDirection]::In)
try { $p.Connect(3000); 'CONNECTED' } catch { "FAILED: $($_.Exception.Message)" } finally { $p.Dispose() }
```

**Two product gaps this exposed, both of which cost the round-trip:**

1. **We knew it was `EPERM` and never told the user.** `zealPipe.js` captures
   `lastError` on the socket and hands it out through `onStatus` — and nothing
   displays it. Not the Zeal health overlay, not the tray. The single most
   diagnostic fact in the incident existed only in the raw agent log, which is
   why the guild lead found it and the affected raider could not.
2. **The one hint we do have fires once per install, ever.** The "Zeal pipes
   look off" notification leads with the elevation fix, but it is latched behind
   `cfg.zealHintShown`, persisted across launches. Dismiss it once and it can
   never fire again — for a condition that is environmental and recurring.

Fix for both: surface `lastError` on the Zeal health overlay with a
cause-specific line per signature above, and re-arm the hint when the error
*code* changes rather than latching forever.

**Follow-up (Hitya): can the pipe be exposed WITH compat mode on?** It matters —
compat mode is a stability lever, so "turn it off" trades crashes for Zeal data
and nobody should have to pick. Three answers, in order of how fast they can be
tried:

1. **Run Mimic as Administrator, compat mode left ON.** A High-integrity client
   can open a Medium/Low-integrity object, so if the shim is perturbing the
   pipe's label or default DACL, elevating the *client* should punch through.
   Untested as of writing; costs one minute. Note this is the exact inverse of
   the Jankzer fix, which is a good reminder that "run as admin" is not a
   universal answer — it is a specific answer to a specific mismatch.
2. **Check whether XP SP2 specifically is required.** The Xanax checklist's own
   author ranks items 2/3/4 (AV exclusion, `#server-files` patch files, latest
   Zeal) as "the biggest contributors to stability" and describes compat mode as
   something "people swear by" — not a top lever. A lighter mode, or none, may
   cost nothing.
3. **The durable fix is upstream in Zeal, and it is small.** The pipe's security
   descriptor is set where Zeal calls `CreateNamedPipe`. If it passes `NULL` for
   `lpSecurityAttributes` — the common default — the pipe inherits the creating
   process's default DACL, which is precisely what the compat shim appears to
   disturb. Passing an explicit `SECURITY_ATTRIBUTES` with a permissive DACL and
   a low mandatory label (`S:(ML;;NW;;;LW)`) is the standard pattern for a pipe
   that must be reachable from other contexts. ⚠ We have NOT seen that call site
   — `docs/zeal-pipe-protocol.md` was assembled from the message format in
   `named_pipe.cpp`, not from pipe creation — so confirm before asking.
   **This is a far more tractable upstream ask than the spawn_id one**, which
   `CLAUDE.md` records as having gone nowhere partly because it aimed at the
   hardest possible surface: self-contained, well-precedented, and with a
   reproducible user-visible bug behind it.

**Mimic cannot fix this alone** — we are the client, and a client cannot widen
permissions on an object it does not own. What we can do is stop failing
silently, which is gap 1 above.
