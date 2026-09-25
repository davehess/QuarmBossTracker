"""Prototype guild emblems for Zeal tags, two directions, rendered with the same part/extrude rules as
tag_shapes.cpp (flat parts, convex fans or explicit triangles, accent parts a step proud of the face).

  A. Monogram banners: one template for every guild - a swallowtail banner in a colour of its own
     with the guild's code in the 5x7 block font.
  B. Pictograms: a hand-built symbol for each guild (Wolf Pack's is the ^WP^ wolf itself).

Writes guild-banners.png, guild-pictograms.png and guild-small.png (both again at roughly tag size).
Prototype only: not in Zeal yet. Run from this folder (it uses preview.py and trace_wolf.py), with a
mesh dump from dump.cpp for the wolf: python3 guild_emblems.py <out-dir> <meshes.json>"""
import colorsys
import json
import math
import sys

import preview
from trace_wolf import triangulate

BASE, DARK, LIGHT, CONTRAST, EYE, SHADE = 0, 1, 2, 3, 4, 5
H, PROUD = 0.25, 0.03

# The 5x7 glyphs from tag_shapes.cpp (kGlyphRows), '0'-'9' then 'A'-'Z'.
GLYPHS = [
    (14, 17, 19, 21, 25, 17, 14), (4, 12, 4, 4, 4, 4, 14), (14, 17, 1, 2, 4, 8, 31), (31, 2, 4, 2, 1, 17, 14),
    (2, 6, 10, 18, 31, 2, 2), (31, 16, 30, 1, 1, 17, 14), (6, 8, 16, 30, 17, 17, 14), (31, 1, 2, 4, 8, 8, 8),
    (14, 17, 17, 14, 17, 17, 14), (14, 17, 17, 15, 1, 2, 12), (14, 17, 17, 31, 17, 17, 17),
    (30, 17, 17, 30, 17, 17, 30), (14, 17, 16, 16, 16, 17, 14), (28, 18, 17, 17, 17, 18, 28),
    (31, 16, 16, 30, 16, 16, 31), (31, 16, 16, 30, 16, 16, 16), (14, 17, 16, 23, 17, 17, 15),
    (17, 17, 17, 31, 17, 17, 17), (14, 4, 4, 4, 4, 4, 14), (7, 2, 2, 2, 2, 18, 12), (17, 18, 20, 24, 20, 18, 17),
    (16, 16, 16, 16, 16, 16, 31), (17, 27, 21, 21, 17, 17, 17), (17, 17, 25, 21, 19, 17, 17),
    (14, 17, 17, 17, 17, 17, 14), (30, 17, 17, 30, 16, 16, 16), (14, 17, 17, 17, 21, 18, 13),
    (30, 17, 17, 30, 20, 18, 17), (15, 16, 16, 14, 1, 1, 30), (31, 4, 4, 4, 4, 4, 4), (17, 17, 17, 17, 17, 17, 14),
    (17, 17, 17, 17, 17, 10, 4), (17, 17, 17, 21, 21, 21, 10), (17, 17, 10, 4, 10, 17, 17), (17, 17, 17, 10, 4, 4, 4),
    (31, 1, 2, 4, 8, 16, 31)]


def part(outline, tone=BASE, level=0, tris=None, center=None):
    y = H + PROUD * level
    return dict(outline=outline, tone=tone, y=(-y, y), tris=tris, center=center)


def one_side(outline, tone, level):  # A detail on each face, the back copy mirrored.
    y0, y1 = H - 0.02, H + PROUD * level
    return [dict(outline=outline, tone=tone, y=(-y1, -y0), tris=None, center=None),
            dict(outline=[(-x, z) for x, z in outline], tone=tone, y=(y0, y1), tris=None, center=None)]


