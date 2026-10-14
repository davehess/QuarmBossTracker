# Test cases: tag corpses

For the `tag-corpses` branch (`7f7c824`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. Status from the guild lead: tagging was tested in game on
2026-10-09 on both NPC and player corpses. Everything else below is still to run.

**Common setup:** `/tag on`. Use `/tag local` unless a case says rsay. Finish with `/tag clear`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. Tag a corpse
- **Setup:** an NPC corpse targeted.
- **Steps:** `/tag local ^PL^Loot`.
- **Expected:** the paw with an L and the text "Loot" show on the corpse.
- **Result:** [ ] pass  [ ] fail  (done in game 2026-10-09, NPC corpse)

### 2. Tag a player corpse
- **Setup:** a player corpse targeted.
- **Steps:** `/tag local ^H^Rez me`, then `/tag local Rez first`.
- **Expected:** the shield and "Rez me" show. Plain text with no key gets the default arrow, which is on unless you turned it off.
- **Result:** [ ] pass  [ ] fail  (done in game 2026-10-09, player corpse)

### 3. A kill marker does not follow a mob onto its corpse
- **Setup:** a live mob you can kill.
- **Steps:** `/tag local ^K^Skull`, kill it, look at the corpse.
- **Expected:** no skull on the corpse. Then tag the corpse itself and that tag shows.
- **Result:** [ ] pass  [ ] fail

### 4. `/tag target` finds a corpse by its own tag
- **Setup:** the corpse from case 1 tagged "Loot".
- **Steps:** target something else, then `/tag target Loot`.
- **Expected:** the corpse is targeted. The match is the whole text, so the label must have no key prefix in it.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 5. A tag from life never makes `/tag target` pick the body
- **Setup:** a live mob tagged `^K^Kill`, then killed.
- **Steps:** `/tag target Kill`.
- **Expected:** the corpse is not targeted (nothing matches or another live mob is chosen).
- **Result:** [ ] pass  [ ] fail

### 6. The first corpse tag replaces the hidden life tag
- **Setup:** a mob tagged in life, then killed.
- **Steps:** tag the corpse `^PL^Loot`.
- **Expected:** only the new tag shows. After you clear it, the old life tag does not reappear.
- **Result:** [ ] pass  [ ] fail

### 7. Corpse far away or not drawn
- **Setup:** a corpse out of range or not loaded.
- **Steps:** target it, `/tag local ^PL^x`.
- **Expected:** "Must have a valid target with a visible nameplate to tag". No crash.
- **Result:** [ ] pass  [ ] fail

### 8. Live players still take only a shape
- **Setup:** a live player targeted.
- **Steps:** `/tag local plain text`, then `/tag local ^H^`.
- **Expected:** plain text gets no tag on a live player; the shield shape does.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 9. Raid sees a corpse tag
- **Setup:** two clients in one raid.
- **Steps:** one tags a corpse with `/tag rsay ^PL^Loot`.
- **Expected:** the other sees it on the same corpse. If the other is on stock Zeal, nothing crashes (it may refuse with its own nameplate message).
- **Result:** [ ] pass  [ ] fail

### 10. Corpse decays or is looted away while tagged
- **Steps:** loot a tagged corpse until it decays, or zone out and back.
- **Expected:** no crash and no tag hanging in the air. Corpse tags are not saved across a relog, on purpose.
- **Result:** [ ] pass  [ ] fail

### 11. Zoning and relog with a corpse tag up
- **Steps:** tag a corpse, then zone and camp to character select.
- **Expected:** no crash. The tag is gone after the relog.
- **Result:** [ ] pass  [ ] fail

### 12. Interaction with persistence
- **Setup:** test-all build (it has both).
- **Steps:** tag a live mob, kill it, relog.
- **Expected:** the dead mob's saved tag is dropped and does not come back onto a corpse.
- **Result:** [ ] pass  [ ] fail

## Performance

### 13. A pile of corpses
- **Setup:** a camp with many corpses, framerate counter on.
- **Steps:** tag 10 corpses.
- **Expected:** no visible framerate change compared with 10 tagged live mobs.
- **Result:** [ ] pass  [ ] fail
