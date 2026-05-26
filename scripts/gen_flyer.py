#!/usr/bin/env python3
"""
gen_flyer.py — Animated release flyer for Wolf Pack's Quarm Bot v2.0
Two-robot layout: rusty v1.4 (left) vs shiny v2.0 (right)
"""

import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H      = 680, 545
FRAMES    = 36
FRAME_MS  = 65

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'docs')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Palette ───────────────────────────────────────────────────────────────────
BG          = (7,  9, 20)
GOLD        = (255, 200,  40)
GOLD_DIM    = (160, 120,  10)
GOLD_DARK   = ( 80,  55,   5)
AMBER       = (255, 170,   0)
AMBER_GLOW  = (255, 230, 100)
BRONZE      = (175, 105,  35)
BRONZE_LT   = (215, 150,  65)
BRONZE_DK   = ( 90,  50,  15)
COPPER      = (150,  80,  25)
DARK_METAL  = ( 45,  28,  10)
CHROME      = (195, 210, 225)
CHROME_LT   = (235, 245, 255)
CHROME_DK   = (120, 132, 148)
RUST        = (155,  65,  18)
RUST_LT     = (190,  95,  40)
RUST_DK     = ( 72,  28,   8)
RUST_SPOT   = ( 95,  42,  12)
TEAL        = ( 80, 200, 200)
TEAL_DIM    = ( 40, 100, 100)
WHITE       = (255, 255, 255)
OFF_WHITE   = (220, 220, 235)
GRAY        = (140, 140, 155)
LIGHT_GRAY  = (190, 190, 205)
DARK_GRAY   = ( 55,  55,  65)
RED_MED     = (180,  60,  60)
GREEN_MED   = ( 80, 190, 100)
GREEN_DIM   = ( 40, 110,  60)
BORDER      = ( 80,  60,  20)
DIVIDER     = ( 35,  35,  55)
SPARK_Y     = (255, 225,  60)
SPARK_W     = (255, 255, 200)
BURST_FILL  = (215, 110,   8)
BURST_RIM   = (255, 175,  40)
BURST_OUT   = ( 55,  28,   4)
BURST_TEXT  = (255, 250, 210)

def lerp(a, b, t):  return a + (b - a) * t
def lc(c1, c2, t):  return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))
def pulse(frame, speed=1.0, lo=0.0, hi=1.0):
    t = (math.sin(frame / FRAMES * 2 * math.pi * speed) + 1) / 2
    return lo + t * (hi - lo)

