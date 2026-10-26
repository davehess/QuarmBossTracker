// Where a hover card goes, in viewport (position: fixed) coordinates. Pure, so a test can run it.
//
// The card is centred over its trigger and sits ABOVE it; when there is no room above it flips BELOW, and it is
// clamped inside the viewport on every side so it can never be cut off by the window edge. Used by the item hover
// card (web/app/character/[name]/inventory/ItemHover.tsx), which draws in a portal on <body>.

export type Box = { left: number; top: number; right: number; bottom: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

export function placeTip(
  trigger: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  margin = 8,
): { left: number; top: number; below: boolean } {
  const centre = (trigger.left + trigger.right) / 2;
  const left = clamp(centre - tip.width / 2, margin, view.width - tip.width - margin);
  const above = trigger.top - tip.height;
  const below = above < margin;
  const top = clamp(below ? trigger.bottom : above, margin, view.height - tip.height - margin);
  return { left, top, below };
}
