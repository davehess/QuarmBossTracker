"""Helpers that cut a guild's logo into Zeal tag pictures (icon + banner).

Zeal's rules for a tag picture (tag_arrows.cpp in the fork): PNG or true-colour TGA, at most 128 pixels a side,
at most 1 MB; anything wider than 2:1 is squeezed to 2:1. File names (nameplate.cpp GetTagImage):
  icon   ^I<CODE>^ -> <CODE>.png/.tga, or I<CODE>.png/.tga (needed for CON: Windows reserves CON.*)
  banner ^F<CODE>^ -> F<CODE>.png/.tga
Each guild's recipe lives in recipes.py; run `python3 -I recipes.py <out_dir> [CODE ...]`.
"""

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES = {}  # code -> (guild name, fn returning (icon, banner)); filled by the recipes*.py files.


def src(name):
    """A source logo in this folder."""
    return os.path.join(HERE, name)


def recipe(code, name):
    """Registers a guild's recipe: @recipe('SOW', 'Squirrels of War') on a fn returning (icon, banner)."""
    def wrap(fn):
        RECIPES[code] = (name, fn)
        return fn
    return wrap

MAX_SIDE = 128
MAX_ASPECT = 2.0
BANNER_SIZE = (128, 64)  # The widest picture Zeal draws unsqueezed.

FONTS = {
    'serif': '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
    'sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
}


def load(path, box=None):
    """Opens a source as RGBA, cropped to box (left, top, right, bottom) in source pixels."""
    im = Image.open(path).convert('RGBA')
    return im.crop(box) if box else im


def _rgb(im):
    return np.asarray(im.convert('RGB')).astype(np.int32)


def remove_edge_background(im, tol=40, bg=None, keep_largest=True, fill_holes=True, close=0):
    """Clears the background that touches the image edge.

    A pixel is background-like when it is within tol (max channel distance) of bg (default: the median edge colour).
    Only background-like regions connected to the border are cleared, so dark areas inside the logo stay. close (px)
    seals small gaps in the logo's outline first; keep_largest drops stray specks (stars, sparks)."""
    a = _rgb(im)
    if bg is None:
        edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        bg = np.median(edge, axis=0)
    bglike = np.max(np.abs(a - np.array(bg)), axis=2) <= tol
    fg_seed = ~bglike
    if close:
        fg_seed = ndimage.binary_closing(fg_seed, iterations=close)
    labels, _ = ndimage.label(~fg_seed)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    background = np.isin(labels, list(border))
    return apply_mask(im, ~background, keep_largest=keep_largest, fill_holes=fill_holes)


def apply_mask(im, mask, keep_largest=False, fill_holes=False, feather=1.0):
    """Sets alpha from a boolean mask (combined with any existing alpha)."""
    mask = np.asarray(mask, bool)
    if keep_largest:
        labels, n = ndimage.label(mask)
        if n > 1:
            sizes = ndimage.sum(mask, labels, range(1, n + 1))
            mask = labels == (1 + int(np.argmax(sizes)))
    if fill_holes:
        mask = ndimage.binary_fill_holes(mask)
    alpha = Image.fromarray((mask * 255).astype(np.uint8))
    if feather:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))
    old = np.asarray(im.getchannel('A')).astype(np.float32) / 255
    new = (np.asarray(alpha).astype(np.float32) * old).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(new))
    return out


def ellipse_mask(size, box):
    """Boolean mask of an ellipse inside box (l, t, r, b), for round logos."""
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).ellipse(box, fill=255)
    return np.asarray(m) > 0


def polygon_mask(size, points):
    """Boolean mask of a polygon [(x, y), ...], for shields traced by hand."""
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return np.asarray(m) > 0


def color_mask(im, fn):
    """Boolean mask from fn(r, g, b) on int arrays, for lettering keyed by colour."""
    a = _rgb(im)
    return fn(a[..., 0], a[..., 1], a[..., 2])


def trim(im, pad=0):
    """Crops to the visible pixels plus pad."""
    box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        return im
    l, t, r, b = box
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def fit(im, max_side=MAX_SIDE, max_aspect=MAX_ASPECT):
    """Trims, pads to at most max_aspect wide (never squeezed in game), and scales so the long side is max_side."""
    im = trim(im)
    w, h = im.size
    if w > h * max_aspect:  # Too wide: pad the height with transparency.
        nh = int(np.ceil(w / max_aspect))
        canvas = Image.new('RGBA', (w, nh), (0, 0, 0, 0))
        canvas.paste(im, (0, (nh - h) // 2))
        im, (w, h) = canvas, (w, nh)
    scale = max_side / max(w, h)
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def banner(emblem, name, color=(240, 210, 120), font='serif', outline=(0, 0, 0)):
    """A 128x64 banner: the emblem on the left, the guild's name on the right (one or two lines)."""
    W, H = BANNER_SIZE
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    em = fit(emblem, max_side=H)
    out.alpha_composite(em, ((H - em.width) // 2 if em.width < H else 0, (H - em.height) // 2))
    text_x, text_w = H + 2, W - H - 4
    words = name.split()
    best = None
    for split in range(1, len(words) + 1):  # Try one line, then two.
        lines = [' '.join(words[:split]), ' '.join(words[split:])] if split < len(words) else [name]
        for size in range(22, 7, -1):
            f = ImageFont.truetype(FONTS[font], size)
            widths = [f.getbbox(line)[2] for line in lines]
            if max(widths) <= text_w and len(lines) * size * 1.15 <= H:
                if not best or size > best[0]:
                    best = (size, lines, f)
                break
    size, lines, f = best
    d = ImageDraw.Draw(out)
    total = len(lines) * size * 1.15
    y = (H - total) / 2
    for line in lines:
        lw = f.getbbox(line)[2]
        d.text((text_x + (text_w - lw) / 2, y), line, font=f, fill=color + (255,), stroke_width=2,
               stroke_fill=outline + (255,))
        y += size * 1.15
    return out


def wordmark_banner(im):
    """A banner from a logo that already carries the name: fitted into 128x64, centred."""
    W, H = BANNER_SIZE
    im = trim(im)
    scale = min(W / im.width, H / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(im, ((W - im.width) // 2, (H - im.height) // 2))
    return out


def save(im, out_dir, stem):
    """Writes <stem>.png and <stem>.tga (uncompressed 32-bit) and checks Zeal's limits."""
    assert im.width <= MAX_SIDE and im.height <= MAX_SIDE, (stem, im.size)
    assert im.width <= im.height * MAX_ASPECT + 1, (stem, im.size)
    im.save(f'{out_dir}/{stem}.png', optimize=True)
    im.save(f'{out_dir}/{stem}.tga', compression=None)
    return im


def preview(images, path, bg=(46, 52, 60), scale=2):
    """A contact sheet of (label, image) pairs on a game-ish background, for review."""
    cell_w, cell_h = 128 * scale + 20, 128 * scale + 40
    cols = 4
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), bg + (255,))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(FONTS['sans'], 14)
    for i, (label, im) in enumerate(images):
        x, y = (i % cols) * cell_w + 10, (i // cols) * cell_h + 10
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        sheet.alpha_composite(big, (x, y))
        d.text((x, y + 128 * scale + 6), f'{label} {im.width}x{im.height}', font=f, fill=(230, 230, 230, 255))
    sheet.convert('RGB').save(path)
