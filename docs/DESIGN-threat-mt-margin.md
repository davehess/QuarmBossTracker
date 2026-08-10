# Threat meter — show the margin to the MT, and who is closing

From Hitya, 2026-08-10 (Emperor Ssraeshza): *"This is what the aggro looked like
when Currygoat told everyone to back off when he was struggling on Hate and
threat… Wabumkin was high on the meter, primarily because he was so high on
damage. Others like Damyu and Meditate were gaining quickly."*

The screenshot: **Wabumkin 120k, Currygoat 108k**, Damyu 102k, Meditate 82k.
Currygoat is the MT. A DPS is 11% ABOVE the tank and two more are closing — and
the meter says none of that. It shows eight rows sorted by absolute threat.

## What the model already gets right

Threat is NOT a damage proxy dressed up. `threatBy` buckets swing / proc /
spell/AA / heal, and heal hate is grounded in Torven's live-hate-meter research
(eqemulator.org thread 39819): 2/3 of the amount healed, capped 1500 on 51+
targets, replacing an older flat ×0.5 guess. Snapshots upload every 6s (tunable
2–60s via `tuneNum('threat_snapshot_ms')`), so there is a real per-player time
series, not just a current value. The ordering called this fight correctly.

## The four things missing

1. **The MT is not marked.** Nothing on the meter says Currygoat is the tank.
   The row accent only means "you are #1", which is shown to whoever is looking
   — but the person who has to act is the DPS on top, not the tank. MT identity
   is already resolvable (`recentTankHits` mob→player connects feeds MT
   resolution; the Command Center already prints `MAIN TANK — CURRYGOAT`).
2. **No margin.** "120k" is meaningless alone; "**+11% over MT**" is the number
   that decides whether to stop attacking.
3. **No closing rate.** *"Damyu and Meditate were gaining quickly"* is exactly
   what the 6s snapshot series can compute — slope per player, projected
   crossover: *"Damyu passes MT in ~18s at this rate."* That is the warning that
   arrives early enough to matter, rather than after the swap.
4. **The warning goes to the wrong person.** A DPS who is closing should get the
   callout on THEIR screen ("BACK OFF — 104% of MT"), not require the tank to
   notice and shout. Currygoat having to call it out on voice is the failure.

## Proposal

- Mark the MT row explicitly, and render every row as **% of MT** alongside the
  absolute number.
- Two thresholds, personal to the viewer: an amber "closing" (say ≥85% of MT)
  and a red "over" (≥100%). Reuse the existing trigger callout surface for the
  spoken warning so it obeys the same mute/TTS controls as everything else.
- Add the projection from the snapshot slope; suppress it when the series is too
  short or too noisy to be honest about.
- Tank-facing counterpart: name who is closing, so the MT can pick a taunt
  target instead of asking the whole raid to back off.

## The enrage window is the real feature

Hitya, with the mechanic that makes this urgent: *"it was about at 14-10 percent
on a mob that Enrages and will turn on the raid and possibly kill a bunch of
them. And Currygoat needs to turn off attack at 8% for enrage meaning people
would surpass him, turn the boss, and then everyone takes return hits on
enrage."*

That is a different and much sharper problem than general threat management:

1. Approaching enrage, the MT **deliberately stops attacking** (~8%) so he does
   not die to riposte.
2. His threat therefore **stops growing on purpose**, while every DPS — plus
   DoTs and pets that nobody "stopped" — keeps climbing.
3. Someone passes him, **the boss turns**, and it turns while enraged, into a
   raid that is not positioned for it. *"everyone takes return hits on enrage."*

So the danger is not a mistake anyone is making — it is the *correct* tank play
creating a threat vacuum, at the exact HP where the cost of a swap is highest.

### The ask: caution tape

*"That flashing caution over the melee on the parse would be good to see. Caution
tape style on a diagonal over who's gaining during that timeframe if it's close."*

A diagonal hazard-stripe hatch over any row that is **gaining on the MT while the
boss is inside the enrage window**, so the people who need to stop can see it on
their own meter without the tank calling it. Conditions, all of which we already
have:

- **Boss HP%** — from the Zeal target gauge (the pipe carries name + HP
  per-mille, which is what the Extended Target rows already render).
