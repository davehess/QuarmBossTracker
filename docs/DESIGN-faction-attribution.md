# DESIGN — Faction attribution and inference

**Status:** specified 2026-08-26. Data availability VERIFIED; UI not built.
Owner: Hitya.

> "our faction page needs some love. if we know the positive and native amounts
> for mob kills we see we should attribute the amount of faction. if we just see
> the faction hits we can try to infer how much it could be for that combination
> of faction hits and suggest how much or how little it could be for those hits."

## The core problem

**EQ's log never prints faction amounts.** It prints only direction:

```
Your faction standing with Ring of Scale got better.
Your faction standing with Sarnak Collective got worse.
```

So a kill gives us a *set of directions* and nothing else. The amounts live
server-side. That splits the feature cleanly in two.

## Verified: we already mirror the amounts

Confirmed against the live schema 2026-08-26 — this is not a hypothetical:

| Table | What it gives us |
|---|---|
| `eqemu_npc_faction_entries` | the per-faction **value** for an npc_faction id — the actual number |
| `eqemu_npc_faction` | npc_faction id → its entries, plus the primary faction |
| `eqemu_faction_list` / `_full` | faction id → name (what the log line says) |
| `eqemu_faction_list_mod` | per-race/class/deity modifiers |
| `faction_cons`, `faction_standing` | our own con/standing tables |

## Tier 1 — EXACT attribution (we know the mob)

When a kill is attributed to a known `npc_id` we can resolve
`npc_id → npc_faction_id → entries` and state the amounts outright: *"+15 Ring
of Scale, −30 Sarnak Collective"*. No inference, no range.

⚠ Two correctness notes before building:
- **`eqemu_faction_list_mod` exists and matters.** Race/class/deity modifiers
  change the applied value per character, so an amount presented as universal
  would be wrong for some readers. Either apply the modifier for the viewing
  character or label the number as the base value — do not quietly show base as
  if it were theirs.
- **NPC id encodes zone** (`id = zoneid*1000 + n`, per
  `docs/eqemu-catalog-cheatsheet.md`). Same-named NPCs in different zones are
  different rows with potentially different faction. Match on id, never name.

## Tier 2 — INFERENCE (we only saw the hits)

When we have the faction-hit *combination* but no confident npc_id, treat the
observed set as a fingerprint and search the catalog for npc_faction rows whose
entry set matches those faction names and directions.

- **Exactly one match** → we can state the amounts, flagged as inferred.
- **Several matches** → report the RANGE across candidates: *"between +10 and
  +30 Ring of Scale, based on 4 possible mobs"*. This is the "suggest how much
  or how little it could be" half.
- **No match** → say so. An empty result is information (an unmirrored or
  custom-to-Quarm faction table), not a bug to paper over with a guess.

**Direction is a hard filter and a cheap one.** "got better" ⇒ value > 0 and
"got worse" ⇒ value < 0 for that faction, so a candidate whose sign disagrees
on ANY observed faction is eliminated outright. That usually collapses the
candidate set fast.

**Never present an inferred number as exact.** The range and the candidate count
both belong on screen; a single confident-looking number derived from four
possibilities is worse than no number.

## Where it goes

`web/app/db/faction/[id]/page.tsx` exists already. The kill-attribution surface
belongs alongside the parse/kill views rather than in the catalog browser —
scope that when building, and check `docs/HOW-ITS-BUILT.md` first.

## Open

- Which surface should show it: the faction catalog page, the parse card, or
  `/me`? Not decided.
- Whether to apply `faction_list_mod` per viewer or show base values with a
  label. Recommend the label first — it is honest and much simpler.
