# Test cases: main assist marker, `%tid`, and `/target` by tag

For the local draft branch `ma-draft` (`206b884`). It is **not compiled with MSVC, not pushed, and not in the
test-all build**: build it first (the fork's README has the msbuild line) and install the resulting `Zeal.asi`. Cases 1
to 3 need one client; 4 to 9 need two clients in one raid.

**Common setup:** `/tag on`. A first build that does not compile is itself a result: note the errors under case 1.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## `%tid`

### 1. The build starts
- **Steps:** build `ma-draft`, copy `Zeal.asi`, start the game, log in.
- **Expected:** no crash at launch; the options window shows the build name.
- **Result:** [ ] pass  [ ] fail

### 2. `%tid` and `%targetid`
- **Steps:** target an NPC, `/pipe test %tid`, `/pipe test %targetid` and `/log %tid`.
- **Expected:** the number equals the target's spawn id (the `/tag` message's id for that mob). With no target, `%tid` is empty. Existing codes (`%th`, `%loc`, `%t`) still work, including `%t` in the same line.
- **Result:** [ ] pass  [ ] fail

### 3. Same-name mobs
- **Steps:** target three mobs that share a name, `/pipe x %t %tid` each time.
- **Expected:** the name repeats and the id differs.
- **Result:** [ ] pass  [ ] fail

## The `^MA^` marker

### 4. It draws
- **Steps:** `/tag local ^MA^MA` on an NPC.
- **Expected:** two crossed swords with a target (ring and dot) on the crossing; symmetrical, nothing z-fighting; turns to face you. Compare with `mainassist-swords.png`. Look from every side.
- **Result:** [ ] pass  [ ] fail

### 5. Take main assist
- **Setup:** two clients in a raid, A and B.
- **Steps:** A targets self (Target Self) and `/tag chat ^MA^`.
- **Expected:** both clients show the swords over A.
- **Result:** [ ] pass  [ ] fail

### 6. It moves, never doubles
- **Steps:** B takes it the same way.
- **Expected:** the swords leave A and show over B on both clients; only one marker exists. Also true after A zones and returns (the saved player tag is removed too).
- **Result:** [ ] pass  [ ] fail

### 7. Everyone finds the main assist
- **Steps:** a third client C: `/target ^MA^`, then `/assist`.
- **Expected:** C targets the player with the swords, then assists. With no `^MA^` holder in view, the game's own `/target ^MA^` runs instead (it will not find anything by that name) and nothing crashes. If you hold the marker yourself, `/target ^MA^` cannot target you: use Target Self.
- **Result:** [ ] pass  [ ] fail

## `/target` by tag

### 8. `/target <text>` tries tags first
- **Setup:** a mob tagged `/tag local Foo` (text must match whole), and a different mob named like "a foo".
- **Steps:** `/target Foo`.
- **Expected:** the tagged visible mob (nearest wins). With nothing tagged "Foo", `/target Foo` behaves like the game's normal `/target`. Plain `/target` with no argument still clears the target, and `/tag off` falls through to the game's `/target`.
- **Result:** [ ] pass  [ ] fail

### 9. Never use `/tag chat clear` to hand over
- **Steps:** with several tags up on both clients, send `/tag chat clear` from one.
- **Expected:** it wipes all tags on every receiving client (this is existing behaviour and is why the README warns against it). Confirm so nobody learns it mid-raid.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 10. Old client on the other side
- **Setup:** a raid mate on stock Zeal or the current test-all build.
- **Steps:** A sends `/tag chat ^MA^`.
- **Expected:** they see the moon (it reads the M) and nothing crashes. They can still `/target` normally.
- **Result:** [ ] pass  [ ] fail

### 11. Zoning, relog, crash
- **Steps:** with `^MA^` on a player, zone, camp and relog; end the process and restart.
- **Expected:** no crash. With persistence on, the holder's marker returns by name, and still only one exists.
- **Result:** [ ] pass  [ ] fail

### 12. A player whose name starts with "Ma"
- **Steps:** `/target Ma` where a player named "Ma..." is nearby and nobody is tagged "Ma".
- **Expected:** the game's own `/target` targets by name as before. The marker is found only through `^MA^`, never by a name prefix.
- **Result:** [ ] pass  [ ] fail

## Performance

### 13. Marker cost
- **Steps:** framerate counter on, put `^MA^` on one player in a crowd, then 20 `/target Foo` presses in a row.
- **Expected:** no hitch; the 352-vertex marker costs about the same as the sword icon.
- **Result:** [ ] pass  [ ] fail
