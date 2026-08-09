# Beta test plan — what's in beta, and how to prove it works

*The running ledger of features shipped to the **beta** channel awaiting
verification. Each entry names the exact component versions it needs, then splits
test cases into **✅ Solo** (you can do these alone) and **👥 Multi-person**
(need 2+ raiders on separate machines). Mark a row ✔ when verified in a real
raid; move it to STATUS.md's "Done" once graduated to stable.* — **amended
2026-08-09: entries no longer get moved out on graduation. See "Nothing here gets
deleted on graduation" below.**

> How to read component versions: **bot** ships from `main` (live on Railway
> immediately). **agent** ships bundled in the **beta Mimic** — testers must be
> on the beta channel and have updated Mimic so the agent version below is what's
> running (check the agent dashboard footer / `/status`). **⚠ 2026-08-09: this no
> longer applies to anything currently in the file** — every entry below has
> graduated to stable. Read the block immediately after this one first.

## 📍 Current state — 2026-08-09 (read this before any version number below)

**Graduated 2026-08-09: Mimic 2.3.4 "Tag! You're spawn_id it!"** (agent
**3.5.54**) — the whole 2.3 beta line is now the **stable** build for the entire
Windows fleet.

| Component | Live now | Beta |
|---|---|---|
| Bot | **3.1.34** on `main` | *no bot beta — one Railway environment, pinned to `main`* |
| Web | **1.1.35** on `main` | same commit visible at `b.wolfpack.quest/<path>` |
| Agent | **3.5.54** stable, fleet-wide | **3.5.54** (identical to stable); **3.5.55** — adds `ramp` to the threat-snapshot `per_player` payload — is the first build of the new line and lands today |
| Mimic | **2.3.4** stable | parked at **2.3.5** |

> **⚠ How to read the version numbers below.** Every entry keeps the versions it
> shipped in — that is its history and it stays. But **nothing below still needs
> a beta install.** Every agent 3.3.x / 3.4.x / 3.5.x entry in this file has
> since graduated. "**Needs:** agent 3.4.4 (beta Mimic)" now means "*first
> shipped* in 3.4.4, and every install has had it for weeks." The ✅/👥 cases
> stay useful, but they are now **stable-fleet regression checks anyone can
> run**, not beta-tester homework. Rows that were genuinely never proven carry a
> dated **⏳ still unverified** line — those are the real backlog.

> **⚠ Beta adoption is ~zero, and that is why so much below is unverified.**
> Measured 2026-08-07: nine beta builds shipped that day and **only
> stable-channel agents (3.5.36, 3.5.42) ever reported** — no beta tester ran
> any of them. That is a large part of why this ledger accumulated rows nobody
> ever scored, and it is why the 2026-08-09 graduation went out rather than
> piling more onto beta. **Plan verification against the STABLE fleet**
> (`DECISIONS-2026-08-07.md` → Open).

> **Nothing here gets deleted on graduation.** The original rule said to move a
> row to `STATUS.md` once it shipped stable; applied literally today that would
> empty the file, because everything has shipped. Entries stay, annotated with
> dated status lines, so the "what did we actually prove?" question keeps an
> answer.

**Graduation history** (each one moved everything above it to the whole fleet):
2026-08-09 **2.3.4** "Tag! You're spawn_id it!" / agent **3.5.54** · 2026-08-07
**2.3.3** / **3.5.42** · 2026-08-05 **2.3.1** / **3.5.36** · 2026-08-04 **2.3.0**
"Quick Setup and Save Memory Update" / **3.5.29** · 2026-08-02 **2.2.0** /
**3.5.0** · 2026-07-20 **2.0.0** "Harmonic Howl" / **3.4.0** (the entire 1.9.6
beta line) · 2026-07-18 **1.9.5** / **3.3.80**.

### 🔎 What is actually still unproven — the short list

Everything else in this file is shipped and either exercised by daily use or
simply unscored. These are the rows where **nobody has ever run the check and
the code path has never executed in production** — worth reading as the real
backlog rather than scrolling the whole ledger.

| Row | Why it is still open |
|---|---|
| **#74 / #118 kill switch + version floor** | Hitya 2026-08-09: *"I have not messed with kill switches."* `flag_agent_kill` and `min_agent_ver_num` have never appeared in the tuning map. The conservative-v1 sign-off never happened. **The lever you'd reach for in an incident is the one nobody has pulled.** |
| **#115 reporter swap / include** | No `reporter_pin_*` or `reporter_extra_*` key has ever been written |
| **#72 P1b `dedup_buffs`** | Flag never set, defaults OFF → buff-landing election has never run |
| **#72 P1c `dedup_roster`** | Flag never set, defaults OFF → roster election has never run |
| **#73 admission-control 429** | No `budget_*` key ever set → nothing has ever been rate-limited |
| **#107 loot-post TTS** | ⚠ **Failing in the field**, not merely unverified — the 2026-08-05 23:13 ET miss is still undiagnosed |
| **#108 sealed bids stay sealed** | Needs a real open auction + a second bidder; never had one |
| **#117 buff-range 📍 chip** | Needs a partner to run 200+ units away mid-buff |
| **#120 trigger TTS on silent machines** | Windows-only Chromium condition — **cannot** be closed from the build container; needs a field journal row |
| **Rows 5, 6, 7, 13** of the 08-05 pass | `raid_nights` linkage, buff-cast `spell_id` share, slow badges, `incoming_mob` — all just never scored |

*(Tuning-map claims verified directly against `overlay_tuning` on 2026-08-09: the
row holds exactly two keys, `hide_main_names` and `flag_ext_pos_off`.)*

---

## 🗓 Wednesday 2026-08-05 — the verification pass for the 08-03/04 batch

*Written 2026-08-04. This is the priority list for the next raid. Everything
here shipped in the last 36 hours and **none of it has been seen in a real
raid**. Vex Thal is the planned target, which matters for two rows below.*

> ### ✅ This pass RAN — 2026-08-05 Vex Thal. The findings are in `STATUS.md`
> → **"🌙 Raid-night review findings — 2026-08-05 Vex Thal" (R1–R6)** and
> **"🔴 Raid-night queue — opened 2026-08-05/06"** (the perishable capture list).
> The section below is kept as the record of what was asked for and what each
> row means; the dated annotations on each row say where it landed. Rows with no
> annotation had no result recorded and are still open.

**Versions needed:** bot **3.1.7** (main, already live) · agent **3.5.15** +
Mimic **2.3.0** (**beta** — testers must update) · web **1.1.2**.

> *(2026-08-09: all four superseded. Mimic **2.3.0** graduated to STABLE the
> same evening it was written — 2026-08-04 23:07 UTC, carrying agent **3.5.29** —
> and three more graduations followed. The fleet is on Mimic **2.3.4** / agent
> **3.5.54**, bot **3.1.34**, web **1.1.35**. Nothing in this section needs a
> beta install any more; run these against stable.)*

> ### 🚨 Take agent **3.5.15** or nothing. The beta agent did not start at all
> ### from 3.5.5 through 3.5.14.
>
> `FATAL: ReferenceError: _threatSnapMs is not defined` — v3.5.5 renamed the
> threat-snapshot interval constant and missed one reference, in a function that
> runs unguarded on the watch-mode path. The agent printed its ready banner and
> exited. **Watch mode is the only mode raiders use**, so every beta build for
> the last day was dead on arrival. Fixed in 3.5.15 (2026-08-04).
>
> **Stable was never affected** — this never left the beta line.
>
> If a beta tester updated Tuesday and says "Mimic is running but nothing is
> uploading", this is why, and the fix is simply to update again. **Confirm the
> agent dashboard is actually alive before treating any other row below as a
> failure** — a dead agent fails all of them identically.
>
> **✅ CLOSED 2026-08-04 — ignore the "take 3.5.15 or nothing" instruction; the
> agent is 3.5.54.** The dead-on-arrival window was 3.5.5–3.5.14 on `beta` only.
> `test/agent-boots.test.js` now spawns the real agent process in a throwaway cwd
> and fails the build if it doesn't stay up, and it is kept byte-identical on
> `main` and `beta` (`HOW-ITS-BUILT.md` → "Agent boot smoke test"). The deeper
> cause — `beta` running a 35-file subset of main's 90-file suite — was fixed by
> the 2026-08-09 resync.

> **Bootstrap caveat, read first:** the EQ-close auto-update in Mimic 2.3.0 can
> only auto-install for people **already on 2.3.0+**. Everyone else still has to
> update by hand this once. Say so when you ask people to update.
>
> *(2026-08-09: behind us. 2.3.0 went stable 2026-08-04 and three graduations
> have followed, so any install that has updated once is on the auto-update
> path.)*

