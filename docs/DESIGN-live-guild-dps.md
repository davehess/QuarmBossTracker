# DESIGN — guild-reported vs locally-captured DPS, live

**Ask (Hitya, 2026-08-13):** *"Can the DPS meter have the guild-reported version
as well as the locally captured while the fight is going and show the diff?"*

**Status: BUILT 2026-08-13** - bot 3.1.41 (`GET /api/agent/live-damage`),
agent 3.5.71 (fight-gated read + `stats.guildDamage`), HUD rows in
`apps/mimic/overlay.html`. Tests: `test/live-damage-merge.test.js` (11) +
`test/hud-guild-merge.test.js` (10).

---

## 1. Why this is worth building — measured, not assumed

Five real fights from the last two days. `merged` is
`encounters.total_damage` (what `merge_encounter_players` settled on); the two
percentages are the BEST and WORST single uploader's view of the same fight,
from `contributions.total_damage`:

| merged | uploaders | best single view | worst single view |
|---|---|---|---|
| 1,017,493 | 13 | 115.5% | **5.8%** |
| 757,506 | 8 | 100.5% | **3.4%** |
| 564,677 | 14 | **146.1%** | 5.3% |
| 551,759 | 11 | 112.9% | 8.3% |
| 261,998 | 9 | 111.4% | **0.1%** |

**The worst local view sees 0.1–8.3% of the fight.** Somebody who zoned in late,
died early, or sat in another group is looking at a meter showing a twentieth of
what happened and has no way to know. That is the case for the feature, and it
is much stronger than "nice to compare".

⚠ **But the best local view EXCEEDS the merged total, by up to 46%.** That kills
the obvious framing before it gets written: the guild number is **not truth** and
the local number is **not a subset of it**. `merge_encounter_players` takes
max-per-player across submitters and then applies guild-scoped rules — excluded
characters (`exclude_from_stats`), pet folding, non-roster names — so a local
meter can legitimately count damage the merge deliberately drops. Present the two
as **two different scopes**, never as "wrong vs right".

## 2. The data already flows live — no new capture

`encounter_threat_snapshots` is written **during** the fight, one row per
uploader per tick, `per_player` jsonb keyed by character with cumulative `dmg`.
Measured cadence on real fights: **3.5–6.4s**. That is the same series
`DESIGN-fight-timeline.md` is built on, and it is already arriving while the
fight is in progress.

So this needs **no agent-side capture change at all**. What is missing is a way
to read it back: `/api/agent/threat-snapshot` is **ingest-only**, there is no GET.

## 3. The four things that make this harder than it looks

**a) Live fights have no `encounter_id`.** Snapshots carry `boss_name` +
`snapshot_at`; the encounter row is created and bound later. Live, a fight is
addressable only as `(boss_name, started_at-ish)`. `DESIGN-fight-timeline.md`
records the trap in detail — historically only **2.6%** of fights had any
snapshot bound, and the cause was a name-format mismatch (`Kaas_Thox_Xi_Ans_Dyek`
vs spaces) that made equality match only single-word bosses. Any live join must
normalise through `npc_display_name()`.

**b) Merging is max-per-player, never sum.** Summing uploaders double-counts
every player seen by more than one. The fight-timeline doc measured the related
error at **~2.4× over-count** when maxing per-bucket deltas. For a LIVE
scoreboard the right shape is: per player, take the **maximum cumulative `dmg`
any uploader currently reports**. That is the same idiom
`merge_encounter_players` uses, and it degrades correctly — as more uploaders
report, each player's number can only rise toward truth.

**c) Uploaders disagree about when.** `agent_clock_offsets` exists precisely
because agent clocks drift. For a cumulative live total this matters less than
for the timeline (we compare current values, not deltas at a bucket), but the
"newest snapshot per uploader" selection must use the bot's receive time, not
the agent's claimed timestamp.

**d) `threat_snapshot` is SHEDDABLE.** It is in the mid-raid load-shed list, so
during a shed the guild view silently stops updating. The UI must be able to say
"guild view is stale/paused" rather than quietly showing a frozen number that
looks live — that is exactly the class of failure this platform keeps writing
down.

## 4. What to actually show — the recommendation

