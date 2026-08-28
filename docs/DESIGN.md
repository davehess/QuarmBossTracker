---
name: wolfpack.quest
description: An engraved specimen plate on the night ground a raider already reads on.
colors:
  night-ground: "#0d1117"
  panel-slate: "#161b22"
  hairline: "#30363d"
  bone-line: "#e8e2d4"
  bone-bright: "#f2ede1"
  read-grey: "#c9d1d9"
  dim-grey: "#6e7681"
  eye-gold: "#d29922"
  eye-gold-lit: "#e0a92c"
  gold-ink: "#1a1206"
  link-blue: "#58a6ff"
  accent-blue: "#1f6feb"
  live-green: "#56d364"
  alarm-red: "#f85149"
  warn-orange: "#ffa657"
  class-purple: "#a371f7"
typography:
  display:
    fontFamily: "Prata, Georgia, serif"
    fontSize: "clamp(2rem, 7vw, 4.25rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Prata, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: "Prata, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.4
  body:
    fontFamily: "Faustina, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.75rem
  bodySmall:
    fontFamily: "Faustina, Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5rem
  label:
    fontFamily: "Cascadia Code, Consolas, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: "Cascadia Code, Consolas, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  hair: "2px"
  sm: "4px"
  md: "6px"
  pill: "999px"
spacing:
  row: "10px"
  gutter: "12px"
  rule: "16px"
  block: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.eye-gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.eye-gold-lit}"
    textColor: "{colors.gold-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.read-grey}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-secondary-hover:
    textColor: "{colors.bone-bright}"
  index-row:
    backgroundColor: "transparent"
    textColor: "{colors.bone-line}"
    padding: "16px 0"
  index-row-hover:
    textColor: "{colors.eye-gold}"
  ledger-row:
    backgroundColor: "transparent"
    textColor: "{colors.bone-line}"
    padding: "10px 0"
  header-chip:
    backgroundColor: "{colors.panel-slate}"
    textColor: "{colors.read-grey}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
---

# Design System: wolfpack.quest

> **`CLAUDE.md` at the repo root remains the authority for this project**, and
> `docs/PRODUCT.md` holds product truth. This file records the *visual system as
> shipped* — nothing more. Where it disagrees with CLAUDE.md about architecture,
> routing, or policy, CLAUDE.md wins. It lives under `docs/` for that reason;
> a DESIGN.md at the repo root would read as outranking the handoff file.
>
> Recorded 2026-08-28 from the shipped landing-page build (`web/app/page.tsx`,
> `web/components/WolfPack.tsx`, `web/components/PlateIcons.tsx`,
> `web/app/globals.css`, `web/app/layout.tsx`, `web/tailwind.config.ts`). Every
> value below was read out of that code, not out of the direction contract.
> Where the two differ, the code is documented and the difference is stated.

## Overview

**Creative North Star: "The Engraved Specimen Plate, Inverted onto Night"**

A nineteenth-century natural-history plate — bone-white line, symmetric frontal
subject, hairline rules, no colour but the one that matters — printed in
negative on the near-black ground the audience is already staring at. The wolf
is drawn as a specimen rather than a logo, because the product's claim is that
this guild instruments itself, and the wolf is the first thing it measured.
Below the plate, the page stops being a plate and becomes a ledger: named
bosses, real timestamps, real damage figures.

Density is editorial, not dashboard. Content sits on horizontal hairline rules
in a single column; there are no filled cards on the landing surface and no
boxes drawn around prose. The register is quiet — bone line on night ground,
one gold — with all of the page's tension held in a single accent and a single
authored motion.

**Dark-only, and this is not a stylistic default.** The audience reads this at
night, on a second monitor, beside a dark EverQuest client, and every other
surface of the platform (Mimic's overlays, the agent's local dashboard, the
Discord bot's embeds) is dark. There is no light theme in the build and none
should be added; a light mode would be the only surface in the platform that
does not match the game window next to it.

**Key Characteristics:**
- Bone line (`#e8e2d4`) on night ground (`#0d1117`); one reserved gold.
- Prata for the plate voice, Faustina for prose, mono only for measurement.
- Hairline rules and editorial indexes — never a grid of identical cards.
- Hand-authored SVG bezier art; no raster, no stock, no emoji.
- Exactly one authored motion on the page; everything else is a colour fade.
- Type is centred on the plate's symmetry axis in the hero, flush-left below it.

## Colors

A four-value greyscale ladder with a single warm accent; every chromatic token
beyond the accent is a status colour inherited from the platform, not a brand
colour.

The palette tokens in `web/tailwind.config.ts` are **pre-existing and shared
with the agent's local dashboard** (`WEB_HTML` in
`packages/wolfpack-logsync/index.js`), so that the site and the in-raid
dashboard read as one product. The redesign committed to those tokens rather
than inventing a palette; the only additions are the two bone tones and the
wolf's interior fill, which the plate needed and the dashboard does not have.

