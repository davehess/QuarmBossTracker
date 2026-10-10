"""Recipes: Mass Group Ego, Seekers of Souls, Tranquility, The Breakfast Club."""

import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

import cutlib as c
from cutlib import recipe, src


def _glow_alpha(im, lo, hi):
    """Alpha ramp from the brightest channel, so a glow over a dark scene fades out instead of ending in a dark halo."""
    a = np.asarray(im.convert('RGB')).astype(np.float32).max(axis=2)
    return np.clip((a - lo) / (hi - lo), 0, 1)


@recipe('MGE', 'Mass Group Ego')
def mge():
    im = c.load(src('07-mass-group-ego.png'))
    w, h = im.size
    # The dark shield sits inside a violet ring; a disc a little wider than the ring (and long enough to take the
    # shield's tip) is the sticker. The flames above the ring are keyed by brightness so they fade out cleanly.
    disc = c.ellipse_mask(im.size, (296, 206, 816, 726))
    flame_zone = c.polygon_mask(im.size, [(250, 40), (870, 40), (870, 330), (556, 466), (250, 330)])
    flame = _glow_alpha(im, 70, 190) * flame_zone
    a = np.maximum(disc.astype(np.float32), flame)
    out = im.copy()
    out.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    icon = c.fit(c.apply_mask(out, np.ones((h, w), bool), feather=0))
    # The lettering is near-white with a violet glow: key it by its green channel, which the glow lacks.
    word = c.load(src('07-mass-group-ego.png'), (60, 730, 1050, 990))
    g = np.asarray(word.convert('RGB'))[..., 1].astype(np.float32)
    word.putalpha(Image.fromarray((np.clip((g - 120) / 90, 0, 1) * 255).astype(np.uint8)))
    # A violet outline (the glow, made solid) keeps the white letters readable over a light chat window.
    edge = ndimage.binary_dilation(np.asarray(word.getchannel('A')) > 60, iterations=6)
    halo = Image.new('RGBA', word.size, (70, 30, 150, 255))
    halo.putalpha(Image.fromarray((ndimage.gaussian_filter(edge.astype(np.float32), 1.5) * 255).astype(np.uint8)))
    halo.alpha_composite(word)
    return icon, c.wordmark_banner(halo)


@recipe('SOS', 'Seekers of Souls')
def sos():
    im = c.load(src('08-green-s-banners.png'))
    # The eye over the glowing rune circle: the one motif in the art that reads as a mark. The two S banners are
    # tall and thin, and the eye alone is too plain.
    circle = c.ellipse_mask(im.size, (250, 238, 860, 850))
    eye = c.ellipse_mask(im.size, (484, 88, 628, 252))
    beam = c.polygon_mask(im.size, [(544, 240), (566, 240), (566, 260), (544, 260)])
    icon = c.fit(c.apply_mask(im, circle | eye | beam, feather=1.0))
    return icon, c.banner(icon, 'Seekers of Souls', color=(240, 200, 70), font='serif', outline=(10, 40, 0))


@recipe('TRQ', 'Tranquility')
def trq():
    im = c.load(src('09-tree-four-elements.png'))
    # The round four-element picture sits inside a rounded square and Discord's page; the circle is the logo.
    icon = c.fit(c.apply_mask(im, c.ellipse_mask(im.size, (34, 24, 236, 226)), feather=0.6))
    return icon, c.banner(icon, 'Tranquility', color=(190, 225, 255), font='serif', outline=(5, 15, 30))


@recipe('BC', 'The Breakfast Club')
def bc():
    im = c.load(src('10-breakfast-club.png'), (6, 6, 954, 1034))
    ox = oy = 6
    # The script tagline touches the shield's tip; whiten it, clear the white, then repaint the tip by hand.
    a = np.asarray(im).copy()
    a[898 - oy:, :, :3] = 255
    im = Image.fromarray(a)
    shield = c.remove_edge_background(im, tol=28, close=1)
    d = ImageDraw.Draw(shield)
    tip = [(427 - ox, 893 - oy), (547 - ox, 893 - oy), (487 - ox, 926 - oy)]
    d.polygon(tip, fill=(139, 94, 60, 255))
    d.line([(427 - ox, 893 - oy), (487 - ox, 926 - oy), (547 - ox, 893 - oy)], fill=(20, 12, 8, 255), width=11,
           joint='curve')
    icon = c.fit(shield)
    # Banner: the ribbon and the shield's tip below it (cut along the ribbon's top edge) keeps the name readable.
    below = [(112, 700), (280, 681), (480, 673), (600, 676), (740, 677), (800, 689), (866, 703), (935, 750),
             (950, 790), (950, 940), (20, 940), (20, 790), (40, 750)]
    below = [(x - ox, y - oy) for x, y in below]
    ribbon = c.apply_mask(shield, c.polygon_mask(shield.size, below), feather=0.6)
    return icon, c.wordmark_banner(ribbon)
