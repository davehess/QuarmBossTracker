# DESIGN — callout overlay: countdowns, dismissal, and learning from it (#207)

*Written 2026-08-04 (overnight design pass). Unbuilt. Read alongside
`DESIGN-di-callout.md` (#204) and `DESIGN-mechanic-capture.md` (#206) — both
depend on this being the surface their callouts land on.*

**The ask (Hitya, 2026-08-03):**

> the TTS messages need to have their messages with countdowns reflected visually
> on that overlay. the AOE dodges/dance should be on there. and those line should
> be dismiss able AND we should track when things are dismissed so we learn from
> items that people either don't care about or may be inaccurate

Three asks, and the third is the one with teeth.

---

## 1. What already exists (more than you'd expect)

`apps/mimic/triggers.html` (772 lines) already has:

- **Sticky callouts (#76)** — a fire flagged `sticky` pins a row until clicked or
  5 minutes elapse, instead of fading at 3.5s. Keyed on `trigger|text` so a
  repeat refreshes rather than stacks. **Click-to-dismiss is already there.**
- **Timer chips (#107)** — GINA-style `[remain] [Target - Effect]` rows with a
  scaleX progress bar, and a per-chip ✕ when `t.dismissible`, which POSTs
  `/api/timers/cancel`.
- **A timing-feedback widget** — 👍 / "earlier" / "too early" buttons that POST
  `/api/triggers/feedback` → `trigger_timing_feedback`.
- The hover-interact handshake on every control (required — locked overlays are
  click-through).

So the visual vocabulary is built. What's missing is the wiring, and one table.

## 2. The three gaps

### Gap A — a spoken countdown has no visual twin, by default

A trigger's TTS is free text on the `text_overlay` action. `"FEEBLEMIND OUT"` at
26s is spoken because someone wrote the words and separately set
`timer_duration_sec`. Nothing connects them: the countdown the raider *hears* and
the countdown they can *see* are two independently-configured fields, plus
`warning_seconds`/`warning_text` as a third. **Three fields to get one callout
right is why callouts are half-configured.**

Design: **one timed callout, one configuration.** When a trigger has
`timer_duration_sec > 0`, the overlay should render its countdown chip
automatically and speak from the same source, with the pre-end warning derived
rather than re-entered. Authors write "what to say and when"; the overlay derives
"what to show". Keep the portable action shape (`text_overlay` + `tts`) — it must
still fire on every Mimic version (CLAUDE.md, guild trigger shapes).

### Gap B — dismissals vanish

`dismissSticky()` removes the DOM row and calls `overlayHoverInteractive(false)`.
**That's all it does.** The single most honest signal we could collect — *a raider
looked at this callout mid-fight and swatted it away* — is discarded at the point
of collection.

Compare with what we get from asking: `trigger_timing_feedback` has **47 votes
from 7 people across a month**. That is not enough to tune anything, and it never
will be, because pressing a feedback button during a raid competes with playing.
**Implicit signal beats explicit signal here** — dismissal costs the user nothing
extra because they were already dismissing.

### Gap C — you cannot interpret dismissals without exposures

This is the part that will get built wrong if it isn't stated: **3 dismissals is
damning if there were 3 fires and meaningless if there were 300.** A dismissal
count alone is not a signal; a dismissal *rate* is.

And we currently have no durable fire record. `_recentFiresFor` (`index.js`
~13420) serves from an **in-memory relay ring buffer** — it exists to fan fires
out to other clients, and nothing persists. Restart the bot and the history is
gone.

**So the prerequisite for learning from dismissals is recording fires.** Do that
first or the rest is decoration.

## 3. Design

### 3.1 Persist fires (prerequisite)

A `callout_fires` row per fire: `guild_id`, `trigger_id`, `trigger_name`,
`fired_at` (raw stamp; correct with `agent_clock_offsets` at read — #202),
`observer`, `encounter_hint`, `captures` (the named groups, which is what makes a
fire diagnosable later).

Volume check before anyone panics: our busiest triggers fire a handful of times
per pull. Even at 40 raiders × 20 fires × 20 pulls that's ~16k rows a night —
same order as `target_observations`, and this one is far more compressible
because a fire is guild-wide (dedup by `trigger_id + fired_at` bucket, keep an
observer count instead of a row each). **Record one row per FIRE with an
observer count, not one per observer.**

Reuse the existing shed/budget machinery (`flag_shed_*`, `budget_*_per_min`) so
an officer can turn it off mid-raid without a deploy — it's an ephemeral,
re-derivable stream by the `_SHED_NEVER` rule, so it must be sheddable.

### 3.2 Record dismissals as a direction, not a new table

Extend `trigger_timing_feedback` rather than adding a table — it already has
`trigger_id`, `trigger_name`, `direction`, `fired_at`, `voted_at`,
`voter_character`, `note`. Add directions:

| direction | meaning | source |
|---|---|---|
| `dismissed` | user clicked ✕ / the row | implicit |
| `expired` | row aged out untouched | implicit, the **control group** |
| existing `good` / `earlier` / `too_early` | | explicit |

Recording `expired` is what makes the rate computable without joining to fires
for the common case, and it costs one counter.

**Latency matters and should be stored**: `voted_at − fired_at` on a `dismissed`
row separates *"I swatted this instantly, it's noise"* (< 1s) from *"I read it,
acted, then cleared it"* (several seconds). Those are opposite verdicts and a
plain count conflates them.

### 3.3 Surface it: callout health on `/admin/triggers`

Per trigger: fires, dismissal rate, median dismiss latency, explicit votes, and
last-fired. Sort by dismissal rate descending and the top of that list is
**exactly the answer to "what do people not care about or not trust"** — the ask,
delivered as a list an officer can act on.

Pair it with the dead-trigger check this session already justified twice (the DI
trigger matched nothing; the `^`-anchored batch #190 was dead): **a trigger that
is enabled and has never fired should be flagged on that same page.** Zero fires
and high dismissal rate are the two failure modes, and one page can show both.

### 3.4 What NOT to do

- **Don't auto-disable triggers.** A high dismissal rate on a Death Touch callout
  might mean "annoying", or might mean "we've learned this fight and don't need
  it *yet*". Surface, propose, let an officer decide — same rule as the mechanic
  auto-suggest (#206 §2).
- **Don't make dismissal per-person sticky.** Personal mute is a different
  feature (`character-prefs` opt-outs) and conflating them destroys the signal:
  you'd stop showing the callout and then conclude nobody dismisses it.
- **Don't show a name-and-shame view.** Dismissals are behavioral data about
  individuals. Aggregate by trigger. Per-person detail is officer-only at most,
  and honestly isn't needed for the decision this feeds. See `PRIVACY.md` and the
  stat visibility scopes in CLAUDE.md — this is `ANON` at best.

## 4. Overlay work proper

- **Countdown rows for TTS callouts** — reuse the existing timer-chip renderer;
  it already draws remaining time and a progress bar. The chip should carry the
  callout's own text, not a generic label.
- **AoE dance / dodge lines** get the sticky treatment (#76) plus a countdown,
  because "move now" has a duration and a plain flash doesn't convey it.
- **✕ on every callout row**, sticky and transient alike, with the
  hover-interact handshake (overlay feature-parity checklist item 3 in CLAUDE.md
  — without it the click falls through to EQ and the button "does nothing").
- **Layout:** keep the ~30px right gutter free. The fixed ✕ has already eaten a
  stray click once (Buff queue class picker, CLAUDE.md).
- Every `<details>` this emits must use `wpKeep(...)` if any of it lands in the
  agent dashboard rather than the overlay — enforced by
  `npm run check:dashboard`.

## 5. Build order

1. `callout_fires` + fire persistence (prerequisite for everything else).
2. `dismissed` / `expired` directions + dismiss-latency on the existing table;
   wire `dismissSticky` to POST.
3. Countdown chips auto-derived from `timer_duration_sec`; collapse the
   three-field config to one.
4. Callout-health panel on `/admin/triggers`, including the never-fired flag.
5. Only then: suggestions ("this callout is dismissed 80% of the time — retire
   it?").

## 6. Open questions for Hitya

- **Is a dismissal a vote?** I've assumed *"dismissed fast = didn't want it"*. It
  could equally mean *"got it, thanks, clearing my screen"* — which is a
  compliment. The dismiss latency split is my proposed discriminator, but the
  threshold wants real data before it's trusted (same discipline as #201).
- **Should dismissal be raid-wide or personal?** One raider dismissing a Death
  Touch callout shouldn't clear it for everyone. Assumed personal-view-only, but
  a lead might want "dismiss for the raid" for a stale callout mid-fight.
- **How long do we keep fire rows?** `raid_roster` keeps 1h, `target_observations`
  has a sweep. Fires are only useful in aggregate after a few weeks — suggest
  keeping the rows 90 days and a rolled-up per-trigger tally forever.
