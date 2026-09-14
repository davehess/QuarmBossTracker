# Raid-night timeline · Central HUD · Reuse timers — design (Hitya, 2026-09-13)

**Status:** planned, nothing built. Three asks from Hitya on the Sunday raid:
1. *"a visualization of the mobs and trash in the night, full timeline view"*
2. *"a central hud that would outline your character with hits and misses,
   current target's name and health, your own health and mana totals"*
3. *"a configurable 'How Many ____ Casts left' or timers for critical class
   components"* — clarified: *"timers shown for mend, kick, etc lay hands AA
   cooldowns, discs"*.

Options per piece, costed on the four numbers (build · maintenance · runtime ·
change). Hitya picks; nothing in Mimic moves until the mini-mode picks land.

---

## 0. What already exists (build on it, do not rebuild it)

| Need | Where it already lives | Gap |
|---|---|---|
| Every fight of a night, with start/end/duration/zone | `encounters` bound to `raid_nights` (11–85 fights per night this month) | `classification` is NULL on every recent night — boss vs trash must come from `bosses_local.npc_id` + `eqemu_npc_types` level/HP |
| Deaths, slows, mob heals, enrage inside a fight | `encounter_timeline()` data layer + `FightTimeline` on `/raid/review/[date]` (`DESIGN-fight-timeline.md`) | night-level view across fights does not exist |
| Loot + bids with ms timestamps | `looted_items`, `opendkp_auctions` / `_auction_bids` | none |
| Attendance ticks | `raid_attendance_ticks` | none |
| Own HP / mana, current and max | Zeal pipe → `character_live_state.self_hp_cur/max`, `self_mana_cur/max` (exact for the local character) | none |
| Current target name + HP | Zeal gauge slot 6 | none |
| Hits / misses / dodge / parry / riposte / block **on you** | `defenderStats` per fight, from the log, swing by swing | not surfaced on any overlay as a live per-swing signal |
| Discipline cooldowns | `_matchDiscLine` → `readyAtMs`, served as `state: cooldown` + `cooldown_secs` (the DA/Invuln tracker) | warriors only today; the emote list is what limits it |
| Divine Intervention ready-at | `di_ready_at` on live-state | cleric only |
| Mend | `sessionMends` counts attempts/crit/fail | no timer |
| Per-trigger countdown timers | trigger engine `timer_duration_sec` + `warning_seconds` | a member can build "Harm Touch → 72:00" as a personal trigger TODAY; no ready-state, no class presets |
| Spell mana cost + recast | spell catalog `raw` column (the full `eqemu_spells` row rides along) | confirm `raw.mana` / `raw.recast_time` survive the agent's catalog trim before relying on them |
| AA → recast | `eqemu_altadv_vars.spellid` → `eqemu_spells.recast_time` | the mirror has no `spell_refresh`; AA reuse is read through the spell |
| Skill reuse (Kick, Bash, Flying Kick, Mend, Taunt…) | nowhere — client-side constants | a small authored table, ~15 rows |

---

## 1. Night timeline (web — `/raid/review/[date]`, preview on `b.wolfpack.quest`)

The review page is already "one URL per night"; the night view goes at its top so
nobody learns a second address. Per the UI rule, variants land as `?v=a|b|c`.

### A — Night strip (recommended)
One horizontal axis, 8pm → midnight ET. Each fight is a bar sized by duration;
bosses tall and coloured by zone, trash short and dim; deaths as red ticks on the
bar; loot awards as gold pins under the axis; attendance ticks as thin vertical
rules. Hover = the fight card (name, duration, DPS, deaths); click = that fight's
`FightTimeline` below. Pure CSS grid + absolutely positioned bars, no chart
library. Mobile: the axis scrolls horizontally inside its own container.
- Cost: build **low-med** · maint **low** · runtime **low** · change **low**.
- Reads at a glance: "eleven kills, two long gaps, deaths clustered on Kaas".

