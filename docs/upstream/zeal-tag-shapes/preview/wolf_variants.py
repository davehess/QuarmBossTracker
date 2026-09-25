"""Renders the Wolf mesh of each var_<variant>/meshes.json (the real tag_shapes.cpp compiled with that
variant's generated include) side by side: face-on and turned 35 degrees, over a dusk sky and sandstone."""
import json
import sys

import preview

COLORS = {"classic": (0xE8, 0xE2, 0xD4), "outlined": (0xE8, 0xE2, 0xD4), "badge": (0xE8, 0xE2, 0xD4),
          "shadow": (0x1C, 0x21, 0x2A), "steel": (0x3A, 0x40, 0x4A)}


def main():
    out, variants = sys.argv[1], sys.argv[2:]
    wolves = {v: next(m for m in json.load(open(f"var_{v}/meshes.json")) if m["name"] == "Wolf") for v in variants}
    cell, scale, rows = 170, 50, []
    for bg in [(58, 66, 80), (120, 104, 84)]:
        for yaw in (0, 35):
            cells = [preview.render(wolves[v], COLORS[v], yaw, cell, scale, bg) for v in variants]
            for r in range(cell):
                rows.append([p for c in cells for p in c[r]])
    preview.write_png(out, rows)


if __name__ == "__main__":
    main()
