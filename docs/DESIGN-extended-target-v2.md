# Extended Target — keep our tags, show engage time, and expose the hate seats

From Hitya, 2026-08-10 (Emperor Ssraeshza, an ~866s fight):

> *"We lost our tags naturally from the game memory but the mobs still had their
> tags, in game. We can keep ours on the extended targets as well. This is a long
> time for a fight to go. Maybe we also include the timer from engage on the
> extended target and possible Rampage order in a collapsible way (in order of
> joining the fight, whether by damage, healing someone that was already engaged,
> being a bard that buffed someone engaged, sometimes if you were cast on by the
> mob before any of those other components)."*

Three asks, in rising order of build cost.

---

## 1. Our tag outlives the game's copy of it

The client ages tags out of its own memory, but the nameplate in game still shows
them — so the raid can read a tag we have already forgotten. We do not need to
forget it: the tag reached us over the `/tag` channel with a `spawn_id`, and that
is ours to keep for the life of the fight.

Partly shipped already (bot 3.1.37, 2026-08-10): tagged mobs now stay on the
Extended Target at any health, and `tag_text` / `tag_shape` / `spawn_id` survive
the stale cache. **What is left is retention past the SOURCE dropping it** —
today the row keeps the tag while we keep re-seeing it; it should keep the tag
until the mob dies or the fight ends, even after the client's tag list has rolled
over. Precedent for that being real: the tag list filling on a busy pull and
discarding the boss was a fixed bug (findings §4) — same failure mode, one layer
up.

Related and still open from the same findings: `+`/`@` append currently REPLACES
our stored text, throwing away the tank name the welder needs, and welding only
matches on tank name so a bare `inc`/`SLOWED` tag can never bind. Fix those with
this — a retained tag that is the wrong text is not much better.

## 2. Engage timer per mob

An `866s` fight is long enough that "how long has THIS mob been engaged" is
useful on its own row — and there are several mobs up (Slakiz, Grziz, Heriz,
Nilasz, Yasiz, Skzik, plus the Emperor). Show time since first engage per row.

Cheap: the fight start is already tracked per encounter
(`currentEncounterThreat.startedAt`), and per-mob first-contact is the same
`recentTankHits` signal that drives MT resolution and off-tank surfacing. The
rows already render "last seen 16s ago" for mobs that dropped out, so the
plumbing for a per-row clock is there.

## 3. Rampage order = the hate-list seats

We already assert the mechanic in code (`packages/wolfpack-logsync/index.js`
~4164): *"In EQ the rampage target is effectively FIXED for the whole fight
(second seat on the hate list)"* — which is why the Rampage card persists for the
whole fight instead of strobing between swings. The ask generalises it: if seat 2
is the rampage target, then the **whole seating order** is worth showing, because
it says who inherits rampage when the current victim dies, feigns or is healed
off.

**Joining the list is not just damage.** The four routes Hitya listed, all of
which are observable:

| Route | Signal we already parse |
|---|---|
| Damage | combat events — the primary path |
| Healing someone already engaged | heal events (healer → target), which the threat model already weights at 2/3 |
| A bard buffing someone engaged | buff casts / the casting relay |
| The mob casting on YOU first | debuff landings on players |

Ordering is by FIRST qualifying event per player, which the event stream gives
directly. Render collapsed by default on the mob's row — this is reference
information, not something to read mid-swing, and §3b of the trigger-overlay doc
is emphatic that the screen has no spare space.

### ⚠ What this cannot promise

- **Per-observer visibility.** One client sees only what its own log saw. A
  healer who never damaged the mob may be invisible to a DPS's log and vice
  versa. Cross-client merge (threat snapshots already upload every 6s) improves
  it; it does not complete it. Label the order as observed, not authoritative.
- **Order ≠ hate rank.** Join order is the seating; hate is a separate running
  total, and the two diverge as soon as anyone's threat changes. Do not relabel
  the DPS/threat meter with these seats.
- **Unmodelled hate wipes reshuffle it.** Feign death, evade and the concussion
  line (see `DESIGN-threat-mt-margin.md`) all move or clear a seat, and none of
  them are modelled today. A seat list that ignores FD will be confidently wrong
  the moment a monk drops.

Given those, ship the order as a collapsible, explicitly-observed list — useful
for "who is next" — and do not wire it into anything automated until the hate
reducers land.

---

## 4. Mez ownership (2026-08-10, the Zlakas sequence)

Hitya: *"The Tag on that should be JANKZER MEZ not just MEZ in the extended
target."* Then the failure that proves it: Jankzer died, **his mez state dropped
off the row immediately**, and Zlakas showed as un-mezzed and went for Fargan —
a cleric 5.8s into a Complete Heal.

Two defects:

- **The MEZ chip is derived from who is TARGETING the mob, not from the mez
  itself.** So a dead mezzer reads as "not mezzed" while the mez is in fact still
  running. We already track the real duration — the rows carry `Rapture 22s`,
  `Rapture 36s`, `Rapture 38s` — so the chip should key off that timer, not the
  targeter list. A mezzer dying does not un-mez the mob; it means nobody is
  watching it re-break.
- **The chip does not say whose mez it is.** With owners on the chips, the raid
  leader's *"take those two"* and the answering *"Griz and Zlakas"* becomes
  something the overlay already shows. That exchange happened over voice mid-wipe
  because the information existed nowhere on screen.

Render `JANKZER MEZ · 22s`. When the owner dies, keep the timer and mark the
owner dead — that row is now the most urgent thing on the board, and today it
silently goes quiet instead.

## 5. CH chain — show the tank, and fix slot ownership

From the same sequence, where three consecutive CH landings decided the fight:

