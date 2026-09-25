"""Traces the landing-page wolf (web/public/wolf.png + wolf-eyes.png) into layered, triangulated parts
for Zeal's tag shapes, and writes them as a C++ include.

The artwork is bone linework on transparency: the face, the dark lines cut through it, the eye islands
inside the eye lines, and the pupils cut through those. That nesting becomes layers: every region is
filled by its own outline and drawn slightly prouder than the region it sits in, so no polygon needs
holes. Even depths take the tag color (or eye yellow for the eye islands), odd depths the dark accent.

Standard library only: a minimal PNG decoder, crack-following contour tracing, Douglas-Peucker
simplification and ear-clipping triangulation.

Usage: python3 trace_wolf.py <wolf.png> <wolf-eyes.png> <out-dir>
Writes <out-dir>/wolf_<variant>.json (for inspection) and <out-dir>/tag_shapes_wolf_<variant>.inc.
"""
import json
import math
import os
import struct
import sys
import zlib
from collections import deque


def read_png_alpha(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8 and color == 6 and interlace == 0, "expects 8-bit RGBA, not interlaced"
        elif kind == b"IDAT":
            idat += chunk
    raw = zlib.decompress(idat)
    bpp, stride = 4, width * 4
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(height):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return width, height, [[row[4 * x + 3] for x in range(width)] for row in rows]


def downsample(alpha, factor, threshold):
    h, w = len(alpha) // factor, len(alpha[0]) // factor
    out = []
    for y in range(h):
        row = []
        for x in range(w):
            s = 0
            for yy in range(y * factor, y * factor + factor):
                s += sum(alpha[yy][x * factor:x * factor + factor])
            row.append(s / (factor * factor) >= threshold)
        out.append(row)
    return out


def label(mask, value, eight):
    h, w = len(mask), len(mask[0])
    labels = [[-1] * w for _ in range(h)]
    steps = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (1, -1), (-1, 1), (-1, -1)] if eight else [])
    comps = []
    for y in range(h):
        for x in range(w):
            if mask[y][x] != value or labels[y][x] != -1:
                continue
            idx = len(comps)
            pixels, q = [], deque([(x, y)])
            labels[y][x] = idx
            while q:
                cx, cy = q.popleft()
                pixels.append((cx, cy))
                for dx, dy in steps:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] == value and labels[ny][nx] == -1:
                        labels[ny][nx] = idx
                        q.append((nx, ny))
            comps.append(pixels)
    return labels, comps


def outer_loop(pixels):
    """Outer boundary of a pixel set as a closed loop of pixel-corner points (region on the right, y down)."""
    s = set(pixels)
    out = {}
    for x, y in pixels:
        if (x, y - 1) not in s:
            out.setdefault((x, y), []).append((x + 1, y))
        if (x + 1, y) not in s:
            out.setdefault((x + 1, y), []).append((x + 1, y + 1))
        if (x, y + 1) not in s:
            out.setdefault((x + 1, y + 1), []).append((x, y + 1))
        if (x - 1, y) not in s:
            out.setdefault((x, y + 1), []).append((x, y))
    used, loops = set(), []
    for start in list(out):
        for end in out[start]:
            if (start, end) in used:
                continue
            loop, a, b = [start], start, end
            used.add((a, b))
            while b != start:
                loop.append(b)
                d = (b[0] - a[0], b[1] - a[1])
                cands = [e for e in out.get(b, []) if (b, e) not in used]
                if not cands:
                    break

                def turn(e):  # Prefer right, then straight, then left (keeps loops separate at pinches).
                    nd = (e[0] - b[0], e[1] - b[1])
                    if nd == (-d[1], d[0]):
                        return 0
                    return 1 if nd == d else 2

                nxt = min(cands, key=turn)
                used.add((b, nxt))
                a, b = b, nxt
            loops.append(loop)
    return max(loops, key=lambda lp: abs(area(lp)))


def area(loop):
    return sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1]
               for i in range(len(loop))) / 2


