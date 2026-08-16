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
