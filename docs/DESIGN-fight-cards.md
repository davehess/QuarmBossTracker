# DESIGN — Fight Cards (the Quartermaster's original concept)

**Hitya, 2026-08-16:** *"that was the original thought process behind the
quartermaster. conceptually it was a checklist for each of the fights to make
sure that we had the player composition that we needed, and a review of the
tactics that keep us from wasting time and wiping."*

So Quartermaster v1 (#82 — kit coverage + quest checklist) built the ITEM
third of the idea. The full concept is a **per-fight readiness card**:

> For fight X tonight: do we have the composition it needs, is the kit
> present, are the tactics callouts armed and correct, and is the pipeline
> alive to record it?

## Nothing here is greenfield — every column already has a system

| card column | existing system | what's missing |
|---|---|---|
| Composition needed | **#93 comp matcher** — `comp_templates`, `web/lib/comp.ts`, the signups gap panel | templates are per-NIGHT; cards need per-FIGHT variants (Tunare kite needs a bard; ST needs cure/slow coverage; Vulak ring needs sustained CH) |
| Who's actually coming | **Raid-Helper mirror** (`rh_signups` — declared) + `raid_roster` (live) | already queryable; just joined into the card |
| Kit present | **#82 Quartermaster** kit coverage | scope kit rows to the fight (resist gear for Ventani ≠ Vulak) |
| Tactics review | **#81 Raid Guide** pages + the guild trigger pack | the card lists the fight's triggers WITH their verified state — pattern text confirmed against `eqemu_spells`/`eqemu_npc_spells`, cycle measured from our own encounters |
| Chain alive | **#75 drill** — now `/preraiddrill` in Discord | done today |

## The tactics half has a worked example as of this morning

The ST melee dance (this session): Ventani's **Freezing Breath** identified
from the mirrored `eqemu_npc_spells` lists, its texts verified in
`eqemu_spells` (845), its **cycle measured at ~15s (12–17s jitter) from our
own 2026-08-07 Ventani kill** (encounter `92ce667c`, 14 casts), and the
trigger pair upgraded to Hitya's spec: timer 15s re-anchored on every breath,
**"Melee out" at T-3s, "A O E" on the actual land**, 4s cooldown — sized to
absorb one breath's ~1–2s burst of lines and nothing more, since a match
during cooldown is fully suppressed (no announce, no timer re-anchor).

**The tank is the metronome (Hitya, 2026-08-16): "the tank never dodges is a
key factor. the tank gets all of these debuffs because they don't move."**
Two consequences, one structural and one tactical:

- *Structural:* because the MT is in every breath, every breath is guaranteed
  to print "<MT> is slowed by the freezing blast." — so every other client's
  timer re-anchors off the tank's land line even when the entire melee train
  dodges cleanly. The dance trigger is reliable BECAUSE the tank eats it.
  (Cost: the MT hears "Melee out" too — delivery is per-class only, and class
  ≠ role; MT-aware suppression is a possible agent follow-up.)
- *Tactical — what the MT is actually sitting in*, decoded from the spell
  effects (a fight-card column, per boss):

| warder | breath | on the tank, per ~15s breath |
|---|---|---|
| Ventani | Freezing Breath (cold) | −750 + attack speed cut to ~30% — effectively **permanent 70% slow** at this recast |
| Hraashna | Stream of Acid (fire-typed) | −500×2 + **65% snare**, ~2-min duration — permanently snared |
| Nanzata | Lava Breath (fire) | −500 + **a dispel on every breath** — the MT's buffs strip repeatedly; long buffs on the MT mid-fight are wasted, defensives can vanish |
| Tukaarak + Ventani | Mesmerizing Breath (magic) | 18s **silence** cloud — a healer standing in it cannot cast |

**The LoS hail probe (Hitya, 2026-08-16):** for every warder EXCEPT Ventani,
*"if you can't see the main tank, you don't get hit by the cast"* — and the
raid's probe for it is a `/hail` at the MT: **a bare `You say, 'Hail'` (no
name) means no line of sight → safe**; `You say, 'Hail, Malthur'` means
you're in the AoE's world. Two personal-scope triggers denote it in `guild_triggers`, **both disabled —
Hitya deferred them 2026-08-16** ("let's not do those triggers for now, but
denote them for the future"). Patterns are compiler-verified with negatives
and the notes carry the full tactic; enabling is one toggle each.
Personal scope is deliberate: line of sight is per-player, and relaying one
raider's Safe would mislead everyone else. So the ST tactics column splits:
**Ventani = the timed dance** (breath can't be LoS-dodged), **the other three
= positioning + the hail probe**.

That table is exactly what the Quartermaster-original concept wants surfaced
per fight before the pull — and every cell came from `eqemu_spells` effect
ids, not memory.

**Second worked example — Caustic Mist (Vyzh`dra the Cursed, Ssra), same
format on Hitya's ask (2026-08-16).** First pick was WRONG and the correction
is part of the example: I armed Mass Insanity (the AoE charm — it looked like
the obvious dance), and Hitya corrected it: *"Caustic Mist is the one we want
to avoid."* The data can tell you what a spell DOES; only the raid knows
which one the tactic is about — that judgment is exactly what the fight
card's officer-authored tactics column encodes. The dance now sits on
Caustic Mist (2814, poison, targeted AE): all three lines, "Melee out" at
T-3, "A O E" on land, 4s cooldown. **Timer 24s is the spell's recast FLOOR**
(no fires across our 14 recorded kills to measure — recalibrate after the
next Ssra clear; early-out is the safe error direction). Mass Insanity's row
stays disabled as a denotation if a charm announce is ever wanted.
⚠ One shared line, verified: "…flesh begins to liquefy." is also Putrefy
Flesh — cast ONLY by Zlandicar (also a targeted AE), so on a Zlandicar fight
this trigger announces correctly but its timer is Vyzh-calibrated; a
Zlandicar twin is one insert if wanted.

That is the repeatable recipe a fight card automates per boss:

1. `eqemu_npc_types → npc_spells → spells` gives the fight's REAL AoEs and
   their exact log texts (no invented patterns — the Divine Intervention
   lesson).
2. Our own `encounter_events` history gives the measured cast cycle.
3. The card shows each tactic trigger with: verified text ✓, measured cycle ✓,
   timer/warning armed ✓ — or flags exactly which of the three is missing.
4. First-pull recalibration: if tonight's measured cycle disagrees with the
   stored timer, the post-raid triage (sentinel loop 2) proposes the update.

## Shape (build later, on Hitya's go)

- `fight_cards(boss_npc_id, comp jsonb, kit_keys text[], trigger_ids uuid[],
  guide_ref, notes)` — officer-authored at `/admin/`, one row per fight.
- Render on the web (`/raid` or the Raid Guide page) the day of the raid:
  each column resolves live (signups vs comp, kit vs owners, triggers vs
  verified state, `/preraiddrill` result).
- The Discord projection: one card per fight posted to the raid thread
  pre-pull, per the Discord-as-projection rule.
- Effort: ~1 day for the table + resolver + web render; the per-fight comp
  templates are officer content, not code.

## Explicitly deferred

- The **write-path drill** (synthetic encounter through the whole chain,
  DESIGN-75-golden-log § "The drill") stays disabled until Hitya signs off —
  today's `/preraiddrill` is the read-only half, from inside production.
- Auto-generating dance triggers for the whole breath family: the recipe
  above works for all 18, but each needs its cycle measured from a real kill
  first — a wrong "Melee out" timing is worse than none. One boss per raid
  week as kills accumulate, via the triage session.