- **Put the MT's health on the CH chain overlay.** Hitya: *"i know we have this
  in multiple places but its for a reason."* The chain is where the clerics look;
  the number that decides whether the chain is keeping up is on a different
  window. Duplication is correct here.
- **Interrupts are invisible on the chain.** Fargan's CH was interrupted halfway
  when an un-mezzed add hit him. The chain kept his slot as if the cast were
  coming. An interrupted CH should mark the slot immediately — the next heal was
  6.2s out, with 7.2s behind it, against a tank at 45%.
- **Slot ownership gets overwritten by whoever calls the number.** Mcdorf held
  001; Pyxil called a CH as 001 and **replaced Mcdorf in the overlay**.
  *SHIPPED agent 3.5.61, refined 3.5.62.* Both claimants are kept in
  first-claimed order under an ORDER CONFLICT banner — and after a live test
  (Hitya, 2026-08-12) they render as **one row each** rather than a merged
  `Mcdorf / Stupidric…`, because the joined row truncated the names AND
  collapsed two different casts into one bar: you could see the slot was
  contested but not what either cleric was doing. Each row now runs its own cast
  timer and carries its own mana. Still display-only; the officer-pushed
  authoritative rotation remains the structural fix. Same root
  as §3 of `FINDINGS-2026-08-10-trigger-overlay.md` (the roster parser trusting
  the shout over the roster) — a call should update the SLOT's timing, not
  reassign who owns it, unless the roster says so.
  **Display half SHIPPED (agent 3.5.61, 2026-08-11, Hitya's call):** both
  claimants render on the row in first-claimed order ("Mcdorf / Pyxil") and the
  overlay banners **ORDER CONFLICT** (yellow letters, red outline). Claimants
  self-evict after 120s of silence so a corrected mis-call heals on its own.
  Tests: `test/ch-slot-conflict.test.js`. The structural half — the
  officer-pushed authoritative rotation — is still the open question above.
- **A countdown froze**: Lenolshot's Weapon Shield sat at `2s` for longer than
  two seconds. Same family as the stale cross-client HP — a timer whose source
  stopped updating keeps rendering its last value instead of expiring.

### Worth building once, used by all of the above

Every item in §4 and §5 is the same underlying gap: **overlays render the last
value they were given, with no notion of how old it is or whether its source is
still alive.** Mez owner, tank HP, weapon-shield countdown, off-heal HP, the DA
tank — all of them. A shared "this datum has an age and a liveness" wrapper is a
smaller change than fixing each surface, and it is the difference between an
overlay that goes quiet and one that lies.

---

## 6. CH overlap detection must be measured LOCALLY, then merged on true time

Hitya, 2026-08-10: *"We need an alert when two people have casts that appear to
be going at the same time or nearby on CHs, and we have it built in but everyone
mutes it because the gap is small, and physics won't allow us to hit those
timings on a round trip. this comparison needs to be local."* And: *"that local
compare needs to know clock offset for each healer."*

Both halves are right, and together they give the design.

**Why the current alert gets muted.** `CH GAP` / `CH GAP SOON` already exists
(`apps/mimic/chchain.html`, with a per-machine mute that persists — so a raider
mutes it once and never hears it again). The problem is measurement, not policy:
a chain beat is 2–4 seconds, and a cross-client comparison carries **relay
latency plus clock skew** — both of which are on the same order as the thing
being measured. An alert whose error bar is as wide as its signal fires wrongly,
so everyone mutes it, so the one alert that could prevent a tank death is off on
every machine in the raid.

**Local is the accurate source.** EQ writes `<Name> begins to cast a spell.` into
*every nearby client's* log — visible in the raid captures as consecutive lines
for Jankzer, Ghalix, Mcdorf and others. So one observer sees several clerics'
cast STARTS, all stamped by **one clock**, with the agent's own sub-second
arrival time. Comparing two of those is exact: no skew, no round trip. That is
where overlap detection belongs.

**But local is incomplete, which is where the offsets come in.** An observer only
logs casts they were in range for and whose chat filters let through, so no
single client reliably sees all seven chain slots. Completeness needs merging
across observers — and the moment you merge, you are back on multiple clocks.

So the rule, in priority order:

1. **Compare locally observed casts against each other directly.** Same clock,
   sub-second, no correction needed and none applied.
2. **When merging another observer's sighting, convert it to TRUE time first**
   using that observer's `clock_offset_ms` — the same correction shipped for
   relayed trigger fires on 2026-08-10 (`fired_at_true_ms` = stamp + offset, then
   minus our own offset to land on our clock).
3. **Never compare raw stamps from two machines.** That is the current behaviour
   and it is why the feature is muted fleet-wide.

⚠ **Offset correction fixes skew, not latency.** A relayed sighting is still
*late* even once its timestamp is honest. So a merged observation is good for
"did these two overlap" after the fact; only the LOCAL path is fast enough to
warn *before* a wasted CH. Rank the two accordingly — never let a merged
sighting drive a real-time callout that a local one could.

### The related ask: name who should DI

From the same sequence — DI fired on Currygoat and Emma's CH landed just after,
which is what saved the tank. Hitya: *"That would have been the perfect callout
for Emma OR Aimey to DI because Fargan was being hit, Uilnayar was landing his
heal already, bwavair was 3.4 seconds in, mcdorf and stupidrichard 6.4 seconds
into cast each."*

Every input is on the CH overlay already — who is mid-cast and how far in. The
missing step is inverting it: when the tank is in danger and the chain has a gap,
**name the cleric who is NOT committed** rather than making seven people work out
who is free. Same local-first measurement rule applies: cast progress must come
from local observation to be trustworthy at this timescale.

DI has a real cost (an Emerald per cast), so the callout should name ONE person,
not broadcast "someone DI" to the whole chain.
