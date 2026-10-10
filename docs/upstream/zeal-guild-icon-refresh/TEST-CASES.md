# Test cases: guild icon and banner refresh (placeholder)

For the local draft branch `guildicon-draft` (last commit `b9f0cff`, with more uncommitted work in the working copy at
the time of writing). **Placeholder: not committed as a whole, not compiled with MSVC, not run in game.** Firm these up
when the branch is final: replace the sample guilds below with the list of guilds whose marks changed.

**Common setup:** build `guildicon-draft`, install `Zeal.asi`, `/tag on`, target an NPC, use `/tag local`.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The build starts
- **Steps:** build, install, log in.
- **Expected:** no crash at launch. The startup check that every tag colour is unique passes (no chat warning).
- **Result:** [ ] pass  [ ] fail

### 2. Burnouts icon
- **Steps:** `/tag local ^IBRN^Burnouts`.
- **Expected:** a lit rolled cigarette lying at a diagonal: white paper, tan filter and band, charred edge, glowing ember, a wisp of smoke. Compare with `burnouts-cigarette.png`. The guild colours are kept.
- **Result:** [ ] pass  [ ] fail

### 3. Banners carry logo and name
- **Steps:** `/tag local ^B<code>^x` for each changed guild.
- **Expected:** the flag shows the guild's logo parts in a colour that contrasts with the flag, and the name or code is readable at a distance. Check one with a light logo (shaded toward white) and one with a dark logo (shaded toward black).
- **Result:** [ ] pass  [ ] fail

### 4. Unchanged guilds are untouched
- **Steps:** tag three guilds that were not changed, `^B..^` and `^I..^`, and compare with `../zeal-tag-shapes/guilds.png`.
- **Expected:** identical to before.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 5. Every banner and icon, one by one
- **Steps:** all 30 banners and 30 icons from `../zeal-tag-shapes/TRY-IN-GAME.md`.
- **Expected:** each is distinct and readable. Note any pair that looks alike at distance.
- **Result:** [ ] pass  [ ] fail

### 6. Distance and angle
- **Steps:** look at a banner from 10, 50 and 150 units, from the front, side and behind.
- **Expected:** the name or logo stays readable in front; from behind it is not mirrored in a confusing way.
- **Result:** [ ] pass  [ ] fail

### 7. Automatic guild marks still work
- **Steps:** `/tag guildmarks auto` near a changed guild's players.
- **Expected:** the refreshed icon is used.
- **Result:** [ ] pass  [ ] fail

### 8. Picture files still win
- **Steps:** a `<code>.png` for a changed guild in `tagicons`, `/tag icons`, tag with `^I<code>^`.
- **Expected:** the picture is used; remove it and the refreshed built-in icon returns.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 9. Old client on the other side
- **Steps:** `/tag rsay ^BBRN^x` and `^IBRN^x` to a raid mate on stock Zeal or the test-all build.
- **Expected:** the stock client shows what it did before (a blue arrow, or only the text, or the previous icon on the test-all build). No crash.
- **Result:** [ ] pass  [ ] fail

### 10. Zoning, relog, device reset
- **Steps:** with several refreshed marks up, zone, relog, alt-tab out of exclusive full screen.
- **Expected:** no crash, no missing or garbled meshes.
- **Result:** [ ] pass  [ ] fail

### 11. Two clients
- **Steps:** two clients, one tags `/tag rsay ^BBRN^x`.
- **Expected:** both show the same refreshed banner.
- **Result:** [ ] pass  [ ] fail

## Performance

### 12. Mesh size
- **Steps:** tag 12 mobs with refreshed banners, framerate counter on.
- **Expected:** no visible drop. Note the vertex counts of the largest new mesh against the old largest (the old icons ran 16 to 1,440 vertices) so a heavy logo does not blow the budget.
- **Result:** [ ] pass  [ ] fail
