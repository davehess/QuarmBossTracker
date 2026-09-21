# Triaging a Zeal crash dialog

**Why this file exists** (the guild lead, 2026-09-21): a member posted a
"D'oh! Client crash" dialog in #client-crash-at-start-up — crashing on login,
worked the day before, and upgrading Zeal did not help. They do not run Mimic,
so none of our crash tooling fired and the dialog was all we had.

That is the normal case for most of the server, so this is written for it: **what
each field means, how to look the signature up in our own corpus, and what to ask
the raider to do, in the order that costs them least.**

Related: `docs/DESIGN-crash-review.md` (the design), `scripts/read-minidump.py`
(reads a dump with no symbol server), `CRASH_FINGERPRINT_FILES` in the agent.

---

## 1. Reading the dialog

Zeal's handler writes this box and, next to it, a bundle. Fields, and what each
one is actually worth:

| Field | What it tells you |
|---|---|
| `Exception Code` / `String` | `0xc0000005` / `ACCESS_VIOLATION` is the overwhelming default. It means "read or wrote memory that was not there" and on its own says nothing about who did it |
| `Exception Address` | **The useful one.** A fixed address inside a fixed module is a signature you can look up and compare across people |
| `occurred in module` | Where the fault was raised. ⚠ Not necessarily whose fault it was — see §4 |
| `Zeal Version` | Only interesting as a *contrast*: the same address under several Zeal versions is evidence Zeal is not the cause |
| `Zone ID` | ⚠ **Hex on Zeal ≥ 1.2.0. See below** |
| `Game state` | `1` character select, `5` in game, `ff`/`ffffffff` no world loaded (zoning or shutting down). Anything else is mid-load |
| `Callbacks` | Which Zeal callback was on the stack last, and its phase. `RenderUI : Exit` = the UI render path |
| `UI Skin` | Which skin folder was loading. `UIFiles\Default\` is the stock UI |

### ⚠ The hex trap — `Zone ID` changed format at Zeal 1.2.0

`Zone ID: b5` is **hexadecimal**, not a typo and not zone 185. Measured across
our 633-report corpus on 2026-09-21:

| Zeal | Zone ID format |
|---|---|
| ≤ 1.1.0 (to 2025-08-23) | **decimal** — 0 of 149 reports contain a hex letter |
| ≥ 1.2.0-alpha2 (from 2025-08-25) | **hex** — hex letters in the large majority; a digits-only value is just a zone whose hex happens to have no `a`–`f` |

`Game state` is hex on the same versions (`fd`, `ff`, `ffffffff` all appear).

So **read the zone id as hex, then resolve it against our mirror**, which is
synced from Quarm itself and is authoritative:

```sql
select zone_id, short_name, long_name, cast_outdoor
from eqemu_zone where zone_id = ('x'||lpad('b5',8,'0'))::bit(32)::int;
```

Getting this wrong sends you to the wrong zone entirely: a pre-1.2.0 report
saying `119` is The Wakening Land, while a post-1.2.0 report saying `76` is
**The Great Divide (0x76 = 118)**, not Plane of Hate.

## 2. Look the signature up before theorising

We have every crash any Mimic user has uploaded since 2024-07. The cluster key
is **`(module, address_low16)`** — the low 16 bits of the address are stable
across ASLR bases for the same crash site, which is why the agent stores
`address_low16` as its own column.

```sql
select crashed_at::date, zeal_version, zone_id, game_state, callbacks,
       ui_skin, system->>'os' as os
