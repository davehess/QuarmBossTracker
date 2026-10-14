"""Recipes: Alianza, Novae, Continuum, Haven, Intervention."""

import numpy as np
from scipy import ndimage

import cutlib as c
from cutlib import recipe, src


@recipe('ALZ', 'Alianza')
def alz():
    # Discord screenshot: the shield is the only red/yellow thing. Key red+yellow, close over the cream lettering and
    # the black riders, fill holes, keep the one big blob.
    im = c.load(src('01-alianza.png'), (55, 25, 255, 235))
    red_yel = c.color_mask(im, lambda r, g, b: (r > 150) & (b < 90) & (g < 215))
    red_yel = ndimage.binary_closing(red_yel, iterations=6)
    icon = c.fit(c.apply_mask(im, red_yel, keep_largest=True, fill_holes=True, feather=0.8))
    return icon, c.banner(icon, 'Alianza', color=(255, 196, 0), font='serif')




@recipe('NOV', 'Novae')
def nov():
    # Icon: the dark elf, head and shoulders, hand-traced out of the framed art.
    full = c.load(src('03-novae.png'))
    bust = c.polygon_mask(full.size, [
        (440, 195), (456, 195), (482, 200), (492, 220), (499, 240), (507, 265), (512, 290), (520, 315), (523, 340),
        (527, 349), (550, 359), (565, 377), (565, 395), (560, 420), (560, 445), (548, 455), (450, 458), (350, 455),
        (333, 445), (331, 420), (330, 395), (327, 370), (322, 346), (332, 335), (350, 327), (360, 319), (382, 314),
        (397, 331), (416, 330), (410, 315), (405, 295), (404, 265), (405, 240), (410, 222), (417, 207), (430, 197)])
    # Shave the fringe the hand-trace leaves: orange scene behind the shoulders, sky-blue behind the hair top.
    orange = c.color_mask(full, lambda r, g, b: (r > g + 35) & (r > b + 50))
    sky = c.color_mask(full, lambda r, g, b: (b > 200) & (b > r + 40) & (g > r)) & (np.arange(full.height)[:, None] < 232)
    bust = ndimage.binary_erosion(bust, iterations=1) & ~ndimage.binary_dilation(orange | sky, iterations=1)
    icon = c.fit(c.apply_mask(full, bust, keep_largest=True, fill_holes=True, feather=0.8))
    # Banner: the glowing arch panel that carries the lettering, cut out of the frame by a hand-traced outline plus
    # a colour key (glow and blue only: the dark-teal frame, the dark-blue corners and the orange scene drop out).
    outline = c.polygon_mask(full.size, [
        (20, 230), (40, 190), (73, 170), (123, 130), (200, 92), (277, 76), (338, 74), (470, 72), (540, 74), (615, 92),
        (692, 122), (769, 152), (820, 185), (858, 230), (858, 310), (740, 320), (700, 276), (638, 245), (569, 226),
        (525, 224), (525, 193), (405, 193), (400, 224), (338, 226), (254, 241), (177, 276), (123, 330), (20, 320)])
    panel = c.color_mask(full, lambda r, g, b: (g > 55) & (b > 140)) & outline
    panel = ndimage.binary_opening(panel, iterations=2)
    return icon, c.wordmark_banner(c.apply_mask(full, panel, keep_largest=True, fill_holes=True))


@recipe('CON', 'Continuum')
def con():
    # Steel shield on a starfield: clear the near-black space that touches the edge (stars are specks; keep_largest
    # drops them). The shield's own dark face stays because it is lighter than space.
    im = c.load(src('04-continuum.png'), (90, 260, 990, 1400))
    icon = c.fit(c.remove_edge_background(im, tol=38, close=3))
    return icon, c.banner(icon, 'Continuum', color=(230, 40, 36), font='sans')


@recipe('HVN', 'Haven')
def hvn():
    # Silver dragon + H/N shield inside a ring of wings, on smoky black rock: the ring's outer edge is hand-traced
    # (the background is too busy to key), and the dark inside the ring stays, so the dragon reads against black.
    im = c.load(src('05-dragon-hn-monogram.png'))
    ring = c.polygon_mask(im.size, [
        (330, 62), (420, 58), (490, 50), (580, 55), (660, 62), (735, 65), (800, 100), (880, 150), (940, 200),
        (985, 300), (990, 400), (985, 500), (960, 580), (930, 650), (880, 720), (800, 790), (710, 860), (630, 925),
        (570, 985), (545, 1002), (500, 975), (440, 930), (380, 875), (290, 805), (190, 700), (130, 600), (100, 500),
        (95, 400), (100, 300), (125, 200), (165, 150), (250, 100)])
    icon = c.fit(c.apply_mask(im, ring, feather=1.5))
    return icon, c.banner(icon, 'Haven', color=(214, 220, 228), font='serif')


@recipe('INT', 'Intervention')
def int_():
    # Dragons above a gold wordmark on a flat dark-grey card: clear the card that touches the edge. The dragons and the
    # wordmark are one logo, so the whole thing is both the icon and the banner.
    im = c.load(src('06-intervention.png'))
    logo = c.remove_edge_background(im, tol=26, close=1)
    return c.fit(logo), c.wordmark_banner(logo)
