# DESIGN — Divine Intervention callout (#204)

*Written 2026-08-04 (overnight design pass). §4 steps 1–2 built 2026-08-09
(both DI triggers live and source-verified). **§4 step 3 — the two-name
selector — built 2026-08-11**; what shipped and the calls made along the way
are in §6. Read this before touching `_noteDiCast`, `/api/agent/di-status`,
`trackDiFired`, or either Divine Intervention guild trigger.*

**The ask (Hitya, 2026-08-03):**

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

> **✅ RESOLVED 2026-08-09 — verified at the server source, no log capture
> needed.** Quarm runs EQMacEmu, and the death-save path is public:
> `zone/spell_effects.cpp` → `Mob::TryDeathSave()`. On a successful save it
> emits **exactly one** message:
>
> ```cpp
> entity_list.MessageClose_StringID(this, false, 200, Chat::MeleeCrit,
>                                   StringID::DIVINE_INTERVENTION, GetCleanName());
> ```
>
> with (`zone/string_ids.h`):
>
> | id | constant | client string |
> |---|---|---|
> | 1029 | `DIVINE_INTERVENTION` | `%1 has been rescued by divine intervention!` |
> | 1028 | `DEATH_PACT` | `%1's death pact has been benevolently fulfilled!` |
>
> Load-bearing details read straight off that call:
> - **Always name-form**, even in the saved player's own log (`%1` =
>   `GetCleanName()`, `skipsender = false`) — there is no "You have been
>   rescued" variant on Quarm, so one named-capture pattern covers everyone.
> - **200-unit range** — a cleric far from the tank never sees the line. Any
>   raid-wide callout has to come from a trigger relay, not from assuming every
>   client logs it.
> - **A FAILED save emits NOTHING.** The roll fails, the function returns
>   false, the player dies with no dedicated message. The
>   `"<Player> survived divine intervention!"` line that circulates in
>   GINA/AI-generated trigger guides **does not exist on Quarm** — it is the
>   same invented-pattern trap as §0. "DI failed" is only detectable as
>   rescue-line-absent + a death message, never as its own line.
> - Success also fades the buff (`BuffFadeBySlot`), so the tank's self-only
>   `You are no longer watched.` follows a fire — but that text also appears on
>   natural expiry, so it is a fade signal, not a fire signal.
>
> Shipped the same day: `guild_triggers` row `60d9797f-d64c-424a-ba3d-460c53c0946f`
> **"Divine Intervention fired (death save)"**, pattern
> `(?<tank>\w+) has been rescued by divine intervention!`, verified through
> `compileTriggerPattern` against a raw timestamped line (captures the name,
> ignores chat near-misses). The landed trigger's TTS was reworded to
> "D I **landed** on {tank}" so apply and consume are distinguishable by ear.

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

1. ~~**Fix the dead trigger**~~ — **✅ DONE 2026-08-09.** Row `91a0a617…` is
   "Divine Intervention landed", pattern = the real spell-1546
   `cast_on_other`/`cast_on_you` texts, TTS "D I landed on {tank}".
   (The historical hazard stands for future edits: patterns match the raw
   line including the `[timestamp] ` prefix — write them unanchored or
   anchored as `^\[.+?\]\s+`; see `RUNBOOK-dead-triggers.md`. Since agent
   3.5.54 the compiler also rewrites a bare leading `^` to the timestamp-
   tolerant form, so this is belt-and-braces rather than load-bearing.)
2. ~~**Capture the DI-fired line**~~ — **✅ DONE 2026-08-09**, from the server
   source rather than a log (see §0). The fire trigger `60d9797f…` is enabled;
   first live fire still unobserved.
3. ~~**Ship the two-name selector** agent-side behind the existing chain
   overlay~~ — **✅ DONE 2026-08-11.** See §6.
