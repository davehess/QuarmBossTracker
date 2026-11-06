# Tag PRs for Zeal 1.5.0 (filing text, 2026-11-06)

Upstream tagged **v1.5.0-alpha0** (`004fa3c`) on 2026-11-05 with our PRs 246 (UI cursor), 253 (popflags) and 254
(`/pipedelay`) inside. The two tag changes were rebased onto it so they can go in before 1.5.0 is final.

| PR | Fork branch | Commit | Base | Build |
|---|---|---|---|---|
| Optional tag persistence + corpse tagging | `pr/tag-persist-corpses-1.5` | `606e428` | v1.5.0-alpha0 | GitHub Actions passed (`test-1.5` branch, both commits together, run 2026-11-06) |
| Received tag must match the mob's name | `pr/tag-name-check-1.5` | `d75d153` | v1.5.0-alpha0 | same run |

- Same code as the 1.4.8-based `fix/tag-persist-corpses` (`8bb72be`) and `fix/tag-name-check` (`342694b`). The one
  conflict was in the `NamePlate` constructor: upstream added the cast-bar `EnterZone` and `WorldMessage` callbacks
  where ours adds the `MainLoop` sync; both are kept, ours last.
- The two commits apply in either order and give the same tree.
- The old branch names were not overwritten (a force push was not approved). File from the `-1.5` branches, or
  force-push them over the old names first if the guild lead prefers those.
- `test-1.5` (both commits + a build workflow) is the compile check only; never file from it.

## PR 1 — title

`Add optional tag persistence and corpse tagging`

## PR 1 — body (paste as-is)

`/tag persist on` keeps nameplate tags through zoning, a character switch and a client crash. Today tags live only in
`nameplate_info_map`, which `clean_ui()` empties on zoning and character select, so a raider who crashes or zones
comes back to untagged mobs while everyone else still sees the marks.

**Persistence (off by default)**

- About once a second, live tags are mirrored into a map keyed by zone and spawn id, with the mob's stripped name.
- Players are keyed by name instead, since a player gets a new spawn id on each zone-in.
- The map is written to `<character>_tags.txt` in the EverQuest folder only when it changed.
- A new nameplate whose zone, spawn id and name match a saved tag gets the tag back.
- A saved tag is dropped when it is cleared in view, when its mob becomes a corpse, when another name holds the spawn
  id, on `/tag clear`, or 3 hours after it was last seen (long enough for a raid, short of an overnight repop that
  reuses the same ids and names).
- While off it does no work and no file access: the main-loop callback returns on the setting check.

**Corpse tagging**

- Corpses (NPC and player) can be tagged, and take tag text and the default arrow like an NPC.
- A corpse shows only tags set after the death, so a kill marker from life does not linger on the corpse it made.

README updated (`/tag persist`, corpses).

**Test plan**

1. `/tag persist on`. Tag three mobs. Camp to character select and log back in: the tags return within about a
   second of the mobs appearing.
2. Tag a mob, end the game process from Task Manager, restart and log in: the tag returns.
3. Kill a tagged mob: its line leaves `<character>_tags.txt`. `/tag clear`: the file empties.
4. Zone out and back in: tags restored. Retag a restored mob: the new tag wins.
5. Tag a player; they zone out and back in: the tag returns although their spawn id changed.
6. `/tag persist off`, relog: nothing restored and the file is not touched.
7. Tag a corpse: the tag and arrow show. A mob tagged in life shows no tag on its corpse until the corpse is tagged.

## PR 2 — title

`Check the target name when applying a received tag`

## PR 2 — body (paste as-is)

Spawn ids are only unique within a zone. A tag received over rsay or a chat channel from a raider in another zone
carries that zone's spawn id, which here can belong to an unrelated mob, so the tag landed on the wrong nameplate.

The tag message already carries the target's stripped name (`ZEALTAG | text | name | id`), so a received tag now
applies only when that name matches the local mob with that spawn id. A mismatch is treated like a missing spawn, so
the Zeal Spam filter still catches it. No message format change; older senders work unchanged.

**Test plan**

1. From another zone, rsay a tag whose spawn id exists here on a differently named mob: nothing is tagged here, and
   with `/tag filter on` the message still goes to Zeal Spam.
2. In the same zone, rsay a tag on a mob: it applies as before.
