#!/usr/bin/env python3
"""
Generate the Mimic app icon — chest's fanged maw spans the FULL height of
the icon (upper jaw at the very top, lower jaw at the very bottom), with a
grey + white wolf head exposed in the middle. Theme: chest = mimic, wolf =
Wolf Pack, but with the wolf as the hero of the composition.

Design notes:
  - Jaws reach the icon's top + bottom edges (no chest chrome above/below
    the teeth) — the mouth IS the frame.
  - Gold chest frame visible only at the sides (a vertical pair of strips
    with rivets and the iron band) so the silhouette still reads "mimic
    chest" without crowding the wolf.
  - Wolf head fills the middle band: grey body, white snout + chest blaze
    + ear interiors + brow markings, amber glowing eyes.

Outputs:
  apps/mimic/build/icon.png   (512x512)
  apps/mimic/build/icon.ico   (multi-res: 16/24/32/48/64/128/256)
  apps/mimic/build/tray.png   (16x16)
  apps/mimic/build/tray@2x.png(32x32)
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import random

# Palette
GOLD        = (210, 152, 48,  255)
GOLD_LIGHT  = (236, 184, 78,  255)
GOLD_SHADOW = (152, 102, 28,  255)
BROWN       = (74,  44,  18,  255)
DARK        = (8,   8,   12,  255)
TOOTH       = (252, 246, 224, 255)
TOOTH_SHADE = (200, 195, 175, 255)
WOLF_GREY   = (128, 132, 140, 255)
WOLF_DARK   = (76,  80,  90,  255)
WOLF_WHITE  = (240, 240, 244, 255)
WOLF_NOSE   = (28,  28,  34,  255)
EYE         = (246, 195, 101, 255)
EYE_HOT     = (255, 240, 180, 255)

MASTER = 1024


def render(size=MASTER):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    s   = size

    def px(f): return int(s * f)

    stroke = max(2, px(0.010))
    rng    = random.Random(7)  # deterministic across runs

    # ── Dark interior (the maw cavity, spans full height) ──────────────────
    # Slight side inset so gold chest strips can run down the sides.
    cavity_left  = px(0.08)
    cavity_right = px(0.92)
    d.rounded_rectangle([cavity_left, 0, cavity_right, s],
                        radius=px(0.04), fill=DARK)

    # ── Gold chest side strips (left + right) ──────────────────────────────
    strip_w = px(0.08)
    for x0, x1 in [(0, strip_w), (s - strip_w, s)]:
        d.rounded_rectangle([x0, 0, x1, s], radius=px(0.03),
                            fill=GOLD, outline=BROWN, width=stroke)
        # Rivets running vertically on the strips
        cx = (x0 + x1) // 2
        for fy in (0.10, 0.30, 0.70, 0.90):
            rr = px(0.012)
            d.ellipse([cx - rr, px(fy) - rr, cx + rr, px(fy) + rr],
                      fill=GOLD_LIGHT)

    # ── Iron band across the middle (with central lock) ────────────────────
    band_y = px(0.50)
    band_h = px(0.07)
    d.rectangle([0, band_y - band_h//2, s, band_y + band_h//2], fill=BROWN)
    # Restore the dark cavity where the band crosses it (band sits "behind"
    # the wolf, but in front of nothing else)
    d.rectangle([cavity_left + px(0.005), band_y - band_h//2 + px(0.005),
                 cavity_right - px(0.005), band_y + band_h//2 - px(0.005)],
                fill=DARK)
    # Lock (recessed in middle)
    lock_w = px(0.10)
    lock_h = px(0.10)
    cx     = s // 2
    lock_y = band_y
    d.rounded_rectangle(
        [cx - lock_w//2, lock_y - lock_h//2, cx + lock_w//2, lock_y + lock_h//2],
        radius=px(0.012), fill=GOLD_SHADOW, outline=BROWN, width=stroke
    )
    kh_r = px(0.014)
    d.ellipse([cx - kh_r, lock_y - kh_r, cx + kh_r, lock_y + kh_r], fill=DARK)

    # ── TOP JAW — teeth hanging from the very top edge ─────────────────────
    tooth_n   = 9
    tooth_w   = (cavity_right - cavity_left) / tooth_n
    tooth_max = px(0.18)
    for i in range(tooth_n):
        x1 = int(cavity_left + i * tooth_w)
        x2 = int(cavity_left + (i + 1) * tooth_w)
        mid = (x1 + x2) // 2
        # Bigger fangs toward the center, smaller at the edges.
        edge_falloff = 1 - abs((i - tooth_n / 2) / (tooth_n / 2)) * 0.35
        h = int(tooth_max * (0.65 + rng.random() * 0.5) * edge_falloff)
        d.polygon([(x1, 0), (x2, 0), (mid, h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # ── BOTTOM JAW — teeth rising from the very bottom edge ────────────────
    bot_tooth_n = 9
    bot_tooth_w = (cavity_right - cavity_left) / bot_tooth_n
    bot_tooth_max = px(0.16)
    for i in range(bot_tooth_n):
        x1 = int(cavity_left + i * bot_tooth_w)
        x2 = int(cavity_left + (i + 1) * bot_tooth_w)
        mid = (x1 + x2) // 2
        edge_falloff = 1 - abs((i - bot_tooth_n / 2) / (bot_tooth_n / 2)) * 0.35
        h = int(bot_tooth_max * (0.65 + rng.random() * 0.5) * edge_falloff)
        d.polygon([(x1, s), (x2, s), (mid, s - h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # ── Wolf head (grey + white) — fills the middle band, hero of the icon ─
    # Anchored around the central horizontal axis. Big enough that ear tips
    # reach into the top teeth and chin reaches into the bottom teeth.
    cy = s // 2

    # Ear triangles (poke up above the band, into the top teeth)
    ear_tip_y   = px(0.18)
    ear_outer_x = px(0.20)  # how far from center each ear is
    ear_base_y  = px(0.34)
    ear_w       = px(0.10)
    # Left ear
    d.polygon([(cx - ear_outer_x - ear_w//2, ear_base_y + px(0.02)),
               (cx - ear_outer_x + ear_w//2, ear_base_y - px(0.01)),
               (cx - ear_outer_x - ear_w//4, ear_tip_y)],
              fill=WOLF_DARK)
    # Right ear
    d.polygon([(cx + ear_outer_x + ear_w//2, ear_base_y + px(0.02)),
               (cx + ear_outer_x - ear_w//2, ear_base_y - px(0.01)),
               (cx + ear_outer_x + ear_w//4, ear_tip_y)],
              fill=WOLF_DARK)
    # Inner ears (pink-grey hint)
    d.polygon([(cx - ear_outer_x - ear_w//5, ear_base_y),
               (cx - ear_outer_x + ear_w//4, ear_base_y - px(0.005)),
               (cx - ear_outer_x - ear_w//8, ear_tip_y + px(0.04))],
              fill=WOLF_WHITE)
    d.polygon([(cx + ear_outer_x + ear_w//5, ear_base_y),
               (cx + ear_outer_x - ear_w//4, ear_base_y - px(0.005)),
               (cx + ear_outer_x + ear_w//8, ear_tip_y + px(0.04))],
              fill=WOLF_WHITE)

    # Head proper — rounded shape from ear-base down to chin
    head_top    = px(0.30)
    head_bot    = px(0.72)
    head_left   = cx - px(0.30)
    head_right  = cx + px(0.30)
    d.rounded_rectangle([head_left, head_top, head_right, head_bot],
                        radius=px(0.12), fill=WOLF_GREY)

    # White facial blaze (forehead → snout)
    blaze_top   = px(0.32)
    blaze_bot   = px(0.75)
    blaze_w_top = px(0.05)
    blaze_w_bot = px(0.10)
    d.polygon([(cx - blaze_w_top, blaze_top),
               (cx + blaze_w_top, blaze_top),
               (cx + blaze_w_bot, blaze_bot),
               (cx - blaze_w_bot, blaze_bot)], fill=WOLF_WHITE)

    # Brow markings (darker patches over the eyes)
    brow_y    = px(0.43)
    brow_w    = px(0.10)
    brow_h    = px(0.04)
    for bx in (cx - px(0.13), cx + px(0.13)):
        d.ellipse([bx - brow_w//2, brow_y - brow_h//2,
                   bx + brow_w//2, brow_y + brow_h//2], fill=WOLF_DARK)

    # Snout — extends below the head into the bottom-teeth area
    snout_top   = px(0.60)
    snout_bot   = px(0.83)
    snout_w_top = px(0.10)
    snout_w_bot = px(0.07)
    d.polygon([(cx - snout_w_top, snout_top),
               (cx + snout_w_top, snout_top),
               (cx + snout_w_bot, snout_bot),
               (cx - snout_w_bot, snout_bot)], fill=WOLF_GREY)
    # White underside of snout
    d.polygon([(cx - snout_w_top + px(0.01), snout_top + px(0.01)),
               (cx + snout_w_top - px(0.01), snout_top + px(0.01)),
               (cx + snout_w_bot - px(0.005), snout_bot - px(0.005)),
               (cx - snout_w_bot + px(0.005), snout_bot - px(0.005))],
              fill=WOLF_WHITE)
    # Nose (black bulb at snout tip)
    nose_r = px(0.025)
    d.ellipse([cx - nose_r, snout_bot - nose_r * 2 - px(0.005),
               cx + nose_r, snout_bot - px(0.005)], fill=WOLF_NOSE)

    # Cheek tufts (white, jutting out to the sides — wolfy)
    for sign in (-1, +1):
        d.polygon([(cx + sign * px(0.20), px(0.62)),
                   (cx + sign * px(0.32), px(0.68)),
                   (cx + sign * px(0.20), px(0.72))],
                  fill=WOLF_WHITE)

    # Eyes — bright amber, slightly above the brow line
    eye_y = px(0.46)
    eye_r = max(2, px(0.022))
    for dx in (-px(0.10), +px(0.10)):
        # Outer glow
        d.ellipse([cx + dx - eye_r - px(0.008), eye_y - eye_r - px(0.008),
                   cx + dx + eye_r + px(0.008), eye_y + eye_r + px(0.008)],
                  fill=(246, 195, 101, 140))
        d.ellipse([cx + dx - eye_r, eye_y - eye_r,
                   cx + dx + eye_r, eye_y + eye_r], fill=EYE)
        d.ellipse([cx + dx - eye_r//2, eye_y - eye_r//2,
                   cx + dx + eye_r//2, eye_y + eye_r//2], fill=EYE_HOT)
        # Black pupil slit
        d.rectangle([cx + dx - px(0.004), eye_y - eye_r + px(0.004),
                     cx + dx + px(0.004), eye_y + eye_r - px(0.004)],
                    fill=WOLF_NOSE)

    return img


def main():
    # build/  → electron-builder buildResources (NOT shipped inside the asar).
    #          Used for the .exe/.app icon at packaging time.
    # assets/ → runtime files SHIPPED with the app. main.js loads tray.png
    #           from here so the tray icon is available after install.
    build_dir  = Path('apps/mimic/build')
    assets_dir = Path('apps/mimic/assets')
    build_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    master = render(MASTER)

    # buildResources (electron-builder)
    master.resize((512, 512), Image.LANCZOS).save(build_dir / 'icon.png', 'PNG')
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48),
                 (64, 64), (128, 128), (256, 256)]
    master.save(build_dir / 'icon.ico', sizes=ico_sizes)

    # runtime assets (shipped in asar)
    master.resize((16, 16), Image.LANCZOS).save(assets_dir / 'tray.png', 'PNG')
    master.resize((32, 32), Image.LANCZOS).save(assets_dir / 'tray@2x.png', 'PNG')
    # Also a 256 preview that we can use in the dashboard / about pages later.
    master.resize((256, 256), Image.LANCZOS).save(assets_dir / 'icon-256.png', 'PNG')

    print('wrote:')
    for p in ['build/icon.png', 'build/icon.ico',
              'assets/tray.png', 'assets/tray@2x.png', 'assets/icon-256.png']:
        fp = Path('apps/mimic') / p
        print(f'  {fp}  ({fp.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
