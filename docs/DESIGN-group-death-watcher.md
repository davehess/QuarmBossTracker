# DESIGN — group/raid HP death watcher (#205)

*Written 2026-08-04 (overnight design pass). Unbuilt. Companion to
`docs/DESIGN-death-semantics.md` — that doc defines what a death IS; this one
adds a source of evidence that doesn't come from log text at all.*

**The ask (Uilnayar, 2026-08-03):**

> also for deaths, when we are in the raid the group containing the person that
> dies will have their health go to zero on the zeal pipe, and they would
> essentially leave the zone

---

## 0. Why this matters more than it looks

Every death we have ever recorded came from **one sentence in one log file**.
That single-source design is exactly what let the feign bug run undetected for
the entire life of the platform: `"<Name> dies."` is the feign-death emote, we
matched it as a real death, and **44% of every stored death was false**. Nothing
in the pipeline could contradict the log line, because nothing else was watching.

The Zeal pipe is a genuinely **independent channel**. It reads the client's
in-memory state, not its text output. And the discriminator falls out for free:

> **Feign death does not change your hit points.** A feigning shadowknight or
> monk sits at 80% HP while emitting a message that says they died. A real death
> is HP → 0. The two signals disagree *only* on feigns.

Had this existed, the feign bug would have shown up as "these deaths never have
an HP collapse behind them" on night one. That's the argument for building it:
not the deaths it will catch, but the **class of wrong** it makes visible.

## 1. What the pipe actually gives us