> **Stable installs are still generating false deaths.** The feign fix is agent
> 3.5.11 on `beta`; `main`'s agent copy still matches `/die[ds]\./`. Any death
> number from a stable reporter on Wednesday is still inflated. This is correct
> per the routing rule — just don't read it as a regression.
>
> **✅ RESOLVED 2026-08-04.** The feign fix (agent **3.5.11**, `died.` only) plus
> the second death-regex site (`_deadMobNameFromLine`, agent **3.5.14**) rode
> agent **3.5.29** into stable Mimic **2.3.0** that night; the fleet is on
> **3.5.54**. **Stable reporters no longer inflate death counts.** Historic rows
> are a separate question (#200 in `STATUS.md`) and were expected to age out on
> their own around 2026-08-10, when the midnight job nulls `raw_parse` at 7 days.

> ### ⚠️ ~~Before the raid: the new callouts do not fire yet~~ — SUPERSEDED 2026-08-09, read the next box
>
> The Feeblemind, Shadow Poison and Wave of Death triggers are `^`-anchored, and
> patterns match against the raw line *including* the `[timestamp] ` prefix — so
> `^` anchors before the timestamp and they can never match. **37 of our 109
> enabled triggers have the same defect** (the long-open #190). One-line fix,
> reaches the fleet in ~2 minutes, needs no release — but it is **not applied**,
> because turning all 37 on at once is a genuine noise decision.
> **`docs/RUNBOOK-dead-triggers.md` has the staged SQL.** Row 11 below cannot
> pass until Stage 1 runs.

> ### ✅ CHANGED 2026-08-09 — the compiler fixes the anchor, so those triggers fire
>
> The box above is **history**. `compileTriggerPattern` (which replaced
> `_translateDotNetRegex` on 2026-08-07) now handles both halves of the raw-line
> problem, and both are live on agent **3.5.54** — i.e. the whole fleet since the
> 2026-08-09 graduation:
> - **`_rewriteAnchorsForRawLine`** rewrites a top-level `^` to
>   `^(?:\[[^\]]{1,40}\]\s+)?` — an **optional** timestamp prefix, so the pattern
>   matches the raw line *and* a bare message (imported GINA/EQLogParser patterns
>   and legacy `\]\s+` ones both fire);
> - an **unanchored** pattern that OPENS with `{s}`/`{n}` gets the same optional
>   prefix prepended. That is the separate `{s}`-eats-the-timestamp P1 which rode
>   agent 3.5.44–3.5.53 unseen (the "Razor Fang" casualty), fixed in **3.5.54**
>   and pinned by `test/trigger-class.test.js`. `{c}` is exempt.
>
> Full write-up: `docs/HOW-ITS-BUILT.md` → **"Trigger pattern anchoring — the
> `^` trap (#190)"**, revised 2026-08-09, and `DECISIONS-2026-08-07.md`
> → "Triggers — the `{s}` timestamp swallow".
>
> **What that means for this file:** the 37 are **no longer structurally dead**.
> The DB rows are untouched (verified against `guild_triggers` 2026-08-09: still
> 37 of 109 enabled triggers with a bare leading `^`, and **0** rewritten to
> `^\[`), so **`docs/RUNBOOK-dead-triggers.md`'s staged SQL is now hygiene, not a
> resurrection** — it makes the stored pattern say what the compiler already
> does, which still matters if an older agent ever reads them. Row 11 below is
> **unblocked**.
>
> ⚠ **The raid-noise decision the runbook was holding back has already happened,
> at the compiler.** 37 previously-silent callouts went live in one release. If a
> raid is suddenly noisy, that is the first place to look — and the lever is
> disabling the individual triggers in `/admin/triggers`, not the SQL.
>
> ⚠ The old advice *"don't fix one by deleting the `^` — you'll capture a leading
> space"* is **no longer true** (that was the allow-list `{s}` class; `{s}` is
> `.+?` now and the unanchored case is guarded). Do not re-derive it.

### 🔴 Highest value — the two that change every number

**1. Clock skew is visible and actionable — and the clocks are DRIFTING.**
- ⚠️ **Do this before the raid.** Three machines, everyone else fine (18 of 21
  uploaders sit within ±3s): **Fargan's** is **~56s behind** and has been
  sliding for **at least a month** without ever being corrected;
  **Bardtholemu's** is ~22s behind — and here's the kicker: it **was synced to
  correct on Jul 26–27 and was 11s off again two days later**, so a one-time
  "fix your clock" provably does not hold; the third is **Stupidrichard's**
  machine (~7s, same sync-then-drift cycle — and he's on the DI callout
  roster). They need Windows time sync ON, not a one-off sync: Settings → Time
  & language → Date & time → "Sync now" + "Set time automatically"; if it
  drifts back, the `w32time` service is disabled. Wording in
  `DESIGN-clock-correction.md` §3. **If those three sync before the pull, most
  of row 2 fixes itself.**
- ✅ First green signal already in: one install updated to 3.5.15 this morning
  and its `pulse` row landed (+0.4s, agreeing with its consensus estimate) —
  the update path and the pulse pipeline both work in the field.
- ✅ **Solo:** the agent warns you once if your own clock is off by >5s.
- 👥 **Multi:** after one boss kill, run the multi-observer spread query in
  `RUNBOOK-death-backfill.md` §3 against a death several people witnessed. **Pass
  = every observer inside a few seconds.** On 08-03 the same check showed a 45s
  spread from one machine.
- 👥 Check `agent_clock_offsets` has both a `pulse` row (new — needs agent
  3.5.10+) and a `consensus` row per install, and that they **agree**. They are
  independent estimators; disagreement means one is broken.
- **⏳ STILL LIVE GUIDANCE as of 2026-08-09 — but the correction now also happens
  at INGEST.** `bot 3.1.20` (2026-08-06) rewrites an event's `ts` to server time
  using the pulse offset and keeps the original as `tsRaw`
  (`utils/clockOffset.js` + `_resolveClockOffsetMs`), so death dedup, phantom
  suppression, the Discord card, the parse page and the timelines all became
  correct with no consumer changes — that is what closed the death **overcount**
  (`STATUS.md` R1; Fargan measured at 59,224 ms, nearly double the 30s dedup
  window). It does **not** close this row: offsets are a drifting time series,
  the correction is only as good as the current pulse estimate, and the
  `consensus` estimator has **zero write sites** and is frozen at 2026-08-04
  (it reads Fargan at 42s where pulse reads 63.5s) — so the "both rows agree"
  check above cannot pass on its own terms right now. The three machines still
  need Windows time sync **ON**, not a one-off sync.
- **This row is load-bearing elsewhere, which is why it stays open.** Bot
  **3.1.34** cites it by name: the old `claimThreatSnapshots` used a 20-second
  margin, *smaller than the 22–56s skew measured on real machines*, so even the
  submitting uploader's own snapshot claim could miss. Skew is not just a death-
  count problem — it silently breaks any time-window join in the platform.
- ⚠ Do **not** "fix" this by widening `DEATH_DEDUP_MS`: real deaths 30–60s apart
  in a long fight would silently merge, trading a visible overcount for an
  invisible undercount.

**2. Deaths are real deaths.** — **✅ SHIPPED STABLE 2026-08-04** (agent 3.5.11 +
3.5.14, delivered fleet-wide as 3.5.29 in Mimic 2.3.0; now 3.5.54). The cases
below stay as stable-fleet regression checks. Post-raid audit query is still
`RUNBOOK-death-backfill.md` §3.
- ✅ **Solo (SK/monk/necro):** feign during a fight. **Pass = you do NOT appear in
  the parse card's 💀 Deaths section.** This is the single most direct test of
  the whole night's work.
- ✅ **Solo:** actually die, then run back. **Pass = one death, and it is
  `confirmed`** (the corpse-run tail back-patches it). Get a rez instead and it
  stays unconfirmed — **that's correct**, not a bug.
- 👥 **Multi:** one player dies with 5+ Mimic users present. **Pass = ONE row on
  the parse card, not one per observer.** This is the Uilnayar case; it may still
  fail until #202 lands, and if it does, capture the timestamps — that IS the
  measurement #201 needs.
  - **Update 2026-08-09:** #202 **did** land, as ingest-time correction in bot
    **3.1.20**, so this case should now pass for a different reason than it was
    written for — the skew-split duplicates are collapsed before dedup ever runs.
    ⏳ **No result recorded since.** Worth one deliberate observation.

### 🟡 Should just work — confirm and move on

**3. Threat snapshots carry a mob name.** Query
`encounter_threat_snapshots` after a kill: `boss_name` non-null (was NULL on all
463k prior rows), `target_name` present, rows ~6s apart not ~18s. Try the
`threat_snapshot_ms` knob in `/admin/overlays` mid-raid — it should take effect
inside 60s with no deploy.
- **⚠ Re-read before running — the storage rules moved twice (2026-08-07/08).**
  `boss_name` / `target_name` / the `threat_snapshot_ms` knob are unchanged, but
  bot **3.1.32** now keeps a snapshot only when it **names a boss** OR it is raid
  time with 8+ players in the fight, and drops byte-identical consecutive
  scoreboards — so "rows ~6s apart" is no longer the expectation for an
  off-hours duo pull. The roll-up became per-(raid night, character) for trash
  and per-fight for bosses, and both carry `raid_night_id`
  (`DECISIONS-2026-08-07.md` → Storage / data).
- ⚠ **`encounter_id` on threat snapshots — the rule just changed, read both
  halves.** *Historically* it was assigned only at fight end, to the submitting
  uploader's own rows, so it was NULL on 99.3% of snapshots and any join on it
  read a 0.7% sample. **Bot 3.1.34 (2026-08-09) fixes that going forward**:
  `claimThreatSnapshotsByBoss` runs at encounter close and claims **every**
  uploader's rows by normalized catalog name within a ±2 min window (binding was
  measured at just 2.6% of boss fights before — 96 of 3,651 in 14 days). The old
  per-uploader claim stays as the fallback for bosses missing from the catalog.
  **Still true:** the roll-up keys on `(boss_name, started_at)`, never
  `encounter_id`, and any query over *historical* rows is still reading the
  sparse sample.
- **🔴 LIVE TEST TONIGHT (2026-08-09, Ssra).** Two in-flight pieces get their
  first real raid, and both are worth watching:
  1. **bot 3.1.34 `encounter_id`-at-close.** Ssra means **multiple pulls of the
     same boss**, which is exactly the case the design has to survive: each
     encounter claims at ITS own close with `encounter_id=is.null`, so the
     earlier pull takes its rows before the next one finishes. **Pass = repeat
     pulls stay separable** and boss fights show far better than 2.6% binding.
     ⚠ `npcDisplayName()` (JS) must stay in lockstep with the SQL normalisation
     (underscores→spaces, strip `#`) or the two sides disagree on what a boss is
     called.
  2. **agent 3.5.55 `ramp`** in the threat-snapshot `per_player` payload.
  Neither has a written ✅/👥 case yet — capture what you see.

**4. Raid Review "Trash Cleared" only counts in-raid kills.** Anything killed
before 19:30 ET must NOT appear. Previously daytime XP kills landed in the
night's tally.
- **✅ FIXED FURTHER — bot 3.1.18, grace tightened to 15 min in 3.1.19
  (2026-08-06).** The 08-05 review showed the *opposite* of the original report:
  all 89 trash entries landed **after** the last boss died, because
  `isRaidNightAt()` is deliberately open-ended at the tail. `trashBoundsFor()`
  now bounds the tally to [first pull, last CONFIRMED kill] ± a 15-min grace —
  the DKP-tick line, per Hitya — and returns `{}` mid-raid when nothing is dead
  yet. `STATUS.md` R4.

**5. `raid_nights` links the night's encounters.** After the raid, the night row
exists and the night's encounters carry `raid_night_id`. A kill *outside* the
window stays NULL — that's intended.
- **⏳ Still unverified as of 2026-08-09** — no result was recorded. Runnable
  against stable now.

**6. Buff-cast `spell_id` resolution.** Post-raid, unresolved share should stay
near **0.5%** (was 34.4%). If it jumps, a new spell vocabulary arrived — check
which names failed rather than loosening the uniqueness rule.
- **⏳ Still unverified as of 2026-08-09** — no post-raid number was recorded.

**7. Slow badges.** A beastlord's **Sha's Advantage** shows `BST SLOW 50%` on
Target Info; **Tigir's Insects** likewise. Class label must be right, not just
the percentage.
- **⏳ Still unverified as of 2026-08-09** — no result recorded.

### 🟢 Mimic 2.3.0 — the quality-of-life batch

> **✅ All three shipped stable 2026-08-04 in Mimic 2.3.0** ("Quick Setup and
> Save Memory Update", agent 3.5.29) and are on **2.3.4** today — they are no
> longer a beta batch. ⏳ None of the three has a recorded verification result;
> run them against stable.

**8. Update installs when EQ closes.** Have a pending update, close EQ. **Pass =
Mimic updates within ~15s.** Crash-and-relaunch EQ during that grace → the update
**defers**. Nag is hourly and must **never** steal focus from the game — if a
window pops over EQ mid-fight, that's a P0.

**9. Resource use card** (Settings). Real per-process CPU/memory, 2s refresh, log
agent listed separately. **The point of this is honesty** — if the numbers look
wrong, say so; the whole reason it exists is that we didn't want to make claims
we hadn't measured.

**10. Zeal update notice** appears in Mimic Mail on the dashboard when Zeal is
behind, and **clears** when current.

### ⚫ Vex Thal specifics

**11. Shadow Poison callout** fires when it lands on a player (it's curable —
that's why it's worth calling). This is its first live raid. **Blocked until the
Stage 1 SQL in `RUNBOOK-dead-triggers.md` runs** — as shipped, the pattern cannot
match. Don't score this row until then.
- **✅ UNBLOCKED 2026-08-09 — no SQL needed.** Agent **3.5.54**'s
  `compileTriggerPattern` rewrites the leading `^` into an optional-timestamp
  prefix, so this trigger (and the other 36) now compile to something that
  matches a real log line. See the anchoring box at the top of this section.
  The row is scorable on any 3.5.54 agent — which is the whole fleet.
  ⏳ **Still unscored**: Vex Thal ran on 08-05, before the fix.

**12. Feeblemind in/out will NOT be exercised** — that's Thought Horror
Overfiend, and Hitya's note was "at least a week and a half" out. Don't score
it as a failure this week.
- **2026-08-09:** still no recorded Overfiend pull, so still unscored — but the
  reason has changed. It is no longer *structurally* dead (same anchor fix as
  row 11); it just needs the mob.

**13. Take one `character_live_state` sample mid-fight** and check
`incoming_mob` is populated. It's an upsert table, so a null-fraction reading is
*not* evidence either way (I got that wrong on 08-03) — you need a live sample
during an actual fight.
- **⏳ Still unverified as of 2026-08-09** — no mid-fight sample was recorded.

### 📋 Post-raid, five minutes

- Re-run the three diagnostics in `RUNBOOK-death-backfill.md` §3 and record the
  numbers. **This is the clean baseline** #201 has been waiting for — a raid
  night with feigns excluded at parse time.
  - **✅ Done, 2026-08-05/06.** The numbers drove `STATUS.md` R1–R6 and the fix
    round that followed (bot 3.1.17–3.1.21). Headline: the overcount was clock
    skew, not death semantics, and it was corrected at ingest in bot **3.1.20**
    rather than by retuning the window.
- Note which callouts people **dismissed**. We can't record it yet (#207), so
  memory is the instrument this once.
  - **⏳ Still memory-only as of 2026-08-09** — #207 (overlay UX for callouts +
    recording dismissals) is still spec-only, `docs/DESIGN-callout-overlay.md`.
    ⚠ This got more valuable, not less: 37 previously-silent callouts went live
    with the 2026-08-09 anchor fix, and dismissals are the only signal we have
    for which ones people don't want.
- **Also open from that night, still uncaptured** (`STATUS.md` → 🔴 Raid-night
  queue): the DI-fired trigger still has an **invented** pattern and needs one
  real log line; a real twin-add pull is still needed for `[ext-pos]`; the DKP
  TICKS "cannot submit → No attendees in that source" failure was never captured
  in its failing state; and the missing "Loot posted" TTS at 23:13 ET (see #107
  below).

---

## #141 — Target Info / Mob Info no longer leaks a same-name mob from another zone

**Needs:** bot **3.0.226** (main, live on Railway) + agent **3.4.4** (beta Mimic).
No DB change. The bot fix is the enabler + fails open; the agent fix (sending
`?character=`) is what activates zone-scoping for you.

**Status (2026-08-09): ✅ live for the whole fleet** — agent 3.4.4 is long
superseded (fleet on **3.5.54**), so both halves are active everywhere.
⏳ **No ✅/👥 result was ever recorded**; the cases below are now stable-fleet
regression checks.

**What it is:** the Mimic **Mob Info / Target Info** overlay used to merge
cross-client data by mob **name** across all zones, so a mob whose name also
exists elsewhere pulled in the OTHER zone's stats/debuffs/casts. Confirmed live:
a raider in **The Wakening Land** targeting "a geonid" saw a **Crystal Caverns**
geonid's stats (L31-33, ~1k HP) and its debuffs (Enveloping Roots, Ensnare)
landed by someone in a totally different zone. Now the bot scopes all three
relays (target-buffs, target-casts, mob-info) to **your** zone: only
observations from someone in the same zone as you are merged, and the mob's
catalog stats resolve to the mob **in your zone** (a same-name mob elsewhere
never appears). Unknown-zone requester → served as before (fail-open).

**✅ Solo (one machine)**
- **Target a mob whose name exists in more than one zone** (e.g. "a geonid" —
  present in The Wakening Land AND Crystal Caverns). Mob Info's HP/level/zone
  line must match the mob **in front of you** (Wakening Land geonid = L44-48,
  ~9.8k HP), not a lower-level Crystal Caverns one, and the debuff/cast list must
  not show spells nobody in your zone cast.
- **Zone change re-resolves.** Target a same-name mob in zone A, then zone to B
  and target the same-name mob there — Mob Info must switch to B's mob (no stale
  A-zone stats lingering from the cache).

**👥 Multi-person (2+ machines)**
- **Two raiders in DIFFERENT zones, each near a same-name mob** (one in Wakening
  Land, one in Crystal Caverns, both on "a geonid"): each raider's Target Info
  shows **only their own zone's** mob — stats, debuffs, and casts. Neither sees
  the other's debuffs bleed onto their target. (Same raid, same zone → they DO
  still see each other's landings, as before.)

---

## #142 / #143 — Emperor tank-buster countdown + ext-target MEZ/SLOW badges

**Needs:** agent **3.4.3** (beta Mimic) + web **1.0.264** (roadmap/docs, live on
Vercel). No bot change, no DB change. All agent/overlay side.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.4.3 → fleet on
**3.5.54**; web on 1.1.35). ⏳ **No ✅/👥 result recorded.** Note the timer
engine has grown a lot since — agent **3.5.52** added multiple warning
thresholds, captured durations, timer-key capture, a visible recast timer,
exclude patterns and colour/pin/display-threshold (`guild_triggers`
EQLogParser-parity work) — so the "arm twice → resets, not stacks" case is worth
re-running rather than assuming.

**What it is:**
- **#142 tank-buster countdown.** For the **Emperor Ssraeshza** fight the agent
  now runs the tank-buster clock off the **combat log** (per-client, no Zeal / no
  relay — works for everyone): **Blood of Ssraeshza dies → a 2:00 Emperor spawn
  countdown** with a **"Paladin DA NOW"** call 10s out; the **~4000 non-melee
  buster hit → "TANK BUSTER"** call + a re-armed **60s** countdown to the next; a
  repeat hit **resets the same bar** (never stacks); the **Emperor's death clears
  the countdown** so nothing lingers on the corpse. The re-arm + clear-on-death
  are general (any boss timer with a `target` benefits; #36 builds on it).
  *Detection note:* the imported `.*tank ?buster` guild trigger can't fire (Rage
  of Ssraeshza, spell 2310, is a 0s cast with no chat text) — the ~4000-damage
  line is the real signal; don't wait on that trigger's regex.
- **#143 MEZ/SLOW badges.** The Extended Target overlay shows a bright pill next
  to a mob's name when it's **mezzed (purple MEZ)** or **slowed (amber SLOW)**,
  read from the debuffs already on that mob. Both show when both.

**✅ Solo (one machine)**
- **Arm a timer trigger twice → it RESETS, not stacks.** Make a personal trigger
  with any pattern + a timer duration (e.g. 30s). Trip it twice a few seconds
  apart (Rehearse/Test, or type the matching line). The trigger overlay must show
  **ONE** countdown row that jumps back to full on the 2nd fire — never two rows.
- **A matching death cancels the countdown.** Give that trigger a target it's
  "about" (fire it while a mob whose name matches is your current fight, or use a
  `{s}` capture that captures the mob). While its bar is ticking, kill that mob
  (or type its slain line). The row must vanish immediately. An UNRELATED mob's
  death must leave the bar ticking (natural expiry).
- **Emperor dry-run (if you can pull it):** on Blood of Ssraeshza's death you get
  a 2:00 "Emperor spawn + buster" bar + "Paladin DA NOW" at 1:50; the first
  ~4000 hit says "TANK BUSTER" and starts a 60s bar; each subsequent buster
  resets it; the Emperor's death clears it.
- **Ext-target badges:** with a shaman/enchanter slow on a raid mob, its
  Extended Target row shows **SLOW**; with a mez on an add, it shows **MEZ**; a
  mob that's both shows both; the badge disappears the instant the debuff falls
  off. A plain debuff (e.g. Malo/Pacify) shows neither.

**👥 Multi-person (2+ machines)**
- **Everyone hears the buster locally.** Two raiders in the Emperor fight should
  BOTH get the "TANK BUSTER" call + countdown from their own logs (no relay
  needed) — confirm neither depends on the other running Zeal.

