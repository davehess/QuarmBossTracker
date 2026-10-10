# Test cases: cursor while the UI is hidden (F10)

For the `hide-ui-cursor` branch (`2433493`) or the fork's test-all build,
https://github.com/davehess/Zeal/releases/tag/test-all-build (it carries this change). Nine steps from the pull
request draft, plus safety and performance cases. Not yet run in game.

**Common setup:** log in to a zone with mobs nearby, windowed and full screen both if you can.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. The arrow follows the mouse
- **Steps:** press F10 and move the mouse. Press F10 again.
- **Expected:** a white arrow with a black border follows the mouse. With the UI back on, only the game's own cursor shows, never two.
- **Result:** [ ] pass  [ ] fail

### 2. The tip is the click point
- **Steps:** UI hidden. Put the tip on a small mob's feet and left-click. Repeat in windowed mode with a window size that differs from the game resolution.
- **Expected:** it targets that mob in both cases.
- **Result:** [ ] pass  [ ] fail

### 3. Setting survives a restart
- **Steps:** `/uicursor off`, `/uicursor`, `/uicursor on`. Restart the game.
- **Expected:** each prints the state; the choice survives a restart (`ShowCursorWithUiHidden` in `[Zeal]` of `zeal.ini`). On by default for a fresh profile.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 4. Mouse look and ZealCam panning
- **Steps:** UI hidden, hold the right button to look around; release. Then try ZealCam's left-button pan.
- **Expected:** the arrow goes while you look and comes back on release. During a left-button pan it may stay at the pinned spot: note what you see.
- **Result:** [ ] pass  [ ] fail

### 5. Alt-tab
- **Steps:** UI hidden, alt-tab away and back.
- **Expected:** no arrow while EverQuest is in the background; it returns when you come back.
- **Result:** [ ] pass  [ ] fail

### 6. Zoning and character select
- **Steps:** UI hidden, zone; camp to character select.
- **Expected:** no arrow on the loading screen or at character select.
- **Result:** [ ] pass  [ ] fail

### 7. Resolution and scaling
- **Steps:** UI hidden at 1080p, then at a lower and a higher resolution.
- **Expected:** the arrow is about 20 pixels tall at 1080p and scales with screen height (never smaller than 0.8 or larger than 3 times).
- **Result:** [ ] pass  [ ] fail

## Safety

### 8. The arrow freezes or sits in a corner
- **Steps:** UI hidden, move the mouse across the whole screen.
- **Expected:** it tracks everywhere. If it freezes or sticks in a corner, the game is not updating the mouse position in F10 mode: report it, because the fix is to read the Windows cursor and scale it.
- **Result:** [ ] pass  [ ] fail

### 9. Other overlays are unharmed
- **Steps:** UI hidden, with the map, nameplates, target ring and floating damage on.
- **Expected:** they look as before (the saved render states came back). No tint, missing text or wrong blending afterwards.
- **Result:** [ ] pass  [ ] fail

### 10. The arrow is always on top and steady
- **Steps:** UI hidden, move over a mob, a nameplate, a spell effect.
- **Expected:** never hidden under the world, never flickering. If it is covered, the draw needs to move later in the frame: report it.
- **Result:** [ ] pass  [ ] fail

### 11. Crash recovery and a second client
- **Steps:** with the setting on, end the game process, restart, and also run two clients on one machine and press F10 in each.
- **Expected:** no crash. Each client draws its own arrow only while it is the foreground window.
- **Result:** [ ] pass  [ ] fail

### 12. Stock Zeal, or with the setting off
- **Steps:** `/uicursor off`, F10. Or run stock Zeal.
- **Expected:** no arrow from Zeal, exactly as before.
- **Result:** [ ] pass  [ ] fail

## Performance

### 13. Cost while the UI is hidden
- **Steps:** framerate counter on, note the framerate with the UI hidden and `/uicursor off`, then `/uicursor on`.
- **Expected:** no measurable difference (five triangles and an outline). Note: off ____ fps, on ____ fps.
- **Result:** [ ] pass  [ ] fail
