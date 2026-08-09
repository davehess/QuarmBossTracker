# Death semantics — what counts as a death, and what it means

**Status:** living design note. Sections 1–2 shipped 2026-08-03; sections 3–5 are
design only.

The platform treats "a death" as a single fact. It is not. A log line that looks
like a death can be a feign, a tactical corpse-drop, a rez cycle, or a genuine
wipe contributor — and the raid cares about those very differently. This note is
the one place that distinction is written down.

Driven by a 2026-08-03 review with Uilnayar that started from "Syko died 15 times
in a 12-minute fight" and ended up rewriting what we believe a death is.

---

## 0. Why this needs a design note at all

Deaths feed the raid-night review's "What to work on", the per-fight timeline,
`/parses` death lists, and any future "who needs help" surface. Every one of
those is a judgement about people. Getting it wrong is not a rounding error — it
tells a Shadow Knight he died 58 times when he died twice, and it tells the raid
lead to work on something that never happened.

Three failures found in one evening, all of which had been live for a month:

| Failure | Scale | Cause |
|---|---|---|
| Feign death parsed as death | **44%** of all stored deaths | `"<Name> dies."` is the FD message |
| Clock skew split one death into two | 6 records | 30s dedup vs 48s skew |
| Pets counted as raiders | 4 of 6 "player" fixes | no pet filter on the death list |

The through-line: **we were reading a line and inferring an event, with no
corroboration.** Everything below is about corroboration.

---

## 1. Feign death is not death — SHIPPED (agent v3.5.11)

`"<Name> dies."` is the `cast_on_other` text of every Feign Death spell on Quarm:

| Spell | Classes |
|---|---|
| 366 Feign Death | SK 30 / NEC 16 |
| 1118 Paralyzing Venom | — |
| 1460 Death Peace | SK 60 / NEC 60 |
| 2807 FD Test | — |

All four are SPA Feign Death effects; all four fade with
`"You no longer appear dead."`

`parseEvent` matched `/(.+?)\s+die[ds]\./` on the stated belief that `"dies."`
was "an older real-death variant". It never was. So every feign a knight or necro
threw was banked as a death **by every observer in range**.

The class fingerprint was unmistakable once looked for:

| Class | Death records | Characters | Per character |
|---|---|---|---|
| Shadow Knight | 175 | 3 | **58** |
| Necromancer | 58 | 4 | **15** |
| Cleric | 11 | 2 | 5.5 |
| Bard | 1 | 1 | 1 |

**Fix:** match `died.` only. `dies.` is left to the trigger engine but produces
no combat event. Feign death was already parsed correctly as `feign_death` via
`"has fallen to the ground"` — the death regex was simply shadowing it.

**Why the golden-log suite missed it:** the fixtures contain no `dies.` or
`died.` line at all. A parser regression net only protects the lines it contains.
Pinned now by `test/feign-death-not-a-death.test.js`.

---

## 2. Real deaths carry a corpse-run tail — SHIPPED (agent v3.5.13)

A real death produces a sequence a feign cannot:

```
You died.
You are bleeding to death!
Returning to home point, please wait...
LOADING, PLEASE WAIT...
```

These appear **only in the dying player's own log**. Nobody feigns their way to a
home point. All of them were being dropped by `shouldKeep` — the evidence was
sitting unread in every log we have.

Now parsed as `death_confirm`, back-patching `confirmed: true` onto the matching
self-death within a 60s window.

**Three constraints that make it trustworthy:**

- **Self only.** A death we merely *observed* is never confirmed by our own
  corpse run.
- **60s window**, so a later corpse run cannot reach back to an earlier death.
- **A rezzed death stays recorded but unconfirmed.** Accepting a rez means no
  home point and no corpse run.

> **`confirmed: false` means "no proof either way" — never "this was a feign".**
> Any consumer that treats absence of confirmation as evidence of a feign will
> delete every rezzed death in the guild. This is the single most important
> sentence in this document.

---

## 3. Tactical deaths — the rogue corpse pull (DESIGN)

**Source: Uilnayar, 2026-08-03.** Some pulls *require* a death. This is a
deliberate, skilled manoeuvre, and the platform currently records it as a
failure.

### The tactic

1. A rogue throws a throwing weapon at the boss.
2. Before the throw lands, the rogue **takes a rez**.
3. The rogue snaps back to their rezzed corpse — but the boss aggroes on the
   rogue, who is now somewhere else entirely.
4. The rogue runs into the boss's range; the boss follows them **out of the
   building** to wherever the raid wants to engage.
5. The rogue can be re-rezzed on that **same corpse** for roughly an hour.
6. After that, the corpse is moved out of the instance to a designated
   **graveyard** outside the zone — typically near the book (portal) used to
   enter.

### Why it breaks the current model

- The death is **intentional and load-bearing**. Counting it in "What to work on"
  is worse than useless — it flags the correct play as a mistake.
- It is a **rezzed** death, so section 2's corpse-run confirmation will **not**
  fire. `confirmed` stays false. This is exactly the case that would be
  mis-deleted by a naive "unconfirmed = feign" cleanup.