from crash_reports
where exception_module = 'eqgame.exe' and address_low16 = '138a'
order by crashed_at;
```

Two questions that the corpus answers immediately and a guess never does:

- **Has anyone else hit this exact address?** If yes, on which Zeal versions and
  which operating systems.
- **Is the zone or the game state part of the pattern?** Our single biggest
  cluster is `load2` (the loading screen) at 39 of 633 — crashing during a load
  is the platform's most common crash, so "it crashes on login" is not by itself
  unusual.

## 3. Known signature — `eqgame.exe` at `0x004E138A`, RenderUI, mid-load

Five occurrences as of 2026-09-21, and they line up on everything that matters:

| | |
|---|---|
| Module / address | `eqgame.exe` @ `0x004E138A` (low16 `138a`) |
| Callback | `RenderUI : Exit` — **5 of 5** |
| Game state | `4` — **5 of 5**, and *the only four reports in the whole corpus at game state 4* are the four prior hits of this address |
| Zone | The Wakening Land · The Great Divide ×3 · Jaggedpine Forest — **5 of 5 outdoor** (`cast_outdoor = 1`) |
| Zeal | 0.6.6-beta0 · 1.4.2 ×3 · 1.4.7 — **three different major lines** |
| OS | one Linux/Deck, four Windows 11 — **both platforms** |
| People | 3 distinct raiders, 3 distinct characters |

**What that combination rules out.** The same address, in the client's own code,
under three Zeal lines a year apart and on two operating systems, is not a Zeal
regression — so *upgrading or downgrading Zeal cannot fix it*, and a raider who
has already tried that has not wasted a step so much as run the experiment. It
is the client failing to render the first frame of a large outdoor zone.

### What actually causes it: the graphics driver resets, and the client dies

Corrected 2026-09-21. The dumps behind the three 2026-07-04 reports say it
outright, and this runbook's first draft did not look at them:

| | |
|---|---|
| `dump_churn` | `nvwgf2um.dll`, `nvldumd.dll`, `nvgpucomp32.dll`, `NvMemMapStorage.dll`, `D3D11.DLL`, `DXGI.DLL` — **the NVIDIA user-mode driver stack, unloaded and reloaded 4 times each** |
| `crash_subsystem` | *the graphics driver* |
| `dump_uptime_sec` | **32s, 73s, 33s** — dead inside a minute, three times running |

A member hit the same address on 2026-09-20 on a completely different machine,
and their local review named the **AMD** equivalent — `amdihk32.dll`,
`aticfx32.dll` — resetting several times in three minutes.

**So: two raiders, two GPU vendors, one client address.** The client is a 2002
Direct3D 8 application that does not handle a lost device. When the driver
resets under load it dereferences a stale pointer on the very next frame, which
is why the fault is always at a fixed address in `eqgame.exe`, always in
`RenderUI`, always on the first frame of a zone (game state 4), and always in a
big outdoor one — the heaviest thing it ever has to draw.

⚠ **This reframes the whole triage.** The crash is a *symptom of the display
path*, so the saved UI layout, the zone's files and the character are all
downstream of it. A raider who restores a known-good config and still crashes
has not failed to find the right file — they have confirmed the diagnosis.

⚠ **A second crash on the same machine may look unrelated and not be.** The
2026-09-20 machine also threw a Windows-audio crash — `mss32` → `winmmbase` →
`wdmaud2` → `rpcrt4` — which is what a GPU reset does to sound devices attached
to the GPU: HDMI and DisplayPort audio endpoints vanish with the display. One
cause, two very different-looking dialogs.

**It is survivable.** One earlier raider hit it three times in seven minutes and
went on to play for months afterwards. Say so — someone staring at a client that
will not start assumes their install is dead.

## 4. "Blames Zeal" does not mean Zeal did it

`crash_blames_zeal` is true whenever the report names a Zeal callback, which it
nearly always does — Zeal is what installed the handler. The honest attribution
comes from the **minidump**, not the dialog: it carries the module list with base
addresses, so every stack address resolves to `module+offset` with no symbols at
all. `scripts/read-minidump.py` does exactly that, stdlib only.

The precedent is worth remembering: a 2026-08-12 dump whose dialog said
`0x6ef in kernelbase.dll` turned out, from the dump, to be the audio stack —
`rpcrt4` under `wdmaud2` under `winmmbase` under `mss32` — with `Zeal.asi`
loaded and **nowhere on the crashing thread**.

## 5. What to ask the raider, cheapest first

⚠ **Order matters more than completeness.** Some raiders are paying a real
physical cost for every step, so this list is sorted by information gained per
unit of effort, each step is one action, and any step may be the last one.
**Do not hand over the whole list at once** — one step, wait, next.

**Step 0 — send the crash bundle (one drag, and it may end the guessing).**
Zeal already wrote everything needed, next to the game:

```
<EQ folder>\crashes\<newest>.zip
```

It holds `minidump.dmp` + `crash_reason.txt`. Drag the newest zip into Discord
and run `python3 scripts/read-minidump.py minidump.dmp` — that names the module
that actually faulted, plus uptime and any graphics-driver resets. **This is the
only step that can replace guessing with an answer**, which is why it is first.

**Step 1 — if the dump shows driver churn, go straight to the display path.**
Everything below is aimed at the driver resetting, in rising order of effort:

- **Run windowed or borderless, not exclusive full screen.** Exclusive full
  screen is what makes a display-mode change a device loss. Cheapest real fix.
- **Move Windows sound output off the graphics card** — motherboard or a USB
  headset. An HDMI/DisplayPort audio endpoint disappears every time the GPU
  resets, which is the second crash in the same story.
- **Clean-reinstall the graphics driver** (DDU, then a fresh installer), or roll
  it back if it updated recently. "Worked yesterday" fits a driver update, and
  we have already had one this month — a member's login-screen ghosting, fixed
  by restoring `ddraw.dll` beside `d3d8.dll` from **dgVoodoo2's MS/x86 folder**
  (**`https://github.com/dege-diosg/dgVoodoo2/releases`** — ⚠ it is **not** in
  the Zeal repo, which is where everyone looks first, and that cost a member an
  evening on 2026-09-20. Agent 3.6.48's crash review now prints this URL itself
  whenever it reports driver churn, so the card that raises the problem also
  says where to go next).