def ellipse(cx, cz, rx, rz, n=32):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def arc(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def stroke(points, width, tone=BASE, level=0, closed=False):
    parts = []
    count = len(points) if closed else len(points) - 1
    for i in range(count):
        (ax, az), (bx, bz) = points[i], points[(i + 1) % len(points)]
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz)
        if length == 0:
            continue
        ux, uz = dx / length, dz / length
        nx, nz = -uz * width / 2, ux * width / 2
        e = width * 0.3
        a2, b2 = (ax - ux * e, az - uz * e), (bx + ux * e, bz + uz * e)
        parts.append(part([(a2[0] - nx, a2[1] - nz), (b2[0] - nx, b2[1] - nz), (b2[0] + nx, b2[1] + nz),
                           (a2[0] + nx, a2[1] + nz)], tone, level))
    return parts


def concave(outline, tone=BASE, level=0):
    pts = list(outline)
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts.reverse()
    return part(pts, tone, level, tris=triangulate(pts))


def mesh(parts):
    verts, tris = [], []
    for p in parts:
        pts, n = p["outline"], len(p["outline"])
        cx = sum(x for x, _ in pts) / n if p["center"] is None else p["center"][0]
        cz = sum(z for _, z in pts) / n if p["center"] is None else p["center"][1]
        faces = []
        for y in p["y"]:
            base = len(verts)
            verts.append([cx, y, cz, p["tone"]])
            verts += [[x, y, z, p["tone"]] for x, z in pts]
            faces.append(base)
            if p["tris"]:
                tris += [[base + 1 + a, base + 1 + b, base + 1 + c] for a, b, c in p["tris"]]
            else:
                tris += [[base, base + 1 + i, base + 1 + (i + 1) % n] for i in range(n)]
        f, b = faces[0] + 1, faces[1] + 1
        for i in range(n):
            j = (i + 1) % n
            tris += [[f + i, b + i, f + j], [b + i, b + j, f + j]]
    zs = [v[2] for v in verts]
    return {"vertices": verts, "triangles": tris, "min_z": min(zs), "max_z": max(zs)}


def glyph_parts(text, cz, cell):
    parts = []
    width = len(text) * 5 * cell + (len(text) - 1) * cell
    x0 = -width / 2
    for ch in text:
        idx = int(ch) if ch.isdigit() else 10 + ord(ch) - ord("A")
        rows = GLYPHS[idx]
        top = cz + 3.5 * cell
        for r, bits in enumerate(rows):
            c = 0
            while c < 5:
                if bits & (16 >> c):
                    e = c
                    while e + 1 < 5 and bits & (16 >> (e + 1)):
                        e += 1
                    parts += one_side(rect(x0 + c * cell, top - (r + 1) * cell, x0 + (e + 1) * cell, top - r * cell),
                                      CONTRAST, 1)
                    c = e + 1
                else:
                    c += 1
        x0 += 6 * cell
    return parts




def rotate(points, angle, cx, cz):
    c, s = math.cos(angle), math.sin(angle)
    return [(cx + (x - cx) * c - (z - cz) * s, cz + (x - cx) * s + (z - cz) * c) for x, z in points]


def rotate_parts(parts, angle, cx, cz):
    out = []
    for p in parts:
        q = dict(p)
        q["outline"] = rotate(p["outline"], angle, cx, cz)
        if p["center"] is not None:
            q["center"] = rotate([p["center"]], angle, cx, cz)[0]
        out.append(q)
    return out


def tapered(x0, z0, x1, z1, bend, width, profile, n=14):
    """A curved stroke whose width follows profile(t) (0 at a pointed end); returns an outline."""
    dx, dz = x1 - x0, z1 - z0
    length = math.hypot(dx, dz)
    nx, nz = -dz / length, dx / length
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        bx = x0 + dx * t + nx * bend * math.sin(math.pi * t)
        bz = z0 + dz * t + nz * bend * math.sin(math.pi * t)
        w = width * profile(t) / 2
        left.append((bx + nx * w, bz + nz * w))
        right.append((bx - nx * w, bz - nz * w))
    if profile(1.0) < 1e-6:
        right = right[:-1]
    if profile(0.0) < 1e-6:
        right = right[1:]
    return left + right[::-1]


