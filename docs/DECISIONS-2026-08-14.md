# Decisions — 2026-08-14 (Aten Ha Ra raid night, continued)

Same raid session as `DECISIONS-2026-08-13.md`, past UTC midnight. That file
still holds the compat-mode / item-icon / dashboard-split write-ups; this one
carries the live **Open — read this first** table forward, so read this one
first and reach back for the older detail.

---

## Open — read this first

| Item | State |
|---|---|
| **Task #27 — the 8 muted trash triggers** | Gate is *"the fleet is on the fix"*, not *"the fix exists"*. Mimic 2.5.0 (agent 3.5.80) shipped 04:08 UTC and **nobody has installed it yet** — flipping the rows on now puts the wall back for every raider still on 2.4.x, which is exactly what the gate prevents. Also a raid-noise call, not a code change: it reaches the whole fleet in ~2 min with no review. Restore after the fleet has updated, on Hitya's word |
| **Mimic 2.5.0 — first raid** | The whole 2.5 line (History tab, CH ✕, dashboard split, pet fold, backup-log rule) is browser-verified and unit-tested but has not been through a raid. Sunday is the first real test |
| **Stale live-state can shadow fresher inferred buffs** | A character who returns after a swap keeps their OLD `character_live_state` buff list (Bwavair: 9 buffs, 2h old) because `live?.buffs ?? inferred` prefers any live row over inference. Not changed — she only has 2 observed casts, so falling back would paint a cleric RED "no buffs" and that is a worse lie than a timestamped stale list. Revisit if inferred coverage improves |
| **Item icons DISABLED — needs a local session** | The atlas maps to the wrong icon ids (633 = boots → shovel). Off behind `ICON_ATLAS_DISABLED` since web 1.1.50. Repack via `scripts/pack-item-icons.ps1` on the EQ machine, check `uifiles/default` is stock, and VERIFY 633 is boots before re-enabling |
| **Who rewrites guild chat?** | Hawkner + Syko ship punctuation-stripped, capitalised copies of lines they witnessed. Not our code (same agent build on both sides). Have Hawkner grep his own eqlog for one of the lines — that says client-side vs ours in one step |
| **Zeal `EPERM` → ask about compat mode FIRST** | XP compatibility mode on eqgame.exe kills the pipe, and the guide we recommend tells people to turn it on. Mechanism unconfirmed; `lastError` still isn't surfaced anywhere in the UI |
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

## A character swap ends when they log back in — and POSITION is what proves it

**The report (Hitya, live).** */raid* showed **Bwavair** under "Not seen /
offline — *(swapped to Bardtholemu)*", 2h ago, and Group 2 rendered "5 chars"
without her. In game she was right there in Group 2 with a full health bar.
*"Bwavair is Bardtholemu's wife, he will play her cleric if we are short on
some, she is online currently."*

**Everything upstream was correct.** Earlier in the night Bardtholemu really did
play her toon on his client, and the same-pid detector in `apps/mimic/main.js`
stamped a legitimate swap at **00:12:40**. The defect is that nothing ever ends
a swap: `swapFor` honoured the marker for a flat six hours, and a marked
character has `raidGroup` nulled and `inRaid:false`, which files them under
"Not seen / offline".

**Measured at 02:59, from `raid_roster`:**

| | group | loc | sampled |
|---|---|---|---|
| Bwavair | 2 | 109.13, −1705.99 → 109.14, −1705.95 (moving) | 0.3s ago |
| Bardtholemu | 8 | −392, −567 | 0.3s ago |

Two bodies, two groups, two positions, same instant, both moving. **One client
cannot do that**, so the swap was over hours earlier.

**The discriminator is POSITION, not presence** — and getting that right is the
whole decision. Presence in the raid window proves nothing: EQ keeps listing
people who camped, which is exactly *why* the swap marker was needed. But Zeal's
raid stream reads loc off a live `Entity*`, so **only someone actually in the
zone has one** — a camped body has none. A position stamped after `swapped_at`
(plus a 30s grace, since snapshots arrive ~1/sec and one can land from just
before the swap) means they logged back in. HP counts too; it is entity-derived
the same way.

Note the asymmetry that makes this safe: *presence* of loc proves life, *absence*
proves nothing (an online raider in another zone has no entity here either). The
rule only ever CLEARS a swap on positive evidence, never sets one.

Web 1.1.51, `web/app/raid/page.tsx`. Tests: `test/raid-swap-return.test.js` — 15
cases, including the ones that must NOT clear it.

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


## The post-raid change train — 2026-08-14

Five things shipped once the raid ended, in this order and for this reason.

**1. Bot 3.1.45 — OpenDKP loot folds itself in.** The night's own finding: a
derived table (`loot_observations`) whose only writer was a human command had
been ten weeks stale, and nobody could have known. Shipped first because it was
the explicit ask and because every hour it waits is more availability of the
kind that has no second copy.

**2. Mimic 2.5.0 stable.** Graduated the whole beta line — nine agent versions,
3.5.72 → 3.5.80 — because the two things Hitya hit live during the raid (the CH
chain picking up a spot-healer, the damage meter doubling people) were both
fixed on beta and both worth the fleet having before Sunday. A meaningful line
takes a minor bump.
- **The graduation was verified byte-exact, not assumed.** After promoting the
  files, `git diff origin/main origin/beta -- apps/mimic packages/wolfpack-logsync`
  returned exactly one line: the version park. That is the check worth repeating
  — a graduation that silently drops a file looks identical to one that doesn't.
- Beta re-parked at **2.5.1**, above the stable. A park at or below would tag
  prereleases that semver-sort *below* the stable and the updater would quietly
  stop offering betas. Discarding beta's history was safe because every beta
  build's commit stays reachable through its release tag (v2.4.1-beta.1 … .11).

**3. Web 1.1.52 — roadmap.** The 2.4.0 entry's headline feature was "the damage
meter now shows the whole raid", which 2.5.0 partly reverses. Leaving that
unqualified would have read as a regression rather than a correction.

**4. Bot 3.1.46 — Raid-Helper staleness alarm.** Same failure family as #1,
caught before it cost anything.

**5. Task #27 held.** See the Open table. Worth stating the general rule: *the
gate on a fleet-wide content change is whether the fleet has the fix, not
whether the fix exists.* The stable was minutes old; nobody had it.

**One process note, recorded because it nearly shipped to the wrong place.** The
RH alarm was committed while checked out on `beta` and pushed with
`git push -u origin main`, which reported "Everything up-to-date" — it pushed
the *local* `main` ref, which had not moved, while the commit sat on beta. The
tell is a push that succeeds with nothing to say. Cherry-picked onto main and
beta reset. Check `git branch --show-current` before committing, not after.
