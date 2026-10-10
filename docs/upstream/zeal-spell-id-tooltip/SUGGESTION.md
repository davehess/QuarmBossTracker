![Spell id in spell info](https://raw.githubusercontent.com/davehess/Zeal/showcase/showcase/posters/spell-id-tooltip-banner.png)

# See a spell's id in its info window (`/spellid`)

*Fork branch `spell-id-tooltip` (`67cb705`), based on Zeal 1.4.8. Status: draft; in the test-all build (`035d8a3`).
Compiled by GitHub, not yet run in game.*

**What**
`/spellid on` adds one line, `Spell ID: <id>`, at the bottom of the spell info window: the window you get by Alt+clicking
a buff, a memorised spell gem or a spell in the spellbook. `/spellid off` removes it, and `/spellid` on its own toggles.
The choice is saved in the Zeal ini (`ShowSpellId`), so it survives a restart.

**Why**
Blocking a buff, or writing a tool or trigger that tracks one, needs the spell's id, and the client never shows it.
Players look it up in a spell database by name, where several spells often share one name (ranks, songs, item versions).
The client already knows which spell it is showing, so it can just say.

**How**
One setting (off by default) and one helper in `item_display.cpp`. Zeal already rewrites the spell info text after the
game fills it in; when the setting is on, the helper appends the id line at the end. It runs on both paths, with
"Enhanced spell info" on or off. Nothing runs per frame: the line is added once, when a spell info window opens. About 30
lines in `item_display.cpp`, `item_display.h` and the README.

Item windows (a spell scroll in your bags, an item's click effect) are not changed: they go through a different window.

**How tested**
- Built by GitHub from the test-all branch.
- Read against the code paths that open spell info (buff window, spell gems, spellbook): each goes through the one
  function the line is added in.
- clang-format with Zeal's style is clean on every changed line.
- The in-game cases are in `TEST-CASES.md`.

**Try it:** in the fork's test-all build (https://github.com/davehess/Zeal/releases/tag/test-all-build), `035d8a3` or
later, then `/spellid on` and Alt+click any buff.

**Pull request:** _link added when it is filed._

**Testing evidence:** _added after the in-game test run._