def stadium(cx, cz, half, r, angle, n=10):
    pts = arc(half, 0, r, -math.pi / 2, math.pi / 2, n) + arc(-half, 0, r, math.pi / 2, 3 * math.pi / 2, n)
    return rotate([(cx + x, cz + z) for x, z in pts], angle, cx, cz)


def petal(length, width, angle, bx, bz, n=16):
    right = [(width * math.sin(math.pi * i / n), length * i / n) for i in range(n + 1)]
    pts = right + [(-x, z) for x, z in right[-2:0:-1]]
    return rotate([(bx + x, bz + z) for x, z in pts], angle, bx, bz)


# Style B pictograms -------------------------------------------------------------------------------
def euro():
    parts = stroke(arc(0.1, 1.16, 1.0, math.radians(45), math.radians(315), 24), 0.28)
    parts += stroke(arc(0.1, 1.16, 1.0, math.radians(45), math.radians(315), 24), 0.08, LIGHT, 1)
    for z in (1.34, 0.98):
        parts.append(part(rect(-1.2, z - 0.09, 0.45, z + 0.09), BASE, 1))
    return parts


def dollar():
    s = arc(0, 1.78, 0.5, math.radians(25), math.radians(270), 16) + arc(0, 0.78, 0.5, math.radians(90),
                                                                            math.radians(-155), 16)[1:]
    return [part(rect(-0.09, 0, 0.09, 2.55))] + stroke(s, 0.28) + stroke(s, 0.08, LIGHT, 1)


def d20():
    hexagon = [(1.15 * math.cos(math.radians(90 + 60 * i)), 1.3 + 1.3 * math.sin(math.radians(90 + 60 * i)))
               for i in range(6)]
    tri = [(0, 2.05), (-0.72, 0.8), (0.72, 0.8)]
    parts = [part(hexagon), part(tri, LIGHT, 1)]
    for (ax, az), (bx, bz) in [(tri[0], hexagon[0]), (tri[1], hexagon[2]), (tri[1], hexagon[3]), (tri[2], hexagon[3]),
                               (tri[2], hexagon[4]), (tri[0], hexagon[1]), (tri[0], hexagon[5]), (tri[1], hexagon[1]),
                               (tri[2], hexagon[5])]:
        parts += stroke([(ax, az), (bx, bz)], 0.06, DARK, 2)
    parts += glyph_parts("20", 1.2, 0.055)
    return parts


def infinity():
    left = ellipse(-0.58, 1.1, 0.58, 0.46, 28)
    right = ellipse(0.58, 1.1, 0.58, 0.46, 28)
    return stroke(left, 0.24, BASE, 0, True) + stroke(right, 0.24, BASE, 0, True) + \
        stroke(left, 0.07, LIGHT, 1, True) + stroke(right, 0.07, LIGHT, 1, True)


def eclipse():
    ring = ellipse(0, 1.25, 1.12, 1.12, 40)
    return [part(ellipse(0, 1.25, 1.25, 1.25, 40), EYE, 0)] + [part(ellipse(0, 1.25, 1.02, 1.02, 40), BASE, 1)] + \
        stroke(ring, 0.05, LIGHT, 2, True)


def crescent():
    big, small, offset, cz = 1.2, 1.0, 0.55, 1.25
    x = (big * big - small * small + offset * offset) / (2 * offset)  # Where the two circles cross.
    z = math.sqrt(big * big - x * x)
    a, b = math.atan2(z, x), math.atan2(z, x - offset)
    outline = arc(0, cz, big, a, 2 * math.pi - a, 30) + arc(offset, cz, small, 2 * math.pi - b, b, 24)[1:-1]
    return [concave(outline, BASE, 0), part(ellipse(-0.86, 1.55, 0.1, 0.1, 10), SHADE, 1),
            part(ellipse(-0.8, 0.95, 0.13, 0.13, 10), SHADE, 1)]