The instinct is two columns, yours and the raid's, per player. **Do not build
that first.** Thirty paired numbers on an overlay read mid-fight is noise, and
the frontend-design constraints are explicit that the reader is being hit by a
dragon.

The question the measurement above says people actually have is not
*"how does my Wabumkin number compare?"* — it is **"am I even seeing this
fight?"** So lead with coverage:

```
DAMAGE                    ⚠ you are seeing 38% of raid damage
1  You          51 dps
2  Statlander   44 dps
...
```

- **One coverage line**, computed as `local total / guild max total`. That is the
  0.1%-of-the-fight case surfacing itself.
- **Chip only when material.** Under ~85% coverage it is worth saying; at 95%+
  it is noise and should not draw the eye at all.
- **Per-player guild numbers behind a toggle**, not on by default. Same data,
  one keypress, off the critical path.
- **Never colour the local number as "wrong".** Per §1 it can legitimately be
  higher.

## 5. Shape of the build

| Step | Where | Notes |
|---|---|---|
| 1 | **bot** `GET /api/agent/live-damage` | newest snapshot per uploader for a boss, merged max-per-player. Memo-cached ~2s, exactly like the extended-target bundle's 1.5s memo — ~20 agents polling one query. |
| 2 | **agent** | ⚠ **DEVIATED, deliberately.** Hung off the threat-snapshot uploader instead of the #106 bundle. The bundle is CADENCE-gated - its streams tick on their own clocks whether or not anything is happening - while this stream is FIGHT-gated. Reusing the uploader's existing `flushedAt`/`perPlayer` guard makes it cost exactly zero between pulls and adds no new schedule. |
| 3 | **HUD** `overlay.html` | coverage chip + toggle. Reads `/api/state` like everything else. |
| 4 | **staleness** | if the newest guild sample is older than ~30s, or a shed is active, say so rather than showing a frozen number. |

**Cost check before building:** one extra Supabase read per ~2s per raid (not per
agent, thanks to the memo), against a table already being written 3.5–6.4s per
uploader. That is small — but it is a NEW read on the hot path during a raid, so
it belongs behind the same `flag_shed_*` treatment as everything else.

## 6. DECIDED (Hitya, 2026-08-13)

### Display: guild number primary, your own observation in parentheses

> *"Showing diff would be nice to show what you observed in parenthesis if we
> can transmit the full amounts and show what we've seen."*

```
DAMAGE
1  Statlander    212k (44k)
2  You           187k (187k)
3  Wabumkin      164k (0)
```

**Guild-merged is the headline; the parenthetical is what THIS machine saw.**
That is better than the coverage line I proposed in §4, and it supersedes it:
one aggregate percentage tells you that you are missing something, whereas the
parenthetical tells you *which players* you are blind to. The Wabumkin row above
is the whole feature in one line - he did 164k and this client saw none of it.

It also means the per-player comparison is the DEFAULT rather than a toggle, so
§4's "coverage first, columns behind a toggle" is withdrawn. Keep the staleness
rule from §3d: if the guild side is shedded or stale, say so - a frozen number
in the headline position is worse than no number.

⚠ Requires the guild payload to carry **full per-player totals**, not just a
raid sum. That is what `per_player` already is, so no capture change - but the
read endpoint must not pre-aggregate.

### Exclusions: upload-side only, and it ALREADY WORKS THAT WAY

> *"if someone excluded their character they should just not be uploading that
> character, but if they show up from someone else's stats they should be
> shown."*

This is the existing behaviour, not a change. `index.js` (~12511): the agent
polls `/api/agent/character-prefs` and **suppresses outbound uploads** when
`exclude_from_stats` is set - `stats.characterPrefs` gates the parser character,
the Quarmy export scan and the historical backfill.

So the live view needs **NO read-side exclusion filter**, and adding one would
be actively wrong: it would hide a player from the observers who legitimately
saw them. The opt-out means "my client does not report ME", not "erase me from
everyone else's meter".

⚠ Do not "fix" this later by filtering on read. The distinction is the policy.

## 7. Still open

- Nothing blocking. Build order is §5; the only judgement left is whether the
  parenthetical shows raw damage or a percentage, which is a five-minute change
  once it is on screen and worth deciding by looking at it mid-raid.
