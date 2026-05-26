#!/usr/bin/env python3
"""Generate fake PowerShell terminal screenshots for the README."""

from PIL import Image, ImageDraw, ImageFont
import os, textwrap

# ── Config ────────────────────────────────────────────────────────────────────
W           = 820
FONT_SIZE   = 15
PADDING     = 24
LINE_H      = 22
TITLE_H     = 34
BG          = (12, 12, 12)
TITLE_BG    = (31, 31, 31)
BTN_RED     = (196, 43, 28)
BTN_YEL     = (196, 160, 0)
BTN_GRN     = (23, 177, 76)
TITLE_FG    = (204, 204, 204)
WHITE       = (255, 255, 255)
GRAY        = (102, 102, 102)
DARK_GRAY   = (80, 80, 80)
CYAN        = (0, 220, 220)
YELLOW      = (220, 220, 0)
GREEN       = (0, 220, 80)
RED         = (220, 60, 60)
PROMPT_CLR  = (95, 135, 215)
ADMIN_CLR   = (220, 160, 0)

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'docs')
os.makedirs(OUT_DIR, exist_ok=True)

def load_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
        "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

font = load_font(FONT_SIZE)
font_bold = load_font(FONT_SIZE)  # same size — good enough for terminal feel

def char_w(fnt):
    # measure a fixed-width character
    bb = fnt.getbbox("M")
    return bb[2] - bb[0]

CW = char_w(font)

def render_terminal(filename, title, lines):
    """
    lines = list of (text, color) tuples.
    """
    h = TITLE_H + PADDING + len(lines) * LINE_H + PADDING
    img = Image.new("RGB", (W, h), BG)
    d   = ImageDraw.Draw(img)

    # ── title bar ─────────────────────────────────────────────────────────────
    d.rectangle([0, 0, W, TITLE_H], fill=TITLE_BG)
    # traffic-light buttons
    for i, col in enumerate([BTN_RED, BTN_YEL, BTN_GRN]):
        cx = 18 + i * 26
        cy = TITLE_H // 2
        d.ellipse([cx-7, cy-7, cx+7, cy+7], fill=col)
    # title text
    tw = d.textlength(title, font=font)
    d.text(((W - tw) / 2, (TITLE_H - FONT_SIZE) / 2 - 1), title, font=font, fill=TITLE_FG)

    # ── body lines ────────────────────────────────────────────────────────────
    y = TITLE_H + PADDING
    for (text, color) in lines:
        if text:
            d.text((PADDING, y), text, font=font, fill=color)
        y += LINE_H

    img.save(os.path.join(OUT_DIR, filename))
    print(f"  wrote {filename}")

# ─────────────────────────────────────────────────────────────────────────────
# Screenshot 1 — Node.js NOT installed (install run)
# ─────────────────────────────────────────────────────────────────────────────
LINES_INSTALL = [
    # prompt
    ("Administrator: Windows PowerShell", ADMIN_CLR),
    ("", WHITE),
    ("PS C:\\QuarmBossTracker> .\\install-node.ps1", PROMPT_CLR),
    ("", WHITE),
    ("  Wolf Pack EQ -- QuarmBossTracker Setup", CYAN),
    ("  ----------------------------------------", DARK_GRAY),
    ("", WHITE),
    ("  Node.js not found. Installing Node.js 20.19.1 LTS ...", YELLOW),
    ("", WHITE),
    ("  Downloading via winget ...", GRAY),
    ("", WHITE),
    ('  Found an existing package already installed. Trying to upgrade the', GRAY),
    ('  installed package...', GRAY),
    ("", WHITE),
    ("  Downloading https://nodejs.org/dist/v20.19.1/node-v20.19.1-x64.msi", GRAY),
    ("  ██████████████████████████████████████  100%  22.1 MB", GREEN),
    ("", WHITE),
    ("  Running silent installer ...", GRAY),
    ("", WHITE),
    ("  OK  Node.js v20.19.1 installed successfully.", GREEN),
    ("", WHITE),
    ("  Next steps:", WHITE),
    ("    npm install", YELLOW),
    ("    copy .env.example .env", YELLOW),
    ("    notepad .env", YELLOW),
    ("    npm start", YELLOW),
    ("", WHITE),
    ("  Press Enter to close:", GRAY),
]

render_terminal("screenshot-install.png",
                "Administrator: Windows PowerShell",
                LINES_INSTALL)

# ─────────────────────────────────────────────────────────────────────────────
# Screenshot 2 — Node.js already installed
# ─────────────────────────────────────────────────────────────────────────────
LINES_ALREADY = [
    ("Administrator: Windows PowerShell", ADMIN_CLR),
    ("", WHITE),
    ("PS C:\\QuarmBossTracker> .\\install-node.ps1", PROMPT_CLR),
    ("", WHITE),
    ("  Wolf Pack EQ -- QuarmBossTracker Setup", CYAN),
    ("  ----------------------------------------", DARK_GRAY),
    ("", WHITE),
    ("  OK  Node.js v20.19.1 is installed -- nothing to do.", GREEN),
    ("", WHITE),
    ("  Next steps:", WHITE),
    ("    npm install", YELLOW),
    ("    copy .env.example .env", YELLOW),
    ("    notepad .env", YELLOW),
    ("    npm start", YELLOW),
    ("", WHITE),
    ("  Press Enter to close:", GRAY),
]

render_terminal("screenshot-already-installed.png",
                "Administrator: Windows PowerShell",
                LINES_ALREADY)

# ─────────────────────────────────────────────────────────────────────────────
# Screenshot 3 — start-logsync.ps1 first run (config prompt + watching)
# ─────────────────────────────────────────────────────────────────────────────
LINES_LOGSYNC = [
    ("PS C:\\QuarmBossTracker> .\\start-logsync.ps1", PROMPT_CLR),
    ("", WHITE),
    ("  Wolf Pack EQ -- wolfpack-logsync", CYAN),
    ("  ----------------------------------", DARK_GRAY),
    ("", WHITE),
    ("  Found EQ at: C:\\Program Files (x86)\\Sony\\EverQuest", GREEN),
    ("  Use this path? [Y/n]: Y", GRAY),
    ("", WHITE),
    ("  Config saved to logsync.config.json", DARK_GRAY),
    ("", WHITE),
    ("  Watching 4 log file(s):", WHITE),
    ("", WHITE),
    (" * Hitya                  3m ago", GREEN),
    (" * Canopy                 8m ago", GREEN),
    ("   Boxxxy                 2d ago", GRAY),
    ("   Velvetina              5d ago", GRAY),
    ("", WHITE),
    ("  Uploading to: https://quarm-bot.up.railway.app/api/agent/encounter", DARK_GRAY),
    ("  Press Ctrl+C to stop.", DARK_GRAY),
    ("", WHITE),
    ("  [logsync] tailing 4 files from end-of-file...", GRAY),
    ("  [Hitya] encounter started: Lord Nagafen", YELLOW),
    ("  [Hitya] 47 events buffered, 28 unique players", GRAY),
    ("  [Hitya] uploaded encounter: Lord Nagafen (200 OK)", GREEN),
]

render_terminal("screenshot-logsync.png",
                "Windows PowerShell",
                LINES_LOGSYNC)

print("Done.")