4. **Overlay UX** (#207) — countdown + dismiss + dismissal recording. The
   card shipped in step 3 carries a TTL countdown and a ✕ that hides it
   **locally only**; the `callout_fires` table and dismissal RECORDING are
   still #207's, and #207 remains the prerequisite for learning anything from
   them (a dismissal count without an exposure count is not a signal).
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

---

## 6. What shipped (2026-08-11)

**Where it lives.** `packages/wolfpack-logsync/index.js`, in the CH-chain
module right after `_maybeAnnounceChGo`: `_DI_FIRED_RX` → `trackDiFired()` →
`diCalloutCandidates()` → `_diRankCandidates()` (pure) + `_diSlotTurnInMs()`,
surfaced as `diCallout` on `/api/state` via `diCalloutSnapshot()` and rendered
by the card in `apps/mimic/chchain.html`. Tests: `test/di-callout.test.js`,
riding the shipped exports and the real chain parser rather than a copy.

⚠ **`trackDiFired` must stay ABOVE the `shouldKeep` gate in the watch loop.**
The death-save line does not survive the byte filter — the hook only ever sees
it because it runs first, same trap as the "you have taken" family. Moving it
down silences the whole feature with no error anywhere. Pinned by a test.

**The audio is the existing trigger surface**, not a new one: `trackDiFired`
pushes one `text_overlay`-shaped fire (`trigger: 'DI DOWN'`) exactly the way
the CH GO callout does, so the trigger overlay flashes it and speaks it under
the user's own TTS toggle. The chchain card deliberately never speaks — that
would talk over the fire it is the visual twin of.

### Calls made beyond the doc

- **Clerics only, and we can now check it.** The doc says "rank clerics"; the
  CHAIN is not a cleric roster. Druids gap-fill it through
  `CH_EQUIVALENT_SPELLS` auto-slots (which carry a `kind` label) and shamans
  turn up too, and **a druid cannot cast DI at all**. Slots with a `kind` label
  are dropped, as is anyone whose class is KNOWN and isn't Cleric
  (`whoData` → `_raidClassByName`). An **unknown** class stays eligible — most
  of the raid's clerics will never run Mimic.
- **A corpse is never nominated.** §2 lists "is this cleric actually alive"
  under what we cannot know. That is **stale** as of agent 3.5.58: `_isDead`
  exists and this uses it.
- **A MEASURED recast is a hard exclusion, not a rank.** "Rank, don't filter"
  in §3.3 is about clerics we know nothing about. When `di-status` says
  `up === false && unknown === false` we WATCHED the cast start — naming them
  would burn one of only two slots on someone who provably cannot cast.
- **One honest name beats two with a wrong one.** §3 says "never a single
  name", and that holds for ties and empty results (which fall back to the two
  most recent chain healers). It does NOT override a hard exclusion: if only
  one cleric survives the exclusions, one name is what gets called — which is
  also what `DESIGN-extended-target-v2.md` §6 asks for.
- **The fallback orders by pure recency**, not by the main ranking. The
  fallback IS "we have no clean pick, so name whoever was demonstrably healing
  last" (doc wording), and the hard exclusions still apply to it.
- **No candidates → no nomination.** The doc's "never to silence" is about the
  selector degrading gracefully, not about conjuring names. With no chain
  running there is nobody to rank, and the raid still hears the event from the
  guild trigger (`60d9797f…`, "D I fired on {tank}"). Silence here is only the
  selector declining to invent, which is the honesty layer working.
- **Ungated by `exclude_from_stats`.** The callout uploads nothing; a raider
  opting out of STATS must not lose a raid-critical call. Same reasoning as
  `noteBlindLine` / `noteSongAoeLine`.
- **20s TTL, DI down only.** §5's "should it fire when DI is simply ABSENT
  from the MT" is still open and deliberately unbuilt — this fires on the death
  save only. §5's "two names or three" stays at two (the ask), as one constant
  (`DI_CALLOUT_NAMES`). No DI roster is encoded (§5's third question), because
  a hardcoded one rots.
- **Cadence note worth knowing before tuning:** the exclusion window is
  `DI_CAST_MS (6s) + one beat`. On a SHORT chain that is most of the rotation —
  a 4-slot chain on a 3s beat has a 12s rotation against a 9s window, so
  nearly everyone is excluded and the fallback carries the call. That is the
  correct behaviour (a cleric who casts DI misses their CH) but it means the
  fallback path is not an edge case on small chains; it is the normal path.
  `test/di-callout.test.js` pins both.

### Not built here (still #207)

Dismissal RECORDING. The ✕ on the card clears it on that machine for that
callout id and nothing else — no endpoint, no row. Per `DESIGN-callout-overlay.md`
§3.1 the prerequisite is persisting fires; a dismissal count without an
exposure count is not a signal.


## §7 — Hitya's calls, 2026-08-11 (all four points, against the shipped build)

1. **"X OR Y if both have it ready and aren't getting ready to CH soon"** —
   confirmed as shipped: primary pool is `recent && !busy` (busy = own CH turn
   within one DI cast + one beat), confirmed-ready outranks unknown, two names.
2. **"Druids can't DI, only clerics"** — confirmed as shipped: `kind`-labelled
   CH-equivalent auto-slots and known non-clerics are hard-excluded.
3. **"Not every cleric has Mimic… if the Mimic ones don't have it ready, rely
   on the others"** — confirmed as shipped, and this is why a MEASURED recast is
   a hard exclusion while `unknown` (non-Mimic) stays eligible below
   confirmed-ready: when every Mimic cleric is known-down, the pool becomes
   exactly the non-Mimic clerics, evidence chips marking them unknown.
4. **"The one casting should call it out"** — NEW, added 2026-08-11: the
   selector nominates, a human closes the ambiguity. The callout now ends
   "— caster call it" (TTS and overlay), teaching the protocol every time it
   fires. The Lenolshot "I got it Curry!" pattern, made standard.