def simplify(loop, tol):
    """Douglas-Peucker on a closed loop, split at its two farthest-apart points."""
    def dp(pts):
        if len(pts) < 3:
            return pts
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        dx, dy = x1 - x0, y1 - y0
        norm = math.hypot(dx, dy) or 1e-9
        best, idx = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs(dy * (pts[i][0] - x0) - dx * (pts[i][1] - y0)) / norm
            if d > best:
                best, idx = d, i
        if best <= tol:
            return [pts[0], pts[-1]]
        return dp(pts[:idx + 1])[:-1] + dp(pts[idx:])

    far = max(range(len(loop)), key=lambda i: (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2)
    a = dp(loop[:far + 1])
    b = dp(loop[far:] + [loop[0]])
    out = a[:-1] + b[:-1]
    # Drop repeated and collinear points left at the joins.
    clean = []
    for p in out:
        if not clean or p != clean[-1]:
            clean.append(p)
    return clean


def triangulate(poly):
    """Ear clipping for a simple polygon given counter-clockwise (math orientation). Returns index triples."""
    idx = list(range(len(poly)))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        n = len(idx)
        clipped = False
        for i in range(n):
            ia, ib, ic = idx[(i - 1) % n], idx[i], idx[(i + 1) % n]
            a, b, c = poly[ia], poly[ib], poly[ic]
            if cross(a, b, c) <= 1e-12:
                continue  # Reflex or flat.
            if any(inside(poly[j], a, b, c) for j in idx if j not in (ia, ib, ic) and poly[j] not in (a, b, c)):
                continue
            tris.append((ia, ib, ic))
            del idx[i]
            clipped = True
            break
        if not clipped:  # Degenerate spot (a touching vertex): drop the flattest vertex and carry on.
            i = min(range(n), key=lambda k: abs(cross(poly[idx[(k - 1) % n]], poly[idx[k]], poly[idx[(k + 1) % n]])))
            del idx[i]
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def build(wolf_png, eyes_png, variant):
    factor = 4
    _, _, alpha = read_png_alpha(wolf_png)
    _, _, eye_alpha = read_png_alpha(eyes_png)
    mask = downsample(alpha, factor, 128)
    eyes = downsample(eye_alpha, factor, 64)
    h, w = len(mask), len(mask[0])

    fg_labels, fg = label(mask, True, eight=False)
    bg_labels, bg = label(mask, False, eight=True)
    outside = bg_labels[0][0]

    # Depth by alternating flood from the outside: fg next to the outside is 0, holes in it 1, and so on.
    depth = {("bg", outside): -1}
    frontier = [("bg", outside)]
    while frontier:
        nxt = []
        for kind, i in frontier:
            pixels = (bg if kind == "bg" else fg)[i]
            other, labels = ("fg", fg_labels) if kind == "bg" else ("bg", bg_labels)
            for x, y in pixels:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        j = labels[ny][nx]
                        if j != -1 and (other, j) not in depth:
                            depth[(other, j)] = depth[(kind, i)] + 1
                            nxt.append((other, j))
        frontier = nxt

    opts = {
        "classic": dict(tol=1.2, min_area=30, keep="all"),
        "outlined": dict(tol=1.2, min_area=30, keep="all"),
        "badge": dict(tol=1.2, min_area=30, keep="all"),
        "shadow": dict(tol=1.2, min_area=1, keep="eyes"),
        "steel": dict(tol=1.2, min_area=30, keep="all"),
    }[variant]

    regions = []
    for (kind, i), d in depth.items():
        if d < 0:
            continue
        pixels = (bg if kind == "bg" else fg)[i]
        eye_hits = sum(1 for x, y in pixels if eyes[y][x])
        is_eye = kind == "fg" and d >= 2 and eye_hits * 2 >= len(pixels)
        regions.append(dict(kind=kind, i=i, depth=d, pixels=pixels, eye=is_eye))

    # The eye subtree: the eye islands, the lines ringing them, and the pupils inside.
    eye_regions = [r for r in regions if r["eye"]]

    def near_eye(r):  # A pupil: a hole inside an eye island's bounding box.
        xs = [p[0] for p in r["pixels"]]
        ys = [p[1] for p in r["pixels"]]
        for e in eye_regions:
            ex = [p[0] for p in e["pixels"]]
            ey = [p[1] for p in e["pixels"]]
            if min(xs) >= min(ex) and max(xs) <= max(ex) and min(ys) >= min(ey) and max(ys) <= max(ey):
                return True
        return False

    silhouette = max((r for r in regions if r["depth"] == 0), key=lambda r: len(r["pixels"]))
    ys = [p[1] for p in silhouette["pixels"]]
    xs = [p[0] for p in silhouette["pixels"]]
    top, bottom, cx = min(ys), max(ys) + 1, (min(xs) + max(xs) + 1) / 2
    size = {"badge": 2.1, "outlined": 2.85}.get(variant, 3.0)
    scale = size / (bottom - top)
    z_offset = {"badge": 0.2, "outlined": 0.075}.get(variant, 0.0)

    parts = []
    if variant == "badge":  # A dark disc behind the wolf, the same size as the numbered badges.
        n = 48
        pts = [(1.25 * math.cos(2 * math.pi * k / n), 1.25 + 1.25 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        parts.append(dict(tone="Dark", depth=0, points=pts, tris=[(0, k, k + 1) for k in range(1, n - 1)]))
    if variant == "outlined":  # A dark border: the silhouette grown by a few pixels, behind the wolf.
        grow, sil = 3, set(silhouette["pixels"])
        grown = {(x + dx, y + dy) for x, y in sil for dx in range(-grow, grow + 1) for dy in range(-grow, grow + 1)
                 if dx * dx + dy * dy <= grow * grow}
        loop = simplify(outer_loop(list(grown)), opts["tol"])
        pts = [((x - cx) * scale, z_offset + (bottom - y) * scale) for x, y in loop]
        if area(pts) < 0:
            pts.reverse()
        parts.append(dict(tone="Dark", depth=0, points=pts, tris=triangulate(pts)))
    base_depth = 1 if variant in ("badge", "outlined") else 0
    for r in sorted(regions, key=lambda r: r["depth"]):
        if r is not silhouette and r["depth"] == 0:
            continue  # Stray specks outside the main head.
        if r["depth"] > 0 and len(r["pixels"]) < opts["min_area"] and not r["eye"]:
            continue
        if opts["keep"] == "eyes" and r["depth"] > 0 and not (r["eye"] or near_eye(r)):
            continue
        loop = simplify(outer_loop(r["pixels"]), opts["tol"])
        pts = [((x - cx) * scale, z_offset + (bottom - y) * scale) for x, y in loop]
        if area(pts) < 0:
            pts.reverse()
        if len(pts) < 3:
            continue
        if variant == "shadow" and r["eye"]:  # Bigger eyes, so they glow out of the dark head.
            ex = sum(p[0] for p in pts) / len(pts)
            ez = sum(p[1] for p in pts) / len(pts)
            pts = [(ex + (x - ex) * 1.9, ez + (z - ez) * 1.9) for x, z in pts]
        d = r["depth"]
        if r["eye"]:
            tone = "Eye"
        elif d % 2 == 0:
            tone = "Base"
        else:
            tone = "Contrast" if variant == "steel" else "Dark"
        parts.append(dict(tone=tone, depth=base_depth + d, points=pts, tris=triangulate(pts)))
    return parts


def write_inc(parts, path, variant):
    lines = [
        "// Generated by trace_wolf.py from web/public/wolf.png and wolf-eyes.png (the Wolf Pack landing-page wolf),",
        f"// variant '{variant}'. Do not edit by hand; regenerate instead.",
        "std::vector<Part> WolfParts() {",
        "  std::vector<Part> parts;",
    ]
    for p in parts:
        y = 0.25 + 0.02 * p["depth"]
        pts = ", ".join(f"{{{x:.3f}f, {z:.3f}f}}" for x, z in p["points"])
        tris = ", ".join(str(i) for t in p["tris"] for i in t)
        lines.append(f"  parts.push_back({{{{{pts}}}, {{0, 0}}, Tone::{p['tone']}, {-y:.2f}f, {y:.2f}f, {{{tris}}}}});")
    lines += ["  return parts;", "}", ""]
    open(path, "w").write("\n".join(lines))


def main():
    wolf_png, eyes_png, out_dir = sys.argv[1:4]
    variants = sys.argv[4:] or ["classic", "outlined", "badge", "shadow", "steel"]
    for v in variants:
        parts = build(wolf_png, eyes_png, v)
        json.dump(parts, open(os.path.join(out_dir, f"wolf_{v}.json"), "w"))
        write_inc(parts, os.path.join(out_dir, f"tag_shapes_wolf_{v}.inc"), v)
        npts = sum(len(p["points"]) for p in parts)
        ntris = sum(len(p["tris"]) for p in parts)
        print(f"{v:9s} parts {len(parts):3d}  points {npts:4d}  triangles {ntris:4d}  "
              f"eyes {sum(1 for p in parts if p['tone'] == 'Eye')}")


if __name__ == "__main__":
    main()
