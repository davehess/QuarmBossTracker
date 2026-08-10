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
  001; Pyxil called a CH as 001 and **replaced Mcdorf in the overlay**. Same root
  as §3 of `FINDINGS-2026-08-10-trigger-overlay.md` (the roster parser trusting
  the shout over the roster) — a call should update the SLOT's timing, not
  reassign who owns it, unless the roster says so.
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
