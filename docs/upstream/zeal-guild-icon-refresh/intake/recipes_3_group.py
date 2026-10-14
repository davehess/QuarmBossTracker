"""Recipes: Loot & Some Fun, Former Glory, Zek, Axiom, Eclipse."""

import numpy as np
from PIL import Image
from scipy import ndimage

import cutlib as c
from cutlib import recipe, src


def _keep_big(mask, min_size):
    """Drops connected specks smaller than min_size pixels from a boolean mask."""
    lab, n = ndimage.label(mask)
    if not n:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= min_size])


def _outlined(im, letters, dark, grow=4):
    """Cuts keyed lettering out with a thin dark rim (so it reads on any background): the rim is painted dark."""
    halo = ndimage.binary_dilation(letters, iterations=grow)
    a = np.asarray(im).copy()
    a[halo & ~letters, :3] = dark
    return c.apply_mask(Image.fromarray(a), halo, feather=0.8)


@recipe('LSF', 'Loot & Some Fun')
def lsf():
    # Icon: the shield on a dark panel (olive outside it). Everything near the panel's dark is background; the
    # components touching the image edge (the olive) go, the shield and both sword blades stay.
    im = c.load(src('11-lsf-shield.png'))
    a = np.asarray(im.convert('RGB')).astype(int)
    fg = np.max(np.abs(a - np.array((32, 31, 36))), axis=2) > 16
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg)
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    keep = [i + 1 for i, s in enumerate(sizes) if s > 60 and (i + 1) not in edge]
    icon = c.fit(c.apply_mask(im, np.isin(lab, keep), fill_holes=True))
    # Banner: gold fill + red-brown rim of the wordmark keyed from the dark purple scene; the orc under it is cropped.
    wm = c.load(src('12-loot-and-some-fun.png'), (0, 0, 1080, 280))
    m = c.color_mask(wm, lambda r, g, b: ((r > 105) & (r > b + 55) & (r > g + 25)) |
                     ((r > 190) & (g > 150) & (b < 235) & (r > b + 25)))
    m = _keep_big(ndimage.binary_opening(m, iterations=1), 400)
    return icon, c.wordmark_banner(c.apply_mask(wm, m, feather=0.8))


@recipe('FG', 'Former Glory')
def fg():
    # Icon: the crest (crown, shield, scrollwork) without the name. Gold keyed in the crest's box, the pole and
    # flowers at the top corners excluded by hand, and the black shield face added back with a traced polygon
    # (its gold rim is open, so a fill would not close it).
    im = c.load(src('13-former-glory.png'), (190, 15, 860, 595))
    H, W = im.height, im.width
    yy, xx = np.mgrid[:H, :W]
    gold = c.color_mask(im, lambda r, g, b: (r > 140) & (g > 90) & (r > b + 70) & (r > g))
    gold = ndimage.binary_opening(gold, iterations=1)
    gold &= ~((xx > 540) & (yy < 270)) & ~((xx < 120) & (yy < 270))
    m = ndimage.binary_closing(gold, iterations=4)
    m |= c.polygon_mask((W, H), [(335, 138), (430, 155), (488, 150), (526, 182), (521, 260), (497, 360),
                                 (428, 490), (337, 566), (242, 490), (172, 370), (150, 270), (150, 187),
                                 (182, 150), (240, 155)])
    m = ndimage.binary_fill_holes(_keep_big(m, 1500))
    icon = c.fit(c.apply_mask(im, m, feather=1.0))
    # Banner: the cream-gold lettering and its flourish line, keyed by colour with a dark rim; the crest's tip and
    # a patch of armour that poke into the crop are blanked.
    wm = c.load(src('13-former-glory.png'), (60, 555, 1025, 805))
    yy, xx = np.mgrid[:wm.height, :wm.width]
    m = c.color_mask(wm, lambda r, g, b: (r > 150) & (g > 110) & (r > b + 15) & (r > g))
    m = ndimage.binary_opening(m, iterations=1)
    m &= ~((xx > 420) & (xx < 505) & (yy < 42)) & ~((xx > 835) & (yy < 55))
    m = ndimage.binary_closing(_keep_big(m, 300), iterations=2)
    return icon, c.wordmark_banner(_outlined(wm, m, (10, 8, 6), grow=5))


