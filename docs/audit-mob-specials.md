# Mob-info audit: our catalog vs PQDI (#173)

**Goal.** Make the Mob Info / Target Info overlay agree with pqdi.cc on the
combat facts raiders act on, for **every mob** (the overlay fires on any target
— trash, named, boss), across:

> can it **see invis** · can it be **pacified** · is it **rooted in place** or
> does it **run when low** · does it **enrage / rampage / summon** · is it
> **unslowable** · is it **unrootable / immune to movement-speed changes**

Our overlay reads these from `eqemu_npc_types` (the weekly Quarm mirror). This
audit does two things: a **full-catalog DB analysis** (all ~18k mobs — variant
picks, placeholders, decoder gaps) and a **PQDI diff** on a raid-boss sample to
confirm the semantics.

---

## Run it locally

```bash
# from the repo root
export SUPABASE_URL=https://zhtoekwakucbckvatfky.supabase.co
export SUPABASE_KEY="<anon or service-role key from your .env>"

# 1) FULL-CATALOG DB analysis (no PQDI, covers all ~18k mobs)
node scripts/audit-mob-specials.mjs --db-all
#    → mob-specials-all.csv        every mob decoded (flags, placeholder, cluster)
#    → mob-specials-clusters.md    same-name clusters that DISAGREE on danger flags
#    → mob-specials-summary.md     counts + the codes our decoder drops

# 2) PQDI diff for the 113 raid bosses (needs a machine that can reach pqdi.cc)
node scripts/audit-mob-specials.mjs
#    → audit-mob-specials-report.md
```

**Why the PQDI half is local:** `pqdi.cc` returns **HTTP 403** to the Claude
Code cloud proxy. Scraping all 18k mobs is also infeasible (~7.5h, rate-limited),
so PQDI is a **validation sample** (bosses) while `--db-all` covers everything.
If PQDI markup drifted, recalibrate once with `--dump 179037` (prints the page
text + the flag block the matchers look for).

---

## What the DB side already established (no PQDI needed)

Catalog = **18,033 mobs**, 16,992 with special-ability data, **14,511** distinct
names, **1,457** same-name clusters (size > 1).

1. **PQDI ids == our eqemu ids.** Every `pqdiUrl` in `data/bosses.json` resolves
   113/113 to a real `eqemu_npc_types.id`. Validates the #186 PQDI link, and
   lets the boss audit key off ids (bypassing the name-lookup entirely). ✅

