# DESIGN — consent-driven crash review

**Hitya, 2026-08-12**, after Razek reported crashing twice while zoning with
Mimic running:

> *"ideally we would be able to review any of the crash reports that are on the
> system or have it review the dump that gets spit out on system so we don't have
> to store them but that would require the user to kick off that process if they
> wanted to understand more about the crash and if we detected the crash in mimic
> then we would be able to ask them would you like us to review it and also would
> you like us to review future crashes"*

---

## 1. What already exists — do not rebuild it

The data layer is done and the privacy shape is already what the ask describes.
`packages/wolfpack-logsync/index.js` watches Zeal's `crashes/` folder, and Zeal
writes exactly the right footprint on any unhandled exception:
`crashes/<timestamp>.zip` containing `minidump.dmp` + `crash_reason.txt`.

The agent parses `crash_reason.txt` and uploads **only the parsed fields** plus a
system snapshot. **The minidump never leaves the machine** — `zip_name` is stored
so an officer can ask for a specific dump by hand when a cluster warrants real
WinDbg work. Clustering is by `(exception_module, address_low16)`, because the
low 16 bits of the address survive ASLR rebasing.

It needs no elevated permissions: file reads in the user's own EQ folder plus a
WMI GPU query.

## 2. The three real gaps

**a) Consent is a tray checkbox nobody is ever shown.** *"Share crash reports
with the guild (opt-in)"* in Mimic's tray menu (`main.js:5797`) sets
`cfg.crashReports`, which reaches the agent as `WOLFPACK_CRASH_REPORTS=1` at
spawn. It works — it is just off by default and lives in a menu people open to
restart the agent, so across 393 stored reports there are exactly **two
uploaders**. Nothing ever asks; you have to go find it.

**b) Nothing detects the crash and offers.** The agent sweeps the folder on its
own schedule. Mimic already knows when `eqgame.exe` disappears (it resolves the
EQ folder from the running process for Zeal pipe detection), so "EQ went away AND
a new zip appeared in `crashes/`" is a reliable, cheap crash signal we do not act
on.

**c) It is telemetry, not review.** Data flows up; nothing flows back. The user
asked to *understand* their crash. Today even an opted-in user learns nothing —
the value all accrues to whoever queries the table.

## 3. The shape

**Detect → offer → review locally → ask once about the future.**

When Mimic sees EQ exit and a new crash zip appear, it shows a small,
dismissible prompt. Not a modal, and never during a raid window if EQ is
relaunched inside a minute — a crash mid-raid means they are already
reconnecting, and the prompt can wait for the next quiet moment.

> **EverQuest crashed.** Want Mimic to look at what happened?
> `[Review this crash]` `[Not now]`
> ☐ Always review crashes for me

**Two consents, deliberately separate.** "Review this one" is a single action on
a single file. "Always review" is a standing preference, off by default, that
lives in Settings next to the other toggles and can be revoked there — the prompt
is not the only place it can be changed, because a checkbox someone ticked once
mid-frustration should not be a trapdoor.

**What "review" means, in order of what the user gets:**

1. **Parse locally and SHOW them.** Module, exception, zone, Zeal version, UI
   skin — in plain language. *"Crashed inside `ntdll.dll` while zoning (no valid
   zone id). Zeal 1.4.2."*
2. **Compare against what we know**, if they are opted in to uploading:
   *"This matches 28 other crashes this month with the same signature."* That
   single line is the entire payoff of having a corpus, and today nobody sees it.
3. **Suggest the known checks** when the signature matches a documented one —
   e.g. Mimic installed inside the EQ folder (the 2026-06-12 field issue), a
   swapped `dpvs.dll`, a UI skin the corpus correlates with.

**What travels: never the dump.** Parsed fields + system snapshot, exactly as
today. The dump stays on their disk, and if a cluster ever warrants WinDbg an
officer asks for that one zip by name. Local-only review (option 1 above) should
work with NO upload at all — a user who wants to understand their own crash
should not have to send us anything.

## 4. Why this is worth doing beyond one bug report

The corpus already answers questions nothing else can: 393 reports back to
January 2025, and the current signature (`0x6ef @ kernelbase.dll +9f54`) went
from **1 crash in July to 29 by 12 August** on an unchanged Zeal build. That is a
real pattern no one would have noticed without the table.

