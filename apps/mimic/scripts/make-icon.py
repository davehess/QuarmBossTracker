#!/usr/bin/env python3
"""
Derive all Mimic icon variants from apps/mimic/build/icon.png.

The master icon is now a real illustration (mimic chest with wolf ears),
dropped directly into build/icon.png. This script ONLY resizes/repacks
that PNG into the formats electron-builder + the runtime need:

  build/icon.ico       multi-res Windows icon (16/24/32/48/64/128/256)
  build/tray.png       16×16 tray
  build/tray@2x.png    32×32 tray (hi-DPI)
  assets/tray.png      same 16×16, shipped at runtime
  assets/tray@2x.png   same 32×32, shipped at runtime
  assets/icon-256.png  256×256, used by dashboard / about pages

If the master is not square, it gets centered on a transparent canvas
sized to the larger dimension so nothing gets cropped.

Replace build/icon.png with a new master and re-run to refresh.
"""
from PIL import Image
from pathlib import Path

ROOT      = Path(__file__).resolve().parents[1]  # apps/mimic/
MASTER    = ROOT / 'build' / 'icon.png'
BUILD     = ROOT / 'build'
ASSETS    = ROOT / 'assets'


def squared(img: Image.Image) -> Image.Image:
    """Center on a transparent square canvas at max(w, h)."""
    w, h = img.size
    if w == h:
        return img
    side = max(w, h)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - w) // 2, (side - h) // 2), img if img.mode == 'RGBA' else None)
    return out


def main():
    if not MASTER.exists():
        raise SystemExit(f'master icon missing: {MASTER}')
    src = Image.open(MASTER).convert('RGBA')
    sq  = squared(src)

    # Persist the squared master back to build/icon.png so electron-builder
    # has a clean square input. If the source was already square this is a
    # no-op write.
    sq.save(MASTER, 'PNG')

    # Multi-res ICO — Windows installer picks the right size per context.
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48),
                 (64, 64), (128, 128), (256, 256)]
    sq.save(BUILD / 'icon.ico', sizes=ico_sizes)

    # Tray (16, 32) in both build/ and assets/. main.js reads from assets/
    # at runtime; build/ copies exist for parity / dev tooling.
    tray   = sq.resize((16, 16), Image.LANCZOS)
    tray2x = sq.resize((32, 32), Image.LANCZOS)
    tray.save(BUILD / 'tray.png', 'PNG')
    tray2x.save(BUILD / 'tray@2x.png', 'PNG')
    tray.save(ASSETS / 'tray.png', 'PNG')
    tray2x.save(ASSETS / 'tray@2x.png', 'PNG')

    # 256×256 preview for the dashboard / about screens.
    sq.resize((256, 256), Image.LANCZOS).save(ASSETS / 'icon-256.png', 'PNG')

    print('wrote:')
    for p in [BUILD / 'icon.png', BUILD / 'icon.ico',
              BUILD / 'tray.png', BUILD / 'tray@2x.png',
              ASSETS / 'tray.png', ASSETS / 'tray@2x.png', ASSETS / 'icon-256.png']:
        print(f'  {p.relative_to(ROOT.parent.parent)}  ({p.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