- **dgVoodoo2 proper** is the strongest version of this: it replaces the D3D8
  path with D3D11/12, so the ancient code that cannot survive a device loss is
  no longer the code doing the drawing. Both `d3d8.dll` and `ddraw.dll` go
  **beside `eqgame.exe`**, not in a subfolder.

**Step 2 — log in a different character.** Useful mainly to *disprove* a
character-specific cause: if every character dies the same way, stop looking at
config. ⚠ Two crashes in two different zones does the same job — this signature
has been seen in The Maiden's Eye and Jaggedpine Forest on one machine a day
apart, which rules out the zone as the cause on its own.

**Step 3 — rename that character's saved UI layout.** Written on every exit,
read during the UI build at the exact moment of this crash, and the classic
thing that is fine one day and corrupt the next. The game rebuilds it; the only
loss is window positions. ⚠ Worth one paste, **not** worth a long hunt: a
raider who has already restored a known-good backup has ruled this out.

```
cmd /c ren "<EQ folder>\UI_<Character>_pq.proj.ini" UI_<Character>_pq.proj.ini.bak
```

**Step 4 — cut down what the first frame has to draw.** With **EQ closed** (it
rewrites the file on exit), open `eqclient.ini`, find `ShowSpellEffects` in
`[Defaults]` and set it to `FALSE`. Keep a copy first. The dialog prints the
flag names, so use those.

**Step 5 — take Zeal out of the picture, to prove it is not Zeal.** Rename
`Zeal.asi` to `Zeal.asi.off` and start the game. On this signature the corpus
predicts it still crashes; that is a *useful* result — it ends the "is it Zeal"
question and the raider can stop chasing versions. Rename it back either way.
⚠ Our own reviewer already answers this from the dump — on the 2026-09-20
crash it said *"Zeal was running but was NOT involved in this crash — it does
not appear anywhere in the failure."*

## 6. What we would have known automatically

Every step above except 1 and 5 is something Mimic does by itself: it watches
`crashes/`, parses `crash_reason.txt`, reads the dump locally, fingerprints the
client binaries, and uploads the metadata (**never the dump**). A raider without
Mimic is a raider we triage by hand from a screenshot.

⚠ Not a reason to push Mimic at someone mid-problem. It is a reason for the
crash review to be worth finishing, and an argument for `read-minidump.py`
staying stdlib-only so it can be run on a bundle somebody emails in.

⚠ **A Mimic user can still be invisible to us, and usually is.** The local
reviewer runs for everyone; *uploading* is a separate opt-in (`cfg.crashReports`
→ `WOLFPACK_CRASH_REPORTS=1`), default off. So a raider can be reading a perfect
diagnosis on their own dashboard while our table has nothing — which is exactly
what happened on 2026-09-20, and why the triage above ran off screenshots.
**The switch is on the same card they are already looking at:** Dashboard →
🩺 Crash review → *"Automatically send crash reports to the guild"* (or the tray
item, "Share crash reports with the guild"). One click, and it restarts the
parser engine. Dumps still never leave the machine — only what the crash says.
