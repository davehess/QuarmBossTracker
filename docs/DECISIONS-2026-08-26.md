# Decisions — 2026-08-26

## PoP page: My Characters tab, and default views scope to mains (Hitya)

> "let's have a my characters mode on the pop page for individuals can track
> all of their characters in one place. due to the nature of pop flagging
> they may do it for many of their toons and we shouldnt only track mains.
> we should default our views to mains"

Two calls, opposite directions, both land in `web/app/pop/page.tsx`:

1. **Guild-wide surfaces (chart, matrix, planner, "PoP spells ... still
   need") default to `?scope=mains`**, with a one-click toggle to
   `?scope=all`. That's the number an officer planning a raid night wants —
   how many MAINS can walk into a zone tonight — without alts inflating or
   deflating it.
2. **A new `?view=mine` tab ignores scope entirely** and always shows every
   character linked to the viewer's account (`ownedCharacters()`, same helper
   `/me`'s inventory page uses) — main and alt alike, same table shapes as
   Matrix (zone access) and the spell-needs table, plus which of their
   characters have no spellbook on file yet (a distinction the guild-wide
   table can't make in aggregate — see its long-standing "nothing missing, or
   nothing submitted" hedge, unchanged, it just doesn't apply per-character
   the way `?view=mine` can afford to check).

**Required widening `pop_spell_needs` off main-only** (migration
`20260826010000_pop_spell_needs_all_characters.sql`) — it now returns every
non-deleted, non-excluded character with a submitted spellbook (main or alt)
and an `is_main` column per row, so the mains-default and the My Characters
view both read the same RPC and just filter differently. Signature changed
(new column) → dropped and recreated, same pattern as every prior
`pop_spell_needs` revision.

### ⚠ The widening exposed a real perf bug, not caused by widening itself
Going from 28 mains to 117 eligible characters (4.2×) turned a latent problem
into a reproducible 60s+ hang calling the function directly: the per-character
level lookup was a **correlated subquery against `who_directory`** — a view
with six `DISTINCT ON` / `GROUP BY` passes over the full `who_observations`
table (120k+ rows), not materialized. Postgres can't push a character filter
below those passes, so *every row* of the candidate set re-ran the entire
view — measured at 267k buffer hits for one run; ×117 ≈ 31M. Fixed with a
plain `LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)`
instead of `(SELECT MAX(w.level) FROM who_directory w WHERE ...)` — the view
computes once, characters hash-join against it. Verified against prod:
1.185s end-to-end for all 2,550 output rows. `who_directory` already returns
one row per character (its own internal `DISTINCT ON`), so the join is exact,
not an approximation of the old `MAX()`.

**Lesson for next time a guild-wide RPC's input set gets widened**: if it
touches `who_directory` (or any other unmaterialized multi-pass view) via a
correlated subquery, check whether the row count multiplier turns a "fine at
N" query into "broken at 4N" *before* shipping — `EXPLAIN ANALYZE` on the
inlined function body (not the wrapped `SELECT * FROM fn(...)` call, which
Postgres treats as an opaque black box and won't show the real plan) is what
caught this.

Shipped: web 1.1.97, migration applied + committed, `test/pop-spell-needs-all-characters.test.js`
(9 cases) guards both the mains-only-filter removal and the join-not-subquery
fix so neither regresses silently. Full test suite green (2,340 passed),
`tsc --noEmit` clean.

---

## Open — read this first

⚠ **This table lagged three days (2026-08-21, -24, -25 shipped without
refreshing it)** — carrying forward only what this session can directly
confirm true right now. For anything not listed here, `DECISIONS-2026-08-20.md`
is the last verified snapshot; treat items there as unconfirmed until a
session re-checks them.

| Item | State |
|---|---|
| **`OPENDKP_HALT=1` is still ON** | Set 2026-08-25 after OpenDKP's owner (Moncs) reported $200+/mo API Gateway costs from our traffic. Root cause fixed + shipped (bot 3.1.71–3.1.72: fan-in auction cache, `/auctions/active`, outbound governor) — see `DECISIONS-2026-08-25.md`. **Stays on until Moncs unblocks our Railway IP and we confirm the new volume is sane.** Flip before the next raid (Wed 8pm ET) or bidding is dead that night |
| **PoP page: this session's `?view=mine` + mains-default scope** | Shipped clean (web 1.1.97, migration `20260826010000` applied). No open follow-up |
| **Everything from `DECISIONS-2026-08-20.md`'s table** | Not re-verified since — re-check before treating as current (raid-night items especially age fast) |