---

## #101 — Local log replay through the real trigger pipeline

**Needs:** agent **3.4.1** (beta Mimic) + web **1.0.260** (live on Vercel).
No DB change; no bot change. The replay tool + ⏪ overlay tag are the agent
side (beta Mimic); the parse-page link is web/main (works for everyone, but
the localhost URL only lands when you are running Mimic 3.4.1+).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.4.1 → **3.5.54**).
⏳ **No result recorded.** Replay is the cheapest way to exercise the 37 callouts
that just came alive with the 2026-08-09 anchor fix — replay a past Vex Thal
window and listen for the ones that were silent before.

**What it is:** Mimic's Triggers tab gains a **⏪ Replay** card — pick a watched
log + a time window and Mimic walks those lines back through your REAL trigger
engine (pattern, cooldown, suppression) and speaks the actual callouts, at
real-time or fast pace. Every fire is a rehearsal: tagged ⏪, nothing uploads
or relays, live cooldowns untouched. Each parse page links to it, prefilled
with that fight's window.

**✅ Solo (one machine)**
- **Replay a slice of last night's log → hear real TTS.** Open the Triggers tab,
  ⏪ Replay card. Pick your character's log, set From/To across a stretch that
  had callouts (a boss fight), leave pace on **real-time**, click **Start**. You
  should HEAR the real callouts fire in order, and see them flash with a **⏪**
  tag (rehearsal), never as plain live callouts.
- **Fast pace** for a quick audit: switch pace to **fast**, Start — fires come
  back-to-back with a short pause on each so you can hear every one quickly.
- **Journal shows replay rows.** After a run, the 🧭 checkpoint journal shows the
  fires with a gold **⏪ REPLAY** badge (click "see checkpoint journal ↓").
- **Nothing uploaded.** Note the upload-queue depth (⚙ Engine section) before and
  after a replay — it does NOT grow. A replay never posts a parse, chat, or
  timeline event; it does not move your live DPS/session numbers.
- **Parse-page link prefills the form.** On wolfpack.quest, open any parse and
  click **"⏪ Replay this fight locally"** — Mimic's dashboard opens on the
  Triggers tab with the log window prefilled (±30s pad). You still click Start.
- **Refused during a live fight.** Start a replay while a fight is actively being
  parsed — it refuses with a clear message (so a replay can't be mistaken for a
  live callout mid-raid). Also: start one replay, try to start a second while it
  runs — the second is refused ("already running — stop it first").
- **Stop works.** Start a long real-time replay, click **Stop** — it halts
  promptly and the card shows "⏪ Replay stopped".

---

## #82 — Quartermaster v1 (utility-kit coverage + quest checklist)

**Needs:** web **1.0.259** (live on Vercel) + SQL seed migration
`20260719160000` (applied). No bot / agent / Mimic change — reads
`character_gear`, `eqemu_items`, and the existing quest tracker
(`quest_catalog` / `quest_required_item` / `character_inventory`).

**Status (2026-08-09): ✅ live** — web ships straight to `main`, so this has been
public since 2026-07-19 (web now 1.1.35). It was never a beta item; it sits here
only because the batch did. ⏳ No result recorded.

**What it is:** a member-visible **`/quartermaster`** page. Board 1 = utility-kit
coverage (who owns the raid movers, with gaps). Board 2 = common-quest checklist
(your characters' progress + an officer "who's missing what" rollup), seeded with
the Emperor Ssraeshza key chain.

**✅ Solo**
- Open `/quartermaster` while signed in. Board 1 shows kit cards grouped by
  category; each has a real owner count (JBoots ~71, Shield of the Immaculate
  ~13, Puppet Strings ~11) and lists owners as `character (main)` links.
- A thin slot shows a coverage-gap line (e.g. a class-scoped `No Cleric owns …`
  or `Nobody owns …`) both inline and in the top "Coverage gaps" box.
- Board 2 "Your characters" matrix renders a row per active quest and a column
  per your linked character, with ✓ / `have/total` / — cells. A character with
  no inventory upload shows "no inv yet".
- The Emperor Ssraeshza key quest appears; with no Diaku pieces in visible bags
  it reads not-complete for everyone (honest — visible bags only).

**👥 / Officer**
- As an officer, the "🛡 Officer rollup — who's missing what" section appears
  under Board 2: per quest, `complete / assessed have it` (e.g. Storm Giant Toes
  6/18) and a capped "Missing (N): …" list. Non-officers never see it.
- Excluded characters (`exclude_inventory` / `exclude_from_stats`) appear on
  NEITHER board — pick a known opted-out character and confirm absence.

---

## #124 — Loot bidding shows your REAL OpenDKP balance

**Needs:** agent **3.4.2** (beta Mimic). No bot or DB change — the agent reads
OpenDKP's own standings directly with the OpenDKP login you already use on the
Loot bidding card (the token stays on your PC). Log into OpenDKP on the card
first.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.4.2 → **3.5.54**).
The OpenDKP sign-in path is **field-proven by daily use** — the 2026-08-09
bidding-panel work (see #121 below) all came out of real sessions against real
standings. ⏳ The specific "matches Current DKP to the number" comparison still
has no recorded result.

**What changed:** the DKP figure on the 💰 Loot bidding card used to be an
estimate our server pieced together from the OpenDKP mirror (ticks + adjustments
− loot), which could be well off — Hitya's family showed **−123** (and a
recompute **711**) when the real OpenDKP balance was **171**. It now comes
straight from OpenDKP's standings — your account's **Current DKP** — so it
matches the OpenDKP site to the number. If OpenDKP can't be reached for a moment
the card falls back to the old estimate, now clearly marked **"~est. (mirror)"**
so it's never mistaken for your real balance.

**✅ Officer / anyone with an OpenDKP login**
- **The card's DKP matches the OpenDKP site's Current DKP for your account.** Log
  into OpenDKP on the 💰 Loot bidding card, then compare the green
  **"💰 <n> DKP · account (OpenDKP)"** pill against your account's Current DKP on
  the OpenDKP standings page — they should be the SAME number (it's ONE pooled
  total for your whole family, not a per-character sum). Check a second account
  (e.g. another main) too.
- **Mirror fallback is obvious.** If you're NOT logged into OpenDKP (or it's
  briefly unreachable), the pill reads **"💰 ~<n> DKP · ~est. (mirror)"** with a
  leading `~` — never a green "account (OpenDKP)" label. Flag it if a `~est.`
  figure is ever shown as if it were real.

## #121 — Loot Bidding v2 + buff-queue class-picker defaults

**Needs:** agent **3.3.100** (beta Mimic) + bot **3.0.221** (live on Railway) +
web **1.0.252**. No DB change — bot reads the OpenDKP mirrors only. The Loot
bidding card needs you logged into OpenDKP (the token stays on your PC).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.100 →
**3.5.54**), and this is one of the few sections with a *real* verification
story — because a case below was **failing in the field and this ledger did not
catch it**:

> ⚠ **"Wishlist prune" (case 2) was BROKEN from the day it shipped.**
> `bid-history` seeded the already-won set from `wins` — an
> `opendkp_loot … order=fetched_at.desc&limit=100` query. Any family past 100
> awards (Hitya's has **187**) had the other 87 come back as "bid on but not yet
> won" *and* as Recent misses; the three reported items sat at rows 101, 120 and
> 184. Worse, `fetched_at` is the **mirror sync** time, so *which* 100 survived
> would reshuffle on every weekly sync. **A capped DISPLAY query must never
> double as a SET.** Fixed in bot **3.1.33** (2026-08-09) — the won-set is now
> its own uncapped `item_id`-only sweep and `wins` orders by `raid_id.desc` —
> pinned by `test/loot-won-set.test.js`. **Re-run case 2 on a family with 100+
> awards**; on a small family it passes either way, which is exactly why the
> written case never caught it. (`DECISIONS-2026-08-09` block in
> `DECISIONS-2026-08-07.md` → Loot bidding.)

**Shipped on this card since, with no test case written yet:** family auto-adopt
from OpenDKP on sign-in (wholesale when empty, additive otherwise; `⟲ from
OpenDKP` is the explicit replace path), loot history **hidden by default and
re-hidden on every load** (the dashboard gets screen-shared during raids — a
visible wishlist is a bidding tell), per-row ✕ dismissals that are **local-only**
(`logsync.lootdismiss.json`, always reversible via "restore all"), and an
expansion filter that opens on the current expansion derived from the newest
award.

**What changed (guild-lead field feedback — OpenDKP `vaporjesus`, main `Hitya`):**
1. Item names no longer 404 — they link to the OpenDKP raid page (or aren't
   links). 2. Wishlist hides anything the family already won (preregs keep ★).
   3–4. New full-width **Recent misses** table (bid & lost) with *character ·
   your last bid · last winning bid · last second-place bid · planned next bid
   (editable, saved locally) · DKP*. 5. Rows deep-link to the OpenDKP raid.
   6. **Family-pooled DKP** computed from the mirror (ticks + adjustments −
   loot), labelled by freshness. 7. Family (main + raid alts) auto-prefills the
   first time you log in (only when empty). 8. Expansion filter
   (Classic/Kunark/Velious/Luclin) + the panel is now full-width. Plus the
   buff-queue class picker lists ALL casters and defaults to your own class.

**✅ Solo (one machine)**
- **No dead item links.** Log into OpenDKP; on the 💰 Loot bidding card, click a
  wishlist / miss / win item name — it opens the OpenDKP raid page (or does
  nothing if it's a plain span), never a wolfpack.quest `/character/<word>` 404.
- **Wishlist prune.** An item you've WON on any family character does NOT appear
  in "your wishlist"; a prereg you set still shows with ★ even if won.
- **Misses table.** "Recent misses" spans full width with all six columns; the
  winning/second-place figures match the item's most-recent auction (not the
  auction you personally lost).
- **Planned bid persists.** Type a number in a miss row's **Planned** field,
  restart Mimic, reopen the card — the value is still there (stored in
  `logsync.plannedbids.json`).
- **Family prefill only-when-empty.** With NO family set, log in → your main +
  raid alts fill in automatically (main = your most-won character). Clear/edit
  it by hand and it stays edited — it never re-prefills over your changes.
- **Class picker.** The buff-queue "Buffing as" dropdown lists every casting
  class incl. **Necromancer, Wizard, Shadow Knight**, and defaults to YOUR
  class the first time (falls to "(any class)" until /who or Zeal has seen you);
  an explicit pick sticks.

**👥 Multi-person / officer**
- **DKP figures match OpenDKP.** Compare the card's family DKP (and a couple of
  raiders' via their families) against the OpenDKP standings page. It's a
  mirror-derived, family-pooled figure "as of the last sync" — if a number is
  off by more than a stale-sync's worth, flag it (the pooled-vs-per-character
  and the char_id→name MODE resolution are the two things to sanity-check).

---

## #119 — Pet-buff diagnostic card + liveness across watched logs + live-character identity

**Needs:** agent **3.3.99** (beta Mimic) + bot **3.0.220** (live on Railway). No
DB change. The fleet-table "Alt (Main)" label lights up once BOTH are deployed;
the diagnostic card and the /who 🐺-on-alt work with agent 3.3.99 alone.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.99 →
**3.5.54**). ⏳ No ✅/👥 result recorded. Note part 3 of this entry **supersedes
the "Known limit" paragraph in #111 below** — the heartbeat reports the live
character now, so the 🐺 lights on the alt you are actually online as.

