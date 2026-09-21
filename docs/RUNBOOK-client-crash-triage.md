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

**What it does not rule out.** Which *input* makes the client fall over — the
character's saved UI layout, the zone's files, or something being drawn in that
zone. §5 separates those in the order that costs the raider least.

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

**Step 1 — log in a different character (zero effort, splits the problem).**
- Another character loads fine → it is *this character or its zone*, go to 2.
- Every character crashes the same way → it is the install or the machine, go to 4.

**Step 2 — rename that character's saved UI layout.** It is written on every
exit, it is read during the UI build at exactly the moment this crash happens,
and it is the classic thing that is fine one day and corrupt the next. The game
rebuilds it; the only loss is window positions. Paste into Win+R:

```
cmd /c ren "<EQ folder>\UI_<Character>_pq.proj.ini" UI_<Character>_pq.proj.ini.bak
```

**Step 3 — cut down what the first frame has to draw.** Only if 1 and 2 did not
land, and only because this crash is in the render path. The dialog prints the
two flags that were set, so use those names: with **EQ closed** (it rewrites the
file on exit), open `eqclient.ini`, find `ShowSpellEffects` in `[Defaults]` and
set it to `FALSE`. Keep a copy of the file first.

**Step 4 — take Zeal out of the picture, to prove it is not Zeal.** Rename
`Zeal.asi` to `Zeal.asi.off` and start the game. On this signature the corpus
predicts it still crashes; that is a *useful* result — it ends the "is it Zeal"
question and the raider can stop chasing versions. Rename it back either way.

**Step 5 — what changed since it worked.** "Worked yesterday" points at state,
not code: a Windows update or a graphics-driver update overnight is a real cause
and we have already had one this month (a member's login-screen ghosting, fixed
by restoring `ddraw.dll` beside `d3d8.dll` from dgVoodoo2's MS/x86 folder).

## 6. What we would have known automatically

Every step above except 1 and 5 is something Mimic does by itself: it watches
`crashes/`, parses `crash_reason.txt`, reads the dump locally, fingerprints the
client binaries, and uploads the metadata (**never the dump**). A raider without
Mimic is a raider we triage by hand from a screenshot.

⚠ Not a reason to push Mimic at someone mid-problem. It is a reason for the
crash review to be worth finishing, and an argument for `read-minidump.py`
staying stdlib-only so it can be run on a bundle somebody emails in.