### Primary
- **Eye Gold** (`#d29922`): the wolf's irises, live data figures (damage totals
  in the kill ledger), the primary call to action, and every interaction cue —
  hover text, hover borders, the focus-visible ring, the caret, `accent-color`,
  the scrubber thumb on `/ai`. It is the only warm thing on the page.
- **Lit Gold** (`#e0a92c`): the primary button's hover fill, and nothing else.
- **Gold Ink** (`#1a1206`): text *on* gold. Near-black with a brown cast so the
  label sits in the gold rather than punching a hole through it.

### Neutral
- **Night Ground** (`#0d1117`): page background everywhere, and the scrollbar
  track. Also the ring colour cut around the scrubber thumb.
- **Panel Slate** (`#161b22`): filled chrome only — header chips, admin surfaces.
  It does not appear on the landing page's content column.
- **Hairline** (`#30363d`): every rule and border, and the scrollbar thumb.
  Section rules run at 70% of it, row rules at 40%.
- **Bone Bright** (`#f2ede1`): the display headline and section headings.
- **Bone Line** (`#e8e2d4`): the wolf's stroke (via `--wolf-line`), index-entry
  names, and boss names in the ledger.
- **Read Grey** (`#c9d1d9`): default body text.
- **Dim Grey** (`#6e7681`): timestamps, supporting lines under an index entry,
  icons at rest, footer, secondary links.

### Secondary
- **Link Blue** (`#58a6ff`) / **Accent Blue** (`#1f6feb`): the platform-wide
  link colour and the download-CTA fill in the shared header. The landing
  page's content column deliberately uses neither — its links are undecorated
  and resolve to gold on hover instead.

### Tertiary
- **Live Green** (`#56d364`), **Alarm Red** (`#f85149`), **Warn Orange**
  (`#ffa657`), **Class Purple** (`#a371f7`): status semantics on data surfaces
  (alive/dead, over/under, class colouring). Never decoration, never brand.

### Named Rules
**The Reserved Gold Rule.** `#d29922` is spoken for. It belongs to three things
and nothing else: the wolf's eyes, values that came from the live database, and
the surface responding to the user's pointer or keyboard (hover, focus,
selection, caret). If a new element wants gold, it must be one of those three.
Audit test: cover the gold on a screen — if anything decorative disappears,
it was wrong.

**The Blue Stays Outside Rule.** Blue is platform chrome (header CTAs, footer
links, the global `a` colour). Inside an editorial column, links carry no colour
and no underline at rest; they announce themselves by going gold under the
pointer.

**The Status-Colour Firewall Rule.** Green/red/orange/purple mean a state in the
data. Never use one to make a heading interesting.

## Typography

**Display Font:** Prata (400 only), fallback Georgia, serif — a Didone. High
stroke contrast and flat, unbracketed serifs: the voice of an engraved plate.
**Body Font:** Faustina (400/600), fallback Georgia, serif.
**Label/Mono Font:** Cascadia Code → Consolas → `ui-monospace`.

**Character:** A Didone doing the announcing and a warm text serif doing the
explaining. Both are new to the platform with this build; the mono was already
here and is being *narrowed*, not retired.

### Hierarchy
- **Display** (Prata 400, `clamp(2rem, 7vw, 4.25rem)`, line-height 1.04,
  tracking `-0.02em`, `text-balance`, max `18ch`): one per page, the hero
  headline only. Two short lines with an authored break, not a paragraph.
- **Headline** (Prata 400, 1.25rem): section headings above a hairline-ruled
  block ("Last six kills", "The whole platform").
- **Title** (Prata 400, 1.125rem): the name of an entry in an editorial index.
- **Body** (Faustina 400, 1.0625rem / 1.75rem, max `58ch`): lead paragraphs.
- **Body Small** (Faustina 400, 0.875rem / 1.5rem, max `68ch`): the explanatory
  line under an index entry; footnote paragraphs.
- **Data** (mono, 0.875rem, `.tnum`): damage figures and any column of numbers
  that must align down the page.
- **Label** (mono, 0.75rem): timestamps, "all parses →", chrome, footer.

