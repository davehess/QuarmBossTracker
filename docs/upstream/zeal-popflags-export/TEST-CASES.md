# Test cases: export #popflags on /camp

For the `popflags-export` branch (`195433e`) or, once merged there, the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build. Nothing below has been run in game yet.

**Common setup:** a character in game, standing in a safe spot, in the Planes of Power era server. Open the EverQuest folder
to look for `<Name>-PoPFlags.txt`. Delete any old copy before each case. In a second window type `#popflags all` once by hand
first and keep that chat output to compare against (the "reference reply").

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. Export on camp with the option on
- **Setup:** Zeal options, General tab, "Export data on /camp" ticked.
- **Steps:** type `/camp`. Stay sitting until you reach character select.
- **Expected:** `<Name>-PoPFlags.txt` exists. First lines are `Character`, `Timestamp`, `Command` (each with a tab), then `---`,
  then the reply lines. The inventory, spellbook and Quarmy files are written as before.
- **Result:** [ ] pass  [ ] fail

### 2. Option off writes nothing
- **Setup:** "Export data on /camp" unticked.
- **Steps:** `/camp` and wait for character select.
- **Expected:** no `<Name>-PoPFlags.txt`, and no `#popflags` reply scrolls in chat during the camp.
- **Result:** [ ] pass  [ ] fail

### 3. On-demand command
- **Setup:** option off or on, standing in game.
- **Steps:** `/outputfile popflags`, then wait about 3 seconds. Then `/outputfile popflags my_flags` after 10 seconds.
- **Expected:** a chat line "Requesting #popflags...", the reply, then "PoP flags saved to: ...". The second run writes
  `my_flags.txt` instead. `/out popflags` and `/output popflags` work as aliases.
- **Result:** [ ] pass  [ ] fail

### 4. File matches the in-game reply
- **Steps:** compare the file after the `---` line with the reference reply from setup.
- **Expected:** every line of the reply is in the file, in order, with no player chat, combat, NPC speech or camp message mixed
  in. Write down any line that is missing or extra.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 5. Character with no flags
- **Setup:** a new character with no PoP flags.
- **Steps:** `/outputfile popflags`.
- **Expected:** if the server answers with a "no flags" style line, it is saved as it is. If it answers with nothing, no file
  and "No reply to #popflags, nothing saved."
- **Result:** [ ] pass  [ ] fail

### 6. Server does not answer
- **Setup:** a server or zone where `#popflags` is not available, or send it with the network lagging.
- **Steps:** `/outputfile popflags`.
- **Expected:** after 3 seconds "No reply to #popflags, nothing saved.", no file written, no repeat requests.
- **Result:** [ ] pass  [ ] fail

### 7. Two characters in a row
- **Steps:** with the option on, `/camp` character A to character select, log in character B, wait 15 seconds, `/camp`.
- **Expected:** `A-PoPFlags.txt` holds A's flags and `B-PoPFlags.txt` holds B's. Neither file has the other's lines.
- **Result:** [ ] pass  [ ] fail

### 8. Camp cancelled by moving
- **Steps:** `/camp`, then stand up and walk before the camp finishes.
- **Expected (by design):** the file is still written, the same as the inventory, spellbook and Quarmy files, which are also
  written when the camp starts. There is no partial file: it is written once, whole, 3 seconds after the request.
- **Result:** [ ] pass  [ ] fail

### 9. Pressing camp repeatedly
- **Steps:** `/camp`, move to cancel, `/camp` again within 10 seconds, several times.
- **Expected:** `#popflags` is sent once. Check the server did not print the reply more than once.
- **Result:** [ ] pass  [ ] fail

### 10. Chat during the window
- **Setup:** a second player (or a trigger) sending you tells, group chat and guild chat.
- **Steps:** `/outputfile popflags` while they chat.
- **Expected:** none of their lines are in the file.
- **Result:** [ ] pass  [ ] fail

### 11. The reply colour
- **Steps:** if case 4 shows lines missing, note the colour of the reply in chat and report it. The filter keeps lines in the
  server's small colour ids and drops Zeal's user colours.
- **Expected:** all reply lines kept. A missing line means the reply uses a colour the filter drops.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 12. Camp still works the same
- **Steps:** `/camp` with the option on, with a hotkey button and from the Camp button on the inventory window.
- **Expected:** auto-sit, the camp timer and arrival at character select are unchanged. No stall at camp start.
- **Result:** [ ] pass  [ ] fail

### 13. Camp refused (a window blocking slash commands)
- **Steps:** open a dialog that blocks slash commands, then press the camp hotkey.
- **Expected:** no `#popflags` is sent (the other exports still run as before).
- **Result:** [ ] pass  [ ] fail

### 14. Export format 1 (host tag)
- **Steps:** `/outputfile format 1`, then `/outputfile popflags`.
- **Expected:** the file name carries the host tag like the other exports, for example `<Name>-PoPFlags_<host>.txt`.
- **Result:** [ ] pass  [ ] fail

### 15. Zoning or logging out inside the 3 seconds
- **Steps:** `/outputfile popflags`, then zone straight away. Also run it and `/camp` out within 3 seconds.
- **Expected:** no crash. The file is written with whatever arrived (or nothing if nothing did).
- **Result:** [ ] pass  [ ] fail

## Performance

### 16. Busy raid chat
- **Setup:** in a raid with heavy combat spam, framerate counter on.
- **Steps:** `/outputfile popflags`.
- **Expected:** no visible framerate dip during the 3 seconds, and the file stays small (the capture stops at 400 lines).
- **Result:** [ ] pass  [ ] fail
