#!/usr/bin/env python3
"""
Generate the Mimic app icon — a treasure chest with fanged maw open,
wolf silhouette + glowing eyes inside. Theme: chest = mimic, wolf = Wolf Pack.

Outputs:
  apps/mimic/build/icon.png   (512x512 — Linux fallback, web preview)
  apps/mimic/build/icon.ico   (multi-res: 16/24/32/48/64/128/256 — Windows)
  apps/mimic/build/tray.png   (16x16 — tray icon loaded by main.js)
  apps/mimic/build/tray@2x.png(32x32 — high-DPI tray)

Render once at 1024 for sharp downsampling, then resize via LANCZOS to all
target sizes. Single source-of-truth for the icon.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

# Palette — gold chest, dark interior, white teeth, gray wolf, amber eyes.
GOLD        = (210, 152, 48,  255)
GOLD_LIGHT  = (236, 184, 78,  255)
GOLD_SHADOW = (152, 102, 28,  255)
BROWN       = (74,  44,  18,  255)
DARK        = (8,   8,   12,  255)
TOOTH       = (248, 241, 216, 255)
TOOTH_SHADE = (200, 195, 175, 255)
WOLF        = (40,  40,  46,  255)
WOLF_LIGHT  = (76,  76,  86,  255)
EYE         = (246, 195, 101, 255)
EYE_HOT     = (255, 240, 180, 255)

MASTER = 1024


def render(size=MASTER):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    s   = size

    def px(f): return int(s * f)

    # ── Chest body ─────────────────────────────────────────────────────────
    body_top   = px(0.46)
    body_bot   = px(0.94)
    body_left  = px(0.08)
    body_right = px(0.92)
    body_r     = px(0.05)
    stroke     = max(2, px(0.012))

    # Drop shadow under chest (subtle)
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([body_left, body_bot - px(0.03), body_right, body_bot + px(0.05)],
               fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(px(0.02)))
    img.alpha_composite(shadow)

    d.rounded_rectangle([body_left, body_top, body_right, body_bot],
                        radius=body_r, fill=GOLD,
                        outline=BROWN, width=stroke)

    # Horizontal iron band across body
    band_y   = px(0.78)
    band_h   = px(0.05)
    d.rectangle([body_left, band_y - band_h//2, body_right, band_y + band_h//2],
                fill=BROWN)
    # Rivets on the band
    for fx in (0.18, 0.40, 0.60, 0.82):
        cx = px(fx)
        rr = px(0.012)
        d.ellipse([cx - rr, band_y - rr, cx + rr, band_y + rr], fill=GOLD_LIGHT)

    # Lock on the band (mimic-style — central, ornate)
    lock_w = px(0.16)
    lock_h = px(0.16)
    lock_x = s // 2
    lock_y = band_y
    d.rounded_rectangle(
        [lock_x - lock_w//2, lock_y - lock_h//2,
         lock_x + lock_w//2, lock_y + lock_h//2],
        radius=px(0.015), fill=GOLD_SHADOW, outline=BROWN, width=stroke
    )
    # Lock keyhole
    kh_r = px(0.02)
    d.ellipse([lock_x - kh_r, lock_y - kh_r - px(0.01),
               lock_x + kh_r, lock_y + kh_r - px(0.01)], fill=DARK)
    d.polygon([(lock_x - kh_r//2, lock_y - px(0.005)),
               (lock_x + kh_r//2, lock_y - px(0.005)),
               (lock_x + kh_r, lock_y + px(0.04)),
               (lock_x - kh_r, lock_y + px(0.04))], fill=DARK)

    # ── Open lid (perspective trapezoid tilted back) ───────────────────────
    lid_top   = px(0.18)
    lid_left  = body_left + px(0.03)
    lid_right = body_right - px(0.03)
    lid_inset = px(0.08)  # how much the back edge narrows
    lid_polygon = [
        (lid_left, body_top + px(0.01)),
        (lid_right, body_top + px(0.01)),
        (lid_right - lid_inset, lid_top),
        (lid_left + lid_inset, lid_top),
    ]
    d.polygon(lid_polygon, fill=GOLD_LIGHT, outline=BROWN, width=stroke)

    # Lid rivets along bottom edge
    for fx in (0.16, 0.38, 0.62, 0.84):
        cx = px(fx)
        rr = px(0.012)
        d.ellipse([cx - rr, body_top - px(0.005),
                   cx + rr, body_top + 2*rr], fill=GOLD_SHADOW)

    # ── Dark mouth opening (where the maw is) ──────────────────────────────
    mouth_top    = body_top - px(0.005)
    mouth_bot    = px(0.66)
    mouth_left   = body_left + px(0.07)
    mouth_right  = body_right - px(0.07)
    d.rounded_rectangle([mouth_left, mouth_top, mouth_right, mouth_bot],
                        radius=px(0.015), fill=DARK)

    # ── Teeth — uneven jagged row on top edge (hanging from upper jaw) ─────
    tooth_n   = 7
    tooth_w   = (mouth_right - mouth_left) / tooth_n
    tooth_max = px(0.075)
    import random
    rng = random.Random(42)  # deterministic
    for i in range(tooth_n):
        x1 = int(mouth_left + i * tooth_w)
        x2 = int(mouth_left + (i + 1) * tooth_w)
        mid = (x1 + x2) // 2
        # Vary height for menacing irregularity
        h = int(tooth_max * (0.7 + rng.random() * 0.5))
        # Lean each tooth slightly inward
        lean = px(0.005) if i < tooth_n // 2 else -px(0.005)
        d.polygon([(x1, mouth_top), (x2, mouth_top),
                   (mid + lean, mouth_top + h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # Bottom-jaw teeth — fewer, smaller, pointing up
    for i in range(tooth_n - 2):
        x1 = int(mouth_left + (i + 0.5) * tooth_w)
        x2 = int(mouth_left + (i + 1.5) * tooth_w)
        mid = (x1 + x2) // 2
        h = int(tooth_max * 0.6 * (0.7 + rng.random() * 0.5))
        d.polygon([(x1, mouth_bot), (x2, mouth_bot),
                   (mid, mouth_bot - h)],
                  fill=TOOTH, outline=TOOTH_SHADE, width=max(1, stroke // 2))

    # ── Wolf silhouette inside the maw ─────────────────────────────────────
    cx = s // 2
    wolf_top  = mouth_top + px(0.055)
    wolf_bot  = mouth_bot - px(0.015)
    # Triangular ears + rounded head + snout
    ear_w   = px(0.05)
    ear_h   = px(0.07)
    head_w  = px(0.16)
    head_h  = px(0.10)
    snout_w = px(0.07)

    # Left + right ear triangles (poking above where head starts)
    d.polygon([(cx - head_w//2, wolf_top + px(0.005)),
               (cx - head_w//2 + ear_w, wolf_top + ear_h),
               (cx - head_w//2 - ear_w//2, wolf_top + ear_h)],
              fill=WOLF)
    d.polygon([(cx + head_w//2, wolf_top + px(0.005)),
               (cx + head_w//2 - ear_w, wolf_top + ear_h),
               (cx + head_w//2 + ear_w//2, wolf_top + ear_h)],
              fill=WOLF)

    # Head (rounded rectangle approximation)
    d.rounded_rectangle([cx - head_w//2, wolf_top + ear_h - px(0.005),
                         cx + head_w//2, wolf_top + ear_h + head_h],
                        radius=px(0.03), fill=WOLF)

    # Snout (small trapezoid below head)
    snout_top = wolf_top + ear_h + head_h - px(0.005)
    snout_bot = wolf_bot - px(0.005)
    d.polygon([(cx - snout_w//2, snout_top),
               (cx + snout_w//2, snout_top),
               (cx + snout_w//3, snout_bot),
               (cx - snout_w//3, snout_bot)], fill=WOLF)

    # Eyes (two glowing dots) — slightly into the head
    eye_y = wolf_top + ear_h + px(0.035)
    eye_r = max(2, px(0.018))
    for dx in (-px(0.045), +px(0.045)):
        # Outer glow
        d.ellipse([cx + dx - eye_r - px(0.006), eye_y - eye_r - px(0.006),
                   cx + dx + eye_r + px(0.006), eye_y + eye_r + px(0.006)],
                  fill=(246, 195, 101, 120))
        # Eye proper
        d.ellipse([cx + dx - eye_r, eye_y - eye_r,
                   cx + dx + eye_r, eye_y + eye_r],
                  fill=EYE)
        # Hot spot
        d.ellipse([cx + dx - eye_r//2, eye_y - eye_r//2,
                   cx + dx + eye_r//2, eye_y + eye_r//2],
                  fill=EYE_HOT)

    return img


def main():
    out = Path('apps/mimic/build')
    out.mkdir(parents=True, exist_ok=True)

    master = render(MASTER)

    # PNG outputs (transparent background).
    master.resize((512, 512), Image.LANCZOS).save(out / 'icon.png', 'PNG')
    master.resize((16,  16),  Image.LANCZOS).save(out / 'tray.png', 'PNG')
    master.resize((32,  32),  Image.LANCZOS).save(out / 'tray@2x.png', 'PNG')

    # Multi-resolution ICO for Windows. Pillow handles all sizes in one file.
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48),
                 (64, 64), (128, 128), (256, 256)]
    master.save(out / 'icon.ico', sizes=ico_sizes)

    print('wrote:')
    for p in ['icon.png', 'icon.ico', 'tray.png', 'tray@2x.png']:
        fp = out / p
        print(f'  {fp}  ({fp.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