def fried_egg():
    white = [((1.25 + 0.12 * math.sin(5 * t)) * math.cos(t), 1.25 + (1.1 + 0.1 * math.sin(4 * t + 1)) * math.sin(t))
             for t in (2 * math.pi * i / 40 for i in range(40))]
    return [part(white, BASE, 0, center=(0, 1.25)), part(ellipse(0.12, 1.35, 0.48, 0.45, 28), EYE, 1),
            part(ellipse(0.0, 1.5, 0.14, 0.1, 12), LIGHT, 2)]


def tent():
    return [part([(-1.3, 0), (1.3, 0), (0, 2.3)]), part([(-0.42, 0), (0.42, 0), (0, 1.1)], DARK, 1),
            part(rect(-0.05, 2.2, 0.05, 2.7), DARK, 0), part([(0.05, 2.7), (0.6, 2.55), (0.05, 2.4)], SHADE, 0)]


def lightning():
    bolt = [(0.25, 2.8), (-0.75, 1.25), (-0.05, 1.25), (-0.45, 0.0), (0.8, 1.7), (0.1, 1.7), (0.65, 2.8)]
    return [concave(bolt, BASE, 0)]


def nova():
    pts = []
    for i in range(16):
        r = 1.3 if i % 2 == 0 else 0.5
        a = math.pi / 2 + math.pi * i / 8
        pts.append((r * math.cos(a), 1.3 + r * math.sin(a)))
    return [part(pts, BASE, 0, center=(0, 1.3)), part(ellipse(0, 1.3, 0.38, 0.38, 20), LIGHT, 1)]


def acorn():
    nut = [(-0.66, 1.3), (-0.6, 0.85), (-0.35, 0.35), (0, 0.0), (0.35, 0.35), (0.6, 0.85), (0.66, 1.3)]
    cap = arc(0, 1.3, 0.8, 0, math.pi, 18)
    return [concave(nut, BASE, 0), part(cap, SHADE, 1, center=(0, 1.55)), part(rect(-0.07, 2.05, 0.07, 2.45), SHADE, 1)] \
        + stroke(arc(0, 1.3, 0.8, 0.15, math.pi - 0.15, 10), 0.05, DARK, 2)


def eye():
    half_w, half_h, cz = 1.3, 0.62, 1.25
    r = (half_w * half_w + half_h * half_h) / (2 * half_h)
    span = math.asin(half_w / r)
    top = arc(0, cz + half_h - r, r, math.pi / 2 - span, math.pi / 2 + span, 18)
    bottom = arc(0, cz - half_h + r, r, 3 * math.pi / 2 - span, 3 * math.pi / 2 + span, 18)
    return [part(top + bottom[1:-1], BASE, 0, center=(0, cz)), part(ellipse(0, cz, 0.52, 0.52, 24), EYE, 1),
            part(ellipse(0, cz, 0.24, 0.24, 16), DARK, 2), part(ellipse(0.16, cz + 0.16, 0.08, 0.08, 10), LIGHT, 3)]


def axe():
    parts = [part(rect(-0.08, 0.0, 0.08, 2.75), DARK, 0), part([(-0.08, 2.75), (0.08, 2.75), (0, 3.05)], DARK, 0)]
    for side in (-1, 1):
        edge = arc(0.3, 2.1, 0.95, math.radians(48), math.radians(-48), 12)
        blade = [(0.08, 2.35)] + edge + [(0.08, 1.85)]
        parts.append(part([(side * x, z) for x, z in blade], BASE, 1))
        parts += stroke([(side * x, z) for x, z in arc(0.3, 2.1, 0.86, math.radians(44), math.radians(-44), 10)],
                        0.06, LIGHT, 2)
    return parts


def lotus():
    parts = []
    for angle, length, width, tone, level in ((1.3, 1.25, 0.32, SHADE, 0), (-1.3, 1.25, 0.32, SHADE, 0),
                                              (0.62, 1.75, 0.4, SHADE, 1), (-0.62, 1.75, 0.4, SHADE, 1),
                                              (0.0, 2.25, 0.46, BASE, 2)):
        parts.append(part(petal(length, width, angle, 0, 0.35), tone, level))
    return parts + stroke([(-1.3, 0.3), (1.3, 0.3)], 0.12, LIGHT, 3)