2. **The same-name variant problem is real and large:**
   - **1,158 clusters contain a placeholder row** — a junk "immune to
     everything" body (special code `19` Immune-Melee + `20` Immune-Magic,
     usually level 1, e.g. `10^19^20^21^24^27^35`). This is the exact row the
     current `&limit=1` can grab instead of the real boss (the Itraer Vius bug).
   - **146 clusters DIVERGE on danger flags** among their *real* (non-placeholder)
     rows — some variants enrage/rampage/flurry, others don't. Examples from the
     catalog: **Maestro of Rancor** (L56 rampages, L53 doesn't), **Venril Sathir**
     (one variant is unslowable + rampages, another isn't), the class-split
     acolytes (Warrior variant enrages, Cleric variant doesn't). These are the
     rows the warning must **merge**, not pick-one-and-hope.

3. **"Rooted in place" and "runs when low" are invisible today.** The endpoint
   never selects `runspeed`, and the decoder ignores flee codes:
   - `runspeed = 0` → stationary / rooted (2 dozen+ raid targets: Itraer Vius,
     Yelinak, Vulak, Emperor Ssra, most NToV dragons).
   - code `37,<pct>` → flees at that % ("runs when low"); code `21` → won't flee.

4. **The decoder drops player-relevant codes present catalog-wide** (counts over
   all 18k mobs): `26` Immune-Ranged-Spells (182), `37` Flee-% (54), `36`
   Always-Flee (7), `44` Immune-Ranged-Attacks (192), `46` Immune-to-Pet/NPC-
   Damage (1,312 — matters for charm strats), `22` Immune-Melee-Except-Bane (72),
   `39` Disable-Melee (106). Codes `42`/`43`/`49` (1,768 / 258 / 235) are EQEmu
   combat-tuning internals PQDI almost certainly hides — the diff confirms.

---

## The fix: pick-and-merge, not pick-one (the #161/#171/#173 core)

The overlay's live path normalizes a target name and looks it up. Today that's
one row via `&limit=1` — which is why a placeholder or wrong variant wins. The
correct rule, per Hitya (2026-07-25): *"display the higher-level version, the one
with more variants, as the warning; the placeholders that had almost none were
wrong and are not a good warning."*

**Rule:**
1. Fetch **all** rows matching the normalized name (not `limit=1`).
2. Split into **real** rows vs **placeholder** rows (placeholder = immune to both
   melee `19` and magic `20` — can't be killed normally, so never the mob you're
   fighting).
3. If the overlay knows the **current zone** (it does — #141), prefer rows in it.
4. **Primary row** (drives name / level / HP): the **highest-level real** row.
   Fall back to a placeholder only if there is *no* real row (script-immune
   uniques like the Emperor — usually keyed by id anyway).
5. **Warning flags = UNION** of the danger flags (summon / enrage / rampage /
   flurry, and the immunities) across all **real** rows. Never union a
   placeholder's flags — its "immune to everything" would fabricate false
   Immune-Melee/Magic warnings.

`mob-specials-clusters.md` (from `--db-all`) is the worklist: each block already
shows the merged danger set and which rows are placeholders.

### Repo fix surface

- **Row-picker / merge** — `index.js` mob-info lookup (~**6612**, the
  `or=(name.ilike…)&…&limit=1`). Replace `limit=1` with an all-rows fetch +
  the pick-and-merge above. This is where #161-P1 (staged) and #171 (comb)
  converge — do it once, here. Zone scoping already exists from #141; reuse it.
- **Surface `runspeed`** — add `runspeed` to that select (~**6613**) and derive
  `rooted` / `flees` on the mob object (~**6850**); decode `37`/`21`/`36`.
- **Extend the decoder** — `index.js` `_MOB_SPECIAL_LABELS` (~**5380**): add the
  `show:true` codes the PQDI diff confirms (candidates 22/26/36/37/39/44/46).
  Mirror additions into the audit's `CODE`/`DECODED_BY_BOT` so runs stay honest.
  Folds into staged #55 (mob-immunity display + overlay badge).

The full code→flag map, the placeholder predicate, and the merge live in
`scripts/audit-mob-specials.mjs` — the script and the bot fix should share the
same table so they never drift.

---

## #171 SHIPPED (2026-08-02) — what was actually built

The rule above is implemented. Everything moved into **`utils/mobSpecials.js`**,
required by BOTH `index.js` (the live `GET /api/agent/mob-info`) and
`scripts/audit-mob-specials.mjs`, so the audit and the overlay can no longer
disagree about what a code means. The script's `CODE` / `DECODED_BY_BOT` /
`parseSpecials` / `isPlaceholder` are now aliases of the shared exports.

**Line anchors in "Repo fix surface" above are stale** (they predate ~2k lines of
index.js growth). The real surface today: the lookup + `_nameSel` at
`index.js:~10989`, the mob payload at `~11226`, and the label table at
`utils/mobSpecials.js` (`_MOB_SPECIAL_LABELS` is gone from index.js).

### The picker, as implemented

`pickAndMergeMobRows(rows, { zoneId })` returns
`{ row, specials, scope, variants, total, real, placeholder }`. Preference
ladder — the first non-empty tier is BOTH the primary row's pool and the union's
pool, so tiers never mix:

| scope | meaning |
|---|---|
| `zone-real` | real rows in the requester's zone (#141) — best |
| `catalog-real` | real rows anywhere (zone unknown, or this zone has none) |
| `zone-placeholder` | placeholders in the zone — only when the name has NO real row |
| `catalog-placeholder` | placeholders anywhere |

Primary row inside the winning tier: **level desc → maxlevel desc → hp desc →
id asc**. Deterministic, so a tie can't flip between requests (the point of
killing `limit=1`). The payload also carries `variants` / `variant_scope` /
`placeholder` for diagnosis.

### Three deliberate deviations from the spec above

1. **One query, not two.** The old code ran a zone-scoped `limit=1` and *then* a
   catalog-wide `limit=1`. It's now a single all-rows fetch (`limit=200` — the
   largest real-name cluster in the catalog is 34; only the junk `_`-only names
   go higher) with the zone preference applied in JS. Net: one fewer round trip,
   and — the reason it matters — a zone that holds **only** the placeholder body
   now falls through to the real row instead of serving the un-killable one.
   Zone-scoping semantics are otherwise identical (`id = zoneid*1000 + n`), and
   `test/mob-rowpicker.test.js` pins the #141 geonid cases.
2. **Code 24 "Will Not Aggro" stays hidden.** The audit's `CODE` table had it
   `show:true`, but §4's *confirmed* dropped-code list omits it and 1,492 of its
   1,708 catalog occurrences are placeholder rows. Added the seven the doc does
   confirm — **22, 26, 36, 37, 39, 44, 46** — and left 24 `show:false` with a
   comment. Flip it if the PQDI diff says PQDI renders it.
3. **`flee_pct` reads two encodings.** The catalog ships code 37 as *both*
   `37,1,<pct>` (40 rows: 5/6/7/10) and `37,<pct>` (14 rows: 15/20/50). The
   audit script read field index 0 of the params, which returned the enabled
   flag (`1`) for the first shape. Shared `_fleePercent` now takes param0 when
   present, else a value field > 1, else null. ⚠ Which field EQEmu itself reads
   is still unconfirmed — the PQDI diff settles it; this is the only reading
   under which every catalog row is sane (Innoruuk 10%, Hand of the Maestro 50%,
   not 1%).

### Merge semantics, pinned

- `specials` = union of `show:true` labels across the winning tier — **including
  the immunities**, per rule 5. So a Venril Sathir variant that's Unslowable
  makes the whole name read Unslowable. That is the intended warn-if-any
  direction (over-warn, never under-warn).
- `rooted` / `flees` / `flee_pct` come from the **primary row only**. They aren't
  warnings — "this body is rooted, that one isn't" is two different mobs, not a
  hazard to merge. A rooted mob can still carry `flees: true`; the overlay may
  combine them.
- `null` for `rooted`/`flees`/`flee_pct` means *the catalog doesn't say*. Never
  rendered as a claim.

### Proof (`test/mob-rowpicker.test.js`, 41 assertions)

Every fixture is a **verbatim row set from the live mirror** (2026-08-02),
confirmed to be exactly what the endpoint's own predicate
(`name ILIKE '<norm>' OR name ILIKE '#<norm>'`) returns — no wildcard bleed from
the `_` in the names.

- **(a) single-row unchanged** — Lord Yelinak (114618, cluster size 1) picks the
  same row the transcribed old picker does, at every zone scope; every legacy
  label survives in the legacy order; the only added label is the one code 26
  the row actually carries. Also asserted across all 14 fixture rows.
- **(b) multi-variant** — Maestro of Rancor picks L56 `76011` (old picker: L53
  `76006`) and merges Rampage the L53 bodies lack; The Itraer Vius picks
  L63/600k `179037` (old picker: L1 `179033`, *even zone-scoped*).
- **(c) placeholder-only** — Harbormaster Ironbeard (68233) still resolves and
  keeps its real immunities; empty/null row sets return a null mob.
- **(d) no leakage** — Itraer Vius shows no Immune-Melee/Magic even though the
  placeholder plainly carries both, and still doesn't when the placeholder is
  forced to be the highest-level row.

Baseline: 375 tests before, 416 after (33 files). No existing test changed.

### Follow-ons this work did NOT do

- **Overlay surfacing.** `rooted` / `flees` / `flee_pct` / `variants` are on the
  wire but `apps/mimic/mobinfo.html` doesn't render them yet — that's the beta
  side of #55 (mob-immunity display + badge). Unknown labels already degrade to
  a plain chip, so the seven new codes are safe on today's Mimic.
- **A second placeholder signature.** `19+20` is the spec's predicate and misses
  the `24 Will-Not-Aggro + 35 No-Harm-From-Client` controller shape (e.g. Venril
  Sathir `105021`: L55, runspeed 0, `10^21^24^35`). Harmless in every cluster
  checked (its flags are benign and it loses the HP tiebreak), but a high-level
  one could win primary. 256 catalog rows carry 35 without the 19+20 pair.
- **Double-hash names.** `_normMobName` strips one leading `#`, so rows named
  `##Zordak_Ragefire` can never match. Pre-existing, unrelated to the picker.
- **The PQDI diff itself** — still needs a machine that can reach pqdi.cc
  (cloud proxy 403s). It's what settles code 24, codes 42/43/49, and the
  `flee_pct` encoding.

---

## After the run

1. `mob-specials-summary.md` → the dropped-code list finalizes Fix 3's set.
2. `mob-specials-clusters.md` → spot-check 3-4 divergent clusters against live
   PQDI, confirm the merge (warn-if-any) is what PQDI shows.
3. `audit-mob-specials-report.md` → each boss mismatch is either the variant bug
   (row-picker) or a decode gap.
4. Ship the row-picker + `runspeed` to `main` (bot), the badge to `beta`
   (overlay). Close #173 (folds #171).
