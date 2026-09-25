# Zeal PR draft — icon shapes, numbered badges and lettered paws for `/tag`

*Drafted 2026-09-25 against Zeal v1.4.7 (`e24a3ed`). Branch **`tag-shapes`** on
the guild lead's fork (github.com/davehess/zeal/tree/tag-shapes, one commit,
`7ab0f2b`); the same change is `0001-tag-icon-shapes.patch` here. Every mesh
passes the strip check (`preview/dump.cpp`); the key parser is extracted verbatim
and tested with g++; clang-format with Zeal's style reports nothing on the changed
lines. The combined test build is branch `test-all` (`302f764`: Bandolier + this +
tag persistence); never open a PR from it.*

## How it grew (all 2026-09-25, the guild lead's calls)

1. *"make another branch for additional zeal tag icons"*: skull, X, sword, diamond,
   flame, star, on keys `1`–`6`. The first build rendered all six over live mobs.
2. *"we should have numbered tags 1-12, each of those other icons should have
   their own tag that's not a number"*: the icons moved to letters, and
   `^1^`–`^12^` became numbered badges.
3. *"add in a wolf"*. The hand-built wolf didn't land (*"That wolf doesn't look
   good, try 5 more versions. use the wolfpack.quest landing page svg and make the
   eyes yellow"*). It is now **traced from the landing-page artwork**, with **five
   variants to choose from** (below).
4. The moon (mez), a lasso (for pulling) and a lute (bard), from the guild lead's
   reference images; then a shield.
5. *"Take the pet paw and add each digit and letter in so charmers can add their
   initial in"*: `^PK^` draws the paw with a K on its pad.

## What's different about this approach

The upstream maintainer had tried a skull and dropped it: *"I wasn't happy with
how the 2-d extrusion approach looked."* A single extruded outline cannot carry
eye sockets or teeth.
- **Hand-built shapes** are several flat parts, each convex so it triangulates as
  a simple fan. Concave outlines come from overlapping parts.
- **Detail** is a part standing a step proud of the face in an accent tone: dark,
  light, contrasting (the digits), shaded (the moon's craters) or eye yellow.
- **The wolf is traced, not drawn.** `preview/trace_wolf.py` decodes Wolf Pack's
  own `wolf.png` and `wolf-eyes.png` and follows the nested regions: face, the dark
  linework cut through it, the eye islands, the pupils.
  - Each region is filled by its own outline, simplified (Douglas–Peucker) and
    ear-clip triangulated.
  - Each is drawn one step prouder than the region it sits in, so nothing needs a
    polygon with holes.
  - The output is `tag_shapes_wolf.inc`: generated data, like the paw's point
    tables.
- The renderer is unchanged: the same vertex-coloured, unlit triangle-strip path as
  the arrow, octagon and paw, and no textures.

## Keys

| Key | Shape | Colour | Vertices |
|---|---|---|---|
| `^K^` | Skull | bone `e8e2d1` | 264 |
| `^X^` | X | red `e81c1c` | 20 |
| `^A^` | Sword (points down) | gold `f2c02a` | 88 |
| `^D^` | Diamond | blue `2e8cf5` | 20 |
| `^F^` | Flame | green `3cd83c` | 216 |
| `^T^` | Star | purple `b55cf2` | 44 |
| `^L^` | Wolf (traced, yellow eyes) | bone `e8e2d4` | 704 (classic) |
| `^M^` | Moon (mez) | moon white `f2f2f5` | 616 |
| `^U^` | Lasso (pull) | rope brown `9c5f2e` | 890 |
| `^N^` | Lute (bard) | lute brown `a86b3a` | 450 |
| `^H^` | Shield (tank) | steel `a8b0bc` | 102 |
| `^1^` … `^12^` | Numbered badge | white `f0f0f0` (+n) | 138–258 |
| `^P0^` … `^PZ^` | Paw with a letter or digit | paw green `20c040` (+n) | paw + 100–180 |

**How the keys were chosen:**
- **Letters avoid R, O, Y, G, B, W, P and S on purpose.** An older client reads
  only the first character after `^`. A letter nobody uses shows the text and no
  shape; `S` for skull would have drawn a stop sign, the opposite message.
- `L` is the one free letter in "wolf". The rest are mnemonics: `M` moon/mez,
  `U` pUll, `N` note, `H` sHield.
- **Two-character keys** are read only in two exact forms: two digits followed by
  a `^` (`^10^`–`^12^`), or `P` plus a letter or digit followed by a `^`. No
  existing prefix changes meaning.
- **On older clients** `^12^` shows only the text, and `^PK^` shows a plain paw.
- **Numbers and lettered paws encode as a base colour + n**, because Zeal looks
  up a tag's shape from its colour. Every value was checked against every named
  colour, and all named colours against each other.
- **The paw's letter** is drawn as a second shape at the same spot (the paw, then
  the glyph). That keeps 36 small glyph meshes rather than 36 paws.