But with two uploaders it is one person's machine, not the fleet's. A consent
prompt is the difference between "a signature spiked on one box" and "a
signature spiked across nine raiders, all on the same UI skin" — which is an
actionable bug report to send upstream to Zeal. §7 is the worked example of
exactly how far two uploaders let you get, and precisely where it stops.

## 5. Deliberately out of scope

- **Symbolicating the minidump.** Function names and line numbers need a symbol
  server and real debugger tooling. ⚠ **But do not read this as "the dump is
  unreadable" — that was wrong and §8 is the proof.** A minidump carries the
  module list with base addresses, so every address resolves to `module+offset`
  with no symbols at all, and *which module* is the question we keep asking.
  `scripts/read-minidump.py` does it in stdlib Python, offline.
- **Uploading dumps, ever.** Size and privacy both argue against it, and the
  parsed signature has been sufficient for every cluster so far.
- **Auto-diagnosing causes.** "This matches 28 others" is a fact. "Mimic caused
  this" is a claim, and the data cannot support it — Mimic reads a named pipe and
  does not inject into the client.

## 6. Prerequisite, now done

The parser had a bug that made this worthless for the exact case it matters
most: `/Character:\s*(.+)/i` — `\s` matches newlines, so a BLANK `Character:`
field swallowed the line break and captured the next line. 55 live rows had
`character = "UI Skin: UIFiles\NillipussUI_1080p\"`. `Character` is blank
precisely when the client crashes **while zoning**, so the reports we most wanted
to attribute were the ones that came back unattributable. Fixed in agent 3.5.65,
all fields line-anchored, 10 tests; the 55 rows were repaired in place.

Then agent 3.5.66 added the five fields Zeal writes that we were still throwing
away — `Exception String`, `Game state`, `Self`, `SpawnInfo`, and which handler
caught it (`20260812060000_crash_reports_diagnostics.sql`, backfilled from
`raw_reason` so all 393 historical rows gained them too). Those are what §7 is
built on; without them the whole corpus is addresses.

⚠ **The bot's ingest map is a whitelist** (`index.js`, `/api/agent/crash_report`).
A field the agent starts sending is silently dropped until it is named there —
which is why the same change had to land on `main` as well as `beta`.

## 7. What the corpus actually says (measured 2026-08-12)

The first real use of the new fields, and a fair test of how much two uploaders
can support.

**Zoning is the dominant crash, and always has been.** Classifying all 393
reports by `game_state`:

| What was loaded | n | % | player entity gone |
|---|---|---|---|
| **zoning / no world loaded** (`ff`/`ffffffff`/`-1`) | **212** | **54%** | 212 / 212 |
| no context (`Multiple Crashes`) | 64 | 16% | — |
| in game (`5`) | 59 | 15% | 47 |
| character select (`1`) | 32 | 8% | 0 |
| other | 26 | 7% | 6 |

Every single zoning crash has `Self: 0x0` and `SpawnInfo: 0x0` — the player
entity is already gone when the fault lands. That is one coherent failure, not a
grab-bag: the client tears the world down, something still reaches for the
player, and it dies on the way out. It shows up in every Zeal version in the
corpus over 19 months, so it is not a regression in any particular build.

**Razek's crashes are in the data, and they are their own signature.** All 29 of
his reports (2026-07-31 → 2026-08-12, including the pair he reported) carry one
fingerprint: `0x6ef` in `kernelbase.dll` at `+9f54`, Zeal 1.4.2 — and the four
that kept their context all read `Game state: ff`, `Zone ID: ffffffff`,
`Callbacks: RenderUI : Exit (0x0)`, `Self`/`SpawnInfo` `0x0`. **He is crashing
while zoning**, which is what he said.

**But it is not "Zeal 1.4.2 is broken", and this is where two uploaders stop.**
The other uploader also ran Zeal 1.4.2 (c6b903b), 4 crashes June–July, and **zero**
were `0x6ef` — they were the same `0xc0000005 @ ntdll.dll` the corpus has shown
for 19 months. Same Zeal build, same graphics stack (`d3d8.dll`,
`eqgfx_dx8.dll`, `dgvoodoo.conf` MD5s match byte for byte), different signature.
What differs is the box: Windows **10.0.26200** vs `10.0.19045`. So the honest
read is *a Win11-build-specific variant of the long-standing zoning crash*, and
**we cannot go upstream on n=1**. One more uploader on 26200 settles it, which
is the entire argument for §3.

