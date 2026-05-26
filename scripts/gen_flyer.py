#!/usr/bin/env python3
"""
gen_flyer.py — Animated release flyer for Wolf Pack's Quarm Bot v2.0
Outputs: docs/flyer-v2.gif (animated, Discord-shareable)
"""

import math, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Canvas & animation ────────────────────────────────────────────────────────
W, H      = 820, 520
FRAMES    = 36          # one full gear rotation
FRAME_MS  = 65          # ~15 fps

OUT_DIR   = os.path.join(os.path.dirname(__file__), '..', 'docs')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Palette ───────────────────────────────────────────────────────────────────
BG          = (7,  9, 20)
STAR_C      = (160, 170, 200)
BORDER      = (80,  60, 20)
GOLD        = (255, 200,  40)
GOLD_DIM    = (160, 120,  10)
GOLD_DARK   = ( 80,  55,   5)
AMBER       = (255, 170,   0)
AMBER_GLOW  = (255, 230, 100)
BRONZE      = (175, 105,  35)
BRONZE_LT   = (210, 140,  55)
BRONZE_DK   = ( 90,  50,  15)
COPPER      = (150,  80,  25)
DARK_METAL  = ( 45,  28,  10)
STEEL       = (130, 140, 155)
STEEL_DK    = ( 70,  78,  88)
WHITE       = (255, 255, 255)
OFF_WHITE   = (220, 220, 235)
GRAY        = (140, 140, 155)
LIGHT_GRAY  = (190, 190, 205)
DARK_GRAY   = ( 55,  55,  65)
TEAL        = ( 80, 200, 200)
TEAL_DIM    = ( 40, 100, 100)
RED_DIM     = (120,  30,  30)
SMOKE       = (180, 180, 200, 120)

def lerp(a, b, t):   return a + (b - a) * t
def lc(c1, c2, t):   return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))
def pulse(frame, speed=1.0, lo=0.0, hi=1.0):
    t = (math.sin(frame / FRAMES * 2 * math.pi * speed) + 1) / 2
    return lo + t * (hi - lo)

