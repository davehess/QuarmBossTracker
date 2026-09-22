# Target Info — a mana bar and a Factions tab

**Asked for** (the guild lead, 2026-09-22): *"2 additions to Target Info. Mana bar
and factions tab. For mobs and players should have Mana bars where applicable.
Mana for mobs should go based off of how many spells they've been observed
casting after they're engaged (we assume full mana for NPCs that have a mana
total in the database.) Then remove the mana amounts based on casts. If a mob is
disengaged we should still keep the mana total, but once they're reset their
resting mana regen should kick in."* Plus, from a live Spire Lord pull: *"This
should display the spell he cast that covers his hand with a dull aura."*

That last line is the whole design. Everything below follows from it.

Surface: `apps/mimic/mobinfo.html` (Stats / Loot / Spells today) + the bot's
`GET /api/agent/mob-info`. Nothing is built yet — this is the feasibility pass,
measured against our own mirror on 2026-09-22.

---

## 1. The identification chain, and it works

EverQuest's log **never names an NPC's spell**. The line is
`[…] Royal Scribe Kaavin begins to cast a spell.` — that is all you get, and it
is why this has never been done. The way in is the **landing** message:

> `[12:40:21] The Spire Lord's hand is covered with a dull aura.`

That is `eqemu_spells.cast_on_other`, and it resolves:

| | |
|---|---|
| Spell | **Grim Aura**, id 346 |
| `cast_on_other` | `'s hand is covered with a dull aura.` |
| Mana | **25** |
| The Spire Lord | id 169035, level 49, class 5 (Shadow Knight), hp 11,780, **mana 2,058**, `npc_spells_id` 9 |

The overlay already shows `12k HP` and `Shadow Knight` for that mob, so the row
is the right one. The agent already owns the matching primitive —
`resolveSelfCastLanding` matches landings with `body.endsWith(expected)`, and
`_buffLandingsByTarget` keys them by target.

### ⚠ Matching on text alone is NOT safe — narrow first

Globally, 1,384 NPC-castable spells share only 758 distinct landing strings.
**153 of those strings are ambiguous, and the worst maps to 27 spells.** They are
also the *common* ones: on The Spire Lord's own list, `"staggers."` is **seven
different lifetaps** — Lifetap (9 mana) through Drain Soul (225) — a 25× spread.

The fix is to narrow by what the NPC can actually cast, using two columns we
already mirror on `eqemu_npc_spells_entries`: **`minlevel`/`maxlevel`**, and
**`manacost`**, a per-entry override that is the cost the server really charges
(prefer it over `eqemu_spells.mana`).

Filter the candidate set to *this NPC's `npc_spells_id`, gated to its level*:

| | |
|---|---|
| (NPC, landing-string) pairs across the catalog | **7,806** |
| Resolve to exactly one spell | **7,621 — 97.6%** |
| Still ambiguous | 185 |
| Worst remaining case | **4** candidates (down from 27) |
| The Spire Lord at level 49 | **zero ambiguous strings** — the seven-way `"staggers."` collision collapses entirely, because the level gate leaves one tier |

**97.6% from two columns we already have.** That is the number the feature rests
on, and it is why the design is worth building rather than guessing at.

## 2. What we cannot see, stated plainly

These are not reasons to skip it. They are reasons the bar must be labelled an
**estimate**, and never drawn as if it were a real gauge like HP.

1. **A resisted or interrupted cast still costs the NPC mana and produces no
   landing line.** We would under-deduct. The Icewell log shows exactly this —
   `You resist the Retribution spell!` — so it is not hypothetical.
2. **194 of 1,384 NPC-castable spells (14%) have no landing text at all** —
   direct damage, which surfaces only as `was hit by non-melee for N points of
   damage`. Those need a second identification path keyed on the damage amount.
3. **We only see landings our own raiders' logs witnessed.** A spell landing on
   someone not running Mimic is invisible.
4. ⚠ **Whether Quarm's NPCs spend mana at all is unverified.** EQEmu charges
   `manacost` from `npc_spells`, but whether this server enforces it — and at
   what regen — is a server-behaviour question a cloud session cannot answer.
   **Do not ship the bar as fact until someone checks.**
5. ⚠ **There is no NPC mana-regen rate in our mirror.** `eqemu_npc_types` has
   no `mana_regen` column (verified — the only near matches are `ac`, `race`,
   `attack_count`, `npc_faction_id`). The guild lead's *"resting mana regen
   should kick in"* therefore has **no authoritative number behind it**; it
   would be a constant we invent. Either get the real rate from a local session
   against the `peq` DB, or make reset simply **restore to full** and say so.

