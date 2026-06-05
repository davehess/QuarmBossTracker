# Trigger System + Platform Roadmap (DnDOverlay-inspired)

Captured 2026-06-05. This is the design research + future-state for bringing a
DnDOverlay-class trigger/event system into our stack, plus the related overlay
work (charm tracker, buff timers, mob-info). Read this before resuming.

Source studied: **DnDOverlay** by Luter (`gitlab.com/zeraxx1/DnDOverlay`) — an
Electron EQ overlay with a powerful event-driven trigger engine. We have his
full config export (7 `.dno` files) + key source files mapped.

---

## The core architectural decision (READ FIRST)

**Luter's model is fully LOCAL** — every player runs the whole engine, parses
their own log, fires their own overlays + local TTS. Synchronized + low-latency
because it's one process. Cost: every player sets up overlays/triggers/TTS.

**Our model is CENTRALIZED** — Mimic instances are **sensors, not engines**.
They observe (log matches + Zeal state) and report lightweight events to the
bot. The **bot is the single engine**: it dedups across everyone, runs the
trigger/condition/timer logic, and **announces in the raid voice channel**. The
raid hears one callout, sourced from the union of everyone's logs.

Why centralized is *better* for a guild (not just different):
- **Coverage redundancy** — if your log missed a line, someone else caught it.
- **One clock for the whole raid** — no per-player drift; one authoritative
  countdown on a single voice stream.
- **Zero per-player setup** — players just run Mimic; the catalog is
  officer-authored, synced like `guild_triggers`.
- **`isboss` for free** — "which mobs broadcast" comes from our own
  `raid_target` + `bosses.json`, not a hand-kept lookup.

**Consequence — countdowns are bot-scheduled.** The agent reports the START
(and END/death for cancel); the bot owns the countdown clock and fires the
10s/5s/0 voice marks. (This revised the earlier "agent fires each tick"
decision.)

