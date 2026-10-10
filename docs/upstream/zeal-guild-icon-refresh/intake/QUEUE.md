# Guild logo intake: queued for cutting into icons and banners

Collected by the guild lead from other guilds' Discord servers, 2026-10-10. Not cut yet. When a logo is cut into a Zeal
icon/banner (see `../README.md` and DECISIONS §226), tick it and note the guild code. One logo had a Discord name
bar under it; it was cropped off before saving (no member names in the repo).

| # | File | Guild (as shown) | Notes | Cut |
|---|---|---|---|---|
| 1 | `01-alianza.png` | Alianza | red/yellow shield, knight and squire riders | [x] |
| 2 | `02-squirrel-shield.png` | Squirrels of War | gold squirrel on a black shield | [x] |
| 3 | `03-novae.png` | Novae | banner art; the "NOVAE" lettering is the usable part | [x] |
| 4 | `04-continuum.png` | Continuum | red emblem on a riveted steel shield | [x] |
| 5 | `05-dragon-hn-monogram.png` | Haven (H/N monogram) | silver dragon over a shield | [x] |
| 6 | `06-intervention.png` | Intervention | wordmark under dragons | [x] |
| 7 | `07-mass-group-ego.png` | Mass Group Ego | dark shield in a violet ring | [x] |
| 8 | `08-green-s-banners.png` | Seekers of Souls ("S" banners) | eye over a golden circle, green | [x] |
| 9 | `09-tree-four-elements.png` | Tranquility | tree over four-colour quarters | [x] |
| 10 | `10-breakfast-club.png` | The Breakfast Club | fist, spatula, sword, pancakes | [x] |
| 11 | `11-lsf-shield.png` | LSF (Loot & Some Fun) | gold LSF on a shield, crossed swords | [x] |
| 12 | `12-loot-and-some-fun.png` | Loot & Some Fun | wordmark | [x] |
| 13 | `13-former-glory.png` | Former Glory | gold FG crest | [x] |
| 14 | `14-zek.png` | Zek | red/white Z in a ring | [x] |
| 15 | `15-axiom.png` | Axiom | gold wordmark with a crystal O | [x] |
| 16 | `16-eclipse.png` | Eclipse | eclipsed sun over a copper wordmark | [x] |
| 17 | `17-savage.png` | Savage | red brush wordmark on black | [x] |

Names for 2, 5, 8 and 9 came from the guild lead (they are not on the art).

## Cut (2026-10-10)

All 16 guilds are in `cut/` as Zeal tag pictures, PNG and 32-bit TGA, each within Zeal's limits (128 px a side, 2:1,
1 MB). `cut/preview.png` shows them all at 2x.
- Icon `^I<CODE>^`: `<CODE>.png`/`.tga`. Continuum's is `ICON.png`/`.tga`: Windows reserves `CON`, and Zeal also
  reads `I<CODE>`.
- Banner `^F<CODE>^`: `F<CODE>.png`/`.tga`, 128x64. It is the guild's own name-bearing logo where the art has one;
  otherwise the icon beside the guild's name in a colour from the logo.
- A player drops the files into `EverQuest\uifiles\zeal\tagicons\custom` and types `/tag icons`. They need the
  fork's test-all build (tag pictures are not upstream yet). Anyone without the file sees the built-in shape.

To redo one: `python3 -I recipes.py cut CODE` (helpers in `cutlib.py`, one recipe per guild in `recipes_*.py`).
Known weak spots: the Intervention and Tranquility sources were small (soft when scaled); the Novae and Zek banner
lettering is small; the Eclipse corona fades with a visible edge on the left; the Mass Group Ego shield is very dark.
