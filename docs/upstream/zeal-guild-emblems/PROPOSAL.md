# Guild emblems for Zeal `/tag` — two directions, prototyped

> **Decided 2026-09-25: both.** The guild lead: *"I like the flags, make them B__ for
> Banner. Lets put them all in"*, then *"I want both"*.
> - `^B<code>^` draws the banner and `^I<code>^` the icon, for all 30 guilds. The
>   single `^#<code>^` key proposed below was not used.
> - Built in C++ on the `tag-shapes` branch (`3c02f65`); the real-mesh render is
>   `../zeal-tag-shapes/guilds.png`, and every command to try is in
>   `../zeal-tag-shapes/TRY-IN-GAME.md`.
> - The codes in the table below are what shipped. They are still ours, invented,
>   and each is one table row to change.
>
> The rest of this page is the proposal as it was written.

*2026-09-25. The guild lead: "We should try to make a symbol for each of these
guilds." These are the 29 guilds from the list the guild lead shared, plus Wolf
Pack, whose symbol is the `^WP^` wolf (*"make the wolf WP"*). The guild lead then
asked for a preview before anything went into C++: *"before you render all of
those symbols in c++ please show me a preview of all of those guild symbols"*. So
nothing here is in Zeal yet: it is a Python prototype built with the same rules as
`tag_shapes.cpp`. Those rules are flat parts extruded to the tag thickness,
convex fans or ear-clipped outlines, and accents a step proud of the face.
Source: `../zeal-tag-shapes/preview/guild_emblems.py`.*

## The pictures

- `guild-banners.png`: **Option A**, a monogram banner for each guild, in list order.
- `guild-pictograms.png`: **Option B**, a hand-built symbol for each guild, in the
  same order.
- `guild-small.png`: both again at about 40 px, banner then pictogram for each
  guild. A tag is seen at this sort of size, so this is the one to judge by.

The wolf, `$` and `€` pictograms are the `^WP^`, `^$^` and `^E^` icons already on
the `tag-shapes` branch. They double as the Wolf Pack, Loot & Some Fun and Europa
emblems. The wolf is drawn from a dump of the real branch meshes, not re-modelled.

## Option A — monogram banners

One template: a swallowtail banner on a rod. It carries the guild's code (2–3
letters) in the paw glyphs' 5×7 font, and its colour is computed from the
letters.
- **Zeal needs no guild list.** Any code works, including guilds formed next week.
- **Weakness 1, colour.** Colour from the letters collides: 9 of the 30 land
  green and 6 cyan. That is a pigeonhole problem (30 guilds, about 8 hues you can
  tell apart at a glance), not a hash problem. The letters carry the identity.
- **Weakness 2, size.** At about 40 px, three letters are only just legible.

| Cost | |
|---|---|
| Build | Low. One banner mesh, plus the 36 glyph meshes the paw already has, placed three across. |
| Maintenance | None per guild. |
| Runtime | About 100 vertices for the banner plus 3 glyphs; one draw per letter. |
| Change | Trivial. A new or renamed guild is just different letters typed in the tag. |

## Option B — one pictogram per guild

A real symbol for each guild. **It reads much better at tag size:** the bolt,
d20, crescent, egg, tent, anchor and axe are all distinct at 40 px.
- **The busy ones blur first:** the mirror, the chain and the sea serpent.
- **Every guild is a code change in Zeal.** A new guild, a rename or a redesign
  means an upstream release before anyone sees it.

| Cost | |
|---|---|
| Build | High. 29 shapes (the wolf exists), each hand-built and then ported to C++ like the existing icons. The prototypes took about 10–20 minutes each; the port and checks are about as long again. |
| Maintenance | Ongoing. Guilds form, merge and rename, and each change is a Zeal release. |
| Runtime | 29 more meshes in the tag vertex buffer, 20–900 vertices each, on the scale of the icons already added. |
| Change | Expensive. A redesign goes through an upstream PR and release. |

## Recommended — both, behind one key

**`^#EUR^`**: `#` plus the guild's 2–4 letter code.
- **If Zeal has a pictogram for that code it draws it; otherwise it draws the
  monogram banner.** What people type never changes, and a guild can move from a
  banner to a pictogram later without anyone relearning a key.
- **On an older client**, `^#…^` shows the text and no shape. Checked against
  upstream `e24a3ed`: an unknown key character sets the shape off, and the rest of
  the prefix is skipped up to the closing `^`.
- `#` is free: no current key uses it, and it is not a colour letter an older
  client would draw.
- Wolf Pack would have both: `^WP^` (the icon key) and `^#WP^` (the guild form)
  draw the same wolf.

**The upstream question is real.** A generic "draw these letters on a banner" is
an easy PR to accept. A table of 30 Project Quarm guilds, each with its own
artwork, inside Zeal's source may not be. If the maintainer declines the table,
the pictograms can stay in a Wolf Pack build while the monograms go upstream.

## What was guessed (the guild lead to correct)

**The codes are invented.** Each guild may already have its own abbreviation,
and that should win.

The symbols are readings of the names. Wherever the reading is a stretch, the
row says so:

| # | Guild | Code | Symbol | Why |
|---|---|---|---|---|
| 0 | Wolf Pack | WP | the wolf | the guild lead's call; the `^WP^` icon |
| 1 | Mayhem | MAY | lightning bolt | |
| 2 | Europa | EUR | € | the `^E^` icon |
| 3 | Tranquility | TRQ | lotus | |
| 4 | Squirrels of War | SOW | acorn | |
| 5 | Intervention | INT | ankh | Divine Intervention |
| 6 | Erud's Crossing Guard | ECG | anchor | Erud's Crossing is the sea crossing; a crossing-guard paddle would read as a stop sign, which already exists |
| 7 | Savage | SAV | claw marks | |
| 8 | Burnouts | BRN | burnt-out match | |
| 9 | Former Glory | FG | toppled crown | |
| 10 | Axiom | AX | triangle and point | a stretch |
| 11 | Haven | HVN | house, window lit | |
| 12 | Freedom | FRE | bird in flight | |
| 13 | Seekers of Souls | SOS | eye | |
| 14 | Hardened Casuals | HC | tankard | a stretch |
| 15 | Nocturnal | NOC | crescent moon | kept different from the round `^M^` mez moon |
| 16 | Dungeons and Dragons | DND | d20 | |
| 17 | Zek | ZEK | war axe | Rallos Zek |
| 18 | The Drift | DRF | waves | a stretch |
| 19 | Continuum | CON | ∞ | |
| 20 | Eclipse | ECL | eclipse ring | |
| 21 | Loot & Some Fun | LSF | $ | the `^$^` icon |
| 22 | Novae | NOV | starburst | |
| 23 | Mass Group Ego | MGE | hand mirror | a stretch |
| 24 | Breakfast Club | BC | fried egg | |
| 25 | Here There Be Monsters | HBM | sea serpent | the old map-margin warning |
| 26 | Sentinels | SEN | watchtower | |
| 27 | Alianza | ALZ | chain links | alliance |
| 28 | Camped | CMP | tent | |
| 29 | Convicts | CVT | ball and chain | |

Guild names are public in-game names; this page names no members.