⚠ **`system` is captured at UPLOAD time, not crash time.** All 364 of the older
reports share one snapshot, so OS/GPU/file hashes cannot be attributed to a
historical crash — only to the machine as it stood when the zips were sent. Do
not build correlations across the archive on those fields.

⚠ **`Multiple Crashes` is the handler re-entering and it destroys the evidence.**
0 of 64 such rows carry a zone, skin, character or game state — Zeal cannot
safely re-read game state on the second pass. It is 25 of Razek's 29. That is a
concrete, cheap upstream ask independent of the crash itself: *carry the context
captured on the first pass into the re-entrant report.*

## 8. SOLVED — the `0x6ef` crash is the Windows audio stack, not Zeal (2026-08-12)

Hitya sent the actual crash zip for the 16:13 ET report. Its `crash_reason.txt`
is a context-free `Multiple Crashes`, exactly as §7 predicted — but the zip also
carries `minidump.dmp`, which we had never looked at. `scripts/read-minidump.py`
answers it outright:

```
EXCEPTION  thread 0x6fa0
  code    0x6ef  RPC_X_SS_IN_NULL_CONTEXT — an RPC call was made with a NULL
                 context handle (the object it referred to is gone)
  flags   0x1    NONCONTINUABLE — the process could not survive this
  at      KERNELBASE.dll+0x169f54        (RaiseException; esi = 0x6ef)
```

**It is not an access violation at all.** Everything else in the corpus is
`0xC0000005` — a bad memory read. This one is a *software-raised* exception:
`rpcrt4` called `RaiseException(0x6EF, NONCONTINUABLE)` and nothing caught it.

The stack says who, bottom-up:

```
eqgame.exe                        the client
  mss32.dll                       Miles Sound System — EQ's audio engine
    winmmbase.dll                 WinMM / waveOut
      wdmaud2.drv                 the WDM audio shim   (53 frames)
        rpcrt4.dll                RPC to the Windows Audio service (20 frames)
          ntdll!RtlRaiseException
            KERNELBASE!RaiseException   → 0x6EF, noncontinuable
```

**`Zeal.asi` is loaded (base `0x51fd0000`, 11 MB) and appears ZERO times on the
crashing thread.** So does `d3d8.dll`/dgVoodoo, and `eqgfx_dx8`. This is an
audio-path failure end to end, and there is nothing here to report to Zeal.

**What it means in one sentence:** the audio endpoint EQ was playing through went
away, the RPC context handle to the audio service went NULL with it, and the next
sound call raised a noncontinuable exception. That is consistent with the zoning
correlation — EQ tears down and rebuilds the sound system on a zone change, so
zoning is when it reaches for a handle that has gone stale.

**Practical mitigations, in order of bluntness** (untested, n=1 — offer, don't
assert): make the default playback device something that never disappears (the
motherboard analog out) rather than an HDMI/DisplayPort endpoint on the GPU,
which comes and goes with display power and mode changes; disable unused NVIDIA
HDMI audio endpoints in Device Manager; and as the blunt instrument, turn EQ's
sound off entirely, which removes the failing path.

Machine, for the record: Windows 11 build 26200, RTX 4070, client at
`C:\Users\Ryan\Desktop\TAKPv22`, `wdmaud2.drv`/`winmmbase.dll`/`rpcrt4.dll` all
at 6.2.26100.**8875** while `dsound.dll`/`AudioSes.dll`/`wdmaud.drv` are at
.**8737** — a split servicing state across the audio components, which may or may
not be relevant and is worth noting if a second machine ever shows this.

### What this changes about the design

1. **Local dump review is the highest-value half, and it is cheap.** §3 ranked
   "show them the parsed fields" first and treated the dump as out of reach. It
   is the reverse: `crash_reason.txt` said `0x6ef @ kernelbase.dll` and could
   not have told anyone anything, while the dump named the subsystem in one
   pass, offline, with no symbols. **Wire `read-minidump.py` into the review
   flow** — module attribution ("this was your sound driver / this was Zeal /
   this was the video driver") is the answer users actually want.
2. **"Is it Zeal?" is now a question we can answer per crash**, which is exactly
   what an upstream report needs and what a member wants to hear. Absence from
   the stack is real evidence when the module is loaded.
3. **The corpus question was the wrong question here.** §7 spent its effort on
   whether the *signature* was fleet-wide. One dump beat the whole table. Keep
   the corpus for prevalence; use the dump for causation.
