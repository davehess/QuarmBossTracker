#!/usr/bin/env python3
"""
Generate the Mimic app icon — a treasure-chest mimic monster with wolf
ears poking up from the lid. Chest is the hero of the composition (so
"Mimic" reads instantly even at 16×16); the wolf ears are the brand
signal pointing back to Wolf Pack. No wolf head inside the chest, no
side rails crowding the silhouette.

Composition (top → bottom):
  1. Two pointed wolf ears at the top — grey outer, white inner.
  2. Domed wooden chest lid in front, gold trim along its lower edge.
  3. Open maw with a row of fangs on the lid's underside + a row on the
     base, a pink tongue lolling between them, two amber eyes glowing
     in the darkness above the tongue.
  4. Chest base with side iron straps + central lock plate.

Outputs:
  apps/mimic/build/icon.png    (512x512)
  apps/mimic/build/icon.ico    (multi-res: 16/24/32/48/64/128/256)
  apps/mimic/build/tray.png    (16x16)
  apps/mimic/build/tray@2x.png (32x32)
  apps/mimic/assets/tray.png   (16x16, shipped at runtime)
  apps/mimic/assets/tray@2x.png(32x32, shipped at runtime)
  apps/mimic/assets/icon-256.png (256x256, dashboard preview)
"""
from PIL import Image, ImageDraw
from pathlib import Path

# Palette
WOOD          = (96,  56,  24,  255)
WOOD_LIGHT    = (140, 84,  36,  255)
WOOD_SHADOW   = (60,  34,  14,  255)
GOLD          = (216, 162, 60,  255)
GOLD_LIGHT    = (240, 196, 96,  255)
GOLD_SHADOW   = (152, 102, 28,  255)
IRON          = (54,  54,  62,  255)
IRON_LIGHT    = (98,  98,  108, 255)
DARK          = (10,  8,   12,  255)
MAW           = (16,  10,  18,  255)
TOOTH         = (252, 246, 224, 255)
TOOTH_SHADE   = (200, 195, 175, 255)
TONGUE        = (200, 80,  104, 255)
TONGUE_SHADE  = (148, 50,  74,  255)
WOLF_GREY     = (132, 136, 144, 255)
WOLF_DARK     = (78,  82,  92,  255)
WOLF_WHITE    = (242, 242, 246, 255)
EYE           = (250, 198, 92,  255)
EYE_HOT       = (255, 240, 180, 255)

MASTER = 1024