**Coverage:** 3,741 of 18,033 NPCs have a mana total, and **3,384 have both mana
and a spell list** — the addressable set. For the other ~81%, draw no bar at all
rather than an empty one; *"where applicable"* is literally correct.

## 3. Player mana — a smaller feature than it sounds

Zeal gives `self_mana_cur` / `self_mana_max`, which is **your own character
only**. Other players' mana is **not on the raid pipe**, and we have proof in our
own code: the CH-chain roster carries `mana: null` per slot, and the healer-mana
roster exists because it **parses mana percentages out of raid chat text**
(`"Druid -- current mana 45%."`). Nobody would have written that if the pipe
carried it.

So a player mana bar works for raiders **running Mimic and uploading live
state**, through the existing `character-live-state` path — the same shape as
Extended Target and cross-client Mob Info — and shows nothing for anyone else.
That is worth building, but it is a *fleet-adoption* feature, not a data feature,
and it should degrade silently.

## 4. Factions tab — the cheap one, and mostly already built

⚠ **Do not write a faction resolver.** `_factionValueMap()` in the bot already
maps mob → `{faction: value}`, is cached 6h, and was **validated end to end
against the guild lead's own client log** (`#Lord_Inquisitor_Seru` → −2000 to
five Seru factions, +200 to four Katta). It already knows the trap: names come
from **`eqemu_faction_list_full`**, because `eqemu_faction_list` is **empty in
our mirror** (0 rows, verified) and a null name silently drops the value.

Live results for the two mobs in the screenshots:

| Mob | Killing it does |
|---|---|
| **Royal Scribe Kaavin** | **Dain Frostreaver IV −50**, **Coldain −50**, King Tormax **+25** |
| **The Spire Lord** | **Spire Spirits −100**, +10 each to Seru / Hand / Eye / Heart / Shoulders of Seru and Citizens of Seru, The Recuso −10 |

That is genuinely useful pre-pull information, and it is a plumbing job: expose
the existing map on `mob-info`, render a fourth tab.

**The differentiator nobody else has:** we also hold `faction_standing` (5,122
rows, per character) and `faction_cons` (28,076). So the tab can show *what this
kill does* **next to** *where you already stand* — which no other tool on the
server can do, because it needs an observation history.

⚠ One check before shipping: `npc_faction_entries.npc_value` appears to mark the
NPC's own/con faction (it is 1 on Spire Spirits, which is The Spire Lord's
`primaryfaction`, and 1 on Dain/Coldain for Kaavin) while `value` is the hit on
kill. That reading fits both samples but has not been confirmed against a
recorded kill. Confirm before labelling columns in the UI.

## 5. Options

Costs are the four the repo asks for — **build · maintenance · runtime ·
change** — not one word.

### A. Factions tab only
Fourth tab; `mob-info` returns the existing map plus the viewer's standing.
- **build: low** — the resolver, its cache and its validation all exist.
- **maintenance: low** — pure catalog data; the weekly mirror sync keeps it true.
- **runtime: low** — one more field on a call already made, 6h-cached.
- **change: low** — self-contained tab, no new state anywhere.

### B. Factions tab + "last cast" line (no mana bar)
Adds the spell identification from §1 and shows **what the mob just cast** — the
guild lead's *"display the spell he cast"*, answered directly — without claiming
a mana number.
- **build: medium** — the matcher, the level/`npc_spells` narrowing, the DD
  fallback.
- **maintenance: low** — the 97.6% is a property of the catalog, not of our code.
- **runtime: low** — one lookup per observed landing.
- **change: low** — one line of UI; the matcher is reusable by the mana bar later.

### C. B + the estimated mana bar
Everything above, plus full-at-engage minus observed casts.
- **build: high** — per-mob mana state, engage/disengage/reset lifecycle, regen.
- **maintenance: medium** — the estimate drifts on resists, interrupts and
  unwitnessed landings, and every complaint about it lands as a bug report.
- **runtime: low**.
- **change: ⚠ high** — it is **stateful per mob across a fight**, which is the
  expensive kind. And it is gated on two unknowns (§2.4, §2.5) that a cloud
  session cannot close.

## 6. Recommendation

**B now, C once the two unknowns are closed.** B delivers the thing that was
actually asked for in the second message — *show me the spell* — at a fraction of
C's change cost, and it builds the exact matcher C needs, so nothing is thrown
away. A is worth doing in the same pass because it is nearly free and already
validated.

Ship the bar (C) only after a local session answers: **does a Quarm NPC actually
spend mana, and at what rate does it come back?** Until then the bar would be a
confident-looking number we made up, on an overlay read mid-raid — the one place
this platform's design rules say not to do that.
