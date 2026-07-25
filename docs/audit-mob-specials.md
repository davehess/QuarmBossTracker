# Mob-info audit: our catalog vs PQDI (#173)

**Goal.** Make the Mob Info / Target Info overlay agree with pqdi.cc on the
combat facts raiders act on, for every raid boss:

> can it **see invis** · can it be **pacified** · is it **rooted in place** or
> does it **run when low** · does it **enrage / rampage / summon** · is it
> **unslowable** · is it **unrootable / immune to movement-speed changes**

Our overlay reads these from `eqemu_npc_types` (the weekly Quarm mirror). This
audit diffs that against what PQDI displays and turns the disagreements into a
punch list.

---

## TL;DR — run it locally

```bash
# from the repo root, on a machine that can reach pqdi.cc
SUPABASE_URL=https://zhtoekwakucbckvatfky.supabase.co \
SUPABASE_KEY="<anon or service-role key from your .env>" \
node scripts/audit-mob-specials.mjs
```

Writes `audit-mob-specials-report.md`: one row per boss where DB and PQDI
disagree, plus a list of special-ability codes present in the catalog that our
decoder drops. It audits the **113 raid bosses** in `data/bosses.json` that
carry a `pqdiUrl` (the 20 PoP-locked bosses have no URL yet — expected, they get
one after the 2026-10-01 unlock + `/addboss`).

**Why local and not here:** `pqdi.cc` returns **HTTP 403** to the Claude Code
cloud proxy, so the PQDI side can't be scraped from the web environment. The DB
side can (and this doc already reports what it found); the PQDI side needs your
machine.

If PQDI's markup has drifted, calibrate the phrase matchers once:

```bash
node scripts/audit-mob-specials.mjs --dump 179037   # The Itraer Vius
# prints the plain-text flag block + writes pqdi-dump-179037.html
```

Smoke test with `--limit 5`. Be polite: default `--delay 1500` ms between PQDI
hits (~3 min for the full run).

---

## What the audit already established (DB side, no PQDI needed)

1. **PQDI ids == our eqemu ids.** Every `pqdiUrl` in `data/bosses.json`
   (e.g. `…/npc/179037`) resolves 113/113 to a real `eqemu_npc_types.id`. That
   means (a) the audit keys off those ids and **sidesteps the name-lookup
   variant bug entirely**, and (b) the PQDI link shipped on the overlay in #186
   points at the correct page. ✅

