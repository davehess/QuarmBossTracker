# DESIGN — Divine Intervention callout (#204)

*Written 2026-08-04 (overnight design pass). Unbuilt. Read this before touching
`_noteDiCast`, `/api/agent/di-status`, or the "Divine Intervention fired"
guild trigger.*

**The ask (Uilnayar, 2026-08-03):**

> can you identify if we have the "D.I. fired on \<tank name\>" trigger for
> divine Intervention? we would like to start building in logic to call that out
> and request the cleric that has it available (not on recast cooldown) and has
> emeralds AND is not coming up on the CH chain within the cast time plus global
> cooldown time.

and then, after hearing what we can and can't know:

> how about calling out two clerics that have recently healed on the CH chain as
> potential DI-casters so that they can call out in voice who is doing it?

That second message is the design. The rest of this doc explains why, and what
has to be fixed first.

---

## 0. THE BUG — the trigger exists, is enabled, and has never fired

`guild_triggers` row `91a0a617-f971-450c-a19c-4375fa63bfe0`, "Divine Intervention
fired", `enabled = true`:

```
pattern: (?<tank>[A-Z][\w']+)(?:'s wounds heal|is filled with divine|has been graced with divine intervention)
actions: text_overlay "D.I. → {tank}"  +  tts "D. I. fired on {tank}"
```

The real messages for spell **1546 Divine Intervention** (from our own
`eqemu_spells` mirror) are:

| field | text |
|---|---|
| `cast_on_you` | `You feel the watchful eyes of the gods upon you.` |
| `cast_on_other` | `<Name> feels the watchful eyes of the gods upon them.` |
| `spell_fades` | `You are no longer watched.` |

**None of the three alternates in the pattern appear anywhere in the spell's
text.** `'s wounds heal`, `is filled with divine`, and `has been graced with
divine intervention` were invented. The trigger has been sitting enabled,
looking like coverage, matching nothing.

