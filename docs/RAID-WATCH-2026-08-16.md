# Raid watch — 2.5.0's first raids (alt raid, 2026-08-16 → 18)

Hitya's program: **Tunare tonight** (one long bard kite + one boss kill),
**Sleeper's Tomb tomorrow** (similarly-named trash, then 5 named — melee dance
callouts must fire for the AoE slow), then the **Vulak ring** (6 waves, the
6th is Vulak`Aerr). This doc is the pre-raid review, everything below checked
against the live database or the real compiler this morning — plus the
watch/triage lists per night. Fleet status **in PLAYERS (distinct discord
ids — character counts inflate ~10× because each player plays several
characters distinctly, Hitya's rule
2026-08-16): 16 players on stable 2.5.0 (15 active in 48h), 1–2 on beta,
1 active straggler on 3.5.72 + 4 idle-since-Thursday on 3.5.71** who
auto-update on next launch.

## Fixed / shipped this morning (before the freeze)

1. **The four enabled slow triggers re-anchored** (Bard "rhythm slows" /
   Magician "very slowly" / Shaman "yawns" / Shaman Plague), plus the two
   disabled ones (Druid, Enchanter) so enabling them later is safe. All four
   verified FIRING through the agent's real compile chain against real log
   lines, spell texts confirmed against `eqemu_spells` (bard = Requiem of
   Time 3066; mage = Earthen Vengeance 3074; the texts are real, not the
   Divine-Intervention invented-pattern class).
   ⚠ **Doctrine correction discovered while verifying:** agent **3.5.46's**
   GINA-compat work added `_rewriteAnchorsForRawLine` — a bare `^` is
   auto-rewritten to `^(?:timestamp)?` at COMPILE time, so on every agent the
   active fleet runs (≥3.5.54), the bare-`^` class was already firing. The
   2026-08-04 "37 of 109 dead" measurement PREDATES 3.5.46 — the
   dead-triggers runbook needs re-measuring; many of its 37 are likely alive
   now. The explicit anchor is still the right stored form (works on any
   agent, matches the web normalizer); CLAUDE.md's rule stands for what we
   WRITE, but "bare ^ = dead" is no longer true at runtime.
2. **The Final Arbiter (128132) and The Progenitor (128125) added to the
   board** — Hitya said FIVE named in ST; bosses.json had only the four
   Warders. Both level 70, 200k/150k HP, 49 drops each, 162h timers. Without
   this, tomorrow's Arbiter kill would have relayed to nothing. Run `/board`
   after tonight's deploy so the thread picks them up.
3. **Herald-of-Vulak false-timer risk retired by reading the code**: the
   bosskill relay matches by EXACT name/nickname equality (index.js:5332), so
   "The Herald of Vulak`Aerr" (124315, a real separate NPC) cannot start
   Vulak's 162h timer. No change needed — verified, not assumed.

## Tonight — Tunare (Plane of Growth)

**The headline data hazard: there are two Tunares and they share one name.**

| npc id | level | HP | loot |
|---|---|---|---|
| 127001 `#_Tunare` | 66 | 500,000 | **none** (loottable 0) — the kite |
| 127002 `#Tunare` | 70 | 500,000 | **67 drops** — the kill; the board's id |

Identical display name, identical 500k HP (so the catalog-HP splitter can't
tell them apart either). This is the #194 same-name class, one night after
its Thall Va Xakra debut — and with a twist: if the kite is never *confirmed
killed* and the kill fight starts within the ±30-min window of the kite's
start, `find_or_create_encounter`'s unconfirmed-can't-respawn rule (the Lord
of Ire fix) will try to KNIT the kill into the kite's encounter. Watch for
ONE merged card where there should be two.

**Watch during / check after:**
- Two encounter cards for "Tunare" tonight, not one — durations sane (kite
  long, kill short). Post-raid: `select id, started_at, ended_at, duration_sec
  from encounters where npc_id in (127001,127002) and started_at > now() -
  interval '12 hours';`
- Target Info → Loot on Tunare mid-raid: does it show the 67-drop table or
  "never dropped"? (Which id name-resolution picks is untested with a
  same-name pair whose HP ties.)
- **History tab's first real outing** (2.5.0 headline): the kite and the kill
  should be separate rows (dedup is boss+start-within-60s); the settle window
  re-resolves totals at +40s/+100s. A very long kite is the stress case.
- **CH ✕ + spot-heal rule** on the kill: un-numbered CH-macro shouts must NOT
  seat anyone on the chain (Pyxil rule, 3.5.79); the ✕ is there if one leaks.
- **Pet fold**: alt raid = mage armies. Pet rows labeled with owners; no
  NPC bleeding onto the meter through the pet whitelist.
- **Backup-log rule**: alts night — nobody's `Atlasius2`-style backup log
  should mint a phantom character.
- **Loot is DKP tonight, not NBG rolling** (Hitya's correction — the watch
  item is the DKP path, not the rolls page): loot-post announce + auction
  chips (#107/#149), sealed bids via place-bid, and the post-raid check that
  the OpenDKP sync + loot fold picked the night up (fold_lag). If incidental
  /random sets do happen, the stable fleet labels only pipe-form calls — the
  comma/tier/bare parser is 3.5.84 beta; unlabeled is expected, not a bug.

## Tomorrow — Sleeper's Tomb

- **Similarly-named trash** = the documented same-name scope boundary:
  sequential same-name kills segment by death boundary; ≥2 identical mobs
  simultaneously can't be split by the pipe (only /tag). Expect merged trash
  cards and don't chase them as bugs; History tab trash totals are the read.
- **The 5 named**: 4 Warders (on board) + The Final Arbiter (added today).
  The Progenitor also added in case it's the fifth actually killed.
- **The dance callouts — CONFIRMED Ventani's Freezing Breath (Hitya) and
  armed.** Cycle **~15s (12–17s jitter), measured from our own 2026-08-07
  Ventani kill** (14 casts, encounter `92ce667c`). ONE consolidated trigger
  now re-anchors a 15s timer on every breath, says **"Melee out" at T-3s**,
  and calls **"A O E"** on the actual land (4s cooldown). Its pattern carries
  all THREE lines — hit, resist, and the cast-on-other text Hitya supplied
  (*"<Victim> is slowed by the freezing blast."*) — because **the other-line
  is load-bearing: a melee who successfully danced OUT sees neither hit nor
  resist, and others' land lines are the only way their timer re-anchors.**
  The old (Resist) twin is disabled so one breath anchors one bar, not two.
  ⚠ Two near-misses caught in final verification, worth remembering:
  (1) the Freezing Breath row was `use_regex: false` — the regex alternation
  would have been matched as a LITERAL and the dance would never have fired;
  (2) the first verification harness matched the compiler's wrapper object
  instead of its `.regex`, making every earlier "FIRES" vacuous — the redone
  harness runs positives AND negatives through the real return shape (all 10
  correct). "The test fired" means nothing until the test can FAIL.
  If tomorrow's first pull shows a different rhythm, one UPDATE recalibrates
  mid-raid. The other 17 breath triggers stay announce-only until each cycle
  is measured from a real kill.
- **The hail LoS probe — DEFERRED by Hitya, denoted for the future.** For
  every warder EXCEPT Ventani, no line of sight to the MT = the breath can't
  hit you; the raid's probe is hailing the tank (a bare `You say, 'Hail'`
  with no name = no LoS = safe). Both triggers exist in `guild_triggers`
  **disabled** ("LoS check — SAFE" / "LoS check — VISIBLE"), patterns already
  verified through the real compiler with negatives, scope reasoning in
  their notes. Enabling them later is one toggle each — no other work.
- **Slow callouts renamed for TTS (Hitya):** "SHM SLOW"/"BRD SLOW"/"ENC
  SLOW" overlays read out as letters — now "Shaman Slow" / "Bard Slow" /
  "Enchanter Slow" / "Plague Slow". **Enchanter Slow enabled** (it exists);
  **Magician Slow disabled** ("mage slow isn't a thing right now" — pattern
  kept fixed for the future).
- **Task #27 gate has CLEARED**: the 8 muted trash triggers were gated on
  "the fleet is on the fix" — 178 characters are on 3.5.80 as of this
  morning. Restoring them is now purely the raid-noise call, and an ST trash
  night is exactly when they'd earn their keep. Hitya's word.

## Vulak ring — 6 waves + Vulak`Aerr

- Wave mobs carry distinct names → no same-name hazard; each named wave gets
  its own encounter card. Vulak (124128, 40 drops) is on the board.
- Watch **queue depth / shed behavior** during waves — six back-to-back AoE
  fights is the 2026-07-13 load shape. `/health` mid-event; `flag_shed_*`
  stands ready if live streams need trimming (durables can never shed).
- Herald false-timer: retired (exact-name matching, above).

## Tonight's actuals (reported live by Hitya, ~20:35 ET)

- **Pre-raid Zlandicar** to key people for Sleeper's Tomb — killed 20:08 ET
  (187s, encounter `719dff28`). The **Caustic Mist dance trigger fired 3×**
  during it via the shared "…flesh begins to liquefy." line (Putrefy Flesh) —
  the documented caveat, now observed in the field. Triage: confirm no timer
  confusion resulted; the scoping decision (leave vs narrow) is Hitya's.
- **The Tunare kite FAILED — no kill.** No Tunare encounter row existed as of
  20:35 ET. Triage: re-run the two-Tunares query after agents flush; if a
  wipe engagement recorded, classify it (Mark Wipe) so it stays out of kill
  counts; if NOTHING recorded despite real combat, that's a finding.
- **New schedule rule (recorded in DECISIONS + CLAUDE.md): alt raids and
  Seru+misc nights are 3 ticks / 2 hours until PoP** — tonight is the first.
  Expect the night to end ~22:00 ET, not midnight; the attendance fold and
  raid review should look normal, just shorter.

## Post-raid triage (the sentinel's loop 2, run by hand this week)

After each night, one pass: the Tunare encounter-card query above · unlabeled
roll sessions for the night · `/health` breaker+queue stats · did the fold run
(newest folded raid vs newest opendkp raid) · any finding → DECISIONS. These
manual passes are the dress rehearsal for #42's battery; whatever we find
ourselves checking by hand three times becomes an invariant.
