# Zeal PR draft — tag corpses (and keep a mob's pre-death tag off its corpse)

> **Current (2026-10-09):** the branch is ONE commit, `7f7c824`, on Zeal v1.4.8 (`50dc9a4`), squashed from the
> commits named below with the same code; `0001-tag-corpses.patch` is that commit. The hashes below are history.
> A local checkout: `git fetch origin && git reset --hard origin/tag-corpses`.
> **Tested in game 2026-10-09** (the guild lead, on the `test-all` build): tagging works on both NPC and player corpses.

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). Branch **`tag-corpses`** on the
guild lead's fork (github.com/davehess/zeal/tree/tag-corpses, one commit, `aa975e1`); the
same change is `0001-tag-corpses.patch` here. It is merged into `test-all` (`d32bed1`),
and the steps to try it are in `../zeal-tag-shapes/TRY-IN-GAME.md` → "Corpses".*

## Why

The guild lead hit it while testing the tag shapes: *"i can't tag corpses or anything
without visible nameplates"*, with the client answering "Must have a valid target with a
visible nameplate to tag".

The corpse part was never an engine limit. Five deliberate checks in `nameplate.cpp`
refused it (DECISIONS-2026-09-21 §30). The design choice recommended there is the one
built here:
- a kill marker must not linger on the corpse it made;
- a tag set on the corpse itself (loot order, a rez mark) should show.

## What changes (31 lines added, 11 removed, in `nameplate.cpp/.h`)

- `takes_tag_text()`: NPCs and both kinds of corpse take tag text and the default arrow.
  Live players still take only an explicit shape.
- **Taggable targets:** `is_taggable_target()` now accepts corpses. It still requires
  the model to be drawn (below).
- **`NamePlateInfo::corpse_tag`** records that a tag was set on the corpse itself.
  - The render path, the tagged nameplate colour and `/tag target` use a corpse's tag
    only when the flag is set.
  - The first tag applied to a corpse replaces what the mob carried in life. That old
    tag stays in memory from the death until then, hidden.
- **`/tag target`** can pick a corpse only by a tag set on the corpse. A pre-death
  "Kill" never targets the body.
- README: one line.

## Still refused: a target whose model is not drawn

A tag lives on the entry Zeal keeps for each drawn nameplate, created in
`handle_SetNameSpriteState` only when the actor has a head point. So a target that is
too far away, or not loaded yet, has nowhere to hold a tag.
- **Creating that entry early would be unsafe.** Entries are keyed by entity pointer
  and removed in the entity-destructor hook, and nothing proves that hook fires for an
  actor that never had a nameplate.
- **The safe way, if it is wanted:** hold the tag by spawn id (no pointer) and apply it
  when the nameplate appears. The persistence branch already restores tags this way by
  zone, spawn id and name.
- Race-hidden nameplates and "names off" are different: those mobs do have an entry and
  can be tagged today.

## Interaction with the other branches

- **tag-persistence:** it already drops a mob's saved tag when the mob becomes a corpse.
  Corpse tags are not saved across a relog. That is deliberate: corpses decay.
- **tag-shapes:** it merges cleanly. The corpse checks wrap the new shape code
  unchanged.

## Test plan

1. Tag a live mob `^K^`, then kill it. No skull on the corpse.
2. `/tag local ^PL^Loot` on the corpse: the paw with an L and "Loot" show.
3. A player corpse: `/tag local ^H^Rez me` shows. Plain `/tag local Rez first` gets the
   default arrow.
4. Target something else, then `/tag target Loot` targets the corpse.
5. Broadcast one corpse tag by rsay: others in the raid see it on the same corpse.
6. Unchanged: live NPC tags, `/tag clear`, and `/tag target` on live mobs.

---

## PR title

`Allow tagging corpses; keep a mob's pre-death tag off its corpse`

## PR body (paste as-is)

*Upstream has none of the tag-shapes keys (`^K^`, `^H^`, `^PL^`), so the test plan
below uses only upstream's own (`^R^`, `^P^`, `^S^`, `^G^`).*

`/tag` on a corpse answers "Must have a valid target with a visible nameplate to tag":
only live players and NPCs are taggable, and tag text and shapes are never drawn on a
corpse. Marking corpses is useful (loot order, a rez mark on a player corpse), but a
kill marker should not linger on the corpse it made.

**What changes** (`nameplate.cpp/.h`, 31 lines added, 11 removed)

- NPC and player corpses are taggable targets. They take tag text and the default
  arrow, like NPCs; live players still take only an explicit shape.
- `NamePlateInfo::corpse_tag` records that a tag was set on the corpse itself. A corpse
  draws its tag text, shape and tagged nameplate colour only when it is set. The first
  tag applied to a corpse replaces whatever the mob carried before it died.
- `/tag target` can select a corpse only by a tag set on the corpse, so a pre-death
  "Kill" tag never targets the body.
- README: one line on corpse tagging.

**Not changed:** a target whose model is not drawn (too far away, not loaded yet) still
cannot be tagged. A tag lives on the nameplate entry created in
`handle_SetNameSpriteState`, which needs a head point. Creating that entry early would
be unsafe: entries are keyed by entity pointer and removed in the entity-destructor
hook, and nothing guarantees that hook fires for an actor that never had a nameplate.

Tested in game on NPC and player corpses.

**Test plan**

1. Tag a live mob `^R^Kill`, then kill it: no arrow or text on the corpse.
2. `/tag local ^P^Loot` on the corpse: the paw and "Loot" show, in the tagged
   nameplate colour.
3. A player corpse: `/tag local ^S^Rez me` shows. Plain `/tag local Rez first` gets the
   default arrow.
4. Target something else, then `/tag target Loot`: the corpse is targeted.
   `/tag target Kill` does not pick the corpse from step 1.
5. Broadcast a corpse tag by rsay: others in the raid see it on the same corpse.
6. Unchanged: live NPC tags, live player shapes (`/tag local ^G^` on a player),
   `/tag clear`, and `/tag target` on live mobs.