- It **repeats**. One corpse can absorb many rez cycles inside the hour, so a
  single tactical setup can produce a cluster of deaths for one character.
- It happens **before the pull**, so it often falls outside the encounter window
  entirely — landing it in the ±30min `find_or_create_encounter` merge as a
  phantom pre-fight death (already observed: the 8:42 PM rows on a fight that
  started 8:54 PM).

### Proposed classification

Add a `death_kind` to the stored record rather than filtering at read time:

| Kind | Meaning | Counts against the raid? |
|---|---|---|
| `combat` | died to the encounter | yes |
| `tactical` | intentional corpse generation / pull mechanic | **no** |
| `feign` | never stored (section 1) | n/a |
| `unknown` | pre-fix history, or unconfirmable | flagged, not counted |

### Detection signals, strongest first

1. **Officer/raid-lead declaration.** A `/tacticaldeath <char>` command or a
   pre-pull toggle. Unambiguous, and cheap. **Recommended as the first
   implementation** — inference can come later.
2. **Rogue + pre-engage timing.** A Rogue death *before* the encounter's first
   damage event, on a boss with a known corpse-pull strategy.
3. **Rez cycling on one corpse.** Repeated deaths for one character with no
   intervening corpse run, inside the ~1h corpse lifetime, at roughly one
   location.
4. **Throwing-weapon correlation.** A thrown-weapon damage event from that rogue
   within a few seconds *before* the death.

> **Do not lead with inference.** Signals 2–4 are heuristics about deliberate
> play, and a false positive silently erases a real death from someone's record.
> Start with the explicit declaration and only add inference once we can measure
> it against declared ground truth.

### The corpse's two clocks

**Source: Uilnayar, 2026-08-03.** Considering (`/con`) a corpse reports its exact
decay timer. There are **two independent clocks**, and conflating them would
produce a wrong callout at the worst moment:

| Clock | Length | Ticks when | Ends in |
|---|---|---|---|
| **Zone residency** | **1 hour REAL time** | always | corpse leaves the instance for the graveyard (near the entry book) |
| **Rez window** | **3 hours GAME time** | **only while that character is logged in** | corpse can no longer be rezzed at all |

Consequences that matter:

- The two can expire in either order. A corpse can leave the zone while still
  rezzable (retrievable at the graveyard), or become unrezzable while still
  sitting in the instance.
- The rez clock is a **played-time** clock. A raider who camps for an hour has
  spent none of it. Any countdown we render must therefore be driven by that
  character's own logged-in time, not wall clock — a naive wall-clock countdown
  will tell someone their corpse is dead when it is fine, and worse, the reverse.
- `/con` on the corpse is the authoritative read. If its output is loggable, it
  is strictly better than us modelling either clock ourselves, and it is the
  only thing that can resolve the played-time question without us tracking
  session time per character.

**Design implication:** do not attempt to *simulate* the rez clock. Capture
`/con` output when it happens, and treat everything else as an estimate clearly
labelled as one. The zone-residency hour is safe to model (it is real time); the
rez window is not.

### Open questions

- Should a tactical death still appear on the fight timeline (as a distinct
  marker) or be hidden entirely? *Leaning: shown, distinctly — it explains a gap
  in that rogue's damage.*
- Is the corpse-pull strategy per-boss stable enough to store on
  `bosses_local`/`officer_notes`, so the platform knows which pulls expect one?
- Does `/con` on a corpse produce a parseable line, and does the graveyard
  relocation log anything? Either would let us drive a real "corpse expiring"
  callout instead of an estimate.
- Does the 3-hour figure mean EQ game-time (which runs faster than real time) or
  three hours of played time? **Recorded as stated, not yet converted.** Getting
  this wrong in either direction produces a confidently wrong countdown, so it
  needs confirming against a `/con` reading before anything renders it.

---

## 3a. Bind location — a death's cost is variable (DESIGN)

**Source: Uilnayar, 2026-08-03.** *"during Wednesday's raid at Vex Thal, Hitya
and Rockin (and others) are bound right outside. it is less than 5-10 seconds to
run back into the zone instance to jump back into a fight."*

This reframes the metric. **"Died" is not the cost — time out of the fight is.**
A raider bound at the instance entrance is back in under ten seconds; one bound
in a distant zone is gone for minutes, or needs a port, or needs the corpse
moved. Same log line, wildly different impact on the pull.

Counting both as "1 death" is the same category error as counting a feign: it
treats a cheap, planned outcome and an expensive, disruptive one as the same
event.

### Capturing bind location

Bind Affinity (spell 35) is the hook:

| Message | Form |
|---|---|
| cast on you | `You feel yourself bind to the area.` |
| cast on other | `<Name> is bound to the area.` |

Instant, single-target, unresistable, range 100 — so the landing is reliable.

When that line lands, capture the caster/target's **zone and location** (Zeal
already streams `loc {x,y,z}` and `zone_name` on live-state; `/charinfo` is the
in-game alternative). That gives us a per-character bind point.

With bind points known:

- **Estimated return time** after a death, instead of a bare death count.
- **A pre-raid check**: "you are bound in Nexus, not outside Vex Thal" is exactly
  the kind of thing nobody notices until they die.
