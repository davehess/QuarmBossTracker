"""Exports every built-in tag mark as its own transparent PNG, for the public gallery (web/public/zeal/marks).

Renders from a mesh dump of the real tag_shapes.cpp (dump.cpp), with the colours from nameplate.cpp and
the kGuilds table, face-on, the same way preview.py does, but with an alpha channel instead of a
background. Files: icon-<name>.png, badge-<n>.png, paw-<c>.png, banner-<CODE>.png, guild-<CODE>.png.

Usage: python3 export_marks.py <meshes.json> <tag_shapes.cpp> <tag_arrows.cpp> <out_dir> [size]"""
import json
import math
import os
import re
import struct
import sys
import zlib

import preview
from preview_all import ICON_COLORS, NUMBER_COLOR, PAW_COLOR, combine, paw_mesh

ALIASES = {"WP": "Wolf", "E": "Euro", "$": "Dollar"}  # kGuilds icon_key -> the shape it reuses.


def rgb(value):
    return ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)


def render_rgba(mesh, color, size, scale):
    """preview.render, face-on, with coverage kept as alpha (straight, not premultiplied)."""
    ss = 3
    w = h = size * ss
    s = scale * ss
    buf = [None] * (w * h)
    depth = [1e9] * (w * h)
    cols = preview.vertex_colors(mesh, color)
    mid = (mesh["min_z"] + mesh["max_z"]) / 2
    pts = [(w / 2 + x * s, h / 2 - (z - mid) * s, y) for x, y, z, _ in mesh["vertices"]]
    for a, b, c in mesh["triangles"]:
        (x0, y0, d0), (x1, y1, d1), (x2, y2, d2) = pts[a], pts[b], pts[c]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(area) < 1e-9:
            continue
        minx, maxx = max(0, int(min(x0, x1, x2))), min(w - 1, int(max(x0, x1, x2)) + 1)
        miny, maxy = max(0, int(min(y0, y1, y2))), min(h - 1, int(max(y0, y1, y2)) + 1)
        ca, cb, cc = cols[a], cols[b], cols[c]
        for py in range(miny, maxy + 1):
            fy = py + 0.5
            for px in range(minx, maxx + 1):
                fx = px + 0.5
                w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area
                w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area
                w2 = 1 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                d = w0 * d0 + w1 * d1 + w2 * d2
                i = py * w + px
                if d < depth[i]:
                    depth[i] = d
                    buf[i] = tuple(int(w0 * ca[k] + w1 * cb[k] + w2 * cc[k]) for k in range(3))
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc, hits = [0, 0, 0], 0
            for dy in range(ss):
                for dx in range(ss):
                    p = buf[(py * ss + dy) * w + px * ss + dx]
                    if p is not None:
                        hits += 1
                        acc = [acc[k] + p[k] for k in range(3)]
            row.append((0, 0, 0, 0) if not hits else (*(v // hits for v in acc), 255 * hits // (ss * ss)))
        rows.append(row)
    return rows


def write_rgba_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    meshes = {m["name"]: m for m in json.load(open(sys.argv[1]))}
    source = open(sys.argv[2]).read()
    tag_arrows_cpp, out = sys.argv[3], sys.argv[4]
    size = int(sys.argv[5]) if len(sys.argv) > 5 else 160
    scale = size * 33 / 120  # preview_all's cell 120 at scale 33.
    os.makedirs(out, exist_ok=True)

    def save(name, mesh, color):
        write_rgba_png(os.path.join(out, name + ".png"), render_rgba(mesh, color, size, scale))

    for name, color in ICON_COLORS.items():
        save("icon-" + name.lower(), meshes[name], color)
    for n in range(1, 13):
        save(f"badge-{n}", meshes[f"#{n}"], NUMBER_COLOR)
    paw_v, paw_t = paw_mesh(tag_arrows_cpp)
    for g in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        save(f"paw-{g}", combine(paw_v, paw_t, meshes["P" + g]), PAW_COLOR)
    guilds = re.findall(r'\{"(\w+)", "([^"]+)", 0x([0-9a-f]{6}), (0x[0-9a-f]{6}|0), ("[^"]*"|nullptr)\}', source)
    for code, _, banner, icon, alias in guilds:
        save(f"banner-{code}", meshes["B" + code], rgb(int(banner, 16)))
        if alias == "nullptr":
            save(f"guild-{code}", meshes["I" + code], rgb(int(icon, 16)))
        else:
            shape = ALIASES[alias.strip('"')]
            save(f"guild-{code}", meshes[shape], ICON_COLORS[shape])
    print(len(os.listdir(out)), "files in", out)


if __name__ == "__main__":
    main()