# ── Fonts ─────────────────────────────────────────────────────────────────────
def load_font(size, bold=False):
    candidates = []
    if bold:
        candidates = [
            "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
            "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        ]
    candidates += [
        "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def load_mono(size):
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

FONT_EPIC   = load_font(46, bold=True)
FONT_TITLE  = load_font(17, bold=True)
FONT_BODY   = load_font(14)
FONT_BODY_B = load_font(14, bold=True)
FONT_SMALL  = load_font(12)
FONT_MONO   = load_mono(12)

# ── Helpers ───────────────────────────────────────────────────────────────────
def centered_text(draw, text, y, font, fill, img_w=W):
    bb  = draw.textbbox((0, 0), text, font=font)
    tw  = bb[2] - bb[0]
    draw.text(((img_w - tw) // 2, y), text, font=font, fill=fill)

def shadow_text(draw, text, xy, font, fill, shadow=(0,0,0), offset=(2,2)):
    draw.text((xy[0]+offset[0], xy[1]+offset[1]), text, font=font, fill=shadow)
    draw.text(xy, text, font=font, fill=fill)

def glow_text(img, draw, text, xy, font, fill, glow_col, radius=4):
    """Draw text with a soft glow by compositing a blurred layer."""
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.text(xy, text, font=font, fill=glow_col + (200,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    draw  = ImageDraw.Draw(img)    # refresh draw after paste
    draw.text(xy, text, font=font, fill=fill)
    return ImageDraw.Draw(img)

def star_field(draw, seed=42):
    import random; rng = random.Random(seed)
    for _ in range(120):
        x = rng.randint(0, W)
        y = rng.randint(0, H)
        b = rng.randint(60, 160)
        r = rng.choice([1, 1, 1, 2])
        draw.ellipse([x-r, y-r, x+r, y+r], fill=(b, b, b+20))

# ── Gear drawing ──────────────────────────────────────────────────────────────
def draw_gear(draw, cx, cy, outer_r, num_teeth, tooth_h, angle,
              body_col, rim_col, hub_col, spoke_col, n_spokes=4):
    # teeth
    for i in range(num_teeth):
        ta   = angle + 2*math.pi*i/num_teeth
        hw   = math.pi/num_teeth * 0.55
        pts  = []
        for da, r in [(-hw, outer_r-1), (-hw*0.65, outer_r+tooth_h),
                       (hw*0.65, outer_r+tooth_h), (hw, outer_r-1)]:
            a = ta + da
            pts.append((cx + r*math.cos(a), cy + r*math.sin(a)))
        draw.polygon(pts, fill=rim_col)
    # body disc
    draw.ellipse([cx-outer_r, cy-outer_r, cx+outer_r, cy+outer_r], fill=body_col)
    # spokes
    hub_r = outer_r * 0.32
    for i in range(n_spokes):
        a  = angle + i * math.pi / n_spokes
        x1 = cx + hub_r * math.cos(a);  y1 = cy + hub_r * math.sin(a)
        x2 = cx + outer_r*.82*math.cos(a); y2 = cy + outer_r*.82*math.sin(a)
        draw.line([x1,y1,x2,y2], fill=spoke_col, width=max(1,outer_r//10))
    # hub
    draw.ellipse([cx-hub_r,cy-hub_r,cx+hub_r,cy+hub_r], fill=hub_col)
    # axle pin
    pin = max(2, outer_r//8)
    draw.ellipse([cx-pin,cy-pin,cx+pin,cy+pin], fill=DARK_METAL)

# ── Clockwork robot ───────────────────────────────────────────────────────────
# Robot is centered at (RX, RY)
RX, RY = 168, 295

def draw_robot(img, draw, frame):
    angle     = 2*math.pi * frame/FRAMES      # main gear rotation
    angle2    = -angle * 1.6                   # counter-rotating small gear
    eye_glow  = pulse(frame, speed=0.7, lo=0.4, hi=1.0)
    blink     = frame in (8, 9)               # blink frames

    # ── shadow ────────────────────────────────────────────────────────────────
    for r,a in [(38,30),(28,18),(18,10)]:
        draw.ellipse([RX-r, RY+90-a//2, RX+r, RY+90+a//2],
                     fill=(0,0,0, 60 if r==38 else 40 if r==28 else 20))

    # ── legs ──────────────────────────────────────────────────────────────────
    for lx in (RX-22, RX+10):
        draw.rectangle([lx, RY+62, lx+16, RY+90], fill=BRONZE_DK)
        draw.rectangle([lx-2, RY+85, lx+18, RY+96], fill=BRONZE)   # foot
        draw.rectangle([lx+3, RY+65, lx+10, RY+85], fill=COPPER)   # shin panel

    # ── body ──────────────────────────────────────────────────────────────────
    bx1,by1,bx2,by2 = RX-35, RY+18, RX+35, RY+68
    draw.rectangle([bx1,by1,bx2,by2], fill=BRONZE)
    draw.rectangle([bx1+2,by1+2,bx2-2,by2-2], fill=COPPER)
    # panel lines
    draw.line([bx1+6,by1+8, bx2-6,by1+8], fill=BRONZE_DK, width=1)
    draw.line([bx1+6,by2-8, bx2-6,by2-8], fill=BRONZE_DK, width=1)
    # rivets
    for rx2,ry2 in [(bx1+7,by1+5),(bx2-7,by1+5),(bx1+7,by2-5),(bx2-7,by2-5)]:
        draw.ellipse([rx2-2,ry2-2,rx2+2,ry2+2], fill=BRONZE_LT)

    # chest gear (large, rotating)
    draw_gear(draw, RX, RY+40, 18, 10, 4, angle,
              BRONZE_DK, DARK_METAL, COPPER, BRONZE_LT, n_spokes=5)
    # small side gear (counter-rotating)
    draw_gear(draw, RX+28, RY+35, 9, 7, 3, angle2,
              COPPER, DARK_METAL, BRONZE_DK, BRONZE_LT, n_spokes=4)

    # ── arms ──────────────────────────────────────────────────────────────────
    arm_swing = math.sin(angle * 0.5) * 4
    for side, sx in [(-1, RX-35), (1, RX+35)]:
        ay = int(RY + 25 + arm_swing * side)
        draw.rectangle([sx - (12 if side<0 else 0), ay,
                        sx + (0 if side<0 else 12), ay+30], fill=BRONZE)
        draw.rectangle([sx - (10 if side<0 else 2), ay+2,
                        sx + (-2 if side<0 else 10), ay+28], fill=COPPER)
        # claw hand
        hand_y = ay + 30
        hand_x = sx - 8 if side < 0 else sx + 4
        for fi in range(3):
            fx = hand_x + fi*4 - 2
            draw.rectangle([fx, hand_y, fx+3, hand_y+6+(fi%2)*3],
                           fill=BRONZE_DK)

    # ── neck ──────────────────────────────────────────────────────────────────
    draw.rectangle([RX-8, RY+8, RX+8, RY+20], fill=BRONZE_DK)
    draw.rectangle([RX-5, RY+10, RX+5, RY+20], fill=STEEL_DK)

    # ── head ──────────────────────────────────────────────────────────────────
    hx1,hy1,hx2,hy2 = RX-32, RY-42, RX+32, RY+10
    draw.rectangle([hx1,hy1,hx2,hy2], fill=BRONZE)
    draw.rectangle([hx1+2,hy1+2,hx2-2,hy2-2], fill=COPPER)
    # forehead panel
    draw.rectangle([hx1+6,hy1+4,hx2-6,hy1+14], fill=BRONZE_DK)
    # ear bolts
    for ex in (hx1-3, hx2+1):
        draw.rectangle([ex, RY-20, ex+4, RY-5], fill=STEEL)
        draw.ellipse([ex-1,RY-22,ex+5,RY-17], fill=STEEL_DK)

    # antenna
    draw.line([RX, hy1, RX, hy1-22], fill=BRONZE_LT, width=2)
    draw.line([RX-8, hy1-22, RX+8, hy1-22], fill=BRONZE_LT, width=2)
    glow_r = int(4 + eye_glow * 2)
    gc = lc(AMBER, AMBER_GLOW, eye_glow)
    draw.ellipse([RX-glow_r, hy1-22-glow_r, RX+glow_r, hy1-22+glow_r], fill=gc)

    # ── eyes ──────────────────────────────────────────────────────────────────
    for ex in (RX-14, RX+14):
        ey = RY - 22
        ec = lc(AMBER, AMBER_GLOW, eye_glow)
        if blink:
            # blink: draw horizontal line instead
            draw.rectangle([ex-9, ey-1, ex+9, ey+1], fill=BRONZE_DK)
        else:
            # outer glow
            gr = int(11 + eye_glow*3)
            glow_col = (*ec, 80)
            gl = Image.new("RGBA", img.size, (0,0,0,0))
            gd = ImageDraw.Draw(gl)
            gd.ellipse([ex-gr,ey-gr//2-2,ex+gr,ey+gr//2+2], fill=glow_col)
            gl = gl.filter(ImageFilter.GaussianBlur(5))
            img.paste(Image.alpha_composite(img.convert("RGBA"), gl).convert("RGB"), (0,0))
            draw = ImageDraw.Draw(img)
            # eye socket
            draw.ellipse([ex-10,ey-7,ex+10,ey+7], fill=DARK_METAL)
            # iris
            iris_c = lc(AMBER, AMBER_GLOW, eye_glow)
            draw.ellipse([ex-7,ey-5,ex+7,ey+5], fill=iris_c)
            # pupil
            draw.ellipse([ex-3,ey-2,ex+3,ey+2], fill=DARK_METAL)
            # glint
            draw.ellipse([ex-5,ey-4,ex-2,ey-1], fill=(255,255,200))

    # ── mouth / speaker grille ────────────────────────────────────────────────
    for mi in range(5):
        mx = hx1 + 8 + mi*9
        draw.line([mx, hy2-10, mx, hy2-4], fill=DARK_METAL, width=2)

    # ── steam puff (every ~18 frames) ─────────────────────────────────────────
    pf = frame % 18
    if pf < 5:
        alpha = int(180 * (1 - pf/5))
        py    = hy1 - 18 - pf*6
        pr    = 4 + pf*2
        puff  = Image.new("RGBA", img.size, (0,0,0,0))
        pd    = ImageDraw.Draw(puff)
        pd.ellipse([RX-8-pr, py-pr, RX-8+pr, py+pr], fill=(200,200,220,alpha))
        pd.ellipse([RX+2, py-pr+2, RX+2+pr+4, py+pr-2], fill=(200,200,220,alpha//2))
        img.paste(Image.alpha_composite(img.convert("RGBA"), puff).convert("RGB"), (0,0))
        draw = ImageDraw.Draw(img)

    return draw   # return refreshed draw handle

# ── Background ────────────────────────────────────────────────────────────────
def draw_background(img, draw):
    draw.rectangle([0, 0, W, H], fill=BG)
    star_field(draw)

    # decorative border — double line
    for t, col in [(2, GOLD_DARK), (4, BORDER)]:
        draw.rectangle([t, t, W-t, H-t], outline=col, width=1)

    # top metallic band
    draw.rectangle([0, 0, W, 62], fill=(14, 14, 30))
    draw.line([0, 62, W, 62], fill=GOLD_DARK, width=1)

    # bottom band
    draw.rectangle([0, H-48, W, H], fill=(14, 14, 30))
    draw.line([0, H-48, W, H-48], fill=GOLD_DARK, width=1)

    # faint vertical divider between robot area and text area
    draw.line([310, 70, 310, H-55], fill=(30, 30, 50), width=1)

# ── Feature text block ────────────────────────────────────────────────────────
def draw_features(draw, frame):
    eye_pulse = pulse(frame, speed=0.7, lo=0.55, hi=1.0)
    tx = 325

    # ── section: Parser ───────────────────────────────────────────────────────
    y = 78
    draw.text((tx, y), "⚙  PARSE TRACKING", font=FONT_TITLE,
              fill=lc(GOLD_DIM, GOLD, eye_pulse))
    y += 22
    lines = [
        "Multi-player submissions auto-merge into one",
        "encounter — no matter who submits first.",
        "Boss auto-detected from the EQLogParser header.",
        "Coverage bar shows how complete the picture is.",
    ]
    for ln in lines:
        draw.text((tx+6, y), ln, font=FONT_BODY, fill=LIGHT_GRAY)
        y += 17

    # ── section: Parser streaming ─────────────────────────────────────────────
    y += 8
    draw.text((tx, y), "⚡  LIVE LOG STREAMING", font=FONT_TITLE,
              fill=lc(GOLD_DIM, GOLD, eye_pulse))
    y += 22
    lines2 = [
        "Parser.bat watches every active character log",
        "at once — no character picking, no setup each",
        "raid night. Installs itself into your EQ folder",
        "(already Defender-excluded). Auto-starts on login.",
    ]
    for ln in lines2:
        draw.text((tx+6, y), ln, font=FONT_BODY, fill=LIGHT_GRAY)
        y += 17

    # ── section: Timer recovery ────────────────────────────────────────────────
    y += 8
    draw.text((tx, y), "⏱  LOCKOUT TIMER SYNC", font=FONT_TITLE,
              fill=lc(GOLD_DIM, GOLD, eye_pulse))
    y += 22
    lines3 = [
        "Paste #showlootlockouts → /sll computes every",
        "nextSpawn time and applies them all at once.",
    ]
    for ln in lines3:
        draw.text((tx+6, y), ln, font=FONT_BODY, fill=LIGHT_GRAY)
        y += 17

    # ── section: on deck ──────────────────────────────────────────────────────
    y += 8
    draw.text((tx, y), "🔬  ON DECK — v2.1", font=FONT_TITLE, fill=GRAY)
    y += 20
    boring = [
        "Direct Quarm DB integration via wolfpack-logsync",
        "EQMacEmu NPC tables → richer boss data, no scraping",
        "OpenDKP bid/award API  ·  Sealed wishlist auctions",
    ]
    for ln in boring:
        draw.text((tx+6, y), "·  " + ln, font=FONT_SMALL, fill=DARK_GRAY)
        y += 15

# ── Title & header ────────────────────────────────────────────────────────────
def draw_header(img, draw, frame):
    ep = pulse(frame, speed=0.4, lo=0.7, hi=1.0)
    title = "Wolf Pack's Quarm Bot"

    # measure
    bb  = draw.textbbox((0,0), title, font=FONT_EPIC)
    tw  = bb[2] - bb[0]
    tx  = (W - tw) // 2
    ty  = 8

    # glow layer
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    gc    = (*lc(GOLD_DIM, GOLD, ep), 160)
    ld.text((tx, ty), title, font=FONT_EPIC, fill=gc)
    layer = layer.filter(ImageFilter.GaussianBlur(6))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    draw  = ImageDraw.Draw(img)

    # shadow
    draw.text((tx+2, ty+2), title, font=FONT_EPIC, fill=GOLD_DARK)
    # main text
    draw.text((tx, ty), title, font=FONT_EPIC, fill=lc(GOLD_DIM, GOLD, ep))

    return ImageDraw.Draw(img)

def draw_footer(draw, frame):
    ep = pulse(frame, speed=0.5, lo=0.5, hi=1.0)
    fy = H - 40

    # left: @RaidBosses
    rb_col = lc(TEAL_DIM, TEAL, ep)
    draw.text((18, fy), "@RaidBosses", font=FONT_BODY_B, fill=rb_col)
    draw.text((18, fy+15), "Quarm Raid Timer Bot", font=FONT_SMALL, fill=GRAY)

    # center: version badge
    ver = "v2.0.4  —  PARSER UPDATE"
    bb  = draw.textbbox((0,0), ver, font=FONT_BODY_B)
    vx  = (W - (bb[2]-bb[0])) // 2
    draw.rectangle([vx-8, fy-2, vx+(bb[2]-bb[0])+8, fy+16], fill=(20,20,40))
    draw.rectangle([vx-8, fy-2, vx+(bb[2]-bb[0])+8, fy+16], outline=GOLD_DARK, width=1)
    draw.text((vx, fy), ver, font=FONT_BODY_B, fill=GOLD)

    # right: tagline
    tag = "Project Quarm  ·  Wolf Pack EQ"
    bb2 = draw.textbbox((0,0), tag, font=FONT_SMALL)
    draw.text((W - (bb2[2]-bb2[0]) - 18, fy),    tag, font=FONT_SMALL, fill=GRAY)
    draw.text((W - 115, fy+15), "discord.gg/wolfpack", font=FONT_SMALL, fill=DARK_GRAY)

# ── Robot label ───────────────────────────────────────────────────────────────
def draw_robot_label(draw, frame):
    ep   = pulse(frame, speed=0.6, lo=0.5, hi=1.0)
    col  = lc(TEAL_DIM, TEAL, ep)
    lbl  = "@RaidBosses"
    bb   = draw.textbbox((0,0), lbl, font=FONT_BODY_B)
    lx   = RX - (bb[2]-bb[0])//2
    draw.text((lx, RY+100), lbl, font=FONT_BODY_B, fill=col)

    sub  = "EQ Clockwork  ·  Raid Tracker"
    bb2  = draw.textbbox((0,0), sub, font=FONT_SMALL)
    sx   = RX - (bb2[2]-bb2[0])//2
    draw.text((sx, RY+116), sub, font=FONT_SMALL, fill=DARK_GRAY)

# ── Main render loop ──────────────────────────────────────────────────────────
def render_frame(frame_num):
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    draw_background(img, draw)
    draw = draw_header(img, draw, frame_num)

    draw = draw_robot(img, draw, frame_num)
    draw_robot_label(draw, frame_num)
    draw_features(draw, frame_num)
    draw_footer(draw, frame_num)

    return img

print("Rendering frames...")
frames = []
for f in range(FRAMES):
    print(f"  frame {f+1}/{FRAMES}", end="\r")
    frames.append(render_frame(f))

print("\nSaving GIF...")
out_path = os.path.join(OUT_DIR, "flyer-v2.gif")
frames[0].save(
    out_path,
    save_all=True,
    append_images=frames[1:],
    duration=FRAME_MS,
    loop=0,
    optimize=False,
)
print(f"Done → {out_path}")