### Named Rules
**The Mono-Is-Measurement Rule.** Mono appears where the content *is* a
measurement — damage, counts, durations, timestamps, tabular columns — and
nowhere else. Mono as a costume for "this is technical" is out. Any number in a
column that a reader will compare to the number above it also takes `.tnum`.

**The One Display Line Rule.** Prata is set once at display size per page.
Everything else it touches is a short heading. It is a headline face, not a
body face, and it is never set below ~1.1rem.

**The Prose Measure Rule.** Prose is capped by `ch`, not by container width:
`58ch` for a lead, `68ch` for a supporting line, `18ch` for a display headline.

**Known divergence.** `<body>` still carries `font-mono` in
`web/app/layout.tsx`, so mono remains the *inherited* default for every surface
that has not opted into `--font-prose`. The landing page opts in per element.
New editorial surfaces must set the prose or display variable explicitly; do
not rely on inheritance, and do not read the body default as a licence to leave
prose in mono.

## Layout

One centred column, `max-w-7xl`, padded `12px` (`16px` at `sm`). The landing
page's content is a single column with no internal grid; the hero is allowed to
break the padding (`-mx-3 / -mx-4`) so the plate goes full-bleed while the type
stays inside the measure.

**Vertical rhythm** is built from three numbers: `24px` between a section's rule
and its content (`pt-6`), `32px` between sections (`mt-8`), and a `40–56px`
band of breathing room under the hero. Every major section opens with a
`border-t` hairline at 70% opacity — the rule is the section marker; there is no
background change and no card.

**Row rhythm** inside a ruled list: `10px` vertical padding for a dense data
row (the kill ledger), `16px` for an editorial index entry with a description
line. Rows are separated by hairlines at 40% opacity, and the last row drops
its rule (`last:border-0`) so the block ends on content, not on a line.

**Horizontal gaps** step `12px` (`gap-3`) for button clusters and `16px`
(`gap-4`) between an icon or label and its text.

**Responsive behaviour** is driven by the plate. The hero's top padding is a
function of viewport width, not a breakpoint ladder — `62vw` on phones, `42vw`
from `sm`, and a fixed `26rem` from `lg` where the plate stops growing. The
plate itself is `150%` of the column on phones and `112%` from `sm`, capped at
`1040px`, so the ears are never clipped at any width. Wide fixed-width content
(the platform map, `min-w-[760px]`) scrolls horizontally inside its section
rather than forcing the page to.

### Named Rules
**The Hairline Index Rule.** A list of destinations is an editorial index on
hairline rules: icon, name, one sentence. It is never a grid of same-size cards
with an icon, a heading and a paragraph in each. That grid is the category
default this site refuses.

**The Axis Rule.** Type that sits under a symmetric, frontal object is centred
on that object's axis. Left-aligned type beside a centred wolf reads as two
unrelated objects. Everything below the plate returns to flush left.

## Elevation & Depth

**There are no surface shadows.** No card, button, panel or dialog on this
system casts one. Depth is tonal and atmospheric: two ground values
(`#0d1117` page → `#161b22` chrome panel) plus hairline borders do all of the
structural work.

The only shadows in the build belong to the plate, where they are atmosphere
rather than elevation, plus one focus ring.

### Shadow Vocabulary
- **Plate lift** (`drop-shadow(0 18px 42px rgba(0,0,0,.55))`): on the alpha
  wolf only. Seats the specimen on the ground without drawing an edge.
- **Eye glow** (`drop-shadow(0 0 9px rgba(210,153,34,.75))`): on the alpha's
  irises only. The eyes are the one lit thing on the plate.
- **Ring focus** (`box-shadow: 0 0 0 4px rgba(88,166,255,.45)`): the `/ai`
  scrubber thumb's keyboard focus. Everything else uses the outline ring below.

**Atmospheric depth (the pack).** Distance is expressed by four coupled
variables at once — scale (0.62 → 0.38), opacity (0.46 → 0.24), blur (1.1px →
2.6px) and a bottom-fading mask — never by opacity alone.

### Named Rules
**The No-Shadow Rule.** Surfaces are flat. If something needs to separate from
what is behind it, give it a hairline or a tonal step, not a shadow. Hard offset
shadows are not part of this world at any size.

## Shapes

Corners are small and consistent: `6px` on buttons and the wordmark tile, `4px`
on chrome chips, `2px` on the focus ring, `999px` on the one slider. Nothing on
this system is a circle except the clock face inside an icon, and nothing is
fully square except a rule.

