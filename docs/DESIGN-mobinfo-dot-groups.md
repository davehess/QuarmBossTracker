# DESIGN — Target Info: DoTs grouped by class (Hitya, 2026-08-16)

**The ask:** *"can we group dots by class from now on and have them be
minimized with a damage per tick total shown per line and totalled by class
when collapsed."* (Target Info / Mob Info's landed-on-target list, beta.)

## The finding that shapes the design

**The spells mirror carries no class data at all.** `eqemu_spells.raw` holds
only `eff/max/base/formula` — the eqmac dump the weekly sync pulls omits the
class columns entirely (same gap family as the item haste/regen columns that
needed the 2026-07-11 local-DB backfill). So "group by class" cannot come from
the spell catalog today. Two paths:

1. **Group by the OBSERVED CASTER's class** (recommended, works now): the
   agent's cast-correlation already ties many landings to who cast them, and
   caster→class resolves from roster/who data the agent already holds. This is
   also what raiders MEAN — "necro dots" is about the necros. Rows without a
   correlated caster group under "Unattributed."
2. **Backfill spell→class into the mirror from the local `peq` DB** (the
   eqemu_items precedent — ⚠ needs a local session): enriches path 1 so even
   uncorrelated landings can class-group by the spell itself.
3. **Same local backfill should ALSO pull `dot_stacking_exempt`** (Hitya
   2026-08-16, from Partil's bug-reports post quoting Quarm's
   buffstacking.cpp:654): the server flag that says whether a DoT stacks with
   ITSELF across casters (0 = stacks, the Luclin change — Immolate; 1 = does
   not — Breath of Ro). The mirror carries it nowhere (no column, no `raw`
   key — verified against both example spells). Two consumers: the target
   debuff list must keep PER-CASTER instances for flag-0 DoTs (today the
   second caster's land overwrites the first, which then reads "fell off"
   while still ticking), and this design's per-tick totals are only honest if
   N casters of a stacking DoT means N× ticks. Exact pull:
   `SELECT id, dot_stacking_exempt FROM spells_new;` from the local peq
   MariaDB → sync-proof addendum column. ⚠ PEQ-flavored data vs Quarm tuning:
   spot-check against PQDI at backfill time; Partil's pair (Immolate=0,
   Breath of Ro=1) are the free test vectors.

## The per-tick number: measured beats computed

Two candidate sources for "damage per tick":
- **Catalog estimate**: |base| of the HP effect (SPA 0) on a timed spell,
  formula-scaled the way the DS values already are. Available for every spell;
  wrong when resists/level scaling bite.
- **Measured**: the agent already parses DoT ticks and attributes them to
  casters for the damage meter — the ACTUAL tick value of this DoT on this
  mob is in the live fight data. Exact, but only present once ticks land.

Recommendation: **measured when ticks have landed, catalog estimate before
then**, with the estimate visually marked (~). The class total when collapsed
sums whatever each line is currently showing.

## UX (mobinfo.html, beta)

- DoT rows (detrimental + has a tick value) group under class headers;
  non-DoT buffs/debuffs render exactly as today.
- Collapsible per class. Collapse state in a JS store consulted at render,
  localStorage-backed — NEVER DOM state (#content repaints; the wpKeep rule).
  Carets always drawn and merely dimmed (the repaint hover rule); every
  clickable carries the hover-interact handshake.
- Line: `Envenomed Bolt · Uilnayar · 91/tick · 0:48`
- Collapsed: `▸ Necromancer ×3 — 273/tick` (sum of the visible per-line
  values; count keeps the header honest).

## Plumbing

- Agent decorates each `target_buffs` row with `{ caster, cls, tick }` where
  known (correlation + roster class + measured-tick join). Overlay stays a
  pure renderer.
- If the local-session class backfill lands later, `cls` fills in for
  uncorrelated rows with no overlay change.

**Effort:** ~3–4h agent+overlay (beta) + optional local-session backfill.
Queued behind the Sentinel build (task #42); this is task #44.