def ankh():
    return stroke(ellipse(0, 2.2, 0.42, 0.56, 24), 0.26, BASE, 0, True) + \
        stroke(ellipse(0, 2.2, 0.42, 0.56, 24), 0.07, LIGHT, 1, True) + \
        [part(rect(-0.82, 1.42, 0.82, 1.7)), part([(-0.13, 1.6), (0.13, 1.6), (0.26, 0.0), (-0.26, 0.0)])]


def anchor():
    parts = [part(rect(-0.09, 0.3, 0.09, 2.3)), part(rect(-0.6, 1.95, 0.6, 2.12))]
    parts += stroke(ellipse(0, 2.52, 0.22, 0.22, 16), 0.12, BASE, 0, True)
    parts += stroke(arc(0, 1.05, 0.95, math.radians(200), math.radians(340), 14), 0.22)
    for side in (-1, 1):
        x, z = side * 0.95 * math.cos(math.radians(20)), 1.05 - 0.95 * math.sin(math.radians(20))
        parts.append(part([(x + side * 0.05, z + 0.45), (x - side * 0.2, z - 0.1), (x + side * 0.26, z - 0.02)]))
    return parts


def claws():
    profile = lambda t: math.sin(math.pi * t) ** 0.7  # noqa: E731
    return [concave(tapered(0.55 + dx, 2.7, -0.75 + dx, 0.1, 0.18, 0.34, profile)) for dx in (-0.5, 0.0, 0.5)]


def match():
    smoke = [(0.02, 2.55), (0.2, 2.75), (0.05, 2.95), (0.25, 3.15), (0.12, 3.35)]
    return [part(rect(-0.1, 0.0, 0.1, 1.95)), part(ellipse(0, 2.12, 0.2, 0.3, 16), DARK, 1),
            part(ellipse(0.02, 2.25, 0.07, 0.07, 8), EYE, 2)] + stroke(smoke, 0.08, LIGHT, 0)


def crown():
    top = [(-0.9, 0.85), (0.9, 0.85), (1.05, 2.0), (0.5, 1.35), (0, 2.25), (-0.5, 1.35), (-1.05, 2.0)]
    parts = [part(rect(-0.9, 0.5, 0.9, 0.9)), concave(top)]
    parts += [part(ellipse(x, z, 0.12, 0.12, 10), LIGHT, 1) for x, z in ((-1.05, 2.0), (0, 2.25), (1.05, 2.0))]
    parts += [part(ellipse(x, 0.7, 0.1, 0.1, 10), DARK, 1) for x in (-0.5, 0, 0.5)]
    return rotate_parts(parts, math.radians(-18), 0, 1.2)


def delta():
    tri = [(0, 2.5), (-1.25, 0.15), (1.25, 0.15)]
    return stroke(tri, 0.26, BASE, 0, True) + stroke(tri, 0.07, LIGHT, 1, True) + \
        [part(ellipse(0, 0.95, 0.24, 0.24, 16), BASE, 0)]


def house():
    return [part(rect(-0.85, 0, 0.85, 1.3)), part(rect(0.5, 1.5, 0.78, 2.35), SHADE, 0),
            part([(-1.18, 1.2), (1.18, 1.2), (0, 2.3)], SHADE, 1), part(rect(-0.22, 0, 0.22, 0.78), DARK, 1),
            part(rect(0.36, 0.62, 0.68, 0.98), EYE, 1)]


def bird():
    wing = lambda t: (1 - t) ** 0.8  # noqa: E731
    return [concave(tapered(-0.08, 1.1, -1.35, 2.0, -0.32, 0.34, wing)),
            concave(tapered(0.08, 1.1, 1.35, 2.0, 0.32, 0.34, wing)), part(ellipse(0, 1.08, 0.2, 0.16, 12))]


