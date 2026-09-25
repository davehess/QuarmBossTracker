# Zeal PR draft — a Bandolier chat filter

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). The change is pushed to the
guild lead's fork as branch **`bandolier-chat-filter`**
(github.com/davehess/zeal/tree/bandolier-chat-filter, one commit); the same diff
is `docs/zeal-bandolier-filter.patch` (`git apply` clean on v1.4.7). clang-format
with Zeal's own `Zeal/.clang-format` reports nothing on the changed lines.*

*History: the first version (`4d16f8d`, routine lines only) built clean locally
and passed in game on 2026-09-25 — the Bandolier entry sat after Zeal Spam and
loads/swaps went to their own window. The guild lead then asked for **every**
bandolier message in the filter, failures included (they were split between white
in Other and red in Spell Failures depending on when the check caught them). That
is `30a79bb`, amended into the same single commit (still authored by the guild
lead) and force-pushed; it needs one rebuild and the failure steps of the test
plan before the PR.*

**Where it came from:** the Quarm Discord suggestion "Bandolier Spam/Filter
Option" (2026-09-09, seconded twice and bumped 2026-09-24): bandolier reminder
text lands in the chat window's **Other** filter, which also carries `/pet
health`, AA-reuse reminders and more, and weaving (fists or 2H) floods it with
no way to split it off. Asked for: a checkbox to remove bandolier messages, or
their own filter.

**Open the PR:** https://github.com/CoastalRedwood/Zeal/compare/main...davehess:zeal:bandolier-chat-filter

## Build and test locally (the clone used for #229)

The guild lead's local clone from the spawn-id PR (`C:\dev\zeal-pr\Zeal`) has
`origin` = the fork and an `upstream` remote (steps:
`docs/upstream/zeal-spawn-id/PULL-REQUEST.md`). From a **Developer Command
Prompt or Developer PowerShell for VS 2022** (so `msbuild` is on the path).
⚠ No inline `# comments` on these lines — cmd.exe passes `#` through as an
argument, which is what broke `git remote -v` the first time round:

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git switch -c bandolier-chat-filter origin/bandolier-chat-filter
git commit --amend --no-edit --reset-author
git push --force-with-lease origin bandolier-chat-filter
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=bandolier Zeal.sln
```

(The amend makes the commit yours rather than the session's; done once,
2026-09-25.) Output: `Release\Zeal.asi` next to `Zeal.sln`. If it trips on C++20
module scanning, add the CI's flags:
`/p:LanguageStandard=stdcpp20 /p:ExportHeader="" /p:ScanDependencies=""`.

**Picking up a later revision** (the branch is force-pushed, so `git pull` would
try to merge the old commit back in — reset to the fork instead; the commit keeps
your authorship, no re-author needed):

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git reset --hard origin/bandolier-chat-filter
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=bandolier Zeal.sln
```

To test, close EverQuest first, then (cmd):

```
copy A:\EQ\Zeal.asi A:\EQ\Zeal.asi.v147-backup
copy C:\dev\zeal-pr\Zeal\Release\Zeal.asi A:\EQ\Zeal.asi
```

run the test plan below, and put the release back afterwards with
`copy A:\EQ\Zeal.asi.v147-backup A:\EQ\Zeal.asi`. Don't press Mimic's Zeal
*Install* while testing — it would replace the test build with the official
release.

---

## PR title

`Add a Bandolier chat filter for /bandolier messages`

## PR body (paste as-is)

`/bandolier` prints its status with `print_chat()`'s default color, so every swap
lands in the **Other** chat filter: "Loading bandolier set [x]" and "Bandolier set
swap complete" on each load, plus "already equipped" / "please wait" when the key
is pressed repeatedly. Players weaving weapon sets get two to four lines per
cycle mixed into Other — which also carries `/pet health`, AA reuse reminders and
more — with no way to split them out. (Requested in the Quarm Discord as
"Bandolier Spam/Filter Option".)

