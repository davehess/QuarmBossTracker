"""Rasterises the tag_shapes meshes (meshes.json from dump.cpp) into a preview PNG.

Colours mirror TagArrows::AllocateIconShape: the Gradient class from tag_arrows.cpp on each face
(front grey 192 / back grey 64), a lightened tag colour for Light parts and a dark tint for Dark parts.
Pure standard library (zlib PNG writer, z-buffered barycentric rasteriser, 3x supersampling).
"""
import json
import math
import struct
import sys
import zlib

COLORS = {  # Must match the TagArrowColor values in nameplate.cpp.
    "Skull": (0xE8, 0xE2, 0xD1),
    "Cross": (0xE8, 0x1C, 0x1C),
    "Sword": (0xF2, 0xC0, 0x2A),
    "Diamond": (0x2E, 0x8C, 0xF5),
    "Flame": (0x3C, 0xD8, 0x3C),
    "Star": (0xB5, 0x5C, 0xF2),
    "Wolf": (0xDC, 0xE2, 0xEA),
}
NUMBER_COLOR = (0xF0, 0xF0, 0xF0)  # kNumberColorBase; the low bits of blue only keep each key unique.
KEYS = {"Skull": "K", "Cross": "X", "Sword": "A", "Diamond": "D", "Flame": "F", "Star": "T", "Wolf": "L"}


def color_of(name, number_color):
    return COLORS.get(name, number_color)


def gradient(color, grey, min_h, max_h, clamp_low=0.15):
    max_h = max(min_h + 1.0, max_h)

    def get(h):
        g = clamp_low + 0.85 * max(0.0, min(1.0, (h - min_h) / (max_h - min_h)))
        return tuple(grey + int((c - grey) * g) for c in color)

    return get


def lighten(color):
    return tuple(c + (255 - c) * 3 // 5 for c in color)


def vertex_colors(mesh, color):
    lo, hi = mesh["min_z"], mesh["max_z"]
    light = lighten(color)
    front, back = gradient(color, 192, lo, hi), gradient(color, 64, lo, hi, 0.0)
    light_front, light_back = gradient(light, 224, lo, hi), gradient(light, 96, lo, hi, 0.0)
    dark = tuple(c // 6 for c in color)
    luminance = (color[0] * 299 + color[1] * 587 + color[2] * 114) // 1000
    eye = (0xFF, 0xCF, 0x5C)  # The landing page's wolf-eye yellow.
    shade = tuple(c * 7 // 10 for c in color)
    eye_front, eye_back = gradient(eye, 255, lo, hi, 0.55), gradient(eye, 160, lo, hi, 0.4)
    shade_front, shade_back = gradient(shade, 150, lo, hi), gradient(shade, 50, lo, hi, 0.0)
    out = []
    for x, y, z, tone in mesh["vertices"]:
        if tone == 3:  # Contrast: dark on a light tag color, light on a dark one.
            tone = 1 if luminance > 140 else 2
        if tone == 4:
            out.append((eye_front if y < 0 else eye_back)(z))
        elif tone == 5:
            out.append((shade_front if y < 0 else shade_back)(z))
        elif tone == 1:
            out.append(dark)
        elif tone == 2:
            out.append((light_front if y < 0 else light_back)(z))
        else:
            out.append((front if y < 0 else back)(z))
    return out


def render(mesh, color, yaw_deg, size, scale, bg):
    ss = 3
    w = h = size * ss
    s = scale * ss
    buf = [bg] * (w * h)
    depth = [1e9] * (w * h)
    cols = vertex_colors(mesh, color)
    yaw = math.radians(yaw_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    pts = []
    mid = (mesh["min_z"] + mesh["max_z"]) / 2
    for x, y, z, _ in mesh["vertices"]:
        xr, yr = x * cy - y * sy, x * sy + y * cy  # Rotate about z, then look along +y.
        pts.append((w / 2 + xr * s, h / 2 - (z - mid) * s, yr))
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
    out = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            for dy in range(ss):
                for dx in range(ss):
                    p = buf[(py * ss + dy) * w + px * ss + dx]
                    acc[0] += p[0]
                    acc[1] += p[1]
                    acc[2] += p[2]
            row.append(tuple(v // (ss * ss) for v in acc))
        out.append(row)
    return out


def write_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


def main():
    meshes = json.load(open(sys.argv[1]))
    out_path = sys.argv[2]
    # Optional third argument: the numbered badges' color as rrggbb (to preview alternatives).
    number_color = tuple(int(sys.argv[3][i:i + 2], 16) for i in (0, 2, 4)) if len(sys.argv) > 3 else NUMBER_COLOR
    cell, scale = 120, 34
    backgrounds = [(58, 66, 80), (120, 104, 84)]  # A dusk sky and a sandstone wall.
    icons = [m for m in meshes if m["name"] in COLORS]
    numbers = [m for m in meshes if m["name"] not in COLORS]
    rows_out = []
    for bg in backgrounds:
        for group, yaws in ((icons, (0, 35)), (numbers[:6], (0, 150)), (numbers[6:], (0, 150))):
            for yaw in yaws:
                cells = [render(m, color_of(m["name"], number_color), yaw, cell, scale, bg) for m in group]
                while len(cells) < max(len(icons), 6):
                    cells.append([[bg] * cell for _ in range(cell)])
                for r in range(cell):
                    rows_out.append([p for c in cells for p in c[r]])
    write_png(out_path, rows_out)
    for m in meshes:
        print(f'{KEYS.get(m["name"], m["name"][1:]):>2} {m["name"]:8s} drawn {m["drawn"]}')


if __name__ == "__main__":
    main()