def tankard():
    parts = [part(rect(-0.6, 0, 0.6, 1.7))]
    parts += stroke(arc(0.62, 0.9, 0.45, math.radians(-80), math.radians(80), 10), 0.18, SHADE, 0)
    parts += [part(rect(-0.6, z, 0.6, z + 0.13), DARK, 1) for z in (0.22, 1.3)]
    parts += [part(rect(-0.64, 1.62, 0.64, 1.82), LIGHT, 1)]
    parts += [part(ellipse(x, z, rx, rz, 16), LIGHT, 1) for x, z, rx, rz in ((-0.35, 1.85, 0.34, 0.26),
                                                                             (0.1, 1.95, 0.38, 0.3),
                                                                             (0.45, 1.83, 0.3, 0.24))]
    return parts


def waves():
    parts = []
    for k in range(3):
        pts = [(x / 10, 0.45 + 0.8 * k + 0.18 * math.sin(2.6 * x / 10 + k)) for x in range(-12, 13)]
        parts += stroke(pts, 0.22, BASE, 0) + stroke(pts, 0.06, LIGHT, 1)
    return parts


def mirror():
    parts = [part(rect(-0.12, 0.0, 0.12, 1.05)), part(ellipse(0, 0.05, 0.2, 0.12, 12)),
             part(ellipse(0, 1.85, 0.76, 0.92, 32)), part(ellipse(0, 1.85, 0.6, 0.76, 32), DARK, 1)]
    parts += stroke([(-0.35, 1.9), (-0.05, 2.3)], 0.09, LIGHT, 2) + stroke([(-0.3, 1.6), (0.12, 2.15)], 0.05, LIGHT, 2)
    return parts


def serpent():
    parts = stroke([(x / 10, 0.45 + 0.06 * math.sin(x)) for x in range(-14, 15)], 0.08, LIGHT, 0)
    for cx in (-0.95, -0.2):
        parts += stroke(arc(cx, 0.5, 0.32, 0, math.pi, 10), 0.26, BASE, 1)
    parts += stroke([(0.4, 0.5), (0.5, 1.1), (0.7, 1.55)], 0.26, BASE, 1)
    parts.append(part(ellipse(0.9, 1.62, 0.32, 0.18, 16), BASE, 1))
    parts.append(part(ellipse(0.88, 1.7, 0.05, 0.05, 8), EYE, 2))
    return parts


def tower():
    parts = [part([(-0.6, 0), (0.6, 0), (0.5, 1.9), (-0.5, 1.9)]), part(rect(-0.72, 1.85, 0.72, 2.2))]
    parts += [part(rect(x, 2.15, x + 0.3, 2.5)) for x in (-0.72, -0.15, 0.42)]
    parts += [part(rect(-0.2, 0, 0.2, 0.5), DARK, 1), part(ellipse(0, 0.5, 0.2, 0.2, 12), DARK, 1),
              part(rect(-0.06, 1.1, 0.06, 1.5), EYE, 1)]
    return parts


def chain():
    a, b = stadium(-0.55, 1.25, 0.4, 0.4, 0, 12), stadium(0.55, 1.25, 0.4, 0.4, 0, 12)
    parts = stroke(a, 0.2, BASE, 0, True) + stroke(b, 0.2, SHADE, 1, True)
    parts += stroke(arc(-0.15, 1.25, 0.4, math.radians(45), math.radians(88), 5), 0.2, BASE, 2)  # A passes over B here.
    return rotate_parts(parts, math.radians(30), 0, 1.25)


def ball_and_chain():
    parts = [part(ellipse(0.45, 0.75, 0.75, 0.75, 28)), part(ellipse(0.2, 1.0, 0.16, 0.16, 10), LIGHT, 1)]
    for i, (x, z) in enumerate(((-0.12, 1.55), (-0.42, 1.85), (-0.72, 2.15))):
        if i % 2 == 0:
            parts += stroke(ellipse(x, z, 0.24, 0.16, 14), 0.1, SHADE, 1, True)
        else:
            parts.append(part(rotate(rect(x - 0.26, z - 0.06, x + 0.26, z + 0.06), math.radians(-45), x, z), SHADE, 2))
    parts += stroke(arc(-0.98, 2.5, 0.36, math.radians(-60), math.radians(240), 14), 0.14, SHADE, 1)
    return parts