**What changed (post-#117 field report + guild-lead identity ask):**
1. **Pet buffs STILL missing — it was a version gap, not a code bug.** The
   reporter's fleet row was agent **3.3.91**, below the **3.3.94** #117 fix, so a
   pre-fix runtime showed exactly the symptom (the pet's HP, no buffs). The
   resolver is fine: it disambiguates the 15 spells that share "looks stronger."
   by the **cast spell name**, and it handles Spirit of Eagle's possessive line
   ("Kabn's body pulses with an avian spirit."). To make the *next* report
   self-evident, there's a new **🐾 Pet-buff diagnostic card** on the dashboard
   **Triggers** tab (same idea as the 🐺 Charm diagnostic): it walks pet
   identified → cast seen → landing resolved → attributed → overlay fetch, with a
   resolution ring saying which resolver fired and why a land was dropped.
2. **Liveness now spans every watched log.** A boxer whose *primary* is logged
   out but who's actively playing an alt is now correctly treated as a **live**
   agent (any flowing log keeps the agent fresh) — the chat-reporter election and
   the fleet staleness dot follow. An agent with *no* active log anywhere still
   goes stale (unchanged).
3. **The fleet table + /who 🐺 name the character you're actually on.** The
   heartbeat reports the live character; the 📡 Reporters CHARACTER column shows
   "**Canopy (Hitya)**" (alt with the main in parens) while you're on the alt and
   the plain primary when idle, and the /who wolf lights on the alt you're online
   as, not just your primary. The main-in-parens honors the same officer
   `hide_main_names` list as #111.

**✅ Solo (one machine)**
- **Pet-buff diagnostic walks a live cast.** Charm or summon a pet, target
  something *other* than the pet, then cast a pet buff on it (e.g. Spirit of
  Eagle / a Strength line / Girdle of Karana clicky). On the dashboard **Triggers**
  tab the **🐾 Pet-buff diagnostic** card should show: **1. Pet identified ✓**
  (owner → pet, resolves), **2. Buff cast seen ✓** (your cast + the exact landing
  suffix EQ prints), **3. attributed ✓**, **4. overlay fetch ✓** (the buff the
  Pet tracker renders). The resolution ring shows the land as **attributed**. If
  any step is ✗, that's the checkpoint to report.
- **Play an alt → fleet shows "Alt (Main)" and stays fresh.** With Mimic tailing
  your main + an alt, log the main OUT and play the alt. Within a minute the 📡
  Reporters fleet row's CHARACTER cell should read "**Alt (Main)**", the fresh dot
  should stay **green** (the alt's live log keeps the agent fresh), and the **Log**
  age should track the alt's activity, not the logged-out main.

**👥 Multi-person (2+ raiders, separate machines)**
- **/who wolf on the alt actually online.** While you're playing an alt with
  Mimic running, have another raider `/who` your zone: the 🐺 should appear next
  to the **alt** you're on (not only your main), with "(Main)" in parens unless
  you're on the hide list. Fully idle (no recent log line) → the wolf falls back
  to your primary.

---

## #120 — Trigger TTS actually makes sound + byte-stable Triggers tab + no false "not signed in" flash

**Needs:** agent **3.3.98** (beta Mimic) + web **1.0.251** (roadmap/docs; live on
Vercel). No bot change.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.98 →
**3.5.54**). ⏳ No result recorded — and part 1 (**"trigger voice callouts were
silent on some machines"**) is the one row in this file that explicitly **cannot
be closed from the build container**: it is a Windows-only Chromium
user-activation condition and needs a field report. The self-serve instrument is
the 🧭 Trigger checkpoint journal's green "5b playback started" / orange "5b
playback FAILED" rows. Worth collecting now that 37 more callouts fire.

**What changed (three raid-night field reports):**
1. **Trigger voice callouts were silent on some machines** — the alert overlay
   flashed but nothing spoke, and Windows' volume mixer never listed Mimic at
   all (i.e. Chromium never opened an audio stream). Root cause: the trigger
   overlay is a passive, never-clicked window, so Chromium's user-activation
   gate silently blocked `speechSynthesis`. Mimic now relaxes that gate at
   startup (`autoplay-policy` switch) **and** grants the overlay document a
   synthetic user gesture, so speech + per-trigger sounds play. Dispatch was
   never the problem (suggested templates DO carry a spoken action) — the break
   was purely at playback. **Because this is a Windows-only Chromium condition
   it could not be reproduced in the build container — it needs field
   confirmation**, which the new instrumentation makes self-serve (below).
2. **The dashboard Triggers tab flickered every ~2s** — the "⚡ Recent fires"
   card was rendered inline with per-poll `fmtAgo` timestamps, so the whole
   section (guild table + trigger editor + suggested list) rewrote every poll.
   It now lives in its own `#wpRecentFires` placeholder card; the section HTML is
   byte-stable when nothing changes (proven by a two-idle-render byte-compare
   fixture).
3. **A red "Not signed in to Discord" banner flashed at signed-in users** — the
   signed-in flag required BOTH a session token AND a bot-confirmed identity, so
   the startup gap (agent boots token-less until Mimic re-pushes the session) and
   any identity blip flashed the banner. Now: a **grace window** holds the red
   banner until the signed-out state is sustained (~8s), and a token-present-but-
   unconfirmed state shows a calm blue **"Verifying your Discord sign-in…"** note
   instead.

**✅ Solo (one machine)**
- **Hear a trigger + prove the audio path.** Turn on **Trigger alerts (TTS)**,
  open the dashboard **Triggers** tab, enable a **Suggested trigger** (e.g.
  "Rampage on you"), then click **▶ Rehearse** on it. You should (a) **hear** the
  callout, (b) see **Mimic** appear in the Windows volume mixer (Sound settings →
  Volume mixer) — it stays listed for the session once audio has ever played, and
  (c) see a **green "5b playback started"** row in the **🧭 Trigger checkpoint
  journal** card. If the machine is still silent, that same journal shows an
  **orange "5b playback FAILED"** row with the reason (`not-allowed` / `silent`)
  — that's the field-diagnosis hook; report it.
- **Triggers tab doesn't flash.** Sit on the Triggers tab with at least one
  recent fire on screen and watch for ~10s: the recent-fires timestamps tick, but
  the tab must not visibly repaint/flash, and a half-typed personal-trigger edit
  must not reset.
- **No false sign-in banner.** While signed in, restart Mimic (or the agent) and
  watch the dashboard header: you should see at most a brief blue **"Verifying…"**
  note, **never** the red "Not signed in to Discord" banner. Sign out for real →
  after a few seconds the red banner appears as expected.

**👥 Multi-person (2+ raiders, separate machines)**
- On a live pull, confirm a **guild** trigger callout speaks on every raider's
  machine (it routes through the same overlay `speak()` path). Any machine that
  stays silent will now show an orange **playback FAILED** row in its own journal
  — collect those to spot audio-blocked installs.

## #91 — Roll-loot review: who actually loots + Hot Dice night + /rolls

**Needs:** agent **3.3.97** (beta Mimic) + bot **3.0.219** + web **1.0.250**
(both live on Railway/Vercel).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.97 →
**3.5.54**). ⏳ No result recorded.

**What changed:** Mimic now records the **"You have looted" line from your own
log** — the real answer to who ended up with a no-drop drop, since a re-roll or
a pass means the roll winner often isn't the looter. The site's new 🎲 **Rolls**
page (in the nav) lays out each roll night: every /random session with its
range, who rolled, the winning roll, and the person who actually **looted** it
shown beside the winner when they differ. 🎲🔥 **Hot Dice**: a perfect roll is
already called out live per-roll; now whoever out-rolls the room on **>20% of
the night's contested rolls** (≥5 contested, ≥2 rollers each) takes the night's
**Hot Dice crown**, computed at midnight and shown on `/rolls` and `/fun`.
**Nothing sensitive leaves your PC** beyond item name + your character + zone +
time — the same privacy posture as rolls.

**✅ Solo (one machine)**
- Loot anything from any corpse (`--You have looted a <item>.--` in your log).
  Within ~a minute the agent uploads it (durable queue → `POST /api/agent/looted`).
  It won't appear as its own card, but it becomes the attribution source below.
  Backfill check: run the agent with `--since` over an old log — old loots must
  **NOT** upload (the 30-min recency gate), so no stale loot floods in.
- Roll + loot in one sitting: `/random 0 100`, then loot the item you rolled on.
  On `/rolls`, that night's session shows your winning roll, and if you (or
  anyone) looted a matching item within ~10 min, the **Looted by** column fills
  in — showing a **different** name when the winner passed and someone else took
  it, or "winner" when the roll winner looted it themselves.
- `/rolls` gates behind sign-in (member scope) and shows an empty-state until a
  roll night is captured; `/fun` shows a 🎲 Hot Dice card linking through.

**👥 Multi-person (2+ raiders, separate machines)**
- Run an off-night loot raid with **≥2 up-to-date agents**. After midnight ET,
  check `/rolls`: the night should list every roll session (rolls merged across
  everyone who saw them, deduped), winners, and who looted what. If one person
  out-rolled the room on >20% of the contested sets, they wear the **Hot Dice
  crown** for that night (also surfaced on `/fun`). Re-running the night's math
  must not create a second crown (idempotent upsert).

## #113 — Extended Target: same-zone-targets-only option

**Needs:** agent **3.3.96** (beta Mimic) + bot **3.0.218** (live on Railway).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.96 →
**3.5.54**). ⏳ No result recorded. ⚠ Same overlay, different switch: the
production tuning map currently carries **`flag_ext_pos_off = 1`**, the officer
kill switch for the #194 engagement-index / position clustering in the Extended
Target aggregate (`index.js:10430`). It does **not** touch this same-zone toggle
— but while it is set, don't read a missing `[ext-pos]` cluster as a failure of
either feature, and note it must come OFF before the twin-add capture in
`STATUS.md`'s raid-night queue can produce anything.

**What changed:** the Extended Target overlay can now hide targets reported by
Mimics that are in a *different zone* from you, so a splinter group off in
another zone stops cluttering your raid's target list. It's a per-user toggle —
a **Same-zone targets only (default on)** checkbox in the dashboard's **Overlays**
tab — and it takes effect within a couple of seconds, no restart. The filter
runs on the bot (it already scopes the aggregation by zone); the agent just
tells the bot whether to. **Fail-open:** if we can't resolve your zone, or a
particular raider's zone is unknown, that data is shown, never hidden.

**✅ Solo (one machine)**
- Open Mimic → **Overlays** tab. The 🎯 **Extended Target options** card shows a
  **Same-zone targets only** checkbox, **checked** by default. Uncheck it, then
  reopen the dashboard (or switch tabs and back) — it stays unchecked. Re-check
  it — persists again. (Persisted in `logsync.optin.json`, so it survives a Mimic
  restart too.)
- With the box checked, the Extended Target overlay shows your current-zone
  targets as before — no regression to the count, HP, debuffs, off-tank/players
  toggles, or the ✕ per-row hide.

**👥 Multi-person (2 raiders, separate machines)**
- Two Mimic users in **different zones**. With **Same-zone targets only ON**
  (default) on each, neither sees the other's target in their Extended Target
  list (each list stays scoped to their own zone).
- Now both zone into the **same** zone and target different mobs — each raider
  sees the other's target appear in the list. Move one raider back to a different
  zone: their target drops off the other's list within a couple of seconds.
- Turn the toggle **OFF** on one raider while they're in a different zone from the
  other — they should now see the other raider's target again (all zones), while
  the raider who left it ON still sees only their own zone.

## #118 — In-console officer kill switches + Mimic version in the fleet table

**Needs:** agent **3.3.95** (beta Mimic) + bot **3.0.217** (live on Railway).
Officer-only — you must be signed into Mimic as an officer to see any of this.

> ### ⏳ STILL UNVERIFIED as of 2026-08-09 — and now confirmed, not assumed
>
> **Hitya, 2026-08-09: *"I have not messed with kill switches."*** The code has
> been live for the whole fleet for weeks (agent 3.3.95 → **3.5.54**), but
> **nobody has ever flipped one.**
>
> Corroborated against production the same day: the `overlay_tuning.tuning` row
> holds **exactly two keys — `hide_main_names` and `flag_ext_pos_off`**. None of
> the `_FLAG_OVERRIDE_KEYS` this panel writes has ever been set:
> no `flag_agent_kill`, no `min_agent_ver_num`, no `flag_shed_*`,
> no `flag_disable_budgets`, no `dedup_*`, no `flag_raid_hold`. (The one key that
> *is* set, `flag_ext_pos_off`, is **web-only** — not in this panel's whitelist —
> so it is not evidence the panel works.)
>
> **Treat the kill switch as an untested lever.** It is the thing you would reach
> for during a live incident, which is the worst moment to discover it doesn't
> round-trip. The solo cases below are ~5 minutes on a quiet night and would
> close both this and #74. **Do the `☠ AGENT KILL` case off-raid, not mid-raid.**

**What changed:** the `/admin/overlays` 🛑 **Kill switches** now live inside Mimic,
in the 🛡 **Admin** tab, so an officer can flip them mid-raid without opening the
web admin. Each whitelisted flag is a one-click toggle showing its current LIVE
value; `☠ AGENT KILL` asks you to type a confirm first ("this pauses EVERY
agent's uploads"); `min_agent_ver_num` is a small number field. The bot only
accepts the whitelisted control-plane keys — the free-form numeric knobs stay
web-only. Separately, the 📡 **Reporters** fleet table's **VER** column now shows
`agent/mimic` (e.g. `3.3.95/1.9.6`; standalone Parser.bat shows `3.3.95/—`), and
the **LOG** column gained a legend explaining the last-log-line staleness signal
and the fresh/stale dot.

**✅ Solo (one machine, officer)**
- Open Mimic → 🛡 Admin tab. The 🛑 Kill switches card renders with every flag at
  its real live value (a non-officer, or a signed-out agent, must see **no card
  and no data**). `dedup_chat` shows **OFF (0)** with the re-enable hint.
- Flip a **shed** flag (e.g. *Shed: fun events*) ON. Within ~60s, load
  `wolfpack.quest/admin/overlays` — the same flag shows checked. Flip it OFF in
  **either** place and confirm it clears in the other within ~60s. (Round-trips
  the same `overlay_tuning.tuning` row both ways.)
- Click `☠ AGENT KILL`. It must demand a typed confirm BEFORE writing. Confirm it,
  verify `/admin/overlays` shows it ON — then clear it and confirm the fleet
  **RESUMES cleanly** (uploads resume within one ~20s heartbeat; nothing dropped,
  the durable queue held).
- Set `min_agent_ver_num` to a value, Save — `/admin/overlays` shows the floor;
  clear it (0/empty) and confirm it unsets.
- 📡 Reporters table: your own row's **VER** shows `agent/mimic` with both
  versions when running under Mimic. The **LOG** column shows its legend line.

**👥 Multi-person (optional)**
- A second officer on beta Mimic appears in the fleet table with their own
  `agent/mimic`; a standalone Parser.bat agent (no Mimic) shows `<agent>/—`.

## #117 — Pet buffs on the Pet tracker + advisory buff-range hints

**Needs:** agent **3.3.94** (beta Mimic) + the `buffqueue.html` overlay in Mimic
**1.9.6** beta + bot **3.0.216** (live on Railway).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.94 →
**3.5.54**), split verdict on the two halves:
- **Pet buffs (part 1) — closest thing to a field confirmation we have.** The
  post-ship "still missing" report was chased in #119 and proved to be a
  **version gap, not a resolver bug**: the reporter's fleet row was agent
  3.3.91, *below* this 3.3.94 fix, so a pre-fix runtime showed exactly the
  reported symptom. No resolver change was needed. That is diagnosis, not a
  scored ✅ — but the failure it explains is accounted for.
- **Advisory buff-range hints (part 2) — ⏳ still unverified.** The 👥 range-chip
  case (>~200 units → dim + 📍) has no recorded result, and it needs a raid
  partner willing to run away mid-buff.

**What changed:** two things. (1) **Pet buffs now show on the Pet tracker.** A
single-target buff you cast on your *summoned* pet (Girdle of Karana, Aegolism,
Strength, etc.) used to vanish from the Pet tracker unless the pet happened to be
your live target the instant you cast — because those buffs aren't in the tracked-
buff list, the only way to attribute them is "we cast it and it named our pet,"
and the old code threw the landing away when your target had moved on. Now, when a
buff lands on a name we can prove is *your* pet, it's attributed no matter what you
had targeted. (2) **The buff queue now hints who's out of range.** Every raider's
position now rides the live feed, and a same-zone raider more than ~200 units from
you gets dimmed with a 📍 chip on the buff-queue overlay — a hint, never a removal.
Position updates at the live-state heartbeat, so treat range as advisory.

**✅ Solo (one machine)**
- Summon a pet (mage/necro/beastlord/druid warder). **Buff it with a single-
  target buff while targeting something else** (yourself, the mob, nothing) — cast
  e.g. Girdle of Karana / Strength / Aegolism on the pet. The **Pet tracker must
  now show that buff** with a countdown, not just the pet's HP.
- Repeat with the pet *targeted* when you cast — it must still show (regression
  check; that path always worked).
- Sanity: cast a single-target buff on **yourself or a groupmate** (not the pet) —
  it must NOT appear as a phantom pet buff on the Pet tracker.
- If you type **/pet report** in game, any buff the report lists should also appear
  (that path is the belt-and-suspenders source).

**👥 Multi-person (2+ machines) — needs a raid partner**
- Open the **Buff queue** overlay and pick your class. Have a same-zone raider who's
  missing one of your buffs **run well away from you (>~200 units)**: their row
  should **dim and grow a 📍 "likely out of range" chip** — but still be listed.
  When they run back into range, the chip clears within a heartbeat or two.
- **Fail-open check:** a raider whose position we don't have yet (just logged in,
  no fresh live-state) must show **normally** (never flagged out of range). A raider
  in a **different zone** is handled by the existing "same zone first" sort, not the
  range chip.

---

## #111 — /who overlay enrichment: 🐺 Mimic presence, aligned columns, anon levels, mains

**Needs:** bot **3.0.215** (live on Railway) + agent **3.3.93** (beta Mimic) +
the `who.html` overlay in Mimic **1.9.6** beta.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.93 →
**3.5.54**). ⏳ No result recorded, but the officer hide-list case has a real
value to check against: `overlay_tuning.hide_main_names` is live in production
and currently holds exactly **`Tildias,Serreth`** (verified 2026-08-09) — so
those two must show no main on anyone's /who, and adding/removing a third name
is the round-trip test.
⚠ **The "Known limit" paragraph at the end of this entry is OBSOLETE** — #119
(agent 3.3.99) made the heartbeat report the character you are actually playing,
so the 🐺 lights on the alt, not only on your `--character` primary. Read it as
history.