From `docs/zeal-pipe-protocol.md` (don't re-derive; this is the field reference):

| Source | Fields | Requires `/pipeverbose on`? |
|---|---|---|
| **gauges 11-15** | group member 1-5 HP, `text` = member name | no |
| **labels 30-34 / 35-39** | group member names / HP % | no |
| **gauges 40-44 / labels 17-21** | group PET HP | no |
| **type 6 (group)** | per-member `hp_current`, `hp_max`, `class`, `level`, **`zone_id`** | **yes** |
| **type 5 (raid)** | per-member `{name,class,level,group,rank,loc,heading}` + verbose `hp_current`, `hp_max`, `zone_id` | verbose only for the HP/zone |

Already wired: `_zealAbsorb` (`apps/mimic/main.js`) folds the gauges into
`self_hp_pct` / group HP, and the agent's raid-roster path
(`packages/wolfpack-logsync/index.js` ~7960) already prefers verbose
`hp_current/hp_max` over the gauge cross-ref and uploads `raid_roster`.

**So the data is already flowing. Nobody is watching it for zeros.**

## 2. The four ceilings (all measured, none negotiable)

1. **~1% granularity.** Zeal's per-mille is a container, not resolution — 300 of
   303 sampled values ended in exactly `.900`, an artifact, not precision. EQ
   exposes HP as an integer percent. So "0%" is a real bucket, but so is "a
   raider at 0.4% who is alive". Treat 0 as **a strong hint, not a fact**.
2. **The pipe samples; deaths are instant.** Gauges fire on change, but a raider
   can go 45% → dead between two frames and **never emit a 0 sample** — they just
   stop appearing. So "saw HP hit 0" is sufficient evidence but NOT necessary,
   and an implementation that only watches for literal zeros will miss most
   deaths. **Disappearance is the more common signature.**
3. **Disappearance is ambiguous.** Vanishing from the group/raid list means died,
   zoned, camped, went LD, or was removed from the raid. Alone it proves nothing.
4. **Coverage is per-group, not per-raid** unless verbose is on. Without
   `/pipeverbose`, a Mimic user sees only their own ~5-person group. With it,
   type 5 carries raid-wide HP. **This is the single highest-leverage thing to
   ask raiders for** — one `/pipeverbose on` per client turns a group-sized
   window into a raid-sized one, and it also unlocks `zone_id`, which is the
   "they left the zone" half of the ask.

## 3. The storage problem (read this before designing the table)

`raid_roster` looks like the obvious home. **It is not a history.** It is a live
snapshot with a **1-hour retention sweep** at midnight (`index.js` ~2992;
`RAID_ROSTER_RETENTION_HOURS`), and every reader filters to a 15-minute freshness
window. Nothing in it survives the night.

That's correct for its job and wrong for ours. A death watcher must **emit its
own durable evidence row at the moment it observes something**, because the
underlying snapshot is gone within the hour.

## 4. Design: an evidence record, not a verdict

Do not build "the watcher decides who died." Build "the watcher records what it
saw," and let the death-semantics layer combine it with the log.

Proposed `death_evidence` (append-only, one row per observation):

| column | meaning |
|---|---|
| `guild_id`, `subject` | who this is about |
| `observed_at` | when — **raw client stamp; apply `agent_clock_offsets` at read** (#202) |
| `observer`, `observer_discord_id` | which Mimic client saw it |
| `kind` | `hp_zero` \| `hp_collapse` \| `vanished_from_group` \| `vanished_from_raid` \| `zone_changed` \| `reappeared` |
| `hp_before`, `hp_after` | the transition (nullable) |
| `zone_id_before`, `zone_id_after` | verbose only |
| `verbose` | bool — was `/pipeverbose` on, i.e. how much do we trust the HP |
| `encounter_hint` | the observer's current target/boss, for correlation |

**`hp_collapse` is the one that carries the weight**, not `hp_zero`: a drop of
≥ N% between consecutive samples that terminates in disappearance covers ceiling
#2, where waiting for a literal zero does not.

### Combining rules (in the death-semantics layer, not the watcher)

Using the vocabulary from `DESIGN-death-semantics.md`:

- log `died.` **+** `hp_collapse`/`hp_zero` from ≥1 observer → **confirmed real**,
  and it needs no corpse-run tail, so it works for *other people's* deaths —
  which `death_confirm` (self-log only) structurally cannot do. **This is the
  main win.**
- log `died.` **+** observer had the subject in view **+** no HP collapse →
  **suspect**. Feign, or a sampling miss. Flag, don't delete.
- `hp_collapse` **+** no log line → real death nobody's log captured (a reporter
  gap). Worth surfacing: it tells us where our coverage is thin.
- `vanished_*` **alone** → **nothing**. Record it, score it at zero. It's only
  useful as corroboration.

### The bind-point wrinkle

Uilnayar, 2026-08-03: at Vex Thal people bind right outside, so a death is a
**5–10 second** round trip. So `zone_changed` away-and-back inside ~15s is a
*positive* death indicator, not a "they left" one — and a `reappeared` event
close behind a `zone_changed` should **strengthen** the death inference, not
weaken it. Anyone implementing "left the zone = gone" will get this backwards.
See `DESIGN-death-semantics.md` §4 for the bind-location capture that makes this
measurable per character rather than assumed.

## 5. Where it runs

**Agent-side**, in the Zeal absorb path, for one reason: it needs
sample-to-sample deltas, and the bot only ever sees debounced uploads. Emit on
transition only (same discipline as `_noteTargetSwitches` — rows proportional to
EVENTS, not samples), batch through the durable queue like everything else.

Rough volume: a raid night with ~10 deaths × ~5 in-group observers × ~3 event
kinds ≈ **150 rows a night**. Nothing.

## 6. Build order

1. **Ask the raid to turn on `/pipeverbose`** — zero code, converts group-scope
   to raid-scope, unlocks `zone_id`. Do this first regardless of the rest.
2. `death_evidence` table + agent transition emitter (`hp_collapse`, `hp_zero`,
   `vanished_*`).
3. Correlation in the death-semantics layer; surface a `death_source` chip on the
   parse card so a reader can see *why* we believe a death.
4. Only then consider using it to auto-correct history — and see the standing
   rule in `STATUS.md` #200/#201: history rewrites are Hitya's call.

## 7. Open questions for Hitya

- **Is `/pipeverbose on` something we can just ask for in Mimic's setup flow?**
  It's a client-global Zeal setting and it's the difference between seeing your
  group and seeing the raid. Mimic could detect it's off and prompt.
- **Do we want the "died but nobody's log recorded it" alert at all?** It's a
  coverage metric, not a raid tool — useful for us, possibly noise for raiders.
- **HP-collapse threshold:** what drop counts? 50%-in-one-sample is safe but
  misses slow deaths; 25% catches more and will fire on ordinary tank swings.
  Recommend deriving it from one clean raid night rather than picking a number
  now — same discipline as the dedup window (#201).
