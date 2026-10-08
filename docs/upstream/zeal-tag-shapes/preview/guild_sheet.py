"""Renders the guild banners (^B<code>^) and icons (^I<code>^) from a mesh dump of the real tag_shapes.cpp,
with the colors from its kGuilds table: one row pair per 10 guilds, banner above icon, code underneath.

Usage: python3 guild_sheet.py <meshes.json> <tag_shapes.cpp> <out.png> [cell] [scale]"""
import json
import re
import sys

import preview
from guild_emblems import label

ALIASES = {"WP": ("Wolf", (0xE8, 0xE2, 0xD4)), "E": ("Euro", (0xE8, 0xA0, 0x20)), "$": ("Dollar", (0x3A, 0xB0, 0x5A))}


def rgb(value):
    return ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)


def main():
    meshes = {m["name"]: m for m in json.load(open(sys.argv[1]))}
    source = open(sys.argv[2]).read()
    guilds = re.findall(r'\{"(\w+)", "([^"]+)", 0x([0-9a-f]{6}), (0x[0-9a-f]{6}|0), ("[^"]*"|nullptr)\}', source)
    cell = int(sys.argv[4]) if len(sys.argv) > 4 else 110
    scale = float(sys.argv[5]) if len(sys.argv) > 5 else 31
    px = 2 if cell >= 80 else 1
    bg = (58, 66, 80)
    per_row = 10
    rows = []
    for start in range(0, len(guilds), per_row):
        chunk = guilds[start:start + per_row]
        for kind in ("B", "I"):
            cells = []
            for code, _, banner, icon, alias in chunk:
                if kind == "B":
                    mesh, colour = meshes["B" + code], rgb(int(banner, 16))
                elif alias != "nullptr":
                    name, colour = ALIASES[alias.strip('"')]
                    mesh = meshes[name]
                else:
                    mesh, colour = meshes["I" + code], rgb(int(icon, 16))
                cells.append(preview.render(mesh, colour, 0, cell, scale, bg) + label(code, cell, px, bg=bg))
            while len(cells) < per_row:
                cells.append([[bg] * cell for _ in range(cell + 9 * px)])
            for r in range(len(cells[0])):
                rows.append([p for c in cells for p in c[r]])
    preview.write_png(sys.argv[3], rows)
    print(len(guilds), "guilds")


if __name__ == "__main__":
    main()
