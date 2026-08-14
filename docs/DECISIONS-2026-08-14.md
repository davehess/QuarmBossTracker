# Decisions — 2026-08-14 (Aten Ha Ra raid night, continued)

Same raid session as `DECISIONS-2026-08-13.md`, past UTC midnight. That file
still holds the compat-mode / item-icon / dashboard-split write-ups; this one
carries the live **Open — read this first** table forward, so read this one
first and reach back for the older detail.

---

## Open — read this first

| Item | State |
|---|---|
| **OpenDKP loot never reaches `loot_observations`** | Automatic sync fills `opendkp_loot` (current); the Mob Info Loot tab reads `loot_observations`, which only the manual `/backfillopendkploot` writes and which stops at raid 96805 / 2026-06-04 — **758 awards over 28 raids missing.** Run `/backfillopendkploot days:90` to close it now; scheduled fold is task #37, main, after the freeze |
| **Live combined guild damage is being retired from the in-fight view** | Cross-client corroboration still doubles some rows. Moving to a History tab of the last few mobs, shown only once deduped (task #38) |
| **Item icons DISABLED — needs a local session** | The atlas maps to the wrong icon ids (633 = boots → shovel). Off behind `ICON_ATLAS_DISABLED` since web 1.1.50. Repack via `scripts/pack-item-icons.ps1` on the EQ machine, check `uifiles/default` is stock, and VERIFY 633 is boots before re-enabling |
| **Who rewrites guild chat?** | Hawkner + Syko ship punctuation-stripped, capitalised copies of lines they witnessed. Not our code (same agent build on both sides). Have Hawkner grep his own eqlog for one of the lines — that says client-side vs ours in one step |
| **Zeal `EPERM` → ask about compat mode FIRST** | XP compatibility mode on eqgame.exe kills the pipe, and the guide we recommend tells people to turn it on. Mechanism unconfirmed; `lastError` still isn't surfaced anywhere in the UI |
| **Raid-Helper sync is unmonitored** | It is the ONLY copy of declared availability (the upstream board expires on raid day) and nothing alerts on failure. Add a staleness check — no new `rh_signups` rows within ~48h of a raid should be loud |
| **Dashboard split — live check** | Sidebar + 📊 Stats / 🩺 Diagnostics are on beta only; browser-verified but not yet used in a raid. Graduate with the next Mimic stable |
| **CH chain ✕ — live check** | Agent 3.5.79, beta only. Browser-verified; not yet pressed in a raid |
| **Task #27** | Restore the 8 muted trash triggers — unblocked, fix is on stable |
| **#204–#207** | Graduate to stable after beta test + one raid cycle |
| **Item icons** | Above icon 1723 render blank — count how many real items are affected. Atlas is 1.6 MB; `pngquant` would roughly halve it |
| **Noisy eqlogparser triggers** | Offered, not accepted: disabling Too Far / Can Not See / Can Not Hit From Here / Out of Range / Range, which were filling the trigger checkpoint journal |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |

---

## The number is what makes it a CH chain

**The call (Hitya, live on the Aten Ha Ra pull).** Pyxil was spot-healing the
RAMPAGE target and shouting each heal:

```
[R] [Pyxil]: TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left
```

Tunare's Renewal is in `CH_EQUIVALENT_SPELLS`, so the agent auto-assigned her a
chain slot the first time it saw one. She landed on **006 — where Mcdorf
actually was** — which lit the ORDER CONFLICT banner and dropped a druid who was
nowhere near the rotation into the middle of it. *"She shouldn't be placed back
onto the CH chain even though she's posting CHs."*

**Where it landed.** The auto-slot branch is gone (agent 3.5.79). An un-numbered
personal-macro shout now becomes a **spot heal**, whatever the spell is, keeping
its CH-equivalent label so the banner can read "Pyxil spot healing (Druid CH)".
A druid who calls a number still joins the rotation exactly as before.

**Why the old reasoning was wrong, since it sounded right.** The auto-slot
existed so a rotation member who doesn't say their number out loud still keeps a
stable row (#148, 2026-07-02). The flaw: **a spot-healer shouting the same spell
is indistinguishable from that person.** One shape of evidence, two very
different situations, and the failure is silent — a corrupted rotation looks
exactly like a working one until a beat is missed.

## ✕ removes someone from the chain — and keeps them off

**The call (Hitya).** *"For the Pyxil scenario we should be able to remove from
the chain via a [x]Remove button."*

`POST /api/chchain/remove {num,name}` → `removeChChainSlot`. The half that is
easy to miss: **deleting the row is not enough.** Whoever seated them is still
shouting the number, so a plain delete is undone within one beat and the button
reads as broken. The removal also blocks that (name, number) for the chain's
life.

**Kept deliberately narrow, because over-blocking is the worse failure — a chain
missing a real cleric kills the tank:**
- a *different* healer calling that number is a genuine re-assignment and seats
  normally;
- a roster announcement is the raid stating its own order, and clears the block
  for every slot it names;
- the block dies with the chain (5-minute idle reset) — it never carries into
  the next pull;
- on a **contested** slot the row survives and passes to the remaining claimant.
  This matters more than it looks: the LAST caller owns the row, so in Pyxil's
  own scenario she is the row's owner by the time anyone reaches for the ✕.
  Deleting the slot would have taken Mcdorf's 006 down with her.

## ⚠ Hover-reveal controls do not work on a repainting overlay

Worth its own entry because it is a general trap, not a CH-chain detail.

The ✕ was first built as a hover-reveal (`opacity:0`, `.row:hover .rmv{opacity:1}`)
to keep a resting chain looking untouched. **Measured in headless Chromium
against `chchain.html`:**

| row state | `.row:hover .rmv` opacity |
|---|---|
| idle | reaches 1 in ~100ms |
| **casting** | **stays 0 indefinitely** |

The rows' innerHTML is rebuilt on every paint while a cast bar moves, and a
freshly-created element under a **stationary** cursor never picks up `:hover`.
So the control would have been invisible precisely on the slot someone is trying
to fix, mid-fight — a new instance of the "the button does nothing" class of bug
that CLAUDE.md already lists for this overlay.

**Rule: on any overlay section that repaints, a control is always drawn and
merely dimmed.** The ✕ sits at opacity 0.30, brightening on hover, inside an
18px right gutter reserved by the row's padding so it can never cover the
countdown.

## Loot rows really are missing — 758 of them

**The question (Hitya).** Target Info → Loot showed *Silver Band of Secrets*
with no "N× won" pill, but Kazmodon had won it. *"Are we missing rows of loot
drops?"*

**Yes, and the boundary is exact.** Kazmodon won it at **raid 98561 for 150
DKP** — present in `opendkp_loot`, which syncs automatically and was current
(last fetch 02:22 that night, up to raid 100367). The Loot tab reads
`loot_observations`, which **stops at raid 96805 / 2026-06-04**: **758 awards
across 28 raids**, roughly ten weeks.

**Cause: two tables, one sync.** `opendkp_loot` has an automatic job.
`loot_observations` has none — it is only ever written by the officer command
`/backfillopendkploot`, and someone last ran it on June 4. Note `loot_drops` is
a third table and is **completely empty** (0 rows); nothing reads it for this
surface, but do not mistake it for the source.

**Where it lands.** Immediate: `/backfillopendkploot days:90`, no deploy needed.
Durable: a scheduled fold of new `opendkp_loot` rows into `loot_observations`
reusing the existing NPC resolution (single-NPC-drop = confident, multi =
ambiguous) — task #37, bot, after the raid freeze. Hitya: *"Yes we need that."*

**The shape to recognise.** A derived table fed only by a manual command looks
identical to a working one right up until someone notices a specific missing
row — the surface degrades silently and partially (older items still show
counts), which is why it survived ten weeks. Same failure family as the
Raid-Helper sync above: **any table whose only writer is a human running a
command needs a staleness alarm or an automatic feeder.**

## Live combined damage comes off the in-fight view

**The call (Hitya).** *"Instead of displaying the combined damage during the
fight, perhaps we just have the overlay give the last few mobs in a history tab
that can be opened up once it's properly deduped — the overcount from time skew
and whatnot is too much to account for in a live stat review and it is
legitimately doubling damage."*

Bot 3.1.44's corroboration estimator got the headline numbers right (Atlasius
99,979 vs his own 100k; Hitya, Damyu and Wabumkin all within ~1%), but
corroboration is a settling process and mid-fight it has not settled. The
decision is about **when** a number is shown, not whether the estimator works:
combined damage becomes a post-fight artifact, and the live view stays on what
this client observed itself. Task #38.
