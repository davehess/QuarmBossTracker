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

**a) Consent is an environment variable.** `WOLFPACK_CRASH_REPORTS=1`. That is
why, across 393 stored reports, there are exactly **two uploaders** — nobody can
opt in without editing env. When Razek crashed, there was nothing to check,
because his machine was never going to send anything.

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
from **1 crash in July to 28 in August** on an unchanged Zeal build. That is a
real regression that no one would have noticed without the table.

But with two uploaders it is one person's machine, not the fleet's. A consent
prompt is the difference between "a signature spiked on Hitya's box" and "a
signature spiked across nine raiders, all on the same UI skin" — which is an
actionable bug report to send upstream to Zeal.

## 5. Deliberately out of scope

- **Symbolicating the minidump.** Reading `crash_reason.txt` is free; parsing a
  `.dmp` needs a symbol server and real debugger tooling. Ship the cheap layer,
  keep `zip_name` for the rare case that needs the hard one.
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
