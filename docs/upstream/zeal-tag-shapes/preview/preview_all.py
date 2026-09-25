"""Renders every tag shape from meshes.json (dump.cpp output) into preview images:
  icons.png  - the icon shapes face-on and turned 35 degrees, over a dusk sky and a sandstone wall;
  badges.png - numbered badges 1-12 face-on and seen from behind;
  paws.png   - the paw with each letter and digit (the paw itself is rebuilt from Zeal's PawData table).
Colors mirror the TagArrowColor values in nameplate.cpp."""
import json
import re
import sys

import preview

ICON_COLORS = {
    "Skull": (0xE8, 0xE2, 0xD1), "Cross": (0xE8, 0x1C, 0x1C), "Sword": (0xF2, 0xC0, 0x2A),
    "Diamond": (0x2E, 0x8C, 0xF5), "Flame": (0x3C, 0xD8, 0x3C), "Star": (0xB5, 0x5C, 0xF2),
    "Wolf": (0xE8, 0xE2, 0xD4), "Moon": (0xF2, 0xF2, 0xF5), "Lasso": (0x9C, 0x5F, 0x2E), "Lute": (0xA8, 0x6B, 0x3A),
    "Shield": (0xA8, 0xB0, 0xBC),
}
NUMBER_COLOR = (0xF0, 0xF0, 0xF0)
PAW_COLOR = (0x20, 0xC0, 0x40)
BACKGROUNDS = [(58, 66, 80), (120, 104, 84)]


def paw_mesh(tag_arrows_cpp):
    """Zeal's paw from the PawData point tables: each pad a fan on both faces (walls left out)."""
    src = open(tag_arrows_cpp).read()
    verts, tris = [], []
    for name in ("kToeLeftOuter", "kToeLeftInner", "kToeRightInner", "kToeRightOuter", "kMainPad"):
        body = src[src.index(name + " = {"):]
        body = body[:body.index("}};")]
        pts = [(float(x) * 0.025, float(z) * 0.025) for x, z in re.findall(r"\{(-?[\d.]+)f, (-?[\d.]+)f\}", body)]
        for y in (-0.25, 0.25):
            base = len(verts)
            verts += [[x, y, z, 0] for x, z in pts]
            tris += [[base, base + i, base + i + 1] for i in range(1, len(pts) - 1)]
    return verts, tris


def combine(a_verts, a_tris, mesh):
    base = len(a_verts)
    verts = a_verts + mesh["vertices"]
    tris = a_tris + [[base + i for i in t] for t in mesh["triangles"]]
    zs = [v[2] for v in verts]
    return {"vertices": verts, "triangles": tris, "min_z": min(zs), "max_z": max(zs)}


def grid(cells_by_row, cell):
    rows = []
    width = max(len(r) for r in cells_by_row)
    for cells, bg in cells_by_row:
        while len(cells) < width:
            cells.append([[bg] * cell for _ in range(cell)])
        for r in range(cell):
            rows.append([p for c in cells for p in c[r]])
    return rows


def main():
    meshes = {m["name"]: m for m in json.load(open(sys.argv[1]))}
    tag_arrows_cpp, out_dir = sys.argv[2], sys.argv[3]
    cell, scale = 120, 33
    icons = [n for n in ICON_COLORS if n in meshes]
    rows = []
    for bg in BACKGROUNDS:
        for yaw in (0, 35):
            cells = [preview.render(meshes[n], ICON_COLORS[n], yaw, cell, scale, bg) for n in icons]
            for r in range(cell):
                rows.append([p for c in cells for p in c[r]])
    preview.write_png(f"{out_dir}/icons.png", rows)

    rows = []
    for bg in BACKGROUNDS:
        for yaw in (0, 150):
            for half in (range(1, 7), range(7, 13)):
                cells = [preview.render(meshes[f"#{n}"], NUMBER_COLOR, yaw, cell, scale, bg) for n in half]
                for r in range(cell):
                    rows.append([p for c in cells for p in c[r]])
    preview.write_png(f"{out_dir}/badges.png", rows)

    paw_v, paw_t = paw_mesh(tag_arrows_cpp)
    glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    rows = []
    small, small_scale = 90, 29
    for bg, yaw in ((BACKGROUNDS[0], 0), (BACKGROUNDS[1], 0), (BACKGROUNDS[0], 150)):
        for chunk in (glyphs[:12], glyphs[12:24], glyphs[24:]):
            cells = [preview.render(combine(paw_v, paw_t, meshes["P" + g]), PAW_COLOR, yaw, small, small_scale, bg)
                     for g in chunk]
            for r in range(small):
                rows.append([p for c in cells for p in c[r]])
    preview.write_png(f"{out_dir}/paws.png", rows)


if __name__ == "__main__":
    main()
