# Test cases: guild banners, guild icons and automatic guild marks

For the `tag-shapes` branch (`f777d81`, banners and icons since `c2a5333`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. The paste-ready list of all 30 banners and 30 icons is
in `../zeal-tag-shapes/TRY-IN-GAME.md`. The twelve automatic-mark checks come from `docs/DECISIONS-2026-09-21.md` §216.

**Common setup:** `/tag on`, target an NPC. Use `/tag local`. Guild names match the table by letters and digits only, so
"&" versus "and" will not match: compare `/tag guilds` with the nameplate text if a guild shows no mark. A guild seen
before the client loaded its guild list stays unmarked until the next UI reload.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Banners and icons (tagged by hand)

### 1. The guild list
- **Steps:** `/tag guilds`.
- **Expected:** it prints every code (30 guilds).
- **Result:** [ ] pass  [ ] fail

### 2. Every banner
- **Steps:** `/tag local ^FWP^FWP Wolf Pack`, then each other `^F<code>^` from `TRY-IN-GAME.md`.
- **Expected:** a swallowtail flag in the guild's own colour with its code on it. Banners were not in the 2026-09-26 screenshots, so look closely at the code lettering for all 30.
- **Result:** [ ] pass  [ ] fail

### 3. Every icon
- **Steps:** `/tag local ^IWP^IWP Wolf Pack`, then each other `^I<code>^`. Compare with `../zeal-tag-shapes/guilds.png`.
- **Expected:** the icon for each guild. Wolf Pack, Europa and Loot & Some Fun show the wolf, the euro and the dollar sign.
- **Result:** [ ] pass  [ ] fail

### 4. Codes in either case
- **Steps:** `/tag local ^imay^x`, `^iMay^x`, `^bmay^x`.
- **Expected:** the Mayhem icon or banner, as for upper case.
- **Result:** [ ] pass  [ ] fail

### 5. Keys that look like guild keys but are not
- **Steps:** `/tag local ^Blue^x`, `^FXYZ^x`, `^BC^x`, `^I^x`.
- **Expected:** `^Blue^` and `^BC^` are blue arrows and `^FXYZ^` is the flame (Breakfast Club's flag is `^FBC^`); `^I^` alone is text only.
- **Result:** [ ] pass  [ ] fail

## Automatic guild marks (`/tag guildmarks`)

### 6. Default is off-by-choice
- **Setup:** a fresh profile (or note your current mode first).
- **Steps:** `/tag guildmarks` alone.
- **Expected:** it prints the mode, "tagged" on a fresh profile. With "tagged", players show no automatic mark.
- **Result:** [ ] pass  [ ] fail

### 7. Auto shows listed guilds
- **Setup:** near players from listed guilds, unguilded players and players from an unlisted guild.
- **Steps:** `/tag guildmarks auto`.
- **Expected:** listed guilds' icons appear over their players. Nothing over unguilded or unlisted-guild players.
- **Result:** [ ] pass  [ ] fail

### 8. /anon and /roleplay players
- **Setup:** a player with /anon or /roleplay on (ask a guildmate).
- **Steps:** look at them in `auto` mode.
- **Expected:** no mark on them.
- **Result:** [ ] pass  [ ] fail

### 9. Range
- **Steps:** back away from marked players.
- **Expected:** marks vanish past about 150 units.
- **Result:** [ ] pass  [ ] fail

### 10. `off` hides other people's guild tags but not plain symbols
- **Setup:** a second client tags a mob `/tag rsay ^FMAY^x`, another `^E^x`, `^$^x`, `^WP^x`.
- **Steps:** `/tag guildmarks off`.
- **Expected:** the `^B...^` and `^I...^` tags are hidden; `^E^`, `^$^` and `^WP^` still show.
- **Result:** [ ] pass  [ ] fail

### 11. Back to `tagged`
- **Steps:** `/tag guildmarks auto`, then `/tag guildmarks tagged`.
- **Expected:** only the automatic marks go. Tags people placed stay.
- **Result:** [ ] pass  [ ] fail

### 12. A player with another shape keeps it
- **Setup:** a guildmate in a listed guild, tagged with `/tag local ^H^`.
- **Steps:** `auto` mode.
- **Expected:** the shield shows, not their guild icon.
- **Result:** [ ] pass  [ ] fail

### 13. Guild pictures win in auto mode
- **Setup:** a picture `<code>.png` in `uifiles/zeal/tagicons` (see the tag pictures change).
- **Steps:** `/tag icons`, then look at a player of that guild in `auto`. Remove the file and `/tag icons` again.
- **Expected:** the picture is used; removing it falls back to the built-in icon.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 14. Zoning, relog and guild-list loading
- **Steps:** with `auto` on, zone, camp to character select and back, and log in straight into a crowded zone.
- **Expected:** no crash. A guild seen before the guild list loaded may stay unmarked until a UI reload: note it, do not count it a failure.
- **Result:** [ ] pass  [ ] fail

### 15. Another client on stock Zeal
- **Steps:** `/tag rsay ^FMAY^x` and `^IMAY^x`.
- **Expected:** they see a blue arrow and nothing but the text. Auto marks are local to your screen and never sent.
- **Result:** [ ] pass  [ ] fail

### 16. Mark persistence after a relog
- **Setup:** test-all build, a guild-mark tag on a mob.
- **Steps:** relog.
- **Expected:** the tag returns with its guild-mark flag, so `/tag guildmarks off` still hides it afterwards.
- **Result:** [ ] pass  [ ] fail

## Performance

### 17. Crowd framerate
- **Setup:** a zone with about 70 players in view (a crowded hub), framerate counter on.
- **Steps:** note the framerate in `tagged`, then in `auto`.
- **Expected:** no large drop. Note: tagged ____ fps, auto ____ fps.
- **Result:** [ ] pass  [ ] fail
