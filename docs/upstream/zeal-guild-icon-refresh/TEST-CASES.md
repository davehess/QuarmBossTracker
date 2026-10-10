# Test cases: guild icon and banner refresh

For the fork branch `guildicon-draft` (`bbd5fe0`). **Not compiled with MSVC, not run in game.**

**Common setup:** build `guildicon-draft`, install `Zeal.asi`, `/tag on`, target an NPC, use `/tag local`.
Reference: `banners-sheet.png`. For each guild it shows the old code banner, then the logo (L), then the logo with the name (LN).

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

### 3. Banner with a dark logo
- **Steps:** `/tag local ^BWP^x`, then `^BEUR^x`, then `^BLSF^x`.
- **Expected:** a near-black wolf, euro sign and dollar sign, each readable all the way down the flag.
- **Result:** [ ] pass  [ ] fail

### 4. Banner with a light logo
- **Steps:** `/tag local ^BECG^x`, then `^BSEN^x`.
- **Expected:** a near-white anchor and tower. Their shaded parts are darker than the logo, not lost against the flag.
- **Result:** [ ] pass  [ ] fail

### 5. Banners that keep the icon's own colour
- **Steps:** `/tag local ^BBRN^x`, `^BHC^x`, `^BBC^x`.
- **Expected:** the cigarette, mug and egg in the same colours as their `^I..^` icons.
- **Result:** [ ] pass  [ ] fail

### 6. Every banner
- **Steps:** tag each of the 30 `^B<code>^` keys in turn (`/tag help` lists them).
- **Expected:** every flag shows a logo, none is blank, and no logo spills past the flag's edges.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 7. Logo plus name build
- **Steps:** set `kBannerStyle = BannerStyle::LogoName`, rebuild, tag `^BMAY^x`, `^BWP^x`, `^BDRF^x`, `^BSOS^x`.
- **Expected:** "MAYHEM" on one line; "WOLF / PACK" and "THE / DRIFT" on two lines; the code "SOS" under the eye.
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
- **Steps:** in a busy zone, tag 20 or more NPCs with different `^B..^` keys and turn the camera around.
- **Expected:** no frame-rate drop against the same test on the previous build.
- **Result:** [ ] pass  [ ] fail