### B — Zone swimlanes
Same axis, one lane per zone (or per pull group); fights sit in their lane, so
travel and med breaks show as empty stretches across all lanes. Adds a pacing
stat line: average gap between kills, longest gap, time in combat vs not.
- Cost: build **med** · maint **med** · runtime **low** · change **med**.
- Earns its lane only on multi-zone nights; on a single-zone night it IS option A
  with a label.

### C — Ledger with a gantt column
A vertical chronological list (time · mob · duration · deaths · loot) with a
narrow proportional bar per row. Mobile-first, prints well, no hover needed.
- Cost: build **low** · maint **low** · runtime **low** · change **low**.
- Weakest at "how did the night flow", strongest at "what dropped when".

**Recommendation:** A, with B's pacing stat line (gaps) folded in as text under
the strip, and C's row list as the existing kills list below. Prerequisite for
any of them: a boss/trash classifier at query time (tracked-boss npc_id, else
level ≥ 55 and HP ≥ 100k reads as "named", else trash) — the `classification`
column stays NULL, so it must be derived, not read.

---

## 2. Central HUD (Mimic overlay, new)

The reader is mid-fight, so the frontend-design rule applies hardest here:
screen centre is sacred, motion is a cost, colour is semantic. All three options
are click-through when locked and sit ≤ 300 px wide.

### A — Three-bar strip
Bottom-centre, three stacked bars: target name + HP · own HP (cur/max) · own
mana (cur/max), numbers right-aligned. Under them a one-line incoming ticker:
each swing on you appends a chip — red `214` for a hit, hollow grey `miss`,
blue `dodge` / `parry` / `riposte` / `block` — newest right, six deep.
- Cost: build **low** · maint **low** · runtime **low** · change **low**.
- The safe default; nothing new in the sightline.

### B — Ring HUD (the ask, literally)
A transparent ring around screen centre. Top arc = target HP with the name
above it; bottom-left arc = own HP; bottom-right arc = own mana; numbers sit
just outside each arc. Incoming swings flash on the rim: a solid red tick with
the amount for a hit, a hollow tick for miss/dodge/parry/riposte/block,
fading over ~1.5 s. Nothing is drawn inside the ring, so the character stays
visible; the rim carries all the information.
- Cost: build **med** (SVG arcs + tick placement) · maint **low** · runtime
  **low-med** (repaint per swing — throttle to one frame per 100 ms) · change
  **med** (arc geometry is the thing you revise).
- This is the "outline your character" ask. The risk is motion in the sightline;
  the mitigation is the fade and a Settings switch for "ticks: amounts / dots /
  off".

### C — Corner brackets
Four short brackets framing the centre: target above, own HP left, mana right,
the swing ticker below. Fewest pixels near centre; reads like a camera viewfinder.
- Cost: build **low-med** · maint **low** · runtime **low** · change **low**.

**Recommendation:** B as the signature, A as its mini (the mini-mode rule will
want one anyway). Both read the same `/api/state` fields; no new agent data.
Feature-parity checklist applies in full (✕, ✥ + right-click, hover handshake,
`WP_OVERLAY_ROWS`, `apply*Visibility`, `_HIDEALL_FLAGS`, `_overlayEntries`).

---

## 3. Reuse timers + "casts left"

### Timers — what gets tracked
| Kind | Examples | Reuse comes from | Activation line |
|---|---|---|---|
| Skills | Kick, Bash, Flying Kick, Tiger Claw, Backstab, Frenzy, Taunt, Mend, Feign Death | authored table (client constants) | the skill's own log line — already parsed for damage and for "You try to kick X, but miss!"; Mend from its three outcome lines, already parsed (`type: 'mend'`: "You mend your wounds and heal considerable damage." / "…heal some damage." / "You fail to mend your wounds.") |
| AAs | Lay on Hands, Harm Touch, Hand of Piety, Divine Arbitration… | `eqemu_altadv_vars.spellid` → `eqemu_spells.recast_time` where the spell carries it; authored table where it does not | the landing line from the catalog (below) paired with the caster's own same-second line |
| Discs | Defensive, Evasive, Furious… | already tracked (`_matchDiscLine`) | already tracked |

