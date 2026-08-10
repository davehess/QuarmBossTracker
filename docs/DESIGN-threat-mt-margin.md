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
