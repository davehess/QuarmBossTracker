# Test cases: guild icon and banner refresh

For the fork branch `guildicon-draft` (`dca0b85`), in the test-all build (`3c4766c`, compiled by GitHub). **Not run in game.**

**Common setup:** install the test-all build's `Zeal.asi`, `/tag on`, target an NPC, use `/tag local`.
References: `icons-vs-banners.png` (each guild's icon beside its banner) and `banners-sheet.png` (old code banner,
logo only, logo with name).

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The build starts
- **Steps:** build, install, log in.
- **Expected:** no crash at launch. The startup check that every tag colour is unique passes (no chat warning).
- **Result:** [ ] pass  [ ] fail

### 2. Burnouts icon
- **Steps:** `/tag local ^IBRN^Burnouts`.
- **Expected:** a lit rolled cigarette at a diagonal: white paper, tan filter, a dark band, a glowing ember and a wisp
  of smoke. Matches `burnouts-cigarette.png`.
- **Result:** [ ] pass  [ ] fail

### 3. Banner icons keep their colours
- **Steps:** `/tag local ^BFRE^x`, then `^BFG^x`, `^BTRQ^x`, `^BNOC^x`, `^BMGE^x`, `^BCMP^x`.
- **Expected:** each icon in the same colours as its `^I..^` icon: Freedom's blue bird, Former Glory's gold crown,
  Tranquility's layered lotus, Nocturnal's silver moon, Mass Group Ego's gold mirror, Camped's green tent and flag.
- **Result:** [ ] pass  [ ] fail

### 4. The Wolf Pack wolf
- **Steps:** `/tag local ^BWP^x`.
- **Expected:** the white wolf with black details and a thin dark rim on the gold flag; "WOLF / PACK" under it.
- **Result:** [ ] pass  [ ] fail

### 5. Full names
- **Steps:** tag `^BHBM^x`, `^BMGE^x`, `^BINT^x`, `^BTRQ^x`, `^BSOW^x`.
- **Expected:** "HERE / THERE" above the serpent and "BE / MONSTERS" below; "MASS" above the mirror and
  "GROUP / EGO" below; "INTER- / VENTION" under the ankh; "TRANQ" under the lotus; "SQUIRRELS / OF WAR" readable.
- **Result:** [ ] pass  [ ] fail

### 6. Every banner
- **Steps:** tag each of the 30 `^B<code>^` keys in turn (`/tag help` lists them).
- **Expected:** every flag shows its icon and full name, none is blank, and nothing spills past the flag's edges.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 7. Readability at distance
- **Steps:** tag a mob with `^BCON^x` (one of the smallest names), back off to normal raid distance.
- **Expected:** the icon is clear; the name may be small, but it should not smear into the flag.
- **Result:** [ ] pass  [ ] fail

### 8. Official Zeal on the other side
- **Steps:** with a second client on official Zeal, `/tag chat ^BWP^x` from the new build.
- **Expected:** the other client shows the tag the way it always did (no banner keys there). Nothing crashes on either.
- **Result:** [ ] pass  [ ] fail

### 9. Automatic guild marks
- **Steps:** with automatic guild marks on, stand near players of three different guilds.
- **Expected:** their marks use the new banners. Which guilds get a mark is unchanged.
- **Result:** [ ] pass  [ ] fail

## Performance

### 10. Many banners at once
- **Steps:** in a busy zone, tag 20 or more NPCs with different `^B..^` keys, including `^BDRF^` (the largest), and
  turn the camera around.
- **Expected:** no frame-rate drop against the same test on the previous build.
- **Result:** [ ] pass  [ ] fail