Raid callouts ≠ personal overlays. The central voice engine is for *raid
mechanics*. Personal overlays (your target's mob-info, your own buffs/DPS) stay
local — those are about you, not the raid.

---

## What's already SHIPPED this session (the foundation)

- **Trigger → Discord pipe** (`/api/agent/trigger`, bot + agent): a `discord`
  trigger action and the rampage announcer post to `TRIGGER_BROADCAST_CHANNEL_ID`
  (off until set). Cross-agent dedup by `key`, per-uploader rate cap,
  mass-mentions disabled.
- **Voice broadcast schema**: `voice` trigger action — one-shot or multi-tick
  `marks: [{at_ms, text}]` countdown. `mode: 'post' | 'voice'` per fire. Voice
  PLAYBACK is a **stub** (`_playVoiceTrigger` logs `[trigger-voice]`) — real
  audio (`@discordjs/voice` + ffmpeg + TTS) is the next voice commit.
- Durable upload queue already carries the `trigger` kind.

## DnDOverlay engine primitives (the spec to build toward)

- **Event bus** — emit/subscribe, dynamic event names (`BUFF_{buffName:event}`).
- **Condition expressions** — `==/!=/AND/OR/NOT`, ternary, arithmetic
  (`floor/abs/max`), member access (`event.params.x`), **no `eval`**.
- **Transforms/lookups** — builtins (`ucfirst/slug/event`) + JSON lookup tables
  (`isboss/ttd/buffgroups/buffline`). `{key:name}` syntax.
- **Timers** (`src/renderer/overlays/timer/timerState.ts`):
  - `timerId` = logical identity; setting it **evicts** a timer with the same id
    but a different name. `timerGroup` = one-per-group eviction. `resetOnMatch`
    = restart in place. `hidden` = ticks + participates in lookups but not
    rendered. `milestones` = one-shot at `remainingMs` thresholds (can emit
    events). **No built-in current-target filter** — target-scoping is emergent
    from authoring (per-target `timerId` + `MOB_DEATH`/`TARGET_CHANGED` end
    conditions).
  - **Our requirement (superset):** unique `timerId` per (mob, effect) +
    explicit "current target only" overlay view driven by Zeal `target_name`.
    Limit: EQ/Zeal give only the mob *name*, no instance id — so two
    identically-named mobs can't be split.
- **Cross-trigger refs** — `timerRefs` (read another timer's `.active`/
  `.remainingMs`), `eventRefs` (read another trigger's last-fired params).
- **State events** — `TARGET_CHANGED`, `MANA_CHANGED.percent`,
  `PLAYER_NAME.value`, `SERVER_TICK`, `PIPE_CUSTOM` (in-game `/pipe` text). We
  already capture target/mana/zone via Zeal.

## Parsing — the de-risked landmine

Luter's `{{mob}}`/`{{player}}`/`{{ally}}` macros are load-bearing (every regex
uses them). The trap is **silent failures** on EQ name quirks. His solution
(confirmed): **canonicalize on ingest** —
1. NBSP → space, collapse whitespace, trim trailing spaces (his
   `"Emperor Ssraeshza "` has real trailing spaces).
2. **Replace backticks/apostrophes/periods/etc. with `-`** (`Vyzh\`dra` →
   `Vyzh-dra`) so the regex class stays simple and there's no escaping.
Then `{{mob}}` is just `[A-Za-z0-9 \-]+`.

**Our-stack wrinkle:** we join against the DB (`isboss`/mob-info/`bosses.json`
hold the *real* backtick names), so the same `canonicalizeName()` must run on
**both** the live target AND the DB index, or `Rhag-Zadune` won't match
`Rhag\`Zadune`. Recommendation: keep the **raw** name for display, canonical
form only as the match key.

---

## Charm tracker + buff-duration inference (in progress)

### Charm tracker — SHIPPED (agent v3.0.20–3.0.22)
- Driven off the **Zeal pet gauge (slot 16)**, not log lines — Quarm's charm
  signals are unreliable (no "regards as ally"; break line is self-only
  `"Your charm spell has worn off."`; land acks vary). Gauge = authoritative +
  class-agnostic (enchanter AND bard). `_reconcileGaugeCharms()` opens on an
  article-prefixed slot-16 pet, closes when it leaves the gauge.
- **Class-aware duration bar** (v3.0.22): detect the charm spell cast
  (`You begin casting/singing <X>`) → `CHARM_SPELLS` catalog (`{class, dur}`,
  seeded from `eqemu_spells`) → full-length duration bar + class-aware warning
  (bard 6s before last tick; enchanter 30s remaining). Enchanter durations are
  the spell **cap** (long) and meant for tuning; bard values are practical.
- Overlay polish: tick shown `x/y`; outside-of-overlay flash on imminent break.

### Pet BUFF timers — DESIGNED, not built (tomorrow)
Goal: show buffs you cast on the charmed pet with ticking timers. Zeal does NOT
expose the pet's buff window, so we **infer**:

`remaining = CalcBuffDuration_formula(60, buffdurationformula, buffduration) × 6s × (1 + SCR% [+ ExtendedEnhancement gear focus%])`

- **Base duration** — `eqemu_spells` formula (we mirror it).
- **"On the pet" detection** — buff cast **while Zeal target == the pet**.
- **The AA extension — sourced from the DB, NOT guessed:**
  - We **mirror the EQMacEmu AA tables** now: `eqemu_altadv_vars`
    (`skill_id`, `eqmacid`, `name`, `classes`, `max_level`, `spellid`…) +
    `eqemu_aa_effects` (`aaid`, `slot`, `effectid`, `base1`/`base2` — the
    5/15/30% lives in `base1`). Migration `20260605040000`, wired into
    `sync-from-eqmac.js`, sync triggered.
  - **Spell Casting Reinforcement** = +5/15/30% (ranks 1–3), confirmed from the
    in-game AA window. **Spell Casting Reinforcement Mastery** = +20% more
    (single rank, requires SCR 3). Enchanter ceiling = +50%.
  - **A character's ranks come from their Quarmy `AAIndex` block** (we already
    link Quarmy per char). Format: `AAIndex / Rank` header, then `<aaId> <rank>`
    rows until `Checksum`. The id is the Mac ability id (matches
    `altadv_vars.eqmacid`, TBD-verify).
  - **IMPORTANT correction:** AA `211` is **NOT** SCR — Hopeya (enc), Melting
    (bard), AND Hitya (monk) all have `211→3`; a monk wouldn't buy SCR, so 211
    is a universal AA. **Do not assume IDs — resolve from `eqemu_altadv_vars`.**
    Our three test characters have **0 SCR**, so their pet buffs correctly show
    **minimum (base) duration, +0%**.
  - **Extended Enhancement** is a *gear* focus (not in AAIndex) — resolve from
    Quarmy worn items → `eqemu_items` focus. Follow-up after the AA path.
