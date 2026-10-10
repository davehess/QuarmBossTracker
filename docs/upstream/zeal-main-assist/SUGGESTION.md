![Main assist marker and %tid](https://raw.githubusercontent.com/davehess/Zeal/showcase/showcase/posters/main-assist-banner.png)

# Main assist marker, `%tid`, and `/target` by tag

*Fork branch `ma-draft` (`206b884`). Status: draft; in the test-all build, compiled by GitHub on 2026-10-10, not yet run in game.*

![The main assist marker, front and turned: crossed swords with a target on the crossing](mainassist-swords.png)

**What**
- A new tag, `^MA^`: two crossed swords with a target where they cross, for the main assist. Only one player carries it at a time.
- A new chat code, `%tid` (also `%targetid`): your target's spawn id.
- `/target <tag text>` targets the visible entity carrying that tag, and `/target ^MA^` finds a player by their marker.

**Why**
Everyone should be able to see who the main assist is, then `/target` and `/assist` without scrolling the raid window. Timers and tools that listen to `/pipe` need the target's spawn id to tell mobs with the same name apart. A player can carry a tag shape but not tag text, so the marker has to be findable by shape.

**How**
Take main assist: target yourself, then `/tag chat ^MA^`. Everyone else: `/target ^MA^`, then `/assist`. A new `^MA^` removes it from the previous holder, in view and saved. `%tid` works wherever `%th` and `%loc` do, including `/pipe`. `/target foo` tries tags first and falls back to the game's own `/target` when nothing matches. Do not use `/tag chat clear` to hand over: it clears every tag on every receiving client. A client without this change shows the moon for `^MA^`.

**How tested**
- Honest status: not compiled with Visual Studio and not run in game. It is not in the test-all build.
- The shape file builds clean with g++ and the mesh was previewed off the game (352 vertices, colour checked unique against every other tag).
- The next step is a build and the cases in `TEST-CASES.md`, including a two-client check that the marker moves.

**Try it:** in the fork's test-all build (https://github.com/davehess/Zeal/releases/tag/test-all-build), `3c4766c` or later.
