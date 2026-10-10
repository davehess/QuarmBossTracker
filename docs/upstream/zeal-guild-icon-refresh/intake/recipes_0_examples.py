"""Recipes: Squirrels of War, Savage (the two worked examples)."""

import cutlib as c
from cutlib import recipe, src


@recipe('SOW', 'Squirrels of War')
def sow():
    # Gold squirrel shield on flat black: clear the black that touches the edge; the shield's own black stays.
    im = c.load(src('02-squirrel-shield.png'), (150, 130, 730, 760))
    icon = c.fit(c.remove_edge_background(im, tol=30, close=2))
    return icon, c.banner(icon, 'Squirrels of War', color=(214, 170, 90), font='serif')


@recipe('SAV', 'Savage')
def sav():
    # Red brush lettering on black: keyed by colour. The wordmark is the whole logo, so it is both.
    im = c.load(src('17-savage.png'))
    word = c.apply_mask(im, c.color_mask(im, lambda r, g, b: (r > 120) & (g < 90) & (b < 90)))
    return c.fit(c.trim(word)), c.wordmark_banner(word)