## Previews (all rendered off-client from the real geometry code)

- `preview.png`: the eleven icons face-on and turned 35°, over a dusk sky and a
  sandstone wall.
- `badges.png`: badges 1–12 face-on and seen from behind (they still read the
  right way round).
- `paws.png`: every lettered paw, front and back.
- `wolf-variants.png`: **the five wolves to pick from**, left to right:
  1. **classic**: the landing-page wolf in bone, dark linework, yellow eyes.
  2. **outlined**: the same with a dark border, so it reads on bright ground.
  3. **badge**: on a dark disc, matching the numbered badges.
  4. **shadow**: a dark silhouette with glowing yellow eyes (the site's
     `wolf-solid` + `wolf-eyes` layering).
  5. **steel**: grey wolf, light linework, yellow eyes.

  The branch ships **classic** as a placeholder. Swapping it is a copy of
  `wolf-variants/tag_shapes_wolf_<name>.inc` over `Zeal/tag_shapes_wolf.inc`. For
  shadow and steel, also change the wolf's colour in `nameplate.cpp` (`1c212a` and
  `3a404a`).

`preview/dump.cpp` compiles Zeal's `tag_shapes.cpp` unchanged, decodes the triangle
strips exactly as Direct3D does, and checks that every index is in range and that
no join makes a stray triangle. `preview/preview.py` and `preview_all.py`
rasterise with the same gradient colouring as `TagArrows`. To regenerate:

```
g++ -std=c++20 -I<zeal>/Zeal -o dump preview/dump.cpp <zeal>/Zeal/tag_shapes.cpp
./dump > meshes.json && python3 preview/preview_all.py meshes.json <zeal>/Zeal/tag_arrows.cpp .
python3 preview/trace_wolf.py web/public/wolf.png web/public/wolf-eyes.png <out-dir>
```

## Build and test locally