# ── Fonts ─────────────────────────────────────────────────────────────────────
def load_font(size, bold=False):
    cands = []
    if bold:
        cands = ["/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                 "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
                 "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf"]
    cands += ["/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in cands:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def load_mono(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

FONT_EPIC   = load_font(44, bold=True)
FONT_TITLE  = load_font(17, bold=True)
FONT_BODY   = load_font(15)
FONT_BODY_B = load_font(15, bold=True)
FONT_SMALL  = load_font(13)
FONT_MONO   = load_mono(13)

# ── Helpers ───────────────────────────────────────────────────────────────────
def star_field(draw, seed=42):
    rng = random.Random(seed)
    for _ in range(55):
        x = rng.randint(0, W); y = rng.randint(0, H)
        b = rng.randint(28, 70); r = 1
        draw.ellipse([x-r,y-r,x+r,y+r], fill=(b,b,b+10))

def glow_blit(img, draw, text, xy, font, fill, glow_col, radius=5):
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.text(xy, text, font=font, fill=glow_col+(180,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    draw2 = ImageDraw.Draw(img)
    draw2.text(xy, text, font=font, fill=fill)
    return draw2

def ellipse_glow(img, cx, cy, rx, ry, color, radius=6):
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.ellipse([cx-rx,cy-ry,cx+rx,cy+ry], fill=color+(130,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    return ImageDraw.Draw(img)

def strikethrough(draw, text, xy, font, fill):
    draw.text(xy, text, font=font, fill=fill)
    bb = draw.textbbox(xy, text, font=font)
    my = (bb[1]+bb[3])//2
    draw.line([bb[0], my, bb[2], my], fill=fill, width=2)

# ── Gear ─────────────────────────────────────────────────────────────────────
def draw_gear(draw, cx, cy, outer_r, num_teeth, tooth_h, angle,
              body, rim, hub, spoke, n_spokes=4):
    # teeth
    for i in range(num_teeth):
        ta = angle + 2*math.pi*i/num_teeth
        hw = math.pi/num_teeth * 0.5
        pts = []
        for da, r in [(-hw,outer_r-1),(-hw*.6,outer_r+tooth_h),
                       (hw*.6,outer_r+tooth_h),(hw,outer_r-1)]:
            a=ta+da; pts.append((cx+r*math.cos(a), cy+r*math.sin(a)))
        draw.polygon(pts, fill=rim)
    draw.ellipse([cx-outer_r,cy-outer_r,cx+outer_r,cy+outer_r], fill=body)
    hub_r = outer_r*.32
    for i in range(n_spokes):
        a = angle + i*math.pi/n_spokes
        draw.line([(cx+hub_r*math.cos(a), cy+hub_r*math.sin(a)),
                   (cx+outer_r*.82*math.cos(a), cy+outer_r*.82*math.sin(a))],
                  fill=spoke, width=max(1,int(outer_r//10)))
    draw.ellipse([cx-hub_r,cy-hub_r,cx+hub_r,cy+hub_r], fill=hub)
    pin = max(2,int(outer_r//8))
    draw.ellipse([cx-pin,cy-pin,cx+pin,cy+pin], fill=DARK_METAL)

# ── Robot ─────────────────────────────────────────────────────────────────────
# style: 'rusty' or 'shiny'
FLICKER = [0.9,0.12,0.88,0.05,0.92,0.22,0.68,0.08,0.96,0.06,0.82,0.28,
           0.91,0.04,0.78,0.18,0.85,0.10,0.93,0.15,0.70,0.09,0.87,0.20]

def draw_robot(img, draw, frame, cx, cy, s=0.82, style='shiny'):
    """Draw a clockwork robot. s=scale, style='rusty'|'shiny'."""
    i = lambda v: int(v * s)

    # ── Style-dependent params ────────────────────────────────────────────────
    if style == 'rusty':
        BC, BL, BD = RUST, RUST_LT, RUST_DK      # body colors
        GC, GR, GH, GS = RUST_DK,(50,22,5),RUST_SPOT,RUST_LT
        angle  = 2*math.pi*frame/FRAMES * 0.55    # slow, sluggish
        angle2 = -angle*1.3
        eye_l  = FLICKER[frame % len(FLICKER)]    # flickering left eye
        eye_r  = None                              # dead right eye
        blink  = False
    else:
        BC, BL, BD = BRONZE, BRONZE_LT, BRONZE_DK
        GC, GR, GH, GS = BRONZE_DK, DARK_METAL, COPPER, BRONZE_LT
        angle  = 2*math.pi*frame/FRAMES
        angle2 = -angle*1.6
        gp     = pulse(frame, speed=0.7, lo=0.45, hi=1.0)
        eye_l  = gp
        eye_r  = gp
        blink  = frame in (8,9)

    # shadow
    for sr,sa in [(i(38),30),(i(28),18),(i(18),10)]:
        draw.ellipse([cx-sr,cy+i(90)-sa//2,cx+sr,cy+i(90)+sa//2],
                     fill=(0,0,0,55 if sr==i(38) else 35 if sr==i(28) else 18))

    # ── Legs ──────────────────────────────────────────────────────────────────
    for lx in (cx-i(22), cx+i(6)):
        lc2 = lx
        draw.rectangle([lc2, cy+i(62), lc2+i(16), cy+i(90)], fill=BD)
        draw.rectangle([lc2-i(2), cy+i(85), lc2+i(18), cy+i(96)], fill=BC)
        draw.rectangle([lc2+i(3), cy+i(65), lc2+i(10), cy+i(85)], fill=BL if style=='shiny' else RUST_SPOT)

    # ── Body ──────────────────────────────────────────────────────────────────
    bx1,by1,bx2,by2 = cx-i(35),cy+i(18),cx+i(35),cy+i(68)
    draw.rectangle([bx1,by1,bx2,by2], fill=BC)
    draw.rectangle([bx1+i(2),by1+i(2),bx2-i(2),by2-i(2)], fill=BL if style=='shiny' else BC)

    if style == 'shiny':
        # chrome highlight edges
        draw.line([bx1+i(2),by1+i(2),bx2-i(2),by1+i(2)], fill=CHROME_LT, width=1)
        draw.line([bx1+i(2),by1+i(2),bx1+i(2),by2-i(2)], fill=CHROME,    width=1)
    else:
        # rust spots on body
        rng = random.Random(77)
        for _ in range(7):
            rx2 = bx1+i(6)+int(rng.uniform(0,i(54)))
            ry2 = by1+i(4)+int(rng.uniform(0,i(40)))
            rr  = int(rng.uniform(i(2),i(6)))
            draw.ellipse([rx2-rr,ry2-rr,rx2+rr,ry2+rr], fill=RUST_SPOT)

    # panel lines + rivets
    draw.line([bx1+i(6),by1+i(8),bx2-i(6),by1+i(8)], fill=BD, width=1)
    draw.line([bx1+i(6),by2-i(8),bx2-i(6),by2-i(8)], fill=BD, width=1)
    for rx2,ry2 in [(bx1+i(6),by1+i(5)),(bx2-i(6),by1+i(5)),
                    (bx1+i(6),by2-i(5)),(bx2-i(6),by2-i(5))]:
        draw.ellipse([rx2-i(2),ry2-i(2),rx2+i(2),ry2+i(2)], fill=BL)

    # chest gear
    draw_gear(draw, cx, cy+i(40), i(17), 10, i(4), angle, GC, GR, GH, GS, n_spokes=5)
    draw_gear(draw, cx+i(28), cy+i(35), i(9), 7, i(3), angle2, GC, GR, GH, GS, n_spokes=4)

    # ── Arms ──────────────────────────────────────────────────────────────────
    arm_sw = math.sin(angle*0.5) * i(4)
    for side in (-1, 1):
        ax = cx - i(35) if side < 0 else cx + i(23)
        ay = int(cy + i(25) + arm_sw * side)
        draw.rectangle([ax, ay, ax+i(12), ay+i(30)], fill=BC)
        draw.rectangle([ax+i(2), ay+i(2), ax+i(10), ay+i(28)], fill=BL if style=='shiny' else BC)
        hx2 = ax if side < 0 else ax + i(4)
        for fi in range(3):
            fx = hx2 + fi*i(4)
            draw.rectangle([fx, ay+i(30), fx+i(3), ay+i(30)+i(6+(fi%2)*3)], fill=BD)

    # ── Neck ──────────────────────────────────────────────────────────────────
    draw.rectangle([cx-i(8),cy+i(8),cx+i(8),cy+i(20)], fill=BD)

    # ── Head ──────────────────────────────────────────────────────────────────
    hx1,hy1,hx2,hy2 = cx-i(32),cy-i(42),cx+i(32),cy+i(10)
    draw.rectangle([hx1,hy1,hx2,hy2], fill=BC)
    draw.rectangle([hx1+i(2),hy1+i(2),hx2-i(2),hy2-i(2)], fill=BL if style=='shiny' else BC)
    if style == 'shiny':
        draw.line([hx1+i(2),hy1+i(2),hx2-i(2),hy1+i(2)], fill=CHROME_LT, width=1)
        draw.line([hx1+i(2),hy1+i(2),hx1+i(2),hy2-i(2)], fill=CHROME,    width=1)
    else:
        # rust patch on forehead
        draw.ellipse([cx-i(15),hy1+i(5),cx+i(10),hy1+i(18)], fill=RUST_SPOT)
    draw.rectangle([hx1+i(6),hy1+i(4),hx2-i(6),hy1+i(14)], fill=BD)

    # ear bolts
    for ex in (hx1-i(3), hx2+i(1)):
        draw.rectangle([ex,cy-i(20),ex+i(4),cy-i(5)], fill=CHROME_DK if style=='shiny' else RUST_DK)
        draw.ellipse([ex-i(1),cy-i(22),ex+i(5),cy-i(17)], fill=CHROME_DK if style=='shiny' else RUST_DK)

    # ── Antenna ───────────────────────────────────────────────────────────────
    if style == 'rusty':
        # bent antenna, drooping to the right
        ax1,ay1 = cx, hy1
        ax2,ay2 = cx+i(14), hy1-i(14)
        draw.line([ax1,ay1,ax2,ay2], fill=RUST_LT, width=i(2))
        draw.line([ax2-i(6),ay2-i(2),ax2+i(6),ay2+i(2)], fill=RUST_LT, width=i(2))
        # dim flickering tip
        tip_brightness = max(0.05, eye_l * 0.6)
        tc = lc(RUST_DK, (220,140,30), tip_brightness)
        draw.ellipse([ax2-i(4),ay2-i(4),ax2+i(4),ay2+i(4)], fill=tc)
    else:
        # straight glowing antenna
        draw.line([cx,hy1,cx,hy1-i(22)], fill=BRONZE_LT, width=i(2))
        draw.line([cx-i(8),hy1-i(22),cx+i(8),hy1-i(22)], fill=BRONZE_LT, width=i(2))
        gr   = int(i(4) + eye_l*i(3))
        gtip = lc(AMBER, AMBER_GLOW, eye_l)
        draw = ellipse_glow(img, cx, hy1-i(22), gr+i(2), gr+i(2), gtip, radius=5)
        draw.ellipse([cx-gr,hy1-i(22)-gr,cx+gr,hy1-i(22)+gr], fill=gtip)

    # ── Eyes ──────────────────────────────────────────────────────────────────
    eye_positions = [(cx-i(14), eye_l), (cx+i(14), eye_r)]
    ey = cy - i(22)

    for ex, eg in eye_positions:
        if eg is None:
            # dead eye — dark socket with cracks
            draw.ellipse([ex-i(10),ey-i(7),ex+i(10),ey+i(7)], fill=DARK_METAL)
            draw.ellipse([ex-i(7), ey-i(5),ex+i(7), ey+i(5)], fill=(15,8,5))
            # crack lines
            draw.line([ex-i(3),ey-i(5),ex+i(2),ey+i(4)], fill=RUST_DK, width=1)
            draw.line([ex-i(1),ey-i(4),ex-i(4),ey+i(3)], fill=RUST_DK, width=1)
        elif blink:
            draw.rectangle([ex-i(9),ey-i(1),ex+i(9),ey+i(1)], fill=BD)
        else:
            ec  = lc(AMBER, AMBER_GLOW, eg)
            gr2 = int(i(10) + eg*i(4))
            draw = ellipse_glow(img, ex, ey, gr2, gr2//2+i(2), ec, radius=6)
            draw.ellipse([ex-i(10),ey-i(7),ex+i(10),ey+i(7)], fill=DARK_METAL)
            draw.ellipse([ex-i(7), ey-i(5),ex+i(7), ey+i(5)], fill=lc(AMBER, AMBER_GLOW, eg))
            draw.ellipse([ex-i(3), ey-i(2),ex+i(3), ey+i(2)], fill=DARK_METAL)
            draw.ellipse([ex-i(5), ey-i(4),ex-i(2), ey-i(1)], fill=(255,255,200))

    # ── Sparks (rusty left eye shorting out) ──────────────────────────────────
    if style == 'rusty' and FLICKER[frame % len(FLICKER)] < 0.18:
        srng = random.Random(frame * 13 + 7)
        for _ in range(5):
            sa  = srng.uniform(0, 2*math.pi)
            sl  = srng.uniform(i(3), i(11))
            scl = SPARK_W if srng.random() > 0.4 else SPARK_Y
            draw.line([(cx-i(14), ey),
                       (cx-i(14)+int(sl*math.cos(sa)), ey+int(sl*math.sin(sa)))],
                      fill=scl, width=1)

    # ── Mouth grille ──────────────────────────────────────────────────────────
    for mi in range(5):
        mx = hx1 + i(8) + mi*i(9)
        if style == 'shiny':
            # happy — center teeth taller, slight upturn
            ht = i(8) if mi in (1,2,3) else i(5)
            draw.line([mx, hy2-i(12), mx, hy2-i(12)+ht], fill=DARK_METAL, width=i(2))
        else:
            # sad — droop at edges
            droop = int(abs(mi-2)*i(3))
            draw.line([mx, hy2-i(10)+droop, mx, hy2-i(4)+droop], fill=BD, width=i(2))

    # ── Steam puff ────────────────────────────────────────────────────────────
    pf = frame % 18
    if pf < 5 and style == 'shiny':
        alpha = int(160*(1-pf/5))
        py    = hy1 - i(18) - pf*i(6)
        pr    = i(4) + pf*i(2)
        puff  = Image.new("RGBA", img.size, (0,0,0,0))
        pd    = ImageDraw.Draw(puff)
        pd.ellipse([cx-i(8)-pr,py-pr,cx-i(8)+pr,py+pr], fill=(200,200,220,alpha))
        pd.ellipse([cx+i(2),py-pr+i(2),cx+i(2)+pr+i(4),py+pr-i(2)],
                   fill=(200,200,220,alpha//2))
        img.paste(Image.alpha_composite(img.convert("RGBA"),puff).convert("RGB"),(0,0))
        draw = ImageDraw.Draw(img)

    # ── Rusty smoke puff (dark, intermittent) ─────────────────────────────────
    pf2 = frame % 24
    if pf2 < 4 and style == 'rusty':
        alpha = int(100*(1-pf2/4))
        if style == 'rusty':
            ant_tip = (cx+i(14), hy1-i(14))
        py2 = ant_tip[1] - pf2*i(5)
        pr2 = i(3) + pf2*i(2)
        puff2 = Image.new("RGBA", img.size, (0,0,0,0))
        pd2   = ImageDraw.Draw(puff2)
        pd2.ellipse([ant_tip[0]-pr2, py2-pr2, ant_tip[0]+pr2, py2+pr2],
                    fill=(80,55,35,alpha))
        img.paste(Image.alpha_composite(img.convert("RGBA"),puff2).convert("RGB"),(0,0))
        draw = ImageDraw.Draw(img)

    return draw

# ── Background ────────────────────────────────────────────────────────────────
def draw_background(img, draw):
    draw.rectangle([0,0,W,H], fill=BG)
    star_field(draw)
    for t,col in [(2,GOLD_DARK),(4,BORDER)]:
        draw.rectangle([t,t,W-t,H-t], outline=col, width=1)
    draw.rectangle([0,0,W,62], fill=(14,14,30))
    draw.line([0,62,W,62], fill=GOLD_DARK, width=1)
    draw.rectangle([0,H-50,W,H], fill=(14,14,30))
    draw.line([0,H-50,W,H-50], fill=GOLD_DARK, width=1)
    # center vertical divider
    draw.line([W//2, 68, W//2, H-56], fill=(28,28,48), width=1)

# ── Header ────────────────────────────────────────────────────────────────────
def draw_header(img, draw, frame):
    ep    = pulse(frame, speed=0.4, lo=0.7, hi=1.0)
    title = "Wolf Pack's Quarm Bot"
    bb    = draw.textbbox((0,0), title, font=FONT_EPIC)
    tw    = bb[2]-bb[0]
    tx    = (W-tw)//2
    ty    = 8

    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.text((tx,ty), title, font=FONT_EPIC, fill=(*lc(GOLD_DIM,GOLD,ep),160))
    layer = layer.filter(ImageFilter.GaussianBlur(6))
    img.paste(Image.alpha_composite(img.convert("RGBA"),layer).convert("RGB"),(0,0))
    draw  = ImageDraw.Draw(img)
    draw.text((tx+2,ty+2), title, font=FONT_EPIC, fill=GOLD_DARK)
    draw.text((tx,ty),     title, font=FONT_EPIC, fill=lc(GOLD_DIM,GOLD,ep))
    return ImageDraw.Draw(img)

# ── Left column: OLD AND BUSTED ───────────────────────────────────────────────
def draw_left_col(img, draw, frame):
    tx = 14
    y  = 70

    # dark panel behind text
    panel = Image.new("RGBA", img.size, (0,0,0,0))
    pd    = ImageDraw.Draw(panel)
    pd.rectangle([tx-2, y-4, W//2-6, y+105], fill=(0,0,0,110))
    img.paste(Image.alpha_composite(img.convert("RGBA"), panel).convert("RGB"), (0,0))
    draw = ImageDraw.Draw(img)

    strikethrough(draw, "  OLD AND BUSTED", (tx, y), FONT_TITLE, (210,80,80))
    y += 26

    busted = [
        ("✗", "Manual paste — miss it, you don't exist"),
        ("✗", "DoTs invisible to the rest of the guild"),
        ("✗", "Timers guessed, never exact"),
    ]
    for icon, txt in busted:
        draw.text((tx+4,  y), icon, font=FONT_BODY_B, fill=(220,90,90))
        draw.text((tx+22, y), txt,  font=FONT_BODY,   fill=(175,135,130))
        y += 21

    return draw

# ── Right column: NEW HOTNESS ─────────────────────────────────────────────────
def draw_right_col(img, draw, frame):
    ep  = pulse(frame, speed=0.5, lo=0.6, hi=1.0)
    ep2 = pulse(frame, speed=0.7, lo=0.6, hi=1.0)
    tx  = W//2 + 10
    y   = 70

    # dark panel behind text
    panel = Image.new("RGBA", img.size, (0,0,0,0))
    pd    = ImageDraw.Draw(panel)
    pd.rectangle([tx-2, y-4, W-8, y+105], fill=(0,0,0,110))
    img.paste(Image.alpha_composite(img.convert("RGBA"), panel).convert("RGB"), (0,0))
    draw = ImageDraw.Draw(img)

    draw.text((tx, y), "  NEW HOTNESS", font=FONT_TITLE, fill=lc(GOLD_DIM,GOLD,ep))
    y += 26

    hotness = [
        ("✓", "Log streams live — zero action needed"),
        ("✓", "DoTs, procs, nukes — every tick counted"),
        ("✓", "Paste lockouts → exact timers, instantly"),
    ]
    for icon, txt in hotness:
        draw.text((tx+4,  y), icon, font=FONT_BODY_B, fill=lc(GREEN_DIM,GREEN_MED,ep2))
        draw.text((tx+22, y), txt,  font=FONT_BODY,   fill=OFF_WHITE)
        y += 21

    return draw

# ── Tagline ───────────────────────────────────────────────────────────────────
def draw_tagline(draw, frame):
    ep  = pulse(frame, speed=0.45, lo=0.6, hi=1.0)
    tag = "Help the Pack see your full contribution!"
    bb  = draw.textbbox((0,0),tag,font=FONT_TITLE)
    tw  = bb[2]-bb[0]
    tx  = (W - tw) // 2  # centered under the burst
    ty  = 408            # just below robot feet (404) and burst bottom (380)
    draw.text((tx+1,ty+1), tag, font=FONT_TITLE, fill=GOLD_DARK)
    draw.text((tx,ty),     tag, font=FONT_TITLE, fill=lc(GOLD_DIM,GOLD,ep))

# ── Bottom strip ──────────────────────────────────────────────────────────────
def draw_bottom_strip(draw, frame):
    ep  = pulse(frame, speed=0.5, lo=0.5, hi=1.0)
    ep2 = pulse(frame, speed=0.6, lo=0.5, hi=1.0)
    y   = H - 108

    draw.line([14, y, W-14, y], fill=DIVIDER, width=1)
    y += 5

    # "New in v2.2" dim label
    draw.text((14, y), "New in v2.2:", font=FONT_MONO, fill=(68, 68, 90))
    y += 17

    # DoT damage
    draw.text((14, y), "DoT damage", font=FONT_BODY_B, fill=lc(GOLD_DIM, GOLD, ep))
    bb = draw.textbbox((0,0), "DoT damage", font=FONT_BODY_B)
    x2 = 14 + bb[2] - bb[0] + 8
    draw.text((x2, y), "— Every tick credited; nukes & procs too",
              font=FONT_BODY, fill=LIGHT_GRAY)
    y += 20

    # Pets
    draw.text((14, y), "Pet→owner",   font=FONT_BODY_B, fill=lc(GOLD_DIM, GOLD, ep2))
    bb2 = draw.textbbox((0,0), "Pet→owner", font=FONT_BODY_B)
    x3  = 14 + bb2[2] - bb2[0] + 8
    draw.text((x3, y), "— Pet damage automatically rolls into the owner",
              font=FONT_BODY, fill=LIGHT_GRAY)

# ── Footer ────────────────────────────────────────────────────────────────────
def draw_footer(draw, frame):
    ep = pulse(frame, speed=0.5, lo=0.5, hi=1.0)
    fy = H - 42

    draw.text((18, fy),    "@RaidBosses", font=FONT_BODY_B, fill=lc(TEAL_DIM,TEAL,ep))
    draw.text((18, fy+15), "Quarm Raid Timer Bot", font=FONT_SMALL, fill=DARK_GRAY)

    ver = "v2.2.0  —  DoT DAMAGE"
    bb  = draw.textbbox((0,0),ver,font=FONT_BODY_B)
    vx  = (W-(bb[2]-bb[0]))//2
    draw.rectangle([vx-8,fy-2,vx+(bb[2]-bb[0])+8,fy+16], fill=(20,20,40))
    draw.rectangle([vx-8,fy-2,vx+(bb[2]-bb[0])+8,fy+16], outline=GOLD_DARK, width=1)
    draw.text((vx,fy), ver, font=FONT_BODY_B, fill=GOLD)

    tag = "tinyurl.com/WolfPackEQ"
    bb2 = draw.textbbox((0,0),tag,font=FONT_SMALL)
    draw.text((W-(bb2[2]-bb2[0])-18, fy),    tag, font=FONT_SMALL, fill=GRAY)
    draw.text((W-152, fy+15), "discord.gg/rtzZNxxT3", font=FONT_SMALL, fill=DARK_GRAY)

# ── EQ-style nameplates ───────────────────────────────────────────────────────
# In EQ: character name floats above head, guild tag "<GuildName>" just below.
def draw_nameplates(img, draw, frame):
    s    = 1.02
    ep   = pulse(frame, speed=0.5, lo=0.7, hi=1.0)
    guild = "<Wolf Pack>"

    specs = [
        # (cx, cy, version_label, name_color, guild_color)
        (W//4+10,   295, "v1.4",
         (190, 160, 130),           # faded/worn white for rusty
         (130, 100,  80)),          # muted teal-brown guild tag
        (W*3//4-10, 295, "v2.2",
         (230, 240, 255),           # bright blue-white for shiny
         lc(TEAL_DIM, TEAL, ep)),   # pulsing teal guild tag
    ]

    for cx, cy, ver, name_col, guild_col in specs:
        # antenna tip is at cy - int(42*s) - int(22*s)
        tip_y   = cy - int(42*s) - int(22*s)
        name_y  = tip_y - 32
        guild_y = name_y + 18

        # measure both strings
        bb_n = draw.textbbox((0,0), ver,   font=FONT_BODY_B)
        bb_g = draw.textbbox((0,0), guild, font=FONT_SMALL)
        nw   = bb_n[2]-bb_n[0];  gw = bb_g[2]-bb_g[0]
        pad  = 6

        # dark semi-transparent backing bar (both lines)
        bar_x1 = cx - max(nw, gw)//2 - pad
        bar_x2 = cx + max(nw, gw)//2 + pad
        bar_y1 = name_y - 3
        bar_y2 = guild_y + (bb_g[3]-bb_g[1]) + 3

        panel = Image.new("RGBA", img.size, (0,0,0,0))
        pd    = ImageDraw.Draw(panel)
        pd.rectangle([bar_x1, bar_y1, bar_x2, bar_y2], fill=(0,0,0,160))
        img.paste(Image.alpha_composite(img.convert("RGBA"), panel).convert("RGB"), (0,0))
        draw = ImageDraw.Draw(img)

        # version name
        draw.text((cx - nw//2 + 1, name_y+1),  ver,   font=FONT_BODY_B, fill=(0,0,0))
        draw.text((cx - nw//2,     name_y),     ver,   font=FONT_BODY_B, fill=name_col)

        # guild tag
        draw.text((cx - gw//2 + 1, guild_y+1), guild, font=FONT_SMALL, fill=(0,0,0))
        draw.text((cx - gw//2,     guild_y),   guild, font=FONT_SMALL, fill=guild_col)

    return draw

# ── Spiky action burst ────────────────────────────────────────────────────────
CTA_URL = "tinyurl.com/WolfPackP"

def draw_burst(img, draw, frame, url=CTA_URL):
    """Comic-book starburst CTA badge, centered between the two robots at robot-body height."""
    cx, cy   = W // 2, 295   # vertically level with robot centers, in the gap between them
    r_out    = 85
    r_in     = 55
    n_points = 20
    # very slow wobble rotation so it feels alive
    rot = (frame / FRAMES) * math.pi * 0.18

    # ── starburst polygon ─────────────────────────────────────────────────────
    pts = []
    for i in range(n_points * 2):
        a = rot + i * math.pi / n_points
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    # drop shadow
    shadow_pts = [(x+4, y+4) for x,y in pts]
    draw.polygon(shadow_pts, fill=(0,0,0,60))

    # outer glow layer
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.polygon(pts, fill=(*BURST_RIM, 80))
    layer = layer.filter(ImageFilter.GaussianBlur(6))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    draw = ImageDraw.Draw(img)

    # main burst fill + rim
    draw.polygon(pts, fill=BURST_FILL, outline=BURST_OUT)
    # inner circle for text readability
    draw.ellipse([cx-r_in+1, cy-r_in+1, cx+r_in-1, cy+r_in-1],
                 fill=(195, 95, 5))

    # ── text ──────────────────────────────────────────────────────────────────
    lines = ["Install & run", "the parser", "today!"]
    total_h = sum(draw.textbbox((0,0), l, font=FONT_TITLE)[3] for l in lines) + 6
    ty = cy - total_h // 2 - 10

    for ln in lines:
        bb  = draw.textbbox((0,0), ln, font=FONT_TITLE)
        lw  = bb[2] - bb[0]
        lx  = cx - lw // 2
        draw.text((lx+1, ty+1), ln, font=FONT_TITLE, fill=BURST_OUT)
        draw.text((lx,   ty),   ln, font=FONT_TITLE, fill=BURST_TEXT)
        ty += bb[3] - bb[1] + 3

    # url below text
    ty += 4
    bb2 = draw.textbbox((0,0), url, font=FONT_BODY_B)
    ux  = cx - (bb2[2]-bb2[0]) // 2
    draw.text((ux+1, ty+1), url, font=FONT_BODY_B, fill=BURST_OUT)
    draw.text((ux,   ty),   url, font=FONT_BODY_B, fill=(255, 240, 150))

    return ImageDraw.Draw(img)

# ── Secondary "Now includes DoT Damage!" starburst (far-right edge) ──────────
def draw_dot_burst(img, draw, frame):
    """Smaller diagonal starburst calling out the new DoT-damage capture feature."""
    cx, cy   = W - 60, 90       # far-right edge, 10px buffer from the canvas edge
    r_out    = 50
    r_in     = 32
    n_points = 14
    # tilt + slow wobble so it pops against the rectangle layout
    rot      = math.radians(-12) + (frame / FRAMES) * math.pi * 0.10

    pts = []
    for i in range(n_points * 2):
        a = rot + i * math.pi / n_points
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    # drop shadow
    shadow_pts = [(x+3, y+3) for x,y in pts]
    draw.polygon(shadow_pts, fill=(0,0,0,80))

    # glow halo — green to differentiate from the main orange burst
    GLOW = (90, 220, 110)
    FILL = (32, 145, 60)
    RIM  = (170, 240, 180)
    OUT  = (8, 50, 22)
    layer = Image.new("RGBA", img.size, (0,0,0,0))
    ld    = ImageDraw.Draw(layer)
    ld.polygon(pts, fill=(*RIM, 90))
    layer = layer.filter(ImageFilter.GaussianBlur(5))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0,0))
    draw = ImageDraw.Draw(img)

    draw.polygon(pts, fill=FILL, outline=OUT)
    draw.ellipse([cx-r_in+1, cy-r_in+1, cx+r_in-1, cy+r_in-1], fill=(26, 110, 48))

    # text — three short lines so they fit inside r_in
    lines = ["NOW WITH", "DoT", "DAMAGE!"]
    fonts = [FONT_SMALL, FONT_TITLE, FONT_SMALL]
    bbs   = [draw.textbbox((0,0), l, font=f) for l, f in zip(lines, fonts)]
    total_h = sum(bb[3] - bb[1] for bb in bbs) + 2 * 3
    ty = cy - total_h // 2 - 4

    for ln, f, bb in zip(lines, fonts, bbs):
        lw = bb[2] - bb[0]
        lx = cx - lw // 2
        draw.text((lx+1, ty+1), ln, font=f, fill=OUT)
        draw.text((lx,   ty),   ln, font=f, fill=(255, 255, 230))
        ty += bb[3] - bb[1] + 3

    return ImageDraw.Draw(img)

# ── Render ────────────────────────────────────────────────────────────────────
def render_frame(f):
    img  = Image.new("RGB", (W,H), BG)
    draw = ImageDraw.Draw(img)
    draw_background(img, draw)
    draw = draw_header(img, draw, f)

    # burst is a background layer — drawn before robots so everything renders on top
    draw = draw_burst(img, draw, f)

    draw = draw_robot(img, draw, f, cx=W//4+10,   cy=295, s=1.02, style='rusty')
    draw = draw_robot(img, draw, f, cx=W*3//4-10, cy=295, s=1.02, style='shiny')
    draw = draw_nameplates(img, draw, f)

    draw = draw_left_col(img, draw, f)
    draw = draw_right_col(img, draw, f)
    draw_tagline(draw, f)
    draw_bottom_strip(draw, f)
    draw_footer(draw, f)
    # DoT-damage callout burst — drawn LAST so it sits on top of everything
    draw = draw_dot_burst(img, draw, f)
    return img

print("Rendering frames...")
frames = []
for f in range(FRAMES):
    print(f"  {f+1}/{FRAMES}", end="\r")
    frames.append(render_frame(f))

out = os.path.join(OUT_DIR, "flyer-v2.gif")
print(f"\nSaving → {out}")
frames[0].save(out, save_all=True, append_images=frames[1:],
               duration=FRAME_MS, loop=0, optimize=False)
print("Done.")