**What changed:** the in-game /who overlay's rows now carry four things. (1) A
🐺 next to any guildmate whose Mimic is running right now (their agent is a fresh
primary in the reporter registry). (2) Class and level are each in their own
left-aligned column that lines up down the list, instead of floating ragged after
the guild tag. (3) A guildmate who's /anon shows the level we know from our own
who history, rendered dimmed/italic so you can tell it didn't come from the game.
(4) Wolf Pack alts show their main in parentheses after the character name, from
`characters.main_name` — with a server-enforced privacy exception (`hide_main_names`
tuning key; seeded with **Tildias** and **Serreth**, who never show a main). The
bot supplies all four via the existing `who-lookup` endpoint; if the bot is
unreachable the overlay renders exactly as it did before.

**✅ Solo (one machine)**
- Run **/who** in a busy zone. The overlay's rows must line up in columns —
  every class in one column, every level left-aligned in the next — not drifting
  after the `<Guild>` tag.
- Your OWN row must show a **🐺** (your Mimic is running). If you're grouped with
  another Mimic user, theirs gets one too.
- Log an **/anon** alt whose level we've seen before and /who yourself: the level
  must appear **dimmed/italic** (our data), even though EQ printed no level.
- A Wolf Pack alt (with a `main_name`) shows **(Main)** after its name; a pure-PUG
  stranger shows neither a 🐺 nor a main.
- **Fail-open check:** quit Mimic's connection to the bot (or go offline) and /who
  again — rows still render (de-anon from local cache), just without the new 🐺 /
  main enrichment. Nothing should blank out.

**👥 Multi-person / officer**
- Two raiders on separate machines both running Mimic: each sees the OTHER's 🐺
  on their /who within ~a minute of both being live.
- **Hide list (officer):** add a name to `hide_main_names` in the `overlay_tuning`
  row (MCP/SQL update — comma-separated, e.g. `Tildias,Serreth,Newname`). Within
  ~60s (bot tuning cache) + the agent's who-lookup refresh, that character's **(Main)
  disappears** from everyone's /who while its 🐺 (if running Mimic) stays. Removing
  the name brings the main back.
- **Known limit:** the 🐺 tracks each agent's REPORTED PRIMARY character, so a raider
  running Mimic while playing an alt only lights up on the alt's row if that alt is
  their `--character`/first-watched log. Playing an unwatched alt → the 🐺 rides
  their primary's row instead. This is a registry-identity limit, not a bug.

---

## #116 — Overlay bug round: stale Spell Casting card + stuck setup chrome

**Needs:** agent **3.3.92** (beta Mimic). No bot change.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.92 →
**3.5.54**). ⏳ No result recorded.

**✅ Solo**
- **Stale casting card**: cast anything, then camp that character (or kill EQ).
  The Spell Casting card's entry must clear within ~a minute — no frozen
  "stopped N ago" card, no doubled border. Previously it lingered until restart.
- **Setup chrome teardown**: right-click the trigger alert box → Setup THIS →
  move it → Done. The blue outline + placeholder chrome must disappear
  immediately. Repeat exiting via 🔒 (lock) and via ✕ — chrome must tear down on
  all three paths, and the same applies to any overlay's Setup THIS.
- **#35 regression sweep** (was already functional, confirm): CH overlay drags
  by its ✥; the opacity slider changes the overlay backdrop live.

---

## #112 — Chat-election liveness + zone-spread (the 2026-07-19 chat-blackout fix)

**Needs:** bot **3.0.214** (live on Railway) + agent **3.3.91** (beta Mimic).

**The incident this fixes (real, 2026-07-19):** guild chat → Discord went dark
~6:43am–3:16pm. The single elected chat reporter's AGENT kept heartbeating while
its CHARACTER was logged out — so it stayed elected and saw no chat, and the 60s
TTL never noticed (the agent was alive). The PvP death feed (every agent uploads
it, no election) posted all day — the fleet was fine; only the one elected stream
died. **Mitigation currently in place:** `dedup_chat = 0` in the `overlay_tuning`
editor (everyone uploads chat, so nothing can go dark). This work makes
re-enabling `dedup_chat` safe.

> ### ✅ The re-enable procedure below HAS BEEN DONE — chat election is live now
>
> Verified against production 2026-08-09: **`overlay_tuning.tuning` no longer
> contains a `dedup_chat` key at all**, and the bot defaults it **ON**
> (`chat: Number(tune.dedup_chat) !== 0`, `index.js:13543`). So the mitigation
> described above is **no longer in place**, and one elected reporter per zone is
> carrying guild chat in production today. The ≥3.3.91 precondition is long met
> (fleet on **3.5.54**).
>
> ⏳ **The two test cases were never formally scored** — this is "the flag is
> unset, therefore the election is running", not a measured demotion or failover.
> The failure signal to watch for is a **repeat of the 2026-07-19 blackout**:
> guild chat silently stopping while the fleet looks healthy. If that happens,
> the instant fail-open is step 3 below — set `dedup_chat = 0` and everyone
> uploads again.