Same clone as before (`C:\dev\zeal-pr\Zeal`), Developer Command Prompt for VS
2022, no inline `# comments`. The branches were force-pushed, so reset rather
than pull. To test everything at once:

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git switch test-all
git reset --hard origin/test-all
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=testall Zeal.sln
copy C:\dev\zeal-pr\Zeal\Release\Zeal.asi A:\EQ\Zeal.asi
```

Before the PR: `git switch tag-shapes`, `git reset --hard origin/tag-shapes`, then
`git commit --amend --no-edit --reset-author` and
`git push --force-with-lease origin tag-shapes`.

---

## PR title

`Add icon shapes, numbered badges 1-12 and lettered paws for /tag`

## PR body (paste as-is, and attach preview.png, badges.png, paws.png)

Tags can show a coloured arrow, the stop sign or the paw today. Raid marking wants
more distinct symbols, and this adds four kinds:
- the familiar skull / X / sword / diamond / flame / star set;
- role marks (moon for mez, lasso for pull, lute for bard, shield for tank);
- numbers for kill or crowd-control order;
- a way for a charmer to mark their own pet.

**What changes**

- Icon keys after `^`: `K` skull, `X` red X, `A` gold sword, `D` blue diamond, `F`
  green flame, `T` purple star, `L` wolf's head, `M` moon, `U` lasso, `N` lute,
  `H` shield.
  - They avoid R/O/Y/G/B/W/P/S on purpose. An older client reads only the first
    key character, so an unused letter shows the text with no shape rather than a
    different, wrong one.
- Numbered badges `^1^` to `^12^`: a white disc with block digits.
- Lettered paws `^P0^` to `^PZ^`: the paw with a letter or digit on its pad.
  - The two-character keys are read only in exactly those forms (two digits, or
    `P` + letter or digit, followed by `^`), so no existing prefix changes meaning.
  - An older client sees `^PK^` as a plain paw.
- Digits and letters sit on each face separately, the back copy mirrored, so they
  read correctly from either side.
- `tag_shapes.cpp/.h` (new) holds the geometry, with no DirectX dependency.
  - Every shape is flat parts extruded to the same thickness as the octagon and
    paw.
  - Parts are convex (or star-shaped about their centre) and fan-triangulated, or
    carry their own triangles.
  - Concave outlines come from overlapping parts.
  - Detail stands slightly proud of the face in an accent tone.
  - No textures.
- `tag_shapes_wolf.inc` (generated) is the wolf, traced from Wolf Pack's own wolf
  artwork into nested, filled layers.
- `TagArrows` builds the meshes at startup, colours them with the existing face
  gradients plus the accent tones, and sizes the vertex buffer to hold every shape
  at once. `static_assert`s keep its `Shape` enum in step with `TagShapes::Kind`.
- The shape is now picked from the tag's own colour, before a nameplate colour is
  substituted, so a nameplate colour can no longer collide with a shape's colour.
- Prettyprint, the target tooltip and `/tag` help name the new shapes. README:
  the new keys and examples.

The attached previews are rendered off-client from `tag_shapes.cpp` itself: the
triangle strips are decoded as Direct3D draws them, with the same gradient
colouring.

**Test plan**

1. Build; `/tag on`; target an NPC; `/tag local ^K^Kill first`: a skull above the
   nameplate with the text "Kill first".
2. `^X^ ^A^ ^D^ ^F^ ^T^ ^L^ ^M^ ^U^ ^N^ ^H^` on other NPCs. Each shape turns to
   face you as you walk around it, like the paw and stop sign do.
3. `^1^` through `^12^`: numbered badges. Walk around one; the number never reads
   backwards.
4. `^PK^`, `^P7^`: the paw with K / 7 on its pad, readable from either side;
   `^P^` is still a plain paw.
5. `^R^`, `^P^`, `^S^`: the arrow, paw and stop sign are unchanged.
6. Many shapes at once, plus a few arrow colours: every shape draws and none
   flickers.
7. `/tag local ^-^` clears the shape and leaves the text.
8. With `/tag prettyprint on`, an rsay tag reads "… => <name> (Skull)", "(#7)" or
   "(Paw K)". With `/tag tooltip on`, the target window names the shape.
9. A client without this change receiving `^K^Kill first`, `^12^` or `^PK^` shows
   the text (and a plain paw for `^PK^`).

---

## Our side, once it is merged upstream

Nothing ships to our fleet until it is in an official Zeal release. Then:

- The agent's tag parser (`_ZEAL_TAG_SHAPES` in
  `packages/wolfpack-logsync/index.js`) knows only R/O/Y/G/B/W/P/S and a
  single-character key. It needs the eleven letters, `1`–`12` and `P` + character,
  so Extended Target can show the icon, number or paw initial.
- The prettyprint regex beside it (`Arrow:[ROYGBW]|Paw|Stop`) needs the new
  names, `#1`–`#12` and `Paw <c>`. Otherwise a prettyprinted line reads the shape
  into the target's name.
