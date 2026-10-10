"""Turns each guild's source logo into an icon and a banner (helpers in cutlib.py, recipes in recipes_*.py).

Run from anywhere:  python3 -I recipes.py <out_dir> [CODE ...]
Writes <CODE>.png/.tga (icon, ^I<CODE>^) and F<CODE>.png/.tga (banner, ^F<CODE>^) plus preview.png.
"""

import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python3 -I leaves the script's folder off the path.

import cutlib as c  # noqa: E402

for f in sorted(os.listdir(HERE)):
    if f.startswith('recipes_') and f.endswith('.py'):
        importlib.import_module(f[:-3])


def main():
    out = sys.argv[1]
    codes = sys.argv[2:] or list(c.RECIPES)
    os.makedirs(out, exist_ok=True)
    shown = []
    for code in codes:
        name, fn = c.RECIPES[code]
        icon, ban = fn()
        stem = 'ICON' if code == 'CON' else code  # Windows reserves CON.*; Zeal also reads I<CODE>.
        shown += [(f'^I{code}^', c.save(icon, out, stem)), (f'^F{code}^', c.save(ban, out, 'F' + code))]
    c.preview(shown, os.path.join(out, 'preview.png'))


if __name__ == '__main__':
    main()