- A real input to the tactical-death model in section 3 — a rogue's corpse-pull
  bind is deliberate and near the pull point.

### Caveats

- **Bind points move.** This is a variable that must be re-captured, not a
  one-time fact. The value is only as fresh as the last observed Bind Affinity.
- We see the bind *cast*, not the bind *state*. A character bound before they
  ever ran Mimic has no observation, and we must show "unknown" rather than
  guess.
- Anomalies are expected and that is fine. Per Hitya: *"there are always going
  to be anomalies to our logic, but we can recognize those."* The design goal is
  a labelled estimate that is usually right and visibly uncertain when it is not
  — never a confident number.

### Rez does not require reaching zero first

Worth stating explicitly because it constrains section 4: a player can take a rez
without the platform having observed a `0` HP sample. Between the pipe's sampling
cadence and a fast rez, the zero may simply never be sampled.

So the group-HP watcher must treat `0` as **sufficient but not necessary**
evidence of a death. A character who vanishes from the gauges and reappears at
partial health has almost certainly died and been rezzed, even though no zero was
ever seen. Requiring the zero would silently miss exactly the fast-rez cases the
raid handles best.

---

## 4. Group HP as a death signal (DESIGN)

**Source: Uilnayar, 2026-08-03.** *"the group containing the person that dies
will have their health go to zero on the zeal pipe, and they would essentially
leave the zone."*

This is the strongest available discriminator, because **feign death does not
change HP**. A real death takes the gauge to zero; a feign leaves it untouched.

**Coverage is the win.** The corpse-run tail (section 2) is self-only — one death
per raider. Group gauges cover the *whole group*, so with enough Mimic users most
of the raid is corroborated by somebody.

The plumbing exists: group gauges are already decoded (every named gauge slot
that is not self/target/pet feeds `liveHpByName`). What is missing is a
**transition watcher** — remember prior HP per name, fire `death_confirm` on a
`>0 → 0` edge.

### Constraints (this is a state machine; treat it as one)

- **Key by NAME, never by slot.** Slots are reused when group composition
  changes; a slot's occupant changing must never read as a death.
- **Distinguish "went to zero" from "gauge vanished."** Leaving the group,
  zoning, and the pipe dropping all look like disappearance and are not deaths.
- **The edge is the test, not the level.** A rez reads `0 → N`, which is a real
  death correctly detected. "Currently 0" is not sufficient.
- **Zero is sufficient but NOT necessary.** See §3a — a fast rez can be sampled
  either side of the zero, so a character who vanishes and returns at partial
  health died even though no `0` was ever observed. Requiring the zero would miss
  precisely the cases the raid recovers from fastest.
- **Same-name ambiguity does not apply here** — group gauges carry player names,
  which are unique, unlike the mob-name problem in
  `docs/zeal-spawn-id-request.md`.

**Bonus:** the same watcher detects **rezzes** (`0 → N`), which we record
nowhere today. That would let section 3 distinguish a rez cycle from a fresh
death, and would give the tactical-death detector its strongest signal.

---

## 5. Correcting the stored history (DESIGN)

Stored death records carry only `name`, `ts`, `riposteDeath`, `class`.
`raw_parse` holds aggregates, no event array. **A stored feign and a stored real
death are byte-identical** — there is no field that separates them.

Options considered:

| Option | Verdict |
|---|---|
| Delete all SK/NEC deaths | **No.** Destroys their real deaths (~2 each) along with the feigns. |
| Heuristic by rate | **No.** Unprincipled, and would mangle the tactical-death cluster in section 3. |
| Mark the period unreliable | Safe but leaves the numbers wrong. |
| **Re-run the backfill** | **Yes.** |

### Why the re-run is correct

`contributions` upserts on `(encounter_id, source, contributor_character)`, so a
`--since` re-run with agent ≥3.5.13 **replaces** that contributor's parse in
place. `find_or_create_encounter` dedups, so encounters attach rather than
duplicate. The rebuilt deaths contain no feigns *and* carry `confirmed` flags.
Nothing real is destroyed.

### The catch to plan around

Deaths are a **union across contributors**. A fight is only clean once every
observer who reported it has re-run. Partial coverage leaves partial feigns.

Two coverage strategies:

- **Whole-raid re-run** of a window — cleanest, most coordination.
- **Consistent-uploader re-run** — the handful of people who upload every fight
  cover most encounters for far less effort. **Recommended.**

### Sequencing

Do **not** apply the clock-skew correction (`agent_clock_offsets`) or retune the
dedup window until after the feign cleanup. The 10s window that looked optimal
was fitted to feign spam, not real deaths; it must be re-derived from clean data.

---

## Cross-references

- `test/feign-death-not-a-death.test.js` — section 1
- `test/death-confirmation.test.js` — section 2
- `docs/DESIGN-dedup-and-mob-serialization.md` — same-name ambiguity
- `supabase/migrations/*_agent_clock_offsets.sql` — section 5 sequencing
- `docs/zeal-spawn-id-request.md` — the upstream ask that would remove a
  different class of ambiguity