def render(size=MASTER):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    s   = size

    def px(f):
        return int(s * f)

    stroke = max(2, px(0.010))

    # ── Wolf ears (drawn first so the lid sits over their bases) ───────────
    # Ear tips poke above the lid; bases get hidden by the chest body.
    ear_tip_y      = px(0.05)
    ear_outer_base = px(0.08)   # bases vertical position (will be hidden by lid)
    ear_w          = px(0.18)
    for sign in (-1, +1):
        cx_ear = s // 2 + sign * px(0.28)
        # Outer ear (grey)
        d.polygon([
            (cx_ear - ear_w//2, px(0.30)),
            (cx_ear + ear_w//2, px(0.28)),
            (cx_ear + ear_w//4, ear_tip_y),
        ], fill=WOLF_DARK)
        # Inner ear (white)
        d.polygon([
            (cx_ear - ear_w//5, px(0.27)),
            (cx_ear + ear_w//3, px(0.25)),
            (cx_ear + ear_w//6, ear_tip_y + px(0.05)),
        ], fill=WOLF_WHITE)
        # Outer rim shading on outer edge
        d.polygon([
            (cx_ear - ear_w//2, px(0.30)),
            (cx_ear - ear_w//3, px(0.28)),
            (cx_ear + ear_w//4, ear_tip_y),
        ], fill=WOLF_GREY)

    # ── Chest base (square, occupies bottom 60%) ───────────────────────────
    base_top    = px(0.42)
    base_bot    = px(0.92)
    base_left   = px(0.10)
    base_right  = px(0.90)
    d.rounded_rectangle([base_left, base_top, base_right, base_bot],
                        radius=px(0.04), fill=WOOD, outline=WOOD_SHADOW,
                        width=stroke)
    # Wood plank lines on the base
    plank_x = (base_left + base_right) // 2
    d.line([(plank_x, base_top + px(0.03)), (plank_x, base_bot - px(0.03))],
           fill=WOOD_SHADOW, width=max(1, stroke // 2))

    # ── Iron side straps on the base ───────────────────────────────────────
    strap_w = px(0.04)
    for sx in (base_left + px(0.04), base_right - px(0.04) - strap_w):
        d.rectangle([sx, base_top + px(0.01), sx + strap_w, base_bot - px(0.01)],
                    fill=IRON, outline=DARK, width=max(1, stroke // 2))
        # Rivets on each strap
        cx = sx + strap_w // 2
        rr = px(0.010)
        for fy in (0.48, 0.60, 0.74, 0.86):
            d.ellipse([cx - rr, px(fy) - rr, cx + rr, px(fy) + rr], fill=IRON_LIGHT)

    # ── Central lock plate on the base front ───────────────────────────────
    lock_top    = px(0.62)
    lock_bot    = px(0.78)
    lock_left   = px(0.42)
    lock_right  = px(0.58)
    d.rounded_rectangle([lock_left, lock_top, lock_right, lock_bot],
                        radius=px(0.012), fill=GOLD, outline=GOLD_SHADOW,
                        width=stroke)
    # Keyhole
    cx = s // 2
    kh_y = (lock_top + lock_bot) // 2
    kh_r = px(0.014)
    d.ellipse([cx - kh_r, kh_y - kh_r - px(0.006), cx + kh_r, kh_y + kh_r - px(0.006)],
              fill=DARK)
    d.rectangle([cx - px(0.005), kh_y - px(0.004), cx + px(0.005), kh_y + px(0.020)],
                fill=DARK)

    # ── Lid (domed, open and tilted back — hero of the silhouette) ─────────
    # The lid forms an arch above the base, with the maw beneath it. Draw
    # the maw cavity FIRST so the lid + teeth sit over the dark background.
    maw_top     = px(0.32)
    maw_bot     = base_top + px(0.04)  # overlap into base for a clean seam
    maw_left    = base_left + px(0.06)
    maw_right   = base_right - px(0.06)
    d.rounded_rectangle([maw_left, maw_top, maw_right, maw_bot],
                        radius=px(0.03), fill=MAW)

    # Lid arch (sits on top, leaves the maw exposed below)
    lid_top     = px(0.22)
    lid_bot     = px(0.40)
    lid_left    = base_left - px(0.01)
    lid_right   = base_right + px(0.01)
    d.rounded_rectangle([lid_left, lid_top, lid_right, lid_bot],
                        radius=px(0.06), fill=WOOD_LIGHT,
                        outline=WOOD_SHADOW, width=stroke)
    # Lid dome highlight (lighter strip)
    d.rounded_rectangle([lid_left + px(0.04), lid_top + px(0.015),
                         lid_right - px(0.04), lid_top + px(0.05)],
                        radius=px(0.02), fill=(160, 100, 48, 255))
    # Gold trim along the lid's bottom edge
    d.rectangle([lid_left, lid_bot - px(0.025), lid_right, lid_bot],
                fill=GOLD)
    # Gold side caps on the lid
    cap_w = px(0.04)
    d.rectangle([lid_left, lid_top + px(0.02), lid_left + cap_w, lid_bot],
                fill=GOLD_SHADOW)
    d.rectangle([lid_right - cap_w, lid_top + px(0.02), lid_right, lid_bot],
                fill=GOLD_SHADOW)

    # ── Top row of fangs (under the lid, pointing down into the maw) ───────
    tooth_n   = 9
    tooth_w   = (maw_right - maw_left) / tooth_n
    tooth_max = px(0.10)
    for i in range(tooth_n):
        x1 = int(maw_left + i * tooth_w)
        x2 = int(maw_left + (i + 1) * tooth_w)
        mid = (x1 + x2) // 2
        edge_falloff = 1 - abs((i - tooth_n / 2) / (tooth_n / 2)) * 0.35
        h = int(tooth_max * (0.7 + (i % 3) * 0.1) * edge_falloff)
        d.polygon([(x1, maw_top), (x2, maw_top), (mid, maw_top + h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # ── Tongue (pink, lolling out over the base front lip) ─────────────────
    tongue_top   = maw_bot - px(0.06)
    tongue_bot   = base_top + px(0.18)
    tongue_left  = cx - px(0.16)
    tongue_right = cx + px(0.16)
    d.rounded_rectangle([tongue_left, tongue_top, tongue_right, tongue_bot],
                        radius=px(0.06), fill=TONGUE)
    # Central crease
    d.line([(cx, tongue_top + px(0.01)), (cx, tongue_bot - px(0.02))],
           fill=TONGUE_SHADE, width=max(1, stroke // 2))

    # ── Bottom row of fangs (rising from the base, in front of the tongue) ─
    bot_tooth_n   = 7
    bot_tooth_w   = (maw_right - maw_left - px(0.04)) / bot_tooth_n
    bot_tooth_max = px(0.07)
    bot_y         = base_top + px(0.04)
    for i in range(bot_tooth_n):
        x1 = int(maw_left + px(0.02) + i * bot_tooth_w)
        x2 = int(maw_left + px(0.02) + (i + 1) * bot_tooth_w)
        mid = (x1 + x2) // 2
        edge_falloff = 1 - abs((i - bot_tooth_n / 2) / (bot_tooth_n / 2)) * 0.40
        h = int(bot_tooth_max * (0.75 + (i % 2) * 0.15) * edge_falloff)
        d.polygon([(x1, bot_y), (x2, bot_y), (mid, bot_y - h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # ── Glowing eyes deep in the maw ───────────────────────────────────────
    eye_y = maw_top + px(0.07)
    eye_r = max(2, px(0.022))
    for dx in (-px(0.10), +px(0.10)):
        # Soft outer glow
        d.ellipse([cx + dx - eye_r - px(0.010), eye_y - eye_r - px(0.010),
                   cx + dx + eye_r + px(0.010), eye_y + eye_r + px(0.010)],
                  fill=(250, 198, 92, 110))
        d.ellipse([cx + dx - eye_r, eye_y - eye_r,
                   cx + dx + eye_r, eye_y + eye_r], fill=EYE)
        d.ellipse([cx + dx - eye_r//2, eye_y - eye_r//2,
                   cx + dx + eye_r//2, eye_y + eye_r//2], fill=EYE_HOT)
        # Vertical slit pupil
        d.rectangle([cx + dx - px(0.004), eye_y - eye_r + px(0.005),
                     cx + dx + px(0.004), eye_y + eye_r - px(0.005)],
                    fill=DARK)

    return img


def main():
    # build/  → electron-builder buildResources (NOT shipped inside the asar).
    #          Used for the .exe icon at packaging time.
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
    # Tray copies in build/ for completeness (not strictly required).
    master.resize((16, 16), Image.LANCZOS).save(build_dir / 'tray.png', 'PNG')
    master.resize((32, 32), Image.LANCZOS).save(build_dir / 'tray@2x.png', 'PNG')

    # runtime assets (shipped in asar)
    master.resize((16, 16), Image.LANCZOS).save(assets_dir / 'tray.png', 'PNG')
    master.resize((32, 32), Image.LANCZOS).save(assets_dir / 'tray@2x.png', 'PNG')
    master.resize((256, 256), Image.LANCZOS).save(assets_dir / 'icon-256.png', 'PNG')

    print('wrote:')
    for p in ['build/icon.png', 'build/icon.ico',
              'build/tray.png', 'build/tray@2x.png',
              'assets/tray.png', 'assets/tray@2x.png', 'assets/icon-256.png']:
        fp = Path('apps/mimic') / p
        print(f'  {fp}  ({fp.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