Its failures were split two ways as well: the same "You cannot swap items…" text
prints in the default color (Other) when `check_player_can_swap()` catches it
before a swap, and in spell-failure red when `tick()` catches it partway through.

**What changes**

- New extended channels `CHANNEL_BANDOLIER` (1011) and `CHANNEL_BANDOLIER_FAILURE`
  (1012), and a **Bandolier** entry in the Zeal chat-filter submenu (`0x1000F`)
  that takes both, following the `/mystats` pattern. It is appended after "Zeal
  Spam" so every existing `ChannelMap41+index` setting keeps pointing at the same
  filter.
- Every `/bandolier` message prints on those channels, so the whole feature can be
  routed to one window.
- Status lines — loading, swap complete, already equipped, please wait, saving,
  removing, list, bag set, usage — keep the default color (`GetRGBAFromIndex`
  maps 1011 back to index 0).
- Failures — invalid name, set does not exist, error removing, no empty slot, item
  not found, too busy, casting, cursor, cursor busy, and a step that fails
  mid-swap — print in the spell-failure color (1012 maps to
  `USERCOLOR_SPELL_FAILURE`), whichever stage caught them. A swap that did not
  happen stands out in red inside the Bandolier window.
- Unassigned, the filter routes to the main chat window like every other extended
  filter.
- README: the filter list, and a note under `/bandolier`.

**Why a filter rather than a suppress toggle**

A filter covers both asks: route Bandolier to its own window, or to a window you
keep out of the way. It adds no setting and no options-UI change. A `/band quiet`
toggle could come later on top of the same channels if people still want one.

**Test plan**

1. Build; log in; right-click a chat window → Filter → Zeal: **Bandolier** is
   listed after Zeal Spam, and the existing Zeal filters are where they were.
2. With Bandolier unassigned: `/band save a`, `/band load a` — the messages
   appear in the main chat window, the same color as before.
3. Assign Bandolier to a second window; weave between two sets — "Loading…" /
   "swap complete" / "already equipped" go to that window and Other stays clean.
4. Failures, all in the Bandolier window in red, none in Other or the spell-failure
   window: press a load while casting; while holding an item on the cursor; with
   no room in your bags to unequip; for a set whose item is not in your bags;
   `/band load nosuchset`.
5. `/band list` and a bare `/band` (usage) — land in the Bandolier window.
6. Relog: the Bandolier assignment persists (ChannelMap56 in the UI ini), and the
   other Zeal filters kept theirs.

---

## Other open Zeal issues, checked against v1.4.7 (2026-09-25)

| Issue | What it asks | Where it stands in the code | Our interest |
|---|---|---|---|
| **#218** Zeal ID on the target bar + on the pipe | spawn id visibly and to overlays | **Already done:** `/labels showtargetspawnid` (#234, v1.4.7) and spawn ids on the pipe (v1.4.6) — can be closed with a comment | done |
| **#213** target Level/Class/Race/BodyType + X/Y as pipe labels | richer target data on the pipe | Not done: the pipe's `player` message carries only `target_id` (`named_pipe.cpp:317`). Small, same shape as our ToT patch | **High** — target loc would let Mimic place a target and tell same-name mobs apart (#194); level/class would stop Target Info guessing from the catalog |
| **#207** bandolier for pullers | `/band save`/`load` with no name (an in-memory set); `/doability 11/12` for melee/range attack | Part 1 is small and self-contained in `bandolier.cpp` (the time saved is the ini write, which is tiny — the swaps themselves are server round-trips). Part 2: `/doability` is the client's own command, not Zeal's, so it means hooking the client — riskier | medium; same module as this PR, so it's a natural follow-up |
| **#181** `/tag` option for NPC-only / player-only | stop tagging the MT when assisting yourself | Small: the tag path in `nameplate.cpp` can check the target's entity type before tagging | medium — our `/tag` channel pipeline (#194) benefits from fewer mis-tags |
| #189 chat tabs · #184 font artifacts · #114 non-Latin chat · #91 mouse pan · #29 spell right-click menus | UI / rendering | client internals; not testable from a cloud session | low |
