# Test cases: `^MEZ^` moon and `^SLOW^` hourglass

For the local draft branch `ma-draft` (`116d3ed`, included in `206b884`). **Not compiled with MSVC, not pushed, not in the
test-all build.** Build it and install `Zeal.asi` first. It changes the moon key from `^M^`, so these cases check the old
and new keys side by side.

**Common setup:** `/tag on`, target an NPC, use `/tag local`. Finish with `/tag clear`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The moon is `^MEZ^`
- **Steps:** `/tag local ^MEZ^Mez`, then `^mez^Mez` (lower case).
- **Expected:** the moon, in either case, with the label.
- **Result:** [ ] pass  [ ] fail

### 2. The hourglass
- **Steps:** `/tag local ^SLOW^Slow`, then `^slow^Slow`.
- **Expected:** a magenta hourglass (frame, two glass triangles tip to tip, sand in the lower half); compare with `mez-slow.png`. Turns to face you, never mirrored.
- **Result:** [ ] pass  [ ] fail

## Edge cases: what must not draw a shape

### 3. A bare `^M^` no longer picks the moon
- **Steps:** `/tag local ^M^x`.
- **Expected:** text only, no shape. (On the test-all build it is still the moon: compare if you can.)
- **Result:** [ ] pass  [ ] fail

### 4. An unlisted M word
- **Steps:** `/tag local ^Mxx^x`, `^MEZZ^x`, `^MEZ x`.
- **Expected:** none draws the moon. `^MEZZ^` and `^Mxx^` draw no shape. `^MEZ x` (not closed by a caret) is not read as the moon key.
- **Result:** [ ] pass  [ ] fail

### 5. Other keys are untouched
- **Steps:** `^WP^`, `^MA^`, `^S^`, `^SLO^`, `^K^`, `^PK^`, `^1^`.
- **Expected:** the wolf, the main assist swords, the stop sign, `^SLO^` the stop sign (S), and the rest as before.
- **Result:** [ ] pass  [ ] fail

### 6. Colour uniqueness
- **Steps:** tag a mob with every shape one after another, including `^SLOW^`.
- **Expected:** each shape comes back as itself (the shape is looked up from its colour, so any shared colour would show the wrong shape). Prettyprint `/tag prettyprint on`, `/tag rsay ^SLOW^x` reads "Slow".
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 7. Old client on the other side
- **Setup:** a raid mate on stock Zeal or the current test-all build.
- **Steps:** `/tag rsay ^MEZ^x` and `/tag rsay ^SLOW^x`.
- **Expected:** `^MEZ^` shows the moon (they read the M), `^SLOW^` shows a stop sign (they read the S). No crash, nothing that contradicts the intent badly: note that a stop sign for slow is the one a viewer could misread.
- **Result:** [ ] pass  [ ] fail

### 8. An old `^M^` tag from a stock client
- **Setup:** a raid mate on stock Zeal.
- **Steps:** they send `/tag rsay ^M^x`.
- **Expected:** on the new build it shows text only (no moon). This is the intended break: confirm nothing errors.
- **Result:** [ ] pass  [ ] fail

### 9. Saved tags
- **Setup:** a tag file from before this change with a moon-coloured tag in it (test-all build, then switch builds).
- **Steps:** switch to the `ma-draft` build, log in.
- **Expected:** the saved moon is still restored as the moon (the colour is unchanged), and no crash. Retagging with `^M^` is the only thing that no longer works.
- **Result:** [ ] pass  [ ] fail

### 10. Zoning, relog, crash
- **Steps:** with `^MEZ^` and `^SLOW^` up, zone, camp and relog; end the process and restart.
- **Expected:** no crash; shapes draw correctly after a device reset (alt-tab in exclusive full screen).
- **Result:** [ ] pass  [ ] fail

### 11. Other tools that read the keys
- **Steps:** with Mimic or the agent running, `/tag rsay ^MEZ^x` and `^SLOW^x`.
- **Expected:** record what they show. The agent's key list still names the moon as `^M^`, so it may need updating before this ships.
- **Result:** [ ] pass  [ ] fail

## Performance

### 12. Mesh cost
- **Steps:** framerate counter on, tag 6 mobs with a mix of `^MEZ^` (616 vertices) and `^SLOW^`.
- **Expected:** no visible drop compared with the same number of other shapes.
- **Result:** [ ] pass  [ ] fail
