# DESIGN — group/raid HP death watcher (#205)

*Written 2026-08-04 (overnight design pass). Companion to
`docs/DESIGN-death-semantics.md` — that doc defines what a death IS; this one
adds a source of evidence that doesn't come from log text at all.*

> **STATUS 2026-08-11 — the watcher is BUILT (agent, on `beta`); the durable
> `death_evidence` half of §4 is NOT.** What shipped feeds the in-agent death
> registry; nothing is uploaded and no table exists yet. Read §8 at the bottom
> before extending it — it records what was built, what was deliberately left,
> and one guard that is NOT in the design above.

**The ask (Hitya, 2026-08-03):**

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

---

## 8. What was actually built (2026-08-11, agent)

The design above predates the **death registry** that agent 3.5.58 added
(`_noteDeath` / `_clearDeath` / `_isDead` / `_deadNamesSnapshot`, born out of
`DESIGN-death-awareness-and-rez-queue.md`). That changed the shape of the first
increment: there is now somewhere for the evidence to GO that isn't a new table,
so the watcher shipped as **a second SOURCE feeding that one registry**, not as
the standalone evidence pipeline of §4.

Everything is in `packages/wolfpack-logsync/index.js`, immediately below the
registry it feeds:

| Piece | What it does |
|---|---|
| `_groupHpObservations(st, self)` | one Zeal snapshot → `{nameLower → {name, pct, verbose}}`. Reads **gauges 11-15** and, when `/pipeverbose` is on, the exact `hp_current/hp_max` off the type-6 group payload (exact wins). |
| `_noteGroupHpFromState(character, st, now)` | the transition watcher. Called from the `/api/zeal-state` POST handler beside `_noteMobHealFromState` — the only place sample-to-sample deltas exist (§5). |
| `noteFeignEmoteLine(line, at)` | records `"<Name> dies."` sightings. Raw-line hook in the live tail next to `_cancelTimersOnMobDeath`. |
| `_groupDeathWatchSnapshot()` | per-name diagnostic: last pct, dwell, why a zero did or didn't count. |

Tests: `test/group-death-watcher.test.js` (source-sliced, 25 cases, plus an
end-to-end pair against the real registry).

### The guard that is NOT in the design above
§0 rests on *"feign death does not change your hit points"*. **That premise has
never been checked against a live feigning groupmate's GAUGE** — only against
how EQ works — and a monk in the corpse list is exactly the false positive that
gets the feature switched off. So a third guard was added and is recorded here
as a decision: **a zero is refused for 60s after that name's feign emote.**
`"<Name> dies."` is the `cast_on_other` text of every Feign Death spell
(`test/feign-death-not-a-death.test.js`); `parseEvent` deliberately returns
nothing for it, so until now **nothing in the agent knew a feign had happened**.
Cost of the guard: a knight who feigns and then genuinely dies inside a minute
is invisible to the watcher — the log path still records it, so the loss is
corroboration, not a death.

### A fourth guard the design didn't anticipate: zoning
A groupmate who **zones** can sit at 0% in the group window for as long as the
load takes — longer than any dwell will ever be. `/pipeverbose` already carries
each member's `zone_id`, so when it proves they are not in our zone the zero
neither starts nor advances a dwell. **Deliberately asymmetric**: an *alive*
reading from another zone is still alive evidence and still clears the registry
— that is the bind-point round trip in §4.
⚠ **Residual risk, stated plainly: without `/pipeverbose` we cannot tell a
zoning groupmate from a dying one.** That is one more reason §6 step 1 (ask the
raid to turn verbose on) is worth more than any code here.

The other two guards implement §2 ceiling 1 ("a zero is a strong hint, not a
fact"): a name must have been seen **alive** first (a slot reading 0 on first
sight is an unrendered gauge), and the zero must **hold** — ≥2 samples spanning
≥2.5s. That second one has a concrete target: Zeal emits occasional *negative*
per-mille values (observed −3 on 5 live rows, 2026-08-03) and `apps/mimic/main.js`
clamps them into `[0,100]`, so **a single-sample zero is a known artifact
shape.** Dwell is kept short on purpose — a player who releases to bind is alive
again in 5–10s (the §4 bind-point wrinkle), so a long dwell misses the corpse
rather than merely arriving late.

### Registry semantics the watcher must not break
- **It never re-stamps a death the log already recorded.** Re-noting would push
  the death forward and extend the 15-minute forget window, which is the one
  thing the registry is built not to do. That path counts as corroboration only.
- **A death is stamped at the FIRST zero sample**, not at the moment we finished
  being sure.
- **Alive evidence clears** (the registry's own rule: "a rez, or any fresh
  self-HP") — but never a death younger than 5s. The log line and the gauge race
  each other, and right after a death the gauge can still be carrying the last
  live value; clearing on that would let a stale frame overrule a
  corpse-run-confirmed log death.
  ⚠ Note this is a *different question* from §4's bind-point wrinkle: "did a
  death happen" (evidence — where a reappearance STRENGTHENS the inference) vs
  "is this person a corpse right now" (the registry — where a reappearance ends
  it). Don't let the two rules cancel each other out when the evidence table
  gets built.

### Deliberately NOT built
- **`death_evidence` (§4) and everything downstream of it** — the table, the
  upload, the `death_source` chip. That spans a migration + a bot endpoint (bot
  ships from `main`, agent from `beta`), and none of it is needed for the
  registry to get its second witness.
- **`hp_collapse`** — §7 says to derive the threshold from a clean raid night
  rather than pick one now, and that is still the right call; a collapse-only
  path with an invented threshold would fire on ordinary tank swings. The
  watcher therefore records **sustained zero only**.
- **`vanished_*` / `zone_changed`** — §4's own combining rules score a bare
  disappearance at zero, so emitting one buys nothing without the table.

### Stale in the sections above (checked 2026-08-11)
- §1's `~7960` for the raid-roster verbose preference is now **~8296**; §3's
  `~2992` for the retention sweep is bot `index.js` **~2966**. Line numbers in
  this repo rot fast — grep the identifier.
- §5 cites `_noteTargetSwitches` as the emit-on-transition precedent. That
  function is in the **bot**, not the agent; the discipline is right, the
  address isn't.
- §6 step 1 / §7's first open question ("can we just ask for `/pipeverbose on`?")
  is **partly answered by shipped code**: the dashboard's 🔌 Zeal Pipe card
  already detects it (`pipe_verbose`, proved by `hp_current` being present) and
  shows a "verbose off (`/pipeverbose on` for raid HP)" nudge. What does not
  exist is a prompt in Mimic's *setup flow*, which is what the question was
  really asking for.
- §2 ceiling 2 says an implementation watching only for literal zeros "will miss
  most deaths". That is right about the *transition* and unproven about the
  *state*: a corpse should HOLD at 0 in the group window until rez or bind, and
  a held value gets sampled even when the edge is missed. **This is the first
  thing to measure on a raid night** — `_groupDeathWatchSnapshot()` plus the
  registry is enough to tell whether zeros are being seen at all. If they are
  not, the collapse path becomes necessary rather than optional.