2. **"Rooted in place" and "runs when low" are currently invisible.** The
   mob-info endpoint never selects `runspeed`, and the decoder ignores flee
   codes. So two of the six things you asked about **cannot be shown today**:
   - `runspeed = 0` → stationary / rooted-in-place (e.g. The Itraer Vius, Lord
     Yelinak, Vulak\`Aerr, Emperor Ssraeshza, most NToV dragons).
   - special code `37,<pct>` → flees at that % HP ("runs when low"); code `21`
     → will **not** flee. Neither is decoded.

3. **The decoder drops codes that ride on raid bosses.** Codes present in the
   catalog but absent from `_MOB_SPECIAL_LABELS`:

   | Code | Meaning (EQEmu enum) | # bosses | Show? |
   |---|---|---|---|
   | 22 | Immune Melee Except Bane | 1 | yes |
   | 24 | Will Not Aggro | 1 | yes |
   | 26 | Immune to Ranged Spells | 36 | yes |
   | 37 | Flee at Percent ("runs when low") | 9 | yes |
   | 39 | Disable Melee | 1 | yes |
   | 44 | Immune to Ranged Attacks | 13 | yes |
   | 46 | Immune to NPC/Pet Damage | 20 | yes (charm/pet strats) |
   | 42 | Counter Avoid Damage (tuning) | 47 | no — internal |
   | 43 | Prox Aggro (tuning) | 52 | no — internal |
   | 49 | Modify Avoid Damage (tuning) | 5 | no — internal |

   42 / 43 / 49 are EQEmu combat-tuning knobs, not player-facing flags — the
   audit run confirms PQDI hides them (if it doesn't, we add them). 26 / 44 / 46
   are real player-facing immunities on a **lot** of bosses and we show none of
   them.

---

## The eqemu → flag reference (authority for the fix)

`special_abilities` is a `^`-delimited list of `code,param[,param2…]`. A second
field of `0` means *present-but-disabled* — skip it. Full map lives in
`scripts/audit-mob-specials.mjs` (`CODE`); the raid-relevant subset:

| Code | Flag | Notes |
|---|---|---|
| 1 | Summon | pulls you to it |
| 2 | Enrage | |
| 3 / 4 | Rampage / Area Rampage | |
| 5 | Flurry | |
| 12 | **Unslowable** | immune to slow |
| 13 | Unmezzable | |
| 14 | Uncharmable | |
| 15 | Unstunnable | |
| 16 | **Unsnareable** | immune to movement-speed debuffs (your "immune to movement-speed changes") |
| 17 | Unfearable | |
| 21 | **Immune Fleeing** | does *not* run at low HP |
| 23 | Immune Non-Magical | needs a magic weapon |
| 26 | Immune Ranged Spells | |
| 31 | **Immune Pacify** | cannot be lulled |
| 37 | **Flee at %** | *runs when low*; param = HP % |
| 44 | Immune Ranged Attacks | |
| 46 | Immune NPC/Pet Damage | |

Not in `special_abilities` — separate columns:
- `see_invis`, `see_invis_undead` → **see invis** (either true = sees invis).
- `runspeed` → `0` means **rooted in place** (never chases).

> On "unrootable": EQ root and snare share the movement-debuff family; code 16
> (Unsnareable) is the closest catalog signal and is what the overlay should
> label as "immune to movement-speed changes / root." The audit's `unsnareable`
> dimension matches PQDI's "Immune to Snare/Root" text so we can confirm the
> semantics per boss.

---

## Repo fix surface (what to change after the audit)

Three independent fixes. #1 and #2 are correct regardless of what PQDI returns;
#3 is gated on the audit report so we only add flags PQDI actually shows.

### Fix 1 — stop picking placeholder/variant rows (the #173 core bug)

`index.js` ~**6612**, the mob-info lookup:

```js
const rows = await supabase.select('eqemu_npc_types',
  `or=(name.ilike.${encPlain},name.ilike.${encHashed})&select=…&limit=1`);
const r = Array.isArray(rows) && rows[0];
```

`&limit=1` lets PostgREST hand back whichever row it likes — often the `#`-prefixed
**L1 placeholder** (e.g. `#The_Itraer_Vius`, specials `10,1^19,1^20,1^21,1^24,1^27,1^35,1`)
instead of the real **L63** `The_Itraer_Vius` (specials with Enrage/Rampage,
`runspeed 0`). Fix: drop `&limit=1`, order to prefer the real row, and pick in JS:

```js
// …&select=…&order=level.desc.nullslast&limit=8   (no limit=1)
const rows = await supabase.select('eqemu_npc_types', `…&order=level.desc.nullslast&limit=8`);
const list = Array.isArray(rows) ? rows : [];
// prefer the highest-level, non-`#`-placeholder, ability-bearing row
const r = list.slice().sort((a, b) =>
  (b.special_abilities ? 1 : 0) - (a.special_abilities ? 1 : 0) ||
  (b.level || 0) - (a.level || 0) ||
  (String(a.name).startsWith('#') ? 1 : 0) - (String(b.name).startsWith('#') ? 1 : 0)
)[0];
```

(Same picking logic wants to live in the staged #161-P1 mob-variant work — reuse
that if it lands first.)

### Fix 2 — surface `runspeed` → rooted / flees

`index.js` ~**6613**: add `runspeed` to the select. Then in the mob object
(~**6850**) add derived fields:

```js
runspeed:    r.runspeed != null ? Number(r.runspeed) : null,
rooted:      Number(r.runspeed) === 0,                 // stationary in place
```

Decode the flee flags in `_decodeMobSpecials` / a sibling so the overlay can
say "Flees at 20%" (code 37 param) or "Does not flee" (code 21). The overlay
(`apps/mimic/mobinfo.html`) then shows a Rooted / Flees badge next to the
immunity row.

### Fix 3 — extend `_decodeMobSpecials` label map (audit-gated)

`index.js` ~**5380** `_MOB_SPECIAL_LABELS`. Add the `show:true` codes the audit
confirms PQDI renders — candidates: 26 (Immune Ranged Spells), 37 (Flee %), 44
(Immune Ranged Attacks), 46 (Immune NPC/Pet Damage), 22, 24, 39. Do **not** add
42/43/49 unless the report shows PQDI displaying them. Mirror any additions into
`_MOB_SPECIAL_LABELS` and the audit's `DECODED_BY_BOT` set so future runs stay
honest.

> Overlaps with staged work: `scratchpad/staged` #55 (mob immunities display)
> already drafts `_MOB_SPECIAL_LABELS` extensions and the overlay badge — fold
> Fix 3 into it rather than duplicating.

---

## After the run

1. Read `audit-mob-specials-report.md`.
2. **Mismatches table** → each row is either the variant bug (Fix 1) or a
   decode gap (Fix 3). Spot-check 2–3 against the live PQDI page.
3. **Dropped-codes table** → decide show/hide per code from what PQDI actually
   renders; apply Fix 3.
4. Ship Fix 1 + Fix 2 to `main` (bot) with a `/mob-info` sanity check on a
   known-rooted boss; ship the overlay badge on `beta`.
5. Close #173 (and fold #171 enrage-comb into it).
