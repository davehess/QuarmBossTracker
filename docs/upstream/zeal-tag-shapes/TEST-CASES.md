# Test cases: tag shapes (icons, numbered badges, lettered paws)

For the `tag-shapes` branch (`f777d81`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. The full list of paste-ready commands, one per
shape and per guild, is in `TRY-IN-GAME.md` in this folder; these cases say what to look for. Guild banners and icons
have their own cases in `../zeal-guild-emblems/TEST-CASES.md`.

**Common setup:** `/tag on`, target any NPC. Use `/tag local` so only your screen changes. A new tag on the same target
replaces its shape, so you can stay on one mob. Finish with `/tag clear`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The shapes that were already there are unchanged
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^R^Red`, then `^O^`, `^Y^`, `^G^`, `^B^`, `^W^`, `^P^`, `^S^` in turn (same line shape).
- **Expected:** coloured arrows for R O Y G B W, the green paw for P, the red stop sign for S, exactly as in stock Zeal.
- **Result:** [ ] pass  [ ] fail

### 2. Every new icon draws, with the right colour
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^K^Skull`, `^X^`, `^A^`, `^D^`, `^F^`, `^T^`, `^WP^`, `^M^`, `^U^`, `^N^`, `^H^`, `^$^`, `^E^` (each with a text label after the second caret).
- **Expected:** bone skull, red X, gold sword pointing down, blue diamond, green flame, purple star, wolf's head with yellow eyes, moon, brown lasso, lute, steel shield, green dollar sign, amber euro sign. Compare with `preview.png`. The text label shows under each.
- **Result:** [ ] pass  [ ] fail
- **Note:** on this branch the moon is `^M^`. The mez and slow draft renames it `^MEZ^` (see `../zeal-mez-slow-keys/`).

### 3. Numbered badges 1 to 12
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^1^#1` through `^12^#12`.
- **Expected:** a white badge with the number. `^10^`, `^11^`, `^12^` show two digits.
- **Result:** [ ] pass  [ ] fail

### 4. Lettered paws
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^P0^Paw 0`, `^PA^`, `^PK^`, `^PZ^` (the full 36 are in `TRY-IN-GAME.md`).
- **Expected:** the green paw with that letter or digit on its pad, readable.
- **Result:** [ ] pass  [ ] fail

### 5. Shapes face you and never read backwards
- **Setup:** a badge `^7^`, a paw `^PK^` and the sword `^A^` on three mobs.
- **Steps:** walk all the way round each one, and look from above and below.
- **Expected:** shapes turn with you; the 7 and the K are never mirrored; a badge seen from behind still reads the right way round.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 6. Keys that must NOT become a new shape
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^Blue^Kill`, `^FXYZ^x`, `^BC^x`, `^W^x`, `^L^x`, `^WPx^x`.
- **Expected:** `^Blue^` and `^BC^` a blue arrow; `^FXYZ^` the flame (no guild XYZ, so it falls back to `F`); `^W^` and `^WPx^` a white arrow; `^L^` text only (L was the wolf's old key and is free). `^FBC^` is Breakfast Club's flag, `^BC^` is not, and the old `^BBC^` is now just a blue arrow.
- **Result:** [ ] pass  [ ] fail

### 7. `^-^` and clear
- **Setup:** a mob with `^K^`.
- **Steps:** `/tag local ^-^Keep text`. Then `/tag clear` with the mob targeted. Then target nothing and `/tag clear`.
- **Expected:** `^-^` removes the shape and keeps the text. `/tag clear` clears that target's tag. With no target it clears every tag.
- **Result:** [ ] pass  [ ] fail

### 8. Replacing a shape
- **Setup:** a mob with `^K^`.
- **Steps:** `/tag local ^D^Diamond` on the same mob.
- **Expected:** the diamond replaces the skull; no leftover skull.
- **Result:** [ ] pass  [ ] fail

### 9. Text cap
- **Setup:** one NPC targeted.
- **Steps:** `/tag local ^FHBM^Here There Be Monsters`.
- **Expected:** the label is cut at 32 characters counting the `^key^` (reads "...Be Monster"). The shape still draws.
- **Result:** [ ] pass  [ ] fail

### 10. Help text and prettyprint
- **Steps:** `/tag` with nothing after it. Then `/tag prettyprint on` and `/tag rsay ^7^x`, `/tag rsay ^PK^x`, `/tag rsay ^FEUR^x`.
- **Expected:** the help lists the new icon, badge, paw, banner and guild lines. Prettyprint reads "(#7)", "(Paw K)", "(Banner EUR)". `/tag tooltip on` shows the shape name in the target window.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 11. A raider on stock Zeal (old client on the other side)
- **Setup:** two clients, or a raid mate on stock Zeal 1.4.8. You are on the test build.
- **Steps:** `/tag rsay ^12^x`, `^PK^x`, `^WP^x`, `^FEUR^x`, `^IMAY^x`.
- **Expected:** on stock Zeal nothing crashes or errors. `^12^` shows only text, `^PK^` a plain paw, `^WP^` a white arrow, `^FEUR^` a blue arrow, `^IMAY^` only text. No contradicting symbol (nothing that looks like a stop sign).
- **Result:** [ ] pass  [ ] fail

### 12. Target that is not drawn
- **Setup:** an NPC far away or not yet loaded.
- **Steps:** target it and `/tag local ^K^x`.
- **Expected:** "Must have a valid target with a visible nameplate to tag". No crash.
- **Result:** [ ] pass  [ ] fail

### 13. Zoning, camping and crash with shapes up
- **Setup:** tags on three mobs with different shapes.
- **Steps:** zone out and back; camp to character select and back in; end the game process from Task Manager and restart.
- **Expected:** the game never crashes or shows a garbled shape at any step. (Whether the tags come back is the persistence branch's job, not this one's.)
- **Result:** [ ] pass  [ ] fail

### 14. Alt-tab and device reset
- **Setup:** shapes up in exclusive full screen.
- **Steps:** alt-tab out and back, then change resolution.
- **Expected:** shapes keep drawing, no black or missing meshes.
- **Result:** [ ] pass  [ ] fail

### 15. Two clients on one machine
- **Setup:** two EQ clients open, both on the test build.
- **Steps:** tag a mob from one with `/tag rsay ^K^x` while both are in the same raid.
- **Expected:** the second client shows the skull on the same mob; neither client crashes.
- **Result:** [ ] pass  [ ] fail

## Performance

### 16. Many shapes at once
- **Setup:** a zone with many NPCs, framerate counter on (note the baseline with no tags).
- **Steps:** tag 6, then 12 mobs with different shapes (include a skull 264 vertices and a lasso 890 vertices).
- **Expected:** every shape draws and none flickers. Framerate drop is small and does not grow when you stand still. Note the numbers: baseline ____ fps, 6 tags ____ fps, 12 tags ____ fps.
- **Result:** [ ] pass  [ ] fail