**Read directly from the catalog (Hitya, 2026-09-13: "these could be read
directly") — nothing here is from memory:**

| Spell | id | recast | lands on other | lands on you |
|---|---|---|---|---|
| Lay on Hands | 87 | 4,320,000 ms = 72 min | `feels a healing touch.` | `You feel a healing touch.` |
| Hand of Piety (AA 534, 3 ranks) | 3261–3263 | 72 min | `feels a healing touch.` | `You feel a healing touch.` |
| Harm Touch (88; AA 207 "Improved Harm Touch" → 2821) | 88 / 2821 | 72 min | `writhes in the grip of agony.` | `You writhe in the grip of agony.` |
| Divine Arbitration (AA 507, 3 ranks) | 3252–3254 | **0 in the spell row** — the AA's own reuse is not in the mirror | none (no text) | none |

All four are `cast_time 0`, so there is NO "You begin casting" line to hang the
timer on. The caster is attributed by the same-second pair the parser already
builds: a Lay on Hands on someone else is `You have healed <target> for N
points.` (first-person heal, parsed) beside `<target> feels a healing touch.`;
a Harm Touch is the anonymous `<target> was hit by non-melee for N` beside
`<target> writhes in the grip of agony.` on the caster's own target. Known false
positive: another paladin's touch on ME prints `You feel a healing touch.` too —
suppressed when a third-person heal line names them in the same second, and
otherwise cheap, because the in-game button is the ground truth. Divine
Arbitration has no landing text at all, so its timer starts from the AA
activation the way disciplines do, and its reuse lives in the authored table.

### Display options
- **A — Rows inside the Central HUD.** Under the mana bar: `Mend 4:12 · Kick
  ready · LoH 61:03`. Cost: low · low · low · low. Only as good as the HUD.
- **B — A "Cooldowns" overlay (recommended).** Its own window, like Charm and
  Pet: one row per tracked ability with a countdown bar, green when ready, TTS
  "Mend ready" through the trigger engine's existing voice path. Class presets
  (a monk gets Mend + Flying Kick + FD by default) plus add/remove in Settings.
  Cost: build **med** · maint **low** · runtime **low** · change **low**.
- **C — Personal triggers only (zero build, the interim).** Each timer is a
  personal trigger with `timer_duration_sec`. Works on every Mimic today; no
  ready-state, no presets, duplicated per character. Use it NOW to harvest the
  exact activation lines that B needs.

### "How many ____ casts left"
`floor(mana_cur ÷ spell.mana)` for one chosen spell, shown as `CH ×12` beside
the mana bar (HUD) or as a row in the Cooldowns overlay. Configurable in
Settings with catalog autocomplete; class default = the spell the raid depends
on (Complete Heal, Torpor, Slow…). Own mana is exact off the pipe; mana cost
comes from the catalog. Cost: low · low · low · low. The only trap is a
level-scaled mana cost, which the catalog does not model — show the base and say
so.

---

## 4. Order, and what needs Hitya

1. **Timeline first** — web only, no Mimic change, and the data is there: the
   classifier + option A on `beta` as `?v=a`, B as `?v=b`, side by side on
   `b.wolfpack.quest/raid/review/<date>`.
2. **Timers, interim** — personal triggers for the members who want them now
   (the lines above are what to paste into them).
3. **Cooldowns overlay + casts-left**, then **Central HUD** — after the
   mini-mode picks land (Hitya, 2026-09-11: build nothing in Mimic until then).

Hitya's calls: ring vs strip for the HUD; whether the night view lives on the
review page (recommended) or its own route; class presets for the Cooldowns
overlay. The activation lines are settled from the catalog and the parser —
no excerpt needed.