PICTOGRAMS = {  # guild -> (builder, colour)
    "Mayhem": (lightning, (0xF4, 0xD0, 0x30)),
    "Europa": (euro, (0xE8, 0xA0, 0x20)),
    "Tranquility": (lotus, (0xF0, 0x9A, 0xC8)),
    "Squirrels of War": (acorn, (0xB0, 0x78, 0x40)),
    "Intervention": (ankh, (0xE8, 0xC0, 0x40)),
    "Erud's Crossing Guard": (anchor, (0x4A, 0x86, 0xD8)),
    "Savage": (claws, (0xD8, 0x2A, 0x2A)),
    "Burnouts": (match, (0xD8, 0xB0, 0x78)),
    "Former Glory": (crown, (0xE8, 0xB8, 0x30)),
    "Axiom": (delta, (0x40, 0xD0, 0xB0)),
    "Haven": (house, (0xC8, 0x8A, 0x5A)),
    "Freedom": (bird, (0x8C, 0xC8, 0xF0)),
    "Seekers of Souls": (eye, (0x9A, 0xB4, 0xD8)),
    "Hardened Casuals": (tankard, (0xC8, 0x86, 0x30)),
    "Nocturnal": (crescent, (0xD8, 0xDC, 0xF0)),
    "Dungeons and Dragons": (d20, (0xC0, 0x30, 0x30)),
    "Zek": (axe, (0xB8, 0xBE, 0xC8)),
    "The Drift": (waves, (0x30, 0xB8, 0xC8)),
    "Continuum": (infinity, (0x40, 0xC0, 0xE0)),
    "Eclipse": (eclipse, (0x1C, 0x21, 0x2A)),
    "Loot & Some Fun": (dollar, (0x3A, 0xB0, 0x5A)),
    "Novae": (nova, (0xA0, 0x70, 0xF0)),
    "Mass Group Ego": (mirror, (0xE0, 0xB0, 0x40)),
    "Breakfast Club": (fried_egg, (0xF6, 0xF4, 0xEE)),
    "Here There Be Monsters": (serpent, (0x48, 0xB0, 0x60)),
    "Sentinels": (tower, (0x9C, 0xA4, 0xB0)),
    "Alianza": (chain, (0xE0, 0xB8, 0x48)),
    "Camped": (tent, (0x6E, 0x8B, 0x3D)),
    "Convicts": (ball_and_chain, (0x8A, 0x92, 0x9E)),
}

GUILDS = [  # (guild, code): Wolf Pack, then the list the guild lead shared, in its order
    ("Wolf Pack", "WP"), ("Mayhem", "MAY"), ("Europa", "EUR"), ("Tranquility", "TRQ"), ("Squirrels of War", "SOW"),
    ("Intervention", "INT"), ("Erud's Crossing Guard", "ECG"), ("Savage", "SAV"), ("Burnouts", "BRN"),
    ("Former Glory", "FG"), ("Axiom", "AX"), ("Haven", "HVN"), ("Freedom", "FRE"), ("Seekers of Souls", "SOS"),
    ("Hardened Casuals", "HC"), ("Nocturnal", "NOC"), ("Dungeons and Dragons", "DND"), ("Zek", "ZEK"),
    ("The Drift", "DRF"), ("Continuum", "CON"), ("Eclipse", "ECL"), ("Loot & Some Fun", "LSF"), ("Novae", "NOV"),
    ("Mass Group Ego", "MGE"), ("Breakfast Club", "BC"), ("Here There Be Monsters", "HBM"), ("Sentinels", "SEN"),
    ("Alianza", "ALZ"), ("Camped", "CMP"), ("Convicts", "CVT")]


