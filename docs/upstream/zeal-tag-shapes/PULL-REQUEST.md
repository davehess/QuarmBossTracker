# Zeal PR draft — six icon shapes for `/tag`

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). Branch **`tag-shapes`** on
the guild lead's fork (github.com/davehess/zeal/tree/tag-shapes, one commit,
`fefa1c0`); the same change is `0001-tag-icon-shapes.patch` here. Not compiled
yet (a cloud session has no MSVC or Windows SDK), so it needs a local build before
the PR. The new geometry file compiles clean under g++ `-Wall -Wextra
-Wconversion -Wshadow`, and clang-format with Zeal's own style reports nothing on
the changed lines.*

**Where it came from:** the guild lead, 2026-09-25: *"We should make another
branch for additional zeal tag icons. see about generating some of these"*, with
a reference strip of six raid markers numbered 1–6 (skull, red X, gold sword,
blue diamond, green flame, purple star). The upstream maintainer had said in the
Quarm Discord that the tag shapes today are the ~6 arrow colours, the red
octagon stop sign and the pet paw, and that a skull was tried but *"I wasn't happy
with how the 2-d extrusion approach looked and ran out of time."*

**What's different about this approach:** a single extruded outline cannot carry
a skull's eye sockets or teeth. Here every shape is several flat parts, each
convex so it triangulates as a simple fan. Concave outlines come from overlapping
parts, and detail is a part standing 0.03 proud of both faces in a dark or light
accent tone: eye sockets, nose, teeth, the sword's fuller, the diamond's facet,
the flame's core, the star's inner star. No textures and no concave
triangulation, drawn by the same vertex-coloured, unlit triangle-strip path as
the arrow, octagon and paw.

![preview](preview.png)

*`preview.png`: each shape face-on and turned 35°, over a dusk-sky and a
sandstone background. It is rendered off-client from the real geometry code:
`preview/dump.cpp` compiles Zeal's `tag_shapes.cpp` unchanged, decodes the triangle
strip exactly as Direct3D does and checks every index is in range and no join
makes a stray triangle. `preview/preview.py` rasterises the result with the same
gradient colouring as `TagArrows`. To regenerate after a geometry change:*

```
g++ -std=c++20 -I<zeal>/Zeal -o dump preview/dump.cpp <zeal>/Zeal/tag_shapes.cpp
./dump > meshes.json && python3 preview/preview.py meshes.json preview.png
```

| Key | Shape | Colour | Vertices | Triangles drawn |
|---|---|---|---|---|
| `^1^` | Skull | bone `e8e2d1` | 264 | 492 |
| `^2^` | X | red `e81c1c` | 20 | 32 |
| `^3^` | Sword (points down) | gold `f2c02a` | 88 | 156 |
| `^4^` | Diamond | blue `2e8cf5` | 20 | 32 |
| `^5^` | Flame | green `3cd83c` | 216 | 416 |
| `^6^` | Star | purple `b55cf2` | 44 | 80 |

For scale: the arrow is 182 vertices and the paw 560.

## Build and test locally

Same clone as the Bandolier branch (`C:\dev\zeal-pr\Zeal`). In a Developer
Command Prompt for VS 2022, and with no inline `# comments` (cmd.exe passes them
through to the command):

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git switch -c tag-shapes origin/tag-shapes
git commit --amend --no-edit --reset-author
git push --force-with-lease origin tag-shapes
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=tagshapes Zeal.sln
```

The amend makes the commit yours before the PR, the same as for Bandolier. Then,
with EverQuest closed:

```
copy C:\dev\zeal-pr\Zeal\Release\Zeal.asi A:\EQ\Zeal.asi
```

`A:\EQ\Zeal.asi.v147-backup` already holds the real 1.4.7, so don't back up again.
Restore it when done with `copy A:\EQ\Zeal.asi.v147-backup A:\EQ\Zeal.asi`. This
branch starts from 1.4.7, not from the Bandolier branch, so the build does not
include the Bandolier filter.

---

## PR title

`Add six icon shapes for /tag: skull, X, sword, diamond, flame, star`

## PR body (paste as-is, and attach preview.png)

Tags can show a coloured arrow, the stop sign or the paw today. Raid marking wants
a few more distinct symbols — the familiar skull / X / sword / diamond / flame /
star set — so a caller can say "kill skull, sheep diamond" and everyone sees a
different shape.

**What changes**

- New shape keys `1`–`6` after `^` (skull, red X, gold sword, blue diamond, green
  flame, purple star), each with its own fixed colour like the paw and stop sign.
  Older clients ignore an unknown key, so they still show the tag text, just
  without the shape.
- `tag_shapes.cpp/.h` (new): the geometry, with no DirectX dependency. Every shape
  is flat parts extruded to the same thickness as the octagon and paw. Each part
  is convex (or star-shaped about its centre) so it triangulates as a simple fan.
  Concave outlines come from overlapping parts, and detail is a part standing
  slightly proud of both faces in a dark or light accent tone. No textures and no
  concave triangulation.
- `TagArrows` builds the meshes at startup, colours them with the existing face
  gradients plus the two accent tones, and sizes the vertex buffer to hold every
  shape at once alongside the arrow colour cache.
- The shape is now picked from the tag's own colour, before a nameplate colour is
  substituted, so a nameplate colour can no longer collide with a shape's colour.
- Prettyprint, the target tooltip and `/tag` help name the new shapes.
- README: the new keys and an example.

The attached preview is rendered off-client from `tag_shapes.cpp` itself: the
triangle strips are decoded as Direct3D draws them, with the same gradient
colouring.

**Test plan**

1. Build; `/tag on`; target an NPC; `/tag local ^1^Kill first` — a skull above
   the nameplate with the text "Kill first".
2. `^2^` through `^6^` on other NPCs — X, sword, diamond, flame, star, each
   turning to face you as you walk around it like the paw and stop sign do.
3. `^R^`, `^P^`, `^S^` — the arrow, paw and stop sign are unchanged.
4. All six at once, plus a few arrow colours — every shape draws (the vertex
   buffer holds them all) and none flickers.
5. `/tag local ^-^` clears the shape and leaves the text.
6. With `/tag prettyprint on`, an rsay tag reads "… => <name> (Skull)"; with
   `/tag tooltip on`, the target window names the shape.
7. A client without this change receiving `^1^Kill first` shows "Kill first" with
   no shape.

---

## Our side, once it is merged upstream

Nothing ships to our fleet until it is in an official Zeal release. Then:

- The agent's tag parser (`_ZEAL_TAG_SHAPES` in
  `packages/wolfpack-logsync/index.js`) knows only R/O/Y/G/B/W/P/S. Add `1`–`6`,
  so Extended Target can draw the icon rather than no shape.
- The prettyprint regex beside it (`Arrow:[ROYGBW]|Paw|Stop`) needs the six names.
  Otherwise a prettyprinted line reads the shape into the target's name, as
  "a gnoll (Skull)".