**What changed:** (1) the agent heartbeat now sends `last_line_ms` — how long
since it last processed a live log line from its PRIMARY character's tail (a
logged-out char tails nothing → it climbs). (2) Chat candidacy now requires that
to be **fresh** (< `reporter_liveness_max_ms`, default 90000); a stale reporter is
demoted like a camper. (3) Chat now elects one reporter **per zone** (redundancy;
the bot's 10s chat dedup collapses the duplicate posts) so one reporter logging
out never darkens chat. Fail-open throughout: older agents (no `last_line_ms`) are
treated fresh; if nobody anywhere is fresh, everyone stays eligible.

### Re-enable procedure (officer, do this once the fleet is on agent ≥3.3.91)
1. Confirm the raid's Mimics are updated (agent dashboard footer shows **3.3.91+**;
   the 📡 Reporters panel — see #115 — lists them with a **fresh** column).
2. On `/admin/overlays`, **delete the `dedup_chat` key** (or set it to `1`). Chat
   election resumes; only LIVE reporters are eligible, spread across zones.
3. If anything looks off, set `dedup_chat = 0` again — instant fail-open, everyone
   uploads (the current safe state).

### ✅ Solo (one machine) — *needs `dedup_chat` re-enabled to observe*
1. Log in, sit in a zone; on the agent dashboard the reporter line shows your
   chat role active and your log **fresh**.
2. **Log the character out** (leave Mimic running). Within ~20s the dashboard
   reporter line flips to **stale**, and within ~90s + one poll your chat role
   drops (you're demoted — no live log flow). Log back in → fresh again, role
   returns.

### 👥 Multi-person (2+ machines) — **needs a raid partner in another zone**
1. Two testers in **different zones**, `dedup_chat` on. Both should show as chat
   reporters (one per zone) — the bot's dedup means Discord still sees each `/gu`
   once.
2. One tester logs their character out. Their role drops within ~90s; the other
   zone's reporter keeps chat flowing the whole time — **no gap in #guild-chat**.

## #115 — Officer reporter control panel (📡 Reporters: swap / include)

**Needs:** bot **3.0.214** (live on Railway) + agent **3.3.91** (beta Mimic).
Officer OpenDKP/Discord identity linked in Mimic (same sign-in as the DKP tick
widget).

> ### ⏳ STILL UNVERIFIED as of 2026-08-09 — same finding as #118
>
> Live for the whole fleet (agent 3.3.91 → **3.5.54**), but **no officer has ever
> used it.** Production `overlay_tuning.tuning` carries no `reporter_pin_*` and
> no `reporter_extra_*` key — the only two keys in the row are
> `hide_main_names` and `flag_ext_pos_off` — so no swap and no include has ever
> been written. Hitya, 2026-08-09: *"I have not messed with kill switches"*
> covers this panel; it lives in the same 🛡 Admin tab and writes the same tuning
> map.
>
> The read-only half (seeing the fleet, zones, fresh dots, elected badges) is
> worth eyeballing on its own — it costs nothing and it is the instrument you
> would want during a chat blackout. Case 4 (**dead pin is safe**) is the one
> that matters most and is risk-free: pin an offline character and confirm the
> computed pick survives.

**What it is:** a 📡 Reporters card on the agent dashboard's **🛡 Admin** tab
(officer-only, same data gate as the DKP/loot widgets). It shows the live reporter
fleet (character · zone · group · agent version · camping · last-line age · fresh),
the elected reporter set per service (chat/buffs/roster), and any active pins. Per
service you can **swap** (pin a specific live character as the reporter) and **add
an include** (extra always-on reporter), or **clear** the override. Overrides are
tuning keys (`reporter_pin_<svc>` / `reporter_extra_<svc>`) so they survive
deploys and take effect within ~60s. A pinned name that is dead/stale is ignored
(fail-open — election proceeds normally); per-observer streams (mob/encounter)
can never be pinned.

### ✅ Officer (one person)
1. Open Mimic → **🛡 Admin** tab → **📡 Reporters**. You should see yourself (and
   any other live agents) with zone / fresh / elected badges. A NON-officer opening
   the same tab sees no Reporters panel at all.
2. **Swap:** pick another live character in the chat **swap** dropdown. Within ~60s
   the elected-chat badge moves to them (the pin is honored because they're
   live+fresh). Clear the override → it reverts to the computed pick.
3. **Include:** type a live character into the chat **add-include** box. They join
   the elected chat set on top of the computed pick (both report; dedup collapses).
4. **Dead pin is safe:** pin a character who is offline. The panel keeps the
   computed pick and the bot logs `pin … ignored — not live+fresh`; nothing breaks.

### 👥 Multi-person
1. With 2+ live agents, swap the chat reporter to a specific teammate and confirm
   in `#guild-chat` that relay is unbroken through the swap (dedup + fail-open).

---

## #94 / #92 — guild-rules ingest + family-aware attendance metrics

**Needs:** bot **3.0.213** (live on Railway) + web **1.0.244** (Vercel). No
Mimic/agent change.

> **Status (2026-08-09): ✅ live** (bot 3.1.34 / web 1.1.35). ⏳ No result
> recorded for the three cases — **and case 3 must be re-baselined before it is
> scored.** The RA denominator changed materially on 2026-08-08: RA is now
> measured against the ticks a member **could have attended**
> (`GREATEST(window_start, first_attended)`, per-family), where before every
> member was measured against all 1,492 guild ticks ever. That under-reported
> everyone who joined after the guild started, worst for the newest people —
> Gonner went **64% → 100%**, which matches ground truth (he has never missed a
> tick). Migration
> `20260808030000_attendance_denominator_member_floor.sql`;
> `DECISIONS-2026-08-07.md` → Attendance. **Do not compare the Family RA% table
> against any figure written down before 2026-08-08.**
>
> Related, so nobody re-litigates it: the leader's sheet says 41 raiders and ours
> says 64 — **both are right.** Theirs filters to ≥50% RA over 30 days; ours
> counts every raiding rank. Ours is not the recruiting number.

**Post-merge setup required:** (1) run `node deploy-commands.js`
(or the usual command-deploy) so `/ingestrules` registers with Discord; (2) set
`RULES_CHANNEL_ID`, `RAID_RULES_CHANNEL_ID`, `LOOT_RULES_CHANNEL_ID` in the bot's
Railway env (any left unset are skipped and reported).

**What it does (#94):** `/ingestrules` (officers only) reads the three rules
channels and stores each message as a row in the new `guild_rules` table.
Numbered rules ("12. Raid Kit …") get a rule number + title; anything else is
kept verbatim as a raw row so nothing is dropped. Re-running updates edited
messages in place and marks deleted ones inactive. The result is browsable at
`wolfpack.quest/admin/rules`. **(#92):** `/admin/attendance` now also shows a
family-aware **60d / 90d / lifetime RA% + tick counts** table (main+alts rolled
up), read from the `member_attendance_metrics` SQL view.

### ✅ Officer (one person)
1. **Ingest + view.** Run `/ingestrules`. The ephemeral reply should summarize
   each configured channel: `N rows · X numbered · Y raw · (Z deactivated) ·
   scanned M`. Open `wolfpack.quest/admin/rules` → the rules appear grouped by
   channel, numbered rules with a `#N` + title, non-numbered ones tagged **raw**,
   full body shown verbatim.
2. **Re-run is idempotent + tracks edits/deletes.** Edit a rule message in
   Discord (fix a typo), then delete a throwaway test message you posted. Run
   `/ingestrules` again: the edited rule's body updates on `/admin/rules` (no
   duplicate row), and the deleted message flips to **deactivated** (dimmed).
   Counts on the reply reflect the deactivation.
3. **Attendance metrics.** Open `wolfpack.quest/admin/attendance` → the new
   "Family RA%" table lists mains with 60d/90d/lifetime RA% (hover a cell for the
   `attended/held` tick counts). A known main and its alts appear as **one** row.

---

## #95 / #93 — Raid Kit readiness (rule 12) + comp templates & sign-up gap matcher

**Status (2026-08-09): ✅ live** (web on 1.1.35 — this shipped straight to `main`
2026-07-18 and was never gated on a beta install). ⏳ No result recorded for any
of the five cases.

**Needs:** web **1.0.245** (Vercel). No bot/Mimic/agent change. Migration
`20260719140000_comp_templates` auto-applies on merge (already applied to prod
via MCP). Data prerequisites: Raid Kit reads the Quarmy **gear** snapshot the
agent already uploads (so a character needs a `…Quarmy.txt` export on file); the
comp matcher's *planned* side reads RaidHelper `rh_signups` (run `/scanraidhelper`
or the RH API sync first — the table is otherwise empty and the matcher renders
with nothing to match).

**What it does (#95):** a 🎒 **Raid Kit** card on `/character/[name]/gear` and an
officer roster board at `/admin/readiness` check raid **rule 12** — a 100
magic-resist floor from worn gear plus a utility checklist (Enduring Breath,
Levitate, self-invis, self-port, and the Necro coffin). MR is the only hard check
and only when a gear snapshot exists; utilities are *covered / not-detected*,
never a red fail. **(#93):** officers author named target compositions at
`/admin/comp` (validated JSON + live preview), and `/admin/signups` gains a
🧩 **Comp vs template** panel that diffs a template against an event's "Going"
signups — role/archetype gap deltas — plus a live-roster "actual" column when a
raid ran during the event window.

### ✅ Member (one person)
1. **Your Raid Kit card.** Open `wolfpack.quest/character/<yourname>/gear`. If you
   have a gear snapshot, the 🎒 card shows your worn **MR** (green ≥100 / red
   below) and the four utilities as ✓ covered (with the source item/spell) or
   ○ not-detected. A blank utility must read as "not detected", never a red fail.
2. **No-snapshot honesty.** Open a character with no Quarmy export → the card says
   "no gear snapshot", **not** a failing MR. Confirm a class self-buff shows
   (e.g. a Druid reads self-covered for all four) even with sparse gear.

### ✅ Officer (one person)
3. **Readiness board.** Open `wolfpack.quest/admin/readiness`. One row per roster
   raider; anyone actually below the 100 MR floor sorts to the top; raiders with
   no export read "no gear snapshot"; opted-out characters show "opted out". The
   header links `/admin/rules`.
4. **Author a template.** At `wolfpack.quest/admin/comp`, edit the starter JSON
   (or write your own), watch the live preview update the per-archetype demand,
   and Save. Break the JSON (delete a brace, use archetype `"dps"`) → Save is
   disabled and the errors list what's wrong.
5. **Match a raid.** On `wolfpack.quest/admin/signups`, open an event with signups,
   pick your template in the 🧩 panel → confirm the gap chips ("Need N more
   healer", "M over on melee DPS") and the archetype table (Need / Signed / Δ).
   If a raid ran during the event window, a **Live** column appears from the
   raid_roster snapshot; otherwise the panel notes there's no snapshot in window.

---

## #110 — OpenDKP audit-trail reconciliation (deletions propagate to the mirror)

**Needs:** bot **3.0.212** (live on Railway). No Mimic/agent change.

**Status (2026-08-09): ✅ live** (bot on 3.1.34). ⏳ No result recorded.
⚠ Adjacent open item, same sync: `opendkp_raids` / `opendkp_auctions` still
re-upsert closed raids on every pass (1.5M and 3.7M updates). The decision — only
re-upsert when the upstream `Version` moves — is made but **not implemented**
(`DECISIONS-2026-08-07.md` → Storage / data). It does not affect this test.

**What it does:** when an officer **deletes or edits loot in OpenDKP**, that
change now propagates to our Supabase mirror (`opendkp_loot`) instead of
lingering as a ghost on wolfpack.quest's parses/loot surfaces. Each OpenDKP →
Supabase sync (every 30 min, or on-demand via `/syncopendkp`) re-pulls only
**recent raids'** loot and removes any mirrored award that no longer exists
upstream. Driven by the OpenDKP audit trail as a trigger; the sync log prints
one line per removed ghost.

### ✅ Officer (one person, needs OpenDKP officer access)
1. **A deleted award disappears within one sync cycle.** In OpenDKP, open a
   recent raid (within the last 14 days), award a throwaway test item to a
   character (e.g. "Backpack" → your alt for 1 DKP), and let the next sync mirror
   it (or run `/syncopendkp` — you'll see loot rows written). Confirm the item
   shows on `wolfpack.quest` (the raid's loot / a character's wins). Now **delete
   that award in OpenDKP**, then run `/syncopendkp`. The reply's **Reconcile
   (#110)** line should read `1 ghost loot removed`, and the item should be **gone
   from wolfpack.quest** — no manual mirror edit needed. Re-running `/syncopendkp`
   a second time reports `0 ghost loot removed` (idempotent). *(Railway logs show
   the `[opendkp-reconcile] removed ghost loot: …` line for the audit trail.)*

---

## #109 — Mimic dashboard restructure (Me card + officer Admin menu)

**Needs:** agent **3.3.90** (beta Mimic) · NO bot change.

**What it does:** two changes to the Mimic dashboard. (1) The Dashboard tab now
opens on a **🐺 Me** card instead of the logsync/status wall — your current
character + zone, a compact line of your buffs, the characters Mimic is watching,
your last few tells (local — they never leave your PC), and your last few fights
(with a jump to the parse), plus a big **Open /me ↗** button to wolfpack.quest/me.
The engine/sync details (files being read, upload queue, session counts, reporter)
didn't go away — they're tucked into a collapsed **⚙ Engine** section right below
the Me card. (2) Officers get a new **🛡 Admin** tab that gathers the officer
tools — DKP ticks, loot capture, "Post for bidding" — into one place with quick
links to the wolfpack.quest admin pages. Non-officers don't see the tab at all.

**Where to look:** the top of the **Dashboard** tab (🐺 Me card + ⚙ Engine), and
— officers only — the **🛡 Admin** tab in the nav row.

### ✅ Solo (one machine)
1. **Me card shows your character.** With a character logged in (Zeal running),
   the 🐺 Me card names your character, your zone, and a compact buffs line. Your
   watched characters, recent tells, and last fights all populate. **Open /me ↗**
   opens your wolfpack.quest/me page.
2. **Engine section persists open/closed across polls.** The ⚙ Engine section is
   collapsed by default. Expand it — it should show the setup checklist, files
   tailed, upload queue, and session counts — then leave it open and watch a few
   2-second refreshes go by: it must **stay open** (the wpKeep rule; a plain
   `<details>` would snap shut every poll). Collapse it again and confirm it stays
   collapsed across refreshes too.
3. **Non-officer sees no Admin tab.** On a non-officer account (or not signed in),
   there is **no 🛡 Admin tab** in the nav row at all — not just hidden, absent.

### 👥 Multi-person / officer
1. **Officer sees the Admin tab collecting the officer tools.** On an officer
   account, a **🛡 Admin** tab appears. Open it: it collects the **🎫 DKP ticks**
   and **💰 Loot capture** cards (these moved here from the Info tab) plus quick
   links to /admin/overlays, /admin/triggers, /admin/encounters. Run a DKP tick /
   review a captured loot list from here exactly as before — same controls, new
   home. Confirm a **non-officer** partner still has no Admin tab.

**Status:** ~~⏳ awaiting verification~~ → **2026-08-09: ✅ live for the whole
fleet** (agent 3.3.90 → **3.5.54**), ⏳ **still unscored.** The 🐺 Me card and the
🛡 Admin tab are the daily-driver surfaces now — the loot-bidding and DKP-tick
work all happens inside them — so the *structure* is exercised constantly even
though nobody ticked these boxes. The one case still worth running deliberately
is #2 (⚙ Engine stays open across polls), because it is the `wpKeep` rule and a
regression there is silent.

---

## #108 — Loot bidding dashboard element (Mimic)

**Needs:** agent **3.3.89** (beta Mimic) · bot **3.0.211** (live on Railway).

**What it does:** the agent dashboard now has a **💰 Loot bidding** card (with a
**BETA** tag) where you can place your sealed OpenDKP bids without leaving the
game. It's gated: you have to log into your OpenDKP account in Mimic first —
until you do, every bid box is locked and you'll see "Log into OpenDKP to enable
bidding." Your login stays on your PC and is never uploaded. Once you're in, open
auctions show up (both what an officer just called in chat AND the real OpenDKP
auctions), each with the item's last winner + runner-up, a bid box, and a **+1**
button that pre-fills the previous runner-up + 1 (you still click Bid — it never
bids for you). You set your main + alts once in the little ✎ characters editor,
then pick who you're bidding as per bid. When you're logged in it also shows your
own recent wins and your wishlist, tagging each item as a real prereg or one it
learned from your past bids.

**Where to look:** the **💰 Loot bidding** card near the top of the agent
dashboard. If you're not connected to the bot (no token in Mimic Settings) the
login won't work — set your token first.

### ✅ Solo (one machine)
1. **The gate blocks until you log in.** Fresh install / logged out: the card
   shows "🔒 Log into OpenDKP to enable bidding" and any auction row shows
   `🔒 locked` instead of a bid box. Click **Log in to OpenDKP**, enter a WRONG
   password → you should see "incorrect username or password" and stay locked.
   Enter your REAL OpenDKP username + password → the banner flips to a green
   `● OpenDKP <you>` line and bid boxes appear.
2. **Family editor persists across restart.** Click **✎ characters**, set your
   main and add an alt or two, **save**. Close Mimic completely and reopen it →
   your main + alts are still there and the "bidding as" picker lists them.
3. **+1 prefill shows runner-up + 1.** With an item that has bid history, click
   its **+1** button → the bid box fills with the previous runner-up + 1 (or, if
   the runner-up wasn't recorded, the last winning bid + 1 — hover the button to
   see which). It should NOT submit — you have to click **Bid**.
4. **A called drop lights the panel up.** In `/rs` post a drop list (as in the
   #107 test). Within a few seconds the item appears in the Loot bidding card
   marked `(called)` with a countdown, even before an OpenDKP auction exists.
5. **Log out re-locks.** Click **log out** → the gate returns and bid boxes lock
   again.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Two users see the same live auction.** With an OpenDKP auction open, both
   logged-in raiders see the same item(s), the same last-winner/runner-up, and
   can each place a bid from their own Mimic.
2. **Sealed bids stay sealed.** Neither raider can see the other's bid amount in
   the panel — only their own bids appear under "your open bids" (the values ride
   the encrypted place-bid path; nobody sees a competitor's number).

**Status:** ~~⏳ awaiting verification~~ → **2026-08-09, split verdict:**
- **✅ Solo path is field-proven by daily use.** This card is in real service —
  the whole 2026-08-09 bidding round (the capped-query "already won" bug, family
  auto-adopt from OpenDKP, hidden-by-default loot history, local-only
  dismissals) came out of live sessions against real standings, not a test plan.
  The OpenDKP login gate, the family editor and the wishlist all work in anger.
- **⏳ The 👥 cases are still unverified**, both of them — and case 2 (**sealed
  bids stay sealed**) is the one with real consequences if it is wrong. It needs
  a genuine open auction plus a second bidder and has never had one.

---

## #107 — Loot-post TTS + auction countdown chips + trigger overlay auto-grow

**Needs:** agent **3.3.88** (beta Mimic) · NO bot change (web **1.0.241** is
roadmap copy only).

**What it does:** when an officer posts a drop list in guild or raid chat, every
raider's Mimic now speaks it locally — "Loot posted, 3 items, bids open 2
minutes" (item count, not the list) — and drops a gold countdown chip on the
trigger overlay that ticks down the auction like a Death Touch timer (with a 15s
warning). The window length comes from the bid call ("2 min", "90s") or a
default you set. Re-posting the same items resets the clock instead of stacking a
duplicate; each separate drop gets its own chip; any chip can be dismissed with
its ✕. Separately, the trigger overlay now grows on its own to fit its content
(timers + pinned callouts + loot chips), so the buttons along the bottom stop
getting cut off.

**Where to look:** the agent dashboard Triggers tab has a new **💰 Loot auction
announce** card (toggle `lootAuctionTts`, default ON + a default-duration knob).
The callout also needs **Trigger alerts (TTS)** on (it shares that voice). The
chip appears on the trigger-alert overlay alongside any Death Touch / debuff
timers.

### ✅ Solo (one machine)
1. **Hear the announce + see the chip.** With Trigger alerts (TTS) ON and the
   loot toggle ON, in `/rs` (to yourself is fine) post a fake drop list, e.g.
   `Cloak of Flames, Ring of the Ancients, Short Sword of the Ykesha`, then a
   separate line `bids open 90 seconds`. You should HEAR "Loot posted, 3 items,
   bids open 1 minute 30 seconds" and SEE a gold `💰 Loot bids (3)` chip counting
   down from 1:30 on the trigger overlay, warning at 15s.
2. **Default duration when none is stated.** Post just a drop list with no bid
   call (`Fungus Covered Scale Tunic, Reaper of the Dead`). The chip should use
   your configured default (120s out of the box) and the voice should say "bids
   open 2 minutes".
3. **Repeat post RESETS, doesn't stack.** Re-post the SAME item list ~30s later.
   The existing chip's clock should jump back up (reset) — you should still see
   exactly ONE chip for that set, and NOT hear a second announce.
4. **Distinct posts stack.** Post a different drop list while the first chip is
   still live → a SECOND chip appears (concurrent auctions are real).
5. **Dismiss with ✕.** Hover a loot chip (overlay can be locked/click-through)
   and click its ✕ — the chip goes away immediately and does not come back on
   the next poll.
6. **Toggle OFF = silent.** Turn the dashboard 💰 Loot auction announce toggle
   OFF, post a drop list → no voice, no chip. Turn it back ON.
7. **Overlay grows / shrinks + honors grow direction.** With several timers +/or
   loot chips live, confirm the trigger window grows tall enough that its bottom
   controls (feedback vote buttons, sticky ✕, loot-chip ✕) are never clipped, and
   shrinks back when they clear. Right-click the ✥ move icon → toggle **⬆ Grow
   upward** and repeat: grow-down should keep the top edge fixed, grow-up should
   keep the bottom edge fixed and move the top up. The ✕ hide + ✥ move buttons
   stay reachable at every size.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Both clients announce locally, exactly once.** One raider posts a drop list
   in `/rs`. BOTH raiders (each running beta Mimic with the toggle on) should
   hear the announce and see the chip on their own overlay — driven off their own
   local log tail, no relay. Neither should hear it twice (multibox second-log
   copies reset silently).

**Status:** ~~⏳ awaiting verification~~ → **2026-08-09: ✅ live for the whole
fleet** (agent 3.3.88 → **3.5.54**), and this one has a **real field failure
still open**:

> ⚠ **No "Loot posted" TTS at 23:13 ET on 2026-08-05.** Both halves of the
> pipeline are built and deployed — the bot rings `_recordLootPosted`, the agent
> consumes it in `_consumeLootPosted` — so the miss is almost certainly one of
> two gates (`_optinState.lootAuctionTts === false`, or the staleness check), and
> **only the person who missed it can say which**. Open in `STATUS.md` → 🔴
> Raid-night queue, item 5. Until that is resolved, treat solo case 1 as
> **FAILING in the field**, not unverified. Everything else here is unscored.

## #106 — Multiplexed agent poll (six GET loops → one) + encounter-burst jitter

**Needs:** bot **3.0.210** (live on main) · agent **3.3.87** (beta Mimic).

**What it does:** the agent used to run six independent GET loops against the bot
(recent-fires 1.5s, overlay-tuning 90s, guild-triggers 2min, backfill 5min,
ui-edits 5min, character-prefs 10min). It now runs ONE loop hitting a single
`GET /api/agent/poll` bundle — recent-fires + tuning every tick, the slow streams
folded in only when due — so a 60-raider room drops from ~six per-client request
streams to one. On fight end a real encounter's upload is delayed by a
deterministic `hash(uploader) % 15s` to flatten the ~90MB-at-60 simultaneous
offer (solo/duo small parses skip the delay so the dashboard card stays instant).
It's **fully fail-safe**: an older bot 404s the new route and the agent falls back
permanently to the individual loops, and dormancy/kill-switch semantics are
preserved (while paused the loop asks for the tuning/kill stream ONLY).

**Where to look:** the agent dashboard at `http://localhost:7777` — Triggers tab
(journal + fires) must keep working exactly as before; `/api/state` now carries a
`poll: { mode, streams, lastOkAt }` block (mode `multiplexed` normally,
`fallback` against an old bot).

### ✅ Solo (one machine)
1. **Dashboard still shows triggers + fires (new bot + new agent).** With bot
   3.0.210 and agent 3.3.87, open the dashboard and confirm the Triggers tab
   journal populates, guild triggers load, and a self-fired trigger still shows —
   i.e. the streams that used to be six loops all still arrive over the one poll.
   `/api/state` `poll.mode` reads `multiplexed`.
2. **Tuning/notices/raid-hold still land.** Change an officer knob or post a Mimic
   Mail notice on `/admin` → it reaches the agent within ~1.5–90s as before (now
   via the poll's `tuning` stream).
3. **Solo/duo parse feels instant.** Parse a short solo fight → the dashboard's
   recent-parse card appears immediately (small payload + empty queue → jitter
   bypassed). A big raid fight may take up to ~15s to card (the jitter) — expected.
4. **Kill switch still works over the poll.** Flip ☠ AGENT KILL (`/admin/overlays`)
   → the agent goes dormant within ~20s and, while dormant, the poll asks for the
   tuning/kill stream only; clearing it resumes within a heartbeat (as in #74).
5. **Forced-404 fallback** — *code-review-only note* (no safe way to force in
   normal play): pointing the agent at a bot without `/api/agent/poll` makes the
   first poll 404 (or return the catch-all `OK`), the agent logs the permanent
   fallback once, and the individual loops resume for the rest of the process.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Cross-client fires still arrive <2s during a fight.** One raider fires a
   guild trigger; the other hears/sees the relayed callout within ~1–2s — the
   multiplexed poll preserves recent-fires latency (still a 1.5s cadence).

**Status:** ~~⏳ awaiting verification~~ → **2026-08-09: ✅ effectively proven in
production, by running.** Every agent in the fleet is ≥3.3.87, so
`GET /api/agent/poll` is the *only* poll path anything uses — `poll.mode:
multiplexed` is normal operation, and solo cases 1–2 (triggers/fires/journal
still arrive; tuning and notices still land) are exercised continuously by every
raider on every raid night. The permanent-fallback path (case 5) stays
code-review-only by design.
⏳ **Genuinely unscored:** case 3 (the `hash(uploader) % 15s` encounter jitter —
nobody has timed a big-raid card against a solo one) and case 4 (kill switch over
the poll), which is blocked behind #74/#118's untested kill switch. The 👥
cross-client relay-latency case has no recorded number either.

---

## #74 — Guild control plane: agent kill switch + version floor + beta hot-swap

**Needs:** bot **3.0.209** (live on main) · agent **3.3.86** (beta Mimic 1.9.6) ·
Mimic beta build (LKG rollback + beta-channel hot-swap).

**What it does:** officers get a fleet-wide **kill switch** and a **version
floor** on `/admin/overlays` → 🛑 Kill switches, served over the agent's 20s
reporter-poll (and the 2-min guild-trigger backup). Beta Mimic installs now
**hot-swap along the beta agent line** via the per-channel manifest, guarded by
crash-loop **auto-rollback to last-known-good**. **⚠ Policy semantics are
conservative v1 — Hitya to sign off before relying on kill/floor in a real raid.**

### ✅ Solo (one machine)
1. **Kill switch pauses the fleet, cleanly.** On `/admin/overlays`, check
   **☠ AGENT KILL** and Save. Within ~20s the agent dashboard shows the banner
   **"⏸ Agent paused by guild control plane"**, the upload queue **stops
   draining** (watch the queue chip: pending count holds, doesn't climb-then-
   drain), and the agent log prints `[control] flag_agent_kill → DORMANT`. Confirm
   your **overlays keep working on local data** (HUD/threat still update in a
   fight — nothing blanks). Uncheck + Save → within one heartbeat the banner
   clears, `[control] flag_agent_kill → resumed` logs, and the held queue drains.
   **Nothing should be lost.**
2. **Version floor stands down an old agent + nudges update.** Set
   **`min_agent_ver_num`** to a number just ABOVE your running agent (its numeric
   form is `major*10000+minor*100+patch`, e.g. running 3.3.86 → set `30387`).
   Save. The dashboard shows **"Your agent is below the guild minimum — update via
   [U]"**, uploads stand down exactly like the kill switch, and the log prints
   `[control] min_agent_ver_num → 30387 … BELOW floor`. Clear the field + Save →
   resumes. Set the floor at/below your version (e.g. `30386` on 3.3.86) → **no**
   stand-down (at-floor is fine).
3. **Fail-open regression:** stop the bot (or point Mimic at a bad URL) while a
   kill was NOT set — the agent keeps running normally (never goes dormant on a
   bot outage).
4. **LKG rollback (harder to force safely):** if a bad agent ever ships to beta
   and crash-loops right after a hot-swap, Mimic auto-reverts to `index.lkg.js`,
   the tray/dashboard shows **"reverted to last-known-good"**, and it won't
   re-offer that version until a newer one ships. Observe via the agent log
   (`[mimic] CRASH-LOOP after hot-swap … reverted to last-known-good vX`). No safe
   way to force in normal play — verified by unit test + code review.

### 👥 Multi-person
- **Beta hot-swap via the channel manifest.** With ≥2 beta Mimic testers on the
  beta channel: bump the agent on `beta` (this round → **3.3.86**). Each beta
  Mimic, on its next `latest-version?channel=beta` poll, hot-swaps the agent in
  place (window stays up, no installer) to the new beta agent — confirm the agent
  dashboard footer version ticks up without anyone reinstalling. Previously beta
  builds only got a new agent bundled inside a full beta installer.
- **Kill switch across the raid:** one officer flips ☠ AGENT KILL; every tester's
  dashboard should show the pause banner + stop uploading within ~20s, and all
  resume within a heartbeat when cleared.

**Status:** ⏳ **STILL UNVERIFIED as of 2026-08-09, and the sign-off never
happened.** Three things, all confirmed rather than assumed:
1. **The kill switch and the version floor have never been used.** Hitya,
   2026-08-09: *"I have not messed with kill switches."* Production
   `overlay_tuning.tuning` has never carried `flag_agent_kill` or
   `min_agent_ver_num` — the row holds two unrelated keys. The **"⚠ Policy
   semantics are conservative v1 — Hitya to sign off"** caveat above therefore
   **still stands, unchanged, weeks later**. Nothing should depend on this lever
   in a real raid until solo cases 1–2 have been run once, off-raid.
2. **The 👥 beta hot-swap case has effectively no testers.** Beta adoption is
   ~zero: nine beta builds shipped 2026-08-07 and only stable-channel agents
   ever reported. The per-channel manifest is *built* and stable installs update
   fine, but "beta Mimic hot-swaps along the beta agent line" has not been
   observed on more than a token install.
3. **LKG rollback (case 4) remains unit-test + code-review only**, as written —
   no safe way to force it. That is still the right call.

---

## #73 — Admission-control 429/Retry-After honored by the durable queue

**Needs:** agent **3.3.85** (beta Mimic 1.9.6) · bot **3.0.208** (live on main).

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.85 → **3.5.54**,
so the Retry-After honoring is universal now — the "don't enforce until the fleet
is on ≥3.3.85" warning below is satisfied). ⏳ **The 429 path has never been
exercised in production**: no `budget_*` key and no `flag_disable_budgets` has
ever appeared in `overlay_tuning.tuning` (verified 2026-08-09), so no uploader
has ever been rate-limited. The solo case is self-contained and safe — `rolls` is
low-volume — but remember to clear both keys afterwards.

**What it does:** the bot can now rate-limit a runaway/crash-looping uploader
per-endpoint (per-uploader budgets, off by default for durable data). When it
does return a **429 + `Retry-After`**, the agent's durable upload queue treats
it as backpressure: it backs off for exactly the time asked (capped at the
existing 10-min ceiling) and **re-sends — nothing is dropped**. (429 was already
retryable pre-3.3.85; this makes the wait precise and stops a rate-limited durable
upload from being shunted to the 30-min poison-park lane.)

### ✅ Solo (one machine)
1. **Force a tiny budget on a durable kind and watch the queue back off, then
   drain — nothing lost.** On `/admin/overlays`, set `budget_rolls_per_min = 1`
   **and** `budget_enforce_rolls = 1` (rolls is a low-volume durable kind, safe
   to squeeze). Trigger 2–3 `/random` roll uploads within a minute. Expected: the
   first lands; the next get a **429** and sit in the agent's queue (dashboard
   shows "⏳ N queued"); within a minute they **drain on their own** with no
   permanent-drop. Confirm the roll rows all eventually appear — **zero data
   loss**. Then clear both keys (or set to 0) to restore.
2. **Kill switch works.** With the budget keys still set, add
   `flag_disable_budgets = 1` → uploads stop 429ing immediately (within the 60s
   tuning cache). Remove it to re-enable.

> Do NOT set `budget_enforce_<kind>=1` on a busy raid night until the fleet is on
> agent ≥3.3.85 — older agents still retry a 429 (no data loss) but on the blunt
> exponential ladder rather than the honored Retry-After.

---

## #105 — Richer per-fight timeline: slow on/off · mob self-heal · disc usage

**Needs:** agent **3.3.84** (beta Mimic 1.9.6) · web **1.0.239** (live on main,
for the colored ticks + legend). No bot change — `encounter_events` ingest is
generic over kind/subtype.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.84 →
**3.5.54**; web 1.1.35). ⏳ No result recorded for any of the four cases. The
fight-timeline surface itself has been reworked since (the HP-curve series +
binding fix, 2026-08-09) — worth re-checking that the three tick types still
render with their legend rather than assuming.

**What it does:** three new event types join the existing `/parses/[id]` fight
timeline (#98), each a distinctly-colored tick with a legend:
- **Slow on / off** (gold / amber) — a known slow (shaman Turgur's/Togor's/…,
  enchanter Forlorn/Tepid Deeds/…) landing on the fight target marks a **slow
  on**; when its estimated duration runs out mid-fight it marks a **slow fell
  off** warning. Slows still up at the kill emit nothing.
- **Mob healed** (green) — the boss's HP bar rising for the same target (a heal
  add or a self-heal) marks a **Mob healed (+N%)** tick. Guardrailed against
  target-swap false positives (same name required, ≥5% rise, ≥10s debounce).
- **Disc** (purple) — a defensive/evasive/precision/aggressive discipline emote
  marks who dropped a disc and when (third-person **and** self attributed).

**Where to look:** `wolfpack.quest/parses/<id>` → the **🕒 Fight timeline** card.

### ✅ Solo (one machine)
1. **Self-disc shows.** Drop a discipline (e.g. Defensive) during any fight you
   parse → your next parse's timeline shows a purple **Disc** tick attributed to
   you at that moment.
2. **Slow on/off (if you can slow).** On a shaman/enchanter (main or alt), slow
   the mob → a gold **Slow on** tick appears; if the mob outlives the slow, an
   amber **Slow off** tick appears at the estimated expiry. A slow that's still
   up at the kill leaves no off-tick.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Mob heal on a real boss.** On a boss that self-heals or has a healer add,
   watch for a green **Mob healed (+N%)** tick on the parse timeline at the heal
   moment.
2. **Cross-uploader dedup holds.** With several raiders uploading the same
   fight, each new event type collapses to ONE tick per moment (the read-side
   3s dedup keys on kind+subtype+actor) — no doubled slow/disc/heal ticks.

---

## #76 remainder + #103 — Callout trust infrastructure + CH chain "0X GO"

**Needs:** agent **3.3.83** (beta Mimic 1.9.6) · web **1.0.238** (live on main,
for the officer sticky checkbox). No bot change — the relay already carried the
original fire timestamp end-to-end.

**Status (2026-08-09): ✅ live for the whole fleet** (agent 3.3.83 →
**3.5.54**). ⏳ No result recorded, but two of these five became load-bearing
instruments rather than features, and are used constantly now:
- the **🧭 checkpoint journal** (part 1) is the standard answer to "why didn't my
  trigger fire?" and gained the `5b playback started/FAILED` rows in #120;
- **▶ Rehearse** (part 2) is how a pattern gets proven without a raid — the
  fastest way to confirm the 2026-08-09 anchor fix on any of the 37 revived
  callouts is to Rehearse one and watch the journal reach *pattern matched*
  instead of *pattern not exercised*.
The **📌 Sticky**, **ghost-callout TTL** and **CH "0X GO"** cases are the ones
with no evidence at all.

**What it does (five parts):**
1. **Trigger checkpoint journal** — a "why didn't my trigger fire?" panel on the
   dashboard Triggers tab (🧭 *Trigger checkpoint journal*). Each candidate
   evaluation records how far it got — *line seen → pattern matched → gates
   passed → actions built → dispatched → relayed* — and, when it stopped short,
   why (cooldown remaining, suppressed by your charm pet, roster-suppressed,
   stale-skipped). In-memory only, never uploaded.
2. **Real REHEARSE** — the per-row **▶ Rehearse** button (was "Test") no longer
   fakes it: it synthesizes a matching log line and drives it through the ACTUAL
   pipeline (pattern exec, cooldown, charm-pet suppression), then speaks the real
   TTS. Cooldown/suppression are *evaluated and reported* but never enforced or
   consumed; nothing relays/uploads and the fight timeline is untouched. A
   gauge-condition trigger rehearses the action tail and is journalled
   "pattern not exercised (gauge condition)".
3. **Sticky critical callouts** — an officer can tick **📌 Sticky** on a guild
   trigger (`/admin/triggers`); the alert then pins on the trigger overlay until
   the raider clicks it away (or ~5 min), instead of the 3.5s fade. Backward-
   compatible — older agents ignore the field.
4. **Ghost-callout TTL** — a relayed fire that arrives >15s after it originally
   fired (queue backlog replayed late) is dropped and journalled "stale-skipped"
   instead of being spoken minutes out of date. Fail-open on a missing timestamp.
5. **CH chain "0X GO" (#103)** — when the chain reaches a slot owned by the
   character you're playing, the agent speaks "0N GO" (e.g. "04 GO") through the
   trigger pipeline (so the master **Trigger alerts (TTS)** switch still gates
   it). A dedicated **📣** button on the CH chain overlay toggles just this
   callout (default ON, persists per machine). Once per rotation pass.

**Where to look:** dashboard `http://localhost:7777` → **Triggers** tab (the 🧭
journal card + the ▶ Rehearse buttons). The CH chain overlay's 📣 button sits
left of ⚙/🔊/✕. Officer sticky checkbox: `wolfpack.quest/admin/triggers`.

### ✅ Solo (one machine)
1. **Journal shows checkpoints.** Add a personal trigger with a real pattern +
   a cooldown, then paste/emit two matching lines quickly. The journal shows the
   first as **5/6 dispatched** and the second as **3/6 gates passed —
   cooldown … remaining**. A charm-suppressed `{s}` call shows **2/6 pattern
   matched — suppressed (capture is your charm pet)**.
2. **REHEARSE really rehearses.** With **Trigger alerts (TTS)** ON, click
   **▶ Rehearse** on a saved trigger → you HEAR the real callout, a 🧪-badged
   flash appears, and the journal adds a **REHEARSAL** row ("pattern matched
   synthesized line; cooldown/suppression not consumed"). Confirm NO Discord
   post and no new parse-timeline fire. Break the trigger's pattern (make it
   match nothing) and Rehearse again → journal says "pattern not exercised
   (could not synthesize a matching line)" — the tell that a live line would
   never fire it.
3. **Stale fire is skipped.** Take the agent offline briefly while a guild
   trigger fires on another machine (or let a backlog build), then reconnect. A
   relayed fire older than 15s at arrival is NOT spoken — it appears in the
   journal as **stale-skipped — fire was Ns old**.
4. **CH GO speaks on your slot.** Get into a CH chain slot for the character you
   play (roster call names you, or you shout your number). With 📣 ON and
   Trigger TTS on, when the chain reaches your slot you hear "0N GO" once per
   pass. Click 📣 off → silent; the button state survives a Mimic restart, and
   re-syncs the agent after an agent restart.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Sticky stays pinned during a fight.** Officer ticks 📌 Sticky on a critical
   guild trigger (e.g. Death Touch). When it fires mid-fight, the callout stays
   on screen on every raider's overlay until each clicks it away — it does NOT
   fade after a few seconds like a normal alert.
2. **Relay fresh, not late.** With two raiders, a guild trigger one raider's log
   sees relays to the other and speaks within ~1–2s (fresh). Now induce a
   backlog on the receiver (brief offline), and confirm the delayed relay is
   dropped (journal: stale-skipped) rather than spoken well after the event.

---

## #72 — Designated-reporter election (chat pilot)

**Needs:** bot **3.0.196** (live on main) · agent **3.3.74** (beta Mimic) · a
guild admin to toggle the kill switch in `/admin/overlays`.

**What it does:** at scale, every raider's agent used to independently upload the
same guild/raid chat (`/gu`·`/rs`). Now the bot elects **one** agent as the chat
reporter; the rest stand down. Chat still reaches Discord exactly once. It's
**fail-open** — if the election is unreachable, everyone uploads (nothing goes
dark). This is the pilot for the bigger buff/roster de-duplication to come.

**Where to look:** the agent dashboard at `http://localhost:7777` → the agent
`/status` now carries `reporter: { roles: {chat,buffs,roster}, electionOn }`.
Also `agent.log` prints `[reporter] chat role → REPORTER (uploading /gu·/rs)` or
`→ stand down` whenever your role flips.

### ✅ Solo (one machine)
1. **Elected by default.** Running only your machine, open `/status` (or watch
   `agent.log`): within ~20s you should be the chat reporter — `electionOn: true`,
   `roles.chat: true` (you're the only/lowest name, so you win).
2. **Chat still relays.** Type in `/gu` or `/rs` in game → the message still
   posts to the Discord relay as before. (You're the reporter, so nothing
   changed for you.)
3. **Kill switch works.** On `/admin/overlays`, tick **"Disable reporter
   election (#72)"** under 🛑 Kill switches and Save. Within ~60–80s your
   `/status` shows `electionOn: false` and `roles` all `true` (election disabled
   → everyone uploads). Chat still relays. Untick + Save → `electionOn: true`
   returns.
4. **Fail-open on bot loss.** (Optional) Point the agent at a bad bot URL or kill
   connectivity briefly → roles reset to all-`true`, chat keeps uploading. No
   silent failure.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Only one uploads.** Two raiders both in guild chat, both on beta Mimic.
   Exactly **one** shows `roles.chat: true`; the other shows `chat: false`
   ("stand down" in its log). The reporter is the alphabetically-lower primary
   character name.
2. **Chat posts once, not twice.** Send one `/gu` line. Confirm it appears in the
   Discord relay **exactly once** (previously each machine would have submitted
   it). No duplicate.
3. **Failover.** The chat reporter closes Mimic (or camps). Within ~60s the other
   raider's `/status` flips to `roles.chat: true` and takes over. Confirm `/gu`
   still relays after the handoff — **no chat lost** during the switch.

### Now built (P1c, 2026-07-18)
- Raid-roster de-duplication (group-aware) — see the **#72 P1c** section below.
  This completes the #72 election work (chat + buffs + roster all elect).

**Status:** ~~⏳ awaiting solo + multi-person verification~~ → **2026-08-09: ✅
live for the whole fleet AND switched on in production** (agent 3.3.74 →
**3.5.54**; bot 3.1.34). The chat election is running right now — `dedup_chat` is
absent from `overlay_tuning.tuning` and defaults **ON**, so the
`dedup_chat = 0` mitigation from the 2026-07-19 blackout has been lifted (see the
box in **#112**). ⏳ The specific solo/multi cases were never scored; what we have
is "the flag is unset and chat is flowing", not a measured failover.
⚠ Note the kill switch in case 3 (**"Disable reporter election (#72)"**,
`flag_disable_reporter_election`) has never been set either — same finding as
#118.

---

## #72 P1b — Buff-landing election (coverage-per-zone)

**Needs:** bot **3.0.206** (live on main) · agent **3.3.81** (beta Mimic) · a
guild admin to tick **`dedup_buffs`** in `/admin/overlays` 🛑 Kill switches.

**What it does:** buff landings are the same for every same-zone client, so at
scale N raiders upload N copies of each land. Now the bot ranks agents by
**coverage** (how many distinct landings each actually saw over a rolling 10-min
window) and elects the **top 3 per zone**; the rest stand down. Charm timers
(`is_charm_spell` — synthesized per observer, no log line for other clients) are
**exempt and always upload**. Everything is **fail-open** (bot down / flag off /
zone unknown / no coverage yet → everyone uploads) and gated behind the
`dedup_buffs` flag, default OFF, so production is unchanged until it's flipped.

**Where to look:** `/status` `roles.buffs` (true = you upload ordinary landings;
false = you stand down) and the new `buffs_zone: { zone, reporters, mine,
coverage }` block. `agent.log` prints `[reporter] buffs role → REPORTER … / →
stand down` when it flips.

### ✅ Solo (one machine)
1. **Flag off = no change.** With `dedup_buffs` unchecked, `roles.buffs` stays
   `true` and buff landings upload exactly as before. Nothing to see — that's the
   point (production default).
2. **Flag on, sole candidate.** Tick `dedup_buffs` + Save. Running only your
   machine, within ~60s `/status` still shows `roles.buffs: true` — you're the
   only (top) candidate in your zone, so you stay elected and keep uploading.
   `buffs_zone.mine: true`, `reporters: 1`.
3. **Charm rows upload regardless.** With the flag on, charm a mob (Allure /
   Beguile / Charm). The charm timer still reaches cross-client Mob Info — charm
   rows never gate on the buffs role, so even a stood-down agent keeps sending
   them.

### 👥 Multi-person (2+ machines on beta) — **needs raid partners**
1. **Only the elected 3 upload.** 4+ raiders in the SAME zone, flag on. After a
   few minutes of buffs flying, exactly **3** show `roles.buffs: true`
   (`buffs_zone.reporters: 3`); the rest show `false` ("stand down" in the log).
   The 3 are the highest-coverage agents — a raider off in a corner self-selects
   out. Ordinary landings still reach Mob Info / the buff queue (the 3 cover the
   zone); no landing goes dark.
2. **Failover within ~60s.** One elected buff reporter closes Mimic (or zones
   out). Within ~60s a previously-stood-down agent in that zone flips to
   `roles.buffs: true` and takes over — coverage stays complete across the swap.
3. **Zone-split raiders elect independently.** Split the raid across two zones
   (e.g. a pull group ahead). Each zone runs its own election — up to 3 reporters
   per zone, and an agent in zone A is never gated by zone B's reporters. Confirm
   both zones' landings keep flowing.

**Status:** ⏳ **STILL UNVERIFIED as of 2026-08-09 — and the feature has never
run in production.** The code is live for the whole fleet (agent 3.3.81 →
**3.5.54**, bot 3.1.34), but `dedup_buffs` **has never been set**: it is absent
from `overlay_tuning.tuning` and the bot defaults it **OFF**
(`buffs: Number(tune.dedup_buffs) >= 1`, `index.js:13544`). So every agent still
uploads every landing, exactly as solo case 1 describes — which means case 1 is
the only one that is (trivially) true today, and cases 2–3 plus the whole
multi-person section have never been exercised at all. Flipping it is a real
change to production ingest; do it deliberately, not incidentally.

---

## #72 P1c — Roster election (per-group) + stray-endpoint gates + camp-out handoff

**Needs:** bot **3.0.207** (live on main) · agent **3.3.82** (beta Mimic) · a
guild admin to tick **`dedup_roster`** in `/admin/overlays` 🛑 Kill switches (for
the roster cases). This completes the **#72** election work — chat, buffs, and
roster all elect now.

**What it does:**
- **Roster election (per-group).** The Zeal raid roster is identical from every
  raider's view, but per-member HP arrives only for the uploader's OWN group. So
  with `dedup_roster` on, exactly **one agent per raid group** uploads the roster
  snapshot; the rest stand down. An agent not in a raid (or without Zeal) is its
  own group and always uploads. Composition + every group's HP stay fully
  covered. Fail-open everywhere (bot down / flag off / unknown group → upload).
- **Stray-endpoint gates.** The "buffs feel laggy" report now rides the buffs
  role (a stood-down agent stops sending the diagnostic — but its own local
  snappy-mode still engages, so nothing changes for the clicker). The "✓ cured"
  debuff-clear is a manual raid-wide action and is **intentionally NOT gated** —
  any raider's click still clears the chip for everyone.
- **Camp-out early handoff.** When you type `/camp`, your agent flags itself
  `camping` and tells the bot immediately (no 20s wait). The bot stops electing
  you as a reporter ~30s before your logout would trip the TTL, so a groupmate
  takes over the roster/buffs/chat handoff *before* you vanish. If you're the
  ONLY candidate in your scope you keep reporting until you're actually gone.

**Where to look:** the agent `/status` `reporter.roles.roster` (true = you upload
the roster; false = you stand down) and the reporter status line, which now shows
**camping** while a camp is in progress. `agent.log` prints
`[reporter] roster role → REPORTER / → stand down` and a camp start/abandon line.

### ✅ Solo (one machine)
1. **Flag off = no change.** With `dedup_roster` unchecked, `roles.roster` stays
   `true` and the roster uploads exactly as before (production default).
2. **Flag on, sole candidate.** Tick `dedup_roster` + Save. Running only your
   machine, within ~60s `/status` still shows `roles.roster: true` — you're the
   only candidate in your group, so you keep uploading. The /raid board is
   unchanged.
3. **`/camp` shows camping + hands off.** In game, type `/camp`. Immediately (not
   after 20s) the dashboard reporter line shows **camping**, and `agent.log` notes
   the camp start. Type a move key to **abandon** the camp (`You abandon your
   preparations to camp.`) → the camping flag clears and the line returns to
   normal. (Solo, you stay elected the whole time — sole candidate, fail-open.)

### 👥 Multi-person (2+ machines on beta) — **needs raid partners**
1. **Two Mimics, same group → one uploads.** Two raiders in the SAME raid group,
   both on beta Mimic, `dedup_roster` on. After ~60s exactly **one** shows
   `roles.roster: true` (the lower primary-name rank); the other stands down. The
   /raid board still shows the whole group's HP (the elected one covers it).
2. **Different groups elect independently.** Put the two raiders in DIFFERENT
   groups → BOTH upload (`roles.roster: true` for each), because each group elects
   its own reporter. No group's HP goes dark.
3. **Camper hands off within ~20s of camp-start.** The elected roster (or buffs,
   or chat) reporter types `/camp`. Within ~20s — well before the 60s TTL — a
   groupmate/zone-peer flips to `roles.*: true` and takes over. Confirm the board
   / buff queue / chat never stalls during the swap.
4. **Kill the reporter → TTL failover.** Instead of camping, the elected reporter
   hard-closes Mimic (no `/camp`). Within ~60s (the TTL) a peer takes over. This
   is the backstop the camp handoff front-runs.

**Status:** ⏳ **STILL UNVERIFIED as of 2026-08-09 — roster election has never run
in production**, same as P1b: `dedup_roster` is absent from
`overlay_tuning.tuning` and defaults **OFF** (`index.js:13545`). Every agent
still uploads the roster.
**The two non-roster halves ARE live and ungated, though**, and are worth
checking on their own: the **stray-endpoint gates** (buff-lag report rides
`roles.buffs`; `debuff-clear` deliberately left UNGATED so any raider's "✓ cured"
click still clears the chip for everyone) and the **`/camp` early handoff**,
which runs regardless of the flags — solo case 3 is runnable today.

---

## Chunk 0 hotfix — `{s}` triggers now fire on backtick names

**Needs:** agent **3.3.75** (beta Mimic).

**What it does:** name-captured guild triggers (`{s} has become ENRAGED.`,
`{s} slows down.`, etc.) compiled to a pattern that excluded the backtick
character, so Luclin mobs whose names carry one — **Rhag\`Zhezum, Aten\`Ha\`Ra,
Yar\`Lir** and friends — could *never* match. Those triggers silently never
fired. Fixed; multi-word and apostrophe names still match.

### ✅ Solo (near a backtick-named mob)
1. Enable a guild `{s}` trigger that a backtick mob will produce — e.g. an
   Enrage (`{s} has become ENRAGED.`) or Slow (`{s} is slowed.`) trigger.
2. Engage a backtick-named Luclin mob (Ssraeshza Temple has several). When the
   line fires in your log, the trigger overlay/TTS should now **fire with the
   mob's name filled in** (previously: nothing).
3. Regression: confirm a **space-named** mob (e.g. "an ancient croaker") and an
   ordinary single-word name still fire as before.

### 👥 Multi-person
- Not required — trigger matching is per-client. One person near the mob proves it.

**Status:** ~~⏳ awaiting verification on a backtick-named pull~~ → **2026-08-09:
✅ live, and the underlying mechanism has since been replaced.** `{s}` no longer
compiles to an allow-list character class at all — `compileTriggerPattern` (which
replaced `_translateDotNetRegex` on 2026-08-07) expands it to `.+?`, so a
backtick name cannot be excluded by construction any more. That same change is
what caused the `{s}`-eats-the-timestamp P1 in agent 3.5.44–3.5.53, fixed in
**3.5.54**; both behaviours are now pinned by `test/trigger-class.test.js`.
So this hotfix is subsumed rather than merely shipped — but a Rhag\`Zhezum /
Aten\`Ha\`Ra pull is still the cheapest live confirmation, and it now also checks
that the capture contains **no leading timestamp**.

---

## Callout trifecta — "why TTS never fires" (#76)

### Triggers now fire on ENRAGED / snared / mez / fizzle lines
**Needs:** agent **3.3.76** (beta Mimic).

**What it does:** the trigger engine only ever saw lines the combat filter
positively *kept*, so a whole class of templates — mob **ENRAGED**, self
**snared / mesmerized**, spell **fizzles**, cure/emote lines — matched lines
that were dropped before a trigger could run. 9 of the 17 shipped suggested
templates could never fire. Now triggers evaluate on those lines too. Privacy is
unchanged: tells / officer / group / custom-channel lines still never reach a
trigger, and only the trigger name + captures relay, never the raw line.

#### ✅ Solo
1. Enable a trigger on one of the newly-visible lines, e.g. `{s} has become
   ENRAGED.` or `You are snared.` (personal trigger is fine).
2. Produce the line in-game — get snared by a mob, or tank one to enrage. The
   trigger overlay/TTS should now **fire** (previously: silence).
3. Privacy regression: a trigger on `{s} tells you` must **not** fire on an
   actual `/tell` — private lines stay invisible to triggers.

#### 👥 Multi-person — not required (per-client matching).

**Status:** ~~⏳ awaiting verification~~ → **2026-08-09: ✅ live for the whole
fleet** (agent 3.3.76 → **3.5.54**). ⏳ Never formally scored. ⚠ Worth pairing
with the 2026-08-09 anchor fix when you do: *"9 of the 17 shipped suggested
templates could never fire"* and *"37 of 109 enabled guild triggers could never
fire"* were two independent silent-coverage bugs with the same shape — **an
enabled trigger reads as coverage.** Both are now fixed in the engine, which
means a lot of previously-silent callouts speak for the first time on the same
night.

---

## Not in beta (shipped straight to main — noted here for completeness)
- **Trigger relay: no more post-deploy deafness** (bot **3.0.198**, live): the
  relay id counter now seeds from a monotonic boot base, so after a bot deploy
  agents no longer skip every relayed callout for hours. **Not directly
  user-testable** — the symptom (cross-client callouts silent for hours after a
  deploy) simply won't recur.
- **Auth 503-not-401 data-loss fix** (bot **3.0.197**, live): a Supabase blip
  during a fight no longer turns valid uploads into permanent loss. **Not
  user-testable** without inducing a Supabase outage — verified by unit test
  (null→503, []→401) and code review. Watch for: fewer "my parse vanished"
  reports after a Railway/Supabase wobble.
