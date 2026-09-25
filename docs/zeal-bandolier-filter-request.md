# Zeal PR draft — a Bandolier chat filter

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). The change is pushed to the
guild lead's fork as branch **`bandolier-chat-filter`**
(github.com/davehess/zeal/tree/bandolier-chat-filter, one commit); the same diff
is `docs/zeal-bandolier-filter.patch` (`git apply` clean on v1.4.7). It has NOT
been compiled here — a cloud session has no MSVC — so build it once locally
before opening the PR. clang-format with Zeal's own `Zeal/.clang-format` reports
nothing on the changed lines.*

**Where it came from:** the Quarm Discord suggestion "Bandolier Spam/Filter
Option" (2026-09-09, seconded twice and bumped 2026-09-24): bandolier reminder
text lands in the chat window's **Other** filter, which also carries `/pet
health`, AA-reuse reminders and more, and weaving (fists or 2H) floods it with
no way to split it off. Asked for: a checkbox to remove bandolier messages, or
their own filter.

**Open the PR:** https://github.com/CoastalRedwood/Zeal/compare/main...davehess:zeal:bandolier-chat-filter

---

## PR title

`Add a Bandolier chat filter for /bandolier status messages`

## PR body (paste as-is)

`/bandolier` prints its status with `print_chat()`'s default color, so every swap
lands in the **Other** chat filter: "Loading bandolier set [x]" and "Bandolier set
swap complete" on each load, plus "already equipped" / "please wait" when the key
is pressed repeatedly. Players weaving weapon sets get two to four lines per
cycle mixed into Other — which also carries `/pet health`, AA reuse reminders and
more — with no way to split them out. (Requested in the Quarm Discord as
"Bandolier Spam/Filter Option".)

**What changes**

- New extended channel `CHANNEL_BANDOLIER` (1011) and a **Bandolier** entry in the
  Zeal chat-filter submenu (`0x1000F`), following the `/mystats` pattern. It is
  appended after "Zeal Spam" so every existing `ChannelMap41+index` setting keeps
  pointing at the same filter.
- The routine status lines — loading, swap complete, already equipped, please
  wait, saving, removing, list, bag set — print on that channel.
- Failures keep their current channels (invalid name, set does not exist, no
  empty slot, item not found, too busy, casting, cursor busy, usage), so a swap
  that did not happen is still seen where it is today.
- `GetRGBAFromIndex` maps the channel back to index 0: the messages keep exactly
  the color they had.
- Unassigned, the filter routes to the main chat window like every other extended
  filter, so nothing moves until a player assigns it.
- README: the filter list, and a note under `/bandolier`.

**Why a filter rather than a suppress toggle**

A filter covers both asks: route Bandolier to its own window, or to a window you
keep out of the way. It adds no setting and no options-UI change, and nothing
changes for anyone who doesn't assign it. A `/band quiet` toggle could come
later on top of the same channel if people still want one.

**Test plan**

1. Build; log in; right-click a chat window → Filter → Zeal: **Bandolier** is
   listed after Zeal Spam, and the existing Zeal filters are where they were.
2. With Bandolier unassigned: `/band save a`, `/band load a` — the messages
   appear in the main chat window, the same color as before.
3. Assign Bandolier to a second window; weave between two sets — "Loading…" /
   "swap complete" / "already equipped" go to that window and Other stays clean.
4. Load a set whose item is not in your bags, and try a load while casting —
   those failures still appear in their usual place.
5. `/band list` — lands in the Bandolier window.
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
