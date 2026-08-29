# DESIGN.md — wolfpack.quest

⚠ **`CLAUDE.md` at the repo root remains the authority.** This file records the
*visual system* only. Where they disagree about architecture, routing or policy,
CLAUDE.md wins. Machine-readable tokens live in `.impeccable/design.json`; this
is the prose half, and it describes **what shipped**, not what was intended.

⚠ **Rewritten 2026-08-28 because the generated file was unusable** — 357,109
lines, one paragraph repeated 23,774 times, once per character of a string some
loop walked. It also still asserted the eye slits were transparent, which is
false and had already caused a shipped bug. Do not restore it from git.

## Ground

Dark is not a style choice: the audience reads this beside a dark game client,
at night, and every other surface of the platform is dark.

| Token | Value | Use |
|---|---|---|
| `bg` | `#0d1117` | page ground; also the wolf silhouette fill |
| `panel` | `#161b22` | cards, chips |
| `border` | `#30363d` | hairlines |
| `text` / `dim` | `#c9d1d9` / `#6e7681` | prose / chrome |
| bone | `#e8e2d4`, bright `#f2ede1` | the wolf, headlines |
| gold | `#d29922`, lit `#e0a92c` | the one accent — eyes, primary action, focus |

Gold is the only accent that carries meaning. Blue (`#1f6feb`) stays the
interactive/system colour it already was elsewhere in the app.

## Type

- **Display — Prata.** Hero headline only, one per page, centred on the wolf's
  symmetry axis, capped at 18ch with `text-balance`. Left-aligned type beside a
  centred symmetric mark reads as two unrelated objects; the first render
  proved it.
- **Prose — Faustina.** Lead paragraphs at 58ch, supporting lines at 68ch.
- **Chrome — mono.** Timestamps, labels, footer. Numeric columns use `.tnum`.

## The wolf

`components/WolfPack.tsx` + three plates in `web/public/`, all `973×973` on the
same canvas so none carries geometry of its own and none can drift:

| Plate | What it is |
|---|---|
| `wolf.png` | the mark — bone `#e8e2d4` on transparency |
| `wolf-solid.png` | its filled silhouette in the page ground |
| `wolf-eyes.png` | the two eye interiors, painted gold |

The mark was generated from a repo-authored prompt and keyed in-repo; the other
two are computed from it, not drawn. `public/wolf.provenance.txt` records all
three, and shipping any of them without that file is a defect.

**⚠ The eye slits are NOT transparent.** Keying cut the dark *linework* to alpha
0 and left the eye interior opaque bone. An earlier version of this file claimed
the opposite, and a glow built on that claim shipped lighting the brow instead
of the eye. The gold is painted **on top**, cut to the eye interiors found by
connected-component labelling of the alpha channel. The pupil is a hole and
stays dark.

**⚠ Depth is `brightness()`, never `opacity`** — brightness darkens the bone
while leaving alpha intact, so a nearer wolf occludes the one behind it. Fading
with opacity made the pack read as ghosts.

**⚠ Brightness alone is not enough.** Every dark line in the art is a hole —
121,313 px of them — so a wolf in front showed the wolf behind through its own
linework. Each wolf gets `wolf-solid.png` beneath its plate: invisible against
the ground, and the whole difference where two wolves overlap.

Five pack members fan to ±45% at 0.38–0.63 scale, which makes the composition
1.35× the alpha's box. That bleed is intended and is clipped at the section
(`overflow-x: clip`, not `hidden`); her width, not a tighter fan, is the lever
that keeps the pack's eyes clear of her ruff on a phone.

## Motion

One sequence, and it is the page's only authored moment: eyes in the dark →
the pack's eyes → the alpha's lines resolve → each pack member, nearest first.
Everything that is not the wolf waits one beat and fades in behind her.

The reveal filter is scoped to `.wolf-plate`. Written as `.wolf-alpha img` it
also matches the eye glow, and the eyes can never open before the body — that
shipped too.

Every rule above has a matching assertion in `test/wolf-eyeglow.test.js`,
because each of them looked fine on screen while being wrong.

`prefers-reduced-motion` keeps the whole composition and removes only the
motion: the pack is content, not decoration, so it arrives already lit rather
than being removed.

## Navigation

Four doors — Raid, Stats, Prep, and the member's own `/me`. Hover opens on fine
pointers, tap opens elsewhere; the open state is guarded on
`matchMedia('(hover: hover) and (pointer: fine)')` because a tap's compatibility
`mouseenter` plus the click otherwise open and immediately close the panel.
Grouping is a judgment call and Hitya reclassifies it freely — nothing is
load-bearing beyond the label.

## Surface modes

The landing page is **Persuade**; every signed-in data surface is **Operate**
and inherits the app's existing conventions rather than this page's expression.
Mimic's overlays are a different world entirely — see the `frontend-design`
skill, which wins over generic design guidance for anything read mid-raid.
