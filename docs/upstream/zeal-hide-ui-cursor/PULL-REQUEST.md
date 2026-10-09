# Zeal PR draft — draw a cursor while the UI is hidden (F10)

*Drafted 2026-10-09 against Zeal v1.4.8 (`50dc9a4`). Branch **`hide-ui-cursor`** on the
guild lead's fork (github.com/davehess/zeal/tree/hide-ui-cursor, one commit, `2433493`); the
same change is `0001-hide-ui-cursor.patch` here. It is merged into `test-all` (`4014c49`), so
Mimic → Settings → Zeal → Test build installs it. Not compiled here (no MSVC) and not yet run
in game.*

## Why

The guild lead, 2026-10-09: *"BUILT in hide ui hides the mouse and zeal could show it."* F10
hides the UI and the game stops drawing its mouse cursor with it, but the mouse still works,
and you still need it to click mobs in the world. Nothing else can bring the cursor back: the
game draws it as a UI sprite, and the newer eqw.dll blanks the Windows cursor over the game
window (`SetCursor(NULL)`). So Zeal draws its own (DECISIONS-2026-09-21 §13 has the research;
this is option B from 2026-10-09, §213).

## What changes (201 lines added, 7 files)

- New `HideUiCursor` (`hide_ui_cursor.{h,cpp}`) registered on `callback_type::RenderUI`.
- **When it draws:** setting on, in game, `!is_gui_visible()` (F10, screen mode 3), not in
  right-button mouse look, and EverQuest is the foreground window. If the game window is
  unknown it assumes focus rather than never drawing.
- **Where:** `mouse_client_x/y` (game-resolution pixels; 32767 = unknown, skipped).
- **What:** the classic 7-point arrow, white fill (5 triangles, no texture) with a 1 px
  black outline, tip on the click point. 20 px tall at 1080p, scaled with screen height
  (clamped 0.8×–3×).
- **Render state:** `D3DRenderStateStash` / `D3DTextureStateStash` and the full-screen
  viewport swap, as `bitmap_font.cpp` and `floating_damage.cpp` do.
- **Setting:** `ShowCursorWithUiHidden` in `[Zeal]`, **on by default**; `/uicursor`
  toggles, `/uicursor on|off` sets it. README: one entry.

## Not in this PR

- A checkbox in Zeal's options window: needs new XML in both `EQUI_Tab_General.xml` files
  (the `Zeal_SelfClickThru` pattern) plus a `ui_options.cpp` callback. A follow-up commit.
- ZealCam left-button panning: its "hide cursor" state is private to `CameraMods`, so the
  arrow may stay drawn at the pinned spot while panning (test step 4).
- `CHANGELOG.md`: upstream writes it per release.

## Test plan (in game)

1. Press F10 and move the mouse: a white arrow with a black border follows it. F10 again:
   only the game's own cursor, never two.
2. Hotspot: put the arrow's tip on a small target's feet and left-click; it targets that
   mob. Repeat in windowed mode with a window size that differs from the game resolution.
3. If the arrow freezes or sits in a corner with F10 on, the game stops updating
   `mouse_client_x/y` in that mode, and the fix is reading `GetCursorPos` and scaling it
   the way `camera_mods.cpp` does. Report it.
4. Hold right mouse to look around with the UI hidden: the arrow goes and comes back on
   release. Also try ZealCam's left-button pan.
5. Alt-tab away with the UI hidden and back: no arrow while EverQuest is in the background.
6. Zone with the UI hidden: no arrow on the loading screen or at character select.
7. `/uicursor off`, `/uicursor`, `/uicursor on`: each prints the state, and the choice
   survives a restart (`ShowCursorWithUiHidden` in `[Zeal]`).
8. With F10 on, the map, nameplates, target ring and floating damage look as before (the
   saved render states came back).
9. The arrow is never hidden under the world or flickering. `RenderUI` runs before the
   game's own UI pass; if the arrow is covered, the draw needs to move later in the frame.

## Before opening the PR

Same as the other branches: build, run the test plan, then re-author the commit as yours
(`git commit --amend --no-edit --reset-author`) and open it against CoastalRedwood/Zeal.