@recipe('ZEK', 'Zek')
def zek():
    # Icon: the ring and Z, keyed white + red inside an ellipse around the ring, on a dark disc so the white
    # still reads on a light background.
    im = c.load(src('14-zek.png'), (280, 15, 840, 560))

    def white_or_red(r, g, b):
        lo, hi = np.minimum(np.minimum(r, g), b), np.maximum(np.maximum(r, g), b)
        return ((lo > 190) & (hi - lo < 40)) | ((r > 190) & (g < 120) & (b < 90))

    m = c.color_mask(im, white_or_red) & c.ellipse_mask(im.size, (4, 10, 552, 533))
    m = ndimage.binary_opening(m, iterations=1)
    lab, n = ndimage.label(ndimage.binary_closing(m, iterations=3))
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    m &= np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 800])
    disc = c.ellipse_mask(im.size, (30, 22, 525, 520))
    a = np.asarray(im).copy()
    a[disc & ~m, :3] = (14, 14, 20)
    icon = c.fit(c.apply_mask(Image.fromarray(a), disc | m, feather=0.8))
    # Banner: the ZEK lettering, white keyed from the scene, with a dark rim.
    wm = c.load(src('14-zek.png'), (70, 570, 1040, 802))
    m = c.color_mask(wm, lambda r, g, b: (np.minimum(np.minimum(r, g), b) > 170) &
                     (np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b) < 55))
    m = ndimage.binary_opening(m, iterations=1)
    lab, n = ndimage.label(ndimage.binary_closing(m, iterations=3))
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    m &= np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 3000])
    m = ndimage.binary_closing(m, iterations=1)
    return icon, c.wordmark_banner(_outlined(wm, m, (10, 8, 12), grow=4))


@recipe('AX', 'Axiom')
def ax():
    # Gold letters + the blue crystal keyed by colour; the tagline (below the letters) and the golden glow on the
    # right (past the M) are excluded by hand. Icon is the crystal O (the one letter that carries the guild's gem).
    im = c.load(src('15-axiom.png'))
    H, W = im.height, im.width
    yy, xx = np.mgrid[:H, :W]
    gold = c.color_mask(im, lambda r, g, b: (r > 110) & (g > 70) & (r > b + 45) & (r >= g))
    blue = c.color_mask(im, lambda r, g, b: (b > 150) & (b > r + 20) & (g > 110))
    m = (gold | blue) & ~((xx > 130) & (xx < 900) & (yy > 283))
    m &= ~(xx > 942 + np.clip(yy - 200, 0, None) * 0.42) & ~((xx > 850) & (yy < 62))
    m = ndimage.binary_closing(ndimage.binary_opening(m, iterations=1), iterations=2)
    m = ndimage.binary_fill_holes(_keep_big(m, 2500))
    word = c.apply_mask(im, m, feather=0.8)
    box = (548, 56, 742, 256)
    o = c.apply_mask(word, c.ellipse_mask(im.size, box), feather=0.8).crop(box)
    return c.fit(o), c.wordmark_banner(word)


@recipe('ECL', 'Eclipse')
def ecl():
    # Icon: the dark disc (a circle fitted by eye) with the fiery corona kept as brightness-keyed soft alpha, faded
    # out radially and below the disc's middle (the lettering sits over the lower disc, so that part is repainted
    # to the disc's own dark).
    box = (150, 20, 750, 400)
    im = c.load(src('16-eclipse.png'), box)
    H, W = im.height, im.width
    yy, xx = np.mgrid[:H, :W]
    cx, cy, R = 448 - box[0], 230 - box[1], 148
    r = np.hypot(xx - cx, yy - cy)
    a = np.asarray(im.convert('RGB')).astype(np.float32)

    def ss(x, lo, hi):
        t = np.clip((x - lo) / (hi - lo), 0, 1)
        return t * t * (3 - 2 * t)

    disc = np.clip((R - r) / 1.5 + 0.5, 0, 1)
    corona = ss(a.max(axis=2), 40, 150) * (1 - ss(r, R + 40, R + 80)) * (1 - ss(yy + box[1], 255, 305)) * (r >= R - 1)
    w = ss(yy + box[1], 268, 296)[..., None]
    rgb = a * (1 - w) + np.array((12, 8, 20), np.float32) * w
    icon = Image.fromarray(rgb.astype(np.uint8)).convert('RGBA')
    icon.putalpha(Image.fromarray((np.maximum(disc, corona) * 255).astype(np.uint8)))
    icon = c.fit(icon)
    # Banner: the copper ECLIPSE lettering (cream + orange fill) keyed by colour, with its own rust rim kept via a
    # 5px grow. The corona's bright rim that shows through the C is blanked by hand.
    wm = c.load(src('16-eclipse.png'), (215, 300, 675, 455))
    yy, xx = np.mgrid[:wm.height, :wm.width]
    m = c.color_mask(wm, lambda r, g, b: ((r > 205) & (g > 90) & (b > 50) & (r > b + 15)) |
                     ((r > 225) & (g > 200) & (b > 140)))
    m = ndimage.binary_opening(m, iterations=1)
    m &= ~((xx > 80) & (xx < 132) & (yy < 13))
    m = ndimage.binary_closing(_keep_big(m, 250), iterations=2)
    halo = ndimage.binary_dilation(m, iterations=5)
    return icon, c.wordmark_banner(c.apply_mask(wm, halo, feather=0.7))
