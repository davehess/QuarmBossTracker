# Zeal PR draft — keep tags through a crash, relog or character switch; ignore tags from other zones

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). Branch **`tag-persistence`**
on the guild lead's fork (github.com/davehess/zeal/tree/tag-persistence, two
commits: `ca71999`, then `9a3fd09` for player tags, 2026-09-26). The same change is
`0001-tag-persistence.patch` here.*

*How it was tested:*
- *The tag-file load and save functions, the save/restore loop and the
  entity-destructor hook were extracted verbatim from `nameplate.cpp` and run with
  g++ (`test/sync.sh`).*
- *The tests cover a round trip of the file, a player leaving and coming back
  under a new spawn id, zoning together, a death and rez, a clear in view, and the
  NPC rules.*
- *Six deliberate breaks each make them fail.*
- *clang-format with Zeal's style reports nothing on the changed lines.*

*⚠ The first version (`0d66a28`) crashed EverQuest at launch; `ca71999` fixes
it. The guild lead's MSVC build, run 2026-09-25, died before character select with a
null read. Their crash dump, symbolized against their own `Zeal.pdb`, gives the
chain: `NamePlate::NamePlate` → constructing `setting_zeal_fonts` →
`ZealSetting::init` runs the setting's change callback → `clean_ui()` → the new
loop over `saved_tags`. `saved_tags` was declared at the bottom of the class, so it
had not been constructed yet. Members are built in declaration order, and this
setting's callback fires from its constructor. The state is now declared at the
top of the class, with a comment saying why. Upstream's own `clean_ui()` has the
same latent pattern with `nameplate_info_map`; it survives only because clearing
all-zero memory happens to be harmless. Worth mentioning in the PR.*

**Where it came from:** the guild lead, 2026-09-25: *"We should see what it would
take to persist zeal tags in zones for users that crash and come back in and lose
the tags on mobs or switch characters and lose them. That's a current issue"*,
then *"As well as not tag same spawn-ids in other zones"*.

## What was wrong (read from the v1.4.7 source)

- **Tags live only in memory.** `NamePlate::nameplate_info_map` is keyed by entity
  pointer and `clean_ui()` empties it on zoning, on character select, and on a
  graphics device reset. Nothing is written to disk, so a crash, a camp to switch
  characters, or zoning out and back all come back to untagged mobs. A device
  reset (alt-tab or a resolution change in full screen) loses them too.
- **Incoming tags match on spawn id alone.** `handle_tag_message` does
  `get_entity_by_id(spawn_id)` and applies. Spawn ids are only unique within a
  zone, so a tag rsay'd, or sent on a chat channel, by someone in another zone lands
  on whatever local mob has that number. The sender already puts the stripped target
  name in the message (`ZEALTAG | text | name | id`); it was never checked.

## What changes

- **Name check:** a received tag applies only when its name field equals
  `strip_name()` of the local entity. Otherwise it is treated like a missing spawn,
  so the Zeal Spam filter still catches it. No message format change, and older
  senders work unchanged.
- **Persistence:** about once a second, live tags are mirrored into `saved_tags`,
  keyed by `{zone id, spawn id}` with the stripped name. The map is written to
  `<character>_tags.txt` in the EverQuest folder when anything changed, via a temp
  file and rename. When a matching entity appears again (same zone, spawn id and
  name) and has not been seen live yet this session, its text, shape and tagged
  colour are restored.
- **Dropping stale tags:** a saved tag is dropped when its mob becomes a corpse,
  when a different name holds the spawn id, or when it is cleared. A `clear`
  drops the whole zone, including mobs out of view. Tags also expire **3 hours
  after last seen**; a live tag's last-seen time is refreshed every 10 minutes.
- **Character switch:** the character's file is loaded at login and merged with
  what the session already holds (newer wins). In-process switches keep
  everything, and a crash comes back to that character's own file.
- **Players are kept by name (`9a3fd09`).** The guild lead, 2026-09-26: *"tagged
  players should keep their tags if possible - i know they have spawn ids that
  change"*.
  - A player gets a new spawn id every time they zone in, so a zone and spawn id
    key loses them. Their names are unique on the server.
  - Players therefore have their own map (`saved_player_tags`), keyed by stripped
    name and tied to no zone. The tag comes back when they return after zoning,
    camping or dying, and follows them into another zone with you. Their corpse
    neither takes the tag nor drops it.
  - `handle_entity_destructor` marks a leaving player's saved tag as not live.
    Without that, a player who left and came back while you stayed read as a
    cleared tag, and the saved copy was deleted.
  - A clear in view still drops it, and a `clear` drops every player tag.
  - In the file, a player line is zone `-1`, spawn id `0`, then the name. Older
    builds never match zone `-1`.
- `/tag persist <on | off>`, **on by default**. README updated.

