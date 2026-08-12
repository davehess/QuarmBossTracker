---
name: frontend-design
description: Visual design guidance for any UI in this repo — wolfpack.quest pages, Mimic overlays, and the agent dashboard. Use when building a new page or surface, reshaping an existing one, or making choices about palette, typography, layout, or motion. Carries this platform's real design tokens and the mid-raid constraints that generic design advice does not know about.
---

# Designing UI in this repo

Adapted from Anthropic's `frontend-design` skill
(github.com/anthropics/skills/tree/main/skills/frontend-design), which is worth
reading in full. This file keeps its method and adds what it cannot know: the
tokens this platform already uses, and the fact that most of these screens are
read by someone being hit by a dragon.

## The method (from the upstream skill)

**Two passes, and the second one is the point.**

1. **Plan tokens before writing code.** Colour (4–6 named values), type (at least
   two roles), layout (prose + rough wireframe), and ONE signature element that
   embodies the brief.
2. **Critique the plan against the brief BEFORE building.** Ask specifically
   whether it has collapsed into a generic default. Only then write code.

Its other load-bearing ideas: ground choices in the subject's own world; let
structure encode real information (only number things if order genuinely
matters); spend boldness in exactly one place and keep everything around it
quiet; treat copy as design material, written from the reader's perspective;
remove one accessory before you finish.

The three defaults it says to avoid: cream + high-contrast serif + terracotta;
near-black + acid-green; and the hairline-ruled broadsheet. Add a fourth for
this repo: **do not introduce a second visual language.** See below.

## This platform's tokens — already decided, already shared

Verified 2026-08-12 in `web/tailwind.config.ts` and grepped across surfaces:
the same hex values appear in the Next.js app, the agent's local dashboard
(`WEB_HTML`), and every Mimic overlay. That cross-surface consistency is a real
asset — the guild sees one product across a website, a desktop app and a
localhost dashboard. Do not fork it per surface.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0d1117` | page ground |
| `panel` | `#161b22` | cards, rows |
| `border` | `#30363d` | hairlines, dividers |
| `text` | `#c9d1d9` | body |
| `dim` | `#6e7681` | secondary, timestamps |
| `blue` | `#58a6ff` | links, primary action, cast bars |
| `gold` | `#d29922` | roll values, highlights |
| `green` | `#56d364` | success, healthy |
| `red` | `#f85149` | danger, deaths, conflict |
| `orange` | `#ffa657` | warning |
| `purple` | `#a371f7` | rare/special |
| `accent` | `#1f6feb` | selected state |

**Type is monospace everywhere** — `Cascadia Code, Consolas, ui-monospace`,
applied on `<body>`. That is the single strongest identity signal the platform
has, and it is doing real work: these screens are mostly numbers in columns
(damage, HP percentages, roll values, timers), and a monospace grid makes those
scannable in a way a proportional face cannot.

**Open question, not for unilateral change:** the palette is essentially GitHub
Primer dark. It reads as a developer tool, not as a 1999 fantasy MMO — the
upstream skill would ask whether the identity comes from the subject's own
world. It does not. That may still be the right call (the audience is raiders
reading parse tables, and it matches the agent dashboard), but it is Hitya's
call, not a refactor to slip into an unrelated PR.

## What generic design advice gets wrong about this repo

**The reader is mid-fight.** Overlays are read in peripheral vision while
someone is tanking. That inverts several normal instincts:

- **Motion is a cost, not a delight.** An animation that draws the eye is
  stealing attention from the game. The one deliberate exception shipped so far
  is the CH cast bar, which fills right-to-left in blue because "it's confusing
  to see the countdowns going left to right on everything" (Hitya, 2026-08-11) —
  direction carrying meaning, not decoration.
- **Screen centre is sacred.** Callout chips grow UPWARD from the bottom
  specifically so they never creep into the middle of the screen. See
  `docs/DESIGN-trigger-overlay-v2.md` §3b.
- **Density beats whitespace.** A raider needs eight rows visible, not four with
  generous padding. When something must truncate, say so — a card that silently
  showed 4 of 8 rolls looked complete and was not.
- **Colour is semantic, never decorative.** Red means death or conflict. Gold
  means a roll value. If a new element needs a colour, ask what it MEANS first.

**Hard constraints that will break the build if ignored:**

- **Mimic overlays** — every emitted `<details>` must be built with `wpKeep(...)`
  or it snaps shut on every 2s repaint; section HTML must be byte-stable across
  polls or the whole section rewrites (flicker, lost scroll, reset forms). Any
  new overlay owes the full feature-parity checklist in `CLAUDE.md`: ✕ hide, ✥
  move with manual-drag IPC and right-click menu, the hover-interact handshake
  on every clickable control, a `WP_OVERLAY_ROWS` entry, an `apply*Visibility()`,
  and its flag in `_HIDEALL_FLAGS` and `_overlayEntries()`.
- **Agent dashboard** — the whole thing is one backtick template literal with two
  escape layers. Run `npm run check:dashboard` after ANY change to `WEB_HTML`.
- **`command.html` is authoritative** and mirrored into the agent; re-sync with
  `node scripts/sync-command-embed.js`.
- **Never put `class="name"` on a cell whose text is not a character name** — the
  click delegation slices to the first word and routes to `/character/<token>`.

## Where the boldness has already been spent

Per "spend boldness in one place", the platform's existing signature moments —
do not compete with these without a reason:

- **ORDER CONFLICT** — bright yellow on a red outline, the loudest thing on the
  CH chain overlay, because a doubled rotation kills the tank.
- **The monospace grid itself** across every surface.
- **Caution-tape hatching** on the threat meter when melee should back off.

## Before you finish

Responsive down to mobile (the site is read on phones between pulls), visible
keyboard focus, `prefers-reduced-motion` respected, and then remove one
accessory. If the new thing is an overlay, re-read the parity checklist — the
whole class of beta bugs was overlays missing exactly one item from it.
