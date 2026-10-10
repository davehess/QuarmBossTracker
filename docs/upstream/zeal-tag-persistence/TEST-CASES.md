# Test cases: tag persistence (crash, relog, character switch, other zones)

For the `tag-persistence` branch (`6ab82a9`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. Adapted from the pull request's own test plan.

**Common setup:** `/tag on`, `/tag persist on` (the default). Your saved file is `<character>_tags.txt` in the
EverQuest folder: one tab-separated line per tag (zone, spawn id, last-seen unix time, colour, name, text; zone `-1`
is a player, kept by name). Open it in a text editor to check. Finish with `/tag clear`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. Camp and log back in, same character
- **Setup:** three NPCs tagged with `/tag rsay` or a channel (shape or text).
- **Steps:** camp to character select, log the same character in again.
- **Expected:** all three tags return within about a second of the mobs appearing.
- **Result:** [ ] pass  [ ] fail

### 2. Switch to a different character in the same zone
- **Setup:** tags on three NPCs.
- **Steps:** camp, log in a different character that is in the same zone.
- **Expected:** the tags return for that character too.
- **Result:** [ ] pass  [ ] fail

### 3. Crash stand-in
- **Setup:** one mob tagged. Confirm its line is in `<character>_tags.txt`.
- **Steps:** end the game process from Task Manager. Restart and log in.
- **Expected:** the tag is back, and the game starts normally (the first build crashed at launch).
- **Result:** [ ] pass  [ ] fail

### 4. Zone out and back
- **Setup:** tags on three mobs.
- **Steps:** zone out and back in. Then retag one restored mob with a different shape.
- **Expected:** tags restored; the retag wins and the old shape is gone.
- **Result:** [ ] pass  [ ] fail

## Players

### 5. A tagged player zones out and back
- **Setup:** `/tag local ^H^Shield` on a guildmate.
- **Steps:** they zone out and straight back.
- **Expected:** the shield is back over them within about a second (their spawn id changed).
- **Result:** [ ] pass  [ ] fail

### 6. Zone together
- **Steps:** zone somewhere together with the tagged player.
- **Expected:** the tag follows them into the new zone.
- **Result:** [ ] pass  [ ] fail

### 7. Death and rez
- **Steps:** the tagged player dies, then is rezzed.
- **Expected:** the corpse carries no tag; after the rez the shield is back on them.
- **Result:** [ ] pass  [ ] fail

### 8. A clear sticks for players
- **Steps:** target the player, `/tag clear`, have them zone out and back.
- **Expected:** no tag. The file's `-1` line for that player is gone.
- **Result:** [ ] pass  [ ] fail

## Dropping tags

### 9. Dead mob and clear
- **Steps:** kill a tagged mob. Then, in a zone with several tagged mobs (some out of view), `/tag rsay clear`.
- **Expected:** the dead mob's line leaves the file. After `clear`, the zone's lines leave the file (including mobs out of view) and nothing returns after a relog.
- **Result:** [ ] pass  [ ] fail

### 10. Three hour expiry (optional, needs a file edit)
- **Setup:** close EverQuest. In `<character>_tags.txt` set one line's third field (last seen) to a unix time more than 3 hours old.
- **Steps:** start the game, log in.
- **Expected:** that tag is not restored and its line is gone after the next save. A fresh line still restores.
- **Result:** [ ] pass  [ ] fail

## Cross-zone and safety

### 11. A tag from another zone does not land here
- **Setup:** a friend in a different zone, or a spawn id that exists here on a differently named mob.
- **Steps:** they `/tag rsay` a mob there.
- **Expected:** nothing is tagged here. With `/tag filter on` the message still goes to Zeal Spam.
- **Result:** [ ] pass  [ ] fail

### 12. Switch off
- **Steps:** `/tag persist off`, tag a mob, relog.
- **Expected:** the tag is not restored, and the file is not rewritten while it is off (check the file's time).
- **Result:** [ ] pass  [ ] fail

### 13. Alt-tab and device reset
- **Steps:** with tags up, alt-tab out of exclusive full screen and back.
- **Expected:** tags survive.
- **Result:** [ ] pass  [ ] fail

### 14. Bad or odd files never crash the game
- **Setup:** close the game. Try each in turn: delete the file; make it empty; put garbage text in it; make it larger than 1 MB; delete a field from a line; mark it read-only.
- **Steps:** start the game and log in each time.
- **Expected:** no crash. A missing, empty or garbage file loads nothing. A file over 1 MB is skipped. A read-only file prints one chat line about the failed save, not one per second, and the game keeps running.
- **Result:** [ ] pass  [ ] fail

### 15. Unwritable EverQuest folder
- **Setup:** EverQuest installed under a folder your user cannot write to (or mark the folder read-only).
- **Steps:** tag a mob and wait a minute.
- **Expected:** one chat line the first time, a retry about 45 seconds later, no spam, no crash.
- **Result:** [ ] pass  [ ] fail

### 16. Two clients at once
- **Setup:** two characters running on one machine.
- **Steps:** tag different mobs on each; camp one; log both in again.
- **Expected:** each client keeps its own file (`<character>_tags.txt`), neither overwrites the other, and each restores its own tags.
- **Result:** [ ] pass  [ ] fail

### 17. A client without this change on the other side
- **Setup:** a raid mate on stock Zeal.
- **Steps:** they send you tags; you send them tags; both of you zone.
- **Expected:** no errors on either side. Their tags still apply to you when the target name matches (the message format is unchanged).
- **Result:** [ ] pass  [ ] fail

## Performance

### 18. Save cost
- **Setup:** 20 tags up in a busy zone, framerate counter on.
- **Steps:** play for five minutes, noting framerate and watching the file's modified time.
- **Expected:** no hitch once a second. The file is rewritten only when something changed (and a refresh about every 10 minutes), not every second.
- **Result:** [ ] pass  [ ] fail
