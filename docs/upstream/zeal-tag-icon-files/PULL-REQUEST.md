# Zeal PR draft: tag pictures from a folder (`^I<name>^`)

*Drafted 2026-09-26 on top of the tag-shapes branch (`3c02f65`). Branch **`tag-icon-files`**
on the guild lead's fork (github.com/davehess/zeal/tree/tag-icon-files, one commit,
`ac5d177`); the same change is `0001-tag-pictures.patch` here. It is merged into
`test-all` (`d32bed1`). The steps to try it are in `../zeal-tag-shapes/TRY-IN-GAME.md` →
"Pictures".*

## Why

Other guilds saw the guild marks and started asking for their own. The first request was
a painted shield: a detailed, full-colour logo. The guild lead: *"requests are coming in,
probably best to have a preset and treat them like the target rings where you can add
some"*.

- **The built-in marks stay as the presets.** They are the 30 banners and icons in
  `tag_shapes.cpp`.
- **Anyone can add more**, the way target ring textures work: drop a file in a folder.
  No code change and no Zeal release per guild.

## What changes (254 lines added, 5 removed; four files plus the README)

**The folder.** `uifiles/zeal/tagicons/<name>.png` or `.tga`, beside `targetrings/`.
- `<name>` is 1 to 6 letters or digits, in any case.
- `^I<name>^` draws that picture.
- The folder is read on first use, and again on `/tag icons`.

**Drawing.** `TagArrows::QueueTagImage` draws a textured quad facing the camera. It uses
the same camera-facing transform as the 3-D nameplate text (`SpriteFont::render_queue`),
so it turns with the text and cannot read backwards.
- The quad sits where the shape would, 3.5 world units tall. The arrow is 4.
- Blending: alpha-blended edges, plus an alpha test so see-through pixels leave the depth
  buffer alone. Linear filtering with mipmaps for distant tags.

**Precedence and fallback:**
- A picture takes over from a built-in guild icon with the same code. With `EUR.png`,
  `^IEUR^` shows the picture instead of the built-in €.
- If the file will not load, the tag draws the built-in shape. For a name that is not a
  guild, it draws a white arrow.
- A viewer without the file sees the guild's built-in shape, or only the text. Tag
  messages are unchanged on the wire, so nothing breaks for anyone else.

**Checks before decoding.** A file is loaded only if all of these hold:
- it is at most 1 MB;
- its header is a PNG (IHDR) or a true-colour TGA (type 2 or 10);
- the header gives a size of at most 512 pixels a side.

Anything else is skipped with one chat message. The header is read by hand, first, so an
oversized image is refused before D3DX allocates for it.

**Lifetime.** Each picture loads once as a managed texture.
- `Release()`, which runs on device loss and cleanup, frees them.
- `/tag icons` lists the pictures, reads the folder again and reloads changed files.

**Chat.** A picture tag's line reads "(Picture EUR)".

## Why pictures, not shape files

Two genuinely different ways to let people add marks:

| | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|
| **Pictures (this PR):** a PNG/TGA per mark, drawn flat | Low: one textured quad path, modelled on the target ring and nameplate text | Low: no per-guild code | One small texture per mark in view | Low: formats people already make |
| **Shape files:** outlines per layer in a text file, extruded like the built-ins | High: a parser, validation, and triangulation that survives bad input | Medium: someone has to trace every logo into outlines | Same as today | **High:** the file format becomes a contract the moment guilds have files |

Pictures win here for two reasons.
- **The logos people send are painted artwork.** A detailed shield cannot become an
  extruded shape without being redrawn from scratch.
- **Shapes would need a tracing step per guild.** That step is exactly the bottleneck
  the requests are running into.

The built-in 3-D marks remain for anyone who wants a crisp symbol.

## Tested

- **Off-client with g++:** `test/pictures.sh`.
  - It extracts the key parser and folder scan from `nameplate.cpp`, and the header check
    from `tag_arrows.cpp`, verbatim, and runs them.
  - Covered: folder rules, lookup in any case, guild precedence, rescan, a missing folder,
    PNG/TGA sizes including a 2^31 width, and refused formats.
  - **Mutation-checked:** eight deliberate breaks (key parser, length cap, extension,
    directories, rescan, TGA type, TGA width, character set) each fail it.
- **clang-format:** with Zeal's `.clang-format`, it reports nothing on the four files.
- **Not compiled or run here:** the D3D draw path needs the Windows build. In-game steps
  are in TRY-IN-GAME.md → "Pictures".
- **Orientation:** the orientation card (`test-pictures/UP.png`, red left, blue right,
  arrow up) is there to catch a mirrored or upside-down quad on the first look.

## Open points for the maintainers

1. **Is PNG supported by the D3DX8 in the build?** D3DX8 lists PNG and TGA, but only TGA
   is proven in Zeal (target rings, floating damage). If PNG fails to load, the tag falls
   back cleanly, and dropping PNG from the folder scan is one line.
2. **Trust.** D3DX's image decoders are old. The header check and size caps cut the obvious
   abuse. Still, a picture is a file from someone else, the same as a UI skin: document
   "only use pictures from sources you trust".
3. **Relogs.** With the tag-persistence branch, a picture tag comes back after a relog as
   its fallback shape. The saved-tags file stores the shape colour, not the picture name.
   Adding the name is a small follow-up once both branches land.
4. **Sizes.** 6 characters, 512 px, 1 MB and 3.5 units tall are first guesses. Tell us if
   you want other defaults.