- Quarmy AA parser is **not built yet** (`parseQuarmyWishlist` is still a
  placeholder). Three Quarmy files (Hopeya/Melting/Hitya) are saved as test
  fixtures.

**First steps tomorrow:** verify the AA sync populated → query
`eqemu_altadv_vars` to learn what `211` is + the real SCR `skill_id`/`eqmacid` +
its `base1` 5/15/30 → build the Quarmy AA parser → duration calc → pet-buff
timer rows.

---

## Mob-info overlay (designed, not built)

Target → stats card (like DnDOverlay's `mobinfo` overlay). Enabler exists: the
agent tracks `target_name`/`target_hp_pct` from Zeal. Data: `eqemu_npc_types`
has class/hp/dmg/AC/resists; **specials** (Summon/Enrage/Flurry/Magical) were
added to the sync (`npcspecialattks`, migration `20260605030000`) — needs a
forced sync to backfill. Name→row resolution is clean for named/raid targets,
ambiguous for same-named trash (no instance id).

---

## Known issues / TODO queue

1. **Dragon Punch attribution — FIXED (display anonymized).** Root cause: the
   proc line `"<target> is stricken by the force of a dragon."` names only the
   target, never the kicker, and is **bystander-visible** — boxed/grouped chars
   all saw Hitya's proc and the agent credited each log owner (Bwavair 111,
   Hitya 2), both mis-attributing AND over-counting. Fix (web `/fun` only): count
   **DISTINCT `(target, event_ts)`** = actual physical repositions, shown as an
   anonymous guild total ("Mobs have been repositioned by Dragon Punch X times").
   No names, no double-count, works on existing data. *Minor follow-up:* the
   agent still uploads one row per watching log (bloat, not incorrectness) — the
   distinct-count absorbs it; could set `caster=null`/mob agent-side later.
2. **Overlay font-size control** — last piece of the overlay ask (text
   larger/smaller). Position persistence + resize are fixed/working; font size
   is the remaining gap. → beta.
3. **Pet buff timers** — see above. Behind font-size.
4. **Voice audio** — wire `@discordjs/voice` + ffmpeg + TTS (free default +
   ElevenLabs adapter) into `_playVoiceTrigger`.
5. **Enchanter charm durations** in `CHARM_SPELLS` are the spell cap (long) —
   tune to practical values.

## Build order (resume here)

1. Verify AA sync → identify `211` + SCR + read `base1` values.
2. Overlay **font-size** control (→ beta).
3. **Quarmy AA parser** (bot-side) → ranks per character.
4. **Pet buff timers** (duration calc + overlay rows).
5. **Voice audio** (the `_playVoiceTrigger` stub → real TTS).
6. **Tell-back: mention the sender in relayed tell DMs.** When an incoming tell
   gets relayed to a member's Discord DM (existing `tell_relay` opt-in path in
   `_handleAgentTells`), resolve the SENDER's character → its `discord_id` via
   the characters table (or the family-root's discord_id when an alt has none).
   Replace the plain-text sender name in the DM body with a `<@id>` mention so
   it pings them and a click opens their profile card → "Send Message".
   - **Consent:** any guild member with a linked `discord_id` is fair game (per
     the design call). No new opt-in field.
   - **Fallback:** unlinked sender → plain text (unchanged behavior).
   - **Touches:** bot only — `_handleAgentTells` in `index.js` where the DM is
     composed. Add a character→discord_id lookup helper (cached). Outbound DM
     uses `allowedMentions: { users: [senderId] }` so the mention pings.
   - **Tiny gotcha:** Discord DMs can only mention users who share a guild with
     the bot. Both sides are in our guild, so this holds.
6. Then the bigger **central event engine** (event bus + condition eval +
   transforms + bot-scheduled timers + `.dno` import to seed the catalog).
7. **Mob-info overlay.**
8. Fix **Dragon Punch** attribution.