**The drawn mark** is the system's real form language. All artwork is
hand-authored SVG path data (bezier + polyline) committed as source. Icons are
uniform strokes; the wolf is filled tapering forms — the two are deliberately
different registers, and the wolf's taper is what gives a carved mark its
weight:

- **Icons** (`PlateIcons.tsx`): one `20×20` grid, one stroke weight (`1.5`),
  round caps and joins, `fill: none`, `stroke: currentColor`. Six of them
  (bars, clock, blades, star, map, spark). They inherit their colour from the
  row they sit in — dim at rest, gold on hover.
- **The wolf** (`WolfPack.tsx`): a `400×400` frontal skull drawn as a **left
  half only**, then mirrored with `translate(400,0) scale(-1,1)`. The two sides
  cannot drift because there is only one authored side. Centre furniture (the
  nose) is authored once and never mirrored. **Nothing in the wolf is a
  stroke.** Every shape is a closed, filled, tapering form — the head contour is
  a ribbon that runs down the outer edge and back up the inner edge, swelling
  through the cheek and narrowing to a point at the ear tip and chin; the ruff
  is three faceted spikes; the brow, eye and inner ear are solid wedges. Ink
  layers: primary ink (contour, inner ear, brow) at full bone, secondary ink
  (snout, cheek, mouth) at 75%, the gold eyes, the nose as the darkest mass.
  Pack members drop the secondary layer entirely so they stay legible at 0.38
  scale under blur.

### Named Rules
**The Authored-Mark Rule.** Artwork on this system is drawn in code as SVG path
data and committed. No raster hero images, no stock photography, no generated
imagery — and note that **no image-generation capability exists in this build
environment**, so a design that needs a bitmap cannot ship. If a new surface
needs an image, it needs a new drawing in the same grid and stroke weight.

**The Mirror Rule.** Anything symmetric is authored once and mirrored. Symmetry
is a property of the source, not a thing to be maintained by hand.

## Components

### Buttons
- **Shape:** gently rounded (`6px`), no shadow, no gradient.
- **Primary:** solid Eye Gold with Gold Ink text, `10px 20px`, semibold,
  `0.875rem`. One per view — it is the sign-in / "your record" action.
- **Hover:** fill shifts to Lit Gold via `transition-colors` (150ms). Nothing
  moves; there is no lift, no scale.
- **Secondary:** transparent with a hairline border and Read Grey text. On
  hover the border goes gold and the text goes Bone Bright. Same size as
  primary so the pair reads as one cluster.
- **Focus:** the global `2px` gold `focus-visible` outline at `2px` offset.
  Never removed, never restyled per component.

### Chips (header chrome only)
- Panel Slate fill, hairline border, `4px` radius, `4px 10px`, `0.75–0.875rem`.
- Hover lightens the fill to `#21262d`. Used for Feedback / OpenDKP / Admin and
  the download CTAs; not part of the editorial vocabulary.

### Cards / Containers
- **There are no cards on the editorial surfaces.** A section is a `border-t`
  hairline at 70%, a Prata heading, and content. No fill, no radius, no border
  box. Filled containers exist only in chrome (`panel`) and on data-dense admin
  pages.

### Navigation
- Global header in three strips: wordmark + account block, download CTAs +
  timezone, then the primary nav on its own strip above a hairline. Chrome type
  is mono at `0.75–0.875rem`. Links are undecorated with a colour hover.

### Editorial Index Entry (signature)
An icon at `20px` in Dim Grey, a Prata `1.125rem` name in Bone Line, and one
Faustina `0.875rem` sentence in Dim Grey, on a `16px`-padded row between 40%
hairlines. The whole row is one link; on hover the icon and the name go gold
together via a `group-hover` — one gesture, two elements, no background change.

### Live Ledger Row (signature)
Boss name in Faustina (Bone Line), a mono timestamp in Dim Grey beside it, and
the damage figure right-aligned in mono `.tnum` Eye Gold. Baseline-aligned,
`10px` rows, 40% hairlines. This is the component that carries the Reserved
Gold Rule's second clause: the gold in this row is gold *because the number
came from the database*.

### The Wolf Plate (signature)
Full-bleed square stage behind the hero. The alpha is present at full opacity on
arrival. Five pack members are absolutely positioned behind her at ±26%, ±44%
and 0% of the stage width, 6–14% down, and surface via `wolf-surface` — 1.5s,
`cubic-bezier(.16, 1, .3, 1)`, staggered `0.35s / 0.55s / 0.80s / 1.00s /
1.25s` — animating opacity, blur *and* a lifting mask together. A vertical
gradient scrim (`transparent → bg/70 at 55% → bg`) sits between plate and type:
transparent across the ears and eyes, opaque where the headline lands.

