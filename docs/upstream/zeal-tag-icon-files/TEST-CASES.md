# Test cases: tag pictures from a folder

For the `tag-icon-files` branch (`b20331f`, stacked on `tag-shapes`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. Reuses the "Pictures" steps in
`../zeal-tag-shapes/TRY-IN-GAME.md` and adds the size, safety and performance checks.

**Setup once:** make `A:\EQ\uifiles\zeal\tagicons` (adjust the drive) and copy in `UP.png` and `UP2.tga` from
`../zeal-tag-icon-files/test-pictures/` (the test build also installs `tagicons\README.txt` and `templates\`).
A real guild logo of your own works too; do not commit other guilds' logos to a public repo.
`/tag on`, target an NPC, use `/tag local`. Finish by deleting your test files and `/tag clear`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The folder is listed
- **Steps:** `/tag icons`.
- **Expected:** it lists the pictures it found (UP, UP2, and any guild picture) and prints the folder path.
- **Result:** [ ] pass  [ ] fail

### 2. Orientation card
- **Steps:** `/tag local ^IUP^Orientation`, then walk all the way round the mob and look from above.
- **Expected:** a flat card above the name. The arrow and "UP" point up, red is on the left and blue on the right. It keeps facing you and never reads backwards or upside down. If it does, note which way.
- **Result:** [ ] pass  [ ] fail

### 3. A TGA file
- **Steps:** `/tag local ^IUP2^TGA`.
- **Expected:** the same card, loaded from the `.tga`.
- **Result:** [ ] pass  [ ] fail

### 4. A picture replaces a built-in guild icon
- **Setup:** a picture named `EUR.png` in the folder (any picture with transparency).
- **Steps:** `/tag icons`, then `/tag local ^IEUR^Europa`.
- **Expected:** your picture replaces the built-in euro icon, with no black box around it.
- **Result:** [ ] pass  [ ] fail

### 5. Take the picture away
- **Steps:** rename `EUR.png` to `EUR.off`, `/tag icons`, tag again with `^IEUR^`. Then rename it back and `/tag icons`.
- **Expected:** the built-in euro returns, then the picture again.
- **Result:** [ ] pass  [ ] fail

### 6. The `custom` folder
- **Steps:** `/tag icons` (it creates `custom` if missing and prints its path). Copy `templates\IMAY.png` into `custom\`, paint on it, `/tag icons`, then `/tag local ^IMAY^Mine`.
- **Expected:** it lists "MAY (yours)" and your edited icon draws. Repeat with `templates\FMAY.png` and `^FMAY^`: your banner draws. Put a different `MAY.png` in `tagicons\` as well: yours in `custom\` still wins.
- **Result:** [ ] pass  [ ] fail

### 7. A whole-key name
- **Steps:** copy `templates\ICON.png` into `custom\`, `/tag icons`, `/tag local ^ICON^Con`.
- **Expected:** it draws. (Windows does not allow a file called `CON.png`, which is why `ICON.png` works.)
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 8. Refused files
- **Steps:** copy a JPG into the folder as `JPG.png`, `/tag icons`, `/tag local ^IJPG^Refused`. Then try a PNG wider than 128 pixels, a file over 1 MB, and a file with a name that is not 1 to 6 letters or digits.
- **Expected:** one chat line per skipped file ("Tag picture skipped", after the frame is drawn, not a flood), and the tag shows a white arrow. Pictures between 129 and 512 pixels, which loaded before 2026-10-10, are now refused.
- **Result:** [ ] pass  [ ] fail

### 9. Non-English or odd file names
- **Steps:** put a file named with non-English letters (for example an accented name) in the folder, then `/tag icons`.
- **Expected:** that file is skipped and the other pictures still list. No crash.
- **Result:** [ ] pass  [ ] fail

### 10. Replace a picture without retagging
- **Setup:** a mob tagged with `^IUP^`.
- **Steps:** swap `UP.png` for a different picture and run `/tag icons`.
- **Expected:** the tagged mob updates to the new picture without retagging.
- **Result:** [ ] pass  [ ] fail

### 11. See-through parts
- **Steps:** put a picture tag on two mobs and a shape on a third. Line them up so one picture sits in front of another mob's name.
- **Expected:** all three draw. The transparent parts never blank out what is behind them.
- **Result:** [ ] pass  [ ] fail

### 12. Distance and walls
- **Steps:** back away from a picture-tagged mob, then put a wall between you.
- **Expected:** the picture shrinks with distance like the text and hides behind walls.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 13. Viewer without the file, or on stock Zeal
- **Setup:** a second client with no picture in its folder (and, if you can, one on stock Zeal).
- **Steps:** `/tag rsay ^IEUR^x` from your client.
- **Expected:** the other sees the built-in euro (or only the text on stock Zeal). Nothing crashes or errors.
- **Result:** [ ] pass  [ ] fail

### 14. A missing folder
- **Steps:** rename the whole `tagicons` folder, `/tag icons`, tag with `^IUP^`.
- **Expected:** a chat line, a white arrow, no crash.
- **Result:** [ ] pass  [ ] fail

### 15. Device reset, zoning and relog
- **Steps:** with a picture tag up, alt-tab out of exclusive full screen; zone; camp to character select and back.
- **Expected:** no crash and no black square. With the persistence branch (test-all) the picture tag returns after a relog with its picture and guild mark, and the old save files still load.
- **Result:** [ ] pass  [ ] fail

### 16. Corrupt picture
- **Steps:** truncate a PNG (or rename a text file to `BAD.png`), `/tag icons`, `^IBAD^`.
- **Expected:** skipped with one chat line, white arrow. The header check refuses it before the game allocates memory.
- **Result:** [ ] pass  [ ] fail

### 17. Does this game's D3DX load PNG?
- **Steps:** a plain PNG with transparency, `/tag icons`, tag with it.
- **Expected:** loads. If it fails but a TGA works, report it: dropping PNG from the scan is a one-line change.
- **Result:** [ ] pass  [ ] fail

## Performance

### 18. Many pictures in view
- **Setup:** three different pictures, framerate counter on.
- **Steps:** tag 10 mobs with pictures, then 20.
- **Expected:** a small framerate cost that does not grow over time (no texture leak). Run `/tag icons` ten times and watch memory in Task Manager: it should not climb.
- **Result:** [ ] pass  [ ] fail