**Not covered:** tags broadcast while a client was offline. Recovering those
needs one client to ask the others for their tags. That would go through the same
rate-limited chat channels (~8 messages a minute before a 30 s lockout), so it is a
separate design, not a bolt-on.

## Choices the guild lead may want to change before the PR

| Choice | Picked | Why / alternative |
|---|---|---|
| Expiry | 3 h after last seen | Covers a raid night. A zone that repops overnight hands out the same spawn ids and names in the same order, so a long window would restore yesterday's tags on today's mobs |
| Default | on | The behaviour people already assume they have. Off-by-default would leave the crash case unfixed for anyone who never reads the README |
| File | per character, `<name>_tags.txt` | Like `<name>_bandolier.ini`; two clients running at once never write the same file |
| Cross-zone check | name only | Backward compatible. Adding the zone to the message would also stop the rare same-name, same-id collision, but it changes the wire format that other tools parse (our agent included) |

## Build and test locally

Same clone as before (`C:\dev\zeal-pr\Zeal`), in a Developer Command Prompt for
VS 2022:

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git switch -c tag-persistence origin/tag-persistence
git commit --amend --no-edit --reset-author
git push --force-with-lease origin tag-persistence
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=tagpersist Zeal.sln
copy C:\dev\zeal-pr\Zeal\Release\Zeal.asi A:\EQ\Zeal.asi
```

It starts from 1.4.7, so this build has neither the Bandolier filter nor the tag
shapes. Restore the release with `copy A:\EQ\Zeal.asi.v147-backup A:\EQ\Zeal.asi`.

The save/restore rules and the file functions can be re-tested off-client. The
test extracts them from the real source, so it cannot drift:

```
cd test && sh sync.sh <zeal checkout>
```

---

## PR title

`Keep nameplate tags through zoning, character switch and crash; ignore tags from other zones`

## PR body (paste as-is)

Tags live only in `nameplate_info_map`, which `clean_ui()` empties on zoning,
character select and a device reset, and nothing is saved. A raider who crashes
mid-raid, camps to switch characters, or zones out and back returns to untagged
mobs while everyone else still sees the marks.

Separately, a received tag was applied by spawn id alone. Spawn ids are only unique
within a zone, so an rsay or chat channel tag sent by someone in another zone
landed on whatever local mob had that id.

**What changes**

- Received tags now also require the target name in the message to match the local
  entity's stripped name (the sender already includes it). A mismatch is treated
  like a missing spawn, so the Zeal Spam filter still catches it. No message format
  change.
- Live tags are mirrored about once a second into a map keyed by zone and spawn id
  (with the stripped name) and written to `<character>_tags.txt` in the EverQuest
  folder when anything changed (temp file + rename).
- When an entity appears whose zone, spawn id and name match a saved tag not yet
  seen live this session, the text, shape and tagged colour are restored. A saved
  tag that was seen live and is now gone was cleared, so it is dropped.
- A saved tag is also dropped when its mob becomes a corpse, when another name holds
  its spawn id, on a `clear` (the whole zone, including mobs out of view), or 3 hours
  after it was last seen.
- The character's file is loaded at login or a character switch and merged with the
  session's (newer wins).
- Players are kept by name instead, since a player's spawn id changes every time they
  zone in (names are unique on the server). Their tag comes back after they zone,
  camp or die, and follows them into another zone with you. The entity destructor
  marks a leaving player as not live, so their return restores the tag rather than
  reading as a clear. A player line in the file is zone `-1`, spawn id `0`.
- `/tag persist <on | off>`, on by default. README updated.

Tags broadcast while a client was offline are not recovered — that would need a
resync request between clients, and chat-channel rate limits make it a separate
discussion.

**Test plan**

1. Tag three mobs (rsay or a channel). Camp to character select, log the same
   character back in: all three tags return within about a second of the mobs
   appearing.
2. Same, logging in a *different* character in the same zone: the tags return.
3. Tag a mob, then end the game process from Task Manager (a crash stand-in).
   Restart and log in: the tag returns. `<character>_tags.txt` holds the line.
4. Kill a tagged mob: its line leaves the file. `/tag rsay clear`: the zone's
   lines leave the file, including mobs out of view, and nothing comes back on a
   relog.
5. Zone out and back in: tags restored. Retag a restored mob: the new tag wins.
6. From another zone, rsay a tag whose spawn id exists here on a differently named
   mob: nothing is tagged here, and with `/tag filter on` the message still goes to
   Zeal Spam.
7. `/tag persist off`, then relog: tags are not restored.
8. Alt-tab out of exclusive full screen and back: tags survive the device reset.
9. Tag a player (`/tag local ^H^`). They zone out and back in: the shield returns
   within about a second, although their spawn id changed.
10. Zone together with a tagged player: the tag follows them into the new zone.
    They die and are rezzed: their corpse carries no tag, and the tag is back on
    them after the rez.
11. `/tag clear` with the player targeted, then they zone out and back: no tag.
    The file has a `-1` line for a tagged player, and none after the clear.