### Browser Surfaces
The parts we did not draw still carry the design, and they are themed globally:
- Selection: gold at 28% with Bone Bright text.
- Caret and `accent-color`: Eye Gold.
- `:focus-visible`: `2px` gold outline, `2px` offset, `2px` radius.
- Scrollbars: `11px`, Hairline thumb on Night Ground track with a `3px` track
  border to inset it; thumb lightens to `#4a5560` on hover. Firefox gets
  `scrollbar-color` + `scrollbar-width: thin`.
- `.tnum`: tabular numerals, applied to any figure in a column.

### Named Rules
**The One Authored Moment Rule.** A page gets exactly one piece of real motion.
Here it is the pack surfacing. Everything else is a 150ms colour transition on
hover. The hero never assembles itself — the alpha and the headline are present
on the first paint, because a visitor should not wait to read the offer.

**The Reduced-Motion-Keeps-Content Rule.** Under `prefers-reduced-motion:
reduce`, the pack renders *already surfaced* at its final opacity and blur — it
is not removed. Motion is removed; content never is. Everything else on the
site drops to `transition: none`.

**The Emerge-Don't-Fade Rule.** Something arriving from depth resolves blur and
lifts a mask as well as gaining opacity. Opacity alone reads as a fade, not as
distance.

## Do's and Don'ts

### Do:
- **Do** build every new surface dark on `#0d1117`. There is no light theme.
- **Do** reserve `#d29922` for the wolf's eyes, live data values, and
  interaction state (hover / focus / selection / caret).
- **Do** pair Prata for headings with Faustina for prose, and set the font
  variable explicitly (`var(--font-display)` / `var(--font-prose)`) rather than
  inheriting the body default.
- **Do** use mono only where the content is a measurement, with `.tnum` on any
  figure that sits in a column.
- **Do** separate sections with a `border-t` hairline at 70% and rows at 40%,
  and drop the last row's rule.
- **Do** cap prose by measure (`58ch` lead, `68ch` supporting, `18ch` display).
- **Do** draw new icons into the same `20×20` grid at stroke `1.5` with round
  caps, `fill: none`, `stroke: currentColor` — and draw new *plate* artwork as
  filled tapering forms, never as uniform-width strokes.
- **Do** hover a whole row as one gesture with `group-hover`, moving icon and
  name to gold together.
- **Do** give reduced-motion users the finished composition, not an emptier one.

### Don't:
- **Don't** add a light theme, or a `prefers-color-scheme: light` branch.
- **Don't** build a grid of same-size cards each carrying an icon, a heading and
  a paragraph. Use the hairline index.
- **Don't** put a kicker or eyebrow line above a heading. The build has none;
  headings start at the heading.
- **Don't** use emoji as an icon on any editorial surface — draw it. (Emoji
  survive in the legacy global header; see below. They are not the pattern.)
- **Don't** add shadows to surfaces. Depth is tonal steps and hairlines.
- **Don't** ship a raster image as artwork. Draw it as SVG path data, mirrored
  from one half if it is symmetric.
- **Don't** animate the hero in. The primary message is present on first paint.
- **Don't** spend gold on decoration, or spend a status colour (green/red/
  orange/purple) on anything that is not a state in the data.
- **Don't** set prose in mono because the subject is technical.
- **Don't** put a coloured, underlined link inside an editorial column; links
  there are undecorated and resolve to gold on hover.

## Not canonized

Recorded here as defects the build carries, deliberately **not** written into
the rules above:

1. **Emoji glyphs in the global header and elsewhere in chrome** — `💬 Feedback`,
   `💰 OpenDKP`, `🛡️ Admin` in `app/layout.tsx`, and `✨` in the tour launcher.
   These predate the redesign and directly contradict the drawn-icon rule the
   landing page adopted. They are a queued replacement (six-icon set in
   `PlateIcons.tsx` is the target vocabulary), not house style.
2. **`font-mono` on `<body>`** — mono is still the inherited default for the
   whole site. The Mono-Is-Measurement rule is the system; the body default is
   the legacy state it is migrating away from.
3. **Contract-vs-build divergence on gold.** The direction contract reserves
   `#d29922` for "the eyes and live data and nothing else". The shipped code
   also spends it on the primary CTA fill, every hover and focus state, the
   caret, `accent-color`, selection, and the `/ai` scrubber. The build is
   documented: gold covers eyes, live data, **and interaction**. That third
   clause is real and load-bearing, and a future surface should follow the code.