This is the same failure mode as the AOE_DANCE mis-signature (#169 neighbourhood)
and the dead `^`-anchored batch (#190): **an enabled trigger with a wrong pattern
is worse than no trigger**, because it reads as "we have that covered" on
`/admin/triggers` and in anyone's memory.

### What to replace it with — and the one line we still need

The *cast* is now trivially matchable and worth calling on its own:

```
DI applied:  ^(?<tank>[A-Z][\w`']+) feels the watchful eyes of the gods upon them\.$
DI faded:    ^You are no longer watched\.$          (self only)
```

The **fire** message — the one the ask actually wants — is NOT a spell-text
field. DI is `effect_id_1 = 150` (SE_DivineSave) with `effect_base_value_1 = 2`
(full-heal death save; Death Pact 1547 is the same SPA at base 1). SPA 150 fires
from the server's death path, so its text lives in the client string table, not
in `eqemu_spells`, and **we cannot read it from the catalog we have**.

> **⚠ Needs one line from a real log.** Next time DI saves someone, grab the
> verbatim line. Until then, do NOT guess the pattern — guessing is exactly what
> produced the dead trigger above. This is the same rule we set for the pet
> Death Touch capture (#169): get the line first, widen the regex second.
>
> Cheap way to get it without waiting: the dying player's own log has it. Once
> `death_confirm` (agent 3.5.13) is in the fleet we will be capturing the
> corpse-run tail already — a DI save is *precisely* a death that didn't happen,
> so the lines around a near-death are worth a one-off `--since` sweep of a
> cleric's log after any night a DI fired.

---

## 1. What we already have (verified, not assumed)

| Signal | Where | Freshness | Coverage |
|---|---|---|---|
| **DI recast per cleric** | agent `_noteDiCast` → `character_live_state.di_ready_at` → `GET /api/agent/di-status` | live (3s bot cache, 10-min staleness cutoff) | **Mimic clerics only** |
| **DI interrupt refund** | `noteDiInterrupt` — an interrupted/fizzled cast inside the 6s window clears the stamp | live | Mimic clerics only |
| **CH chain roster + who healed when** | agent `_chChain.slots[num] = { name, mana, lastAtMs, count }`, `nextNum`, `beats[]` (median call gap) | live, in-memory | **whoever is in the raid channel** — chain calls are shouts, so ONE Mimic user sees the whole chain |
| **Cleric identity** | `characters.class = 'Cleric'` | static | full guild |
| **Healer mana** | piggybacked on `di-status` (`healer_mana[]`) | live | Mimic healers only |

The asymmetry in the coverage column is the whole design problem, and it is
**good news**: DI recast is per-client and only Mimic clerics report it, but the
CH chain is reconstructed from *shouts*, so a single Mimic user in the raid sees
every cleric's chain activity — Mimic or not.

## 2. What we cannot know (and must not pretend to)

- **Emeralds.** `character_inventory` has the right shape (`item_name`,
  `quantity`) but it is a **manual export**, not a feed. As of 2026-08-04 exactly
  six clerics have ever had a snapshot and the newest is **2026-07-15 — twenty
  days stale**. A twenty-day-old count cannot answer "do you have an emerald
  right now". Worse, it fails in the dangerous direction: DI *consumes* the
  reagent, so the stalest data is systematically too optimistic. **Do not gate
  the callout on emeralds.** (Our `eqemu_spells` mirror doesn't even carry
  component columns, so we can't confirm the reagent from the catalog either.)
- **Non-Mimic clerics' recast.** No client, no `di_ready_at`. Treating "no row"
  as "ready" is the current default and it is the right one for a *chip* ("a
  cleric who hasn't cast shows ready") but it is the WRONG default for a callout
  that names one person — it would confidently name the cleric we know least
  about.
- **Whether a named cleric is actually alive, in zone, and not mid-cast.** We
  have `character_live_state` freshness but not global-cooldown state.

## 3. The design: name two, let voice pick one

**Do not select a caster. Nominate candidates and let the raid resolve it.**

That is not a cop-out, it is the correct shape for this problem: the missing
inputs (emeralds, GCD, "I'm about to med") are all things a human cleric knows
instantly and we cannot know at all. A confident single-name callout that picks
someone with no emerald is worse than useless — it costs a tank while two clerics
each assume the other has it.

### Trigger

Fires on the **DI-fired** line (once we have it) or, as a stopgap that is useful
today, on the **DI-faded / DI-not-present-on-MT** condition.

### Selection (evaluated agent-side, in the CH-chain module)

Rank clerics by this, take the top **two**:

1. **Recently active on the chain** — `slots[n].lastAtMs` within the last
   ~2 chain rotations (`median(beats) × slotCount × 2`). This is the ask's
   "recently healed on the CH chain". It proves alive, in zone, and healing —
   three things we otherwise can't check.
2. **Not up next.** Exclude any slot whose turn falls inside
   `DI_CAST_MS (6s) + one beat`. A cleric who casts a 6-second DI misses their
   CH, and a missed CH is how tanks die. This is the ask's "not coming up on the
   CH chain within the cast time plus global cooldown time", and it's computable
   from `nextNum` + `median(beats)` — we already grade chain timing this way
   (`_chGradeCall`).
3. **DI known-ready**, when we know: `di_ready_at == null || di_ready_at <= now`
   from `di-status`. **Rank, don't filter** — a cleric with no data ranks below
   a cleric with a confirmed-ready DI, but is still eligible, because most
   clerics won't be on Mimic.
4. **Tie-break on mana** (`healer_mana`), highest first. 500 mana is not nothing.

Ties and empty results both resolve to "call the chain roster's two most recent
healers" — never to silence, and never to a single name.

### Output

- **TTS:** `"D I down. <A> or <B>."` — two names, no verb. Short enough to land
  inside a tank-buster window; deliberately does not say "cast it", because the
  raid decides.
- **Overlay:** a line with both names, a visible countdown (see #207), and each
  name showing its evidence chip — `DI ✓` if confirmed ready, `chain #4` for
  position, mana % if known. **The chips are the honesty layer**: a cleric can
  see at a glance that we're guessing about them.
- **Dismissible**, and the dismissal is recorded (#207). If this callout is
  routinely dismissed, it is wrong and we should know that from data rather than
  from someone eventually grumbling.

### Where it runs

**Agent-side, in the CH-chain module.** The chain state is already there,
in-memory, and this must fire inside a second — a bot round-trip is the wrong
budget. `di-status` is already polled by the same overlay (4s cache), so no new
network path is needed.

---

## 4. Build order

1. **Fix the dead trigger** — swap the invented pattern for the real
   `cast_on_other` line, so "DI applied to \<tank\>" works *today*. One
   `guild_triggers` UPDATE; reaches the fleet in ~2 minutes, no release.
   **Write it UNANCHORED, or anchored as `^\[.+?\]\s+`** — patterns match the raw
   line including the `[timestamp] ` prefix, so a leading bare `^` is dead on
   arrival. That is a separate defect affecting 37 enabled triggers; see
   `RUNBOOK-dead-triggers.md`. (The DI trigger dodged it only because its author
   left off the anchor — it fails on invented text instead.)
2. **Capture the DI-fired line** from a real log (see §0). Blocking for the fire
   callout, nothing else.
3. **Ship the two-name selector** agent-side behind the existing chain overlay.
4. **Overlay UX** (#207) — countdown + dismiss + dismissal recording.
5. *Later, only if inventory ever becomes a feed:* emerald evidence as a fourth
   ranking chip. **Never as a filter.**

## 5. Open questions for Hitya

- **Two names, or three?** Two is the ask. Three covers more of the raid but the
  TTS gets long and "everyone assumes someone else" gets likelier.
- **Should the callout fire when DI is simply ABSENT from the MT** (rather than
  only when it fires)? We can see the buff on the MT via `buff_casts` /
  live-state when the MT runs Mimic. That's a "put DI up" callout, which is a
  different — and possibly more valuable — thing than "DI just went off".
- **The four names in the original ask** (Mcdorf, Stupidrichard, Uilnayar,
  Fargan) — is that a fixed DI roster we should encode, or was that "these are
  the clerics we had that night"? A configured roster is easy and removes a lot
  of guessing; a hardcoded one rots.