- **Enrage actually firing** — `"<Mob> has become ENRAGED."` is already a known
  live trigger pattern in the agent, so the window can be confirmed, not just
  predicted from HP.
- **Gaining** — the snapshot slope from §Proposal.
- **Close** — the % of MT margin from §Proposal.

Window default ~15% HP (opens before the 8% the tank acts on, since the warning
has to arrive early enough to matter), closing when the mob dies or enrage ends.
The hatch belongs on the threat meter rows AND on the parse afterwards, so a
post-fight review can see who was climbing during the window.

## The model has no hate REDUCERS at all

Hitya: *"We aren't currently counting Ancient Greater Concussion as far as I can
tell on threat reduction, but Wabumkin should have been lower because of it."*

Correct — `threatBy` only ever adds (swing / proc / spell / heal). There is no
subtraction anywhere, so every hate-shedding tool in the raid is invisible to the
meter. **Wabumkin is a Wizard**, so the concussion line is exactly his tool.

Grounded from `eqemu_spells` — **SPA 92 is hate reduction**, negative base = hate
removed, and the whole family is small enough to hardcode like `SLOW_MAGNITUDES`:

| Spell | Hate | Landing text (bystander) |
|---|---:|---|
| Ancient: Greater Concussion (2117) | **−600** | `staggers from a blow to the head.` |
| Jolt (1741) | −500 | `'s head snaps back.` |
| Cinder Jolt (1296) | −500 | `'s head snaps back.` |
| Concussion (752) | −400 | `staggers from a blow to the head.` |
| JoltingBladesEffect (2876) | −200 | `'s head snaps back.` |

Bigger reducers are also unmodeled and matter more: **Feign Death** wipes hate
outright (monk/necro/SK — and the agent already detects FD lines for the death
semantics work, so the signal is in hand), and rogue evade drops it hard.

**Attribution caveat, same shape as the slow problem.** The bystander line names
the MOB, not the caster — `<Mob> staggers from a blow to the head.` could be any
wizard in the raid. But the CASTER's own client resolves it exactly through the
self-cast path, and for a personal "you are closing on the MT" warning that is
the only client that matters. Cross-client, treat an unattributed reducer as
unknown rather than guessing an owner.

### ⚠ Scale check — modelling this alone would NOT have explained that screenshot

Be honest about the arithmetic before promising it fixes anything. At the
catalog's flat **−600**, against Wabumkin's **120k**, one Ancient: Greater
Concussion is **~0.5%**. Ten casts is still ~5%. It does not close an 11k gap to
the MT.

So one of two things is true, and they lead to different work:

1. Our damage→hate weighting is roughly 1:1 and concussion really is a rounding
   error at raid-boss hate pools — in which case model it for correctness, but
   the gap has another cause; **or**
2. concussion feels far stronger in play than −600 out of 120k, which would mean
   our **damage→hate weighting is wrong** — and that is precisely the open
   `EQMac threat weights` Report-04 item. Wizards pulling aggro at top damage is
   the classic symptom of spell hate not being weighted like melee hate.

**Validating the weights is the higher-value work of the two**, and it is
testable: the threat snapshot series plus a known concussion cast gives an
observed step change to compare against −600. If the step is much larger than the
catalog says, hypothesis 2 is confirmed and the whole meter needs re-weighting,
not just a reducer added.

## ⚠ Honest limits — state these on the overlay, not just here

- **Taunt is unmodeled.** `taunt-emote attribution` is still an open Report-04
  item in `CLAUDE.md`. Taunt sets hate to the top of the list, so right after a
  successful taunt our numbers can show a DPS "over" the tank when they are not.
  A margin warning that does not know about taunt WILL false-alarm, and a
  false "back off" costs real DPS. This is the main reason to build the warning
  as advisory and personal rather than a raid-wide alarm.
- **`EQMac threat weights` is also open** (same Report-04 list) — the non-heal
  weights have not been validated against this server's rules.
- Threat is per-observer; a snapshot only knows what that client's log saw. The
  cross-client merge helps but does not make it complete.

Given those, the margin display is worth shipping before the spoken warning:
seeing "+11% over MT" would have told Wabumkin what Currygoat had to say out
loud, without risking a false alarm mid-fight.
