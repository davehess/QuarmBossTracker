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

> **BUILT, in part — agent 3.5.67 (beta).** The *review* half of this section
> ships: a 🩺 Crash review card on the agent dashboard, backed by
> `GET /api/crash-review`, which reads this machine's crash zips and explains
> them (`_readMinidump` + `_crashVerdict`). Per §8 the priority order below is
> inverted from what was originally written — the dump, not the summary file, is
> what actually answers anything, so the card leads with the dump's verdict.
> **Still to build:** the detect-and-offer prompt in Mimic (§2b) and the
> "always review" standing preference. The card is deliberately NOT gated on
> `WOLFPACK_CRASH_REPORTS` — that flag governs uploading to the guild, and
> reading your own crash should never require sharing it first.


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

### §8b — the specific fix, and what would confirm it (second pass on the dump)

"It's the audio stack" is a subsystem, not a fix. Three more streams in the same
dump narrow it to a device and a mechanism.

**1. The GPU device was being destroyed and rebuilt, over and over.** The
unloaded-module list, across a process that lived **5 minutes 40 seconds**
(created 20:08:14Z, crashed 20:13:54Z):

| Unloaded | times |
|---|---|
| `nvgpucomp32.dll` (78 MB) | 4 |
| `NvMemMapStorage.dll` | 4 |
| `nvldumd.dll` | 4 |
| `nvd3dum.dll` (68 MB) | 3 |
| `nvwgf2um.dll`, `D3D11.DLL`, `DXGI.DLL`, `DDRAW.dll`, `dwmapi.dll` | 1 each |

Four full teardowns of the NVIDIA user-mode driver in under six minutes is not
idle behaviour — that is the D3D device being lost and recreated. dgVoodoo
(`D3D8.dll` 4.8.2.134) wraps D3D8 onto D3D11, so every EQ mode/resolution change
takes the whole stack down with it.

**2. The GPU is also what publishes HDMI/DisplayPort audio endpoints.** So the
two findings are one finding: the display device re-enumerating is exactly the
event that would invalidate an audio session bound to a GPU-provided endpoint,
and `RPC_X_SS_IN_NULL_CONTEXT` is what the next `waveOut` call gets afterwards.

**3. The dump names the actual endpoint.** The wdmaud RPC binding strings survive
in memory:

```
RENDER (playback)  {9f0d0636-5fdf-4de9-b052-834835a41ca2}  via wodMessage
CAPTURE (mic)      {8220f162-a788-4e8c-95ab-c47c9acaaa66}  via widMessage
CAPTURE (mic)      {da8cd4f0-2b54-47b6-9873-d469d6265314}  via widMessage
```

`wodMessage` is the waveOut path — the one that faulted — on render endpoint
`{9f0d0636-…}`.

**The one lookup that settles it.** The guid resolves to a friendly device name
with a local registry read:

```
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{9f0d0636-5fdf-4de9-b052-834835a41ca2}\Properties" /v "{a45c254e-df1c-4efd-8020-67d146a850e0},2"
```

If that comes back as a monitor/TV, "NVIDIA High Definition Audio", or anything
on the GPU, the chain is confirmed end to end and the fix is mechanical. If it
comes back as an onboard/USB output, the GPU-coupling story is wrong and the
next suspect is the display resets on their own.

**The fix, in the order worth trying:**

1. **Move the default playback device off the GPU** — onboard analog or USB,
   never the monitor/TV/HDMI endpoint. This severs the coupling and is the whole
   fix if step 3 above says GPU.
2. **Stop the display resets.** Four D3D device recreations in six minutes is
   abnormal on its own. Windowed or borderless instead of exclusive fullscreen
   removes most of them; so does not alt-tabbing out of fullscreen.
3. **Only then, a driver update.** ⚠ *A newer GPU driver is NOT the indicated
   fix* — the crash is not in the NVIDIA driver, which appears once on the stack
   and only as a stale frame. It is worth trying third because the driver is what
   is churning and it ships the HDMI audio component, not because anything points
   at it.
4. **A reboot is free to try.** `dbgcore` reports 10.0.26100.**8737** while
   `rpcrt4`/`wdmaud2`/`winmmbase`/`MMDevAPI` are **.8875** — two servicing levels
   loaded at once. ⚠ Mixed component versions are NORMAL on Windows (an update
   replaces only changed files), so this is **not** evidence of a broken install
   and should not be reported as one. It is only worth noting because a
   pending-restart state would produce the same split and is one reboot to rule
   out.

**How we would actually confirm any of it: he is an uploader.** All 29 `0x6ef`
reports are his, dated. Make one change, note the date, and watch whether the
signature stops. That is the only real proof available at n=1, and we already
have the instrument.

### §8c — so could we just tell people what is wrong with their machine?

Largely yes, and this dump is the worked example: `crash_reason.txt` said
`0x6ef @ kernelbase.dll` and could tell nobody anything, while the dump gave the
subsystem, the device, and the mechanism in one offline pass. What is achievable
automatically, in descending confidence:

| We can say | How | Confidence |
|---|---|---|
| **"This was not Mimic or Zeal"** | module loaded but absent from the faulting stack | high — the question members actually ask |
| **Which subsystem** — audio, video, network, the client itself | module attribution on the faulting stack | high |
| **Which device** | endpoint guids in memory + one local registry read for the friendly name | high where present |
| **"Your GPU driver reset 4× in 6 minutes"** | unloaded-module cycling | high, and free |
| **"3 others had this; changing X fixed it"** | signature match against the corpus | needs more uploaders |
| Function-level root cause | — | ✗ needs symbols |
| Cause of a single event | — | ✗ never; correlate, don't assert |

Two things make this cheap. The analysis is **stdlib Python and entirely
offline**, so it runs inside the agent with no new dependency and no new
permission — the agent already reads files in the EQ folder, and the friendly-name
lookup is one `reg query` on the user's own machine. And the privacy shape is
unchanged: **the dump still never leaves the machine**; only the conclusion
(subsystem + signature) would upload, and only if they opt in.

The honest limit is causation. "Your audio endpoint went away and EQ died
reaching for it" is supportable. "Changing your default device will fix it" is a
hypothesis until the signature stops appearing — so phrase it as the check to
run, never the answer.

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