def banner(code):
    """Style A: a swallowtail banner on a rod, the guild code in block letters."""
    body = [(-0.95, 0.0), (0.0, 0.55), (0.95, 0.0), (0.95, 2.75), (-0.95, 2.75)]
    parts = [concave(body, SHADE, 0)]
    inner = [(-0.83, 0.2), (0.0, 0.7), (0.83, 0.2), (0.83, 2.63), (-0.83, 2.63)]
    parts.append(concave(inner, BASE, 1))
    parts.append(part(rect(-1.15, 2.75, 1.15, 2.9), DARK, 0))
    for x in (-1.2, 1.2):
        parts.append(part(ellipse(x, 2.825, 0.1, 0.1, 12), DARK, 1))
    cell = 0.095 if len(code) == 3 else 0.125
    for p in glyph_parts(code, 1.75, cell):  # A step above the inner field, or they sit level with it.
        p["y"] = tuple(y * (H + 2 * PROUD) / (H + PROUD) if abs(y) > H else y for y in p["y"])
        parts.append(p)
    return parts


def code_colour(code):
    """A stable colour per code (what Zeal would compute from the letters), spread round the hue wheel."""
    h = 0
    for c in code:
        h = (h * 31 + ord(c)) % 997
    hue = (h * 0.618034) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.62, 0.82)
    return (int(r * 255), int(g * 255), int(b * 255))


def label(text, width, px, fg=(201, 209, 217), bg=(58, 66, 80)):
    """The code under each icon, in the same 5x7 font, `px` pixels per font cell."""
    h = 9 * px
    rows = [[bg] * width for _ in range(h)]
    x0 = (width - (len(text) * 6 - 1) * px) // 2
    for ch in text:
        if ch.isalnum():
            bits_rows = GLYPHS[int(ch) if ch.isdigit() else 10 + ord(ch) - ord("A")]
            for r, bits in enumerate(bits_rows):
                for c in range(5):
                    if bits & (16 >> c):
                        for dy in range(px):
                            for dx in range(px):
                                rows[px + r * px + dy][x0 + c * px + dx] = fg
        x0 += 6 * px
    return rows


def sheet(items, out, cell, scale, per_row, bg=(58, 66, 80), px=2):
    rows = []
    for start in range(0, len(items), per_row):
        chunk = items[start:start + per_row]
        cells = [preview.render(parts if isinstance(parts, dict) else mesh(parts), colour, 0, cell, scale, bg) +
                 label(code, cell, px, bg=bg)
                 for parts, colour, code in chunk]
        while len(cells) < per_row:
            cells.append([[bg] * cell for _ in range(cell + 9 * px)])
        for r in range(len(cells[0])):
            rows.append([p for c in cells for p in c[r]])
    preview.write_png(out, rows)


def main():
    out = sys.argv[1]
    # Wolf Pack's emblem is the ^WP^ wolf itself, taken from a dump of the real meshes (preview/dump.cpp).
    wolf = next(m for m in json.load(open(sys.argv[2])) if m["name"] == "Wolf")
    PICTOGRAMS["Wolf Pack"] = (lambda: wolf, (0xE8, 0xE2, 0xD4))
    banners = [(banner(code), code_colour(code), code) for _, code in GUILDS]
    pictos = [(PICTOGRAMS[g][0](), PICTOGRAMS[g][1], code) for g, code in GUILDS]
    sheet(banners, f"{out}/guild-banners.png", 110, 31, 10)
    sheet(pictos, f"{out}/guild-pictograms.png", 110, 31, 10)
    # Both again at roughly tag size, which is where they have to work.
    small = [item for pair in zip(banners, pictos) for item in pair]
    sheet(small, f"{out}/guild-small.png", 40, 10.5, 20, px=1)
    for i, (guild, code) in enumerate(GUILDS):
        print(f"{i + 1:2d} {code:3s} {guild}")


if __name__ == "__main__":
    main()
